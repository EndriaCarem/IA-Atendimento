import { env } from "../config/env.js";
import { dbInsert } from "../lib/json-db.js";

export async function insertWhatsAppMessage({
  clinicId,
  patientPhone,
  patientName = null,
  direction,
  text,
  instanceName = null,
  externalMessageId = null,
  intent = null,
  aiHandled = false,
  handoffRequested = false,
  metadata = {}
}) {
  const payload = {
    clinic_id: clinicId,
    patient_phone: patientPhone,
    patient_name: patientName,
    direction,
    message_text: text,
    content: text,
    instance_name: instanceName,
    external_message_id: externalMessageId,
    intent,
    ai_handled: aiHandled,
    handled_by_ai: aiHandled,
    handoff_requested: handoffRequested,
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };

  dbInsert(env.TABLE_WHATSAPP_MESSAGES, payload);
  return { skipped: false };
}