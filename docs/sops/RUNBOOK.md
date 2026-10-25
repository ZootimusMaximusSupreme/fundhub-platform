# Runbook — what to do when something looks broken

Written before the owner laws of Aug to Oct 2026. Where this page and CLAUDE.md disagree, CLAUDE.md wins.

This page is for the moment something is wrong and you need to know what.
It does not assume you read code. Read it top to bottom, or jump to the part
that matches what you are seeing.

One thing to know before you start. The morning pulse and the hourly beats watch the company from inside (`docs/journeys/heartbeat-flow.md`). Law: texting-hours (`.ai/rules/texting-hours.md`) - a break found overnight is saved, and a text to Chris goes out only from 6:00 a.m. to 10:00 p.m. Mountain Standard Time. [Monitoring](#monitoring) and [Alerting](#alerting) say what an outside uptime check looks like. [What nobody is watching](#what-nobody-is-watching) says what is still not covered.

---

## The one check

Open this address in a browser:

```
https://transcendent-wisp-888771.netlify.app/api/health
```

(If the site has moved to its own web address, use that address and put
`/api/health` on the end.)

You get back a short block of text like this:

```
{"ok":true,"db":"up","state":"up","migrations":"<count>","expected":"<count>","pending":0,"error":null,"checkedAt":"..."}
```

Read `migrations` and `expected` from the live `/api/health` page. Do not use an old count from this page.

Two words in there tell you almost everything: **`state`** and **`error`**.

---

## What the answer means

Find your `state` in this table.

| `state` says | What that means in plain words | Is the site usable? | Go to |
|---|---|---|---|
| `up` | Everything is fine. The site is running and the database has everything it needs. | Yes | — |
| `behind` | The site is running. The database is answering. But the database is **missing pieces** the new code needs. Screens will look broken even though nothing is "down". | Partly — some screens fail | [The database is behind](#the-database-is-behind) |
| `unreachable` | The site is running, but **the database is not answering**. Nothing that needs saved information will work. | No | [The database is not answering](#the-database-is-not-answering) |
| `unconfigured` | The site is running, but it was never told **where** the database is. Usually a setting got wiped, or a new deploy lost it. | No | [The site does not know where the database is](#the-site-does-not-know-where-the-database-is) |
| `error` | The database answered, but the answer was an error. Usually a permissions problem, or the very first setup never ran. | No | [The database is not answering](#the-database-is-not-answering) |
| *(a 404 page, or nothing loads at all)* | The site itself is not there, or the part that answers requests never deployed. | No | [The site is down](#the-site-is-down) |

`ok` is the same information in one word. `ok: true` means "trust this".
`ok: false` means "do not trust this" — it does **not** mean your request failed.

---

## Incident response

Start here during an outage. First work out **which** of three different
problems you have, then follow that one section. They feel identical from the
outside — screens look wrong — and the fixes have nothing in common.

**"The site is down."**
The web address does not load at all, or `/api/health` gives a 404 page instead
of the block of text above. Nothing was deployed, or the deploy broke.
→ [The site is down](#the-site-is-down)

**"The database is down."**
`/api/health` loads fine and says `unreachable`, `unconfigured`, or `error`.
The site is up. The place it keeps information is not reachable.
→ [The database is not answering](#the-database-is-not-answering)

**"The schema is behind."**
"Schema" means the shape of the database — its tables and columns.
`/api/health` says `behind`. This is the sneaky one. Every normal check passes.
The site is up. The database is up. But new code expects tables that were never
created, so any screen touching them fails while everything else works fine.
→ [The database is behind](#the-database-is-behind)

### A note on the coloured chip in the CRM

The CRM shows a small chip in the corner: **LIVE**, **NO DB**, or **NO API**.
It is useful but it is coarse. Today a `behind` database draws **NO DB**, even
though the database is answering perfectly. The words next to the chip say how
many migrations are applied and how many are pending. Read the count from
`/api/health`. **When the chip and this page disagree, believe this page.**

---

### The database is behind

#### Why this happens

Changes to the database's shape are kept in numbered files. Read `migrations` and `expected` from the live `/api/health` page. Each file has to be applied to the database once, in order.

A production deploy applies pending migrations (`[context.production]` migrates, owner-set 2026-08-19). `.github/workflows/ship.yml` runs the checks, then that migrate step. A preview deploy does not migrate. The command below still applies them when an agent runs it from the Mac. If the code goes out and the migrate step did not run, the code is ahead of the database and screens break.

#### How to see exactly which pieces are missing

Put `?strict=1` on the end of the health address:

```
https://transcendent-wisp-888771.netlify.app/api/health?strict=1
```

The answer now includes a list called `missingMigrations` with the real file
names in it — for example `migrations/090_soft_pull_one_open_per_client.sql`.
That list is the answer to "behind by what". You do not need to do anything with
the names; the fix below applies all of them. They are there so you can tell
someone precisely what is missing.

#### The fix

A person with access to the project runs this from inside the project folder:

```
DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs
```

It prints one line per file — `skip` for the ones already applied, a tick for
each one it applies — and ends with a count. It is safe to run more than once.
It will not redo work that is already done.

Then reload `/api/health`. It should say `up`.

Law: agents-run-ops-not-chris (`.ai/rules/agents-run-ops-not-chris.md`) - an agent runs this from the Mac. A hosted cloud session cannot reach `api.netlify.com` or `api.supabase.com`. Any attempt fails immediately with a "403" refusal before it even connects. That is a policy block, not a bug, and there is no way around it from there. Do not ask Chris to run it.

#### What this does not do

It only adds. This project is **forward-only**: there is no command that undoes
a database change and no "down" files to run. That matters for
[Rollback](#rollback).

---

### The database is not answering

`state` says `unreachable` or `error`.

Try these in order. Stop when the health check goes green.

1. **Wait two minutes and reload the health address.** Hosted databases restart
   and briefly refuse connections. A blip fixes itself.
2. **Check the database provider's own status page.** This project uses Supabase
   (project `oqpnlusrotpxfenysfxz`, Postgres, us-west-2). If they are having an
   outage there is nothing to do but wait — and now you know that.
3. **Check the database is not paused or over its limit.** Free and low tiers
   pause after inactivity or when storage fills. The provider's dashboard says so
   on the front page.
4. **If `state` says `error` and the message mentions "permission denied" or
   "does not exist"** — the login the site uses lost its access, or the very
   first setup never ran. Run the command in
   [The database is behind](#the-database-is-behind). If it still fails, the
   database password was rotated and the site is holding an old one. See
   [the next section](#the-site-does-not-know-where-the-database-is).

The health page will never show you the database's address, name, or password.
That is deliberate — anyone on the internet can open that page.

---

### The site does not know where the database is

`state` says `unconfigured`. The site is running but the setting that tells it
where the database lives is empty.

A person with access sets it and redeploys:

```
netlify env:set DATABASE_URL "postgres://…the real value…" --context production --secret
netlify deploy --build --prod
```

Two rules, both important:

- `--secret` goes on anything holding a password. Always.
- Law: secrets-env-law (`.ai/rules/secrets-env-law.md`) - confirm a key by name only, for example "DATABASE_URL is set"; paste a value only when Chris asks.

Same network note as above: an agent on the Mac runs this. A hosted cloud session cannot (403). Do not ask Chris to run it.

---

### The site is down

The address does not load, or `/api/health` returns a 404 page rather than text.

1. **Open the Netlify dashboard** — team `zootimusmaximusbackup`, site
   `transcendent-wisp-888771` — and look at the newest deploy. If it is red, the
   deploy failed and the last good version is probably still live. If it is green
   and the site is still broken, go to step 2.
2. **Roll back.** See [Rollback](#rollback).

---

## Rollback

Rolling back means putting the previous version of the site back.

**The fast way, no code needed:**

1. Open the Netlify dashboard → team `zootimusmaximusbackup` → site
   `transcendent-wisp-888771` → **Deploys**.
2. Find the last deploy that was working. The list shows the time and the
   description of each one.
3. Click it, then click **Publish deploy**.

That is it. The old version is live again within seconds.

**Read this before you do it.** Rolling back moves the *code* backwards. It does
**not** move the *database* backwards. Database changes in this project are
forward-only — there is no command that undoes one. So:

- If the new code only **read** things, rolling back is safe and clean.
- If the new code **added tables or columns**, rolling back is still safe. The
  old code simply ignores them.
- If the new code **changed how existing information is stored**, rolling back
  can leave the old code reading information it does not understand. In that case
  ask whoever made the change before you roll back. This is the one situation
  where rolling back can make things worse instead of better.

After rolling back, open `/api/health` again. Because the code went backwards it
may now report `up` even though the database still holds newer changes. That
combination is fine and expected.

---

## Monitoring

The hourly pulse checks the company from inside (`netlify/functions/pulse-hourly*.mjs`, `docs/journeys/heartbeat-flow.md`). A five-minute watcher (`netlify/functions/pulse-outside-watch.mjs`) checks that the workflow engine is still ticking. It does not poll this health address.

An outside uptime monitor is not set up on `/api/health?strict=1` yet. Any uptime service can do it, and setting one up takes about five minutes.

Point it at this exact address, **including the `?strict=1` part**:

```
https://transcendent-wisp-888771.netlify.app/api/health?strict=1
```

Have it check every five minutes. Tell it that a **503** means failure.

**The `?strict=1` part is not optional, and here is why.** Uptime services decide
"up or down" from a hidden number the page sends back, called a status code.
Without `?strict=1` this page always sends back **200**, which means "fine" — on
purpose, because the CRM screens depend on it. A monitor pointed at the plain
address would report the site as healthy straight through a complete database
outage, forever. Adding `?strict=1` tells the page to send back **503** — which
means "not fine" — whenever anything is wrong: database down, database behind, or
setting missing.

That one address covers all five states in [What the answer
means](#what-the-answer-means). `up` gives 200. `behind`, `unreachable`,
`unconfigured` and `error` all give 503.

---

## Alerting

A check that nobody sees is not monitoring. When the monitor above goes red it
has to reach a person.

- Send the alert somewhere **a phone will buzz** — text message or a phone push.
  Law: texting-hours (`.ai/rules/texting-hours.md`) - texts to Chris go out only from 6:00 a.m. to 10:00 p.m. Mountain Standard Time (Arizona). A break found overnight is saved and goes out in the first text of the next window. Do not text at 2 a.m.
- Send it to **at least two people**. One person is on a plane eventually.
- Have the alert message include the health address itself, so whoever gets it
  can open it and read `state` without hunting for the link.
- Put a link to this page in the alert message too. The point of a page at 2am is
  that it lands somewhere with instructions.

The pulse texts Chris inside the texting window when a check goes red (`docs/journeys/heartbeat-flow.md`). That alert road is on. An outside uptime monitor on this health address is not set up yet.

---

## On-call

Texts about a red check go to Chris inside the texting window. There is no separate named rota and no agreed response time beyond that window.

If you want a named rota, three decisions are enough to start:

1. **Who is first.** One named person who gets the alert, and one named backup.
2. **How fast.** A response time you actually mean — "within an hour during the
   day, next morning overnight" is a real answer and is better than an unwritten
   one.
3. **What they are allowed to do without asking.** Rolling back a deploy and
   running the migrate command should both be on that list.
   Law: finish-the-answer (`.ai/rules/finish-the-answer.md`) - two things always wait for Chris: deleting data (not proven test rows or test logins) and repointing DATABASE_URL.
   Law: product-is-live (`.ai/rules/product-is-live.md`) - INNGEST_EVENT_KEY stays on; never disable it (owner-set 2026-08-20).

Write those three answers down here when you have them.

---

## What nobody is watching

Stated plainly, because a gap you know about is manageable and a gap you assume
is covered is not.

The morning pulse and the hourly beats watch the company (`docs/journeys/heartbeat-flow.md`). They text Chris inside the texting window. The pulse reports. It does not fix things by itself.

An outside uptime monitor is not set up on `/api/health?strict=1` yet. [Monitoring](#monitoring) is how that check would be pointed. [On-call](#on-call) says who gets the text.

`.github/workflows/ship.yml` runs lint and guard tests before every production deploy, then applies pending database changes. A database that is behind still breaks screens while the site looks up. See [The database is behind](#the-database-is-behind).

Law: product-is-live (`.ai/rules/product-is-live.md`) - texts, email, and the message dispatcher are live. A queued message is waiting to send. "Nothing goes out" is not true. Plaid affiliate payouts stay in test mode (owner-set 2026-10-21).

---

## Quick reference

| I see | It means | Do this |
|---|---|---|
| `state: "up"` | All good | Nothing |
| `state: "behind"` | Database missing pieces | [Run the migrate command](#the-database-is-behind) |
| `state: "unreachable"` | Database not answering | [Wait, then check the provider](#the-database-is-not-answering) |
| `state: "unconfigured"` | Setting is empty | [Set `DATABASE_URL`, redeploy](#the-site-does-not-know-where-the-database-is) |
| `state: "error"` | Database answered with an error | [Same as unreachable](#the-database-is-not-answering) |
| A 404 page, or nothing loads | Site is down | [Check the deploy](#the-site-is-down), then [Rollback](#rollback) |
| Monitor sent a 503 | Something is wrong — open the health address and read `state` | [What the answer means](#what-the-answer-means) |
| Chip says NO DB but health says `behind` | Believe health | [Run the migrate command](#the-database-is-behind) |
