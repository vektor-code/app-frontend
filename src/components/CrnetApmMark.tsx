import React from 'react';

/**
 * Compact generated companion mark for the CRNET APM handwritten lockup.
 */
export default function CrnetApmMark({
  size = 40,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <img
      src="/branding/crnet-apm-mark.png"
      width={size}
      height={size}
      alt="CRNET APM"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
