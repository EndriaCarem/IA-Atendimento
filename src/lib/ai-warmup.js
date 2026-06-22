import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { generateOllamaJsonResponse } from "./ollama.js";

export async function warmupAIProvider() {
  if (env.AI_PROVIDER !== "ollama") {
    return;
  }

  const startedAt = Date.now();

  try {
    await generateOllamaJsonResponse({
      model: env.OLLAMA_MODEL,
      systemPrompt: "Responda sempre com JSON valido.",
      userPayload: { warmup: true },
      temperature: 0
    });

    logger.info(
      {
        provider: env.AI_PROVIDER,
        model: env.OLLAMA_MODEL,
        elapsedMs: Date.now() - startedAt
      },
      "AI provider warmup completed"
    );
  } catch (error) {
    logger.warn(
      {
        provider: env.AI_PROVIDER,
        model: env.OLLAMA_MODEL,
        err: error
      },
      "AI provider warmup failed"
    );
  }
}