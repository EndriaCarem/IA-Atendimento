/**
 * GET /api/clinics/:clinicId/patients/lookup?phone=5511999999999
 * GET /api/clinics/:clinicId/patients/lookup?cpf=00000000000
 *
 * GET /api/patients/:patientId/summary
 *
 * Pré-requisito de TODAS as ações da IA — identifica quem está falando.
 */
import { lookupPatientByPhone, getPatientSummary } from "../repositories/clinic-data.repository.js";
import { logAiAction } from "../lib/action-log.js";

// GET /api/clinics/:clinicId/patients/lookup?phone=
export function lookupPatientController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { phone, cpf } = req.query;

    if (!phone && !cpf) {
      return res.status(400).json({ ok: false, error: "Informe phone ou cpf como query param" });
    }

    const patient = lookupPatientByPhone(clinicId, phone ?? cpf);

    logAiAction({
      clinicId,
      patientPhone: phone ?? null,
      action: "patient_lookup",
      payload: { phone: phone ?? null, cpf: cpf ?? null },
      result: patient ? { found: true, patient_id: patient.patient_id } : { found: false },
    });

    if (!patient) {
      return res.status(404).json({ ok: false, data: null, message: "Paciente não encontrado" });
    }

    res.json({ ok: true, data: patient });
  } catch (err) {
    next(err);
  }
}

// GET /api/patients/:patientId/summary
export function patientSummaryController(req, res, next) {
  try {
    const { patientId } = req.params;
    const { clinicId } = req.query; // opcional para audit log

    const summary = getPatientSummary(patientId);

    if (!summary) {
      return res.status(404).json({ ok: false, data: null, message: "Paciente não encontrado" });
    }

    logAiAction({
      clinicId: clinicId ?? "unknown",
      action: "patient_summary_read",
      payload: { patient_id: patientId },
      result: { has_anamnese: !!summary.anamnese },
    });

    res.json({ ok: true, data: summary });
  } catch (err) {
    next(err);
  }
}
