import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectLiveStream, type Span, isSpanError } from '../api/client';

interface LiveStreamProps {
  namespace: string;
}

interface LiveSpan extends Span {
  _id: string;
}

function CustomDropdown({
  options,
  value,
  onChange,
  placeholder
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentOption = options.find(o => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    const handleClose = () => setIsOpen(false);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [isOpen]);

  return (
    <div style={{ position: 'relative', minWidth: '160px' }} onClick={e => e.stopPropagation()}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'var(--bg-secondary)',
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isOpen ? '0 0 0 2px rgba(99, 102, 241, 0.2)' : 'none',
          borderColor: isOpen ? 'var(--accent-indigo)' : 'var(--border-primary)',
          transition: 'all 0.15s ease',
          height: '36px'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {currentOption ? currentOption.label : placeholder}
        </span>
        <svg 
          viewBox="0 0 24 24" 
          width="14" 
          height="14" 
          fill="none" 
          stroke="var(--text-secondary)" 
          strokeWidth="2.5" 
          style={{ 
            transform: isOpen ? 'rotate(180deg)' : 'none', 
            transition: 'transform 0.15s ease',
            flexShrink: 0
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {isOpen && (
        <div 
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-lg), 0 10px 15px -3px rgba(0, 0, 0, 0.3)',
            zIndex: 100,
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '4px',
            animation: 'fadeIn 0.1s ease-out'
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                color: value === opt.value ? 'var(--accent-indigo)' : 'var(--text-primary)',
                background: value === opt.value ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.12s'
              }}
              onMouseEnter={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                {opt.label}
              </span>
              {value === opt.value && (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent-indigo)" strokeWidth="3" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LiveStream({ namespace }: LiveStreamProps) {
  const [spans, setSpans] = useState<LiveSpan[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [spansPerSec, setSpansPerSec] = useState(0);

  const navigate = useNavigate();
  const disconnectRef = useRef<(() => void) | null>(null);
  const pausedRef = useRef(paused);
  const prevCountRef = useRef(0);
  const maxSpans = 150;

  pausedRef.current = paused;

  // Calculate spans per second rate dynamically
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = totalCount - prevCountRef.current;
      setSpansPerSec(Math.max(0, Math.round(diff / 2)));
      prevCountRef.current = totalCount;
    }, 2000);
    return () => clearInterval(interval);
  }, [totalCount]);

  const handleSpan = useCallback((span: Span) => {
    setTotalCount(c => c + 1);
    if (pausedRef.current) return;
    const liveSpan: LiveSpan = { ...span, _id: `${span.spanId}-${Date.now()}-${Math.random()}` };
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
    prevCountRef.current = 0;
    setSpansPerSec(0);
  };

  // Compute live flow stats
  const stats = useMemo(() => {
    if (spans.length === 0) return { errorRate: 0, avgDuration: 0, uniqueServices: 0 };
    const errCount = spans.filter(s => isSpanError(s)).length;
    const errRate = (errCount / spans.length) * 100;
    const totalDuration = spans.reduce((sum, s) => sum + s.durationMs, 0);
    const avgDur = totalDuration / spans.length;
    const uniqueSvcs = new Set(spans.map(s => s.serviceName)).size;
    return { errorRate: errRate, avgDuration: avgDur, uniqueServices: uniqueSvcs };
  }, [spans]);

  // List of distinct flowing services in memory
  const flowingServicesOptions = useMemo(() => {
    const svcs = spans.map(s => s.serviceName).filter(Boolean);
    const unique = [...new Set(svcs)].sort();
    return [
      { value: '', label: 'All Services' },
      ...unique.map(s => ({ value: s, label: s }))
    ];
  }, [spans]);

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'ok', label: 'Success Only' },
    { value: 'error', label: 'Errors Only' }
  ];

  // Filter spans in real-time
  const filteredSpans = useMemo(() => {
    return spans.filter(s => {
      if (serviceFilter && s.serviceName !== serviceFilter) return false;
      if (statusFilter === 'error' && !isSpanError(s)) return false;
      if (statusFilter === 'ok' && isSpanError(s)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = (s.name || '').toLowerCase().includes(q);
        const matchesSvc = (s.serviceName || '').toLowerCase().includes(q);
        const matchesTraceId = (s.traceId || '').toLowerCase().includes(q);
        const matchesNamespace = (s.namespace || '').toLowerCase().includes(q);
        if (!matchesName && !matchesSvc && !matchesTraceId && !matchesNamespace) return false;
      }
      return true;
    });
  }, [spans, serviceFilter, statusFilter, searchQuery]);

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Live Tail</h1>
      <p className="page-subtitle">
        Real-time request telemetry and span updates streaming from active runtimes
      </p>

      {/* Real-time stats grid */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        {/* Metric 1: Rate */}
        <div className="card" style={{
          position: 'relative',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderLeft: '4px solid var(--accent-indigo)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(99, 102, 241, 0.03) 100%)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Stream Throughput</span>
            <span style={{ fontSize: '11px', color: connected ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontWeight: 600 }}>
              {connected ? '● LIVE' : '○ OFFLINE'}
            </span>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {spansPerSec} <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 400 }}>spans/sec</span>
          </div>
        </div>

        {/* Metric 2: Live Avg Latency */}
        <div className="card" style={{
          position: 'relative',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderLeft: '4px solid var(--accent-emerald)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(16, 185, 129, 0.03) 100%)'
        }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Live Avg Latency</div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {formatDuration(stats.avgDuration)}
          </div>
        </div>

        {/* Metric 3: Live Error Rate */}
        <div className="card" style={{
          position: 'relative',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderLeft: `4px solid ${stats.errorRate > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'}`,
          background: `linear-gradient(135deg, var(--bg-secondary) 0%, ${stats.errorRate > 0 ? 'rgba(244, 63, 94, 0.03)' : 'rgba(16, 185, 129, 0.03)'} 100%)`
        }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Live Error Rate</div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: stats.errorRate > 0 ? 'var(--accent-rose)' : 'var(--text-primary)' }}>
            {stats.errorRate.toFixed(1)}%
          </div>
        </div>

        {/* Metric 4: Active Services */}
        <div className="card" style={{
          position: 'relative',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          borderLeft: '4px solid var(--accent-amber)',
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, rgba(245, 158, 11, 0.03) 100%)'
        }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 700 }}>Active Services</div>
          <div style={{ fontSize: '28px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {stats.uniqueServices}
          </div>
        </div>
      </div>

      {/* Advanced real-time filter bar */}
      <div className="filter-bar db-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
        {/* Search Input */}
        <div style={{ flex: '1', minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Live search spans, services, trace IDs..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              transition: 'all 0.15s ease-out'
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = 'var(--accent-indigo)';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.15)';
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = 'var(--border-primary)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth="2.5"
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        {/* Flowing Services selector */}
        <CustomDropdown
          options={flowingServicesOptions}
          value={serviceFilter}
          onChange={setServiceFilter}
          placeholder="All Services"
        />

        {/* Status selector */}
        <CustomDropdown
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All Status"
        />

        {/* Pause/Resume button */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setPaused(!paused)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', borderRadius: '8px' }}
        >
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

        {/* Clear button */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={clearSpans}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', borderRadius: '8px' }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Clear
        </button>
      </div>

      {/* Stream body list */}
      <div className="live-stream-container">
        {filteredSpans.length === 0 && (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <div className="empty-state-title">{connected ? 'Waiting for matching spans...' : 'Connecting...'}</div>
                <div className="empty-state-text">
                  {connected
                    ? 'Spans matching your active filters will appear here in real-time'
                    : 'Attempting to establish WebSocket connection to the backend telemetry server'
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {filteredSpans.map(span => (
          <div
            key={span._id}
            onClick={() => navigate(`/traces/${span.traceId}`)}
            className="live-span-item"
            style={{
              cursor: 'pointer',
              transition: 'all 0.15s ease-out',
              borderLeft: isSpanError(span) ? '4px solid var(--accent-rose)' : '4px solid var(--accent-indigo)'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.transform = 'translateX(2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--bg-secondary)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <span className={`badge ${isSpanError(span) ? 'badge-error' : 'badge-ok'}`} style={{ minWidth: '52px', justifyContent: 'center' }}>
              {isSpanError(span) ? 'ERR' : 'OK'}
            </span>
            <span className="live-span-svc" style={{ fontWeight: 600 }}>{span.serviceName}</span>
            <span className="live-span-name" title={span.name} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{span.name}</span>
            {!namespace && <span className="badge badge-ns">{span.namespace}</span>}
            <span className="live-span-duration" style={{ fontFamily: 'var(--font-mono)' }}>{formatDuration(span.durationMs)}</span>
            <span className="live-span-time" style={{ color: 'var(--text-muted)' }}>{formatTime(span.startTime)}</span>
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
