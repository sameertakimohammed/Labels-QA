# Golden QA — Knowledge Base

Practical how-to articles, FAQs, and troubleshooting for day-to-day use. For the full system
reference see [SYSTEM-GUIDE.md](SYSTEM-GUIDE.md); for structured training see
[USER-TRAINING.md](USER-TRAINING.md).

---

## A. Getting started

### A1. Open & install the app on a tablet
1. In Chrome/Edge/Safari, go to your site URL (e.g. `https://qa.gml.com.fj`).
2. Tap the browser menu → **Add to Home Screen / Install**. It opens full-screen like a native app.
3. After the first load it works **offline**; the dot top-right shows green (online) or red (offline).

### A2. Sign in
- **Username + password:** enter your username and password, tap **Sign in**.
- **Microsoft 365 / Entra:** tap **Sign in with Microsoft 365**. If real Entra SSO isn't configured
  yet, this asks for your `@golden.com.fj` e-mail (demo mode) — unknown e-mails get **QA Officer**
  access. For full role access before SSO is set up, sign in with your username/password instead.
- **Forgot your password?** Tap **Forgot password?** under **Sign in** — see **A4**.

### A3. Change your password
**My Account → Change password.** Enter current + new (min 6 characters) twice. (Microsoft 365
accounts manage their password in Microsoft, not here.)

### A4. Forgot your password
You can reset it yourself — nobody needs to know or type your new password.

1. On the sign-in screen tap **Forgot password?** (under **Sign in**).
2. Enter your **username** (or the e-mail address on your account) → **Request reset**.
3. What happens next:
   - Either way, a **Reset requested** tag appears next to your username in **Team & Access**.
   - **The server can send e-mail and your account has an e-mail address** → you get an e-mail
     *"Golden QA: reset your password"* with a link, valid for **30 minutes** — nothing else to do.
     Didn't ask for it? Ignore it — your password is unchanged.
   - **Otherwise** (most floor accounts have no e-mail) → **ask your Quality Manager or
     Administrator for a reset link**. Administrators are e-mailed an alert when e-mail (or Teams)
     is configured; Quality Managers just see the tag when they open Team & Access, so tell them.
4. Open the link → **Set a new password for *you*** → type the new password twice (min 6
   characters) → **Save new password**. You're signed straight in.

Good to know:
- The screen shows the **same message whether or not the username exists** — on purpose, so it
  can't be used to find out who has an account. Repeat requests for the same account within 5
  minutes are ignored; more than 5 requests in 15 minutes from the same network get *"Too many
  requests. Try again later."* — wait and retry, or ask a manager for a link.
- A link works **once**. It dies as soon as the password changes (by this link, **My Account →
  Change password**, or an admin) or the account's role changes, and expires on its own if unused.
- After a reset your **old password stops working** and **every other device signed in as you is
  signed out**.
- Remembered your password after asking? Just sign in — that withdraws the request (the **Reset
  requested** tag goes away).
- Opening a reset link always shows the reset screen — even on a shared tablet where someone else
  is still signed in. **Cancel** goes back without changing anything.
- The browser's **history keeps the link** until it is used or expires. On a shared tablet, finish
  the reset once you have opened a link (or ask a manager to cancel it — see below).
- **Active Directory / Microsoft 365 accounts** can't be reset here — reset them in the directory
  (with IT).

**Managers: give someone a reset link** *(Quality Manager / Administrator)* — **Team & Access →
Reset link** on that person's row. Copy the link (**Copy link**) and hand it to them **directly**
(in person, or a private message — never a group chat: whoever holds the link can set the
password). It works once and expires after **24 hours**. If the person has an e-mail address and
the server can send e-mail, **E-mail it to …** sends it for you. Only an Administrator can issue a
link for an Administrator account. Every request, link and reset is recorded in the audit trail.
With e-mail set up, a **Reset requested** person who has an e-mail address was probably e-mailed a
link already — check with them before issuing another.
**Issuing a new link does not cancel earlier ones.** To cancel a link shared by mistake, set a
temporary password in **Edit** (and give it to the person, or issue them a fresh link afterwards):
any password change kills every outstanding link for that account.
(Link lifetimes are set by `PASSWORD_RESET_MINUTES` / `PASSWORD_RESET_ADMIN_HOURS`; e-mailed links
need e-mail configured (Resend: `RESEND_API_KEY` + `EMAIL_FROM`, or SMTP: `SMTP_HOST`…) plus the
app's public address (`APP_URL`) — see [SYSTEM-GUIDE §7](SYSTEM-GUIDE.md#7-configuration-configjson).)

**Last resort — no admin can sign in at all** (e.g. the only admin forgot theirs and has no e-mail):
someone with access to the Docker host runs the break-glass reset inside the app container — it
prompts for the new password and works while the app is running:

```sh
docker exec -it -u node <app-container> node scripts/reset-password.js --list      # show usernames
docker exec -it -u node <app-container> node scripts/reset-password.js admin       # set a new password
```

**Vercel + Supabase:** there is no container to exec into, so run it from any computer with Node 18+
and a clone of this repo. Copy `DATABASE_URL` (Supabase session pooler, port 5432) and `SECRET_KEY`
from Vercel → Project → Settings → Environment Variables (and `PG_STATE_TABLE` if you set one):

```sh
npm ci
DATABASE_URL='postgresql://…:5432/postgres' SECRET_KEY='…' node scripts/reset-password.js --list
DATABASE_URL='postgresql://…:5432/postgres' SECRET_KEY='…' node scripts/reset-password.js admin
```

Use the same `SECRET_KEY` as production, or the audit chain check will flag the reset entry.
Local accounts only (AD / Microsoft 365 users reset in the directory). Existing sessions for that
user are signed out and the reset is recorded in the audit log. Note: changing `ADMIN_PASSWORD` in
the stack env does **not** reset anything — it only seeds the admin on a brand-new database.

---

## B. Inspection workflow

### B1. Create a new job
**New Job →** choose the **Printing Machine**, type or **scan (📷)** the **Job #**, set
customer/product → **Create Job & Begin Stage 1**.

### B2. Enter a stage
**Data Entry →** pick the job → tap the stage tile (1–3) → fill the form.
- **Save Draft** keeps your work without completing the stage.
- **Save & Mark Complete** validates required fields and marks the stage done.
- Stages must be completed **in order** (you can't complete Sheeting / Slitting before Printing).

### B3. Add a defect photo / capture a signature
- **Photos:** in any stage tap **📷 Add photo** (uses the camera on a tablet).
- **Signature (Finishing & Release):** sign on the canvas → **Save signature**. Required to complete the stage.

### B4. Record the three stages
1. **Printing** — material, print stations, machine settings, QC checks. COF and registration show
   a green ✓ / red ✗ **auto-flag** against tolerances as you type.
2. **Sheeting / Slitting** — infeed roll, in-process checks, production summary, waste summary, down-time.
3. **Finishing & Release** — add **hourly checks** (the banner reminds you when one is due), complete
   the **Line Clearance** (quantity on-hold, disposition, handover) and **sign**. The job is **Released**
   automatically once all three stages are complete; use **Hold** to stop a release.

> **Reel Inspection (F-021)** is the operator's record and is no longer part of the QA flow.
> Older jobs that carry F-021 data still show it (read-only) in Job Lookup.

### B5. Look up a job's full record
**Job Lookup →** type/scan the Job # → **Search**. You get every stage on one page. Tap
**📄 SQF PDF** to print/save the consolidated record.

### B6. Hold, edit, clone or delete a job *(role-gated)*
Open the job in **Data Entry**; the header has **Edit details**, **Clone**, **Raise CAPA**,
**Hold** (Supervisor+) and **Delete** (Quality Manager/Administrator).

---

## C. Quality modules

### C1. Raise & close a CAPA
**CAPA → + Raise CAPA.** Set title, severity, owner, due date, root cause, corrective & preventive
actions. To close: open it → set **Status = Closed**; afterwards set **Effectiveness**
(Verified / Not effective). Overdue open CAPAs are **escalated automatically** (Teams/e-mail).
> Tip: from a held/rejected job, use **Raise CAPA** in the Data-Entry header to pre-fill the Job #.

### C2. Raise an NCR and promote it to a CAPA
**NCR → + Raise NCR** (job, description, disposition, severity). To drive corrective action, click
**Raise CAPA** on the NCR — it creates a linked CAPA and records the link both ways.

### C3. Register equipment & record a calibration
**Equipment → + Add equipment** (name, type, machine, last-calibrated date, interval days). Status
is computed automatically: **OK**, **Due soon** (within 14 days), **Overdue**, **Retired**.
To recalibrate: **Calibrate →** date, result, interval, notes → **Save** (logged in history).

### C4. Read an SPC chart
**SPC →** pick **COF** or **Print registration**. You get the control chart (points + mean + ±3σ
UCL/LCL + spec USL/LSL), **Cp/Cpk** (Cpk ≥ 1.33 green, ≥ 1.0 amber, otherwise red) and a list of
any out-of-limit jobs. Needs at least 2 recorded readings.

---

## D. Reports & exports

### D1. Filter and export job data
**Reports →** set **From/To** dates and **Shift** to filter. **Export CSV** (raw rows) or
**Export Excel** (a multi-sheet `.xls` workbook: Jobs, CAPAs, Equipment, Suppliers).

### D2. Email the manager digest
**Reports → ✉ Email digest to managers** (Supervisor+) sends KPIs, holds, overdue CAPAs/calibrations
and top defects to the configured recipients (and Teams). To automate it, set `config.reports.schedule`.

### D3. Executive overview & PDF
**Executive** *(manager+)* shows KPIs scored Red/Amber/Green vs targets, plus action lists. Use
**📄 Print / PDF** for a one-page management summary. Targets are set in **Settings → KPI targets**.

### D4. Supplier scorecards
**Suppliers** ranks material suppliers by jobs, released, hold/reject, first-pass yield and
defect/waste kg (sourced from the Stage-1 **Supplier** field — fill it in to populate this).

---

## E. Administration

### E1. Add a user & set their stage qualifications
**Team & Access → + Add user** (manager). Set role and tick the **stages they may sign off**. The
qualified stages only bite when competency enforcement is on (see E2).

### E2. Turn on competency enforcement
**Settings → Competency control → tick the box → Save.** Now a stage sign-off is blocked unless the
signer is qualified for that stage. Administrators always bypass. Set qualifications per user first.

### E3. Set tolerances and KPI targets
**Settings → Tolerances** (COF range, registration max, barcode grade — these also drive SPC
limits) and **KPI targets** (FPY min, max open CAPAs / overdue calibrations / hold-reject for the
Executive RAG scoring).

### E4. Verify the audit trail
**Audit Trail → Verify integrity** (manager). Green = the HMAC chain is intact; red names the first
altered entry.

### E5. Issue / revoke an API key (read-only)
**Integrations → + New key** (Administrator). **Copy the key once** — it's never shown again. Apps
send it as `x-api-key: gqa_…` on GET endpoints. **Revoke** stops it immediately.

### E6. Add a webhook
**Integrations → + Add webhook** (Administrator): payload URL, optional secret (signs the body), and
the events to receive. Delivery status shows in the list.

### E7. Restore from a backup
**Settings → Restore from backup** (Administrator, JSON storage). Pick a snapshot → confirm. A
safety backup of current data is taken first. **This replaces all live data.**

### E8. Give someone a password reset link
**Team & Access → Reset link** on their row (Quality Manager / Administrator) → **Copy link** and
hand it to them directly. Rows showing **Reset requested** are people who tapped *Forgot password?*.
Full steps in **A4**.

---

## F. Offline use

- The app caches itself and the latest job data; you can keep inspecting offline.
- Changes made offline are **queued**; a gold **"⤿ N to sync"** badge appears top-right. They sync
  automatically when you're back online, or tap the badge to sync now.
- A queued change that the server later **rejects** (e.g., validation) is dropped with a notice —
  re-enter it.

---

## G. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| **"Too many failed attempts… try again in N min"** (429) | Login lockout after repeated wrong passwords. Wait out the cool-off, or an admin can restart the app (the throttle is in-memory). Forgot it entirely? See **A4** — resetting the password also lifts the lockout. |
| **"This reset link is invalid or has expired. Ask for a new one."** | The link was already used, has expired (30 min for an e-mailed link, 24 h for one from a manager), the password or the account's role was changed after it was issued, the account was archived, or the link got cut off when copied. Tap **Forgot password?** again or ask a manager for a fresh **Reset link** (**A4**). |
| **Asked for a reset but no e-mail arrived** | Your account has no e-mail address, the server has no e-mail (Resend or SMTP) or public address (`APP_URL`) configured, the send was rejected (e.g. `EMAIL_FROM` not on the Resend-verified domain — see the server log), or it went to spam. Without e-mail the request shows as **Reset requested** in Team & Access — ask a Quality Manager/Administrator for a reset link (**A4**). |
| **"Couldn't reach the server to check this link"** | The tablet is offline or the server didn't answer. The link isn't used up: reconnect and tap **Try again**, or open the link again later. |
| **No "Reset link" button on a user** | Only a Quality Manager/Administrator sees it; it's hidden on archived and Active Directory accounts, and on Administrator accounts unless you are an Administrator. |
| **"Not qualified to sign off Stage N"** (403) | Competency enforcement is on and you aren't qualified for that stage. An admin adds the stage in **Team & Access**, or an Administrator signs off. |
| **Charts are blank / "Charts need internet"** | Chart.js loads from a CDN on first use. Open the app online once; it's then cached for offline. |
| **Camera/scan doesn't work** | The camera needs **HTTPS**. Use the `https://` site (Traefik/Caddy), not plain `http://<ip>`. |
| **Microsoft 365 button just asks for an email** | Real Entra SSO isn't configured — that's demo mode. Set `sso.tenantId`/`sso.clientId` (`deploy/ENTRA-SSO-SETUP.md`). |
| **Signed in but menu is limited / no Executive/Settings** | You're a **QA Officer** (e.g., via demo SSO with an unknown e-mail). Sign in as a manager account, or have an admin set your role. |
| **Stage won't complete — "missing: …"** | Required fields aren't filled. The toast lists them; complete and retry. |
| **Stage won't complete — "Complete Stage X first"** | Stages are sequential; finish the earlier stage. |
| **Offline changes not syncing** | Check the network dot is green; tap the **sync badge**. A dropped item means the server rejected it — re-enter. |
| **Excel/CSV won't download** | Export needs to be online (it streams from the server). |

### Deployment (for IT)

| Symptom | Cause & fix |
|---|---|
| **Portainer: "Unable to retrieve stack file: Could not get the contents of the file 'docker-compose.traefik.yml'"** | Portainer's cached git clone is stale. **Pull and redeploy**; if it persists, **recreate the stack** (delete *without* removing volumes, re-add from Repository — same name reuses the data volume; keep the same `DB_PASSWORD`). |
| **New features not showing after a merge** | Portainer hasn't pulled the latest `main`. Trigger **Pull and redeploy** (GitOps polls every ~5 min). Confirm "Deployed Version" shows the new commit. |
| **App won't start in production** | `SECRET_KEY` must be ≥16 alphanumeric chars and `ADMIN_PASSWORD` must be set (first run). Check the container logs. |
| **`git ls-remote https://…/Labels-QA refs/heads/main` hangs on the host** | The host can't reach GitHub (firewall/DNS/proxy). Fix egress; Portainer can't deploy without it. |

---

## H. FAQ

**Is my data safe if the tablet loses connection mid-inspection?** Yes — it's queued locally and
syncs when you're back online.

**Can two people work the same job?** Yes, but on the same Job #; last save wins per stage. Use the
audit trail to see who changed what.

**How long are records kept?** Indefinitely in the database; set your SQF document-retention policy
and back up the `data/` folder (or PostgreSQL) regularly.

**Who can delete a job?** Only a Quality Manager or Administrator — and it's recorded in the audit
trail.

**What happened to Business Central?** The BC integration has been removed from this build. Jobs are
created manually (or scanned).

**Can I get the data into Power BI?** Yes — create a read-only **API key** (Integrations) and point
your tool at `/api/jobs`, `/api/analytics`, etc., with the `x-api-key` header.

**Does scheduling reports spam everyone?** Only the configured recipients, and only on the cadence
you set (`config.reports`); it's **off** by default.
