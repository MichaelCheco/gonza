alter table public.packages
  add column if not exists service_type text;

update public.packages
set service_type = case
  when name in ('Monthly Membership', '8-Class Pack', 'First Class Free') then 'group'
  when name in ('Single PT Session', '8-Session PT Pack', 'First PT Promo') then 'personal_training'
  else service_type
end;

alter table public.packages
  alter column service_type set not null;

alter table public.packages
  drop constraint if exists packages_service_type_check;

alter table public.packages
  add constraint packages_service_type_check
  check (service_type in ('group', 'personal_training'));

alter table public.client_packages
  alter column start_date set default current_date;

create or replace function public.process_check_in(
  p_class_id bigint,
  p_client_id bigint
)
returns boolean
language plpgsql
as $$
declare
  v_class_type text;
  v_service_type text;
  v_existing_package_id bigint;
  v_client_package_id bigint;
  v_attendance_rows integer;
begin
  select class_type
  into v_class_type
  from public.classes
  where id = p_class_id;

  if not found then
    return false;
  end if;

  v_service_type := case
    when v_class_type = 'Personal Training' then 'personal_training'
    else 'group'
  end;

  select client_package_id
  into v_existing_package_id
  from public.attendance
  where class_id = p_class_id
    and client_id = p_client_id
    and client_package_id is not null
  order by id
  limit 1;

  if v_existing_package_id is not null then
    return true;
  end if;

  select cp.id
  into v_client_package_id
  from public.client_packages cp
  join public.packages p on p.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.payment_status = 'paid'
    and cp.classes_remaining > 0
    and (cp.expiration_date is null or cp.expiration_date >= current_date)
    and p.service_type = v_service_type
  order by cp.expiration_date asc nulls last, cp.start_date asc, cp.id asc
  limit 1
  for update of cp skip locked;

  if v_client_package_id is null then
    return false;
  end if;

  update public.client_packages
  set classes_remaining = classes_remaining - 1
  where id = v_client_package_id;

  with target_attendance as (
    select id
    from public.attendance
    where class_id = p_class_id
      and client_id = p_client_id
      and client_package_id is null
    order by id
    limit 1
  )
  update public.attendance a
  set client_package_id = v_client_package_id
  from target_attendance
  where a.id = target_attendance.id;

  get diagnostics v_attendance_rows = row_count;

  if v_attendance_rows = 0 then
    insert into public.attendance (class_id, client_id, client_package_id)
    values (p_class_id, p_client_id, v_client_package_id);
  end if;

  return true;
end;
$$;

revoke execute on function public.process_check_in(bigint, bigint) from public;
revoke execute on function public.process_check_in(bigint, bigint) from anon;
grant execute on function public.process_check_in(bigint, bigint) to authenticated;
