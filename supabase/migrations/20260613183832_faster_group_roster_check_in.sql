with ranked_attendance as (
  select
    id,
    client_package_id,
    row_number() over (
      partition by class_id, client_id
      order by (client_package_id is not null) desc, id asc
    ) as row_number
  from public.attendance
),
restored_credits as (
  select client_package_id, count(*)::int as used_count
  from ranked_attendance
  where row_number > 1
    and client_package_id is not null
  group by client_package_id
)
update public.client_packages cp
set classes_remaining = cp.classes_remaining + restored_credits.used_count
from restored_credits
where cp.id = restored_credits.client_package_id;

with ranked_attendance as (
  select
    id,
    row_number() over (
      partition by class_id, client_id
      order by (client_package_id is not null) desc, id asc
    ) as row_number
  from public.attendance
)
delete from public.attendance a
using ranked_attendance
where a.id = ranked_attendance.id
  and ranked_attendance.row_number > 1;

create unique index if not exists attendance_class_client_unique
on public.attendance (class_id, client_id);

create or replace function public.add_group_roster_check_in(
  p_class_id bigint,
  p_client_id bigint
)
returns table (
  attendance_id bigint,
  client_id bigint,
  checked_in boolean,
  client_package_id bigint,
  remaining_after integer,
  status text
)
language plpgsql
as $$
declare
  v_class_type text;
  v_attendance_id bigint;
  v_existing_package_id bigint;
  v_existing_remaining integer;
  v_client_package_id bigint;
  v_remaining_after integer;
begin
  select class_type
  into v_class_type
  from public.classes
  where id = p_class_id;

  if not found then
    raise exception 'Class % not found', p_class_id;
  end if;

  if v_class_type = 'Personal Training' then
    raise exception 'Group roster check-in cannot be used for Personal Training classes';
  end if;

  select a.id, a.client_package_id, cp.classes_remaining
  into v_attendance_id, v_existing_package_id, v_existing_remaining
  from public.attendance a
  left join public.client_packages cp on cp.id = a.client_package_id
  where a.class_id = p_class_id
    and a.client_id = p_client_id
  order by a.id
  limit 1
  for update of a;

  if v_existing_package_id is not null then
    attendance_id := v_attendance_id;
    client_id := p_client_id;
    checked_in := true;
    client_package_id := v_existing_package_id;
    remaining_after := v_existing_remaining;
    status := 'already_checked_in';
    return next;
    return;
  end if;

  insert into public.attendance (class_id, client_id)
  values (p_class_id, p_client_id)
  on conflict (class_id, client_id) do nothing
  returning id into v_attendance_id;

  if v_attendance_id is null then
    select id
    into v_attendance_id
    from public.attendance
    where class_id = p_class_id
      and client_id = p_client_id
    order by id
    limit 1;
  end if;

  select cp.id
  into v_client_package_id
  from public.client_packages cp
  join public.packages p on p.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.payment_status = 'paid'
    and cp.classes_remaining > 0
    and (cp.expiration_date is null or cp.expiration_date >= current_date)
    and p.service_type = 'group'
  order by cp.expiration_date asc nulls last, cp.start_date asc, cp.id asc
  limit 1
  for update of cp skip locked;

  if v_client_package_id is null then
    attendance_id := v_attendance_id;
    client_id := p_client_id;
    checked_in := false;
    client_package_id := null;
    remaining_after := null;
    status := 'no_active_package';
    return next;
    return;
  end if;

  update public.client_packages
  set classes_remaining = classes_remaining - 1
  where id = v_client_package_id
  returning classes_remaining into v_remaining_after;

  update public.attendance
  set client_package_id = v_client_package_id
  where id = v_attendance_id;

  attendance_id := v_attendance_id;
  client_id := p_client_id;
  checked_in := true;
  client_package_id := v_client_package_id;
  remaining_after := v_remaining_after;
  status := case when v_remaining_after = 0 then 'last_class' else 'checked_in' end;
  return next;
end;
$$;

create or replace function public.create_client_and_group_check_in(
  p_class_id bigint,
  p_full_name text
)
returns table (
  attendance_id bigint,
  client_id bigint,
  checked_in boolean,
  client_package_id bigint,
  remaining_after integer,
  status text
)
language plpgsql
as $$
declare
  v_trimmed_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_name_parts text[];
  v_first_name text;
  v_last_name text;
  v_client_id bigint;
  v_package_id bigint;
  v_total_classes integer;
  v_expires_in_weeks integer;
  v_start_date date := current_date;
begin
  if v_trimmed_name = '' then
    raise exception 'Client name is required';
  end if;

  v_name_parts := regexp_split_to_array(v_trimmed_name, '\s+');
  v_first_name := v_name_parts[1];
  v_last_name := trim(substr(v_trimmed_name, length(v_first_name) + 1));

  insert into public.clients (first_name, last_name)
  values (v_first_name, coalesce(v_last_name, ''))
  returning id into v_client_id;

  select id, total_classes, expires_in_weeks
  into v_package_id, v_total_classes, v_expires_in_weeks
  from public.packages
  where service_type = 'group'
    and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'firstclassfree'
  order by id
  limit 1;

  if v_package_id is null then
    raise exception 'First Class Free package not found';
  end if;

  insert into public.client_packages (
    client_id,
    package_id,
    classes_remaining,
    start_date,
    expiration_date,
    payment_status
  )
  values (
    v_client_id,
    v_package_id,
    v_total_classes,
    v_start_date,
    case when v_expires_in_weeks is null then null else (v_start_date + (v_expires_in_weeks * interval '1 week'))::date end,
    'paid'
  );

  return query
  select
    result.attendance_id,
    result.client_id,
    result.checked_in,
    result.client_package_id,
    result.remaining_after,
    case when result.checked_in then 'first_class'::text else result.status end as status
  from public.add_group_roster_check_in(p_class_id, v_client_id) result;
end;
$$;

revoke execute on function public.add_group_roster_check_in(bigint, bigint) from public;
revoke execute on function public.add_group_roster_check_in(bigint, bigint) from anon;
grant execute on function public.add_group_roster_check_in(bigint, bigint) to authenticated;

revoke execute on function public.create_client_and_group_check_in(bigint, text) from public;
revoke execute on function public.create_client_and_group_check_in(bigint, text) from anon;
grant execute on function public.create_client_and_group_check_in(bigint, text) to authenticated;
