-- ==============================================================================
-- ROTEIRO DE REVERSÃO CORRIGIDO E DEFINITIVO (ROLLBACK) DA MIGRATION:
-- 20261019000001_staff_availability_and_booking_integrity.sql
-- Status: NÃO EXECUTADO (Roteiro de salvaguarda para reversão caso necessário)
-- Diretrizes:
--   1. Preserva a tabela staff_availability e seus dados (NÃO usa DROP TABLE CASCADE).
--   2. Restaura integralmente as versões anteriores das RPCs pré-existentes
--      (remove_staff_from_barbershop, reactivate_staff, process_public_booking_atomic,
--       create_my_appointment).
--   3. Remove triggers novos e restaura estado sem duplicidades.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REVERTER TRIGGERS E FUNÇÕES DE TRIGGER NOVOS
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_validate_appointment_staff_eligibility ON public.appointments;
DROP TRIGGER IF EXISTS trg_validate_appointment_integrity ON public.appointments;
DROP FUNCTION IF EXISTS public.trg_validate_appointment_staff_eligibility();

DROP TRIGGER IF EXISTS trg_validate_staff_availability_tenant ON public.staff_availability;
DROP FUNCTION IF EXISTS public.trg_validate_staff_availability_tenant();

-- ------------------------------------------------------------------------------
-- 2. REVERTER POLICIES, ÍNDICES E CONSTRAINTS ADICIONADOS EM staff_availability
--    (SEM DROP TABLE: DADOS E TABELA SÃO PRESERVADOS)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_availability_select_auth" ON public.staff_availability;
DROP INDEX IF EXISTS public.idx_staff_availability_shop_staff_day;
ALTER TABLE IF EXISTS public.staff_availability DROP CONSTRAINT IF EXISTS chk_staff_availability_time_valid;

-- ------------------------------------------------------------------------------
-- 3. REMOVER EXCLUSIVAMENTE RPCS INÉDITAS DESTA MIGRATION
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.save_staff_schedule_atomic(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.reset_staff_schedule_to_default(uuid, uuid);

-- ------------------------------------------------------------------------------
-- 4. RESTAURAR A VERSÃO ANTERIOR DE remove_staff_from_barbershop (Migration 20260918000002)
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
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_owner_id uuid;
  v_actual_user_id uuid;
  v_resolved_user_id uuid;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid()), (m.role = 'admin'), b.owner_id
  INTO v_is_owner, v_is_admin, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem remover membros.' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_actual_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  IF p_staff_user_id IS NOT NULL AND v_actual_user_id IS NOT NULL AND p_staff_user_id <> v_actual_user_id THEN
    RAISE EXCEPTION 'Validação de integridade: Profile ID e User ID informados não pertencem à mesma pessoa.' USING ERRCODE = '22023';
  END IF;

  v_resolved_user_id := coalesce(v_actual_user_id, p_staff_user_id);

  IF v_resolved_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Não é permitido remover o proprietário da barbearia.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_owner, false) = false THEN
    IF v_resolved_user_id = auth.uid() THEN
      RAISE EXCEPTION 'Acesso negado: administradores não podem remover a si mesmos da barbearia.' USING ERRCODE = '42501';
    END IF;

    IF v_resolved_user_id IS NOT NULL THEN
      SELECT role INTO v_target_role
      FROM public.barbershop_members
      WHERE barbershop_id = p_barbershop_id AND user_id = v_resolved_user_id;

      IF v_target_role IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: administradores não podem remover outros administradores ou o proprietário.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  UPDATE public.staff_profiles
  SET status = 'inactive', updated_at = now()
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF v_resolved_user_id IS NOT NULL THEN
    DELETE FROM public.barbershop_members
    WHERE barbershop_id = p_barbershop_id AND user_id = v_resolved_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. RESTAURAR A VERSÃO ANTERIOR DE reactivate_staff (Migration 20260918000002)
-- ------------------------------------------------------------------------------
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
  v_is_owner boolean := false;
  v_is_admin boolean := false;
  v_target_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid()), (m.role = 'admin')
  INTO v_is_owner, v_is_admin
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem reativar profissionais.' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.staff_profiles
  SET status = 'active', updated_at = now()
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF v_target_user_id IS NOT NULL THEN
    INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
    VALUES (p_barbershop_id, v_target_user_id, 'staff')
    ON CONFLICT (barbershop_id, user_id) DO UPDATE SET role = 'staff';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_staff(uuid, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. RESTAURAR A VERSÃO ANTERIOR DE process_public_booking_atomic (Migration 20260918000002)
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
  v_slot_end_time time;
  v_conflict_count int;
  v_day_of_week int;
  v_sched_start time;
  v_sched_end time;
  v_is_open boolean;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
  v_is_unblocked boolean := false;
  v_has_break_conflict boolean := false;
  v_has_general_block boolean := false;
BEGIN
  IF length(v_clean_name) < 3 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 3 e 80 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone do cliente deve conter 10 ou 11 dígitos com DDD.' USING ERRCODE = '22023';
  END IF;

  IF v_clean_obs IS NOT NULL AND length(v_clean_obs) > 500 THEN
    RAISE EXCEPTION 'Observação excede o limite máximo de 500 caracteres.' USING ERRCODE = '22023';
  END IF;

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

  SELECT id, owner_id INTO v_barbershop_id, v_owner_id
  FROM public.barbershops
  WHERE slug = lower(trim(p_slug));

  IF v_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'Barbearia não encontrada para o link informado.' USING ERRCODE = 'P0002';
  END IF;

  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 10 serviços válidos.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = v_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços selecionados não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 THEN
    v_total_duration := 30;
  END IF;

  v_slot_end_time := p_time + (v_total_duration || ' minutes')::interval;
  v_day_of_week := extract(dow FROM p_date);

  SELECT is_open, start_time, end_time INTO v_is_open, v_sched_start, v_sched_end
  FROM public.weekly_schedule
  WHERE barbershop_id = v_barbershop_id AND day_of_week = v_day_of_week;

  IF coalesce(v_is_open, false) = false THEN
    RAISE EXCEPTION 'A barbearia não está aberta para atendimento neste dia da semana.' USING ERRCODE = '22023';
  END IF;

  IF p_time < v_sched_start OR v_slot_end_time > v_sched_end THEN
    RAISE EXCEPTION 'Horário solicitado está fora do expediente de funcionamento da barbearia.' USING ERRCODE = '22023';
  END IF;

  SELECT true INTO v_is_unblocked
  FROM public.unblocked_slots
  WHERE barbershop_id = v_barbershop_id
    AND date = p_date
    AND (staff_id IS NULL OR (p_staff_id IS NOT NULL AND staff_id = p_staff_id))
    AND substring(time from 1 for 5) = to_char(p_time, 'HH24:MI')
  LIMIT 1;

  IF coalesce(v_is_unblocked, false) = false THEN
    SELECT true INTO v_has_break_conflict
    FROM public.weekly_breaks
    WHERE barbershop_id = v_barbershop_id
      AND day_of_week = v_day_of_week
      AND (
        p_time < coalesce(end_time, (coalesce(start_time, time) + interval '30 minutes')::time)
        AND v_slot_end_time > coalesce(start_time, time)
      )
    LIMIT 1;

    IF coalesce(v_has_break_conflict, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo da barbearia.' USING ERRCODE = '23505';
    END IF;

    SELECT true INTO v_has_general_block
    FROM public.blocked_slots
    WHERE barbershop_id = v_barbershop_id
      AND date = p_date
      AND staff_id IS NULL
      AND (p_time < (time::time + interval '30 minutes') AND v_slot_end_time > time::time)
    LIMIT 1;

    IF coalesce(v_has_general_block, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado na agenda do estabelecimento.' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_staff_id IS NOT NULL THEN
    SELECT id, name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles
    WHERE id = p_staff_id
      AND barbershop_id = v_barbershop_id
      AND status = 'active';

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'O profissional selecionado não está ativo ou não pertence a esta barbearia.' USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_is_unblocked, false) = false THEN
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots
        WHERE barbershop_id = v_barbershop_id
          AND date = p_date
          AND staff_id = v_target_staff_id
          AND (p_time < (time::time + interval '30 minutes') AND v_slot_end_time > time::time)
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Profissional indisponível neste horário.' USING ERRCODE = '23505';
      END IF;
    END IF;
  ELSE
    SELECT sp.id, sp.name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles sp
    WHERE sp.barbershop_id = v_barbershop_id
      AND sp.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.barbershop_id = v_barbershop_id
          AND a.staff_id = sp.id
          AND a.date = p_date
          AND a.status NOT IN ('cancelled', 'no-show')
          AND (p_time < (a.time + (a.duration || ' minutes')::interval))
          AND (v_slot_end_time > a.time)
      )
      AND (
        EXISTS (
          SELECT 1 FROM public.unblocked_slots u
          WHERE u.barbershop_id = v_barbershop_id
            AND u.date = p_date
            AND (u.staff_id = sp.id OR u.staff_id IS NULL)
            AND substring(u.time from 1 for 5) = to_char(p_time, 'HH24:MI')
        )
        OR NOT EXISTS (
          SELECT 1 FROM public.blocked_slots b
          WHERE b.barbershop_id = v_barbershop_id
            AND b.staff_id = sp.id
            AND b.date = p_date
            AND (p_time < (b.time::time + interval '30 minutes') AND v_slot_end_time > b.time::time)
        )
      )
    ORDER BY sp.name ASC
    LIMIT 1;

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Nenhum profissional disponível neste horário.' USING ERRCODE = '23505';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_barbershop_id::text
      || ':' || p_date::text
      || ':' || v_target_staff_id::text,
      0
    )
  );

  SELECT count(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barbershop_id = v_barbershop_id
    AND staff_id = v_target_staff_id
    AND date = p_date
    AND status NOT IN ('cancelled', 'no-show')
    AND (p_time < (time + (duration || ' minutes')::interval))
    AND (v_slot_end_time > time);

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'SLOT_OCCUPIED: Este horário acabou de ser reservado por outro cliente.' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = v_barbershop_id AND phone = v_clean_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      barbershop_id,
      user_id,
      name,
      phone,
      cut_count,
      no_show_count,
      total_visits,
      total_spent
    ) VALUES (
      v_barbershop_id,
      v_owner_id,
      v_clean_name,
      v_clean_phone,
      0,
      0,
      0,
      0
    ) RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

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
    observation
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
    v_clean_obs
  ) RETURNING id INTO v_new_appointment_id;

  BEGIN
    INSERT INTO public.notifications (
      barbershop_id,
      user_id,
      type,
      title,
      body,
      data,
      read
    ) VALUES (
      v_barbershop_id,
      v_owner_id,
      'new_appointment',
      '📅 Novo agendamento online!',
      v_clean_name || ' agendou ' || v_service_names || ' às ' || to_char(p_time, 'HH24:MI'),
      jsonb_build_object('appointment_id', v_new_appointment_id, 'date', p_date, 'time', to_char(p_time, 'HH24:MI'), 'client_name', v_clean_name),
      false
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar notificação para appointment % (Barbershop: %): %', v_new_appointment_id, v_barbershop_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'appointment_id', v_new_appointment_id,
    'barbershop_id', v_barbershop_id,
    'date', p_date,
    'time', to_char(p_time, 'HH24:MI'),
    'service_name', v_service_names,
    'client_name', v_clean_name,
    'staff_name', v_staff_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 7. RESTAURAR A VERSÃO ANTERIOR DE create_my_appointment (Migration 20260924000001)
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
  v_staff_id uuid;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_slot_end_time time;
  v_conflict_count int;
  v_customer_id uuid;
  v_new_apt record;
  v_owner_id uuid;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'barbershop_id é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT sp.id, b.owner_id
  INTO v_staff_id, v_owner_id
  FROM public.barbershops b
  JOIN public.staff_profiles sp ON sp.barbershop_id = b.id
  WHERE b.id = p_barbershop_id
    AND sp.user_id = auth.uid()
    AND sp.status = 'active';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Perfil de profissional ativo não encontrado para este usuário no estabelecimento.' USING ERRCODE = '42501';
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

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = p_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 THEN
    v_total_duration := 30;
  END IF;

  v_slot_end_time := p_time + (v_total_duration || ' minutes')::interval;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_barbershop_id::text
      || ':' || p_date::text
      || ':' || v_staff_id::text,
      0
    )
  );

  SELECT count(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barbershop_id = p_barbershop_id
    AND staff_id = v_staff_id
    AND date = p_date
    AND status NOT IN ('cancelled', 'no_show')
    AND (
      (time < v_slot_end_time AND (time + (coalesce(duration, 30) || ' minutes')::interval) > p_time)
    );

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Horário indisponível para este profissional.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.customers (barbershop_id, name, phone, cut_count, total_visits, total_spent)
  VALUES (p_barbershop_id, v_clean_name, v_clean_phone, 0, 0, 0)
  ON CONFLICT (barbershop_id, phone)
  DO UPDATE SET
    name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE customers.name END,
    updated_at = now()
  RETURNING id INTO v_customer_id;

  INSERT INTO public.appointments (
    barbershop_id,
    customer_id,
    staff_id,
    date,
    time,
    duration,
    service,
    price,
    notes,
    status
  )
  VALUES (
    p_barbershop_id,
    v_customer_id,
    v_staff_id,
    p_date,
    p_time,
    v_total_duration,
    coalesce(v_service_names, 'Serviço'),
    v_total_price,
    v_clean_obs,
    'pending'
  )
  RETURNING * INTO v_new_apt;

  RETURN jsonb_build_object(
    'id', v_new_apt.id,
    'barbershop_id', v_new_apt.barbershop_id,
    'customer_id', v_new_apt.customer_id,
    'staff_id', v_new_apt.staff_id,
    'date', v_new_apt.date,
    'time', v_new_apt.time,
    'duration', v_new_apt.duration,
    'service', v_new_apt.service,
    'price', v_new_apt.price,
    'notes', v_new_apt.notes,
    'status', v_new_apt.status,
    'created_at', v_new_apt.created_at,
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', v_clean_name,
      'phone', v_clean_phone
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. GARANTIR QUE O TRIGGER PREEXISTENTE (trg_appointments_updated_at) ESTÁ ATIVO
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'appointments' AND t.tgname = 'trg_appointments_updated_at'
  ) THEN
    CREATE TRIGGER trg_appointments_updated_at
      BEFORE UPDATE ON public.appointments
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

COMMIT;
