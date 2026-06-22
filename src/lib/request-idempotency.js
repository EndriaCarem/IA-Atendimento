/**
 * Idempotência para ações da IA (criação de agendamento, etc.).
 * Evita duplo agendamento se o WhatsApp reenviar a mesma mensagem.
 *
 * A IA deve enviar o header "Idempotency-Key: <uuid>" OU o campo
 * "idempotency_key" no body.
 *
 * TTL: 24h em memória. Em caso de restart do processo, a chave se perde
 * (aceitável para o volume atual).
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/** Map<key, { response: object, expires_at: number }> */
const store = new Map();

function purge() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expires_at < now) store.delete(k);
  }
}

/**
 * Constrói uma chave composta estável.
 * @param {string} clinicId
 * @param {string} type      ex: "appointment_create"
 * @param {string} clientKey valor fornecido pelo cliente
 */
export function buildKey(clinicId, type, clientKey) {
  return `${clinicId}:${type}:${clientKey}`;
}

/** Retorna a resposta cacheada ou null se não existir / expirada. */
export function getStoredResponse(key) {
  purge();
  return store.get(key)?.response ?? null;
}

/** Armazena a resposta para a chave dada. */
export function storeResponse(key, response) {
  store.set(key, { response, expires_at: Date.now() + TTL_MS });
}

/**
 * Extrai a idempotency key da requisição.
 * Prioridade: header "Idempotency-Key" > body.idempotency_key
 */
export function extractIdempotencyKey(req) {
  return (
    req.headers["idempotency-key"]?.trim() ||
    req.body?.idempotency_key?.trim() ||
    null
  );
}
