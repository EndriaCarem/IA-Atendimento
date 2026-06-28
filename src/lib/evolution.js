import { env } from "../config/env.js";
import { logger } from "./logger.js";

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

  const url = `${env.EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(instanceName)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY
    },
    body: JSON.stringify({
      number,
      text,
      delay: 500
    })
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      {
        instanceName,
        number,
        status: response.status,
        body
      },
      "Failed to send message to Evolution API"
    );
    throw new Error(`Evolution API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Envia uma imagem com legenda (texto) pela Evolution.
 * Usado por automações como aniversário, onde a clínica anexa um cartão/foto.
 * @param media - URL pública da imagem OU string base64 (data:image/...).
 * @param caption - texto que vai junto da imagem (já com variáveis substituídas).
 */
export async function sendEvolutionMediaMessage({ instanceName, number, media, caption }) {
  if (!env.EVOLUTION_API_URL || !env.EVOLUTION_API_KEY) {
    logger.info({ instanceName, number }, "Evolution integration disabled. Skipping media message.");
    return { skipped: true };
  }

  // Sem mídia válida, cai para texto simples (não perde a mensagem).
  if (!media) {
    return sendEvolutionTextMessage({ instanceName, number, text: caption });
  }

  const url = `${env.EVOLUTION_API_URL}/message/sendMedia/${encodeURIComponent(instanceName)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY
    },
    body: JSON.stringify({
      number,
      mediatype: "image",
      media,
      caption,
      delay: 500
    })
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { instanceName, number, status: response.status, body },
      "Failed to send media message to Evolution API"
    );
    throw new Error(`Evolution API media error: ${response.status}`);
  }

  return response.json();
}
