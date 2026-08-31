import type { HealthLevel, NodeHealthCardProps, NodeMetric } from './NodeHealthCard.types';
import { useTranslation } from '../utils/i18n';
import './NodeHealthCard.css';

const STATUS_KEY: Record<HealthLevel, string> = {
  ok: 'Healthy',
  warning: 'At risk',
  critical: 'Critical',
};

function roleLabel(role: string, t: (key: string) => string): string {
  const normalized = role.toLowerCase().replace(/_/g, '-');
  if (normalized === 'control-plane' || normalized === 'master') return t('Control plane');
  if (normalized === 'worker') return t('Worker');
  return t(role);
}

/** Resolves a metric's own threshold color, independent of overall node status. */
function metricLevel(percent: number, warnAt: number, critAt: number): HealthLevel {
  if (percent >= critAt) return 'critical';
  if (percent >= warnAt) return 'warning';
  return 'ok';
}

function AlertTriangleIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

interface RadialGaugeProps {
  metric: NodeMetric;
  level: HealthLevel;
  size?: number;
}

function RadialGauge({ metric, level, size = 48 }: RadialGaugeProps) {
  const { t } = useTranslation();
  const percent = Math.min(100, Math.max(0, metric.percent));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const filled = (percent / 100) * circumference;
  const remainder = circumference - filled;
  const roundedPercent = Math.round(percent);

  return (
    <div className="apm-node-card__gauge">
      <svg
        width={size}
        height={size}
        viewBox="0 0 72 72"
        role="img"
        aria-label={`${metric.label}: ${roundedPercent}%, ${metric.usedLabel} ${t('of')} ${metric.totalLabel}`}
      >
        <circle cx={36} cy={36} r={radius} className="apm-node-card__gauge-track" strokeWidth={6} fill="none" />
        <circle
          cx={36}
          cy={36}
          r={radius}
          className={`apm-node-card__gauge-fill apm-node-card__gauge-fill--${level}`}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${remainder}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="apm-node-card__gauge-copy">
        <span className="apm-node-card__gauge-label">{metric.label}</span>
        <strong className="apm-node-card__gauge-value">{roundedPercent}%</strong>
        <span className="apm-node-card__gauge-sub">
          {metric.usedLabel} / {metric.totalLabel}
        </span>
      </span>
    </div>
  );
}

/**
 * A single cluster node's health, mirroring how OpenShift/PatternFly and
 * Datadog present node cards: compact threshold-colored gauges instead of
 * full-width bars, with the reason a node is unhealthy promoted next to the
 * badge instead of buried in footer text.
 *
 * Presentational only - no polling or data fetching. The parent owns the
 * data source (REST poll, websocket, etc.) and passes fresh props down.
 */
export function NodeHealthCard({
  name,
  role = 'worker',
  namespaceCount,
  podCount,
  status,
  riskReason,
  metrics,
  updatedAgoLabel,
  warnAt = 70,
  critAt = 90,
  onViewDetails,
}: NodeHealthCardProps) {
  const { t } = useTranslation();
  const namespaceWord = namespaceCount === 1 ? t('namespace') : t('namespaces');

  return (
    <div className={`apm-node-card apm-node-card--${status}`}>
      <div className="apm-node-card__accent" aria-hidden="true" />
      <div className="apm-node-card__body">
        <div className="apm-node-card__header">
          <div className="apm-node-card__title-group">
            <span className="apm-node-card__name">{name}</span>
            <span className="apm-node-card__role">{roleLabel(role, t)}</span>
            <span className="apm-node-card__meta">
              {namespaceCount} {namespaceWord} &middot; {podCount} {t('pods')}
            </span>
          </div>
          {status !== 'ok' && (
            <span className={`apm-node-card__badge apm-node-card__badge--${status}`}>
              <AlertTriangleIcon />
              {t(STATUS_KEY[status])}
            </span>
          )}
        </div>

        {status !== 'ok' && riskReason && (
          <div className={`apm-node-card__reason apm-node-card__reason--${status}`}>{riskReason}</div>
        )}

        <div className="apm-node-card__gauges">
          {metrics.map((metric) => (
            <RadialGauge key={metric.key} metric={metric} level={metricLevel(metric.percent, warnAt, critAt)} />
          ))}
        </div>

        <div className="apm-node-card__footer">
          <span className="apm-node-card__updated">{t('Updated')} {updatedAgoLabel}</span>
          {onViewDetails && (
            <button type="button" className="apm-node-card__action" onClick={onViewDetails}>
              {t('View pod details')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
