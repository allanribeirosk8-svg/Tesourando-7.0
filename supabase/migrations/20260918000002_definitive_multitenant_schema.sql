-- ==============================================================================
-- MIGRATION: 20260918000002_definitive_multitenant_schema.sql
-- OBJETIVO: Consolidação da arquitetura definitiva multi-tenant e multi-staff.
-- - Remove travas e constraints temporárias globais que impediam múltiplos tenants por usuário.
-- - Garante unicidade parcial de staff_profiles (barbershop_id, user_id).
-- - Refatora políticas RLS para isolamento exclusivo por barbershop_id.
-- - Preserva a proteção contra recursão infinita 42P17 com funções SECURITY DEFINER.
-- ==============================================================================

-- 1. REMOVER CONSTRAINTS E ÍNDICES TEMPORÁRIOS GLOBAIS
DROP INDEX IF EXISTS public.uq_barbershop_members_one_shop_per_user;
DROP INDEX IF EXISTS public.uq_barbershop_members_active_user;
DROP INDEX IF EXISTS public.uq_barbershops_one_owner;
DROP INDEX IF EXISTS public.uq_barbershops_single_owner;

ALTER TABLE IF EXISTS public.barbershop_members DROP CONSTRAINT IF EXISTS uq_barbershop_members_one_shop_per_user;
ALTER TABLE IF EXISTS public.barbershops DROP CONSTRAINT IF EXISTS uq_barbershops_one_owner;

-- 2. GARANTIR ESTRUTURA E CONSTRAINTS CORRETAS EM barbershop_members
-- PK (barbershop_id, user_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barbershop_members_pkey' AND conrelid = 'public.barbershop_members'::regclass
  ) THEN
    ALTER TABLE public.barbershop_members ADD PRIMARY KEY (barbershop_id, user_id);
  END IF;
END $$;

-- Garantir check de role estrito: owner, admin, staff (sem 'admin_owner')
ALTER TABLE public.barbershop_members DROP CONSTRAINT IF EXISTS barbershop_members_role_check;
ALTER TABLE public.barbershop_members 
  ADD CONSTRAINT barbershop_members_role_check 
  CHECK (role IN ('owner', 'admin', 'staff'));

-- 3. GARANTIR ÍNDICE ÚNICO PARCIAL EM staff_profiles
-- Um usuário só pode ter um registro de staff por barbearia
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_profiles_barbershop_user 
  ON public.staff_profiles (barbershop_id, user_id) 
  WHERE user_id IS NOT NULL;

-- 4. FUNÇÕES DE SUPORTE SECURITY DEFINER (ANTIRRECURSÃO 42P17)
CREATE OR REPLACE FUNCTION public.get_user_barbershop_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT barbershop_id
  FROM public.barbershop_members
  WHERE user_id = auth.uid()
  UNION
  SELECT id AS barbershop_id
  FROM public.barbershops
  WHERE owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_owned_barbershop_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id AS barbershop_id
  FROM public.barbershops
  WHERE owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_admin_barbershop_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT barbershop_id
  FROM public.barbershop_members
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  UNION
  SELECT id AS barbershop_id
  FROM public.barbershops
  WHERE owner_id = auth.uid();
$$;

-- 5. RLS POLICIES DEFINITIVAS COM ISOLAMENTO RIGOROSO POR barbershop_id

-- 5.1 Barbearias (barbershops)
ALTER TABLE public.barbershops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "barbershops_select" ON public.barbershops;
DROP POLICY IF EXISTS "barbershops_insert" ON public.barbershops;
DROP POLICY IF EXISTS "barbershops_update" ON public.barbershops;
DROP POLICY IF EXISTS "barbershops_delete" ON public.barbershops;

CREATE POLICY "barbershops_select" ON public.barbershops
  FOR SELECT USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "barbershops_insert" ON public.barbershops
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
  );

CREATE POLICY "barbershops_update" ON public.barbershops
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "barbershops_delete" ON public.barbershops
  FOR DELETE USING (
    owner_id = auth.uid()
  );

-- 5.2 Membros da Barbearia (barbershop_members)
ALTER TABLE public.barbershop_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "barbershop_members_select" ON public.barbershop_members;
DROP POLICY IF EXISTS "barbershop_members_insert" ON public.barbershop_members;
DROP POLICY IF EXISTS "barbershop_members_update" ON public.barbershop_members;
DROP POLICY IF EXISTS "barbershop_members_delete" ON public.barbershop_members;

CREATE POLICY "barbershop_members_select" ON public.barbershop_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "barbershop_members_insert" ON public.barbershop_members
  FOR INSERT WITH CHECK (
    -- Permite se for o dono da barbearia criando sua membership
    (user_id = auth.uid() AND barbershop_id IN (SELECT public.get_owned_barbershop_ids()))
    -- Ou se for owner/admin da barbearia adicionando membros
    OR barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "barbershop_members_update" ON public.barbershop_members
  FOR UPDATE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "barbershop_members_delete" ON public.barbershop_members
  FOR DELETE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.3 Perfis de Profissionais (staff_profiles)
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_profiles_select" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_insert" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_update" ON public.staff_profiles;
DROP POLICY IF EXISTS "staff_profiles_delete" ON public.staff_profiles;

CREATE POLICY "staff_profiles_select" ON public.staff_profiles
  FOR SELECT USING (
    user_id = auth.uid()
    OR barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "staff_profiles_insert" ON public.staff_profiles
  FOR INSERT WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (user_id = auth.uid() AND barbershop_id IN (SELECT public.get_user_barbershop_ids()))
  );

CREATE POLICY "staff_profiles_update" ON public.staff_profiles
  FOR UPDATE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR user_id = auth.uid()
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR user_id = auth.uid()
  );

CREATE POLICY "staff_profiles_delete" ON public.staff_profiles
  FOR DELETE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.4 Agendamentos (appointments)
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "appointments_select_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_insert_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_update_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_delete_policy" ON public.appointments;
DROP POLICY IF EXISTS "apts_select" ON public.appointments;
DROP POLICY IF EXISTS "apts_insert" ON public.appointments;
DROP POLICY IF EXISTS "apts_update" ON public.appointments;
DROP POLICY IF EXISTS "apts_delete" ON public.appointments;

CREATE POLICY "apts_select" ON public.appointments
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "apts_insert" ON public.appointments
  FOR INSERT WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "apts_update" ON public.appointments
  FOR UPDATE USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "apts_delete" ON public.appointments
  FOR DELETE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.5 Transações (transactions)
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_select_policy" ON public.transactions;
DROP POLICY IF EXISTS "transactions_insert_policy" ON public.transactions;
DROP POLICY IF EXISTS "transactions_update_policy" ON public.transactions;
DROP POLICY IF EXISTS "transactions_delete_policy" ON public.transactions;

CREATE POLICY "transactions_select_policy" ON public.transactions
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "transactions_insert_policy" ON public.transactions
  FOR INSERT WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "transactions_update_policy" ON public.transactions
  FOR UPDATE USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "transactions_delete_policy" ON public.transactions
  FOR DELETE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.6 Clientes (customers)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_select_policy" ON public.customers;
DROP POLICY IF EXISTS "customers_insert_policy" ON public.customers;
DROP POLICY IF EXISTS "customers_update_policy" ON public.customers;
DROP POLICY IF EXISTS "customers_delete_policy" ON public.customers;

CREATE POLICY "customers_select_policy" ON public.customers
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customers_insert_policy" ON public.customers
  FOR INSERT WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customers_update_policy" ON public.customers
  FOR UPDATE USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customers_delete_policy" ON public.customers
  FOR DELETE USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.7 Serviços (services)
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "services_select_policy" ON public.services;
DROP POLICY IF EXISTS "services_manage_policy" ON public.services;

CREATE POLICY "services_select_policy" ON public.services
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR barbershop_id IS NULL -- Para rotas públicas de agendamento se aplicável
  );

CREATE POLICY "services_manage_policy" ON public.services
  FOR ALL USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.8 Agenda Semanal e Pausas (weekly_schedule e weekly_breaks)
ALTER TABLE public.weekly_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_schedule_select_policy" ON public.weekly_schedule;
DROP POLICY IF EXISTS "weekly_schedule_manage_policy" ON public.weekly_schedule;

CREATE POLICY "weekly_schedule_select_policy" ON public.weekly_schedule
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR barbershop_id IS NULL
  );

CREATE POLICY "weekly_schedule_manage_policy" ON public.weekly_schedule
  FOR ALL USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

ALTER TABLE public.weekly_breaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "weekly_breaks_select_policy" ON public.weekly_breaks;
DROP POLICY IF EXISTS "weekly_breaks_manage_policy" ON public.weekly_breaks;

CREATE POLICY "weekly_breaks_select_policy" ON public.weekly_breaks
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR barbershop_id IS NULL
  );

CREATE POLICY "weekly_breaks_manage_policy" ON public.weekly_breaks
  FOR ALL USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 5.9 Slots Bloqueados e Desbloqueados
ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blocked_slots_select_policy" ON public.blocked_slots;
DROP POLICY IF EXISTS "blocked_slots_manage_policy" ON public.blocked_slots;

CREATE POLICY "blocked_slots_select_policy" ON public.blocked_slots
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR barbershop_id IS NULL
  );

CREATE POLICY "blocked_slots_manage_policy" ON public.blocked_slots
  FOR ALL USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

ALTER TABLE public.unblocked_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "unblocked_slots_select_policy" ON public.unblocked_slots;
DROP POLICY IF EXISTS "unblocked_slots_manage_policy" ON public.unblocked_slots;

CREATE POLICY "unblocked_slots_select_policy" ON public.unblocked_slots
  FOR SELECT USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR barbershop_id IS NULL
  );

CREATE POLICY "unblocked_slots_manage_policy" ON public.unblocked_slots
  FOR ALL USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );
