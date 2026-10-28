-- scripts/01_transactional_tests.sql
-- Invocado com: psql -v ON_ERROR_STOP=1 -v owner_uid=UUID -v staff_a_uid=UUID -v staff_b_uid=UUID -d "$STAGING_DB_URL" -f scripts/01_transactional_tests.sql
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
  v_res jsonb;
BEGIN
  -- 2. Validar que as FKs reais existem em auth.users (sem criar contas paralelas)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner_uid) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_staff_a_uid) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_staff_b_uid) THEN
    RAISE EXCEPTION 'FALHA DE INTEGRIDADE: IDs de auth.users fornecidos não existem no banco.';
  END IF;

  -- 3. Garantir registros em public.profiles
  INSERT INTO public.profiles (id, email, name, role)
  VALUES 
    (v_owner_uid, 'owner.homolog@teste.com', 'Owner Homolog', 'admin_owner'),
    (v_staff_a_uid, 'staff_a.homolog@teste.com', 'Barbeiro A', 'staff'),
    (v_staff_b_uid, 'staff_b.homolog@teste.com', 'Barbeiro B', 'staff')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name;

  -- 4. Inserir barbearia e membros
  INSERT INTO public.barbershops (id, owner_id, name, slug)
  VALUES (v_shop_id, v_owner_uid, 'Barbearia Homolog', 'barbearia-homolog')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.barbershop_members (barbershop_id, user_id, role) VALUES (v_shop_id, v_owner_uid, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role) VALUES (v_shop_id, v_staff_a_uid, 'staff') ON CONFLICT DO NOTHING;
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role) VALUES (v_shop_id, v_staff_b_uid, 'staff') ON CONFLICT DO NOTHING;

  INSERT INTO public.staff_profiles (id, barbershop_id, user_id, name, status) VALUES (v_staff_a_id, v_shop_id, v_staff_a_uid, 'Barbeiro A (08:15)', 'active') ON CONFLICT DO NOTHING;
  INSERT INTO public.staff_profiles (id, barbershop_id, user_id, name, status) VALUES (v_staff_b_id, v_shop_id, v_staff_b_uid, 'Barbeiro B (08:00)', 'active') ON CONFLICT DO NOTHING;

  INSERT INTO public.services (id, barbershop_id, name, price, duration) VALUES (v_serv_30, v_shop_id, 'Corte 30m', 50.00, 30) ON CONFLICT DO NOTHING;
  INSERT INTO public.services (id, barbershop_id, name, price, duration) VALUES (v_serv_15, v_shop_id, 'Pezinho 15m', 25.00, 15) ON CONFLICT DO NOTHING;

  -- 5. Próxima Segunda-Feira garantida
  v_monday := CURRENT_DATE + ((1 - EXTRACT(DOW FROM CURRENT_DATE)::int + 7) % 7);
  IF v_monday <= CURRENT_DATE THEN v_monday := v_monday + 7; END IF;

  -- 6. Salvar grades como Owner autenticado
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_uid::text, true);

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

  -- 7. Testes públicos com service_role
  PERFORM set_config('role', 'service_role', true);

  -- 7.1 Rejeição de ancoragem desalinhada (08:30 para Barbeiro A com início 08:15)
  BEGIN
    PERFORM public.process_public_booking_atomic(
      'barbearia-homolog', 'Cliente Falha', '11999990001', ARRAY[v_serv_30],
      v_staff_a_id, v_monday, '08:30:00'::time, ''
    );
    RAISE EXCEPTION 'FALHA: 08:30 deveria falhar por desalinhamento.';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    RAISE NOTICE '[OK] Desalinhamento 08:30 para Barbeiro A rejeitado com 23505.';
  END;

  -- 7.2 Sucesso de ancoragem alinhada (08:15 para Barbeiro A)
  v_res := public.process_public_booking_atomic(
    'barbearia-homolog', 'Cliente 08:15', '11999990002', ARRAY[v_serv_30],
    v_staff_a_id, v_monday, '08:15:00'::time, ''
  );
  IF (v_res->>'staff_id')::uuid IS DISTINCT FROM v_staff_a_id OR (v_res->>'appointment_id') IS NULL THEN
    RAISE EXCEPTION 'FALHA: Reserva das 08:15 para Barbeiro A retornou payload inválido: %', v_res;
  END IF;

  -- 7.3 Sucesso de meia-noite exata (23:45 + 15 min = 24:00:00 para Barbeiro A)
  v_res := public.process_public_booking_atomic(
    'barbearia-homolog', 'Cliente 23:45', '11999990003', ARRAY[v_serv_15],
    v_staff_a_id, v_monday, '23:45:00'::time, ''
  );
  IF (v_res->>'staff_id')::uuid IS DISTINCT FROM v_staff_a_id OR (v_res->>'appointment_id') IS NULL THEN
    RAISE EXCEPTION 'FALHA: Reserva das 23:45 para Barbeiro A retornou payload inválido: %', v_res;
  END IF;

  -- 7.4 Bloqueio por conflito de horário às 23:45 (usando serviço de 15 min)
  BEGIN
    PERFORM public.process_public_booking_atomic(
      'barbearia-homolog', 'Cliente Conflito 23:45', '11999990004', ARRAY[v_serv_15],
      v_staff_a_id, v_monday, '23:45:00'::time, ''
    );
    RAISE EXCEPTION 'FALHA: Conflito de 23:45 com 15 min deveria ter sido bloqueado.';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    RAISE NOTICE '[OK] Conflito em 23:45 com serviço de 15 min rejeitado com 23505.';
  END;

  -- 7.5 Alocação precisa em "Qualquer Profissional" às 08:30 (ancorado para Barbeiro B)
  v_res := public.process_public_booking_atomic(
    'barbearia-homolog', 'Cliente Qualquer 08:30', '11999990005', ARRAY[v_serv_30],
    NULL, v_monday, '08:30:00'::time, ''
  );

  IF (v_res->>'staff_id')::uuid IS DISTINCT FROM v_staff_b_id THEN
    RAISE EXCEPTION 'FALHA: Esperado staff_id = % (Barbeiro B), obtido = %', v_staff_b_id, v_res->>'staff_id';
  END IF;

  IF (v_res->>'appointment_id') IS NULL THEN
    RAISE EXCEPTION 'FALHA: appointment_id ausente no retorno.';
  END IF;

  RAISE NOTICE '[OK] Qualquer profissional alocado com sucesso ao Barbeiro B (ID: %).', v_res->>'appointment_id';
END $$;

ROLLBACK; -- Desfaz alterações do teste transacional
