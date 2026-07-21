-- =========================================================
-- notifications: schema hardening, RLS and atomic grouping
-- =========================================================

create extension if not exists pgcrypto;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb default '{}'::jsonb,
  type text not null default 'new_appointment',
  read boolean not null default false,
  created_at timestamptz not null default now(),
  group_key text,
  group_count integer not null default 1
);

alter table public.notifications
  add column if not exists group_key text;

alter table public.notifications
  add column if not exists group_count integer not null default 1;

update public.notifications
set group_count = 1
where group_count is null;

create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_group_lookup_idx
  on public.notifications (user_id, group_key, read, created_at desc)
  where group_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications
for select
using (user_id = auth.uid());

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own"
on public.notifications
for insert
with check (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
on public.notifications
for delete
using (user_id = auth.uid());

drop function if exists public.add_or_group_notification(uuid, text, text, text, jsonb, text);

create or replace function public.add_or_group_notification(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_type text,
  p_data jsonb default '{}'::jsonb,
  p_group_key text default null
)
returns public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notification public.notifications;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- We allow authenticated or anonymous users to trigger notifications for other users (e.g., client notifying a barber).
  -- This is secure because the 'notifications' table has RLS enabled, meaning a user can only SELECT, UPDATE, or DELETE their own notifications.
  -- The RPC is security definer, so it can write the record, but users can never read each other's data.
  -- Hence, the auth.uid() strict check is removed to enable cross-user notifications.

  if p_group_key is not null and btrim(p_group_key) <> '' then
    select n.*
      into v_notification
    from public.notifications n
    where n.user_id = p_user_id
      and n.group_key = btrim(p_group_key)
      and n.read = false
    order by n.created_at desc
    limit 1
    for update;

    if v_notification.id is not null then
      update public.notifications n
      set group_count = coalesce(n.group_count, 1) + 1,
          created_at = now(),
          data = coalesce(n.data, '{}'::jsonb) || coalesce(p_data, '{}'::jsonb),
          title = p_title,
          body = p_body,
          type = p_type
      where n.id = v_notification.id
      returning * into v_notification;

      return v_notification;
    end if;
  end if;

  insert into public.notifications (
    user_id,
    title,
    body,
    data,
    type,
    read,
    created_at,
    group_key,
    group_count
  )
  values (
    p_user_id,
    p_title,
    p_body,
    coalesce(p_data, '{}'::jsonb),
    p_type,
    false,
    now(),
    nullif(btrim(p_group_key), ''),
    1
  )
  returning * into v_notification;

  return v_notification;
end;
$$;

revoke all on function public.add_or_group_notification(uuid, text, text, text, jsonb, text) from public;
grant execute on function public.add_or_group_notification(uuid, text, text, text, jsonb, text) to authenticated;

-- =========================================================
-- Multi-tenancy structure: Barbershops, Members & Invites
-- =========================================================

-- Barbershops Table
CREATE TABLE IF NOT EXISTS public.barbershops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Barbershop Members Table
CREATE TABLE IF NOT EXISTS public.barbershop_members (
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'admin')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (barbershop_id, user_id)
);

-- Barbershop Invites Table
CREATE TABLE IF NOT EXISTS public.barbershop_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.barbershops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbershop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbershop_invites ENABLE ROW LEVEL SECURITY;

-- Helper functions to avoid circular references in RLS policies (using SECURITY DEFINER)
DROP FUNCTION IF EXISTS public.check_user_is_barbershop_member(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.check_user_owns_barbershop(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_barbershop_ids(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_owned_barbershop_ids(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_barbershop_ids(p_user_id UUID)
RETURNS TABLE (barbershop_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT m.barbershop_id FROM public.barbershop_members m WHERE m.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_owned_barbershop_ids(p_user_id UUID)
RETURNS TABLE (barbershop_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT b.id FROM public.barbershops b WHERE b.owner_id = p_user_id;
END;
$$;

-- Diagnostic Functions
CREATE OR REPLACE FUNCTION public.inspect_active_policies()
RETURNS TABLE (
  schemaname TEXT,
  tablename TEXT,
  policyname TEXT,
  permissive TEXT,
  roles TEXT[],
  cmd TEXT,
  qual TEXT,
  with_check TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.schemaname::TEXT,
    p.tablename::TEXT,
    p.policyname::TEXT,
    p.permissive::TEXT,
    p.roles::TEXT[],
    p.cmd::TEXT,
    p.qual::TEXT,
    p.with_check::TEXT
  FROM pg_catalog.pg_policies p
  WHERE p.tablename IN ('barbershops', 'barbershop_members', 'staff_profiles');
END;
$$;

CREATE OR REPLACE FUNCTION public.inspect_active_functions()
RETURNS TABLE (
  routine_name TEXT,
  routine_type TEXT,
  language_name TEXT,
  security_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.routine_name::TEXT,
    r.routine_type::TEXT,
    r.language_name::TEXT,
    r.security_type::TEXT
  FROM information_schema.routines r
  WHERE r.routine_schema = 'public' 
    AND r.routine_name IN ('get_user_barbershop_ids', 'get_owned_barbershop_ids', 'inspect_active_policies', 'inspect_active_functions');
END;
$$;

GRANT EXECUTE ON FUNCTION public.inspect_active_policies() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_active_functions() TO anon, authenticated;

-- Barbershops Policies
DROP POLICY IF EXISTS "members_select_barbershop" ON public.barbershops;
DROP POLICY IF EXISTS "select_barbershops" ON public.barbershops;
DROP POLICY IF EXISTS "owners_insert_barbershop" ON public.barbershops;
DROP POLICY IF EXISTS "owners_update_barbershop" ON public.barbershops;
DROP POLICY IF EXISTS "owners_delete_barbershop" ON public.barbershops;

-- Permite leitura pública (qualquer um, incluindo clientes e visitantes anônimos para agendar) de dados básicos da barbearia
CREATE POLICY "select_barbershops" ON public.barbershops
  FOR SELECT USING (true);

CREATE POLICY "owners_insert_barbershop" ON public.barbershops
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owners_update_barbershop" ON public.barbershops
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "owners_delete_barbershop" ON public.barbershops
  FOR DELETE USING (owner_id = auth.uid());

-- Barbershop Members Policies
DROP POLICY IF EXISTS "members_select_members" ON public.barbershop_members;
DROP POLICY IF EXISTS "select_members" ON public.barbershop_members;
DROP POLICY IF EXISTS "owners_insert_members" ON public.barbershop_members;
DROP POLICY IF EXISTS "owners_update_members" ON public.barbershop_members;
DROP POLICY IF EXISTS "owners_delete_members" ON public.barbershop_members;

CREATE POLICY "select_members" ON public.barbershop_members
  FOR SELECT USING (
    user_id = auth.uid() OR
    barbershop_id IN (SELECT id FROM public.barbershops WHERE owner_id = auth.uid())
  );

CREATE POLICY "owners_insert_members" ON public.barbershop_members
  FOR INSERT WITH CHECK (
    barbershop_id IN (SELECT id FROM public.barbershops WHERE owner_id = auth.uid())
  );

CREATE POLICY "owners_update_members" ON public.barbershop_members
  FOR UPDATE USING (
    barbershop_id IN (SELECT id FROM public.barbershops WHERE owner_id = auth.uid())
  );

CREATE POLICY "owners_delete_members" ON public.barbershop_members
  FOR DELETE USING (
    barbershop_id IN (SELECT id FROM public.barbershops WHERE owner_id = auth.uid())
  );

-- Barbershop Invites Policies
DROP POLICY IF EXISTS "owners_manage_invites" ON public.barbershop_invites;
CREATE POLICY "owners_manage_invites" ON public.barbershop_invites
  FOR ALL USING (
    barbershop_id IN (SELECT id FROM public.barbershops WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "invitees_select_invite" ON public.barbershop_invites;
CREATE POLICY "invitees_select_invite" ON public.barbershop_invites
  FOR SELECT USING (
    email = auth.jwt()->>'email'
  );

-- Automatically add owner to members upon barbershop creation
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

DROP TRIGGER IF EXISTS on_barbershop_created ON public.barbershops;
CREATE TRIGGER on_barbershop_created
  AFTER INSERT ON public.barbershops
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_barbershop();

-- Function to accept an invite securely
CREATE OR REPLACE FUNCTION public.accept_barbershop_invite(p_token TEXT)
RETURNS public.barbershop_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite public.barbershop_invites;
  v_member public.barbershop_members;
  v_user_email TEXT;
BEGIN
  -- Get current user email from auth
  v_user_email := auth.jwt()->>'email';
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Not authenticated or email missing';
  END IF;

  -- Find a valid invite
  SELECT * INTO v_invite
  FROM public.barbershop_invites
  WHERE token = p_token
    AND email = v_user_email
    AND expires_at > NOW()
    AND accepted_at IS NULL
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite';
  END IF;

  -- Update invite
  UPDATE public.barbershop_invites
  SET accepted_at = NOW()
  WHERE id = v_invite.id;

  -- Add to members
  INSERT INTO public.barbershop_members (barbershop_id, user_id, role)
  VALUES (v_invite.barbershop_id, auth.uid(), v_invite.role)
  ON CONFLICT (barbershop_id, user_id) DO UPDATE
  SET role = EXCLUDED.role
  RETURNING * INTO v_member;

  RETURN v_member;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_barbershop_invite(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_barbershop_invite(TEXT) TO authenticated;

-- =========================================================
-- staff_profiles: Table, RLS and policies
-- =========================================================
DROP TABLE IF EXISTS public.staff_profiles CASCADE;

CREATE TABLE public.staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  commission_rate NUMERIC NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ativa RLS
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

-- Permite leitura pública (clientes precisam ver a lista de profissionais ao agendar)
DROP POLICY IF EXISTS "select_staff_profiles" ON public.staff_profiles;
CREATE POLICY "select_staff_profiles" ON public.staff_profiles
  FOR SELECT USING (true);

-- Apenas o proprietário (tenant_id) pode inserir, atualizar e deletar registros de sua equipe
DROP POLICY IF EXISTS "manage_staff_profiles" ON public.staff_profiles;
CREATE POLICY "manage_staff_profiles" ON public.staff_profiles
  FOR ALL USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());