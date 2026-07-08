import { findClinicById, findInstanceByName } from "../repositories/clinic.repository.js";
import { findPatientByClinicAndPhone } from "../repositories/patient.repository.js";
import { AppError } from "../utils/http-error.js";

export async function resolveTenantContext(instanceName) {
  const instance = await findInstanceByName(instanceName);

  if (!instance) {
    throw new AppError("Unknown WhatsApp instance", 404, { instanceName });
  }

  if (!instance.clinicId) {
    throw new AppError("Instance has no clinic binding", 500, {
      instanceName,
      instanceId: instance.id
    });
  }

  const clinic = await findClinicById(instance.clinicId);

  if (!clinic) {
    throw new AppError("Clinic not found for instance", 404, {
      instanceName,
      clinicId: instance.clinicId
    });
  }

  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    clinicCategory: clinic.categoryLabel ?? clinic.category ?? null,
    clinicAddress: clinic.address,
    customPrompt: clinic.customPrompt,
    aiEnabled: clinic.aiEnabled,
    businessHours: clinic.businessHours,
    handoff: clinic.handoff,
    procedures: clinic.procedures,
    insurancePlans: clinic.insurancePlans,
    doctors: clinic.doctors,
    instanceId: instance.id,
    instanceName: instance.instanceName
  };
}

export async function resolvePatientContext(clinicId, phoneDigits) {
  return findPatientByClinicAndPhone(clinicId, phoneDigits);
}
