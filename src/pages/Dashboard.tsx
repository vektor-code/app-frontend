import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type NamespaceStats, type DatabaseQueryMetric } from '../api/client';

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
  
  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);

  // New Widget template state
  const [newWidget, setNewWidget] = useState<Omit<Widget, 'id'>>({
    title: 'New Observability Panel',
    type: 'line',
    metric: 'latency',
    width: '1/2',
    color: 'indigo'
  });

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
            // Check if we need to append a new live data point
            // Only push if the last point differs or every 5s poll interval updates it
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

  // Add widget
  const addWidget = () => {
    const newPanel: Widget = {
      ...newWidget,
      id: Date.now().toString()
    };
    const updated = [...widgets, newPanel];
    saveWidgetsConfig(updated);
    setShowAddModal(false);
  };

  // Update widget settings
  const saveWidgetSettings = (updated: Widget) => {
    const updatedList = widgets.map(w => w.id === updated.id ? updated : w);
    saveWidgetsConfig(updatedList);
    setEditingWidget(null);
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

  return (
    <div className="animate-fade-in">
      {/* Title section */}
      <h1 className="page-title">Customizable Dashboard</h1>
      <p className="page-subtitle">
        {selectedNamespace ? `Custom telemetry layout for ${selectedNamespace}` : 'Custom telemetry layout across all namespaces'}
      </p>

      {/* Dashboard Toolbar */}
      <div className="dashboard-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select className="filter-select" style={{ padding: '6px 12px' }} value={timeRange} onChange={e => setTimeRange(e.target.value)}>
            <option value="5m">Last 5 Minutes</option>
            <option value="15m">Last 15 Minutes</option>
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
          </select>
          <button className="btn btn-ghost btn-sm" onClick={loadDbMetrics}>
            ↻ Refresh
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isEditMode && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)} style={{ background: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }}>
              ＋ Add Panel
            </button>
          )}
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={() => setIsEditMode(!isEditMode)}
            style={{ 
              background: isEditMode ? 'var(--accent-indigo)' : 'var(--bg-secondary)', 
              color: isEditMode ? '#ffffff' : 'var(--text-primary)',
              borderColor: isEditMode ? 'var(--accent-indigo)' : 'var(--border-primary)'
            }}
          >
            {isEditMode ? '💾 Save Layout' : '⚙️ Design Dashboard'}
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
              {/* Controls */}
              {isEditMode && (
                <div className="widget-controls">
                  <button className="control-btn" title="Move Left" onClick={() => moveWidget(index, 'left')}>◀</button>
                  <button className="control-btn" title="Move Right" onClick={() => moveWidget(index, 'right')}>▶</button>
                  <button className="control-btn" title="Edit Settings" onClick={() => setEditingWidget(w)}>✏️</button>
                  <button className="control-btn delete-btn" title="Remove Panel" onClick={() => deleteWidget(w.id)}>❌</button>
                </div>
              )}

              <div className="card-header" style={{ paddingBottom: '8px' }}>
                <div className="card-title" style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: `var(--accent-${w.color})` }}>●</span>
                  {w.title}
                </div>
              </div>

              <div className="card-body" style={{ flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '12px 16px' }}>
                {w.type === 'value' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1 }}>
                      {formatMetric(val, w.metric)}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
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

        {widgets.length === 0 && (
          <div className="card w-1" style={{ padding: '40px' }}>
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No panels on your dashboard</div>
              <div className="empty-state-text">Click "Design Dashboard" above to start adding custom analytics widgets!</div>
            </div>
          </div>
        )}
      </div>

      {/* Namespace Cards Grid Footer (original KubeTrace view context) */}
      {!isEditMode && filteredNamespaces.length > 0 && (
        <div className="card mt-6">
          <div className="card-header">
            <div className="card-title">📦 Monitored Namespaces</div>
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

      {/* 1. Modal: Add New Panel */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">＋ Add Custom Analytics Panel</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Panel Title</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newWidget.title} 
                  onChange={e => setNewWidget({ ...newWidget, title: e.target.value })}
                  placeholder="e.g. Gateway Average Latency"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Visualization Type</label>
                  <select 
                    className="form-select" 
                    value={newWidget.type} 
                    onChange={e => setNewWidget({ ...newWidget, type: e.target.value as WidgetType })}
                  >
                    <option value="value">Single Stat Value</option>
                    <option value="line">SVG Line Chart</option>
                    <option value="bar">Comparison Bar Chart</option>
                    <option value="table">Data Summary Table</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Telemetry Metric Source</label>
                  <select 
                    className="form-select" 
                    value={newWidget.metric} 
                    onChange={e => setNewWidget({ ...newWidget, metric: e.target.value as WidgetMetric })}
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
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Panel Width (Grid Layout)</label>
                  <select 
                    className="form-select" 
                    value={newWidget.width} 
                    onChange={e => setNewWidget({ ...newWidget, width: e.target.value as WidgetWidth })}
                  >
                    <option value="1/4">Small (25%)</option>
                    <option value="1/3">Medium-Small (33%)</option>
                    <option value="1/2">Medium (50%)</option>
                    <option value="2/3">Medium-Large (66%)</option>
                    <option value="1">Full Width (100%)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Color Theme Accent</label>
                  <select 
                    className="form-select" 
                    value={newWidget.color} 
                    onChange={e => setNewWidget({ ...newWidget, color: e.target.value as WidgetColor })}
                  >
                    <option value="indigo">Indigo</option>
                    <option value="violet">Violet</option>
                    <option value="emerald">Emerald</option>
                    <option value="rose">Rose</option>
                    <option value="amber">Amber</option>
                    <option value="cyan">Cyan</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={addWidget}>Create Panel</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Edit Existing Panel */}
      {editingWidget && (
        <div className="modal-backdrop" onClick={() => setEditingWidget(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚙️ Configure Panel: {editingWidget.title}</h3>
              <button className="modal-close" onClick={() => setEditingWidget(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Panel Title</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editingWidget.title} 
                  onChange={e => setEditingWidget({ ...editingWidget, title: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Visualization Type</label>
                  <select 
                    className="form-select" 
                    value={editingWidget.type} 
                    onChange={e => setEditingWidget({ ...editingWidget, type: e.target.value as WidgetType })}
                  >
                    <option value="value">Single Stat Value</option>
                    <option value="line">SVG Line Chart</option>
                    <option value="bar">Comparison Bar Chart</option>
                    <option value="table">Data Summary Table</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Telemetry Metric Source</label>
                  <select 
                    className="form-select" 
                    value={editingWidget.metric} 
                    onChange={e => setEditingWidget({ ...editingWidget, metric: e.target.value as WidgetMetric })}
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
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Panel Width (Grid Layout)</label>
                  <select 
                    className="form-select" 
                    value={editingWidget.width} 
                    onChange={e => setEditingWidget({ ...editingWidget, width: e.target.value as WidgetWidth })}
                  >
                    <option value="1/4">Small (25%)</option>
                    <option value="1/3">Medium-Small (33%)</option>
                    <option value="1/2">Medium (50%)</option>
                    <option value="2/3">Medium-Large (66%)</option>
                    <option value="1">Full Width (100%)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Color Theme Accent</label>
                  <select 
                    className="form-select" 
                    value={editingWidget.color} 
                    onChange={e => setEditingWidget({ ...editingWidget, color: e.target.value as WidgetColor })}
                  >
                    <option value="indigo">Indigo</option>
                    <option value="violet">Violet</option>
                    <option value="emerald">Emerald</option>
                    <option value="rose">Rose</option>
                    <option value="amber">Amber</option>
                    <option value="cyan">Cyan</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingWidget(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={() => saveWidgetSettings(editingWidget)}>Save Configuration</button>
            </div>
          </div>
        </div>
      )}
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
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '140px', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`grad-${color}-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colorHex} stopOpacity="0.25" />
            <stop offset="100%" stopColor={colorHex} stopOpacity="0.0" />
          </linearGradient>
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
        <path d={pathD} fill="none" stroke={colorHex} strokeWidth="2.5" className="chart-line-path" />
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '8px', padding: '0 4px' }}>
        <span>Time interval (5s polls)</span>
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
  // Extract top 5 services by requests
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0', height: '100%', justifyContent: 'center' }}>
      {data.map((item, idx) => {
        const pct = (item.value / maxVal) * 100;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '500' }}>
              <span className="mono" style={{ color: 'var(--text-primary)' }}>{item.name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{item.value.toLocaleString()} traces</span>
            </div>
            <div style={{ width: '100%', background: 'var(--bg-tertiary)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: colorHex,
                  borderRadius: '4px',
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
      <div className="table-wrapper" style={{ maxHeight: '180px', overflowY: 'auto', border: 'none', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-tertiary)' }}>
              <th style={{ textAlign: 'left', padding: '6px' }}>Query Pattern</th>
              <th style={{ textAlign: 'right', padding: '6px' }}>Calls</th>
              <th style={{ textAlign: 'right', padding: '6px' }}>Avg Latency</th>
            </tr>
          </thead>
          <tbody>
            {topQueries.map((q, idx) => (
              <tr key={idx} className="hover-table-row" style={{ borderBottom: '0.5px solid var(--border-primary)' }}>
                <td style={{ padding: '8px 6px', maxWidth: '185px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <code style={{ fontSize: '10px', color: 'var(--text-primary)' }}>{q.query}</code>
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontFamily: 'var(--font-mono)' }}>{q.callCount}</td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontFamily: 'var(--font-mono)', fontWeight: '600' }}>
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
      <div className="table-wrapper" style={{ maxHeight: '180px', overflowY: 'auto', border: 'none', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-primary)', color: 'var(--text-tertiary)' }}>
              <th style={{ textAlign: 'left', padding: '6px' }}>Namespace</th>
              <th style={{ textAlign: 'right', padding: '6px' }}>Traces</th>
              <th style={{ textAlign: 'right', padding: '6px' }}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {namespaces.map((ns, idx) => (
              <tr key={idx} className="hover-table-row" style={{ borderBottom: '0.5px solid var(--border-primary)' }}>
                <td style={{ padding: '8px 6px', fontWeight: '600' }}>
                  <span className="badge badge-ns">{ns.namespace}</span>
                </td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontFamily: 'var(--font-mono)' }}>{ns.traceCount}</td>
                <td style={{ textAlign: 'right', padding: '8px 6px', fontFamily: 'var(--font-mono)', color: ns.errorCount > 0 ? 'var(--accent-rose)' : 'inherit' }}>
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
