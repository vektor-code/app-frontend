import type {
  DatabaseQueryMetric,
  InfraNode,
  InfraPod,
  InfrastructureMetrics,
  LatencyDistribution,
  NamespaceStats,
  ServiceErrorSeries,
  ServiceStats,
  TimeseriesBucket,
  TimeseriesData,
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
