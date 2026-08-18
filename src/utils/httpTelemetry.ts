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

const HTTP_STATUS_KEYS = ['http.response.status_code', 'http.status_code', 'http.status'] as const;

export interface HttpStatusRead {
  code: number;
  present: boolean;
  raw: string;
}

/** Read HTTP status without treating 0 as "missing" — 0 is an invalid recorded code. */
export function readHttpStatus(attrs?: Record<string, unknown> | null): HttpStatusRead {
  if (!attrs) return { code: 0, present: false, raw: '' };
  for (const key of HTTP_STATUS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    const raw = String((attrs as Record<string, unknown>)[key] ?? '').trim();
    if (raw === '') return { code: 0, present: true, raw: '' };
    const code = Number.parseInt(raw, 10);
    if (Number.isNaN(code)) return { code: 0, present: true, raw };
    return { code, present: true, raw };
  }
  return { code: 0, present: false, raw: '' };
}

export function isValidHttpStatus(code: number): boolean {
  return code >= 100 && code <= 599;
}

export function isHttpStatusAttribute(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized === 'http.response.status_code' || normalized === 'http.status_code' || normalized === 'http.status';
}

/** Prefer a real HTTP status over an invalid recorded 0 when collapsing tags. */
export function preferHttpStatusTag(existing: string | undefined, next: string): string {
  if (existing == null || existing === '') return next;
  const existingCode = Number.parseInt(existing, 10);
  const nextCode = Number.parseInt(next, 10);
  const existingOk = Number.isFinite(existingCode) && isValidHttpStatus(existingCode);
  const nextOk = Number.isFinite(nextCode) && isValidHttpStatus(nextCode);
  if (existingOk && !nextOk) return existing;
  return next;
}
