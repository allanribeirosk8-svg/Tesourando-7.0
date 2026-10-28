-- ==============================================================================
-- MIGRATION INCREMENTAL DEFINITIVA REVISADA (PATCH CORRETIVO COMPLETO):
-- 20261019000001_staff_availability_and_booking_integrity.sql
-- Status: NÃO APLICADA (Pronta para revisão - Não executar sem autorização expressa)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. GARANTIA ESTRUTURAL DE COLUNAS EM TABELAS DE GRADE E PAUSAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.weekly_breaks 
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS time time,
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

UPDATE public.weekly_breaks
SET 
  start_time = coalesce(start_time, time),
  end_time = coalesce(end_time, (coalesce(start_time, time) + interval '30 minutes')::time)
WHERE start_time IS NULL AND time IS NOT NULL;

ALTER TABLE public.unblocked_slots 
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.blocked_slots 
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.weekly_schedule
  ADD COLUMN IF NOT EXISTS start_time time NOT NULL DEFAULT '08:00:00',
  ADD COLUMN IF NOT EXISTS end_time time NOT NULL DEFAULT '19:00:00',
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------------------------
-- 1. TABELA staff_availability, DIAGNÓSTICO PRÉVIO E INTEGRIDADE RELACIONAL
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  breaks text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_staff_availability_staff_day UNIQUE (staff_id, day_of_week)
);

-- Reconciliação idempotente de colunas caso a tabela já exista
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE CASCADE;
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6);
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT true;
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS breaks text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.staff_availability ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- DIAGNÓSTICO PRÉVIO DE DADOS (Não executa exclusão destrutiva automática sem ciência)
DO $$
DECLARE
  v_null_count int;
  v_dup_count int;
BEGIN
  -- Diagnóstico ampliado para todas as colunas obrigatórias
  SELECT count(*) INTO v_null_count
  FROM public.staff_availability
  WHERE barbershop_id IS NULL 
     OR staff_id IS NULL 
     OR day_of_week IS NULL 
     OR start_time IS NULL 
     OR end_time IS NULL 
     OR is_open IS NULL;

  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT staff_id, day_of_week, count(*)
    FROM public.staff_availability
    GROUP BY staff_id, day_of_week
    HAVING count(*) > 1
  ) dups;

  IF v_null_count > 0 OR v_dup_count > 0 THEN
    RAISE EXCEPTION 'DIAGNÓSTICO PRÉVIO REQUERIDO: A tabela staff_availability contém % registros com campos nulos e % pares (staff_id, day_of_week) duplicados. O saneamento automático foi suspenso. Revise os dados antes de aplicar as constraints NOT NULL e UNIQUE.'
      , v_null_count, v_dup_count
      USING ERRCODE = '23502';
  END IF;
END $$;

-- Aplicação estrita de NOT NULL após confirmação de ausência de nulos
ALTER TABLE public.staff_availability ALTER COLUMN barbershop_id SET NOT NULL;
ALTER TABLE public.staff_availability ALTER COLUMN staff_id SET NOT NULL;
ALTER TABLE public.staff_availability ALTER COLUMN day_of_week SET NOT NULL;
ALTER TABLE public.staff_availability ALTER COLUMN start_time SET NOT NULL;
ALTER TABLE public.staff_availability ALTER COLUMN end_time SET NOT NULL;
ALTER TABLE public.staff_availability ALTER COLUMN is_open SET NOT NULL;

-- Reconciliação e verificação de UNIQUE (staff_id, day_of_week) consultando catálogo por objeto/tabela
DO $$
DECLARE
  v_has_exact_uq boolean := false;
  v_existing_uq_name text;
  v_divergent_type text;
  v_divergent_cols text;
BEGIN
  -- 1. Verificar se JÁ EXISTE qualquer UNIQUE cobrindo exatamente (day_of_week, staff_id) em staff_availability
  SELECT c.conname INTO v_existing_uq_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_availability'
    AND c.contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attname)
      FROM pg_attribute
      WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
    ) = ARRAY['day_of_week', 'staff_id']::name[]
  LIMIT 1;

  IF v_existing_uq_name IS NOT NULL THEN
    v_has_exact_uq := true;
    RAISE NOTICE 'Constraint UNIQUE equivalente já existente em staff_availability com o nome: % (evitada redundância).', v_existing_uq_name;
  END IF;

  -- 2. Diagnóstico de constraint com nome 'uq_staff_availability_staff_day' com definição DIVERGENTE (não remove silenciosamente)
  SELECT c.contype, (
    SELECT array_to_string(array_agg(attname ORDER BY attname), ', ')
    FROM pg_attribute
    WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
  ) INTO v_divergent_type, v_divergent_cols
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_availability'
    AND c.conname = 'uq_staff_availability_staff_day';

  IF v_divergent_type IS NOT NULL THEN
    IF v_divergent_type <> 'u' OR v_divergent_cols <> 'day_of_week, staff_id' THEN
      RAISE EXCEPTION 'DIAGNÓSTICO BLOQUEANTE: A constraint "uq_staff_availability_staff_day" já existe na tabela staff_availability com definição divergente da requerida (tipo=%, colunas=[%], esperado=UNIQUE [day_of_week, staff_id]). A remoção automática foi suspensa para preservar integridade. Intervenção manual requerida.'
        , v_divergent_type, v_divergent_cols
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- 3. Criar constraint se ainda não existir nenhuma equivalente
  IF NOT v_has_exact_uq THEN
    ALTER TABLE public.staff_availability 
      ADD CONSTRAINT uq_staff_availability_staff_day UNIQUE (staff_id, day_of_week);
    RAISE NOTICE 'Constraint uq_staff_availability_staff_day criada com sucesso.';
  END IF;
END $$;

-- Reconciliação de constraints de horário
ALTER TABLE public.staff_availability DROP CONSTRAINT IF EXISTS chk_staff_availability_hours;
ALTER TABLE public.staff_availability DROP CONSTRAINT IF EXISTS chk_staff_availability_time_valid;

ALTER TABLE public.staff_availability ADD CONSTRAINT chk_staff_availability_time_valid CHECK (
  (is_open = true AND start_time < end_time) OR
  (is_open = false AND start_time <= end_time)
);

-- Índice composto de performance
CREATE INDEX IF NOT EXISTS idx_staff_availability_shop_staff_day 
  ON public.staff_availability(barbershop_id, staff_id, day_of_week);

-- Integridade relacional composta: (id, barbershop_id) em staff_profiles para FK direta
-- Verificação no catálogo por objeto/tabela e atributos de coluna ordenados por attname
DO $$
DECLARE
  v_has_sp_uq boolean := false;
  v_existing_sp_uq_name text;
  v_sp_divergent_type text;
  v_sp_divergent_cols text;
  v_has_fk boolean := false;
  v_existing_fk_name text;
  v_fk_divergent_type text;
  v_fk_divergent_cols text;
BEGIN
  -- 1. Verifica se já existe constraint unique cobrindo exatamente (barbershop_id, id) ordenado por attname
  SELECT c.conname INTO v_existing_sp_uq_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_profiles'
    AND c.contype = 'u'
    AND (
      SELECT array_agg(attname ORDER BY attname)
      FROM pg_attribute
      WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
    ) = ARRAY['barbershop_id', 'id']::name[]
  LIMIT 1;

  IF v_existing_sp_uq_name IS NOT NULL THEN
    v_has_sp_uq := true;
    RAISE NOTICE 'Constraint UNIQUE equivalente já existente em staff_profiles com o nome: % (evitada redundância).', v_existing_sp_uq_name;
  END IF;

  -- Diagnóstico de constraint divergente com nome 'uq_staff_profiles_id_shop'
  SELECT c.contype, (
    SELECT array_to_string(array_agg(attname ORDER BY attname), ', ')
    FROM pg_attribute
    WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
  ) INTO v_sp_divergent_type, v_sp_divergent_cols
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_profiles'
    AND c.conname = 'uq_staff_profiles_id_shop';

  IF v_sp_divergent_type IS NOT NULL THEN
    IF v_sp_divergent_type <> 'u' OR v_sp_divergent_cols <> 'barbershop_id, id' THEN
      RAISE EXCEPTION 'DIAGNÓSTICO BLOQUEANTE: A constraint "uq_staff_profiles_id_shop" já existe em staff_profiles com definição divergente (tipo=%, colunas=[%], esperado=UNIQUE [barbershop_id, id]). A remoção automática foi suspensa. Intervenção manual requerida.'
        , v_sp_divergent_type, v_sp_divergent_cols
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_has_sp_uq THEN
    ALTER TABLE public.staff_profiles ADD CONSTRAINT uq_staff_profiles_id_shop UNIQUE (id, barbershop_id);
    RAISE NOTICE 'Constraint uq_staff_profiles_id_shop criada com sucesso.';
  END IF;

  -- 2. FK entre staff_availability e staff_profiles (staff_id, barbershop_id)
  SELECT c.conname INTO v_existing_fk_name
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_availability'
    AND c.contype = 'f'
    AND (
      SELECT array_agg(attname ORDER BY attname)
      FROM pg_attribute
      WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
    ) = ARRAY['barbershop_id', 'staff_id']::name[]
  LIMIT 1;

  IF v_existing_fk_name IS NOT NULL THEN
    v_has_fk := true;
    RAISE NOTICE 'Constraint FK equivalente já existente em staff_availability com o nome: % (evitada redundância).', v_existing_fk_name;
  END IF;

  -- Diagnóstico de FK divergente com nome 'fk_staff_availability_staff_shop'
  SELECT c.contype, (
    SELECT array_to_string(array_agg(attname ORDER BY attname), ', ')
    FROM pg_attribute
    WHERE attrelid = t.oid AND attnum = ANY(c.conkey)
  ) INTO v_fk_divergent_type, v_fk_divergent_cols
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'staff_availability'
    AND c.conname = 'fk_staff_availability_staff_shop';

  IF v_fk_divergent_type IS NOT NULL THEN
    IF v_fk_divergent_type <> 'f' OR v_fk_divergent_cols <> 'barbershop_id, staff_id' THEN
      RAISE EXCEPTION 'DIAGNÓSTICO BLOQUEANTE: A foreign key "fk_staff_availability_staff_shop" já existe com definição divergente (tipo=%, colunas=[%], esperado=FK [barbershop_id, staff_id]). A remoção automática foi suspensa. Intervenção manual requerida.'
        , v_fk_divergent_type, v_fk_divergent_cols
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_has_fk THEN
    ALTER TABLE public.staff_availability 
      ADD CONSTRAINT fk_staff_availability_staff_shop 
      FOREIGN KEY (staff_id, barbershop_id) 
      REFERENCES public.staff_profiles(id, barbershop_id) 
      ON DELETE CASCADE;
    RAISE NOTICE 'Constraint fk_staff_availability_staff_shop criada com sucesso.';
  END IF;
END $$;

-- Trigger adicional de verificação relacional entre staff_id e barbershop_id
CREATE OR REPLACE FUNCTION public.trg_validate_staff_availability_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sp_barbershop_id uuid;
BEGIN
  SELECT barbershop_id INTO v_sp_barbershop_id
  FROM public.staff_profiles
  WHERE id = NEW.staff_id;

  IF v_sp_barbershop_id IS NULL OR v_sp_barbershop_id <> NEW.barbershop_id THEN
    RAISE EXCEPTION 'Inconsistência relacional: staff_id (%) não pertence à barbearia (%).', NEW.staff_id, NEW.barbershop_id
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_staff_availability_tenant ON public.staff_availability;
CREATE TRIGGER trg_validate_staff_availability_tenant
  BEFORE INSERT OR UPDATE OF staff_id, barbershop_id
  ON public.staff_availability
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_staff_availability_tenant();

-- Reconciliar tabela appointments para suportar exceções operacionais autorizadas e auditadas
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_exceptional boolean NOT NULL DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS exceptional_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS exceptional_at timestamptz;

-- ------------------------------------------------------------------------------
-- 2. RLS DE staff_availability
-- ------------------------------------------------------------------------------
ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

-- Limpeza explícita de policies anteriores
DROP POLICY IF EXISTS "staff_availability_select_anon" ON public.staff_availability;
DROP POLICY IF EXISTS "staff_availability_write_admin" ON public.staff_availability;
DROP POLICY IF EXISTS "staff_availability_select_auth" ON public.staff_availability;

-- Policy de leitura autenticada: membros do tenant podem consultar a disponibilidade da equipe
CREATE POLICY "staff_availability_select_auth" ON public.staff_availability
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

-- NOTA: Nenhuma policy de escrita direta concedida.
-- Todas as alterações devem ocorrer via RPCs canônicas SECURITY DEFINER.

-- ------------------------------------------------------------------------------
-- 3. REMOÇÃO DO ÍNDICE/CONSTRAINT LEGADO DE user_id EM barbershop_members
-- ------------------------------------------------------------------------------
-- Justificativa: Permite que um usuário pertença a múltiplas barbearias (multi-tenant),
-- preservando a integridade da PRIMARY KEY (barbershop_id, user_id).
DO $$
DECLARE
  v_con_name text;
  v_idx_name text;
BEGIN
  -- 3.1 Identificar dependências por pg_constraint e remover constraint única unicoluna sobre user_id
  FOR v_con_name IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'barbershop_members'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND (
        SELECT attname FROM pg_attribute 
        WHERE attrelid = t.oid AND attnum = c.conkey[1]
      ) = 'user_id'
  ) LOOP
    EXECUTE 'ALTER TABLE public.barbershop_members DROP CONSTRAINT ' || quote_ident(v_con_name) || ';';
    RAISE NOTICE 'Constraint global de unicidade em user_id removida: %', v_con_name;
  END LOOP;

  -- 3.2 Remover índices únicos autônomos sobre user_id (sem constraint associada)
  FOR v_idx_name IN (
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'barbershop_members'
      AND x.indisunique = true
      AND x.indnatts = 1
      AND (
        SELECT attname FROM pg_attribute 
        WHERE attrelid = c.oid AND attnum = x.indkey[0]
      ) = 'user_id'
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
      )
  ) LOOP
    EXECUTE 'DROP INDEX public.' || quote_ident(v_idx_name) || ';';
    RAISE NOTICE 'Índice autônomo único de user_id removido: %', v_idx_name;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 4. RPC CANÔNICA: save_staff_schedule_atomic
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_staff_schedule_atomic(
  p_barbershop_id uuid,
  p_staff_id uuid,
  p_schedule jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_owner_id uuid;
  v_staff_user_id uuid;
  v_staff_status text;
  v_item jsonb;
  v_day int;
  v_start time;
  v_end time;
  v_is_open boolean;
  v_breaks text[];
  v_break_item text;
  v_break_time time;
  v_break_end time;
  v_days_seen int[] := ARRAY[]::int[];
  v_day_breaks time[];
  v_existing_b time;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- 1. Autorização preliminar do chamador antes de lock
  SELECT (b.owner_id = v_caller_uid), (m.role = 'admin'), b.owner_id
  INTO v_is_owner, v_is_admin, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = v_caller_uid
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbershop_members bm
      WHERE bm.barbershop_id = p_barbershop_id 
        AND bm.user_id = v_caller_uid 
        AND bm.role = 'staff'
    ) THEN
      RAISE EXCEPTION 'Acesso negado: vínculo de membro não está ativo para este estabelecimento.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Serialização por concorrência: lock FOR UPDATE no perfil
  SELECT user_id, status INTO v_staff_user_id, v_staff_status
  FROM public.staff_profiles
  WHERE id = p_staff_id AND barbershop_id = p_barbershop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  IF v_staff_status <> 'active' THEN
    RAISE EXCEPTION 'Profissional inativo ou suspenso não pode alterar horários.' USING ERRCODE = '42501';
  END IF;

  -- 3. Revalidação pós-lock para staff: colaborador comum só edita o próprio horário
  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    IF v_staff_user_id IS NULL OR v_staff_user_id <> v_caller_uid THEN
      RAISE EXCEPTION 'Acesso negado: colaboradores só podem alterar a própria disponibilidade.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 4. Validação estrita do Contrato do Payload (rejeita nulos literais e estruturais)
  IF p_schedule IS NULL OR p_schedule = 'null'::jsonb OR jsonb_typeof(p_schedule) <> 'array' THEN
    RAISE EXCEPTION 'Payload inválido: a grade semanal deve ser um array JSON.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_schedule) <> 7 THEN
    RAISE EXCEPTION 'A grade semanal deve conter exatamente 7 dias (dias 0 a 6). Recebidos: % dias.', jsonb_array_length(p_schedule) USING ERRCODE = '22023';
  END IF;

  -- 5. Limpeza atômica dos dados anteriores do profissional
  DELETE FROM public.staff_availability
  WHERE barbershop_id = p_barbershop_id AND staff_id = p_staff_id;

  DELETE FROM public.weekly_breaks
  WHERE barbershop_id = p_barbershop_id AND staff_id = p_staff_id;

  -- 6. Validação e inserção de cada dia da grade
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_schedule)
  LOOP
    IF v_item IS NULL OR v_item = 'null'::jsonb OR jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Item da grade inválido: esperado objeto JSON.' USING ERRCODE = '22023';
    END IF;

    IF v_item->'day_of_week' IS NULL OR v_item->'day_of_week' = 'null'::jsonb
       OR v_item->'start_time' IS NULL OR v_item->'start_time' = 'null'::jsonb
       OR v_item->'end_time' IS NULL OR v_item->'end_time' = 'null'::jsonb THEN
      RAISE EXCEPTION 'Campos obrigatórios (day_of_week, start_time, end_time) ausentes ou nulos no item da grade.' USING ERRCODE = '22023';
    END IF;

    v_day := (v_item->>'day_of_week')::int;
    IF v_day < 0 OR v_day > 6 THEN
      RAISE EXCEPTION 'day_of_week deve estar entre 0 (Domingo) e 6 (Sábado). Recebido: %.', v_day USING ERRCODE = '22023';
    END IF;

    IF v_day = ANY(v_days_seen) THEN
      RAISE EXCEPTION 'Dia da semana % duplicado no payload da grade.', v_day USING ERRCODE = '22023';
    END IF;
    v_days_seen := array_append(v_days_seen, v_day);

    BEGIN
      v_start := (v_item->>'start_time')::time;
      v_end := (v_item->>'end_time')::time;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Formato de horário inválido no dia % (esperado HH:MI ou HH:MI:SS).'
        , v_day USING ERRCODE = '22023';
    END;

    -- Canonização estrita de meia-noite pelo valor temporal convertido (não por comparação de string isolada)
    -- Se o término for temporalmente 00:00:00 (início do dia civil), rejeita: o encerramento do dia deve ser 24:00:00
    IF v_end = '00:00:00'::time THEN
      RAISE EXCEPTION 'Horário de término à meia-noite convertido para % deve ser representado canonicamente como "24:00:00" (encerramento do dia), e não "00:00:00" (início do dia) no dia %.'
        , v_end, v_day USING ERRCODE = '22023';
    END IF;

    -- O início do expediente não pode ser 24:00:00
    IF v_start = '24:00:00'::time THEN
      RAISE EXCEPTION 'Horário de início convertido para % não pode ser 24:00:00 no dia %. O início do dia deve ser 00:00:00.'
        , v_start, v_day USING ERRCODE = '22023';
    END IF;

    v_is_open := coalesce((v_item->>'is_open')::boolean, true);

    IF v_is_open THEN
      IF v_start >= v_end THEN
        RAISE EXCEPTION 'Horário inicial (%) deve ser estritamente menor que horário final (%) no dia %.', v_start, v_end, v_day USING ERRCODE = '22023';
      END IF;
    END IF;

    v_breaks := ARRAY[]::text[];
    v_day_breaks := ARRAY[]::time[];

    IF v_is_open AND v_item ? 'breaks' AND v_item->'breaks' IS NOT NULL AND v_item->'breaks' <> 'null'::jsonb THEN
      IF jsonb_typeof(v_item->'breaks') <> 'array' THEN
        RAISE EXCEPTION 'O campo breaks deve ser um array JSON.' USING ERRCODE = '22023';
      END IF;

      FOR v_break_item IN SELECT jsonb_array_elements_text(v_item->'breaks')
      LOOP
        IF v_break_item IS NULL OR trim(v_break_item) = '' THEN
          CONTINUE;
        END IF;

        BEGIN
          v_break_time := v_break_item::time;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Formato de horário de pausa inválido: "%" no dia %.', v_break_item, v_day USING ERRCODE = '22023';
        END;

        -- Validar término do intervalo usando interval ANTES de fazer cast para time
        IF (v_break_time::interval + interval '30 minutes') > interval '24 hours' THEN
          RAISE EXCEPTION 'Intervalo de pausa às % ultrapassa o término do dia (meia-noite) no dia %.', v_break_item, v_day USING ERRCODE = '22023';
        END IF;

        IF (v_break_time::interval + interval '30 minutes') > v_end::interval THEN
          RAISE EXCEPTION 'Intervalo de pausa (% + 30 min) excede o término do expediente (% às %) no dia %.', v_break_time, v_start, v_end, v_day USING ERRCODE = '22023';
        END IF;

        IF v_break_time < v_start THEN
          RAISE EXCEPTION 'Intervalo de pausa às % inicia antes do expediente (% às %) no dia %.', v_break_time, v_start, v_end, v_day USING ERRCODE = '22023';
        END IF;

        -- Bloco canônico de 30 minutos por intervalo (evita wrap-around para 00:00 se terminar às 24:00)
        IF (v_break_time::interval + interval '30 minutes') = interval '24 hours' THEN
          v_break_end := '24:00:00'::time;
        ELSE
          v_break_end := (v_break_time + interval '30 minutes')::time;
        END IF;

        -- Validação contra duplicação e sobreposição
        FOREACH v_existing_b IN ARRAY v_day_breaks
        LOOP
          IF v_break_time = v_existing_b THEN
            RAISE EXCEPTION 'Pausa duplicada às % no dia %.', v_break_time, v_day USING ERRCODE = '22023';
          END IF;
          IF (v_break_time < (v_existing_b + interval '30 minutes')::time) AND (v_break_end > v_existing_b) THEN
            RAISE EXCEPTION 'Sobreposição detectada entre pausas (% e %) no dia %.', v_break_time, v_existing_b, v_day USING ERRCODE = '22023';
          END IF;
        END LOOP;

        v_day_breaks := array_append(v_day_breaks, v_break_time);
        v_breaks := array_append(v_breaks, to_char(v_break_time, 'HH24:MI'));

        -- Espelho isolado em weekly_breaks para consultas de conflito
        INSERT INTO public.weekly_breaks (
          barbershop_id, staff_id, day_of_week, time, start_time, end_time
        ) VALUES (
          p_barbershop_id, p_staff_id, v_day, v_break_time, v_break_time, v_break_end
        );
      END LOOP;
    END IF;

    INSERT INTO public.staff_availability (
      barbershop_id, staff_id, day_of_week, start_time, end_time, is_open, breaks
    ) VALUES (
      p_barbershop_id, p_staff_id, v_day, v_start, v_end, v_is_open, v_breaks
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.save_staff_schedule_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_staff_schedule_atomic(uuid, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RPC CANÔNICA: reset_staff_schedule_to_default
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_staff_schedule_to_default(
  p_barbershop_id uuid,
  p_staff_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_staff_user_id uuid;
  v_staff_status text;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Checagem preliminar de tenant e autorização
  SELECT (b.owner_id = v_caller_uid), (m.role = 'admin')
  INTO v_is_owner, v_is_admin
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = v_caller_uid
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbershop_members bm
      WHERE bm.barbershop_id = p_barbershop_id 
        AND bm.user_id = v_caller_uid 
        AND bm.role = 'staff'
    ) THEN
      RAISE EXCEPTION 'Acesso negado: vínculo de membro não está ativo para este estabelecimento.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Lock pessimista no perfil
  SELECT user_id, status INTO v_staff_user_id, v_staff_status
  FROM public.staff_profiles
  WHERE id = p_staff_id AND barbershop_id = p_barbershop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  IF v_staff_status <> 'active' THEN
    RAISE EXCEPTION 'Profissional inativo não pode alterar horários.' USING ERRCODE = '42501';
  END IF;

  -- Revalidação pós-lock para staff
  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    IF v_staff_user_id IS NULL OR v_staff_user_id <> v_caller_uid THEN
      RAISE EXCEPTION 'Acesso negado: colaboradores só podem redefinir a própria disponibilidade.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Limpar disponibilidade individual para restaurar herança da grade geral
  DELETE FROM public.staff_availability
  WHERE barbershop_id = p_barbershop_id AND staff_id = p_staff_id;

  DELETE FROM public.weekly_breaks
  WHERE barbershop_id = p_barbershop_id AND staff_id = p_staff_id;

  RETURN jsonb_build_object('success', true, 'inherited', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_staff_schedule_to_default(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_staff_schedule_to_default(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. REMOÇÃO E READMISSÃO: remove_staff_from_barbershop E reactivate_staff
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_staff_from_barbershop(
  p_barbershop_id uuid,
  p_staff_profile_id uuid,
  p_staff_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_owner_id uuid;
  v_actual_user_id uuid;
  v_target_role text;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = v_caller_uid), (m.role = 'admin'), b.owner_id
  INTO v_is_owner, v_is_admin, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = v_caller_uid
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem remover membros.' USING ERRCODE = '42501';
  END IF;

  -- Serializar com lock FOR UPDATE no perfil
  SELECT user_id INTO v_actual_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  -- Conferir correspondência estrita com user_id do perfil se fornecido pelo frontend
  IF p_staff_user_id IS NOT NULL AND v_actual_user_id IS NOT NULL AND p_staff_user_id <> v_actual_user_id THEN
    RAISE EXCEPTION 'Validação de integridade: user_id informado diverge do perfil operacional.' USING ERRCODE = '22023';
  END IF;

  IF p_staff_user_id IS NOT NULL AND v_actual_user_id IS NULL THEN
    RAISE EXCEPTION 'Validação de integridade: profissional não possui conta de usuário vinculada.' USING ERRCODE = '22023';
  END IF;

  -- Proteger proprietário da barbearia
  IF v_actual_user_id IS NOT NULL AND v_actual_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Não é permitido remover o proprietário da barbearia.' USING ERRCODE = '42501';
  END IF;

  -- Hierarquia administrativa: admin não remove a si mesmo, outro admin ou o proprietário
  IF coalesce(v_is_owner, false) = false THEN
    IF v_actual_user_id = v_caller_uid THEN
      RAISE EXCEPTION 'Administradores não podem remover a si mesmos da barbearia.' USING ERRCODE = '42501';
    END IF;

    IF v_actual_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role
      FROM public.barbershop_members
      WHERE barbershop_id = p_barbershop_id AND user_id = v_actual_user_id;

      IF v_target_role IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: administradores não podem remover outros administradores ou o proprietário.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 1. Inativar perfil operacional no tenant (preserva histórico)
  UPDATE public.staff_profiles
  SET status = 'inactive', updated_at = now()
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  -- 2. Revogar membership exclusivamente deste tenant quando houver conta vinculada
  IF v_actual_user_id IS NOT NULL THEN
    DELETE FROM public.barbershop_members
    WHERE barbershop_id = p_barbershop_id AND user_id = v_actual_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reactivate_staff(
  p_barbershop_id uuid,
  p_staff_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_target_user_id uuid;
  v_owner_id uuid;
  v_current_membership_role text;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = v_caller_uid), (m.role = 'admin'), b.owner_id
  INTO v_is_owner, v_is_admin, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = v_caller_uid
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem reativar profissionais.' USING ERRCODE = '42501';
  END IF;

  -- Serializar com lock FOR UPDATE no perfil
  SELECT user_id INTO v_target_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  -- Hierarquia administrativa: admin comum não altera owner ou outro admin
  IF coalesce(v_is_owner, false) = false AND v_target_user_id IS NOT NULL THEN
    IF v_target_user_id = v_owner_id THEN
      RAISE EXCEPTION 'Acesso negado: administradores não podem reativar o proprietário.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_membership_role
    FROM public.barbershop_members
    WHERE barbershop_id = p_barbershop_id AND user_id = v_target_user_id;

    IF v_current_membership_role = 'admin' THEN
      RAISE EXCEPTION 'Acesso negado: administradores não podem modificar outro administrador.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1. Reativar perfil operacional
  UPDATE public.staff_profiles
  SET status = 'active', updated_at = now()
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  -- 2. Readmitir como staff SOMENTE quando membership estiver ausente (preserva admin/staff/owner existentes)
  IF v_target_user_id IS NOT NULL THEN
    SELECT role INTO v_current_membership_role
    FROM public.barbershop_members
    WHERE barbershop_id = p_barbershop_id AND user_id = v_target_user_id
    FOR UPDATE;

    IF v_current_membership_role IS NULL THEN
      IF v_target_user_id = v_owner_id THEN
        INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
        VALUES (p_barbershop_id, v_target_user_id, 'owner');
      ELSE
        INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
        VALUES (p_barbershop_id, v_target_user_id, 'staff');
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_staff(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. TRIGGER UNIFICADO: CONCORRÊNCIA, STATUS, EXPEDIENTE, PAUSAS E AUDITORIA
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_validate_appointment_staff_eligibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_status text;
  v_staff_barbershop_id uuid;
  v_day_of_week int;
  v_staff_is_open boolean;
  v_staff_start time;
  v_staff_end time;
  v_sched_is_open boolean;
  v_sched_start time;
  v_sched_end time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_day_end_ts timestamp;
  v_shift_start_ts timestamp;
  v_shift_end_ts timestamp;
  v_caller_uid uuid := auth.uid();
  v_is_admin_or_owner boolean := false;
  v_is_general_unblocked boolean := false;
  v_is_staff_unblocked boolean := false;
  v_schedule_exists boolean := false;
  v_has_individual_schedule boolean := false;
  v_schedule_changed boolean := false;
BEGIN
  -- 1. Política para staff_id NULL: rejeitado com erro explícito de validação
  IF NEW.staff_id IS NULL THEN
    RAISE EXCEPTION 'staff_id é obrigatório para agendamentos operacionais.' USING ERRCODE = '22023';
  END IF;

  -- 2. Duração e Passagem de Meia-Noite com Aritmética de Timestamp (sem wrap-around modulo 24)
  IF NEW.duration IS NULL OR NEW.duration <= 0 OR NEW.duration > 720 THEN
    RAISE EXCEPTION 'Duração inválida. Deve estar entre 1 e 720 minutos.' USING ERRCODE = '22023';
  END IF;

  v_start_ts := NEW.date + NEW.time;
  v_end_ts := v_start_ts + (NEW.duration || ' minutes')::interval;
  v_day_end_ts := NEW.date + interval '1 day';

  IF v_end_ts > v_day_end_ts THEN
    RAISE EXCEPTION 'Agendamento ultrapassa o encerramento do dia (meia-noite). Horário e duração inválidos.' USING ERRCODE = '22023';
  END IF;

  -- 3. Detectar se houve alteração de grade, profissional, status ou data/hora
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.status IN ('cancelled', 'no-show') AND NEW.status NOT IN ('cancelled', 'no-show'))
       OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.barbershop_id <> OLD.barbershop_id
       OR NEW.date <> OLD.date
       OR NEW.time <> OLD.time
       OR NEW.duration <> OLD.duration
       OR NEW.is_exceptional IS DISTINCT FROM OLD.is_exceptional THEN
      v_schedule_changed := true;
    END IF;
  ELSE
    v_schedule_changed := true;
  END IF;

  -- 4. Validação relacional e de status com lock FOR SHARE para serializar com inativação concorrente
  SELECT status, barbershop_id INTO v_staff_status, v_staff_barbershop_id
  FROM public.staff_profiles
  WHERE id = NEW.staff_id
  FOR SHARE;

  IF v_staff_barbershop_id IS NULL OR v_staff_barbershop_id <> NEW.barbershop_id THEN
    RAISE EXCEPTION 'O profissional selecionado não pertence a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  -- Exigir status active somente em criação, reatribuição, reagendamento ou reocupação de horário.
  -- Permite cancelamento, no-show ou conclusão histórica de atendimentos existentes de profissionais inativos.
  IF (TG_OP = 'INSERT' OR v_schedule_changed = true) THEN
    IF v_staff_status <> 'active' THEN
      RAISE EXCEPTION 'Não é permitido criar, reatribuir, reagendar ou reocupar horário para um profissional inativo ou suspenso.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 5. Auditoria e Proteção de Exceções (is_exceptional)
  -- Executada antes do descarte de disponibilidade para proteger autoria mesmo em cancelamentos
  IF NEW.is_exceptional IS TRUE THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.is_exceptional IS NOT TRUE OR v_schedule_changed = true)) THEN
      -- Requer validação server-side de privilégio de owner ou admin
      IF v_caller_uid IS NULL THEN
        RAISE EXCEPTION 'Agendamentos excepcionais requerem autorização expressa de administrador autenticado.'
          USING ERRCODE = '42501';
      END IF;

      SELECT true INTO v_is_admin_or_owner
      FROM public.barbershops b
      WHERE b.id = NEW.barbershop_id AND b.owner_id = v_caller_uid
      UNION
      SELECT true FROM public.barbershop_members bm
      WHERE bm.barbershop_id = NEW.barbershop_id 
        AND bm.user_id = v_caller_uid 
        AND bm.role IN ('owner', 'admin')
      LIMIT 1;

      IF coalesce(v_is_admin_or_owner, false) = false THEN
        RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem autorizar agendamentos excepcionais.'
          USING ERRCODE = '42501';
      END IF;

      -- Gravação protegida no servidor (impede adulteração de auditoria pelo cliente)
      NEW.exceptional_by := v_caller_uid;
      NEW.exceptional_at := now();
    ELSE
      -- Em atualização sem alteração de horário (ex: colaborador marcando como concluído ou cancelando): preserva histórico original
      NEW.exceptional_by := OLD.exceptional_by;
      NEW.exceptional_at := OLD.exceptional_at;
    END IF;
  ELSE
    NEW.exceptional_by := NULL;
    NEW.exceptional_at := NULL;
  END IF;

  -- 6. Agendamento cancelado ou marcado como no-show: desocupa o horário.
  -- Com a auditoria resguardada no passo 5, o cancelamento é dispensado das validações
  -- de disponibilidade de agenda (expediente, pausas, bloqueios e sobreposição).
  IF NEW.status IN ('cancelled', 'no-show') THEN
    RETURN NEW;
  END IF;

  -- 7. Validação de Expediente, Pausas e Bloqueios para Agendamentos Regulares
  IF NEW.is_exceptional IS NOT TRUE AND v_schedule_changed = true THEN
    v_day_of_week := extract(dow FROM NEW.date);

    -- 7.1 Horário de Trabalho (Individual ou Herança Geral)
    SELECT is_open, start_time, end_time INTO v_staff_is_open, v_staff_start, v_staff_end
    FROM public.staff_availability
    WHERE barbershop_id = NEW.barbershop_id AND staff_id = NEW.staff_id AND day_of_week = v_day_of_week;

    IF FOUND THEN
      v_schedule_exists := true;
      v_has_individual_schedule := true;
      IF coalesce(v_staff_is_open, false) = false THEN
        RAISE EXCEPTION 'O profissional não atende neste dia da semana. Para agendar fora do expediente, marque como Agendamento Excepcional.' USING ERRCODE = '22023';
      END IF;

      v_shift_start_ts := NEW.date + v_staff_start;
      v_shift_end_ts := CASE 
        WHEN v_staff_end = '24:00:00'::time OR (v_staff_end = '00:00:00'::time AND v_staff_start > '00:00:00'::time)
          THEN NEW.date + interval '1 day'
        ELSE NEW.date + v_staff_end
      END;

      IF v_start_ts < v_shift_start_ts OR v_end_ts > v_shift_end_ts THEN
        RAISE EXCEPTION 'Horário fora do expediente do profissional. Para agendar fora do horário, marque como Agendamento Excepcional.' USING ERRCODE = '22023';
      END IF;
    ELSE
      -- Herança da grade geral da barbearia
      SELECT is_open, start_time, end_time INTO v_sched_is_open, v_sched_start, v_sched_end
      FROM public.weekly_schedule
      WHERE barbershop_id = NEW.barbershop_id AND day_of_week = v_day_of_week;

      IF FOUND THEN
        v_schedule_exists := true;
        IF coalesce(v_sched_is_open, false) = false THEN
          RAISE EXCEPTION 'A barbearia está fechada neste dia da semana. Para agendar fora do expediente, marque como Agendamento Excepcional.' USING ERRCODE = '22023';
        END IF;

        v_shift_start_ts := NEW.date + v_sched_start;
        v_shift_end_ts := CASE 
          WHEN v_sched_end = '24:00:00'::time OR (v_sched_end = '00:00:00'::time AND v_sched_start > '00:00:00'::time)
            THEN NEW.date + interval '1 day'
          ELSE NEW.date + v_sched_end
        END;

        IF v_start_ts < v_shift_start_ts OR v_end_ts > v_shift_end_ts THEN
          RAISE EXCEPTION 'Horário fora do expediente da barbearia. Para agendar fora do horário, marque como Agendamento Excepcional.' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    IF v_schedule_exists = false THEN
      RAISE EXCEPTION 'Nenhum horário de funcionamento configurado para este dia da semana. Não é permitido agendar sem grade definida.' USING ERRCODE = '22023';
    END IF;

    -- 7.2 Distinção Estrita de Desbloqueios: Geral vs Individual
    SELECT true INTO v_is_general_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = NEW.barbershop_id
      AND u.date = NEW.date
      AND u.staff_id IS NULL
      AND to_char(u.time::time, 'HH24:MI') = to_char(NEW.time, 'HH24:MI')
    LIMIT 1;

    SELECT true INTO v_is_staff_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = NEW.barbershop_id
      AND u.date = NEW.date
      AND u.staff_id = NEW.staff_id
      AND to_char(u.time::time, 'HH24:MI') = to_char(NEW.time, 'HH24:MI')
    LIMIT 1;

    -- Pausas e Bloqueios Gerais da Barbearia (superados SOMENTE por desbloqueio geral)
    IF coalesce(v_is_general_unblocked, false) = false THEN
      -- Pausa geral da barbearia: aplica-se quando o profissional NÃO possui grade individual própria
      IF v_has_individual_schedule = false THEN
        IF EXISTS (
          SELECT 1 FROM public.weekly_breaks wb
          WHERE wb.barbershop_id = NEW.barbershop_id
            AND wb.staff_id IS NULL
            AND wb.day_of_week = v_day_of_week
            AND (
              v_start_ts < (NEW.date + coalesce(wb.start_time, wb.time) + (
                CASE 
                  WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                    THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                  WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                    THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                  ELSE interval '30 minutes'
                END
              ))
              AND v_end_ts > (NEW.date + coalesce(wb.start_time, wb.time))
            )
        ) THEN
          RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo da barbearia.' USING ERRCODE = '23505';
        END IF;
      END IF;

      -- Bloqueio pontual geral de calendário fecha o estabelecimento para todos
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = NEW.barbershop_id
          AND b.staff_id IS NULL
          AND b.date = NEW.date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado na agenda do estabelecimento.' USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Pausas e Bloqueios Individuais deste profissional (superados SOMENTE por desbloqueio individual deste profissional)
    IF coalesce(v_is_staff_unblocked, false) = false THEN
      IF EXISTS (
        SELECT 1 FROM public.weekly_breaks wb
        WHERE wb.barbershop_id = NEW.barbershop_id
          AND wb.staff_id = NEW.staff_id
          AND wb.day_of_week = v_day_of_week
          AND (
            v_start_ts < (NEW.date + coalesce(wb.start_time, wb.time) + (
              CASE 
                WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                  THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                  THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                ELSE interval '30 minutes'
              END
            ))
            AND v_end_ts > (NEW.date + coalesce(wb.start_time, wb.time))
          )
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com intervalo de descanso deste profissional.' USING ERRCODE = '23505';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = NEW.barbershop_id
          AND b.staff_id = NEW.staff_id
          AND b.date = NEW.date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Profissional indisponível neste horário.' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- 8. SERIALIZAÇÃO TRANSACIONAL UNIFICADA ANTI-SOBREPOSIÇÃO (TODOS OS CAMINHOS)
  IF v_schedule_changed = true THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW.barbershop_id::text
        || ':' || NEW.date::text
        || ':' || NEW.staff_id::text,
        0
      )
    );

    IF EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.barbershop_id = NEW.barbershop_id
        AND a.staff_id = NEW.staff_id
        AND a.date = NEW.date
        AND a.id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND a.status NOT IN ('cancelled', 'no-show')
        AND (v_start_ts < (a.date + a.time + (coalesce(a.duration, 30) || ' minutes')::interval))
        AND (v_end_ts > (a.date + a.time))
    ) THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário já ocupado por outro atendimento para este profissional.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_appointment_integrity ON public.appointments;
DROP TRIGGER IF EXISTS trg_validate_appointment_staff_eligibility ON public.appointments;
CREATE TRIGGER trg_validate_appointment_staff_eligibility
  BEFORE INSERT OR UPDATE OF staff_id, barbershop_id, date, time, duration, status, is_exceptional, exceptional_by, exceptional_at
  ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_validate_appointment_staff_eligibility();

-- ------------------------------------------------------------------------------
-- 8. RPC: process_public_booking_atomic (Exclusiva service_role)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_public_booking_atomic(
  p_slug text,
  p_client_name text,
  p_client_phone text,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_date date,
  p_time time,
  p_observation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_barbershop_id uuid;
  v_owner_id uuid;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_staff_name text;
  v_target_staff_id uuid := p_staff_id;
  v_customer_id uuid;
  v_new_appointment_id uuid;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_day_end_ts timestamp;
  v_shift_start_ts timestamp;
  v_shift_end_ts timestamp;
  v_day_of_week int;
  v_sched_start time;
  v_sched_end time;
  v_is_open boolean;
  v_staff_is_open boolean;
  v_staff_start time;
  v_staff_end time;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
  v_is_general_unblocked boolean := false;
  v_is_staff_unblocked boolean := false;
  v_has_individual_schedule boolean := false;
BEGIN
  -- 1. Validação estrita de limites de entrada
  IF length(v_clean_name) < 3 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 3 e 80 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone do cliente deve conter 10 ou 11 dígitos com DDD.' USING ERRCODE = '22023';
  END IF;

  IF v_clean_obs IS NOT NULL AND length(v_clean_obs) > 500 THEN
    RAISE EXCEPTION 'Observação excede o limite máximo de 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- 2. Validação estrita de datas
  IF p_date < current_date THEN
    RAISE EXCEPTION 'Data do agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_date = current_date THEN
    IF p_time <= ((now() AT TIME ZONE 'America/Sao_Paulo')::time + interval '10 minutes') THEN
      RAISE EXCEPTION 'Horário solicitado já expirou para a data de hoje.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_date > (current_date + interval '180 days') THEN
    RAISE EXCEPTION 'Data do agendamento não pode exceder o limite de 180 dias no futuro.' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolver Tenant exclusivamente por slug em barbershops
  SELECT id, owner_id INTO v_barbershop_id, v_owner_id
  FROM public.barbershops
  WHERE slug = lower(trim(p_slug));

  IF v_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'Barbearia não encontrada para o link informado.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validar serviços do tenant e duração
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 10 serviços válidos.' USING ERRCODE = '22023';
  END IF;

  -- Validação estrita por serviço individual (impede durações nulas, zeradas ou negativas)
  IF EXISTS (
    SELECT 1 FROM public.services
    WHERE barbershop_id = v_barbershop_id
      AND id = ANY(p_service_ids)
      AND (duration IS NULL OR duration <= 0)
  ) THEN
    RAISE EXCEPTION 'Um ou mais serviços selecionados possuem duração inválida (deve ser estritamente positiva).' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = v_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços selecionados não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 OR v_total_duration > 720 THEN
    RAISE EXCEPTION 'Duração total de serviços inválida (deve estar entre 1 e 720 minutos).' USING ERRCODE = '22023';
  END IF;

  v_start_ts := p_date + p_time;
  v_end_ts := v_start_ts + (v_total_duration || ' minutes')::interval;
  v_day_end_ts := p_date + interval '1 day';

  IF v_end_ts > v_day_end_ts THEN
    RAISE EXCEPTION 'Agendamento ultrapassa o encerramento do dia (meia-noite). Horário e duração inválidos.' USING ERRCODE = '22023';
  END IF;

  v_day_of_week := extract(dow FROM p_date);

  -- 5. Validar e alocar profissional (Staff) e Expediente (Grade Individual substitui a Geral)
  IF p_staff_id IS NOT NULL THEN
    SELECT id, name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles
    WHERE id = p_staff_id
      AND barbershop_id = v_barbershop_id
      AND status = 'active';

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'O profissional selecionado não está ativo ou não pertence a esta barbearia.' USING ERRCODE = '22023';
    END IF;

    -- Validar grade individual (se existir) ou herança da grade geral da barbearia
    SELECT is_open, start_time, end_time
    INTO v_staff_is_open, v_staff_start, v_staff_end
    FROM public.staff_availability
    WHERE barbershop_id = v_barbershop_id
      AND staff_id = v_target_staff_id
      AND day_of_week = v_day_of_week;

    IF FOUND THEN
      v_has_individual_schedule := true;
      IF coalesce(v_staff_is_open, false) = false THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: O profissional não atende neste dia da semana.' USING ERRCODE = '23505';
      END IF;

      v_shift_start_ts := p_date + v_staff_start;
      v_shift_end_ts := CASE 
        WHEN v_staff_end = '24:00:00'::time OR (v_staff_end = '00:00:00'::time AND v_staff_start > '00:00:00'::time)
          THEN p_date + interval '1 day'
        ELSE p_date + v_staff_end
      END;

      IF v_start_ts < v_shift_start_ts OR v_end_ts > v_shift_end_ts THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário solicitado está fora do expediente deste profissional.' USING ERRCODE = '23505';
      END IF;
    ELSE
      -- Herança da grade de funcionamento geral da barbearia
      SELECT is_open, start_time, end_time INTO v_is_open, v_sched_start, v_sched_end
      FROM public.weekly_schedule
      WHERE barbershop_id = v_barbershop_id AND day_of_week = v_day_of_week;

      IF NOT FOUND OR coalesce(v_is_open, false) = false THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: A barbearia não está aberta para atendimento neste dia da semana.' USING ERRCODE = '23505';
      END IF;

      v_shift_start_ts := p_date + v_sched_start;
      v_shift_end_ts := CASE 
        WHEN v_sched_end = '24:00:00'::time OR (v_sched_end = '00:00:00'::time AND v_sched_start > '00:00:00'::time)
          THEN p_date + interval '1 day'
        ELSE p_date + v_sched_end
      END;

      IF v_start_ts < v_shift_start_ts OR v_end_ts > v_shift_end_ts THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário solicitado está fora do expediente de funcionamento da barbearia.' USING ERRCODE = '23505';
      END IF;
    END IF;

    -- Validar ancoragem de atendimento (passos de 15 minutos)
    IF (EXTRACT(EPOCH FROM (p_time - coalesce(v_staff_start, v_sched_start)))::int % 900) <> 0 THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário solicitado não está alinhado à grade de atendimento deste profissional.' USING ERRCODE = '23505';
    END IF;

    -- Desbloqueio geral e individual avaliados com rigor de escopo
    SELECT true INTO v_is_general_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = v_barbershop_id
      AND u.date = p_date
      AND u.staff_id IS NULL
      AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
    LIMIT 1;

    SELECT true INTO v_is_staff_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = v_barbershop_id
      AND u.date = p_date
      AND u.staff_id = v_target_staff_id
      AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
    LIMIT 1;

    IF coalesce(v_is_general_unblocked, false) = false THEN
      -- Pausa geral da barbearia: aplica-se quando o profissional NÃO tem grade individual
      IF v_has_individual_schedule = false THEN
        IF EXISTS (
          SELECT 1 FROM public.weekly_breaks wb
          WHERE wb.barbershop_id = v_barbershop_id
            AND wb.staff_id IS NULL
            AND wb.day_of_week = v_day_of_week
            AND (
              v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
                CASE 
                  WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                    THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                  WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                    THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                  ELSE interval '30 minutes'
                END
              ))
              AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time))
            )
        ) THEN
          RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo da barbearia.' USING ERRCODE = '23505';
        END IF;
      END IF;

      -- Bloqueio pontual geral de calendário fecha o estabelecimento para todos
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id
          AND b.staff_id IS NULL
          AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado na agenda do estabelecimento.' USING ERRCODE = '23505';
      END IF;
    END IF;

    IF coalesce(v_is_staff_unblocked, false) = false THEN
      IF EXISTS (
        SELECT 1 FROM public.weekly_breaks wb
        WHERE wb.barbershop_id = v_barbershop_id
          AND wb.staff_id = v_target_staff_id
          AND wb.day_of_week = v_day_of_week
          AND (
            v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
              CASE 
                WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                  THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                  THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                ELSE interval '30 minutes'
              END
            ))
            AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time))
          )
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com intervalo de descanso deste profissional.' USING ERRCODE = '23505';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id
          AND b.staff_id = v_target_staff_id
          AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Profissional indisponível neste horário.' USING ERRCODE = '23505';
      END IF;
    END IF;

  ELSE
    -- "Qualquer profissional": alocar candidato ativo que esteja REALMENTE livre
    SELECT sp.id, sp.name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles sp
    WHERE sp.barbershop_id = v_barbershop_id
      AND sp.status = 'active'
      -- Compatível com grade individual ou geral (usando cálculo de timestamp)
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM public.staff_availability sa
            WHERE sa.barbershop_id = v_barbershop_id
              AND sa.staff_id = sp.id
              AND sa.day_of_week = v_day_of_week
          )
          AND EXISTS (
            SELECT 1 FROM public.weekly_schedule ws
            WHERE ws.barbershop_id = v_barbershop_id
              AND ws.day_of_week = v_day_of_week
              AND ws.is_open = true
              AND v_start_ts >= (p_date + ws.start_time)
              AND (EXTRACT(EPOCH FROM (p_time - ws.start_time))::int % 900) = 0
              AND v_end_ts <= (
                CASE 
                  WHEN ws.end_time = '24:00:00'::time OR (ws.end_time = '00:00:00'::time AND ws.start_time > '00:00:00'::time)
                    THEN p_date + interval '1 day'
                  ELSE p_date + ws.end_time
                END
              )
          )
        )
        OR EXISTS (
          SELECT 1 FROM public.staff_availability sa
          WHERE sa.barbershop_id = v_barbershop_id
            AND sa.staff_id = sp.id
            AND sa.day_of_week = v_day_of_week
            AND sa.is_open = true
            AND v_start_ts >= (p_date + sa.start_time)
            AND (EXTRACT(EPOCH FROM (p_time - sa.start_time))::int % 900) = 0
            AND v_end_ts <= (
                CASE 
                  WHEN sa.end_time = '24:00:00'::time OR (sa.end_time = '00:00:00'::time AND sa.start_time > '00:00:00'::time)
                    THEN p_date + interval '1 day'
                  ELSE p_date + sa.end_time
                END
              )
        )
      )
      -- Pausas e bloqueios gerais da barbearia
      AND (
        EXISTS (
          SELECT 1 FROM public.unblocked_slots u
          WHERE u.barbershop_id = v_barbershop_id
            AND u.date = p_date
            AND u.staff_id IS NULL
            AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.blocked_slots b
            WHERE b.barbershop_id = v_barbershop_id
              AND b.staff_id IS NULL
              AND b.date = p_date
              AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
          )
          AND (
            EXISTS (
              SELECT 1 FROM public.staff_availability sa
              WHERE sa.barbershop_id = v_barbershop_id
                AND sa.staff_id = sp.id
                AND sa.day_of_week = v_day_of_week
            )
            OR NOT EXISTS (
              SELECT 1 FROM public.weekly_breaks wb
              WHERE wb.barbershop_id = v_barbershop_id
                AND wb.staff_id IS NULL
                AND wb.day_of_week = v_day_of_week
                AND (
                  v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
                    CASE 
                      WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                        THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                      WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                        THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                      ELSE interval '30 minutes'
                    END
                  ))
                  AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time))
                )
            )
          )
        )
      )
      -- Pausas e bloqueios individuais do candidato
      AND (
        EXISTS (
          SELECT 1 FROM public.unblocked_slots u
          WHERE u.barbershop_id = v_barbershop_id
            AND u.date = p_date
            AND u.staff_id = sp.id
            AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.weekly_breaks wb
            WHERE wb.barbershop_id = v_barbershop_id
              AND wb.staff_id = sp.id
              AND wb.day_of_week = v_day_of_week
              AND (
                v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
                  CASE 
                    WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time)
                      THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                    WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time)
                      THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                    ELSE interval '30 minutes'
                  END
                ))
                AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time))
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.blocked_slots b
            WHERE b.barbershop_id = v_barbershop_id
              AND b.staff_id = sp.id
              AND b.date = p_date
              AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
          )
        )
      )
      -- Sem agendamentos conflitantes no intervalo (timestamp arithmetic sem wrap-around)
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.barbershop_id = v_barbershop_id
          AND a.staff_id = sp.id
          AND a.date = p_date
          AND a.status NOT IN ('cancelled', 'no-show')
          AND (v_start_ts < (a.date + a.time + (coalesce(a.duration, 30) || ' minutes')::interval))
          AND (v_end_ts > (a.date + a.time))
      )
    ORDER BY sp.name ASC
    LIMIT 1;

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Nenhum profissional disponível neste horário.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 7. Upsert de cliente básico
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = v_barbershop_id AND phone = v_clean_phone;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      barbershop_id, user_id, name, phone, cut_count, total_visits, total_spent
    ) VALUES (
      v_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0, 0, 0
    )
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- 8. Inserir agendamento com status pending e is_exceptional false
  -- O trigger trg_validate_appointment_staff_eligibility adquire o lock transacional e revalida sobreposição
  INSERT INTO public.appointments (
    barbershop_id,
    user_id,
    staff_id,
    client_name,
    phone,
    service,
    price,
    duration,
    date,
    time,
    status,
    observation,
    is_exceptional
  ) VALUES (
    v_barbershop_id,
    v_owner_id,
    v_target_staff_id,
    v_clean_name,
    v_clean_phone,
    v_service_names,
    v_total_price,
    v_total_duration,
    p_date,
    p_time,
    'pending',
    v_clean_obs,
    false
  )
  RETURNING id INTO v_new_appointment_id;

  -- 9. Notificação do estabelecimento
  INSERT INTO public.notifications (
    barbershop_id,
    staff_id,
    user_id,
    type,
    title,
    body,
    data
  ) VALUES (
    v_barbershop_id,
    v_target_staff_id,
    v_owner_id,
    'new_appointment',
    'Novo agendamento público',
    v_clean_name || ' agendou ' || v_service_names || ' para ' || to_char(p_date, 'DD/MM/YYYY') || ' às ' || to_char(p_time, 'HH24:MI'),
    jsonb_build_object(
      'appointment_id', v_new_appointment_id,
      'client_name', v_clean_name,
      'client_phone', v_clean_phone,
      'date', p_date,
      'time', p_time,
      'staff_id', v_target_staff_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_new_appointment_id,
    'barbershop_id', v_barbershop_id,
    'staff_id', v_target_staff_id,
    'staff_name', v_staff_name,
    'client_name', v_clean_name,
    'service_name', v_service_names,
    'date', p_date,
    'time', p_time,
    'total_price', v_total_price,
    'total_duration', v_total_duration
  );
END;
$$;

-- Privilégio estrito: EXCLUSIVO service_role
REVOKE ALL ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 9. RPC: create_my_appointment (Exclusiva authenticated)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_my_appointment(
  p_barbershop_id uuid,
  p_client_name text,
  p_client_phone text,
  p_service_ids uuid[],
  p_date date,
  p_time time,
  p_observation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_staff_id uuid;
  v_owner_id uuid;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_slot_end_time time;
  v_customer_id uuid;
  v_new_apt record;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
  v_day_of_week int;
  v_staff_is_open boolean;
  v_staff_start time;
  v_staff_end time;
  v_sched_start time;
  v_sched_end time;
  v_sched_is_open boolean;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'barbershop_id é obrigatório.' USING ERRCODE = '22023';
  END IF;

  -- Resolver perfil de colaborador ativo do chamador
  SELECT sp.id, b.owner_id
  INTO v_staff_id, v_owner_id
  FROM public.barbershops b
  JOIN public.staff_profiles sp ON sp.barbershop_id = b.id
  WHERE b.id = p_barbershop_id
    AND sp.user_id = v_caller_uid
    AND sp.status = 'active';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Perfil de profissional ativo não encontrado para este usuário no estabelecimento.' USING ERRCODE = '42501';
  END IF;

  -- Conferir membership ativa
  IF NOT EXISTS (
    SELECT 1 FROM public.barbershop_members bm
    WHERE bm.barbershop_id = p_barbershop_id AND bm.user_id = v_caller_uid
  ) THEN
    RAISE EXCEPTION 'Vínculo de membro inativo para este estabelecimento.' USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 2 e 100 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 15 THEN
    RAISE EXCEPTION 'Telefone do cliente inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data do agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 THEN
    RAISE EXCEPTION 'Selecione ao menos um serviço.' USING ERRCODE = '22023';
  END IF;

  -- Validação estrita por serviço individual (impede durações nulas, zeradas ou negativas)
  IF EXISTS (
    SELECT 1 FROM public.services
    WHERE barbershop_id = p_barbershop_id
      AND id = ANY(p_service_ids)
      AND (duration IS NULL OR duration <= 0)
  ) THEN
    RAISE EXCEPTION 'Um ou mais serviços possuem duração inválida (deve ser estritamente positiva).' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = p_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 OR v_total_duration > 720 THEN
    RAISE EXCEPTION 'Duração total de serviços inválida (deve estar entre 1 e 720 minutos).' USING ERRCODE = '22023';
  END IF;

  IF (p_date + p_time + (v_total_duration || ' minutes')::interval) > (p_date + interval '1 day') THEN
    RAISE EXCEPTION 'Agendamento ultrapassa o encerramento do dia (meia-noite). Horário e duração inválidos.' USING ERRCODE = '22023';
  END IF;

  -- Upsert do cliente básico
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = p_barbershop_id AND phone = v_clean_phone;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (barbershop_id, user_id, name, phone, cut_count)
    VALUES (p_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0)
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- Inserir agendamento com is_exceptional = false
  -- O trigger trg_validate_appointment_staff_eligibility executa todas as validações unificadas
  -- (expediente, pausas, bloqueios, desbloqueios e advisory lock anti-sobreposição).
  INSERT INTO public.appointments (
    barbershop_id,
    user_id,
    staff_id,
    client_name,
    phone,
    service,
    price,
    duration,
    date,
    time,
    status,
    observation,
    is_exceptional
  ) VALUES (
    p_barbershop_id,
    v_caller_uid,
    v_staff_id,
    v_clean_name,
    v_clean_phone,
    v_service_names,
    v_total_price,
    v_total_duration,
    p_date,
    p_time,
    'pending',
    v_clean_obs,
    false
  )
  RETURNING * INTO v_new_apt;

  RETURN jsonb_build_object(
    'id', v_new_apt.id,
    'barbershop_id', v_new_apt.barbershop_id,
    'staff_id', v_new_apt.staff_id,
    'client_name', v_new_apt.client_name,
    'phone', v_new_apt.phone,
    'service', v_new_apt.service,
    'price', v_new_apt.price,
    'duration', v_new_apt.duration,
    'date', v_new_apt.date,
    'time', v_new_apt.time,
    'status', v_new_apt.status,
    'observation', v_new_apt.observation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. INICIALIZAÇÃO / BACKFILL DA GRADE GERAL DE FUNCIONAMENTO (weekly_schedule)
-- Garante que barbearias possuam os 7 dias na grade padrão
-- ------------------------------------------------------------------------------
INSERT INTO public.weekly_schedule (barbershop_id, day_of_week, start_time, end_time, is_open)
SELECT 
  b.id,
  d.day_of_week,
  '08:00:00'::time,
  '19:00:00'::time,
  CASE WHEN d.day_of_week = 0 THEN false ELSE true END
FROM public.barbershops b
CROSS JOIN (
  VALUES (0), (1), (2), (3), (4), (5), (6)
) AS d(day_of_week)
WHERE NOT EXISTS (
  SELECT 1 FROM public.weekly_schedule ws
  WHERE ws.barbershop_id = b.id AND ws.day_of_week = d.day_of_week
);

-- Adiciona a restrição UNIQUE de forma defensiva e segura caso não exista
DO $$
BEGIN
  -- 1. Deduplica linhas repetidas caso existam, preservando o menor ctid
  DELETE FROM public.weekly_schedule a
  USING public.weekly_schedule b
  WHERE a.ctid > b.ctid 
    AND a.barbershop_id = b.barbershop_id 
    AND a.day_of_week = b.day_of_week;

  -- 2. Adiciona a constraint de unicidade se ainda não existir
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid = 'public.weekly_schedule'::regclass 
      AND conname = 'uq_weekly_schedule_tenant_day'
  ) THEN
    BEGIN
      ALTER TABLE public.weekly_schedule 
      ADD CONSTRAINT uq_weekly_schedule_tenant_day UNIQUE (barbershop_id, day_of_week);
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

