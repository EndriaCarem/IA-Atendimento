import { logger } from "../lib/logger.js";
import { sendEvolutionTextMessage } from "../lib/evolution-api.js";
import { insertWhatsAppMessage } from "../repositories/whatsapp-message.repository.js";
import { normalizePhone } from "../utils/phone.js";
import { runClinicConversation } from "./ai-orchestrator.service.js";
import { applyAppointmentAction } from "./appointment.service.js";
import { captureNpsAnswer } from "./nps.service.js";
import { resolvePatientContext, resolveTenantContext } from "./context-resolver.service.js";
import { broadcastToClinic } from "../lib/sse-hub.js";
import { dbFindOne, dbFind } from "../lib/json-db.js";
import {
  getConversationState,
  setConversationState,
  advanceState,
  buildStateContext,
  CONV_STATES
} from "./conversation-state.service.js";

const activeConversations = new Set();

// Resposta usada quando a IA falha (rate limit, timeout, erro de rede).
// Encaminha para humano em vez de deixar o paciente sem resposta.
const fallbackAIResponse = {
  reply_to_patient:
    "Recebi sua mensagem! Em instantes nossa equipe vai te responder. Obrigado pela paciência.",
  intent: "handoff",
  confidence: 0,
  appointment_action: {
    should_update: false,
    action_type: "none",
    appointment_datetime: null,
    notes: null
  }
};

function makeConversationKey(instanceName, phoneDigits) {
  return `${instanceName}:${phoneDigits}`;
}

function parseHandoffKeywords(rawKeywords) {
  return String(rawKeywords ?? "")
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
}

function shouldForceConfiguredHandoff(tenant, patientMessage) {
  if (!tenant?.handoff?.enabled) {
    return false;
  }

  const keywords = parseHandoffKeywords(tenant.handoff.trigger_keywords);

  if (keywords.length === 0) {
    return false;
  }

  const normalizedMessage = String(patientMessage ?? "").trim().toLowerCase();
  return keywords.some((keyword) => normalizedMessage.includes(keyword));
}

function buildConfiguredHandoffResult(tenant, reason) {
  return {
    reply_to_patient:
      tenant?.handoff?.handoff_message
      || "Vou te transferir para um atendente humano. Aguarde um momento, por favor.",
    intent: "handoff",
    confidence: 1,
    appointment_action: {
      should_update: false,
      action_type: "none",
      appointment_datetime: null,
      notes: null
    },
    handoff_reason: reason
  };
}

function applyConfiguredHandoffReply(tenant, aiResult) {
  if (!tenant?.handoff?.enabled || aiResult?.intent !== "handoff") {
    return aiResult;
  }

  return {
    ...aiResult,
    reply_to_patient: tenant.handoff.handoff_message || aiResult.reply_to_patient
  };
}

export async function processIncomingPatientMessage(incomingMessage) {
  logger.info(
    {
      instanceName: incomingMessage.instanceName,
      remoteJid: incomingMessage.remoteJid,
      text: incomingMessage.text
    },
    "[MSG] Mensagem recebida do Evolution"
  );

  const tenant = await resolveTenantContext(incomingMessage.instanceName);
  const phoneDigits = normalizePhone(incomingMessage.remoteJid);

  if (!phoneDigits) {
    logger.warn({
      instanceName: incomingMessage.instanceName,
      remoteJid: incomingMessage.remoteJid
    }, "[MSG] Número de telefone não reconhecido");
    return {
      skipped: true,
      reason: "PHONE_NOT_FOUND"
    };
  }

  // Proteção contra mensagens represadas: quando a Evolution reconecta após uma
  // queda, ela entrega de uma vez o lote de mensagens antigas que ficaram na fila.
  // Sem este filtro, a IA responderia todas (mesmo as de horas atrás), disparando
  // respostas fora de contexto para pacientes que escreveram muito antes.
  const MAX_MESSAGE_AGE_SECONDS = 120;
  const messageTs = Number(incomingMessage.timestamp);
  if (Number.isFinite(messageTs) && messageTs > 0) {
    const ageSeconds = Date.now() / 1000 - messageTs;
    if (ageSeconds > MAX_MESSAGE_AGE_SECONDS) {
      logger.info(
        {
          instanceName: incomingMessage.instanceName,
          number: phoneDigits,
          ageSeconds: Math.round(ageSeconds),
          messageId: incomingMessage.messageId
        },
        "[MSG] Ignorado: mensagem antiga (represada/reprocessada), nao respondida"
      );
      return {
        skipped: true,
        reason: "MESSAGE_TOO_OLD"
      };
    }
  }

  const conversationKey = makeConversationKey(tenant.instanceName, phoneDigits);

  if (activeConversations.has(conversationKey)) {
    logger.info(
      {
        instanceName: tenant.instanceName,
        number: phoneDigits,
        messageId: incomingMessage.messageId
      },
      "[MSG] Ignorado: conversa em processamento"
    );
    return {
      skipped: true,
      reason: "CONVERSATION_BUSY"
    };
  }

  activeConversations.add(conversationKey);

  try {
    const patient = await resolvePatientContext(tenant.clinicId, phoneDigits);

    const activeTakeover = dbFindOne(
      "conversation_takeovers",
      (t) => t.clinic_id === tenant.clinicId && t.phone === phoneDigits && t.active === true
    );

    if (activeTakeover) {
      // Pausa do estado da conversa durante atendimento humano
      setConversationState(tenant.clinicId, phoneDigits, CONV_STATES.HANDOFF, {});
      await insertWhatsAppMessage({
        clinicId: tenant.clinicId,
        patientPhone: phoneDigits,
        patientName: patient?.name ?? null,
        direction: "inbound",
        text: incomingMessage.text,
        instanceName: tenant.instanceName,
        externalMessageId: incomingMessage.messageId,
        aiHandled: false,
        handoffRequested: true,
        metadata: { skipped_reason: "MANUAL_TAKEOVER" }
      });
      broadcastToClinic(tenant.clinicId, "messages:new", {
        direction: "inbound",
        phone: phoneDigits,
        patient_name: patient?.name ?? null,
        text: incomingMessage.text,
        intent: "handoff",
        at: new Date().toISOString(),
      });
      logger.info({ clinicId: tenant.clinicId, phone: phoneDigits }, "[MSG] Ignorado: conversa sob atendimento humano");
      return { skipped: true, reason: "MANUAL_TAKEOVER" };
    }

    // Resposta de NPS: se há uma pesquisa pendente para este telefone e a
    // mensagem é uma nota 0–10, registra a nota e agradece — sem acionar a IA
    // conversacional (evita a IA "responder" o número como se fosse agendamento).
    const npsResult = captureNpsAnswer({
      clinicId: tenant.clinicId,
      phone: phoneDigits,
      text: incomingMessage.text,
    });
    if (npsResult?.captured) {
      await insertWhatsAppMessage({
        clinicId: tenant.clinicId,
        patientPhone: phoneDigits,
        patientName: patient?.name ?? null,
        direction: "inbound",
        text: incomingMessage.text,
        instanceName: tenant.instanceName,
        externalMessageId: incomingMessage.messageId,
        aiHandled: false,
        handoffRequested: false,
        metadata: { nps_score: npsResult.score },
      });
      await sendEvolutionTextMessage({
        instanceName: tenant.instanceName,
        number: phoneDigits,
        text: npsResult.reply,
      });
      logger.info({ clinicId: tenant.clinicId, phone: phoneDigits, score: npsResult.score }, "[MSG] Resposta de NPS captada");
      return { skipped: false, reason: "NPS_CAPTURED", score: npsResult.score };
    }

    if (tenant.aiEnabled === false) {
      await insertWhatsAppMessage({
        clinicId: tenant.clinicId,
        patientPhone: phoneDigits,
        patientName: patient?.name ?? null,
        direction: "inbound",
        text: incomingMessage.text,
        instanceName: tenant.instanceName,
        externalMessageId: incomingMessage.messageId,
        aiHandled: false,
        handoffRequested: false,
        metadata: {
          skipped_reason: "AI_DISABLED"
        }
      });

      logger.info(
        {
          clinicId: tenant.clinicId,
          instanceName: tenant.instanceName,
          number: phoneDigits
        },
        "[MSG] Ignorado: secretaria IA pausada na configuracao"
      );

      return {
        skipped: true,
        reason: "AI_DISABLED"
      };
    }

    logger.info(
      {
        clinicId: tenant.clinicId,
        patientId: patient?.id ?? null,
        aiEnabled: tenant.aiEnabled,
        hasBusinessHours: Boolean(tenant.businessHours),
        text: incomingMessage.text
      },
      "[MSG] Chamando IA para resposta"
    );

    // Só considera como "conversa em andamento" mensagens das últimas ~3h. Se o
    // paciente sumiu e voltou depois, é uma NOVA conversa: o histórico antigo é
    // descartado (assim a IA volta a usar a saudação configurada e não fica presa
    // num fluxo abandonado). Janela de sessão = 3h.
    const SESSION_WINDOW_MS = 3 * 60 * 60 * 1000;
    const sessionCutoff = Date.now() - SESSION_WINDOW_MS;
    const recentMessages = dbFind(
      "whatsapp_messages",
      (m) => m.clinic_id === tenant.clinicId && m.patient_phone === phoneDigits
    )
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .filter((m) => new Date(m.created_at).getTime() >= sessionCutoff)
      .slice(-8);

    const convState = getConversationState(tenant.clinicId, phoneDigits);
    const stateContext = buildStateContext(convState);

    const forcedHandoff = shouldForceConfiguredHandoff(tenant, incomingMessage.text)
      ? buildConfiguredHandoffResult(tenant, "CONFIGURED_TRIGGER")
      : null;

    let rawAiResult;
    try {
      rawAiResult = forcedHandoff || await runClinicConversation({
        clinicContext: tenant,
        patientContext: patient,
        patientMessage: incomingMessage.text,
        patientPhone: phoneDigits,
        recentMessages,
        stateContext
      });
    } catch (aiError) {
      logger.error(
        { err: aiError, clinicId: tenant.clinicId, provider: process.env.AI_PROVIDER },
        "[MSG] Erro ao chamar IA — usando fallback"
      );
      rawAiResult = fallbackAIResponse;
    }
    const aiResult = applyConfiguredHandoffReply(tenant, rawAiResult);

    // Avança o estado da conversa com base no intent da IA
    const { nextState, context: nextContext } = advanceState(
      convState,
      aiResult.intent,
      aiResult.appointment_action
    );
    setConversationState(tenant.clinicId, phoneDigits, nextState, nextContext);
    logger.info({ clinicId: tenant.clinicId, phone: phoneDigits, prevState: convState?.state ?? null, nextState }, "[STATE] Estado da conversa atualizado");

    const savedInbound = await insertWhatsAppMessage({
      clinicId: tenant.clinicId,
      patientPhone: phoneDigits,
      patientName: patient?.name ?? null,
      direction: "inbound",
      text: incomingMessage.text,
      instanceName: tenant.instanceName,
      externalMessageId: incomingMessage.messageId,
      intent: aiResult.intent,
      aiHandled: true,
      handoffRequested: aiResult.intent === "handoff",
      metadata: {
        source: "evolution_webhook"
      }
    });

    // Broadcast em tempo real para o painel da Secretária IA
    broadcastToClinic(tenant.clinicId, "messages:new", {
      direction: "inbound",
      phone: phoneDigits,
      patient_name: patient?.name ?? null,
      text: incomingMessage.text,
      intent: aiResult.intent,
      at: new Date().toISOString(),
    });

    logger.info(
      {
        aiResult,
        clinicId: tenant.clinicId,
        patientId: patient?.id ?? null
      },
      "[MSG] Resposta da IA gerada"
    );

    const appointmentResult = aiResult.intent === "handoff"
      ? {
          updated: false,
          reason: "HANDOFF_REQUESTED"
        }
      : await applyAppointmentAction({
          clinicId: tenant.clinicId,
          patient,
          phone: phoneDigits,
          aiResult
        });

    if (aiResult.reply_to_patient) {
      try {
        logger.info(
          {
            reply: aiResult.reply_to_patient,
            instanceName: tenant.instanceName,
            number: phoneDigits
          },
          "[MSG] Enviando resposta ao Evolution"
        );
        await sendEvolutionTextMessage({
          instanceName: tenant.instanceName,
          number: phoneDigits,
          text: aiResult.reply_to_patient
        });
        await insertWhatsAppMessage({
          clinicId: tenant.clinicId,
          patientPhone: phoneDigits,
          patientName: patient?.name ?? null,
          direction: "outbound",
          text: aiResult.reply_to_patient,
          instanceName: tenant.instanceName,
          intent: aiResult.intent,
          aiHandled: true,
          handoffRequested: aiResult.intent === "handoff",
          metadata: {
            source: "ai_response",
            delivery_status: "sent"
          }
        });
        broadcastToClinic(tenant.clinicId, "messages:new", {
          direction: "outbound",
          phone: phoneDigits,
          text: aiResult.reply_to_patient,
          intent: aiResult.intent,
          at: new Date().toISOString(),
        });
        logger.info(
          {
            instanceName: tenant.instanceName,
            number: phoneDigits
          },
          "[MSG] Resposta enviada com sucesso ao Evolution"
        );
      } catch (error) {
        logger.error(
          {
            err: error,
            instanceName: tenant.instanceName,
            clinicId: tenant.clinicId
          },
          "[MSG] Falha ao enviar mensagem de resposta ao Evolution"
        );
        await insertWhatsAppMessage({
          clinicId: tenant.clinicId,
          patientPhone: phoneDigits,
          patientName: patient?.name ?? null,
          direction: "outbound",
          text: aiResult.reply_to_patient,
          instanceName: tenant.instanceName,
          intent: aiResult.intent,
          aiHandled: true,
          handoffRequested: aiResult.intent === "handoff",
          metadata: {
            source: "ai_response",
            delivery_status: "failed",
            error_message: error.message
          }
        });
      }
    }

    logger.info(
      {
        clinicId: tenant.clinicId,
        instanceName: tenant.instanceName,
        patientId: patient?.id ?? null,
        intent: aiResult.intent,
        appointmentUpdated: appointmentResult.updated,
        appointmentMode: appointmentResult.mode ?? null
      },
      "[MSG] Mensagem processada"
    );

    return {
      skipped: false,
      tenant,
      patient,
      aiResult,
      appointmentResult
    };
  } finally {
    activeConversations.delete(conversationKey);
  }
}
