import { Router } from "express";
import {
  listAllData,
  listCollection,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  reloadDb,
  upsertAiSecretaryConfig,
} from "../controllers/data.controller.js";

const router = Router();

router.get("/data", listAllData);
router.post("/data/_reload", reloadDb);
router.get("/data/:collection", listCollection);
router.get("/data/:collection/:id", getRecord);
router.post("/data/:collection", createRecord);
// Rota específica antes da genérica — Express resolve por ordem de registro.
// Intercepta PATCH /api/data/ai_secretary_config/:id com upsert seguro.
// O handler genérico updateRecord não é alterado.
router.patch("/data/ai_secretary_config/:id", upsertAiSecretaryConfig);
router.patch("/data/:collection/:id", updateRecord);
router.delete("/data/:collection/:id", deleteRecord);

export default router;
