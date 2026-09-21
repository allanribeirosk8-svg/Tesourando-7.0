-- ==============================================================================
-- MIGRATION: 20260918000002_definitive_multitenant_schema.sql
-- DESCRIÇÃO: Consolidação Definitiva do Modelo Multi-Tenant com Isolamento Rigoroso,
-- Purga Prévia de Policies Legadas, RLS Reforçado, Reconciliação Idempotente de Schema,
-- Bloqueio Estrito de Escrita Direta Não Autorizada e RPCs Atômicas com Advisory Locks.
-- IDEMPOTENTE: Seguro para execução pós-reset de teste ou atualização de schema.
-- ==============================================================================

-- 1. EXTENSÕES OBRIGATÓRIAS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. FUNÇÃO E GATILHO REUTILIZÁVEL PARA UPDATED_AT
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 3. FUNÇÕES AUXILIARES DE RESOLUÇÃO DE TENANT (SECURITY DEFINER)
-- Evitam recursão circular em RLS (erro 42P17)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_user_barbershop_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.barbershops WHERE owner_id = auth.uid()
  UNION
  SELECT barbershop_id FROM public.barbershop_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_owned_barbershop_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.barbershops WHERE owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_admin_barbershop_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.barbershops WHERE owner_id = auth.uid()
  UNION
  SELECT barbershop_id FROM public.barbershop_members 
  WHERE user_id = auth.uid() AND role IN ('owner', 'admin');
$$;

REVOKE ALL ON FUNCTION public.get_user_barbershop_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_barbershop_ids() TO authenticated;

REVOKE ALL ON FUNCTION public.get_owned_barbershop_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owned_barbershop_ids() TO authenticated;

REVOKE ALL ON FUNCTION public.get_admin_barbershop_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_barbershop_ids() TO authenticated;

-- ==============================================================================
-- 4. RECONCILIAÇÃO E CRIAÇÃO IDEMPOTENTE DE TABELAS E ESTRUTURAS
-- ==============================================================================

-- 4.1 Barbearias (barbershops)
CREATE TABLE IF NOT EXISTS public.barbershops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  phone text,
  address text,
  logo text,
  description text,
  instagram text,
  website text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_barbershops_slug UNIQUE (slug)
);

ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS instagram text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.barbershops ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_barbershops_updated_at ON public.barbershops;
CREATE TRIGGER trg_barbershops_updated_at
  BEFORE UPDATE ON public.barbershops
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4.2 Membros da Barbearia (barbershop_members)
CREATE TABLE IF NOT EXISTS public.barbershop_members (
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (barbershop_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'barbershop_members_role_check'
  ) THEN
    ALTER TABLE public.barbershop_members ADD CONSTRAINT barbershop_members_role_check CHECK (role IN ('owner', 'admin', 'staff'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4.3 Perfis de Profissionais (staff_profiles)
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid,
  name text NOT NULL,
  phone text,
  photo text,
  commission_rate numeric NOT NULL DEFAULT 0 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reconciliação de colunas legadas e checks em staff_profiles
DO $$
BEGIN
  -- Se houver coluna tenant_id legada, migra para barbershop_id e remove tenant_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'staff_profiles' AND column_name = 'tenant_id'
  ) THEN
    UPDATE public.staff_profiles SET barbershop_id = tenant_id WHERE barbershop_id IS NULL;
    ALTER TABLE public.staff_profiles DROP COLUMN tenant_id;
  END IF;
END $$;

ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS barbershop_id uuid;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS commission_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_profiles_commission_check'
  ) THEN
    ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_commission_check CHECK (commission_rate >= 0 AND commission_rate <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_profiles_status_check'
  ) THEN
    ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_staff_profiles_updated_at ON public.staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated_at
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Unicidade estrita: um usuário só pode ter um perfil de profissional por barbearia
DROP INDEX IF EXISTS idx_staff_profiles_user_unique;
DROP INDEX IF EXISTS staff_profiles_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_profiles_barbershop_user
ON public.staff_profiles (barbershop_id, user_id)
WHERE user_id IS NOT NULL;

-- 4.4 Permissões Granulares de Membros (member_permissions)
CREATE TABLE IF NOT EXISTS public.member_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  permission_key text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_permissions ADD COLUMN IF NOT EXISTS barbershop_id uuid;
ALTER TABLE public.member_permissions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.member_permissions ADD COLUMN IF NOT EXISTS permission_key text;
ALTER TABLE public.member_permissions ADD COLUMN IF NOT EXISTS allowed boolean NOT NULL DEFAULT true;
ALTER TABLE public.member_permissions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'member_permissions' AND column_name = 'member_id'
  ) THEN
    ALTER TABLE public.member_permissions ALTER COLUMN member_id DROP NOT NULL;
  END IF;

  ALTER TABLE public.member_permissions DROP CONSTRAINT IF EXISTS member_permissions_member_fkey;
  ALTER TABLE public.member_permissions DROP CONSTRAINT IF EXISTS uq_member_permissions_key;
  ALTER TABLE public.member_permissions DROP CONSTRAINT IF EXISTS member_permissions_barbershop_id_user_id_permission_key_key;

  ALTER TABLE public.member_permissions 
    ADD CONSTRAINT member_permissions_member_fkey 
    FOREIGN KEY (barbershop_id, user_id) 
    REFERENCES public.barbershop_members(barbershop_id, user_id) 
    ON DELETE CASCADE;

  ALTER TABLE public.member_permissions 
    ADD CONSTRAINT uq_member_permissions_key 
    UNIQUE (barbershop_id, user_id, permission_key);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Ajuste de constraints em member_permissions concluído ou já existente: %', SQLERRM;
END $$;

-- 4.5 Serviços (services)
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  duration integer NOT NULL CHECK (duration > 0),
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.6 Grade Semanal (weekly_schedule)
CREATE TABLE IF NOT EXISTS public.weekly_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_weekly_schedule_tenant_day UNIQUE (barbershop_id, day_of_week)
);

-- 4.7 Pausas Semanais (weekly_breaks)
CREATE TABLE IF NOT EXISTS public.weekly_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time time,
  start_time time,
  end_time time,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.8 Bloqueios e Desbloqueios de Horários
CREATE TABLE IF NOT EXISTS public.blocked_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  time text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.blocked_slots ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.unblocked_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  time text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.unblocked_slots ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE;

-- 4.9 Clientes (customers)
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid,
  name text NOT NULL,
  phone text NOT NULL,
  notes text,
  cut_count integer NOT NULL DEFAULT 0,
  no_show_count integer NOT NULL DEFAULT 0,
  total_visits integer NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  last_visit timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_customers_tenant_phone UNIQUE (barbershop_id, phone)
);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS cut_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS no_show_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_visits integer NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_spent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_visit timestamptz;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4.10 Agendamentos (appointments)
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid,
  staff_id uuid REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  phone text NOT NULL,
  service text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  duration integer NOT NULL DEFAULT 30,
  date date NOT NULL,
  time time NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no-show')),
  observation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_check'
  ) THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no-show'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4.11 Transações Financeiras (transactions)
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid,
  description text NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  category text,
  date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.12 Notificações (notifications)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id uuid,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.13 Fotos de Clientes (customer_photos)
CREATE TABLE IF NOT EXISTS public.customer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.14 Convites (barbershop_invites)
CREATE TABLE IF NOT EXISTS public.barbershop_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- 5. ÍNDICES DE PERFORMANCE E CONTROLE DE CONCORRÊNCIA
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_barbershops_owner_id ON public.barbershops(owner_id);
CREATE INDEX IF NOT EXISTS idx_barbershops_slug ON public.barbershops(slug);
CREATE INDEX IF NOT EXISTS idx_members_user_id ON public.barbershop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_barbershop_id ON public.barbershop_members(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_barbershop ON public.staff_profiles(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_user ON public.staff_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_date ON public.appointments(barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_staff ON public.appointments(barbershop_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tenant ON public.transactions(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers(barbershop_id, phone);
CREATE INDEX IF NOT EXISTS idx_services_tenant ON public.services(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_tenant_date ON public.blocked_slots(barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_staff ON public.blocked_slots(staff_id);
CREATE INDEX IF NOT EXISTS idx_unblocked_slots_tenant_date ON public.unblocked_slots(barbershop_id, date);
CREATE INDEX IF NOT EXISTS idx_unblocked_slots_staff ON public.unblocked_slots(staff_id);
CREATE INDEX IF NOT EXISTS idx_member_permissions_tenant_user ON public.member_permissions(barbershop_id, user_id);

CREATE INDEX IF NOT EXISTS appointments_booking_conflict_idx
ON public.appointments (barbershop_id, date, staff_id, time)
WHERE status NOT IN ('cancelled', 'no-show');

-- ==============================================================================
-- 6. PURGA TOTAL DE TODAS AS POLICIES EXISTENTES EM TODAS AS TABELAS-ALVO
-- Garante que nenhuma policy legada permaneça por nome desconhecido
-- ==============================================================================
DO $$
DECLARE
  pol record;
  target_tables text[] := ARRAY[
    'barbershops',
    'barbershop_members',
    'staff_profiles',
    'member_permissions',
    'customers',
    'customer_photos',
    'services',
    'weekly_schedule',
    'weekly_breaks',
    'blocked_slots',
    'unblocked_slots',
    'appointments',
    'transactions',
    'notifications',
    'barbershop_invites'
  ];
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, tbl);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ==============================================================================
-- 7. RLS POLICIES FINAIS E BLINDADAS POR TABELA
-- ==============================================================================

-- 7.1 Barbearias (barbershops)
-- UPDATE DIRETO BLOQUEADO: atualizações ocorrem exclusivamente via RPC update_barbershop_profile
ALTER TABLE public.barbershops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barbershops_select" ON public.barbershops
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "barbershops_insert" ON public.barbershops
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
  );

CREATE POLICY "barbershops_delete" ON public.barbershops
  FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
  );

-- 7.2 Membros da Barbearia (barbershop_members)
-- ESCRITA DIRETA BLOQUEADA: Modificações apenas via Edge Functions/RPCs autenticadas
ALTER TABLE public.barbershop_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barbershop_members_select" ON public.barbershop_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.3 Perfis de Profissionais (staff_profiles)
-- ESCRITA DIRETA BLOQUEADA: apenas SELECT para authenticated.
-- Modificações via create-staff, update_my_staff_profile e update_staff_profile_by_admin_owner
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_profiles_select" ON public.staff_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

-- 7.4 Permissões Granulares de Membros (member_permissions)
ALTER TABLE public.member_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_permissions_select" ON public.member_permissions
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "member_permissions_insert" ON public.member_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "member_permissions_update" ON public.member_permissions
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "member_permissions_delete" ON public.member_permissions
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.5 Clientes (customers)
-- Staff comum tem apenas SELECT (cadastros via create_or_update_customer_basic e notas via update_customer_notes).
-- Owner/Admin têm acesso total de manutenção
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "customers_delete" ON public.customers
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.6 Fotos de Clientes (customer_photos)
ALTER TABLE public.customer_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_photos_select" ON public.customer_photos
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customer_photos_insert" ON public.customer_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customer_photos_update" ON public.customer_photos
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "customer_photos_delete" ON public.customer_photos
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.7 Serviços (services)
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_select" ON public.services
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "services_insert" ON public.services
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "services_update" ON public.services
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "services_delete" ON public.services
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.8 Grade Semanal e Pausas (weekly_schedule e weekly_breaks)
ALTER TABLE public.weekly_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_schedule_select" ON public.weekly_schedule
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "weekly_schedule_insert" ON public.weekly_schedule
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "weekly_schedule_update" ON public.weekly_schedule
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "weekly_schedule_delete" ON public.weekly_schedule
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

ALTER TABLE public.weekly_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_breaks_select" ON public.weekly_breaks
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "weekly_breaks_insert" ON public.weekly_breaks
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "weekly_breaks_update" ON public.weekly_breaks
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "weekly_breaks_delete" ON public.weekly_breaks
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.9 Bloqueios e Desbloqueios de Horários (blocked_slots e unblocked_slots)
-- Escopo estrito: staff gerencia apenas slots com seu próprio staff_id ativo
ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocked_slots_select" ON public.blocked_slots
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "blocked_slots_insert" ON public.blocked_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = blocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

CREATE POLICY "blocked_slots_update" ON public.blocked_slots
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = blocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = blocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

CREATE POLICY "blocked_slots_delete" ON public.blocked_slots
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = blocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

ALTER TABLE public.unblocked_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unblocked_slots_select" ON public.unblocked_slots
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "unblocked_slots_insert" ON public.unblocked_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = unblocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

CREATE POLICY "unblocked_slots_update" ON public.unblocked_slots
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = unblocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = unblocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

CREATE POLICY "unblocked_slots_delete" ON public.unblocked_slots
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR (
      barbershop_id IN (SELECT public.get_user_barbershop_ids())
      AND staff_id IS NOT NULL
      AND staff_id IN (
        SELECT sp.id FROM public.staff_profiles sp
        WHERE sp.barbershop_id = unblocked_slots.barbershop_id
          AND sp.user_id = auth.uid()
          AND sp.status = 'active'
      )
    )
  );

-- 7.10 Agendamentos (appointments)
-- DECISÃO DE PRODUTO DOCUMENTADA:
-- - appointments_select (Opção B): Membros autenticados leem a grade completa do seu tenant para permitir
--   coordenação física da equipe, encaixes e recepção de clientes na barbearia.
-- - appointments_insert: Somente Owner/Admin direto. Staff cria via create_my_appointment.
-- - appointments_update: SOMENTE Owner/Admin direto. Staff NÃO TEM UPDATE DIRETO e deve usar
--   as RPCs whitelisted (complete_my_appointment, mark_my_appointment_no_show, update_my_appointment_observation).
-- - appointments_delete: Somente Owner/Admin direto.
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "appointments_insert" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "appointments_update" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "appointments_delete" ON public.appointments
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.11 Transações Financeiras (transactions)
-- Restrito exclusivamente a Owner e Admin. Staff comum NÃO tem acesso.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_select" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "transactions_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "transactions_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "transactions_delete" ON public.transactions
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- 7.12 Notificações (notifications)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR user_id = auth.uid()
  );

CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
  );

CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR user_id = auth.uid()
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_user_barbershop_ids())
    OR user_id = auth.uid()
  );

CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR user_id = auth.uid()
  );

-- 7.13 Convites (barbershop_invites)
ALTER TABLE public.barbershop_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barbershop_invites_select" ON public.barbershop_invites
  FOR SELECT TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "barbershop_invites_insert" ON public.barbershop_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "barbershop_invites_update" ON public.barbershop_invites
  FOR UPDATE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  ) WITH CHECK (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

CREATE POLICY "barbershop_invites_delete" ON public.barbershop_invites
  FOR DELETE TO authenticated
  USING (
    barbershop_id IN (SELECT public.get_admin_barbershop_ids())
  );

-- ==============================================================================
-- 8. RPCs DE AUTORIZAÇÃO, WHITELISTS E SEGURANÇA OPERACIONAL (SECURITY DEFINER)
-- ==============================================================================

-- 8.1 Atualizar Barbearia via RPC (Whitelist segura: name, phone, address, logo, description, instagram, website)
CREATE OR REPLACE FUNCTION public.update_barbershop_profile(
  p_barbershop_id uuid,
  p_name text,
  p_phone text,
  p_address text,
  p_logo text,
  p_description text,
  p_instagram text,
  p_website text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_authorized boolean := false;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT true INTO v_is_authorized
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id
    AND (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin'));

  IF NOT coalesce(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem alterar os dados da barbearia.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.barbershops
  SET
    name = coalesce(trim(p_name), name),
    phone = coalesce(trim(p_phone), phone),
    address = p_address,
    logo = p_logo,
    description = p_description,
    instagram = p_instagram,
    website = p_website,
    updated_at = now()
  WHERE id = p_barbershop_id
  RETURNING id, name, slug, phone, address, logo, description, instagram, website, owner_id INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.update_barbershop_profile(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_barbershop_profile(uuid, text, text, text, text, text, text, text) TO authenticated;

-- 8.2 Atualizar Meu Perfil de Staff (Whitelist: name, phone, photo)
CREATE OR REPLACE FUNCTION public.update_my_staff_profile(
  p_barbershop_id uuid,
  p_name text,
  p_phone text,
  p_photo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_staff_id
  FROM public.staff_profiles
  WHERE barbershop_id = p_barbershop_id
    AND user_id = auth.uid()
    AND status = 'active';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Perfil de profissional não localizado ou inativo neste estabelecimento' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.staff_profiles
  SET 
    name = coalesce(trim(p_name), name),
    phone = coalesce(trim(p_phone), phone),
    photo = p_photo,
    updated_at = now()
  WHERE id = v_staff_id
  RETURNING id, barbershop_id, user_id, name, phone, photo, status, commission_rate INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_staff_profile(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_staff_profile(uuid, text, text, text) TO authenticated;

-- 8.3 Atualizar Perfil de Profissional por Admin/Owner
CREATE OR REPLACE FUNCTION public.update_staff_profile_by_admin_owner(
  p_barbershop_id uuid,
  p_staff_profile_id uuid,
  p_name text,
  p_phone text,
  p_photo text,
  p_commission_rate numeric,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner boolean;
  v_is_admin boolean;
  v_target_user_id uuid;
  v_barbershop_owner_id uuid;
  v_updated record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid()), (m.role = 'admin'), b.owner_id
  INTO v_is_owner, v_is_admin, v_barbershop_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_is_admin, false) = false THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem gerenciar profissionais.' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_user_id = v_barbershop_owner_id AND coalesce(v_is_owner, false) = false THEN
    RAISE EXCEPTION 'Apenas o próprio proprietário pode alterar seu perfil de profissional.' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'inactive' AND v_target_user_id = v_barbershop_owner_id THEN
    RAISE EXCEPTION 'O proprietário da barbearia não pode ser inativado.' USING ERRCODE = '22023';
  END IF;

  IF p_commission_rate < 0 OR p_commission_rate > 100 THEN
    RAISE EXCEPTION 'Taxa de comissão inválida (deve estar entre 0 e 100).' USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Status inválido. Permitido: active ou inactive.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_profiles
  SET
    name = coalesce(trim(p_name), name),
    phone = coalesce(trim(p_phone), phone),
    photo = p_photo,
    commission_rate = p_commission_rate,
    status = p_status,
    updated_at = now()
  WHERE id = p_staff_profile_id
  RETURNING id, barbershop_id, user_id, name, phone, photo, status, commission_rate INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;
REVOKE ALL ON FUNCTION public.update_staff_profile_by_admin_owner(uuid, uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_profile_by_admin_owner(uuid, uuid, text, text, text, numeric, text) TO authenticated;

-- 8.4 Remover Profissional do Estabelecimento
CREATE OR REPLACE FUNCTION public.remove_staff_from_barbershop(
  p_barbershop_id uuid,
  p_staff_profile_id uuid,
  p_staff_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_authorized boolean := false;
  v_owner_id uuid;
  v_resolved_user_id uuid := p_staff_user_id;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin')), b.owner_id
  INTO v_is_authorized, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF NOT coalesce(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem remover membros.' USING ERRCODE = '42501';
  END IF;

  IF v_resolved_user_id IS NULL THEN
    SELECT user_id INTO v_resolved_user_id
    FROM public.staff_profiles
    WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;
  END IF;

  IF v_resolved_user_id = v_owner_id THEN
    RAISE EXCEPTION 'Não é permitido remover o proprietário da barbearia.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.staff_profiles
  SET status = 'inactive', updated_at = now()
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF v_resolved_user_id IS NOT NULL THEN
    DELETE FROM public.barbershop_members
    WHERE barbershop_id = p_barbershop_id AND user_id = v_resolved_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_staff_from_barbershop(uuid, uuid, uuid) TO authenticated;

-- 8.5 Reativar Profissional no Estabelecimento
CREATE OR REPLACE FUNCTION public.reactivate_staff(
  p_barbershop_id uuid,
  p_staff_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_authorized boolean := false;
  v_target_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin'))
  INTO v_is_authorized
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF NOT coalesce(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.staff_profiles
  WHERE id = p_staff_profile_id AND barbershop_id = p_barbershop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.staff_profiles
  SET status = 'active', updated_at = now()
  WHERE id = p_staff_profile_id;

  IF v_target_user_id IS NOT NULL THEN
    INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
    VALUES (p_barbershop_id, v_target_user_id, 'staff')
    ON CONFLICT (barbershop_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reactivate_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_staff(uuid, uuid) TO authenticated;

-- 8.6 Criar ou Atualizar Dados Básicos do Cliente por Membro da Barbearia
-- Staff atualiza NOME e TELEFONE. Nunca mexe em cut_count, no_show_count, total_visits, total_spent.
CREATE OR REPLACE FUNCTION public.create_or_update_customer_basic(
  p_barbershop_id uuid,
  p_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean_name text := trim(p_name);
  v_clean_phone text := regexp_replace(p_phone, '\D', '', 'g');
  v_is_member boolean;
  v_customer record;
  v_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid() OR m.user_id IS NOT NULL), b.owner_id
  INTO v_is_member, v_owner_id
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF NOT coalesce(v_is_member, false) THEN
    RAISE EXCEPTION 'Acesso negado: você não é membro desta barbearia.' USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_name) < 3 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nome deve ter entre 3 e 80 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone deve ter 10 ou 11 dígitos com DDD.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE barbershop_id = p_barbershop_id AND phone = v_clean_phone;

  IF FOUND THEN
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer.id
    RETURNING * INTO v_customer;
  ELSE
    INSERT INTO public.customers (barbershop_id, user_id, name, phone, cut_count, no_show_count, total_visits, total_spent)
    VALUES (p_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0, 0, 0, 0)
    RETURNING * INTO v_customer;
  END IF;

  RETURN to_jsonb(v_customer);
END;
$$;
REVOKE ALL ON FUNCTION public.create_or_update_customer_basic(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_update_customer_basic(uuid, text, text) TO authenticated;

-- 8.7 Atualizar Observações do Cliente por Membro da Barbearia
CREATE OR REPLACE FUNCTION public.update_customer_notes(
  p_barbershop_id uuid,
  p_customer_id uuid,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_member boolean;
  v_customer record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid() OR m.user_id IS NOT NULL)
  INTO v_is_member
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF NOT coalesce(v_is_member, false) THEN
    RAISE EXCEPTION 'Acesso negado: você não é membro desta barbearia.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.customers
  SET notes = p_notes, updated_at = now()
  WHERE id = p_customer_id AND barbershop_id = p_barbershop_id
  RETURNING * INTO v_customer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_customer);
END;
$$;
REVOKE ALL ON FUNCTION public.update_customer_notes(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_customer_notes(uuid, uuid, text) TO authenticated;

-- 8.8 Criar Agendamento Interno por Staff (create_my_appointment)
-- Validação estrita de disponibilidade, limites de entrada, pausas, bloqueios, desbloqueios e advisory lock
CREATE OR REPLACE FUNCTION public.create_my_appointment(
  p_barbershop_id uuid,
  p_client_name text,
  p_client_phone text,
  p_service_ids uuid[],
  p_date date,
  p_time time,
  p_observation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff_id uuid;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_slot_end_time time;
  v_conflict_count int;
  v_customer_id uuid;
  v_new_apt record;
  v_owner_id uuid;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
  v_day_of_week int;
  v_sched_start time;
  v_sched_end time;
  v_is_open boolean;
  v_is_unblocked boolean := false;
  v_has_break_conflict boolean := false;
  v_has_block_conflict boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- 1. Resolver perfil de profissional ativo do chamador
  SELECT sp.id, b.owner_id
  INTO v_staff_id, v_owner_id
  FROM public.barbershops b
  JOIN public.staff_profiles sp ON sp.barbershop_id = b.id
  WHERE b.id = p_barbershop_id
    AND sp.user_id = auth.uid()
    AND sp.status = 'active';

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'Perfil de profissional ativo não encontrado para este usuário no estabelecimento.' USING ERRCODE = '42501';
  END IF;

  -- 2. Validação estrita de limites de entrada
  IF length(v_clean_name) < 3 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 3 e 80 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone do cliente deve conter 10 ou 11 dígitos com DDD.' USING ERRCODE = '22023';
  END IF;

  IF v_clean_obs IS NOT NULL AND length(v_clean_obs) > 500 THEN
    RAISE EXCEPTION 'Observação excede o limite máximo de 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- 3. Validação estrita de datas
  IF p_date < current_date THEN
    RAISE EXCEPTION 'Data do agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_date = current_date THEN
    IF p_time <= ((now() AT TIME ZONE 'America/Sao_Paulo')::time + interval '10 minutes') THEN
      RAISE EXCEPTION 'Horário solicitado já expirou para a data de hoje.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_date > (current_date + interval '180 days') THEN
    RAISE EXCEPTION 'Data do agendamento não pode exceder 180 dias no futuro.' USING ERRCODE = '22023';
  END IF;

  -- 4. Validar serviços e calcular preço/duração no servidor
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 10 serviços válidos.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = p_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 THEN
    v_total_duration := 30;
  END IF;

  v_slot_end_time := p_time + (v_total_duration || ' minutes')::interval;

  -- 5. Validar grade semanal de funcionamento e horário comercial
  v_day_of_week := extract(dow FROM p_date);

  SELECT is_open, start_time, end_time INTO v_is_open, v_sched_start, v_sched_end
  FROM public.weekly_schedule
  WHERE barbershop_id = p_barbershop_id AND day_of_week = v_day_of_week;

  IF coalesce(v_is_open, false) = false THEN
    RAISE EXCEPTION 'A barbearia não está aberta para atendimento nesta data.' USING ERRCODE = '22023';
  END IF;

  IF p_time < v_sched_start OR v_slot_end_time > v_sched_end THEN
    RAISE EXCEPTION 'Horário solicitado está fora do expediente de funcionamento da barbearia.' USING ERRCODE = '22023';
  END IF;

  -- 6. Verificar se o horário está explicitamente desbloqueado (unblocked_slots)
  SELECT true INTO v_is_unblocked
  FROM public.unblocked_slots
  WHERE barbershop_id = p_barbershop_id
    AND date = p_date
    AND (staff_id = v_staff_id OR staff_id IS NULL)
    AND substring(time from 1 for 5) = to_char(p_time, 'HH24:MI')
  LIMIT 1;

  -- 7. Se não estiver explicitamente desbloqueado, verificar pausas e bloqueios
  IF coalesce(v_is_unblocked, false) = false THEN
    -- Pausas semanais
    SELECT true INTO v_has_break_conflict
    FROM public.weekly_breaks
    WHERE barbershop_id = p_barbershop_id
      AND day_of_week = v_day_of_week
      AND (
        p_time < coalesce(end_time, (coalesce(start_time, time) + interval '30 minutes')::time)
        AND v_slot_end_time > coalesce(start_time, time)
      )
    LIMIT 1;

    IF coalesce(v_has_break_conflict, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo da barbearia.' USING ERRCODE = '23505';
    END IF;

    -- Bloqueios gerais e do profissional considerando sobreposição integral de intervalos
    SELECT true INTO v_has_block_conflict
    FROM public.blocked_slots
    WHERE barbershop_id = p_barbershop_id
      AND date = p_date
      AND (staff_id IS NULL OR staff_id = v_staff_id)
      AND (p_time < (time::time + interval '30 minutes') AND v_slot_end_time > time::time)
    LIMIT 1;

    IF coalesce(v_has_block_conflict, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado na agenda.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 8. Advisory Lock no profissional e data para serialização atômica
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_barbershop_id::text
      || ':' || p_date::text
      || ':' || v_staff_id::text,
      0
    )
  );

  -- 9. Rechecar conflito com agendamentos existentes do profissional sob lock
  SELECT count(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barbershop_id = p_barbershop_id
    AND staff_id = v_staff_id
    AND date = p_date
    AND status NOT IN ('cancelled', 'no-show')
    AND (p_time < (time + (duration || ' minutes')::interval))
    AND (v_slot_end_time > time);

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'SLOT_OCCUPIED: Você já possui outro atendimento agendado neste horário.' USING ERRCODE = '23505';
  END IF;

  -- 10. Upsert/Vinculação de cliente básico (sem resetar métricas)
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = p_barbershop_id AND phone = v_clean_phone;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (barbershop_id, user_id, name, phone, cut_count)
    VALUES (p_barbershop_id, v_owner_id, v_clean_name, v_clean_phone, 0)
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- 11. Inserir agendamento confirmado
  INSERT INTO public.appointments (
    barbershop_id,
    user_id,
    staff_id,
    client_name,
    phone,
    service,
    price,
    duration,
    date,
    time,
    status,
    observation
  ) VALUES (
    p_barbershop_id,
    v_owner_id,
    v_staff_id,
    v_clean_name,
    v_clean_phone,
    v_service_names,
    v_total_price,
    v_total_duration,
    p_date,
    p_time,
    'confirmed',
    v_clean_obs
  ) RETURNING * INTO v_new_apt;

  RETURN to_jsonb(v_new_apt);
END;
$$;
REVOKE ALL ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_appointment(uuid, text, text, uuid[], date, time, text) TO authenticated;

-- 8.9 Concluir Agendamento (complete_my_appointment)
CREATE OR REPLACE FUNCTION public.complete_my_appointment(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT a.*, (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin') OR sp.user_id = auth.uid()) AS authorized
  INTO v_apt
  FROM public.appointments a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = a.barbershop_id AND m.user_id = auth.uid()
  LEFT JOIN public.staff_profiles sp ON sp.id = a.staff_id
  WHERE a.id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(v_apt.authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado: você não tem permissão para concluir este agendamento.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.appointments
  SET status = 'completed', updated_at = now()
  WHERE id = p_appointment_id;

  UPDATE public.customers
  SET 
    cut_count = cut_count + 1,
    total_visits = total_visits + 1,
    total_spent = total_spent + coalesce(v_apt.price, 0),
    last_visit = now(),
    updated_at = now()
  WHERE barbershop_id = v_apt.barbershop_id AND phone = v_apt.phone;

  RETURN jsonb_build_object('success', true, 'status', 'completed');
END;
$$;
REVOKE ALL ON FUNCTION public.complete_my_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_appointment(uuid) TO authenticated;

-- 8.10 Marcar No-Show (mark_my_appointment_no_show)
CREATE OR REPLACE FUNCTION public.mark_my_appointment_no_show(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT a.*, (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin') OR sp.user_id = auth.uid()) AS authorized
  INTO v_apt
  FROM public.appointments a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = a.barbershop_id AND m.user_id = auth.uid()
  LEFT JOIN public.staff_profiles sp ON sp.id = a.staff_id
  WHERE a.id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(v_apt.authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.appointments
  SET status = 'no-show', updated_at = now()
  WHERE id = p_appointment_id;

  UPDATE public.customers
  SET 
    no_show_count = no_show_count + 1,
    updated_at = now()
  WHERE barbershop_id = v_apt.barbershop_id AND phone = v_apt.phone;

  RETURN jsonb_build_object('success', true, 'status', 'no-show');
END;
$$;
REVOKE ALL ON FUNCTION public.mark_my_appointment_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_appointment_no_show(uuid) TO authenticated;

-- 8.11 Atualizar Observação do Agendamento (update_my_appointment_observation)
CREATE OR REPLACE FUNCTION public.update_my_appointment_observation(
  p_appointment_id uuid,
  p_observation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_authorized boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid() OR m.role IN ('owner', 'admin') OR sp.user_id = auth.uid())
  INTO v_is_authorized
  FROM public.appointments a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = a.barbershop_id AND m.user_id = auth.uid()
  LEFT JOIN public.staff_profiles sp ON sp.id = a.staff_id
  WHERE a.id = p_appointment_id;

  IF NOT coalesce(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.appointments
  SET observation = p_observation, updated_at = now()
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_appointment_observation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_appointment_observation(uuid, text) TO authenticated;

-- 8.12 Alterar Papel de Membro (change_member_role)
CREATE OR REPLACE FUNCTION public.change_member_role(
  p_barbershop_id uuid,
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_is_owner boolean;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  IF p_new_role NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Papel inválido. Permitido apenas staff ou admin.' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() = p_target_user_id THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio papel.' USING ERRCODE = '42501';
  END IF;

  SELECT (b.owner_id = auth.uid()), m.role
  INTO v_is_owner, v_caller_role
  FROM public.barbershops b
  LEFT JOIN public.barbershop_members m ON m.barbershop_id = b.id AND m.user_id = auth.uid()
  WHERE b.id = p_barbershop_id;

  IF coalesce(v_is_owner, false) = false AND coalesce(v_caller_role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Acesso negado: apenas proprietários ou administradores podem alterar funções.' USING ERRCODE = '42501';
  END IF;

  IF coalesce(v_is_owner, false) = false AND v_caller_role = 'admin' AND p_new_role = 'admin' THEN
    RAISE EXCEPTION 'Apenas o proprietário pode nomear novos administradores.' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_target_role
  FROM public.barbershop_members
  WHERE barbershop_id = p_barbershop_id AND user_id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Membro alvo não encontrado nesta barbearia.' USING ERRCODE = 'P0002';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'O papel do proprietário não pode ser modificado.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.barbershop_members
  SET role = p_new_role
  WHERE barbershop_id = p_barbershop_id AND user_id = p_target_user_id;

  RETURN jsonb_build_object('success', true, 'new_role', p_new_role);
END;
$$;
REVOKE ALL ON FUNCTION public.change_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_member_role(uuid, uuid, text) TO authenticated;

-- ==============================================================================
-- 9. RPC DE BOOKING PÚBLICO COM ADVISORY LOCKS, SOBREPOSIÇÃO INTEGRAL E UNBLOCKED
-- (process_public_booking_atomic)
-- Executada exclusivamente via Edge Function com service_role
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.process_public_booking_atomic(
  p_slug text,
  p_client_name text,
  p_client_phone text,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_date date,
  p_time time,
  p_observation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_barbershop_id uuid;
  v_owner_id uuid;
  v_total_price numeric := 0;
  v_total_duration int := 0;
  v_service_names text;
  v_valid_services_count int;
  v_staff_name text;
  v_target_staff_id uuid := p_staff_id;
  v_customer_id uuid;
  v_new_appointment_id uuid;
  v_slot_end_time time;
  v_conflict_count int;
  v_day_of_week int;
  v_sched_start time;
  v_sched_end time;
  v_is_open boolean;
  v_clean_phone text := regexp_replace(p_client_phone, '\D', '', 'g');
  v_clean_name text := trim(p_client_name);
  v_clean_obs text := trim(p_observation);
  v_is_unblocked boolean := false;
  v_has_break_conflict boolean := false;
  v_has_general_block boolean := false;
BEGIN
  -- 1. Validação estrita de limites de entrada
  IF length(v_clean_name) < 3 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Nome do cliente deve ter entre 3 e 80 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_phone) NOT IN (10, 11) THEN
    RAISE EXCEPTION 'Telefone do cliente deve conter 10 ou 11 dígitos com DDD.' USING ERRCODE = '22023';
  END IF;

  IF v_clean_obs IS NOT NULL AND length(v_clean_obs) > 500 THEN
    RAISE EXCEPTION 'Observação excede o limite máximo de 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- 2. Validação estrita de datas
  IF p_date < current_date THEN
    RAISE EXCEPTION 'Data do agendamento não pode ser no passado.' USING ERRCODE = '22023';
  END IF;

  -- Validação de horário no mesmo dia (fuso horário de Brasília - America/Sao_Paulo)
  IF p_date = current_date THEN
    IF p_time <= ((now() AT TIME ZONE 'America/Sao_Paulo')::time + interval '10 minutes') THEN
      RAISE EXCEPTION 'Horário solicitado já expirou para a data de hoje.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_date > (current_date + interval '180 days') THEN
    RAISE EXCEPTION 'Data do agendamento não pode exceder o limite de 180 dias no futuro.' USING ERRCODE = '22023';
  END IF;

  -- 3. Resolver Tenant exclusivamente por slug
  SELECT id, owner_id INTO v_barbershop_id, v_owner_id
  FROM public.barbershops
  WHERE slug = lower(trim(p_slug));

  IF v_barbershop_id IS NULL THEN
    RAISE EXCEPTION 'Barbearia não encontrada para o link informado.' USING ERRCODE = 'P0002';
  END IF;

  -- 4. Validar quantidade e pertinência dos serviços do tenant
  IF p_service_ids IS NULL OR array_length(p_service_ids, 1) IS NULL OR array_length(p_service_ids, 1) < 1 OR array_length(p_service_ids, 1) > 10 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 10 serviços válidos.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), coalesce(sum(price), 0), coalesce(sum(duration), 0), string_agg(name, ' + ')
  INTO v_valid_services_count, v_total_price, v_total_duration, v_service_names
  FROM public.services
  WHERE barbershop_id = v_barbershop_id
    AND id = ANY(p_service_ids);

  IF v_valid_services_count <> array_length(p_service_ids, 1) THEN
    RAISE EXCEPTION 'Um ou mais serviços selecionados não pertencem a esta barbearia.' USING ERRCODE = '22023';
  END IF;

  IF v_total_duration <= 0 THEN
    v_total_duration := 30;
  END IF;

  v_slot_end_time := p_time + (v_total_duration || ' minutes')::interval;

  -- 5. Validar grade semanal de funcionamento e horário comercial
  v_day_of_week := extract(dow FROM p_date);

  SELECT is_open, start_time, end_time INTO v_is_open, v_sched_start, v_sched_end
  FROM public.weekly_schedule
  WHERE barbershop_id = v_barbershop_id AND day_of_week = v_day_of_week;

  IF coalesce(v_is_open, false) = false THEN
    RAISE EXCEPTION 'A barbearia não está aberta para atendimento neste dia da semana.' USING ERRCODE = '22023';
  END IF;

  IF p_time < v_sched_start OR v_slot_end_time > v_sched_end THEN
    RAISE EXCEPTION 'Horário solicitado está fora do expediente de funcionamento da barbearia.' USING ERRCODE = '22023';
  END IF;

  -- 6. Validar desbloqueio explícito do horário (unblocked_slots)
  SELECT true INTO v_is_unblocked
  FROM public.unblocked_slots
  WHERE barbershop_id = v_barbershop_id
    AND date = p_date
    AND (staff_id IS NULL OR (p_staff_id IS NOT NULL AND staff_id = p_staff_id))
    AND substring(time from 1 for 5) = to_char(p_time, 'HH24:MI')
  LIMIT 1;

  -- 7. Se não houver desbloqueio explícito, validar pausas e bloqueios gerais
  IF coalesce(v_is_unblocked, false) = false THEN
    -- Validar pausas semanais (breaks)
    SELECT true INTO v_has_break_conflict
    FROM public.weekly_breaks
    WHERE barbershop_id = v_barbershop_id
      AND day_of_week = v_day_of_week
      AND (
        p_time < coalesce(end_time, (coalesce(start_time, time) + interval '30 minutes')::time)
        AND v_slot_end_time > coalesce(start_time, time)
      )
    LIMIT 1;

    IF coalesce(v_has_break_conflict, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário coincide com período de intervalo da barbearia.' USING ERRCODE = '23505';
    END IF;

    -- Validar bloqueios gerais de data da barbearia (staff_id IS NULL) com sobreposição integral
    SELECT true INTO v_has_general_block
    FROM public.blocked_slots
    WHERE barbershop_id = v_barbershop_id
      AND date = p_date
      AND staff_id IS NULL
      AND (p_time < (time::time + interval '30 minutes') AND v_slot_end_time > time::time)
    LIMIT 1;

    IF coalesce(v_has_general_block, false) = true THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Horário bloqueado na agenda do estabelecimento.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 8. Validar e alocar profissional (Staff)
  IF p_staff_id IS NOT NULL THEN
    SELECT id, name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles
    WHERE id = p_staff_id
      AND barbershop_id = v_barbershop_id
      AND status = 'active';

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'O profissional selecionado não está ativo ou não pertence a esta barbearia.' USING ERRCODE = '22023';
    END IF;

    -- Se não estiver explicitamente desbloqueado, verificar bloqueio específico do profissional
    IF coalesce(v_is_unblocked, false) = false THEN
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots
        WHERE barbershop_id = v_barbershop_id
          AND date = p_date
          AND staff_id = v_target_staff_id
          AND (p_time < (time::time + interval '30 minutes') AND v_slot_end_time > time::time)
      ) THEN
        RAISE EXCEPTION 'SLOT_OCCUPIED: Profissional indisponível neste horário.' USING ERRCODE = '23505';
      END IF;
    END IF;
  ELSE
    -- "Qualquer profissional": alocar estritamente profissional ativo que esteja REALMENTE livre
    SELECT sp.id, sp.name INTO v_target_staff_id, v_staff_name
    FROM public.staff_profiles sp
    WHERE sp.barbershop_id = v_barbershop_id
      AND sp.status = 'active'
      -- Sem agendamentos conflitantes no intervalo
      AND NOT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.barbershop_id = v_barbershop_id
          AND a.staff_id = sp.id
          AND a.date = p_date
          AND a.status NOT IN ('cancelled', 'no-show')
          AND (p_time < (a.time + (a.duration || ' minutes')::interval))
          AND (v_slot_end_time > a.time)
      )
      -- Sem bloqueios de slot para este profissional (a menos que explicitamente desbloqueado)
      AND (
        EXISTS (
          SELECT 1 FROM public.unblocked_slots u
          WHERE u.barbershop_id = v_barbershop_id
            AND u.date = p_date
            AND (u.staff_id = sp.id OR u.staff_id IS NULL)
            AND substring(u.time from 1 for 5) = to_char(p_time, 'HH24:MI')
        )
        OR NOT EXISTS (
          SELECT 1 FROM public.blocked_slots b
          WHERE b.barbershop_id = v_barbershop_id
            AND b.staff_id = sp.id
            AND b.date = p_date
            AND (p_time < (b.time::time + interval '30 minutes') AND v_slot_end_time > b.time::time)
        )
      )
    ORDER BY sp.name ASC
    LIMIT 1;

    IF v_target_staff_id IS NULL THEN
      RAISE EXCEPTION 'SLOT_OCCUPIED: Nenhum profissional disponível neste horário.' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 9. ADVISORY LOCK TRANSACIONAL ANTI-RACE CONDITION
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      v_barbershop_id::text
      || ':' || p_date::text
      || ':' || v_target_staff_id::text,
      0
    )
  );

  -- 10. Re-verificação de conflito no slot sob lock
  SELECT count(*) INTO v_conflict_count
  FROM public.appointments
  WHERE barbershop_id = v_barbershop_id
    AND staff_id = v_target_staff_id
    AND date = p_date
    AND status NOT IN ('cancelled', 'no-show')
    AND (p_time < (time + (duration || ' minutes')::interval))
    AND (v_slot_end_time > time);

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'SLOT_OCCUPIED: Este horário acabou de ser reservado por outro cliente.' USING ERRCODE = '23505';
  END IF;

  -- 11. Upsert de Cliente (Customer)
  -- Semântica documentada: Se já existe pelo telefone, atualiza o nome com a versão mais recente informada,
  -- mantendo estritamente intactas todas as métricas históricas de visitas e cortes.
  SELECT id INTO v_customer_id
  FROM public.customers
  WHERE barbershop_id = v_barbershop_id AND phone = v_clean_phone
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (
      barbershop_id,
      user_id,
      name,
      phone,
      cut_count,
      no_show_count,
      total_visits,
      total_spent
    ) VALUES (
      v_barbershop_id,
      v_owner_id,
      v_clean_name,
      v_clean_phone,
      0,
      0,
      0,
      0
    ) RETURNING id INTO v_customer_id;
  ELSE
    UPDATE public.customers
    SET name = v_clean_name, updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  -- 12. Inserção Atômica do Agendamento
  INSERT INTO public.appointments (
    barbershop_id,
    user_id,
    staff_id,
    client_name,
    phone,
    service,
    price,
    duration,
    date,
    time,
    status,
    observation
  ) VALUES (
    v_barbershop_id,
    v_owner_id,
    v_target_staff_id,
    v_clean_name,
    v_clean_phone,
    v_service_names,
    v_total_price,
    v_total_duration,
    p_date,
    p_time,
    'pending',
    v_clean_obs
  ) RETURNING id INTO v_new_appointment_id;

  -- 13. Disparo de Notificação Operacional com Tratamento Auditável de Falha
  BEGIN
    INSERT INTO public.notifications (
      barbershop_id,
      user_id,
      type,
      title,
      body,
      data,
      read
    ) VALUES (
      v_barbershop_id,
      v_owner_id,
      'new_appointment',
      '📅 Novo agendamento online!',
      v_clean_name || ' agendou ' || v_service_names || ' às ' || to_char(p_time, 'HH24:MI'),
      jsonb_build_object('appointment_id', v_new_appointment_id, 'date', p_date, 'time', to_char(p_time, 'HH24:MI'), 'client_name', v_clean_name),
      false
    );
  EXCEPTION WHEN OTHERS THEN
    -- Alerta auditável no PostgreSQL para rastreamento operacional sem abortar o booking do cliente
    RAISE WARNING 'Falha ao registrar notificação para appointment % (Barbershop: %): %', v_new_appointment_id, v_barbershop_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'appointment_id', v_new_appointment_id,
    'barbershop_id', v_barbershop_id,
    'date', p_date,
    'time', to_char(p_time, 'HH24:MI'),
    'service_name', v_service_names,
    'client_name', v_clean_name,
    'staff_name', v_staff_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_public_booking_atomic(text, text, text, uuid[], uuid, date, time, text) TO service_role;
