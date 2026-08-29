import React from 'react';

export type MiniTrendTone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';

export function MiniTrend({
  data,
  tone,
  compact = false,
}: {
  data: number[];
  tone: MiniTrendTone;
  compact?: boolean;
}) {
  const width = compact ? 72 : 240;
  const height = compact ? 28 : 36;
  const color = toneColorFor(tone);
  const series = data.filter(value => Number.isFinite(value)).slice(compact ? -12 : -24);

  if (series.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={compact ? 'apm-mini-trend apm-mini-trend-compact' : 'apm-mini-trend'}
        aria-hidden="true"
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border-secondary)"
          strokeWidth="1.2"
          strokeDasharray="4 4"
        />
      </svg>
    );
  }

  const maxValue = Math.max(...series, 1);
  const points = series.map((value, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * width;
    const y = height - (value / maxValue) * (height - 6) - 3;
    return { x, y };
  });
  const fillPath = `M 0 ${height} ${points.map(point => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} L ${width} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={compact ? 'apm-mini-trend apm-mini-trend-compact' : 'apm-mini-trend'}
      aria-hidden="true"
    >
      <path d={fillPath} fill={color} className="apm-mini-trend-fill" />
      <path d={linePath(points)} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function seriesDelta(data?: number[]) {
  if (!data || data.length < 4) return undefined;
  const mid = Math.floor(data.length / 2);
  const previous = average(data.slice(0, mid));
  const recent = average(data.slice(mid));
  if (!Number.isFinite(previous) || !Number.isFinite(recent)) return undefined;
  if (Math.abs(previous) < 1e-9) return recent === 0 ? 0 : 100;
  return ((recent - previous) / Math.abs(previous)) * 100;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function linePath(points: { x: number; y: number }[]) {
  if (points.length === 0) return '';
  return points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function toneColorFor(tone: MiniTrendTone) {
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
