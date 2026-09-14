import type { Span } from '../entities';

export function connectLiveStream(
  namespace: string | undefined,
  onSpan: (span: Span) => void,
  onConnect?: () => void,
  onDisconnect?: () => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (namespace) params.set('namespace', namespace);
  const token = localStorage.getItem('token');
  if (token) params.set('token', token);
  const qs = params.toString();
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws${qs ? `?${qs}` : ''}`);

  ws.onopen = () => onConnect?.();
  ws.onclose = () => onDisconnect?.();
  ws.onerror = () => onDisconnect?.();
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'span' && msg.data) {
        onSpan(msg.data);
      }
    } catch {}
  };

  return () => ws.close();
}
