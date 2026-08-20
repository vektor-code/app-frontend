import React from 'react';
import { AuthVisual } from '../components/AuthVisual';
import { useTranslation } from '../utils/i18n';
import '../auth.css';

const STATES = {
  LICENSE_EXPIRED: {
    title: 'License expired',
    badge: 'Expired',
    tone: 'danger',
    impact: 'Telemetry collection and console operations are paused.',
  },
  LICENSE_DISABLED: {
    title: 'License disabled',
    badge: 'Disabled',
    tone: 'danger',
    impact: 'This product is turned off in CRNET Activation.',
  },
  LICENSE_PENDING: {
    title: 'License not activated',
    badge: 'Pending',
    tone: 'warning',
    impact: 'Waiting for a license period to be set in CRNET Activation.',
  },
};

function resolveState(code?: string, message?: string) {
  if (code && STATES[code as keyof typeof STATES]) {
    return STATES[code as keyof typeof STATES];
  }
  const lower = String(message || '').toLowerCase();
  if (lower.includes('disabled')) return STATES.LICENSE_DISABLED;
  if (lower.includes('waiting') || lower.includes('pending') || lower.includes('not been activated')) {
    return STATES.LICENSE_PENDING;
  }
  return STATES.LICENSE_EXPIRED;
}

export default function LicenseExpired({
  code,
  expiresAt,
  message,
  onLogout,
  product = 'CRNET APM',
  supportEmail = 'support@cloudraft.net',
}: {
  code?: string;
  expiresAt?: string | null;
  message?: string;
  onLogout: () => void;
  product?: string;
  supportEmail?: string;
}) {
  const { t } = useTranslation();
  const state = resolveState(code, message);
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleString() : null;

  return (
    <div className="apm-auth-shell">
      <AuthVisual />
      <main className="apm-auth-panel">
        <div className="apm-auth-form apm-license-gate">
          <div className={`apm-license-gate-icon apm-license-gate-icon--${state.tone}`} aria-hidden>
            <svg fill="none" height="28" viewBox="0 0 24 24" width="28">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </div>

          <p className="apm-license-gate-eyebrow">{product}</p>
          <h1>{t(state.title)}</h1>
          <span className={`apm-license-gate-badge apm-license-gate-badge--${state.tone}`}>
            {t(state.badge)}
          </span>

          <p className="apm-license-gate-lead">
            {message || t(`${product} cannot run until the license is renewed.`)}
          </p>

          <ul className="apm-license-gate-facts">
            <li>
              <span>{t('Status')}</span>
              <strong>{t(state.badge)}</strong>
            </li>
            <li>
              <span>{t('Valid until')}</span>
              <strong>{expiryLabel || t('Not set')}</strong>
            </li>
            <li>
              <span>{t('Impact')}</span>
              <strong>{t(state.impact)}</strong>
            </li>
          </ul>

          <p className="apm-license-gate-help">
            {t('Contact Cloudraft to renew. Access stays locked until the period is extended in CRNET Activation.')}
          </p>

          <div className="apm-license-gate-actions">
            <a
              className="apm-auth-submit apm-license-gate-primary"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${product} license renewal`)}`}
            >
              {t('Contact Cloudraft')}
            </a>
            <button className="apm-license-gate-secondary" onClick={onLogout} type="button">
              {t('Back to sign in')}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
