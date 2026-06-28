/**
 * GET /api/clinics/:clinicId/public-config
 *
 * Snapshot leve e cacheável da configuração pública da clínica:
 * horários de funcionamento, convênios, procedimentos, salas e médicos.
 * A Secretária IA consulta este endpoint no início de cada conversa.
 *
 * Requer: LOVABLE_SUPABASE_URL + LOVABLE_SUPABASE_SERVICE_KEY no .env
 */
import { getPublicConfig } from "../repositories/clinic-data.repository.js";
import { logAiAction } from "../lib/action-log.js";

export function publicConfigController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const config = getPublicConfig(clinicId);

    logAiAction({
      clinicId,
      action: "public_config_read",
      result: { procedures: config.procedures.length, doctors: config.doctors.length },
    });

    res.json({ ok: true, data: config });
  } catch (err) {
    next(err);
  }
}
