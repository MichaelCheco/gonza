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
| `total_classes` | `int4` |  |
| `expires_in_weeks` | `int4` |  Nullable |
| `service_type` | `text` |  `group` or `personal_training` |

## Table `client_packages`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `int8` | Primary Identity |
| `client_id` | `int8` |  |
| `package_id` | `int8` |  |
| `classes_remaining` | `int4` |  |
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
