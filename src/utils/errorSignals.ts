/** Runtime-agnostic failure signals for Go, Java, Node, Python, .NET, PHP, Ruby. */

function containsAny(s: string, needles: string[]): boolean {
  if (!s) return false;
  return needles.some(n => n && s.includes(n));
}

export function isTimeoutSignal(text: string): boolean {
  const s = text.toLowerCase();
  return containsAny(s, [
    'timeout', 'timed out', 'timedout', 'etimedout',
    'deadline exceeded', 'deadline_exceeded', 'context deadline',
    'i/o timeout', 'io timeout',
    'taskcanceled', 'task canceled', 'task cancelled',
    'operation timed out', 'connect timed out', 'read timed out',
    'curl error 28', 'curl: (28)',
    'und_err_connect_timeout', 'und_err_headers_timeout', 'und_err_body_timeout',
    'net::opentimeout', 'net::readtimeout',
  ]);
}

export function isResetSignal(text: string): boolean {
  const s = text.toLowerCase();
  return containsAny(s, [
    'connection reset', 'econnreset', 'connectionreset',
    'broken pipe', 'epipe',
    'connection aborted', 'econnaborted',
  ]) || (s.includes('wsarecv') && s.includes('reset'));
}

export function isRefusedSignal(text: string): boolean {
  const s = text.toLowerCase();
  if (containsAny(s, [
    'connection refused', 'connectionrefused', 'econnrefused', 'connectexception',
    'no such host', 'unknownhost', 'unknown host',
    'enotfound', 'eai_again', 'eai_nodata', 'eai_noname',
    'host unreachable', 'network is unreachable', 'no route to host',
    'nodename nor servname', 'name or service not known',
    'getaddrinfo', 'failed to lookup', 'name resolution',
    'curl error 6', 'curl: (6)', 'curl error 7', 'curl: (7)',
    'newconnectionerror', 'unable to connect', 'could not connect',
    'connectionerror',
    'errno::econnrefused', 'errno::ehostunreach',
    'dial tcp', 'dial udp',
  ])) return true;
  return s.includes('refused') && (s.includes('connection') || s.includes('connect'));
}

export function isHTTPLibraryName(lib: string): boolean {
  const s = lib.toLowerCase();
  if (!s) return false;
  return containsAny(s, [
    '/http', 'instrumentation-http', 'instrumentation.http', 'net/http',
    'tomcat', 'servlet', 'jetty', 'undertow',
    'spring-web', 'spring-webmvc', 'spring-webflux',
    'okhttp', 'apache-httpclient', 'apache-httpasyncclient', 'java-http-client',
    'reactor-netty',
    'aspnetcore',
    'flask', 'django', 'fastapi', 'starlette', 'aiohttp', 'httpx', 'urllib3', 'wsgi', 'asgi',
    'express', 'fastify', 'koa', 'hapi', 'undici', 'nextjs', 'nestjs',
    'rack', 'sinatra', 'faraday', 'net::http', 'action_pack',
    'laravel', 'symfony', 'guzzle', 'php.auto',
    'requests',
  ]) || s.endsWith('.http');
}

export function isConnectSpanName(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (!n) return false;
  if (n === 'connect' || n.endsWith('.connect')) return true;
  return containsAny(n, [
    'tcp.connect', 'tls.connect', 'ssl.connect', 'ssl.handshake',
    'net.connect', 'socket.connect', 'httpclient.connect',
    'dns.lookup', 'dns.resolve',
  ]);
}

export function grpcStatusName(code: number): string {
  const names: Record<number, string> = {
    1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED',
    5: 'NOT_FOUND', 6: 'ALREADY_EXISTS', 7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED',
    9: 'FAILED_PRECONDITION', 10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED',
    13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED',
  };
  return names[code] || '';
}
