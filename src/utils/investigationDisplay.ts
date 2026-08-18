const STATE_LABELS: Record<string, string> = {
  'TRANSPORT / UPSTREAM CONNECTIVITY': 'Transport / upstream connectivity',
  'APPLICATION / DOWNSTREAM HTTP FAILURE': 'Application / downstream HTTP failure',
  'APPLICATION-LEVEL HTTP 4xx': 'Application-level HTTP 4xx',
  'NOT REPRODUCED': 'Not reproduced',
  'REPRODUCED': 'Reproduced',
  'LIVE RETRY NOT POSSIBLE': 'Live retry not possible',
  'CURRENTLY DEGRADED': 'Currently degraded',
  'SOURCE NOT READY': 'Source not ready',
  'NOT VERIFIED': 'Not verified',
  'INCONCLUSIVE': 'Inconclusive',
  UNKNOWN: 'Unknown',
};

export function formatInvestigationState(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return STATE_LABELS[trimmed] || STATE_LABELS[trimmed.toUpperCase()] || trimmed;
}

export function observationTone(item: { code?: string; ok?: boolean; message?: string }): 'ok' | 'warn' | 'info' {
  if (item.code === 'destination_context' || item.code === 'context_local_target') return 'info';
  if (item.ok === true) return 'ok';
  if (item.ok === false) return 'warn';
  return 'info';
}

export function observationMark(tone: 'ok' | 'warn' | 'info'): string {
  if (tone === 'ok') return '✓';
  if (tone === 'warn') return '·';
  return '→';
}

export function formatObservationMessage(item: { code?: string; message: string }): string {
  let msg = item.message || '';
  msg = msg.replace(/^Source pod deployment /, 'Deployment ');
  msg = msg.replace(/^Pod deployment /, 'Deployment ');

  if (/Kubernetes Service mapping is not applicable/i.test(msg) || /Target is local to the same pod/i.test(msg)) {
    return 'This call stayed inside the same pod, so Kubernetes Service mapping does not apply.';
  }

  if (/exec into existing|replay fidelity/i.test(msg)) {
    const status = msg.match(/returned HTTP (\d+)/i);
    const worker = msg.match(/diagnostic worker (\S+)/i);
    const pod = msg.match(/(?:source pod |request from )([^\s;]+)/i);
    if (status) {
      const from = worker ? `diagnostic worker ${worker[1].replace(/[.,;]$/, '')}` : pod ? pod[1] : 'the source pod';
      return `Live retry from ${from} returned HTTP ${status[1]} — did not match the recorded failure`;
    }
    msg = msg.replace(/^exec into existing (?:source )?/i, 'Live retry from ');
    msg = msg.replace(/^exec skipped:\s*/i, 'Live retry skipped: ');
    msg = msg.replace(/; replay fidelity: \w+/i, '');
  }
  return msg;
}
