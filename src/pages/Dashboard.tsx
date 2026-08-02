import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { DatabaseQueryMetric, LatencyDistribution, NamespaceStats, ServiceErrorSeries, ServiceStats, TimeseriesData } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import { useTranslation } from '../utils/i18n';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
}

type ToneName = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';

interface SignalMetric {
  label: string;
  value: string;
  detail: string;
  tone: ToneName;
  icon: IconName;
  trend?: number[];
  progress?: number;
  featured?: boolean;
}

type IconName = 'activity' | 'apdex' | 'database' | 'errors' | 'latency' | 'services' | 'shield' | 'traffic';

const chartWidth = 720;
const chartHeight = 250;
const chartLeft = 54;
const chartRight = 22;
const chartTop = 22;
const chartBottom = 38;
const trafficColor = 'var(--chart-blue)';
const errorColor = 'var(--chart-rose)';
const latencyColor = 'var(--chart-cyan)';
const tailLatencyColor = 'var(--chart-purple)';
const dbColor = 'var(--chart-purple)';
const dbLatencyColor = 'var(--chart-cyan)';

export default function Dashboard({ namespaces, selectedNamespace }: DashboardProps) {
  const { t } = useTranslation();
  const [dbMetrics, setDbMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [latencyDist, setLatencyDist] = useState<LatencyDistribution | null>(null);
  const [timeseriesHover, setTimeseriesHover] = useState<number | null>(null);
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

  const loadLatencyDist = useCallback(async () => {
    try {
      const data = await api.getLatencyDistribution(selectedNamespace || undefined, 60);
      setLatencyDist(data);
    } catch (err) {
      console.error('load latency distribution:', err);
      setLatencyDist({ buckets: [], p50Ms: 0, p95Ms: 0, p99Ms: 0, total: 0, windowMinutes: 60 });
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

  useEffect(() => {
    setLatencyDist(null);
    loadLatencyDist();
    const interval = setInterval(loadLatencyDist, 30000);
    return () => clearInterval(interval);
  }, [loadLatencyDist]);

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
  const avgP50 = weightedServiceValue(services, service => service.p50Ms);
  const avgP95 = weightedServiceValue(services, service => service.p95Ms);
  const avgP99 = weightedServiceValue(services, service => service.p99Ms);
  const apdex = weightedServiceValue(services, service => service.apdex ?? inferApdex(service), 1);

  const dbCalls = dbMetrics.reduce((sum, metric) => sum + metric.callCount, 0);
  const dbErrors = dbMetrics.reduce((sum, metric) => sum + metric.errorCount, 0);
  const dbErrorRate = dbCalls > 0 ? (dbErrors / dbCalls) * 100 : 0;

  const trafficData = buckets.map(bucket => Math.max(0, bucket.spans));
  const trafficErrorData = buckets.map(bucket => Math.max(0, bucket.errors));
  const successData = buckets.map(bucket => Math.max(0, bucket.spans - bucket.errors));
  const errorRateData = buckets.map(bucket => bucket.spans > 0 ? (bucket.errors / bucket.spans) * 100 : 0);
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
  const recentErrorRate = average(errorRateData.slice(-3));
  const recentP99 = average(latencyP99Data.slice(-3));
  const peakDbLatency = Math.max(...dbLatencyData, 0);
  const latencyBreaches = latencyP99Data.filter(value => value > 1200).length;
  const dbLatencyBreaches = dbLatencyData.filter(value => value > 400).length;
  const affectedServices = serviceErrors.filter(service => service.errors.some(value => value > 0)).length;
  const successfulRequests = Math.max(0, totalRequests - totalErrors);
  const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;
  const serviceHealthMix = services.reduce(
    (mix, service) => {
      const tone = getHealthTone(service.healthScore ?? inferHealthScore(service), service.requestCount);
      if (tone === 'healthy') mix.healthy += 1;
      else if (tone === 'warning') mix.warning += 1;
      else if (tone === 'critical') mix.critical += 1;
      else mix.neutral += 1;
      return mix;
    },
    { healthy: 0, warning: 0, critical: 0, neutral: 0 }
  );
  const apdexTrend = buckets.length > 1
    ? buckets.map(bucket => inferIntervalApdex(bucket.spans, bucket.errors, bucket.avgMs, bucket.p99Ms))
    : [apdex, apdex];

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
      label: t('Health score'),
      value: healthScore.toFixed(0),
      detail: `${healthLabel(healthTone)} / ${activeServicesCount} ${t('services')}`,
      tone: healthTone,
      icon: 'shield',
      progress: healthScore,
      featured: true,
    },
    {
      label: t('Requests'),
      value: formatMetric(totalRequests, 'count'),
      detail: `${timeseries?.windowMinutes || 60}m ${t('window')}`,
      tone: 'info',
      icon: 'traffic',
      trend: trafficData,
    },
    {
      label: t('Error rate'),
      value: formatPercent(recentErrorRate),
      detail: `${formatPercent(errorRate)} ${t('window average')}`,
      tone: recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'healthy',
      icon: 'errors',
      trend: errorRateData,
    },
    {
      label: t('P99 Latency'),
      value: formatMetric(recentP99 || avgP99, 'latency'),
      detail: `${formatMetric(avgP99, 'latency')} ${t('window')} / ${latencyBreaches} ${t('breaches')}`,
      tone: (recentP99 || avgP99) > 1200 ? 'critical' : (recentP99 || avgP99) > 500 ? 'warning' : 'info',
      icon: 'latency',
      trend: latencyP99Data,
    },
    {
      label: t('Apdex'),
      value: apdex.toFixed(2),
      detail: apdex >= 0.94 ? t('Satisfied users') : apdex >= 0.85 ? t('Needs attention') : t('User pain likely'),
      tone: apdex >= 0.94 ? 'healthy' : apdex >= 0.85 ? 'warning' : 'critical',
      icon: 'apdex',
      trend: apdexTrend,
    },
    {
      label: t('Database'),
      value: formatMetric(peakDbLatency, 'latency'),
      detail: `${formatMetric(dbCalls, 'count')} ${t('calls')} / ${dbLatencyBreaches} ${t('slow intervals')}`,
      tone: peakDbLatency > 800 || dbErrorRate > 2 ? 'critical' : peakDbLatency > 400 ? 'warning' : 'neutral',
      icon: 'database',
      trend: dbVolumeData,
    },
  ];

  return (
    <div className="dashboard-page apm-dashboard animate-fade-in">
      <section className="apm-dashboard-header">
        <div className="apm-title-block">
          <span className="apm-title-icon">
            <DashboardIcon name="services" />
          </span>
          <h1>{t('Services overview')}</h1>
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
        </div>
      </section>

      <section className="apm-kpi-strip" aria-label={t('Application health metrics')}>
        {signalMetrics.map(metric => (
          <SignalCard key={metric.label} metric={metric} />
        ))}
      </section>

      <VisualOverview
        healthMix={serviceHealthMix}
        totalServices={activeServicesCount}
        successfulRequests={successfulRequests}
        failedRequests={totalErrors}
        successRate={successRate}
        traffic={trafficData}
        p50={latencyDist?.p50Ms || avgP50}
        p95={latencyDist?.p95Ms || avgP95}
        p99={latencyDist?.p99Ms || avgP99}
        t={t}
      />

      <section className="apm-chart-grid">
        <ChartPanel
          title={t('Request volume & error rate')}
          legend={[
            { label: t('Requests'), color: trafficColor },
            { label: t('Error rate'), color: errorColor, dashed: true },
          ]}
          summary={{
            label: t('Recent error rate'),
            value: formatPercent(recentErrorRate),
            tone: recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'healthy',
          }}
          tone={recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'info'}
        >
          <TrafficChart
            successData={successData}
            errorData={trafficErrorData}
            errorRateData={errorRateData}
            labels={timeLabels}
            hoverIndex={timeseriesHover}
            setHoverIndex={setTimeseriesHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Latency Percentiles')}
          legend={[
            { label: t('Average'), color: latencyColor },
            { label: t('P99'), color: tailLatencyColor },
          ]}
          summary={{
            label: t('Threshold breaches'),
            value: latencyBreaches.toLocaleString(),
            tone: recentP99 > 1200 || latencyBreaches > 3 ? 'critical' : latencyBreaches > 0 ? 'warning' : 'healthy',
          }}
          tone={recentP99 > 1200 || latencyBreaches > 3 ? 'critical' : latencyBreaches > 0 ? 'warning' : 'info'}
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
            hoverIndex={timeseriesHover}
            setHoverIndex={setTimeseriesHover}
            loading={tsLoading}
            empty={!hasTraffic}
            warningThreshold={500}
            criticalThreshold={1200}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Database Pressure')}
          legend={[
            { label: t('Calls'), color: dbColor },
            { label: t('Latency'), color: dbLatencyColor },
          ]}
          summary={{
            label: t('Peak latency'),
            value: formatMetric(peakDbLatency, 'latency'),
            tone: peakDbLatency > 800 ? 'critical' : peakDbLatency > 400 ? 'warning' : 'healthy',
          }}
          tone={peakDbLatency > 800 ? 'critical' : peakDbLatency > 400 ? 'warning' : 'info'}
        >
          <DatabaseChart
            calls={dbVolumeData}
            latency={dbLatencyData}
            labels={timeLabels}
            hoverIndex={timeseriesHover}
            setHoverIndex={setTimeseriesHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Service Error Heatmap')}
          legend={[
            { label: t('Healthy'), color: 'var(--chart-green)' },
            { label: t('Degraded'), color: 'var(--chart-amber)' },
            { label: t('Critical'), color: 'var(--chart-rose)' },
          ]}
          summary={{
            label: t('Affected'),
            value: affectedServices.toLocaleString(),
            tone: affectedServices > 3 ? 'critical' : affectedServices > 0 ? 'warning' : 'healthy',
          }}
          tone={affectedServices > 3 ? 'critical' : affectedServices > 0 ? 'warning' : 'healthy'}
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

      <section className="apm-distribution-section">
        <ChartPanel
          title={t('Latency Distribution')}
          legend={[
            { label: 'P50', color: 'var(--chart-green)' },
            { label: 'P95', color: 'var(--chart-amber)' },
            { label: 'P99', color: 'var(--chart-rose)' },
          ]}
          summary={{
            label: t('Tail spread'),
            value: avgP50 > 0 ? `${Math.max(1, avgP99 / avgP50).toFixed(1)}x` : '--',
            tone: avgP50 > 0 && avgP99 / avgP50 > 8 ? 'critical' : avgP50 > 0 && avgP99 / avgP50 > 4 ? 'warning' : 'healthy',
          }}
          tone={avgP50 > 0 && avgP99 / avgP50 > 8 ? 'critical' : avgP50 > 0 && avgP99 / avgP50 > 4 ? 'warning' : 'info'}
        >
          <LatencyHistogram data={latencyDist} loading={latencyDist === null} t={t} />
        </ChartPanel>
      </section>

      <section className="apm-bottom-grid">
        <ListPanel title={t('Services Needing Attention')} meta={`${riskServices.length} ${t('ranked')}`}>
          {riskServices.length === 0 ? (
            <NoDataState height={190} title={t('No service activity')} hint={t('Services appear once traces arrive.')} />
          ) : (
            <div className="apm-risk-list">
              {riskServices.map((service, index) => {
                const serviceErrorRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
                const score = service.healthScore ?? inferHealthScore(service);
                const tone = getHealthTone(score, service.requestCount);
                return (
                  <div className={`apm-risk-row ${tone}`} key={`${service.namespace}:${service.serviceName}`}>
                    <div className="apm-risk-rank">{index + 1}</div>
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

        <ListPanel title={t('Database Hotspots')} meta={`${slowDbQueries.length} ${t('queries')}`}>
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

function VisualOverview({
  healthMix,
  totalServices,
  successfulRequests,
  failedRequests,
  successRate,
  traffic,
  p50,
  p95,
  p99,
  t,
}: {
  healthMix: { healthy: number; warning: number; critical: number; neutral: number };
  totalServices: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  traffic: number[];
  p50: number;
  p95: number;
  p99: number;
  t: (key: string) => string;
}) {
  const mixTotal = healthMix.healthy + healthMix.warning + healthMix.critical + healthMix.neutral;
  const divisor = Math.max(mixTotal, 1);
  const healthyEnd = (healthMix.healthy / divisor) * 100;
  const warningEnd = healthyEnd + (healthMix.warning / divisor) * 100;
  const criticalEnd = warningEnd + (healthMix.critical / divisor) * 100;
  const donutBackground = mixTotal > 0
    ? `conic-gradient(
        var(--chart-green) 0% ${healthyEnd}%,
        var(--chart-amber) ${healthyEnd}% ${warningEnd}%,
        var(--chart-rose) ${warningEnd}% ${criticalEnd}%,
        var(--border-primary) ${criticalEnd}% 100%
      )`
    : 'conic-gradient(var(--border-primary) 0% 100%)';
  const maxLatency = Math.max(p50, p95, p99, 1);

  return (
    <section className="apm-visual-overview" aria-label={t('Operational overview')}>
      <article className="apm-visual-card apm-health-mix">
        <div className="apm-visual-card-head">
          <h2>{t('Service health')}</h2>
          <span>{totalServices} {t('services')}</span>
        </div>
        <div className="apm-health-mix-body">
          <div className="apm-donut" style={{ background: donutBackground }}>
            <div>
              <strong>{mixTotal > 0 ? Math.round(healthyEnd) : 0}%</strong>
              <span>{t('Healthy')}</span>
            </div>
          </div>
          <div className="apm-donut-legend">
            <span className="healthy"><i />{t('Healthy')}<strong>{healthMix.healthy}</strong></span>
            <span className="warning"><i />{t('Degraded')}<strong>{healthMix.warning}</strong></span>
            <span className="critical"><i />{t('Critical')}<strong>{healthMix.critical}</strong></span>
          </div>
        </div>
      </article>

      <article className="apm-visual-card apm-request-outcomes">
        <div className="apm-visual-card-head">
          <h2>{t('Request outcomes')}</h2>
          <span className={successRate >= 99 ? 'healthy' : successRate >= 95 ? 'warning' : 'critical'}>
            {formatPercent(successRate)} {t('success')}
          </span>
        </div>
        <PulseBars data={traffic} />
        <div className="apm-outcome-metrics">
          <span className="success">
            <em>{t('Successful')}</em>
            <strong>{formatMetric(successfulRequests, 'count')}</strong>
          </span>
          <span className="failed">
            <em>{t('Failed')}</em>
            <strong>{formatMetric(failedRequests, 'count')}</strong>
          </span>
        </div>
      </article>

      <article className="apm-visual-card apm-latency-profile">
        <div className="apm-visual-card-head">
          <h2>{t('Latency profile')}</h2>
          <span>{t('Percentiles')}</span>
        </div>
        <div className="apm-percentile-lanes">
          {[
            { label: 'P50', value: p50, tone: 'healthy' },
            { label: 'P95', value: p95, tone: 'warning' },
            { label: 'P99', value: p99, tone: 'critical' },
          ].map(item => (
            <div className={`apm-percentile-lane ${item.tone}`} key={item.label}>
              <span>{item.label}</span>
              <div><i style={{ width: `${Math.max(4, (item.value / maxLatency) * 100)}%` }} /></div>
              <strong>{formatMetric(item.value, 'latency')}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function SignalCard({ metric }: { metric: SignalMetric }) {
  const progress = clamp(metric.progress ?? 0, 0, 100);
  const ringColor = toneColorFor(metric.tone);
  return (
    <div className={`apm-signal-card ${metric.tone} ${metric.featured ? 'featured' : ''}`}>
      <div className="apm-signal-topline">
        <span className="apm-signal-label">
          <span className="apm-signal-icon-shell"><DashboardIcon name={metric.icon} /></span>
          <span>{metric.label}</span>
        </span>
        <i className="apm-signal-state" aria-hidden="true" />
      </div>
      {metric.featured ? (
        <div className="apm-featured-metric">
          <div
            className="apm-score-ring"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            style={{ background: `conic-gradient(${ringColor} 0% ${progress}%, var(--bg-tertiary) ${progress}% 100%)` }}
          >
            <span><strong>{metric.value}</strong><small>/100</small></span>
          </div>
          <p>{metric.detail}</p>
        </div>
      ) : (
        <>
          <div className="apm-signal-value-row">
            <strong>{metric.value}</strong>
            {metric.trend && <MiniTrend data={metric.trend} tone={metric.tone} />}
          </div>
          <p>{metric.detail}</p>
          {metric.progress !== undefined && (
            <span
              className="apm-kpi-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <i style={{ width: `${progress}%` }} />
            </span>
          )}
        </>
      )}
    </div>
  );
}

function PulseBars({ data }: { data: number[] }) {
  const values = data.slice(-18);
  const maxValue = Math.max(...values, 1);
  return (
    <div className="apm-pulse-bars" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={index}
          style={{ height: `${Math.max(8, (value / maxValue) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function ChartPanel({
  title,
  legend,
  summary,
  tone = 'info',
  children,
}: {
  title: string;
  legend: { label: string; color: string; dashed?: boolean }[];
  summary?: { label: string; value: string; tone: ToneName };
  tone?: ToneName;
  children: React.ReactNode;
}) {
  return (
    <div className={`apm-chart-panel ${tone}`}>
      <div className="apm-chart-header">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="apm-chart-context">
          {summary && (
            <div className={`apm-chart-summary ${summary.tone}`}>
              <span>{summary.label}</span>
              <strong>{summary.value}</strong>
            </div>
          )}
          <div className="apm-chart-legend">
            {legend.map(item => (
              <span key={item.label} style={{ '--legend-color': item.color } as React.CSSProperties}>
                <i style={{ background: item.dashed ? 'transparent' : item.color, borderTop: item.dashed ? `2px dashed ${item.color}` : undefined }} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function TrafficChart({
  successData,
  errorData,
  errorRateData,
  labels,
  hoverIndex,
  setHoverIndex,
  loading,
  empty,
  t,
}: {
  successData: number[];
  errorData: number[];
  errorRateData: number[];
  labels: string[];
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  loading: boolean;
  empty: boolean;
  t: (key: string) => string;
}) {
  const totalData = successData.map((value, idx) => value + (errorData[idx] || 0));
  const maxValue = Math.max(...totalData, 1);
  const trafficPoints = getPoints(totalData, maxValue);
  const maxErrorRate = Math.max(...errorRateData, 6);
  const ratePoints = getPoints(errorRateData, maxErrorRate);
  const usableWidth = chartWidth - chartLeft - chartRight;
  const barStep = usableWidth / Math.max(totalData.length, 1);
  const barWidth = Math.min(28, Math.max(7, barStep * 0.58));
  const plotBottom = chartHeight - chartBottom;
  const activeTrafficPoint = hoverIndex !== null ? trafficPoints[hoverIndex] : null;
  const activeRatePoint = hoverIndex !== null ? ratePoints[hoverIndex] : null;

  return (
    <div className="apm-chart-stage">
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, totalData.length))}
      >
        <defs>
          <linearGradient id="apm-db-bar-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-purple)" stopOpacity="0.96" />
            <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity="0.62" />
          </linearGradient>
          <linearGradient id="apm-db-latency-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-cyan)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-cyan)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <ThresholdZones
          maxValue={maxErrorRate}
          warningThreshold={1}
          criticalThreshold={5}
          axis="right"
          unit="percent"
        />
        <ChartGrid maxValue={maxValue} unit="count" />
        <g className="apm-request-bars">
          {totalData.map((_, idx) => {
            const successHeight = scaleY(successData[idx] || 0, maxValue);
            const errorHeight = scaleY(errorData[idx] || 0, maxValue);
            const x = chartLeft + idx * barStep + (barStep - barWidth) / 2;
            const dimmed = hoverIndex !== null && hoverIndex !== idx;
            return (
              <g key={idx} opacity={dimmed ? 0.28 : 1}>
                <rect
                  x={x}
                  y={plotBottom - successHeight}
                  width={barWidth}
                  height={successHeight}
                  rx="4"
                  className="apm-request-bar-success"
                />
                {errorHeight > 0 && (
                  <rect
                    x={x}
                    y={plotBottom - successHeight - errorHeight}
                    width={barWidth}
                    height={Math.max(errorHeight, 2)}
                    rx="3"
                    className="apm-request-bar-error"
                  />
                )}
              </g>
            );
          })}
        </g>
        <path d={smoothLinePath(ratePoints)} fill="none" stroke={errorColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="apm-error-rate-line" />
        {activeTrafficPoint && activeRatePoint && (
          <g>
            <line x1={activeRatePoint.x} y1={chartTop} x2={activeRatePoint.x} y2={chartHeight - chartBottom} className="apm-crosshair" />
            <circle cx={activeTrafficPoint.x} cy={activeTrafficPoint.y} r="4.5" fill={trafficColor} className="apm-point-ring" />
            <circle cx={activeRatePoint.x} cy={activeRatePoint.y} r="5.5" fill={errorColor} className="apm-point-ring" />
          </g>
        )}
        <XAxis labels={labels} />
        <text x={chartWidth - 2} y={chartTop + 4} textAnchor="end" className="apm-axis-title">error %</text>
      </svg>
      {hoverIndex !== null && (
        <ChartTooltip leftPercent={tooltipPercent(hoverIndex, successData.length)}>
          <strong>{labels[hoverIndex]}</strong>
          <span>{t('Requests')}: {formatMetric(totalData[hoverIndex], 'count')}</span>
          <span>{t('Failed')}: {formatMetric(errorData[hoverIndex], 'count')}</span>
          <span>{t('Error rate')}: {formatPercent(errorRateData[hoverIndex] || 0)}</span>
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
  warningThreshold,
  criticalThreshold,
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
  warningThreshold?: number;
  criticalThreshold?: number;
  t: (key: string) => string;
}) {
  const maxValue = Math.max(...primary, ...secondary, (criticalThreshold || warningThreshold || 0) * 1.12, 1);
  const primaryPoints = getPoints(primary, maxValue);
  const secondaryPoints = getPoints(secondary, maxValue);
  const percentileBand = rangeBandPath(primaryPoints, secondaryPoints);
  const hoverPoint = hoverIndex !== null ? primaryPoints[hoverIndex] : null;
  const secondaryHoverPoint = hoverIndex !== null ? secondaryPoints[hoverIndex] : null;
  const lastPrimaryPoint = primaryPoints[primaryPoints.length - 1];
  const lastSecondaryPoint = secondaryPoints[secondaryPoints.length - 1];

  return (
    <div className="apm-chart-stage">
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, primary.length))}
      >
        {warningThreshold !== undefined && criticalThreshold !== undefined && (
          <ThresholdZones
            maxValue={maxValue}
            warningThreshold={warningThreshold}
            criticalThreshold={criticalThreshold}
            axis="left"
            unit={unit}
          />
        )}
        <ChartGrid maxValue={maxValue} unit={unit} />
        <path d={percentileBand} fill={secondaryColor} className="apm-percentile-band" />
        <path d={areaPath(primaryPoints)} fill={primaryColor} className="apm-area-fill subtle" />
        <path d={smoothLinePath(primaryPoints)} fill="none" stroke={primaryColor} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d={smoothLinePath(secondaryPoints)} fill="none" stroke={secondaryColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        {lastPrimaryPoint && <circle cx={lastPrimaryPoint.x} cy={lastPrimaryPoint.y} r="3.5" fill={primaryColor} className="apm-series-endpoint" />}
        {lastSecondaryPoint && <circle cx={lastSecondaryPoint.x} cy={lastSecondaryPoint.y} r="3.5" fill={secondaryColor} className="apm-series-endpoint" />}
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
  const maxCalls = Math.max(...calls, 1);
  const maxLatency = Math.max(...latency, 880);
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
        <ThresholdZones
          maxValue={maxLatency}
          warningThreshold={400}
          criticalThreshold={800}
          axis="right"
          unit="latency"
        />
        <ChartGrid maxValue={maxCalls} unit="count" />
        <path d={areaPath(latencyPoints)} fill="url(#apm-db-latency-area)" className="apm-db-latency-fill" />
        {calls.map((value, idx) => {
          const height = scaleY(value, maxCalls);
          const x = chartLeft + idx * barStep + (barStep - barWidth) / 2;
          const y = chartHeight - chartBottom - height;
          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx="4"
              fill="url(#apm-db-bar-gradient)"
              className="apm-db-volume-bar"
              opacity={hoverIndex === null || hoverIndex === idx ? 0.9 : 0.24}
            />
          );
        })}
        <path d={smoothLinePath(latencyPoints)} fill="none" stroke={dbLatencyColor} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        {latencyPoints[latencyPoints.length - 1] && (
          <circle
            cx={latencyPoints[latencyPoints.length - 1].x}
            cy={latencyPoints[latencyPoints.length - 1].y}
            r="3.8"
            fill={dbLatencyColor}
            className="apm-series-endpoint"
          />
        )}
        {hoverIndex !== null && latencyPoints[hoverIndex] && (
          <g>
            <line x1={latencyPoints[hoverIndex].x} y1={chartTop} x2={latencyPoints[hoverIndex].x} y2={chartHeight - chartBottom} className="apm-crosshair" />
            <circle cx={latencyPoints[hoverIndex].x} cy={latencyPoints[hoverIndex].y} r="5" fill={dbLatencyColor} className="apm-point-ring" />
          </g>
        )}
        <XAxis labels={labels} />
        <text x={chartWidth - 2} y={chartTop + 4} textAnchor="end" className="apm-axis-title">latency</text>
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
          <span className={`apm-heatmap-total ${heatmapTone(
            service.spans.reduce((sum, value) => sum + value, 0),
            service.errors.reduce((sum, value) => sum + value, 0)
          )}`}>
            {formatMetric(service.errors.reduce((sum, value) => sum + value, 0), 'count')}
          </span>
        </div>
      ))}
      <div className="apm-heatmap-times">
        <span />
        <div className="apm-heatmap-times-cells">
          {labels.map((label, idx) => (
            <em key={`${label}:${idx}`}>{idx % 3 === 0 ? label : ''}</em>
          ))}
        </div>
        <em>{t('Errors')}</em>
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

function ListPanel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="apm-list-panel">
      <div className="apm-list-header">
        <h2>{title}</h2>
        {meta && <span>{meta}</span>}
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
  const color = toneColorFor(tone);
  const maxValue = Math.max(...data, 1);
  const points = data.slice(-14).map((value, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * width;
    const y = height - (value / maxValue) * (height - 4) - 2;
    return { x, y };
  });
  const fillPath = points.length > 0
    ? `M 0 ${height} ${points.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} L ${width} ${height} Z`
    : '';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="apm-mini-trend" aria-hidden="true">
      <path d={fillPath} fill={color} className="apm-mini-trend-fill" />
      <path d={linePath(points)} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
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
  const rows = [1, 2 / 3, 1 / 3, 0];
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

function ThresholdZones({
  maxValue,
  warningThreshold,
  criticalThreshold,
  axis,
  unit,
}: {
  maxValue: number;
  warningThreshold: number;
  criticalThreshold: number;
  axis: 'left' | 'right';
  unit: 'latency' | 'count' | 'percent';
}) {
  const plotBottom = chartHeight - chartBottom;
  const plotHeight = plotBottom - chartTop;
  const yFor = (value: number) => plotBottom - (clamp(value, 0, maxValue) / Math.max(maxValue, 1)) * plotHeight;
  const warningY = yFor(warningThreshold);
  const criticalY = yFor(criticalThreshold);
  const labelX = axis === 'right' ? chartWidth - chartRight - 5 : chartLeft + 5;
  const anchor = axis === 'right' ? 'end' : 'start';
  const formatThreshold = (value: number) => unit === 'percent' ? `${value}%` : formatMetric(value, unit);

  return (
    <g className="apm-threshold-zones">
      <rect
        x={chartLeft}
        y={chartTop}
        width={chartWidth - chartLeft - chartRight}
        height={Math.max(0, criticalY - chartTop)}
        className="apm-threshold-area critical"
      />
      <rect
        x={chartLeft}
        y={criticalY}
        width={chartWidth - chartLeft - chartRight}
        height={Math.max(0, warningY - criticalY)}
        className="apm-threshold-area warning"
      />
      <line x1={chartLeft} y1={warningY} x2={chartWidth - chartRight} y2={warningY} className="apm-threshold-line warning" />
      <line x1={chartLeft} y1={criticalY} x2={chartWidth - chartRight} y2={criticalY} className="apm-threshold-line critical" />
      <text x={labelX} y={warningY - 5} textAnchor={anchor} className="apm-threshold-label warning">
        {formatThreshold(warningThreshold)} warn
      </text>
      <text x={labelX} y={criticalY + 12} textAnchor={anchor} className="apm-threshold-label critical">
        {formatThreshold(criticalThreshold)} critical
      </text>
    </g>
  );
}

function XAxis({ labels }: { labels: string[] }) {
  const usableWidth = chartWidth - chartLeft - chartRight;
  const labelStep = Math.max(1, Math.ceil(labels.length / 5));
  return (
    <g>
      {labels.map((label, idx) => {
        if (idx % labelStep !== 0 && idx !== labels.length - 1) return null;
        const x = chartLeft + ((idx + 0.5) * usableWidth) / Math.max(labels.length, 1);
        return (
          <text key={`${label}:${idx}`} x={x} y={chartHeight - 12} textAnchor="middle" className="apm-axis-text">
            {label}
          </text>
        );
      })}
    </g>
  );
}

function DashboardIcon({ name }: { name: IconName }) {
  const iconMap: Record<IconName, string> = {
    activity: '/dashboard-icons/activity.svg',
    apdex: '/dashboard-icons/gauge.svg',
    database: '/dashboard-icons/database.svg',
    errors: '/dashboard-icons/alert-triangle.svg',
    latency: '/dashboard-icons/clock-bolt.svg',
    services: '/dashboard-icons/server.svg',
    shield: '/dashboard-icons/shield-check.svg',
    traffic: '/dashboard-icons/chart-arrows-vertical.svg',
  };

  return (
    <span
      className="dashboard-svg-icon"
      aria-hidden="true"
      style={{ '--dashboard-icon-url': `url("${iconMap[name]}")` } as React.CSSProperties}
    />
  );
}

function ChartTooltip({ leftPercent, children }: { leftPercent: number; children: React.ReactNode }) {
  return (
    <div className="apm-floating-tooltip" style={{ left: `${leftPercent}%`, top: 10 }}>
      {children}
    </div>
  );
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

function inferIntervalApdex(spans: number, errors: number, avgMs: number, p99Ms: number) {
  if (spans <= 0) return 1;
  const errorRate = errors / spans;
  let score = 1 - Math.min(0.4, errorRate * 0.75);
  if (avgMs > 300) score -= Math.min(0.35, ((avgMs - 300) / 900) * 0.28);
  if (p99Ms > 1200) score -= Math.min(0.2, ((p99Ms - 1200) / 2400) * 0.2);
  return clamp(score, 0, 1);
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
      return 'var(--accent-emerald)';
    case 'warning':
      return 'var(--accent-amber)';
    case 'critical':
      return 'var(--accent-rose)';
    case 'info':
      return 'var(--accent-indigo)';
    default:
      return 'var(--text-tertiary)';
  }
}

function scaleY(value: number, maxValue: number) {
  return (value / Math.max(maxValue, 1)) * (chartHeight - chartTop - chartBottom);
}

function getPoints(data: number[], maxValue: number) {
  const usableWidth = chartWidth - chartLeft - chartRight;
  return data.map((value, idx) => {
    const x = chartLeft + ((idx + 0.5) * usableWidth) / Math.max(data.length, 1);
    const y = chartHeight - chartBottom - (value / Math.max(maxValue, 1)) * (chartHeight - chartTop - chartBottom);
    return { x, y };
  });
}

function linePath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  return points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function smoothLinePath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let idx = 1; idx < points.length; idx += 1) {
    const previous = points[idx - 1];
    const current = points[idx];
    const midpointX = (previous.x + current.x) / 2;
    const midpointY = (previous.y + current.y) / 2;
    path += ` Q ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} ${midpointX.toFixed(2)} ${midpointY.toFixed(2)}`;
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  path += ` Q ${penultimate.x.toFixed(2)} ${penultimate.y.toFixed(2)} ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
  return path;
}

function areaPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  const baseY = chartHeight - chartBottom;
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${first.x.toFixed(2)} ${baseY} ${points.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} L ${last.x.toFixed(2)} ${baseY} Z`;
}

function rangeBandPath(
  lower: { x: number; y: number }[],
  upper: { x: number; y: number }[]
) {
  if (lower.length === 0 || upper.length === 0) return '';
  const upperPath = upper.slice(1).map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const lowerPath = [...lower].reverse().map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  return `M ${upper[0].x.toFixed(2)} ${upper[0].y.toFixed(2)} ${upperPath} ${lowerPath} Z`;
}

function indexFromMouse(event: React.MouseEvent<SVGSVGElement>, length: number) {
  if (length <= 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const usableWidth = rect.width - (chartLeft / chartWidth) * rect.width - (chartRight / chartWidth) * rect.width;
  const left = (chartLeft / chartWidth) * rect.width;
  const percent = clamp((x - left) / Math.max(usableWidth, 1), 0, 1);
  return clamp(Math.floor(percent * length), 0, length - 1);
}

function tooltipPercent(index: number, length: number) {
  if (length <= 1) return 50;
  return 8 + (index / (length - 1)) * 84;
}

function LatencyHistogram({ data, loading, t }: { data: LatencyDistribution | null; loading: boolean; t: (key: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);

  if (loading) {
    return <LoadingState height={230} label={t('Loading latency distribution...')} />;
  }
  if (!data || data.total === 0) {
    return <NoDataState height={230} title={t('No latency data')} hint={t('Request-duration spread appears once traces arrive.')} />;
  }

  const buckets = data.buckets;
  const n = buckets.length;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  // Place a percentile value at the horizontal center of the bucket it lands in.
  const markerLeft = (value: number) => {
    let idx = buckets.findIndex(b => b.upperMs > 0 && value < b.upperMs);
    if (idx === -1) idx = n - 1;
    return ((idx + 0.5) / n) * 100;
  };

  const markers = [
    { label: 'P50', value: data.p50Ms, color: 'var(--chart-green)' },
    { label: 'P95', value: data.p95Ms, color: 'var(--chart-amber)' },
    { label: 'P99', value: data.p99Ms, color: 'var(--chart-rose)' },
  ].filter(m => m.value > 0);

  return (
    <div className="apm-hist">
      <div className="apm-hist-stats">
        <span><em>{t('Samples')}</em><strong>{formatMetric(data.total, 'count')}</strong></span>
        <span className="healthy"><em>P50</em><strong>{formatMetric(data.p50Ms, 'latency')}</strong></span>
        <span className="warning"><em>P95</em><strong>{formatMetric(data.p95Ms, 'latency')}</strong></span>
        <span className="critical"><em>P99</em><strong>{formatMetric(data.p99Ms, 'latency')}</strong></span>
      </div>
      <div className="apm-hist-plot">
        {markers.map(m => (
          <div
            key={m.label}
            className="apm-hist-marker"
            style={{ left: `${markerLeft(m.value)}%`, '--marker-color': m.color } as React.CSSProperties}
          >
            <span className="apm-hist-marker-line" style={{ background: m.color }} />
            <span className="apm-hist-marker-tag">{m.label} · {formatMetric(m.value, 'latency')}</span>
          </div>
        ))}
        {buckets.map((b, i) => {
          const h = (b.count / maxCount) * 100;
          const pct = data.total > 0 ? (b.count / data.total) * 100 : 0;
          const severity = latencyBucketTone(b.upperMs, b.label);
          return (
            <button
              type="button"
              key={b.label}
              className={`apm-hist-col ${severity} ${hover === i ? 'active' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="apm-hist-bar-wrap">
                {hover === i && b.count > 0 && (
                  <span className="apm-hist-value">{b.count.toLocaleString()} · {pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                )}
                <span className="apm-hist-bar" style={{ height: `${b.count > 0 ? Math.max(h, 2) : 0}%` }} />
              </span>
              <span className="apm-hist-label">{b.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
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

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latencyBucketTone(upperMs: number, label: string): ToneName {
  if (upperMs <= 0 || label.includes('5+')) return 'critical';
  if (upperMs > 1200) return 'critical';
  if (upperMs > 500) return 'warning';
  if (upperMs > 250) return 'info';
  return 'healthy';
}

function trimQuery(query: string) {
  if (!query) return 'unknown query';
  const normalized = query.replace(/\s+/g, ' ').trim();
  return normalized.length > 92 ? `${normalized.slice(0, 92)}...` : normalized;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
