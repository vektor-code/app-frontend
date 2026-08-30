/** Jaeger/Tempo-style palette: no rose/red so success bars never look like errors. */
const SERVICE_PALETTE = [
  '#4338ca',
  '#2563eb',
  '#0d9488',
  '#7c3aed',
  '#0891b2',
  '#059669',
  '#4f46e5',
  '#0284c7',
  '#6d28d9',
  '#0f766e',
  '#1d4ed8',
  '#ca8a04',
];

function hashServiceName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getServiceColor(name: string): string {
  const key = name || 'unknown';
  return SERVICE_PALETTE[hashServiceName(key) % SERVICE_PALETTE.length];
}

export const getSvcColor = getServiceColor;

export function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 155 ? '#0f172a' : '#ffffff';
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1) return `${(ms * 1000).toFixed(0)}us`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
