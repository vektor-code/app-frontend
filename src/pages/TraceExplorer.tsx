import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GitBranch,
  GripVertical,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api/client';
import type { EndpointStat, TraceListItem } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import LanguageIcon from '../components/LanguageIcon';
import IconPack from '../components/IconPack';
import { useTranslation } from '../utils/i18n';
import { useColumnResize } from '../utils/useColumnResize';

interface TraceExplorerProps {
  namespace: string;
  cluster: string;
}

type TraceTab = 'top' | 'explorer';
type EndpointSort = 'impact' | 'latency' | 'throughput' | 'errors' | 'name';
type TraceSort = 'time' | 'duration' | 'spans' | 'errors' | 'service';
type Tone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';
type SortDir = 'asc' | 'desc';
type EndpointColumn = 'transaction' | 'latency' | 'throughput' | 'errors' | 'impact';
type TraceColumn = 'trace' | 'status' | 'flow' | 'duration' | 'spans';

const endpointColumnWidths: Record<EndpointColumn, number> = {
  transaction: 340,
  latency: 180,
  throughput: 215,
  errors: 175,
  impact: 190,
};

const endpointColumnMinimums: Record<EndpointColumn, number> = {
  transaction: 260,
  latency: 145,
  throughput: 170,
  errors: 140,
  impact: 155,
};

const traceColumnWidths: Record<TraceColumn, number> = {
  trace: 340,
  status: 130,
  flow: 280,
  duration: 200,
  spans: 145,
};

const traceColumnMinimums: Record<TraceColumn, number> = {
  trace: 260,
  status: 110,
  flow: 210,
  duration: 165,
  spans: 120,
};

const endpointColumnOrder: EndpointColumn[] = ['transaction', 'latency', 'throughput', 'errors', 'impact'];
const traceColumnOrder: TraceColumn[] = ['trace', 'status', 'flow', 'duration', 'spans'];

const serviceColors: Record<string, string> = {};
const colorPalette = [
  '#2563eb', '#7c3aed', '#db2777', '#e11d48', '#ea580c',
  '#ca8a04', '#059669', '#0f766e', '#0891b2', '#4f46e5',
];

const TRACE_DRAWER_ICONS = {
  duration: '/observability-icons/clock-bolt.svg',
  spans: '/observability-icons/route.svg',
  status: '/observability-icons/shield-check.svg',
  services: '/observability-icons/sitemap.svg',
  alert: '/observability-icons/alert-triangle.svg'
} as const;

export default function TraceExplorer({ namespace, cluster }: TraceExplorerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TraceTab>('top');
  const [sortBy, setSortBy] = useState<EndpointSort | TraceSort>('impact');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [serviceLanguages, setServiceLanguages] = useState<Record<string, string>>({});
  const [selectedTrace, setSelectedTrace] = useState<TraceListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const endpointColumns = useColumnResize(endpointColumnWidths, {
    minWidths: endpointColumnMinimums,
    storageKey: 'traceEndpointColumnsV1',
  });
  const traceColumns = useColumnResize(traceColumnWidths, {
    minWidths: traceColumnMinimums,
    storageKey: 'traceExplorerColumnsV1',
  });

  const endpointGridStyle = useMemo(() => ({
    gridTemplateColumns: endpointColumnOrder
      .map(column => `minmax(${endpointColumnMinimums[column]}px, ${endpointColumns.widths[column]}fr)`)
      .join(' '),
  }) as CSSProperties, [endpointColumns.widths]);

  const traceGridStyle = useMemo(() => ({
    gridTemplateColumns: traceColumnOrder
      .map(column => `minmax(${traceColumnMinimums[column]}px, ${traceColumns.widths[column]}fr)`)
      .join(' '),
  }) as CSSProperties, [traceColumns.widths]);

  const serviceFilter = searchParams.get('service') || '';
  const errorFilter = searchParams.get('hasError') || '';
  const operationFilter = searchParams.get('operation') || '';
  const traceIdFilter = searchParams.get('traceId') || '';
  const minSpans = searchParams.get('minSpans') || '0';
  const minDuration = searchParams.get('minDuration') || '';
  const maxDuration = searchParams.get('maxDuration') || '';
  const timeRangeFilter = searchParams.get('timeRange') || '24h';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '25', 10);

  const setFilterVal = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      if (key !== 'page' && key !== 'pageSize') {
        next.set('page', '1');
      }
      return next;
    }, { replace: true });
  };

  const setFilterVals = (values: Record<string, string>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(values).forEach(([key, value]) => {
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
      });
      next.set('page', '1');
      return next;
    }, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams();
    next.set('timeRange', '24h');
    next.set('minSpans', '0');
    next.set('page', '1');
    next.set('pageSize', pageSize.toString());
    setSearchParams(next, { replace: true });
  };

  const setPageSize = (size: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('pageSize', size.toString());
      next.set('page', '1');
      return next;
    }, { replace: true });
  };

  const setPage = (nextPage: number) => {
    setFilterVal('page', Math.max(1, nextPage).toString());
  };

  const loadTraces = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const params: Record<string, string> = {};
      if (namespace) params.namespace = namespace;
      if (cluster) params.cluster = cluster;
      if (serviceFilter) params.service = serviceFilter;
      if (errorFilter) params.hasError = errorFilter;
      if (operationFilter) params.operation = operationFilter;
      if (traceIdFilter) params.traceId = traceIdFilter;
      if (minSpans && parseInt(minSpans, 10) > 0) params.minSpans = minSpans;
      if (minDuration && parseFloat(minDuration) > 0) params.minDuration = minDuration;
      if (maxDuration && parseFloat(maxDuration) > 0) params.maxDuration = maxDuration;
      params.startTime = getStartTimeISO(timeRangeFilter);

      if (activeTab === 'top') {
        params.limit = '500';
        const data = await api.getTopEndpoints(params);
        setEndpoints(data.endpoints || []);
      } else {
        params.limit = pageSize.toString();
        params.offset = ((page - 1) * pageSize).toString();
        const data = await api.getTraces(params);
        setTraces(data.traces || []);
      }
    } catch (err) {
      console.error('load traces:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [namespace, cluster, serviceFilter, errorFilter, operationFilter, traceIdFilter, minSpans, minDuration, maxDuration, timeRangeFilter, page, pageSize, activeTab]);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    const interval = setInterval(loadTraces, 5000);
    return () => clearInterval(interval);
  }, [loadTraces]);

  useEffect(() => {
    api.getServices(namespace || undefined).then(data => {
      const serviceNames = (data.services || []).map(service => service.serviceName);
      setServices([...new Set(serviceNames)].sort((a, b) => a.localeCompare(b)));

      const languages: Record<string, string> = {};
      (data.services || []).forEach(service => {
        if (service.language) {
          // Key by namespace:serviceName so the same service name in different
          // namespaces keeps its own stack (no icon flicker). Keep a bare-name
          // fallback for lookups that have no namespace.
          languages[`${service.namespace}:${service.serviceName}`] = service.language;
          if (!languages[service.serviceName]) {
            languages[service.serviceName] = service.language;
          }
        }
      });
      setServiceLanguages(languages);
    }).catch(() => {});
  }, [namespace]);

  useEffect(() => {
    setSortBy(activeTab === 'top' ? 'impact' : 'time');
    setSortDir('desc');
    setFilterVal('page', '1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const topTraces = useMemo(() => {
    const windowMinutes = getWindowMinutes(timeRangeFilter);
    const list = endpoints.map(endpoint => {
      const errorRate = endpoint.count > 0 ? (endpoint.errorCount / endpoint.count) * 100 : 0;
      return {
        operationName: endpoint.operationName || '-',
        serviceName: endpoint.serviceName,
        namespace: endpoint.namespace,
        avgDurationMs: endpoint.avgDurationMs,
        p95DurationMs: endpoint.p95DurationMs,
        count: endpoint.count,
        errorCount: endpoint.errorCount,
        sampledCount: endpoint.sampledCount ?? endpoint.count,
        estimated: (endpoint.sampledCount ?? endpoint.count) < endpoint.count,
        errorRate,
        tpm: windowMinutes > 0 ? endpoint.count / windowMinutes : 0,
        impact: endpoint.avgDurationMs * endpoint.count,
      };
    });

    let comparator: (a: typeof list[number], b: typeof list[number]) => number;
    switch (sortBy) {
      case 'latency':
        comparator = (a, b) => a.avgDurationMs - b.avgDurationMs;
        break;
      case 'throughput':
        comparator = (a, b) => a.count - b.count;
        break;
      case 'errors':
        comparator = (a, b) => a.errorRate - b.errorRate;
        break;
      case 'name':
        comparator = (a, b) => a.operationName.localeCompare(b.operationName);
        break;
      case 'impact':
      default:
        comparator = (a, b) => a.impact - b.impact;
    }
    list.sort((a, b) => (sortDir === 'asc' ? comparator(a, b) : -comparator(a, b)));
    return list;
  }, [endpoints, sortBy, sortDir, timeRangeFilter]);

  const sortedTraces = useMemo(() => {
    const list = [...traces];
    let comparator: (a: TraceListItem, b: TraceListItem) => number;
    switch (sortBy) {
      case 'duration':
        comparator = (a, b) => a.durationMs - b.durationMs;
        break;
      case 'spans':
        comparator = (a, b) => a.spanCount - b.spanCount;
        break;
      case 'errors':
        comparator = (a, b) => Number(a.hasError) - Number(b.hasError);
        break;
      case 'service':
        comparator = (a, b) => {
          const aFlow = (a.serviceFlow?.length ? a.serviceFlow : a.services) || [a.serviceName];
          const bFlow = (b.serviceFlow?.length ? b.serviceFlow : b.services) || [b.serviceName];
          return aFlow.join(' / ').localeCompare(bFlow.join(' / '));
        };
        break;
      case 'time':
      default:
        comparator = (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    }
    list.sort((a, b) => (sortDir === 'asc' ? comparator(a, b) : -comparator(a, b)));
    return list;
  }, [traces, sortBy, sortDir]);

  const topTotalPages = Math.max(1, Math.ceil(topTraces.length / pageSize));
  const topPage = Math.min(page, topTotalPages);
  const pagedTopTraces = topTraces.slice((topPage - 1) * pageSize, topPage * pageSize);
  const totalImpact = topTraces.reduce((sum, item) => sum + item.impact, 0);
  const maxTraceDuration = Math.max(...sortedTraces.map(trace => trace.durationMs), 1);

  const summary = useMemo(() => {
    if (activeTab === 'top') {
      const count = topTraces.reduce((sum, item) => sum + item.count, 0);
      const errors = topTraces.reduce((sum, item) => sum + item.errorCount, 0);
      const avgLatency = weightedBy(topTraces, item => item.avgDurationMs, item => item.count);
      return {
        primaryCount: topTraces.length,
        count,
        errors,
        errorRate: count > 0 ? (errors / count) * 100 : 0,
        avgLatency,
      };
    }

    const count = sortedTraces.length;
    const errors = sortedTraces.filter(trace => trace.hasError).length;
    const avgLatency = count > 0 ? sortedTraces.reduce((sum, trace) => sum + trace.durationMs, 0) / count : 0;
    return {
      primaryCount: count,
      count,
      errors,
      errorRate: count > 0 ? (errors / count) * 100 : 0,
      avgLatency,
    };
  }, [activeTab, topTraces, sortedTraces]);

  const filterCount = [
    serviceFilter,
    errorFilter,
    operationFilter,
    traceIdFilter,
    minDuration,
    maxDuration,
    minSpans !== '0' ? minSpans : '',
    timeRangeFilter !== '24h' ? timeRangeFilter : '',
  ].filter(Boolean).length;

  const sortOptions = activeTab === 'top'
    ? [
        { value: 'impact', label: t('Impact') },
        { value: 'latency', label: t('Latency') },
        { value: 'throughput', label: t('Throughput') },
        { value: 'errors', label: t('Errors') },
        { value: 'name', label: t('Name') },
      ]
    : [
        { value: 'time', label: t('Newest') },
        { value: 'duration', label: t('Duration') },
        { value: 'spans', label: t('Spans') },
        { value: 'errors', label: t('Errors first') },
        { value: 'service', label: t('Service flow') },
      ];

  const setTableSort = (field: EndpointSort | TraceSort) => {
    if (field === sortBy) {
      setSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortBy(field);
    setSortDir(field === 'name' || field === 'service' ? 'asc' : 'desc');
  };

  const resizeEndpointWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: EndpointColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    endpointColumns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const resizeTraceWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: TraceColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    traceColumns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  return (
    <div className="traces-page apm-dashboard animate-fade-in">
      <section className="apm-dashboard-header traces-dashboard-header">
        <div className="apm-title-block">
          <span className="apm-title-icon traces-title-icon">
            <GitBranch size={20} />
          </span>
          <h1>{t('Traces')}</h1>
        </div>
        <div className="traces-header-actions">
          <MetricBox label={activeTab === 'top' ? t('Endpoints') : t('Traces')} value={formatCompact(summary.primaryCount)} />
          <MetricBox label={t('Volume')} value={formatCompact(summary.count)} />
          <MetricBox label={t('Errors')} value={formatPercent(summary.errorRate)} tone={summary.errorRate > 5 ? 'critical' : summary.errorRate > 0 ? 'warning' : 'neutral'} />
          <MetricBox label={t('Avg latency')} value={formatDuration(summary.avgLatency)} tone={summary.avgLatency > 1000 ? 'warning' : 'neutral'} />
        </div>
      </section>

      <section className="traces-toolbar">
        <div className="traces-tabs">
          <button className={activeTab === 'top' ? 'active' : ''} onClick={() => setActiveTab('top')} type="button">{t('Top transactions')}</button>
          <button className={activeTab === 'explorer' ? 'active' : ''} onClick={() => setActiveTab('explorer')} type="button">{t('Explorer')}</button>
        </div>
        <div className="traces-toolbar-actions">
          <label>
            <span>{t('Sort')}</span>
            <CustomSelect
              className="trace-sort-select"
              ariaLabel={t('Sort')}
              value={sortBy}
              onChange={value => {
                setSortBy(value as EndpointSort | TraceSort);
                setSortDir(value === 'name' ? 'asc' : 'desc');
              }}
              options={sortOptions}
            />
          </label>
          <button type="button" className="traces-refresh-btn" onClick={loadTraces}>
            <RefreshCw size={13} />
            {t('Refresh')}
          </button>
        </div>
      </section>

      <section className="traces-filter-panel">
        <FilterSelect label={t('Window')} value={timeRangeFilter} onChange={value => setFilterVal('timeRange', value)} options={[
          { value: '15m', label: t('15m') },
          { value: '1h', label: t('1h') },
          { value: '24h', label: t('24h') },
          { value: '7d', label: t('7d') },
          { value: '30d', label: t('30d') },
          { value: '90d', label: t('90d') },
          { value: 'all', label: t('All') },
        ]} />
        <FilterSelect label={t('Service')} value={serviceFilter} onChange={value => setFilterVal('service', value)} options={[
          { value: '', label: t('All services') },
          ...services.map(service => ({ value: service, label: service })),
        ]} />
        <FilterSelect label={t('Status')} value={errorFilter} onChange={value => setFilterVal('hasError', value)} options={[
          { value: '', label: t('All status') },
          { value: 'true', label: t('Errors') },
          { value: 'false', label: t('OK') },
        ]} />
        <FilterSelect label={t('Min spans')} value={minSpans} onChange={value => setFilterVal('minSpans', value)} options={[
          { value: '0', label: t('All') },
          { value: '2', label: t('2+') },
          { value: '3', label: t('3+') },
          { value: '5', label: t('5+') },
          { value: '10', label: t('10+') },
        ]} />
        <FilterInput label={t('Operation')} value={operationFilter} onChange={value => setFilterVal('operation', value)} placeholder="GET /orders" />
        <FilterInput label={t('Trace ID')} value={traceIdFilter} onChange={value => setFilterVal('traceId', value)} placeholder="trace id" />
        <FilterInput label={t('Min ms')} type="number" value={minDuration} onChange={value => setFilterVal('minDuration', value)} placeholder="0" />
        <FilterInput label={t('Max ms')} type="number" value={maxDuration} onChange={value => setFilterVal('maxDuration', value)} placeholder="0" />
        <button type="button" className="traces-clear-btn" onClick={clearFilters}>
          {filterCount > 0 ? `${t('Clear')} (${filterCount})` : t('Clear')}
        </button>
      </section>

      {activeTab === 'top' ? (
        <section className="trace-results-panel">
          <ResultsHeader
            title={t('Top transactions')}
            count={topTraces.length}
            pageSize={pageSize}
            setPageSize={setPageSize}
            onResetColumns={endpointColumns.resetWidths}
          />
          {loading && topTraces.length === 0 ? (
            <LoadingState height={320} label={t('Loading top transactions...')} />
          ) : loadError ? (
            <NoDataState height={320} title={t('Could not load traces')} hint={t('Retry when the API is reachable.')} />
          ) : pagedTopTraces.length === 0 ? (
            <NoDataState height={320} title={t('No trace endpoints found')} hint={t('Adjust filters or wait for telemetry.')} />
          ) : (
            <div className="trace-table-scroller">
              <div className="trace-table-head endpoint-table-head" style={endpointGridStyle} role="row">
                <TraceColumnHeader column="transaction" label={t('Transaction')} field="name" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={endpointColumns.startResize} onResizeKey={resizeEndpointWithKeyboard} onReset={endpointColumns.resetWidths} />
                <TraceColumnHeader column="latency" label={t('Latency')} field="latency" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={endpointColumns.startResize} onResizeKey={resizeEndpointWithKeyboard} onReset={endpointColumns.resetWidths} />
                <TraceColumnHeader column="throughput" label={t('Throughput')} field="throughput" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={endpointColumns.startResize} onResizeKey={resizeEndpointWithKeyboard} onReset={endpointColumns.resetWidths} />
                <TraceColumnHeader column="errors" label={t('Errors')} field="errors" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={endpointColumns.startResize} onResizeKey={resizeEndpointWithKeyboard} onReset={endpointColumns.resetWidths} />
                <TraceColumnHeader column="impact" label={t('Impact')} field="impact" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={endpointColumns.startResize} onResizeKey={resizeEndpointWithKeyboard} onReset={endpointColumns.resetWidths} isLast />
              </div>
              <div className="endpoint-list">
                {pagedTopTraces.map(item => (
                  <EndpointRow
                    key={`${item.namespace}:${item.serviceName}:${item.operationName}`}
                    item={item}
                    totalImpact={totalImpact}
                    language={serviceLanguages[`${item.namespace}:${item.serviceName}`] || serviceLanguages[item.serviceName]}
                    gridStyle={endpointGridStyle}
                    onService={() => {
                      setFilterVal('service', item.serviceName);
                      setActiveTab('explorer');
                    }}
                    onOperation={() => {
                      setFilterVals({
                        service: item.serviceName,
                        operation: item.operationName === '-' ? '' : item.operationName,
                      });
                      setActiveTab('explorer');
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {topTraces.length > 0 && <Pagination page={topPage} totalPages={topTotalPages} onPage={setPage} />}
        </section>
      ) : (
        <section className="trace-results-panel">
          <ResultsHeader
            title={t('Trace explorer')}
            count={traces.length}
            pageSize={pageSize}
            setPageSize={setPageSize}
            onResetColumns={traceColumns.resetWidths}
          />
          {loading && sortedTraces.length === 0 ? (
            <LoadingState height={320} label={t('Searching traces...')} />
          ) : loadError ? (
            <NoDataState height={320} title={t('Could not load traces')} hint={t('Retry when the API is reachable.')} />
          ) : sortedTraces.length === 0 ? (
            <NoDataState height={320} title={t('No traces found')} hint={t('Adjust filters or wait for new traces.')} />
          ) : (
            <div className="trace-table-scroller">
              <div className="trace-table-head trace-explorer-table-head" style={traceGridStyle} role="row">
                <TraceColumnHeader column="trace" label={t('Trace')} field="time" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={traceColumns.startResize} onResizeKey={resizeTraceWithKeyboard} onReset={traceColumns.resetWidths} />
                <TraceColumnHeader column="status" label={t('Status')} field="errors" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={traceColumns.startResize} onResizeKey={resizeTraceWithKeyboard} onReset={traceColumns.resetWidths} />
                <TraceColumnHeader column="flow" label={t('Service flow')} field="service" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={traceColumns.startResize} onResizeKey={resizeTraceWithKeyboard} onReset={traceColumns.resetWidths} />
                <TraceColumnHeader column="duration" label={t('Duration')} field="duration" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={traceColumns.startResize} onResizeKey={resizeTraceWithKeyboard} onReset={traceColumns.resetWidths} />
                <TraceColumnHeader column="spans" label={t('Spans')} field="spans" activeSort={sortBy} dir={sortDir} onSort={setTableSort} onResize={traceColumns.startResize} onResizeKey={resizeTraceWithKeyboard} onReset={traceColumns.resetWidths} isLast />
              </div>
              <div className="trace-list">
                {sortedTraces.map(trace => (
                  <TraceRow
                    key={trace.traceId}
                    trace={trace}
                    maxDuration={maxTraceDuration}
                    language={(serviceLanguages[`${trace.namespace}:${trace.serviceName}`] || serviceLanguages[trace.serviceName])}
                    gridStyle={traceGridStyle}
                    onClick={() => setSelectedTrace(trace)}
                  />
                ))}
              </div>
            </div>
          )}
          {sortedTraces.length > 0 && <Pagination page={page} hasNext={traces.length >= pageSize} onPage={setPage} />}
        </section>
      )}

      {selectedTrace && (
        <TraceQuickLook
          trace={selectedTrace}
          serviceLanguages={serviceLanguages}
          onClose={() => setSelectedTrace(null)}
          onOpenFull={() => {
            const id = selectedTrace.traceId;
            setSelectedTrace(null);
            navigate(`/traces/${id}`);
          }}
        />
      )}
    </div>
  );
}

function EndpointRow({
  item,
  totalImpact,
  language,
  gridStyle,
  onService,
  onOperation,
}: {
  item: {
    operationName: string;
    serviceName: string;
    namespace?: string;
    avgDurationMs: number;
    p95DurationMs: number;
    count: number;
    errorCount: number;
    sampledCount: number;
    estimated: boolean;
    errorRate: number;
    tpm: number;
    impact: number;
  };
  totalImpact: number;
  language?: string;
  gridStyle: CSSProperties;
  onService: () => void;
  onOperation: () => void;
}) {
  const errorTone = item.errorRate > 5 ? 'critical' : item.errorRate > 0 ? 'warning' : 'healthy';
  const latencyTone = item.avgDurationMs > 1000 ? 'warning' : 'neutral';
  const impactShare = totalImpact > 0 ? (item.impact / totalImpact) * 100 : 0;
  const impactTone = errorTone === 'critical' ? 'critical' : impactShare >= 25 || latencyTone === 'warning' ? 'warning' : 'neutral';

  const rowStatus = item.errorRate > 0 ? 'is-error' : item.avgDurationMs > 1000 ? 'is-slow' : '';

  return (
    <div className={`endpoint-row row-status ${rowStatus}`} style={gridStyle}>
      <div className="endpoint-main">
        <button type="button" className="endpoint-name" onClick={onOperation}>{item.operationName}</button>
        <button type="button" className="endpoint-service" onClick={onService}>
          <LanguageIcon language={language} size={18} />
          <span>{item.serviceName}</span>
          {item.namespace && <em className="endpoint-namespace">{item.namespace}</em>}
        </button>
      </div>
      <TraceMetric label="Avg latency" value={formatDuration(item.avgDurationMs)} detail={`P95 ${formatDuration(item.p95DurationMs)}`} tone={latencyTone} />
      <TraceMetric
        label="Throughput"
        value={`${item.estimated ? '~' : ''}${formatNumber(item.tpm)} tpm`}
        detail={item.estimated
          ? `~${formatCompact(item.count)} traces (${formatCompact(item.sampledCount)} sampled)`
          : `${formatCompact(item.count)} traces`}
        tone="neutral"
      />
      <TraceMetric label="Errors" value={formatPercent(item.errorRate)} detail={`${formatCompact(item.errorCount)} failed`} tone={errorTone} />
      <div
        className={`endpoint-impact ${impactTone}`}
        style={{ '--endpoint-impact-share': `${Math.min(100, Math.max(0, impactShare))}%` } as React.CSSProperties}
      >
        <span className="endpoint-impact-ring" aria-hidden="true" />
        <div>
          <span>Impact share</span>
          <strong>{formatShare(impactShare)}</strong>
          <em>{formatTotalDuration(item.impact)} total</em>
        </div>
      </div>
    </div>
  );
}

function TraceRow({
  trace,
  maxDuration,
  language,
  gridStyle,
  onClick,
}: {
  trace: TraceListItem;
  maxDuration: number;
  language?: string;
  gridStyle: CSSProperties;
  onClick: () => void;
}) {
  const flow = trace.serviceFlow && trace.serviceFlow.length > 0 ? trace.serviceFlow : (trace.services || []);
  const durationPct = Math.min(100, (trace.durationMs / Math.max(maxDuration, 1)) * 100);
  const latencyTone = trace.hasError ? 'critical' : trace.durationMs > 1000 ? 'warning' : 'neutral';

  // Failure outranks slowness: a trace that errored is marked as an error even
  // if it was also slow.
  const rowStatus = trace.hasError ? 'is-error' : trace.durationMs > 1000 ? 'is-slow' : '';

  return (
    <button type="button" className={`trace-row row-status ${rowStatus}`} style={gridStyle} onClick={onClick}>
      <div className="trace-main">
        <div className="trace-title-line">
          <LanguageIcon language={language} size={18} />
          <strong>{trace.rootName || trace.serviceName}</strong>
        </div>
        <div className="trace-subline">
          <span>{trace.serviceName}</span>
          <em>{formatTime(trace.startTime)}</em>
          <code>{shortTraceId(trace.traceId)}</code>
        </div>
        {trace.hasError && trace.errorSummary && (
          <div className="trace-error-line">
            <span>{trace.errorType || 'error'}</span>
            <em>{trace.errorSummary}</em>
          </div>
        )}
      </div>

      <div className="trace-status-cell">
        <span className={`trace-status ${trace.hasError ? 'critical' : 'healthy'}`}>
          <i />
          {trace.hasError ? 'Error' : 'Successful'}
        </span>
        <em>{trace.partial ? 'Partial trace' : 'Complete trace'}</em>
      </div>

      <div className="trace-flow">
        {flow.slice(0, 5).map((service, idx) => (
          <React.Fragment key={`${service}:${idx}`}>
            {idx > 0 && <span className="trace-flow-arrow">{'->'}</span>}
            <em style={{ color: getServiceColor(service), background: `${getServiceColor(service)}18` }}>{shortName(service)}</em>
          </React.Fragment>
        ))}
        {flow.length > 5 && <strong>+{flow.length - 5}</strong>}
        {(trace.thirdPartyTools || []).slice(0, 2).map(tool => (
          <React.Fragment key={tool}>
            <span className="trace-flow-arrow">{'->'}</span>
            <em className="external">{shortName(tool)}</em>
          </React.Fragment>
        ))}
      </div>

      <div className="trace-duration">
        <div>
          <span>Duration</span>
          <strong className={latencyTone}>{formatDuration(trace.durationMs)}</strong>
        </div>
        <div className="trace-duration-bar">
          <i className={latencyTone} style={{ width: `${Math.max(2, durationPct)}%` }} />
        </div>
      </div>

      <TraceMetric label="Spans" value={trace.spanCount.toString()} detail={formatNamespace(trace)} tone="neutral" />
      <ArrowRight className="trace-row-arrow" size={16} aria-hidden="true" />
    </button>
  );
}

function TraceQuickLook({
  trace,
  serviceLanguages,
  onClose,
  onOpenFull,
}: {
  trace: TraceListItem;
  serviceLanguages: Record<string, string>;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { t } = useTranslation();
  const flow = trace.serviceFlow && trace.serviceFlow.length > 0 ? trace.serviceFlow : (trace.services || []);
  const title = trace.rootName || trace.serviceName;
  const statusTone: Tone = trace.hasError ? 'critical' : 'healthy';
  const statusText = trace.hasError ? t('Error') : t('Operational');
  const serviceCount = new Set([trace.serviceName, ...flow].filter(Boolean)).size;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop trace-drawer-backdrop" onClick={onClose}>
      <aside className={`trace-quicklook ${statusTone}`} onClick={event => event.stopPropagation()}>
        <header className="trace-quicklook-header">
          <div className="trace-quicklook-title">
            <span className="trace-quicklook-kicker">{t('Trace detail')}</span>
            <h2>
              <LanguageIcon language={(serviceLanguages[`${trace.namespace}:${trace.serviceName}`] || serviceLanguages[trace.serviceName])} size={24} />
              <span>{title}</span>
            </h2>
            <div className="trace-quicklook-id">
              <code>{trace.traceId}</code>
              <span className={`trace-status ${statusTone}`}>{statusText}</span>
            </div>
          </div>
          <button className="modal-close trace-drawer-close" onClick={onClose}>x</button>
        </header>

        <div className="trace-quicklook-body">
          <div className="trace-quicklook-grid">
            <TraceDrawerMetric
              icon="duration"
              label={t('Duration')}
              value={formatDuration(trace.durationMs)}
              detail={formatTime(trace.startTime)}
              tone={trace.durationMs > 1000 ? 'warning' : 'neutral'}
            />
            <TraceDrawerMetric
              icon="spans"
              label={t('Spans')}
              value={trace.spanCount.toString()}
              detail={formatNamespace(trace)}
              tone="neutral"
            />
            <TraceDrawerMetric
              icon={trace.hasError ? 'alert' : 'status'}
              label={t('Status')}
              value={statusText}
              detail={trace.serviceName}
              tone={statusTone}
            />
            <TraceDrawerMetric
              icon="services"
              label={t('Services')}
              value={serviceCount.toString()}
              detail={formatNamespace(trace)}
              tone="info"
            />
          </div>

          <section className="trace-quicklook-section trace-quicklook-meta">
            <span>{t('Metadata')}</span>
            <div>
              <dl>
                <dt>{t('Root service')}</dt>
                <dd>{trace.serviceName}</dd>
              </dl>
              <dl>
                <dt>{t('Namespace')}</dt>
                <dd>{formatNamespace(trace)}</dd>
              </dl>
            </div>
          </section>

          {flow.length > 0 && (
            <section className="trace-quicklook-section">
              <span>{t('Request flow')}</span>
              <div className="trace-flow expanded trace-drawer-flow">
                {flow.map((service, idx) => (
                  <React.Fragment key={`${service}:${idx}`}>
                    {idx > 0 && <span className="trace-flow-arrow">{'->'}</span>}
                    <em style={{ color: getServiceColor(service), background: `${getServiceColor(service)}18` }}>{service}</em>
                  </React.Fragment>
                ))}
              </div>
            </section>
          )}

          {trace.hasError && trace.errorSummary && (
            <section className="trace-quicklook-error">
              <IconPack src={TRACE_DRAWER_ICONS.alert} className="trace-drawer-error-icon" />
              <div>
                <strong>{trace.errorType || t('Error')}</strong>
                <span>{trace.errorSummary}</span>
              </div>
            </section>
          )}
        </div>

        <footer className="trace-quicklook-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('Close')}</button>
          <button className="btn btn-primary" onClick={onOpenFull}>{t('View full trace')}</button>
        </footer>
      </aside>
    </div>
  );
}

function TraceDrawerMetric({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: keyof typeof TRACE_DRAWER_ICONS;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  return (
    <div className={`trace-drawer-metric ${tone}`}>
      <IconPack src={TRACE_DRAWER_ICONS[icon]} className="trace-drawer-metric-icon" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function ResultsHeader({
  title,
  count,
  pageSize,
  setPageSize,
  onResetColumns,
}: {
  title: string;
  count: number;
  pageSize: number;
  setPageSize: (size: number) => void;
  onResetColumns: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="trace-results-header">
      <div>
        <h2>{title}</h2>
        <p>{formatCompact(count)} {t('results')}</p>
      </div>
      <div className="trace-results-tools">
        <span className="trace-resize-hint"><GripVertical size={13} /> {t('Drag column edges to resize')}</span>
        <button type="button" className="trace-reset-columns" onClick={onResetColumns}>
          <RotateCcw size={13} />
          {t('Reset columns')}
        </button>
        <label>
          <span>{t('Rows')}</span>
          <CustomSelect
            className="trace-rows-select"
            ariaLabel={t('Rows')}
            value={pageSize.toString()}
            onChange={value => setPageSize(parseInt(value, 10))}
            options={[
              { value: '10', label: '10' },
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
          />
        </label>
      </div>
    </div>
  );
}

function TraceColumnHeader<C extends string>({
  column,
  label,
  field,
  activeSort,
  dir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
  isLast = false,
}: {
  column: C;
  label: string;
  field?: EndpointSort | TraceSort;
  activeSort: EndpointSort | TraceSort;
  dir: SortDir;
  onSort: (field: EndpointSort | TraceSort) => void;
  onResize: (event: React.MouseEvent, column: C) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLButtonElement>, column: C) => void;
  onReset: () => void;
  isLast?: boolean;
}) {
  const active = field === activeSort;

  return (
    <div className={`trace-table-column-head ${active ? 'active' : ''}`} role="columnheader" aria-sort={field ? (active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
      {field ? (
        <button type="button" className="trace-table-column-sort" onClick={() => onSort(field)}>
          {label}
          {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      ) : (
        <span className="trace-table-column-label">{label}</span>
      )}
      {!isLast && (
        <button
          type="button"
          className="trace-column-resizer"
          aria-label={`Resize ${label} column`}
          title="Drag to resize · Arrow keys resize · Double click resets"
          onMouseDown={event => onResize(event, column)}
          onKeyDown={event => onResizeKey(event, column)}
          onDoubleClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onReset();
          }}
        >
          <GripVertical size={13} />
        </button>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, hasNext, onPage }: { page: number; totalPages?: number; hasNext?: boolean; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  const nextDisabled = totalPages ? page >= totalPages : !hasNext;
  return (
    <div className="trace-pagination">
      <span>{totalPages ? `${t('Page')} ${page} / ${totalPages}` : `${t('Page')} ${page}`}</span>
      <div>
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('Prev')}</button>
        <button className="btn btn-ghost btn-sm" disabled={nextDisabled} onClick={() => onPage(page + 1)}>{t('Next')}</button>
      </div>
    </div>
  );
}

function TraceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: Tone }) {
  return (
    <div className={`trace-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function MetricBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className={`trace-metric-box ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="trace-filter-field">
      <span>{label}</span>
      <CustomSelect
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options}
      />
    </label>
  );
}

function FilterInput({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="trace-filter-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function getServiceColor(name: string) {
  if (!serviceColors[name]) {
    serviceColors[name] = colorPalette[Object.keys(serviceColors).length % colorPalette.length];
  }
  return serviceColors[name];
}

function getStartTimeISO(range: string) {
  return new Date(Date.now() - getWindowMinutes(range) * 60 * 1000).toISOString();
}

function getWindowMinutes(range: string) {
  switch (range) {
    case '15m': return 15;
    case '1h': return 60;
    case '24h': return 24 * 60;
    case '7d': return 7 * 24 * 60;
    case '30d': return 30 * 24 * 60;
    case '90d': return 90 * 24 * 60;
    case 'all': return 365 * 24 * 60;
    default: return 24 * 60;
  }
}

function weightedBy<T>(items: T[], getValue: (item: T) => number, getWeight: (item: T) => number) {
  const total = items.reduce((acc, item) => {
    const weight = Math.max(getWeight(item), 0);
    acc.value += getValue(item) * weight;
    acc.weight += weight;
    return acc;
  }, { value: 0, weight: 0 });
  return total.weight > 0 ? total.value / total.weight : 0;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTotalDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 60_000) return formatDuration(ms);
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(ms < 600_000 ? 1 : 0)}m`;
  return `${(ms / 3_600_000).toFixed(ms < 36_000_000 ? 1 : 0)}h`;
}

function formatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(value >= 10 ? 0 : 1);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatShare(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  if (value < 1) return '<1%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function shortTraceId(traceId: string) {
  return traceId.length > 18 ? `${traceId.slice(0, 18)}...` : traceId;
}

function shortName(name: string) {
  return name.length > 18 ? `${name.slice(0, 16)}..` : name;
}

function formatNamespace(trace: TraceListItem) {
  const namespaces = trace.namespaces && trace.namespaces.length > 0 ? trace.namespaces : [trace.namespace].filter(Boolean);
  if (namespaces.length === 0) return '-';
  if (namespaces.length === 1) return namespaces[0];
  return `${namespaces.length} namespaces`;
}
