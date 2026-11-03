# SmartRent — Agent-Ready Development Roadmap

## 0. Project contract

Build **Car Rental Management System** using React, Node.js + Express, MySQL, Axios, and Docker Compose. The application must support: car catalog with prices and availability, date-based bookings, alternative cars when unavailable, customer accounts and profiles, rental history, payment tracking, loyalty points, and an admin panel for cars, bookings, pricing and customer profiles.

**Source alignment:** Course slides cover JS/ES6, React JSX/components/props/state/events/hooks, Axios, Node.js, Express, MySQL, CRUD. Authentication, payment tracking, booking conflict prevention, robust authorization, Docker and loyalty points are product requirements/engineering extensions, *not direct prescriptions from course slides*.

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
  docs/{API.md,ARCHITECTURE.md,TEST_PLAN.md}
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
**Agent tasks:** Inspect files, package versions, existing slides/requirements and tests. Prepare requirements matrix and architecture notes. Pick application name, API prefix `/api`, naming conventions, reservation/payment/points lifecycles, permissions matrix, and a minimal demo dataset. Create `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md` and base README; do not prematurely code features.

**Exit criteria:** All mandatory project requirements are mapped to screens, API routes, tables and tests. Assumptions (simulated payments, points award rules, booking cancellation) documented.

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

> You are the implementation agent for SmartRent. Read `SMARTRENT_AGENT_ROADMAP.md`, inspect the current repository, and implement **only the next incomplete phase**. Before coding, state which phase and requirements you are targeting, planned files, database changes, and acceptance checks. Follow the engineering rules and course stack strictly. Implement minimal coherent functionality, add tests, run them (including Docker if available), update README and progress tracking, and finish by reporting exactly which acceptance checks passed/failed with commands used. Do not fake test results, overwrite unrelated files, add real payment capture, skip server authorization, or claim a booking concurrency guarantee without a tested database strategy. Stop after completing the phase and await the next explicit task.

## 7. Delivery progress tracker

- [ ] P0 Requirements and architecture documented
- [ ] P1 Docker/dev environment operational
- [ ] P2 Catalog with real DB data
- [ ] P3 Accounts and secure roles
- [ ] P4 Availability and alternatives
- [ ] P5 Booking and concurrency safety
- [ ] P6 Simulated payments and loyalty
- [ ] P7 Admin management CRUD
- [ ] P8 Full tests and demo documentation

Update this checklist only when the corresponding phase's acceptance checks have actually passed.
