import {
  createAppointment,
  findMostRecentAppointmentByPatient,
  updateAppointmentById
} from "../repositories/appointment.repository.js";
import { createProvisionalPatient } from "../repositories/patient.repository.js";
import { findClinicById } from "../repositories/clinic.repository.js";
import { logger } from "../lib/logger.js";

// Normaliza nome de procedimento para comparar (sem acento, minúsculo).
function norm(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Resolve, de forma determinística, o médico que atende o procedimento pedido.
// Retorna o user_id do 1º médico ativo cujos procedimentos incluam o pedido.
// Se nenhum atender (ou clínica não configurou), retorna null → cai pra modo clínica.
async function resolveDentistForProcedure(clinicId, procedure) {
  if (!procedure) return null;
  try {
    const clinic = await findClinicById(clinicId);
    const doctors = Array.isArray(clinic?.doctors) ? clinic.doctors : [];
    const alvo = norm(procedure);
    const match = doctors.find((d) => {
      if (d.active === false) return false;
      const procs = Array.isArray(d.procedures) ? d.procedures : [];
      return procs.some((p) => {
        const nome = typeof p === "string" ? p : p?.name;
        return nome && (norm(nome) === alvo || norm(nome).includes(alvo) || alvo.includes(norm(nome)));
      });
    });
    return match?.user_id ?? null;
  } catch {
    return null;
  }
}

function toIsoDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function applyAppointmentAction({ clinicId, patient, phone, aiResult }) {
  const action = aiResult?.appointment_action;

  if (!action?.should_update || action.action_type === "none") {
    return {
      updated: false,
      reason: "NO_ACTION"
    };
  }

  let effectivePatient = patient;

  // Paciente novo (não cadastrado): para AGENDAR, cria um paciente provisório
  // com o telefone da conversa. O Lovable depois cria o paciente real no Supabase
  // (sync_status=pending). Para update/cancel sem paciente, não há o que fazer.
  if (!effectivePatient?.id) {
    if (action.action_type === "create" && phone) {
      // Prefere o campo patient_name (a IA agora preenche explicitamente).
      // Fallback: tenta o notes, se for curto o suficiente para ser um nome.
      const nameFromAction = typeof action.patient_name === "string" && action.patient_name.trim()
        ? action.patient_name.trim()
        : (typeof action.notes === "string" && action.notes.length < 60 ? action.notes : null);
      effectivePatient = await createProvisionalPatient({
        clinicId,
        phone,
        name: nameFromAction,
      });
      logger.info({ clinicId, phone, patientId: effectivePatient?.id }, "[APPOINTMENT] Paciente provisório criado pela IA");
    }
    if (!effectivePatient?.id) {
      return {
        updated: false,
        reason: "PATIENT_NOT_FOUND"
      };
    }
  }
  patient = effectivePatient;

  const notes = action.notes ?? null;

  if (action.action_type === "create") {
    const scheduledAt = toIsoDate(action.appointment_datetime);

    if (!scheduledAt) {
      return {
        updated: false,
        reason: "INVALID_DATETIME"
      };
    }

    // Resolve o médico que atende o procedimento (determinístico). Se nenhum
    // atender, fica nulo e o pedido cai pro modo clínica na aprovação.
    const suggestedDentistId = await resolveDentistForProcedure(clinicId, action.procedure);

    const appointment = await createAppointment({
      clinicId,
      patientId: patient.id,
      scheduledAt,
      // Agendamento criado pela IA fica AGUARDANDO APROVAÇÃO da clínica.
      status: "pending_approval",
      notes,
      procedure: action.procedure ?? null,
      suggestedDentistId,
    });

    return {
      updated: true,
      mode: "created",
      appointment
    };
  }

  if (action.action_type === "update") {
    const scheduledAt = toIsoDate(action.appointment_datetime);

    if (!scheduledAt) {
      return {
        updated: false,
        reason: "INVALID_DATETIME"
      };
    }

    const current = await findMostRecentAppointmentByPatient(clinicId, patient.id);

    if (!current) {
      const appointment = await createAppointment({
        clinicId,
        patientId: patient.id,
        scheduledAt,
        status: "rescheduled",
        notes
      });

      return {
        updated: true,
        mode: "created_when_missing",
        appointment
      };
    }

    const appointment = await updateAppointmentById({
      appointmentId: current.id,
      clinicId,
      scheduledAt,
      status: "rescheduled",
      notes
    });

    return {
      updated: true,
      mode: "updated",
      appointment
    };
  }

  if (action.action_type === "cancel") {
    const current = await findMostRecentAppointmentByPatient(clinicId, patient.id);

    if (!current) {
      return {
        updated: false,
        reason: "APPOINTMENT_NOT_FOUND"
      };
    }

    const appointment = await updateAppointmentById({
      appointmentId: current.id,
      clinicId,
      status: "cancelled",
      notes
    });

    return {
      updated: true,
      mode: "cancelled",
      appointment
    };
  }

  return {
    updated: false,
    reason: "UNSUPPORTED_ACTION"
  };
}
