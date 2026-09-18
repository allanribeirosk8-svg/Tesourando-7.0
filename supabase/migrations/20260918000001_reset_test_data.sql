-- ==============================================================================
-- MIGRATION: 20260918000001_reset_test_data.sql
-- OBJETIVO: Utilitário explícito para ambiente de desenvolvimento/testes.
-- ATENÇÃO: NÃO executar automaticamente em produção.
-- Preserva auth.users e estruturas, limpando exclusivamente dados operacionais
-- de teste na ordem estrita de foreign keys.
-- ==============================================================================

DO $$
BEGIN
  -- 1. Transações e agendamentos dependentes de serviços e profissionais
  DELETE FROM public.transactions;
  DELETE FROM public.appointments;

  -- 2. Notificações e slots de calendário
  DELETE FROM public.notifications;
  DELETE FROM public.unblocked_slots;
  DELETE FROM public.blocked_slots;
  DELETE FROM public.weekly_breaks;
  DELETE FROM public.weekly_schedule;

  -- 3. Fotos de clientes e clientes
  DELETE FROM public.customer_photos;
  DELETE FROM public.customers;

  -- 4. Serviços da barbearia
  DELETE FROM public.services;

  -- 5. Perfis de equipe (staff_profiles)
  DELETE FROM public.staff_profiles;

  -- 6. Convites e membros de barbearias
  DELETE FROM public.barbershop_invites;
  DELETE FROM public.barbershop_members;

  -- 7. Barbearias (tenants)
  DELETE FROM public.barbershops;

  -- 8. Limpar campos de negócio em profiles preservando as contas de usuários (auth.users)
  -- Nota arquitetural: O registro de profile é mantido para cada auth.user com nome e telefone básico,
  -- mas os dados de barbearia (shop_name, slug, logo, onboarding_seen) são resetados.
  UPDATE public.profiles
  SET 
    shop_name = NULL,
    business_phone = NULL,
    address = NULL,
    description = NULL,
    instagram = NULL,
    website = NULL,
    logo = NULL,
    slug = NULL,
    onboarding_seen = FALSE,
    updated_at = NOW();

  RAISE NOTICE 'Reset controlado de dados de teste concluído com sucesso. Contas auth.users preservadas.';
END $$;
