/**
 * Automações disparadas por evento (mudança de status de agendamento),
 * chamadas no momento em que o Lovable sincroniza os appointments.
 *
 *  - confirmation: status passou para "confirmed"
 *  - reschedule:   status passou para "cancelled"
 */

import { dbFind } from "../lib/json-db.js";
import { dispatchAutomationMessage } from "./automation-sender.service.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Monta "consulta de <procedimento> de <dia-da-semana DD/MM> às <HH:mm>" com o
// fuso da clínica, para a mensagem de cancelamento ser específica.
function buildCancelDetail(apt) {
  const tz = env.DEFAULT_TIMEZONE;
  const proc = apt.procedure ? `consulta de ${apt.procedure}` : "consulta";
  if (!apt.start_time) return proc;
  try {
    const d = new Date(apt.start_time);
    const data = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, weekday: "long", day: "2-digit", month: "2-digit" }).format(d);
    const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
    return `${proc} de ${data} às ${hora}`;
  } catch {
    return proc;
  }
}

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
    // CONFIRMAÇÃO ao aprovar: NÃO disparada aqui. Quem avisa o paciente é a edge
    // function do Lovable (approve-ai-appointment-request), que manda a mensagem
    // com data/hora ("CONFIRMADA para DD/MM HH:mm"). Disparar também aqui gerava
    // mensagem DUPLICADA. Mantido desativado mesmo que o toggle do painel religue
    // a automation 'confirmation' via sync.
    if (newStatus === "confirmed") {
      // intencionalmente sem ação — ver comentário acima.
    }

    // Aviso de cancelamento/reagendamento: SÓ quando a CLÍNICA cancela. Se foi o
    // PRÓPRIO paciente que cancelou pela IA, ele já recebeu "Consulta cancelada
    // com sucesso" na conversa — disparar de novo aqui seria mensagem duplicada.
    const cancelledByPatient = apt.cancelled_by === "patient";
    if ((newStatus === "cancelled" || newStatus === "canceled") && !cancelledByPatient) {
      const automation = getActiveAutomation(clinicId, "reschedule");
      if (automation) {
        // Mensagem montada pelo backend COM os detalhes da consulta (data/hora/
        // procedimento), para o paciente saber exatamente o que foi cancelado.
        // Usa as variáveis renderizadas pelo dispatch — não depende do dono.
        const detalhe = buildCancelDetail(apt);
        const template = detalhe
          ? `Olá {patient_name}! Infelizmente precisamos cancelar sua ${detalhe}. Pedimos desculpas pelo transtorno. 🙏 Se quiser, me diga que te ajudo a reagendar para uma nova data.`
          : automation.message_template;
        await dispatchAutomationMessage({
          clinicId,
          type: "reschedule",
          // dedupe por status+id: se cancelar de novo no futuro, permite reenvio
          dedupeKey: `reschedule:${apt.id}:${apt.start_time ?? ""}`,
          template,
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
