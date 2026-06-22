function firstValidText(candidates) {
  return (
    candidates.find((item) => typeof item === "string" && item.trim().length > 0)?.trim() ?? ""
  );
}

export function extractIncomingMessage(payload) {
  const data = payload?.data ?? {};
  const key = data?.key ?? payload?.key ?? {};

  const instanceName =
    payload?.instanceName ??
    payload?.instance ??
    payload?.sender?.instance ??
    data?.instanceName ??
    data?.instance ??
    payload?.instance?.instanceName ??
    null;

  const event = String(payload?.event ?? payload?.type ?? "unknown").toLowerCase();

  const remoteJid =
    key?.remoteJid ??
    data?.remoteJid ??
    payload?.remoteJid ??
    payload?.from ??
    payload?.sender ??
    null;

  const text = firstValidText([
    data?.message?.conversation,
    data?.message?.extendedTextMessage?.text,
    data?.message?.imageMessage?.caption,
    data?.message?.videoMessage?.caption,
    data?.message?.buttonsResponseMessage?.selectedDisplayText,
    data?.message?.listResponseMessage?.title,
    payload?.message?.text,
    payload?.text
  ]);

  const messageId = key?.id ?? data?.id ?? payload?.id ?? null;
  const timestamp = Number(data?.messageTimestamp ?? payload?.timestamp ?? Date.now() / 1000);
  const fromMe = Boolean(key?.fromMe ?? data?.fromMe ?? payload?.fromMe ?? false);
  const isGroup = typeof remoteJid === "string" && remoteJid.endsWith("@g.us");

  const isMessageEvent = event.includes("message") || text.length > 0;

  // Eventos connection.update carregam o estado da sessão e o motivo da queda.
  // Esses campos são a única fonte do "por que o WhatsApp caiu" (401 loggedOut,
  // 440 connectionReplaced, etc.) — capturados aqui para o webhook poder logar.
  const isConnectionEvent = event.includes("connection");
  const connectionState =
    data?.state ?? data?.connection ?? payload?.state ?? null;
  const connectionStatusReason =
    data?.statusReason ?? data?.lastDisconnect?.error?.output?.statusCode ??
    data?.reason ?? null;

  return {
    event,
    instanceName,
    remoteJid,
    text,
    messageId,
    timestamp,
    fromMe,
    isGroup,
    isMessageEvent,
    isConnectionEvent,
    connectionState,
    connectionStatusReason
  };
}
