import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  prepareCampaignForSend,
  previewCampaign,
} from "../services/campaigns.service.js";
import { processCampaignDispatches } from "../services/campaign-dispatcher.service.js";
import { logger } from "../lib/logger.js";

export function listCampaignsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { status } = req.query;

    const campaigns = listCampaigns(clinicId, { status });
    res.json({ ok: true, data: campaigns });
  } catch (err) {
    next(err);
  }
}

export function createCampaignController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const body = req.body ?? {};

    const campaign = createCampaign(clinicId, body);
    res.status(201).json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export function getCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const campaign = getCampaignById(campaignId, clinicId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: "Campanha não encontrada" });
    }

    res.json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export function updateCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;
    const body = req.body ?? {};

    const campaign = updateCampaign(campaignId, clinicId, body);
    res.json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export function deleteCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    deleteCampaign(campaignId, clinicId);
    res.json({ ok: true, msg: "Campanha deletada" });
  } catch (err) {
    next(err);
  }
}

export function previewCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const preview = previewCampaign(campaignId, clinicId);
    res.json({ ok: true, data: preview });
  } catch (err) {
    next(err);
  }
}

export function sendCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const result = prepareCampaignForSend(campaignId, clinicId);

    // Disparar em background (não bloqueia resposta)
    setImmediate(async () => {
      try {
        await processCampaignDispatches(campaignId);
      } catch (err) {
        logger.error({ campaignId, err: err.message }, "[CAMPAIGN] Erro ao processar");
      }
    });

    res.json({
      ok: true,
      msg: "Campanha iniciando envio",
      data: {
        campaign_id: campaignId,
        recipients: result.recipients,
        channels: result.campaign.channels,
      },
    });
  } catch (err) {
    next(err);
  }
}
