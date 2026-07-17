import React from 'react';

export default function VektorMark({
  size = 40,
  color = '#6366f1',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <path d="M5 5l7 14 7-14" />
      <path d="M16 5h3v3" />
    </svg>
  );
}
