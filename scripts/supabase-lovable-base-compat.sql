-- Base compatibility migration for Lovable schema on existing Supabase project.
-- Safe to run multiple times (idempotent where possible).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'dentist', 'secretary');
  END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'patient';
  EXCEPTION
    WHEN undefined_object THEN
      NULL;
  END;
END
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can view all profiles'
  ) THEN
    CREATE POLICY "Users can view all profiles" ON public.profiles
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile" ON public.profiles
      FOR UPDATE TO authenticated USING (auth.uid() = id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at'
  ) THEN
    CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'Users can view own roles'
  ) THEN
    CREATE POLICY "Users can view own roles" ON public.user_roles
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, 'admin'::public.app_role
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id);
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_profile_created_assign_role'
  ) THEN
    CREATE TRIGGER on_profile_created_assign_role
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();
  END IF;
END
$$;

-- Existing table in this project: add missing columns to match Lovable schema.
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS cnpj TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'clinics' AND constraint_name = 'clinics_owner_id_fkey'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id);
  END IF;
END
$$;

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_clinics_updated_at'
  ) THEN
    CREATE TRIGGER update_clinics_updated_at
    BEFORE UPDATE ON public.clinics
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS insurance_number TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS patients_cpf_key ON public.patients (cpf) WHERE cpf IS NOT NULL;

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_patients_updated_at'
  ) THEN
    CREATE TRIGGER update_patients_updated_at
    BEFORE UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  category TEXT NOT NULL,
  description TEXT,
  default_duration INTEGER NOT NULL DEFAULT 30,
  default_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS dentist_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS procedure_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'appointments' AND constraint_name = 'appointments_dentist_id_fkey'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_dentist_id_fkey
      FOREIGN KEY (dentist_id) REFERENCES auth.users(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'appointments' AND constraint_name = 'appointments_procedure_id_fkey'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_procedure_id_fkey
      FOREIGN KEY (procedure_id) REFERENCES public.procedures(id);
  END IF;
END
$$;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_appointments_updated_at'
  ) THEN
    CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.odontogram_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  tooth_number INTEGER NOT NULL CHECK (tooth_number BETWEEN 11 AND 85),
  surface TEXT,
  condition TEXT NOT NULL,
  procedure_id UUID REFERENCES public.procedures(id),
  notes TEXT,
  dentist_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.odontogram_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_odontogram_updated_at'
  ) THEN
    CREATE TRIGGER update_odontogram_updated_at
    BEFORE UPDATE ON public.odontogram_entries
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.treatment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  dentist_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_plans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_treatment_plans_updated_at'
  ) THEN
    CREATE TRIGGER update_treatment_plans_updated_at
    BEFORE UPDATE ON public.treatment_plans
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.treatment_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_plan_id UUID NOT NULL REFERENCES public.treatment_plans(id) ON DELETE CASCADE,
  procedure_id UUID NOT NULL REFERENCES public.procedures(id),
  tooth_number INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_plan_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date DATE NOT NULL,
  paid_date DATE,
  patient_id UUID REFERENCES public.patients(id),
  appointment_id UUID REFERENCES public.appointments(id),
  dentist_id UUID REFERENCES auth.users(id),
  clinic_id UUID REFERENCES public.clinics(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_transactions_updated_at'
  ) THEN
    CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON public.financial_transactions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id),
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  category TEXT DEFAULT 'general',
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
