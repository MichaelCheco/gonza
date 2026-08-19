create schema if not exists private;

revoke all on schema private from public, anon;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins as aa
    where aa.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_app_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_app_admin() to authenticated;

alter table public.clients
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists experience_level text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.clients
  drop constraint if exists clients_experience_level_check;

alter table public.clients
  add constraint clients_experience_level_check
  check (
    experience_level is null
    or experience_level in ('beginner', 'intermediate', 'advanced', 'professional')
  );

create unique index if not exists clients_user_id_unique
on public.clients (user_id)
where user_id is not null;

create index if not exists clients_email_lower_idx
on public.clients (lower(email))
where email is not null and user_id is null;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function private.set_updated_at();

alter table public.packages
  add column if not exists package_kind text not null default 'class_pack';

alter table public.packages
  drop constraint if exists packages_package_kind_check;

alter table public.packages
  add constraint packages_package_kind_check
  check (package_kind in ('membership', 'class_pack', 'drop_in', 'promotion'));

update public.packages
set package_kind = case
  when is_unlimited then 'membership'
  when lower(name) like '%first%' or lower(name) like '%promo%' then 'promotion'
  when total_classes = 1 then 'drop_in'
  else 'class_pack'
end;

alter table public.classes
  add column if not exists duration_minutes integer not null default 60,
  add column if not exists capacity integer not null default 12,
  add column if not exists is_client_bookable boolean not null default true,
  add column if not exists coach_user_id uuid references auth.users(id) on delete set null;

alter table public.classes
  drop constraint if exists classes_duration_minutes_check,
  drop constraint if exists classes_capacity_check;

alter table public.classes
  add constraint classes_duration_minutes_check check (duration_minutes between 15 and 480),
  add constraint classes_capacity_check check (capacity between 1 and 500);

update public.classes
set capacity = 1,
    is_client_bookable = false
where class_type = 'Personal Training';

alter table public.class_templates
  add column if not exists duration_minutes integer not null default 60,
  add column if not exists capacity integer not null default 12,
  add column if not exists is_client_bookable boolean not null default true;

alter table public.class_templates
  drop constraint if exists class_templates_duration_minutes_check,
  drop constraint if exists class_templates_capacity_check;

alter table public.class_templates
  add constraint class_templates_duration_minutes_check check (duration_minutes between 15 and 480),
  add constraint class_templates_capacity_check check (capacity between 1 and 500);

create table if not exists public.gym_settings (
  id boolean primary key default true check (id),
  cancellation_window_hours integer not null default 24 check (cancellation_window_hours between 0 and 168),
  timezone text not null default 'America/Los_Angeles',
  updated_at timestamptz not null default now()
);

insert into public.gym_settings (id)
values (true)
on conflict (id) do nothing;

drop trigger if exists gym_settings_set_updated_at on public.gym_settings;
create trigger gym_settings_set_updated_at
before update on public.gym_settings
for each row execute function private.set_updated_at();

create table if not exists public.coach_profiles (
  user_id uuid primary key references public.app_admins(user_id) on delete cascade,
  display_name text not null default 'Coach',
  bio text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_profiles_display_name_check check (length(trim(display_name)) between 1 and 80)
);

insert into public.coach_profiles (user_id, display_name)
select aa.user_id, 'Coach'
from public.app_admins as aa
on conflict (user_id) do nothing;

drop trigger if exists coach_profiles_set_updated_at on public.coach_profiles;
create trigger coach_profiles_set_updated_at
before update on public.coach_profiles
for each row execute function private.set_updated_at();

create or replace function private.create_coach_profile_for_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.coach_profiles (user_id, display_name)
  values (new.user_id, 'Coach')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function private.create_coach_profile_for_admin() from public, anon, authenticated;

drop trigger if exists app_admins_create_coach_profile on public.app_admins;
create trigger app_admins_create_coach_profile
after insert on public.app_admins
for each row execute function private.create_coach_profile_for_admin();

create table if not exists public.coach_availability (
  id bigint generated by default as identity primary key,
  coach_user_id uuid not null references public.coach_profiles(user_id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_availability_time_check check (ends_at > starts_at),
  constraint coach_availability_duration_check check (ends_at <= starts_at + interval '8 hours'),
  constraint coach_availability_status_check check (status in ('available', 'booked', 'blocked')),
  constraint coach_availability_slot_unique unique (coach_user_id, starts_at, ends_at)
);

create index if not exists coach_availability_status_starts_idx
on public.coach_availability (status, starts_at);

drop trigger if exists coach_availability_set_updated_at on public.coach_availability;
create trigger coach_availability_set_updated_at
before update on public.coach_availability
for each row execute function private.set_updated_at();

create table if not exists public.bookings (
  id bigint generated by default as identity primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  service_type text not null,
  class_id bigint references public.classes(id) on delete set null,
  availability_slot_id bigint references public.coach_availability(id) on delete set null,
  client_package_id bigint references public.client_packages(id) on delete set null,
  session_title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  coach_name text,
  status text not null default 'booked',
  booked_at timestamptz not null default now(),
  cancellation_cutoff_at timestamptz not null,
  cancelled_at timestamptz,
  cancellation_reason text,
  credit_refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_service_type_check check (service_type in ('group', 'personal_training')),
  constraint bookings_status_check check (status in ('booked', 'attended', 'no_show', 'cancelled')),
  constraint bookings_time_check check (ends_at > starts_at),
  constraint bookings_session_source_check check (
    (service_type = 'group' and availability_slot_id is null)
    or
    (service_type = 'personal_training' and availability_slot_id is not null)
  )
);

create index if not exists bookings_client_starts_idx
on public.bookings (client_id, starts_at desc);

create index if not exists bookings_class_id_idx
on public.bookings (class_id)
where class_id is not null;

create index if not exists bookings_client_package_id_idx
on public.bookings (client_package_id)
where client_package_id is not null;

create unique index if not exists bookings_active_class_client_unique
on public.bookings (class_id, client_id)
where class_id is not null and status = 'booked';

create unique index if not exists bookings_active_pt_slot_unique
on public.bookings (availability_slot_id)
where availability_slot_id is not null and status = 'booked';

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function private.set_updated_at();

alter table public.attendance
  add column if not exists booking_id bigint references public.bookings(id) on delete set null,
  add column if not exists checked_in_at timestamptz;

update public.attendance
set checked_in_at = coalesce(checked_in_at, created_at, now())
where client_package_id is not null
  and checked_in_at is null;

create unique index if not exists attendance_booking_id_unique
on public.attendance (booking_id)
where booking_id is not null;

create index if not exists attendance_client_id_idx
on public.attendance (client_id);

create index if not exists client_packages_client_id_idx
on public.client_packages (client_id);

create index if not exists client_packages_package_id_idx
on public.client_packages (package_id);

create index if not exists classes_schedule_idx
on public.classes (scheduled_date, start_time);

alter table public.gym_settings enable row level security;
alter table public.coach_profiles enable row level security;
alter table public.coach_availability enable row level security;
alter table public.bookings enable row level security;

revoke all on table public.gym_settings, public.coach_profiles, public.coach_availability, public.bookings from anon;

grant select, insert, update, delete on table
  public.gym_settings,
  public.coach_profiles,
  public.coach_availability,
  public.bookings
to authenticated;

grant usage, select on sequence public.coach_availability_id_seq to authenticated;
grant usage, select on sequence public.bookings_id_seq to authenticated;

revoke update on table public.clients from authenticated;
grant update (
  first_name,
  last_name,
  phone,
  instagram_handle,
  email,
  emergency_contact_name,
  emergency_contact_phone,
  experience_level
) on public.clients to authenticated;

drop policy if exists "Clients can view their own profile" on public.clients;
create policy "Clients can view their own profile"
on public.clients
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Clients can update their own profile" on public.clients;
create policy "Clients can update their own profile"
on public.clients
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Authenticated members can view packages" on public.packages;
create policy "Authenticated members can view packages"
on public.packages
for select
to authenticated
using (true);

drop policy if exists "Clients can view their own entitlements" on public.client_packages;
create policy "Clients can view their own entitlements"
on public.client_packages
for select
to authenticated
using (
  exists (
    select 1
    from public.clients as c
    where c.id = client_packages.client_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view public group sessions" on public.classes;
create policy "Members can view public group sessions"
on public.classes
for select
to authenticated
using (class_type <> 'Personal Training' and is_client_bookable);

drop policy if exists "Members can view public group templates" on public.class_templates;
create policy "Members can view public group templates"
on public.class_templates
for select
to authenticated
using (class_type <> 'Personal Training' and is_client_bookable);

drop policy if exists "Clients can view their own roster entries" on public.attendance;
create policy "Clients can view their own roster entries"
on public.attendance
for select
to authenticated
using (
  exists (
    select 1
    from public.clients as c
    where c.id = attendance.client_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "Members can view gym settings" on public.gym_settings;
create policy "Members can view gym settings"
on public.gym_settings
for select
to authenticated
using (true);

drop policy if exists "App admins can manage gym settings" on public.gym_settings;
create policy "App admins can manage gym settings"
on public.gym_settings
for all
to authenticated
using ((select private.is_app_admin()))
with check ((select private.is_app_admin()));

drop policy if exists "Members can view active coaches" on public.coach_profiles;
create policy "Members can view active coaches"
on public.coach_profiles
for select
to authenticated
using (is_active);

drop policy if exists "App admins can manage coach profiles" on public.coach_profiles;
create policy "App admins can manage coach profiles"
on public.coach_profiles
for all
to authenticated
using ((select private.is_app_admin()))
with check ((select private.is_app_admin()));

drop policy if exists "Members can view open coach availability" on public.coach_availability;
create policy "Members can view open coach availability"
on public.coach_availability
for select
to authenticated
using (status = 'available' and ends_at > now());

drop policy if exists "App admins can manage coach availability" on public.coach_availability;
create policy "App admins can manage coach availability"
on public.coach_availability
for all
to authenticated
using ((select private.is_app_admin()))
with check ((select private.is_app_admin()));

drop policy if exists "Clients can view their own bookings" on public.bookings;
create policy "Clients can view their own bookings"
on public.bookings
for select
to authenticated
using (
  exists (
    select 1
    from public.clients as c
    where c.id = bookings.client_id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists "App admins can manage bookings" on public.bookings;
create policy "App admins can manage bookings"
on public.bookings
for all
to authenticated
using ((select private.is_app_admin()))
with check ((select private.is_app_admin()));

create or replace function public.claim_client_profile()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_client_id bigint;
  v_match_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select c.id
  into v_client_id
  from public.clients as c
  where c.user_id = v_user_id;

  if v_client_id is not null then
    return v_client_id;
  end if;

  select u.email
  into v_email
  from auth.users as u
  where u.id = v_user_id
    and u.email_confirmed_at is not null;

  if v_email is null then
    return null;
  end if;

  select count(*)::integer, min(c.id)
  into v_match_count, v_client_id
  from public.clients as c
  where c.user_id is null
    and c.email is not null
    and lower(trim(c.email)) = lower(trim(v_email));

  if v_match_count <> 1 then
    return null;
  end if;

  update public.clients as c
  set user_id = v_user_id
  where c.id = v_client_id
    and c.user_id is null
  returning c.id into v_client_id;

  return v_client_id;
end;
$$;

revoke execute on function public.claim_client_profile() from public, anon;
grant execute on function public.claim_client_profile() to authenticated;

create or replace function public.get_bookable_schedule(
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table (
  session_kind text,
  session_id bigint,
  title text,
  service_type text,
  starts_at timestamptz,
  ends_at timestamptz,
  coach_name text,
  spots_remaining integer,
  is_booked boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id bigint;
  v_timezone text;
  v_start_date date;
  v_end_date date;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
    raise exception 'A valid schedule range is required';
  end if;

  if p_end_at - p_start_at > interval '31 days' then
    raise exception 'Schedule ranges cannot exceed 31 days';
  end if;

  select c.id
  into v_client_id
  from public.clients as c
  where c.user_id = (select auth.uid());

  if v_client_id is null and not (select private.is_app_admin()) then
    raise exception 'A linked client profile is required';
  end if;

  select gs.timezone
  into v_timezone
  from public.gym_settings as gs
  where gs.id;

  v_start_date := (p_start_at at time zone v_timezone)::date;
  v_end_date := ((p_end_at - interval '1 microsecond') at time zone v_timezone)::date;

  perform pg_advisory_xact_lock(20260818, 1);

  insert into public.classes (
    template_id,
    title,
    class_type,
    scheduled_date,
    start_time,
    duration_minutes,
    capacity,
    is_client_bookable
  )
  select
    ct.id,
    ct.title,
    ct.class_type,
    generated.day::date,
    ct.start_time,
    ct.duration_minutes,
    ct.capacity,
    ct.is_client_bookable
  from public.class_templates as ct
  cross join generate_series(v_start_date, v_end_date, interval '1 day') as generated(day)
  where ct.class_type <> 'Personal Training'
    and ct.is_client_bookable
    and ct.day_of_week in (
      extract(dow from generated.day)::integer,
      extract(isodow from generated.day)::integer
    )
    and not exists (
      select 1
      from public.classes as c
      where c.template_id = ct.id
        and c.scheduled_date = generated.day::date
    );

  return query
  select schedule.*
  from (
    select
      'group'::text as session_kind,
      c.id as session_id,
      c.title,
      'group'::text as service_type,
      session_time.starts_at,
      session_time.starts_at + make_interval(mins => c.duration_minutes) as ends_at,
      coalesce(cp.display_name, 'Gonza Boxing')::text as coach_name,
      greatest(c.capacity - coalesce(roster.reserved_count, 0), 0)::integer as spots_remaining,
      exists (
        select 1
        from public.bookings as own_booking
        where own_booking.class_id = c.id
          and own_booking.client_id = v_client_id
          and own_booking.status = 'booked'
      ) as is_booked
    from public.classes as c
    cross join public.gym_settings as gs
    cross join lateral (
      select ((c.scheduled_date + c.start_time) at time zone gs.timezone) as starts_at
    ) as session_time
    left join public.coach_profiles as cp on cp.user_id = c.coach_user_id
    left join lateral (
      select count(*)::integer as reserved_count
      from public.attendance as a
      where a.class_id = c.id
    ) as roster on true
    where gs.id
      and c.class_type <> 'Personal Training'
      and c.is_client_bookable
      and session_time.starts_at >= p_start_at
      and session_time.starts_at < p_end_at
      and session_time.starts_at > now()

    union all

    select
      'personal_training'::text as session_kind,
      ca.id as session_id,
      'Personal Training'::text as title,
      'personal_training'::text as service_type,
      ca.starts_at,
      ca.ends_at,
      cp.display_name::text as coach_name,
      1::integer as spots_remaining,
      false as is_booked
    from public.coach_availability as ca
    join public.coach_profiles as cp on cp.user_id = ca.coach_user_id
    where ca.status = 'available'
      and cp.is_active
      and ca.starts_at >= p_start_at
      and ca.starts_at < p_end_at
      and ca.starts_at > now()
  ) as schedule
  order by schedule.starts_at, schedule.service_type;
end;
$$;

revoke execute on function public.get_bookable_schedule(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_bookable_schedule(timestamptz, timestamptz) to authenticated;

create or replace function public.book_my_group_class(p_class_id bigint)
returns table (
  booking_id bigint,
  remaining_after integer,
  is_unlimited boolean,
  cancellation_cutoff_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id bigint;
  v_title text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_capacity integer;
  v_is_bookable boolean;
  v_class_type text;
  v_coach_name text;
  v_timezone text;
  v_reserved_count integer;
  v_client_package_id bigint;
  v_is_unlimited boolean := false;
  v_remaining_after integer;
  v_cancellation_cutoff_at timestamptz;
  v_booking_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select c.id
  into v_client_id
  from public.clients as c
  where c.user_id = v_user_id;

  if v_client_id is null then
    raise exception 'A linked client profile is required';
  end if;

  select
    c.title,
    ((c.scheduled_date + c.start_time) at time zone gs.timezone),
    ((c.scheduled_date + c.start_time) at time zone gs.timezone) + make_interval(mins => c.duration_minutes),
    c.capacity,
    c.is_client_bookable,
    c.class_type,
    coalesce(cp.display_name, 'Gonza Boxing'),
    gs.timezone,
    ((c.scheduled_date + c.start_time) at time zone gs.timezone) - make_interval(hours => gs.cancellation_window_hours)
  into
    v_title,
    v_starts_at,
    v_ends_at,
    v_capacity,
    v_is_bookable,
    v_class_type,
    v_coach_name,
    v_timezone,
    v_cancellation_cutoff_at
  from public.classes as c
  cross join public.gym_settings as gs
  left join public.coach_profiles as cp on cp.user_id = c.coach_user_id
  where c.id = p_class_id
    and gs.id
  for update of c;

  if v_title is null then
    raise exception 'Class not found';
  end if;

  if v_class_type = 'Personal Training' or not v_is_bookable then
    raise exception 'This class is not available for client booking';
  end if;

  if v_starts_at <= now() then
    raise exception 'This class has already started';
  end if;

  if exists (
    select 1
    from public.bookings as b
    where b.class_id = p_class_id
      and b.client_id = v_client_id
      and b.status = 'booked'
  ) then
    raise exception 'You are already booked for this class';
  end if;

  if exists (
    select 1
    from public.attendance as a
    where a.class_id = p_class_id
      and a.client_id = v_client_id
  ) then
    raise exception 'You are already on this class roster';
  end if;

  select count(*)::integer
  into v_reserved_count
  from public.attendance as a
  where a.class_id = p_class_id;

  if v_reserved_count >= v_capacity then
    raise exception 'This class is full';
  end if;

  select cp.id, p.is_unlimited
  into v_client_package_id, v_is_unlimited
  from public.client_packages as cp
  join public.packages as p on p.id = cp.package_id
  where cp.client_id = v_client_id
    and cp.payment_status = 'paid'
    and p.service_type = 'group'
    and (p.is_unlimited or coalesce(cp.classes_remaining, 0) > 0)
    and cp.start_date <= (v_starts_at at time zone v_timezone)::date
    and (cp.expiration_date is null or cp.expiration_date >= (v_starts_at at time zone v_timezone)::date)
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date, cp.id
  limit 1
  for update of cp;

  if v_client_package_id is null then
    raise exception 'No active group class pass is available';
  end if;

  if v_is_unlimited then
    v_remaining_after := null;
  else
    update public.client_packages as cp
    set classes_remaining = cp.classes_remaining - 1
    where cp.id = v_client_package_id
    returning cp.classes_remaining into v_remaining_after;
  end if;

  insert into public.bookings (
    client_id,
    service_type,
    class_id,
    client_package_id,
    session_title,
    starts_at,
    ends_at,
    coach_name,
    cancellation_cutoff_at
  )
  values (
    v_client_id,
    'group',
    p_class_id,
    v_client_package_id,
    v_title,
    v_starts_at,
    v_ends_at,
    v_coach_name,
    v_cancellation_cutoff_at
  )
  returning id into v_booking_id;

  insert into public.attendance (
    class_id,
    client_id,
    client_package_id,
    booking_id,
    checked_in_at
  )
  values (
    p_class_id,
    v_client_id,
    v_client_package_id,
    v_booking_id,
    null
  );

  return query
  select v_booking_id, v_remaining_after, v_is_unlimited, v_cancellation_cutoff_at;
end;
$$;

revoke execute on function public.book_my_group_class(bigint) from public, anon;
grant execute on function public.book_my_group_class(bigint) to authenticated;

create or replace function public.book_my_pt_slot(p_availability_slot_id bigint)
returns table (
  booking_id bigint,
  remaining_after integer,
  is_unlimited boolean,
  cancellation_cutoff_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id bigint;
  v_coach_user_id uuid;
  v_coach_name text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_timezone text;
  v_cancellation_window_hours integer;
  v_client_package_id bigint;
  v_is_unlimited boolean := false;
  v_remaining_after integer;
  v_cancellation_cutoff_at timestamptz;
  v_class_id bigint;
  v_booking_id bigint;
  v_duration_minutes integer;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select c.id
  into v_client_id
  from public.clients as c
  where c.user_id = v_user_id;

  if v_client_id is null then
    raise exception 'A linked client profile is required';
  end if;

  select
    ca.coach_user_id,
    cp.display_name,
    ca.starts_at,
    ca.ends_at,
    gs.timezone,
    gs.cancellation_window_hours
  into
    v_coach_user_id,
    v_coach_name,
    v_starts_at,
    v_ends_at,
    v_timezone,
    v_cancellation_window_hours
  from public.coach_availability as ca
  join public.coach_profiles as cp on cp.user_id = ca.coach_user_id
  cross join public.gym_settings as gs
  where ca.id = p_availability_slot_id
    and ca.status = 'available'
    and cp.is_active
    and gs.id
  for update of ca;

  if v_coach_user_id is null then
    raise exception 'This personal training slot is no longer available';
  end if;

  if v_starts_at <= now() then
    raise exception 'This personal training slot has already started';
  end if;

  if exists (
    select 1
    from public.bookings as b
    where b.availability_slot_id = p_availability_slot_id
      and b.status = 'booked'
  ) then
    raise exception 'This personal training slot is already booked';
  end if;

  select cp.id, p.is_unlimited
  into v_client_package_id, v_is_unlimited
  from public.client_packages as cp
  join public.packages as p on p.id = cp.package_id
  where cp.client_id = v_client_id
    and cp.payment_status = 'paid'
    and p.service_type = 'personal_training'
    and (p.is_unlimited or coalesce(cp.classes_remaining, 0) > 0)
    and cp.start_date <= (v_starts_at at time zone v_timezone)::date
    and (cp.expiration_date is null or cp.expiration_date >= (v_starts_at at time zone v_timezone)::date)
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date, cp.id
  limit 1
  for update of cp;

  if v_client_package_id is null then
    raise exception 'No personal training credit is available';
  end if;

  if v_is_unlimited then
    v_remaining_after := null;
  else
    update public.client_packages as cp
    set classes_remaining = cp.classes_remaining - 1
    where cp.id = v_client_package_id
    returning cp.classes_remaining into v_remaining_after;
  end if;

  v_duration_minutes := greatest(15, extract(epoch from (v_ends_at - v_starts_at))::integer / 60);
  v_cancellation_cutoff_at := v_starts_at - make_interval(hours => v_cancellation_window_hours);

  insert into public.classes (
    title,
    class_type,
    scheduled_date,
    start_time,
    duration_minutes,
    capacity,
    is_client_bookable,
    coach_user_id
  )
  values (
    'Personal Training',
    'Personal Training',
    (v_starts_at at time zone v_timezone)::date,
    (v_starts_at at time zone v_timezone)::time,
    v_duration_minutes,
    1,
    false,
    v_coach_user_id
  )
  returning id into v_class_id;

  insert into public.bookings (
    client_id,
    service_type,
    class_id,
    availability_slot_id,
    client_package_id,
    session_title,
    starts_at,
    ends_at,
    coach_name,
    cancellation_cutoff_at
  )
  values (
    v_client_id,
    'personal_training',
    v_class_id,
    p_availability_slot_id,
    v_client_package_id,
    'Personal Training',
    v_starts_at,
    v_ends_at,
    v_coach_name,
    v_cancellation_cutoff_at
  )
  returning id into v_booking_id;

  insert into public.attendance (
    class_id,
    client_id,
    client_package_id,
    booking_id,
    checked_in_at
  )
  values (
    v_class_id,
    v_client_id,
    v_client_package_id,
    v_booking_id,
    null
  );

  update public.coach_availability as ca
  set status = 'booked'
  where ca.id = p_availability_slot_id;

  return query
  select v_booking_id, v_remaining_after, v_is_unlimited, v_cancellation_cutoff_at;
end;
$$;

revoke execute on function public.book_my_pt_slot(bigint) from public, anon;
grant execute on function public.book_my_pt_slot(bigint) to authenticated;

create or replace function public.cancel_my_booking(p_booking_id bigint)
returns table (
  booking_id bigint,
  credit_refunded boolean,
  cancellation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id bigint;
  v_service_type text;
  v_class_id bigint;
  v_slot_id bigint;
  v_client_package_id bigint;
  v_starts_at timestamptz;
  v_cutoff_at timestamptz;
  v_status text;
  v_refundable boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select
    b.client_id,
    b.service_type,
    b.class_id,
    b.availability_slot_id,
    b.client_package_id,
    b.starts_at,
    b.cancellation_cutoff_at,
    b.status
  into
    v_client_id,
    v_service_type,
    v_class_id,
    v_slot_id,
    v_client_package_id,
    v_starts_at,
    v_cutoff_at,
    v_status
  from public.bookings as b
  join public.clients as c on c.id = b.client_id
  where b.id = p_booking_id
    and c.user_id = v_user_id
  for update of b;

  if v_client_id is null then
    raise exception 'Booking not found';
  end if;

  if v_status <> 'booked' then
    raise exception 'Only upcoming bookings can be cancelled';
  end if;

  if v_starts_at <= now() then
    raise exception 'Bookings cannot be cancelled after the session starts';
  end if;

  v_refundable := now() <= v_cutoff_at;

  if v_refundable and v_client_package_id is not null then
    update public.client_packages as cp
    set classes_remaining = coalesce(cp.classes_remaining, 0) + 1
    from public.packages as p
    where cp.id = v_client_package_id
      and p.id = cp.package_id
      and not p.is_unlimited;
  end if;

  delete from public.attendance as a
  where a.booking_id = p_booking_id;

  update public.bookings as b
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = case when v_refundable then 'client' else 'late_client' end,
      credit_refunded_at = case when v_refundable then now() else null end
  where b.id = p_booking_id;

  if v_service_type = 'personal_training' then
    update public.coach_availability as ca
    set status = 'available'
    where ca.id = v_slot_id
      and ca.starts_at > now();

    delete from public.classes as c
    where c.id = v_class_id;
  end if;

  return query
  select
    p_booking_id,
    v_refundable,
    case when v_refundable then 'cancelled_refunded' else 'cancelled_late' end::text;
end;
$$;

revoke execute on function public.cancel_my_booking(bigint) from public, anon;
grant execute on function public.cancel_my_booking(bigint) to authenticated;

create or replace function public.finalize_my_past_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id bigint;
  v_updated integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select c.id
  into v_client_id
  from public.clients as c
  where c.user_id = (select auth.uid());

  if v_client_id is null then
    raise exception 'A linked client profile is required';
  end if;

  update public.bookings as b
  set status = 'no_show'
  where b.client_id = v_client_id
    and b.status = 'booked'
    and b.ends_at < now();

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.finalize_my_past_bookings() from public, anon;
grant execute on function public.finalize_my_past_bookings() to authenticated;

create or replace function public.process_check_in(
  p_class_id bigint,
  p_client_id bigint
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_class_type text;
  v_service_type text;
  v_attendance_id bigint;
  v_booking_id bigint;
  v_existing_package_id bigint;
  v_checked_in_at timestamptz;
  v_client_package_id bigint;
  v_is_unlimited boolean := false;
begin
  select c.class_type
  into v_class_type
  from public.classes as c
  where c.id = p_class_id;

  if not found then
    return false;
  end if;

  select a.id, a.booking_id, a.client_package_id, a.checked_in_at
  into v_attendance_id, v_booking_id, v_existing_package_id, v_checked_in_at
  from public.attendance as a
  where a.class_id = p_class_id
    and a.client_id = p_client_id
  order by a.id
  limit 1
  for update of a;

  if v_existing_package_id is not null then
    if v_checked_in_at is null then
      update public.attendance as a
      set checked_in_at = now()
      where a.id = v_attendance_id;

      update public.bookings as b
      set status = 'attended'
      where b.id = v_booking_id
        and b.status in ('booked', 'no_show');
    end if;
    return true;
  end if;

  v_service_type := case
    when v_class_type = 'Personal Training' then 'personal_training'
    else 'group'
  end;

  select cp.id, p.is_unlimited
  into v_client_package_id, v_is_unlimited
  from public.client_packages as cp
  join public.packages as p on p.id = cp.package_id
  where cp.client_id = p_client_id
    and cp.payment_status = 'paid'
    and (p.is_unlimited or coalesce(cp.classes_remaining, 0) > 0)
    and (cp.expiration_date is null or cp.expiration_date >= current_date)
    and p.service_type = v_service_type
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date, cp.id
  limit 1
  for update of cp;

  if v_client_package_id is null then
    return false;
  end if;

  if not v_is_unlimited then
    update public.client_packages as cp
    set classes_remaining = cp.classes_remaining - 1
    where cp.id = v_client_package_id;
  end if;

  if v_attendance_id is null then
    insert into public.attendance (class_id, client_id, client_package_id, checked_in_at)
    values (p_class_id, p_client_id, v_client_package_id, now());
  else
    update public.attendance as a
    set client_package_id = v_client_package_id,
        checked_in_at = now()
    where a.id = v_attendance_id;
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
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_class_type text;
  v_attendance_id bigint;
  v_booking_id bigint;
  v_existing_package_id bigint;
  v_existing_remaining integer;
  v_existing_checked_in_at timestamptz;
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

  select a.id, a.booking_id, a.client_package_id, cp.classes_remaining, a.checked_in_at
  into v_attendance_id, v_booking_id, v_existing_package_id, v_existing_remaining, v_existing_checked_in_at
  from public.attendance as a
  left join public.client_packages as cp on cp.id = a.client_package_id
  where a.class_id = p_class_id
    and a.client_id = p_client_id
  order by a.id
  limit 1
  for update of a;

  if v_existing_package_id is not null then
    if v_existing_checked_in_at is null then
      update public.attendance as a
      set checked_in_at = now()
      where a.id = v_attendance_id;

      update public.bookings as b
      set status = 'attended'
      where b.id = v_booking_id
        and b.status in ('booked', 'no_show');

      return query
      select v_attendance_id, p_client_id, true, v_existing_package_id, v_existing_remaining, 'checked_in'::text;
    else
      return query
      select v_attendance_id, p_client_id, true, v_existing_package_id, v_existing_remaining, 'already_checked_in'::text;
    end if;
    return;
  end if;

  if v_attendance_id is null then
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
  order by p.is_unlimited desc, cp.expiration_date asc nulls last, cp.start_date, cp.id
  limit 1
  for update of cp;

  if v_client_package_id is null then
    return query
    select v_attendance_id, p_client_id, false, null::bigint, null::integer, 'no_active_package'::text;
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
  set client_package_id = v_client_package_id,
      checked_in_at = now()
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
set search_path = ''
as $$
declare
  v_attendance_id bigint;
  v_booking_id bigint;
  v_client_package_id bigint;
  v_is_unlimited boolean := false;
begin
  select a.id, a.booking_id, a.client_package_id, coalesce(p.is_unlimited, false)
  into v_attendance_id, v_booking_id, v_client_package_id, v_is_unlimited
  from public.attendance as a
  left join public.client_packages as cp on cp.id = a.client_package_id
  left join public.packages as p on p.id = cp.package_id
  where a.class_id = p_class_id
    and a.client_id = p_client_id
    and a.client_package_id is not null
    and a.checked_in_at is not null
  order by a.id
  limit 1
  for update of a;

  if v_attendance_id is null then
    return false;
  end if;

  if v_booking_id is not null then
    update public.attendance as a
    set checked_in_at = null
    where a.id = v_attendance_id;

    update public.bookings as b
    set status = 'booked'
    where b.id = v_booking_id
      and b.status = 'attended';
  else
    if not v_is_unlimited then
      update public.client_packages as cp
      set classes_remaining = coalesce(cp.classes_remaining, 0) + 1
      where cp.id = v_client_package_id;
    end if;

    update public.attendance as a
    set client_package_id = null,
        checked_in_at = null
    where a.id = v_attendance_id;
  end if;

  return true;
end;
$$;

create or replace function public.cancel_session(p_class_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_class_id bigint;
begin
  select c.id
  into v_class_id
  from public.classes as c
  where c.id = p_class_id
  for update;

  if v_class_id is null then
    return false;
  end if;

  update public.client_packages as cp
  set classes_remaining = coalesce(cp.classes_remaining, 0) + restored.used_count
  from (
    select a.client_package_id, count(*)::integer as used_count
    from public.attendance as a
    join public.client_packages as held_package on held_package.id = a.client_package_id
    join public.packages as p on p.id = held_package.package_id
    where a.class_id = p_class_id
      and a.client_package_id is not null
      and not p.is_unlimited
    group by a.client_package_id
  ) as restored
  where cp.id = restored.client_package_id;

  update public.bookings as b
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = 'admin',
      credit_refunded_at = now()
  where b.class_id = p_class_id
    and b.status in ('booked', 'attended');

  update public.coach_availability as ca
  set status = 'available'
  where ca.id in (
    select b.availability_slot_id
    from public.bookings as b
    where b.class_id = p_class_id
      and b.availability_slot_id is not null
  )
    and ca.starts_at > now();

  delete from public.attendance as a
  where a.class_id = p_class_id;

  delete from public.classes as c
  where c.id = p_class_id;

  return true;
end;
$$;

create or replace function public.generate_classes_from_templates(
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    return 0;
  end if;

  perform pg_advisory_xact_lock(20260818, 1);

  insert into public.classes (
    template_id,
    title,
    class_type,
    scheduled_date,
    start_time,
    duration_minutes,
    capacity,
    is_client_bookable
  )
  select
    ct.id,
    ct.title,
    ct.class_type,
    generated.day::date,
    ct.start_time,
    ct.duration_minutes,
    ct.capacity,
    ct.is_client_bookable
  from public.class_templates as ct
  cross join generate_series(p_start_date, p_end_date, interval '1 day') as generated(day)
  where ct.day_of_week in (
      extract(dow from generated.day)::integer,
      extract(isodow from generated.day)::integer
    )
    and not exists (
      select 1
      from public.classes as c
      where c.template_id = ct.id
        and c.scheduled_date = generated.day::date
    );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.process_check_in(bigint, bigint) from public, anon;
grant execute on function public.process_check_in(bigint, bigint) to authenticated;

revoke execute on function public.add_group_roster_check_in(bigint, bigint) from public, anon;
grant execute on function public.add_group_roster_check_in(bigint, bigint) to authenticated;

revoke execute on function public.undo_check_in(bigint, bigint) from public, anon;
grant execute on function public.undo_check_in(bigint, bigint) to authenticated;

revoke execute on function public.cancel_session(bigint) from public, anon;
grant execute on function public.cancel_session(bigint) to authenticated;

revoke execute on function public.generate_classes_from_templates(date, date) from public, anon;
grant execute on function public.generate_classes_from_templates(date, date) to authenticated;

alter function public.create_client_and_group_check_in(bigint, text)
set search_path = '';

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
    ) then
      alter publication supabase_realtime add table public.bookings;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coach_availability'
    ) then
      alter publication supabase_realtime add table public.coach_availability;
    end if;
  end if;
end $$;
