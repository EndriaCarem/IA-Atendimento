import { env } from "../config/env.js";
import { dbAll, dbFind, dbFindOne, dbInsert, dbUpdate, dbUpsert, dbDeleteOne, dbReload } from "../lib/json-db.js";
import { logger } from "../lib/logger.js";

const COLLECTION_META = {
  [env.TABLE_CLINICS]: {
    type: "clinic",
    description: "Clínicas cadastradas",
    writable: true
  },
  [env.TABLE_AI_CONFIG]: {
    type: "ai_config",
    description: "Configuração e prompt da Secretária IA por clínica",
    writable: true
  },
  [env.TABLE_AI_HANDOFF]: {
    type: "ai_handoff",
    description: "Regras de handoff para atendente humano",
    writable: true
  },
  [env.TABLE_WHATSAPP_INSTANCES]: {
    type: "whatsapp_instance",
    description: "Instâncias WhatsApp vinculadas por clínica",
    writable: false
  },
  [env.TABLE_PATIENTS]: {
    type: "patient",
    description: "Pacientes cadastrados",
    writable: false
  },
  [env.TABLE_APPOINTMENTS]: {
    type: "appointment",
    description: "Agendamentos criados pela IA",
    writable: true
  },
  [env.TABLE_WHATSAPP_MESSAGES]: {
    type: "whatsapp_message",
    description: "Histórico de mensagens WhatsApp",
    writable: false
  },
  ai_actions_log: {
    type: "ai_audit",
    description: "Audit log de todas as ações executadas pela Secretária IA",
    writable: false
  },
  request_idempotency: {
    type: "idempotency",
    description: "Cache de idempotência para ações da IA (agendamentos duplos, etc.)",
    writable: false
  }
};

function buildBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.get("host");
  return `${proto}://${host}`;
}

/** GET /api/data — full dump classified by collection type */
export function listAllData(req, res) {
  const base = buildBaseUrl(req);
  const db = dbAll();
  const collections = {};

  for (const [name, meta] of Object.entries(COLLECTION_META)) {
    const records = Array.isArray(db[name]) ? db[name] : [];
    const endpoints = {
      list: `GET ${base}/api/data/${name}`,
      get: `GET ${base}/api/data/${name}/:id`,
      create: `POST ${base}/api/data/${name}`
    };
    if (meta.writable) {
      endpoints.update = `PATCH ${base}/api/data/${name}/:id`;
      endpoints.delete = `DELETE ${base}/api/data/${name}/:id`;
    }

    collections[name] = {
      type: meta.type,
      description: meta.description,
      writable: meta.writable,
      endpoints,
      count: records.length,
      records
    };
  }

  res.json({
    _meta: {
      version: "1.0",
      storage: "local-json",
      generated_at: new Date().toISOString(),
      file: "data/db.json"
    },
    collections
  });
}

/** GET /api/data/:collection */
export function listCollection(req, res) {
  const { collection } = req.params;
  const records = dbFind(collection);
  res.json({ collection, count: records.length, records });
}

/** GET /api/data/:collection/:id */
export function getRecord(req, res) {
  const { collection, id } = req.params;
  const record = dbFindOne(collection, (r) => r.id === id);
  if (!record) {
    return res.status(404).json({ error: "Record not found" });
  }
  res.json(record);
}

/** POST /api/data/:collection */
export function createRecord(req, res) {
  const { collection } = req.params;
  const record = dbInsert(collection, req.body ?? {});
  res.status(201).json(record);
}

/** PATCH /api/data/:collection/:id */
export function updateRecord(req, res) {
  const { collection, id } = req.params;
  const meta = COLLECTION_META[collection];
  if (meta && !meta.writable) {
    return res.status(403).json({ error: `Collection '${collection}' is read-only` });
  }
  const updated = dbUpdate(collection, (r) => r.id === id, req.body ?? {});
  if (!updated) {
    return res.status(404).json({ error: "Record not found" });
  }
  res.json(updated);
}

/** DELETE /api/data/:collection/:id */
export function deleteRecord(req, res) {
  const { collection, id } = req.params;
  const meta = COLLECTION_META[collection];
  if (meta && !meta.writable) {
    return res.status(403).json({ error: `Collection '${collection}' is read-only` });
  }
  const deleted = dbDeleteOne(collection, (r) => r.id === id);
  if (!deleted) {
    return res.status(404).json({ error: "Record not found" });
  }
  res.status(204).end();
}

/** POST /api/data/_reload — força reload do db.json do disco */
export function reloadDb(req, res) {
  dbReload();
  res.json({ ok: true, message: "db.json reloaded from disk" });
}

/**
 * PATCH /api/data/ai_secretary_config/:id
 *
 * Handler dedicado para a coleção ai_secretary_config.
 * Usa upsert em vez de update para que a primeira chamada crie o registro
 * quando ainda não existe nenhum com id "config-{clinicId}".
 * O handler genérico updateRecord não é alterado — este intercepta a rota antes.
 */
export function upsertAiSecretaryConfig(req, res) {
  const { id } = req.params;

  const clinic_id = id.startsWith("config-") ? id.slice("config-".length) : null;

  const { id: _ignored, ...body } = req.body ?? {};

  const record = dbUpsert(
    "ai_secretary_config",
    {
      ...body,
      id,
      ...(clinic_id ? { clinic_id } : {}),
    },
    "id"
  );

  logger.info(
    { clinic_id, enabled: record.enabled, id },
    "[CONFIG] ai_secretary_config atualizado"
  );

  res.json({ ok: true });
}
