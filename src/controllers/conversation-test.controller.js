import { findClinicById } from "../repositories/clinic.repository.js";
import { findPatientByClinicAndPhone } from "../repositories/patient.repository.js";
import { applyAppointmentAction } from "../services/appointment.service.js";
import { runClinicConversation } from "../services/ai-orchestrator.service.js";
import { AppError } from "../utils/http-error.js";
import { normalizePhone } from "../utils/phone.js";

export async function testConversationController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { patient_phone, message, apply_appointment_action = true } = req.body ?? {};

    if (!clinicId) {
      throw new AppError("clinic_id is required", 400);
    }

    if (!patient_phone) {
      throw new AppError("patient_phone is required", 400);
    }

    const messageText = String(message ?? "").trim();
    if (!messageText) {
      throw new AppError("message is required", 400);
    }

    const phoneDigits = normalizePhone(patient_phone);
    if (!phoneDigits) {
      throw new AppError("patient_phone is invalid", 400);
    }

    const clinic = await findClinicById(clinicId);
    if (!clinic) {
      throw new AppError("Clinic not found", 404, { clinicId });
    }

    const patient = await findPatientByClinicAndPhone(clinic.id, phoneDigits);

    const aiResult = await runClinicConversation({
      // Mesmo formato de clinicContext que resolveTenantContext monta no fluxo
      // real do WhatsApp, para que o teste reflita o comportamento de produção
      // (endereço, procedimentos, convênios e médicos incluídos).
      clinicContext: {
        clinicId: clinic.id,
        clinicName: clinic.name,
        clinicAddress: clinic.address,
        customPrompt: clinic.customPrompt,
        aiEnabled: clinic.aiEnabled,
        businessHours: clinic.businessHours,
        handoff: clinic.handoff,
        procedures: clinic.procedures,
        insurancePlans: clinic.insurancePlans,
        doctors: clinic.doctors,
        instanceId: null,
        instanceName: null
      },
      patientContext: patient,
      patientMessage: messageText,
      patientPhone: phoneDigits
    });

    const shouldApplyAction = apply_appointment_action !== false;
    const appointmentResult = shouldApplyAction
      ? await applyAppointmentAction({
          clinicId: clinic.id,
          patient,
          phone: phoneDigits,
          aiResult
        })
      : {
          updated: false,
          reason: "SKIPPED_BY_REQUEST"
        };

    res.status(200).json({
      ok: true,
      clinic: {
        id: clinic.id,
        name: clinic.name,
        custom_prompt: clinic.customPrompt,
        enabled: clinic.aiEnabled,
        business_hours: clinic.businessHours,
        handoff: clinic.handoff
      },
      patient: patient
        ? {
            id: patient.id,
            phone: patient.phone,
            name: patient.name
          }
        : null,
      ai_result: aiResult,
      appointment_result: appointmentResult
    });
  } catch (error) {
    next(error);
  }
}