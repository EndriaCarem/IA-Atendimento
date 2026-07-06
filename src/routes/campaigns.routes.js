import { Router } from "express";
import {
  listCampaignsController,
  createCampaignController,
  getCampaignController,
  updateCampaignController,
  deleteCampaignController,
  previewCampaignController,
  sendCampaignController,
  estimateRecipientsController,
  getProfessionalsController,
  getSpecialtiesController,
  getProceduresController,
  getInsurancesController,
} from "../controllers/campaigns.controller.js";

const router = Router();

// Listar campanhas
router.get("/clinics/:clinicId/campaigns", listCampaignsController);

// Criar campanha
router.post("/clinics/:clinicId/campaigns", createCampaignController);

// Buscar campanha específica
router.get("/clinics/:clinicId/campaigns/:campaignId", getCampaignController);

// Atualizar campanha (draft only)
router.patch("/clinics/:clinicId/campaigns/:campaignId", updateCampaignController);

// Deletar campanha (draft only)
router.delete("/clinics/:clinicId/campaigns/:campaignId", deleteCampaignController);

// Preview (simular recipients)
router.post("/clinics/:clinicId/campaigns/:campaignId/preview", previewCampaignController);

// Enviar campanha
router.post("/clinics/:clinicId/campaigns/:campaignId/send", sendCampaignController);

// Estimar quantidade de recipients
router.post("/clinics/:clinicId/campaigns/estimate", estimateRecipientsController);

// Dados auxiliares pra filtros
router.get("/clinics/:clinicId/campaigns/data/professionals", getProfessionalsController);
router.get("/clinics/:clinicId/campaigns/data/specialties", getSpecialtiesController);
router.get("/clinics/:clinicId/campaigns/data/procedures", getProceduresController);
router.get("/clinics/:clinicId/campaigns/data/insurances", getInsurancesController);

export default router;
