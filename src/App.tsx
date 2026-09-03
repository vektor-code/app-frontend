import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { HardDrives, Stack } from '@phosphor-icons/react';
import { api } from './api/client';
import type { NamespaceStats } from './entities';
import HeaderDropdown, { type HeaderDropdownOption } from './components/HeaderDropdown';
import HeaderAccountMenu from './components/HeaderAccountMenu';
import LanguageSwitcher from './components/LanguageSwitcher';
import Sidebar from './components/Sidebar';
import { ThemeSwapper } from './components/ThemeSwapper';
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

export default function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [license, setLicense] = useState<{ valid?: boolean; code?: string; message?: string; expires_at?: string | null } | null>(null);
  const [licenseBlock, setLicenseBlock] = useState<{ code?: string; message?: string; expires_at?: string | null } | null>(null);
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

  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');
  // Auth check on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const currentUser = await api.getCurrentUser();
          setUser(currentUser);
          const licenseStatus = await api.getLicense().catch(() => ({ valid: true as const }));
          if (licenseStatus && licenseStatus.valid === false) {
            localStorage.removeItem('token');
            setUser(null);
            setLicenseBlock({
              code: licenseStatus.code,
              message: licenseStatus.message,
              expires_at: licenseStatus.expires_at,
            });
            setLicense(licenseStatus);
          } else {
            setLicense(licenseStatus);
          }
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
    setLicenseBlock(null);
    navigate('/', { replace: true });
    api.getLicense()
      .then((licenseStatus) => {
        setLicense(licenseStatus);
        if (licenseStatus && licenseStatus.valid === false) {
          localStorage.removeItem('token');
          setUser(null);
          setLicenseBlock({
            code: licenseStatus.code,
            message: licenseStatus.message,
            expires_at: licenseStatus.expires_at,
          });
        }
      })
      .catch(() => setLicense({ valid: true }));
  }, [navigate]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setUser(null);
    setLicense(null);
  }, []);

  const dismissLicenseBlock = useCallback(() => {
    setLicenseBlock(null);
    setLicense(null);
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
        const next = await api.getLicense();
        setLicense(next);
        if (next && next.valid === false) {
          localStorage.removeItem('token');
          setUser(null);
          setLicenseBlock({
            code: next.code,
            message: next.message,
            expires_at: next.expires_at,
          });
        }
      } catch {
        // Keep the last known license snapshot.
      }
    };
    const interval = setInterval(refreshLicense, 30_000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user || license?.valid === false || licenseBlock) return;
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadStats, user, license?.valid, licenseBlock]);

  useEffect(() => {
    document.body.classList.toggle('dark-theme', isDark);
  }, [isDark]);

  const setTheme = (dark: boolean) => {
    document.body.classList.toggle('dark-theme', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    setIsDark(dark);
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
    if (licenseBlock) {
      return (
        <Suspense fallback={<PageFallback />}>
          <LicenseExpired
            code={licenseBlock.code}
            expiresAt={licenseBlock.expires_at}
            message={licenseBlock.message}
            onLogout={dismissLicenseBlock}
          />
        </Suspense>
      );
    }
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
          onLogout={() => {
            handleLogout();
            setLicenseBlock({
              code: license.code,
              message: license.message,
              expires_at: license.expires_at,
            });
          }}
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
    <div className="app-layout">
      <Sidebar user={user} />
      <div className="app-main">
        <header className="app-header">
          <div className="header-actions header-scope">
            <HeaderDropdown
              label={t('Cluster')}
              value={selectedCluster}
              icon={<HardDrives size={16} weight="light" />}
              options={[
                { value: '', label: t('All Clusters') },
                ...clusters.map(clusterOption).filter((option): option is HeaderDropdownOption => Boolean(option)),
              ]}
              onChange={(nextCluster) => {
                handleClusterChange(nextCluster);
                handleNamespaceChange('');
              }}
            />

            <HeaderDropdown
              label={t('Namespace')}
              value={selectedNamespace}
              icon={<Stack size={16} weight="light" />}
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
          <div className="header-actions header-session">
            <LanguageSwitcher compact />
            <ThemeSwapper dark={isDark} onChange={setTheme} variant="icon" />
            <HeaderAccountMenu user={user} onLogout={handleLogout} />
          </div>
        </header>
        <main className="app-content">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/" element={<Dashboard namespaces={namespaces} selectedNamespace={selectedNamespace} />} />
              <Route path="/services" element={<Services namespace={selectedNamespace} />} />
              <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} cluster={selectedCluster} />} />
              <Route path="/traces/:traceId" element={<TraceDetail />} />
              <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} />} />
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
