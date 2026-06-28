import { dbFind, dbFindOne, dbUpsert, dbDeleteOne } from "../lib/json-db.js";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { renderAutomationTemplate } from "../services/automation-template.service.js";
import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { findClinicById } from "../repositories/clinic.repository.js";
import { sendEvolutionTextMessage } from "../lib/evolution.js";
import { normalizePhone } from "../utils/phone.js";

const VALID_TYPES = ["appointment_reminder", "return", "confirmation", "reschedule", "escalate", "birthday", "nps"];

export function listAutomationsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const records = dbFind("automations", (a) => a.clinic_id === clinicId);
    // Expõe campos duplicados para compatibilidade com o frontend
    const normalized = records.map((r) => ({
      ...r,
      active: r.enabled,
      message: r.message_template,
      template: r.message_template,
    }));
    res.json({ ok: true, data: normalized });
  } catch (err) {
    next(err);
  }
}

export function createAutomationController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const body = req.body ?? {};
    const { type, trigger, name } = body;

    // aceita tanto enabled quanto active (compatibilidade com o frontend)
    const enabled = body.enabled ?? body.active ?? true;
    // aceita tanto message_template quanto message ou template
    const message_template = body.message_template ?? body.message ?? body.template ?? null;

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({
        ok: false,
        error: `type inválido. Use: ${VALID_TYPES.join(", ")}`
      });
    }

    const record = dbUpsert(
      "automations",
      {
        id: randomUUID(),
        clinic_id: clinicId,
        name: name ?? type,
        type,
        enabled: Boolean(enabled),
        trigger: trigger ?? null,
        message_template: message_template ?? "",
        trigger_keywords: body.trigger_keywords ?? null,
        target_phone: body.target_phone ?? null,
        return_after_days: body.return_after_days ?? null,
        created_at: new Date().toISOString()
      },
      "id"
    );

    logger.info({ clinicId, type, id: record.id }, "[AUTOMATION] Criada");
    res.status(201).json({ ok: true, data: record });
  } catch (err) {
    next(err);
  }
}

export function updateAutomationController(req, res, next) {
  try {
    const { clinicId, automationId } = req.params;
    const existing = dbFindOne("automations", (a) => a.id === automationId && a.clinic_id === clinicId);

    if (!existing) {
      return res.status(404).json({ ok: false, error: "Automação não encontrada" });
    }

    const body = req.body ?? {};
    const updates = {};

    if (body.name !== undefined) updates.name = body.name;
    // aceita tanto enabled quanto active
    const enabledVal = body.enabled ?? body.active;
    if (enabledVal !== undefined) updates.enabled = Boolean(enabledVal);
    if (body.trigger !== undefined) updates.trigger = body.trigger;
    // aceita tanto message_template quanto message ou template
    const msgVal = body.message_template ?? body.message ?? body.template;
    if (msgVal !== undefined) updates.message_template = msgVal;
    if (body.trigger_keywords !== undefined) updates.trigger_keywords = body.trigger_keywords;
    if (body.target_phone !== undefined) updates.target_phone = body.target_phone;
    if (body.return_after_days !== undefined) updates.return_after_days = body.return_after_days;

    const record = dbUpsert(
      "automations",
      { ...existing, ...updates, updated_at: new Date().toISOString() },
      "id"
    );

    logger.info({ clinicId, automationId, enabled: record.enabled }, "[AUTOMATION] Atualizada");
    res.json({ ok: true, data: record });
  } catch (err) {
    next(err);
  }
}

// POST /api/clinics/:clinicId/automations/test
// Envia uma mensagem de teste para um número, usando o template informado.
// Body: { message_template, phone, type? }
export async function testAutomationController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const body = req.body ?? {};
    const template = body.message_template ?? body.message ?? body.template;
    const rawPhone = body.phone;

    if (!template || !rawPhone) {
      return res.status(400).json({ ok: false, error: "message_template e phone são obrigatórios" });
    }

    const mapping = await findInstanceByClinicId(clinicId);
    if (!mapping?.instanceName) {
      return res.status(409).json({ ok: false, error: "WhatsApp não conectado para esta clínica" });
    }

    const clinic = await findClinicById(clinicId).catch(() => null);
    // Dados fictícios para preview das variáveis
    const text = renderAutomationTemplate(template, {
      patient_name: "Maria",
      start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      doctor: "Dr. Exemplo",
      procedure: "Consulta",
      clinic_name: clinic?.name ?? "",
    });

    await sendEvolutionTextMessage({
      instanceName: mapping.instanceName,
      number: normalizePhone(rawPhone),
      text,
    });

    logger.info({ clinicId, phone: rawPhone }, "[AUTOMATION] Mensagem de teste enviada");
    res.json({ ok: true, sent_text: text });
  } catch (err) {
    next(err);
  }
}

export function deleteAutomationController(req, res, next) {
  try {
    const { clinicId, automationId } = req.params;
    const deleted = dbDeleteOne("automations", (a) => a.id === automationId && a.clinic_id === clinicId);

    if (!deleted) {
      return res.status(404).json({ ok: false, error: "Automação não encontrada" });
    }

    logger.info({ clinicId, automationId }, "[AUTOMATION] Removida");
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
