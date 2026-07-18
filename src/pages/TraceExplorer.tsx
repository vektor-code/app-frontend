import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { EndpointStat, TraceListItem } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import LanguageIcon from '../components/LanguageIcon';
import { useTranslation } from '../utils/i18n';

interface TraceExplorerProps {
  namespace: string;
  cluster: string;
}

type TraceTab = 'top' | 'explorer';
type EndpointSort = 'impact' | 'latency' | 'throughput' | 'errors' | 'name';
type TraceSort = 'time' | 'duration' | 'spans' | 'errors';
type Tone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';

const serviceColors: Record<string, string> = {};
const colorPalette = [
  '#2563eb', '#7c3aed', '#db2777', '#e11d48', '#ea580c',
  '#ca8a04', '#059669', '#0f766e', '#0891b2', '#4f46e5',
];

export default function TraceExplorer({ namespace, cluster }: TraceExplorerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TraceTab>('top');
  const [sortBy, setSortBy] = useState<EndpointSort | TraceSort>('impact');
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [serviceLanguages, setServiceLanguages] = useState<Record<string, string>>({});
  const [selectedTrace, setSelectedTrace] = useState<TraceListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const serviceFilter = searchParams.get('service') || '';
  const errorFilter = searchParams.get('hasError') || '';
  const operationFilter = searchParams.get('operation') || '';
  const traceIdFilter = searchParams.get('traceId') || '';
  const minSpans = searchParams.get('minSpans') || '2';
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

  const clearFilters = () => {
    const next = new URLSearchParams();
    next.set('timeRange', '24h');
    next.set('minSpans', '2');
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
          languages[service.serviceName] = service.language;
        }
      });
      setServiceLanguages(languages);
    }).catch(() => {});
  }, [namespace]);

  useEffect(() => {
    setSortBy(activeTab === 'top' ? 'impact' : 'time');
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
        avgDurationMs: endpoint.avgDurationMs,
        p95DurationMs: endpoint.p95DurationMs,
        count: endpoint.count,
        errorCount: endpoint.errorCount,
        errorRate,
        tpm: windowMinutes > 0 ? endpoint.count / windowMinutes : 0,
        impact: endpoint.avgDurationMs * endpoint.count,
      };
    });

    switch (sortBy) {
      case 'latency':
        list.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
        break;
      case 'throughput':
        list.sort((a, b) => b.count - a.count);
        break;
      case 'errors':
        list.sort((a, b) => b.errorRate - a.errorRate);
        break;
      case 'name':
        list.sort((a, b) => a.operationName.localeCompare(b.operationName));
        break;
      case 'impact':
      default:
        list.sort((a, b) => b.impact - a.impact);
    }
    return list;
  }, [endpoints, sortBy, timeRangeFilter]);

  const sortedTraces = useMemo(() => {
    const list = [...traces];
    switch (sortBy) {
      case 'duration':
        list.sort((a, b) => b.durationMs - a.durationMs);
        break;
      case 'spans':
        list.sort((a, b) => b.spanCount - a.spanCount);
        break;
      case 'errors':
        list.sort((a, b) => Number(b.hasError) - Number(a.hasError));
        break;
      case 'time':
      default:
        list.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }
    return list;
  }, [traces, sortBy]);

  const topTotalPages = Math.max(1, Math.ceil(topTraces.length / pageSize));
  const topPage = Math.min(page, topTotalPages);
  const pagedTopTraces = topTraces.slice((topPage - 1) * pageSize, topPage * pageSize);
  const maxImpact = Math.max(...topTraces.map(item => item.impact), 1);
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
    minSpans !== '2' ? minSpans : '',
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
      ];

  return (
    <div className="traces-page">
      <section className="traces-header">
        <div>
          <span className="traces-eyebrow">{namespace || t('All namespaces')}</span>
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
              onChange={value => setSortBy(value as EndpointSort | TraceSort)}
              options={sortOptions}
            />
          </label>
          <button type="button" className="traces-refresh-btn" onClick={loadTraces}>Refresh</button>
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
          <ResultsHeader title={t('Top transactions')} count={topTraces.length} pageSize={pageSize} setPageSize={setPageSize} />
          {loading && topTraces.length === 0 ? (
            <LoadingState height={320} label={t('Loading top transactions...')} />
          ) : loadError ? (
            <NoDataState height={320} title={t('Could not load traces')} hint={t('Retry when the API is reachable.')} />
          ) : pagedTopTraces.length === 0 ? (
            <NoDataState height={320} title={t('No trace endpoints found')} hint={t('Adjust filters or wait for telemetry.')} />
          ) : (
            <div className="endpoint-list">
              {pagedTopTraces.map(item => (
                <EndpointRow
                  key={`${item.serviceName}:${item.operationName}`}
                  item={item}
                  maxImpact={maxImpact}
                  language={serviceLanguages[item.serviceName]}
                  onService={() => {
                    setFilterVal('service', item.serviceName);
                    setActiveTab('explorer');
                  }}
                  onOperation={() => {
                    setFilterVal('operation', item.operationName);
                    setActiveTab('explorer');
                  }}
                />
              ))}
            </div>
          )}
          {topTraces.length > 0 && <Pagination page={topPage} totalPages={topTotalPages} onPage={setPage} />}
        </section>
      ) : (
        <section className="trace-results-panel">
          <ResultsHeader title={t('Trace explorer')} count={traces.length} pageSize={pageSize} setPageSize={setPageSize} />
          {loading && sortedTraces.length === 0 ? (
            <LoadingState height={320} label={t('Searching traces...')} />
          ) : loadError ? (
            <NoDataState height={320} title={t('Could not load traces')} hint={t('Retry when the API is reachable.')} />
          ) : sortedTraces.length === 0 ? (
            <NoDataState height={320} title={t('No traces found')} hint={t('Adjust filters or wait for new traces.')} />
          ) : (
            <div className="trace-list">
              {sortedTraces.map(trace => (
                <TraceRow
                  key={trace.traceId}
                  trace={trace}
                  maxDuration={maxTraceDuration}
                  language={serviceLanguages[trace.serviceName]}
                  onClick={() => setSelectedTrace(trace)}
                />
              ))}
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
  maxImpact,
  language,
  onService,
  onOperation,
}: {
  item: {
    operationName: string;
    serviceName: string;
    avgDurationMs: number;
    p95DurationMs: number;
    count: number;
    errorCount: number;
    errorRate: number;
    tpm: number;
    impact: number;
  };
  maxImpact: number;
  language?: string;
  onService: () => void;
  onOperation: () => void;
}) {
  const errorTone = item.errorRate > 5 ? 'critical' : item.errorRate > 0 ? 'warning' : 'healthy';
  const latencyTone = item.avgDurationMs > 1000 ? 'warning' : 'neutral';
  const impactPct = Math.min(100, (item.impact / Math.max(maxImpact, 1)) * 100);

  return (
    <div className="endpoint-row">
      <div className="endpoint-main">
        <button type="button" className="endpoint-name" onClick={onOperation}>{item.operationName}</button>
        <button type="button" className="endpoint-service" onClick={onService}>
          <LanguageIcon language={language} size={18} />
          <span>{item.serviceName}</span>
        </button>
      </div>
      <TraceMetric label="Avg latency" value={formatDuration(item.avgDurationMs)} detail={`P95 ${formatDuration(item.p95DurationMs)}`} tone={latencyTone} />
      <TraceMetric label="Throughput" value={`${formatNumber(item.tpm)} tpm`} detail={`${formatCompact(item.count)} traces`} tone="neutral" />
      <TraceMetric label="Errors" value={formatPercent(item.errorRate)} detail={`${formatCompact(item.errorCount)} failed`} tone={errorTone} />
      <div className="endpoint-impact">
        <span>Impact</span>
        <strong>{impactPct.toFixed(0)}%</strong>
        <div><i style={{ width: `${Math.max(2, impactPct)}%` }} /></div>
      </div>
    </div>
  );
}

function TraceRow({ trace, maxDuration, language, onClick }: { trace: TraceListItem; maxDuration: number; language?: string; onClick: () => void }) {
  const flow = trace.serviceFlow && trace.serviceFlow.length > 0 ? trace.serviceFlow : (trace.services || []);
  const durationPct = Math.min(100, (trace.durationMs / Math.max(maxDuration, 1)) * 100);
  const latencyTone = trace.hasError ? 'critical' : trace.durationMs > 1000 ? 'warning' : 'neutral';

  return (
    <button type="button" className="trace-row" onClick={onClick}>
      <div className="trace-main">
        <div className="trace-title-line">
          <LanguageIcon language={language} size={18} />
          <strong>{trace.rootName || trace.serviceName}</strong>
          <span className={`trace-status ${trace.hasError ? 'critical' : 'healthy'}`}>{trace.hasError ? 'ERROR' : 'OK'}</span>
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="trace-quicklook" onClick={event => event.stopPropagation()}>
        <div className="trace-quicklook-header">
          <div>
            <div className="trace-title-line">
              <LanguageIcon language={serviceLanguages[trace.serviceName]} size={22} />
              <strong>{trace.rootName || trace.serviceName}</strong>
              <span className={`trace-status ${trace.hasError ? 'critical' : 'healthy'}`}>{trace.hasError ? 'ERROR' : 'OK'}</span>
            </div>
            <code>{trace.traceId}</code>
          </div>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="trace-quicklook-grid">
          <TraceMetric label={t('Duration')} value={formatDuration(trace.durationMs)} detail={formatTime(trace.startTime)} tone={trace.durationMs > 1000 ? 'warning' : 'neutral'} />
          <TraceMetric label={t('Spans')} value={trace.spanCount.toString()} detail={formatNamespace(trace)} tone="neutral" />
          <TraceMetric label={t('Status')} value={trace.hasError ? 'ERROR' : 'OK'} detail={trace.serviceName} tone={trace.hasError ? 'critical' : 'healthy'} />
        </div>
        {flow.length > 0 && (
          <div className="trace-quicklook-section">
            <span>{t('Request flow')}</span>
            <div className="trace-flow expanded">
              {flow.map((service, idx) => (
                <React.Fragment key={`${service}:${idx}`}>
                  {idx > 0 && <span className="trace-flow-arrow">{'->'}</span>}
                  <em style={{ color: getServiceColor(service), background: `${getServiceColor(service)}18` }}>{service}</em>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
        {trace.hasError && trace.errorSummary && (
          <div className="trace-quicklook-error">
            <strong>{trace.errorType || t('Error')}</strong>
            <span>{trace.errorSummary}</span>
          </div>
        )}
        <div className="trace-quicklook-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('Close')}</button>
          <button className="btn btn-primary" onClick={onOpenFull}>{t('View full trace')}</button>
        </div>
      </div>
    </div>
  );
}

function ResultsHeader({ title, count, pageSize, setPageSize }: { title: string; count: number; pageSize: number; setPageSize: (size: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="trace-results-header">
      <div>
        <h2>{title}</h2>
        <p>{formatCompact(count)} {t('results')}</p>
      </div>
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
