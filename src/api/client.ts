import type {
  ClusterApplication,
  ClusterInventoryItem,
  ClusterNamespace,
  DatabaseQueryMetric,
  DiagnosticReport,
  EndpointStat,
  NamespaceStats,
  PermissionTemplate,
  PodMetricInfo,
  ServiceMapData,
  ServiceStats,
  TimeseriesData,
  LatencyDistribution,
  InfrastructureMetrics,
  Trace,
  TraceFailureDiagnosis,
  TraceInvestigation,
  TraceListItem,
  UserPermission,
} from '../entities';
import {
  createMockSession,
  isLocalMockAuth,
  isMockToken,
  MOCK_LICENSE,
  mockUserFromToken,
  shouldUseMockTelemetry,
} from './mockAuth';
import {
  mockClusters,
  mockDatabaseMetrics,
  mockInfrastructure,
  mockLatencyDistribution,
  mockNamespaces,
  mockNamespaceStatuses,
  mockServiceMap,
  mockStats,
  mockTimeseries,
  mockTopEndpoints,
  mockTrace,
  mockTraceInvestigation,
  mockTraces,
} from './mockTelemetry';

const API_BASE = '/api';

type JwtClaims = { exp?: number; sub?: string };

function decodeToken(token: string): JwtClaims | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function tokenMsUntilExpiry(token: string): number {
  const claims = decodeToken(token);
  if (!claims?.exp) return -Infinity;
  return claims.exp * 1000 - Date.now();
}

function shouldRefreshToken(token: string, skewMs = 60_000): boolean {
  if (!token || isMockToken(token)) return false;
  return tokenMsUntilExpiry(token) <= skewMs;
}

class ApiClient {
  private refreshPromise: Promise<string> | null = null;

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

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Unauthorized');
      if (isMockToken(token)) return token;

      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        localStorage.removeItem('token');
        throw new Error('Unauthorized');
      }
      const data = await res.json();
      if (typeof data?.token !== 'string' || !data.token) {
        localStorage.removeItem('token');
        throw new Error('Unauthorized');
      }
      localStorage.setItem('token', data.token);
      return data.token as string;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async request<T>(path: string, options: RequestInit = {}, _retried = false): Promise<T> {
    const isAuthPublic =
      path.includes('/auth/login') ||
      path.includes('/auth/lookup') ||
      path.includes('/auth/refresh');

    if (!isAuthPublic) {
      const token = localStorage.getItem('token');
      if (token && shouldRefreshToken(token)) {
        try {
          await this.refreshAccessToken();
        } catch {
          // Fall through; request may still succeed or return 401.
        }
      }
    }

    const url = `${API_BASE}${path}`;
    const headers = {
      ...this.getHeaders(),
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 && isMockToken(localStorage.getItem('token'))) {
      throw new Error('API unavailable in local mock session');
    }

    if (res.status === 401 && !isAuthPublic && !_retried) {
      try {
        await this.refreshAccessToken();
        return this.request<T>(path, options, true);
      } catch {
        localStorage.removeItem('token');
        window.location.reload();
        throw new Error('Unauthorized');
      }
    }

    if (res.status === 401) {
      localStorage.removeItem('token');
      if (!isAuthPublic && !path.includes('/auth/me')) {
        window.location.reload();
      }
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      let message = `API ${res.status}: ${res.statusText}`;
      try {
        const body = await res.json();
        if (typeof body?.error === 'string' && body.error.trim()) {
          message = body.error;
        }
      } catch {
        // keep status text
      }
      throw new Error(message);
    }
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
    if (isLocalMockAuth()) {
      return Promise.resolve(createMockSession(credentials.username));
    }
    return this.post<{ token: string; user: any; expires_in?: number }>('/auth/login', credentials);
  }

  lookupAccount(payload: { username: string; mode: string }) {
    if (isLocalMockAuth()) {
      return Promise.resolve({ exists: Boolean(payload.username.trim()) });
    }
    return this.post<{ exists: boolean }>('/auth/lookup', payload);
  }

  refresh() {
    return this.refreshAccessToken();
  }

  getCurrentUser() {
    const token = localStorage.getItem('token');
    if (isLocalMockAuth() && isMockToken(token)) {
      const user = mockUserFromToken(token);
      if (user) return Promise.resolve(user);
    }
    return this.get<any>('/auth/me');
  }

  getLicense() {
    if (isLocalMockAuth() && isMockToken(localStorage.getItem('token'))) {
      return Promise.resolve(MOCK_LICENSE);
    }
    return this.get<{
      valid: boolean;
      status?: string;
      code?: string;
      message?: string;
      expires_at?: string | null;
    }>('/license');
  }

  // Core APIs
  getHealth() { return this.get<{ status: string }>('/health'); }
  getNamespaces(cluster?: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockNamespaces(cluster));
    const qs = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return this.get<{ namespaces: string[] }>(`/namespaces${qs}`);
  }
  getStats() {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockStats());
    return this.get<{ namespaces: NamespaceStats[] }>('/stats');
  }
  getTimeseries(namespace?: string, minutes = 60) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockTimeseries(namespace, minutes));
    const params = new URLSearchParams();
    if (namespace) params.set('namespace', namespace);
    params.set('minutes', String(minutes));
    return this.get<TimeseriesData>(`/metrics/timeseries?${params.toString()}`);
  }

  getLatencyDistribution(namespace?: string, minutes = 60) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockLatencyDistribution(namespace, minutes));
    const params = new URLSearchParams();
    if (namespace) params.set('namespace', namespace);
    params.set('minutes', String(minutes));
    return this.get<LatencyDistribution>(`/metrics/latency-distribution?${params.toString()}`);
  }

  getInfrastructure(namespace?: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockInfrastructure(namespace));
    const params = new URLSearchParams();
    if (namespace) params.set('namespace', namespace);
    const qs = params.toString();
    return this.get<InfrastructureMetrics>(`/metrics/infrastructure${qs ? `?${qs}` : ''}`);
  }
  getClusters() {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockClusters());
    return this.get<{ clusters: Array<string | { name: string; displayName?: string; status?: string }> }>('/clusters');
  }
  getAdminConfig() { return this.get<any>('/admin/config'); }
  updateAdminConfig(config: any) { return this.post<{ success: boolean }>('/admin/config', config); }

  // Users & access control
  getUsers() { return this.get<{ users: UserPermission[] }>('/admin/users'); }
  saveUser(user: UserPermission) {
    return this.request<{ success: boolean }>(`/admin/users/${encodeURIComponent(user.username)}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    });
  }
  deleteUser(username: string) {
    return this.request<{ success: boolean }>(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
  }
  getPermissionTemplates() { return this.get<{ templates: PermissionTemplate[] }>('/admin/permission-templates'); }
  savePermissionTemplate(template: PermissionTemplate) {
    return this.post<{ success: boolean }>('/admin/permission-templates', template);
  }
  deletePermissionTemplate(name: string) {
    return this.request<{ success: boolean }>(`/admin/permission-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  getNamespaceStatuses(cluster?: string): Promise<{ cluster?: string; enabled: string[]; disabled: string[] }> {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockNamespaceStatuses());
    const qs = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return this.get<{ cluster?: string; enabled: string[]; disabled: string[] }>(`/admin/namespaces${qs}`);
  }
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
  getClusterInventory() {
    return this.get<{ inventory: ClusterInventoryItem[] }>('/admin/clusters/inventory');
  }
  saveClusterInventory(inventory: ClusterInventoryItem[]) {
    return this.post<{ success: boolean }>('/admin/clusters/inventory', { inventory });
  }
  testClusterConnection(payload: { id?: string; token: string; credentialType?: string; apiServer?: string }) {
    return this.post<{ success: boolean; serverVersion?: string; error?: string; message?: string }>('/admin/clusters/test', payload);
  }
  deleteCluster(id: string) {
    return this.request<{ success: boolean }>(`/admin/clusters/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  getClusterNamespaces(clusterId: string) {
    return this.get<{ cluster: string; namespaces: ClusterNamespace[] }>(`/admin/clusters/${encodeURIComponent(clusterId)}/namespaces`);
  }
  getClusterApplications(clusterId: string, namespace: string) {
    return this.get<{ cluster: string; namespace: string; applications: ClusterApplication[] }>(
      `/admin/clusters/${encodeURIComponent(clusterId)}/namespaces/${encodeURIComponent(namespace)}/applications`
    );
  }
  toggleApplicationInstrumentation(payload: {
    clusterId: string;
    namespace: string;
    workloadName: string;
    workloadKind?: string;
    language?: string;
    enabled: boolean;
  }) {
    return this.post<{ success: boolean }>('/admin/applications/instrumentation/toggle', payload);
  }

  getRetention() {
    return this.get<{ retentionHours: number }>('/admin/retention');
  }
  updateRetention(retentionHours: number) {
    return this.post<{ success: boolean; retentionHours: number }>('/admin/retention', { retentionHours });
  }
  clearAllTraces() {
    return this.post<{ success: boolean; deletedCount: number }>('/admin/retention/clear', {});
  }

  getTraces(params?: Record<string, string>) {
    if (shouldUseMockTelemetry()) {
      return new Promise<{ traces: TraceListItem[]; total: number }>(resolve => {
        window.setTimeout(() => resolve(mockTraces(params)), 280);
      });
    }
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<{ traces: TraceListItem[]; total: number }>(`/traces${qs}`);
  }

  getTopEndpoints(params?: Record<string, string>) {
    if (shouldUseMockTelemetry()) {
      return new Promise<{ endpoints: EndpointStat[]; total: number }>(resolve => {
        window.setTimeout(() => resolve(mockTopEndpoints(params)), 280);
      });
    }
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<{ endpoints: EndpointStat[]; total: number }>(`/endpoints${qs}`);
  }

  getTrace(id: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve().then(() => mockTrace(id));
    return this.get<Trace>(`/traces/${id}`);
  }
  getTraceDiagnostics(id: string) { return this.get<DiagnosticReport>(`/traces/${id}/diagnostics`); }
  getTraceFailureDiagnosis(id: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve({ traceId: id, diagnosis: null });
    return this.get<TraceFailureDiagnosis | { traceId: string; diagnosis: null }>(`/traces/${id}/failure-diagnosis`);
  }
  getTraceInvestigation(id: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockTraceInvestigation(id));
    return this.get<TraceInvestigation>(`/traces/${id}/investigation`);
  }
  getDatabaseMetrics(namespace?: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockDatabaseMetrics(namespace));
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ metrics: DatabaseQueryMetric[] }>(`/metrics/database${qs}`);
  }
  getServices(namespace?: string) {
    if (shouldUseMockTelemetry()) {
      const services = mockStats(namespace).namespaces.flatMap((ns) => ns.services || []);
      return Promise.resolve({ services });
    }
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ services: ServiceStats[] }>(`/services${qs}`);
  }
  getServiceMap(namespace?: string) {
    if (shouldUseMockTelemetry()) return Promise.resolve(mockServiceMap(namespace));
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<ServiceMapData>(`/servicemap${qs}`);
  }
  getPods(namespace?: string) {
    const qs = namespace ? `?namespace=${namespace}` : '';
    return this.get<{ pods: PodMetricInfo[]; count: number }>(`/pods${qs}`);
  }
}

export const api = new ApiClient();
