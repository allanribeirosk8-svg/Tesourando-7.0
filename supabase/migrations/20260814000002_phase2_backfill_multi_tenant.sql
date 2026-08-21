-- ==============================================================================
-- Migration: 20260814000002_phase2_backfill_multi_tenant.sql
-- Descrição: Fase 2 - Backfill Idempotente, Determinístico e com Cardinalidade Estrita
-- Tipo: DML Transacional, Set-Based, Não-Destrutivo, Idempotente
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_dup_owners INTEGER;
  v_dup_memberships INTEGER;
  v_dup_staff_profiles INTEGER;
  v_conflict_staff_tenant INTEGER;
  v_conflict_staff_membership INTEGER;
  v_unmapped_staff INTEGER;
  v_unmapped_services INTEGER;
  v_unmapped_customers INTEGER;
  v_unmapped_photos INTEGER;
  v_unmapped_appts_bshop INTEGER;
  v_unmapped_appts_staff INTEGER;
  v_mismatched_appts INTEGER;
  v_unmapped_tx_bshop INTEGER;
  v_unmapped_tx_staff INTEGER;
  v_mismatched_tx INTEGER;
  v_unmapped_sched_bshop INTEGER;
  v_unmapped_sched_staff INTEGER;
  v_mismatched_sched INTEGER;
  v_unmapped_breaks_bshop INTEGER;
  v_unmapped_breaks_staff INTEGER;
  v_mismatched_breaks INTEGER;
  v_unmapped_blocked_bshop INTEGER;
  v_unmapped_blocked_staff INTEGER;
  v_mismatched_blocked INTEGER;
  v_unmapped_unblocked_bshop INTEGER;
  v_unmapped_unblocked_staff INTEGER;
  v_mismatched_unblocked INTEGER;
  v_unmapped_notifs_bshop INTEGER;
  v_mismatched_notifs INTEGER;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. VALIDAÇÕES INICIAIS DE INTEGRIDADE, CARDINALIDADE E CONFLITO
  -- ----------------------------------------------------------------------------
  
  -- 1.1 Verificar se existe pelo menos uma barbearia cadastrada
  IF NOT EXISTS (SELECT 1 FROM public.barbershops) THEN
    RAISE EXCEPTION 'Abortando migration: Nenhuma barbearia encontrada na tabela public.barbershops.';
  END IF;

  -- 1.2 Validar cardinalidade: nenhum owner com múltiplas barbearias associadas
  SELECT COUNT(*) INTO v_dup_owners
  FROM (
    SELECT owner_id, COUNT(*) 
    FROM public.barbershops 
    GROUP BY owner_id 
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_owners > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Encontrado(s) % owner(s) com múltiplas barbearias associadas.', v_dup_owners;
  END IF;

  -- 1.3 Validar cardinalidade: nenhum usuário com mais de um membership na mesma barbearia
  SELECT COUNT(*) INTO v_dup_memberships
  FROM (
    SELECT barbershop_id, user_id, COUNT(*) 
    FROM public.barbershop_members 
    GROUP BY barbershop_id, user_id 
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_memberships > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Encontrado(s) % par(es) (barbershop_id, user_id) com membership duplicado.', v_dup_memberships;
  END IF;

  -- 1.4 Validar cardinalidade: nenhum par (tenant_id/barbershop_id, user_id) com múltiplos staff_profiles existentes
  SELECT COUNT(*) INTO v_dup_staff_profiles
  FROM (
    SELECT user_id, COALESCE(barbershop_id, (SELECT id FROM public.barbershops b WHERE b.owner_id = sp.tenant_id)) AS resolved_bshop, COUNT(*)
    FROM public.staff_profiles sp
    GROUP BY user_id, COALESCE(barbershop_id, (SELECT id FROM public.barbershops b WHERE b.owner_id = sp.tenant_id))
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_staff_profiles > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Encontrado(s) % par(es) (barbearia, user_id) com múltiplos staff_profiles.', v_dup_staff_profiles;
  END IF;

  -- 1.5 Validar conflito: tenant_id legado não correspondente a nenhuma barbearia existente
  SELECT COUNT(*) INTO v_conflict_staff_tenant
  FROM public.staff_profiles sp
  WHERE sp.tenant_id IS NOT NULL 
    AND NOT EXISTS (
      SELECT 1 FROM public.barbershops b WHERE b.owner_id = sp.tenant_id
    );

  IF v_conflict_staff_tenant > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % staff_profile(s) possuem tenant_id que não corresponde a nenhum owner de barbearia.', v_conflict_staff_tenant;
  END IF;

  -- 1.6 Validar conflito: membership do usuário aponta para barbearia diferente do tenant_id legado
  SELECT COUNT(*) INTO v_conflict_staff_membership
  FROM public.staff_profiles sp
  WHERE EXISTS (
    SELECT 1 
    FROM public.barbershop_members bm 
    JOIN public.barbershops b ON b.owner_id = sp.tenant_id
    WHERE bm.user_id = sp.user_id 
      AND bm.barbershop_id <> b.id
  );

  IF v_conflict_staff_membership > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Conflito detectado entre membership e tenant_id legado em % registro(s) de staff_profiles.', v_conflict_staff_membership;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 2. CRIAÇÃO IDEMPOTENTE DO STAFF PROFILE DO OWNER
  -- ----------------------------------------------------------------------------
  INSERT INTO public.staff_profiles (
    barbershop_id,
    user_id,
    tenant_id,
    name,
    phone,
    photo,
    status,
    commission_rate,
    created_at
  )
  SELECT 
    b.id AS barbershop_id,
    b.owner_id AS user_id,
    b.owner_id AS tenant_id,
    COALESCE(NULLIF(p.name, ''), NULLIF(b.name, ''), 'Proprietário') AS name,
    p.personal_phone AS phone,
    p.photo AS photo,
    'active' AS status,
    100 AS commission_rate,
    NOW() AS created_at
  FROM public.barbershops b
  LEFT JOIN public.profiles p ON p.id = b.owner_id
  WHERE NOT EXISTS (
    SELECT 1 
    FROM public.staff_profiles sp 
    WHERE (sp.barbershop_id = b.id OR sp.tenant_id = b.owner_id)
      AND sp.user_id = b.owner_id
  );

  -- ----------------------------------------------------------------------------
  -- 3. BACKFILL DE staff_profiles (1 LINHA POR ID)
  -- ----------------------------------------------------------------------------
  WITH staff_tenant_map AS (
    SELECT 
      sp.id AS staff_profile_id,
      (
        SELECT b.id 
        FROM public.barbershops b 
        WHERE b.owner_id = sp.tenant_id 
           OR EXISTS (
             SELECT 1 
             FROM public.barbershop_members bm 
             WHERE bm.barbershop_id = b.id AND bm.user_id = sp.user_id
           )
      ) AS resolved_barbershop_id
    FROM public.staff_profiles sp
    WHERE sp.barbershop_id IS NULL
  )
  UPDATE public.staff_profiles sp
  SET barbershop_id = stm.resolved_barbershop_id
  FROM staff_tenant_map stm
  WHERE sp.id = stm.staff_profile_id
    AND stm.resolved_barbershop_id IS NOT NULL;

  -- ----------------------------------------------------------------------------
  -- 4. BACKFILL DE services (1 LINHA POR ID)
  -- ----------------------------------------------------------------------------
  WITH service_tenant_map AS (
    SELECT 
      s.id AS service_id,
      (
        SELECT b.id 
        FROM public.barbershops b 
        WHERE b.owner_id = s.user_id 
           OR EXISTS (
             SELECT 1 
             FROM public.barbershop_members bm 
             WHERE bm.barbershop_id = b.id AND bm.user_id = s.user_id
           )
      ) AS resolved_barbershop_id
    FROM public.services s
    WHERE s.barbershop_id IS NULL
  )
  UPDATE public.services s
  SET barbershop_id = stm.resolved_barbershop_id
  FROM service_tenant_map stm
  WHERE s.id = stm.service_id
    AND stm.resolved_barbershop_id IS NOT NULL;

  -- ----------------------------------------------------------------------------
  -- 5. BACKFILL DE customers (1 LINHA POR ID)
  -- ----------------------------------------------------------------------------
  WITH customer_tenant_map AS (
    SELECT 
      c.id AS customer_id,
      (
        SELECT b.id 
        FROM public.barbershops b 
        WHERE b.owner_id = c.user_id 
           OR EXISTS (
             SELECT 1 
             FROM public.barbershop_members bm 
             WHERE bm.barbershop_id = b.id AND bm.user_id = c.user_id
           )
      ) AS resolved_barbershop_id
    FROM public.customers c
    WHERE c.barbershop_id IS NULL
  )
  UPDATE public.customers c
  SET barbershop_id = ctm.resolved_barbershop_id
  FROM customer_tenant_map ctm
  WHERE c.id = ctm.customer_id
    AND ctm.resolved_barbershop_id IS NOT NULL;

  -- ----------------------------------------------------------------------------
  -- 6. BACKFILL DE customer_photos (1 LINHA POR ID)
  -- ----------------------------------------------------------------------------
  WITH photo_tenant_map AS (
    SELECT 
      cp.id AS photo_id,
      (
        SELECT b.id 
        FROM public.barbershops b 
        WHERE b.owner_id = cp.user_id 
           OR EXISTS (
             SELECT 1 
             FROM public.barbershop_members bm 
             WHERE bm.barbershop_id = b.id AND bm.user_id = cp.user_id
           )
      ) AS resolved_barbershop_id
    FROM public.customer_photos cp
    WHERE cp.barbershop_id IS NULL
  )
  UPDATE public.customer_photos cp
  SET barbershop_id = ptm.resolved_barbershop_id
  FROM photo_tenant_map ptm
  WHERE cp.id = ptm.photo_id
    AND ptm.resolved_barbershop_id IS NOT NULL;

  -- ----------------------------------------------------------------------------
  -- 7. BACKFILL DE appointments (RESOLUÇÃO DETERMINÍSTICA E RESTRITA POR TENANT)
  -- ----------------------------------------------------------------------------
  WITH appt_tenant_res AS (
    SELECT 
      a.id AS appt_id,
      a.user_id AS appt_user_id,
      a.created_by AS appt_created_by,
      COALESCE(
        a.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = a.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = a.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.appointments a
  ),
  appt_full_map AS (
    SELECT 
      atr.appt_id,
      atr.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = atr.appt_user_id 
          AND sp.barbershop_id = atr.resolved_barbershop_id
      ) AS resolved_staff_id,
      COALESCE(atr.appt_created_by, atr.appt_user_id) AS resolved_created_by
    FROM appt_tenant_res atr
  )
  UPDATE public.appointments a
  SET 
    barbershop_id = COALESCE(a.barbershop_id, afm.resolved_barbershop_id),
    staff_id = COALESCE(a.staff_id, afm.resolved_staff_id),
    created_by = COALESCE(a.created_by, afm.resolved_created_by)
  FROM appt_full_map afm
  WHERE a.id = afm.appt_id
    AND (a.barbershop_id IS NULL OR a.staff_id IS NULL OR a.created_by IS NULL);

  -- ----------------------------------------------------------------------------
  -- 8. BACKFILL DE transactions (USANDO linked_appointment_id QUANDO EXISTENTE)
  -- ----------------------------------------------------------------------------
  WITH tx_tenant_res AS (
    SELECT 
      t.id AS tx_id,
      t.user_id AS tx_user_id,
      t.created_by AS tx_created_by,
      COALESCE(
        t.barbershop_id,
        appts.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = t.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = t.user_id
             )
        )
      ) AS resolved_barbershop_id,
      appts.staff_id AS appt_staff_id
    FROM public.transactions t
    LEFT JOIN public.appointments appts ON appts.id = t.linked_appointment_id
  ),
  tx_full_map AS (
    SELECT 
      ttr.tx_id,
      ttr.resolved_barbershop_id,
      COALESCE(
        ttr.appt_staff_id,
        (
          SELECT sp.id 
          FROM public.staff_profiles sp 
          WHERE sp.user_id = ttr.tx_user_id 
            AND sp.barbershop_id = ttr.resolved_barbershop_id
        )
      ) AS resolved_staff_id,
      COALESCE(ttr.tx_created_by, ttr.tx_user_id) AS resolved_created_by
    FROM tx_tenant_res ttr
  )
  UPDATE public.transactions t
  SET 
    barbershop_id = COALESCE(t.barbershop_id, tfm.resolved_barbershop_id),
    staff_id = COALESCE(t.staff_id, tfm.resolved_staff_id),
    created_by = COALESCE(t.created_by, tfm.resolved_created_by)
  FROM tx_full_map tfm
  WHERE t.id = tfm.tx_id
    AND (t.barbershop_id IS NULL OR t.staff_id IS NULL OR t.created_by IS NULL);

  -- ----------------------------------------------------------------------------
  -- 9. BACKFILL DE weekly_schedule (DETERMINÍSTICO 1 LINHA POR DIA/USER)
  -- ----------------------------------------------------------------------------
  WITH sched_tenant_res AS (
    SELECT 
      ws.day_of_week,
      ws.user_id,
      COALESCE(
        ws.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = ws.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = ws.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.weekly_schedule ws
  ),
  sched_full_map AS (
    SELECT 
      str.day_of_week,
      str.user_id,
      str.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = str.user_id 
          AND sp.barbershop_id = str.resolved_barbershop_id
      ) AS resolved_staff_id
    FROM sched_tenant_res str
  )
  UPDATE public.weekly_schedule ws
  SET 
    barbershop_id = COALESCE(ws.barbershop_id, sfm.resolved_barbershop_id),
    staff_id = COALESCE(ws.staff_id, sfm.resolved_staff_id)
  FROM sched_full_map sfm
  WHERE ws.day_of_week = sfm.day_of_week
    AND ws.user_id = sfm.user_id
    AND (ws.barbershop_id IS NULL OR ws.staff_id IS NULL);

  -- ----------------------------------------------------------------------------
  -- 10. BACKFILL DE weekly_breaks (DETERMINÍSTICO 1 LINHA POR ID)
  -- ----------------------------------------------------------------------------
  WITH breaks_tenant_res AS (
    SELECT 
      wb.id AS break_id,
      wb.user_id,
      COALESCE(
        wb.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = wb.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = wb.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.weekly_breaks wb
  ),
  breaks_full_map AS (
    SELECT 
      btr.break_id,
      btr.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = btr.user_id 
          AND sp.barbershop_id = btr.resolved_barbershop_id
      ) AS resolved_staff_id
    FROM breaks_tenant_res btr
  )
  UPDATE public.weekly_breaks wb
  SET 
    barbershop_id = COALESCE(wb.barbershop_id, bfm.resolved_barbershop_id),
    staff_id = COALESCE(wb.staff_id, bfm.resolved_staff_id)
  FROM breaks_full_map bfm
  WHERE wb.id = bfm.break_id
    AND (wb.barbershop_id IS NULL OR wb.staff_id IS NULL);

  -- ----------------------------------------------------------------------------
  -- 11. BACKFILL DE blocked_slots (STAFF_ID OBRIGATÓRIO)
  -- ----------------------------------------------------------------------------
  WITH blocked_tenant_res AS (
    SELECT 
      bs.id AS blocked_id,
      bs.user_id,
      COALESCE(
        bs.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = bs.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = bs.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.blocked_slots bs
  ),
  blocked_full_map AS (
    SELECT 
      btr.blocked_id,
      btr.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = btr.user_id 
          AND sp.barbershop_id = btr.resolved_barbershop_id
      ) AS resolved_staff_id
    FROM blocked_tenant_res btr
  )
  UPDATE public.blocked_slots bs
  SET 
    barbershop_id = COALESCE(bs.barbershop_id, bfm.resolved_barbershop_id),
    staff_id = COALESCE(bs.staff_id, bfm.resolved_staff_id)
  FROM blocked_full_map bfm
  WHERE bs.id = bfm.blocked_id
    AND (bs.barbershop_id IS NULL OR bs.staff_id IS NULL);

  -- ----------------------------------------------------------------------------
  -- 12. BACKFILL DE unblocked_slots (STAFF_ID OBRIGATÓRIO)
  -- ----------------------------------------------------------------------------
  WITH unblocked_tenant_res AS (
    SELECT 
      ubs.id AS unblocked_id,
      ubs.user_id,
      COALESCE(
        ubs.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = ubs.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = ubs.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.unblocked_slots ubs
  ),
  unblocked_full_map AS (
    SELECT 
      utr.unblocked_id,
      utr.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = utr.user_id 
          AND sp.barbershop_id = utr.resolved_barbershop_id
      ) AS resolved_staff_id
    FROM unblocked_tenant_res utr
  )
  UPDATE public.unblocked_slots ubs
  SET 
    barbershop_id = COALESCE(ubs.barbershop_id, ufm.resolved_barbershop_id),
    staff_id = COALESCE(ubs.staff_id, ufm.resolved_staff_id)
  FROM unblocked_full_map ufm
  WHERE ubs.id = ufm.unblocked_id
    AND (ubs.barbershop_id IS NULL OR ubs.staff_id IS NULL);

  -- ----------------------------------------------------------------------------
  -- 13. BACKFILL DE notifications (STAFF_ID OPCIONAL PARA NOTIFICAÇÕES GERAIS)
  -- ----------------------------------------------------------------------------
  WITH notif_tenant_res AS (
    SELECT 
      n.id AS notif_id,
      n.user_id,
      COALESCE(
        n.barbershop_id,
        (
          SELECT b.id 
          FROM public.barbershops b 
          WHERE b.owner_id = n.user_id 
             OR EXISTS (
               SELECT 1 
               FROM public.barbershop_members bm 
               WHERE bm.barbershop_id = b.id AND bm.user_id = n.user_id
             )
        )
      ) AS resolved_barbershop_id
    FROM public.notifications n
  ),
  notif_full_map AS (
    SELECT 
      ntr.notif_id,
      ntr.resolved_barbershop_id,
      (
        SELECT sp.id 
        FROM public.staff_profiles sp 
        WHERE sp.user_id = ntr.user_id 
          AND sp.barbershop_id = ntr.resolved_barbershop_id
      ) AS resolved_staff_id
    FROM notif_tenant_res ntr
  )
  UPDATE public.notifications n
  SET 
    barbershop_id = COALESCE(n.barbershop_id, nfm.resolved_barbershop_id),
    staff_id = COALESCE(n.staff_id, nfm.resolved_staff_id)
  FROM notif_full_map nfm
  WHERE n.id = nfm.notif_id
    AND (n.barbershop_id IS NULL OR (n.staff_id IS NULL AND nfm.resolved_staff_id IS NOT NULL));

  -- ----------------------------------------------------------------------------
  -- 14. VALIDAÇÕES FINAIS DE INTEGRIDADE, ISOLAMENTO E CONSISTÊNCIA
  -- ----------------------------------------------------------------------------
  
  -- 14.1 staff_profiles sem barbershop_id
  SELECT COUNT(*) INTO v_unmapped_staff FROM public.staff_profiles WHERE barbershop_id IS NULL;
  IF v_unmapped_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % staff_profile(s) permaneceram sem barbershop_id.', v_unmapped_staff;
  END IF;

  -- 14.2 services sem barbershop_id
  SELECT COUNT(*) INTO v_unmapped_services FROM public.services WHERE barbershop_id IS NULL;
  IF v_unmapped_services > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % service(s) permaneceram sem barbershop_id.', v_unmapped_services;
  END IF;

  -- 14.3 customers sem barbershop_id
  SELECT COUNT(*) INTO v_unmapped_customers FROM public.customers WHERE barbershop_id IS NULL;
  IF v_unmapped_customers > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % customer(s) permaneceram sem barbershop_id.', v_unmapped_customers;
  END IF;

  -- 14.4 customer_photos sem barbershop_id
  SELECT COUNT(*) INTO v_unmapped_photos FROM public.customer_photos WHERE barbershop_id IS NULL;
  IF v_unmapped_photos > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % customer_photo(s) permaneceram sem barbershop_id.', v_unmapped_photos;
  END IF;

  -- 14.5 appointments: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_appts_bshop FROM public.appointments WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_appts_staff FROM public.appointments WHERE staff_id IS NULL;
  IF v_unmapped_appts_bshop > 0 OR v_unmapped_appts_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Appointments com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_appts_bshop, v_unmapped_appts_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_appts
  FROM public.appointments a
  JOIN public.staff_profiles sp ON sp.id = a.staff_id
  WHERE a.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_appts > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % appointment(s) associados a staff_profiles de outra barbearia.', v_mismatched_appts;
  END IF;

  -- 14.6 transactions: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_tx_bshop FROM public.transactions WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_tx_staff FROM public.transactions WHERE staff_id IS NULL;
  IF v_unmapped_tx_bshop > 0 OR v_unmapped_tx_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: Transactions com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_tx_bshop, v_unmapped_tx_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_tx
  FROM public.transactions t
  JOIN public.staff_profiles sp ON sp.id = t.staff_id
  WHERE t.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_tx > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % transaction(s) associadas a staff_profiles de outra barbearia.', v_mismatched_tx;
  END IF;

  -- 14.7 weekly_schedule: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_sched_bshop FROM public.weekly_schedule WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_sched_staff FROM public.weekly_schedule WHERE staff_id IS NULL;
  IF v_unmapped_sched_bshop > 0 OR v_unmapped_sched_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: weekly_schedule com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_sched_bshop, v_unmapped_sched_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_sched
  FROM public.weekly_schedule ws
  JOIN public.staff_profiles sp ON sp.id = ws.staff_id
  WHERE ws.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_sched > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % weekly_schedule(s) associados a staff_profiles de outra barbearia.', v_mismatched_sched;
  END IF;

  -- 14.8 weekly_breaks: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_breaks_bshop FROM public.weekly_breaks WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_breaks_staff FROM public.weekly_breaks WHERE staff_id IS NULL;
  IF v_unmapped_breaks_bshop > 0 OR v_unmapped_breaks_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: weekly_breaks com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_breaks_bshop, v_unmapped_breaks_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_breaks
  FROM public.weekly_breaks wb
  JOIN public.staff_profiles sp ON sp.id = wb.staff_id
  WHERE wb.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_breaks > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % weekly_breaks associados a staff_profiles de outra barbearia.', v_mismatched_breaks;
  END IF;

  -- 14.9 blocked_slots: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_blocked_bshop FROM public.blocked_slots WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_blocked_staff FROM public.blocked_slots WHERE staff_id IS NULL;
  IF v_unmapped_blocked_bshop > 0 OR v_unmapped_blocked_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: blocked_slots com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_blocked_bshop, v_unmapped_blocked_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_blocked
  FROM public.blocked_slots bs
  JOIN public.staff_profiles sp ON sp.id = bs.staff_id
  WHERE bs.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_blocked > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % blocked_slots associados a staff_profiles de outra barbearia.', v_mismatched_blocked;
  END IF;

  -- 14.10 unblocked_slots: Exigência de barbershop_id e staff_id, e isolamento de tenant
  SELECT COUNT(*) INTO v_unmapped_unblocked_bshop FROM public.unblocked_slots WHERE barbershop_id IS NULL;
  SELECT COUNT(*) INTO v_unmapped_unblocked_staff FROM public.unblocked_slots WHERE staff_id IS NULL;
  IF v_unmapped_unblocked_bshop > 0 OR v_unmapped_unblocked_staff > 0 THEN
    RAISE EXCEPTION 'Abortando migration: unblocked_slots com campos nulos obrigatórios (sem barbershop_id: %, sem staff_id: %).', v_unmapped_unblocked_bshop, v_unmapped_unblocked_staff;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_unblocked
  FROM public.unblocked_slots ubs
  JOIN public.staff_profiles sp ON sp.id = ubs.staff_id
  WHERE ubs.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_unblocked > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % unblocked_slots associados a staff_profiles de outra barbearia.', v_mismatched_unblocked;
  END IF;

  -- 14.11 notifications: Exigência de barbershop_id e isolamento de tenant (se staff_id preenchido)
  SELECT COUNT(*) INTO v_unmapped_notifs_bshop FROM public.notifications WHERE barbershop_id IS NULL;
  IF v_unmapped_notifs_bshop > 0 THEN
    RAISE EXCEPTION 'Abortando migration: notifications sem barbershop_id (total: %).', v_unmapped_notifs_bshop;
  END IF;

  SELECT COUNT(*) INTO v_mismatched_notifs
  FROM public.notifications n
  JOIN public.staff_profiles sp ON sp.id = n.staff_id
  WHERE n.staff_id IS NOT NULL AND n.barbershop_id <> sp.barbershop_id;

  IF v_mismatched_notifs > 0 THEN
    RAISE EXCEPTION 'Abortando migration: % notifications associadas a staff_profiles de outra barbearia.', v_mismatched_notifs;
  END IF;

  RAISE NOTICE 'Backfill Fase 2 concluído com sucesso e 100%% validado com cardinalidade estrita.';
END $$;

COMMIT;
