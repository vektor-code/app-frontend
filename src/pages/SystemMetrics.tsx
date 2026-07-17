import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { PodMetricInfo } from '../entities';

interface SystemMetricsProps {
  namespace: string;
}

export default function SystemMetrics({ namespace }: SystemMetricsProps) {
  const [pods, setPods] = useState<PodMetricInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPhase, setFilterPhase] = useState<string>('all');
  
  // Track CPU usage history for live sparkline rendering
  const [metricsHistory, setMetricsHistory] = useState<Record<string, number[]>>({});

  const loadPods = useCallback(async () => {
    try {
      const res = await api.getPods(namespace || undefined);
      const podList = res.pods || [];
      setPods(podList);

      // Append new CPU points to history for sparklines
      setMetricsHistory(prev => {
        const next = { ...prev };
        podList.forEach(p => {
          const hist = prev[p.name] || [];
          next[p.name] = [...hist.slice(-9), p.cpuUsage];
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to load pods metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    loadPods();
    const interval = setInterval(loadPods, 4000);
    return () => clearInterval(interval);
  }, [loadPods]);

  const filteredPods = pods.filter(p => {
    const nameStr = p.name || '';
    const nodeStr = p.nodeName || '';
    const labelsObj = p.labels || {};
    const phaseStr = p.phase || '';

    const matchesSearch = nameStr.toLowerCase().includes(search.toLowerCase()) || 
                          nodeStr.toLowerCase().includes(search.toLowerCase()) ||
                          Object.entries(labelsObj).some(([k, v]) => k.includes(search) || String(v).includes(search));
    const matchesPhase = filterPhase === 'all' || phaseStr.toLowerCase() === filterPhase.toLowerCase();
    return matchesSearch && matchesPhase;
  });

  // Calculate status summary stats
  const totalPods = pods.length;
  const runningPods = pods.filter(p => p.phase === 'Running').length;
  const pendingPods = pods.filter(p => p.phase === 'Pending').length;
  const failedPods = pods.filter(p => p.phase === 'Failed' || p.phase === 'Unknown').length;

  return (
    <div className="metrics-page-wrapper">
      {/* Overview stats cards */}
      <div className="stats-cards-grid">
        <div className="stat-card stat-total">
          <div className="stat-card-label">Total Pods</div>
          <div className="stat-card-value">{totalPods}</div>
        </div>
        <div className="stat-card stat-running">
          <div className="stat-card-label">Running</div>
          <div className="stat-card-value">{runningPods}</div>
        </div>
        <div className="stat-card stat-pending">
          <div className="stat-card-label">Pending</div>
          <div className="stat-card-value">{pendingPods}</div>
        </div>
        <div className="stat-card stat-failed">
          <div className="stat-card-label">Failed</div>
          <div className="stat-card-value">{failedPods}</div>
        </div>
      </div>

      {/* Filters bar */}
      <div className="filters-bar-wrapper">
        <div className="search-box-wrapper" style={{ flex: '1', minWidth: '240px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search pods by name, node, or labels..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-select"
            style={{ width: '100%', paddingLeft: '32px' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`tab-btn ${filterPhase === 'all' ? 'active' : ''}`}
            onClick={() => setFilterPhase('all')}
          >
            All Phase
          </button>
          <button 
            className={`tab-btn running-btn ${filterPhase === 'running' ? 'active' : ''}`}
            onClick={() => setFilterPhase('running')}
          >
            Running
          </button>
          <button 
            className={`tab-btn failed-btn ${filterPhase === 'failed' ? 'active' : ''}`}
            onClick={() => setFilterPhase('failed')}
          >
            Failed
          </button>
        </div>
      </div>

      {loading && pods.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
          <div className="loading-spinner" />
        </div>
      ) : filteredPods.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No pods found in namespace "{namespace || 'all'}"</div>
        </div>
      ) : (
        <div className="pods-grid">
          {filteredPods.map(pod => {
            const cpuPercent = (pod.cpuUsage / pod.cpuLimit) * 100;
            const memPercent = (pod.memoryUsage / pod.memoryLimit) * 100;
            const isFailed = pod.phase === 'Failed' || pod.phase === 'Unknown';
            const history = metricsHistory[pod.name] || [];

            // Draw sparkline points
            const maxVal = Math.max(...history, 1);
            const points = history.map((val, idx) => {
              const x = (idx / 9) * 100; // 10 points
              const y = 30 - (val / maxVal) * 26; // Height is 30px
              return `${x},${y}`;
            }).join(' ');

            return (
              <div key={pod.name} className={`pod-card ${isFailed ? 'failed' : ''}`}>
                <div className="pod-card-header">
                  <div className="pod-title-section">
                    <span className="k8s-pod-icon">⎈</span>
                    <span className="pod-name" title={pod.name}>{pod.name}</span>
                  </div>
                  <span className={`pod-phase-badge ${pod.phase.toLowerCase()}`}>
                    {pod.phase}
                  </span>
                </div>

                <div className="pod-card-details">
                  <div className="detail-item">
                    <span className="detail-label">Node:</span>
                    <span className="detail-value">{pod.nodeName || 'N/A'}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Restarts:</span>
                    <span className={`detail-value ${pod.restartCount > 0 ? 'restarts-warn' : ''}`}>
                      {pod.restartCount}
                    </span>
                  </div>
                </div>

                {/* CPU usage section */}
                <div className="resource-section">
                  <div className="resource-header">
                    <span className="resource-title">CPU Utilization</span>
                    <span className="resource-value">
                      {pod.cpuUsage.toFixed(0)}m / {pod.cpuLimit.toFixed(0)}m ({cpuPercent.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="progress-bar-bg">
                    <div 
                      className="progress-bar-fill cpu" 
                      style={{ 
                        width: `${Math.min(100, cpuPercent)}%`,
                        background: cpuPercent > 80 ? 'var(--accent-rose)' : cpuPercent > 50 ? 'var(--accent-amber)' : 'var(--accent-indigo)'
                      }} 
                    />
                  </div>
                </div>

                {/* Memory usage section */}
                <div className="resource-section">
                  <div className="resource-header">
                    <span className="resource-title">Memory Allocation</span>
                    <span className="resource-value">
                      {pod.memoryUsage.toFixed(0)}MB / {pod.memoryLimit.toFixed(0)}MB ({memPercent.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="progress-bar-bg">
                    <div 
                      className="progress-bar-fill memory" 
                      style={{ 
                        width: `${Math.min(100, memPercent)}%`,
                        background: memPercent > 85 ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                      }} 
                    />
                  </div>
                </div>

                {/* Real-time CPU trend sparkline */}
                {!isFailed && history.length > 0 && (
                  <div className="sparkline-container">
                    <span className="sparkline-title">Real-time CPU Trend (last 40s)</span>
                    <svg className="sparkline-svg" viewBox="0 0 100 30">
                      <polyline
                        fill="none"
                        stroke="var(--accent-indigo)"
                        strokeWidth="1.5"
                        points={points}
                      />
                    </svg>
                  </div>
                )}

                {/* Pod Labels */}
                <div className="pod-labels-tags">
                  {Object.entries(pod.labels || {}).slice(0, 4).map(([k, v]) => (
                    <span key={k} className="label-tag" title={`${k}=${v}`}>
                      {k.length > 8 ? k.slice(0, 8) + '…' : k}:{v.length > 10 ? v.slice(0, 10) + '…' : v}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .metrics-page-wrapper {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .stats-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
        }

        .stat-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: var(--shadow-sm);
        }

        .stat-card-label {
          font-size: 12px;
          color: var(--text-tertiary);
          font-weight: 500;
        }

        .stat-card-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .stat-card.stat-total { border-left: 4px solid var(--accent-indigo); }
        .stat-card.stat-running { border-left: 4px solid var(--accent-emerald); }
        .stat-card.stat-pending { border-left: 4px solid var(--accent-amber); }
        .stat-card.stat-failed { border-left: 4px solid var(--accent-rose); }

        .filters-bar-wrapper {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .pods-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }

        .pod-card {
          background: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-shadow: var(--shadow-sm);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .pod-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .pod-card.failed {
          border: 1px solid rgba(244, 63, 94, 0.3);
        }

        .pod-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .pod-title-section {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
        }

        .k8s-pod-icon {
          color: var(--accent-indigo);
          font-size: 16px;
        }

        .pod-name {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pod-phase-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 20px;
          text-transform: uppercase;
        }

        .pod-phase-badge.running {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-emerald);
        }

        .pod-phase-badge.pending {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-amber);
        }

        .pod-phase-badge.failed, .pod-phase-badge.unknown {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-rose);
        }

        .pod-card-details {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .detail-item {
          display: flex;
          gap: 4px;
        }

        .detail-label {
          color: var(--text-tertiary);
        }

        .detail-value {
          font-weight: 500;
        }

        .detail-value.restarts-warn {
          color: var(--accent-rose);
          font-weight: bold;
        }

        .resource-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .resource-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }

        .resource-title {
          color: var(--text-tertiary);
          font-weight: 500;
        }

        .resource-value {
          color: var(--text-secondary);
          font-weight: 600;
        }

        .progress-bar-bg {
          height: 6px;
          background: var(--border-secondary);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease-in-out;
        }

        .sparkline-container {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sparkline-title {
          font-size: 10px;
          color: var(--text-muted);
        }

        .sparkline-svg {
          width: 100%;
          height: 30px;
          background: var(--bg-tertiary);
          border-radius: 4px;
          border: 1px solid var(--border-secondary);
        }

        .pod-labels-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .label-tag {
          font-size: 10px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-secondary);
          color: var(--text-secondary);
          padding: 2px 6px;
          border-radius: 4px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border-secondary);
          border-top-color: var(--accent-indigo);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
