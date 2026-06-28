import {
  replaceNpsSurveys,
  listNpsPendingResults,
  markNpsResultSynced,
} from "../services/nps.service.js";
import { logger } from "../lib/logger.js";

// POST /api/sync/nps-surveys  — front envia os questionários ativos da clínica
export function syncNpsSurveysController(req, res, next) {
  try {
    const { clinic_id, surveys } = req.body ?? {};
    if (!clinic_id) {
      return res.status(400).json({ ok: false, error: "clinic_id é obrigatório" });
    }
    const count = replaceNpsSurveys(clinic_id, surveys ?? []);
    logger.info({ clinicId: clinic_id, count }, "[NPS] Questionários sincronizados");
    res.json({ ok: true, success: true, synced: count });
  } catch (err) {
    next(err);
  }
}

// GET /api/clinics/:clinicId/nps/pending-results — respostas captadas, a gravar no Supabase
export function listNpsPendingResultsController(req, res, next) {
  try {
    const clinicId = req.params.clinicId ?? req.query.clinic_id;
    if (!clinicId) {
      return res.status(400).json({ ok: false, error: "clinic_id é obrigatório" });
    }
    const data = listNpsPendingResults(clinicId);
    res.json({ ok: true, success: true, data });
  } catch (err) {
    next(err);
  }
}

// POST /api/clinics/:clinicId/nps/pending-results/:pendingId/sync-confirm
export function confirmNpsResultSyncController(req, res, next) {
  try {
    const clinicId = req.params.clinicId ?? req.query.clinic_id;
    const { pendingId } = req.params;
    const { supabase_id } = req.body ?? {};
    const record = markNpsResultSynced(clinicId, pendingId, supabase_id);
    if (!record) {
      return res.status(404).json({ ok: false, error: "Resposta NPS não encontrada" });
    }
    res.json({ ok: true, success: true });
  } catch (err) {
    next(err);
  }
}
