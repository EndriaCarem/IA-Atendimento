/**
 * Heartbeat das instâncias Evolution.
 *
 * O webhook chama `recordInstanceEvent(instanceName)` a CADA evento recebido
 * (qualquer evento: mensagem, recibo, grupo). Receber eventos é a prova de que
 * a conexão com o WhatsApp está realmente viva — diferente do connectionState,
 * que pode reportar "open" mesmo com a conexão zumbi (caída de fato).
 *
 * O health-monitor lê `getLastEventAt(instanceName)` para detectar zumbis:
 * instância "open" mas sem eventos há muito tempo = caiu sem avisar.
 */

const lastEventByInstance = new Map();

export function recordInstanceEvent(instanceName) {
  if (!instanceName) return;
  lastEventByInstance.set(instanceName, Date.now());
}

export function getLastEventAt(instanceName) {
  return lastEventByInstance.get(instanceName) ?? null;
}

export function getAllHeartbeats() {
  return new Map(lastEventByInstance);
}
