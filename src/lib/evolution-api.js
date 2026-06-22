import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { AppError } from "../utils/http-error.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const DEFAULT_WEBHOOK_EVENTS = [
  "APPLICATION_STARTUP",
  "QRCODE_UPDATED",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE"
];

async function retryWithBackoff(fn, attempt = 1) {
  try {
    return await fn();
  } catch (error) {
    if (attempt < MAX_RETRIES && shouldRetry(error)) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, attempt + 1);
    }
    throw error;
  }
}

function shouldRetry(error) {
  const message = String(error.message || "").toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("aborted") ||
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

async function evolutionApiRequest(path, options = {}) {
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) {
    throw new AppError("Evolution API not configured", 500);
  }

  const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(15000)
  });

  const contentType = response.headers.get("content-type") || "";
  const body =
    contentType.includes("application/json") && response.status !== 204
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      typeof body === "object" && body
        ? body?.error?.message || body?.message || `HTTP ${response.status}`
        : typeof body === "string" && body.length > 0
          ? body
          : `HTTP ${response.status}`;

    throw new AppError(`Evolution API error: ${errorMessage}`, response.status, {
      evolution_status: response.status,
      path
    });
  }

  return body;
}

export async function createEvolutionInstance({
  instanceName,
  integration = "WHATSAPP-BAILEYS",
  token = "",
  qrcode = false,
  number = null
}) {
  return retryWithBackoff(async () => {
    const payload = {
      instanceName,
      integration,
      token,
      qrcode
    };

    if (number) {
      payload.number = number;
    }

    const response = await evolutionApiRequest("/instance/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    logger.info({ instanceName }, "Evolution instance created");
    return response;
  });
}

export async function setEvolutionWebhook({
  instanceName,
  webhookUrl,
  enabled = true,
  webhookByEvents = true,
  webhookBase64 = true,
  events = DEFAULT_WEBHOOK_EVENTS
}) {
  if (!webhookUrl) {
    throw new AppError("webhook_url is required to set Evolution webhook", 400);
  }

  return retryWithBackoff(async () => {
    const response = await evolutionApiRequest(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled,
          url: webhookUrl,
          byEvents: webhookByEvents,
          base64: webhookBase64,
          events
        }
      })
    });

    logger.info({ instanceName, webhookUrl }, "Evolution webhook configured");
    return response;
  });
}

export async function getEvolutionWebhook(instanceName) {
  return retryWithBackoff(async () => {
    return evolutionApiRequest(`/webhook/find/${encodeURIComponent(instanceName)}`, {
      method: "GET"
    });
  });
}

export async function getEvolutionQrCode(instanceName, number = null) {
  return retryWithBackoff(async () => {
    const query = number ? `?number=${encodeURIComponent(number)}` : "";
    const response = await evolutionApiRequest(
      `/instance/connect/${encodeURIComponent(instanceName)}${query}`,
      {
        method: "GET"
      }
    );

    logger.info({ instanceName }, "Evolution QR code retrieved");
    return response;
  });
}

export async function sendEvolutionTextMessage({ instanceName, number, text }) {
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) {
    logger.info(
      {
        instanceName,
        number
      },
      "Evolution integration disabled. Skipping outgoing WhatsApp message."
    );
    return { skipped: true };
  }

  return retryWithBackoff(async () => {
    const payload = {
      number,
      text,
      delay: 500
    };

    const response = await evolutionApiRequest(
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

    logger.info({ instanceName, number }, "WhatsApp message sent");
    return response;
  });
}

export async function getEvolutionInstanceStatus(instanceName) {
  return retryWithBackoff(async () => {
    return evolutionApiRequest(`/instance/info/${encodeURIComponent(instanceName)}`, {
      method: "GET"
    });
  });
}

export async function getEvolutionConnectionState(instanceName) {
  return retryWithBackoff(async () => {
    return evolutionApiRequest(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      method: "GET"
    });
  });
}

// Retorna o número (somente dígitos) dono da instância, a partir do ownerJid.
// Necessário para o ping de validação (sendPresence exige um número).
export async function getEvolutionOwnerNumber(instanceName) {
  try {
    const data = await evolutionApiRequest(
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
      { method: "GET" }
    );
    const inst = Array.isArray(data) ? data[0] : data;
    const jid = inst?.ownerJid ?? inst?.owner ?? null;
    return jid ? String(jid).split("@")[0] : null;
  } catch {
    return null;
  }
}

/**
 * Valida ATIVAMENTE se a instância está conectada de verdade.
 * connectionState/fetchInstances retornam "open" mesmo após desconexão pelo
 * celular (mentem). Já uma operação real como sendPresence falha com
 * "Connection Closed" quando o WhatsApp não está realmente conectado.
 * Retorna true só se a operação for aceita. Não lança — qualquer falha = offline.
 */
export async function pingEvolutionConnection(instanceName, selfNumber) {
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) return false;
  try {
    const baseUrl = env.EVOLUTION_API_URL.replace(/\/$/, "");
    const response = await fetch(
      `${baseUrl}/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: env.EVOLUTION_API_KEY },
        body: JSON.stringify({ number: selfNumber, presence: "available", delay: 100 })
      }
    );
    // 2xx = conexão real funcionando. 400 "Connection Closed" = offline.
    return response.ok;
  } catch {
    return false;
  }
}

export async function logoutEvolutionInstance(instanceName) {
  return retryWithBackoff(async () => {
    return evolutionApiRequest(`/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE"
    });
  });
}
