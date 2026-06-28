/**
 * Testes de simulação de conversas da IA Secretária IACLIN.
 * Roda direto: node scripts/test-conversation-flows.js
 *
 * Requer variáveis de ambiente configuradas (GEMINI_API_KEY etc.)
 * e uma clínica semeada no db.json.
 */

import "dotenv/config";
import { runClinicConversation } from "../src/services/ai-orchestrator.service.js";
import {
  getConversationState,
  setConversationState,
  advanceState,
  buildStateContext,
  clearConversationState,
  CONV_STATES,
} from "../src/services/conversation-state.service.js";
import { dbFindOne } from "../src/lib/json-db.js";

// ── Configuração do teste ────────────────────────────────────────────────────

const CLINIC_ID   = process.env.TEST_CLINIC_ID   || "clinic-test-001";
const TEST_PHONE  = "5511999990001";

// Clínica sintética para os testes (não precisa estar no db.json)
const MOCK_CLINIC = {
  clinicId:      CLINIC_ID,
  clinicName:    "Clínica Odonto Teste",
  customPrompt:  "Somos uma clínica odontológica em São Paulo. Atendemos de segunda a sexta.",
  aiEnabled:     true,
  businessHours: {
    mon: { open: "08:00", close: "18:00", enabled: true },
    tue: { open: "08:00", close: "18:00", enabled: true },
    wed: { open: "08:00", close: "18:00", enabled: true },
    thu: { open: "08:00", close: "18:00", enabled: true },
    fri: { open: "08:00", close: "17:00", enabled: true },
    sat: { enabled: false },
    sun: { enabled: false },
  },
  procedures: [
    { name: "Limpeza dental",      duration_min: 60,  category: "Preventivo" },
    { name: "Clareamento dental",  duration_min: 90,  category: "Estético"   },
    { name: "Extração",            duration_min: 45,  category: "Cirúrgico"  },
    { name: "Consulta avaliação",  duration_min: 30,  category: "Geral"      },
  ],
  insurancePlans: [
    { name: "Bradesco Dental" },
    { name: "Amil Dental"     },
    { name: "Particular"      },
  ],
  doctors: [
    { full_name: "Dra. Ana Paula",  specialty: "Clínico Geral",   active: true },
    { full_name: "Dr. Marcos Lima", specialty: "Ortodontia",      active: true },
    { full_name: "Dra. Carla Sena", specialty: "Implantodontia",  active: true },
  ],
  handoff: {
    enabled:          true,
    trigger_keywords: "urgência,urgencia,emergência,dor forte,sangramento",
    handoff_message:  "Vou te transferir para nossa equipe agora. Aguarde um momento.",
    target_phone:     "5511999990000",
  },
};

// ── Utilitários ─────────────────────────────────────────────────────────────

const colors = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  gray:    "\x1b[90m",
  magenta: "\x1b[35m",
};

function log(label, msg, color = colors.reset) {
  console.log(`${color}${label}${colors.reset} ${msg}`);
}

function header(title) {
  console.log(`\n${colors.bold}${colors.cyan}${"═".repeat(60)}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}${"═".repeat(60)}${colors.reset}\n`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function simulateTurn(phone, message, patient = null, recentMessages = []) {
  await sleep(1500); // evita rate limit do Groq (free: ~30 req/min)
  const convState   = getConversationState(CLINIC_ID, phone);
  const stateContext = buildStateContext(convState);

  log("👤 Paciente:", `"${message}"`, colors.yellow);
  log("📍 Estado:",   convState?.state ?? "nova conversa", colors.gray);

  const result = await runClinicConversation({
    clinicContext:  MOCK_CLINIC,
    patientContext: patient,
    patientMessage: message,
    patientPhone:   phone,
    recentMessages,
    stateContext,
  });

  const { nextState, context: nextContext } = advanceState(
    convState,
    result.intent,
    result.appointment_action
  );
  setConversationState(CLINIC_ID, phone, nextState, nextContext);

  log("🤖 IA:", `"${result.reply_to_patient}"`, colors.green);
  log("   intent:", result.intent, colors.gray);
  log("   → estado:", nextState, colors.magenta);

  if (result.appointment_action?.should_update) {
    log("   📅 ação:", JSON.stringify(result.appointment_action), colors.cyan);
  }

  console.log();
  return result;
}

// ── Cenários de teste ────────────────────────────────────────────────────────

async function testFlowNewPatientSchedule() {
  header("FLUXO 1 — Paciente novo agendando consulta");
  const phone = TEST_PHONE + "1";
  clearConversationState(CLINIC_ID, phone);

  await simulateTurn(phone, "Oi, boa tarde!");
  await simulateTurn(phone, "Quero marcar uma consulta");
  await simulateTurn(phone, "Limpeza dental");
  await simulateTurn(phone, "Tenho Bradesco Dental");
  await simulateTurn(phone, "Pode ser com a Dra. Ana Paula");
  await simulateTurn(phone, "Quarta-feira às 10h");
  await simulateTurn(phone, "Pode confirmar sim");
}

async function testFlowReschedule() {
  header("FLUXO 2 — Paciente remarcando consulta existente");
  const phone = TEST_PHONE + "2";
  clearConversationState(CLINIC_ID, phone);

  const patient = { id: "p-001", name: "Carlos Mendes", phone };

  await simulateTurn(phone, "Olá, preciso remarcar minha consulta", patient);
  await simulateTurn(phone, "Estava marcada para amanhã mas não vou conseguir ir", patient);
  await simulateTurn(phone, "Pode ser na sexta de manhã?", patient);
  await simulateTurn(phone, "Às 9h está ótimo", patient);
  await simulateTurn(phone, "Confirmado", patient);
}

async function testFlowCancel() {
  header("FLUXO 3 — Paciente cancelando consulta");
  const phone = TEST_PHONE + "3";
  clearConversationState(CLINIC_ID, phone);

  const patient = { id: "p-002", name: "Maria Silva", phone };

  await simulateTurn(phone, "Oi, preciso cancelar minha consulta de quinta", patient);
  await simulateTurn(phone, "Tive um compromisso de trabalho", patient);
  await simulateTurn(phone, "Sim, pode cancelar", patient);
}

async function testFlowHandoff() {
  header("FLUXO 4 — Transferência para humano (palavra-chave: urgência)");
  const phone = TEST_PHONE + "4";
  clearConversationState(CLINIC_ID, phone);

  // Simula manualmente o trigger de handoff (sem passar pelo processIncomingMessage)
  const result = await runClinicConversation({
    clinicContext:  { ...MOCK_CLINIC },
    patientContext: null,
    patientMessage: "Estou com urgência, dor forte no dente",
    patientPhone:   phone,
    recentMessages: [],
    stateContext:   buildStateContext(null),
  });

  log("👤 Paciente:", `"Estou com urgência, dor forte no dente"`, colors.yellow);
  log("🤖 IA:", `"${result.reply_to_patient}"`, colors.green);
  log("   intent:", result.intent, colors.gray);
  console.log();
}

async function testFlowFaq() {
  header("FLUXO 5 — Dúvida sobre horários e serviços (FAQ)");
  const phone = TEST_PHONE + "5";
  clearConversationState(CLINIC_ID, phone);

  await simulateTurn(phone, "Quais horários vocês atendem?");
  await simulateTurn(phone, "Vocês fazem clareamento?");
  await simulateTurn(phone, "Aceitam Amil Dental?");
  await simulateTurn(phone, "Quanto tempo dura a limpeza?");
}

async function testFlowInactivePatientReturn() {
  header("FLUXO 6 — IA aborda paciente inativo (simulação de campanha de resgate)");
  const phone = TEST_PHONE + "6";
  clearConversationState(CLINIC_ID, phone);

  const patient = { id: "p-003", name: "Andrea Costa", phone, last_appointment: "2025-11-15" };

  // Simula a IA iniciando a conversa (mensagem proativa)
  await simulateTurn(
    phone,
    "Olá Andrea! Faz 6 meses desde sua última limpeza dental. Temos horários disponíveis essa semana. Deseja agendar?",
    patient
  );
  await simulateTurn(phone, "Sim, tenho interesse!", patient);
  await simulateTurn(phone, "Pode ser quinta-feira à tarde", patient);
  await simulateTurn(phone, "14h está ótimo", patient);
  await simulateTurn(phone, "Perfeito, confirma por favor", patient);
}

async function testFlowOutOfHours() {
  header("FLUXO 7 — Mensagem fora do horário de atendimento");
  const phone = TEST_PHONE + "7";
  clearConversationState(CLINIC_ID, phone);

  // Clínica com horários que excluem o horário atual
  const closedClinic = {
    ...MOCK_CLINIC,
    businessHours: {
      mon: { open: "08:00", close: "09:00", enabled: true }, // Forçado fechado
      tue: { open: "08:00", close: "09:00", enabled: true },
      wed: { open: "08:00", close: "09:00", enabled: true },
      thu: { open: "08:00", close: "09:00", enabled: true },
      fri: { open: "08:00", close: "09:00", enabled: true },
      sat: { enabled: false },
      sun: { enabled: false },
    },
  };

  log("👤 Paciente:", `"Quero marcar consulta agora"`, colors.yellow);
  const result = await runClinicConversation({
    clinicContext:  closedClinic,
    patientContext: null,
    patientMessage: "Quero marcar consulta agora",
    patientPhone:   phone,
    recentMessages: [],
    stateContext:   buildStateContext(null),
  });
  log("🤖 IA:", `"${result.reply_to_patient}"`, colors.green);
  log("   intent:", result.intent, colors.gray);
  console.log();
}

async function testFlowNoInsurance() {
  header("FLUXO 8 — Clínica só particular (sem convênios)");
  const phone = TEST_PHONE + "8";
  clearConversationState(CLINIC_ID, phone);

  const particularClinic = { ...MOCK_CLINIC, insurancePlans: [] };

  await simulateTurn(phone, "Vocês aceitam plano odontológico?");
  // Sobrescreve o contexto com clínica particular
  const result = await runClinicConversation({
    clinicContext:  particularClinic,
    patientContext: null,
    patientMessage: "Vocês aceitam plano odontológico?",
    patientPhone:   phone,
    recentMessages: [],
    stateContext:   buildStateContext(null),
  });
  log("👤 Paciente:", `"Vocês aceitam plano odontológico?"`, colors.yellow);
  log("🤖 IA:", `"${result.reply_to_patient}"`, colors.green);
  log("   intent:", result.intent, colors.gray);
  console.log();
}

async function testFlowConversationContinuity() {
  header("FLUXO 9 — Continuidade: paciente desvia e volta ao agendamento");
  const phone = TEST_PHONE + "9";
  clearConversationState(CLINIC_ID, phone);

  const msgs = [];
  const track = async (msg) => {
    const r = await simulateTurn(phone, msg, null, msgs);
    msgs.push({ direction: "inbound",  message_text: msg });
    msgs.push({ direction: "outbound", message_text: r.reply_to_patient });
    return r;
  };

  await track("Oi");
  await track("Quero marcar uma consulta");
  await track("Pode me falar sobre vocês antes?"); // desvio FAQ
  await track("Ok, voltando: quero agendar limpeza");
  await track("Particular mesmo");
  await track("Qualquer profissional disponível");
  await track("Quinta-feira de manhã");
}

async function testFlowStateReset() {
  header("FLUXO 10 — Reset de estado por inatividade simulada");
  const phone = TEST_PHONE + "10";

  // Seta um estado "antigo" manualmente
  setConversationState(CLINIC_ID, phone, CONV_STATES.CHOOSE_TIME, { specialty: "Limpeza" });

  // Simula TTL expirado alterando o updated_at
  const { dbUpdate } = await import("../src/lib/json-db.js");
  dbUpdate(
    "conversation_states",
    (r) => r.clinic_id === CLINIC_ID && r.phone === phone,
    { updated_at: new Date(Date.now() - 35 * 60 * 1000).toISOString() }
  );

  const state = getConversationState(CLINIC_ID, phone);
  log("Estado após TTL expirado:", state ? state.state : "null (expirado ✓)", colors.green);

  await simulateTurn(phone, "Oi, boa tarde!");
  console.log();
}

// ── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${colors.bold}${colors.cyan}IACLIN — Testes de Simulação de Conversas${colors.reset}`);
  console.log(`${colors.gray}Provider: ${process.env.AI_PROVIDER ?? "gemini"} | Clínica: ${CLINIC_ID}${colors.reset}\n`);

  const tests = [
    { name: "Agendamento novo paciente",  fn: testFlowNewPatientSchedule },
    { name: "Remarcação",                 fn: testFlowReschedule          },
    { name: "Cancelamento",               fn: testFlowCancel              },
    { name: "Handoff urgência",           fn: testFlowHandoff             },
    { name: "FAQ",                        fn: testFlowFaq                 },
    { name: "Resgate de inativo",         fn: testFlowInactivePatientReturn },
    { name: "Fora do horário",            fn: testFlowOutOfHours          },
    { name: "Clínica particular",         fn: testFlowNoInsurance         },
    { name: "Continuidade + desvio",      fn: testFlowConversationContinuity },
    { name: "Reset por inatividade",      fn: testFlowStateReset          },
  ];

  // Permite rodar um fluxo específico: node script.js 3
  const onlyIdx = process.argv[2] ? parseInt(process.argv[2]) - 1 : null;
  const toRun   = onlyIdx !== null ? [tests[onlyIdx]] : tests;

  let passed = 0;
  let failed = 0;

  for (const test of toRun) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      console.error(`${colors.red}✗ FALHOU: ${test.name}${colors.reset}`);
      console.error(err.message);
      failed++;
    }
  }

  console.log(`\n${colors.bold}Resultado: ${colors.green}${passed} passou${colors.reset}${failed > 0 ? ` | ${colors.red}${failed} falhou${colors.reset}` : ""}${colors.reset}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
