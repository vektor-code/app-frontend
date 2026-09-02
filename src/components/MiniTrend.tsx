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
  const fillId = React.useId().replace(/:/g, '');
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
  const minValue = Math.min(...series, 0);
  const span = Math.max(maxValue - minValue, maxValue * 0.08, 1e-6);
  const points = series.map((value, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * width;
    const y = height - ((value - minValue) / span) * (height - 6) - 3;
    return { x, y };
  });
  const stroke = smoothMiniPath(points);
  const fillPath = `M 0 ${height} L ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}${stroke.replace(/^M\s+[-\d.eE+]+\s+[-\d.eE]+/, '')} L ${width} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={compact ? 'apm-mini-trend apm-mini-trend-compact' : 'apm-mini-trend'}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${fillId})`} className="apm-mini-trend-fill" />
      <path d={stroke} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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

function smoothMiniPath(points: { x: number; y: number }[]) {
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
