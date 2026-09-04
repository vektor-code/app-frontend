/**
 * Chart and diagram colors.
 *
 * Palettes follow Grafana categorical series and Jaeger span coloring:
 * indigo-first, no red on healthy services (errors stay distinct),
 * and none of Cloudraft forest, ASPM teal, or Activation bronze.
 *
 * Canvas 2D cannot use `var()` — read tokens at draw time.
 */

/** Jaeger-style service hues: no rose/red so success never looks like an error. */
export const SERVICE_PALETTE = [
  '#4338ca',
  '#2563eb',
  '#3871dc',
  '#7c3aed',
  '#1b855e',
  '#0284c7',
  '#A24BC8',
  '#4f46e5',
  '#0ea5e9',
  '#6d28d9',
  '#30a46c',
  '#3b82f6',
];

export const SERIES_COLORS = [
  'var(--chart-blue)',
  'var(--chart-cyan)',
  'var(--chart-purple)',
  'var(--chart-green)',
  'var(--chart-amber)',
];

export const STATUS_COLORS = {
  healthy: 'var(--chart-green)',
  warning: 'var(--chart-amber)',
  critical: 'var(--chart-rose)',
  idle: 'var(--text-muted)',
  info: 'var(--accent-indigo)',
} as const;

export const HEAT_SCALE = [
  'var(--chart-blue)',
  'var(--chart-cyan)',
  'var(--chart-green)',
  'var(--chart-amber)',
  'var(--chart-rose)',
] as const;

export function readCssColor(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function cssColorToRgba(color: string, alpha: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length !== 6) return trimmed;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = trimmed.match(/rgba?\(\s*([\d.]+)\s*[, ]+\s*([\d.]+)\s*[, ]+\s*([\d.]+)/);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  return trimmed;
}

export type ChartCanvasTheme = {
  canvas: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  elevated: string;
  idle: string;
  critical: string;
  degraded: string;
  healthy: string;
  healthyInfra: string;
  indigo: string;
  gridDot: string;
  edgeMuted: string;
};

export function readChartCanvasTheme(isDark: boolean): ChartCanvasTheme {
  return {
    canvas: readCssColor('--bg-primary', isDark ? '#0f141c' : '#f6f7fb'),
    text: readCssColor('--text-primary', isDark ? '#f0f6fc' : '#1f2328'),
    textSecondary: readCssColor('--text-secondary', isDark ? '#c9d1d9' : '#59636e'),
    textMuted: readCssColor('--text-muted', isDark ? '#6e7681' : '#8b8d98'),
    elevated: readCssColor('--bg-elevated', isDark ? '#1e2736' : '#ffffff'),
    idle: readCssColor('--text-muted', isDark ? '#6e7681' : '#8b8d98'),
    critical: readCssColor('--chart-rose', isDark ? '#f85149' : '#e54666'),
    degraded: readCssColor('--chart-amber', isDark ? '#d29922' : '#ee9d2b'),
    healthy: readCssColor('--accent-fill', isDark ? '#4f46e5' : '#4338ca'),
    healthyInfra: readCssColor('--accent-cyan', isDark ? '#60a5fa' : '#2563eb'),
    indigo: readCssColor('--accent-indigo', isDark ? '#818cf8' : '#4338ca'),
    gridDot: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.08)',
    edgeMuted: isDark ? 'rgba(148, 163, 184, 0.28)' : 'rgba(100, 116, 139, 0.24)',
  };
}
