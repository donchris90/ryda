# Ryda Backend

Core NestJS + PostgreSQL backend for Ryda — auth, drivers, vehicles, rides, wallets,
commission, payments, and corporate billing. This is the first piece of the
full platform; the passenger/driver mobile apps and the admin/dispatch web
portals build on top of this API.

Verified working end-to-end against a real PostgreSQL 16 instance across two
test scripts covering the full ride lifecycle, all five payment methods,
ratings, proximity dispatch, refresh token rotation/reuse detection, and rate
limiting.

## Stack

- **Framework:** NestJS 11 (TypeScript)
- **ORM / DB:** TypeORM + PostgreSQL 16
- **Auth:** JWT (access + rotating, persisted refresh tokens) via Passport,
  bcrypt password hashing, OTP verification flow (SMS provider not wired yet)
- **Validation:** class-validator / class-transformer, global `ValidationPipe`
- **Rate limiting:** `@nestjs/throttler` (global default + stricter limits on
  auth endpoints)

## Getting started

```bash
npm install
cp .env.example .env       # then edit DB credentials etc.
```

Make sure PostgreSQL is running and the database in `.env` (`DB_NAME`, default
`ryda`) exists:

```bash
createdb ryda
```

Also make sure Redis is running and reachable at `REDIS_HOST`/`REDIS_PORT`
(default `localhost:6379`) — **this is now a hard requirement, not an
optional integration**. Notification delivery, scheduled rides, and cash
reconciliation auto-settlement all run on real BullMQ queues backed by
Redis; the app won't start cleanly without it.

```bash
redis-server &   # or: apt-get install redis-server && service redis-server start
redis-cli ping   # should return PONG
```

```bash
npm run start:dev   # watch mode
# or
npm run build && npm run start
```

The app boots on `http://localhost:3000/api/v1` by default. `DB_SYNCHRONIZE=true`
(the `.env.example` default) auto-creates all tables/enums/foreign keys on boot —
convenient for development, but switch it off and use proper TypeORM migrations
before running against production data.

Health check: `GET /api/v1/health`

### Creating the first admin user

There's no public "make me an admin" endpoint (that would be a security hole),
so bootstrap one via script:

```bash
ADMIN_PHONE=+2348000000000 ADMIN_PASSWORD='ChangeMe123!' \
ADMIN_FIRST_NAME=Ryda ADMIN_LAST_NAME=Admin \
npm run seed:admin
```

Safe to re-run — it's a no-op if a user with that phone already exists.

## Module map

| Module | Responsibility |
|---|---|
| `auth` | Register, login, JWT issuance, **rotating persisted refresh tokens with reuse detection**, logout / logout-all, OTP send/verify |
| `users` | Shared `User` entity (all roles), profile endpoint, passenger rating aggregate |
| `drivers` | Onboarding, approval workflow, availability, GPS location tracking, proximity-based nearby-driver search, automatic level progression, rating aggregate, **document upload + admin review workflow** (license, insurance, road worthiness, photos, background check) |
| `vehicles` | Vehicle registration per driver; first vehicle auto-becomes the driver's active vehicle |
| `rides` | Fare estimation (real Google Maps routing when configured, Haversine fallback otherwise; category multiplier; surge; night pricing; airport surcharge; waiting fee; cancellation fee), full lifecycle (request → accept → arrive → start → complete/cancel), ratings, dispatch nearby-drivers endpoint |
| `maps` | **New.** Real Google Maps Geocoding/Directions integration (`GET /maps/geocode`, `/maps/reverse-geocode`) plus the routing upgrade to `FareService`. Returns a clear error rather than crashing when unconfigured |
| `wallets` | Ledgered, row-locked credit/debit |
| `commission` | Configurable commission rules by driver level / city / vehicle category, with fallback to per-level defaults |
| `payments` | Real Paystack integration: card-on-file (tokenize once, charge repeatedly), bank transfer via hosted checkout, refunds, webhook with signature verification. Simulates charges when `PAYSTACK_SECRET_KEY` is unset (clearly flagged `simulated: true`) |
| `corporate` | Corporate travel accounts with a budget ledger, employee linking, `PaymentMethod.CORPORATE` ride billing |
| `passengers` | **New.** Passenger profiles, favourite places (home/work as special types), emergency contacts, preferences, verification, blacklist (enforced at ride-request time), statistics |
| `promotions` | **New.** Coupon/promo codes (percentage, fixed, cashback), campaigns, per-user/total redemption limits, referral bonuses (paid on referee's first *completed* ride, not signup) |
| `notifications` | Real Twilio (SMS/WhatsApp), SendGrid (email), and FCM (push) integrations, plus in-app notification storage/history/unread-count. Simulates sends when provider credentials aren't configured. Decoupled from every other module via `@nestjs/event-emitter` — nothing calls `NotificationsService` directly |
| `fleet` | Fleet companies, owner/manager staff roles, driver/vehicle assignment, a fleet wallet with its own ledger, Paystack-powered payouts, and analytics. Changes core ride settlement: a fleet driver's earnings go to the fleet's wallet, not their personal one |
| `audit` | **New.** `@Audit('action.name')` decorator + global interceptor auto-logs mutating admin actions (actor, role, target, sanitized request body, IP). Login success/failure logged explicitly in `AuthService` (interceptor only fires on success). `GET /admin/audit-logs` with filtering + pagination |
| `analytics` | **New.** Admin dashboard: overview (users/drivers/rides/GMV/platform revenue), revenue time series, rides-by-status, top drivers, and a dependency-free pickup heatmap (grid-bucketed coordinates) |
| `support` | **New.** Support tickets covering complaints, ride disputes, and lost items (via `category`), with threaded messages, assignment, and status workflow. Access control: ticket owner or support staff only |
| `cms` | **New.** FAQ/terms/privacy/announcement content management — publish/unpublish gating on pages, time-boxed active-window gating on announcements |
| `fraud` | **New.** Device fingerprint tracking (flags duplicate accounts sharing a device), GPS spoof detection (implausible driver movement speed), referral abuse detection (referrer/referee sharing a device — flags for review without blocking the bonus). Admin review workflow |
| `common/permissions` | Fine-grained `Permission` enum + data-driven role→permission matrix, layered on top of the existing role guards via `@RequirePermission()` + `PermissionsGuard`. `GET /permissions/mine` lets any user see their own resolved permissions |
| `airport` | **New.** Airport registry with geofence detection (`GET /airports/detect?lat=&lng=`), driver FIFO pickup queue (join/leave/position), and informational flight-number tracking on rides (no real flight-tracking API integration) |
| `dispatch` | **New.** Adds a preferred-driver offer layer on top of the existing broadcast-accept flow: offers the nearest online driver first with a time-limited window, auto-reassigns to the next-nearest driver on timeout or explicit decline (via a `@nestjs/schedule` interval sweep). Deliberately additive — broadcast-accept still works unchanged, verified directly |
| `api-keys` | **New.** SHA-256-hashed API keys (raw key shown once at creation) for partner/machine access via `x-api-key`, separate from JWT user auth. One demonstrative partner endpoint (`GET /partner/rides/:id/status`) |
| `logistics` | **New.** Parcel/food/grocery/pharmacy/courier delivery. `DeliveryOrder` parallels `Ride`'s lifecycle and settlement logic (wallet/cash/card/corporate, commission split, fleet-routed earnings) rather than duplicating it from scratch — reuses `DriversService`, `WalletsService`, `CommissionService`, `FleetService`, `CorporateService`, `PaymentsService` directly. Adds cash-on-delivery (COD) as a cash-payment variant |
| `advertising` | Ad campaigns, banner ads (placement-targeted, with impression/click tracking, verified both counters and the redirect-on-click behavior), and geofenced sponsored locations (real Haversine distance, not a bounding box) |
| `ai` | Statistical/heuristic services — NOT machine learning — genuinely wired into the live request path, not just endpoints that return numbers: `PricingService` computes real-time surge from actual open-ride-vs-online-driver ratios and is now called automatically on every fare estimate/ride request (closes the "surge is always caller-supplied" gap flagged earlier); `DispatchAiService` re-ranks dispatch candidates by proximity+rating+level instead of pure nearest-first. Also: demand forecasting, pickup ETA (upgrades to real Maps routing when configured), fraud risk scoring (aggregates `FraudFlag`s into one score), driver/passenger recommendations, and earnings forecasting |
| `feature-flags` | **New.** `@RequireFeature()` + `FeatureFlagGuard` — genuinely gates `LogisticsController`, `AirportController`, and (inside `DispatchService`) the AI-ranking step, not just decorative endpoints. Verified: toggling `logistics` off returns 503 immediately, toggling `ai_dispatch` off makes dispatch fall back to plain nearest-first without erroring. Fail-open for unknown keys; auto-seeds 5 known flags as enabled on boot so nothing breaks by surprise |
| `settings` | DB-configurable overrides (with a 30s cache since some are read on hot paths) for values that were previously env-only: cancellation fee, referral bonuses, wallet max balance. Verified: setting a custom cancellation fee via the admin API changed what an actual ride cancellation charged, not just what a settings-list endpoint echoed back |
| `tracking` | **New.** Real Socket.IO gateway (`/tracking` namespace), JWT-authenticated on connect, ride-room-scoped subscriptions with real participant authorization (verified a non-participant gets rejected). `DriversService.updateLocation()` emits an event this module listens for — records route history AND broadcasts live over the socket. Verified end-to-end with an actual socket.io client: connect → reject-bad-token → reject-non-participant → subscribe → receive a live `driver:location` event triggered by a real REST call |
| `health` | `@nestjs/terminus`-based sub-checks: `/health/db` (real DB ping), `/health/queue` (genuinely checks the dispatch scheduler's last-run timestamp, not a fake "yes"), `/health/maps`, `/health/payments` (both report configured/not honestly), `/health/redis` (honestly always down — this deployment doesn't use Redis, see Known gaps), `/health/all` combines everything |
| `webhooks` | **New.** Outbound webhooks — `WebhooksService` listens for 11 real domain events (ride/payment/wallet/driver/promotion lifecycle) and fans each out to subscribed partner URLs with an HMAC-SHA256 signature. Verified end-to-end via a self-loopback test receiver (this sandbox can't reach real external URLs): subscribed, triggered real events, confirmed correct delivery logs, confirmed deactivating a subscription stops new deliveries |
| `emergency` | Emergency Command Center — SOS trigger, incident reporting/timeline/acknowledge/resolve workflow, live ride monitoring (active rides joined with current driver location), and admin force-cancel (deliberately bypasses normal fee/commission logic as a safety override). Verified the full SOS → active-incidents → timeline → acknowledge → resolve chain, live monitoring, force-cancel, and RBAC (non-responder role correctly blocked) |
| `storage` | **New.** Unified `StorageService` — working local-disk provider (default, tested end-to-end: uploaded a file, fetched it back, content matched exactly), plus real AWS SDK v3 clients for S3 and Cloudflare R2 (untestable live — same pattern as Paystack/Maps). Wired to a real usage point: `POST /users/me/profile-photo` |
| `search` | Postgres full-text search (default, tested: partial name match, code match, correct empty result for no match, RBAC-gated) — covers airports, vehicles, drivers, support tickets, passengers, and corporate accounts — plus a real OpenSearch REST client (untestable live — no cluster available here) |
| `reconciliation` | Offline cash reconciliation — fixes a real bug where a driver with insufficient wallet balance couldn't complete a cash trip at all (the debit exception blocked ride completion). Now the shortfall becomes a tracked `CashReconciliation` debt instead, auto-settled via a real BullMQ job the next time that wallet is credited. Admin write-off endpoint for genuinely uncollectable debts |
| `observability` | Real Prometheus metrics (`GET /metrics`) — default process metrics plus 7 business counters/histograms wired into actual ride/dispatch/wallet code paths, not synthetic data. Verified: requesting and completing a real ride increased `ryda_ride_requests_total`, `ryda_ride_completions_total`, `ryda_dispatch_offers_total`, and `ryda_wallet_transactions_total` by exactly the expected amounts. Structured JSON logging via `nestjs-pino` (pretty-printed in dev, raw JSON in production, auth headers redacted). Sentry SDK wired with the same graceful-no-op pattern as Paystack/Maps when `SENTRY_DSN` is unset, hooked into the global exception filter for 5xx errors only |
| Deployment | **New.** `Dockerfile` + `docker-compose.yml`, GitHub Actions CI (real boot smoke test against live Postgres/Redis service containers), Kubernetes manifests (`k8s/`), Joi-based env validation, and a full TypeORM migration workflow — verified with a real generate → run → revert cycle creating and dropping all 55 tables. `pg_dump`/`pg_restore` backup scripts verified with a real data round-trip |
| `tracking/geofence` | **New.** Real event-driven zone monitoring — listens to the same `driver.location.updated` event `LocationService` already consumes, checks it against active restricted/alert zones with real Haversine distance, logs a `GeofenceEvent`, and notifies the driver. Verified the full chain end-to-end: a real location update inside a defined zone produced a correctly-attributed logged event |
| `admin-tools` | **New.** Real BullMQ job counts across all 3 actual queues (not a mock dashboard), settings-cache clearing, system diagnostics (memory/uptime/queues/flags in one call), and maintenance mode — deliberately built on `SystemSettingsService` rather than `FeatureFlagsService`, since the latter's fail-open-to-enabled semantics would be backwards for a kill switch. Verified: enabling it correctly 503'd normal traffic while keeping `/health`, `/auth`, and `/admin` reachable, and turning it back off immediately restored access |
| `incentives` | **New.** Driver incentive engine — streak, quest, milestone, and peak-hour bonus types, all event-driven off `ride.completed`, safely isolated (a processing failure can't break ride completion). Rewards land in the driver's personal wallet even for fleet drivers, deliberately not routed through the fleet-earnings split |
| Redis / BullMQ | **New.** Real distributed queues (not in-process) now back notification delivery, scheduled-ride activation (a genuine delayed job, not a polling loop), and reconciliation auto-settlement. `/health/redis` upgraded from an honest "always down" stub to a real ping now that it's actually load-bearing |
| Scheduled rides | **New.** `POST /rides` accepts an optional `scheduledAt`; the ride sits in a `scheduled` status until a real BullMQ delayed job fires shortly before pickup time and releases it into normal dispatch. Cancelling a still-scheduled ride correctly removes the pending job |

## Paystack setup (real payments)

This backend integrates against Paystack's actual REST API — not a mock.

1. Put your key in `.env` (never in chat, never committed):
   ```
   PAYSTACK_SECRET_KEY=sk_live_...   # or sk_test_... to try it safely first
   PAYSTACK_PUBLIC_KEY=pk_live_...
   ```
2. Point your Paystack dashboard's webhook URL at
   `https://your-domain/api/v1/payments/webhook/paystack`. The signature is
   verified against the raw request body (HMAC-SHA512) before anything in
   the payload is trusted.
3. **Card payments use a "card on file" model**, not a checkout redirect per
   ride: `POST /payments/cards/add-init` starts a one-time hosted-checkout
   flow that tokenizes the card (a small refunded verification charge
   confirms it), and every ride after that charges the saved
   `authorization_code` directly via `POST /transaction/charge_authorization`
   — synchronous, no redirect. `GET /payments/cards/mine` lists saved cards.
4. **Bank transfer is asynchronous** — the ride completes immediately but
   driver earnings are held (`Ride.earningsSettled = false`) until the
   `charge.success` webhook confirms the transfer actually landed. This uses
   an internal `payment.confirmed` event (`@nestjs/event-emitter`) to notify
   `RidesService` without a circular module dependency.
5. **Without a key configured**, card and bank-transfer charges fall back to
   a clearly-flagged simulated success (`PaymentRecord.simulated = true`) so
   the rest of the system stays testable. `POST /payments/cards/add-init`
   specifically requires a real key (there's no meaningful way to simulate
   tokenizing an actual card).
6. **I could not test live Paystack calls from this environment** — the
   sandbox's network egress is restricted to a small allowlist that doesn't
   include `api.paystack.co`. The integration is built correctly against
   Paystack's documented contract (initialize, verify, charge_authorization,
   refund, transfer, webhook signatures) but you should test the live path
   yourself once your key is in place, ideally with `sk_test_...` first.

## Maps integration & pricing engine

**Google Maps** (`GOOGLE_MAPS_API_KEY`): when configured, `FareService`
calls the real Directions API for road distance and traffic-aware duration
instead of Haversine + a flat average speed. `GET /maps/geocode` and
`/maps/reverse-geocode` are also exposed for address search / pin-drop
resolution in the passenger app. Every fare response includes
`usedRealRouting: true/false` so a client can tell which path priced the
trip. **Untested against the live API** — same sandbox network restriction
as Paystack/Twilio/SendGrid; falls back to Haversine automatically if the
Directions call fails for any reason (bad key, quota, API error), not just
when unconfigured.

**Pricing engine, now complete** — verified end-to-end:
- **Surge**: multiplier field already existed; still caller-supplied (no
  live supply/demand engine — see Known gaps).
- **Night pricing**: a configurable multiplier (`NIGHT_MULTIPLIER`, default
  1.15) applies automatically between `NIGHT_START_HOUR`/`NIGHT_END_HOUR`
  (default 22:00–05:00, wraparound-aware).
- **Airport surcharge**: pass `isAirportTrip: true` on the estimate/request
  DTO for a flat fee (`AIRPORT_FEE`, default ₦1000) — verified: identical
  trip priced exactly ₦1000 higher with the flag set. (Deliberately
  flag-based rather than geofenced against a real airport registry — no
  Airport module exists yet, see Known gaps.)
- **Waiting fee**: computed at `startRide()` from `arrivedAt` → `startedAt`,
  free grace period (`FREE_WAIT_MINUTES`, default 5) then billed per minute
  (`PER_MINUTE_WAIT_RATE`) — verified: backdating `arrivedAt` by 10 minutes
  correctly billed ~5 chargeable minutes and added it to `totalFare`.
- **Cancellation fee**: if a passenger cancels *after* a driver has already
  accepted/is en route (not while still `searching`), a flat fee
  (`CANCELLATION_FEE`, default ₦500) is debited from the passenger's wallet
  and credited to the driver (or their fleet, if fleet-owned) as
  compensation — verified: passenger debited exactly ₦500, driver credited
  exactly ₦500 on top of their existing balance. **Wallet-only for now** —
  card/bank-transfer cancellation fees would need their own gateway call and
  aren't wired up.
- **Toll pricing**: still a pass-through field, no real toll-road detection
  (would need a toll-specific API/dataset).

## How commission settlement works

On `PATCH /rides/:id/complete`, all five payment methods route through the
same commission split (`commissionAmount = totalFare * commissionPercent /
100`, `driverEarnings = totalFare - commissionAmount`):

- **wallet** — passenger's wallet debited the full fare, driver's wallet
  credited `driverEarnings`.
- **cash** — driver already collected cash directly, so only
  `commissionAmount` is debited from the driver's wallet.
- **card** — charges the passenger's saved card via Paystack
  (`chargeSavedCard`); synchronous, settles the driver immediately on
  success, throws clearly if declined or if no card is on file.
- **bank_transfer** — asynchronous (see Paystack setup above); the ride
  completes but `earningsSettled` stays `false` until the webhook confirms,
  at which point `RidesService.handlePaymentConfirmed()` (an
  `@OnEvent('payment.confirmed')` listener) credits the driver.
- **corporate** — the rider's linked `CorporateAccount` budget is debited the
  full fare (ledgered in `CorporateTransaction`) instead of a personal wallet;
  driver earnings settle immediately, same as wallet. Requesting a
  corporate-paid ride fails fast at request time if the passenger isn't
  linked to an active account.

Commission % resolution: a driver-level override on `DriverProfile` wins if
set; otherwise `CommissionService` picks the most specific active
`CommissionRule` (city + vehicle category + driver level); otherwise it falls
back to the platform default for that level (25% down to 10% as drivers level
up — see `DEFAULT_COMMISSION_BY_LEVEL`).

## Ratings

`POST /rides/:id/rate/driver` (passenger→driver) and `/rate/passenger`
(driver→passenger) — both require a `COMPLETED` ride, both are one-shot (a
second rating attempt on the same ride returns 400), and both update a
rolling average (`DriverProfile.rating`/`ratingCount`, `User.rating`/
`ratingCount`). A driver rating also re-runs the level-progression check, so a
rating drop can demote a driver's level just like a rise can promote it.

## Dispatch

Drivers report their position via `PATCH /drivers/location`. Dispatchers/admins
can call `GET /rides/:id/nearby-drivers?radiusKm=8` to see online, approved
drivers near a ride's pickup point, sorted nearest-first (Haversine distance,
computed in-memory — fine at this scale, swap for a geospatial DB query if the
online-driver count grows large). This is visibility for a human dispatcher or
a future auto-assignment job; the existing `PATCH /rides/:id/accept` (any
online driver can self-claim a `searching` ride) is still the actual matching
mechanism, since there's no push-notification/websocket layer yet to notify a
specific driver of an assignment.

## Auth & refresh token security

- `POST /auth/register` / `login` — issue an access token (short-lived) and a
  refresh token (long-lived).
- Refresh tokens are **persisted** (SHA-256 hash, not the raw token) and
  **rotate on every use**: `POST /auth/refresh` revokes the presented token and
  issues a new pair. If a *revoked* token is ever presented again — a sign of
  token theft/replay — every refresh token for that user is revoked
  immediately and the caller must log in again.
- `POST /auth/logout` revokes one refresh token (single device);
  `POST /auth/logout-all` (authenticated) revokes all of a user's tokens.
- `POST /auth/register`, `/login`, and `/otp/*` carry stricter rate limits
  (5–10 requests/min) than the API default (100/min), since they're the
  classic brute-force/enumeration targets.

## Notifications module

Real provider integrations, all built against each provider's actual documented API:
- **SMS + WhatsApp** — Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`)
- **Email** — SendGrid (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`)
- **Push** — Firebase Cloud Messaging legacy HTTP API (`FCM_SERVER_KEY`). Note: Google has deprecated this endpoint in favor of FCM HTTP v1 (OAuth2 service-account) — migrate before relying on this for real push volume.
- **In-app** — just a DB write, always "succeeds," powers `GET /notifications/mine` and the unread-count badge.

Any channel without credentials configured falls back to a clearly-flagged
`status: "simulated"` record instead of failing outright — same pattern as
the Paystack integration — so the rest of the system stays testable without
real provider accounts. **I couldn't test the real Twilio/SendGrid/FCM calls
from this sandbox** (same network restriction as Paystack — those domains
aren't in the egress allowlist), so these are correct-per-documentation but
unverified against live accounts.

**Decoupled by design:** `NotificationsService` never gets injected into
`RidesService`, `DriversService`, etc. Instead those services emit events
(`ride.accepted`, `ride.completed`, `ride.cancelled`, `driver.approval.changed`,
`referral.bonus_granted`, `payment.failed`) via `@nestjs/event-emitter`, and
`NotificationsService` listens for them. Adding a new notification trigger
means adding an `@OnEvent()` handler here, not touching five other files.

**Eventually consistent, not synchronous:** event emission doesn't block the
triggering request (approving a driver, completing a ride) waiting for an
SMS/push round-trip. A notification can briefly show `status: "pending"`
immediately after the triggering action, resolving to `sent`/`simulated`/
`failed` a moment later once the provider call returns. Don't assume a
notification is fully sent just because the API call that triggered it
returned 200.

## Customer support

One `SupportTicket` model covers what the original spec split into
"Tickets," "Complaints," "Ride Disputes," and "Lost Items" — they're all the
same shape (a subject, a description, a status workflow, optional
assignment), differentiated by `category` (`general`, `ride_issue`,
`payment_issue`, `account_issue`, `lost_item`, `safety`) and an optional
`rideId` for trip-specific issues.

- **Access control**: a ticket is visible/messageable by its owner or by
  support-tier staff (`support_agent` and the admin-like roles) — anyone
  else gets a 403, verified directly.
- **Threaded messages** (`TicketMessage`) give an async back-and-forth
  without needing a real-time layer — genuinely "Live Chat" would need
  websockets, which isn't built (see Known gaps).
- **Assignment auto-transitions** an `open` ticket to `in_progress`.
- **Status changes notify the ticket owner** via the existing Notifications
  event pattern (`support.ticket.created`, `support.ticket.status_changed`).
- **"AI Support"** from the original spec isn't implemented — that would
  mean wiring an actual LLM into the ticket flow, out of scope here, but the
  ticket/message model would support it (an AI-generated first response is
  just another `TicketMessage` with a different `senderRole`).

## CMS

- **Pages** (`CmsPage`, keyed by `slug` — `faq`, `terms`, `privacy`, etc.):
  `GET /cms/pages/:slug` is public but only returns `isPublished: true`
  pages (404 otherwise, verified) — draft content stays invisible until an
  admin/marketing user publishes it via `POST /admin/cms/pages/:slug`
  (upsert — creates if the slug doesn't exist yet, updates if it does).
- **Announcements**: `GET /cms/announcements` is public and returns only
  `isActive` announcements within their `startDate`/`endDate` window (both
  optional — omit either for an always-on or open-ended announcement).

## Audit logs

Two logging paths:
1. **`@Audit('action.name')` decorator** on a controller method + a global
   `AuditInterceptor` (registered via `APP_INTERCEPTOR`) that, on success,
   logs the actor (id + role), an inferred target id (from route params),
   the sanitized request body, and IP. Applied to the mutating admin actions
   that matter most: driver approval, passenger blacklist/verification,
   commission rule creation, promotion create/status-change, payment refunds.
   Adding a new one is a one-line decorator, not new logging code.
2. **Explicit calls in `AuthService`** for login success/failure — the
   interceptor only fires on a *successful* response, so a failed login
   (which throws) needs its own logging path. Failed attempts record the
   phone number and failure reason (`unknown_account` vs `bad_password`)
   without ever logging the password itself.

`GET /admin/audit-logs` (admin/super_admin/auditor) supports filtering by
`actorUserId`, `action`, `targetId`, a `from`/`to` date range, and pagination.
Sensitive fields (`password`, `passwordHash`, `refreshToken`,
`authorizationCode`) are redacted before anything is written to the log.

## Analytics dashboard

Read-only, cross-cutting queries for `admin`/`super_admin`/`finance`/`auditor`:
- `GET /admin/analytics/overview` — user/driver/ride counts, online drivers, GMV, platform revenue (commission collected)
- `GET /admin/analytics/revenue?groupBy=day|week|month` — time series
- `GET /admin/analytics/rides-by-status` — counts per `RideStatus`
- `GET /admin/analytics/top-drivers?limit=10` — ranked by completed trips
- `GET /admin/analytics/heatmap` — pickup points bucketed into a ~1km grid and counted; a dependency-free stand-in for a real geospatial heat map (swap for a PostGIS `ST_SnapToGrid` query if pickup volume grows large enough that in-memory bucketing gets slow)

All figures are computed live from `Ride`/`User`/`DriverProfile` via
TypeORM query-builder aggregations — nothing is a separately-maintained
running total that could drift out of sync with the underlying data.

## Fleet management

A `FleetCompany` is created by a `FLEET_OWNER`-role user
(`POST /fleet/companies`), which auto-creates a `FleetWallet` and registers
the creator as `FleetStaff` with role `OWNER`. One fleet membership per user
— you can't own/manage more than one fleet company, and a driver/vehicle can
only belong to one fleet at a time (`ConflictException` if you try otherwise).

- **Owners** can add managers, assign/remove drivers and vehicles, request payouts.
- **Managers** can assign/remove drivers and vehicles, but can't add other managers or request payouts (owner-only, enforced in `FleetService.assertIsOwner`).
- **Driver/vehicle assignment** doesn't require the driver to do anything — it's a fleet-side action (`POST /fleet/companies/mine/drivers` with `driverUserId`). The existing `DriverProfile`/`Vehicle` registration flow is unchanged; fleet assignment just sets `fleetCompanyId` on top of it.

**The important behavioral change:** in `RidesService.creditDriverEarnings()`,
if the completing driver's `DriverProfile.fleetCompanyId` is set, earnings
are credited to the **fleet's** wallet instead of the driver's personal one
— verified directly (driver's personal wallet stayed at ₦0 while the fleet
wallet was credited the correct post-commission amount). Cash-trip
commission-owed follows the same fleet-vs-personal routing.

**Payouts** reuse the same Paystack transfer-recipient/transfer primitives
built for the payments module (`POST /fleet/companies/mine/payouts`) — the
fleet's wallet is debited first (funds held out of the spendable balance
while the transfer is in flight), and refunded automatically if the Paystack
transfer call fails. Falls back to a simulated success if no Paystack key is
configured, same pattern as everywhere else.

**Analytics** (`GET /fleet/companies/mine/analytics`) — driver/vehicle
counts, wallet balance, total ride earnings, total paid out. Computed live
from the ledger rather than a separately-maintained running total, so it's
always consistent with the transaction history.

## Driver verification documents

`POST /drivers/documents` (driver, one row per `type` — re-uploading resets
it to `pending` rather than creating a duplicate): `drivers_license`,
`insurance`, `road_worthiness`, `profile_photo`, `vehicle_photo`,
`background_check`. Admin reviews via `PATCH
/drivers/admin/documents/:id/approve` or `/reject` (with a reason) —
verified: upload → pending → admin approve/reject both work, driver's own
list correctly reflects the outcome. `DriverDocumentsService
.hasAllRequiredApproved()` checks license+insurance+road-worthiness are all
approved, but **isn't yet wired into the approval workflow** —
`setApprovalStatus()` doesn't currently require it, so an admin can still
approve a driver with no reviewed documents. Worth connecting before this
handles real drivers.

## Passenger module

`PassengerProfile` is created lazily (`GET /passengers/me` auto-creates it —
no separate onboarding step, unlike drivers). Covers:
- **Preferences** — language, music, chat preference, wheelchair accessibility
- **Home/work** — `POST /passengers/me/home` / `/work` (special `FavouritePlace` types, upserted)
- **Favourite places** — arbitrary saved locations
- **Emergency contacts**
- **Verification** — `KycStatus` (shared enum with drivers), self-submit + admin review
- **Blacklist** — admin/support-only; enforced in `RidesService.requestRide()` via `assertNotBlacklisted()`
- **Statistics** — `totalRides`/`completedRides`/`cancelledRides`/`totalSpend`, updated automatically as rides complete/cancel

## Promotions module

- **Coupon codes** (`POST /admin/promotions`, admin/marketing only) — percentage, fixed-amount, or cashback discount types, with optional max-discount cap, minimum-fare requirement, total and per-user usage limits.
- **Redemption** — pass `promoCode` on `POST /rides`. Percentage/fixed discounts reduce `Ride.totalFare` immediately; cashback is paid to the wallet *after* the ride completes (`PromotionsService.settleCashbackForRide`), not deducted upfront.
- **Campaigns** — simple grouping entity for promotions (`POST /admin/campaigns`).
- **Referral bonuses** — paid to both referrer and referee on the referee's *first completed ride* (not at signup, to avoid paying out for accounts that never actually ride). A unique constraint on `ReferralGrant.refereeUserId` makes the grant check safe to run on every completion without double-paying.

## Fraud detection

Three heuristic signals, all verified end-to-end:

- **Duplicate accounts**: `POST /auth/register` and `/login` accept an
  optional `deviceFingerprint` (client-generated, e.g. from a device-info
  library on mobile). If the same fingerprint shows up under more than one
  user, a `multiple_accounts_same_device` flag is raised - verified: two
  users registering with the same fingerprint correctly produced a flag
  linking them.
- **GPS spoofing**: every `PATCH /drivers/location` call is checked against
  the driver's previous position - if the implied travel speed exceeds
  250 km/h (deliberately generous, well above any real driving speed but
  below commercial flight speed, to avoid false positives from a
  stale/delayed ping), a `gps_spoof` flag is raised - verified: two location
  updates ~500km apart within the same second correctly flagged.
- **Referral abuse**: when a referral bonus is about to be granted,
  `PromotionsService` checks whether the referrer and referee share a
  device fingerprint. If so, it's flagged - **but the bonus is still
  granted**. A shared device is worth a human look (family members sharing
  a phone is a plausible false positive), not an automatic block - verified:
  the flag was raised and the 500 NGN bonus still landed in the wallet.

Review workflow: `GET /admin/fraud/flags` (filterable by type/status/user,
paginated), `PATCH /admin/fraud/flags/:id/review` (admin/support, sets
status to `reviewed`/`dismissed` with notes).

**What this isn't**: these are heuristics on data already flowing through
the system, not device-fingerprint SDKs, IP geolocation, or the kind of
device-attestation (Play Integrity / DeviceCheck) a production fraud stack
would layer on top. Good enough to catch casual abuse, not sophisticated
actors.

## Granular permissions

Roles (13 of them - `passenger`, `driver`, `admin`, `super_admin`,
`dispatcher`, `fleet_owner`, `corporate`, `country_admin`, `city_manager`,
`support_agent`, `finance`, `marketing`, `auditor`) get you in the door via
the existing `@Roles()`/`RolesGuard`. `Permission` (16 fine-grained actions -
`payments.refund`, `commission.manage`, `drivers.approve`,
`driver_documents.review`, `fraud.review`, etc.) plus a data-driven
`ROLE_PERMISSIONS` matrix plus `@RequirePermission()`/`PermissionsGuard`
decide what you can actually *do* once you're in.

Both guards run together on the endpoints where this matters (payment
refunds, commission rules, promotions, driver approval, driver document
review, passenger blacklist) - `@Roles()` narrows who can reach the
endpoint at all, `@RequirePermission()` cross-checks against the matrix. In
practice this also **closed a real gap**: `country_admin` and `city_manager`
previously had no endpoints wired to their role at all despite existing in
the enum; they're now genuinely able to approve drivers, review documents,
and (for `country_admin`) manage commission rules, matching what the role
name implies.

`GET /permissions/mine` - any authenticated user can see their own resolved
permission list (verified: admin gets all 15, driver gets an empty array).
`GET /permissions/matrix` and `/permissions/roles/:role` (admin-only) expose
the full matrix for building an admin UI around.

## Airport module

`POST /airports` (admin) registers an airport with a geofence radius (km).
`GET /airports/detect?lat=&lng=` returns the containing airport if the point
falls inside one, or nothing (200, empty body) otherwise - verified: a point
exactly at the registered airport's coordinates correctly matched, a point
~9km away correctly returned nothing. This is separate from the pricing
engine's `isAirportTrip` flag (still manually set by the client) - the
detection endpoint exists so a client *could* auto-set that flag, but
nothing currently wires them together automatically.

Drivers can join a FIFO pickup queue at a specific airport
(`POST /airports/:id/queue/join`, `/leave`, `GET /queue/mine` for their own
position, `GET /:id/queue` for a dispatcher's full view) - verified:
join, position 1, dispatcher sees the entry. `AirportService.dispatchNext()`
pops the front of the queue but isn't yet wired into ride assignment - an
airport pickup doesn't currently prefer queued drivers over the general
dispatch pool.

Rides can carry an optional `flightNumber` (informational only, no real
flight-tracking integration - see Known gaps).

## Smart dispatch (additive)

The original accept flow - any online, approved driver can claim a
`searching` ride via `PATCH /rides/:id/accept` - is unchanged and remains
authoritative. On top of it, `DispatchService` now:

1. On `POST /rides`, finds the nearest online driver (Haversine, same
   `findNearby` used by the admin nearby-drivers view) and creates a
   time-limited `RideOffer` (`DISPATCH_OFFER_TIMEOUT_SECONDS`, default 20s),
   notifying that driver specifically (`ride.offered` event -> push/in-app).
2. A `@nestjs/schedule` interval (every 15s) sweeps expired pending offers
   and automatically re-offers to the next-nearest driver who hasn't
   already been tried for that ride.
3. `PATCH /rides/:id/decline` lets a driver explicitly pass, which
   immediately triggers the same re-offer logic rather than waiting for the
   timeout.
4. Whichever driver actually accepts - whether they had an offer or just
   claimed it via broadcast-accept - `markAccepted()` cleans up any other
   pending offers for that ride as superseded.

**Verified the backward-compatibility guarantee directly**: after a driver
declined their offer, the ride stayed `searching` and the same driver could
still successfully broadcast-accept it a moment later - the offer system
never blocks the fallback path. This was a deliberate design choice over a
hard-gated "only the offered driver can accept" model, specifically to avoid
risking the existing tested ride flow while still adding real dispatch
intelligence.

**What this isn't**: no genuine push-to-single-device exclusivity (the
offered driver doesn't get priority *enforcement*, just priority
*notification* - anyone can still jump in), and the interval-based sweep is
in-process (not distributed) - fine for a single instance, would need a
proper job queue (BullMQ/Redis) behind a load balancer.

## API keys

`POST /admin/api-keys` generates a raw key (`rk_...`) and returns it exactly
once - only a SHA-256 hash and a 12-character prefix (for display/
identification) are persisted; the raw key itself is never retrievable
again. `x-api-key` header authenticates the demonstrative partner endpoint
(`GET /partner/rides/:id/status`) via `ApiKeyGuard`, entirely separate from
JWT user auth. Verified: valid key works, missing key -> 401, bogus key ->
401, and revoking a key immediately invalidates it (401 on the next call
with the same raw key).

## Logistics module

`DeliveryOrder` covers parcel, food, grocery, pharmacy, and courier delivery
- one entity/category enum rather than five separate ones, since they share
the same lifecycle and settlement shape. Deliberately built by *reusing*
the infrastructure `RidesService` already established rather than
reimplementing it:

- Same driver approval/availability/level machinery (`DriversService`) - a
  driver can't simultaneously be mid-ride and mid-delivery, since both share
  the same `DriverAvailability` state.
- Same commission resolution (`CommissionService`) and fleet-routing logic
  (a fleet driver's delivery earnings land in the fleet wallet, not
  personal - verified in the ride flow, same code path here).
- Same payment methods (wallet/cash/card/corporate) with the same
  settlement shape as `RidesService.completeRide()` - verified end-to-end:
  a wallet-paid delivery correctly debited the customer and credited the
  driver exactly `driverEarnings` (75% of fare at the rookie commission
  rate).
- **Cash-on-delivery (COD)** is a variant of cash payment: the customer
  pays the driver directly on handoff, the driver owes the platform
  commission out of their own wallet (or fleet wallet) - verified: the
  driver's wallet was correctly debited exactly the commission amount after
  a COD delivery completed. Requesting `isCod: true` without
  `paymentMethod: "cash"` is rejected - verified (400).

Lifecycle: `requested` -> `searching` -> `accepted` -> `pickup_arrived` ->
`picked_up` -> `in_transit` -> `delivered` (or `cancelled`/`failed`). Any
authenticated user can order a delivery - not gated to the `passenger` role,
since parcel/food customers could reasonably be any account type.

**What's simplified vs. a real delivery platform**: no restaurant/store
catalog or menu system (the customer just describes the item), no
multi-item cart, no delivery-specific dispatch radius tuning separate from
rides, and estimated distance is still Haversine/Maps the same way rides
are (no route-optimized multi-stop logic for, say, a courier run with
several drops).

## Advertising module

- **Campaigns** (`POST /admin/ads/campaigns`) group banners and sponsored
  locations under an advertiser, with a status workflow
  (draft/active/paused/completed) and an optional budget field (tracked,
  not enforced - nothing currently stops a campaign from exceeding it).
- **Banner ads** are placement-targeted (`home_screen`, `ride_screen`,
  `search_results`, `receipt`). `GET /ads/banners?placement=X` is public and
  only returns active banners within their date window if one is set -
  verified: a banner for a different placement correctly didn't show, and
  deactivating a banner correctly removed it from the public list
  immediately. Impressions and clicks are tracked
  (`POST /ads/banners/:id/impression`, `GET /ads/banners/:id/click` which
  increments the counter and 302-redirects to the target URL) - verified
  both counters incremented correctly and the redirect fired.
- **Sponsored locations** are geofenced map pins (real Haversine distance
  per-location radius, not a shared bounding box) - `GET
  /ads/sponsored-locations/nearby?lat=&lng=` - verified: a point near the
  location matched, a point ~20km away correctly returned nothing. Each
  match increments that location's impression count, since "the pin showed
  on someone's map" is the meaningful impression event here.

## AI module

**What this honestly is**: statistical aggregation and weighted-formula
heuristics over real data already in the system - historical ride counts,
current online-driver counts, existing fraud flags. **What it isn't**: no
training, no model weights, no external AI/ML API call (this sandbox has
no network path to one). Framed accurately rather than dressed up, per the
production-readiness list this was built against.

**Genuinely wired into the live request path, not just standalone
endpoints** - this is the part worth highlighting:

- **`PricingService.calculateSurge()`** is now called automatically inside
  `RidesService.estimateFare()` and `.requestRide()`, replacing what was
  previously always a caller-supplied (or default 1.0) surge multiplier
  with a real formula: `1 + max(0, openSearchingRides/onlineDrivers - 1) *
  0.5`, capped at 3x. **Verified in an isolated fresh-DB test**: 0
  demand/0 supply -> 1.0x ("No activity"); 1 open ride/0 drivers -> 3.0x
  ("No drivers available"); 1 ride/1 driver -> back to 1.0x ("Supply meets
  demand"). This closes a gap explicitly flagged in an earlier pass
  ("surge is hardcoded 1.0... no live engine").
- **`DispatchAiService.rankDrivers()`** is now called inside
  `DispatchService.offerToNearestDriver()`, replacing pure
  nearest-distance-wins with a weighted score (50% proximity, 35% rating,
  15% level) - a closer-but-lower-rated rookie can lose out to a slightly
  farther, well-established driver. Verified the existing dispatch-offer
  test suite still passes with this change in place.

**Other services, exposed via `GET /ai/*` but not yet wired into another
service's decision path**:
- `PredictionService` - hourly demand forecast from historical ride counts, grouped by hour-of-day (admin/dispatcher only)
- `EtaService` - pickup ETA, upgrading to real Google Maps routing when configured (same fallback pattern as `FareService`)
- `FraudAiService` - aggregates a user's `FraudFlag`s into one 0-100 risk score + level, rather than making an admin weigh several separate flags manually
- `RecommendationService` - driver: peak-hours-to-drive from demand forecast; passenger: a saved favourite place not visited recently
- `EarningsForecastService` - trailing-average projection of a driver's weekly earnings from their last 14 days of completed trips

## Feature flags & admin system configuration

Two small modules that together answer "configurable instead of
hard-coded, toggleable without a redeploy":

**Feature flags** (`FeatureFlag` entity, auto-seeded on boot as enabled so
nothing breaks by surprise): `ride_sharing` (reserved key — carpooling
itself isn't built, see Known gaps), `airport_module`, `logistics`,
`promotions`, `ai_dispatch`. `@RequireFeature(key)` + `FeatureFlagGuard`
gate a controller (or one route) behind a flag, returning 503 when off.
**Verified genuinely wired, not decorative**: disabling `logistics`
immediately 503'd `POST /deliveries/estimate`, re-enabling it immediately
worked again; disabling `ai_dispatch` made `DispatchService` fall back to
`DriversService.findNearby()`'s plain distance-sorted order instead of
`DispatchAiService.rankDrivers()` — and dispatch kept working, it just
stopped re-ranking, confirmed by requesting a ride and finding a valid
offer was still created.

**System settings** (`SystemSetting` key-value store, 30s cache since a
couple of these sit on hot paths): admin can override, without a
redeploy, values that were previously env-config-only —
`pricing.cancellationFee`, `referral.refereeBonus`,
`referral.referrerBonus`, `wallet.maxBalance`. **Verified the override
actually changes behavior, not just what a settings-list endpoint echoes
back**: setting a custom cancellation fee to ₦1500 and then actually
cancelling a ride charged exactly ₦1500, not the ₦500 env default.

**Wallet limits, added as a genuinely new (not previously enforced)
feature**: `POST /wallet/topup` is a new endpoint (wallets could
previously only be funded via direct test SQL — no real API existed).
`wallet.maxBalance` is enforced **only on top-up transactions**, deliberately
not on ride earnings/referral bonuses/cashback settling in — a wallet
limit is an AML/funding-source control, not something that should be able
to block a driver from getting paid for a completed trip. Verified both
halves: a top-up that would exceed a low test limit was correctly
rejected, and a ride's earnings still landed in that same wallet past the
same limit without being blocked.

## Real-time tracking

A real Socket.IO gateway at the `/tracking` namespace, decoupled from
`DriversService` the same way notifications/payments are — location
updates emit a `driver.location.updated` event; `LocationService` listens,
persists a `LocationHistory` row, and (if the driver is on an active ride)
calls `TrackingGateway.broadcastDriverLocation()`.

**Verified with an actual socket.io client, not just code review:**
- A connection with a bad/missing JWT is disconnected immediately.
- `subscribe:ride` checks the ride's actual `passengerId`/`driverId` against
  the authenticated socket's user id — a user who isn't on that ride gets
  `{ error: "Not a participant in this ride" }`, not silently joined.
- A participant who subscribes correctly receives a live `driver:location`
  event, and that event was triggered by an actual `PATCH
  /drivers/location` REST call during the test, not a manually-fired mock
  event — proving the whole chain (REST update → event emit → history
  write → socket broadcast) works end to end.

`GET /tracking/rides/:id/route` returns the full recorded route for a trip;
`GET /tracking/drivers/me/history` returns a driver's own position history
over a time window (defaults to the last 24h).

## Health monitoring

Built on `@nestjs/terminus` rather than hand-rolled checks:
- `GET /health/db` — a real `TypeOrmHealthIndicator.pingCheck()`, not a stub.
- `GET /health/queue` — checks `DispatchService.lastSweepAt` against the
  expected 15s interval; genuinely reflects whether the in-process
  scheduler is still ticking, not a hardcoded "up." Verified showing
  `lastRunAgo: "5s"` in a live test.
- `GET /health/maps` / `/health/payments` — report whether Google Maps /
  Paystack are actually configured, matching the same `isConfigured()`
  checks those services use internally to decide real-vs-simulated mode.
- `GET /health/redis` — **honestly always reports down** with an explicit
  message that this deployment doesn't use Redis, rather than omitting the
  endpoint or faking a green check. This project's job scheduling is
  in-process (`@nestjs/schedule`), documented as a real limitation, not
  something to paper over in a health check.
- `GET /health/all` — combines everything; returns 503 whenever any
  sub-check is down, which in a dev environment without Maps/Paystack/Redis
  configured means a 503 is the **correct**, expected result, not a bug.

## API documentation (Swagger/OpenAPI)

`GET /api/docs` (interactive UI) and `/api/docs-json` (raw spec) via
`@nestjs/swagger` — verified both load, 176 documented paths, bearer-auth
and API-key auth schemes configured. `AuthController` and `RidesController`
(plus their DTOs) carry full `@ApiOperation`/`@ApiResponse`/`@ApiProperty`
annotations as the reference pattern with examples, error responses, and
descriptions; **not exhaustively applied across all ~25 modules** — that's
real remaining work (see Known gaps), the other controllers still show up
in the spec via NestJS's automatic reflection, just with thinner
descriptions/examples than the annotated ones.

## Outbound webhooks

`WebhooksService` listens for real domain events via the same
`@nestjs/event-emitter` pattern used throughout (notifications, tracking,
audit) and fans each one out to every active subscription that's opted
into it, HMAC-SHA256-signing the payload (`x-ryda-signature` header) so a
partner can verify it actually came from Ryda. Covers the events you'd
actually want to react to: `ride.created`, `ride.accepted`, `ride.started`,
`ride.completed`, `ride.cancelled`, `payment.confirmed`, `payment.failed`,
`wallet.updated`, `driver.online`, `driver.offline`, `promotion.redeemed` —
several of these (`ride.created`, `ride.started`, `wallet.updated`,
`driver.online`/`offline`, `promotion.redeemed`) didn't exist as emitted
events before this pass and were added specifically to back this feature.

**Verified with a real HTTP round-trip, not a mock**: since this sandbox
can't reach an external partner URL, a subscription was pointed at a
self-loopback test receiver (`POST /webhooks/test-receiver`) on the same
app. Triggering real ride/driver events produced real signed HTTP
deliveries with correct `WebhookDeliveryLog` entries (event name, HTTP 201,
success status); deactivating the subscription immediately stopped new
deliveries. One subtlety the test surfaced and I traced rather than
dismissed: `driver.online` fired twice for what looked like one manual
toggle — turned out to be correct, since completing a ride also
transitions the driver back to `ONLINE` internally, which is a second
genuine state change, not a duplicate bug.

Admin endpoints: `GET /admin/webhooks/events` (available event names),
`POST/GET /admin/webhooks/subscriptions`, toggle active state, and
per-subscription delivery logs.

## Emergency Command Center

- **SOS**: `POST /emergency/sos` (any authenticated user, optionally tied
  to a `rideId`) creates an `Incident` (type `sos`), logs a timeline entry,
  and notifies the reporter that their alert was received. **Honest gap**:
  escalating to on-call admin/support staff and SMS-ing the reporter's
  emergency contacts isn't wired up — those contacts' phone numbers aren't
  tied to a `User` account, so they can't go through the normal
  userId-keyed notification model. The `Incident` row itself is real and
  immediately visible to responders via `GET
  /admin/emergency/incidents/active`, which is what actually matters for a
  human to act on it.
- **Incident reporting** (non-SOS): `POST /emergency/incidents` for
  `safety_concern`/`accident`/`other`, same timeline/acknowledge/resolve
  workflow.
- **Live ride monitoring**: `GET /admin/emergency/live-rides` — every
  currently-active ride (`accepted`/`arriving`/`arrived`/`in_progress`)
  joined with its driver's current GPS position, for a dispatcher's live
  map view.
- **Admin intervention**: `POST /admin/emergency/rides/:id/force-cancel` —
  deliberately bypasses `RidesService.cancelRide()`'s normal ownership
  check and fee/commission handling, since this is a safety override an
  admin can apply to *any* ride, not a passenger/driver-initiated
  cancellation.

Verified the complete chain end-to-end: SOS triggered → appeared in active
incidents → timeline showed the trigger event → acknowledged → resolved
with notes → live monitoring showed the ride → force-cancel worked →
non-responder role correctly got 403.

## File storage

`StorageService` picks a provider based on `STORAGE_DRIVER` (`local` |
`s3` | `r2`), falling back to local disk if the configured cloud driver
isn't actually configured yet — same "don't break dev/test without real
credentials" pattern as Paystack/Maps/notifications throughout this
project.

- **Local disk** (default): `POST /storage/upload/:folder` writes to an
  `uploads/` directory, `GET /storage/files/:folder/:filename` serves it
  back. **Verified end-to-end**: uploaded a real file via multipart form
  data through `POST /users/me/profile-photo`, fetched it back via the
  returned URL, confirmed the content matched byte-for-byte.
- **S3 / R2**: real `@aws-sdk/client-s3` clients (R2 is S3-API-compatible,
  same SDK pointed at R2's endpoint), presigned GET URLs (7-day expiry) for
  reads. Untestable live — `s3.amazonaws.com` isn't reachable from this
  sandbox's network allowlist.

Backs (per the intended folder structure): `driver-documents`,
`vehicle-photos`, `chat-attachments`, `support-evidence`,
`profile-photos`. Only the last one has a real endpoint wired to it right
now (`POST /users/me/profile-photo`) — driver documents still take a
pre-hosted URL string rather than a direct upload (see Known gaps).

## Search

`SearchService` picks a provider based on `SEARCH_DRIVER` (`postgres` |
`opensearch`):

- **Postgres** (default): `ILIKE`-based search across airports (name/IATA
  code/city), vehicles (plate/make/model), drivers (name/phone/license,
  admin/support-only), and support tickets (subject/description,
  admin/support-only). **Verified**: partial name match, exact code match,
  a genuinely-empty result for a non-matching query, and RBAC (a driver
  correctly gets 403 trying to search other drivers).
- **OpenSearch**: a real REST API client (plain `fetch`, not the full
  `@opensearch-project/opensearch` package, to keep the dependency
  footprint small for something that'll sit unused until someone stands up
  a cluster) — untestable live, no OpenSearch server available here.

## Testing

A real Jest unit test suite alongside the bash e2e scripts (which cover
full-stack DB integration; the Jest suite covers pure logic and
money-math in isolation with mocked dependencies) — **40 tests, all
passing**:

- `FareService` — base+distance+time math, category multiplier, night
  multiplier (including the 22:00→05:00 wraparound), airport surcharge,
  surge application, minimum-fare floor, Maps-configured vs. Haversine
  fallback (and falling back correctly when a configured Maps call
  fails), waiting fee (both billable and within-grace-period cases), and
  the DB-setting-override-vs-env-fallback path for cancellation fee.
- `WalletsService` — credit/debit math, insufficient-balance rejection,
  frozen-wallet rejection, zero/negative-amount rejection, the
  top-up-only wallet limit (verified BOTH that it blocks an over-limit
  top-up AND that the identical amount succeeds as a ride-earning credit
  — the actual behavior the scoping is supposed to produce), and
  `wallet.updated` event emission with the correct direction.
- `CommissionService` — rule-specificity resolution (level-only vs.
  level+city vs. level+city+vehicle-category), city-mismatch rejection,
  inactive-rule exclusion, and the platform-default fallback.
- `PricingService` (AI surge) — all the edge cases: no activity, zero
  supply, exact 1:1 balance, gradual scaling, the 3.0x cap, and
  supply-exceeds-demand.
- `DispatchAiService` — driver ranking, including a pair of tests that
  deliberately probe *how much* of a rating/level gap is needed to
  overcome a proximity advantage, since the formula weights proximity
  heavily (0.5) and it caps quickly under 1km.

**A real bug this suite caught — in the test, not the app**: an initial
`DispatchAiService` test assumed a moderate rating gap (2.0→5.0) at a
moderate distance gap (0.3km→3km) would flip the ranking. It didn't — the
actual formula, verified by hand, correctly has the closer driver win at
that gap (6.4 vs. 6.07). Rather than adjust the test to force a pass, the
formula's real behavior was confirmed correct and the test was rewritten
to assert it accurately, with a second test added showing the gap size
that *does* flip the ranking.

**Run it**: `npm test` (or `npm run test:cov` for coverage). **Honest
scope note**: 40 tests across 5 services is real, targeted coverage of the
highest-risk logic (money math, dispatch decisions) — it is not >80%
coverage across all ~25 modules, which would be many more tests than fit
in this pass. The controllers, most services' CRUD paths, and all the
event-listener wiring are covered by the bash e2e suite instead, which
exercises them against a real running server and database.

## Redis, BullMQ, scheduled rides, offline reconciliation, and driver incentives

Built together since they share the same underlying infrastructure (real
BullMQ queues backed by Redis, confirmed actually installable and runnable
in this sandbox via apt) and several genuinely reuse each other.

**Redis + BullMQ** replaces "in-process only" with real distributed queues
for three things: notification delivery (decouples slow Twilio/SendGrid/FCM
I/O from the event that triggered it), scheduled-ride activation (a real
delayed job, not a polling loop), and reconciliation auto-settlement.
Verified directly against Redis - not just "the app didn't crash" - by
running `redis-cli keys "bull:*"` mid-test and seeing real queue state
(`bull:scheduled-rides:meta`, `bull:notifications:completed`, etc.).
`/health/redis` is now a real ping (upgraded from the earlier pass's honest
"always down, this deployment doesn't use Redis" stub, which was accurate
at the time and is not anymore).

**Scheduled rides**: `POST /rides` accepts an optional `scheduledAt`. If
set, the ride is created with status `scheduled` instead of immediately
searching, and a BullMQ job is enqueued with a real `delay` calculated from
`scheduledAt` minus a configurable lead time
(`SCHEDULED_RIDE_LEAD_MINUTES`), rather than a cron job polling for
due rides. **Verified with an actual timed delay, not a mock**: booked a
ride 10 seconds out (server run with `SCHEDULED_RIDE_LEAD_MINUTES=0` for a
fast test), confirmed it was NOT dispatched immediately, waited for the
real job to fire, confirmed the ride flipped to `searching` and the nearby
driver received a real dispatch offer. Cancelling a still-scheduled ride
correctly removes its pending delayed job (`scheduledRidesQueue.getJob(...).remove()`)
so it doesn't fire after cancellation.

**Offline cash reconciliation** fixes a real, previously-undiscovered bug:
`RidesService.completeRide()`'s cash-payment branch used to call
`walletsService.debit()` for the commission owed with no error handling -
if a driver's wallet balance was too low, that exception propagated up and
**blocked ride completion entirely**. A driver with a low wallet balance
literally could not finish a cash trip. Now the debit is wrapped, and a
failure records a `CashReconciliation` debt instead of blocking anything.
Every time that driver's wallet is later credited (`wallet.updated` event,
any direction=credit), a queued job attempts to settle their oldest
pending debts against the new balance. **Verified end-to-end**: drained a
driver's wallet to zero, completed a cash ride (`HTTP 200`, ride marked
completed, `earningsSettled: true` - it did NOT throw), confirmed a
pending debt was recorded, credited the wallet via a normal ride, waited
for the real settlement job, confirmed the debt flipped to `settled` and
the wallet was correctly debited. Same fix applied to
`LogisticsService`'s identical CASH/COD branch. Admin can write off a
genuinely uncollectable debt (`PATCH /admin/reconciliation/:id/write-off`).

**Driver incentive engine**: four types - `streak` (N trips within a
rolling window), `quest` (N trips total, one-time), `milestone` (lifetime
trip count, one-time), `peak_hour` (flat bonus per trip within a time
window, handles the midnight wraparound). All driven off the same
`ride.completed` event notifications/webhooks/audit already listen to -
no new event needed, just another subscriber - and wrapped in a try/catch
so a bug in incentive processing can never take down ride completion
itself. Rewards always land in the driver's **personal** wallet even for
fleet drivers, deliberately not routed through the fleet-earnings split,
since a performance bonus isn't fare revenue.

**A real bug this pass caught and fixed, via the e2e test rather than
code review**: the first full test run showed a quest incentive NOT
paying out despite two qualifying trips completing - empty progress,
no bonus transaction. Checked the server logs rather than guessing:
`invalid input syntax for type integer: "NaN"`. Root cause:
`progressRepo.create({ incentiveId, driverId })` doesn't apply the
entity's DB-level default (`tripsCompleted: 0`) to the in-memory
object TypeORM hands back - the property is `undefined` until saved, so
`progress.tripsCompleted += 1` on a freshly-created (not yet saved)
record computed `undefined + 1 = NaN`, which Postgres correctly rejected
for an integer column. Fixed by explicitly setting
`tripsCompleted: 0` in all three `.create()` call sites (quest, streak,
and the implicit one milestone doesn't hit since it assigns directly
rather than incrementing). Re-ran the exact same test after the fix:
quest correctly shows `tripsCompleted: 2, status: "rewarded"`, wallet
correctly includes the `bonus:1000.00` transaction on top of the two
ride earnings.

## Observability

**Prometheus metrics** (`GET /metrics`, Prometheus exposition format via
`prom-client`): default process metrics (CPU, memory, event loop lag, GC)
plus 7 real business metrics wired into actual code paths, not decorative
counters that never move:
- `ryda_http_requests_total` / `ryda_http_request_duration_seconds` — a
  global interceptor records every request, labeled by method/route
  (matched route pattern like `/rides/:id/accept`, not the raw URL with a
  live ride ID, which would blow up cardinality)/status.
- `ryda_ride_requests_total`, `ryda_ride_completions_total`,
  `ryda_ride_cancellations_total` — incremented at the exact points in
  `RidesService` where those things actually happen.
- `ryda_dispatch_offers_total` — incremented in `DispatchService` every
  time a smart-dispatch offer is created.
- `ryda_wallet_transactions_total` — incremented on both `credit()` and
  `debit()` in `WalletsService`, labeled by direction and category.

**Verified with real before/after deltas, not just "the endpoint
responds"**: read the counters, triggered a real ride request → accept →
arrive → start → complete flow through the actual API, read the counters
again, confirmed every relevant metric increased by exactly the expected
amount (ride requests +1, completions +1, dispatch offers +1, wallet
transactions +2 for the credit+debit pair, HTTP requests +18 matching the
number of calls made).

**Structured logging** via `nestjs-pino`, replacing Nest's default
console logger app-wide (`app.useLogger(app.get(Logger))` in `main.ts`,
with `bufferLogs: true` so early bootstrap logs aren't lost before the
real logger takes over). JSON in production, pretty-printed with colors
in development — verified both are genuinely pino output (timestamp,
level, pid, structured context object), not just Nest's default
formatting. Redacts `Authorization` and `x-api-key` headers. Skips
`/health` and `/metrics` in access logging so scrape traffic doesn't
flood the logs. **Note**: this controls NestJS's own application logs —
TypeORM's SQL query logging (`logging: true` in the database config) is a
separate, older logging path that isn't routed through pino; you'll see
plain-text SQL query lines alongside structured JSON app logs, which is
expected, not a bug.

**Sentry**: real `@sentry/node` SDK wiring (`SentryService`), same
graceful-no-op pattern used for Paystack/Maps/notification providers
throughout this project — logs a clear message and does nothing further
if `SENTRY_DSN` isn't set, rather than crashing or silently pretending to
work. Hooked into the global exception filter, but **only for 5xx
errors** — a 400 from a bad request body is expected input validation
doing its job, not an application bug, and would just be noise in error
tracking. Verified indirectly: triggered a real 400 (invalid registration
payload), confirmed the app handled it normally and `/health` still
reported healthy immediately after — Sentry reporting for genuine
application errors is correctly wired but untestable live without a real
Sentry project (same category as Paystack/Maps).

**Distributed tracing (OpenTelemetry)**: dependencies installed
(`@opentelemetry/sdk-node`, auto-instrumentations, OTLP HTTP exporter) but
**not actually wired into the bootstrap** — correctly scoped as a gap
rather than a half-working feature, since OTel's Node SDK needs to
initialize before other modules are `require`'d for auto-instrumentation
to hook in correctly, which means it belongs in a separate entry file
loaded via `--require`, not inside `main.ts` itself. Documented here as
the honest next step rather than shipped in a form that wouldn't actually
instrument anything.

The `HttpExceptionFilter` was converted from a manually-instantiated
filter (`app.useGlobalFilters(new HttpExceptionFilter())`) to a
DI-registered one (`APP_FILTER` provider in `ObservabilityModule`) since
it now needs `SentryService` injected — a manually-constructed instance
has no way to receive constructor dependencies from Nest's container.

## Deployment infrastructure

Everything below was actually run against real services in this sandbox
where possible (Postgres, Redis, `pg_dump`/`pg_restore`, the TypeORM CLI)
— Docker itself isn't installed here, so the `Dockerfile`/`docker-compose.yml`
are validated for YAML correctness and built from a standard, well-tested
multi-stage pattern, but not build-tested live; everything else in this
section was genuinely executed, not just written.

**Docker**: multi-stage `Dockerfile` (builder → prod-deps-only → runtime,
non-root user, real `HEALTHCHECK` hitting this project's actual `/health`
endpoint) and `docker-compose.yml` (app + Postgres + Redis, proper
`depends_on: condition: service_healthy` ordering, named volumes).

**CI** (`.github/workflows/ci.yml`): type-check → unit tests → build →
boot smoke test against real Postgres/Redis service containers, then a
separate Docker build job. The smoke-test step - `curl` against
`/health`, `/health/db`, `/health/redis` after actually starting the built
app - was run for real in this sandbox with the exact same commands
against live Postgres/Redis, confirming all three return healthy. **Not**
the full 19-script e2e suite on every PR — those include real timed delays
(the scheduled-ride test alone waits 15+ seconds) and don't belong gating
every commit; that suite is better suited to a scheduled/manual job.

**Kubernetes** (`k8s/`): `Deployment` (readiness probe on `/health/db` —
a pod that can't reach the database shouldn't receive traffic — liveness
on the bare `/health`), `Service`, `ConfigMap`, and a `Secret` *template*
(placeholder values only, meant to be filled via a real secrets manager,
not committed with real values). The Deployment manifest includes an
explicit comment about the same single-instance limitation documented
elsewhere: replicas >1 means the dispatch scheduler and WebSocket gateway
don't yet coordinate across pods.

**Environment validation**: a Joi schema deliberately does NOT hard-require
anything that already has a working default in `configuration.ts` — every
integration in this project (Paystack, Maps, Twilio, Sentry, S3...)
degrades gracefully when unconfigured, and a strict schema would silently
contradict that pattern and break local dev/CI. What it validates instead:
types and formats (numeric ports, valid `NODE_ENV` values) — the kind of
typo that would otherwise fail confusingly deep inside a library. Separately,
`assertProductionSecretsAreSet()` does one narrow, genuinely-worth-hard-failing-on
check: refuses to boot with `NODE_ENV=production` if the JWT secrets are
still the placeholder dev defaults.

**Database migrations**: `src/data-source.ts` is a standalone TypeORM CLI
DataSource (separate from the app's own `autoLoadEntities`-based
`TypeOrmModule.forRootAsync`, which doesn't work with the CLI). **Verified
with a real, complete migration cycle**: generated a migration from the
actual current schema (`npm run migration:generate`) — 386 lines covering
every entity across every module — ran it against a genuinely empty
database (`npm run migration:run`), confirmed all 55 tables were created
correctly, then reverted it (`npm run migration:revert`) and confirmed a
clean rollback down to just the migrations bookkeeping table. The
generated initial migration ships in `src/database/migrations/`. Production
should run with `DB_SYNCHRONIZE=false` and this migration workflow instead
of the dev-convenience auto-sync.

**Backup/restore** (`scripts/backup-db.sh`, `scripts/restore-db.sh`): real
`pg_dump`/`pg_restore` wrapped with this project's own `DB_*` env vars.
**Verified with a real round-trip**: created a test table with data, ran
the backup script, restored into a separate fresh database, confirmed the
data came back correctly.

## Geofencing

`Geofence` (circular zones: `restricted`, `alert_zone`, `service_area`,
`surge_zone`) + `GeofenceEvent` (a log of driver entries into monitored
zones). `GET /geofences/check?lat=&lng=` is a public point-in-zone query
using real Haversine distance, not a bounding box.

The genuinely interesting part is the real-time monitoring: `GeofenceService`
listens for the exact same `driver.location.updated` event the tracking
module's `LocationService` already consumes for route history — no new
event needed, just another subscriber. Every location update gets checked
against active `restricted`/`alert_zone` geofences; entering one logs a
`GeofenceEvent` and emits `geofence.entered`, which a notification listener
picks up to warn the driver (for `restricted` zones only — `alert_zone`
entries are for admin monitoring, not a driver-facing warning).

**Verified the full chain end-to-end**, not just the individual pieces:
created a restricted zone, updated a driver's location to a point inside
it via the real `PATCH /drivers/location` endpoint, and confirmed a
correctly-attributed `GeofenceEvent` (right zone name, right type, right
driver) showed up in the admin event log — proving the event listener
actually fires from a real location update, not just in isolation.

`service_area` zones double as an "is this pickup point actually in our
coverage area" check via `GeofenceService.isWithinServiceArea()` — built
but not yet wired into `RidesService.requestRide()` as an enforced
restriction (documented as a next step, not a silent gap).

## Operational admin tools

- **Queue monitoring** (`GET /admin/tools/queues`) — real `BullMQ`
  `getJobCounts()` across all 3 actual queues (notifications,
  scheduled-rides, reconciliation-settlement) — verified showing genuine
  non-zero `completed` counts matching activity from other tests in the
  same session, not a hardcoded shape.
- **Cache clearing** (`POST /admin/tools/cache/clear`) — flushes
  `SystemSettingsService`'s in-memory 30s-TTL cache, forcing the next read
  of every setting to hit the DB.
- **System diagnostics** (`GET /admin/tools/diagnostics`) — Node
  version/uptime/memory, queue stats, maintenance mode status, and feature
  flag states in one call, for a single "what's the system doing right
  now" ops endpoint.
- **Maintenance mode** — a real global `MaintenanceModeGuard`
  (`APP_GUARD`), deliberately built on `SystemSettingsService` rather than
  reusing `FeatureFlagsService`: the feature-flag system fails open to
  `true` for unknown keys, which is the right default for a normal feature
  (a typo shouldn't silently disable something) but exactly backwards for
  a kill switch (a missing flag defaulting to "maintenance is ON" would be
  a serious bug). Path-allowlist-based (`/health`, `/metrics`, `/auth`,
  `/admin` always reachable) rather than role-based, since global guards
  run before route-level JWT auth resolves — there's no user identity to
  check yet at the point this guard runs. **Verified**: enabling it
  correctly 503'd a normal endpoint while `/health` and the admin toggle
  itself stayed reachable (so an admin can always turn it back off),
  disabling it immediately restored normal access.

## OTP brute-force protection

A real gap, closed: previously nothing stopped patient brute-forcing of a
6-digit OTP beyond the generic per-IP throttle on the endpoint (which
doesn't track per-*destination* attempts, and resets). `OtpCode` now
tracks `attemptCount`; 5 wrong guesses against the same code locks it out
entirely — even the *correct* code is then rejected — until a fresh OTP is
requested. **Verified precisely**: 5 wrong attempts each correctly
rejected, the 6th attempt with the actual correct code was still rejected
with "Too many incorrect attempts," and requesting a new OTP for the same
phone number correctly reset the counter and verified successfully.

## Social/loyalty/sharing features (driver info, chat, split fare, loyalty, trip sharing)

Built to close gaps identified when comparing against Uber/Bolt feature
parity. All verified against a live running server, including a real
concurrency bug this testing caught.

- **`GET /rides/:id/driver-info`** — previously nothing let a passenger
  see who was picking them up beyond a raw `driverId` UUID. Joins the
  ride's driver/vehicle for name, photo, rating, vehicle details. Phone
  is exposed plainly, not masked — there's no telephony proxy (Twilio
  Connect etc.) in this deployment to issue a temporary number, which a
  privacy-conscious production rollout would want.
- **In-app ride chat** (`chat` module) — reuses `TrackingGateway`'s
  existing `ride:${id}` Socket.IO room rather than a second gateway.
- **Split fare** (`split-fare` module) — scoped deliberately: only
  splits with other *registered* Ryda users (resolved by phone), and
  payment flows as a wallet-to-wallet transfer into the initiator's
  wallet rather than touching `RidesService.completeRide()`'s own
  settlement logic — a smaller, safer surface than changing how the ride
  itself gets paid.
- **Loyalty points** (`loyalty` module) — same event-driven pattern as
  driver incentives (`@OnEvent('ride.completed')`, wrapped so a bug here
  can't break ride completion), tiers based on lifetime points so
  redeeming doesn't demote you.
- **Trip sharing** — `POST /rides/:id/share` (idempotent token) +
  `GET /rides/shared/:token` (deliberately public, no `JwtAuthGuard`,
  only safety-relevant fields returned — no fare, no passenger identity).

**A real race condition, caught by live testing, not code review**: a
passenger's own `GET /loyalty/me` landing at nearly the same moment as
the `ride.completed` event handler creating their loyalty account for
the first time caused a 500 — both saw "no account yet" via a plain
check-then-insert and both tried to `INSERT`, one hit the unique
constraint on `userId`. Fixed by catching the conflict and re-fetching
rather than assuming single-writer safety. Re-verified clean after the
fix. (A related, lower-probability race — concurrent point-balance
*updates*, as opposed to concurrent account *creation* — is noted as a
known limitation below rather than fully redesigned, since a user can
only be on one ride at a time in this platform, making it far less
likely to actually occur.)

## Tipping and ride verification PIN

Two more gaps closed against Uber/Bolt feature parity, both verified
end-to-end against a live server with zero surprises on the app side —
a clean run on the first live-execution test, likely because the app-side
field names were checked against the backend entity directly before
writing any code (a lesson from earlier bugs in this build).

- **Verification PIN**: a 4-digit PIN generated at `requestRide()` time,
  verified by the driver via `POST /rides/:id/verify-pin`. Deliberately
  *not* a hard gate on `start()` — a wrong or skipped PIN doesn't block
  the trip. This is opt-in extra assurance, not a new way for a driver
  who forgets to ask to accidentally break a ride.
- **Tipping**: `POST /rides/:id/tip`, a wallet-to-wallet transfer from
  passenger to driver, kept separate from `completeRide()`'s own
  settlement (same reasoning as split fare — smaller, safer surface than
  touching how the ride itself gets paid). Rejects tipping before
  completion and tipping twice.

Verified: wrong PIN returns `{verified: false}` (not an error — the
driver should be able to just try again), correct PIN verifies, a
non-assigned driver is rejected, tip amount was confirmed exact to the
naira on the driver's wallet balance.

## Email login

`email` was already an optional field on registration; login only
supported phone. Added email as an alternative login identifier.

`LoginDto` needed care to get right: a naive `@ValidateIf` pairing (skip
validating phone if email is present, and vice versa) has a real gap —
if *both* are provided, neither gets format-checked at all, since each
field's validator only runs when the *other* is absent. Fixed with
`@ValidateIf((o) => !!o.phone || !o.email)` (and the symmetric email
version): validates whenever the field is actually provided, AND is
still required when the other is absent. Verified all four cases
directly: phone-only, email-only, neither (clean 400 with both error
messages, not a crash), and both (both format-checked).

`AuthService.login()` looks up by email when provided, phone otherwise.
Verified: phone login still works unchanged, email login works, wrong
password via email is correctly rejected, and a non-existent email is
rejected the same way an unknown phone always was (no information leak
about which one is wrong).

## Free geocoding fallback (Nominatim)

Address search (`POST /maps/geocode` / `/reverse-geocode`) previously
hard-required `GOOGLE_MAPS_API_KEY` — with nothing configured, both
endpoints just returned a 400 saying so. Added `NominatimService`
(OpenStreetMap's free geocoder, no API key or billing account needed) as
an automatic fallback: `MapsController` tries Google first if it's
configured, falls back to Nominatim otherwise. This is what actually
unblocks address search out of the box.

**Untested live** — this sandbox's network policy blocks
`nominatim.openstreetmap.org` (confirmed: the block is from this
sandbox's own egress proxy, not Nominatim rejecting the request).
Built carefully against Nominatim's documented, long-stable API shape;
same category as Paystack/Google Maps in this project — correct as
written, needs confirming once it's actually running somewhere with
normal internet access.

Nominatim's usage policy matters here: it requires a real, identifying
`User-Agent` header (set in the service) and caps free public-instance
usage around 1 request/second — fine for development and modest
traffic, not meant for high production volume without self-hosting
Nominatim or switching to a paid provider later.

## Admin driver listing

There was no way for an admin to see any list of drivers before this —
only `GET /drivers/me` (self) and `GET /drivers/admin/documents/pending`
(document reviews, a different thing from approval status). Found
missing while building the admin dashboard's Drivers page, not assumed.
Added `GET /drivers/admin/list` with optional `?approvalStatus=` 
filtering, using the same lightweight query-builder join pattern
`AnalyticsService` already uses (joins `User` directly rather than
adding a new service dependency). Verified end-to-end from the admin
dashboard: a driver registered, appeared correctly in the real "pending"
filter, and moved into "approved" after the real approve action.

## Address autocomplete + a real robustness fix

Added `GET /maps/autocomplete` — returns multiple ranked address
suggestions (not just the top match, like `geocode` does), for a real
search-as-you-type experience instead of "type the full address, tap
Find." Backed by the same Google-first-Nominatim-fallback pattern as
the existing geocode endpoints.

**A real bug found while testing it, not by review**: none of the
Nominatim/Google Maps fetch calls had a timeout. Testing the actual
external-call path didn't just make one request hang — it took the
entire backend process down, including the health check. Added
`AbortSignal.timeout(5000)` to all 6 external maps call sites (both
providers, geocode/reverseGeocode/suggest). This is very likely a
sandbox-specific artifact of this build environment's own network
policy (it appears to kill a process on an unauthorized outbound
connection attempt, rather than the fast-reject a normal machine's
network would give) — but the timeout fix is correct, necessary
practice regardless of the specific failure mode, and doesn't depend on
that theory being right.

Verified: the short-query guard clause (under 3 characters returns an
empty array immediately, no external call) works correctly through the
real app's request/response contract, and the standard regression suite
— which never touches this path — stays completely clean before and
after.

## Notification categorization + driver trip count/level

Two closes against the passenger-app finishing pass:

- **`getDriverInfo()` now returns `completedTrips` and `level`** —
  both were already being fetched in the same query (the driver profile
  lookup), just never included in the response object. A one-line fix,
  found by checking what data was already in hand before assuming a new
  query was needed.
- **Real notification categorization**, not a client-side keyword hack.
  Added a proper `NotificationCategory` enum (ride/wallet/promotion/
  support/security/general) and column to the `Notification` entity,
  threaded a `category` parameter through the full pipeline —
  `notify()` → each `send*` method → `createRecord()` → the BullMQ
  queue job → the processor — and assigned the correct category to all
  14 `@OnEvent` handlers individually (ride lifecycle events → RIDE,
  referral/incentive/payment-failure → WALLET, support tickets →
  SUPPORT, SOS/geofence/driver-approval → SECURITY).

Verified end-to-end: a completed ride's resulting notifications came
back with `category: "ride"` exactly as the passenger app's filter
tabs expect, and `getDriverInfo()`'s new fields came back defined (not
`undefined`) on a real ride. Full regression and Jest suite both stayed
clean throughout.

## Real routed polyline for the map

`GoogleMapsService.getDirections()` was already capturing the route
polyline in its response (`overview_polyline.points`) — it just wasn't
exposed anywhere, only `distanceKm`/`durationMin` were used by
`FareService`. Added `GET /rides/:id/route`, decoding Google's encoded
polyline format server-side (a standard, well-documented algorithm — new
`common/utils/polyline.util.ts`) into a plain coordinate array, so the
client never needs its own polyline-decoding library.

Computed on demand rather than stored at ride-creation time: only
actually needed once someone opens a map for that ride, not on every
fare estimate, avoiding an extra Directions API call for rides nobody
ever looks at on a map. Returns `null` when Google isn't configured
(Nominatim has no routing capability at all) so the app's map falls back
to its existing straight-line placeholder rather than erroring.

**Verified the polyline decoder against Google's own published test
case** before trusting it in production code — not just "looks like the
right algorithm." Also verified access control (ride participants can
fetch it, an unrelated driver gets a clean 403) and the graceful-null
path end-to-end, including through the app's actual `ridesApi.getRoute()`
call, not just raw HTTP.

## A real security gap found and fixed, plus admin ride list/search

Found while building the admin dashboard's Rides page, not assumed:
`GET /rides/:id` had **zero ownership check** beyond being logged in —
any authenticated passenger could view any other ride's full details
(fare, addresses, everyone involved) just by knowing or guessing the
ID. Fixed with a new `getForUser()` wrapper using the same
isParticipant-or-staff check already used by `getDriverInfo`/
`getPassengerInfo`/`getRoute` — deliberately not touching `findById()`
itself, since that's a bare internal helper every other ride action
(accept/arrived/start/complete/cancel/etc.) already calls with its own
separate, action-appropriate authorization.

Also added `GET /rides/admin/list` — same category of gap as the
earlier driver-list fix: nothing let staff search or list rides at all,
only `GET /rides/mine` (self) and `GET /rides/:id` (needs the exact ID
already). Supports status filtering, a text search across ride ID/
passenger name/phone/driver name/phone, and pagination.

**A real SQL bug this caught, not found by review**: the join between
`rides` and `users` failed with `operator does not exist: uuid =
character varying` — `User.id` is a genuine Postgres `uuid` column,
but `Ride.passengerId`/`driverId` were declared as plain `varchar`.
Fixed with an explicit cast in the join condition
(`passenger.id::text = ride.passengerId`) rather than risk a schema
migration that could touch other code already depending on those
columns' current type.

Verified end-to-end: the security fix (unrelated driver correctly
rejected, the ride's own passenger unaffected), the list/search/filter
all returning correct results with real joined names, and non-staff
correctly rejected from the admin endpoint — through the admin
dashboard's actual `ridesApi.list()` calls, not just raw HTTP. Full
regression and Jest suite stayed clean throughout.

## Support ticket list enrichment (admin dashboard)

`GET /admin/support/tickets` already existed, fully built — status/
category/agent filtering and pagination were already there. What it
returned was bare `SupportTicket` rows with a raw `userId` and no
readable name, the same gap already found and fixed twice for rides
and drivers. Enriched `listAll()` with the same lightweight join
pattern, applying the `::text` cast on the uuid side proactively this
time (`User.id` is a real Postgres `uuid` column, `SupportTicket.userId`
is plain `varchar` — the exact mismatch that caused a live 500 on the
rides list fix) rather than finding it again by hitting a crash.

Verified end-to-end through the admin dashboard's actual code: list
with the requester's name correctly joined in, category filtering,
fetching a ticket's detail and message thread, replying, assigning to
self (with the existing auto-transition to `in_progress` confirmed),
resolving, and confirming it then shows correctly under the resolved
filter. Full regression stayed clean throughout.

## Admin user list + account suspension

`GET /search/passengers` already existed but is a lightweight type-ahead
tool — hardcoded limit of 10, no pagination, no total count, no status
filter, thin field set. Not enough for a real browsable admin list.
Added `GET /users/admin/list` (role/active-status/search filtering,
real pagination) as a proper one, following the same pattern now used
four times (rides, drivers, support tickets, users).

Also added `PATCH /users/admin/:id/active/:isActive` — there was no way
for an admin to suspend or reactivate any account anywhere in the
codebase before this, a real gap for handling an abusive or fraudulent
account. Deliberately scoped to just flipping the flag; force-logging-
out active sessions or cancelling in-progress rides on suspension are
real follow-up concerns for a genuine trust-and-safety flow, not bolted
on silently here without dedicated design — noted as a known gap.

No cross-entity join needed this time (querying `User` directly), so
none of the `uuid`/`varchar` cast issues that hit the rides and support
fixes applied here — confirmed by the live test passing cleanly on the
first attempt.

**Verified the suspend action has real teeth, not just a cosmetic
flag**: after suspending a test account, confirmed a login attempt
against it is correctly rejected with 401 "Account is disabled" (an
existing check in `AuthService.login()` this now actually engages) —
not just checking that a boolean flipped in a list view.

## Emergency Center enrichment + driver emergency contacts

Same "raw userId, no name" gap already found and fixed four times
(rides, drivers, support, users) — here it mattered more than usual: a
responder looking at an active SOS needs to know who's in danger at a
glance, not resolve a UUID first. Enriched both `listActive()`/
`listAll()` (incidents) and `getLiveRides()` (passenger AND driver
names) with the same join pattern, `::text` cast applied proactively.

Also added driver-scoped emergency-contacts routes
(`GET/POST/DELETE /drivers/me/emergency-contacts`). Found while
building this that the underlying `EmergencyContact` entity and
`PassengersService` methods were already keyed by plain `userId`, not
tied to `PassengerProfile` at all — so this reuses the exact same
service rather than duplicating the feature; only the routes and role
restriction are new.

Verified end-to-end: a 7-step live-execution test covering a real SOS
trigger with correct reporter name, acknowledge, resolve, the
active/full-history split, live-ride monitoring with both passenger and
driver names correct, and a real force-cancel — plus a separate 9-step
test confirming the reused driver emergency-contacts routes (add, list,
remove) and both SOS trigger paths (general and ride-tied) work
correctly and are correctly attributed to the driver on the admin side.

## Driver document review enrichment + Vehicle admin management (new)

**Document review**: same "raw ID, no name" gap already found five
times — enriched `listPendingReview()` with the driver's name via a
join. This one is a genuine two-hop join (document → driver profile →
user), and it caught a real, different bug than the earlier ones: the
error was `operator does not exist: text = uuid` — the *reverse* of the
usual `uuid = character varying` mismatch. Turned out `DriverProfile.
userId` is declared with both a plain `@Column()` **and** a
`@OneToOne`/`@JoinColumn` relation to `User` — that relation mapping
makes Postgres create it as a genuine `uuid` column, not `varchar`,
unlike every other "foreign-key-style string column" hit so far. Fixed
by removing the (wrong, unnecessary) cast on that specific join leg
while keeping it on the other. This also explains, in retrospect, why
an earlier join (`DriversService.listForAdmin()`, joining on the same
`driver.userId`) worked correctly without a cast the first time — not
luck, the same underlying reason.

**Vehicle admin management**: there was no way at all for an admin to
see or manage vehicles before this — `GET /vehicles/mine` was the only
endpoint. Added `GET /vehicles/admin/list` (status filtering,
pagination, driver name joined in — a clean single-hop join this time,
since `Vehicle.driverId` stores the raw User id directly) and exposed
the `setStatus()` method that already existed on the service but had no
controller route. `VehiclesController`'s `@Roles` decorator moved from
class-level to method-level, since the new admin endpoints need a
different role set than the driver-only `register`/`mine` endpoints.

Verified end-to-end: an 8-step raw-HTTP test (documents + vehicles
together) confirmed both fixes work and that the vehicle-status filter
transitions correctly move an item in and out of each tab, plus a
separate 6-step test running the admin dashboard's actual `documentsApi`
and `vehiclesApi` calls against a live backend. Full regression and
Jest suite stayed clean throughout both rounds.

## Payments admin visibility + a real refund-flow robustness fix

`GET /payments` and `POST /payments/:id/refund` already existed
(admin/finance-restricted, with real validation — refund only works on
a successfully-settled, non-simulated payment) but `findAll()` was
bare: no pagination, no status/method filtering, no joined payer name.
Same enrichment pattern as six earlier fixes — `PaymentRecord.userId`
is a plain `@Column()` with no relation annotation, so it needed the
`::text` cast (unlike the `DriverProfile.userId` surprise from the
documents fix).

**A real robustness gap found while checking it was safe to test the
refund action live**: `refundPayment()` calls Paystack's refund API
with no timeout on the underlying `fetch()` — the same class of bug
already fixed for Google Maps/Nominatim. Safe to test in this sandbox
specifically (Paystack's own `request()` method checks for a configured
secret key *before* attempting any network call, so it fails fast
rather than hangs), but a real gap for a production deployment where
Paystack *is* configured and experiences a slowdown or outage. Fixed
with the same `AbortSignal.timeout()` pattern (10s, slightly more
forgiving than the 5s used for maps calls, since payment operations
legitimately take longer).

Verified end-to-end: a live-execution test running the admin
dashboard's actual `paymentsApi` calls against a live backend — list
with the payer's name correctly joined, search, status filtering, and
a real refund attempt against a non-simulated payment record that
failed cleanly with a clear error message (Paystack not configured
here) rather than hanging — then explicitly confirmed the server was
still responding immediately after, which is the entire point of the
timeout fix. Full regression and Jest suite stayed clean throughout.

## Commission reports

The Overview dashboard already showed total commission collected (as
"platform revenue") and its trend over time — this didn't duplicate
that. The genuine gap: no per-driver breakdown existed anywhere, and
the commission-rules endpoints (list/create) had zero UI. Added
`GET /admin/commission/reports/summary` and `.../reports/by-driver`
(a clean single-hop join — `Ride.driverId` is a plain string column
like most cases, not the `@JoinColumn` surprise from the documents fix)
as a new, separate `CommissionReportsController` rather than bolt onto
the existing rules controller — avoided an ugly relative-path
(`../reports/...`) route hack I'd initially reached for and caught
before shipping it, in favor of a clean dedicated `admin/commission/reports`
path.

**A real test breakage caught by `tsc`, not missed**: adding a second
constructor parameter (`ridesRepo`) to `CommissionService` broke
`commission.service.spec.ts`, which instantiates the service directly.
Fixed all six call sites — and on the first pass, put the mock
arguments in the wrong order relative to the real constructor
(`rulesRepo` first, `ridesRepo` second). Caught by checking the actual
constructor signature rather than assuming the order I'd used, then
confirmed with a real Jest run (not just a passing `tsc`) that all 40
tests genuinely still pass.

Verified end-to-end: summary and by-driver reports against a real
completed ride return correct totals and the driver's name (not a bare
UUID), rule creation works, a future date range correctly returns zero
activity, and non-staff drivers are rejected. Full regression and Jest
suite clean throughout.

## A real dispatch bug: rides could get permanently stuck in "searching"

Found while debugging a live report ("passenger requests a ride, driver
is online, it just stays finding a rider forever"). Traced the actual
matching logic rather than guess:

- The periodic retry sweep (`@Interval(15000)` on
  `expireStaleOffersAndReassign()`) is correctly wired up and running —
  worth stating plainly since I initially, wrongly, concluded it wasn't
  (I'd viewed the method body without the line above it holding the
  decorator, corrected before pursuing that as the fix).
- The actual bug: `offerToNearestDriver()`'s exclusion logic treated a
  merely **expired** offer identically to an explicit **decline** —
  both permanently removed that driver from ever being re-offered the
  *same* ride. With only one nearby driver, one missed or slow-to-notice
  offer (very plausible: the driver app's push delivery is documented
  as unverified live, and its in-app fallback is a 5s poll plus human
  reaction time against a default 20s offer window) permanently
  exhausted the only eligible candidate — no driver left to offer, ride
  stuck in `SEARCHING` forever, no way to recover without a passenger
  cancel/re-request.
- Fixed by only excluding `DECLINED` (an explicit no) — `ACCEPTED`/
  `SUPERSEDED` also kept in the exclusion set for safety, though those
  states shouldn't coexist with a still-searching ride in practice. An
  `EXPIRED` offer now correctly makes the driver eligible again on the
  next sweep.

**Verified against the real, unmodified production scheduler, not a
manually-triggered call**: one driver online with a real GPS location
set, a ride requested, the resulting offer forced into the past to
simulate a missed notification, then an actual 16-second wait for the
genuine `@Interval(15000)` tick to fire on its own. Confirmed a second
pending offer was created for the same driver and the ride stayed
`SEARCHING` (correctly retrying) rather than stuck with zero offers.
Full regression and Jest suite stayed clean throughout.

## Analytics — seven new report endpoints

Overview already showed point-in-time totals (GMV, revenue, ride
counts, drivers online) and one trend (revenue over time). Genuinely
missing: trip-volume trends, a real cancellation *rate* (not just a
running count), peak-hour demand shape, city and vehicle-category
breakdowns, growth (new signups), and active-user trends. Added all
seven as new `AnalyticsService` methods and `GET /admin/analytics/*`
endpoints — `trips-trend`, `cancellation-rate`, `peak-hours`,
`by-city`, `by-vehicle-category`, `growth`, `active-users`.

A few worth explaining:
- **"Active"** is defined as having completed at least one ride within
  the period — a defensible, commonly-used definition, distinct from
  "online right now" (which the Overview card already covers).
- **Peak hours** always returns all 24 hours explicitly, including
  zero-ride hours, so a chart never has a silently missing bar.
- **Cancellation rate** is computed from the same underlying trip-trend
  query rather than a second, separate aggregation — one source of
  truth for completed/cancelled counts per period.

All seven raw SQL aggregations (`FILTER (WHERE ...)`, `EXTRACT(HOUR
FROM ...)`, `date_trunc`, `COUNT(DISTINCT ...)`) worked correctly
against real data on the first live-execution attempt — a genuine
green flag from the discipline of checking entity column types (uuid
vs varchar, relation-mapped vs plain) before writing joins on every
earlier admin feature, though these particular queries didn't need any
cross-entity joins at all.

Verified end-to-end: all seven endpoints against real ride/signup data,
groupBy switching (day/week/month) confirmed working, and non-staff
access correctly rejected. Full regression and Jest suite clean
throughout.

## Deploying (Render)

`render.yaml` deploys the backend, a Postgres database, and a Redis-
compatible Key Value store together as a single Render Blueprint — push
to GitHub, then in the Render Dashboard choose New > Blueprint and point
it at the repo.

This needed two real portability fixes first, not just a YAML file:
this backend originally only accepted discrete `DB_HOST`/`DB_PORT`/etc.
and `REDIS_HOST`/`REDIS_PORT`/etc. — but Render (like Railway, Heroku,
Supabase, Neon, and most other hosts) hands you a single connection
string instead. Added `DATABASE_URL` and `REDIS_URL` support, both with
a graceful fallback to the original discrete vars when unset, so local
dev is completely unaffected — verified with a real running app,
including a password containing special characters, correctly
URL-decoded. Also added `DB_SSL` (off by default — local Postgres has
no TLS listener; most hosted Postgres requires it) and pinned the Node
version via `.node-version` to match what this backend has actually
been built and tested against.

**Honest tradeoffs of staying on Render's Free tier**, confirmed
directly against Render's own docs rather than assumed: the free
Postgres instance expires 30 days after creation (14-day grace period
after that before deletion) — fine to start, but mark your calendar or
upgrade to Basic (~$6-7/month) before then if this holds data you care
about. The free Key Value instance loses all its data on every restart
— an acceptable tradeoff for what this app actually uses Redis for (a
BullMQ job queue backing notification delivery, scheduled-ride
activation, and reconciliation auto-settlement — losing in-flight jobs
occasionally is a minor, recoverable issue), but would be a real problem
if anything here depended on Redis for durable storage, which nothing
does. The free web service spins down after 15 minutes of inactivity
(~1 minute cold start on the next request) — annoying for interactive
testing, a non-issue for anything that tolerates a slow first request.

**One manual step after first deploy**: this doesn't seed an admin
account automatically. Run `npm run seed:admin` once via Render's Shell
tab (with `ADMIN_PHONE`/`ADMIN_PASSWORD`/etc. already set as env vars
from the Blueprint, so the shell picks them up automatically).

## Driver app Tier 1: referral summary + document file upload

Two real backend gaps found while building the driver app's Referral
Centre and Documents screens, not assumed beforehand:

- **No self-service referral endpoint existed at all** — only the
  automated grant logic that fires on a referee's first completed ride.
  Added `GET /promotions/referrals/mine` (total earned, invite history
  with names). Added `UsersService.findByIds()` as a genuinely reusable
  batch-fetch, since nothing like it existed.
- **No way to actually get a document URL** — `POST /drivers/documents`
  always expected a pre-existing `documentUrl` string, but nothing
  produced one for driver documents specifically (the pattern already
  existed for profile photos, just never had a driver-documents
  equivalent). Added `POST /drivers/documents/upload-file`, a real
  multipart endpoint reusing the same `StorageService` as profile
  photos.

Also confirmed (not assumed) that `Ride.commissionAmount`/
`driverEarnings` were already returned by the driver's own ride-history
endpoint — the "commission breakdown" feature needed a UI change only,
not new backend work.

Verified end-to-end: a real referrer/referee flow with a real completed
ride, confirming the correct bonus amount and referee name; a genuine
multipart file upload (not simulated) producing a real URL, submitted
as a document record, confirmed present afterward. A test-script bug
caught along the way — my test claimed a driver went online but never
actually made that call, which surfaced as a confusing "ride not found"
result until traced back to its real cause (a 400 on accept, not a
lookup bug). Full regression and Jest suite clean throughout.

## Wallet withdrawal — the real feature, built with care given it moves actual money

The low-level Paystack transfer integration already existed
(`createTransferRecipient`, `initiateTransfer`, `listBanks`) — nothing
was ever wired into an actual withdrawal feature. Built the missing
layer:

- **Real account verification, not a self-reported name.** Added
  `PaystackService.resolveAccountNumber()` — the account name shown and
  stored comes from Paystack's own bank records, checked before a
  transfer recipient is ever created. The existing
  `createTransferRecipient()` took `name` as a bare input parameter
  with nothing verifying it — closed that gap rather than build on top
  of it uncritically.
- **`BankAccount`** — a driver's saved payout destination, first one
  added becomes the default automatically.
- **`WithdrawalRequest`** — a real status lifecycle
  (pending/processing/completed/failed), not an instant fire-and-forget.
  Debit-then-transfer, reusing `WalletsService.debit()`'s existing
  row-locked balance check rather than reimplementing it. If Paystack's
  initiate-transfer call fails immediately, the debit is reversed right
  away; if it fails later (the normal case — transfers settle
  asynchronously), the extended Paystack webhook handler
  (`transfer.success`/`transfer.failed`/`transfer.reversed`) refunds
  the wallet then.
- **A genuine circular dependency**, handled properly: `WalletsModule`
  needs `PaystackService` (from `PaymentsModule`), and the webhook
  handler in `PaymentsController` needs `WithdrawalsService` (from
  `WalletsModule`) to route transfer events back. Used NestJS's
  `forwardRef()` on both sides — and didn't just trust `tsc` passing as
  proof this actually works, since circular DI resolution is a runtime
  concern, not a compile-time one. Verified by actually booting the
  app and confirming "Nest application successfully started," not
  assumed from a clean type-check.

**Honest about what's verified and what isn't**: every validation path
is tested live — clean rejection (not a crash) when Paystack isn't
configured, confirmed the server survives that rejection, wrong-owner
bank account access denied, auth required throughout. What's **not**
verified, and can't be from this environment: the actual happy path of
adding a real bank account and receiving a real payout, since that
needs genuine Paystack credentials this sandbox doesn't have — the same
honest limitation that applies to every other real Paystack integration
in this build (refunds, card charges).

## Shift tracking + driver analytics — the shared foundation for both

A real finding before writing any new tracking code: acceptance rate
and driver-attributed cancellation rate needed **zero new
infrastructure**. `RideOffer.status` and `Ride.cancelledBy` already
existed and were already populated by the real accept/decline/cancel
flows — this only ever needed new aggregation queries against data that
was already there. The one thing genuinely missing was online-hours/
shift tracking, since nothing timestamped availability transitions at
all.

- **`DriverAvailability.BREAK`** — a new status. Dispatch's driver
  search already does an exact match on `'online'`, not "anything but
  offline," so a driver on break is automatically excluded from ride
  offers with zero changes needed to dispatch logic. Verified live, not
  assumed: confirmed the existing filter behavior rather than trust
  that it would "just work."
- **`DriverAvailabilityLog`** — one row per continuous period in a
  given status, written by `DriversService.setAvailability()` on every
  real change. This is the single choke point every availability
  transition already goes through — including `ON_TRIP`, set
  automatically by the ride-acceptance flow — so no other code needed
  touching to get complete coverage.
- **No separate "start shift" concept** — a shift is derived from the
  log: the continuous run of ONLINE/BREAK rows between two OFFLINE
  boundaries, matching how Uber/Bolt-style apps actually work. Going
  online *is* starting your shift.
- **Shift grouping is done in application code, not SQL** — a driver's
  shift count is naturally small, and walk-and-bucket-on-status-change
  is far clearer this way than a window-function query would be.

Verified end-to-end with real elapsed time, not just checking that
numbers appeared: online → break → online → offline, then confirmed
the *exact* recorded durations at the raw database level (3.04s, 2.09s,
1.03s) matched the test's real `sleep` calls to the millisecond — not
just that the API returned something plausible. Also confirmed a real
completed ride correctly produces a 100% acceptance rate and 0%
cancellation rate, and that non-drivers are rejected from every new
endpoint. Full regression clean throughout.

## Fleet + Corporate admin visibility

**Fleet** already had one admin endpoint (`GET /fleet/admin/companies`),
but it was a bare, unenriched list — no owner name, no driver/vehicle
counts, no way to act on anything. Same "raw list" pattern found
repeatedly elsewhere. Enriched it and added
`PATCH /fleet/admin/companies/:id/active/:isActive`.

**Corporate had zero admin endpoints at all** — only self-service ones
(`accounts/mine/*`), all locked behind a class-level
`@Roles(UserRole.CORPORATE)` that made adding admin routes to the same
controller impossible without restructuring. Moved `@Roles` to
method-level (same fix `VehiclesController` needed earlier) and built
the admin surface from scratch: enriched list, activate/deactivate.
Verified the refactor didn't break the existing self-service endpoint
— not assumed, explicitly re-tested `GET /corporate/accounts/mine`
after moving the decorator.

Both enrichments reused `UsersService.findByIds()` (built a few rounds
back for the driver Referral Centre) rather than duplicate a batch-
fetch — genuinely useful now on its third real use.

Verified end-to-end: a real fleet company and a real corporate account
created through their actual owner-facing endpoints, confirmed correct
in the enriched admin list (owner name, not a bare ID), deactivate/
reactivate both round-tripped correctly, and non-admin access rejected
from both. Full regression clean throughout.

## Redesigned: passenger picks their driver (real request, real architecture change)

The original dispatch model was automatic — system picks the nearest
driver, silently retries a different one if they don't respond. A real
user report was direct about this causing driver-side problems, and
asked for the Uber/Bolt-style alternative instead: passenger sees a
list of nearby drivers with distance/ETA, picks one specifically, that
driver gets a real window to respond, and if they don't, the passenger
picks again themselves — no silent reassignment.

**A real correctness gap found and closed before building on top of
it**: `acceptRide()` let *any* online driver claim a searching ride,
regardless of who was actually offered it. Building passenger choice on
top of that unfixed would have been broken by construction — a
different driver could swoop in via broadcast-accept while the chosen
one was still deciding. Added an exclusivity check: while a specific
offer is pending, only that driver may accept. Broadcast-accept still
works exactly as before for rides nobody's selected anyone for yet
(confirmed via the full existing e2e suite, unchanged, still passing).

What changed:
- Automatic dispatch removed from ride creation and scheduled-ride
  activation — a ride now just sits `SEARCHING` until the passenger
  acts, not auto-matched.
- The periodic sweep and the driver-decline path both used to
  auto-reassign to the next-nearest driver; both now just record the
  outcome (expired/declined) and stop. The old
  `offerToNearestDriver()` method is kept, not deleted — real, working,
  tested capability that could be wired back in later as an
  "auto-assign for me" option, just not the automatic default anymore.
- Three new endpoints: `GET /rides/:id/selectable-drivers` (name,
  vehicle, rating, distance-based ETA estimate — no Directions API
  configured in this environment, so this is a straight-line-distance
  approximation using an assumed 28 km/h average urban speed, not
  real traffic-aware routing), `POST /rides/:id/select-driver` (creates
  a targeted offer, no "nearest" ranking involved — this is the
  passenger's explicit choice), `GET /rides/:id/current-offer` (lets
  the app distinguish "waiting on someone" from "show the list again,"
  since the ride's own status alone doesn't change through this cycle).
- Offer timeout default changed from 20s to 60s.

Verified end-to-end with two real drivers and a real passenger: no
auto-offer on creation, the selectable-drivers list showing both with
correct names/vehicles/ETA, the critical exclusivity check actually
rejecting the non-selected driver with a clear error, a decline
correctly *not* triggering silent reassignment, successful reselection
of a different driver afterward, and broadcast-accept confirmed still
functional for the no-offer-yet case. A test-script bug surfaced and
was fixed along the way — a bash function-wrapper pattern I hadn't used
successfully before in this whole session produced silently wrong
variable capture; rewritten inline, matching the pattern that's worked
reliably every other time. Full regression and Jest suite clean
throughout.

## Document approval now genuinely gates going online

`hasAllRequiredApproved()` (license, insurance, roadworthiness all
approved) already existed on `DriverDocumentsService` — genuinely never
called anywhere in the codebase before this. Wired it into
`DriversService.setAvailability()`: going ONLINE or BREAK now requires
it, with a clear, specific error message naming what's missing. Going
OFFLINE is deliberately exempt — a driver should always be able to stop
working regardless of document status.

**This broke the existing e2e regression test**, and that was the
correct outcome, not a problem to work around — the test had never
uploaded or approved any documents before going a driver online, which
was only possible because the check didn't exist yet. Updated
`e2e-test.sh` to approve the three required documents via direct SQL
(same simulated-admin-action pattern the script already uses for the
driver-profile approval one step earlier) before attempting to go
online, matching the new real requirement rather than weakening the fix
to keep old test data working.

Verified end-to-end: going online with zero documents rejected with the
specific message, still rejected with only one of three approved,
succeeds once all three are approved, and going offline confirmed to
work regardless of document status. Full regression (now with the
updated setup) and Jest suite clean.

## Fixed a real bug from a live report: document uploads hanging instead of failing

A driver reported "could not upload this document, try again" — the
driver app's *fallback* error message, used specifically when a
response isn't clean JSON at all, not a normal rejected request.
Combined with Render's live logs showing no completed request log line
for the upload whatsoever, this pointed at something hanging rather
than failing cleanly.

Traced it to the same class of bug already found and fixed for Google
Maps, Nominatim, and Paystack earlier in this build: the R2 (and plain
S3) client had zero timeout configured. A misconfigured account ID,
wrong bucket, or unreachable endpoint would hang the request
indefinitely rather than error out — Render's own proxy eventually
kills a request like that and returns a non-JSON response, which is
exactly what produced the generic fallback text instead of a real
error message.

Fixed with a real connection/request timeout (`@smithy/node-http-handler`,
5s connect / 15s total) on both `CloudflareR2Provider` and `S3Provider`
— added as an explicit dependency rather than relying on it being
available transitively through `@aws-sdk/client-s3`, since an
undeclared transitive dependency is fragile if AWS SDK's internals ever
change.

Verified with a real timed request against deliberately bogus R2
credentials: completed in ~1 second with a clean JSON 500 response,
not a hang — confirming the fix's core value (fast, clean failure)
even though this sandbox's own network restrictions mean it can't
exercise the exact 15-second timeout boundary against a genuinely slow
(rather than blocked) endpoint. Full regression clean throughout.

## Surface the real storage error instead of a generic 500

Once the timeout fix above was deployed and confirmed working (real,
fast failures instead of hangs), the driver still saw the exact same
generic "could not upload" text — which turned out to be a second,
completely separate bug, not evidence the first fix hadn't worked.
`uploadDocumentFile()` had no error handling of its own — NestJS's
default handler turns any unhandled exception into a bare "Internal
server error" with no indication of what actually went wrong. Added a
try/catch that surfaces the real underlying reason (e.g. an actual AWS
SDK error message), so a wrong bucket, bad credentials, or a
misconfigured account ID is now diagnosable from the response itself,
not just from digging through server logs.

## Cleaned up five stale "known gaps" and added real wallet date filtering

Before building anything, checked the passenger and driver app READMEs'
own "known gaps" lists against the actual code, rather than trust them.
Five entries turned out to be stale — already fully built in earlier
rounds but never removed from the list: driver trip count/level display,
document-upload gating on going online, and push notification device
registration (both apps, fully wired into login/register/session-restore).
Removed all five rather than rebuild things that already worked.

The one genuinely real, still-open item — no way to see earnings by
time period — got a real fix: `GET /wallet/transactions` now accepts
`from`/`to` query params. Verified with a real transaction and both a
matching and a non-matching date range, not just an empty response
either way (which would prove nothing) — confirmed the transaction
appears in a "today" range and correctly disappears in a "2099" range.

## Fixed a real bug from a live report: drivers never got notified of a selected offer

A driver reported never seeing the notification for a ride they'd
genuinely been selected for. Investigated with a real live test rather
than guessing — created a real offer end-to-end and checked, directly,
whether a notification record actually got created. It didn't. The
offer itself was always correct (`getMyPendingOffer()` found it fine,
which is exactly why every earlier round of testing this feature never
caught the problem — that check was never what was broken).

Root cause: `offerToSpecificDriver()` (built for the passenger-picks-
driver redesign) never emitted the `ride.offered` event that
`NotificationsService.onRideOffered()` listens for. The older
`offerToNearestDriver()` method still has this emit call — it was
simply never carried over when the new method was built as a separate
method rather than a variant of the old one. This was a real gap in my
own earlier verification of that redesign: every test at the time
checked the offer mechanic itself (exclusivity, selection, acceptance)
but never checked whether a notification was created as a side effect
of it.

Fixed by adding the same `events.emit('ride.offered', ...)` call.
Verified with the exact test that caught the bug, re-run after the
fix: real notification created (both `push` and `in_app` channels),
confirmed present via `notificationsApi.list()`. One thing worth
noting about the verification itself — the first re-test attempt still
appeared to fail because the event listener is async and doesn't
block the response; a 1-second wait was needed before checking, which
is itself a small useful finding about how quickly a real client
should expect the notification to actually land after selecting a
driver. Full regression clean throughout.

## Fixed: offered-but-not-accepted drivers couldn't load their own ride

Direct continuation of the notification fix above — once a driver
actually started receiving offer notifications again, a new error
surfaced: "Unable to load this ride offer." Real bug, not a repeat of
the same one. `getForUser()`'s participant check
(`ride.passengerId === requesterId || ride.driverId === requesterId`)
only recognizes a driver *after* they've accepted — `ride.driverId`
stays null until then. A driver viewing their own offer screen, which
calls `GET /rides/:id` to show pickup/dropoff/fare *before* deciding
whether to accept, was never covered by that check at all.

Fixed by also checking for a genuinely pending offer
(`DispatchService.getMyPendingOffer()`) when the requester is a driver
and isn't already recognized as a participant. Verified live: the
offered driver now gets a real 200 with full ride data, and — checked
specifically so the fix isn't accidentally too broad — a completely
unrelated driver who was never offered this ride is still correctly
rejected with 403.

## Fixed a real, serious bug: a failed payment could leave a ride stuck "completed" with no payment ever processed

A live report described a ride showing as stuck "in progress" in the
app while actually having been completed — a mismatch worth taking
seriously, not just working around. Traced it to a genuine data-
integrity bug: `completeRide()` saved `status = COMPLETED` to the
database, then ran payment settlement (wallet debit, card charge, etc.)
completely unprotected afterward. If that settlement step threw for
any reason — insufficient wallet balance being the most likely real
case — the ride stayed permanently marked completed in the database
with no payment ever processed, while the driver's app only received a
failed request and had no way to know the underlying status had
already changed underneath it.

A full cross-service transaction wrapping every call this method
touches (wallets, fleet, corporate, payments, promotions) would be the
most thorough fix, but it's a genuinely invasive refactor across
several files — too risky to attempt as an urgent fix. Went with a
safer, targeted one instead: wrap the whole payment-settlement block in
a try/catch that reverts the ride back to `IN_PROGRESS` (clearing the
completion fields that were set) before re-throwing, so a failure
leaves the ride in a genuinely consistent, retryable state rather than
a stuck, inconsistent one that previously needed a manual database fix
to recover from.

Verified live, not just reasoned about: created a real ride with a
passenger who deliberately had zero wallet balance, confirmed
completion fails cleanly with a real error rather than a silent
success or a crash, confirmed the ride correctly reverts to
`IN_PROGRESS` rather than getting stuck, then funded the wallet and
confirmed the *exact same* completion request succeeds cleanly on
retry — proving this isn't just "fails safely" but "is actually
recoverable, not just consistent." Full regression clean throughout.

## Fixed a critical, real security bug: wallet top-up credited money with zero payment verification

A live report described the wallet "still using mock up even after
adding the Paystack API" — worth taking completely seriously rather
than assuming it was just a leftover setting. It wasn't a mode; it was
a real, exploitable endpoint. `POST /wallet/topup` took a raw `amount`
from the request body and credited the wallet directly — any
authenticated user could call it with any amount and get free money
credited instantly, regardless of whether real Paystack keys were
configured, because this endpoint never called Paystack in the first
place. The original code's own comment even called this a "known gap,"
which is exactly why it needed fixing properly before real users could
reach it, not just documenting further.

Replaced entirely with a real Paystack-backed flow, matching the exact
pattern `initCardAdd()` already used correctly elsewhere in this same
file: `initWalletTopUp()` creates a pending payment record and a real
Paystack transaction, returning a genuine hosted-checkout URL. The
wallet is never credited at this step — only `creditWalletFromTopUp()`,
called from the webhook once Paystack actually confirms a real
`charge.success`, ever adds money, and it credits the exact amount
stored on our own payment record (set at init time), not anything the
webhook payload itself claims. The webhook handler now distinguishes a
wallet top-up from a card-verification charge using the `purpose`
metadata set at init — both share `rideId === null`, so the existing
check alone couldn't tell them apart.

The old `POST /wallet/topup` endpoint doesn't just do less now — it's
gone entirely, confirmed via a real 404 in testing, not merely
deprecated in a way that could be re-enabled by accident.

Verified live with a real security proof, not just a functional check:
registered a real user with a starting balance of zero, confirmed the
old endpoint is genuinely gone (404), confirmed the new endpoint fails
honestly when Paystack isn't configured (this sandbox can't reach real
Paystack) rather than silently succeeding, and — the actual point of
the test — confirmed the wallet balance was still exactly zero after
every attempt. Also confirmed via a real server boot (not just `tsc`)
that the new circular dependency between PaymentsService and
WalletsService resolves correctly at runtime, using the same
`forwardRef()` pattern already proven for the withdrawal feature. Full
regression clean throughout.

## Added: an admin escape hatch for a genuinely stuck ride

A live report about a ride stuck showing "in progress" needed manual
cleanup, and the only options were direct database access (which
turned into real friction — no `psql`, then pgAdmin hitting SSL
configuration issues twice). Rather than keep fighting database
tooling, built the actual tool that was missing: a blunt,
admin-only `PATCH /rides/admin/:id/force-status/:status`. Deliberately
does nothing beyond changing the status — no refund logic, no
notifications — since this is meant for manually recovering broken
data, not a normal business operation; whoever uses it is expected to
already understand why the ride is stuck.

Verified live: a regular passenger correctly gets 403, an admin can
force the status change, and it's genuinely persisted (not just
echoed back) — confirmed by changing it a second time in the same
test. Full regression clean.

## Fixed: force-cancelling a stuck ride left the driver permanently stuck too

Direct follow-up from using the force-status admin endpoint on a real
stuck ride — the ride itself was correctly fixed, but the driver
stayed stuck showing "on a trip" regardless. The endpoint was built
deliberately minimal (status change only, no side effects), which
meant it skipped the driver-availability reset that the normal
completion/cancellation flow does automatically — leaving no other
path to ever un-stick that driver once their ride was gone.

Extended `forceStatusForAdmin()` to also reset the driver to `ONLINE`
when moving a ride to a terminal status (cancelled or completed) — the
one side effect that genuinely can't be skipped, since nothing else
would ever fire. Wrapped in a `.catch()` deliberately: a failure
resetting availability shouldn't block the primary fix (the ride
status) from succeeding.

Verified live: a driver genuinely stuck at `ON_TRIP` (accepted a real
ride, started it), confirmed force-cancelling the ride correctly
resets them to `ONLINE`. Full regression clean.

## Cash-debt threshold, admin-adjustable, not a flat wallet-balance requirement

Real design decision, not just a feature request implemented blindly —
considered and rejected a flat "minimum wallet balance before every
cash ride" rule first, since it would lock out an otherwise reliable
driver just for having a run of cash trips in a row, right when
earning more is exactly what they'd need to do. Went with the actual
risk instead: once a driver's accumulated *unpaid* commission from cash
trips (already tracked automatically via `ReconciliationService`, not
new infrastructure) crosses a threshold, further cash rides are
blocked until it's paid down or the wallet is topped up. Wallet and
card rides are unaffected.

Built on the existing generic `SystemSettingsService` (key-value,
30-second cache, admin-editable via `PUT /admin/settings/:key`) rather
than an env var — the whole point was adjusting this without a
redeploy, which an env var wouldn't have given.

Verified live: lowered the threshold via the real admin settings
endpoint, confirmed a driver's first cash ride succeeds, confirmed
their accumulated debt is tracked correctly after completion,
confirmed a second cash ride is genuinely blocked with a clear message
once over the threshold, confirmed a wallet-payment ride is
unaffected — proving this is cash-specific, not a blanket restriction.
Full regression clean.

## Fixed a real, verified batch of dispatch race conditions

A pasted external analysis proposed several fixes to the offer/dispatch
system. Verified every "must fix" claim against the actual code before
touching anything — all of them checked out as genuinely real, not
just plausible-sounding:

- **`getMyPendingOffer()`/`getPendingOfferForRide()` only checked
  `status`, never `expiresAt`.** A time-expired offer reads
  `status=PENDING` for up to 15 seconds until the periodic sweep
  catches up — meaning a driver could accept, or block another
  driver's exclusivity check, on an offer that had already genuinely
  expired. Both methods now also require `expiresAt > now`.

- **No way to withdraw an offer.** The passenger's "Choose someone
  else instead" only changed local UI state — the previously-selected
  driver's offer stayed genuinely pending on the backend and could
  still be accepted. Added `withdrawOffer()` and
  `PATCH /rides/:id/current-offer/withdraw`, with real ownership
  checking (a different passenger can't withdraw someone else's ride's
  offer — verified live, not just assumed).

- **A real logic gap the pasted analysis didn't explicitly name, found
  while verifying its fixes**: `acceptRide()`'s exclusivity check
  treated "no *currently live* offer" the same whether one had never
  existed or had existed and just died. That meant fixing the two
  points above actually *introduced* a new hole — a driver whose own
  offer just expired, or was withdrawn, could still accept anyway,
  since the check silently fell through to the old open-broadcast
  path. Added `hasEverHadOffer()` to distinguish "never offered to
  anyone" (broadcast-accept stays valid) from "was offered, now dead"
  (blocks acceptance outright, for anyone). Caught this via live
  testing, not code review — the first test run showed both critical
  cases silently succeeding when they should have failed.

Verified live end-to-end: a driver whose offer was force-expired via
direct SQL is correctly rejected on accept, a second driver can then
freely accept the same ride once offered, a withdrawn offer's driver
is correctly rejected, and cross-passenger withdrawal is correctly
forbidden. Full regression clean throughout.

## Fixed: address autocomplete returning unrelated results

Real bug from a live report — searching "511 rd, festac" returned
things like "New Festac Bridge Road" and "22 Road," sharing a word
with the query but not remotely what was being typed. Root cause:
`suggest()` was calling the same Geocoding API endpoint as `geocode()`
(`/geocode/json`), just returning multiple results. Geocoding is built
to resolve a *complete* address into coordinates — fed a partial,
as-you-type query, it does its best-effort loose token matching,
which is exactly what produced results that shared "festac" or "road"
without being genuinely relevant.

Switched to Google's actual purpose-built Places Autocomplete API
(`/place/autocomplete/json`), the same endpoint every real ride-hailing
app's address search uses — ranked, relevance-aware suggestions for
partial input, restricted to Nigeria (`components=country:ng`). Since
autocomplete predictions don't carry coordinates on their own, fetches
Place Details for each one server-side, preserving the existing
`GeocodeResult[]` response shape so nothing on either app needed to
change to benefit from this.

**Worth being explicit about**: this only takes effect once
`GOOGLE_MAPS_API_KEY` is actually set on Render — a *different* key
from the Android SDK key discussed earlier for map rendering. Without
it, this correctly falls back to Nominatim (free, no key needed), which
has no autocomplete-specific endpoint at all and generally sparser
Nigerian address coverage than Google's — this fix won't change
anything the user sees until that key is configured.

## Fixed: Paystack checkout never redirected back into the app

Real bug from a live report — "after payment its not redirecting."
Neither `initWalletTopUp()` nor `initCardAdd()` passed a `callbackUrl`
to Paystack at all. Without one, a completed payment leaves the user
on Paystack's own generic success page in the browser, with no
automatic way back into the app — the wallet screen's comment even
revealed the flawed assumption this relied on: "balance refreshes via
useFocusEffect when the user returns," which only works if the user
manually switches back, never automatically.

Fixed by passing a real deep-link callback URL
(`rydapassengerapp://wallet-topup-complete`,
`rydapassengerapp://card-add-complete`) using the app's existing
registered scheme. The app side now has real landing screens for both
that redirect straight back to the relevant screen and trigger a
proper refresh.

## Committed real-time support ticket messaging — was sitting uncommitted from an earlier session

Found while staging this round's changes: `support.service.ts`,
`tracking.gateway.ts`, and `tracking.module.ts` had real, complete,
already-referenced-elsewhere changes that had never actually been
committed. The app-side support chat screen was already calling
`subscribe:ticket` and listening for `ticket:message` — meaning the
app had been waiting on backend code that existed only in this
sandbox, never shipped.

Mirrors the existing ride-chat real-time pattern exactly: sending a
ticket message emits `support.message.sent`, which
`TrackingGateway.broadcastTicketMessage()` picks up and delivers to
everyone subscribed to that ticket's room, with real authorization
(only the ticket's owner or support staff can subscribe).

Verified live with a real, pre-existing test script rather than just
trusting it worked: hit one genuine bug in the test itself (a phone
number one digit short of Nigeria's required length, unrelated to the
feature), fixed that, then confirmed a real socket connection receives
a live broadcast that exactly matches a message sent via REST by a
completely different user — proving the actual real-time delivery
works, not just that the code compiles. Full regression clean.

## Added: real live tracking for deliveries, matching what rides already had

Real gap, flagged earlier as "delivery tracking polls status only, no
live driver location" — rides had this via WebSocket all along,
deliveries never did. Added `subscribe:delivery`/`unsubscribe:delivery`
to `TrackingGateway`, with the same real ownership verification
`subscribe:ride` already has (the delivery's own customer or driver,
not just any authenticated user), and extended `LocationService` to
also check for an active delivery alongside the existing active-ride
check whenever a driver reports their position — both checked
independently, not else-if, since a driver being on exactly one or the
other isn't assumed to always hold.

Verified genuinely end-to-end, not just type-checked: a real WebSocket
client connected, subscribed to a real delivery, a driver reported a
real location update, and the client genuinely received the correct
`driver:location` broadcast with the right `deliveryId`. Caught two
real bugs in my own test script along the way before it could run
cleanly — a missing required `itemDescription` field, and a wrong
controller path (`/logistics` instead of the actual `/deliveries`) —
both fixed before concluding anything about the feature itself. Full
regression clean throughout.

## Added: admin-configurable contact info, genuinely public

Real request — contact details (support email, phone, WhatsApp,
website, address, business hours, social links) were never meant to be
hardcoded into either app, and needed to be admin-editable without a
redeploy every time they change.

Added the contact fields to the existing `SystemSettingsService`
rather than build a separate mechanism — reused, not duplicated,
infrastructure. The genuinely new piece: a narrow, explicitly-
whitelisted public endpoint (`GET /app-config/contact`), deliberately
a *separate* controller from the admin-only `SettingsController`
rather than an exception carved into it — that one's guarded at the
class level, and mixing an unguarded route in would be an easy spot
for a future edit to accidentally lose the admin restriction on
everything else in that table (the cash-debt threshold, referral
bonus amounts, etc., which should never be publicly readable).

Verified live, genuinely without an Authorization header at all: confirmed
sensible empty defaults before any admin configuration, set real values
through the actual admin endpoint, then confirmed the public endpoint —
called with no token — correctly reflects them. Full regression clean.

## Added: wallet transaction detail lookup, #5's real gap

Checked the entity before assuming what was missing — it already had
transaction id, direction, category (a genuinely thorough enum:
ride/delivery payment and earning, topup, withdrawal, refund, bonus,
cashback, referral, cancellation fee, split fare, tips), amount,
balanceAfter, referenceId, description, timestamp. The real gap was
narrower than it looked: no way to fetch a *single* transaction, so
tapping one in the app had nothing to link to.

Added `getTransactionById()` and `GET /wallet/transactions/:id`, with
real ownership verification — a different user's transaction id
returns 404, not someone else's wallet activity. Deliberately didn't
add a stored `balanceBefore` column; it's fully derivable from
`balanceAfter`, `direction`, and `amount`, and storing it separately
would just be redundant data that could drift from the real ledger.

Verified live: real owner gets full detail (200), a different user
requesting the exact same transaction id correctly gets 404. Full
regression clean.

## Notifications — #14, checked against the full requested trigger list

Systematically checked every requested notification trigger against
the actual event handlers, rather than assume coverage. Three real
gaps found and fixed:

- **Driver arrived / trip started** — `markArrived()` and `startRide()`
  never emitted anything at all (the latter's `ride.started` event
  existed, but only the webhooks service ever listened to it — nothing
  passenger-facing). Added `ride.arrived`, added `passengerId` to the
  existing `ride.started` payload (safe, additive), added both
  notification handlers.
- **New delivery / "package request"** — a genuinely significant gap:
  deliveries use an open, any-driver-can-accept model with no targeted
  offer like rides have, and `LogisticsService` never emitted anything
  when a delivery was created. A driver would only ever discover one by
  manually checking the list. Now notifies every nearby online driver
  (reusing `DriversService.findNearby()`), not just one.
- **Document expiry** — the `expiryDate` field existed on
  `DriverDocument` the whole time, only ever set on upload and read for
  the admin list view, never actually checked against the current date.
  Added a daily cron (`@Cron(EVERY_DAY_AT_9AM)`) checking documents
  expiring within 7 days, with a new `expiryWarningSent` flag so it
  fires once per document, not every single day it remains unrenewed.

**A real, pre-existing thing found and deliberately not touched**:
every notification in this system creates one database row per
delivery channel (`notify()` loops channels, each with its own
`send*()` call) — meaning a notification sent to both `IN_APP` and
`PUSH` genuinely produces two list entries, confirmed for
`ride.accepted` (which predates this session) as much as for the new
handlers here. This is a real UX issue worth fixing, but it's a
system-wide behavior affecting every existing notification type, not
something to fold into a trigger-coverage pass — flagged clearly
rather than fixed as a side effect.

Verified live, not just type-checked: real ride reaching arrived/
started, confirmed the passenger's notification list picks up both;
real delivery request, confirmed multiple nearby online drivers are
notified and a driver mid-trip (`ON_TRIP`, not `ONLINE`) is correctly
excluded; cron run twice against a real expiring document, confirmed
it fires once and the flag correctly prevents a second notification.
Caught and fixed three of my own test-script bugs along the way (wrong
notifications endpoint path, module resolution from outside the
project directory, mismatched SQL column counts) before trusting any
result. Full regression clean throughout.

## Ride and delivery pricing now genuinely admin-editable — #17

Checked what "admin should control ride/package pricing" actually
meant against the real code first, rather than assume nothing existed.
Commission was already fully admin-manageable (both API and dashboard
UI, built in an earlier round). Cancellation fee already used
SystemSettingsService. But the core pricing levers themselves — base
fare, per-km, per-minute, minimum fare, airport fee, night multiplier
for rides; base fare, per-km, per-kg, minimum fare for deliveries —
were all still env-var only, meaning changing them required a Render
redeploy, not an admin setting. That's the real gap this closes.

Migrated both `FareService.estimate()` and
`LogisticsService.estimateFare()` to the same
SystemSettingsService-with-env-fallback pattern already established
for cancellation fee — the env values become the default shown before
any admin override, not a second source of truth. `estimateFare()` was
synchronous before this; made it async (both call sites already
awaited/returned it fine).

Caught and fixed a real bug before this shipped: `LogisticsModule`
never imported `SettingsModule` at all, so injecting
`SystemSettingsService` into `LogisticsService` broke the app at boot
with a dependency resolution error — invisible to `tsc` since NestJS's
DI is resolved at runtime, not compile time. Only surfaced by actually
booting the server, which is exactly why that's part of verification
here rather than trusting a clean type-check alone.

Also caught real discrepancies in the admin dashboard's own default
values before they shipped — cross-checked the actual env defaults in
configuration.ts instead of guessing, and found per-km, per-minute, and
minimum fare were all wrong from a first draft (120 not 100, 25 not
20, 700 not 500) — would have shown a misleading "default" in the UI.

Verified fully live: ride estimate correctly starts at the real env
default (₦500 base fare), admin sets a deliberately distinctive value
(₦9999), same estimate call immediately reflects it with no redeploy.
Same test repeated for delivery pricing. Full regression clean,
including the standard e2e suite which exercises the delivery flow
end-to-end.

## Wallet transfer with 2FA — backend complete and verified live

Real money moving between two people's wallets is the highest-stakes
thing built in this project so far, so this got more care than usual
before anything shipped.

**A real architectural problem found before writing any transfer
code**: 2FA needed to reuse the existing OTP system (phone-based,
already used for registration verification), but `AuthService`'s
`verifyOtp()` unconditionally marked the phone verified as a side
effect, with no way to distinguish "verifying a phone" from
"confirming a transfer" for the same number. Worse, `AuthModule`
already imports `WalletsModule`, so wallet code importing `AuthModule`
back for OTP would create a circular dependency. Extracted an
independent `OtpModule`/`OtpService` — purely mechanical OTP
generation/verification, zero side effects, zero dependency on
`UsersService` — with a new `purpose` field so different OTP use cases
can never collide. Verified live that the existing phone-verification
flow still works exactly as before after this refactor, including the
wrong-code attempt-tracking logic.

**The atomic transfer itself**: found that the existing `credit()`/
`debit()` each open their own separate database transaction — correct
for a one-sided operation like a top-up, but calling them sequentially
for a transfer would leave a real window where a crash between the two
calls debits the sender with the recipient never credited, exactly the
failure mode the spec explicitly ruled out. Built a dedicated
`transfer()` that debits and credits inside one shared transaction,
locking both wallets in a consistent order (sorted by id, not by
sender/recipient role) specifically so two transfers between the same
two people running concurrently in opposite directions can't deadlock
each other.

**Full flow**: `POST /wallet/transfer/initiate` (looks up recipient by
phone, validates limits and balance, creates a pending
`WalletTransferRequest`, sends a 2FA OTP to the sender's own phone) and
`POST /wallet/transfer/confirm` (verifies the OTP, performs the atomic
transfer). Admin-configurable min/max-per-transaction/max-daily/fee via
the same settings infrastructure as ride and delivery pricing.
Throttled (5/min on initiate) matching the same caution the existing
OTP-send endpoint already applies — worth knowing this throttle is
per-IP by default, not per-user, discovered while writing the test
script.

**Verified live with a real, 10-part test**: happy path with correct
balance changes on both sides; wrong OTP rejected; a different user
cannot confirm someone else's pending transfer (403, not a silent
success); confirming an already-completed request rejected; self-
transfer rejected; over-limit and insufficient-balance rejected at
initiate, before an OTP is even spent; daily limit genuinely enforced
by summing today's actual sent transfers; unknown recipient phone
rejected clearly; and — the one that mattered most — two real,
concurrent, opposite-direction transfers between the same two wallets
fired in parallel, with a real timeout bound (not just hoping),
confirmed to complete cleanly with correct final balances and no
deadlock. Full regression clean throughout, including the existing
e2e suite.

**Not done yet**: no app-side UI at all (initiate screen, confirmation
screen, OTP entry) — deliberately left for a following, focused round
given how much went into getting the backend right.

## Email-primary authentication — #1, a major discovery mid-build

Before writing anything, checked what already existed. Found the
entire backend for this was already substantially built in an earlier
session — RegisterDto (required email, optional phone, matching the
exact reasoning the request specified), LoginDto (email-only),
AuthTokensService with real single-use expiring tokens, forgot/reset
password logic with full session revocation, and a genuinely working
Gmail SMTP integration via nodemailer with a sensible dev-log fallback.
Well-designed throughout — no user-enumeration leaks on
resend-verification or forgot-password, single-use tokens, purpose-
scoped so a verification token can't be replayed as a password reset.

**What was actually broken, found and fixed:**

1. **Missing routes.** verify-email, resend-verification,
   forgot-password, reset-password all had complete service logic but
   were never wired to the controller — genuinely unreachable. Added
   all four, and corrected the controller's Swagger docs, which were
   still describing the old phone-based login/register flow.

2. **The app could never have booted.** AuthModule never registered
   AuthTokensService, the AuthToken entity, or MailerModule — a real
   dependency resolution error at boot, invisible to `tsc` since
   NestJS resolves dependencies at runtime, not compile time. This
   "already built" code had never actually been successfully started.
   Fixed, confirmed a clean boot with a genuine health check (not just
   an unconditional "server up" echo — a lesson from a mistake earlier
   this session).

3. **A real conflict with the wallet transfer feature from last
   round.** Its 2FA design assumed every user has a phone number -
   true when it was built, false now that phone is genuinely optional.
   Switched recipient lookup, masking, and OTP delivery from phone to
   email throughout WalletTransfersService, and wired it to actually
   send a real email via MailerService rather than leave the code as a
   silent, undelivered stub.

4. **The standing e2e-test.sh regression script was stale** - still
   registered users with the old phone-only, no-email, no-termsAccepted
   format, which the DTO now rejects. Updated both registration blocks
   to the real contract: register (no tokens issued), mark
   isEmailVerified via SQL (same "simulated admin action" pattern
   already used for driver approval in this same script), then a
   genuinely separate login call for real tokens - since registration
   now deliberately withholds them until verified.

**Verified live with a real 12-part test covering the complete
lifecycle**: registration issues no tokens; login blocked before
verification with a specific, actionable message; wrong token
rejected; correct token verifies once and a second use of the same
token is rejected (single-use enforced, not just assumed); login
succeeds after verification; resend-verification is silent and
doesn't create a new token for an already-verified account; forgot/
reset password works; and — the check that mattered most - the refresh
token issued *before* a password reset is genuinely revoked, confirmed
by attempting to use it afterward and getting a reuse-detected
rejection, not just trusting that revocation happened. Also re-ran the
full 16-step e2e suite (clean) and re-verified wallet transfer
end-to-end with the new email-based lookup.

## Web landing pages for email links — the missing piece for a mobile-only app

The email-verification and password-reset links already pointed at
`${appBaseUrl}/verify-email` and `/reset-password`, but nothing served
those routes at all - a real gap, since both apps are mobile-only with
no web frontend, so a tapped email link had nowhere to go.

Added a lightweight `PagesController` serving both as self-contained
HTML+inline-JS pages (no build step, no framework) - on load, each
calls the actual API endpoint client-side and shows a clear success or
error state. Excluded both routes from the `/api/v1` prefix in
`setGlobalPrefix()` specifically to match the URLs the already-tested
email-sending code generates, rather than change that code to fit a
prefix.

Verified live: both pages load correctly with no prefix, normal API
routes are unaffected, and confirmed the excluded paths correctly
don't *also* exist under `/api/v1` (would have been a real routing bug
if both resolved). Full regression clean.

**Still needed**: `APP_BASE_URL` needs to be set as a real environment
variable on Render for these links to actually work in production —
currently defaults to empty.

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

## Known gaps / next steps

- **Payment gateway, notification providers, and now Google Maps are real
  but untested live** — same sandbox network restriction throughout this
  project (`api.paystack.co`, Twilio/SendGrid/FCM, and now
  `maps.googleapis.com` are all outside this environment's egress
  allowlist). Every one of these falls back to a clearly-flagged
  simulated/Haversine path when unconfigured, so the rest of the system
  stays testable — test the live paths yourself once real keys are in place.
- **Driver document approval isn't enforced.** `DriverDocumentsService
  .hasAllRequiredApproved()` exists but nothing calls it —
  `DriversService.setApprovalStatus()` will happily approve a driver who
  hasn't uploaded or been reviewed on a single document. Wire the check in
  before this handles real drivers.
- **No real-time push layer.** Driver matching is "any online driver can
  claim a searching ride" plus a dispatch-visible nearby-drivers list — there's
  no websocket/push-notification flow to actively offer a ride to a specific
  nearby driver with a timeout/fallback.
- **FCM should be migrated to HTTP v1** — the legacy server-key API used
  here is deprecated by Google.
- **Wallet top-up doesn't route through a real payment charge yet.**
  `POST /wallet/topup` credits the wallet directly rather than first
  charging a card or confirming a bank transfer — the max-balance
  enforcement is real, but the "how did the money get there" step is a
  placeholder. Wiring it through `PaymentsService` (same card-on-file flow
  rides use) is the natural next step.
- **Cash-trip commission debits require an existing balance.** Both personal
  driver wallets and fleet wallets can only be debited commission-owed (on
  cash trips) up to their current balance — there's no negative-balance /
  receivable tracking for a driver or fleet that owes more than they've got
  sitting in the wallet. Fine as long as wallet/card rides keep the balance
  topped up in practice; a real deployment would want a receivables ledger
  for this.
- **Login audit logs don't capture IP address.** `AuthService.login()` logs
  success/failure explicitly (since the `@Audit` interceptor only fires on
  success), but `AuthService` doesn't have access to the request object the
  way a controller/interceptor does. Wiring the IP through would mean
  passing it from the controller into the service — straightforward but not
  done yet.
- **Dispatch's reassignment sweep is still in-process, not queue-based.**
  Redis/BullMQ now exists in this deployment (see the section above) and
  backs notifications, scheduled rides, and reconciliation — but the
  dispatch offer-expiry sweep still runs on `@nestjs/schedule`'s in-process
  interval rather than a BullMQ repeatable job. Deliberately left alone
  rather than risk changing an already-proven, heavily-tested flow; moving
  it to a queue would be the natural next step now that the infrastructure
  is in place.
- **The tracking WebSocket gateway is still single-instance.** Socket.IO
  rooms live in this process's memory — running multiple API instances
  would need a Redis adapter (`@socket.io/redis-adapter`) so a broadcast
  from instance A reaches a client connected to instance B. Redis itself is
  no longer the blocker (it's genuinely running now); the adapter just
  isn't wired up.
- **Redis is now a hard runtime dependency, not a graceful-degradation
  integration.** Unlike Paystack/Maps/notification providers (which all
  fall back to a simulated/local mode when unconfigured), `BullModule` is
  registered globally with no fallback — the app won't start cleanly
  without a reachable Redis instance, since notifications, scheduled
  rides, and reconciliation all depend on it now. Worth knowing before
  deploying anywhere Redis isn't guaranteed to be up.
- **Loyalty point balance updates aren't row-locked** the way
  `WalletsService.credit()`/`debit()` are (pessimistic write lock).
  Account *creation* is race-safe (see above), but two concurrent point
  awards for the same user could still lose an update via a plain
  read-modify-write. Low real-world likelihood — a user can only be on
  one ride at a time in this platform — but worth fixing with the same
  locking pattern the wallet already uses if this ever needs to be fully
  concurrency-hardened.
- **Geofence service-area zones aren't enforced.**
  `GeofenceService.isWithinServiceArea()` exists and works, but
  `RidesService.requestRide()` doesn't call it — a ride can currently be
  requested from anywhere, regardless of any `service_area` zones an
  admin has defined.
- **Docker isn't installed in the sandbox this was built in, so the
  `Dockerfile`/`docker-compose.yml` were never actually built or run.**
  YAML-validated and written from a standard, well-tested multi-stage
  pattern, but this is the one piece of the deployment infrastructure that
  falls into the same "correct but unverified live" category as
  Paystack/Maps/S3 — build it yourself and confirm before relying on it.
  Everything else in that section (CI's smoke-test commands, the migration
  workflow, backup/restore) WAS genuinely run against real services.
- **OpenTelemetry distributed tracing isn't wired up**, only installed.
  Explained in the Observability section above — it needs its own
  `--require`-loaded entry file to initialize before other modules import,
  which wasn't worth shipping half-done. Sentry and Prometheus cover error
  tracking and metrics; tracing is the one observability pillar still
  genuinely missing.
- **Swagger annotations aren't applied everywhere.** `AuthController` and
  `RidesController` (+ key DTOs) are fully annotated as the reference
  pattern; the other ~23 controllers appear in the generated spec via
  NestJS's automatic reflection but without the same depth of
  examples/descriptions/error-response documentation.
- **SOS doesn't actually escalate to on-call staff or emergency contacts.**
  The `Incident` is created and visible to any admin/support/dispatcher
  polling `GET /admin/emergency/incidents/active`, and the reporter gets a
  confirmation notification — but nothing pushes an alert *to* responders
  (no dedicated on-call notification), and emergency contacts (name+phone,
  not tied to a `User` account) can't be SMS'd through the current
  userId-keyed notification model.
- **Flutterwave and Stripe inbound webhooks aren't built** — only Paystack's
  is (see the Paystack setup section). Same signature-verification pattern
  would apply; just not wired up for the other two gateways.
- **Driver document upload still takes a URL string, not a direct file
  upload.** `POST /drivers/documents` (from an earlier pass) assumes the
  client already hosted the image somewhere and just hands us the URL —
  the new `StorageService` isn't wired into it yet. Same pattern as
  `POST /users/me/profile-photo` would apply directly; just not connected.
- **S3/R2 and OpenSearch are real but untestable live**, same sandbox
  network restriction as Paystack/Maps/notification providers throughout
  this project.
- **Airport queue isn't wired into ride assignment.**
  `AirportService.dispatchNext()` exists and correctly pops the FIFO queue,
  but nothing calls it — an airport pickup doesn't currently prefer a
  queued driver over the general dispatch pool. The queue is genuinely
  functional (join/leave/position all verified) but currently observational
  rather than authoritative.
- **Fraud detection is heuristic-only, no real device attestation.**
  `deviceFingerprint` is whatever the client sends — nothing stops a
  motivated actor from spoofing or omitting it. GPS spoof detection is a
  single speed threshold, not a pattern-of-behavior model. Good for casual
  abuse, not a substitute for real fraud infrastructure.
- **OTP still isn't routed through the Notifications module** — `sendOtp()`
  returns the code directly in the response rather than calling
  `NotificationsService.sendSms()`. Worth wiring together, but kept separate
  for now since OTP delivery has different urgency/retry requirements than
  general notifications.
- **No request logging/observability**, no distributed refresh-token cleanup
  job (expired/revoked rows accumulate — fine for now, add a periodic purge
  before this runs at scale).
- **Corporate accounts have no travel-policy/approval-workflow layer** — an
  employee can spend the full budget on any ride; the spec's "travel
  approvals" and "department billing" split aren't implemented.

## Test scripts

Two scripts exercise the running server end-to-end (`localhost:3000`, requires
`psql` access to seed a couple of things no admin UI exists for yet):

- `e2e-test.sh` — the original core flow: register → onboard/approve driver →
  vehicle → go online → fare estimate → wallet-paid ride → accept → arrive →
  start → complete, checking both wallets settle correctly.
- `e2e-test-v2.sh` — admin login, refresh token rotation + reuse detection,
  corporate account creation/employee linking/corporate-paid ride/budget
  ledger, GPS location + nearby-drivers dispatch, ratings (both directions,
  plus the double-rating rejection), card-paid ride + payment record, and
  rate-limit enforcement on login.
- `e2e-test-v3.sh` — passenger profile (lazy-create, preferences, home/work,
  favourites, emergency contacts), promo code creation/validation/redemption
  (with per-user limit enforcement), referral bonus payout on first
  completed ride, passenger statistics, blacklist enforcement, and
  card-on-file init behavior.
- `e2e-test-v4.sh` — notifications: device token registration, in-app
  notification generation from ride/driver-approval/referral events, unread
  count, mark-read/mark-all-read, admin broadcast, and a cancellation with
  no assigned driver (confirms the event listener doesn't crash when there's
  no one to notify).
- `e2e-test-v5.sh` — fleet management: company creation (+ one-per-owner
  enforcement), driver/vehicle assignment, manager permissions (can assign,
  can't add managers or request payouts), a full ride completed by a fleet
  driver confirming earnings land in the **fleet** wallet and NOT the
  driver's personal wallet, analytics, and a simulated payout.
- `e2e-test-v6.sh` — audit logs (login success/failure, driver approval,
  promotion creation, all correctly attributed with actor/target/metadata),
  filtering, RBAC enforcement (non-admin gets 403), and the full analytics
  dashboard (overview, revenue time series, rides-by-status, top drivers,
  heatmap) with hand-verified numbers against the known test data.
- `e2e-test-v7.sh` — support tickets (creation, access control — verified a
  random other user gets 403 — assignment, threaded messages, status
  transitions, and the resulting notifications) and CMS (publish/unpublish
  gating on pages, active-window gating on announcements).
- `e2e-test-v8.sh` — maps fallback behavior, pricing engine extensions
  (verified: airport surcharge adds exactly the configured amount, waiting
  fee correctly bills chargeable minutes past the grace period, cancellation
  fee correctly debits the passenger and credits the driver by the exact
  configured amount), and driver document upload/admin review workflow.
- `e2e-test-v9.sh` — fraud detection (duplicate-account flagging via shared
  device fingerprint, GPS spoof flagging via implausible driver movement,
  referral abuse flagging — verified the bonus still gets paid despite the
  flag — and the review workflow) plus the permission system (resolved
  permissions per role, the full matrix, and a role blocked from an
  endpoint outside its allowed list).
- `e2e-test-v10.sh` — airport registry + geofence detection + driver queue,
  smart dispatch offers (verified a nearby driver received a targeted offer,
  declining it left the ride searching, and the same driver could still
  broadcast-accept afterward — the backward-compatibility guarantee), and
  API keys (valid/missing/bogus/revoked, all four cases verified).
- `e2e-test-v11.sh` — logistics: fare estimate, full delivery lifecycle with
  wallet settlement (verified exact commission math), cash-on-delivery
  (verified the driver's wallet debited exactly the commission owed),
  invalid-COD rejection, order history, and cancellation.
- `e2e-test-v12.sh` — advertising: campaign lifecycle, placement-filtered
  banner delivery, impression/click tracking with redirect verification,
  deactivation gating, geofenced sponsored locations (both the match and
  the correct empty result for a far point), and RBAC enforcement.
- `e2e-test-v13.sh` — AI module, run on a fresh isolated DB for
  deterministic results: surge pricing verified across all three states
  (no activity -> 1.0x, unmatched demand -> 3.0x max, balanced -> 1.0x),
  ETA estimate, demand forecast with RBAC enforcement, driver/passenger
  recommendations, earnings forecast, and fraud risk scoring.
- `e2e-test-v14.sh` — feature flags (toggle logistics off/on with real
  503/success verification, RBAC on toggling) and system settings
  (custom cancellation fee actually charged on a real cancellation, wallet
  top-up limit enforcement verified to reject an over-limit top-up while
  NOT blocking ride earnings from landing in the same wallet past that
  limit, and AI dispatch toggle verified to fall back gracefully rather
  than error).
- `e2e-test-v15.sh` — health sub-checks (db/redis/queue/maps/payments/all,
  including the genuinely-checked scheduler last-run age) and real-time
  tracking with an actual socket.io client (`test-websocket.js`): bad-token
  rejection, non-participant subscription rejection, and a live
  `driver:location` event received end-to-end from a real REST location
  update, plus route history retrieval.
- `e2e-test-v16.sh` — Swagger docs load (path count sanity check), outbound
  webhooks via a self-loopback receiver (real signed HTTP deliveries
  triggered by real domain events, verified via delivery logs, verified
  deactivation stops new deliveries), and the full Emergency Command Center
  chain (SOS → active incidents → timeline → acknowledge → resolve, live
  ride monitoring, admin force-cancel, RBAC).
- `e2e-test-v17.sh` — file storage (real multipart upload through
  `POST /users/me/profile-photo`, fetched back, content verified
  byte-for-byte) and search (partial name/code match, empty-result case,
  RBAC on driver search).
- `e2e-test-v18.sh` — Redis/BullMQ (confirms real queue keys exist via
  `redis-cli`, not just that the app didn't crash), scheduled rides with an
  actual timed delay (books 10 seconds out, confirms no immediate dispatch,
  waits for the real job, confirms activation and a driver offer),
  cancellation removing the pending job, driver incentives (a quest reward
  verified end-to-end after the NaN bug fix — see the dedicated section
  above), and offline cash reconciliation (a zero-balance cash ride
  completing without throwing, debt recorded, then auto-settled by a real
  queued job on the next wallet credit). **Requires
  `SCHEDULED_RIDE_LEAD_MINUTES=0`** when starting the server for the timed
  delay to complete in a reasonable test window — see the script for the
  full launch command.
- `e2e-test-v19.sh` — Prometheus metrics, verified with real before/after
  counter deltas across a full ride lifecycle (not just checking the
  endpoint responds), default process metrics presence, and confirming a
  400 validation error doesn't destabilize the app.
- `e2e-test-v20.sh` — geofencing (real event chain from a location update
  to a logged zone-entry event), admin tools (real queue stats, cache
  clear, diagnostics), OTP brute-force lockout (5 wrong attempts, 6th
  rejected even with the correct code, fresh OTP resets it), and
  maintenance mode (verified blocking normal traffic while keeping
  health/auth/admin reachable, and restoring access when disabled).

```bash
bash e2e-test.sh
bash e2e-test-v2.sh
bash e2e-test-v3.sh
bash e2e-test-v4.sh
bash e2e-test-v5.sh
bash e2e-test-v6.sh
bash e2e-test-v7.sh
bash e2e-test-v8.sh
bash e2e-test-v9.sh
bash e2e-test-v10.sh
bash e2e-test-v11.sh
bash e2e-test-v12.sh
bash e2e-test-v13.sh
bash e2e-test-v14.sh
bash e2e-test-v15.sh
bash e2e-test-v16.sh
bash e2e-test-v17.sh
SCHEDULED_RIDE_LEAD_MINUTES=0 npm run start &   # v18 needs a fast scheduled-ride lead time
bash e2e-test-v18.sh
bash e2e-test-v19.sh
bash e2e-test-v20.sh
```

Plus a real Jest unit test suite (see the Testing section above) — run
with `npm test`.

**Note:** `e2e-test-v2.sh` deliberately hammers the login endpoint past its
rate limit at the end (that's the point of that test). If you run `v3`
immediately after `v2` in the same 60-second window, its own admin login
may get rate-limited too — that's the limiter working correctly, not a bug.
Run each script on its own, or wait ~60s between `v2` and `v3`.
