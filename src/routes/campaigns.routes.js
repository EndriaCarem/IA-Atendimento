import { Router } from "express";
import {
  listCampaignsController,
  createCampaignController,
  getCampaignController,
  updateCampaignController,
  deleteCampaignController,
  previewCampaignController,
  sendCampaignController,
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

export default router;
