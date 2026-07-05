alter table public.packages
  add column if not exists is_unlimited boolean not null default false;

alter table public.packages
  alter column total_classes drop not null;

alter table public.client_packages
  alter column classes_remaining drop not null;

alter table public.packages
  drop constraint if exists packages_total_classes_unlimited_check;

alter table public.packages
  add constraint packages_total_classes_unlimited_check
  check (
    (is_unlimited = true and total_classes is null)
    or
    (is_unlimited = false and total_classes is not null and total_classes > 0)
  );

alter table public.client_packages
  drop constraint if exists client_packages_classes_remaining_check;

alter table public.client_packages
  add constraint client_packages_classes_remaining_check
  check (classes_remaining is null or classes_remaining >= 0);

update public.packages
set
  name = 'Unlimited Monthly Membership',
  price = 300.00,
  total_classes = null,
  expires_in_weeks = 4,
  is_unlimited = true
where id = 1;

update public.packages
set
  name = '8-Class Pack',
  price = 250.00,
  total_classes = 8,
  expires_in_weeks = 4,
  is_unlimited = false
where id = 2;

update public.packages
set
  name = '8-Session PT Pack',
  price = 1300.00,
  total_classes = 8,
  expires_in_weeks = null,
  is_unlimited = false
where id = 4;

update public.client_packages as cp
set classes_remaining = null
where cp.package_id = 1
  and cp.payment_status <> 'voided'
  and (cp.expiration_date is null or cp.expiration_date >= current_date);

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
  v_is_unlimited boolean := false;
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

  select cp.id, p.is_unlimited
  into v_client_package_id, v_is_unlimited
  from public.client_packages cp
  join public.packages p on p.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.payment_status = 'paid'
    and (p.is_unlimited or coalesce(cp.classes_remaining, 0) > 0)
    and (cp.expiration_date is null or cp.expiration_date >= current_date)
    and p.service_type = v_service_type
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date asc, cp.id asc
  limit 1
  for update of cp skip locked;

  if v_client_package_id is null then
    return false;
  end if;

  if not v_is_unlimited then
    update public.client_packages
    set classes_remaining = classes_remaining - 1
    where id = v_client_package_id;
  end if;

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
#variable_conflict use_column
declare
  v_class_type text;
  v_attendance_id bigint;
  v_existing_package_id bigint;
  v_existing_remaining integer;
  v_client_package_id bigint;
  v_remaining_after integer;
  v_is_unlimited boolean := false;
begin
  select c.class_type
  into v_class_type
  from public.classes as c
  where c.id = p_class_id;

  if not found then
    raise exception 'Class % not found', p_class_id;
  end if;

  if v_class_type = 'Personal Training' then
    raise exception 'Group roster check-in cannot be used for Personal Training classes';
  end if;

  select a.id, a.client_package_id, cp.classes_remaining
  into v_attendance_id, v_existing_package_id, v_existing_remaining
  from public.attendance as a
  left join public.client_packages as cp on cp.id = a.client_package_id
  where a.class_id = p_class_id
    and a.client_id = p_client_id
  order by a.id
  limit 1
  for update of a;

  if v_existing_package_id is not null then
    return query
    select
      v_attendance_id,
      p_client_id,
      true,
      v_existing_package_id,
      v_existing_remaining,
      'already_checked_in'::text;
    return;
  end if;

  insert into public.attendance as a (class_id, client_id)
  values (p_class_id, p_client_id)
  on conflict (class_id, client_id) do nothing
  returning a.id into v_attendance_id;

  if v_attendance_id is null then
    select a.id
    into v_attendance_id
    from public.attendance as a
    where a.class_id = p_class_id
      and a.client_id = p_client_id
    order by a.id
    limit 1;
  end if;

  select cp.id, p.is_unlimited
  into v_client_package_id, v_is_unlimited
  from public.client_packages as cp
  join public.packages as p on p.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.payment_status = 'paid'
    and (p.is_unlimited or coalesce(cp.classes_remaining, 0) > 0)
    and (cp.expiration_date is null or cp.expiration_date >= current_date)
    and p.service_type = 'group'
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date asc, cp.id asc
  limit 1
  for update of cp skip locked;

  if v_client_package_id is null then
    return query
    select
      v_attendance_id,
      p_client_id,
      false,
      null::bigint,
      null::integer,
      'no_active_package'::text;
    return;
  end if;

  if v_is_unlimited then
    v_remaining_after := null;
  else
    update public.client_packages as cp
    set classes_remaining = cp.classes_remaining - 1
    where cp.id = v_client_package_id
    returning cp.classes_remaining into v_remaining_after;
  end if;

  update public.attendance as a
  set client_package_id = v_client_package_id
  where a.id = v_attendance_id;

  return query
  select
    v_attendance_id,
    p_client_id,
    true,
    v_client_package_id,
    v_remaining_after,
    case when not v_is_unlimited and v_remaining_after = 0 then 'last_class' else 'checked_in' end::text;
end;
$$;

create or replace function public.undo_check_in(
  p_class_id bigint,
  p_client_id bigint
)
returns boolean
language plpgsql
as $$
declare
  v_attendance_id bigint;
  v_client_package_id bigint;
  v_is_unlimited boolean := false;
begin
  select a.id, a.client_package_id, coalesce(p.is_unlimited, false)
  into v_attendance_id, v_client_package_id, v_is_unlimited
  from public.attendance as a
  left join public.client_packages as cp on cp.id = a.client_package_id
  left join public.packages as p on p.id = cp.package_id
  where a.class_id = p_class_id
    and a.client_id = p_client_id
    and a.client_package_id is not null
  order by a.id
  limit 1
  for update of a;

  if v_attendance_id is null then
    return false;
  end if;

  if not v_is_unlimited then
    update public.client_packages
    set classes_remaining = coalesce(classes_remaining, 0) + 1
    where id = v_client_package_id;
  end if;

  update public.attendance
  set client_package_id = null
  where id = v_attendance_id;

  return true;
end;
$$;

create or replace function public.cancel_session(
  p_class_id bigint
)
returns boolean
language plpgsql
as $$
declare
  v_class_id bigint;
begin
  select id
  into v_class_id
  from public.classes
  where id = p_class_id
  for update;

  if v_class_id is null then
    return false;
  end if;

  update public.client_packages cp
  set classes_remaining = coalesce(cp.classes_remaining, 0) + restored.used_count
  from (
    select a.client_package_id, count(*)::int as used_count
    from public.attendance as a
    join public.client_packages as cp on cp.id = a.client_package_id
    join public.packages as p on p.id = cp.package_id
    where a.class_id = p_class_id
      and a.client_package_id is not null
      and not p.is_unlimited
    group by a.client_package_id
  ) restored
  where cp.id = restored.client_package_id;

  delete from public.attendance
  where class_id = p_class_id;

  delete from public.classes
  where id = p_class_id;

  return true;
end;
$$;

revoke execute on function public.process_check_in(bigint, bigint) from public;
revoke execute on function public.process_check_in(bigint, bigint) from anon;
grant execute on function public.process_check_in(bigint, bigint) to authenticated;

revoke execute on function public.add_group_roster_check_in(bigint, bigint) from public;
revoke execute on function public.add_group_roster_check_in(bigint, bigint) from anon;
grant execute on function public.add_group_roster_check_in(bigint, bigint) to authenticated;

revoke execute on function public.undo_check_in(bigint, bigint) from public;
revoke execute on function public.undo_check_in(bigint, bigint) from anon;
grant execute on function public.undo_check_in(bigint, bigint) to authenticated;

revoke execute on function public.cancel_session(bigint) from public;
revoke execute on function public.cancel_session(bigint) from anon;
grant execute on function public.cancel_session(bigint) to authenticated;
