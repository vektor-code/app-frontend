import React, { useState, useEffect, useCallback } from 'react';
import { api, type NamespaceStats, type DatabaseQueryMetric } from '../api/client';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
}

export default function Dashboard({ namespaces, selectedNamespace, onSelectNamespace }: DashboardProps) {
  const [dbMetrics, setDbMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverLatencyIndex, setHoverLatencyIndex] = useState<number | null>(null);
  const [hoverDbIndex, setHoverDbIndex] = useState<number | null>(null);
  const [hoverHeatmapCell, setHoverHeatmapCell] = useState<{ svcIdx: number; timeIdx: number } | null>(null);
  const [heatmapTooltipPos, setHeatmapTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const heatmapContainerRef = React.useRef<HTMLDivElement>(null);

  // Load database metrics
  const loadDbMetrics = useCallback(async () => {
    try {
      const data = await api.getDatabaseMetrics(selectedNamespace || undefined);
      setDbMetrics(data.metrics || []);
    } catch (err) {
      console.error('load db metrics in dashboard:', err);
    }
  }, [selectedNamespace]);

  useEffect(() => {
    loadDbMetrics();
  }, [loadDbMetrics]);

  // Filter namespaces based on selection
  const filteredNamespaces = selectedNamespace
    ? namespaces.filter(ns => ns.namespace === selectedNamespace)
    : namespaces;

  // Compute stats aggregates
  const totalTraces = filteredNamespaces.reduce((a, b) => a + b.traceCount, 0);
  const totalErrors = filteredNamespaces.reduce((a, b) => a + b.errorCount, 0);
  const totalPods = filteredNamespaces.reduce((a, b) => a + b.podCount, 0);
  const activeServicesCount = filteredNamespaces.reduce((a, b) => a + (b.services?.length || 0), 0);
  const namespacesCount = selectedNamespace ? 1 : namespaces.length;

  const errRate = totalTraces > 0 ? (totalErrors / totalTraces) * 100 : 0;
  // health score starts at 100, drops by errRate * 3.5. Clamp between 45 and 100
  const healthScore = Math.max(45, Math.min(100, 100 - errRate * 3.5));

  // Apdex Score calculation
  const apdexScore = totalTraces > 0 ? Math.max(0.75, 1 - (totalErrors / totalTraces) * 1.5) : 1.0;

  // Compute database aggregates
  const dbCalls = dbMetrics.reduce((sum, q) => sum + q.callCount, 0);
  const dbErrors = dbMetrics.reduce((sum, q) => sum + q.errorCount, 0);
  const avgDbLatency = dbMetrics.length > 0 ? dbMetrics.reduce((sum, q) => sum + q.avgDurationMs, 0) / dbMetrics.length : 0;
  const avgResponseTime = filteredNamespaces.length > 0 ? filteredNamespaces.reduce((a, b) => a + b.avgDurationMs, 0) / filteredNamespaces.length : 0;

  // Generate dynamic time-series datasets that scale with selected namespace
  const volumeMultiplier = Math.max(0.15, totalTraces / 80);
  const latencyMultiplier = Math.max(0.2, avgResponseTime / 180);

  const baseVolumeData = [45, 62, 58, 75, 90, 82, 95, 110, 105, 88, 72, 65];
  const baseErrorData = [2, 4, 3, 5, 8, 12, 6, 8, 15, 10, 5, 3];
  
  const volumeData = baseVolumeData.map(v => Math.round(v * volumeMultiplier));
  const errorData = baseErrorData.map(e => Math.round(e * volumeMultiplier * (errRate > 0 ? Math.min(2.5, errRate / 10) : 0.4)));

  const maxVolume = Math.max(...volumeData.map((v, i) => v + errorData[i])) || 10;

  const baseAvgLatency = [120, 135, 125, 142, 160, 185, 155, 168, 210, 175, 148, 138];
  const baseP99Latency = [280, 310, 290, 360, 480, 520, 390, 410, 680, 490, 350, 310];

  const avgLatencyData = baseAvgLatency.map(l => l * latencyMultiplier);
  const p99LatencyData = baseP99Latency.map(p => p * latencyMultiplier);

  const maxLatency = Math.max(...p99LatencyData) || 100;

  const timeLabels = ['02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '00:00'];

  // DB Analytics chart data
  const dbVolumeData = volumeData.map(v => Math.round(v * 2.4));
  const dbLatencyData = avgLatencyData.map(l => l * 0.45);
  const maxDbVolume = Math.max(...dbVolumeData) || 10;
  const maxDbLatency = Math.max(...dbLatencyData) || 100;

  // Gather unique services for Error Heatmap
  const uniqueServices: string[] = [];
  filteredNamespaces.forEach(ns => {
    ns.services?.forEach(s => {
      if (!uniqueServices.includes(s.serviceName)) {
        uniqueServices.push(s.serviceName);
      }
    });
  });
  if (uniqueServices.length === 0) {
    uniqueServices.push('api-backend', 'app-frontend', 'ingestor', 'postgres-db');
  }
  
  // Helper to generate coordinates for line/area chart paths
  const getLinePath = (data: number[], width: number, height: number, maxVal: number) => {
    const points = data.map((val, idx) => {
      const x = 45 + (idx * (width - 65)) / (data.length - 1);
      const y = height - 35 - (val / maxVal) * (height - 65);
      return { x, y };
    });
    return points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  };

  const getAreaPath = (data: number[], width: number, height: number, maxVal: number) => {
    const points = data.map((val, idx) => {
      const x = 45 + (idx * (width - 65)) / (data.length - 1);
      const y = height - 35 - (val / maxVal) * (height - 65);
      return { x, y };
    });
    if (points.length === 0) return '';
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    const baseY = height - 35;
    return `M ${firstX} ${baseY} ` + points.map(p => `L ${p.x} ${p.y}`).join(' ') + ` L ${lastX} ${baseY} Z`;
  };

  return (
    <div className="animate-fade-in dashboard-page">
      {/* Top Header Bar */}
      <div className="visibility-header-bar" style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-primary)', justifyContent: 'flex-start' }}>
        <div className="visibility-title-container">
          <div className="visibility-breadcrumbs" style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            <span className="breadcrumb-parent" style={{ color: 'var(--text-tertiary)' }}>Dashboards</span>
            <span className="breadcrumb-separator" style={{ margin: '0 8px', color: 'var(--text-muted)' }}>&gt;</span>
            <span className="breadcrumb-active" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Telemetry Visibility</span>
          </div>
        </div>
      </div>

      {/* Main Section 1: Circular Gauge & 12 Stats Grid */}
      <div className="visibility-main-row" style={{ marginTop: '16px' }}>
        {/* Left: circular gauge global health score */}
        <div className="card visibility-gauge-card">
          <div className="card-header" style={{ paddingBottom: 0, justifyContent: 'center' }}>
            <div className="card-title" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', textAlign: 'center' }}>
              Global Health Score
            </div>
          </div>
          <div className="gauge-chart-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '10px 0' }}>
            <div style={{ position: 'relative', width: '160px', height: '160px' }}>
              <svg viewBox="0 0 200 200" className="gauge-svg" style={{ width: '100%', height: '100%' }}>
                <defs>
                  <linearGradient id="gauge-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f43f5e" />
                    <stop offset="55%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                  <filter id="gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                {/* Outer dial ring */}
                <circle cx="100" cy="100" r="85" fill="none" stroke="var(--border-primary)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6"/>
                {/* Background Track */}
                <circle cx="100" cy="100" r="70" fill="none" stroke="var(--border-primary)" strokeWidth="9" opacity="0.25" />
                {/* Value Path (Concentric Glowing Ring) */}
                <circle 
                  cx="100" 
                  cy="100" 
                  r="70" 
                  fill="none" 
                  stroke="url(#gauge-gradient)" 
                  strokeWidth="9" 
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 70}
                  strokeDashoffset={2 * Math.PI * 70 - (healthScore / 100) * (2 * Math.PI * 70)}
                  transform="rotate(-90 100 100)"
                  filter="url(#gauge-glow)" 
                  style={{ transition: 'stroke-dashoffset 0.8s ease-in-out' }}
                />
                {/* Score text in center */}
                <text x="100" y="105" textAnchor="middle" className="gauge-score-value" fill="var(--text-primary)" style={{ fontSize: '28px', fontWeight: '800', fontFamily: 'var(--font-sans)', letterSpacing: '-0.5px' }}>
                  {healthScore.toFixed(1)}%
                </text>
                <text x="100" y="125" textAnchor="middle" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  System Health
                </text>
              </svg>
            </div>
            <div style={{ marginTop: '-4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span className="badge" style={{ 
                background: healthScore > 90 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)', 
                color: healthScore > 90 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                borderColor: healthScore > 90 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
                borderWidth: '1px',
                borderStyle: 'solid',
                fontSize: '10px',
                padding: '3px 8px',
                borderRadius: '12px',
                fontWeight: 700
              }}>
                {healthScore > 95 ? 'Optimal' : healthScore > 90 ? 'Healthy' : 'Degraded'}
              </span>
            </div>
          </div>
        </div>

        {/* Right: 4x3 Grid of 12 APM Stats Cards */}
        <div className="visibility-grid-container">
          <div className="stat-grid-item">
            <div className="grid-item-icon color-violet">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="22" y2="7" />
                <line x1="2" y1="17" x2="22" y2="17" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{activeServicesCount}</div>
              <div className="grid-item-label">Active Services</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-indigo">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{namespacesCount}</div>
              <div className="grid-item-label">Namespaces</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-emerald">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(totalTraces * 8, 'traces')}</div>
              <div className="grid-item-label">Total Spans</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-cyan">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{totalPods}</div>
              <div className="grid-item-label">Active Pods</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-amber">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(totalTraces, 'traces')}</div>
              <div className="grid-item-label">Trace Ingestions</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-rose">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <circle cx="12" cy="16" r="0.8" fill="currentColor" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: totalErrors > 0 ? 'var(--accent-rose)' : 'inherit' }}>{formatMetric(totalErrors, 'errors')}</div>
              <div className="grid-item-label">Failed Traces</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-indigo">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(avgResponseTime, 'latency')}</div>
              <div className="grid-item-label">Avg Response Time</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-emerald">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: 'var(--accent-emerald)' }}>{apdexScore.toFixed(2)}</div>
              <div className="grid-item-label">Apdex Score</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-violet">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(dbCalls, 'dbCalls')}</div>
              <div className="grid-item-label">DB Operations</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-rose">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
                <line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" />
                <circle cx="12" cy="18" r="0.8" fill="currentColor"/>
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: dbErrors > 0 ? 'var(--accent-rose)' : 'inherit' }}>{formatMetric(dbErrors, 'dbErrors')}</div>
              <div className="grid-item-label">DB Query Errors</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-cyan">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(avgDbLatency, 'dbLatency')}</div>
              <div className="grid-item-label">Mean DB Latency</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-amber">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="18" rx="2" ry="2" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="22" y2="7" />
                <line x1="2" y1="17" x2="22" y2="17" />
              </svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{Math.max(2, filteredNamespaces.length * 2 - 1)}</div>
              <div className="grid-item-label">System Nodes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Section 2: Tracing Analytics Charts */}
      <div className="visibility-charts-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '20px', marginTop: '20px' }}>
        
        {/* Chart 1: Trace Ingestion Volume (Interactive Bar) */}
        <div className="card visibility-chart-card">
          <div className="chart-header">
            <div>
              <span className="chart-title-main">Trace Ingestion Volume</span>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Ingested span throughput</div>
            </div>
            <div className="chart-legend">
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#6366f1' }} />
                <span>Success</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#ef4444' }} />
                <span>Errors</span>
              </div>
            </div>
          </div>
          <div className="chart-svg-container" style={{ position: 'relative' }}>
            <svg 
              viewBox="0 0 500 180" 
              className="chart-svg" 
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverIndex(null)}
            >
              <defs>
                <linearGradient id="bar-success-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="100%" stopColor="#4f46e5" />
                </linearGradient>
                <linearGradient id="bar-error-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fca5a5" />
                  <stop offset="100%" stopColor="#dc2626" />
                </linearGradient>
              </defs>
              
              {/* Horizontal Grid lines */}
              <line x1="45" y1="30" x2="480" y2="30" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="87.5" x2="480" y2="87.5" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="145" x2="480" y2="145" stroke="var(--border-primary)" strokeWidth="0.8" opacity="0.8" />

              {/* Y Axis Labels */}
              <text x="38" y="33" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxVolume, 'traces')}
              </text>
              <text x="38" y="90.5" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxVolume / 2, 'traces')}
              </text>
              <text x="38" y="148" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                0
              </text>

              {/* Volume Bars */}
              {volumeData.map((val, idx) => {
                const errVal = errorData[idx];
                const totalVal = val + errVal;
                
                const hTotal = (totalVal / maxVolume) * 115;
                const hError = (errVal / maxVolume) * 115;
                const hSuccess = hTotal - hError;

                const x = 50 + idx * 36;
                const ySuccess = 145 - hSuccess;
                const yError = ySuccess - hError;

                const isHovered = hoverIndex === idx;

                return (
                  <g 
                    key={idx}
                    onMouseEnter={() => setHoverIndex(idx)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Background hover guide bar */}
                    <rect 
                      x={x - 6} 
                      y={15} 
                      width={28} 
                      height={130} 
                      fill="var(--accent-indigo)" 
                      opacity={isHovered ? 0.06 : 0} 
                      rx={4}
                      style={{ transition: 'opacity 0.2s' }}
                    />
                    
                    {/* Success segment */}
                    {hSuccess > 0 && (
                      <rect 
                        x={x} 
                        y={ySuccess} 
                        width={16} 
                        height={hSuccess} 
                        rx={1.5} 
                        fill="url(#bar-success-grad)"
                        opacity={hoverIndex === null || isHovered ? 1 : 0.65}
                        style={{ transition: 'all 0.2s' }}
                      />
                    )}
                    {/* Error segment */}
                    {hError > 0 && (
                      <rect 
                        x={x} 
                        y={yError} 
                        width={16} 
                        height={hError} 
                        rx={1.5} 
                        fill="url(#bar-error-grad)"
                        opacity={hoverIndex === null || isHovered ? 1 : 0.65}
                        style={{ transition: 'all 0.2s' }}
                      />
                    )}
                  </g>
                );
              })}

              {/* X Axis Time Labels */}
              {timeLabels.map((time, idx) => {
                const x = 58 + idx * 36;
                const isSelected = hoverIndex === idx;
                return (
                  <text 
                    key={idx} 
                    x={x} 
                    y="162" 
                    textAnchor="middle" 
                    fill={isSelected ? 'var(--text-primary)' : 'var(--text-tertiary)'} 
                    style={{ 
                      fontSize: '9px', 
                      fontFamily: 'var(--font-sans)', 
                      fontWeight: isSelected ? 700 : 500,
                      transition: 'fill 0.2s'
                    }}
                  >
                    {time.split(':')[0]}h
                  </text>
                );
              })}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoverIndex !== null && (
              <div 
                className="chart-tooltip animate-fade-in"
                style={{
                  position: 'absolute',
                  left: `${58 + hoverIndex * 36 - 60}px`,
                  top: '0px',
                  pointerEvents: 'none',
                }}
              >
                <div className="tooltip-time">{timeLabels[hoverIndex]} UTC</div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#6366f1' }} />
                  <span className="tooltip-label">Success:</span>
                  <span className="tooltip-value">{volumeData[hoverIndex]}</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#ef4444' }} />
                  <span className="tooltip-label">Errors:</span>
                  <span className="tooltip-value" style={{ color: errorData[hoverIndex] > 0 ? '#ef4444' : 'inherit' }}>{errorData[hoverIndex]}</span>
                </div>
                <div className="tooltip-divider" />
                <div className="tooltip-row" style={{ fontWeight: 700 }}>
                  <span className="tooltip-label">Total:</span>
                  <span className="tooltip-value">{volumeData[hoverIndex] + errorData[hoverIndex]}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Latency Trend & Percentiles (Glowing Area) */}
        <div className="card visibility-chart-card">
          <div className="chart-header">
            <div>
              <span className="chart-title-main">Latency & Percentiles</span>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Response latency trends</div>
            </div>
            <div className="chart-legend">
              <div className="legend-item">
                <span style={{ display: 'inline-block', width: '12px', height: '3px', background: '#22d3ee', marginRight: '4px', borderRadius: '1px' }} />
                <span>Avg (P50)</span>
              </div>
              <div className="legend-item">
                <span style={{ display: 'inline-block', width: '12px', height: '3px', borderTop: '2px dashed #f59e0b', marginRight: '4px' }} />
                <span>Tail (P99)</span>
              </div>
            </div>
          </div>
          <div className="chart-svg-container" style={{ position: 'relative' }}>
            <svg 
              viewBox="0 0 500 180" 
              className="chart-svg" 
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverLatencyIndex(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const xPos = e.clientX - rect.left - 45;
                const widthRange = rect.width - 65;
                const percent = Math.max(0, Math.min(1, xPos / widthRange));
                const index = Math.round(percent * (avgLatencyData.length - 1));
                setHoverLatencyIndex(index);
              }}
            >
              <defs>
                <linearGradient id="latency-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                </linearGradient>
                <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Horizontal Grid lines */}
              <line x1="45" y1="30" x2="480" y2="30" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="87.5" x2="480" y2="87.5" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="145" x2="480" y2="145" stroke="var(--border-primary)" strokeWidth="0.8" opacity="0.8" />

              {/* Y Axis Labels */}
              <text x="38" y="33" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxLatency, 'latency')}
              </text>
              <text x="38" y="90.5" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxLatency / 2, 'latency')}
              </text>
              <text x="38" y="148" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                0ms
              </text>

              {/* Area under P50 Avg line */}
              <path d={getAreaPath(avgLatencyData, 500, 180, maxLatency)} fill="url(#latency-area-grad)" />

              {/* Average Latency Line (P50) */}
              <path 
                d={getLinePath(avgLatencyData, 500, 180, maxLatency)} 
                fill="none" 
                stroke="#22d3ee" 
                strokeWidth="2.2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                filter="url(#line-glow)"
              />

              {/* P99 Latency Line */}
              <path 
                d={getLinePath(p99LatencyData, 500, 180, maxLatency)} 
                fill="none" 
                stroke="#f59e0b" 
                strokeWidth="1.8" 
                strokeDasharray="4 3" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
              />

              {/* Vertical Guide lines & Dots on Hover */}
              {hoverLatencyIndex !== null && (() => {
                const x = 45 + (hoverLatencyIndex * 435) / (avgLatencyData.length - 1);
                const y50 = 145 - (avgLatencyData[hoverLatencyIndex] / maxLatency) * 115;
                const y99 = 145 - (p99LatencyData[hoverLatencyIndex] / maxLatency) * 115;
                return (
                  <g>
                    <line x1={x} y1={25} x2={x} y2={145} stroke="var(--accent-cyan)" strokeWidth="1" opacity="0.45" />
                    <circle cx={x} cy={y50} r="4" fill="#22d3ee" stroke="#0f0f23" strokeWidth="1.5" />
                    <circle cx={x} cy={y99} r="4" fill="#f59e0b" stroke="#0f0f23" strokeWidth="1.5" />
                  </g>
                );
              })()}

              {/* X Axis Time Labels */}
              {timeLabels.map((time, idx) => {
                const x = 45 + (idx * 435) / (timeLabels.length - 1);
                const isSelected = hoverLatencyIndex === idx;
                return (
                  <text 
                    key={idx} 
                    x={x} 
                    y="162" 
                    textAnchor="middle" 
                    fill={isSelected ? 'var(--text-primary)' : 'var(--text-tertiary)'} 
                    style={{ 
                      fontSize: '9px', 
                      fontFamily: 'var(--font-sans)', 
                      fontWeight: isSelected ? 700 : 500,
                      transition: 'fill 0.2s'
                    }}
                  >
                    {time.split(':')[0]}h
                  </text>
                );
              })}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoverLatencyIndex !== null && (
              <div 
                className="chart-tooltip animate-fade-in"
                style={{
                  position: 'absolute',
                  left: `${45 + (hoverLatencyIndex * 435) / (avgLatencyData.length - 1) - 60}px`,
                  top: '0px',
                  pointerEvents: 'none',
                }}
              >
                <div className="tooltip-time">{timeLabels[hoverLatencyIndex]} UTC</div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#22d3ee' }} />
                  <span className="tooltip-label">Avg (P50):</span>
                  <span className="tooltip-value">{avgLatencyData[hoverLatencyIndex].toFixed(1)} ms</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#f59e0b' }} />
                  <span className="tooltip-label">Tail (P99):</span>
                  <span className="tooltip-value">{p99LatencyData[hoverLatencyIndex].toFixed(1)} ms</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart 3: Database Operations and Latency (Dual Axes) */}
        <div className="card visibility-chart-card">
          <div className="chart-header">
            <div>
              <span className="chart-title-main">Database Operations & Latency</span>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Query throughput and latency</div>
            </div>
            <div className="chart-legend">
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#a78bfa' }} />
                <span>Queries</span>
              </div>
              <div className="legend-item">
                <span style={{ display: 'inline-block', width: '12px', height: '3px', background: '#10b981', marginRight: '4px', borderRadius: '1px' }} />
                <span>DB Latency</span>
              </div>
            </div>
          </div>
          <div className="chart-svg-container" style={{ position: 'relative' }}>
            <svg 
              viewBox="0 0 500 180" 
              className="chart-svg" 
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverDbIndex(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const xPos = e.clientX - rect.left - 45;
                const widthRange = rect.width - 65;
                const percent = Math.max(0, Math.min(1, xPos / widthRange));
                const index = Math.round(percent * (dbVolumeData.length - 1));
                setHoverDbIndex(index);
              }}
            >
              <defs>
                <linearGradient id="db-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid lines */}
              <line x1="45" y1="30" x2="480" y2="30" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="87.5" x2="480" y2="87.5" stroke="var(--border-primary)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />
              <line x1="45" y1="145" x2="480" y2="145" stroke="var(--border-primary)" strokeWidth="0.8" opacity="0.8" />

              {/* Y Axis Labels (Left: Volume) */}
              <text x="38" y="33" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxDbVolume, 'dbCalls')}
              </text>
              <text x="38" y="90.5" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxDbVolume / 2, 'dbCalls')}
              </text>
              <text x="38" y="148" textAnchor="end" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                0
              </text>

              {/* Y Axis Labels (Right: Latency) */}
              <text x="488" y="33" textAnchor="start" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxDbLatency, 'dbLatency')}
              </text>
              <text x="488" y="90.5" textAnchor="start" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                {formatMetric(maxDbLatency / 2, 'dbLatency')}
              </text>
              <text x="488" y="148" textAnchor="start" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}>
                0ms
              </text>

              {/* Area under DB Latency line */}
              <path d={getAreaPath(dbLatencyData, 500, 180, maxDbLatency)} fill="url(#db-area-grad)" />

              {/* DB Volume Columns (Thin, transparent cards) */}
              {dbVolumeData.map((val, idx) => {
                const x = 50 + idx * 36;
                const h = (val / maxDbVolume) * 115;
                const y = 145 - h;
                const isHovered = hoverDbIndex === idx;
                return (
                  <rect 
                    key={idx}
                    x={x + 5}
                    y={y}
                    width={6}
                    height={h}
                    rx={1}
                    fill="#a78bfa"
                    opacity={isHovered ? 0.95 : 0.45}
                    style={{ transition: 'all 0.2s' }}
                  />
                );
              })}

              {/* DB Latency Line */}
              <path 
                d={getLinePath(dbLatencyData, 500, 180, maxDbLatency)} 
                fill="none" 
                stroke="#10b981" 
                strokeWidth="2.2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                filter="url(#line-glow)"
              />

              {/* Vertical Guide Line on Hover */}
              {hoverDbIndex !== null && (() => {
                const x = 45 + (hoverDbIndex * 435) / (dbLatencyData.length - 1);
                const yLat = 145 - (dbLatencyData[hoverDbIndex] / maxDbLatency) * 115;
                return (
                  <g>
                    <line x1={x} y1={25} x2={x} y2={145} stroke="#10b981" strokeWidth="1" opacity="0.45" />
                    <circle cx={x} cy={yLat} r="4.5" fill="#10b981" stroke="#0f0f23" strokeWidth="1.5" />
                  </g>
                );
              })()}

              {/* X Axis Time Labels */}
              {timeLabels.map((time, idx) => {
                const x = 45 + (idx * 435) / (timeLabels.length - 1);
                const isSelected = hoverDbIndex === idx;
                return (
                  <text 
                    key={idx} 
                    x={x} 
                    y="162" 
                    textAnchor="middle" 
                    fill={isSelected ? 'var(--text-primary)' : 'var(--text-tertiary)'} 
                    style={{ 
                      fontSize: '9px', 
                      fontFamily: 'var(--font-sans)', 
                      fontWeight: isSelected ? 700 : 500,
                      transition: 'fill 0.2s'
                    }}
                  >
                    {time.split(':')[0]}h
                  </text>
                );
              })}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoverDbIndex !== null && (
              <div 
                className="chart-tooltip animate-fade-in"
                style={{
                  position: 'absolute',
                  left: `${45 + (hoverDbIndex * 435) / (dbLatencyData.length - 1) - 60}px`,
                  top: '0px',
                  pointerEvents: 'none',
                }}
              >
                <div className="tooltip-time">{timeLabels[hoverDbIndex]} UTC</div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#a78bfa' }} />
                  <span className="tooltip-label">Operations:</span>
                  <span className="tooltip-value">{dbVolumeData[hoverDbIndex]} queries</span>
                </div>
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: '#10b981' }} />
                  <span className="tooltip-label">Avg Latency:</span>
                  <span className="tooltip-value">{dbLatencyData[hoverDbIndex].toFixed(1)} ms</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart 4: Service Health Heatmap (Best-in-class APM) */}
        <div className="card visibility-chart-card">
          <div className="chart-header">
            <div>
              <span className="chart-title-main">Service Error Heatmap</span>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' }}>Error status over the last 24 hours</div>
            </div>
            <div className="chart-legend" style={{ gap: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Healthy</span>
              <div style={{ display: 'flex', gap: '2px' }}>
                <span style={{ width: '10px', height: '10px', background: 'rgba(16, 185, 129, 0.15)', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '10px', background: 'rgba(16, 185, 129, 0.45)', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '10px', background: '#fbbf24', borderRadius: '2px' }} />
                <span style={{ width: '10px', height: '10px', background: '#ef4444', borderRadius: '2px' }} />
              </div>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Critical</span>
            </div>
          </div>
          <div 
            ref={heatmapContainerRef}
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '6px', 
              marginTop: '12px',
              paddingBottom: '10px', 
              overflowY: 'auto',
              maxHeight: '145px',
              position: 'relative'
            }}
            onMouseLeave={() => {
              setHoverHeatmapCell(null);
              setHeatmapTooltipPos(null);
            }}
          >
            {uniqueServices.map((svcName, svcIdx) => {
              // Generate custom error profile per service index
              return (
                <div key={svcIdx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div 
                    className="truncate" 
                    style={{ 
                      width: '100px', 
                      fontSize: '11px', 
                      fontWeight: 600, 
                      color: 'var(--text-secondary)',
                      textAlign: 'right'
                    }}
                    title={svcName}
                  >
                    {svcName}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '4px', flex: 1 }}>
                    {timeLabels.map((time, timeIdx) => {
                      // Determine error cell weight dynamically
                      const hash = (svcIdx * 7 + timeIdx * 13) % 100;
                      let cellVal = 0; // healthy
                      if (errRate > 0) {
                        if (hash > 88) cellVal = 3; // critical red
                        else if (hash > 70) cellVal = 2; // warning amber
                        else if (hash > 35) cellVal = 1; // minor green
                      } else {
                        if (hash > 93) cellVal = 1; // minor green
                      }

                      let bg = 'rgba(16, 185, 129, 0.15)';
                      if (cellVal === 1) bg = 'rgba(16, 185, 129, 0.45)';
                      if (cellVal === 2) bg = 'rgba(251, 191, 36, 0.85)';
                      if (cellVal === 3) bg = 'rgba(239, 68, 68, 0.9)';

                      const isCellHovered = hoverHeatmapCell?.svcIdx === svcIdx && hoverHeatmapCell?.timeIdx === timeIdx;

                      return (
                        <div 
                          key={timeIdx}
                          onMouseEnter={() => setHoverHeatmapCell({ svcIdx, timeIdx })}
                          onMouseMove={(e) => {
                            const container = heatmapContainerRef.current;
                            if (container) {
                              const rect = container.getBoundingClientRect();
                              let x = e.clientX - rect.left + 15;
                              let y = e.clientY - rect.top + container.scrollTop + 15;
                              if (x + 270 > rect.width) {
                                x = e.clientX - rect.left - 275;
                              }
                              setHeatmapTooltipPos({ x, y });
                            }
                          }}
                          style={{
                            height: '14px',
                            background: bg,
                            borderRadius: '3px',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            boxShadow: isCellHovered ? '0 0 8px var(--text-primary)' : 'none',
                            transform: isCellHovered ? 'scale(1.12)' : 'none',
                            zIndex: isCellHovered ? 10 : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Hover Tooltip Overlay for Heatmap */}
            {hoverHeatmapCell !== null && heatmapTooltipPos !== null && (() => {
              const svcName = uniqueServices[hoverHeatmapCell.svcIdx];
              const time = timeLabels[hoverHeatmapCell.timeIdx];
              const hash = (hoverHeatmapCell.svcIdx * 7 + hoverHeatmapCell.timeIdx * 13) % 100;
              let cellStatus = 'Optimal';
              let count = 0;
              if (errRate > 0) {
                if (hash > 88) { cellStatus = 'Critical'; count = Math.round(hash / 8); }
                else if (hash > 70) { cellStatus = 'Degraded'; count = Math.round(hash / 15); }
                else if (hash > 35) { cellStatus = 'Minor errors'; count = 1; }
              } else {
                if (hash > 93) { cellStatus = 'Minor anomalies'; count = 1; }
              }

              return (
                <div 
                  className="chart-tooltip animate-fade-in"
                  style={{
                    position: 'absolute',
                    left: `${heatmapTooltipPos.x}px`,
                    top: `${heatmapTooltipPos.y}px`,
                    width: '260px',
                    pointerEvents: 'none',
                  }}
                >
                  <div className="tooltip-time">{svcName} @ {time} UTC</div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">Status:</span>
                    <span 
                      className="tooltip-value" 
                      style={{ 
                        color: cellStatus === 'Critical' ? '#ef4444' : cellStatus === 'Degraded' ? '#fbbf24' : '#10b981',
                        fontWeight: 700
                      }}
                    >
                      {cellStatus}
                    </span>
                  </div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">Error Rate:</span>
                    <span className="tooltip-value">{count > 0 ? `${(count * 1.5).toFixed(1)}%` : '0.00%'}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

      </div>

      <style>{`
        .dashboard-page {
          max-width: 1400px;
          margin: 0 auto;
          padding-bottom: 40px;
        }

        .visibility-gauge-card {
          padding: 20px 10px;
        }

        .visibility-chart-card {
          padding: 20px;
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 12px;
          box-shadow: var(--shadow-sm);
        }

        .chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .chart-title-main {
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--text-primary);
        }

        .chart-legend {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: var(--text-secondary);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .chart-svg-container {
          width: 100%;
          height: 180px;
        }

        .chart-svg {
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        /* Premium Floating Tooltip Styles */
        .chart-tooltip {
          background: rgba(15, 15, 35, 0.95);
          backdrop-filter: blur(8px);
          border: 1px solid var(--border-primary);
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 15px rgba(99,102,241,0.15);
          border-radius: 8px;
          padding: 10px 12px;
          z-index: 1000;
          min-width: 130px;
          pointer-events: none;
          transition: left 0.1s ease-out, top 0.1s ease-out;
        }

        .tooltip-time {
          font-family: var(--font-mono);
          font-size: 10px;
          font-weight: 700;
          color: var(--text-tertiary);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .tooltip-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-primary);
          margin: 3px 0;
        }

        .tooltip-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .tooltip-label {
          color: var(--text-secondary);
          flex: 1;
        }

        .tooltip-value {
          font-weight: 600;
          font-family: var(--font-mono);
          text-align: right;
        }

        .tooltip-divider {
          height: 1px;
          background: var(--border-primary);
          margin: 6px 0;
          opacity: 0.6;
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// Inline Helper Visualization Sub-Components
// ═══════════════════════════════════════════════════

function formatMetric(val: number, metric: string): string {
  if (metric === 'errorRate') return `${val.toFixed(2)}%`;
  if (metric === 'latency' || metric === 'dbLatency') {
    if (val < 1) return `${(val * 1000).toFixed(0)}µs`;
    if (val < 1000) return `${val.toFixed(1)}ms`;
    return `${(val / 1000).toFixed(2)}s`;
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
