# Working application — Phase 7

Catalog, accounts, date-based availability, reservations, simulated payments and loyalty activity use MySQL. Customers can register, sign in/out, edit their profile, create/cancel bookings, simulate payment, complete eligible rentals and view their own payment/points history. Guests can check rental dates and see available alternatives before signing in. Administrators manage vehicles, reservation statuses, customer contact details and simulated refunds through a protected dashboard. All payments are simulated, with no card collection or real charges. Car images are local, illustrative SVG drawings. Project notes are maintained in this README; docs/ is not used.

The interface, accessibility labels, API messages and documentation are in English. Prices use English number formatting; the currency remains TRY.

English-language update verified on 2026-11-03: server tests (3/3), client build and Edge browser scenarios (2/2) passed. Browser checks include the English document language, heading, filters, detail view, empty/error states and mobile layout. Docker services were rebuilt with the translated application.

## Setup and startup

Requires Node.js 24, npm and Docker Desktop with Linux containers. For a new checkout:

```powershell
Copy-Item .env.example .env
# Replace the example database passwords in .env.
docker compose up --build -d --wait
docker compose exec -T server npm run db:seed
```

Do not overwrite an existing local .env file. Application: http://localhost:5173; API: http://localhost:3000/api/health; MySQL: 127.0.0.1:3307. Ports are configurable through .env. Check status with `docker compose ps`, view logs with `docker compose logs --tail 50`, and stop services with `docker compose stop`. Apply code changes to containers with `docker compose up --build -d --wait`.

Data is stored in the mysql_data volume. `down -v` deletes data and must not be used for updates. Migrations run automatically when the server starts; seeding requires an explicit command. Dependency versions are pinned in package.json and lockfiles.

### Schema and seed data

`database/migrations/002-cars.sql` creates the cars table: unique vehicle_code, brand/model/category, seats/transmission/fuel, DECIMAL(12,2) daily price, image path, and active/maintenance/inactive status. Prices cannot be negative; seats must be between 1 and 20. There is no global available field. Users/sessions are introduced in 003/004 and the reservation interval foundation in 005; payments remain a later phase.

The existing schema_version bootstrap table is preserved. The schema_migrations table tracks new migrations by filename and SHA-256 checksum. A lock serializes concurrent migration runs. Line endings are normalized; changing an applied file causes an error. Since MySQL DDL auto-commits, each migration must contain one restart-safe SQL statement. Future changes use new files; there is no automatic rollback or volume reset.

`database/seed.sql` adds 12 fictional vehicles: 10 active, 1 under maintenance and 1 inactive. Running it again neither duplicates records nor overwrites existing prices/statuses. The catalog lists only active vehicles; maintenance details remain accessible with a maintenance label; inactive details return 404. Seeding requires NODE_ENV=development or test. Demo prices are not market data.

```powershell
docker compose exec -T server npm run db:migrate
docker compose exec -T server npm run db:seed
```

### Local development

```powershell
npm ci --prefix client
npm ci --prefix server
docker compose up -d db
docker compose stop client server
$env:NODE_ENV='development'
npm run db:migrate --prefix server
npm run db:seed --prefix server
npm run dev --prefix server
# In a separate terminal:
npm run dev --prefix client
```

The server reads the root .env file. Local Vite forwards /api requests to localhost:3000; Docker Vite forwards them to server:3000, and the Docker API connects to db:3306. If SERVER_PORT changes, set API_PROXY_TARGET in the client terminal. Set the local client port with `npm run dev --prefix client -- --port PORT`.

### Catalog API contract

- `GET /api/cars`: `{ items, page, pageSize, total }`. Defaults: page=1 and pageSize=12; maximum pageSize=100. Returns active cars.
- Filters: search (brand/model, up to 100 characters, literal substring matching), category (economy/sedan/suv/van/premium), transmission (manual/automatic), fuelType (petrol/diesel/hybrid/electric), minSeats (1–20), minPrice/maxPrice (nonnegative TRY amounts with up to two decimal places).
- sort: name (default), priceAsc or priceDesc; ID breaks ties for stable ordering. Filters combine with AND; an out-of-range page returns an empty items array. SQL values are parameterized; sort fields come from a fixed allowlist.
- `GET /api/cars/:id`: id, brand, model, category, seats, transmission, fuelType, dailyPrice, currency, imageUrl and status. dailyPrice is a decimal string; currency is TRY.
- Malformed IDs/filters, repeated parameters and unknown parameters return 400; missing/inactive cars return 404; unexpected errors return 500. Error format: `{ error: { code, message } }`; database details are not exposed.

Example: `/api/cars?category=suv&transmission=automatic&minSeats=7&sort=priceAsc`. The interface uses `#/` and `#/cars/:id`. Detail pages support reloads. Filter forms, loading/error/empty states and retry controls are provided. A list price is not a booking quote or availability guarantee.

### Tests and acceptance record

```powershell
npm test --prefix server
npm run build --prefix client
docker compose --profile test run --build --rm test
npm run test:e2e --prefix client
docker compose --profile test stop test-db
```

Integration tests run against a separate smartrent_test database on temporary tmpfs storage, without exposing a port. Development data is not deleted. Cleanup is allowed only with this database name and NODE_ENV=test. Tests cover repeated migrations/seeding, database price changes, combined filters, sorting/pagination, SQL-like input, ID/input validation, maintenance/inactive behavior, database constraints, checksums and the production seeding guard.

Browser tests use installed Microsoft Edge and a running Compose application with demo data. Set E2E_BASE_URL to use a different URL. They cover filters/details/reloads, mobile overflow, empty results, delayed loading, simulated API failure and retry. Tests do not modify car records; they expect 10 active demo cars. Test output is excluded from Git.

Phase 2 acceptance results on 2026-11-03:

- `npm test --prefix server`: 3/3 passed.
- `npm run build --prefix client`: passed.
- `docker compose config --quiet` and `docker compose up --build -d --wait`: passed; application services healthy.
- `docker compose exec -T server npm run db:seed`: passed; existing volume preserved and 12 vehicles added.
- `docker compose --profile test run --build --rm test`: 10/10 passed against real MySQL; repeated migrations/seeding and live database prices verified.
- `npm run test:e2e --prefix client`: 2/2 passed in Edge. An initial filter-label matching failure was resolved with explicit label/id associations.
- Desktop screenshot reviewed; browser tests confirmed no horizontal overflow at a 390 px mobile viewport.
- `git diff --check`: passed. .env and test output remain excluded from Git; docs/ was not recreated.

At the start of Phase 2, all three Phase 1 services were healthy and the real database health check returned 200. The Phase 2 results above are historical; later acceptance results are recorded below. Known limitations: illustrative images, the Vite development server, simulated payments and the final Phase 8 quality/demo audit still pending.

### Phase 3 — Accounts and role security

Account pages: `#/register`, `#/login`, `#/account` and `#/admin`. The React auth context restores the session after reload, handles session-check errors with retry, and clears expired authentication. The navbar offers sign in/out and account links; the admin link appears only for administrators. Page guards provide helpful sign-in/access-denied states; the API independently enforces authorization.

New, additive migrations `003-users.sql` and `004-sessions.sql` create users and persistent sessions without changing existing vehicle data. Emails are trimmed, lowercased, ASCII and unique in MySQL. Profile fields are full name (1–100 characters), email (up to 254), and optional phone (up to 30). Passwords are 12–128 characters, stored as salted scrypt digests (N=32768, r=8, p=3; random 16-byte salt). Neither password hashes nor session digests are returned by account APIs. Registration always creates a customer; extra fields such as role/id/password in profile updates are rejected.

Sessions use random 32-byte tokens with an absolute eight-hour expiry. MySQL stores only SHA-256 token digests; the raw token is carried in an HttpOnly, SameSite=Strict, host-only cookie scoped to `/api`. Production adds Secure and requires HTTPS. Login/registration rotate the browser's previous session; logout deletes the database session and clears the cookie. Expired sessions are rejected on every request and cleaned up on login/registration. Multiple browser sessions are allowed. Roles are read from MySQL on every authenticated request, so role changes apply immediately.

All account writes require JSON, an allowed exact Origin, and `X-Requested-With: SmartRent`. CLIENT_ORIGIN defines the frontend origin. In development/test, a configured localhost or 127.0.0.1 origin also permits the other loopback hostname with the same scheme and port, so both http://localhost:5173 and http://127.0.0.1:5173 work. CORS and write protection share this same allowlist; other hosts, schemes and ports remain blocked. Production permits only the explicitly configured origin. This custom-header plus Origin policy protects login and authenticated writes against CSRF; the Axios client supplies the header and credentials automatically. API tools must send these headers too. Cookies remain host-only, so switching between localhost and 127.0.0.1 requires signing in again. Account responses use Cache-Control: no-store. Login and registration share a bounded per-IP limit of 30 attempts per 15 minutes per API process; it resets on restart and is not a distributed production limiter.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | `/api/auth/register` | email, password, fullName, optional phone; returns 201 `{ user }` and session cookie |
| POST | `/api/auth/login` | email/password; returns `{ user }` and a new session cookie |
| POST | `/api/auth/logout` | empty JSON object; revokes cookie session, returns 204; safe to repeat |
| GET | `/api/me` | current user's public profile; 401 without a valid session |
| PATCH | `/api/me` | partial email/fullName/phone update, scoped exclusively to authenticated user |
| GET | `/api/admin/access` | current administrator profile; 401 anonymous, 403 customer |

Validation errors return 400, duplicate email 409, invalid credentials/session 401, disallowed origin/role 403 and throttled authentication 429, using the existing `{ error: { code, message } }` format. There is no private user lookup by caller-supplied ID in this phase.

Create a development administrator explicitly (no built-in admin account or password):

```powershell
# Run migrations/start services first. Choose a fresh email and a password of at least 12 characters.
$env:ADMIN_SEED_EMAIL='admin@example.test'
$adminPassword = Read-Host 'Development admin password' -AsSecureString
$env:ADMIN_SEED_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
try {
  docker compose exec -T -e ADMIN_SEED_EMAIL -e ADMIN_SEED_PASSWORD server npm run db:seed-admin
} finally {
  Remove-Item Env:ADMIN_SEED_EMAIL, Env:ADMIN_SEED_PASSWORD
  $adminPassword = $null
}
```

The command requires NODE_ENV=development or test, hashes the supplied password and inserts a new admin. Existing emails cause an error without promotion or password replacement. It is disabled in production. Admin CRUD remains Phase 7. Password reset, email verification, password changes and deployment hardening are not included in Phase 3.

Security references: [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Phase 3 acceptance on 2026-11-04:

- `npm test --prefix server`: 3/3 passed.
- `npm run build --prefix client`: passed.
- `docker compose up --build -d --wait`: passed; additive migrations applied and application services healthy.
- `docker compose --profile test run --build --rm test`: 21/21 passed against isolated real MySQL. Includes registration, concurrent duplicate emails, hashing, profile isolation, role escalation rejection, admin access, invalid credentials, session rotation/expiry/logout, persistent sessions across API instances, CSRF rejection, development admin seeding, production seed guard, rate limiting and existing catalog checks.
- `npm run test:e2e --prefix client`: 4/4 passed in Edge. Covers signup, profile edit/reload, incorrect/correct login, logout, duplicate email, customer admin denial, session-check failure/retry and the existing catalog scenarios. Browser acceptance creates unique `e2e-...@example.test` customer records in the selected application database; it does not modify existing accounts or vehicles.
- Desktop/mobile account screenshots reviewed; 390 px mobile layout has no horizontal overflow. Screenshots are under ignored `client/test-results/`.
- Initial sandboxed local test/build attempts failed with spawn EPERM; the same checks passed with execution permission. Test results above reflect the successful runs.

Phase 3 was completed before the Phase 4 work recorded below. The application runs at http://localhost:5173.

### Phase 4 — Date-based availability and alternatives

Open any car detail page, choose pickup/return dates and select Check dates. The public API reads actual reservation intervals from MySQL; availability is never stored as a global car flag. Date changes cancel pending requests and clear previous results. When a car is unavailable, the page displays up to six available alternatives with their category, daily price difference, seat difference and transmission match. Following an alternative carries the selected dates in the hash URL and rechecks them, including after reload. Empty recommendations are displayed honestly without fallback vehicles.

Dates are calendar days in Europe/Istanbul. The accepted format is strict YYYY-MM-DD with real calendar dates, pickup no earlier than today's Istanbul date and return strictly after pickup. Pickup is inclusive and return is exclusive: an existing reservation overlaps exactly when `existing.start_date < requested.endDate AND existing.end_date > requested.startDate`. Therefore a reservation ending on the next pickup day does not block it. No maximum rental duration is imposed in this phase; dates must fit the MySQL DATE range. These are date-only rentals, without pickup/return times.

Migration `005-reservations.sql` adds the interval foundation: user/car foreign keys, start/end DATE columns, a database check requiring start < end, status and an overlap index. Pending and confirmed reservations block availability; cancelled and completed reservations do not. Pending records intentionally block without automatic expiry. Maintenance vehicles are always unavailable; inactive/missing vehicles return 404. This migration preserves existing accounts, sessions, cars and prices. Development seed data adds no reservations, so active demo vehicles are available until real records exist; overlap fixtures are confined to the isolated integration database.

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/cars/:id/availability?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | `{ carId, startDate, endDate, available, reason }`; reason is null, reserved or maintenance |
| GET | `/api/cars/alternatives?carId=ID&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | `{ carId, startDate, endDate, ranking, items }`; up to six car summaries with match metadata |

Both endpoints are public, parameterized and return Cache-Control: no-store. Missing/invalid dates or IDs, repeated parameters and unknown keys return 400. Missing/inactive source cars return 404. Private reservation/user identifiers and customer details are never returned.

Alternative selection excludes the source, maintenance/inactive cars and all cars overlapping the exact requested interval. Ranking is lexicographic: same category first, then absolute daily price difference (SQL DECIMAL, returned as a two-decimal string), absolute seat difference, same transmission, and car ID as a deterministic tie-breaker. Category preference takes precedence over a closer price in another category. Seat count is a proximity preference, not a minimum-capacity filter. Fuel is displayed but does not affect ranking. The source may itself be available; the alternatives endpoint still lists other eligible vehicles.

Phase 4 introduced read-only availability checks. It created no bookings, holds or payment records and did not guarantee that a vehicle remained available after a check. The subsequent Phase 5 implementation below adds authenticated booking creation, pricing and cancellation; availability checks themselves remain advisory.

Phase 4 acceptance on 2026-11-04:

- `npm test --prefix server`: 6/6 passed, including leap dates, strict date validation and the Istanbul midnight boundary.
- `npm run build --prefix client`: passed.
- `docker compose --profile test run --build --rm test`: 30/30 passed against isolated real MySQL. Nine new integration cases cover every overlap shape, adjacent intervals, blocking statuses, inactive/maintenance behavior, strict API input checks, private-data exclusion, deterministic ranking, exact-range eligible alternatives, empty recommendations and database constraints. Existing account/catalog tests also pass.
- `npm run test:e2e --prefix client`: 7/7 passed in Edge. Real availability and alternative API calls, date validation, date preservation across navigation/reload, loading/error/retry, clearing stale results and mobile layout are covered. Reserved/maintenance and empty-result UI states are simulated in the browser to avoid inserting development bookings; actual database overlaps and status behavior are verified by the integration suite.
- Desktop/mobile alternative screenshots reviewed under ignored `client/test-results/`; 390 px layout has no horizontal overflow.
- The first integration run found an excessively long decimal scale in daily price differences (29/30 passed). Explicit SQL DECIMAL casts corrected it; the complete rerun passed 30/30.
- `docker compose up --build -d --wait`: passed; database, API and client healthy. `git diff --check`: passed. Existing development data was preserved.

Phase 4 was completed before the Phase 5 implementation below.

### Phase 5 — Reservations, pricing and concurrency safety

After checking dates on a car detail page, review the server-calculated daily rate, rental-day count and total, then select Create reservation. Guests are sent through sign-in/signup and returned to the same car/dates. A successful reservation displays its reference and pending status. My bookings (`#/bookings`) lists the signed-in user's reservations, prices and statuses with pagination, reload support, empty/error/retry states and cancellation confirmation. Date inputs are disabled while creating a reservation to avoid mixing a submitted interval with edited dates.

Rental days use the existing end-exclusive Istanbul calendar policy. The total is the locked current daily rate multiplied by calendar days; no extra fees, discounts or payments are applied. The server uses integer cents (BigInt), stores decimal strings and formats even large totals without floating-point rounding. The UI sends the reviewed daily rate as expectedDailyPrice; if the rate changed, the API returns 409 PRICE_CHANGED with a fresh quote and requires the customer to review it before submitting again. Expected price is only a comparison, never the source of the stored amount. Caller-supplied total, status or user ID fields are rejected.

Migration `006-reservation-prices.sql` adds a one-to-one price snapshot table with daily_price DECIMAL(12,2), rental_days, total_amount DECIMAL(20,2), TRY currency, a foreign key and amount consistency checks. A separate additive table satisfies the restart-safe migration contract and preserves existing reservation intervals without rewriting applied migrations or inventing historical prices. Earlier interval records without snapshots show a pricing-unavailable message. New reservations and snapshots are inserted atomically; later price changes never overwrite their saved totals.

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/cars/:id/quote?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | Public current-rate quote: carId, dates, dailyPrice, rentalDays, totalAmount, currency. Does not reserve dates. |
| POST | `/api/reservations` | Authenticated; carId/startDate/endDate and optional expectedDailyPrice. Returns 201 `{ reservation }`. |
| GET | `/api/reservations/mine?page=1&pageSize=10` | Authenticated, current owner only; `{ items, page, pageSize, total }`. Maximum pageSize 50. |
| PATCH | `/api/reservations/:id/cancel` | Authenticated owner only; empty JSON object. Returns `{ reservation }`; safe to repeat. |

Booking/cancellation writes reuse the exact Origin, JSON and X-Requested-With CSRF policy. Account identity comes exclusively from the session. Other users' reservation IDs return 404, including for cancellation; no private user-ID lookup is exposed. Both customers and administrators may create/view/cancel their own reservations; cross-customer admin management remains Phase 7. Private booking and public quote responses use Cache-Control: no-store.

Each create transaction uses READ COMMITTED and first locks the selected car row with SELECT FOR UPDATE. Under that lock it rechecks active status, dates, current price and pending/confirmed overlaps using a locking read, then inserts both reservation and price snapshot before committing. All cancellation transactions take the same car lock first, then lock and revalidate the owned reservation. The per-car mutex also covers an initially empty reservation set; READ COMMITTED avoids unnecessary gap-lock contention between different cars. Locking-read behavior follows the [MySQL 8.4 documentation](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

This protocol is required for every future operation that creates/changes reservation intervals or blocking status: lock the car first, then reservation rows, and recheck before commit. The tested guarantee applies to application writers following this protocol; direct SQL writes can bypass it. A transaction error rolls back both inserts and releases the connection. A car becoming reserved or entering maintenance returns 409 CAR_UNAVAILABLE with available alternatives for the same dates, calculated after rollback/release; inactive/missing cars return 404. The UI replaces its stale availability result with those alternatives.

New reservations are pending and intentionally block without automatic expiry, including before payment features exist. They remain in history until cancelled or transitioned in a later phase. Pending and confirmed reservations can be cancelled only before the pickup date in Europe/Istanbul; pickup-day, already-started and completed records reject cancellation with 409 CANNOT_CANCEL. Repeating cancellation of an already cancelled owned reservation succeeds. Cancellation preserves history/pricing and immediately releases date availability. No confirmation/payment/completion transition API is added here: payment transitions belong to Phase 6 and admin management to Phase 7.

There is no automatic retry of reservation creation after an uncertain network response. The UI directs the customer to My bookings before trying again; overlapping repeats are rejected rather than creating duplicates. Request-key idempotency, refunds and pending expiry are not implemented in Phase 5.

Phase 5 acceptance on 2026-11-04:

- `npm test --prefix server`: 8/8 passed. Includes exact-cent/leap-day pricing and totals beyond Number precision.
- `npm run build --prefix client`: passed.
- `docker compose --profile test run --build --rm test`: 43/43 passed on isolated real MySQL. The thirteen added cases cover snapshots and price changes, forged fields, auth/CSRF, maintenance/inactive/missing cars, all overlap shapes and adjacency, ownership/pagination, cancellation eligibility/idempotency, released availability, rollback after snapshot failure, and concurrency.
- Concurrency acceptance: eight simultaneous HTTP requests across two Express app instances yielded exactly one 201 and seven 409 conflicts, with one reservation and one snapshot. A pending transaction committed while another booking waited on the car lock was observed correctly. Different-car requests succeeded concurrently; cancellation/create races left no overlapping blocking reservations.
- `npm run test:e2e --prefix client`: 10/10 passed in Edge, including all earlier account/availability/catalog scenarios. New real flows cover guest dates through signup, reservation confirmation, persisted history after reload, cancellation, released availability and an actual stale-availability conflict. Price-change/network/list-error UI states use intercepted responses; actual price enforcement is verified by MySQL tests.
- Browser checks create unique `e2e-booking-...@example.test` customers and reservation history in the selected application database. Their real reservations are cancelled in cleanup; existing customers, bookings and vehicle prices are not changed.
- Desktop/mobile booking screenshots reviewed under ignored `client/test-results/`; the 390 px layout has no horizontal overflow.
- `docker compose up --build -d --wait`: passed with all application services healthy; migrations preserve existing data. `git diff --check`: passed.

Phase 5 was completed before the Phase 6 implementation below.

### Phase 6 — Simulated payments and loyalty ledger

My bookings now displays payment status and a payment reference. Pending rentals with a saved price can simulate a successful or failed payment, without entering card details. Success atomically marks the payment paid and the reservation confirmed. Failure leaves the reservation pending and blocking its dates, with a failed payment that can be retried. Successful payments and eligible cancellations are visible after reload in Payments (`#/payments`); Loyalty (`#/loyalty`) displays an exact point balance and chronological credit/reversal entries. Both activity pages have pagination, empty/loading/error/retry states and protected access.

New additive, restart-safe migrations `007-payments.sql`, `008-payment-attempts.sql` and `009-loyalty-ledger.sql` add:

- One payment per reservation, with saved amount/currency, fixed simulated method label, pending/paid/failed/refunded status, and paid/refunded timestamps.
- Payment attempts with a unique (payment_id, request_id) key and paid/failed outcome. Request IDs are normalized UUID strings. No card fields exist, and unsupported request fields are rejected.
- A loyalty ledger with signed BIGINT deltas and one earned/reversed entry per reservation. Balance is derived from SUM(points_delta), never a separately mutable balance.

New bookings create a pending payment in the same transaction as the reservation and price snapshot. Existing priced reservations can lazily create their payment on first simulation; older unpriced intervals cannot pay. The amount comes from the immutable reservation snapshot, not a caller-supplied amount or today's car price. Payment can be attempted only for pending reservations before or on the pickup day in Europe/Istanbul. No automatic payment or money movement occurs.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | `/api/payments/simulate` | Owner only; reservationId, requestId UUID and outcome paid/failed. Returns `{ payment, replayed }`. |
| GET | `/api/payments/mine?page=1&pageSize=10` | Owner's payment history, current statuses, saved amounts, timestamps and attempt counts. |
| GET | `/api/loyalty/mine?page=1&pageSize=10` | Owner's balance and ledger entries as exact decimal integer strings. |
| PATCH | `/api/reservations/:id/complete` | Owner only, empty JSON; completes a confirmed paid rental on/after the return date and awards points once. |
| POST | `/api/admin/payments/:id/refund` | Admin only, empty JSON; full simulated refund and point reversal. Uses payment ID, not reservation ID. |

List endpoints use the existing page validation (pageSize maximum 50). Payment and loyalty responses use Cache-Control: no-store. All writes reuse the exact-Origin/custom-header/JSON CSRF policy and session authentication. Other customers' reservation IDs return 404; payment and points history are always scoped to the signed-in owner. The narrow admin refund API belongs to the payment lifecycle; the admin payment overview, lookup interface and full management UI remain Phase 7.

Idempotency: repeating an attempt's request ID and outcome returns the current payment without adding attempts or changing states; changing its outcome under the same key returns 409 REQUEST_REUSED. A new success request for an already paid payment returns its existing result without another charge/attempt. New attempts cannot regress paid/refunded records, and a replay after cancellation reports the current refunded status without restoring confirmation. A known failed attempt may be retried with a new UUID. The UI retains its UUID for uncertain responses while mounted and directs the customer to payment history on network failure; real payment processing is outside this project.

Points policy: earn floor(saved paid amount in TRY / 100), once the paid rental is completed on or after its end-exclusive return date in Europe/Istanbul. Completing before the return date, completing unpaid/cancelled rentals, or completing refunded rentals returns 409 CANNOT_COMPLETE. The customer explicitly selects Complete rental and earn points when eligible; there is no background completion job. Retrying completion never duplicates credit. A zero-value/under-100 TRY rental earns a zero-point ledger entry. Points have no cash value and cannot be redeemed in this phase. All arithmetic uses BigInt and points are transmitted as strings to preserve large values.

Cancellation retains the Phase 5 rule: only pending/confirmed rentals before their pickup date may be cancelled by their owner. In the same transaction it refunds paid payments, closes unattempted pending payments as failed, and reverses any existing points with an append-only negative entry. Failed payments remain failed. Repeating cancellation or refund is safe. For a completed paid rental, an administrator can issue a full simulated refund; its completed reservation remains historical and its points are reversed exactly once. For active rentals, admin refund also cancels the reservation and releases availability. Unpaid payments cannot be refunded. Partial refunds and real refund processing are not implemented.

All payment, completion, refund and cancellation writes use the same READ COMMITTED transaction and car -> reservation -> payment/ledger lock order. Unique payment/attempt/ledger constraints provide an additional duplicate guard. Related changes commit or roll back together. Loyalty balance and page entries are read from one REPEATABLE READ snapshot, so a concurrent refund cannot produce mismatched balance/history within a response. Future admin status changes must use these lifecycle services and lock order; direct SQL writes can bypass application invariants. Locking-read behavior follows the [MySQL documentation](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

Phase 6 acceptance on 2026-11-04:

- `npm test --prefix server`: 9/9 passed, including exact point rounding and large amounts beyond Number precision.
- `npm run build --prefix client`: passed.
- `docker compose --profile test run --build --rm test`: 56/56 passed on isolated real MySQL. Thirteen new cases cover snapshot-priced payments, failed/retried attempts, request-key reuse, eight concurrent payment requests across two app instances, ownership/CSRF/forged-field rejection, legacy records, early/completed/zero-value point eligibility, parallel completion/refund, cancellation/payment races, point reversals and atomic rollback after injected failures.
- `npm run test:e2e --prefix client`: 13/13 passed in the final full run. Real browser actions verify failed -> paid -> cancelled/refunded payment, persisted history and no early points, alongside all ten earlier scenarios. Completed/reversed ledger rendering is simulated in the browser; actual eligibility/credit/reversal logic is exercised by MySQL tests without changing development dates.
- Initial full browser runs passed 12/13; a broad status locator matched both a notice and loading status. The test now targets the exact result notice; stale notices are also cleared when a new action starts. The new suite rerun passed 3/3.
- Repeated browser runs then reached the existing per-process 30-attempt authentication limit. The API process was restarted without changing the limiter, and the clean full rerun passed 13/13. Persisted accounts, sessions, bookings and payments were preserved.
- Payment/loyalty desktop and 390 px mobile screenshots reviewed under ignored `client/test-results/`; no horizontal overflow. Browser checks create unique test customers and cancel/refund their own real test bookings in cleanup.
- `docker compose up --build -d --wait`: passed with application services healthy and existing data preserved. `git diff --check`: passed.

Phase 6 was completed before the Phase 7 implementation below.

### Phase 7 — Administrator dashboard and management

Sign in with an administrator account and open `#/admin`. The dashboard has Cars, Reservations, Customers and Payments sections at `#/admin/cars`, `#/admin/reservations`, `#/admin/customers` and `#/admin/payments`; deep links and reloads work. Use the development-only admin seed instructions in Phase 3 to create your own admin credentials. Public registration still creates customers only. No built-in password, production bypass or role-editing screen was added.

All dashboard endpoints independently enforce session authentication, current administrator role, no-store caching, and the existing Origin/JSON/custom-header CSRF policy. Customers receive 403 and anonymous users 401 before resources can be read or changed. Page guards also display sign-in/access-denied states. Admin mutations validate strict field allowlists and use parameterized SQL. The dashboard includes loading/error/retry, search, status filters, pagination and explicit confirmation for deactivation, reservation status changes and refunds.

| Method | Endpoint | Behavior |
|---|---|---|
| GET/POST | `/api/admin/cars` | List all statuses / create a vehicle. |
| GET | `/api/admin/cars/:id` | View vehicle details, including inactive cars and vehicle code. |
| PATCH/PUT | `/api/admin/cars/:id` | Partial update / full replacement of editable vehicle fields. |
| DELETE | `/api/admin/cars/:id` | Empty JSON; soft-deactivate as inactive; never physically deletes the row. |
| GET | `/api/admin/reservations` | Cross-customer reservation list with saved price, payment status and eligible actions. |
| PATCH | `/api/admin/reservations/:id` | `{ status }`: confirmed, cancelled or completed, subject to lifecycle rules. |
| GET | `/api/admin/customers` and `/api/admin/customers/:id` | Search/list and view customer contact details; administrators are excluded. |
| PATCH | `/api/admin/customers/:id` | Partial fullName/email/phone update only. |
| GET | `/api/admin/payments` | Cross-customer simulated payment overview and reservation references. |
| POST | `/api/admin/payments/:id/refund` | Existing full simulated refund, now available from the dashboard. |

All list endpoints accept page/pageSize (default 1/10, maximum pageSize 50) and literal search up to 100 characters. Cars, reservations and payments also accept their own status values; unknown/repeated parameters return 400. Lists use stable descending ID order. Car search matches code/brand/model; customer search matches name/email/phone; reservation/payment search matches reservation/payment IDs, customer name/email and vehicle name. No caller-controlled SQL sort or column names are accepted.

Vehicle editing covers unique vehicle code, brand/model, category, seats 1–20, transmission, fuel type, nonnegative daily price, image URL and active/maintenance/inactive status. Daily price is a decimal string with up to two decimal places; no binary floating-point amount is stored. Image sources are HTTP(S) URLs without credentials or local paths under /images/; script/data/protocol-relative URLs and local traversal are rejected. Images are loaded by the browser, not fetched by the server. Duplicate vehicle codes return 409.

New vehicles default to inactive in the form, so they can be reviewed before activation. Deactivation retains all reservation/payment/points references and saved pricing. Price edits affect future quotes/bookings only; existing reservation snapshots are unchanged. Maintenance/inactive status changes and deactivation lock the car and reject with 409 CAR_HAS_RESERVATIONS if pending/confirmed reservations end after today's Istanbul date. Resolve those ongoing/upcoming bookings first. This uses the same car lock as booking creation, so a concurrent booking cannot slip into a car being deactivated. Historical reservations are preserved and inactive cars may later be reactivated. Applied migrations are unchanged; no new schema or destructive data migration is required for Phase 7.

Reservation management uses the existing car -> reservation -> payment/ledger lock order. Confirmation requires an active car, a paid pending/confirmed rental that has not ended, and no overlapping blocking reservation. Normal successful customer payment already confirms its rental. Unpaid rentals cannot be manually confirmed into a state where payment would be impossible. Cancelled/completed rentals cannot be reopened, and admin status writes cannot change car, owner, dates, amounts or payment fields.

Admins may cancel pending/confirmed rentals even after pickup for operational correction; this explicitly refunds paid amounts and reverses any points atomically. Owner cancellation retains its stricter before-pickup rule. Admin completion reuses the Phase 6 paid/return-date checks and grants points exactly once, including under concurrent requests. Completed rentals reject cancellation; use the payment refund correction to preserve completed history while reversing points. Refunds are explicitly confirmed with their payment reference/amount before submission. There is no manual paid/failed toggle or direct point-balance editor.

Customer editing permits only name/email/phone, validates the existing profile rules and unique email constraint, and leaves password hashes, roles, sessions and historical records intact. Admin accounts are not editable through customer endpoints. Customer deletion, password reset, role administration, arbitrary reservation rescheduling and hard deletion are outside this phase.

Phase 7 acceptance on 2026-11-05:

- `npm test --prefix server`: 9/9 passed.
- `npm run build --prefix client`: passed.
- `docker compose --profile test run --build --rm test`: 67/67 passed against isolated real MySQL. Eleven new cases cover every admin endpoint's anonymous/customer rejection, vehicle CRUD/validation, literal search/status/pagination, snapshot/history preservation, blocked deactivation, deactivation-vs-booking concurrency, limited customer edits, cross-customer overviews and safe reservation/payment/loyalty transitions.
- `npm run test:e2e --prefix client`: 16/16 passed in the final full Edge run. Three new real admin scenarios verify create/edit/deactivate, guarded deactivation, cancellation/refund/history preservation, customer contact updates, payment overview/refund, list errors/retry, empty search, status filtering and pagination. All thirteen previous customer scenarios also pass.
- The first browser run exposed a select-label association issue; explicit id/htmlFor labels fixed it. A later search assertion raced the previous unfiltered list; tests now await the matching search response and target the specific customer record. The final full run passed at the normal timeout.
- Admin browser tests require the local development/test Compose server. They create a unique admin via the documented seed command, unique customers and dedicated E2E-ADMIN vehicles. Cleanup cancels/refunds their bookings and deactivates their vehicles; no existing vehicles/customers are edited. Test histories and fixtures remain available in the selected development database. E2E_BASE_URL must point to that Compose application for admin scenarios.
- Desktop/mobile dashboard, car editor and payment screenshots reviewed under ignored `client/test-results/`; 390 px checks found no horizontal overflow.
- `docker compose up --build -d --wait`: passed with application services healthy. The API was restarted before final browser acceptance to clear accumulated development login attempts; authentication limits were not changed and database data/sessions were preserved. `git diff --check`: passed.

Only Phase 7 was added in this step. Phase 8 quality/demo audit remains pending.

## 0. Project contract

Build **Car Rental Management System** using React, Node.js + Express, MySQL, Axios, and Docker Compose. The application must support: car catalog with prices and availability, date-based bookings, alternative cars when unavailable, customer accounts and profiles, rental history, payment tracking, loyalty points, and an admin panel for cars, bookings, pricing and customer profiles.

**Source alignment:** Course slides are unavailable; exact slide alignment is unverified. The roadmap targets JS/ES6, React JSX/components/props/state/events/hooks, Axios, Node.js, Express, MySQL and CRUD. Authentication, payment tracking, booking conflict prevention, robust authorization, Docker and loyalty points are product requirements/engineering extensions, *not direct prescriptions from course slides*.

### Non-negotiable engineering rules
1. Work in small, reviewable phases. Never implement future phases before acceptance checks for current phase pass.
2. Inspect existing repository before changing anything. Never overwrite working code blindly.
3. Keep frontend, backend, database separate. Use React state/props to render UI, not direct DOM mutation.
4. Use JavaScript with ES modules unless repository already chooses otherwise; prefer readable, course-aligned code to excessive abstractions.
5. Use parameterized queries and database transactions; no string-concatenated SQL.
6. All privileged APIs enforce authorization on the server. Passwords must be hashed, never stored in plaintext.
7. No real credit card handling: simulate payments using statuses and records; document that this is not a production payment gateway.
8. Availability is **date-range derived**, not a global `available` flag. A maintenance/active status may be stored separately.
9. Prevent double-booking under concurrent requests using an appropriate transaction/locking strategy, not only frontend checks.
10. Never commit real `.env`, secrets, database data, or `node_modules`; commit `.env.example`.
11. Use Docker Compose for `client`, `server`, and `db`; persistent named volume for MySQL. The browser calls exposed API URL, backend calls Docker host `db`.
12. Each phase ends with tests, updated README, and a short summary of changes, commands executed, remaining risks.
13. Do not mark a requirement complete without running its acceptance test. Ask the user before irreversible destructive migrations or broad scope changes.

## 1. Required user roles and flows

- **Guest:** Browse catalog, search and filter cars, check availability. Must authenticate before booking.
- **Customer:** Register, log in/out, edit profile, select rental dates, book available car, see alternatives when chosen car is unavailable, view own bookings/history, simulate payment, view payments and loyalty balance/history, cancel eligible booking.
- **Admin:** Log in, manage cars and prices, mark cars active/in maintenance, view/manage all bookings, view/manage customer profiles according to role, review payment records. Restrict all admin APIs.

### Core booking lifecycle
1. Customer chooses car and pickup/return dates.
2. Backend validates valid date interval, car active, capacity and availability.
3. If unavailable, API returns alternative *available* cars for the same date range (nearest category/price/attributes); frontend shows alternatives and reasons.
4. If available, backend creates pending reservation atomically and returns server-calculated total.
5. A simulated payment sets payment and reservation statuses consistently inside a transaction.
6. Loyalty points are awarded once per eligible completed-and-paid reservation (choose and document exact award rule) and reversed on refund/cancellation where applicable.

## 2. Technology and repository layout

```text
smartrent/
  client/
    src/
      components/{layout,cars,booking,forms,common}/
      pages/{Home,Catalog,CarDetails,Login,Register,Profile,MyBookings,Payments,Loyalty,Admin}/
      hooks/
      context/
      services/api.js
      utils/{pricing,recommendations,dates}.js
      App.jsx
    Dockerfile
    package.json
  server/
    src/
      app.js
      index.js
      config/db.js
      routes/
      controllers/
      services/
      middleware/{auth,errorHandler,validate}.js
    Dockerfile
    package.json
  database/
    migrations/
    seed.sql
  compose.yaml
  .env.example
  README.md
  # Architecture, API and test notes are maintained in README.md.
```

Recommended core tables (adapt migration details to agreed lifecycle):
- `users(id, name, email UNIQUE, password_hash, role, created_at, ...)`
- `cars(id, brand, model, category, seats, transmission, fuel_type, daily_price, image_url, status, ...)`
- `reservations(id, user_id FK, car_id FK, start_date, end_date, total_price, status, created_at, ...)`
- `payments(id, reservation_id FK, amount, status, method_label, paid_at, ...)` — simulated records, no card credentials
- `loyalty_transactions(id, user_id FK, reservation_id FK, points_delta, reason, created_at, ...)`
- `locations(id, city, address, ...)` optional if location filter is needed.

Use consistent **start inclusive, end exclusive** date ranges and document timezone/day pricing assumptions. Reservation overlap: `existing.start_date < requested.end_date AND existing.end_date > requested.start_date` for blocking statuses. Status transition and concurrency rules must be explicit.

## 3. Phased implementation plan

### Phase 0 — Repository inspection, scope, conventions
**Agent tasks:** Inspect files, package versions, existing slides/requirements and tests. Prepare requirements matrix and architecture notes. Pick application name, API prefix `/api`, naming conventions, reservation/payment/points lifecycles, permissions matrix, and a minimal demo dataset. Maintain architecture, test-plan notes and progress in README.md; do not prematurely code features.

**Exit criteria:** All mandatory project requirements are mapped to screens, API routes, tables and tests. Assumptions (simulated payments, points award rules, booking cancellation) documented.

**Documentation location:** Keep architecture, API, setup and acceptance notes in this README; do not recreate docs/. Existing Phase 1 infrastructure is retained.

### Phase 1 — Docker Compose and skeleton
**Agent tasks:** Bootstrap Vite React client, Express server, MySQL service, compose file, Dockerfiles, `.dockerignore`, `.gitignore`, `.env.example`, database volume and healthcheck, server health endpoint `/api/health`. Configure CORS for development and Vite API URL/proxy correctly. SQL initialization or migrations as one documented path. Confirm ports are configurable.

**Exit criteria:** `docker compose up --build` starts all services, `/api/health` returns success, frontend loads, MySQL data survives container recreation. Clean setup documented. If Docker host is unavailable, clearly report blocker rather than claiming tests passed.

### Phase 2 — Schema, seed and read-only car catalog
**Course topics:** JSX, components, props, `map()`, `filter()`, keys, conditional rendering, `useEffect`, Axios GET, Express GET and SQL SELECT.

**Agent tasks:** Create schema/migration and seed 10–15 representative cars. Build `Navbar`, `CarCard`, `CarGrid`, `CarFilters`, `CarDetails`; build GET `/api/cars`, GET `/api/cars/:id` with sorting/filters, optional paging. Fetch through Axios instance; render loading, errors and empty results. Use props and stable keys.

**Exit criteria:** Catalog data comes from MySQL, not hardcoded lists; model, daily price and attributes render; filters work; malformed/unknown IDs return appropriate errors; API tests pass.

### Phase 3 — User registration, login, profile and role security
**Course topics:** Forms, controlled inputs, event handlers, `useState`, `useContext`, Axios POST, Express routes.

**Agent tasks:** Signup/login/logout (session or secure token strategy documented), password hashing, input validation, unique emails, profile update, customer/admin role separation; frontend auth context, protected customer and admin pages; backend authentication/authorization middleware. No hardcoded admin bypass in production path; use documented development seed setup.

**Exit criteria:** Customer can register, log in/out, edit own profile; unauthenticated requests fail; customers cannot access admin routes or other customers' private records; password hash stored, not password.

### Phase 4 — Date-specific availability and alternatives
**Course topics:** Events, controlled dates, computed state, `filter()`, `map()`, Axios GET, SQL SELECT.

**Agent tasks:** Build date selection and validate `start < end` and no past dates if required; endpoint GET `/api/cars/:id/availability?startDate=...&endDate=...`, and GET `/api/cars/alternatives?carId=...&startDate=...&endDate=...`. Define blocking reservation statuses. Calculate alternatives on the server from available cars, sorted by category, price proximity, seats and transmission; explain ranking.

**Exit criteria:** Overlap scenarios correctly show unavailable; adjacent intervals are allowed under end-exclusive convention; alternatives all available for exactly requested dates; no fake recommendations if none exist.

### Phase 5 — Booking workflow and pricing
**Course topics:** State lifting, child-to-parent callbacks, controlled forms, conditional rendering, Axios POST, Express POST, MySQL INSERT, `async/await`.

**Agent tasks:** Reservation form, booking confirmation, server-side price calculation, customer ownership, booking listing and cancellation, booking statuses (`pending`, `confirmed`, `cancelled`, `completed`). Create a concurrency-safe booking transaction for simultaneous requests for the same car/time. Define expiry policy for pending bookings or ensure pending reservations intentionally block availability.

**Exit criteria:** A customer can complete reservation flow; price not trusted from client; overlap blocks a second simultaneous booking; own booking history works; unauthorized access fails; automated overlap and concurrency tests pass.

### Phase 6 — Simulated payments and loyalty ledger
**Course topics:** CRUD, POST/PATCH, state updates, MySQL transactions.

**Agent tasks:** `payments` API and UI with fake "pay now" action, payment states `pending/paid/failed/refunded`, no payment card collection; consistent reservation status on success. Implement points ledger with chosen formula (e.g. 1 point per 100 TRY of eligible completed paid rental), balance derived from transactions, exactly-once award idempotency, reversal on cancellation/refund where policy requires. Pages: payment history and loyalty balance/activity.

**Exit criteria:** Payment record tied to reservation; repeat payment or points request does not duplicate credit; history isolated per customer; refunded/cancelled bookings don't retain invalid points; test all transitions.

### Phase 7 — Admin dashboard and full CRUD
**Course topics:** `map()`, forms, props, Axios GET/POST/PUT/PATCH/DELETE, Express CRUD, SQL INSERT/UPDATE/DELETE, search.

**Agent tasks:** Admin CRUD for cars, price change, vehicle status and image URL; booking list and status management; customer profile search/view/edit of authorized fields; payment overview. Prefer soft-deactivation of cars with historical reservations. Add validation, confirmation for destructive actions, pagination/search if needed.

**Exit criteria:** All mandatory admin management functions work and persist; customers cannot access them; deleting/deactivating car does not corrupt past history; CRUD API tests pass.

### Phase 8 — Quality, course-concept audit, demo and delivery
**Course topics:** Events/hooks, derived state, JSX, Axios errors, Express/MySQL and CRUD reviewed end to end.

**Agent tasks:** Responsive styling; accessibility of forms and buttons; robust error boundaries/messages; route guards; reusable hooks such as `useCars` and `useReservations`; optional `useRef`, `useMemo`, `useCallback` only where useful. Audit important slide concepts against implemented examples, avoiding contrived extra code. Add seed demo accounts, API docs, architecture diagram, tests, complete README, quick demo steps, Docker instructions.

**Exit criteria:** Full end-to-end demo: guest browses → customer registers → checks dates → unavailable car gives alternatives → books → simulated payment → rental history / loyalty shows → admin manages cars, reservations, pricing and customer profiles. New teammate can set up from README.

## 4. Suggested API contract

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | service health |
| GET | `/api/cars` | public | catalog/filters |
| GET | `/api/cars/:id` | public | details |
| GET | `/api/cars/:id/availability` | public | date-specific availability |
| GET | `/api/cars/alternatives` | public | date-specific alternatives |
| POST | `/api/auth/register` | public | register |
| POST | `/api/auth/login` | public | login |
| POST | `/api/auth/logout` | authenticated | logout, depending on session implementation |
| GET/PATCH | `/api/me` | customer/admin | own profile |
| POST | `/api/reservations` | customer | new booking |
| GET | `/api/reservations/mine` | customer | own history |
| PATCH | `/api/reservations/:id/cancel` | owner/admin | cancel eligible booking |
| POST | `/api/payments/simulate` | owner | simulate payment |
| GET | `/api/payments/mine` | customer | payment history |
| GET | `/api/loyalty/mine` | customer | balance and ledger |
| GET/POST | `/api/admin/cars` | admin | list/create |
| PUT/PATCH/DELETE | `/api/admin/cars/:id` | admin | update/deactivate/remove |
| GET/PATCH | `/api/admin/reservations` and `/:id` | admin | manage bookings |
| GET/PATCH | `/api/admin/customers` and `/:id` | admin | manage profiles |
| GET | `/api/admin/payments` | admin | payment overview |

## 5. Test matrix (must automate where practical)

- Car catalog reads MySQL, handles no results and invalid IDs; search and filters combine correctly.
- Authentication: duplicate email, invalid input, wrong password, unauthenticated access, customer→admin escalation blocked, user A cannot access user B data.
- Availability: identical intervals overlap; partial overlap; containing interval; interval inside existing booking; adjacent non-overlap; cancelled bookings do not block.
- Booking: start/end validation, server-side price recalculation, unavailable returns alternatives, simultaneous requests cannot both book same car.
- Payments: duplicate simulated requests do not create inconsistent states; no sensitive card data stored.
- Loyalty: points earned once on eligible status, historical ledger correct, reversal/refund consistent.
- Admin: create/read/update/deactivate cars, update prices, manage bookings and permitted customer profile fields; authorization tests.
- Docker: fresh startup and data persistence across restart, secrets excluded from repo.

## 6. Delivery progress tracker

- [x] P0 Requirements and architecture documented
- [x] P1 Docker/dev environment operational
- [x] P2 Catalog with real DB data
- [x] P3 Accounts and secure roles
- [x] P4 Availability and alternatives
- [x] P5 Booking and concurrency safety
- [x] P6 Simulated payments and loyalty
- [x] P7 Admin management CRUD
- [ ] P8 Full tests and demo documentation

Update this checklist only when the corresponding phase's acceptance checks have actually passed.
