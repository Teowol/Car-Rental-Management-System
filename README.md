# SmartRent — Agent-Ready Development Roadmap

## Working application — Phase 2

Catalog data comes from MySQL; the client does not contain a hardcoded car list. This phase provides a read-only catalog. Accounts, bookings, date-based availability, payments and admin operations belong to later phases. Car images are local, illustrative SVG drawings. Project notes are maintained in this README; docs/ is not used.

The interface, accessibility labels, API messages and documentation are in English. Prices use English number formatting; the currency remains TRY.

English-language update verified on 2026-11-03: server tests (3/3), client build and Edge browser scenarios (2/2) passed. Browser checks include the English document language, heading, filters, detail view, empty/error states and mobile layout. Docker services were rebuilt with the translated application.

### Setup and startup

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

`database/migrations/002-cars.sql` creates the cars table: unique vehicle_code, brand/model/category, seats/transmission/fuel, DECIMAL(12,2) daily price, image path, and active/maintenance/inactive status. Prices cannot be negative; seats must be between 1 and 20. There is no global available field. User, reservation and payment tables will be added in their respective phases.

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

At the start of Phase 2, all three Phase 1 services were healthy and the real database health check returned 200. Phase 2 acceptance is complete. Phase 3 and later phases are outside this work. Known limitations: illustrative images, the Vite development server, and no date-based availability or bookings yet.

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

## 6. Agent execution prompt (copy into coding agent)

> You are the implementation agent for SmartRent. Read `README.md`, inspect the current repository, and implement **only the next incomplete phase**. Before coding, state which phase and requirements you are targeting, planned files, database changes, and acceptance checks. Follow the engineering rules and course stack strictly. Implement minimal coherent functionality, add tests, run them (including Docker if available), update README and progress tracking, and finish by reporting exactly which acceptance checks passed/failed with commands used. Do not fake test results, overwrite unrelated files, add real payment capture, skip server authorization, or claim a booking concurrency guarantee without a tested database strategy. Stop after completing the phase and await the next explicit task.

## 7. Delivery progress tracker

- [x] P0 Requirements and architecture documented
- [x] P1 Docker/dev environment operational
- [x] P2 Catalog with real DB data
- [ ] P3 Accounts and secure roles
- [ ] P4 Availability and alternatives
- [ ] P5 Booking and concurrency safety
- [ ] P6 Simulated payments and loyalty
- [ ] P7 Admin management CRUD
- [ ] P8 Full tests and demo documentation

Update this checklist only when the corresponding phase's acceptance checks have actually passed.
