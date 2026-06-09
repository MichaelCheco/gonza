create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

drop policy if exists "App admins can view their own allowlist row" on public.app_admins;
create policy "App admins can view their own allowlist row"
on public.app_admins
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.app_admins from anon;
revoke insert, update, delete on table public.app_admins from authenticated;
grant select on table public.app_admins to authenticated;

alter table public.clients enable row level security;
alter table public.packages enable row level security;
alter table public.client_packages enable row level security;
alter table public.classes enable row level security;
alter table public.attendance enable row level security;
alter table public.class_templates enable row level security;

grant select, insert, update, delete on table
  public.clients,
  public.packages,
  public.client_packages,
  public.classes,
  public.attendance,
  public.class_templates
to authenticated;

grant usage, select on all sequences in schema public to authenticated;

revoke all on table
  public.clients,
  public.packages,
  public.client_packages,
  public.classes,
  public.attendance,
  public.class_templates
from anon;

drop policy if exists "App admins can manage clients" on public.clients;
create policy "App admins can manage clients"
on public.clients
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "App admins can manage packages" on public.packages;
create policy "App admins can manage packages"
on public.packages
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "App admins can manage client packages" on public.client_packages;
create policy "App admins can manage client packages"
on public.client_packages
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "App admins can manage classes" on public.classes;
create policy "App admins can manage classes"
on public.classes
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "App admins can manage attendance" on public.attendance;
create policy "App admins can manage attendance"
on public.attendance
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "App admins can manage class templates" on public.class_templates;
create policy "App admins can manage class templates"
on public.class_templates
for all
to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

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
begin
  select id, client_package_id
  into v_attendance_id, v_client_package_id
  from public.attendance
  where class_id = p_class_id
    and client_id = p_client_id
    and client_package_id is not null
  order by id
  limit 1
  for update;

  if v_attendance_id is null then
    return false;
  end if;

  update public.client_packages
  set classes_remaining = classes_remaining + 1
  where id = v_client_package_id;

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
  set classes_remaining = cp.classes_remaining + restored.used_count
  from (
    select client_package_id, count(*)::int as used_count
    from public.attendance
    where class_id = p_class_id
      and client_package_id is not null
    group by client_package_id
  ) restored
  where cp.id = restored.client_package_id;

  delete from public.attendance
  where class_id = p_class_id;

  delete from public.classes
  where id = p_class_id;

  return true;
end;
$$;

create or replace function public.generate_classes_from_templates(
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
as $$
declare
  v_inserted integer;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    return 0;
  end if;

  insert into public.classes (template_id, title, class_type, scheduled_date, start_time)
  select
    ct.id,
    ct.title,
    ct.class_type,
    generated.day::date,
    ct.start_time
  from public.class_templates ct
  cross join generate_series(p_start_date, p_end_date, interval '1 day') as generated(day)
  where ct.day_of_week in (
      extract(dow from generated.day)::int,
      extract(isodow from generated.day)::int
    )
    and not exists (
      select 1
      from public.classes c
      where c.template_id = ct.id
        and c.scheduled_date = generated.day::date
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.undo_check_in(bigint, bigint) from public;
revoke execute on function public.undo_check_in(bigint, bigint) from anon;
grant execute on function public.undo_check_in(bigint, bigint) to authenticated;

revoke execute on function public.cancel_session(bigint) from public;
revoke execute on function public.cancel_session(bigint) from anon;
grant execute on function public.cancel_session(bigint) to authenticated;

revoke execute on function public.generate_classes_from_templates(date, date) from public;
revoke execute on function public.generate_classes_from_templates(date, date) from anon;
grant execute on function public.generate_classes_from_templates(date, date) to authenticated;
