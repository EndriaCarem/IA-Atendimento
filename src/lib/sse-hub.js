/**
 * Hub SSE (Server-Sent Events) para o painel ao vivo da Secretária IA.
 * Mantém uma lista de subscribers por clinicId.
 * Usado por: GET /api/clinics/:clinicId/conversations/stream
 * Emitido por: message-processor.service.js após cada mensagem salva.
 */

/** Map<clinicId, Set<Response>> */
const clients = new Map();

export function addSseClient(clinicId, res) {
  if (!clients.has(clinicId)) clients.set(clinicId, new Set());
  clients.get(clinicId).add(res);
}

export function removeSseClient(clinicId, res) {
  clients.get(clinicId)?.delete(res);
}

/**
 * Envia um evento SSE para todos os clientes conectados de uma clínica.
 * @param {string} clinicId
 * @param {string} eventName  ex: "messages:new", "handoff:changed"
 * @param {object} data       payload JSON
 */
export function broadcastToClinic(clinicId, eventName, data) {
  const subs = clients.get(clinicId);
  if (!subs?.size) return;

  const raw = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of subs) {
    try {
      res.write(raw);
    } catch {
      // cliente desconectado; será limpo no evento "close"
    }
  }
}
