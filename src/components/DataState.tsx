import React from 'react';
import { useTranslation } from '../utils/i18n';

// Shared loading / empty states so users always know whether data is still loading or absent.

export function LoadingState({ label = 'Loading data…', height = 220 }: { label?: string; height?: number }) {
  const { t } = useTranslation();
  return (
    <div className="ds-wrap" style={{ minHeight: `${height}px` }}>
      <div className="ds-spinner-ring">
        <div className="ds-spinner-core" />
      </div>
      <span className="ds-label">{t(label)}</span>
      <DataStateStyles />
    </div>
  );
}

export function NoDataState({
  title = 'No data yet',
  hint = 'Appears once services send traces.',
  height = 220,
  icon,
}: { title?: string; hint?: string; height?: number; icon?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="ds-wrap" style={{ minHeight: `${height}px` }}>
      <div className="ds-empty-icon">
        {icon || (
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 3 3 5-6" strokeDasharray="2.5 3" />
          </svg>
        )}
      </div>
      <span className="ds-title">{t(title)}</span>
      <span className="ds-hint">{t(hint)}</span>
      <DataStateStyles />
    </div>
  );
}

function DataStateStyles() {
  return (
    <style>{`
      .ds-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        width: 100%;
        padding: 24px;
      }
      .ds-spinner-ring {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: 2.5px solid rgba(99, 102, 241, 0.12);
        border-top-color: var(--accent-indigo, #6366f1);
        animation: ds-spin 0.75s linear infinite;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ds-spinner-core {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent-indigo, #6366f1);
        opacity: 0.55;
        animation: ds-pulse 1.5s ease-in-out infinite;
      }
      .ds-label {
        font-size: 12.5px;
        font-weight: 500;
        color: var(--text-tertiary, #94a3b8);
        letter-spacing: 0.02em;
      }
      .ds-empty-icon {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted, #64748b);
        background: var(--bg-tertiary, rgba(148, 163, 184, 0.08));
        border: 1px dashed var(--border-primary, rgba(148, 163, 184, 0.25));
      }
      .ds-title {
        font-size: 13.5px;
        font-weight: 700;
        color: var(--text-secondary, #cbd5e1);
      }
      .ds-hint {
        font-size: 11.5px;
        color: var(--text-muted, #64748b);
        max-width: 340px;
        text-align: center;
        line-height: 1.5;
      }
      @keyframes ds-spin { to { transform: rotate(360deg); } }
      @keyframes ds-pulse { 0%, 100% { transform: scale(0.7); opacity: 0.35; } 50% { transform: scale(1); opacity: 0.7; } }
    `}</style>
  );
}
