import React, { useState, useEffect, useCallback } from 'react';
import { api, type DatabaseQueryMetric } from '../api/client';

interface DbAnalyticsProps {
  namespace: string;
}

export default function DbAnalytics({ namespace }: DbAnalyticsProps) {
  const [metrics, setMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSystem, setSelectedSystem] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDatabaseMetrics(namespace || undefined);
      const list = data.metrics || [];
      setMetrics(list);

      // Extract unique services and systems for filters
      const svcNames = list.map(m => m.service);
      setServices([...new Set(svcNames)]);

      const sysNames = list.map(m => m.system);
      setSystems([...new Set(sysNames)]);
    } catch (err) {
      console.error('load database metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const iv = setInterval(loadMetrics, 5000);
    return () => clearInterval(iv);
  }, [loadMetrics]);

  const filteredMetrics = metrics.filter(m => {
    const matchesSearch = m.query.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSystem = selectedSystem ? m.system === selectedSystem : true;
    const matchesService = selectedService ? m.service === selectedService : true;
    return matchesSearch && matchesSystem && matchesService;
  });

  // Calculate aggregated stats
  const totalCalls = filteredMetrics.reduce((sum, m) => sum + m.callCount, 0);
  const totalErrors = filteredMetrics.reduce((sum, m) => sum + m.errorCount, 0);
  const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

  // Weighted average latency
  const avgLatency = totalCalls > 0
    ? filteredMetrics.reduce((sum, m) => sum + (m.avgDurationMs * m.callCount), 0) / totalCalls
    : 0;

  // Find max latency query
  const slowestQuery = filteredMetrics.length > 0
    ? Math.max(...filteredMetrics.map(m => m.maxDurationMs))
    : 0;

  const maxAvgDuration = filteredMetrics.length > 0
    ? Math.max(...filteredMetrics.map(m => m.avgDurationMs))
    : 1;

  const getSystemBadgeClass = (system: string) => {
    const sys = system.toLowerCase();
    if (sys.includes('postgre') || sys.includes('pg')) return 'badge-system-pg';
    if (sys.includes('mysql')) return 'badge-system-mysql';
    if (sys.includes('redis')) return 'badge-system-redis';
    if (sys.includes('mongo')) return 'badge-system-mongo';
    if (sys.includes('clickhouse')) return 'badge-system-ch';
    return 'badge-system-generic';
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Database Performance Analyzer</h1>
      <p className="page-subtitle">
        {namespace ? `Database call performance and hot queries in ${namespace}` : 'Database call performance across all namespaces'}
      </p>

      {/* Grid of Key Metrics */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '4px solid var(--accent-indigo)' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold' }}>Total DB Calls</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
            {totalCalls.toLocaleString()}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Aggregate across active operations</div>
        </div>

        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '4px solid var(--accent-emerald)' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold' }}>Avg Response Time</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
            {formatDuration(avgLatency)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Weighted execution average</div>
        </div>

        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '4px solid var(--accent-rose)' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold' }}>DB Error Rate</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
            {errorRate.toFixed(2)}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{totalErrors} failed statements</div>
        </div>

        <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: '4px solid var(--accent-amber)' }}>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold' }}>Worst Latency</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'var(--font-sans)', color: slowestQuery > 500 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
            {formatDuration(slowestQuery)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Peak statement duration</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="filter-bar db-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
        <div style={{ flex: '1', minWidth: '240px' }}>
          <input
            type="text"
            className="filter-select"
            style={{ width: '100%', padding: '8px 12px' }}
            placeholder="Search query statements..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <select className="filter-select" value={selectedSystem} onChange={e => setSelectedSystem(e.target.value)}>
          <option value="">All Dialects / Engines</option>
          {systems.map(sys => <option key={sys} value={sys}>{sys.toUpperCase()}</option>)}
        </select>
        <select className="filter-select" value={selectedService} onChange={e => setSelectedService(e.target.value)}>
          <option value="">All Services</option>
          {services.map(svc => <option key={svc} value={svc}>{svc}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={loadMetrics} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Query Performance Table */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">Database Queries Performance</div>
          <span className="text-sm text-muted">{filteredMetrics.length} query patterns active</span>
        </div>
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '80px' }}>System</th>
                <th>Query / Operation</th>
                <th>Service Source</th>
                <th style={{ width: '100px', textAlign: 'right' }}>Calls</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Avg Latency</th>
                <th style={{ width: '140px' }}>Relative Slowdown</th>
                <th style={{ width: '100px', textAlign: 'right' }}>Max Latency</th>
                <th style={{ width: '100px', textAlign: 'right' }}>Error Rate</th>
              </tr>
            </thead>
            <tbody>
              {filteredMetrics.map((m, index) => {
                const uniqueKey = `${m.query}-${m.service}-${index}`;
                const isExpanded = expandedQuery === uniqueKey;
                const pct = (m.avgDurationMs / maxAvgDuration) * 100;
                
                return (
                  <React.Fragment key={uniqueKey}>
                    <tr 
                      onClick={() => setExpandedQuery(isExpanded ? null : uniqueKey)}
                      style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                      className="hover-row"
                    >
                      <td data-label="System">
                        <span className={`badge ${getSystemBadgeClass(m.system)}`} style={{ fontSize: '10px', fontWeight: 'bold' }}>
                          {m.system.toUpperCase()}
                        </span>
                      </td>
                      <td data-label="Query" style={{ maxWidth: '350px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <code style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{m.query}</code>
                      </td>
                      <td data-label="Service">
                        <span className="badge badge-ns">{m.service}</span>
                      </td>
                      <td data-label="Calls" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.callCount}</td>
                      <td data-label="Avg Latency" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: '600', color: m.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                        {formatDuration(m.avgDurationMs)}
                      </td>
                      <td data-label="Slowdown" style={{ verticalAlign: 'middle' }}>
                        <div style={{ width: '100%', background: 'var(--bg-tertiary)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              width: `${pct}%`, 
                              height: '100%', 
                              background: m.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--accent-indigo)', 
                              borderRadius: '3px',
                              transition: 'width 0.4s ease'
                            }} 
                          />
                        </div>
                      </td>
                      <td data-label="Max Latency" style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {formatDuration(m.maxDurationMs)}
                      </td>
                      <td data-label="Error Rate" style={{ textAlign: 'right' }}>
                        {m.errorCount > 0 ? (
                          <span className="badge badge-error" style={{ fontSize: '11px' }}>{m.errorRate.toFixed(1)}%</span>
                        ) : (
                          <span className="badge badge-ok" style={{ fontSize: '11px' }}>0%</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg-tertiary)', padding: '16px', borderBottom: '1px solid var(--border-primary)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Full Query Statement</span>
                              <button 
                                className="btn btn-ghost btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(m.query);
                                }}
                                style={{ padding: '2px 8px', fontSize: '11px' }}
                              >
                                📋 Copy SQL
                              </button>
                            </div>
                            <pre style={{ 
                              whiteSpace: 'pre-wrap', 
                              wordBreak: 'break-all', 
                              background: 'var(--bg-secondary)', 
                              padding: '12px', 
                              borderRadius: '8px', 
                              border: '1px solid var(--border-primary)',
                              fontSize: '13px',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-primary)',
                              lineHeight: '1.4'
                            }}>
                              {m.query}
                            </pre>
                            <div className="db-expanded-details" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              <div><strong>Service:</strong> {m.service}</div>
                              <div><strong>Namespace:</strong> {m.namespace || 'N/A'}</div>
                              <div><strong>Total Executions:</strong> {m.callCount}</div>
                              <div><strong>Failures:</strong> {m.errorCount}</div>
                            </div>
                            {m.recentErrors && m.recentErrors.length > 0 && (
                              <div className="db-recent-errors" style={{ marginTop: '12px' }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  color: 'var(--accent-rose)',
                                  marginBottom: '8px'
                                }}>
                                  <span style={{ fontSize: '14px' }}>⚠</span>
                                  Recent Error Messages
                                  <span style={{
                                    background: 'rgba(229, 62, 62, 0.15)',
                                    color: 'var(--accent-rose)',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    padding: '2px 6px',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(229, 62, 62, 0.25)'
                                  }}>
                                    {m.recentErrors.length}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {m.recentErrors.map((err, errIdx) => (
                                    <div
                                      key={errIdx}
                                      style={{
                                        borderLeft: '3px solid var(--accent-rose)',
                                        background: 'rgba(229, 62, 62, 0.06)',
                                        padding: '8px 12px',
                                        borderRadius: '0 6px 6px 0',
                                        fontSize: '12px',
                                        fontFamily: 'var(--font-mono)',
                                        color: 'var(--text-secondary)',
                                        lineHeight: '1.4',
                                        wordBreak: 'break-word',
                                        whiteSpace: 'pre-wrap'
                                      }}
                                    >
                                      {err}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filteredMetrics.length === 0 && !loading && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-state-icon">🗃️</div>
                      <div className="empty-state-title">No database queries found</div>
                      <div className="empty-state-text">
                        No client spans with database tags were captured for {namespace ? `namespace "${namespace}"` : 'any namespace'}.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .badge-system-pg {
          background: rgba(43, 108, 176, 0.15) !important;
          color: #3182ce !important;
          border: 1px solid rgba(43, 108, 176, 0.3);
        }
        .badge-system-mysql {
          background: rgba(0, 117, 143, 0.15) !important;
          color: #00758f !important;
          border: 1px solid rgba(0, 117, 143, 0.3);
        }
        .badge-system-redis {
          background: rgba(229, 62, 62, 0.15) !important;
          color: #e53e3e !important;
          border: 1px solid rgba(229, 62, 62, 0.3);
        }
        .badge-system-mongo {
          background: rgba(72, 187, 120, 0.15) !important;
          color: #38a169 !important;
          border: 1px solid rgba(72, 187, 120, 0.3);
        }
        .badge-system-ch {
          background: rgba(245, 158, 11, 0.15) !important;
          color: #f59e0b !important;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .badge-system-generic {
          background: rgba(113, 128, 150, 0.15) !important;
          color: #4a5568 !important;
          border: 1px solid rgba(113, 128, 150, 0.3);
        }
        .hover-row:hover {
          background: var(--bg-hover) !important;
        }

        /* Responsive: filter bar stacking */
        @media (max-width: 768px) {
          .db-filter-bar {
            flex-direction: column !important;
          }
          .db-filter-bar > * {
            width: 100% !important;
            min-width: 0 !important;
          }
          .db-filter-bar select,
          .db-filter-bar button {
            width: 100% !important;
          }

          /* Expanded details stacking */
          .db-expanded-details {
            flex-direction: column !important;
            gap: 6px !important;
          }

          /* Table card layout on mobile */
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
          /* Hide the progress bar column on mobile for cleanliness */
          .db-table tbody tr.hover-row td:nth-child(6) {
            display: none;
          }
          /* Expanded row card on mobile */
          .db-table tbody tr:not(.hover-row) td {
            display: block;
            width: 100%;
            padding: 12px !important;
          }
        }

        /* Smooth error card hover */
        .db-recent-errors > div > div:hover {
          background: rgba(229, 62, 62, 0.1) !important;
        }
      `}</style>
    </div>
  );
}
