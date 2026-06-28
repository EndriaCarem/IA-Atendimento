import { env } from "../config/env.js";

export function apiAuthMiddleware(req, res, next) {
  if (!env.API_AUTH_TOKEN) {
    next();
    return;
  }

  const auth = req.header("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const token = bearer ?? req.header("x-api-key") ?? req.header("x-backend-token");

  if (token !== env.API_AUTH_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  next();
}
