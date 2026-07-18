import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { DatabaseQueryMetric } from '../entities';
import { useTranslation } from '../utils/i18n';
import TechIcon from '../components/TechIcon';
import LanguageIcon from '../components/LanguageIcon';
import { LoadingState } from '../components/DataState';
import CustomSelect from '../components/CustomSelect';
import IconPack from '../components/IconPack';

interface DbAnalyticsProps {
  namespace: string;
}

type DbMetricTone = 'indigo' | 'emerald' | 'amber' | 'rose';
type DbMetricIconName = 'database' | 'clock' | 'alert' | 'peak';

const DB_METRIC_ICONS: Record<DbMetricIconName, string> = {
  database: '/observability-icons/database.svg',
  clock: '/observability-icons/clock-bolt.svg',
  alert: '/observability-icons/alert-triangle.svg',
  peak: '/observability-icons/chart-line.svg'
};

function DbMetricIcon({ name }: { name: DbMetricIconName }) {
  return <IconPack src={DB_METRIC_ICONS[name]} className="db-metric-icon" />;
}

function DbMetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: DbMetricIconName;
  tone: DbMetricTone;
}) {
  return (
    <div className={`db-metric-card ${tone}`}>
      <div className="db-metric-top">
        <span>{label}</span>
        <DbMetricIcon name={icon} />
      </div>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

export default function DbAnalytics({ namespace }: DbAnalyticsProps) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSystem, setSelectedSystem] = useState('');
  const [selectedService, setSelectedService] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [serviceLanguages, setServiceLanguages] = useState<Record<string, string>>({});
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDatabaseMetrics(namespace || undefined);
      const list = data.metrics || [];
      setMetrics(list);

      // Extract unique services and systems for filters
      const svcNames = list.map(m => m.service);
      setServices([...new Set(svcNames)]);

      const sysNames = list.map(m => m.system);
      setSystems([...new Set(sysNames)]);
    } catch (err) {
      console.error('load database metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Fetch languages so the Service column can render icons like the Services/Traces pages.
  useEffect(() => {
    api.getServices(namespace || undefined).then(data => {
      const langMap: Record<string, string> = {};
      (data.services || []).forEach(s => {
        if (s.language) langMap[s.serviceName] = s.language;
      });
      setServiceLanguages(langMap);
    }).catch(() => {});
  }, [namespace]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const iv = setInterval(loadMetrics, 5000);
    return () => clearInterval(iv);
  }, [loadMetrics]);

  const filteredMetrics = metrics.filter(m => {
    const matchesSearch = m.query.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSystem = selectedSystem ? m.system === selectedSystem : true;
    const matchesService = selectedService ? m.service === selectedService : true;
    return matchesSearch && matchesSystem && matchesService;
  });

  // Calculate aggregated stats
  const totalCalls = filteredMetrics.reduce((sum, m) => sum + m.callCount, 0);
  const totalErrors = filteredMetrics.reduce((sum, m) => sum + m.errorCount, 0);
  const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

  // Weighted average latency
  const avgLatency = totalCalls > 0
    ? filteredMetrics.reduce((sum, m) => sum + (m.avgDurationMs * m.callCount), 0) / totalCalls
    : 0;

  // Find max latency query
  const slowestQuery = filteredMetrics.length > 0
    ? Math.max(...filteredMetrics.map(m => m.maxDurationMs))
    : 0;

  const maxAvgDuration = filteredMetrics.length > 0
    ? Math.max(...filteredMetrics.map(m => m.avgDurationMs))
    : 1;

  const colWidths = {
    system: '11%',
    query: '29%',
    service: '17%',
    calls: '7%',
    avgLatency: '10%',
    slowdown: '10%',
    maxLatency: '8%',
    errorRate: '8%',
  } as const;

  const getSystemBadgeClass = (system: string) => {
    const sys = system.toLowerCase();
    if (sys.includes('postgre') || sys.includes('pg')) return 'badge-system-pg';
    if (sys.includes('mysql')) return 'badge-system-mysql';
    if (sys.includes('redis')) return 'badge-system-redis';
    if (sys.includes('mongo')) return 'badge-system-mongo';
    if (sys.includes('clickhouse')) return 'badge-system-ch';
    if (sys.includes('oracle')) return 'badge-system-oracle';
    if (sys.includes('mssql') || sys.includes('sqlserver')) return 'badge-system-mssql';
    if (sys === 'sql') return 'badge-system-sql';
    return 'badge-system-generic';
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const systemOptions = [
    { value: '', label: t('All Dialects') },
    ...systems.map(sys => ({ value: sys, label: sys.toUpperCase() }))
  ];

  const serviceOptions = [
    { value: '', label: t('All Services') },
    ...services.map(svc => ({ value: svc, label: svc }))
  ];

  return (
    <div className="db-analytics-page animate-fade-in">
      <section className="db-page-hero">
        <div>
          <span className="db-page-kicker">{t('Database telemetry')}</span>
          <h1 className="page-title">{t('Query Performance')}</h1>
        </div>
        <div className="db-page-scope">
          <span>{namespace ? t('Namespace') : t('Scope')}</span>
          <strong>{namespace || t('All namespaces')}</strong>
        </div>
      </section>

      <section className="db-metric-grid">
        <DbMetricCard
          tone="indigo"
          icon="database"
          label={t('Total Calls')}
          value={totalCalls.toLocaleString()}
          detail={t('calls')}
        />
        <DbMetricCard
          tone="emerald"
          icon="clock"
          label={t('Avg Latency')}
          value={formatDuration(avgLatency)}
          detail={t('weighted avg')}
        />
        <DbMetricCard
          tone={errorRate > 0 ? 'rose' : 'emerald'}
          icon="alert"
          label={t('Error Rate')}
          value={`${errorRate.toFixed(2)}%`}
          detail={`${totalErrors} ${t('failures')}`}
        />
        <DbMetricCard
          tone="amber"
          icon="peak"
          label={t('Peak Latency')}
          value={formatDuration(slowestQuery)}
          detail={t('max')}
        />
      </section>

      {/* Filter and Search Bar */}
      <div className="filter-bar db-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
        <div style={{ flex: '1', minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder={t("Search queries...")}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              transition: 'all 0.15s ease-out'
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.15)';
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border-primary)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth="2.5"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <CustomSelect
          className="db-filter-select"
          ariaLabel={t('Dialect')}
          options={systemOptions}
          value={selectedSystem}
          onChange={setSelectedSystem}
          placeholder={t("All Dialects")}
        />
        <CustomSelect
          className="db-filter-select"
          ariaLabel={t('Service')}
          options={serviceOptions}
          value={selectedService}
          onChange={setSelectedService}
          placeholder={t("All Services")}
        />
        <button className="btn btn-ghost btn-sm" onClick={loadMetrics} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', borderRadius: '8px' }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {t("Refresh")}
        </button>
      </div>

      {/* Query Performance Table */}
      <div className="card db-query-panel">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">{t("Queries & Operations")}</div>
          <span className="text-sm text-muted">{filteredMetrics.length} {t("query patterns active")}</span>
        </div>
        <div className="table-wrapper db-table-wrapper" style={{ overflowX: 'hidden' }}>
          <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: colWidths.system }}>
                  {t("System")}
                </th>
                <th style={{ width: colWidths.query }}>
                  {t("Normalized Query")}
                </th>
                <th style={{ width: colWidths.service }}>
                  {t("Service")}
                </th>
                <th style={{ width: colWidths.calls, textAlign: 'right' }}>
                  {t("Calls")}
                </th>
                <th style={{ width: colWidths.avgLatency, textAlign: 'right' }}>
                  {t("Avg Latency")}
                </th>
                <th style={{ width: colWidths.slowdown }}>
                  {t("Slowdown")}
                </th>
                <th style={{ width: colWidths.maxLatency, textAlign: 'right' }}>
                  {t("Max Latency")}
                </th>
                <th style={{ width: colWidths.errorRate, textAlign: 'right' }}>
                  {t("Error Rate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMetrics.map((m, index) => {
                const uniqueKey = `${m.query}-${m.service}-${index}`;
                const isExpanded = expandedQuery === uniqueKey;
                const pct = (m.avgDurationMs / maxAvgDuration) * 100;
                
                return (
                  <React.Fragment key={uniqueKey}>
                    <tr 
                      onClick={() => setExpandedQuery(isExpanded ? null : uniqueKey)}
                      style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                      className="hover-row"
                    >
                      <td data-label="System" style={{ width: colWidths.system, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <TechIcon name={m.system} showLabel size={18} />
                      </td>
                      <td data-label="Query" style={{ width: colWidths.query, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <code style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{m.query}</code>
                      </td>
                      <td data-label="Service" style={{ width: colWidths.service, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <LanguageIcon language={serviceLanguages[m.service]} size={16} />
                          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.service}>
                            {m.service}
                          </span>
                        </div>
                      </td>
                      <td data-label="Calls" style={{ width: colWidths.calls, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{m.callCount}</td>
                      <td data-label="Avg Latency" style={{ width: colWidths.avgLatency, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: '600', color: m.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>
                        {formatDuration(m.avgDurationMs)}
                      </td>
                      <td data-label="Slowdown" style={{ width: colWidths.slowdown, verticalAlign: 'middle' }}>
                        <div style={{ width: '100%', background: 'var(--bg-tertiary)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                          <div 
                            style={{ 
                              width: `${pct}%`, 
                              height: '100%', 
                              background: m.avgDurationMs > 200 ? 'var(--accent-amber)' : 'var(--accent-indigo)', 
                              borderRadius: '3px',
                              transition: 'width 0.4s ease'
                            }} 
                          />
                        </div>
                      </td>
                      <td data-label="Max Latency" style={{ width: colWidths.maxLatency, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {formatDuration(m.maxDurationMs)}
                      </td>
                      <td data-label="Error Rate" style={{ width: colWidths.errorRate, textAlign: 'right' }}>
                        {m.errorCount > 0 ? (
                          <span className="badge badge-error" style={{ fontSize: '11px' }}>{m.errorRate.toFixed(1)}%</span>
                        ) : (
                          <span className="badge badge-ok" style={{ fontSize: '11px' }}>0%</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg-tertiary)', padding: '16px', borderBottom: '1px solid var(--border-primary)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>Full Query Statement</span>
                              <button 
                                className="btn btn-ghost btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(m.query);
                                }}
                                style={{ padding: '2px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                                Copy SQL
                              </button>
                            </div>
                            <pre style={{ 
                              whiteSpace: 'pre-wrap', 
                              wordBreak: 'break-all', 
                              background: 'var(--bg-secondary)', 
                              padding: '12px', 
                              borderRadius: '8px', 
                              border: '1px solid var(--border-primary)',
                              fontSize: '13px',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-primary)',
                              lineHeight: '1.4'
                            }}>
                              {m.query}
                            </pre>
                            <div className="db-expanded-details" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              <div><strong>Service:</strong> {m.service}</div>
                              <div><strong>Namespace:</strong> {m.namespace || 'N/A'}</div>
                              <div><strong>Total Executions:</strong> {m.callCount}</div>
                              <div><strong>{t('Failures:')}</strong> {m.errorCount}</div>
                            </div>

                            {m.recentErrors && m.recentErrors.length > 0 && (
                              <div className="db-recent-errors" style={{ marginTop: '12px' }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '12px',
                                  fontWeight: 'bold',
                                  color: 'var(--accent-rose)',
                                  marginBottom: '8px'
                                }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-rose)' }}>
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                    <line x1="12" y1="9" x2="12" y2="13"></line>
                                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                  </svg>
                                  {t('Recent Error Messages')}
                                  <span style={{
                                    background: 'rgba(229, 62, 62, 0.15)',
                                    color: 'var(--accent-rose)',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    padding: '2px 6px',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(229, 62, 62, 0.25)'
                                  }}>
                                    {m.recentErrors.length}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {m.recentErrors.map((err, errIdx) => (
                                    <div
                                      key={errIdx}
                                      style={{
                                        borderLeft: '3px solid var(--accent-rose)',
                                        background: 'rgba(229, 62, 62, 0.06)',
                                        padding: '8px 12px',
                                        borderRadius: '0 6px 6px 0',
                                        fontSize: '12px',
                                        fontFamily: 'var(--font-mono)',
                                        color: 'var(--text-secondary)',
                                        lineHeight: '1.4',
                                        wordBreak: 'break-word',
                                        whiteSpace: 'pre-wrap'
                                      }}
                                    >
                                      {err}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filteredMetrics.length === 0 && loading && (
                <tr>
                  <td colSpan={8} className="db-loading-cell">
                    <LoadingState height={220} label={t('Loading database telemetry...')} />
                  </td>
                </tr>
              )}
              {filteredMetrics.length === 0 && !loading && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-state-icon" style={{ color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                          <path d="M3 5V19A9 3 0 0 0 21 19V5"></path>
                          <path d="M3 12A9 3 0 0 0 21 12"></path>
                        </svg>
                      </div>
                      <div className="empty-state-title">{t('No database queries found')}</div>
                      <div className="empty-state-text">
                        {t('No client spans with database tags were captured for')} {namespace ? `${t('namespace')} "${namespace}"` : t('any namespace')}.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .db-metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        .db-metric-card {
          position: relative;
          min-width: 0;
          padding: 16px;
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          background: linear-gradient(135deg, var(--bg-secondary), color-mix(in srgb, var(--bg-tertiary) 32%, var(--bg-secondary)));
          box-shadow: var(--shadow-sm);
          overflow: hidden;
          transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
        }
        .db-metric-card::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 4px;
          background: var(--accent-indigo);
        }
        .db-metric-card.emerald::before {
          background: var(--accent-emerald);
        }
        .db-metric-card.amber::before {
          background: var(--accent-amber);
        }
        .db-metric-card.rose::before {
          background: var(--accent-rose);
        }
        .db-metric-card:hover {
          border-color: var(--border-secondary);
          box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
          transform: translateY(-1px);
        }
        .db-metric-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .db-metric-top span {
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .db-metric-icon {
          width: 24px;
          height: 24px;
          padding: 7px;
          border-radius: 8px;
          color: var(--accent-indigo);
          background: rgba(99, 102, 241, 0.08);
          box-sizing: content-box;
          flex: 0 0 auto;
        }
        .db-metric-card.emerald .db-metric-icon {
          color: var(--accent-emerald);
          background: rgba(16, 185, 129, 0.09);
        }
        .db-metric-card.amber .db-metric-icon {
          color: var(--accent-amber);
          background: rgba(245, 158, 11, 0.10);
        }
        .db-metric-card.rose .db-metric-icon {
          color: var(--accent-rose);
          background: rgba(244, 63, 94, 0.10);
        }
        .db-metric-card strong {
          display: block;
          margin-top: 12px;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 29px;
          line-height: 1;
          font-weight: 850;
          white-space: nowrap;
        }
        .db-metric-card em {
          display: block;
          margin-top: 7px;
          color: var(--text-secondary);
          font-size: 11px;
          font-style: normal;
          font-weight: 700;
        }
        .db-page-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border-primary);
        }
        .db-page-hero .page-title {
          margin: 5px 0 0;
        }
        .db-page-kicker {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--accent-indigo);
          font-size: 11px;
          font-weight: 850;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .db-page-kicker::before {
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--accent-emerald);
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.12);
        }
        .db-page-scope {
          min-width: 190px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          align-items: flex-end;
          padding: 10px 12px;
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          background: var(--bg-secondary);
          box-shadow: var(--shadow-sm);
        }
        .db-page-scope span {
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }
        .db-page-scope strong {
          max-width: 210px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .db-query-panel {
          overflow: hidden;
          border-radius: 10px;
          box-shadow: var(--shadow-sm);
        }
        .db-filter-bar {
          box-shadow: var(--shadow-sm);
        }
        .db-table-wrapper {
          box-shadow: none;
          border-left: none;
          border-right: none;
          border-bottom: none;
          border-radius: 0;
        }
        .db-table thead th {
          padding: 12px 14px;
          border-bottom-width: 1px;
          background: color-mix(in srgb, var(--bg-secondary) 88%, var(--bg-tertiary) 12%);
          color: var(--text-tertiary);
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.08em;
        }
        .db-table tbody tr.hover-row {
          border-bottom: 1px solid var(--border-primary);
          box-shadow: none;
        }
        .db-table tbody tr.hover-row:hover {
          background: color-mix(in srgb, var(--accent-indigo) 5%, var(--bg-secondary) 95%) !important;
          box-shadow: inset 3px 0 0 var(--accent-indigo);
        }
        .db-table tbody tr.hover-row td {
          padding: 13px 14px;
        }
        .db-table code {
          display: inline-block;
          max-width: 100%;
          padding: 4px 7px;
          border-radius: 6px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .db-loading-cell {
          padding: 0 !important;
          cursor: default;
        }
        .badge-system-pg {
          background: rgba(43, 108, 176, 0.15) !important;
          color: #3182ce !important;
          border: 1px solid rgba(43, 108, 176, 0.3);
        }
        .badge-system-mysql {
          background: rgba(0, 117, 143, 0.15) !important;
          color: #00758f !important;
          border: 1px solid rgba(0, 117, 143, 0.3);
        }
        .badge-system-redis {
          background: rgba(229, 62, 62, 0.15) !important;
          color: #e53e3e !important;
          border: 1px solid rgba(229, 62, 62, 0.3);
        }
        .badge-system-mongo {
          background: rgba(72, 187, 120, 0.15) !important;
          color: #38a169 !important;
          border: 1px solid rgba(72, 187, 120, 0.3);
        }
        .badge-system-ch {
          background: rgba(245, 158, 11, 0.15) !important;
          color: #f59e0b !important;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .badge-system-oracle {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #ef4444 !important;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .badge-system-mssql {
          background: rgba(139, 92, 246, 0.15) !important;
          color: #8b5cf6 !important;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        .badge-system-sql {
          background: rgba(6, 182, 212, 0.15) !important;
          color: #06b6d4 !important;
          border: 1px solid rgba(6, 182, 212, 0.3);
        }
        .badge-system-generic {
          background: rgba(113, 128, 150, 0.15) !important;
          color: #4a5568 !important;
          border: 1px solid rgba(113, 128, 150, 0.3);
        }
        .hover-row:hover {
          background: var(--bg-hover) !important;
        }

        /* Responsive: filter bar stacking */
        @media (max-width: 768px) {
          .db-page-hero {
            flex-direction: column !important;
          }
          .db-metric-grid {
            grid-template-columns: 1fr 1fr;
          }
          .db-page-scope {
            width: 100%;
            align-items: flex-start;
          }
          .db-filter-bar {
            flex-direction: column !important;
          }
          .db-filter-bar > * {
            width: 100% !important;
            min-width: 0 !important;
          }
          .db-filter-bar select,
          .db-filter-bar button {
            width: 100% !important;
          }

          /* Expanded details stacking */
          .db-expanded-details {
            flex-direction: column !important;
            gap: 6px !important;
          }

          /* Table card layout on mobile */
          .db-table thead {
            display: none;
          }
          .db-table tbody,
          .db-table tbody tr {
            display: block;
            width: 100%;
          }
          .db-table tbody tr.hover-row {
            display: block;
            background: var(--bg-secondary);
            border: 1px solid var(--border-primary);
            border-radius: 10px;
            padding: 14px;
            margin-bottom: 12px;
          }
          .db-table tbody tr.hover-row td {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0 !important;
            border: none !important;
            text-align: right;
            max-width: none !important;
            white-space: normal !important;
            overflow: visible !important;
          }
          .db-table tbody tr.hover-row td::before {
            content: attr(data-label);
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--text-tertiary);
            text-align: left;
            flex-shrink: 0;
            margin-right: 12px;
          }
          /* Hide the progress bar column on mobile for cleanliness */
          .db-table tbody tr.hover-row td:nth-child(6) {
            display: none;
          }
          /* Expanded row card on mobile */
          .db-table tbody tr:not(.hover-row) td {
            display: block;
            width: 100%;
            padding: 12px !important;
          }
        }
        @media (max-width: 520px) {
          .db-metric-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Smooth error card hover */
        .db-recent-errors > div > div:hover {
          background: rgba(229, 62, 62, 0.1) !important;
        }

      `}</style>
    </div>
  );
}
