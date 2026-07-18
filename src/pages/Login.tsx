import React, { useState } from 'react';
import { api } from '../api/client';
import { useTranslation } from '../utils/i18n';
import VektorMark from '../components/VektorMark';

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'local' | 'ldap'>('ldap');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => {
    return document.body.classList.contains('dark-theme');
  });



  const toggleTheme = () => {
    if (isDark) {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      document.body.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.login({ username, password, mode });
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err.message || t('Login failed. Please check your credentials.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-shell">
        <aside className="login-brand-panel">
          <div className="login-brand-lockup">
            <VektorMark size={72} />
            <div>
              <span>Vektor Trace</span>
              <strong>APM</strong>
            </div>
          </div>
          <div className="login-brand-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </aside>

        <div className="login-card animate-fade-in">
          <div className="login-card-tools">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
            >
              {isDark ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          </div>

        <div className="login-logo">
          <div className="login-logo-mark">
            <VektorMark size={84} />
          </div>
          <div className="login-title-block">
            <h1>Vektor Trace</h1>
            <span>{mode === 'ldap' ? t('Directory sign in') : t('Local admin')}</span>
          </div>
        </div>

        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab-btn ${mode === 'ldap' ? 'active' : ''}`}
            onClick={() => {
              setMode('ldap');
              setError(null);
            }}
          >
            <img src="/logos/active-directory.svg" alt="" />
            <span>{t('LDAP')}</span>
          </button>
          <button
            type="button"
            className={`login-tab-btn ${mode === 'local' ? 'active' : ''}`}
            onClick={() => {
              setMode('local');
              setError(null);
            }}
          >
            <span className="login-mode-icon" style={{ '--login-mode-icon': 'url("/dashboard-icons/shield-check.svg")' } as React.CSSProperties} />
            <span>{t('Local')}</span>
          </button>
        </div>

        {error && (
          <div className="login-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              {t('Username')}
            </label>
            <input
              type="text"
              id="username"
              className="form-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={t('Username').toLowerCase()}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              {t('Password')}
            </label>
            <input
              type="password"
              id="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? t('Authenticating...') : t('Sign In')}
          </button>
        </form>
        </div>
      </div>

      <style>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          width: 100%;
          background:
            radial-gradient(circle at 22% 18%, rgba(99, 102, 241, 0.14), transparent 30%),
            radial-gradient(circle at 82% 76%, rgba(14, 165, 233, 0.12), transparent 28%),
            var(--bg-primary);
          padding: 24px;
          box-sizing: border-box;
          transition: background-color 0.2s ease;
        }
        .login-shell {
          width: min(920px, 100%);
          min-height: 560px;
          display: grid;
          grid-template-columns: minmax(260px, 0.9fr) minmax(360px, 420px);
          overflow: hidden;
          border: 1px solid var(--border-primary);
          border-radius: 14px;
          background: var(--bg-card);
          box-shadow: var(--shadow-lg), 0 30px 90px rgba(15, 23, 42, 0.16);
        }
        .login-brand-panel {
          position: relative;
          min-height: 100%;
          overflow: hidden;
          background:
            linear-gradient(145deg, rgba(37, 99, 235, 0.95), rgba(99, 102, 241, 0.90)),
            #2563eb;
          padding: 34px;
          color: #ffffff;
        }
        .login-brand-lockup {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .login-brand-lockup span,
        .login-brand-lockup strong {
          display: block;
        }
        .login-brand-lockup span {
          font-size: 13px;
          font-weight: 850;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0.82;
        }
        .login-brand-lockup strong {
          margin-top: 3px;
          font-size: 32px;
          line-height: 1;
          font-weight: 900;
        }
        .login-brand-orbit {
          position: absolute;
          inset: auto -72px -84px auto;
          width: 320px;
          height: 320px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }
        .login-brand-orbit span {
          position: absolute;
          border: 1px solid rgba(255, 255, 255, 0.20);
          border-radius: inherit;
        }
        .login-brand-orbit span:nth-child(1) { inset: 42px; }
        .login-brand-orbit span:nth-child(2) { inset: 92px; }
        .login-brand-orbit span:nth-child(3) {
          width: 12px;
          height: 12px;
          top: 52px;
          left: 86px;
          background: #ffffff;
          border: 0;
          box-shadow: 0 0 36px rgba(255, 255, 255, 0.75);
        }
        .login-card {
          position: relative;
          width: 100%;
          background: color-mix(in srgb, var(--bg-card) 96%, #ffffff);
          padding: 38px;
          transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .login-card-tools {
          position: absolute;
          top: 20px;
          right: 20px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .theme-toggle-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 9px;
          transition: background-color 0.2s, color 0.2s;
        }
        .theme-toggle-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .login-logo {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin: 4px 0 24px 0;
        }
        .login-logo-mark {
          user-select: none;
          filter: drop-shadow(0 12px 30px rgba(99, 102, 241, 0.4));
          animation: logo-float 5s ease-in-out infinite;
        }
        @keyframes logo-float {
          0%, 100% { transform: translateY(0); filter: drop-shadow(0 12px 30px rgba(99, 102, 241, 0.4)); }
          50% { transform: translateY(-5px); filter: drop-shadow(0 18px 38px rgba(99, 102, 241, 0.55)); }
        }
        .login-title-block {
          margin-top: 16px;
          text-align: center;
        }
        .login-title-block h1 {
          margin: 0;
          color: var(--text-primary);
          font-size: 24px;
          line-height: 1.15;
          font-weight: 900;
        }
        .login-title-block span {
          display: block;
          margin-top: 5px;
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 760;
        }
        .login-tabs {
          display: flex;
          gap: 4px;
          background: var(--bg-tertiary);
          padding: 4px;
          border-radius: 8px;
          border: 1px solid var(--border-primary);
          margin-bottom: 24px;
        }
        .login-tab-btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 800;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }
        .login-tab-btn:hover {
          color: var(--text-primary);
        }
        .login-tab-btn.active {
          background: var(--bg-card);
          color: var(--text-primary);
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-primary);
        }
        .login-tab-btn img,
        .login-mode-icon {
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
        }
        .login-mode-icon {
          display: inline-block;
          background: currentColor;
          mask: var(--login-mode-icon) center / contain no-repeat;
          -webkit-mask: var(--login-mode-icon) center / contain no-repeat;
        }
        .login-error {
          padding: 12px 16px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.2);
          color: var(--accent-rose);
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
          margin-bottom: 24px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-label {
          font-size: 13px;
          font-weight: 780;
          color: var(--text-secondary);
        }
        .form-input {
          min-height: 42px;
          padding: 0 14px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .form-input:focus {
          border-color: var(--accent-indigo);
          box-shadow: 0 0 0 2px var(--border-accent);
        }
        .form-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .login-submit {
          margin-top: 8px;
          min-height: 44px;
          padding: 0 12px;
          font-weight: 850;
          font-size: 14px;
          background: linear-gradient(135deg, var(--accent-indigo), var(--accent-violet));
          color: #ffffff;
          border: none;
          cursor: pointer;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          width: 100%;
          transition: background-color 0.2s, opacity 0.2s;
        }
        .login-submit:hover {
          background: var(--accent-indigo-light);
        }
        .login-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        @media (max-width: 760px) {
          .login-shell {
            grid-template-columns: 1fr;
          }
          .login-brand-panel {
            min-height: 150px;
          }
          .login-card {
            padding: 34px 24px 28px;
          }
        }
      `}</style>
    </div>
  );
}
