-- Secretaria IA panel support tables

CREATE TABLE IF NOT EXISTS public.ai_secretary_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  target_user_id uuid,
  target_phone text,
  trigger_keywords text,
  handoff_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_secretary_handoff_clinic_id
  ON public.ai_secretary_handoff (clinic_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_phone text NOT NULL,
  patient_name text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_text text NOT NULL,
  content text,
  instance_name text,
  external_message_id text,
  intent text,
  ai_handled boolean NOT NULL DEFAULT false,
  handled_by_ai boolean NOT NULL DEFAULT false,
  handoff_requested boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_clinic_created_at
  ON public.whatsapp_messages (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_clinic_phone
  ON public.whatsapp_messages (clinic_id, patient_phone);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_external_message_id
  ON public.whatsapp_messages (external_message_id)
  WHERE external_message_id IS NOT NULL;