create function public.admin_update_location(
  p_id text,
  p_name text,
  p_description text,
  p_latitude double precision,
  p_longitude double precision,
  p_altitude double precision,
  p_is_active boolean
) returns void language plpgsql security definer set search_path='' as $$
declare previous public.locations;
begin
  if not public.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 500 then raise exception 'Enter a location name.'; end if;
  if p_description is null or length(p_description)>10000 then raise exception 'Description must be 10,000 characters or fewer.'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 then raise exception 'Enter a valid latitude.'; end if;
  if p_longitude is null or p_longitude not between -180 and 180 then raise exception 'Enter a valid longitude.'; end if;
  if p_altitude is null then raise exception 'Enter a valid altitude.'; end if;
  select * into previous from public.locations where id=p_id for update;
  if not found then raise exception 'Location not found.'; end if;
  update public.locations set
    name=trim(p_name),description=trim(p_description),latitude=p_latitude,longitude=p_longitude,
    altitude=p_altitude,is_active=p_is_active,updated_at=now()
  where id=p_id;
  insert into public.admin_activity(actor_id,action,target_id,detail)
  values(auth.uid(),'Location edited',p_id,jsonb_build_object(
    'previous_name',previous.name,'name',trim(p_name),
    'previous_active',previous.is_active,'active',p_is_active
  ));
end $$;
revoke all on function public.admin_update_location(text,text,text,double precision,double precision,double precision,boolean) from public,anon;
grant execute on function public.admin_update_location(text,text,text,double precision,double precision,double precision,boolean) to authenticated;
