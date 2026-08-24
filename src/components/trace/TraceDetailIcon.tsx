import React from 'react';

export type TraceDetailIconName =
  | 'activity'
  | 'alert'
  | 'arrow'
  | 'back'
  | 'check'
  | 'close'
  | 'copy'
  | 'database'
  | 'flame'
  | 'focus'
  | 'graph'
  | 'latency'
  | 'minus'
  | 'network'
  | 'plus'
  | 'reset'
  | 'search'
  | 'server'
  | 'tags'
  | 'topology'
  | 'waterfall';


export function TraceDetailIcon({ name }: { name: TraceDetailIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'activity':
      return <svg {...common}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case 'alert':
      return <svg {...common}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /></svg>;
    case 'arrow':
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'back':
      return <svg {...common}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>;
    case 'check':
      return <svg {...common}><path d="m20 6-11 11-5-5" /></svg>;
    case 'close':
      return <svg {...common}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>;
    case 'copy':
      return <svg {...common}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v10c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case 'flame':
      return <svg {...common}><path d="M12 22c4 0 7-2.7 7-6.7 0-2.6-1.4-4.6-3.4-6.8-.6 2-1.8 3.1-3.1 3.8.4-3.5-1.1-6.1-4-8.3.2 4.5-3.5 6.1-3.5 10.9C5 19 8 22 12 22Z" /></svg>;
    case 'focus':
      return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" /><path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'graph':
      return <svg {...common}><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4" /><path d="M12 15V8" /><path d="M16 15v-6" /></svg>;
    case 'latency':
      return <svg {...common}><path d="M9 2h6" /><path d="M12 6v5l3 2" /><circle cx="12" cy="14" r="8" /></svg>;
    case 'minus':
      return <svg {...common}><path d="M5 12h14" /></svg>;
    case 'network':
      return <svg {...common}><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><path d="m8.4 8.2 2.4 6.1" /><path d="m15.6 8.2-2.4 6.1" /><path d="M9 6h6" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>;
    case 'reset':
      return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'server':
      return <svg {...common}><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01" /><path d="M7 17h.01" /></svg>;
    case 'tags':
      return <svg {...common}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><path d="M7.5 7.5h.01" /></svg>;
    case 'topology':
      return <svg {...common}><path d="M12 3v5" /><path d="M12 16v5" /><rect x="8" y="8" width="8" height="8" rx="2" /><path d="M3 12h5" /><path d="M16 12h5" /></svg>;
    case 'waterfall':
      return <svg {...common}><path d="M4 6h6" /><path d="M4 12h12" /><path d="M4 18h16" /></svg>;
    default:
      return <svg {...common}><path d="M4 12h16" /></svg>;
  }
}
