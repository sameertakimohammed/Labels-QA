# Cloud deployment — Vercel + Supabase + Clerk

This is the **cloud** deployment of Golden QA: the same application code that runs on-prem
(`server.js`), adapted to run as a **Vercel serverless function** with **Supabase Postgres +
Storage** and **Clerk** sign-in. The on-prem/container path (Docker, LDAP, local disk) still works
unchanged — see [DEPLOYMENT.md](DEPLOYMENT.md) / [CONTAINER-DEPLOY.md](CONTAINER-DEPLOY.md).

> **⚠️ Clerk is currently disabled.** The app signs in with **local accounts** (username +
> password) — plus Active Directory if you configure it. Clerk stays off even when the
> `CLERK_*` keys are present; to turn it back on later set **`CLERK_ENABLED=true`**. The rest of
> this document describes the full Clerk setup for when you re-enable it.

```
 Tablet / browser ──HTTPS──▶ Vercel (static PWA + /api/* serverless function)
                                   │
              Clerk (sign-in) ◀────┤  identity only; roles live in-app, matched by e-mail
                                   │
       Supabase Postgres ◀─────────┤  system of record (single JSON document in app_state)
       Supabase Storage  ◀─────────┘  photos & signatures (qa-uploads bucket)
       Vercel Cron ───────────────▶ GET /api/cron  (CAPA SLA, reminders, scheduled digest)
```

## What changed from the on-prem build

| Concern | On-prem | Cloud |
|---|---|---|
| Process | long-running `node server.js` | `server.js` handler exported through `api/index.js`; `vercel.json` rewrites all routes to it |
| Auth | local scrypt + AD/LDAP + Entra | **Local accounts** (username + password, scrypt) — same as on-prem; AD/LDAP still optional. *Clerk is available but off by default:* set `CLERK_ENABLED=true` to have the browser sign in with Clerk, post its session token to `POST /api/login {mode:"clerk"}`, and match the e-mail to a user record. **Roles always stay in-app** (Admin → Users). |
| Database | Postgres or JSON file | **Supabase Postgres**, same single-`jsonb`-document model (`app_state`) |
| Write safety | one process = one writer | serverless has many workers, so each mutating request holds a **Postgres advisory lock** and reloads the document fresh — no lost updates |
| Uploads | local disk `data/uploads` | **Supabase Storage** (`qa-uploads`, public-read); the endpoint returns the public URL |
| Hourly jobs | 3 `setInterval` timers | **Vercel Cron** → `GET /api/cron` (hourly) |
| E-mail | SMTP relay (`SMTP_*`) | **Resend** HTTP API (`RESEND_API_KEY`) — one HTTPS call per message, no SMTP session held open in a serverless function. SMTP still works |
| Backups | file rotation timer | **Supabase** automatic backups / PITR (the in-app file backup/restore is disabled on Postgres) |

## Prerequisites

- A **Vercel** account/team.
- A **Supabase** project (this deploy reuses the existing `fibre-mold-plant` project; the app's
  data lives in its own `app_state` table + `qa-uploads` bucket, isolated from that app's tables).
- A **Clerk** application (create it at <https://dashboard.clerk.com>).

## 1. Supabase (already provisioned)

Created for you in the shared project:
- `public.app_state` — the single-document store (RLS enabled; only the direct `postgres`
  connection can touch it).
- `qa-uploads` — a public-read Storage bucket for photos/signatures.

You provide two values from the Supabase dashboard:
- **`DATABASE_URL`** — Project → Settings → Database → *Connection string* → **Session pooler**
  (port **5432**). Replace `[YOUR-PASSWORD]` with the database password. Session mode is required:
  the write-serialising advisory lock needs a client pinned to one backend.
- **`SUPABASE_SERVICE_ROLE_KEY`** — Project → Settings → API → **service_role** secret (used
  server-side to upload to Storage; never shipped to the browser).

`SUPABASE_URL` is `https://lrctnozzqxoiqacdjvhy.supabase.co` (the **Labels-QA** Supabase project).

## 2. Clerk

1. Create an application in the Clerk dashboard; enable the sign-in methods you want (e-mail
   code, Google, Microsoft, etc.).
2. Copy the **Publishable key** (`pk_…`) and **Secret key** (`sk_…`) from **API Keys**.
3. Add your Vercel domain(s) under Clerk → **Domains** (production) so Clerk.js loads there.
4. Create a user for each staff member (or let them self-serve if you enable sign-up), then in
   the app go to **Admin → Users** and add each person's e-mail with the right role and stage
   competencies. Sign-in matches Clerk → app user **by e-mail**.

## 3. Environment variables (Vercel → Settings → Environment Variables)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **session pooler** URI (port 5432), password filled in |
| `SUPABASE_URL` | `https://lrctnozzqxoiqacdjvhy.supabase.co` *(the Labels-QA project)* |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role secret |
| `SUPABASE_STORAGE_BUCKET` | `qa-uploads` |
| `CLERK_ENABLED` | *omit / `false`* — Clerk is **off**; set `true` only to re-enable Clerk sign-in |
| `CLERK_PUBLISHABLE_KEY` | `pk_…` *(only needed when `CLERK_ENABLED=true`)* |
| `CLERK_SECRET_KEY` | `sk_…` *(only needed when `CLERK_ENABLED=true`)* |
| `CLERK_ALLOWED_DOMAIN` | `golden.com.fj` *(optional e-mail allow-list, Clerk only)* |
| `SECRET_KEY` | 48-byte random (signs session tokens + the audit chain) |
| `ADMIN_USERNAME` | `admin` (the local sign-in username) |
| `ADMIN_PASSWORD` | strong password (**the** local admin login) |
| `ADMIN_EMAIL` | optional; the e-mail matched to the seed admin if Clerk is re-enabled |
| `CRON_SECRET` | 48-byte random (authenticates Vercel Cron → `/api/cron`) |
| `RESEND_API_KEY` | *optional, recommended* — turns on e-mail through the [Resend](https://resend.com) API: hold/reject alerts, the manager digest, checklist e-mails and **e-mailed password-reset links**. Use a **sending-only** key restricted to `gml.com.fj` (see below). Without e-mail, *Forgot password?* flags the user as **Reset requested** in Team & Access and a Quality Manager/Administrator hands them a copyable reset link |
| `EMAIL_FROM` | `Golden QA <qa@gml.com.fj>` — the sender. **Required with Resend** and must be on the verified `gml.com.fj` domain (Resend rejects any other sender, including the `config.json` default) |
| `APP_URL` | `https://qa.gml.com.fj` — public base URL put in e-mailed reset links. If unset it falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL` (a Vercel system variable); set it to pin the custom domain. Never derived from the request `Host` header |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_SECURE` · `SMTP_USER` · `SMTP_PASS` · `SMTP_FROM` | *optional alternative to Resend* — an SMTP relay instead. If both are set, **Resend wins**. `SMTP_FROM` still works as the sender (`EMAIL_FROM` wins) |
| `PASSWORD_RESET_MINUTES` · `PASSWORD_RESET_ADMIN_HOURS` | *optional* — reset-link lifetimes (default 30 min for e-mailed links, 24 h for links issued in Team & Access) |
| `TEAMS_WEBHOOK_URL` · `NOTIFY_EMAIL_TO` | *optional* — push alerts (hold/reject, CAPA, and *Forgot password?* requests that couldn't be e-mailed) to a Teams channel and/or a comma-separated list of manager e-mails (the latter needs e-mail configured: `RESEND_API_KEY` or `SMTP_*`). With e-mail on, alert and digest e-mails go to `NOTIFY_EMAIL_TO`, or — if it is unset — to `config.json` `notify.email.to` (currently `ateet@golden.com.fj`), so someone is always e-mailed. Only with e-mail off and no `TEAMS_WEBHOOK_URL` is **nobody alerted** — requests then only show in Team & Access |

Generate secrets with: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

### Turning on e-mail (Resend)

`gml.com.fj` is already verified in the Resend account with sending enabled.

1. Resend → **API Keys** → **Create API key**: permission **Sending access**, domain **`gml.com.fj`**.
   Copy the `re_…` key (it is shown only once) — never commit it or paste it into `config.json`.
2. Vercel → **Settings → Environment Variables**, environment **Production**: add `RESEND_API_KEY`
   (the key; mark it *Sensitive*), `EMAIL_FROM` = `Golden QA <qa@gml.com.fj>`,
   `APP_URL` = `https://qa.gml.com.fj` and `NOTIFY_EMAIL_TO` = the managers who should receive
   alerts and the digest (comma-separated). If `NOTIFY_EMAIL_TO` is unset they go to `config.json`
   `notify.email.to` (currently `ateet@golden.com.fj`).
3. **Redeploy** the latest production deployment — env changes only reach new deployments.
4. Test: **Reports → ✉ Email digest to managers** (goes to `NOTIFY_EMAIL_TO`, or `config.json`
   `notify.email.to` if unset), and *Forgot password?* for an account that has an e-mail address.
   Check delivery under Resend → **Emails**; a rejected send shows as `Resend <status>: <message>`
   in the app's error message or the Vercel runtime logs.

## 4. Deploy

Import the repo in Vercel (framework preset: **Other** — no build step). `vercel.json` wires the
function, the SPA/route rewrites, and the hourly cron. Push to the deployment branch and Vercel
builds automatically.

> **Vercel Cron & plan:** the hourly `0 * * * *` schedule in `vercel.json` needs a **Pro** plan.
> On **Hobby**, cron runs at most **once per day** — change the schedule to e.g. `0 20 * * *`
> (08:00 Fiji), or hit `GET /api/cron` with `Authorization: Bearer $CRON_SECRET` from an external
> scheduler (cron-job.org) for hourly reminders.

## 5. First sign-in

With Clerk off (the default), the sign-in screen shows the **local username + password** form:

1. Open the Vercel URL → sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. Add the rest of your team under **Admin → Users** (username + password + role + stage
   competencies). Existing accounts already in the database stay exactly as they were.

**Forgotten passwords:** users tap **Forgot password?** on the sign-in screen. With e-mail
configured (Resend, §3) and an e-mail address on their account (**Team & Access**), they are
e-mailed a one-time link to `APP_URL` (valid 30 min by default); managers can also send a link with
**E-mail it to …** in Team & Access. Otherwise — no e-mail address on the account, e-mail not
configured, or the send failed — the request shows as **Reset requested** in **Team & Access**, where a
Quality Manager/Administrator clicks **Reset link** and hands the person a one-time link (valid 24 h
by default). For those requests managers get a *Password reset requested* alert: by e-mail (to
`NOTIFY_EMAIL_TO`, or `config.json` `notify.email.to` if unset) when e-mail is configured, and in
Teams if `TEAMS_WEBHOOK_URL` is set. With neither, **nobody is alerted** — managers must check Team &
Access (the user is told to ask them). On Vercel every e-mail — alerts, checklist e-mails, cron
reminders and the scheduled report as well as the reset links — finishes sending before the response
goes out, so a frozen function can't drop it; only the Teams post is best-effort (it isn't awaited,
so a frozen function can drop it). A send that Resend rejects is logged, not retried. If no admin
can sign in at all, use the break-glass script
([Knowledge Base A4](docs/KNOWLEDGE-BASE.md#a4-forgot-your-password)).

*If you re-enable Clerk (`CLERK_ENABLED=true`):* the Clerk sign-in card appears instead; sign in
with the account whose e-mail equals `ADMIN_EMAIL`, and the local username/password form stays
available as a break-glass admin behind the **Administrator sign-in** link.

## Known limits of the lift-and-adapt

- **Write throughput** — the whole database is one JSON document and writes are globally
  serialised by the advisory lock. Correct and safe for a plant's tablet fleet (writes are
  short); it is not built for hundreds of concurrent writers. Growing past that calls for the
  relational rewrite (decompose `app_state` into real tables + RLS).
- **Document size** — each request loads the whole document; keep an eye on it as `audit`
  history grows (capped at `AUDIT_MAX`, default 20000). Export/prune audit history periodically.
- **Request body ≤ ~4.5 MB** — Vercel's limit; large photos should be captured at a reasonable
  resolution (the app sends them as base64 through `/api/upload`).
- **Migrating existing on-prem data** — copy the on-prem document into `app_state`
  (`INSERT INTO app_state (id, doc) VALUES (1, '<db.json contents>'::jsonb)`). Old photo
  references (`/uploads/…`) won't resolve in the cloud unless those files are also uploaded to
  the `qa-uploads` bucket.
