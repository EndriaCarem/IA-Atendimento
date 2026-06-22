import { Router } from "express";
import { connectWhatsAppController } from "../controllers/whatsapp-connect.controller.js";
import { disconnectWhatsAppController } from "../controllers/whatsapp-disconnect.controller.js";
import { whatsAppStatusController } from "../controllers/whatsapp-status.controller.js";
import { testConversationController } from "../controllers/conversation-test.controller.js";

const router = Router();

router.get("/clinics/:clinicId/whatsapp/status", whatsAppStatusController);
router.post("/clinics/:clinicId/whatsapp/connect", connectWhatsAppController);
router.delete("/clinics/:clinicId/whatsapp/disconnect", disconnectWhatsAppController);
router.post("/clinics/:clinicId/conversation/test", testConversationController);

export default router;
