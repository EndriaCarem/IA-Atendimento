export function normalizePhone(rawValue) {
  if (!rawValue) {
    return null;
  }

  const value = String(rawValue);
  const withoutJid = value.includes("@") ? value.split("@")[0] : value;
  const digits = withoutJid.replace(/\D/g, "");

  return digits.length > 0 ? digits : null;
}

export function buildPhoneCandidates(phoneDigits) {
  const clean = normalizePhone(phoneDigits);

  if (!clean) {
    return [];
  }

  const candidates = new Set();
  candidates.add(clean);

  if (clean.startsWith("55")) {
    candidates.add(clean.slice(2));
  }

  if (!clean.startsWith("55") && (clean.length === 10 || clean.length === 11)) {
    candidates.add(`55${clean}`);
  }

  return Array.from(candidates);
}
