# Database Schema: Gonza Boxing

This file serves as the source of truth for the Supabase Postgres database layout. Refer to this schema before writing any database migrations, edge functions, or application-level queries.

## Table `clients`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `first_name` | `text` |  |
| `last_name` | `text` |  |
| `phone` | `text` |  Nullable |
| `email` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `packages`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `name` | `text` |  |
| `price` | `numeric` |  |
| `total_classes` | `int4` | Nullable for unlimited packages |
| `expires_in_weeks` | `int4` |  Nullable |
| `service_type` | `text` |  `group` or `personal_training` |
| `is_unlimited` | `boolean` | Defaults to `false`; when `true`, `total_classes` is `null` |

## Table `client_packages`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `client_id` | `int8` |  |
| `package_id` | `int8` |  |
| `classes_remaining` | `int4` | Nullable for unlimited packages |
| `start_date` | `date` |  |
| `expiration_date` | `date` |  Nullable |
| `payment_status` | `text` |  |

## Table `class_templates`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `title` | `text` |  |
| `class_type` | `text` |  |
| `day_of_week` | `int4` |  |
| `start_time` | `time` |  |
| `end_time` | `time` |  |

## Table `classes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `template_id` | `int8` |  Nullable |
| `title` | `text` |  |
| `class_type` | `text` |  |
| `scheduled_date` | `date` |  |
| `start_time` | `time` |  |

## Table `attendance`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `class_id` | `int8` |  |
| `client_id` | `int8` |  |
| `client_package_id` | `int8` |  Nullable |
| `created_at` | `timestamptz` |  |

### Indexes

| Name | Columns | Purpose |
|------|---------|---------|
| `attendance_class_client_unique` | `class_id`, `client_id` | Prevents duplicate roster entries for the same client in the same class. |

## Table `app_admins`

Owner/staff allowlist for the app. For the first owner TestFlight, only the gym owner's Supabase Auth user should be inserted here.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `user_id` | `uuid` | Primary Key, references `auth.users.id` |
| `created_at` | `timestamptz` |  |

## Security

Row Level Security is enabled on `clients`, `packages`, `client_packages`, `classes`, `attendance`, `class_templates`, and `app_admins`.

- `authenticated` users can read/write gym data only when their `auth.users.id` exists in `app_admins`.
- `anon` has no table access.
- `app_admins` is managed manually from Supabase SQL/editor tools; app users cannot insert/update/delete allowlist rows.

## RPC Functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `process_check_in(p_class_id bigint, p_client_id bigint)` | `boolean` | Marks attendance checked in with a paid matching package, consuming one credit for finite packages and leaving unlimited packages unchanged. |
| `add_group_roster_check_in(p_class_id bigint, p_client_id bigint)` | `table` | Adds an existing client to a group roster with a paid group package, consuming one credit for finite packages and leaving unlimited packages unchanged, returning row status such as `checked_in`, `last_class`, `no_active_package`, or `already_checked_in`. |
| `create_client_and_group_check_in(p_class_id bigint, p_full_name text)` | `table` | Creates a walk-in client, attaches the `First Class Free` group package, and checks them into the group roster. |
| `undo_check_in(p_class_id bigint, p_client_id bigint)` | `boolean` | Restores one consumed finite package credit when applicable and clears `attendance.client_package_id`. |
| `cancel_session(p_class_id bigint)` | `boolean` | Restores checked-in finite package credits for a class, deletes attendance rows, then deletes the class. |
| `generate_classes_from_templates(p_start_date date, p_end_date date)` | `integer` | Inserts missing scheduled classes from `class_templates` within a date range. |
