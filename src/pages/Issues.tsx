import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ErrorGroup } from '../entities';
import { LoadingState, NoDataState } from '../components/DataState';
import { useTranslation } from '../utils/i18n';

interface IssuesProps {
  namespace: string;
}

export default function Issues({ namespace }: IssuesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [issues, setIssues] = useState<ErrorGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getIssues(namespace || undefined, windowMinutes);
      setIssues(res.issues || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load issues');
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, [namespace, windowMinutes]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const total = useMemo(() => issues.reduce((sum, i) => sum + (i.count || 0), 0), [issues]);

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{t('Issues')}</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('Recurring error fingerprints from ClickHouse error_groups')}
            {namespace ? ` · ${namespace}` : ''}
            {` · ${total} ${t('events')}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="input-field"
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(Number(e.target.value))}
            aria-label={t('Window')}
          >
            <option value={15}>15m</option>
            <option value={60}>1h</option>
            <option value={360}>6h</option>
            <option value={1440}>24h</option>
          </select>
          <button type="button" className="btn-secondary" onClick={load}>{t('Refresh')}</button>
        </div>
      </div>

      {loading && <LoadingState label={t('Loading issues…')} />}
      {!loading && error && (
        <NoDataState title={t('Could not load issues')} hint={error} />
      )}
      {!loading && !error && issues.length === 0 && (
        <NoDataState
          title={t('No issues in this window')}
          hint={t('Error groups appear when instrumented services emit failing spans.')}
        />
      )}
      {!loading && !error && issues.length > 0 && (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">{t('Service')}</th>
                <th align="left">{t('Exception / message')}</th>
                <th align="left">{t('Transaction')}</th>
                <th align="right">{t('Count')}</th>
                <th align="left">{t('Last seen')}</th>
                <th align="left">{t('Example')}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.fingerprint}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{issue.serviceName}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{issue.namespace}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{issue.exceptionType || 'Error'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420 }} title={issue.exceptionMessage}>
                      {issue.exceptionMessage || issue.dbFingerprint || '—'}
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{issue.transactionName || '—'}</td>
                  <td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{issue.count}</td>
                  <td style={{ fontSize: 12 }}>{issue.lastSeen ? new Date(issue.lastSeen).toLocaleString() : '—'}</td>
                  <td>
                    {issue.exampleTraceId ? (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => navigate(`/traces/${issue.exampleTraceId}`)}
                      >
                        {issue.exampleTraceId.slice(0, 8)}…
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
