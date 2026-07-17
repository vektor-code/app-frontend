import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ServiceMapData } from '../entities';
import { useTranslation } from '../utils/i18n';
import { useColumnResize } from '../utils/useColumnResize';

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
  if (!data || data.length < 2) {
    return (
      <svg width="50" height="18" viewBox="0 0 50 18" style={{ opacity: 0.3, marginRight: '8px' }}>
        <line x1="0" y1="9" x2="50" y2="9" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="2,2" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const width = 50;
  const height = 18;
  const padding = 2;
  
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return { x, y };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', marginRight: '8px' }}>
      <defs>
        <linearGradient id={`spark-grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#spark-grad-${color})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CustomDropdown({
  options,
  value,
  onChange,
  placeholder
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentOption = options.find(o => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    const handleClose = () => setIsOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', minWidth: '160px' }} onClick={e => e.stopPropagation()}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'var(--bg-secondary)',
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isOpen ? '0 0 0 2px rgba(99, 102, 241, 0.2)' : 'none',
          borderColor: isOpen ? 'var(--accent-indigo)' : 'var(--border-primary)',
          transition: 'all 0.15s ease',
          height: '36px'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentOption ? currentOption.label : placeholder}
        </span>
        <svg 
          viewBox="0 0 24 24" 
          width="14" 
          height="14" 
          fill="none" 
          stroke="var(--text-secondary)" 
          strokeWidth="2.5" 
          style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'none', 
            transition: 'transform 0.15s ease',
            flexShrink: 0
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div 
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-lg), 0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            zIndex: 100,
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '4px',
            animation: 'fadeIn 0.1s ease-out'
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                color: value === opt.value ? 'var(--accent-indigo)' : 'var(--text-primary)',
                background: value === opt.value ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.12s'
              }}
              onMouseEnter={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                {opt.label}
              </span>
              {value === opt.value && (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent-indigo)" strokeWidth="3" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
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

const getDependencyEmoji = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes('postgres')) return '🐘';
  if (n.includes('mysql')) return '🐬';
  if (n.includes('redis')) return '⚡';
  if (n.includes('kafka')) return '🦫';
  if (n.includes('rabbitmq')) return '🐇';
  if (n.includes('mygov')) return '🏛️';
  if (n.includes('egov')) return '🏢';
  if (n.includes('stripe')) return '💳';
  if (n.includes('openai')) return '🤖';
  if (n.includes('slack')) return '💬';
  if (n.includes('discord')) return '🎮';
  if (n.includes('github')) return '🐙';
  if (n.includes('minio')) return '📦';
  if (n.includes('clickhouse')) return '📈';
  if (n.includes('cassandra')) return '👁️';
  if (n.includes('mongo')) return '🍃';
  if (n.includes('db-') || n.endsWith('-db') || n.includes('database') || n.includes('db') || n.includes('sqlite')) return '🗄️';
  if (n.includes('mail') || n.includes('smtp')) return '📧';
  if (n.includes('dns')) return '🌐';
  if (n.includes('vm') || n.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return '📟';
  if (n.includes('bridge') || n.includes('.gov.az') || n.includes('.az')) return '🌉';
  return '⚙️';
};

const BRAND_LOGOS: Record<string, string> = {
  redis: '/logos/redis.svg',
  kafka: '/logos/kafka.svg',
  rabbitmq: '/logos/rabbitmq.svg',
  vault: '/logos/vault.svg',
  elasticsearch: '/logos/elasticsearch.svg',
  minio: '/logos/minio.svg',
  postgres: '/logos/postgres.svg',
  mysql: '/logos/mysql.svg',
  mongodb: '/logos/mongodb.svg',
  liquibase: '/logos/liquibase.svg',
  nginx: '/logos/nginx.svg',
  kong: '/logos/kong.svg',
  mygov: '/mygov-id.svg',
  stripe: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/stripe.svg',
  openai: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/openai.svg',
  slack: '/logos/slack.svg',
  discord: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/discord.svg',
  github: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/github.svg',
  vm: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linux.svg',
  bridge: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linkerd.svg',
  apm: '/logos/apm.svg',
  clickhouse: '/logos/clickhouse.svg',
  dns: '/logos/dns.svg',
  database: '/logos/database.svg',
};

const getDependencyLogo = (name: string): string | null => {
  const n = name.toLowerCase();
  if (n.includes('mygov')) return BRAND_LOGOS.mygov;
  if (n.includes('postgres')) return BRAND_LOGOS.postgres;
  if (n.includes('mysql')) return BRAND_LOGOS.mysql;
  if (n.includes('redis')) return BRAND_LOGOS.redis;
  if (n.includes('kafka')) return BRAND_LOGOS.kafka;
  if (n.includes('rabbitmq') || n.includes('message_bus')) return BRAND_LOGOS.rabbitmq;
  if (n.includes('apm')) return BRAND_LOGOS.apm;
  if (n.includes('vault')) return BRAND_LOGOS.vault;
  if (n.includes('elastic')) return BRAND_LOGOS.elasticsearch;
  if (n.includes('minio')) return BRAND_LOGOS.minio;
  if (n.includes('mongo')) return BRAND_LOGOS.mongodb;
  if (n.includes('liquibase')) return BRAND_LOGOS.liquibase;
  if (n.includes('nginx')) return BRAND_LOGOS.nginx;
  if (n.includes('kong')) return BRAND_LOGOS.kong;
  if (n.includes('clickhouse')) return BRAND_LOGOS.clickhouse;
  if (n.includes('dns')) return BRAND_LOGOS.dns;
  if (n.includes('stripe')) return BRAND_LOGOS.stripe;
  if (n.includes('openai')) return BRAND_LOGOS.openai;
  if (n.includes('slack')) return BRAND_LOGOS.slack;
  if (n.includes('discord')) return BRAND_LOGOS.discord;
  if (n.includes('github')) return BRAND_LOGOS.github;
  if (n.includes('vm') || n.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return BRAND_LOGOS.vm;
  if (n.includes('bridge') || n.includes('.gov.az') || n.includes('.az')) return BRAND_LOGOS.bridge;
  if (n.includes('database') || n.includes('db')) return BRAND_LOGOS.database;
  return null;
};

// Upgraded infrastructure parser with highly realistic production details
const parseRawName = (rawName: string, ns: string = 'default') => {
  const match = rawName.match(/^([^(]+)\(([^)]+)\)$/);
  let system = '';
  let details = '';

  if (match) {
    system = match[1].trim();
    details = match[2].trim();
  } else {
    // Revert to showing just the system name, NO fake fallbacks!
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

  const { widths: colWidths, startResize } = useColumnResize({
    health: 100,
    backend: 240,
    latency: 180,
    traffic: 180,
    errors: 180,
    impact: 140,
  });

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
        } else {
          // Seed initial variations for sparklines first load rendering
          const seedCount = 8;
          latencyHistory = Array.from({ length: seedCount }, () => item.avgDurationMs * (0.9 + Math.random() * 0.2)).concat(item.avgDurationMs);
          throughputHistory = Array.from({ length: seedCount }, () => item.requestCount * (0.9 + Math.random() * 0.2)).concat(item.requestCount);
          errorsHistory = Array.from({ length: seedCount }, () => item.errorRate > 0 ? item.errorRate * (0.9 + Math.random() * 0.2) : 0).concat(item.errorRate);
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
    return Object.values(accumulated);
  }, [accumulated]);

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

  const maxValues = useMemo(() => {
    const list = Object.values(accumulated);
    const maxLatency = Math.max(...list.map(i => i.avgDurationMs), 1);
    const maxThroughput = Math.max(...list.map(i => i.requestCount), 1);
    return { maxLatency, maxThroughput };
  }, [accumulated]);

  const getHealthBadge = (errorRate: number, isActive: boolean) => {
    if (!isActive) {
      return <span className="health-badge health-unknown">Unknown</span>;
    }
    if (errorRate === 0) {
      return <span className="health-badge health-ok">Healthy</span>;
    }
    if (errorRate < 10) {
      return <span className="health-badge health-warning">Warning</span>;
    }
    return <span className="health-badge health-critical">Critical</span>;
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
    <div className="animate-fade-in dependencies-page" style={{ paddingBottom: '40px' }}>
      
      {/* Header View link */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">{t('Dependencies')}</h1>
          <p className="page-subtitle">
            {t('Overview of databases, queues, caches, and third-party tools called by your services.')}
          </p>
        </div>
        <button
          onClick={() => navigate('/servicemap')}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent-indigo)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            textDecoration: 'none'
          }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
        >
          View service map
        </button>
      </div>

      {/* Overview stats cards grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-indigo)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(99, 102, 241, 0.03) 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('Total Dependencies')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {summaryMetrics.count}
          </div>
        </div>

        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-emerald)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(16, 185, 129, 0.03) 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('Avg Connection Latency')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {summaryMetrics.avgLatency.toFixed(1)} <span style={{ fontSize: '13px', fontWeight: 400, color: 'var(--text-secondary)' }}>ms</span>
          </div>
        </div>

        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-cyan)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(14, 165, 233, 0.03) 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('Total Throughput')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(14, 165, 233, 0.1)', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {summaryMetrics.calls.toLocaleString()}
          </div>
        </div>

        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: `4px solid ${summaryMetrics.errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}`,
          background: `linear-gradient(135deg, var(--bg-secondary) 0%, ${summaryMetrics.errorRate > 0 ? 'rgba(244, 63, 94, 0.03)' : 'rgba(16, 185, 129, 0.03)'} 100%)`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>{t('System Error Rate')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: summaryMetrics.errorRate > 0 ? 'rgba(244, 63, 94, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: summaryMetrics.errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              </svg>
            </div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: summaryMetrics.errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
            {summaryMetrics.errorRate.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card" style={{ marginBottom: '16px', overflow: 'visible' }}>
        <div className="card-body filter-bar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', overflow: 'visible' }}>
          <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
            <input
              type="text"
              placeholder={t("Search dependencies or consumers...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                transition: 'all 0.15s ease-out'
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.15)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'var(--border-primary)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="var(--text-secondary)"
              strokeWidth="2.5"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {!namespace && (
            <CustomDropdown
              options={namespaceOptions}
              value={activeNamespaceFilter}
              onChange={setActiveNamespaceFilter}
              placeholder={t("All Namespaces")}
            />
          )}

          <CustomDropdown
            options={typeOptions}
            value={selectedType}
            onChange={setSelectedType}
            placeholder={t("All Types")}
          />
        </div>
      </div>

      {/* Main Dependencies Table */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">{t("Dependency Metrics")}</div>
          <span className="text-sm text-muted">{filteredItems.length} connection targets</span>
        </div>
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          {filteredItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <div className="empty-state-title">
                {loading ? t("Loading APM dependencies...") : t("No dependencies found")}
              </div>
              <div className="empty-state-text">
                {loading ? t("Fetching latest connection maps...") : t("Try adjusting your filters or search terms.")}
              </div>
            </div>
          ) : (
            <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: colWidths.health, position: 'relative', textAlign: 'center' }}>
                    Health
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'health')} />
                  </th>
                  <th style={{ width: colWidths.backend, position: 'relative' }}>
                    Backend
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'backend')} />
                  </th>
                  <th style={{ width: colWidths.latency, position: 'relative' }}>
                    Latency (avg.)
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'latency')} />
                  </th>
                  <th style={{ width: colWidths.traffic, position: 'relative' }}>
                    Traffic
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'traffic')} />
                  </th>
                  <th style={{ width: colWidths.errors, position: 'relative' }}>
                    Errors
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'errors')} />
                  </th>
                  <th style={{ width: colWidths.impact, position: 'relative' }}>
                    Impact
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'impact')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const impactPct = maxValues.maxThroughput > 0 ? (item.requestCount / maxValues.maxThroughput) * 100 : 0;
                  const tpmVal = item.isActive ? (item.requestCount / 60).toFixed(1) : '0.0';

                  return (
                    <tr key={item.id} className="hover-row" style={{ cursor: 'pointer', transition: 'background 0.2s' }}>
                      
                      {/* 1. Health Badge */}
                      <td data-label="Health" style={{ width: colWidths.health, textAlign: 'center' }}>
                        {getHealthBadge(item.errorRate, item.isActive)}
                      </td>

                      {/* 2. Backend details */}
                      <td data-label="Backend" style={{ width: colWidths.backend, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ 
                            height: '24px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            width: '44px',
                            minWidth: '44px'
                          }}>
                            {(() => {
                              const logoUrl = getDependencyLogo(item.rawName);
                              const isDarkTheme = document.body.classList.contains('dark-theme');
                              if (logoUrl) {
                                const isSimpleIcon = logoUrl.includes('simple-icons');
                                const isKong = logoUrl.includes('kong');
                                const shouldInvert = isDarkTheme && (isSimpleIcon || isKong);
                                return (
                                  <img 
                                    src={logoUrl} 
                                    alt={item.system} 
                                    style={{ 
                                      height: '22px', 
                                      maxWidth: '44px',
                                      objectFit: 'contain',
                                      filter: shouldInvert ? 'invert(1) brightness(0.9)' : undefined
                                    }} 
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                      const parent = (e.target as HTMLImageElement).parentElement;
                                      if (parent) {
                                        parent.innerText = getDependencyEmoji(item.rawName);
                                      }
                                    }}
                                  />
                                );
                              }
                              return (
                                <span style={{ fontSize: '14px' }}>
                                  {getDependencyEmoji(item.rawName)}
                                </span>
                              );
                            })()}
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.system.toLowerCase()}
                            </span>
                            {item.details && (
                              <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.details}>
                                {item.details}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 3. Latency Sparkline + Value */}
                      <td data-label="Latency (avg.)" style={{ width: colWidths.latency }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Sparkline data={item.latencyHistory} color="#3b82f6" />
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.avgDurationMs.toFixed(0)} ms
                          </span>
                        </div>
                      </td>

                      {/* 4. Traffic Sparkline + Value (TPM) */}
                      <td data-label="Traffic" style={{ width: colWidths.traffic }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Sparkline data={item.throughputHistory} color="#10b981" />
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {tpmVal} tpm
                          </span>
                        </div>
                      </td>

                      {/* 5. Errors Sparkline + Value (%) */}
                      <td data-label="Errors" style={{ width: colWidths.errors }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Sparkline data={item.errorsHistory} color="#ef4444" />
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: item.errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                            {item.errorRate.toFixed(1)} %
                          </span>
                        </div>
                      </td>

                      {/* 6. Impact Bars */}
                      <td data-label="Impact" style={{ width: colWidths.impact }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '80px' }}>
                          <div style={{ height: '5px', background: 'var(--accent-indigo)', borderRadius: '2px', width: `${Math.max(4, impactPct)}%` }} />
                          <div style={{ height: '3px', background: 'var(--text-muted)', opacity: 0.3, borderRadius: '2px', width: `${Math.max(4, impactPct * 0.7)}%` }} />
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <style>{`
        .health-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 3px 8px;
          border-radius: 20px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.3px;
        }
        .health-ok {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-emerald, #10b981);
        }
        .health-warning {
          background: rgba(245, 158, 11, 0.12);
          color: var(--accent-amber, #f59e0b);
        }
        .health-critical {
          background: rgba(244, 63, 94, 0.15);
          color: var(--accent-rose, #f43f5e);
        }
        .health-unknown {
          background: rgba(148, 163, 184, 0.12);
          color: var(--text-secondary);
        }

        .hover-row:hover {
          background: var(--bg-hover) !important;
        }

        .filter-bar {
          padding: 12px 16px !important;
        }

        @media (max-width: 768px) {
          .db-table thead {
            display: none;
          }
          .db-table tbody,
          .db-table tbody tr {
            display: block;
            width: 100%;
          }
          .db-table tbody tr.hover-row {
            display: block;
            background: var(--bg-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 12px;
          }
          .db-table tbody tr.hover-row td {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0 !important;
            border: none !important;
            text-align: right;
            max-width: none !important;
            white-space: normal !important;
            overflow: visible !important;
          }
          .db-table tbody tr.hover-row td::before {
            content: attr(data-label);
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--text-tertiary);
            text-align: left;
            flex-shrink: 0;
            margin-right: 12px;
          }
        }
      `}</style>
    </div>
  );
}
