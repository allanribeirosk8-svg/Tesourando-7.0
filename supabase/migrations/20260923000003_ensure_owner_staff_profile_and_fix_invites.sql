-- ==============================================================================
-- Migration: 20260923000003_ensure_owner_staff_profile_and_fix_invites.sql
-- Descrição:
--   1. Corrige a policy barbershop_invites_select para NÃO consultar auth.users
--      (elimina erro 42501 "permission denied for table users").
--      Utiliza exclusivamente auth.jwt() ->> 'email' para convidados e
--      public.get_admin_barbershop_ids() para administradores/proprietários.
--   2. Remove qualquer policy permissiva de INSERT direto em staff_profiles.
--      A tabela staff_profiles permanece protegida contra inserção direta de clientes.
--   3. Cria a RPC SECURITY DEFINER ensure_owner_staff_profile(p_barbershop_id uuid)
--      para criação atômica e idempotente do perfil de staff do proprietário
--      com comissão de 100%, sem permitir parâmetros arbitrários de usuário.
-- ==============================================================================

-- 1. Remover policy anterior de barbershop_invites que referenciava auth.users
DROP POLICY IF EXISTS "barbershop_invites_select" ON public.barbershop_invites;

-- 2. Recriar policy de SELECT sem qualquer referência a auth.users ou subqueries em auth
CREATE POLICY "barbershop_invites_select" ON public.barbershop_invites
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- 3. Remover policy temporária de INSERT direto em staff_profiles
DROP POLICY IF EXISTS "staff_profiles_insert" ON public.staff_profiles;

-- 4. Garantir índice único para prevenir perfis duplicados do mesmo usuário na mesma barbearia
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_profiles_shop_user 
  ON public.staff_profiles(barbershop_id, user_id) 
  WHERE user_id IS NOT NULL;

-- 5. RPC SECURITY DEFINER: ensure_owner_staff_profile
CREATE OR REPLACE FUNCTION public.ensure_owner_staff_profile(p_barbershop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_owner_id uuid;
  v_membership_role text;
  v_profile RECORD;
  v_staff RECORD;
  v_result jsonb;
BEGIN
  -- 1. Verificar auth.uid()
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;

  IF p_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'barbershop_id é obrigatório.' USING ERRCODE = '22023';
  END IF;

  -- 2. Buscar barbershops.id = p_barbershop_id
  -- 3. Verificar barbershops.owner_id = auth.uid()
  SELECT owner_id INTO v_owner_id
  FROM public.barbershops
  WHERE id = p_barbershop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barbearia não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Apenas o proprietário da barbearia pode executar esta operação.' USING ERRCODE = '42501';
  END IF;

  -- 4. Verificar membership: barbershop_members.barbershop_id = p_barbershop_id AND user_id = auth.uid() AND role = 'owner'
  SELECT role INTO v_membership_role
  FROM public.barbershop_members
  WHERE barbershop_id = p_barbershop_id AND user_id = v_user_id;

  IF NOT FOUND OR v_membership_role <> 'owner' THEN
    INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
    VALUES (p_barbershop_id, v_user_id, 'owner')
    ON CONFLICT (barbershop_id, user_id)
    DO UPDATE SET role = 'owner';
  END IF;

  -- 6. Buscar staff_profiles: barbershop_id = p_barbershop_id AND user_id = auth.uid()
  SELECT id, barbershop_id, user_id, name, phone, photo, commission_rate, status
  INTO v_staff
  FROM public.staff_profiles
  WHERE barbershop_id = p_barbershop_id AND user_id = v_user_id
  LIMIT 1;

  -- 7. Se existir: retornar o registro; não duplicar
  IF FOUND THEN
    SELECT jsonb_build_object(
      'id', v_staff.id,
      'barbershop_id', v_staff.barbershop_id,
      'user_id', v_staff.user_id,
      'name', v_staff.name,
      'phone', v_staff.phone,
      'photo', v_staff.photo,
      'commission_rate', v_staff.commission_rate,
      'status', v_staff.status,
      'role', 'owner'
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- 5. Buscar profile global próprio
  SELECT name, personal_phone, photo
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;

  -- 8. Se não existir: inserir com comissão 100%
  INSERT INTO public.staff_profiles (
    barbershop_id,
    user_id,
    name,
    phone,
    photo,
    status,
    commission_rate
  ) VALUES (
    p_barbershop_id,
    v_user_id,
    COALESCE(NULLIF(trim(v_profile.name), ''), 'Proprietário'),
    v_profile.personal_phone,
    v_profile.photo,
    'active',
    100
  )
  RETURNING id, barbershop_id, user_id, name, phone, photo, commission_rate, status
  INTO v_staff;

  -- 9. Retornar dados mínimos do staff_profile
  SELECT jsonb_build_object(
    'id', v_staff.id,
    'barbershop_id', v_staff.barbershop_id,
    'user_id', v_staff.user_id,
    'name', v_staff.name,
    'phone', v_staff.phone,
    'photo', v_staff.photo,
    'commission_rate', v_staff.commission_rate,
    'status', v_staff.status,
    'role', 'owner'
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 13. Revogar EXECUTE de PUBLIC e anon
REVOKE ALL ON FUNCTION public.ensure_owner_staff_profile(uuid) FROM PUBLIC, anon;

-- 14. Conceder EXECUTE apenas para authenticated
GRANT EXECUTE ON FUNCTION public.ensure_owner_staff_profile(uuid) TO authenticated;

-- 6. Atualizar trigger handle_new_barbershop para garantir comissão 100% no staff inicial do owner
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
  ON CONFLICT (barbershop_id, user_id) DO UPDATE SET role = 'owner';

  -- 2. Busca dados de perfil do owner
  SELECT name, personal_phone, photo INTO v_name, v_phone, v_photo
  FROM public.profiles
  WHERE id = NEW.owner_id;

  -- 3. Cria staff_profile para o owner de forma idempotente
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles 
    WHERE barbershop_id = NEW.id AND user_id = NEW.owner_id
  ) THEN
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
      COALESCE(NULLIF(trim(v_name), ''), NEW.name, 'Proprietário'),
      v_phone,
      v_photo,
      'active',
      100
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_barbershop() FROM PUBLIC, anon, authenticated;
