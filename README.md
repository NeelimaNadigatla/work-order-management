# Maintenance Work Order Management

A small full-stack application for registering assets and technicians, raising maintenance work orders,
assigning technicians, tracking status through a controlled workflow, and viewing maintenance history.

- **Backend:** Node.js 22+/24, Express 5, SQLite (Node's built-in `node:sqlite`), Zod validation
- **Frontend:** React 18 + Vite (three screens)
- **Tests:** Node's built-in test runner + Supertest (45 tests)

## Quick start

Requires **Node.js 22.13 or newer** (developed on Node 24). There is no database server to install: SQLite runs in-process.

```bash
# 1. API (http://localhost:4000)
cd server
npm install
npm run seed      # creates server/data/workorders.db with sample data (re-run to reset; stop the API first on Windows)
npm start

# 2. UI (http://localhost:5173), in a second terminal
cd client
npm install
npm run dev

# 3. Tests
cd server
npm test
```

The Vite dev server proxies `/api` to `localhost:4000`.

## Project structure

```
server/
  src/
    db/migrations/001_init.sql   schema: tables, FKs, CHECKs, indexes, trigger
    db/index.js                  connection, migration runner, transaction helper
    db/seed.js                   sample data, loaded through the services
    domain/workOrderRules.js     pure business rules + status state machine
    services/                    asset, technician and work-order logic (SQL lives here)
    validation.js                Zod request schemas
    app.js                       Express routes + error handling
  test/                          unit tests (rules) + API tests (every rule, filters, lifecycle)
client/
  src/pages/                     WorkOrderList, CreateWorkOrder, WorkOrderDetails
```

Routes are thin (parse → call service → respond). Services own data access and orchestration.
The rules themselves are pure functions in `domain/workOrderRules.js`, so they can be unit tested
without a database and there is exactly one place to change them.

## Database design

```
ASSETS 1 ──── N WORK_ORDERS N ──── 1 MAINTENANCE_TYPES
                    │  N
                    │
                    │  0..1
               TECHNICIANS

WORK_ORDERS 1 ──── N WORK_ORDER_STATUS_HISTORY
```

| Table | Purpose / notable constraints |
|---|---|
| `assets` | `asset_code` (the business "Asset ID") is **unique, case-insensitive**. `(manufacturer, serial_number)` is unique. `usage_hours`/`usage_cycles` are `CHECK >= 0`. Status is one of `ACTIVE, UNDER_MAINTENANCE, OUT_OF_SERVICE, RETIRED`. |
| `technicians` | Status is one of `ACTIVE, ON_LEAVE, INACTIVE`. Whether a technician is busy is *derived* from their open work orders, not stored, so it can't drift. |
| `maintenance_types` | Lookup table with an `is_emergency` flag. Rule 6 asks whether the type is "explicitly marked as an emergency". Storing that as data means new emergency types need no code change. |
| `work_orders` | FKs to asset, maintenance type and (nullable) technician, all `ON DELETE RESTRICT` so history can't be orphaned. `work_order_number` is **unique, case-insensitive**. Enum `CHECK`s on priority/status. Table-level `CHECK`s: a CRITICAL order has a technician; ASSIGNED, IN_PROGRESS and COMPLETED orders have a technician; `completed_at` is set **iff** status is COMPLETED; `cancelled_at` is set iff CANCELLED. Indexes on every filter column (`status`, `priority`, `asset_id`, `technician_id`, `maintenance_type_id`, `scheduled_date`). |
| `work_order_status_history` | Append-only audit trail: from/to status, technician, note and timestamp. It powers the history timeline. |

**Timestamps:** `created_at`/`updated_at` on every table, plus `started_at`, `completed_at` and `cancelled_at` on
work orders. They are ISO-8601 UTC. `scheduled_date` is a calendar date (`YYYY-MM-DD`), because it is a date, not an instant.

**Defence in depth:** every business rule is checked in the service layer, which gives clear 4xx error messages.
The important ones are *also* enforced by the database (unique indexes, CHECK constraints, and a trigger that
makes COMPLETED/CANCELLED terminal), so a bug or a manual SQL update can't corrupt the data.

**Why SQLite:** zero setup for the reviewer, with real foreign keys, CHECK constraints, unique indexes and
triggers. The SQL is standard. Moving to PostgreSQL would mean swapping `INTEGER PRIMARY KEY AUTOINCREMENT` for
`GENERATED ALWAYS AS IDENTITY`, the `TEXT` timestamps for `TIMESTAMPTZ`/`DATE`, `COLLATE NOCASE` for `CITEXT` or a
`lower()` unique index, the enums for Postgres enum types, and the trigger syntax for PL/pgSQL.

## Business rules

| # | Rule | Where it's enforced | Error |
|---|---|---|---|
| 1 | Work order number is unique | Service check (case-insensitive) + unique index | `409 DUPLICATE_WORK_ORDER_NUMBER` |
| 2 | CRITICAL orders must have a technician | Service check on create **and** update (raising priority, removing the technician) + table `CHECK` | `422 CRITICAL_REQUIRES_TECHNICIAN` |
| 3 | COMPLETED can't return to OPEN | State machine (COMPLETED is terminal) + DB trigger | `422 COMPLETED_IS_FINAL` |
| 4 | CANCELLED can't move to IN_PROGRESS | State machine (CANCELLED is terminal) + DB trigger | `422 CANCELLED_IS_FINAL` |
| 5 | New order can't be scheduled in the past | Service check on create, and on reschedule | `422 SCHEDULED_DATE_IN_PAST` |
| 6 | OUT_OF_SERVICE asset only accepts emergency work | Service check on create, **and** when an order's maintenance type is changed (so it can't be bypassed by creating as EMERGENCY and then switching) | `422 ASSET_OUT_OF_SERVICE` |

**Status workflow:**

```
OPEN ──► ASSIGNED ──► IN_PROGRESS ──► COMPLETED
  │          │
  └──────────┴──► CANCELLED
```

Anything else is rejected with `422 INVALID_STATUS_TRANSITION`. Each response includes `allowed_transitions`, so
the UI only offers valid actions without duplicating the state machine.

### Additional rules and assumptions

- **Assignment drives status.** Creating an order with a technician starts it as `ASSIGNED`. Giving an `OPEN`
  order a technician moves it to `ASSIGNED`. Moving to `ASSIGNED` without a technician is rejected.
- Once an order is ASSIGNED or later, its technician can be **reassigned** but not removed. Reassignment is logged in the history.
- Only `ACTIVE` technicians can be assigned (`ON_LEAVE`/`INACTIVE` give `422 TECHNICIAN_UNAVAILABLE`).
- `RETIRED` assets can't receive any new work orders, emergency or not.
- COMPLETED/CANCELLED orders are read-only (`422 WORK_ORDER_CLOSED`) to protect the maintenance record.
- An order's `asset_id` can't be changed after creation.
- An asset's usage hours and cycles are meter readings, so they can't decrease (`422 USAGE_CANNOT_DECREASE`).
- Cancellation is only allowed from OPEN and ASSIGNED, per the spec. An IN_PROGRESS order must be completed.
- "Today" for Rule 5 is the server's **local** date. Using UTC would wrongly reject "today" for users east of UTC
  (e.g. IST) after midnight local time.
- Work order numbers are generated as `WO-1001`, `WO-1002`, … when not supplied. Supplied numbers are upper-cased,
  and the generator skips numbers that are already taken.

## API

All bodies are JSON. Errors have one shape:

```json
{ "error": { "code": "CRITICAL_REQUIRES_TECHNICIAN", "message": "A CRITICAL work order must have an assigned technician", "details": [] } }
```

Status codes: `400` validation (with per-field `details`), `404` unknown id, `409` uniqueness conflict, `422` business rule.

### Assets
| Method | Path | Notes |
|---|---|---|
| POST | `/api/assets` | `asset_code, asset_type, manufacturer, model, serial_number`, optional `usage_hours, usage_cycles, status` |
| GET | `/api/assets` | `?status=OUT_OF_SERVICE&q=pump` |
| GET | `/api/assets/{id}` | |
| PUT | `/api/assets/{id}` | Partial update of any field above |
| GET | `/api/assets/{id}/work-orders` | Maintenance history for the asset |

### Technicians
| Method | Path | Notes |
|---|---|---|
| POST | `/api/technicians` | `name, skill`, optional `status` |
| GET | `/api/technicians` | `?status=ACTIVE&q=hydraulics` |
| GET | `/api/technicians/{id}` | Includes `open_work_orders` count |
| PUT | `/api/technicians/{id}` | Extra: update name/skill/status (e.g. mark ON_LEAVE) |

### Work orders
| Method | Path | Notes |
|---|---|---|
| POST | `/api/work-orders` | `asset_id, maintenance_type_id, description, priority, scheduled_date`, optional `technician_id, work_order_number` |
| GET | `/api/work-orders` | Filters: `status`, `priority`, `asset_id`, `technician_id`, `maintenance_type_id`, `q` (searches number, description, asset code, technician name), `limit` (≤200), `offset`. Filters combine with AND. Returns `{ data, total, limit, offset }`. |
| GET | `/api/work-orders/{id}` | Includes nested asset, technician and maintenance type, plus `allowed_transitions` |
| PUT | `/api/work-orders/{id}` | Partial: `status, technician_id, priority, description, scheduled_date, maintenance_type_id, work_order_number`, optional `note` (stored in history) |
| GET | `/api/work-orders/{id}/history` | Status/assignment audit trail |
| GET | `/api/maintenance-types` | Lookup list including `is_emergency` |

Example:

```bash
curl -X POST localhost:4000/api/work-orders -H "Content-Type: application/json" \
  -d '{"asset_id":1,"maintenance_type_id":1,"priority":"HIGH","scheduled_date":"2030-01-01","description":"Inspect seals"}'

curl -X PUT localhost:4000/api/work-orders/1 -H "Content-Type: application/json" -d '{"technician_id":2}'
curl -X PUT localhost:4000/api/work-orders/1 -H "Content-Type: application/json" -d '{"status":"IN_PROGRESS"}'
curl "localhost:4000/api/work-orders?status=IN_PROGRESS&priority=HIGH"
```

## Frontend

The UI is deliberately modest, as the brief asks:

1. **Work Order List.** Debounced search plus status and priority filters, and a "+ New" button. Click a row to open it.
2. **Create Work Order.** A simple form. Inline hints mirror the rules (CRITICAL needs a technician,
   OUT_OF_SERVICE assets need emergency work, no past dates), but the server stays the authority and its errors are shown as-is.
3. **Work Order Details.** Shows the work order, asset, technician, maintenance type, priority, status, description
   and dates. It offers assign/reassign and only the status actions the API says are valid, and asks for confirmation before cancelling.
   It also shows the status-history timeline and the asset's other work orders.

## Testing

`npm test` in `server/` runs 45 tests against an in-memory database with a fixed clock:

- **Unit tests** for the state machine and each rule.
- **API tests** for every rule. Each is tested through HTTP, including the bypass paths: raising priority to CRITICAL
  on an unassigned order, switching an emergency order on an OUT_OF_SERVICE asset to a routine type, and rescheduling
  into the past.
- **DB-level tests** proving the unique index and terminal-status trigger hold even when the API is bypassed.
- Filtering, search, validation errors, 404s and the full lifecycle with history.

## What I'd do with more time

- Authentication and roles (e.g. only supervisors cancel), with `changed_by` recorded in the history.
- Optimistic concurrency (`updated_at`/version check on PUT) so two people can't overwrite each other.
- PostgreSQL + a migration tool (e.g. Knex/Prisma) for production, and Docker Compose for one-command startup.
- Asset and technician management screens (currently API-only, plus seed data).
- OpenAPI spec generated from the Zod schemas, and frontend tests (Vitest + Testing Library / Playwright).
