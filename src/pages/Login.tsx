import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, User, Users } from 'lucide-react';
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [peekPassword, setPeekPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => document.body.classList.contains('dark-theme'));
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!passwordVisible) return;
    const frame = requestAnimationFrame(() => passwordRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [passwordVisible]);

  const applyTheme = (dark: boolean) => {
    document.body.classList.toggle('dark-theme', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    setIsDark(dark);
  };

  const resetPasswordStep = () => {
    setPasswordVisible(false);
    setPassword('');
    setPeekPassword(false);
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
    if (!password && !localMock) return;
    await signIn();
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

          <label className="apm-auth-field" htmlFor="username">
            {t('Username')}
            <span className="apm-auth-field-control">
              <User className="apm-auth-field-icon" size={16} strokeWidth={1.8} />
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                disabled={loading}
                required
              />
            </span>
          </label>

          <div className={`apm-auth-password-slot${passwordVisible ? ' is-open' : ''}`}>
            <div className="apm-auth-password-inner">
              <label className="apm-auth-field" htmlFor="password">
                {t('Password')}
                <span className="apm-auth-field-control">
                  <input
                    id="password"
                    name="password"
                    type={peekPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    ref={passwordRef}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    required={passwordVisible && !localMock}
                    tabIndex={passwordVisible ? 0 : -1}
                  />
                  <button
                    aria-label={peekPassword ? t('Hide password') : t('Show password')}
                    className="apm-auth-peek"
                    onClick={() => setPeekPassword((open) => !open)}
                    tabIndex={passwordVisible ? 0 : -1}
                    type="button"
                  >
                    {peekPassword ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
                  </button>
                </span>
              </label>
            </div>
          </div>

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
              <span>
                {loading
                  ? passwordVisible
                    ? t('Signing in')
                    : t('Checking')
                  : passwordVisible
                    ? t('Sign in')
                    : t('Continue')}
              </span>
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
