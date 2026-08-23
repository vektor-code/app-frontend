const GARBAGE_OPERATION_NAMES = new Set([
  'nosniff',
  'no-sniff',
  'no-store',
  'no-cache',
  'must-revalidate',
  'private',
  'public',
  'same-origin',
  'same-site',
  'cross-origin',
  'keep-alive',
  'chunked',
  'gzip',
  'deflate',
  'gzip, br',
  'gzip, deflate',
  'gzip, deflate, br',
  'cors',
]);

const MIME_TYPES = new Set([
  'application',
  'audio',
  'font',
  'image',
  'message',
  'model',
  'multipart',
  'text',
  'video',
]);

export function sanitizeOperationName(name: string): string {
  if (!name) return '';
  return name.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isGarbageOperationName(name: string): boolean {
  const cleaned = sanitizeOperationName(name);
  if (!cleaned) return true;
  const lower = cleaned.toLowerCase();
  if (GARBAGE_OPERATION_NAMES.has(lower)) return true;
  const slash = cleaned.indexOf('/');
  if (slash > 0 && !cleaned.startsWith('/') && !cleaned.includes(' ')) {
    return MIME_TYPES.has(cleaned.slice(0, slash).toLowerCase());
  }
  return false;
}

export function displayOperationName(name: string, fallback = 'Unnamed operation'): string {
  const cleaned = sanitizeOperationName(name);
  if (!cleaned || isGarbageOperationName(cleaned)) return fallback;
  return cleaned;
}
