import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { api, type NamespaceStats } from './api/client';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TraceExplorer from './pages/TraceExplorer';
import TraceDetail from './pages/TraceDetail';
import ServiceMap from './pages/ServiceMap';
import DbAnalytics from './pages/DbAnalytics';
import LiveStream from './pages/LiveStream';
import Login from './pages/Login';
import Dependencies from './pages/Dependencies';


export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceStats[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState(() => {
    return localStorage.getItem('selectedNamespace') || '';
  });

  const handleNamespaceChange = useCallback((ns: string) => {
    setSelectedNamespace(ns);
    localStorage.setItem('selectedNamespace', ns);
  }, []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  }, []);

  const [connected, setConnected] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const navigate = useNavigate();

  // Auth check on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const currentUser = await api.getCurrentUser();
          setUser(currentUser);
        } catch {
          localStorage.removeItem('token');
          setUser(null);
        }
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, []);

  const handleLogin = useCallback((loggedInUser: any, token: string) => {
    localStorage.setItem('token', token);
    setUser(loggedInUser);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [statsData, nsData] = await Promise.all([
        api.getStats(),
        api.getNamespaces().catch(() => ({ namespaces: [] as string[] })),
      ]);
      const statsNs = statsData.namespaces || [];
      const statsMap = new Map(statsNs.map(ns => [ns.namespace, ns]));

      const isSystemNamespace = (name: string): boolean => {
        const systemPrefixes = ['kube-', 'local-path-', 'ingress-', 'cert-', 'kubernetes-', 'tigera-', 'calico-', 'gatekeeper-', 'istio-', 'linkerd-'];
        return systemPrefixes.some(prefix => name.startsWith(prefix)) || ['default', 'kube-system', 'kube-public', 'kube-node-lease', 'local-path-storage'].includes(name);
      };

      for (const ns of (nsData.namespaces || [])) {
        if (isSystemNamespace(ns)) {
          continue;
        }
        if (!statsMap.has(ns)) {
          statsNs.push({
            namespace: ns,
            traceCount: 0,
            errorCount: 0,
            errorRate: 0,
            avgDurationMs: 0,
            services: [],
            podCount: 0,
            lastActivity: '',
          });
        }
      }

      setNamespaces(statsNs);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadStats, user]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      setIsDark(true);
      document.body.classList.add('dark-theme');
    } else {
      setIsDark(false);
      document.body.classList.remove('dark-theme');
    }
  }, []);

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

  // Loading spinner while checking auth
  if (authChecking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: 'var(--bg-primary, #0f0f23)',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
        }}>
          <div style={{
            width: '44px',
            height: '44px',
            border: '3px solid rgba(99, 102, 241, 0.15)',
            borderTopColor: 'var(--accent-indigo, #6366f1)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{
            color: 'var(--text-secondary, #94a3b8)',
            fontSize: '14px',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}>
            Authenticating…
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Show login page when not authenticated
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        namespaces={namespaces}
        selectedNamespace={selectedNamespace}
        onNamespaceChange={(ns) => {
          handleNamespaceChange(ns);
          navigate('/');
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      />
      <div className="app-main">
        <header className="app-header">
          <div className="header-title">
            {selectedNamespace ? (
              <><span className="badge badge-ns">{selectedNamespace}</span> Trace Overview</>
            ) : (
              'All Namespaces'
            )}
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={toggleTheme} style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} title="Toggle Theme">
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
            <div className="header-user" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '16px', fontSize: '12.5px', fontWeight: 500, color: 'var(--text-secondary)' }}>
              <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
                {(user?.username || user?.name || 'U').charAt(0)}
              </div>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user?.username || user?.name || 'User'}</span>
            </div>
            <button
              className="btn btn-ghost"
              onClick={handleLogout}
              title="Logout"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: 'var(--text-secondary, #94a3b8)',
                opacity: 0.85,
                transition: 'opacity 0.2s, color 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
                e.currentTarget.style.color = 'var(--accent-rose, #f43f5e)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.85';
                e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        </header>
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard namespaces={namespaces} selectedNamespace={selectedNamespace} onSelectNamespace={handleNamespaceChange} />} />
            <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} />} />
            <Route path="/traces/:traceId" element={<TraceDetail />} />
            <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} collapsed={sidebarCollapsed} />} />
            <Route path="/dependencies" element={<Dependencies namespace={selectedNamespace} />} />
            <Route path="/database" element={<DbAnalytics namespace={selectedNamespace} />} />
            <Route path="/live" element={<LiveStream namespace={selectedNamespace} />} />

          </Routes>
        </main>
      </div>
    </div>
  );
}
