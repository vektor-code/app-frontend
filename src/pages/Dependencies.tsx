import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GripVertical,
  Network,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import type { ServiceMapData } from '../entities';
import { useTranslation } from '../utils/i18n';
import { NoDataState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import { techLogoFor } from '../components/TechIcon';
import IconPack from '../components/IconPack';
import { useColumnResize } from '../utils/useColumnResize';
import { KpiCard } from '../components/KpiCard';

interface DependenciesProps {
  namespace: string;
}

interface DependencyItem {
  id: string;
  rawName: string;
  system: string;
  details: string;
  namespace: string;
  type: 'database' | 'messaging' | '3rdparty' | 'other';
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  consumers: { serviceName: string; count: number; duration: number }[];
  lastSeen?: string;
}

interface AccumulatedDependency extends DependencyItem {
  latencyHistory: number[];
  throughputHistory: number[];
  errorsHistory: number[];
  isActive: boolean;
}

type DependencyViewMode = 'list' | 'cards';
type DependencyHealthFilter = 'all' | 'healthy' | 'warning' | 'critical' | 'idle';
type DependencySortField = 'name' | 'health' | 'latency' | 'traffic' | 'errors' | 'share';
type DependencySortDir = 'asc' | 'desc';
type DependencyColumn = 'dependency' | 'health' | 'latency' | 'traffic' | 'errors' | 'share';

const defaultDependencyColumnWidths: Record<DependencyColumn, number> = {
  dependency: 340,
  health: 170,
  latency: 190,
  traffic: 190,
  errors: 190,
  share: 150,
};

const dependencyColumnMinimums: Record<DependencyColumn, number> = {
  dependency: 260,
  health: 145,
  latency: 150,
  traffic: 150,
  errors: 150,
  share: 125,
};

const dependencyColumnOrder: DependencyColumn[] = ['dependency', 'health', 'latency', 'traffic', 'errors', 'share'];

interface DependencyHealthMeta {
  label: string;
  detail: string;
  className: string;
  icon: HealthStatusIconName;
}

// Sparkline SVG renderer
const Sparkline = React.memo(function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) {
    return (
      <svg className="dependency-sparkline" width="68" height="24" viewBox="0 0 68 24" style={{ opacity: 0.35 }}>
        <line x1="2" y1="12" x2="66" y2="12" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="2 3" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const width = 68;
  const height = 24;
  const padding = 3;
  
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return { x, y };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg className="dependency-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={areaD} fill={color} opacity="0.10" />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

const getDependencyType = (name: string): 'database' | 'messaging' | '3rdparty' | 'other' => {
  const n = name.toLowerCase();
  if (
    n.includes('vm') ||
    n.includes('virtual machine') ||
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)
  ) {
    return 'other';
  }
  if (
    n.includes('bridge') ||
    n.includes('.gov.az') ||
    n.includes('.az')
  ) {
    return '3rdparty';
  }
  if (
    n.includes('redis') ||
    n.includes('postgres') ||
    n.includes('mysql') ||
    n.includes('mongo') ||
    n.includes('database') ||
    n.includes('db-') ||
    n.endsWith('-db') ||
    n.includes('nosql') ||
    n.includes('cassandra') ||
    n.includes('clickhouse') ||
    n.includes('minio') ||
    n.includes('sqlite')
  ) {
    return 'database';
  }
  if (
    n.includes('kafka') ||
    n.includes('rabbitmq') ||
    n.includes('message_bus') ||
    n.includes('pubsub') ||
    n.includes('queue') ||
    n.includes('broker')
  ) {
    return 'messaging';
  }
  if (
    n.includes('mygov') ||
    n.includes('egov') ||
    n.includes('stripe') ||
    n.includes('openai') ||
    n.includes('twilio') ||
    n.includes('github') ||
    n.includes('slack') ||
    n.includes('discord') ||
    n.includes('auth0') ||
    n.includes('okta') ||
    n.includes('google') ||
    n.includes('facebook') ||
    n.includes('sentry') ||
    n.includes('dns') ||
    n.includes('.')
  ) {
    return '3rdparty';
  }
  return 'other';
};

function dependencyTypeLabel(type: DependencyItem['type'], t: (key: string) => string): string {
  switch (type) {
    case 'database':
      return t('Databases / Cache');
    case 'messaging':
      return t('Message Queues');
    case '3rdparty':
      return t('3rd-Party APIs');
    default:
      return t('Other');
  }
}

type DependencyIconName =
  | 'alert'
  | 'clock'
  | 'database'
  | 'queue'
  | 'external'
  | 'server'
  | 'cache'
  | 'shield'
  | 'traffic'
  | 'network'
  | 'box';

const getDependencyIconName = (name: string, type: DependencyItem['type']): DependencyIconName => {
  const n = name.toLowerCase();
  if (n.includes('redis')) return 'cache';
  if (n.includes('vault') || n.includes('auth')) return 'shield';
  if (n.includes('dns') || n.includes('bridge') || n.includes('.az') || n.includes('.gov')) return 'network';
  if (type === 'database') return 'database';
  if (type === 'messaging') return 'queue';
  if (type === '3rdparty') return 'external';
  if (n.includes('vm') || n.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return 'server';
  return 'box';
};

function DependencyIcon({ name }: { name: DependencyIconName }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'alert':
      return <svg {...common}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>;
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /><path d="M9 2h6" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v10c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case 'queue':
      return <svg {...common}><path d="M4 7h5" /><path d="M15 7h5" /><circle cx="12" cy="7" r="3" /><path d="M12 10v4" /><path d="M7 17h10" /><circle cx="5" cy="17" r="2" /><circle cx="19" cy="17" r="2" /></svg>;
    case 'external':
      return <svg {...common}><path d="M7 17 17 7" /><path d="M8 7h9v9" /><path d="M5 5v14h14" /></svg>;
    case 'server':
      return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01" /><path d="M7 17h.01" /></svg>;
    case 'cache':
      return <svg {...common}><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" /><path d="M4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" /><path d="m8 13 3 3 5-6" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>;
    case 'traffic':
      return <svg {...common}><path d="M4 18V8" /><path d="M10 18v-5" /><path d="M16 18V6" /><path d="m4 8 6 5 6-7 4 3" /><path d="M20 9V5h-4" /></svg>;
    case 'network':
      return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="m8.4 8.2 2.4 6.1" /><path d="m15.6 8.2-2.4 6.1" /><path d="M9 6h6" /></svg>;
    default:
      return <svg {...common}><path d="M12 2 4 6.5v9L12 20l8-4.5v-9L12 2Z" /><path d="m4.5 7 7.5 4.2L19.5 7" /><path d="M12 20v-8.8" /></svg>;
  }
}

function DependencyLogo({ item }: { item: AccumulatedDependency }) {
  const logoUrl = techLogoFor(item.rawName);
  const iconName = getDependencyIconName(item.rawName, item.type);

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="dependency-logo-img"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return <DependencyIcon name={iconName} />;
}

const formatDependencyNumber = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
};

const formatDependencyLatency = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`;
};

const formatDependencyRate = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0.0%';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
};

const formatDependencyShare = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 1) return '<1%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
};

const HEALTH_STATUS_ICONS = {
  operational: '/status-icons/circle-check.svg',
  inactive: '/status-icons/circle-dashed.svg',
  degraded: '/status-icons/alert-triangle.svg',
  latency: '/status-icons/clock-exclamation.svg',
  failing: '/status-icons/circle-x.svg'
} as const;

type HealthStatusIconName = keyof typeof HEALTH_STATUS_ICONS;

// Infrastructure parser with production-focused naming details.
const parseRawName = (rawName: string, ns: string = 'default') => {
  const match = rawName.match(/^([^(]+)\(([^)]+)\)$/);
  let system = '';
  let details = '';

  if (match) {
    system = match[1].trim();
    details = match[2].trim();
  } else {
    // Show only the system name when details are not reported.
    const lower = rawName.toLowerCase();
    if (lower.includes('postgres') || lower.includes('postgresql')) {
      system = 'PostgreSQL';
    } else if (lower.includes('redis')) {
      system = 'Redis';
    } else if (lower.includes('kafka')) {
      system = 'Kafka';
    } else if (lower.includes('rabbitmq') || lower.includes('message_bus')) {
      system = 'RabbitMQ';
    } else if (lower.includes('mongo')) {
      system = 'MongoDB';
    } else if (lower.includes('clickhouse')) {
      system = 'ClickHouse';
    } else if (lower.includes('elastic')) {
      system = 'Elasticsearch';
    } else if (lower.includes('minio')) {
      system = 'MinIO';
    } else if (lower.includes('mysql')) {
      system = 'MySQL';
    } else if (lower.includes('sqlite')) {
      system = 'SQLite';
    } else if (lower.includes('db-') || lower.endsWith('-db') || lower.includes('database') || lower.includes('db')) {
      const cleanSystem = rawName.replace(/[-_]db|db[-_]|database/gi, '').trim() || rawName;
      system = cleanSystem.charAt(0).toUpperCase() + cleanSystem.slice(1) + ' Database';
    } else if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(rawName) || lower.includes('vm')) {
      system = 'Virtual Machine';
    } else if (lower.includes('bridge') || lower.includes('.gov.az') || lower.includes('.az')) {
      system = 'API Bridge';
    } else {
      system = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    }
  }

  return { system, details };
};

export default function Dependencies({ namespace }: DependenciesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<DependencyHealthFilter>('all');
  const [activeNamespaceFilter, setActiveNamespaceFilter] = useState<string>('all');
  const [enabledNamespaces, setEnabledNamespaces] = useState<Set<string> | null>(null);
  const [viewMode, setViewMode] = useState<DependencyViewMode>('list');
  const [itemLimit, setItemLimit] = useState(120);
  const [sortField, setSortField] = useState<DependencySortField>('health');
  const [sortDir, setSortDir] = useState<DependencySortDir>('desc');
  const [selectedDependencyId, setSelectedDependencyId] = useState<string | null>(null);
  const { widths, startResize, resizeBy, resetWidths } = useColumnResize(defaultDependencyColumnWidths, {
    minWidths: dependencyColumnMinimums,
    storageKey: 'dependencyInventoryColumnsV1',
  });

  // Elastic-style accumulated items to prevent older connections from disappearing
  const [accumulated, setAccumulated] = useState<Record<string, AccumulatedDependency>>(() => {
    try {
      const cached = localStorage.getItem('accumulatedDependencies');
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });

  // Only namespaces with ingestion enabled (Namespace Manager) should ever appear here.
  useEffect(() => {
    let active = true;
    api.getNamespaceStatuses().then(res => {
      if (!active) return;
      setEnabledNamespaces(new Set(res.enabled || []));
    }).catch(() => {
      if (!active) return;
      setEnabledNamespaces(new Set());
    });
    return () => { active = false; };
  }, []);

  // True if the given namespace's dependencies should be shown at all.
  const isNamespaceActive = useCallback((ns?: string): boolean => {
    const n = ns || 'default';
    if (namespace) {
      return n === namespace && (!enabledNamespaces || enabledNamespaces.has(namespace));
    }
    return !enabledNamespaces || enabledNamespaces.has(n);
  }, [namespace, enabledNamespaces]);

  const loadData = useCallback((opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    api.getServiceMap(namespace)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        console.error('Error fetching service map for dependencies:', err);
        setData(null);
      })
      .finally(() => {
        if (!opts?.silent) setLoading(false);
      });
  }, [namespace]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Compute unique namespaces present in data
  const namespacesList = useMemo(() => {
    if (!data || !data.nodes) return [];
    const nsSet = new Set<string>();
    data.nodes.forEach(n => {
      if (n.namespace && n.namespace !== 'Internet' && isNamespaceActive(n.namespace)) {
        nsSet.add(n.namespace);
      }
    });
    return Array.from(nsSet).sort();
  }, [data, isNamespaceActive]);

  // Process raw ServiceMapData into structured DependencyItems
  const dependencyItems = useMemo((): DependencyItem[] => {
    if (!data || !data.nodes) return [];

    const isInfra = (n: (typeof data.nodes)[number]) => {
      if (n.isInfrastructure) return true;
      const nName = n.serviceName.toLowerCase();
      return (
        nName.includes('redis') ||
        nName.includes('kafka') ||
        nName.includes('rabbitmq') ||
        nName.includes('postgres') ||
        nName.includes('mysql') ||
        nName.includes('mongo') ||
        nName.includes('database') ||
        nName.includes('db-') ||
        nName.endsWith('-db') ||
        nName.includes('nosql') ||
        nName.includes('cassandra') ||
        nName.includes('elasticsearch') ||
        nName.includes('clickhouse') ||
        nName.includes('apm') ||
        nName.includes('vault') ||
        nName.includes('minio') ||
        nName.includes('dns') ||
        nName.includes('config') ||
        nName.includes('liqui') ||
        nName.includes('liquid') ||
        nName.includes('nginx') ||
        nName.includes('kong') ||
        /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(nName) ||
        nName.includes('.az') ||
        nName.includes('.gov') ||
        nName.includes('bridge') ||
        nName.includes('mygov')
      );
    };

    const infraNodes = data.nodes.filter(n => {
      if (!isInfra(n)) return false;
      if (isNamespaceActive(n.namespace)) return true;
      const nNs = n.namespace || 'default';
      return (data.edges || []).some(e => {
        const isSource = e.source === n.serviceName && (e.sourceNamespace || 'default') === nNs;
        const isTarget = e.target === n.serviceName && (e.targetNamespace || 'default') === nNs;
        if (!isSource && !isTarget) return false;
        const otherNs = isSource ? e.targetNamespace : e.sourceNamespace;
        return isNamespaceActive(otherNs);
      });
    });

    const items: DependencyItem[] = [];

    infraNodes.forEach(node => {
      const nodeNamespace = node.namespace || 'default';
      const { system, details } = parseRawName(node.serviceName, nodeNamespace);
      const depType = getDependencyType(node.serviceName);

      const incomingEdges = (data.edges || []).filter(
        e => e.target === node.serviceName && e.targetNamespace === node.namespace && isNamespaceActive(e.sourceNamespace)
      );

      const consumers = incomingEdges.map(e => ({
        serviceName: e.source,
        count: e.callCount,
        duration: e.avgDurationMs
      })).sort((a, b) => b.count - a.count);

      let totalCalls = 0;
      let totalErrors = 0;
      let totalDurationSum = 0;

      incomingEdges.forEach(e => {
        totalCalls += e.callCount;
        totalErrors += e.errorCount;
        totalDurationSum += e.avgDurationMs * e.callCount;
      });

      const avgDuration = totalCalls > 0 ? totalDurationSum / totalCalls : node.p50Ms;
      const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : node.errorRate;

      items.push({
        id: `${node.namespace}:${node.serviceName}`,
        rawName: node.serviceName,
        system,
        details,
        namespace: nodeNamespace,
        type: depType,
        requestCount: totalCalls || node.requestCount,
        errorCount: totalErrors || node.errorCount,
        errorRate,
        avgDurationMs: avgDuration,
        consumers,
        lastSeen: node.lastSeen ? new Date(node.lastSeen).toISOString() : undefined
      });
    });

    return items;
  }, [data, isNamespaceActive]);

  // Merge live dependencyItems into accumulated dependencies (Elastic behavior)
  useEffect(() => {
    if (loading) return;

    setAccumulated(prev => {
      const next = { ...prev };
      
      // Decay inactive connections (set throughput to 0, mark inactive)
      Object.keys(next).forEach(key => {
        next[key] = {
          ...next[key],
          isActive: false,
          throughputHistory: [...(next[key].throughputHistory || [])].slice(-9).concat(0),
        };
      });

      // Update or insert live items
      dependencyItems.forEach(item => {
        const prevItem = next[item.id];
        
        let latencyHistory = [item.avgDurationMs];
        let throughputHistory = [item.requestCount];
        let errorsHistory = [item.errorRate];

        if (prevItem && prevItem.latencyHistory && prevItem.latencyHistory.length > 0) {
          latencyHistory = [...prevItem.latencyHistory].slice(-9).concat(item.avgDurationMs);
          throughputHistory = [...prevItem.throughputHistory].slice(-9).concat(item.requestCount);
          errorsHistory = [...prevItem.errorsHistory].slice(-9).concat(item.errorRate);
        }

        next[item.id] = {
          ...item,
          latencyHistory,
          throughputHistory,
          errorsHistory,
          isActive: true
        };
      });

      try {
        localStorage.setItem('accumulatedDependencies', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to cache accumulated dependencies:', err);
      }

      return next;
    });
  }, [dependencyItems, loading]);

  const accumulatedList = useMemo(() => {
    return Object.values(accumulated).filter(item => isNamespaceActive(item.namespace));
  }, [accumulated, isNamespaceActive]);

  // Scope first, then layer health and ordering so filter counts remain useful.
  const baseFilteredItems = useMemo(() => {
    return accumulatedList.filter(item => {
      const matchesSearch =
        item.system.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.rawName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.namespace.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.consumers.some(c => c.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType = selectedType === 'all' || item.type === selectedType;
      const matchesNamespace = activeNamespaceFilter === 'all' || item.namespace === activeNamespaceFilter;

      return matchesSearch && matchesType && matchesNamespace;
    });
  }, [accumulatedList, searchTerm, selectedType, activeNamespaceFilter]);

  const healthCounts = useMemo(() => {
    return baseFilteredItems.reduce(
      (counts, item) => {
        const tone = dependencyTone(item);
        counts.all += 1;
        counts[tone] += 1;
        return counts;
      },
      { all: 0, healthy: 0, warning: 0, critical: 0, idle: 0 }
    );
  }, [baseFilteredItems]);

  const filteredItems = useMemo(() => {
    const healthFiltered = healthFilter === 'all'
      ? baseFilteredItems
      : baseFilteredItems.filter(item => dependencyTone(item) === healthFilter);
    const direction = sortDir === 'asc' ? 1 : -1;
    const healthRank: Record<ReturnType<typeof dependencyTone>, number> = {
      idle: 0,
      healthy: 1,
      warning: 2,
      critical: 3,
    };

    return [...healthFiltered].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') comparison = a.system.localeCompare(b.system);
      else if (sortField === 'health') comparison = healthRank[dependencyTone(a)] - healthRank[dependencyTone(b)];
      else if (sortField === 'latency') comparison = a.avgDurationMs - b.avgDurationMs;
      else if (sortField === 'traffic' || sortField === 'share') comparison = a.requestCount - b.requestCount;
      else if (sortField === 'errors') comparison = a.errorRate - b.errorRate;
      return comparison * direction;
    });
  }, [baseFilteredItems, healthFilter, sortField, sortDir]);

  // Aggregate metrics for summary cards
  const summaryMetrics = useMemo(() => {
    let totalCalls = 0;
    let totalErrors = 0;
    let totalDurationSum = 0;

    filteredItems.forEach(item => {
      // Inactive items have 0 active traffic
      const reqCount = item.isActive ? item.requestCount : 0;
      const errCount = item.isActive ? item.errorCount : 0;
      totalCalls += reqCount;
      totalErrors += errCount;
      totalDurationSum += item.avgDurationMs * reqCount;
    });

    const avgDuration = totalCalls > 0 ? totalDurationSum / totalCalls : 0;
    const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

    return {
      count: filteredItems.length,
      active: filteredItems.filter(item => item.isActive).length,
      calls: totalCalls,
      avgLatency: avgDuration,
      errorRate
    };
  }, [filteredItems]);

  const summaryTrends = useMemo(
    () => buildDependencyTrends(filteredItems),
    [filteredItems],
  );
  const awaitingResults = loading && !data;

  const visibleItems = useMemo(() => filteredItems.slice(0, itemLimit), [filteredItems, itemLimit]);
  const selectedDependency = selectedDependencyId
    ? accumulatedList.find(item => item.id === selectedDependencyId) || null
    : null;
  const tableGridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: dependencyColumnOrder
      .map(column => `minmax(${dependencyColumnMinimums[column]}px, ${widths[column]}fr)`)
      .join(' '),
  }), [widths]);

  useEffect(() => {
    setItemLimit(viewMode === 'cards' ? 60 : 120);
  }, [namespace, searchTerm, selectedType, healthFilter, activeNamespaceFilter, viewMode]);

  useEffect(() => {
    document.body.classList.toggle('drawer-open', Boolean(selectedDependencyId));
    return () => document.body.classList.remove('drawer-open');
  }, [selectedDependencyId]);

  const setSort = (field: DependencySortField) => {
    if (sortField === field) {
      setSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDir(field === 'name' ? 'asc' : 'desc');
  };

  const resizeColumnWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, column: DependencyColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const getHealthMeta = (item: AccumulatedDependency): DependencyHealthMeta => {
    if (!item.isActive) {
      return {
        label: t('Inactive'),
        detail: t('no recent traffic'),
        className: 'health-muted',
        icon: 'inactive' as HealthStatusIconName
      };
    }
    if (item.errorRate >= 10) {
      return {
        label: t('Failing'),
        detail: `${formatDependencyRate(item.errorRate)} ${t('error rate')}`,
        className: 'health-danger',
        icon: 'failing' as HealthStatusIconName
      };
    }
    if (item.errorRate > 0) {
      return {
        label: t('Degraded'),
        detail: `${formatDependencyRate(item.errorRate)} ${t('error rate')}`,
        className: 'health-warning',
        icon: 'degraded' as HealthStatusIconName
      };
    }
    if (item.avgDurationMs >= 1000) {
      return {
        label: t('High latency'),
        detail: `${formatDependencyLatency(item.avgDurationMs)} ${t('average')}`,
        className: 'health-slow',
        icon: 'latency' as HealthStatusIconName
      };
    }
    return {
      label: t('Operational'),
      detail: t('no errors observed'),
      className: 'health-good',
      icon: 'operational' as HealthStatusIconName
    };
  };
  const selectedDependencyHealth = selectedDependency ? getHealthMeta(selectedDependency) : null;
  const activeCallTotal = accumulatedList.reduce(
    (total, item) => total + (item.isActive ? item.requestCount : 0),
    0,
  );
  const selectedDependencyShare = selectedDependency && selectedDependency.isActive && activeCallTotal > 0
    ? (selectedDependency.requestCount / activeCallTotal) * 100
    : 0;

  const namespaceOptions = [
    { value: 'all', label: t('All Namespaces') },
    ...namespacesList.map(ns => ({ value: ns, label: ns }))
  ];

  const typeOptions = [
    { value: 'all', label: t('All Types') },
    { value: 'database', label: t('Databases / Cache') },
    { value: 'messaging', label: t('Message Queues') },
    { value: '3rdparty', label: t('3rd-Party APIs') },
    { value: 'other', label: t('Other') }
  ];
  const dependencyTrafficLeaders = [...filteredItems]
    .filter(item => item.isActive && item.requestCount > 0)
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 5);

  return (
    <div className="animate-fade-in dependencies-page apm-dashboard">
      <section className="apm-dashboard-header dependencies-dashboard-header">
        <div className="apm-title-block">
          <h1>{t('Dependencies')}</h1>
        </div>
        <div className="apm-header-meta">
          <div className="apm-live-pill">
            <span />
            {t('Live')}
          </div>
          <button className="dependencies-map-link" onClick={() => navigate('/servicemap')}>
            <DependencyIcon name="network" />
            {t('Service Map')}
          </button>
        </div>
      </section>

      <section className="apm-kpi-strip" aria-label={t('Dependency health')}>
        <KpiCard
          label={t('Total Dependencies')}
          value={formatDependencyNumber(summaryMetrics.count)}
          detail={`${formatDependencyNumber(summaryMetrics.active)} ${t('active')}`}
          tone="info"
          trend={summaryTrends.active}
          positiveIsGood
          loading={awaitingResults}
        />
        <KpiCard
          label={t('Avg Latency')}
          value={formatDependencyLatency(summaryMetrics.avgLatency)}
          detail={t('weighted avg')}
          tone={
            summaryMetrics.calls === 0
              ? 'neutral'
              : summaryMetrics.avgLatency > 1000
                ? 'warning'
                : summaryMetrics.avgLatency > 300
                  ? 'info'
                  : 'healthy'
          }
          trend={summaryTrends.latency}
          positiveIsGood={false}
          loading={awaitingResults}
        />
        <KpiCard
          label={t('Traffic')}
          value={formatDependencyNumber(summaryMetrics.calls)}
          detail={t('calls')}
          tone="info"
          trend={summaryTrends.calls}
          positiveIsGood
          loading={awaitingResults}
        />
        <KpiCard
          label={t('Error Rate')}
          value={formatDependencyRate(summaryMetrics.errorRate)}
          detail={summaryMetrics.errorRate > 0 ? t('errors') : t('clean')}
          tone={
            summaryMetrics.errorRate > 5 ? 'critical' : summaryMetrics.errorRate > 0 ? 'warning' : 'healthy'
          }
          trend={summaryTrends.errorRate}
          positiveIsGood={false}
          loading={awaitingResults}
        />
      </section>

      <section className="dependency-insight-grid">
        <DependencyHealthChart
          counts={healthCounts}
          total={healthCounts.all}
          loading={awaitingResults}
          t={t}
        />
        <DependencyTrafficChart
          items={dependencyTrafficLeaders}
          totalCalls={summaryMetrics.calls}
          loading={awaitingResults}
          t={t}
        />
      </section>

      <section className="dependencies-toolbar">
        <div className="dependency-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={t('Search dependencies or consumers...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label={t('Search dependencies')}
          />
          {searchTerm && (
            <button type="button" onClick={() => setSearchTerm('')} aria-label={t('Clear search')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="dependencies-filter-group">
          <div className="dependency-health-tabs" role="group" aria-label={t('Filter by health')}>
            {([
              ['all', t('All'), healthCounts.all],
              ['healthy', t('Healthy'), healthCounts.healthy],
              ['warning', t('Watch'), healthCounts.warning],
              ['critical', t('Critical'), healthCounts.critical],
              ['idle', t('Inactive'), healthCounts.idle],
            ] as Array<[DependencyHealthFilter, string, number]>).map(([value, label, count]) => (
              <button
                type="button"
                key={value}
                className={`${healthFilter === value ? 'active' : ''} ${value}`}
                onClick={() => setHealthFilter(value)}
              >
                <i />
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>

          {!namespace && (
            <CustomSelect
              className="dependency-filter-select"
              ariaLabel={t('Namespace')}
              options={namespaceOptions}
              value={activeNamespaceFilter}
              onChange={setActiveNamespaceFilter}
              placeholder={t('All Namespaces')}
            />
          )}

          <CustomSelect
            className="dependency-filter-select"
            ariaLabel={t('Dependency type')}
            options={typeOptions}
            value={selectedType}
            onChange={setSelectedType}
            placeholder={t('All Types')}
          />

          <DependencyViewSwitch value={viewMode} onChange={setViewMode} t={t} />
        </div>
      </section>

      <section className="dependency-list-panel">
        <div className="dependency-list-header">
          <div>
            <span>{t('Dependency Metrics')}</span>
            <h2>
              {awaitingResults
                ? <span className="apm-skeleton" style={{ width: 148, height: 16, display: 'inline-block' }} />
                : `${formatDependencyNumber(visibleItems.length)} / ${formatDependencyNumber(filteredItems.length)} ${t('connection targets')}`}
            </h2>
          </div>
          {viewMode === 'list' && (
            <div className="dependency-list-tools">
              <span><GripVertical size={13} /> {t('Drag column edges to resize')}</span>
              <button type="button" onClick={resetWidths}>
                <RotateCcw size={13} />
                {t('Reset columns')}
              </button>
            </div>
          )}
        </div>

        {awaitingResults ? (
          <DependencyTableSkeleton />
        ) : filteredItems.length === 0 ? (
          <NoDataState
            height={280}
            title={t('No dependencies found')}
            hint={t('Dependencies appear after services call databases, queues, caches, or external systems.')}
          />
        ) : (
          <>
            {viewMode === 'list' ? (
              <div className="dependency-table-scroller">
                <div className="dependency-list">
                <div className="dependency-list-labels" style={tableGridStyle} role="row">
                  <DependencyColumnHeader column="dependency" label={t('Dependency')} sortField="name" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                  <DependencyColumnHeader column="health" label={t('Health')} sortField="health" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                  <DependencyColumnHeader column="latency" label={t('Latency')} sortField="latency" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                  <DependencyColumnHeader column="traffic" label={t('Traffic')} sortField="traffic" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                  <DependencyColumnHeader column="errors" label={t('Errors')} sortField="errors" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                  <DependencyColumnHeader column="share" label={t('Share')} sortField="share" activeSort={sortField} dir={sortDir} onSort={setSort} onResize={startResize} onResizeKey={resizeColumnWithKeyboard} onReset={resetWidths} />
                </div>

                {visibleItems.map(item => (
                  <DependencyRow
                    key={item.id}
                    item={item}
                    health={getHealthMeta(item)}
                    totalCalls={summaryMetrics.calls}
                    gridStyle={tableGridStyle}
                    onSelect={() => setSelectedDependencyId(item.id)}
                    t={t}
                  />
                ))}
                </div>
              </div>
            ) : (
              <div className="dependency-card-grid">
                {visibleItems.map(item => (
                  <DependencyCard
                    key={item.id}
                    item={item}
                    health={getHealthMeta(item)}
                    totalCalls={summaryMetrics.calls}
                    onSelect={() => setSelectedDependencyId(item.id)}
                    t={t}
                  />
                ))}
              </div>
            )}

            {visibleItems.length < filteredItems.length && (
              <div className="dependency-show-more-wrap">
                <button type="button" className="dependency-show-more" onClick={() => setItemLimit(current => current + (viewMode === 'cards' ? 60 : 120))}>
                  {t('Show more dependencies')}
                  <span>{formatDependencyNumber(filteredItems.length - visibleItems.length)} {t('remaining')}</span>
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {typeof document !== 'undefined' && createPortal(
        <>
          <div
            className={`dependency-drawer-backdrop ${selectedDependency ? 'open' : ''}`}
            onClick={() => setSelectedDependencyId(null)}
          />
          <aside
            className={`dependency-drawer ${selectedDependency ? 'open' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-hidden={!selectedDependency}
            aria-label={selectedDependency ? `${selectedDependency.system} ${t('details')}` : t('Dependency details')}
          >
            {selectedDependency && selectedDependencyHealth && (
              <>
                <header className="dependency-drawer-header">
                  <div className={`dependency-logo ${selectedDependency.type === '3rdparty' ? 'external' : selectedDependency.type}`}>
                    <DependencyLogo item={selectedDependency} />
                  </div>
                  <div className="dependency-drawer-title">
                    <span>{selectedDependency.namespace} · {dependencyTypeLabel(selectedDependency.type, t)}</span>
                    <h2>{selectedDependency.system}</h2>
                    <p title={selectedDependency.details || selectedDependency.rawName}>
                      {selectedDependency.details || selectedDependency.rawName}
                    </p>
                  </div>
                  <button type="button" className="dependency-drawer-close" onClick={() => setSelectedDependencyId(null)} aria-label={t('Close')}>
                    <X size={18} />
                  </button>
                </header>

                <div className="dependency-drawer-content">
                  <section className={`dependency-drawer-health ${selectedDependencyHealth.className}`}>
                    <span
                      className="dependency-health-icon"
                      aria-hidden="true"
                      style={{ '--dependency-health-icon': `url("${HEALTH_STATUS_ICONS[selectedDependencyHealth.icon]}")` } as React.CSSProperties}
                    />
                    <div>
                      <span>{t('Current health')}</span>
                      <strong>{selectedDependencyHealth.label}</strong>
                      <p>{selectedDependencyHealth.detail}</p>
                    </div>
                    <em>{selectedDependency.isActive ? t('Receiving traffic') : t('No recent traffic')}</em>
                  </section>

                  <section className="dependency-drawer-metrics" aria-label={t('Dependency metrics')}>
                    <DependencyDrawerMetric label={t('Avg latency')} value={formatDependencyLatency(selectedDependency.avgDurationMs)} detail={t('weighted by calls')} tone={selectedDependency.avgDurationMs >= 1000 ? 'warning' : 'neutral'} />
                    <DependencyDrawerMetric label={t('Throughput')} value={`${(selectedDependency.isActive ? selectedDependency.requestCount / 60 : 0).toFixed(1)} tpm`} detail={`${formatDependencyNumber(selectedDependency.requestCount)} ${t('calls')}`} />
                    <DependencyDrawerMetric label={t('Error rate')} value={formatDependencyRate(selectedDependency.errorRate)} detail={`${formatDependencyNumber(selectedDependency.errorCount)} ${t('errors')}`} tone={selectedDependency.errorRate > 0 ? 'critical' : 'healthy'} />
                    <DependencyDrawerMetric label={t('Traffic share')} value={formatDependencyShare(selectedDependencyShare)} detail={`${formatDependencyNumber(selectedDependency.consumers.length)} ${t('calling services')}`} />
                  </section>

                  <section className="dependency-drawer-section">
                    <div className="dependency-drawer-section-heading">
                      <div>
                        <span>{t('Live signals')}</span>
                        <h3>{t('Recent dependency behavior')}</h3>
                      </div>
                      <em>{selectedDependency.lastSeen ? new Date(selectedDependency.lastSeen).toLocaleString() : t('Last seen unavailable')}</em>
                    </div>
                    <div className="dependency-drawer-trends">
                      <DependencyTrend label={t('Latency')} value={formatDependencyLatency(selectedDependency.avgDurationMs)} data={selectedDependency.latencyHistory} color="#3b82f6" />
                      <DependencyTrend label={t('Traffic')} value={`${(selectedDependency.isActive ? selectedDependency.requestCount / 60 : 0).toFixed(1)} tpm`} data={selectedDependency.throughputHistory} color="#10b981" />
                      <DependencyTrend label={t('Errors')} value={formatDependencyRate(selectedDependency.errorRate)} data={selectedDependency.errorsHistory} color="#ef4444" />
                    </div>
                  </section>

                  <section className="dependency-drawer-section">
                    <div className="dependency-drawer-section-heading">
                      <div>
                        <span>{t('Upstream impact')}</span>
                        <h3>{t('Calling services')}</h3>
                      </div>
                      <strong>{formatDependencyNumber(selectedDependency.consumers.length)}</strong>
                    </div>
                    {selectedDependency.consumers.length > 0 ? (
                      <div className="dependency-consumer-list">
                        {selectedDependency.consumers.map((consumer, index) => (
                          <button
                            type="button"
                            key={consumer.serviceName}
                            onClick={() => navigate(`/traces?service=${encodeURIComponent(consumer.serviceName)}`)}
                          >
                            <span className="dependency-consumer-rank">{index + 1}</span>
                            <span className="dependency-consumer-name">
                              <strong>{consumer.serviceName}</strong>
                              <em>{t('Open related traces')}</em>
                            </span>
                            <span className="dependency-consumer-metric">
                              <strong>{formatDependencyNumber(consumer.count)}</strong>
                              <em>{t('calls')}</em>
                            </span>
                            <span className="dependency-consumer-metric">
                              <strong>{formatDependencyLatency(consumer.duration)}</strong>
                              <em>{t('avg')}</em>
                            </span>
                            <ArrowRight size={15} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="dependency-consumer-empty">
                        <DependencyIcon name="network" />
                        <strong>{t('No active callers')}</strong>
                        <span>{t('This dependency is retained from an earlier observation window.')}</span>
                      </div>
                    )}
                  </section>
                </div>

                <footer className="dependency-drawer-actions">
                  <button type="button" onClick={() => navigate('/servicemap')}>
                    <Network size={16} />
                    {t('View in service map')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!selectedDependency.consumers[0]}
                    onClick={() => {
                      const caller = selectedDependency.consumers[0];
                      if (caller) navigate(`/traces?service=${encodeURIComponent(caller.serviceName)}`);
                    }}
                  >
                    <ArrowRight size={16} />
                    {t('Investigate top caller')}
                  </button>
                </footer>
              </>
            )}
          </aside>
        </>,
        document.body,
      )}
    </div>
  );
}

function DependencyTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="apm-skeleton-table" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="apm-skeleton-row">
          <span className="apm-skeleton" style={{ width: `${52 + (index % 4) * 9}%` }} />
          <span className="apm-skeleton" style={{ width: 72 }} />
          <span className="apm-skeleton" style={{ width: 88 }} />
          <span className="apm-skeleton" style={{ width: 64 }} />
          <span className="apm-skeleton" style={{ width: 56 }} />
        </div>
      ))}
    </div>
  );
}

function DependencyHealthChart({
  counts,
  total,
  loading = false,
  t,
}: {
  counts: { all: number; healthy: number; warning: number; critical: number; idle: number };
  total: number;
  loading?: boolean;
  t: (k: string) => string;
}) {
  const segments = [
    { label: t('Healthy'), value: counts.healthy, color: '#10b981' },
    { label: t('Watch'), value: counts.warning, color: '#f59e0b' },
    { label: t('Critical'), value: counts.critical, color: '#f43f5e' },
    { label: t('Inactive'), value: counts.idle, color: '#cbd5e1' },
  ];

  return (
    <article className="dependency-insight-card dependency-health-chart">
      <div className="dependency-chart-heading">
        <div>
          <span>{t('Reliability')}</span>
          <h2>{t('Dependency health')}</h2>
        </div>
        <em>{loading ? <span className="apm-skeleton" style={{ width: 72, height: 12, display: 'inline-block' }} /> : `${formatDependencyNumber(total)} ${t('targets')}`}</em>
      </div>
      <div className="dependency-health-chart-body">
        {loading && (
          <div className="apm-chart-overlay">
            <span className="apm-skeleton" style={{ width: 88, height: 88, borderRadius: '50%' }} />
          </div>
        )}
        <div className="dependency-health-total">
          <strong>{formatDependencyNumber(total)}</strong>
          <span>{t('monitored targets')}</span>
        </div>
        <div className="dependency-status-bar" aria-label={t('Dependency health distribution')}>
          {segments.map(segment => (
            <i
              key={segment.label}
              title={`${segment.label}: ${segment.value}`}
              style={{
                width: `${total > 0 ? (segment.value / total) * 100 : 0}%`,
                background: segment.color,
              }}
            />
          ))}
        </div>
        <div className="dependency-chart-legend">
          {segments.map(segment => (
            <div key={segment.label}>
              <i style={{ background: segment.color }} />
              <span>{segment.label}</span>
              <strong>{formatDependencyNumber(segment.value)}</strong>
              <em>{total > 0 ? `${Math.round((segment.value / total) * 100)}%` : '0%'}</em>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function DependencyTrafficChart({
  items,
  totalCalls,
  loading = false,
  t,
}: {
  items: AccumulatedDependency[];
  totalCalls: number;
  loading?: boolean;
  t: (k: string) => string;
}) {
  const colors = ['#3157f6', '#7558ff', '#19beea', '#10b981', '#f59e0b'];
  const maxCalls = Math.max(1, ...items.map(item => item.requestCount));

  return (
    <article className="dependency-insight-card dependency-traffic-chart">
      <div className="dependency-chart-heading">
        <div>
          <span>{t('Traffic')}</span>
          <h2>{t('Dependency concentration')}</h2>
        </div>
        <em>{loading ? <span className="apm-skeleton" style={{ width: 72, height: 12, display: 'inline-block' }} /> : `${formatDependencyNumber(totalCalls)} ${t('calls')}`}</em>
      </div>
      <div className="dependency-ranking-chart">
        {loading ? (
          <div className="apm-skeleton-table" style={{ minHeight: 0, padding: 0 }}>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="apm-skeleton-row" style={{ gridTemplateColumns: '32px minmax(0, 1fr) 56px', minHeight: 36, padding: '8px 4px' }}>
                <span className="apm-skeleton" style={{ width: 20 }} />
                <span className="apm-skeleton" style={{ width: `${62 + (index % 3) * 10}%` }} />
                <span className="apm-skeleton" style={{ width: 40 }} />
              </div>
            ))}
          </div>
        ) : items.length > 0 ? items.map((item, index) => {
          const share = totalCalls > 0 ? (item.requestCount / totalCalls) * 100 : 0;
          return (
            <div className="dependency-ranking-row" key={item.id}>
              <span className="dependency-ranking-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="dependency-ranking-main">
                <div>
                  <strong title={item.rawName}>{item.system}</strong>
                  <span>{item.namespace} · {formatDependencyLatency(item.avgDurationMs)}</span>
                </div>
                <div className="dependency-ranking-track">
                  <i
                    style={{
                      width: `${Math.max(3, (item.requestCount / maxCalls) * 100)}%`,
                      background: colors[index],
                    }}
                  />
                </div>
              </div>
              <div className="dependency-ranking-value">
                <strong>{formatDependencyNumber(item.requestCount)}</strong>
                <span>{formatDependencyShare(share)}</span>
              </div>
            </div>
          );
        }) : (
          <div className="dependency-chart-empty">{t('No active dependency traffic')}</div>
        )}
      </div>
    </article>
  );
}

function dependencyTone(item: AccumulatedDependency): 'idle' | 'critical' | 'warning' | 'healthy' {
  if (!item.isActive) return 'idle';
  if (item.errorRate >= 10) return 'critical';
  if (item.errorRate > 0 || item.avgDurationMs >= 1000) return 'warning';
  return 'healthy';
}

function DependencyViewSwitch({ value, onChange, t }: { value: DependencyViewMode; onChange: (value: DependencyViewMode) => void; t: (k: string) => string }) {
  return (
    <div className="dependency-view-switch" role="group" aria-label={t('View mode')}>
      <button type="button" className={value === 'list' ? 'active' : ''} onClick={() => onChange('list')}>
        <IconPack src="/observability-icons/sitemap.svg" size={14} />
        {t('List')}
      </button>
      <button type="button" className={value === 'cards' ? 'active' : ''} onClick={() => onChange('cards')}>
        <IconPack src="/observability-icons/layout-grid.svg" size={14} />
        {t('Cards')}
      </button>
    </div>
  );
}

function DependencyColumnHeader({
  column,
  label,
  sortField,
  activeSort,
  dir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
}: {
  column: DependencyColumn;
  label: string;
  sortField: DependencySortField;
  activeSort: DependencySortField;
  dir: DependencySortDir;
  onSort: (field: DependencySortField) => void;
  onResize: (event: React.MouseEvent, column: DependencyColumn) => void;
  onResizeKey: (event: KeyboardEvent<HTMLButtonElement>, column: DependencyColumn) => void;
  onReset: () => void;
}) {
  const active = activeSort === sortField;

  return (
    <div className={`dependency-column-head ${active ? 'active' : ''}`} role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="dependency-column-sort" onClick={() => onSort(sortField)}>
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
      {column !== 'share' && (
        <button
          type="button"
          className="dependency-column-resizer"
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

function DependencyRow({
  item,
  health,
  totalCalls,
  gridStyle,
  onSelect,
  t,
}: {
  item: AccumulatedDependency;
  health: DependencyHealthMeta;
  totalCalls: number;
  gridStyle: CSSProperties;
  onSelect: () => void;
  t: (k: string) => string;
}) {
  const trafficSharePct = totalCalls > 0 && item.isActive ? (item.requestCount / totalCalls) * 100 : 0;
  const tpmVal = item.isActive ? item.requestCount / 60 : 0;
  const topConsumer = item.consumers[0];
  const rowTone = dependencyTone(item);

  return (
    <button type="button" className={`dependency-row ${rowTone}`} style={gridStyle} onClick={onSelect}>
      <div className="dependency-identity">
        <div className={`dependency-logo ${item.type === '3rdparty' ? 'external' : item.type}`}>
          <DependencyLogo item={item} />
        </div>
        <div className="dependency-name-block">
          <div className="dependency-name-line">
            <strong title={item.rawName}>{item.system}</strong>
            <span>{dependencyTypeLabel(item.type, t)}</span>
          </div>
          <p title={item.details || item.namespace}>
            {item.details || item.namespace}
          </p>
          <div className="dependency-consumer-line">
            <span>{item.namespace}</span>
            <em>
              {topConsumer
                ? `${topConsumer.serviceName} / ${formatDependencyNumber(item.consumers.length)} consumers`
                : t('No active consumers')}
            </em>
          </div>
        </div>
      </div>

      <div className="dependency-cell health">
        <div className={`dependency-health-card ${health.className}`}>
          <span
            className="dependency-health-icon"
            aria-hidden="true"
            style={{ '--dependency-health-icon': `url("${HEALTH_STATUS_ICONS[health.icon]}")` } as React.CSSProperties}
          />
          <div>
            <strong>{health.label}</strong>
            <small>{health.detail}</small>
          </div>
        </div>
      </div>

      <div className="dependency-cell metric">
        <Sparkline data={item.latencyHistory} color="#3b82f6" />
        <div>
          <strong>{formatDependencyLatency(item.avgDurationMs)}</strong>
          <span>{t('avg')}</span>
        </div>
      </div>

      <div className="dependency-cell metric">
        <Sparkline data={item.throughputHistory} color="#10b981" />
        <div>
          <strong>{tpmVal.toFixed(1)}</strong>
          <span>{t('tpm')}</span>
        </div>
      </div>

      <div className="dependency-cell metric">
        <Sparkline data={item.errorsHistory} color="#ef4444" />
        <div>
          <strong className={item.errorRate > 0 ? 'danger' : ''}>{formatDependencyRate(item.errorRate)}</strong>
          <span>{formatDependencyNumber(item.errorCount)} {t('errors')}</span>
        </div>
      </div>

      <div className="dependency-impact">
        <div>
          <strong>{formatDependencyShare(trafficSharePct)}</strong>
          <span>{formatDependencyNumber(item.isActive ? item.requestCount : 0)} {t('calls')}</span>
        </div>
        <ArrowRight className="dependency-row-arrow" size={15} aria-hidden="true" />
      </div>
    </button>
  );
}

function DependencyCard({
  item,
  health,
  totalCalls,
  onSelect,
  t,
}: {
  item: AccumulatedDependency;
  health: DependencyHealthMeta;
  totalCalls: number;
  onSelect: () => void;
  t: (k: string) => string;
}) {
  const trafficSharePct = totalCalls > 0 && item.isActive ? (item.requestCount / totalCalls) * 100 : 0;
  const tpmVal = item.isActive ? item.requestCount / 60 : 0;
  const topConsumer = item.consumers[0];
  const tone = dependencyTone(item);

  return (
    <button type="button" className={`dependency-card ${tone}`} onClick={onSelect}>
      <div className="dependency-card-head">
        <div className="dependency-identity">
          <div className={`dependency-logo ${item.type === '3rdparty' ? 'external' : item.type}`}>
            <DependencyLogo item={item} />
          </div>
          <div className="dependency-name-block">
            <div className="dependency-name-line">
              <strong title={item.rawName}>{item.system}</strong>
              <span>{dependencyTypeLabel(item.type, t)}</span>
            </div>
            <p title={item.details || item.namespace}>{item.details || item.namespace}</p>
          </div>
        </div>
        <div className={`dependency-health-card ${health.className}`}>
          <span
            className="dependency-health-icon"
            aria-hidden="true"
            style={{ '--dependency-health-icon': `url("${HEALTH_STATUS_ICONS[health.icon]}")` } as React.CSSProperties}
          />
          <div>
            <strong>{health.label}</strong>
            <small>{health.detail}</small>
          </div>
        </div>
      </div>

      <div className="dependency-card-metrics">
        <Metric label={t('Latency')} value={formatDependencyLatency(item.avgDurationMs)} hint={t('avg')} danger={false} />
        <Metric label={t('Traffic')} value={tpmVal.toFixed(1)} hint={t('tpm')} danger={false} />
        <Metric label={t('Errors')} value={formatDependencyRate(item.errorRate)} hint={`${formatDependencyNumber(item.errorCount)} ${t('errors')}`} danger={item.errorRate > 0} />
        <Metric label={t('Share')} value={formatDependencyShare(trafficSharePct)} hint={`${formatDependencyNumber(item.isActive ? item.requestCount : 0)} ${t('calls')}`} danger={false} />
      </div>

      <div className="dependency-card-foot">
        <span>{item.namespace}</span>
        <em>
          {topConsumer
            ? `${topConsumer.serviceName} / ${formatDependencyNumber(item.consumers.length)} consumers`
            : t('No active consumers')}
        </em>
        <ArrowRight className="dependency-card-arrow" size={15} aria-hidden="true" />
      </div>
    </button>
  );
}

function Metric({ label, value, hint, danger }: { label: string; value: string; hint: string; danger: boolean }) {
  return (
    <span className="dependency-card-metric">
      <em>{label}</em>
      <strong className={danger ? 'danger' : ''}>{value}</strong>
      <small>{hint}</small>
    </span>
  );
}

function DependencyDrawerMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'healthy' | 'warning' | 'critical';
}) {
  return (
    <div className={`dependency-drawer-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function DependencyTrend({
  label,
  value,
  data,
  color,
}: {
  label: string;
  value: string;
  data: number[];
  color: string;
}) {
  return (
    <div className="dependency-drawer-trend">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Sparkline data={data} color={color} />
    </div>
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function buildDependencyTrends(items: AccumulatedDependency[]) {
  const pointCount = Math.max(
    2,
    ...items.flatMap(item => [
      item.throughputHistory.length,
      item.latencyHistory.length,
      item.errorsHistory.length,
    ]),
  );
  const indices = Array.from({ length: pointCount }, (_, index) => index);
  const atPoint = (history: number[], fallback: number, index: number) => {
    const offset = history.length - pointCount + index;
    return offset >= 0 && finiteNumber(history[offset]) ? history[offset] : history[0] ?? fallback;
  };

  const active = indices.map(index =>
    items.filter(item => atPoint(item.throughputHistory, item.isActive ? item.requestCount : 0, index) > 0).length
  );
  const calls = indices.map(index =>
    items.reduce((sum, item) => sum + atPoint(item.throughputHistory, item.isActive ? item.requestCount : 0, index), 0)
  );
  const latency = indices.map(index => {
    const live = items.filter(item => atPoint(item.throughputHistory, item.isActive ? item.requestCount : 0, index) > 0);
    if (live.length === 0) return 0;
    const weight = live.reduce((sum, item) => sum + atPoint(item.throughputHistory, item.requestCount, index), 0);
    if (weight <= 0) return 0;
    return live.reduce(
      (sum, item) => sum + atPoint(item.latencyHistory, item.avgDurationMs, index) * atPoint(item.throughputHistory, item.requestCount, index),
      0,
    ) / weight;
  });
  const errorRate = indices.map(index => {
    const volume = items.reduce((sum, item) => sum + atPoint(item.throughputHistory, item.isActive ? item.requestCount : 0, index), 0);
    if (volume <= 0) return 0;
    return items.reduce((sum, item) => {
      const traffic = atPoint(item.throughputHistory, item.isActive ? item.requestCount : 0, index);
      return sum + (atPoint(item.errorsHistory, item.errorRate, index) / 100) * traffic;
    }, 0) / volume * 100;
  });

  const hasShape = pointCount >= 2 && items.some(item =>
    item.throughputHistory.length > 1 || item.latencyHistory.length > 1 || item.errorsHistory.length > 1
  );
  if (!hasShape) {
    return { active: undefined, calls: undefined, latency: undefined, errorRate: undefined };
  }
  return { active, calls, latency, errorRate };
}
