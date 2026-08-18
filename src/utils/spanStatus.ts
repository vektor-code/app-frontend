import type { Span } from '../entities';
import { isValidHttpStatus, readHttpStatus } from './httpTelemetry';

/** CLIENT recorded HTTP 0 / garbage status: transport failed even if OTel status is UNSET. */
export function isMissingHttpResponse(span: Span | null | undefined): boolean {
  if (!span || span.kind !== 'CLIENT') return false;
  const status = readHttpStatus(span.attributes);
  return status.present && !isValidHttpStatus(status.code);
}

export function isSpanError(span: Span | null | undefined): boolean {
  if (!span) return false;
  const statusCode = span.statusCode as unknown;
  const attributes = span.attributes as Record<string, unknown> | undefined;

  return (
    isMissingHttpResponse(span) ||
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
