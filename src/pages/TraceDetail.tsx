import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Span, Trace, TraceInvestigation } from '../entities';
import SpanTimeline, { getSpanDestination as getSpanDestination } from '../components/SpanTimeline';
import SideDrawer from '../components/SideDrawer';
import { FlameGraph as FlameGraph } from '../components/trace/FlameGraph';
import { SpanDrawerContent as SpanDrawerContent } from '../components/trace/SpanDrawer';
import { TraceDetailIcon as TraceDetailIcon, type TraceDetailIconName } from '../components/trace/TraceDetailIcon';
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

function TraceMetricCard({
  icon,
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  icon: TraceDetailIconName;
  label: string;
  value: string;
  detail: string;
  tone?: TraceTone;
}) {
  return (
    <div className={`trace-detail-metric-card ${tone}`}>
      <div className="trace-detail-metric-icon">
        <TraceDetailIcon name={icon} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </div>
  );
}

function TraceViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: TraceDetailIconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`trace-detail-view-button ${active ? 'active' : ''}`} onClick={onClick}>
      <TraceDetailIcon name={icon} />
      {label}
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
        <span>{formatTraceNumber(item.spanCount)} spans</span>
        <span>{formatDuration(item.avgDurationMs)} avg</span>
        <span>{formatTraceNumber(item.errorCount)} errors</span>
      </div>
    </div>
  );
}

function TraceSpanChip({ span, onClick }: { span: Span; onClick: () => void }) {
  const tone = getSpanTone(span);
  return (
    <button className={`trace-span-chip ${tone}`} onClick={onClick}>
      <div>
        <strong title={span.name}>{span.name}</strong>
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
    const map = new Map<string, string>();
    trace.spans.forEach(s => {
      if (s.attributes) {
        Object.entries(s.attributes).forEach(([k, v]) => {
          if (
            k.startsWith('http.') || 
            k.startsWith('db.system') || 
            k.startsWith('rpc.') || 
            k.startsWith('messaging.') || 
            k.startsWith('exception.type')
          ) {
            const next = isHttpMethodAttribute(k) ? normalizeHttpMethod(v) : String(v);
            if (isHttpStatusAttribute(k)) {
              map.set(k, preferHttpStatusTag(map.get(k), next));
              return;
            }
            map.set(k, next);
          }
        });
      }
    });
    return Array.from(map.entries());
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
  const erroredServiceCount = serviceSummary.filter(item => item.errorCount > 0).length;
  const dominantService = serviceSummary[0];
  const traceTone = trace ? getTraceHealthTone(trace) : 'neutral';

  if (loading) return <div className="empty-state"><div className="empty-state-title">{t('Loading trace...')}</div></div>;
  if (!trace) return <div className="empty-state"><div className="empty-state-title">{t('Trace not found')}</div></div>;

  const startMs = new Date(trace.startTime).getTime();

  return (
    <div className="trace-detail-page animate-fade-in">
      <section className={`trace-detail-hero ${traceTone}`}>
        <div className="trace-detail-hero-main">
          <nav className="trace-detail-breadcrumb" aria-label={t('Breadcrumb')}>
            <button type="button" onClick={() => navigate('/traces')}>{t('Traces')}</button>
            <span aria-hidden="true">/</span>
            <em>{t('Trace')}</em>
          </nav>
          <button className="trace-detail-back-button" onClick={() => navigate('/traces')}>
            <TraceDetailIcon name="back" />
            {t('Back to Explorer')}
          </button>
          <span className="trace-detail-eyebrow">
            <TraceDetailIcon name="network" />
            {t('Trace detail')}
          </span>
          <h1 title={rootOperation}>{rootOperation}</h1>
          <div className="trace-detail-id-row">
            <code title={trace.traceId}>{trace.traceId}</code>
            <button onClick={handleCopyTraceId} title={copiedTraceId ? t('Copied!') : t('Copy Full Trace ID')}>
              <TraceDetailIcon name={copiedTraceId ? 'check' : 'copy'} />
            </button>
          </div>
        </div>
        <div className="trace-detail-hero-side">
          <span className={`trace-detail-status ${trace.hasError ? 'critical' : 'healthy'}`}>
            <i />
            {trace.hasError ? 'ERROR' : 'OK'}
          </span>
          <strong>{formatDuration(trace.durationMs)}</strong>
          <em>{formatTraceDate(trace.startTime)}</em>
        </div>
      </section>

      <div className="trace-detail-layout">
        <div className="trace-detail-main-content">
          <section className="trace-detail-metric-grid">
            <TraceMetricCard
              icon="server"
              label={t('Root Service')}
              value={trace.serviceName}
              detail={dominantService ? `${dominantService.namespace} / ${formatTraceNumber(dominantService.spanCount)} spans` : (trace.namespace || 'default')}
              tone="info"
            />
            <TraceMetricCard
              icon="waterfall"
              label={t('Spans')}
              value={formatTraceNumber(trace.spanCount)}
              detail={brokenLinkSpans.length > 0
                ? `${formatTraceNumber(brokenLinkSpans.length)} ${t('broken parent links')}`
                : t('Complete span tree')}
              tone={brokenLinkSpans.length > 0 ? 'warning' : 'healthy'}
            />
            <TraceMetricCard
              icon="latency"
              label={t('Duration')}
              value={formatDuration(trace.durationMs)}
              detail={criticalSpans.length > 0
                ? `${formatTraceNumber(criticalSpans.length)} ${t('slow/error spans')}`
                : t('No slow or error spans')}
              tone={criticalSpans.length > 0 || trace.durationMs > 1500 ? 'warning' : 'healthy'}
            />
            <TraceMetricCard
              icon="alert"
              label={t('Errors')}
              value={formatTraceNumber(errorSpans.length)}
              detail={`${formatTraceNumber(erroredServiceCount)} ${t('affected services')}`}
              tone={trace.hasError ? 'critical' : 'healthy'}
            />
          </section>

          <section className="trace-detail-context-grid">
            <div className="trace-detail-context-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Namespace Path')}</span>
                <strong>{formatTraceNumber(traceNamespaces.length || 1)}</strong>
              </div>
              <div className="trace-detail-namespace-flow">
                {(traceNamespaces.length > 0 ? traceNamespaces : [trace.namespace]).map((ns, idx) => (
                  <React.Fragment key={ns}>
                    {idx > 0 && <em>{'->'}</em>}
                    <span>{ns}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="trace-detail-context-panel">
              <div className="trace-detail-panel-title">
                <span>{t('Span Kinds')}</span>
                <strong>{Object.keys(spanKindSummary).length}</strong>
              </div>
              <div className="trace-detail-kind-list">
                {Object.entries(spanKindSummary).map(([kind, count]) => (
                  <span key={kind}>{kind.toLowerCase()} <b>{count}</b></span>
                ))}
              </div>
            </div>
          </section>

          {brokenLinkSpans.length > 0 ? (
            <div className="trace-detail-alert warning compact">
              <TraceDetailIcon name="alert" />
              <span>
                <strong>{t('Incomplete flow')}</strong>
                {brokenLinkSpans.length} span{brokenLinkSpans.length > 1 ? 's' : ''} reference{brokenLinkSpans.length > 1 ? '' : 's'} a parent that was not captured
                ({[...new Set(brokenLinkSpans.map(s => `${s.namespace || 'default'}/${s.serviceName}`))].slice(0, 3).join(', ')}).
              </span>
            </div>
          ) : !(failureDiagnosis || errorSpans.length > 0) ? (
            <div className="trace-detail-alert ok compact">
              <TraceDetailIcon name="check" />
              <span>
                <strong>{t('Complete span tree')}</strong>
                {t('Every parent in this trace was captured.')}
              </span>
            </div>
          ) : null}

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
                    <TraceDetailIcon name="alert" />
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
                <span>{t('Service Contribution')}</span>
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
                <span>{t('Critical Spans')}</span>
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
                    <span>{t('Connections & Destinations')}</span>
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
                    <span>{t('Trace Metadata Tags')}</span>
                    <strong>{formatTraceNumber(uniqueTags.length)}</strong>
                  </div>
                  <div className="trace-detail-chip-cloud">
                    {uniqueTags.map(([k, v]) => (
                      <div key={k} className={`trace-detail-chip ${isHttpMethodAttribute(k) ? 'method' : ''}`} title={`${k}: ${v}`}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="trace-detail-visualization-panel">
            <div className="trace-detail-visualization-header">
              <div>
                <span>{t('Trace Visualization')}</span>
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
                  icon="waterfall"
                  label={t('Waterfall')}
                  onClick={() => setViewMode('waterfall')}
                />
                <TraceViewButton
                  active={viewMode === 'flame'}
                  icon="flame"
                  label={t('Flame')}
                  onClick={() => setViewMode('flame')}
                />
                <TraceViewButton
                  active={viewMode === 'topology'}
                  icon="topology"
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
                <div className="trace-detail-view-stack">
                  <FlameGraph
                    spans={trace.spans || []}
                    traceStartTime={startMs}
                    traceDuration={trace.durationMs}
                    onSelectSpan={(span) => setSelectedSpan(span)}
                  />
                  {!selectedSpan && (
                    <div className="selected-span-placeholder">
                      Click a span bar in the flame graph above to view its execution details and full telemetry attributes.
                    </div>
                  )}
                </div>
              ) : (
                <div className="trace-detail-view-stack">
                  <TraceTopology
                    spans={trace.spans || []}
                    onSelectSpan={(span) => setSelectedSpan(span)}
                  />
                  {!selectedSpan && (
                    <div className="selected-span-placeholder">
                      Click a service node to view span details and trace through the call chain.
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
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
