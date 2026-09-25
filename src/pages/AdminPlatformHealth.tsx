import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { LoadingState, NoDataState } from '../components/DataState';
import { useTranslation } from '../utils/i18n';
import {
  normalizePlatformHealthReport,
  platformHealthPods,
  type PlatformHealthReport,
  type PlatformPod,
  type PlatformSeverity,
} from '../utils/platformHealth';

function severityClass(s: PlatformSeverity) {
  switch (s) {
    case 'critical':
      return 'critical';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'ok';
  }
}

function podKey(p: PlatformPod) {
  return `${p.cluster || 'local'}|${p.namespace}|${p.name}`;
}

export default function AdminPlatformHealth() {
  const { t } = useTranslation();
  const [report, setReport] = useState<PlatformHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState('');
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = normalizePlatformHealthReport(await api.getPlatformHealth(namespace || undefined));
      setReport(data);
      if (!selectedPod) {
        const firstBad = platformHealthPods(data).find(
          p => p.status === 'critical' || p.status === 'warning',
        );
        if (firstBad) setSelectedPod(podKey(firstBad));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load platform health');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [namespace, selectedPod]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 20000);
    return () => window.clearInterval(id);
  }, [load]);

  const pods = useMemo(() => {
    if (!report) return [];
    const all = platformHealthPods(report);
    if (!onlyProblems) return all;
    return all.filter(p => p.status !== 'ok' || p.issues.length > 0 || p.logErrors.length > 0);
  }, [report, onlyProblems]);

  const activePod = useMemo(() => {
    if (!report) return null;
    const all = platformHealthPods(report);
    return all.find(p => podKey(p) === selectedPod) || all[0] || null;
  }, [report, selectedPod]);

  return (
    <div className="admin-platform-health">
      <div className="admin-section-heading action">
        <div>
          <span>{t('Platform')}</span>
          <h2>{t('APM pod diagnostics')}</h2>
          <p>{t('Live status, warning events, and error/warn logs for api, agent, ingestor, frontend, and the OTel operator.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input-field"
            style={{ width: 160 }}
            placeholder={t('Namespace')}
            value={namespace}
            onChange={e => setNamespace(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
          />
          <label className="admin-switch" style={{ gap: 8 }}>
            <span style={{ fontSize: 12 }}>{t('Problems only')}</span>
            <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
            <i />
          </label>
          <button type="button" className="admin-refresh-btn" onClick={load} disabled={loading}>
            {t('Refresh')}
          </button>
        </div>
      </div>

      {loading && !report && <LoadingState label={t('Inspecting APM pods…')} height={280} />}
      {!loading && error && <NoDataState title={t('Could not load platform health')} hint={error} height={220} />}

      {report && (
        <>
          <div className="admin-summary-grid">
            <div className={`admin-summary-card ${report.summary.status === 'critical' ? 'neutral' : 'emerald'}`}>
              <span>{t('Overall')}</span>
              <strong style={{ textTransform: 'uppercase', fontSize: 18 }}>{report.summary.status}</strong>
              <em>{report.namespace}</em>
            </div>
            <div className="admin-summary-card indigo">
              <span>{t('Critical')}</span>
              <strong>{report.summary.critical}</strong>
              <em>{t('pods')}</em>
            </div>
            <div className="admin-summary-card cyan">
              <span>{t('Warning')}</span>
              <strong>{report.summary.warning}</strong>
              <em>{t('pods')}</em>
            </div>
            <div className="admin-summary-card neutral">
              <span>{t('Healthy')}</span>
              <strong>{report.summary.healthy}</strong>
              <em>{report.summary.pods} {t('total')}</em>
            </div>
          </div>

          {report.clusters?.length ? (
            <div className="admin-platform-grid" style={{ marginBottom: 12 }}>
              {report.clusters.map(cl => (
                <div key={cl.id} className={`admin-platform-comp ${cl.status === 'ok' ? 'ok' : cl.status === 'stale' ? 'warning' : 'critical'}`}>
                  <span className="admin-platform-comp-id">{cl.id}</span>
                  <strong>{cl.status}</strong>
                  <em>{cl.mode}{cl.detail ? ` · ${cl.detail}` : ''}</em>
                </div>
              ))}
            </div>
          ) : null}

          {report.notes?.length ? (
            <div className="card" style={{ padding: 12, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
              {report.notes.join(' · ')}
            </div>
          ) : null}

          <div className="admin-platform-grid">
            {report.components.map(comp => (
              <button
                key={comp.id}
                type="button"
                className={`admin-platform-comp ${severityClass(comp.status)}`}
                onClick={() => {
                  if (comp.pods[0]) setSelectedPod(podKey(comp.pods[0]));
                }}
              >
                <span className="admin-platform-comp-id">{comp.id}</span>
                <strong>{comp.status}</strong>
                <em>{comp.podCount} {t('pods')} · {comp.issues.length} {t('issues')}</em>
              </button>
            ))}
          </div>

          <div className="admin-platform-split">
            <div className="admin-platform-list card">
              <div className="admin-platform-list-head">{t('Pods')}</div>
              {pods.length === 0 ? (
                <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
                  {onlyProblems ? t('No problem pods right now.') : t('No APM pods found in this namespace.')}
                </div>
              ) : (
                pods.map(pod => (
                  <button
                    key={podKey(pod)}
                    type="button"
                    className={`admin-platform-pod ${selectedPod === podKey(pod) ? 'active' : ''} ${severityClass(pod.status)}`}
                    onClick={() => setSelectedPod(podKey(pod))}
                  >
                    <span className={`admin-platform-pill ${severityClass(pod.status)}`}>{pod.status}</span>
                    <span className="admin-platform-pod-main">
                      <strong>{pod.name}</strong>
                      <em>{[pod.cluster, pod.component, pod.phase].filter(Boolean).join(' · ')} · restarts {pod.restarts}</em>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="admin-platform-detail card">
              {!activePod ? (
                <NoDataState title={t('Select a pod')} hint={t('Choose a pod to see containers, events, and log errors.')} height={280} />
              ) : (
                <PodDetail pod={activePod} t={t} />
              )}
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            {t('Generated')} {new Date(report.generatedAt).toLocaleString()}
            {report.sources?.length ? ` · ${t('sources')}: ${report.sources.join(', ')}` : ''}
            {' · '}{t('auto-refresh 20s')}
          </div>
        </>
      )}

      <style>{`
        .admin-platform-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 10px;
          margin: 0 0 16px;
        }
        .admin-platform-comp {
          text-align: left;
          border: 1px solid var(--border-primary);
          background: var(--bg-secondary);
          border-radius: 10px;
          padding: 12px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .admin-platform-comp strong { text-transform: uppercase; font-size: 12px; letter-spacing: 0.04em; }
        .admin-platform-comp.critical strong { color: var(--accent-rose); }
        .admin-platform-comp.warning strong { color: #d97706; }
        .admin-platform-comp.ok strong { color: var(--accent-emerald); }
        .admin-platform-comp-id { font-size: 12px; font-weight: 700; color: var(--text-primary); }
        .admin-platform-comp em { font-style: normal; font-size: 11px; color: var(--text-tertiary); }
        .admin-platform-split {
          display: grid;
          grid-template-columns: minmax(240px, 320px) 1fr;
          gap: 12px;
          align-items: start;
        }
        @media (max-width: 960px) {
          .admin-platform-split { grid-template-columns: 1fr; }
        }
        .admin-platform-list { padding: 0; overflow: hidden; }
        .admin-platform-list-head {
          padding: 12px 14px;
          font-size: 12px;
          font-weight: 700;
          border-bottom: 1px solid var(--border-primary);
          color: var(--text-secondary);
        }
        .admin-platform-pod {
          width: 100%;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 12px 14px;
          border: 0;
          border-bottom: 1px solid var(--border-primary);
          background: transparent;
          cursor: pointer;
          text-align: left;
        }
        .admin-platform-pod.active { background: color-mix(in srgb, var(--accent-indigo) 8%, transparent); }
        .admin-platform-pod-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .admin-platform-pod-main strong {
          font-size: 12px;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .admin-platform-pod-main em { font-style: normal; font-size: 11px; color: var(--text-tertiary); }
        .admin-platform-pill {
          flex: 0 0 auto;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 3px 6px;
          border-radius: 999px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }
        .admin-platform-pill.critical { background: color-mix(in srgb, var(--accent-rose) 18%, transparent); color: var(--accent-rose); }
        .admin-platform-pill.warning { background: rgba(217, 119, 6, 0.15); color: #d97706; }
        .admin-platform-pill.ok { background: color-mix(in srgb, var(--accent-emerald) 16%, transparent); color: var(--accent-emerald); }
        .admin-platform-detail { padding: 16px; min-height: 360px; }
        .admin-platform-detail h3 { margin: 0 0 4px; font-size: 15px; }
        .admin-platform-meta { font-size: 12px; color: var(--text-tertiary); margin-bottom: 14px; }
        .admin-platform-block { margin-top: 16px; }
        .admin-platform-block h4 {
          margin: 0 0 8px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-secondary);
        }
        .admin-platform-issue {
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 8px;
          background: var(--bg-primary);
        }
        .admin-platform-issue.critical { border-color: color-mix(in srgb, var(--accent-rose) 45%, var(--border-primary)); }
        .admin-platform-issue.warning { border-color: rgba(217, 119, 6, 0.45); }
        .admin-platform-issue-top {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 4px;
          font-size: 11px;
          color: var(--text-tertiary);
        }
        .admin-platform-issue strong { display: block; font-size: 13px; color: var(--text-primary); }
        .admin-platform-issue p { margin: 6px 0 0; font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; }
        .admin-platform-log {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
          line-height: 1.45;
          max-height: 220px;
          overflow: auto;
          background: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px;
        }
        .admin-platform-log .err { color: var(--accent-rose); }
        .admin-platform-log .warn { color: #d97706; }
        .admin-platform-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .admin-platform-table th, .admin-platform-table td {
          text-align: left;
          padding: 8px 6px;
          border-bottom: 1px solid var(--border-primary);
          vertical-align: top;
        }
        .admin-platform-table th { color: var(--text-tertiary); font-weight: 600; }
      `}</style>
    </div>
  );
}

function PodDetail({ pod, t }: { pod: PlatformPod; t: (k: string) => string }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`admin-platform-pill ${severityClass(pod.status)}`}>{pod.status}</span>
        <h3>{pod.name}</h3>
      </div>
      <div className="admin-platform-meta">
        {[pod.cluster, pod.component, pod.namespace, pod.phase].filter(Boolean).join(' · ')}
        {pod.nodeName ? ` · ${pod.nodeName}` : ''}
        {` · ready ${pod.ready ? 'yes' : 'no'} · restarts ${pod.restarts}`}
      </div>

      <div className="admin-platform-block">
        <h4>{t('Containers')}</h4>
        <table className="admin-platform-table">
          <thead>
            <tr>
              <th>{t('Name')}</th>
              <th>{t('State')}</th>
              <th>{t('Ready')}</th>
              <th>{t('Restarts')}</th>
              <th>{t('Detail')}</th>
            </tr>
          </thead>
          <tbody>
            {pod.containers.map(c => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.state}{c.reason ? ` (${c.reason})` : ''}</td>
                <td>{c.ready ? 'yes' : 'no'}</td>
                <td>{c.restartCount}</td>
                <td>{c.message || (c.exitCode != null ? `exit ${c.exitCode}` : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-platform-block">
        <h4>{t('Issues')} ({pod.issues.length})</h4>
        {pod.issues.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('No issues detected for this pod.')}</div>
        ) : (
          pod.issues.map((issue, idx) => (
            <div key={`${issue.source}-${idx}`} className={`admin-platform-issue ${severityClass(issue.severity)}`}>
              <div className="admin-platform-issue-top">
                <span className={`admin-platform-pill ${severityClass(issue.severity)}`}>{issue.severity}</span>
                <span>{issue.source}{issue.code ? ` · ${issue.code}` : ''}</span>
              </div>
              <strong>{issue.message}</strong>
              {issue.detail ? <p>{issue.detail}</p> : null}
            </div>
          ))
        )}
      </div>

      <div className="admin-platform-block">
        <h4>{t('Warning events')}</h4>
        {pod.events.filter(e => e.type === 'Warning').length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('No Warning events.')}</div>
        ) : (
          <table className="admin-platform-table">
            <thead>
              <tr>
                <th>{t('Reason')}</th>
                <th>{t('Message')}</th>
                <th>{t('Count')}</th>
              </tr>
            </thead>
            <tbody>
              {pod.events.filter(e => e.type === 'Warning').map((e, i) => (
                <tr key={`${e.reason}-${i}`}>
                  <td>{e.reason}</td>
                  <td>{e.message}</td>
                  <td>{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-platform-block">
        <h4>{t('Error / warn log lines')}</h4>
        {pod.logFetchError ? (
          <div style={{ fontSize: 12, color: 'var(--accent-rose)', marginBottom: 8 }}>{pod.logFetchError}</div>
        ) : null}
        {pod.logErrors.length === 0 && !(pod.previousLogErrors && pod.previousLogErrors.length) ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('No error/warn lines in the recent log tail.')}</div>
        ) : (
          <div className="admin-platform-log">
            {pod.logErrors.map((l, i) => (
              <div key={`c-${i}`} className={l.severity === 'critical' ? 'err' : 'warn'}>{l.line}</div>
            ))}
            {(pod.previousLogErrors || []).map((l, i) => (
              <div key={`p-${i}`} className={l.severity === 'critical' ? 'err' : 'warn'}>[previous] {l.line}</div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-platform-block">
        <h4>{t('Recent logs')}</h4>
        {pod.recentLogs.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('No recent log lines.')}</div>
        ) : (
          <div className="admin-platform-log">
            {pod.recentLogs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
