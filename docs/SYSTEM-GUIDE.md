# Golden QA — System Guide

**Starkist Label In-Process Inspection System**
Golden Manufacturers Pte Ltd · Quality Department

This is the reference manual for the Golden QA application: what it is, how it's built,
every feature, who can do what, and how it's configured and deployed. Companion documents:
[KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md) (how-to + troubleshooting) and
[USER-TRAINING.md](USER-TRAINING.md) (role-based training).

---

## 1. What the system is

Golden QA is a **tablet-first Progressive Web App (PWA)** for in-process quality inspection of
the Starkist paper-label line. Every label job is keyed to a single **Job #** and tracked through
**three production stages**. Typing or scanning a Job # returns the full cross-stage record.

- **Runs on-premise** with zero external runtime dependencies (Node.js built-ins; PostgreSQL is
  optional for higher concurrency).
- **Works offline** on the floor — data entered offline is queued and synced when the network
  returns.
- **Audit-grade** — every action is recorded in a tamper-evident (HMAC-chained) audit trail.

## 2. Architecture at a glance

```
   Tablet / desktop browser (PWA, offline cache + sync queue)
                     │  HTTPS
                     ▼
              Traefik v3  (TLS, host routing)        ← shared reverse proxy
                     │  http :3000 (no host port)
                     ▼
        Golden QA app container  (Node.js HTTP server)
            ├── REST API  (/api/*)
            ├── static PWA  (public/)
            └── /metrics  (Prometheus)
                     │
                     ▼
        Storage (one JSON document):
            PostgreSQL (DATABASE_URL, production)  |  JSON file (dev / single-box)
```

- **Front-end:** a single-page app (`public/app.js`, `index.html`, `styles.css`) — no framework,
  no build step. Chart.js is loaded from a CDN for analytics (cached for offline).
- **Back-end:** one Node.js file (`server.js`) serving a JSON REST API and the static PWA.
- **Storage abstraction** (`integrations/storage.js`) stores the **entire database as a single
  JSON document**, so the data model is identical across the PostgreSQL and JSON-file drivers.
  Production uses **PostgreSQL** (`DATABASE_URL`); with no `DATABASE_URL` it uses a local
  `data/db.json` file with crash-safe atomic writes. Single-writer (one app container).
- **Integrations** live in `integrations/`: `entraId.js` (SSO), `email.js` (Resend API or SMTP), `notify.js`
  (Teams), `backup.js` (rotating snapshots), `webhooks.js` (outbound events).

## 3. The three inspection stages

| # | Stage | Form | Captures |
|---|-------|------|----------|
| 1 | **Printing** | F-040-A / F-016-E / F-027-A (per machine) | Job details, material, per-station print setup, machine settings, QC inspection (COF, print registration, GS1 barcode, scuff/tape tests) with **auto pass/fail vs tolerances**, photos |
| 2 | **Sheeting / Slitting** | PRD002 | Job run, rolls produced, random quality checks, **down-time** breakdown, remarks, photos |
| 3 | **Finishing & Release** | F-038-A | Header, **mandatory hourly QC checks**, rejection log, **final release decision** (Released / Hold / Rejected), on-screen **signature**, photos |

> **Reel Inspection (F-021)** was removed from the QA flow — it is the operator's record, not
> QA's. Historical F-021 data on existing jobs is preserved and shown read-only in the Job Lookup
> summary; internally its storage slot (`stage2`) is retained so old records and audit history
> stay intact.

**Rules enforced**
- **Stage-in-sequence:** a stage can only be marked *complete* after the previous one is complete.
- **Required fields:** marking a stage complete validates its mandatory fields (server + client).
- **Release decision:** a Stage-4 decision of Hold/Rejected sets the job status and fires alerts.

## 4. Feature catalogue (by sidebar section)

**Overview**
- **Dashboard** — KPI cards (total / in-progress / released / hold-reject), searchable & filterable
  job list (by status, machine), CSV export.
- **Executive** *(manager+)* — KPIs scored **Red/Amber/Green vs configurable targets**
  (first-pass yield, open CAPAs, overdue calibrations, hold/reject) plus action lists
  (overdue CAPAs, overdue/due-soon calibrations, current holds). Print/PDF.

**Inspection**
- **New Job** — create a job (machine + Job #, barcode scan, customer/product).
- **Data Entry** — open a job and fill stages 1–3 (forms, photos, signature). Edit/Clone/Hold/Delete/Raise-CAPA from the header (role-gated).
- **Job Lookup** — type/scan a Job # → consolidated cross-stage record; one-tap **SQF PDF** (print).

**Quality**
- **CAPA** — corrective & preventive actions: severity, owner, due date, root cause, corrective &
  preventive actions, status (Open / In Progress / Closed), **SLA escalation** on overdue, and
  **effectiveness verification**.
- **NCR** — non-conformance reports: disposition (use-as-is / rework / reject / return / scrap),
  severity, status; **promote an NCR to a linked CAPA** in one click.
- **Checklists** — standalone daily/periodic checklists (Pre-Operational Hygiene **F-012-G** daily;
  GMP **F-013B** monthly, 6 sections / 59 items; and any others). Each submission is a dated record
  with **two-person sign-off** (Completed by → **Verified by** a different Supervisor+). Items and
  sections are **admin-editable** in Settings → Checklist forms (a `## Section` line starts a
  section). Print a completed checklist as its SQF record.
  - **Photos** per submission and per line item (server-issued `/uploads/` URLs only; capped at 30 per
    submission, 8 per item).
  - **Instant e-mail** to Quality Manager + Supervisors + Administrators (deduped, plus configured
    digest recipients) on complete/verify, mirrored to Teams — fire-and-forget, no-ops when e-mail
    (Resend or SMTP) is not configured. Emits a `checklist.completed` webhook.
  - **Due-tracking** — `GET /api/checklists/due` returns per-form status (`done`/`due`/`overdue` for
    daily before the per-form `dueByHour` cut-off, default noon; `done`/`due`/`scheduled` for monthly,
    "due" in the final week). "Today" is resolved in the plant timezone (`APP_TZ`, default
    `Pacific/Fiji`). An hourly `checkChecklistReminders` job e-mails outstanding items (deduped per
    form+period).
- **Equipment** — equipment & calibration register (machines, anilox, gauges, verifiers, scales):
  calibration interval, **status auto-computed** (OK / Due soon / Overdue / Retired). "Record
  calibration" captures the **F-009 Calibration Recording Form** — reference-vs-machine-output
  readings, pass/fail, sticker, next-due, out-of-service. The **calibration history is extractable
  at any time** (per-item **History** view, `calibration-history.csv`, and an Excel sheet).
- **SPC** — statistical process control chart for COF or print registration: mean, ±3σ control
  limits, spec limits, **Cp/Cpk** capability, out-of-limit points.

**Reports**
- **Reports** — live analytics: defect Pareto, waste by machine, down-time, first-pass yield, a
  **quality trend** line, **date-range / shift filters**, CSV + **Excel** export, e-mail digest.
- **Suppliers** — supplier scorecards: jobs, released, hold/reject, FPY, defect & waste kg.

**Settings**
- **Team & Access** *(manager+)* — users, roles, and **per-user stage qualifications**. Quality
  Managers/Administrators get a **Reset link** button on local accounts (a one-time password-reset
  link to copy, or to e-mail when e-mail (Resend or SMTP) is configured); a **Reset requested** tag
  marks users who asked via *Forgot password?*.
- **Amendments History** *(manager+)* — the audit trail, now with **field-level before → after** for
  every change (who / when / which field / old value → new value). Filter by record ID, job, type or
  date; **export to CSV**; or open one record's history via the **Amendments** button on any job,
  CAPA, NCR, equipment item or checklist. **Verify integrity** checks the HMAC chain. Records stay
  editable (nothing hard-locks) — every amendment is captured instead.
- **Integrations** *(admin)* — read-only **REST API keys**, outbound **webhooks**, metrics info.
- **Settings** *(manager+)* — tolerances, KPI targets, **competency enforcement** toggle, defect
  list, **backups & storage**, **restore from backup** (admin, JSON storage).
- **My Account** — profile and password change.
- **Sign-in screen** — **Forgot password?** requests a reset: e-mailed link when the account has an
  e-mail address and e-mail is configured, otherwise the managers are flagged/alerted (see §8).

## 5. Roles & permissions

Four roles, increasing privilege: **QA Officer → Supervisor → Quality Manager → Administrator**.

| Capability | QA Officer | Supervisor | Quality Manager | Administrator |
|---|:--:|:--:|:--:|:--:|
| View dashboards, reports, lookup, SPC, suppliers | ✅ | ✅ | ✅ | ✅ |
| Create / clone jobs, enter & complete stages, upload photos | ✅ | ✅ | ✅ | ✅ |
| View CAPA / NCR / Equipment | ✅ | ✅ | ✅ | ✅ |
| Change own password · request a reset (*Forgot password?*) · use a reset link | ✅ | ✅ | ✅ | ✅ |
| Edit job details, place **Hold** | – | ✅ | ✅ | ✅ |
| Create/update **CAPA**, **NCR**, **Equipment**, calibrations | – | ✅ | ✅ | ✅ |
| Edit master data (tolerances, targets, defect list, competency toggle) | – | ✅ | ✅ | ✅ |
| **Executive** dashboard, **Audit verify**, send digest, backups status | – | ✅ | ✅ | ✅ |
| Manage **users**, delete jobs | – | – | ✅ | ✅ |
| Issue a **password reset link** (local accounts; for an Administrator account: Administrator only) | – | – | ✅ | ✅ |
| **API keys**, **webhooks**, **restore from backup** | – | – | – | ✅ |
| Bypass competency gating | – | – | – | ✅ |

> **Competency gating** (opt-in, Settings): when on, a stage sign-off is blocked unless the signer
> has that stage in their **qualified stages** (set per user in Team & Access). Administrators bypass.

**Sign-in:** local **Active Directory** (LDAPS) is the recommended production method — users enter
their AD username + password, verified against a domain controller, and their **AD security groups**
map to app roles (`ldap.roleGroups`; highest role wins, no matching group = denied). AD users are
provisioned/refreshed automatically on each login and have no local password. Local accounts
(salted **scrypt**) remain for a break-glass admin and are checked first, so an admin can always sign
in even if the DC is down. Cloud **Microsoft Entra ID** SSO is also available but off by default.
See `deploy/AD-SSO-SETUP.md`.

## 6. Data model

The database is one JSON document with these collections:

| Collection | Holds |
|---|---|
| `users` | id, name, role, scrypt salt+hash, `qualifiedStages[]`, email, source (`local`/`ad`), `resetRequestedAt` (pending *Forgot password?* request; cleared when the password changes or the user signs in with their password) |
| `jobs` | jobNo, machine, customer, product, created, `stage1..4`, `statusOverride` |
| `capas` | id, jobNo, title, severity, status, root cause, actions, owner, dueDate, effectiveness, escalation |
| `ncrs` | id, jobNo, description, disposition, severity, status, `capaId` link |
| `equipment` | id, name, type, model, serial, machine, calibratedOn, intervalDays, nextDueOverride, `history[]` = {on, technician, result, readings[], sticker, nextDue, outOfService, comments} (status computed) |
| `checklistDefs` | id, code, title, frequency, responseType, `dueByHour` (daily cut-off, default 12), `items[]` {key,label,header}, requireVerify (admin-editable form templates) |
| `checklists` | id, defKey, code, date, shift, `responses[]` {itemKey,status,correctiveAction,`photos[]`}, `photos[]`, completedBy, **verifiedBy/verifiedAt**, status (Draft/Completed/Verified) |
| `apikeys` | id, name, prefix, **keyHash** (sha256), scopes, active |
| `webhooks` | id, url, events[], secret, lastStatus |
| `masterdata` | machines, defectTypes, products, tolerances, KPI targets, competencyEnforced |
| `audit` | ts, user, action, recordType, recordId, jobNo, detail, **`changes[]` {field,from,to}**, `v`, **hash** (HMAC chain) + `auditAnchor` |

Photos and signatures are stored as files under `data/uploads/`.

## 7. Configuration (`config.json`)

| Key | Purpose |
|---|---|
| `port` / `host` | Server address (default `3000` on all interfaces) |
| `orgName` | Organisation name shown in the UI and reports |
| `ldap` | Local Active Directory (LDAPS) sign-in — `enabled` + `LDAP_*` env + `roleGroups` group→role map (`deploy/AD-SSO-SETUP.md`) |
| `sso` | Cloud Microsoft Entra ID sign-in (off by default). Fill `tenantId`/`clientId` to require real Entra ID `id_token` validation (`deploy/ENTRA-SSO-SETUP.md`) |
| `notify.email` | SMTP for hold/reject alerts + digests (`secure:true`=465 implicit TLS, `false`=587 STARTTLS). Resend is configured by env only (`RESEND_API_KEY`, below) — never put the key here |
| `notify.teamsWebhookUrl` | Microsoft Teams Incoming Webhook for alerts/digest |
| `tolerances` | COF min/max, registration max (mm), barcode min grade — drive auto pass/fail and SPC limits |
| `storage` | Ignored when `DATABASE_URL` is set (production uses PostgreSQL); otherwise a local `data/db.json` file |
| `backup` | Rotating snapshots of `data/db.json`: `intervalMin`, `keep` |
| `security` | Login throttle: `maxLoginFails`, `windowMin`, `lockMin` |
| `reports` | Scheduled digest: `schedule` (off/daily/weekly/monthly), `hour`, `dayOfWeek`, `dayOfMonth` |

**Environment overrides** (for container deploys): `PORT`, `HOST`, `NODE_ENV=production`,
`SECRET_KEY` (required in prod — signs session tokens & the audit chain), `SESSION_HOURS`,
`DATABASE_URL` (enables PostgreSQL), `ADMIN_USERNAME` / `ADMIN_PASSWORD` (seed the first admin),
`BACKUP_DIR`, `METRICS_TOKEN`.

**E-mail** (alerts, digests, checklist e-mails, reset links): `RESEND_API_KEY` (Resend HTTP API —
recommended on Vercel) or `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` (relay)
turns it on; if both are set, Resend wins, and `SMTP_ENABLED=false` forces e-mail off. `EMAIL_FROM` is
the sender (required with Resend and must be on its verified domain, e.g. `Golden QA <qa@gml.com.fj>`;
`SMTP_FROM` is the older name, `EMAIL_FROM` wins), `NOTIFY_EMAIL_TO` the always-notify recipients.

**Password reset:** `PASSWORD_RESET_MINUTES` (lifetime of a self-service, e-mailed link; default
`30`), `PASSWORD_RESET_ADMIN_HOURS` (lifetime of a link issued from Team & Access; default `24`),
`APP_URL` (public base URL put in e-mailed links, e.g. `https://goldenqa.gml.com.fj`; if unset the
server uses `https://$VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets automatically, then
`https://$APP_HOST`). The base URL is **never** taken from the request's `Host` header (that would
let an attacker get reset e-mails pointing at their own site). E-mailed links need **all three** of:
e-mail configured (Resend or SMTP: `RESEND_API_KEY` or `SMTP_HOST`… / `notify.email`), a base URL,
and an e-mail address on the account — otherwise *Forgot password?* falls back to notifying the
managers, and Team & Access still issues copyable links. `GET /api/config` reports
`passwordReset.email` = e-mail enabled **and** a base URL
present, `passwordReset.minutes` = the e-mailed link lifetime (shown on the sign-in screen), and
`passwordReset.directory` = AD sign-in is on (the sign-in screen then says Windows passwords are reset
by IT).

## 8. Security

- **Authentication** — scrypt password hashing; stateless HMAC-signed session tokens (survive
  restarts, work across replicas); optional Microsoft Entra ID `id_token` verification.
- **Login brute-force lockout** — N failed attempts per username+IP lock that login for a cool-off
  window (`config.security`); failures are audited; locked attempts get HTTP 429.
- **Password reset links** — HMAC-signed like session tokens but with a separate derived key
  (`HMAC(SECRET_KEY, 'pwreset-v1')`), so a reset token is never accepted as a session and vice versa.
  Each carries the account's password-hash version and role: it works **once** (dies the moment the
  password changes, which also signs out every existing session), dies if the account's role changes
  (so the "Administrator accounts: Administrator only" rule can't be side-stepped by a promotion after
  issue), and expires (30 min e-mailed / 24 h admin-issued by default). Issuing a new link does **not**
  cancel earlier ones — to kill a leaked link, set a new password. Links use a `#reset=` URL fragment
  so the token never reaches server logs or a `Referer`; the app strips it from the address bar, but
  the browser's own history still records the URL, so an unused link on a shared device stays usable
  until it expires (lower `PASSWORD_RESET_ADMIN_HOURS` for shared-tablet sites). Only active local
  accounts qualify (not AD, not archived). *Forgot password?* always answers the same generic 200 and
  does the same work for every outcome (an audit entry + a save), so the body and the timing don't
  reveal accounts; with e-mail on, where a real account with an e-mail address also waits on the send,
  every answer is held to at least 3 s — only a mail server slower than that still shows in the
  timing. It is throttled per IP (5 / 15 min → 429) and per account (one e-mail/alert per 5 min). A
  request records `resetRequestedAt` (shown as **Reset requested** in Team & Access until the password
  changes or the user signs in); when no link could be e-mailed it also alerts managers: by e-mail
  when e-mail is on (to `NOTIFY_EMAIL_TO`, or `config.json` `notify.email.to` if that is unset, so
  someone is always e-mailed) and via Teams if configured (Teams is best-effort on serverless). Only
  with e-mail off and no Teams webhook is nobody pushed an alert. Requests,
  issued links and resets are all audited (`password-reset-request`, `issue-reset-link`,
  `password-reset`).
- **Tamper-evident audit trail** — each entry is HMAC-chained (key = `SECRET_KEY`) to the previous;
  `GET /api/audit/verify` (or the **Verify integrity** button) detects any edit/insert/delete and
  names the broken entry. Strength depends on `SECRET_KEY` staying secret.
- **RBAC** — see §5. **API keys are read-only** (GET) and scoped to operational data.
- **Competency gating** — optional sign-off gate by qualification (§5).
- Run behind **HTTPS** (Traefik/Caddy/nginx) so the camera, PWA install and credentials are secure.

## 9. Integrations & automation

- **Microsoft Entra ID SSO** — `deploy/ENTRA-SSO-SETUP.md`.
- **Alerts** — hold/reject events and the manager digest go to Teams (webhook) and/or e-mail (Resend or SMTP).
- **Scheduled reports** — automatic digest on a daily/weekly/monthly cadence (`config.reports`).
- **REST API keys** — `x-api-key: gqa_…` header, **read-only**, for BI tools. Manage in Integrations.
- **Webhooks** — signed JSON POST (`X-GQA-Signature` HMAC) on `job.released`, `job.hold`,
  `capa.opened`, `capa.closed`, `equipment.calibrated`.
- **Prometheus `/metrics`** — jobs, FPY, open/overdue CAPAs, equipment, overdue calibrations, uptime.
  Optional `METRICS_TOKEN`.

## 10. Backups & restore

- Rotating snapshots of `data/db.json` are written to `data/backups/` on a timer (`config.backup`).
- **Restore** (Administrator, JSON storage): Settings → *Restore from backup* takes a safety
  snapshot of current data first, then swaps in the chosen snapshot.
- Always copy backups **off the box** (a backup on the same disk is not a backup). For PostgreSQL,
  use the `db-backup` sidecar's nightly `pg_dump` (see `CONTAINER-DEPLOY.md`).

## 11. Deployment

- **On-prem (simple):** `node server.js` → `http://<server-ip>:3000`. See `DEPLOYMENT.md`.
- **Container (production):** Portainer **GitOps** + Traefik v3 — see `CONTAINER-DEPLOY.md`.
  Portainer polls `main` and redeploys on each new commit; Traefik terminates TLS and routes by host.
- **CI:** `.github/workflows/ci.yml` runs `node --check` on all JS plus the smoke tests
  (`npm test`: API, AD sign-in, reset e-mail over a stub SMTP server, and the Resend transport
  against a stub Resend API) on Node 20 & 24 for every PR/push to `main`.

## 12. REST API reference (summary)

All endpoints are under `/api`. Auth: `x-token: <session>` (login) or `x-api-key: gqa_…` (read-only).

| Method & path | Purpose | Min role |
|---|---|---|
| `POST /api/login` | Username/password or SSO sign-in | – |
| `GET /api/config` | Public sign-in config (org name, SSO/Clerk flags, `passwordReset.email` / `.minutes` / `.directory`) | – |
| `POST /api/password/forgot` `{identifier}` | *Forgot password?* — username or e-mail; always `200 {ok:true}` (e-mails a link or flags the managers; held to ≥ 3 s when e-mail is on); `429` if throttled | – |
| `POST /api/password/reset/check` `{token}` | Validate a reset link → `{ok, user:{id,name}}`; `400` if invalid/expired/used | – |
| `POST /api/password/reset` `{token, password}` | Set a new password (min 6) via a reset link → `{ok, token, user}` (signed in; old sessions end) | – |
| `POST /api/admin/users/:id/reset-link` `{email?}` | Issue a one-time reset link → `{ok, token, expiresAt, emailed}` (client builds `<origin>/#reset=<token>`); `email:true` also e-mails it. Administrator accounts: Administrator only; AD → `400`, archived → `409` | QM |
| `GET /api/me` · `POST /api/me/password` | Profile · change password | authed |
| `GET /api/jobs` · `GET /api/jobs/:no` | List · fetch a job | authed |
| `POST /api/jobs` · `POST /api/jobs/:no/clone` | Create · clone | authed |
| `PUT /api/jobs/:no` · `DELETE /api/jobs/:no` | Edit metadata · archive (hide, keep record; `GET /api/jobs?archived=1` lists archived) | Supervisor · QM |
| `POST /api/jobs/:no/restore` | Restore an archived job | QM |
| `PUT /api/jobs/:no/stage/:n` | Save/complete a stage | authed (+competency) |
| `POST /api/jobs/:no/hold` | Place on hold | Supervisor |
| `POST /api/upload` | Photo/video/document/signature upload (video ≤ 45 MB, document ≤ 20 MB: PDF/Word/Excel) | authed |
| `GET/POST/PUT /api/capas[/:id]` | CAPA list/create/update (`GET ?archived=1` lists archived) | view: authed · write: Supervisor |
| `DELETE /api/capas/:id` · `POST /api/capas/:id/restore` | Archive (hide, keep record) · restore | Supervisor |
| `GET/POST/PUT /api/ncrs[/:id]` · `POST /api/ncrs/:id/capa` | NCR + promote (`GET ?archived=1` lists archived) | view: authed · write: Supervisor |
| `DELETE /api/ncrs/:id` · `POST /api/ncrs/:id/restore` | Archive (hide, keep record) · restore | Supervisor |
| `GET/POST/PUT /api/equipment[/:id]` · `POST /api/equipment/:id/calibrate` | Equipment + calibrate (`GET ?archived=1` lists archived) | view: authed · write: Supervisor |
| `DELETE /api/equipment/:id` · `POST /api/equipment/:id/restore` | Archive (hide, keep history) · restore | Supervisor |
| `GET /api/equipment/:id/history` · `GET /api/equipment/calibration-history.csv` | Calibration history + CSV extract (archived items included) | authed |
| `GET /api/checklist-defs` · `POST/PUT/DELETE /api/checklist-defs[/:id]` · `POST /api/checklist-defs/:id/restore` | Checklist form templates (delete = archive; `GET ?archived=1` lists archived) | view: authed · write: Supervisor |
| `GET/POST /api/checklists[/:id]` · `PUT /api/checklists/:id` · `POST /api/checklists/:id/verify` | Checklist submissions · verify (2nd person) (`GET ?archived=1` lists archived) | authed · verify: Supervisor |
| `DELETE /api/checklists/:id` · `POST /api/checklists/:id/restore` | Archive (hide, keep record; re-arms due status) · restore | Supervisor |
| `GET /api/checklists/due` | Per-form due status (daily before-noon / monthly month-end) | authed |
| `GET /api/analytics` · `GET /api/spc` · `GET /api/suppliers` | Analytics / SPC / suppliers | authed |
| `GET /api/exec` | Executive RAG summary | Supervisor |
| `GET /api/audit[?recordId=&jobNo=&recordType=&from=&to=]` · `GET /api/audit/export.csv` · `GET /api/audit/verify` | Amendments History (field-level) · CSV export · integrity check | Supervisor |
| `GET /api/masterdata` · `PUT /api/masterdata` | Master data | view: authed · write: Supervisor |
| `GET/POST/PUT/DELETE /api/admin/users[/:id]` · `POST /api/admin/users/:id/restore` | User management (delete = archive: sign-in blocked, sessions killed; `GET ?archived=1` lists archived) | GET: Supervisor · write: QM |
| `GET /api/admin/backups` · `POST /api/admin/restore` | Backups · restore | Supervisor · Administrator |
| `GET/POST/DELETE /api/admin/apikeys[/:id]` | API keys | Administrator |
| `GET/POST/DELETE /api/admin/webhooks[/:id]` | Webhooks | Administrator |
| `GET /api/export/jobs.csv` · `GET /api/export/workbook.xls` | CSV · Excel export | authed |
| `GET /api/digest` · `POST /api/digest/send` | Build · send digest | authed · Supervisor |
| `GET /metrics` | Prometheus metrics | open / `METRICS_TOKEN` |

---

*Golden Manufacturers Pte Ltd — built with Ateet Roshan (Quality Manager) & Sameer Mohammed Taki (AI Engineer).*
