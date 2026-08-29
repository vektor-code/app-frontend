import React, { useCallback, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RotateCcw,
  Search,
} from 'lucide-react';
import { api } from '../api/client';
import type { ServiceStats } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import LanguageIcon from '../components/LanguageIcon';
import { MiniTrend, type MiniTrendTone } from '../components/MiniTrend';
import { KpiCard } from '../components/KpiCard';
import { useTranslation } from '../utils/i18n';
import { useColumnResize } from '../utils/useColumnResize';

interface ServicesProps {
  namespace: string;
}

type ServiceHealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown' | string;
type SortField = 'health' | 'throughput' | 'latency' | 'errorRate' | 'name';
type SortDir = 'asc' | 'desc';
type HealthFilter = 'all' | 'healthy' | 'degraded' | 'critical' | 'unknown';
type ServiceColumn = 'service' | 'health' | 'latency' | 'traffic' | 'failures';

const defaultServiceColumnWidths: Record<ServiceColumn, number> = {
  service: 330,
  health: 160,
  latency: 220,
  traffic: 220,
  failures: 190,
};

const serviceColumnMinimums: Record<ServiceColumn, number> = {
  service: 250,
  health: 132,
  latency: 170,
  traffic: 170,
  failures: 158,
};

const serviceColumnOrder: ServiceColumn[] = ['service', 'health', 'latency', 'traffic', 'failures'];
const serviceColumnStorageKey = 'servicesInventoryColumnsV1';

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
  lastSeen: string;
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
  lastSeen: string;
}

const historyStorageKey = 'accumulatedServicesV4';

export default function Services({ namespace }: ServicesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('health');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [aggregatedServices, setAggregatedServices] = useState<Record<string, AggregatedService>>({});
  const { widths, startResize, resizeBy, resetWidths } = useColumnResize(defaultServiceColumnWidths, {
    minWidths: serviceColumnMinimums,
    storageKey: serviceColumnStorageKey,
  });

  const loadServices = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await api.getServices(namespace || undefined);
      const rawList = (res.services || []).filter(service => !service.isInfrastructure);
      const groups: Record<string, ServiceGroup> = {};

      for (const service of rawList) {
        const project = getProjectName(service.namespace);
        // Key by full namespace so each environment (e.g. x-dev, x-uat) is its
        // own service row, instead of collapsing all namespaces of a project.
        const key = `${service.namespace}:${service.serviceName}`;
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
          lastSeen: '',
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
        if (!group.lastSeen || new Date(service.lastSeen).getTime() > new Date(group.lastSeen).getTime()) {
          group.lastSeen = service.lastSeen;
        }
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
          lastSeen: group.lastSeen,
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
    const filtered = servicesList.filter(service => {
      const matchesQuery = !query ||
          service.serviceName.toLowerCase().includes(query) ||
          service.project.toLowerCase().includes(query) ||
          service.environments.some(env => env.toLowerCase().includes(query));
      return matchesQuery && (healthFilter === 'all' || getHealthCategory(service) === healthFilter);
    });

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
  }, [servicesList, searchTerm, healthFilter, sortField, sortDir]);

  const summary = useMemo(() => {
    const totalRequests = servicesList.reduce((sum, service) => sum + service.requestCount, 0);
    const totalErrors = servicesList.reduce((sum, service) => sum + service.errorCount, 0);
    const activeServices = servicesList.filter(service => service.requestCount > 0).length;
    const degraded = servicesList.filter(service => getHealthCategory(service) === 'degraded').length;
    const critical = servicesList.filter(service => getHealthCategory(service) === 'critical').length;
    const healthy = servicesList.filter(service => getHealthCategory(service) === 'healthy').length;
    const unknown = servicesList.filter(service => getHealthCategory(service) === 'unknown').length;
    const avgHealth = servicesList.length > 0
      ? servicesList.reduce((sum, service) => sum + service.healthScore, 0) / servicesList.length
      : 100;
    const weightedP95 = servicesList.reduce((sum, service) => sum + service.p95Ms * Math.max(service.requestCount, 1), 0);
    const requestWeight = servicesList.reduce((sum, service) => sum + Math.max(service.requestCount, 1), 0);

    return {
      activeServices,
      totalServices: servicesList.length,
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
      avgHealth,
      avgP95: requestWeight > 0 ? weightedP95 / requestWeight : 0,
      healthy,
      degraded,
      critical,
      unknown,
    };
  }, [servicesList]);

  const summaryTrends = useMemo(
    () => buildSummaryTrends(servicesList),
    [servicesList],
  );

  const tableGridStyle = useMemo(() => ({
    gridTemplateColumns: serviceColumnOrder
      .map(column => `minmax(${serviceColumnMinimums[column]}px, ${widths[column]}fr)`)
      .join(' '),
  }) as CSSProperties, [widths]);

  const setSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir(field === 'name' ? 'asc' : 'desc');
  };

  const resizeColumnWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, column: ServiceColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  if (loading && servicesList.length === 0) {
    return <LoadingState height={420} label={t('Loading services...')} />;
  }

  return (
    <div className="services-page apm-dashboard animate-fade-in">
      <section className="apm-dashboard-header services-dashboard-header">
        <div className="apm-title-block">
          <h1>{t('Services')}</h1>
        </div>
        <div className="apm-header-meta">
          <div className="apm-health-chips" aria-label={t('Service health')}>
            <span className="healthy">{summary.healthy} {t('healthy')}</span>
            <span className="warning">{summary.degraded} {t('degraded')}</span>
            <span className="critical">{summary.critical} {t('critical')}</span>
          </div>
          <div className="apm-live-pill">
            <span />
            {t('Live')}
          </div>
        </div>
      </section>

      <section className="apm-kpi-strip" aria-label={t('Service health metrics')}>
        <KpiCard
          label={t('Monitored services')}
          value={summary.totalServices.toString()}
          detail={`${summary.activeServices} ${t('with traffic')}`}
          tone="info"
          trend={summaryTrends.active}
          positiveIsGood
        />
        <KpiCard
          label={t('Fleet health')}
          value={`${summary.avgHealth.toFixed(0)}%`}
          detail={summary.critical > 0 ? `${summary.critical} ${t('critical')}` : summary.degraded > 0 ? `${summary.degraded} ${t('degraded')}` : t('All systems healthy')}
          tone={summary.critical > 0 ? 'critical' : summary.degraded > 0 ? 'warning' : 'healthy'}
          trend={summaryTrends.health}
          positiveIsGood
        />
        <KpiCard
          label={t('Request volume')}
          value={formatCompact(summary.totalRequests)}
          detail={`${formatThroughput(summary.totalRequests)} · ${t('current window')}`}
          tone="info"
          trend={summaryTrends.requests}
          positiveIsGood
        />
        <KpiCard
          label={t('P95 latency')}
          value={formatDuration(summary.avgP95)}
          detail={`${formatPercent(summary.errorRate)} ${t('error rate')}`}
          tone={summary.errorRate > 5 ? 'critical' : summary.errorRate > 0 || summary.avgP95 > 500 ? 'warning' : 'healthy'}
          trend={summaryTrends.latency}
          positiveIsGood={false}
        />
      </section>

      <section className="services-controls">
        <div className="services-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="text"
            placeholder={t('Search services, projects, namespaces...')}
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            aria-label={t('Search services')}
          />
          {searchTerm && (
            <button type="button" className="services-search-clear" onClick={() => setSearchTerm('')} aria-label={t('Clear search')}>
              ×
            </button>
          )}
        </div>
        <div className="services-filter-group" aria-label={t('Filter by health')}>
          <FilterButton label={t('All')} count={summary.totalServices} active={healthFilter === 'all'} onClick={() => setHealthFilter('all')} />
          <FilterButton label={t('Healthy')} count={summary.healthy} active={healthFilter === 'healthy'} tone="healthy" onClick={() => setHealthFilter('healthy')} />
          <FilterButton label={t('Degraded')} count={summary.degraded} active={healthFilter === 'degraded'} tone="warning" onClick={() => setHealthFilter('degraded')} />
          <FilterButton label={t('Critical')} count={summary.critical} active={healthFilter === 'critical'} tone="critical" onClick={() => setHealthFilter('critical')} />
          {summary.unknown > 0 && (
            <FilterButton label={t('No traffic')} count={summary.unknown} active={healthFilter === 'unknown'} onClick={() => setHealthFilter('unknown')} />
          )}
        </div>
      </section>

      {loadError && servicesList.length === 0 ? (
        <NoDataState height={360} title={t('Could not load services')} hint={t('Retry after the API is reachable.')} />
      ) : filteredServices.length === 0 ? (
        <NoDataState height={360} title={t('No services found')} hint={searchTerm || healthFilter !== 'all' ? t('Try a different search or health filter.') : t('Services appear once telemetry is received.')} />
      ) : (
        <section className="services-list" aria-label={t('Services')}>
          <div className="services-list-toolbar">
            <div>
              <strong>{t('Service inventory')}</strong>
              <span>{filteredServices.length} {filteredServices.length === 1 ? t('service') : t('services')}</span>
            </div>
            <div className="services-resize-tools">
              <button type="button" onClick={resetWidths}>
                <RotateCcw size={13} />
                {t('Reset columns')}
              </button>
            </div>
          </div>
          <div className="services-list-scroller">
            <div className="services-list-head" style={tableGridStyle} role="row">
              <ColumnHeader
                column="service"
                label={t('Service')}
                sortField="name"
                activeSort={sortField}
                dir={sortDir}
                onSort={setSort}
                onResize={startResize}
                onResizeKey={resizeColumnWithKeyboard}
                onReset={resetWidths}
              />
              <ColumnHeader
                column="health"
                label={t('Health')}
                sortField="health"
                activeSort={sortField}
                dir={sortDir}
                onSort={setSort}
                onResize={startResize}
                onResizeKey={resizeColumnWithKeyboard}
                onReset={resetWidths}
              />
              <ColumnHeader
                column="latency"
                label={t('Latency')}
                sortField="latency"
                activeSort={sortField}
                dir={sortDir}
                onSort={setSort}
                onResize={startResize}
                onResizeKey={resizeColumnWithKeyboard}
                onReset={resetWidths}
              />
              <ColumnHeader
                column="traffic"
                label={t('Traffic')}
                sortField="throughput"
                activeSort={sortField}
                dir={sortDir}
                onSort={setSort}
                onResize={startResize}
                onResizeKey={resizeColumnWithKeyboard}
                onReset={resetWidths}
              />
              <ColumnHeader
                column="failures"
                label={t('Failures')}
                sortField="errorRate"
                activeSort={sortField}
                dir={sortDir}
                onSort={setSort}
                onResize={startResize}
                onResizeKey={resizeColumnWithKeyboard}
                onReset={resetWidths}
              />
            </div>
            {filteredServices.map(service => (
              <ServiceRow
                key={service.key}
                service={service}
                gridStyle={tableGridStyle}
                onClick={() => navigate(`/traces?service=${encodeURIComponent(service.serviceName)}`)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ServiceRow({
  service,
  gridStyle,
  onClick,
}: {
  service: AggregatedService;
  gridStyle: CSSProperties;
  onClick: () => void;
}) {
  const tone = healthTone(service.status, service.healthScore);
  const latencyTone = service.p99Ms > 1200 ? 'critical' : service.p95Ms > 500 ? 'warning' : 'neutral';
  const errorTone = service.errorRate > 5 ? 'critical' : service.errorRate > 0 ? 'warning' : 'neutral';

  // A service is marked failing on any error rate at all; the >5% threshold
  // still drives the stronger tone on the error cell itself.
  const rowStatus = service.errorRate > 0 ? 'is-error' : latencyTone === 'critical' ? 'is-slow' : '';

  return (
    <button type="button" className={`service-row row-status ${rowStatus}`} style={gridStyle} onClick={onClick}>
      <div className="service-identity-cell">
        <div className="service-icon-wrap">
          <LanguageIcon language={service.language} size={22} />
        </div>
        <div className="service-title-wrap">
          <strong>{service.serviceName}</strong>
          <span>{service.project} · {formatRelativeTime(service.lastSeen)}</span>
          <div className="service-envs">
            {service.environments.slice(0, 3).map(env => (
              <em key={env}>{env}</em>
            ))}
            {service.environments.length > 3 && <em>+{service.environments.length - 3}</em>}
          </div>
        </div>
      </div>

      <div className="service-health-cell">
        <div className={`service-status-pill ${tone.kind}`}>
          <i />
          {tone.label}
        </div>
        <span>Apdex {service.apdex.toFixed(2)}</span>
      </div>

      <MetricCell
        value={formatDuration(service.p95Ms)}
        tone={latencyTone === 'neutral' ? 'info' : latencyTone}
        trend={service.latencyHistory}
      />

      <MetricCell
        value={formatThroughput(service.requestCount)}
        tone="info"
        trend={service.throughputHistory}
      />

      <MetricCell
        value={formatPercent(service.errorRate)}
        tone={errorTone === 'neutral' ? 'healthy' : errorTone}
        trend={service.errorsHistory}
      />
    </button>
  );
}

function MetricCell({
  value,
  tone,
  trend,
}: {
  value: string;
  tone: MiniTrendTone;
  trend: number[];
}) {
  return (
    <div className={`service-metric-cell ${tone}`}>
      <div>
        <strong>{value}</strong>
      </div>
      <MiniTrend data={trend} tone={tone} compact />
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: 'neutral' | 'healthy' | 'warning' | 'critical';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`${active ? 'active' : ''} ${tone}`} onClick={onClick} aria-pressed={active}>
      <i />
      {label}
      <span>{count}</span>
    </button>
  );
}

function ColumnHeader({
  column,
  label,
  sortField,
  activeSort,
  dir,
  onSort,
  onResize,
  onResizeKey,
  onReset,
}: {
  column: ServiceColumn;
  label: string;
  sortField: SortField;
  activeSort: SortField;
  dir: SortDir;
  onSort: (field: SortField) => void;
  onResize: (event: React.MouseEvent, column: ServiceColumn) => void;
  onResizeKey: (event: KeyboardEvent<HTMLButtonElement>, column: ServiceColumn) => void;
  onReset: () => void;
}) {
  const active = activeSort === sortField;

  return (
    <div className={`services-column-head ${active ? 'active' : ''}`} role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="services-column-sort" onClick={() => onSort(sortField)}>
        {label}
        {active && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
      {column !== 'failures' && (
        <button
          type="button"
          className="service-column-resizer"
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

function getHealthCategory(service: AggregatedService): Exclude<HealthFilter, 'all'> {
  const tone = healthTone(service.status, service.healthScore);
  if (tone.kind === 'warning') return 'degraded';
  if (tone.kind === 'neutral') return 'unknown';
  if (tone.kind === 'critical') return 'critical';
  return 'healthy';
}

function buildSummaryTrends(services: AggregatedService[]) {
  const pointCount = Math.max(
    2,
    ...services.flatMap(service => [
      service.throughputHistory.length,
      service.latencyHistory.length,
      service.errorsHistory.length,
    ]),
  );
  const indices = Array.from({ length: pointCount }, (_, index) => index);
  const atPoint = (history: number[], fallback: number, index: number) => {
    const offset = history.length - pointCount + index;
    return offset >= 0 && finiteNumber(history[offset]) ? history[offset] : history[0] ?? fallback;
  };

  const active = indices.map(index =>
    services.filter(service => atPoint(service.throughputHistory, service.requestCount, index) > 0).length
  );
  const requests = indices.map(index =>
    services.reduce((sum, service) => sum + atPoint(service.throughputHistory, service.requestCount, index), 0)
  );
  const latency = indices.map(index => {
    const activeServices = services.filter(service => atPoint(service.throughputHistory, service.requestCount, index) > 0);
    if (activeServices.length === 0) return 0;
    return activeServices.reduce(
      (sum, service) => sum + atPoint(service.latencyHistory, service.p95Ms, index),
      0,
    ) / activeServices.length;
  });
  const health = indices.map(index => {
    if (services.length === 0) return 100;
    return services.reduce((sum, service) => {
      const historicalError = atPoint(service.errorsHistory, service.errorRate, index);
      const historicalLatency = atPoint(service.latencyHistory, service.p95Ms, index);
      const errorShift = (service.errorRate - historicalError) * 3.2;
      const latencyShift = (service.p95Ms - historicalLatency) / 70;
      return sum + clamp(service.healthScore + errorShift + latencyShift, 0, 100);
    }, 0) / services.length;
  });

  return { active, requests, latency, health };
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

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'recently';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'seen now';
  if (seconds < 60) return `seen ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `seen ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `seen ${hours}h ago`;
  return `seen ${Math.round(hours / 24)}d ago`;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
