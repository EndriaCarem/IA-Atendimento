import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { apiAuthMiddleware } from "./middleware/api-auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import healthRoutes from "./routes/health.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import dataRoutes from "./routes/data.routes.js";
import clinicAiRoutes from "./routes/clinic-ai.routes.js";
import syncRoutes from "./routes/sync.routes.js";

export const app = express();

const CORS_ORIGINS = new Set([
  // Lovable preview/production
  "https://lovable.dev",
  "https://79045439-7b18-48fd-93c6-8c5db66aba23.lovableproject.com",
  "https://id-preview--79045439-7b18-48fd-93c6-8c5db66aba23.lovable.app",
  "https://dental-bridge-suite.lovable.app",
  // Dev local
  "http://localhost:8080",
  "http://localhost:5173",
]);

const CORS_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovable\.dev$/i,
];

function isAllowedCorsOrigin(origin) {
  return CORS_ORIGINS.has(origin) || CORS_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

// Allow extra origins from env (comma-separated)
if (process.env.CORS_EXTRA_ORIGINS) {
  process.env.CORS_EXTRA_ORIGINS
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .forEach((origin) => CORS_ORIGINS.add(origin));
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-backend-token", "bypass-tunnel-reminder"],
}));

app.use(
  pinoHttp({
    logger,
    autoLogging: false,
    customLogLevel(res, error) {
      if (error || res.statusCode >= 500) {
        return "error";
      }

      if (res.statusCode >= 400) {
        return "warn";
      }

      return "info";
    }
  })
);

// Limite alto: a Evolution envia webhooks com payload grande (mensagens com
// mídia/base64). Com 2mb, o Express respondia 413 e a Evolution considerava o
// webhook falho, desestabilizando a conexão. WhatsApp aceita mídia até ~16MB,
// que em base64 chega a ~22MB — por isso 25mb de folga.
app.use(express.json({ limit: "25mb" }));
app.use(rateLimitMiddleware);

app.use("/health", healthRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api", apiAuthMiddleware, whatsappRoutes);
app.use("/api", apiAuthMiddleware, dataRoutes);
app.use("/api", apiAuthMiddleware, clinicAiRoutes);
app.use("/api", apiAuthMiddleware, syncRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
