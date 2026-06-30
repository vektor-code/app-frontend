import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type TraceListItem } from '../api/client';

interface TraceExplorerProps {
  namespace: string;
  cluster: string;
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
    <div style={{ position: 'relative', width: '100%' }} onClick={e => e.stopPropagation()}>
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

export default function TraceExplorer({ namespace, cluster }: TraceExplorerProps) {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [colWidths, setColWidths] = useState({
    traceId: 110,
    service: 150,
    operation: 280,
    services: 180,
    duration: 200,
    spans: 65,
    status: 65,
    time: 85,
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

  // Filters read directly from URL search params
  const serviceFilter = searchParams.get('service') || '';
  const errorFilter = searchParams.get('hasError') || '';
  const operationFilter = searchParams.get('operation') || '';
  const traceIdFilter = searchParams.get('traceId') || '';
  const minSpans = searchParams.get('minSpans') || '2';
  const minDuration = searchParams.get('minDuration') || '';

  const serviceOptions = [
    { value: '', label: 'All Services' },
    ...services.map(s => ({ value: s, label: s }))
  ];

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'true', label: 'Errors Only' },
    { value: 'false', label: 'Success Only' }
  ];

  const spanOptions = [
    { value: '0', label: 'All (incl. DB noise)' },
    { value: '2', label: '≥ 2 spans (requests)' },
    { value: '3', label: '≥ 3 spans' },
    { value: '5', label: '≥ 5 spans' },
    { value: '10', label: '≥ 10 spans' }
  ];

  const setFilterVal = (key: string, val: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) {
        next.set(key, val);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const loadTraces = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { limit: '100' };
      if (namespace) params.namespace = namespace;
      if (cluster) params.cluster = cluster;
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
  }, [namespace, cluster, serviceFilter, errorFilter, operationFilter, traceIdFilter, minSpans, minDuration]);

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
        Search and filter requests flowing through your services
      </p>

      {/* Advanced Filter Bar */}
      <div className="card" style={{ marginBottom: '16px', overflow: 'visible' }}>
        <div className="card-body" style={{ padding: '16px 20px', overflow: 'visible' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Service</label>
              <CustomDropdown
                options={serviceOptions}
                value={serviceFilter}
                onChange={val => setFilterVal('service', val)}
                placeholder="All Services"
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Status</label>
              <CustomDropdown
                options={statusOptions}
                value={errorFilter}
                onChange={val => setFilterVal('hasError', val)}
                placeholder="All Status"
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Operation</label>
              <input
                type="text"
                className="filter-select"
                placeholder="e.g. GET catalog"
                value={operationFilter}
                onChange={e => setFilterVal('operation', e.target.value)}
                style={{ width: '100%', height: '36px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Trace ID</label>
              <input
                type="text"
                className="filter-select"
                placeholder="Search by ID..."
                value={traceIdFilter}
                onChange={e => setFilterVal('traceId', e.target.value)}
                style={{ width: '100%', height: '36px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Min Spans</label>
              <CustomDropdown
                options={spanOptions}
                value={minSpans}
                onChange={val => setFilterVal('minSpans', val)}
                placeholder="≥ 2 spans (requests)"
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>Min Duration</label>
              <input
                type="number"
                className="filter-select"
                placeholder="ms"
                value={minDuration}
                onChange={e => setFilterVal('minDuration', e.target.value)}
                style={{ width: '100%', height: '36px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none' }}
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
          <table style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ width: colWidths.traceId, position: 'relative' }}>
                  Trace ID
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'traceId')} />
                </th>
                <th style={{ width: colWidths.service, position: 'relative' }}>
                  Root Service
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'service')} />
                </th>
                <th style={{ width: colWidths.operation, position: 'relative' }}>
                  Operation
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'operation')} />
                </th>
                <th style={{ width: colWidths.services, position: 'relative' }}>
                  Services
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'services')} />
                </th>
                <th style={{ width: colWidths.duration, position: 'relative' }}>
                  Duration
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'duration')} />
                </th>
                <th style={{ width: colWidths.spans, textAlign: 'center', position: 'relative' }}>
                  Spans
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'spans')} />
                </th>
                <th style={{ width: colWidths.status, textAlign: 'center', position: 'relative' }}>
                  Status
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'status')} />
                </th>
                <th style={{ width: colWidths.time, position: 'relative' }}>
                  Time
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'time')} />
                </th>
              </tr>
            </thead>
            <tbody>
              {traces.map(t => {
                const durationPct = maxDuration > 0 ? (t.durationMs / maxDuration) * 100 : 0;
                return (
                  <tr key={t.traceId} onClick={() => navigate(`/traces/${t.traceId}`)} style={{ cursor: 'pointer' }} className="hover-row">
                    <td style={{ width: colWidths.traceId, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span className="mono" style={{ color: 'var(--accent-indigo-light)', fontSize: '12px' }}>
                        {t.traceId.slice(0, 14)}…
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, fontSize: '13px', width: colWidths.service, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.serviceName}>
                      {t.serviceName}
                    </td>
                    <td className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)', width: colWidths.operation, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    <td style={{ width: colWidths.services, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                        {/* Internal Services */}
                        {(t.services || []).slice(0, 3).map(svc => (
                          <span
                            key={svc}
                            style={{
                              fontSize: '9.5px',
                              padding: '1px 5px',
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
                        {(t.services || []).length > 3 && (
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>+{t.services!.length - 3}</span>
                        )}

                        {/* Connections & 3rd Party Destinations */}
                        {(t.thirdPartyTools || []).slice(0, 2).map(tool => {
                          const isKnown3rd = ['stripe', 'paypal', 'openai', 'twilio', 'github', 'slack', 'discord', 'mygov', 'egov'].some(k => tool.toLowerCase().includes(k));
                          return (
                            <span
                              key={tool}
                              style={{
                                fontSize: '9.5px',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                background: isKnown3rd ? 'rgba(245, 158, 11, 0.1)' : 'rgba(14, 165, 233, 0.1)',
                                color: isKnown3rd ? 'var(--accent-amber, #f59e0b)' : 'var(--accent-cyan, #0ea5e9)',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                border: isKnown3rd ? '1px dashed rgba(245, 158, 11, 0.3)' : '1px solid rgba(14, 165, 233, 0.15)',
                                textTransform: isKnown3rd ? 'none' : 'lowercase'
                              }}
                              title={tool}
                            >
                              {tool.length > 12 ? tool.slice(0, 10) + '..' : tool}
                            </span>
                          );
                        })}
                        {(t.thirdPartyTools || []).length > 2 && (
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600 }}>+{t.thirdPartyTools!.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ width: colWidths.duration }}>
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
                    <td style={{ width: colWidths.spans, textAlign: 'center' }}>
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
                    <td style={{ width: colWidths.status, textAlign: 'center' }}>
                      <span className={`badge ${t.hasError ? 'badge-error' : 'badge-ok'}`}>{t.hasError ? 'ERR' : 'OK'}</span>
                    </td>
                    <td className="text-sm text-muted" style={{ width: colWidths.time, whiteSpace: 'nowrap' }}>{formatTime(t.startTime)}</td>
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
