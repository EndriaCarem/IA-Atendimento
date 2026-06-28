/**
 * Envia uma mensagem de automação para um paciente via Evolution,
 * registrando no log para evitar reenvio duplicado.
 */

import { randomUUID } from "crypto";
import { dbFindOne, dbInsert } from "../lib/json-db.js";
import { sendEvolutionTextMessage, sendEvolutionMediaMessage } from "../lib/evolution.js";
import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { findClinicById } from "../repositories/clinic.repository.js";
import { renderAutomationTemplate } from "./automation-template.service.js";
import { logger } from "../lib/logger.js";

/**
 * Verifica se uma automação já foi disparada para uma chave única
 * (ex: lembrete do agendamento X). Evita spam.
 */
export function alreadySent(clinicId, type, dedupeKey) {
  return Boolean(
    dbFindOne(
      "automation_logs",
      (l) => l.clinic_id === clinicId && l.type === type && l.dedupe_key === dedupeKey
    )
  );
}

function logSent({ clinicId, type, dedupeKey, phone, status, error }) {
  dbInsert("automation_logs", {
    id: randomUUID(),
    clinic_id: clinicId,
    type,
    dedupe_key: dedupeKey,
    phone: phone ?? null,
    status,
    error: error ?? null,
    sent_at: new Date().toISOString(),
  });
}

/**
 * Renderiza o template e envia. Marca no log mesmo em caso de erro
 * para não tentar reenviar em loop a cada tick.
 *
 * @returns {Promise<{sent: boolean, skipped?: boolean, reason?: string}>}
 */
export async function dispatchAutomationMessage({
  clinicId,
  type,
  dedupeKey,
  template,
  context, // { patient_name, start_time, doctor, procedure }
  phone,
  mediaUrl, // opcional: imagem anexa (ex: cartão de aniversário). URL ou base64.
}) {
  if (!phone) {
    return { sent: false, skipped: true, reason: "sem telefone" };
  }
  if (dedupeKey && alreadySent(clinicId, type, dedupeKey)) {
    return { sent: false, skipped: true, reason: "já enviado" };
  }

  const mapping = await findInstanceByClinicId(clinicId);
  if (!mapping?.instanceName) {
    return { sent: false, skipped: true, reason: "whatsapp não conectado" };
  }

  const clinic = await findClinicById(clinicId).catch(() => null);
  const text = renderAutomationTemplate(template, {
    ...context,
    clinic_name: clinic?.name ?? context?.clinic_name ?? "",
  });

  if (!text.trim()) {
    return { sent: false, skipped: true, reason: "mensagem vazia" };
  }

  try {
    if (mediaUrl) {
      // Aniversário (ou outra automação com imagem): envia o cartão com legenda.
      await sendEvolutionMediaMessage({
        instanceName: mapping.instanceName,
        number: phone,
        media: mediaUrl,
        caption: text,
      });
    } else {
      await sendEvolutionTextMessage({
        instanceName: mapping.instanceName,
        number: phone,
        text,
      });
    }
    logSent({ clinicId, type, dedupeKey, phone, status: "sent" });
    logger.info({ clinicId, type, phone }, "[AUTOMATION] Mensagem enviada");
    return { sent: true };
  } catch (err) {
    logSent({ clinicId, type, dedupeKey, phone, status: "error", error: err.message });
    logger.error({ clinicId, type, phone, err: err.message }, "[AUTOMATION] Falha ao enviar");
    return { sent: false, reason: err.message };
  }
}
