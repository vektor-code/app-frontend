import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Activity, GitBranch, AlertTriangle, BarChart3, ListTree } from 'lucide-react';
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
import { KpiCard } from '../components/KpiCard';
import { useTranslation } from '../utils/i18n';
import { displayOperationName } from '../utils/operationName';
import { formatDuration } from '../utils/traceDisplay';
import type { MiniTrendTone } from '../components/MiniTrend';

type DetailTab = 'overview' | 'transactions' | 'dependencies' | 'errors' | 'metrics';

const VALID_TABS: DetailTab[] = ['overview', 'transactions', 'dependencies', 'errors', 'metrics'];
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

  const setTab = useCallback((tab: DetailTab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

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

      // tracesRes fetched for potential future use; keeps parity with spec parallel load
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
  const health = useMemo(() => (service ? deriveHealth(service) : null), [service]);
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
  const throughputTrend = useMemo(
    () => (data.timeseries?.buckets || []).map(b => b.spans),
    [data.timeseries],
  );
  const errorTrend = useMemo(
    () => errorSeries?.errors || (data.timeseries?.buckets || []).map(b => b.errors),
    [errorSeries, data.timeseries],
  );
  const identity = useMemo(
    () => buildServiceIdentity(service, data.pods, data.infraNodes),
    [service, data.pods, data.infraNodes],
  );

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

  const langLabel = languageLabel(service?.language);
  const statusTone = health ? healthToneToKind(health.status, health.healthScore) : 'neutral';

  return (
    <div className="service-detail-page apm-dashboard animate-fade-in">
      <ServiceDetailBack />

      <header className="service-detail-hero">
        <div className="service-detail-title-row">
          <div className="service-detail-icon">
            <LanguageIcon language={service?.language} size={28} />
          </div>
          <div className="service-detail-title-block">
            <h1>{serviceName}</h1>
            <div className="service-detail-meta">
              <span>{namespace}</span>
              <span aria-hidden="true">·</span>
              <span>{service?.cluster || '—'}</span>
              <span aria-hidden="true">·</span>
              <span className={`service-status-pill ${statusTone}`}>
                <i />
                {health?.label || t('Unknown')}
              </span>
              {langLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{langLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="service-detail-window">{t('Last 60 minutes')}</p>
      </header>

      <section className="apm-kpi-strip service-detail-kpis" aria-label={t('Service KPIs')}>
        <KpiCard
          label={t('Health / Apdex')}
          value={health ? `${health.healthScore.toFixed(0)}%` : '—'}
          detail={health ? `Apdex ${health.apdex.toFixed(2)}` : '—'}
          tone={health ? healthKpiTone(health.status, health.healthScore) : 'neutral'}
          loading={loading}
        />
        <KpiCard
          label={t('Throughput')}
          value={service ? formatThroughput(service.requestCount) : '—'}
          detail={service ? `${formatCompact(service.requestCount)} ${t('requests')}` : '—'}
          tone="info"
          trend={throughputTrend.length > 1 ? throughputTrend : undefined}
          loading={loading}
        />
        <KpiCard
          label={t('Latency p95')}
          value={service ? formatDuration(service.p95Ms) : '—'}
          detail={service ? `p50 ${formatDuration(service.p50Ms)} · p99 ${formatDuration(service.p99Ms)}` : '—'}
          tone={service && service.p95Ms > 500 ? 'warning' : 'info'}
          trend={latencyTrend.length > 1 ? latencyTrend : undefined}
          positiveIsGood={false}
          loading={loading}
        />
        <KpiCard
          label={t('Error rate')}
          value={service ? formatPercent(service.errorRate) : '—'}
          detail={service ? `${formatCompact(service.errorCount)} ${t('errors')}` : '—'}
          tone={service && service.errorRate > 5 ? 'critical' : service && service.errorRate > 0 ? 'warning' : 'healthy'}
          trend={errorTrend && errorTrend.length > 1 ? errorTrend : undefined}
          positiveIsGood={false}
          loading={loading}
        />
      </section>

      <ServiceIdentityCard identity={identity} loading={loading} />

      <InstancesPanel pods={data.pods} loading={loading} />

      <nav className="service-detail-tabs" aria-label={t('Service sections')}>
        {([
          ['overview', t('Overview'), null],
          ['transactions', t('Transactions'), data.endpoints.length],
          ['dependencies', t('Dependencies'), data.upstream.length + data.downstream.length],
          ['errors', t('Errors'), data.issues.reduce((s, i) => s + i.count, 0)],
          ['metrics', t('Metrics'), null],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? 'active' : ''}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
            {count != null && count > 0 && <span className="service-detail-tab-badge">{count}</span>}
          </button>
        ))}
      </nav>

      <section className="service-detail-panel">
        {activeTab === 'overview' && (
          <OverviewTab
            service={service!}
            endpoints={data.endpoints}
            issues={data.issues}
            upstream={data.upstream}
            downstream={data.downstream}
            onNavigateTab={setTab}
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
}

function ServiceIdentityCard({
  identity,
  loading,
}: {
  identity: ServiceIdentity;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const hasContent =
    identity.techStack ||
    identity.containerImages.length > 0 ||
    identity.cluster ||
    identity.cloudSummary ||
    identity.nodeSummaries.length > 0 ||
    identity.instrumentation !== 'Unknown';

  if (!loading && !hasContent) return null;

  return (
    <section className="service-detail-identity card" aria-label={t('Service details')}>
      <h2>{t('Service details')}</h2>
      {loading && !hasContent ? (
        <LoadingState height={80} label={t('Loading service details…')} />
      ) : (
        <dl className="service-detail-identity-grid">
          <IdentityFact label={t('Tech stack')} value={identity.techStack || '—'} />
          <IdentityFact
            label={t('Containers')}
            value={
              identity.containerImages.length > 0
                ? identity.containerImages.join(', ')
                : '—'
            }
            mono={identity.containerImages.length > 0}
          />
          <IdentityFact label={t('Cluster')} value={identity.cluster || '—'} />
          <IdentityFact label={t('Namespace')} value={identity.namespace} />
          <IdentityFact label={t('Cloud / VM')} value={identity.cloudSummary || '—'} />
          <IdentityFact
            label={t('Nodes')}
            value={
              identity.nodeSummaries.length > 0
                ? identity.nodeSummaries.join(' · ')
                : '—'
            }
          />
          <IdentityFact label={t('Instrumentation')} value={identity.instrumentation} />
        </dl>
      )}
    </section>
  );
}

function IdentityFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="service-detail-identity-item">
      <dt>{label}</dt>
      <dd className={mono ? 'service-detail-identity-mono' : undefined} title={value}>
        {value}
      </dd>
    </div>
  );
}

function InstancesPanel({ pods, loading }: { pods: PodMetricInfo[]; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="service-detail-instances card">
      <h2>{t('Instances')}</h2>
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
                  <td><code>{pod.name}</code></td>
                  <td>
                    {pod.containerImages && pod.containerImages.length > 0 ? (
                      <span className="service-detail-muted" title={pod.containerImages.join(', ')}>
                        {pod.containerImages.join(', ')}
                      </span>
                    ) : '—'}
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

function OverviewTab({
  service,
  endpoints,
  issues,
  upstream,
  downstream,
  onNavigateTab,
}: {
  service: ServiceStats;
  endpoints: EndpointStat[];
  issues: ErrorGroup[];
  upstream: ServiceEdge[];
  downstream: ServiceEdge[];
  onNavigateTab: (tab: DetailTab) => void;
}) {
  const { t } = useTranslation();
  const issueCount = issues.reduce((s, i) => s + i.count, 0);

  return (
    <div className="service-detail-overview">
      <div className="service-detail-summary card">
        <h3>{t('Summary')}</h3>
        <p>
          {formatThroughput(service.requestCount)} · p95 {formatDuration(service.p95Ms)} ·{' '}
          {formatPercent(service.errorRate)} {t('errors')}
        </p>
      </div>

      <div className="service-detail-chips">
        <button type="button" className="service-detail-chip" onClick={() => onNavigateTab('transactions')}>
          <ListTree size={14} />
          {t('Transactions')}
          <em>{endpoints.length}</em>
        </button>
        <button type="button" className="service-detail-chip" onClick={() => onNavigateTab('dependencies')}>
          <GitBranch size={14} />
          {t('Dependencies')}
          <em>{upstream.length + downstream.length}</em>
        </button>
        <button type="button" className="service-detail-chip" onClick={() => onNavigateTab('errors')}>
          <AlertTriangle size={14} />
          {t('Errors')}
          <em>{issueCount}</em>
        </button>
        <button type="button" className="service-detail-chip" onClick={() => onNavigateTab('metrics')}>
          <BarChart3 size={14} />
          {t('Metrics')}
        </button>
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
                <td><strong>{op}</strong></td>
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
      <DependencyList title={t('Downstream')} subtitle={t('Services this service calls')} edges={downstream} />
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
                <span>{formatCompact(edge.callCount)} {t('calls')}</span>
                <span>{formatCompact(edge.errorCount)} {t('errors')}</span>
                <span>{formatDuration(edge.avgDurationMs)} {t('avg')}</span>
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
                ) : '—'}
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
          <p>
            {t('Runtime JVM metrics are not collected yet (OTel metrics export is off).')}
          </p>
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

  const cloudParts = new Set<string>();
  const nodeSummaries: string[] = [];
  for (const name of [...nodeNames].sort()) {
    const node = nodeByName.get(name);
    const parts: string[] = [name];
    if (node) {
      const vmParts = [node.cloudProvider, node.region, node.zone, node.instanceType]
        .filter(Boolean)
        .map(String);
      if (vmParts.length > 0) {
        parts.push(`(${vmParts.join(' / ')})`);
        cloudParts.add(vmParts.join(' / '));
      } else if (node.role) {
        parts.push(`(${node.role})`);
      }
    }
    nodeSummaries.push(parts.join(' '));
  }

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

  return {
    techStack,
    containerImages,
    cluster: service?.cluster || null,
    namespace,
    cloudSummary: cloudParts.size > 0 ? [...cloudParts].join(' · ') : null,
    nodeSummaries,
    instrumentation,
  };
}

function podMatchesService(pod: PodMetricInfo, serviceName: string): boolean {
  const labels = pod.labels || {};
  const appName = labels['app.kubernetes.io/name'] || labels.app || labels.name;
  if (appName === serviceName) return true;
  if (pod.name === serviceName) return true;
  if (pod.name.startsWith(`${serviceName}-`)) return true;
  return false;
}

function deriveHealth(service: ServiceStats) {
  const errorRate =
    service.requestCount > 0
      ? (service.errorCount / service.requestCount) * 100
      : service.errorRate;
  const healthScore = finiteNumber(service.healthScore)
    ? service.healthScore
    : inferHealthScore(service.requestCount, errorRate, service.p95Ms, service.p99Ms);
  const apdex = finiteNumber(service.apdex)
    ? service.apdex
    : inferApdex(service.requestCount, errorRate, service.p50Ms, service.p95Ms, service.p99Ms);
  const status = service.status || inferStatus(service.requestCount, healthScore);
  return {
    healthScore: clamp(healthScore, 0, 100),
    apdex: clamp(apdex, 0, 1),
    status,
    label: healthLabel(status, healthScore),
  };
}

function healthLabel(status: string, score: number): string {
  if (status === 'unknown') return 'No traffic';
  if (status === 'critical' || score < 70) return 'Critical';
  if (status === 'degraded' || score < 90) return 'Degraded';
  return 'Healthy';
}

function healthToneToKind(status: string, score: number): string {
  if (status === 'unknown') return 'neutral';
  if (status === 'critical' || score < 70) return 'critical';
  if (status === 'degraded' || score < 90) return 'warning';
  return 'healthy';
}

function healthKpiTone(status: string, score: number): MiniTrendTone {
  if (status === 'unknown') return 'neutral';
  if (status === 'critical' || score < 70) return 'critical';
  if (status === 'degraded' || score < 90) return 'warning';
  return 'healthy';
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

function inferHealthScore(requestCount: number, errorRate: number, p95Ms: number, p99Ms: number) {
  if (requestCount <= 0) return 100;
  const latencyPenalty = Math.min(30, Math.max(0, p95Ms - 300) / 30) + Math.min(15, Math.max(0, p99Ms - 1200) / 120);
  const errorPenalty = Math.min(70, errorRate * 4.5);
  return clamp(100 - latencyPenalty - errorPenalty, 0, 100);
}

function inferApdex(requestCount: number, errorRate: number, p50Ms: number, p95Ms: number, p99Ms: number) {
  if (requestCount <= 0) return 1;
  let score = 1;
  if (p50Ms > 300) score -= Math.min(0.3, ((p50Ms - 300) / 300) * 0.2);
  if (p95Ms > 300) score -= Math.min(0.25, ((p95Ms - 300) / 900) * 0.25);
  if (p95Ms > 1200) score -= Math.min(0.25, ((p95Ms - 1200) / 1200) * 0.25);
  if (p99Ms > 2400) score -= Math.min(0.1, ((p99Ms - 2400) / 2400) * 0.1);
  return clamp(score - Math.min(0.4, (errorRate / 100) * 0.75), 0, 1);
}

function inferStatus(requestCount: number, healthScore: number): string {
  if (requestCount <= 0) return 'unknown';
  if (healthScore >= 90) return 'healthy';
  if (healthScore >= 70) return 'degraded';
  return 'critical';
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
