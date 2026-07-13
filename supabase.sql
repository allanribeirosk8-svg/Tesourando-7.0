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

  if auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;

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