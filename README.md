# Ryda backend — fixes from this session (round 2)

Extract into your backend repo root; paths already match `src/...`.

## Migrations (run in order — already timestamped correctly, after the
## four from the previous round: 1789900000000, 1790000000000,
## 1790100000000)

- `1790200000000-AddMissingIncidentStatusEnumValues.ts`
  Adds `'responding'` and `'escalated'` to `incidents_status_enum`.
  Fixes: Emergency Center's "Respond"/"Escalate" actions, which failed
  with `invalid input value for enum incidents_status_enum` since
  InitialSchema only ever created the enum with 4 of the 6 values the
  code actually uses.

- `1790300000000-AddRemainingMissingColumnsAndEnumValues.ts`
  Found by a full audit of every enum column's code-side values against
  the database. Adds:
  - `notifications.category`, `incidents.severity`,
    `delivery_orders.vehicleType` — columns that never existed at all.
  - Missing enum values on `wallet_transactions_category_enum`,
    `fraud_flags_type_enum`, `driver_availability_logs_status_enum` /
    `driver_profiles_availability_enum`, `support_tickets_category_enum`.

- `1790400000000-CreateRiskAlertsTable.ts`
  Creates the `risk_alerts` table — fully wired into
  `safety-monitoring.service.ts` and the admin Emergency Center's
  risk-alert endpoints, but never had any migration.

- `1790500000000-AddMissingOtpCodeColumns.ts`
  Adds `purpose` and `attemptCount` to `otp_codes` — missing since
  InitialSchema. This is what was causing `POST /auth/otp/send` (and
  likely OTP-confirmed wallet transfers/withdrawals) to fail instantly
  with a generic 500.

**Note on how these were found:** the entity-vs-migration audit that
found the first four migrations only scanned `src/**/entities/*.entity.ts`.
`otp-code.entity.ts` lives directly under `src/otp/`, not an `entities/`
folder, so it was missed until the OTP bug surfaced directly. Re-ran the
audit with a broader glob (`src/**/*.entity.ts`) afterward — everything
else came back clean.

**Deploy:** commit, push. Your start command already runs
`npm run migration:run` before `start:prod`.

## Health endpoint fix
- `src/health/health.controller.ts` — added a bare `GET /health`
  (liveness: "is the process up", zero dependency checks). The existing
  `GET /health/all` is a deep readiness check that returns 503 if
  Paystack, Google Maps, Redis, or the dispatch queue is unhealthy —
  wrong thing to point a connectivity probe at (see passenger-app
  README). This also fixes `render.yaml`'s `healthCheckPath: /api/v1/health`,
  which never matched a real route before now.

Verified: full `tsc --noEmit` typecheck clean, full test suite
(62 suites / 802 tests) still passing.
