-- scripts/02_http_snapshot_setup.sql
-- Invocado com: psql -v ON_ERROR_STOP=1 -v owner_uid=UUID -v staff_a_uid=UUID -v staff_b_uid=UUID -d "$STAGING_DB_URL" -f scripts/02_http_snapshot_setup.sql
BEGIN;

-- 1. Passar variáveis do psql para a sessão da transação via set_config
SELECT set_config('app.test_owner_uid', :'owner_uid', true);
SELECT set_config('app.test_staff_a_uid', :'staff_a_uid', true);
SELECT set_config('app.test_staff_b_uid', :'staff_b_uid', true);

DO $$
DECLARE
  v_owner_uid uuid := current_setting('app.test_owner_uid')::uuid;
  v_staff_a_uid uuid := current_setting('app.test_staff_a_uid')::uuid;
  v_staff_b_uid uuid := current_setting('app.test_staff_b_uid')::uuid;
  v_shop_id uuid := 'b1111111-1111-1111-1111-111111111111';
  v_staff_a_id uuid := 'c1111111-1111-1111-1111-111111111111';
  v_staff_b_id uuid := 'c2222222-2222-2222-2222-222222222222';
  v_serv_30 uuid := 'd1111111-1111-1111-1111-111111111111';
  v_serv_15 uuid := 'd2222222-2222-2222-2222-222222222222';
  v_monday date;
  v_existing_slug text;
  v_res jsonb;
BEGIN
  -- 2. Validar que as FKs reais existem em auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner_uid) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_staff_a_uid) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_staff_b_uid) THEN
    RAISE EXCEPTION 'FALHA DE INTEGRIDADE: IDs de auth.users fornecidos não existem no banco.';
  END IF;

  -- 3. Proteção e Idempotência: verificar se barbershop_id já existe e pertence à fixture
  SELECT slug INTO v_existing_slug FROM public.barbershops WHERE id = v_shop_id;
  IF v_existing_slug IS NOT NULL AND v_existing_slug <> 'barbearia-homolog' THEN
    RAISE EXCEPTION 'PROTEÇÃO ABORTADA: Barbershop ID % existe mas seu slug é "%" (esperado: "barbearia-homolog")', 
      v_shop_id, v_existing_slug;
  END IF;

  -- 4. Limpar dados operacionais prévios da barbearia de teste para repetibilidade segura
  DELETE FROM public.appointment_notifications WHERE barbershop_id = v_shop_id;
  DELETE FROM public.appointments WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_custom_breaks WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_schedule_blocks WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_unavailability WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_schedules WHERE barbershop_id = v_shop_id;
  DELETE FROM public.services WHERE barbershop_id = v_shop_id;
  DELETE FROM public.staff_profiles WHERE barbershop_id = v_shop_id;
  DELETE FROM public.barbershop_members WHERE barbershop_id = v_shop_id;

  -- 5. Atualizar/Inserir profiles dos usuários de teste
  INSERT INTO public.profiles (id, email, name, role)
  VALUES 
    (v_owner_uid, 'owner.homolog@teste.com', 'Owner Homolog', 'admin_owner'),
    (v_staff_a_uid, 'staff_a.homolog@teste.com', 'Barbeiro A (08:15)', 'staff'),
    (v_staff_b_uid, 'staff_b.homolog@teste.com', 'Barbeiro B (08:00)', 'staff')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name;

  -- 6. Inserir ou atualizar barbearia de teste
  INSERT INTO public.barbershops (id, owner_id, name, slug)
  VALUES (v_shop_id, v_owner_uid, 'Barbearia Homolog', 'barbearia-homolog')
  ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, name = EXCLUDED.name, slug = EXCLUDED.slug;

  -- 7. Inserir vínculos e equipe
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
  VALUES 
    (v_shop_id, v_owner_uid, 'owner'),
    (v_shop_id, v_staff_a_uid, 'staff'),
    (v_shop_id, v_staff_b_uid, 'staff');

  INSERT INTO public.staff_profiles (id, barbershop_id, user_id, name, status)
  VALUES 
    (v_staff_a_id, v_shop_id, v_staff_a_uid, 'Barbeiro A (08:15)', 'active'),
    (v_staff_b_id, v_shop_id, v_staff_b_uid, 'Barbeiro B (08:00)', 'active');

  INSERT INTO public.services (id, barbershop_id, name, price, duration)
  VALUES 
    (v_serv_30, v_shop_id, 'Corte 30m', 50.00, 30),
    (v_serv_15, v_shop_id, 'Pezinho 15m', 25.00, 15);

  -- 8. Próxima Segunda-Feira garantida
  v_monday := CURRENT_DATE + ((1 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
  IF v_monday <= CURRENT_DATE THEN v_monday := v_monday + 7; END IF;

  -- 9. Salvar grades como Owner autenticado
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_uid::text, true);

  -- Barbeiro A: Segunda-feira 08:15 às 24:00 (sem pausas)
  PERFORM public.save_staff_schedule_atomic(
    v_shop_id, v_staff_a_id,
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00', 'end_time', '18:00', 'is_open', false, 'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 1, 'start_time', '08:15', 'end_time', '24:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 2, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 3, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 4, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 5, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 6, 'start_time', '08:00', 'end_time', '18:00', 'is_open', false, 'breaks', '[]'::jsonb)
    )
  );

  -- Barbeiro B: Segunda-feira 08:00 às 24:00 (sem pausas)
  PERFORM public.save_staff_schedule_atomic(
    v_shop_id, v_staff_b_id,
    jsonb_build_array(
      jsonb_build_object('day_of_week', 0, 'start_time', '09:00', 'end_time', '18:00', 'is_open', false, 'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 1, 'start_time', '08:00', 'end_time', '24:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 2, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 3, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 4, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 5, 'start_time', '08:00', 'end_time', '18:00', 'is_open', true,  'breaks', '[]'::jsonb),
      jsonb_build_object('day_of_week', 6, 'start_time', '08:00', 'end_time', '18:00', 'is_open', false, 'breaks', '[]'::jsonb)
    )
  );

  -- 10. Persistir as 2 reservas oficiais do snapshot via service_role
  PERFORM set_config('role', 'service_role', true);

  -- Reserva 1: Barbeiro A às 23:45 com Pezinho 15 min (termina em 24:00:00)
  v_res := public.process_public_booking_atomic(
    'barbearia-homolog', 'Cliente Snapshot 23:45', '11999990001', ARRAY[v_serv_15],
    v_staff_a_id, v_monday, '23:45:00'::time, 'Reserva teste snapshot A'
  );
  IF (v_res->>'appointment_id') IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar Reserva 1 (23:45) para snapshot: %', v_res;
  END IF;

  -- Reserva 2: Barbeiro B às 08:30 com Corte 30 min (termina em 09:00:00)
  v_res := public.process_public_booking_atomic(
    'barbearia-homolog', 'Cliente Snapshot 08:30', '11999990002', ARRAY[v_serv_30],
    v_staff_b_id, v_monday, '08:30:00'::time, 'Reserva teste snapshot B'
  );
  IF (v_res->>'appointment_id') IS NULL THEN
    RAISE EXCEPTION 'Falha ao criar Reserva 2 (08:30) para snapshot: %', v_res;
  END IF;

  RAISE NOTICE '[SNAPSHOT SEED CONCLUIDO] Barbershop: %, Segunda-feira: %', v_shop_id, v_monday;
END $$;

COMMIT; -- Persiste o estado para que chamadas HTTP externas enxerguem a base
