import {
  createAppointment,
  findMostRecentAppointmentByPatient,
  updateAppointmentById
} from "../repositories/appointment.repository.js";
import { createProvisionalPatient } from "../repositories/patient.repository.js";
import { findClinicById } from "../repositories/clinic.repository.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Fuso da clínica para interpretar os horários que a IA gera. Usa o campo da
// clínica se existir; senão cai no DEFAULT_TIMEZONE.
async function resolveClinicTimezone(clinicId) {
  try {
    const clinic = await findClinicById(clinicId);
    return clinic?.timezone || clinic?.time_zone || env.DEFAULT_TIMEZONE;
  } catch {
    return env.DEFAULT_TIMEZONE;
  }
}

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

// Calcula o offset (em minutos) de um timezone IANA numa data específica,
// considerando horário de verão. Ex: America/Manaus → -240 (UTC-4).
function tzOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === "24" ? 0 : parts.hour), Number(parts.minute), Number(parts.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

// Converte o horário da IA para ISO/UTC correto.
// A IA emite um horário "naive" (ex: "2026-06-23T10:00:00") que representa a
// hora LOCAL DA CLÍNICA. Sem fuso, o servidor (UTC) interpretava como UTC e
// perdia o offset (10h Manaus virava 06h). Aqui aplicamos o timezone informado.
function toIsoDate(value, timeZone = null) {
  if (!value || typeof value !== "string") {
    return null;
  }

  // Se já vem com fuso explícito (Z ou ±hh:mm), respeita como está.
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value.trim());
  if (hasTz || !timeZone) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  // Horário "naive" (sem fuso): extrai os componentes e monta como se fosse UTC,
  // depois corrige pelo offset real do timezone da clínica naquela data.
  const m = value.replace(" ", "T").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "0"] = m;
  // Trata os componentes como UTC primeiro (ponto de partida).
  const asIfUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // offset do timezone naquela data (ex: Manaus = -240 min).
  const offsetMin = tzOffsetMinutes(new Date(asIfUtc), timeZone);
  // O horário local da clínica em UTC = asIfUtc - offset.
  return new Date(asIfUtc - offsetMin * 60000).toISOString();
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
      // Normaliza a data de nascimento que a IA extraiu (aceita só YYYY-MM-DD).
      const dob = typeof action.date_of_birth === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(action.date_of_birth.trim())
        ? action.date_of_birth.trim()
        : null;
      effectivePatient = await createProvisionalPatient({
        clinicId,
        phone,
        name: nameFromAction,
        dateOfBirth: dob,
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
  const clinicTz = await resolveClinicTimezone(clinicId);

  if (action.action_type === "create") {
    const scheduledAt = toIsoDate(action.appointment_datetime, clinicTz);

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
    const scheduledAt = toIsoDate(action.appointment_datetime, clinicTz);

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
      notes,
      cancelledBy: "patient", // cancelado pelo paciente via IA (WhatsApp)
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
