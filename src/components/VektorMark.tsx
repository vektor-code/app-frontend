import React, { useId } from 'react';

export default function VektorMark({
  size = 40,
  color = '#2563eb',
}: {
  size?: number;
  color?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const bgId = `vektor-bg-${uid}`;
  const markId = `vektor-mark-${uid}`;
  const routeId = `vektor-route-${uid}`;
  const nodeId = `vektor-node-${uid}`;
  const glowId = `vektor-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label="Vektor Trace"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={bgId} x1="14" y1="8" x2="116" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0f172a" />
          <stop offset="0.52" stopColor={color} />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id={markId} x1="30" y1="31" x2="98" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="0.56" stopColor="#eef6ff" />
          <stop offset="1" stopColor="#bfdbfe" />
        </linearGradient>
        <linearGradient id={routeId} x1="30" y1="45" x2="98" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#93c5fd" />
        </linearGradient>
        <radialGradient id={nodeId} cx="36%" cy="24%" r="70%">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbeafe" />
        </radialGradient>
        <filter id={glowId} x="-26%" y="-26%" width="152%" height="152%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="3.6" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.13 0 0 0 0 0.83 0 0 0 0 0.91 0 0 0 0.46 0" />
          <feBlend in="SourceGraphic" />
        </filter>
      </defs>

      <rect x="8" y="8" width="112" height="112" rx="30" fill={`url(#${bgId})`} />
      <path d="M20 29c15-12 39-16 63-11 17 4 29 13 36 26" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.16" />
      <path d="M30 34 64 99 98 34" stroke="#020617" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" opacity="0.18" />
      <path d="M30 34 64 99 98 34" stroke={`url(#${markId})`} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M31 43c13 8 20 23 33 23 14 0 20-15 33-23"
        stroke={`url(#${routeId})`}
        strokeWidth="5"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
      />
      <circle cx="31" cy="43" r="6.2" fill={`url(#${nodeId})`} stroke="#22d3ee" strokeWidth="2.1" />
      <circle cx="64" cy="66" r="6.2" fill="#ffffff" stroke="#60a5fa" strokeWidth="2.1" />
      <circle cx="97" cy="43" r="6.2" fill={`url(#${nodeId})`} stroke="#93c5fd" strokeWidth="2.1" />
      <circle cx="64" cy="99" r="5" fill="#ffffff" opacity="0.96" />
    </svg>
  );
}
