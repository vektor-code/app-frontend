import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Trace, type Span, type DiagnosticReport } from '../api/client';
import SpanTimeline from '../components/SpanTimeline';

const SERVICE_COLORS: Record<string, string> = {};
const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

function getSvcColor(name: string): string {
  if (!SERVICE_COLORS[name]) {
    SERVICE_COLORS[name] = PALETTE[Object.keys(SERVICE_COLORS).length % PALETTE.length];
  }
  return SERVICE_COLORS[name];
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

interface SpanNode {
  span: Span;
  depth: number;
  children: SpanNode[];
}

function buildSpanTree(spans: Span[]): { rootNodes: SpanNode[]; maxDepth: number } {
  const spanMap = new Map<string, SpanNode>();
  spans.forEach(s => {
    spanMap.set(s.spanId, { span: s, depth: 0, children: [] });
  });

  const rootNodes: SpanNode[] = [];
  let maxDepth = 0;

  spans.forEach(s => {
    const node = spanMap.get(s.spanId)!;
    if (s.parentSpanId && spanMap.has(s.parentSpanId)) {
      const parent = spanMap.get(s.parentSpanId)!;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  function traverse(node: SpanNode, currentDepth: number) {
    node.depth = currentDepth;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
    node.children.sort((a, b) => new Date(a.span.startTime).getTime() - new Date(b.span.startTime).getTime());
    node.children.forEach(child => traverse(child, currentDepth + 1));
  }

  rootNodes.forEach(rn => traverse(rn, 0));
  return { rootNodes, maxDepth };
}

interface FlameGraphProps {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
  onSelectSpan: (span: Span) => void;
}

function FlameGraph({ spans, traceStartTime, traceDuration, onSelectSpan }: FlameGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<{ span: Span; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [forceUpdate, setForceUpdate] = useState(0);

  const { rootNodes, maxDepth } = useMemo(() => buildSpanTree(spans), [spans]);

  const barHeight = 24;
  const barGap = 4;
  const paddingTop = 24;
  const computedHeight = (maxDepth + 1) * (barHeight + barGap) + paddingTop + 10;

  const renderList = useMemo(() => {
    const list: { span: Span; depth: number; left: number; width: number }[] = [];
    function traverse(node: SpanNode) {
      const start = new Date(node.span.startTime).getTime();
      const left = traceDuration > 0 ? (start - traceStartTime) / traceDuration : 0;
      const width = traceDuration > 0 ? node.span.durationMs / traceDuration : 1;
      list.push({
        span: node.span,
        depth: node.depth,
        left,
        width
      });
      node.children.forEach(traverse);
    }
    rootNodes.forEach(traverse);
    return list;
  }, [rootNodes, traceStartTime, traceDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = computedHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, computedHeight);

    // Grid lines
    ctx.strokeStyle = document.body.classList.contains('dark-theme') ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = document.body.classList.contains('dark-theme') ? '#94a3b8' : '#64748b';
    ctx.font = '10px Inter';
    ctx.textAlign = 'center';

    for (let i = 0; i <= 4; i++) {
      const pct = i * 0.25;
      const x = pct * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, computedHeight);
      ctx.stroke();

      const timeVal = pct * traceDuration;
      ctx.fillText(formatDuration(timeVal), x, paddingTop - 8);
    }

    renderList.forEach(item => {
      const rx = item.left * rect.width;
      const rw = Math.max(2, item.width * rect.width);
      const ry = paddingTop + item.depth * (barHeight + barGap);

      const isHovered = hoveredSpan?.span.spanId === item.span.spanId;
      const color = getSvcColor(item.span.serviceName);

      ctx.fillStyle = color;
      ctx.fillRect(rx, ry, rw, barHeight);

      if (isHovered) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, barHeight - 2);
      } else if (item.span.status === 'ERROR') {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, barHeight - 2);
      }

      if (rw > 35) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10.5px Inter';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const labelText = `${item.span.serviceName} - ${item.span.name}`;
        const fitsLabel = ctx.measureText(labelText).width < rw - 12;
        const dispText = fitsLabel ? labelText : item.span.name;
        
        ctx.fillText(dispText, rx + 6, ry + barHeight / 2, rw - 12);
      }
    });
  }, [renderList, hoveredSpan, computedHeight, traceDuration, forceUpdate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setForceUpdate(p => p + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setMousePos({ x: e.clientX, y: e.clientY });

    let found: typeof hoveredSpan = null;
    for (const item of renderList) {
      const rx = item.left * rect.width;
      const rw = Math.max(2, item.width * rect.width);
      const ry = paddingTop + item.depth * (barHeight + barGap);

      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + barHeight) {
        found = { span: item.span, rect: { x: rx + rect.left, y: ry + rect.top, w: rw, h: barHeight } };
        break;
      }
    }
    setHoveredSpan(found);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', display: 'block', cursor: hoveredSpan ? 'pointer' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSpan(null)}
        onClick={() => hoveredSpan && onSelectSpan(hoveredSpan.span)}
      />
      {hoveredSpan && (
        <div
          className="flamegraph-tooltip"
          style={{
            position: 'fixed',
            left: `${mousePos.x + 12}px`,
            top: `${mousePos.y + 12}px`,
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '11px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            pointerEvents: 'none',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <div style={{ fontWeight: 700, color: getSvcColor(hoveredSpan.span.serviceName), display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: getSvcColor(hoveredSpan.span.serviceName) }} />
            {hoveredSpan.span.serviceName}
          </div>
          <div style={{ fontWeight: 600, fontSize: '11.5px' }}>{hoveredSpan.span.name}</div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4px', paddingTop: '4px', color: '#cbd5e1', fontFamily: 'var(--font-mono)' }}>
            Duration: {formatDuration(hoveredSpan.span.durationMs)} ({(hoveredSpan.span.durationMs / traceDuration * 100).toFixed(1)}%)
          </div>
        </div>
      )}
    </div>
  );
}

export default function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [viewMode, setViewMode] = useState<'waterfall' | 'flame'>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    
    api.getTrace(traceId)
      .then((traceData) => {
        setTrace(traceData);
        setSelectedSpan(null);
      })
      .catch(() => {
        setTrace(null);
      })
      .finally(() => setLoading(false));

    setLoadingDiagnostics(true);
    api.getTraceDiagnostics(traceId)
      .then((data) => {
        setDiagnostics(data);
      })
      .catch(() => {
        setDiagnostics(null);
      })
      .finally(() => setLoadingDiagnostics(false));
  }, [traceId]);

  const uniqueTags = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const map = new Map<string, string>();
    trace.spans.forEach(s => {
      if (s.attributes) {
        Object.entries(s.attributes).forEach(([k, v]) => {
          if (
            k.startsWith('http.') || 
            k.startsWith('db.system') || 
            k.startsWith('rpc.system') || 
            k.startsWith('rpc.method') || 
            k.startsWith('messaging.') || 
            k.startsWith('exception.type')
          ) {
            map.set(k, String(v));
          }
        });
      }
    });
    return Array.from(map.entries());
  }, [trace]);

  if (loading) return <div className="empty-state"><div className="empty-state-title">Loading trace...</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-icon">❌</div><div className="empty-state-title">Trace not found</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="animate-fade-in trace-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Trace Detail</h1>
      </div>

      {/* Metadata Overview Panel */}
      <div className="trace-meta">
        <div className="trace-meta-item">
          <span className="trace-meta-label">Trace ID</span>
          <span className="trace-meta-value mono" style={{ color: 'var(--accent-indigo-light)' }}>{trace.traceId}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Root Service</span>
          <span className="trace-meta-value" style={{ fontWeight: 600 }}>{trace.serviceName}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Namespace</span>
          <span className="trace-meta-value"><span className="badge badge-ns">{trace.namespace}</span></span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Duration</span>
          <span className="trace-meta-value" style={{ color: 'var(--accent-cyan)' }}>{trace.durationMs.toFixed(2)}ms</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Spans</span>
          <span className="trace-meta-value">{trace.spanCount}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Status</span>
          <span className={`badge ${trace.hasError ? 'badge-error' : 'badge-ok'}`} style={{ marginTop: '2px' }}>
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
        </div>
      </div>

      {/* Metadata Tags Row */}
      {uniqueTags.length > 0 && (
        <div className="tags-container">
          <div className="tags-title">Trace Metadata Tags ({uniqueTags.length})</div>
          <div className="tags-list">
            {uniqueTags.map(([k, v]) => (
              <div key={k} className="tag-pill" title={`${k}: ${v}`}>
                <span className="tag-key">{k}</span>
                <span className="tag-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Davis AI Diagnostics Card */}
      {!loadingDiagnostics && diagnostics && (
        <div className="card diagnostics-card">
          <div 
            className="card-header diagnostics-header"
            onClick={() => setDiagnosticsCollapsed(!diagnosticsCollapsed)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="ai-sparkle">✨</div>
              <div className="card-title" style={{ color: 'var(--accent-amber)' }}>Davis AI Trace Diagnostics</div>
            </div>
            <span className="text-sm text-muted">{diagnosticsCollapsed ? 'Expand Details ▸' : 'Collapse ▾'}</span>
          </div>
          {!diagnosticsCollapsed && (
            <div className="card-body" style={{ animation: 'slideDown 0.15s ease-out' }}>
              <div className="diagnostics-summary">
                {diagnostics.summary}
              </div>

              <div className="diagnostics-stats-grid">
                {diagnostics.rootCauseService && (
                  <div className="diagnostics-stat-card border-rose">
                    <div className="stat-card-title">Suspected Root Cause</div>
                    <div className="stat-card-value">{diagnostics.rootCauseService}</div>
                    {diagnostics.rootCauseMessage && (
                      <div className="stat-card-desc" style={{ color: 'var(--accent-rose)' }}>{diagnostics.rootCauseMessage}</div>
                    )}
                  </div>
                )}
                {diagnostics.bottleneckService && (
                  <div className="diagnostics-stat-card border-amber">
                    <div className="stat-card-title">Performance Bottleneck</div>
                    <div className="stat-card-value">{diagnostics.bottleneckService}</div>
                    <div className="stat-card-desc">
                      Consumes <span style={{ color: 'var(--accent-amber)', fontWeight: 'bold' }}>{diagnostics.bottleneckPercent.toFixed(1)}%</span> of total duration ({formatDuration(diagnostics.bottleneckDurationMs)})
                    </div>
                  </div>
                )}
              </div>

              {diagnostics.issues && diagnostics.issues.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div className="section-subtitle">Identified Performance Issues</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {diagnostics.issues.map((issue, idx) => (
                      <div key={idx} className="diagnostics-issue-item">
                        <span className="warning-dot">⚠️</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diagnostics.remediations && diagnostics.remediations.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div className="section-subtitle">Recommended Actions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {diagnostics.remediations.map((rem, idx) => (
                      <div key={idx} className="diagnostics-remediation-item">
                        <span className="success-check">✓</span>
                        <span>{rem}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main Visualization Card */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div className="card-title">Trace Visualization</div>
            <span className="text-sm text-muted">{trace.spanCount} spans total</span>
          </div>

          <div className="view-toggle-buttons">
            <button
              className={`view-toggle-btn ${viewMode === 'waterfall' ? 'active' : ''}`}
              onClick={() => setViewMode('waterfall')}
            >
              Waterfall View
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'flame' ? 'active' : ''}`}
              onClick={() => setViewMode('flame')}
            >
              Flame Graph
            </button>
          </div>
        </div>
        
        <div className="card-body">
          {viewMode === 'waterfall' ? (
            <SpanTimeline
              spans={trace.spans || []}
              traceStartTime={startMs}
              traceDuration={trace.durationMs}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <FlameGraph
                spans={trace.spans || []}
                traceStartTime={startMs}
                traceDuration={trace.durationMs}
                onSelectSpan={(span) => setSelectedSpan(span)}
              />
              
              {/* Flamegraph Selected Span Details */}
              {selectedSpan ? (
                <div className="selected-span-details-panel">
                  <div className="panel-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: getSvcColor(selectedSpan.serviceName) }} />
                      <span className="panel-service">{selectedSpan.serviceName}</span>
                      <span className="panel-span-name">/ {selectedSpan.name}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => setSelectedSpan(null)}>Dismiss</button>
                  </div>
                  <div className="panel-body">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <span className="panel-label">Duration</span>
                        <span className="panel-value color-cyan">{formatDuration(selectedSpan.durationMs)}</span>
                      </div>
                      <div>
                        <span className="panel-label">Start Time</span>
                        <span className="panel-value">{new Date(selectedSpan.startTime).toLocaleTimeString()}</span>
                      </div>
                      <div>
                        <span className="panel-label">Status</span>
                        <span className={`badge ${selectedSpan.status === 'ERROR' ? 'badge-error' : 'badge-ok'}`}>{selectedSpan.status}</span>
                      </div>
                    </div>
                    
                    {selectedSpan.attributes && Object.keys(selectedSpan.attributes).length > 0 && (
                      <div>
                        <span className="panel-label" style={{ marginBottom: '6px', display: 'block' }}>Key Attributes</span>
                        <table className="attr-table">
                          <tbody>
                            {Object.entries(selectedSpan.attributes).map(([k, v]) => (
                              <tr key={k}>
                                <td className="attr-key" style={{ width: '150px' }}>{k}</td>
                                <td className="attr-val">{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="selected-span-placeholder">
                  Click a span bar in the flame graph above to view its execution details and full telemetry attributes.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .trace-detail {
          max-width: 1400px;
          margin: 0 auto;
        }

        .tags-container {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 20px;
        }
        
        .tags-title {
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          margin-bottom: 8px;
        }
        
        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        
        .tag-pill {
          display: inline-flex;
          align-items: center;
          font-size: 10.5px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 6px;
          overflow: hidden;
          font-family: var(--font-mono);
        }
        
        .tag-key {
          padding: 2px 6px;
          background: rgba(99, 102, 241, 0.05);
          color: var(--accent-indigo-light);
          border-right: 1px solid var(--border-primary);
          font-weight: 500;
        }
        
        .tag-val {
          padding: 2px 6px;
          color: var(--text-primary);
          max-width: 250px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Diagnostics Card */
        .diagnostics-card {
          border-color: rgba(245, 158, 11, 0.2) !important;
          background: linear-gradient(180deg, rgba(245, 158, 11, 0.03) 0%, rgba(245, 158, 11, 0) 100%) !important;
        }
        
        .diagnostics-header {
          border-bottom: 1px solid rgba(245, 158, 11, 0.1) !important;
        }
        
        .ai-sparkle {
          font-size: 16px;
          animation: pulseSparkle 2s infinite ease-in-out;
        }
        
        @keyframes pulseSparkle {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.2); opacity: 1; filter: drop-shadow(0 0 4px var(--accent-amber)); }
        }
        
        .diagnostics-summary {
          font-size: 13.5px;
          line-height: 1.6;
          color: var(--text-primary);
          margin-bottom: 16px;
          padding-left: 12px;
          border-left: 3px solid var(--accent-amber);
        }
        
        .diagnostics-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        
        .diagnostics-stat-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 12px;
        }
        
        .diagnostics-stat-card.border-rose {
          border-left: 4px solid var(--accent-rose);
        }
        
        .diagnostics-stat-card.border-amber {
          border-left: 4px solid var(--accent-amber);
        }
        
        .stat-card-title {
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        
        .stat-card-value {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }
        
        .stat-card-desc {
          font-size: 11.5px;
          color: var(--text-secondary);
          margin-top: 4px;
        }
        
        .section-subtitle {
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
          color: var(--text-tertiary);
          margin-bottom: 8px;
          letter-spacing: 0.05em;
        }
        
        .diagnostics-issue-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12.5px;
          background: rgba(244, 63, 94, 0.03);
          border: 1px solid rgba(244, 63, 94, 0.1);
          border-radius: 6px;
          padding: 8px 12px;
        }
        
        .warning-dot {
          color: var(--accent-rose);
          flex-shrink: 0;
        }
        
        .diagnostics-reremediation-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12.5px;
        }
        
        .diagnostics-remediation-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12.5px;
          background: rgba(16, 185, 129, 0.03);
          border: 1px solid rgba(16, 185, 129, 0.1);
          border-radius: 6px;
          padding: 8px 12px;
        }
        
        .success-check {
          color: var(--accent-emerald);
          font-weight: bold;
          flex-shrink: 0;
        }

        /* View Toggle Buttons */
        .view-toggle-buttons {
          display: flex;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          padding: 4px;
          border-radius: 8px;
          gap: 4px;
        }
        
        .view-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border-radius: 6px;
          transition: background 0.15s, color 0.15s;
        }
        
        .view-toggle-btn:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }
        
        .view-toggle-btn.active {
          background: var(--accent-indigo);
          color: #ffffff !important;
        }

        /* Flamegraph details panel */
        .selected-span-details-panel {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          animation: slideDown 0.15s ease-out;
        }
        
        .selected-span-placeholder {
          text-align: center;
          padding: 24px;
          color: var(--text-muted);
          font-size: 12px;
          border: 1px dashed var(--border-primary);
          border-radius: 8px;
          background: var(--bg-secondary);
        }
        
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-primary);
        }
        
        .panel-service {
          font-weight: 700;
          color: var(--text-primary);
          font-size: 12.5px;
        }
        
        .panel-span-name {
          color: var(--text-secondary);
          font-size: 12.5px;
          font-weight: 500;
        }
        
        .panel-body {
          padding: 14px;
        }
        
        .panel-label {
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        
        .panel-value {
          font-size: 14px;
          font-weight: 600;
          display: block;
          margin-top: 2px;
        }
        
        .panel-value.color-cyan {
          color: var(--accent-cyan);
        }

        /* Reusable table helpers matching SpanTimeline style */
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
          background: rgba(99, 102, 241, 0.03);
          border-right: 1px solid var(--border-primary);
        }
        .attr-val {
          padding: 6px 12px;
          color: var(--text-primary);
          word-break: break-all;
          font-family: var(--font-mono);
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
