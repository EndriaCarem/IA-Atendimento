import { dbUpsert, dbFindOne } from "../lib/json-db.js";

// Estados possíveis da conversa
export const CONV_STATES = {
  WELCOME:          "welcome",
  IDENTIFY:         "identify_user",
  CHOOSE_SPECIALTY: "choose_specialty",
  CHOOSE_LOCATION:  "choose_location",
  CHOOSE_INSURANCE: "choose_insurance",
  CHOOSE_DOCTOR:    "choose_doctor",
  CHOOSE_TIME:      "choose_time",
  CONFIRM:          "confirm_schedule",
  SCHEDULED:        "scheduled",
  RESCHEDULE:       "reschedule",
  CANCEL:           "cancel",
  HANDOFF:          "human_handoff",
  FAQ:              "faq",
  IDLE:             "idle",
};

// Quanto tempo sem mensagem para resetar o estado. Alinhado com a janela de
// sessão do histórico (message-processor): 3h. Após isso, conversa nova → estado
// reseta e a IA volta a usar a saudação configurada.
const STATE_TTL_MS = 3 * 60 * 60 * 1000;

export function getConversationState(clinicId, phone) {
  const record = dbFindOne(
    "conversation_states",
    (r) => r.clinic_id === clinicId && r.phone === phone
  );

  if (!record) return null;

  // Expirou por inatividade — trata como nova conversa
  const lastActivity = new Date(record.updated_at ?? record.created_at).getTime();
  if (Date.now() - lastActivity > STATE_TTL_MS) {
    return null;
  }

  return record;
}

export function setConversationState(clinicId, phone, state, context = {}) {
  return dbUpsert(
    "conversation_states",
    {
      clinic_id:   clinicId,
      phone,
      state,
      context,    // dados coletados até agora (specialty, doctor_id, etc.)
      _key:        `${clinicId}:${phone}`,
    },
    "_key"
  );
}

export function clearConversationState(clinicId, phone) {
  return setConversationState(clinicId, phone, CONV_STATES.IDLE, {});
}

// Dado o intent retornado pela IA, avança o estado da conversa
export function advanceState(currentState, aiIntent, appointmentAction) {
  const state = currentState?.state ?? CONV_STATES.WELCOME;
  const ctx   = currentState?.context ?? {};

  if (aiIntent === "handoff") {
    return { nextState: CONV_STATES.HANDOFF, context: ctx };
  }

  if (aiIntent === "cancel") {
    return { nextState: CONV_STATES.CANCEL, context: ctx };
  }

  if (aiIntent === "reschedule") {
    return { nextState: CONV_STATES.RESCHEDULE, context: ctx };
  }

  // Agendamento confirmado pela IA
  if (
    aiIntent === "schedule" &&
    appointmentAction?.action_type === "create" &&
    appointmentAction?.should_update
  ) {
    return { nextState: CONV_STATES.SCHEDULED, context: ctx };
  }

  // Fluxo de agendamento em progresso
  if (aiIntent === "schedule") {
    const scheduleFlow = [
      CONV_STATES.WELCOME,
      CONV_STATES.IDENTIFY,
      CONV_STATES.CHOOSE_SPECIALTY,
      CONV_STATES.CHOOSE_INSURANCE,
      CONV_STATES.CHOOSE_DOCTOR,
      CONV_STATES.CHOOSE_TIME,
      CONV_STATES.CONFIRM,
    ];

    const idx = scheduleFlow.indexOf(state);
    const nextIdx = idx >= 0 && idx < scheduleFlow.length - 1 ? idx + 1 : idx;
    return { nextState: scheduleFlow[nextIdx] ?? CONV_STATES.CHOOSE_TIME, context: ctx };
  }

  if (aiIntent === "faq" || aiIntent === "unknown") {
    return { nextState: CONV_STATES.FAQ, context: ctx };
  }

  return { nextState: state, context: ctx };
}

// Descrição do estado atual para incluir no prompt da IA
export function buildStateContext(convState) {
  if (!convState) {
    return "Estado da conversa: nova conversa. Apresente-se brevemente e pergunte como pode ajudar.";
  }

  const descriptions = {
    [CONV_STATES.WELCOME]:          "Conversa iniciada. Paciente ainda não informou o que precisa.",
    [CONV_STATES.IDENTIFY]:         "Aguardando identificação do paciente (nome, CPF ou telefone).",
    [CONV_STATES.CHOOSE_SPECIALTY]: "Paciente quer agendar. Aguardando escolha de especialidade.",
    [CONV_STATES.CHOOSE_LOCATION]:  "Especialidade definida. Aguardando cidade/estado.",
    [CONV_STATES.CHOOSE_INSURANCE]: "Localização definida. Perguntar se é particular ou qual convênio.",
    [CONV_STATES.CHOOSE_DOCTOR]:    "Convênio definido. Aguardando escolha do profissional.",
    [CONV_STATES.CHOOSE_TIME]:      "Profissional escolhido. Apresentar horários disponíveis e aguardar escolha.",
    [CONV_STATES.CONFIRM]:          "Horário escolhido. Confirmar os dados do agendamento com o paciente antes de finalizar.",
    [CONV_STATES.SCHEDULED]:        "Consulta confirmada. Oferecer informações adicionais se necessário.",
    [CONV_STATES.RESCHEDULE]:       "Paciente quer remarcar. Perguntar nova data/horário preferido.",
    [CONV_STATES.CANCEL]:           "Paciente quer cancelar. Confirmar qual agendamento e processar cancelamento.",
    [CONV_STATES.HANDOFF]:          "Conversa transferida para humano. Não responda automaticamente.",
    [CONV_STATES.FAQ]:              "Paciente com dúvida. Responder objetivamente e perguntar se precisa de mais algo.",
    [CONV_STATES.IDLE]:             "Conversa inativa. Tratar como nova conversa.",
  };

  const desc = descriptions[convState.state] ?? "Estado desconhecido. Pergunte como pode ajudar.";
  const contextData = convState.context && Object.keys(convState.context).length > 0
    ? `\nDados já coletados nesta conversa: ${JSON.stringify(convState.context)}`
    : "";

  return `Estado atual da conversa: ${desc}${contextData}\nSiga o fluxo indicado — não pule etapas nem repita perguntas já respondidas.`;
}
