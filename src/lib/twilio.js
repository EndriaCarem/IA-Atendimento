import twilio from "twilio";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let client = null;

function initTwilio() {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    logger.warn("[TWILIO] Credenciais não configuradas (SMS desativado)");
    return null;
  }

  if (!client) {
    client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }

  return client;
}

export async function sendTwilioSMS({ to, body }) {
  const twilioClient = initTwilio();

  if (!twilioClient) {
    throw new Error("Twilio não configurado (TWILIO_ACCOUNT_SID/AUTH_TOKEN faltando)");
  }

  if (!env.TWILIO_PHONE_NUMBER) {
    throw new Error("TWILIO_PHONE_NUMBER não configurado");
  }

  if (!to || !body) {
    throw new Error("Parâmetros 'to' e 'body' obrigatórios");
  }

  try {
    const message = await twilioClient.messages.create({
      body,
      from: env.TWILIO_PHONE_NUMBER,
      to,
    });

    logger.info({ sid: message.sid, to }, "[TWILIO] SMS enviado");

    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
    };
  } catch (err) {
    logger.error({ to, error: err.message }, "[TWILIO] Falha ao enviar SMS");
    throw new Error(`Twilio error: ${err.message}`);
  }
}
