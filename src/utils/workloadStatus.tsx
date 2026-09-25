import React from 'react';
import type { ClusterApplication } from '../entities';

export type TranslateFn = (key: string) => string;

export interface NamespaceWorkloadStatus {
  /** Count of workloads per kube waiting/terminated reason. */
  reasons: Map<string, number>;
  /** Workloads with ready < replicas. */
  notReady: number;
}

/** Short operator-facing explanation for common kube waiting reasons. */
export function statusBlockerCopy(reason: string, t: TranslateFn): string {
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

/** Instrumentation is on but pods are not Ready yet. */
export function activeBlockedCopy(reason: string, t: TranslateFn): string {
  return t('Instrumentation is Active, but no Ready pod — injection cannot run until {reason} is fixed.')
    .replace('{reason}', reason);
}

export function summarizeWorkloadStatus(apps: ClusterApplication[]): NamespaceWorkloadStatus {
  const reasons = new Map<string, number>();
  let notReady = 0;

  for (const app of apps) {
    if (app.ready >= app.replicas) continue;
    notReady += 1;
    if (!app.statusReason) continue;
    reasons.set(app.statusReason, (reasons.get(app.statusReason) || 0) + 1);
  }

  return { reasons, notReady };
}

export function WorkloadStatusReason({
  reason,
  message,
  count,
}: {
  reason: string;
  message?: string;
  count?: number;
}) {
  const label = count && count > 1 ? `${reason} ×${count}` : reason;
  return (
    <span className="wl-status-reason" title={message || undefined}>
      {label}
    </span>
  );
}

export function WorkloadStatusReasonSummary({
  status,
  className,
}: {
  status: NamespaceWorkloadStatus;
  className?: string;
}) {
  if (status.notReady <= 0 || status.reasons.size === 0) return null;

  const entries = [...status.reasons.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className={className || 'admin-workload-status-row'}>
      {entries.map(([reason, count]) => (
        <WorkloadStatusReason key={reason} reason={reason} count={count} />
      ))}
    </div>
  );
}

/** Run async tasks with a concurrency limit. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}
