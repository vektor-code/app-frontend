import React from 'react';
import { useTranslation } from '../utils/i18n';
import '../auth.css';

export default function LicenseExpired({
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

  return (
    <div className="apm-license-gate-shell">
      <div className="card apm-license-gate-card">
        <div className="card-body apm-license-gate-body">
          <div className="apm-license-gate-icon" aria-hidden>
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

          <h1>{t('License Not Activated')}</h1>
          <p className="apm-license-gate-copy">
            {t(`${product} is waiting for an active license period.`)}
          </p>

          <div className="apm-license-gate-actions">
            <a
              className="apm-auth-submit apm-license-gate-cta"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent(`${product} license renewal`)}`}
            >
              {t('Contact Cloudraft')}
            </a>
            <button className="apm-auth-secondary apm-license-gate-cta" onClick={onLogout} type="button">
              {t('Back to Sign In')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
