import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { DatabaseQueryMetric, NamespaceStats, ServiceErrorSeries, ServiceStats, TimeseriesData } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import { useTranslation } from '../utils/i18n';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
}

type ToneName = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';

interface SignalMetric {
  label: string;
  value: string;
  detail: string;
  tone: ToneName;
  icon: IconName;
  trend?: number[];
}

type IconName =
  | 'activity'
  | 'apdex'
  | 'database'
  | 'errors'
  | 'latency'
  | 'namespace'
  | 'pods'
  | 'services'
  | 'shield'
  | 'traffic';

const chartWidth = 720;
const chartHeight = 250;
const chartLeft = 54;
const chartRight = 22;
const chartTop = 22;
const chartBottom = 38;
const trafficColor = '#2563eb';
const errorColor = '#e11d48';
const latencyColor = '#0891b2';
const tailLatencyColor = '#d97706';
const dbColor = '#7c3aed';
const dbLatencyColor = '#059669';

export default function Dashboard({ namespaces, selectedNamespace, onSelectNamespace }: DashboardProps) {
  const { t } = useTranslation();
  const [dbMetrics, setDbMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [trafficHover, setTrafficHover] = useState<number | null>(null);
  const [latencyHover, setLatencyHover] = useState<number | null>(null);
  const [dbHover, setDbHover] = useState<number | null>(null);
  const [heatmapHover, setHeatmapHover] = useState<{ svcIdx: number; timeIdx: number } | null>(null);
  const [heatmapTooltipPos, setHeatmapTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  const loadDbMetrics = useCallback(async () => {
    try {
      const data = await api.getDatabaseMetrics(selectedNamespace || undefined);
      setDbMetrics(data.metrics || []);
    } catch (err) {
      console.error('load db metrics in dashboard:', err);
      setDbMetrics([]);
    }
  }, [selectedNamespace]);

  const loadTimeseries = useCallback(async () => {
    try {
      const data = await api.getTimeseries(selectedNamespace || undefined, 60);
      setTimeseries(data);
    } catch (err) {
      console.error('load timeseries:', err);
      setTimeseries({ buckets: [], serviceErrors: [], windowMinutes: 60 });
    }
  }, [selectedNamespace]);

  useEffect(() => {
    loadDbMetrics();
  }, [loadDbMetrics]);

  useEffect(() => {
    setTimeseries(null);
    loadTimeseries();
    const interval = setInterval(loadTimeseries, 30000);
    return () => clearInterval(interval);
  }, [loadTimeseries]);

  const filteredNamespaces = useMemo(
    () => (selectedNamespace ? namespaces.filter(ns => ns.namespace === selectedNamespace) : namespaces),
    [namespaces, selectedNamespace]
  );

  const services = useMemo(
    () => filteredNamespaces.flatMap(ns => ns.services || []).filter(service => !service.isInfrastructure),
    [filteredNamespaces]
  );

  const buckets = timeseries?.buckets || [];
  const serviceErrors = useMemo(
    () => rankServiceErrors(timeseries?.serviceErrors || []),
    [timeseries]
  );
  const tsLoading = timeseries === null;
  const hasTraffic = buckets.some(bucket => bucket.spans > 0 || bucket.errors > 0 || bucket.dbCalls > 0);
  const timeLabels = buckets.map(bucket => bucket.label);

  const serviceRequests = services.reduce((sum, service) => sum + service.requestCount, 0);
  const serviceErrorsTotal = services.reduce((sum, service) => sum + service.errorCount, 0);
  const totalPods = filteredNamespaces.reduce((sum, ns) => sum + ns.podCount, 0);
  const namespaceCount = selectedNamespace ? 1 : namespaces.length;
  const avgP50 = weightedServiceValue(services, service => service.p50Ms);
  const avgP95 = weightedServiceValue(services, service => service.p95Ms);
  const avgP99 = weightedServiceValue(services, service => service.p99Ms);
  const apdex = weightedServiceValue(services, service => service.apdex ?? inferApdex(service), 1);

  const dbCalls = dbMetrics.reduce((sum, metric) => sum + metric.callCount, 0);
  const dbErrors = dbMetrics.reduce((sum, metric) => sum + metric.errorCount, 0);
  const dbErrorRate = dbCalls > 0 ? (dbErrors / dbCalls) * 100 : 0;
  const avgDbLatency = weightedBy(dbMetrics, metric => metric.avgDurationMs, metric => metric.callCount);

  const trafficData = buckets.map(bucket => Math.max(0, bucket.spans));
  const trafficErrorData = buckets.map(bucket => Math.max(0, bucket.errors));
  const successData = buckets.map(bucket => Math.max(0, bucket.spans - bucket.errors));
  const latencyAvgData = buckets.map(bucket => bucket.avgMs);
  const latencyP99Data = buckets.map(bucket => bucket.p99Ms);
  const dbVolumeData = buckets.map(bucket => bucket.dbCalls);
  const dbLatencyData = buckets.map(bucket => bucket.dbAvgMs);
  const timeseriesRequests = trafficData.reduce((sum, value) => sum + value, 0);
  const timeseriesErrors = trafficErrorData.reduce((sum, value) => sum + value, 0);
  const totalRequests = serviceRequests > 0 ? serviceRequests : timeseriesRequests;
  const totalErrors = serviceRequests > 0 ? serviceErrorsTotal : timeseriesErrors;
  const activeServicesCount = services.length || serviceErrors.length;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const serviceHealthScore = weightedServiceValue(services, service => service.healthScore ?? inferHealthScore(service), 100);
  const healthScore = services.length > 0 ? serviceHealthScore : clamp(100 - Math.min(70, errorRate * 4.5), 0, 100);
  const healthTone = getHealthTone(healthScore, totalRequests);

  const riskServices = useMemo(() => {
    return [...services]
      .sort((a, b) => serviceRiskScore(b) - serviceRiskScore(a))
      .slice(0, 6);
  }, [services]);

  const slowDbQueries = useMemo(() => {
    return [...dbMetrics]
      .sort((a, b) => b.avgDurationMs * Math.max(b.callCount, 1) - a.avgDurationMs * Math.max(a.callCount, 1))
      .slice(0, 5);
  }, [dbMetrics]);

  const signalMetrics: SignalMetric[] = [
    {
      label: t('Traffic'),
      value: formatMetric(totalRequests, 'count'),
      detail: `${formatMetric(totalErrors, 'count')} ${t('errors')} / ${formatPercent(errorRate)}`,
      tone: errorRate > 5 ? 'critical' : errorRate > 1 ? 'warning' : 'healthy',
      icon: 'traffic',
      trend: trafficData,
    },
    {
      label: t('P99 Latency'),
      value: formatMetric(avgP99, 'latency'),
      detail: `${t('P50')} ${formatMetric(avgP50, 'latency')} / ${t('P95')} ${formatMetric(avgP95, 'latency')}`,
      tone: avgP99 > 1200 ? 'critical' : avgP99 > 500 ? 'warning' : 'info',
      icon: 'latency',
      trend: latencyP99Data,
    },
    {
      label: t('Apdex'),
      value: apdex.toFixed(2),
      detail: apdex >= 0.94 ? t('Satisfied users') : apdex >= 0.85 ? t('Needs attention') : t('User pain likely'),
      tone: apdex >= 0.94 ? 'healthy' : apdex >= 0.85 ? 'warning' : 'critical',
      icon: 'apdex',
    },
    {
      label: t('Database'),
      value: formatMetric(dbCalls, 'count'),
      detail: `${formatMetric(avgDbLatency, 'latency')} ${t('avg')} / ${formatPercent(dbErrorRate)} ${t('errors')}`,
      tone: dbErrorRate > 2 ? 'critical' : avgDbLatency > 400 ? 'warning' : 'neutral',
      icon: 'database',
      trend: dbVolumeData,
    },
  ];

  const namespaceOptions = namespaces.map(ns => ns.namespace).sort((a, b) => a.localeCompare(b));

  return (
    <div className="dashboard-page apm-dashboard animate-fade-in">
      <section className="apm-dashboard-header">
        <div className="apm-title-block">
          <span className="apm-eyebrow">{t('Telemetry Visibility')}</span>
          <h1>{selectedNamespace || t('All services')}</h1>
        </div>

        <div className="apm-header-meta">
          <div className="apm-live-pill">
            <span />
            {t('Live')}
          </div>
          <div className="apm-meta-item">
            <span>{t('Window')}</span>
            <strong>{timeseries?.windowMinutes || 60}m</strong>
          </div>
          <div className="apm-meta-item">
            <span>{t('Scope')}</span>
            <strong>{selectedNamespace || t('All namespaces')}</strong>
          </div>
        </div>
      </section>

      {namespaceOptions.length > 0 && (
        <section className="apm-scope-strip" aria-label={t('Namespace scope')}>
          <span className="apm-scope-label">{t('Namespace')}</span>
          <button
            type="button"
            className={!selectedNamespace ? 'active' : ''}
            onClick={() => onSelectNamespace('')}
          >
            {t('All')}
          </button>
          {namespaceOptions.slice(0, 7).map(ns => (
            <button
              key={ns}
              type="button"
              className={selectedNamespace === ns ? 'active' : ''}
              onClick={() => onSelectNamespace(ns)}
              title={ns}
            >
              {ns}
            </button>
          ))}
          {namespaceOptions.length > 7 && (
            <CustomSelect
              className="apm-more-namespace-select"
              ariaLabel={t('More namespaces')}
              value={namespaceOptions.slice(7).includes(selectedNamespace) ? selectedNamespace : ''}
              onChange={onSelectNamespace}
              options={[
                { value: '', label: t('More') },
                ...namespaceOptions.slice(7).map(ns => ({ value: ns, label: ns })),
              ]}
            />
          )}
        </section>
      )}

      <section className="apm-overview-grid">
        <HealthPanel
          score={healthScore}
          tone={healthTone}
          totalRequests={totalRequests}
          errorRate={errorRate}
          services={activeServicesCount}
          namespaces={namespaceCount}
          pods={totalPods}
        />

        <div className="apm-signal-grid">
          {signalMetrics.map(metric => (
            <SignalCard key={metric.label} metric={metric} />
          ))}
        </div>
      </section>

      <section className="apm-chart-grid">
        <ChartPanel
          title={t('Traffic & Errors')}
          subtitle={t('Successful and failed spans over time')}
          legend={[
            { label: t('Successful'), color: trafficColor },
            { label: t('Errors'), color: errorColor },
          ]}
        >
          <TrafficChart
            successData={successData}
            errorData={trafficErrorData}
            labels={timeLabels}
            hoverIndex={trafficHover}
            setHoverIndex={setTrafficHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Latency Percentiles')}
          subtitle={t('Average latency compared with tail latency')}
          legend={[
            { label: t('Average'), color: latencyColor },
            { label: t('P99'), color: tailLatencyColor, dashed: true },
          ]}
        >
          <LineChart
            primary={latencyAvgData}
            secondary={latencyP99Data}
            labels={timeLabels}
            primaryLabel={t('Average')}
            secondaryLabel={t('P99')}
            unit="latency"
            primaryColor={latencyColor}
            secondaryColor={tailLatencyColor}
            hoverIndex={latencyHover}
            setHoverIndex={setLatencyHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Database Pressure')}
          subtitle={t('DB operations overlaid with latency')}
          legend={[
            { label: t('Calls'), color: dbColor },
            { label: t('Latency'), color: dbLatencyColor },
          ]}
        >
          <DatabaseChart
            calls={dbVolumeData}
            latency={dbLatencyData}
            labels={timeLabels}
            hoverIndex={dbHover}
            setHoverIndex={setDbHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Service Error Heatmap')}
          subtitle={t('Per-service error density across the same time window')}
          legend={[
            { label: t('Healthy'), color: '#10b981' },
            { label: t('Degraded'), color: '#f59e0b' },
            { label: t('Critical'), color: '#ef4444' },
          ]}
        >
          <ServiceHeatmap
            services={serviceErrors}
            labels={timeLabels}
            loading={tsLoading}
            hoverCell={heatmapHover}
            setHoverCell={setHeatmapHover}
            tooltipPos={heatmapTooltipPos}
            setTooltipPos={setHeatmapTooltipPos}
            containerRef={heatmapRef}
            t={t}
          />
        </ChartPanel>
      </section>

      <section className="apm-bottom-grid">
        <ListPanel title={t('Services Needing Attention')} subtitle={t('Sorted by health, errors, and tail latency')}>
          {riskServices.length === 0 ? (
            <NoDataState height={190} title={t('No service activity')} hint={t('Services appear once traces arrive.')} />
          ) : (
            <div className="apm-risk-list">
              {riskServices.map(service => {
                const serviceErrorRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
                const score = service.healthScore ?? inferHealthScore(service);
                const tone = getHealthTone(score, service.requestCount);
                return (
                  <div className="apm-risk-row" key={`${service.namespace}:${service.serviceName}`}>
                    <div className="apm-risk-main">
                      <div className={`apm-status-dot ${tone}`} />
                      <div>
                        <strong>{service.serviceName}</strong>
                        <span>{service.namespace}</span>
                      </div>
                    </div>
                    <div className="apm-risk-metrics">
                      <MetricPill label={t('Health')} value={service.requestCount > 0 ? score.toFixed(0) : '--'} tone={tone} />
                      <MetricPill label={t('Errors')} value={formatPercent(serviceErrorRate)} tone={serviceErrorRate > 5 ? 'critical' : serviceErrorRate > 0 ? 'warning' : 'healthy'} />
                      <MetricPill label={t('P99')} value={formatMetric(service.p99Ms, 'latency')} tone={service.p99Ms > 1200 ? 'critical' : service.p99Ms > 500 ? 'warning' : 'neutral'} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ListPanel>

        <ListPanel title={t('Database Hotspots')} subtitle={t('Highest query latency impact')}>
          {slowDbQueries.length === 0 ? (
            <NoDataState height={190} title={t('No database calls')} hint={t('Database activity appears after traced DB spans arrive.')} />
          ) : (
            <div className="apm-db-list">
              {slowDbQueries.map((metric, idx) => (
                <div className="apm-db-row" key={`${metric.namespace}:${metric.service}:${metric.system}:${idx}`}>
                  <div className="apm-db-index">{idx + 1}</div>
                  <div className="apm-db-main">
                    <strong>{metric.service}</strong>
                    <span>{metric.system || t('database')} / {metric.namespace}</span>
                    <code>{trimQuery(metric.query)}</code>
                  </div>
                  <div className="apm-db-metrics">
                    <MetricPill label={t('Avg')} value={formatMetric(metric.avgDurationMs, 'latency')} tone={metric.avgDurationMs > 500 ? 'warning' : 'neutral'} />
                    <MetricPill label={t('Calls')} value={formatMetric(metric.callCount, 'count')} tone="info" />
                    <MetricPill label={t('Err')} value={formatPercent(metric.errorRate)} tone={metric.errorRate > 0 ? 'critical' : 'healthy'} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ListPanel>
      </section>
    </div>
  );
}

function HealthPanel({
  score,
  tone,
  totalRequests,
  errorRate,
  services,
  namespaces,
  pods,
}: {
  score: number;
  tone: ToneName;
  totalRequests: number;
  errorRate: number;
  services: number;
  namespaces: number;
  pods: number;
}) {
  const circumference = 2 * Math.PI * 62;
  const offset = circumference - (score / 100) * circumference;
  const toneColor = toneColorFor(tone);

  return (
    <div className="apm-health-panel">
      <div className="apm-panel-topline">
        <div>
          <span>System health</span>
          <strong>{healthLabel(tone)}</strong>
        </div>
        <DashboardIcon name="shield" />
      </div>
      <div className="apm-health-body">
        <svg viewBox="0 0 160 160" className="apm-health-gauge" aria-hidden="true">
          <circle cx="80" cy="80" r="62" className="apm-gauge-track" />
          <circle
            cx="80"
            cy="80"
            r="62"
            className="apm-gauge-value"
            stroke={toneColor}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 80 80)"
          />
          <text x="80" y="78" textAnchor="middle" className="apm-gauge-number">{score.toFixed(0)}</text>
          <text x="80" y="98" textAnchor="middle" className="apm-gauge-label">score</text>
        </svg>
        <div className="apm-health-copy">
          <div className={`apm-status-badge ${tone}`}>{healthLabel(tone)}</div>
          <p>{formatMetric(totalRequests, 'count')} requests with {formatPercent(errorRate)} failures in scope.</p>
        </div>
      </div>
      <div className="apm-health-stats">
        <span><strong>{services}</strong> services</span>
        <span><strong>{namespaces}</strong> namespaces</span>
        <span><strong>{pods}</strong> pods</span>
      </div>
    </div>
  );
}

function SignalCard({ metric }: { metric: SignalMetric }) {
  return (
    <div className={`apm-signal-card ${metric.tone}`}>
      <div className="apm-signal-icon">
        <DashboardIcon name={metric.icon} />
      </div>
      <div className="apm-signal-content">
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <p>{metric.detail}</p>
      </div>
      {metric.trend && <MiniTrend data={metric.trend} tone={metric.tone} />}
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  legend,
  children,
}: {
  title: string;
  subtitle: string;
  legend: { label: string; color: string; dashed?: boolean }[];
  children: React.ReactNode;
}) {
  return (
    <div className="apm-chart-panel">
      <div className="apm-chart-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="apm-chart-legend">
          {legend.map(item => (
            <span key={item.label}>
              <i style={{ background: item.dashed ? 'transparent' : item.color, borderTop: item.dashed ? `2px dashed ${item.color}` : undefined }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

function TrafficChart({
  successData,
  errorData,
  labels,
  hoverIndex,
  setHoverIndex,
  loading,
  empty,
  t,
}: {
  successData: number[];
  errorData: number[];
  labels: string[];
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  loading: boolean;
  empty: boolean;
  t: (key: string) => string;
}) {
  const id = React.useId().replace(/:/g, '');
  const maxValue = Math.max(...successData.map((value, idx) => value + errorData[idx]), 1);
  const usableWidth = chartWidth - chartLeft - chartRight;
  const barStep = usableWidth / Math.max(successData.length, 1);
  const barWidth = Math.min(20, Math.max(6, barStep * 0.46));

  return (
    <div className="apm-chart-stage">
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="apm-svg-chart" onMouseLeave={() => setHoverIndex(null)}>
        <defs>
          <linearGradient id={`traffic-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor={trafficColor} />
          </linearGradient>
          <linearGradient id={`errors-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="100%" stopColor={errorColor} />
          </linearGradient>
        </defs>
        <ChartGrid maxValue={maxValue} unit="count" />
        {successData.map((success, idx) => {
          const errors = errorData[idx] || 0;
          const total = success + errors;
          const totalHeight = scaleY(total, maxValue);
          const errorHeight = scaleY(errors, maxValue);
          const successHeight = Math.max(0, totalHeight - errorHeight);
          const x = chartLeft + idx * barStep + (barStep - barWidth) / 2;
          const ySuccess = chartHeight - chartBottom - successHeight;
          const yError = ySuccess - errorHeight;
          const isActive = hoverIndex === idx;

          return (
            <g key={idx} onMouseEnter={() => setHoverIndex(idx)} className="apm-bar-group">
              <rect x={x - 5} y={chartTop} width={barWidth + 10} height={chartHeight - chartTop - chartBottom} rx="6" className={isActive ? 'apm-hover-rail active' : 'apm-hover-rail'} />
              {successHeight > 0 && <rect x={x} y={ySuccess} width={barWidth} height={successHeight} rx="5" fill={`url(#traffic-${id})`} opacity={hoverIndex === null || isActive ? 0.86 : 0.36} />}
              {errorHeight > 0 && <rect x={x} y={yError} width={barWidth} height={errorHeight} rx="5" fill={`url(#errors-${id})`} opacity={hoverIndex === null || isActive ? 0.92 : 0.42} />}
            </g>
          );
        })}
        <XAxis labels={labels} />
      </svg>
      {hoverIndex !== null && (
        <ChartTooltip leftPercent={tooltipPercent(hoverIndex, successData.length)}>
          <strong>{labels[hoverIndex]}</strong>
          <span>{t('Successful')}: {formatMetric(successData[hoverIndex], 'count')}</span>
          <span>{t('Errors')}: {formatMetric(errorData[hoverIndex], 'count')}</span>
          <span>{t('Error rate')}: {formatPercent(((errorData[hoverIndex] || 0) / Math.max(successData[hoverIndex] + (errorData[hoverIndex] || 0), 1)) * 100)}</span>
        </ChartTooltip>
      )}
    </div>
  );
}

function LineChart({
  primary,
  secondary,
  labels,
  primaryLabel,
  secondaryLabel,
  unit,
  primaryColor,
  secondaryColor,
  hoverIndex,
  setHoverIndex,
  loading,
  empty,
  t,
}: {
  primary: number[];
  secondary: number[];
  labels: string[];
  primaryLabel: string;
  secondaryLabel: string;
  unit: 'latency' | 'count';
  primaryColor: string;
  secondaryColor: string;
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  loading: boolean;
  empty: boolean;
  t: (key: string) => string;
}) {
  const id = React.useId().replace(/:/g, '');
  const maxValue = Math.max(...primary, ...secondary, 1);
  const primaryPoints = getPoints(primary, maxValue);
  const secondaryPoints = getPoints(secondary, maxValue);
  const hoverPoint = hoverIndex !== null ? primaryPoints[hoverIndex] : null;
  const secondaryHoverPoint = hoverIndex !== null ? secondaryPoints[hoverIndex] : null;

  return (
    <div className="apm-chart-stage">
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, primary.length))}
      >
        <defs>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.20" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <ChartGrid maxValue={maxValue} unit={unit} />
        <path d={smoothAreaPath(primaryPoints)} fill={`url(#area-${id})`} />
        <path d={smoothPath(primaryPoints)} fill="none" stroke={primaryColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d={smoothPath(secondaryPoints)} fill="none" stroke={secondaryColor} strokeWidth="2.3" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
        {hoverPoint && secondaryHoverPoint && (
          <g>
            <line x1={hoverPoint.x} y1={chartTop} x2={hoverPoint.x} y2={chartHeight - chartBottom} className="apm-crosshair" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" fill={primaryColor} className="apm-point-ring" />
            <circle cx={secondaryHoverPoint.x} cy={secondaryHoverPoint.y} r="5" fill={secondaryColor} className="apm-point-ring" />
          </g>
        )}
        <XAxis labels={labels} />
      </svg>
      {hoverIndex !== null && (
        <ChartTooltip leftPercent={tooltipPercent(hoverIndex, primary.length)}>
          <strong>{labels[hoverIndex]}</strong>
          <span>{primaryLabel}: {formatMetric(primary[hoverIndex], unit)}</span>
          <span>{secondaryLabel}: {formatMetric(secondary[hoverIndex], unit)}</span>
          <span>{t('Gap')}: {formatMetric(Math.max(0, secondary[hoverIndex] - primary[hoverIndex]), unit)}</span>
        </ChartTooltip>
      )}
    </div>
  );
}

function DatabaseChart({
  calls,
  latency,
  labels,
  hoverIndex,
  setHoverIndex,
  loading,
  empty,
  t,
}: {
  calls: number[];
  latency: number[];
  labels: string[];
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  loading: boolean;
  empty: boolean;
  t: (key: string) => string;
}) {
  const id = React.useId().replace(/:/g, '');
  const maxCalls = Math.max(...calls, 1);
  const maxLatency = Math.max(...latency, 1);
  const usableWidth = chartWidth - chartLeft - chartRight;
  const barStep = usableWidth / Math.max(calls.length, 1);
  const barWidth = Math.min(14, Math.max(5, barStep * 0.34));
  const latencyPoints = getPoints(latency, maxLatency);

  return (
    <div className="apm-chart-stage">
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, calls.length))}
      >
        <defs>
          <linearGradient id={`db-bars-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor={dbColor} />
          </linearGradient>
          <linearGradient id={`db-area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dbLatencyColor} stopOpacity="0.16" />
            <stop offset="100%" stopColor={dbLatencyColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <ChartGrid maxValue={maxCalls} unit="count" />
        <path d={smoothAreaPath(latencyPoints)} fill={`url(#db-area-${id})`} />
        {calls.map((value, idx) => {
          const height = scaleY(value, maxCalls);
          const x = chartLeft + idx * barStep + (barStep - barWidth) / 2;
          const y = chartHeight - chartBottom - height;
          return <rect key={idx} x={x} y={y} width={barWidth} height={height} rx="4" fill={`url(#db-bars-${id})`} opacity={hoverIndex === null || hoverIndex === idx ? 0.68 : 0.28} />;
        })}
        <path d={smoothPath(latencyPoints)} fill="none" stroke={dbLatencyColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {hoverIndex !== null && latencyPoints[hoverIndex] && (
          <g>
            <line x1={latencyPoints[hoverIndex].x} y1={chartTop} x2={latencyPoints[hoverIndex].x} y2={chartHeight - chartBottom} className="apm-crosshair" />
            <circle cx={latencyPoints[hoverIndex].x} cy={latencyPoints[hoverIndex].y} r="5" fill={dbLatencyColor} className="apm-point-ring" />
          </g>
        )}
        <XAxis labels={labels} />
        <text x={chartWidth - 14} y={chartTop + 4} textAnchor="end" className="apm-axis-text">{formatMetric(maxLatency, 'latency')}</text>
      </svg>
      {hoverIndex !== null && (
        <ChartTooltip leftPercent={tooltipPercent(hoverIndex, calls.length)}>
          <strong>{labels[hoverIndex]}</strong>
          <span>{t('DB Operations')}: {formatMetric(calls[hoverIndex], 'count')}</span>
          <span>{t('Avg Latency')}: {formatMetric(latency[hoverIndex], 'latency')}</span>
        </ChartTooltip>
      )}
    </div>
  );
}

function ServiceHeatmap({
  services,
  labels,
  loading,
  hoverCell,
  setHoverCell,
  tooltipPos,
  setTooltipPos,
  containerRef,
  t,
}: {
  services: ServiceErrorSeries[];
  labels: string[];
  loading: boolean;
  hoverCell: { svcIdx: number; timeIdx: number } | null;
  setHoverCell: (cell: { svcIdx: number; timeIdx: number } | null) => void;
  tooltipPos: { x: number; y: number } | null;
  setTooltipPos: (pos: { x: number; y: number } | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
  t: (key: string) => string;
}) {
  if (loading) {
    return <LoadingState height={235} label={t('Loading service health...')} />;
  }
  if (services.length === 0 || labels.length === 0) {
    return <NoDataState height={235} title={t('No service activity')} hint={t('Per-service errors appear once traffic flows.')} />;
  }

  return (
    <div
      className="apm-heatmap"
      ref={containerRef}
      onMouseLeave={() => {
        setHoverCell(null);
        setTooltipPos(null);
      }}
    >
      {services.slice(0, 9).map((service, svcIdx) => (
        <div className="apm-heatmap-row" key={`${service.namespace}:${service.service}`}>
          <div className="apm-heatmap-label" title={`${service.namespace}/${service.service}`}>{service.service}</div>
          <div className="apm-heatmap-cells">
            {labels.map((label, timeIdx) => {
              const spans = service.spans[timeIdx] || 0;
              const errors = service.errors[timeIdx] || 0;
              const cellTone = heatmapTone(spans, errors);
              const active = hoverCell?.svcIdx === svcIdx && hoverCell?.timeIdx === timeIdx;
              return (
                <button
                  key={label}
                  type="button"
                  className={`apm-heatmap-cell ${cellTone} ${active ? 'active' : ''}`}
                  onMouseEnter={() => setHoverCell({ svcIdx, timeIdx })}
                  onMouseMove={event => {
                    const container = containerRef.current;
                    if (!container) return;
                    const rect = container.getBoundingClientRect();
                    let x = event.clientX - rect.left + 16;
                    let y = event.clientY - rect.top + container.scrollTop + 16;
                    if (x + 250 > rect.width) x = event.clientX - rect.left - 260;
                    setTooltipPos({ x, y });
                  }}
                  aria-label={`${service.service} ${label}`}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="apm-heatmap-times">
        <span />
        {labels.map((label, idx) => (
          <em key={`${label}:${idx}`}>{idx % 3 === 0 ? label.split(':')[0] : ''}</em>
        ))}
      </div>
      {hoverCell && tooltipPos && services[hoverCell.svcIdx] && (
        <div className="apm-floating-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          {(() => {
            const service = services[hoverCell.svcIdx];
            const spans = service.spans[hoverCell.timeIdx] || 0;
            const errors = service.errors[hoverCell.timeIdx] || 0;
            const errorRate = spans > 0 ? (errors / spans) * 100 : 0;
            return (
              <>
                <strong>{service.service} / {labels[hoverCell.timeIdx]}</strong>
                <span>{t('Spans')}: {formatMetric(spans, 'count')}</span>
                <span>{t('Errors')}: {formatMetric(errors, 'count')} ({formatPercent(errorRate)})</span>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function ListPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="apm-list-panel">
      <div className="apm-list-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone: ToneName }) {
  return (
    <span className={`apm-metric-pill ${tone}`}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function MiniTrend({ data, tone }: { data: number[]; tone: ToneName }) {
  const width = 74;
  const height = 28;
  const maxValue = Math.max(...data, 1);
  const points = data.slice(-14).map((value, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * width;
    const y = height - (value / maxValue) * (height - 4) - 2;
    return { x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="apm-mini-trend" aria-hidden="true">
      <path d={linePath(points)} fill="none" stroke={toneColorFor(tone)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChartOverlay({ loading, empty, t }: { loading: boolean; empty: boolean; t: (key: string) => string }) {
  if (!loading && !empty) return null;
  return (
    <div className="apm-chart-overlay">
      {loading ? (
        <LoadingState height={185} label={t('Loading telemetry...')} />
      ) : (
        <NoDataState height={185} title={t('No traffic in the last hour')} hint={t('Appears once services send traces.')} />
      )}
    </div>
  );
}

function ChartGrid({ maxValue, unit }: { maxValue: number; unit: 'latency' | 'count' }) {
  const rows = [1, 0.5, 0];
  return (
    <g>
      {rows.map(row => {
        const y = chartTop + (1 - row) * (chartHeight - chartTop - chartBottom);
        return (
          <g key={row}>
            <line x1={chartLeft} y1={y} x2={chartWidth - chartRight} y2={y} className="apm-grid-line" />
            <text x={chartLeft - 12} y={y + 4} textAnchor="end" className="apm-axis-text">
              {formatMetric(maxValue * row, unit)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XAxis({ labels }: { labels: string[] }) {
  const usableWidth = chartWidth - chartLeft - chartRight;
  return (
    <g>
      {labels.map((label, idx) => {
        if (idx % 3 !== 0 && idx !== labels.length - 1) return null;
        const x = chartLeft + (idx * usableWidth) / Math.max(labels.length - 1, 1);
        return (
          <text key={`${label}:${idx}`} x={x} y={chartHeight - 12} textAnchor="middle" className="apm-axis-text">
            {label.split(':')[0]}h
          </text>
        );
      })}
    </g>
  );
}

function ChartTooltip({ leftPercent, children }: { leftPercent: number; children: React.ReactNode }) {
  return (
    <div className="apm-floating-tooltip" style={{ left: `${leftPercent}%`, top: 10 }}>
      {children}
    </div>
  );
}

function DashboardIcon({ name }: { name: IconName }) {
  const common = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  switch (name) {
    case 'activity':
      return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
    case 'apdex':
      return <svg {...common}><path d="M4 15a8 8 0 0 1 16 0" /><path d="M7 15h10" /><path d="M12 15l4.5-5.5" /><path d="M12 4v2" /><path d="M5.6 8.6 7 10" /><path d="m17 10 1.4-1.4" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v10c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" /><path d="M4 15c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case 'errors':
      return <svg {...common}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>;
    case 'latency':
      return <svg {...common}><path d="M9 2h6" /><path d="M12 6v6l3 2" /><circle cx="12" cy="14" r="8" /><path d="M18.4 7.6 20 6" /></svg>;
    case 'namespace':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case 'pods':
      return <svg {...common}><path d="M12 2 4 6.5v9L12 20l8-4.5v-9L12 2Z" /><path d="m4.5 7 7.5 4.2L19.5 7" /><path d="M12 20v-8.8" /></svg>;
    case 'services':
      return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="m8.4 8.2 2.4 6.1" /><path d="m15.6 8.2-2.4 6.1" /><path d="M9 6h6" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="M8 12h2l1.4-3.5L14 16l1.4-4H18" /></svg>;
    case 'traffic':
      return <svg {...common}><path d="M4 18V8" /><path d="M10 18v-5" /><path d="M16 18V6" /><path d="m4 8 6 5 6-7 4 3" /><path d="M20 9V5h-4" /></svg>;
    default:
      return <svg {...common}><path d="M3 12h18" /></svg>;
  }
}

function weightedServiceValue(services: ServiceStats[], getValue: (service: ServiceStats) => number, fallback = 0) {
  const totals = services.reduce(
    (acc, service) => {
      const weight = Math.max(service.requestCount, 1);
      const value = getValue(service);
      if (Number.isFinite(value)) {
        acc.value += value * weight;
        acc.weight += weight;
      }
      return acc;
    },
    { value: 0, weight: 0 }
  );
  return totals.weight > 0 ? totals.value / totals.weight : fallback;
}

function weightedBy<T>(items: T[], getValue: (item: T) => number, getWeight: (item: T) => number) {
  const totals = items.reduce(
    (acc, item) => {
      const weight = Math.max(getWeight(item), 0);
      acc.value += getValue(item) * weight;
      acc.weight += weight;
      return acc;
    },
    { value: 0, weight: 0 }
  );
  return totals.weight > 0 ? totals.value / totals.weight : 0;
}

function inferHealthScore(service: ServiceStats) {
  if (service.requestCount <= 0) return 100;
  const errRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
  const latencyPenalty = Math.min(30, Math.max(0, service.p95Ms - 300) / 30) + Math.min(15, Math.max(0, service.p99Ms - 1200) / 120);
  const errorPenalty = Math.min(70, errRate * 4.5);
  return clamp(100 - latencyPenalty - errorPenalty, 0, 100);
}

function inferApdex(service: ServiceStats) {
  if (service.requestCount <= 0) return 1;
  const errRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
  let score = 1;
  if (service.p50Ms > 300) score -= Math.min(0.3, ((service.p50Ms - 300) / 300) * 0.2);
  if (service.p95Ms > 300) score -= Math.min(0.25, ((service.p95Ms - 300) / 900) * 0.25);
  if (service.p95Ms > 1200) score -= Math.min(0.25, ((service.p95Ms - 1200) / 1200) * 0.25);
  if (service.p99Ms > 2400) score -= Math.min(0.1, ((service.p99Ms - 2400) / 2400) * 0.1);
  return clamp(score - Math.min(0.4, (errRate / 100) * 0.75), 0, 1);
}

function serviceRiskScore(service: ServiceStats) {
  const health = service.healthScore ?? inferHealthScore(service);
  const errRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
  return (100 - health) * 2 + errRate * 8 + Math.min(service.p99Ms / 40, 50);
}

function rankServiceErrors(services: ServiceErrorSeries[]) {
  return [...services].sort((a, b) => {
    const aErrors = a.errors.reduce((sum, value) => sum + value, 0);
    const bErrors = b.errors.reduce((sum, value) => sum + value, 0);
    const aSpans = a.spans.reduce((sum, value) => sum + value, 0);
    const bSpans = b.spans.reduce((sum, value) => sum + value, 0);
    return bErrors * 100 + bSpans - (aErrors * 100 + aSpans);
  });
}

function heatmapTone(spans: number, errors: number) {
  if (spans <= 0) return 'empty';
  const rate = errors / spans;
  if (errors >= 10 || rate >= 0.2) return 'critical';
  if (errors >= 3 || rate >= 0.05) return 'warning';
  if (errors > 0) return 'minor';
  return 'healthy';
}

function getHealthTone(score: number, totalRequests: number): ToneName {
  if (totalRequests <= 0) return 'neutral';
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  return 'critical';
}

function healthLabel(tone: ToneName) {
  if (tone === 'healthy') return 'Healthy';
  if (tone === 'warning') return 'Degraded';
  if (tone === 'critical') return 'Critical';
  return 'No traffic';
}

function toneColorFor(tone: ToneName) {
  switch (tone) {
    case 'healthy':
      return '#059669';
    case 'warning':
      return '#d97706';
    case 'critical':
      return '#e11d48';
    case 'info':
      return '#2563eb';
    default:
      return '#64748b';
  }
}

function scaleY(value: number, maxValue: number) {
  return (value / Math.max(maxValue, 1)) * (chartHeight - chartTop - chartBottom);
}

function getPoints(data: number[], maxValue: number) {
  const usableWidth = chartWidth - chartLeft - chartRight;
  return data.map((value, idx) => {
    const x = chartLeft + (idx * usableWidth) / Math.max(data.length - 1, 1);
    const y = chartHeight - chartBottom - (value / Math.max(maxValue, 1)) * (chartHeight - chartTop - chartBottom);
    return { x, y };
  });
}

function linePath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  return points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return linePath(points);
  const [first, ...rest] = points;
  return rest.reduce((path, point, idx) => {
    const prev = points[idx];
    const midX = (prev.x + point.x) / 2;
    return `${path} Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${midX.toFixed(2)} ${((prev.y + point.y) / 2).toFixed(2)}${idx === rest.length - 1 ? ` T ${point.x.toFixed(2)} ${point.y.toFixed(2)}` : ''}`;
  }, `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);
}

function areaPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  const baseY = chartHeight - chartBottom;
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x.toFixed(2)} ${baseY} ${points.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} L ${last.x.toFixed(2)} ${baseY} Z`;
}

function smoothAreaPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length < 2) return areaPath(points);
  const baseY = chartHeight - chartBottom;
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x.toFixed(2)} ${baseY} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} ${smoothPath(points).replace(/^M [^QTL]+/, '')} L ${last.x.toFixed(2)} ${baseY} Z`;
}

function indexFromMouse(event: React.MouseEvent<SVGSVGElement>, length: number) {
  if (length <= 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const usableWidth = rect.width - (chartLeft / chartWidth) * rect.width - (chartRight / chartWidth) * rect.width;
  const left = (chartLeft / chartWidth) * rect.width;
  const percent = clamp((x - left) / Math.max(usableWidth, 1), 0, 1);
  return Math.round(percent * (length - 1));
}

function tooltipPercent(index: number, length: number) {
  if (length <= 1) return 50;
  return 8 + (index / (length - 1)) * 84;
}

function formatMetric(value: number, metric: 'count' | 'latency') {
  if (!Number.isFinite(value)) return metric === 'latency' ? '0ms' : '0';
  if (metric === 'latency') {
    if (value < 1) return `${(value * 1000).toFixed(0)}us`;
    if (value < 1000) return `${value.toFixed(value < 10 ? 1 : 0)}ms`;
    return `${(value / 1000).toFixed(2)}s`;
  }
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function trimQuery(query: string) {
  if (!query) return 'unknown query';
  const normalized = query.replace(/\s+/g, ' ').trim();
  return normalized.length > 92 ? `${normalized.slice(0, 92)}...` : normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
