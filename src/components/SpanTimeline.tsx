import React, { useState } from 'react';
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

const IMPORTANT_ATTRS = [
  'http.method', 'http.url', 'http.route', 'http.status_code', 'http.target',
  'db.system', 'db.statement', 'db.name',
  'rpc.method', 'rpc.service', 'rpc.system',
  'net.peer.name', 'net.peer.port',
  'messaging.system', 'messaging.destination',
  'component',
];

export default function SpanTimeline({ spans, traceStartTime, traceDuration }: SpanTimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!spans || spans.length === 0) {
    return <div className="empty-state"><div className="empty-state-title">No spans</div></div>;
  }

  const spanMap = new Map<string, Span>();
  const rootSpans: Span[] = [];
  spans.forEach(s => spanMap.set(s.spanId, s));
  spans.forEach(s => {
    if (!s.parentSpanId || !spanMap.has(s.parentSpanId)) {
      rootSpans.push(s);
    }
  });

  function getChildren(parentId: string): Span[] {
    return spans.filter(s => s.parentSpanId === parentId);
  }

  function toggle(spanId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  function renderSpan(span: Span, depth: number, isLast: boolean): React.ReactNode {
    const start = new Date(span.startTime).getTime();
    const offsetPercent = traceDuration > 0 ? ((start - traceStartTime) / traceDuration) * 100 : 0;
    const widthPercent = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 100;
    const children = getChildren(span.spanId);
    const isExpanded = expanded.has(span.spanId);
    const isError = span.status === 'ERROR';
    const kindInfo = KIND_LABELS[span.kind] || KIND_LABELS.INTERNAL;
    const color = svcColor(span.serviceName);

    const attrs = span.attributes || {};
    const importantAttrs = IMPORTANT_ATTRS
      .filter(k => attrs[k])
      .map(k => ({ key: k, value: attrs[k] }));
    const otherAttrs = Object.entries(attrs)
      .filter(([k]) => !IMPORTANT_ATTRS.includes(k))
      .map(([k, v]) => ({ key: k, value: v }));

    return (
      <React.Fragment key={span.spanId}>
        <div
          className="waterfall-row animate-slide-in"
          style={{
            animationDelay: `${depth * 20}ms`,
            cursor: 'pointer',
            borderLeft: isError ? '3px solid #f43f5e' : '3px solid transparent',
          }}
          onClick={() => toggle(span.spanId)}
        >
          {/* Service + Operation Label */}
          <div className="waterfall-label" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
            {/* Tree connector */}
            {depth > 0 && (
              <span style={{
                display: 'inline-block',
                width: '12px',
                marginRight: '4px',
                color: 'var(--text-muted)',
                fontSize: '10px',
                userSelect: 'none',
              }}>
                {isLast ? '└' : '├'}
              </span>
            )}
            {/* Service color dot */}
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
              {isError && <span style={{ color: '#f43f5e', marginRight: '3px' }}>●</span>}
              {span.serviceName}
            </div>
            {/* Kind badge */}
            <span style={{
              fontSize: '9px',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: '3px',
              background: kindInfo.color + '18',
              color: kindInfo.color,
              marginLeft: '6px',
              flexShrink: 0,
            }}>
              {kindInfo.label}
            </span>
            <div className="waterfall-name" title={span.name} style={{ marginLeft: '6px' }}>
              {span.name}
            </div>
            {/* Expand indicator */}
            {(importantAttrs.length > 0 || otherAttrs.length > 0 || span.error) && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                {isExpanded ? '▾' : '▸'}
              </span>
            )}
          </div>

          {/* Duration Bar */}
          <div className="waterfall-bar-container">
            <div
              className={`waterfall-bar ${isError ? 'error' : span.kind === 'CLIENT' ? 'client' : 'ok'}`}
              style={{
                left: `${Math.max(0, offsetPercent)}%`,
                width: `${Math.max(0.5, widthPercent)}%`,
                background: isError ? '#f43f5e' : color,
                opacity: 0.85,
              }}
              title={`${span.durationMs.toFixed(2)}ms`}
            />
          </div>
          <div className="waterfall-duration">{formatDuration(span.durationMs)}</div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div style={{
            marginLeft: `${depth * 20 + 28}px`,
            marginBottom: '8px',
            padding: '10px 14px',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            border: '1px solid var(--border-primary)',
            fontSize: '12px',
            animation: 'fadeIn 0.15s ease',
          }}>
            {/* Error message */}
            {span.error && (
              <div style={{
                padding: '6px 10px',
                marginBottom: '8px',
                borderRadius: '4px',
                background: 'rgba(244, 63, 94, 0.1)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                color: '#f43f5e',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
              }}>
                ✕ {span.error}
              </div>
            )}

            {/* Metadata row */}
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: importantAttrs.length > 0 ? '10px' : 0 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Span ID: </span><span className="mono">{span.spanId}</span></div>
              {span.parentSpanId && <div><span style={{ color: 'var(--text-muted)' }}>Parent: </span><span className="mono">{span.parentSpanId}</span></div>}
              {span.podName && <div><span style={{ color: 'var(--text-muted)' }}>Pod: </span>{span.podName}</div>}
              <div><span style={{ color: 'var(--text-muted)' }}>Kind: </span>{span.kind}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Status: </span>
                <span style={{ color: isError ? '#f43f5e' : '#10b981' }}>{span.status}</span>
              </div>
            </div>

            {/* Important attributes */}
            {importantAttrs.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {importantAttrs.map(a => (
                    <tr key={a.key} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                      <td style={{ padding: '4px 8px 4px 0', color: '#818cf8', fontWeight: 600, whiteSpace: 'nowrap', width: '160px' }}>{a.key}</td>
                      <td style={{ padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: '11px', wordBreak: 'break-all' }}>{a.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Other attributes */}
            {otherAttrs.length > 0 && (
              <details style={{ marginTop: '6px' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px' }}>
                  {otherAttrs.length} more attributes
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
                  <tbody>
                    {otherAttrs.map(a => (
                      <tr key={a.key} style={{ borderBottom: '1px solid var(--border-primary)' }}>
                        <td style={{ padding: '3px 8px 3px 0', color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap', width: '160px' }}>{a.key}</td>
                        <td style={{ padding: '3px 0', fontFamily: 'var(--font-mono)', fontSize: '11px', wordBreak: 'break-all' }}>{a.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {/* Span Events */}
            {span.events && span.events.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>Events</div>
                {span.events.map((ev, i) => (
                  <div key={i} style={{ padding: '3px 0', fontSize: '11px', borderBottom: '1px solid var(--border-primary)' }}>
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{ev.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {children.map((child, idx) => renderSpan(child, depth + 1, idx === children.length - 1))}
      </React.Fragment>
    );
  }

  return (
    <div className="waterfall">
      {rootSpans.map((s, idx) => renderSpan(s, 0, idx === rootSpans.length - 1))}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
