import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
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
import Admin from './pages/Admin';


export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [namespaces, setNamespaces] = useState<NamespaceStats[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState(() => {
    return localStorage.getItem('selectedNamespace') || '';
  });

  const [selectedCluster, setSelectedCluster] = useState(() => {
    return localStorage.getItem('selectedCluster') || '';
  });
  const [clusters, setClusters] = useState<string[]>([]);

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
      const [statsData, nsData, clustersData] = await Promise.all([
        api.getStats(),
        api.getNamespaces().catch(() => ({ namespaces: [] as string[] })),
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
        user={user}
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
            {/* Cluster Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '16px', position: 'relative' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Cluster:</span>
              <select
                value={selectedCluster}
                onChange={(e) => {
                  handleClusterChange(e.target.value);
                  // Reset selected namespace if it does not belong to the selected cluster
                  handleNamespaceChange('');
                }}
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '20px',
                  padding: '6px 32px 6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  backgroundSize: '14px',
                  transition: 'all 0.2s',
                  boxShadow: 'var(--shadow-sm)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
              >
                <option value="">All Clusters</option>
                {clusters.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Namespace Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '16px', position: 'relative' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Namespace:</span>
              <select
                value={selectedNamespace}
                onChange={(e) => handleNamespaceChange(e.target.value)}
                style={{
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '20px',
                  padding: '6px 32px 6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  backgroundSize: '14px',
                  transition: 'all 0.2s',
                  boxShadow: 'var(--shadow-sm)',
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-primary)'}
              >
                <option value="">All Namespaces</option>
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
              className="btn btn-ghost"
              onClick={toggleTheme}
              style={{
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                boxShadow: 'var(--shadow-sm)',
                transition: 'all 0.2s',
              }}
              title="Toggle Theme"
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
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
            <div className="header-user" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '20px', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: 'auto' }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
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
            <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} cluster={selectedCluster} />} />
            <Route path="/traces/:traceId" element={<TraceDetail />} />
            <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} collapsed={sidebarCollapsed} />} />
            <Route path="/dependencies" element={<Dependencies namespace={selectedNamespace} />} />
            <Route path="/database" element={<DbAnalytics namespace={selectedNamespace} />} />
            <Route path="/live" element={<LiveStream namespace={selectedNamespace} />} />
            <Route path="/admin" element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />

          </Routes>
        </main>
      </div>
    </div>
  );
}
