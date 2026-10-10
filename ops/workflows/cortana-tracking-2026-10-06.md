# Cortana tracking — feed it every event (2026-10-06)

Chris asked: "We need to ensure cortana, which is a marketing tracking software, tracks really well. All info needs to be fed to cortana as well." Paul at DirectROAS asked for it.

Status: **waiting for Chris's go.** No workflow starts until he says go.

## What is there today (measured 2026-10-06, before any work)

- **Cortana is DirectROAS's tracker.** `.env` line 105: `DirectRoas / Cortana Commas read + webhooks`.
- **Browser tag:** the DirectROAS hub script (`https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w`) is pushed into ClickFunnels page heads by `marketing/landing-pages/tracking-manifest.mjs` (`directRoasHeadHtml`). Override: `DIRECT_ROAS_HUB_URL`.
- **Not on Fundhub-hosted pages:** a grep of `public/` finds no `directroas` tag. Anything a buyer sees on fundhub.ai (pay page, portal) is not tagged.
- **Money:** Cortana has its own Commas key, `CORTANA_COMMAS_API_KEY` (set in `.env`). The `.env` note says Cortana reads Commas and gets Commas webhooks. Not yet proved that every $297 sale shows up in Cortana.
- **No server feed:** nothing in `src/` sends events to DirectROAS. Meta gets server events (CAPI); Cortana does not.
- **Meta event map:** `marketing/ads/apply-survey-meta-tracking-2026-09-30.md` lists the funnel events (PageView, Lead, Schedule, InitiateCheckout, Purchase) and where each fires. Use it as the starting event list.

## The chain

Cortana tracks well only if all four hold:

1. **Tag** — the DirectROAS script loads on every page a buyer touches.
2. **Events** — each step (lead, booking, checkout start, purchase) fires a named event the script can see.
3. **Identity** — the ad click id, UTMs, and email ride along from ad → survey → booking → checkout, so Cortana can tie a sale to the ad.
4. **Server feed + proof** — sales and bookings reach Cortana even when the browser is blocked, and Cortana's counts match Fundhub's database.

One workflow per link. No hard dependencies — all four run at the same time.

One soft clash: W1 and W2 both push ClickFunnels pages. W1 owns the `<head>` tag only. W2 owns event calls in the page body only. Read this board before every push.

Each workflow makes its own test data, tagged `test-cortana-tracking-2026-10-06`.

## Tasks

| # | Link | Owner | Status |
|---|---|---|---|
| W1 | Tag — script on every buyer page | this session | pending |
| W2 | Events — each funnel step fires a named event | open | pending |
| W3 | Identity — click id, UTMs, email carried end to end | open | pending |
| W4 | Server feed + proof — sales/bookings reach Cortana, counts match | open | pending |

## Shared rules for every workflow

- Read `CLAUDE.md` first. Model: Opus.
- Work in your own worktree: `.claude/worktrees/cortana-tracking-wN` (never switch the main checkout's branch).
- Claim your row above (`claimed`) before you start. Write your manifest below when done.
- Own only your link. Found a break in another link? One leftover card below, then keep going on yours. Do not fix it.
- ClickFunnels work goes through the API only (`scripts/cf-push-custom-html.mjs`). Chris never logs in.
- Tracking tags are not copy. No words on any page change. If a page's words must change, stop and use the marked-draft law.
- Proof is live: a real visit / lead / booking / test purchase seen in the browser network log and in Cortana, not just green tests.
- Never delete data. Never remove a key. Test rows stay tagged.
- Update the matching `docs/journeys/*-actual.md` + `docs/journeys/CHANGELOG.md` for any flow you change.
- Commit locally every session. Push with `node scripts/github-push-whole-repo.mjs`. Ship once with `npm run ship`.

---

## Copy-paste prompts

### W1 — Tag (this session)

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W1 — Tag. Claim it.

Goal: the DirectROAS (Cortana) hub script loads on every page a buyer touches.

1. List every buyer page: all ClickFunnels steps on apply.fundhub.ai (ads land here, survey, booking, thank-you, /roadmap) and every Fundhub-hosted page a buyer sees (public/ — pay page, portal login, any thank-you). Source: tracking-manifest.mjs, marketing/landing-pages/**, public/**.
2. For each page, load it live and record: does app.directroas.com load once (not twice, not zero)?
3. Add the tag where it is missing. ClickFunnels: through tracking-manifest.mjs + scripts/cf-push-custom-html.mjs. Fundhub pages: the same script src from directRoasScriptSrc(). One tag per page.
4. Prove live: every page loads the hub script exactly once (cache-bust ClickFunnels URLs). Write the page table to the board.
Do not add event calls (W2) or touch UTMs (W3). Worktree: .claude/worktrees/cortana-tracking-w1.
```

### W2 — Events

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W2 — Events. Claim it.

Goal: each funnel step fires a named event the DirectROAS (Cortana) script can see.

1. Find DirectROAS's own docs for how its hub script takes custom events (look it up on the web and in the loaded script; do not guess the call shape). If there is no event call, write that on the board as the finding and stop.
2. Start from marketing/ads/apply-survey-meta-tracking-2026-09-30.md: Lead (survey done), Schedule (call booked), InitiateCheckout ($297 pay click), Purchase ($297 paid). Add any other money step you find in the code.
3. Fire each event at the same moment Meta's event fires, with the same event_id, value, and currency.
4. Prove live with a tagged test run: each event shows in the browser network log to app.directroas.com, and in Cortana.
W1 owns the <head> tag. You own body event calls only. Worktree: .claude/worktrees/cortana-tracking-w2.
```

### W3 — Identity

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W3 — Identity. Claim it.

Goal: Cortana can tie every lead, booking, and sale back to the ad that caused it.

1. Trace what rides along today from ad click to sale: fbclid / fbc / fbp, utm_* (utm_content = ad id), DirectROAS's own visitor id (find its cookie/param name from its docs or the live script), email, phone.
2. Find every hop where one is dropped: ad → ClickFunnels survey → booking calendar → /roadmap widget → Commas checkout → Fundhub database.
3. Carry them through. Commas: put them on the checkout session metadata so Cortana's Commas read sees them.
4. Prove live: one tagged test path from a fake ad URL with utm_content=<real ad id> ends with the same ids on the Commas payment and the Fundhub row.
Do not add the script tag (W1) or event calls (W2). Worktree: .claude/worktrees/cortana-tracking-w3.
```

### W4 — Server feed + proof

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W4 — Server feed + proof. Claim it.

Goal: sales and bookings reach Cortana even when the browser blocks scripts, and Cortana's numbers match ours.

1. Look up DirectROAS / Cortana's server intake: API, webhook, or integration list (web docs, the Commas link via CORTANA_COMMAS_API_KEY in .env). Write what you find on the board. If Cortana has no server intake, that is the finding — say so and skip to step 4.
2. Prove the Commas link: are the last 30 days of $297 sales in Fundhub's database also in Cortana? Count both.
3. If there is a server intake: send Lead, Schedule, and Purchase server-side, behind a new provider module in src/messaging/providers/ (outbound fetch is allowed only there), with the same event_id as W2.
4. Write a count check: for a date range, Fundhub leads / bookings / sales vs what Cortana shows. Put the numbers on the board.
Worktree: .claude/worktrees/cortana-tracking-w4.
```

---

## Manifests

(each workflow writes here when done)

## Leftover cards

(breaks found outside your link — one card each, no fixing)
