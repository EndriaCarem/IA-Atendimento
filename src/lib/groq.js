import { env } from "../config/env.js";
import { AppError } from "../utils/http-error.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export async function generateGroqJsonResponse({
  model,
  systemPrompt,
  userPayload,
  temperature = 0.2
}) {
  if (!env.GROQ_API_KEY) {
    throw new AppError("GROQ_API_KEY is required when AI_PROVIDER=groq", 500);
  }

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GROQ_API_KEY}`
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
