import { env } from "../config/env.js";

export function webhookAuthMiddleware(req, res, next) {
  if (!env.EVOLUTION_WEBHOOK_SECRET) {
    next();
    return;
  }

  const receivedSecret =
    req.header("x-webhook-secret") ?? req.header("x-evolution-secret") ?? req.header("x-api-key");

  if (!receivedSecret || receivedSecret !== env.EVOLUTION_WEBHOOK_SECRET) {
    res.status(401).json({
      error: "Invalid webhook secret"
    });
    return;
  }

  next();
}
