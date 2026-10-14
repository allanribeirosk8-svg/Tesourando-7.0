-- ==============================================================================
-- Migration: 20260923000001_profiles_rls_policies.sql
-- Descrição: Habilita e define policies RLS explícitas e estritas para public.profiles.
--            Garante que o usuário autenticado consiga ler, inserir e atualizar
--            apenas seu próprio perfil (id = auth.uid()) durante o onboarding
--            ou atualização de dados de identidade.
--            Nenhuma policy pública ou permissiva de leitura global é criada.
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());
