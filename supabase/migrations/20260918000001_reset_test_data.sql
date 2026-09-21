-- ==============================================================================
-- MIGRATION: 20260918000001_reset_test_data.sql
-- OBJETIVO: Utilitário explícito para ambiente de desenvolvimento/testes.
-- ATENÇÃO: NÃO executar automaticamente em produção.
-- Preserva auth.users e estruturas, limpando exclusivamente dados operacionais
-- de teste na ordem estrita de foreign keys com verificação prévia de existência de tabelas e colunas.
-- ==============================================================================

DO $$
BEGIN
  -- 1. Transações e agendamentos dependentes de serviços e profissionais
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    DELETE FROM public.transactions;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'appointments') THEN
    DELETE FROM public.appointments;
  END IF;

  -- 2. Notificações, permissões operacionais e slots de calendário
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    DELETE FROM public.notifications;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'member_permissions') THEN
    DELETE FROM public.member_permissions;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'unblocked_slots') THEN
    DELETE FROM public.unblocked_slots;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'blocked_slots') THEN
    DELETE FROM public.blocked_slots;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'weekly_breaks') THEN
    DELETE FROM public.weekly_breaks;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'weekly_schedule') THEN
    DELETE FROM public.weekly_schedule;
  END IF;

  -- 3. Fotos de clientes e clientes
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customer_photos') THEN
    DELETE FROM public.customer_photos;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    DELETE FROM public.customers;
  END IF;

  -- 4. Serviços da barbearia
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'services') THEN
    DELETE FROM public.services;
  END IF;

  -- 5. Perfis de equipe (staff_profiles)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_profiles') THEN
    DELETE FROM public.staff_profiles;
  END IF;

  -- 6. Convites e membros de barbearias
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'barbershop_invites') THEN
    DELETE FROM public.barbershop_invites;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'barbershop_members') THEN
    DELETE FROM public.barbershop_members;
  END IF;

  -- 7. Barbearias (tenants)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'barbershops') THEN
    DELETE FROM public.barbershops;
  END IF;

  -- 8. Limpar campos de negócio em profiles de forma schema-aware (preservando auth.users)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    -- Construção dinâmica segura garantindo que colunas inexistentes não causem erro de compilação SQL
    DECLARE
      set_clauses text[] := ARRAY[]::text[];
      dynamic_sql text;
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'shop_name') THEN
        set_clauses := array_append(set_clauses, 'shop_name = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'business_phone') THEN
        set_clauses := array_append(set_clauses, 'business_phone = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'address') THEN
        set_clauses := array_append(set_clauses, 'address = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'description') THEN
        set_clauses := array_append(set_clauses, 'description = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'instagram') THEN
        set_clauses := array_append(set_clauses, 'instagram = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'website') THEN
        set_clauses := array_append(set_clauses, 'website = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'logo') THEN
        set_clauses := array_append(set_clauses, 'logo = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'slug') THEN
        set_clauses := array_append(set_clauses, 'slug = NULL');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'onboarding_seen') THEN
        set_clauses := array_append(set_clauses, 'onboarding_seen = FALSE');
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'updated_at') THEN
        set_clauses := array_append(set_clauses, 'updated_at = NOW()');
      END IF;

      IF array_length(set_clauses, 1) > 0 THEN
        dynamic_sql := 'UPDATE public.profiles SET ' || array_to_string(set_clauses, ', ');
        EXECUTE dynamic_sql;
      END IF;
    END;
  END IF;

  RAISE NOTICE 'Reset controlado de dados de teste concluído com sucesso. Contas auth.users preservadas.';
END $$;
