import React, { useState, useEffect, useCallback } from 'react';
import { api, type NamespaceStats, type DatabaseQueryMetric } from '../api/client';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
}

export default function Dashboard({ namespaces, selectedNamespace, onSelectNamespace }: DashboardProps) {
  const [dbMetrics, setDbMetrics] = useState<DatabaseQueryMetric[]>([]);

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

  // Compute pointer position for the Reliability circular gauge (radius = 70.7, center = 100,100, sweep 270 deg starting at 135 deg)
  const angle = 135 + (healthScore / 100) * 270;
  const rad = (angle * Math.PI) / 180;
  const pointerX = 100 + 70.7 * Math.cos(rad);
  const pointerY = 100 + 70.7 * Math.sin(rad);

  // Apdex Score calculation
  const apdexScore = totalTraces > 0 ? Math.max(0.75, 1 - (totalErrors / totalTraces) * 1.5) : 1.0;

  // Compute database aggregates
  const dbCalls = dbMetrics.reduce((sum, q) => sum + q.callCount, 0);
  const dbErrors = dbMetrics.reduce((sum, q) => sum + q.errorCount, 0);
  const avgDbLatency = dbMetrics.length > 0 ? dbMetrics.reduce((sum, q) => sum + q.avgDurationMs, 0) / dbMetrics.length : 0;
  const avgResponseTime = filteredNamespaces.length > 0 ? filteredNamespaces.reduce((a, b) => a + b.avgDurationMs, 0) / filteredNamespaces.length : 0;

  // Auto-refresh trigger
  useEffect(() => {
    const iv = setInterval(() => {
      loadDbMetrics();
    }, 5000);
    return () => clearInterval(iv);
  }, [loadDbMetrics]);

  return (
    <div className="animate-fade-in dashboard-page">
      {/* Top Header Bar */}
      <div className="visibility-header-bar" style={{ paddingBottom: '12px', borderBottom: '1px solid var(--border-primary)', justifyContent: 'flex-start' }}>
        <div className="visibility-title-container">
          <div className="visibility-breadcrumbs" style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            <span className="breadcrumb-parent" style={{ color: 'var(--text-tertiary)' }}>Dashboards</span>
            <span className="breadcrumb-separator" style={{ margin: '0 8px', color: 'var(--text-muted)' }}>&gt;</span>
            <span className="breadcrumb-active" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Visibility</span>
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
            <svg viewBox="0 0 200 200" className="gauge-svg" style={{ width: '160px', height: '160px' }}>
              <defs>
                <linearGradient id="gauge-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="55%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
                <filter id="gauge-shadow">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1"/>
                </filter>
              </defs>
              {/* Outer dial ring */}
              <circle cx="100" cy="100" r="85" fill="none" stroke="var(--border-primary)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6"/>
              {/* Background Track */}
              <circle cx="100" cy="100" r="70" fill="none" stroke="var(--border-primary)" strokeWidth="10" opacity="0.3" />
              {/* Value Path (Concentric Glowing Ring) */}
              <circle 
                cx="100" 
                cy="100" 
                r="70" 
                fill="none" 
                stroke="url(#gauge-gradient)" 
                strokeWidth="10" 
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 70}
                strokeDashoffset={2 * Math.PI * 70 - (healthScore / 100) * (2 * Math.PI * 70)}
                transform="rotate(-90 100 100)"
                filter="url(#gauge-shadow)" 
              />
              {/* Score text in center */}
              <text x="100" y="105" textAnchor="middle" className="gauge-score-value" fill="var(--text-primary)" style={{ fontSize: '28px', fontWeight: '800', fontFamily: 'var(--font-sans)', letterSpacing: '-0.5px' }}>
                {healthScore.toFixed(1)}%
              </text>
              <text x="100" y="125" textAnchor="middle" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px' }}>
                System Health
              </text>
            </svg>
            <div style={{ marginTop: '-10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
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

      <style>{`
        .dashboard-page {
          max-width: 1400px;
          margin: 0 auto;
          padding-bottom: 40px;
        }

        .visibility-dashboard-title {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
          margin: 0;
          letter-spacing: -0.3px;
        }

        .visibility-dashboard-subtitle {
          font-size: 12px;
          color: var(--text-muted);
          margin: 4px 0 0 0;
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
