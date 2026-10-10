# Outside Inngest — heartbeat gaps

Lane: `outside-inngest`. A new lane. Morning pulse. Report only.

Every alarm we have runs on Inngest, the engine that runs our timed jobs. If the engine stops, the 6 a.m. text, the 5-minute watch and the 9 p.m. brief all stop together. Nothing outside the engine tells anyone.

The full fix is a clock outside Inngest (a Netlify scheduled function) that texts Chris. That is a new function and a new text path. It waits for Chris's go (worklist, lane 12). This lane builds the parts that can be built now, from inside the morning job, with reads only. Three checks.

Files:

- `src/pulse/coverage/gap-outside-inngest.mjs`
- `src/pulse/coverage/gap-outside-inngest.test.mjs`

## Tier 1 — Claude, 2026-10-09

Built from `ops/workflows/heartbeat-complete-2026-10-09-worklist.md`, lane 12. Two checks first. A third was added in the fix pass below. Each asks one yes-or-no question a customer would feel.

| Check id | The question | Red when |
|---|---|---|
| `outside:inngest-crons-stale` | Did the engine that runs our alarms go dark? | In the last 24 hours, `message-dispatch-sweeper` or `pulse-instant-watch` has a quiet stretch over 20 minutes. Both run every 5 minutes. A stretch that began before the 24 hours and ended inside them counts, from its true start. The stretch from the newest receipt to now counts too. |
| `outside:health-down-text` | If the database is down, will the 5-minute alarm text? | The real 5-minute watch, run against a pretend dead database, crashes, hangs, or ends without sending a text. |
| `outside:morning-pulse-down-run` | If the database is down, does the 6 a.m. pulse still finish? | The real 6 a.m. pulse, run against a pretend dead database, crashes, hangs, returns no rows, or finishes without calling the site down. (Added in the fix pass.) |

### Where I changed the plan, and why

I looked at the real code and the real data. Two parts of the plan needed to change.

1. **"Newest receipt over 20 minutes old" is already watched.** The morning pulse has a row for each job (`job:message-dispatch-sweeper`, `job:pulse-instant-watch`). It goes red at 15 minutes. Same question twice would print twice.
   - What nobody asks is the history. Say the engine is down from 3:05 to 3:50 a.m. and comes back. At 6 a.m. the newest receipt is fresh. Every job row is green. Chris never learns his alarms were blind for 45 minutes.
   - So this check reads the last 24 hours of receipts and goes red on any quiet stretch over 20 minutes. It also catches "stopped right now", so it covers everything the plan asked for.
   - Same cause covers a database outage. When the database is down, no receipt can be saved. The gap shows up the same way.
   - Each stretch is printed in Arizona time, with the name of the job and what it does.
2. **"GET `/api/health` from the Netlify clock" is already watched too.** The morning pulse and the 5-minute watch both GET `/api/health?strict=1` (check id `health`). That is not the hole.
   - The hole is what happens after health says the database is down. The 5-minute watch reads the database again before it texts (`defaultOrgId` in `src/pulse/instant-watch.mjs`). Nothing catches a failure there. So it crashes and sends no text.
   - So this check runs the real watch against a database that is down. The web client and the text sender are pretend ones made inside the check. Nothing real is read or sent.

### How each check behaves

- **Receipts check.** Two reads of `job_heartbeats`. First: the two jobs, the last 24 hours. Second: the newest receipt of each job **before** the 24 hours (that is where the first stretch starts, however far back it is). It looks at `finished_at`. A stretch is red only if it is **over** 20 minutes. Exactly 20 is fine.
  - A job with no receipt in the 24 hours but one before that: red, dark since then.
  - A job with no receipt before its first one in the window, and that first one came more than 20 minutes after the window opened: still PASS, but the row says the earlier part of the day is not proved.
  - A job with no receipt at all: `skip` with the reason. New or renamed. Not proved quiet. Never PASS.
  - A failed read: `skip` with the reason.
  - At most 3 stretches are printed. The rest are counted.
- **Outage check (5-minute alarm).** Takes about 0.1 second. The pretend database fails every question. The pretend web client answers every door with 503. The pretend sender records each text and sends nothing. The phone number is a made-up one (555 area). A hung watch is told apart from a crashed one.
- **Morning pulse check.** Runs the real `runDailyPulse` with the same pretend database and web. It also gets a pretend text sender, no folder to read (`gateRelayDirs: null`), an empty coverage list (so it cannot call this lane again), `dryRun` on, `recordRun` off, no text, and a scorecard folder that cannot exist (`/dev/null/...`), so no file is left behind. About 20 ms.
- All three checks send nothing, write nothing, and read no repo file. The only real reads are the two SELECTs. The lane reads only `db` and `now` from what the 6 a.m. job hands it. The three run side by side, so the lane cannot go past 20 seconds.
- The PASS row for the receipts check says in plain words that it runs inside the morning job, so it sees an outage that ended, not one still going at 6 a.m. The ids start with `outside:` because that is the hole they aim at.

(The numbers for the first build are replaced by the fix-pass numbers at the end of this file.)

### Real breaks found (owner hard lock: not fixed here)

**Break 1 — the 5-minute alarm.**

**The 5-minute alarm crashes when the database is down, so it sends no text.** In `src/pulse/instant-watch.mjs`, after the web checks, it reads the default org from the database with no catch. A dead database throws there. The text is never sent. The same first read, with no catch, sits in the 6 a.m. job (`defaultOrgId` in `src/pulse/daily-pulse.mjs`, in `runDailyPulse`). When the database is down, the one time the alarms matter most, nobody is told. This check is red every morning until it is fixed. The one-line fix I tested in scratch is: wrap that read in a try/catch and carry on with no org.

**Break 2 — the 6 a.m. pulse.** `runDailyPulse` reads the default org first (`orgId || await defaultOrgId(db)`, `src/pulse/daily-pulse.mjs` line 382) with nothing to catch it, and the 6 a.m. job calls it without an org. A dead database throws there, the `run-pulse` step fails, and the morning brief step after it never runs. This is the same break, in the second place. It has its own row now (`outside:morning-pulse-down-run`), so fixing the 5-minute alarm does not make the hole look closed.

### Not built, and why

- **The clock outside Inngest** (`netlify/functions/pulse-outside-watch.mjs`, plus a `SEND_PATHS` row and a `JOBS` row). It needs Chris's go. It is a new text path. It is also the only thing that can see a total engine outage. These two checks run inside the engine. If the engine is fully dead at 6 a.m., they never run. They see an outage that has already ended, or one job lost while the engine is up.
- **The morning brief step.** The 6 a.m. pulse is now checked (`outside:morning-pulse-down-run`). The brief that runs after it (`morningBrief`) is a separate path. It is not run here. If it needs its own dead-database check, that is another lane's row.
- **"Reading Inngest's own run list."** `GET /api/inngest` answers 401 without a signed request (I asked once, 2026-10-09). The registry already says it is not a GET door. The two keys it needs are checked by `keys:inngest-event-key`.

### Needs doing by Claude (not in this lane's files)

- Add `["gap-outside-inngest.mjs", () => import("./gap-outside-inngest.mjs")]` to `GAP_FILES` in `src/pulse/coverage/modules.mjs`. Until then `modules.test.mjs` and one `run-slices.test.mjs` test fail on the new file.
- Add the ids to the tripwire map (`src/pulse/tripwires.mjs`). Surfaces in `tripwires-baseline.json` they cover: `job:message-dispatch-sweeper` (name `outside:inngest-crons-stale`), `job:pulse-instant-watch` (names `outside:inngest-crons-stale` and `outside:health-down-text`) and `job:daily-pulse` (name `outside:morning-pulse-down-run`). Move those out of the baseline when you sort them.
- Run `npm run pulse:prove` once the lane is on the list.

## Tier 1 — Claude, 2026-10-09 (fix pass after the checker)

An independent checker found four problems. Here is each one and what I did. Real numbers, all seen.

### 1. HIGH — a false PASS (fixed)

**The problem.** The receipts check read 24 hours plus one extra hour. If the engine went dark more than 25 hours ago and came back inside the last 24 hours, the receipt that started the dark stretch was not in what the check read. The stretch was never measured. The row said "ticked through the last 24 hours" while the engine had been dark for most of them.

**The fix.** The check now makes a second read: the newest receipt of each job **before** the 24 hours (`PRIOR_SQL`, `finished_at < window start`, one row per job). That receipt starts the first stretch, however far back it is. The fixed one hour extra read is gone.

**Proof.**

- The checker's own repro (receipts 42 to 40 hours ago, nothing for 37 hours, then every 5 minutes): was PASS, now FAIL. "saved no run from Oct 7, 2:00 PM to Oct 9, 3:03 AM, 37 h 3 min".
- On the **real** receipts, read-only, with a hole cut out from 3 hours before the window to 25 minutes after it: the old lane said PASS. The new lane says FAIL, "Oct 7, 9:55 PM to Oct 8, 1:25 AM, 3 h 30 min", for both jobs. A write was tried and refused: `cannot execute INSERT in a read-only transaction`.
- The new read works on the real table: with a 6 hour window it returned the real newest receipt before the window for both jobs.
- New tests: the tail-only outage; a hole that opens before the window and closes just after it; a receipt only 3 minutes before the window (short first stretch, PASS); a job with no receipt before its first one (PASS, but the row says the earlier part is not proved); a first receipt 10 minutes after the window opened (not called a late start).

### 2. MEDIUM — hollow SQL tests (fixed)

**The problem.** The fake database in the tests re-did the `WHERE` filter in JavaScript. So flipping the time filter or the job filter in the SQL left all 37 tests green.

**The fix.**

- A new block of 5 tests runs `RUNS_SQL` and `PRIOR_SQL` for real on Postgres, over fixture rows (a CTE named `job_heartbeats`, like `gap-jobs.test.mjs`). SELECT only, nothing stored. It checks: only the two jobs; the cut at exactly the window start (a receipt at the start is in the window, not before it); oldest first; one row per job; the newest before the start; and an end to end run on the engine. It is skipped when `DATABASE_URL` is not set, like every `.pg.test.mjs`.
- The SQL text is pinned tightly too, so the no-database run catches a flip: `AND finished_at >= $2`, `AND finished_at < $2`, `WHERE job = ANY($1::text[])`, `ORDER BY job, finished_at` at the end, `GROUP BY job`.

**Proof.** The checker's three flips (`>=` to `<=`, `= ANY` to `<> ALL`, and the same flip on the second read) all turn a test red, without the database (the text pins catch them) and with it. With the text-pin test switched off, the real-SQL block alone still catches all 12 I tried: 6 flips of the first read, and 4 flips of the second read plus 2 flips of how its answer is used.

### 3. MEDIUM — only half the hole was watched (fixed)

**The problem.** The 6 a.m. pulse crashes on a dead database the same way as the 5-minute alarm. Nothing watched it. Once Chris fixed the 5-minute alarm, the old row would go green and the hole would look closed.

**The fix.** A third check, `outside:morning-pulse-down-run`. It runs the real `runDailyPulse` against the pretend dead database, with everything that could reach outside shut (see "How each check behaves"). I checked it is safe: run past the one failing read, the real pulse takes 21 ms, makes 401 pretend web calls, 0 real ones, builds 411 rows, writes no file (the folder cannot exist), and sends and records nothing.

**Proof.**

- Live today it is FAIL. That is the real break (Break 2 above).
- A scratch copy of `daily-pulse.mjs` with that one line wrapped in a try/catch makes the same check PASS, in 19 ms: "still ran to the end (411 rows) and reported the site down". So it goes green on the exact fix and not before. No product file was touched.
- Tests: PASS, FAIL on a crash, FAIL on a hang, FAIL on no rows, FAIL on a pulse that swallows the 503, FAIL on no health row, the exact arguments handed in (dead database, no org, empty settings, dry run, no record, no text, no folder, empty coverage list, unwritable scorecard folder), and the real pulse past the read: it ends cleanly, touches no real web, writes no file.

### 4. MEDIUM — a total engine outage is still not seen (not fixed, here is why)

This is true and it was already on the list. The only thing that can see a total engine outage is a clock outside the engine (`netlify/functions/pulse-outside-watch.mjs`). That is a new Netlify function and a new text path. The worklist says build it only on Chris's go (lane 12), and this fix pass may only edit this lane's three files. So it stays in "Not built". It is **not** hidden any more:

- The PASS row for `outside:inngest-crons-stale` now says: "This check runs inside the morning job, so it sees an outage that already ended, not one still going at 6 a.m. The clock outside the engine that would see that is not built yet (it waits for Chris's go)."
- The ids keep the `outside:` prefix. I did not rename them. They name the hole they aim at, the plan and the tripwire map use these names, and a rename would break both. The header of the lane file says the same thing.

### Numbers

| What | Result |
|---|---|
| Lane tests, no `DATABASE_URL` | 55 tests, 55 pass, 0 fail, 0 skipped (the real-SQL block is skipped as a group) |
| Lane tests with the database (`--env-file` .env) | 60 tests, 60 pass, 0 fail, 0 skipped |
| Pulse folder (`src/pulse/**/*.test.mjs`) | 1497 tests, 1456 pass, 2 fail, 39 skipped. The 2 failures are `modules.test.mjs` and `run-slices.test.mjs` asking that every gap file be on the list. Claude adds `gap-outside-inngest.mjs` (and handoff, keys, leads) to `modules.mjs`. |
| `node scripts/lint.mjs` | 3140 files parse clean |
| Live tool (`gap-live.mjs outside-inngest`, read only) | prod, staff and bare modes agree: 1 PASS, 2 FAIL, 0 skip. 0 SQL errors, 0 write attempts, 0 web calls, 0 shape problems, 0 mode differences. It reads only `db` and `now`. 2 queries. About 0.34 s. |
| Built Netlify bundle (zip-it-and-ship-it with this repo's `included_files`) | 140 ms, 2 queries, 0 network calls. Same three results. |
| Mutants (see below) | I broke the lane 41 ways on purpose. 41 of 41 turn a test red, both without the database and with it. 2 of the 41 (taking out the hang guard) are caught because the test then hangs and the harness kills it at 120 s. My first run missed 1: flipping the sort to newest-first got past a loose text check. I made the check exact, and it is caught now. |

| Live check | Result today |
|---|---|
| `outside:inngest-crons-stale` | PASS. Each job saved 288 runs in 24 hours. Longest quiet stretch: 8 min. Limit: 20 min. |
| `outside:health-down-text` | FAIL. Real break 1. |
| `outside:morning-pulse-down-run` | FAIL. Real break 2. |

`npm run pulse:prove` still cannot include this lane until it is on the list in `modules.mjs`.
