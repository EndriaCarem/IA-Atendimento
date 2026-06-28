import { env } from "../src/config/env.js";
import { generateOllamaJsonResponse } from "../src/lib/ollama.js";

async function main() {
  const raw = await generateOllamaJsonResponse({
    model: env.OLLAMA_MODEL,
    temperature: 0,
    systemPrompt: [
      "Voce e um verificador tecnico de conectividade.",
      "Responda somente JSON valido.",
      'Formato de saida: {"ok":true,"provider":"ollama","model":"string"}'
    ].join("\n"),
    userPayload: {
      check: "ping",
      timestamp: new Date().toISOString()
    }
  });

  const parsed = JSON.parse(raw);
  // eslint-disable-next-line no-console
  console.log(parsed);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Ollama check failed:", error.message);
  process.exit(1);
});
