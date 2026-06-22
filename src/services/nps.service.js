/**
 * NPS — pesquisas de satisfação enviadas pela IA.
 *
 * Fluxo ponta a ponta:
 *  1. O front (Lovable) sincroniza os questionários (nps_surveys) via
 *     POST /api/sync/nps-surveys → guardados na coleção local "nps_surveys".
 *  2. runNps (scheduler) dispara a pergunta X horas após a consulta concluída,
 *     escolhendo o survey (default da clínica) e gravando um registro local
 *     "nps_responses" com status "sent".
 *  3. Quando o paciente responde um número (0–10), captureNpsAnswer registra a
 *     nota no registro pendente e marca status "answered" (a IA não conversa).
 *  4. O front faz polling em GET /nps/pending-results, grava no Supabase e
 *     confirma via .../sync-confirm (status "synced") — igual ao fluxo de
 *     agendamentos da IA.
 */

import { dbFind, dbFindOne, dbInsert, dbUpdate, dbDeleteWhere } from "../lib/json-db.js";
import { dispatchAutomationMessage } from "./automation-sender.service.js";
import { logger } from "../lib/logger.js";

// Janela de captura: só associamos uma resposta numérica a um NPS enviado nas
// últimas 48h. Depois disso, um número solto do paciente não vira nota.
const CAPTURE_WINDOW_MS = 48 * 60 * 60 * 1000;

function categoryOf(score) {
  if (score === null || score === undefined) return null;
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

// ── Sync dos questionários vindos do front ───────────────────────────────────

export function replaceNpsSurveys(clinicId, surveys) {
  // Substitui o conjunto da clínica (snapshot). Mantém simples: apaga e regrava.
  dbDeleteWhere("nps_surveys", (s) => s.clinic_id === clinicId);
  const list = Array.isArray(surveys) ? surveys : [];
  for (const s of list) {
    if (!s?.id) continue;
    dbInsert("nps_surveys", {
      id: s.id,
      clinic_id: clinicId,
      name: s.name ?? null,
      question: s.question ?? "",
      scale_min: Number.isFinite(s.scale_min) ? s.scale_min : 0,
      scale_max: Number.isFinite(s.scale_max) ? s.scale_max : 10,
      send_after_hours: Number.isFinite(s.send_after_hours) ? s.send_after_hours : 3,
      is_active: s.is_active !== false,
      is_default: s.is_default === true,
    });
  }
  return list.length;
}

function pickSurveyForClinic(clinicId) {
  const active = dbFind("nps_surveys", (s) => s.clinic_id === clinicId && s.is_active);
  if (active.length === 0) return null;
  return active.find((s) => s.is_default) ?? active[0];
}

// ── Disparo (chamado pelo scheduler) ─────────────────────────────────────────

function listClinicIdsWithSurveys() {
  const all = dbFind("nps_surveys", (s) => s.is_active);
  return [...new Set(all.map((s) => s.clinic_id).filter(Boolean))];
}

export async function runNpsSurveys(now) {
  const MAX_MS = 27 * 60 * 60 * 1000; // não envia se já passou muito tempo
  const clinics = listClinicIdsWithSurveys();

  for (const clinicId of clinics) {
    const survey = pickSurveyForClinic(clinicId);
    if (!survey) continue;

    const minMs = Math.max(0, (survey.send_after_hours ?? 3) * 60 * 60 * 1000);

    const appts = dbFind(
      "synced_appointments",
      (a) =>
        a.clinic_id === clinicId &&
        a.patient_phone &&
        a.start_time &&
        ["completed", "realizada", "concluida"].includes(a.status)
    );

    for (const apt of appts) {
      const start = new Date(apt.start_time).getTime();
      if (Number.isNaN(start)) continue;
      const elapsed = now.getTime() - start;
      if (elapsed < minMs || elapsed > MAX_MS) continue;

      // Dedupe: 1 NPS por consulta (appointment_id é único no Supabase também).
      const already = dbFindOne(
        "nps_responses",
        (r) => r.clinic_id === clinicId && r.appointment_id === apt.id
      );
      if (already) continue;

      const sent = await dispatchAutomationMessage({
        clinicId,
        type: "nps",
        dedupeKey: `nps:${apt.id}`,
        template: survey.question,
        phone: apt.patient_phone,
        context: {
          patient_name: apt.patient_name,
          start_time: apt.start_time,
          doctor: apt.dentist_name,
          procedure: apt.procedure,
        },
      });

      // Só registra o pendente se a mensagem foi de fato enviada.
      if (sent?.sent === true) {
        dbInsert("nps_responses", {
          clinic_id: clinicId,
          survey_id: survey.id,
          appointment_id: apt.id,
          patient_id: apt.patient_id ?? null,
          patient_phone: apt.patient_phone,
          score: null,
          comment: null,
          category: null,
          status: "sent",
          sent_at: new Date().toISOString(),
          answered_at: null,
          sync_status: "pending",
        });
        logger.info({ clinicId, appointmentId: apt.id }, "[NPS] Pesquisa enviada");
      }
    }
  }
}

// ── Captura da resposta do paciente ──────────────────────────────────────────

// Extrai uma nota 0–10 de um texto curto. Aceita "8", "nota 9", "dou 10".
// Retorna null se a mensagem não parece ser uma nota (deixa a IA responder).
export function extractScore(text) {
  if (!text) return null;
  const cleaned = String(text).trim();
  // Mensagem deve ser curta para evitar capturar números de frases longas.
  if (cleaned.length > 20) return null;
  const m = cleaned.match(/\b(10|[0-9])\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 10 ? n : null;
}

/**
 * Se houver um NPS pendente (status "sent") para este telefone dentro da janela
 * e a mensagem for uma nota 0–10, registra a nota e devolve o texto de
 * agradecimento. Caso contrário, retorna null (a conversa segue para a IA).
 */
export function captureNpsAnswer({ clinicId, phone, text }) {
  const pending = dbFind(
    "nps_responses",
    (r) =>
      r.clinic_id === clinicId &&
      r.patient_phone === phone &&
      r.status === "sent"
  );
  if (pending.length === 0) return null;

  // Pega o mais recente dentro da janela de captura.
  pending.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  const target = pending[0];
  const age = Date.now() - new Date(target.sent_at).getTime();
  if (age > CAPTURE_WINDOW_MS) return null;

  const score = extractScore(text);
  if (score === null) return null;

  dbUpdate(
    "nps_responses",
    (r) => r.id === target.id,
    {
      score,
      category: categoryOf(score),
      status: "answered",
      answered_at: new Date().toISOString(),
      sync_status: "pending",
    }
  );
  logger.info({ clinicId, phone, score }, "[NPS] Resposta captada");

  const thanks =
    score >= 9
      ? "Que ótimo! Muito obrigado pela sua avaliação. 💙"
      : score >= 7
      ? "Obrigado pela sua avaliação! Vamos seguir melhorando. 🙏"
      : "Obrigado pelo retorno. Vamos trabalhar para melhorar sua experiência. 🙏";

  return { captured: true, score, reply: thanks };
}

// ── Polling do front (resultados pendentes de gravar no Supabase) ────────────

export function listNpsPendingResults(clinicId) {
  return dbFind(
    "nps_responses",
    (r) =>
      r.clinic_id === clinicId &&
      r.status === "answered" &&
      r.sync_status === "pending"
  );
}

export function markNpsResultSynced(clinicId, pendingId, supabaseId) {
  const record = dbUpdate(
    "nps_responses",
    (r) => r.id === pendingId && r.clinic_id === clinicId,
    { sync_status: "synced", supabase_id: supabaseId ?? null }
  );
  return record;
}
