import { env } from "../config/env.js";

const buckets = new Map();

function clientKey(req) {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

export function rateLimitMiddleware(req, res, next) {
  if (!env.RATE_LIMIT_MAX_REQUESTS) {
    next();
    return;
  }

  const now = Date.now();
  const key = clientKey(req);
  const current = buckets.get(key);

  if (!current || now > current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + env.RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  current.count += 1;
  if (current.count > env.RATE_LIMIT_MAX_REQUESTS) {
    res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
    res.status(429).json({ ok: false, error: "Too many requests" });
    return;
  }

  next();
}
