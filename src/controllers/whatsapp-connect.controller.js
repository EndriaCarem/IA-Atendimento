import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { initiateWhatsAppOnboarding } from "../services/whatsapp-onboarding.service.js";
import { getLatestQr } from "../services/qr-store.service.js";

function normalizeQrCode(result) {
  if (!result) {
    return null;
  }

  // qr_code_url is the extracted data:image/png;base64,... string
  if (typeof result.qr_code_url === "string" && result.qr_code_url.startsWith("data:image/")) {
    return result.qr_code_url;
  }

  // qr_code may be the raw Evolution object with a base64 field
  if (
    result.qr_code &&
    typeof result.qr_code === "object" &&
    typeof result.qr_code.base64 === "string" &&
    result.qr_code.base64.startsWith("data:image/")
  ) {
    return result.qr_code.base64;
  }

  // qr_code as direct data URL string
  if (typeof result.qr_code === "string" && result.qr_code.startsWith("data:image/")) {
    return result.qr_code;
  }

  return null;
}

export async function connectWhatsAppController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { clinic_phone_number } = req.body ?? {};

    if (!clinicId) {
      res.status(400).json({
        error: "clinic_id is required",
        code: "CLINIC_ID_MISSING"
      });
      return;
    }

    // Use the PUBLIC_BACKEND_URL env var if available, otherwise derive from request
    const baseUrl = env.PUBLIC_BACKEND_URL ??
      `${req.protocol}://${req.get("host")}`;
    const webhook_url = `${baseUrl}/webhooks/evolution`;

    const result = await initiateWhatsAppOnboarding({
      clinicId,
      webhookUrl: webhook_url,
      clinicPhoneNumber: clinic_phone_number || null
    });

    logger.info({ clinicId }, "WhatsApp connection initiated successfully");

    // Prefere o QR mais RECENTE capturado via webhook (qrcode.updated), que é o
    // válido no momento. Cai para o QR do onboarding se não houver um fresco.
    const instanceName = result?.instance_name ?? null;
    const freshQr = instanceName ? getLatestQr(instanceName) : null;
    const qr_code = freshQr ?? normalizeQrCode(result);

    res.status(200).json({
      qr_code,
      instance_name: instanceName,
      status: result?.status ?? "unknown",
      connected: result?.status === "connected"
    });
  } catch (error) {
    next(error);
  }
}
