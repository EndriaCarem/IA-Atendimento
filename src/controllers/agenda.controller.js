/**
 * GET /api/clinics/:clinicId/agenda/free-slots
 *   ?date=YYYY-MM-DD
 *   &dentist_id=<uuid>   (opcional)
 *   &duration_min=<n>    (opcional, default 60)
 *
 * Retorna slots disponíveis para agendamento pela IA.
 */
import { getFreeSlots } from "../repositories/clinic-data.repository.js";
import { logAiAction } from "../lib/action-log.js";

export function freeSlotsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { date, dentist_id, duration_min } = req.query;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: "Parâmetro date obrigatório no formato YYYY-MM-DD" });
    }

    const duration = Math.max(15, Math.min(480, parseInt(duration_min ?? "60", 10)));
    const slots = getFreeSlots(clinicId, date, dentist_id ?? null, duration);

    logAiAction({
      clinicId,
      action: "agenda_free_slots",
      payload: { date, dentist_id: dentist_id ?? null, duration_min: duration },
      result: { slots_count: slots.length },
    });

    res.json({ ok: true, data: { date, duration_min: duration, slots } });
  } catch (err) {
    next(err);
  }
}
