/** Keys / patterns that must never be shown raw in the Failure drawer. */
const SENSITIVE_KEY_RE =
  /(authorization|api[_-]?key|x-api-key|cookie|set-cookie|secret|password|passwd|token|bearer|private[_-]?key|access[_-]?key)/i;

const SENSITIVE_VALUE_RE =
  /(?:^|[\s"'])(?:api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi;

export function isSensitiveAttrKey(key: string): boolean {
  return SENSITIVE_KEY_RE.test(key);
}

export function redactSecretText(value: string): string {
  if (!value) return value;
  return value
    .replace(SENSITIVE_VALUE_RE, (match) => {
      const sep = match.includes('=') ? '=' : match.includes(':') ? ':' : ' ';
      const prefix = match.split(/[:=]/)[0] || match;
      return `${prefix.trim()}${sep} [redacted]`;
    })
    .replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
}

export function redactEvidencePair(key: string, value: string): [string, string] {
  if (isSensitiveAttrKey(key)) {
    return [key, '[redacted]'];
  }
  return [key, redactSecretText(value)];
}

export function redactEvidenceList(pairs: [string, string][]): [string, string][] {
  return pairs.map(([k, v]) => redactEvidencePair(k, v));
}
