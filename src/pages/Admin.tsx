import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

export default function Admin() {
  const [activeTab, setActiveTab] = useState<'namespaces' | 'infrastructure' | 'clusters'>('namespaces');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // States
  const [nsData, setNsData] = useState<{ enabled: string[]; disabled: string[] }>({ enabled: [], disabled: [] });
  const [infraConfig, setInfraConfig] = useState<any>(null);
  const [clusters, setClusters] = useState<string[]>([]);
  
  // Interaction States
  const [togglingNs, setTogglingNs] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newNsName, setNewNsName] = useState('');
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);
  const [addingNs, setAddingNs] = useState(false);
  const [deletingNs, setDeletingNs] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [namespacesRes, configRes, clustersRes] = await Promise.all([
        api.getNamespaceStatuses(),
        api.getAdminConfig(),
        api.getClusters().catch(() => ({ clusters: ['default'] })),
      ]);

      setNsData({
        enabled: namespacesRes?.enabled || [],
        disabled: namespacesRes?.disabled || []
      });
      setInfraConfig(configRes);
      setClusters(clustersRes.clusters || ['default']);
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
      await fetchData();
      setActionSuccessMessage(`Successfully ${makeDisabled ? 'disabled' : 'enabled'} ingestion for namespace "${namespace}"!`);
    } catch (err: any) {
      setError(err.message || 'Failed to update namespace status');
    } finally {
      setTogglingNs(null);
    }
  };

  const handleAddNamespace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNsName.trim()) return;
    setAddingNs(true);
    setError(null);
    try {
      await api.addNamespace(newNsName.trim());
      setNewNsName('');
      setShowAddModal(false);
      await fetchData();
      setActionSuccessMessage(`Successfully registered namespace "${newNsName.trim()}"!`);
    } catch (err: any) {
      setError(err.message || 'Failed to add namespace');
    } finally {
      setAddingNs(false);
    }
  };

  const handleDeleteNamespace = async (namespace: string) => {
    if (!window.confirm(`Are you sure you want to completely remove namespace "${namespace}"?`)) return;
    setDeletingNs(namespace);
    try {
      await api.deleteNamespace(namespace);
      await fetchData();
      setActionSuccessMessage(`Successfully removed namespace "${namespace}"!`);
    } catch (err: any) {
      setError(err.message || 'Failed to delete namespace');
    } finally {
      setDeletingNs(null);
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
      </div>

      {/* Tab Contents */}
      {activeTab === 'namespaces' && (
        <div>
          {/* Header Controls for Namespace Manager */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Ingestion Registry</h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Toggle tracing status dynamically or register/delete namespace contexts.</span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {editMode && (
                <button
                  type="button"
                  className="btn btn-indigo"
                  style={{ borderRadius: '18px', padding: '6px 14px', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => setShowAddModal(true)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Namespace
                </button>
              )}
              <button
                type="button"
                className={`btn ${editMode ? 'btn-rose' : 'btn-ghost'}`}
                style={{
                  borderRadius: '18px',
                  padding: '6px 14px',
                  fontSize: '12.5px',
                  border: '1px solid var(--border-primary)',
                  background: editMode ? 'var(--accent-rose)' : 'var(--bg-secondary)',
                  color: editMode ? '#ffffff' : 'var(--text-secondary)'
                }}
                onClick={() => setEditMode(!editMode)}
              >
                {editMode ? 'Exit Edit Mode' : 'Edit Configuration'}
              </button>
            </div>
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
                  minHeight: '130px',
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

                  {editMode && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ color: 'var(--accent-rose)', padding: '4px', borderRadius: '50%' }}
                      disabled={deletingNs === ns}
                      onClick={() => handleDeleteNamespace(ns)}
                    >
                      {deletingNs === ns ? '...' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      )}
                    </button>
                  )}
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
                  minHeight: '130px',
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

                  {editMode && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ color: 'var(--accent-rose)', padding: '4px', borderRadius: '50%' }}
                      disabled={deletingNs === ns}
                      onClick={() => handleDeleteNamespace(ns)}
                    >
                      {deletingNs === ns ? '...' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Empty view check */}
            {nsData.enabled.length === 0 && nsData.disabled.length === 0 && (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-primary)', borderRadius: '16px', color: 'var(--text-secondary)' }}>
                No active tracking namespaces registered. Use Edit Mode to add one!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Namespace Modal Overlay */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 14, 23, 0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div className="card animate-fade-in" style={{ width: '400px', border: '1px solid var(--border-primary)', background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="card-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Register Namespace</span>
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)} style={{ padding: '2px 8px' }}>✕</button>
            </div>
            <form onSubmit={handleAddNamespace} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Namespace Name
                </label>
                <input
                  type="text"
                  placeholder="econtract-dev"
                  value={newNsName}
                  onChange={(e) => setNewNsName(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '13.5px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    transition: 'border 0.2s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-indigo)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-primary)'}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-indigo" disabled={addingNs}>
                  {addingNs ? 'Registering...' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'infrastructure' && infraConfig && (
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
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.brokers || 'Not configured'}</span>
              </div>
              <div>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Spans Ingestion Topic</span>
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.topic || 'Not configured'}</span>
              </div>
              <div>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Consumer Group ID</span>
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.kafka?.group || 'Not configured'}</span>
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
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.clickhouse?.url || 'Not configured'}</span>
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
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.endpoint || 'Not configured'}</span>
              </div>
              <div>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>SSL Enabled</span>
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.useSSL || 'false'}</span>
              </div>
              <div>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Storage Bucket</span>
                <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.minio?.bucket || 'Not configured'}</span>
              </div>
              <div>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Access Credentials (masked)</span>
                <span className="mono" style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  User: {infraConfig.minio?.accessKey || 'none'} | Pass: {infraConfig.minio?.secretKey || 'none'}
                </span>
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
                <span className="mono" style={{ fontSize: '13px', color: infraConfig.ldap?.enabled === 'true' ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                  {infraConfig.ldap?.enabled === 'true' ? 'ACTIVE / ENABLED' : 'DISABLED'}
                </span>
              </div>
              {infraConfig.ldap?.enabled === 'true' && (
                <>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Directory Server URL</span>
                    <span className="mono" style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{infraConfig.ldap?.url}</span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Bind Service Account DN</span>
                    <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.bindDN}</span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Bind Password / Secret</span>
                    <span className="mono" style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.bindPassword}</span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>User DN Base Path</span>
                    <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.userBaseDN}</span>
                  </div>
                  <div>
                    <span className="text-muted" style={{ fontSize: '11px', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Search/Filter Template</span>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{infraConfig.ldap?.userFilter}</span>
                  </div>
                </>
              )}
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
    </div>
  );
}
