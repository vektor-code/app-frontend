import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api, type ServiceMapData } from '../api/client';

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

// Helper to determine dependency type
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
  redis: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg',
  kafka: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg',
  rabbitmq: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/rabbitmq/rabbitmq-original.svg',
  vault: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vault/vault-original.svg',
  elasticsearch: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/elasticsearch/elasticsearch-original.svg',
  minio: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/minio/minio-original.svg',
  postgres: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg',
  mysql: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mysql/mysql-original.svg',
  mongodb: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mongodb/mongodb-original.svg',
  liquibase: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/liquibase/liquibase-original.svg',
  nginx: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nginx/nginx-original.svg',
  kong: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/kong.svg',
  mygov: '/mygov-id.svg',
  stripe: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/stripe.svg',
  openai: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/openai.svg',
  slack: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/slack.svg',
  discord: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/discord.svg',
  github: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/github.svg',
  vm: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linux.svg',
  bridge: 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/linkerd.svg',
};

const getDependencyLogo = (name: string): string | null => {
  const n = name.toLowerCase();
  if (n.includes('mygov')) return BRAND_LOGOS.mygov;
  if (n.includes('postgres')) return BRAND_LOGOS.postgres;
  if (n.includes('mysql')) return BRAND_LOGOS.mysql;
  if (n.includes('redis')) return BRAND_LOGOS.redis;
  if (n.includes('kafka')) return BRAND_LOGOS.kafka;
  if (n.includes('rabbitmq') || n.includes('message_bus')) return BRAND_LOGOS.rabbitmq;
  if (n.includes('vault')) return BRAND_LOGOS.vault;
  if (n.includes('elastic')) return BRAND_LOGOS.elasticsearch;
  if (n.includes('minio')) return BRAND_LOGOS.minio;
  if (n.includes('mongo')) return BRAND_LOGOS.mongodb;
  if (n.includes('liquibase')) return BRAND_LOGOS.liquibase;
  if (n.includes('nginx')) return BRAND_LOGOS.nginx;
  if (n.includes('kong')) return BRAND_LOGOS.kong;
  if (n.includes('stripe')) return BRAND_LOGOS.stripe;
  if (n.includes('openai')) return BRAND_LOGOS.openai;
  if (n.includes('slack')) return BRAND_LOGOS.slack;
  if (n.includes('discord')) return BRAND_LOGOS.discord;
  if (n.includes('github')) return BRAND_LOGOS.github;
  if (n.includes('vm') || n.includes('virtual machine') || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(n)) return BRAND_LOGOS.vm;
  if (n.includes('bridge') || n.includes('.gov.az') || n.includes('.az')) return BRAND_LOGOS.bridge;
  return null;
};

const parseRawName = (rawName: string) => {
  const match = rawName.match(/^([^(]+)\(([^)]+)\)$/);
  if (!match) {
    const lower = rawName.toLowerCase();
    if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(rawName) || lower.includes('vm')) {
      return {
        system: 'Virtual Machine',
        details: rawName,
      };
    }
    if (lower.includes('bridge') || lower.includes('.gov.az') || lower.includes('.az')) {
      return {
        system: 'API Bridge',
        details: rawName,
      };
    }
    return { system: rawName, details: '' };
  }
  return {
    system: match[1].trim(),
    details: match[2].trim(),
  };
};

export default function Dependencies({ namespace }: DependenciesProps) {
  const [data, setData] = useState<ServiceMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [activeNamespaceFilter, setActiveNamespaceFilter] = useState<string>('all');

  const [colWidths, setColWidths] = useState({
    name: 260,
    health: 90,
    namespace: 100,
    latency: 150,
    throughput: 130,
    errorRate: 120,
    consumers: 200,
  });

  const startResize = (e: React.MouseEvent, col: keyof typeof colWidths) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[col];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(50, startWidth + (moveEvent.clientX - startX));
      setColWidths(prev => ({
        ...prev,
        [col]: newWidth
      }));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

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
      if (n.namespace && n.namespace !== 'Internet') {
        nsSet.add(n.namespace);
      }
    });
    return Array.from(nsSet).sort();
  }, [data]);

  // Process raw ServiceMapData into structured DependencyItems
  const dependencyItems = useMemo((): DependencyItem[] => {
    if (!data || !data.nodes) return [];

    const infraNodes = data.nodes.filter(n => {
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
    });

    const items: DependencyItem[] = [];

    infraNodes.forEach(node => {
      const { system, details } = parseRawName(node.serviceName);
      const depType = getDependencyType(node.serviceName);

      const incomingEdges = (data.edges || []).filter(
        e => e.target === node.serviceName && e.targetNamespace === node.namespace
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
        namespace: node.namespace || 'default',
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
  }, [data]);

  // Filtered and searched items
  const filteredItems = useMemo(() => {
    return dependencyItems.filter(item => {
      const matchesSearch = 
        item.system.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.consumers.some(c => c.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesType = selectedType === 'all' || item.type === selectedType;
      const matchesNamespace = activeNamespaceFilter === 'all' || item.namespace === activeNamespaceFilter;

      return matchesSearch && matchesType && matchesNamespace;
    });
  }, [dependencyItems, searchTerm, selectedType, activeNamespaceFilter]);

  // Aggregate metrics for summary cards
  const summaryMetrics = useMemo(() => {
    let totalCalls = 0;
    let totalErrors = 0;
    let totalDurationSum = 0;

    filteredItems.forEach(item => {
      totalCalls += item.requestCount;
      totalErrors += item.errorCount;
      totalDurationSum += item.avgDurationMs * item.requestCount;
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
    let maxLatency = 1;
    let maxThroughput = 1;
    filteredItems.forEach(item => {
      if (item.avgDurationMs > maxLatency) maxLatency = item.avgDurationMs;
      if (item.requestCount > maxThroughput) maxThroughput = item.requestCount;
    });
    return { maxLatency, maxThroughput };
  }, [filteredItems]);

  const getHealthBadge = (errorRate: number) => {
    if (errorRate === 0) {
      return <span className="health-badge health-ok">Healthy</span>;
    }
    if (errorRate < 10) {
      return <span className="health-badge health-warning">Warning</span>;
    }
    return <span className="health-badge health-critical">Critical</span>;
  };

  const getNamespaceStyle = (ns: string) => {
    let hash = 0;
    for (let i = 0; i < ns.length; i++) {
      hash = ns.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899'];
    const color = colors[Math.abs(hash) % colors.length];
    return {
      background: color + '15',
      color: color,
      border: `1.5px solid ${color}35`,
    };
  };

  const namespaceOptions = [
    { value: 'all', label: 'All Namespaces' },
    ...namespacesList.map(ns => ({ value: ns, label: ns }))
  ];

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'database', label: 'Databases / Cache' },
    { value: 'messaging', label: 'Message Queues' },
    { value: '3rdparty', label: '3rd-Party APIs' },
    { value: 'other', label: 'Other' }
  ];

  return (
    <div className="animate-fade-in dependencies-page" style={{ paddingBottom: '40px' }}>
      <h1 className="page-title">Dependencies</h1>
      <p className="page-subtitle">
        Overview of databases, queues, caches, and third-party tools called by your services.
      </p>

      {/* Overview stats cards grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* Metric 1: Total Dependencies */}
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
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Total Dependencies</span>
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

        {/* Metric 2: Connection Latency */}
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
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Avg Connection Latency</span>
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

        {/* Metric 3: Total Throughput */}
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
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Total Throughput</span>
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

        {/* Metric 4: System Error Rate */}
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
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>System Error Rate</span>
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
          
          {/* Search box */}
          <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
            <input
              type="text"
              placeholder="Search dependencies or consumers..."
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

          {/* Namespace Selector - Hidden if filtered globally */}
          {!namespace && (
            <CustomDropdown
              options={namespaceOptions}
              value={activeNamespaceFilter}
              onChange={setActiveNamespaceFilter}
              placeholder="All Namespaces"
            />
          )}

          {/* Type Selector */}
          <CustomDropdown
            options={typeOptions}
            value={selectedType}
            onChange={setSelectedType}
            placeholder="All Types"
          />

        </div>
      </div>

      {/* Main Dependencies Table */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">Dependency Metrics</div>
          <span className="text-sm text-muted">{filteredItems.length} active connection targets</span>
        </div>
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          {filteredItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <div className="empty-state-title">
                {loading ? "Loading APM dependencies..." : "No dependencies found"}
              </div>
              <div className="empty-state-text">
                {loading ? "Fetching latest connection maps..." : "Try adjusting your filters or search terms."}
              </div>
            </div>
          ) : (
            <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: colWidths.name, position: 'relative' }}>
                    Dependency
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'name')} />
                  </th>
                  <th style={{ width: colWidths.health, position: 'relative' }}>
                    Health
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'health')} />
                  </th>
                  {!namespace && (
                    <th style={{ width: colWidths.namespace, position: 'relative' }}>
                      Namespace
                      <div className="resize-handle" onMouseDown={e => startResize(e, 'namespace')} />
                    </th>
                  )}
                  <th style={{ width: colWidths.latency, position: 'relative' }}>
                    Latency (Avg)
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'latency')} />
                  </th>
                  <th style={{ width: colWidths.throughput, position: 'relative' }}>
                    Throughput
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'throughput')} />
                  </th>
                  <th style={{ width: colWidths.errorRate, position: 'relative' }}>
                    Error Rate
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'errorRate')} />
                  </th>
                  <th style={{ width: colWidths.consumers, position: 'relative' }}>
                    Consumers
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'consumers')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const latencyPct = maxValues.maxLatency > 0 ? (item.avgDurationMs / maxValues.maxLatency) * 100 : 0;
                  const throughputPct = maxValues.maxThroughput > 0 ? (item.requestCount / maxValues.maxThroughput) * 100 : 0;
                  const errorPct = item.errorRate;
                  const nsStyle = getNamespaceStyle(item.namespace);

                  return (
                    <tr key={item.id} className="hover-row" style={{ cursor: 'pointer', transition: 'background 0.2s' }}>
                      <td data-label="Dependency" style={{ width: colWidths.name, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.system.toUpperCase()}
                            </span>
                            {item.details && (
                              <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.details}>
                                {item.details}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td data-label="Health" style={{ width: colWidths.health }}>{getHealthBadge(item.errorRate)}</td>

                      {!namespace && (
                        <td data-label="Namespace" style={{ width: colWidths.namespace, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span className="badge badge-ns" style={{ ...nsStyle, fontSize: '10px', padding: '2px 8px', borderRadius: '12px' }}>
                            {item.namespace}
                          </span>
                        </td>
                      )}

                      <td data-label="Latency" style={{ width: colWidths.latency }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: item.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                            {item.avgDurationMs.toFixed(1)} ms
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${Math.max(2, latencyPct)}%`, background: 'var(--accent-cyan)' }} />
                          </div>
                        </div>
                      </td>

                      <td data-label="Throughput" style={{ width: colWidths.throughput }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.requestCount} calls
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${Math.max(2, throughputPct)}%`, background: 'var(--accent-indigo)' }} />
                          </div>
                        </div>
                      </td>

                      <td data-label="Error Rate" style={{ width: colWidths.errorRate }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: item.errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                            {item.errorRate.toFixed(1)}%
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${errorPct}%`, background: 'var(--accent-rose)' }} />
                          </div>
                        </div>
                      </td>

                      <td data-label="Consumers" style={{ width: colWidths.consumers }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {item.consumers.slice(0, 3).map(c => (
                            <span
                              key={c.serviceName}
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-primary)',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                              }}
                              title={`${c.count} calls (avg ${c.duration.toFixed(1)}ms)`}
                            >
                              {c.serviceName}
                            </span>
                          ))}
                          {item.consumers.length > 3 && (
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>
                              +{item.consumers.length - 3}
                            </span>
                          )}
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

        .progress-bar-bg {
          width: 100px;
          height: 5px;
          background: var(--border-primary, rgba(255,255,255,0.06));
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .hover-row:hover {
          background: var(--bg-hover) !important;
        }

        .filter-bar {
          padding: 12px 16px !important;
        }

        /* Resizable Column Handles */
        .resize-handle {
          position: absolute;
          right: 0;
          top: 0;
          bottom: 0;
          width: 6px;
          cursor: col-resize;
          user-select: none;
          z-index: 10;
          transition: background 0.15s;
        }
        .resize-handle:hover {
          background: rgba(99, 102, 241, 0.45) !important;
        }

        /* Responsive: mobile card layout */
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
