/**
 * Conversas e painel ao vivo da Secretária IA.
 *
 * GET  /api/clinics/:clinicId/conversations
 *   Lista threads agrupadas por número de telefone do paciente.
 *
 * GET  /api/conversations/:convId/messages
 *   Mensagens de uma thread (convId = base64url de "clinicId:phone").
 *
 * GET  /api/clinics/:clinicId/conversations/stream
 *   SSE — emite evento "messages:new" quando chega nova mensagem.
 *
 * POST /api/conversations/:convId/handoff
 *   Body: { agent_id? }
 *   Ativa handoff humano para a conversa.
 *
 * POST /api/conversations/:convId/send
 *   Body: { text }
 *   Envia mensagem manual pelo painel (sem IA).
 */
import { env } from "../config/env.js";
import { dbFind, dbUpsert, dbDeleteWhere } from "../lib/json-db.js";
import { addSseClient, removeSseClient } from "../lib/sse-hub.js";
import { sendEvolutionTextMessage } from "../lib/evolution-api.js";
import { logAiAction } from "../lib/action-log.js";
import { logger } from "../lib/logger.js";

// ─── Helpers de conversationId ────────────────

function makeConvId(clinicId, phone) {
  return Buffer.from(`${clinicId}:${phone}`).toString("base64url");
}

function parseConvId(convId) {
  try {
    const decoded = Buffer.from(convId, "base64url").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 10) return null; // UUID tem no mínimo 36 chars
    return { clinicId: decoded.slice(0, sep), phone: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

// ─── GET /api/clinics/:clinicId/conversations ─

export function listConversationsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const messages = dbFind("whatsapp_messages", (m) => m.clinic_id === clinicId);

    // Takeovers ativos = conversas que um humano assumiu (fonte da verdade).
    const activeTakeovers = new Set(
      dbFind("conversation_takeovers", (t) => t.clinic_id === clinicId && t.active === true)
        .map((t) => t.phone)
    );

    // Agrupa por telefone
    const byPhone = new Map();
    for (const m of messages) {
      const phone = m.patient_phone;
      if (!phone) continue;

      if (!byPhone.has(phone)) {
        byPhone.set(phone, {
          id: makeConvId(clinicId, phone),
          clinic_id: clinicId,
          patient_phone: phone,
          patient_name: m.patient_name ?? null,
          status: "open",
          message_count: 0,
          last_message: null,
          last_message_at: null,
        });
      }

      const conv = byPhone.get(phone);
      conv.message_count += 1;

      if (!conv.last_message_at || m.created_at > conv.last_message_at) {
        conv.last_message_at = m.created_at;
        conv.last_message = {
          direction: m.direction,
          text: (m.message_text ?? m.content ?? "").slice(0, 120),
          at: m.created_at,
        };
        // Guarda se a ÚLTIMA mensagem pediu handoff automático (palavra-chave/IA)
        conv._lastHandoffRequested = Boolean(m.handoff_requested);
      }
    }

    // Status final: takeover humano ativo tem prioridade; senão, handoff
    // automático se a última mensagem solicitou; caso contrário, open (IA).
    for (const [phone, conv] of byPhone) {
      if (activeTakeovers.has(phone)) {
        conv.status = "human";
      } else if (conv._lastHandoffRequested) {
        conv.status = "handoff";
      }
      delete conv._lastHandoffRequested;
    }

    const conversations = [...byPhone.values()].sort(
      (a, b) => new Date(b.last_message_at ?? 0) - new Date(a.last_message_at ?? 0)
    );

    res.json({ ok: true, data: conversations });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/conversations/:convId/messages ──

export function getConversationMessagesController(req, res, next) {
  try {
    const { convId } = req.params;
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }

    const { clinicId, phone } = parsed;

    const messages = dbFind(
      "whatsapp_messages",
      (m) => m.clinic_id === clinicId && m.patient_phone === phone
    ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    res.json({ ok: true, data: { conv_id: convId, clinic_id: clinicId, phone, messages } });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/clinics/:clinicId/conversations/stream (SSE) ─

export function conversationStreamController(req, res) {
  const { clinicId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // desabilita buffer no nginx
  res.flushHeaders();

  // Mensagem de boas-vindas
  res.write(`: connected to clinic ${clinicId}\n\n`);

  addSseClient(clinicId, res);

  // Heartbeat a cada 20s para evitar timeout de proxies
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeSseClient(clinicId, res);
  });
}

// ─── POST /api/conversations/:convId/handoff ──

export function handoffController(req, res, next) {
  try {
    const { convId } = req.params;
    const { agent_id } = req.body ?? {};
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }

    const { clinicId, phone } = parsed;

    dbUpsert(
      "ai_secretary_handoff",
      {
        clinic_id: clinicId,
        patient_phone: phone,
        conv_id: convId,
        agent_id: agent_id ?? null,
        status: "active",
        activated_at: new Date().toISOString(),
      },
      "conv_id"
    );

    logAiAction({
      clinicId,
      conversationId: convId,
      patientPhone: phone,
      action: "handoff_activate",
      payload: { agent_id },
      result: { ok: true },
    });

    logger.info({ clinicId, phone, agent_id }, "[HANDOFF] Conversa transferida para humano");

    res.json({ ok: true, message: "Handoff ativado", conv_id: convId });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/conversations/:convId/send ─────

export async function sendMessageController(req, res, next) {
  try {
    const { convId } = req.params;
    const { text } = req.body ?? {};
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }
    if (!text?.trim()) {
      return res.status(400).json({ ok: false, error: "text é obrigatório" });
    }

    const { clinicId, phone } = parsed;

    // Busca o instance_name da clínica no JSON DB
    const instances = dbFind(env.TABLE_WHATSAPP_INSTANCES, (i) => i.clinic_id === clinicId);
    const instance = instances[0];

    if (!instance?.instance_name) {
      return res.status(404).json({ ok: false, error: "WhatsApp não configurado para esta clínica" });
    }

    await sendEvolutionTextMessage({
      instanceName: instance.instance_name,
      number: phone,
      text: text.trim(),
    });

    logAiAction({
      clinicId,
      conversationId: convId,
      patientPhone: phone,
      action: "manual_message_sent",
      payload: { text: text.slice(0, 100) },
      result: { ok: true },
    });

    res.json({ ok: true, message: "Mensagem enviada" });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/clinics/:clinicId/conversations ──────────────────
// Limpa todo o histórico de conversas da clínica

export function clearConversationsController(req, res, next) {
  try {
    const { clinicId } = req.params;

    // Telefones que estão sob atendimento humano (takeover ativo) NÃO são limpos —
    // preservamos a conversa de quem o gestor assumiu/pausou, mesmo numa limpeza geral.
    const protectedPhones = new Set(
      dbFind("conversation_takeovers", (t) => t.clinic_id === clinicId && t.active === true)
        .map((t) => t.phone)
    );

    const removed = dbDeleteWhere(
      "whatsapp_messages",
      (m) => m.clinic_id === clinicId && !protectedPhones.has(m.patient_phone)
    );
    // Remove só os takeovers inativos (mantém os ativos)
    dbDeleteWhere(
      "conversation_takeovers",
      (t) => t.clinic_id === clinicId && t.active !== true
    );

    logger.info({ clinicId, removed, protected: protectedPhones.size }, "[CONV] Histórico limpo (takeovers ativos preservados)");
    res.json({ ok: true, removed, protected_conversations: protectedPhones.size });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/clinics/:clinicId/conversations/:convId/takeover ─
// Humano assume a conversa — IA para de responder para esse número

export function takeoverController(req, res, next) {
  try {
    const { clinicId, convId } = req.params;
    const { agent_name } = req.body ?? {};
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }

    const { phone } = parsed;

    dbUpsert(
      "conversation_takeovers",
      {
        id: `${clinicId}:${phone}`,
        clinic_id: clinicId,
        phone,
        conv_id: convId,
        agent_name: agent_name ?? null,
        active: true,
        taken_over_at: new Date().toISOString(),
      },
      "id"
    );

    logger.info({ clinicId, phone, agent_name }, "[TAKEOVER] Humano assumiu conversa");

    res.json({ ok: true, conv_id: convId, phone });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/clinics/:clinicId/conversations/:convId/takeover ─
// Devolve conversa para a IA

export function releaseTakeoverController(req, res, next) {
  try {
    const { clinicId, convId } = req.params;
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }

    const { phone } = parsed;

    dbUpsert(
      "conversation_takeovers",
      {
        id: `${clinicId}:${phone}`,
        clinic_id: clinicId,
        phone,
        conv_id: convId,
        active: false,
        released_at: new Date().toISOString(),
      },
      "id"
    );

    logger.info({ clinicId, phone }, "[TAKEOVER] IA retomou conversa");

    res.json({ ok: true, conv_id: convId, phone });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/clinics/:clinicId/conversations/:convId ─
// Exclui UMA conversa (todas as mensagens daquele telefone) + estado + takeover.

export function deleteConversationController(req, res, next) {
  try {
    const { clinicId, convId } = req.params;
    const parsed = parseConvId(convId);

    if (!parsed) {
      return res.status(400).json({ ok: false, error: "convId inválido" });
    }

    const { phone } = parsed;

    const removedMsgs = dbDeleteWhere(
      "whatsapp_messages",
      (m) => m.clinic_id === clinicId && m.patient_phone === phone
    );
    dbDeleteWhere(
      "conversation_states",
      (s) => s.clinic_id === clinicId && s.phone === phone
    );
    dbDeleteWhere(
      "conversation_takeovers",
      (t) => t.clinic_id === clinicId && t.phone === phone
    );

    logger.info({ clinicId, phone, removedMsgs }, "[CONVERSA] Conversa excluída");
    res.json({ ok: true, phone, removed_messages: removedMsgs });
  } catch (err) {
    next(err);
  }
}
