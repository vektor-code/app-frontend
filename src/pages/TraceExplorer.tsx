import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type TraceListItem } from '../api/client';

interface TraceExplorerProps {
  namespace: string;
}

export default function TraceExplorer({ namespace }: TraceExplorerProps) {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorFilter, setErrorFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const navigate = useNavigate();

  const loadTraces = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (namespace) params.namespace = namespace;
      if (serviceFilter) params.service = serviceFilter;
      if (errorFilter) params.hasError = errorFilter;
      params.limit = '100';

      const data = await api.getTraces(params);
      setTraces(data.traces || []);
    } catch (err) {
      console.error('load traces:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace, serviceFilter, errorFilter]);

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

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Trace Explorer</h1>
      <p className="page-subtitle">
        {namespace ? `Traces in ${namespace}` : 'All traces across namespaces'}
      </p>

      <div className="filter-bar">
        <select className="filter-select" value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
          <option value="">All Services</option>
          {services.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="filter-select" value={errorFilter} onChange={e => setErrorFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="true">Errors Only</option>
          <option value="false">Success Only</option>
        </select>
        <button className="btn btn-ghost btn-sm" onClick={loadTraces}>↻ Refresh</button>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">🔍 Traces</div>
          <span className="text-sm text-muted">{traces.length} traces</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Trace ID</th>
                <th>Service</th>
                <th>Operation</th>
                <th>Namespace</th>
                <th>Duration</th>
                <th>Spans</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {traces.map(t => (
                <tr key={t.traceId} onClick={() => navigate(`/traces/${t.traceId}`)}>
                  <td><span className="mono" style={{ color: 'var(--accent-indigo-light)' }}>{t.traceId.slice(0, 12)}…</span></td>
                  <td>{t.serviceName}</td>
                  <td className="mono text-sm">{t.rootName || '—'}</td>
                  <td><span className="badge badge-ns">{t.namespace}</span></td>
                  <td className="mono">{formatDuration(t.durationMs)}</td>
                  <td>{t.spanCount}</td>
                  <td><span className={`badge ${t.hasError ? 'badge-error' : 'badge-ok'}`}>{t.hasError ? 'ERROR' : 'OK'}</span></td>
                  <td className="text-sm text-muted">{formatTime(t.startTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {traces.length === 0 && !loading && (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
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
