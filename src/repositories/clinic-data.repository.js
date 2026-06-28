/**
 * Repository para dados clínicos — lê e escreve apenas no JSON DB local.
 *
 * Não há acesso direto ao Supabase do Lovable.
 * Lovable empurra os dados via POST /api/sync/* e o backend os armazena aqui.
 *
 * Collections usadas:
 *   clinic_config           — configuração pública da clínica (sync do Lovable)
 *   patients                — pacientes (sync do Lovable)
 *   professional_availability — disponibilidade de profissionais (sync do Lovable)
 *   synced_appointments     — agendamentos existentes (sync do Lovable, usado para cálculo de slots)
 *   appointments            — agendamentos criados pela IA (local)
 */
import { dbFindOne, dbFind, dbUpsert, dbInsert, dbUpdate } from "../lib/json-db.js";
import { normalizePhone } from "../utils/phone.js";
import { env } from "../config/env.js";

// ─────────────────────────────────────────────
// 1. CONFIG PÚBLICA DA CLÍNICA
// ─────────────────────────────────────────────

export function getPublicConfig(clinicId) {
  const config = dbFindOne("clinic_config", (r) => r.clinic_id === clinicId);

  // Médicos: prioriza a collection dedicada (sync/doctors), faz fallback para o que veio no config
  const doctors = dbFind("doctors", (d) => d.clinic_id === clinicId && d.active !== false);
  const doctorsFinal = doctors.length > 0 ? doctors : (config?.doctors ?? []);

  return {
    ...(config ?? {
      clinic_id: clinicId,
      business_hours: null,
      procedures: [],
      insurance_plans: [],
      rooms: [],
      _synced: false,
      _hint: "Sincronize via POST /api/sync/config no painel Lovable",
    }),
    doctors: doctorsFinal,
  };
}

// ─────────────────────────────────────────────
// 2. LOOKUP DE PACIENTE POR TELEFONE
// ─────────────────────────────────────────────

export function lookupPatientByPhone(clinicId, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const patient = dbFindOne(
    "patients",
    (p) =>
      p.clinic_id === clinicId &&
      (normalizePhone(p.phone) === phone || normalizePhone(p.phone_alt) === phone)
  );

  if (!patient) return null;

  return {
    patient_id: patient.id,
    account_id: patient.account_id ?? null,
    full_name: patient.full_name ?? patient.name ?? null,
    phone,
  };
}

// ─────────────────────────────────────────────
// 3. RESUMO DO PACIENTE
// ─────────────────────────────────────────────

export function getPatientSummary(patientId) {
  const patient = dbFindOne("patients", (p) => p.id === patientId);
  if (!patient) return null;

  return {
    anamnese: patient.anamnese ?? null,
    ultima_consulta: patient.last_appointment ?? null,
    proxima_consulta: patient.next_appointment ?? null,
    saldo_pendente: patient.balance ?? 0,
  };
}

// ─────────────────────────────────────────────
// 4. SLOTS LIVRES
// ─────────────────────────────────────────────

// Mapeia índice JS de dia da semana (0=domingo) para a chave usada em business_hours.
const WEEKDAY_KEY_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Quando não há professional_availability cadastrada, deriva a janela de
// atendimento a partir do horário de funcionamento da clínica (business_hours).
// Assim a IA consegue oferecer horários mesmo sem o cadastro detalhado por profissional.
function getClinicTimezone(clinicId) {
  const clinic = dbFindOne("clinics", (c) => c.id === clinicId);
  const config = dbFindOne("clinic_config", (c) => c.clinic_id === clinicId);
  return clinic?.timezone ?? clinic?.time_zone ?? config?.timezone ?? config?.time_zone ?? env.DEFAULT_TIMEZONE;
}

function availabilityFromBusinessHours(clinicId, dayOfWeek) {
  const clinic = dbFindOne("clinics", (c) => c.id === clinicId);
  const config = dbFindOne("clinic_config", (c) => c.clinic_id === clinicId);
  const hours = clinic?.business_hours;
  const businessHours = hours && typeof hours === "object" ? hours : config?.business_hours;
  if (!businessHours || typeof businessHours !== "object") return [];

  const key = WEEKDAY_KEY_BY_INDEX[dayOfWeek];
  const day = businessHours[key];
  if (!day || day.enabled === false || !day.open || !day.close) return [];

  // 00:00 como fechamento é tratado como fim do dia (23:59) para não gerar janela vazia.
  const close = day.close === "00:00" ? "23:59" : day.close;
  if (close <= day.open) return [];

  return [{ professional_id: null, start_time: day.open, end_time: close }];
}

// Converte uma hora LOCAL da clínica numa data para o timestamp UTC (ms).
function localTimeToUtcMs(date, hour, minute, timeZone) {
  // Descobre o offset do fuso para aquela data (cobre eventual horário de verão).
  const probe = new Date(`${date}T12:00:00Z`);
  const localStr = probe.toLocaleString("en-US", { timeZone });
  const offsetMin = (probe.getTime() - new Date(localStr).getTime()) / 60000;
  // Monta o instante: meia-noite UTC da data + hora desejada + offset do fuso.
  const baseUtc = new Date(`${date}T00:00:00Z`).getTime();
  return baseUtc + (hour * 60 + minute + offsetMin) * 60000;
}

export function getFreeSlots(clinicId, date, dentistId, durationMin = 60) {
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  const timeZone = getClinicTimezone(clinicId);

  let availability = dbFind(
    "professional_availability",
    (a) => a.clinic_id === clinicId && a.day_of_week === dayOfWeek
  );

  if (dentistId) availability = availability.filter((a) => a.professional_id === dentistId);

  // Fallback: sem disponibilidade por profissional, usa o expediente da clínica.
  if (!availability.length) {
    availability = availabilityFromBusinessHours(clinicId, dayOfWeek);
  }
  if (!availability.length) return [];

  // Agendamentos existentes naquele dia (sync do Lovable + criados pela IA)
  const startOfDay = `${date}T00:00:00`;
  const endOfDay   = `${date}T23:59:59`;

  const allBooked = [
    ...dbFind("synced_appointments", (a) =>
      a.clinic_id === clinicId &&
      a.start_time >= startOfDay && a.start_time <= endOfDay &&
      !["cancelled", "no_show"].includes(a.status)
    ),
    ...dbFind("appointments", (a) =>
      a.clinic_id === clinicId &&
      a.scheduled_at >= startOfDay && a.scheduled_at <= endOfDay &&
      !["cancelled", "no_show"].includes(a.status)
    ),
  ];

  const durationMs = durationMin * 60 * 1000;
  const slots = [];

  for (const avail of availability) {
    const [sh, sm] = avail.start_time.split(":").map(Number);
    const [eh, em] = avail.end_time.split(":").map(Number);
    const windowStart = localTimeToUtcMs(date, sh, sm, timeZone);
    const windowEnd   = localTimeToUtcMs(date, eh, em, timeZone);

    let cursor = windowStart;

    while (cursor + durationMs <= windowEnd) {
      const slotStart = cursor;
      const slotEnd   = cursor + durationMs;

      const overlaps = allBooked.some((apt) => {
        const profId = apt.dentist_id ?? apt.professional_id ?? null;
        if (dentistId && profId && profId !== dentistId) return false;
        if (avail.professional_id && profId && profId !== avail.professional_id) return false;
        const aStart = new Date(apt.start_time ?? apt.scheduled_at).getTime();
        const aEnd   = apt.end_time ? new Date(apt.end_time).getTime() : aStart + durationMs;
        return slotStart < aEnd && slotEnd > aStart;
      });

      if (!overlaps) {
        slots.push({
          start: new Date(slotStart).toISOString(),
          end:   new Date(slotEnd).toISOString(),
          dentist_id: avail.professional_id,
        });
      }

      cursor += durationMs;
    }
  }

  return slots;
}

// ─────────────────────────────────────────────
// 5. CRIAR AGENDAMENTO (IA → JSON DB)
// ─────────────────────────────────────────────

export function createAppointmentLocal({ clinicId, patientId, dentistId, startTime, endTime, procedureId, notes, source = "ai" }) {
  return dbInsert("appointments", {
    clinic_id: clinicId,
    patient_id: patientId,
    dentist_id: dentistId,
    start_time: startTime,
    end_time: endTime ?? null,
    scheduled_at: startTime,            // compatibilidade com repo legado
    procedure_id: procedureId ?? null,
    notes: notes ?? null,
    status: "scheduled",
    source,
    sync_status: "pending",             // Lovable deve ler e criar no Supabase
  });
}

// ─────────────────────────────────────────────
// 6. ATUALIZAR AGENDAMENTO
// ─────────────────────────────────────────────

export function rescheduleAppointmentLocal({ appointmentId, clinicId, newStartTime, newEndTime, reason }) {
  const record = dbUpdate(
    "appointments",
    (r) => r.id === appointmentId && r.clinic_id === clinicId,
    {
      start_time: newStartTime,
      scheduled_at: newStartTime,
      end_time: newEndTime ?? null,
      status: "rescheduled",
      notes: reason ?? null,
      sync_status: "pending",
    }
  );
  if (!record) {
    // tenta em synced_appointments
    return dbUpdate(
      "synced_appointments",
      (r) => r.id === appointmentId && r.clinic_id === clinicId,
      { start_time: newStartTime, status: "rescheduled", sync_status: "pending" }
    );
  }
  return record;
}

export function cancelAppointmentLocal({ appointmentId, clinicId, reason }) {
  const record = dbUpdate(
    "appointments",
    (r) => r.id === appointmentId && r.clinic_id === clinicId,
    { status: "cancelled", notes: reason ?? null, sync_status: "pending" }
  );
  if (!record) {
    return dbUpdate(
      "synced_appointments",
      (r) => r.id === appointmentId && r.clinic_id === clinicId,
      { status: "cancelled", sync_status: "pending" }
    );
  }
  return record;
}

// ─── Helper ───────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }
