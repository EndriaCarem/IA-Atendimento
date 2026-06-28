/**
 * Audit log de ações executadas pela Secretária IA.
 * Grava na coleção "ai_actions_log" do JSON DB.
 * Nunca lança exceção — falha silenciosa com warning no log.
 */
import { dbInsert } from "./json-db.js";
import { logger } from "./logger.js";

/**
 * @param {object} params
 * @param {string} params.clinicId
 * @param {string} [params.conversationId]  identificador da conversa (phone-based)
 * @param {string} [params.patientPhone]
 * @param {string} params.action            ex: "appointment_create", "patient_lookup"
 * @param {object} [params.payload]         dados de entrada relevantes
 * @param {object} [params.result]          resposta resumida
 */
export function logAiAction({ clinicId, conversationId = null, patientPhone = null, action, payload = {}, result = {} }) {
  try { dbInsert("ai_actions_log", {
      clinic_id: clinicId,
      conversation_id: conversationId,
      patient_phone: patientPhone,
      action,
      payload,
      result,
    });
  } catch (err) {
    logger.warn({ err, action, clinicId }, "[ACTION_LOG] Falha ao gravar audit log");
  }
}
 