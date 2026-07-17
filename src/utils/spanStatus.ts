import type { Span } from '../entities';

export function isSpanError(span: Span | null | undefined): boolean {
  if (!span) return false;
  const statusCode = span.statusCode as unknown;
  const attributes = span.attributes as Record<string, unknown> | undefined;

  return (
    span.status === 'ERROR' ||
    statusCode === 'ERROR' ||
    statusCode === 2 ||
    statusCode === '2' ||
    !!span.error ||
    attributes?.['error'] === 'true' ||
    attributes?.['error'] === true ||
    attributes?.['failed'] === 'true' ||
    attributes?.['failed'] === true ||
    (span.events?.some((event) => event.name === 'exception') ?? false)
  );
}
