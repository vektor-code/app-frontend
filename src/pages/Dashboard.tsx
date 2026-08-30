import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconActivity,
  IconAlertTriangle,
  IconChartHistogram,
  IconClock,
  IconDatabase,
  IconGauge,
} from '@tabler/icons-react';
import { api } from '../api/client';
import type { DatabaseQueryMetric, LatencyDistribution, NamespaceStats, ServiceErrorSeries, ServiceStats, TimeseriesData } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import { seriesDelta } from '../components/MiniTrend';
import { KpiCard } from '../components/KpiCard';
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
  delta?: number;
  positiveIsGood?: boolean;
  progress?: number;
}

type IconName = 'apdex' | 'database' | 'errors' | 'histogram' | 'latency' | 'traffic';

interface ChartLayout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const CHART_PAD = { left: 58, right: 14, top: 16, bottom: 34 };
const FALLBACK_CHART_SIZE = { width: 480, height: 216 };

function useChartLayout() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK_CHART_SIZE);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (width: number, height: number) => {
      if (width < 32 || height < 32) return;
      setSize(prev => (
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height }
      ));
    };

    apply(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo<ChartLayout>(() => ({
    width: size.width,
    height: size.height,
    ...CHART_PAD,
  }), [size.height, size.width]);

  return [ref, layout] as const;
}

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
  const traffickedServices = services.filter(service => service.requestCount > 0);
  const traffickedServicesCount = traffickedServices.length;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const serviceHealthScore = weightedServiceValue(traffickedServices, service => service.healthScore ?? inferHealthScore(service), 100);
  const healthScore = traffickedServicesCount > 0 ? serviceHealthScore : clamp(100 - Math.min(70, errorRate * 4.5), 0, 100);
  const healthTone = getHealthTone(Math.round(healthScore), totalRequests);
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
      label: t('Request rate'),
      value: formatMetric(totalRequests, 'count'),
      detail: `${timeseries?.windowMinutes || 60}m ${t('window')}`,
      tone: 'info',
      icon: 'traffic',
      trend: trafficData,
      delta: seriesDelta(trafficData),
      positiveIsGood: true,
    },
    {
      label: t('Error rate'),
      value: formatPercent(recentErrorRate),
      detail: `${formatPercent(errorRate)} ${t('window average')}`,
      tone: recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'healthy',
      icon: 'errors',
      trend: errorRateData,
      delta: seriesDelta(errorRateData),
      positiveIsGood: false,
    },
    {
      label: t('P99 Latency'),
      value: formatMetric(recentP99 || avgP99, 'latency'),
      detail: `${formatMetric(avgP99, 'latency')} ${t('window')} / ${latencyBreaches} ${t('breaches')}`,
      tone: (recentP99 || avgP99) > 1200 ? 'critical' : (recentP99 || avgP99) > 500 ? 'warning' : 'info',
      icon: 'latency',
      trend: latencyP99Data,
      delta: seriesDelta(latencyP99Data),
      positiveIsGood: false,
    },
    {
      label: t('Apdex'),
      value: apdex.toFixed(2),
      detail: apdex >= 0.94 ? t('Satisfied users') : apdex >= 0.85 ? t('Needs attention') : t('User pain likely'),
      tone: apdex >= 0.94 ? 'healthy' : apdex >= 0.85 ? 'warning' : 'critical',
      icon: 'apdex',
      trend: apdexTrend,
      delta: seriesDelta(apdexTrend),
      positiveIsGood: true,
    },
  ];

  return (
    <div className="dashboard-page apm-dashboard animate-fade-in">
      <section className="apm-dashboard-header">
        <div className="apm-title-block">
          <h1>{t('Overview')}</h1>
        </div>

        <div className="apm-header-meta">
          <div className="apm-health-chips" aria-label={t('Service health')}>
            <span className="healthy">{serviceHealthMix.healthy} {t('healthy')}</span>
            <span className="warning">{serviceHealthMix.warning} {t('degraded')}</span>
            <span className="critical">{serviceHealthMix.critical} {t('critical')}</span>
          </div>
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
          <KpiCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            tone={metric.tone}
            trend={metric.trend}
            delta={metric.delta}
            positiveIsGood={metric.positiveIsGood}
            progress={metric.progress}
            loading={tsLoading}
          />
        ))}
      </section>

      <section className="apm-chart-grid apm-red-grid" aria-label={t('RED metrics')}>
        <ChartPanel
          title={t('Latency')}
          icon="latency"
          legend={[
            { label: t('Average'), color: latencyColor },
            { label: t('P99'), color: tailLatencyColor },
          ]}
          summary={{
            label: t('P99'),
            value: formatMetric(recentP99 || avgP99, 'latency'),
            tone: recentP99 > 1200 ? 'critical' : recentP99 > 500 ? 'warning' : 'healthy',
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
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Error rate')}
          icon="errors"
          legend={[{ label: t('Error rate'), color: errorColor }]}
          summary={{
            label: t('Recent'),
            value: formatPercent(recentErrorRate),
            tone: recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'healthy',
          }}
          tone={recentErrorRate > 5 ? 'critical' : recentErrorRate > 1 ? 'warning' : 'info'}
        >
          <LineChart
            primary={errorRateData}
            labels={timeLabels}
            primaryLabel={t('Error rate')}
            unit="percent"
            primaryColor={errorColor}
            hoverIndex={timeseriesHover}
            setHoverIndex={setTimeseriesHover}
            loading={tsLoading}
            empty={!hasTraffic}
            t={t}
          />
        </ChartPanel>

        <ChartPanel
          title={t('Request rate')}
          icon="traffic"
          legend={[
            { label: t('Requests'), color: trafficColor },
            { label: t('Failed'), color: errorColor },
          ]}
          summary={{
            label: t('Volume'),
            value: formatMetric(totalRequests, 'count'),
            tone: 'info',
          }}
          tone="info"
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
      </section>

      <section className="apm-chart-grid">
        <ChartPanel
          title={t('Service errors')}
          icon="errors"
          legend={[
            { label: t('Errors'), color: 'var(--chart-rose)' },
            { label: t('Quiet'), color: 'color-mix(in srgb, var(--text-tertiary) 35%, transparent)' },
          ]}
          summary={{
            label: t('Affected'),
            value: affectedServices.toLocaleString(),
            tone: affectedServices > 3 ? 'critical' : affectedServices > 0 ? 'warning' : 'healthy',
          }}
          tone={affectedServices > 3 ? 'critical' : affectedServices > 0 ? 'warning' : 'healthy'}
        >
          <ServiceErrorBoard
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

        <ChartPanel
          title={t('Database')}
          icon="database"
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
      </section>

      <section className="apm-distribution-section">
        <ChartPanel
          title={t('Latency Distribution')}
          icon="histogram"
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
  activeServices,
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
  activeServices: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  traffic: number[];
  p50: number;
  p95: number;
  p99: number;
  t: (key: string) => string;
}) {
  const trafficTotal = healthMix.healthy + healthMix.warning + healthMix.critical;
  const idleCount = Math.max(healthMix.neutral, totalServices - activeServices);
  const divisor = Math.max(trafficTotal, 1);
  const healthyEnd = (healthMix.healthy / divisor) * 100;
  const warningEnd = healthyEnd + (healthMix.warning / divisor) * 100;
  const criticalEnd = warningEnd + (healthMix.critical / divisor) * 100;
  const donutBackground = trafficTotal > 0
    ? `conic-gradient(
        var(--chart-green) 0% ${healthyEnd}%,
        var(--chart-amber) ${healthyEnd}% ${warningEnd}%,
        var(--chart-rose) ${warningEnd}% ${criticalEnd}%
      )`
    : 'conic-gradient(var(--border-primary) 0% 100%)';
  const maxLatency = Math.max(p50, p95, p99, 1);

  return (
    <section className="apm-visual-overview" aria-label={t('Operational overview')}>
      <article className="apm-visual-card apm-health-mix">
        <div className="apm-visual-card-head">
          <h2>{t('Service health')}</h2>
          <span>{activeServices} {t('active')} · {totalServices} {t('total')}</span>
        </div>
        <div className="apm-health-mix-body">
          <div className="apm-donut" style={{ background: donutBackground }}>
            <div>
              <strong>{trafficTotal > 0 ? Math.round(healthyEnd) : 0}%</strong>
              <span>{t('Healthy')}</span>
            </div>
          </div>
          <div className="apm-donut-legend">
            <span className="healthy"><i />{t('Healthy')}<strong>{healthMix.healthy}</strong></span>
            <span className="warning"><i />{t('Degraded')}<strong>{healthMix.warning}</strong></span>
            <span className="critical"><i />{t('Critical')}<strong>{healthMix.critical}</strong></span>
            <span className="idle"><i />{t('No traffic')}<strong>{idleCount}</strong></span>
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
  icon,
  legend,
  summary,
  tone = 'info',
  children,
}: {
  title: string;
  icon?: IconName;
  legend: { label: string; color: string; dashed?: boolean }[];
  summary?: { label: string; value: string; tone: ToneName };
  tone?: ToneName;
  children: React.ReactNode;
}) {
  return (
    <div className={`apm-chart-panel ${tone}`}>
      <div className="apm-chart-header">
        <div>
          <h2>
            {icon ? <DashboardIcon name={icon} /> : null}
            {title}
          </h2>
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
  const [stageRef, layout] = useChartLayout();
  const totalData = successData.map((value, idx) => value + (errorData[idx] || 0));
  const maxValue = Math.max(...totalData, 1) * 1.08;
  const usableWidth = plotWidth(layout);
  const barStep = usableWidth / Math.max(totalData.length, 1);
  const barWidth = Math.max(3, barStep * 0.62);
  const plotBottom = layout.height - layout.bottom;

  return (
    <div className="apm-chart-stage" ref={stageRef}>
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, totalData.length, layout))}
      >
        <ChartGrid layout={layout} maxValue={maxValue} unit="count" />
        <g className="apm-request-bars">
          {totalData.map((_, idx) => {
            const successHeight = scaleY(successData[idx] || 0, maxValue, layout);
            const errorHeight = scaleY(errorData[idx] || 0, maxValue, layout);
            const x = layout.left + idx * barStep + (barStep - barWidth) / 2;
            const dimmed = hoverIndex !== null && hoverIndex !== idx;
            return (
              <g key={idx} opacity={dimmed ? 0.35 : 1}>
                <rect
                  x={x}
                  y={plotBottom - successHeight}
                  width={barWidth}
                  height={successHeight}
                  rx="1.5"
                  className="apm-request-bar-success"
                />
                {errorHeight > 0 && (
                  <rect
                    x={x}
                    y={plotBottom - successHeight - errorHeight}
                    width={barWidth}
                    height={Math.max(errorHeight, 1.5)}
                    rx="1.5"
                    className="apm-request-bar-error"
                  />
                )}
              </g>
            );
          })}
        </g>
        {hoverIndex !== null && (
          <line
            x1={layout.left + hoverIndex * barStep + barStep / 2}
            y1={layout.top}
            x2={layout.left + hoverIndex * barStep + barStep / 2}
            y2={plotBottom}
            className="apm-crosshair"
          />
        )}
        <XAxis layout={layout} labels={labels} />
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
  secondary = [],
  labels,
  primaryLabel,
  secondaryLabel,
  unit,
  primaryColor,
  secondaryColor = primaryColor,
  hoverIndex,
  setHoverIndex,
  loading,
  empty,
  t,
}: {
  primary: number[];
  secondary?: number[];
  labels: string[];
  primaryLabel: string;
  secondaryLabel?: string;
  unit: 'latency' | 'count' | 'percent';
  primaryColor: string;
  secondaryColor?: string;
  hoverIndex: number | null;
  setHoverIndex: (idx: number | null) => void;
  loading: boolean;
  empty: boolean;
  t: (key: string) => string;
}) {
  const [stageRef, layout] = useChartLayout();
  const fillId = React.useId().replace(/:/g, '');
  const hasSecondary = secondary.length > 0;
  const maxValue = Math.max(...primary, ...secondary, 1) * 1.08;
  const primaryPoints = getPoints(primary, maxValue, layout);
  const secondaryPoints = hasSecondary ? getPoints(secondary, maxValue, layout) : [];
  const hoverPoint = hoverIndex !== null ? primaryPoints[hoverIndex] : null;
  const secondaryHoverPoint = hoverIndex !== null && hasSecondary ? secondaryPoints[hoverIndex] : null;
  const formatValue = (value: number) => (unit === 'percent' ? formatPercent(value) : formatMetric(value, unit));

  return (
    <div className="apm-chart-stage" ref={stageRef}>
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, primary.length, layout))}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <ChartGrid layout={layout} maxValue={maxValue} unit={unit} />
        <path d={areaPath(primaryPoints, layout)} fill={`url(#${fillId})`} />
        <path d={smoothLinePath(primaryPoints)} fill="none" stroke={primaryColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {hasSecondary && (
          <path d={smoothLinePath(secondaryPoints)} fill="none" stroke={secondaryColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {hoverPoint && (
          <g>
            <line x1={hoverPoint.x} y1={layout.top} x2={hoverPoint.x} y2={layout.height - layout.bottom} className="apm-crosshair" />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="3.25" fill={primaryColor} className="apm-point-ring" />
            {secondaryHoverPoint && <circle cx={secondaryHoverPoint.x} cy={secondaryHoverPoint.y} r="3.25" fill={secondaryColor} className="apm-point-ring" />}
          </g>
        )}
        <XAxis layout={layout} labels={labels} />
      </svg>
      {hoverIndex !== null && (
        <ChartTooltip leftPercent={tooltipPercent(hoverIndex, primary.length)}>
          <strong>{labels[hoverIndex]}</strong>
          <span>{primaryLabel}: {formatValue(primary[hoverIndex])}</span>
          {hasSecondary && secondaryLabel ? <span>{secondaryLabel}: {formatValue(secondary[hoverIndex])}</span> : null}
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
  const [stageRef, layout] = useChartLayout();
  const fillId = React.useId().replace(/:/g, '');
  const maxCalls = Math.max(...calls, 1) * 1.08;
  const maxLatency = Math.max(...latency, 1) * 1.08;
  const usableWidth = plotWidth(layout);
  const barStep = usableWidth / Math.max(calls.length, 1);
  const barWidth = Math.max(3, barStep * 0.42);
  const latencyPoints = getPoints(latency, maxLatency, layout);

  return (
    <div className="apm-chart-stage" ref={stageRef}>
      <ChartOverlay loading={loading} empty={empty} t={t} />
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="apm-svg-chart"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={event => setHoverIndex(indexFromMouse(event, calls.length, layout))}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dbLatencyColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={dbLatencyColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <ChartGrid layout={layout} maxValue={maxCalls} unit="count" />
        <path d={areaPath(latencyPoints, layout)} fill={`url(#${fillId})`} />
        {calls.map((value, idx) => {
          const height = scaleY(value, maxCalls, layout);
          const x = layout.left + idx * barStep + (barStep - barWidth) / 2;
          const y = layout.height - layout.bottom - height;
          return (
            <rect
              key={idx}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx="1.5"
              fill={dbColor}
              className="apm-db-volume-bar"
              opacity={hoverIndex === null || hoverIndex === idx ? 0.72 : 0.22}
            />
          );
        })}
        <path d={smoothLinePath(latencyPoints)} fill="none" stroke={dbLatencyColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        {hoverIndex !== null && latencyPoints[hoverIndex] && (
          <g>
            <line x1={latencyPoints[hoverIndex].x} y1={layout.top} x2={latencyPoints[hoverIndex].x} y2={layout.height - layout.bottom} className="apm-crosshair" />
            <circle cx={latencyPoints[hoverIndex].x} cy={latencyPoints[hoverIndex].y} r="3.25" fill={dbLatencyColor} className="apm-point-ring" />
          </g>
        )}
        <XAxis layout={layout} labels={labels} />
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

function ServiceErrorBoard({
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
  const navigate = useNavigate();
  const rows = services.slice(0, 6);
  const maxBucketErrors = Math.max(1, ...rows.flatMap(service => service.errors));
  const totalErrors = rows.reduce((sum, service) => sum + service.errors.reduce((acc, value) => acc + value, 0), 0);
  const axisStep = Math.max(1, Math.ceil(labels.length / 4));

  if (loading) {
    return <LoadingState height={235} label={t('Loading service health...')} />;
  }
  if (rows.length === 0 || labels.length === 0) {
    return <NoDataState height={235} title={t('No service activity')} hint={t('Per-service errors appear once traffic flows.')} />;
  }

  return (
    <div
      className="apm-error-board"
      ref={containerRef}
      style={{ '--error-buckets': labels.length } as React.CSSProperties}
      onMouseLeave={() => {
        setHoverCell(null);
        setTooltipPos(null);
      }}
    >
      {rows.map((service, svcIdx) => {
        const errorTotal = service.errors.reduce((sum, value) => sum + value, 0);
        const spanTotal = service.spans.reduce((sum, value) => sum + value, 0);
        const rate = spanTotal > 0 ? (errorTotal / spanTotal) * 100 : 0;
        const share = totalErrors > 0 ? (errorTotal / totalErrors) * 100 : 0;
        return (
          <div className="apm-error-board-row" key={`${service.namespace}:${service.service}`}>
            <div className="apm-error-board-head">
              <strong title={`${service.namespace}/${service.service}`}>{service.service}</strong>
              <b>{formatMetric(errorTotal, 'count')}</b>
              <em className={errorTotal > 0 ? 'is-hot' : undefined}>{formatPercent(rate)}</em>
            </div>
            <div className="apm-error-board-track">
              <i className="apm-error-board-share" style={{ width: `${Math.max(share, errorTotal > 0 ? 4 : 0)}%` }} />
              <div className="apm-error-board-bars">
                {labels.map((label, timeIdx) => {
                  const spans = service.spans[timeIdx] || 0;
                  const errors = service.errors[timeIdx] || 0;
                  const height = errors <= 0 ? 3 : Math.max(6, (errors / maxBucketErrors) * 26);
                  const active = hoverCell?.svcIdx === svcIdx && hoverCell?.timeIdx === timeIdx;
                  return (
                    <button
                      key={`${label}:${timeIdx}`}
                      type="button"
                      className={`apm-error-board-bar ${heatmapTone(spans, errors)} ${active ? 'active' : ''}`}
                      style={{ height }}
                      onMouseEnter={() => setHoverCell({ svcIdx, timeIdx })}
                      onMouseMove={event => {
                        const container = containerRef.current;
                        if (!container) return;
                        const rect = container.getBoundingClientRect();
                        const tooltipWidth = 220;
                        const tooltipHeight = 86;
                        let x = event.clientX - rect.left + 14;
                        let y = event.clientY - rect.top + container.scrollTop + 14;
                        if (x + tooltipWidth > rect.width - 8) x = event.clientX - rect.left - tooltipWidth - 12;
                        if (x < 8) x = 8;
                        if (y + tooltipHeight > rect.height - 8) y = event.clientY - rect.top + container.scrollTop - tooltipHeight - 12;
                        if (y < 8) y = 8;
                        setTooltipPos({ x, y });
                      }}
                      onClick={() => navigate(`/traces?service=${encodeURIComponent(service.service)}&hasError=true`)}
                      aria-label={`${service.service} ${label}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      <div className="apm-error-board-axis">
        {labels.map((label, idx) => (
          <em key={`${label}:${idx}`}>{idx % axisStep === 0 || idx === labels.length - 1 ? label : ''}</em>
        ))}
      </div>
      {hoverCell && tooltipPos && rows[hoverCell.svcIdx] && (
        <div className="apm-floating-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          {(() => {
            const service = rows[hoverCell.svcIdx];
            const spans = service.spans[hoverCell.timeIdx] || 0;
            const errors = service.errors[hoverCell.timeIdx] || 0;
            const errorRate = spans > 0 ? (errors / spans) * 100 : 0;
            return (
              <>
                <strong>{service.service} · {labels[hoverCell.timeIdx]}</strong>
                <span>{t('Errors')}: {formatMetric(errors, 'count')} ({formatPercent(errorRate)})</span>
                <span>{t('Spans')}: {formatMetric(spans, 'count')}</span>
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

function ChartGrid({ layout, maxValue, unit }: { layout: ChartLayout; maxValue: number; unit: 'latency' | 'count' | 'percent' }) {
  const rows = [1, 0.5, 0];
  return (
    <g>
      {rows.map(row => {
        const y = layout.top + (1 - row) * (layout.height - layout.top - layout.bottom);
        return (
          <g key={row}>
            <line x1={layout.left} y1={y} x2={layout.width - layout.right} y2={y} className="apm-grid-line" />
            <text x={layout.left - 8} y={y + 4} textAnchor="end" className="apm-axis-text">
              {formatMetric(maxValue * row, unit)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XAxis({ layout, labels }: { layout: ChartLayout; labels: string[] }) {
  const usableWidth = plotWidth(layout);
  const labelStep = Math.max(1, Math.ceil(labels.length / 5));
  return (
    <g>
      {labels.map((label, idx) => {
        if (idx % labelStep !== 0 && idx !== labels.length - 1) return null;
        const x = layout.left + ((idx + 0.5) * usableWidth) / Math.max(labels.length, 1);
        const isFirst = idx === 0;
        const isLast = idx === labels.length - 1;
        return (
          <text
            key={`${label}:${idx}`}
            x={x}
            y={layout.height - 10}
            textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
            className="apm-axis-text"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

function DashboardIcon({ name }: { name: IconName }) {
  const icons = {
    apdex: IconGauge,
    database: IconDatabase,
    errors: IconAlertTriangle,
    histogram: IconChartHistogram,
    latency: IconClock,
    traffic: IconActivity,
  } as const;
  const Glyph = icons[name];
  return <Glyph size={16} stroke={1.8} aria-hidden />;
}

function ChartTooltip({ leftPercent, children }: { leftPercent: number; children: React.ReactNode }) {
  const align = leftPercent < 22 ? 'start' : leftPercent > 78 ? 'end' : 'center';
  const left = align === 'start' ? 10 : align === 'end' ? undefined : `${leftPercent}%`;
  const right = align === 'end' ? 10 : undefined;
  const transform = align === 'center' ? 'translateX(-50%)' : 'none';
  return (
    <div
      className={`apm-floating-tooltip apm-chart-tooltip is-${align}`}
      style={{ left, right, top: 10, transform }}
    >
      {children}
    </div>
  );
}

function weightedServiceValue(services: ServiceStats[], getValue: (service: ServiceStats) => number, fallback = 0) {
  const totals = services.reduce(
    (acc, service) => {
      const weight = service.requestCount;
      if (weight <= 0) return acc;
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

function plotWidth(layout: ChartLayout) {
  return layout.width - layout.left - layout.right;
}

function plotHeight(layout: ChartLayout) {
  return layout.height - layout.top - layout.bottom;
}

function scaleY(value: number, maxValue: number, layout: ChartLayout) {
  return (value / Math.max(maxValue, 1)) * plotHeight(layout);
}

function getPoints(data: number[], maxValue: number, layout: ChartLayout) {
  const usableWidth = plotWidth(layout);
  return data.map((value, idx) => {
    const x = layout.left + ((idx + 0.5) * usableWidth) / Math.max(data.length, 1);
    const y = layout.height - layout.bottom - (value / Math.max(maxValue, 1)) * plotHeight(layout);
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

function areaPath(points: { x: number; y: number }[], layout: ChartLayout) {
  if (points.length === 0) return '';
  const baseY = layout.height - layout.bottom;
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

function indexFromMouse(event: React.MouseEvent<SVGSVGElement>, length: number, layout: ChartLayout) {
  if (length <= 0) return null;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const scaleX = rect.width / Math.max(layout.width, 1);
  const left = layout.left * scaleX;
  const usableWidth = plotWidth(layout) * scaleX;
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

function formatMetric(value: number, metric: 'count' | 'latency' | 'percent') {
  if (metric === 'percent') return formatPercent(value);
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
