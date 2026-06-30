import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export default function Admin() {
  const [activeTab, setActiveTab] = useState<'namespaces' | 'infrastructure' | 'clusters' | 'instrumentations'>('namespaces');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // States
  const [nsData, setNsData] = useState<{ enabled: string[]; disabled: string[] }>({ enabled: [], disabled: [] });
  const [infraConfig, setInfraConfig] = useState<any>(null);
  const [isEditingInfra, setIsEditingInfra] = useState(false);
  const [editableInfra, setEditableInfra] = useState<any>(null);
  const [clusters, setClusters] = useState<string[]>([]);
  const [instrumentations, setInstrumentations] = useState<{ name: string; namespace: string; endpoint: string; sampler: string }[]>([]);
  
  // Interaction States
  const [togglingNs, setTogglingNs] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [namespacesRes, configRes, clustersRes, instrumentationsRes] = await Promise.all([
        api.getNamespaceStatuses(),
        api.getAdminConfig(),
        api.getClusters().catch(() => ({ clusters: ['default'] })),
        api.getAdminInstrumentations().catch(() => ({ instrumentations: [] })),
      ]);

      setNsData({
        enabled: namespacesRes?.enabled || [],
        disabled: namespacesRes?.disabled || []
      });
      setInfraConfig(configRes);
      setClusters(clustersRes.clusters || ['default']);
      setInstrumentations(instrumentationsRes.instrumentations || []);
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
      
      // Real-time optimistic update of the local state so the user sees changes instantly
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
        
        // Keep lists alphabetically sorted for neatness
        enabled.sort();
        disabled.sort();
        
        return { enabled, disabled };
      });

      setActionSuccessMessage(`Successfully ${makeDisabled ? 'disabled' : 'enabled'} ingestion for namespace "${namespace}"!`);
    } catch (err: any) {
      setError(err.message || 'Failed to update namespace status');
    } finally {
      setTogglingNs(null);
    }
  };

  const handleSaveInfra = async () => {
    try {
      setLoading(true);
      await api.updateAdminConfig(editableInfra);
      setInfraConfig(editableInfra);
      setIsEditingInfra(false);
      setActionSuccessMessage('Infrastructure configurations updated successfully!');
      const configRes = await api.getAdminConfig();
      setInfraConfig(configRes);
    } catch (err: any) {
      setError(err.message || 'Failed to update configurations');
    } finally {
      setLoading(false);
    }
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
      <h1 className="page-title">Admin Dashboard</h1>
      <p className="page-subtitle">Configure namespaces, examine system topology components, and monitor Kubernetes clusters.</p>

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
      <div style={{ display: 'flex', gap: '8px', marginBottom: '28px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '8px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('namespaces')}
          style={{
            background: activeTab === 'namespaces' ? 'var(--gradient-primary)' : 'transparent',
            color: activeTab === 'namespaces' ? '#ffffff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '20px',
            padding: '8px 18px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: activeTab === 'namespaces' ? 'var(--shadow-md), var(--shadow-glow)' : 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'namespaces') e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'namespaces') e.currentTarget.style.background = 'transparent';
          }}
        >
          Namespace Manager
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('infrastructure')}
          style={{
            background: activeTab === 'infrastructure' ? 'var(--gradient-primary)' : 'transparent',
            color: activeTab === 'infrastructure' ? '#ffffff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '20px',
            padding: '8px 18px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: activeTab === 'infrastructure' ? 'var(--shadow-md), var(--shadow-glow)' : 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'infrastructure') e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'infrastructure') e.currentTarget.style.background = 'transparent';
          }}
        >
          Infrastructure Configs
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('clusters')}
          style={{
            background: activeTab === 'clusters' ? 'var(--gradient-primary)' : 'transparent',
            color: activeTab === 'clusters' ? '#ffffff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '20px',
            padding: '8px 18px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: activeTab === 'clusters' ? 'var(--shadow-md), var(--shadow-glow)' : 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'clusters') e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'clusters') e.currentTarget.style.background = 'transparent';
          }}
        >
          Cluster Inventory
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('instrumentations')}
          style={{
            background: activeTab === 'instrumentations' ? 'var(--gradient-primary)' : 'transparent',
            color: activeTab === 'instrumentations' ? '#ffffff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: '20px',
            padding: '8px 18px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: activeTab === 'instrumentations' ? 'var(--shadow-md), var(--shadow-glow)' : 'none',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== 'instrumentations') e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'instrumentations') e.currentTarget.style.background = 'transparent';
          }}
        >
          Auto-Instrumentation
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'namespaces' && (
        <div>
          {/* Header for Namespace Manager */}
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Ingestion Control</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Toggle tracing ingestion status dynamically. Disabled namespaces completely drop telemetry events at the collector.</span>
          </div>

          {/* Cards Layout Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            
            {/* Enabled Namespace Cards */}
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
                    <span className="text-muted" style={{ fontWeight: 600 }}>Instrumentation:</span> <code className="mono" style={{ fontSize: '10.5px', color: 'var(--accent-indigo)' }}>{ns}-instrumentation</code>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-primary)', padding: '12px 18px', background: 'var(--bg-tertiary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottomLeftRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-lg)' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ color: 'var(--accent-rose)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleToggleNamespace(ns, true)}
                  >
                    Disable Ingestion
                  </button>
                </div>
              </div>
            ))}

            {/* Disabled Namespace Cards */}
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
                  opacity: 0.8
                }}
              >
                {togglingNs === ns && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(10, 14, 23, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, borderRadius: 'var(--radius-lg)' }}>
                    <div style={{ width: '20px', height: '20px', border: '2px solid transparent', borderTopColor: '#ffffff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  </div>
                )}
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{ns}</span>
                    <span className="badge badge-ns" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent-rose)', border: '1px solid rgba(244, 63, 94, 0.2)', padding: '2px 8px', borderRadius: '12px', fontSize: '10px' }}>
                      Disabled
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
                    style={{ color: 'var(--accent-emerald)', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    onClick={() => handleToggleNamespace(ns, false)}
                  >
                    Enable Ingestion
                  </button>
                </div>
              </div>
            ))}

            {/* Empty view check */}
            {nsData.enabled.length === 0 && nsData.disabled.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-primary)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                No active tracking namespaces registered.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'infrastructure' && infraConfig && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            {!isEditingInfra ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setEditableInfra(JSON.parse(JSON.stringify(infraConfig)));
                  setIsEditingInfra(true);
                }}
              >
                Edit Configs
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsEditingInfra(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveInfra}
                >
                  Save Changes
                </button>
              </>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
            {/* Kafka Card */}
            <div className="card">
              <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                <div className="card-title">Apache Kafka Queue</div>
              </div>
              <div className="card-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Bootstrap Brokers</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.brokers || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.kafka?.brokers || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, brokers: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Spans Ingestion Topic</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.topic || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.kafka?.topic || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, topic: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Consumer Group ID</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.group || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.kafka?.group || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, kafka: { ...editableInfra.kafka, group: e.target.value } })}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ClickHouse Card */}
            <div className="card">
              <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                <div className="card-title">ClickHouse Analytics Store</div>
              </div>
              <div className="card-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>HTTP Server Endpoint</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.clickhouse?.url || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.clickhouse?.url || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, clickhouse: { ...editableInfra.clickhouse, url: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Database Type</span>
                  <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>ClickHouse OLAP Database</span>
                </div>
              </div>
            </div>

            {/* MinIO Card */}
            <div className="card">
              <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                <div className="card-title">MinIO Storage Backing</div>
              </div>
              <div className="card-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>S3 Host Endpoint</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.endpoint || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.minio?.endpoint || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, endpoint: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>SSL Enabled</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.useSSL || 'false'}</span>
                  ) : (
                    <select
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px', cursor: 'pointer' }}
                      value={editableInfra.minio?.useSSL || 'false'}
                      onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, useSSL: e.target.value } })}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Storage Bucket</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.bucket || 'Not configured'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.minio?.bucket || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, bucket: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Access Key</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.accessKey || 'none'}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.minio?.accessKey || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, accessKey: e.target.value } })}
                    />
                  )}
                </div>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Secret Key</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.secretKey || 'none'}</span>
                  ) : (
                    <input
                      type="password"
                      className="input-field"
                      placeholder="******"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                      value={editableInfra.minio?.secretKey || ''}
                      onChange={(e) => setEditableInfra({ ...editableInfra, minio: { ...editableInfra.minio, secretKey: e.target.value } })}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* LDAP Configuration Card */}
            <div className="card">
              <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                <div className="card-title">LDAP Directory Services</div>
              </div>
              <div className="card-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Authentication Status</span>
                  {!isEditingInfra ? (
                    <span className="mono" style={{ fontSize: '13px', color: infraConfig.ldap?.enabled === 'true' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                      {infraConfig.ldap?.enabled === 'true' ? 'ACTIVE / ENABLED' : 'DISABLED'}
                    </span>
                  ) : (
                    <select
                      className="input-field"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px', cursor: 'pointer' }}
                      value={editableInfra.ldap?.enabled || 'false'}
                      onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, enabled: e.target.value } })}
                    >
                      <option value="true">ENABLED</option>
                      <option value="false">DISABLED</option>
                    </select>
                  )}
                </div>
                {((!isEditingInfra && infraConfig.ldap?.enabled === 'true') || (isEditingInfra && editableInfra.ldap?.enabled === 'true')) && (
                  <>
                    <div>
                      <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Directory Server URL</span>
                      {!isEditingInfra ? (
                        <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.ldap?.url}</span>
                      ) : (
                        <input
                          type="text"
                          className="input-field"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                          value={editableInfra.ldap?.url || ''}
                          onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, url: e.target.value } })}
                        />
                      )}
                    </div>
                    <div>
                      <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Bind Service Account DN</span>
                      {!isEditingInfra ? (
                        <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.bindDN}</span>
                      ) : (
                        <input
                          type="text"
                          className="input-field"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                          value={editableInfra.ldap?.bindDN || ''}
                          onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, bindDN: e.target.value } })}
                        />
                      )}
                    </div>
                    <div>
                      <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Bind Password</span>
                      {!isEditingInfra ? (
                        <span className="mono" style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.bindPassword}</span>
                      ) : (
                        <input
                          type="password"
                          className="input-field"
                          placeholder="******"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                          value={editableInfra.ldap?.bindPassword || ''}
                          onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, bindPassword: e.target.value } })}
                        />
                      )}
                    </div>
                    <div>
                      <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>User DN Base Path</span>
                      {!isEditingInfra ? (
                        <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.userBaseDN}</span>
                      ) : (
                        <input
                          type="text"
                          className="input-field"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                          value={editableInfra.ldap?.userBaseDN || ''}
                          onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, userBaseDN: e.target.value } })}
                        />
                      )}
                    </div>
                    <div>
                      <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Search/Filter Template</span>
                      {!isEditingInfra ? (
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.userFilter}</span>
                      ) : (
                        <input
                          type="text"
                          className="input-field"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', width: '100%', marginTop: '4px' }}
                          value={editableInfra.ldap?.userFilter || ''}
                          onChange={(e) => setEditableInfra({ ...editableInfra, ldap: { ...editableInfra.ldap, userFilter: e.target.value } })}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'clusters' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {clusters.map((clusterName) => (
            <div className="card" key={clusterName} style={{ border: '1px solid var(--border-primary)', borderRadius: '8px' }}>
              <div className="card-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--accent-indigo)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="8" rx="2" />
                    <rect x="2" y="14" width="20" height="8" rx="2" />
                    <line x1="6" y1="6" x2="6.01" y2="6" />
                    <line x1="6" y1="18" x2="6.01" y2="18" />
                  </svg>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{clusterName}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-emerald)' }} />
                  Receiving Telemetry
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'instrumentations' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Active Instrumentations</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              List of OpenTelemetry auto-instrumentation instances detected across the cluster.
            </span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {instrumentations.map((inst) => (
              <div className="card animate-fade-in" key={`${inst.namespace}/${inst.name}`} style={{ border: '1px solid var(--border-primary)', borderRadius: '12px' }}>
                <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 20px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-indigo)' }} />
                  <div className="card-title" style={{ fontSize: '14px', fontWeight: 700, wordBreak: 'break-all' }}>{inst.name}</div>
                </div>
                <div className="card-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Namespace</span>
                    <span className="badge badge-ns" style={{ background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '2px 8px', borderRadius: '12px', fontSize: '10px' }}>
                      {inst.namespace}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Exporter Endpoint</span>
                    <span className="mono" style={{ fontSize: '12.5px', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{inst.endpoint || 'Not set'}</span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Sampler Type</span>
                    <span className="mono" style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>{inst.sampler || 'default'}</span>
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
    </div>
  );
}
