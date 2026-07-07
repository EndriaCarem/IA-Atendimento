import { dbFind, dbUpdate, dbFindOne } from "../lib/json-db.js";
import { sendEvolutionTextMessage } from "../lib/evolution.js";
import { sendTwilioSMS } from "../lib/twilio.js";
import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { renderAutomationTemplate } from "./automation-template.service.js";
import { logger } from "../lib/logger.js";

export async function processCampaignDispatches(campaignId) {
  const sends = dbFind("campaign_sends", (s) => s.campaign_id === campaignId);

  logger.info({ campaignId, count: sends.length }, "[DISPATCH] Iniciando");

  let stats = {
    sent_whatsapp: 0,
    sent_sms: 0,
    failed_whatsapp: 0,
    failed_sms: 0,
  };

  for (const send of sends) {
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

    await new Promise((resolve) => setTimeout(resolve, 100));
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

  const text = renderAutomationTemplate(campaign.template, {
    patient_name: send.patient_name ?? patient?.name ?? "Paciente",
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

  logger.info({ sendId: send.id, phone: send.patient_phone }, "[DISPATCH] WhatsApp enviado");
}

async function dispatchSMS(send) {
  const campaign = dbFindOne("campaigns", (c) => c.id === send.campaign_id);
  if (!campaign) throw new Error("Campanha não encontrada");

  const patient = send.patient_id ? dbFindOne("patients", (p) => p.id === send.patient_id) : null;

  const text = renderAutomationTemplate(campaign.template, {
    patient_name: send.patient_name ?? patient?.name ?? "Olá",
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
