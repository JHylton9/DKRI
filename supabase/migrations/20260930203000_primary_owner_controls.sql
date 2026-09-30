create or replace function public.can_manage_accounts() returns boolean language sql stable security invoker set search_path='' as $$
  select lower(coalesce((select auth.jwt()->>'email'),''))='jaydonhylton17@gmail.com'
    and exists(select 1 from public.admin_members where user_id=(select auth.uid()) and role='owner');
$$;

create or replace function public.current_admin_context() returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(
    (select jsonb_build_object(
      'role',role,
      'can_manage_accounts',role='owner' and lower(coalesce((select auth.jwt()->>'email'),''))='jaydonhylton17@gmail.com'
    ) from public.admin_members where user_id=(select auth.uid())),
    jsonb_build_object('role',null,'can_manage_accounts',false)
  );
$$;
