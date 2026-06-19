import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api, type ServiceMapData, type ServiceStats } from '../api/client';

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

// Helper to determine dependency type
const getDependencyType = (name: string): 'database' | 'messaging' | '3rdparty' | 'other' => {
  const n = name.toLowerCase();
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
  return null;
};

// Parse raw system names like "postgresql (users_db)"
const parseRawName = (rawName: string) => {
  const match = rawName.match(/^([^(]+)\(([^)]+)\)$/);
  if (!match) {
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
      // Is infrastructure node or matches infra naming convention
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
        nName.includes('clickhouse') ||
        nName.includes('vault') ||
        nName.includes('minio') ||
        nName.includes('dns') ||
        nName.includes('nginx') ||
        nName.includes('kong') ||
        nName.includes('mygov')
      );
    });

    const items: DependencyItem[] = [];

    infraNodes.forEach(node => {
      const { system, details } = parseRawName(node.serviceName);
      const depType = getDependencyType(node.serviceName);

      // Find all incoming edges (services calling this infra node)
      const incomingEdges = (data.edges || []).filter(
        e => e.target === node.serviceName && e.targetNamespace === node.namespace
      );

      // Extract details about consumers
      const consumers = incomingEdges.map(e => ({
        serviceName: e.source,
        count: e.callCount,
        duration: e.avgDurationMs
      })).sort((a, b) => b.count - a.count);

      // Compute aggregates
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
      // Search text filter
      const matchesSearch = 
        item.system.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.consumers.some(c => c.serviceName.toLowerCase().includes(searchTerm.toLowerCase()));

      // Dependency type filter
      const matchesType = selectedType === 'all' || item.type === selectedType;

      // Namespace filter
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

  // Calculate maximum values for relative bar charts
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
    // Generate simple stable hash coloring
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

  if (loading && !data) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">Loading APM dependencies...</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in dependencies-page" style={{ paddingBottom: '40px' }}>
      <h1 className="page-title">Dependencies</h1>
      <p className="page-subtitle">
        Overview of databases, queues, caches, and third-party tools called by your services.
      </p>

      {/* Overview stats cards grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Total Dependencies</div>
            <div className="stat-val">{summaryMetrics.count}</div>
            <div className="stat-change text-muted">Active components</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Avg Connection Latency</div>
            <div className="stat-val" style={{ color: 'var(--accent-cyan)' }}>
              {summaryMetrics.avgLatency.toFixed(1)}ms
            </div>
            <div className="stat-change text-muted">Weighted avg duration</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">Total Throughput</div>
            <div className="stat-val" style={{ color: 'var(--accent-indigo-light)' }}>
              {summaryMetrics.calls}
            </div>
            <div className="stat-change text-muted">Aggregated executions</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="stat-label">System Error Rate</div>
            <div className="stat-val" style={{ color: summaryMetrics.errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
              {summaryMetrics.errorRate.toFixed(2)}%
            </div>
            <div className="stat-change text-muted">Failure ratio</div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-body filter-bar" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          
          {/* Search box */}
          <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
            <input
              type="text"
              placeholder="Search dependencies or consumers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="filter-select"
              style={{ width: '100%', paddingLeft: '12px' }}
            />
          </div>

          {/* Namespace Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Namespace:</span>
            <select
              value={activeNamespaceFilter}
              onChange={(e) => setActiveNamespaceFilter(e.target.value)}
              className="filter-select"
              style={{ minWidth: '130px' }}
            >
              <option value="all">All Namespaces</option>
              {namespacesList.map(ns => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
          </div>

          {/* Type Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Type:</span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="filter-select"
              style={{ minWidth: '130px' }}
            >
              <option value="all">All Types</option>
              <option value="database">Databases / Cache</option>
              <option value="messaging">Message Queues</option>
              <option value="3rdparty">3rd-Party APIs</option>
              <option value="other">Other</option>
            </select>
          </div>

        </div>
      </div>

      {/* Main Dependencies Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Dependency Metrics</div>
          <span className="text-sm text-muted">{filteredItems.length} active connection targets</span>
        </div>
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          {filteredItems.length === 0 ? (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <div className="empty-state-title">No dependencies found</div>
              <div className="empty-state-text">Try adjusting your filters or search terms.</div>
            </div>
          ) : (
            <table className="dependencies-table">
              <thead>
                <tr>
                  <th style={{ width: '260px' }}>Dependency Name</th>
                  <th style={{ width: '90px' }}>Health</th>
                  <th style={{ width: '100px' }}>Namespace</th>
                  <th style={{ width: '90px' }}>Type</th>
                  <th style={{ width: '150px' }}>Latency (Avg)</th>
                  <th style={{ width: '130px' }}>Throughput</th>
                  <th style={{ width: '120px' }}>Error Rate</th>
                  <th>Calling Services (Consumers)</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const latencyPct = maxValues.maxLatency > 0 ? (item.avgDurationMs / maxValues.maxLatency) * 100 : 0;
                  const throughputPct = maxValues.maxThroughput > 0 ? (item.requestCount / maxValues.maxThroughput) * 100 : 0;
                  const errorPct = item.errorRate;

                  const nsStyle = getNamespaceStyle(item.namespace);

                  return (
                    <tr key={item.id}>
                      {/* Name & Details */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ 
                            height: '24px', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'flex-start',
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
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                              {item.system.toUpperCase()}
                            </span>
                            {item.details && (
                              <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', wordBreak: 'break-all' }}>
                                {item.details}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Health Badge */}
                      <td>{getHealthBadge(item.errorRate)}</td>

                      {/* Namespace Badge */}
                      <td>
                        <span className="badge badge-ns" style={{ ...nsStyle, fontSize: '10px', padding: '2px 8px', borderRadius: '12px' }}>
                          {item.namespace}
                        </span>
                      </td>

                      {/* Type Badge */}
                      <td>
                        <span className="type-badge" style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          background: item.type === 'database' ? 'rgba(14, 165, 233, 0.1)' : item.type === 'messaging' ? 'rgba(234, 88, 12, 0.1)' : item.type === '3rdparty' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                          color: item.type === 'database' ? 'var(--accent-cyan)' : item.type === 'messaging' ? '#ea580c' : item.type === '3rdparty' ? 'var(--accent-amber)' : 'var(--text-muted)'
                        }}>
                          {item.type === '3rdparty' ? '3rd-Party' : item.type}
                        </span>
                      </td>

                      {/* Latency avg + bar */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.avgDurationMs.toFixed(1)} ms
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${Math.max(2, latencyPct)}%`, background: 'var(--accent-cyan)' }} />
                          </div>
                        </div>
                      </td>

                      {/* Throughput + bar */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {item.requestCount} calls
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${Math.max(2, throughputPct)}%`, background: 'var(--accent-indigo)' }} />
                          </div>
                        </div>
                      </td>

                      {/* Error rate + bar */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span className="mono" style={{ fontSize: '12.5px', fontWeight: 600, color: item.errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>
                            {item.errorRate.toFixed(1)}%
                          </span>
                          <div className="progress-bar-bg">
                            <div className="progress-bar-fill" style={{ width: `${errorPct}%`, background: 'var(--accent-rose)' }} />
                          </div>
                        </div>
                      </td>

                      {/* Consumers calling list */}
                      <td>
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
          text-transform: uppercase;
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

        .dependencies-table {
          width: 100%;
          min-width: 1050px;
          border-collapse: collapse;
        }
        .dependencies-table th, .dependencies-table td {
          padding: 12px 16px;
          text-align: left;
          border-bottom: 1px solid var(--border-primary);
        }
        .dependencies-table th {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-tertiary);
          letter-spacing: 0.5px;
          background: var(--bg-tertiary);
        }
        .dependencies-table tr:hover {
          background: var(--bg-hover);
        }

        .filter-bar {
          padding: 12px 16px !important;
        }
      `}</style>
    </div>
  );
}
