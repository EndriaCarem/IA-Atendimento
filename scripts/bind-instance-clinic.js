import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv();

function readEnv(primary, fallback = undefined) {
  const primaryValue = process.env[primary];

  if (primaryValue && String(primaryValue).trim().length > 0) {
    return String(primaryValue).trim();
  }

  if (!fallback) {
    return "";
  }

  const fallbackValue = process.env[fallback];
  return fallbackValue && String(fallbackValue).trim().length > 0
    ? String(fallbackValue).trim()
    : "";
}

function ensureEnv(values) {
  const missing = values.filter((item) => !item.value || item.value.length === 0).map((item) => item.name);

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const SUPABASE_URL = readEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");
const instanceName = readEnv("BIND_INSTANCE_NAME", "ONBOARD_INSTANCE_NAME");
const clinicId = readEnv("BIND_CLINIC_ID", "ONBOARD_CLINIC_ID");

const TABLE_WHATSAPP_INSTANCES = process.env.TABLE_WHATSAPP_INSTANCES || "whatsapp_instances";
const COL_INSTANCE_NAME = process.env.COL_INSTANCE_NAME || "instance_name";
const COL_INSTANCE_CLINIC_ID = process.env.COL_INSTANCE_CLINIC_ID || "clinic_id";

ensureEnv([
  { name: "SUPABASE_URL", value: SUPABASE_URL },
  { name: "SUPABASE_SERVICE_ROLE_KEY", value: SUPABASE_SERVICE_ROLE_KEY },
  { name: "BIND_INSTANCE_NAME (or ONBOARD_INSTANCE_NAME)", value: instanceName },
  { name: "BIND_CLINIC_ID (or ONBOARD_CLINIC_ID)", value: clinicId }
]);

async function main() {
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
  console.log("Instance-clinic binding upserted:", data);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Bind failed:", error.message);
  process.exit(1);
});
