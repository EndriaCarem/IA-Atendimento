import { env } from "../config/env.js";
import { dbFindOne, dbFind } from "../lib/json-db.js";

function findAiSecretaryHandoffByClinicId(clinicId) {
  return dbFindOne(env.TABLE_AI_HANDOFF, (r) => r[env.COL_AI_CONFIG_CLINIC_ID] === clinicId) ?? null;
}

export async function listAllInstances() {
  const rows = dbFind(env.TABLE_WHATSAPP_INSTANCES, () => true);
  return rows.map((data) => ({
    id: data.id,
    clinicId: data[env.COL_INSTANCE_CLINIC_ID],
    instanceName: data[env.COL_INSTANCE_NAME]
  })).filter((i) => i.instanceName);
}

export async function findInstanceByName(instanceName) {
  if (!instanceName) {
    return null;
  }

  const data = dbFindOne(
    env.TABLE_WHATSAPP_INSTANCES,
    (r) => r[env.COL_INSTANCE_NAME] === instanceName
  );

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    clinicId: data[env.COL_INSTANCE_CLINIC_ID],
    instanceName: data[env.COL_INSTANCE_NAME] ?? instanceName
  };
}

export async function findClinicById(clinicId) {
  if (!clinicId) {
    return null;
  }

  const clinicData = dbFindOne(env.TABLE_CLINICS, (r) => r.id === clinicId);
  if (!clinicData) {
    return null;
  }

  const aiConfig = dbFindOne(
    env.TABLE_AI_CONFIG,
    (r) => r[env.COL_AI_CONFIG_CLINIC_ID] === clinicId
  );

  const handoff = findAiSecretaryHandoffByClinicId(clinicId);

  const clinicConfig = dbFindOne("clinic_config", (r) => r.clinic_id === clinicId);
  const syncedDoctors = dbFind("doctors", (d) => d.clinic_id === clinicId && d.active !== false);
  const doctors = syncedDoctors.length > 0
    ? syncedDoctors
    : (Array.isArray(clinicConfig?.doctors) ? clinicConfig.doctors : []);
  const timezone =
    clinicData.timezone ??
    clinicData.time_zone ??
    clinicConfig?.timezone ??
    clinicConfig?.time_zone ??
    env.DEFAULT_TIMEZONE;

  return {
    id: clinicData.id,
    name: clinicData.name ?? null,
    address: clinicData.address ?? clinicConfig?.address ?? null,
    timezone,
    customPrompt: aiConfig?.[env.COL_AI_CONFIG_PROMPT] ?? "",
    aiEnabled: aiConfig?.enabled ?? true,
    businessHours: clinicData.business_hours ?? clinicConfig?.business_hours ?? null,
    procedures: Array.isArray(clinicConfig?.procedures) ? clinicConfig.procedures : [],
    insurancePlans: Array.isArray(clinicConfig?.insurance_plans) ? clinicConfig.insurance_plans : [],
    doctors,
    handoff
  };
}
