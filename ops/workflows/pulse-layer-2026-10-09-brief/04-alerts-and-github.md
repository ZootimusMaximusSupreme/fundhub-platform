# Brief 04 — Alerts, GitHub issues, and the text (2026-10-09)

Area owner: read-only grounding. Board: `ops/workflows/pulse-layer-2026-10-09.md`. Nothing in the app was changed to write this.

## The short version (4th grade)

The text part is easy. We already have code that texts Chris, and it needs no database. So a text can go out even when the database is dead.

The GitHub part is not ready. The live site has no GitHub key. Issues are turned off on the repo. And the repo is public, so anything we put in an issue, the whole world can read.

To remember "how long has this been broken," do not use only the database. Use a small store that is not the database (Netlify Blobs, which the repo already has). Use the open GitHub issue as the second memory. Because the runner fires once an hour, "text again every hour" needs no memory at all: every run that is red texts.

Before this ships, three things must happen. Chris (or an agent with his OK) must turn on Issues. Someone must make a small GitHub key that can only touch issues on this one repo. And we must decide what is safe to write in a public issue. The details are below.

---

## 1. Facts found (file:line)

### The text

- `chrisPulseSmsTo(env)` reads `PULSE_SMS_TO`, then `CHRIS_PULSE_SMS`, and tidies it to E.164: `src/pulse/notify.mjs:16-21`, `:28-36`. Never hardcode the number.
- `textMorningBrief({ body, env, dryRun, sendImpl })` is the reusable sender. It needs only `env`, no database. It returns `{ delivery_status: sent|failed|no_number|dry_run, sent_to_last4, error, provider_message_id }` and never throws: `src/pulse/notify.mjs:136-161`. **`dryRun` defaults to true** (`:139`), so the alert code must pass `dryRun: false` on purpose, as `api/ops/notify-owner.mjs:52` does.
- It sends through `src/messaging/providers/twilio.mjs` (`send`, `:109`), which posts via `postJson` (`:38`, `:178`), which binds the MESSAGING fence (`src/messaging/providers/http.mjs:55-72`). Twilio env: `TWILIO_SEND_ACCOUNT_SID`, `TWILIO_SEND_AUTH_TOKEN`, `TWILIO_SEND_FROM` (`twilio.mjs:76-78`).
- Production fence flags are open: `MESSAGING_DRY_RUN` reads `0` and `ADAPTERS_DRY_RUN` reads `0` on Netlify production (`netlify env:get`, checked 2026-10-09; these two are not secrets). `0/false/no/off` are the only values that allow a send: `src/lib/dry-run.mjs` (`MEANS_TRANSMIT`, `fenceVerdict` at `:67`).
- The older instant watch texts with its own copy of the same logic: `src/pulse/instant-watch.mjs:129-139`.
- `api/ops/notify-owner.mjs` is a POST door guarded by `OPS_NOTIFY_SECRET` (32+ chars, header `x-ops-notify-secret`, `:10-13`, `:37-45`). 503 when unset, 401 on wrong secret, text 1-600 chars (`:47-50`). It is for agents on the Mac. The runner should not call it. It lives in the same function bundle and can call `textMorningBrief` directly.
- Names present on Netlify production (names only): `PULSE_SMS_TO`, `OPS_NOTIFY_SECRET`, `ANTHROPIC_API_KEY`, `TWILIO_SEND_*`, `NTFY_TOPIC`, `MESSAGING_DRY_RUN`, `ADAPTERS_DRY_RUN`, `NETLIFY_BLOBS_TOKEN`, `NETLIFY_SITE_ID`, `INNGEST_*`. Checked with `netlify env:list --context production --json`, 121 variables; same in deploy-preview and branch-deploy.
- Owner texts leave no database record. `textMorningBrief` calls Twilio directly and writes no `messages` row. The `messages` table shows only 3 SMS rows in the last 3 days (2 delivered, 1 received). So there is **no proof in the database that any owner text was ever delivered**. The instant watch has also never recorded a firing: `SELECT … FROM agent_runs WHERE agent_code='pulse-instant'` returns 0 rows, while `job_heartbeats` shows `pulse-instant-watch` ran 441 times, last 2026-10-09 09:25 UTC. That is "never red" or "never recorded," and nothing can tell which.

### How the instant watch remembers (the existing pattern)

- Cooldown is one hour per failure "fingerprint" (the sorted ids): `INSTANT_COOLDOWN_MS` at `src/pulse/instant-watch.mjs:11`.
- It remembers by writing an `agent_runs` row only after the text goes, then reading `agent_runs` for a `LIKE '%fingerprint%'` row inside the window: `:29-42` (read), `:44-52` (write). Table: `db/migrations/177_agents_live_integrity.sql:163-175` (`org_id NOT NULL`, `agent_code`, `outcome`, `detail`, `created_at`).
- **Dead database already handled once.** `:76-108` wraps the database reads so a dead database becomes one red row (`id: "db"`) instead of a crash. With no database there is no cooldown record, so it texts only in minutes 0-4 of each half hour (`:115-117`, the "db_down_wait" branch): at most 2 texts an hour, none lost. The cooldown read is also wrapped so a failed read means "text again" (`:118-125`). Failed record write is swallowed (`:140-146`). Same idea works for the hourly pulse, and is simpler (see section 3).
- The existing `alerts` table is the wrong home. It is per-client (`client_id`, `tradeline_id`, `dedupe_key`, `state`) and has 0 rows. `src/alerts/store.mjs:15` says "NOTHING HERE TRANSMITS."

### GitHub

- There is one GitHub client: `src/messaging/providers/github-repo.mjs`. It does Contents/Git-data calls for the marketing outbox. It has no issues code. `src/repo/github.mjs:18-27` only re-exports its read helpers.
- Its token is **`GITHUB_REPO_TOKEN` only** (`github-repo.mjs:16-20`, `repoToken` `:62-68`). `GITHUB_TOKEN` "is the laptop's push token and is never read here." A missing or masked (`*`) value is no token (`:66`). It returns an error object, never throws.
- **No GitHub key is on the live site.** On Netlify production there is no `GITHUB_REPO_TOKEN`, no `GITHUB_TOKEN`, no `GITHUB_REPO`, no `PULSE_SECRET`, and nothing named ROUTINE or CLAUDE (key names grep, all three contexts). Note: `docs/specs/blueprint-funnel-test-plan-2026-10-06.md:169` says `GITHUB_REPO_TOKEN` is "Present." That is not true today. The marketing outbox is therefore held with `no_token`, as `ops/workflows/marketing-machine-2026-10.md:139` said it would be.
- **Do not put the laptop token on the live site.** `credentials/github-pat.txt` (a `ghp_` classic token) answers 200 on the repo and its scope header lists `repo`, `admin:org`, `admin:enterprise`, `delete:packages`, `workflow`, `audit_log` and more. That is full account power. (Probed once, scopes header only; no value printed.) `.env` line 126 `GITHUB_TOKEN` is empty. Its stated use is the push script (`.claude/rules/github-push.md`).
- **The repo is public** (`private:false`) and **Issues are turned off** (`has_issues:false`) on `ZootimusMaximusSupreme/fundhub-platform`. Default branch `main`. Labels today: the 10 GitHub defaults only (bug, documentation, …). No `pulse` label. `open_issues_count` is 1, which is a pull request: the `/issues` list returns PRs (#21-#23 are PR titles).
- `.github/workflows/` holds only `tests.yml`. There is no Claude workflow and no Claude GitHub app evidence in the repo.

### The fence rules a new provider must obey

- Outbound calls live in `src/messaging/providers/*` and go through `transmit()` in `src/lib/outbound-fetch.mjs:228` with `fence: ADAPTERS` (`:34`). Reasoning copied from `github-repo.mjs:5-9`: it changes a record at a vendor, so it is the vendor fence, not the person fence.
- `transmit()` never throws, returns `{ ok, blocked, transmitted, status, body, headers, error, fence }` (`:228-300`), has a 10 s default timeout (`:63`), and scrubs errors with `redact()` (`:120`, 300 chars max, `:109`).
- `src/lib/no-unfenced-transmit.test.mjs` scans `src/`, `api/`, `netlify/` for `await fetch(`, `globalThis.fetch`, `fetchImpl(`, `doFetch(` etc. (`:36-52`). Any file that matches and does not contain the text `lib/outbound-fetch.mjs` must be on `ALLOWED_RAW_FETCH` (`:67`) with a written reason, or the build fails (`:348-366`). **The new provider needs no entry on that list**, because it imports from `outbound-fetch.mjs` (like `github-repo.mjs:28`). `:395-408` also requires any file in `src/messaging/providers/` that sets `TRANSMITS = true` to use `postJson` or the chokepoint.
- Trap for the runner: if `pulse-hourly.mjs` or any beat calls `fetchImpl(` directly, it trips that test. Beats must only use the injected, captured fetch wrapper and the alert module must use the provider. The other pulse files that probe pages are on `ALLOWED_RAW_FETCH` as read-only (`PULSE_GAP_READS` at `no-unfenced-transmit.test.mjs:63`, entries from `:150`). A beat that POSTs a pulse signal is not read-only, so it must route through a fenced module or its own written entry.

### Where the runner lives (for the alert code)

- Scheduled functions are listed in `netlify.toml:169-208` (one `[functions."name"] schedule = "…"` block each). The function must be `export default` only, returns a `Response`, and returns 200 even on failure (`netlify/functions/marketing-clock.mjs:13-17`, `:30-41`; `src/http/scheduled-functions-return.test.mjs`).
- **Three tests will go red the moment `pulse-hourly` is added, and they are meant to:** (a) `scheduled-functions-return.test.mjs:43-60` asserts the exact list of scheduled function names, so add `pulse-hourly` there; (b) it runs each scheduled function with no env and no database (`:66-96`), so with no `PULSE_SMS_TO`, no token, and no `DATABASE_URL` the runner must still return a Response and send nothing; (c) `src/pulse/heartbeats.mjs:52-60` (`NETLIFY_JOBS`) must list it too, or `heartbeats.test.mjs` fails.
- Heartbeat law: `noteScheduledRun(db, "pulse-hourly", result)` (`src/pulse/heartbeats.mjs:154-163`) writes the receipt and never throws. A job goes red at 3x its schedule (`STALE_MULTIPLE`, `heartbeats.mjs:67`), but that is only read by the 6 a.m. pulse. See section 5 for a faster dead-man check.

---

## 2. How "text now, every hour, once when fixed" works

### Rules

1. **New break** (beat red now, no open incident): text at once. Title the text with the beat and the fix. Open the issue.
2. **Still broken** (beat red now, incident open): text again on this run. The runner fires once an hour, so one text per red run is exactly "every hour." No timer, no cooldown table.
3. **Fixed** (beat green now, incident open): text once, close the issue, close the incident.
4. **Many red at once:** send ONE text per run that lists up to 3 beats and a count ("7 broken: payment-webhook, lead-form, bank-apply and 4 more"). Reasons: Twilio and GitHub both rate limit bursts; GitHub's secondary limit on content creation is tight for 20 issues in a minute; and 5+ red at once usually means one common cause (database, site down, a bad deploy). For 5 or more red, open one "storm" issue (`beat:storm`) instead of one per beat. Each red beat still gets its own row in `pulse_beats`.
5. **Fixed text rule:** a "fixed" text goes out only when the incident was open at least one full run. A beat that flickers red then green within one run is not texted.

### The text body (160 characters per Twilio segment, aim for 2 segments, 320 max)

```
Fundhub BROKEN: <beat title> at <step>. Since <hh:mm MST> (hour <N>). Fix: <first line of fixGuide, cut at 120>. Issue: <short url or "no issue yet">
```
Fixed: `Fundhub FIXED: <beat title>. Was broken <N> h. Issue closed.`

Reuse `textMorningBrief` (`src/pulse/notify.mjs:136`) with `dryRun:false`. Strip everything but plain ASCII. Never put a phone number, email, name, amount, or id from a real customer in the text; a pulse signal has none, but a beat's `detail` may echo a response body, so run it through `redact()` (`src/lib/outbound-fetch.mjs:120`) first and cap it.

### Where each fact is stored (and survives which failure)

| Fact | Primary store | Why | Second copy |
|---|---|---|---|
| "this beat is broken" + `opened_at`, `last_alert_at`, `alerts_sent`, `issue_number` | **Netlify Blobs**, one JSON key `pulse/incidents` | Does not depend on Postgres. Already in `package.json` (`@netlify/blobs ^10.7.11`) and used by `src/documents/store.mjs:304-340`. A scheduled function gets Blobs context from the platform, so no token is needed at run time. | The open GitHub issue (label `beat:<id>`) |
| Full history (every run, cause, guard) | Postgres `pulse_beats`, `pulse_incidents` (board schema) | The system of record and the learning loop | n/a |

Blobs supports `onlyIfMatch` / `onlyIfNew` and `consistency` options (`node_modules/@netlify/blobs/dist/main.d.ts:40-57`), so a read-modify-write can be made safe and strong. Read with strong consistency; write with `onlyIfMatch` the etag just read; on a conflict, re-read once.

**Order inside one run (everything after the beats is time-boxed, total under about 12 s of the 30 s):**
1. Read incidents from Blobs (about 50-150 ms). On failure, keep going with `incidents = null` (unknown).
2. In parallel: list open `pulse` issues on GitHub (one GET, label filter) AND read the last known state from Postgres if it is up. Each with a 4 s cap.
3. Decide per beat. If Blobs failed, fall back to GitHub's list; if both failed, section 4's clock rule.
4. Create/comment/close the issue (6 s cap), then send the text (10 s cap, the provider default). Do the text even if the issue call failed. If the issue call finished, put the issue link in the text.
5. Write the new incident state to Blobs, then to Postgres. A failed write is logged in the result and never stops the text.

---

## 3. GitHub: token, permission, where the code lives

### What is missing before any issue can open (three things, none done)

1. **Issues must be turned on** for the repo (`has_issues:false` today). It is a repo setting change. Needs Chris's yes in chat (CLAUDE.md "Explicit permission": changing account settings). An agent can then flip it with the admin token on the Mac via `PATCH /repos/ZootimusMaximusSupreme/fundhub-platform {"has_issues": true}`.
2. **A narrow key on Netlify.** Proposed name `GITHUB_ISSUES_TOKEN` (new, so it can never be confused with the Contents token). Fine-grained personal access token, **only this repository**, permissions: **Issues: Read and write** (Metadata read is added automatically). Nothing else: no Contents, no Pull requests, no Actions. Fine-grained tokens cannot be made by API; creating it is one browser click by Chris on https://github.com/settings/personal-access-tokens/new. Then an agent sets it: full value to `.env` and `credentials/env.full.snapshot`, then `netlify env:set GITHUB_ISSUES_TOKEN "<value>" --context production --context deploy-preview --context branch-deploy` **without** `--secret` (`CLAUDE.md` §11). Batch it with `PULSE_SECRET`; deploy once with `npm run ship`.
   - Alternative: widen the future `GITHUB_REPO_TOKEN` to Contents + Issues. Not recommended: the live token that can write files would also be able to spam issues, and the other way round.
   - Do not use `credentials/github-pat.txt`. It has account-wide admin scopes.
3. **The `pulse` label** should exist before the first issue so it can be searched and the Claude trigger can filter on it. Not an API risk: if the label is missing, GitHub's create-issue call normally creates it for tokens with push-level access, but prove it once with a real test issue rather than trust that (unproven here). Create `pulse` and `pulse-storm` once from the Mac.

Also needed for the "pulse fixer" to start by itself: the Claude GitHub app (or whatever the routine's issue trigger requires) must be installed on this repo. Nothing in the repo or the key names shows it is. Unknown; that is workflow 3's job to prove.

### Provider shape: `src/messaging/providers/github-issues.mjs`

Mirrors `github-repo.mjs` (same `call` helper, `withReason`, `API_BASE`, `API_VERSION`, `User-Agent: fundhub-app`). A NEW file, so `github-repo.mjs` is not edited.

```js
// @ts-check
import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";
export const PROVIDER = "github-issues";
export const TRANSMITS = true;          // required by no-unfenced-transmit.test.mjs:402
export const TIMEOUT_MS = 6_000;        // the runner must not wait 15 s
export const PULSE_LABEL = "pulse";

export function issuesToken(env = process.env)   // GITHUB_ISSUES_TOKEN; null if empty or contains "*"
export function issuesRepo(env = process.env)    // GITHUB_REPO or DEFAULT_REPO (same regex as repoConfig)

// every call returns transmit()'s shape + a field read out of GitHub's answer; NEVER throws;
// no token => { ok:false, blocked:false, transmitted:false, error:"GITHUB_ISSUES_TOKEN is not set (or is masked)" }

export async function findOpenIssueByLabel(beatId, { env, fetchImpl })
  // GET /repos/{repo}/issues?state=open&labels=pulse,beat:{beatId}&per_page=5
  // skips items that have a `pull_request` key (the list returns PRs too)
  // -> { ...res, issue: {number, html_url, created_at, comments} | null }
export async function createIssue({ title, body, labels, env, fetchImpl })
  // POST /repos/{repo}/issues  body {title, body, labels}
  // title <= 120 chars after redact; body <= 60000; refuses (no request) when the body fails the
  // "public repo" scrub in section 4 (see below)
  // -> { ...res, number, url }
export async function commentIssue(number, { body, env, fetchImpl })
  // POST /repos/{repo}/issues/{number}/comments -> { ...res, commentId }
export async function closeIssue(number, { comment, reason = "completed", env, fetchImpl })
  // optional comment first (one call), then PATCH /repos/{repo}/issues/{number}
  // body {state:"closed", state_reason:"completed"} -> { ...res }
```

Fence: `ADAPTERS` (`outbound-fetch.mjs:34`), exactly like `github-repo.mjs:114-117`. With `ADAPTERS_DRY_RUN` unset every call comes back `blocked:true` and nothing leaves; production reads `0`, so it is open. All four functions accept `fetchImpl` for tests, and a test must still set `ADAPTERS_DRY_RUN:"0"` (as `github-repo.test.mjs:19` does) because an injected fetch does not bypass the fence.

Tests (same style as `github-repo.test.mjs`, no network): no token returns a clean error; masked token returns the same; blocked under the fence; PRs in the list are skipped; label filter string; close sends `state_reason`; errors are redacted; the body scrub refuses a body that contains `x-fundhub-pulse`, a 32+ character hex or base64 run, an email, or a phone number.

Rate limits: a fine-grained token gets the normal REST limit (5,000/h). Creating issues/comments falls under GitHub's secondary content-creation limit, so one issue per red beat per break plus (at most) one comment per run is far below it, and the storm rule in section 2 caps the burst.

### The public-repo problem (say it once)

The repo is public. An open issue titled "payment webhook is broken, step: signature check" tells the world where a weak door is. Mitigations that need no owner decision: never put a real customer, email, phone, amount, key, header, signature, internal id, or response body in an issue; keep `detail` to the redacted, capped (300 char) string; give the repro as the *command* (`node scripts/pulse/run-beat.mjs <beat> --live`) plus the beat id, not the request bytes. Whether to keep issues on a public repo at all is a decision only Chris can make; the safe alternative is a private repo or a private "pulse" repo for issues only, which would change `DEFAULT_REPO`. This is not repeated again.

---

## 4. What an issue must carry so a fixer can start cold

Title: `[pulse] <beat id> broken at <step>` (<= 120 chars). Labels: `pulse`, `beat:<id>` (beat ids must be <= 44 chars so the label fits GitHub's 50; add this to the beat contract test).

Body (all values scrubbed and capped):

```markdown
<!-- pulse-beat:<beat id> run:<run_id> opened:<ISO time> -->
## What broke
Beat `<id>` — <title>. Failed at step **<step>** on <ISO time> (<MST time>). Broken for <N> run(s) so far.
Result: `<detail, redacted, <= 300 chars>`   Duration: <ms>

## Reproduce it (do not read the secret from this issue)
1. `node --env-file=.env scripts/pulse/run-beat.mjs <beat id>`      # runs the one beat the same way the hourly runner does
2. It signs its own `x-fundhub-pulse` header from PULSE_SECRET (in your `.env`). Never paste a signature or a secret here.
3. Door: <METHOD path>   Handler: <file:line>   Pulse wiring: <file:line>
4. Expected: <what "green" returns, one line>   Got: <status/step/detail>

## Fix guide (from the beat's `fixGuide`, written by the beat's author)
Most likely causes, in order: 1. … 2. … 3. …
Steps: 1. … 2. …
Do not: re-run it against anything but the pulse (the pulse rolls back and captures sends); do not change a test to make it pass.

## Last 24 hours of this beat
| time (MST) | ok | step | ms | detail |
(24 rows from pulse_beats, newest first; if the database is down, "not available — database unreadable" and the last 3 results held in Blobs)
First red: <ISO>. Last green: <ISO>. Recent deploys: <last 3 `ops/ship-log.md` lines>, so a fixer can see "broke right after deploy X".

## Links
Live page / door: <url>   Pulse board: ops/workflows/pulse-layer-2026-10-09.md   Beat file: src/pulse/beats/<id>.mjs   Tripwire: <id from src/pulse/tripwires.mjs>
Related guards already in place: <test file names>

## When it is fixed (the fixer fills this in; it is the learning record)
```json
{ "cause_category": "", "cause_note": "", "fix_summary": "", "guard_added": "" }
```
Append the same four fields to docs/lessons/pulse-lessons.md in the fix PR.
```

Each later red run adds ONE comment: `Still broken at <step> — run <n>, <N> h. <detail>`. On green the runner comments `Green again at <time> after <N> h` and closes it with `state_reason: completed`. The runner cannot know the cause, so `pulse_incidents.cause_*` stay empty until the fixer's PR fills them. A sweep that lists closed incidents with an empty cause for over 2 days is the nudge (not built; mention to workflow 1).

Reproduction needs `scripts/pulse/run-beat.mjs`, which does not exist yet. That script, and `PULSE_SECRET` in the fixer's cloud env (`credentials/cloud-env-for-claude.txt`), are workflow 0/1 deliverables the issue depends on. If the script does not ship, the repro section cannot be true.

---

## 5. When the database is down: where the runner keeps state

Order of trust, each step used only when the one above is unreadable:

1. **Netlify Blobs** (`pulse/incidents`). Independent of Postgres. Holds, per beat: `opened_at`, `last_alert_at`, `alerts_sent`, `issue_number`, `last_ok`, plus the last 3 results (for the issue's "last 24 hours" table when Postgres is gone).
2. **The open GitHub issue** with label `beat:<id>`. "Is it still broken" = an open issue exists. "Hour N" = `floor((now - issue.created_at) / 1h) + 1`, taken from GitHub's own `created_at`, not from the comment count (a failed comment cannot skew it). "Fixed" = green beat + open issue found: close it, text once.
3. **The clock.** No memory at all. The runner fires once an hour, so "every red run texts" already gives the hourly cadence. The only things lost are "since when" and the "fixed" text. The text then says `broken (duration unknown)`.

Copy the existing instant-watch behavior for the very worst case (no store answers): texting is not gated by any store. It is gated by the run itself being red. Do not add the 30-minute-window trick (`instant-watch.mjs:115`): that exists because the instant watch runs every 5 minutes; an hourly runner needs no throttle.

### Failure modes and what the text says

| What is down | What still works | What is lost |
|---|---|---|
| Postgres only | Beats that do not need it, texts, GitHub, Blobs state | `pulse_beats` rows for the run (held in Blobs as a pending list, written back next run), the 24h table |
| Postgres + Blobs | Texts; GitHub issue state (issue found by label) | Exact `last_alert_at`; a duplicate text is harmless |
| Postgres + Blobs + GitHub | Texts only | Issue, "hour N", "fixed" text. The text says `no issue (GitHub unreachable)`. Next run with GitHub back opens the issue then (an open issue is looked up before one is created, so no duplicate) |
| Twilio down | Issue + state | The text. Record `delivery_status:"failed"` in the run result and Blobs; retry next run; if texting has failed twice in a row and ntfy is configured, buzz via `src/messaging/providers/ntfy.mjs` (`NTFY_TOPIC` is on Netlify; ntfy is `ENABLED=false` / unrouted but its send works on its own and uses the MESSAGING fence). Not built here; propose it. |
| The runner itself (Netlify scheduler stopped, bundle fails to load) | Nothing from this layer | Everything. **Dead-man check needed.** The 6 a.m. pulse would notice after 3 hours (`heartbeats.mjs:67`) but only reports at 6 a.m. Add one check to `runInstantWatch` (the independent Inngest 5-minute watch, `instant-watch.mjs:67-75`): read the newest `job_heartbeats` row for `pulse-hourly`; if older than 3 hours (and the database is readable) add a FAIL row `pulse:runner-stale`. It already texts through its own path with its own cooldown. The runner and its watcher then share neither scheduler nor code path. |
| Both Inngest and Netlify schedulers | Nothing | Accepted risk; mention only. |

Two ways the memory can lie, both safe:
- A Blobs read that returns stale data (eventual consistency). Use strong consistency for the read; worst case is one duplicate text.
- A run that overlaps the next one (the 30 s cap makes this unlikely). Use `onlyIfMatch`; the loser re-reads once and skips its text if the winner already texted this hour (`last_alert_at` within 50 minutes).

Do not use the shared `src/db.mjs` pool for BEGIN/SET (`src/db.mjs`, the shared `pool()` and `db.query`): the incident/alert writes are plain single statements, which is fine. Only the door-side pulse transaction (workflow 0) needs its own connection.

---

## 6. Open items and unknowns (do not guess)

1. **Issues are off and there is no key on Netlify.** Without both, `createIssue` returns "not set" and the text still goes. Alerts must degrade, never fail the run.
2. **Does the Claude "issue opened" trigger exist for this repo?** Nothing in the repo or env names shows the Claude GitHub app is installed or that a routine exists. Workflow 3 must prove it. If the trigger cannot read issues from a public repo with the label filter, the fallback is the runner calling the routine's own fire URL: that is another outbound call, must be a provider module, and needs its own token (no env name for it exists today).
3. **Cost.** The owner memory note says "No API spend for now" (owner 10-06). A Claude routine session may draw on plan usage rather than API credit; not verified here. A storm of N issues would start N sessions; the storm rule helps but a per-hour cap on fixer launches (for example one new session per hour) belongs on the board.
4. **No record that an owner text has ever reached 480.** The code path is the same one the morning brief uses. The first live test text (workflow 3) is the only proof available.
5. **Label auto-creation** on issue create is believed but unproven here; create `pulse` by hand once.
6. **Public repo.** Section 3. Owner call only.
7. `GITHUB_REPO_TOKEN` is documented as "present" in `docs/specs/blueprint-funnel-test-plan-2026-10-06.md:169` but is absent from Netlify. That doc line is wrong today; not edited here.

## 7. Build list for workflow 1 (so nothing here is vague)

- `src/messaging/providers/github-issues.mjs` + `.test.mjs` (section 3 shape; ADAPTERS fence; `TRANSMITS = true`; no edit to `no-unfenced-transmit.test.mjs` needed).
- `src/pulse/alerts.mjs` (board names `src/pulse/beats/alerts.mjs`; put it outside `beats/` so a beat cannot import it): `decide(prev, now_results) -> actions`, `formatBreakText`, `formatFixedText`, `buildIssueBody`, `incidentStore` over Blobs with a Postgres mirror. The beat context must never receive the real `sendImpl` or token; only this module and the runner hold them, so a beat cannot send for real.
- `netlify/functions/pulse-hourly.mjs` (default export only, always returns 200, `noteScheduledRun`), `netlify.toml` block, entries in `scheduled-functions-return.test.mjs` and `heartbeats.mjs` `NETLIFY_JOBS`, registry row in `src/pulse/registry.mjs` (heartbeat law).
- New env names (set by an agent, one deploy): `GITHUB_ISSUES_TOKEN` (Chris's one click to make it), `PULSE_SECRET` (agent generates). Add both to `.env.example` as names only.
- `scripts/pulse/run-beat.mjs` (the reproduce command in section 4).
- One-time, with Chris's yes: turn on Issues; create labels `pulse`, `pulse-storm`.
