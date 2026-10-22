# Golden QA — User Training Guide

A role-based training programme for the Starkist label QA system. Pair this with the
[KNOWLEDGE-BASE.md](KNOWLEDGE-BASE.md) (quick how-tos) and [SYSTEM-GUIDE.md](SYSTEM-GUIDE.md)
(full reference). Suggested format: a 30–45 min hands-on session per role using a **training Job #**
(prefix real practice jobs with `TRN-` so they're easy to spot and remove).

---

## 0. Before you start (everyone)

**Learning outcomes:** sign in, navigate the app, and understand your role's responsibilities.

1. **Install the app** — open the site in your browser → **Add to Home Screen / Install**.
2. **Sign in** — username + password, or **Sign in with Microsoft 365**.
   - **Forgot your password?** Tap **Forgot password?** under **Sign in**, enter your username (or
     your account e-mail) → **Request reset**. If your account has an e-mail address and the server
     can send e-mail, a reset link arrives by e-mail (valid 30 minutes). Otherwise your request is
     flagged in **Team & Access** (managers only get a pushed alert if Teams / alert e-mail is set
     up) — so ask your **Quality Manager or Administrator** for a **reset link**.
   - **Using a reset link:** open it → type the new password twice (min 6 characters) → **Save new
     password**. You're signed straight in; the link works **once**, your old password stops
     working and any other device signed in as you is signed out. Never share a reset link; on a
     shared tablet finish the reset once you open it (the browser's history keeps the link until it
     is used or expires). **Cancel** leaves without changing anything.
   - Active Directory / Microsoft 365 accounts reset their password in the directory, not here.
3. **Orient yourself** — the left sidebar groups everything: **Overview · Inspection · Quality ·
   Reports · Settings**. The top-right shows your name/role, the online dot, and Logout.
4. **The golden rule:** everything is keyed to a **Job #**, tracked through **3 stages**, and every
   action is logged in a tamper-evident **audit trail**. Work carefully and honestly.

**Connectivity:** green dot = online. If it goes red, keep working — your entries queue and a
**"⤿ N to sync"** badge appears; they upload automatically when you reconnect.

---

## 1. QA Officer — *the inspector* (core training)

You capture inspection data on the floor. Daily flow: **create or open a job → complete each stage
→ photograph defects → sign off Stage 3 (Finishing & Release)**.

> Reel Inspection (F-021) is no longer part of the QA flow — it belongs to the operator. Historical
> F-021 entries on older jobs are still visible (read-only) in Job Lookup.

### 1.1 Create a job
**New Job →** select the **Printing Machine**, **scan (📷)** or type the **Job #**, confirm
customer/product → **Create Job & Begin Stage 1**.

### 1.2 Stage 1 — Printing
Fill Job Details, Material, Print Stations, Machine Settings, QC Inspection. Watch the **COF** and
**Print Registration** fields — they show a green ✓ or red ✗ against tolerance as you type.
Attach evidence on any stage form: photos, a short video clip (🎥, up to ~30 s), or a document
(📄 PDF/Word/Excel — e.g. a supplier CoA or customer spec). **Save Draft** anytime;
**Save & Mark Complete** when done.

### 1.3 Stage 2 — Sheeting / Slitting
Record rolls produced, random quality checks, and down-time hours. Complete with the required
fields (date, operator, start/finish). In the **Quality in Process Checks** table, Print Quality
(Pass/Fail), Varnish Position (Correct/Incorrect), Barcode Verification (Correct/Incorrect),
Sheet Appearance (Flat / Curling up / Curling down) and Sheet Stack Quality (Straight/Leaning)
are fixed drop-downs — pick the option that applies instead of typing "OK".

### 1.4 Stage 3 — Finishing & Release
- Add an **hourly check** each hour — the warning banner tells you when the next is due.
- Log any rejections, **sign** on the canvas (**Save signature**), and set the **Final Release
  Decision** (Released / Hold / Rejected).
- A decision of **Hold/Rejected** alerts the managers automatically.

### 1.5 Look up a record
**Job Lookup →** scan/type the Job # → **Search** → review all three stages → **📄 SQF PDF** to print.

> **Exercise (QA Officer):** create `TRN-101`, complete Stages 1–2 with sample data and one defect
> photo, then complete Stage 3 with two hourly checks, a signature, and a **Released** decision.
> Finally, look it up and print the SQF PDF.

**Checklist**
- [ ] I can create a job and scan a Job #.
- [ ] I can complete all three stages and read the tolerance auto-flags.
- [ ] I can add a photo and capture a signature.
- [ ] I understand stages must be completed in order.
- [ ] I can look up a job and print its SQF record.

---

## 2. Supervisor — *line quality control*

Everything a QA Officer does, **plus** managing exceptions and quality events.

### 2.1 Hold / edit / clone a job
Open a job in **Data Entry**; the header gives you **Edit details**, **Clone**, and **Hold** (with a
reason — this alerts managers). Use **Clone** to start a re-run job with the same setup.

### 2.2 Raise an NCR
**NCR → + Raise NCR** when an inspection finds a nonconformance: job, description, **disposition**
(use-as-is / rework / reject / return / scrap) and severity.

### 2.3 Raise / progress a CAPA
**CAPA → + Raise CAPA** (or **Raise CAPA** from a held job, or **promote an NCR**). Fill root cause
and corrective/preventive actions, set an **owner** and **due date**, and move it through
**Open → In Progress → Closed**. Overdue CAPAs escalate to managers automatically.

### 2.4 Equipment & calibration
**Equipment → + Add equipment** for gauges/anilox/verifiers; record calibrations with **Calibrate**.
Keep everything **OK** — overdue items show on the Executive dashboard and in the digest.

> **Exercise (Supervisor):** place `TRN-101` on **Hold** with a reason, raise an **NCR** for it,
> **promote** that NCR to a **CAPA**, assign yourself as owner with a due date, then record a
> calibration on a gauge in the Equipment register.

**Checklist**
- [ ] I can place a job on hold and edit/clone jobs.
- [ ] I can raise an NCR and promote it to a CAPA.
- [ ] I can own and progress a CAPA to closure.
- [ ] I can add equipment and record calibrations.

---

## 3. Quality Manager — *oversight & improvement*

Everything a Supervisor does, **plus** the management view, analytics, and people.

### 3.1 Executive dashboard
**Executive** shows **Red/Amber/Green** KPIs vs targets (first-pass yield, open CAPAs, overdue
calibrations, hold/reject) and action lists. Start your day here; use **📄 Print / PDF** for reviews.

### 3.2 Reports, trends & SPC
- **Reports** — filter by **date range / shift**; read the defect Pareto, waste, down-time, FPY and
  the **quality trend**. **Export CSV/Excel** or **e-mail the digest** to managers.
- **SPC** — check **Cp/Cpk** and control charts for COF and registration; investigate out-of-limit
  points.
- **Suppliers** — compare suppliers by FPY and defect/waste (ensure officers fill the Stage-1
  **Supplier** field).

### 3.3 People & qualifications
**Team & Access** — add users, set roles, and tick each person's **qualified stages**. Delete jobs
if necessary (recorded in the audit trail).

**Forgotten passwords:** a **Reset requested** tag next to a username means that person tapped
*Forgot password?* (it clears when they reset or sign in). Unless Teams / alert e-mail is set up,
nobody is pushed an alert — check **Team & Access** when someone says they're locked out. If e-mail
is set up and they have an e-mail address, they were probably e-mailed a link already — check with
them first. Otherwise click **Reset link** on their row → **Copy link** and hand it to them directly
(in person or a private message — whoever holds it can set the password). It works once and expires
in 24 hours; **E-mail it to …** appears when they have an e-mail address and e-mail is set up. You
never need to know or choose their new password. Only an Administrator can issue a link for an
Administrator account; AD / Microsoft 365 accounts are reset in the directory.
**Issuing a new link does not cancel earlier ones.** Shared a link by mistake? Set a temporary
password in **Edit** — any password change kills every outstanding link — then issue a fresh one.

### 3.4 Verify the audit trail
**Audit Trail → Verify integrity** before audits/reviews to prove the log hasn't been altered.

> **Exercise (Quality Manager):** set KPI targets in Settings, open the **Executive** dashboard and
> note any red items, run an **SPC** chart for COF, email the **digest**, then verify the **audit
> trail** integrity.

**Checklist**
- [ ] I can read the Executive RAG dashboard and act on red items.
- [ ] I can filter Reports and interpret SPC Cp/Cpk.
- [ ] I can manage users and assign stage qualifications.
- [ ] I can give a user a one-time password reset link (and see who has asked for one).
- [ ] I can verify audit-trail integrity.

---

## 4. Administrator — *system owner*

Everything above, **plus** configuration, integrations, and recovery.

### 4.1 Settings
- **Tolerances** — COF range, registration max, barcode grade (also drive SPC limits).
- **KPI targets** — thresholds for the Executive RAG scoring.
- **Competency control** — turn on to **block stage sign-off unless the signer is qualified**
  (set qualifications per user first; Administrators bypass).
- **Defect types** — maintain the defect picklist.

### 4.2 Integrations
- **API keys** — issue **read-only** keys for BI tools (copy once; revoke anytime).
- **Webhooks** — POST signed events (`job.released`, `job.hold`, `capa.opened`, `capa.closed`,
  `equipment.calibrated`) to other systems.
- **Metrics** — Prometheus at `/metrics` (set `METRICS_TOKEN` to require a token).

### 4.3 Backups & restore
Confirm rotating backups are running (Settings → Backups & storage). To recover, use **Restore from
backup** (takes a safety snapshot first, then replaces all data). Always copy backups **off the box**.

### 4.4 Security hygiene
- Change all **default passwords**; set a strong `SECRET_KEY` and `ADMIN_PASSWORD` (env).
- Keep the app behind **HTTPS**.
- Configure **Microsoft Entra ID SSO** (`deploy/ENTRA-SSO-SETUP.md`) for real Microsoft logins.
- Review the **login-lockout** thresholds (`config.security`).
- **Password resets** — reset links are one-time and short-lived; hand them only to the person.
  To have *Forgot password?* e-mail links automatically, configure SMTP (`SMTP_*`) and make sure the
  app knows its public address (`APP_URL`; on Vercel the production URL is used automatically).

> **Exercise (Administrator):** create a test user qualified for Printing only, turn on
> competency enforcement, confirm they're blocked on Sheeting / Slitting, issue a read-only API key
> and fetch `/api/jobs` with it, then disable enforcement and revoke the key.

**Checklist**
- [ ] I can configure tolerances, targets and the defect list.
- [ ] I can enforce competency and manage qualifications.
- [ ] I can issue/revoke API keys and add webhooks.
- [ ] I can run and restore backups.
- [ ] I understand the security checklist (HTTPS, secrets, SSO, lockout).

---

## 5. Quick reference card (print this)

**Sign in:** username + password, or *Sign in with Microsoft 365*. · **Forgot password?** under *Sign in* → ask your manager for a reset link if no e-mail arrives. · **Logout:** top-right.
**Online?** green dot = online; red = offline (work continues, syncs later — watch the **⤿ sync** badge).

| I want to… | Go to |
|---|---|
| Start a job | **New Job** |
| Enter/complete stages | **Data Entry** → job → stage tile → *Save & Mark Complete* |
| Add a defect photo | 📷 **Add photo** in any stage |
| Sign off & release | **Stage 3 (Finishing & Release)** → hourly checks → *Line Clearance* → sign (job releases when all 3 stages complete) |
| Find a job's full record | **Job Lookup** → scan/type → *SQF PDF* |
| Log a quality event | **NCR** (→ promote to **CAPA**) |
| Track corrective action | **CAPA** |
| Log/calibrate a gauge | **Equipment** → *Calibrate* |
| Check process capability | **SPC** |
| See KPIs vs targets | **Executive** *(manager)* |
| Filter & export data | **Reports** → CSV / Excel |
| Manage people | **Team & Access** *(manager)* |
| Give someone a password reset link | **Team & Access** → *Reset link* *(Quality Manager / Administrator)* |
| Prove the log is intact | **Audit Trail → Verify integrity** *(manager)* |

**Remember:** complete stages **in order**; fill **required fields**; **photograph** defects;
**hourly checks** in Finishing & Release are mandatory; everything you do is **audited**.

---

*Questions or training requests → Quality Manager (Ateet Roshan). System/setup → Administrator.*
