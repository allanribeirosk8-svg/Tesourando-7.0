-- ==============================================================================
-- PATCH CORRETIVO DE INTEGRIDADE: HORÁRIOS, PAUSAS, TRIGGER E LOOKUP DE CLIENTE
-- Arquivo: 20261023000001_fix_breaks_cast_customer_phone_and_schedule.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. GARANTIA ESTRUTURAL DE COLUNAS (weekly_breaks, unblocked_slots, blocked_slots)
-- Garante a existência de start_time e end_time para evitar erro 42703
-- ------------------------------------------------------------------------------
ALTER TABLE public.weekly_breaks 
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS time time,
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'weekly_breaks' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.weekly_breaks ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'weekly_schedule' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.weekly_schedule ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'blocked_slots' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.blocked_slots ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'unblocked_slots' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.unblocked_slots ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  -- Remove a FK legada weekly_breaks_day_of_week_fkey que exigia correspondência de (user_id, day_of_week) em weekly_schedule
  ALTER TABLE public.weekly_breaks DROP CONSTRAINT IF EXISTS weekly_breaks_day_of_week_fkey;
END $$;

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
-- 1. CORREÇÃO NA RPC: save_staff_schedule_atomic
-- Correção do erro de cast `::interval` em tipo `time` e ordenação das pausas
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

    -- Canonização estrita de meia-noite pelo valor temporal convertido
    IF v_end = '00:00:00'::time THEN
      RAISE EXCEPTION 'Horário de término à meia-noite convertido para % deve ser representado canonicamente como "24:00:00" (encerramento do dia), e não "00:00:00" (início do dia) no dia %.'
        , v_end, v_day USING ERRCODE = '22023';
    END IF;

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

      FOR v_break_item IN 
        SELECT elem FROM jsonb_array_elements_text(v_item->'breaks') elem 
        WHERE trim(elem) <> '' 
        ORDER BY elem::time ASC
      LOOP
        BEGIN
          v_break_time := v_break_item::time;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'Formato de horário de pausa inválido: "%" no dia %.', v_break_item, v_day USING ERRCODE = '22023';
        END;

        -- Validação temporal sem casts inválidos de time para interval
        IF v_break_time > '23:30:00'::time THEN
          RAISE EXCEPTION 'Intervalo de pausa às % ultrapassa o término do dia (meia-noite) no dia %.', v_break_item, v_day USING ERRCODE = '22023';
        END IF;

        IF v_break_time < v_start THEN
          RAISE EXCEPTION 'Intervalo de pausa às % inicia antes do expediente (% às %) no dia %.', v_break_time, v_start, v_end, v_day USING ERRCODE = '22023';
        END IF;

        -- Bloco canônico de 30 minutos por intervalo
        IF v_break_time = '23:30:00'::time THEN
          v_break_end := '24:00:00'::time;
        ELSE
          v_break_end := (v_break_time + interval '30 minutes')::time;
        END IF;

        IF v_end <> '24:00:00'::time AND v_end <> '00:00:00'::time AND v_break_end > v_end THEN
          RAISE EXCEPTION 'Intervalo de pausa (% até %) excede o término do expediente (% às %) no dia %.', v_break_time, v_break_end, v_start, v_end, v_day USING ERRCODE = '22023';
        END IF;

        -- Validação contra duplicação de slots
        FOREACH v_existing_b IN ARRAY v_day_breaks
        LOOP
          IF v_break_time = v_existing_b THEN
            RAISE EXCEPTION 'Pausa duplicada às % no dia %.', v_break_time, v_day USING ERRCODE = '22023';
          END IF;
        END LOOP;

        v_day_breaks := array_append(v_day_breaks, v_break_time);
        v_breaks := array_append(v_breaks, to_char(v_break_time, 'HH24:MI'));

        -- Espelho isolado em weekly_breaks para consultas de conflito (preenchendo user_id compatível com weekly_schedule)
        INSERT INTO public.weekly_breaks (
          user_id, barbershop_id, staff_id, day_of_week, time, start_time, end_time
        ) VALUES (
          coalesce(
            (SELECT ws.user_id FROM public.weekly_schedule ws WHERE ws.barbershop_id = p_barbershop_id AND ws.day_of_week = v_day LIMIT 1),
            v_owner_id,
            v_staff_user_id,
            v_caller_uid
          ),
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
-- 2. CORREÇÃO NO TRIGGER: trg_validate_appointment_staff_eligibility
-- Correção de erro 42883 (substring em time without time zone) para to_char(u.time::time, 'HH24:MI')
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

  -- 2. Duração e Passagem de Meia-Noite com Aritmética de Timestamp
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

  -- 4. Validação relacional e de status com lock FOR SHARE
  SELECT status, barbershop_id INTO v_staff_status, v_staff_barbershop_id
  FROM public.staff_profiles
  WHERE id = NEW.staff_id
  FOR SHARE;

  IF v_staff_barbershop_id IS NULL OR v_staff_barbershop_id <> NEW.barbershop_id THEN
    RAISE EXCEPTION 'O profissional selecionado não pertence a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF (TG_OP = 'INSERT' OR v_schedule_changed = true) THEN
    IF v_staff_status <> 'active' THEN
      RAISE EXCEPTION 'Não é permitido criar, reatribuir, reagendar ou reocupar horário para um profissional inativo ou suspenso.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 5. Auditoria e Proteção de Exceções (is_exceptional)
  IF NEW.is_exceptional IS TRUE THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (OLD.is_exceptional IS NOT TRUE OR v_schedule_changed = true)) THEN
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

      NEW.exceptional_by := v_caller_uid;
      NEW.exceptional_at := now();
    ELSE
      NEW.exceptional_by := OLD.exceptional_by;
      NEW.exceptional_at := OLD.exceptional_at;
    END IF;
  ELSE
    NEW.exceptional_by := NULL;
    NEW.exceptional_at := NULL;
  END IF;

  -- 6. Cancelamento / no-show desocupa horário
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

    -- 7.2 Distinção Estrita de Desbloqueios: Geral vs Individual (comparação tipada com to_char)
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

    -- Pausas e Bloqueios Gerais da Barbearia
    IF coalesce(v_is_general_unblocked, false) = false THEN
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

    -- Pausas e Bloqueios Individuais deste profissional
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
-- 3. CORREÇÃO NA RPC: create_my_appointment
-- Lookup de cliente por telefone normalizado e resiliência contra violação de chave única
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
  v_customer_id uuid;
  v_new_apt record;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
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

  -- Upsert do cliente por telefone normalizado com tolerância a corridas de concorrência
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = p_barbershop_id 
    AND regexp_replace(phone, '\D', '', 'g') = v_clean_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    BEGIN
      INSERT INTO public.customers (barbershop_id, user_id, name, phone, cut_count)
      VALUES (p_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0)
      RETURNING id INTO v_customer_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_customer_id
      FROM public.customers
      WHERE barbershop_id = p_barbershop_id 
        AND regexp_replace(phone, '\D', '', 'g') = v_clean_phone
      LIMIT 1;

      UPDATE public.customers
      SET name = v_clean_name, phone = v_clean_phone, updated_at = now()
      WHERE id = v_customer_id;
    END;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, phone = v_clean_phone, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- Inserir agendamento com is_exceptional = false
  -- O trigger trg_validate_appointment_staff_eligibility executa todas as validações unificadas
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
    'time', to_char(v_new_apt.time, 'HH24:MI'),
    'status', v_new_apt.status,
    'observation', v_new_apt.observation,
    'is_exceptional', v_new_apt.is_exceptional,
    'created_at', v_new_apt.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. CORREÇÃO NA RPC: process_public_booking_atomic
-- Lookup de cliente por telefone normalizado e resiliência contra violação de chave única
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_public_booking_atomic(
  p_slug text,
  p_client_name text,
  p_client_phone text,
  p_service_ids uuid[],
  p_staff_id uuid,
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
  v_barbershop_id uuid;
  v_owner_id uuid;
  v_clean_name text := trim(p_client_name);
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_obs text := trim(p_observation);
  v_target_staff_id uuid;
  v_staff_name text;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_day_of_week int;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_slot_end_time time;
  v_staff_is_open boolean;
  v_staff_start time;
  v_staff_end time;
  v_sched_is_open boolean;
  v_sched_start time;
  v_sched_end time;
  v_schedule_exists boolean := false;
  v_has_individual_schedule boolean := false;
  v_is_general_unblocked boolean := false;
  v_is_staff_unblocked boolean := false;
  v_customer_id uuid;
  v_new_apt_id uuid;
BEGIN
  -- 1. Resolução estrita do tenant por slug
  SELECT id, owner_id INTO v_barbershop_id, v_owner_id
  FROM public.barbershops
  WHERE slug = lower(trim(p_slug));

  IF v_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'Barbearia não encontrada para o link informado.' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Validações básicas de payload
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Nome deve conter entre 2 e 100 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 15 THEN
    RAISE EXCEPTION 'Telefone inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data de agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 THEN
    RAISE EXCEPTION 'Selecione ao menos um serviço.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.services
    WHERE barbershop_id = v_barbershop_id
      AND id = ANY(p_service_ids)
      AND (duration IS NULL OR duration <= 0)
  ) THEN
    RAISE EXCEPTION 'Um ou mais serviços possuem duração inválida (deve ser estritamente positiva).' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = v_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços selecionados não pertencem a este estabelecimento.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 OR v_total_duration > 720 THEN
    RAISE EXCEPTION 'Duração total de serviços inválida (deve estar entre 1 e 720 minutos).' USING ERRCODE = '22023';
  END IF;

  v_start_ts := p_date + p_time;
  v_end_ts := v_start_ts + (v_total_duration || ' minutes')::interval;

  IF v_end_ts > (p_date + interval '1 day') THEN
    RAISE EXCEPTION 'Agendamento ultrapassa o encerramento do dia (meia-noite). Horário e duração inválidos.' USING ERRCODE = '22023';
  END IF;

  v_day_of_week := extract(dow FROM p_date);

  -- 3. Resolução e validação do profissional
  IF p_staff_id IS NOT NULL THEN
    SELECT id, name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles
    WHERE id = p_staff_id
      AND barbershop_id = v_barbershop_id
      AND status = 'active'
    FOR SHARE;

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'Profissional selecionado não está ativo ou não pertence a esta barbearia.' USING ERRCODE = '22023';
    END IF;

    -- Verificar expediente
    SELECT is_open, start_time, end_time INTO v_staff_is_open, v_staff_start, v_staff_end
    FROM public.staff_availability
    WHERE barbershop_id = v_barbershop_id AND staff_id = v_target_staff_id AND day_of_week = v_day_of_week;

    IF FOUND THEN
      v_schedule_exists := true;
      v_has_individual_schedule := true;
      IF coalesce(v_staff_is_open, false) = false THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Profissional não atende neste dia.' USING ERRCODE = '23505';
      END IF;

      IF v_start_ts < (p_date + v_staff_start) OR v_end_ts > (
        CASE 
          WHEN v_staff_end = '24:00:00'::time OR (v_staff_end = '00:00:00'::time AND v_staff_start > '00:00:00'::time)
            THEN p_date + interval '1 day'
          ELSE p_date + v_staff_end
        END
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário fora do expediente do profissional.' USING ERRCODE = '23505';
      END IF;
    ELSE
      SELECT is_open, start_time, end_time INTO v_sched_is_open, v_sched_start, v_sched_end
      FROM public.weekly_schedule
      WHERE barbershop_id = v_barbershop_id AND day_of_week = v_day_of_week;

      IF FOUND THEN
        v_schedule_exists := true;
        IF coalesce(v_sched_is_open, false) = false THEN
          RAISE EXCEPTION 'SLOT_OCCUPIED: Estabelecimento fechado neste dia.' USING ERRCODE = '23505';
        END IF;

        IF v_start_ts < (p_date + v_sched_start) OR v_end_ts > (
          CASE 
            WHEN v_sched_end = '24:00:00'::time OR (v_sched_end = '00:00:00'::time AND v_sched_start > '00:00:00'::time)
              THEN p_date + interval '1 day'
            ELSE p_date + v_sched_end
          END
        ) THEN
          RAISE EXCEPTION 'SLOT_OCCUPIED: Horário fora do expediente do estabelecimento.' USING ERRCODE = '23505';
        END IF;
      END IF;
    END IF;

    IF v_schedule_exists = false THEN
      RAISE EXCEPTION 'Nenhum horário de funcionamento configurado para este dia da semana. Não é permitido agendar sem grade definida.' USING ERRCODE = '22023';
    END IF;

    -- Ancoragem de slots de atendimento (passos de 15 minutos)
    IF (EXTRACT(EPOCH FROM (p_time - coalesce(v_staff_start, v_sched_start)))::int % 900) <> 0 THEN
      RAISE EXCEPTION 'Horário não alinhado aos intervalos de atendimento.' USING ERRCODE = '22023';
    END IF;

    -- Desbloqueios pontuais
    SELECT true INTO v_is_general_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = v_barbershop_id AND u.date = p_date AND u.staff_id IS NULL AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
    LIMIT 1;

    SELECT true INTO v_is_staff_unblocked
    FROM public.unblocked_slots u
    WHERE u.barbershop_id = v_barbershop_id AND u.date = p_date AND u.staff_id = v_target_staff_id AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
    LIMIT 1;

    IF coalesce(v_is_general_unblocked, false) = false THEN
      IF v_has_individual_schedule = false THEN
        IF EXISTS (
          SELECT 1 FROM public.weekly_breaks wb
          WHERE wb.barbershop_id = v_barbershop_id AND wb.staff_id IS NULL AND wb.day_of_week = v_day_of_week
            AND (v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
              CASE 
                WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time) THEN (wb.end_time - coalesce(wb.start_time, wb.time))
                WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time) THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
                ELSE interval '30 minutes'
              END
            )) AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time)))
        ) THEN
          RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo do estabelecimento.' USING ERRCODE = '23505';
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id AND b.staff_id IS NULL AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado no estabelecimento.' USING ERRCODE = '23505';
      END IF;
    END IF;

    IF coalesce(v_is_staff_unblocked, false) = false THEN
      IF EXISTS (
        SELECT 1 FROM public.weekly_breaks wb
        WHERE wb.barbershop_id = v_barbershop_id AND wb.staff_id = v_target_staff_id AND wb.day_of_week = v_day_of_week
          AND (v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + (
            CASE 
              WHEN wb.end_time IS NOT NULL AND wb.end_time > coalesce(wb.start_time, wb.time) THEN (wb.end_time - coalesce(wb.start_time, wb.time))
              WHEN wb.end_time = '24:00:00'::time OR (wb.end_time = '00:00:00'::time AND coalesce(wb.start_time, wb.time) > '00:00:00'::time) THEN (interval '24 hours' - coalesce(wb.start_time, wb.time)::interval)
              ELSE interval '30 minutes'
            END
          )) AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time)))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com intervalo do profissional.' USING ERRCODE = '23505';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id AND b.staff_id = v_target_staff_id AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado para este profissional.' USING ERRCODE = '23505';
      END IF;
    END IF;

  ELSE
    -- Alocação automática: selecionar primeiro profissional elegível e livre
    SELECT sp.id, sp.name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles sp
    WHERE sp.barbershop_id = v_barbershop_id
      AND sp.status = 'active'
      AND (
        (
          EXISTS (
            SELECT 1 FROM public.staff_availability sa
            WHERE sa.barbershop_id = v_barbershop_id AND sa.staff_id = sp.id AND sa.day_of_week = v_day_of_week
              AND sa.is_open = true
              AND v_start_ts >= (p_date + sa.start_time)
              AND v_end_ts <= (
                CASE 
                  WHEN sa.end_time = '24:00:00'::time OR (sa.end_time = '00:00:00'::time AND sa.start_time > '00:00:00'::time)
                    THEN p_date + interval '1 day'
                  ELSE p_date + sa.end_time
                END
              )
              AND (EXTRACT(EPOCH FROM (p_time - sa.start_time))::int % 900) = 0
          )
        )
        OR
        (
          NOT EXISTS (
            SELECT 1 FROM public.staff_availability sa
            WHERE sa.barbershop_id = v_barbershop_id AND sa.staff_id = sp.id AND sa.day_of_week = v_day_of_week
          )
          AND EXISTS (
            SELECT 1 FROM public.weekly_schedule ws
            WHERE ws.barbershop_id = v_barbershop_id AND ws.day_of_week = v_day_of_week
              AND ws.is_open = true
              AND v_start_ts >= (p_date + ws.start_time)
              AND v_end_ts <= (
                CASE 
                  WHEN ws.end_time = '24:00:00'::time OR (ws.end_time = '00:00:00'::time AND ws.start_time > '00:00:00'::time)
                    THEN p_date + interval '1 day'
                  ELSE p_date + ws.end_time
                END
              )
              AND (EXTRACT(EPOCH FROM (p_time - ws.start_time))::int % 900) = 0
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id AND b.staff_id IS NULL AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocked_slots b
        WHERE b.barbershop_id = v_barbershop_id AND b.staff_id = sp.id AND b.date = p_date
          AND (v_start_ts < (b.date + b.time::time + interval '30 minutes') AND v_end_ts > (b.date + b.time::time))
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.unblocked_slots u
          WHERE u.barbershop_id = v_barbershop_id AND u.date = p_date AND u.staff_id = sp.id AND to_char(u.time::time, 'HH24:MI') = to_char(p_time, 'HH24:MI')
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.weekly_breaks wb
            WHERE wb.barbershop_id = v_barbershop_id AND wb.staff_id = sp.id AND wb.day_of_week = v_day_of_week
              AND (v_start_ts < (p_date + coalesce(wb.start_time, wb.time) + interval '30 minutes') AND v_end_ts > (p_date + coalesce(wb.start_time, wb.time)))
          )
        )
      )
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

  -- 4. Upsert de cliente por telefone normalizado com tolerância a concorrência
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = v_barbershop_id 
    AND regexp_replace(phone, '\D', '', 'g') = v_clean_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    BEGIN
      INSERT INTO public.customers (
        barbershop_id, user_id, name, phone, cut_count, total_visits, total_spent
      ) VALUES (
        v_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0, 0, 0
      )
      RETURNING id INTO v_customer_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_customer_id
      FROM public.customers
      WHERE barbershop_id = v_barbershop_id 
        AND regexp_replace(phone, '\D', '', 'g') = v_clean_phone
      LIMIT 1;

      UPDATE public.customers
      SET name = v_clean_name, phone = v_clean_phone, updated_at = now()
      WHERE id = v_customer_id;
    END;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, phone = v_clean_phone, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- 5. Inserir agendamento
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
  RETURNING id INTO v_new_apt_id;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_new_apt_id,
    'barbershop_id', v_barbershop_id,
    'staff_id', v_target_staff_id,
    'staff_name', v_staff_name,
    'client_name', v_clean_name,
    'service_name', v_service_names,
    'date', p_date,
    'time', to_char(p_time, 'HH24:MI'),
    'total_price', v_total_price,
    'total_duration', v_total_duration
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 5. INICIALIZAÇÃO / BACKFILL DA GRADE GERAL DE FUNCIONAMENTO (weekly_schedule)
-- Garante que qualquer barbearia existente possua os 7 dias na grade padrão
-- para que profissionais recém-criados herdem o horário geral sem bloquear agendamentos.
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

