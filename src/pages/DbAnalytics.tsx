import React, { useState, useEffect, useCallback } from 'react';
import { api, type DatabaseQueryMetric } from '../api/client';

const generateMockResponse = (query: string) => {
  const q = query.toLowerCase();
  
  // Extract table name
  let tableName = 'unknown_table';
  const fromMatch = q.match(/from\s+([a-zA-Z0-9_]+)/);
  const joinMatch = q.match(/join\s+([a-zA-Z0-9_]+)/);
  const intoMatch = q.match(/into\s+([a-zA-Z0-9_]+)/);
  const updateMatch = q.match(/update\s+([a-zA-Z0-9_]+)/);
  
  if (fromMatch) tableName = fromMatch[1];
  else if (intoMatch) tableName = intoMatch[1];
  else if (updateMatch) tableName = updateMatch[1];
  else if (joinMatch) tableName = joinMatch[1];

  let columns: string[] = [];
  let rows: any[][] = [];

  if (tableName === 'documents') {
    columns = ['id', 'title', 'content', 'status', 'created_at', 'owner_id'];
    rows = [
      ['doc_8f93a1c2', 'Q3 Financial Audit Plan', 'Comprehensive audit strategy for Q3...', 'APPROVED', '2026-06-19 04:30:12', 'usr_3b9f1d0c'],
      ['doc_5e1b2f4c', 'User Management Service Spec', 'API routes and authorization matrix...', 'DRAFT', '2026-06-18 16:15:45', 'usr_7c8d9e2a']
    ];
  } else if (tableName === 'audit_log') {
    columns = ['id', 'action', 'user_id', 'ip_address', 'timestamp', 'status'];
    rows = [
      [10823, 'USER_LOGIN', 'usr_3b9f1d0c', '192.168.1.45', '2026-06-19 09:10:04', 'SUCCESS'],
      [10824, 'DOCUMENT_UPDATE', 'usr_7c8d9e2a', '10.254.12.8', '2026-06-19 09:12:01', 'SUCCESS']
    ];
  } else if (tableName === 'notifications') {
    columns = ['id', 'user_id', 'message', 'read', 'created_at'];
    rows = [
      ['ntf_01hz', 'usr_3b9f1d0c', 'Your report "Q3 Financial" has been approved.', 'false', '2026-06-19 04:35:00'],
      ['ntf_02jx', 'usr_3b9f1d0c', 'New login detected from device Mac OS X.', 'true', '2026-06-18 08:22:10']
    ];
  } else if (tableName === 'users' || tableName === 'roles') {
    columns = ['id', 'username', 'email', 'role_name', 'last_login', 'is_active'];
    rows = [
      ['usr_3b9f1d0c', 'kamal.p', 'kamal.p@rdmis.gov.az', 'ADMINISTRATOR', '2026-06-19 09:05:00', 'true'],
      ['usr_7c8d9e2a', 'aous.g', 'aous.g@rdmis.gov.az', 'DEVELOPER', '2026-06-19 08:44:12', 'true']
    ];
  } else if (tableName === 'sessions') {
    columns = ['session_id', 'user_id', 'token_hash', 'expires_at', 'created_at'];
    rows = [
      ['sess_abc123xyz', 'usr_3b9f1d0c', 'e3b0c44298fc1c149afbf4c8996fb924...', '2026-06-20 09:05:00', '2026-06-19 09:05:00']
    ];
  } else {
    columns = ['id', 'name', 'status', 'updated_at'];
    rows = [
      ['gen_01', `mock_${tableName}_row_1`, 'ACTIVE', '2026-06-19 09:00:00'],
      ['gen_02', `mock_${tableName}_row_2`, 'ACTIVE', '2026-06-19 09:01:15']
    ];
  }

  return { tableName, columns, rows };
};

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

  // Column width state for resizable columns
  const [colWidths, setColWidths] = useState({
    system: 90,
    query: 300,
    service: 140,
    calls: 70,
    avgLatency: 95,
    slowdown: 110,
    maxLatency: 95,
    errorRate: 85,
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
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

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
    if (sys.includes('oracle')) return 'badge-system-oracle';
    if (sys.includes('mssql') || sys.includes('sqlserver')) return 'badge-system-mssql';
    if (sys === 'sql') return 'badge-system-sql';
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
          <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: colWidths.system, position: 'relative' }}>
                  System
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'system')} />
                </th>
                <th style={{ width: colWidths.query, position: 'relative' }}>
                  Query / Operation
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'query')} />
                </th>
                <th style={{ width: colWidths.service, position: 'relative' }}>
                  Service
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'service')} />
                </th>
                <th style={{ width: colWidths.calls, textAlign: 'right', position: 'relative' }}>
                  Calls
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'calls')} />
                </th>
                <th style={{ width: colWidths.avgLatency, textAlign: 'right', position: 'relative' }}>
                  Avg Latency
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'avgLatency')} />
                </th>
                <th style={{ width: colWidths.slowdown, position: 'relative' }}>
                  Slowdown
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'slowdown')} />
                </th>
                <th style={{ width: colWidths.maxLatency, textAlign: 'right', position: 'relative' }}>
                  Max Latency
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'maxLatency')} />
                </th>
                <th style={{ width: colWidths.errorRate, textAlign: 'right', position: 'relative' }}>
                  Error Rate
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'errorRate')} />
                </th>
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
                      <td data-label="System" style={{ width: colWidths.system, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className={`badge ${getSystemBadgeClass(m.system)}`} style={{ fontSize: '10px', fontWeight: 'bold' }}>
                          {m.system.toUpperCase()}
                        </span>
                      </td>
                      <td data-label="Query" style={{ width: colWidths.query, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <code style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{m.query}</code>
                      </td>
                      <td data-label="Service" style={{ width: colWidths.service, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className="badge badge-ns">{m.service}</span>
                      </td>
                      <td data-label="Calls" style={{ width: colWidths.calls, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.callCount}</td>
                      <td data-label="Avg Latency" style={{ width: colWidths.avgLatency, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: '600', color: m.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                        {formatDuration(m.avgDurationMs)}
                      </td>
                      <td data-label="Slowdown" style={{ width: colWidths.slowdown, verticalAlign: 'middle' }}>
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
                      <td data-label="Max Latency" style={{ width: colWidths.maxLatency, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {formatDuration(m.maxDurationMs)}
                      </td>
                      <td data-label="Error Rate" style={{ width: colWidths.errorRate, textAlign: 'right' }}>
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
                                style={{ padding: '2px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                Copy SQL
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

                            {/* Query Response Preview */}
                            <div style={{ marginTop: '16px', borderTop: '1px dashed var(--border-primary)', paddingTop: '16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-emerald)' }}>
                                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                                    <path d="M3 5V19A9 3 0 0 0 21 19V5"></path>
                                    <path d="M3 12A9 3 0 0 0 21 12"></path>
                                  </svg>
                                  Query Response Preview (Simulated)
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
                                  Compliance: Raw DB rows omitted to protect sensitive data
                                </span>
                              </div>

                              {/* Alert Warning for compliance */}
                              <div style={{
                                display: 'flex',
                                gap: '10px',
                                background: 'rgba(99, 102, 241, 0.05)',
                                border: '1px solid rgba(99, 102, 241, 0.15)',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                marginBottom: '12px',
                                lineHeight: '1.4'
                              }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-indigo)', flexShrink: 0, marginTop: '2px' }}>
                                  <circle cx="12" cy="12" r="10"></circle>
                                  <line x1="12" y1="16" x2="12" y2="12"></line>
                                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                </svg>
                                <span>
                                  Standard OpenTelemetry security protocols restrict capturing live database returned rows to comply with privacy policies (GDPR/PCI-DSS). Below is a simulated view based on table <code>{generateMockResponse(m.query).tableName}</code> schema characteristics.
                                </span>
                              </div>

                              {/* Mock Table */}
                              <div className="table-wrapper" style={{ margin: 0, borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', overflowX: 'auto' }}>
                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)' }}>
                                      {generateMockResponse(m.query).columns.map(col => (
                                        <th key={col} style={{ padding: '8px 12px', fontWeight: 'bold', color: 'var(--text-secondary)', textAlign: 'left', borderRight: '1px solid var(--border-primary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                          {col}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {generateMockResponse(m.query).rows.map((row, rIdx) => (
                                      <tr key={rIdx} style={{ borderBottom: rIdx === generateMockResponse(m.query).rows.length - 1 ? 'none' : '1px solid var(--border-primary)' }} className="hover-row">
                                        {row.map((cell, cIdx) => (
                                          <td key={cIdx} style={{ padding: '8px 12px', color: 'var(--text-primary)', borderRight: '1px solid var(--border-primary)', fontFamily: typeof cell === 'number' || String(cell).startsWith('usr_') || String(cell).startsWith('doc_') || String(cell).includes('-') ? 'var(--font-mono)' : 'inherit' }}>
                                            {String(cell)}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
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
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-rose)' }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                    <line x1="12" y1="9" x2="12" y2="13"></line>
                                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                  </svg>
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
                      <div className="empty-state-icon" style={{ color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                          <path d="M3 5V19A9 3 0 0 0 21 19V5"></path>
                          <path d="M3 12A9 3 0 0 0 21 12"></path>
                        </svg>
                      </div>
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
        .badge-system-oracle {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #ef4444 !important;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .badge-system-mssql {
          background: rgba(139, 92, 246, 0.15) !important;
          color: #8b5cf6 !important;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        .badge-system-sql {
          background: rgba(6, 182, 212, 0.15) !important;
          color: #06b6d4 !important;
          border: 1px solid rgba(6, 182, 212, 0.3);
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
      `}</style>
    </div>
  );
}
