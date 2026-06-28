import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";

loadEnv();

function getProjectRefFromUrl(supabaseUrl) {
  try {
    const parsed = new URL(supabaseUrl);
    return parsed.hostname.split(".")[0];
  } catch {
    return null;
  }
}

async function callManagementApi({ endpoint, accessToken, sql }) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: sql })
  });
}

async function main() {
  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || process.env.SUPABASE_TOKEN;

  if (!accessToken) {
    // eslint-disable-next-line no-console
    console.error("Missing Supabase PAT. Set SUPABASE_ACCESS_TOKEN in .env or shell.");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    // eslint-disable-next-line no-console
    console.error("Missing SUPABASE_URL in .env");
    process.exit(1);
  }

  const projectRef = getProjectRefFromUrl(supabaseUrl);
  if (!projectRef) {
    // eslint-disable-next-line no-console
    console.error("Could not parse project ref from SUPABASE_URL");
    process.exit(1);
  }

  const sql = await readFile(new URL("../docs/supabase-min-schema.sql", import.meta.url), "utf8");

  const endpoints = [
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    `https://api.supabase.com/v1/projects/${projectRef}/sql`
  ];

  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const response = await callManagementApi({
        endpoint,
        accessToken,
        sql
      });

      const text = await response.text();

      if (response.ok) {
        // eslint-disable-next-line no-console
        console.log(`Schema applied successfully using ${endpoint}`);
        if (text) {
          // eslint-disable-next-line no-console
          console.log(text);
        }
        return;
      }

      failures.push({
        endpoint,
        status: response.status,
        body: text
      });
    } catch (error) {
      failures.push({
        endpoint,
        status: "NETWORK_ERROR",
        body: error.message
      });
    }
  }

  // eslint-disable-next-line no-console
  console.error("Failed to apply schema via Management API.");
  for (const failure of failures) {
    // eslint-disable-next-line no-console
    console.error(`[${failure.status}] ${failure.endpoint} -> ${failure.body}`);
  }
  process.exit(1);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error while applying schema:", error.message);
  process.exit(1);
});
