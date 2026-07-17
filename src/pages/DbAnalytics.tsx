import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { DatabaseQueryMetric } from '../entities';
import { useTranslation } from '../utils/i18n';
import TechIcon from '../components/TechIcon';
import LanguageIcon from '../components/LanguageIcon';
import { useColumnResize } from '../utils/useColumnResize';

interface DbAnalyticsProps {
  namespace: string;
}

function CustomDropdown({
  options,
  value,
  onChange,
  placeholder
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentOption = options.find(o => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    const handleClose = () => setIsOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', minWidth: '200px' }} onClick={e => e.stopPropagation()}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'var(--bg-secondary)',
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '8px 14px',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isOpen ? '0 0 0 2px rgba(99, 102, 241, 0.2)' : 'none',
          borderColor: isOpen ? 'var(--accent-indigo)' : 'var(--border-primary)',
          transition: 'all 0.15s ease'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentOption ? currentOption.label : placeholder}
        </span>
        <svg 
          viewBox="0 0 24 24" 
          width="14" 
          height="14" 
          fill="none" 
          stroke="var(--text-secondary)" 
          strokeWidth="2.5" 
          style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'none', 
            transition: 'transform 0.15s ease',
            flexShrink: 0
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div 
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-lg), 0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            zIndex: 100,
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '4px',
            animation: 'fadeIn 0.1s ease-out'
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                color: value === opt.value ? 'var(--accent-indigo)' : 'var(--text-primary)',
                background: value === opt.value ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.12s'
              }}
              onMouseEnter={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                {opt.label}
              </span>
              {value === opt.value && (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent-indigo)" strokeWidth="3" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
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

  // Resizable columns — drag steals width from the neighbour, keeping the
  // table within its border.
  const { widths: colWidths, startResize } = useColumnResize({
    system: 130,
    query: 300,
    service: 170,
    calls: 70,
    avgLatency: 95,
    slowdown: 110,
    maxLatency: 95,
    errorRate: 85,
  });

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
    <div className="animate-fade-in">
      <h1 className="page-title">{t('Query Performance')}</h1>
      <p className="page-subtitle">
        {t('Analyze query performance, database engines, and call metrics across all clusters')}
      </p>

      {/* Grid of Key Metrics */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* Card 1: Total DB Calls */}
        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-indigo)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(99, 102, 241, 0.03) 100%)',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em' }}>{t('Total Calls')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--accent-indigo)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M3 5V19A9 3 0 0 0 21 19V5"></path>
                <path d="M3 12A9 3 0 0 0 21 12"></path>
              </svg>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1 }}>
              {totalCalls.toLocaleString()}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{t('Aggregate trace operations')}</span>
          </div>
        </div>

        {/* Card 2: Avg Response Time */}
        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-emerald)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(16, 185, 129, 0.03) 100%)',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em' }}>{t('Avg Latency')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1 }}>
              {formatDuration(avgLatency)}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{t('Weighted execution avg')}</span>
          </div>
        </div>

        {/* Card 3: DB Error Rate */}
        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: `4px solid ${errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}`,
          background: `linear-gradient(135deg, var(--bg-secondary) 0%, ${errorRate > 0 ? 'rgba(244, 63, 94, 0.03)' : 'rgba(16, 185, 129, 0.03)'} 100%)`,
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em' }}>{t('Error Rate')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: errorRate > 0 ? 'rgba(244, 63, 94, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-primary)', lineHeight: 1 }}>
              {errorRate.toFixed(2)}%
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{totalErrors} {t('failed statements')}</span>
          </div>
        </div>

        {/* Card 4: Worst Latency */}
        <div className="card" style={{
          position: 'relative',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          borderLeft: '4px solid var(--accent-amber)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(245, 158, 11, 0.03) 100%)',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.05em' }}>{t('Peak Latency')}</span>
            <div style={{ padding: '6px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 22 22 22"></polygon>
                <line x1="12" y1="9" x2="12" y2="17"></line>
              </svg>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: slowestQuery > 500 ? 'var(--accent-amber)' : 'var(--text-primary)', lineHeight: 1 }}>
              {formatDuration(slowestQuery)}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>{t('Peak statement duration')}</span>
          </div>
        </div>
      </div>

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
        <CustomDropdown
          options={systemOptions}
          value={selectedSystem}
          onChange={setSelectedSystem}
          placeholder={t("All Dialects")}
        />
        <CustomDropdown
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
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">{t("Queries & Operations")}</div>
          <span className="text-sm text-muted">{filteredMetrics.length} {t("query patterns active")}</span>
        </div>
        <div className="table-wrapper" style={{ overflowX: 'auto' }}>
          <table className="db-table" style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: colWidths.system, position: 'relative' }}>
                  {t("System")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'system')} />
                </th>
                <th style={{ width: colWidths.query, position: 'relative' }}>
                  {t("Normalized Query")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'query')} />
                </th>
                <th style={{ width: colWidths.service, position: 'relative' }}>
                  {t("Service")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'service')} />
                </th>
                <th style={{ width: colWidths.calls, textAlign: 'right', position: 'relative' }}>
                  {t("Calls")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'calls')} />
                </th>
                <th style={{ width: colWidths.avgLatency, textAlign: 'right', position: 'relative' }}>
                  {t("Avg Latency")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'avgLatency')} />
                </th>
                <th style={{ width: colWidths.slowdown, position: 'relative' }}>
                  {t("Slowdown")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'slowdown')} />
                </th>
                <th style={{ width: colWidths.maxLatency, textAlign: 'right', position: 'relative' }}>
                  {t("Max Latency")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'maxLatency')} />
                </th>
                <th style={{ width: colWidths.errorRate, textAlign: 'right', position: 'relative' }}>
                  {t("Error Rate")}
                  <div className="resize-handle" onMouseDown={e => startResize(e, 'errorRate')} />
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

        /* Smooth error card hover */
        .db-recent-errors > div > div:hover {
          background: rgba(229, 62, 62, 0.1) !important;
        }

      `}</style>
    </div>
  );
}
