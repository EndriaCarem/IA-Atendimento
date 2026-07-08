/**
 * Endpoints de sincronização: Lovable empurra dados clínicos para o backend.
 * Não é necessária nenhuma chave Supabase — Lovable chama estes endpoints via
 * aiBackend.ts (ou via Edge Function) sempre que os dados mudam.
 *
 * POST /api/sync/config              — configuração pública da clínica
 * POST /api/sync/patient             — upsert de 1 paciente
 * POST /api/sync/patients            — upsert em lote
 * POST /api/sync/availability        — disponibilidade de profissionais
 * POST /api/sync/appointments        — agendamentos existentes (para cálculo de slots)
 * GET  /api/clinics/:clinicId/appointments?source=ai&sync_status=pending
 *   (Lovable lê os agendamentos criados pela IA para criar no Supabase)
 * POST /api/clinics/:clinicId/appointments/:id/sync-confirm
 *   (Lovable confirma que criou o agendamento no Supabase; backend marca sync_status=synced)
 */
import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import { dbUpsert, dbInsert, dbFind, dbUpdate, dbFindOne } from "../lib/json-db.js";
import { normalizePhone } from "../utils/phone.js";
import { logger } from "../lib/logger.js";
import { handleAppointmentStatusChange } from "../services/automation-hooks.service.js";

// ─── POST /api/sync/config ────────────────────────────────────────────────────

export function syncConfigController(req, res, next) {
  try {
    const {
      clinic_id,
      name,
      address,
      business_hours,
      timezone,
      time_zone,
      procedures,
      insurance_plans,
      rooms,
      doctors,
      handoff,
    } = req.body ?? {};

    if (!clinic_id) {
      return res.status(400).json({ ok: false, error: "clinic_id é obrigatório" });
    }

    // Sync defensivo: só grava um campo de lista quando ele REALMENTE veio como
    // array no body. Se o Lovable mandar um sync parcial (sem aquele campo),
    // NÃO sobrescrevemos com [] — o dbUpsert faz merge e preserva o valor anterior.
    // (Antes, um sync sem insurance_plans zerava os convênios já cadastrados.)
    const configRecord = {
      clinic_id,
      address:        address ?? null,
      business_hours: business_hours ?? null,
      _synced: true,
      _synced_at: new Date().toISOString(),
    };
    if (timezone || time_zone) configRecord.timezone = timezone ?? time_zone;
    if (Array.isArray(procedures))      configRecord.procedures      = procedures;
    if (Array.isArray(insurance_plans)) configRecord.insurance_plans = insurance_plans;
    if (Array.isArray(rooms))           configRecord.rooms           = rooms;
    if (Array.isArray(doctors))         configRecord.doctors         = doctors;

    const record = dbUpsert("clinic_config", configRecord, "clinic_id");

    // Popula "clinics" para que findClinicById() resolva o tenant no webhook real.
    // name é opcional: se o Lovable não enviar, fica null e a IA usa "Clinica nao identificada."
    const clinicRecord = {
      id:             clinic_id,
      name:           name ?? null,
      address:        address ?? null,
      business_hours: business_hours ?? null,
      _synced_at:     new Date().toISOString(),
    };
    if (timezone || time_zone) clinicRecord.timezone = timezone ?? time_zone;
    dbUpsert("clinics", clinicRecord, "id");

    // Sincroniza config de handoff humano quando o Lovable enviar o campo.
    // Campo opcional — ausência não altera registro existente.
    if (handoff && typeof handoff === "object") {
      dbUpsert(
        "ai_secretary_handoff",
        {
          clinic_id,
          enabled:          handoff.enabled          ?? false,
          trigger_keywords: handoff.trigger_keywords ?? null,
          handoff_message:  handoff.handoff_message  ?? null,
          target_phone:     handoff.target_phone     ?? null,
          _synced_at:       new Date().toISOString(),
        },
        "clinic_id"
      );
    }

    logger.info({ clinic_id, procedures: Array.isArray(record.procedures) ? record.procedures.length : 0 }, "[SYNC] Config sincronizada");
    res.json({ ok: true, success: true, data: record });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sync/patient ───────────────────────────────────────────────────

export function syncPatientController(req, res, next) {
  try {
    const patient = req.body ?? {};
    if (!patient.id || !patient.clinic_id) {
      return res.status(400).json({ ok: false, error: "id e clinic_id são obrigatórios" });
    }

    const normalized = {
      id: patient.id,
      clinic_id: patient.clinic_id,
      account_id: patient.account_id ?? null,
      full_name: patient.full_name ?? patient.name ?? null,
      phone: patient.phone ? normalizePhone(patient.phone) : null,
      phone_alt: patient.phone_alt ?? null,
      date_of_birth: patient.date_of_birth ?? null,
      anamnese: patient.anamnese ?? null,
      last_appointment: patient.last_appointment ?? null,
      next_appointment: patient.next_appointment ?? null,
      balance: patient.balance ?? 0,
      _synced_at: new Date().toISOString(),
    };

    const record = dbUpsert("patients", normalized, "id");
    res.json({ ok: true, success: true, data: record });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sync/patients (lote) ──────────────────────────────────────────

export function syncPatientsController(req, res, next) {
  try {
    const { patients } = req.body ?? {};
    if (!Array.isArray(patients)) {
      return res.status(400).json({ ok: false, error: "patients deve ser um array" });
    }

    const results = [];
    for (const p of patients) {
      if (!p.id || !p.clinic_id) continue;
      const record = dbUpsert("patients", {
        ...p,
        phone: p.phone ? normalizePhone(p.phone) : null,
        _synced_at: new Date().toISOString(),
      }, "id");
      results.push(record.id);
    }

    logger.info({ count: results.length }, "[SYNC] Pacientes sincronizados em lote");
    res.json({ ok: true, success: true, synced: results.length });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sync/availability ─────────────────────────────────────────────
// (separado do config para atualizar só a grade sem re-enviar tudo)

// ─── POST /api/sync/doctor ────────────────────────────────────────────────────

export function syncDoctorController(req, res, next) {
  try {
    const doctor = req.body ?? {};
    if (!doctor.user_id || !doctor.clinic_id) {
      return res.status(400).json({ ok: false, error: "user_id e clinic_id são obrigatórios" });
    }

    // Só grava um campo quando ele REALMENTE veio no payload — sync parcial do
    // Lovable (sem procedures/full_name) NÃO pode zerar o que já estava salvo.
    // O dbUpsert faz merge e preserva os campos ausentes. (bug sync-zera-arrays)
    const doctorRecord = {
      id: `${doctor.clinic_id}:${doctor.user_id}`,
      clinic_id: doctor.clinic_id,
      user_id: doctor.user_id,
      role: doctor.role ?? null,
      active: doctor.active ?? true,
      _synced_at: new Date().toISOString(),
    };
    if (doctor.full_name != null) doctorRecord.full_name = doctor.full_name;
    if (doctor.specialty != null) doctorRecord.specialty = doctor.specialty;
    // Procedimentos que ESTE médico atende (aceita variações de nome do Lovable).
    const procs = Array.isArray(doctor.procedures) ? doctor.procedures
      : Array.isArray(doctor.procedure_names) ? doctor.procedure_names : null;
    if (procs != null) doctorRecord.procedures = procs;

    const record = dbUpsert("doctors", doctorRecord, "id");

    res.json({ ok: true, success: true, data: record });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sync/doctors (lote) ───────────────────────────────────────────

export function syncDoctorsController(req, res, next) {
  try {
    const { clinic_id, doctors } = req.body ?? {};
    if (!clinic_id || !Array.isArray(doctors)) {
      return res.status(400).json({ ok: false, error: "clinic_id e doctors[] são obrigatórios" });
    }

    let saved = 0;
    for (const d of doctors) {
      if (!d.user_id) continue;
      // Sync parcial não pode zerar full_name/specialty/procedures já salvos.
      const rec = {
        id: `${clinic_id}:${d.user_id}`,
        clinic_id,
        user_id: d.user_id,
        role: d.role ?? null,
        active: d.active ?? true,
        _synced_at: new Date().toISOString(),
      };
      if (d.full_name != null) rec.full_name = d.full_name;
      if (d.specialty != null) rec.specialty = d.specialty;
      const procs = Array.isArray(d.procedures) ? d.procedures
        : Array.isArray(d.procedure_names) ? d.procedure_names : null;
      if (procs != null) rec.procedures = procs;
      dbUpsert("doctors", rec, "id");
      saved++;
    }

    logger.info({ clinic_id, saved }, "[SYNC] Médicos sincronizados");
    res.json({ ok: true, success: true, synced: saved });
  } catch (err) {
    next(err);
  }
}

export function syncAvailabilityController(req, res, next) {
  try {
    const { clinic_id, availability } = req.body ?? {};
    if (!clinic_id || !Array.isArray(availability)) {
      return res.status(400).json({ ok: false, error: "clinic_id e availability[] são obrigatórios" });
    }

    let saved = 0;
    for (const slot of availability) {
      if (!slot.professional_id || slot.day_of_week == null) continue;
      // chave composta: clinic_id + professional_id + day_of_week
      const compositeId = `${clinic_id}:${slot.professional_id}:${slot.day_of_week}`;
      dbUpsert(
        "professional_availability",
        {
          id: compositeId,
          clinic_id,
          professional_id: slot.professional_id,
          day_of_week: slot.day_of_week,
          start_time: slot.start_time ?? "08:00",
          end_time:   slot.end_time   ?? "18:00",
          _synced_at: new Date().toISOString(),
        },
        "id"
      );
      saved++;
    }
    logger.info({ clinic_id, saved }, "[SYNC] Disponibilidade sincronizada");
    res.json({ ok: true, success: true, synced: saved });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sync/appointments ─────────────────────────────────────────────
// Lovable empurra agendamentos existentes para que a IA calcule slots livres

export async function syncAppointmentsController(req, res, next) {
  try {
    const { clinic_id } = req.body ?? {};
    const appointments = Array.isArray(req.body?.appointments)
      ? req.body.appointments
      : (req.body?.patient_name || req.body?.phone || req.body?.patient_phone || req.body?.start_time
        ? [req.body]
        : null);
    if (!clinic_id || !Array.isArray(appointments)) {
      return res.status(400).json({ ok: false, error: "clinic_id e appointments[] são obrigatórios" });
    }

    let saved = 0;
    const statusChanges = [];
    for (const apt of appointments) {
      const appointmentId = apt.id ?? randomUUID();

      // Captura status anterior para disparar hooks de automação (confirmação/reagendamento)
      const previous = dbFindOne("synced_appointments", (a) => a.id === appointmentId);
      const prevStatus = previous?.status ?? null;

      const record = {
        id: appointmentId,
        clinic_id,
        dentist_id:    apt.dentist_id    ?? null,
        dentist_name:  apt.dentist_name  ?? null,
        patient_id:    apt.patient_id    ?? null,
        patient_name:  apt.patient_name  ?? null,
        patient_phone: apt.patient_phone || apt.phone ? normalizePhone(apt.patient_phone ?? apt.phone) : null,
        procedure:     apt.procedure     ?? apt.service ?? null,
        start_time:    apt.start_time    ?? null,
        end_time:      apt.end_time      ?? null,
        status:        apt.status        ?? "scheduled",
        sync_status:   "synced",
        _synced_at: new Date().toISOString(),
      };
      dbUpsert("synced_appointments", record, "id");
      statusChanges.push({ prevStatus, prevStartTime: previous?.start_time ?? null, apt: record });
      saved++;
    }

    logger.info({ clinic_id, saved }, "[SYNC] Agendamentos sincronizados");
    // Responde já; dispara hooks em background (não bloqueia o sync)
    res.json({ ok: true, success: true, synced: saved });

    for (const change of statusChanges) {
      handleAppointmentStatusChange({
        clinicId: clinic_id,
        prevStatus: change.prevStatus,
        prevStartTime: change.prevStartTime,
        apt: change.apt,
      }).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/clinics/:clinicId/appointments?source=ai&sync_status=pending ────
// Lovable lê os agendamentos criados pela IA para criar no Supabase

export function listAiAppointmentsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { source, sync_status } = req.query;

    const records = dbFind("appointments", (a) => {
      if (a.clinic_id !== clinicId) return false;
      if (source && a.source !== source) return false;
      if (sync_status && a.sync_status !== sync_status) return false;
      return true;
    });

    // Enriquece com nome/telefone do paciente (provisório ou real) para que
    // o consumidor (edge function do Lovable) crie o pedido sem outra chamada.
    const enriched = records.map((a) => {
      const pat = a.patient_id
        ? dbFindOne("patients", (p) => p.id === a.patient_id)
        : null;
      return {
        ...a,
        patient_name: pat?.full_name ?? pat?.name ?? null,
        patient_phone: pat?.[env.COL_PATIENT_PHONE] ?? pat?.phone ?? null,
        patient_provisional: Boolean(pat?.provisional),
      };
    });

    res.json({ ok: true, success: true, data: enriched });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/clinics/:clinicId/appointments/:appointmentId/sync-confirm ─────
// Lovable confirma que criou o agendamento no Supabase

export function syncConfirmAppointmentController(req, res, next) {
  try {
    const { clinicId, appointmentId } = req.params;
    const { supabase_id } = req.body ?? {};

    const record = dbUpdate(
      "appointments",
      (a) => a.id === appointmentId && a.clinic_id === clinicId,
      {
        sync_status: "synced",
        supabase_id: supabase_id ?? null,
        synced_at: new Date().toISOString(),
      }
    );

    if (!record) {
      return res.status(404).json({ ok: false, error: "Agendamento não encontrado" });
    }

    res.json({ ok: true, success: true, data: record });
  } catch (err) {
    next(err);
  }
}
