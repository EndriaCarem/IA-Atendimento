import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { logoutEvolutionInstance } from "../lib/evolution-api.js";
import { logger } from "../lib/logger.js";

export async function disconnectWhatsAppController(req, res, next) {
  try {
    const { clinicId } = req.params;

    const mapping = await findInstanceByClinicId(clinicId);
    if (!mapping) {
      return res.status(404).json({
        error: "WhatsApp instance not found for this clinic",
        code: "INSTANCE_NOT_FOUND"
      });
    }

    try {
      await logoutEvolutionInstance(mapping.instanceName);
      logger.info({ clinicId, instanceName: mapping.instanceName }, "WhatsApp instance logged out");
    } catch (err) {
      // If Evolution returns 404 the instance is already disconnected — treat as success
      if (err?.statusCode === 404 || String(err?.message).includes("404")) {
        logger.warn({ clinicId }, "Instance already disconnected (404 from Evolution)");
      } else {
        throw err;
      }
    }

    return res.status(200).json({
      disconnected: true,
      instance_name: mapping.instanceName
    });
  } catch (err) {
    next(err);
  }
}
