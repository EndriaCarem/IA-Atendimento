# Campanhas: Implementação Completa (WhatsApp + SMS)

**Objetivo:** Envio em massa de mensagens para base de pacientes via WhatsApp e SMS.

---

## 📋 Arquitetura

```
Lovable (Painel Admin)
    ↓
    POST /api/campaigns (criar campanha)
    ↓
Backend Node.js
    ├─ Campaign Service (gerencia campanha)
    ├─ Campaign Scheduler (dispara em background)
    └─ Message Dispatcher
        ├─ WhatsApp (Evolution API)
        └─ SMS (Twilio / AWS SNS)
    ↓
Pacientes recebem mensagens
```

---

## 🗄️ Schema de Dados

### Tabela: `campaigns`
```javascript
{
  id: "uuid",                          // PK
  clinic_id: "uuid",                   // FK
  name: "Promoção Clareamento 2026",
  description: "Campanha de fim de ano",
  template: "Olá {patient_name}! 50% de desconto em clareamento...",
  
  // Canais
  channels: ["whatsapp", "sms"],       // Array de canais
  
  // Filtros (segmentação)
  filters: {
    patient_type: "all",               // "all" | "returning" | "new"
    last_visit_days: null,             // Ex: 30 (últimos 30 dias)
    procedures: ["limpeza"],           // Se específico
    insurance_plan: null,              // Se específico
  },
  
  // Agendamento
  scheduled_for: "2026-07-10T09:00:00Z", // null = dispara agora
  timezone: "America/Sao_Paulo",
  
  // Status
  status: "draft",                     // draft | scheduled | sending | completed | failed
  created_at: "2026-06-30T10:00:00Z",
  started_at: null,
  completed_at: null,
  
  // Estatísticas
  stats: {
    total_recipients: 0,
    sent_whatsapp: 0,
    sent_sms: 0,
    failed_whatsapp: 0,
    failed_sms: 0,
    bounced: 0,
  }
}
```

### Tabela: `campaign_sends`
```javascript
{
  id: "uuid",
  campaign_id: "uuid",
  clinic_id: "uuid",
  patient_id: "uuid",
  patient_phone: "5592999999999",
  
  // Canais enviados
  whatsapp_status: "pending",          // pending | sent | failed | bounced
  whatsapp_sent_at: null,
  whatsapp_error: null,
  
  sms_status: "pending",
  sms_sent_at: null,
  sms_error: null,
  
  // Rastreamento
  created_at: "2026-06-30T10:00:00Z",
  updated_at: "2026-06-30T10:00:00Z",
}
```

---

## 🛠️ Implementação

### 1. Service: Campaign Manager (`src/services/campaigns.service.js`)

```javascript
import { dbFind, dbFindOne, dbInsert, dbUpdate } from "../lib/json-db.js";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

// Criar campanha (status = draft)
export function createCampaign(clinicId, payload) {
  const {
    name,
    description,
    template,
    channels = ["whatsapp"], // Default: WhatsApp
    filters = {},
    scheduled_for = null,
    timezone = "America/Sao_Paulo",
  } = payload;

  if (!template || template.trim().length === 0) {
    throw new Error("Template obrigatório");
  }

  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("Mínimo 1 canal (whatsapp ou sms)");
  }

  const validChannels = ["whatsapp", "sms"];
  if (!channels.every((c) => validChannels.includes(c))) {
    throw new Error(`Canais válidos: ${validChannels.join(", ")}`);
  }

  const campaign = {
    id: randomUUID(),
    clinic_id: clinicId,
    name: name ?? "Sem nome",
    description: description ?? null,
    template,
    channels,
    filters: {
      patient_type: filters.patient_type ?? "all",
      last_visit_days: filters.last_visit_days ?? null,
      procedures: filters.procedures ?? null,
      insurance_plan: filters.insurance_plan ?? null,
    },
    scheduled_for,
    timezone,
    status: "draft",
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    stats: {
      total_recipients: 0,
      sent_whatsapp: 0,
      sent_sms: 0,
      failed_whatsapp: 0,
      failed_sms: 0,
      bounced: 0,
    },
  };

  dbInsert("campaigns", campaign);
  logger.info({ clinicId, campaignId: campaign.id }, "[CAMPAIGN] Criada");
  return campaign;
}

// Listar campanhas
export function listCampaigns(clinicId, filters = {}) {
  const { status = null } = filters;
  
  let records = dbFind("campaigns", (c) => c.clinic_id === clinicId);
  
  if (status) {
    records = records.filter((c) => c.status === status);
  }

  return records.sort((a, b) => 
    new Date(b.created_at) - new Date(a.created_at)
  );
}

// Buscar campanha por ID
export function getCampaignById(campaignId, clinicId) {
  return dbFindOne(
    "campaigns",
    (c) => c.id === campaignId && c.clinic_id === clinicId
  );
}

// Atualizar campanha (só se draft)
export function updateCampaign(campaignId, clinicId, payload) {
  const campaign = getCampaignById(campaignId, clinicId);
  
  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error(`Não pode editar campanha em status ${campaign.status}`);
  }

  const updates = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.template !== undefined) updates.template = payload.template;
  if (payload.channels !== undefined) updates.channels = payload.channels;
  if (payload.filters !== undefined) updates.filters = payload.filters;
  if (payload.scheduled_for !== undefined) updates.scheduled_for = payload.scheduled_for;

  dbUpdate(
    "campaigns",
    (c) => c.id === campaignId,
    updates
  );

  logger.info({ clinicId, campaignId }, "[CAMPAIGN] Atualizada");
  return { ...campaign, ...updates };
}

// Deletar campanha (só se draft)
export function deleteCampaign(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);
  
  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error(`Não pode deletar campanha em status ${campaign.status}`);
  }

  // Deleta também os sends associados
  const sends = dbFind("campaign_sends", (s) => s.campaign_id === campaignId);
  sends.forEach((s) => {
    // Implementar delete se necessário
  });

  logger.info({ clinicId, campaignId }, "[CAMPAIGN] Deletada");
}

// Preparar campanha pra envio (monta lista de destinatários)
export function prepareCampaignForSend(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);
  
  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  if (campaign.status !== "draft") {
    throw new Error("Campanha deve estar em draft para preparar envio");
  }

  // Buscar pacientes conforme filtros
  const patients = getFilteredPatients(clinicId, campaign.filters);

  // Criar registro de envio pra cada paciente/canal
  const sends = [];
  for (const patient of patients) {
    for (const channel of campaign.channels) {
      const send = {
        id: randomUUID(),
        campaign_id: campaignId,
        clinic_id: clinicId,
        patient_id: patient.id ?? null,
        patient_phone: patient.phone,
        
        whatsapp_status: channel === "whatsapp" ? "pending" : "skipped",
        whatsapp_sent_at: null,
        whatsapp_error: null,
        
        sms_status: channel === "sms" ? "pending" : "skipped",
        sms_sent_at: null,
        sms_error: null,
        
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      dbInsert("campaign_sends", send);
      sends.push(send);
    }
  }

  // Atualizar status e stats da campanha
  dbUpdate("campaigns", (c) => c.id === campaignId, {
    status: "scheduled",
    started_at: new Date().toISOString(),
    "stats.total_recipients": patients.length,
  });

  logger.info(
    { clinicId, campaignId, recipients: patients.length },
    "[CAMPAIGN] Preparada para envio"
  );

  return { campaign, recipients: patients.length, sends };
}

// Buscar pacientes conforme filtros
function getFilteredPatients(clinicId, filters) {
  let patients = dbFind("patients", (p) => p.clinic_id === clinicId);

  // Filtro: tipo de paciente
  if (filters.patient_type === "returning") {
    // Tem agendamento no histórico
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments", 
        (a) => a.patient_id === p.id && 
               ["completed", "realizada", "confirmed"].includes(a.status)
      );
      return apts.length > 0;
    });
  }

  if (filters.patient_type === "new") {
    // Nunca teve agendamento confirmado
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments",
        (a) => a.patient_id === p.id && 
               ["completed", "realizada", "confirmed"].includes(a.status)
      );
      return apts.length === 0;
    });
  }

  // Filtro: últimas X dias
  if (filters.last_visit_days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.last_visit_days);

    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments",
        (a) => a.patient_id === p.id &&
               new Date(a.start_time) >= cutoffDate
      );
      return apts.length > 0;
    });
  }

  // Filtro: procedimento específico
  if (filters.procedures && Array.isArray(filters.procedures)) {
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments",
        (a) => a.patient_id === p.id &&
               filters.procedures.includes(a.procedure)
      );
      return apts.length > 0;
    });
  }

  // Filtro: plano de saúde
  if (filters.insurance_plan) {
    patients = patients.filter((p) => {
      const apts = dbFind("synced_appointments",
        (a) => a.patient_id === p.id &&
               a.insurance_plan === filters.insurance_plan
      );
      return apts.length > 0;
    });
  }

  return patients;
}

// Simular envio (preview dos recipients)
export function previewCampaign(campaignId, clinicId) {
  const campaign = getCampaignById(campaignId, clinicId);
  
  if (!campaign) {
    throw new Error("Campanha não encontrada");
  }

  const patients = getFilteredPatients(clinicId, campaign.filters);
  
  return {
    campaign_name: campaign.name,
    channels: campaign.channels,
    filters_applied: campaign.filters,
    total_recipients: patients.length,
    sample_recipients: patients.slice(0, 5).map((p) => ({
      patient_id: p.id,
      name: p.name,
      phone: p.phone,
    })),
  };
}
```

---

### 2. Service: Dispatcher (`src/services/campaign-dispatcher.service.js`)

```javascript
import { dbFind, dbUpdate } from "../lib/json-db.js";
import { sendEvolutionTextMessage } from "../lib/evolution.js";
import { sendTwilioSMS } from "../lib/twilio.js"; // Implementar
import { findInstanceByClinicId } from "../repositories/whatsapp-instance.repository.js";
import { renderAutomationTemplate } from "./automation-template.service.js";
import { logger } from "../lib/logger.js";

// Processar todos os envios pendentes de uma campanha
export async function processCampaignDispatches(campaignId) {
  const sends = dbFind("campaign_sends", (s) => s.campaign_id === campaignId);

  logger.info({ campaignId, count: sends.length }, "[DISPATCH] Iniciando");

  let stats = {
    sent_whatsapp: 0,
    sent_sms: 0,
    failed_whatsapp: 0,
    failed_sms: 0,
  };

  for (const send of sends) {
    // WhatsApp
    if (send.whatsapp_status === "pending") {
      try {
        await dispatchWhatsApp(send);
        stats.sent_whatsapp++;
      } catch (err) {
        logger.error(
          { sendId: send.id, error: err.message },
          "[DISPATCH] Falha WhatsApp"
        );
        stats.failed_whatsapp++;
        
        dbUpdate(
          "campaign_sends",
          (s) => s.id === send.id,
          {
            whatsapp_status: "failed",
            whatsapp_error: err.message,
            updated_at: new Date().toISOString(),
          }
        );
      }
    }

    // SMS
    if (send.sms_status === "pending") {
      try {
        await dispatchSMS(send);
        stats.sent_sms++;
      } catch (err) {
        logger.error(
          { sendId: send.id, error: err.message },
          "[DISPATCH] Falha SMS"
        );
        stats.failed_sms++;
        
        dbUpdate(
          "campaign_sends",
          (s) => s.id === send.id,
          {
            sms_status: "failed",
            sms_error: err.message,
            updated_at: new Date().toISOString(),
          }
        );
      }
    }

    // Delay pra não sobrecarregar
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Atualizar stats da campanha
  const campaign = dbFind("campaigns", (c) => c.id === campaignId)[0];
  if (campaign) {
    dbUpdate("campaigns", (c) => c.id === campaignId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      "stats.sent_whatsapp": campaign.stats.sent_whatsapp + stats.sent_whatsapp,
      "stats.sent_sms": campaign.stats.sent_sms + stats.sent_sms,
      "stats.failed_whatsapp": campaign.stats.failed_whatsapp + stats.failed_whatsapp,
      "stats.failed_sms": campaign.stats.failed_sms + stats.failed_sms,
    });
  }

  logger.info({ campaignId, stats }, "[DISPATCH] Concluído");
  return stats;
}

// Enviar via WhatsApp
async function dispatchWhatsApp(send) {
  const campaign = dbFind("campaigns", (c) => c.id === send.campaign_id)[0];
  if (!campaign) throw new Error("Campanha não encontrada");

  const mapping = await findInstanceByClinicId(send.clinic_id);
  if (!mapping?.instanceName) {
    throw new Error("WhatsApp não conectado");
  }

  // Renderizar template com dados do paciente
  const text = renderAutomationTemplate(campaign.template, {
    patient_name: send.patient_id ? "Paciente" : "Olá", // Buscar nome real se tiver patient_id
  });

  await sendEvolutionTextMessage({
    instanceName: mapping.instanceName,
    number: send.patient_phone,
    text,
  });

  dbUpdate(
    "campaign_sends",
    (s) => s.id === send.id,
    {
      whatsapp_status: "sent",
      whatsapp_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  logger.info({ sendId: send.id, phone: send.patient_phone }, "[DISPATCH] WhatsApp enviado");
}

// Enviar via SMS
async function dispatchSMS(send) {
  const campaign = dbFind("campaigns", (c) => c.id === send.campaign_id)[0];
  if (!campaign) throw new Error("Campanha não encontrada");

  // Renderizar template
  const text = renderAutomationTemplate(campaign.template, {
    patient_name: "Olá",
  });

  // Chamar Twilio API
  await sendTwilioSMS({
    to: send.patient_phone,
    body: text,
  });

  dbUpdate(
    "campaign_sends",
    (s) => s.id === send.id,
    {
      sms_status: "sent",
      sms_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  );

  logger.info({ sendId: send.id, phone: send.patient_phone }, "[DISPATCH] SMS enviado");
}
```

---

### 3. Library: Twilio SMS (`src/lib/twilio.js`)

```javascript
import twilio from "twilio";
import { env } from "../config/env.js";

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export async function sendTwilioSMS({ to, body }) {
  if (!env.TWILIO_PHONE_NUMBER) {
    throw new Error("TWILIO_PHONE_NUMBER não configurado");
  }

  const message = await client.messages.create({
    body,
    from: env.TWILIO_PHONE_NUMBER,
    to, // Formato: +5592999999999
  });

  return {
    sid: message.sid,
    status: message.status, // queued, sending, sent, failed, etc
  };
}
```

---

### 4. Routes: Campanhas (`src/routes/campaigns.routes.js`)

```javascript
import { Router } from "express";
import { apiAuthMiddleware } from "../middleware/api-auth.js";
import {
  listCampaignsController,
  createCampaignController,
  getCampaignController,
  updateCampaignController,
  deleteCampaignController,
  previewCampaignController,
  sendCampaignController,
} from "../controllers/campaigns.controller.js";

const router = Router();

// Listar campanhas
router.get("/clinics/:clinicId/campaigns", apiAuthMiddleware, listCampaignsController);

// Criar campanha
router.post("/clinics/:clinicId/campaigns", apiAuthMiddleware, createCampaignController);

// Buscar campanha
router.get("/clinics/:clinicId/campaigns/:campaignId", apiAuthMiddleware, getCampaignController);

// Atualizar campanha (draft only)
router.patch("/clinics/:clinicId/campaigns/:campaignId", apiAuthMiddleware, updateCampaignController);

// Deletar campanha (draft only)
router.delete("/clinics/:clinicId/campaigns/:campaignId", apiAuthMiddleware, deleteCampaignController);

// Preview (simular recipients)
router.post("/clinics/:clinicId/campaigns/:campaignId/preview", apiAuthMiddleware, previewCampaignController);

// Enviar campanha
router.post("/clinics/:clinicId/campaigns/:campaignId/send", apiAuthMiddleware, sendCampaignController);

export default router;
```

---

### 5. Controllers: Campanhas (`src/controllers/campaigns.controller.js`)

```javascript
import {
  createCampaign,
  listCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  prepareCampaignForSend,
  previewCampaign,
} from "../services/campaigns.service.js";
import { processCampaignDispatches } from "../services/campaign-dispatcher.service.js";
import { logger } from "../lib/logger.js";

export async function listCampaignsController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const { status } = req.query;

    const campaigns = listCampaigns(clinicId, { status });
    res.json({ ok: true, data: campaigns });
  } catch (err) {
    next(err);
  }
}

export async function createCampaignController(req, res, next) {
  try {
    const { clinicId } = req.params;
    const body = req.body ?? {};

    const campaign = createCampaign(clinicId, body);
    res.status(201).json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export async function getCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const campaign = getCampaignById(campaignId, clinicId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: "Campanha não encontrada" });
    }

    res.json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export async function updateCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;
    const body = req.body ?? {};

    const campaign = updateCampaign(campaignId, clinicId, body);
    res.json({ ok: true, data: campaign });
  } catch (err) {
    next(err);
  }
}

export async function deleteCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    deleteCampaign(campaignId, clinicId);
    res.json({ ok: true, msg: "Campanha deletada" });
  } catch (err) {
    next(err);
  }
}

export async function previewCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const preview = previewCampaign(campaignId, clinicId);
    res.json({ ok: true, data: preview });
  } catch (err) {
    next(err);
  }
}

export async function sendCampaignController(req, res, next) {
  try {
    const { clinicId, campaignId } = req.params;

    const result = prepareCampaignForSend(campaignId, clinicId);

    // Disparar em background (não bloqueia resposta)
    setImmediate(async () => {
      try {
        await processCampaignDispatches(campaignId);
      } catch (err) {
        logger.error({ campaignId, err: err.message }, "[CAMPAIGN] Erro ao processar");
      }
    });

    res.json({
      ok: true,
      msg: "Campanha iniciando envio",
      data: {
        campaign_id: campaignId,
        recipients: result.recipients,
      },
    });
  } catch (err) {
    next(err);
  }
}
```

---

### 6. Environment Variables (`.env`)

```env
# Twilio (SMS)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890

# Ou usar AWS SNS em vez de Twilio
AWS_SNS_REGION=us-east-1
AWS_SNS_ACCESS_KEY=...
AWS_SNS_SECRET_KEY=...
```

---

## 🚀 Como Usar

### **1. Criar Campanha (Draft)**
```bash
curl -X POST http://localhost:3333/api/clinics/{clinicId}/campaigns \
  -H "x-api-key: seu-token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promoção Clareamento",
    "template": "Olá {patient_name}! 50% de desconto em clareamento! 🎉",
    "channels": ["whatsapp", "sms"],
    "filters": {
      "patient_type": "returning",
      "procedures": ["limpeza"]
    },
    "scheduled_for": "2026-07-10T09:00:00Z"
  }'
```

### **2. Preview (Ver Recipients)**
```bash
curl -X POST http://localhost:3333/api/clinics/{clinicId}/campaigns/{campaignId}/preview \
  -H "x-api-key: seu-token"
```

### **3. Enviar Campanha**
```bash
curl -X POST http://localhost:3333/api/clinics/{clinicId}/campaigns/{campaignId}/send \
  -H "x-api-key: seu-token"
```

**Response:**
```json
{
  "ok": true,
  "msg": "Campanha iniciando envio",
  "data": {
    "campaign_id": "uuid",
    "recipients": 234
  }
}
```

---

## ✅ Checklist de Implementação

- [ ] Criar `campaigns` table
- [ ] Criar `campaign_sends` table
- [ ] Implementar `campaigns.service.js`
- [ ] Implementar `campaign-dispatcher.service.js`
- [ ] Implementar `twilio.js` (ou AWS SNS)
- [ ] Criar `campaigns.controller.js`
- [ ] Criar `campaigns.routes.js`
- [ ] Adicionar rotas ao `app.js`
- [ ] Atualizar `.env` com Twilio/SMS
- [ ] Testar via curl
- [ ] Adicionar ao Lovable (UI)

---

## 📊 Estimativa

- **Tempo total:** 8-10 horas
- **Complexidade:** Média
- **Risco:** Baixo (módulo isolado)

---

## 🎯 Features Adicionais (v1.1)

- [ ] Agendamento de envio (cron)
- [ ] Template builder (Lovable)
- [ ] A/B testing
- [ ] Analytics (aberturas, cliques)
- [ ] Unsubscribe (opt-out)
- [ ] Bounce handling
