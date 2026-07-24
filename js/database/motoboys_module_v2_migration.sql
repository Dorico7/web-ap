-- GM FLEX Financeiro - Módulo Motoboys v2
-- Migração de reforço para a nova tela de Lançamentos (cartão diário por motoboy)
--
-- A tela de Lançamentos agora grava, no máximo, UM lançamento por
-- (empresa, dia, motoboy, marketplace). Esta migração adiciona uma
-- constraint de unicidade para impedir duplicidade em caso de uso
-- simultâneo por múltiplos usuários (Supabase Realtime), e não afeta
-- nenhum dado ou tela já existente.
--
-- Segura para rodar mais de uma vez (idempotente).

-- 1) Remove eventuais duplicidades antigas, mantendo o lançamento mais recente
--    de cada (company_id, date_key, motoboy_id, transportadora).
DELETE FROM public.motoboy_entries a
USING public.motoboy_entries b
WHERE a.company_id = b.company_id
  AND a.date_key = b.date_key
  AND a.motoboy_id = b.motoboy_id
  AND a.transportadora = b.transportadora
  AND a.id <> b.id
  AND a.updated_at < b.updated_at;

-- 2) Adiciona a constraint de unicidade, se ainda não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'motoboy_entries_unique_day_motoboy_mk'
  ) THEN
    ALTER TABLE public.motoboy_entries
      ADD CONSTRAINT motoboy_entries_unique_day_motoboy_mk
      UNIQUE (company_id, date_key, motoboy_id, transportadora);
  END IF;
END $$;
