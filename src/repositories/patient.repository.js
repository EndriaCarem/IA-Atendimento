import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import { dbFindOne, dbInsert } from "../lib/json-db.js";
import { buildPhoneCandidates } from "../utils/phone.js";

export async function findPatientByClinicAndPhone(clinicId, rawPhone) {
  if (!clinicId || !rawPhone) {
    return null;
  }

  const phoneCandidates = buildPhoneCandidates(rawPhone);

  if (phoneCandidates.length === 0) {
    return null;
  }

  const phoneSet = new Set(phoneCandidates);

  const data = dbFindOne(
    env.TABLE_PATIENTS,
    (r) =>
      r[env.COL_PATIENT_CLINIC_ID] === clinicId &&
      phoneSet.has(r[env.COL_PATIENT_PHONE])
  );

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    clinicId: data[env.COL_PATIENT_CLINIC_ID],
    name: data.full_name ?? data.name ?? null,
    phone: data[env.COL_PATIENT_PHONE] ?? null
  };
}

// Normaliza CPF: mantém só dígitos (compara "123.456.789-00" == "12345678900").
function onlyDigits(v) {
  return String(v ?? "").replace(/\D/g, "");
}

// Busca paciente por CPF (identificador único). Usado para evitar cadastro
// duplicado — inclusive quando se agenda para outra pessoa no mesmo telefone.
export async function findPatientByClinicAndCpf(clinicId, rawCpf) {
  const cpf = onlyDigits(rawCpf);
  if (!clinicId || cpf.length < 11) return null;

  const data = dbFindOne(
    env.TABLE_PATIENTS,
    (r) => r[env.COL_PATIENT_CLINIC_ID] === clinicId && onlyDigits(r.cpf) === cpf
  );
  if (!data) return null;

  return {
    id: data.id,
    clinicId: data[env.COL_PATIENT_CLINIC_ID],
    name: data.full_name ?? data.name ?? null,
    phone: data[env.COL_PATIENT_PHONE] ?? null,
    cpf: data.cpf ?? null,
  };
}

/**
 * Cria um paciente PROVISÓRIO no backend local (json-db) quando a IA agenda
 * para alguém que ainda não está cadastrado. Marcado com source="ai" e
 * sync_status="pending" para o Lovable criar o paciente real no Supabase depois.
 */
export async function createProvisionalPatient({ clinicId, phone, name, dateOfBirth = null, cpf = null }) {
  if (!clinicId || !phone) return null;

  const record = {
    id: randomUUID(),
    [env.COL_PATIENT_CLINIC_ID]: clinicId,
    [env.COL_PATIENT_PHONE]: phone,
    full_name: name ?? null,
    date_of_birth: dateOfBirth ?? null, // coletado pela IA → habilita aniversário
    cpf: cpf ? onlyDigits(cpf) : null,  // identificador único (evita duplicar)
    source: "ai",
    sync_status: "pending",
    provisional: true,
    created_at: new Date().toISOString(),
  };

  const data = dbInsert(env.TABLE_PATIENTS, record);

  return {
    id: data.id,
    clinicId: data[env.COL_PATIENT_CLINIC_ID],
    name: data.full_name ?? null,
    phone: data[env.COL_PATIENT_PHONE] ?? null,
    dateOfBirth: data.date_of_birth ?? null,
    cpf: data.cpf ?? null,
  };
}
