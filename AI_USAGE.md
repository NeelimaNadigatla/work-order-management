# AI Usage

## AI tools used

- **Claude Code** (Anthropic, Claude Opus 5.5 model) in the Claude desktop app.

## What AI assisted with

- Reading the assignment brief and turning it into a schema, API and rule-enforcement plan.
- Generating the code for the project:
  - SQL schema and migration runner
  - Express routes, services and Zod validation
  - React screens and CSS
- Writing the test suite (45 tests) and the README.
- Checking the UI in a browser:
  - The list loads and filters by priority.
  - The create form shows the Rule 6 error for an OUT_OF_SERVICE asset with a non-emergency type.
  - Creation succeeds with Emergency Repair.
  - A work order moves through OPEN → ASSIGNED → IN_PROGRESS → COMPLETED, and the history timeline updates.

## What I did

- Reviewed the generated project and a walkthrough of its design: data model, business rules, request flow and tests.

## Bugs / issues identified in AI-generated output

These came up during development and were fixed:

1. **Test harness bug.** The first version of the test helper reused a single Supertest agent across requests.
   Supertest closes its server after the first request, so most API tests failed with
   `Cannot read properties of null (reading 'address')`. The fix creates a fresh agent per request (`test/helpers.js`).
2. **Circular import in the frontend.** The pages imported `navigate` from `App.jsx`, while `App.jsx` imported the
   pages. `navigate` moved to its own module (`navigation.js`).
3. **Rule 6 bypass.** Checking Rule 6 only on create would let an `EMERGENCY_REPAIR` order on an OUT_OF_SERVICE asset
   be edited to `INSPECTION` afterwards. The rule is re-checked when the maintenance type changes, with a test.
4. **Rule 2 on updates.** Raising priority to CRITICAL, or removing the technician from a CRITICAL order, is also
   blocked, not just creating one without a technician.
5. **Timezone in Rule 5.** Comparing against the UTC date would reject "today" for users in IST between midnight and
   05:30. "Today" is computed in local time, and the tests pin the clock.

## Significant AI-generated code that I modified

None yet.

## Important technical decisions

- **SQLite instead of PostgreSQL**, so the project runs with zero setup. The schema still uses foreign keys, CHECK
  constraints, unique indexes and a trigger. The README describes the PostgreSQL migration path.
- **`maintenance_types` as a table with an `is_emergency` flag**, so Rule 6's "explicitly marked as an emergency" is data.
- **Rules enforced twice**: in the service layer for clear errors, and in the database as a safety net.
- **COMPLETED and CANCELLED are terminal and read-only**, which satisfies Rules 3 and 4 by construction.
- **Assigning a technician moves an OPEN order to ASSIGNED automatically.**
- **`422` for business-rule violations and `409` for uniqueness conflicts**, separate from `400` validation errors.
- **A status history table** for maintenance history and an audit trail.
