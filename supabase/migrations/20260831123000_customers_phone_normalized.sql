-- ==============================================================================
-- Migration: 20260831123000_customers_phone_normalized.sql
-- Descrição: Deduplicação definitiva de clientes por telefone brasileiro normalizado
--            dentro da mesma barbearia (barbershop_id + phone_normalized).
-- Tipo: Aditiva, Transacional, Determinística e Segura
-- ==============================================================================

BEGIN;

-- 1. Adicionar coluna phone_normalized na tabela customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

-- 2. Preencher phone_normalized com a regra canônica de telefone brasileiro:
--    - Extrai apenas dígitos numéricos;
--    - 11 dígitos com 9 na 3ª posição (DDD + 9 + 8 dígitos) -> remove o '9' da 3ª posição, resultando em 10 dígitos;
--    - 10 dígitos (DDD + 8 dígitos) -> mantém os 10 dígitos;
--    - Menos de 10 ou mais de 11 dígitos -> NULL (inválido).
UPDATE public.customers
SET phone_normalized = (
  CASE
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
     AND substring(regexp_replace(phone, '\D', '', 'g') from 3 for 1) = '9'
      THEN substring(regexp_replace(phone, '\D', '', 'g') from 1 for 2)
        || substring(regexp_replace(phone, '\D', '', 'g') from 4)
    WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
      THEN regexp_replace(phone, '\D', '', 'g')
    ELSE NULL
  END
);

-- 3. Identificar e consolidar duplicatas dentro da mesma barbearia (barbershop_id + phone_normalized)
--    Critério determinístico do cliente principal (vencedor):
--    - Mais antigo por created_at (ASC NULLS LAST);
--    - Desempate: Menor id (UUID textual ASC).
DO $$
DECLARE
  dup_record RECORD;
  primary_id UUID;
  primary_phone TEXT;
  primary_name TEXT;
  primary_shop UUID;
BEGIN
  -- Percorre cada par (barbershop_id, phone_normalized) que possui mais de 1 registro
  FOR dup_record IN
    SELECT barbershop_id, phone_normalized
    FROM public.customers
    WHERE barbershop_id IS NOT NULL
      AND phone_normalized IS NOT NULL
    GROUP BY barbershop_id, phone_normalized
    HAVING COUNT(*) > 1
  LOOP
    -- Seleciona o cliente principal (vencedor)
    SELECT id, phone, name, barbershop_id
    INTO primary_id, primary_phone, primary_name, primary_shop
    FROM public.customers
    WHERE barbershop_id = dup_record.barbershop_id
      AND phone_normalized = dup_record.phone_normalized
    ORDER BY created_at ASC NULLS LAST, id ASC
    LIMIT 1;

    -- 4. Transferir customer_photos para o cliente principal:
    --    Caso A: customer_photos.customer_id pertence a um cliente duplicado secundário do mesmo grupo
    --    Caso B: customer_photos.customer_id é NULL e customer_phone normalizado coincide com dup_record.phone_normalized
    --    *Sempre restrito estritamente à mesma barbearia (primary_shop)*
    UPDATE public.customer_photos
    SET 
      customer_id = primary_id,
      customer_phone = primary_phone,
      barbershop_id = COALESCE(barbershop_id, primary_shop)
    WHERE (
      (
        customer_id IN (
          SELECT id FROM public.customers
          WHERE barbershop_id = dup_record.barbershop_id
            AND phone_normalized = dup_record.phone_normalized
            AND id <> primary_id
        )
      )
      OR
      (
        customer_id IS NULL
        AND (barbershop_id = primary_shop OR barbershop_id IS NULL)
        AND (
          CASE
            WHEN length(regexp_replace(customer_phone, '\D', '', 'g')) = 11
             AND substring(regexp_replace(customer_phone, '\D', '', 'g') from 3 for 1) = '9'
              THEN substring(regexp_replace(customer_phone, '\D', '', 'g') from 1 for 2)
                || substring(regexp_replace(customer_phone, '\D', '', 'g') from 4)
            WHEN length(regexp_replace(customer_phone, '\D', '', 'g')) = 10
              THEN regexp_replace(customer_phone, '\D', '', 'g')
            ELSE NULL
          END
        ) = dup_record.phone_normalized
      )
    );

    -- 5. Atualizar appointments da mesma barbearia cujo telefone normalizado coincida
    --    Não altera: staff_id, barbershop_id, user_id, created_by, status, data ou hora.
    UPDATE public.appointments
    SET 
      client_name = primary_name,
      phone = primary_phone
    WHERE barbershop_id = primary_shop
      AND (
        CASE
          WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
           AND substring(regexp_replace(phone, '\D', '', 'g') from 3 for 1) = '9'
            THEN substring(regexp_replace(phone, '\D', '', 'g') from 1 for 2)
              || substring(regexp_replace(phone, '\D', '', 'g') from 4)
          WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
            THEN regexp_replace(phone, '\D', '', 'g')
          ELSE NULL
        END
      ) = dup_record.phone_normalized;

    -- 6. Consolidar métricas e dados no cliente principal de forma segura:
    --    - Preserva avatar usando o primeiro não nulo;
    --    - Preserva notes concatenando conteúdo não vazio sem apagar;
    --    - total_visits: maior valor existente (sem somar);
    --    - total_spent: maior valor existente (sem somar);
    --    - cut_count: maior valor existente (sem somar);
    --    - no_show_count: maior valor existente (sem somar);
    --    - last_visit: maior data de forma segura com proteção contra NULL.
    UPDATE public.customers p
    SET
      avatar = COALESCE(p.avatar, d.best_avatar),
      cut_count = GREATEST(COALESCE(p.cut_count, 0), COALESCE(d.max_cut_count, 0)),
      no_show_count = GREATEST(COALESCE(p.no_show_count, 0), COALESCE(d.max_no_show_count, 0)),
      total_visits = GREATEST(COALESCE(p.total_visits, 0), COALESCE(d.max_total_visits, 0)),
      total_spent = GREATEST(COALESCE(p.total_spent, 0), COALESCE(d.max_total_spent, 0)),
      last_visit = CASE
        WHEN p.last_visit IS NULL THEN d.max_last_visit
        WHEN d.max_last_visit IS NULL THEN p.last_visit
        ELSE GREATEST(p.last_visit, d.max_last_visit)
      END,
      notes = CASE
        WHEN (p.notes IS NULL OR TRIM(p.notes) = '') THEN d.agg_notes
        WHEN (d.agg_notes IS NULL OR TRIM(d.agg_notes) = '') THEN p.notes
        WHEN p.notes = d.agg_notes THEN p.notes
        ELSE p.notes || E'\n' || d.agg_notes
      END,
      updated_at = NOW()
    FROM (
      SELECT 
        MAX(avatar) AS best_avatar,
        MAX(COALESCE(cut_count, 0)) AS max_cut_count,
        MAX(COALESCE(no_show_count, 0)) AS max_no_show_count,
        MAX(COALESCE(total_visits, 0)) AS max_total_visits,
        MAX(COALESCE(total_spent, 0)) AS max_total_spent,
        MAX(last_visit) AS max_last_visit,
        STRING_AGG(NULLIF(TRIM(notes), ''), E'\n') AS agg_notes
      FROM public.customers
      WHERE barbershop_id = dup_record.barbershop_id
        AND phone_normalized = dup_record.phone_normalized
        AND id <> primary_id
    ) d
    WHERE p.id = primary_id;

    -- 7. Remover somente customers duplicados secundários após garantir transferência de todas as fotos
    DELETE FROM public.customers
    WHERE barbershop_id = dup_record.barbershop_id
      AND phone_normalized = dup_record.phone_normalized
      AND id <> primary_id;

  END LOOP;
END $$;

-- 8. Criar índice único parcial para garantir unicidade definitiva por barbearia
--    Permite o mesmo telefone em barbearias diferentes, mas impede duplicatas na mesma barbearia.
CREATE UNIQUE INDEX IF NOT EXISTS customers_barbershop_phone_normalized_key
ON public.customers (barbershop_id, phone_normalized)
WHERE barbershop_id IS NOT NULL
  AND phone_normalized IS NOT NULL;

COMMIT;
