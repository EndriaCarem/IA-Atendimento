/**
 * Automações disparadas por evento (mudança de status de agendamento),
 * chamadas no momento em que o Lovable sincroniza os appointments.
 *
 *  - confirmation: status passou para "confirmed"
 *  - reschedule:   status passou para "cancelled"
 */

import { dbFind } from "../lib/json-db.js";
import { dispatchAutomationMessage } from "./automation-sender.service.js";
import { logger } from "../lib/logger.js";

function getActiveAutomation(clinicId, type) {
  const found = dbFind(
    "automations",
    (a) => a.clinic_id === clinicId && a.type === type && a.enabled
  );
  return found[0] ?? null;
}

/**
 * Compara o status anterior com o novo e dispara a automação correspondente.
 * Chamado pelo sync controller para cada appointment recebido.
 *
 * @param {object} params
 * @param {string} params.clinicId
 * @param {string|null} params.prevStatus - status antes do upsert
 * @param {object} params.apt - registro normalizado (com patient_phone etc.)
 */
export async function handleAppointmentStatusChange({ clinicId, prevStatus, apt }) {
  const newStatus = apt.status;
  if (prevStatus === newStatus) return; // nada mudou

  const context = {
    patient_name: apt.patient_name,
    start_time: apt.start_time,
    doctor: apt.dentist_name,
    procedure: apt.procedure,
  };

  try {
    if (newStatus === "confirmed") {
      const automation = getActiveAutomation(clinicId, "confirmation");
      if (automation) {
        await dispatchAutomationMessage({
          clinicId,
          type: "confirmation",
          dedupeKey: `confirmation:${apt.id}`,
          template: automation.message_template,
          phone: apt.patient_phone,
          context,
        });
      }
    }

    if (newStatus === "cancelled" || newStatus === "canceled") {
      const automation = getActiveAutomation(clinicId, "reschedule");
      if (automation) {
        await dispatchAutomationMessage({
          clinicId,
          type: "reschedule",
          // dedupe por status+id: se cancelar de novo no futuro, permite reenvio
          dedupeKey: `reschedule:${apt.id}:${apt.start_time ?? ""}`,
          template: automation.message_template,
          phone: apt.patient_phone,
          context,
        });
      }
    }
  } catch (err) {
    logger.error(
      { clinicId, aptId: apt.id, err: err.message },
      "[AUTOMATION] Falha no hook de status"
    );
  }
}
