# Fair Drop

A fair, abuse-aware ticket drop demo. Participants register, join an entry window once per event, and receive a durable result after a server-side randomized draw. Winners receive a time-limited seat reservation and can confirm a simulated ticket. Organizers manage drops and inspect system evidence. k6 exercises the same API used by the website.

## Stack

- React, Vite and TypeScript participant/organizer UI
- Express API with PostgreSQL as the source of booking truth
- Redis-backed per-account and per-IP request budgets
- Prisma schema and migrations
- k6 scenarios for repeat attempts, bursts, mixed cohorts and confirmation races

## Local setup

1. Install Node.js 20+ and Docker Desktop.
2. Copy `.env.example` to `.env`. Before registering, add your email to `ORGANIZER_EMAILS` to make that account an organizer. Tune the per-IP token budgets for your test environment if needed; the per-account entry budget stays intentionally strict.
3. Start services: `docker compose up -d`.
4. Install dependencies: `npm install`.
5. Create the database schema: `npm run db:migrate`.
6. Start the app: `npm run dev`.
7. Open [http://localhost:5173](http://localhost:5173), register, and create a drop from Organizer.

An account is a normal participant unless its email is listed in `ORGANIZER_EMAILS`. This keeps organizer privileges explicit. Ticket payment is intentionally simulated; no payment provider or real ticket delivery is connected.

## Demo flow

Register and sign in → organizer creates a drop and opens its entry window → participants join once → organizer closes the window to freeze the list and persist ranks → capacity winners receive reservations and remaining entries become waitlisted → confirm a reservation to issue the same ticket on safe retries. Expired reservations are released and the next waitlisted entry is promoted by the background worker.

For the comparison demo, create three drops with the same capacity: **Baseline** uses first-come allocation with abuse limits off; **Limited baseline** uses first-come allocation with limits on; **Protected draw** uses random allocation with limits on. Keep the test population and load scenario consistent, and use a fresh drop for each run. First-come drops save database arrival sequence; protected drops shuffle once using the server and persist the resulting ranks.

## Load scenarios

Install k6, start your test deployment, then prepare test participants with `npm --workspace @fair-drop/api run load:accounts -- 50000` (or a smaller count). This creates test-only users and pre-authenticated local sessions, and writes ignored credentials to `tests/load/accounts.local.json`. Never commit that file. Open a drop in the test deployment and select its ID in Attack Lab, or run `k6 run tests/load/fair-drop.js` with `BASE_URL`, `DROP_ID`, `ACCOUNTS_FILE`, and optional `SCENARIO`, `VUS`, and `DURATION` environment variables. Use fresh inventory for each comparable run. The script only targets the URL you explicitly configure and writes a run-specific JSON summary under `tests/load/`.

Example: `k6 run -e BASE_URL=http://localhost:4000 -e DROP_ID=<drop-id> -e ACCOUNTS_FILE=./tests/load/accounts.json tests/load/fair-drop.js`.

## Safety and demo limits

Rate limits make repeat attempts more expensive but do not prove a unique human; multiple accounts and shared networks remain relevant limits. Run load scenarios only against your own test deployment. A local Docker Compose deployment is for development/demo, not production; production needs managed secrets, TLS, backups, monitoring, and a hardened deployment configuration.
