/**
 * Supabase client apontando para o projeto Lovable (dados clínicos).
 * Diferente do projeto legado morto (htjaiqfrkvhtqjxckniz).
 *
 * Configure no .env:
 *   LOVABLE_SUPABASE_URL=https://SEU_PROJECT.supabase.co
 *   LOVABLE_SUPABASE_SERVICE_KEY=eyJhbGci...
 *
 * Como obter:
 *   Lovable → Settings → API → Project URL + service_role key
 */
import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger.js";
import { AppError } from "../utils/http-error.js";

const url = process.env.LOVABLE_SUPABASE_URL?.trim();
const key = process.env.LOVABLE_SUPABASE_SERVICE_KEY?.trim();

if (!url || !key) {
  logger.warn(
    "LOVABLE_SUPABASE_URL ou LOVABLE_SUPABASE_SERVICE_KEY não configurados. " +
    "Endpoints que leem dados clínicos (public-config, pacientes, agenda) retornarão 503."
  );
}

export const supabaseClinic = url && key
  ? createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

/** Lança AppError 503 se as credenciais Lovable não estiverem configuradas */
export function requireClinicDb() {
  if (!supabaseClinic) {
    throw new AppError(
      "Credenciais Lovable Supabase não configuradas. " +
      "Adicione LOVABLE_SUPABASE_URL e LOVABLE_SUPABASE_SERVICE_KEY no .env",
      503
    );
  }
  return supabaseClinic;
}
