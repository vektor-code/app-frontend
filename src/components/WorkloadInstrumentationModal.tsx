import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Layers, Search, X } from 'lucide-react';
import type { ClusterApplication } from '../entities';
import LanguageIcon, { languageLogoFor } from './LanguageIcon';
import { HealthFilterBar } from './HealthFilterBar';
import { LoadingState, NoDataState } from './DataState';
import { useTranslation } from '../utils/i18n';

const STACK_OPTIONS = [
  { value: 'unknown', label: 'Auto', logo: null as string | null },
  { value: 'go', label: 'Go', logo: '/logos/go.svg' },
  { value: 'nodejs', label: 'Node.js', logo: '/logos/node.svg' },
  { value: 'python', label: 'Python', logo: '/logos/python.svg' },
  { value: 'java', label: 'Java', logo: '/logos/java.svg' },
  { value: 'dotnet', label: '.NET', logo: '/logos/dotnet.svg' },
  { value: 'php', label: 'PHP', logo: '/logos/php.svg' },
  { value: 'nginx', label: 'nginx', logo: '/logos/nginx.svg' },
  { value: 'apache-httpd', label: 'Apache', logo: '/logos/nginx.svg' },
] as const;

type StatusFilter = 'all' | 'active' | 'off';

function stackLabel(value?: string) {
  const key = (value || 'unknown').toLowerCase();
  return STACK_OPTIONS.find(option => option.value === key)?.label
    || (key === 'nginx' ? 'nginx' : key === 'apache-httpd' ? 'Apache' : value || 'Unknown');
}

function isUnknownStack(value?: string) {
  const key = (value || '').toLowerCase();
  return !key || key === 'unknown' || key === 'auto';
}

function alreadyInstrumented(details?: string) {
  if (!details) return false;
  return /annotation:|otel_|java_tool_options|node_options|pythonpath/i.test(details)
    && !/no otel injection/i.test(details);
}

function detectionCopy(app: ClusterApplication, t: (key: string) => string) {
  const detected = app.detectedLanguage || (!app.manualOverride ? app.language : '');
  const overridden = app.manualOverride && !isUnknownStack(app.language) && app.language !== detected;
  if (overridden) {
    return isUnknownStack(detected)
      ? t('Overridden — cluster could not detect a stack')
      : `${t('Overridden — cluster looks like')} ${stackLabel(detected)}`;
  }
  if (!isUnknownStack(detected)) {
    return `${t('Auto-detected:')} ${stackLabel(detected)}`;
  }
  if (app.statusReason && app.ready < app.replicas) {
    return t('Not detected — no Ready pod to inspect');
  }
  return t('Not detected — pick a stack before enabling');
}

/** Short operator-facing explanation for common kube waiting reasons. */
function statusBlockerCopy(reason: string, t: (key: string) => string): string {
  switch (reason) {
    case 'ImagePullBackOff':
    case 'ErrImagePull':
    case 'InvalidImageName':
      return t('Cannot pull the container image — auto-detect and injection need a running pod.');
    case 'CrashLoopBackOff':
      return t('Container keeps crashing — fix the app start before injection can stick.');
    case 'CreateContainerConfigError':
    case 'CreateContainerError':
      return t('Kubernetes cannot create the container (config or runtime error).');
    case 'OOMKilled':
      return t('Container was OOM-killed — raise memory limits or fix the leak.');
    case 'Pending':
      return t('Pod is still Pending — waiting on schedule or image pull.');
    default:
      return t('Workload is not Ready — auto-detect and live injection need a healthy pod.');
  }
}

function podTone(ready: number, replicas: number) {
  if (replicas <= 0) return 'neutral';
  if (ready >= replicas) return 'ok';
  if (ready > 0) return 'warn';
  return 'bad';
}

function StackSelect({
  value,
  disabled,
  open,
  onToggle,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const current = STACK_OPTIONS.find(option => option.value === (value || 'unknown')) || STACK_OPTIONS[0];
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const trigger = rootRef.current?.querySelector('button');
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 6, left: Math.max(12, rect.right - 176) });
    }
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('.wl-stack-menu')) return;
      onToggle();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onToggle]);

  return (
    <div className={`wl-stack ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="wl-stack-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={onToggle}
      >
        {current.logo ? <img src={current.logo} alt="" /> : <Layers size={14} />}
        <span>{current.value === 'unknown' ? t('Auto') : current.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && createPortal(
        <div className="wl-stack-menu" role="listbox" style={{ top: menuPos.top, left: menuPos.left }}>
          {STACK_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={current.value === option.value}
              className={current.value === option.value ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              {option.logo ? <img src={option.logo} alt="" /> : <Layers size={16} />}
              <span>{option.value === 'unknown' ? t('Auto') : option.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function WorkloadInstrumentationModal({
  namespace,
  apps,
  loading,
  togglingApp,
  search,
  onSearch,
  onClose,
  onToggle,
  onLanguageChange,
}: {
  namespace: string;
  apps: ClusterApplication[];
  loading: boolean;
  togglingApp: string | null;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onToggle: (app: ClusterApplication) => void;
  onLanguageChange: (app: ClusterApplication, language: string) => void;
}) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [openStack, setOpenStack] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openStack) {
        setOpenStack(null);
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, openStack]);

  const searched = useMemo(
    () => apps.filter(app => app.name.toLowerCase().includes(search.toLowerCase().trim())),
    [apps, search],
  );

  const activeCount = searched.filter(app => app.instrumented).length;
  const offCount = searched.length - activeCount;

  const visible = searched.filter(app => {
    if (statusFilter === 'active') return app.instrumented;
    if (statusFilter === 'off') return !app.instrumented;
    return true;
  });

  return createPortal(
    <div
      className="admin-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="admin-modal-panel admin-workload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wl-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="wl-head">
          <div className="wl-head-copy">
            <span className="wl-mark" aria-hidden>
              <Layers size={18} />
            </span>
            <div>
              <h3 id="wl-modal-title">{t('Workload Instrumentation')}</h3>
              <p>{t('Turn tracing on for each workload. Pick a stack if auto-detect is unsure.')}</p>
              <code className="wl-ns">{namespace}</code>
            </div>
          </div>
          <button type="button" className="admin-modal-close-btn" onClick={onClose} aria-label={t('Close')}>
            <X size={16} />
          </button>
        </header>

        <div className="wl-toolbar">
          <label className="wl-search">
            <Search size={15} />
            <input
              type="search"
              value={search}
              onChange={event => onSearch(event.target.value)}
              placeholder={t('Filter workloads by name...')}
              autoFocus
            />
          </label>
          <HealthFilterBar
            label={t('Status')}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: t('All'), count: searched.length },
              { value: 'active', label: t('Active'), count: activeCount, tone: 'healthy' },
              { value: 'off', label: t('Off'), count: offCount },
            ]}
          />
        </div>

        <div className="wl-list">
          {loading ? (
            <LoadingState label="Loading workloads…" height={220} />
          ) : visible.length === 0 ? (
            <NoDataState
              title="No matching workloads found in this namespace."
              hint="Try another name, or switch All / Active / Off."
              height={200}
            />
          ) : (
            visible.map(app => {
              const busy = togglingApp === app.name;
              const needsStack = !app.instrumented && isUnknownStack(app.language) && isUnknownStack(app.detectedLanguage);
              const language = app.language || app.detectedLanguage || 'unknown';
              const logo = languageLogoFor(language);
              const tone = podTone(app.ready, app.replicas);
              const injected = alreadyInstrumented(app.details);

              return (
                <article
                  key={app.name}
                  className={`wl-row ${app.instrumented ? 'is-on' : ''} ${needsStack ? 'needs-stack' : ''} ${busy ? 'is-busy' : ''}`}
                >
                  <div className="wl-identity">
                    <span className={`wl-avatar ${logo ? '' : 'is-empty'}`}>
                      {logo ? <LanguageIcon language={language} size={22} /> : <Layers size={16} />}
                    </span>
                    <div className="wl-copy">
                      <div className="wl-title">
                        <strong>{app.name}</strong>
                        <span className="wl-kind">{app.kind || 'Deployment'}</span>
                      </div>
                      <div className="wl-meta">
                        <span className={`wl-pods ${tone}`}>
                          <i />
                          {app.ready}/{app.replicas} {t('Ready')}
                        </span>
                        {app.statusReason && app.ready < app.replicas ? (
                          <span className="wl-status-reason" title={app.statusMessage || undefined}>
                            {app.statusReason}
                          </span>
                        ) : null}
                        <span className={`wl-detect ${app.manualOverride ? 'overridden' : needsStack ? 'unknown' : 'detected'}`}>
                          {detectionCopy(app, t)}
                        </span>
                      </div>
                      {app.statusReason && app.ready < app.replicas ? (
                        <p className="wl-blocker">
                          {statusBlockerCopy(app.statusReason, t)}
                          {app.statusMessage ? (
                            <span className="wl-blocker-msg" title={app.statusMessage}>
                              {app.statusMessage}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      {injected && (
                        <details className="wl-inject">
                          <summary>{t('How it is injected')}</summary>
                          <code>{app.details}</code>
                        </details>
                      )}
                    </div>
                  </div>

                  <div className="wl-controls">
                    <StackSelect
                      value={language}
                      disabled={busy}
                      open={openStack === app.name}
                      onToggle={() => setOpenStack(open => (open === app.name ? null : app.name))}
                      onChange={next => {
                        onLanguageChange(app, next);
                        setOpenStack(null);
                      }}
                    />
                    {app.manualOverride && (
                      <button
                        type="button"
                        className="wl-reset"
                        disabled={busy}
                        onClick={() => onLanguageChange(app, 'unknown')}
                      >
                        {t('Use auto-detect')}
                      </button>
                    )}
                    <div className="wl-toggle">
                      <span className={app.instrumented ? 'is-on' : 'is-off'}>
                        {app.instrumented ? t('Active') : t('Off')}
                      </span>
                      {busy ? <span className="admin-workload-spinner" /> : null}
                      <label className={`admin-switch ${busy || needsStack ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={app.instrumented}
                          disabled={busy || needsStack}
                          onChange={() => onToggle(app)}
                        />
                        <i />
                      </label>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <footer className="wl-foot">
          <span>
            <strong>{apps.filter(app => app.instrumented).length}</strong>
            {' / '}
            {apps.length} {t('instrumented')}
          </span>
          <button type="button" className="btn btn-primary wl-done" onClick={onClose}>
            {t('Done')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
