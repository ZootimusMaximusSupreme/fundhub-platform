# Pulse contract — critic findings (Opus, 2026-10-09)

Verdict: **go-with-changes**

Go with changes. Tonight, ship only the safe half: beats with no database box (bank Apply links, vendor key checks, door GETs) and read-only checks run inside BEGIN READ ONLY, where Postgres itself refuses writes. The beats that write inside a rolled-back box must wait. They have never run on a real Postgres. The CI twin test is the only proof, and CI on main is already red. Their first run would be unattended against production on launch night.

The design has seven high issues:
1. The whole runner runs inside the 'real' store (contract 3.1), so a callback that loses its context falls back to the real database and the real web. That undoes the promise that no context means refuse.
2. Late refused promises have no catch. On Node 22 that kills the run: no records, no text, and Netlify retries it twice.
3. The time caps add up to 28 s against a 22 s budget and a 30 s kill, and the text is sent last.
4. Comments on the PUBLIC repo are trusted. Anyone can close an incident with a fake lesson, plant a claude.ai link that gets texted to Chris, or stall the fixer.
5. main is unprotected (measured protected:false). Only a line in the prompt stops the fixer from pushing to it.
6. The api.mjs edit adds no safety tonight. Nothing reads x-fundhub-pulse today (grep: 0 hits), and in Mode A the gate can live in ctx.door. As written it has no off switch.
7. The rollback-on-disconnect promise assumes the Postgres socket dies. Through the Supavisor transaction pooler (laptop URL is port 6543) it does not, and that is not measured.

There are also seven medium issues: SQL sorted by its first word (a multi-statement or object-form COMMIT would commit), alert flapping, pooler slots held during vendor reads, silent alert failure with a green heartbeat, the new-lead path never tested, I/O imports the beat guard cannot see, and no check that the timed function cannot be called by URL.

Checks that came back clean: no dblink, pg_net or http extensions, so a trigger cannot send anything out; no serial columns on tonight's doors; no fire-and-forget calls on the door paths. Full brief: /Users/chrisstanbridge/Developer/fundhub-platform/ops/workflows/pulse-layer-2026-10-09-brief/08-adversarial-review.md

Builders and checkers: every issue below is a test or a rule you must satisfy or consciously rule out in writing. Tonight's scope is cut by ops/workflows/pulse-layer-2026-10-09-v1.md.

## 1. [HIGH] escapes / fail-closed

**What:** The runner runs every beat nested inside a 'real' store, so a lost async context falls back to REAL Postgres and REAL fetch.

**Failure scenario:** A door handler adds a listener to a long-lived emitter, or uses a callback API whose callback runs from the runner's code. The listener's pool.query or fetch then runs under the outer real store. It commits a row or sends a text for real, even though every beat was meant to fail closed.

**Evidence:** contract.md:434-441 (pulseHourly wraps runPulse in runReal). contract.md:40 says 'With no store, the answer is refuse'. contract.md:98 admits event-emitter listeners lose context. AsyncLocalStorage then falls back to the outer store, which is 'real'.

**Fix:** Run beats from a root with no store. Wrap only defaultOrgId, loadState, persist, writeBeatResults, act and noteScheduledRun, each in its own runReal. Add a test: a listener added in a beat and fired from runner code must hit pulse_no_store.

## 2. [HIGH] denial / silent failure

**What:** Nothing catches unhandled promise rejections, yet the design expects late work to be refused after the box closes.

**Failure scenario:** Some code without a catch sends a query or fetch after its box closed. The rejection is unhandled, so the run dies before records and alerts. Chris gets no text. Netlify re-runs the pulse twice, so 3x box connections and bank GETs.

**Evidence:** contract.md:255-258 (late work hits pulse_closed). grep for unhandledRejection in the contract and src/: none. Node 22 (netlify.toml:90) ends the process on an unhandled rejection. scheduled-functions-return.test.mjs:5-16: Netlify retries a failed timed run twice more.

**Fix:** install.mjs adds process.on('unhandledRejection'). It swallows PulseRefused (counted as closedLate) and records anything else on the run result. Prove it in the child-process install.test.mjs.

## 3. [HIGH] denial / false silence

**What:** The time plan is over budget, and the alert text is sent last.

**Failure scenario:** The database is slow (the exact moment beats go red). Box beats run to their deadlines and records time out. The function is killed before act() sends the text, and Netlify retries. The break goes unreported, and the dead-man watch only fires 3 hours later.

**Evidence:** contract.md:404-411 and 466-472. The caps add up to 2.5 (org) + 2 (loadState) + 13 (beats) + 2 (persist) + 2.5 (records) + 6 (alerts) = 28 s. RUN_BUDGET_MS is 22 s and Netlify kills at 30 s. Cold start of the full api graph is unmeasured (contract.md:1056).

**Fix:** Use one deadline counted from handler entry. Order the work as beats, then the text, then records/issues. Keep 6 s for the text. Measure cold start in pulse:prove and fail the proof above a set number of seconds.

## 4. [HIGH] forgery / learning loop

**What:** The runner and the fixer trust any GitHub comment on a PUBLIC repo: pulse-lesson blocks, pulse-fixer session links and claimed markers.

**Failure scenario:** Any GitHub user comments on a pulse issue. They can: post a fake pulse-lesson so the incident closes with a made-up cause and guard (poisoned lessons); post 'pulse-fixer: session https://claude.ai/<attacker page>' that gets texted to Chris as 'Claude is on it'; or post 'pulse-fixer: claimed' so the fixer never runs. Public issues also show live outage details for the payment door.

**Evidence:** contract.md:716 (newest pulse-lesson block closes the incident as closed_by=claude). contract.md:773 and 826 (session url read from comments and texted, 787). contract.md:848 (fixer stops on any 'pulse-fixer: claimed'). GitHub API 2026-10-09: private:false. The scrub at contract.md:809 does not block payment ids or amounts.

**Fix:** Keep pulse issues in a PRIVATE repo. In every comment reader (runner and fixer), accept only comments by the token owner or the Action's bot. Only the Action may write the session link.

## 5. [HIGH] fixer safety

**What:** Nothing stops the fixer from pushing to main. Only the prompt does, and the session reads untrusted text.

**Failure scenario:** A redirected bank page or a crafted issue detail prompt-injects the fixer. It pushes to main, which the next ship deploys. Or it pushes a claude/ branch that adds an on:push workflow that leaks the repo secrets.

**Evidence:** GitHub API 2026-10-09: main protected:false. Brief 05:45 says the GitHub proxy 'does not limit which branch (use branch protection)'. contract.md:845 relies on prompt words. contract.md:850 lets the fixer fetch bank pages with Full network. A pushed branch with a workflow file can read repo secrets such as PULSE_FIXER_TOKEN (contract.md:824).

**Fix:** Before turning on the routine: (1) add a rule on main that only the owner can push, with an admin bypass so github-push-whole-repo.mjs still works; (2) limit the routine to claude/ branches; (3) check that the Claude app cannot write .github/workflows; (4) in pulse-fixer-dispatch.yml, pass the issue title and body through env:, never ${{ github.event.issue.* }} inside run:.

## 6. [HIGH] launch risk / hot path

**What:** The api.mjs gate edit is a launch-night change to every request's path. It adds no safety tonight and has no off switch.

**Failure scenario:** A bad import or a throw in the new module stops the live api bundle from loading. Login, checkout and webhooks all 502 on launch morning. The only way back is a redeploy.

**Evidence:** grep 'x-fundhub-pulse' in src/, api/ and netlify/: 0 hits, so a header on the live site is an ordinary request. contract.md:21 (K1): in Mode A only ctx.door calls api.mjs in-process. contract.md:240-251: three edits plus a new import graph (context.mjs, sign.mjs, pulse-doors.mjs) loaded into the live api bundle. No kill switch anywhere in the contract (grep).

**Fix:** Tonight: zero edits to api.mjs, src/db.mjs, bus, outbound-fetch, the Commas door and instant-watch. Do the signature and PULSE_DOORS check inside ctx.door in the pulse process. After launch, if the live 403 is still wanted: 3 lines that run in order, no new imports, keyed on globalThis[Symbol.for('fundhub.pulse.process')]; an env kill switch; the no-header spy test; and Netlify instant rollback named as the way back.

## 7. [HIGH] escapes / launch risk

**What:** The rolled-back box has never run on a real Postgres. Its first run would be against production, and its timeout path relies on a socket that does not die behind the pooler.

**Failure scenario:** A builder runs prove --beats or ships tonight. If the facade has a bug, the very first run writes to the live database. Or a beat times out and the client is destroyed mid-transaction. If Supavisor hands that server connection on while still in a transaction, the next app client's COMMIT commits the pulse's rows.

**Evidence:** contract.md:281 and 951: the pg twin is CI-only. contract.md:506: no Postgres on the Mac. contract.md:1054: CI on main already red. contract.md:1046: prove --beats runs box beats on live data. contract.md:132: 'Postgres rolls back an open transaction when the socket dies.' The laptop DATABASE_URL is aws-1-us-west-2.pooler.supabase.com:6543 (Supavisor transaction mode), where the client socket closing does not close the Postgres backend. Not measured.

**Fix:** Tonight: only beats with no box, plus read checks inside BEGIN READ ONLY (Postgres refuses writes and nextval). The write-box door beats wait until the pg twin is green on that exact commit and a first run Chris watches says go. On timeout: wait out statement_timeout (5 s), send ROLLBACK, then destroy. Measure Supavisor's behaviour when a client drops mid-transaction, using a harmless read-only transaction.

## 8. [MEDIUM] escapes

**What:** The facade sorts statements by first keyword only. Multi-statement text and the object form slip past the COMMIT refusal.

**Failure scenario:** Future code runs db.query('UPDATE ...; COMMIT') or db.query({text:'COMMIT'}) on a door path. The facade lets it through and the box commits for real. commitsSent counts it only after the fact.

**Evidence:** contract.md:116-117 (first keyword, first 120 chars). pg sends a parameterless string as a simple query, which runs several statements. pool.query({text}) is a supported pg form. Compare isPlainRead's ';' rule at src/pulse/coverage/gap-sales-manager.mjs:168. No such caller today (grep: 0), so the risk is latent. Also contract.md:117 copies SIDE_EFFECT_FN (pg_advisory\w*, which matches the _xact_ forms) yet says the _xact_ forms are allowed.

**Fix:** Refuse any SQL whose ';' is followed by anything but spaces. Turn {text,values} into a plain string and refuse other non-string forms. Scan every token for COMMIT, END, ROLLBACK, BEGIN, SAVEPOINT and RELEASE. Settle the advisory-lock clash in writing.

## 9. [MEDIUM] false alarms / alert storm

**What:** There is no flap damping. One vendor blip opens an incident, an issue and a fixer session, then a FIXED text.

**Failure scenario:** Twilio, Resend or Commas is slow at minute :07. BROKEN text, new GitHub issue, fixer session (counts toward the 6-a-day cap), then FIXED an hour later. A few times a week and Chris learns to ignore the pulse.

**Evidence:** contract.md:772-778 alert on the first red run. The beats include live vendor GETs with an 8 s timeout (src/pulse/coverage/gap-keys.mjs:94). Brief 04 and the contract have no 2-in-a-row rule (grep). Each flap opens a new incident (contract.md:701), so a new issue each time.

**Fix:** Require 2 red runs in a row for steps that depend on a vendor or network read. Alert at once only for gate, door, rolled-back and no-unexpected-send failures. Reopen an incident closed less than 6 h ago instead of opening a new issue.

## 10. [MEDIUM] denial / pool

**What:** Each box holds a Supavisor server connection for the whole beat, including vendor reads made while the transaction is open.

**Failure scenario:** At :07, launch traffic plus 4 boxes, each pinning a pooler slot for 2-8 s, plus the commas sweeper. Real logins and checkout wait on the pooler or time out.

**Evidence:** contract.md:410: BOX_CONCURRENCY 4. Brief 02:65: 'Supavisor pool size is not verified'. Measured: max_connections 60, transaction pooler on port 6543. contract.md:115: 5 setup round trips per box. contract.md:990 and 995: vendor-key GETs inside box beats.

**Fix:** Use BOX_CONCURRENCY 2 for launch week. Do vendor reads before the box opens. Send BEGIN plus the SET LOCALs as one round trip. Measure the pooler's pool size before raising the limit.

## 11. [MEDIUM] false green / silent alerts

**What:** The alert path can fail silently while the heartbeat stays green.

**Failure scenario:** The alert's fetch loses its context inside undici. The L3 floor destroys the Twilio and ntfy sockets. No text arrives, yet the morning pulse shows pulse-hourly green.

**Evidence:** contract.md:155: with no store, the socket floor allows only the database host. undici can open sockets from callbacks whose context is lost. contract.md:473: ok is false only on a crash, env failure or records failure, so a failed text leaves job:pulse-hourly green.

**Fix:** Let L3 refuse only while a pulse store is active, and allow in the no-store and real cases. Set RunResult.ok = false (heartbeat red) when an alert that was due reached neither SMS nor ntfy.

## 12. [MEDIUM] false green

**What:** The new-lead path that every launch customer takes is never exercised.

**Failure scenario:** Tomorrow a change breaks client creation for new leads. All three lead beats stay green, because the door finds the seeded client.

**Evidence:** contract.md:32 (K12) and 994-996: lead-survey, checkout-mint and lead-cf-hook all seed a pre-made client. So resolveClient's create branch (src/handlers/client-lifecycle.mjs) and assign_client_code never run. The new-client variants wait on open decision 4 (contract.md:1002).

**Fix:** Say this limit plainly in each beat's title and fix guide and on the board. Put open decision 4 to Chris: a daily new-client variant, burning one FH number a day.

## 13. [MEDIUM] escapes / guard blind spot

**What:** Beats call I/O modules directly, which breaks the beat contract, and Guard 2 cannot see it.

**Failure scenario:** A tired builder uses dispatchDue to 'test the sweeper'. It claims real customers' queued texts inside the box. They are delayed while the box is open, and their phone numbers and bodies are captured into the beat's send log, which can feed issue text.

**Evidence:** contract.md:360 says beats import nothing that does I/O. Yet contract.md:978 and 989 have beats call processCommasInboxRow, sendTemplated and dispatchOne. Guard 2 assertion 8 (contract.md:934) checks only the beat file's own imports, not the modules those import. src/messaging/dispatch.mjs:199 and 806 (claimDue, dispatchDue) claim the next queued rows with FOR UPDATE SKIP LOCKED (line 253).

**Fix:** Add a static pin: text-path and email-path may reference only dispatchOne, with the beat's own message id, never claimDue or dispatchDue. Correct contract 2.3 to name the allowed I/O entry points per beat.

## 14. [MEDIUM] denial

**What:** No run-level throttle, and nobody checked that the scheduled function cannot be called by URL.

**Failure scenario:** Netlify retries after a crash, or a URL call reaches /.netlify/functions/pulse-hourly. Several full pulses run back to back, holding pooler slots and multiplying bank traffic.

**Evidence:** contract.md:419-443 has no 'one run per hour' guard. Duplicate texts are bounded (claimAlert, contract.md:702), but box connections, the 40 bank GETs and GitHub calls are not.

**Fix:** Add a run claim (a pulse_runs row, or pg_try_advisory_xact_lock in a real-store transaction) that allows one run per 50 minutes. Check on live that the scheduled function does not answer by URL.

## 15. [LOW] bank sites

**What:** Hourly GETs on partner Apply URLs that carry campaign codes.

**Failure scenario:** Bot hits from AWS addresses count as fake visits on credit unions' campaigns and trip bot walls. The beat then reads WALL forever and goes blind.

**Evidence:** Read-only query: 987 distinct Apply URLs (the board says 365). 335 are on creditcardlearnmore.com with ecid= codes, 176 on mycommunitycc.com with merchantId=, 60 on mycardapply.com. contract.md:991: 40 per run, at most 6 per host per run, so about 144 a day to one host.

**Fix:** Check Apply links once a day, not hourly. Refuse fundhub.ai hosts and private addresses in the '*' reads.

## 16. [LOW] false red / false green

**What:** In-process door requests carry no host, x-forwarded-for or user-agent headers.

**Failure scenario:** Any door that uses host or IP behaves differently in the pulse than for a real customer. That gives a red every hour, or a green on a path real traffic never takes.

**Evidence:** Measured: new Request('https://fundhub.ai/api/x').headers is empty. api/webhooks/[provider].mjs:61 builds the URL from req.headers.host. api/auth/magic-link.mjs:41-45 reads x-forwarded-for for the rate limit.

**Fix:** ctx.door sets host (from URL), x-forwarded-for (a fixed test address), user-agent 'FundhubPulse/1.0' and x-nf-client-connection-ip, the way Netlify does.
