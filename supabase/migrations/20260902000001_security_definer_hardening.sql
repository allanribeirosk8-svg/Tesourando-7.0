-- ==============================================================================
-- Migration: 20260902000001_security_definer_hardening.sql
-- Descrição: Hardening de segurança para funções PostgreSQL SECURITY DEFINER.
--            1. Fixação estrita de search_path = public, pg_temp (prevenção de hijack).
--            2. Revogação de privilégios EXECUTE de PUBLIC e anon.
--            3. Restrição de funções internas e triggers a postgres/service_role.
--            4. Manutenção de acesso para authenticated apenas onde estritamente
--               necessário (accept_barbershop_invite, add_or_group_notification e
--               funções auxiliares de RLS para evitar erro 42P17).
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. public.handle_new_user() [Trigger em auth.users]
-- ------------------------------------------------------------------------------
-- Função interna de trigger chamada pelo Supabase Auth.
-- Não deve ser exposta a nenhuma role web (PUBLIC, anon, authenticated).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) THEN
    ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. public.handle_new_barbershop() [Trigger em public.barbershops]
-- ------------------------------------------------------------------------------
-- Função interna de trigger para criar membership de 'owner'.
-- Não deve ser exposta a nenhuma role web (PUBLIC, anon, authenticated).
CREATE OR REPLACE FUNCTION public.handle_new_barbershop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_barbershop() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_barbershop() TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 3. Funções de Diagnóstico: inspect_active_policies / inspect_active_functions
-- ------------------------------------------------------------------------------
-- Funções de inspeção administrativa; não devem ser acessíveis por anon ou authenticated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'inspect_active_policies'
  ) THEN
    ALTER FUNCTION public.inspect_active_policies() SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.inspect_active_policies() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.inspect_active_policies() TO postgres, service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'inspect_active_functions'
  ) THEN
    ALTER FUNCTION public.inspect_active_functions() SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.inspect_active_functions() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.inspect_active_functions() TO postgres, service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. public.accept_barbershop_invite(text) [RPC de Convite]
-- ------------------------------------------------------------------------------
-- Chamada pelo frontend quando um usuário logado aceita convite de equipe.
-- Exige autenticação ativa; revogada estritamente de PUBLIC e anon.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'accept_barbershop_invite'
  ) THEN
    ALTER FUNCTION public.accept_barbershop_invite(text) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.accept_barbershop_invite(text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.accept_barbershop_invite(text) TO authenticated, service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Funções Auxiliares de RLS (Prevenção de 42P17 - Recursão Infinita)
--    public.get_user_barbershop_ids(uuid) e public.get_owned_barbershop_ids(uuid)
-- ------------------------------------------------------------------------------
-- Necessárias para policies RLS consultarem memberships sem recursão circular.
-- Revogadas de PUBLIC e anon; concedidas a authenticated e service_role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_user_barbershop_ids'
  ) THEN
    ALTER FUNCTION public.get_user_barbershop_ids(uuid) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.get_user_barbershop_ids(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_user_barbershop_ids(uuid) TO authenticated, service_role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_owned_barbershop_ids'
  ) THEN
    ALTER FUNCTION public.get_owned_barbershop_ids(uuid) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.get_owned_barbershop_ids(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_owned_barbershop_ids(uuid) TO authenticated, service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. public.add_or_group_notification(...) [RPC de Notificações Operacionais]
-- ------------------------------------------------------------------------------
-- Chamada pelo frontend autenticado para registrar/agrupar notificações no painel.
-- Revogada de PUBLIC e anon; concedida a authenticated e service_role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'add_or_group_notification'
  ) THEN
    ALTER FUNCTION public.add_or_group_notification(uuid, text, text, text, jsonb, text) SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.add_or_group_notification(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.add_or_group_notification(uuid, text, text, text, jsonb, text) TO authenticated, service_role;
  END IF;
END $$;

COMMIT;
