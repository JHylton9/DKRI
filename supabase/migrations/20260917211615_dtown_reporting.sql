create table public.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_members enable row level security;
create policy admin_members_self on public.admin_members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.admin_members from anon,authenticated;
grant select on public.admin_members to authenticated;
grant all on public.admin_members to service_role;

create function public.is_admin() returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.admin_members where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.locations (
  id text primary key check(length(id) between 1 and 500), name text not null check(length(name) between 1 and 500),
  description text not null default '' check(length(description)<=10000), latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180), altitude double precision not null default 0,
  is_active boolean not null default true, source_filename text not null default '', imported_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.issue_reports (
  id text primary key, location_id text not null references public.locations(id), description text not null default '' check(length(description)<=10000),
  issue_types text[] not null default '{}', status text not null default 'pending' check(status in ('pending','down','fixed')),
  source text not null default 'public_form', submitted_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint valid_issue_types check(issue_types <@ array['Garbage buildup','Illegal dumping','Damaged / missing bin','Blocked drain','Lighting issue','Signage issue','Vagrancy / loitering']::text[])
);
create table public.report_private (
  report_id text primary key references public.issue_reports(id) on delete cascade,
  contact_method text not null default 'none' check(contact_method in ('none','email','phone','system')),
  contact_value text not null default '' check(length(contact_value)<=300), reporter_label text not null default '' check(length(reporter_label)<=200),
  admin_notes text not null default '' check(length(admin_notes)<=10000)
);
create table public.issue_photos (
  id uuid primary key default gen_random_uuid(), report_id text not null references public.issue_reports(id) on delete cascade,
  storage_key text not null unique, original_name text not null, content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','image/gif')),
  uploaded_at timestamptz not null default now()
);
create table public.location_imports (
  id uuid primary key default gen_random_uuid(), filename text not null, kml_text text not null check(octet_length(kml_text)<=2097152),
  imported_at timestamptz not null default now(), imported_by uuid references auth.users(id) on delete set null
);
create index issue_reports_location_date on public.issue_reports(location_id,submitted_at desc);
create index issue_photos_report on public.issue_photos(report_id);
create index location_imports_user on public.location_imports(imported_by);

alter table public.locations enable row level security;
alter table public.issue_reports enable row level security;
alter table public.report_private enable row level security;
alter table public.issue_photos enable row level security;
alter table public.location_imports enable row level security;

create policy locations_public on public.locations for select to anon using (is_active);
create policy locations_signed_in on public.locations for select to authenticated using (is_active or (select public.is_admin()));
create policy locations_admin_insert on public.locations for insert to authenticated with check ((select public.is_admin()));
create policy locations_admin_update on public.locations for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy reports_public on public.issue_reports for select to anon using (exists(select 1 from public.locations l where l.id=location_id and l.is_active));
create policy reports_signed_in on public.issue_reports for select to authenticated using ((select public.is_admin()) or exists(select 1 from public.locations l where l.id=location_id and l.is_active));
create policy reports_admin_update on public.issue_reports for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy private_admin_select on public.report_private for select to authenticated using ((select public.is_admin()));
create policy private_admin_update on public.report_private for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy photos_public on public.issue_photos for select to anon,authenticated using (exists(select 1 from public.issue_reports r where r.id=report_id));
create policy imports_admin_select on public.location_imports for select to authenticated using ((select public.is_admin()));
create policy imports_admin_insert on public.location_imports for insert to authenticated with check ((select public.is_admin()) and imported_by=(select auth.uid()));

-- Public clients read public fields; submission writes are reserved for the validated Edge Function.
revoke all on public.locations, public.issue_reports, public.report_private, public.issue_photos, public.location_imports from anon, authenticated;
grant select on public.locations, public.issue_reports, public.issue_photos to anon, authenticated;
grant select on public.report_private, public.location_imports to authenticated;
grant insert,update on public.locations to authenticated;
grant insert on public.location_imports to authenticated;
grant update(status,updated_at) on public.issue_reports to authenticated;
grant update(admin_notes) on public.report_private to authenticated;
grant all on public.locations, public.issue_reports, public.report_private, public.issue_photos, public.location_imports to service_role;

create function public.submit_report(p_id text, p_location text, p_description text, p_types text[], p_method text, p_contact text, p_photos jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare location_name text;
begin
  select name into location_name from public.locations where id=p_location and is_active for share;
  if location_name is null then raise exception 'Choose an active location.'; end if;
  if cardinality(p_types) < 1 or cardinality(p_types)>7 then raise exception 'Choose valid issue types.'; end if;
  if p_method not in ('none','email','phone') then raise exception 'Invalid contact method.'; end if;
  if jsonb_typeof(p_photos)<>'array' or jsonb_array_length(p_photos)>5 then raise exception 'Choose up to five photos.'; end if;
  insert into public.issue_reports(id,location_id,description,issue_types) values(p_id,p_location,p_description,p_types);
  insert into public.report_private(report_id,contact_method,contact_value) values(p_id,p_method,case when p_method='none' then '' else p_contact end);
  insert into public.issue_photos(report_id,storage_key,original_name,content_type)
    select p_id, x.storage_key,x.original_name,x.content_type from jsonb_to_recordset(p_photos) x(storage_key text,original_name text,content_type text);
  return jsonb_build_object('report_id',p_id,'location_id',p_location,'location_name',location_name,'submitted_at',now());
end;
$$;
revoke all on function public.submit_report(text,text,text,text[],text,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_report(text,text,text,text[],text,text,jsonb) to service_role;

create function public.review_report(p_id text,p_status text,p_notes text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  update public.issue_reports set status=p_status,updated_at=now() where id=p_id;
  if not found then raise exception 'Report not found.'; end if;
  update public.report_private set admin_notes=p_notes where report_id=p_id;
end;
$$;
revoke all on function public.review_report(text,text,text) from public,anon;
grant execute on function public.review_report(text,text,text) to authenticated;

create function public.replace_locations(p_points jsonb,p_filename text,p_kml text) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)=0 or jsonb_array_length(p_points)>10000 then raise exception 'Upload valid location points.'; end if;
  -- Serializes complete KML replacement so concurrent imports cannot mix inventories.
  perform pg_advisory_xact_lock(839201);
  update public.locations set is_active=false,updated_at=now();
  insert into public.locations(id,name,description,latitude,longitude,altitude,source_filename)
    select x.id,x.name,coalesce(x.description,''),x.latitude,x.longitude,coalesce(x.altitude,0),p_filename
    from jsonb_to_recordset(p_points) x(id text,name text,description text,latitude double precision,longitude double precision,altitude double precision)
    on conflict(id) do update set name=excluded.name,description=excluded.description,latitude=excluded.latitude,longitude=excluded.longitude,
      altitude=excluded.altitude,is_active=true,source_filename=excluded.source_filename,imported_at=now(),updated_at=now();
  insert into public.location_imports(filename,kml_text,imported_by) values(p_filename,p_kml,auth.uid());
end;
$$;
revoke all on function public.replace_locations(jsonb,text,text) from public,anon;
grant execute on function public.replace_locations(jsonb,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('report-photos','report-photos',true,10485760,array['image/jpeg','image/png','image/webp','image/gif']);
-- No browser INSERT/UPDATE/DELETE policies: only the Edge Function can write photos.

-- Some new projects include this event-trigger helper. It must not be exposed as an RPC.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
  end if;
end $$;
