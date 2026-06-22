import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const optionalNonEmptyString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());

const optionalUrlString = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().url().optional());

function isLocalEvolutionUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host);
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3333),

    // Supabase não é acessado diretamente pelo backend.
    // Dados clínicos chegam via /api/sync/* (Lovable → backend).
    // Estas variáveis existem apenas para compatibilidade com scripts auxiliares.
    SUPABASE_URL: optionalUrlString,
    SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,

    AI_PROVIDER: z.enum(["gemini", "ollama", "groq"]).default("gemini"),

    GEMINI_API_KEY: optionalNonEmptyString,
    GEMINI_MODEL: z.string().default("gemini-2.0-flash"),

    GROQ_API_KEY: optionalNonEmptyString,
    GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),

    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
    OLLAMA_MODEL: z.string().default("llama3.1:8b"),
    OLLAMA_KEEP_ALIVE: z.string().default("30m"),

    PUBLIC_BACKEND_URL: optionalUrlString,

    // Supabase do projeto Lovable (dados clínicos: pacientes, agenda, etc.)
    // Obtido em: Lovable → Settings → API → Project URL + service_role key
    LOVABLE_SUPABASE_URL: optionalUrlString,
    LOVABLE_SUPABASE_SERVICE_KEY: optionalNonEmptyString,

    EVOLUTION_API_URL: optionalUrlString,
    EVOLUTION_API_KEY: optionalNonEmptyString,
    EVOLUTION_WEBHOOK_SECRET: optionalNonEmptyString,

    TABLE_CLINICS: z.string().default("clinics"),
    TABLE_AI_CONFIG: z.string().default("ai_secretary_config"),
    TABLE_AI_HANDOFF: z.string().default("ai_secretary_handoff"),
    TABLE_WHATSAPP_MESSAGES: z.string().default("whatsapp_messages"),
    TABLE_WHATSAPP_INSTANCES: z.string().default("whatsapp_instances"),
    TABLE_PATIENTS: z.string().default("patients"),
    TABLE_APPOINTMENTS: z.string().default("appointments"),

    COL_INSTANCE_NAME: z.string().default("instance_name"),
    COL_INSTANCE_CLINIC_ID: z.string().default("clinic_id"),
    COL_AI_CONFIG_CLINIC_ID: z.string().default("clinic_id"),
    COL_AI_CONFIG_PROMPT: z.string().default("custom_prompt"),
    COL_PATIENT_CLINIC_ID: z.string().default("clinic_id"),
    COL_PATIENT_PHONE: z.string().default("phone"),
    COL_APPOINTMENT_CLINIC_ID: z.string().default("clinic_id"),
    COL_APPOINTMENT_PATIENT_ID: z.string().default("patient_id"),
    COL_APPOINTMENT_DATETIME: z.string().default("scheduled_at"),
    COL_APPOINTMENT_STATUS: z.string().default("status"),
    COL_APPOINTMENT_NOTES: z.string().default("notes"),

    DEFAULT_TIMEZONE: z.string().default("America/Sao_Paulo")
  })
  .superRefine((raw, ctx) => {
    const hasEvolutionUrl = Boolean(raw.EVOLUTION_API_URL);
    const hasEvolutionKey = Boolean(raw.EVOLUTION_API_KEY);

    if (hasEvolutionUrl !== hasEvolutionKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "EVOLUTION_API_URL and EVOLUTION_API_KEY must be provided together.",
        path: ["EVOLUTION_API_URL"]
      });
    }

    if (raw.AI_PROVIDER === "gemini" && !raw.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini.",
        path: ["GEMINI_API_KEY"]
      });
    }

    if (raw.AI_PROVIDER === "groq" && !raw.GROQ_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GROQ_API_KEY is required when AI_PROVIDER=groq.",
        path: ["GROQ_API_KEY"]
      });
    }

    // Evolution API on same server (Docker) is fine — only warn
    if (raw.NODE_ENV === "production" && isLocalEvolutionUrl(raw.EVOLUTION_API_URL)) {
      // eslint-disable-next-line no-console
      console.warn("⚠ EVOLUTION_API_URL is localhost in production. OK if Evolution runs on the same server via Docker.");
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
