import type { Span } from '../entities';

export function connectLiveStream(
  namespace: string | undefined,
  onSpan: (span: Span) => void,
  onConnect?: () => void,
  onDisconnect?: () => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const nsParam = namespace ? `?namespace=${namespace}` : '';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws${nsParam}`);

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
