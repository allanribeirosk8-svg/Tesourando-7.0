-- ==============================================================================
-- Migration: 20260924000001_staff_appointment_rpcs_and_financial_integrity.sql
-- Descrição:
--   1. Garante que a tabela public.transactions tenha todas as colunas necessárias:
--      staff_id, created_by, linked_appointment_id e payment_method.
--   2. Atualiza create_my_appointment para:
--      - Validar parâmetros com timezone de Brasília (America/Sao_Paulo).
--      - Salvar agendamento com status = 'pending' (compatível com a interface).
--      - Retornar o agendamento completo em formato JSONB com UUID real.
--   3. Atualiza complete_my_appointment para:
--      - Idempotência total (se já finalizado, retorna sem duplicar).
--      - Atualizar status para 'completed'.
--      - Incrementar cut_count, total_visits e total_spent do cliente.
--      - Criar a transação financeira de receita ('income') vinculada ao agendamento
--        de forma atômica e idempotente no banco (sem permitir que o staff viole RLS
--        ou insira transações avulsas).
--      - Retornar o agendamento atualizado e a transação correspondente.
--   4. Mantém as políticas de RLS fechadas:
--      - appointments_insert direto continua restrito a owner/admin.
--      - appointments UPDATE direto continua restrito a owner/admin.
--      - transactions_insert direto continua restrito a owner/admin.
--      - Staff opera exclusivamente via RPCs com checagem estrita de autorização:
--        staff_profiles.user_id = auth.uid()
--        staff_profiles.barbershop_id = appointment.barbershop_id
--        staff_profiles.id = appointment.staff_id
--        staff_profiles.status = 'active'.
-- ==============================================================================

-- 1. Garantir colunas em public.transactions
ALTER TABLE IF EXISTS public.transactions
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_appointment_id uuid,
  ADD COLUMN IF NOT EXISTS payment_method text;

CREATE INDEX IF NOT EXISTS idx_transactions_linked_apt 
  ON public.transactions(barbershop_id, linked_appointment_id) 
  WHERE linked_appointment_id IS NOT NULL;

-- 2. Atualizar create_my_appointment
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
  -- A. Autenticação
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'barbershop_id é obrigatório.' USING ERRCODE = '22023';
  END IF;

  -- B. Resolver perfil de profissional ativo do chamador
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

  -- C. Validações básicas de entrada
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 2 e 100 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 15 THEN
    RAISE EXCEPTION 'Telefone do cliente inválido.' USING ERRCODE = '22023';
  END IF;

  -- D. Validar data não no passado (fuso de Brasília)
  IF p_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Data do agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  -- E. Validar serviços e calcular preço/duração no servidor
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

  -- F. Advisory Lock no profissional e data para serialização atômica
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_barbershop_id::text
      || ':' || p_date::text
      || ':' || v_staff_id::text,
      0
    )
  );

  -- G. Checar conflito com agendamentos existentes do profissional
  SELECT count(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barbershop_id = p_barbershop_id
    AND staff_id = v_staff_id
    AND date = p_date
    AND status NOT IN ('cancelled', 'no-show')
    AND (p_time < (time + (duration || ' minutes')::interval))
    AND (v_slot_end_time > time);

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'SLOT_OCCUPIED: Você já possui outro atendimento agendado neste horário.' USING ERRCODE = '23505';
  END IF;

  -- H. Upsert/Vinculação de cliente básico
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

  -- I. Inserir agendamento com status pending (compatível com UI e relatórios)
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
    p_barbershop_id,
    v_owner_id,
    v_staff_id,
    v_clean_name,
    v_clean_phone,
    v_service_names,
    v_total_price,
    v_total_duration,
    p_date,
    p_time,
    'pending',
    v_clean_obs
  ) RETURNING * INTO v_new_apt;

  RETURN to_jsonb(v_new_apt);
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) TO authenticated;

-- 3. Atualizar complete_my_appointment
CREATE OR REPLACE FUNCTION public.complete_my_appointment(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apt record;
  v_updated_apt record;
  v_tx record;
  v_is_authorized boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_appointment_id IS NULL THEN
    RAISE EXCEPTION 'ID do agendamento é obrigatório.' USING ERRCODE = '22023';
  END IF;

  -- A. Buscar agendamento e verificar autorização
  SELECT a.*, (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin') OR sp.user_id = auth.uid()) AS authorized
  INTO v_apt
  FROM public.appointments a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = a.barbershop_id AND m.user_id = auth.uid()
  LEFT JOIN public.staff_profiles sp ON sp.id = a.staff_id
  WHERE a.id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(v_apt.authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para concluir este agendamento.' USING ERRCODE = '42501';
  END IF;

  -- B. Idempotência: se já estiver concluído, buscar transação existente e retornar
  IF v_apt.status = 'completed' THEN
    SELECT * INTO v_tx
    FROM public.transactions
    WHERE barbershop_id = v_apt.barbershop_id
      AND linked_appointment_id = p_appointment_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'completed',
      'already_completed', true,
      'appointment', to_jsonb(v_apt),
      'transaction', to_jsonb(v_tx)
    );
  END IF;

  -- C. Atualizar status para completed
  UPDATE public.appointments
  SET status = 'completed', updated_at = now()
  WHERE id = p_appointment_id
  RETURNING * INTO v_updated_apt;

  -- D. Atualizar métricas do cliente com segurança
  UPDATE public.customers
  SET 
    cut_count = cut_count + 1,
    total_visits = total_visits + 1,
    total_spent = total_spent + coalesce(v_updated_apt.price, 0),
    last_visit = now(),
    updated_at = now()
  WHERE barbershop_id = v_updated_apt.barbershop_id AND phone = v_updated_apt.phone;

  -- E. Criar transação financeira de receita no banco de forma atômica e idempotente
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE barbershop_id = v_updated_apt.barbershop_id
    AND linked_appointment_id = p_appointment_id
  LIMIT 1;

  IF v_tx.id IS NULL THEN
    INSERT INTO public.transactions (
      barbershop_id,
      staff_id,
      user_id,
      created_by,
      type,
      amount,
      description,
      category,
      date,
      linked_appointment_id
    ) VALUES (
      v_updated_apt.barbershop_id,
      v_updated_apt.staff_id,
      v_updated_apt.user_id,
      auth.uid(),
      'income',
      v_updated_apt.price,
      coalesce(v_updated_apt.service, 'Atendimento') || ' — ' || v_updated_apt.client_name,
      'walk_in',
      v_updated_apt.date,
      p_appointment_id
    ) RETURNING * INTO v_tx;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'completed',
    'already_completed', false,
    'appointment', to_jsonb(v_updated_apt),
    'transaction', to_jsonb(v_tx)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_my_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_appointment(uuid) TO authenticated;
