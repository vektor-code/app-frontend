import React from 'react';
import { AuthVisual } from '../components/AuthVisual';
import { useTranslation } from '../utils/i18n';
import '../auth.css';

export default function LicenseExpired({
  expiresAt,
  message,
  onLogout,
}: {
  expiresAt?: string | null;
  message?: string;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const expiryLabel = expiresAt ? new Date(expiresAt).toLocaleString() : null;

  return (
    <div className="apm-auth-shell">
      <AuthVisual />
      <main className="apm-auth-panel">
        <div className="apm-auth-form">
          <h1>{t('License expired')}</h1>
          <p className="apm-auth-error">
            {message || t('CRNET APM is paused because the license period has ended.')}
          </p>
          {expiryLabel ? (
            <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 14, lineHeight: 1.6 }}>
              {t('Valid until')} {expiryLabel}.
            </p>
          ) : null}
          <p style={{ color: 'var(--text-secondary, #94a3b8)', fontSize: 14, lineHeight: 1.6 }}>
            {t('Contact Cloudraft to renew the license. Telemetry collection stays stopped until the period is extended in CRNET Activation.')}
          </p>
          <button className="apm-auth-submit" onClick={onLogout} type="button">
            {t('Sign out')}
          </button>
        </div>
      </main>
    </div>
  );
}
