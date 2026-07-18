import React, { useId } from 'react';

export default function VektorMark({
  size = 40,
  color = '#6366f1',
}: {
  size?: number;
  color?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const bgId = `vektor-bg-${uid}`;
  const strokeId = `vektor-stroke-${uid}`;
  const traceId = `vektor-trace-${uid}`;

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
        <linearGradient id={bgId} x1="16" y1="10" x2="114" y2="118" gradientUnits="userSpaceOnUse">
          <stop stopColor="#312e81" />
          <stop offset="0.48" stopColor={color} />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id={strokeId} x1="31" y1="31" x2="97" y2="97" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="0.58" stopColor="#ecfeff" />
          <stop offset="1" stopColor="#c7d2fe" />
        </linearGradient>
        <linearGradient id={traceId} x1="31" y1="44" x2="99" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="0.55" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <filter id={`vektor-glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.38 0 0 0 0 0.39 0 0 0 0 0.95 0 0 0 0.55 0" />
          <feBlend in="SourceGraphic" />
        </filter>
      </defs>

      <rect x="10" y="8" width="108" height="112" rx="28" fill={`url(#${bgId})`} />
      <path d="M20 24c14-11 40-14 63-7 17 5 28 15 34 24" stroke="rgba(255,255,255,0.24)" strokeWidth="3" strokeLinecap="round" />
      <path d="M34 34 64 96 94 34" stroke={`url(#${strokeId})`} strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M32 46c12 12 20 18 32 18 16 0 20-15 32-24"
        stroke={`url(#${traceId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        filter={`url(#vektor-glow-${uid})`}
      />
      <circle cx="32" cy="46" r="5.2" fill="#ecfeff" stroke="#22d3ee" strokeWidth="2" />
      <circle cx="64" cy="64" r="5.8" fill="#ffffff" stroke="#818cf8" strokeWidth="2.2" />
      <circle cx="96" cy="40" r="5.2" fill="#f5f3ff" stroke="#a78bfa" strokeWidth="2" />
      <circle cx="64" cy="96" r="4.4" fill="#ffffff" opacity="0.96" />
    </svg>
  );
}
