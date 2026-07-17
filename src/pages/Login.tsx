import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { useTranslation } from '../utils/i18n';
import VektorMark from '../components/VektorMark';

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const { t, language, changeLanguage } = useTranslation();
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
      <div className="login-card animate-fade-in">
        <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>


          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
            style={{ position: 'static', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
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
        </div>

        {/* Auth Mode Tabs */}
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab-btn ${mode === 'ldap' ? 'active' : ''}`}
            onClick={() => {
              setMode('ldap');
              setError(null);
            }}
          >
            {t('LDAP')}
          </button>
          <button
            type="button"
            className={`login-tab-btn ${mode === 'local' ? 'active' : ''}`}
            onClick={() => {
              setMode('local');
              setError(null);
            }}
          >
            {t('Local Admin')}
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

      <style>{`
        .login-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          width: 100%;
          background: var(--bg-primary);
          padding: 20px;
          box-sizing: border-box;
          transition: background-color 0.2s ease;
        }
        .login-card {
          position: relative;
          width: 100%;
          max-width: 420px;
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          padding: 40px;
          box-shadow: var(--shadow-lg);
          transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .theme-toggle-btn {
          position: absolute;
          top: 24px;
          right: 24px;
          background: none;
          border: none;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          transition: background-color 0.2s, color 0.2s;
        }
        .theme-toggle-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .login-logo {
          display: flex;
          justify-content: center;
          margin: 4px 0 26px 0;
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
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
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
        .login-error {
          padding: 12px 16px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.2);
          color: var(--accent-rose);
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.5;
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
          font-weight: 500;
          color: var(--text-secondary);
        }
        .form-input {
          padding: 10px 14px;
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
          padding: 12px;
          font-weight: 600;
          font-size: 14px;
          background: var(--accent-indigo);
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
      `}</style>
    </div>
  );
}
