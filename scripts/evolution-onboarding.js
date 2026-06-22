import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv();

function ensureRequiredEnv(keys) {
  for (const key of keys) {
    if (!process.env[key] || String(process.env[key]).trim().length === 0) {
      // eslint-disable-next-line no-console
      console.error(`Missing required env: ${key}`);
      process.exit(1);
    }
  }
}

ensureRequiredEnv(["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "ONBOARD_INSTANCE_NAME", "ONBOARD_WEBHOOK_URL"]);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL.replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLE_WHATSAPP_INSTANCES = process.env.TABLE_WHATSAPP_INSTANCES || "whatsapp_instances";
const COL_INSTANCE_NAME = process.env.COL_INSTANCE_NAME || "instance_name";
const COL_INSTANCE_CLINIC_ID = process.env.COL_INSTANCE_CLINIC_ID || "clinic_id";

const instanceName = process.env.ONBOARD_INSTANCE_NAME;
const clinicId = (process.env.ONBOARD_CLINIC_ID || "").trim();
const webhookUrl = process.env.ONBOARD_WEBHOOK_URL;
const instanceToken = process.env.ONBOARD_INSTANCE_TOKEN || "";
const ownerNumber = process.env.ONBOARD_NUMBER || "";
const integration = process.env.ONBOARD_INTEGRATION || "WHATSAPP-BAILEYS";

const webhookEvents = [
  "APPLICATION_STARTUP",
  "QRCODE_UPDATED",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE"
];

async function evolutionRequest(path, options = {}) {
  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const normalized = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`Evolution ${path} failed (${response.status}): ${normalized}`);
  }

  return body;
}

async function ensureInstance() {
  // eslint-disable-next-line no-console
  console.log(`Creating or reusing instance: ${instanceName}`);

  try {
    const payload = {
      instanceName,
      integration,
      token: instanceToken,
      qrcode: false,
      number: ownerNumber || undefined
    };

    const created = await evolutionRequest("/instance/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    // eslint-disable-next-line no-console
    console.log("Instance create response:", created);
  } catch (error) {
    const message = String(error.message || "").toLowerCase();

    if (message.includes("already") || message.includes("exists")) {
      // eslint-disable-next-line no-console
      console.log("Instance already exists, continuing.");
    } else {
      throw error;
    }
  }
}

async function setInstanceWebhook() {
  // eslint-disable-next-line no-console
  console.log(`Configuring webhook for instance: ${instanceName}`);

  const payload = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      byEvents: true,
      base64: true,
      events: webhookEvents
    }
  };

  const webhook = await evolutionRequest(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  // eslint-disable-next-line no-console
  console.log("Webhook set response:", webhook);
}

async function connectInstanceAndPrintQrHint() {
  // eslint-disable-next-line no-console
  console.log(`Requesting connect for instance: ${instanceName}`);

  const query = ownerNumber ? `?number=${encodeURIComponent(ownerNumber)}` : "";
  const connectData = await evolutionRequest(
    `/instance/connect/${encodeURIComponent(instanceName)}${query}`,
    {
      method: "GET"
    }
  );

  // eslint-disable-next-line no-console
  console.log("Connect response:", connectData);
  // eslint-disable-next-line no-console
  console.log("Pairing code:", connectData?.pairingCode || "not returned");
}

async function upsertSupabaseBinding() {
  if (!clinicId) {
    // eslint-disable-next-line no-console
    console.log(
      "ONBOARD_CLINIC_ID not provided. Instance created/connected without tenant binding. Use npm run bind:instance when clinic is available."
    );
    return;
  }

  ensureRequiredEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const payload = {
    [COL_INSTANCE_NAME]: instanceName,
    [COL_INSTANCE_CLINIC_ID]: clinicId
  };

  const { data, error } = await supabase
    .from(TABLE_WHATSAPP_INSTANCES)
    .upsert(payload, {
      onConflict: COL_INSTANCE_NAME
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }

  // eslint-disable-next-line no-console
  console.log("Supabase mapping upserted:", data);
}

async function main() {
  await ensureInstance();
  await setInstanceWebhook();
  await connectInstanceAndPrintQrHint();
  await upsertSupabaseBinding();

  // eslint-disable-next-line no-console
  console.log("Onboarding completed.");
  // eslint-disable-next-line no-console
  console.log("Next: open Evolution Manager, scan QR for this instance, and send a WhatsApp test message.");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Onboarding failed:", error.message);
  process.exit(1);
});
