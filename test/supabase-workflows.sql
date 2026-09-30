-- Run as the project database administrator. Every mutation rolls back.
begin;
select set_config('request.jwt.claims',
  json_build_object('sub',(select user_id from public.admin_members limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare before_reports integer; before_locations integer; snapshot_id uuid;
  snapshot_points jsonb; report_id text; denied boolean := false;
begin
  if not public.is_admin() then raise exception 'An existing administrator is required for this check.'; end if;
  select count(*) into before_reports from public.issue_reports;
  select count(*) into before_locations from public.locations where is_active;
  select id,points into snapshot_id,snapshot_points from public.location_imports where is_current;
  perform public.replace_locations(snapshot_points,'transaction-test.kml','');
  if (select count(*) from public.locations where is_active) <> before_locations then raise exception 'Inventory count changed'; end if;
  if (select count(*) from public.issue_reports) <> before_reports then raise exception 'Report history lost'; end if;
  if (select count(*) from public.location_imports where is_current) <> 1 then raise exception 'Current version must be unique'; end if;
  perform public.restore_location_import(snapshot_id);
  select id into report_id from public.issue_reports limit 1;
  perform public.review_report(report_id,'fixed','Transaction-only review test');
  if not exists(select 1 from public.admin_activity where target_id=report_id and action='Report reviewed') then
    raise exception 'Missing review audit'; end if;
  if not exists(select 1 from public.admin_activity where action='Locations published') then
    raise exception 'Missing publication audit'; end if;
  begin
    perform public.replace_locations('[{"id":"bad","name":"bad","latitude":91,"longitude":0}]','invalid.kml','');
  exception when raise_exception then denied := true;
  end;
  if not denied then raise exception 'Invalid coordinates accepted'; end if;
  if (select count(*) from public.issue_reports) <> before_reports then raise exception 'Restore lost history'; end if;
end $$;
rollback;
