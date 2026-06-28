/**
 * Armazena o QR code mais RECENTE por instância.
 *
 * Problema: a Evolution renova o QR a cada ~20s (qrcodeCount sobe) e emite o
 * evento `qrcode.updated` via webhook. O endpoint /whatsapp/connect, porém,
 * pegava o QR via /instance/connect, que nem sempre devolve o atual — então o
 * painel mostrava um QR já expirado ("gera mas não lê").
 *
 * Solução: o webhook captura o base64 de cada `qrcode.updated` e guarda aqui.
 * O connect serve este QR (o mais novo), garantindo um QR válido no painel.
 */

const latestQrByInstance = new Map(); // instanceName -> { base64, at }

export function setLatestQr(instanceName, base64) {
  if (!instanceName || !base64) return;
  latestQrByInstance.set(instanceName, { base64, at: Date.now() });
}

// Retorna o QR mais recente se ainda for fresco (< 25s — pouco mais que o ciclo
// de renovação do WhatsApp). Mais velho que isso, considera expirado.
export function getLatestQr(instanceName, maxAgeMs = 25000) {
  const entry = latestQrByInstance.get(instanceName);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) return null;
  return entry.base64;
}

export function clearLatestQr(instanceName) {
  latestQrByInstance.delete(instanceName);
}
