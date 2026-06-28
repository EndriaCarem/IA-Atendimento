import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { warmupAIProvider } from "./lib/ai-warmup.js";
import { startAutomationScheduler } from "./services/automation-scheduler.service.js";
import { startEvolutionHealthMonitor } from "./services/evolution-health.service.js";
import { app } from "./app.js";

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      nodeEnv: env.NODE_ENV
    },
    "Server started"
  );

  void warmupAIProvider();
  startAutomationScheduler();
  // REFINADO e REATIVADO (2026-06-12): só age em "open zumbi" (open sem eventos),
  // faz logout+connect (recuperação real), para após 3 tentativas e alerta, não
  // toca em "close"/"connecting", não reinicia o container. Ver evolution-health.service.js.
  startEvolutionHealthMonitor();
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  server.close(() => process.exit(1));
});
