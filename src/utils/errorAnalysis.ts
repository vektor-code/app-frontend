import type { Span } from '../entities';
import { normalizeHttpMethod, readHttpStatus, isValidHttpStatus } from './httpTelemetry';
import { grpcStatusName, isRefusedSignal, isResetSignal, isTimeoutSignal } from './errorSignals';
import { getSpanDependency } from './dependency';

// Human-readable analysis of a failed span: what happened, where the call
// went, why it likely failed, and the concrete evidence backing it.
export interface ErrorExplanation {
  title: string;          // e.g. "HTTP 404 — Not Found"
  what: string;           // plain sentence describing exactly what happened
  target?: string;        // where the call was going
  causes: string[];       // likely causes, most probable first
  evidence: [string, string][]; // key facts extracted from the span
  rawMessage: string;     // original error text from instrumentation
  exceptionType?: string;
  stackTrace?: string | null;
  httpStatus?: number;
  category: 'http' | 'db' | 'messaging' | 'exception' | 'timeout' | 'connection' | 'app' | 'rpc';
}

const HTTP_STATUS_INFO: Record<number, { name: string; meaning: string; causes: string[] }> = {
  400: {
    name: 'Bad Request',
    meaning: 'the server rejected the request as malformed or invalid',
    causes: [
      'The request body or query parameters do not match what the endpoint expects (missing/invalid fields).',
      'A validation rule failed on the server — check the response body for field-level details.',
    ],
  },
  401: {
    name: 'Unauthorized',
    meaning: 'the request had missing, expired, or invalid credentials',
    causes: [
      'The auth token/API key was not sent, has expired, or was issued for a different environment.',
      'Service-to-service credentials (e.g. a client secret) may have been rotated without updating this caller.',
    ],
  },
  403: {
    name: 'Forbidden',
    meaning: 'the credentials were valid but lack permission for this resource',
    causes: [
      'The calling service is authenticated but not authorized for this endpoint/resource.',
      'An ACL, role, or scope is missing for this operation.',
    ],
  },
  404: {
    name: 'Not Found',
    meaning: 'no route or resource exists at the requested URL',
    causes: [
      'The endpoint path may be wrong — renamed, removed, or deployed under a different prefix.',
      'The base URL might point at the wrong service or version.',
    ],
  },
  405: {
    name: 'Method Not Allowed',
    meaning: 'the URL exists but does not accept this HTTP method',
    causes: ['The endpoint exists but expects a different HTTP method (e.g. POST instead of GET).'],
  },
  408: {
    name: 'Request Timeout',
    meaning: 'the server gave up waiting for the request',
    causes: ['The client was too slow sending the request, or a proxy timed out the connection.'],
  },
  409: {
    name: 'Conflict',
    meaning: 'the request conflicts with the current state of the resource',
    causes: ['A concurrent update or a duplicate resource (e.g. unique constraint) blocked this operation.'],
  },
  413: {
    name: 'Payload Too Large',
    meaning: 'the request body exceeds the server limit',
    causes: ['The uploaded payload exceeds the server/proxy body-size limit (check nginx/ingress limits).'],
  },
  422: {
    name: 'Unprocessable Entity',
    meaning: 'the request was well-formed but semantically invalid',
    causes: ['Business validation failed — the response body usually lists which fields were rejected.'],
  },
  429: {
    name: 'Too Many Requests',
    meaning: 'the caller is being rate-limited',
    causes: ['This service exceeded a rate limit — add backoff/retry or request a higher quota.'],
  },
  500: {
    name: 'Internal Server Error',
    meaning: 'the remote service crashed while handling this request',
    causes: [
      'An unhandled exception occurred inside the target service — its logs for this timestamp have the real stack trace.',
      'This is a server-side bug in the target service, not a problem with the caller.',
    ],
  },
  502: {
    name: 'Bad Gateway',
    meaning: 'a proxy/gateway got an invalid response from the upstream service',
    causes: [
      'The upstream pod behind the gateway is down, crashing, or restarting.',
      'The gateway points at a wrong upstream port or the upstream closed the connection mid-response.',
    ],
  },
  503: {
    name: 'Service Unavailable',
    meaning: 'the target service is temporarily unable to handle requests',
    causes: [
      'The target has no healthy/ready pods (failed readiness probes, rollout in progress, or scaled to zero).',
      'The service is overloaded and shedding traffic.',
    ],
  },
  504: {
    name: 'Gateway Timeout',
    meaning: 'the upstream service did not answer within the gateway timeout',
    causes: [
      'The upstream service is too slow — look at its own downstream calls (DB, external APIs) for the bottleneck.',
      'A proxy timeout is set lower than the real processing time of this endpoint.',
    ],
  },
};

function attr(span: Span, ...keys: string[]): string {
  const a = span.attributes || {};
  for (const k of keys) {
    if (a[k]) return String(a[k]);
  }
  return '';
}

function extractException(span: Span): { type: string; message: string; stack: string | null } {
  const a = span.attributes || {};
  let type = a['exception.type'] || a['error.type'] || '';
  let message = a['exception.message'] || a['error.message'] || a['error.msg'] || '';
  let stack = a['exception.stacktrace'] || a['error.stack'] || a['stacktrace'] || a['stack'] || null;

  if (span.events) {
    const ev = span.events.find(e => e.name === 'exception' || e.name === 'error');
    if (ev && ev.attributes) {
      type = type || ev.attributes['exception.type'] || '';
      message = message || ev.attributes['exception.message'] || ev.attributes['message'] || '';
      stack = stack || ev.attributes['exception.stacktrace'] || ev.attributes['error.stacktrace'] || null;
    }
  }
  if (!type && message) {
    type = inferExceptionType(message, stack);
  }
  return { type, message, stack };
}

/** When Python auto-instr omits exception.type, infer a short label from the message. */
export function inferExceptionType(message: string, stack?: string | null): string {
  const text = `${message}\n${stack || ''}`;
  if (/validation error for /i.test(text) || /pydantic/i.test(text)) {
    return 'ValidationError';
  }
  if (/TypeError:/i.test(text)) return 'TypeError';
  if (/ValueError:/i.test(text)) return 'ValueError';
  if (/KeyError:/i.test(text)) return 'KeyError';
  if (/AttributeError:/i.test(text)) return 'AttributeError';
  if (/TimeoutError|asyncio\.TimeoutError/i.test(text)) return 'TimeoutError';
  const fromStack = text.match(/^\s*([A-Za-z_][\w.]*(?:Error|Exception))\s*:/m);
  if (fromStack) {
    const parts = fromStack[1].split('.');
    return parts[parts.length - 1];
  }
  return '';
}

function isValidationException(message: string, type: string): boolean {
  const blob = `${type} ${message}`.toLowerCase();
  return blob.includes('validation error') || blob.includes('pydantic') || type === 'ValidationError';
}

export function explainSpanError(span: Span): ErrorExplanation {
  const a = span.attributes || {};
  const method = normalizeHttpMethod(attr(span, 'http.request.method', 'http.method'));
  const urlFull = attr(span, 'url.full', 'http.url');
  const urlPath = attr(span, 'url.path', 'http.target', 'http.route');
  const host = attr(span, 'server.address', 'net.peer.name', 'http.host', 'peer.service');
  const port = attr(span, 'server.port', 'net.peer.port');
  const httpStatus = readHttpStatus(span.attributes);
  const status = httpStatus.code;
  const inboundUrl = urlPath || urlFull || span.name;
  const remoteTarget = urlFull || (host ? host + (port ? ':' + port : '') : '');
  // SERVER spans receive a request; CLIENT spans go to a remote. Mixing those
  // made a local 503 look like "we called the upstream host and got 503".
  const targetDisplay = span.kind === 'SERVER' ? (urlFull || urlPath || '') : remoteTarget;
  const evidence: [string, string][] = [];
  if (method) evidence.push(['HTTP method', method]);
  if (urlFull) evidence.push(['Full URL', urlFull]);
  if (urlPath) evidence.push(['URL path', urlPath]);
  if (httpStatus.present) evidence.push(['Status code', httpStatus.raw || String(status)]);
  if (host) evidence.push([span.kind === 'SERVER' ? 'Peer / host' : 'Target host', host + (port ? ':' + port : '')]);
  const rpcSystem = attr(span, 'rpc.system');
  const rpcMethod = [attr(span, 'rpc.service'), attr(span, 'rpc.method')].filter(Boolean).join('/');
  if (rpcSystem) evidence.push(['RPC system', rpcSystem]);
  if (rpcMethod) evidence.push(['RPC method', rpcMethod]);
  const grpcStatusRaw = attr(span, 'rpc.grpc.status_code', 'rpc.status_code', 'grpc.status_code');
  if (grpcStatusRaw) evidence.push(['gRPC status', grpcStatusName(Number.parseInt(grpcStatusRaw, 10)) || grpcStatusRaw]);
  const dbSystem = a['db.system'] || '';
  const dbName = a['db.name'] || '';
  const dbStatement = a['db.statement'] || '';
  const msgSystem = a['messaging.system'] || '';
  const exc = extractException(span);
  const rawMessage = span.error || exc.message || attr(span, 'status.message', 'message') || '';

  if (dbSystem) evidence.push(['Database', dbSystem + (dbName ? ` (${dbName})` : '')]);
  if (dbStatement) evidence.push(['Query', dbStatement.length > 300 ? dbStatement.slice(0, 300) + '…' : dbStatement]);
  if (msgSystem) evidence.push(['Message broker', msgSystem]);
  if (exc.type) evidence.push(['Exception type', exc.type]);
  if (rawMessage) evidence.push(['Reported error', rawMessage]);
  const respSize = attr(span, 'http.response.body.size');
  if (respSize) evidence.push(['Response size', respSize + ' bytes']);

  const lowerRaw = `${exc.type} ${rawMessage}`.toLowerCase();

  // 1. Timeouts and connection failures dominate — call them out first.
  if (isTimeoutSignal(lowerRaw)) {
    const timeoutTarget = span.kind === 'SERVER' ? (host || inboundUrl) : (remoteTarget || host);
    return {
      category: 'timeout',
      title: 'Timeout' + (timeoutTarget ? ` calling ${timeoutTarget}` : ''),
      what: `${span.serviceName} waited too long for a response${timeoutTarget ? ` from ${timeoutTarget}` : ''} and gave up after ${span.durationMs.toFixed(0)} ms.`,
      target: timeoutTarget || undefined,
      causes: [
        'The target is overloaded or stuck (check its CPU, connection pools, and slow downstream calls).',
        'A network issue or DNS delay between the services.',
        'The client timeout may simply be set lower than the normal processing time of this operation.',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  if (isResetSignal(lowerRaw) || isRefusedSignal(lowerRaw)) {
    return {
      category: 'connection',
      title: 'Connection failed' + (host ? ` to ${host}` : ''),
      what: `${span.serviceName} could not establish or keep a connection${remoteTarget ? ` to ${remoteTarget}` : ''}.`,
      target: remoteTarget || undefined,
      causes: [
        'The target service/pod is down, restarting, or not listening on this port.',
        'The hostname or port in this caller\'s configuration is wrong.',
        'A NetworkPolicy/firewall may be blocking traffic between these namespaces.',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  // CLIENT recorded HTTP 0 / no status: transport failed, not an application 5xx.
  if (span.kind === 'CLIENT' && httpStatus.present && !isValidHttpStatus(status)) {
    return {
      category: 'connection',
      title: 'Missing HTTP response',
      what: `${span.serviceName} made a CLIENT ${method || 'HTTP'} call${remoteTarget ? ` to ${remoteTarget}` : ''} that ended without a valid HTTP status (recorded ${httpStatus.raw || '0'}).`,
      target: remoteTarget || undefined,
      causes: [
        'The request never received an HTTP status line (connection failed, reset, or timed out at the transport layer).',
        'The instrumentation records status 0 when no HTTP response was observed.',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  const grpcRaw = attr(span, 'rpc.grpc.status_code', 'rpc.status_code', 'grpc.status_code');
  const grpcCode = grpcRaw ? Number.parseInt(grpcRaw, 10) : NaN;
  if (Number.isFinite(grpcCode) && grpcCode > 0) {
    const rpcName = grpcStatusName(grpcCode) || `status ${grpcCode}`;
    const rpcOp = [attr(span, 'rpc.service'), attr(span, 'rpc.method')].filter(Boolean).join('/');
    return {
      category: 'rpc',
      title: `gRPC ${rpcName}`,
      what: `${span.serviceName} RPC ${rpcOp || span.name} failed with ${rpcName}.`,
      target: attr(span, 'server.address', 'net.peer.name', 'rpc.service') || undefined,
      causes: grpcCode === 4 || grpcCode === 1
        ? ['The RPC did not complete before the deadline.', 'The callee may be slow or blocked on its own downstreams.']
        : grpcCode === 14
          ? ['The RPC endpoint was unavailable.', 'Check destination pods, Service, and NetworkPolicy.']
          : ['The remote RPC handler returned a non-OK status.', 'Inspect that service around this timestamp.'],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  const dep = getSpanDependency(span.attributes);
  const dbPortLabel = wellKnownStoreLabel(port);
  if (dep.kind === 'database' || dep.kind === 'cache' || dbPortLabel) {
    const sys = dep.system || dbPortLabel || 'database';
    const instant = span.durationMs < 5;
    return {
      category: 'db',
      title: instant ? `${sys} call failed instantly` : `${sys} error`,
      what: instant
        ? `${span.serviceName} failed a ${sys} call to ${remoteTarget || host || 'the database'} in ${span.durationMs.toFixed(2)} ms — that is a local reject, not a round trip.`
        : `${span.serviceName} failed a ${sys} operation${remoteTarget ? ` against ${remoteTarget}` : ''}.`,
      target: remoteTarget || undefined,
      causes: instant
        ? ['The process never waited on the wire — check credentials, TLS, a missing driver, or a sidecar that returned an error without connecting.', 'If this IP is not a cluster Pod or Service, it is likely a VPC or managed database.']
        : ['The query failed, the pool was exhausted, or the database was unreachable.', 'If this IP is not a cluster Pod or Service, treat it as an external database.'],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  // 2. HTTP errors with a status code — the most common case.
  if (isValidHttpStatus(status) && status >= 400) {
    const info = HTTP_STATUS_INFO[status] || {
      name: status >= 500 ? 'Server Error' : 'Client Error',
      meaning: status >= 500 ? 'the remote service crashed or rejected the request' : 'the server rejected the request',
      causes: [],
    };

    const causes = [...info.causes];
    const validation = isValidationException(rawMessage, exc.type);

    // Prefer the exception when a 5xx is really an application validation/crash.
    if (status >= 500 && validation) {
      causes.unshift(
        'A response or domain model failed validation (often a null/enum mismatch) — fix the producer data or widen the schema.',
        'Inspect the stack for the response model and the field that rejected the value.'
      );
      const shortMsg = rawMessage.split('\n')[0].trim();
      return {
        category: 'exception',
        title: `Validation failed — HTTP ${status}`,
        what: `${span.serviceName} returned HTTP ${status} because validation failed${shortMsg ? `: ${shortMsg}` : '.'}`,
        target: targetDisplay || undefined,
        causes,
        evidence,
        rawMessage,
        exceptionType: exc.type || 'ValidationError',
        stackTrace: exc.stack,
        httpStatus: status,
      };
    }

    if (status >= 500 && rawMessage) {
      causes.unshift('An exception was recorded on this span — use the message and stack below as the primary signal.');
    }

    // Sharper diagnosis for 404s with a missing/root path: the classic
    // "base URL called without an endpoint" bug.
    if (status === 404 && (!urlPath || urlPath === '/' || urlPath === '')) {
      causes.unshift(
        'The request URL has no path — this call went to the server root "/". The endpoint path is most likely missing when the URL is built (empty config value, env variable, or string concatenation bug in the caller).'
      );
    } else if (status === 404 && urlPath) {
      causes.unshift(`No route matches "${urlPath}" on ${host || 'the target'} — verify the endpoint path and API version.`);
    }

    const pathNote = status === 404 && (!urlPath || urlPath === '/')
      ? ' The URL contains no path (only the host), so the target had nothing to serve.'
      : '';

    let what = span.kind === 'SERVER'
      ? `${span.serviceName} received ${method || 'an HTTP'} ${inboundUrl} and responded ${status} ${info.name}: ${info.meaning}.${pathNote}`
      : `${span.serviceName} sent ${method || 'a'} request to ${remoteTarget || 'a remote service'} and received ${status} ${info.name}: ${info.meaning}.${pathNote}`;
    if (status >= 500 && rawMessage) {
      const shortMsg = rawMessage.split('\n')[0].trim();
      if (shortMsg) what += ` Exception: ${shortMsg}`;
    }

    return {
      category: 'http',
      title: `HTTP ${status} — ${info.name}`,
      what,
      target: targetDisplay || undefined,
      causes,
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
      httpStatus: status,
    };
  }

  // 3. Database errors.
  if (dbSystem || dbStatement) {
    return {
      category: 'db',
      title: `Database error${dbSystem ? ` (${dbSystem}${dbName ? ` · ${dbName}` : ''})` : ''}`,
      what: `${span.serviceName} failed executing a ${dbSystem || 'database'} operation${rawMessage ? `: ${rawMessage}` : '.'}`,
      target: host || dbSystem || undefined,
      causes: [
        'The query itself failed — syntax error, missing table/column, constraint violation, or permission issue (see the reported error).',
        'The database may be unreachable or its connection pool exhausted.',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  // 4. Messaging errors.
  if (msgSystem) {
    return {
      category: 'messaging',
      title: `Messaging error (${msgSystem})`,
      what: `${span.serviceName} failed to ${span.kind === 'CONSUMER' ? 'consume from' : 'publish to'} ${msgSystem}${rawMessage ? `: ${rawMessage}` : '.'}`,
      target: host || msgSystem,
      causes: [
        'The broker may be unreachable or the topic/queue missing.',
        'Message serialization or acknowledgement failed (see the reported error).',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  // 5. In-process exception.
  if (exc.type || exc.message) {
    return {
      category: 'exception',
      title: exc.type ? `Exception: ${exc.type.split('.').pop()}` : 'Unhandled exception',
      what: `${span.serviceName} threw ${exc.type || 'an exception'} during "${span.name}"${exc.message ? `: ${exc.message}` : '.'}`,
      causes: [
        'This is an application-level exception inside the service — the stack trace below points at the exact code path.',
      ],
      evidence,
      rawMessage,
      exceptionType: exc.type || undefined,
      stackTrace: exc.stack,
    };
  }

  // 6. Fallback.
  return {
    category: 'app',
    title: 'Operation failed',
    what: `${span.serviceName} reported an error during "${span.name}"${rawMessage ? `: ${rawMessage}` : ', but the instrumentation did not attach details.'}`,
    target: targetDisplay || undefined,
    causes: rawMessage
      ? []
      : ['The span is marked as ERROR without an error message — check the target service\'s own logs around this timestamp.'],
    evidence,
    rawMessage,
    exceptionType: exc.type || undefined,
    stackTrace: exc.stack,
  };
}

const WELL_KNOWN_STORE_PORTS: Record<string, string> = {
  '5432': 'PostgreSQL',
  '5433': 'PostgreSQL',
  '3306': 'MySQL',
  '6379': 'Redis',
  '27017': 'MongoDB',
  '1433': 'Microsoft SQL Server',
  '1521': 'Oracle',
  '9200': 'Elasticsearch',
  '11211': 'Memcached',
};

function wellKnownStoreLabel(port: string): string {
  return WELL_KNOWN_STORE_PORTS[port] || '';
}
