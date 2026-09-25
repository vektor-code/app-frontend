export type PlatformSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface PlatformIssue {
  severity: PlatformSeverity;
  source: string;
  code?: string;
  message: string;
  detail?: string;
  at?: string;
}

export interface PlatformPod {
  name: string;
  namespace: string;
  cluster?: string;
  component: string;
  phase: string;
  nodeName?: string;
  ready: boolean;
  restarts: number;
  status: PlatformSeverity;
  containers: {
    name: string;
    ready: boolean;
    restartCount: number;
    state: string;
    reason?: string;
    message?: string;
    exitCode?: number;
  }[];
  events: { type: string; reason: string; message: string; count: number; lastSeen?: string }[];
  issues: PlatformIssue[];
  logErrors: { severity: PlatformSeverity; line: string }[];
  recentLogs: string[];
  previousLogErrors?: { severity: PlatformSeverity; line: string }[];
  logFetchError?: string;
}

export interface PlatformComponent {
  id: string;
  status: PlatformSeverity;
  podCount: number;
  pods: PlatformPod[];
  issues: PlatformIssue[];
}

export interface PlatformHealthReport {
  namespace: string;
  generatedAt: string;
  summary: {
    status: PlatformSeverity;
    critical: number;
    warning: number;
    info: number;
    healthy: number;
    pods: number;
  };
  components: PlatformComponent[];
  notes?: string[];
  sources?: string[];
  clusters?: { id: string; status: string; mode: string; detail?: string; lastSeen?: string }[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object';
}

function asSeverity(v: unknown): PlatformSeverity {
  if (v === 'critical' || v === 'warning' || v === 'info' || v === 'ok') return v;
  return 'ok';
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeIssue(raw: unknown): PlatformIssue | null {
  if (!isRecord(raw)) return null;
  const message = asString(raw.message);
  if (!message) return null;
  return {
    severity: asSeverity(raw.severity),
    source: asString(raw.source) || 'status',
    code: asString(raw.code) || undefined,
    message,
    detail: asString(raw.detail) || undefined,
    at: asString(raw.at) || undefined,
  };
}

function normalizeLogLine(raw: unknown): { severity: PlatformSeverity; line: string } | null {
  if (!isRecord(raw)) return null;
  const line = asString(raw.line);
  if (!line) return null;
  return { severity: asSeverity(raw.severity), line };
}

function normalizeContainer(raw: unknown): PlatformPod['containers'][number] | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  if (!name) return null;
  return {
    name,
    ready: raw.ready === true,
    restartCount: asNumber(raw.restartCount),
    state: asString(raw.state) || 'unknown',
    reason: asString(raw.reason) || undefined,
    message: asString(raw.message) || undefined,
    exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : undefined,
  };
}

function normalizeEvent(raw: unknown): PlatformPod['events'][number] | null {
  if (!isRecord(raw)) return null;
  return {
    type: asString(raw.type),
    reason: asString(raw.reason),
    message: asString(raw.message),
    count: asNumber(raw.count),
    lastSeen: asString(raw.lastSeen) || undefined,
  };
}

function normalizePod(raw: unknown): PlatformPod | null {
  if (!isRecord(raw)) return null;
  const name = asString(raw.name);
  if (!name) return null;
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map(normalizeIssue).filter((i): i is PlatformIssue => i != null)
    : [];
  const logErrors = Array.isArray(raw.logErrors)
    ? raw.logErrors.map(normalizeLogLine).filter((l): l is NonNullable<typeof l> => l != null)
    : [];
  const previousLogErrors = Array.isArray(raw.previousLogErrors)
    ? raw.previousLogErrors.map(normalizeLogLine).filter((l): l is NonNullable<typeof l> => l != null)
    : undefined;
  return {
    name,
    namespace: asString(raw.namespace),
    cluster: asString(raw.cluster) || undefined,
    component: asString(raw.component),
    phase: asString(raw.phase),
    nodeName: asString(raw.nodeName) || undefined,
    ready: raw.ready === true,
    restarts: asNumber(raw.restarts),
    status: asSeverity(raw.status),
    containers: Array.isArray(raw.containers)
      ? raw.containers.map(normalizeContainer).filter((c): c is NonNullable<typeof c> => c != null)
      : [],
    events: Array.isArray(raw.events)
      ? raw.events.map(normalizeEvent).filter((e): e is NonNullable<typeof e> => e != null)
      : [],
    issues,
    logErrors,
    recentLogs: Array.isArray(raw.recentLogs) ? raw.recentLogs.filter((l): l is string => typeof l === 'string') : [],
    previousLogErrors,
    logFetchError: asString(raw.logFetchError) || undefined,
  };
}

function normalizeComponent(raw: unknown): PlatformComponent | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  if (!id) return null;
  const pods = Array.isArray(raw.pods)
    ? raw.pods.map(normalizePod).filter((p): p is PlatformPod => p != null)
    : [];
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map(normalizeIssue).filter((i): i is PlatformIssue => i != null)
    : [];
  return {
    id,
    status: asSeverity(raw.status),
    podCount: typeof raw.podCount === 'number' ? raw.podCount : pods.length,
    pods,
    issues,
  };
}

const EMPTY_REPORT: PlatformHealthReport = {
  namespace: '',
  generatedAt: new Date(0).toISOString(),
  summary: { status: 'ok', critical: 0, warning: 0, info: 0, healthy: 0, pods: 0 },
  components: [],
};

/** Coerce partial/null API payloads into a safe shape for the Admin UI. */
export function normalizePlatformHealthReport(raw: unknown): PlatformHealthReport {
  if (!isRecord(raw)) return { ...EMPTY_REPORT, generatedAt: new Date().toISOString() };

  const components = Array.isArray(raw.components)
    ? raw.components.map(normalizeComponent).filter((c): c is PlatformComponent => c != null)
    : [];

  const summaryRaw = isRecord(raw.summary) ? raw.summary : {};
  const summary = {
    status: asSeverity(summaryRaw.status),
    critical: asNumber(summaryRaw.critical),
    warning: asNumber(summaryRaw.warning),
    info: asNumber(summaryRaw.info),
    healthy: asNumber(summaryRaw.healthy),
    pods: asNumber(summaryRaw.pods),
  };

  const clusters = Array.isArray(raw.clusters)
    ? raw.clusters
        .filter(isRecord)
        .map(cl => ({
          id: asString(cl.id) || 'unknown',
          status: asString(cl.status) || 'error',
          mode: asString(cl.mode) || 'local',
          detail: asString(cl.detail) || undefined,
          lastSeen: asString(cl.lastSeen) || undefined,
        }))
    : undefined;

  return {
    namespace: asString(raw.namespace),
    generatedAt: asString(raw.generatedAt) || new Date().toISOString(),
    summary,
    components,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string' && n.length > 0) : undefined,
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string' && s.length > 0) : undefined,
    clusters: clusters?.length ? clusters : undefined,
  };
}

/** Flatten component pods, skipping null/undefined entries from sparse API arrays. */
export function platformHealthPods(report: PlatformHealthReport): PlatformPod[] {
  const out: PlatformPod[] = [];
  for (const comp of report.components) {
    if (!comp?.pods?.length) continue;
    for (const pod of comp.pods) {
      if (pod) out.push(pod);
    }
  }
  return out;
}

/** Manual/dev regression guard for null pods and missing summary. */
export function assertPlatformHealthNormalizeRegression(): void {
  const raw = {
    components: [
      { id: 'api-backend', status: 'warning', podCount: 0, pods: null, issues: null },
      null,
      { id: 'agent-backend', status: 'ok', pods: [null, { name: 'agent-1', status: 'ok' }] },
    ],
    summary: null,
  };
  const report = normalizePlatformHealthReport(raw);
  if (report.components.length !== 2) {
    throw new Error(`expected 2 components, got ${report.components.length}`);
  }
  if (report.components[0].pods.length !== 0) {
    throw new Error('expected null pods array to normalize to []');
  }
  if (report.summary.status !== 'ok') {
    throw new Error('expected default summary.status ok');
  }
  const pods = platformHealthPods(report);
  if (pods.length !== 1 || pods[0].name !== 'agent-1') {
    throw new Error('expected one valid pod after filtering null entries');
  }
  pods.forEach(p => {
    if (p.status !== 'ok' && p.status !== 'critical' && p.status !== 'warning' && p.status !== 'info') {
      throw new Error('pod status must be readable without throwing');
    }
  });
}
