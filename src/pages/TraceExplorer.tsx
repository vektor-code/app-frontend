import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type TraceListItem } from '../api/client';

interface TraceExplorerProps {
  namespace: string;
}

const SERVICE_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#a855f7', '#d946ef', '#0ea5e9', '#10b981', '#f59e0b',
];

function getServiceColor(name: string): string {
  if (!SERVICE_COLORS[name]) {
    const idx = Object.keys(SERVICE_COLORS).length % COLOR_PALETTE.length;
    SERVICE_COLORS[name] = COLOR_PALETTE[idx];
  }
  return SERVICE_COLORS[name];
}

export default function TraceExplorer({ namespace }: TraceExplorerProps) {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const navigate = useNavigate();

  // Filters
  const [serviceFilter, setServiceFilter] = useState('');
  const [errorFilter, setErrorFilter] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [traceIdFilter, setTraceIdFilter] = useState('');
  const [minSpans, setMinSpans] = useState('2');
  const [minDuration, setMinDuration] = useState('');

  const loadTraces = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { limit: '100' };
      if (namespace) params.namespace = namespace;
      if (serviceFilter) params.service = serviceFilter;
      if (errorFilter) params.hasError = errorFilter;
      if (operationFilter) params.operation = operationFilter;
      if (traceIdFilter) params.traceId = traceIdFilter;
      if (minSpans && parseInt(minSpans) > 0) params.minSpans = minSpans;
      if (minDuration && parseFloat(minDuration) > 0) params.minDuration = minDuration;

      const data = await api.getTraces(params);
      setTraces(data.traces || []);
    } catch (err) {
      console.error('load traces:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace, serviceFilter, errorFilter, operationFilter, traceIdFilter, minSpans, minDuration]);

  useEffect(() => { loadTraces(); }, [loadTraces]);

  useEffect(() => {
    api.getServices(namespace).then(data => {
      const svcNames = (data.services || []).map(s => s.serviceName);
      setServices([...new Set(svcNames)]);
    }).catch(() => {});
  }, [namespace]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(loadTraces, 5000);
    return () => clearInterval(iv);
  }, [loadTraces]);

  const maxDuration = traces.length > 0 ? Math.max(...traces.map(t => t.durationMs)) : 1;

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Trace Explorer</h1>
      <p className="page-subtitle">
        {namespace ? `Traces in ${namespace}` : 'All traces across namespaces'}
      </p>

      {/* Advanced Filter Bar */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Service</label>
              <select className="filter-select" value={serviceFilter} onChange={e => setServiceFilter(e.target.value)} style={{ width: '100%' }}>
                <option value="">All Services</option>
                {services.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Status</label>
              <select className="filter-select" value={errorFilter} onChange={e => setErrorFilter(e.target.value)} style={{ width: '100%' }}>
                <option value="">All Status</option>
                <option value="true">Errors Only</option>
                <option value="false">Success Only</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Operation</label>
              <input
                type="text"
                className="filter-select"
                placeholder="e.g. GET catalog"
                value={operationFilter}
                onChange={e => setOperationFilter(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Trace ID</label>
              <input
                type="text"
                className="filter-select"
                placeholder="Search by ID..."
                value={traceIdFilter}
                onChange={e => setTraceIdFilter(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Min Spans</label>
              <select className="filter-select" value={minSpans} onChange={e => setMinSpans(e.target.value)} style={{ width: '100%' }}>
                <option value="0">All (incl. DB noise)</option>
                <option value="2">≥ 2 spans (requests)</option>
                <option value="3">≥ 3 spans</option>
                <option value="5">≥ 5 spans</option>
                <option value="10">≥ 10 spans</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Min Duration</label>
              <input
                type="number"
                className="filter-select"
                placeholder="ms"
                value={minDuration}
                onChange={e => setMinDuration(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={loadTraces} style={{ width: '100%', height: '34px' }}>↻ Refresh</button>
            </div>
          </div>
        </div>
      </div>

      {/* Trace List */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Traces</div>
          <span className="text-sm text-muted">{traces.length} traces</span>
        </div>
        <div className="table-wrapper">
          <table style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Trace ID</th>
                <th style={{ width: '150px' }}>Root Service</th>
                <th style={{ width: '280px' }}>Operation</th>
                <th style={{ width: '180px' }}>Services</th>
                <th style={{ width: '200px' }}>Duration</th>
                <th style={{ width: '65px', textAlign: 'center' }}>Spans</th>
                <th style={{ width: '65px', textAlign: 'center' }}>Status</th>
                <th style={{ width: '85px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {traces.map(t => {
                const durationPct = maxDuration > 0 ? (t.durationMs / maxDuration) * 100 : 0;
                return (
                  <tr key={t.traceId} onClick={() => navigate(`/traces/${t.traceId}`)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span className="mono" style={{ color: 'var(--accent-indigo-light)', fontSize: '12px' }}>
                        {t.traceId.slice(0, 14)}…
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, fontSize: '13px', width: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.serviceName}>
                      {t.serviceName}
                    </td>
                    <td className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '280px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.rootName || '—'}>
                        {t.rootName || '—'}
                      </div>
                      {t.hasError && t.errorSummary && (
                        <div style={{ 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          gap: '4px', 
                          marginTop: '4px', 
                          padding: '2px 6px', 
                          borderRadius: '4px', 
                          background: 'rgba(244, 63, 94, 0.1)', 
                          border: '1px solid rgba(244, 63, 94, 0.2)',
                          fontSize: '10.5px',
                          color: 'var(--accent-rose)',
                          fontWeight: 500,
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }} title={t.errorSummary}>
                          <span style={{ 
                            textTransform: 'uppercase', 
                            fontSize: '9px', 
                            fontWeight: 700, 
                            padding: '1px 4px', 
                            borderRadius: '3px', 
                            background: 'var(--accent-rose)', 
                            color: '#ffffff',
                            marginRight: '2px',
                            flexShrink: 0
                          }}>
                            {t.errorType || 'err'}
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.errorSummary}
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={{ width: '180px', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', gap: '3px', overflow: 'hidden', whiteSpace: 'nowrap', alignItems: 'center' }}>
                        {(t.services || []).slice(0, 4).map(svc => (
                          <span
                            key={svc}
                            style={{
                              fontSize: '10px',
                              padding: '1px 6px',
                              borderRadius: '3px',
                              background: getServiceColor(svc) + '20',
                              color: getServiceColor(svc),
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {svc.replace('-backend', '')}
                          </span>
                        ))}
                        {(t.services || []).length > 4 && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>+{t.services!.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ width: '200px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          flex: 1,
                          height: '6px',
                          borderRadius: '3px',
                          background: 'var(--bg-tertiary)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${Math.max(2, durationPct)}%`,
                            height: '100%',
                            borderRadius: '3px',
                            background: t.hasError
                              ? 'linear-gradient(90deg, #f43f5e, #e11d48)'
                              : t.durationMs > 1000
                                ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                        <span className="mono" style={{ fontSize: '12px', minWidth: '55px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {formatDuration(t.durationMs)}
                        </span>
                      </div>
                    </td>
                    <td style={{ width: '65px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: t.spanCount >= 10 ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-tertiary)',
                        color: t.spanCount >= 10 ? '#818cf8' : 'var(--text-secondary)',
                      }}>
                        {t.spanCount}
                      </span>
                    </td>
                    <td style={{ width: '65px', textAlign: 'center' }}>
                      <span className={`badge ${t.hasError ? 'badge-error' : 'badge-ok'}`}>{t.hasError ? 'ERR' : 'OK'}</span>
                    </td>
                    <td className="text-sm text-muted" style={{ width: '85px', whiteSpace: 'nowrap' }}>{formatTime(t.startTime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {traces.length === 0 && !loading && (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <div className="empty-state-title">No traces found</div>
              <div className="empty-state-text">Adjust your filters or wait for new traces to arrive</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString();
}
