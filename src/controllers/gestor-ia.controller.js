import { dbFind, dbFindOne } from "../lib/json-db.js";
import { env } from "../config/env.js";
import { generateGroqJsonResponse } from "../lib/groq.js";
import { generateGeminiJsonResponse } from "../lib/gemini.js";
import { generateOllamaJsonResponse } from "../lib/ollama.js";
import { logger } from "../lib/logger.js";

function buildGestorSystemPrompt(clinicName) {
  const name = clinicName || "Clínica";
  return [
    `Você é a IA Gestor da ${name}, um assistente interno operacional.`,
    "Responda sempre em português do Brasil.",
    "Você tem acesso aos dados operacionais da clínica: agendamentos, pacientes e disponibilidade.",
    "Responda de forma objetiva e direta. Não invente dados que não estejam no contexto.",
    "Não acesse prontuário, diagnóstico, exames ou histórico clínico.",
    "Se não houver dados suficientes para responder, diga claramente.",
    "",
    "Saída obrigatória: retorne somente JSON válido, sem markdown.",
    'Formato: {"reply":"string com a resposta"}'
  ].join("\n");
}

function buildGestorUserPayload({ message, appointments, patients, timezone, nowIso, historyText, extraContext }) {
  const today = new Date(nowIso);
  const todayStr = today.toISOString().slice(0, 10);

  const todayAppointments = appointments.filter((a) => {
    const start = a.start_time ?? a.scheduled_at ?? null;
    return start && start.slice(0, 10) === todayStr;
  });

  const pending = appointments.filter((a) =>
    (a.status === "pending" || a.status === "aguardando")
  );

  const upcoming = appointments
    .filter((a) => {
      const start = a.start_time ?? a.scheduled_at ?? null;
      return start && start > nowIso && a.status !== "cancelled";
    })
    .slice(0, 10);

  return {
    question: message,
    conversation_history: historyText ?? "(sem histórico)",
    extra_context: extraContext ?? {},
    timezone,
    now_iso: nowIso,
    today: todayStr,
    summary: {
      appointments_today: todayAppointments.length,
      appointments_pending: pending.length,
      appointments_upcoming_next10: upcoming.length,
      total_patients: patients.length
    },
    appointments_today: todayAppointments.map((a) => ({
      id: a.id,
      patient_name: a.patient_name ?? null,
      patient_phone: a.patient_phone ?? null,
      start_time: a.start_time ?? a.scheduled_at ?? null,
      end_time: a.end_time ?? null,
      status: a.status ?? null,
      dentist_id: a.dentist_id ?? null,
      notes: a.notes ?? null
    })),
    appointments_pending: pending.map((a) => ({
      id: a.id,
      patient_name: a.patient_name ?? null,
      start_time: a.start_time ?? a.scheduled_at ?? null,
      status: a.status ?? null
    })),
    upcoming_appointments: upcoming.map((a) => ({
      id: a.id,
      patient_name: a.patient_name ?? null,
      start_time: a.start_time ?? a.scheduled_at ?? null,
      status: a.status ?? null
    }))
  };
}

async function callAiProvider({ systemPrompt, userPayload }) {
  if (env.AI_PROVIDER === "ollama") {
    return generateOllamaJsonResponse({ model: env.OLLAMA_MODEL, systemPrompt, userPayload, temperature: 0.3 });
  }
  if (env.AI_PROVIDER === "groq") {
    return generateGroqJsonResponse({ model: env.GROQ_MODEL, systemPrompt, userPayload, temperature: 0.3 });
  }
  return generateGeminiJsonResponse({ model: env.GEMINI_MODEL, systemPrompt, userPayload, temperature: 0.3 });
}

export async function gestorChatController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { message, history = [], context = {} } = req.body ?? {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ ok: false, error: "message é obrigatório" });
    }

    const clinicData = dbFindOne("clinics", (r) => r.id === clinicId);
    const clinicName = clinicData?.name ?? null;

    const allAppointments = [
      ...dbFind("appointments", (a) => a.clinic_id === clinicId),
      ...dbFind("synced_appointments", (a) => a.clinic_id === clinicId)
    ];

    const patients = dbFind("patients", (p) => p.clinic_id === clinicId);

    const systemPrompt = buildGestorSystemPrompt(clinicName);
    const historyText = Array.isArray(history) && history.length > 0
      ? history.slice(-10).map((h) => `${h.role === "user" ? "Usuário" : "IA"}: ${h.content}`).join("\n")
      : null;

    const userPayload = buildGestorUserPayload({
      message: message.trim(),
      appointments: allAppointments,
      patients,
      timezone: env.DEFAULT_TIMEZONE,
      nowIso: new Date().toISOString(),
      historyText,
      extraContext: context
    });

    logger.info({ clinicId, message: message.trim() }, "[GESTOR] Consulta recebida");

    const rawContent = await callAiProvider({ systemPrompt, userPayload });

    let reply = "Não consegui processar sua consulta. Tente novamente.";
    try {
      const parsed = JSON.parse(rawContent);
      if (parsed?.reply && typeof parsed.reply === "string") {
        reply = parsed.reply;
      }
    } catch {
      reply = rawContent?.trim() || reply;
    }

    logger.info({ clinicId, reply }, "[GESTOR] Resposta gerada");

    res.json({ ok: true, reply });
  } catch (err) {
    next(err);
  }
}
