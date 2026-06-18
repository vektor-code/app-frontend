import React, { useState, useEffect, useRef, useCallback } from 'react';
import { connectLiveStream, type Span, isSpanError } from '../api/client';

interface LiveStreamProps {
  namespace: string;
}

interface LiveSpan extends Span {
  _id: string;
}

export default function LiveStream({ namespace }: LiveStreamProps) {
  const [spans, setSpans] = useState<LiveSpan[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const disconnectRef = useRef<(() => void) | null>(null);
  const pausedRef = useRef(paused);
  const maxSpans = 200;

  pausedRef.current = paused;

  const handleSpan = useCallback((span: Span) => {
    setTotalCount(c => c + 1);
    if (pausedRef.current) return;
    const liveSpan: LiveSpan = { ...span, _id: `${span.spanId}-${Date.now()}` };
    setSpans(prev => [liveSpan, ...prev].slice(0, maxSpans));
  }, []);

  useEffect(() => {
    const disconnect = connectLiveStream(
      namespace || undefined,
      handleSpan,
      () => setConnected(true),
      () => setConnected(false)
    );
    disconnectRef.current = disconnect;
    return () => disconnect();
  }, [namespace, handleSpan]);

  const clearSpans = () => {
    setSpans([]);
    setTotalCount(0);
  };

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Live Stream</h1>
      <p className="page-subtitle">
        {namespace ? `Real-time spans from ${namespace}` : 'Real-time spans across all namespaces'}
      </p>

      <div className="live-stream-container">
        <div className="live-stream-header">
          <div className="live-stream-status">
            <div className="live-dot" style={connected ? {} : { background: 'var(--accent-rose)', animation: 'none' }} />
            <span style={{ color: connected ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            <span className="live-stream-count">
              {totalCount.toLocaleString()} spans received · {spans.length} displayed
            </span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setPaused(!paused)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {paused ? <polygon points="5 3 19 12 5 21 5 3" /> : (
                  <>
                    <line x1="6" y1="4" x2="6" y2="20" />
                    <line x1="18" y1="4" x2="18" y2="20" />
                  </>
                )}
              </svg>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={clearSpans} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear
            </button>
          </div>
        </div>

        {spans.length === 0 && (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <div className="empty-state-title">{connected ? 'Waiting for spans...' : 'Connecting...'}</div>
                <div className="empty-state-text">
                  {connected
                    ? 'Spans will appear here in real-time as your services emit telemetry'
                    : 'Attempting to establish WebSocket connection to the backend'
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {spans.map(span => (
          <div key={span._id} className="live-span-item">
            <span className={`badge ${isSpanError(span) ? 'badge-error' : 'badge-ok'}`} style={{ minWidth: '52px', justifyContent: 'center' }}>
              {isSpanError(span) ? 'ERR' : 'OK'}
            </span>
            <span className="live-span-svc">{span.serviceName}</span>
            <span className="live-span-name" title={span.name}>{span.name}</span>
            <span className="badge badge-ns">{span.namespace}</span>
            <span className="live-span-duration">{formatDuration(span.durationMs)}</span>
            <span className="live-span-time">{formatTime(span.startTime)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
