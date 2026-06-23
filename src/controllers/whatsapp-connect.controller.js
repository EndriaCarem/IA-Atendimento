import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { initiateWhatsAppOnboarding } from "../services/whatsapp-onboarding.service.js";
import { getLatestQr } from "../services/qr-store.service.js";
import { getEvolutionQrCode, restartEvolutionInstance } from "../lib/evolution-api.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryGetQr(instanceName, attempts, waitMs) {
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await getEvolutionQrCode(instanceName);
      const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null;
      if (typeof base64 === "string" && base64.startsWith("data:image/")) {
        return base64;
      }
    } catch { /* tenta de novo */ }
    await sleep(waitMs);
  }
  return null;
}

// Busca o QR ativamente da Evolution. Se não vier (instância "connecting" ociosa
// que parou de gerar QR após muitas renovações sem scan), REINICIA a instância
// para forçar a Evolution a produzir um QR fresco — evita o usuário ficar preso
// com um QR morto que nunca lê.
async function fetchQrWithRetry(instanceName) {
  let qr = await tryGetQr(instanceName, 3, 1500);
  if (qr) return qr;

  // Fallback: restart força nova sessão/QR.
  try {
    await restartEvolutionInstance(instanceName);
    await sleep(2500);
  } catch { /* segue para a nova tentativa */ }

  return tryGetQr(instanceName, 4, 1800);
}

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
    const isConnected = result?.status === "connected";
    let qr_code = (instanceName ? getLatestQr(instanceName) : null) ?? normalizeQrCode(result);

    // Se ainda não há QR (timing: webhook não emitiu / onboarding sem base64) e
    // a instância NÃO está conectada, busca ativamente da Evolution com retry.
    // Evita o "Não foi possível gerar o QR Code" no painel por corrida.
    if (!qr_code && !isConnected && instanceName) {
      qr_code = await fetchQrWithRetry(instanceName);
    }

    res.status(200).json({
      qr_code,
      instance_name: instanceName,
      status: result?.status ?? "unknown",
      connected: isConnected
    });
  } catch (error) {
    next(error);
  }
}
