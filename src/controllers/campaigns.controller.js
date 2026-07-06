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

// Estimar quantidade de recipients baseado em filtros
export function estimateRecipientsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { audience_type, filters } = req.body;

    // TODO: Implementar lógica de estimativa real baseada em audience_type e filters
    // Por enquanto retorna contagem fake
    const estimates = {
      all: 542,
      active: 437,
      inactive: 105,
      scheduled: 23,
      absent: 198,
      birthday: 12,
      private: 234,
      insurance: 308,
      manual: 0,
    };

    const count = estimates[audience_type] || 0;

    logger.info(`[CAMPAIGNS] Estimativa de recipients`, {
      clinicId,
      audience_type,
      filters,
      count,
    });

    res.json({ ok: true, data: { count } });
  } catch (err) {
    next(err);
  }
}

// Buscar profissionais da clínica
export function getProfessionalsController(req, res, next) {
  try {
    const { clinicId } = req.params;

    // TODO: Buscar de verdade no banco de dados da clínica
    const professionals = [
      { id: 'prof-1', name: 'Dra. Maria Silva' },
      { id: 'prof-2', name: 'Dr. João Costa' },
      { id: 'prof-3', name: 'Dra. Ana Santos' },
    ];

    res.json({ ok: true, data: professionals });
  } catch (err) {
    next(err);
  }
}

// Buscar especialidades
export function getSpecialtiesController(req, res, next) {
  try {
    const { clinicId } = req.params;

    // TODO: Buscar de verdade
    const specialties = [
      { id: 'spec-1', name: 'Odontologia Geral' },
      { id: 'spec-2', name: 'Ortodontia' },
      { id: 'spec-3', name: 'Implantodontia' },
      { id: 'spec-4', name: 'Estética' },
    ];

    res.json({ ok: true, data: specialties });
  } catch (err) {
    next(err);
  }
}

// Buscar procedimentos
export function getProceduresController(req, res, next) {
  try {
    const { clinicId } = req.params;

    // TODO: Buscar de verdade
    const procedures = [
      { id: 'proc-1', name: 'Limpeza' },
      { id: 'proc-2', name: 'Clareamento' },
      { id: 'proc-3', name: 'Restauração' },
      { id: 'proc-4', name: 'Extração' },
      { id: 'proc-5', name: 'Implante' },
    ];

    res.json({ ok: true, data: procedures });
  } catch (err) {
    next(err);
  }
}

// Buscar convênios
export function getInsurancesController(req, res, next) {
  try {
    const { clinicId } = req.params;

    // TODO: Buscar de verdade
    const insurances = [
      { id: 'ins-1', name: 'Unimed' },
      { id: 'ins-2', name: 'Bradesco Saúde' },
      { id: 'ins-3', name: 'Amil' },
      { id: 'ins-4', name: 'Sulamerica' },
    ];

    res.json({ ok: true, data: insurances });
  } catch (err) {
    next(err);
  }
}
