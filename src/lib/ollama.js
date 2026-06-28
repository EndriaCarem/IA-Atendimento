import { env } from "../config/env.js";
import { AppError } from "../utils/http-error.js";

function extractTextFromOllamaResponse(data) {
  const content = data?.message?.content;

  if (typeof content !== "string") {
    return "";
  }

  return content.trim();
}

export async function generateOllamaJsonResponse({
  model,
  systemPrompt,
  userPayload,
  temperature = 0.2
}) {
  const endpoint = `${env.OLLAMA_BASE_URL}/api/chat`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      keep_alive: env.OLLAMA_KEEP_ALIVE,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: JSON.stringify(userPayload)
        }
      ],
      options: {
        temperature
      }
    })
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError("Ollama API request failed", 502, {
      status: response.status,
      error: body?.error ?? "Unknown Ollama API error"
    });
  }

  const text = extractTextFromOllamaResponse(body);

  if (!text) {
    throw new AppError("Ollama returned empty content", 502);
  }

  return text;
}
