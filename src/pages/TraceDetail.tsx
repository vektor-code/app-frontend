import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Flame,
  GitFork,
} from 'lucide-react';
import { api } from '../api/client';
import type { Span, Trace, TraceInvestigation } from '../entities';
import SpanTimeline, { getSpanDestination as getSpanDestination } from '../components/SpanTimeline';
import SideDrawer from '../components/SideDrawer';
import { FlameGraph as FlameGraph } from '../components/trace/FlameGraph';
import { SpanDrawerContent as SpanDrawerContent } from '../components/trace/SpanDrawer';
import { TraceTopology as TraceTopology } from '../components/trace/TraceTopology';
import { explainSpanError as explainSpanError } from '../utils/errorAnalysis';
import {
  isHttpMethodAttribute as isHttpMethodAttribute,
  isHttpStatusAttribute as isHttpStatusAttribute,
  normalizeHttpMethod as normalizeHttpMethod,
  preferHttpStatusTag as preferHttpStatusTag,
} from '../utils/httpTelemetry';
import { getErrorCategoryLabel, getSpanOperationLabel } from '../utils/spanLabels';
import { useTranslation } from '../utils/i18n';
import {
  formatInvestigationState as formatInvestigationState,
  formatObservationMessage as formatObservationMessage,
  observationMark as observationMark,
  observationTone as observationTone,
} from '../utils/investigationDisplay';
import { displayOperationName as displayOperationName } from '../utils/operationName';
import { isMissingHttpResponse, isSpanError as isSpanError } from '../utils/spanStatus';
import { buildSpanForest as buildSpanForest } from '../utils/spanTree';
import { formatDuration as formatDuration, getSvcColor as getSvcColor } from '../utils/traceDisplay';
import { analyzeTraceFailure as analyzeTraceFailure, classificationLabel as classificationLabel } from '../utils/traceFailureAnalyzer';
import './traceDetail.css';

type TraceViewMode = 'waterfall' | 'flame' | 'topology';
type TraceTone = 'healthy' | 'warning' | 'critical' | 'neutral' | 'info';


interface TraceServiceSummary {
  serviceName: string;
  namespace: string;
  spanCount: number;
  errorCount: number;
  durationMs: number;
  avgDurationMs: number;
}

function getTraceServiceSummary(spans: Span[]): TraceServiceSummary[] {
  const map = new Map<string, TraceServiceSummary>();
  spans.forEach(span => {
    const key = `${span.namespace || 'default'}/${span.serviceName}`;
    const item = map.get(key) || {
      serviceName: span.serviceName,
      namespace: span.namespace || 'default',
      spanCount: 0,
      errorCount: 0,
      durationMs: 0,
      avgDurationMs: 0,
    };
    item.spanCount += 1;
    item.durationMs += span.durationMs;
    if (isSpanError(span)) item.errorCount += 1;
    map.set(key, item);
  });
  return Array.from(map.values())
    .map(item => ({ ...item, avgDurationMs: item.spanCount > 0 ? item.durationMs / item.spanCount : 0 }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

const SLOW_SPAN_MS = 1000;

function isSlowSpan(span: Span) {
  return span.durationMs >= SLOW_SPAN_MS;
}

function getCriticalSpans(spans: Span[], limit = 5) {
  return spans
    .filter(span => isSpanError(span) || isSlowSpan(span))
    .sort((a, b) => {
      const errorDelta = Number(isSpanError(b)) - Number(isSpanError(a));
      if (errorDelta !== 0) return errorDelta;
      return b.durationMs - a.durationMs;
    })
    .slice(0, limit);
}

function getSpanKindSummary(spans: Span[]) {
  return spans.reduce<Record<string, number>>((acc, span) => {
    acc[span.kind] = (acc[span.kind] || 0) + 1;
    return acc;
  }, {});
}

function formatTraceNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function formatTracePercent(value: number) {
  if (!Number.isFinite(value)) return '0.0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTraceDate(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString();
}

function getTraceHealthTone(trace: Trace): TraceTone {
  if (trace.hasError) return 'critical';
  if (trace.durationMs > 1500) return 'warning';
  return 'healthy';
}

function getSpanTone(span: Span): TraceTone {
  if (isSpanError(span)) return 'critical';
  if (isSlowSpan(span)) return 'warning';
  return 'neutral';
}

function TraceChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'violet' | 'error' | 'accent' | 'warning';
}) {
  return <span className={`trace-chip ${tone}`}>{children}</span>;
}

function TraceViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`trace-detail-view-button ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TraceServiceCard({
  item,
  totalDuration,
}: {
  item: TraceServiceSummary;
  totalDuration: number;
}) {
  const color = getSvcColor(item.serviceName);
  const share = totalDuration > 0 ? (item.durationMs / totalDuration) * 100 : 0;
  return (
    <div className={`trace-service-card ${item.errorCount > 0 ? 'critical' : ''}`}>
      <div className="trace-service-card-top">
        <span style={{ background: color }} />
        <div>
          <strong title={item.serviceName}>{item.serviceName}</strong>
          <em>{item.namespace}</em>
        </div>
        <b>{formatTracePercent(share)}</b>
      </div>
      <div className="trace-service-card-bar">
        <i style={{ width: `${Math.max(3, share)}%`, background: color }} />
      </div>
      <div className="trace-service-card-meta">
        <TraceChip>{formatTraceNumber(item.spanCount)} spans</TraceChip>
        <TraceChip>{formatDuration(item.avgDurationMs)} avg</TraceChip>
        <TraceChip tone={item.errorCount > 0 ? 'error' : 'neutral'}>{formatTraceNumber(item.errorCount)} errors</TraceChip>
      </div>
    </div>
  );
}

function TraceSpanChip({ span, onClick }: { span: Span; onClick: () => void }) {
  const tone = getSpanTone(span);
  return (
    <button className={`trace-span-chip ${tone}`} onClick={onClick}>
      <div>
        <strong title={getSpanOperationLabel(span)}>{getSpanOperationLabel(span)}</strong>
        <span>{span.serviceName}</span>
      </div>
      <em>{formatDuration(span.durationMs)}</em>
    </button>
  );
}

export default function TraceDetail() {
  const { t } = useTranslation();
  const { traceId } = useParams<{ traceId: string }>();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [investigation, setInvestigation] = useState<TraceInvestigation | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState(false);
  const [viewMode, setViewMode] = useState<TraceViewMode>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const navigate = useNavigate();

  const [sidebarWidth, setSidebarWidth] = useState(540);

  // Trace ID copy animation
  const [copiedTraceId, setCopiedTraceId] = useState(false);

  const handleCopyTraceId = () => {
    navigator.clipboard.writeText(trace?.traceId || '');
    setCopiedTraceId(true);
    setTimeout(() => setCopiedTraceId(false), 1500);
  };



  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    setInvestigation(null);
    setInvestigationLoading(false);
    
    api.getTrace(traceId)
      .then((traceData) => {
        setTrace(traceData);
        setSelectedSpan(null);
      })
      .catch(() => {
        setTrace(null);
      })
      .finally(() => setLoading(false));
  }, [traceId]);

  const uniqueTags = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const aliases: Record<string, string> = {
      'http.method': 'http.request.method',
      'http.status_code': 'http.response.status_code',
      'http.target': 'url.path',
      'http.url': 'url.full',
    };
    const map = new Map<string, string>();
    trace.spans.forEach(s => {
      if (!s.attributes) return;
      Object.entries(s.attributes).forEach(([rawKey, v]) => {
        const k = aliases[rawKey] || rawKey;
        if (
          !(
            k.startsWith('http.') ||
            k.startsWith('url.') ||
            k.startsWith('db.system') ||
            k.startsWith('rpc.') ||
            k.startsWith('messaging.') ||
            k.startsWith('exception.type')
          )
        ) {
          return;
        }
        const next = isHttpMethodAttribute(rawKey) || isHttpMethodAttribute(k) ? normalizeHttpMethod(v) : String(v);
        if (isHttpStatusAttribute(rawKey) || isHttpStatusAttribute(k)) {
          map.set(k, preferHttpStatusTag(map.get(k), next));
          return;
        }
        if (!map.has(k) || (next && next.length > String(map.get(k) || '').length)) {
          map.set(k, next);
        }
      });
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [trace]);

  // All namespaces this trace crosses, in first-seen (time) order
  const traceNamespaces = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const seen = new Set<string>();
    const list: string[] = [];
    [...trace.spans]
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .forEach(s => {
        const ns = s.namespace || 'default';
        if (!seen.has(ns)) { seen.add(ns); list.push(ns); }
      });
    return list;
  }, [trace]);

  // Spans whose parent was never captured (uninstrumented hop / sampling /
  // disabled namespace) — the flow renders but with a visible gap.
  const spanForest = useMemo(() => buildSpanForest(trace?.spans || []), [trace]);
  const brokenLinkSpans = spanForest.midTreeMissing;

  // Error spans with human-readable explanations for the problems panel
  const errorSpans = useMemo(() => {
    if (!trace || !trace.spans) return [];
    return trace.spans
      .filter(s => isSpanError(s))
      .sort((a, b) => {
        const rank = (s: Span) => (isMissingHttpResponse(s) ? 0 : 1);
        const delta = rank(a) - rank(b);
        if (delta !== 0) return delta;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      })
      .map(span => ({ span, explanation: explainSpanError(span) }));
  }, [trace]);

  const failureDiagnosis = useMemo(() => {
    if (!trace) return null;
    return trace.failureDiagnosis ?? analyzeTraceFailure(trace);
  }, [trace]);

  useEffect(() => {
    if (!traceId || !failureDiagnosis) return;
    const plan = failureDiagnosis.live;
    if (plan && !plan.recommended) {
      setInvestigation({
        traceId,
        status: 'skipped',
        levelReached: 0,
        skipReason: plan.reason,
        conclusion: 'Kubernetes verification not required',
      });
      setInvestigationLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setInvestigationLoading(true);
    const poll = () => {
      api.getTraceInvestigation(traceId)
        .then((report) => {
          if (cancelled) return;
          setInvestigation(report);
          if (report.status === 'pending') {
            setInvestigationLoading(true);
            timer = setTimeout(poll, 2000);
            return;
          }
          setInvestigationLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setInvestigation({
            traceId,
            status: 'unavailable',
            levelReached: 0,
            skipReason: 'Live Kubernetes verification is not available for this cluster',
          });
          setInvestigationLoading(false);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [traceId, failureDiagnosis]);

  const uniqueDestinations = useMemo(() => {
    if (!trace || !trace.spans) return [];
    const destMap = new Map<string, { name: string; type: string; count: number }>();
    trace.spans.forEach(s => {
      const dest = getSpanDestination(s);
      if (dest.type) {
        const key = `${dest.type}:${dest.name}`;
        const existing = destMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          destMap.set(key, { name: dest.name, type: dest.type, count: 1 });
        }
      }
    });
    return Array.from(destMap.values());
  }, [trace]);

  const serviceSummary = useMemo(() => {
    return trace?.spans ? getTraceServiceSummary(trace.spans) : [];
  }, [trace]);

  const criticalSpans = useMemo(() => {
    return trace?.spans ? getCriticalSpans(trace.spans) : [];
  }, [trace]);

  const spanKindSummary = useMemo(() => {
    return trace?.spans ? getSpanKindSummary(trace.spans) : {};
  }, [trace]);

  const rootOperation = trace?.rootSpan
    ? getSpanOperationLabel(trace.rootSpan)
    : displayOperationName(trace?.spans?.[0]?.name || '', 'Trace');
  const traceTone = trace ? getTraceHealthTone(trace) : 'neutral';

  if (loading) {
    return <TraceDetailSkeleton onBack={() => navigate('/traces')} t={t} />;
  }
  if (!trace) return <div className="empty-state"><div className="empty-state-title">{t('Trace not found')}</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="trace-detail-page animate-fade-in">
      <nav className="trace-detail-breadcrumb" aria-label={t('Breadcrumb')}>
        <button type="button" onClick={() => navigate('/traces')}>{t('Traces')}</button>
        <ChevronRight size={14} aria-hidden="true" />
        <em>{t('Trace')}</em>
        <button type="button" className="trace-detail-back-link" onClick={() => navigate('/traces')}>
          <ArrowLeft size={14} />
          {t('Back to Explorer')}
        </button>
      </nav>
      <section className={`trace-detail-hero ${traceTone}`}>
        <div className="trace-detail-hero-main">
          <h1 title={rootOperation}>{rootOperation}</h1>
          <div className="trace-detail-hero-meta">
            <button
              type="button"
              className={`trace-detail-id-copy ${copiedTraceId ? 'copied' : ''}`}
              onClick={handleCopyTraceId}
              title={copiedTraceId ? t('Copied!') : t('Copy Full Trace ID')}
            >
              <code title={trace.traceId}>{trace.traceId}</code>
              {copiedTraceId ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {(traceNamespaces.length > 0 ? traceNamespaces : [trace.namespace]).map(ns => (
              <TraceChip key={ns} tone="violet">{ns}</TraceChip>
            ))}
            {Object.entries(spanKindSummary).map(([kind, count]) => (
              <TraceChip key={kind} tone={kind.toLowerCase() === 'server' ? 'violet' : kind.toLowerCase() === 'client' ? 'accent' : 'neutral'}>
                {kind.toLowerCase()} <b>{count}</b>
              </TraceChip>
            ))}
          </div>
        </div>
        <div className="trace-detail-hero-side">
          <span className={`trace-detail-status ${trace.hasError ? 'critical' : 'healthy'}`}>
            <i />
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
          <strong className={trace.hasError ? 'is-error' : ''}>{formatDuration(trace.durationMs)}</strong>
          <em>{formatTraceDate(trace.startTime)}</em>
        </div>
      </section>

      <dl className="trace-detail-stats">
        <div>
          <dt>{t('Root Service')}</dt>
          <dd title={trace.serviceName}>{trace.serviceName}</dd>
        </div>
        <div>
          <dt>{t('Spans')}</dt>
          <dd>{formatTraceNumber(trace.spanCount)}</dd>
        </div>
        <div>
          <dt>{t('Services')}</dt>
          <dd>{formatTraceNumber(serviceSummary.length)}</dd>
        </div>
        <div>
          <dt>{t('Duration')}</dt>
          <dd>{formatDuration(trace.durationMs)}</dd>
        </div>
        <div>
          <dt>{t('Errors')}</dt>
          <dd className={trace.hasError ? 'is-error' : ''}>{formatTraceNumber(errorSpans.length)}</dd>
        </div>
      </dl>

      <div className="trace-detail-layout">
        <div className="trace-detail-main-content">
          {brokenLinkSpans.length > 0 && (
            <div className="trace-detail-alert warning compact">
              <AlertTriangle size={16} />
              <span>
                <strong>{t('Incomplete flow')}</strong>
                {brokenLinkSpans.length} span{brokenLinkSpans.length > 1 ? 's' : ''} reference{brokenLinkSpans.length > 1 ? '' : 's'} a parent that was not captured
                ({[...new Set(brokenLinkSpans.map(s => `${s.namespace || 'default'}/${s.serviceName}`))].slice(0, 3).join(', ')}).
              </span>
            </div>
          )}

          <section className="trace-detail-visualization-panel">
            <div className="trace-detail-visualization-header">
              <div>
                <span className="trace-detail-eyebrow">{t('Trace Visualization')}</span>
                <h2>
                  {viewMode === 'waterfall'
                    ? t('Waterfall View')
                    : viewMode === 'flame'
                      ? t('Flame Graph')
                      : t('Trace Topology')}
                </h2>
                <p>{formatTraceNumber(trace.spanCount)} {t('spans total')} / {formatDuration(trace.durationMs)}</p>
              </div>

              <div className="trace-detail-view-toggle">
                <TraceViewButton
                  active={viewMode === 'waterfall'}
                  icon={<Activity size={16} />}
                  label={t('Waterfall')}
                  onClick={() => setViewMode('waterfall')}
                />
                <TraceViewButton
                  active={viewMode === 'flame'}
                  icon={<Flame size={16} />}
                  label={t('Flame')}
                  onClick={() => setViewMode('flame')}
                />
                <TraceViewButton
                  active={viewMode === 'topology'}
                  icon={<GitFork size={16} />}
                  label={t('Topology')}
                  onClick={() => setViewMode('topology')}
                />
              </div>
            </div>

            <div className="trace-detail-visualization-body">
              {viewMode === 'waterfall' ? (
                <SpanTimeline
                  spans={trace.spans || []}
                  traceStartTime={startMs}
                  traceDuration={trace.durationMs}
                  onSelectSpan={(span) => setSelectedSpan(span)}
                  selectedSpanId={selectedSpan?.spanId}
                />
              ) : viewMode === 'flame' ? (
                <FlameGraph
                  spans={trace.spans || []}
                  traceStartTime={startMs}
                  traceDuration={trace.durationMs}
                  onSelectSpan={(span) => setSelectedSpan(span)}
                />
              ) : (
                <TraceTopology
                  spans={trace.spans || []}
                  onSelectSpan={(span) => setSelectedSpan(span)}
                />
              )}
            </div>
          </section>

          {/* Detected Problems Panel — existing error summary, augmented with diagnosis */}
          {(failureDiagnosis || errorSpans.length > 0) && (() => {
            const affectedServices = new Set(errorSpans.map(item => item.span.serviceName)).size;
            const primaryError = errorSpans[0];
            const diagnosisTone = failureDiagnosis?.classification === 'INSTRUMENTATION_ANOMALY'
              ? 'anomaly'
              : failureDiagnosis?.classification === 'UNKNOWN'
                ? 'unknown'
                : 'critical';
            const diagnosisEvidence = (failureDiagnosis?.evidence || []).filter(item => item.code !== 'span_tree_complete');
            const k8sObserved = investigation?.observations?.filter(item => item.kind === 'observed') || [];
            const showK8s = investigation
              ? investigation.status !== 'skipped'
              : investigationLoading;
            return (
              <div className={`trace-detail-problems-panel ${diagnosisTone}`}>
                <div className="problems-panel-header">
                  <div>
                    <AlertTriangle size={16} />
                    <span>{t('Trace Error Summary')}</span>
                  </div>
                  <div className="problems-panel-pills">
                    {failureDiagnosis ? (
                      <>
                        <em>{classificationLabel(failureDiagnosis.classification)}</em>
                        <em className={`conf ${failureDiagnosis.confidence.toLowerCase()}`}>{failureDiagnosis.confidence}</em>
                      </>
                    ) : (
                      <em>{formatTraceNumber(errorSpans.length)} {t('failed spans')} / {formatTraceNumber(affectedServices)} {t('services')}</em>
                    )}
                  </div>
                </div>

                {failureDiagnosis ? (
                  <div className="problems-diagnosis">
                    <h3>{failureDiagnosis.title}</h3>
                    <p>{failureDiagnosis.summary}</p>
                    {diagnosisEvidence.length > 0 && (
                      <ul className="diagnosis-evidence">
                        {diagnosisEvidence.map(item => (
                          <li key={`${item.code}-${item.spanId || ''}`}>{item.message}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="problems-diagnosis">
                    <h3>{primaryError.explanation.title}</h3>
                    <p>{primaryError.explanation.what}</p>
                  </div>
                )}

                {showK8s && (
                  <div className="diagnosis-k8s">
                    <div className="diagnosis-k8s-head">
                      <span>{t('Kubernetes verification')}</span>
                      {investigation?.status === 'pending' && investigationLoading && <em>{t('Investigating…')}</em>}
                      {investigation?.cached && <em>{t('Cached')}</em>}
                      {investigation?.referencedBy && investigation.referencedBy > 1 && (
                        <em>{investigation.referencedBy} {t('traces share this result')}</em>
                      )}
                    </div>
                    {(!investigation || investigation.status === 'pending') && investigationLoading && !k8sObserved.length && (
                      <span className="diagnosis-k8s-pending">
                        {investigation?.status === 'pending'
                          ? t('Investigating…')
                          : t('Live verification available')}
                      </span>
                    )}
                    {investigation && investigation.status !== 'pending' && (
                      <>
                        {k8sObserved.map(item => {
                          const tone = observationTone(item);
                          return (
                            <div key={`obs-${item.code}-${item.pod || ''}`} className={`diagnosis-k8s-check ${tone}`}>
                              <b aria-hidden="true">{observationMark(tone)}</b>
                              <span>{formatObservationMessage(item)}</span>
                            </div>
                          );
                        })}
                        {!k8sObserved.length && investigation.checks?.map(check => {
                          const tone = observationTone({ code: check.code, ok: check.ok, message: check.detail });
                          return (
                            <div key={`${check.level}-${check.code}-${check.pod || ''}`} className={`diagnosis-k8s-check ${tone}`}>
                              <b aria-hidden="true">{observationMark(tone)}</b>
                              <span>{formatObservationMessage({ code: check.code, message: check.detail })}</span>
                            </div>
                          );
                        })}
                        {(investigation.originalState || investigation.currentState || investigation.inference || investigation.conclusion) && (
                          <div className="diagnosis-k8s-states">
                            {investigation.originalState && (
                              <span>
                                {t('Original failure')}
                                <strong>{formatInvestigationState(investigation.originalState)}</strong>
                              </span>
                            )}
                            {investigation.currentState && (
                              <span>
                                {t('Current state')}
                                <strong>{formatInvestigationState(investigation.currentState)}</strong>
                              </span>
                            )}
                            {(investigation.inference || investigation.conclusion) && (
                              <span className="wide">
                                {t('Inference')}
                                <strong>
                                  {investigation.inference || investigation.conclusion}
                                  {investigation.confidence ? ` · ${investigation.confidence}` : ''}
                                </strong>
                              </span>
                            )}
                          </div>
                        )}
                        {investigation.status === 'unavailable' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                        {investigation.status === 'rate_limited' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                        {investigation.status === 'expired' && <span className="diagnosis-k8s-pending">{investigation.skipReason}</span>}
                      </>
                    )}
                  </div>
                )}

                {errorSpans.length > 0 && (
                  <div className="problems-span-list">
                    {errorSpans.length > 1 && (
                      <span className="problems-span-label">{formatTraceNumber(errorSpans.length)} {t('failed spans')}</span>
                    )}
                    {errorSpans.map(({ span, explanation }, index) => (
                      <button
                        key={span.spanId}
                        className={`problem-card ${selectedSpan?.spanId === span.spanId ? 'selected' : ''}`}
                        onClick={() => setSelectedSpan(span)}
                        title={t('Open full failure details')}
                      >
                        <div className="problem-card-top">
                          <span className="problem-severity">#{index + 1}</span>
                          <span className="problem-service" style={{ color: getSvcColor(span.serviceName) }}>
                            <span className="problem-service-dot" style={{ background: getSvcColor(span.serviceName) }} />
                            {span.serviceName}
                          </span>
                          {explanation.target && (
                            <>
                              <span className="problem-arrow">{'->'}</span>
                              <span className="problem-target" title={explanation.target}>{explanation.target}</span>
                            </>
                          )}
                          <span className="problem-title-badge">{t(getErrorCategoryLabel(explanation.category))}</span>
                        </div>
                        <div className="problem-main">
                          <strong>{explanation.title}</strong>
                          <span>{explanation.what}</span>
                        </div>
                        <div className="problem-meta-grid">
                          <span>{t('Operation')} <strong>{getSpanOperationLabel(span)}</strong></span>
                          <span>{t('Duration')} <strong>{formatDuration(span.durationMs)}</strong></span>
                          <span>{t('Kind')} <strong>{span.kind.toLowerCase()}</strong></span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <section className="trace-detail-insights-grid">
            <div className="trace-detail-insight-panel">
              <div className="trace-detail-panel-title">
                <span className="trace-detail-eyebrow">{t('Service Contribution')}</span>
                <strong>{formatTraceNumber(serviceSummary.length)}</strong>
              </div>
              <div className="trace-service-card-list">
                {serviceSummary.slice(0, 6).map(item => (
                  <TraceServiceCard key={`${item.namespace}/${item.serviceName}`} item={item} totalDuration={trace.durationMs} />
                ))}
              </div>
            </div>

            <div className="trace-detail-insight-panel">
              <div className="trace-detail-panel-title">
                <span className="trace-detail-eyebrow">{t('Critical Spans')}</span>
                <strong>{formatTraceNumber(criticalSpans.length)}</strong>
              </div>
              <div className="trace-span-chip-list">
                {criticalSpans.length === 0 ? (
                  <p className="trace-empty-hint">{t('No slow or error spans')}</p>
                ) : criticalSpans.map(span => (
                  <TraceSpanChip key={span.spanId} span={span} onClick={() => setSelectedSpan(span)} />
                ))}
              </div>
            </div>
          </section>

          {(uniqueDestinations.length > 0 || uniqueTags.length > 0) && (
            <section className="trace-detail-tags-grid">
              {uniqueDestinations.length > 0 && (
                <div className="trace-detail-tag-panel">
                  <div className="trace-detail-panel-title">
                    <span className="trace-detail-eyebrow">{t('Connections & Destinations')}</span>
                    <strong>{formatTraceNumber(uniqueDestinations.length)}</strong>
                  </div>
                  <div className="trace-detail-chip-cloud">
                    {uniqueDestinations.map(d => (
                      <div key={`${d.type}:${d.name}`} className={`trace-detail-chip ${d.type === '3rdparty' ? 'external' : d.type || 'neutral'}`} title={`${d.count} call(s) to ${d.name}`}>
                        <span>{d.type === '3rdparty' ? t('3rd party') : d.type}</span>
                        <strong>{d.name}</strong>
                        <em>x{d.count}</em>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uniqueTags.length > 0 && (
                <div className="trace-detail-tag-panel">
                  <div className="trace-detail-panel-title">
                    <span className="trace-detail-eyebrow">{t('Trace Metadata Tags')}</span>
                    <strong>{formatTraceNumber(uniqueTags.length)}</strong>
                  </div>
                  <div className="trace-detail-tag-tiles">
                    {uniqueTags.map(([k, v]) => (
                      <div
                        key={k}
                        className={`trace-detail-tag-tile ${v.length > 56 ? 'wide' : ''}`}
                        title={`${k}: ${v}`}
                      >
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <SideDrawer
          open={Boolean(selectedSpan)}
          onClose={() => setSelectedSpan(null)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          minWidth={360}
          ariaLabel={t('Span details')}
        >
          {selectedSpan && (
            <SpanDrawerContent
              span={selectedSpan}
              traceDuration={trace.durationMs}
              onClose={() => setSelectedSpan(null)}
            />
          )}
        </SideDrawer>
      </div>
    </div>
  );
}

function TraceDetailSkeleton({
  onBack,
  t,
}: {
  onBack: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="trace-detail-page animate-fade-in" aria-busy="true" aria-label={t('Loading trace...')}>
      <nav className="trace-detail-breadcrumb" aria-label={t('Breadcrumb')}>
        <button type="button" onClick={onBack}>{t('Traces')}</button>
        <ChevronRight size={14} aria-hidden="true" />
        <em>{t('Trace')}</em>
        <button type="button" className="trace-detail-back-link" onClick={onBack}>
          <ArrowLeft size={14} />
          {t('Back to Explorer')}
        </button>
      </nav>
      <section className="trace-detail-hero">
        <div className="trace-detail-hero-main">
          <span className="apm-skeleton apm-skeleton-title" />
          <span className="apm-skeleton apm-skeleton-id" />
        </div>
        <div className="trace-detail-hero-side">
          <span className="apm-skeleton" style={{ width: 56, height: 22, borderRadius: 999 }} />
          <span className="apm-skeleton" style={{ width: 88, height: 28, borderRadius: 8 }} />
          <span className="apm-skeleton" style={{ width: 128, height: 12 }} />
        </div>
      </section>
      <div className="trace-detail-stats" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index}>
            <span className="apm-skeleton" style={{ width: 64, height: 10 }} />
            <span className="apm-skeleton" style={{ width: 88, height: 18, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="apm-skeleton-table" style={{ marginTop: 16 }}>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="apm-skeleton-row">
            <span className="apm-skeleton" style={{ width: `${48 + (index % 3) * 14}%` }} />
            <span className="apm-skeleton" style={{ width: 80 }} />
            <span className="apm-skeleton" style={{ width: 64 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
