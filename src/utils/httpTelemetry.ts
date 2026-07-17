const HTTP_METHOD_ALIASES: Record<string, string> = {
  GET: 'GET',
  GE: 'GET',
  POST: 'POST',
  POS: 'POST',
  PST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  DEL: 'DELETE',
  DELE: 'DELETE',
  PATCH: 'PATCH',
  PAT: 'PATCH',
  PTCH: 'PATCH',
  HEAD: 'HEAD',
  HEA: 'HEAD',
  OPTIONS: 'OPTIONS',
  OPT: 'OPTIONS',
  OPTS: 'OPTIONS',
  CONNECT: 'CONNECT',
  CON: 'CONNECT',
  TRACE: 'TRACE',
  TRC: 'TRACE',
};

export function normalizeHttpMethod(value: unknown): string {
  if (value == null) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const token = raw
    .replace(/^HTTP\s+/i, '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase();

  return HTTP_METHOD_ALIASES[token] || token || raw.toUpperCase();
}

export function isHttpMethodAttribute(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === 'http.method' || normalized === 'http.request.method' || normalized === 'request.method';
}
