import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { api } from './api/client';
import type { NamespaceStats } from './entities';
import Sidebar from './components/Sidebar';
import { useTranslation } from './utils/i18n';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const TraceExplorer = React.lazy(() => import('./pages/TraceExplorer'));
const TraceDetail = React.lazy(() => import('./pages/TraceDetail'));
const ServiceMap = React.lazy(() => import('./pages/ServiceMap'));
const DbAnalytics = React.lazy(() => import('./pages/DbAnalytics'));
const LiveStream = React.lazy(() => import('./pages/LiveStream'));
const Login = React.lazy(() => import('./pages/Login'));
const Dependencies = React.lazy(() => import('./pages/Dependencies'));
const Admin = React.lazy(() => import('./pages/Admin'));
const Alerts = React.lazy(() => import('./pages/Alerts'));
const Services = React.lazy(() => import('./pages/Services'));

function PageFallback() {
  return <div style={{ minHeight: '240px' }} />;
}

export default function App() {
  const { t } = useTranslation();
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceStats[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState(() => {
    return localStorage.getItem('selectedNamespace') || '';
  });

  const [selectedCluster, setSelectedCluster] = useState(() => {
    return localStorage.getItem('selectedCluster') || '';
  });
  const [clusters, setClusters] = useState<any[]>([]);

  const handleNamespaceChange = useCallback((ns: string) => {
    setSelectedNamespace(ns);
    localStorage.setItem('selectedNamespace', ns);
  }, []);

  const handleClusterChange = useCallback((cluster: string) => {
    setSelectedCluster(cluster);
    localStorage.setItem('selectedCluster', cluster);
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

  const [statsLoaded, setStatsLoaded] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const clusterQuery = selectedCluster || undefined;
      const [statsData, nsData, clustersData] = await Promise.all([
        api.getStats(),
        api.getNamespaces(clusterQuery).catch(() => ({ namespaces: [] as string[] })),
        api.getClusters().catch(() => ({ clusters: [] as string[] })),
      ]);
      const statsNs = statsData.namespaces || [];
      const statsMap = new Map(statsNs.map(ns => [ns.namespace, ns]));

      for (const ns of (nsData.namespaces || [])) {
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
      setClusters(clustersData.clusters || []);
      setStatsLoaded(true);
    } catch {
      setStatsLoaded(true);
    }
  }, [selectedCluster]);

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
            {t('Authenticating…')}
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  // Show login page when not authenticated
  if (!user) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Login onLogin={handleLogin} />
      </Suspense>
    );
  }

  // A non-admin user with zero visible namespaces has not been granted
  // access yet — show a clear full-page notice instead of empty dashboards.
  if (statsLoaded && user.role !== 'admin' && namespaces.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', background: 'var(--bg-primary)', padding: '24px' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '18px',
          maxWidth: '460px', padding: '48px 44px', borderRadius: '20px',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
          boxShadow: '0 24px 60px -20px rgba(0, 0, 0, 0.45)',
        }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(139, 92, 246, 0.12))',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}>
            <svg viewBox="0 0 24 24" width="32" height="32" stroke="var(--accent-indigo, #6366f1)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            {t('No access yet')}
          </h1>
          <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>
            {t('Your account has no namespaces assigned yet.')}
          </p>
          <div style={{
            fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6,
            background: 'rgba(99, 102, 241, 0.07)', border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: '10px', padding: '12px 16px', width: '100%',
          }}>
            {t('Contact your DevOps team to request access for')}
            <span className="mono" style={{ fontFamily: 'var(--font-mono)' }}> {user.username}</span>.
          </div>
          <button
            onClick={handleLogout}
            style={{
              marginTop: '4px', padding: '9px 22px', borderRadius: '10px', border: '1px solid var(--border-primary)',
              background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('Sign out')}
          </button>
        </div>
      </div>
    );
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
        user={user}
        onLogout={handleLogout}
      />
      <div className="app-main">
        <header className="app-header">
          <div className="header-context">
            <span className="header-kicker">{t('Telemetry scope')}</span>
            <div className="header-title">
              <span className="header-title-dot" />
              <span>{selectedNamespace || t('All Namespaces')}</span>
            </div>
          </div>
          <div className="header-actions">
            <div className="header-filter">
              <span className="header-filter-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
                  <path d="m4.5 8 7.5 4.2L19.5 8" />
                  <path d="M12 21v-8.8" />
                </svg>
              </span>
              <span className="header-filter-label">{t('Cluster')}</span>
              <select
                className="header-select"
                value={selectedCluster}
                onChange={(e) => {
                  handleClusterChange(e.target.value);
                  handleNamespaceChange('');
                }}
              >
                <option value="">{t('All Clusters')}</option>
                {clusters.map((c: any) => (
                  <option key={c.name} value={c.name}>{c.displayName || c.name}</option>
                ))}
              </select>
            </div>

            <div className="header-filter">
              <span className="header-filter-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
              </span>
              <span className="header-filter-label">{t('Namespace')}</span>
              <select
                className="header-select"
                value={selectedNamespace}
                onChange={(e) => handleNamespaceChange(e.target.value)}
              >
                <option value="">{t('All Namespaces')}</option>
                {namespaces
                  .filter(ns => !selectedCluster || ns.cluster === selectedCluster)
                  .map((ns) => (
                    <option key={ns.namespace} value={ns.namespace}>
                      {ns.namespace}
                    </option>
                  ))}
              </select>
            </div>

            <button
              className="header-icon-btn"
              onClick={toggleTheme}
              title={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
            >
              {isDark ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div className="header-user-chip" title={`${user?.name || user?.username || 'User'}${user?.email ? ` · ${user.email}` : ''}`}>
              <div className="header-user-avatar">
                {String(user?.name || user?.username || 'U').trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() || '').join('') || 'U'}
              </div>
              <div className="header-user-meta">
                <span className="header-user-name">{user?.name || user?.username || 'User'}</span>
                <span className="header-user-role">{user?.role === 'admin' ? t('Administrator') : t('Viewer')}</span>
              </div>
            </div>
          </div>
        </header>
        <main className="app-content">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard namespaces={namespaces} selectedNamespace={selectedNamespace} onSelectNamespace={handleNamespaceChange} />} />
              <Route path="/services" element={<Services namespace={selectedNamespace} />} />
              <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} cluster={selectedCluster} />} />
              <Route path="/traces/:traceId" element={<TraceDetail />} />
              <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} collapsed={sidebarCollapsed} />} />
              <Route path="/dependencies" element={<Dependencies namespace={selectedNamespace} />} />
              <Route path="/database" element={<DbAnalytics namespace={selectedNamespace} />} />
              <Route path="/live" element={<LiveStream namespace={selectedNamespace} />} />
              <Route path="/alerts" element={<Alerts namespace={selectedNamespace} />} />
              <Route path="/admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
