import { env } from "../config/env.js";
import { AppError } from "../utils/http-error.js";
import { logger } from "./logger.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

// Monta a lista de chaves Groq disponíveis: a principal (GROQ_API_KEY) seguida
// das adicionais (GROQ_API_KEYS, separadas por vírgula). Contas diferentes têm
// limites independentes — quando uma estoura (429), tentamos a próxima.
function getGroqKeys() {
  const keys = [];
  if (env.GROQ_API_KEY) keys.push(env.GROQ_API_KEY.trim());
  if (env.GROQ_API_KEYS) {
    for (const k of env.GROQ_API_KEYS.split(",")) {
      const key = k.trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

async function callGroqOnce({ apiKey, model, systemPrompt, userPayload, temperature }) {
  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      temperature,
      response_format: { type: "json_object" }
    })
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError("Groq API request failed", 502, {
      status: response.status,
      error: body?.error?.message ?? "Unknown Groq API error"
    });
  }

  const text = body?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new AppError("Groq returned empty content", 502);
  }
  return text;
}

export async function generateGroqJsonResponse({
  model,
  systemPrompt,
  userPayload,
  temperature = 0.2
}) {
  const keys = getGroqKeys();
  if (keys.length === 0) {
    throw new AppError("GROQ_API_KEY is required when AI_PROVIDER=groq", 500);
  }

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      return await callGroqOnce({ apiKey: keys[i], model, systemPrompt, userPayload, temperature });
    } catch (err) {
      lastError = err;
      // Só vale tentar a próxima chave quando o motivo é rate limit (429).
      // Outros erros (modelo inválido, payload, 5xx) repetiriam em qualquer chave.
      const isRateLimit = err?.details?.status === 429;
      const hasNext = i < keys.length - 1;
      if (isRateLimit && hasNext) {
        logger.warn({ keyIndex: i, next: i + 1 }, "[GROQ] Rate limit — tentando próxima chave");
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
