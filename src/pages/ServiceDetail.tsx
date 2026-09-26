import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Activity, Box, Cloud } from 'lucide-react';
import { api } from '../api/client';
import type {
  DatabaseQueryMetric,
  EndpointStat,
  ErrorGroup,
  InfraNode,
  PodMetricInfo,
  ServiceStats,
  TimeseriesData,
} from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import LanguageIcon from '../components/LanguageIcon';
import { useTranslation } from '../utils/i18n';
import { displayOperationName } from '../utils/operationName';
import { formatDuration } from '../utils/traceDisplay';
import type { MiniTrendTone } from '../components/MiniTrend';

type DetailTab =
  | 'overview'
  | 'transactions'
  | 'dependencies'
  | 'errors'
  | 'metrics'
  | 'infrastructure'
  | 'logs';

const VALID_TABS: DetailTab[] = [
  'overview',
  'transactions',
  'dependencies',
  'errors',
  'metrics',
  'infrastructure',
  'logs',
];
const WINDOW_MINUTES = 60;

interface ServiceEdge {
  peer: string;
  peerNamespace?: string;
  callCount: number;
  errorCount: number;
  avgDurationMs: number;
}

interface ServiceDetailData {
  service: ServiceStats | null;
  endpoints: EndpointStat[];
  issues: ErrorGroup[];
  upstream: ServiceEdge[];
  downstream: ServiceEdge[];
  pods: PodMetricInfo[];
  infraNodes: InfraNode[];
  timeseries: TimeseriesData | null;
  dbMetrics: DatabaseQueryMetric[];
}

const emptyData: ServiceDetailData = {
  service: null,
  endpoints: [],
  issues: [],
  upstream: [],
  downstream: [],
  pods: [],
  infraNodes: [],
  timeseries: null,
  dbMetrics: [],
};

export default function ServiceDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { namespace: nsParam, serviceName: nameParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const namespace = decodeURIComponent(nsParam || '');
  const serviceName = decodeURIComponent(nameParam || '');
  const tabParam = searchParams.get('tab') as DetailTab | null;
  const activeTab: DetailTab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<ServiceDetailData>(emptyData);

  const setTab = useCallback(
    (tab: DetailTab) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (tab === 'overview') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const load = useCallback(async () => {
    if (!namespace || !serviceName) return;
    setLoading(true);
    setLoadError(false);
    const startTime = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

    try {
      const [
        servicesRes,
        endpointsRes,
        tracesRes,
        mapRes,
        issuesRes,
        podsRes,
        infraRes,
        timeseriesRes,
        dbRes,
      ] = await Promise.all([
        api.getServices(namespace),
        api.getTopEndpoints({
          namespace,
          service: serviceName,
          startTime,
          limit: '200',
        }),
        api.getTraces({ namespace, service: serviceName, limit: '40' }),
        api.getServiceMap(namespace),
        api.getIssues(namespace, WINDOW_MINUTES),
        api.getPods(namespace),
        api.getInfrastructure(namespace),
        api.getTimeseries(namespace, WINDOW_MINUTES),
        api.getDatabaseMetrics(namespace),
      ]);

      const service =
        (servicesRes.services || []).find(
          s => s.serviceName === serviceName && s.namespace === namespace && !s.isInfrastructure,
        ) || null;

      const issues = (issuesRes.issues || []).filter(i => i.serviceName === serviceName);
      const pods = (podsRes.pods || []).filter(p => podMatchesService(p, serviceName));

      const upstream: ServiceEdge[] = [];
      const downstream: ServiceEdge[] = [];
      for (const edge of mapRes.edges || []) {
        const targetMatch =
          edge.target === serviceName &&
          (!edge.targetNamespace || edge.targetNamespace === namespace);
        const sourceMatch =
          edge.source === serviceName &&
          (!edge.sourceNamespace || edge.sourceNamespace === namespace);

        if (targetMatch) {
          upstream.push({
            peer: edge.source,
            peerNamespace: edge.sourceNamespace,
            callCount: edge.callCount,
            errorCount: edge.errorCount,
            avgDurationMs: edge.avgDurationMs,
          });
        }
        if (sourceMatch) {
          downstream.push({
            peer: edge.target,
            peerNamespace: edge.targetNamespace,
            callCount: edge.callCount,
            errorCount: edge.errorCount,
            avgDurationMs: edge.avgDurationMs,
          });
        }
      }

      const dbMetrics = (dbRes.metrics || []).filter(
        m => m.service === serviceName && m.namespace === namespace,
      );

      setData({
        service,
        endpoints: endpointsRes.endpoints || [],
        issues,
        upstream,
        downstream,
        pods,
        infraNodes: infraRes?.nodes || [],
        timeseries: timeseriesRes,
        dbMetrics,
      });

      void tracesRes;
    } catch (err) {
      console.error('ServiceDetail load error:', err);
      setLoadError(true);
      setData(emptyData);
    } finally {
      setLoading(false);
    }
  }, [namespace, serviceName]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const service = data.service;
  const errorSeries = useMemo(() => {
    if (!data.timeseries?.serviceErrors) return null;
    return data.timeseries.serviceErrors.find(
      s => s.service === serviceName && s.namespace === namespace,
    );
  }, [data.timeseries, serviceName, namespace]);

  const latencyTrend = useMemo(
    () => (data.timeseries?.buckets || []).map(b => b.avgMs),
    [data.timeseries],
  );
  const throughputTrend = useMemo(() => {
    if (errorSeries?.spans) return errorSeries.spans;
    return (data.timeseries?.buckets || []).map(b => b.spans);
  }, [errorSeries, data.timeseries]);
  const errorTrend = useMemo(() => {
    if (errorSeries?.errors) return errorSeries.errors;
    return (data.timeseries?.buckets || []).map(b => b.errors);
  }, [errorSeries, data.timeseries]);
  const failedRateTrend = useMemo(() => {
    const spans = errorSeries?.spans;
    const errors = errorSeries?.errors;
    if (spans && errors && spans.length === errors.length) {
      return spans.map((s, i) => (s > 0 ? (errors[i] / s) * 100 : 0));
    }
    return (data.timeseries?.buckets || []).map(b =>
      b.spans > 0 ? (b.errors / b.spans) * 100 : 0,
    );
  }, [errorSeries, data.timeseries]);
  const dependencyTrend = useMemo(
    () =>
      (data.timeseries?.buckets || []).map(b =>
        Number.isFinite(b.dbCalls) && Number.isFinite(b.dbAvgMs) ? b.dbCalls * b.dbAvgMs : 0,
      ),
    [data.timeseries],
  );

  const identity = useMemo(
    () => buildServiceIdentity(service, data.pods, data.infraNodes),
    [service, data.pods, data.infraNodes],
  );

  const dependencyTimeMs = useMemo(
    () =>
      data.downstream.reduce((sum, edge) => sum + edge.callCount * edge.avgDurationMs, 0) +
      data.dbMetrics.reduce((sum, row) => sum + row.callCount * row.avgDurationMs, 0),
    [data.downstream, data.dbMetrics],
  );

  const serviceMapHref = `/servicemap?service=${encodeURIComponent(serviceName)}&namespace=${encodeURIComponent(namespace)}`;
  const issueCount = data.issues.reduce((s, i) => s + i.count, 0);
  const depCount = data.upstream.length + data.downstream.length;

  if (!namespace || !serviceName) {
    return (
      <div className="service-detail-page apm-dashboard animate-fade-in">
        <NoDataState title={t('Invalid service URL')} hint={t('Open a service from the Services list.')} />
      </div>
    );
  }

  if (loading && !service) {
    return <LoadingState height={480} label={t('Loading service…')} />;
  }

  if (!loading && loadError) {
    return (
      <div className="service-detail-page apm-dashboard animate-fade-in">
        <ServiceDetailBack />
        <NoDataState title={t('Could not load service')} hint={t('Check your connection and try again.')} />
      </div>
    );
  }

  if (!loading && !service) {
    return (
      <div className="service-detail-page apm-dashboard animate-fade-in">
        <ServiceDetailBack />
        <NoDataState
          title={t('Service not found')}
          hint={`${serviceName} · ${namespace} — ${t('No telemetry in the last hour.')}`}
        />
      </div>
    );
  }

  return (
    <div className="service-detail-page apm-dashboard animate-fade-in">
      <ServiceDetailBack />

      <header className="service-detail-hero">
        <div className="service-detail-title-row">
          <h1>{serviceName}</h1>
          <ServiceIdentityChips identity={identity} language={service?.language} />
        </div>
        <p className="service-detail-window">{t('Last 60 minutes')}</p>
      </header>

      <nav className="service-detail-tabs" aria-label={t('Service sections')}>
        {(
          [
            ['overview', t('Overview'), null],
            ['transactions', t('Transactions'), data.endpoints.length || null],
            ['dependencies', t('Dependencies'), depCount || null],
            ['errors', t('Errors'), issueCount || null],
            ['metrics', t('Metrics'), null],
            ['infrastructure', t('Infrastructure'), data.pods.length || null],
            ['logs', t('Logs'), null],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? 'active' : ''}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {count != null && count > 0 && (
              <span className="service-detail-tab-count">{count}</span>
            )}
          </button>
        ))}
        <Link to={serviceMapHref} className="service-detail-tab-link">
          {t('Service Map')}
        </Link>
      </nav>

      <section className="service-detail-panel">
        {activeTab === 'overview' && (
          <OverviewTab
            service={service!}
            namespace={namespace}
            serviceName={serviceName}
            endpoints={data.endpoints}
            loading={loading}
            navigate={navigate}
            latencyTrend={latencyTrend}
            throughputTrend={throughputTrend}
            failedRateTrend={failedRateTrend}
            dependencyTrend={dependencyTrend}
            dependencyTimeMs={dependencyTimeMs}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionsTab
            namespace={namespace}
            serviceName={serviceName}
            endpoints={data.endpoints}
            loading={loading}
            navigate={navigate}
          />
        )}
        {activeTab === 'dependencies' && (
          <DependenciesTab upstream={data.upstream} downstream={data.downstream} />
        )}
        {activeTab === 'errors' && (
          <ErrorsTab issues={data.issues} loading={loading} navigate={navigate} />
        )}
        {activeTab === 'metrics' && (
          <MetricsTab
            pods={data.pods}
            dbMetrics={data.dbMetrics}
            language={service?.language}
            loading={loading}
          />
        )}
        {activeTab === 'infrastructure' && (
          <InfrastructureTab pods={data.pods} loading={loading} />
        )}
        {activeTab === 'logs' && <LogsTab />}
      </section>
    </div>
  );
}

function ServiceDetailBack() {
  const { t } = useTranslation();
  return (
    <Link to="/services" className="service-detail-back">
      <ArrowLeft size={16} aria-hidden="true" />
      {t('Services')}
    </Link>
  );
}

interface ServiceIdentity {
  techStack: string | null;
  containerImages: string[];
  cluster: string | null;
  namespace: string;
  cloudSummary: string | null;
  nodeSummaries: string[];
  instrumentation: string;
  serviceVersion: string | null;
  os: string | null;
  kernel: string | null;
  architecture: string | null;
  containerRuntime: string | null;
  instanceCount: number;
  /** true when any matched node has a cloud provider label */
  isCloud: boolean;
  hostingLabel: string;
  cloudProvider: string | null;
  region: string | null;
  zone: string | null;
  instanceType: string | null;
}

function ServiceIdentityChips({
  identity,
  language,
}: {
  identity: ServiceIdentity;
  language?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="service-detail-chips-row">
      <IdentityChip
        label={t('Service')}
        ariaLabel={t('Service runtime details')}
        icon={<LanguageIcon language={language} size={18} />}
      >
        <PopoverTitle>{t('Service')}</PopoverTitle>
        {identity.serviceVersion && (
          <PopoverFact label={t('Service version')} value={identity.serviceVersion} />
        )}
        {identity.techStack && (
          <PopoverFact label={t('Runtime name & version')} value={identity.techStack} />
        )}
        <PopoverFact label={t('Agent name & version')} value={identity.instrumentation} />
      </IdentityChip>

      <IdentityChip
        label={t('Container')}
        ariaLabel={t('Container details')}
        icon={<Box size={18} aria-hidden="true" />}
      >
        <PopoverTitle>{t('Container')}</PopoverTitle>
        <PopoverFact label={t('OS')} value={identity.os || '—'} />
        {identity.architecture && (
          <PopoverFact label={t('Architecture')} value={identity.architecture} />
        )}
        <PopoverFact
          label={t('Total number of instances')}
          value={String(identity.instanceCount)}
        />
        {identity.containerImages.length > 0 && (
          <PopoverFact
            label={t('Container images')}
            value={truncateList(identity.containerImages, 120)}
            mono
          />
        )}
      </IdentityChip>

      <IdentityChip
        label={identity.isCloud ? t('Cloud') : t('Host')}
        ariaLabel={identity.isCloud ? t('Cloud and node details') : t('On-prem host details')}
        icon={<Cloud size={18} aria-hidden="true" />}
      >
        <PopoverTitle>{identity.isCloud ? t('Cloud') : t('Host')}</PopoverTitle>
        <PopoverFact label={t('Environment')} value={identity.hostingLabel} />
        {identity.isCloud && identity.cloudProvider && (
          <PopoverFact label={t('Provider')} value={formatCloudProvider(identity.cloudProvider)} />
        )}
        {identity.isCloud && identity.region && (
          <PopoverFact label={t('Region')} value={identity.region} />
        )}
        {identity.isCloud && identity.zone && (
          <PopoverFact label={t('Zone')} value={identity.zone} />
        )}
        {identity.isCloud && identity.instanceType && (
          <PopoverFact label={t('Instance type')} value={identity.instanceType} />
        )}
        {!identity.isCloud && identity.os && (
          <PopoverFact label={t('OS')} value={identity.os} />
        )}
        {!identity.isCloud && identity.kernel && (
          <PopoverFact label={t('Kernel')} value={identity.kernel} />
        )}
        {!identity.isCloud && identity.architecture && (
          <PopoverFact label={t('Architecture')} value={identity.architecture} />
        )}
        {identity.containerRuntime && (
          <PopoverFact label={t('Container runtime')} value={identity.containerRuntime} />
        )}
        {identity.nodeSummaries.length > 0 && (
          <PopoverFact
            label={t('Nodes')}
            value={truncateList(identity.nodeSummaries, 140)}
          />
        )}
        {identity.cluster && (
          <PopoverFact label={t('Cluster')} value={identity.cluster} />
        )}
      </IdentityChip>
    </div>
  );
}

function IdentityChip({
  label,
  ariaLabel,
  icon,
  children,
}: {
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="service-detail-identity-chip-wrap">
      <button
        type="button"
        className="service-detail-identity-chip"
        aria-label={ariaLabel}
        aria-describedby={undefined}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </button>
      <div className="service-detail-popover" role="tooltip">
        {children}
      </div>
    </div>
  );
}

function PopoverTitle({ children }: { children: React.ReactNode }) {
  return <div className="service-detail-popover-title">{children}</div>;
}

function PopoverFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="service-detail-popover-fact">
      <span>{label}</span>
      <strong className={mono ? 'service-detail-identity-mono' : undefined}>{value}</strong>
    </div>
  );
}

function OverviewTab({
  service,
  namespace,
  serviceName,
  endpoints,
  loading,
  navigate,
  latencyTrend,
  throughputTrend,
  failedRateTrend,
  dependencyTrend,
  dependencyTimeMs,
}: {
  service: ServiceStats;
  namespace: string;
  serviceName: string;
  endpoints: EndpointStat[];
  loading: boolean;
  navigate: ReturnType<typeof useNavigate>;
  latencyTrend: number[];
  throughputTrend: number[];
  failedRateTrend: number[];
  dependencyTrend: number[];
  dependencyTimeMs: number;
}) {
  const { t } = useTranslation();
  const recentDepTime =
    dependencyTrend.length > 0 ? dependencyTrend[dependencyTrend.length - 1] : dependencyTimeMs;

  const previewEndpoints = endpoints.slice(0, 8);

  return (
    <div className="service-detail-overview">
      <section className="service-detail-chart-grid" aria-label={t('Service metrics')}>
        <OverviewMetricPanel
          title={t('Latency')}
          value={formatDuration(service.p95Ms)}
          detail={`p50 ${formatDuration(service.p50Ms)} · p99 ${formatDuration(service.p99Ms)}`}
          tone={service.p95Ms > 500 ? 'warning' : 'info'}
          data={latencyTrend}
          loading={loading}
        />
        <OverviewMetricPanel
          title={t('Throughput')}
          value={formatThroughput(service.requestCount)}
          detail={`${formatCompact(service.requestCount)} ${t('requests')}`}
          tone="info"
          data={throughputTrend}
          loading={loading}
        />
        <OverviewMetricPanel
          title={t('Failed transaction rate')}
          value={formatPercent(service.errorRate)}
          detail={`${formatCompact(service.errorCount)} ${t('errors')}`}
          tone={
            service.errorRate > 5 ? 'critical' : service.errorRate > 0 ? 'warning' : 'healthy'
          }
          data={failedRateTrend}
          loading={loading}
        />
        <OverviewMetricPanel
          title={t('Time spent by dependency')}
          value={formatDuration(recentDepTime)}
          detail={
            dependencyTimeMs > 0
              ? `${formatDuration(dependencyTimeMs)} ${t('total')}`
              : t('From service map & DB calls')
          }
          tone="info"
          data={dependencyTrend}
          loading={loading}
        />
      </section>

      <section className="service-detail-transactions-preview">
        <div className="service-detail-section-header">
          <h2>{t('Top transactions')}</h2>
          {endpoints.length > previewEndpoints.length && (
            <span className="service-detail-section-meta">
              {endpoints.length} {t('total')}
            </span>
          )}
        </div>
        {loading && endpoints.length === 0 ? (
          <LoadingState height={180} label={t('Loading transactions…')} />
        ) : endpoints.length === 0 ? (
          <NoDataState
            title={t('No transactions')}
            hint={t('Endpoints appear when this service handles traced requests.')}
            height={160}
          />
        ) : (
          <div className="service-detail-table-scroller">
            <table className="data-table service-detail-table">
              <thead>
                <tr>
                  <th align="left">{t('Transaction')}</th>
                  <th align="right">{t('Count')}</th>
                  <th align="right">{t('Errors')}</th>
                  <th align="right">{t('Avg')}</th>
                  <th align="right">p95</th>
                </tr>
              </thead>
              <tbody>
                {previewEndpoints.map(ep => {
                  const op = displayOperationName(ep.operationName || '');
                  return (
                    <tr
                      key={`${ep.operationName}:${ep.count}`}
                      className="service-detail-clickable-row"
                      tabIndex={0}
                      role="link"
                      onClick={() =>
                        navigate(
                          `/traces?service=${encodeURIComponent(serviceName)}&operation=${encodeURIComponent(ep.operationName)}&namespace=${encodeURIComponent(namespace)}`,
                        )
                      }
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          navigate(
                            `/traces?service=${encodeURIComponent(serviceName)}&operation=${encodeURIComponent(ep.operationName)}&namespace=${encodeURIComponent(namespace)}`,
                          );
                        }
                      }}
                    >
                      <td>
                        <strong>{op}</strong>
                      </td>
                      <td align="right">{formatCompact(ep.count)}</td>
                      <td align="right">{formatCompact(ep.errorCount)}</td>
                      <td align="right">{formatDuration(ep.avgDurationMs)}</td>
                      <td align="right">{formatDuration(ep.p95DurationMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewMetricPanel({
  title,
  value,
  detail,
  tone,
  data,
  loading,
}: {
  title: string;
  value: string;
  detail: string;
  tone: MiniTrendTone;
  data: number[];
  loading: boolean;
}) {
  return (
    <article className={`service-detail-metric-panel ${tone}`}>
      <header className="service-detail-metric-header">
        <h3>{title}</h3>
        <div className="service-detail-metric-summary">
          <strong>{loading && data.length < 2 ? '—' : value}</strong>
          <span>{detail}</span>
        </div>
      </header>
      <div className="service-detail-metric-chart">
        <ServiceAreaChart data={data} tone={tone} />
      </div>
    </article>
  );
}

function ServiceAreaChart({ data, tone }: { data: number[]; tone: MiniTrendTone }) {
  const fillId = useId().replace(/:/g, '');
  const width = 400;
  const height = 100;
  const color = toneColorFor(tone);
  const series = data.filter(value => Number.isFinite(value));

  if (series.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="service-detail-area-chart"
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border-secondary)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  const maxValue = Math.max(...series, 1);
  const minValue = Math.min(...series, 0);
  const span = Math.max(maxValue - minValue, maxValue * 0.08, 1e-6);
  const points = series.map((value, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * width;
    const y = height - ((value - minValue) / span) * (height - 8) - 4;
    return { x, y };
  });
  const stroke = smoothPath(points);
  const fillPath = `M 0 ${height} L ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}${stroke.replace(/^M\s+[-\d.eE+]+\s+[-\d.eE]+/, '')} L ${width} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="service-detail-area-chart"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${fillId})`} />
      <path
        d={stroke}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfrastructureTab({ pods, loading }: { pods: PodMetricInfo[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="service-detail-infrastructure">
      <div className="service-detail-section-header">
        <h2>{t('Instances')}</h2>
        {pods.length > 0 && (
          <span className="service-detail-section-meta">
            {pods.length} {t('running')}
          </span>
        )}
      </div>
      {loading && pods.length === 0 ? (
        <LoadingState height={120} label={t('Loading instances…')} />
      ) : pods.length === 0 ? (
        <NoDataState
          title={t('No matching pods')}
          hint={t('Pod metrics appear when workloads run in this namespace.')}
          height={140}
        />
      ) : (
        <div className="service-detail-table-scroller">
          <table className="data-table service-detail-table">
            <thead>
              <tr>
                <th align="left">{t('Name')}</th>
                <th align="left">{t('Images')}</th>
                <th align="left">{t('Phase')}</th>
                <th align="left">{t('Node')}</th>
                <th align="right">{t('CPU')}</th>
                <th align="right">{t('Memory')}</th>
                <th align="right">{t('Restarts')}</th>
                <th align="left">{t('Instrumented')}</th>
              </tr>
            </thead>
            <tbody>
              {pods.map(pod => (
                <tr key={pod.name}>
                  <td>
                    <code>{pod.name}</code>
                  </td>
                  <td>
                    {pod.containerImages && pod.containerImages.length > 0 ? (
                      <span className="service-detail-muted" title={pod.containerImages.join(', ')}>
                        {pod.containerImages.join(', ')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{pod.phase || '—'}</td>
                  <td>{pod.nodeName || '—'}</td>
                  <td align="right">{formatCpu(pod.cpuUsage)}</td>
                  <td align="right">{formatMem(pod.memoryUsage)}</td>
                  <td align="right">{pod.restartCount ?? 0}</td>
                  <td>{pod.instrumented ? t('Yes') : t('No')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LogsTab() {
  const { t } = useTranslation();
  return (
    <div className="service-detail-logs">
      <div className="service-detail-logs-toolbar">
        <span className="service-detail-window">{t('Last 60 minutes')}</span>
      </div>
      <div className="service-detail-table-scroller">
        <table className="data-table service-detail-table service-detail-logs-table">
          <thead>
            <tr>
              <th align="left">{t('Timestamp')}</th>
              <th align="left">{t('Message')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={2}>
                <NoDataState
                  title={t('No logs')}
                  hint={t('Log correlation is not configured for this service yet.')}
                  height={120}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionsTab({
  namespace,
  serviceName,
  endpoints,
  loading,
  navigate,
}: {
  namespace: string;
  serviceName: string;
  endpoints: EndpointStat[];
  loading: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();

  if (loading && endpoints.length === 0) {
    return <LoadingState height={240} label={t('Loading transactions…')} />;
  }
  if (endpoints.length === 0) {
    return (
      <NoDataState
        title={t('No transactions')}
        hint={t('Endpoints appear when this service handles traced requests.')}
      />
    );
  }

  return (
    <div className="service-detail-table-scroller">
      <table className="data-table service-detail-table">
        <thead>
          <tr>
            <th align="left">{t('Transaction')}</th>
            <th align="right">{t('Count')}</th>
            <th align="right">{t('Errors')}</th>
            <th align="right">{t('Avg')}</th>
            <th align="right">p95</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map(ep => {
            const op = displayOperationName(ep.operationName || '');
            return (
              <tr
                key={`${ep.operationName}:${ep.count}`}
                className="service-detail-clickable-row"
                tabIndex={0}
                role="link"
                onClick={() =>
                  navigate(
                    `/traces?service=${encodeURIComponent(serviceName)}&operation=${encodeURIComponent(ep.operationName)}&namespace=${encodeURIComponent(namespace)}`,
                  )
                }
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(
                      `/traces?service=${encodeURIComponent(serviceName)}&operation=${encodeURIComponent(ep.operationName)}&namespace=${encodeURIComponent(namespace)}`,
                    );
                  }
                }}
              >
                <td>
                  <strong>{op}</strong>
                </td>
                <td align="right">{formatCompact(ep.count)}</td>
                <td align="right">{formatCompact(ep.errorCount)}</td>
                <td align="right">{formatDuration(ep.avgDurationMs)}</td>
                <td align="right">{formatDuration(ep.p95DurationMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DependenciesTab({
  upstream,
  downstream,
}: {
  upstream: ServiceEdge[];
  downstream: ServiceEdge[];
}) {
  const { t } = useTranslation();

  if (upstream.length === 0 && downstream.length === 0) {
    return (
      <NoDataState
        title={t('No dependencies')}
        hint={t('Service map edges appear when traced calls connect services.')}
      />
    );
  }

  return (
    <div className="service-detail-deps">
      <DependencyList title={t('Upstream')} subtitle={t('Services that call this service')} edges={upstream} />
      <DependencyList
        title={t('Downstream')}
        subtitle={t('Services this service calls')}
        edges={downstream}
      />
    </div>
  );
}

function DependencyList({
  title,
  subtitle,
  edges,
}: {
  title: string;
  subtitle: string;
  edges: ServiceEdge[];
}) {
  const { t } = useTranslation();
  return (
    <section className="card service-detail-dep-list">
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {edges.length === 0 ? (
        <p className="service-detail-empty-inline">{t('None')}</p>
      ) : (
        <ul>
          {edges.map(edge => (
            <li key={`${edge.peer}:${edge.peerNamespace || ''}`}>
              <div className="service-detail-dep-name">
                <strong>{edge.peer}</strong>
                {edge.peerNamespace && <span>{edge.peerNamespace}</span>}
              </div>
              <div className="service-detail-dep-metrics">
                <span>
                  {formatCompact(edge.callCount)} {t('calls')}
                </span>
                <span>
                  {formatCompact(edge.errorCount)} {t('errors')}
                </span>
                <span>
                  {formatDuration(edge.avgDurationMs)} {t('avg')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ErrorsTab({
  issues,
  loading,
  navigate,
}: {
  issues: ErrorGroup[];
  loading: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();

  if (loading && issues.length === 0) {
    return <LoadingState height={240} label={t('Loading errors…')} />;
  }
  if (issues.length === 0) {
    return (
      <NoDataState
        title={t('No errors')}
        hint={t('Error groups appear when instrumented services emit failing spans.')}
      />
    );
  }

  return (
    <div className="service-detail-table-scroller">
      <table className="data-table service-detail-table">
        <thead>
          <tr>
            <th align="left">{t('Exception / message')}</th>
            <th align="left">{t('Transaction')}</th>
            <th align="right">{t('Count')}</th>
            <th align="left">{t('Last seen')}</th>
            <th align="left">{t('Example trace')}</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(issue => (
            <tr key={issue.fingerprint}>
              <td>
                <div style={{ fontWeight: 600 }}>{issue.exceptionType || 'Error'}</div>
                <div className="service-detail-muted" title={issue.exceptionMessage}>
                  {issue.exceptionMessage || issue.dbFingerprint || '—'}
                </div>
              </td>
              <td>{issue.transactionName || '—'}</td>
              <td align="right">{issue.count}</td>
              <td>{issue.lastSeen ? new Date(issue.lastSeen).toLocaleString() : '—'}</td>
              <td>
                {issue.exampleTraceId ? (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => navigate(`/traces/${issue.exampleTraceId}`)}
                  >
                    {issue.exampleTraceId.slice(0, 8)}…
                  </button>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricsTab({
  pods,
  dbMetrics,
  language,
  loading,
}: {
  pods: PodMetricInfo[];
  dbMetrics: DatabaseQueryMetric[];
  language?: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const lang = (language || '').toLowerCase();
  const isJvm = lang === 'java' || lang === 'kotlin' || lang === 'scala';

  const totalCpu = pods.reduce((s, p) => s + (p.cpuUsage || 0), 0);
  const totalMem = pods.reduce((s, p) => s + (p.memoryUsage || 0), 0);

  return (
    <div className="service-detail-metrics">
      <section className="card">
        <h3>{t('Pod resources')}</h3>
        {loading && pods.length === 0 ? (
          <LoadingState height={100} label={t('Loading metrics…')} />
        ) : pods.length === 0 ? (
          <p className="service-detail-empty-inline">{t('No pod metrics for this service.')}</p>
        ) : (
          <div className="service-detail-pod-summary">
            <div>
              <span>{t('Instances')}</span>
              <strong>{pods.length}</strong>
            </div>
            <div>
              <span>{t('Total CPU')}</span>
              <strong>{formatCpu(totalCpu)}</strong>
            </div>
            <div>
              <span>{t('Total memory')}</span>
              <strong>{formatMem(totalMem)}</strong>
            </div>
          </div>
        )}
      </section>

      {dbMetrics.length > 0 && (
        <section className="card">
          <h3>{t('Database queries')}</h3>
          <div className="service-detail-table-scroller">
            <table className="data-table service-detail-table">
              <thead>
                <tr>
                  <th align="left">{t('Query')}</th>
                  <th align="right">{t('Calls')}</th>
                  <th align="right">{t('Errors')}</th>
                  <th align="right">{t('Avg')}</th>
                  <th align="right">p95</th>
                </tr>
              </thead>
              <tbody>
                {dbMetrics.slice(0, 20).map(row => (
                  <tr key={row.fingerprint}>
                    <td>
                      <div className="service-detail-muted" title={row.query}>
                        {row.summary || row.query.slice(0, 80)}
                      </div>
                    </td>
                    <td align="right">{formatCompact(row.callCount)}</td>
                    <td align="right">{formatCompact(row.errorCount)}</td>
                    <td align="right">{formatDuration(row.avgDurationMs)}</td>
                    <td align="right">{formatDuration(row.p95DurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isJvm && (
        <section className="card service-detail-jvm-notice">
          <Activity size={18} aria-hidden="true" />
          <p>{t('Runtime JVM metrics are not collected yet (OTel metrics export is off).')}</p>
        </section>
      )}
    </div>
  );
}

function buildServiceIdentity(
  service: ServiceStats | null,
  pods: PodMetricInfo[],
  infraNodes: InfraNode[],
): ServiceIdentity {
  const namespace = service?.namespace || pods[0]?.namespace || '';
  const techStack = languageLabel(service?.language || pods.find(p => p.language)?.language);

  const imageSeen = new Set<string>();
  const containerImages: string[] = [];
  for (const pod of pods) {
    for (const img of pod.containerImages || []) {
      if (img && !imageSeen.has(img)) {
        imageSeen.add(img);
        containerImages.push(img);
      }
    }
  }

  const nodeByName = new Map(infraNodes.map(n => [n.name, n]));
  const nodeNames = new Set<string>();
  for (const pod of pods) {
    if (pod.nodeName) nodeNames.add(pod.nodeName);
  }
  // When pods lack nodeName, still surface cluster-wide node OS if only one node family.
  const nodesForFacts =
    nodeNames.size > 0
      ? [...nodeNames].map(n => nodeByName.get(n)).filter((n): n is InfraNode => Boolean(n))
      : infraNodes;

  const cloudParts = new Set<string>();
  const nodeSummaries: string[] = [];
  const providers = new Set<string>();
  const regions = new Set<string>();
  const zones = new Set<string>();
  const instanceTypes = new Set<string>();
  const osImages = new Set<string>();
  const kernels = new Set<string>();
  const archs = new Set<string>();
  const runtimes = new Set<string>();

  for (const name of [...nodeNames].sort()) {
    const node = nodeByName.get(name);
    const parts: string[] = [name];
    if (node) {
      if (node.cloudProvider) providers.add(String(node.cloudProvider));
      if (node.region) regions.add(String(node.region));
      if (node.zone) zones.add(String(node.zone));
      if (node.instanceType) instanceTypes.add(String(node.instanceType));

      const vmParts = [node.cloudProvider, node.region, node.zone, node.instanceType]
        .filter(Boolean)
        .map(String);
      if (vmParts.length > 0) {
        parts.push(`(${vmParts.join(' / ')})`);
        cloudParts.add(vmParts.join(' / '));
      } else if (node.osImage) {
        parts.push(`(${node.osImage})`);
      } else if (node.role) {
        parts.push(`(${node.role})`);
      }
    }
    nodeSummaries.push(parts.join(' '));
  }

  for (const node of nodesForFacts) {
    if (node.cloudProvider) providers.add(String(node.cloudProvider));
    if (node.region) regions.add(String(node.region));
    if (node.zone) zones.add(String(node.zone));
    if (node.instanceType) instanceTypes.add(String(node.instanceType));
    if (node.osImage) osImages.add(String(node.osImage));
    else if (node.operatingSystem) osImages.add(String(node.operatingSystem));
    if (node.kernelVersion) kernels.add(String(node.kernelVersion));
    if (node.architecture) archs.add(String(node.architecture));
    if (node.containerRuntime) runtimes.add(shortRuntime(String(node.containerRuntime)));
  }

  const isCloud = providers.size > 0;
  const os =
    osImages.size === 1
      ? [...osImages][0]
      : osImages.size > 1
        ? [...osImages].join(', ')
        : pods.length > 0
          ? 'Linux'
          : null;

  const instrumentedCount = pods.filter(p => p.instrumented).length;
  let instrumentation = 'Unknown';
  if (pods.length > 0) {
    if (instrumentedCount === pods.length) instrumentation = 'Fully instrumented';
    else if (instrumentedCount > 0) instrumentation = `Partial (${instrumentedCount}/${pods.length})`;
    else instrumentation = 'Not instrumented';
  }

  const instTypes = new Set(
    pods.map(p => p.instrumentationType).filter((v): v is string => Boolean(v)),
  );
  if (instTypes.size === 1) {
    instrumentation += ` · ${[...instTypes][0]}`;
  }

  let serviceVersion: string | null = null;
  for (const pod of pods) {
    const labels = pod.labels || {};
    const v = labels['app.kubernetes.io/version'] || labels.version;
    if (v) {
      serviceVersion = v;
      break;
    }
  }

  const pickSet = (s: Set<string>) =>
    s.size === 1 ? [...s][0] : s.size > 1 ? [...s].join(', ') : null;

  return {
    techStack,
    containerImages,
    cluster: service?.cluster || null,
    namespace,
    cloudSummary: cloudParts.size > 0 ? [...cloudParts].join(' · ') : null,
    nodeSummaries,
    instrumentation,
    serviceVersion,
    os,
    kernel: pickSet(kernels),
    architecture: pickSet(archs),
    containerRuntime: pickSet(runtimes),
    instanceCount: pods.length,
    isCloud,
    hostingLabel: isCloud
      ? formatCloudProvider(pickSet(providers) || 'cloud')
      : os
        ? `On-prem · ${os}`
        : 'On-prem',
    cloudProvider: pickSet(providers),
    region: pickSet(regions),
    zone: pickSet(zones),
    instanceType: pickSet(instanceTypes),
  };
}

function formatCloudProvider(raw: string): string {
  const key = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    aws: 'AWS',
    azure: 'Azure',
    gcp: 'Google Cloud',
    ocp: 'OpenShift',
    ibm: 'IBM Cloud',
    oci: 'Oracle Cloud',
    digitalocean: 'DigitalOcean',
    linode: 'Linode',
    vsphere: 'vSphere',
  };
  if (map[key]) return map[key];
  return raw;
}

function shortRuntime(raw: string): string {
  // containerd://1.7.0 → containerd 1.7.0
  const m = raw.match(/^([a-z0-9]+)(?::\/\/|\/)(.+)$/i);
  if (m) return `${m[1]} ${m[2]}`;
  return raw;
}

function truncateList(items: string[], maxLen: number): string {
  const joined = items.join(', ');
  if (joined.length <= maxLen) return joined;
  return `${joined.slice(0, maxLen - 1)}…`;
}

function toneColorFor(tone: MiniTrendTone) {
  switch (tone) {
    case 'healthy':
      return 'var(--success-emerald)';
    case 'warning':
      return 'var(--warning-amber)';
    case 'critical':
      return 'var(--critical-rose)';
    case 'info':
      return 'var(--accent-indigo)';
    default:
      return 'var(--neutral-muted)';
  }
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    const p0 = points[idx - 1] || points[idx];
    const p1 = points[idx];
    const p2 = points[idx + 1];
    const p3 = points[idx + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

function podMatchesService(pod: PodMetricInfo, serviceName: string): boolean {
  const labels = pod.labels || {};
  const appName = labels['app.kubernetes.io/name'] || labels.app || labels.name;
  if (appName === serviceName) return true;
  if (pod.name === serviceName) return true;
  if (pod.name.startsWith(`${serviceName}-`)) return true;
  return false;
}

function languageLabel(language?: string): string | null {
  if (!language) return null;
  const key = language.toLowerCase().trim();
  if (!key || key === 'unknown' || key === 'auto' || key === 'unk') return null;
  if (key === 'nodejs' || key === 'node') return 'Node.js';
  if (key === 'dotnet' || key === 'csharp') return '.NET';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatCpu(milli: number): string {
  if (!Number.isFinite(milli) || milli <= 0) return '0m';
  if (milli < 1000) return `${Math.round(milli)}m`;
  return `${(milli / 1000).toFixed(2)} cores`;
}

function formatMem(mib: number): string {
  if (!Number.isFinite(mib) || mib <= 0) return '0 Mi';
  if (mib < 1024) return `${Math.round(mib)} Mi`;
  return `${(mib / 1024).toFixed(2)} Gi`;
}

function formatThroughput(count: number) {
  const tpm = count / WINDOW_MINUTES;
  if (tpm <= 0) return '0 tpm';
  if (tpm < 1) return `${(tpm * 60).toFixed(1)} tph`;
  if (tpm >= 1000) return `${(tpm / 1000).toFixed(1)}k tpm`;
  return `${tpm.toFixed(1)} tpm`;
}

function formatCompact(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}
