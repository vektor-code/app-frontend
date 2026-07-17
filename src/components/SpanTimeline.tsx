import React, { useState, useMemo } from 'react';
import type { Span } from '../entities';
import { isSpanError } from '../utils/spanStatus';

export interface DestinationInfo {
  type: 'infra' | '3rdparty' | 'service' | null;
  name: string;
}

export function getSpanDestination(span: Span): DestinationInfo {
  const attrs = span.attributes || {};
  
  // 1. Database infrastructure
  if (attrs['db.system']) {
    const dbSys = attrs['db.system'];
    const dbName = attrs['db.name'];
    const name = dbName ? `${dbSys} (${dbName})` : dbSys;
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
  if (attrs['http.method']) {
    const method = attrs['http.method'];
    const status = attrs['http.status_code'] || attrs['http.status'];
    return status ? `${method} (${status})` : `${method}`;
  }
  
  // 2. Database calls
  if (attrs['db.system']) {
    const statement = attrs['db.statement'];
    if (statement) {
      // Truncate SQL query to show first 40 chars
      return statement.length > 40 ? `${statement.slice(0, 40)}...` : statement;
    }
    return attrs['db.system'];
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

export default function SpanTimeline({ spans, traceStartTime, traceDuration, onSelectSpan, selectedSpanId }: SpanTimelineProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'errors' | 'critical'>('all');
  const [hideInternalDb, setHideInternalDb] = useState(false);

  const criticalPathSet = useMemo(() => calculateCriticalPath(spans), [spans]);

  // Pre-calculate recursive child counts for all spans
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const countFn = (spanId: string): number => {
      if (counts.has(spanId)) return counts.get(spanId)!;
      const direct = spans.filter(s => s.parentSpanId === spanId);
      let total = direct.length;
      direct.forEach(child => {
        total += countFn(child.spanId);
      });
      counts.set(spanId, total);
      return total;
    };
    spans.forEach(s => countFn(s.spanId));
    return counts;
  }, [spans]);

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

  const toggleCollapse = (spanId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  function renderSpan(span: Span, depth: number, hasMoreSiblingsAtDepth: boolean[]): React.ReactNode {
    const start = new Date(span.startTime).getTime();
    const offsetPercent = traceDuration > 0 ? ((start - traceStartTime) / traceDuration) * 100 : 0;
    const widthPercent = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 100;
    const children = getChildren(span.spanId);
    const isCollapsed = collapsed.has(span.spanId);
    const isError = isSpanError(span);
    const isCritical = criticalPathSet.has(span.spanId);
    const kindInfo = KIND_LABELS[span.kind] || KIND_LABELS.INTERNAL;
    const color = svcColor(span.serviceName);
    const attrs = span.attributes || {};
    const dest = getSpanDestination(span);
    const inlineSummary = getSpanInlineSummary(span);

    const isDbOrInternal = span.kind === 'INTERNAL' || kindInfo.label === 'INT' || kindInfo.label === 'CLI' || !!attrs['db.system'] || !!attrs['db.statement'];
    if (hideInternalDb && isDbOrInternal) {
      return (
        <React.Fragment key={span.spanId}>
          {!isCollapsed && children.map((child, idx) => renderSpan(child, depth, [...hasMoreSiblingsAtDepth]))}
        </React.Fragment>
      );
    }

    // Filters check
    const matchesSearch = 
      span.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      span.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      Object.values(attrs).some(v => String(v).toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = 
      filterType === 'all' || 
      (filterType === 'errors' && isError) || 
      (filterType === 'critical' && isCritical);

    const isDimmed = !matchesSearch || !matchesType;

    if (isDimmed) {
      return (
        <React.Fragment key={span.spanId}>
          {!isCollapsed && children.map((child, idx) => renderSpan(child, depth, [...hasMoreSiblingsAtDepth]))}
        </React.Fragment>
      );
    }

    const totalChildCount = childCounts.get(span.spanId) || 0;
    const isSelected = selectedSpanId === span.spanId;

    // Render tree vertical elbow guides based on current depth
    const guides = [];
    for (let i = 0; i < depth; i++) {
      const isLastStep = i === depth - 1;
      const hasMore = hasMoreSiblingsAtDepth[i];
      
      guides.push(
        <div 
          key={i} 
          style={{
            width: '14px',
            position: 'relative',
            alignSelf: 'stretch',
            flexShrink: 0,
            display: 'flex',
          }} 
        >
          {/* Center vertical line */}
          {(!isLastStep && hasMore) && (
            <div style={{
              position: 'absolute',
              left: '6px',
              top: 0,
              bottom: 0,
              borderLeft: '1px solid var(--border-primary)',
              opacity: 0.45
            }} />
          )}
          {isLastStep && (
            <>
              {/* Vertical part of elbow */}
              <div style={{
                position: 'absolute',
                left: '6px',
                top: 0,
                bottom: hasMore ? 0 : '50%',
                borderLeft: '1px solid var(--border-primary)',
                opacity: 0.45
              }} />
              {/* Horizontal part of elbow */}
              <div style={{
                position: 'absolute',
                left: '6px',
                right: 0,
                top: '50%',
                borderTop: '1px solid var(--border-primary)',
                opacity: 0.45
              }} />
            </>
          )}
        </div>
      );
    }

    const isBarFarRight = offsetPercent + widthPercent > 80;

    return (
      <React.Fragment key={span.spanId}>
        <div
          className={`waterfall-row ${isCritical ? 'critical-path-row' : ''} ${isSelected ? 'selected-row' : ''}`}
          style={{
            opacity: isDimmed ? 0.35 : 1,
            cursor: 'pointer',
            borderLeft: isError ? '3px solid var(--accent-rose)' : isCritical ? '3px solid var(--accent-amber)' : '3px solid transparent',
            background: isSelected ? 'rgba(99, 102, 241, 0.08)' : undefined,
            transition: 'opacity 0.2s, background 0.15s',
            display: 'flex',
            alignItems: 'center',
            padding: '3px 8px 3px 0',
            borderBottom: '1px solid var(--border-primary)',
            minHeight: '34px'
          }}
          onClick={() => onSelectSpan && onSelectSpan(span)}
        >
          {/* Tree and Name Column (42% Width) */}
          <div className="waterfall-label" style={{ 
            width: '42%', 
            minWidth: '320px', 
            flexShrink: 0,
            display: 'flex', 
            flexDirection: 'row', 
            alignItems: 'center',
            paddingRight: '8px',
            height: '100%'
          }}>
            {/* Indentation Guideline Elbow Grid */}
            <div style={{ display: 'flex', alignSelf: 'stretch', height: '100%', alignItems: 'center' }}>
              {guides}
            </div>

            {/* Tree Toggle Arrow (Chevron SVG style) */}
            <span 
              className="expanded-arrow" 
              style={{ 
                marginRight: '5px', 
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '12px',
                height: '12px',
                borderRadius: '2px',
                cursor: 'pointer',
                userSelect: 'none',
                background: children.length > 0 ? 'var(--bg-tertiary)' : 'transparent',
                border: children.length > 0 ? '1px solid var(--border-primary)' : 'none'
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (children.length > 0) toggleCollapse(span.spanId);
              }}
            >
              {children.length > 0 ? (
                <svg 
                  viewBox="0 0 24 24" 
                  width="10" 
                  height="10" 
                  stroke="currentColor" 
                  strokeWidth="3.5" 
                  fill="none" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  style={{
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform var(--transition-fast)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              ) : (
                <span style={{
                  width: '3.5px',
                  height: '3.5px',
                  borderRadius: '50%',
                  background: 'var(--text-muted)',
                  opacity: 0.5
                }} />
              )}
            </span>

            {/* Child Spans Count Pill */}
            {totalChildCount > 0 && (
              <span className="child-count-pill" style={{
                fontSize: '8.5px',
                fontWeight: 600,
                background: 'rgba(99, 102, 241, 0.1)',
                color: 'var(--accent-indigo-light)',
                padding: '0.5px 3.5px',
                borderRadius: '3px',
                marginRight: '6px',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0
              }}>
                {totalChildCount}
              </span>
            )}

            {/* Span service/operation name (Stacked layout) */}
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, paddingLeft: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flexWrap: 'wrap' }}>
                <span className="waterfall-name" title={span.name} style={{ 
                  fontWeight: 600, 
                  color: isError ? 'var(--accent-rose)' : 'var(--text-primary)', 
                  fontSize: '11px', 
                  fontFamily: 'var(--font-sans)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {span.name}
                </span>

                <span className="span-kind-badge" style={{
                  fontSize: '8px',
                  fontWeight: 700,
                  padding: '0.5px 3px',
                  borderRadius: '2px',
                  background: kindInfo.color + '15',
                  color: kindInfo.color,
                  textTransform: 'uppercase',
                  flexShrink: 0
                }}>
                  {kindInfo.label}
                </span>

                {isError && (
                  <span style={{
                    color: 'var(--accent-rose)',
                    fontSize: '9px',
                    fontWeight: 700,
                    background: 'rgba(244, 63, 94, 0.1)',
                    padding: '0px 4px',
                    borderRadius: '3px',
                    border: '1px solid rgba(244, 63, 94, 0.2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0
                  }} title={span.error || "Span failed"}>
                    Error
                  </span>
                )}

                {inlineSummary && (
                  <span className="span-summary-badge" style={{
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    padding: '0px 5px',
                    borderRadius: '3px',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-primary)',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    maxWidth: '180px'
                  }} title={span.attributes?.['db.statement'] || inlineSummary}>
                    {inlineSummary}
                  </span>
                )}
              </div>

              {/* Service name below operation */}
              <span className="waterfall-svc" style={{ 
                fontSize: '9px', 
                color: color, 
                fontWeight: 500,
                marginTop: '0.5px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                flexWrap: 'wrap'
              }}>
                {span.serviceName}
                {dest.type && (
                  <>
                    <span style={{ color: 'var(--text-muted)', fontSize: '8px' }}>-&gt;</span>
                    <span className="destination-badge" style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: dest.type === '3rdparty' ? 'rgba(245, 158, 11, 0.1)' : dest.type === 'infra' ? 'rgba(14, 165, 233, 0.1)' : 'rgba(99, 102, 241, 0.08)',
                      color: dest.type === '3rdparty' ? 'var(--accent-amber, #f59e0b)' : dest.type === 'infra' ? 'var(--accent-cyan, #0ea5e9)' : 'var(--accent-indigo-light, #818cf8)',
                      padding: '0.5px 5px',
                      borderRadius: '3px',
                      fontWeight: 600,
                      fontSize: '8px',
                      border: dest.type === '3rdparty' ? '1px dashed rgba(245, 158, 11, 0.3)' : '1px solid rgba(14, 165, 233, 0.15)',
                      textTransform: dest.type === 'infra' ? 'lowercase' : 'none'
                    }}>
                      {dest.name}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Gantt Bar Timeline (Flexible Width) */}
          <div className="waterfall-bar-container" style={{ 
            flex: 1, 
            position: 'relative', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center',
            background: 'transparent'
          }}>
            {/* Vertical timeline grid lines */}
            <div className="row-grid-line" style={{ left: '25%' }} />
            <div className="row-grid-line" style={{ left: '50%' }} />
            <div className="row-grid-line" style={{ left: '75%' }} />

            {/* Horizontal reference track representing 100% trace time */}
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: '4px',
              background: 'var(--bg-tertiary)',
              borderRadius: '2px',
              opacity: 0.5,
              pointerEvents: 'none'
            }} />

            <div
              className={`waterfall-bar ${isError ? 'error' : isCritical ? 'critical' : ''}`}
              style={{
                position: 'absolute',
                left: `${Math.max(0, offsetPercent)}%`,
                width: `${Math.max(0.8, widthPercent)}%`,
                minWidth: '4px',
                background: isError 
                  ? 'linear-gradient(180deg, #fb7185 0%, #e11d48 100%)' 
                  : isCritical 
                    ? 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)' 
                    : `linear-gradient(180deg, ${color} 0%, ${color}aa 100%)`,
                boxShadow: isSelected 
                  ? `0 0 12px ${color}, 0 0 4px rgba(255,255,255,0.3)` 
                  : isError 
                    ? '0 0 8px rgba(244, 63, 94, 0.35)' 
                    : isCritical 
                      ? '0 0 8px rgba(245, 158, 11, 0.35)' 
                      : `0 1px 4px ${color}25`,
                height: '13px',
                borderRadius: '6px'
              }}
            />

            {/* Aligned duration label next to the bar (or left-aligned if bar goes offscreen right) */}
            <span style={{
              position: 'absolute',
              left: isBarFarRight ? undefined : `${Math.max(0, offsetPercent) + Math.max(0.8, widthPercent) + 1.2}%`,
              right: isBarFarRight ? `${100 - Math.max(0, offsetPercent) + 1.2}%` : undefined,
              fontSize: '9px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              background: isBarFarRight ? 'var(--bg-secondary)' : 'transparent',
              padding: isBarFarRight ? '0 3px' : '0',
              borderRadius: '2px',
              fontWeight: 600
            }}>
              {formatDuration(span.durationMs)}
            </span>
          </div>
        </div>

        {!isCollapsed && children.map((child, cIdx) => 
          renderSpan(child, depth + 1, [...hasMoreSiblingsAtDepth, cIdx < children.length - 1])
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="waterfall-visualizer">
      {/* 1. Interactive Control & Filter Panel */}
      <div className="waterfall-controls trace-waterfall-controls">
        <div className="search-box-wrapper">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="search-icon" style={{ top: '8px', left: '8px' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search spans..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="filter-select"
            style={{ width: '100%', paddingLeft: '28px', fontSize: '11px', height: '28px' }}
          />
        </div>
        <div className="filter-tabs trace-waterfall-filter-tabs" style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', padding: '2px', borderRadius: '6px' }}>
          <button 
            className={`tab-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
            style={{ padding: '4px 8px', fontSize: '11px' }}
          >
            All ({spans.length})
          </button>
          <button 
            className={`tab-btn error ${filterType === 'errors' ? 'active' : ''}`}
            onClick={() => setFilterType('errors')}
            style={{ padding: '4px 8px', fontSize: '11px' }}
          >
            Errors ({spans.filter(isSpanError).length})
          </button>
          <button 
            className={`tab-btn critical-path ${filterType === 'critical' ? 'active' : ''}`}
            onClick={() => setFilterType('critical')}
            style={{ padding: '4px 8px', fontSize: '11px' }}
          >
            Critical ({criticalPathSet.size})
          </button>

          <label className="trace-waterfall-toggle">
            <input 
              type="checkbox" 
              checked={hideInternalDb} 
              onChange={(e) => setHideInternalDb(e.target.checked)}
            />
            Hide DB/Internal
          </label>
        </div>
      </div>

      {/* 2. Trace Performance Breakdown segment bar */}
      <div className="performance-breakdown-card" style={{ padding: '8px 12px', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
          <span>Latency breakdown:</span>
          <span>Total: {formatDuration(traceDuration)}</span>
        </div>
        <div className="breakdown-segment-bar" style={{ height: '6px', marginBottom: '6px' }}>
          {breakdown.db > 0 && <div className="bar-segment db" style={{ width: `${breakdown.db}%` }} title={`Database: ${formatDuration(breakdown.dbRaw)} (${breakdown.db.toFixed(1)}%)`} />}
          {breakdown.http > 0 && <div className="bar-segment http" style={{ width: `${breakdown.http}%` }} title={`HTTP: ${formatDuration(breakdown.httpRaw)} (${breakdown.http.toFixed(1)}%)`} />}
          {breakdown.rpc > 0 && <div className="bar-segment rpc" style={{ width: `${breakdown.rpc}%` }} title={`gRPC/RPC: ${formatDuration(breakdown.rpcRaw)} (${breakdown.rpc.toFixed(1)}%)`} />}
          {breakdown.internal > 0 && <div className="bar-segment internal" style={{ width: `${breakdown.internal}%` }} title={`Internal: ${formatDuration(breakdown.internalRaw)} (${breakdown.internal.toFixed(1)}%)`} />}
        </div>
        <div className="breakdown-legend" style={{ gap: '10px' }}>
          <div className="legend-item"><span className="legend-dot db" style={{ width: '6px', height: '6px' }} /> DB ({breakdown.db.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot http" style={{ width: '6px', height: '6px' }} /> HTTP ({breakdown.http.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot rpc" style={{ width: '6px', height: '6px' }} /> gRPC ({breakdown.rpc.toFixed(0)}%)</div>
          <div className="legend-item"><span className="legend-dot internal" style={{ width: '6px', height: '6px' }} /> Code ({breakdown.internal.toFixed(0)}%)</div>
        </div>
      </div>

      {/* 3. Sticky Time Ruler Grid Header */}
      <div className="waterfall-header-sticky" style={{ padding: '8px 8px 8px 0', borderLeft: '3px solid transparent' }}>
        <div className="ruler-label-section" style={{ width: '42%', minWidth: '320px', flexShrink: 0, fontSize: '10px', paddingLeft: '12px' }}>
          Spans & Hierarchy
        </div>
        <div className="ruler-grid-section" style={{ flex: 1, position: 'relative', height: '16px', fontSize: '9px' }}>
          <div className="ruler-tick" style={{ position: 'absolute', left: '0%', transform: 'translateX(0%)' }}>0%</div>
          <div className="ruler-tick" style={{ position: 'absolute', left: '25%', transform: 'translateX(-50%)' }}>25%</div>
          <div className="ruler-tick" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>50%</div>
          <div className="ruler-tick" style={{ position: 'absolute', left: '75%', transform: 'translateX(-50%)' }}>75%</div>
          <div className="ruler-tick" style={{ position: 'absolute', left: '100%', transform: 'translateX(-100%)' }}>100%</div>
        </div>
      </div>

      {/* 4. The main scrollable waterfall view */}
      <div className="waterfall">
        {rootSpans.map((s, idx) => 
          renderSpan(s, 0, [idx < rootSpans.length - 1])
        )}
      </div>

      <style>{`
        .waterfall-visualizer {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .waterfall-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: space-between;
          align-items: center;
        }
        
        .search-box-wrapper {
          position: relative;
          flex: 1;
          min-width: 200px;
        }
        
        .search-icon {
          position: absolute;
          color: var(--text-muted);
          pointer-events: none;
        }
        
        .filter-tabs {
          display: flex;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          gap: 2px;
        }
        
        .tab-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-weight: 500;
          cursor: pointer;
          border-radius: 4px;
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
        }
        
        .breakdown-segment-bar {
          display: flex;
          background: var(--bg-tertiary);
          border-radius: 3px;
          overflow: hidden;
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
          font-size: 10px;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--text-secondary);
        }
        
        .legend-dot {
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
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-tertiary);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        .ruler-label-section {
          width: 42%;
          min-width: 320px;
          flex-shrink: 0;
        }
        
        .ruler-grid-section {
          flex: 1;
          position: relative;
        }
        
        .ruler-tick {
          color: var(--text-muted);
        }

        .row-grid-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background-color: var(--border-primary);
          opacity: 0.12;
          pointer-events: none;
        }
        
        .span-kind-badge {
          flex-shrink: 0;
          font-family: var(--font-sans);
        }
        
        .selected-row {
          background: rgba(99, 102, 241, 0.08) !important;
          box-shadow: inset 2px 0 0 0 var(--accent-indigo);
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
          border-right: 2px solid rgba(245, 158, 11, 0.15);
          pointer-events: none;
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
