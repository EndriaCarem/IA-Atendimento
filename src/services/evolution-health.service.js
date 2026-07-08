/**
 * Health-monitor das conexões Evolution (versão refinada 2026-06-12).
 *
 * Problema que resolve: a sessão do WhatsApp pode cair (rede, sessão expirada,
 * connectionReplaced 440). Quando isso vira "open zumbi" (estado open mas sem
 * receber eventos), o atendimento para sem ninguém saber. Em produção não pode
 * depender de restart manual.
 *
 * Recuperação SEGURA (não afeta outras clínicas):
 *   - "open" sem eventos há > SILENCE_THRESHOLD é só SUSPEITA de zumbi: conexão
 *     OCIOSA (ninguém mandando mensagem) também não gera evento nenhum. Antes de
 *     agir, faz um PROBE ATIVO (sendPresence): se responde, está viva — não mexe
 *     e renova o heartbeat.
 *   - Só se o probe FALHAR: RESTART da instância (preserva a sessão/credenciais;
 *     reconecta sozinho SEM QR). NUNCA logout automático — logout destrói as
 *     credenciais e derruba sessão saudável exigindo re-scan (bug 2026-07-08:
 *     12 logouts indevidos em sessões apenas ociosas, "cai toda hora").
 *   - Limita a MAX_ATTEMPTS por instância: depois disso, PARA e só ALERTA.
 *   - NÃO reinicia o container (afeta todas as clínicas).
 *   - Estado "close"/"connecting": não age (pode ser desconexão proposital
 *     aguardando QR manual no painel).
 *
 * Lições anteriores: connect cego a cada tick não destrava zumbi e derrubava
 * sessão recém-pareada; logout+connect derrubava sessões vivas ociosas.
 */

import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { listAllInstances } from "../repositories/clinic.repository.js";
import {
  getEvolutionConnectionState,
  getEvolutionOwnerNumber,
  pingEvolutionConnection,
  restartEvolutionInstance,
} from "../lib/evolution-api.js";
import { getLastEventAt, recordInstanceEvent } from "./evolution-heartbeat.service.js";

const CHECK_INTERVAL_MS = 3 * 60 * 1000;      // roda a cada 3 min
const SILENCE_THRESHOLD_MS = 10 * 60 * 1000;  // 10 min "open" sem eventos = SUSPEITA (probe decide)
const WARMUP_MS = 90 * 1000;                  // espera o servidor estabilizar
const COOLDOWN_MS = 8 * 60 * 1000;            // mínimo entre recuperações da mesma instância
const MAX_ATTEMPTS = 3;                        // após isso, só alerta (precisa QR manual)

function extractState(stateResponse) {
  return stateResponse?.instance?.state ?? stateResponse?.state ?? null;
}

// Estado de recuperação por instância: { lastAttempt, attempts }
const recovery = new Map();

async function tryRecover(instanceName, motivo) {
  const r = recovery.get(instanceName) ?? { lastAttempt: 0, attempts: 0 };

  if (Date.now() - r.lastAttempt < COOLDOWN_MS) {
    return; // em cooldown
  }

  // Esgotou as tentativas → para de tentar e só alerta (precisa QR manual).
  if (r.attempts >= MAX_ATTEMPTS) {
    logger.error(
      { instanceName, attempts: r.attempts, motivo },
      "[HEALTH] ALERTA: instância não recuperou após várias tentativas — reconecte pelo painel (QR)"
    );
    return;
  }

  r.lastAttempt = Date.now();
  r.attempts += 1;
  recovery.set(instanceName, r);

  logger.warn({ instanceName, motivo, tentativa: r.attempts }, "[HEALTH] ALERTA: recuperando instância (restart, preserva sessão)");
  try {
    // RESTART reinicia o socket preservando as credenciais da sessão — a
    // instância reconecta sozinha, SEM pedir QR. (Logout automático é proibido:
    // destruía a sessão e obrigava re-scan toda vez que ficava ociosa.)
    await restartEvolutionInstance(instanceName);
    logger.warn({ instanceName, tentativa: r.attempts }, "[HEALTH] Restart disparado — aguardando instância reconectar");
  } catch (err) {
    logger.error({ instanceName, err: err?.message }, "[HEALTH] ALERTA: falha ao recuperar instância");
  }
}

// Quando a instância volta a receber eventos, zera o contador de tentativas.
function markHealthy(instanceName) {
  if (recovery.has(instanceName)) recovery.delete(instanceName);
}

async function checkInstance(instance) {
  const { instanceName } = instance;
  let state;
  try {
    state = extractState(await getEvolutionConnectionState(instanceName));
  } catch (err) {
    logger.error({ instanceName, err: err?.message }, "[HEALTH] Falha ao consultar connectionState");
    return;
  }

  // close/connecting/desconhecido: não age. Pode ser desconexão proposital
  // aguardando QR manual no painel — não insistir.
  if (state !== "open") {
    return;
  }

  const lastEventAt = getLastEventAt(instanceName);
  if (lastEventAt === null) {
    // Sem heartbeat ainda (subiu há pouco). Aguarda próximo tick.
    return;
  }

  const silenceMs = Date.now() - lastEventAt;
  if (silenceMs > SILENCE_THRESHOLD_MS) {
    // Silêncio NÃO prova que caiu — conexão ociosa também fica muda. Probe
    // ativo (sendPresence) decide: se responde, está viva; renova o heartbeat
    // pra não re-testar a cada tick.
    const selfNumber = await getEvolutionOwnerNumber(instanceName);
    const alive = selfNumber
      ? await pingEvolutionConnection(instanceName, selfNumber)
      : false;

    if (alive) {
      recordInstanceEvent(instanceName);
      markHealthy(instanceName);
      logger.info(
        { instanceName, silenceSec: Math.round(silenceMs / 1000) },
        "[HEALTH] Ociosa mas viva (probe ok) — nada a fazer"
      );
      return;
    }

    await tryRecover(instanceName, `open sem eventos ha ${Math.round(silenceMs / 1000)}s e probe falhou`);
  } else {
    // Está recebendo eventos = saudável. Zera tentativas.
    markHealthy(instanceName);
  }
}

async function tick() {
  try {
    const instances = await listAllInstances();
    for (const instance of instances) {
      await checkInstance(instance);
    }
  } catch (err) {
    logger.error({ err: err?.message }, "[HEALTH] Erro no tick do health-monitor");
  }
}

let timer = null;

export function startEvolutionHealthMonitor() {
  if (timer) return;
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) {
    logger.info("[HEALTH] Evolution não configurado — health-monitor não iniciado");
    return;
  }
  logger.info(
    { checkIntervalMs: CHECK_INTERVAL_MS, silenceThresholdMs: SILENCE_THRESHOLD_MS, maxAttempts: MAX_ATTEMPTS },
    "[HEALTH] Health-monitor (refinado) iniciado"
  );
  setTimeout(() => {
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
  }, WARMUP_MS);
}

export function stopEvolutionHealthMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export { tick as runHealthTick };
