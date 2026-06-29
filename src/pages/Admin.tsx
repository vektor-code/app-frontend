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
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

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
