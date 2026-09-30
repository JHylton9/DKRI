alter table public.admin_members
  add column role text not null default 'administrator'
    check (role in ('owner','administrator')),
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references auth.users(id);

-- Existing administrators established the project and become its initial owners.
update public.admin_members set role='owner';

create or replace function public.is_admin() returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.admin_members where user_id=(select auth.uid()));
$$;

create function public.can_manage_accounts() returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.admin_members where user_id=(select auth.uid()) and role='owner');
$$;
revoke all on function public.can_manage_accounts() from public,anon;
grant execute on function public.can_manage_accounts() to authenticated;

create function public.current_admin_context() returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(
    (select jsonb_build_object('role',role,'can_manage_accounts',role='owner')
      from public.admin_members where user_id=(select auth.uid())),
    jsonb_build_object('role',null,'can_manage_accounts',false)
  );
$$;
revoke all on function public.current_admin_context() from public,anon;
grant execute on function public.current_admin_context() to authenticated;

create index admin_members_role on public.admin_members(role);
