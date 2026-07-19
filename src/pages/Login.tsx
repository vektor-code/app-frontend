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
          <div className="login-brand-visual" aria-hidden="true">
            <div className="login-visual-card">
              <div className="login-visual-topbar">
                <span />
                <span />
                <span />
                <i />
              </div>
              <svg className="login-trace-preview" viewBox="0 0 340 250" role="presentation">
                <defs>
                  <linearGradient id="loginTraceLine" x1="64" y1="192" x2="278" y2="62" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#67e8f9" stopOpacity="0.44" />
                    <stop offset="0.52" stopColor="#c4b5fd" stopOpacity="0.9" />
                    <stop offset="1" stopColor="#ffffff" stopOpacity="0.82" />
                  </linearGradient>
                  <linearGradient id="loginTraceFill" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#67e8f9" />
                    <stop offset="1" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <circle className="login-preview-ring outer" cx="184" cy="132" r="98" />
                <circle className="login-preview-ring mid" cx="184" cy="132" r="66" />
                <circle className="login-preview-ring inner" cx="184" cy="132" r="34" />
                <path className="login-preview-link muted" d="M184 132 C142 116 124 86 86 74" />
                <path className="login-preview-link muted" d="M184 132 C226 110 252 104 292 82" />
                <path className="login-preview-link muted" d="M184 132 C154 168 120 186 72 198" />
                <path className="login-preview-link muted" d="M184 132 C226 154 252 172 292 190" />
                <path className="login-preview-link active" d="M72 198 C116 166 126 134 184 132 C228 130 250 100 292 82" />
                <path className="login-preview-link pulse" d="M72 198 C116 166 126 134 184 132 C228 130 250 100 292 82" />
                <g className="login-preview-node center">
                  <circle cx="184" cy="132" r="17" />
                  <circle cx="184" cy="132" r="5" />
                </g>
                <g className="login-preview-node">
                  <circle cx="86" cy="74" r="12" />
                  <circle cx="86" cy="74" r="4" />
                </g>
                <g className="login-preview-node hot">
                  <circle cx="292" cy="82" r="14" />
                  <circle cx="292" cy="82" r="4.5" />
                </g>
                <g className="login-preview-node">
                  <circle cx="72" cy="198" r="13" />
                  <circle cx="72" cy="198" r="4" />
                </g>
                <g className="login-preview-node soft">
                  <circle cx="292" cy="190" r="11" />
                  <circle cx="292" cy="190" r="3.5" />
                </g>
              </svg>
              <div className="login-visual-footer">
                <span />
                <span />
                <span />
              </div>
            </div>
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

          <div className="login-auth-panel">
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
                  name="username"
                  autoComplete="username"
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
                  name="password"
                  autoComplete="current-password"
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
      </div>

      <style>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          width: 100%;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--bg-primary) 94%, #eef2ff), var(--bg-primary) 48%, color-mix(in srgb, var(--bg-primary) 90%, #e0f2fe)),
            var(--bg-primary);
          padding: 24px;
          box-sizing: border-box;
          transition: background-color 0.2s ease;
        }
        .login-shell {
          width: min(920px, 100%);
          min-height: 560px;
          display: grid;
          grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr);
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
            linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(30, 27, 75, 0.96) 54%, rgba(8, 47, 73, 0.96)),
            #111827;
          padding: 36px;
          color: #ffffff;
        }
        .login-brand-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(148, 163, 184, 0.10) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.08) 1px, transparent 1px);
          background-size: 40px 40px;
          mask-image: linear-gradient(150deg, rgba(0, 0, 0, 0.78), transparent 78%);
          pointer-events: none;
        }
        .login-brand-panel::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.11), transparent 45%),
            linear-gradient(115deg, transparent 22%, rgba(103, 232, 249, 0.12) 52%, transparent 76%);
          opacity: 0.72;
          pointer-events: none;
        }
        .login-brand-lockup {
          position: relative;
          z-index: 2;
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
          opacity: 0.76;
        }
        .login-brand-lockup strong {
          margin-top: 3px;
          font-size: 32px;
          line-height: 1;
          font-weight: 900;
        }
        .login-brand-visual {
          position: absolute;
          z-index: 1;
          left: 34px;
          right: 34px;
          bottom: 34px;
        }
        .login-visual-card {
          position: relative;
          height: 330px;
          overflow: hidden;
          border: 1px solid rgba(226, 232, 240, 0.16);
          border-radius: 16px;
          background:
            linear-gradient(180deg, rgba(15, 23, 42, 0.74), rgba(15, 23, 42, 0.46)),
            linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(14, 165, 233, 0.1));
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.10),
            0 24px 52px rgba(2, 6, 23, 0.34);
          backdrop-filter: blur(16px);
        }
        .login-visual-card::before {
          content: "";
          position: absolute;
          inset: 46px 0 0;
          background:
            linear-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px);
          background-size: 32px 32px;
          mask-image: linear-gradient(180deg, transparent, #000 14%, #000 82%, transparent);
          pointer-events: none;
        }
        .login-visual-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(140deg, transparent 0 38%, rgba(103, 232, 249, 0.12) 48%, transparent 60%),
            linear-gradient(180deg, transparent, rgba(2, 6, 23, 0.34));
          pointer-events: none;
        }
        .login-visual-topbar {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          gap: 7px;
          height: 42px;
          padding: 0 14px;
          border-bottom: 1px solid rgba(226, 232, 240, 0.12);
        }
        .login-visual-topbar span {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: rgba(226, 232, 240, 0.48);
        }
        .login-visual-topbar span:nth-child(2) {
          background: rgba(103, 232, 249, 0.62);
        }
        .login-visual-topbar i {
          width: 92px;
          height: 7px;
          margin-left: auto;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(148, 163, 184, 0.20), rgba(226, 232, 240, 0.08));
        }
        .login-trace-preview {
          position: relative;
          z-index: 2;
          display: block;
          width: 100%;
          height: 238px;
          margin-top: 2px;
        }
        .login-preview-ring {
          fill: none;
          stroke: rgba(226, 232, 240, 0.13);
          stroke-width: 1.2;
        }
        .login-preview-ring.outer {
          stroke: rgba(103, 232, 249, 0.24);
        }
        .login-preview-ring.mid {
          stroke-dasharray: 4 8;
        }
        .login-preview-ring.inner {
          stroke-width: 1.8;
          stroke: rgba(196, 181, 253, 0.24);
        }
        .login-preview-link {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .login-preview-link.muted {
          stroke: rgba(148, 163, 184, 0.24);
          stroke-width: 1.2;
        }
        .login-preview-link.active {
          stroke: url(#loginTraceLine);
          stroke-width: 2.4;
        }
        .login-preview-link.pulse {
          stroke: rgba(255, 255, 255, 0.78);
          stroke-width: 1.4;
          stroke-dasharray: 1 15;
          animation: login-route-flow 8s linear infinite;
        }
        .login-preview-node circle:first-child {
          fill: rgba(15, 23, 42, 0.68);
          stroke: rgba(226, 232, 240, 0.22);
          stroke-width: 1.2;
        }
        .login-preview-node circle:last-child {
          fill: rgba(226, 232, 240, 0.88);
        }
        .login-preview-node.center circle:first-child {
          fill: rgba(103, 232, 249, 0.12);
          stroke: rgba(103, 232, 249, 0.72);
          stroke-width: 1.5;
        }
        .login-preview-node.hot circle:first-child {
          fill: rgba(139, 92, 246, 0.20);
          stroke: rgba(196, 181, 253, 0.74);
        }
        .login-preview-node.hot circle:last-child,
        .login-preview-node.center circle:last-child {
          fill: url(#loginTraceFill);
        }
        .login-preview-node.soft {
          opacity: 0.7;
        }
        .login-visual-footer {
          position: absolute;
          z-index: 2;
          left: 16px;
          right: 16px;
          bottom: 16px;
          display: grid;
          grid-template-columns: 1fr 0.72fr 0.54fr;
          gap: 8px;
        }
        .login-visual-footer span {
          height: 38px;
          border: 1px solid rgba(226, 232, 240, 0.12);
          border-radius: 10px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03)),
            rgba(15, 23, 42, 0.42);
        }
        .login-visual-footer span::before {
          content: "";
          display: block;
          width: 44%;
          height: 5px;
          margin: 10px 0 0 10px;
          border-radius: 999px;
          background: rgba(226, 232, 240, 0.42);
        }
        .login-visual-footer span:nth-child(2)::before {
          width: 62%;
          background: rgba(103, 232, 249, 0.56);
        }
        .login-visual-footer span:nth-child(3)::before {
          width: 38%;
          background: rgba(196, 181, 253, 0.62);
        }
        @keyframes login-route-flow {
          to { stroke-dashoffset: -128; }
        }
        .login-card {
          position: relative;
          width: auto;
          min-height: 100%;
          justify-self: stretch;
          align-self: stretch;
          display: grid;
          place-items: center;
          background: color-mix(in srgb, var(--bg-card) 96%, #ffffff);
          padding: 48px 44px;
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
        .login-auth-panel {
          width: min(100%, 334px);
          justify-self: center;
          align-self: center;
          transform: translateY(10px);
        }
        .login-tabs {
          display: flex;
          gap: 6px;
          background: var(--bg-tertiary);
          padding: 5px;
          border-radius: 10px;
          border: 1px solid var(--border-primary);
          margin-bottom: 22px;
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
          min-height: 40px;
          padding: 9px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }
        .login-tab-btn:hover {
          color: var(--text-primary);
        }
        .login-tab-btn.active {
          background: var(--bg-card);
          color: var(--accent-indigo);
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
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
          margin-bottom: 18px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
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
          min-height: 46px;
          padding: 0 14px;
          background: color-mix(in srgb, var(--bg-tertiary) 72%, var(--bg-card));
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
          min-height: 46px;
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
            min-height: 190px;
            padding: 24px;
          }
          .login-brand-lockup {
            transform: scale(0.84);
            transform-origin: left top;
          }
          .login-brand-visual {
            left: auto;
            right: 20px;
            bottom: 20px;
            width: min(54%, 220px);
            opacity: 0.74;
          }
          .login-visual-card {
            height: 120px;
            border-radius: 12px;
          }
          .login-visual-topbar,
          .login-visual-footer {
            display: none;
          }
          .login-trace-preview {
            height: 120px;
            margin-top: 0;
          }
          .login-card {
            min-height: 430px;
            padding: 56px 24px 34px;
          }
          .login-auth-panel {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
