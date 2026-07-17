import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { EndpointStat, TraceListItem } from '../entities';
import { LoadingState } from '../components/DataState';
import { useTranslation } from '../utils/i18n';
import LanguageIcon from '../components/LanguageIcon';
import { useColumnResize } from '../utils/useColumnResize';

interface TraceExplorerProps {
  namespace: string;
  cluster: string;
}

const SERVICE_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#a855f7', '#d946ef', '#0ea5e9', '#10b981', '#f59e0b',
];

function getServiceColor(name: string): string {
  if (!SERVICE_COLORS[name]) {
    const idx = Object.keys(SERVICE_COLORS).length % COLOR_PALETTE.length;
    SERVICE_COLORS[name] = COLOR_PALETTE[idx];
  }
  return SERVICE_COLORS[name];
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
    <div style={{ position: 'relative', width: '100%' }} onClick={e => e.stopPropagation()}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'var(--bg-secondary)',
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isOpen ? '0 0 0 2px rgba(99, 102, 241, 0.2)' : 'none',
          borderColor: isOpen ? 'var(--accent-indigo)' : 'var(--border-primary)',
          transition: 'all 0.15s ease',
          height: '36px'
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

export default function TraceExplorer({ namespace, cluster }: TraceExplorerProps) {
  const { t } = useTranslation();
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<string[]>([]);
  const [serviceLanguages, setServiceLanguages] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'top' | 'explorer'>('top');
  const [sortBy, setSortBy] = useState<string>('impact');
  const [selectedTrace, setSelectedTrace] = useState<TraceListItem | null>(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { widths: colWidths, startResize } = useColumnResize({
    traceId: 110,
    service: 140,
    operation: 260,
    flow: 220,
    duration: 200,
    spans: 65,
    status: 65,
    time: 85,
  });

  // Filters and Pagination read directly from URL search params
  const serviceFilter = searchParams.get('service') || '';
  const errorFilter = searchParams.get('hasError') || '';
  const operationFilter = searchParams.get('operation') || '';
  const traceIdFilter = searchParams.get('traceId') || '';
  const minSpans = searchParams.get('minSpans') || '2';
  const minDuration = searchParams.get('minDuration') || '';
  const maxDuration = searchParams.get('maxDuration') || '';
  const timeRangeFilter = searchParams.get('timeRange') || '24h';
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '25');

  const serviceOptions = [
    { value: '', label: t('All Services') },
    ...services.map(s => ({ value: s, label: s }))
  ];

  const statusOptions = [
    { value: '', label: t('All Status') },
    { value: 'true', label: t('Errors Only') },
    { value: 'false', label: t('Success Only') }
  ];

  const spanOptions = [
    { value: '0', label: t('All (incl. DB noise)') },
    { value: '2', label: t('≥ 2 spans (requests)') },
    { value: '3', label: t('≥ 3 spans') },
    { value: '5', label: t('≥ 5 spans') },
    { value: '10', label: t('≥ 10 spans') }
  ];

  const timeRangeOptions = [
    { value: '15m', label: t('Last 15 minutes') },
    { value: '1h', label: t('Last 1 hour') },
    { value: '24h', label: t('Last 24 hours') },
    { value: '7d', label: t('Last 7 days') },
    { value: '30d', label: t('Last 30 days') },
    { value: '90d', label: t('Last 90 days') },
    { value: 'all', label: t('All time') }
  ];

  const topSortOptions = [
    { value: 'impact', label: t('Sort: Impact') },
    { value: 'latency', label: t('Sort: Latency (avg.)') },
    { value: 'throughput', label: t('Sort: Throughput') },
    { value: 'errors', label: t('Sort: Error rate') },
    { value: 'name', label: t('Sort: Name') },
  ];
  const explorerSortOptions = [
    { value: 'time', label: t('Sort: Newest') },
    { value: 'duration', label: t('Sort: Duration') },
    { value: 'spans', label: t('Sort: Spans') },
    { value: 'errors', label: t('Sort: Errors first') },
  ];
  const sortOptions = activeTab === 'top' ? topSortOptions : explorerSortOptions;

  const getStartTimeISO = (range: string): string => {
    let ms = 24 * 60 * 60 * 1000; // default 24h
    switch (range) {
      case '15m': ms = 15 * 60 * 1000; break;
      case '1h':  ms = 60 * 60 * 1000; break;
      case '24h': ms = 24 * 60 * 60 * 1000; break;
      case '7d':  ms = 7 * 24 * 60 * 60 * 1000; break;
      case '30d': ms = 30 * 24 * 60 * 60 * 1000; break;
      case '90d': ms = 90 * 24 * 60 * 60 * 1000; break;
      case 'all': ms = 365 * 24 * 60 * 60 * 1000; break;
    }
    return new Date(Date.now() - ms).toISOString();
  };

  const setFilterVal = (key: string, val: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) {
        next.set(key, val);
      } else {
        next.delete(key);
      }
      // Reset page to 1 whenever filters change
      if (key !== 'page' && key !== 'pageSize') {
        next.set('page', '1');
      }
      return next;
    }, { replace: true });
  };

  const setPage = (p: number) => {
    setFilterVal('page', p.toString());
  };

  const setPageSize = (ps: number) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('pageSize', ps.toString());
      next.set('page', '1');
      return next;
    }, { replace: true });
  };

  const loadTraces = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (namespace) params.namespace = namespace;
      if (cluster) params.cluster = cluster;
      if (serviceFilter) params.service = serviceFilter;
      if (errorFilter) params.hasError = errorFilter;
      if (operationFilter) params.operation = operationFilter;
      if (traceIdFilter) params.traceId = traceIdFilter;
      if (minSpans && parseInt(minSpans) > 0) params.minSpans = minSpans;
      if (minDuration && parseFloat(minDuration) > 0) params.minDuration = minDuration;
      if (maxDuration && parseFloat(maxDuration) > 0) params.maxDuration = maxDuration;
      params.startTime = getStartTimeISO(timeRangeFilter);

      if (activeTab === 'top') {
        // Top Traces is a stable server-side aggregation over the whole window,
        // so counts and endpoints don't jitter or drop between refreshes.
        params.limit = '500';
        const data = await api.getTopEndpoints(params);
        setEndpoints(data.endpoints || []);
      } else {
        params.limit = pageSize.toString();
        params.offset = ((page - 1) * pageSize).toString();
        const data = await api.getTraces(params);
        setTraces(data.traces || []);
      }
    } catch (err) {
      console.error('load traces:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace, cluster, serviceFilter, errorFilter, operationFilter, traceIdFilter, minSpans, minDuration, maxDuration, timeRangeFilter, page, pageSize, activeTab]);

  useEffect(() => { loadTraces(); }, [loadTraces]);

  useEffect(() => {
    api.getServices(namespace).then(data => {
      const svcNames = (data.services || []).map(s => s.serviceName);
      setServices([...new Set(svcNames)]);

      const langMap: Record<string, string> = {};
      (data.services || []).forEach(s => {
        if (s.language) {
          langMap[s.serviceName] = s.language;
        }
      });
      setServiceLanguages(langMap);
    }).catch(() => {});
  }, [namespace]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(loadTraces, 5000);
    return () => clearInterval(iv);
  }, [loadTraces]);

  // Reset the sort to each tab's natural default when switching tabs.
  useEffect(() => {
    setSortBy(activeTab === 'top' ? 'impact' : 'time');
  }, [activeTab]);

  // Explorer trace list with client-side sorting applied to the current page.
  const sortedTraces = useMemo(() => {
    const list = [...traces];
    switch (sortBy) {
      case 'duration': list.sort((a, b) => b.durationMs - a.durationMs); break;
      case 'spans': list.sort((a, b) => b.spanCount - a.spanCount); break;
      case 'errors': list.sort((a, b) => Number(b.hasError) - Number(a.hasError)); break;
      case 'time':
      default: list.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    }
    return list;
  }, [traces, sortBy]);

  const maxTraceDuration = traces.length > 0 ? Math.max(...traces.map(t => t.durationMs)) : 1;

  // Top Traces / endpoint view. Data is a stable server-side aggregation over
  // the whole time window, so rows and counts stay put across refreshes; here we
  // only derive display metrics (tpm/impact) and apply the chosen sort.
  const topTraces = useMemo(() => {
    const windowMin = getWindowMinutes(timeRangeFilter);
    const list = endpoints.map(e => ({
      operationName: e.operationName || '—',
      serviceName: e.serviceName,
      avgDurationMs: e.avgDurationMs,
      count: e.count,
      errorCount: e.errorCount,
      tpm: windowMin > 0 ? e.count / windowMin : 0,
      impact: e.avgDurationMs * e.count,
    }));

    switch (sortBy) {
      case 'latency': list.sort((a, b) => b.avgDurationMs - a.avgDurationMs); break;
      case 'throughput': list.sort((a, b) => b.count - a.count); break;
      case 'errors': list.sort((a, b) => (b.errorCount / (b.count || 1)) - (a.errorCount / (a.count || 1))); break;
      case 'name': list.sort((a, b) => a.operationName.localeCompare(b.operationName)); break;
      case 'impact':
      default: list.sort((a, b) => b.impact - a.impact);
    }
    return list;
  }, [endpoints, sortBy, timeRangeFilter]);

  const maxImpact = topTraces.length > 0 ? Math.max(...topTraces.map(t => t.impact)) : 1;

  // Client-side pagination for the Top Traces endpoint list.
  const topTotalPages = Math.max(1, Math.ceil(topTraces.length / pageSize));
  const topPage = Math.min(page, topTotalPages);
  const pagedTopTraces = topTraces.slice((topPage - 1) * pageSize, topPage * pageSize);

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">{t('Traces')}</h1>

      {/* Advanced Filter Bar */}
      <div className="card" style={{ marginBottom: '20px', overflow: 'visible' }}>
        <div className="card-body" style={{ padding: '16px 20px', overflow: 'visible' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Time Range')}</label>
              <CustomDropdown
                options={timeRangeOptions}
                value={timeRangeFilter}
                onChange={val => setFilterVal('timeRange', val)}
                placeholder={t('Last 24 hours')}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Service')}</label>
              <CustomDropdown
                options={serviceOptions}
                value={serviceFilter}
                onChange={val => setFilterVal('service', val)}
                placeholder={t('All Services')}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Status')}</label>
              <CustomDropdown
                options={statusOptions}
                value={errorFilter}
                onChange={val => setFilterVal('hasError', val)}
                placeholder={t('All Status')}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Operation')}</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. GET catalog"
                value={operationFilter}
                onChange={e => setFilterVal('operation', e.target.value)}
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Trace ID')}</label>
              <input
                type="text"
                className="form-input"
                placeholder={t('Search by ID...')}
                value={traceIdFilter}
                onChange={e => setFilterVal('traceId', e.target.value)}
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Min Spans')}</label>
              <CustomDropdown
                options={spanOptions}
                value={minSpans}
                onChange={val => setFilterVal('minSpans', val)}
                placeholder="≥ 2 spans (requests)"
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Min Duration')}</label>
              <input
                type="number"
                className="form-input"
                placeholder="ms"
                value={minDuration}
                onChange={e => setFilterVal('minDuration', e.target.value)}
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', display: 'block', marginBottom: '4px' }}>{t('Max Duration')}</label>
              <input
                type="number"
                className="form-input"
                placeholder="ms"
                value={maxDuration}
                onChange={e => setFilterVal('maxDuration', e.target.value)}
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: 'span 1' }}>
              <button className="btn btn-ghost btn-sm" onClick={loadTraces} style={{ width: '100%', height: '34px' }}>↻ {t('Refresh')}</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + sort chooser */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: '24px',
        borderBottom: '1px solid var(--border-primary)',
        marginBottom: '20px',
        paddingLeft: '4px'
      }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          <button
            onClick={() => setActiveTab('top')}
            style={{
              padding: '10px 0 14px 0',
              fontSize: '14px',
              fontWeight: 600,
              color: activeTab === 'top' ? 'var(--accent-indigo)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'top' ? '2px solid var(--accent-indigo)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: '-1px'
            }}
          >
            {t('Top traces')}
          </button>
          <button
            onClick={() => setActiveTab('explorer')}
            style={{
              padding: '10px 0 14px 0',
              fontSize: '14px',
              fontWeight: 600,
              color: activeTab === 'explorer' ? 'var(--accent-indigo)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'explorer' ? '2px solid var(--accent-indigo)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              marginBottom: '-1px'
            }}
          >
            {t('Explorer')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '8px', minWidth: '210px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{t('Sort by')}</span>
          <CustomDropdown
            options={sortOptions}
            value={sortBy}
            onChange={setSortBy}
            placeholder={t('Sort')}
          />
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'top' ? (
        <div className="card">
          <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <div className="card-title">{t('Top Traces & Transactions')}</div>
            <span className="text-sm text-muted">{topTraces.length} {t('endpoints')}</span>
          </div>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('Name')}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('Originating Service')}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('Latency (avg.)')}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('Traces per minute')}</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', width: '180px' }}>{t('Impact')}</th>
                </tr>
              </thead>
              <tbody>
                {topTraces.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                      {t('No trace endpoints found')}
                    </td>
                  </tr>
                ) : (
                  pagedTopTraces.map((item, idx) => {
                    const errorPct = item.count > 0 ? (item.errorCount / item.count) * 100 : 0;
                    return (
                      <tr
                        key={idx}
                        style={{ borderBottom: idx < pagedTopTraces.length - 1 ? '1px solid var(--border-primary)' : 'none' }}
                        className="hover-row"
                      >
                        <td style={{ padding: '12px 14px', maxWidth: '350px' }}>
                          <span 
                            onClick={() => {
                              setFilterVal('operation', item.operationName);
                              setActiveTab('explorer');
                            }}
                            style={{ 
                              fontSize: '13px', 
                              fontWeight: 600, 
                              color: 'var(--accent-indigo)', 
                              cursor: 'pointer',
                              wordBreak: 'break-all'
                            }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                          >
                            {item.operationName}
                          </span>
                          {errorPct > 0 && (
                            <div style={{ marginTop: '4px' }}>
                              <span style={{ 
                                fontSize: '10px', 
                                fontWeight: 600, 
                                padding: '2px 6px', 
                                borderRadius: '4px', 
                                background: 'rgba(244, 63, 94, 0.1)', 
                                color: 'var(--accent-rose)' 
                              }}>
                                {errorPct.toFixed(0)}% errors
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <LanguageIcon language={serviceLanguages[item.serviceName]} size={20} />
                            <span 
                              onClick={() => {
                                setFilterVal('service', item.serviceName);
                                setActiveTab('explorer');
                              }}
                              style={{ 
                                fontSize: '13px', 
                                fontWeight: 500, 
                                color: 'var(--text-primary)',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={e => e.currentTarget.style.color = 'var(--accent-indigo)'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-primary)'}
                            >
                              {item.serviceName}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 500 }}>
                          {formatDuration(item.avgDurationMs)}
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {item.tpm >= 1000 ? `${(item.tpm / 1000).toFixed(1)}k` : item.tpm.toFixed(1)} tpm
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                              {((item.impact / maxImpact) * 100).toFixed(0)}%
                            </span>
                            <div style={{
                              width: '100px',
                              height: '6px',
                              borderRadius: '3px',
                              background: 'var(--bg-tertiary)',
                              overflow: 'hidden'
                            }}>
                              <div style={{
                                height: '100%',
                                borderRadius: '3px',
                                width: `${Math.min(100, (item.impact / maxImpact) * 100)}%`,
                                background: 'var(--accent-indigo)'
                              }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {/* Top Traces Pagination */}
            {topTraces.length > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 20px',
                borderTop: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                fontSize: '13px',
                color: 'var(--text-secondary)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{t('Rows per page:')}</span>
                  <select
                    value={pageSize}
                    onChange={e => setPageSize(parseInt(e.target.value))}
                    style={{
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      outline: 'none',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span>{t('Page')} {topPage} / {topTotalPages}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setPage(topPage - 1)}
                      disabled={topPage <= 1}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px', height: '28px', fontSize: '12px' }}
                    >
                      ← {t('Prev')}
                    </button>
                    <button
                      onClick={() => setPage(topPage + 1)}
                      disabled={topPage >= topTotalPages}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px', height: '28px', fontSize: '12px' }}
                    >
                      {t('Next')} →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header" style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <div className="card-title">{t('Traces')}</div>
            <span className="text-sm text-muted">{traces.length} {t('traces')}</span>
          </div>
          <div className="table-wrapper">
            <table style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: colWidths.traceId, position: 'relative' }}>
                    {t('Trace ID')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'traceId')} />
                  </th>
                  <th style={{ width: colWidths.service, position: 'relative' }}>
                    {t('Root Service')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'service')} />
                  </th>
                  <th style={{ width: colWidths.operation, position: 'relative' }}>
                    {t('Operation')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'operation')} />
                  </th>
                  <th style={{ width: colWidths.flow, position: 'relative' }}>
                    {t('Request Flow')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'flow')} />
                  </th>
                  <th style={{ width: colWidths.duration, position: 'relative' }}>
                    {t('Duration')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'duration')} />
                  </th>
                  <th style={{ width: colWidths.spans, textAlign: 'center', position: 'relative' }}>
                    {t('Spans')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'spans')} />
                  </th>
                  <th style={{ width: colWidths.status, textAlign: 'center', position: 'relative' }}>
                    {t('Status')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'status')} />
                  </th>
                  <th style={{ width: colWidths.time, position: 'relative' }}>
                    {t('Time')}
                    <div className="resize-handle" onMouseDown={e => startResize(e, 'time')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedTraces.map(t => {
                  const durationPct = maxTraceDuration > 0 ? (t.durationMs / maxTraceDuration) * 100 : 0;
                  return (
                    <tr key={t.traceId} onClick={() => setSelectedTrace(t)} style={{ cursor: 'pointer' }} className="hover-row">
                      <td style={{ width: colWidths.traceId, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span className="mono" style={{ color: 'var(--accent-indigo-light)', fontSize: '12px' }}>
                          {t.traceId.slice(0, 14)}…
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, fontSize: '13px', width: colWidths.service, overflow: 'hidden' }} title={t.serviceName}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <LanguageIcon language={serviceLanguages[t.serviceName]} size={16} />
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.serviceName}</div>
                        </div>
                        {(t.namespaces && t.namespaces.length > 1) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginTop: '3px', flexWrap: 'nowrap', overflow: 'hidden' }} title={`This trace flows across ${t.namespaces.length} namespaces: ${t.namespaces.join(' → ')}`}>
                            <span style={{ fontSize: '8.5px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', background: 'rgba(139, 92, 246, 0.12)', color: '#a78bfa', border: '1px solid rgba(139, 92, 246, 0.3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                              ⇄ {t.namespaces.length} NAMESPACES
                            </span>
                            <span className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.namespaces.join(' → ')}
                            </span>
                          </div>
                        ) : (
                          <div style={{ marginTop: '3px' }}>
                            <span className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{t.namespace}</span>
                          </div>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)', width: colWidths.operation, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.rootName || '—'}>
                          {t.rootName || '—'}
                        </div>
                        {t.hasError && t.errorSummary && (
                          <div style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: '4px', 
                            marginTop: '4px', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            background: 'rgba(244, 63, 94, 0.1)', 
                            border: '1px solid rgba(244, 63, 94, 0.2)',
                            fontSize: '10.5px',
                            color: 'var(--accent-rose)',
                            fontWeight: 500,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }} title={t.errorSummary}>
                            <span style={{ 
                              textTransform: 'uppercase', 
                              fontSize: '9px', 
                              fontWeight: 700, 
                              padding: '1px 4px', 
                              borderRadius: '3px', 
                              background: 'var(--accent-rose)', 
                              color: '#ffffff',
                              marginRight: '2px',
                              flexShrink: 0
                            }}>
                              {t.errorType || 'err'}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.errorSummary}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ width: colWidths.flow, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'nowrap', overflow: 'hidden' }}>
                          {(() => {
                            const flow = t.serviceFlow && t.serviceFlow.length > 0 ? t.serviceFlow : (t.services || []);
                            const maxShow = 4;
                            const shown = flow.slice(0, maxShow);
                            const remaining = flow.length - maxShow;
                            return (
                              <>
                                {shown.map((svc, idx) => (
                                  <React.Fragment key={svc}>
                                    {idx > 0 && (
                                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 1px', flexShrink: 0 }}>→</span>
                                    )}
                                    <span
                                      style={{
                                        fontSize: '9.5px',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: getServiceColor(svc) + '20',
                                        color: getServiceColor(svc),
                                        fontWeight: 600,
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0,
                                      }}
                                      title={svc}
                                    >
                                      {svc.length > 16 ? svc.slice(0, 14) + '..' : svc}
                                    </span>
                                  </React.Fragment>
                                ))}
                                {remaining > 0 && (
                                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 600, marginLeft: '2px', flexShrink: 0 }}>+{remaining}</span>
                                )}
                                {(t.thirdPartyTools || []).slice(0, 2).map(tool => {
                                  const isDB = ['postgresql', 'mysql', 'redis', 'mongodb', 'clickhouse', 'elasticsearch'].some(k => tool.toLowerCase().includes(k));
                                  const isMQ = ['kafka', 'rabbitmq', 'nats'].some(k => tool.toLowerCase().includes(k));
                                  const icon = isDB ? '⬦' : isMQ ? '⇋' : '↗';
                                  return (
                                    <React.Fragment key={tool}>
                                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 1px', flexShrink: 0 }}>→</span>
                                      <span
                                        style={{
                                          fontSize: '9.5px',
                                          padding: '1px 5px',
                                          borderRadius: '3px',
                                          background: isDB ? 'rgba(14, 165, 233, 0.1)' : isMQ ? 'rgba(168, 85, 247, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                          color: isDB ? 'var(--accent-cyan)' : isMQ ? '#a855f7' : 'var(--accent-amber)',
                                          fontWeight: 600,
                                          whiteSpace: 'nowrap',
                                          border: `1px solid ${isDB ? 'rgba(14, 165, 233, 0.15)' : isMQ ? 'rgba(168, 85, 247, 0.15)' : 'rgba(245, 158, 11, 0.2)'}`,
                                          flexShrink: 0,
                                        }}
                                        title={tool}
                                      >
                                        {icon} {tool.length > 10 ? tool.slice(0, 9) + '..' : tool}
                                      </span>
                                    </React.Fragment>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td style={{ width: colWidths.duration }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            flex: 1,
                            height: '6px',
                            borderRadius: '3px',
                            background: 'var(--bg-tertiary)',
                            overflow: 'hidden',
                          }}>
                            <div style={{
                              width: `${Math.max(2, durationPct)}%`,
                              height: '100%',
                              borderRadius: '3px',
                              background: t.hasError
                                ? 'linear-gradient(90deg, #f43f5e, #e11d48)'
                                : t.durationMs > 5000
                                  ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                                  : t.durationMs > 1000
                                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                    : t.durationMs > 100
                                      ? 'linear-gradient(90deg, #6366f1, #8b5cf6)'
                                      : 'linear-gradient(90deg, #22c55e, #10b981)',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <span className="mono" style={{ fontSize: '12px', minWidth: '55px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {formatDuration(t.durationMs)}
                          </span>
                        </div>
                      </td>
                      <td style={{ width: colWidths.spans, textAlign: 'center' }}>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: t.spanCount >= 10 ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-tertiary)',
                          color: t.spanCount >= 10 ? '#818cf8' : 'var(--text-secondary)',
                        }}>
                          {t.spanCount}
                        </span>
                      </td>
                      <td style={{ width: colWidths.status, textAlign: 'center' }}>
                        <span className={`badge ${t.hasError ? 'badge-error' : 'badge-ok'}`}>{t.hasError ? 'ERR' : 'OK'}</span>
                      </td>
                      <td className="text-sm text-muted" style={{ width: colWidths.time, whiteSpace: 'nowrap' }}>{formatTime(t.startTime)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {loading && traces.length === 0 && (
              <LoadingState height={260} label={t("Searching traces…")} />
            )}
            {traces.length === 0 && !loading && (
              <div className="empty-state" style={{ padding: '60px' }}>
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <div className="empty-state-title">{t("No traces found")}</div>
                <div className="empty-state-text">{t("Adjust your filters or wait for new traces to arrive")}</div>
              </div>
            )}

            {/* Pagination Controls */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 20px',
              borderTop: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)',
              fontSize: '13px',
              color: 'var(--text-secondary)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{t('Rows per page:')}</span>
                <select
                  value={pageSize}
                  onChange={e => setPageSize(parseInt(e.target.value))}
                  style={{
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-primary)',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    outline: 'none',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span>
                  {t('Page')} {page}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px', height: '28px', fontSize: '12px' }}
                  >
                    ← {t('Prev')}
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={traces.length < pageSize}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '4px', height: '28px', fontSize: '12px' }}
                  >
                    {t('Next')} →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedTrace && (
        <TraceQuickLook
          trace={selectedTrace}
          serviceLanguages={serviceLanguages}
          onClose={() => setSelectedTrace(null)}
          onOpenFull={() => { const id = selectedTrace.traceId; setSelectedTrace(null); navigate(`/traces/${id}`); }}
        />
      )}
    </div>
  );
}

// Quick-look modal shown when a trace row is selected in the Explorer.
function TraceQuickLook({
  trace,
  serviceLanguages,
  onClose,
  onOpenFull,
}: {
  trace: TraceListItem;
  serviceLanguages: Record<string, string>;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const { t } = useTranslation();
  const flow = trace.serviceFlow && trace.serviceFlow.length > 0 ? trace.serviceFlow : (trace.services || []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Stat = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--text-primary)' }}>{value}</span>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ width: '560px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <LanguageIcon language={serviceLanguages[trace.serviceName]} size={22} />
            <div style={{ minWidth: 0 }}>
              <h3 className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trace.rootName || trace.serviceName}</h3>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{trace.serviceName}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <Stat label={t('Duration')} value={formatDuration(trace.durationMs)} color={trace.durationMs > 1000 ? 'var(--accent-amber)' : 'var(--text-primary)'} />
            <Stat label={t('Spans')} value={trace.spanCount} />
            <Stat label={t('Status')} value={trace.hasError ? 'ERROR' : 'OK'} color={trace.hasError ? 'var(--accent-rose)' : 'var(--accent-emerald)'} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{t('Trace ID')}</span>
            <span className="mono" style={{ fontSize: '12px', color: 'var(--accent-indigo-light)', wordBreak: 'break-all' }}>{trace.traceId}</span>
          </div>

          {(trace.namespaces && trace.namespaces.length > 0 ? trace.namespaces : [trace.namespace]).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{t('Namespaces')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(trace.namespaces && trace.namespaces.length > 0 ? trace.namespaces : [trace.namespace]).filter(Boolean).map(ns => (
                  <span key={ns} className="mono" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: 'rgba(99, 102, 241, 0.08)', color: 'var(--accent-indigo-light)', border: '1px solid rgba(99, 102, 241, 0.18)' }}>{ns}</span>
                ))}
              </div>
            </div>
          )}

          {flow.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{t('Request Flow')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                {flow.map((svc, idx) => (
                  <React.Fragment key={svc + idx}>
                    {idx > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>→</span>}
                    <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '5px', background: getServiceColor(svc) + '20', color: getServiceColor(svc), fontWeight: 600 }}>{svc}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {trace.hasError && trace.errorSummary && (
            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.2)' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-rose)', display: 'block', marginBottom: '4px' }}>{trace.errorType || t('Error')}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{trace.errorSummary}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>{t('Close')}</button>
          <button className="btn btn-primary" onClick={onOpenFull}>{t('View full trace')}</button>
        </div>
      </div>
    </div>
  );
}

function getWindowMinutes(range: string): number {
  switch (range) {
    case '15m': return 15;
    case '1h': return 60;
    case '24h': return 24 * 60;
    case '7d': return 7 * 24 * 60;
    case '30d': return 30 * 24 * 60;
    case '90d': return 90 * 24 * 60;
    case 'all': return 365 * 24 * 60;
    default: return 24 * 60;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString();
}
