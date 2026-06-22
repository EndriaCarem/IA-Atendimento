/**
 * Rotas da Secretária IA — endpoints "Agora" e "Próximo"
 *
 * Mount point: /api (em app.js)
 */
import { Router } from "express";

import { publicConfigController } from "../controllers/clinic-config.controller.js";
import { lookupPatientController, patientSummaryController } from "../controllers/patients-ai.controller.js";
import { freeSlotsController } from "../controllers/agenda.controller.js";
import { createAppointmentAiController, updateAppointmentAiController } from "../controllers/appointments-ai.controller.js";
import {
  listConversationsController,
  getConversationMessagesController,
  conversationStreamController,
  handoffController,
  sendMessageController,
  takeoverController,
  releaseTakeoverController,
  clearConversationsController,
  deleteConversationController,
} from "../controllers/conversations.controller.js";
import { gestorChatController } from "../controllers/gestor-ia.controller.js";
import {
  listAutomationsController,
  createAutomationController,
  updateAutomationController,
  deleteAutomationController,
  testAutomationController,
} from "../controllers/automations.controller.js";

const router = Router();

// ── Configuração pública ──────────────────────────────────────────────────────
router.get("/clinics/:clinicId/public-config", publicConfigController);

// ── Pacientes ─────────────────────────────────────────────────────────────────
router.get("/clinics/:clinicId/patients/lookup", lookupPatientController);
router.get("/patients/:patientId/summary",       patientSummaryController);

// ── Agenda ────────────────────────────────────────────────────────────────────
router.get("/clinics/:clinicId/agenda/free-slots", freeSlotsController);

// ── Agendamentos (criados pela IA) ────────────────────────────────────────────
router.post("/clinics/:clinicId/appointments",                    createAppointmentAiController);
router.patch("/clinics/:clinicId/appointments/:appointmentId",    updateAppointmentAiController);

// ── Conversas e painel ────────────────────────────────────────────────────────
router.get("/clinics/:clinicId/conversations",                                    listConversationsController);
router.get("/clinics/:clinicId/conversations/stream",                             conversationStreamController);  // SSE
router.get("/conversations/:convId/messages",                                     getConversationMessagesController);
router.post("/conversations/:convId/handoff",                                     handoffController);
router.post("/conversations/:convId/send",                                        sendMessageController);
// Aliases com /clinics/:clinicId (formato usado pelo frontend aiBackend.ts)
router.get("/clinics/:clinicId/conversations/:convId/messages",                   getConversationMessagesController);
router.post("/clinics/:clinicId/conversations/:convId/handoff",                   handoffController);
router.post("/clinics/:clinicId/conversations/:convId/send",                      sendMessageController);
router.delete("/clinics/:clinicId/conversations",                                  clearConversationsController);
router.post("/clinics/:clinicId/conversations/:convId/takeover",                  takeoverController);
router.delete("/clinics/:clinicId/conversations/:convId/takeover",                releaseTakeoverController);
router.delete("/clinics/:clinicId/conversations/:convId",                         deleteConversationController);

// ── IA Gestor (chat interno operacional) ──────────────────────────────────────
router.post("/clinics/:clinicId/gestor/chat", gestorChatController);

// ── Automações ────────────────────────────────────────────────────────────────
router.get("/clinics/:clinicId/automations",                    listAutomationsController);
router.post("/clinics/:clinicId/automations",                   createAutomationController);
router.post("/clinics/:clinicId/automations/test",             testAutomationController);
router.patch("/clinics/:clinicId/automations/:automationId",    updateAutomationController);
router.delete("/clinics/:clinicId/automations/:automationId",   deleteAutomationController);

export default router;
