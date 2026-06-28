/**
 * Rotas de sincronização — Lovable → Backend
 * Mount point: /api (em app.js)
 */
import { Router } from "express";
import {
  syncConfigController,
  syncPatientController,
  syncPatientsController,
  syncAvailabilityController,
  syncAppointmentsController,
  syncDoctorController,
  syncDoctorsController,
  listAiAppointmentsController,
  syncConfirmAppointmentController,
} from "../controllers/sync.controller.js";
import {
  syncNpsSurveysController,
  listNpsPendingResultsController,
  confirmNpsResultSyncController,
} from "../controllers/nps.controller.js";

const router = Router();

// Lovable empürra dados para o backend
router.post("/sync/config",        syncConfigController);
router.post("/sync/patient",       syncPatientController);
router.post("/sync/patients",      syncPatientsController);
router.post("/sync/availability",  syncAvailabilityController);
router.post("/sync/appointments",  syncAppointmentsController);
router.post("/sync/doctor",        syncDoctorController);
router.post("/sync/doctors",       syncDoctorsController);

// Lovable lê agendamentos criados pela IA (para criar no Supabase)
router.get("/clinics/:clinicId/appointments",                              listAiAppointmentsController);
router.post("/clinics/:clinicId/appointments/:appointmentId/sync-confirm", syncConfirmAppointmentController);

// NPS — front envia questionários e lê respostas captadas pela IA
router.post("/sync/nps-surveys",                                             syncNpsSurveysController);
router.get("/clinics/:clinicId/nps/pending-results",                        listNpsPendingResultsController);
router.post("/clinics/:clinicId/nps/pending-results/:pendingId/sync-confirm", confirmNpsResultSyncController);
// Aliases usados por checklists/integrações antigas.
router.get("/nps/pending-results",                                           listNpsPendingResultsController);
router.post("/nps/pending-results/:pendingId/sync-confirm",                  confirmNpsResultSyncController);

export default router;
