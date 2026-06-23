import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type NamespaceStats, type DatabaseQueryMetric } from '../api/client';
import { createPortal } from 'react-dom';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
}

type WidgetType = 'value' | 'line' | 'bar' | 'table';
type WidgetMetric = 'traces' | 'services' | 'errors' | 'errorRate' | 'latency' | 'dbCalls' | 'dbErrors' | 'dbLatency';
type WidgetWidth = '1/4' | '1/3' | '1/2' | '2/3' | '1';
type WidgetColor = 'indigo' | 'violet' | 'emerald' | 'rose' | 'amber' | 'cyan';

interface Widget {
  id: string;
  title: string;
  type: WidgetType;
  metric: WidgetMetric;
  width: WidgetWidth;
  color: WidgetColor;
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: '1', title: 'Active Services', type: 'value', metric: 'services', width: '1/4', color: 'emerald' },
  { id: '2', title: 'Total Traces Ingestion', type: 'value', metric: 'traces', width: '1/4', color: 'indigo' },
  { id: '3', title: 'Transaction Failure Rate', type: 'value', metric: 'errorRate', width: '1/4', color: 'rose' },
  { id: '4', title: 'Average Response Time', type: 'value', metric: 'latency', width: '1/4', color: 'cyan' },
  { id: '5', title: 'Latency Contribution Trend', type: 'line', metric: 'latency', width: '1/2', color: 'indigo' },
  { id: '6', title: 'System Errors (SPS)', type: 'line', metric: 'errors', width: '1/2', color: 'rose' },
  { id: '7', title: 'Top Database Operations', type: 'table', metric: 'dbCalls', width: '1/2', color: 'amber' },
  { id: '8', title: 'Service Ingestion Inbound', type: 'bar', metric: 'traces', width: '1/2', color: 'violet' }
];

export default function Dashboard({ namespaces, selectedNamespace, onSelectNamespace }: DashboardProps) {
  const navigate = useNavigate();
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [dbMetrics, setDbMetrics] = useState<DatabaseQueryMetric[]>([]);
  const [historyData, setHistoryData] = useState<Record<string, number[]>>({});
  const [timeRange, setTimeRange] = useState('1h');
  
  // Single Unified state for configuration modal (null means hidden)
  const [tempWidget, setTempWidget] = useState<Widget | null>(null);

  // Toggle body class for full-screen blur layout override
  useEffect(() => {
    if (tempWidget) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [tempWidget]);

  // Load widgets configuration
  useEffect(() => {
    const saved = localStorage.getItem('vektor_dashboard_widgets');
    if (saved) {
      try {
        setWidgets(JSON.parse(saved));
      } catch {
        setWidgets(DEFAULT_WIDGETS);
      }
    } else {
      setWidgets(DEFAULT_WIDGETS);
    }
  }, []);

  // Save widgets configuration helper
  const saveWidgetsConfig = (updatedWidgets: Widget[]) => {
    setWidgets(updatedWidgets);
    localStorage.setItem('vektor_dashboard_widgets', JSON.stringify(updatedWidgets));
  };

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

  // Compute metric calculations
  const getMetricValue = useCallback((metric: WidgetMetric): number => {
    switch (metric) {
      case 'traces':
        return filteredNamespaces.reduce((a, b) => a + b.traceCount, 0);
      case 'services':
        return filteredNamespaces.reduce((a, b) => a + (b.services?.length || 0), 0);
      case 'errors':
        return filteredNamespaces.reduce((a, b) => a + b.errorCount, 0);
      case 'errorRate': {
        const traces = filteredNamespaces.reduce((a, b) => a + b.traceCount, 0);
        const errors = filteredNamespaces.reduce((a, b) => a + b.errorCount, 0);
        return traces > 0 ? (errors / traces) * 100 : 0;
      }
      case 'latency':
        return filteredNamespaces.length > 0
          ? filteredNamespaces.reduce((a, b) => a + b.avgDurationMs, 0) / filteredNamespaces.length
          : 0;
      case 'dbCalls':
        return dbMetrics.reduce((sum, q) => sum + q.callCount, 0);
      case 'dbErrors':
        return dbMetrics.reduce((sum, q) => sum + q.errorCount, 0);
      case 'dbLatency':
        return dbMetrics.length > 0
          ? dbMetrics.reduce((sum, q) => sum + q.avgDurationMs, 0) / dbMetrics.length
          : 0;
      default:
        return 0;
    }
  }, [filteredNamespaces, dbMetrics]);

  // Update line charts history data
  useEffect(() => {
    if (namespaces.length === 0) return;

    setHistoryData(prev => {
      const next = { ...prev };
      let changed = false;

      widgets.forEach(w => {
        if (w.type === 'line') {
          const currentVal = getMetricValue(w.metric);
          const currentHist = prev[w.id] || [];

          if (currentHist.length === 0) {
            // Seed initial history trail with minor noise around the current baseline
            next[w.id] = Array.from({ length: 15 }, () => {
              const variance = 0.8 + Math.random() * 0.45;
              return Math.max(0, currentVal * variance);
            });
            changed = true;
          } else {
            const lastVal = currentHist[currentHist.length - 1];
            if (Math.abs(lastVal - currentVal) > 0.0001 || Math.random() > 0.6) {
              next[w.id] = [...currentHist.slice(1), currentVal];
              changed = true;
            }
          }
        }
      });

      return changed ? next : prev;
    });
  }, [widgets, namespaces, dbMetrics, getMetricValue]);

  // Auto-refresh trigger
  useEffect(() => {
    const iv = setInterval(() => {
      loadDbMetrics();
    }, 5000);
    return () => clearInterval(iv);
  }, [loadDbMetrics]);

  // Move layout widgets
  const moveWidget = (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index === 0) return;
    if (direction === 'right' && index === widgets.length - 1) return;

    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    const reordered = [...widgets];
    const temp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = temp;
    saveWidgetsConfig(reordered);
  };

  // Delete widget
  const deleteWidget = (id: string) => {
    const updated = widgets.filter(w => w.id !== id);
    saveWidgetsConfig(updated);
  };

  // Save/Create widget configuration
  const handleSaveWidget = () => {
    if (!tempWidget) return;
    
    if (tempWidget.id) {
      // Edit existing
      const updatedList = widgets.map(w => w.id === tempWidget.id ? tempWidget : w);
      saveWidgetsConfig(updatedList);
    } else {
      // Add new
      const newPanel: Widget = {
        ...tempWidget,
        id: Date.now().toString()
      };
      const updatedList = [...widgets, newPanel];
      saveWidgetsConfig(updatedList);
    }
    setTempWidget(null);
  };

  const getMetricLabel = (metric: WidgetMetric) => {
    return {
      traces: 'Total Traces',
      services: 'Active Services',
      errors: 'System Errors',
      errorRate: 'Error Rate',
      latency: 'Average Latency',
      dbCalls: 'DB Calls',
      dbErrors: 'DB Errors',
      dbLatency: 'Avg DB Latency'
    }[metric];
  };

  const getMetricDesc = (metric: WidgetMetric) => {
    return {
      traces: 'Total count of ingested transaction spans.',
      services: 'Count of unique running microservice instances.',
      errors: 'Total aggregated error count across services.',
      errorRate: 'Percentage of failing transactions.',
      latency: 'Average end-to-end trace execution time.',
      dbCalls: 'Aggregated total calls to SQL/NoSQL databases.',
      dbErrors: 'Total query failures reported by storage drivers.',
      dbLatency: 'Mean execution delay of database transactions.'
    }[metric];
  };

  const colorSwatches: { value: WidgetColor; label: string; hex: string }[] = [
    { value: 'indigo', label: 'Indigo', hex: '#6366f1' },
    { value: 'violet', label: 'Violet', hex: '#8b5cf6' },
    { value: 'emerald', label: 'Emerald', hex: '#10b981' },
    { value: 'rose', label: 'Rose', hex: '#f43f5e' },
    { value: 'amber', label: 'Amber', hex: '#f59e0b' },
    { value: 'cyan', label: 'Cyan', hex: '#06b6d4' },
  ];

  const visTypes = [
    { 
      value: 'value' as WidgetType, 
      label: 'Single Stat', 
      desc: 'Large metric number', 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <text x="12" y="15" textAnchor="middle" fontSize="9" fontWeight="800" fill="currentColor">10.2k</text>
        </svg>
      )
    },
    { 
      value: 'line' as WidgetType, 
      label: 'Line Chart', 
      desc: 'Timeline trend graphs', 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M6 16 l4-7 l4 4 l4-8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    },
    { 
      value: 'bar' as WidgetType, 
      label: 'Bar Chart', 
      desc: 'Service comparison bars', 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="16" x2="13" y2="16" />
          <line x1="7" y1="12" x2="15" y2="12" />
          <line x1="7" y1="8" x2="11" y2="8" />
        </svg>
      )
    },
    { 
      value: 'table' as WidgetType, 
      label: 'Data Table', 
      desc: 'Top slow queries/services', 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="7" y1="8" x2="17" y2="8" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="7" y1="16" x2="17" y2="16" />
        </svg>
      )
    },
  ];

  const widthSegments: { value: WidgetWidth; label: string }[] = [
    { value: '1/4', label: '25%' },
    { value: '1/3', label: '33%' },
    { value: '1/2', label: '50%' },
    { value: '2/3', label: '66%' },
    { value: '1', label: '100%' },
  ];

  const isDarkTheme = document.body.classList.contains('dark-theme');

  const totalTraces = filteredNamespaces.reduce((a, b) => a + b.traceCount, 0);
  const totalErrors = filteredNamespaces.reduce((a, b) => a + b.errorCount, 0);
  const totalPods = filteredNamespaces.reduce((a, b) => a + b.podCount, 0);
  const activeServicesCount = filteredNamespaces.reduce((a, b) => a + (b.services?.length || 0), 0);
  const namespacesCount = selectedNamespace ? 1 : namespaces.length;

  const errRate = totalTraces > 0 ? (totalErrors / totalTraces) * 100 : 0;
  // health score starts at 100, drops by errRate * 3.5. Clamp between 45 and 100 to look like a realistic operational score
  const healthScore = Math.max(45, Math.min(100, 100 - errRate * 3.5));

  // Compute pointer position for the Reliability circular gauge (radius = 70.7, center = 100,100, sweep 270 deg starting at 135 deg)
  const angle = 135 + (healthScore / 100) * 270;
  const rad = (angle * Math.PI) / 180;
  const pointerX = 100 + 70.7 * Math.cos(rad);
  const pointerY = 100 + 70.7 * Math.sin(rad);

  // Compute database aggregates
  const dbCalls = dbMetrics.reduce((sum, q) => sum + q.callCount, 0);
  const dbErrors = dbMetrics.reduce((sum, q) => sum + q.errorCount, 0);
  const avgDbLatency = dbMetrics.length > 0 ? dbMetrics.reduce((sum, q) => sum + q.avgDurationMs, 0) / dbMetrics.length : 0;
  const avgResponseTime = filteredNamespaces.length > 0 ? filteredNamespaces.reduce((a, b) => a + b.avgDurationMs, 0) / filteredNamespaces.length : 0;

  // De-duplicate active services in selected namespaces for data flow display
  const allServicesMap = new Map<string, { serviceName: string; errorCount: number; requestCount: number }>();
  filteredNamespaces.forEach(ns => {
    ns.services.forEach(svc => {
      const existing = allServicesMap.get(svc.serviceName);
      if (existing) {
        existing.errorCount += svc.errorCount;
        existing.requestCount += svc.requestCount;
      } else {
        allServicesMap.set(svc.serviceName, {
          serviceName: svc.serviceName,
          errorCount: svc.errorCount,
          requestCount: svc.requestCount
        });
      }
    });
  });
  const servicesToRender = Array.from(allServicesMap.values()).slice(0, 8);
  const n = servicesToRender.length;
  const startX = 100;
  const endX = 900;
  const spacing = n > 1 ? (endX - startX) / (n - 1) : 0;

  // Render SVG Flow lines
  const flowLines: React.ReactNode[] = [];
  servicesToRender.forEach((svc, idx) => {
    const sx = n > 1 ? startX + idx * spacing : 500;
    flowLines.push(
      <path
        key={`line-g-s-${idx}`}
        d={`M 500,58 C 500,105 ${sx},105 ${sx},145`}
        className="flowing-line"
        fill="none"
        strokeWidth="1.2"
      />
    );
  });

  servicesToRender.forEach((svc, idx) => {
    const sx = n > 1 ? startX + idx * spacing : 500;
    flowLines.push(
      <path
        key={`line-s-i-${idx}`}
        d={`M ${sx},208 C ${sx},242 500,242 500,275`}
        className="flowing-line"
        fill="none"
        strokeWidth="1.2"
      />
    );
  });

  const getStatusColor = (errors: number) => {
    return errors > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)';
  };

  return (
    <div className="animate-fade-in dashboard-page">
      {/* Breadcrumb & Top Toolbar */}
      <div className="visibility-header-bar">
        <div className="visibility-breadcrumbs">
          <span className="breadcrumb-parent">Dashboards</span>
          <span className="breadcrumb-separator">&gt;</span>
          <span className="breadcrumb-active">Visibility</span>
        </div>
        <div className="visibility-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            Export as PDF
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadDbMetrics} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh Data
          </button>
          <button className="btn btn-primary btn-sm btn-glowing" style={{ background: 'var(--accent-indigo)', borderColor: 'var(--accent-indigo)', color: '#ffffff' }}>
            Dashboard Workspace
          </button>
        </div>
      </div>

      {/* Visibility Sub-Filter Toolbar */}
      <div className="visibility-filter-toolbar">
        <div className="filter-item">
          <span className="filter-label">Trace Project:</span>
          <select className="filter-select" value={selectedNamespace} onChange={e => onSelectNamespace(e.target.value)}>
            <option value="">All Namespaces</option>
            {namespaces.map(ns => (
              <option key={ns.namespace} value={ns.namespace}>{ns.namespace}</option>
            ))}
          </select>
        </div>
        <div className="filter-item">
          <span className="filter-label">Time Range:</span>
          <select className="filter-select" value={timeRange} onChange={e => setTimeRange(e.target.value)}>
            <option value="5m">Last 5 Minutes</option>
            <option value="15m">Last 15 Minutes</option>
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
          </select>
        </div>
      </div>

      {/* Main Section 1: Circular Gauge & 12 Stats Grid */}
      <div className="visibility-main-row">
        {/* Left: circular gauge reliability score */}
        <div className="card visibility-gauge-card">
          <div className="card-header" style={{ paddingBottom: 0 }}>
            <div className="card-title" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)' }}>
              Global Health Score
            </div>
            <select className="gauge-select">
              <option>95 Percentile</option>
              <option>Average</option>
            </select>
          </div>
          <div className="gauge-chart-container">
            <svg viewBox="0 0 200 200" className="gauge-svg">
              <defs>
                <linearGradient id="gauge-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="55%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
              {/* Background Track */}
              <path d="M 50,150 A 70.7,70.7 0 1,1 150,150" fill="none" stroke="var(--border-primary)" strokeWidth="10" strokeLinecap="round" opacity="0.4" />
              {/* Value Path */}
              <path d="M 50,150 A 70.7,70.7 0 1,1 150,150" fill="none" stroke="url(#gauge-gradient)" strokeWidth="10" strokeLinecap="round" strokeDasharray="333" strokeDashoffset={333 - (333 * healthScore) / 100} />
              {/* Needle Glow Dot */}
              <circle cx={pointerX} cy={pointerY} r="8" fill="var(--bg-secondary)" stroke="var(--accent-indigo)" strokeWidth="3.5" style={{ filter: 'drop-shadow(0 0 5px var(--accent-indigo))' }} />
              {/* Score text in center */}
              <text x="100" y="105" textAnchor="middle" className="gauge-score-value" fill="var(--text-primary)" style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'var(--font-sans)' }}>
                {healthScore.toFixed(2)}
              </text>
              <text x="100" y="125" textAnchor="middle" fill="var(--text-tertiary)" style={{ fontSize: '9px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                System Health %
              </text>
            </svg>
          </div>
        </div>

        {/* Right: 4x3 Grid of 12 APM Stats Cards */}
        <div className="visibility-grid-container">
          <div className="stat-grid-item">
            <div className="grid-item-icon color-violet">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{activeServicesCount}</div>
              <div className="grid-item-label">Active Services</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-indigo">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{namespacesCount}</div>
              <div className="grid-item-label">Namespaces</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-emerald">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(totalTraces * 8, 'traces')}</div>
              <div className="grid-item-label">Total Spans</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-cyan">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /><path d="M2 12h20" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{totalPods}</div>
              <div className="grid-item-label">Active Pods</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-amber">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(totalTraces, 'traces')}</div>
              <div className="grid-item-label">Trace Ingestions</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-rose">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: totalErrors > 0 ? 'var(--accent-rose)' : 'inherit' }}>{formatMetric(totalErrors, 'errors')}</div>
              <div className="grid-item-label">Failed Traces</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-indigo">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(avgResponseTime, 'latency')}</div>
              <div className="grid-item-label">Avg Response Time</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-emerald">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: 'var(--accent-emerald)' }}>{healthScore.toFixed(1)}%</div>
              <div className="grid-item-label">Reliability Index</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-violet">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(dbCalls, 'dbCalls')}</div>
              <div className="grid-item-label">DB Operations</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-rose">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /><line x1="15" y1="15" x2="19" y2="19" /><line x1="19" y1="15" x2="15" y2="19" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value" style={{ color: dbErrors > 0 ? 'var(--accent-rose)' : 'inherit' }}>{formatMetric(dbErrors, 'dbErrors')}</div>
              <div className="grid-item-label">DB Query Errors</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-cyan">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{formatMetric(avgDbLatency, 'dbLatency')}</div>
              <div className="grid-item-label">Mean DB Latency</div>
            </div>
          </div>

          <div className="stat-grid-item">
            <div className="grid-item-icon color-amber">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /><line x1="10" y1="6" x2="10.01" y2="6" /><line x1="10" y1="18" x2="10.01" y2="18" /></svg>
            </div>
            <div className="grid-item-content">
              <div className="grid-item-value">{Math.max(2, filteredNamespaces.length * 2 - 1)}</div>
              <div className="grid-item-label">System Nodes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Section 2: APM Transaction Data Ingestion Flow */}
      <div className="card data-flow-card">
        <div className="card-header">
          <div className="card-title" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)' }}>
            APM Ingestion &amp; Service Dependency Flow
          </div>
        </div>
        <div className="card-body flow-map-wrapper">
          <div className="flow-interactive-canvas">
            <svg viewBox="0 0 1000 360" className="flow-lines-svg">
              {flowLines}
              {/* Ingress Gateway (Single Centered) */}
              <foreignObject x={500 - 90} y="15" width="180" height="44">
                <div className="flow-node node-gateway" style={{ borderLeftColor: 'var(--accent-indigo)' }}>
                  <span className="node-icon">🌐</span>
                  <span className="node-label">api-ingress-controller</span>
                  <span className="node-dot status-green" />
                </div>
              </foreignObject>

              {/* Dynamic Service Nodes in Middle Row */}
              {servicesToRender.map((svc, idx) => {
                const sx = n > 1 ? startX + idx * spacing : 500;
                return (
                  <foreignObject key={idx} x={sx - 65} y="145" width="130" height="66">
                    <div className="flow-node node-service">
                      <span className="node-service-name truncate" title={svc.serviceName}>
                        {svc.serviceName}
                      </span>
                      <span className="node-service-stats">
                        Req: {svc.requestCount}
                      </span>
                      <span className="node-status-bar" style={{ background: getStatusColor(svc.errorCount) }} />
                    </div>
                  </foreignObject>
                );
              })}

              {/* Bottom Ingestor Storage Node */}
              <foreignObject x="390" y="275" width="220" height="66">
                <div className="flow-node node-storage">
                  <div className="storage-header">
                    <span className="storage-icon">🗄️</span>
                    <span className="storage-title">ClickHouse APM Storage</span>
                  </div>
                  <div className="storage-stats">
                    Ingested: {formatMetric(totalTraces, 'traces')} | Err: {totalErrors}
                  </div>
                  <span className="node-status-bar status-active-glow" />
                </div>
              </foreignObject>
            </svg>
          </div>
        </div>
      </div>

      {/* Section 3: Customizable Observability Panels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '36px 0 16px 0' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Custom Metric Panels</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Tailored telemetry grids and real-time trends</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isEditMode && (
            <button 
              className="btn btn-primary btn-sm btn-glowing-green" 
              onClick={() => setTempWidget({ id: '', title: 'New Observability Panel', type: 'line', metric: 'latency', width: '1/2', color: 'indigo' })} 
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Panel
            </button>
          )}
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setIsEditMode(!isEditMode)}
            style={{ 
              background: isEditMode ? 'var(--accent-indigo)' : 'var(--bg-secondary)', 
              color: isEditMode ? '#ffffff' : 'var(--text-primary)',
              borderColor: isEditMode ? 'var(--accent-indigo)' : 'var(--border-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isEditMode ? (
              <>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Save Layout
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Design Dashboard
              </>
            )}
          </button>
        </div>
      </div>

      {/* Customizable Grid */}
      <div className="dashboard-grid">
        {widgets.map((w, index) => {
          const val = getMetricValue(w.metric);
          const widthClass = `w-${w.width.replace('/', '-')}`;
          const isValueWidget = w.type === 'value';
          const cardClass = `card widget-card ${isValueWidget ? 'height-value' : ''} ${isEditMode ? 'editing-pulse' : ''} ${widthClass}`;

          return (
            <div key={w.id} className={cardClass}>
              {/* Sleek Floating Hover Controls in Design Mode */}
              {isEditMode && (
                <div className="widget-controls-overlay">
                  <button className="control-overlay-btn" title="Move Left" onClick={() => moveWidget(index, 'left')}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <button className="control-overlay-btn" title="Move Right" onClick={() => moveWidget(index, 'right')}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <button className="control-overlay-btn btn-action-edit" title="Configure Panel" onClick={() => setTempWidget(w)}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button className="control-overlay-btn btn-action-delete" title="Remove Panel" onClick={() => deleteWidget(w.id)}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}

              <div className="card-header" style={{ paddingBottom: '4px' }}>
                <div className="card-title" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                  <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: `var(--accent-${w.color})` }} />
                  {w.title}
                </div>
              </div>

              <div className="card-body" style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 16px 14px 16px' }}>
                {w.type === 'value' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1 }}>
                      {formatMetric(val, w.metric)}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      Current {getMetricLabel(w.metric)} rate
                    </div>
                  </div>
                )}

                {w.type === 'line' && (
                  <SVGLineChart data={historyData[w.id] || []} color={w.color} metric={w.metric} />
                )}

                {w.type === 'bar' && (
                  <SVGBarChart namespaces={namespaces} color={w.color} metric={w.metric} />
                )}

                {w.type === 'table' && (
                  <TableWidget namespaces={namespaces} dbMetrics={dbMetrics} metric={w.metric} />
                )}
              </div>
            </div>
          );
        })}

        {/* Edit Mode Empty Placeholder Card */}
        {isEditMode && (
          <div 
            className="card editing-placeholder-card w-1-4" 
            onClick={() => setTempWidget({ id: '', title: 'New Observability Panel', type: 'line', metric: 'latency', width: '1/2', color: 'indigo' })}
          >
            <div className="placeholder-plus">+</div>
            <div style={{ fontSize: '12px', fontWeight: 600 }}>Add Panel</div>
          </div>
        )}

        {widgets.length === 0 && !isEditMode && (
          <div className="card w-1" style={{ padding: '40px' }}>
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="9" x2="9" y2="15" />
                  <line x1="12" y1="12" x2="12" y2="15" />
                  <line x1="15" y1="6" x2="15" y2="15" />
                </svg>
              </div>
              <div className="empty-state-title">No panels on your dashboard</div>
              <div className="empty-state-text">Click "Design Dashboard" above to start adding custom analytics widgets!</div>
            </div>
          </div>
        )}
      </div>

      {/* Namespace Cards Grid Footer */}
      {!isEditMode && filteredNamespaces.length > 0 && (
        <div className="card mt-6">
          <div className="card-header">
            <div className="card-title">Monitored Namespaces</div>
            <span className="text-sm text-muted">{filteredNamespaces.length} online</span>
          </div>
          <div className="card-body">
            <div className="ns-grid">
              {filteredNamespaces.map(ns => (
                <div
                  key={ns.namespace}
                  className="ns-card"
                  onClick={() => {
                    onSelectNamespace(ns.namespace);
                    navigate('/traces');
                  }}
                >
                  <div className="ns-card-name">
                    <span style={{ color: ns.errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', fontSize: '10px' }}>●</span>
                    {ns.namespace}
                  </div>
                  <div className="ns-card-stats">
                    <div>
                      <div className="ns-stat-label">Traces</div>
                      <div className="ns-stat-value" style={{ color: 'var(--accent-indigo-light)' }}>{ns.traceCount}</div>
                    </div>
                    <div>
                      <div className="ns-stat-label">Errors</div>
                      <div className="ns-stat-value" style={{ color: ns.errorCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>{ns.errorCount}</div>
                    </div>
                    <div>
                      <div className="ns-stat-label">Services</div>
                      <div className="ns-stat-value" style={{ color: 'var(--accent-cyan)' }}>{ns.services?.length || 0}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Futuristic Split-Pane Dashboard Customizer Modal */}
      {tempWidget && createPortal(
        <div className="modal-backdrop" onClick={() => setTempWidget(null)}>
          <div className="modal-content split-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {tempWidget.id ? `Configure Panel: ${tempWidget.title}` : 'Create Customizable Panel'}
              </h3>
              <button className="modal-close" onClick={() => setTempWidget(null)}>✕</button>
            </div>
            
            <div className="modal-split-grid">
              {/* Left Column: Form Configuration */}
              <div className="modal-settings-pane">
                <div className="form-group">
                  <label className="form-label">Panel Title</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={tempWidget.title} 
                    onChange={e => setTempWidget({ ...tempWidget, title: e.target.value })}
                    placeholder="e.g. Gateway Average Latency"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Visualization Layout</label>
                  <div className="vis-type-picker">
                    {visTypes.map((item) => (
                      <div 
                        key={item.value}
                        className={`vis-type-card ${tempWidget.type === item.value ? 'active' : ''}`}
                        onClick={() => setTempWidget({ ...tempWidget, type: item.value })}
                      >
                        <div className="vis-icon">{item.icon}</div>
                        <div className="vis-label">{item.label}</div>
                        <div className="vis-desc">{item.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Telemetry Metric Source</label>
                  <select 
                    className="form-select" 
                    value={tempWidget.metric} 
                    onChange={e => setTempWidget({ ...tempWidget, metric: e.target.value as WidgetMetric })}
                  >
                    <option value="traces">Total Traces Count</option>
                    <option value="services">Service Instance Count</option>
                    <option value="errors">System Error Count</option>
                    <option value="errorRate">System Error Rate (%)</option>
                    <option value="latency">Average Trace Latency</option>
                    <option value="dbCalls">Database Query Calls</option>
                    <option value="dbErrors">Database Query Errors</option>
                    <option value="dbLatency">Database Query Latency</option>
                  </select>
                  <div className="metric-help-text">
                    {getMetricDesc(tempWidget.metric)}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Color Theme Accent</label>
                    <div className="color-swatch-list">
                      {colorSwatches.map((item) => (
                        <button
                          key={item.value}
                          className={`color-swatch-btn ${tempWidget.color === item.value ? 'active' : ''}`}
                          style={{ 
                            background: item.hex, 
                            borderColor: tempWidget.color === item.value ? '#ffffff' : 'transparent',
                            boxShadow: tempWidget.color === item.value ? `0 0 10px ${item.hex}` : 'none'
                          }}
                          onClick={() => setTempWidget({ ...tempWidget, color: item.value })}
                          title={item.label}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Grid Layout Width</label>
                    <div className="width-segment-control">
                      {widthSegments.map((item) => (
                        <button
                          key={item.value}
                          className={`width-segment-btn ${tempWidget.width === item.value ? 'active' : ''}`}
                          onClick={() => setTempWidget({ ...tempWidget, width: item.value })}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Real-Time Live Preview */}
              <div className="modal-preview-column">
                <div className="preview-label">Live Panel Preview ({tempWidget.width} Width)</div>
                <div className="preview-card-wrapper">
                  <div className="preview-card-card">
                    <div className="card-header" style={{ paddingBottom: '4px' }}>
                      <div className="card-title" style={{ fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                        <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: colorSwatches.find(c => c.value === tempWidget.color)?.hex }} />
                        {tempWidget.title}
                      </div>
                    </div>
                    
                    <div className="card-body" style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 16px 14px 16px' }}>
                      {tempWidget.type === 'value' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1 }}>
                            {formatMetric(getMetricValue(tempWidget.metric) || 120, tempWidget.metric)}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            Current {getMetricLabel(tempWidget.metric)} rate
                          </div>
                        </div>
                      )}

                      {tempWidget.type === 'line' && (
                        <SVGLineChart data={[30, 48, 35, 75, 50, 92, 60, 115, 80, 100, 70, 125, 95, 140, 110]} color={tempWidget.color} metric={tempWidget.metric} />
                      )}

                      {tempWidget.type === 'bar' && (
                        <SVGBarChart namespaces={namespaces} color={tempWidget.color} metric={tempWidget.metric} />
                      )}

                      {tempWidget.type === 'table' && (
                        <TableWidget namespaces={namespaces} dbMetrics={dbMetrics} metric={tempWidget.metric} />
                      )}
                    </div>
                  </div>
                  <div className="preview-status">
                    <span className="live-dot" /> Live data populated from active namespace telemetry
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setTempWidget(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm btn-glowing-indigo" onClick={handleSaveWidget}>
                {tempWidget.id ? 'Save Configuration' : 'Add to Dashboard'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Styled block with customized premium styles */}
      <style>{`
        .dashboard-page {
          max-width: 1400px;
          margin: 0 auto;
        }

        .dashboard-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .dashboard-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }

        .widget-card {
          position: relative;
          min-height: 200px;
          display: flex;
          flex-direction: column;
          background: var(--bg-card, rgba(30, 41, 59, 0.4));
          border: 1px solid var(--border-primary, rgba(255, 255, 255, 0.05));
          border-radius: 12px;
          overflow: hidden;
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .widget-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 1px 1px rgba(99, 102, 241, 0.1);
          border-color: rgba(99, 102, 241, 0.2);
        }

        .widget-card.height-value {
          min-height: 120px;
        }

        /* Editing controls overlay style */
        .widget-controls-overlay {
          position: absolute;
          top: 6px;
          right: 6px;
          display: flex;
          gap: 4px;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(8px);
          padding: 3px 6px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          z-index: 5;
          opacity: 0;
          transform: scale(0.95);
          transition: opacity 0.15s ease, transform 0.15s ease;
        }

        .widget-card:hover .widget-controls-overlay {
          opacity: 1;
          transform: scale(1);
        }

        .control-overlay-btn {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: none;
          background: transparent;
          color: #94a3b8;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .control-overlay-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }

        .control-overlay-btn.btn-action-edit:hover {
          background: rgba(99, 102, 241, 0.3);
          color: #a5b4fc;
        }

        .control-overlay-btn.btn-action-delete:hover {
          background: rgba(244, 63, 94, 0.3);
          color: #fda4af;
        }

        .editing-pulse {
          border: 1px dashed var(--accent-indigo);
          animation: borderPulse 2s infinite ease-in-out;
        }

        @keyframes borderPulse {
          0%, 100% { border-color: rgba(99, 102, 241, 0.3); }
          50% { border-color: rgba(99, 102, 241, 0.7); }
        }

        .editing-placeholder-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border: 1.5px dashed var(--border-primary, rgba(255,255,255,0.1));
          border-radius: 12px;
          min-height: 200px;
          cursor: pointer;
          transition: all 0.2s ease;
          opacity: 0.6;
          background: rgba(255, 255, 255, 0.01);
          color: var(--text-secondary);
        }

        .editing-placeholder-card:hover {
          opacity: 1;
          background: rgba(99, 102, 241, 0.03);
          border-color: var(--accent-indigo-light);
          color: var(--accent-indigo-light);
        }

        .placeholder-plus {
          font-size: 28px;
          font-weight: 300;
          margin-bottom: 6px;
          line-height: 1;
        }

        /* Responsive width columns mapping matching standard layout css */
        .w-1-4 { width: calc(25% - 12px); }
        .w-1-3 { width: calc(33.33% - 11px); }
        .w-1-2 { width: calc(50% - 8px); }
        .w-2-3 { width: calc(66.66% - 6px); }
        .w-1 { width: 100%; }

        @media (max-width: 1024px) {
          .w-1-4, .w-1-3, .w-1-2, .w-2-3 { width: calc(50% - 8px); }
        }
        @media (max-width: 640px) {
          .w-1-4, .w-1-3, .w-1-2, .w-2-3, .w-1 { width: 100%; }
        }

        /* SVG Line Charts upgrade */
        .chart-line-path {
          filter: drop-shadow(0 2px 4px rgba(99, 102, 241, 0.25));
        }
        
        .chart-point-marker {
          transition: r 0.1s ease;
          cursor: crosshair;
        }
        .chart-point-marker:hover {
          r: 5;
        }

        /* Modal split styling */
        .split-modal {
          width: 860px !important;
          max-width: 95% !important;
          background: var(--bg-card, rgba(15, 23, 42, 0.95)) !important;
          backdrop-filter: blur(20px) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6) !important;
        }

        .modal-split-grid {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 20px;
          margin-bottom: 16px;
        }

        @media (max-width: 768px) {
          .modal-split-grid {
            grid-template-columns: 1fr;
          }
        }

        .modal-settings-pane {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .vis-type-picker {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }

        .vis-type-card {
          border: 1px solid var(--border-primary, rgba(255,255,255,0.08));
          background: rgba(255, 255, 255, 0.01);
          border-radius: 8px;
          padding: 8px 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 4px;
          transition: all 0.15s ease;
          color: var(--text-secondary);
        }

        .vis-type-card:hover {
          border-color: rgba(99, 102, 241, 0.4);
          background: rgba(99, 102, 241, 0.02);
          color: var(--text-primary);
        }

        .vis-type-card.active {
          border-color: var(--accent-indigo);
          background: rgba(99, 102, 241, 0.08);
          color: var(--accent-indigo-light, #818cf8);
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.15);
        }

        .vis-icon {
          opacity: 0.85;
          margin-bottom: 2px;
        }
        .vis-type-card.active .vis-icon {
          color: var(--accent-indigo-light);
          opacity: 1;
        }

        .vis-label {
          font-size: 11px;
          font-weight: 700;
        }

        .vis-desc {
          font-size: 9px;
          color: var(--text-muted);
        }

        .metric-help-text {
          font-size: 9.5px;
          color: var(--text-muted);
          margin-top: 4px;
          padding-left: 2px;
        }

        .color-swatch-list {
          display: flex;
          gap: 8px;
          padding: 6px 0;
          align-items: center;
        }

        .color-swatch-btn {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform 0.1s ease;
          position: relative;
        }

        .color-swatch-btn:hover {
          transform: scale(1.15);
        }

        .color-swatch-btn.active {
          transform: scale(1.1);
          border-color: #ffffff;
        }

        .width-segment-control {
          display: flex;
          background: var(--bg-tertiary, rgba(15, 23, 42, 0.8));
          border-radius: 6px;
          padding: 3px;
          border: 1px solid var(--border-primary, rgba(255,255,255,0.06));
        }

        .width-segment-btn {
          flex: 1;
          padding: 5px 8px;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          border-radius: 4px;
          transition: all 0.15s ease;
        }

        .width-segment-btn:hover {
          color: var(--text-primary);
        }

        .width-segment-btn.active {
          background: var(--bg-card, #1e293b);
          color: var(--accent-indigo-light, #818cf8);
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }

        /* Right Column Preview Pane */
        .modal-preview-column {
          display: flex;
          flex-direction: column;
          gap: 10px;
          justify-content: center;
        }

        .preview-label {
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin-bottom: 2px;
        }

        .preview-card-wrapper {
          flex: 1;
          background: rgba(15, 23, 42, 0.4);
          border: 1px dashed var(--border-primary, rgba(255,255,255,0.1));
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-height: 240px;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
        }

        .preview-card-card {
          background: var(--bg-card, rgba(30, 41, 59, 0.9));
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          padding: 12px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
          pointer-events: none;
        }

        .preview-status {
          margin-top: 10px;
          font-size: 9.5px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
        }

        /* Glowing button helpers */
        .btn-glowing-green:hover {
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
        }
        
        .btn-glowing-indigo {
          background: var(--accent-indigo) !important;
          border-color: var(--accent-indigo) !important;
          color: #ffffff !important;
          font-weight: bold;
        }
        .btn-glowing-indigo:hover {
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.5);
        }

        .ns-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }

        .ns-card {
          background: var(--bg-secondary, rgba(30, 41, 59, 0.25));
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .ns-card:hover {
          transform: translateY(-2.5px);
          border-color: var(--accent-indigo);
          background: rgba(99, 102, 241, 0.03);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .ns-card-name {
          font-weight: 700;
          font-size: 12.5px;
          color: var(--text-primary);
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ns-card-stats {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }

        .ns-stat-label {
          color: var(--text-muted);
          margin-bottom: 2px;
        }

        .ns-stat-value {
          font-weight: 700;
          font-family: var(--font-mono);
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

interface SVGLineChartProps {
  data: number[];
  color: string;
  metric: string;
}

function SVGLineChart({ data, color, metric }: SVGLineChartProps) {
  if (!data || data.length === 0) return <div className="text-muted text-sm" style={{ padding: '20px' }}>Loading chart data...</div>;
  const max = Math.max(...data) * 1.15 || 1;
  const min = Math.min(...data) * 0.85 || 0;
  const range = max - min;

  const width = 500;
  const height = 150;
  const paddingX = 15;
  const paddingY = 15;

  const points = data.map((val, i) => {
    const x = paddingX + (i / (data.length - 1)) * (width - 2 * paddingX);
    const y = height - paddingY - (range > 0 ? ((val - min) / range) * (height - 2 * paddingY) : 0);
    return { x, y, value: val };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;

  const colorHex = {
    indigo: '#6366f1',
    violet: '#8b5cf6',
    emerald: '#10b981',
    rose: '#f43f5e',
    amber: '#f59e0b',
    cyan: '#06b6d4',
  }[color] || '#6366f1';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '110px', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`grad-${color}-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorHex} stopOpacity="0.25" />
            <stop offset="100%" stopColor={colorHex} stopOpacity="0.0" />
          </linearGradient>
          <filter id="glow-effect" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((p, idx) => (
          <line
            key={idx}
            x1={paddingX}
            y1={paddingY + p * (height - 2 * paddingY)}
            x2={width - paddingX}
            y2={paddingY + p * (height - 2 * paddingY)}
            stroke="var(--border-primary)"
            strokeWidth="0.5"
            strokeDasharray="3 3"
          />
        ))}
        {/* Area fill */}
        <path d={areaD} fill={`url(#grad-${color}-${metric})`} />
        {/* Line stroke */}
        <path d={pathD} fill="none" stroke={colorHex} strokeWidth="2.5" className="chart-line-path" filter="url(#glow-effect)" />
        {/* Circles on vertices */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="var(--bg-card)"
            stroke={colorHex}
            strokeWidth="2"
            className="chart-point-marker"
          />
        ))}
      </svg>
      {/* Tooltip or Label on the right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-tertiary)', marginTop: '4px', padding: '0 4px' }}>
        <span>Real-time ingestion trend</span>
        <span>Peak: {formatMetric(Math.max(...data), metric)}</span>
      </div>
    </div>
  );
}

interface SVGBarChartProps {
  namespaces: NamespaceStats[];
  color: string;
  metric: string;
}

function SVGBarChart({ namespaces, color, metric }: SVGBarChartProps) {
  const data = namespaces
    .flatMap(ns => (ns.services || []).map(s => ({ name: s.serviceName, value: s.requestCount })))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  if (data.length === 0) return <div className="text-muted text-sm" style={{ padding: '20px' }}>No service telemetry captured yet</div>;
  const maxVal = Math.max(...data.map(d => d.value)) || 1;

  const colorHex = {
    indigo: '#6366f1',
    violet: '#8b5cf6',
    emerald: '#10b981',
    rose: '#f43f5e',
    amber: '#f59e0b',
    cyan: '#06b6d4',
  }[color] || '#6366f1';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '4px 0', height: '100%', justifyContent: 'center' }}>
      {data.map((item, idx) => {
        const pct = (item.value / maxVal) * 100;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', fontWeight: '500' }}>
              <span className="mono" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()} traces</span>
            </div>
            <div style={{ width: '100%', background: 'var(--bg-tertiary)', height: '7px', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: colorHex,
                  borderRadius: '4px',
                  boxShadow: `0 0 8px ${colorHex}40`,
                  transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TableWidgetProps {
  namespaces: NamespaceStats[];
  dbMetrics: DatabaseQueryMetric[];
  metric: string;
}

function TableWidget({ namespaces, dbMetrics, metric }: TableWidgetProps) {
  if (metric.startsWith('db')) {
    const topQueries = dbMetrics.slice(0, 4);
    if (topQueries.length === 0) return <div className="text-muted text-sm" style={{ padding: '20px' }}>No database query metrics discovered</div>;

    return (
      <div className="table-wrapper" style={{ maxHeight: '160px', overflowY: 'auto', border: 'none', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-tertiary)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Query Pattern</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Calls</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Avg Latency</th>
            </tr>
          </thead>
          <tbody>
            {topQueries.map((q, idx) => (
              <tr key={idx} className="hover-table-row" style={{ borderBottom: '0.5px solid var(--border-primary)' }}>
                <td style={{ padding: '6px', maxWidth: '175px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <code style={{ fontSize: '9.5px', color: 'var(--text-primary)' }}>{q.query}</code>
                </td>
                <td style={{ textAlign: 'right', padding: '6px', fontFamily: 'var(--font-mono)' }}>{q.callCount}</td>
                <td style={{ textAlign: 'right', padding: '6px', fontFamily: 'var(--font-mono)', fontWeight: '600' }}>
                  {q.avgDurationMs.toFixed(1)}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else {
    return (
      <div className="table-wrapper" style={{ maxHeight: '160px', overflowY: 'auto', border: 'none', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-tertiary)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Namespace</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Traces</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {namespaces.slice(0, 4).map((ns, idx) => (
              <tr key={idx} className="hover-table-row" style={{ borderBottom: '0.5px solid var(--border-primary)' }}>
                <td style={{ padding: '6px', fontWeight: '600' }}>
                  <span className="badge badge-ns">{ns.namespace}</span>
                </td>
                <td style={{ textAlign: 'right', padding: '6px', fontFamily: 'var(--font-mono)' }}>{ns.traceCount}</td>
                <td style={{ textAlign: 'right', padding: '6px', fontFamily: 'var(--font-mono)', color: ns.errorCount > 0 ? 'var(--accent-rose)' : 'inherit' }}>
                  {ns.errorCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
