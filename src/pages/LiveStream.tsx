import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { connectLiveStream } from '../api/liveStream';
import type { Span } from '../entities';
import { isSpanError } from '../utils/spanStatus';
import CustomSelect from '../components/CustomSelect';
import { StandardColumnHeader, StandardTableToolbar, type StandardSortDirection } from '../components/StandardTable';
import { useTranslation } from '../utils/i18n';
import { useColumnResize } from '../utils/useColumnResize';

interface LiveStreamProps {
  namespace: string;
}

interface LiveSpan extends Span {
  _id: string;
  _receivedAt: number;
}

interface TraceSummary {
  traceId: string;
  spans: LiveSpan[];
  services: string[];
  namespaces: string[];
  hasError: boolean;
  maxDuration: number;
  lastSeen: number;
  rootName: string;
}

type LiveMode = 'spans' | 'traces';
type LiveLayout = 'cards' | 'table';
type LiveColumn = 'status' | 'service' | 'operation' | 'kind' | 'namespace' | 'latency' | 'time' | 'actions';
type LiveSortField = Exclude<LiveColumn, 'actions'>;

const liveColumnWidths: Record<LiveColumn, number> = {
  status: 86,
  service: 160,
  operation: 270,
  kind: 110,
  namespace: 150,
  latency: 110,
  time: 120,
  actions: 54,
};

const liveColumnMinimums: Record<LiveColumn, number> = {
  status: 76,
  service: 120,
  operation: 180,
  kind: 82,
  namespace: 110,
  latency: 92,
  time: 96,
  actions: 48,
};

const liveColumnOrder: LiveColumn[] = ['status', 'service', 'operation', 'kind', 'namespace', 'latency', 'time', 'actions'];

const maxSpans = 500;
const slowMs = 500;
const verySlowMs = 1000;

export default function LiveStream({ namespace }: LiveStreamProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [spans, setSpans] = useState<LiveSpan[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [latencyFilter, setLatencyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [spansPerSec, setSpansPerSec] = useState(0);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [mode, setMode] = useState<LiveMode>('spans');
  const [layout, setLayout] = useState<LiveLayout>('cards');
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const pausedRef = useRef(paused);
  const totalCountRef = useRef(0);
  const prevCountRef = useRef(0);
  const liveSpanIdRef = useRef(0);
  const pausedBufferRef = useRef<LiveSpan[]>([]);

  pausedRef.current = paused;

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = totalCountRef.current - prevCountRef.current;
      setSpansPerSec(Math.max(0, Math.round(diff / 2)));
      prevCountRef.current = totalCountRef.current;
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSpan = useCallback((span: Span) => {
    totalCountRef.current += 1;
    setTotalCount(c => c + 1);

    const liveSpan: LiveSpan = {
      ...span,
      _id: `${span.spanId}-${Date.now()}-${liveSpanIdRef.current++}`,
      _receivedAt: Date.now()
    };

    if (pausedRef.current) {
      pausedBufferRef.current = [liveSpan, ...pausedBufferRef.current].slice(0, maxSpans);
      setBufferedCount(pausedBufferRef.current.length);
      return;
    }

    setSpans(prev => [liveSpan, ...prev].slice(0, maxSpans));
  }, []);

  useEffect(() => {
    const disconnect = connectLiveStream(
      namespace || undefined,
      handleSpan,
      () => setConnected(true),
      () => setConnected(false)
    );
    return () => disconnect();
  }, [namespace, handleSpan]);

  useEffect(() => {
    if (selectedSpanId && !spans.some(span => span._id === selectedSpanId)) {
      setSelectedSpanId(null);
    }
  }, [spans, selectedSpanId]);

  const flushBuffered = useCallback(() => {
    if (pausedBufferRef.current.length === 0) return;
    const queued = pausedBufferRef.current;
    pausedBufferRef.current = [];
    setBufferedCount(0);
    setSpans(prev => [...queued, ...prev].slice(0, maxSpans));
  }, []);

  const togglePaused = () => {
    if (paused) flushBuffered();
    setPaused(current => !current);
  };

  const clearSpans = () => {
    pausedBufferRef.current = [];
    setBufferedCount(0);
    setSpans([]);
    setSelectedSpanId(null);
    setTotalCount(0);
    totalCountRef.current = 0;
    prevCountRef.current = 0;
    setSpansPerSec(0);
  };

  const clearFilters = () => {
    setServiceFilter('');
    setStatusFilter('');
    setKindFilter('');
    setLatencyFilter('');
    setSearchQuery('');
  };

  const serviceOptions = useMemo(() => {
    const unique = [...new Set(spans.map(s => s.serviceName).filter(Boolean))].sort();
    return [
      { value: '', label: t('All services') },
      ...unique.map(service => ({ value: service, label: service }))
    ];
  }, [spans, t]);

  const kindOptions = useMemo(() => {
    const unique = [...new Set(spans.map(s => s.kind).filter(Boolean))].sort();
    return [
      { value: '', label: t('All kinds') },
      ...unique.map(kind => ({ value: kind, label: kind }))
    ];
  }, [spans, t]);

  const statusOptions = [
    { value: '', label: t('All status') },
    { value: 'ok', label: 'OK' },
    { value: 'error', label: t('Errors') }
  ];

  const latencyOptions = [
    { value: '', label: t('All latency') },
    { value: String(slowMs), label: `>${slowMs}ms` },
    { value: String(verySlowMs), label: `>${(verySlowMs / 1000).toFixed(0)}s` }
  ];

  const filteredSpans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minLatency = latencyFilter ? Number(latencyFilter) : 0;

    return spans.filter(span => {
      if (serviceFilter && span.serviceName !== serviceFilter) return false;
      if (kindFilter && span.kind !== kindFilter) return false;
      if (statusFilter === 'error' && !isSpanError(span)) return false;
      if (statusFilter === 'ok' && isSpanError(span)) return false;
      if (minLatency > 0 && span.durationMs < minLatency) return false;
      if (q) {
        const haystack = [
          span.name,
          span.serviceName,
          span.namespace,
          span.traceId,
          span.spanId,
          span.kind,
          span.podName,
          span.nodeName,
          span.error,
          routeLabel(span)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [spans, serviceFilter, kindFilter, statusFilter, latencyFilter, searchQuery]);

  const traceSummaries = useMemo<TraceSummary[]>(() => {
    const grouped = new Map<string, LiveSpan[]>();
    for (const span of filteredSpans) {
      const list = grouped.get(span.traceId) || [];
      list.push(span);
      grouped.set(span.traceId, list);
    }

    return Array.from(grouped.entries())
      .map(([traceId, list]) => {
        const sorted = [...list].sort((a, b) => b._receivedAt - a._receivedAt);
        return {
          traceId,
          spans: sorted,
          services: [...new Set(sorted.map(span => span.serviceName).filter(Boolean))],
          namespaces: [...new Set(sorted.map(span => span.namespace).filter(Boolean))],
          hasError: sorted.some(span => isSpanError(span)),
          maxDuration: Math.max(...sorted.map(span => span.durationMs || 0)),
          lastSeen: Math.max(...sorted.map(span => span._receivedAt || 0)),
          rootName: sorted[sorted.length - 1]?.name || sorted[0]?.name || traceId
        };
      })
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }, [filteredSpans]);

  const stats = useMemo(() => {
    if (spans.length === 0) return { errorRate: 0, avgDuration: 0, p95: 0, uniqueServices: 0, slowCount: 0 };
    const durations = spans.map(s => s.durationMs || 0).sort((a, b) => a - b);
    const errCount = spans.filter(s => isSpanError(s)).length;
    const totalDuration = spans.reduce((sum, s) => sum + (s.durationMs || 0), 0);
    return {
      errorRate: (errCount / spans.length) * 100,
      avgDuration: totalDuration / spans.length,
      p95: durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] || 0,
      uniqueServices: new Set(spans.map(s => s.serviceName).filter(Boolean)).size,
      slowCount: spans.filter(s => (s.durationMs || 0) >= slowMs).length
    };
  }, [spans]);

  const volumeBuckets = useMemo(() => buildVolumeBuckets(spans), [spans]);
  const hotServices = useMemo(() => serviceBreakdown(spans), [spans]);
  const selectedSpan = useMemo(() => {
    return spans.find(span => span._id === selectedSpanId) || filteredSpans[0] || null;
  }, [spans, filteredSpans, selectedSpanId]);
  const activeFilters = [serviceFilter, statusFilter, kindFilter, latencyFilter, searchQuery.trim()].filter(Boolean).length;

  return (
    <div className="live-page animate-fade-in">
      <section className="live-hero">
        <div className="live-hero-copy">
          <span className={`live-status-pill ${connected ? 'live' : 'offline'}`}>
            <i />
            {connected ? (paused ? t('Paused') : t('Live')) : t('Offline')}
          </span>
          <h1>{t('Live Stream')}</h1>
          <p>{namespace || t('All Namespaces')}</p>
        </div>
        <div className="live-hero-actions">
          {paused && bufferedCount > 0 && <span className="live-queue-pill">{bufferedCount} {t('queued')}</span>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={togglePaused}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {paused ? <polygon points="5 3 19 12 5 21 5 3" /> : (
                <>
                  <line x1="6" y1="4" x2="6" y2="20" />
                  <line x1="18" y1="4" x2="18" y2="20" />
                </>
              )}
            </svg>
            {paused ? t('Resume') : t('Pause')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSpans}>{t('Clear')}</button>
        </div>
      </section>

      <section className="live-metric-grid">
        <MetricCard tone="indigo" label={t('Throughput')} value={String(spansPerSec)} detail={t('spans/sec')} />
        <MetricCard tone="emerald" label={t('P95 latency')} value={formatDuration(stats.p95)} detail={`${formatDuration(stats.avgDuration)} ${t('avg')}`} />
        <MetricCard tone={stats.errorRate > 0 ? 'rose' : 'emerald'} label={t('Error rate')} value={`${stats.errorRate.toFixed(1)}%`} detail={`${spans.filter(s => isSpanError(s)).length} ${t('errors')}`} />
        <MetricCard tone="amber" label={t('Services')} value={String(stats.uniqueServices)} detail={`${stats.slowCount} ${t('slow spans')}`} />
      </section>

      <section className="live-workbench">
        <div className="live-filter-panel">
          <div className="live-search">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t('Search operation, service, trace id, pod')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <CustomSelect className="live-stream-filter-select" ariaLabel={t('Service')} options={serviceOptions} value={serviceFilter} onChange={setServiceFilter} placeholder={t('All services')} />
          <CustomSelect className="live-stream-filter-select" ariaLabel={t('Status')} options={statusOptions} value={statusFilter} onChange={setStatusFilter} placeholder={t('All status')} />
          <CustomSelect className="live-stream-filter-select" ariaLabel={t('Kind')} options={kindOptions} value={kindFilter} onChange={setKindFilter} placeholder={t('All kinds')} />
          <CustomSelect className="live-stream-filter-select" ariaLabel={t('Latency')} options={latencyOptions} value={latencyFilter} onChange={setLatencyFilter} placeholder={t('All latency')} />
          {activeFilters > 0 && <button type="button" className="live-clear-filters" onClick={clearFilters}>{t('Clear')} ({activeFilters})</button>}
        </div>

        <div className="live-volume-card">
          <div className="live-volume-head">
            <strong>{t('Volume')}</strong>
            <span>{filteredSpans.length} / {spans.length} {t('visible')}</span>
          </div>
          <div className="live-volume-bars" aria-label={t('Live volume')}>
            {volumeBuckets.map((bucket, index) => (
              <span
                key={index}
                className={bucket.errors > 0 ? 'has-error' : ''}
                style={{ height: `${Math.max(8, bucket.height)}%` }}
                title={`${bucket.count} ${t('spans')}${bucket.errors ? `, ${bucket.errors} ${t('errors')}` : ''}`}
              />
            ))}
          </div>
          <div className="live-hot-services">
            {hotServices.length === 0 ? (
              <span>{t('No services yet')}</span>
            ) : hotServices.map(service => (
              <button key={service.service} type="button" onClick={() => setServiceFilter(service.service)} className={service.errors > 0 ? 'has-error' : ''}>
                <strong>{service.service}</strong>
                <em>{service.count}</em>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="live-console-grid">
        <div className="live-stream-panel">
          <div className="live-stream-panel-head">
            <div className="live-panel-title">
              <strong>{mode === 'spans' ? t('Live spans') : t('Live traces')}</strong>
              <span>{mode === 'spans' ? `${filteredSpans.length} / ${totalCount}` : `${traceSummaries.length} ${t('traces')}`}</span>
            </div>
            <div className="live-panel-actions">
              <Segmented value={mode} options={[{ value: 'spans', label: t('Spans') }, { value: 'traces', label: t('Traces') }]} onChange={setMode} />
              {mode === 'spans' && <Segmented value={layout} options={[{ value: 'cards', label: t('Cards') }, { value: 'table', label: t('Table') }]} onChange={setLayout} />}
            </div>
          </div>

          {filteredSpans.length === 0 ? (
            <EmptyState connected={connected} t={t} />
          ) : mode === 'traces' ? (
            <TraceList traces={traceSummaries} onSelectSpan={setSelectedSpanId} onOpenTrace={(traceId) => navigate(`/traces/${traceId}`)} t={t} />
          ) : layout === 'table' ? (
            <SpanTable spans={filteredSpans} selectedId={selectedSpan?._id} onSelect={setSelectedSpanId} onOpenTrace={(traceId) => navigate(`/traces/${traceId}`)} t={t} />
          ) : (
            <div className="live-stream-container">
              {filteredSpans.map(span => (
                <SpanCard key={span._id} span={span} selected={selectedSpan?._id === span._id} namespace={namespace} onSelect={setSelectedSpanId} onOpenTrace={(traceId) => navigate(`/traces/${traceId}`)} t={t} />
              ))}
            </div>
          )}
        </div>

        <aside className="live-inspector">
          <div className="live-inspector-head">
            <strong>{t('Inspector')}</strong>
            {selectedSpan && <span className={isSpanError(selectedSpan) ? 'error' : 'ok'}>{spanStatusLabel(selectedSpan)}</span>}
          </div>
          {selectedSpan ? (
            <SpanInspector span={selectedSpan} onOpenTrace={() => navigate(`/traces/${selectedSpan.traceId}`)} t={t} />
          ) : (
            <div className="live-inspector-empty">
              <strong>{t('No spans')}</strong>
              <span>{connected ? t('Waiting for telemetry') : t('Connecting')}</span>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function MetricCard({ tone, label, value, detail }: { tone: string; label: string; value: string; detail: string }) {
  return (
    <div className={`live-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="live-segmented">
      {options.map(option => (
        <button key={option.value} type="button" className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SpanCard({
  span,
  selected,
  namespace,
  onSelect,
  onOpenTrace,
  t
}: {
  span: LiveSpan;
  selected: boolean;
  namespace: string;
  onSelect: (id: string) => void;
  onOpenTrace: (traceId: string) => void;
  t: (key: string) => string;
}) {
  const tone = spanTone(span);
  return (
    <article className={`live-span-card ${tone} ${selected ? 'selected' : ''}`} onClick={() => onSelect(span._id)}>
      <div className="live-span-card-top">
        <span className={`live-span-status ${isSpanError(span) ? 'error' : tone === 'slow' ? 'slow' : 'ok'}`}>
          {isSpanError(span) ? 'ERR' : tone === 'slow' ? 'SLOW' : 'OK'}
        </span>
        <strong title={span.serviceName}>{span.serviceName || t('unknown')}</strong>
        <em>{span.kind || 'SPAN'}</em>
        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenTrace(span.traceId); }}>{t('Open trace')}</button>
      </div>
      <div className="live-span-operation">
        <strong title={span.name}>{routeLabel(span)}</strong>
        <span>{formatDuration(span.durationMs)} · {formatTime(span.startTime)}</span>
      </div>
      <div className="live-span-meta">
        {!namespace && <span>{span.namespace || t('default')}</span>}
        {span.podName && <span title={span.podName}>{span.podName}</span>}
        <code>{shortId(span.traceId)}</code>
      </div>
    </article>
  );
}

function SpanTable({
  spans,
  selectedId,
  onSelect,
  onOpenTrace,
  t
}: {
  spans: LiveSpan[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpenTrace: (traceId: string) => void;
  t: (key: string) => string;
}) {
  const [sortField, setSortField] = useState<LiveSortField>('time');
  const [sortDir, setSortDir] = useState<StandardSortDirection>('desc');
  const columns = useColumnResize(liveColumnWidths, {
    minWidths: liveColumnMinimums,
    storageKey: 'liveStreamColumnsV1',
  });
  const gridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: liveColumnOrder.map(column => `${columns.widths[column]}px`).join(' '),
  }), [columns.widths]);
  const sortedSpans = useMemo(() => [...spans].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'status':
        comparison = liveStatusRank(a) - liveStatusRank(b);
        break;
      case 'service':
        comparison = (a.serviceName || '').localeCompare(b.serviceName || '');
        break;
      case 'operation':
        comparison = routeLabel(a).localeCompare(routeLabel(b));
        break;
      case 'kind':
        comparison = (a.kind || '').localeCompare(b.kind || '');
        break;
      case 'namespace':
        comparison = (a.namespace || '').localeCompare(b.namespace || '');
        break;
      case 'latency':
        comparison = (a.durationMs || 0) - (b.durationMs || 0);
        break;
      case 'time':
        comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        break;
    }
    return sortDir === 'asc' ? comparison : -comparison;
  }), [sortDir, sortField, spans]);

  const setSort = (field: LiveSortField) => {
    if (field === sortField) {
      setSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDir(['service', 'operation', 'kind', 'namespace'].includes(field) ? 'asc' : 'desc');
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: LiveColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    columns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const headerProps = {
    activeSort: sortField,
    direction: sortDir,
    onSort: setSort,
    onResize: columns.startResize,
    onResizeKey: resizeWithKeyboard,
    onReset: columns.resetWidths,
  };

  return (
    <div className="live-table-wrap">
      <StandardTableToolbar
        title={t('Live spans')}
        count={`${sortedSpans.length} ${t('results')}`}
        onReset={columns.resetWidths}
        resetLabel={t('Reset columns')}
        resizeHint={t('Drag column edges to resize')}
      />
      <div className="live-table-row live-table-head" style={gridStyle} role="row">
        <StandardColumnHeader column="status" label={t('Status')} sortField="status" {...headerProps} />
        <StandardColumnHeader column="service" label={t('Service')} sortField="service" {...headerProps} />
        <StandardColumnHeader column="operation" label={t('Operation')} sortField="operation" {...headerProps} />
        <StandardColumnHeader column="kind" label={t('Kind')} sortField="kind" {...headerProps} />
        <StandardColumnHeader column="namespace" label={t('Namespace')} sortField="namespace" {...headerProps} />
        <StandardColumnHeader column="latency" label={t('Latency')} sortField="latency" align="right" {...headerProps} />
        <StandardColumnHeader column="time" label={t('Time')} sortField="time" {...headerProps} />
        <StandardColumnHeader column="actions" label={t('Actions')} isLast {...headerProps} />
      </div>
      {sortedSpans.map(span => (
        <div
          key={span._id}
          className={`live-table-row ${spanTone(span)} ${selectedId === span._id ? 'selected' : ''}`}
          style={gridStyle}
          role="row"
          onClick={() => onSelect(span._id)}
        >
          <span className={`live-span-status ${isSpanError(span) ? 'error' : spanTone(span) === 'slow' ? 'slow' : 'ok'}`}>{isSpanError(span) ? 'ERR' : spanTone(span) === 'slow' ? 'SLOW' : 'OK'}</span>
          <span className="live-table-service">{span.serviceName || t('unknown')}</span>
          <span className="live-table-operation" title={span.name}>{routeLabel(span)}</span>
          <span>{span.kind}</span>
          <span>{span.namespace || t('default')}</span>
          <span className="live-table-latency">{formatDuration(span.durationMs)}</span>
          <span>{formatTime(span.startTime)}</span>
          <button
            type="button"
            className="live-table-open"
            title={t('Open trace')}
            aria-label={t('Open trace')}
            onClick={(event) => { event.stopPropagation(); onOpenTrace(span.traceId); }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M7 5h8v8" />
              <path d="m15 5-9 9" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function liveStatusRank(span: LiveSpan): number {
  if (isSpanError(span)) return 3;
  if (spanTone(span) === 'slow') return 2;
  return 1;
}

function TraceList({
  traces,
  onSelectSpan,
  onOpenTrace,
  t
}: {
  traces: TraceSummary[];
  onSelectSpan: (id: string) => void;
  onOpenTrace: (traceId: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="live-trace-list">
      {traces.map(trace => (
        <article key={trace.traceId} className={`live-trace-row ${trace.hasError ? 'error' : 'ok'}`} onClick={() => onSelectSpan(trace.spans[0]._id)}>
          <div className="live-trace-main">
            <span className={`live-span-status ${trace.hasError ? 'error' : 'ok'}`}>{trace.hasError ? 'ERR' : 'OK'}</span>
            <div>
              <strong title={trace.rootName}>{trace.rootName}</strong>
              <span>{trace.services.slice(0, 4).join(' -> ') || t('unknown')}</span>
            </div>
          </div>
          <div className="live-trace-stats">
            <MetricPair label={t('Spans')} value={String(trace.spans.length)} />
            <MetricPair label={t('Services')} value={String(trace.services.length)} />
            <MetricPair label={t('Latency')} value={formatDuration(trace.maxDuration)} />
            <MetricPair label={t('Seen')} value={formatAge(trace.lastSeen)} />
          </div>
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenTrace(trace.traceId); }}>{t('Open trace')}</button>
        </article>
      ))}
    </div>
  );
}

function SpanInspector({ span, onOpenTrace, t }: { span: LiveSpan; onOpenTrace: () => void; t: (key: string) => string }) {
  const attributes = Object.entries(span.attributes || {}).slice(0, 10);
  return (
    <div className="live-inspector-body">
      <div className="live-inspector-title">
        <strong title={span.name}>{routeLabel(span)}</strong>
        <span>{span.serviceName}</span>
      </div>
      <div className="live-inspector-grid">
        <MetricPair label={t('Latency')} value={formatDuration(span.durationMs)} />
        <MetricPair label={t('Kind')} value={span.kind || 'SPAN'} />
        <MetricPair label={t('Namespace')} value={span.namespace || t('default')} />
        <MetricPair label={t('Started')} value={formatTime(span.startTime)} />
      </div>
      <div className="live-id-stack">
        <CopyLine label={t('Trace ID')} value={span.traceId} />
        <CopyLine label={t('Span ID')} value={span.spanId} />
        {span.podName && <CopyLine label={t('Pod')} value={span.podName} />}
        {span.nodeName && <CopyLine label={t('Node')} value={span.nodeName} />}
      </div>
      {span.error && <div className="live-error-box">{span.error}</div>}
      {attributes.length > 0 && (
        <div className="live-attribute-list">
          <strong>{t('Attributes')}</strong>
          {attributes.map(([key, value]) => (
            <span key={key}>
              <em title={key}>{key}</em>
              <code title={String(value)}>{String(value)}</code>
            </span>
          ))}
        </div>
      )}
      <button type="button" className="live-open-trace" onClick={onOpenTrace}>{t('Open trace')}</button>
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <em>{label}</em>
      <code title={value}>{value}</code>
    </span>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function EmptyState({ connected, t }: { connected: boolean; t: (key: string) => string }) {
  return (
    <div className="live-empty-state">
      <div className="live-empty-icon">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      </div>
      <strong>{connected ? t('Waiting for spans') : t('Connecting')}</strong>
    </div>
  );
}

function spanTone(span: Span): 'error' | 'slow' | 'ok' {
  if (isSpanError(span)) return 'error';
  if ((span.durationMs || 0) >= slowMs) return 'slow';
  return 'ok';
}

function spanStatusLabel(span: Span): string {
  if (isSpanError(span)) return 'ERROR';
  const status = String(span.status || '').trim().toUpperCase();
  return status && status !== 'UNSET' ? status : 'OK';
}

function routeLabel(span: Span): string {
  const attrs = span.attributes || {};
  const method = attrs['http.method'] || attrs['http.request.method'];
  const route = attrs['http.route'] || attrs['url.path'] || attrs['http.target'];
  if (method && route) return `${method} ${route}`;
  return span.name || span.spanId;
}

function buildVolumeBuckets(spans: LiveSpan[]) {
  const bucketCount = 24;
  const bucketMs = 5000;
  const now = Date.now();
  const buckets = Array.from({ length: bucketCount }, () => ({ count: 0, errors: 0, height: 0 }));

  for (const span of spans) {
    const age = now - (span._receivedAt || Date.parse(span.startTime) || now);
    const index = bucketCount - 1 - Math.floor(age / bucketMs);
    if (index < 0 || index >= bucketCount) continue;
    buckets[index].count += 1;
    if (isSpanError(span)) buckets[index].errors += 1;
  }

  const max = Math.max(1, ...buckets.map(bucket => bucket.count));
  return buckets.map(bucket => ({ ...bucket, height: (bucket.count / max) * 100 }));
}

function serviceBreakdown(spans: LiveSpan[]) {
  const counts = new Map<string, { service: string; count: number; errors: number }>();
  for (const span of spans) {
    const key = span.serviceName || 'unknown';
    const current = counts.get(key) || { service: key, count: 0, errors: 0 };
    current.count += 1;
    if (isSpanError(span)) current.errors += 1;
    counts.set(key, current);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 6);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString();
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function shortId(value: string): string {
  if (!value) return '';
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
