# Card: gap-closer-setup joins the hourly lanes manifest as "not hourly"

Board: `ops/workflows/pulse-hourly-lanes-2026-10-09/spec.md` section 7 (the manifest standard).
Raised by: the closer and setter calendar setup build, 2026-10-09 (`ops/workflows/team-setup-pulse-2026-10-09.md`).
Status: pending (the manifest file does not exist yet, so there is no file to edit).

## What the manifest builder must add

When `src/pulse/lanes/manifest.mjs` is built, `HOURLY_LANES` needs one entry for the new lane file `gap-closer-setup`:

```js
"gap-closer-setup": {
  hourly: false,
  web: true,
  reason: "a person does not answer faster by the hour; the 6 a.m. run is enough"
}
```

If `src/pulse/lanes/manifest.mjs` already exists when you read this, add that row there and mark this card done.

## Why

- `hourly: false`. The lane reminds about a person's setup step (connect a calendar, join the booking page). The step has a due day measured in days. Running it every hour adds a page read and a read of the ask rows 23 more times a day and changes nothing a person can act on. The 6 a.m. run is enough.
- `web: true`. The lane reads one web page (the live booking page, one GET) through `ctx.fetchImpl`, so the guard in spec section 7 item 3 ("a lane with `web: false` has `fetch` or `fetchImpl` in its source") would fail it if it said `false`.
- The reason is 69 characters, over the 40 the guard needs for `hourly: false`.

## What does not change

- The lane is on the literal list `src/pulse/coverage/modules.mjs` (`GAP_FILES`), so it runs at 6 a.m. today.
- It is a reminder lane, not a tripwire: no entry in `src/pulse/tripwires.mjs` and no hourly beat. A skip from it lands in `audit:not-checked`.
- A lane in `GAP_FILES` with no manifest entry still runs and reads `unclassified` (spec section 7). So nothing breaks while this card waits.

## Manifest rule check for this row

| Guard in spec section 7 | This row |
|---|---|
| 1. file is in `GAP_FILES` and in `HOURLY_LANES` | `gap-closer-setup.mjs` is in `GAP_FILES`; this row adds it to `HOURLY_LANES` |
| 2. `hourly: false` reason is 40+ characters | 69 characters |
| 3. `web: false` lane has no fetch in its source | `web: true`, so the rule does not apply |
