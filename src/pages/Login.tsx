import React, { useState } from 'react';
import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { api } from '../api/client';
import { isLocalMockAuth } from '../api/mockAuth';
import { useTranslation } from '../utils/i18n';
import { AuthVisual } from '../components/AuthVisual';
import { CloudraftMark } from '../components/CloudraftMark';
import { ThemeSwapper } from '../components/ThemeSwapper';
import '../auth.css';

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

const REMEMBER_KEY = 'crnet-apm.auth.remember';

function loadRemembered() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return { username: '', remember: false };
    const parsed = JSON.parse(raw);
    return {
      username: typeof parsed?.username === 'string' ? parsed.username : '',
      remember: Boolean(parsed?.remember),
    };
  } catch {
    return { username: '', remember: false };
  }
}

export default function Login({ onLogin }: LoginProps) {
  const { t } = useTranslation();
  const localMock = isLocalMockAuth();
  const remembered = loadRemembered();
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(remembered.remember);
  const [mode, setMode] = useState<'local' | 'ldap'>('local');
  const [peekPassword, setPeekPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => document.body.classList.contains('dark-theme'));

  const applyTheme = (dark: boolean) => {
    document.body.classList.toggle('dark-theme', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    setIsDark(dark);
  };

  const switchMode = (next: 'local' | 'ldap') => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t('Enter your username to continue.'));
      return;
    }
    if (!password && !localMock) {
      setError(t('Enter your password to continue.'));
      return;
    }

    setLoading(true);
    try {
      const data = await api.login({ username: trimmed, password, mode });
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: trimmed, remember: true }));
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err.message || t('Login failed. Please check your credentials.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="apm-auth-shell">
      <AuthVisual />

      <main className="apm-auth-panel">
        <div className="apm-auth-panel-tools">
          <ThemeSwapper dark={isDark} onChange={applyTheme} />
        </div>

        <form className="apm-auth-form" onSubmit={handleSubmit}>
          <div className="apm-auth-form-brand">
            <CloudraftMark title="Cloudraft" />
          </div>
          <h1>{t('Sign in')}</h1>

          <div className="apm-auth-tabs" data-mode={mode} role="tablist" aria-label={t('Sign-in method')}>
            <span className="apm-auth-tab-pill" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'local'}
              className={`apm-auth-tab ${mode === 'local' ? 'active' : ''}`}
              onClick={() => switchMode('local')}
            >
              {t('Local')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'ldap'}
              className={`apm-auth-tab ${mode === 'ldap' ? 'active' : ''}`}
              onClick={() => switchMode('ldap')}
            >
              {t('LDAP')}
            </button>
          </div>

          {error ? <div className="apm-auth-error">{error}</div> : null}

          <label className="apm-auth-field" htmlFor="username">
            {t('Username')}
            <span className="apm-auth-field-control">
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(null);
                }}
                disabled={loading}
                required
              />
            </span>
          </label>

          <label className="apm-auth-field" htmlFor="password">
            {t('Password')}
            <span className="apm-auth-field-control">
              <input
                id="password"
                name="password"
                type={peekPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required={!localMock}
              />
              <button
                aria-label={peekPassword ? t('Hide password') : t('Show password')}
                className="apm-auth-peek"
                onClick={() => setPeekPassword((open) => !open)}
                type="button"
              >
                {peekPassword ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
              </button>
            </span>
          </label>

          <div className="apm-auth-actions">
            <label className="apm-auth-remember">
              <input
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                type="checkbox"
              />
              <span aria-hidden="true" className="apm-auth-checkbox" />
              <span>{t('Remember me')}</span>
            </label>

            <button
              aria-busy={loading}
              className="apm-auth-submit"
              disabled={loading}
              type="submit"
            >
              {loading ? (
                <LoaderCircle aria-hidden className="apm-auth-submit-spinner" size={16} strokeWidth={2.4} />
              ) : null}
              <span>{loading ? t('Signing in') : t('Sign in')}</span>
            </button>
          </div>
          {localMock ? (
            <p className="apm-auth-local-hint">{t('Localhost mock — any username and password.')}</p>
          ) : null}
        </form>
      </main>
    </div>
  );
}
