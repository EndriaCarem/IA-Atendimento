import { config as loadEnv } from "dotenv";

loadEnv();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

if (!EVOLUTION_API_URL) {
  // eslint-disable-next-line no-console
  console.error("Missing EVOLUTION_API_URL");
  process.exit(1);
}

if (!EVOLUTION_API_KEY) {
  // eslint-disable-next-line no-console
  console.error("Missing EVOLUTION_API_KEY");
  process.exit(1);
}

async function main() {
  const baseUrl = EVOLUTION_API_URL.replace(/\/$/, "");

  const response = await fetch(baseUrl, {
    headers: {
      apikey: EVOLUTION_API_KEY
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.error("Evolution healthcheck failed:", response.status, data);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log("Evolution online:", data);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Evolution healthcheck failed:", error.message);
  process.exit(1);
});
