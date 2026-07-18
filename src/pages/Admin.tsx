import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import type { ClusterApplication, ClusterInventoryItem } from '../entities';
import AdminUsers from './AdminUsers';
import { useTranslation } from '../utils/i18n';

type AdminIconName =
  | 'alerts'
  | 'archive'
  | 'cluster'
  | 'database'
  | 'infrastructure'
  | 'namespace'
  | 'plug'
  | 'settings'
  | 'shield'
  | 'users';

const STACK_OPTIONS = [
  { value: 'unknown', label: 'Auto', logo: null },
  { value: 'go', label: 'Go', logo: '/logos/go.svg' },
  { value: 'nodejs', label: 'Node.js', logo: '/logos/node.svg' },
  { value: 'python', label: 'Python', logo: '/logos/python.svg' },
  { value: 'java', label: 'Java', logo: '/logos/java.svg' },
  { value: 'dotnet', label: '.NET', logo: '/logos/dotnet.svg' },
  { value: 'php', label: 'PHP', logo: '/logos/php.svg' },
] as const;

function AdminIcon({ name }: { name: AdminIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'alerts':
      return <svg {...common}><path d="M10.3 3.6 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>;
    case 'archive':
      return <svg {...common}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9" /><path d="M10 13h4" /></svg>;
    case 'cluster':
      return <svg {...common}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="m4.5 8 7.5 4.2L19.5 8" /><path d="M12 21v-8.8" /></svg>;
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v10c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 10c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>;
    case 'infrastructure':
      return <svg {...common}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /><path d="M8 7v10" /><path d="M16 7v10" /></svg>;
    case 'namespace':
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case 'plug':
      return <svg {...common}><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M6 8h12v4a6 6 0 0 1-12 0Z" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.06V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.06-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.06V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.06.4H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></svg>;
    case 'shield':
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>;
    case 'users':
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  }
}

function AdminSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <label className={`admin-switch ${disabled ? 'disabled' : ''}`}>
      {label && <span>{label}</span>}
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <i />
    </label>
  );
}

function AdminSegmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`admin-segmented ${disabled ? 'disabled' : ''}`}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StackPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const current = value || 'unknown';

  return (
    <div className={`admin-stack-picker ${disabled ? 'disabled' : ''}`} onClick={(event) => event.stopPropagation()}>
      {STACK_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={current === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          title={option.label}
        >
          {option.logo ? <img src={option.logo} alt="" /> : <AdminIcon name="settings" />}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

type InfraChipState = 'ready' | 'missing' | 'neutral';
type InfraCardConfig = {
  key: string;
  title: string;
  subtitle: string;
  logo: string;
  status: string;
  statusState: InfraChipState;
  chips: readonly { label: string; state: InfraChipState }[];
  wideLogo?: boolean;
  logoTheme?: 'dark';
};

function InfraResourceCard({
  title,
  subtitle,
  logo,
  status,
  statusState,
  chips,
  onClick,
  wideLogo,
  logoTheme,
}: {
  title: string;
  subtitle: string;
  logo: string;
  status: string;
  statusState: InfraChipState;
  chips: readonly { label: string; state: InfraChipState }[];
  onClick: () => void;
  wideLogo?: boolean;
  logoTheme?: 'dark';
}) {
  return (
    <button type="button" className="admin-infra-card" onClick={onClick}>
      <span className={`admin-infra-status ${statusState}`}>{status}</span>
      <span className={`admin-infra-logo ${wideLogo ? 'wide' : ''} ${logoTheme || ''}`}>
        <img src={logo} alt="" />
      </span>
      <span className="admin-infra-copy">
        <strong>{title}</strong>
        <em>{subtitle}</em>
      </span>
      <span className="admin-infra-chip-grid">
        {chips.map(chip => (
          <span key={chip.label} className={`admin-infra-chip ${chip.state}`}>
            <i />
            {chip.label}
          </span>
        ))}
      </span>
      <span className="admin-infra-action">Configure</span>
    </button>
  );
}

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
  const [clusterTestResult, setClusterTestResult] = useState<{
    kind: 'success' | 'error';
    title: string;
    message: string;
    details?: string;
  } | null>(null);

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
        setClusterTestResult({
          kind: 'success',
          title: 'Cluster connection healthy',
          message: `${cluster.displayName || cluster.id} is reachable.`,
          details: `Kubernetes API server: ${res.serverVersion || 'unknown'}`,
        });
      } else {
        setClusterTestResult({
          kind: 'error',
          title: 'Cluster connection failed',
          message: `${cluster.displayName || cluster.id} could not be reached.`,
          details: res.error || res.message || 'Unknown error',
        });
      }
    } catch (err: any) {
      setClusterTestResult({
        kind: 'error',
        title: 'Cluster test failed',
        message: `${cluster.displayName || cluster.id} could not be tested.`,
        details: err.message || 'Unknown error',
      });
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

  const handleToggleTelegramEnabled = (nextEnabled: boolean) => {
    setTelegramEnabled(nextEnabled);
    localStorage.setItem('telegram_enabled', nextEnabled ? 'true' : 'false');
    setActionSuccessMessage(`Telegram integration ${nextEnabled ? 'enabled' : 'disabled'}.`);
    setTimeout(() => setActionSuccessMessage(null), 3000);
  };

  const handleTestTelegram = () => {
    alert(`Telegram connection test message dispatched!\nBot Token: ${telegramToken.slice(0, 6)}... \nChat ID: ${telegramChatId}`);
  };

  const adminTabs: {
    key: typeof activeTab;
    label: string;
    icon: AdminIconName;
    count?: number | string;
  }[] = [
    { key: 'namespaces', label: t('Namespace Manager'), icon: 'namespace', count: nsData.enabled.length + nsData.disabled.length },
    { key: 'infrastructure', label: t('Infrastructure'), icon: 'infrastructure' },
    { key: 'clusters', label: t('Clusters'), icon: 'cluster', count: clusterInventory.length },
    { key: 'instrumentations', label: t('Auto-Instrumentation'), icon: 'settings', count: instrumentations.length },
    { key: 'retention', label: t('Storage'), icon: 'archive', count: retentionHours === 0 ? t('Forever') : `${retentionHours}h` },
    { key: 'users', label: t('Users'), icon: 'users' },
    { key: 'integrations', label: t('Integrations'), icon: 'plug', count: telegramEnabled ? t('On') : t('Off') },
  ];

  const configuredInfraCount = [
    infraConfig?.kafka?.brokers,
    infraConfig?.clickhouse?.host,
    infraConfig?.minio?.endpoint,
    infraConfig?.ldap?.enabled === 'true',
    infraConfig?.prometheus?.url,
    infraConfig?.elasticsearch?.url,
  ].filter(Boolean).length;
  const retentionPolicyLabel = retentionHours === 0
    ? t('Forever')
    : retentionHours < 24
      ? `${retentionHours}h`
      : `${Math.round(retentionHours / 24)}d`;
  const openInfraConfig = (key: string) => {
    setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
    setOpenInfraModal(key);
  };
  const infraCards: InfraCardConfig[] = infraConfig ? [
    {
      key: 'kafka',
      title: 'Apache Kafka',
      subtitle: t('Ingestion queue'),
      logo: '/logos/kafka.svg',
      status: infraConfig.kafka?.brokers && infraConfig.kafka?.topic ? t('Configured') : t('Missing setup'),
      statusState: infraConfig.kafka?.brokers && infraConfig.kafka?.topic ? 'ready' : 'missing',
      chips: [
        { label: t('Brokers'), state: infraConfig.kafka?.brokers ? 'ready' : 'missing' },
        { label: t('Topic'), state: infraConfig.kafka?.topic ? 'ready' : 'missing' },
        { label: t('Consumer group'), state: infraConfig.kafka?.group ? 'ready' : 'missing' },
      ],
    },
    {
      key: 'clickhouse',
      title: 'ClickHouse',
      subtitle: t('Trace analytics database'),
      logo: '/logos/clickhouse.svg',
      status: infraConfig.clickhouse?.host ? t('Configured') : t('Missing setup'),
      statusState: infraConfig.clickhouse?.host ? 'ready' : 'missing',
      wideLogo: true,
      chips: [
        { label: t('Host'), state: infraConfig.clickhouse?.host ? 'ready' : 'missing' },
        { label: t('Database'), state: infraConfig.clickhouse?.database ? 'ready' : 'missing' },
        { label: t('Credentials'), state: infraConfig.clickhouse?.username ? 'ready' : 'missing' },
      ],
    },
    {
      key: 'minio',
      title: 'MinIO',
      subtitle: t('Trace object storage'),
      logo: '/logos/minio.png',
      logoTheme: 'dark',
      status: infraConfig.minio?.endpoint && infraConfig.minio?.bucket ? t('Configured') : t('Missing setup'),
      statusState: infraConfig.minio?.endpoint && infraConfig.minio?.bucket ? 'ready' : 'missing',
      wideLogo: true,
      chips: [
        { label: t('Endpoint'), state: infraConfig.minio?.endpoint ? 'ready' : 'missing' },
        { label: t('Bucket'), state: infraConfig.minio?.bucket ? 'ready' : 'missing' },
        { label: infraConfig.minio?.useSSL === 'true' ? t('SSL on') : t('SSL off'), state: 'neutral' },
      ],
    },
    {
      key: 'ldap',
      title: 'Active Directory',
      subtitle: t('LDAP identity provider'),
      logo: '/logos/active-directory.svg',
      status: infraConfig.ldap?.enabled === 'true' ? t('Enabled') : t('Disabled'),
      statusState: infraConfig.ldap?.enabled === 'true' ? 'ready' : 'neutral',
      chips: [
        { label: t('Auth'), state: infraConfig.ldap?.enabled === 'true' ? 'ready' : 'neutral' },
        { label: t('Server'), state: infraConfig.ldap?.url ? 'ready' : 'missing' },
        { label: t('Bind user'), state: infraConfig.ldap?.bindDN ? 'ready' : 'missing' },
      ],
    },
    {
      key: 'prometheus',
      title: 'Prometheus',
      subtitle: t('Metrics source'),
      logo: '/logos/prometheus.svg',
      status: infraConfig.prometheus?.url ? t('Configured') : t('Missing setup'),
      statusState: infraConfig.prometheus?.url ? 'ready' : 'missing',
      chips: [
        { label: t('API URL'), state: infraConfig.prometheus?.url ? 'ready' : 'missing' },
        { label: t('Discovery'), state: infraConfig.prometheus?.discoveryMode ? 'ready' : 'neutral' },
        { label: t('Scrape'), state: infraConfig.prometheus?.scrapeInterval ? 'ready' : 'neutral' },
      ],
    },
    {
      key: 'elasticsearch',
      title: 'Elasticsearch',
      subtitle: t('Metadata search'),
      logo: '/logos/elasticsearch.svg',
      status: infraConfig.elasticsearch?.url ? t('Configured') : t('Missing setup'),
      statusState: infraConfig.elasticsearch?.url ? 'ready' : 'missing',
      wideLogo: true,
      chips: [
        { label: t('Nodes'), state: infraConfig.elasticsearch?.url ? 'ready' : 'missing' },
        { label: t('Index prefix'), state: infraConfig.elasticsearch?.indexPrefix ? 'ready' : 'missing' },
        { label: infraConfig.elasticsearch?.tlsVerify === 'true' ? t('TLS verify') : t('TLS off'), state: 'neutral' },
      ],
    },
  ] : [];

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
    <div className="admin-page animate-fade-in">
      <section className="admin-hero">
        <div>
          <span className="admin-eyebrow">
            <AdminIcon name="shield" />
            {t('Control plane')}
          </span>
          <h1>{t('Admin')}</h1>
        </div>
        <button type="button" className="admin-refresh-btn" onClick={fetchData} disabled={loading}>
          <AdminIcon name="settings" />
          {loading ? t('Refreshing') : t('Refresh')}
        </button>
      </section>

      <section className="admin-summary-grid">
        <div className="admin-summary-card emerald">
          <span>{t('Active Namespaces')}</span>
          <strong>{nsData.enabled.length}</strong>
          <em>{nsData.disabled.length} {t('disabled')}</em>
        </div>
        <div className="admin-summary-card indigo">
          <span>{t('Clusters')}</span>
          <strong>{clusterInventory.length}</strong>
          <em>{clusterInventory.filter(c => c.status === 'Active').length} {t('active')}</em>
        </div>
        <div className="admin-summary-card cyan">
          <span>{t('Infrastructure')}</span>
          <strong>{configuredInfraCount}</strong>
          <em>{t('configured')}</em>
        </div>
        <div className={`admin-summary-card ${telegramEnabled ? 'emerald' : 'neutral'}`}>
          <span>{t('Notifications')}</span>
          <strong>{telegramEnabled ? t('On') : t('Off')}</strong>
          <em>{t('Telegram')}</em>
        </div>
      </section>

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

      {clusterTestResult && createPortal(
        <div className="admin-modal-backdrop">
          <div className={`admin-test-dialog ${clusterTestResult.kind}`}>
            <div className="admin-test-dialog-icon">
              {clusterTestResult.kind === 'success' ? <AdminIcon name="shield" /> : <AdminIcon name="alerts" />}
            </div>
            <div className="admin-test-dialog-body">
              <span>{clusterTestResult.kind === 'success' ? t('Connection test') : t('Test failed')}</span>
              <h3>{clusterTestResult.title}</h3>
              <p>{clusterTestResult.message}</p>
              {clusterTestResult.details && <code>{clusterTestResult.details}</code>}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setClusterTestResult(null)}>
              {t('Close')}
            </button>
          </div>
        </div>,
        document.body
      )}

      <div className="admin-tab-rail">
        {adminTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key as any);
              setIsEditingClusters(false);
            }}
            className={activeTab === tab.key ? 'active' : ''}
          >
            <AdminIcon name={tab.icon} />
            <span>{tab.label}</span>
            {tab.count !== undefined && <em>{tab.count}</em>}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      {activeTab === 'namespaces' && (
        <div>
          <div className="admin-section-heading">
            <div>
              <span>{t('Ingestion Control')}</span>
              <h2>{t('Namespace Manager')}</h2>
            </div>
          </div>

          <div className="admin-namespace-grid">
            {(nsData.enabled || []).map((ns) => (
              <div
                className="admin-namespace-card active animate-fade-in"
                key={ns}
              >
                {togglingNs === ns && (
                  <div className="admin-card-busy">
                    <div />
                  </div>
                )}
                <div className="admin-namespace-body">
                  <div className="admin-namespace-title">
                    <strong>{ns}</strong>
                    <span className="admin-status-pill active">{t('Active')}</span>
                  </div>
                  <div className="admin-namespace-meta">
                    <span>{t('Collector')}</span>
                    <code>collector.{ns}.svc</code>
                  </div>
                </div>

                <div className="admin-namespace-actions">
                  <button
                    type="button"
                    className="admin-link-btn"
                    onClick={() => handleManageApplications(ns)}
                  >
                    {t('Workloads')}
                  </button>
                  <AdminSwitch
                    checked
                    disabled={togglingNs === ns}
                    onChange={() => handleToggleNamespace(ns, true)}
                  />
                </div>
              </div>
            ))}

            {(nsData.disabled || []).map((ns) => (
              <div
                className="admin-namespace-card inactive animate-fade-in"
                key={ns}
              >
                {togglingNs === ns && (
                  <div className="admin-card-busy">
                    <div />
                  </div>
                )}
                <div className="admin-namespace-body">
                  <div className="admin-namespace-title">
                    <strong>{ns}</strong>
                    <span className="admin-status-pill inactive">{t('Inactive')}</span>
                  </div>
                  <div className="admin-namespace-meta">
                    <span>{t('Instrumentation')}</span>
                    <code>{ns}-instrumentation</code>
                  </div>
                </div>

                <div className="admin-namespace-actions">
                  <button
                    type="button"
                    className="admin-link-btn"
                    onClick={() => handleManageApplications(ns)}
                  >
                    {t('Workloads')}
                  </button>
                  <AdminSwitch
                    checked={false}
                    disabled={togglingNs === ns}
                    onChange={() => handleToggleNamespace(ns, false)}
                  />
                </div>
              </div>
            ))}

            {nsData.enabled.length === 0 && nsData.disabled.length === 0 && (
              <div className="admin-empty-card">
                {t('No tracking namespaces registered.')}
              </div>
            )}
          </div>

          {/* Workload/Service manager modal */}
          {openAppsModal && createPortal(
            <div className="admin-modal-backdrop">
              <div className="admin-modal-panel admin-workload-modal">
                <div className="admin-modal-header">
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
                            <div className="admin-stack-field">
                              <span>Stack</span>
                              <StackPicker
                                value={app.language || 'unknown'}
                                disabled={togglingApp === app.name}
                                onChange={(nextStack) => handleLanguageChange(app, nextStack)}
                              />
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
                          <AdminSwitch
                            checked={app.instrumented}
                            disabled={togglingApp === app.name}
                            onChange={() => handleToggleApp(app)}
                          />
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
          <div className="admin-section-heading">
            <div>
              <span>{t('Platform services')}</span>
              <h2>{t('Infrastructure')}</h2>
            </div>
          </div>

          <div className="admin-infra-grid">
            {infraCards.map(resource => (
              <InfraResourceCard
                key={resource.key}
                title={resource.title}
                subtitle={resource.subtitle}
                logo={resource.logo}
                status={resource.status}
                statusState={resource.statusState}
                chips={resource.chips}
                wideLogo={resource.wideLogo}
                logoTheme={resource.logoTheme}
                onClick={() => openInfraConfig(resource.key)}
              />
            ))}
          </div>

          {openInfraModal && editableInfra && createPortal(
            <div className="admin-modal-backdrop">
              <div className="admin-modal-panel admin-infra-modal">
                <div className="admin-modal-header">
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
                      <div className="admin-setting-row">
                        <div>
                          <strong>SSL connection</strong>
                          <span>Use HTTPS for the object storage endpoint.</span>
                        </div>
                        <AdminSwitch
                          checked={editableInfra.minio?.useSSL === 'true'}
                          onChange={() => setEditableInfra({
                            ...editableInfra,
                            minio: {
                              ...editableInfra.minio,
                              useSSL: editableInfra.minio?.useSSL === 'true' ? 'false' : 'true',
                            }
                          })}
                        />
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
                      <div className="admin-setting-row">
                        <div>
                          <strong>{t('LDAP authentication')}</strong>
                          <span>{t('Use directory login and group-based access.')}</span>
                        </div>
                        <AdminSwitch
                          checked={editableInfra.ldap?.enabled === 'true'}
                          onChange={() => setEditableInfra({
                            ...editableInfra,
                            ldap: {
                              ...editableInfra.ldap,
                              enabled: editableInfra.ldap?.enabled === 'true' ? 'false' : 'true',
                            }
                          })}
                        />
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
                        <AdminSegmented
                          value={editableInfra.prometheus?.discoveryMode || 'kubernetes'}
                          options={[
                            { value: 'kubernetes', label: 'Kubernetes' },
                            { value: 'static', label: 'Static' },
                          ]}
                          onChange={(value) => setEditableInfra({ ...editableInfra, prometheus: { ...editableInfra.prometheus, discoveryMode: value } })}
                        />
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
                      <div className="admin-setting-row">
                        <div>
                          <strong>TLS verification</strong>
                          <span>Verify certificates when connecting to Elasticsearch.</span>
                        </div>
                        <AdminSwitch
                          checked={editableInfra.elasticsearch?.tlsVerify === 'true'}
                          onChange={() => setEditableInfra({
                            ...editableInfra,
                            elasticsearch: {
                              ...editableInfra.elasticsearch,
                              tlsVerify: editableInfra.elasticsearch?.tlsVerify === 'true' ? 'false' : 'true',
                            }
                          })}
                        />
                      </div>
                    </>
                  )}

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
                        <AdminSwitch
                          checked={telegramEnabled}
                          onChange={() => setTelegramEnabled(!telegramEnabled)}
                        />
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
          <div className="admin-section-heading action">
            <div>
              <span>{t('Kubernetes')}</span>
              <h2>{t('Cluster Inventory')}</h2>
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

          <div className="admin-cluster-grid">
            {(isEditingClusters ? editableClusters : clusterInventory).map((item, idx) => {
              const credentialsReady = Boolean(item.hasCredentials || (item.token && item.token !== '******'));
              return (
                <div
                  key={`${item.id || 'cluster'}-${idx}`}
                  className={`admin-cluster-card ${item.status === 'Active' ? 'active' : 'inactive'} ${isEditingClusters ? 'editing' : ''}`}
                >
                  <div className="admin-cluster-card-top">
                    <div className="admin-cluster-identity">
                      <span className="admin-cluster-icon"><AdminIcon name="cluster" /></span>
                      <div>
                        <strong>{item.displayName || item.id || t('New cluster')}</strong>
                        <code>{item.id || t('cluster-id')}</code>
                      </div>
                    </div>
                    {!isEditingClusters ? (
                      <span className={`admin-status-pill ${item.status === 'Active' ? 'active' : 'inactive'}`}>
                        {item.status}
                      </span>
                    ) : (
                      <AdminSwitch
                        checked={item.status === 'Active'}
                        label={item.status === 'Active' ? t('Active') : t('Inactive')}
                        onChange={() => {
                          const next = [...editableClusters];
                          next[idx].status = next[idx].status === 'Active' ? 'Inactive' : 'Active';
                          setEditableClusters(next);
                        }}
                      />
                    )}
                  </div>

                  {!isEditingClusters ? (
                    <>
                      <div className="admin-cluster-meta-grid">
                        <div>
                          <span>{t('Credentials')}</span>
                          <strong className={credentialsReady ? 'ready' : 'missing'}>
                            {credentialsReady ? t('Configured') : t('Not set')}
                          </strong>
                        </div>
                        <div>
                          <span>{t('Type')}</span>
                          <strong>{item.credentialType || 'kubeconfig'}</strong>
                        </div>
                        <div>
                          <span>{t('Agent namespace')}</span>
                          <strong>{item.agentNamespace || 'trace-prod'}</strong>
                        </div>
                      </div>
                      <div className="admin-cluster-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={testingClusterId === item.id}
                          onClick={() => handleTestCluster(item)}
                        >
                          {testingClusterId === item.id ? t('Testing…') : t('Test')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm danger"
                          onClick={() => handleDeleteCluster(item.id)}
                        >
                          {t('Delete')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="admin-cluster-edit-grid">
                        <label>
                          <span>{t('Cluster ID')}</span>
                          {item.managedByAgent ? (
                            <div className="admin-cluster-managed">
                              <code>{item.id}</code>
                              <em>{t('Set by agent')}</em>
                            </div>
                          ) : (
                            <input
                              type="text"
                              className="form-input"
                              value={item.id}
                              onChange={(event) => {
                                const next = [...editableClusters];
                                next[idx].id = event.target.value;
                                setEditableClusters(next);
                              }}
                            />
                          )}
                        </label>
                        <label>
                          <span>{t('Display name')}</span>
                          <input
                            type="text"
                            className="form-input"
                            value={item.displayName || ''}
                            onChange={(event) => {
                              const next = [...editableClusters];
                              next[idx].displayName = event.target.value;
                              setEditableClusters(next);
                            }}
                          />
                        </label>
                        <label>
                          <span>{t('Agent namespace')}</span>
                          <input
                            type="text"
                            className="form-input"
                            value={item.agentNamespace || 'trace-prod'}
                            onChange={(event) => {
                              const next = [...editableClusters];
                              next[idx].agentNamespace = event.target.value;
                              setEditableClusters(next);
                            }}
                          />
                        </label>
                      </div>

                      <div className="admin-cluster-credential-panel">
                        <span>{t('Credentials')}</span>
                        <AdminSegmented
                          value={item.credentialType || 'kubeconfig'}
                          options={[
                            { value: 'kubeconfig', label: 'Kubeconfig' },
                            { value: 'bearer', label: 'Bearer token' },
                          ]}
                          onChange={(value) => {
                            const next = [...editableClusters];
                            next[idx].credentialType = value;
                            setEditableClusters(next);
                          }}
                        />
                        {item.credentialType === 'bearer' && (
                          <input
                            type="text"
                            placeholder="https://host:6443"
                            className="form-input"
                            value={item.apiServer || ''}
                            onChange={(event) => {
                              const next = [...editableClusters];
                              next[idx].apiServer = event.target.value;
                              setEditableClusters(next);
                            }}
                          />
                        )}
                        <textarea
                          placeholder={item.credentialType === 'bearer' ? t('Bearer token') : t('Kubeconfig YAML')}
                          className="form-input"
                          value={item.token === '******' ? '' : (item.token || '')}
                          onChange={(event) => {
                            const next = [...editableClusters];
                            next[idx].token = event.target.value;
                            setEditableClusters(next);
                          }}
                        />
                      </div>

                      <div className="admin-cluster-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm danger"
                          onClick={() => {
                            const next = editableClusters.filter((_, clusterIndex) => clusterIndex !== idx);
                            setEditableClusters(next);
                          }}
                        >
                          {t('Remove')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {(isEditingClusters ? editableClusters : clusterInventory).length === 0 && (
              <div className="admin-empty-card">
                {t('No Kubernetes clusters configured.')}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'instrumentations' && (
        <div>
          <div className="admin-section-heading">
            <div>
              <span>{t('OpenTelemetry')}</span>
              <h2>{t('Auto-Instrumentation Rules')}</h2>
            </div>
          </div>
          
          <div className="admin-instrumentation-grid">
            {instrumentations.map((inst) => (
              <div className="admin-instrumentation-card animate-fade-in" key={`${inst.namespace}/${inst.name}`}>
                <div className="admin-instrumentation-top">
                  <div className="admin-instrumentation-icon">
                    <img src="/logos/opentelemetry.svg" alt="" />
                  </div>
                  <div className="admin-instrumentation-title">
                    <strong>{inst.name}</strong>
                    <span>{inst.namespace}</span>
                  </div>
                  <span className="admin-status-pill active">Active</span>
                </div>

                <div className="admin-instrumentation-flow">
                  <span>App</span>
                  <i />
                  <span>OTel SDK</span>
                  <i />
                  <span>OTLP endpoint</span>
                </div>

                <div className="admin-instrumentation-meta-grid">
                  <div>
                    <span>OTLP endpoint</span>
                    <code>{inst.endpoint || 'Not set'}</code>
                  </div>
                  <div>
                    <span>Sampling</span>
                    <code>{inst.sampler || 'default'}</code>
                  </div>
                  <div>
                    <span>Kubernetes resource</span>
                    <code>Instrumentation CRD</code>
                  </div>
                </div>
              </div>
            ))}
            
            {instrumentations.length === 0 && (
              <div className="admin-empty-card">
                No active OpenTelemetry instrumentation resources found in the cluster.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'retention' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="admin-section-heading">
            <div>
              <span>{t('Storage')}</span>
              <h2>{t('Storage & Retention')}</h2>
            </div>
          </div>

          <div className="admin-storage-grid">
            <div className="admin-storage-card primary">
              <div className="admin-storage-head">
                <div>
                  <span>{t('Current policy')}</span>
                  <strong>{retentionPolicyLabel}</strong>
                </div>
                <img src="/logos/clickhouse.svg" alt="" />
              </div>

              <div className="admin-retention-ring">
                <strong>{retentionHours === 0 ? '∞' : retentionHours}</strong>
                <span>{retentionHours === 0 ? t('hours limit off') : t('hours')}</span>
              </div>

              <div className="admin-retention-controls">
                <label>{t('Retention window')}</label>
                <div>
                  <input type="number" min="0" value={retentionInput} onChange={(e) => setRetentionInput(e.target.value)} />
                  <span>{t('hours')}</span>
                </div>
              </div>

              <div className="admin-retention-presets">
                {[
                  { label: '24h', value: '24' },
                  { label: '7d', value: '168' },
                  { label: '30d', value: '720' },
                  { label: t('Forever'), value: '0' },
                ].map(option => (
                  <button key={option.value} type="button" className={retentionInput === option.value ? 'active' : ''} onClick={() => setRetentionInput(option.value)}>
                    {option.label}
                  </button>
                ))}
              </div>

              <button type="button" onClick={handleSaveRetention} disabled={savingRetention} className="btn btn-primary">
                {savingRetention ? t('Saving…') : t('Apply policy')}
              </button>

              {retentionSuccess && (
                <div className="admin-inline-success">{t('Retention policy saved.')}</div>
              )}
            </div>

            <div className="admin-storage-card">
              <div className="admin-storage-head">
                <div>
                  <span>{t('Trace payloads')}</span>
                  <strong>MinIO</strong>
                </div>
                <img src="/logos/minio.png" alt="" />
              </div>
              <div className="admin-storage-status-list">
                <span className={infraConfig?.minio?.endpoint ? 'ready' : 'missing'}>
                  <i />{infraConfig?.minio?.endpoint ? t('Endpoint configured') : t('Endpoint missing')}
                </span>
                <span className={infraConfig?.minio?.bucket ? 'ready' : 'missing'}>
                  <i />{infraConfig?.minio?.bucket ? t('Bucket configured') : t('Bucket missing')}
                </span>
                <span className="neutral">
                  <i />{infraConfig?.minio?.useSSL === 'true' ? t('SSL enabled') : t('SSL disabled')}
                </span>
              </div>
              <button
                type="button"
                className="admin-storage-config-btn"
                onClick={() => {
                  setActiveTab('infrastructure');
                  openInfraConfig('minio');
                }}
              >
                {t('Configure storage')}
              </button>
            </div>

            <div className="admin-storage-card danger">
              <div className="admin-storage-head">
                <div>
                  <span>{t('Danger zone')}</span>
                  <strong>{t('Purge traces')}</strong>
                </div>
                <AdminIcon name="alerts" />
              </div>
              <button type="button" onClick={handleClearTraces} disabled={clearingTraces}>
                {clearingTraces ? t('Purging…') : t('Purge storage')}
              </button>
              {clearedMessage && (
                <div className="admin-inline-success">{clearedMessage}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'users' && <AdminUsers />}

      {activeTab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s' }}>
          <div className="admin-section-heading">
            <div>
              <span>{t('Alerts')}</span>
              <h2>{t('Notification Integrations')}</h2>
            </div>
          </div>

          <div className="admin-integration-grid">
            <div
              role="button"
              tabIndex={0}
              className={`admin-integration-card clickable ${telegramEnabled ? 'active' : ''}`}
              onClick={() => {
                setOpenInfraModal('telegram');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setOpenInfraModal('telegram');
                }
              }}
            >
              <span className={`admin-infra-status ${telegramEnabled ? 'ready' : 'neutral'}`}>
                {telegramEnabled ? t('Active') : t('Disabled')}
              </span>
              <span className="admin-integration-logo">
                <img src="/logos/telegram.svg" alt="" />
              </span>
              <span className="admin-infra-copy">
                <strong>Telegram</strong>
                <em>{t('Alert channel')}</em>
              </span>
              <span className="admin-infra-chip-grid">
                <span className={`admin-infra-chip ${telegramToken ? 'ready' : 'missing'}`}><i />{t('Token')}</span>
                <span className={`admin-infra-chip ${telegramChatId ? 'ready' : 'missing'}`}><i />{t('Chat')}</span>
                <span className="admin-infra-chip neutral"><i />{telegramSeverities.length} {t('levels')}</span>
              </span>
              <span className="admin-integration-footer" onClick={(event) => event.stopPropagation()}>
                <span>{telegramChatId || t('No chat selected')}</span>
                <span>
                  <button type="button" className="admin-link-btn" onClick={() => setOpenInfraModal('telegram')}>
                    {t('Configure')}
                  </button>
                  <AdminSwitch
                    checked={telegramEnabled}
                    onChange={() => handleToggleTelegramEnabled(!telegramEnabled)}
                  />
                </span>
              </span>
            </div>

            <div
              className="admin-integration-card muted"
            >
              <span className="admin-infra-status neutral">{t('Soon')}</span>
              <span className="admin-integration-logo">
                <img src="/logos/slack.svg" alt="" />
              </span>
              <span className="admin-infra-copy">
                <strong>Slack</strong>
                <em>{t('Webhook channel')}</em>
              </span>
              <span className="admin-infra-chip-grid">
                <span className="admin-infra-chip missing"><i />{t('Webhook')}</span>
                <span className="admin-infra-chip neutral"><i />{t('Channel')}</span>
                <span className="admin-infra-chip neutral"><i />{t('Rules')}</span>
              </span>
              <span className="admin-integration-action">{t('Coming soon')}</span>
            </div>

            <div
              className="admin-integration-card muted"
            >
              <span className="admin-infra-status neutral">{t('Soon')}</span>
              <span className="admin-integration-logo">
                <img src="/logos/pagerduty.svg" alt="" />
              </span>
              <span className="admin-infra-copy">
                <strong>PagerDuty</strong>
                <em>{t('Incident routing')}</em>
              </span>
              <span className="admin-infra-chip-grid">
                <span className="admin-infra-chip missing"><i />{t('Key')}</span>
                <span className="admin-infra-chip neutral"><i />{t('Service')}</span>
                <span className="admin-infra-chip neutral"><i />{t('Policy')}</span>
              </span>
              <span className="admin-integration-action">{t('Coming soon')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
