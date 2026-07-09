import { dbFind, dbUpdate, dbFindOne } from "../lib/json-db.js";
import { sendEvolutionTextMessage } from "../lib/evolution.js";
import { sendTwilioSMS } from "../lib/twilio.js";
import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { insertWhatsAppMessage } from "../repositories/whatsapp-message.repository.js";
import { renderAutomationTemplate } from "./automation-template.service.js";
import { logger } from "../lib/logger.js";

// ── Throttle anti-bloqueio ────────────────────────────────────────────────────
// Disparo em massa rápido demais é o perfil clássico de ban do WhatsApp.
// Cadência humana: delay ALEATÓRIO entre mensagens + pausa longa a cada lote.
// Com os defaults, ~450-900 msgs/hora — 1000 contatos levam ~1h30-2h30.
// Ajustável por env sem redeploy de código.
const MSG_DELAY_MIN_MS = Number(process.env.CAMPAIGN_MSG_DELAY_MIN_MS) || 4000;
const MSG_DELAY_MAX_MS = Number(process.env.CAMPAIGN_MSG_DELAY_MAX_MS) || 8000;
const BATCH_SIZE = Number(process.env.CAMPAIGN_BATCH_SIZE) || 30;
const BATCH_PAUSE_MS = Number(process.env.CAMPAIGN_BATCH_PAUSE_MS) || 4 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  MSG_DELAY_MIN_MS + Math.floor(Math.random() * (MSG_DELAY_MAX_MS - MSG_DELAY_MIN_MS));

/**
 * Retoma campanhas interrompidas (ex: deploy/restart no meio de 1000 envios).
 * Chamado no boot: qualquer campanha "scheduled" com sends pendentes continua
 * de onde parou — os já enviados não repetem (status sent/failed é por send).
 */
export async function resumePendingCampaigns() {
  const stuck = dbFind("campaigns", (c) => c.status === "scheduled");
  for (const campaign of stuck) {
    const pending = dbFind(
      "campaign_sends",
      (s) => s.campaign_id === campaign.id && (s.whatsapp_status === "pending" || s.sms_status === "pending")
    );
    if (pending.length === 0) continue;
    logger.warn(
      { campaignId: campaign.id, pending: pending.length },
      "[DISPATCH] Retomando campanha interrompida (restart no meio do envio)"
    );
    processCampaignDispatches(campaign.id).catch((err) =>
      logger.error({ campaignId: campaign.id, err: err.message }, "[DISPATCH] Falha ao retomar")
    );
  }
}

export async function processCampaignDispatches(campaignId) {
  const sends = dbFind("campaign_sends", (s) => s.campaign_id === campaignId);

  logger.info({ campaignId, count: sends.length }, "[DISPATCH] Iniciando");

  let stats = {
    sent_whatsapp: 0,
    sent_sms: 0,
    failed_whatsapp: 0,
    failed_sms: 0,
  };

  let processed = 0;
  for (const send of sends) {
    // Pula os já resolvidos (permite retomar campanha interrompida sem repetir).
    const hasPending = send.whatsapp_status === "pending" || send.sms_status === "pending";
    if (!hasPending) continue;

    if (send.whatsapp_status === "pending") {
      try {
        await dispatchWhatsApp(send);
        stats.sent_whatsapp++;
      } catch (err) {
        logger.error({ sendId: send.id, error: err.message }, "[DISPATCH] Falha WhatsApp");
        stats.failed_whatsapp++;

        dbUpdate("campaign_sends", (s) => s.id === send.id, {
          whatsapp_status: "failed",
          whatsapp_error: err.message,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (send.sms_status === "pending") {
      try {
        await dispatchSMS(send);
        stats.sent_sms++;
      } catch (err) {
        logger.error({ sendId: send.id, error: err.message }, "[DISPATCH] Falha SMS");
        stats.failed_sms++;

        dbUpdate("campaign_sends", (s) => s.id === send.id, {
          sms_status: "failed",
          sms_error: err.message,
          updated_at: new Date().toISOString(),
        });
      }
    }

    processed++;

    // Cadência anti-ban: pausa longa a cada lote, delay aleatório entre msgs.
    if (processed % BATCH_SIZE === 0) {
      logger.info(
        { campaignId, processed, total: sends.length, pauseMin: Math.round(BATCH_PAUSE_MS / 60000) },
        "[DISPATCH] Lote concluído — pausa anti-bloqueio"
      );
      await sleep(BATCH_PAUSE_MS);
    } else {
      await sleep(randomDelay());
    }
  }

  const campaign = dbFindOne("campaigns", (c) => c.id === campaignId);
  if (campaign) {
    dbUpdate("campaigns", (c) => c.id === campaignId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      "stats.sent_whatsapp": campaign.stats.sent_whatsapp + stats.sent_whatsapp,
      "stats.sent_sms": campaign.stats.sent_sms + stats.sent_sms,
      "stats.failed_whatsapp": campaign.stats.failed_whatsapp + stats.failed_whatsapp,
      "stats.failed_sms": campaign.stats.failed_sms + stats.failed_sms,
    });
  }

  logger.info({ campaignId, stats }, "[DISPATCH] Concluído");
  return stats;
}

async function dispatchWhatsApp(send) {
  const campaign = dbFindOne("campaigns", (c) => c.id === send.campaign_id);
  if (!campaign) throw new Error("Campanha não encontrada");

  const mapping = await findInstanceByClinicId(send.clinic_id);
  if (!mapping?.instanceName) {
    throw new Error("WhatsApp não conectado");
  }

  // Nome salvo no próprio send (resolvido do Supabase). Fallback: JSON-db local.
  const patient = send.patient_id ? dbFindOne("patients", (p) => p.id === send.patient_id) : null;
  const clinic = dbFindOne("clinics", (c) => c.id === send.clinic_id);

  const text = renderAutomationTemplate(campaign.template, {
    patient_name: send.patient_name ?? patient?.name ?? "Paciente",
    clinic_name: clinic?.name ?? clinic?.clinic_name ?? "",
  });

  await sendEvolutionTextMessage({
    instanceName: mapping.instanceName,
    number: send.patient_phone,
    text,
  });

  dbUpdate("campaign_sends", (s) => s.id === send.id, {
    whatsapp_status: "sent",
    whatsapp_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Registra a mensagem da campanha no histórico da conversa para que a IA
  // saiba o que ELA enviou. Sem isso, quando o paciente responde ("quero"),
  // a IA trata como conversa nova e não conecta com a campanha.
  try {
    await insertWhatsAppMessage({
      clinicId: send.clinic_id,
      patientPhone: send.patient_phone,
      patientName: send.patient_name ?? patient?.name ?? null,
      direction: "outbound",
      text,
      instanceName: mapping.instanceName,
      aiHandled: false,
      metadata: {
        source: "campaign",
        campaign_id: send.campaign_id,
        delivery_status: "sent",
      },
    });
  } catch (err) {
    logger.warn({ sendId: send.id, err: err.message }, "[DISPATCH] Falha ao registrar msg da campanha no histórico");
  }

  logger.info({ sendId: send.id, phone: send.patient_phone }, "[DISPATCH] WhatsApp enviado");
}

async function dispatchSMS(send) {
  const campaign = dbFindOne("campaigns", (c) => c.id === send.campaign_id);
  if (!campaign) throw new Error("Campanha não encontrada");

  const patient = send.patient_id ? dbFindOne("patients", (p) => p.id === send.patient_id) : null;
  const clinic = dbFindOne("clinics", (c) => c.id === send.clinic_id);

  const text = renderAutomationTemplate(campaign.template, {
    patient_name: send.patient_name ?? patient?.name ?? "Olá",
    clinic_name: clinic?.name ?? clinic?.clinic_name ?? "",
  });

  await sendTwilioSMS({
    to: send.patient_phone,
    body: text,
  });

  dbUpdate("campaign_sends", (s) => s.id === send.id, {
    sms_status: "sent",
    sms_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  logger.info({ sendId: send.id, phone: send.patient_phone }, "[DISPATCH] SMS enviado");
}
