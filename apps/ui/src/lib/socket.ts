import type { ClientMessage, ServerMessage } from '@headunit/shared';

type Status = 'connecting' | 'open' | 'closed';

/** Self-healing WebSocket: reconnects with backoff, drops sends while offline. */
export function connectSocket(onMessage: (m: ServerMessage) => void, onStatus: (s: Status) => void) {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: number | undefined;
  let stopped = false;

  const open = () => {
    onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      attempt = 0;
      onStatus('open');
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => {
      onStatus('closed');
      if (stopped) return;
      timer = window.setTimeout(open, Math.min(5000, 400 * 2 ** attempt++));
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return {
    send(m: ClientMessage) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close() {
      stopped = true;
      window.clearTimeout(timer);
      ws?.close();
    },
  };
}
