import type { TraceInvestigation, TraceInvestigationObservation } from '../../entities';
import {
  formatInvestigationState,
  formatObservationMessage,
  observationMark,
  observationTone,
} from '../../utils/investigationDisplay';

interface Props {
  investigation: TraceInvestigation | null;
  loading: boolean;
  t: (key: string) => string;
}

type HopId = 'source' | 'network' | 'destination' | 'probe';

const HOP_ORDER: HopId[] = ['source', 'network', 'destination', 'probe'];

function hopOf(item: TraceInvestigationObservation): HopId {
  if (item.hop === 'source' || item.hop === 'network' || item.hop === 'destination' || item.hop === 'probe') {
    return item.hop;
  }
  switch (item.code) {
    case 'source_pod_status':
      return 'source';
    case 'network_policy':
      return 'network';
    case 'http_request':
    case 'tcp_connect':
      return 'probe';
    default:
      return 'destination';
  }
}

function hopLabel(hop: HopId, t: (key: string) => string): string {
  switch (hop) {
    case 'source':
      return t('Source');
    case 'network':
      return t('Path');
    case 'destination':
      return t('Destination');
    case 'probe':
      return t('Live check');
    default:
      return hop;
  }
}

function hopTone(items: TraceInvestigationObservation[]): 'ok' | 'warn' | 'info' {
  if (items.some(item => observationTone(item) === 'warn')) return 'warn';
  if (items.some(item => observationTone(item) === 'ok')) return 'ok';
  return 'info';
}

export function K8sVerification({ investigation, loading, t }: Props) {
  const observed = (investigation?.observations || []).filter(item => item.kind === 'observed');
  const grouped = new Map<HopId, TraceInvestigationObservation[]>();
  for (const item of observed) {
    const hop = hopOf(item);
    const list = grouped.get(hop) || [];
    list.push(item);
    grouped.set(hop, list);
  }
  const hops = HOP_ORDER.filter(hop => (grouped.get(hop) || []).length > 0);
  const hypothesis = observed.find(item => item.code === 'dest_unmapped' || item.code === 'dest_identity' || item.code === 'dest_protocol');
  const pending = !investigation || investigation.status === 'pending';

  return (
    <div className="diagnosis-k8s">
      <div className="diagnosis-k8s-head">
        <span>{t('Kubernetes verification')}</span>
        {investigation?.status === 'pending' && loading && <em>{t('Investigating…')}</em>}
        {investigation?.cached && <em>{t('Cached')}</em>}
        {investigation?.referencedBy && investigation.referencedBy > 1 && (
          <em>{investigation.referencedBy} {t('traces share this result')}</em>
        )}
      </div>
      {pending && loading && !observed.length && (
        <span className="diagnosis-k8s-pending">
          {investigation?.status === 'pending' ? t('Investigating…') : t('Live verification available')}
        </span>
      )}
      {investigation && investigation.status !== 'pending' && (
        <>
          {hops.length > 0 && (
            <div className="diagnosis-k8s-path">
              {hops.map((hop, index) => {
                const items = grouped.get(hop) || [];
                const tone = hopTone(items);
                return (
                  <div key={hop} className={`diagnosis-k8s-hop ${tone}`}>
                    {index > 0 && <i className="diagnosis-k8s-hop-join" aria-hidden="true" />}
                    <em>{hopLabel(hop, t)}</em>
                    {items.slice(0, 3).map(item => (
                      <p key={`${item.code}-${item.pod || ''}-${item.message.slice(0, 24)}`}>
                        <b aria-hidden="true">{observationMark(observationTone(item))}</b>
                        {t(formatObservationMessage(item))}
                      </p>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {!hops.length && (investigation.checks || []).map(check => {
            const tone = observationTone({ code: check.code, ok: check.ok, message: check.detail });
            return (
              <div key={`${check.level}-${check.code}-${check.pod || ''}`} className={`diagnosis-k8s-check ${tone}`}>
                <b aria-hidden="true">{observationMark(tone)}</b>
                <span>{t(formatObservationMessage({ code: check.code, message: check.detail }))}</span>
              </div>
            );
          })}
          {hypothesis && hypothesis.code === 'dest_unmapped' && (
            <div className="diagnosis-k8s-hypothesis">
              <em>{t('Finding')}</em>
              <strong>{t(formatObservationMessage(hypothesis))}</strong>
            </div>
          )}
          {(investigation.originalState || investigation.currentState || investigation.inference || investigation.conclusion) && (
            <div className="diagnosis-k8s-states">
              {investigation.originalState && (
                <span>
                  {t('Original failure')}
                  <strong>{t(formatInvestigationState(investigation.originalState))}</strong>
                </span>
              )}
              {investigation.currentState && (
                <span>
                  {t('Current state')}
                  <strong>{t(formatInvestigationState(investigation.currentState))}</strong>
                </span>
              )}
              {(investigation.inference || investigation.conclusion) && (
                <span className="wide">
                  {t('Conclusion')}
                  <strong>
                    {t(investigation.inference || investigation.conclusion || '')}
                    {investigation.confidence ? ` · ${t(investigation.confidence)}` : ''}
                  </strong>
                </span>
              )}
            </div>
          )}
          {investigation.status === 'unavailable' && <span className="diagnosis-k8s-pending">{t(investigation.skipReason || '')}</span>}
          {investigation.status === 'rate_limited' && <span className="diagnosis-k8s-pending">{t(investigation.skipReason || '')}</span>}
          {investigation.status === 'expired' && <span className="diagnosis-k8s-pending">{t(investigation.skipReason || '')}</span>}
        </>
      )}
    </div>
  );
}
