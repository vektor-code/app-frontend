import type {
  DatabaseQueryMetric,
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
