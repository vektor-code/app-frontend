import React from 'react';
import type { Span } from '../api/client';

interface SpanTimelineProps {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
}

export default function SpanTimeline({ spans, traceStartTime, traceDuration }: SpanTimelineProps) {
  if (!spans || spans.length === 0) {
    return <div className="empty-state"><div className="empty-state-title">No spans</div></div>;
  }

  // Build tree structure
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

  function renderSpan(span: Span, depth: number): React.ReactNode {
    const start = new Date(span.startTime).getTime();
    const offsetPercent = traceDuration > 0 ? ((start - traceStartTime) / traceDuration) * 100 : 0;
    const widthPercent = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 100;
    const children = getChildren(span.spanId);

    const barClass = span.status === 'ERROR' ? 'error' : span.kind === 'CLIENT' ? 'client' : 'ok';

    return (
      <React.Fragment key={span.spanId}>
        <div className="waterfall-row animate-slide-in" style={{ animationDelay: `${depth * 30}ms`, paddingLeft: `${depth * 16}px` }}>
          <div className="waterfall-label">
            <div className="waterfall-svc">
              {span.status === 'ERROR' && <span style={{ color: 'var(--accent-rose)' }}>● </span>}
              {span.serviceName}
            </div>
            <div className="waterfall-name" title={span.name}>{span.name}</div>
          </div>
          <div className="waterfall-bar-container">
            <div
              className={`waterfall-bar ${barClass}`}
              style={{ left: `${Math.max(0, offsetPercent)}%`, width: `${Math.max(0.5, widthPercent)}%` }}
              title={`${span.durationMs.toFixed(2)}ms`}
            />
          </div>
          <div className="waterfall-duration">{formatDuration(span.durationMs)}</div>
        </div>
        {children.map(child => renderSpan(child, depth + 1))}
      </React.Fragment>
    );
  }

  return (
    <div className="waterfall">
      {rootSpans.map(s => renderSpan(s, 0))}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
