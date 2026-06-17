import React, { useState, useMemo } from 'react';
import type { Span } from '../api/client';

interface SpanTimelineProps {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
}

const SERVICE_COLORS: Record<string, string> = {};
const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

function svcColor(name: string): string {
  if (!SERVICE_COLORS[name]) {
    SERVICE_COLORS[name] = PALETTE[Object.keys(SERVICE_COLORS).length % PALETTE.length];
  }
  return SERVICE_COLORS[name];
}

const KIND_LABELS: Record<string, { label: string; color: string }> = {
  SERVER: { label: 'SVR', color: '#6366f1' },
  CLIENT: { label: 'CLI', color: '#06b6d4' },
  PRODUCER: { label: 'PUB', color: '#22c55e' },
  CONSUMER: { label: 'SUB', color: '#f97316' },
  INTERNAL: { label: 'INT', color: '#64748b' },
};

const GRPC_STATUS_MAP: Record<string, { name: string; description: string }> = {
  '0': { name: 'OK', description: 'Success' },
  '1': { name: 'CANCELLED', description: 'The operation was cancelled (typically by the caller).' },
  '2': { name: 'UNKNOWN', description: 'Unknown error. An error was returned by another address space.' },
  '3': { name: 'INVALID_ARGUMENT', description: 'Client specified an invalid argument. Check client parameters.' },
  '4': { name: 'DEADLINE_EXCEEDED', description: 'Deadline expired before operation could complete.' },
  '5': { name: 'NOT_FOUND', description: 'Some requested entity (e.g., file or directory) was not found.' },
  '6': { name: 'ALREADY_EXISTS', description: 'Some entity that we attempted to create (e.g., file or directory) already exists.' },
  '7': { name: 'PERMISSION_DENIED', description: 'The caller does not have permission to execute the specified operation.' },
  '8': { name: 'RESOURCE_EXHAUSTED', description: 'Some resource has been exhausted, perhaps a per-user quota, or the entire file system is full.' },
  '9': { name: 'FAILED_PRECONDITION', description: 'Operation was rejected because the system is not in a state required for the operation\'s execution.' },
  '10': { name: 'ABORTED', description: 'The operation was aborted, typically due to a concurrency issue like sequencer check failures.' },
  '11': { name: 'OUT_OF_RANGE', description: 'Operation was attempted past the valid range. E.g., seeking or reading past end of file.' },
  '12': { name: 'UNIMPLEMENTED', description: 'The operation is not implemented or not supported/enabled in this service (gRPC Code 12).' },
  '13': { name: 'INTERNAL', description: 'Internal errors. Means some invariants expected by underlying system has been broken.' },
  '14': { name: 'UNAVAILABLE', description: 'The service is currently unavailable. This is most likely a transient condition.' },
  '15': { name: 'DATA_LOSS', description: 'Unrecoverable data loss or corruption.' },
  '16': { name: 'UNAUTHENTICATED', description: 'The request does not have valid authentication credentials for the operation.' }
};

function getErrorFromAttributes(span: Span): string | null {
  const attrs = span.attributes || {};
  const errorKeys = [
    'error.message', 'error.msg', 'error.type', 
    'exception.message', 'exception.type', 
    'grpc.status_description', 'http.status_text',
    'status.message', 'status.description'
  ];
  for (const key of errorKeys) {
    if (attrs[key]) return attrs[key];
  }
  if (attrs['rpc.grpc.status_code']) {
    const code = attrs['rpc.grpc.status_code'];
    const info = GRPC_STATUS_MAP[code];
    if (info) {
      return `gRPC Error (${info.name}): ${info.description}`;
    }
  }
  if (attrs['http.status_code']) {
    const code = attrs['http.status_code'];
    return `HTTP Error: Server returned status code ${code}`;
  }
  if (span.events && span.events.length > 0) {
    for (const ev of span.events) {
      if (ev.attributes) {
        if (ev.attributes['exception.message']) {
          return `${ev.name}: ${ev.attributes['exception.message']}`;
        }
        if (ev.attributes['message']) {
          return `${ev.name}: ${ev.attributes['message']}`;
        }
      }
    }
  }
  return null;
}

// Heuristic to calculate the critical path (longest sequential delay path)
function calculateCriticalPath(spans: Span[]): Set<string> {
  const critical = new Set<string>();
  if (spans.length === 0) return critical;

  const spanMap = new Map(spans.map(s => [s.spanId, s]));
  const roots = spans.filter(s => !s.parentSpanId || !spanMap.has(s.parentSpanId));
  if (roots.length === 0) return critical;

  // Take the root with longest execution duration
  roots.sort((a, b) => b.durationMs - a.durationMs);
  let current: Span | undefined = roots[0];

  while (current) {
    critical.add(current.spanId);
    const children = spans.filter(s => s.parentSpanId === current!.spanId);
    if (children.length === 0) break;

    // Find child that consumes the most duration
    let heaviestChild: Span | undefined = undefined;
    let maxDur = 0;
    for (const child of children) {
      if (child.durationMs > maxDur) {
        maxDur = child.durationMs;
        heaviestChild = child;
      }
    }
    current = heaviestChild;
  }
  return critical;
}

function getStackTrace(span: Span): string | null {
  const attrs = span.attributes || {};
  if (attrs['exception.stacktrace']) return String(attrs['exception.stacktrace']);
  if (attrs['error.stack']) return String(attrs['error.stack']);
  if (span.events) {
    for (const ev of span.events) {
      if (ev.attributes && ev.attributes['exception.stacktrace']) {
        return String(ev.attributes['exception.stacktrace']);
      }
    }
  }
  return null;
}

function renderHighlightedStackTrace(stack: string) {
  const lines = stack.split('\n');
  return lines.map((line, idx) => {
    let content: React.ReactNode = line;
    const fileLineMatch = line.match(/([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+):(\d+)/);
    if (fileLineMatch) {
      const [full, file, lineNum] = fileLineMatch;
      const parts = line.split(full);
      content = (
        <>
          {parts[0]}
          <span 
            className="stack-file" 
            title="Copy reference" 
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(`${file}:${lineNum}`);
            }}
          >
            {file}:{lineNum}
          </span>
          {parts[1]}
        </>
      );
    }
    const isOrigin = idx === 0 || line.includes('Exception') || line.includes('Error');
    return (
      <div key={idx} className={`stack-line ${isOrigin ? 'stack-origin' : ''}`}>
        {content}
      </div>
    );
  });
}

export default function SpanTimeline({ spans, traceStartTime, traceDuration }: SpanTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'critical'>('all');
  const [activeTabs, setActiveTabs] = useState<Record<string, 'attrs' | 'infra' | 'events'>>({});
  const [attrSearch, setAttrSearch] = useState<Record<string, string>>({});
  const [stackTraceExpanded, setStackTraceExpanded] = useState<Set<string>>(new Set());

  const criticalPathSet = useMemo(() => calculateCriticalPath(spans), [spans]);

  // Compute breakdown stats
  const breakdown = useMemo(() => {
    let dbTime = 0;
    let httpTime = 0;
    let rpcTime = 0;
    let internalTime = 0;

    spans.forEach(s => {
      const a = s.attributes || {};
      if (a['db.system'] || a['db.statement']) {
        dbTime += s.durationMs;
      } else if (a['http.url'] || a['http.method']) {
        httpTime += s.durationMs;
      } else if (a['rpc.system']) {
        rpcTime += s.durationMs;
      } else {
        internalTime += s.durationMs;
      }
    });

    const total = dbTime + httpTime + rpcTime + internalTime || 1;
    return {
      db: (dbTime / total) * 100,
      http: (httpTime / total) * 100,
      rpc: (rpcTime / total) * 100,
      internal: (internalTime / total) * 100,
      dbRaw: dbTime,
      httpRaw: httpTime,
      rpcRaw: rpcTime,
      internalRaw: internalTime,
    };
  }, [spans]);

  if (!spans || spans.length === 0) {
    return <div className="empty-state"><div className="empty-state-title">No spans found for this trace</div></div>;
  }

  const spanMap = new Map<string, Span>();
  const rootSpans: Span[] = [];
  spans.forEach(s => spanMap.set(s.spanId, s));
  spans.forEach(s => {
    if (!s.parentSpanId || !spanMap.has(s.parentSpanId)) {
      rootSpans.push(s);
    }
  });

  const getChildren = (parentId: string) => spans.filter(s => s.parentSpanId === parentId);

  const toggleExpand = (spanId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  const getActiveTab = (spanId: string) => activeTabs[spanId] || 'attrs';
  const setActiveTab = (spanId: string, tab: 'attrs' | 'infra' | 'events') => {
    setActiveTabs(prev => ({ ...prev, [spanId]: tab }));
  };

  function renderSpan(span: Span, depth: number, isLast: boolean): React.ReactNode {
    const start = new Date(span.startTime).getTime();
    const offsetPercent = traceDuration > 0 ? ((start - traceStartTime) / traceDuration) * 100 : 0;
    const widthPercent = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 100;
    const children = getChildren(span.spanId);
    const isExpanded = expanded.has(span.spanId);
    const isError = span.status === 'ERROR';
    const isCritical = criticalPathSet.has(span.spanId);
    const kindInfo = KIND_LABELS[span.kind] || KIND_LABELS.INTERNAL;
    const color = svcColor(span.serviceName);

    // Filters check
    const matchesSearch = 
      span.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      span.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      Object.values(span.attributes || {}).some(v => String(v).toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = 
      filterType === 'all' || 
      (filterType === 'errors' && isError) || 
      (filterType === 'critical' && isCritical);

    const isDimmed = !matchesSearch || !matchesType;

    const attrs = span.attributes || {};
    const filepath = attrs['code.filepath'] || attrs['code.file'];
    const lineno = attrs['code.lineno'] || attrs['code.line'];
    const funcName = attrs['code.function'] || attrs['code.func'];
    const currentAttrSearch = attrSearch[span.spanId] || '';

    // Grouping attributes
    const httpAttrs: Record<string, string> = {};
    const dbAttrs: Record<string, string> = {};
    const rpcAttrs: Record<string, string> = {};
    const otherAttrs: Record<string, string> = {};

    Object.entries(attrs).forEach(([k, v]) => {
      if (currentAttrSearch && !k.toLowerCase().includes(currentAttrSearch.toLowerCase()) && !String(v).toLowerCase().includes(currentAttrSearch.toLowerCase())) {
        return;
      }
      if (k.startsWith('http.')) httpAttrs[k] = v;
      else if (k.startsWith('db.')) dbAttrs[k] = v;
      else if (k.startsWith('rpc.')) rpcAttrs[k] = v;
      else otherAttrs[k] = v;
    });

    const activeTab = getActiveTab(span.spanId);

    return (
      <React.Fragment key={span.spanId}>
        <div
          className={`waterfall-row ${isCritical ? 'critical-path-row' : ''}`}
          style={{
            opacity: isDimmed ? 0.35 : 1,
            cursor: 'pointer',
            borderLeft: isError ? '3px solid var(--accent-rose)' : isCritical ? '3px solid var(--accent-amber)' : '3px solid transparent',
            background: isExpanded ? 'var(--bg-tertiary)' : undefined,
            transition: 'opacity 0.2s, background 0.2s',
          }}
          onClick={() => toggleExpand(span.spanId)}
        >
          {/* Label side */}
          <div className="waterfall-label" style={{ paddingLeft: `${depth * 18 + 8}px` }}>
            {depth > 0 && (
              <span className="timeline-connector">
                {isLast ? '└' : '├'}
              </span>
            )}
            <span style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: color,
              marginRight: '6px',
              flexShrink: 0,
            }} />
            <div className="waterfall-svc" style={{ color }}>
              {span.serviceName}
            </div>
            <span className="span-kind-badge" style={{
              fontSize: '9px',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: '3px',
              background: kindInfo.color + '15',
              color: kindInfo.color,
              marginLeft: '6px',
            }}>
              {kindInfo.label}
            </span>
            <div className="waterfall-name" title={span.name}>
              {span.name}
            </div>
            {filepath && (
              <span 
                className="code-context-badge"
                title={`Click to copy: ${filepath}:${lineno || 0}${funcName ? ` (${funcName})` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(`${filepath}:${lineno || 0}`);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '3px', verticalAlign: 'middle' }}>
                  <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
                </svg>
                {String(filepath).split('/').pop()}:{lineno}{funcName ? ` → ${funcName}` : ''}
              </span>
            )}
            {isCritical && (
              <span className="badge-critical-path">
                Critical Path
              </span>
            )}
            {isExpanded ? (
              <span className="expanded-arrow">▾</span>
            ) : (
              <span className="expanded-arrow">▸</span>
            )}
          </div>

          {/* Bar timeline side */}
          <div className="waterfall-bar-container">
            <div
              className={`waterfall-bar ${isError ? 'error' : isCritical ? 'critical' : ''}`}
              style={{
                left: `${Math.max(0, offsetPercent)}%`,
                width: `${Math.max(0.6, widthPercent)}%`,
                background: isError ? 'var(--accent-rose)' : isCritical ? 'var(--accent-amber)' : color,
                boxShadow: isCritical ? '0 0 8px rgba(245, 158, 11, 0.4)' : undefined,
              }}
            />
          </div>
          <div className="waterfall-duration">{formatDuration(span.durationMs)}</div>
        </div>

        {/* Inline Drawer Details */}
        {isExpanded && (
          <div className="span-detail-drawer" style={{
            marginLeft: `${depth * 18 + 26}px`,
          }}>
            {/* Detailed Execution Error Banner */}
            {isError && (
              <div className="error-banner">
                <div className="error-banner-header">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Span Execution Error
                </div>
                <div className="error-banner-body">
                  {span.error || getErrorFromAttributes(span) || 'An error occurred during operation. Inspect the attributes and event stack below.'}
                </div>
              </div>
            )}

            {/* Stack Trace Collapsible Section */}
            {(() => {
              const stack = getStackTrace(span);
              if (!stack) return null;
              const hasExpanded = stackTraceExpanded.has(span.spanId);
              return (
                <div className="stacktrace-container" onClick={(e) => e.stopPropagation()}>
                  <div 
                    className="stacktrace-header" 
                    onClick={() => {
                      setStackTraceExpanded(prev => {
                        const next = new Set(prev);
                        if (next.has(span.spanId)) next.delete(span.spanId);
                        else next.add(span.spanId);
                        return next;
                      });
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      <span>Stack Trace</span>
                    </div>
                    <span>{hasExpanded ? 'Hide ▾' : 'Show ▸'}</span>
                  </div>
                  {hasExpanded && (
                    <pre className="stacktrace-pre">
                      <code>{renderHighlightedStackTrace(stack)}</code>
                    </pre>
                  )}
                </div>
              );
            })()}

            {/* Span Events Timeline */}
            {span.events && span.events.length > 0 && (
              <div className="mini-timeline-container" onClick={(e) => e.stopPropagation()}>
                <div className="mini-timeline-title">Span Events Timeline</div>
                <div className="mini-timeline-bar-wrapper">
                  <div className="mini-timeline-bar" />
                  {span.events.map((ev, i) => {
                    const evTime = new Date(ev.timestamp).getTime();
                    const spanStart = new Date(span.startTime).getTime();
                    const relativeMs = evTime - spanStart;
                    const relativePercent = span.durationMs > 0 ? (relativeMs / span.durationMs) * 100 : 0;
                    const isErrorEvent = ev.name.toLowerCase().includes('error') || 
                                         ev.name.toLowerCase().includes('exception') || 
                                         (ev.attributes && (ev.attributes['exception.type'] || ev.attributes['exception.message']));
                    
                    return (
                      <div 
                        key={i} 
                        className={`mini-timeline-dot ${isErrorEvent ? 'error-dot' : ''}`}
                        style={{ left: `${Math.min(100, Math.max(0, relativePercent))}%` }}
                        onClick={() => setActiveTab(span.spanId, 'events')}
                      >
                        <div className="mini-timeline-tooltip">
                          <span className="tooltip-name">{ev.name}</span>
                          <span className="tooltip-time">+{formatDuration(relativeMs)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mini-timeline-labels">
                  <span>0ms</span>
                  <span>{formatDuration(span.durationMs)}</span>
                </div>
              </div>
            )}

            {/* Tab navigation */}
            <div className="drawer-tabs">
              <button 
                className={`drawer-tab-btn ${activeTab === 'attrs' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveTab(span.spanId, 'attrs'); }}
              >
                Attributes ({Object.keys(attrs).length})
              </button>
              <button 
                className={`drawer-tab-btn ${activeTab === 'infra' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveTab(span.spanId, 'infra'); }}
              >
                Infrastructure
              </button>
              <button 
                className={`drawer-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setActiveTab(span.spanId, 'events'); }}
              >
                Logs/Events ({span.events ? span.events.length : 0})
              </button>
            </div>

            <div className="drawer-content">
              {/* Tab 1: Attributes */}
              {activeTab === 'attrs' && (
                <div onClick={(e) => e.stopPropagation()}>
                  <div className="drawer-search-bar">
                    <input 
                      type="text" 
                      placeholder="Filter attributes..." 
                      value={currentAttrSearch}
                      onChange={(e) => setAttrSearch(prev => ({ ...prev, [span.spanId]: e.target.value }))}
                      className="filter-select"
                      style={{ width: '100%', fontSize: '11.5px', padding: '6px 10px', marginBottom: '8px' }}
                    />
                  </div>

                  {Object.keys(attrs).length === 0 ? (
                    <div className="text-muted text-center" style={{ padding: '8px 0' }}>No attributes recorded for this span.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {/* HTTP attributes */}
                      {Object.keys(httpAttrs).length > 0 && (
                        <div>
                          <div className="attr-group-header">HTTP Protocol</div>
                          <table className="attr-table">
                            <tbody>
                              {Object.entries(httpAttrs).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="attr-key">{k}</td>
                                  <td className="attr-val">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Database attributes */}
                      {Object.keys(dbAttrs).length > 0 && (
                        <div>
                          <div className="attr-group-header">Database Query details</div>
                          <table className="attr-table">
                            <tbody>
                              {Object.entries(dbAttrs).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="attr-key">{k}</td>
                                  <td className="attr-val" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* RPC attributes */}
                      {Object.keys(rpcAttrs).length > 0 && (
                        <div>
                          <div className="attr-group-header">gRPC / Remote Procedure Call</div>
                          <table className="attr-table">
                            <tbody>
                              {Object.entries(rpcAttrs).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="attr-key">{k}</td>
                                  <td className="attr-val">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* General attributes */}
                      {Object.keys(otherAttrs).length > 0 && (
                        <div>
                          <div className="attr-group-header">General Metadata</div>
                          <table className="attr-table">
                            <tbody>
                              {Object.entries(otherAttrs).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="attr-key">{k}</td>
                                  <td className="attr-val">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Infrastructure */}
              {activeTab === 'infra' && (
                <table className="attr-table" onClick={(e) => e.stopPropagation()}>
                  <tbody>
                    <tr>
                      <td className="attr-key">Namespace</td>
                      <td className="attr-val"><span className="badge badge-ns">{span.namespace || 'default'}</span></td>
                    </tr>
                    {span.podName && (
                      <tr>
                        <td className="attr-key">Kubernetes Pod</td>
                        <td className="attr-val">{span.podName}</td>
                      </tr>
                    )}
                    {span.nodeName && (
                      <tr>
                        <td className="attr-key">Kubernetes Node</td>
                        <td className="attr-val">{span.nodeName}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="attr-key">Span ID</td>
                      <td className="attr-val mono">{span.spanId}</td>
                    </tr>
                    {span.parentSpanId && (
                      <tr>
                        <td className="attr-key">Parent Span ID</td>
                        <td className="attr-val mono">{span.parentSpanId}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="attr-key">Span Kind</td>
                      <td className="attr-val">{span.kind}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Tab 3: Events/Logs */}
              {activeTab === 'events' && (
                <div onClick={(e) => e.stopPropagation()}>
                  {!span.events || span.events.length === 0 ? (
                    <div className="text-muted text-center" style={{ padding: '8px 0' }}>No timeline events recorded for this span.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {span.events.map((ev, i) => (
                        <div key={i} className="event-item">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{ev.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '10.5px' }}>
                              {new Date(ev.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                            <div className="event-attrs">
                              {Object.entries(ev.attributes).map(([ek, evVal]) => (
                                <div key={ek} style={{ fontSize: '10.5px' }}>
                                  <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginRight: '4px' }}>{ek}:</span>
                                  <span className="mono" style={{ wordBreak: 'break-all' }}>{evVal}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {children.map((child, idx) => renderSpan(child, depth + 1, idx === children.length - 1))}
      </React.Fragment>
    );
  }

  return (
    <div className="waterfall-visualizer">
      {/* 1. Interactive Control & Filter Panel */}
      <div className="waterfall-controls">
        <div className="search-box-wrapper">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search spans by service, operation, or attributes..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="filter-select"
            style={{ width: '100%', paddingLeft: '32px' }}
          />
        </div>
        <div className="filter-tabs">
          <button 
            className={`tab-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All Spans ({spans.length})
          </button>
          <button 
            className={`tab-btn error ${filterType === 'errors' ? 'active' : ''}`}
            onClick={() => setFilterType('errors')}
          >
            Errors ({spans.filter(s => s.status === 'ERROR').length})
          </button>
          <button 
            className={`tab-btn critical-path ${filterType === 'critical' ? 'active' : ''}`}
            onClick={() => setFilterType('critical')}
          >
            Critical Path ({criticalPathSet.size})
          </button>
        </div>
      </div>

      {/* 2. Trace Performance Breakdown segment bar */}
      <div className="performance-breakdown-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
          <span>Trace latency breakdown:</span>
          <span>Duration: {formatDuration(traceDuration)}</span>
        </div>
        <div className="breakdown-segment-bar">
          {breakdown.db > 0 && <div className="bar-segment db" style={{ width: `${breakdown.db}%` }} title={`Database: ${formatDuration(breakdown.dbRaw)} (${breakdown.db.toFixed(1)}%)`} />}
          {breakdown.http > 0 && <div className="bar-segment http" style={{ width: `${breakdown.http}%` }} title={`HTTP: ${formatDuration(breakdown.httpRaw)} (${breakdown.http.toFixed(1)}%)`} />}
          {breakdown.rpc > 0 && <div className="bar-segment rpc" style={{ width: `${breakdown.rpc}%` }} title={`gRPC/RPC: ${formatDuration(breakdown.rpcRaw)} (${breakdown.rpc.toFixed(1)}%)`} />}
          {breakdown.internal > 0 && <div className="bar-segment internal" style={{ width: `${breakdown.internal}%` }} title={`Internal/Code: ${formatDuration(breakdown.internalRaw)} (${breakdown.internal.toFixed(1)}%)`} />}
        </div>
        <div className="breakdown-legend">
          <div className="legend-item"><span className="legend-dot db" /> Database ({breakdown.db.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot http" /> HTTP ({breakdown.http.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot rpc" /> gRPC ({breakdown.rpc.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot internal" /> Internal/Code ({breakdown.internal.toFixed(0)}%)</div>
        </div>
      </div>

      {/* 3. Sticky Time Ruler Grid Header */}
      <div className="waterfall-header-sticky">
        <div className="ruler-label-section">Spans & Hierarchy</div>
        <div className="ruler-grid-section">
          <div className="ruler-tick">0%</div>
          <div className="ruler-tick">25%</div>
          <div className="ruler-tick">50%</div>
          <div className="ruler-tick">75%</div>
          <div className="ruler-tick">100%</div>
        </div>
      </div>

      {/* 4. The main scrollable waterfall view */}
      <div className="waterfall">
        {rootSpans.map((s, idx) => renderSpan(s, 0, idx === rootSpans.length - 1))}
      </div>

      <style>{`
        .waterfall-visualizer {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        
        .waterfall-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: space-between;
          align-items: center;
        }
        
        .search-box-wrapper {
          position: relative;
          flex: 1;
          min-width: 280px;
        }
        
        .search-icon {
          position: absolute;
          left: 10px;
          top: 11px;
          color: var(--text-muted);
          pointer-events: none;
        }
        
        .filter-tabs {
          display: flex;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: 4px;
          border-radius: 8px;
          gap: 4px;
        }
        
        .tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        
        .tab-btn:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }
        
        .tab-btn.active {
          background: var(--accent-indigo);
          color: #ffffff !important;
        }
        
        .tab-btn.error.active {
          background: var(--accent-rose);
        }
        
        .tab-btn.critical-path.active {
          background: var(--accent-amber);
        }
        
        /* Breakdown bar card */
        .performance-breakdown-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          padding: 14px;
        }
        
        .breakdown-segment-bar {
          display: flex;
          height: 10px;
          background: var(--bg-tertiary);
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        
        .bar-segment {
          height: 100%;
          cursor: help;
          transition: opacity 0.15s;
        }
        
        .bar-segment:hover {
          opacity: 0.8;
        }
        
        .bar-segment.db { background: var(--accent-amber); }
        .bar-segment.http { background: var(--accent-cyan); }
        .bar-segment.rpc { background: var(--accent-emerald); }
        .bar-segment.internal { background: var(--accent-indigo); }
        
        .breakdown-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          font-size: 11px;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary);
        }
        
        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .legend-dot.db { background: var(--accent-amber); }
        .legend-dot.http { background: var(--accent-cyan); }
        .legend-dot.rpc { background: var(--accent-emerald); }
        .legend-dot.internal { background: var(--accent-indigo); }
        
        /* Sticky Ruler Header */
        .waterfall-header-sticky {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          align-items: center;
          background: var(--bg-secondary);
          border-bottom: 2px solid var(--border-primary);
          padding: 8px 16px;
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        .ruler-label-section {
          width: 40%;
          min-width: 260px;
          flex-shrink: 0;
        }
        
        .ruler-grid-section {
          flex: 1;
          display: flex;
          justify-content: space-between;
          padding-left: 16px;
          position: relative;
        }
        
        .ruler-tick {
          position: relative;
          color: var(--text-muted);
        }
        
        /* Spans and rows styling */
        .timeline-connector {
          display: inline-block;
          width: 12px;
          margin-right: 4px;
          color: var(--text-muted);
          font-size: 10.5px;
          userSelect: none;
        }
        
        .span-kind-badge {
          flex-shrink: 0;
          font-family: var(--font-sans);
        }
        
        .badge-critical-path {
          font-size: 9px;
          font-weight: bold;
          color: var(--accent-amber);
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.25);
          padding: 1px 6px;
          border-radius: 4px;
          margin-left: 8px;
          flex-shrink: 0;
        }
        
        .expanded-arrow {
          font-size: 10px;
          color: var(--text-muted);
          margin-left: 6px;
          flex-shrink: 0;
        }
        
        .critical-path-row {
          position: relative;
        }
        
        .critical-path-row::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          border-right: 2px solid rgba(245, 158, 11, 0.25);
          pointer-events: none;
        }
        
        /* Drawer layout styling */
        .span-detail-drawer {
          margin-top: -1px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-top: none;
          border-radius: 0 0 8px 8px;
          padding: 14px;
          font-size: 12px;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
          animation: slideDown 0.15s ease-out;
        }
        
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .error-banner {
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: var(--accent-rose);
          border-radius: 6px;
          padding: 10px 14px;
          margin-bottom: 12px;
        }
        
        .error-banner-header {
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
          font-size: 12.5px;
        }
        
        .error-banner-body {
          font-family: var(--font-mono);
          white-space: pre-wrap;
          word-break: break-all;
          font-size: 11.5px;
          line-height: 1.4;
          color: var(--text-primary);
        }
        
        .drawer-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-primary);
          margin-bottom: 12px;
          gap: 4px;
        }
        
        .drawer-tab-btn {
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: color 0.15s, border-bottom-color 0.15s;
        }
        
        .drawer-tab-btn:hover {
          color: var(--text-primary);
        }
        
        .drawer-tab-btn.active {
          color: var(--accent-indigo);
          border-bottom-color: var(--accent-indigo);
        }
        
        .attr-group-header {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          font-weight: bold;
          margin-bottom: 4px;
          margin-top: 8px;
        }
        
        .attr-table {
          width: 100%;
          border-collapse: collapse;
          background: var(--bg-secondary);
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid var(--border-primary);
        }
        
        .attr-table tr {
          border-bottom: 1px solid var(--border-primary);
        }
        
        .attr-table tr:last-child {
          border-bottom: none;
        }
        
        .attr-key {
          padding: 6px 12px;
          font-weight: 600;
          color: var(--accent-indigo-light);
          white-space: nowrap;
          width: 220px;
          background: rgba(99, 102, 241, 0.03);
          border-right: 1px solid var(--border-primary);
        }
        
        .attr-val {
          padding: 6px 12px;
          color: var(--text-primary);
          word-break: break-all;
        }
        
        .event-item {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          padding: 8px 12px;
        }
        
        .event-attrs {
          margin-left: 12px;
          margin-top: 6px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          border-left: 2px solid var(--border-primary);
          padding-left: 8px;
        }

        .code-context-badge {
          display: inline-flex;
          align-items: center;
          font-size: 10px;
          color: var(--accent-indigo-light);
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.15);
          padding: 1px 6px;
          border-radius: 4px;
          font-family: var(--font-mono);
          margin-left: 8px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          user-select: none;
        }
        .code-context-badge:hover {
          background: rgba(99, 102, 241, 0.16);
          border-color: rgba(99, 102, 241, 0.3);
        }
        .stacktrace-container {
          background: var(--bg-secondary);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 8px;
          margin-bottom: 16px;
          overflow: hidden;
        }
        .stacktrace-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          font-weight: 600;
          color: var(--accent-rose);
          background: rgba(244, 63, 94, 0.04);
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          border-bottom: 1px solid var(--border-primary);
        }
        .stacktrace-header:hover {
          background: rgba(244, 63, 94, 0.08);
        }
        .stacktrace-pre {
          margin: 0;
          padding: 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.5;
          overflow-x: auto;
          background: #0f172a;
          color: #e2e8f0;
          max-height: 300px;
        }
        .stack-line {
          white-space: pre;
        }
        .stack-origin {
          background: rgba(244, 63, 94, 0.15);
          border-left: 2px solid var(--accent-rose);
          padding-left: 4px;
        }
        .stack-file {
          color: #38bdf8;
          text-decoration: underline;
          cursor: pointer;
          font-weight: 500;
        }
        .stack-file:hover {
          color: #7dd3fc;
        }
        .mini-timeline-container {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 16px;
        }
        .mini-timeline-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .mini-timeline-bar-wrapper {
          position: relative;
          height: 8px;
          margin: 16px 8px 8px 8px;
        }
        .mini-timeline-bar {
          position: absolute;
          left: 0;
          right: 0;
          top: 2px;
          height: 4px;
          background: var(--bg-tertiary);
          border-radius: 2px;
        }
        .mini-timeline-dot {
          position: absolute;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent-indigo);
          transform: translate(-50%, -1px);
          cursor: pointer;
          transition: transform 0.15s;
          box-shadow: 0 0 0 2px var(--bg-secondary);
        }
        .mini-timeline-dot:hover {
          transform: translate(-50%, -1px) scale(1.3);
          z-index: 10;
        }
        .mini-timeline-dot.error-dot {
          background: var(--accent-rose);
        }
        .mini-timeline-tooltip {
          visibility: hidden;
          position: absolute;
          bottom: 120%;
          left: 50%;
          transform: translateX(-50%);
          background: #0f172a;
          color: #ffffff;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 10px;
          white-space: nowrap;
          z-index: 20;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
          pointer-events: none;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .mini-timeline-dot:hover .mini-timeline-tooltip {
          visibility: visible;
        }
        .tooltip-name {
          font-weight: 600;
        }
        .tooltip-time {
          color: #94a3b8;
          font-family: var(--font-mono);
        }
        .mini-timeline-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          margin-top: 6px;
        }
      `}</style>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
