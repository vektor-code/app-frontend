import React, { useId } from 'react';

/**
 * Compact form of the CRNET APM origami-swift identity.
 *
 * The generated handwritten lockup lives in /public/branding. This vector
 * companion stays crisp in favicons and the collapsed navigation.
 */
export default function CrnetApmMark({
  size = 40,
}: {
  size?: number;
  color?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const wingId = `crnet-apm-wing-${uid}`;
  const tailId = `crnet-apm-tail-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      role="img"
      aria-label="CRNET APM"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={wingId} x1="12" y1="24" x2="86" y2="104" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF7635" />
          <stop offset="1" stopColor="#FF4B22" />
        </linearGradient>
        <linearGradient id={tailId} x1="58" y1="108" x2="112" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF3D64" />
          <stop offset="1" stopColor="#FF5A45" />
        </linearGradient>
      </defs>

      <path
        d="M12 24 76 35 98 53 64 58 81 75 28 111 44 69 12 24Z"
        fill={`url(#${wingId})`}
        stroke="#FF5427"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m58 108 39-49c2.8-3.5 8-3.7 11-.5l8 8.3c3.7 3.8 2.3 10.2-2.7 12.1L58 110Z"
        fill={`url(#${tailId})`}
        stroke="#FF315C"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m65 59 23-4-13 16-10-12Z" fill="#21C7A8" />
      <path d="m69 60 13-2.3-7.5 9.2-5.5-6.9Z" fill="#9BF3DD" opacity=".62" />
    </svg>
  );
}
