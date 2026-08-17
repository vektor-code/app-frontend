import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Users } from 'lucide-react';
import { api } from '../api/client';
import { useTranslation } from '../utils/i18n';
import { AuthVisual } from '../components/AuthVisual';
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
  const remembered = loadRemembered();
  const [username, setUsername] = useState(remembered.username);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(remembered.remember);
  const [mode, setMode] = useState<'local' | 'ldap'>('local');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => document.body.classList.contains('dark-theme'));
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!passwordVisible) return;
    const frame = requestAnimationFrame(() => passwordRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [passwordVisible]);

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

  const resetPasswordStep = () => {
    setPasswordVisible(false);
    setPassword('');
  };

  const onUsernameChange = (value: string) => {
    setUsername(value);
    if (passwordVisible) {
      resetPasswordStep();
      setError(null);
    }
  };

  const switchMode = (next: 'local' | 'ldap') => {
    if (next === mode) return;
    setMode(next);
    setError(null);
    resetPasswordStep();
  };

  const revealPassword = async () => {
    setError(null);
    const trimmed = username.trim();
    if (!trimmed) {
      setError(t('Enter your username to continue.'));
      return;
    }

    setLoading(true);
    try {
      const result = await api.lookupAccount({ username: trimmed, mode });
      if (!result?.exists) {
        setError(t('No account found for this username.'));
        resetPasswordStep();
        return;
      }
      setUsername(trimmed);
      setPasswordVisible(true);
    } catch (err: any) {
      setError(err.message || t('Unable to verify account'));
      resetPasswordStep();
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.login({ username: username.trim(), password, mode });
      if (remember) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: username.trim(), remember: true }));
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordVisible) {
      await revealPassword();
      return;
    }
    if (!password) return;
    await signIn();
  };

  return (
    <div className="apm-auth-shell">
      <AuthVisual />

      <main className="apm-auth-panel">
        <div className="apm-auth-panel-tools">
          <button
            type="button"
            className="apm-auth-theme-toggle"
            data-mode={isDark ? 'dark' : 'light'}
            onClick={toggleTheme}
            title={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
          >
            <span className="apm-auth-theme-icon" aria-hidden="true">
              {isDark ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
              )}
            </span>
            <span className="apm-auth-theme-label">{isDark ? t('Dark') : t('Light')}</span>
          </button>
        </div>

        <form className="apm-auth-form" onSubmit={handleSubmit}>
          <h1>{t('Welcome back')}</h1>

          <div className="apm-auth-tabs" data-mode={mode}>
            <span className="apm-auth-tab-pill" aria-hidden="true" />
            <button
              type="button"
              className={`apm-auth-tab ${mode === 'local' ? 'active' : ''}`}
              onClick={() => switchMode('local')}
            >
              <KeyRound size={15} strokeWidth={2.2} aria-hidden />
              <span>{t('Local')}</span>
            </button>
            <button
              type="button"
              className={`apm-auth-tab ${mode === 'ldap' ? 'active' : ''}`}
              onClick={() => switchMode('ldap')}
            >
              <Users size={15} strokeWidth={2.2} aria-hidden />
              <span>{t('LDAP')}</span>
            </button>
          </div>

          {error ? <div className="apm-auth-error">{error}</div> : null}

          <label htmlFor="username">{t('Username')}</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="admin"
            disabled={loading}
            required
          />

          <div className={`apm-auth-password-slot${passwordVisible ? ' is-open' : ''}`}>
            <div className="apm-auth-password-inner">
              <label htmlFor="password">{t('Password')}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                required={passwordVisible}
                tabIndex={passwordVisible ? 0 : -1}
              />
            </div>
          </div>

          <label className="apm-auth-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t('Remember me')}
          </label>

          <button className="apm-auth-submit" type="submit" disabled={loading}>
            {loading
              ? passwordVisible
                ? t('Signing in…')
                : t('Checking…')
              : passwordVisible
                ? t('Sign in')
                : t('Continue')}
          </button>
        </form>
      </main>
    </div>
  );
}
