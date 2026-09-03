import React from 'react';

/** Connector from the Small rail mock: 10.2 × 83.48 tree between the parent icon and flyout. */
export default function SidebarUnion({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="100%"
      viewBox="0 0 10.2 83.48"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M0 13.91 H10.2 M7.2 13.91 V66.57 A3 3 0 0 0 10.2 69.57 M7.2 41.74 H10.2"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
