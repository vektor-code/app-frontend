export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, string>;
}

export interface SpanLink {
  traceId?: string;
  spanId?: string;
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
  links?: SpanLink[];
  error?: string;
}

export type TraceFailureClassification =
  | 'APPLICATION_ERROR'
  | 'CLIENT_ERROR'
  | 'DOWNSTREAM_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INSTRUMENTATION_ANOMALY'
  | 'TRACE_CONTEXT_ANOMALY'
  | 'DUPLICATE_INSTRUMENTATION'
  | 'UNKNOWN';

export type TraceFailureConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TraceFailureEvidence {
  code: string;
  message: string;
  spanId?: string;
  score?: number;
}

export interface TraceFailureLivePlan {
  recommended: boolean;
  maxLevel: number;
  reason: string;
}

export interface TraceFailureDiagnosis {
  traceId: string;
  classification: TraceFailureClassification;
  severity: TraceFailureConfidence;
  confidence: TraceFailureConfidence;
  confidenceScore: number;
  title: string;
  summary: string;
  evidence: TraceFailureEvidence[];
  likelyCauses: string[];
  affectedSpanIds: string[];
  rules?: string[];
  spanTree?: 'complete' | 'broken';
  live?: TraceFailureLivePlan;
}

export interface TraceInvestigationCheck {
  level: number;
  code: string;
  ok: boolean;
  detail: string;
  pod?: string;
  cached?: boolean;
}

export interface TraceInvestigationObservation {
  kind: 'observed' | 'inference';
  code: string;
  message: string;
  level?: number;
  ok?: boolean;
  pod?: string;
  hop?: string;
}

export interface TraceInvestigation {
  traceId: string;
  status: 'skipped' | 'pending' | 'complete' | 'partial' | 'unavailable' | 'rate_limited' | 'expired';
  levelReached: number;
  skipReason?: string;
  conclusion?: string;
  inference?: string;
  originalState?: string;
  currentState?: string;
  confidence?: string;
  observations?: TraceInvestigationObservation[];
  checks?: TraceInvestigationCheck[];
  cached?: boolean;
  cacheKey?: string;
  fingerprint?: string;
  durationMs?: number;
  referencedBy?: number;
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
  /** Derived by the Trace Failure Analyzer. Never written back onto spans. */
  failureDiagnosis?: TraceFailureDiagnosis;
}

export interface TraceListItem {
  traceId: string;
  serviceName: string;
  namespace: string;
  namespaces?: string[];
  rootName: string;
  /** Stable endpoint identity (method + route). Prefer this over rootName in lists. */
  transactionName?: string;
  startTime: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
  services?: string[];
  thirdPartyTools?: string[];
  serviceFlow?: string[];
  errorType?: string;
  errorSummary?: string;
  /** The trace's real root span was never stored — what is shown starts
   *  part-way through the request. */
  partial?: boolean;
}

export interface EndpointStat {
  serviceName: string;
  /** Namespace of the endpoint's root service, so the same service name in
   *  different namespaces stays distinct. */
  namespace?: string;
  /** Stable endpoint identity — a templated route where the instrumentation
   *  provides one, otherwise the request path with ids replaced. */
  operationName: string;
  /** Weighted by the sampling factor, so it estimates real traffic. */
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  /** Traces actually stored. Below `count` when sampling was active, which
   *  makes `count` an estimate rather than an exact figure. */
  sampledCount?: number;
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

export interface LatencyBucket {
  label: string;
  upperMs: number;
  count: number;
}

export interface LatencyDistribution {
  buckets: LatencyBucket[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  total: number;
  windowMinutes: number;
}

export interface InfraPod {
  name: string;
  namespace: string;
  node: string;
  phase: string;
  cpuUsage: number;
  cpuLimit: number;
  memUsage: number;
  memLimit: number;
  cpuPct: number;
  memPct: number;
  restarts: number;
  oomRisk: boolean;
  cpuThrottle: boolean;
}

export interface InfraNamespace {
  namespace: string;
  pods: number;
  cpuUsage: number;
  memUsage: number;
  restarts: number;
  atRisk: number;
}

export interface InfraNode {
  name: string;
  role: string;
  pods: number;
  namespaces: number;
  cpuUsage: number;
  cpuCapacity: number;
  cpuAllocatable: number;
  totalCpuUsage: number;
  cpuPct: number;
  memUsage: number;
  memCapacity: number;
  memAllocatable: number;
  totalMemUsage: number;
  memPct: number;
  podCapacity: number;
  podAllocatable: number;
  podPct: number;
  restarts: number;
  atRisk: number;
  metricsAvailable: boolean;
}

export interface InfraSummary {
  pods: number;
  nodes: number;
  namespaces: number;
  cpuUsage: number;
  cpuLimit: number;
  cpuCapacity: number;
  cpuAllocatable: number;
  totalCpuUsage: number;
  memUsage: number;
  memLimit: number;
  memCapacity: number;
  memAllocatable: number;
  totalMemUsage: number;
  podCapacity: number;
  podAllocatable: number;
  restarts: number;
  atRisk: number;
  metricsAvailable: boolean;
}

export interface InfrastructureMetrics {
  summary: InfraSummary;
  namespaces: InfraNamespace[];
  nodes: InfraNode[];
  pods: InfraPod[];
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
  /** Hash of the query with literals removed. Rows are grouped by this, so
   *  "WHERE id = 1" and "WHERE id = 2" are one row rather than two. */
  fingerprint: string;
  /** A representative statement for the shape, with literals replaced by "?". */
  query: string;
  /** Low-cardinality label such as "SELECT orders" (db.query.summary). */
  summary?: string;
  system: string;
  operation?: string;
  collection?: string;
  databaseName?: string;
  service: string;
  namespace: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  maxDurationMs: number;
  /** Call count times average latency — the ranking that matters
   *  operationally, since a fast query run constantly outweighs a slow one
   *  run twice. */
  totalDurationMs: number;
  recentErrors?: string[];
}

export interface ErrorGroup {
  fingerprint: string;
  namespace: string;
  serviceName: string;
  transactionName?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  dbFingerprint?: string;
  exampleTraceId?: string;
  count: number;
  lastSeen: string;
}
