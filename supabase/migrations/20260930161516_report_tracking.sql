alter table public.issue_reports
  add column issue_other text not null default '' check (length(issue_other) <= 200);
alter table public.issue_reports drop constraint valid_issue_types;
alter table public.issue_reports add constraint valid_issue_types check (
  issue_types <@ array['Garbage buildup','Illegal dumping','Damaged / missing bin','Blocked drain','Lighting issue','Signage issue','Vagrancy / loitering','Other']::text[]
  and (not ('Other'=any(issue_types)) or length(trim(issue_other)) between 1 and 200)
);
alter table public.report_private
  add column access_token_hash text unique,
  add column access_created_at timestamptz;
alter table public.report_private add constraint valid_access_token_hash
  check (access_token_hash is null or access_token_hash ~ '^[0-9a-f]{64}$');

create table public.report_followups (
  id uuid primary key default gen_random_uuid(),
  report_id text not null references public.issue_reports(id) on delete cascade,
  author text not null check (author in ('reporter','admin')),
  message text not null check (length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index report_followups_report_date on public.report_followups(report_id,created_at,id);
alter table public.report_followups enable row level security;
revoke all on public.report_followups from anon,authenticated;
grant select,insert on public.report_followups to authenticated;
grant all on public.report_followups to service_role;
create policy followups_admin_select on public.report_followups for select to authenticated
  using ((select public.is_admin()));
create policy followups_admin_insert on public.report_followups for insert to authenticated
  with check ((select public.is_admin()) and author='admin' and created_by=(select auth.uid()));

drop view public.admin_report_queue;
create view public.admin_report_queue with (security_invoker=true) as
select r.id,r.location_id,l.name location_name,r.issue_types,r.issue_other,r.status,r.submitted_at,
  (select count(*) from public.report_followups f where f.report_id=r.id) followup_count,
  l.name || ' ' || r.location_id || ' ' || coalesce(r.description,'') || ' ' ||
    array_to_string(r.issue_types,' ') || ' ' || coalesce(r.issue_other,'') search_text
from public.issue_reports r join public.locations l on l.id=r.location_id
where (select public.is_admin());
revoke all on public.admin_report_queue from anon,authenticated;
grant select on public.admin_report_queue to authenticated,service_role;

create function public.submit_report(
  p_id text, p_location text, p_description text, p_types text[], p_other text,
  p_method text, p_contact text, p_photos jsonb, p_access_hash text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare location_name text;
begin
  select name into location_name from public.locations where id=p_location and is_active for share;
  if location_name is null then raise exception 'Choose an active location.'; end if;
  if cardinality(p_types) < 1 or cardinality(p_types)>8 then raise exception 'Choose valid issue types.'; end if;
  if p_method not in ('none','email','phone') then raise exception 'Invalid contact method.'; end if;
  if jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>5 then raise exception 'Choose up to five photos.'; end if;
  if length(trim(coalesce(p_description,'')))=0 and jsonb_array_length(p_photos)=0 then
    raise exception 'Add a description, a photo, or both.'; end if;
  if p_access_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid report access token.'; end if;
  insert into public.issue_reports(id,location_id,description,issue_types,issue_other)
    values(p_id,p_location,p_description,p_types,coalesce(p_other,''));
  insert into public.report_private(report_id,contact_method,contact_value,access_token_hash,access_created_at)
    values(p_id,p_method,case when p_method='none' then '' else p_contact end,p_access_hash,now());
  insert into public.issue_photos(report_id,storage_key,original_name,content_type)
    select p_id,x.storage_key,x.original_name,x.content_type
    from jsonb_to_recordset(p_photos) x(storage_key text,original_name text,content_type text);
  return jsonb_build_object('report_id',p_id,'location_id',p_location,'location_name',location_name,'submitted_at',now());
end $$;
revoke all on function public.submit_report(text,text,text,text[],text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_report(text,text,text,text[],text,text,text,jsonb,text) to service_role;

create function public.admin_add_report_followup(p_report_id text,p_message text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare followup_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  insert into public.report_followups(report_id,author,message,created_by)
    values(p_report_id,'admin',trim(p_message),auth.uid()) returning id into followup_id;
  return followup_id;
end $$;
revoke all on function public.admin_add_report_followup(text,text) from public,anon;
grant execute on function public.admin_add_report_followup(text,text) to authenticated;

create or replace function private.record_admin_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='issue_reports' then
    insert into public.admin_activity(actor_id,action,target_id,detail)
    values(auth.uid(),'Report reviewed',new.id,jsonb_build_object('previous_status',old.status,'status',new.status));
  elsif tg_table_name='report_private' then
    if new.admin_notes is distinct from old.admin_notes then
      insert into public.admin_activity(actor_id,action,target_id) values(auth.uid(),'Internal notes updated',new.report_id);
    end if;
  elsif tg_table_name='location_imports' then
    insert into public.admin_activity(actor_id,action,target_id,detail)
    values(auth.uid(),'Locations published',new.id::text,jsonb_build_object('filename',new.filename,'locations',jsonb_array_length(new.points)));
  elsif tg_table_name='report_followups' then
    insert into public.admin_activity(actor_id,action,target_id,detail)
    values(new.created_by,case when new.author='admin' then 'Public reply added' else 'Reporter follow-up received' end,new.report_id,
      jsonb_build_object('followup_id',new.id));
  end if;
  return new;
end $$;
create trigger audit_report_followup after insert on public.report_followups
for each row execute function private.record_admin_activity();
