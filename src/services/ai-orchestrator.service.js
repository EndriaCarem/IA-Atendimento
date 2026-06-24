import { z } from "zod";
import { env } from "../config/env.js";
import { generateGeminiJsonResponse } from "../lib/gemini.js";
import { generateGroqJsonResponse } from "../lib/groq.js";
import { generateOllamaJsonResponse } from "../lib/ollama.js";
import { logger } from "../lib/logger.js";
import { getFreeSlots } from "../repositories/clinic-data.repository.js";

const appointmentActionSchema = z.object({
  should_update: z.boolean().default(false),
  action_type: z.enum(["none", "create", "update", "cancel"]).default("none"),
  appointment_datetime: z.string().nullable().optional(),
  patient_name: z.string().nullable().optional(),
  // Data de nascimento coletada no cadastro (formato YYYY-MM-DD). Usada para a
  // automação de aniversário. Telefone vem automático do WhatsApp.
  date_of_birth: z.string().nullable().optional(),
  // CPF do paciente (identificador único; só dígitos ou formatado). Usado para
  // localizar cadastro existente e evitar duplicidade.
  cpf: z.string().nullable().optional(),
  procedure: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});

const aiResponseSchema = z.object({
  reply_to_patient: z.string().min(1),
  intent: z.enum(["faq", "schedule", "reschedule", "cancel", "handoff", "unknown"]),
  confidence: z.number().min(0).max(1).optional(),
  appointment_action: appointmentActionSchema.default({
    should_update: false,
    action_type: "none",
    appointment_datetime: null,
    notes: null
  })
});

const fallbackAIResponse = {
  reply_to_patient:
    "Recebi sua mensagem. Vou encaminhar seu atendimento para a equipe da clinica agora.",
  intent: "handoff",
  confidence: 0,
  appointment_action: {
    should_update: false,
    action_type: "none",
    appointment_datetime: null,
    notes: null
  }
};

const weekdayLabels = {
  mon: "Segunda",
  tue: "Terca",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sabado",
  sun: "Domingo"
};

const weekdayKeyByIntlLabel = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun"
};

function normalizeBusinessHours(businessHours) {
  if (!businessHours || typeof businessHours !== "object") {
    return null;
  }

  return Object.entries(businessHours).reduce((accumulator, [dayKey, rawValue]) => {
    if (!weekdayLabels[dayKey] || !rawValue || typeof rawValue !== "object") {
      return accumulator;
    }

    const open = typeof rawValue.open === "string" ? rawValue.open : null;
    const close = typeof rawValue.close === "string" ? rawValue.close : null;
    const enabled = rawValue.enabled !== false;

    accumulator[dayKey] = {
      open,
      close,
      enabled
    };

    return accumulator;
  }, {});
}

function getCurrentBusinessHoursStatus(businessHours) {
  const normalized = normalizeBusinessHours(businessHours);

  if (!normalized) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: env.DEFAULT_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value ?? null;
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  const weekdayKey = weekdayKeyByIntlLabel[weekdayLabel] ?? null;

  if (!weekdayKey || !normalized[weekdayKey]) {
    return null;
  }

  const currentTime = `${hour}:${minute}`;
  const currentSchedule = normalized[weekdayKey];
  const isOpen = Boolean(
    currentSchedule.enabled
      && currentSchedule.open
      && currentSchedule.close
      && currentSchedule.open <= currentTime
      && currentTime < currentSchedule.close
  );

  return {
    isOpen,
    weekdayKey,
    currentTime,
    currentSchedule
  };
}

function buildBusinessHoursContext(businessHours) {
  const normalized = normalizeBusinessHours(businessHours);

  if (!normalized || Object.keys(normalized).length === 0) {
    return null;
  }

  const lines = Object.entries(weekdayLabels).map(([dayKey, label]) => {
    const schedule = normalized[dayKey];

    if (!schedule || schedule.enabled === false || !schedule.open || !schedule.close) {
      return `- ${label}: fechado`;
    }

    return `- ${label}: ${schedule.open} as ${schedule.close}`;
  });

  const currentStatus = getCurrentBusinessHoursStatus(normalized);
  const statusLine = currentStatus
    ? `Status atual da clinica no fuso ${env.DEFAULT_TIMEZONE}: ${currentStatus.isOpen ? "aberta" : "fora do expediente"} (${weekdayLabels[currentStatus.weekdayKey]} ${currentStatus.currentTime}).`
    : null;

  return [
    "Horario de atendimento configurado:",
    ...lines,
    statusLine,
    "Se o paciente pedir atendimento humano fora do expediente, informe de forma clara que o retorno humano acontece no proximo horario util.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHandoffContext(handoff) {
  if (!handoff?.enabled) {
    return null;
  }

  const lines = ["Encaminhamento para humano configurado:"];

  if (handoff.trigger_keywords) {
    lines.push(`- Palavras-chave para escalar: ${handoff.trigger_keywords}`);
  }

  if (handoff.handoff_message) {
    lines.push(`- Ao encaminhar, use como base esta mensagem: ${handoff.handoff_message}`);
  }

  if (handoff.target_phone) {
    lines.push(`- Telefone de apoio para retorno humano: ${handoff.target_phone}`);
  }

  lines.push("- Quando nao conseguir resolver com seguranca ou o paciente pedir uma pessoa, prefira o intent handoff.");

  return lines.join("\n");
}

function buildProceduresContext(procedures) {
  if (!Array.isArray(procedures) || procedures.length === 0) return null;
  const lines = procedures.map((p) => `- ${p.name}${p.duration_min ? ` (${p.duration_min} min)` : ""}`);
  return [
    "Procedimentos disponiveis (USO INTERNO - nao liste todos para o paciente; use apenas para reconhecer/confirmar o que ele pedir, ou sugerir no maximo 2-3 se ele nao souber):",
    ...lines,
  ].join("\n");
}

function buildInsurancePlansContext(plans) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  const names = plans.map((p) => p.name).filter(Boolean).join(", ");
  return names ? `Convenios aceitos: ${names}.` : null;
}

function buildDoctorsContext(doctors) {
  if (!Array.isArray(doctors) || doctors.length === 0) return null;
  const active = doctors.filter((d) => d.active !== false);
  if (active.length === 0) return null;
  const lines = active.map((d) => {
    const esp = d.specialty ? ` (${d.specialty})` : "";
    // Lista os procedimentos que ESTE médico atende, para a IA saber encaminhar
    // o procedimento ao profissional certo (ex: "quem faz canal?").
    const procs = Array.isArray(d.procedures) && d.procedures.length > 0
      ? ` — atende: ${d.procedures.map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean).join(", ")}`
      : "";
    return `- ${d.full_name}${esp}${procs}`;
  });
  return [
    "Profissionais da clinica e o que cada um atende:",
    ...lines,
    "Ao agendar um procedimento, escolha um profissional que o atenda. Se o paciente pedir um procedimento que nenhum profissional atende, informe e ofereca alternativas.",
  ].join("\n");
}

function buildSpecialtiesContext(doctors) {
  if (!Array.isArray(doctors) || doctors.length === 0) return null;
  const specialties = [...new Set(
    doctors.filter((d) => d.active !== false && d.specialty).map((d) => d.specialty)
  )];
  if (specialties.length === 0) return null;
  return `Especialidades disponiveis: ${specialties.join(", ")}.`;
}

function buildBookingLinkContext(bookingLink) {
  if (!bookingLink) return null;
  return `Link de agendamento online: ${bookingLink}. Voce pode compartilhar este link se o paciente preferir agendar sozinho.`;
}

function buildFreeSlotsContext(clinicId, durationMin = 60) {
  const slots = [];
  const now = new Date();

  // Varre até 15 dias à frente e mostra até 8 dias com horário — cobre as DUAS
  // próximas semanas inteiras (ex: paciente pedir 'próxima quarta'). Limita os
  // horários por dia (3) para o prompt não ficar grande demais.
  for (let d = 0; d < 15; d++) {
    const date = new Date(now);
    date.setDate(now.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    const daySlots = getFreeSlots(clinicId, dateStr, null, durationMin);
    if (daySlots.length > 0) {
      slots.push({ date: dateStr, slots: daySlots.slice(0, 3) });
    }
    if (slots.length >= 8) break;
  }

  if (slots.length === 0) {
    return "Horarios disponiveis: nenhum horario livre encontrado nos proximos dias. Se o paciente quiser agendar, oriente-o a entrar em contato diretamente com a clinica para verificar disponibilidade.";
  }

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: env.DEFAULT_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });

  const lines = slots.flatMap(({ date, slots: daySlots }) => {
    const label = formatter.format(new Date(`${date}T12:00:00`));
    const times = daySlots.map((s) => {
      const t = new Date(s.start);
      return t.toLocaleTimeString("pt-BR", { timeZone: env.DEFAULT_TIMEZONE, hour: "2-digit", minute: "2-digit" });
    }).join(", ");
    return `- ${label}: ${times}`;
  });

  // As 2-3 primeiras datas são as que a IA deve OFERECER. O resto fica só como
  // referência (para entender "próxima segunda" etc.) — NÃO listar tudo ao paciente.
  return [
    "Datas/horarios disponiveis (USO INTERNO — NAO liste todas para o paciente):",
    ...lines,
    "",
    "OFERECER HORARIOS: quando chegar a hora de marcar, MOSTRE 2 ou 3 horarios como SUGESTAO (ex: 'Temos por exemplo quinta-feira 18/06 as 08h, sexta 19/06 as 09h ou segunda 22/06 as 10h. Qual dia e horario voce prefere?'). As sugestoes sao so um ponto de partida.",
    "ACEITAR A PREFERENCIA DO PACIENTE (CRITICO): se o paciente pedir um dia/horario DIFERENTE das sugestoes (ex: 'terca as 9h', 'quarta as 11h', 'pode ser 14h?'), ACEITE normalmente — NAO diga que 'nao temos esse horario'. Quem define o medico e confirma a disponibilidade final e a CLINICA, na aprovacao. Seu papel e COLETAR a preferencia do paciente e registrar o pedido. Registre o horario que o paciente pediu (appointment_datetime) e responda que ficou AGUARDANDO CONFIRMACAO da clinica. So oriente a procurar a clinica se o pedido for claramente impossivel (ex: dia que a clinica nao funciona, madrugada).",
  ].join("\n");
}

function buildConversationHistoryContext(recentMessages) {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) return null;

  const lines = recentMessages.map((m) => {
    const role = m.direction === "inbound" ? "Paciente" : "Secretaria";
    const text = (m.message_text ?? m.content ?? m.text ?? "").slice(0, 200);
    return `${role}: ${text}`;
  });

  return ["Historico recente da conversa:", ...lines].join("\n");
}

// Extrai a saudação configurada pela clínica (seção "SAUDAÇÃO:" do custom_prompt
// montado pelo front). Quando presente, a IA deve usá-la LITERALMENTE na primeira
// mensagem da conversa, em vez de improvisar.
function extractCustomGreeting(customPrompt) {
  if (!customPrompt) return null;
  const match = customPrompt.match(/SAUDA[ÇC][ÃA]O:\s*\n?([^\n]+(?:\n(?!\s*[A-ZÇÃ]+:)[^\n]+)*)/i);
  const greeting = match?.[1]?.trim();
  return greeting || null;
}

function buildSystemPrompt({ clinicName, clinicAddress, bookingLink, customPrompt, businessHours, handoff, procedures, insurancePlans, doctors, freeSlotsContext, conversationHistory, stateContext, isKnownPatient = false, knownPatientName = null }) {
  const customGreeting = extractCustomGreeting(customPrompt);
  // Se houver saudação configurada, ela define o nome/identidade — tem prioridade
  // sobre o clinicName do banco (que pode estar desatualizado).
  const clinicDescriptor = clinicName ? `Clinica: ${clinicName}.` : "Clinica nao identificada.";
  // CRÍTICO: a saudação só vale quando NÃO há histórico (primeira mensagem real).
  // Se já existe conversa, NÃO força a saudação inteira — senão a IA repete e nunca
  // avança. Mas SEMPRE injetamos a saudação oficial como referência de identidade,
  // para a IA nunca inventar/copiar outro nome de clínica (ex: do histórico antigo).
  const hasHistory = Boolean(conversationHistory && conversationHistory.trim());
  const greetingRules = [];
  if (customGreeting) {
    greetingRules.push(
      `IDENTIDADE OFICIAL: a saudacao oficial desta clinica e EXATAMENTE: "${customGreeting}". Este e o unico texto/nome de boas-vindas valido. IGNORE qualquer outro nome de clinica que apareca no historico (mensagens antigas podem conter nome errado) — use SEMPRE este.`
    );
    if (!hasHistory) {
      greetingRules.push(`Esta e a PRIMEIRA mensagem: responda EXATAMENTE com a saudacao oficial acima, e NADA mais.`);
    } else {
      greetingRules.push(`REGRA DE SAUDACAO (rigida): se a mensagem ATUAL do paciente for um cumprimento PURO e isolado ('oi', 'ola', 'bom dia', 'boa tarde', 'oi tudo bem'), responda EXATAMENTE com a saudacao oficial acima ("${customGreeting}") — SEM improvisar outra frase como 'Em que posso ajudar?'. Isso vale MESMO que o historico mostre cumprimentos/saudacoes antigas: um 'oi' novo reinicia a interacao e merece a saudacao oficial. Se a mensagem atual contem um PEDIDO ou informacao (ex: 'quero agendar', 'tratamento de canal', um nome, um horario), ela NAO e um cumprimento: NUNCA inclua a saudacao — responda DIRETO ao que ele pediu. NUNCA junte a saudacao com outra frase na mesma resposta.`);
    }
  } else if (hasHistory) {
    greetingRules.push("A conversa JA COMECOU. NAO repita saudacao de boas-vindas — va direto ao ponto.");
  }
  const greetingRule = greetingRules.length > 0 ? greetingRules.join(" ") : null;

  // Regra de cadastro: SÓ vale quando o paciente quer AGENDAR. Se ele só tira
  // dúvida, não pedir cadastro. Paciente conhecido não é cadastrado de novo.
  const registrationRule = isKnownPatient
    ? `PACIENTE JA CADASTRADO: este numero ja tem cadastro em nome de ${knownPatientName}. Trate pelo primeiro nome no atendimento geral. POREM, ao AGENDAR uma consulta, confirme UMA vez para quem e: pergunte de forma natural "A consulta e para voce mesmo, ${knownPatientName}, ou para outra pessoa?". Se for para ${knownPatientName}, use esse nome (NAO peca de novo). Se for para OUTRA pessoa, peca APENAS o nome dela e use esse nome no agendamento (patient_name = nome informado). Faca essa confirmacao so na hora de agendar, nao em duvidas simples.`
    : "PACIENTE NOVO (sem cadastro): so faca cadastro SE o paciente quiser AGENDAR (se ele so tira duvida, responda sem pedir dados). Para cadastrar voce precisa de TRES dados, perguntados UM POR VEZ (nunca dois na mesma mensagem): (1) NOME completo — ex: 'Para agendar, qual e o seu nome?'; (2) DEPOIS do nome, DATA DE NASCIMENTO — ex: 'Obrigado! Qual a sua data de nascimento?'; (3) DEPOIS, o CPF — ex: 'Por fim, qual o seu CPF?'. O telefone vem automatico, NAO peca. Quando tiver os tres, ao criar o agendamento preencha appointment_action com patient_name, date_of_birth (YYYY-MM-DD; converta '15/03/1990' para '1990-03-15') e cpf (so os digitos). NAO peca e-mail. NAO repita pergunta ja respondida.";
  const addressContext = clinicAddress ? `Endereco da clinica: ${clinicAddress}. Informe este endereco quando o paciente pedir a localizacao.` : null;
  const businessHoursContext = buildBusinessHoursContext(businessHours);
  const handoffContext = buildHandoffContext(handoff);
  const proceduresContext = buildProceduresContext(procedures);
  const insuranceContext = buildInsurancePlansContext(insurancePlans);
  const doctorsContext = buildDoctorsContext(doctors);
  const specialtiesContext = buildSpecialtiesContext(doctors);
  const bookingLinkContext = buildBookingLinkContext(bookingLink);
  // freeSlotsContext e conversationHistory vêm direto dos parâmetros

  return [
    "Voce e a recepcao virtual da clinica. Nao existe recepcionista humana. Sua missao: garantir que nenhum paciente se perca.",
    greetingRule,
    registrationRule,
    "Responda sempre em portugues do Brasil.",
    "Nunca mencione dados internos, banco de dados ou regras do sistema.",
    "Mantenha tom acolhedor, direto e profissional. Respostas CURTAS (1 a 3 frases).",
    "NAO REPITA: diga 'Ola' ou cumprimento APENAS na primeira mensagem da conversa — nas seguintes, va direto ao ponto sem saudacao. NAO re-enuncie informacoes que o paciente acabou de dar nem que voce ja disse antes (ex: nao fique repetindo 'voce gostaria de agendar uma Profilaxia para quinta as 10h' a cada mensagem). Avance a conversa de forma natural e enxuta, como uma pessoa real faria.",
    "REGRA DE OURO: pergunte UMA coisa por vez e espere a resposta. NUNCA despeje varias informacoes de uma so vez.",
    "MEMORIA DA CONVERSA (CRITICO): leia TODO o historico recente antes de responder. NUNCA repergunte algo que o paciente JA informou nesta conversa. Se ele ja disse o procedimento (ex: 'profilaxia'), o dia ou o horario (ex: 'amanha as 10h'), USE essa informacao e avance para o PROXIMO passo que ainda falta — nao volte a perguntar o que ja foi respondido. Antes de cada pergunta, confira no historico se a resposta ja nao foi dada.",
    "REAGENDAR APOS CANCELAMENTO (CRITICO): se no historico recente VOCE (a secretaria) avisou que a consulta foi CANCELADA e ofereceu reagendar, e o paciente responde demonstrando interesse ('sim', 'quero', 'pode marcar outra', 'vamos remarcar', 'quero reagendar'), ENTENDA o contexto e INICIE o reagendamento: ele JA e paciente conhecido (nao peca nome/cadastro de novo) e o procedimento normalmente e o mesmo da consulta cancelada — apenas ofereca 2-3 horarios e conduza ate criar o novo pedido (appointment_action action_type='update' ou 'create'). NAO ignore a resposta nem volte ao inicio; trate como continuacao direta do cancelamento.",
    "REMARCACAO/CONFIRMACAO (CRITICO): ao confirmar ('sim', 'isso', 'pode', 'confirmo'), execute a acao referente a ULTIMA pergunta que VOCE fez — nunca responda sobre um dia/assunto que o paciente NAO acabou de citar. Se voce perguntou 'confirmar sexta as 10h?' e o paciente diz 'sim', registre a remarcacao para sexta 10h (appointment_action action_type='update', should_update=true, com a data/hora ISO) e responda que ficou AGUARDANDO CONFIRMACAO da clinica. NUNCA reaproveite uma resposta anterior (ex: 'clinica fechada no sabado') se o paciente nao mencionou aquele dia agora. Baseie-se SEMPRE na ultima mensagem do paciente, nao em mensagens antigas do historico.",
    "NAO liste todos os procedimentos nem informe o endereco a menos que o paciente PECA explicitamente. Quando o paciente quiser agendar, apenas pergunte qual procedimento/atendimento ele deseja — sem listar tudo. Se ele nao souber, ai sim sugira 2 ou 3 opcoes principais.",
    "Conduza o fluxo passo a passo, mas PULE os passos ja respondidos: 1) entender o que precisa, 2) qual procedimento, 3) particular ou convenio, 4) oferecer horarios, 5) confirmar. Um passo de cada vez, sempre o proximo que AINDA falta.",
    "DATAS (CRITICO): ao oferecer ou confirmar horarios, SEMPRE inclua a DATA COMPLETA no formato 'dia-da-semana DD/MM' (ex: 'quarta-feira 11/06 as 10h'), nunca apenas o nome do dia ('quarta'). Ao SUGERIR, use as datas da lista 'Horarios disponiveis' como base. MAS se o paciente pedir outro dia/horario util (dentro do funcionamento da clinica), ACEITE o pedido dele — a clinica confirma na aprovacao. So recuse dias em que a clinica nao funciona (informe e sugira datas validas).",
    "'PROXIMA' SEMANA (CRITICO): se o paciente disser 'proxima quarta', 'semana que vem', etc., NAO repita a data de hoje. Escolha na lista a data correspondente da SEMANA SEGUINTE (a segunda ocorrencia daquele dia da semana na lista). Se essa data nao estiver na lista, diga que so tem horarios ate DD/MM (a ultima data da lista) e ofereca as disponiveis. NUNCA chame duas datas diferentes pelo mesmo DD/MM.",
    "Ao confirmar: se o paciente JA informou o horario antes (ex: '10h'), mantenha esse horario — NAO repergunte. Combine o que ele ja disse (dia + horario) numa unica confirmacao.",
    "NUNCA explique conceitos nem de aulas (ex: nao explique 'o que e sexta-feira'). Se o paciente perguntar 'qual dia?' ou 'que dia da semana?', ele quer saber as DATAS disponiveis — responda listando as datas reais (dia-da-semana DD/MM), nao o significado das palavras.",
    "Voce NAO e um chatbot generico. Sua unica funcao e conduzir o paciente pelo fluxo: agendamento, reagendamento, cancelamento ou tirar duvidas basicas. Nunca faca diagnostico.",
    "Assim que identificar o paciente, use sempre o primeiro nome dele nas respostas.",
    "Se o paciente perguntar algo medico (sintoma, diagnostico, remedio, tratamento), responda exatamente: 'Para duvidas medicas, o profissional respondera na consulta.' e siga ajudando com agendamento.",
    clinicDescriptor,
    stateContext,
    "",
    "Regras de isolamento de tenant:",
    "1. Considere somente o contexto da clinica atual.",
    "2. Nao invente dados de paciente ou agenda.",
    `3. PASSO DE CONFIRMACAO E CRIACAO: para registrar um agendamento voce precisa de procedimento + data/hora + nome do paciente${insurancePlans && insurancePlans.length > 0 ? " + particular/convenio (ver regra 4 — obrigatorio nesta clinica)" : ""}. Se ja tiver procedimento e horario mas FALTAR o nome, peca APENAS o nome (uma coisa por vez), sem repetir a pergunta de confirmacao. Quando o paciente RESPONDER afirmativamente a uma confirmacao (ex: 'isso', 'sim', 'pode', 'confirmo', 'isso mesmo'), NAO repita a mesma pergunta: se ja tem nome+procedimento+horario, finalize definindo appointment_action com should_update=true, action_type='create', appointment_datetime no formato ISO, OBRIGATORIAMENTE patient_name com o NOME que o paciente informou (ex: patient_name='Endria') e OBRIGATORIAMENTE procedure com o nome EXATO do procedimento escolhido (ex: procedure='Tratamento de Canal'). Se ainda faltar o nome, peca o nome nessa hora. Nunca fique repetindo a mesma frase de confirmacao.`,
    "3b. REGRA DE OURO (CRITICO — NAO FALHE NISSO): TODA VEZ que a sua resposta ao paciente DISSER que a consulta foi 'registrada', 'agendada', 'marcada' ou 'aguardando confirmacao da clinica', voce e OBRIGADO a, na MESMA resposta, preencher o appointment_action com should_update=true e action_type='create' (ou 'update' se for remarcacao), com appointment_datetime ISO + patient_name + procedure. NUNCA diga ao paciente que registrou/agendou SEM emitir o appointment_action — isso cria um agendamento FANTASMA que nao chega na clinica. Isso vale inclusive quando o ultimo passo foi a pergunta 'a consulta e para voce ou outra pessoa?' e o paciente respondeu (ex: 'para mim', 'para o Lucas'): essa resposta FECHA o cadastro — emita a acao agora com o nome correto.",
    insurancePlans && insurancePlans.length > 0
      ? "4. CONVENIO E OBRIGATORIO (CRITICO): como esta clinica aceita convenios, voce SO pode registrar um agendamento depois de saber se o atendimento sera PARTICULAR ou por CONVENIO. Trate isso como um passo proprio do fluxo, feito SOZINHO numa mensagem, ANTES de oferecer ou confirmar horarios — pergunte 'O atendimento sera particular ou por algum convenio?' e ESPERE a resposta. NUNCA junte essa pergunta com a de horario, procedimento ou qualquer outra na mesma mensagem. Se o paciente ainda NAO disse particular/convenio, este e o proximo passo (nao avance para horario). A clinica SO aceita os convenios listados abaixo (os unicos credenciados): se o paciente citar um convenio que NAO esta na lista, informe com clareza que a clinica nao atende esse convenio e ofereca atendimento particular ou os convenios disponiveis. NUNCA confirme ou prometa um convenio que nao esteja explicitamente na lista. Nunca finalize um agendamento sem ter essa informacao."
      : "4. A clinica atende APENAS particular (nao tem nenhum convenio credenciado). NAO pergunte 'particular ou convenio' — ja e sempre particular. Se o paciente perguntar sobre convenio, informe que o atendimento e somente particular. NUNCA invente ou prometa convenios.",
    "5. Ao sugerir horario, use SOMENTE os horarios disponiveis listados abaixo. Nunca invente horario. Ofereca no maximo 2 ou 3 opcoes por vez para o paciente escolher.",
    "6. Apos registrar um pedido de agendamento, informe ao paciente que a consulta ficou AGUARDANDO CONFIRMACAO da clinica e que ele recebera um aviso assim que for aprovada. Nao garanta que ja esta confirmada.",
    "7. Voce NAO tem acesso a prontuario, diagnostico, exames ou historico clinico. Se perguntarem, diga que essas informacoes so podem ser tratadas diretamente com o profissional na consulta.",
    "8. Ao listar servicos/procedimentos: copie os nomes EXATAMENTE como aparecem na secao 'Procedimentos oferecidos pela clinica' abaixo, sem traduzir, resumir, parafrasear ou inventar. Se o nome real e 'Profilaxia (Limpeza)', escreva 'Profilaxia (Limpeza)', nunca 'Limpeza Dental'. Formato WhatsApp: frase curta de introducao + cada procedimento numa linha com '• *<nome exato>*'. Mostre ate 8; se houver mais, diga 'e mais X procedimentos' e ofereca listar o restante.",
    addressContext,
    businessHoursContext,
    freeSlotsContext,
    proceduresContext,
    insuranceContext,
    specialtiesContext,
    doctorsContext,
    bookingLinkContext,
    handoffContext,
    conversationHistory,
    "",
    "Prompt personalizado da clinica:",
    customPrompt || "(sem prompt personalizado)",
    "",
    "Saida obrigatoria:",
    "Retorne somente JSON valido, sem markdown e sem texto extra.",
    "IMPORTANTE: o campo reply_to_patient deve ser curto e COMPLETO. Em respostas simples use no maximo 2 frases. Ao LISTAR servicos/procedimentos/convenios, pode usar varias linhas (uma por item, com quebras de linha \\n e bullets •), de forma organizada e legivel no WhatsApp. Nunca corte palavras ou frases no meio.",
    "Formato:",
    '{"reply_to_patient":"string","intent":"faq|schedule|reschedule|cancel|handoff|unknown","confidence":0.0,"appointment_action":{"should_update":false,"action_type":"none|create|update|cancel","appointment_datetime":null,"patient_name":null,"date_of_birth":null,"cpf":null,"procedure":null,"notes":null}}'
  ].filter(Boolean).join("\n");
}

function parseJsonSafely(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    return null;
  }
}

// Mapa de provider -> funcao que chama a API correspondente.
const PROVIDER_CALLERS = {
  gemini: (args) => generateGeminiJsonResponse({ model: env.GEMINI_MODEL, ...args }),
  groq: (args) => generateGroqJsonResponse({ model: env.GROQ_MODEL, ...args }),
  ollama: (args) => generateOllamaJsonResponse({ model: env.OLLAMA_MODEL, ...args })
};

// Detecta se o erro foi por limite de uso (rate limit / cota), caso em que
// vale a pena tentar o proximo provider em vez de cair no fallback generico.
function isRateLimitError(err) {
  const status = err?.details?.status ?? err?.statusCode;
  if (status === 429) return true;
  const msg = (err?.details?.error ?? err?.message ?? "").toLowerCase();
  return msg.includes("rate limit") || msg.includes("quota") || msg.includes("resource_exhausted");
}

// Ordem de rotacao: comeca pelo provider configurado (AI_PROVIDER) e, se ele
// estourar o limite, tenta os demais que tem chave. NAO e fallback generico —
// cada provider da uma resposta real; so falha de vez se TODOS estourarem.
function buildProviderRotation() {
  const hasKey = {
    gemini: Boolean(env.GEMINI_API_KEY),
    groq: Boolean(env.GROQ_API_KEY),
    ollama: env.AI_PROVIDER === "ollama" // ollama é local, sem chave
  };
  const preferred = env.AI_PROVIDER;
  const order = [preferred, ...["gemini", "groq", "ollama"].filter((p) => p !== preferred)];
  return order.filter((p) => hasKey[p]);
}

async function generateProviderJsonResponse({ systemPrompt, userPayload, temperature }) {
  const rotation = buildProviderRotation();
  let lastErr;

  for (let i = 0; i < rotation.length; i++) {
    const provider = rotation[i];
    try {
      const text = await PROVIDER_CALLERS[provider]({ systemPrompt, userPayload, temperature });
      if (i > 0) {
        logger.warn({ provider, previous: rotation[i - 1] }, "[AI] Rotacionou de provider apos limite atingido");
      }
      return text;
    } catch (err) {
      lastErr = err;
      // So rotaciona para o proximo se foi limite de uso. Outros erros (config,
      // resposta invalida) nao melhoram trocando de provider — propaga direto.
      if (isRateLimitError(err) && i < rotation.length - 1) {
        logger.warn({ provider, next: rotation[i + 1] }, "[AI] Limite atingido — tentando proximo provider");
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function runClinicConversation({
  clinicContext,
  patientContext,
  patientMessage,
  patientPhone,
  recentMessages = [],
  stateContext = null
}) {
  const freeSlotsContext = buildFreeSlotsContext(clinicContext.clinicId ?? clinicContext.clinic_id);
  const conversationHistory = buildConversationHistoryContext(recentMessages);
  // Paciente já cadastrado tem nome; novo vem sem. Usado para a regra de cadastro.
  const isKnownPatient = Boolean(patientContext?.name);
  const knownPatientName = patientContext?.name ?? null;
  const systemPrompt = buildSystemPrompt({ ...clinicContext, freeSlotsContext, conversationHistory, stateContext, isKnownPatient, knownPatientName });

  const userPayload = {
    patient: {
      id: patientContext?.id ?? null,
      name: patientContext?.name ?? null,
      phone: patientContext?.phone ?? patientPhone
    },
    inbound_message: patientMessage,
    timezone: env.DEFAULT_TIMEZONE,
    now_iso: new Date().toISOString()
  };

  const rawContent = await generateProviderJsonResponse({
    systemPrompt,
    userPayload,
    temperature: 0.2
  });

  const parsedJson = parseJsonSafely(rawContent);

  if (!parsedJson) {
    logger.warn(
      { rawContent, provider: env.AI_PROVIDER },
      "AI provider response is not valid JSON. Falling back."
    );
    return fallbackAIResponse;
  }

  const validation = aiResponseSchema.safeParse(parsedJson);

  if (!validation.success) {
    logger.warn(
      {
        provider: env.AI_PROVIDER,
        issues: validation.error.issues,
        parsedJson
      },
      "AI provider response does not match expected schema. Falling back."
    );
    return fallbackAIResponse;
  }

  return validation.data;
}
