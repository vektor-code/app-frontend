const API_BASE = '/api';

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

export interface SpanEvent {
  name: string;
  timestamp: string;
  attributes?: Record<string, string>;
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
  rootName: string;
  startTime: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
  services?: string[];
  thirdPartyTools?: string[];
  errorType?: string;
  errorSummary?: string;
}

export interface ServiceStats {
  serviceName: string;
  namespace: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastSeen: string;
  isInfrastructure?: boolean;
  language?: string;
}

export interface NamespaceStats {
  namespace: string;
  cluster?: string;
  traceCount: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  services: ServiceStats[];
  podCount: number;
  lastActivity: string;
}

export interface ServiceMapData {
  namespace: string;
  nodes: ServiceStats[];
  edges: {
    source: string;
    target: string;
    sourceNamespace?: string;
    targetNamespace?: string;
    callCount: number;
    errorCount: number;
    avgDurationMs: number;
  }[];
}

class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${path}`;
    const headers = {
      ...this.getHeaders(),
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      localStorage.removeItem('token');
      if (!path.includes('/auth/login') && !path.includes('/auth/me')) {
        window.location.reload();
      }
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body: any): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  login(credentials: { username: string; password: string; mode: string }) {
    return this.post<{ token: string; user: any }>('/auth/login', credentials);
  }

  getCurrentUser() {
    return this.get<any>('/auth/me');
  }

  // Core APIs
  getHealth() { return this.get<{ status: string }>('/health'); }
  getNamespaces() { return this.get<{ namespaces: string[] }>('/namespaces'); }
  getStats() { return this.get<{ namespaces: NamespaceStats[] }>('/stats'); }
  getClusters() { return this.get<{ clusters: string[] }>('/clusters'); }
  getAdminConfig() { return this.get<any>('/admin/config'); }
  updateAdminConfig(config: any) { return this.post<{ success: boolean }>('/admin/config', config); }
  getNamespaceStatuses() { return this.get<{ enabled: string[]; disabled: string[] }>('/admin/namespaces'); }
  getAdminInstrumentations() {
    return this.get<{ instrumentations: { name: string; namespace: string; endpoint: string; sampler: string }[] }>('/admin/instrumentations');
  }
  toggleNamespace(namespace: string, disabled: boolean) {
    return this.post<{ success: boolean }>('/admin/namespaces/toggle', { namespace, disabled });
  }
  addNamespace(namespace: string) {
    return this.post<{ success: boolean }>('/admin/namespaces/add', { namespace });
  }
  deleteNamespace(namespace: string) {
    return this.post<{ success: boolean }>('/admin/namespaces/delete', { namespace });
  }

  getTraces(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<{ traces: TraceListItem[]; total: number }>(`/traces${qs}`);
  }

  getTrace(id: string) { return this.get<Trace>(`/traces/${id}`); }
  getTraceDiagnostics(id: string) { return this.get<DiagnosticReport>(`/traces/${id}/diagnostics`); }
  getDatabaseMetrics(namespace?: string) {
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ metrics: DatabaseQueryMetric[] }>(`/metrics/database${qs}`);
  }
  getServices(namespace?: string) {
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ services: ServiceStats[] }>(`/services${qs}`);
  }
  getServiceMap(namespace?: string) {
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<ServiceMapData>(`/servicemap${qs}`);
  }
  getPods(namespace?: string) {
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ pods: PodMetricInfo[]; count: number }>(`/pods${qs}`);
  }
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

export interface PodMetricInfo {
  name: string;
  namespace: string;
  nodeName: string;
  labels: Record<string, string>;
  phase: string;
  cpuUsage: number;
  cpuLimit: number;
  memoryUsage: number;
  memoryLimit: number;
  restartCount: number;
}

export const api = new ApiClient();

// WebSocket for live streaming
export function connectLiveStream(
  namespace: string | undefined,
  onSpan: (span: Span) => void,
  onConnect?: () => void,
  onDisconnect?: () => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const nsParam = namespace ? `?namespace=${namespace}` : '';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws${nsParam}`);

  ws.onopen = () => onConnect?.();
  ws.onclose = () => onDisconnect?.();
  ws.onerror = () => onDisconnect?.();
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'span' && msg.data) {
        onSpan(msg.data);
      }
    } catch {}
  };

  return () => ws.close();
}

export function isSpanError(span: any): boolean {
  if (!span) return false;
  return (
    span.status === 'ERROR' ||
    span.statusCode === 'ERROR' ||
    span.statusCode === 2 ||
    span.statusCode === '2' ||
    !!span.error ||
    span.attributes?.['error'] === 'true' ||
    span.attributes?.['error'] === true ||
    span.attributes?.['failed'] === 'true' ||
    span.attributes?.['failed'] === true ||
    (span.events && span.events.some((e: any) => e.name === 'exception'))
  );
}
