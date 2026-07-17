import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ServiceStats } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import LanguageIcon from '../components/LanguageIcon';
import { useTranslation } from '../utils/i18n';

interface ServicesProps {
  namespace: string;
}

type ServiceHealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown' | string;
type SortField = 'health' | 'throughput' | 'latency' | 'errorRate' | 'name';
type SortDir = 'asc' | 'desc';

interface AggregatedService {
  key: string;
  serviceName: string;
  project: string;
  language?: string;
  environments: string[];
  requestCount: number;
  errorCount: number;
  errorRate: number;
  healthScore: number;
  apdex: number;
  status: ServiceHealthStatus;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  latencyHistory: number[];
  throughputHistory: number[];
  errorsHistory: number[];
}

interface ServiceGroup {
  key: string;
  serviceName: string;
  project: string;
  language?: string;
  environments: string[];
  requestCount: number;
  errorCount: number;
  latencyWeight: number;
  p50MsTotal: number;
  p95MsTotal: number;
  p99MsTotal: number;
  healthWeight: number;
  healthScoreTotal: number;
  apdexTotal: number;
  status: ServiceHealthStatus;
}

const historyStorageKey = 'accumulatedServicesV3';

export default function Services({ namespace }: ServicesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('throughput');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [aggregatedServices, setAggregatedServices] = useState<Record<string, AggregatedService>>({});

  const loadServices = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await api.getServices(namespace || undefined);
      const rawList = (res.services || []).filter(service => !service.isInfrastructure);
      const groups: Record<string, ServiceGroup> = {};

      for (const service of rawList) {
        const project = getProjectName(service.namespace);
        const key = `${project}:${service.serviceName}`;
        const group = groups[key] || {
          key,
          serviceName: service.serviceName,
          project,
          language: service.language,
          environments: [],
          requestCount: 0,
          errorCount: 0,
          latencyWeight: 0,
          p50MsTotal: 0,
          p95MsTotal: 0,
          p99MsTotal: 0,
          healthWeight: 0,
          healthScoreTotal: 0,
          apdexTotal: 0,
          status: 'unknown',
        };

        const weight = Math.max(service.requestCount, 1);
        const serviceErrorRate = service.requestCount > 0 ? (service.errorCount / service.requestCount) * 100 : service.errorRate;
        const serviceHealth = getServiceHealth(service, serviceErrorRate);

        if (service.language && !group.language) {
          group.language = service.language;
        }
        if (!group.environments.includes(service.namespace)) {
          group.environments.push(service.namespace);
        }
        group.requestCount += service.requestCount;
        group.errorCount += service.errorCount;
        group.latencyWeight += weight;
        group.p50MsTotal += service.p50Ms * weight;
        group.p95MsTotal += service.p95Ms * weight;
        group.p99MsTotal += service.p99Ms * weight;
        group.healthWeight += weight;
        group.healthScoreTotal += serviceHealth.healthScore * weight;
        group.apdexTotal += serviceHealth.apdex * weight;
        group.status = worstStatus(group.status, serviceHealth.status);
        groups[key] = group;
      }

      const cache = readHistoryCache();
      const nextAggregated = Object.values(groups).reduce<Record<string, AggregatedService>>((acc, group) => {
        const p50Ms = weightedAverage(group.p50MsTotal, group.latencyWeight);
        const p95Ms = weightedAverage(group.p95MsTotal, group.latencyWeight);
        const p99Ms = weightedAverage(group.p99MsTotal, group.latencyWeight);
        const errorRate = group.requestCount > 0 ? (group.errorCount / group.requestCount) * 100 : 0;
        const healthScore = weightedAverage(group.healthScoreTotal, group.healthWeight, 100);
        const apdex = weightedAverage(group.apdexTotal, group.healthWeight, 1);
        const status = group.requestCount > 0 ? group.status : 'unknown';
        const previous = cache[group.key];

        acc[group.key] = {
          key: group.key,
          serviceName: group.serviceName,
          project: group.project,
          language: group.language,
          environments: group.environments.sort(),
          requestCount: group.requestCount,
          errorCount: group.errorCount,
          errorRate,
          healthScore,
          apdex,
          status,
          p50Ms,
          p95Ms,
          p99Ms,
          latencyHistory: appendHistory(previous?.latencyHistory, p50Ms),
          throughputHistory: appendHistory(previous?.throughputHistory, group.requestCount),
          errorsHistory: appendHistory(previous?.errorsHistory, errorRate),
        };
        return acc;
      }, {});

      setAggregatedServices(nextAggregated);
      writeHistoryCache(nextAggregated);
    } catch (err) {
      console.error('loadServices error:', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    setLoading(true);
    loadServices();
    const interval = setInterval(loadServices, 5000);
    return () => clearInterval(interval);
  }, [loadServices]);

  useEffect(() => {
    const service = searchParams.get('service');
    if (service) {
      setSearchTerm(service);
    }
  }, [searchParams]);

  const servicesList = useMemo(() => Object.values(aggregatedServices), [aggregatedServices]);
  const filteredServices = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = query
      ? servicesList.filter(service =>
          service.serviceName.toLowerCase().includes(query) ||
          service.project.toLowerCase().includes(query) ||
          service.environments.some(env => env.toLowerCase().includes(query))
        )
      : servicesList;

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.serviceName.localeCompare(b.serviceName);
          break;
        case 'health':
          cmp = a.healthScore - b.healthScore;
          break;
        case 'latency':
          cmp = a.p95Ms - b.p95Ms;
          break;
        case 'throughput':
          cmp = a.requestCount - b.requestCount;
          break;
        case 'errorRate':
          cmp = a.errorRate - b.errorRate;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [servicesList, searchTerm, sortField, sortDir]);

  const summary = useMemo(() => {
    const totalRequests = servicesList.reduce((sum, service) => sum + service.requestCount, 0);
    const totalErrors = servicesList.reduce((sum, service) => sum + service.errorCount, 0);
    const activeServices = servicesList.filter(service => service.requestCount > 0).length;
    const degraded = servicesList.filter(service => service.status === 'degraded').length;
    const critical = servicesList.filter(service => service.status === 'critical').length;
    const avgHealth = servicesList.length > 0
      ? servicesList.reduce((sum, service) => sum + service.healthScore, 0) / servicesList.length
      : 100;

    return {
      activeServices,
      totalServices: servicesList.length,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      avgHealth,
      degraded,
      critical,
    };
  }, [servicesList]);

  const setSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir(field === 'name' ? 'asc' : 'desc');
  };

  if (loading && servicesList.length === 0) {
    return <LoadingState height={420} label={t('Loading services...')} />;
  }

  return (
    <div className="services-page">
      <section className="services-header">
        <div>
          <span className="services-eyebrow">{namespace || t('All namespaces')}</span>
          <h1>{t('Services')}</h1>
          <p>{t('Health, traffic, latency, and failures grouped by service.')}</p>
        </div>
        <div className="services-header-actions">
          <MetricBox label={t('Services')} value={summary.totalServices.toString()} />
          <MetricBox label={t('Requests')} value={formatCompact(summary.totalRequests)} />
          <MetricBox label={t('Error rate')} value={formatPercent(summary.errorRate)} tone={summary.errorRate > 5 ? 'critical' : summary.errorRate > 0 ? 'warning' : 'neutral'} />
        </div>
      </section>

      <section className="services-summary-grid">
        <SummaryCard label={t('Active')} value={summary.activeServices.toString()} detail={t('services with traffic')} tone="info" />
        <SummaryCard label={t('Health')} value={summary.avgHealth.toFixed(0)} detail={summary.critical > 0 ? `${summary.critical} ${t('critical')}` : summary.degraded > 0 ? `${summary.degraded} ${t('degraded')}` : t('healthy')} tone={summary.critical > 0 ? 'critical' : summary.degraded > 0 ? 'warning' : 'healthy'} />
        <SummaryCard label={t('Failures')} value={formatCompact(summary.totalErrors)} detail={formatPercent(summary.errorRate)} tone={summary.totalErrors > 0 ? 'critical' : 'neutral'} />
        <SummaryCard label={t('Scope')} value={namespace || t('All')} detail={t('namespace filter')} tone="neutral" />
      </section>

      <section className="services-controls">
        <div className="services-search">
          <SearchIcon />
          <input
            type="text"
            placeholder={t('Search services, projects, namespaces...')}
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="services-sort-controls" aria-label={t('Sort services')}>
          <SortButton label={t('Health')} active={sortField === 'health'} dir={sortDir} onClick={() => setSort('health')} />
          <SortButton label={t('Traffic')} active={sortField === 'throughput'} dir={sortDir} onClick={() => setSort('throughput')} />
          <SortButton label={t('Latency')} active={sortField === 'latency'} dir={sortDir} onClick={() => setSort('latency')} />
          <SortButton label={t('Errors')} active={sortField === 'errorRate'} dir={sortDir} onClick={() => setSort('errorRate')} />
          <SortButton label={t('Name')} active={sortField === 'name'} dir={sortDir} onClick={() => setSort('name')} />
        </div>
      </section>

      {loadError && servicesList.length === 0 ? (
        <NoDataState height={360} title={t('Could not load services')} hint={t('Retry after the API is reachable.')} />
      ) : filteredServices.length === 0 ? (
        <NoDataState height={360} title={t('No services found')} hint={searchTerm ? t('Try a different search.') : t('Services appear once telemetry is received.')} />
      ) : (
        <section className="services-list" aria-label={t('Services')}>
          <div className="services-list-head">
            <span>{t('Service')}</span>
            <span>{t('Health')}</span>
            <span>{t('Latency')}</span>
            <span>{t('Traffic')}</span>
            <span>{t('Failures')}</span>
          </div>
          {filteredServices.map(service => (
            <ServiceRow
              key={service.key}
              service={service}
              onClick={() => navigate(`/traces?service=${encodeURIComponent(service.serviceName)}`)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function ServiceRow({ service, onClick }: { service: AggregatedService; onClick: () => void }) {
  const tone = healthTone(service.status, service.healthScore);
  const latencyTone = service.p99Ms > 1200 ? 'critical' : service.p95Ms > 500 ? 'warning' : 'neutral';
  const errorTone = service.errorRate > 5 ? 'critical' : service.errorRate > 0 ? 'warning' : 'neutral';

  return (
    <button type="button" className="service-row" onClick={onClick}>
      <div className="service-identity-cell">
        <div className="service-icon-wrap">
          <LanguageIcon language={service.language} size={22} />
        </div>
        <div className="service-title-wrap">
          <strong>{service.serviceName}</strong>
          <span>{service.project}</span>
          <div className="service-envs">
            {service.environments.slice(0, 3).map(env => (
              <em key={env}>{env}</em>
            ))}
            {service.environments.length > 3 && <em>+{service.environments.length - 3}</em>}
          </div>
        </div>
      </div>

      <div className="service-health-cell">
        <div className={`service-status-pill ${tone.kind}`}>{tone.label}</div>
        <strong style={{ color: tone.color }}>{service.status === 'unknown' ? '--' : service.healthScore.toFixed(0)}</strong>
        <span>Apdex {service.apdex.toFixed(2)}</span>
      </div>

      <MetricCell
        label="P95"
        value={formatDuration(service.p95Ms)}
        sub={`P50 ${formatDuration(service.p50Ms)} / P99 ${formatDuration(service.p99Ms)}`}
        tone={latencyTone}
        trend={service.latencyHistory}
        trendColor="#2563eb"
      />

      <MetricCell
        label="Throughput"
        value={formatThroughput(service.requestCount)}
        sub={`${formatCompact(service.requestCount)} spans`}
        tone="neutral"
        trend={service.throughputHistory}
        trendColor="#059669"
      />

      <MetricCell
        label="Error rate"
        value={formatPercent(service.errorRate)}
        sub={`${formatCompact(service.errorCount)} failed`}
        tone={errorTone}
        trend={service.errorsHistory}
        trendColor="#e11d48"
      />
    </button>
  );
}

function MetricCell({
  label,
  value,
  sub,
  tone,
  trend,
  trendColor,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'critical' | 'warning' | 'neutral';
  trend: number[];
  trendColor: string;
}) {
  return (
    <div className={`service-metric-cell ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{sub}</em>
      </div>
      <Sparkline data={trend} color={trendColor} />
    </div>
  );
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'healthy' | 'warning' | 'critical' | 'neutral' | 'info' }) {
  return (
    <div className={`services-summary-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function MetricBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'critical' | 'warning' | 'neutral' }) {
  return (
    <div className={`services-metric-box ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SortButton({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <button type="button" className={active ? 'active' : ''} onClick={onClick}>
      {label}
      {active && <span>{dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const gradientId = React.useId().replace(/:/g, '');
  const cleanData = data.filter(value => Number.isFinite(value));

  if (cleanData.length < 2) {
    return (
      <svg className="service-sparkline" viewBox="0 0 88 28" aria-hidden="true">
        <line x1="2" y1="14" x2="86" y2="14" stroke="var(--border-secondary)" strokeWidth="1.4" strokeDasharray="4 4" />
      </svg>
    );
  }

  const width = 88;
  const height = 28;
  const padding = 3;
  const max = Math.max(...cleanData, 1);
  const min = Math.min(...cleanData, 0);
  const range = max - min || 1;
  const points = cleanData.map((value, idx) => {
    const x = padding + (idx / (cleanData.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });
  const path = smoothPath(points);
  const area = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

  return (
    <svg className="service-sparkline" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`service-spark-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#service-spark-${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function appendHistory(previous: number[] | undefined, value: number) {
  return [...(previous || []).slice(-11), value];
}

function readHistoryCache() {
  try {
    const value = localStorage.getItem(historyStorageKey);
    return value ? JSON.parse(value) as Record<string, AggregatedService> : {};
  } catch {
    return {};
  }
}

function writeHistoryCache(value: Record<string, AggregatedService>) {
  try {
    localStorage.setItem(historyStorageKey, JSON.stringify(value));
  } catch {
    // Caching is optional; the UI still renders current telemetry honestly.
  }
}

function getProjectName(namespace: string) {
  const dashIdx = namespace.indexOf('-');
  return dashIdx === -1 ? namespace : namespace.slice(0, dashIdx);
}

function weightedAverage(total: number, weight: number, fallback = 0) {
  return weight > 0 ? total / weight : fallback;
}

function getServiceHealth(service: ServiceStats, errorRate: number) {
  const healthScore = finiteNumber(service.healthScore)
    ? service.healthScore
    : inferHealthScore(service.requestCount, errorRate, service.p95Ms, service.p99Ms);
  const apdex = finiteNumber(service.apdex)
    ? service.apdex
    : inferApdex(service.requestCount, errorRate, service.p50Ms, service.p95Ms, service.p99Ms);

  return {
    healthScore: clamp(healthScore, 0, 100),
    apdex: clamp(apdex, 0, 1),
    status: service.status || inferStatus(service.requestCount, healthScore),
  };
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

function inferStatus(requestCount: number, healthScore: number): ServiceHealthStatus {
  if (requestCount <= 0) return 'unknown';
  if (healthScore >= 90) return 'healthy';
  if (healthScore >= 70) return 'degraded';
  return 'critical';
}

const statusRank: Record<string, number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  critical: 3,
};

function worstStatus(current: ServiceHealthStatus, next: ServiceHealthStatus): ServiceHealthStatus {
  return (statusRank[next] || 0) > (statusRank[current] || 0) ? next : current;
}

function healthTone(status: ServiceHealthStatus, score: number) {
  if (status === 'unknown') {
    return { color: 'var(--text-tertiary)', kind: 'neutral', label: 'No traffic' };
  }
  if (status === 'critical' || score < 70) {
    return { color: 'var(--accent-rose)', kind: 'critical', label: 'Critical' };
  }
  if (status === 'degraded' || score < 90) {
    return { color: 'var(--accent-amber)', kind: 'warning', label: 'Degraded' };
  }
  return { color: 'var(--accent-emerald)', kind: 'healthy', label: 'Healthy' };
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const [first, ...rest] = points;
  return rest.reduce((path, point, idx) => {
    const prev = points[idx];
    const midX = (prev.x + point.x) / 2;
    const midY = (prev.y + point.y) / 2;
    return `${path} Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}${idx === rest.length - 1 ? ` T ${point.x.toFixed(2)} ${point.y.toFixed(2)}` : ''}`;
  }, `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`);
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatThroughput(count: number) {
  const tpm = count / 5;
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

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
