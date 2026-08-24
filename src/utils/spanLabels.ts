import type { Span } from '../entities';
import { getQuerySummary } from './dependency';
import { normalizeHttpMethod } from './httpTelemetry';
import { displayOperationName } from './operationName';

export function getSpanOperationLabel(span: Span) {
  const attrs = span.attributes || {};
  const method = normalizeHttpMethod(attrs['http.request.method'] || attrs['http.method']);
  const path = attrs['http.route'] || attrs['url.path'] || attrs['http.target'] || attrs['url.full'] || attrs['http.url'];
  if (method && path) return `${method} ${path}`;
  if (method) return method;

  const dbSummary = getQuerySummary(attrs);
  if (dbSummary) return dbSummary;

  const rpcMethod = attrs['rpc.method'];
  if (rpcMethod) return String(rpcMethod);

  return displayOperationName(span.name);
}

export function getErrorCategoryLabel(category: string) {
  switch (category) {
    case 'http':
      return 'HTTP response';
    case 'db':
      return 'Database';
    case 'messaging':
      return 'Messaging';
    case 'timeout':
      return 'Timeout';
    case 'connection':
      return 'Connection';
    case 'rpc':
      return 'RPC / gRPC';
    case 'exception':
      return 'Exception';
    default:
      return 'Application';
  }
}
