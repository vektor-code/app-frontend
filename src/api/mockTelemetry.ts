import type {
  DatabaseQueryMetric,
  EndpointStat,
  InfraNode,
  InfraPod,
  InfrastructureMetrics,
  LatencyDistribution,
  NamespaceStats,
  ServiceErrorSeries,
  ServiceStats,
  Span,
  TimeseriesBucket,
  TimeseriesData,
  Trace,
  TraceInvestigation,
  TraceListItem,
} from '../entities';

const WINDOW_MINUTES = 60;
const BUCKETS = 12;

function hourBuckets(): { time: string; label: string }[] {
  const now = Date.now();
  const step = (WINDOW_MINUTES / BUCKETS) * 60_000;
  return Array.from({ length: BUCKETS }, (_, i) => {
    const d = new Date(now - (BUCKETS - 1 - i) * step);
    return {
      time: d.toISOString(),
      label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  });
}

function wave(index: number, base: number, amp: number, phase = 0) {
  return Math.max(0, Math.round(base + Math.sin((index / 3) + phase) * amp));
}

const SERVICES: Array<Omit<ServiceStats, 'lastSeen'> & { lastSeen?: string }> = [
  {
    serviceName: 'checkout-api',
    namespace: 'production',
    cluster: 'eu-west-1',
    requestCount: 18420,
    errorCount: 214,
    errorRate: 1.16,
    p50Ms: 38,
    p95Ms: 142,
    p99Ms: 620,
    healthScore: 78,
    apdex: 0.89,
    status: 'degraded',
    language: 'go',
  },
  {
    serviceName: 'gateway',
    namespace: 'production',
    cluster: 'eu-west-1',
    requestCount: 41280,
    errorCount: 38,
    errorRate: 0.09,
    p50Ms: 12,
    p95Ms: 44,
    p99Ms: 96,
    healthScore: 96,
    apdex: 0.98,
    status: 'healthy',
    language: 'go',
  },
  {
    serviceName: 'identity',
    namespace: 'production',
    cluster: 'eu-west-1',
    requestCount: 22140,
    errorCount: 6,
    errorRate: 0.03,
    p50Ms: 8,
    p95Ms: 21,
    p99Ms: 48,
    healthScore: 98,
    apdex: 0.99,
    status: 'healthy',
    language: 'go',
  },
  {
    serviceName: 'cart-service',
    namespace: 'production',
    cluster: 'eu-west-1',
    requestCount: 15680,
    errorCount: 44,
    errorRate: 0.28,
    p50Ms: 22,
    p95Ms: 68,
    p99Ms: 180,
    healthScore: 91,
    apdex: 0.95,
    status: 'healthy',
    language: 'java',
  },
  {
    serviceName: 'payments',
    namespace: 'production',
    cluster: 'eu-west-1',
    requestCount: 9340,
    errorCount: 312,
    errorRate: 3.34,
    p50Ms: 86,
    p95Ms: 410,
    p99Ms: 1480,
    healthScore: 62,
    apdex: 0.78,
    status: 'critical',
    language: 'java',
  },
  {
    serviceName: 'notifications',
    namespace: 'staging',
    cluster: 'eu-west-1',
    requestCount: 2180,
    errorCount: 2,
    errorRate: 0.09,
    p50Ms: 18,
    p95Ms: 54,
    p99Ms: 110,
    healthScore: 97,
    apdex: 0.97,
    status: 'healthy',
    language: 'node',
  },
];

function withSeen(service: (typeof SERVICES)[number]): ServiceStats {
  return {
    ...service,
    lastSeen: new Date(Date.now() - 12_000).toISOString(),
  };
}

function scopedServices(namespace?: string) {
  return SERVICES.filter((service) => !namespace || service.namespace === namespace).map(withSeen);
}

export function mockClusters() {
  return { clusters: [{ name: 'eu-west-1', displayName: 'eu-west-1', status: 'healthy' }] };
}

export function mockNamespaces(cluster?: string) {
  const names = [...new Set(SERVICES.filter((s) => !cluster || s.cluster === cluster).map((s) => s.namespace))];
  return { namespaces: names };
}

export function mockStats(namespace?: string): { namespaces: NamespaceStats[] } {
  const grouped = new Map<string, ServiceStats[]>();
  for (const service of scopedServices(namespace)) {
    const list = grouped.get(service.namespace) || [];
    list.push(service);
    grouped.set(service.namespace, list);
  }
  const namespaces: NamespaceStats[] = [...grouped.entries()].map(([name, services]) => {
    const requestCount = services.reduce((sum, s) => sum + s.requestCount, 0);
    const errorCount = services.reduce((sum, s) => sum + s.errorCount, 0);
    return {
      namespace: name,
      cluster: services[0]?.cluster,
      traceCount: requestCount,
      errorCount,
      errorRate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
      avgDurationMs: services.reduce((sum, s) => sum + s.p50Ms * s.requestCount, 0) / Math.max(requestCount, 1),
      services,
      podCount: services.length * 3,
      lastActivity: new Date().toISOString(),
    };
  });
  return { namespaces };
}

export function mockTimeseries(namespace?: string, minutes = WINDOW_MINUTES): TimeseriesData {
  const labels = hourBuckets();
  const services = scopedServices(namespace);
  const buckets: TimeseriesBucket[] = labels.map((slot, i) => {
    const spans = wave(i, 980, 220, 0.4) + (i === 8 ? 340 : 0);
    const errors = i === 8 ? 42 : wave(i, 4, 3, 1.7);
    const avgMs = wave(i, 36, 8, 0.2);
    const p99Ms = wave(i, 210, 80, 0.9) + (i === 8 ? 420 : 0);
    const dbCalls = wave(i, 310, 70, 1.1);
    const dbAvgMs = wave(i, 18, 7, 0.6) + (i === 7 ? 28 : 0);
    return { ...slot, spans, errors, avgMs, p99Ms, dbCalls, dbAvgMs };
  });

  const serviceErrors: ServiceErrorSeries[] = services.map((service, svcIdx) => ({
    service: service.serviceName,
    namespace: service.namespace,
    spans: buckets.map((bucket) => Math.round(bucket.spans * (0.08 + (svcIdx % 4) * 0.06))),
    errors: buckets.map((bucket, i) => {
      if (service.serviceName === 'payments') return i === 8 ? 28 : wave(i, 4, 2, 2);
      if (service.serviceName === 'checkout-api') return i === 8 ? 11 : wave(i, 1, 1, 0.4);
      return i === 8 ? 1 : 0;
    }),
  }));

  return { buckets, serviceErrors, windowMinutes: minutes };
}

export function mockLatencyDistribution(_namespace?: string, minutes = WINDOW_MINUTES): LatencyDistribution {
  const buckets = [
    { label: '0–10ms', upperMs: 10, count: 2140 },
    { label: '10–25ms', upperMs: 25, count: 4680 },
    { label: '25–50ms', upperMs: 50, count: 6120 },
    { label: '50–100ms', upperMs: 100, count: 2840 },
    { label: '100–250ms', upperMs: 250, count: 1260 },
    { label: '250–500ms', upperMs: 500, count: 420 },
    { label: '500ms–1s', upperMs: 1000, count: 186 },
    { label: '1–2s', upperMs: 2000, count: 74 },
    { label: '2–5s', upperMs: 5000, count: 22 },
    { label: '5s+', upperMs: 0, count: 8 },
  ];
  return {
    buckets,
    p50Ms: 38,
    p95Ms: 142,
    p99Ms: 620,
    total: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    windowMinutes: minutes,
  };
}

export function mockDatabaseMetrics(namespace?: string): { metrics: DatabaseQueryMetric[] } {
  const rows: DatabaseQueryMetric[] = [
    {
      fingerprint: 'sel-orders',
      query: 'SELECT * FROM orders WHERE user_id = ? AND created_at > ?',
      summary: 'SELECT orders',
      system: 'postgres',
      operation: 'SELECT',
      collection: 'orders',
      databaseName: 'checkout',
      service: 'checkout-api',
      namespace: 'production',
      callCount: 8420,
      errorCount: 12,
      errorRate: 0.14,
      avgDurationMs: 48,
      p95DurationMs: 180,
      p99DurationMs: 410,
      maxDurationMs: 980,
      totalDurationMs: 404160,
    },
    {
      fingerprint: 'upd-cart',
      query: 'UPDATE cart_items SET qty = ? WHERE cart_id = ?',
      summary: 'UPDATE cart_items',
      system: 'postgres',
      operation: 'UPDATE',
      collection: 'cart_items',
      databaseName: 'checkout',
      service: 'cart-service',
      namespace: 'production',
      callCount: 3180,
      errorCount: 0,
      errorRate: 0,
      avgDurationMs: 16,
      p95DurationMs: 42,
      p99DurationMs: 88,
      maxDurationMs: 140,
      totalDurationMs: 50880,
    },
    {
      fingerprint: 'ins-pay',
      query: 'INSERT INTO payments (id, amount, status) VALUES (?, ?, ?)',
      summary: 'INSERT payments',
      system: 'postgres',
      operation: 'INSERT',
      collection: 'payments',
      databaseName: 'billing',
      service: 'payments',
      namespace: 'production',
      callCount: 1960,
      errorCount: 48,
      errorRate: 2.45,
      avgDurationMs: 92,
      p95DurationMs: 340,
      p99DurationMs: 890,
      maxDurationMs: 2100,
      totalDurationMs: 180320,
    },
    {
      fingerprint: 'redis-cart',
      query: 'MGET cart:*',
      summary: 'MGET cart',
      system: 'redis',
      operation: 'MGET',
      collection: 'cart',
      service: 'cart-service',
      namespace: 'production',
      callCount: 12440,
      errorCount: 0,
      errorRate: 0,
      avgDurationMs: 3,
      p95DurationMs: 8,
      p99DurationMs: 14,
      maxDurationMs: 22,
      totalDurationMs: 37320,
    },
    {
      fingerprint: 'sel-user',
      query: 'SELECT id, email FROM users WHERE id = ?',
      summary: 'SELECT users',
      system: 'postgres',
      operation: 'SELECT',
      collection: 'users',
      databaseName: 'identity',
      service: 'identity',
      namespace: 'production',
      callCount: 22100,
      errorCount: 1,
      errorRate: 0.004,
      avgDurationMs: 4,
      p95DurationMs: 11,
      p99DurationMs: 24,
      maxDurationMs: 60,
      totalDurationMs: 88400,
    },
  ];
  return {
    metrics: rows.filter((row) => !namespace || row.namespace === namespace),
  };
}

export function mockInfrastructure(namespace?: string): InfrastructureMetrics {
  const pods: InfraPod[] = [
    { name: 'checkout-api-7f8d9c4b6-xk2n1', namespace: 'production', node: 'worker-1', phase: 'Running', cpuUsage: 620, cpuLimit: 1000, memUsage: 780, memLimit: 1024, cpuPct: 62, memPct: 76, restarts: 1, oomRisk: false, cpuThrottle: false },
    { name: 'checkout-api-7f8d9c4b6-p9q3c', namespace: 'production', node: 'worker-2', phase: 'Running', cpuUsage: 540, cpuLimit: 1000, memUsage: 710, memLimit: 1024, cpuPct: 54, memPct: 69, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'gateway-6c5b7d8f9-ab12d', namespace: 'production', node: 'worker-1', phase: 'Running', cpuUsage: 310, cpuLimit: 500, memUsage: 220, memLimit: 512, cpuPct: 62, memPct: 43, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'gateway-6c5b7d8f9-cd34e', namespace: 'production', node: 'worker-2', phase: 'Running', cpuUsage: 280, cpuLimit: 500, memUsage: 198, memLimit: 512, cpuPct: 56, memPct: 39, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'payments-5a4c3b2d1-pay01', namespace: 'production', node: 'worker-1', phase: 'Running', cpuUsage: 910, cpuLimit: 1000, memUsage: 1480, memLimit: 1536, cpuPct: 91, memPct: 96, restarts: 4, oomRisk: true, cpuThrottle: true },
    { name: 'cart-service-8e7f6a5b-c1r2t', namespace: 'production', node: 'worker-2', phase: 'Running', cpuUsage: 210, cpuLimit: 500, memUsage: 340, memLimit: 768, cpuPct: 42, memPct: 44, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'identity-4d3c2b1a-id9k2', namespace: 'production', node: 'worker-1', phase: 'Running', cpuUsage: 140, cpuLimit: 400, memUsage: 180, memLimit: 512, cpuPct: 35, memPct: 35, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'postgres-0', namespace: 'production', node: 'worker-2', phase: 'Running', cpuUsage: 1280, cpuLimit: 2000, memUsage: 4200, memLimit: 6144, cpuPct: 64, memPct: 68, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'redis-master-0', namespace: 'production', node: 'worker-1', phase: 'Running', cpuUsage: 180, cpuLimit: 500, memUsage: 640, memLimit: 1024, cpuPct: 36, memPct: 62, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'notifications-9b8a7c6d-ntf01', namespace: 'staging', node: 'worker-2', phase: 'Running', cpuUsage: 80, cpuLimit: 250, memUsage: 120, memLimit: 256, cpuPct: 32, memPct: 47, restarts: 2, oomRisk: false, cpuThrottle: false },
    { name: 'coredns-5d78c986b4-dns01', namespace: 'kube-system', node: 'master-1', phase: 'Running', cpuUsage: 40, cpuLimit: 200, memUsage: 48, memLimit: 170, cpuPct: 20, memPct: 28, restarts: 0, oomRisk: false, cpuThrottle: false },
    { name: 'coredns-5d78c986b4-dns02', namespace: 'kube-system', node: 'worker-1', phase: 'Running', cpuUsage: 36, cpuLimit: 200, memUsage: 44, memLimit: 170, cpuPct: 18, memPct: 26, restarts: 0, oomRisk: false, cpuThrottle: false },
  ];
  const scoped = pods.filter(pod => !namespace || pod.namespace === namespace);
  const nodes: InfraNode[] = [
    { name: 'master-1', role: 'control-plane', pods: scoped.filter(p => p.node === 'master-1').length, namespaces: 1, cpuUsage: 180, cpuCapacity: 4000, cpuAllocatable: 3800, totalCpuUsage: 420, cpuPct: 11, memUsage: 920, memCapacity: 8192, memAllocatable: 7600, totalMemUsage: 1100, memPct: 14, podCapacity: 110, podAllocatable: 110, podPct: 4, restarts: 0, atRisk: 0, metricsAvailable: true },
    { name: 'worker-1', role: 'worker', pods: scoped.filter(p => p.node === 'worker-1').length, namespaces: 3, cpuUsage: 2190, cpuCapacity: 8000, cpuAllocatable: 7600, totalCpuUsage: 2480, cpuPct: 33, memUsage: 3348, memCapacity: 16384, memAllocatable: 15200, totalMemUsage: 3680, memPct: 24, podCapacity: 110, podAllocatable: 110, podPct: 8, restarts: 5, atRisk: 1, metricsAvailable: true },
    { name: 'worker-2', role: 'worker', pods: scoped.filter(p => p.node === 'worker-2').length, namespaces: 2, cpuUsage: 2390, cpuCapacity: 8000, cpuAllocatable: 7600, totalCpuUsage: 2610, cpuPct: 34, memUsage: 5568, memCapacity: 16384, memAllocatable: 15200, totalMemUsage: 5920, memPct: 39, podCapacity: 110, podAllocatable: 110, podPct: 7, restarts: 2, atRisk: 0, metricsAvailable: true },
  ];
  const namespaces = [...new Set(scoped.map(pod => pod.namespace))].map(name => {
    const group = scoped.filter(pod => pod.namespace === name);
    return {
      namespace: name,
      pods: group.length,
      cpuUsage: group.reduce((sum, pod) => sum + pod.cpuUsage, 0),
      memUsage: group.reduce((sum, pod) => sum + pod.memUsage, 0),
      restarts: group.reduce((sum, pod) => sum + pod.restarts, 0),
      atRisk: group.filter(pod => pod.oomRisk || pod.cpuThrottle).length,
    };
  });
  const cpuUsage = scoped.reduce((sum, pod) => sum + pod.cpuUsage, 0);
  const memUsage = scoped.reduce((sum, pod) => sum + pod.memUsage, 0);

  return {
    summary: {
      pods: scoped.length,
      nodes: nodes.length,
      namespaces: namespaces.length,
      cpuUsage,
      cpuLimit: scoped.reduce((sum, pod) => sum + pod.cpuLimit, 0),
      cpuCapacity: 20000,
      cpuAllocatable: 19000,
      totalCpuUsage: 5510,
      memUsage,
      memLimit: scoped.reduce((sum, pod) => sum + pod.memLimit, 0),
      memCapacity: 40960,
      memAllocatable: 38000,
      totalMemUsage: 10700,
      podCapacity: 330,
      podAllocatable: 330,
      restarts: scoped.reduce((sum, pod) => sum + pod.restarts, 0),
      atRisk: scoped.filter(pod => pod.oomRisk || pod.cpuThrottle).length,
      metricsAvailable: true,
    },
    namespaces,
    nodes,
    pods: scoped,
  };
}

type MockTraceRow = TraceListItem & {
  cluster: string;
  hasBody?: boolean;
  isProbe?: boolean;
};

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function mockTraceCatalog(): MockTraceRow[] {
  return [
    {
      traceId: '4f8a2c91e0b67d3a15c84e92a7b0d1f6',
      serviceName: 'checkout-api',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /checkout',
      transactionName: 'POST /checkout',
      startTime: minutesAgo(2),
      durationMs: 1480,
      spanCount: 12,
      hasError: true,
      services: ['gateway', 'checkout-api', 'identity', 'payments'],
      serviceFlow: ['gateway', 'checkout-api', 'payments'],
      errorType: 'StatusError',
      errorSummary: 'payments returned 503 from charge',
      hasBody: true,
    },
    {
      traceId: 'a19c7e44b2d5803f6e91c0aa4d77b812',
      serviceName: 'checkout-api',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /checkout',
      transactionName: 'POST /checkout',
      startTime: minutesAgo(6),
      durationMs: 312,
      spanCount: 9,
      hasError: false,
      services: ['gateway', 'checkout-api', 'cart-service', 'payments'],
      serviceFlow: ['gateway', 'checkout-api', 'payments'],
      hasBody: true,
    },
    {
      traceId: 'c0e3b5187a924d6f11b8e4c09f35a267',
      serviceName: 'gateway',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /catalog',
      transactionName: 'GET /catalog',
      startTime: minutesAgo(4),
      durationMs: 48,
      spanCount: 4,
      hasError: false,
      services: ['gateway', 'checkout-api'],
      serviceFlow: ['gateway', 'checkout-api'],
    },
    {
      traceId: '91d6f0aa3c28e147b5c9d8320e64f1ab',
      serviceName: 'identity',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /oauth/token',
      transactionName: 'POST /oauth/token',
      startTime: minutesAgo(8),
      durationMs: 21,
      spanCount: 3,
      hasError: false,
      services: ['gateway', 'identity'],
      serviceFlow: ['gateway', 'identity'],
      hasBody: true,
    },
    {
      traceId: '7b2e9c10d4a65f83c1e80b47a92d3f06',
      serviceName: 'cart-service',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /cart/{id}',
      transactionName: 'GET /cart/{id}',
      startTime: minutesAgo(11),
      durationMs: 64,
      spanCount: 5,
      hasError: false,
      services: ['gateway', 'cart-service'],
      serviceFlow: ['gateway', 'cart-service'],
    },
    {
      traceId: 'e5a81c36f09b4d27a6c3e814b0d9527f',
      serviceName: 'payments',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /charge',
      transactionName: 'POST /charge',
      startTime: minutesAgo(3),
      durationMs: 1620,
      spanCount: 8,
      hasError: true,
      services: ['checkout-api', 'payments'],
      serviceFlow: ['checkout-api', 'payments'],
      errorType: 'Timeout',
      errorSummary: 'card issuer timed out after 1500ms',
      hasBody: true,
    },
    {
      traceId: '2d4c8e91a7b03f56c1e94a80d3b67512',
      serviceName: 'payments',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /refund',
      transactionName: 'POST /refund',
      startTime: minutesAgo(18),
      durationMs: 410,
      spanCount: 6,
      hasError: false,
      services: ['checkout-api', 'payments'],
      serviceFlow: ['checkout-api', 'payments'],
      hasBody: true,
    },
    {
      traceId: 'b8f1a0c45e297d63a1c84e09f7b2d350',
      serviceName: 'checkout-api',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /orders/{id}',
      transactionName: 'GET /orders/{id}',
      startTime: minutesAgo(14),
      durationMs: 96,
      spanCount: 7,
      hasError: false,
      services: ['gateway', 'checkout-api', 'identity'],
      serviceFlow: ['gateway', 'checkout-api'],
    },
    {
      traceId: '6a0e3d92c18b475fa9c2e104d87b5a31',
      serviceName: 'gateway',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /healthz',
      transactionName: 'GET /healthz',
      startTime: minutesAgo(1),
      durationMs: 4,
      spanCount: 1,
      hasError: false,
      services: ['gateway'],
      serviceFlow: ['gateway'],
      isProbe: true,
    },
    {
      traceId: 'd17b9e04c5a8326f0e41a98c2d75b4e8',
      serviceName: 'notifications',
      namespace: 'staging',
      namespaces: ['staging'],
      cluster: 'eu-west-1',
      rootName: 'POST /notify',
      transactionName: 'POST /notify',
      startTime: minutesAgo(9),
      durationMs: 54,
      spanCount: 4,
      hasError: false,
      services: ['notifications'],
      serviceFlow: ['notifications'],
      hasBody: true,
    },
    {
      traceId: 'f3c28a10e64d9b75a1c0e4928d37b6a5',
      serviceName: 'identity',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /session',
      transactionName: 'GET /session',
      startTime: minutesAgo(22),
      durationMs: 12,
      spanCount: 2,
      hasError: false,
      services: ['gateway', 'identity'],
      serviceFlow: ['gateway', 'identity'],
    },
    {
      traceId: '0c9a4e27b1d85360f8e2c194a7b5d03e',
      serviceName: 'cart-service',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'PUT /cart/{id}',
      transactionName: 'PUT /cart/{id}',
      startTime: minutesAgo(27),
      durationMs: 188,
      spanCount: 6,
      hasError: true,
      services: ['gateway', 'cart-service'],
      serviceFlow: ['gateway', 'cart-service'],
      errorType: 'StatusError',
      errorSummary: 'inventory returned 409 conflict',
      hasBody: true,
    },
    {
      traceId: '5e81b2d0a47c396f1c9e04a8d6b37520',
      serviceName: 'checkout-api',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'POST /checkout',
      transactionName: 'POST /checkout',
      startTime: minutesAgo(41),
      durationMs: 220,
      spanCount: 10,
      hasError: false,
      services: ['gateway', 'checkout-api', 'payments', 'notifications'],
      serviceFlow: ['gateway', 'checkout-api', 'payments'],
      hasBody: true,
    },
    {
      traceId: '8a4d1c70e2b5963f0c9e84a1d5b37f12',
      serviceName: 'gateway',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /readyz',
      transactionName: 'GET /readyz',
      startTime: minutesAgo(5),
      durationMs: 3,
      spanCount: 1,
      hasError: false,
      services: ['gateway'],
      serviceFlow: ['gateway'],
      isProbe: true,
    },
    {
      traceId: '1b7e0c94a5d2638f4e91c0a2d8b47653',
      serviceName: 'notifications',
      namespace: 'staging',
      namespaces: ['staging'],
      cluster: 'eu-west-1',
      rootName: 'POST /notify',
      transactionName: 'POST /notify',
      startTime: minutesAgo(33),
      durationMs: 410,
      spanCount: 5,
      hasError: true,
      services: ['notifications'],
      serviceFlow: ['notifications'],
      errorType: 'StatusError',
      errorSummary: 'SMTP upstream 550 mailbox unavailable',
      hasBody: true,
    },
    {
      traceId: 'c4e9a1b07d285f36a0c8e4921b75d3a6',
      serviceName: 'checkout-api',
      namespace: 'production',
      namespaces: ['production'],
      cluster: 'eu-west-1',
      rootName: 'GET /orders',
      transactionName: 'GET /orders',
      startTime: minutesAgo(52),
      durationMs: 74,
      spanCount: 5,
      hasError: false,
      services: ['gateway', 'checkout-api'],
      serviceFlow: ['gateway', 'checkout-api'],
    },
  ];
}

function publicTrace(row: MockTraceRow): TraceListItem {
  const { cluster: _cluster, hasBody: _hasBody, isProbe: _isProbe, ...item } = row;
  return item;
}

function matchesTraceParams(row: MockTraceRow, params?: Record<string, string>): boolean {
  if (!params) return !row.isProbe;
  if (params.namespace && row.namespace !== params.namespace) return false;
  if (params.cluster && row.cluster !== params.cluster) return false;
  if (params.service && row.serviceName !== params.service && !(row.services || []).includes(params.service)) {
    return false;
  }
  if (params.hasError === 'true' && !row.hasError) return false;
  if (params.hasError === 'false' && row.hasError) return false;
  if (params.operation) {
    const query = params.operation.toLowerCase();
    const haystack = `${row.rootName} ${row.transactionName || ''} ${row.serviceName}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (params.traceId) {
    const needle = params.traceId.replace(/-/g, '').toLowerCase();
    if (!row.traceId.toLowerCase().includes(needle)) return false;
  }
  const minSpans = Number.parseInt(params.minSpans || '0', 10);
  if (Number.isFinite(minSpans) && minSpans > 0 && row.spanCount < minSpans) return false;
  const minDuration = Number.parseFloat(params.minDuration || '');
  if (Number.isFinite(minDuration) && minDuration > 0 && row.durationMs < minDuration) return false;
  const maxDuration = Number.parseFloat(params.maxDuration || '');
  if (Number.isFinite(maxDuration) && maxDuration > 0 && row.durationMs > maxDuration) return false;
  if (params.hasBody === 'true' && !row.hasBody) return false;
  if (params.excludeProbes !== 'false' && row.isProbe) return false;
  if (params.startTime && new Date(row.startTime).getTime() < new Date(params.startTime).getTime()) return false;
  return true;
}

export function mockTraces(params?: Record<string, string>): { traces: TraceListItem[]; total: number } {
  const filtered = mockTraceCatalog().filter((row) => matchesTraceParams(row, params));
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const limit = Math.max(1, Number.parseInt(params?.limit || '25', 10) || 25);
  return {
    traces: filtered.slice(offset, offset + limit).map(publicTrace),
    total: filtered.length,
  };
}

export function mockTopEndpoints(params?: Record<string, string>): { endpoints: EndpointStat[]; total: number } {
  const rows = mockTraceCatalog().filter((row) => matchesTraceParams(row, params));
  const grouped = new Map<string, EndpointStat>();
  for (const row of rows) {
    const operationName = row.transactionName || row.rootName;
    const key = `${row.namespace}:${row.serviceName}:${operationName}`;
    const current = grouped.get(key) || {
      serviceName: row.serviceName,
      namespace: row.namespace,
      operationName,
      count: 0,
      errorCount: 0,
      avgDurationMs: 0,
      p95DurationMs: 0,
      sampledCount: 0,
    };
    const nextCount = current.count + 1;
    current.avgDurationMs = (current.avgDurationMs * current.count + row.durationMs) / nextCount;
    current.p95DurationMs = Math.max(current.p95DurationMs, row.durationMs);
    current.count = nextCount;
    current.sampledCount = nextCount;
    if (row.hasError) current.errorCount += 1;
    grouped.set(key, current);
  }

  const scale: Record<string, number> = {
    'GET /catalog': 1840,
    'POST /checkout': 620,
    'GET /orders/{id}': 410,
    'GET /orders': 280,
    'POST /oauth/token': 960,
    'GET /session': 1540,
    'GET /cart/{id}': 720,
    'PUT /cart/{id}': 190,
    'POST /charge': 310,
    'POST /refund': 48,
    'POST /notify': 86,
  };

  const endpoints = [...grouped.values()].map((endpoint) => {
    const traffic = scale[endpoint.operationName] ?? Math.max(endpoint.count * 40, endpoint.count);
    const ratio = endpoint.count > 0 ? traffic / endpoint.count : 1;
    return {
      ...endpoint,
      count: Math.round(traffic),
      errorCount: Math.round(endpoint.errorCount * ratio),
      sampledCount: endpoint.count,
      avgDurationMs: Math.round(endpoint.avgDurationMs),
      p95DurationMs: Math.round(endpoint.p95DurationMs),
    };
  });

  return { endpoints, total: endpoints.length };
}

function padSpanId(index: number): string {
  return index.toString(16).padStart(16, '0');
}

export function mockTrace(id: string): Trace {
  const row = mockTraceCatalog().find((item) => item.traceId === id);
  if (!row) {
    throw new Error('Trace not found');
  }
  const start = new Date(row.startTime).getTime();
  const hops = row.serviceFlow?.length ? row.serviceFlow : [row.serviceName];
  const method = (row.transactionName || row.rootName).split(' ')[0] || 'GET';
  const path = (row.transactionName || row.rootName).split(' ')[1] || '/';
  const spans: Span[] = [];

  hops.forEach((service, index) => {
    const duration = Math.max(6, Math.round(row.durationMs * (1 - index * 0.16)));
    const t0 = start + index * 8;
    const isLast = index === hops.length - 1;
    const error = Boolean(row.hasError && isLast);
    spans.push({
      traceId: row.traceId,
      spanId: padSpanId(index + 1),
      parentSpanId: index === 0 ? undefined : padSpanId(index),
      name: index === 0 ? (row.transactionName || row.rootName) : `${method} ${path}`,
      serviceName: service,
      namespace: row.namespace,
      podName: `${service}-6f9d8c7b4-${(index + 11).toString(16)}`,
      startTime: new Date(t0).toISOString(),
      endTime: new Date(t0 + duration).toISOString(),
      durationMs: duration,
      status: error ? 'ERROR' : 'OK',
      statusCode: error ? 503 : 200,
      kind: index === 0 ? 'SERVER' : 'CLIENT',
      attributes: {
        'http.request.method': method,
        'url.path': path,
        'http.response.status_code': String(error ? 503 : 200),
      },
      error: error ? row.errorSummary : undefined,
      events: error
        ? [{ name: 'exception', timestamp: new Date(t0 + duration).toISOString(), attributes: { 'exception.message': row.errorSummary || 'request failed' } }]
        : undefined,
    });
  });

  while (spans.length < row.spanCount) {
    const index = spans.length;
    const parent = spans[Math.max(0, hops.length - 1)];
    const t0 = start + 12 + index * 3;
    const duration = Math.max(4, Math.round(row.durationMs / (index + 4)));
    spans.push({
      traceId: row.traceId,
      spanId: padSpanId(index + 1),
      parentSpanId: parent.spanId,
      name: index % 2 === 0 ? 'SELECT orders' : 'internal',
      serviceName: parent.serviceName,
      namespace: row.namespace,
      startTime: new Date(t0).toISOString(),
      endTime: new Date(t0 + duration).toISOString(),
      durationMs: duration,
      status: 'OK',
      kind: 'INTERNAL',
      attributes: index % 2 === 0 ? { 'db.system': 'postgresql', 'db.operation': 'SELECT' } : undefined,
    });
  }

  return {
    traceId: row.traceId,
    rootSpan: spans[0],
    spans,
    namespace: row.namespace,
    serviceName: row.serviceName,
    startTime: row.startTime,
    endTime: new Date(start + row.durationMs).toISOString(),
    durationMs: row.durationMs,
    spanCount: spans.length,
    hasError: row.hasError,
  };
}

export function mockTraceInvestigation(id: string): TraceInvestigation {
  return {
    traceId: id,
    status: 'skipped',
    levelReached: 0,
    skipReason: 'Live Kubernetes verification is not available in the local mock session',
    conclusion: 'Use the span timeline and error events on this trace.',
  };
}
