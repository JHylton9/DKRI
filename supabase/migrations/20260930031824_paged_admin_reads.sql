-- Report queues fetch only the requested page; private fields load when a report opens.
create view public.admin_report_queue with (security_invoker=true) as
select r.id,r.location_id,l.name location_name,r.issue_types,r.status,r.submitted_at,
  l.name || ' ' || r.location_id || ' ' || coalesce(r.description,'') || ' ' || array_to_string(r.issue_types,' ') search_text
from public.issue_reports r join public.locations l on l.id=r.location_id
where (select public.is_admin());
revoke all on public.admin_report_queue from anon,authenticated;
grant select on public.admin_report_queue to authenticated,service_role;
create index issue_reports_submitted on public.issue_reports(submitted_at desc,id);
create index issue_reports_status on public.issue_reports(status);
alter table public.location_imports add column point_count integer generated always as (jsonb_array_length(points)) stored;
