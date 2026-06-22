/**
 * Worker periódico que dispara automações baseadas em tempo:
 *  - appointment_reminder: lembrete 24h antes da consulta
 *  - return: mensagem de retorno X dias após a última consulta
 *
 * As automações disparadas por evento (confirmation, reschedule) ficam
 * em automation-hooks.service.js e são chamadas no momento do sync.
 */

import { dbFind } from "../lib/json-db.js";
import { dispatchAutomationMessage, alreadySent } from "./automation-sender.service.js";
import { runNpsSurveys } from "./nps.service.js";
import { logger } from "../lib/logger.js";

const TICK_MS = 10 * 60 * 1000; // 10 minutos

// Janela de antecedência do lembrete (24h ± 30min de tolerância do tick)
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 35 * 60 * 1000;

// Para "retorno": dispara quando faz N dias desde a última consulta concluída
const RETURN_DEFAULT_DAYS = 180;

function getActiveAutomations(clinicId, type) {
  return dbFind(
    "automations",
    (a) => a.clinic_id === clinicId && a.type === type && a.enabled
  );
}

function listClinicIdsWithAppointments() {
  const all = dbFind("synced_appointments", () => true);
  return [...new Set(all.map((a) => a.clinic_id).filter(Boolean))];
}

function listClinicIdsWithPatients() {
  const all = dbFind("patients", () => true);
  return [...new Set(all.map((p) => p.clinic_id).filter(Boolean))];
}

// ── Lembrete 24h ──────────────────────────────────────────────────────────────

async function runReminders(now) {
  const clinics = listClinicIdsWithAppointments();
  for (const clinicId of clinics) {
    const automations = getActiveAutomations(clinicId, "appointment_reminder");
    if (automations.length === 0) continue;
    const template = automations[0].message_template;

    const appts = dbFind(
      "synced_appointments",
      (a) =>
        a.clinic_id === clinicId &&
        a.patient_phone &&
        a.start_time &&
        ["scheduled", "confirmed"].includes(a.status)
    );

    for (const apt of appts) {
      const start = new Date(apt.start_time).getTime();
      const diff = start - now.getTime();
      // Está dentro da janela de ~24h antes?
      if (Math.abs(diff - REMINDER_LEAD_MS) > REMINDER_WINDOW_MS) continue;

      await dispatchAutomationMessage({
        clinicId,
        type: "appointment_reminder",
        dedupeKey: `reminder:${apt.id}`,
        template,
        phone: apt.patient_phone,
        context: {
          patient_name: apt.patient_name,
          start_time: apt.start_time,
          doctor: apt.dentist_name,
          procedure: apt.procedure,
        },
      });
    }
  }
}

// ── Mensagem de retorno ─────────────────────────────────────────────────────────

async function runReturns(now) {
  const clinics = listClinicIdsWithAppointments();
  for (const clinicId of clinics) {
    const automations = getActiveAutomations(clinicId, "return");
    if (automations.length === 0) continue;
    const automation = automations[0];
    const template = automation.message_template;
    const days = Number(automation.return_after_days) || RETURN_DEFAULT_DAYS;
    const thresholdMs = days * 24 * 60 * 60 * 1000;

    // Pacientes da clínica com última consulta concluída há mais de N dias
    const patients = dbFind(
      "patients",
      (p) => p.clinic_id === clinicId && p.phone && p.last_appointment
    );

    for (const patient of patients) {
      const last = new Date(patient.last_appointment).getTime();
      if (Number.isNaN(last)) continue;
      const elapsed = now.getTime() - last;
      if (elapsed < thresholdMs) continue;

      // Se já tem próxima consulta marcada, não incomoda
      if (patient.next_appointment) {
        const next = new Date(patient.next_appointment).getTime();
        if (!Number.isNaN(next) && next > now.getTime()) continue;
      }

      // Dedupe por mês: não manda retorno mais de 1x por 30 dias ao mesmo paciente
      const monthKey = `return:${patient.id}:${now.getFullYear()}-${now.getMonth()}`;
      if (alreadySent(clinicId, "return", monthKey)) continue;

      await dispatchAutomationMessage({
        clinicId,
        type: "return",
        dedupeKey: monthKey,
        template,
        phone: patient.phone,
        context: {
          patient_name: patient.full_name,
          start_time: null,
          doctor: null,
          procedure: null,
        },
      });
    }
  }
}

// ── Aniversário ───────────────────────────────────────────────────────────────

async function runBirthdays(now) {
  // Só dispara entre 08h e 12h (não manda parabéns de madrugada)
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)
  );
  if (hour < 8 || hour >= 12) return;

  const todayMMDD = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", month: "2-digit", day: "2-digit",
  }).format(now); // "MM-DD"

  const clinics = listClinicIdsWithPatients();
  for (const clinicId of clinics) {
    const automations = getActiveAutomations(clinicId, "birthday");
    if (automations.length === 0) continue;
    const template = automations[0].message_template;
    // Imagem opcional do cartão de aniversário (clínica anexa na config).
    const mediaUrl = automations[0].image_url ?? automations[0].media_url ?? null;

    const patients = dbFind(
      "patients",
      (p) => p.clinic_id === clinicId && p.phone && p.date_of_birth
    );

    for (const patient of patients) {
      // date_of_birth no formato YYYY-MM-DD → compara MM-DD
      const dob = String(patient.date_of_birth).slice(5, 10);
      if (dob !== todayMMDD) continue;

      // 1x por ano
      const yearKey = `birthday:${patient.id}:${now.getFullYear()}`;
      if (alreadySent(clinicId, "birthday", yearKey)) continue;

      await dispatchAutomationMessage({
        clinicId,
        type: "birthday",
        dedupeKey: yearKey,
        template,
        phone: patient.phone,
        mediaUrl,
        context: { patient_name: patient.full_name, start_time: null, doctor: null, procedure: null },
      });
    }
  }
}

// NPS: ver runNpsSurveys em nps.service.js (disparo por questionário + captura
// da nota). O runNps legado (template único) foi removido.

// ── Loop ────────────────────────────────────────────────────────────────────────

async function tick() {
  const now = new Date();
  try {
    await runReminders(now);
    await runReturns(now);
    await runBirthdays(now);
    // NPS agora usa os questionários sincronizados do front (nps_surveys),
    // com captura da nota 0–10 — ver nps.service.js. O runNps legado (template
    // único via "automations") foi substituído por runNpsSurveys.
    await runNpsSurveys(now);
  } catch (err) {
    logger.error({ err: err.message }, "[AUTOMATION] Erro no tick do scheduler");
  }
}

let timer = null;

export function startAutomationScheduler() {
  if (timer) return;
  logger.info({ tickMs: TICK_MS }, "[AUTOMATION] Scheduler iniciado");
  // Primeiro tick após 30s (deixa o servidor estabilizar)
  setTimeout(() => {
    tick();
    timer = setInterval(tick, TICK_MS);
  }, 30 * 1000);
}

export function stopAutomationScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Exporta tick para testes/uso manual
export { tick as runAutomationTick };
