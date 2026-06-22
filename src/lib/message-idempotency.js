const MESSAGE_ID_TTL_MS = 2 * 60 * 1000;
const MAX_TRACKED_IDS = 5000;

const seenMessages = new Map();

function nowMs() {
  return Date.now();
}

function pruneExpired() {
  const threshold = nowMs() - MESSAGE_ID_TTL_MS;

  for (const [key, seenAt] of seenMessages) {
    if (seenAt < threshold) {
      seenMessages.delete(key);
    }
  }

  if (seenMessages.size <= MAX_TRACKED_IDS) {
    return;
  }

  const overflow = seenMessages.size - MAX_TRACKED_IDS;
  let removed = 0;

  for (const key of seenMessages.keys()) {
    seenMessages.delete(key);
    removed += 1;

    if (removed >= overflow) {
      break;
    }
  }
}

export function isDuplicateIncomingMessage({ instanceName, messageId }) {
  if (!messageId) {
    return false;
  }

  pruneExpired();

  const dedupKey = `${instanceName || "unknown"}:${messageId}`;
  const alreadySeen = seenMessages.has(dedupKey);

  if (!alreadySeen) {
    seenMessages.set(dedupKey, nowMs());
  }

  return alreadySeen;
}