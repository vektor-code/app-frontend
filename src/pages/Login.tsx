import React, { useState } from 'react';
import { api } from '../api/client';

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'local' | 'ldap'>('ldap');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.login({ username, password, mode });
      onLogin(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials or network connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card animate-fade-in">
        <div className="login-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <span className="logo-text">Vektor Trace</span>
        </div>

        <h2 className="login-title">Sign in to telemetry platform</h2>
        <p className="login-subtitle">Enter your credentials below to access the cluster dashboard</p>

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
            🌐 LDAP / Active Directory
          </button>
          <button
            type="button"
            className={`login-tab-btn ${mode === 'local' ? 'active' : ''}`}
            onClick={() => {
              setMode('local');
              setError(null);
            }}
          >
            ⚙️ Local Admin
          </button>
        </div>

        {error && (
          <div className="login-error">
            <span>⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              {mode === 'ldap' ? 'LDAP Username (sAMAccountName)' : 'Local Admin Username'}
            </label>
            <input
              type="text"
              id="username"
              className="form-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={mode === 'ldap' ? 'e.g. jdoe' : 'admin'}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Password
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

          <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
            {loading ? 'Authenticating...' : 'Sign In'}
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
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(9, 12, 24, 0.99) 100%);
          padding: 20px;
          box-sizing: border-box;
        }
        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(30, 41, 59, 0.45);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 40px;
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }
        .login-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
        }
        .logo-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-indigo-light) 100%);
          color: white;
          border-radius: 10px;
          box-shadow: 0 0 16px var(--accent-indigo);
        }
        .logo-text {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.5px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .login-title {
          font-size: 22px;
          font-weight: 700;
          color: #f8fafc;
          margin: 0 0 8px 0;
        }
        .login-subtitle {
          font-size: 13.5px;
          color: #94a3b8;
          margin: 0 0 24px 0;
          line-height: 1.5;
        }
        .login-tabs {
          display: flex;
          gap: 4px;
          background: rgba(15, 23, 42, 0.6);
          padding: 4px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          margin-bottom: 20px;
        }
        .login-tab-btn {
          flex: 1;
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 600;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          outline: none;
        }
        .login-tab-btn:hover {
          color: #f8fafc;
        }
        .login-tab-btn.active {
          background: rgba(99, 102, 241, 0.15);
          color: #818cf8;
          border: 1px solid rgba(99, 102, 241, 0.25);
        }
        .login-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 12px;
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: #f43f5e;
          border-radius: 8px;
          font-size: 12.5px;
          line-height: 1.5;
          margin-bottom: 20px;
        }
        .login-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .login-submit {
          margin-top: 10px;
          padding: 10px;
          font-weight: 600;
          background: var(--gradient-primary);
          box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.4);
          border: none;
          color: white;
          cursor: pointer;
          border-radius: 8px;
        }
        .login-submit:hover {
          box-shadow: 0 6px 20px 0 rgba(99, 102, 241, 0.6);
        }
        .login-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          box-shadow: none;
        }
      `}</style>
    </div>
  );
}
