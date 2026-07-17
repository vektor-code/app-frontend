export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, string>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceName: string;
  namespace: string;
  podName?: string;
  nodeName?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  statusCode?: number;
  kind: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
  attributes?: Record<string, string>;
  events?: SpanEvent[];
  error?: string;
}

export interface Trace {
  traceId: string;
  rootSpan?: Span;
  spans: Span[];
  namespace: string;
  serviceName: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
}

export interface TraceListItem {
  traceId: string;
  serviceName: string;
  namespace: string;
  namespaces?: string[];
  rootName: string;
  startTime: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
  services?: string[];
  thirdPartyTools?: string[];
  serviceFlow?: string[];
  errorType?: string;
  errorSummary?: string;
}

export interface EndpointStat {
  serviceName: string;
  operationName: string;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface TimeseriesBucket {
  time: string;
  label: string;
  spans: number;
  errors: number;
  avgMs: number;
  p99Ms: number;
  dbCalls: number;
  dbAvgMs: number;
}

export interface ServiceErrorSeries {
  service: string;
  namespace: string;
  errors: number[];
  spans: number[];
}

export interface TimeseriesData {
  buckets: TimeseriesBucket[];
  serviceErrors: ServiceErrorSeries[] | null;
  windowMinutes: number;
}

export interface DiagnosticReport {
  traceId: string;
  rootCauseSpanId?: string;
  rootCauseService?: string;
  rootCauseMessage?: string;
  bottleneckSpanId: string;
  bottleneckService: string;
  bottleneckDurationMs: number;
  bottleneckPercent: number;
  summary: string;
  issues: string[];
  remediations: string[];
}

export interface DatabaseQueryMetric {
  query: string;
  system: string;
  service: string;
  namespace: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  maxDurationMs: number;
  recentErrors?: string[];
}
