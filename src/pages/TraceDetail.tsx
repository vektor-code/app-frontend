import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Trace, type DiagnosticReport } from '../api/client';
import SpanTimeline from '../components/SpanTimeline';

export default function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    
    Promise.all([
      api.getTrace(traceId),
      api.getTraceDiagnostics(traceId).catch(() => null)
    ])
      .then(([traceData, diagData]) => {
        setTrace(traceData);
        setDiagnostics(diagData);
      })
      .catch(() => {
        setTrace(null);
        setDiagnostics(null);
      })
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) return <div className="empty-state"><div className="empty-state-title">Loading trace...</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-icon">❌</div><div className="empty-state-title">Trace not found</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="animate-fade-in trace-detail">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Trace Detail</h1>
      </div>

      <div className="trace-meta">
        <div className="trace-meta-item">
          <span className="trace-meta-label">Trace ID</span>
          <span className="trace-meta-value" style={{ color: 'var(--accent-indigo-light)' }}>{trace.traceId}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Root Service</span>
          <span className="trace-meta-value">{trace.serviceName}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Namespace</span>
          <span className="trace-meta-value">{trace.namespace}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Duration</span>
          <span className="trace-meta-value" style={{ color: 'var(--accent-cyan)' }}>{trace.durationMs.toFixed(2)}ms</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Spans</span>
          <span className="trace-meta-value">{trace.spanCount}</span>
        </div>
        <div className="trace-meta-item">
          <span className="trace-meta-label">Status</span>
          <span className={`badge ${trace.hasError ? 'badge-error' : 'badge-ok'}`} style={{ marginTop: '2px' }}>
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
        </div>
      </div>

      {diagnostics && (
        <div className="card diagnostics-card" style={{
          marginBottom: '24px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(139, 92, 246, 0.04) 100%)',
          border: '1px solid var(--border-accent)',
          position: 'relative',
          overflow: 'hidden',
          padding: '24px',
          borderRadius: '12px'
        }}>
          {/* Top glow decoration */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2.5px',
            background: 'var(--gradient-primary)'
          }} />
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <span style={{ fontSize: '20px' }}>🤖</span>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, background: 'var(--gradient-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Vektor Davis AI Diagnostics
            </h3>
            <span className="badge badge-ok" style={{ fontSize: '10px', padding: '2px 8px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-indigo)' }}>
              Causation Analysis Ready
            </span>
          </div>

          <p style={{ fontSize: '14.5px', lineHeight: '1.6', marginBottom: '20px', color: 'var(--text-primary)', fontWeight: '500' }}>
            {diagnostics.summary}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            {/* Left Column: Detected Issues */}
            <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
              <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                💥 Detected Anomalies & Bottlenecks
              </h4>
              {diagnostics.issues && diagnostics.issues.length > 0 ? (
                <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', margin: 0 }}>
                  {diagnostics.issues.map((issue, idx) => (
                    <li key={idx} style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No performance anomalies or errors detected.</div>
              )}
            </div>

            {/* Right Column: Suggested Remediation Steps */}
            <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
              <h4 style={{ fontSize: '13px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                💡 Recommended Actions
              </h4>
              {diagnostics.remediations && diagnostics.remediations.length > 0 ? (
                <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', margin: 0 }}>
                  {diagnostics.remediations.map((rem, idx) => (
                    <li key={idx} style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {rem}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No actions required. System is running healthy.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">⏱️ Span Waterfall</div>
          <span className="text-sm text-muted">{trace.spanCount} spans</span>
        </div>
        <div className="card-body">
          <SpanTimeline
            spans={trace.spans || []}
            traceStartTime={startMs}
            traceDuration={trace.durationMs}
          />
        </div>
      </div>
    </div>
  );
}
