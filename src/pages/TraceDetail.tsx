import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Trace } from '../api/client';
import SpanTimeline from '../components/SpanTimeline';

export default function TraceDetail() {
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    
    api.getTrace(traceId)
      .then((traceData) => {
        setTrace(traceData);
      })
      .catch(() => {
        setTrace(null);
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


      <div className="card">
        <div className="card-header">
          <div className="card-title">Span Waterfall</div>
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
