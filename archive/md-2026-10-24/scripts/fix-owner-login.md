# Fix the owner login — runbook

**Your password was never wrong. `demo1234` cannot work, and it never could.**

Two steps. Total time: about a minute.

---

## Step 1 — Run the SQL (this is the fix)

Open **Supabase Dashboard → SQL Editor → New query**. Paste the entire contents of
[`scripts/fix-owner-login.sql`](./fix-owner-login.sql) and hit **Run**.

**Read the `verdict` column. That is the whole answer.**

| verdict | email | role | status | active | org_slug | hash_len | hash_clean |
|---|---|---|---|---|---|---|---|
| `LOGIN WILL WORK` | `chris@fundhub.ai` | `owner` | `active` | `true` | `fundhub` | `90` | `t` |

- Any verdict other than `LOGIN WILL WORK` names the specific problem in the text of the
  cell. Re-run the file — it is safe to run as many times as you like.
- **More than one row?** A staff row for this email also exists in another org. The extra
  rows are labelled `IGNORED — this row is in org "x", not the login org` and are harmless;
  only the row whose `org_slug` matches can log in.
- **An error instead of a result?** The script has two guards that deliberately refuse to
  run and change nothing:
  - *"STOPPED — no org has slug 'fundhub'…"* — your `DEFAULT_ORG_SLUG` env var in Netlify
    is not `fundhub`. The error message lists the slugs that **do** exist in your database.
    Pick the right one and see the note below.
  - *"STOPPED — the email literal in this file has been altered…"* — a find-and-replace
    went too wide. Re-copy the file and try again.

> **If you have to change the org slug:** replace the quoted 9-character string
> `'fundhub'` — *single quotes included* — everywhere in the file. Do **not** replace the
> bare word: it also appears inside `'chris@fundhub.ai'`, and rewriting the email would
> create an account under an address nobody is signing in with. The script's second guard
> catches that mistake, but it is easier not to make it.

The script never invents an org. An earlier draft created the `fundhub` org when it was
missing; that silently produced a *second*, empty org, wrote the new staff row into it,
printed a perfect-looking confirmation, and left login still returning
*"Wrong email or password."* That failure mode is now impossible — the script aborts instead.

---

## Step 2 — Sign in

```
email:    chris@fundhub.ai
password: j32edOAlODrrRfT4H3GZ
```

The password box is no longer pre-filled — `demo1234` is gone from the form, and the page
now clears the browser's sticky demo mode on every load, so there is nothing to reset by
hand.

> **If the deployed page is still the old one** (the box arrives pre-filled with dots, or
> the copy still says *"demo1234 — pre-filled, just hit Sign in"*), the fix has not deployed
> yet. Clear the box, and open the console (F12) and run `localStorage.clear()` before
> signing in — the old `fh.js` answers `/api/auth/login` from a hardcoded table once demo
> mode engages, and your real password never leaves the browser.

You are in. Everything below is explanation and follow-up.

---
---

## Why this happened

Two independent faults, and only the first one blocked you.

### 1. `demo1234` is structurally impossible

`src/auth/hash.mjs` enforces a 12-character minimum in `hashPassword()`. `demo1234` is
8 characters. No code path in this repo — not the seeder, not the invite flow, not account
creation — can ever produce a stored hash for it. The login form pre-filled a password that
was guaranteed to fail, and advertised it as working. That pre-fill is now removed.

The backend was answering **HTTP 401 `invalid_credentials`** — correctly. It was telling
the truth the whole time.

### 2. The error message hid everything else

`public/login.html` collapsed every non-429/403 response into `"Wrong email or password."`,
so a missing table or a dead function would have read as a credential error. That is fixed
in this commit — real statuses now surface, and a 5xx says explicitly *"this is not your
password."*

### How we know it was a 401 and not a 500

This is worth recording, because the obvious hypothesis was wrong.

The site could not be reached from the diagnostic sandbox (egress policy returns
`403` on `CONNECT` to `fundhub.ai`, `*.netlify.app` and `*.supabase.co`), so we never got a
live status code. We proved it from the client code instead, by running the **pre-fix**
`fh.js` against a stubbed backend for every possible status.

The old `fh.js` fell through to demo mode on any status that was `404`, `>=500`, or any 4xx
other than 401 — and the demo table accepts `chris@fundhub.ai` / `demo1234`. So:

| Backend returned | What you would have seen |
|---|---|
| 400, 403, 404, 429, 500, 502, network failure | **Logged in** (silently, into demo mode) |
| **401** | **"Wrong email or password."** |

You saw the error message. Therefore the backend returned exactly 401, with a JSON body.
That single fact rules out — without needing to reach the site — a missing table, an
unapplied migration, a bad `DATABASE_URL`, an unreachable database, a missing `orgs` row,
a rate-limit lockout, and a suspended account. All of those would have logged you in.

> **Caveat, stated honestly:** this proof holds because you submitted the *pre-filled*
> `demo1234`. If you had typed the intended password instead, demo mode would have rejected
> it too and every backend fault would look identical. If you were not using the pre-fill,
> re-check with Step 3. Either way the repair in Step 1 is the same, and the rewritten
> client no longer renders any backend fault as a credential error — so a second wrong
> guess cannot cost you another round trip.

### Verification actually performed

Not assumed — executed, against a real PostgreSQL 16 cluster built for the purpose. Five
separate databases, each migrated from scratch and then repaired by the script:

| Database state | Result |
|---|---|
| Fresh, migrated, no staff row | inserts; `LOGIN WILL WORK`; run twice → still one row |
| Row damaged: `status='suspended'`, `active=false`, `role='Owner'`, bcrypt hash, 6 failed attempts queued | repaired; rate limiter cleared |
| A duplicate `chris@fundhub.ai` in a second org | correct row fixed, other row labelled `IGNORED` |
| `active` column dropped (012 never applied) | clean no-op, `active` reads `(column absent)` |
| Org slug is `fundhub-prod`, not `fundhub` | **aborts, writes nothing**, names the real slug |
| Naive find-and-replace corrupted the email literal | **aborts, writes nothing** |

In every database that the script was allowed to repair, the repo's own `login()` was then
called directly against it:

- `j32edOAlODrrRfT4H3GZ` → **OK 200**, `role=owner`, session token issued
- `demo1234` → **401 invalid_credentials** ← reproduces your exact symptom

The password hash was independently re-verified by loading it back out of the `.sql` file
and calling this repo's own `verifyPassword()`: `true` for `j32edOAlODrrRfT4H3GZ`, `false`
for `demo1234`, `needsRehash` `false`, length 90.

The rewritten client was replayed against a stubbed backend for every status, with both
the demo password and the real one. With the real password there is now **no** backend
fault that renders as *"Wrong email or password."* — 401 alone produces it; 500/502 say
*"this is not your password"*; a 404 or a dead network says *"Could not reach the server —
this is not your password."* instead of fabricating a credential rejection out of demo mode.

Full test suite: **2203 passing, 0 failing.**

---

## Step 3 — If it still fails

The error message is now honest (once this commit deploys). Read it literally:

| Message | Meaning | Action |
|---|---|---|
| *Wrong email or password.* | Genuine 401 | Step 1's verdict was not `LOGIN WILL WORK`, or the org slug is wrong |
| *Account not active — ask an admin.* | 403 | `status` or `active` is wrong — re-run Step 1 |
| *Too many attempts* | 429 | Wait 15 min, or re-run Step 1 (it clears the counter) |
| *Server error (HTTP 5xx) — this is not your password* | Backend fault | Check `/api/health` below |
| *Could not reach the server — this is not your password* | 404 / network | The function is not deployed |

Confirm the backend independently — this is unauthenticated, always returns 200, and costs
no rate limit:

```
curl -s https://fundhub.ai/api/health
```

Read `migrations` in the response:

- **`66`** — schema fully current.
- **`51`** — migrations 075–089 are missing (see below).
- `"state":"unreachable"` / `"unconfigured"` — `DATABASE_URL` problem, not a password problem.

---

## Step 4 — Separately: apply migrations 075–089

**This did not break your login** — verified: the login path touches only `orgs`, `staff`,
`auth_attempts`, `sessions`, `accounts` and `account_sessions`, and nothing in 075–089
alters any of them. But those 15 migrations are very likely missing from production,
because **nothing applies migrations automatically**: `netlify.toml`'s build command is a
literal `echo`, and there is no `.github/workflows/` directory. The ten PRs merged overnight
shipped *code*, not *schema*.

Until you run this, the **Finance OS** and **Banking** screens will 500 — 14 tables they
query do not exist.

From your own machine, in the repo root:

```bash
DATABASE_URL="postgresql://postgres.oqpnlusrotpxfenysfxz:<YOUR_DB_PASSWORD>@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  node db/migrate.mjs
```

- Replace `<YOUR_DB_PASSWORD>` with your Supabase database password (Dashboard →
  Settings → Database). It is deliberately not stored in this repo.
- Keep `?sslmode=require`. `src/db.mjs` passes no `ssl` option, so TLS comes entirely from
  the connection string.
- The runner is idempotent — it skips anything already applied. Expect
  `✔ applied migrations/075_…` through `089`, then `Done. 15 migration(s) applied.`

**Order does not matter here.** Step 1 does not depend on 075–089, so you can log in first
and migrate afterwards.

---

## Recommendations (not done — they need your call)

1. **Reconsider client-side demo mode in a live CRM.** `fh.js` still falls back to a
   hardcoded user table when `/api/auth/login` 404s, and once engaged it sticks in
   `localStorage`. The login page now clears that flag on load and no longer lets a demo
   answer masquerade as a real credential rejection, but a production CRM arguably should
   not ship a fake user table at all.
2. **Make deploys apply migrations,** or at least fail loudly when the ledger is behind the
   repo. Not changed here: editing `netlify.toml`'s build command to touch the database
   risks breaking every deploy, which is a worse failure than the one being fixed.
3. **`shell.js:248` and `crm.html:317`** still redirect to the login page on *any*
   `/api/auth/session` failure, including 500s — so a broken backend still presents as
   "you are signed out". Fixing it needs a banner UI, not an error-branch rewrite.
