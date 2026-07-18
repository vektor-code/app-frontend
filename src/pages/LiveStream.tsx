import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectLiveStream } from '../api/liveStream';
import type { Span } from '../entities';
import { isSpanError } from '../utils/spanStatus';
import CustomSelect from '../components/CustomSelect';
import { useTranslation } from '../utils/i18n';

interface LiveStreamProps {
  namespace: string;
}

interface LiveSpan extends Span {
  _id: string;
}

export default function LiveStream({ namespace }: LiveStreamProps) {
  const { t } = useTranslation();
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
  const totalCountRef = useRef(0);
  const prevCountRef = useRef(0);
  const liveSpanIdRef = useRef(0);
  const maxSpans = 150;

  pausedRef.current = paused;

  // Calculate spans per second rate dynamically. The interval must be stable
  // (created once) and read counts via refs — depending on totalCount would
  // reset the timer on every span, so it would never fire under load.
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = totalCountRef.current - prevCountRef.current;
      setSpansPerSec(Math.max(0, Math.round(diff / 2)));
      prevCountRef.current = totalCountRef.current;
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSpan = useCallback((span: Span) => {
    totalCountRef.current += 1;
    setTotalCount(c => c + 1);
    if (pausedRef.current) return;
    const liveSpan: LiveSpan = { ...span, _id: `${span.spanId}-${Date.now()}-${liveSpanIdRef.current++}` };
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
    totalCountRef.current = 0;
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
      { value: '', label: 'All services' },
      ...unique.map(s => ({ value: s, label: s }))
    ];
  }, [spans]);

  const statusOptions = [
    { value: '', label: 'All status' },
    { value: 'ok', label: 'OK' },
    { value: 'error', label: 'Errors' }
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
    <div className="live-page animate-fade-in">
      <section className="live-hero">
        <div>
          <span className={`live-status-pill ${connected ? 'live' : 'offline'}`}>
            <i />
            {connected ? t('Live') : t('Offline')}
          </span>
          <h1>{t('Live Stream')}</h1>
        </div>
        <div className="live-hero-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPaused(!paused)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {paused ? <polygon points="5 3 19 12 5 21 5 3" /> : (
                <>
                  <line x1="6" y1="4" x2="6" y2="20" />
                  <line x1="18" y1="4" x2="18" y2="20" />
                </>
              )}
            </svg>
            {paused ? t('Resume') : t('Pause')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSpans}>
            {t('Clear')}
          </button>
        </div>
      </section>

      <section className="live-metric-grid">
        <div className="live-metric-card indigo">
          <span>{t('Throughput')}</span>
          <strong>{spansPerSec}</strong>
          <em>{t('spans/sec')}</em>
        </div>
        <div className="live-metric-card emerald">
          <span>{t('Avg latency')}</span>
          <strong>{formatDuration(stats.avgDuration)}</strong>
          <em>{filteredSpans.length} {t('visible')}</em>
        </div>
        <div className={`live-metric-card ${stats.errorRate > 0 ? 'rose' : 'emerald'}`}>
          <span>{t('Error rate')}</span>
          <strong>{stats.errorRate.toFixed(1)}%</strong>
          <em>{spans.filter(s => isSpanError(s)).length} {t('errors')}</em>
        </div>
        <div className="live-metric-card amber">
          <span>{t('Services')}</span>
          <strong>{stats.uniqueServices}</strong>
          <em>{totalCount} {t('total spans')}</em>
        </div>
      </section>

      <section className="live-filter-panel">
        <div className="live-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder={t('Search spans, services, trace IDs')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <CustomSelect
          className="live-stream-filter-select"
          ariaLabel={t('Service')}
          options={flowingServicesOptions}
          value={serviceFilter}
          onChange={setServiceFilter}
          placeholder={t('All services')}
        />
        <CustomSelect
          className="live-stream-filter-select"
          ariaLabel={t('Status')}
          options={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder={t('All status')}
        />
      </section>

      <section className="live-stream-panel">
        <div className="live-stream-panel-head">
          <strong>{t('Span Feed')}</strong>
          <span>{filteredSpans.length} / {totalCount}</span>
        </div>

        {filteredSpans.length === 0 ? (
          <div className="live-empty-state">
            <div className="live-empty-icon">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <strong>{connected ? t('Waiting for spans') : t('Connecting')}</strong>
          </div>
        ) : (
          <div className="live-stream-container">
            {filteredSpans.map(span => (
              <button
                key={span._id}
                type="button"
                onClick={() => navigate(`/traces/${span.traceId}`)}
                className={`live-span-item ${isSpanError(span) ? 'error' : 'ok'}`}
              >
                <span className={`live-span-status ${isSpanError(span) ? 'error' : 'ok'}`}>
                  {isSpanError(span) ? 'ERR' : 'OK'}
                </span>
                <span className="live-span-svc">{span.serviceName}</span>
                <span className="live-span-name" title={span.name}>{span.name}</span>
                {!namespace && <span className="live-span-ns">{span.namespace}</span>}
                <span className="live-span-duration">{formatDuration(span.durationMs)}</span>
                <span className="live-span-time">{formatTime(span.startTime)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
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
