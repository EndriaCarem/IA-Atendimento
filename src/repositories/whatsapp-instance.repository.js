import { env } from "../config/env.js";
import { dbFind, dbFindOne, dbUpsert, dbUpdate } from "../lib/json-db.js";
import { AppError } from "../utils/http-error.js";
import { logger } from "../lib/logger.js";

export async function findInstanceByClinicId(clinicId) {
  if (!clinicId) {
    return null;
  }

  const records = dbFind(
    env.TABLE_WHATSAPP_INSTANCES,
    (r) => r[env.COL_INSTANCE_CLINIC_ID] === clinicId
  );

  if (records.length === 0) {
    return null;
  }

  // Most recent first
  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const data = records[0];

  return {
    id: data.id,
    clinicId: data[env.COL_INSTANCE_CLINIC_ID],
    instanceName: data[env.COL_INSTANCE_NAME],
    createdAt: data.created_at
  };
}

export async function upsertInstanceMapping({ clinicId, instanceName }) {
  if (!clinicId || !instanceName) {
    throw new AppError("clinic_id and instance_name are required", 400);
  }

  const payload = {
    [env.COL_INSTANCE_CLINIC_ID]: clinicId,
    [env.COL_INSTANCE_NAME]: instanceName
  };

  const data = dbUpsert(env.TABLE_WHATSAPP_INSTANCES, payload, env.COL_INSTANCE_NAME);

  return {
    id: data.id,
    clinicId: data[env.COL_INSTANCE_CLINIC_ID],
    instanceName: data[env.COL_INSTANCE_NAME],
    createdAt: data.created_at
  };
}

export async function updateInstanceQrCode(instanceName, qrCodeUrl) {
  if (!instanceName || !qrCodeUrl) {
    return;
  }

  const updated = dbUpdate(
    env.TABLE_WHATSAPP_INSTANCES,
    (r) => r[env.COL_INSTANCE_NAME] === instanceName,
    { qr_code_url: qrCodeUrl }
  );

  if (!updated) {
    logger.warn({ instanceName }, "updateInstanceQrCode: instance not found in local db");
  }
}
