import type { Span, Trace, TraceFailureDiagnosis, TraceFailureEvidence } from '../entities';

type Classification = TraceFailureDiagnosis['classification'];
type Confidence = TraceFailureDiagnosis['confidence'];

interface Options {
  knownTimeouts?: Record<string, number>;
}

interface Finding {
  classification: Classification;
  score: number;
  title: string;
  summary: string;
  evidence: TraceFailureEvidence[];
  causes: string[];
  spanIds: string[];
  rules: string[];
  priority: number;
}

const SCORE_EMPTY_METHOD = 20;
const SCORE_EMPTY_PATH = 15;
const SCORE_INVALID_STATUS = 25;
const SCORE_SERVER_VS_CHILDREN = 20;
const SCORE_CHILD_CLIENT_OK = 10;
const SCORE_EXCEEDS_TIMEOUT = 10;
const SCORE_UNEXPLAINED_LONG = 15;

function attr(span: Span, ...keys: string[]): string {
  const a = span.attributes || {};
  for (const k of keys) {
    const v = String(a[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function attrPresent(span: Span, ...keys: string[]): boolean {
  const a = span.attributes || {};
  return keys.some(k => Object.prototype.hasOwnProperty.call(a, k));
}

function httpMethodRaw(span: Span): { value: string; present: boolean } {
  const a = span.attributes || {};
  for (const k of ['http.request.method', 'http.method']) {
    if (Object.prototype.hasOwnProperty.call(a, k)) return { value: String(a[k] ?? ''), present: true };
  }
  return { value: '', present: false };
}

function isValidHTTPMethod(method: string): boolean {
  if (!method) return false;
  for (let i = 0; i < method.length; i++) {
    const c = method.charCodeAt(i);
    if (c >= 48 && c <= 57) continue;
    if (c >= 65 && c <= 90) continue;
    if (c >= 97 && c <= 122) continue;
    if ("!#$%&'*+-.^_`|~".includes(method[i])) continue;
    return false;
  }
  return true;
}

function httpStatus(span: Span): { code: number; present: boolean } {
  const raw = attr(span, 'http.response.status_code', 'http.status_code');
  if (!raw) return { code: 0, present: false };
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return { code: 0, present: true };
  return { code: n, present: true };
}

function httpPath(span: Span): string {
  let p = attr(span, 'url.path', 'http.target', 'http.route');
  if (p) return p.split(/[?#]/)[0];
  const full = attr(span, 'url.full', 'http.url');
  if (!full) return '';
  try {
    const u = new URL(full);
    return u.pathname || '';
  } catch {
    const idx = full.indexOf('://');
    if (idx >= 0) {
      const rest = full.slice(idx + 3);
      const slash = rest.indexOf('/');
      if (slash >= 0) return rest.slice(slash).split(/[?#]/)[0];
    }
  }
  return '';
}

function libraryName(span: Span): string {
  return attr(span, 'otel.library.name', 'otel.scope.name', 'library.name');
}

function isHTTPLibrary(span: Span): boolean {
  const lib = libraryName(span).toLowerCase();
  return lib.includes('/http') || lib.includes('instrumentation-http') || lib.includes('net/http') || lib.endsWith('.http');
}

function isHTTPSpan(span: Span): boolean {
  if (attrPresent(span,
    'http.request.method', 'http.method',
    'http.response.status_code', 'http.status_code',
    'url.path', 'http.target', 'http.route', 'http.url', 'url.full',
    'http.host', 'http.scheme',
  )) return true;
  if (isHTTPLibrary(span)) return true;
  const name = (span.name || '').toUpperCase();
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].some(m => name === m || name.startsWith(m + ' ') || name.startsWith(m + '/'));
}

function validHTTPStatus(code: number): boolean {
  return code >= 100 && code <= 599;
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(1)}ms`;
}

function errorText(span: Span): string {
  const parts = [span.error || '', attr(span, 'exception.message', 'error.message', 'error.msg', 'status.message', 'message')];
  for (const ev of span.events || []) {
    if (ev.attributes) {
      parts.push(ev.attributes['exception.message'] || '', ev.attributes['message'] || '');
    }
  }
  return parts.join(' ').toLowerCase();
}

function httpStatusName(code: number): string {
  const names: Record<number, string> = {
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    408: 'Request Timeout', 429: 'Too Many Requests', 500: 'Internal Server Error',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  };
  return names[code] || (code >= 500 ? 'Server Error' : code >= 400 ? 'Client Error' : '');
}

function isRootParent(id?: string): boolean {
  return !id || /^0+$/.test(id);
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function confidenceFor(score: number): Confidence {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function parseTimeoutMs(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const m = v.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'ms') return n;
  if (unit === 'm') return n * 60_000;
  if (unit === 's' || n < 1000) return n * 1000;
  return n;
}

function spanTimeoutMs(span: Span, opts: Options): number | null {
  const a = span.attributes || {};
  for (const k of ['http.server.timeout', 'http.client.timeout', 'http.request.timeout', 'timeout.ms', 'proxy.timeout', 'PROXY_TIMEOUT', 'proxy.timeout.ms']) {
    if (a[k]) {
      const ms = parseTimeoutMs(String(a[k]));
      if (ms && ms > 0) return ms;
    }
  }
  const known = opts.knownTimeouts || {};
  if (known[span.spanId]) return known[span.spanId];
  if (known[span.serviceName]) return known[span.serviceName];
  return null;
}

function childrenOf(spans: Span[]): Map<string, Span[]> {
  const byId = new Set(spans.map(s => s.spanId));
  const children = new Map<string, Span[]>();
  for (const sp of spans) {
    if (isRootParent(sp.parentSpanId) || !sp.parentSpanId || !byId.has(sp.parentSpanId)) continue;
    const list = children.get(sp.parentSpanId) || [];
    list.push(sp);
    children.set(sp.parentSpanId, list);
  }
  return children;
}

/**
 * Deterministic Trace Failure Analyzer. Does not mutate spans.
 * Prefer the API `failureDiagnosis` field when present; this is a local fallback.
 */
export function analyzeTraceFailure(trace: Trace, opts: Options = {}): TraceFailureDiagnosis | null {
  const spans = trace.spans || [];
  if (!spans.length) return null;
  const children = childrenOf(spans);
  const byId = new Map(spans.map(s => [s.spanId, s]));
  const findings: Finding[] = [
    ...ruleInstrumentation(spans, children, opts),
    ...ruleTransport(spans, byId),
    ...ruleTimeout(spans),
    ...ruleHTTPOutcome(spans, children),
    ...ruleDuplicates(spans),
    ...ruleTraceContext(spans, byId),
  ];
  if (!findings.length) {
    if (spans.some(s => s.status === 'ERROR')) return unknownDiagnosis(trace);
    return null;
  }
  const best = findings.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.priority > a.priority) ? b : a));
  const score = Math.max(0, Math.min(100, best.score));
  const missingParents = spans.filter(s => s.parentSpanId && !/^0*$/.test(s.parentSpanId) && !byId.has(s.parentSpanId)).length;
  const evidence = [...best.evidence];
  if (missingParents === 0) {
    evidence.push({ code: 'span_tree_complete', message: 'All captured spans have their parent in this trace.' });
  } else if (!evidence.some(item => item.code === 'missing_parent')) {
    evidence.push({ code: 'missing_parent', message: `${missingParents} span(s) reference a parent that was not captured.` });
  }
  const diagnosis: TraceFailureDiagnosis = {
    traceId: trace.traceId,
    classification: best.classification,
    severity: severityFor(best),
    confidence: confidenceFor(score),
    confidenceScore: score,
    title: best.title,
    summary: best.summary,
    evidence,
    likelyCauses: best.causes,
    affectedSpanIds: unique(best.spanIds),
    rules: unique(best.rules),
    spanTree: missingParents === 0 ? 'complete' : 'broken',
  };
  diagnosis.live = livePlanFor(diagnosis.classification);
  return diagnosis;
}

function severityFor(f: Finding): Confidence {
  switch (f.classification) {
    case 'APPLICATION_ERROR':
    case 'DOWNSTREAM_ERROR':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'HIGH';
    case 'INSTRUMENTATION_ANOMALY':
      return confidenceFor(f.score);
    case 'UNKNOWN':
      return 'LOW';
    default:
      return 'MEDIUM';
  }
}

function unknownDiagnosis(trace: Trace): TraceFailureDiagnosis {
  const spans = trace.spans || [];
  const ids = new Set(spans.map(s => s.spanId));
  const missingParents = spans.filter(s => s.parentSpanId && !/^0*$/.test(s.parentSpanId) && !ids.has(s.parentSpanId)).length;
  const evidence: TraceFailureEvidence[] = [{ code: 'insufficient_evidence', message: 'The failing span has no reliable HTTP, transport, or exception metadata.', score: 15 }];
  if (missingParents === 0) {
    evidence.push({ code: 'span_tree_complete', message: 'All captured spans have their parent in this trace.' });
  } else {
    evidence.push({ code: 'missing_parent', message: `${missingParents} span(s) reference a parent that was not captured.` });
  }
  return {
    traceId: trace.traceId,
    classification: 'UNKNOWN',
    severity: 'LOW',
    confidence: 'LOW',
    confidenceScore: 15,
    title: 'Unexplained span failure',
    summary: 'A span is marked failed, but the trace does not contain enough consistent evidence to explain why.',
    evidence,
    likelyCauses: ['The instrumentation did not attach a usable error description.', 'The failure may be internal to the service without exported details.'],
    affectedSpanIds: spans.filter(s => s.status === 'ERROR').map(s => s.spanId),
    rules: ['unknown_insufficient_evidence'],
    spanTree: missingParents === 0 ? 'complete' : 'broken',
    live: livePlanFor('UNKNOWN'),
  };
}

function ruleInstrumentation(spans: Span[], children: Map<string, Span[]>, opts: Options): Finding[] {
  const out: Finding[] = [];
  for (const server of spans) {
    if (server.kind !== 'SERVER' || !isHTTPSpan(server)) continue;
    const { value: methodRaw, present: methodPresent } = httpMethodRaw(server);
    const { code: status, present: statusPresent } = httpStatus(server);
    const path = httpPath(server);
    const evidence: TraceFailureEvidence[] = [];
    let score = 0;
    const rules: string[] = [];
    let malformed = 0;
    const methodValid = isValidHTTPMethod(methodRaw);
    const httpExpected = methodPresent || statusPresent || !!path || !!attr(server, 'url.full', 'http.url') || isHTTPLibrary(server);
    if (!methodValid && httpExpected) {
      evidence.push({ code: 'empty_http_method', message: methodRaw.trim() ? `SERVER HTTP method "${methodRaw}" is not a valid HTTP token` : 'SERVER HTTP method is empty', spanId: server.spanId, score: SCORE_EMPTY_METHOD });
      score += SCORE_EMPTY_METHOD;
      malformed++;
      rules.push('invalid_http_metadata');
    }
    if (isHTTPSpan(server) && !path && !attr(server, 'url.full', 'http.url')) {
      evidence.push({ code: 'empty_url_path', message: 'SERVER URL path is empty where HTTP metadata is expected', spanId: server.spanId, score: SCORE_EMPTY_PATH });
      score += SCORE_EMPTY_PATH;
      malformed++;
      rules.push('invalid_http_metadata');
    }
    if (statusPresent && !validHTTPStatus(status)) {
      evidence.push({ code: 'invalid_http_status', message: `SERVER response status ${status} is not a valid HTTP status`, spanId: server.spanId, score: SCORE_INVALID_STATUS });
      score += SCORE_INVALID_STATUS;
      malformed++;
      rules.push('invalid_http_metadata');
    }

    const kids = children.get(server.spanId) || [];
    let maxChild = 0;
    let explainingChild = false;
    let fastOK: Span | undefined;
    for (const ch of kids) {
      if (ch.durationMs > maxChild) maxChild = ch.durationMs;
      if (ch.durationMs >= server.durationMs * 0.10) explainingChild = true;
      const st = httpStatus(ch);
      if (ch.kind === 'CLIENT' && st.present && st.code >= 200 && st.code < 400 && ch.durationMs > 0 && ch.durationMs * 20 < server.durationMs) {
        fastOK = ch;
      }
    }
    let lifecycle = false;
    if (server.durationMs >= 1000 && maxChild > 0 && !explainingChild && server.durationMs >= maxChild * 20 && (server.durationMs - maxChild) >= 1000) {
      lifecycle = true;
      evidence.push({ code: 'server_longer_than_children', message: `SERVER duration ${formatDuration(server.durationMs)} is far longer than its child spans (longest child ${formatDuration(maxChild)})`, spanId: server.spanId, score: SCORE_SERVER_VS_CHILDREN });
      score += SCORE_SERVER_VS_CHILDREN;
      rules.push('parent_child_lifecycle');
      if (server.durationMs - maxChild >= 10_000) {
        evidence.push({ code: 'unexplained_server_duration', message: `About ${formatDuration(server.durationMs - maxChild)} of SERVER time is not explained by any child span`, spanId: server.spanId, score: SCORE_UNEXPLAINED_LONG });
        score += SCORE_UNEXPLAINED_LONG;
      }
    }
    if (fastOK) {
      const op = `${attr(fastOK, 'http.request.method', 'http.method')} ${httpPath(fastOK)}`.trim() || fastOK.name;
      const st = httpStatus(fastOK).code;
      evidence.push({ code: 'child_client_succeeded', message: `child CLIENT ${op} completed in ${formatDuration(fastOK.durationMs)} and returned HTTP ${st}`, spanId: fastOK.spanId, score: SCORE_CHILD_CLIENT_OK });
      score += SCORE_CHILD_CLIENT_OK;
      rules.push('malformed_server_successful_client');
    }
    const timeoutMs = spanTimeoutMs(server, opts);
    if (timeoutMs && server.durationMs > timeoutMs && (lifecycle || malformed >= 2)) {
      evidence.push({ code: 'duration_exceeds_known_timeout', message: `SERVER exceeded configured ${timeoutMs >= 1000 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`} proxy timeout`, spanId: server.spanId, score: SCORE_EXCEEDS_TIMEOUT });
      score += SCORE_EXCEEDS_TIMEOUT;
      rules.push('timeout_inconsistency');
    }
    if (score === 0) continue;
    if (methodValid && (path || attr(server, 'url.full', 'http.url')) && statusPresent && validHTTPStatus(status) && status >= 400 && !lifecycle && malformed === 0) continue;
    if (malformed === 0 && !lifecycle) continue;

    let title = 'Invalid HTTP span metadata';
    let summary = 'The SERVER span carries HTTP attributes that are internally inconsistent.';
    if (lifecycle) {
      title = 'HTTP SERVER span lifecycle inconsistency';
      let childNote = 'its child operations completed much earlier';
      if (fastOK) {
        const op = `${attr(fastOK, 'http.request.method', 'http.method')} ${httpPath(fastOK)}`.trim() || fastOK.name;
        childNote = `its child CLIENT ${op} completed successfully in approximately ${formatDuration(fastOK.durationMs)}`;
      }
      summary = `The SERVER span remained open for ${formatDuration(server.durationMs)} even though ${childNote}.`;
    }
    out.push({
      classification: 'INSTRUMENTATION_ANOMALY',
      score: Math.min(100, score),
      title,
      summary,
      evidence,
      causes: [
        'HTTP SERVER span lifecycle/return-probe instrumentation anomaly',
        'corrupted/incomplete HTTP attribute extraction at span completion',
      ],
      spanIds: unique([server.spanId, fastOK?.spanId || '']),
      rules: unique(rules),
      priority: 100,
    });
  }
  return out;
}

function ruleTransport(spans: Span[], byId: Map<string, Span>): Finding[] {
  const out: Finding[] = [];
  for (const sp of spans) {
    const text = errorText(sp);
    const st = httpStatus(sp);
    const reset = /connection reset|econnreset|broken pipe/.test(text);
    const refused = /connection refused|econnrefused|no such host|dial tcp|host unreachable/.test(text);
    const clientZero = sp.kind === 'CLIENT' && st.present && st.code === 0;
    const timeout = /timeout|timed out|deadline exceeded|context deadline|i\/o timeout/.test(text);
    const missingResponse = sp.kind === 'CLIENT' && !st.present && (sp.status === 'ERROR' || !!text) && isHTTPSpan(sp) && !timeout;
    if (!reset && !refused && !clientZero && !missingResponse) continue;
    if (timeout && !reset && !refused && !clientZero) continue;
    let score = 75;
    let title = 'Transport failure';
    let summary = `${sp.serviceName} failed to complete an HTTP request because the connection did not return a normal HTTP response.`;
    const evidence: TraceFailureEvidence[] = [];
    let causes: string[] = [];
    if (reset) {
      title = 'Connection reset';
      summary = `${sp.serviceName} had the connection reset before a complete HTTP response arrived.`;
      evidence.push({ code: 'connection_reset', message: 'The span reports a connection reset.', spanId: sp.spanId, score: 40 });
      causes = ['The peer closed the TCP connection (process crash, idle timeout, or LB reset).', 'A proxy between the services reset the connection.'];
    } else if (refused) {
      title = 'Connection refused';
      summary = `${sp.serviceName} could not establish a connection to the target.`;
      evidence.push({ code: 'connection_refused', message: 'The span reports a connection refused or unreachable host.', spanId: sp.spanId, score: 40 });
      causes = ['The target is not listening on this host/port.', 'DNS or NetworkPolicy is blocking the call.'];
    } else {
      title = 'Missing HTTP response';
      summary = `${sp.serviceName} made a CLIENT call that ended without a valid HTTP status.`;
      causes = ['The request never received an HTTP response (transport-level failure).', 'The instrumentation recorded status 0 because no HTTP status line was observed.'];
    }
    if (clientZero) {
      evidence.push({ code: 'client_status_zero', message: 'CLIENT HTTP status is 0, which is not a valid HTTP response code.', spanId: sp.spanId, score: 25 });
      score += 10;
    }
    if (missingResponse && !clientZero) {
      evidence.push({ code: 'missing_http_response', message: 'CLIENT span has no HTTP response status.', spanId: sp.spanId, score: 20 });
    }
    const ids = [sp.spanId];
    const parent = sp.parentSpanId ? byId.get(sp.parentSpanId) : undefined;
    if (parent?.kind === 'SERVER') {
      const pst = httpStatus(parent);
      if (pst.present && pst.code >= 500) {
        evidence.push({ code: 'proxy_mapped_transport_failure', message: `Parent SERVER returned HTTP ${pst.code}, which is consistent with a proxy mapping a transport failure rather than an application 5xx.`, spanId: parent.spanId, score: 10 });
        ids.push(parent.spanId);
        score += 10;
      }
    }
    out.push({ classification: 'NETWORK_ERROR', score: Math.min(100, score), title, summary, evidence, causes, spanIds: ids, rules: ['transport_failure'], priority: 90 });
  }
  return out;
}

function ruleTimeout(spans: Span[]): Finding[] {
  const out: Finding[] = [];
  for (const sp of spans) {
    const text = errorText(sp);
    const st = httpStatus(sp);
    const httpTimeout = st.present && (st.code === 408 || st.code === 504);
    const timeout = /timeout|timed out|deadline exceeded|context deadline|i\/o timeout/.test(text);
    if (!timeout && !httpTimeout) continue;
    if (/connection reset|econnreset|connection refused/.test(text)) continue;
    let title = 'Request timed out';
    if (st.code === 504) title = 'HTTP 504 Gateway Timeout';
    else if (st.code === 408) title = 'HTTP 408 Request Timeout';
    out.push({
      classification: 'TIMEOUT',
      score: 75,
      title,
      summary: `${sp.serviceName} did not receive a timely response.`,
      evidence: [{ code: 'timeout', message: `Span duration ${formatDuration(sp.durationMs)} matches a timeout failure.`, spanId: sp.spanId, score: 50 }],
      causes: ['The target did not answer within the caller or proxy timeout.', 'The client timeout may be lower than the normal processing time of this operation.'],
      spanIds: [sp.spanId],
      rules: ['timeout'],
      priority: 85,
    });
  }
  return out;
}

function findDownstream5xx(span: Span, children: Map<string, Span[]>, origin: string): Span | undefined {
  for (const ch of children.get(span.spanId) || []) {
    const st = httpStatus(ch);
    if (ch.kind === 'SERVER' && st.present && st.code >= 500 && st.code <= 599 && ch.serviceName !== origin) return ch;
    const hit = findDownstream5xx(ch, children, origin);
    if (hit) return hit;
  }
  return undefined;
}

function ruleHTTPOutcome(spans: Span[], children: Map<string, Span[]>): Finding[] {
  const out: Finding[] = [];
  for (const sp of spans) {
    if (sp.kind !== 'SERVER' || !isHTTPSpan(sp) || !isValidHTTPMethod(httpMethodRaw(sp).value)) continue;
    const path = httpPath(sp);
    if (!path && !attr(sp, 'url.full', 'http.url')) continue;
    const st = httpStatus(sp);
    if (!st.present || !validHTTPStatus(st.code) || st.code < 400) continue;
    if (st.code === 408 || st.code === 504) continue;
    const method = httpMethodRaw(sp).value;
    const op = `${method.toUpperCase()} ${path}`.trim();
    const name = httpStatusName(st.code);
    const title = name ? `HTTP ${st.code} ${name}` : `HTTP ${st.code}`;
    const evidence: TraceFailureEvidence[] = [
      { code: `http_${st.code}`, message: `SERVER ${op} returned HTTP ${st.code}.`, spanId: sp.spanId, score: 50 },
      { code: 'valid_http_method', message: `HTTP method ${method.trim()} is valid.`, spanId: sp.spanId, score: 10 },
      { code: 'valid_url_path', message: `URL path ${path} is present.`, spanId: sp.spanId, score: 10 },
      { code: 'reasonable_duration', message: `Duration ${formatDuration(sp.durationMs)} is internally consistent with an HTTP response.`, spanId: sp.spanId, score: 10 },
    ];
    let down: Span | undefined;
    for (const child of children.get(sp.spanId) || []) {
      if (child.kind === 'CLIENT') {
        const cst = httpStatus(child);
        down = findDownstream5xx(child, children, sp.serviceName);
        if (!down && cst.present && cst.code >= 500) down = child;
      } else {
        down = findDownstream5xx(child, children, sp.serviceName);
      }
      if (down) break;
    }
    if (down) {
      const dst = httpStatus(down).code;
      evidence.push({ code: 'downstream_5xx', message: `Downstream span ${down.serviceName} returned HTTP ${dst}.`, spanId: down.spanId, score: 15 });
      out.push({
        classification: 'DOWNSTREAM_ERROR',
        score: 85,
        title,
        summary: `Application request failed because downstream service returned HTTP ${dst}.`,
        evidence,
        causes: [`A downstream service returned HTTP ${dst}; this service propagated the failure.`, "Inspect the downstream service's own logs and traces for the application-level cause."],
        spanIds: [sp.spanId, down.spanId],
        rules: ['downstream_5xx'],
        priority: 80,
      });
      continue;
    }
    const clientErr = st.code >= 400 && st.code < 500;
    out.push({
      classification: clientErr ? 'CLIENT_ERROR' : 'APPLICATION_ERROR',
      score: clientErr ? 70 : 80,
      title,
      summary: `The target service returned HTTP ${st.code} for ${op}.`,
      evidence,
      causes: [clientErr ? `The server rejected the request with HTTP ${st.code}.` : `The application itself returned HTTP ${st.code}.`],
      spanIds: [sp.spanId],
      rules: [clientErr ? 'http_4xx' : 'http_5xx'],
      priority: 70,
    });
  }
  return out;
}

function ruleDuplicates(spans: Span[]): Finding[] {
  const groups = new Map<string, Span[]>();
  for (const sp of spans) {
    if ((sp.kind !== 'SERVER' && sp.kind !== 'CLIENT') || !isHTTPSpan(sp)) continue;
    const op = `${httpMethodRaw(sp).value.toUpperCase()} ${httpPath(sp)} ${attr(sp, 'url.full', 'http.url')}`.trim();
    if (!op) continue;
    const key = `${sp.kind}|${sp.serviceName}|${op}|${sp.parentSpanId || ''}`;
    const list = groups.get(key) || [];
    list.push(sp);
    groups.set(key, list);
  }
  const out: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const start = Math.max(new Date(a.startTime).getTime(), new Date(b.startTime).getTime());
        const end = Math.min(new Date(a.endTime).getTime(), new Date(b.endTime).getTime());
        const overlap = end - start;
        const minDur = Math.min(a.durationMs, b.durationMs);
        if (overlap <= 0 || (minDur > 0 && overlap / minDur < 0.5)) continue;
        const ratio = a.durationMs <= 0 || b.durationMs <= 0 ? 1 : Math.max(a.durationMs, b.durationMs) / Math.min(a.durationMs, b.durationMs);
        if (ratio > 2) continue;
        out.push({
          classification: 'DUPLICATE_INSTRUMENTATION',
          score: 60,
          title: a.kind === 'SERVER' ? 'Duplicate SERVER spans' : 'Duplicate CLIENT spans',
          summary: 'Two spans represent the same HTTP operation with overlapping timestamps and the same parent. This is consistent with duplicate instrumentation, not two real calls.',
          evidence: [
            { code: 'duplicate_operation', message: `Repeated operation on service ${a.serviceName}.`, spanId: a.spanId, score: 30 },
            { code: 'overlapping_timestamps', message: 'The duplicate spans overlap in time rather than running as sequential retries.', spanId: b.spanId, score: 20 },
          ],
          causes: ['The same HTTP library was instrumented twice (auto-instrumentation plus a manual wrapper).', 'Two exporters or sidecars recorded the same operation.'],
          spanIds: [a.spanId, b.spanId],
          rules: [a.kind === 'SERVER' ? 'duplicate_server_spans' : 'duplicate_client_spans'],
          priority: 50,
        });
      }
    }
  }
  return out;
}

function ruleTraceContext(spans: Span[], byId: Map<string, Span>): Finding[] {
  const out: Finding[] = [];
  for (const sp of spans) {
    if (isRootParent(sp.parentSpanId) || !sp.parentSpanId) continue;
    const parent = byId.get(sp.parentSpanId);
    if (!parent) {
      out.push({
        classification: 'TRACE_CONTEXT_ANOMALY',
        score: 50,
        title: 'Missing parent span',
        summary: `Span ${sp.name} references parent ${sp.parentSpanId}, which is not present in this trace.`,
        evidence: [{ code: 'missing_parent', message: `Parent span ${sp.parentSpanId} was not captured.`, spanId: sp.spanId, score: 50 }],
        causes: ['The parent span was sampled out, dropped, or never exported.', 'Trace context was propagated without the corresponding parent span.'],
        spanIds: [sp.spanId],
        rules: ['missing_parent'],
        priority: 40,
      });
      continue;
    }
    const childStart = new Date(sp.startTime).getTime();
    const childEnd = new Date(sp.endTime).getTime();
    const parentEnd = new Date(parent.endTime).getTime();
    if (childStart > parentEnd + 5) {
      out.push({
        classification: 'TRACE_CONTEXT_ANOMALY',
        score: 55,
        title: 'Impossible parent/child timing',
        summary: `Child span ${sp.name} starts after parent ${parent.name} has already ended.`,
        evidence: [{ code: 'child_starts_after_parent_end', message: `Child start is after parent end.`, spanId: sp.spanId, score: 55 }],
        causes: ['Clock skew between processes, or a broken parent/child relationship.', 'The child was attached to the wrong parent span.'],
        spanIds: [parent.spanId, sp.spanId],
        rules: ['broken_parent_child_timing'],
        priority: 40,
      });
    } else if (childEnd > parentEnd + 50) {
      out.push({
        classification: 'TRACE_CONTEXT_ANOMALY',
        score: 45,
        title: 'Child ends outside parent lifetime',
        summary: `Child span ${sp.name} ends well after parent ${parent.name} finished.`,
        evidence: [{ code: 'child_ends_outside_parent', message: 'Child end is after parent end.', spanId: sp.spanId, score: 45 }],
        causes: ['The parent span closed before the child finished, which is inconsistent with a real causal wait.', 'Clock skew or an instrumentation lifecycle bug.'],
        spanIds: [parent.spanId, sp.spanId],
        rules: ['broken_parent_child_timing'],
        priority: 40,
      });
    }
  }
  return out;
}

export function classificationLabel(classification: string): string {
  switch (classification) {
    case 'APPLICATION_ERROR': return 'Application Error';
    case 'CLIENT_ERROR': return 'Client Error';
    case 'DOWNSTREAM_ERROR': return 'Downstream Error';
    case 'NETWORK_ERROR': return 'Network Error';
    case 'TIMEOUT': return 'Timeout';
    case 'INSTRUMENTATION_ANOMALY': return 'Instrumentation Anomaly';
    case 'TRACE_CONTEXT_ANOMALY': return 'Trace Context Anomaly';
    case 'DUPLICATE_INSTRUMENTATION': return 'Duplicate Instrumentation';
    default: return 'Unknown';
  }
}

function livePlanFor(classification: Classification): TraceFailureDiagnosis['live'] {
  switch (classification) {
    case 'INSTRUMENTATION_ANOMALY':
    case 'TRACE_CONTEXT_ANOMALY':
    case 'DUPLICATE_INSTRUMENTATION':
      return { recommended: false, maxLevel: 0, reason: 'Kubernetes verification not required: telemetry is internally sufficient' };
    case 'UNKNOWN':
      return { recommended: false, maxLevel: 0, reason: 'Live probes would not explain this span; telemetry is already inconclusive' };
    case 'CLIENT_ERROR':
      return { recommended: true, maxLevel: 1, reason: 'HTTP 4xx is explained by telemetry; confirm the target workload still exists' };
    case 'APPLICATION_ERROR':
    case 'DOWNSTREAM_ERROR':
      return { recommended: true, maxLevel: 3, reason: 'Confirm the recorded HTTP failure from the same workload context' };
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return { recommended: true, maxLevel: 3, reason: 'Telemetry suggests transport or infrastructure; verify from the source workload' };
    default:
      return { recommended: false, maxLevel: 0, reason: 'Kubernetes verification not required' };
  }
}
