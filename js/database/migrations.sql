-- GM FLEX Financeiro - Supabase/PostgreSQL
-- Execute este arquivo no SQL Editor do Supabase.
-- A migration e idempotente e pode ser executada novamente apos ajustes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  cargo TEXT NOT NULL DEFAULT 'Funcionario',
  avatar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_cargo_check CHECK (cargo IN ('Administrador','Gerente','Funcionario'))
);

CREATE TABLE IF NOT EXISTS public.driver_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  driver_name TEXT NOT NULL,
  ml_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  sh_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, driver_name)
);

CREATE TABLE IF NOT EXISTS public.entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  driver_name TEXT NOT NULL,
  ml_count INTEGER NOT NULL DEFAULT 0 CHECK (ml_count >= 0),
  sh_count INTEGER NOT NULL DEFAULT 0 CHECK (sh_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, date_key, driver_name)
);

CREATE TABLE IF NOT EXISTS public.settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  empresa_nome TEXT,
  responsavel TEXT,
  telefone TEXT,
  email TEXT,
  tema TEXT NOT NULL DEFAULT 'claro' CHECK (tema IN ('claro','escuro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_key TEXT NOT NULL,
  description TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.company_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  cargo TEXT NOT NULL DEFAULT 'Funcionario',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_invites_cargo_check CHECK (cargo IN ('Gerente','Funcionario'))
);

ALTER TABLE public.driver_rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.driver_rates ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS client_id TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Taxa Base foi removida do produto: o custo de Motoboys/Motoristas já representa essa despesa,
-- e mantê-la duplicava os custos no cálculo do Lucro Líquido. As colunas abaixo são removidas
-- (se existirem) para bancos que já rodaram a migração antiga.
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_base_rate_ml_check;
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_base_rate_sh_check;
ALTER TABLE public.settings DROP COLUMN IF EXISTS base_rate_ml;
ALTER TABLE public.settings DROP COLUMN IF EXISTS base_rate_sh;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_company_client_id_key'
  ) THEN
    ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_company_client_id_key UNIQUE(company_id, client_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_companies_updated_at ON public.companies;
CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_driver_rates_updated_at ON public.driver_rates;
CREATE TRIGGER set_driver_rates_updated_at
  BEFORE UPDATE ON public.driver_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_entries_updated_at ON public.entries;
CREATE TRIGGER set_entries_updated_at
  BEFORE UPDATE ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_settings_updated_at ON public.settings;
CREATE TRIGGER set_settings_updated_at
  BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_company_invites_updated_at ON public.company_invites;
CREATE TRIGGER set_company_invites_updated_at
  BEFORE UPDATE ON public.company_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cargo FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_company_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role() IN ('Administrador','Gerente'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_user_role() = 'Administrador', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.ensure_current_user_company(company_name TEXT DEFAULT 'FINANCEIRO GM FLEX')
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row public.profiles;
  new_company_id UUID;
BEGIN
  SELECT * INTO profile_row FROM public.profiles WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil nao encontrado para o usuario autenticado.';
  END IF;

  IF profile_row.company_id IS NULL THEN
    INSERT INTO public.companies (nome)
    VALUES (COALESCE(NULLIF(TRIM(company_name), ''), 'FINANCEIRO GM FLEX'))
    RETURNING id INTO new_company_id;

    UPDATE public.profiles
    SET company_id = new_company_id,
        cargo = 'Administrador'
    WHERE id = auth.uid()
    RETURNING * INTO profile_row;

    INSERT INTO public.settings (company_id, empresa_nome, responsavel, email)
    VALUES (new_company_id, COALESCE(NULLIF(TRIM(company_name), ''), 'FINANCEIRO GM FLEX'), profile_row.nome, profile_row.email)
    ON CONFLICT (company_id) DO NOTHING;
  END IF;

  RETURN profile_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id UUID;
  profile_role TEXT := 'Administrador';
  profile_name TEXT;
  company_name TEXT;
  invite_token TEXT;
  invite_row public.company_invites;
BEGIN
  profile_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'nome'), ''), NEW.email);
  company_name := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'company_name'), ''), 'FINANCEIRO GM FLEX');
  invite_token := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'invite_token', '')), '');

  IF invite_token IS NOT NULL THEN
    SELECT *
      INTO invite_row
      FROM public.company_invites
     WHERE token = invite_token
       AND used_at IS NULL
       AND expires_at > NOW()
       AND lower(email) = lower(NEW.email)
     LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Convite invalido ou expirado.';
    END IF;

    new_company_id := invite_row.company_id;
    profile_role := invite_row.cargo;

    UPDATE public.company_invites
       SET used_at = NOW()
     WHERE id = invite_row.id;
  ELSE
    INSERT INTO public.companies (nome)
    VALUES (company_name)
    RETURNING id INTO new_company_id;
  END IF;

  INSERT INTO public.profiles (id, company_id, email, nome, cargo)
  VALUES (NEW.id, new_company_id, NEW.email, profile_name, profile_role)
  ON CONFLICT (id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        email = EXCLUDED.email,
        nome = EXCLUDED.nome,
        cargo = EXCLUDED.cargo;

  INSERT INTO public.settings (company_id, empresa_nome, responsavel, email)
  VALUES (new_company_id, company_name, profile_name, NEW.email)
  ON CONFLICT (company_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own company" ON public.companies;
DROP POLICY IF EXISTS "Company users can access driver rates" ON public.driver_rates;
DROP POLICY IF EXISTS "Company users can access entries" ON public.entries;
DROP POLICY IF EXISTS "Company users can access audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Company users can access settings" ON public.settings;

DROP POLICY IF EXISTS profiles_select_company ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
DROP POLICY IF EXISTS companies_select_own ON public.companies;
DROP POLICY IF EXISTS companies_update_manager ON public.companies;
DROP POLICY IF EXISTS driver_rates_select_company ON public.driver_rates;
DROP POLICY IF EXISTS driver_rates_write_manager ON public.driver_rates;
DROP POLICY IF EXISTS entries_select_company ON public.entries;
DROP POLICY IF EXISTS entries_insert_company_user ON public.entries;
DROP POLICY IF EXISTS entries_update_company_user ON public.entries;
DROP POLICY IF EXISTS entries_delete_manager ON public.entries;
DROP POLICY IF EXISTS settings_select_company ON public.settings;
DROP POLICY IF EXISTS settings_write_manager ON public.settings;
DROP POLICY IF EXISTS audit_select_company ON public.audit_logs;
DROP POLICY IF EXISTS audit_insert_company_user ON public.audit_logs;
DROP POLICY IF EXISTS company_invites_select_manager ON public.company_invites;
DROP POLICY IF EXISTS company_invites_write_manager ON public.company_invites;

CREATE POLICY profiles_select_company ON public.profiles
  FOR SELECT USING (company_id = public.current_company_id() OR id = auth.uid());

CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE USING (company_id = public.current_company_id() AND public.is_company_admin())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_admin());

CREATE POLICY companies_select_own ON public.companies
  FOR SELECT USING (id = public.current_company_id());

CREATE POLICY companies_update_manager ON public.companies
  FOR UPDATE USING (id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (id = public.current_company_id() AND public.is_company_manager());

CREATE POLICY driver_rates_select_company ON public.driver_rates
  FOR SELECT USING (company_id = public.current_company_id());

CREATE POLICY driver_rates_write_manager ON public.driver_rates
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

CREATE POLICY entries_select_company ON public.entries
  FOR SELECT USING (company_id = public.current_company_id());

CREATE POLICY entries_insert_company_user ON public.entries
  FOR INSERT WITH CHECK (company_id = public.current_company_id());

CREATE POLICY entries_update_company_user ON public.entries
  FOR UPDATE USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY entries_delete_manager ON public.entries
  FOR DELETE USING (company_id = public.current_company_id() AND public.is_company_manager());

CREATE POLICY settings_select_company ON public.settings
  FOR SELECT USING (company_id = public.current_company_id());

CREATE POLICY settings_write_manager ON public.settings
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

CREATE POLICY audit_select_company ON public.audit_logs
  FOR SELECT USING (company_id = public.current_company_id());

CREATE POLICY audit_insert_company_user ON public.audit_logs
  FOR INSERT WITH CHECK (company_id = public.current_company_id());

CREATE POLICY company_invites_select_manager ON public.company_invites
  FOR SELECT USING (company_id = public.current_company_id() AND public.is_company_manager());

CREATE POLICY company_invites_write_manager ON public.company_invites
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['entries','driver_rates','settings','audit_logs','profiles','companies']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_entries_company_date ON public.entries(company_id, date_key);
CREATE INDEX IF NOT EXISTS idx_driver_rates_company ON public.driver_rates(company_id, driver_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_company ON public.profiles(company_id);
