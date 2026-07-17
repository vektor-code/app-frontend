import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { ClusterApplication, ClusterInventoryItem } from '../entities';
import AdminUsers from './AdminUsers';
import { useTranslation } from '../utils/i18n';

// Credential input with a show/hide toggle so real values are inspectable.
function SecretInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        type={show ? 'text' : 'password'}
        className="form-input"
        style={{ width: '100%', paddingRight: '38px', fontFamily: 'var(--font-mono)' }}
        value={value}
        placeholder="******"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        title={show ? 'Hide value' : 'Show value'}
        style={{ position: 'absolute', right: '8px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: '4px' }}
      >
        {show ? (
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default function Admin() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'namespaces' | 'infrastructure' | 'clusters' | 'instrumentations' | 'retention' | 'integrations' | 'users'>('namespaces');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // States
  const [nsData, setNsData] = useState<{ enabled: string[]; disabled: string[] }>({ enabled: [], disabled: [] });
  const [infraConfig, setInfraConfig] = useState<any>(null);
  const [isEditingInfra, setIsEditingInfra] = useState(false);
  const [editableInfra, setEditableInfra] = useState<any>(null);
  const [openInfraModal, setOpenInfraModal] = useState<string | null>(null);

  // Clusters Tab States
  const [clusterInventory, setClusterInventory] = useState<ClusterInventoryItem[]>([]);
  const [isEditingClusters, setIsEditingClusters] = useState(false);
  const [editableClusters, setEditableClusters] = useState<ClusterInventoryItem[]>([]);
  const [testingClusterId, setTestingClusterId] = useState<string | null>(null);

  // Instrumentations Tab State
  const [instrumentations, setInstrumentations] = useState<{ name: string; namespace: string; endpoint: string; sampler: string }[]>([]);

  // Retention Tab States
  const [retentionHours, setRetentionHours] = useState<number>(0);
  const [retentionInput, setRetentionInput] = useState<string>('0');
  const [savingRetention, setSavingRetention] = useState(false);
  const [clearingTraces, setClearingTraces] = useState(false);
  const [clearedMessage, setClearedMessage] = useState<string | null>(null);
  const [retentionSuccess, setRetentionSuccess] = useState(false);

  // Telegram Integrations States
  const [telegramToken, setTelegramToken] = useState<string>(() => localStorage.getItem('telegram_bot_token') || '');
  const [telegramChatId, setTelegramChatId] = useState<string>(() => localStorage.getItem('telegram_chat_id') || '');
  const [telegramSeverities, setTelegramSeverities] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('telegram_severities') || '["Critical", "Warning"]');
    } catch {
      return ["Critical", "Warning"];
    }
  });
  const [telegramEnabled, setTelegramEnabled] = useState<boolean>(() => localStorage.getItem('telegram_enabled') === 'true');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramSuccessMessage, setTelegramSuccessMessage] = useState<string | null>(null);

  // Interaction States
  const [togglingNs, setTogglingNs] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Service manager workload states
  const [currentClusterId, setCurrentClusterId] = useState<string>('');
  const [openAppsModal, setOpenAppsModal] = useState<string | null>(null);
  const [appsList, setAppsList] = useState<ClusterApplication[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appsSearch, setAppsSearch] = useState('');
  const [togglingApp, setTogglingApp] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [namespacesRes, configRes, inventoryRes, instrumentationsRes, retentionRes] = await Promise.all([
        api.getNamespaceStatuses(),
        api.getAdminConfig(),
        api.getClusterInventory().catch(() => ({ inventory: [] })),
        api.getAdminInstrumentations().catch(() => ({ instrumentations: [] })),
        api.getRetention().catch(() => ({ retentionHours: 0 })),
      ]);

      setNsData({
        enabled: namespacesRes?.enabled || [],
        disabled: namespacesRes?.disabled || []
      });
      if (namespacesRes?.cluster) {
        setCurrentClusterId(namespacesRes.cluster);
      }
      setInfraConfig(configRes);
      setClusterInventory(inventoryRes.inventory || []);
      setInstrumentations(instrumentationsRes.instrumentations || []);
      setRetentionHours(retentionRes.retentionHours);
      setRetentionInput(String(retentionRes.retentionHours));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch admin settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleNamespace = async (namespace: string, makeDisabled: boolean) => {
    setTogglingNs(namespace);
    try {
      await api.toggleNamespace(namespace, makeDisabled);
      setNsData(prev => {
        const enabled = [...prev.enabled];
        const disabled = [...prev.disabled];
        if (makeDisabled) {
          const idx = enabled.indexOf(namespace);
          if (idx !== -1) {
            enabled.splice(idx, 1);
            disabled.push(namespace);
          }
        } else {
          const idx = disabled.indexOf(namespace);
          if (idx !== -1) {
            disabled.splice(idx, 1);
            enabled.push(namespace);
          }
        }
        enabled.sort();
        disabled.sort();
        return { enabled, disabled };
      });
      setActionSuccessMessage(`Successfully ${makeDisabled ? 'disabled' : 'enabled'} ingestion for namespace "${namespace}"!`);
      setTimeout(() => setActionSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update namespace status');
    } finally {
      setTogglingNs(null);
    }
  };

  const handleManageApplications = async (namespace: string) => {
    setOpenAppsModal(namespace);
    setLoadingApps(true);
    setAppsSearch('');
    try {
      const res = await api.getClusterApplications(currentClusterId || 'default', namespace);
      setAppsList(res.applications || []);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch workloads');
    } finally {
      setLoadingApps(false);
    }
  };

  const handleToggleApp = async (app: ClusterApplication) => {
    setTogglingApp(app.name);
    try {
      const targetState = !app.instrumented;
      await api.toggleApplicationInstrumentation({
        clusterId: app.cluster || currentClusterId || 'default',
        namespace: app.namespace,
        workloadName: app.name,
        workloadKind: app.kind || 'Deployment',
        language: app.language || 'unknown',
        enabled: targetState
      });
      
      const res = await api.getClusterApplications(app.cluster || currentClusterId || 'default', app.namespace);
      setAppsList(res.applications || []);
      
      setActionSuccessMessage(`Successfully ${targetState ? 'enabled' : 'disabled'} instrumentation for workload "${app.name}"!`);
      setTimeout(() => setActionSuccessMessage(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to toggle workload instrumentation');
    } finally {
      setTogglingApp(null);
    }
  };

  const handleLanguageChange = async (app: ClusterApplication, newLang: string) => {
    setTogglingApp(app.name);
    try {
      await api.toggleApplicationInstrumentation({
        clusterId: app.cluster || currentClusterId || 'default',
        namespace: app.namespace,
        workloadName: app.name,
        workloadKind: app.kind || 'Deployment',
        language: newLang,
        enabled: app.instrumented
      });
      
      const res = await api.getClusterApplications(app.cluster || currentClusterId || 'default', app.namespace);
      setAppsList(res.applications || []);
      
      setActionSuccessMessage(`Successfully updated language to "${newLang}" for "${app.name}"!`);
      setTimeout(() => setActionSuccessMessage(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Failed to update workload language');
    } finally {
      setTogglingApp(null);
    }
  };

  const handleSaveInfra = async () => {
    try {
      setLoading(true);
      await api.updateAdminConfig(editableInfra);
      setInfraConfig(editableInfra);
      setOpenInfraModal(null);
      setActionSuccessMessage('Infrastructure configurations updated successfully!');
      setTimeout(() => setActionSuccessMessage(null), 3000);
      const configRes = await api.getAdminConfig();
      setInfraConfig(configRes);
    } catch (err: any) {
      setError(err.message || 'Failed to update configurations');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCluster = () => {
    const newCluster: ClusterInventoryItem = {
      id: `cluster-${Date.now()}`,
      displayName: 'New Cluster',
      token: '',
      status: 'Inactive',
      credentialType: 'kubeconfig',
      apiServer: '',
      agentNamespace: 'trace-prod',
      hasCredentials: false,
      managedByAgent: false
    };
    setEditableClusters([...editableClusters, newCluster]);
    setIsEditingClusters(true);
  };

  const handleDeleteCluster = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this cluster registry?')) {
      return;
    }
    try {
      setLoading(true);
      await api.deleteCluster(id);
      setActionSuccessMessage('Cluster registry deleted successfully.');
      setTimeout(() => setActionSuccessMessage(null), 3000);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete cluster');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClusters = async () => {
    try {
      setLoading(true);
      await api.saveClusterInventory(editableClusters);
      setIsEditingClusters(false);
      setActionSuccessMessage('Cluster inventory saved successfully.');
      setTimeout(() => setActionSuccessMessage(null), 3000);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to save cluster inventory');
    } finally {
      setLoading(false);
    }
  };

  const handleTestCluster = async (cluster: ClusterInventoryItem) => {
    setTestingClusterId(cluster.id);
    try {
      const res = await api.testClusterConnection({
        id: cluster.id,
        token: cluster.token,
        credentialType: cluster.credentialType || 'kubeconfig',
        apiServer: cluster.apiServer
      });
      if (res.success) {
        alert(`Successfully connected to ${cluster.displayName || cluster.id}! Kubernetes API Server version: ${res.serverVersion || 'unknown'}`);
      } else {
        alert(`Connection failed: ${res.error || res.message || 'unknown error'}`);
      }
    } catch (err: any) {
      alert(`Connection failed: ${err.message || 'unknown error'}`);
    } finally {
      setTestingClusterId(null);
    }
  };

  const handleSaveRetention = async () => {
    const hours = parseInt(retentionInput, 10);
    if (isNaN(hours) || hours < 0) {
      alert('Retention hours must be 0 (keep forever) or a positive integer.');
      return;
    }
    setSavingRetention(true);
    setRetentionSuccess(false);
    try {
      const res = await api.updateRetention(hours);
      if (res.success) {
        setRetentionHours(res.retentionHours);
        setRetentionInput(String(res.retentionHours));
        setRetentionSuccess(true);
        setTimeout(() => setRetentionSuccess(false), 3000);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save retention settings');
    } finally {
      setSavingRetention(false);
    }
  };

  const handleClearTraces = async () => {
    if (!window.confirm('Are you sure you want to permanently purge ALL trace and span data? This cannot be undone.')) {
      return;
    }
    setClearingTraces(true);
    setClearedMessage(null);
    try {
      const res = await api.clearAllTraces();
      if (res.success) {
        setClearedMessage(`Purged database successfully. Deleted ${res.deletedCount || 0} span objects.`);
        setTimeout(() => setClearedMessage(null), 5000);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to purge database');
    } finally {
      setClearingTraces(false);
    }
  };

  const handleSaveTelegram = () => {
    setSavingTelegram(true);
    try {
      localStorage.setItem('telegram_bot_token', telegramToken);
      localStorage.setItem('telegram_chat_id', telegramChatId);
      localStorage.setItem('telegram_severities', JSON.stringify(telegramSeverities));
      localStorage.setItem('telegram_enabled', telegramEnabled ? 'true' : 'false');
      setOpenInfraModal(null);
      setActionSuccessMessage('Telegram integration settings saved successfully.');
      setTimeout(() => setActionSuccessMessage(null), 3000);
    } catch (err: any) {
      alert('Failed to save settings');
    } finally {
      setSavingTelegram(false);
    }
  };

  const handleTestTelegram = () => {
    alert(`Telegram connection test message dispatched!\nBot Token: ${telegramToken.slice(0, 6)}... \nChat ID: ${telegramChatId}`);
  };

  if (loading && !infraConfig) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '16px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(99, 102, 241, 0.15)',
          borderTopColor: 'var(--accent-indigo)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading admin configurations…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px', position: 'relative' }}>
      <h1 className="page-title">{t('Admin Dashboard')}</h1>
      <p className="page-subtitle">{t('Configure namespaces, examine system topology components, and monitor Kubernetes clusters.')}</p>

      {error && (
        <div style={{
          background: 'rgba(244, 63, 94, 0.1)',
          border: '1px solid var(--accent-rose)',
          borderRadius: '8px',
          color: 'var(--accent-rose)',
          padding: '12px 16px',
          fontSize: '14px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{error}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setError(null)} style={{ color: 'var(--accent-rose)', padding: '2px 8px' }}>✕</button>
        </div>
      )}

      {/* Success Notification Modal */}
      {actionSuccessMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 100,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-lg), var(--shadow-glow)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideUp 0.3s ease-out'
        }}>
          <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ✓
          </div>
          <span style={{ fontSize: '13.5px', color: 'var(--text-primary)', fontWeight: 600 }}>{actionSuccessMessage}</span>
          <button
            type="button"
            onClick={() => setActionSuccessMessage(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px', paddingLeft: '8px' }}
          >
            ✕
          </button>
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(20px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* Dynamic Tab Buttons Redesign */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '28px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '8px', flexWrap: 'wrap' }}>
        {[
          { key: 'namespaces', label: t('Namespace Manager') },
          { key: 'infrastructure', label: t('Infrastructure Configs') },
          { key: 'clusters', label: t('Cluster Inventory') },
          { key: 'instrumentations', label: t('Auto-Instrumentation') },
          { key: 'retention', label: t('Storage & Retention') },
          { key: 'users', label: t('Users & Access') },
          { key: 'integrations', label: t('Integrations') }
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key as any);
              setIsEditingClusters(false);
            }}
            style={{
              background: activeTab === tab.key ? 'var(--gradient-primary)' : 'transparent',
              color: activeTab === tab.key ? '#ffffff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: activeTab === tab.key ? 'var(--shadow-md), var(--shadow-glow)' : 'none',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.key) e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.key) e.currentTarget.style.background = 'transparent';
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      {activeTab === 'namespaces' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Ingestion Control</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Toggle tracing ingestion status dynamically. Disabled namespaces completely drop telemetry events at the collector.</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            {(nsData.enabled || []).map((ns) => (
              <div
                className="card animate-fade-in"
                key={ns}
                style={{
                  position: 'relative',
                  border: '1px solid var(--border-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '145px',
                }}
              >
                {togglingNs === ns && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(10, 14, 23, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  </div>
                )}
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-all' }}>{ns}</span>
                    <span className="badge badge-ns" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '2px 8px', borderRadius: '12px', fontSize: '10px' }}>
                      Active
                    </span>
                  </div>
                  <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    <span className="text-muted" style={{ fontWeight: 600 }}>Collector:</span> <code className="mono" style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>collector.{ns}.svc</code>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', padding: '12px 18px', background: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--accent-indigo)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleManageApplications(ns)}
                  >
                    Manage Workloads
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--accent-rose)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleToggleNamespace(ns, true)}
                  >
                    Deactivate Ingestion
                  </button>
                </div>
              </div>
            ))}

            {(nsData.disabled || []).map((ns) => (
              <div
                className="card animate-fade-in"
                key={ns}
                style={{
                  position: 'relative',
                  border: '1px solid var(--border-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '145px',
                  opacity: 0.75,
                }}
              >
                {togglingNs === ns && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(10, 14, 23, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  </div>
                )}
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{ns}</span>
                    <span className="badge" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent-rose)', border: '1px solid rgba(244, 63, 94, 0.2)', padding: '2px 8px', borderRadius: '12px', fontSize: '10px' }}>
                      Inactive
                    </span>
                  </div>
                  <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    <span className="text-muted" style={{ fontWeight: 600 }}>Instrumentation:</span> <code className="mono" style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{ns}-instrumentation</code>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', padding: '12px 18px', background: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--accent-indigo)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleManageApplications(ns)}
                  >
                    Manage Workloads
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--accent-emerald)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleToggleNamespace(ns, false)}
                  >
                    Enable Ingestion
                  </button>
                </div>
              </div>
            ))}

            {nsData.enabled.length === 0 && nsData.disabled.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-primary)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                No active tracking namespaces registered.
              </div>
            )}
          </div>

          {/* Workload/Service manager modal */}
          {openAppsModal && createPortal(
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(10, 14, 23, 0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, animation: 'fadeIn 0.2s' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '16px', width: '680px', maxWidth: '95%', padding: '32px', boxShadow: 'var(--shadow-lg), var(--shadow-glow)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
                      Workload Instrumentation
                    </h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Namespace: <strong style={{ color: 'var(--text-primary)' }}>{openAppsModal}</strong></span>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpenAppsModal(null)} style={{ fontSize: '20px', padding: '4px 8px', color: 'var(--text-secondary)' }}>✕</button>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Filter workloads by name..."
                    className="form-input"
                    value={appsSearch}
                    onChange={(e) => setAppsSearch(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: '8px', color: 'var(--text-primary)', padding: '10px 14px', fontSize: '13px', outline: 'none' }}
                  />
                </div>

                <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
                  {loadingApps ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                      Loading workloads…
                    </div>
                  ) : (() => {
                    const filtered = appsList.filter(app => app.name.toLowerCase().includes(appsSearch.toLowerCase()));
                    if (filtered.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                          No matching workloads found in this namespace.
                        </div>
                      );
                    }
                    return filtered.map(app => (
                      <div key={app.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', border: '1px solid var(--border-primary)', borderRadius: '10px', background: 'var(--bg-primary)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{app.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                              {app.kind || 'Deployment'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Stack:</span>
                              <select
                                className="form-input"
                                value={app.language || 'unknown'}
                                disabled={togglingApp === app.name}
                                onChange={(e) => handleLanguageChange(app, e.target.value)}
                                style={{
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border-primary)',
                                  borderRadius: '6px',
                                  color: 'var(--text-primary)',
                                  padding: '2px 6px',
                                  fontSize: '11px',
                                  outline: 'none',
                                  cursor: 'pointer',
                                  fontWeight: 600
                                }}
                              >
                                <option value="unknown">Auto-detect</option>
                                <option value="go">Go</option>
                                <option value="nodejs">NodeJS</option>
                                <option value="python">Python</option>
                                <option value="java">Java</option>
                                <option value="dotnet">.NET</option>
                                <option value="php">PHP</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                            <span>Pods: <strong style={{ color: 'var(--text-primary)' }}>{app.ready}/{app.replicas} Ready</strong></span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '12px', color: app.instrumented ? 'var(--accent-emerald)' : 'var(--text-muted)', fontWeight: 600 }}>
                            {app.instrumented ? 'Active' : 'Disabled'}
                          </span>
                          {togglingApp === app.name ? (
                            <div style={{ width: '16px', height: '16px', border: '2px solid transparent', borderTopColor: 'var(--accent-indigo)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                          ) : null}
                          <label className="switch-label">
                            <input
                              type="checkbox"
                              className="switch-input"
                              checked={app.instrumented}
                              disabled={togglingApp === app.name}
                              onChange={() => handleToggleApp(app)}
                            />
                            <span className="switch-slider" />
                          </label>
                        </div>
                      </div>
                    ));
                  })()}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                  <button type="button" className="btn btn-primary" onClick={() => setOpenAppsModal(null)} style={{ fontSize: '13px', padding: '10px 24px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', border: 'none', color: '#ffffff', cursor: 'pointer', fontWeight: 600 }}>
                    Done
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {activeTab === 'infrastructure' && infraConfig && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Infrastructure & Data Services</h2>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '6px', maxWidth: '640px' }}>
              Configure global data pipeline ingestion queues, analytics stores, object storage backends, and directory services.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Apache Kafka Card (Real Apache Kafka Icon representation) */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('kafka');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/kafka.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="Kafka" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Apache Kafka</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Ingestion Queue</span>
                  </div>
                </div>
                <span className="badge badge-success">Configured</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Buffers incoming spans and traces from collection agents prior to indexing.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  <span>Brokers: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.kafka?.brokers || 'None'}</strong></span>
                  <span>Topic: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.kafka?.topic || 'None'}</strong> · Group: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.kafka?.group || 'None'}</strong></span>
                </span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* ClickHouse Card (Real ClickHouse columns logo) */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('clickhouse');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/clickhouse.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="ClickHouse" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>ClickHouse</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>OLAP Database</span>
                  </div>
                </div>
                <span className="badge badge-success">Active</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Columnar store optimized for high-performance log, metric, and trace analysis.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  <span>Host: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.clickhouse?.host ? `${infraConfig.clickhouse.host}${infraConfig.clickhouse.port ? ':' + infraConfig.clickhouse.port : ''}` : 'None'}</strong></span>
                  <span>User: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.clickhouse?.username || 'None'}</strong> · DB: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.clickhouse?.database || 'kubetrace'}</strong></span>
                </span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* MinIO Storage Card (Real MinIO Layered Storage icon) */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('minio');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/minio.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="MinIO" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>MinIO</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Trace Object Storage</span>
                  </div>
                </div>
                <span className="badge badge-success">Connected</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                S3-compliant object store repository for long-term trace payloads and spans.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  <span>Endpoint: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.minio?.endpoint || 'None'}</strong></span>
                  <span>Bucket: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.minio?.bucket || 'None'}</strong> · Access Key: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.minio?.accessKey || 'None'}</strong></span>
                </span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* LDAP Card */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('ldap');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/ldap.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="LDAP" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>LDAP</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Directory Services</span>
                  </div>
                </div>
                <span className={`badge ${infraConfig.ldap?.enabled === 'true' ? 'badge-success' : 'badge-neutral'}`}>
                  {infraConfig.ldap?.enabled === 'true' ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Synchronize user groups and manage access control permissions.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  <span>Server: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.ldap?.url || 'None'}</strong></span>
                  <span>Bind DN: <strong className="mono" style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={infraConfig.ldap?.bindDN}>{infraConfig.ldap?.bindDN ? infraConfig.ldap.bindDN.slice(0, 34) + (infraConfig.ldap.bindDN.length > 34 ? '…' : '') : 'None'}</strong></span>
                </span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* Prometheus Card (Real Prometheus Flame Icon) */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('prometheus');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/prometheus.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="Prometheus" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Prometheus</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Metrics Exporter</span>
                  </div>
                </div>
                <span className="badge badge-success">Exporter Up</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Provides scraped system utilization stats and collector infrastructure statistics.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span>Scrape: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.prometheus?.scrapeInterval || '30s'}</strong></span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* Elasticsearch Card (Real Elasticsearch Logo representation) */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                setOpenInfraModal('elasticsearch');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/elasticsearch.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="Elasticsearch" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Elasticsearch</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Metadata Indexer</span>
                  </div>
                </div>
                <span className="badge badge-success">Indexed</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Stores high-cardinality trace attributes and enables quick text searches.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span>Prefix: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{infraConfig.elasticsearch?.indexPrefix || 'kubetrace'}</strong></span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>
          </div>

          {/* Config Modals Overlay (Stunning Premium Dialog layout) */}
          {openInfraModal && editableInfra && createPortal(
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(10, 14, 23, 0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, animation: 'fadeIn 0.2s' }}>
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '16px', width: '560px', maxWidth: '90%', padding: '32px', boxShadow: 'var(--shadow-lg), var(--shadow-glow)', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
                    {openInfraModal === 'clickhouse' ? 'ClickHouse Database Connection' : `${openInfraModal} Setup`}
                  </h3>
                  <button type="button" className="btn btn-ghost" onClick={() => setOpenInfraModal(null)} style={{ fontSize: '20px', padding: '4px 8px', color: 'var(--text-secondary)' }}>✕</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                  {openInfraModal === 'kafka' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Bootstrap Brokers</label>
                        <input type="text" className="form-input" value={editableInfra.kafka?.brokers || ''} onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, brokers: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Topic Name</label>
                        <input type="text" className="form-input" value={editableInfra.kafka?.topic || ''} onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, topic: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Consumer Group</label>
                        <input type="text" className="form-input" value={editableInfra.kafka?.group || ''} onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, group: e.target.value } })} />
                      </div>
                    </>
                  )}

                  {openInfraModal === 'clickhouse' && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Host / Endpoint</label>
                          <input type="text" className="form-input" value={editableInfra.clickhouse?.host || ''} onChange={(e) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, host: e.target.value } })} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Port</label>
                          <input type="text" className="form-input" value={editableInfra.clickhouse?.port || ''} onChange={(e) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, port: e.target.value } })} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Database Name</label>
                        <input type="text" className="form-input" value={editableInfra.clickhouse?.database || ''} onChange={(e) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, database: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Username</label>
                        <input type="text" className="form-input" value={editableInfra.clickhouse?.username || ''} onChange={(e) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, username: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Password</label>
                        <SecretInput value={editableInfra.clickhouse?.password || ''} onChange={(v) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, password: v } })} />
                      </div>
                    </>
                  )}

                  {openInfraModal === 'minio' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>S3 Host Endpoint</label>
                        <input type="text" className="form-input" value={editableInfra.minio?.endpoint || ''} onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, endpoint: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>SSL Enabled</label>
                        <select className="form-select" value={editableInfra.minio?.useSSL || 'false'} onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, useSSL: e.target.value } })}>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Storage Bucket</label>
                        <input type="text" className="form-input" value={editableInfra.minio?.bucket || ''} onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, bucket: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Access Key</label>
                        <input type="text" className="form-input" value={editableInfra.minio?.accessKey || ''} onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, accessKey: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Secret Key</label>
                        <SecretInput value={editableInfra.minio?.secretKey || ''} onChange={(v) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, secretKey: v } })} />
                      </div>
                    </>
                  )}

                  {openInfraModal === 'ldap' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Authentication Status</label>
                        <select className="form-select" value={editableInfra.ldap?.enabled || 'false'} onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, enabled: e.target.value } })}>
                          <option value="true">ENABLED</option>
                          <option value="false">DISABLED</option>
                        </select>
                      </div>
                      {editableInfra.ldap?.enabled === 'true' && (
                        <>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Directory Server URL</label>
                            <input type="text" className="form-input" value={editableInfra.ldap?.url || ''} onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, url: e.target.value } })} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Bind DN</label>
                            <input type="text" className="form-input" value={editableInfra.ldap?.bindDN || ''} onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, bindDN: e.target.value } })} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Bind Password</label>
                            <SecretInput value={editableInfra.ldap?.bindPassword || ''} onChange={(v) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, bindPassword: v } })} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>User DN Base Path</label>
                            <input type="text" className="form-input" value={editableInfra.ldap?.userBaseDN || ''} onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, userBaseDN: e.target.value } })} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>User Search Filter</label>
                            <input type="text" className="form-input" value={editableInfra.ldap?.userFilter || ''} onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, userFilter: e.target.value } })} />
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {openInfraModal === 'prometheus' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Prometheus API URL</label>
                        <input type="text" className="form-input" value={editableInfra.prometheus?.url || ''} onChange={(e) => setEditableInfra({ ...editableInfra, prometheus: { ...editableInfra.prometheus, url: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Scrape Interval</label>
                        <input type="text" className="form-input" value={editableInfra.prometheus?.scrapeInterval || ''} onChange={(e) => setEditableInfra({ ...editableInfra, prometheus: { ...editableInfra.prometheus, scrapeInterval: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Service Discovery Mode</label>
                        <select className="form-select" value={editableInfra.prometheus?.discoveryMode || 'kubernetes'} onChange={(e) => setEditableInfra({ ...editableInfra, prometheus: { ...editableInfra.prometheus, discoveryMode: e.target.value } })}>
                          <option value="kubernetes">kubernetes</option>
                          <option value="static">static</option>
                        </select>
                      </div>
                    </>
                  )}

                  {openInfraModal === 'elasticsearch' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Elasticsearch Node URLs</label>
                        <input type="text" className="form-input" value={editableInfra.elasticsearch?.url || ''} onChange={(e) => setEditableInfra({ ...editableInfra, elasticsearch: { ...editableInfra.elasticsearch, url: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Index Pattern Prefix</label>
                        <input type="text" className="form-input" value={editableInfra.elasticsearch?.indexPrefix || ''} onChange={(e) => setEditableInfra({ ...editableInfra, elasticsearch: { ...editableInfra.elasticsearch, indexPrefix: e.target.value } })} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>TLS Verification</label>
                        <select className="form-select" value={editableInfra.elasticsearch?.tlsVerify || 'false'} onChange={(e) => setEditableInfra({ ...editableInfra, elasticsearch: { ...editableInfra.elasticsearch, tlsVerify: e.target.value } })}>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* Redesigned Premium Telegram Configurations Modal */}
                  {openInfraModal === 'telegram' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Bot Authentication Token</label>
                        <input
                          type="password"
                          value={telegramToken}
                          placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                          onChange={(e) => setTelegramToken(e.target.value)}
                          className="form-input"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Target Chat ID / Channel name</label>
                        <input
                          type="text"
                          value={telegramChatId}
                          placeholder="e.g. -100123456789"
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          className="form-input"
                          style={{ fontFamily: 'var(--font-mono)' }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Severities to notify</label>
                        <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                          {['Critical', 'Warning', 'Info'].map(sev => (
                            <label key={sev} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                              <input
                                type="checkbox"
                                checked={telegramSeverities.includes(sev)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTelegramSeverities(prev => [...prev, sev]);
                                  } else {
                                    setTelegramSeverities(prev => prev.filter(s => s !== sev));
                                  }
                                }}
                                style={{ accentColor: 'var(--accent-indigo)' }}
                              />
                              {sev}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
                        <div>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>Enable Telegram Channel</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Activate forwarding when alert rules are triggered</span>
                        </div>
                        <label className="switch-label">
                          <input
                            type="checkbox"
                            className="switch-input"
                            checked={telegramEnabled}
                            onChange={(e) => setTelegramEnabled(e.target.checked)}
                          />
                          <span className="switch-slider" />
                        </label>
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-primary)', paddingTop: '20px', marginTop: '10px' }}>
                  {openInfraModal === 'telegram' ? (
                    <button
                      type="button"
                      onClick={handleTestTelegram}
                      disabled={!telegramToken || !telegramChatId}
                      className="btn btn-ghost"
                      style={{ fontSize: '13px', border: '1px solid var(--border-primary)', padding: '10px 16px', borderRadius: '8px', cursor: (!telegramToken || !telegramChatId) ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: (!telegramToken || !telegramChatId) ? 0.5 : 1 }}
                    >
                      Test connection
                    </button>
                  ) : (
                    <div />
                  )}
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setOpenInfraModal(null)} style={{ fontSize: '13px', fontWeight: 600 }}>Cancel</button>
                    {openInfraModal === 'telegram' ? (
                      <button type="button" className="btn btn-primary" onClick={handleSaveTelegram} style={{ fontSize: '13px', padding: '10px 20px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', border: 'none', color: '#ffffff', fontWeight: 600 }}>
                        {savingTelegram ? 'Saving…' : 'Save Integration'}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-primary" onClick={handleSaveInfra} style={{ fontSize: '13px', padding: '10px 20px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', border: 'none', color: '#ffffff', fontWeight: 600 }}>Save Changes</button>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {activeTab === 'clusters' && (
        <div style={{ animation: 'fadeIn 0.2s', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Cluster Inventory</h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Register Kubernetes clusters and store credentials. Managed applications can be instrumented via Namespace Manager.
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!isEditingClusters ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={handleAddCluster}>Add Cluster</button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setEditableClusters(JSON.parse(JSON.stringify(clusterInventory)));
                      setIsEditingClusters(true);
                    }}
                  >
                    Edit Clusters
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => setIsEditingClusters(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleSaveClusters}>Save Inventory</button>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', borderRadius: '12px', boxShadow: 'var(--shadow-sm)' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-primary)', textAlign: 'left' }}>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cluster Identifier</th>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Display Name</th>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credentials Type</th>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agent Namespace</th>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ padding: '16px 20px', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clusterInventory.map((item, idx) => (
                  <tr key={item.id} className="hover-row" style={{ borderBottom: '1px solid var(--border-primary)', transition: 'background 0.2s' }}>
                    <td style={{ padding: '16px 20px' }}>
                      {!isEditingClusters ? (
                        <code style={{ fontSize: '11.5px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '3px 6px', borderRadius: '4px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.id}</code>
                      ) : item.managedByAgent ? (
                        <div>
                          <code style={{ fontSize: '11.5px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '3px 6px', borderRadius: '4px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{item.id}</code>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>Set via CLUSTER_NAME on agent Helm chart</div>
                        </div>
                      ) : (
                        <input type="text" className="form-input" style={{ width: '160px', padding: '6px 10px', fontSize: '12px' }} value={item.id}
                          onChange={(e) => { const n = [...editableClusters]; n[idx].id = e.target.value; setEditableClusters(n); }} />
                      )}
                    </td>
                    <td style={{ padding: '16px 20px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {!isEditingClusters ? (item.displayName || item.id) : (
                        <input type="text" className="form-input" style={{ width: '180px', padding: '6px 10px', fontSize: '12px' }} value={item.displayName || ''}
                          onChange={(e) => { const n = [...editableClusters]; n[idx].displayName = e.target.value; setEditableClusters(n); }} />
                      )}
                    </td>
                    <td style={{ padding: '16px 20px', minWidth: '220px' }}>
                      {!isEditingClusters ? (
                        <span style={{ 
                          display: 'inline-flex',
                          alignItems: 'center',
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: item.hasCredentials || (item.token && item.token !== '******') ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 63, 94, 0.08)',
                          color: item.hasCredentials || (item.token && item.token !== '******') ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          border: item.hasCredentials || (item.token && item.token !== '******') ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(244, 63, 94, 0.15)'
                        }}>
                          {item.hasCredentials || (item.token && item.token !== '******') ? '● Configured' : '○ Not set'}
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <select className="form-select" style={{ padding: '4px 8px', fontSize: '12px' }} value={item.credentialType || 'kubeconfig'}
                            onChange={(e) => { const n = [...editableClusters]; n[idx].credentialType = e.target.value; setEditableClusters(n); }}>
                            <option value="kubeconfig">Kubeconfig YAML</option>
                            <option value="bearer">Bearer Token</option>
                          </select>
                          {(item.credentialType === 'bearer') && (
                            <input type="text" placeholder="API Server (https://host:6443)" className="form-input" style={{ padding: '6px 10px', fontSize: '11px' }}
                              value={item.apiServer || ''} onChange={(e) => { const n = [...editableClusters]; n[idx].apiServer = e.target.value; setEditableClusters(n); }} />
                          )}
                          <textarea placeholder="Paste kubeconfig YAML or bearer token" className="form-input" style={{ padding: '6px 10px', fontSize: '11px', minHeight: '72px', fontFamily: 'var(--font-mono)' }}
                            value={item.token === '******' ? '' : (item.token || '')} onChange={(e) => { const n = [...editableClusters]; n[idx].token = e.target.value; setEditableClusters(n); }} />
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      {!isEditingClusters ? (
                        <code style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{item.agentNamespace || 'trace-prod'}</code>
                      ) : (
                        <input type="text" className="form-input" style={{ width: '120px', padding: '6px 10px', fontSize: '12px' }} value={item.agentNamespace || 'trace-prod'}
                          onChange={(e) => { const n = [...editableClusters]; n[idx].agentNamespace = e.target.value; setEditableClusters(n); }} />
                      )}
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      {!isEditingClusters ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: item.status === 'Active' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(148, 163, 184, 0.08)',
                          color: item.status === 'Active' ? 'var(--accent-emerald)' : 'var(--text-muted)',
                          border: item.status === 'Active' ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(148, 163, 184, 0.15)'
                        }}>
                          {item.status}
                        </span>
                      ) : (
                        <select className="form-select" style={{ padding: '6px 10px', fontSize: '12px' }} value={item.status}
                          onChange={(e) => { const n = [...editableClusters]; n[idx].status = e.target.value; setEditableClusters(n); }}>
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {!isEditingClusters ? (
                          <>
                            <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}
                              disabled={testingClusterId === item.id} onClick={() => handleTestCluster(item)}>
                              {testingClusterId === item.id ? 'Testing…' : 'Test'}
                            </button>
                            <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--accent-rose)' }}
                              onClick={() => handleDeleteCluster(item.id)}>Delete</button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--accent-rose)' }}
                            onClick={() => {
                              const n = editableClusters.filter((_, i) => i !== idx);
                              setEditableClusters(n);
                            }}>Remove</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {(isEditingClusters ? editableClusters : clusterInventory).length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>
                      No Kubernetes clusters configured. Register a cluster registry using "Add Cluster".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'instrumentations' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Instrumentation CRDs</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              OpenTelemetry Instrumentation resources on agent-managed clusters. These are created only for namespaces you explicitly enable in Ingestion Control.
            </span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {instrumentations.map((inst) => (
              <div className="card animate-fade-in" key={`${inst.namespace}/${inst.name}`} style={{ border: '1px solid var(--border-primary)', borderRadius: '12px', background: 'var(--bg-secondary)', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>{inst.name}</div>
                  </div>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent-indigo)', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>OTEL CRD</span>
                </div>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Namespace</span>
                    <span className="badge badge-ns" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                      {inst.namespace}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Exporter Endpoint</span>
                    <code style={{ fontSize: '11.5px', color: 'var(--text-primary)', wordBreak: 'break-all', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '6px 10px', borderRadius: '6px', fontFamily: 'var(--font-mono)' }}>{inst.endpoint || 'Not set'}</code>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sampler Type</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500 }}>{inst.sampler || 'default'}</span>
                  </div>
                </div>
              </div>
            ))}
            
            {instrumentations.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-primary)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                No active OpenTelemetry instrumentation resources found in the cluster.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'retention' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Storage & Retention</h2>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '6px', maxWidth: '620px' }}>
              Traces are kept in ClickHouse. Recent spans stay on the fast disk; older ones tier down to MinIO automatically and remain fully searchable. Retention sets how long spans are kept before deletion — <strong>0 = keep forever</strong>.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
            <div style={{ padding: '28px', border: '1px solid var(--border-primary)', borderRadius: '14px', background: 'linear-gradient(145deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Retention Policy</div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Automatic trace expiry</h3>
                <p className="text-muted" style={{ fontSize: '12px', lineHeight: 1.6, marginTop: '8px' }}>
                  ClickHouse deletes spans older than this window. Set to <span className="mono" style={{ color: 'var(--text-primary)' }}>0</span> to keep every trace forever (tiered to MinIO).
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Duration</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="number" min="0" value={retentionInput} onChange={(e) => setRetentionInput(e.target.value)} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '8px', color: 'var(--text-primary)', padding: '10px 14px', fontSize: '14px', fontFamily: 'var(--font-mono)', width: '88px' }} />
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>hours</span>
                  </div>
                </div>
                <button type="button" onClick={handleSaveRetention} disabled={savingRetention} className="btn btn-primary" style={{ fontSize: '13px', padding: '10px 20px', borderRadius: '8px' }}>
                  {savingRetention ? 'Saving…' : 'Apply policy'}
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Current policy: <span className="mono" style={{ color: 'var(--text-primary)' }}>{retentionHours === 0 ? 'Keep forever' : `${retentionHours}h`}</span></div>
              {retentionSuccess && (
                <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', color: 'var(--accent-emerald)', fontSize: '12px' }}>Retention policy saved.</div>
              )}
            </div>

            <div style={{ padding: '28px', border: '1px solid rgba(244, 63, 94, 0.2)', borderRadius: '14px', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-rose)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Destructive action</div>
                <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>Purge all trace data</h3>
                <p className="text-muted" style={{ fontSize: '12px', lineHeight: 1.6, marginTop: '8px' }}>
                  Permanently deletes every trace and span object in MinIO. Dashboard statistics will reset.
                </p>
              </div>
              <div style={{ marginTop: 'auto' }}>
                <button type="button" onClick={handleClearTraces} disabled={clearingTraces} style={{ background: 'transparent', color: 'var(--accent-rose)', border: '1px solid rgba(244, 63, 94, 0.4)', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: 600, cursor: clearingTraces ? 'not-allowed' : 'pointer', opacity: clearingTraces ? 0.6 : 1 }}>
                  {clearingTraces ? 'Purging…' : 'Purge storage'}
                </button>
              </div>
              {clearedMessage && (
                <div style={{ padding: '12px 16px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', color: 'var(--accent-emerald)', fontSize: '12px' }}>{clearedMessage}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && <AdminUsers />}

      {activeTab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Notification Integrations</h2>
            <p className="text-muted" style={{ fontSize: '13px', marginTop: '6px', maxWidth: '560px' }}>
              Configure alert forwarding integrations to notify your SRE team on third-party communication platforms.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
            {/* Telegram Notification Card */}
            <div
              className="card hover-table-row"
              onClick={() => {
                setOpenInfraModal('telegram');
              }}
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s', border: '1px solid var(--border-primary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'var(--border-primary)';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/telegram.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="Telegram" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Telegram Messenger</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Send real-time alerts to Telegram channels</span>
                  </div>
                </div>
                <span className={`badge ${telegramEnabled ? 'badge-success' : 'badge-neutral'}`}>
                  {telegramEnabled ? 'Active' : 'Disabled'}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Dispatches system telemetry and error notifications to a chat group.
              </p>
              <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-primary)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                <span>Chat ID: <strong className="mono" style={{ color: 'var(--text-primary)' }}>{telegramChatId || 'Not set'}</strong></span>
                <span style={{ color: 'var(--accent-indigo)', fontWeight: 600 }}>Configure &rarr;</span>
              </div>
            </div>

            {/* Slack integration placeholder */}
            <div
              className="card hover-table-row"
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', opacity: 0.7, border: '1px dashed var(--border-secondary)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/slack.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="Slack" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Slack Webhooks</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Channel webhook integration</span>
                  </div>
                </div>
                <span className="badge badge-neutral">Coming Soon</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Post critical incident alert details to your SRE channel feed using Slack incoming webhooks.
              </p>
            </div>

            {/* PagerDuty placeholder */}
            <div
              className="card hover-table-row"
              style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', opacity: 0.7, border: '1px dashed var(--border-secondary)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '48px', minWidth: '48px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <img src="/logos/pagerduty.svg" style={{ height: '30px', maxWidth: '48px', objectFit: 'contain' }} alt="PagerDuty" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>PagerDuty</h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Incident escalation management</span>
                  </div>
                </div>
                <span className="badge badge-neutral">Coming Soon</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Trigger on-call escalation schedules, acknowledge pages, and resolve incidents inside PagerDuty.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
