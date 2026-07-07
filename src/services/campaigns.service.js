import { dbFind, dbFindOne, dbInsert, dbUpdate } from "../lib/json-db.js";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

export function createCampaign(clinicId, payload) {
  const {
    name,
    description,
    template,
    channels = ["whatsapp"],
    filters = {},
    recipients = null,
    audience_type = null,
    scheduled_for = null,
    timezone = "America/Sao_Paulo",
  } = payload;

  if (!template || template.trim().length === 0) {
    throw new Error("Template obrigatório");
  }

  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("Mínimo 1 canal (whatsapp ou sms)");
  }

  const validChannels = ["whatsapp", "sms"];
  if (!channels.every((c) => validChannels.includes(c))) {
    throw new Error(`Canais válidos: ${validChannels.join(", ")}`);
  }

  const campaign = {
    id: randomUUID(),
    clinic_id: clinicId,
    name: name ?? "Sem nome",
    description: description ?? null,
    template,
    channels,
    filters: {
      patient_type: filters.patient_type ?? "all",
      last_visit_days: filters.last_visit_days ?? null,
      procedures: filters.procedures ?? null,
      insurance_plan: filters.insurance_plan ?? null,
    },
    audience_type: audience_type ?? null,
    // Lista de destinatários resolvida pelo front (Supabase = base real).
    // Cada item: { patient_id, phone, name }. Quando presente, o envio usa
    // ela direto; senão cai no filtro do JSON-db (retrocompatível).
    recipients: Array.isArray(recipients)
      ? recipients
          .filter((r) => r && r.phone)
          .map((r) => ({
            patient_id: r.patient_id ?? r.id ?? null,
            phone: r.phone,
            name: r.name ?? r.full_name ?? null,
          }))
      : null,
    scheduled_for,
    timezone,
    status: "draft",
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    stats: {
      total_recipients: 0,
      sent_whatsapp: 0,
      sent_sms: 0,
      failed_whatsapp: 0,
      failed_sms: 0,
      bounced: 0,
    },
  };

  dbInsert("campaigns", campaign);
  logger.info({ clinicId, campaignId: campaign.id }, "[CAMPAIGN] Criada");
  return campaign;
}

export function listCampaigns(clinicId, filters = {}) {
  const { status = null } = filters;

  let records = dbFind("campaigns", (c) => c.clinic_id === clinicId);

  if (status) {
    records = records.filter((c) => c.status === status);
  }

  return records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function getCampaignById(campaignId, clinicId) {
  return dbFindOne("campaigns", (c) => c.id === campaignId && c.clinic_id === clinicId);
}

export function updateCampaign(campaignId, clinicId, payload) {
  const campaign = getCampaignById(campaignId, clinicId);

  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error(`Não pode editar campanha em status ${campaign.status}`);
  }

  const updates = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.template !== undefined) updates.template = payload.template;
  if (payload.channels !== undefined) updates.channels = payload.channels;
  if (payload.filters !== undefined) updates.filters = payload.filters;
  if (payload.scheduled_for !== undefined) updates.scheduled_for = payload.scheduled_for;

  dbUpdate("campaigns", (c) => c.id === campaignId, updates);

  logger.info({ clinicId, campaignId }, "[CAMPAIGN] Atualizada");
  return { ...campaign, ...updates };
}

export function deleteCampaign(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);

  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error(`Não pode deletar campanha em status ${campaign.status}`);
  }

  logger.info({ clinicId, campaignId }, "[CAMPAIGN] Deletada");
}

export function getFilteredPatients(clinicId, filters) {
  let patients = dbFind("patients", (p) => p.clinic_id === clinicId);

  if (filters.patient_type === "returning") {
    patients = patients.filter((p) => {
      const apts = dbFind(
        "synced_appointments",
        (a) =>
          a.patient_id === p.id &&
          ["completed", "realizada", "confirmed", "confirmada"].includes(a.status)
      );
      return apts.length > 0;
    });
  }

  if (filters.patient_type === "new") {
    patients = patients.filter((p) => {
      const apts = dbFind(
        "synced_appointments",
        (a) =>
          a.patient_id === p.id &&
          ["completed", "realizada", "confirmed", "confirmada"].includes(a.status)
      );
      return apts.length === 0;
    });
  }

  if (filters.last_visit_days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.last_visit_days);

    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments", (a) => a.patient_id === p.id && new Date(a.start_time) >= cutoffDate);
      return apts.length > 0;
    });
  }

  if (filters.procedures && Array.isArray(filters.procedures)) {
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments", (a) => a.patient_id === p.id && filters.procedures.includes(a.procedure));
      return apts.length > 0;
    });
  }

  if (filters.insurance_plan) {
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments", (a) => a.patient_id === p.id && a.insurance_plan === filters.insurance_plan);
      return apts.length > 0;
    });
  }

  return patients;
}

export function previewCampaign(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);

  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  const patients = getFilteredPatients(clinicId, campaign.filters);

  return {
    campaign_name: campaign.name,
    channels: campaign.channels,
    filters_applied: campaign.filters,
    total_recipients: patients.length,
    sample_recipients: patients.slice(0, 5).map((p) => ({
      patient_id: p.id,
      name: p.name,
      phone: p.phone,
    })),
  };
}

/**
 * Materializa no JSON-db uma campanha que nasceu no Supabase (front novo).
 * O front cria a campanha + destinatários no Supabase e só chama /send com
 * { campaign_id, template, channels, recipients }. Como o disparo (Evolution)
 * roda aqui, precisamos de um registro local para o pipeline de campaign_sends.
 * Idempotente: se já existe (mesmo id), não duplica.
 */
export function ensureCampaignFromPayload(clinicId, payload) {
  const { campaign_id, template, channels = ["whatsapp"], recipients = [], name = null } = payload;

  if (!campaign_id) throw new Error("campaign_id obrigatório");
  if (!template || template.trim().length === 0) throw new Error("Template obrigatório");

  const existing = dbFindOne("campaigns", (c) => c.id === campaign_id);
  if (existing) return existing;

  const campaign = {
    id: campaign_id,
    clinic_id: clinicId,
    name: name ?? "Campanha",
    description: null,
    template,
    channels,
    filters: {},
    audience_type: payload.audience_type ?? null,
    recipients: Array.isArray(recipients)
      ? recipients
          .filter((r) => r && r.phone)
          .map((r) => ({
            patient_id: r.patient_id ?? r.id ?? null,
            phone: r.phone,
            name: r.name ?? r.full_name ?? null,
          }))
      : [],
    scheduled_for: null,
    timezone: "America/Sao_Paulo",
    status: "draft",
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    stats: { total_recipients: 0, sent_whatsapp: 0, sent_sms: 0, failed_whatsapp: 0, failed_sms: 0, bounced: 0 },
    source: "supabase",
  };

  dbInsert("campaigns", campaign);
  logger.info({ clinicId, campaignId: campaign_id, recipients: campaign.recipients.length }, "[CAMPAIGN] Materializada do Supabase");
  return campaign;
}

export function prepareCampaignForSend(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);

  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error("Campanha deve estar em draft para preparar envio");
  }

  // Prioriza a lista de destinatários resolvida pelo front (base real do
  // Supabase). Fallback: filtro do JSON-db local (campanhas antigas / IA).
  const patients = Array.isArray(campaign.recipients) && campaign.recipients.length > 0
    ? campaign.recipients
    : getFilteredPatients(clinicId, campaign.filters);

  const sends = [];
  for (const patient of patients) {
    for (const channel of campaign.channels) {
      const send = {
        id: randomUUID(),
        campaign_id: campaignId,
        clinic_id: clinicId,
        patient_id: patient.patient_id ?? patient.id ?? null,
        patient_name: patient.name ?? patient.full_name ?? null,
        patient_phone: patient.phone,

        whatsapp_status: channel === "whatsapp" ? "pending" : "skipped",
        whatsapp_sent_at: null,
        whatsapp_error: null,

        sms_status: channel === "sms" ? "pending" : "skipped",
        sms_sent_at: null,
        sms_error: null,

        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      dbInsert("campaign_sends", send);
      sends.push(send);
    }
  }

  dbUpdate("campaigns", (c) => c.id === campaignId, {
    status: "scheduled",
    started_at: new Date().toISOString(),
    "stats.total_recipients": patients.length,
  });

  logger.info({ clinicId, campaignId, recipients: patients.length }, "[CAMPAIGN] Preparada para envio");

  return { campaign, recipients: patients.length, sends };
}

/**
 * Dado um conjunto de telefones e a data de envio da campanha, retorna quais
 * responderam DEPOIS de receber (mensagem inbound após sent_at). Usado pelo
 * painel de histórico para marcar "respondeu: sim/não" por destinatário.
 * A campanha vive no Supabase, então o front manda a lista { phone, sent_at }.
 */
export function getCampaignReplies(clinicId, recipients = []) {
  if (!clinicId || !Array.isArray(recipients)) return {};

  const result = {};
  for (const r of recipients) {
    const phone = String(r.phone ?? "").replace(/\D/g, "");
    if (!phone) continue;
    const since = r.sent_at ? new Date(r.sent_at).getTime() : 0;

    const replies = dbFind(
      "whatsapp_messages",
      (m) =>
        m.clinic_id === clinicId &&
        m.direction === "inbound" &&
        String(m.patient_phone ?? "").replace(/\D/g, "").endsWith(phone.slice(-8)) &&
        new Date(m.created_at).getTime() >= since
    );

    result[r.phone] = {
      replied: replies.length > 0,
      reply_count: replies.length,
      last_reply_at: replies.length
        ? replies.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].created_at
        : null,
    };
  }
  return result;
}
