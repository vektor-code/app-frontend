export interface ClusterInventoryItem {
  id: string;
  displayName: string;
  token: string;
  status: string;
  credentialType?: string;
  apiServer?: string;
  agentNamespace?: string;
  hasCredentials?: boolean;
  managedByAgent?: boolean;
}

export interface ClusterNamespace {
  name: string;
  disabled: boolean;
  cluster: string;
}

export interface ClusterApplication {
  name: string;
  namespace: string;
  kind: string;
  replicas: number;
  ready: number;
  language: string;
  instrumented: boolean;
  manualOverride: boolean;
  details: string;
  cluster: string;
}

export interface ServiceStats {
  serviceName: string;
  namespace: string;
  cluster?: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  healthScore?: number;
  apdex?: number;
  status?: 'healthy' | 'degraded' | 'critical' | 'unknown' | string;
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
  language?: string;
  instrumented?: boolean;
  instrumentationType?: string;
  details?: string;
}
