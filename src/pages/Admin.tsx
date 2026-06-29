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
  const [togglingNs, setTogglingNs] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [namespacesRes, configRes, clustersRes] = await Promise.all([
        api.getNamespaceStatuses(),
        api.getAdminConfig(),
        api.getClusters().catch(() => ({ clusters: ['default'] })),
      ]);

      setNsData(namespacesRes);
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
    } catch (err: any) {
      alert(err.message || 'Failed to update namespace status');
    } finally {
      setTogglingNs(null);
    }
  };

  if (loading && !infraConfig) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{
          width: '32px',
          height: '32px',
          border: '3px solid rgba(99, 102, 241, 0.15)',
          borderTopColor: 'var(--accent-indigo)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '40px' }}>
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
        }}>
          {error}
        </div>
      )}

      {/* Tabs Menu */}
      <div className="login-tabs" style={{ marginBottom: '24px', maxWidth: '500px' }}>
        <button
          type="button"
          className={`login-tab-btn ${activeTab === 'namespaces' ? 'active' : ''}`}
          onClick={() => setActiveTab('namespaces')}
        >
          Namespace Manager
        </button>
        <button
          type="button"
          className={`login-tab-btn ${activeTab === 'infrastructure' ? 'active' : ''}`}
          onClick={() => setActiveTab('infrastructure')}
        >
          Infrastructure Configs
        </button>
        <button
          type="button"
          className={`login-tab-btn ${activeTab === 'clusters' ? 'active' : ''}`}
          onClick={() => setActiveTab('clusters')}
        >
          Cluster Inventory
        </button>
      </div>

      {/* Tab Contents */}
      {activeTab === 'namespaces' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Namespace Ingestion Control</div>
            <span className="text-sm text-muted">Toggle tracing ingestion status dynamically. Disabled namespaces completely drop telemetry events at the collector.</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Namespace Name</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {nsData.enabled.map((ns) => (
                  <tr key={ns}>
                    <td style={{ fontWeight: 600 }}>{ns}</td>
                    <td>
                      <span className="badge badge-ns" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                        Ingestion Enabled
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--accent-rose)', fontSize: '12px', fontWeight: 600 }}
                        disabled={togglingNs === ns}
                        onClick={() => handleToggleNamespace(ns, true)}
                      >
                        {togglingNs === ns ? 'Processing...' : 'Disable Ingestion'}
                      </button>
                    </td>
                  </tr>
                ))}
                {nsData.disabled.map((ns) => (
                  <tr key={ns}>
                    <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{ns}</td>
                    <td>
                      <span className="badge badge-ns" style={{ background: 'rgba(244, 63, 94, 0.1)', color: 'var(--accent-rose)', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
                        Ingestion Disabled
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--accent-emerald)', fontSize: '12px', fontWeight: 600 }}
                        disabled={togglingNs === ns}
                        onClick={() => handleToggleNamespace(ns, false)}
                      >
                        {togglingNs === ns ? 'Processing...' : 'Enable Ingestion'}
                      </button>
                    </td>
                  </tr>
                ))}
                {nsData.enabled.length === 0 && nsData.disabled.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                      No active namespaces detected
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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
