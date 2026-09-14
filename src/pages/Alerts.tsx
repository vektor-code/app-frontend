import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ServiceStats } from '../entities';
import { LoadingState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import { useTranslation } from '../utils/i18n';
import { StandardColumnHeader, StandardTableToolbar, type StandardSortDirection } from '../components/StandardTable';
import { useColumnResize } from '../utils/useColumnResize';

// Interfaces
interface AlertRule {
  id: string;
  name: string;
  namespace: string; // scope of the rule; '' = legacy rule (any namespace)
  service: string;
  metric: 'Error Rate' | 'p95 Latency' | 'p99 Latency' | 'CPU Usage';
  condition: string; // e.g. "> 2.0%" or "> 1000ms"
  window: string;
  severity: 'Critical' | 'Warning' | 'Info';
  active: boolean;
  channels: string[];
}

interface ActiveAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  service: string;
  namespace: string;
  condition: string;
  value: string;
  severity: 'Critical' | 'Warning' | 'Info';
  status: 'Firing' | 'Acknowledged' | 'Silenced';
  duration: string;
  timestamp: string;
}

interface NotificationChannel {
  id: string;
  name: string;
  type: 'Slack' | 'Email' | 'PagerDuty' | 'Webhook';
  target: string;
  status: 'Connected' | 'Error';
}

interface SilenceRule {
  id: string;
  service: string;
  reason: string;
  duration: string;
  startTime: string;
  endTime: string;
}

interface AlertsProps {
  namespace: string;
}

type SilenceColumn = 'service' | 'reason' | 'startTime' | 'endTime' | 'status' | 'actions';
type SilenceSortField = 'service' | 'reason' | 'startTime' | 'endTime' | 'duration';

const silenceColumnWidths: Record<SilenceColumn, number> = {
  service: 220,
  reason: 300,
  startTime: 180,
  endTime: 180,
  status: 170,
  actions: 150,
};

const silenceColumnMinimums: Record<SilenceColumn, number> = {
  service: 170,
  reason: 220,
  startTime: 150,
  endTime: 150,
  status: 140,
  actions: 120,
};

const silenceColumnOrder: SilenceColumn[] = ['service', 'reason', 'startTime', 'endTime', 'status', 'actions'];

function parseCondition(condition: string): { operator: string; threshold: number } {
  const match = condition.match(/([><=]+)\s*([0-9.]+)/);
  if (!match) return { operator: '>', threshold: 0 };
  return { operator: match[1], threshold: Number(match[2]) };
}

function formatCondition(metric: AlertRule['metric'], operator: string, threshold: number): string {
  if (metric === 'Error Rate') return `${operator} ${threshold}%`;
  return `${operator} ${threshold}ms`;
}

function fromServerRule(raw: any): AlertRule {
  const metric = (raw.metric || 'Error Rate') as AlertRule['metric'];
  const operator = raw.operator || '>';
  const threshold = typeof raw.threshold === 'number' ? raw.threshold : 0;
  return {
    id: raw.id,
    name: raw.name,
    namespace: raw.namespace || '',
    service: !raw.service || raw.service === 'all' ? 'all-services' : raw.service,
    metric,
    condition: formatCondition(metric, operator, threshold),
    window: raw.window || '5m',
    severity: (raw.severity || 'Warning') as AlertRule['severity'],
    active: Boolean(raw.active),
    channels: Array.isArray(raw.channels) ? raw.channels : [],
  };
}

function toServerRule(rule: AlertRule) {
  const { operator, threshold } = parseCondition(rule.condition);
  const payload: Record<string, unknown> = {
    name: rule.name,
    namespace: rule.namespace,
    service: rule.service === 'all-services' ? 'all' : rule.service,
    metric: rule.metric,
    operator,
    threshold,
    window: rule.window,
    severity: rule.severity,
    active: rule.active,
    channels: rule.channels || [],
  };
  if (rule.id) payload.id = rule.id;
  return payload;
}

function fromServerChannel(raw: any): NotificationChannel {
  return {
    id: raw.id,
    name: raw.name,
    type: (raw.type || 'Webhook') as NotificationChannel['type'],
    target: raw.target,
    status: 'Connected',
  };
}

function fromServerActive(raw: any): ActiveAlert {
  const firedAt = raw.firedAt ? new Date(raw.firedAt) : new Date();
  const value =
    typeof raw.value === 'number'
      ? (raw.metric === 'Error Rate' ? `${raw.value.toFixed(1)}%` : `${Math.round(raw.value)}ms`)
      : String(raw.value ?? '');
  return {
    id: raw.id,
    ruleId: raw.ruleId,
    ruleName: raw.ruleName,
    service: raw.service,
    namespace: raw.namespace,
    condition: raw.condition || '',
    value,
    severity: (raw.severity || 'Warning') as ActiveAlert['severity'],
    status: 'Firing',
    duration: 'live',
    timestamp: firedAt.toLocaleString(),
  };
}

// Rules/channels persist on the API; silences/acks remain browser-local for now.

export default function Alerts({ namespace: initialNamespace }: AlertsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'active' | 'rules' | 'channels' | 'silences'>('active');

  // Real data state
  const [namespacesList, setNamespacesList] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>(initialNamespace || '');
  const [servicesList, setServicesList] = useState<ServiceStats[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);

  // Server-backed rules / channels / firings (silences+acks stay local for now)
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [serverActive, setServerActive] = useState<ActiveAlert[]>([]);

  const [silences, setSilences] = useState<SilenceRule[]>(() => {
    const saved = localStorage.getItem('alert_silences');
    return saved ? JSON.parse(saved) : [];
  });
  const [silenceSortField, setSilenceSortField] = useState<SilenceSortField>('endTime');
  const [silenceSortDir, setSilenceSortDir] = useState<StandardSortDirection>('asc');
  const silenceColumns = useColumnResize(silenceColumnWidths, {
    minWidths: silenceColumnMinimums,
    storageKey: 'alertSilenceColumnsV1',
  });

  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<string[]>(() => {
    const saved = localStorage.getItem('acked_alert_ids');
    return saved ? JSON.parse(saved) : [];
  });

  // Drawer / Toast States
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Add-channel modal state
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'Slack' | 'Email' | 'PagerDuty' | 'Webhook'>('Webhook');
  const [newChannelTarget, setNewChannelTarget] = useState('');

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const refreshAlertConfig = useCallback(async () => {
    const [rulesRes, channelsRes, activeRes] = await Promise.all([
      api.getAlertRules(),
      api.getAlertChannels(),
      api.getActiveAlerts(),
    ]);
    setRules((rulesRes.rules || []).map(fromServerRule));
    setChannels((channelsRes.channels || []).map(fromServerChannel));
    setServerActive((activeRes.alerts || []).map(fromServerActive));
  }, []);

  // Load server alerts; one-time migrate browser-local rules/channels if server is empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAlerts(true);
      try {
        await refreshAlertConfig();
        if (cancelled) return;
        const localRulesRaw = localStorage.getItem('alert_rules');
        const localChannelsRaw = localStorage.getItem('alert_channels');
        const localRules: AlertRule[] = localRulesRaw ? JSON.parse(localRulesRaw) : [];
        const localChannels: NotificationChannel[] = localChannelsRaw ? JSON.parse(localChannelsRaw) : [];
        const serverRules = (await api.getAlertRules()).rules || [];
        const serverChannels = (await api.getAlertChannels()).channels || [];
        if (serverRules.length === 0 && serverChannels.length === 0 && (localRules.length > 0 || localChannels.length > 0)) {
          const idMap: Record<string, string> = {};
          for (const ch of localChannels) {
            const saved = await api.upsertAlertChannel({
              name: ch.name,
              type: ch.type,
              target: ch.target,
            });
            if (ch.id && saved?.id) idMap[ch.id] = saved.id;
          }
          for (const rule of localRules) {
            const payload = toServerRule({
              ...rule,
              channels: (rule.channels || []).map(id => idMap[id] || id),
            });
            delete (payload as { id?: string }).id;
            await api.upsertAlertRule(payload);
          }
          localStorage.removeItem('alert_rules');
          localStorage.removeItem('alert_channels');
          await refreshAlertConfig();
          if (!cancelled) showToast('Migrated local alert rules to the server.');
        }
      } catch {
        if (!cancelled) showToast('Could not load server alerts.');
      } finally {
        if (!cancelled) setLoadingAlerts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshAlertConfig]);

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim() || !newChannelTarget.trim()) {
      showToast('Channel name and target are required.');
      return;
    }
    try {
      const saved = await api.upsertAlertChannel({
        name: newChannelName.trim(),
        type: newChannelType,
        target: newChannelTarget.trim(),
      });
      setChannels(prev => [fromServerChannel(saved), ...prev.filter(c => c.id !== saved.id)]);
      setChannelModalOpen(false);
      setNewChannelName('');
      setNewChannelTarget('');
      setNewChannelType('Webhook');
      showToast('Notification channel saved on server.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to save channel.');
    }
  };

  // New Rule Form Fields
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleNamespace, setNewRuleNamespace] = useState('');
  const [newRuleService, setNewRuleService] = useState('all-services');
  const [newRuleMetric, setNewRuleMetric] = useState<'Error Rate' | 'p95 Latency' | 'p99 Latency' | 'CPU Usage'>('Error Rate');
  const [newRuleCondition, setNewRuleCondition] = useState('> 2.0%');
  const [newRuleWindow, setNewRuleWindow] = useState('5m');
  const [newRuleSeverity, setNewRuleSeverity] = useState<'Critical' | 'Warning' | 'Info'>('Critical');
  const [newRuleChannels, setNewRuleChannels] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem('alert_silences', JSON.stringify(silences));
  }, [silences]);

  useEffect(() => {
    localStorage.setItem('acked_alert_ids', JSON.stringify(acknowledgedAlerts));
  }, [acknowledgedAlerts]);

  // Load real namespaces (no fabricated fallbacks)
  useEffect(() => {
    api.getNamespaces()
      .then(res => setNamespacesList(res?.namespaces || []))
      .catch(() => setNamespacesList([]));
  }, []);

  // Sync prop namespace changes to local state
  useEffect(() => {
    if (initialNamespace) {
      setSelectedNamespace(initialNamespace);
    }
  }, [initialNamespace]);

  // Load ALL services once (across namespaces) so rules are evaluated
  // against their own namespace regardless of the page-level filter.
  const loadServices = useCallback(async () => {
    try {
      const res = await api.getServices('');
      setServicesList(res?.services || []);
    } catch {
      setServicesList([]);
    } finally {
      setLoadingServices(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
    const interval = setInterval(loadServices, 30000);
    return () => clearInterval(interval);
  }, [loadServices]);

  // Server-side evaluation + refresh active firings
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await api.evaluateAlerts();
        const activeRes = await api.getActiveAlerts();
        if (!cancelled) setServerActive((activeRes.alerts || []).map(fromServerActive));
      } catch {
        /* keep last known firings */
      }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Rule activation toggle
  const handleToggleRule = async (id: string) => {
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const next = { ...rule, active: !rule.active };
    try {
      const saved = await api.upsertAlertRule(toServerRule(next));
      setRules(prev => prev.map(r => (r.id === id ? fromServerRule(saved) : r)));
      showToast(`Rule "${rule.name}" is now ${next.active ? 'enabled' : 'disabled'}.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to update rule.');
    }
  };

  // Rule creation handler
  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim()) {
      showToast('Please enter a valid rule name.');
      return;
    }
    if (!newRuleNamespace) {
      showToast('Please choose a target namespace.');
      return;
    }
    if (newRuleMetric === 'CPU Usage') {
      showToast('CPU Usage rules are not supported server-side yet. Use Error Rate or latency.');
      return;
    }

    const draft: AlertRule = {
      id: '',
      name: newRuleName.trim().toLowerCase().replace(/\s+/g, '-'),
      namespace: newRuleNamespace,
      service: newRuleService,
      metric: newRuleMetric,
      condition: newRuleCondition,
      window: newRuleWindow,
      severity: newRuleSeverity,
      active: true,
      channels: newRuleChannels,
    };

    try {
      const saved = await api.upsertAlertRule(toServerRule(draft));
      setRules(prev => [fromServerRule(saved), ...prev]);
      setIsDrawerOpen(false);
      setNewRuleName('');
      setNewRuleService('all-services');
      setNewRuleMetric('Error Rate');
      setNewRuleCondition('> 2.0%');
      setNewRuleWindow('5m');
      setNewRuleSeverity('Critical');
      setNewRuleChannels([]);
      showToast(`Alert policy "${saved.name}" saved on server.`);
      await api.evaluateAlerts().catch(() => undefined);
      const activeRes = await api.getActiveAlerts().catch(() => ({ alerts: [] }));
      setServerActive((activeRes.alerts || []).map(fromServerActive));
    } catch (err: any) {
      showToast(err?.message || 'Failed to create rule.');
    }
  };

  // Open the creation drawer with sensible defaults
  const openCreateDrawer = () => {
    setNewRuleNamespace(selectedNamespace || namespacesList[0] || '');
    setNewRuleService('all-services');
    setIsDrawerOpen(true);
  };

  // Services available in the namespace picked inside the creation drawer
  const drawerServices = servicesList.filter(s => s.namespace === newRuleNamespace);

  const handleDeleteRule = async (id: string) => {
    if (!window.confirm('Delete this alert rule?')) return;
    try {
      await api.deleteAlertRule(id);
      setRules(prev => prev.filter(r => r.id !== id));
      showToast('Alert rule deleted.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete rule.');
    }
  };

  const handleDeleteChannel = async (id: string) => {
    try {
      await api.deleteAlertChannel(id);
      setChannels(prev => prev.filter(c => c.id !== id));
      showToast('Channel removed.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete channel.');
    }
  };

  // Silence creation and cancellation handlers
  const handleCreateSilence = (serviceName: string) => {
    const newSilence: SilenceRule = {
      id: `silence-${Date.now()}`,
      service: serviceName,
      reason: 'Manual silence window from incidents dashboard',
      duration: '4 hours remaining',
      startTime: new Date().toISOString().replace('T', ' ').substring(0, 16),
      endTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 16)
    };
    setSilences(prev => [newSilence, ...prev]);
    showToast(`Muted alerts for service "${serviceName}" successfully.`);
  };

  const handleRemoveSilence = (id: string) => {
    setSilences(prev => prev.filter(s => s.id !== id));
    showToast('Silence schedule removed. Monitoring restored.');
  };

  const handleToggleAckAlert = (alertId: string) => {
    setAcknowledgedAlerts(prev => {
      const idx = prev.indexOf(alertId);
      if (idx !== -1) {
        showToast('Alert status reverted to firing.');
        return prev.filter(id => id !== alertId);
      } else {
        showToast('Alert acknowledged successfully.');
        return [...prev, alertId];
      }
    });
  };

  // Merge server firings with local silence/ack overlays
  const activeAlertsEvaluated: ActiveAlert[] = serverActive.map(alert => {
    const isSilenced = silences.some(s => s.service === alert.service);
    const isAcked = acknowledgedAlerts.includes(alert.id);
    let status: 'Firing' | 'Acknowledged' | 'Silenced' = 'Firing';
    if (isSilenced) status = 'Silenced';
    else if (isAcked) status = 'Acknowledged';
    return { ...alert, status };
  });

  // Page-level namespace filter narrows the visible incidents
  const visibleAlerts = selectedNamespace
    ? activeAlertsEvaluated.filter(a => a.namespace === selectedNamespace)
    : activeAlertsEvaluated;

  // Count tabs metrics
  const totalFiring = visibleAlerts.filter(a => a.status === 'Firing').length;
  const totalAcked = visibleAlerts.filter(a => a.status === 'Acknowledged').length;
  const totalSilenced = visibleAlerts.filter(a => a.status === 'Silenced').length;
  const sortedSilences = useMemo(() => [...silences].sort((a, b) => {
    const left = a[silenceSortField] || '';
    const right = b[silenceSortField] || '';
    const comparison = left.localeCompare(right);
    return silenceSortDir === 'asc' ? comparison : -comparison;
  }), [silenceSortDir, silenceSortField, silences]);

  const setSilenceSort = (field: SilenceSortField) => {
    if (field === silenceSortField) {
      setSilenceSortDir(current => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSilenceSortField(field);
    setSilenceSortDir('asc');
  };

  const resizeSilenceColumnWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, column: SilenceColumn) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    silenceColumns.resizeBy(column, event.key === 'ArrowRight' ? 16 : -16);
  };

  const silenceHeaderProps = {
    activeSort: silenceSortField,
    direction: silenceSortDir,
    onSort: setSilenceSort,
    onResize: silenceColumns.startResize,
    onResizeKey: resizeSilenceColumnWithKeyboard,
    onReset: silenceColumns.resetWidths,
  };

  return (
    <div className="animate-fade-in alerts-page" style={{ paddingBottom: '40px' }}>
      {/* Toast Popup Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '12px',
          padding: '12px 20px',
          boxShadow: 'var(--shadow-lg), var(--shadow-glow)',
          zIndex: 9999,
          fontSize: '13px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          animation: 'slideUp 0.3s ease-out'
        }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px' }}>✓</div>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header bar and selectors */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-primary)', paddingBottom: '16px', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div className="visibility-breadcrumbs" style={{ fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{t('Alerting Dashboard')}</span>
            <span style={{ margin: '0 8px', color: 'var(--text-muted)' }}>&gt;</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{t('Real-time Incidents')}</span>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 650, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.03em' }}>{t('Alerts & Incidents')}</h1>
        </div>

        {/* Dynamic Namespace Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{t('Namespace Scope')}</label>
          <CustomSelect
            className="alert-namespace-select"
            ariaLabel={t('Namespace Scope')}
            value={selectedNamespace}
            onChange={setSelectedNamespace}
            options={[
              { value: '', label: t('All Namespaces') },
              ...namespacesList.map(ns => ({ value: ns, label: ns })),
            ]}
          />
        </div>
      </div>

      {/* Modern Aggregate Cards */}
      <div className="alerts-overview-grid">
        <div className="alert-stat-card">
          <div className="alert-stat-topline">
            <span className="alert-stat-label">{t('Firing Alerts')}</span>
          </div>
          <div className="alert-stat-value">{totalFiring}</div>
          <div className="alert-stat-detail">{t('Violations requiring action')}</div>
        </div>

        <div className="alert-stat-card">
          <div className="alert-stat-topline">
            <span className="alert-stat-label">{t('Acknowledged')}</span>
          </div>
          <div className="alert-stat-value">{totalAcked}</div>
          <div className="alert-stat-detail">{t('Being investigated')}</div>
        </div>

        <div className="alert-stat-card">
          <div className="alert-stat-topline">
            <span className="alert-stat-label">{t('Silenced Services')}</span>
          </div>
          <div className="alert-stat-value">{totalSilenced}</div>
          <div className="alert-stat-detail">{t('Muted by silences')}</div>
        </div>

        <div className="alert-stat-card">
          <div className="alert-stat-topline">
            <span className="alert-stat-label">{t('Active Rules')}</span>
          </div>
          <div className="alert-stat-value">{rules.filter(r => r.active).length} / {rules.length}</div>
          <div className="alert-stat-detail">{t('Evaluated live')}</div>
        </div>
      </div>

      {/* Tabs Menu & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-primary)', paddingBottom: '0', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div className="alerts-tabs">
          <button className={`alerts-tab-btn ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
            {t('Active Alerts')} ({visibleAlerts.length})
          </button>
          <button className={`alerts-tab-btn ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
            {t('Alert Rules')} ({rules.length})
          </button>
          <button className={`alerts-tab-btn ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>
            {t('Notification Channels')} ({channels.length})
          </button>
          <button className={`alerts-tab-btn ${activeTab === 'silences' ? 'active' : ''}`} onClick={() => setActiveTab('silences')}>
            {t('Silences')} ({silences.length})
          </button>
        </div>

        {activeTab === 'rules' && (
          <button
            className="btn btn-primary"
            onClick={openCreateDrawer}
            style={{
              padding: '8px 18px',
              fontSize: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)',
              border: 'none',
              borderRadius: '20px',
              color: '#ffffff',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-glow)',
              marginBottom: '10px'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('Create Alert Rule')}
          </button>
        )}
      </div>

      {/* Tab Panels */}
      <div>
        {/* Active Alerts Panel (Premium Grid of Incident Cards) */}
        {activeTab === 'active' && (
          <div>
            {loadingServices || loadingAlerts ? (
              <LoadingState height={220} label="Loading server alert evaluation…" />
            ) : visibleAlerts.length === 0 ? (
              <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)', borderStyle: 'dashed', borderWidth: '1px' }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>No Firing Incidents</div>
                <div style={{ fontSize: '12.5px', marginTop: '6px', maxWidth: '320px', marginLeft: 'auto', marginRight: 'auto' }}>
                  All services{selectedNamespace ? <> in <span className="badge badge-ns">{selectedNamespace}</span></> : ''} are within defined limits.
                </div>
              </div>
            ) : (
              <div className="alert-cards-grid">
                {visibleAlerts.map(alert => {
                  const isFiring = alert.status === 'Firing';
                  const isAcked = alert.status === 'Acknowledged';
                  const severityColor =
                    alert.severity === 'Critical' ? 'var(--accent-rose)' :
                    alert.severity === 'Warning' ? 'var(--accent-amber)' : 'var(--accent-blue)';

                  return (
                    <div
                      key={alert.id}
                      className="alert-card-premium"
                      style={{ '--alert-color': severityColor } as React.CSSProperties}
                    >
                      <div className="alert-card-header">
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <h3 className="alert-card-title">{alert.ruleName}</h3>
                            <span className={`badge ${
                              alert.severity === 'Critical' ? 'badge-critical' :
                              alert.severity === 'Warning' ? 'badge-warning' : 'badge-info'
                            }`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                              {alert.severity}
                            </span>
                          </div>
                          <span className="alert-card-meta">
                            {alert.timestamp} &bull; window: {alert.duration}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: isFiring ? 'var(--accent-rose)' : isAcked ? 'var(--accent-amber)' : 'var(--text-muted)',
                            boxShadow: isFiring ? '0 0 6px var(--accent-rose)' : 'none',
                            animation: isFiring ? 'pulse-glowing 1.5s infinite' : 'none'
                          }} />
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>{alert.status}</span>
                        </div>
                      </div>

                      <div className="alert-card-content">
                        <div className="alert-card-metric-row">
                          <span className="alert-card-metric-label">Target Service</span>
                          <span className="alert-card-metric-value" style={{ color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className="badge badge-ns" style={{ fontSize: '9px' }}>{alert.namespace}</span>
                            {alert.service}
                          </span>
                        </div>
                        <div className="alert-card-metric-row">
                          <span className="alert-card-metric-label">Condition</span>
                          <span className="alert-card-metric-value" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{alert.condition}</span>
                        </div>
                        <div className="alert-card-metric-row">
                          <span className="alert-card-metric-label">Current Value</span>
                          <span className="alert-card-metric-value" style={{ color: isFiring ? 'var(--accent-rose)' : 'var(--text-primary)', fontSize: '13px' }}>
                            {alert.value}
                          </span>
                        </div>
                      </div>

                      <div className="alert-card-actions">
                        <button
                          type="button"
                          onClick={() => handleToggleAckAlert(alert.id)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: '1px solid var(--border-primary)',
                            background: isAcked ? 'var(--bg-active)' : 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isAcked ? 'Un-Acknowledge' : 'Acknowledge'}
                        </button>
                        
                        {!isAcked && alert.status !== 'Silenced' && (
                          <button
                            type="button"
                            onClick={() => handleCreateSilence(alert.service)}
                            style={{
                              padding: '6px 12px',
                              fontSize: '11px',
                              fontWeight: 600,
                              borderRadius: '6px',
                              border: '1px solid var(--border-primary)',
                              background: 'var(--bg-secondary)',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.2s'
                            }}
                          >
                            Mute Service
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => navigate(`/traces?service=${alert.service}&error=true`)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: 'var(--accent-indigo)',
                            cursor: 'pointer'
                          }}
                        >
                          View Traces &rarr;
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <style>{`
              @keyframes pulse-glowing {
                0% { opacity: 0.4; }
                50% { opacity: 1; }
                100% { opacity: 0.4; }
              }
            `}</style>
          </div>
        )}

        {/* Alert Rules Panel (Premium Rule Grid Layout) */}
        {activeTab === 'rules' && rules.length === 0 && (
          <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-secondary)', borderStyle: 'dashed', borderWidth: '1px' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>No Alert Rules Yet</div>
            <div style={{ fontSize: '12.5px', marginTop: '6px', maxWidth: '360px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              Rules evaluate live error rates and latency, and surface incidents here.
            </div>
            <button
              className="btn btn-primary"
              onClick={openCreateDrawer}
              style={{ marginTop: '18px', padding: '9px 22px', fontSize: '12.5px', fontWeight: 600, background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', border: 'none', borderRadius: '10px', color: '#ffffff', cursor: 'pointer', boxShadow: 'var(--shadow-glow)' }}
            >
              + Create Alert Rule
            </button>
          </div>
        )}
        {activeTab === 'rules' && rules.length > 0 && (
          <div className="alert-cards-grid">
            {rules.map(rule => {
              const severityColor =
                rule.severity === 'Critical' ? 'var(--accent-rose)' :
                rule.severity === 'Warning' ? 'var(--accent-amber)' : 'var(--accent-blue)';

              return (
                <div
                  key={rule.id}
                  className="alert-card-premium"
                  style={{
                    '--alert-color': severityColor,
                    opacity: rule.active ? 1 : 0.65,
                    borderStyle: rule.active ? 'solid' : 'dashed'
                  } as React.CSSProperties}
                >
                  <div className="alert-card-header">
                    <div>
                      <h3 className="alert-card-title" style={{ fontSize: '15px' }}>{rule.name}</h3>
                      <span className="alert-card-meta">metric: {rule.metric} &bull; window: {rule.window}</span>
                    </div>
                    
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        className="switch-input"
                        checked={rule.active}
                        onChange={() => handleToggleRule(rule.id)}
                      />
                      <span className="switch-slider" />
                    </label>
                  </div>

                  <div className="alert-card-content">
                    <div className="alert-card-metric-row">
                      <span className="alert-card-metric-label">Namespace</span>
                      <span className="alert-card-metric-value">
                        <span className="badge badge-ns" style={{ fontSize: '10px' }}>{rule.namespace || 'any'}</span>
                      </span>
                    </div>
                    <div className="alert-card-metric-row">
                      <span className="alert-card-metric-label">Target Service</span>
                      <span className="alert-card-metric-value" style={{ color: 'var(--text-primary)' }}>
                        {rule.service === 'all-services' ? 'All services' : rule.service}
                      </span>
                    </div>
                    <div className="alert-card-metric-row">
                      <span className="alert-card-metric-label">Evaluation Rule</span>
                      <span className="alert-card-metric-value" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {rule.condition}
                      </span>
                    </div>
                    <div className="alert-card-metric-row">
                      <span className="alert-card-metric-label">Notify Severity</span>
                      <span className="alert-card-metric-value">
                        <span className={`badge ${
                          rule.severity === 'Critical' ? 'badge-critical' :
                          rule.severity === 'Warning' ? 'badge-warning' : 'badge-info'
                        }`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                          {rule.severity}
                        </span>
                      </span>
                    </div>
                  </div>

                  {rule.channels.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', marginRight: '4px' }}>Forward to:</span>
                      {rule.channels.map(ch => (
                        <span key={ch} style={{ fontSize: '10px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                          {ch}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="alert-card-actions" style={{ paddingTop: '8px', borderTop: '1px solid var(--border-primary)' }}>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--accent-rose)',
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Delete Rule
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Notification Channels Panel */}
        {activeTab === 'channels' && (
          <div className="integrations-grid">
            {channels.map(channel => (
              <div className="card integration-card" key={channel.id}>
                <div className="integration-header">
                  <div className="integration-icon-container" style={{
                    background:
                      channel.type === 'Slack' ? 'rgba(74, 21, 75, 0.1)' :
                      channel.type === 'PagerDuty' ? 'rgba(0, 166, 90, 0.1)' :
                      channel.type === 'Email' ? 'rgba(79, 70, 229, 0.1)' : 'rgba(8, 145, 178, 0.1)',
                    color:
                      channel.type === 'Slack' ? '#4A154B' :
                      channel.type === 'PagerDuty' ? '#00a65a' :
                      channel.type === 'Email' ? 'var(--accent-indigo)' : 'var(--accent-cyan)'
                  }}>
                    {channel.type === 'Slack' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5.04 15.12a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52zM6.3 15.12a2.52 2.52 0 0 1 5.04 0v5.04a2.52 2.52 0 1 1-5.04 0v-5.04zM8.82 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.82zM8.82 6.3a2.52 2.52 0 0 1 0 5.04H3.78a2.52 2.52 0 1 1 0-5.04H8.82zM18.96 8.82a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.82zM17.7 8.82a2.52 2.52 0 0 1-5.04 0V3.78a2.52 2.52 0 1 1 5.04 0v5.04zM15.18 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52zM15.18 17.7a2.52 2.52 0 0 1 0-5.04h5.04a2.52 2.52 0 1 1 0 5.04h-5.04z" />
                      </svg>
                    )}
                    {channel.type === 'PagerDuty' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
                      </svg>
                    )}
                    {channel.type === 'Email' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    )}
                    {channel.type === 'Webhook' && (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    )}
                  </div>
                  <div className="integration-details">
                    <div className="integration-name">{channel.name}</div>
                    <div className="integration-description">{channel.type} Target</div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '14px', marginTop: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'block', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>Contact Point Address</span>
                  <code style={{ fontSize: '12px', display: 'block', marginTop: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', padding: '6px 10px', borderRadius: '6px', wordBreak: 'break-all', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {channel.target}
                  </code>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                    Configured
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove channel "${channel.name}"?`)) {
                        handleDeleteChannel(channel.id);
                      }
                    }}
                    style={{
                      fontSize: '11px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      border: '1px solid transparent',
                      cursor: 'pointer',
                      background: 'transparent',
                      color: 'var(--accent-rose)',
                      fontWeight: 600
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}

            {/* Add Channel card */}
            <div
              className="card"
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderWidth: '2px', borderColor: 'var(--border-secondary)', background: 'transparent', padding: '30px', textAlign: 'center', cursor: 'pointer', minHeight: '200px', transition: 'border-color 0.2s' }}
              onClick={() => setChannelModalOpen(true)}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-indigo)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-secondary)'}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" style={{ marginBottom: '10px' }}>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                {channels.length === 0 ? 'Add your first contact point' : 'Add Contact Point'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '240px', lineHeight: 1.5 }}>
                {channels.length === 0
                  ? 'Route incidents to Slack, Email, PagerDuty or a webhook.'
                  : 'Integrate with Slack, Email, PagerDuty, or custom webhook endpoints'}
              </div>
            </div>
          </div>
        )}

        {/* Silences Panel */}
        {activeTab === 'silences' && (
          <div className="card alerts-silence-table-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrapper">
              {silences.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                    <path d="M18.36 18.36A9 9 0 0 1 5.64 5.64m12.72 12.72A9 9 0 0 0 5.64 5.64m12.72 12.72L5.64 5.64" />
                  </svg>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>No Active Silences</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>Alert rules trigger warning pages and notify endpoints normally.</div>
                </div>
              ) : (
                <>
                <StandardTableToolbar
                  title={t('Active silences')}
                  count={`${sortedSilences.length} ${t('results')}`}
                  onReset={silenceColumns.resetWidths}
                  resetLabel={t('Reset columns')}
                  resizeHint={t('Drag column edges to resize')}
                />
                <div className="standard-native-table-scroller">
                <table className="table standard-native-table alerts-silence-table">
                  <colgroup>
                    {silenceColumnOrder.map(column => <col key={column} style={{ width: silenceColumns.widths[column] }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th><StandardColumnHeader column="service" label={t('Service')} sortField="service" {...silenceHeaderProps} /></th>
                      <th><StandardColumnHeader column="reason" label={t('Reason / ticket ID')} sortField="reason" {...silenceHeaderProps} /></th>
                      <th><StandardColumnHeader column="startTime" label={t('Muted since')} sortField="startTime" {...silenceHeaderProps} /></th>
                      <th><StandardColumnHeader column="endTime" label={t('Expires at')} sortField="endTime" {...silenceHeaderProps} /></th>
                      <th><StandardColumnHeader column="status" label={t('Status')} sortField="duration" {...silenceHeaderProps} /></th>
                      <th><StandardColumnHeader column="actions" label={t('Actions')} align="right" isLast {...silenceHeaderProps} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSilences.map(silence => (
                      <tr key={silence.id}>
                        <td>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {silence.service}
                          </span>
                        </td>
                        <td>{silence.reason}</td>
                        <td>{silence.startTime}</td>
                        <td>{silence.endTime}</td>
                        <td>
                          <span className="badge badge-warning" style={{ fontSize: '10px', fontWeight: 700 }}>
                            {silence.duration}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleRemoveSilence(silence.id)}
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: 'var(--accent-rose)'
                            }}
                          >
                            Remove Mute
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Slide Out Creation Drawer */}
      {isDrawerOpen && (
        <div className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)} style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-primary)', width: '420px', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="drawer-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="drawer-title" style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Create Alert Policy</span>
              <button
                onClick={() => setIsDrawerOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '20px'
                }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="drawer-body" style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
                
                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Rule Name</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. checkout-service-latency-spike"
                    value={newRuleName}
                    onChange={(e) => setNewRuleName(e.target.value)}
                    required
                  />
                </div>

                {/* Scope: namespace first, then the services inside it */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', padding: '14px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-primary)' }}>
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>1 · Namespace</label>
                    <CustomSelect
                      className="drawer-select"
                      ariaLabel="Namespace"
                      value={newRuleNamespace}
                      onChange={(value) => {
                        setNewRuleNamespace(value);
                        setNewRuleService('all-services'); // reset service on namespace change
                      }}
                      placeholder="Select namespace..."
                      options={[
                        { value: '', label: 'Select namespace...', disabled: true },
                        ...namespacesList.map(ns => ({ value: ns, label: ns })),
                      ]}
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>2 · Service</label>
                    <CustomSelect
                      className="drawer-select"
                      ariaLabel="Service"
                      value={newRuleService}
                      onChange={setNewRuleService}
                      disabled={!newRuleNamespace}
                      options={[
                        { value: 'all-services', label: `All services (${drawerServices.length})` },
                        ...drawerServices.map(svc => ({ value: svc.serviceName, label: svc.serviceName })),
                      ]}
                    />
                    {newRuleNamespace && drawerServices.length === 0 && (
                      <span style={{ fontSize: '10.5px', color: 'var(--accent-amber)' }}>
                        No services yet.
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Metric</label>
                    <CustomSelect
                      className="drawer-select"
                      ariaLabel="Metric"
                      value={newRuleMetric}
                      onChange={(value) => setNewRuleMetric(value as AlertRule['metric'])}
                      options={[
                        { value: 'Error Rate', label: 'Error Rate (%)' },
                        { value: 'p95 Latency', label: 'p95 Latency (ms)' },
                        { value: 'p99 Latency', label: 'p99 Latency (ms)' },
                      ]}
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Eval Window</label>
                    <CustomSelect
                      className="drawer-select"
                      ariaLabel="Eval Window"
                      value={newRuleWindow}
                      onChange={setNewRuleWindow}
                      options={[
                        { value: '1m', label: '1 minute' },
                        { value: '5m', label: '5 minutes' },
                        { value: '15m', label: '15 minutes' },
                        { value: '1h', label: '1 hour' },
                      ]}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Condition Threshold</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={newRuleMetric === 'Error Rate' ? 'e.g. > 2.0%' : 'e.g. > 1200ms'}
                    value={newRuleCondition}
                    onChange={(e) => setNewRuleCondition(e.target.value)}
                    required
                  />
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Enter comparison operator and value, e.g. &gt; 2.0%</span>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Severity Level</label>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
                    {['Critical', 'Warning', 'Info'].map(sev => (
                      <label key={sev} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        <input
                          type="radio"
                          name="severity"
                          checked={newRuleSeverity === sev}
                          onChange={() => setNewRuleSeverity(sev as any)}
                          style={{ accentColor: 'var(--accent-indigo)' }}
                        />
                        {sev}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Forward Notifications To</label>
                  {channels.length === 0 && (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: 1.55, background: 'var(--bg-tertiary)', border: '1px dashed var(--border-primary)', borderRadius: '8px', padding: '10px 12px' }}>
                      No channels configured — incidents still show on this page. Add contact points in the
                      <strong style={{ color: 'var(--text-secondary)' }}> Channels</strong> tab.
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    {channels.map(channel => (
                      <label key={channel.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={newRuleChannels.includes(channel.name)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewRuleChannels(prev => [...prev, channel.name]);
                            } else {
                              setNewRuleChannels(prev => prev.filter(c => c !== channel.name));
                            }
                          }}
                          style={{ accentColor: 'var(--accent-indigo)' }}
                        />
                        {channel.name} ({channel.type})
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="drawer-footer" style={{ padding: '20px 24px', borderTop: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: 'var(--bg-tertiary)' }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setIsDrawerOpen(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-primary)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    boxShadow: 'var(--shadow-glow)'
                  }}
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Contact Point Modal */}
      {channelModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10, 14, 23, 0.75)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9998, animation: 'fadeIn 0.2s' }} onClick={() => setChannelModalOpen(false)}>
          <form
            onSubmit={handleAddChannel}
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: '16px', width: '480px', maxWidth: '92%', padding: '28px', display: 'flex', flexDirection: 'column', gap: '18px', boxShadow: 'var(--shadow-lg), var(--shadow-glow)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Add Contact Point</h3>
              <button type="button" onClick={() => setChannelModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>

            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Channel Name</label>
              <input type="text" className="input-field" placeholder="e.g. SRE On-call Slack" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} required />
            </div>

            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {(['Slack', 'Email', 'PagerDuty', 'Webhook'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewChannelType(t)}
                    style={{
                      padding: '8px 4px', fontSize: '11.5px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s',
                      border: `1px solid ${newChannelType === t ? 'var(--accent-indigo)' : 'var(--border-primary)'}`,
                      background: newChannelType === t ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-tertiary)',
                      color: newChannelType === t ? 'var(--accent-indigo-light)' : 'var(--text-secondary)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                {newChannelType === 'Slack' ? 'Channel / Webhook URL' : newChannelType === 'Email' ? 'Email Address' : newChannelType === 'PagerDuty' ? 'Integration / Escalation Policy' : 'Webhook URL'}
              </label>
              <input
                type="text"
                className="input-field"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder={newChannelType === 'Slack' ? '#alerts-ops or https://hooks.slack.com/…' : newChannelType === 'Email' ? 'sre-team@company.com' : newChannelType === 'PagerDuty' ? 'SRE_ONCALL policy key' : 'https://…'}
                value={newChannelTarget}
                onChange={(e) => setNewChannelTarget(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
              <button type="button" onClick={() => setChannelModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-primary)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>Cancel</button>
              <button type="submit" style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg, var(--accent-indigo) 0%, var(--accent-violet) 100%)', color: '#ffffff', cursor: 'pointer', fontSize: '13px', fontWeight: 600, boxShadow: 'var(--shadow-glow)' }}>Add Channel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
