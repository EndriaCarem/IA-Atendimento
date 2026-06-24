import { Router } from "express";
import { runAutomationTick } from "../services/automation-scheduler.service.js";
import { handleAppointmentStatusChange } from "../services/automation-hooks.service.js";
import { dbFind } from "../lib/json-db.js";

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

router.post("/test/trigger-rejection", async (req, res) => {
  try {
    const clinic_id = "70c7cf93-42fa-4a0e-980a-d75b89c31c68";
    const rejected = dbFind("synced_appointments",
      (a) => a.clinic_id === clinic_id && a.status === "rejected");

    if (rejected.length === 0) {
      return res.status(404).json({ ok: false, msg: "No rejected appointments" });
    }

    for (const apt of rejected) {
      await handleAppointmentStatusChange({
        clinicId: clinic_id,
        prevStatus: "pending_approval",
        apt
      });
    }

    res.json({ ok: true, msg: `Triggered rejection for ${rejected.length} appointments` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
