-- Base RLS policies from Lovable initial migration.
-- Safe to run multiple times.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinics' AND policyname = 'Authenticated users can view clinics'
  ) THEN
    CREATE POLICY "Authenticated users can view clinics" ON public.clinics
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinics' AND policyname = 'Admins can insert clinics'
  ) THEN
    CREATE POLICY "Admins can insert clinics" ON public.clinics
      FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinics' AND policyname = 'Admins can update clinics'
  ) THEN
    CREATE POLICY "Admins can update clinics" ON public.clinics
      FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'clinics' AND policyname = 'Admins can delete clinics'
  ) THEN
    CREATE POLICY "Admins can delete clinics" ON public.clinics
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients' AND policyname = 'Authenticated users can view patients'
  ) THEN
    CREATE POLICY "Authenticated users can view patients" ON public.patients
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients' AND policyname = 'Authenticated users can insert patients'
  ) THEN
    CREATE POLICY "Authenticated users can insert patients" ON public.patients
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients' AND policyname = 'Authenticated users can update patients'
  ) THEN
    CREATE POLICY "Authenticated users can update patients" ON public.patients
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'patients' AND policyname = 'Admins can delete patients'
  ) THEN
    CREATE POLICY "Admins can delete patients" ON public.patients
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'procedures' AND policyname = 'Authenticated users can view procedures'
  ) THEN
    CREATE POLICY "Authenticated users can view procedures" ON public.procedures
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'procedures' AND policyname = 'Admins can insert procedures'
  ) THEN
    CREATE POLICY "Admins can insert procedures" ON public.procedures
      FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'procedures' AND policyname = 'Admins can update procedures'
  ) THEN
    CREATE POLICY "Admins can update procedures" ON public.procedures
      FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'procedures' AND policyname = 'Admins can delete procedures'
  ) THEN
    CREATE POLICY "Admins can delete procedures" ON public.procedures
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Authenticated users can view appointments'
  ) THEN
    CREATE POLICY "Authenticated users can view appointments" ON public.appointments
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Authenticated users can insert appointments'
  ) THEN
    CREATE POLICY "Authenticated users can insert appointments" ON public.appointments
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Authenticated users can update appointments'
  ) THEN
    CREATE POLICY "Authenticated users can update appointments" ON public.appointments
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'appointments' AND policyname = 'Admins can delete appointments'
  ) THEN
    CREATE POLICY "Admins can delete appointments" ON public.appointments
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'odontogram_entries' AND policyname = 'Authenticated users can view odontogram'
  ) THEN
    CREATE POLICY "Authenticated users can view odontogram" ON public.odontogram_entries
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'odontogram_entries' AND policyname = 'Authenticated users can insert odontogram'
  ) THEN
    CREATE POLICY "Authenticated users can insert odontogram" ON public.odontogram_entries
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'odontogram_entries' AND policyname = 'Authenticated users can update odontogram'
  ) THEN
    CREATE POLICY "Authenticated users can update odontogram" ON public.odontogram_entries
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plans' AND policyname = 'Authenticated users can view treatment plans'
  ) THEN
    CREATE POLICY "Authenticated users can view treatment plans" ON public.treatment_plans
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plans' AND policyname = 'Authenticated users can insert treatment plans'
  ) THEN
    CREATE POLICY "Authenticated users can insert treatment plans" ON public.treatment_plans
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plans' AND policyname = 'Authenticated users can update treatment plans'
  ) THEN
    CREATE POLICY "Authenticated users can update treatment plans" ON public.treatment_plans
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plan_items' AND policyname = 'Authenticated users can view plan items'
  ) THEN
    CREATE POLICY "Authenticated users can view plan items" ON public.treatment_plan_items
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plan_items' AND policyname = 'Authenticated users can insert plan items'
  ) THEN
    CREATE POLICY "Authenticated users can insert plan items" ON public.treatment_plan_items
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treatment_plan_items' AND policyname = 'Authenticated users can update plan items'
  ) THEN
    CREATE POLICY "Authenticated users can update plan items" ON public.treatment_plan_items
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transactions' AND policyname = 'Authenticated users can view transactions'
  ) THEN
    CREATE POLICY "Authenticated users can view transactions" ON public.financial_transactions
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transactions' AND policyname = 'Authenticated users can insert transactions'
  ) THEN
    CREATE POLICY "Authenticated users can insert transactions" ON public.financial_transactions
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transactions' AND policyname = 'Authenticated users can update transactions'
  ) THEN
    CREATE POLICY "Authenticated users can update transactions" ON public.financial_transactions
      FOR UPDATE TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'financial_transactions' AND policyname = 'Admins can delete transactions'
  ) THEN
    CREATE POLICY "Admins can delete transactions" ON public.financial_transactions
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'Authenticated users can view documents'
  ) THEN
    CREATE POLICY "Authenticated users can view documents" ON public.documents
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'Authenticated users can insert documents'
  ) THEN
    CREATE POLICY "Authenticated users can insert documents" ON public.documents
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'Admins can delete documents'
  ) THEN
    CREATE POLICY "Admins can delete documents" ON public.documents
      FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;
