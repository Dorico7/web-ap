-- GM FLEX Financeiro - Módulo Opcional de Gestão de Motoboys
-- Tabelas, Políticas de RLS, Triggers e Inserções Iniciais

-- 1. Tabela de Módulos por Empresa
CREATE TABLE IF NOT EXISTS public.company_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, module_name)
);

-- 2. Tabela de Motoboys
CREATE TABLE IF NOT EXISTS public.motoboys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  cpf TEXT,
  pix TEXT,
  status TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo', 'Inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de Tarifas dos Motoboys (motoboy_rates)
CREATE TABLE IF NOT EXISTS public.motoboy_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  motoboy_id UUID NOT NULL REFERENCES public.motoboys(id) ON DELETE CASCADE,
  transportadora TEXT NOT NULL,
  valor_pacote NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_pacote >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, motoboy_id, transportadora)
);

-- 4. Tabela de Motoristas
CREATE TABLE IF NOT EXISTS public.motoristas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT,
  valor_diaria NUMERIC(12,2) NOT NULL DEFAULT 70.00 CHECK (valor_diaria >= 0),
  status TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo', 'Inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Tabela de Lançamentos de Entregas
CREATE TABLE IF NOT EXISTS public.motoboy_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  transportadora TEXT NOT NULL,
  motoboy_id UUID NOT NULL REFERENCES public.motoboys(id) ON DELETE RESTRICT,
  motorista_id UUID REFERENCES public.motoristas(id) ON DELETE RESTRICT,
  quantidade_pacotes INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_pacotes >= 0),
  valor_recebido NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_recebido >= 0),
  valor_motoboy NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (valor_motoboy >= 0),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triggers de updated_at
DROP TRIGGER IF EXISTS set_company_modules_updated_at ON public.company_modules;
CREATE TRIGGER set_company_modules_updated_at
  BEFORE UPDATE ON public.company_modules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_motoboys_updated_at ON public.motoboys;
CREATE TRIGGER set_motoboys_updated_at
  BEFORE UPDATE ON public.motoboys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_motoboy_rates_updated_at ON public.motoboy_rates;
CREATE TRIGGER set_motoboy_rates_updated_at
  BEFORE UPDATE ON public.motoboy_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_motoristas_updated_at ON public.motoristas;
CREATE TRIGGER set_motoristas_updated_at
  BEFORE UPDATE ON public.motoristas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_motoboy_entries_updated_at ON public.motoboy_entries;
CREATE TRIGGER set_motoboy_entries_updated_at
  BEFORE UPDATE ON public.motoboy_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS (Row Level Security)
ALTER TABLE public.company_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboy_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motoboy_entries ENABLE ROW LEVEL SECURITY;

-- Políticas company_modules
CREATE POLICY company_modules_select ON public.company_modules
  FOR SELECT USING (company_id = public.current_company_id());
CREATE POLICY company_modules_write_manager ON public.company_modules
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- Políticas motoboys
CREATE POLICY motoboys_select ON public.motoboys
  FOR SELECT USING (company_id = public.current_company_id());
CREATE POLICY motoboys_write_manager ON public.motoboys
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- Políticas motoboy_rates
CREATE POLICY motoboy_rates_select ON public.motoboy_rates
  FOR SELECT USING (company_id = public.current_company_id());
CREATE POLICY motoboy_rates_write_manager ON public.motoboy_rates
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- Políticas motoristas
CREATE POLICY motoristas_select ON public.motoristas
  FOR SELECT USING (company_id = public.current_company_id());
CREATE POLICY motoristas_write_manager ON public.motoristas
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- Políticas motoboy_entries
CREATE POLICY motoboy_entries_select ON public.motoboy_entries
  FOR SELECT USING (company_id = public.current_company_id());
CREATE POLICY motoboy_entries_insert_company_user ON public.motoboy_entries
  FOR INSERT WITH CHECK (company_id = public.current_company_id());
CREATE POLICY motoboy_entries_update_company_user ON public.motoboy_entries
  FOR UPDATE USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
CREATE POLICY motoboy_entries_delete_manager ON public.motoboy_entries
  FOR DELETE USING (company_id = public.current_company_id() AND public.is_company_manager());

-- Habilitar Realtime
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['company_modules','motoboys','motoboy_rates','motoristas','motoboy_entries']
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', table_name);
    END IF;
  END LOOP;
END $$;
