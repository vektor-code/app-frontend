import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ServiceMapData } from '../entities';
import { useTranslation } from '../utils/i18n';
import { LoadingState, NoDataState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import { techLogoFor } from '../components/TechIcon';
import IconPack from '../components/IconPack';

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

// Sparkline SVG renderer
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const gradId = `spark-grad-${color.replace(/[^a-zA-Z0-9_-]/g, '')}`;

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
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

const DEPENDENCY_METRIC_ICONS = {
  total: '/observability-icons/topology.svg',
  latency: '/observability-icons/clock-bolt.svg',
  traffic: '/observability-icons/chart-arrows-vertical.svg',
  clean: '/observability-icons/shield-check.svg',
  errors: '/observability-icons/alert-triangle.svg'
} as const;

type DependencyMetricIconName = keyof typeof DEPENDENCY_METRIC_ICONS;

function DependencyMetricIcon({ name }: { name: DependencyMetricIconName }) {
  return <IconPack src={DEPENDENCY_METRIC_ICONS[name]} className="dependency-metric-icon" />;
}

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
  const [activeNamespaceFilter, setActiveNamespaceFilter] = useState<string>('all');
  const [enabledNamespaces, setEnabledNamespaces] = useState<Set<string> | null>(null);

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

  const loadData = useCallback(() => {
    setLoading(true);
    api.getServiceMap(namespace)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        console.error('Error fetching service map for dependencies:', err);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [namespace]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
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

  // Filtered and searched items based on accumulated list
  const filteredItems = useMemo(() => {
    return accumulatedList.filter(item => {
      const matchesSearch = 
        item.system.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.consumers.some(c => c.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType = selectedType === 'all' || item.type === selectedType;
      const matchesNamespace = activeNamespaceFilter === 'all' || item.namespace === activeNamespaceFilter;

      return matchesSearch && matchesType && matchesNamespace;
    });
  }, [accumulatedList, searchTerm, selectedType, activeNamespaceFilter]);

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
      calls: totalCalls,
      avgLatency: avgDuration,
      errorRate
    };
  }, [filteredItems]);

  const getHealthMeta = (item: AccumulatedDependency) => {
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

  return (
    <div className="animate-fade-in dependencies-page">
      <section className="dependencies-hero">
        <div>
          <span className="dependencies-eyebrow">
            <DependencyIcon name="network" />
            {t('Dependency Visibility')}
          </span>
          <h1>{t('Dependencies')}</h1>
        </div>
        <div className="dependencies-hero-actions">
          <span className="dependencies-scope-chip">
            {namespace ? namespace : t('All Namespaces')}
          </span>
          <button className="dependencies-map-link" onClick={() => navigate('/servicemap')}>
            <DependencyIcon name="network" />
            {t('Service Map')}
          </button>
        </div>
      </section>

      <section className="dependency-metric-grid">
        <div className="dependency-metric-card indigo">
          <div className="dependency-metric-top">
            <span>{t('Total Dependencies')}</span>
            <DependencyMetricIcon name="total" />
          </div>
          <strong>{formatDependencyNumber(summaryMetrics.count)}</strong>
          <em>{formatDependencyNumber(filteredItems.filter(item => item.isActive).length)} {t('active')}</em>
        </div>
        <div className="dependency-metric-card emerald">
          <div className="dependency-metric-top">
            <span>{t('Avg Latency')}</span>
            <DependencyMetricIcon name="latency" />
          </div>
          <strong>{formatDependencyLatency(summaryMetrics.avgLatency)}</strong>
          <em>{t('weighted avg')}</em>
        </div>
        <div className="dependency-metric-card cyan">
          <div className="dependency-metric-top">
            <span>{t('Traffic')}</span>
            <DependencyMetricIcon name="traffic" />
          </div>
          <strong>{formatDependencyNumber(summaryMetrics.calls)}</strong>
          <em>{t('calls')}</em>
        </div>
        <div className={`dependency-metric-card ${summaryMetrics.errorRate > 0 ? 'rose' : 'emerald'}`}>
          <div className="dependency-metric-top">
            <span>{t('Error Rate')}</span>
            <DependencyMetricIcon name={summaryMetrics.errorRate > 0 ? 'errors' : 'clean'} />
          </div>
          <strong>{formatDependencyRate(summaryMetrics.errorRate)}</strong>
          <em>{summaryMetrics.errorRate > 0 ? t('errors') : t('clean')}</em>
        </div>
      </section>

      <section className="dependencies-toolbar">
        <div className="dependency-search">
          <DependencyIcon name="external" />
          <input
            type="text"
            placeholder={t('Search dependencies or consumers...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="dependencies-filter-group">
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
        </div>
      </section>

      <section className="dependency-list-panel">
        <div className="dependency-list-header">
          <div>
            <span>{t('Dependency Metrics')}</span>
            <h2>{formatDependencyNumber(filteredItems.length)} {t('connection targets')}</h2>
          </div>
        </div>

        {loading && filteredItems.length === 0 ? (
          <LoadingState height={280} label={t('Loading dependencies...')} />
        ) : filteredItems.length === 0 ? (
          <NoDataState
            height={280}
            title={t('No dependencies found')}
            hint={t('Dependencies appear after services call databases, queues, caches, or external systems.')}
          />
        ) : (
          <div className="dependency-list">
            <div className="dependency-list-labels">
              <span>{t('Dependency')}</span>
              <span>{t('Health')}</span>
              <span>{t('Latency')}</span>
              <span>{t('Traffic')}</span>
              <span>{t('Errors')}</span>
              <span>{t('Share')}</span>
            </div>

            {filteredItems.map(item => {
              const health = getHealthMeta(item);
              const trafficSharePct = summaryMetrics.calls > 0 && item.isActive ? (item.requestCount / summaryMetrics.calls) * 100 : 0;
              const tpmVal = item.isActive ? item.requestCount / 60 : 0;
              const topConsumer = item.consumers[0];
              const rowTone = !item.isActive
                ? 'idle'
                : item.errorRate >= 10
                  ? 'critical'
                  : item.errorRate > 0 || item.avgDurationMs >= 1000
                    ? 'warning'
                    : 'healthy';

              return (
                <article key={item.id} className={`dependency-row ${rowTone}`}>
                  <div className="dependency-identity">
                    <div className={`dependency-logo ${item.type === '3rdparty' ? 'external' : item.type}`}>
                      <DependencyLogo item={item} />
                    </div>
                    <div className="dependency-name-block">
                      <div className="dependency-name-line">
                        <strong title={item.rawName}>{item.system}</strong>
                        <span>{item.type === '3rdparty' ? t('external') : item.type}</span>
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

                  <div
                    className="dependency-impact"
                    style={{ '--dependency-share': `${Math.min(100, Math.max(0, trafficSharePct))}%` } as React.CSSProperties}
                  >
                    <span className="dependency-impact-ring" aria-hidden="true" />
                    <div>
                      <strong>{formatDependencyShare(trafficSharePct)}</strong>
                      <span>{formatDependencyNumber(item.isActive ? item.requestCount : 0)} {t('calls')}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
