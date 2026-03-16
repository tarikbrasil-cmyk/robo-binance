/**
 * Utilitário para formatar e disparar mensagens padronizadas por WebSockets
 * para todos os clientes conectados (Dashboard).
 */

export function broadcastMessage(wss, type, payload) {
  if (!wss) return;
  const message = JSON.stringify({ type, data: payload, timestamp: Date.now() });

  wss.clients.forEach((client) => {
    // ws.OPEN tem o valor 1 na lib ws
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}
