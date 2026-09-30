-- Compact public map reads preserve RLS and avoid downloading report bodies/photos.
create view public.location_map with (security_invoker = true) as
select l.*,
  coalesce(s.report_count,0) report_count,
  coalesce(s.open_report_count,0) open_report_count,
  coalesce(s.status,'pending') status,
  s.latest_report_at,
  coalesce(t.issue_types,array[]::text[]) issue_types
from public.locations l
left join lateral (
  select count(*) report_count, count(*) filter(where r.status <> 'fixed') open_report_count,
    case when bool_or(r.status='down') then 'down'
         when bool_or(r.status='pending') then 'pending' else 'fixed' end status,
    max(r.submitted_at) latest_report_at
  from public.issue_reports r where r.location_id=l.id
) s on true
left join lateral (
  select array_agg(distinct category order by category) issue_types
  from public.issue_reports r cross join lateral unnest(r.issue_types) category where r.location_id=l.id
) t on true;
grant select on public.location_map to anon, authenticated, service_role;

-- Save immutable point snapshots with each published inventory. Legacy KML remains intact.
alter table public.location_imports add column points jsonb;
alter table public.location_imports add column is_current boolean not null default false;
alter table public.location_imports add constraint import_points_array check (points is null or (jsonb_typeof(points)='array' and jsonb_array_length(points) between 1 and 10000));
create unique index location_imports_current on public.location_imports(is_current) where is_current;
-- Capture the current inventory before any future replacement; do not guess older snapshots.
insert into public.location_imports(filename,kml_text,points,is_current)
select 'Initial inventory snapshot','', jsonb_agg(jsonb_build_object(
  'id',id,'name',name,'description',description,'latitude',latitude,'longitude',longitude,'altitude',altitude) order by id), true
from public.locations where is_active having count(*)>0;
grant update(is_current) on public.location_imports to authenticated;
create policy imports_admin_update on public.location_imports for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.replace_locations(p_points jsonb,p_filename text,p_kml text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points) not between 1 and 10000 then
    raise exception 'Upload between 1 and 10,000 valid location points.'; end if;
  if p_filename is null or length(p_filename) not between 1 and 255 then raise exception 'Invalid filename.'; end if;
  if exists(select 1 from jsonb_to_recordset(p_points) x(id text,name text,latitude double precision,longitude double precision)
    where x.id is null or x.name is null or x.latitude is null or x.longitude is null
       or x.latitude not between -90 and 90 or x.longitude not between -180 and 180)
    or (select count(distinct x->>'id') from jsonb_array_elements(p_points) x) <> jsonb_array_length(p_points)
    then raise exception 'Every point needs a unique code, name and valid coordinates.'; end if;
  perform pg_advisory_xact_lock(839201);
  update public.locations set is_active=false,updated_at=now() where is_active;
  insert into public.locations(id,name,description,latitude,longitude,altitude,source_filename)
    select x.id,x.name,coalesce(x.description,''),x.latitude,x.longitude,coalesce(x.altitude,0),p_filename
    from jsonb_to_recordset(p_points) x(id text,name text,description text,latitude double precision,longitude double precision,altitude double precision)
    on conflict(id) do update set name=excluded.name,description=excluded.description,latitude=excluded.latitude,longitude=excluded.longitude,
      altitude=excluded.altitude,is_active=true,source_filename=excluded.source_filename,imported_at=now(),updated_at=now();
  update public.location_imports set is_current=false where is_current;
  insert into public.location_imports(filename,kml_text,imported_by,points,is_current)
    values(p_filename,coalesce(p_kml,''),auth.uid(),p_points,true);
end $$;

create function public.restore_location_import(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare inventory public.location_imports;
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(839201);
  select * into inventory from public.location_imports where id=p_id;
  if not found or inventory.points is null then raise exception 'This version has no restorable snapshot.'; end if;
  if inventory.is_current then raise exception 'This version is already current.'; end if;
  perform public.replace_locations(inventory.points, left('Restored: ' || inventory.filename,255),inventory.kml_text);
end $$;
revoke all on function public.restore_location_import(uuid) from public,anon;
grant execute on function public.restore_location_import(uuid) to authenticated;

-- Audit is append-only to clients. A non-exposed trigger records real database changes.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table public.admin_activity(
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  target_id text not null,
  detail jsonb not null default '{}'::jsonb
);
alter table public.admin_activity enable row level security;
revoke all on public.admin_activity from anon,authenticated;
grant select on public.admin_activity to authenticated;
grant all on public.admin_activity to service_role;
create policy activity_admin_select on public.admin_activity for select to authenticated using ((select public.is_admin()));
create index admin_activity_time on public.admin_activity(occurred_at desc);
create function private.record_admin_activity() returns trigger language plpgsql security definer set search_path='' as $$
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
  end if;
  return new;
end $$;
revoke all on function private.record_admin_activity() from public,anon,authenticated;
create trigger audit_report_review after update on public.issue_reports for each row execute function private.record_admin_activity();
create trigger audit_report_notes after update on public.report_private for each row execute function private.record_admin_activity();
create trigger audit_location_publish after insert on public.location_imports for each row execute function private.record_admin_activity();

