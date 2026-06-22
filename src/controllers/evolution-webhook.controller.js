import { logger } from "../lib/logger.js";
import { processIncomingPatientMessage } from "../services/message-processor.service.js";
import { AppError } from "../utils/http-error.js";
import { extractIncomingMessage } from "../utils/evolution-payload.js";
import { isDuplicateIncomingMessage } from "../lib/message-idempotency.js";
import { recordInstanceEvent } from "../services/evolution-heartbeat.service.js";
import { setLatestQr } from "../services/qr-store.service.js";

// Extrai o base64 do QR de um evento qrcode.updated (formato pode variar).
function extractQrBase64(body) {
  const d = body?.data ?? body;
  const candidates = [
    d?.qrcode?.base64,
    d?.qrcode,
    body?.qrcode?.base64,
    d?.base64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("data:image/")) return c;
  }
  return null;
}

export async function evolutionWebhookController(req, res, next) {
  try {
    logger.info({
      url: req.originalUrl,
      event: req.body?.event ?? req.body?.type ?? req.params?.event ?? "unknown",
      instance: req.body?.instance ?? req.body?.instanceName ?? req.body?.sender?.instance ?? "unknown",
      hasData: !!req.body?.data,
      hasKey: !!(req.body?.data?.key ?? req.body?.key),
      bodyKeys: Object.keys(req.body ?? {}),
    }, "[WEBHOOK] Payload recebido do Evolution");

    const incoming = extractIncomingMessage(req.body);

    logger.info({
      event: incoming.event,
      instanceName: incoming.instanceName,
      remoteJid: incoming.remoteJid,
      text: incoming.text,
      fromMe: incoming.fromMe,
      isGroup: incoming.isGroup,
      isMessageEvent: incoming.isMessageEvent,
      messageId: incoming.messageId,
    }, "[WEBHOOK] Mensagem extraída");

    // connection.update: registra o estado e o MOTIVO da queda (statusReason).
    // É a única fonte do "por que o WhatsApp desconectou sozinho" — antes esse
    // evento era descartado como NON_MESSAGE_EVENT sem nenhum log.
    if (incoming.isConnectionEvent) {
      logger.warn({
        instanceName: incoming.instanceName,
        state: incoming.connectionState,
        statusReason: incoming.connectionStatusReason,
        remoteJid: incoming.remoteJid,
      }, "[WEBHOOK] connection.update — estado da sessão WhatsApp");
    }

    // Sinal de vida: um evento prova que a conexão está ativa — MAS um
    // connection.update com estado close/connecting é o oposto (está caindo).
    // Marcar heartbeat nesse caso enganava o health-monitor, que passava a
    // achar a instância viva justamente quando ela acabou de cair.
    const isDownState =
      incoming.isConnectionEvent &&
      (incoming.connectionState === "close" || incoming.connectionState === "connecting");
    if (incoming.instanceName && !isDownState) {
      recordInstanceEvent(incoming.instanceName);
    }

    // Captura o QR mais recente: a Evolution renova o QR a cada ~20s e emite
    // qrcode.updated. Guardamos o base64 para o /whatsapp/connect servir o QR
    // ATUAL (antes servia um expirado → "gera mas não lê").
    const evt = String(req.body?.event ?? req.body?.type ?? "").toLowerCase();
    if (evt.includes("qrcode") && incoming.instanceName) {
      const qrBase64 = extractQrBase64(req.body);
      if (qrBase64) {
        setLatestQr(incoming.instanceName, qrBase64);
        logger.info({ instanceName: incoming.instanceName }, "[WEBHOOK] QR atualizado capturado");
      }
    }

    if (!incoming.instanceName) {
      logger.warn({ body: req.body }, "[WEBHOOK] Ignorado: instance name não encontrado");
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: "INSTANCE_NAME_MISSING"
      });
      return;
    }

    if (!incoming.isMessageEvent) {
      logger.debug({ event: incoming.event }, "[WEBHOOK] Ignorado: evento não é mensagem");
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: "NON_MESSAGE_EVENT"
      });
      return;
    }

    if (incoming.fromMe || incoming.isGroup || !incoming.text) {
      logger.debug({
        fromMe: incoming.fromMe,
        isGroup: incoming.isGroup,
        hasText: !!incoming.text,
      }, "[WEBHOOK] Ignorado: mensagem filtrada (fromMe/grupo/sem texto)");
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: "MESSAGE_FILTERED"
      });
      return;
    }

    if (isDuplicateIncomingMessage(incoming)) {
      logger.info(
        {
          instanceName: incoming.instanceName,
          messageId: incoming.messageId,
          remoteJid: incoming.remoteJid
        },
        "[WEBHOOK] Ignorado: mensagem duplicada"
      );
      res.status(202).json({
        ok: true,
        ignored: true,
        reason: "DUPLICATE_MESSAGE"
      });
      return;
    }

    try {
      const result = await processIncomingPatientMessage(incoming);

      res.status(200).json({
        ok: true,
        ignored: result.skipped,
        reason: result.reason ?? null
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        logger.warn(
          {
            details: error.details,
            instanceName: incoming.instanceName
          },
          "Webhook ignored because tenant context was not found"
        );

        res.status(202).json({
          ok: true,
          ignored: true,
          reason: "TENANT_NOT_FOUND"
        });
        return;
      }

      throw error;
    }
  } catch (error) {
    next(error);
  }
}
