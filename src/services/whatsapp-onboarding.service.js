import {
  createEvolutionInstance,
  getEvolutionQrCode,
  getEvolutionConnectionState,
  getEvolutionOwnerNumber,
  pingEvolutionConnection,
  setEvolutionWebhook
} from "../lib/evolution-api.js";
import { upsertInstanceMapping, updateInstanceQrCode, findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { logger } from "../lib/logger.js";
import { AppError } from "../utils/http-error.js";

function generateInstanceName(clinicId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).substring(2, 8);
  return `clinic-${clinicId.substring(0, 8)}-${timestamp}-${random}`.toLowerCase();
}

export async function initiateWhatsAppOnboarding({ clinicId, webhookUrl, clinicPhoneNumber = null }) {
  if (!clinicId) {
    throw new AppError("clinic_id is required", 400);
  }

  if (!webhookUrl) {
    throw new AppError("webhook_url is required", 400);
  }

  // -- Reutiliza instância existente se houver mapping no Supabase --
  const existing = await findInstanceByClinicId(clinicId);
  if (existing) {
    logger.info({ clinicId, instanceName: existing.instanceName }, "Reusing existing instance");

    let state = "unknown";
    let instanceMissing = false;
    try {
      const stateResult = await getEvolutionConnectionState(existing.instanceName);
      state = stateResult?.instance?.state ?? "unknown";
    } catch (err) {
      // 404 = a instância não existe mais na Evolution (foi deletada/limpa).
      // Nesse caso NÃO adianta tentar reconectar — precisa recriar do zero.
      if (err?.statusCode === 404 || err?.details?.evolution_status === 404) {
        instanceMissing = true;
        logger.warn({ clinicId, instanceName: existing.instanceName }, "Instância não existe mais na Evolution — recriando do zero");
      } else {
        logger.warn({ err }, "Could not fetch connection state, will generate QR anyway");
      }
    }

    // Instância sumiu da Evolution: recria (cria + webhook + QR) reaproveitando o nome.
    if (instanceMissing) {
      return createAndRegisterInstance({
        clinicId,
        webhookUrl,
        clinicPhoneNumber,
        instanceName: existing.instanceName,
      });
    }

    // O state mente: "open" mesmo após desconexão pelo celular. Só consideramos
    // conectado se a validação ativa (sendPresence) confirmar — senão, seguimos
    // para gerar o QR de reconexão.
    if (state === "open") {
      const selfNumber = await getEvolutionOwnerNumber(existing.instanceName);
      const reallyConnected = selfNumber
        ? await pingEvolutionConnection(existing.instanceName, selfNumber)
        : false;
      if (reallyConnected) {
        return {
          success: true,
          clinic_id: clinicId,
          instance_name: existing.instanceName,
          qr_code: null,
          pairing_code: null,
          qr_code_url: null,
          status: "connected"
        };
      }
      logger.info({ clinicId, instanceName: existing.instanceName }, "State 'open' mas ping falhou — gerando QR de reconexão");
    }

    // Reconecta: busca novo QR da instância existente
    const qrCodeData = await getEvolutionQrCode(existing.instanceName, clinicPhoneNumber);
    const qrCodeUrl = extractQrCodeUrl(qrCodeData);
    if (qrCodeUrl) {
      await updateInstanceQrCode(existing.instanceName, qrCodeUrl).catch(() => {});
    }

    return {
      success: true,
      clinic_id: clinicId,
      instance_name: existing.instanceName,
      qr_code: qrCodeData,
      pairing_code: extractPairingCode(qrCodeData),
      qr_code_url: qrCodeUrl,
      status: "pending_scan"
    };
  }

  // -- Sem instância prévia: cria uma nova --
  return createAndRegisterInstance({ clinicId, webhookUrl, clinicPhoneNumber });
}

// Cria a instância na Evolution (+ webhook + QR) e salva o mapping.
// Reusa o instanceName quando informado (recriação); senão gera um novo.
async function createAndRegisterInstance({ clinicId, webhookUrl, clinicPhoneNumber = null, instanceName: reuseName = null }) {
  let instanceName;
  let createdInEvolution = false;
  let qrCodeData = null;

  try {
    instanceName = reuseName ?? generateInstanceName(clinicId);
    logger.info({ clinicId, instanceName }, "Starting WhatsApp onboarding");

    await createEvolutionInstance({
      instanceName,
      number: clinicPhoneNumber
    });
    createdInEvolution = true;
    logger.info({ instanceName }, "Instance created in Evolution");

    await setEvolutionWebhook({
      instanceName,
      webhookUrl
    });
    logger.info({ instanceName, webhookUrl }, "Webhook configured in Evolution");

    qrCodeData = await getEvolutionQrCode(instanceName, clinicPhoneNumber);
    logger.info({ instanceName }, "QR code retrieved from Evolution");

    const supabaseRecord = await upsertInstanceMapping({
      clinicId,
      instanceName
    });
    logger.info({ clinicId, instanceName }, "Instance mapping saved to Supabase");

    const qrCodeUrl = extractQrCodeUrl(qrCodeData);
    if (qrCodeUrl && supabaseRecord) {
      await updateInstanceQrCode(instanceName, qrCodeUrl);
    }

    return {
      success: true,
      clinic_id: clinicId,
      instance_name: instanceName,
      qr_code: qrCodeData,
      pairing_code: extractPairingCode(qrCodeData),
      qr_code_url: qrCodeUrl,
      status: "pending_scan",
      created_at: supabaseRecord?.createdAt || new Date().toISOString()
    };
  } catch (error) {
    if (createdInEvolution && instanceName) {
      logger.warn(
        { instanceName, error: error.message },
        "Onboarding failed after creating Evolution instance. Manual cleanup may be needed."
      );
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(`WhatsApp onboarding failed: ${error.message}`, 500, {
      instance_name: instanceName,
      created_in_evolution: createdInEvolution
    });
  }
}

function extractPairingCode(qrCodeData) {
  if (!qrCodeData || typeof qrCodeData !== "object") {
    return null;
  }

  return qrCodeData.pairingCode || null;
}

function extractQrCodeUrl(qrCodeData) {
  if (!qrCodeData) {
    return null;
  }

  if (typeof qrCodeData === "object") {
    // Evolution API returns the actual QR image in the 'base64' field
    if (typeof qrCodeData.base64 === "string" && qrCodeData.base64.startsWith("data:image/")) {
      return qrCodeData.base64;
    }
  }

  return null;
}
