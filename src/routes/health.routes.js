import { Router } from "express";
import { runAutomationTick } from "../services/automation-scheduler.service.js";

const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "iaclin-whatsapp-secretary",
    timestamp: new Date().toISOString()
  });
});

router.post("/test/force-automation-tick", async (req, res) => {
  try {
    await runAutomationTick();
    res.json({ ok: true, msg: "Automation tick forced" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
