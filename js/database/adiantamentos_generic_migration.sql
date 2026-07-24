-- GM FLEX Financeiro - Adiantamentos Genéricos (Motoboys + Motoristas)
-- Migração aditiva e TRANSACIONAL: generaliza a tabela public.motoboy_adiantamentos
-- para um modelo único (public.adiantamentos) com `tipo_pessoa` ('MOTOBOY' |
-- 'MOTORISTA') e `pessoa_id`, permitindo reutilizar toda a lógica de vales/
-- descontos por quinzena também para os Motoristas.
--
-- SEGURA e IDEMPOTENTE: pode ser executada mais de uma vez sem duplicar dados
-- nem apagar nada. RETROCOMPATÍVEL: recria `public.motoboy_adiantamentos` como
-- uma VIEW (com gatilhos INSTEAD OF) que se comporta exatamente como a tabela
-- original — qualquer código, relatório ou consulta antiga que ainda use
-- `motoboy_adiantamentos` continua funcionando sem alteração.
--
-- Pré-requisitos: js/database/migrations.sql e js/database/motoboys_module.sql
-- já devem ter sido executados (usa public.set_updated_at(), public.current_company_id(),
-- public.is_company_manager(), public.motoboys, public.motoristas, public.profiles).
-- Também é seguro executar em uma instalação nova, mesmo sem
-- `motoboy_adiantamentos_migration.sql` ter sido executada antes.

BEGIN;

-- 1) Tabela genérica de Adiantamentos ---------------------------------------
CREATE TABLE IF NOT EXISTS public.adiantamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Quem recebeu o adiantamento: MOTOBOY (public.motoboys) ou MOTORISTA
  -- (public.motoristas). Não é possível usar uma única FK relacional para
  -- `pessoa_id` porque ele aponta para duas tabelas diferentes dependendo de
  -- `tipo_pessoa` — a integridade referencial é garantida, em vez disso, pelo
  -- trigger public.check_adiantamento_pessoa() logo abaixo.
  tipo_pessoa TEXT NOT NULL CHECK (tipo_pessoa IN ('MOTOBOY', 'MOTORISTA')),
  pessoa_id UUID NOT NULL,
  data_key DATE NOT NULL,
  valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  motivo TEXT NOT NULL,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Descontado')),
  -- Os pagamentos (motoboys e, agora, motoristas) são feitos por QUINZENA, então
  -- o desconto do adiantamento também é sempre atribuído a uma quinzena
  -- específica (1 = dias 1–15, 2 = dias 16–fim do mês).
  fechamento_mes SMALLINT CHECK (fechamento_mes BETWEEN 1 AND 12),
  fechamento_ano SMALLINT,
  fechamento_quinzena SMALLINT CHECK (fechamento_quinzena IN (1, 2)),
  descontado_em TIMESTAMPTZ,
  usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reforço para quem já rodou uma versão anterior desta migração antes de
-- alguma coluna existir — idempotente e seguro de repetir sempre.
ALTER TABLE public.adiantamentos ADD COLUMN IF NOT EXISTS tipo_pessoa TEXT;
ALTER TABLE public.adiantamentos ADD COLUMN IF NOT EXISTS pessoa_id UUID;

-- 2) Validação de integridade cruzada (pessoa_id × tipo_pessoa) -------------
-- Garante, no nível do banco, que pessoa_id realmente existe na tabela certa
-- (motoboys ou motoristas) e pertence à MESMA empresa do adiantamento —
-- substitui a checagem que uma FK simples não consegue expressar aqui.
CREATE OR REPLACE FUNCTION public.check_adiantamento_pessoa()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo_pessoa = 'MOTOBOY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.motoboys WHERE id = NEW.pessoa_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'adiantamentos.pessoa_id (%) não corresponde a um motoboy da empresa %', NEW.pessoa_id, NEW.company_id;
    END IF;
  ELSIF NEW.tipo_pessoa = 'MOTORISTA' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.motoristas WHERE id = NEW.pessoa_id AND company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'adiantamentos.pessoa_id (%) não corresponde a um motorista da empresa %', NEW.pessoa_id, NEW.company_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'adiantamentos.tipo_pessoa inválido: %', NEW.tipo_pessoa;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_adiantamento_pessoa_trigger ON public.adiantamentos;
CREATE TRIGGER check_adiantamento_pessoa_trigger
  BEFORE INSERT OR UPDATE ON public.adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.check_adiantamento_pessoa();

-- Índices de apoio para os filtros da tela (Tipo/Pessoa / Data / Status)
CREATE INDEX IF NOT EXISTS idx_adiantamentos_company ON public.adiantamentos(company_id);
CREATE INDEX IF NOT EXISTS idx_adiantamentos_pessoa ON public.adiantamentos(tipo_pessoa, pessoa_id);
CREATE INDEX IF NOT EXISTS idx_adiantamentos_status ON public.adiantamentos(company_id, status);
CREATE INDEX IF NOT EXISTS idx_adiantamentos_data ON public.adiantamentos(company_id, data_key);

-- Trigger de updated_at (mesmo padrão das demais tabelas do módulo)
DROP TRIGGER IF EXISTS set_adiantamentos_updated_at ON public.adiantamentos;
CREATE TRIGGER set_adiantamentos_updated_at
  BEFORE UPDATE ON public.adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS (Row Level Security) — idêntico ao padrão já usado em motoboy_adiantamentos
ALTER TABLE public.adiantamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adiantamentos_select ON public.adiantamentos;
CREATE POLICY adiantamentos_select ON public.adiantamentos
  FOR SELECT USING (company_id = public.current_company_id());

DROP POLICY IF EXISTS adiantamentos_write_manager ON public.adiantamentos;
CREATE POLICY adiantamentos_write_manager ON public.adiantamentos
  FOR ALL USING (company_id = public.current_company_id() AND public.is_company_manager())
  WITH CHECK (company_id = public.current_company_id() AND public.is_company_manager());

-- 3) Migração de dados existentes (motoboy_adiantamentos -> adiantamentos) --
-- Só roda se `motoboy_adiantamentos` ainda for uma TABELA de verdade (isto é,
-- a primeira vez que esta migração é executada). Preserva o mesmo `id` de
-- cada registro, então repetir esta migração nunca duplica dados
-- (ON CONFLICT (id) DO NOTHING).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'motoboy_adiantamentos' AND table_type = 'BASE TABLE'
  ) THEN
    INSERT INTO public.adiantamentos (
      id, company_id, tipo_pessoa, pessoa_id, data_key, valor, motivo, observacao, status,
      fechamento_mes, fechamento_ano, fechamento_quinzena, descontado_em, usuario_id, usuario_nome,
      created_at, updated_at
    )
    SELECT
      id, company_id, 'MOTOBOY', motoboy_id, data_key, valor, motivo, observacao, status,
      fechamento_mes, fechamento_ano, fechamento_quinzena, descontado_em, usuario_id, usuario_nome,
      created_at, updated_at
    FROM public.motoboy_adiantamentos
    ON CONFLICT (id) DO NOTHING;

    -- Preserva a tabela original como backup histórico (renomeada, nunca lida
    -- pela aplicação) em vez de apagá-la — migração segura e reversível.
    ALTER TABLE public.motoboy_adiantamentos RENAME TO motoboy_adiantamentos_legacy_backup;
  END IF;
END $$;

-- 4) Compatibilidade retroativa: view `public.motoboy_adiantamentos` --------
-- Qualquer consulta, relatório ou integração antiga que ainda use o nome
-- `motoboy_adiantamentos` (SELECT/INSERT/UPDATE/DELETE) continua funcionando
-- normalmente: a view expõe só os registros MOTOBOY com a coluna `motoboy_id`
-- no lugar de `pessoa_id`, e os gatilhos INSTEAD OF abaixo redirecionam
-- escritas para a tabela genérica `adiantamentos`. A segurança (RLS) continua
-- garantida pela tabela real por trás da view.
CREATE OR REPLACE VIEW public.motoboy_adiantamentos AS
SELECT
  id, company_id, pessoa_id AS motoboy_id, data_key, valor, motivo, observacao, status,
  fechamento_mes, fechamento_ano, fechamento_quinzena, descontado_em, usuario_id, usuario_nome,
  created_at, updated_at
FROM public.adiantamentos
WHERE tipo_pessoa = 'MOTOBOY';

CREATE OR REPLACE FUNCTION public.motoboy_adiantamentos_view_insert()
RETURNS TRIGGER AS $$
DECLARE
  new_row public.adiantamentos;
BEGIN
  INSERT INTO public.adiantamentos (
    id, company_id, tipo_pessoa, pessoa_id, data_key, valor, motivo, observacao, status,
    fechamento_mes, fechamento_ano, fechamento_quinzena, descontado_em, usuario_id, usuario_nome,
    created_at, updated_at
  )
  VALUES (
    COALESCE(NEW.id, gen_random_uuid()), NEW.company_id, 'MOTOBOY', NEW.motoboy_id, NEW.data_key,
    NEW.valor, NEW.motivo, NEW.observacao, COALESCE(NEW.status, 'Pendente'),
    NEW.fechamento_mes, NEW.fechamento_ano, NEW.fechamento_quinzena, NEW.descontado_em,
    NEW.usuario_id, NEW.usuario_nome, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
  )
  RETURNING * INTO new_row;

  NEW.id := new_row.id;
  NEW.company_id := new_row.company_id;
  NEW.motoboy_id := new_row.pessoa_id;
  NEW.data_key := new_row.data_key;
  NEW.valor := new_row.valor;
  NEW.motivo := new_row.motivo;
  NEW.observacao := new_row.observacao;
  NEW.status := new_row.status;
  NEW.fechamento_mes := new_row.fechamento_mes;
  NEW.fechamento_ano := new_row.fechamento_ano;
  NEW.fechamento_quinzena := new_row.fechamento_quinzena;
  NEW.descontado_em := new_row.descontado_em;
  NEW.usuario_id := new_row.usuario_id;
  NEW.usuario_nome := new_row.usuario_nome;
  NEW.created_at := new_row.created_at;
  NEW.updated_at := new_row.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.motoboy_adiantamentos_view_update()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.adiantamentos SET
    data_key = NEW.data_key,
    valor = NEW.valor,
    motivo = NEW.motivo,
    observacao = NEW.observacao,
    status = NEW.status,
    fechamento_mes = NEW.fechamento_mes,
    fechamento_ano = NEW.fechamento_ano,
    fechamento_quinzena = NEW.fechamento_quinzena,
    descontado_em = NEW.descontado_em,
    usuario_id = NEW.usuario_id,
    usuario_nome = NEW.usuario_nome,
    updated_at = NOW()
  WHERE id = OLD.id AND tipo_pessoa = 'MOTOBOY';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.motoboy_adiantamentos_view_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.adiantamentos WHERE id = OLD.id AND tipo_pessoa = 'MOTOBOY';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS motoboy_adiantamentos_view_insert_trg ON public.motoboy_adiantamentos;
CREATE TRIGGER motoboy_adiantamentos_view_insert_trg
  INSTEAD OF INSERT ON public.motoboy_adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.motoboy_adiantamentos_view_insert();

DROP TRIGGER IF EXISTS motoboy_adiantamentos_view_update_trg ON public.motoboy_adiantamentos;
CREATE TRIGGER motoboy_adiantamentos_view_update_trg
  INSTEAD OF UPDATE ON public.motoboy_adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.motoboy_adiantamentos_view_update();

DROP TRIGGER IF EXISTS motoboy_adiantamentos_view_delete_trg ON public.motoboy_adiantamentos;
CREATE TRIGGER motoboy_adiantamentos_view_delete_trg
  INSTEAD OF DELETE ON public.motoboy_adiantamentos
  FOR EACH ROW EXECUTE FUNCTION public.motoboy_adiantamentos_view_delete();

-- 5) Realtime ----------------------------------------------------------------
-- Só a tabela real pode ser adicionada à publicação (views não suportam
-- Realtime). Quem já observava `motoboy_adiantamentos` deve passar a observar
-- `adiantamentos` (filtrando tipo_pessoa = 'MOTOBOY' no client, se necessário).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'adiantamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.adiantamentos;
  END IF;
END $$;

COMMIT;
