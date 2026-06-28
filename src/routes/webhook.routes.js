import { Router } from "express";
import { evolutionWebhookController } from "../controllers/evolution-webhook.controller.js";
import { webhookAuthMiddleware } from "../middleware/webhook-auth.js";

const router = Router();

router.post("/evolution", webhookAuthMiddleware, evolutionWebhookController);
router.post("/evolution/:event", webhookAuthMiddleware, evolutionWebhookController);

export default router;
