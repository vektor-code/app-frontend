import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Routes, Route, Navigate } from 'react-router-dom';
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
const LicenseExpired = React.lazy(() => import('./pages/LicenseExpired'));
const Dependencies = React.lazy(() => import('./pages/Dependencies'));
const Admin = React.lazy(() => import('./pages/Admin'));
const Alerts = React.lazy(() => import('./pages/Alerts'));
const Infrastructure = React.lazy(() => import('./pages/Infrastructure'));
const Services = React.lazy(() => import('./pages/Services'));

function PageFallback() {
  return <div style={{ minHeight: '240px' }} />;
}

type HeaderDropdownOption = {
  value: string;
  label: string;
};

function clusterOption(cluster: string | { name?: string; displayName?: string }): HeaderDropdownOption | null {
  if (typeof cluster === 'string') {
    return cluster ? { value: cluster, label: cluster } : null;
  }
  const name = cluster.name || '';
  if (!name) return null;
  return {
    value: name,
    label: cluster.displayName || name,
  };
}

function HeaderDropdown({
  label,
  value,
  options,
  icon,
  onChange,
}: {
  label: string;
  value: string;
  options: HeaderDropdownOption[];
  icon?: React.ReactNode;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value) || options[0];

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2, 300);
    const left = Math.min(
      Math.max(viewportPadding, rect.right - width),
      window.innerWidth - width - viewportPadding
    );
    setMenuPosition({
      top: rect.bottom + 8,
      left,
      width
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const reposition = () => updateMenuPosition();
    updateMenuPosition();
    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateMenuPosition]);

  const menu = (
    <div
      ref={menuRef}
      className="header-dropdown-menu"
      role="listbox"
      aria-label={label}
      style={menuPosition ? { top: menuPosition.top, left: menuPosition.left, width: menuPosition.width } : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          rootRef.current?.querySelector('button')?.focus();
        }
      }}
    >
      {options.map((option, index) => (
        <button
          key={`${option.value || '__all__'}-${index}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          className={option.value === value ? 'selected' : ''}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span title={option.label}>{option.label}</span>
          {option.value === value && (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div
      className={`header-dropdown ${open ? 'open' : ''}`}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="header-dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
        if (!open) updateMenuPosition();
          setOpen(current => !current);
        }}
      >
        {icon && <span className="header-filter-icon" aria-hidden="true">{icon}</span>}
        <span className="header-dropdown-value" title={selected?.label}>{selected?.label}</span>
        <svg className="header-dropdown-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [license, setLicense] = useState<{ valid?: boolean; code?: string; message?: string; expires_at?: string | null } | null>(null);
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
    const savedPreference = localStorage.getItem('sidebarCollapsed');
    if (savedPreference !== null) {
      return savedPreference === 'true';
    }
    return window.innerWidth <= 900;
  });

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  }, []);

  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');
  // Auth check on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const currentUser = await api.getCurrentUser();
          setUser(currentUser);
          const licenseStatus = await api.getLicense().catch(() => ({ valid: true }));
          setLicense(licenseStatus);
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
    setIsDark(localStorage.getItem('theme') === 'dark');
    setUser(loggedInUser);
    api.getLicense().then(setLicense).catch(() => setLicense({ valid: true }));
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
        api.getClusters().catch(() => ({ clusters: [] })),
      ]);
      const statsNs = statsData.namespaces || [];
      const statsMap = new Map(statsNs.map(ns => [ns.namespace, ns]));
      const discoveredNamespaces = nsData.namespaces || [];

      for (const ns of discoveredNamespaces) {
        const existing = statsMap.get(ns);
        if (existing) {
          if (selectedCluster) {
            existing.cluster = selectedCluster;
          }
        } else {
          const discoveredStat: NamespaceStats = {
            namespace: ns,
            cluster: selectedCluster || undefined,
            traceCount: 0,
            errorCount: 0,
            errorRate: 0,
            avgDurationMs: 0,
            services: [],
            podCount: 0,
            lastActivity: '',
          };
          statsNs.push(discoveredStat);
          statsMap.set(ns, discoveredStat);
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
    const refreshLicense = async () => {
      try {
        setLicense(await api.getLicense());
      } catch {
        // Keep the last known license snapshot.
      }
    };
    const interval = setInterval(refreshLicense, 30_000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user || license?.valid === false) return;
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadStats, user]);

  useEffect(() => {
    document.body.classList.toggle('dark-theme', isDark);
  }, [isDark]);

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

  if (license && license.valid === false) {
    return (
      <Suspense fallback={<PageFallback />}>
        <LicenseExpired
          code={license.code}
          expiresAt={license.expires_at}
          message={license.message}
          onLogout={handleLogout}
        />
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
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
        onLogout={handleLogout}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
      <div className="app-main">
        <header className="app-header">
          <div className="header-actions">
            <div className="header-filter">
              <HeaderDropdown
                label={t('Cluster')}
                value={selectedCluster}
                icon={(
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
                    <path d="m4.5 8 7.5 4.2L19.5 8" />
                    <path d="M12 21v-8.8" />
                  </svg>
                )}
                options={[
                  { value: '', label: t('All Clusters') },
                  ...clusters.map(clusterOption).filter((option): option is HeaderDropdownOption => Boolean(option)),
                ]}
                onChange={(nextCluster) => {
                  handleClusterChange(nextCluster);
                  handleNamespaceChange('');
                }}
              />
            </div>

            <div className="header-filter">
              <HeaderDropdown
                label={t('Namespace')}
                value={selectedNamespace}
                icon={(
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                )}
                options={[
                  { value: '', label: t('All Namespaces') },
                  ...namespaces
                  .filter(ns => !selectedCluster || ns.cluster === selectedCluster)
                  .map((ns) => ({
                    value: ns.namespace,
                    label: ns.namespace,
                  })),
                ]}
                onChange={handleNamespaceChange}
              />
            </div>

          </div>
        </header>
        <main className="app-content">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard namespaces={namespaces} selectedNamespace={selectedNamespace} />} />
              <Route path="/services" element={<Services namespace={selectedNamespace} />} />
              <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} cluster={selectedCluster} />} />
              <Route path="/traces/:traceId" element={<TraceDetail />} />
              <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} collapsed={sidebarCollapsed} />} />
              <Route path="/dependencies" element={<Dependencies namespace={selectedNamespace} />} />
              <Route path="/database" element={<DbAnalytics namespace={selectedNamespace} />} />
              <Route path="/infrastructure" element={<Infrastructure namespace={selectedNamespace} />} />
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
