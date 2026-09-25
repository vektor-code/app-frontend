import type { Span } from '../entities';

const TRACE_ID_HEX_LEN = 32;
const SPAN_ID_HEX_LEN = 16;

/** ClickHouse payloads expose tags alongside attributes; Span type only declares attributes. */
type SpanWithTags = Span & { tags?: Record<string, string> };

function readSpanTags(span: Span): Record<string, string> {
  return (span as SpanWithTags).tags ?? {};
}

function attrOrTag(span: Span, key: string): string | undefined {
  const val = span.attributes?.[key] ?? readSpanTags(span)[key];
  if (val == null) return undefined;
  const trimmed = String(val).trim();
  return trimmed || undefined;
}

/** Mirrors api-backend/shared/w3c/traceparent.go normalizeID. */
function normalizeHexId(id: string, width: number): string | undefined {
  const normalized = id.toLowerCase().trim();
  if (!normalized || normalized.length > width) return undefined;

  let allZero = true;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if ((c >= '1' && c <= '9') || (c >= 'a' && c <= 'f')) {
      allZero = false;
    } else if (c !== '0') {
      return undefined;
    }
  }
  if (allZero) return undefined;

  return normalized.length < width
    ? '0'.repeat(width - normalized.length) + normalized
    : normalized;
}

function traceFlagsFromAttrs(span: Span): string {
  const raw = attrOrTag(span, 'w3c.trace_flags');
  if (raw && /^[0-9a-fA-F]{2}$/.test(raw)) {
    return raw.toLowerCase();
  }
  // Stored spans were sampled; unset flags should not read as "not sampled".
  return '01';
}

function formatTraceparent(traceId: string, spanId: string, flags: string): string | undefined {
  const trace = normalizeHexId(traceId, TRACE_ID_HEX_LEN);
  const span = normalizeHexId(spanId, SPAN_ID_HEX_LEN);
  if (!trace || !span) return undefined;
  return `00-${trace}-${span}-${flags}`;
}

function capturedTraceparentHeader(span: Span): string | undefined {
  const attrs = span.attributes ?? {};

  const direct = attrs['http.request.header.traceparent'];
  if (direct != null && String(direct).trim()) return String(direct).trim();

  // Header attribute suffixes may use underscores where the wire name uses hyphens.
  for (const [k, v] of Object.entries(attrs)) {
    if (!k.startsWith('http.request.header.')) continue;
    const headerName = k.slice('http.request.header.'.length).replace(/_/g, '-').toLowerCase();
    if (headerName === 'traceparent' && v != null && String(v).trim()) {
      return String(v).trim();
    }
  }
  return undefined;
}

/**
 * Resolve the W3C traceparent for display/copy. Prefers ingest-stored and
 * wire-captured values over re-formatting span IDs so the UI never overwrites
 * real propagation context with a broken synthetic header.
 */
export function resolveTraceparent(span: Span): string | undefined {
  const fromTag = attrOrTag(span, 'w3c.traceparent');
  if (fromTag) return fromTag;

  const fromHeader = capturedTraceparentHeader(span);
  if (fromHeader) return fromHeader;

  return formatTraceparent(span.traceId, span.spanId, traceFlagsFromAttrs(span));
}
