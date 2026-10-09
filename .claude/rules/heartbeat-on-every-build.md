# Heartbeat on every build

**Owner law (2026-10-07):** Every new live page, routed api handler, Inngest job, or outbound send path gets a heartbeat row in the SAME change. The morning pulse checks it. A job is red if it has not run in 3 times its schedule. The pulse only reports. It never auto-fixes. Chris fixes reds. Missing heartbeat on a new build is a failed change.

**Extended (owner-set 2026-10-09): the heartbeat is a tripwire.** It must go red before a customer hits the break, so we do not lose money. An "is it up" ping is not enough for anything that touches money or a paying customer. That needs a deep check: one that reads the data, or runs the real handler, and goes red when the customer's result is wrong.

How it works, in one picture: `docs/journeys/heartbeat-flow.md`.

## Always — in the same change as the build

1. **The ping row.** Pages and routes: `src/pulse/registry.mjs` (`PULSE_REGISTRY`). Timed jobs: `src/pulse/heartbeats.mjs` (`JOBS`). Text, email or mail sends: `SEND_PATHS`. The checks are `src/pulse/registry.test.mjs` and `src/pulse/heartbeats.test.mjs`.
2. **The tripwire, for money or a paying customer.** A deep check in `src/pulse/coverage/gap-<lane>.mjs`: `export async function gapChecks(ctx)` returns rows `{ id, status, detail, suggestedFix }`, status `PASS`, `FAIL` or `skip`. Ask one yes-or-no question a customer would feel: "did every paid client get the portal?", not "does the page answer?"
3. **On the list.** Any new coverage file goes on the literal list in `src/pulse/coverage/modules.mjs`. A folder scan finds nothing in the live bundle. `modules.test.mjs` fails until it is listed.
4. **Under the clock.** Each gap lane runs in its own Inngest step. Keep a lane under 20 seconds. Netlify cuts every step at 26 seconds.
5. **Read only.** `ctx.db` is a shared pool: never send BEGIN, COMMIT, ROLLBACK or SET on it. Web calls are GET or HEAD only. No text, no email, no AI call, no Plaid, no credit pull, no card charge.
6. **No repo files at run time.** The live bundle does not carry route source files or `netlify.toml`. Use the `ROUTES` map, import the handler, GET the live door, or read the database.
7. **Honest status.** A failed read is `skip` with the reason. Never `PASS`. A check that can only pass, or only skip, is not a tripwire.
8. **Tests both ways.** At least one PASS test and one FAIL test that would break if the logic broke. Never delete, skip or weaken a test.
9. **Prove it like the server runs it.** Run `npm run pulse:prove`. It builds the real Netlify bundle and runs every pulse step from inside it, read-only, on live data. It must say OK before you call the build done.

## Never

- Ship a new live page, routed api handler, Inngest job, or outbound send path with no heartbeat row.
- Ship a money or customer path with only a ping.
- Call a check covered because its unit test is green. Prove it from the bundle.
- Let the pulse auto-fix.
- Weaken `src/pulse/registry.test.mjs`, `src/pulse/heartbeats.test.mjs` or `src/pulse/coverage/modules.test.mjs`.

## Example

```text
Ask: "Add the $297 roadmap checkout."

❌ Add the page and a reg: ping. Say the deep check comes later.
✅ Same change: the reg: ping for the page and the webhook route, and a gap check that goes red when a
   paid roadmap order has no entitlement or no delivery after its window. It is on modules.mjs, it has a
   PASS and a FAIL test, and npm run pulse:prove says OK.
```
