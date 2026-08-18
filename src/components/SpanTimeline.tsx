import React, { useMemo, useState } from 'react';
import type { Span } from '../entities';
import { isSpanError } from '../utils/spanStatus';
import { isValidHttpStatus, normalizeHttpMethod, readHttpStatus } from '../utils/httpTelemetry';
import { getSpanDependency, isDatabaseSpan, getQueryText, getQuerySummary } from '../utils/dependency';
import { buildSpanForest } from '../utils/spanTree';

export interface DestinationInfo {
  type: 'infra' | '3rdparty' | 'service' | null;
  name: string;
}

export function getSpanDestination(span: Span): DestinationInfo {
  const attrs = span.attributes || {};
  
  // 1. Data stores, caches and other classified infrastructure. The system was
  //    identified once at ingest; this only formats it.
  const dep = getSpanDependency(attrs);
  if (dep.kind === 'database' || dep.kind === 'cache') {
    const dbName = attrs['db.name'];
    const name = dbName ? `${dep.system} (${dbName})` : dep.system;
    return { type: 'infra', name };
  }
  
  // 2. Messaging infrastructure
  if (attrs['messaging.system']) {
    const msgSys = attrs['messaging.system'];
    const dest = attrs['messaging.destination'] || attrs['messaging.destination.name'] || attrs['messaging.destination_name'] || attrs['messaging.dest'];
    const name = dest ? `${msgSys} (${dest})` : msgSys;
    return { type: 'infra', name };
  }

  // 3. DNS Lookup
  if (span.name?.toLowerCase().includes('dns') || attrs['dns.question.name'] || attrs['dns.question']) {
    const query = attrs['dns.question.name'] || attrs['dns.question'] || attrs['net.peer.name'] || attrs['server.address'];
    const name = query ? `dns (${query})` : 'dns';
    return { type: 'infra', name };
  }
  
  // 4. External 3rd party tool calls
  if (attrs['external.service']) {
    return { type: '3rdparty', name: attrs['external.service'] };
  }
  
  // 5. Internal microservice call (fallback check)
  if (attrs['peer.service']) {
    return { type: 'service', name: attrs['peer.service'] };
  }
  
  // 6. Backup client-side check for 3rd-party keywords
  if (span.kind === 'CLIENT') {
    const nameLower = span.name?.toLowerCase() || '';
    const url = (attrs['http.url'] || '').toLowerCase();
    const host = (attrs['server.address'] || attrs['net.peer.name'] || attrs['http.host'] || '').toLowerCase();
    
    if (nameLower.includes('mygov') || url.includes('mygov') || host.includes('mygov')) {
      return { type: '3rdparty', name: 'MyGov' };
    }
    if (nameLower.includes('stripe') || url.includes('stripe') || host.includes('stripe')) {
      return { type: '3rdparty', name: 'Stripe' };
    }
    if (nameLower.includes('paypal') || url.includes('paypal') || host.includes('paypal')) {
      return { type: '3rdparty', name: 'PayPal' };
    }
    if (nameLower.includes('openai') || url.includes('openai') || host.includes('openai')) {
      return { type: '3rdparty', name: 'OpenAI' };
    }
    if (nameLower.includes('twilio') || url.includes('twilio') || host.includes('twilio')) {
      return { type: '3rdparty', name: 'Twilio' };
    }
    if (nameLower.includes('github') || url.includes('github') || host.includes('github')) {
      return { type: '3rdparty', name: 'GitHub' };
    }
    if (nameLower.includes('slack') || url.includes('slack') || host.includes('slack')) {
      return { type: '3rdparty', name: 'Slack' };
    }
    if (nameLower.includes('discord') || url.includes('discord') || host.includes('discord')) {
      return { type: '3rdparty', name: 'Discord' };
    }
  }
  
  return { type: null, name: '' };
}

export function getSpanInlineSummary(span: Span): string | null {
  const attrs = span.attributes || {};
  
  // 1. HTTP calls
  const httpMethod = normalizeHttpMethod(attrs['http.request.method'] || attrs['http.method']);
  if (httpMethod) {
    const status = readHttpStatus(attrs);
    if (status.present && isValidHttpStatus(status.code)) {
      return `${httpMethod} (${status.code})`;
    }
    return `${httpMethod}`;
  }
  
  // 2. Database calls
  if (isDatabaseSpan(attrs)) {
    const statement = getQueryText(attrs);
    if (statement) {
      // Truncate to keep the row readable; literals are already redacted.
      return statement.length > 40 ? `${statement.slice(0, 40)}...` : statement;
    }
    return getQuerySummary(attrs) || getSpanDependency(attrs).system;
  }
  
  // 3. RPC calls
  if (attrs['rpc.method']) {
    return `rpc: ${attrs['rpc.method']}`;
  }

  // 4. Messaging
  if (attrs['messaging.operation']) {
    return `msg: ${attrs['messaging.operation']}`;
  }

  return null;
}

interface SpanTimelineProps {
  spans: Span[];
  traceStartTime: number;
  traceDuration: number;
  onSelectSpan?: (span: Span) => void;
  selectedSpanId?: string;
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

const LABEL_COL = 'minmax(280px, 36%)';
const DURATION_COL = '72px';

function calculateCriticalPath(spans: Span[]): Set<string> {
  const critical = new Set<string>();
  if (spans.length === 0) return critical;
  const forest = buildSpanForest(spans);
  if (forest.roots.length === 0) return critical;
  const roots = [...forest.roots].sort((a, b) => b.durationMs - a.durationMs);
  let current: Span | undefined = roots[0];

  while (current) {
    critical.add(current.spanId);
    const children = forest.childrenOf(current.spanId);
    if (children.length === 0) break;
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

function spanMatchesQuery(span: Span, term: string): boolean {
  if (!term) return true;
  if (span.name.toLowerCase().includes(term) || span.serviceName.toLowerCase().includes(term)) return true;
  return Object.values(span.attributes || {}).some(v => String(v).toLowerCase().includes(term));
}

function isInternalOrDbSpan(span: Span): boolean {
  return span.kind === 'INTERNAL' || isDatabaseSpan(span.attributes || {});
}

function summaryDuplicatesName(spanName: string, summary: string): boolean {
  const name = spanName.toLowerCase().replace(/\s+/g, ' ');
  const snippet = summary.toLowerCase().replace(/\s+/g, ' ').slice(0, 18);
  return snippet.length >= 8 && name.includes(snippet);
}

function clampBar(offsetPercent: number, widthPercent: number): { left: number; width: number } {
  const left = Math.max(0, Math.min(100, offsetPercent));
  const width = Math.max(0, Math.min(100 - left, widthPercent));
  return { left, width };
}

function siblingFlagsForChild(parentFlags: boolean[], childIdx: number, childCount: number): boolean[] {
  return [...parentFlags, childIdx < childCount - 1];
}

function flattenFlags(parentFlags: boolean[], childIdx: number, childCount: number): boolean[] {
  const own = childIdx < childCount - 1;
  if (parentFlags.length === 0) return [];
  return [...parentFlags.slice(0, -1), own];
}

function TreeGuides({ depth, hasMoreSiblingsAtDepth }: { depth: number; hasMoreSiblingsAtDepth: boolean[] }) {
  if (depth === 0) return null;
  return (
    <div className="waterfall-guides" aria-hidden="true">
      {Array.from({ length: depth }, (_, i) => {
        const isLast = i === depth - 1;
        const hasMore = hasMoreSiblingsAtDepth[i];
        const classes = [
          'waterfall-guide',
          isLast ? 'is-elbow' : '',
          hasMore ? 'has-more' : '',
          !isLast && hasMore ? 'is-rail' : '',
        ].filter(Boolean).join(' ');
        return <span key={i} className={classes} />;
      })}
    </div>
  );
}

export default function SpanTimeline({ spans, traceStartTime, traceDuration, onSelectSpan, selectedSpanId }: SpanTimelineProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'critical'>('all');
  const [hideInternalDb, setHideInternalDb] = useState(false);

  const criticalPathSet = useMemo(() => calculateCriticalPath(spans), [spans]);
  const forest = useMemo(() => buildSpanForest(spans), [spans]);

  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const countFn = (spanId: string): number => {
      if (counts.has(spanId)) return counts.get(spanId)!;
      const direct = forest.childrenOf(spanId);
      let total = direct.length;
      direct.forEach(child => {
        total += countFn(child.spanId);
      });
      counts.set(spanId, total);
      return total;
    };
    spans.forEach(s => countFn(s.spanId));
    return counts;
  }, [spans, forest]);

  const exclusiveMsById = useMemo(() => {
    const map = new Map<string, number>();
    spans.forEach(span => {
      const childTotal = forest.childrenOf(span.spanId).reduce((sum, child) => sum + child.durationMs, 0);
      map.set(span.spanId, Math.max(0, span.durationMs - childTotal));
    });
    return map;
  }, [spans, forest]);

  const breakdown = useMemo(() => {
    let dbTime = 0;
    let httpTime = 0;
    let rpcTime = 0;
    let internalTime = 0;

    spans.forEach(s => {
      const a = s.attributes || {};
      if (isDatabaseSpan(a)) {
        dbTime += s.durationMs;
      } else if (a['http.url'] || a['http.method'] || a['http.request.method']) {
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

  const errorCount = useMemo(() => spans.filter(isSpanError).length, [spans]);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const isFiltering = filterType !== 'all' || normalizedSearch.length > 0;

  const matchSet = useMemo(() => {
    const ids = new Set<string>();
    spans.forEach(span => {
      const isError = isSpanError(span);
      const isCritical = criticalPathSet.has(span.spanId);
      if (filterType === 'errors' && !isError) return;
      if (filterType === 'critical' && !isCritical) return;
      if (!spanMatchesQuery(span, normalizedSearch)) return;
      ids.add(span.spanId);
    });
    return ids;
  }, [spans, filterType, normalizedSearch, criticalPathSet]);

  const keepSet = useMemo(() => {
    if (!isFiltering) return null;
    const keep = new Set(matchSet);
    matchSet.forEach(id => {
      let current = forest.getById(id);
      const seen = new Set<string>();
      while (current?.parentSpanId) {
        const parent = forest.getById(current.parentSpanId);
        if (!parent || seen.has(parent.spanId)) break;
        keep.add(parent.spanId);
        seen.add(parent.spanId);
        current = parent;
      }
    });
    return keep;
  }, [isFiltering, matchSet, forest]);

  const rulerTicks = useMemo(() => (
    [0, 0.25, 0.5, 0.75, 1].map(p => ({
      pct: p * 100,
      align: p === 0 ? 'start' : p === 1 ? 'end' : 'center',
      label: formatDuration(traceDuration * p),
    }))
  ), [traceDuration]);

  if (!spans || spans.length === 0) {
    return <div className="empty-state"><div className="empty-state-title">No spans found for this trace</div></div>;
  }

  const rootSpans = forest.roots;
  const getChildren = (parentId: string) => forest.childrenOf(parentId);

  const toggleCollapse = (spanId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  function renderSpan(span: Span, depth: number, hasMoreSiblingsAtDepth: boolean[]): React.ReactNode {
    const children = getChildren(span.spanId);
    const isCollapsed = collapsed.has(span.spanId);
    const isError = isSpanError(span);
    const isCritical = criticalPathSet.has(span.spanId);
    const isDirectMatch = matchSet.has(span.spanId);
    const flattenHidden = hideInternalDb && isInternalOrDbSpan(span) && !(isFiltering && isDirectMatch);

    if (flattenHidden) {
      return (
        <React.Fragment key={span.spanId}>
          {children.map((child, idx) => renderSpan(child, depth, flattenFlags(hasMoreSiblingsAtDepth, idx, children.length)))}
        </React.Fragment>
      );
    }

    if (keepSet && !keepSet.has(span.spanId)) return null;

    const start = new Date(span.startTime).getTime();
    const offsetPercent = traceDuration > 0 ? ((start - traceStartTime) / traceDuration) * 100 : 0;
    const widthPercent = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 100;
    const { left, width } = clampBar(offsetPercent, widthPercent);
    const kindInfo = KIND_LABELS[span.kind] || KIND_LABELS.INTERNAL;
    const color = svcColor(span.serviceName);
    const dest = getSpanDestination(span);
    const inlineSummary = getSpanInlineSummary(span);
    const showSummary = !!inlineSummary && !summaryDuplicatesName(span.name, inlineSummary);
    const isSelected = selectedSpanId === span.spanId;
    const isDimmed = isFiltering && !isDirectMatch;
    const totalChildCount = childCounts.get(span.spanId) || 0;
    const exclusiveMs = exclusiveMsById.get(span.spanId) ?? span.durationMs;
    const selfRatio = span.durationMs > 0 ? Math.min(1, exclusiveMs / span.durationMs) : 1;
    const pctOfTrace = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 0;
    const startOffset = Math.max(0, start - traceStartTime);
    const barTitle = [
      span.name,
      `${formatDuration(span.durationMs)} total · ${formatDuration(exclusiveMs)} self · ${pctOfTrace.toFixed(1)}% of trace`,
      `starts ${formatDuration(startOffset)} after trace start`,
    ].join('\n');

    return (
      <React.Fragment key={span.spanId}>
        <div
          className={[
            'waterfall-row',
            isCritical ? 'is-critical' : '',
            isSelected ? 'is-selected' : '',
            isError ? 'is-error' : '',
            isDimmed ? 'is-dimmed' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelectSpan?.(span)}
        >
          <div className="waterfall-label">
            <TreeGuides depth={depth} hasMoreSiblingsAtDepth={hasMoreSiblingsAtDepth} />

            {children.length > 0 ? (
              <button
                type="button"
                className={`waterfall-toggle has-children ${isCollapsed ? 'is-collapsed' : ''}`}
                aria-label={isCollapsed ? 'Expand span' : 'Collapse span'}
                aria-expanded={!isCollapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(span.spanId);
                }}
              >
                <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            ) : (
              <span className="waterfall-toggle is-leaf" aria-hidden="true">
                <span className="waterfall-leaf-dot" />
              </span>
            )}

            {isCollapsed && totalChildCount > 0 && (
              <span className="waterfall-child-count">+{totalChildCount}</span>
            )}

            <span className="waterfall-svc-pip" style={{ background: color }} title={span.serviceName} />

            <div className="waterfall-copy">
              <div className="waterfall-copy-main">
                <span className="waterfall-name" title={span.name}>{span.name}</span>
                <span className="span-kind-badge" style={{ color: kindInfo.color, background: `${kindInfo.color}18` }}>
                  {kindInfo.label}
                </span>
                {isError && (
                  <span className="waterfall-error-badge" title={span.error || 'Span failed'}>Error</span>
                )}
                {showSummary && (
                  <span
                    className="span-summary-badge"
                    title={getQueryText(span.attributes) || inlineSummary || undefined}
                  >
                    {inlineSummary}
                  </span>
                )}
              </div>
              <div className="waterfall-copy-meta">
                <span className="waterfall-svc" style={{ color }}>{span.serviceName}</span>
                {dest.type && (
                  <>
                    <span className="waterfall-dest-arrow">→</span>
                    <span className={`destination-badge is-${dest.type}`}>{dest.name}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="waterfall-bar-container">
            <div className="row-grid-line" style={{ left: '25%' }} />
            <div className="row-grid-line" style={{ left: '50%' }} />
            <div className="row-grid-line" style={{ left: '75%' }} />

            <div
              className={[
                'waterfall-bar',
                isError ? 'is-error' : '',
                isCritical ? 'is-critical' : '',
                isCollapsed && totalChildCount > 0 ? 'is-collapsed' : '',
              ].filter(Boolean).join(' ')}
              title={barTitle}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: isError
                  ? 'color-mix(in srgb, var(--accent-rose) 32%, transparent)'
                  : `color-mix(in srgb, ${color} 28%, transparent)`,
              }}
            >
              <span
                className="waterfall-bar-self"
                style={{
                  width: `${selfRatio * 100}%`,
                  minWidth: exclusiveMs > 0 ? '2px' : 0,
                  background: isError ? 'var(--accent-rose)' : color,
                }}
              />
            </div>
          </div>

          <div className="waterfall-duration" title={`${pctOfTrace.toFixed(1)}% of trace`}>
            {formatDuration(span.durationMs)}
          </div>
        </div>

        {!isCollapsed && children.map((child, cIdx) =>
          renderSpan(child, depth + 1, siblingFlagsForChild(hasMoreSiblingsAtDepth, cIdx, children.length))
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="waterfall-visualizer">
      <div className="waterfall-controls trace-waterfall-controls">
        <div className="search-box-wrapper">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search spans..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="waterfall-search"
          />
        </div>

        <div className="filter-tabs trace-waterfall-filter-tabs">
          <button
            type="button"
            className={`tab-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All <em>{spans.length}</em>
          </button>
          <button
            type="button"
            className={`tab-btn error ${filterType === 'errors' ? 'active' : ''}`}
            onClick={() => setFilterType('errors')}
          >
            Errors <em>{errorCount}</em>
          </button>
          <button
            type="button"
            className={`tab-btn critical-path ${filterType === 'critical' ? 'active' : ''}`}
            onClick={() => setFilterType('critical')}
          >
            Critical <em>{criticalPathSet.size}</em>
          </button>
        </div>

        <label className="trace-waterfall-toggle">
          <input
            type="checkbox"
            checked={hideInternalDb}
            onChange={(e) => setHideInternalDb(e.target.checked)}
          />
          Hide DB / Internal
        </label>
      </div>

      <div className="performance-breakdown-card">
        <div className="breakdown-row">
          <span>Latency mix</span>
          <div className="breakdown-segment-bar">
            {breakdown.db > 0 && <div className="bar-segment db" style={{ width: `${breakdown.db}%` }} title={`Database: ${formatDuration(breakdown.dbRaw)} (${breakdown.db.toFixed(1)}%)`} />}
            {breakdown.http > 0 && <div className="bar-segment http" style={{ width: `${breakdown.http}%` }} title={`HTTP: ${formatDuration(breakdown.httpRaw)} (${breakdown.http.toFixed(1)}%)`} />}
            {breakdown.rpc > 0 && <div className="bar-segment rpc" style={{ width: `${breakdown.rpc}%` }} title={`gRPC/RPC: ${formatDuration(breakdown.rpcRaw)} (${breakdown.rpc.toFixed(1)}%)`} />}
            {breakdown.internal > 0 && <div className="bar-segment internal" style={{ width: `${breakdown.internal}%` }} title={`Internal: ${formatDuration(breakdown.internalRaw)} (${breakdown.internal.toFixed(1)}%)`} />}
          </div>
          <strong>{formatDuration(traceDuration)}</strong>
        </div>
        <div className="breakdown-legend">
          <div className="legend-item"><span className="legend-dot db" /> DB {breakdown.db.toFixed(0)}%</div>
          <div className="legend-item"><span className="legend-dot http" /> HTTP {breakdown.http.toFixed(0)}%</div>
          <div className="legend-item"><span className="legend-dot rpc" /> gRPC {breakdown.rpc.toFixed(0)}%</div>
          <div className="legend-item"><span className="legend-dot internal" /> Code {breakdown.internal.toFixed(0)}%</div>
        </div>
      </div>

      <div className="waterfall-board">
        <div className="waterfall-header-sticky">
          <div className="ruler-label-section">Spans & hierarchy</div>
          <div className="ruler-grid-section">
            {rulerTicks.map(tick => (
              <div
                key={tick.pct}
                className={`ruler-tick align-${tick.align}`}
                style={{ left: `${tick.pct}%` }}
              >
                {tick.label}
              </div>
            ))}
          </div>
          <div className="waterfall-duration-header">Time</div>
        </div>

        <div className="waterfall">
          {isFiltering && matchSet.size === 0 ? (
            <div className="waterfall-empty">No spans match this filter</div>
          ) : (
            rootSpans.map(s => renderSpan(s, 0, []))
          )}
        </div>
      </div>

      <style>{`
        .waterfall-visualizer {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .waterfall-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .search-box-wrapper {
          position: relative;
          flex: 1;
          min-width: 200px;
        }

        .search-icon {
          position: absolute;
          top: 50%;
          left: 10px;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
        }

        .waterfall-search {
          width: 100%;
          height: 32px;
          padding: 0 12px 0 30px;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 12px;
          font-family: var(--font-sans);
          outline: none;
        }

        .waterfall-search:focus {
          border-color: color-mix(in srgb, var(--accent-indigo) 55%, var(--border-primary));
          box-shadow: var(--shadow-glow);
        }

        .filter-tabs {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 8px;
        }

        .tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-weight: 650;
          font-size: 11.5px;
          cursor: pointer;
          border-radius: 6px;
          padding: 5px 9px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 0.15s, color 0.15s;
        }

        .tab-btn em {
          font-style: normal;
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
        }

        .tab-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .tab-btn.active {
          background: var(--accent-indigo);
          color: #ffffff;
        }

        .tab-btn.active em {
          color: rgba(255, 255, 255, 0.82);
        }

        .tab-btn.error.active {
          background: var(--accent-rose);
        }

        .tab-btn.critical-path.active {
          background: var(--accent-amber);
          color: #1f2937;
        }

        .tab-btn.critical-path.active em {
          color: rgba(31, 41, 55, 0.7);
        }

        .performance-breakdown-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 8px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
        }

        .breakdown-row {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .breakdown-row strong {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0;
          text-transform: none;
          flex-shrink: 0;
        }

        .breakdown-segment-bar {
          flex: 1;
          display: flex;
          height: 6px;
          min-width: 80px;
          background: var(--bg-tertiary);
          border-radius: 99px;
          overflow: hidden;
        }

        .bar-segment {
          height: 100%;
          cursor: help;
        }

        .bar-segment.db { background: var(--accent-amber); }
        .bar-segment.http { background: var(--accent-cyan); }
        .bar-segment.rpc { background: var(--accent-emerald); }
        .bar-segment.internal { background: var(--accent-indigo); }

        .breakdown-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 10px 14px;
          font-size: 10.5px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-secondary);
        }

        .legend-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .legend-dot.db { background: var(--accent-amber); }
        .legend-dot.http { background: var(--accent-cyan); }
        .legend-dot.rpc { background: var(--accent-emerald); }
        .legend-dot.internal { background: var(--accent-indigo); }

        .waterfall-board {
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          overflow: auto;
          background: var(--bg-primary);
        }

        .waterfall-header-sticky {
          position: sticky;
          top: 0;
          z-index: 10;
          display: grid;
          grid-template-columns: ${LABEL_COL} minmax(160px, 1fr) ${DURATION_COL};
          align-items: center;
          min-height: 34px;
          padding: 0 8px 0 0;
          border-left: 3px solid transparent;
          background: color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-tertiary));
          border-bottom: 1px solid var(--border-primary);
          backdrop-filter: blur(8px);
        }

        .ruler-label-section {
          padding-left: 12px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }

        .ruler-grid-section {
          position: relative;
          height: 28px;
        }

        .ruler-tick {
          position: absolute;
          top: 50%;
          color: var(--text-muted);
          font-size: 10px;
          font-family: var(--font-mono);
          font-weight: 600;
          white-space: nowrap;
        }

        .ruler-tick.align-start { transform: translate(0, -50%); }
        .ruler-tick.align-center { transform: translate(-50%, -50%); }
        .ruler-tick.align-end { transform: translate(-100%, -50%); }

        .waterfall-duration-header {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-tertiary);
          text-align: right;
          padding-right: 10px;
        }

        .waterfall {
          display: flex;
          flex-direction: column;
        }

        .waterfall-empty {
          padding: 28px 16px;
          text-align: center;
          color: var(--text-secondary);
          font-size: 13px;
        }

        .waterfall-visualizer .waterfall-row {
          display: grid;
          grid-template-columns: ${LABEL_COL} minmax(160px, 1fr) ${DURATION_COL};
          align-items: stretch;
          gap: 0;
          min-height: 40px;
          padding: 0;
          border-radius: 0;
          border-bottom: 1px solid color-mix(in srgb, var(--border-primary) 70%, transparent);
          border-left: 3px solid transparent;
          background: transparent;
          cursor: pointer;
          outline: none;
        }

        .waterfall-visualizer .waterfall-row:hover {
          background: var(--bg-hover);
        }

        .waterfall-visualizer .waterfall-row:focus-visible {
          box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent-indigo) 45%, transparent);
        }

        .waterfall-visualizer .waterfall-row.is-error {
          border-left-color: var(--accent-rose);
          background: color-mix(in srgb, var(--accent-rose) 5%, transparent);
        }

        .waterfall-visualizer .waterfall-row.is-critical {
          border-left-color: var(--accent-amber);
        }

        .waterfall-visualizer .waterfall-row.is-error.is-critical {
          border-left-color: var(--accent-rose);
        }

        .waterfall-visualizer .waterfall-row.is-selected {
          background: color-mix(in srgb, var(--accent-indigo) 8%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-indigo) 22%, transparent);
        }

        .waterfall-visualizer .waterfall-row.is-dimmed {
          opacity: 0.42;
        }

        .waterfall-visualizer .waterfall-label {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 0;
          width: auto;
          min-width: 0;
          padding: 4px 8px 4px 6px;
        }

        .waterfall-guides {
          display: flex;
          align-self: stretch;
        }

        .waterfall-guide {
          width: 14px;
          position: relative;
          flex-shrink: 0;
        }

        .waterfall-guide.is-rail::before,
        .waterfall-guide.is-elbow::before {
          content: '';
          position: absolute;
          left: 6px;
          top: 0;
          border-left: 1px solid color-mix(in srgb, var(--border-secondary) 80%, transparent);
        }

        .waterfall-guide.is-rail::before {
          bottom: 0;
        }

        .waterfall-guide.is-elbow::before {
          bottom: 50%;
        }

        .waterfall-guide.is-elbow.has-more::before {
          bottom: 0;
        }

        .waterfall-guide.is-elbow::after {
          content: '';
          position: absolute;
          left: 6px;
          right: 1px;
          top: 50%;
          border-top: 1px solid color-mix(in srgb, var(--border-secondary) 80%, transparent);
        }

        .waterfall-toggle {
          width: 16px;
          height: 16px;
          margin-right: 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 0;
          background: transparent;
          color: var(--text-secondary);
          padding: 0;
          border-radius: 4px;
        }

        .waterfall-toggle.has-children {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          cursor: pointer;
        }

        .waterfall-toggle.has-children:hover {
          color: var(--text-primary);
          border-color: var(--border-secondary);
        }

        .waterfall-toggle.has-children svg {
          transform: rotate(0deg);
          transition: transform var(--transition-fast);
        }

        .waterfall-toggle.has-children.is-collapsed svg {
          transform: rotate(-90deg);
        }

        .waterfall-toggle.is-leaf {
          cursor: default;
          opacity: 1;
        }

        .waterfall-leaf-dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--text-muted);
          opacity: 0.55;
        }

        .waterfall-child-count {
          flex-shrink: 0;
          margin-right: 6px;
          padding: 0 5px;
          border-radius: 4px;
          background: color-mix(in srgb, var(--accent-indigo) 10%, transparent);
          color: var(--accent-indigo-light);
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 700;
          line-height: 16px;
        }

        .waterfall-svc-pip {
          width: 7px;
          height: 7px;
          border-radius: 99px;
          flex-shrink: 0;
          margin-right: 7px;
        }

        .waterfall-copy {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .waterfall-copy-main,
        .waterfall-copy-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .waterfall-visualizer .waterfall-name {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 650;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          flex: 1 1 0;
        }

        .waterfall-visualizer .waterfall-row.is-error .waterfall-name {
          color: var(--accent-rose);
        }

        .span-kind-badge {
          flex-shrink: 0;
          font-size: 8.5px;
          font-weight: 800;
          letter-spacing: 0.04em;
          padding: 1px 4px;
          border-radius: 3px;
          text-transform: uppercase;
        }

        .waterfall-error-badge {
          flex-shrink: 0;
          font-size: 9px;
          font-weight: 750;
          padding: 0 5px;
          border-radius: 3px;
          line-height: 16px;
          color: var(--accent-rose);
          background: color-mix(in srgb, var(--accent-rose) 12%, transparent);
        }

        .span-summary-badge {
          min-width: 0;
          max-width: 160px;
          font-size: 10px;
          font-family: var(--font-mono);
          padding: 0 5px;
          border-radius: 4px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border: 1px solid var(--border-primary);
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .waterfall-visualizer .waterfall-svc {
          font-size: 10px;
          font-weight: 650;
          white-space: nowrap;
        }

        .waterfall-dest-arrow {
          color: var(--text-muted);
          font-size: 10px;
        }

        .destination-badge {
          display: inline-flex;
          align-items: center;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 0 5px;
          border-radius: 3px;
          font-weight: 650;
          font-size: 9px;
          line-height: 15px;
        }

        .destination-badge.is-3rdparty {
          background: color-mix(in srgb, var(--accent-amber) 12%, transparent);
          color: var(--accent-amber);
          border: 1px dashed color-mix(in srgb, var(--accent-amber) 35%, transparent);
        }

        .destination-badge.is-infra {
          background: color-mix(in srgb, var(--accent-cyan) 12%, transparent);
          color: var(--accent-cyan);
          border: 1px solid color-mix(in srgb, var(--accent-cyan) 18%, transparent);
          text-transform: lowercase;
        }

        .destination-badge.is-service {
          background: color-mix(in srgb, var(--accent-indigo) 10%, transparent);
          color: var(--accent-indigo-light);
          border: 1px solid color-mix(in srgb, var(--accent-indigo) 16%, transparent);
        }

        .waterfall-visualizer .waterfall-bar-container {
          position: relative;
          display: flex;
          align-items: center;
          height: auto;
          min-width: 0;
          background: transparent;
          border-radius: 0;
        }

        .row-grid-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: color-mix(in srgb, var(--border-primary) 75%, transparent);
          pointer-events: none;
        }

        .waterfall-visualizer .waterfall-bar {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          height: 12px;
          min-width: 2px;
          max-width: 100%;
          border-radius: 3px;
          box-shadow: none;
          overflow: hidden;
          transition: height var(--transition-fast), box-shadow var(--transition-fast);
        }

        .waterfall-visualizer .waterfall-row:hover .waterfall-bar {
          height: 14px;
        }

        .waterfall-visualizer .waterfall-row.is-selected .waterfall-bar {
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-indigo) 35%, transparent);
        }

        .waterfall-bar-self {
          display: block;
          height: 100%;
          max-width: 100%;
          border-radius: 3px;
        }

        .waterfall-bar.is-critical {
          box-shadow: inset 0 2px 0 var(--accent-amber);
        }

        .waterfall-bar.is-error {
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-rose) 45%, transparent);
        }

        .waterfall-bar.is-collapsed::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            -55deg,
            transparent,
            transparent 3px,
            color-mix(in srgb, var(--text-primary) 14%, transparent) 3px,
            color-mix(in srgb, var(--text-primary) 14%, transparent) 4px
          );
        }

        .waterfall-visualizer .waterfall-duration {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          width: auto;
          min-width: 0;
          padding-right: 10px;
          font-size: 11px;
          font-family: var(--font-mono);
          font-weight: 650;
          color: var(--text-secondary);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
