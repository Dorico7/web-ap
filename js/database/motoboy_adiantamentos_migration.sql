-- GM FLEX Financeiro - Módulo Motoboys - Adiantamentos (Vales)
-- Migração aditiva: cria a tabela de Adiantamentos/Vales dos motoboys, suas
-- políticas de RLS, trigger de updated_at e habilita o Realtime.
--
-- NÃO altera nenhuma tabela, coluna, política ou dado já existente.
-- Segura para rodar mais de uma vez (idempotente).
--
-- Pré-requisito: js/database/motoboys_module.sql já deve ter sido executado
-- (usa as funções public.set_updated_at(), public.current_company_id() e
-- public.is_company_manager(), e referencia public.motoboys e public.profiles).

-- 1. Tabela de Adiantamentos (Vales)
CREATE TABLE IF NOT EXISTS public.motoboy_adiantamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  motoboy_id UUID NOT NULL REFERENCES public.motoboys(id) ON DELETE RESTRICT,
  data_key DATE NOT NULL,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  motivo TEXT NOT NULL,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Descontado')),
  -- Referência de qual fechamento (mês/ano/quinzena) descontou este adiantamento,
  -- para auditoria e para os relatórios/PDF/Excel do fechamento daquele período.
  -- Os pagamentos são feitos por QUINZENA, então o desconto do adiantamento
  -- também é sempre atribuído a uma quinzena específica (1 = dias 1–15,
  -- 2 = dias 16–fim do mês), nunca ao mês inteiro de uma vez.
  fechamento_mes SMALLINT CHECK (fechamento_mes BETWEEN 1 AND 12),
  fechamento_ano SMALLINT,
  fechamento_quinzena SMALLINT CHECK (fechamento_quinzena IN (1, 2)),
  descontado_em TIMESTAMPTZ,
  -- Usuário responsável pelo lançamento (snapshot do nome, para preservar o
  -- histórico mesmo que o perfil seja removido/alterado no futuro).
  usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de apoio para os filtros da tela (Motoboy / Data / Status)
CREATE INDEX IF NOT EXISTS idx_motoboy_adiantamentos_company ON public.motoboy_adiantamentos(company_id);
CREATE INDEX IF NOT EXISTS idx_motoboy_adiantamentos_motoboy ON public.motoboy_adiantamentos(motoboy_id);
CREATE INDEX IF NOT EXISTS idx_motoboy_adiantamentos_status ON public.motoboy_adiantamentos(company_id, status);
CREATE INDEX IF NOT EXISTS idx_motoboy_adiantamentos_data ON public.motoboy_adiantamentos(company_id, data_key);

-- 1.1) Reforço: caso esta migração já tenha sido executada ANTES da correção
-- "desconto por quinzena", garante que a coluna e a constraint existam mesmo
-- assim, sem precisar recriar a tabela. Idempotente e seguro de rodar sempre.
ALTER TABLE public.motoboy_adiantamentos
  ADD COLUMN IF NOT EXISTS fechamento_quinzena SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'motoboy_adiantamentos_fechamento_quinzena_check'
  ) THEN
    ALTER TABLE public.motoboy_adiantamentos
      ADD CONSTRAINT motoboy_adiantamentos_fechamento_quinzena_check
      CHECK (fechamento_quinzena IN (1, 2));
  END IF;
END $$;

-- Trigger de updated_at (mesmo padrão das demais tabelas do módulo)
DROP TRIGGER IF EXISTS set_motoboy_adiantamentos_updated_at ON public.motoboy_adiantamentos;
CREATE TRIGGER set_motoboy_adiantamentos_updated_at
  BEFORE UPDATE ON public.motoboy_adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS (Row Level Security)
ALTER TABLE public.motoboy_adiantamentos ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário da empresa pode ver o histórico de adiantamentos.
DROP POLICY IF EXISTS motoboy_adiantamentos_select ON public.motoboy_adiantamentos;
CREATE POLICY motoboy_adiantamentos_select ON public.motoboy_adiantamentos
  FOR SELECT USING (company_id = public.current_company_id());

-- Escrita (inserir/editar/excluir/marcar como descontado): apenas
-- Administrador/Gerente, mesmo padrão de permissão já usado para motoboys,
-- motoristas e tarifas (public.is_company_manager()).
DROP POLICY IF EXISTS motoboy_adiantamentos_write_manager ON public.motoboy_adiantamentos;
CREATE POLICY motoboy_adiantamentos_write_manager ON public.motoboy_adiantamentos
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- Habilitar Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'motoboy_adiantamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.motoboy_adiantamentos;
  END IF;
END $$;
