import React from 'react';
import { MiniTrend, seriesDelta, type MiniTrendTone } from './MiniTrend';

export function KpiCard({
  label,
  value,
  detail,
  tone,
  trend,
  delta,
  positiveIsGood = true,
  progress,
  loading = false,
}: {
  label: string;
  value: string;
  detail: string;
  tone: MiniTrendTone;
  trend?: number[];
  delta?: number;
  positiveIsGood?: boolean;
  progress?: number;
  loading?: boolean;
}) {
  const resolvedDelta = delta ?? seriesDelta(trend);
  const showDelta = !loading && resolvedDelta != null && Number.isFinite(resolvedDelta);
  const deltaGood = positiveIsGood ? (resolvedDelta ?? 0) >= 0 : (resolvedDelta ?? 0) <= 0;
  const bar = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <div className={`apm-signal-card ${tone}${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined}>
      <div className="apm-signal-topline">
        <span className="apm-signal-label">{label}</span>
        {showDelta && (
          <span className={`apm-signal-delta ${Math.abs(resolvedDelta) < 0.15 ? 'flat' : deltaGood ? 'good' : 'bad'}`}>
            {resolvedDelta >= 0 ? '↑' : '↓'} {Math.abs(resolvedDelta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="apm-signal-value-row">
        {loading ? <span className="apm-skeleton apm-skeleton-value" /> : <strong>{value}</strong>}
      </div>
      {loading ? <span className="apm-skeleton apm-skeleton-detail" /> : <p>{detail}</p>}
      {!loading && progress !== undefined && (
        <span
          className="apm-kpi-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={bar}
        >
          <i style={{ width: `${bar}%` }} />
        </span>
      )}
      {!loading && trend && trend.length > 0 && <MiniTrend data={trend} tone={tone} />}
    </div>
  );
}
