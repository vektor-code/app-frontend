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
  Trace,
  TraceListItem,
  UserPermission,
} from '../entities';

const API_BASE = '/api';

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
  getNamespaces(cluster?: string) {
    const qs = cluster ? `?cluster=${encodeURIComponent(cluster)}` : '';
    return this.get<{ namespaces: string[] }>(`/namespaces${qs}`);
  }
  getStats() { return this.get<{ namespaces: NamespaceStats[] }>('/stats'); }
  getTimeseries(namespace?: string, minutes = 60) {
    const params = new URLSearchParams();
    if (namespace) params.set('namespace', namespace);
    params.set('minutes', String(minutes));
    return this.get<TimeseriesData>(`/metrics/timeseries?${params.toString()}`);
  }
  getClusters() { return this.get<{ clusters: string[] }>('/clusters'); }
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
  getNamespaceStatuses(cluster?: string) {
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
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<{ traces: TraceListItem[]; total: number }>(`/traces${qs}`);
  }

  getTopEndpoints(params?: Record<string, string>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.get<{ endpoints: EndpointStat[]; total: number }>(`/endpoints${qs}`);
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

export const api = new ApiClient();
