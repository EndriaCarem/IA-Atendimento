import { env } from "../config/env.js";
import { AppError } from "../utils/http-error.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export async function generateGeminiJsonResponse({
  model,
  systemPrompt,
  userPayload,
  temperature = 0.2
}) {
  if (!env.GEMINI_API_KEY) {
    throw new AppError("GEMINI_API_KEY is required when AI_PROVIDER=gemini", 500);
  }

  const endpoint = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(userPayload) }]
        }
      ],
      generationConfig: {
        temperature,
        responseMimeType: "application/json"
      }
    })
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AppError("Gemini API request failed", 502, {
      status: response.status,
      error: body?.error?.message ?? "Unknown Gemini API error"
    });
  }

  const text = extractTextFromGeminiResponse(body);

  if (!text) {
    throw new AppError("Gemini returned empty content", 502, {
      blockReason: body?.promptFeedback?.blockReason ?? null
    });
  }

  return text;
}