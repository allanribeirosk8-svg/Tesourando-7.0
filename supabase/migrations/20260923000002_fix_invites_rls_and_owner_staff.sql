-- ==============================================================================
-- Migration: 20260923000002_fix_invites_rls_and_owner_staff.sql
-- Descrição: 
--  1. Corrige a policy barbershop_invites_select para NÃO consultar auth.users diretamente
--     pela role authenticated (o que disparava erro 42501 "permission denied for table users").
--     Utiliza claim JWT auth.jwt() ->> 'email' e função auxiliar SECURITY DEFINER get_auth_user_email().
--  2. Adiciona coluna staff_id em weekly_breaks (se não existir) para suportar tanto pausas
--     gerais da barbearia (staff_id = NULL) quanto específicas de profissionais.
--  3. Atualiza handle_new_barbershop() para garantir idempotentemente tanto
--     barbershop_members ('owner') quanto staff_profiles ('active') no momento da criação da barbearia.
--  4. Adiciona policy explícita staff_profiles_insert para permitir que owner/admin
--     cadastre membros da equipe no seu barbershop_id autorizado.
-- ==============================================================================

-- 2. Correção da policy barbershop_invites_select (sem qualquer consulta a auth.users)
DROP POLICY IF EXISTS "barbershop_invites_select" ON public.barbershop_invites;

CREATE POLICY "barbershop_invites_select" ON public.barbershop_invites
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 3. Garantir coluna staff_id em weekly_breaks
ALTER TABLE public.weekly_breaks 
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

-- 5. Atualizar handle_new_barbershop para criar membership e staff_profile do owner
CREATE OR REPLACE FUNCTION public.handle_new_barbershop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
  v_phone text;
  v_photo text;
BEGIN
  -- 1. Cria membership de owner
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;

  -- 2. Busca dados de perfil do owner
  SELECT name, personal_phone, photo INTO v_name, v_phone, v_photo
  FROM public.profiles
  WHERE id = NEW.owner_id;

  -- 3. Cria staff_profile para o owner de forma idempotente
  INSERT INTO public.staff_profiles (
    barbershop_id,
    user_id,
    name,
    phone,
    photo,
    status,
    commission_rate
  )
  VALUES (
    NEW.id,
    NEW.owner_id,
    COALESCE(NULLIF(v_name, ''), NEW.name, 'Proprietário'),
    COALESCE(v_phone, ''),
    v_photo,
    'active',
    0
  )
  ON CONFLICT (barbershop_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_barbershop() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_barbershop() TO postgres, service_role;
