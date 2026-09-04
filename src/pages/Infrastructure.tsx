import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react';
import { api } from '../api/client';
import type { InfrastructureMetrics, InfraNamespace, InfraNode, InfraPod } from '../entities';
import { useTranslation } from '../utils/i18n';
import { LoadingState, NoDataState } from '../components/DataState';
import IconPack from '../components/IconPack';
import { NodeHealthCard } from '../components/NodeHealthCard';
import type { HealthLevel } from '../components/NodeHealthCard.types';
import { useColumnResize } from '../utils/useColumnResize';
import { HEAT_SCALE, SERIES_COLORS, STATUS_COLORS } from '../utils/chartTheme';

interface InfrastructureProps {
  namespace: string;
}

type InfraSortField = 'risk' | 'memory' | 'cpu' | 'restarts' | 'name' | 'node';
type InfraSortDir = 'asc' | 'desc';
type InfraTone = 'ok' | 'warning' | 'critical' | 'info';
type InfraViewMode = 'cards' | 'list';
type NodeViewMode = 'cards' | 'matrix';
type NamespaceViewMode = 'cards' | 'map';
type InfraTab = 'applications' | 'nodes' | 'namespaces' | 'pods';
type NodeRole = 'master' | 'worker';
type WorkloadColumn = 'application' | 'health' | 'pods' | 'cpu' | 'memory' | 'restarts';
type PodColumn = 'pod' | 'node' | 'cpu' | 'memory' | 'restarts' | 'status';
type WorkloadSortField = 'name' | 'health' | 'pods' | 'cpu' | 'memory' | 'restarts';
type NodeMatrixColumn = 'node' | 'cpu' | 'memory' | 'pods' | 'health';
type NodeMatrixSortField = NodeMatrixColumn;

interface WorkloadGroup {
  key: string;
  name: string;
  namespace: string;
  icon: string;
  kind: string;
  pods: number;
  cpuUsage: number;
  memUsage: number;
  cpuPct: number;
  memPct: number;
  restarts: number;
  atRisk: number;
  nodes: string[];
  risk: number;
}

interface NodeGroup extends InfraNode {
  risk: number;
}

interface InfraDistributionSegment {
  label: string;
  value: number;
  color: string;
}

const workloadColumnWidths: Record<WorkloadColumn, number> = {
  application: 330,
  health: 160,
  pods: 110,
  cpu: 200,
  memory: 200,
  restarts: 130,
};

const workloadColumnMinimums: Record<WorkloadColumn, number> = {
  application: 260,
  health: 130,
  pods: 90,
  cpu: 150,
  memory: 150,
  restarts: 110,
};

const workloadColumnOrder: WorkloadColumn[] = ['application', 'health', 'pods', 'cpu', 'memory', 'restarts'];

const podColumnWidths: Record<PodColumn, number> = {
  pod: 350,
  node: 190,
  cpu: 210,
  memory: 210,
  restarts: 120,
  status: 150,
};

const podColumnMinimums: Record<PodColumn, number> = {
  pod: 270,
  node: 150,
  cpu: 160,
  memory: 160,
  restarts: 100,
  status: 125,
};

const podColumnOrder: PodColumn[] = ['pod', 'node', 'cpu', 'memory', 'restarts', 'status'];

const nodeMatrixColumnWidths: Record<NodeMatrixColumn, number> = {
  node: 300,
  cpu: 180,
  memory: 180,
  pods: 160,
  health: 210,
};

const nodeMatrixColumnMinimums: Record<NodeMatrixColumn, number> = {
  node: 230,
  cpu: 140,
  memory: 140,
  pods: 125,
  health: 170,
};

const nodeMatrixColumnOrder: NodeMatrixColumn[] = ['node', 'cpu', 'memory', 'pods', 'health'];

const INFRA_ICONS = {
  activity: '/observability-icons/activity.svg',
  alert: '/status-icons/alert-triangle.svg',
  apps: '/observability-icons/layout-grid.svg',
  check: '/status-icons/circle-check.svg',
  clock: '/status-icons/clock-exclamation.svg',
  cpu: '/dashboard-icons/gauge.svg',
  database: '/observability-icons/database.svg',
  kubernetes: '/logos/kubernetes.svg',
  memory: '/dashboard-icons/box.svg',
  namespace: '/observability-icons/sitemap.svg',
  node: '/observability-icons/server.svg',
  opentelemetry: '/logos/opentelemetry.svg',
  prometheus: '/logos/prometheus.svg',
  route: '/observability-icons/route.svg',
  shield: '/observability-icons/shield-check.svg',
  topology: '/observability-icons/topology.svg'
} as const;

function formatCpu(milli: number): string {
  if (!Number.isFinite(milli) || milli <= 0) return '0m';
  if (milli < 1000) return `${Math.round(milli)}m`;
  return `${(milli / 1000).toFixed(2)} cores`;
}

function formatMem(mib: number): string {
  if (!Number.isFinite(mib) || mib <= 0) return '0 Mi';
  if (mib < 1024) return `${Math.round(mib)} Mi`;
  return `${(mib / 1024).toFixed(2)} Gi`;
}

function pressureTone(pct: number): 'critical' | 'warning' | 'ok' {
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'warning';
  return 'ok';
}

function riskScore(pod: InfraPod): number {
  let score = Math.max(pod.memPct || 0, pod.cpuPct || 0);
  if (pod.oomRisk) score += 40;
  if (pod.cpuThrottle) score += 20;
  if (pod.restarts > 0) score += Math.min(20, pod.restarts * 2);
  return score;
}

function podIdentityKey(pod: InfraPod): string {
  return `${pod.namespace || 'default'}/${pod.name}/${pod.node || 'unscheduled'}`;
}

function dedupePods(list: InfraPod[]): InfraPod[] {
  const byKey = new Map<string, InfraPod>();

  for (const pod of list) {
    const key = podIdentityKey(pod);
    const current = byKey.get(key);

    if (!current) {
      byKey.set(key, pod);
      continue;
    }

    byKey.set(key, {
      ...current,
      phase: current.phase || pod.phase,
      cpuUsage: Math.max(current.cpuUsage || 0, pod.cpuUsage || 0),
      cpuLimit: Math.max(current.cpuLimit || 0, pod.cpuLimit || 0),
      memUsage: Math.max(current.memUsage || 0, pod.memUsage || 0),
      memLimit: Math.max(current.memLimit || 0, pod.memLimit || 0),
      cpuPct: Math.max(current.cpuPct || 0, pod.cpuPct || 0),
      memPct: Math.max(current.memPct || 0, pod.memPct || 0),
      restarts: Math.max(current.restarts || 0, pod.restarts || 0),
      oomRisk: current.oomRisk || pod.oomRisk,
      cpuThrottle: current.cpuThrottle || pod.cpuThrottle
    });
  }

  return Array.from(byKey.values());
}

function podTone(pod: InfraPod): InfraTone {
  if (pod.oomRisk) return 'critical';
  if (pod.cpuThrottle || pod.restarts > 0) return 'warning';
  return 'ok';
}

function workloadNameFromPod(name: string): string {
  return name
    .replace(/-[a-f0-9]{8,10}-[a-z0-9]{5}$/i, '')
    .replace(/-[a-z0-9]{9,10}-[a-z0-9]{5}$/i, '')
    .replace(/-[a-z0-9]{5}$/i, '');
}

function workloadProfile(name: string, namespace = ''): { icon: string; kind: string } {
  const lower = `${namespace} ${name}`.toLowerCase();
  if (lower.includes('kube-system') || lower.includes('coredns') || lower.includes('kube-proxy')) return { icon: INFRA_ICONS.kubernetes, kind: 'Platform' };
  if (lower.includes('postgres') || lower.includes('psql')) return { icon: '/logos/postgres.svg', kind: 'Database' };
  if (lower.includes('mysql')) return { icon: '/logos/mysql.svg', kind: 'Database' };
  if (lower.includes('mongo')) return { icon: '/logos/mongodb.svg', kind: 'Database' };
  if (lower.includes('clickhouse')) return { icon: '/logos/clickhouse.svg', kind: 'Analytics DB' };
  if (lower.includes('redis') || lower.includes('cache')) return { icon: '/logos/redis.svg', kind: 'Cache' };
  if (lower.includes('kafka')) return { icon: '/logos/kafka.svg', kind: 'Stream' };
  if (lower.includes('rabbit')) return { icon: '/logos/rabbitmq.svg', kind: 'Queue' };
  if (lower.includes('minio')) return { icon: '/logos/minio.svg', kind: 'Storage' };
  if (lower.includes('nginx') || lower.includes('ingress')) return { icon: '/logos/nginx.svg', kind: 'Ingress' };
  if (lower.includes('otel') || lower.includes('opentelemetry')) return { icon: '/logos/opentelemetry.svg', kind: 'Telemetry' };
  if (lower.includes('prometheus')) return { icon: '/logos/prometheus.svg', kind: 'Metrics' };
  if (lower.includes('grafana')) return { icon: '/logos/grafana.svg', kind: 'Dashboard' };
  if (lower.includes('streamlit') || lower.includes('chatbot') || lower.includes('python') || lower.includes('troni')) return { icon: '/logos/python.svg', kind: 'Python app' };
  if (lower.includes('node') || lower.includes('gtm') || lower.includes('web')) return { icon: '/logos/node.svg', kind: 'Node app' };
  if (lower.includes('java') || lower.includes('spring')) return { icon: '/logos/java.svg', kind: 'Java app' };
  if (lower.includes('go') || lower.includes('golang') || lower.includes('highping') || lower.includes('proxy') || lower.includes('gateway')) return { icon: '/logos/go.svg', kind: 'Go service' };
  if (lower.includes('api') || lower.includes('backend') || lower.includes('server')) return { icon: INFRA_ICONS.node, kind: 'API service' };
  if (lower.includes('worker') || lower.includes('job') || lower.includes('consumer')) return { icon: INFRA_ICONS.activity, kind: 'Worker' };
  return { icon: INFRA_ICONS.apps, kind: 'Application' };
}

function iconForWorkload(name: string, namespace = ''): string {
  return workloadProfile(name, namespace).icon;
}

function statusIconForTone(tone: InfraTone): string {
  if (tone === 'critical') return INFRA_ICONS.alert;
  if (tone === 'warning') return INFRA_ICONS.clock;
  return INFRA_ICONS.check;
}

function statusLabelForTone(tone: InfraTone, t: (k: string) => string): string {
  if (tone === 'critical') return t('Critical');
  if (tone === 'warning') return t('Attention');
  return t('Healthy');
}

function usesBrandPaint(src: string): boolean {
  return src.startsWith('/logos/') || src.endsWith('.png') || src.endsWith('.gif');
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value)}%`;
}

function relativePercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || value <= 0 || max <= 0) return 0;
  return Math.min(100, (value / max) * 100);
}

function capacityPercent(value: number, capacity: number, fallbackMax: number): number {
  if (Number.isFinite(capacity) && capacity > 0) {
    return Math.min(100, (value / capacity) * 100);
  }
  return relativePercent(value, fallbackMax);
}

function nodeCpuLoad(node: NodeGroup): number {
  return node.metricsAvailable && node.totalCpuUsage > 0 ? node.totalCpuUsage : node.cpuUsage;
}

function nodeMemLoad(node: NodeGroup): number {
  return node.metricsAvailable && node.totalMemUsage > 0 ? node.totalMemUsage : node.memUsage;
}

function nodeCpuCapacity(node: NodeGroup): number {
  return node.cpuAllocatable || node.cpuCapacity || 0;
}

function nodeMemCapacity(node: NodeGroup): number {
  return node.memAllocatable || node.memCapacity || 0;
}

function nodePodCapacity(node: NodeGroup): number {
  return node.podAllocatable || node.podCapacity || 0;
}

function loadValue(value: number, capacity: number, formatter: (value: number) => string): string {
  if (capacity > 0) return `${formatter(value)} / ${formatter(capacity)}`;
  return formatter(value);
}

function podCapacityValue(pods: number, capacity: number): string {
  if (capacity > 0) return `${formatCompact(pods)} / ${formatCompact(capacity)}`;
  return formatCompact(pods);
}

function resourcePercentFromNode(node: InfraNode, resource: 'cpu' | 'memory' | 'pods'): number {
  if (resource === 'cpu') {
    const load = node.metricsAvailable && node.totalCpuUsage > 0 ? node.totalCpuUsage : node.cpuUsage;
    const capacity = node.cpuAllocatable || node.cpuCapacity || 0;
    return capacity > 0 ? Math.min(100, (load / capacity) * 100) : 0;
  }
  if (resource === 'memory') {
    const load = node.metricsAvailable && node.totalMemUsage > 0 ? node.totalMemUsage : node.memUsage;
    const capacity = node.memAllocatable || node.memCapacity || 0;
    return capacity > 0 ? Math.min(100, (load / capacity) * 100) : 0;
  }
  const capacity = node.podAllocatable || node.podCapacity || 0;
  return capacity > 0 ? Math.min(100, (node.pods / capacity) * 100) : 0;
}

function nodeRiskScore(node: InfraNode): number {
  const pressure = Math.max(node.cpuPct || 0, node.memPct || 0, node.podPct || 0);
  return pressure + (node.atRisk || 0) * 40 + Math.min(20, (node.restarts || 0) * 0.2);
}

function nodeRole(node: Pick<InfraNode, 'name' | 'role'>): NodeRole {
  const role = (node.role || '').toLowerCase();
  if (role.includes('master') || role.includes('control-plane')) return 'master';

  const lowerName = (node.name || '').toLowerCase();
  if (lowerName.includes('control-plane') || lowerName.includes('master')) return 'master';
  const lastPart = lowerName.split('-').pop() || '';
  if (/^m\d+$/.test(lastPart)) return 'master';
  return 'worker';
}

/** Overall card status from pod health, independent of gauge colors. */
function nodeHealthStatus(node: NodeGroup): HealthLevel {
  if (node.atRisk > 1) return 'critical';
  if (node.atRisk > 0 || node.restarts > 0) return 'warning';
  return 'ok';
}

function nodeRiskReason(node: NodeGroup, t: (k: string) => string): string | undefined {
  const parts: string[] = [];
  if (node.atRisk > 0) {
    parts.push(`${formatCompact(node.atRisk)} ${node.atRisk === 1 ? t('pod at risk') : t('pods at risk')}`);
  }
  if (node.restarts > 0) {
    parts.push(`${formatCompact(node.restarts)} ${t('restarts')}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

function formatAgoLabel(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function UsageBar({ pct, label, compact = false }: { pct: number; label: string; compact?: boolean }) {
  const tone = pressureTone(pct);
  return (
    <div className={`infra-usage ${compact ? 'compact' : ''}`}>
      <div className="infra-usage-head">
        <span>{label}</span>
        <strong className={`infra-pct ${tone}`}>{pct > 0 ? formatPercent(pct) : '—'}</strong>
      </div>
      <div className="infra-usage-track">
        <div className={`infra-usage-fill ${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function gaugeStroke(tone: InfraTone | 'info'): string {
  if (tone === 'critical') return STATUS_COLORS.critical;
  if (tone === 'warning') return STATUS_COLORS.warning;
  if (tone === 'ok') return STATUS_COLORS.healthy;
  return STATUS_COLORS.info;
}

function RadialGauge({
  pct,
  label,
  value,
  tone,
  size = 104,
}: {
  pct: number;
  label: string;
  value?: string;
  tone?: InfraTone | 'info';
  size?: number;
}) {
  const resolvedTone = tone || pressureTone(pct);
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const offset = c * (1 - clamped / 100);
  const display = value ?? (clamped > 0 ? formatPercent(clamped) : '—');

  return (
    <div className="infra-radial-stat">
      <svg
        className="infra-radial-svg"
        viewBox="0 0 88 88"
        width={size}
        height={size}
        role="img"
        aria-label={`${label} ${display}`}
      >
        <circle className="infra-radial-track" cx="44" cy="44" r={r} />
        <circle
          className="infra-radial-fill"
          cx="44"
          cy="44"
          r={r}
          stroke={gaugeStroke(resolvedTone)}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 44 44)"
        />
        <text className="infra-radial-value" x="44" y="42" textAnchor="middle">{display}</text>
        <text className="infra-radial-label" x="44" y="58" textAnchor="middle">{label}</text>
      </svg>
    </div>
  );
}

function MiniGauge({
  pct,
  label,
  detail,
}: {
  pct: number;
  label: string;
  detail?: string;
}) {
  const tone = pressureTone(pct);
  const r = 16;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const offset = c * (1 - clamped / 100);

  return (
    <div className={`infra-mini-gauge ${tone}`}>
      <svg viewBox="0 0 40 40" width={40} height={40} aria-hidden>
        <circle className="infra-radial-track" cx="20" cy="20" r={r} />
        <circle
          className="infra-radial-fill"
          cx="20"
          cy="20"
          r={r}
          stroke={gaugeStroke(tone)}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <div>
        <em>{label}</em>
        <strong className={`infra-pct ${tone}`}>{clamped > 0 ? formatPercent(clamped) : '—'}</strong>
        {detail && <span title={detail}>{detail}</span>}
      </div>
    </div>
  );
}

function inspectLabel(tone: InfraTone, t: (k: string) => string): string {
  if (tone === 'critical') return t('Hot');
  if (tone === 'warning') return t('Watch');
  return t('OK');
}

function FleetMeter({
  label,
  pct,
  value,
  tone,
}: {
  label: string;
  pct: number;
  value: string;
  tone?: InfraTone;
}) {
  const resolved = tone || pressureTone(pct);
  const width = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));

  return (
    <div className={`infra-fleet-meter ${resolved}`}>
      <div className="infra-fleet-meter-head">
        <span>{label}</span>
        <strong>{width > 0 ? formatPercent(width) : '—'}</strong>
        <em>{value}</em>
      </div>
      <div className="infra-fleet-track" aria-hidden>
        <i style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function InspectChip({ label, tone, t }: { label: string; tone: InfraTone; t: (k: string) => string }) {
  return <em className={`infra-inspect ${tone}`}>{label} {inspectLabel(tone, t)}</em>;
}

function HostMap({
  nodes,
  max,
  t,
}: {
  nodes: NodeGroup[];
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
}) {
  return (
    <div className="infra-host-map" aria-label={t('Nodes')}>
      {[...nodes].sort((a, b) => {
        const roleDelta = (nodeRole(a) === 'master' ? 0 : 1) - (nodeRole(b) === 'master' ? 0 : 1);
        return roleDelta || a.name.localeCompare(b.name);
      }).map(node => {
        const cpu = capacityPercent(nodeCpuLoad(node), nodeCpuCapacity(node), max.cpuUsage);
        const memory = capacityPercent(nodeMemLoad(node), nodeMemCapacity(node), max.memUsage);
        const pods = capacityPercent(node.pods, nodePodCapacity(node), max.pods);
        const pressure = Math.max(cpu, memory, pods);
        const tone = pressureTone(pressure);
        const short = node.name.length > 12 ? `${node.name.slice(0, 11)}…` : node.name;
        return (
          <div className={`infra-host-tile ${tone}`} key={node.name} title={`${node.name} · ${formatPercent(pressure)}`}>
            <strong>{short}</strong>
            <span>{formatPercent(pressure)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Infrastructure({ namespace }: InfrastructureProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<InfrastructureMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [sortField, setSortField] = useState<InfraSortField>('risk');
  const [sortDir, setSortDir] = useState<InfraSortDir>('desc');
  const [workloadSortField, setWorkloadSortField] = useState<WorkloadSortField>('health');
  const [workloadSortDir, setWorkloadSortDir] = useState<InfraSortDir>('desc');
  const [workloadView, setWorkloadView] = useState<InfraViewMode>('cards');
  const [podView, setPodView] = useState<InfraViewMode>('list');
  const [nodeView, setNodeView] = useState<NodeViewMode>('cards');
  const [namespaceView, setNamespaceView] = useState<NamespaceViewMode>('cards');
  const [activeTab, setActiveTab] = useState<InfraTab>('applications');
  const [workloadLimit, setWorkloadLimit] = useState(24);
  const [podLimit, setPodLimit] = useState(100);
  const workloadColumns = useColumnResize(workloadColumnWidths, {
    minWidths: workloadColumnMinimums,
    storageKey: 'infrastructureWorkloadColumnsV1',
  });
  const podColumns = useColumnResize(podColumnWidths, {
    minWidths: podColumnMinimums,
    storageKey: 'infrastructurePodColumnsV1',
  });
  const workloadGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: workloadColumnOrder
      .map(column => `minmax(${workloadColumnMinimums[column]}px, ${workloadColumns.widths[column]}fr)`)
      .join(' '),
  }), [workloadColumns.widths]);
  const podGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: podColumnOrder
      .map(column => `minmax(${podColumnMinimums[column]}px, ${podColumns.widths[column]}fr)`)
      .join(' '),
  }), [podColumns.widths]);

  const load = useCallback(async () => {
    try {
      const res = await api.getInfrastructure(namespace || undefined);
      setData(res);
      setLastLoadedAt(Date.now());
    } catch (err) {
      console.error('load infrastructure:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const allPods = useMemo(() => dedupePods(data?.pods || []), [data]);

  const pods = useMemo(() => {
    const list = allPods;
    const q = query.toLowerCase();
    const filtered = query.trim()
      ? list.filter(p => p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q) || p.node.toLowerCase().includes(q))
      : list;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'risk':
          cmp = riskScore(a) - riskScore(b);
          break;
        case 'memory':
          cmp = a.memPct - b.memPct;
          break;
        case 'cpu':
          cmp = a.cpuPct - b.cpuPct;
          break;
        case 'restarts':
          cmp = a.restarts - b.restarts;
          break;
        case 'name':
          cmp = `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`);
          break;
        case 'node':
          cmp = (a.node || '').localeCompare(b.node || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [allPods, query, sortField, sortDir]);

  const s = data?.summary;
  const summaryCpuCapacity = s ? (s.cpuAllocatable || s.cpuCapacity || s.cpuLimit || 0) : 0;
  const summaryMemCapacity = s ? (s.memAllocatable || s.memCapacity || s.memLimit || 0) : 0;
  const summaryCpuCapacityLabel = s && (s.cpuAllocatable || s.cpuCapacity) ? t('allocatable') : t('pod limit');
  const summaryMemCapacityLabel = s && (s.memAllocatable || s.memCapacity) ? t('allocatable') : t('pod limit');
  const cpuPct = s && summaryCpuCapacity > 0 ? (s.cpuUsage / summaryCpuCapacity) * 100 : 0;
  const memPct = s && summaryMemCapacity > 0 ? (s.memUsage / summaryMemCapacity) * 100 : 0;
  const cpuCapacityDetail = summaryCpuCapacity > 0
    ? `${formatPercent(cpuPct)} ${t('of')} ${formatCpu(summaryCpuCapacity)} ${summaryCpuCapacityLabel}`
    : t('Capacity unavailable');
  const memCapacityDetail = summaryMemCapacity > 0
    ? `${formatPercent(memPct)} ${t('of')} ${formatMem(summaryMemCapacity)} ${summaryMemCapacityLabel}`
    : t('Capacity unavailable');
  const namespaces = useMemo(() => [...(data?.namespaces || [])].sort((a, b) => (b.atRisk - a.atRisk) || (b.memUsage - a.memUsage)), [data]);
  const namespaceMax = useMemo(() => ({
    pods: Math.max(1, ...namespaces.map(ns => ns.pods || 0)),
    cpuUsage: Math.max(1, ...namespaces.map(ns => ns.cpuUsage || 0)),
    memUsage: Math.max(1, ...namespaces.map(ns => ns.memUsage || 0))
  }), [namespaces]);
  const workloadGroups = useMemo<WorkloadGroup[]>(() => {
    const grouped = new Map<string, Omit<WorkloadGroup, 'nodes'> & { nodeNames: Set<string> }>();

    for (const pod of allPods) {
      const name = workloadNameFromPod(pod.name);
      const key = `${pod.namespace}/${name}`;
      const current = grouped.get(key);
      const score = riskScore(pod);

      if (!current) {
        const profile = workloadProfile(name, pod.namespace);
        grouped.set(key, {
          key,
          name,
          namespace: pod.namespace,
          icon: profile.icon,
          kind: profile.kind,
          pods: 1,
          cpuUsage: pod.cpuUsage,
          memUsage: pod.memUsage,
          cpuPct: pod.cpuPct,
          memPct: pod.memPct,
          restarts: pod.restarts,
          atRisk: pod.oomRisk || pod.cpuThrottle ? 1 : 0,
          nodeNames: new Set(pod.node ? [pod.node] : []),
          risk: score
        });
        continue;
      }

      current.pods += 1;
      current.cpuUsage += pod.cpuUsage;
      current.memUsage += pod.memUsage;
      current.cpuPct = Math.max(current.cpuPct, pod.cpuPct);
      current.memPct = Math.max(current.memPct, pod.memPct);
      current.restarts += pod.restarts;
      current.atRisk += pod.oomRisk || pod.cpuThrottle ? 1 : 0;
      current.risk = Math.max(current.risk, score);
      if (pod.node) current.nodeNames.add(pod.node);
    }

    return Array.from(grouped.values())
      .map(group => ({ ...group, nodes: Array.from(group.nodeNames) }))
      .sort((a, b) => (b.risk - a.risk) || (b.pods - a.pods) || a.name.localeCompare(b.name));
  }, [allPods]);
  const nodeGroups = useMemo<NodeGroup[]>(() => {
    if (data?.nodes?.length) {
      return [...data.nodes]
        .map(node => {
          const normalized = {
            ...node,
            role: node.role || nodeRole(node),
            cpuPct: node.cpuPct || resourcePercentFromNode(node, 'cpu'),
            memPct: node.memPct || resourcePercentFromNode(node, 'memory'),
            podPct: node.podPct || resourcePercentFromNode(node, 'pods')
          };
          return { ...normalized, risk: nodeRiskScore(normalized) };
        })
        .sort((a, b) => (b.risk - a.risk) || (b.atRisk - a.atRisk) || (b.pods - a.pods) || a.name.localeCompare(b.name));
    }

    const grouped = new Map<string, Omit<NodeGroup, 'namespaces'> & { namespaceNames: Set<string> }>();

    for (const pod of allPods) {
      const name = pod.node || 'unscheduled';
      const current = grouped.get(name);
      const score = riskScore(pod);

      if (!current) {
        grouped.set(name, {
          name,
          role: nodeRole({ name, role: '' }),
          pods: 1,
          namespaceNames: new Set(pod.namespace ? [pod.namespace] : []),
          cpuUsage: pod.cpuUsage,
          cpuCapacity: 0,
          cpuAllocatable: 0,
          totalCpuUsage: 0,
          cpuPct: 0,
          memUsage: pod.memUsage,
          memCapacity: 0,
          memAllocatable: 0,
          totalMemUsage: 0,
          memPct: 0,
          podCapacity: 0,
          podAllocatable: 0,
          podPct: 0,
          restarts: pod.restarts,
          atRisk: pod.oomRisk || pod.cpuThrottle ? 1 : 0,
          metricsAvailable: false,
          risk: score
        });
        continue;
      }

      current.pods += 1;
      current.cpuUsage += pod.cpuUsage;
      current.memUsage += pod.memUsage;
      current.restarts += pod.restarts;
      current.atRisk += pod.oomRisk || pod.cpuThrottle ? 1 : 0;
      current.risk = Math.max(current.risk, score);
      if (pod.namespace) current.namespaceNames.add(pod.namespace);
    }

    return Array.from(grouped.values())
      .map(group => ({
        ...group,
        namespaces: group.namespaceNames.size,
        cpuPct: 0,
        memPct: 0,
        podPct: 0
      }))
      .sort((a, b) => (b.risk - a.risk) || (b.pods - a.pods) || a.name.localeCompare(b.name));
  }, [allPods, data?.nodes]);
  const nodeMax = useMemo(() => ({
    pods: Math.max(1, ...nodeGroups.map(node => node.pods || 0)),
    cpuUsage: Math.max(1, ...nodeGroups.map(node => nodeCpuLoad(node) || 0)),
    memUsage: Math.max(1, ...nodeGroups.map(node => nodeMemLoad(node) || 0))
  }), [nodeGroups]);
  const masterNodes = useMemo(() => nodeGroups.filter(node => nodeRole(node) === 'master'), [nodeGroups]);
  const workerNodes = useMemo(() => nodeGroups.filter(node => nodeRole(node) === 'worker'), [nodeGroups]);
  const filteredNodeGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodeGroups;
    return nodeGroups.filter(node =>
      node.name.toLowerCase().includes(q) ||
      nodeRole(node).includes(q) ||
      (node.role || '').toLowerCase().includes(q)
    );
  }, [nodeGroups, query]);
  const filteredMasterNodes = useMemo(() => filteredNodeGroups.filter(node => nodeRole(node) === 'master'), [filteredNodeGroups]);
  const filteredWorkerNodes = useMemo(() => filteredNodeGroups.filter(node => nodeRole(node) === 'worker'), [filteredNodeGroups]);
  const filteredNamespaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return namespaces;
    return namespaces.filter(ns => ns.namespace.toLowerCase().includes(q));
  }, [namespaces, query]);
  const summaryPodCapacity = s ? (s.podAllocatable || s.podCapacity || 0) : 0;
  const podCapacityPct = summaryPodCapacity > 0 ? Math.min(100, (allPods.length / summaryPodCapacity) * 100) : 0;
  const workloadHealthCounts = useMemo(() => workloadGroups.reduce(
    (counts, workload) => {
      if (workload.atRisk > 0) counts.critical += 1;
      else if (workload.restarts > 0) counts.warning += 1;
      else counts.healthy += 1;
      return counts;
    },
    { healthy: 0, warning: 0, critical: 0 },
  ), [workloadGroups]);
  const workloadPressureLeaders = useMemo(() => [...workloadGroups]
    .sort((a, b) => Math.max(b.cpuPct || 0, b.memPct || 0) - Math.max(a.cpuPct || 0, a.memPct || 0))
    .slice(0, 6), [workloadGroups]);
  const podPressureValues = useMemo(
    () => allPods.map(pod => Math.max(pod.cpuPct || 0, pod.memPct || 0)),
    [allPods],
  );

  const filteredWorkloads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = !q ? workloadGroups : workloadGroups.filter(workload =>
      workload.name.toLowerCase().includes(q) ||
      workload.namespace.toLowerCase().includes(q) ||
      workload.kind.toLowerCase().includes(q) ||
      workload.nodes.some(node => node.toLowerCase().includes(q))
    );

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (workloadSortField) {
        case 'name':
          comparison = `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`);
          break;
        case 'health':
          comparison = a.risk - b.risk;
          break;
        case 'pods':
          comparison = a.pods - b.pods;
          break;
        case 'cpu':
          comparison = a.cpuPct - b.cpuPct;
          break;
        case 'memory':
          comparison = a.memPct - b.memPct;
          break;
        case 'restarts':
          comparison = a.restarts - b.restarts;
          break;
      }
      return workloadSortDir === 'asc' ? comparison : -comparison;
    });
  }, [query, workloadGroups, workloadSortDir, workloadSortField]);

  const visibleWorkloads = useMemo(() => filteredWorkloads.slice(0, workloadLimit), [filteredWorkloads, workloadLimit]);
  const visiblePods = useMemo(() => pods.slice(0, podLimit), [pods, podLimit]);

  useEffect(() => {
    setWorkloadLimit(workloadView === 'cards' ? 24 : 80);
  }, [namespace, query, workloadView]);

  useEffect(() => {
    setPodLimit(podView === 'cards' ? 60 : 120);
  }, [namespace, query, podView]);

  const setSort = (field: InfraSortField) => {
    if (field === sortField) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir(field === 'name' ? 'asc' : 'desc');
  };

  const setWorkloadSort = (field: WorkloadSortField) => {
    if (field === workloadSortField) {
      setWorkloadSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setWorkloadSortField(field);
    setWorkloadSortDir(field === 'name' ? 'asc' : 'desc');
  };

  const resizeWorkloadWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: WorkloadColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    workloadColumns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const resizePodWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: PodColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    podColumns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const tabItems = s ? [
    { key: 'applications' as InfraTab, label: t('Applications'), icon: INFRA_ICONS.apps, count: workloadGroups.length },
    { key: 'nodes' as InfraTab, label: t('Nodes'), icon: INFRA_ICONS.node, count: s.nodes },
    { key: 'namespaces' as InfraTab, label: t('Namespaces'), icon: INFRA_ICONS.namespace, count: namespaces.length },
    { key: 'pods' as InfraTab, label: t('Pods'), icon: INFRA_ICONS.route, count: allPods.length },
  ] : [];

  return (
    <div className="infra-page">
      <section className="apm-dashboard-header infrastructure-dashboard-header">
        <div className="apm-title-block">
          <h1>{t('Infrastructure')}</h1>
        </div>
        <div className="apm-header-meta">
          {s && s.pods > 0 && (
            <div className="apm-health-chips" aria-label={t('Application health')}>
              <span className="healthy">{workloadHealthCounts.healthy} {t('healthy')}</span>
              <span className="warning">{workloadHealthCounts.warning} {t('degraded')}</span>
              <span className="critical">{workloadHealthCounts.critical} {t('critical')}</span>
            </div>
          )}
          <div className="apm-live-pill">
            <span />
            {t('Live')}
          </div>
        </div>
      </section>

      {loading && !data ? (
        <LoadingState height={320} label={t('Loading cluster resources...')} />
      ) : !s || s.pods === 0 ? (
        <NoDataState height={320} title={t('No pod metrics yet')} hint={t('Resource usage appears once the agent reports pods with metrics-server enabled.')} />
      ) : (
        <>
          <section className="infra-cluster-overview" aria-label={t('Cluster overview')}>
            <article className="infra-fleet-overview">
              <div className="infra-fleet-overview-head">
                <h3>{t('Cluster')}</h3>
                <ul className="infra-cluster-stats">
                  <li><strong>{formatCompact(s.nodes)}</strong> {t('nodes')}</li>
                  <li><strong>{formatCompact(allPods.length)}</strong> {t('pods')}</li>
                  <li><strong>{formatCompact(workloadGroups.length)}</strong> {t('apps')}</li>
                  <li className={s.atRisk > 0 ? 'critical' : ''}><strong>{formatCompact(s.atRisk)}</strong> {t('at risk')}</li>
                </ul>
              </div>
              <div className="infra-fleet-overview-body">
                <HostMap nodes={nodeGroups} max={nodeMax} t={t} />
                <div className="infra-cluster-meters">
                  <FleetMeter label={t('CPU')} pct={cpuPct} value={cpuCapacityDetail} />
                  <FleetMeter label={t('Memory')} pct={memPct} value={memCapacityDetail} />
                  <FleetMeter
                    label={t('Pods')}
                    pct={podCapacityPct}
                    value={summaryPodCapacity > 0
                      ? `${formatCompact(allPods.length)} / ${formatCompact(summaryPodCapacity)}`
                      : formatCompact(allPods.length)}
                  />
                </div>
              </div>
            </article>
          </section>

          <InfraTabRail tabs={tabItems} active={activeTab} onChange={setActiveTab} />

          <div className="infra-tab-panel" key={activeTab}>
          {activeTab === 'applications' && (
            <>
              <SectionHeading eyebrow={t('Workload inventory')} title={t('Applications')} meta={`${formatCompact(visibleWorkloads.length)} / ${formatCompact(filteredWorkloads.length)} ${t('shown')}`} />
              <section className="infra-tab-insights">
                <InfraDistributionChart
                  eyebrow={t('Health')}
                  title={t('Application health')}
                  total={workloadGroups.length}
                  centerLabel={t('apps')}
                  segments={healthSegments(workloadHealthCounts, t)}
                />
                <InfraResourceBoard workloads={workloadPressureLeaders} t={t} />
              </section>
              <section className="infra-controls">
                <SearchBox query={query} onChange={setQuery} placeholder={t('Search applications, namespaces, nodes...')} />
                <ViewSwitch value={workloadView} onChange={setWorkloadView} t={t} />
              </section>

              <section className="infra-workloads-panel">
                {workloadView === 'list' && (
                  <InfraResizeToolbar onReset={workloadColumns.resetWidths} t={t} />
                )}
                <div className={workloadView === 'cards' ? 'infra-workload-grid' : 'infra-workload-list infra-workload-table-scroller'}>
                  {workloadView === 'list' && (
                    <WorkloadListHeader
                      t={t}
                      gridStyle={workloadGridStyle}
                      onResize={workloadColumns.startResize}
                      onResizeKey={resizeWorkloadWithKeyboard}
                      onReset={workloadColumns.resetWidths}
                      activeSort={workloadSortField}
                      sortDir={workloadSortDir}
                      onSort={setWorkloadSort}
                    />
                  )}
                  {visibleWorkloads.map(workload => (
                    workloadView === 'cards'
                      ? <WorkloadCard key={workload.key} workload={workload} t={t} />
                      : <WorkloadRow key={workload.key} workload={workload} t={t} gridStyle={workloadGridStyle} />
                  ))}
                </div>
                {visibleWorkloads.length < filteredWorkloads.length && (
                  <ShowMoreButton
                    label={t('Show more applications')}
                    remaining={filteredWorkloads.length - visibleWorkloads.length}
                    onClick={() => setWorkloadLimit(current => current + (workloadView === 'cards' ? 24 : 80))}
                    t={t}
                  />
                )}
              </section>
            </>
          )}

          {activeTab === 'nodes' && (
            <>
              <SectionHeading
                title={t('Nodes')}
                meta={`${formatCompact(filteredMasterNodes.length)} ${t('control plane')} / ${formatCompact(filteredWorkerNodes.length)} ${t('workers')}`}
              />
              <section className="infra-controls">
                <SearchBox query={query} onChange={setQuery} placeholder={t('Search nodes...')} />
                <ViewSwitch
                  value={nodeView}
                  onChange={setNodeView}
                  t={t}
                  options={[
                    { key: 'cards', label: t('Cards'), icon: INFRA_ICONS.apps },
                    { key: 'matrix', label: t('Matrix'), icon: INFRA_ICONS.topology },
                  ]}
                />
              </section>
              {nodeView === 'cards' ? (
                filteredNodeGroups.length === 0 ? (
                  <NoDataState height={180} title={t('No matching nodes')} hint={t('Try a different search.')} />
                ) : (
                  <section className="infra-nodes-panel">
                    <NodeRoleSection
                      nodes={filteredNodeGroups}
                      max={nodeMax}
                      t={t}
                      updatedAgoLabel={formatAgoLabel(lastLoadedAt, clock)}
                      onViewNode={(name) => {
                        setQuery(name);
                        setActiveTab('pods');
                      }}
                    />
                  </section>
                )
              ) : filteredNodeGroups.length === 0 ? (
                <NoDataState height={180} title={t('No matching nodes')} hint={t('Try a different search.')} />
              ) : (
                <InfraNodeMatrix nodes={filteredNodeGroups} max={nodeMax} t={t} />
              )}
            </>
          )}

          {activeTab === 'namespaces' && (
            <>
              <SectionHeading
                eyebrow={t('Resource scope')}
                title={t('Namespaces by resource use')}
                meta={`${formatCompact(filteredNamespaces.length)} ${t('namespaces')}`}
              />
              <section className="infra-controls">
                <SearchBox query={query} onChange={setQuery} placeholder={t('Search namespaces...')} />
                <ViewSwitch
                  value={namespaceView}
                  onChange={setNamespaceView}
                  t={t}
                  options={[
                    { key: 'cards', label: t('Cards'), icon: INFRA_ICONS.apps },
                    { key: 'map', label: t('Map'), icon: INFRA_ICONS.namespace },
                  ]}
                />
              </section>
              {namespaceView === 'cards' ? (
                filteredNamespaces.length === 0 ? (
                  <NoDataState height={180} title={t('No matching namespaces')} hint={t('Try a different search.')} />
                ) : (
                  <section className="infra-namespace-panel">
                    <div className="infra-ns-grid">
                      {filteredNamespaces.map(ns => (
                        <NamespaceCard key={ns.namespace} ns={ns} max={namespaceMax} t={t} />
                      ))}
                    </div>
                  </section>
                )
              ) : filteredNamespaces.length === 0 ? (
                <NoDataState height={180} title={t('No matching namespaces')} hint={t('Try a different search.')} />
              ) : (
                <InfraNamespaceFootprint namespaces={filteredNamespaces} max={namespaceMax} t={t} />
              )}
            </>
          )}

          {activeTab === 'pods' && (
            <>
              <SectionHeading eyebrow={t('Runtime detail')} title={t('Pods')} meta={`${formatCompact(visiblePods.length)} / ${formatCompact(pods.length)} ${t('shown')}`} />
              <section className="infra-single-insight">
                <InfraPressureHistogram values={podPressureValues} t={t} />
              </section>
              <section className="infra-controls">
                <SearchBox query={query} onChange={setQuery} placeholder={t('Search pods, namespaces, nodes...')} />
                <div className="infra-sort-controls" aria-label={t('Sort pods')}>
                  <ViewSwitch value={podView} onChange={setPodView} t={t} />
                </div>
              </section>

              <section className={`infra-list ${podView === 'list' ? 'is-list' : 'is-cards'}`} aria-label={t('Pods')} key={`pods-${podView}`}>
                {podView === 'list' ? (
                  <>
                    <InfraResizeToolbar onReset={podColumns.resetWidths} t={t} />
                    <div className="infra-pod-table-scroller">
                      <div className="infra-pod-table">
                        <PodListHeader
                          t={t}
                          gridStyle={podGridStyle}
                          onResize={podColumns.startResize}
                          onResizeKey={resizePodWithKeyboard}
                          onReset={podColumns.resetWidths}
                          activeSort={sortField}
                          sortDir={sortDir}
                          onSort={setSort}
                        />
                        {visiblePods.map(p => <PodRow key={podIdentityKey(p)} pod={p} t={t} gridStyle={podGridStyle} />)}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="infra-pod-card-grid">
                    {visiblePods.map(p => <PodCard key={podIdentityKey(p)} pod={p} t={t} />)}
                  </div>
                )}
                {visiblePods.length < pods.length && (
                  <ShowMoreButton
                    label={t('Show more pods')}
                    remaining={pods.length - visiblePods.length}
                    onClick={() => setPodLimit(current => current + (podView === 'cards' ? 60 : 120))}
                    t={t}
                  />
                )}
              </section>
            </>
          )}
          </div>
        </>
      )}
    </div>
  );
}

function healthSegments(
  counts: { healthy: number; warning: number; critical: number },
  t: (k: string) => string,
): InfraDistributionSegment[] {
  return [
    { label: t('Healthy'), value: counts.healthy, color: STATUS_COLORS.healthy },
    { label: t('Attention'), value: counts.warning, color: STATUS_COLORS.warning },
    { label: t('Critical'), value: counts.critical, color: STATUS_COLORS.critical },
  ];
}

function InfraChartHeading({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="infra-chart-heading">
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      {meta && <em>{meta}</em>}
    </div>
  );
}

function InfraCapacityChart({
  cpu,
  memory,
  pods,
  podLabel,
  t,
}: {
  cpu: number;
  memory: number;
  pods: number;
  podLabel: string;
  t: (k: string) => string;
}) {
  const metrics = [
    { label: t('CPU'), value: cpu, valueLabel: formatPercent(cpu), color: SERIES_COLORS[0] },
    { label: t('Memory'), value: memory, valueLabel: formatPercent(memory), color: SERIES_COLORS[2] },
    { label: t('Pods'), value: pods, valueLabel: podLabel, color: SERIES_COLORS[1] },
  ];
  const peak = Math.max(cpu, memory, pods);

  return (
    <article className="infra-chart-card infra-capacity-chart">
      <InfraChartHeading
        eyebrow={t('Capacity')}
        title={t('Cluster saturation')}
        meta={`${formatPercent(peak)} ${t('peak')}`}
      />
      <div className="infra-capacity-list">
        {metrics.map(metric => (
          <div className="infra-capacity-row" key={metric.label}>
            <div>
              <strong>{metric.label}</strong>
              <span>{metric.valueLabel}</span>
            </div>
            <div className="infra-capacity-track">
              <i
                style={{
                  width: `${Math.min(100, Math.max(0, metric.value))}%`,
                  background: metric.color,
                }}
              />
            </div>
            <div className="infra-capacity-scale">
              <span>{formatPercent(metric.value)} {t('used')}</span>
              <em>{formatPercent(Math.max(0, 100 - metric.value))} {t('available')}</em>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function InfraDistributionChart({
  eyebrow,
  title,
  total,
  centerLabel,
  segments,
}: {
  eyebrow: string;
  title: string;
  total: number;
  centerLabel: string;
  segments: InfraDistributionSegment[];
}) {
  let cursor = 0;
  const gradientStops = segments.map(segment => {
    const start = cursor;
    cursor += total > 0 ? (segment.value / total) * 100 : 0;
    return `${segment.color} ${start}% ${cursor}%`;
  });
  const chartBackground = total > 0
    ? `conic-gradient(${gradientStops.join(', ')})`
    : 'conic-gradient(var(--bg-tertiary) 0 100%)';

  return (
    <article className="infra-chart-card infra-distribution-chart">
      <InfraChartHeading eyebrow={eyebrow} title={title} meta={formatCompact(total)} />
      <div className="infra-distribution-body">
        <div
          className="infra-distribution-donut"
          style={{ background: chartBackground }}
          aria-label={`${title} distribution`}
        >
          <div>
            <strong>{formatCompact(total)}</strong>
            <span>{centerLabel}</span>
          </div>
        </div>
        <div className="infra-distribution-legend">
          {segments.map(segment => (
            <div key={segment.label}>
              <i style={{ background: segment.color }} />
              <span>{segment.label}</span>
              <strong>{formatCompact(segment.value)}</strong>
              <em>{total > 0 ? `${Math.round((segment.value / total) * 100)}%` : '0%'}</em>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function InfraResourceBoard({
  workloads,
  t,
}: {
  workloads: WorkloadGroup[];
  t: (k: string) => string;
}) {
  return (
    <article className="infra-chart-card infra-resource-board">
      <InfraChartHeading eyebrow={t('Pressure')} title={t('Resource leaders')} meta={`${t('Top')} ${formatCompact(workloads.length)}`} />
      <div className="infra-resource-leader-list">
        <div className="infra-resource-leader-labels" aria-hidden="true">
          <span>{t('Application')}</span>
          <span>{t('CPU')}</span>
          <span>{t('Memory')}</span>
          <span>{t('Peak')}</span>
        </div>
        {workloads.length > 0 ? workloads.map((workload, index) => {
          const peak = Math.max(workload.cpuPct || 0, workload.memPct || 0);
          const tone: InfraTone = workload.atRisk > 0 || peak >= 90
            ? 'critical'
            : workload.restarts > 0 || peak >= 75
              ? 'warning'
              : 'ok';
          const pressureLabel = tone === 'critical'
            ? t('Critical')
            : tone === 'warning'
              ? t('Watch')
              : t('Stable');
          return (
            <div className={`infra-resource-leader-row ${tone}`} key={workload.key}>
              <div className="infra-resource-leader-identity">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong title={workload.name}>{workload.name}</strong>
                  <em>{workload.namespace} · {formatCompact(workload.pods)} {t('pods')}</em>
                </div>
              </div>
              <div className="infra-resource-leader-meter cpu">
                <div>
                  <span>{t('CPU')}</span>
                  <strong>{formatPercent(workload.cpuPct)}</strong>
                </div>
                <div className="infra-resource-leader-track">
                  <i style={{ width: `${Math.max(2, Math.min(100, workload.cpuPct))}%` }} />
                </div>
              </div>
              <div className="infra-resource-leader-meter memory">
                <div>
                  <span>{t('Memory')}</span>
                  <strong>{formatPercent(workload.memPct)}</strong>
                </div>
                <div className="infra-resource-leader-track">
                  <i style={{ width: `${Math.max(2, Math.min(100, workload.memPct))}%` }} />
                </div>
              </div>
              <div className={`infra-resource-leader-peak ${tone}`}>
                <strong>{formatPercent(peak)}</strong>
                <span>{pressureLabel}</span>
              </div>
            </div>
          );
        }) : (
          <div className="infra-chart-empty">{t('No resource data')}</div>
        )}
        {workloads.length > 0 && (
          <div className="infra-resource-leader-scale">
            <span>{t('Normal')} &lt; 75%</span>
            <span>{t('Watch')} 75–89%</span>
            <span>{t('Critical')} ≥ 90%</span>
          </div>
        )}
      </div>
    </article>
  );
}

function InfraNodeMatrix({
  nodes,
  max,
  t,
}: {
  nodes: NodeGroup[];
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
}) {
  const [sortField, setSortField] = useState<NodeMatrixSortField>('health');
  const [sortDir, setSortDir] = useState<InfraSortDir>('desc');
  const columns = useColumnResize(nodeMatrixColumnWidths, {
    minWidths: nodeMatrixColumnMinimums,
    storageKey: 'infrastructureNodeColumnsV1',
  });
  const gridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: nodeMatrixColumnOrder.map(column => `${columns.widths[column]}px`).join(' '),
  }), [columns.widths]);
  const sortedNodes = useMemo(() => [...nodes].sort((a, b) => {
    const aCpu = capacityPercent(nodeCpuLoad(a), nodeCpuCapacity(a), max.cpuUsage);
    const bCpu = capacityPercent(nodeCpuLoad(b), nodeCpuCapacity(b), max.cpuUsage);
    const aMemory = capacityPercent(nodeMemLoad(a), nodeMemCapacity(a), max.memUsage);
    const bMemory = capacityPercent(nodeMemLoad(b), nodeMemCapacity(b), max.memUsage);
    const aPods = capacityPercent(a.pods, nodePodCapacity(a), max.pods);
    const bPods = capacityPercent(b.pods, nodePodCapacity(b), max.pods);
    let comparison = 0;
    switch (sortField) {
      case 'node':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'cpu':
        comparison = aCpu - bCpu;
        break;
      case 'memory':
        comparison = aMemory - bMemory;
        break;
      case 'pods':
        comparison = aPods - bPods;
        break;
      case 'health':
        comparison = Math.max(aCpu, aMemory, aPods, a.risk) - Math.max(bCpu, bMemory, bPods, b.risk);
        break;
    }
    return sortDir === 'asc' ? comparison : -comparison;
  }), [max.cpuUsage, max.memUsage, max.pods, nodes, sortDir, sortField]);

  const setSort = (field: NodeMatrixSortField) => {
    if (field === sortField) {
      setSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDir(field === 'node' ? 'asc' : 'desc');
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: NodeMatrixColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    columns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  return (
    <article className="infra-chart-card infra-node-matrix-card">
      <InfraChartHeading eyebrow={t('Capacity')} title={t('Node resource matrix')} meta={`${formatCompact(nodes.length)} ${t('nodes')}`} />
      <InfraResizeToolbar onReset={columns.resetWidths} t={t} />
      <div className="infra-node-matrix-scroller">
      <div className="infra-node-matrix" role="table" aria-label={t('Node resource matrix')}>
        <div className="infra-node-matrix-head" style={gridStyle} role="row">
          <InfraColumnHeader column="node" label={t('Node')} sortField="node" activeSort={sortField} sortDir={sortDir} onSort={setSort} onResize={columns.startResize} onResizeKey={resizeWithKeyboard} onReset={columns.resetWidths} />
          <InfraColumnHeader column="cpu" label={t('CPU')} sortField="cpu" activeSort={sortField} sortDir={sortDir} onSort={setSort} onResize={columns.startResize} onResizeKey={resizeWithKeyboard} onReset={columns.resetWidths} />
          <InfraColumnHeader column="memory" label={t('Memory')} sortField="memory" activeSort={sortField} sortDir={sortDir} onSort={setSort} onResize={columns.startResize} onResizeKey={resizeWithKeyboard} onReset={columns.resetWidths} />
          <InfraColumnHeader column="pods" label={t('Pods')} sortField="pods" activeSort={sortField} sortDir={sortDir} onSort={setSort} onResize={columns.startResize} onResizeKey={resizeWithKeyboard} onReset={columns.resetWidths} />
          <InfraColumnHeader column="health" label={t('Health')} sortField="health" activeSort={sortField} sortDir={sortDir} onSort={setSort} onResize={columns.startResize} onResizeKey={resizeWithKeyboard} onReset={columns.resetWidths} isLast />
        </div>
        {sortedNodes.map(node => {
          const cpu = capacityPercent(nodeCpuLoad(node), nodeCpuCapacity(node), max.cpuUsage);
          const memory = capacityPercent(nodeMemLoad(node), nodeMemCapacity(node), max.memUsage);
          const podsUsed = capacityPercent(node.pods, nodePodCapacity(node), max.pods);
          const pressure = Math.max(cpu, memory, podsUsed);
          const tone: InfraTone = node.atRisk > 0 || pressure >= 90
            ? 'critical'
            : node.restarts > 0 || pressure >= 75
              ? 'warning'
              : 'ok';
          return (
            <div className="infra-node-matrix-row" style={gridStyle} role="row" key={node.name}>
              <div className="infra-node-matrix-name">
                <i className={tone} />
                <div>
                  <strong>{node.name}</strong>
                  <span>{nodeRole(node) === 'master' ? t('Master') : t('Worker')} · {formatCompact(node.pods)} {t('pods')}</span>
                </div>
              </div>
              <InfraHeatCell value={cpu} detail={formatCpu(nodeCpuLoad(node))} color={SERIES_COLORS[0]} />
              <InfraHeatCell value={memory} detail={formatMem(nodeMemLoad(node))} color={SERIES_COLORS[2]} />
              <InfraHeatCell value={podsUsed} detail={formatCompact(node.pods)} color={SERIES_COLORS[1]} />
              <div className="infra-node-health-cell">
                <span className={`infra-status-chip ${tone}`}>
                  <IconPack src={statusIconForTone(tone)} size={12} />
                  {statusLabelForTone(tone, t)}
                </span>
                <em>{formatCompact(node.restarts)} {t('restarts')}</em>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </article>
  );
}

function InfraHeatCell({ value, detail, color }: { value: number; detail: string; color: string }) {
  const heatStyle = {
    '--infra-heat': `${Math.max(5, Math.min(24, 5 + value * 0.19))}%`,
    '--infra-heat-color': color,
  } as CSSProperties;

  return (
    <div className="infra-heat-cell" style={heatStyle}>
      <strong>{formatPercent(value)}</strong>
      <span>{detail}</span>
    </div>
  );
}

function InfraNamespaceFootprint({
  namespaces,
  max,
  t,
}: {
  namespaces: InfraNamespace[];
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
}) {
  return (
    <article className="infra-chart-card infra-namespace-footprint">
      <InfraChartHeading eyebrow={t('Footprint')} title={t('Namespace resource map')} meta={`${formatCompact(namespaces.length)} ${t('namespaces')}`} />
      <div className="infra-namespace-map">
        {namespaces.map(ns => {
          const cpu = relativePercent(ns.cpuUsage, max.cpuUsage);
          const memory = relativePercent(ns.memUsage, max.memUsage);
          const podShare = relativePercent(ns.pods, max.pods);
          const tone: InfraTone = ns.atRisk > 0 ? 'critical' : ns.restarts > 0 ? 'warning' : 'ok';
          const tileStyle = {
            '--infra-footprint': `${Math.max(4, Math.min(17, 4 + Math.max(cpu, memory, podShare) * 0.13))}%`,
          } as CSSProperties;
          return (
            <div className={`infra-namespace-map-tile ${tone}`} style={tileStyle} key={ns.namespace}>
              <div className="infra-namespace-map-head">
                <i />
                <strong title={ns.namespace}>{ns.namespace}</strong>
                <span>{formatCompact(ns.pods)} {t('pods')}</span>
              </div>
              <div className="infra-namespace-map-metrics">
                <div>
                  <span>{t('CPU')}</span>
                  <strong>{formatCpu(ns.cpuUsage)}</strong>
                  <em>{formatPercent(cpu)} {t('share')}</em>
                </div>
                <div>
                  <span>{t('Memory')}</span>
                  <strong>{formatMem(ns.memUsage)}</strong>
                  <em>{formatPercent(memory)} {t('share')}</em>
                </div>
                <div>
                  <span>{t('Restarts')}</span>
                  <strong>{formatCompact(ns.restarts)}</strong>
                  <em>{ns.atRisk > 0 ? `${formatCompact(ns.atRisk)} ${t('at risk')}` : t('Stable')}</em>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function InfraPressureHistogram({ values, t }: { values: number[]; t: (k: string) => string }) {
  const buckets = [
    { label: '0–25%', min: 0, max: 25, color: HEAT_SCALE[0] },
    { label: '25–50%', min: 25, max: 50, color: HEAT_SCALE[1] },
    { label: '50–75%', min: 50, max: 75, color: HEAT_SCALE[2] },
    { label: '75–90%', min: 75, max: 90, color: HEAT_SCALE[3] },
    { label: '90%+', min: 90, max: Number.POSITIVE_INFINITY, color: HEAT_SCALE[4] },
  ].map(bucket => ({
    ...bucket,
    count: values.filter(value => value >= bucket.min && value < bucket.max).length,
  }));
  const maxCount = Math.max(1, ...buckets.map(bucket => bucket.count));

  return (
    <article className="infra-chart-card infra-pressure-chart">
      <InfraChartHeading eyebrow={t('Pressure')} title={t('Pod pressure distribution')} meta={`${formatCompact(values.length)} ${t('pods')}`} />
      <div className="infra-histogram">
        {buckets.map(bucket => (
          <div className="infra-histogram-column" key={bucket.label}>
            <strong>{formatCompact(bucket.count)}</strong>
            <div>
              <i
                style={{
                  height: `${Math.max(bucket.count > 0 ? 10 : 2, (bucket.count / maxCount) * 100)}%`,
                  background: bucket.color,
                }}
              />
            </div>
            <span>{bucket.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function InfraResizeToolbar({ onReset, t }: { onReset: () => void; t: (k: string) => string }) {
  return (
    <div className="infra-resize-toolbar">
      <span><GripVertical size={13} /> {t('Drag column edges to resize')}</span>
      <button type="button" onClick={onReset}>
        <RotateCcw size={13} />
        {t('Reset columns')}
      </button>
    </div>
  );
}

function InfraColumnHeader<C extends string>({
  column,
  label,
  sortField,
  activeSort,
  sortDir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
  isLast = false,
}: {
  column: C;
  label: string;
  sortField?: string;
  activeSort?: string;
  sortDir?: InfraSortDir;
  onSort?: (field: any) => void;
  onResize: (event: React.MouseEvent, column: C) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLButtonElement>, column: C) => void;
  onReset: () => void;
  isLast?: boolean;
}) {
  const active = Boolean(sortField && activeSort === sortField);
  return (
    <div className={`infra-column-head ${active ? 'active' : ''}`} role="columnheader" aria-sort={sortField ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
      {sortField && onSort ? (
        <button type="button" className="infra-column-sort" onClick={() => onSort(sortField)}>
          {label}
          {active && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      ) : (
        <span>{label}</span>
      )}
      {!isLast && (
        <button
          type="button"
          className="infra-column-resizer"
          aria-label={`Resize ${label} column`}
          title="Drag to resize · Arrow keys resize · Double click resets"
          onMouseDown={event => onResize(event, column)}
          onKeyDown={event => onResizeKey(event, column)}
          onDoubleClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }}
        >
          <GripVertical size={13} />
        </button>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone,
  icon,
  meter,
}: {
  label: string;
  value: string;
  detail: string;
  tone: InfraTone;
  icon: string;
  meter?: React.ReactNode;
}) {
  return (
    <div className={`infra-summary-card ${tone}`}>
      <div className="infra-summary-top">
        <span className="infra-summary-icon">
          <IconPack src={icon} />
        </span>
        <span>{label}</span>
        <i />
      </div>
      <strong>{value}</strong>
      <em>{detail}</em>
      {meter}
    </div>
  );
}

function SystemTile({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="infra-system-tile">
      <span className="infra-system-logo">
        <InfraLogo src={icon} size={22} />
      </span>
      <span>
        <em>{label}</em>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

function InfraLogo({ src, size }: { src: string; size: number }) {
  if (!usesBrandPaint(src)) {
    return <IconPack src={src} size={size} />;
  }

  return <img src={src} alt="" style={{ width: size, height: size }} />;
}

function MetricBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'critical' | 'warning' | 'neutral' }) {
  return (
    <div className={`infra-metric-box ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function ResourceBar({ label, value, pct, tone = 'info' }: { label: string; value: string; pct: number; tone?: InfraTone }) {
  return (
    <div className="infra-resource-bar">
      <div className="infra-resource-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="infra-resource-track">
        <div className={`infra-resource-fill ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

function InfraTabRail({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: InfraTab; label: string; icon: string; count?: number }[];
  active: InfraTab;
  onChange: (tab: InfraTab) => void;
}) {
  return (
    <div className="infra-tab-rail" role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? 'active' : ''}
          onClick={() => onChange(tab.key)}
        >
          <IconPack src={tab.icon} size={16} />
          <span>{tab.label}</span>
          {tab.count !== undefined && <em>{formatCompact(tab.count)}</em>}
        </button>
      ))}
    </div>
  );
}

function SectionHeading({ eyebrow, title, meta }: { eyebrow?: string; title: string; meta?: string }) {
  return (
    <div className="infra-section-heading">
      <div>
        {eyebrow ? <span>{eyebrow}</span> : null}
        <h2>{title}</h2>
      </div>
      {meta && <em>{meta}</em>}
    </div>
  );
}

function InfrastructureMethodPanel({ hasNodeCapacity, t }: { hasNodeCapacity: boolean; t: (k: string) => string }) {
  return (
    <section className="infra-method-panel" aria-label={t('Infrastructure calculation rules')}>
      <div>
        <span className="infra-method-icon">
          <IconPack src={INFRA_ICONS.topology} size={17} />
        </span>
        <div>
          <strong>{t('How nodes are ranked')}</strong>
          <p>{t('Busiest nodes sort by at-risk pods first, then CPU pressure, memory pressure, pod density, and pod count.')}</p>
        </div>
      </div>
      <div>
        <span className="infra-method-icon warning">
          <IconPack src={INFRA_ICONS.alert} size={17} />
        </span>
        <div>
          <strong>{t('How risk is detected')}</strong>
          <p>{t('A pod is at risk at 85% memory limit or 90% CPU limit. Restarting means restarts exist but no pod is over those limits.')}</p>
        </div>
      </div>
      <div>
        <span className="infra-method-icon ok">
          <IconPack src={INFRA_ICONS.node} size={17} />
        </span>
        <div>
          <strong>{t('Capacity source')}</strong>
          <p>{hasNodeCapacity ? t('Bars compare usage with Kubernetes node allocatable resources.') : t('Node capacity is not reported yet, so bars fall back to relative usage inside the current list.')}</p>
        </div>
      </div>
    </section>
  );
}

function SearchBox({ query, onChange, placeholder }: { query: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="infra-search">
      <IconPack src="/observability-icons/focus-centered.svg" size={15} />
      <input
        placeholder={placeholder}
        value={query}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function ViewSwitch<T extends string>({
  value,
  onChange,
  t,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  t: (k: string) => string;
  options?: { key: T; label: string; icon: string }[];
}) {
  const items = options ?? [
    { key: 'cards' as T, label: t('Cards'), icon: INFRA_ICONS.apps },
    { key: 'list' as T, label: t('List'), icon: '/observability-icons/sitemap.svg' },
  ];

  return (
    <div className="infra-view-switch" role="group" aria-label={t('View mode')}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          className={value === item.key ? 'active' : ''}
          onClick={() => onChange(item.key)}
        >
          <IconPack src={item.icon} size={14} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ShowMoreButton({ label, remaining, onClick, t }: { label: string; remaining: number; onClick: () => void; t: (k: string) => string }) {
  return (
    <div className="infra-show-more-wrap">
      <button type="button" className="infra-show-more" onClick={onClick}>
        {label}
        <span>{formatCompact(remaining)} {t('remaining')}</span>
      </button>
    </div>
  );
}

function WorkloadCard({ workload, t }: { workload: WorkloadGroup; t: (k: string) => string }) {
  const tone: InfraTone = workload.atRisk > 0 ? 'critical' : workload.restarts > 0 ? 'warning' : 'ok';
  const cpuTone = pressureTone(workload.cpuPct);
  const memTone = pressureTone(workload.memPct);

  return (
    <article className={`infra-fleet-card infra-workload-card ${tone}`}>
      <div className="infra-fleet-identity">
        <span className="infra-app-logo">
          <InfraLogo src={workload.icon} size={22} />
        </span>
        <div>
          <strong>{workload.name}</strong>
          <span>{workload.namespace} · {workload.kind}</span>
        </div>
        <span className={`infra-status-chip ${tone}`}>
          <IconPack src={statusIconForTone(tone)} size={12} />
          {statusLabelForTone(tone, t)}
        </span>
      </div>
      <div className="infra-fleet-meters">
        <FleetMeter label={t('CPU')} pct={workload.cpuPct} value={formatCpu(workload.cpuUsage)} tone={cpuTone} />
        <FleetMeter label={t('Memory')} pct={workload.memPct} value={formatMem(workload.memUsage)} tone={memTone} />
      </div>
      <div className="infra-fleet-inspections">
        <InspectChip label={t('CPU')} tone={cpuTone} t={t} />
        <InspectChip label={t('Memory')} tone={memTone} t={t} />
        <span>{formatCompact(workload.pods)} {t('pods')}</span>
        <span>{formatCompact(workload.nodes.length)} {t('nodes')}</span>
        <span className={workload.restarts > 0 ? 'warning' : ''}>{formatCompact(workload.restarts)} {t('restarts')}</span>
      </div>
    </article>
  );
}

function WorkloadListHeader({
  t,
  gridStyle,
  activeSort,
  sortDir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
}: {
  t: (k: string) => string;
  gridStyle: CSSProperties;
  activeSort: WorkloadSortField;
  sortDir: InfraSortDir;
  onSort: (field: WorkloadSortField) => void;
  onResize: (event: React.MouseEvent, column: WorkloadColumn) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLButtonElement>, column: WorkloadColumn) => void;
  onReset: () => void;
}) {
  return (
    <div className="infra-workload-row infra-workload-row-head is-table-row" style={gridStyle} role="row">
      <InfraColumnHeader column="application" label={t('Application')} sortField="name" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="health" label={t('Health')} sortField="health" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="pods" label={t('Pods')} sortField="pods" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="cpu" label={t('CPU')} sortField="cpu" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="memory" label={t('Memory')} sortField="memory" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="restarts" label={t('Restarts')} sortField="restarts" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} isLast />
    </div>
  );
}

function WorkloadRow({
  workload,
  t,
  gridStyle,
}: {
  workload: WorkloadGroup;
  t: (k: string) => string;
  gridStyle?: CSSProperties;
}) {
  const tone: InfraTone = workload.atRisk > 0 ? 'critical' : workload.restarts > 0 ? 'warning' : 'ok';

  return (
    <div className={`infra-workload-row ${tone} ${gridStyle ? 'is-table-row' : ''}`} style={gridStyle}>
      <div className="infra-workload-main">
        <span className="infra-app-logo">
          <InfraLogo src={workload.icon} size={24} />
        </span>
        <div>
          <strong>{workload.name}</strong>
          <span>{workload.namespace} / {workload.kind}</span>
        </div>
      </div>
      <div className="infra-status-cell">
        <span className={`infra-status-chip ${tone}`}>
          <IconPack src={statusIconForTone(tone)} size={12} />
          {statusLabelForTone(tone, t)}
        </span>
      </div>
      <span className="infra-workload-number">{formatCompact(workload.pods)}</span>
      <div className="infra-cell">
        <UsageBar pct={workload.cpuPct} label={formatCpu(workload.cpuUsage)} compact />
      </div>
      <div className="infra-cell">
        <UsageBar pct={workload.memPct} label={formatMem(workload.memUsage)} compact />
      </div>
      <span className={`infra-workload-number ${workload.restarts > 0 ? 'warning' : ''}`}>{formatCompact(workload.restarts)}</span>
    </div>
  );
}

function NamespaceCard({
  ns,
  max,
  t
}: {
  ns: InfraNamespace;
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
}) {
  const tone: InfraTone = ns.atRisk > 0 ? 'critical' : ns.restarts > 0 ? 'warning' : 'ok';
  const status = ns.atRisk > 0 ? t('Needs attention') : ns.restarts > 0 ? t('Restarts') : t('Healthy');
  const cpuShare = relativePercent(ns.cpuUsage, max.cpuUsage);
  const memShare = relativePercent(ns.memUsage, max.memUsage);
  const podShare = relativePercent(ns.pods, max.pods);

  return (
    <div className={`infra-ns-card ${tone}`}>
      <div className="infra-ns-card-head">
        <div className="infra-ns-title">
          <span className="infra-ns-logo">
            <IconPack src={INFRA_ICONS.namespace} size={17} />
          </span>
          <div>
            <strong>{ns.namespace}</strong>
            <span>{formatCompact(ns.pods)} {t('pods')}</span>
          </div>
        </div>
        <span className={`infra-status-chip ${tone}`}>
          <IconPack src={tone === 'ok' ? INFRA_ICONS.check : tone === 'warning' ? INFRA_ICONS.clock : INFRA_ICONS.alert} size={12} />
          {status}
        </span>
      </div>

      <div className="infra-ns-resource-stack">
        <div className="infra-fleet-meters">
          <FleetMeter label={t('CPU share')} pct={cpuShare} value={formatCpu(ns.cpuUsage)} />
          <FleetMeter label={t('Memory share')} pct={memShare} value={formatMem(ns.memUsage)} />
          <FleetMeter label={t('Pod density')} pct={podShare} value={formatCompact(ns.pods)} />
        </div>
      </div>

      <div className="infra-ns-footer">
        <MetricPair label={t('Risk pods')} value={formatCompact(ns.atRisk)} />
        <MetricPair label={t('Restarts')} value={formatCompact(ns.restarts)} />
      </div>
    </div>
  );
}

function NodeRoleSection({
  title,
  nodes,
  max,
  t,
  updatedAgoLabel,
  onViewNode,
}: {
  title?: string;
  nodes: NodeGroup[];
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
  updatedAgoLabel: string;
  onViewNode?: (name: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <div className="infra-node-role-section">
      {title ? (
        <div className="infra-node-role-head">
          <strong>{title}</strong>
          <span>{formatCompact(nodes.length)} {t('nodes')}</span>
        </div>
      ) : null}
      <div className="infra-node-grid">
        {nodes.map(node => (
          <NodeCard
            key={node.name}
            node={node}
            max={max}
            t={t}
            updatedAgoLabel={updatedAgoLabel}
            onViewDetails={onViewNode ? () => onViewNode(node.name) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function NodeCard({
  node,
  max,
  t,
  updatedAgoLabel,
  onViewDetails,
}: {
  node: NodeGroup;
  max: { pods: number; cpuUsage: number; memUsage: number };
  t: (k: string) => string;
  updatedAgoLabel: string;
  onViewDetails?: () => void;
}) {
  const cpuLoad = nodeCpuLoad(node);
  const memLoad = nodeMemLoad(node);
  const cpuCapacity = nodeCpuCapacity(node);
  const memCapacity = nodeMemCapacity(node);
  const podCapacity = nodePodCapacity(node);
  const cpuShare = capacityPercent(cpuLoad, cpuCapacity, max.cpuUsage);
  const memShare = capacityPercent(memLoad, memCapacity, max.memUsage);
  const podShare = capacityPercent(node.pods, podCapacity, max.pods);
  const role = nodeRole(node);
  const status = nodeHealthStatus(node);

  return (
    <NodeHealthCard
      name={node.name}
      role={role === 'master' ? 'control-plane' : 'worker'}
      namespaceCount={node.namespaces}
      podCount={node.pods}
      status={status}
      riskReason={nodeRiskReason(node, t)}
      updatedAgoLabel={updatedAgoLabel}
      onViewDetails={onViewDetails}
      metrics={[
        {
          key: 'cpu',
          label: t('CPU'),
          percent: cpuShare,
          usedLabel: formatCpu(cpuLoad),
          totalLabel: cpuCapacity > 0 ? formatCpu(cpuCapacity) : '—',
        },
        {
          key: 'memory',
          label: t('Memory'),
          percent: memShare,
          usedLabel: formatMem(memLoad),
          totalLabel: memCapacity > 0 ? formatMem(memCapacity) : '—',
        },
        {
          key: 'pods',
          label: t('Pods'),
          percent: podShare,
          usedLabel: formatCompact(node.pods),
          totalLabel: podCapacity > 0 ? formatCompact(podCapacity) : '—',
        },
      ]}
    />
  );
}

function PodListHeader({
  t,
  gridStyle,
  activeSort,
  sortDir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
}: {
  t: (k: string) => string;
  gridStyle: CSSProperties;
  activeSort: InfraSortField;
  sortDir: InfraSortDir;
  onSort: (field: InfraSortField) => void;
  onResize: (event: React.MouseEvent, column: PodColumn) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLButtonElement>, column: PodColumn) => void;
  onReset: () => void;
}) {
  return (
    <div className="infra-pod-table-row infra-pod-table-head" style={gridStyle} role="row">
      <InfraColumnHeader column="pod" label={t('Pod')} sortField="name" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="node" label={t('Node')} sortField="node" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="cpu" label={t('CPU')} sortField="cpu" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="memory" label={t('Memory')} sortField="memory" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="restarts" label={t('Restarts')} sortField="restarts" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} />
      <InfraColumnHeader column="status" label={t('Status')} sortField="risk" activeSort={activeSort} sortDir={sortDir} onSort={onSort} onResize={onResize} onResizeKey={onResizeKey} onReset={onReset} isLast />
    </div>
  );
}

function PodRow({
  pod,
  t,
  gridStyle,
}: {
  pod: InfraPod;
  t: (k: string) => string;
  gridStyle: CSSProperties;
}) {
  const tone = podTone(pod);
  const rowStatus = tone === 'critical' ? 'is-critical' : tone === 'warning' ? 'is-warning' : '';
  const statusLabel = pod.oomRisk ? t('OOM risk') : pod.cpuThrottle ? t('CPU throttle') : t('OK');
  const appName = workloadNameFromPod(pod.name);

  return (
    <div className={`infra-pod-table-row ${rowStatus}`} style={gridStyle}>
      <div className="infra-pod-id">
        <span className="infra-pod-logo">
          <InfraLogo src={iconForWorkload(appName, pod.namespace)} size={22} />
        </span>
        <div>
          <strong>{pod.name}</strong>
          <span>{pod.namespace} / {pod.phase || t('unknown')}</span>
        </div>
      </div>
      <div className="infra-node-cell">
        <span className="infra-node">{pod.node || '—'}</span>
      </div>
      <div className="infra-cell">
        <UsageBar pct={pod.cpuPct} label={`${formatCpu(pod.cpuUsage)} / ${pod.cpuLimit > 0 ? formatCpu(pod.cpuLimit) : '∞'}`} compact />
      </div>
      <div className="infra-cell">
        <UsageBar pct={pod.memPct} label={`${formatMem(pod.memUsage)} / ${pod.memLimit > 0 ? formatMem(pod.memLimit) : '∞'}`} compact />
      </div>
      <span className={`infra-restarts ${pod.restarts > 0 ? 'warning' : ''}`}>{pod.restarts}</span>
      <span className="infra-flags">
        <em className={`infra-flag ${tone}`}>
          <IconPack src={statusIconForTone(tone)} size={12} />
          {statusLabel}
        </em>
      </span>
    </div>
  );
}

function PodCard({ pod, t }: { pod: InfraPod; t: (k: string) => string }) {
  const tone = podTone(pod);
  const appName = workloadNameFromPod(pod.name);
  const statusLabel = pod.oomRisk ? t('OOM risk') : pod.cpuThrottle ? t('CPU throttle') : t('OK');

  return (
    <article className={`infra-fleet-card infra-pod-card ${tone}`}>
      <div className="infra-pod-card-head">
        <div className="infra-pod-id">
          <span className="infra-pod-logo">
            <InfraLogo src={iconForWorkload(appName, pod.namespace)} size={22} />
          </span>
          <div>
            <strong>{pod.name}</strong>
            <span>{pod.namespace} / {pod.phase || t('unknown')}</span>
          </div>
        </div>
        <span className={`infra-status-chip ${tone}`}>
          <IconPack src={statusIconForTone(tone)} size={12} />
          {statusLabel}
        </span>
      </div>
      <span className="infra-node">{pod.node || '—'}</span>
      <div className="infra-fleet-meters">
        <FleetMeter
          label={t('CPU')}
          pct={pod.cpuPct}
          value={`${formatCpu(pod.cpuUsage)} / ${pod.cpuLimit > 0 ? formatCpu(pod.cpuLimit) : '∞'}`}
        />
        <FleetMeter
          label={t('Memory')}
          pct={pod.memPct}
          value={`${formatMem(pod.memUsage)} / ${pod.memLimit > 0 ? formatMem(pod.memLimit) : '∞'}`}
        />
      </div>
      <MetricPair label={t('Restarts')} value={formatCompact(pod.restarts)} />
    </article>
  );
}
