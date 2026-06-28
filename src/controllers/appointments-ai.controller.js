/**
 * POST  /api/clinics/:clinicId/appointments
 *   Body: { patient_id, dentist_id, start_time, end_time?, procedure_id?, notes?, idempotency_key, source? }
 *   Header: Idempotency-Key: <uuid>  (alternativa ao body.idempotency_key)
 *
 * PATCH /api/clinics/:clinicId/appointments/:appointmentId
 *   Body: { action: "reschedule"|"cancel", new_start_time?, new_end_time?, reason? }
 */
import {
  createAppointmentLocal,
  rescheduleAppointmentLocal,
  cancelAppointmentLocal,
} from "../repositories/clinic-data.repository.js";
import {
  buildKey,
  extractIdempotencyKey,
  getStoredResponse,
  storeResponse,
} from "../lib/request-idempotency.js";
import { logAiAction } from "../lib/action-log.js";

// ─── POST ────────────────────────────────────
export function createAppointmentAiController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { patient_id, dentist_id, start_time, end_time, procedure_id, notes, source } = req.body ?? {};

    if (!patient_id || !dentist_id || !start_time) {
      return res.status(400).json({ ok: false, error: "patient_id, dentist_id e start_time são obrigatórios" });
    }

    // Idempotência
    const clientKey = extractIdempotencyKey(req);
    if (clientKey) {
      const idempKey = buildKey(clinicId, "appointment_create", clientKey);
      const cached = getStoredResponse(idempKey);
      if (cached) {
        res.setHeader("X-Idempotent-Replayed", "true");
        return res.status(200).json(cached);
      }

      const appointment = createAppointmentLocal({
        clinicId, patientId: patient_id, dentistId: dentist_id,
        startTime: start_time, endTime: end_time,
        procedureId: procedure_id, notes, source: source ?? "ai",
      });

      const response = { ok: true, data: appointment };
      storeResponse(idempKey, response);

      logAiAction({
        clinicId,
        action: "appointment_create",
        payload: { patient_id, dentist_id, start_time, idempotency_key: clientKey },
        result: { appointment_id: appointment.id },
      });

      return res.status(201).json(response);
    }

    // Sem idempotência — aceito, mas avisado no log
    const appointment = createAppointmentLocal({
      clinicId, patientId: patient_id, dentistId: dentist_id,
      startTime: start_time, endTime: end_time,
      procedureId: procedure_id, notes, source: source ?? "ai",
    });

    logAiAction({
      clinicId,
      action: "appointment_create_no_idempotency",
      payload: { patient_id, dentist_id, start_time },
      result: { appointment_id: appointment.id },
    });

    res.status(201).json({ ok: true, data: appointment });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH ───────────────────────────────────
export function updateAppointmentAiController(req, res, next) {
  try {
    const { clinicId, appointmentId } = req.params;
    const { action, new_start_time, new_end_time, reason } = req.body ?? {};

    if (!action || !["reschedule", "cancel"].includes(action)) {
      return res.status(400).json({ ok: false, error: 'action deve ser "reschedule" ou "cancel"' });
    }

    if (action === "reschedule" && !new_start_time) {
      return res.status(400).json({ ok: false, error: "new_start_time é obrigatório para reschedule" });
    }

    let result;

    if (action === "cancel") {
      result = cancelAppointmentLocal({ appointmentId, clinicId, reason });
    } else {
      result = rescheduleAppointmentLocal({
        appointmentId, clinicId,
        newStartTime: new_start_time,
        newEndTime: new_end_time ?? null,
        reason,
      });
    }

    logAiAction({
      clinicId,
      action: `appointment_${action}`,
      payload: { appointment_id: appointmentId, new_start_time, reason },
      result: { status: result.status },
    });

    res.json({ ok: true, data: result });
  } catch (err) {
    next(err);
  }
}
