-- Remaining 16 Lovable migrations adapted to run safely on an existing project.
-- Idempotent where possible.

-- ============================================================================
-- 1) 20260412155642 - statements bucket + imported_transactions
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('statements', 'statements', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload statements'
  ) THEN
    CREATE POLICY "Authenticated users can upload statements"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'statements');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can view own statements'
  ) THEN
    CREATE POLICY "Authenticated users can view own statements"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'statements');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.imported_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_file_url TEXT NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL,
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL DEFAULT 'income',
  category TEXT DEFAULT 'imported',
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.imported_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own imported transactions" ON public.imported_transactions;
CREATE POLICY "Users can view own imported transactions"
ON public.imported_transactions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own imported transactions" ON public.imported_transactions;
CREATE POLICY "Users can insert own imported transactions"
ON public.imported_transactions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own imported transactions" ON public.imported_transactions;
CREATE POLICY "Users can update own imported transactions"
ON public.imported_transactions FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own imported transactions" ON public.imported_transactions;
CREATE POLICY "Users can delete own imported transactions"
ON public.imported_transactions FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- ============================================================================
-- 2) 20260412161505 - clinic_members + multi-tenancy
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clinic_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role app_role NOT NULL DEFAULT 'dentist',
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, user_id)
);

ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_clinic_owner(_user_id uuid, _clinic_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = _user_id AND clinic_id = _clinic_id AND is_owner = true
  )
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_member(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT clinic_id FROM public.clinic_members WHERE user_id = _user_id
$$;

DROP POLICY IF EXISTS "Members can view own clinic members" ON public.clinic_members;
CREATE POLICY "Members can view own clinic members"
ON public.clinic_members FOR SELECT TO authenticated
USING (clinic_id IN (SELECT public.is_clinic_member(auth.uid())));

DROP POLICY IF EXISTS "Owners can insert clinic members" ON public.clinic_members;
CREATE POLICY "Owners can insert clinic members"
ON public.clinic_members FOR INSERT TO authenticated
WITH CHECK (public.is_clinic_owner(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Owners can update clinic members" ON public.clinic_members;
CREATE POLICY "Owners can update clinic members"
ON public.clinic_members FOR UPDATE TO authenticated
USING (public.is_clinic_owner(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Owners can delete clinic members" ON public.clinic_members;
CREATE POLICY "Owners can delete clinic members"
ON public.clinic_members FOR DELETE TO authenticated
USING (public.is_clinic_owner(auth.uid(), clinic_id));

CREATE OR REPLACE FUNCTION public.auto_link_clinic_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.clinic_members (clinic_id, user_id, role, is_owner)
    VALUES (NEW.id, NEW.owner_id, 'admin', true)
    ON CONFLICT (clinic_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_clinic_created_link_owner ON public.clinics;
CREATE TRIGGER on_clinic_created_link_owner
AFTER INSERT ON public.clinics
FOR EACH ROW EXECUTE FUNCTION public.auto_link_clinic_owner();

-- ============================================================================
-- 3) 20260412161852 - fix assign_default_role
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, 'admin'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4) 20260412180118 - clinic-member-based RLS policies
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_belongs_to_clinic(_user_id uuid, _clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = _user_id AND clinic_id = _clinic_id
  )
$$;

-- APPOINTMENTS
DROP POLICY IF EXISTS "Authenticated users can insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Clinic members can insert appointments" ON public.appointments;
CREATE POLICY "Clinic members can insert appointments"
ON public.appointments FOR INSERT TO authenticated
WITH CHECK (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can update appointments" ON public.appointments;
DROP POLICY IF EXISTS "Clinic members can update appointments" ON public.appointments;
CREATE POLICY "Clinic members can update appointments"
ON public.appointments FOR UPDATE TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can view appointments" ON public.appointments;
DROP POLICY IF EXISTS "Clinic members can view appointments" ON public.appointments;
CREATE POLICY "Clinic members can view appointments"
ON public.appointments FOR SELECT TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

-- PATIENTS
DROP POLICY IF EXISTS "Authenticated users can insert patients" ON public.patients;
DROP POLICY IF EXISTS "Clinic members can insert patients" ON public.patients;
CREATE POLICY "Clinic members can insert patients"
ON public.patients FOR INSERT TO authenticated
WITH CHECK (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can update patients" ON public.patients;
DROP POLICY IF EXISTS "Clinic members can update patients" ON public.patients;
CREATE POLICY "Clinic members can update patients"
ON public.patients FOR UPDATE TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can view patients" ON public.patients;
DROP POLICY IF EXISTS "Clinic members can view patients" ON public.patients;
CREATE POLICY "Clinic members can view patients"
ON public.patients FOR SELECT TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

-- FINANCIAL TRANSACTIONS
DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Clinic members can insert transactions" ON public.financial_transactions;
CREATE POLICY "Clinic members can insert transactions"
ON public.financial_transactions FOR INSERT TO authenticated
WITH CHECK (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can update transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Clinic members can update transactions" ON public.financial_transactions;
CREATE POLICY "Clinic members can update transactions"
ON public.financial_transactions FOR UPDATE TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Authenticated users can view transactions" ON public.financial_transactions;
DROP POLICY IF EXISTS "Clinic members can view transactions" ON public.financial_transactions;
CREATE POLICY "Clinic members can view transactions"
ON public.financial_transactions FOR SELECT TO authenticated
USING (clinic_id IS NULL OR user_belongs_to_clinic(auth.uid(), clinic_id));

-- DOCUMENTS
DROP POLICY IF EXISTS "Authenticated users can insert documents" ON public.documents;
DROP POLICY IF EXISTS "Clinic members can insert documents" ON public.documents;
CREATE POLICY "Clinic members can insert documents"
ON public.documents FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view documents" ON public.documents;
DROP POLICY IF EXISTS "Clinic members can view documents" ON public.documents;
CREATE POLICY "Clinic members can view documents"
ON public.documents FOR SELECT TO authenticated
USING (true);

-- ODONTOGRAM ENTRIES
DROP POLICY IF EXISTS "Authenticated users can insert odontogram" ON public.odontogram_entries;
DROP POLICY IF EXISTS "Clinic members can insert odontogram" ON public.odontogram_entries;
CREATE POLICY "Clinic members can insert odontogram"
ON public.odontogram_entries FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update odontogram" ON public.odontogram_entries;
DROP POLICY IF EXISTS "Clinic members can update odontogram" ON public.odontogram_entries;
CREATE POLICY "Clinic members can update odontogram"
ON public.odontogram_entries FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can view odontogram" ON public.odontogram_entries;
DROP POLICY IF EXISTS "Clinic members can view odontogram" ON public.odontogram_entries;
CREATE POLICY "Clinic members can view odontogram"
ON public.odontogram_entries FOR SELECT TO authenticated
USING (true);

-- TREATMENT PLANS
DROP POLICY IF EXISTS "Authenticated users can insert treatment plans" ON public.treatment_plans;
DROP POLICY IF EXISTS "Clinic members can insert treatment plans" ON public.treatment_plans;
CREATE POLICY "Clinic members can insert treatment plans"
ON public.treatment_plans FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update treatment plans" ON public.treatment_plans;
DROP POLICY IF EXISTS "Clinic members can update treatment plans" ON public.treatment_plans;
CREATE POLICY "Clinic members can update treatment plans"
ON public.treatment_plans FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can view treatment plans" ON public.treatment_plans;
DROP POLICY IF EXISTS "Clinic members can view treatment plans" ON public.treatment_plans;
CREATE POLICY "Clinic members can view treatment plans"
ON public.treatment_plans FOR SELECT TO authenticated
USING (true);

-- TREATMENT PLAN ITEMS
DROP POLICY IF EXISTS "Authenticated users can insert plan items" ON public.treatment_plan_items;
DROP POLICY IF EXISTS "Clinic members can insert plan items" ON public.treatment_plan_items;
CREATE POLICY "Clinic members can insert plan items"
ON public.treatment_plan_items FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update plan items" ON public.treatment_plan_items;
DROP POLICY IF EXISTS "Clinic members can update plan items" ON public.treatment_plan_items;
CREATE POLICY "Clinic members can update plan items"
ON public.treatment_plan_items FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can view plan items" ON public.treatment_plan_items;
DROP POLICY IF EXISTS "Clinic members can view plan items" ON public.treatment_plan_items;
CREATE POLICY "Clinic members can view plan items"
ON public.treatment_plan_items FOR SELECT TO authenticated
USING (true);

-- ============================================================================
-- 5) 20260413115156 - notifications + triggers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT,
  reference_id UUID,
  reference_type TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (
  user_id = auth.uid() OR
  (clinic_id IS NOT NULL AND user_belongs_to_clinic(auth.uid(), clinic_id))
);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR (clinic_id IS NOT NULL AND user_belongs_to_clinic(auth.uid(), clinic_id)));

DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
CREATE POLICY "System can insert notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (true);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END
$$;

CREATE OR REPLACE FUNCTION public.notify_new_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  patient_name TEXT;
BEGIN
  SELECT full_name INTO patient_name FROM public.patients WHERE id = NEW.patient_id;
  INSERT INTO public.notifications (clinic_id, user_id, type, title, message, reference_id, reference_type)
  VALUES (
    NEW.clinic_id,
    NEW.dentist_id,
    'appointment',
    'Nova consulta agendada',
    'Consulta com ' || COALESCE(patient_name, 'paciente') || ' foi agendada.',
    NEW.id,
    'appointment'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_appointment ON public.appointments;
CREATE TRIGGER on_new_appointment
AFTER INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_appointment();

CREATE OR REPLACE FUNCTION public.notify_new_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (clinic_id, user_id, type, title, message, reference_id, reference_type)
  VALUES (
    NEW.clinic_id,
    COALESCE(NEW.dentist_id, '00000000-0000-0000-0000-000000000000'),
    'financial',
    CASE WHEN NEW.type = 'income' THEN 'Pagamento registrado' ELSE 'Despesa registrada' END,
    COALESCE(NEW.description, NEW.category) || ' - R$ ' || NEW.amount::TEXT,
    NEW.id,
    'financial_transaction'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_transaction ON public.financial_transactions;
CREATE TRIGGER on_new_transaction
AFTER INSERT ON public.financial_transactions
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_transaction();

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_clinic_id ON public.notifications(clinic_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);

-- ============================================================================
-- 6) 20260413122225 - clinical_records
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clinical_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  dentist_id UUID NOT NULL,
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL,
  notes TEXT,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.clinical_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view clinical records" ON public.clinical_records;
CREATE POLICY "Clinic members can view clinical records"
  ON public.clinical_records FOR SELECT TO authenticated
  USING ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can insert clinical records" ON public.clinical_records;
CREATE POLICY "Clinic members can insert clinical records"
  ON public.clinical_records FOR INSERT TO authenticated
  WITH CHECK ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can update clinical records" ON public.clinical_records;
CREATE POLICY "Clinic members can update clinical records"
  ON public.clinical_records FOR UPDATE TO authenticated
  USING ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Admins can delete clinical records" ON public.clinical_records;
CREATE POLICY "Admins can delete clinical records"
  ON public.clinical_records FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.clinical_record_procedures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinical_record_id UUID NOT NULL REFERENCES public.clinical_records(id) ON DELETE CASCADE,
  procedure_id UUID NOT NULL REFERENCES public.procedures(id),
  tooth_number INTEGER,
  surface TEXT,
  notes TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.clinical_record_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view record procedures" ON public.clinical_record_procedures;
CREATE POLICY "Clinic members can view record procedures"
  ON public.clinical_record_procedures FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clinical_records cr
    WHERE cr.id = clinical_record_id
    AND ((cr.clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), cr.clinic_id))
  ));

DROP POLICY IF EXISTS "Clinic members can insert record procedures" ON public.clinical_record_procedures;
CREATE POLICY "Clinic members can insert record procedures"
  ON public.clinical_record_procedures FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.clinical_records cr
    WHERE cr.id = clinical_record_id
    AND ((cr.clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), cr.clinic_id))
  ));

DROP POLICY IF EXISTS "Clinic members can update record procedures" ON public.clinical_record_procedures;
CREATE POLICY "Clinic members can update record procedures"
  ON public.clinical_record_procedures FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clinical_records cr
    WHERE cr.id = clinical_record_id
    AND ((cr.clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), cr.clinic_id))
  ));

DROP POLICY IF EXISTS "Admins can delete record procedures" ON public.clinical_record_procedures;
CREATE POLICY "Admins can delete record procedures"
  ON public.clinical_record_procedures FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_clinical_records_updated_at ON public.clinical_records;
CREATE TRIGGER update_clinical_records_updated_at
  BEFORE UPDATE ON public.clinical_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 7) 20260413182027 - clinic category enum
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'clinic_category'
  ) THEN
    CREATE TYPE public.clinic_category AS ENUM ('odonto', 'medico', 'estetica', 'veterinario', 'outro');
  END IF;
END
$$;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS category public.clinic_category NOT NULL DEFAULT 'odonto';

-- ============================================================================
-- 8) 20260413191107 - anamneses + patient-files bucket
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.anamneses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES public.clinics(id),
  allergies TEXT,
  medications TEXT,
  medical_conditions TEXT,
  habits TEXT,
  blood_type TEXT,
  notes TEXT,
  filled_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.anamneses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view anamneses" ON public.anamneses;
CREATE POLICY "Clinic members can view anamneses"
ON public.anamneses FOR SELECT TO authenticated
USING ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can insert anamneses" ON public.anamneses;
CREATE POLICY "Clinic members can insert anamneses"
ON public.anamneses FOR INSERT TO authenticated
WITH CHECK ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can update anamneses" ON public.anamneses;
CREATE POLICY "Clinic members can update anamneses"
ON public.anamneses FOR UPDATE TO authenticated
USING ((clinic_id IS NULL) OR user_belongs_to_clinic(auth.uid(), clinic_id));

DROP TRIGGER IF EXISTS update_anamneses_updated_at ON public.anamneses;
CREATE TRIGGER update_anamneses_updated_at
BEFORE UPDATE ON public.anamneses
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public)
VALUES ('patient-files', 'patient-files', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload patient files'
  ) THEN
    CREATE POLICY "Authenticated users can upload patient files"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'patient-files');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Anyone can view patient files'
  ) THEN
    CREATE POLICY "Anyone can view patient files"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'patient-files');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete patient files'
  ) THEN
    CREATE POLICY "Authenticated users can delete patient files"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'patient-files');
  END IF;
END
$$;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS label TEXT;

-- ============================================================================
-- 9) 20260413191831 - business_hours + insurance_plans + clinic-assets bucket
-- ============================================================================
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS business_hours JSONB
DEFAULT '{"mon":{"open":"08:00","close":"18:00","enabled":true},"tue":{"open":"08:00","close":"18:00","enabled":true},"wed":{"open":"08:00","close":"18:00","enabled":true},"thu":{"open":"08:00","close":"18:00","enabled":true},"fri":{"open":"08:00","close":"18:00","enabled":true},"sat":{"open":"08:00","close":"12:00","enabled":false},"sun":{"open":"08:00","close":"12:00","enabled":false}}'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('clinic-assets', 'clinic-assets', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload clinic assets'
  ) THEN
    CREATE POLICY "Authenticated users can upload clinic assets"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'clinic-assets');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Anyone can view clinic assets'
  ) THEN
    CREATE POLICY "Anyone can view clinic assets"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'clinic-assets');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can update clinic assets'
  ) THEN
    CREATE POLICY "Authenticated users can update clinic assets"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'clinic-assets');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.insurance_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ans_code TEXT,
  type TEXT NOT NULL DEFAULT 'dental',
  contact_phone TEXT,
  contact_email TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.insurance_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view insurance plans" ON public.insurance_plans;
CREATE POLICY "Clinic members can view insurance plans"
ON public.insurance_plans FOR SELECT TO authenticated
USING (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can insert insurance plans" ON public.insurance_plans;
CREATE POLICY "Clinic members can insert insurance plans"
ON public.insurance_plans FOR INSERT TO authenticated
WITH CHECK (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can update insurance plans" ON public.insurance_plans;
CREATE POLICY "Clinic members can update insurance plans"
ON public.insurance_plans FOR UPDATE TO authenticated
USING (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Admins can delete insurance plans" ON public.insurance_plans;
CREATE POLICY "Admins can delete insurance plans"
ON public.insurance_plans FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_insurance_plans_updated_at ON public.insurance_plans;
CREATE TRIGGER update_insurance_plans_updated_at
BEFORE UPDATE ON public.insurance_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 10) 20260413192354 - clinic_rooms + appointments fields
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clinic_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.clinic_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view rooms" ON public.clinic_rooms;
CREATE POLICY "Clinic members can view rooms"
ON public.clinic_rooms FOR SELECT TO authenticated
USING (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can insert rooms" ON public.clinic_rooms;
CREATE POLICY "Clinic members can insert rooms"
ON public.clinic_rooms FOR INSERT TO authenticated
WITH CHECK (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can update rooms" ON public.clinic_rooms;
CREATE POLICY "Clinic members can update rooms"
ON public.clinic_rooms FOR UPDATE TO authenticated
USING (user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Admins can delete rooms" ON public.clinic_rooms;
CREATE POLICY "Admins can delete rooms"
ON public.clinic_rooms FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_clinic_rooms_updated_at ON public.clinic_rooms;
CREATE TRIGGER update_clinic_rooms_updated_at
BEFORE UPDATE ON public.clinic_rooms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES public.clinic_rooms(id);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS send_confirmation BOOLEAN DEFAULT false;

-- ============================================================================
-- 11) 20260414235422 - anon marketplace access
-- ============================================================================
DROP POLICY IF EXISTS "Anon can view profiles" ON public.profiles;
CREATE POLICY "Anon can view profiles" ON public.profiles FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can view clinics" ON public.clinics;
CREATE POLICY "Anon can view clinics" ON public.clinics FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can view clinic members" ON public.clinic_members;
CREATE POLICY "Anon can view clinic members" ON public.clinic_members FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can view appointments" ON public.appointments;
CREATE POLICY "Anon can view appointments" ON public.appointments FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can view insurance plans" ON public.insurance_plans;
CREATE POLICY "Anon can view insurance plans" ON public.insurance_plans FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Anon can view procedures" ON public.procedures;
CREATE POLICY "Anon can view procedures" ON public.procedures FOR SELECT TO anon USING (true);

-- ============================================================================
-- 12) 20260415133324 - broader authenticated marketplace views
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated can view all clinic members" ON public.clinic_members;
CREATE POLICY "Authenticated can view all clinic members"
ON public.clinic_members FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can view all appointments" ON public.appointments;
CREATE POLICY "Authenticated can view all appointments"
ON public.appointments FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 13) 20260417104932 - patient role/account flow
-- ============================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'patient';

CREATE TABLE IF NOT EXISTS public.patient_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  cpf TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  date_of_birth DATE,
  insurance_provider TEXT,
  insurance_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_accounts_user_id ON public.patient_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_patient_accounts_cpf ON public.patient_accounts(cpf);

ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can view own account" ON public.patient_accounts;
CREATE POLICY "Patients can view own account"
  ON public.patient_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Patients can update own account" ON public.patient_accounts;
CREATE POLICY "Patients can update own account"
  ON public.patient_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Patients can insert own account" ON public.patient_accounts;
CREATE POLICY "Patients can insert own account"
  ON public.patient_accounts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_patient_accounts_updated_at ON public.patient_accounts;
CREATE TRIGGER update_patient_accounts_updated_at
  BEFORE UPDATE ON public.patient_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS patient_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_patients_patient_user_id ON public.patients(patient_user_id);
CREATE INDEX IF NOT EXISTS idx_patients_cpf ON public.patients(cpf);

CREATE OR REPLACE FUNCTION public.link_patients_by_cpf()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'patient_accounts' THEN
    IF NEW.cpf IS NOT NULL THEN
      UPDATE public.patients
        SET patient_user_id = NEW.user_id
        WHERE cpf = NEW.cpf AND (patient_user_id IS NULL OR patient_user_id <> NEW.user_id);
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'patients' THEN
    IF NEW.cpf IS NOT NULL AND NEW.patient_user_id IS NULL THEN
      SELECT user_id INTO NEW.patient_user_id
        FROM public.patient_accounts
        WHERE cpf = NEW.cpf
        LIMIT 1;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_accounts_link_cpf ON public.patient_accounts;
CREATE TRIGGER patient_accounts_link_cpf
  AFTER INSERT OR UPDATE OF cpf ON public.patient_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.link_patients_by_cpf();

DROP TRIGGER IF EXISTS patients_link_cpf ON public.patients;
CREATE TRIGGER patients_link_cpf
  BEFORE INSERT OR UPDATE OF cpf ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.link_patients_by_cpf();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_type TEXT;
  v_cpf TEXT;
  v_phone TEXT;
  v_insurance_provider TEXT;
  v_insurance_number TEXT;
BEGIN
  v_user_type := NEW.raw_user_meta_data->>'user_type';

  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;

  IF v_user_type = 'cliente' THEN
    v_cpf := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'cpf', ''), '\\D', '', 'g'), '');
    v_phone := NEW.raw_user_meta_data->>'phone';
    v_insurance_provider := NEW.raw_user_meta_data->>'insurance_provider';
    v_insurance_number := NEW.raw_user_meta_data->>'insurance_number';

    IF v_cpf IS NOT NULL THEN
      INSERT INTO public.patient_accounts (user_id, cpf, full_name, phone, insurance_provider, insurance_number)
      VALUES (
        NEW.id,
        v_cpf,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        v_phone,
        v_insurance_provider,
        v_insurance_number
      )
      ON CONFLICT (cpf) DO NOTHING;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'patient'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Patients can view own patient records" ON public.patients;
CREATE POLICY "Patients can view own patient records"
  ON public.patients FOR SELECT
  TO authenticated
  USING (patient_user_id = auth.uid());

DROP POLICY IF EXISTS "Patients can update own patient records" ON public.patients;
CREATE POLICY "Patients can update own patient records"
  ON public.patients FOR UPDATE
  TO authenticated
  USING (patient_user_id = auth.uid());

DROP POLICY IF EXISTS "Patients can view own appointments" ON public.appointments;
CREATE POLICY "Patients can view own appointments"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = appointments.patient_id AND p.patient_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can update own appointments" ON public.appointments;
CREATE POLICY "Patients can update own appointments"
  ON public.appointments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = appointments.patient_id AND p.patient_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can view own documents" ON public.documents;
CREATE POLICY "Patients can view own documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = documents.patient_id AND p.patient_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can view own clinical records" ON public.clinical_records;
CREATE POLICY "Patients can view own clinical records"
  ON public.clinical_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.id = clinical_records.patient_id AND p.patient_user_id = auth.uid()
    )
  );

-- ============================================================================
-- 14) 20260418112117 - realtime + patient appointment notifications
-- ============================================================================
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN undefined_object THEN NULL;
  END;
END
$$;

CREATE OR REPLACE FUNCTION public.notify_patient_appointment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_patient_user_id uuid;
  v_clinic_name text;
  v_title text;
  v_message text;
  v_when text;
BEGIN
  SELECT p.patient_user_id INTO v_patient_user_id
    FROM public.patients p
    WHERE p.id = NEW.patient_id;

  IF v_patient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.name INTO v_clinic_name FROM public.clinics c WHERE c.id = NEW.clinic_id;
  v_when := to_char(NEW.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');

  IF TG_OP = 'INSERT' THEN
    v_title := 'Nova consulta agendada';
    v_message := 'Sua consulta em ' || COALESCE(v_clinic_name, 'clínica') || ' foi marcada para ' || v_when || '.';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status
      WHEN 'confirmed' THEN
        v_title := 'Consulta confirmada';
        v_message := 'Sua consulta em ' || COALESCE(v_clinic_name, 'clínica') || ' (' || v_when || ') foi confirmada.';
      WHEN 'cancelled' THEN
        v_title := 'Consulta cancelada';
        v_message := 'Sua consulta em ' || COALESCE(v_clinic_name, 'clínica') || ' (' || v_when || ') foi cancelada.';
      WHEN 'completed' THEN
        v_title := 'Consulta realizada';
        v_message := 'Sua consulta em ' || COALESCE(v_clinic_name, 'clínica') || ' foi finalizada.';
      WHEN 'no_show' THEN
        v_title := 'Falta registrada';
        v_message := 'Você foi marcado como ausente na consulta de ' || v_when || '.';
      ELSE
        RETURN NEW;
    END CASE;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (clinic_id, user_id, type, title, message, reference_id, reference_type)
  VALUES (NEW.clinic_id, v_patient_user_id, 'appointment', v_title, v_message, NEW.id, 'appointment');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_patient_appointment_insert ON public.appointments;
CREATE TRIGGER trg_notify_patient_appointment_insert
AFTER INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.notify_patient_appointment_change();

DROP TRIGGER IF EXISTS trg_notify_patient_appointment_update ON public.appointments;
CREATE TRIGGER trg_notify_patient_appointment_update
AFTER UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.notify_patient_appointment_change();

-- ============================================================================
-- 15) 20260419150222 - ai_secretary_config
-- ============================================================================
ALTER TABLE public.ai_secretary_config
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS clinic_id UUID,
  ADD COLUMN IF NOT EXISTS custom_prompt TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_secretary_config_pkey'
      AND conrelid = 'public.ai_secretary_config'::regclass
  ) THEN
    ALTER TABLE public.ai_secretary_config ADD PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_secretary_config_clinic_id_key'
      AND conrelid = 'public.ai_secretary_config'::regclass
  ) THEN
    ALTER TABLE public.ai_secretary_config ADD CONSTRAINT ai_secretary_config_clinic_id_key UNIQUE (clinic_id);
  END IF;
END
$$;

ALTER TABLE public.ai_secretary_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic members can view ai config" ON public.ai_secretary_config;
CREATE POLICY "Clinic members can view ai config"
  ON public.ai_secretary_config
  FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can insert ai config" ON public.ai_secretary_config;
CREATE POLICY "Clinic members can insert ai config"
  ON public.ai_secretary_config
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Clinic members can update ai config" ON public.ai_secretary_config;
CREATE POLICY "Clinic members can update ai config"
  ON public.ai_secretary_config
  FOR UPDATE
  TO authenticated
  USING (public.user_belongs_to_clinic(auth.uid(), clinic_id));

DROP POLICY IF EXISTS "Admins can delete ai config" ON public.ai_secretary_config;
CREATE POLICY "Admins can delete ai config"
  ON public.ai_secretary_config
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_ai_secretary_config_updated_at ON public.ai_secretary_config;
CREATE TRIGGER update_ai_secretary_config_updated_at
  BEFORE UPDATE ON public.ai_secretary_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_ai_secretary_config_clinic_id ON public.ai_secretary_config(clinic_id);

-- ============================================================================
-- 16) 20260419222744 - specialty + professional_availability
-- ============================================================================
ALTER TABLE public.clinic_members
ADD COLUMN IF NOT EXISTS specialty text;

CREATE TABLE IF NOT EXISTS public.professional_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  work_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_holiday_override boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT professional_availability_time_check CHECK (end_time > start_time),
  CONSTRAINT professional_availability_unique UNIQUE (user_id, work_date, start_time)
);

CREATE INDEX IF NOT EXISTS idx_prof_avail_clinic_date
  ON public.professional_availability (clinic_id, work_date);
CREATE INDEX IF NOT EXISTS idx_prof_avail_user_date
  ON public.professional_availability (user_id, work_date);

ALTER TABLE public.professional_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view availability" ON public.professional_availability;
CREATE POLICY "Anyone can view availability"
  ON public.professional_availability
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Clinic members can insert availability" ON public.professional_availability;
CREATE POLICY "Clinic members can insert availability"
  ON public.professional_availability
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_belongs_to_clinic(auth.uid(), clinic_id)
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Clinic members can update own availability" ON public.professional_availability;
CREATE POLICY "Clinic members can update own availability"
  ON public.professional_availability
  FOR UPDATE
  TO authenticated
  USING (
    user_belongs_to_clinic(auth.uid(), clinic_id)
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Clinic members can delete own availability" ON public.professional_availability;
CREATE POLICY "Clinic members can delete own availability"
  ON public.professional_availability
  FOR DELETE
  TO authenticated
  USING (
    user_belongs_to_clinic(auth.uid(), clinic_id)
    AND user_id = auth.uid()
  );

DROP TRIGGER IF EXISTS trg_prof_avail_updated_at ON public.professional_availability;
CREATE TRIGGER trg_prof_avail_updated_at
  BEFORE UPDATE ON public.professional_availability
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
