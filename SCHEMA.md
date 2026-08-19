# Database Schema: Gonza Boxing

This file is the source of truth for the Supabase Postgres layout. Read it before writing migrations, database functions, or application queries.

## Access model

- Supabase Auth owns login identities in `auth.users`.
- `app_admins.user_id` is the owner/staff allowlist.
- `clients.user_id` links one Auth identity to one member profile.
- An authenticated user is resolved as an admin first, then as a linked client.
- New member accounts can atomically claim one unlinked `clients` row when the confirmed Auth email exactly matches the client email.
- Authorization data is stored in tables, never user-editable Auth metadata.

## Table `clients`

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `user_id` | `uuid` | Nullable unique link to `auth.users.id` |
| `first_name` | `text` | Required |
| `last_name` | `text` | Required |
| `phone` | `text` | Nullable |
| `instagram_handle` | `text` | Nullable |
| `email` | `text` | Nullable; used for initial account linking |
| `emergency_contact_name` | `text` | Nullable |
| `emergency_contact_phone` | `text` | Nullable |
| `experience_level` | `text` | `beginner`, `intermediate`, `advanced`, or `professional` |
| `created_at` | `timestamptz` | Creation time |
| `updated_at` | `timestamptz` | Maintained by trigger |

## Tables `packages` and `client_packages`

`packages` is the entitlement catalog.

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `name` | `text` | Display name |
| `price` | `numeric` | Price |
| `total_classes` | `int4` | Null only for unlimited packages |
| `expires_in_weeks` | `int4` | Nullable |
| `service_type` | `text` | `group` or `personal_training` |
| `is_unlimited` | `boolean` | Unlimited packages keep null balances |
| `package_kind` | `text` | `membership`, `class_pack`, `drop_in`, or `promotion` |

`client_packages` is the member entitlement ledger.

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `client_id` | `int8` | References `clients` |
| `package_id` | `int8` | References `packages` |
| `classes_remaining` | `int4` | Null for unlimited packages; never negative |
| `start_date` | `date` | Eligibility start |
| `expiration_date` | `date` | Nullable |
| `payment_status` | `text` | Existing values include `paid`, `unpaid`, and `voided` |

Finite credits are consumed when a booking is created. A cancellation at or before the booking cutoff returns the credit atomically. Late cancellations do not.

## Tables `class_templates` and `classes`

`class_templates` generates recurring group sessions. In addition to title/day/time fields, templates include `duration_minutes`, `capacity`, and `is_client_bookable`.

`classes` stores concrete group classes and booked/admin-created PT sessions.

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `template_id` | `int8` | Nullable reference to `class_templates` |
| `title` | `text` | Session title |
| `class_type` | `text` | Existing group types or `Personal Training` |
| `scheduled_date` | `date` | Gym-local date |
| `start_time` | `time` | Gym-local start time |
| `duration_minutes` | `int4` | 15–480 minutes |
| `capacity` | `int4` | 1–500 |
| `is_client_bookable` | `boolean` | Public group-booking switch |
| `coach_user_id` | `uuid` | Nullable coach Auth ID |

## Table `attendance`

`attendance` remains the admin roster and check-in record. Client reservations create roster rows immediately.

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `class_id` | `int8` | References `classes` |
| `client_id` | `int8` | References `clients` |
| `client_package_id` | `int8` | Held/consumed entitlement |
| `booking_id` | `int8` | Nullable unique reference to `bookings` |
| `checked_in_at` | `timestamptz` | Null for a reservation; set at attendance check-in |
| `created_at` | `timestamptz` | Roster creation time |

`attendance_class_client_unique` prevents duplicate roster entries. A booked row already holds its credit, so check-in marks `checked_in_at` and the booking `attended` without charging twice. Undoing a booked check-in restores the reservation, not the credit.

## Table `app_admins`

Owner/staff allowlist. `user_id uuid` is the primary key and references `auth.users.id`. App users cannot add themselves.

## Table `coach_profiles`

| Name | Type | Notes |
|------|------|-------|
| `user_id` | `uuid` | Primary key; references `app_admins.user_id` |
| `display_name` | `text` | Client-facing coach name |
| `bio` | `text` | Nullable |
| `is_active` | `boolean` | Controls public visibility |
| `created_at`, `updated_at` | `timestamptz` | Audit fields |

A coach profile is created automatically when an Auth user is added to `app_admins`.

## Table `coach_availability`

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `coach_user_id` | `uuid` | References `coach_profiles` |
| `starts_at`, `ends_at` | `timestamptz` | Slot range, up to 8 hours |
| `status` | `text` | `available`, `booked`, or `blocked` |
| `created_at`, `updated_at` | `timestamptz` | Audit fields |

Clients can read only future `available` rows. Booking locks a slot, creates its PT `classes` row, and marks the slot `booked` in one transaction. A client cancellation reopens a future slot.

## Table `bookings`

| Name | Type | Notes |
|------|------|-------|
| `id` | `int8` | Primary identity |
| `client_id` | `int8` | Booking owner |
| `service_type` | `text` | `group` or `personal_training` |
| `class_id` | `int8` | Nullable after a PT/admin cancellation |
| `availability_slot_id` | `int8` | Required for PT; null for group |
| `client_package_id` | `int8` | Entitlement used for booking |
| `session_title` | `text` | Immutable history snapshot |
| `starts_at`, `ends_at` | `timestamptz` | Immutable history snapshot |
| `coach_name` | `text` | Nullable history snapshot |
| `status` | `text` | `booked`, `attended`, `no_show`, or `cancelled` |
| `booked_at` | `timestamptz` | Reservation time |
| `cancellation_cutoff_at` | `timestamptz` | Stored cutoff used by cancellation RPC |
| `cancelled_at`, `cancellation_reason` | mixed | Cancellation audit data |
| `credit_refunded_at` | `timestamptz` | Non-null when timely cancellation restored entitlement |
| `created_at`, `updated_at` | `timestamptz` | Audit fields |

Partial unique indexes prevent duplicate active class/client bookings and double-booking a PT slot.

## Table `gym_settings`

Singleton row (`id = true`) containing:

- `cancellation_window_hours` — defaults to 24.
- `timezone` — defaults to `America/Los_Angeles`.

## Row Level Security

RLS is enabled on every public table.

- Admin policies preserve full management access for users in `app_admins`.
- Clients can select and update only their linked profile row.
- Clients can select only their own entitlements, roster entries, and bookings.
- Authenticated members can select public group sessions/templates, active coaches, future open coach availability, package catalog rows, and gym settings.
- Clients receive no direct insert/update/delete policy for bookings or entitlement balances. Booking writes occur only through identity-derived RPCs.
- `anon` has no table or booking-function access.
- New Data API tables, sequences, and functions use explicit grants.

## Client RPC functions

| Function | Purpose |
|----------|---------|
| `claim_client_profile()` | Returns the current link or claims the one unlinked client row matching the confirmed Auth email |
| `get_bookable_schedule(p_start_at, p_end_at)` | Returns combined group classes and open PT slots with capacity and current-member booking state |
| `book_my_group_class(p_class_id)` | Locks class/capacity and entitlement, deducts one finite group credit, then creates booking and roster rows |
| `book_my_pt_slot(p_availability_slot_id)` | Locks availability and entitlement, deducts one PT credit, creates the PT class/booking/roster, and closes the slot |
| `cancel_my_booking(p_booking_id)` | Locks the caller-owned booking, enforces start/cutoff rules, refunds when eligible, and reopens PT availability |
| `finalize_my_past_bookings()` | Marks the current client's ended, never-checked-in reservations as `no_show` before history is read |

Client mutation RPCs are `SECURITY DEFINER` because clients cannot directly alter credit ledgers or admin-owned schedule rows. Each derives identity from `auth.uid()`, sets an empty search path, schema-qualifies every relation, and is executable only by `authenticated`.

## Admin and legacy RPC functions

| Function | Purpose |
|----------|---------|
| `process_check_in(p_class_id, p_client_id)` | Checks in a PT/group client; booked credits are not charged twice |
| `add_group_roster_check_in(p_class_id, p_client_id)` | Adds/checks in an existing group client and consumes a credit only when no booking holds one |
| `create_client_and_group_check_in(p_class_id, p_full_name)` | Creates a walk-in, attaches First Class Free, and checks in |
| `undo_check_in(p_class_id, p_client_id)` | Restores a reservation for bookings, or restores a finite credit for walk-ins |
| `cancel_session(p_class_id)` | Admin cancellation that refunds held finite credits and cancels linked bookings |
| `generate_classes_from_templates(p_start_date, p_end_date)` | Inserts missing template sessions including duration/capacity/bookability |
