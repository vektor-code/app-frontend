import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { NamespaceStats } from '../api/client';

interface DashboardProps {
  namespaces: NamespaceStats[];
  selectedNamespace: string;
  onSelectNamespace: (ns: string) => void;
}

export default function Dashboard({ namespaces, selectedNamespace, onSelectNamespace }: DashboardProps) {
  const navigate = useNavigate();

  const filtered = selectedNamespace
    ? namespaces.filter(ns => ns.namespace === selectedNamespace)
    : namespaces;

  const totalTraces = filtered.reduce((a, b) => a + b.traceCount, 0);
  const totalErrors = filtered.reduce((a, b) => a + b.errorCount, 0);
  const totalServices = filtered.reduce((a, b) => a + (b.services?.length || 0), 0);
  const avgDuration = filtered.length > 0
    ? filtered.reduce((a, b) => a + b.avgDurationMs, 0) / filtered.length
    : 0;

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Dashboard</h1>
      <p className="page-subtitle">
        {selectedNamespace ? `Showing traces for ${selectedNamespace}` : `Monitoring ${namespaces.length} namespaces across your cluster`}
      </p>

      <div className="stats-grid">
        <div className="stat-card indigo">
          <div className="stat-label">Total Traces</div>
          <div className="stat-value indigo">{totalTraces.toLocaleString()}</div>
          <div className="stat-sub">Last hour</div>
        </div>
        <div className="stat-card emerald">
          <div className="stat-label">Services</div>
          <div className="stat-value emerald">{totalServices}</div>
          <div className="stat-sub">Active</div>
        </div>
        <div className="stat-card rose">
          <div className="stat-label">Errors</div>
          <div className="stat-value rose">{totalErrors}</div>
          <div className="stat-sub">{totalTraces > 0 ? `${((totalErrors / totalTraces) * 100).toFixed(1)}% rate` : '0% rate'}</div>
        </div>
        <div className="stat-card cyan">
          <div className="stat-label">Avg Duration</div>
          <div className="stat-value cyan">{avgDuration.toFixed(1)}<span style={{ fontSize: '16px', opacity: 0.7 }}>ms</span></div>
          <div className="stat-sub">P50 latency</div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <div className="card-title">📦 Namespaces</div>
          <span className="text-sm text-muted">{filtered.length} namespaces</span>
        </div>
        <div className="card-body">
          <div className="ns-grid">
            {filtered.map(ns => (
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
          {filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-title">No traces yet</div>
              <div className="empty-state-text">Traces will appear here once your services start sending telemetry data</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
