# Golden QA — Starkist Label In-Process Inspection System

A tablet-first quality-inspection app for the Starkist paper-label line. Operators and QA
Officers capture each of the four production stages on a tablet; every record is keyed to one
**Job #**, and typing a Job # returns the full cross-stage quality record.

Built to run on an **on-premise server** on **Node.js + PostgreSQL**. The only runtime
dependency is the `pg` Postgres driver; the front end is dependency-free vanilla JS.

---

## 1. Quick start (on-prem server)

1. Install **Node.js 18+** (https://nodejs.org) and **PostgreSQL 13+** on the server.
2. Create a database and (recommended) a dedicated role:

   ```sql
   CREATE DATABASE goldenqa;
   CREATE USER goldenqa WITH PASSWORD 'change-me';
   GRANT ALL PRIVILEGES ON DATABASE goldenqa TO goldenqa;
   ```

3. Copy this `Golden-QA-App` folder onto the server and install the driver:

   ```
   npm install
   ```

4. Point the app at your database — either edit the `database` block in `config.json`,
   or set a connection string (takes precedence):

   ```
   export DATABASE_URL=postgres://goldenqa:change-me@localhost:5432/goldenqa
   ```

5. Start it:

   ```
   node server.js
   ```

   Tables are created automatically on first run. If a legacy `data/db.json` is present it
   is imported once as a migration; otherwise the default seed data is loaded. You'll see:
   `Golden QA server on http://0.0.0.0:3000 (…) [PostgreSQL]`.
6. On any tablet on the same network, open **http://<server-ip>:3000** (e.g. http://192.168.1.50:3000).

To keep it running after logoff, install it as a service (Windows: `nssm`, or Task Scheduler;
Linux: `systemd` or `pm2`). See section 7.

### Default sign-ins (change before go-live)
| User | Role | PIN |
|------|------|-----|
| A. Kumar / P. Devi | QA Officer | 1234 |
| R. Prasad | Supervisor | 2345 |
| Ateet Roshan | Quality Manager | 9999 |
| Administrator | Administrator | 0000 |

---

## 2. Using it on a tablet

- Open the URL in Chrome/Edge/Safari, then **Add to Home Screen** — it installs as an app
  (full-screen, large touch targets).
- After the first load it works **offline**; data entered offline is **queued and synced**
  automatically when the network returns (watch the dot in the top-right: green = online).
- **Scan** the Job # barcode with the camera (📷), **snap defect photos**, and **sign** on screen.

---

## 3. The four stages (forms digitised)

1. **Printing** — F-040-A / F-016-E / F-027-A (machine chosen at job creation)
2. **Reel Inspection** — F-021 (per-roll defect & waste log; AVT import)
3. **Sheeting / Slitting** — PRD002
4. **Finishing & Release** — F-038-A (mandatory hourly checks, final release decision)

---

## 4. Configuration — `config.json`

| Key | What it does |
|-----|--------------|
| `port` / `host` | Server address (default 3000 on all interfaces) |
| `database` | PostgreSQL connection (`host`/`port`/`database`/`user`/`password`/`ssl`, or a single `url`). The `DATABASE_URL` env var overrides these. Tables are auto-created on first run |
| `auth` | `sessionTtlMinutes` — sliding inactivity timeout for sign-ins (default 720 = 12h). Sessions are stored in the `sessions` table so a restart doesn't log everyone out |
| `sso` | Microsoft 365 sign-in. `mode:"stub"` accepts any `@golden.com.fj` email (demo). For production set `mode:"entra"` + `tenantId`/`clientId` and implement `verifyEntraToken()` in `server.js` |
| `businessCentral` | Set `enabled:true` and confirm `jobService` (the published OData web service holding the print Job# + item). The server queries `bc-test.gml.com.fj` directly — run it on a host that can reach BC |
| `notify` | Paste a **Teams Incoming Webhook URL** and/or SMTP details to get hold/reject alerts |
| `tolerances` | COF range, registration max, barcode min grade — drive the auto pass/fail flags (also editable in Admin) |

---

## 5. Integrations

- **Business Central**: `integrations/businessCentral.js` queries BC14 OData V4 by Job #.
  Until enabled it returns sample data so the UI works. Confirm the exact service name with
  your BC admin and set `businessCentral.enabled=true`.
- **AVT reel report**: Stage 2 → *Import AVT report (CSV)*. Expected headers (any order):
  `Roll, TotalMeters, WasteIn, WasteOut, Defect, WeightKg`.
- **Alerts**: hold/reject events call `integrations/notify.js` (Teams webhook now; SMTP email
  hook ready to wire to your relay).

---

## 6. Data, backup & database

- All records live in **PostgreSQL**; uploaded photos/signatures are files in `data/uploads/`.
- The schema is **fully normalized** and created automatically on first run (see `db.js`):
  - `users`, `sessions`, `audit`
  - `machines` + `machine_stations`, `defect_types`, `products`, `tolerances` (master data)
  - `jobs`, and per stage: `stage1..4` headers plus child tables for repeating rows
    (`stage1_stations`, `stage2_rows`, `stage3_rolls`, `stage4_checks` + `stage4_check_values`)
    and a shared `stage_photos` table.
- **Back up the database** (`pg_dump`) and the `data/uploads/` folder on a schedule — together
  they are the system of record.
- **Migration:** if a legacy `data/db.json` is present on first run, it is imported once into
  Postgres automatically, then ignored. After that, Postgres is the single source of truth.
- All data access goes through the `db.js` module (the `pg` connection pool), so the API layer
  stays thin and the schema is easy to extend.

---

## 7. Production hardening checklist

- [ ] Change all default PINs in **Admin > Users** (add/edit users, reset PINs, set roles,
      disable leavers — Administrator role required), and set strong manager PINs.
- [ ] Put the server behind **HTTPS** (reverse proxy: IIS/ARR, nginx, or Caddy) so the camera
      and PWA install work reliably and credentials are encrypted.
- [ ] Replace the SSO stub with real **Microsoft Entra ID** validation — set `sso.mode="entra"`
      and implement `verifyEntraToken()` in `server.js` (a documented scaffold is in place).
- [ ] Run as a service (pm2 / systemd / Windows service) with auto-restart.
- [ ] Provision **PostgreSQL** (dedicated role + DB) and schedule **backups** (`pg_dump`) of the
      database + the `uploads/` folder. Restrict DB network access to the app host.
- [ ] Confirm the **Business Central** web service and enable it.
- [ ] Set the **SQF document-retention** period and confirm with your auditor.

---

## 8. What's included (feature list)

Tablet-first PWA (installable, offline + sync) · **PostgreSQL** (fully normalized schema, auto-migrated) ·
PIN + Microsoft 365 sign-in · role-based access ·
persistent sessions with inactivity expiry · **user management** (add/edit/disable, reset PIN,
roles — Administrator only) · machine-driven Stage-1 forms · all 4 stages with real form fields ·
**in-sequence stage completion with required-field validation** · barcode/QR Job# scanning ·
defect photo capture · on-screen signatures · auto pass/fail vs tolerances · mandatory hourly-check
reminders · Job# lookup with consolidated record · one-tap SQF PDF (Print) · **CSV export of jobs &
defects/waste** · dashboards (defect Pareto, waste, downtime, first-pass yield) · Business Central +
AVT import · hold/reject alerts · immutable audit trail · admin master-data editor.

---

*Golden Manufacturers Pte Ltd — built with Ateet Roshan (Quality Manager) & Sameer Mohammed Taki (AI Engineer).*
