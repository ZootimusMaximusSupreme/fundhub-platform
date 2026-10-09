# Heartbeat on every build

**Owner law (2026-10-07):** Every new live page, routed api handler, Inngest job, or outbound send path gets a heartbeat row in the SAME change. The morning pulse checks it. A job is red if it has not run in 3 times its schedule. The pulse only reports. It never auto-fixes. Chris fixes reds. Missing heartbeat on a new build is a failed change.

**Extended (owner-set 2026-10-09): the heartbeat is a tripwire.** It must go red before a customer hits the break, so we do not lose money. An "is it up" ping is not enough for anything that touches money or a paying customer. That needs a deep check: one that reads the data, or runs the real handler, and goes red when the customer's result is wrong.

How it works, in one picture: `docs/journeys/heartbeat-flow.md`.

## Always — in the same change as the build

1. **The ping row.** Pages and routes: `src/pulse/registry.mjs` (`PULSE_REGISTRY`). Timed jobs: `src/pulse/heartbeats.mjs` (`JOBS`). Text, email or mail sends: `SEND_PATHS`. The checks are `src/pulse/registry.test.mjs` and `src/pulse/heartbeats.test.mjs`.
2. **The tripwire, for money or a paying customer.** A deep check in `src/pulse/coverage/gap-<lane>.mjs`: `export async function gapChecks(ctx)` returns rows `{ id, status, detail, suggestedFix }`, status `PASS`, `FAIL` or `skip`. Ask one yes-or-no question a customer would feel: "did every paid client get the portal?", not "does the page answer?"
3. **In the tripwire map.** Every page, route, Inngest job and send is sorted in `src/pulse/tripwires.mjs`: money or customer goes in `TRIPWIRES` with the deep check ids that go red on its break; staff-only or internal goes in `NOT_CUSTOMER_FACING` with a reason. `src/pulse/tripwires.test.mjs` fails the build until it is sorted. `tripwires-baseline.json` holds what existed on 2026-10-09 and only shrinks — never add to it.
4. **On the list.** Any new coverage file goes on the literal list in `src/pulse/coverage/modules.mjs`. A folder scan finds nothing in the live bundle. `modules.test.mjs` fails until it is listed.
5. **Under the clock.** Each gap lane runs in its own Inngest step. Keep a lane under 20 seconds. Netlify cuts every step at 26 seconds.
6. **Read only.** `ctx.db` is a shared pool: never send BEGIN, COMMIT, ROLLBACK or SET on it. Web calls are GET or HEAD only. No text, no email, no AI call, no Plaid, no credit pull, no card charge.
7. **No repo files at run time.** The live bundle does not carry route source files or `netlify.toml`. Use the `ROUTES` map, import the handler, GET the live door, or read the database.
8. **Honest status.** A failed read is `skip` with the reason. Never `PASS`. A check that can only pass, or only skip, is not a tripwire.
9. **Tests both ways.** At least one PASS test and one FAIL test that would break if the logic broke. Never delete, skip or weaken a test.
10. **Prove it like the server runs it.** Run `npm run pulse:prove`. It builds the real Netlify bundle and runs every pulse step from inside it, read-only, on live data. It must say OK before you call the build done.
11. **The hourly beat, for money or a paying customer (owner-set 2026-10-09).** Every hour the company tests itself (`netlify/functions/pulse-hourly.mjs`, minute 7): a beat is a small read-only check in `src/pulse/beats/beat-<id>.mjs`, on the literal list `src/pulse/beats/index.mjs`. It names the surfaces it guards in `covers`, the steps it passes (the step name is what the text reports when it stops), a `fixGuide` (line 1 goes in the text; likely causes, steps, files), and a `selfTest` with a pass and a fail. `src/pulse/beats/beats.test.mjs` fails the build if a beat is missing from the list, has no fix guide, cannot go red, or imports anything that could write or send.
12. **A beat reads. It never writes or sends.** It gets only `ctx.read` (a box where Postgres itself refuses writes), `ctx.http` (GET and HEAD) and the frozen `ctx.env`. No database module, no fetch, no provider, no event. The runner alone saves results, and only into the three `pulse_*` tables.
13. **Learn from every break.** When someone fixes a pulse break, fill `cause_category`, `cause_note`, `fix_summary` and `guard_added` on its `pulse_incidents` row and add an entry to `docs/lessons/pulse-lessons.md`. Read that file before writing a new fix guide or a new beat, so the same mistake is not built twice.
14. **Prove the hourly pulse from the bundle.** `npm run pulse:prove -- --beats` builds the real function, runs every beat from inside it, read-only, and must say OK. `node scripts/pulse/run-beat.mjs <id>` runs one beat live; `--selftest <id>` shows it green and red; `--probe` proves Postgres refuses writes.

## Never

- Ship a new live page, routed api handler, Inngest job, or outbound send path with no heartbeat row.
- Ship a money or customer path with only a ping.
- Call a check covered because its unit test is green. Prove it from the bundle.
- Let the pulse auto-fix.
- Make a beat write, send, or call a vendor with anything but GET or HEAD.
- Send a test signal through a door that saves data until that is proven on a scratch database and the owner has watched one run (the write-through half is not built yet).
- Add a surface to `tripwires-baseline.json`, or raise `BASELINE_MAX`.
- Weaken `src/pulse/registry.test.mjs`, `src/pulse/heartbeats.test.mjs`, `src/pulse/tripwires.test.mjs`, `src/pulse/beats/beats.test.mjs` or `src/pulse/coverage/modules.test.mjs`.

## Example

```text
Ask: "Add the $297 roadmap checkout."

❌ Add the page and a reg: ping. Say the deep check comes later.
✅ Same change: the reg: ping for the page and the webhook route, and a gap check that goes red when a
   paid roadmap order has no entitlement or no delivery after its window. It is on modules.mjs, it has a
   PASS and a FAIL test, and npm run pulse:prove says OK.
```
