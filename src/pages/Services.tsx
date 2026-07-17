import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ServiceStats } from '../entities';
import LanguageIcon from '../components/LanguageIcon';
import { useTranslation } from '../utils/i18n';
import { useColumnResize } from '../utils/useColumnResize';

interface ServicesProps {
  namespace: string;
}

type ServiceHealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown' | string;

interface AggregatedService {
  key: string; // project:serviceName
  serviceName: string;
  project: string;
  language?: string;
  environments: string[];
  requestCount: number;
  errorCount: number;
  errorRate: number;
  healthScore: number;
  apdex: number;
  status: ServiceHealthStatus;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  latencyHistory: number[];
  throughputHistory: number[];
  errorsHistory: number[];
}

// Premium Sparkline SVG renderer with filled gradient area
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const gradientId = React.useId();

  if (!data || data.length < 2) {
    return (
      <svg width="55" height="20" viewBox="0 0 55 20" style={{ opacity: 0.3, marginRight: '8px' }}>
        <line x1="0" y1="10" x2="55" y2="10" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="2,2" />
      </svg>
    );
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  
  const width = 55;
  const height = 20;
  const padding = 2;
  
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - padding - ((val - min) / range) * (height - 2 * padding);
    return { x, y };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  // Use a unique ID for gradients to prevent overlap
  const gradId = `spark-grad-${color.replace('#', '')}-${gradientId.replace(/:/g, '')}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible', marginRight: '8px' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Format duration
const formatDuration = (ms: number): string => {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
};

// Format throughput
const formatThroughput = (count: number): string => {
  const tpm = count / 5;
  if (tpm < 1) return `${(tpm * 60).toFixed(1)} tph`;
  if (tpm >= 1000) return `${(tpm / 1000).toFixed(1)}k tpm`;
  return `${tpm.toFixed(1)} tpm`;
};

// Helper to extract project prefix from namespace (e.g. econtract-dev -> project: econtract, env: dev)
const getProjectName = (ns: string): string => {
  const dashIdx = ns.indexOf('-');
  if (dashIdx !== -1) {
    return ns.slice(0, dashIdx);
  }
  return ns;
};

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const inferHealthScore = (requestCount: number, errorRate: number, p95Ms: number, p99Ms: number) => {
  if (requestCount <= 0) return 100;
  const latencyPenalty = Math.min(30, Math.max(0, p95Ms - 300) / 30) + Math.min(15, Math.max(0, p99Ms - 1200) / 120);
  const errorPenalty = Math.min(70, errorRate * 4.5);
  return clamp(100 - latencyPenalty - errorPenalty, 0, 100);
};

const inferApdex = (requestCount: number, errorRate: number, p50Ms: number, p95Ms: number, p99Ms: number) => {
  if (requestCount <= 0) return 1;
  let score = 1;
  if (p50Ms > 300) score -= Math.min(0.3, ((p50Ms - 300) / 300) * 0.2);
  if (p95Ms > 300) score -= Math.min(0.25, ((p95Ms - 300) / 900) * 0.25);
  if (p95Ms > 1200) score -= Math.min(0.25, ((p95Ms - 1200) / 1200) * 0.25);
  if (p99Ms > 2400) score -= Math.min(0.1, ((p99Ms - 2400) / 2400) * 0.1);
  return clamp(score - Math.min(0.4, (errorRate / 100) * 0.75), 0, 1);
};

const inferStatus = (requestCount: number, healthScore: number): ServiceHealthStatus => {
  if (requestCount <= 0) return 'unknown';
  if (healthScore >= 90) return 'healthy';
  if (healthScore >= 70) return 'degraded';
  return 'critical';
};

const getServiceHealth = (service: ServiceStats, errorRate: number) => {
  const healthScore = finiteNumber(service.healthScore)
    ? service.healthScore
    : inferHealthScore(service.requestCount, errorRate, service.p95Ms, service.p99Ms);
  const apdex = finiteNumber(service.apdex)
    ? service.apdex
    : inferApdex(service.requestCount, errorRate, service.p50Ms, service.p95Ms, service.p99Ms);

  return {
    healthScore: clamp(healthScore, 0, 100),
    apdex: clamp(apdex, 0, 1),
    status: service.status || inferStatus(service.requestCount, healthScore),
  };
};

const statusRank: Record<string, number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  critical: 3,
};

const worstStatus = (current: ServiceHealthStatus, next: ServiceHealthStatus): ServiceHealthStatus => {
  return (statusRank[next] || 0) > (statusRank[current] || 0) ? next : current;
};

const healthTone = (status: ServiceHealthStatus, score: number) => {
  if (status === 'unknown') {
    return { color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', border: 'var(--border-primary)', label: 'No traffic' };
  }
  if (status === 'critical' || score < 70) {
    return { color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.10)', border: 'rgba(244, 63, 94, 0.22)', label: 'Critical' };
  }
  if (status === 'degraded' || score < 90) {
    return { color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.22)', label: 'Degraded' };
  }
  return { color: 'var(--accent-emerald)', background: 'rgba(16, 185, 129, 0.10)', border: 'rgba(16, 185, 129, 0.22)', label: 'Healthy' };
};

type SortField = 'name' | 'environments' | 'health' | 'latency' | 'throughput' | 'errorRate';
type SortDir = 'asc' | 'desc';

export default function Services({ namespace }: ServicesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('throughput');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [aggregatedServices, setAggregatedServices] = useState<Record<string, AggregatedService>>({});

  // Resizable column widths (drag steals width from the neighbour so the
  // table always stays within its border).
  const { widths: colWidths, startResize } = useColumnResize({
    name: 300,
    environments: 340,
    health: 180,
    latency: 220,
    throughput: 200,
    errorRate: 240,
  });

  const loadServices = useCallback(async () => {
    try {
      const res = await api.getServices(namespace || undefined);
      const rawList = (res.services || []).filter(s => !s.isInfrastructure);

      // Group services by BOTH project prefix and serviceName to avoid mixing different projects' gateways
      const groups: Record<string, {
        key: string;
        serviceName: string;
        project: string;
        language?: string;
        environments: string[];
        requestCount: number;
        errorCount: number;
        latencyWeight: number;
        p50MsTotal: number;
        p95MsTotal: number;
        p99MsTotal: number;
        healthWeight: number;
        healthScoreTotal: number;
        apdexTotal: number;
        status: ServiceHealthStatus;
      }> = {};

      for (const s of rawList) {
        const proj = getProjectName(s.namespace);
        const groupKey = `${proj}:${s.serviceName}`;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            serviceName: s.serviceName,
            project: proj,
            language: s.language,
            environments: [],
            requestCount: 0,
            errorCount: 0,
            latencyWeight: 0,
            p50MsTotal: 0,
            p95MsTotal: 0,
            p99MsTotal: 0,
            healthWeight: 0,
            healthScoreTotal: 0,
            apdexTotal: 0,
            status: 'unknown',
          };
        }
        const g = groups[groupKey];
        const weight = Math.max(s.requestCount, 1);
        const serviceErrorRate = s.requestCount > 0 ? (s.errorCount / s.requestCount) * 100 : s.errorRate;
        const serviceHealth = getServiceHealth(s, serviceErrorRate);

        if (s.language && !g.language) {
          g.language = s.language;
        }
        if (!g.environments.includes(s.namespace)) {
          g.environments.push(s.namespace);
        }
        g.requestCount += s.requestCount;
        g.errorCount += s.errorCount;
        g.latencyWeight += weight;
        g.p50MsTotal += s.p50Ms * weight;
        g.p95MsTotal += s.p95Ms * weight;
        g.p99MsTotal += s.p99Ms * weight;
        g.healthWeight += weight;
        g.healthScoreTotal += serviceHealth.healthScore * weight;
        g.apdexTotal += serviceHealth.apdex * weight;
        g.status = worstStatus(g.status, serviceHealth.status);
      }

      // Read cache from localStorage
      let cache: Record<string, AggregatedService> = {};
      try {
        const cachedStr = localStorage.getItem('accumulatedServicesV2');
        if (cachedStr) {
          cache = JSON.parse(cachedStr);
        }
      } catch (e) {
        console.error('Failed to parse cached accumulated services:', e);
      }

      const nextAggregated: Record<string, AggregatedService> = {};

      Object.values(groups).forEach(g => {
        const avgP50 = g.latencyWeight > 0 ? g.p50MsTotal / g.latencyWeight : 0;
        const avgP95 = g.latencyWeight > 0 ? g.p95MsTotal / g.latencyWeight : 0;
        const avgP99 = g.latencyWeight > 0 ? g.p99MsTotal / g.latencyWeight : 0;
        const healthScore = g.healthWeight > 0 ? g.healthScoreTotal / g.healthWeight : 100;
        const apdex = g.healthWeight > 0 ? g.apdexTotal / g.healthWeight : 1;
        const status = g.requestCount > 0 ? g.status : 'unknown';
        const computedErrorRate = g.requestCount > 0 ? (g.errorCount / g.requestCount) * 100 : 0;

        let latencyHistory: number[] = [];
        let throughputHistory: number[] = [];
        let errorsHistory: number[] = [];

        const prevItem = cache[g.key];
        if (prevItem && prevItem.latencyHistory && prevItem.latencyHistory.length > 0) {
          latencyHistory = [...prevItem.latencyHistory].slice(-9).concat(avgP50);
          throughputHistory = [...prevItem.throughputHistory].slice(-9).concat(g.requestCount);
          errorsHistory = [...prevItem.errorsHistory].slice(-9).concat(computedErrorRate);
        } else {
          latencyHistory = [avgP50];
          throughputHistory = [g.requestCount];
          errorsHistory = [computedErrorRate];
        }

        nextAggregated[g.key] = {
          key: g.key,
          serviceName: g.serviceName,
          project: g.project,
          language: g.language,
          environments: g.environments,
          requestCount: g.requestCount,
          errorCount: g.errorCount,
          errorRate: computedErrorRate,
          healthScore,
          apdex,
          status,
          p50Ms: avgP50,
          p95Ms: avgP95,
          p99Ms: avgP99,
          latencyHistory,
          throughputHistory,
          errorsHistory,
        };
      });

      setAggregatedServices(nextAggregated);

      try {
        localStorage.setItem('accumulatedServicesV2', JSON.stringify(nextAggregated));
      } catch (err) {
        console.error('Failed to cache accumulated services:', err);
      }

    } catch (err) {
      console.error('loadServices error:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    setLoading(true);
    loadServices();
    const interval = setInterval(loadServices, 5000);
    return () => clearInterval(interval);
  }, [loadServices]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'environments' ? 'asc' : 'desc');
    }
  };

  const servicesList = useMemo(() => Object.values(aggregatedServices), [aggregatedServices]);

  const sorted = useMemo(() => {
    let filtered = servicesList.filter(s =>
      s.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.environments.some(env => env.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.serviceName.localeCompare(b.serviceName); break;
        case 'environments': cmp = a.environments.length - b.environments.length; break;
        case 'health': cmp = a.healthScore - b.healthScore; break;
        case 'latency': cmp = a.p50Ms - b.p50Ms; break;
        case 'throughput': cmp = a.requestCount - b.requestCount; break;
        case 'errorRate': cmp = a.errorRate - b.errorRate; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [servicesList, searchTerm, sortField, sortDir]);

  const SortHeader = ({ field, label, align, colKey }: { field: SortField; label: string; align?: string; colKey: keyof typeof colWidths }) => (
    <th
      onClick={() => handleSort(field)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        textAlign: (align as any) || 'left',
        padding: '12px 14px',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: sortField === field ? 'var(--accent-indigo)' : 'var(--text-secondary)',
        borderBottom: '1px solid var(--border-primary)',
        whiteSpace: 'nowrap',
        position: 'sticky',
        top: 0,
        width: colWidths[colKey],
        background: 'var(--bg-primary)',
        zIndex: 2,
      }}
    >
      {label}
      {sortField === field && (
        <span style={{ marginLeft: '4px', fontSize: '10px' }}>
          {sortDir === 'asc' ? '↑' : '↓'}
        </span>
      )}
      <div className="resize-handle" onClick={e => e.stopPropagation()} onMouseDown={e => startResize(e, colKey)} />
    </th>
  );

  if (loading && servicesList.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{
          width: '36px', height: '36px',
          border: '3px solid rgba(99, 102, 241, 0.15)',
          borderTopColor: 'var(--accent-indigo)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1400px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{
          fontSize: '22px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
          letterSpacing: '-0.02em',
        }}>
          Services
        </h1>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ position: 'relative', maxWidth: '400px' }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Filter services..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 36px',
              fontSize: '13px',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '8px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border-primary)',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <SortHeader field="name" label="Name" colKey="name" />
                <SortHeader field="environments" label="Environment" colKey="environments" />
                <SortHeader field="health" label="Health" align="right" colKey="health" />
                <SortHeader field="latency" label="Latency (avg.)" align="right" colKey="latency" />
                <SortHeader field="throughput" label="Throughput" align="right" colKey="throughput" />
                <SortHeader field="errorRate" label="Failed transaction rate" align="right" colKey="errorRate" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    No services found
                  </td>
                </tr>
              ) : (
                sorted.map((svc, idx) => {
                  const errorPct = svc.errorRate;
                  const tone = healthTone(svc.status, svc.healthScore);

                  return (
                    <tr
                      key={svc.key}
                      onClick={() => navigate(`/traces?service=${encodeURIComponent(svc.serviceName)}`)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: idx < sorted.length - 1 ? '1px solid var(--border-primary)' : 'none',
                        transition: 'background 0.12s ease',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Name with language icon */}
                      <td style={{ padding: '14px 14px', width: colWidths.name, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <LanguageIcon language={svc.language} size={20} />
                          <span style={{
                            fontSize: '13.5px',
                            fontWeight: 600,
                            color: 'var(--accent-indigo)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }} title={svc.serviceName}>
                            {svc.serviceName}
                          </span>
                        </div>
                      </td>

                      {/* Environment Badges */}
                      <td style={{ padding: '14px 14px', width: colWidths.environments }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                          {svc.environments.length > 1 && (
                            <span style={{
                              fontSize: '11px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: 'var(--bg-tertiary)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-primary)',
                              fontWeight: 600
                            }}>
                              {svc.environments.length} environments
                            </span>
                          )}
                          {svc.environments.map(env => (
                            <span key={env} style={{
                              fontSize: '11px',
                              padding: '2px 7px',
                              borderRadius: '5px',
                              background: 'rgba(99, 102, 241, 0.06)',
                              color: 'var(--accent-indigo-light)',
                              border: '1px solid rgba(99, 102, 241, 0.15)',
                            }}>
                              {env}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Health */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', width: colWidths.health }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                            <span style={{
                              fontSize: '13px',
                              fontWeight: 700,
                              color: tone.color,
                              fontFamily: 'var(--font-mono)',
                            }}>
                              {svc.status === 'unknown' ? '--' : svc.healthScore.toFixed(0)}
                            </span>
                            <span style={{ fontSize: '10.5px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                              {svc.apdex.toFixed(2)}
                            </span>
                          </div>
                          <span style={{
                            fontSize: '10.5px',
                            padding: '3px 7px',
                            borderRadius: '999px',
                            background: tone.background,
                            color: tone.color,
                            border: `1px solid ${tone.border}`,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}>
                            {tone.label}
                          </span>
                        </div>
                      </td>

                      {/* Latency with Sparkline */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', width: colWidths.latency }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: svc.p50Ms > 1000 ? 'var(--accent-amber)' : 'var(--text-primary)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {formatDuration(svc.p50Ms)}
                          </span>
                          <Sparkline
                            data={svc.latencyHistory}
                            color="#3b82f6"
                          />
                        </div>
                      </td>

                      {/* Throughput */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', width: colWidths.throughput }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-mono)',
                          }}>
                            {formatThroughput(svc.requestCount)}
                          </span>
                          <Sparkline
                            data={svc.throughputHistory}
                            color="#10b981"
                          />
                        </div>
                      </td>

                      {/* Failed Transaction Rate (Error rate) */}
                      <td style={{ padding: '14px 14px', textAlign: 'right', width: colWidths.errorRate }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            color: errorPct > 5 ? 'var(--accent-rose)' : errorPct > 0 ? 'var(--accent-amber)' : 'var(--text-tertiary)',
                          }}>
                            {errorPct > 0 ? `${errorPct.toFixed(1)}%` : '0.0%'}
                          </span>
                          <Sparkline
                            data={svc.errorsHistory}
                            color="#ef4444"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
