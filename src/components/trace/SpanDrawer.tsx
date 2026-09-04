import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUpRight,
  Box,
  Braces,
  Check,
  Clock3,
  Copy,
  EyeOff,
  Folder,
  Inbox,
  LayoutDashboard,
  Radio,
  Search,
  Server,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Span } from '../../entities';
import { getSpanDestination as getSpanDestination } from '../SpanTimeline';
import { isHttpMethodAttribute, isHttpStatusAttribute, isValidHttpStatus, normalizeHttpMethod, preferHttpStatusTag, readHttpStatus } from '../../utils/httpTelemetry';
import { useTranslation } from '../../utils/i18n';
import { DrawerDockControls } from '../SideDrawer';
import { displayOperationName as displayOperationName } from '../../utils/operationName';
import { isMissingHttpResponse, isSpanError as isSpanError } from '../../utils/spanStatus';
import { getSpanDependency, getQuerySummary, getQueryText } from '../../utils/dependency';
import { formatDuration as formatDuration, getSvcColor as getSvcColor } from '../../utils/traceDisplay';
import { explainSpanError as explainSpanError } from '../../utils/errorAnalysis';
import { getErrorCategoryLabel, getSpanOperationLabel } from '../../utils/spanLabels';
import { redactEvidenceList, redactSecretText } from '../../utils/secretRedact';

const SPAN_KIND_ICON: Record<string, LucideIcon> = {
  SERVER: Server,
  CLIENT: ArrowUpRight,
  INTERNAL: Box,
  PRODUCER: Radio,
  CONSUMER: Inbox,
};

function spanKindIcon(kind: string): LucideIcon {
  return SPAN_KIND_ICON[kind] || Clock3;
}

interface SpanDrawerContentProps {
  span: Span;
  traceDuration: number;
  onClose: () => void;
}

function DrawerCopyButton({ copied, onCopy, label }: { copied: boolean; onCopy: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="span-drawer-copy"
      title={copied ? 'Copied' : (label || 'Copy')}
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
    >
      {copied ? <Check size={12} strokeWidth={2.4} /> : <Copy size={12} strokeWidth={2.2} />}
    </button>
  );
}

function DrawerKvRow({
  label,
  value,
  mono = true,
  copied,
  onCopy,
  children,
}: {
  label: string;
  value?: ReactNode;
  mono?: boolean;
  copied?: boolean;
  onCopy?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="span-drawer-kv">
      <span className="span-drawer-kv-label">{label}</span>
      <div className="span-drawer-kv-value">
        {children || <span className={mono ? 'is-mono' : undefined}>{value ?? '—'}</span>}
        {onCopy && <DrawerCopyButton copied={!!copied} onCopy={onCopy} />}
      </div>
    </div>
  );
}

interface PayloadDetails {
  type: 'http' | 'db' | 'rpc' | 'internal' | 'queue';
  title: string;
  request: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    statement?: string;
    parameters?: any;
    bodyOmitted?: string;
  };
  response: {
    status?: number | string;
    headers?: Record<string, string>;
    body?: any;
    result?: string;
    bodyOmitted?: string;
  };
  contextPropagation?: {
    carrier: 'headers' | 'metadata' | 'none';
    traceparent?: string;
    parentSpanId?: string;
    currentSpanId: string;
    baggage?: string;
  };
}

// getSpanPayloadDetails extracts ONLY real, captured telemetry from the span
// attributes — no fabricated payloads. When instrumentation did not record a
// body (the common case for auto-instrumentation), the UI says so honestly.
function getSpanPayloadDetails(span: Span, _traceDuration: number): PayloadDetails {
  const attrs = span.attributes || {};
  const dep = getSpanDependency(attrs);
  const dbSystem = (dep.kind === 'database' || dep.kind === 'cache') ? dep.system : '';
  const dbStatement = getQueryText(attrs) || attrs['db.query'] || '';

  const parseMaybeJson = (raw: string | undefined | null): any => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  };

  if (dbSystem || dbStatement) {
    let parameters: any = null;
    if (attrs['db.query.parameters']) {
      parameters = parseMaybeJson(attrs['db.query.parameters']);
    }
    const rows = attrs['db.response.returned_rows'] || attrs['db.rows_affected'] || '';
    return {
      type: 'db',
      title: `${dbSystem || 'Database'} Client Query`,
      request: {
        method: (attrs['db.operation'] || attrs['db.operation.name'] || 'QUERY').toUpperCase(),
        url: attrs['db.name'] || attrs['db.namespace'] || String(dbSystem || 'database'),
        statement: dbStatement || undefined,
        parameters,
      },
      response: {
        status: span.status === 'ERROR' ? 'FAILED' : 'SUCCESS',
        body: span.status === 'ERROR' && span.error ? { error: span.error } : null,
        result: rows ? `${rows} rows` : undefined,
      },
      contextPropagation: {
        carrier: 'none',
        currentSpanId: span.spanId,
      },
    };
  }

  const httpMethod = normalizeHttpMethod(attrs['http.request.method'] || attrs['http.method']);
  let httpUrl = attrs['url.full'] || attrs['http.url'] || '';
  if (!httpUrl) {
    const host = attrs['server.address'] || attrs['net.peer.name'] || attrs['http.host'] || '';
    const target = attrs['url.path'] || attrs['http.target'] || attrs['http.route'] || '';
    httpUrl = host ? `${attrs['url.scheme'] || 'http'}://${host}${target}` : (target || span.name);
  }

  // Real headers only: OTel-captured header attributes plus metadata the
  // instrumentation actually recorded.
  const reqHeaders: Record<string, string> = {};
  Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('http.request.header.')) {
      reqHeaders[k.slice('http.request.header.'.length).replace(/_/g, '-')] = String(v);
    }
  });
  const ua = attrs['user_agent.original'] || attrs['http.user_agent'];
  if (ua && !reqHeaders['user-agent']) reqHeaders['user-agent'] = ua;
  const reqSize = attrs['http.request.body.size'] || attrs['http.request_content_length'];
  if (reqSize && !reqHeaders['content-length']) reqHeaders['content-length'] = `${reqSize} bytes`;

  // The W3C trace context this span actually carries/propagates.
  const traceparent = `00-${span.traceId}-${span.spanId}-01`;
  reqHeaders['traceparent'] = traceparent;

  // Bodies only when the instrumentation actually captured them (rare).
  const reqBody = parseMaybeJson(attrs['http.request.body'] || attrs['request.body']);
  let respBody = parseMaybeJson(attrs['http.response.body'] || attrs['response.body']);
  if (respBody === null && span.status === 'ERROR' && span.error) {
    respBody = { error: span.error };
  }

  const httpStatus = readHttpStatus(attrs);
  const respStatus = httpStatus.present
    ? (isValidHttpStatus(httpStatus.code) ? String(httpStatus.code) : (httpStatus.raw || '0'))
    : (span.status === 'ERROR' ? 'ERROR' : 'OK');
  const respSize = attrs['http.response.body.size'] || attrs['http.response_content_length'] || '';

  return {
    type: 'http',
    title: `${httpMethod || 'HTTP'} Request to ${span.serviceName}`,
    request: {
      url: httpUrl,
      method: httpMethod || 'HTTP',
      headers: reqHeaders,
      body: reqBody,
      bodyOmitted: attrs['http.request.body.omitted'] || attrs['request.body.omitted'] || '',
    },
    response: {
      status: respStatus,
      body: respBody,
      result: respSize ? `${respSize} bytes` : undefined,
      bodyOmitted: attrs['http.response.body.omitted'] || attrs['response.body.omitted'] || '',
    },
    contextPropagation: {
      carrier: 'headers',
      traceparent,
      parentSpanId: span.parentSpanId,
      currentSpanId: span.spanId,
    },
  };
}

// Honest placeholder for payloads the instrumentation did not record.
function NotCaptured({ label }: { label: string }) {
  return (
    <div className="span-drawer-empty">
      <EyeOff size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </div>
  );
}

function payloadStatusTone(status: number | string | undefined, isError: boolean): 'ok' | 'error' {
  if (status === 0 || status === '0') return 'error';
  const n = Number(status);
  if (Number.isFinite(n) && n >= 400) return 'error';
  return isError ? 'error' : 'ok';
}

export function SpanDrawerContent({ span, traceDuration, onClose }: SpanDrawerContentProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'overview' | 'attributes' | 'payload' | 'json' | 'error'>(
    isSpanError(span) ? 'error' : 'overview'
  );
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const KindIcon = spanKindIcon(span.kind);
  const attrCount = span.attributes ? Object.keys(span.attributes).length : 0;
  const hasError = isSpanError(span);
  const hasEvents = Boolean(span.events && span.events.length > 0);
  const dest = getSpanDestination(span);
  const serviceColor = getSvcColor(span.serviceName);
  const shareOfTrace = traceDuration > 0 ? (span.durationMs / traceDuration) * 100 : 0;

  useEffect(() => {
    setActiveTab(prev => (prev === 'error' && !isSpanError(span) ? 'overview' : prev));
    setFilterQuery('');
  }, [span.spanId]);

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const formattedStartTime = useMemo(() => {
    try {
      return new Date(span.startTime).toLocaleString();
    } catch {
      return span.startTime;
    }
  }, [span.startTime]);

  const renderJson = useMemo(() => {
    const jsonStr = JSON.stringify(span, null, 2);
    const lines = jsonStr.split('\n');
    return lines.map((line, idx) => {
      const keyMatch = line.match(/^(\s*)"([^"]+)":/);
      if (keyMatch) {
        const indent = keyMatch[1];
        const key = keyMatch[2];
        const rest = line.substring(keyMatch[0].length);
        let restNode: React.ReactNode = rest;
        const trimmed = rest.trim();
        if (trimmed.startsWith('"')) {
          restNode = <span style={{ color: '#a7f3d0' }}> {trimmed}</span>;
        } else if (trimmed === 'true' || trimmed === 'false') {
          restNode = <span style={{ color: '#f43f5e' }}> {trimmed}</span>;
        } else if (trimmed === 'null') {
          restNode = <span style={{ color: '#94a3b8' }}> {trimmed}</span>;
        } else if (!isNaN(Number(trimmed.replace(/,$/, '')))) {
          restNode = <span style={{ color: '#fbbf24' }}> {trimmed}</span>;
        }
        return (
          <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.4' }}>
            {indent}
            <span style={{ color: '#818cf8', fontWeight: 600 }}>"{key}"</span>:
            {restNode}
          </div>
        );
      }
      return <div key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: '1.4', color: '#cbd5e1' }}>{line}</div>;
    });
  }, [span]);

  const stackTrace = useMemo(() => {
    const attrs = span.attributes || {};
    const directStack = attrs['exception.stacktrace'] || attrs['error.stack'] || attrs['stacktrace'] || attrs['stack'] || attrs['error.stacktrace'];
    if (directStack) return String(directStack);
    if (span.events) {
      const excEvent = span.events.find(e => e.name === 'exception' || e.name === 'error');
      if (excEvent && excEvent.attributes) {
        const evStack = excEvent.attributes['exception.stacktrace'] || excEvent.attributes['error.stack'] || excEvent.attributes['stacktrace'];
        if (evStack) return String(evStack);
      }
    }
    return null;
  }, [span]);

  const filteredAttributes = useMemo(() => {
    if (!span.attributes) return [];
    return Object.entries(span.attributes).filter(([k, v]) => {
      const q = filterQuery.toLowerCase();
      return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
    });
  }, [span.attributes, filterQuery]);

  const groupedAttributes = useMemo(() => {
    const groups: Record<string, [string, string][]> = {};
    filteredAttributes.forEach(([k, v]) => {
      const parts = k.split('.');
      const groupName = parts.length > 1 ? parts[0].toUpperCase() : 'GENERAL';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push([k, v]);
    });
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'GENERAL') return 1;
      if (b[0] === 'GENERAL') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredAttributes]);

  const tabs: { id: typeof activeTab; label: string; Icon: LucideIcon; badge?: number; tone?: 'error' }[] = [
    { id: 'overview', label: t('Overview'), Icon: LayoutDashboard },
    { id: 'attributes', label: t('Attributes'), Icon: Tags, badge: attrCount },
    { id: 'payload', label: t('Request'), Icon: ArrowLeftRight },
    ...(hasError ? [{ id: 'error' as const, label: t('Failure'), Icon: AlertCircle, tone: 'error' as const }] : []),
    { id: 'json', label: t('JSON'), Icon: Braces },
  ];

  return (
    <>
      <div className="span-drawer-header">
        <div className="span-drawer-title-row">
          <span
            className={`span-drawer-kind-tile ${hasError ? 'is-error' : ''}`}
            style={hasError ? undefined : { color: serviceColor, background: `color-mix(in srgb, ${serviceColor} 14%, var(--bg-secondary))`, borderColor: `color-mix(in srgb, ${serviceColor} 28%, var(--border-primary))` }}
          >
            <KindIcon size={18} strokeWidth={2.1} />
          </span>
          <div className="span-drawer-heading">
            <span className="span-drawer-kicker">{t('Span')} · {span.kind.toLowerCase()}</span>
            <h2 title={span.name}>{span.name}</h2>
            <p className="span-drawer-subtitle">
              <span style={{ color: serviceColor }}>{span.serviceName}</span>
              <span className="span-drawer-dot">·</span>
              <Folder size={11} strokeWidth={2.2} />
              {span.namespace || 'default'}
            </p>
          </div>
          <div className="span-drawer-header-actions">
            <DrawerDockControls />
            <button type="button" className="span-drawer-close" onClick={onClose} title={t('Close details')}>
              <X size={15} strokeWidth={2.3} />
            </button>
          </div>
        </div>
        <div className="span-drawer-chips">
          <span className={`span-drawer-chip ${hasError ? 'is-error' : 'is-ok'}`}>
            {hasError ? t('Error') : t('OK')}
          </span>
          <span className="span-drawer-chip">
            <Clock3 size={11} strokeWidth={2.2} />
            {formatDuration(span.durationMs)}
          </span>
          <span className="span-drawer-chip">{shareOfTrace.toFixed(1)}% {t('of trace')}</span>
        </div>
      </div>

      <nav className="span-drawer-tabs" aria-label={t('Span sections')}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${activeTab === tab.id ? 'active' : ''} ${tab.tone === 'error' ? 'is-error' : ''}`}
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.Icon size={14} strokeWidth={activeTab === tab.id ? 2.4 : 2} />
            <span>{tab.label}</span>
            {tab.badge != null ? <em>{tab.badge}</em> : null}
          </button>
        ))}
      </nav>

      <div className="span-drawer-body">
        {activeTab === 'overview' && (
          <div className="span-drawer-stack">
            <div className="span-drawer-metrics">
              <article>
                <small>{t('Duration')}</small>
                <strong>{formatDuration(span.durationMs)}</strong>
                <em>{shareOfTrace.toFixed(1)}% {t('of trace')}</em>
              </article>
              <article className={hasError ? 'is-error' : 'is-ok'}>
                <small>{t('Status')}</small>
                <strong>{hasError ? t('Error') : t('OK')}</strong>
                <em>{span.kind.toLowerCase()}</em>
              </article>
              <article>
                <small>{t('Kind')}</small>
                <strong className="is-row">
                  <KindIcon size={16} strokeWidth={2.2} />
                  {span.kind.toLowerCase()}
                </strong>
                <em>{span.serviceName}</em>
              </article>
            </div>

            <section className="span-drawer-card">
              <h3>{t('Identity')}</h3>
              <div className="span-drawer-kv-list">
                {dest.type && (
                  <DrawerKvRow label={t('Destination')} mono={false}>
                    <span className={`span-drawer-dest is-${dest.type}`}>
                      {dest.name}
                      <em>{dest.type === '3rdparty' ? t('3rd party') : dest.type}</em>
                    </span>
                  </DrawerKvRow>
                )}
                <DrawerKvRow label={t('Namespace')} value={span.namespace || t('unknown')} />
                {span.podName && (
                  <DrawerKvRow label={t('Pod')} value={span.podName} copied={copiedKey === 'pod'} onCopy={() => handleCopy('pod', span.podName!)} />
                )}
                {span.nodeName && <DrawerKvRow label={t('Node')} value={span.nodeName} />}
                <DrawerKvRow label={t('Span ID')} value={span.spanId} copied={copiedKey === 'spanId'} onCopy={() => handleCopy('spanId', span.spanId)} />
                {span.parentSpanId && (
                  <DrawerKvRow label={t('Parent ID')} value={span.parentSpanId} copied={copiedKey === 'parentSpanId'} onCopy={() => handleCopy('parentSpanId', span.parentSpanId!)} />
                )}
                <DrawerKvRow label={t('Start')} value={formattedStartTime} mono={false} />
              </div>
            </section>

            {hasEvents && (
              <section className="span-drawer-card">
                <h3>{t('Logs / Events')} <em>{span.events!.length}</em></h3>
                <div className="span-drawer-events">
                  {span.events!.map((ev, i) => (
                    <article key={`${ev.name}-${i}`}>
                      <header>
                        <strong>{ev.name}</strong>
                        <time>{new Date(ev.timestamp).toLocaleTimeString()}</time>
                      </header>
                      {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                        <div className="span-drawer-kv-list nested">
                          {Object.entries(ev.attributes).map(([ek, evVal]) => (
                            <DrawerKvRow key={ek} label={ek} value={String(evVal)} />
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'attributes' && (
          <div className="span-drawer-stack">
            <div className="span-drawer-search">
              <Search size={13} strokeWidth={2.3} />
              <input
                type="text"
                placeholder={t('Filter attributes...')}
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
            </div>
            {groupedAttributes.length === 0 ? (
              <div className="span-drawer-empty">{t('No matching attributes.')}</div>
            ) : (
              groupedAttributes.map(([groupName, attrsList]) => (
                <section key={groupName} className="span-drawer-card">
                  <h3>{groupName} <em>{attrsList.length}</em></h3>
                  <div className="span-drawer-kv-list">
                    {attrsList.map(([k, v]) => (
                      <DrawerKvRow
                        key={k}
                        label={k}
                        value={String(v) || '—'}
                        copied={copiedKey === k}
                        onCopy={() => handleCopy(k, String(v))}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}

        {activeTab === 'error' && (() => {
          const explanation = explainSpanError(span);
          const http = explanation.httpStatus ?? (readHttpStatus(span.attributes).present ? readHttpStatus(span.attributes).code : undefined);
          const evidence = redactEvidenceList(explanation.evidence);
          const exceptionMessage = redactSecretText(explanation.rawMessage || '');
          const exceptionType = explanation.exceptionType || '';
          const resolvedStack = stackTrace || explanation.stackTrace || null;
          const failureSummary = [
            explanation.title,
            explanation.what,
            exceptionType ? `Exception: ${exceptionType}` : '',
            exceptionMessage && exceptionMessage !== explanation.title ? exceptionMessage.split('\n')[0] : '',
            ...evidence.slice(0, 6).map(([k, v]) => `${k}: ${v}`),
          ].filter(Boolean).join('\n');

          return (
            <div className="span-drawer-stack">
              <div className="span-drawer-failure">
                <span className="span-drawer-failure-icon"><AlertCircle size={16} strokeWidth={2.2} /></span>
                <div className="span-drawer-failure-body">
                  <div className="span-drawer-failure-title">
                    <strong>{t(explanation.title)}</strong>
                    {http != null && Number.isFinite(http) && http > 0 && (
                      <em className="is-status">HTTP {http}</em>
                    )}
                    <em>{t(getErrorCategoryLabel(explanation.category))}</em>
                    <DrawerCopyButton
                      copied={copiedKey === 'failure-summary'}
                      onCopy={() => handleCopy('failure-summary', failureSummary)}
                      label={t('Copy failure summary')}
                    />
                  </div>
                  <p>{t(explanation.what)}</p>
                </div>
              </div>

              <div className="span-drawer-metrics">
                <article>
                  <small>{t('Operation')}</small>
                  <strong title={getSpanOperationLabel(span)}>{getSpanOperationLabel(span)}</strong>
                </article>
                <article>
                  <small>{t('Service')}</small>
                  <strong>{span.serviceName}</strong>
                </article>
                <article>
                  <small>{t('Duration')}</small>
                  <strong>{formatDuration(span.durationMs)}</strong>
                  <em>{explanation.target || dest.name || t('not captured')}</em>
                </article>
              </div>

              {(exceptionType || exceptionMessage) && (
                <section className="span-drawer-card">
                  <h3>{t('Exception')}</h3>
                  <div className="span-drawer-kv-list">
                    {exceptionType && (
                      <DrawerKvRow
                        label={t('Type')}
                        value={exceptionType}
                        copied={copiedKey === 'exc-type'}
                        onCopy={() => handleCopy('exc-type', exceptionType)}
                      />
                    )}
                    {exceptionMessage && exceptionMessage !== explanation.title && (
                      <DrawerKvRow label={t('Message')} mono={false}>
                        <pre className="span-drawer-pre is-inline">{exceptionMessage}</pre>
                      </DrawerKvRow>
                    )}
                  </div>
                </section>
              )}

              {explanation.causes.length > 0 && (
                <section className="span-drawer-card">
                  <h3>{t('Likely causes')}</h3>
                  <ol className="span-drawer-causes">
                    {explanation.causes.map((cause, idx) => (
                      <li key={`${idx}-${cause.slice(0, 24)}`}>{t(cause)}</li>
                    ))}
                  </ol>
                </section>
              )}

              {evidence.length > 0 && (
                <section className="span-drawer-card">
                  <h3>{t('Evidence from span')}</h3>
                  <div className="span-drawer-kv-list">
                    {evidence.map(([k, v]) => (
                      <DrawerKvRow
                        key={k}
                        label={k}
                        value={copiedKey === 'ev-' + k ? t('copied') : v}
                        copied={copiedKey === 'ev-' + k}
                        onCopy={() => handleCopy('ev-' + k, v)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="span-drawer-card">
                <h3>
                  {t('Stack Trace')}
                  {resolvedStack && (
                    <DrawerCopyButton
                      copied={copiedKey === 'stacktrace'}
                      onCopy={() => handleCopy('stacktrace', resolvedStack)}
                      label={t('Copy Stack Trace')}
                    />
                  )}
                </h3>
                {resolvedStack ? (
                  <pre className="span-drawer-pre is-code"><code>{resolvedStack}</code></pre>
                ) : (
                  <p className="span-drawer-empty-hint">
                    {t('No stack captured — exception may only exist as a message on this span.')}
                  </p>
                )}
              </section>
            </div>
          );
        })()}

        {activeTab === 'payload' && (() => {
          const details = getSpanPayloadDetails(span, traceDuration);
          const responseTone = payloadStatusTone(details.response.status, hasError);
          return (
            <div className="span-drawer-stack">
              <section className="span-drawer-card">
                <h3>{t('Trace context')}</h3>
                <div className="span-drawer-kv-list">
                  <DrawerKvRow
                    label={t('Parent span')}
                    value={span.parentSpanId || t('None (Root Span)')}
                    copied={copiedKey === 'parentSpanId'}
                    onCopy={span.parentSpanId ? () => handleCopy('parentSpanId', span.parentSpanId!) : undefined}
                  />
                  <DrawerKvRow
                    label={t('This span')}
                    value={span.spanId}
                    copied={copiedKey === 'spanId'}
                    onCopy={() => handleCopy('spanId', span.spanId)}
                  />
                  {details.contextPropagation?.traceparent && (
                    <DrawerKvRow
                      label="traceparent"
                      value={details.contextPropagation.traceparent}
                      copied={copiedKey === 'traceparent'}
                      onCopy={() => handleCopy('traceparent', details.contextPropagation!.traceparent!)}
                    />
                  )}
                </div>
              </section>

              <section className="span-drawer-card">
                <h3>
                  {details.request.method ? (
                    <span className={`method-badge ${details.request.method.toLowerCase()}`}>{details.request.method}</span>
                  ) : null}
                  {t('Request')}
                </h3>
                {details.request.url && (
                  <div className="span-drawer-url">
                    <span title={details.request.url}>{details.request.url}</span>
                    <DrawerCopyButton copied={copiedKey === 'reqUrl'} onCopy={() => handleCopy('reqUrl', details.request.url!)} />
                  </div>
                )}
                {details.request.headers && Object.keys(details.request.headers).length > 0 && (
                  <div className="span-drawer-kv-list nested">
                    {Object.entries(details.request.headers).map(([k, v]) => {
                      const [rk, rv] = redactEvidenceList([[k, String(v)]])[0];
                      return <DrawerKvRow key={k} label={rk} value={rv} />;
                    })}
                  </div>
                )}
                {details.type === 'db' ? (
                  <div className="span-drawer-body-block">
                    <div className="span-drawer-block-label">
                      {t('Database Statement')}
                      {details.request.statement && (
                        <DrawerCopyButton copied={copiedKey === 'sql'} onCopy={() => handleCopy('sql', details.request.statement!)} />
                      )}
                    </div>
                    {details.request.statement ? (
                      <pre className="query-code-block"><code>{details.request.statement}</code></pre>
                    ) : (
                      <NotCaptured label={t("Query text not captured — enable db.statement capture in the client's tracing settings.")} />
                    )}
                    {Array.isArray(details.request.parameters) && details.request.parameters.length > 0 && (
                      <div className="parameters-list">
                        {details.request.parameters.map((p: unknown, idx: number) => (
                          <span key={idx} className="param-badge">${idx + 1}: "{String(p)}"</span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="span-drawer-body-block">
                    <div className="span-drawer-block-label">
                      {t('Body')}
                      {details.request.body != null && (
                        <DrawerCopyButton copied={copiedKey === 'reqBody'} onCopy={() => handleCopy('reqBody', JSON.stringify(details.request.body, null, 2))} />
                      )}
                    </div>
                    {details.request.body != null ? (
                      <pre className="payload-code-block">
                        <code>{typeof details.request.body === 'string' ? details.request.body : JSON.stringify(details.request.body, null, 2)}</code>
                      </pre>
                    ) : (
                      <NotCaptured
                        label={
                          details.request.bodyOmitted
                            ? `${t('Body omitted')} — ${details.request.bodyOmitted}`
                            : t('Body not captured — binary content, over the size cap, or this pod has not been restarted with HTTP capture.')
                        }
                      />
                    )}
                  </div>
                )}
              </section>

              <section className="span-drawer-card">
                <h3>
                  <span className={`status-badge ${responseTone}`}>{details.response.status}</span>
                  {t('Response')}
                  <em className="span-drawer-h3-meta">{t('in')} {formatDuration(span.durationMs)}</em>
                </h3>
                {details.response.result && (
                  <p className="span-drawer-note">{t('Recorded response size:')} <strong>{details.response.result}</strong></p>
                )}
                <div className="span-drawer-body-block">
                  <div className="span-drawer-block-label">
                    {t('Body')}
                    {details.response.body != null && (
                      <DrawerCopyButton copied={copiedKey === 'respBody'} onCopy={() => handleCopy('respBody', JSON.stringify(details.response.body, null, 2))} />
                    )}
                  </div>
                    {details.response.body != null ? (
                      <pre className="payload-code-block">
                        <code>{typeof details.response.body === 'string' ? details.response.body : JSON.stringify(details.response.body, null, 2)}</code>
                      </pre>
                    ) : (
                      <NotCaptured
                        label={
                          details.response.bodyOmitted
                            ? `${t('Body omitted')} — ${details.response.bodyOmitted}`
                            : t('Body not captured — binary content, over the size cap, or this pod has not been restarted with HTTP capture.')
                        }
                      />
                    )}
                </div>
              </section>
            </div>
          );
        })()}

        {activeTab === 'json' && (
          <section className="span-drawer-card">
            <h3>
              {t('Full payload')}
              <DrawerCopyButton copied={copiedKey === 'json'} onCopy={() => handleCopy('json', JSON.stringify(span, null, 2))} label={t('Copy JSON')} />
            </h3>
            <pre className="span-drawer-pre is-code">{renderJson}</pre>
          </section>
        )}
      </div>
    </>
  );
}
