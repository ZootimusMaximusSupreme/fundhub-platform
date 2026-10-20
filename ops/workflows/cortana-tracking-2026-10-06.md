# Cortana tracking — feed it every event (2026-10-06)

Chris asked: "We need to ensure cortana, which is a marketing tracking software, tracks really well. All info needs to be fed to cortana as well." Paul at DirectROAS asked for it.

**Owner scope correction, 2026-10-20:** Cortana work here is only the free book-a-call funnel: `/watch` → `/apply` → `/funding-book-call` → `/thank-you`. It is not the Roadmap or any other paid offer. Do not touch checkout, Commas, prices, sales, Purchase events, or paid-offer pages in this workflow.

Status: **waiting for Chris's go.** No workflow starts until he says go.

## What is there today (measured 2026-10-06, before any work)

- **Cortana is DirectROAS's tracker.**
- **Browser tag:** the DirectROAS hub script (`https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w`) is pushed into ClickFunnels page heads by `marketing/landing-pages/tracking-manifest.mjs` (`directRoasHeadHtml`). Override: `DIRECT_ROAS_HUB_URL`.
- **Four in-scope pages:** `/watch`, `/apply`, `/funding-book-call`, and `/thank-you` on `apply.fundhub.ai`.
- **No server feed:** nothing in `src/` sends events to DirectROAS. Meta gets server events (CAPI); Cortana does not.
- **Meta event map:** `docs/tracking/meta-events.md` records the in-scope PageView, ViewContent, Lead, SurveyStep, Schedule, and SurveyRouted timing. Use it as the starting event list.

## The chain

Cortana tracks well only if all four hold:

1. **Tag** — the DirectROAS script loads on every page a buyer touches.
2. **Events** — page visits, survey progress, Lead, calendar progress, Schedule, and thank-you arrival fire named events the script can see.
3. **Identity** — the ad click id, UTMs, email, phone, and Cortana visitor ID ride along from ad → survey → booking.
4. **Server feed + proof** — leads and bookings reach Cortana even when the browser is blocked, and Cortana's counts match Fundhub's database.

One workflow per link. No hard dependencies — all four run at the same time.

One soft clash: W1 and W2 both push ClickFunnels pages. W1 owns the `<head>` tag only. W2 owns event calls in the page body only. Read this board before every push.

Each workflow makes its own test data, tagged `test-cortana-tracking-2026-10-06`.

## Tasks

| # | Link | Owner | Status |
|---|---|---|---|
| W1 | Tag — script on every buyer page | this session | pending |
| W2 | Events — each funnel step fires a named event | open | pending |
| W3 | Identity — click id, UTMs, email carried end to end | open | pending |
| W4 | Server feed + proof — leads/bookings reach Cortana, counts match | open | pending |

## Shared rules for every workflow

- Read `CLAUDE.md` first. Model: Opus.
- Work in your own worktree: `.claude/worktrees/cortana-tracking-wN` (never switch the main checkout's branch).
- Claim your row above (`claimed`) before you start. Write your manifest below when done.
- Own only your link. Found a break in another link? One leftover card below, then keep going on yours. Do not fix it.
- ClickFunnels work goes through the API only (`scripts/cf-push-custom-html.mjs`). Chris never logs in.
- Tracking tags are not copy. No words on any page change. If a page's words must change, stop and use the marked-draft law.
- Proof is live: a real visit, lead, and booking seen in the browser network log, Fundhub records, and Cortana—not just green tests.
- Never delete data. Never remove a key. Test rows stay tagged.
- Update the matching `docs/journeys/*-actual.md` + `docs/journeys/CHANGELOG.md` for any flow you change.
- Commit locally every session. Push with `node scripts/github-push-whole-repo.mjs`. Ship once with `npm run ship`.

---

## Copy-paste prompts

### W1 — Tag (this session)

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W1 — Tag. Claim it.

Goal: the DirectROAS (Cortana) hub script loads on every page a buyer touches.

1. List only the four book-a-call pages: /watch, /apply, /funding-book-call, /thank-you. Source: tracking-manifest.mjs, marketing/landing-pages/**, docs/tracking/page-inventory.md.
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
2. Start from docs/tracking/meta-events.md: PageView/ViewContent, SurveyStep, Lead (survey done), calendar progress, Schedule (call booked), and SurveyRouted on thank-you. Ignore every paid-offer event.
3. Fire each event at the same moment the first-party/Meta event fires, with the same event_id where one exists.
4. Prove live with a tagged test run: each event shows in the browser network log to app.directroas.com, and in Cortana.
W1 owns the <head> tag. You own body event calls only. Worktree: .claude/worktrees/cortana-tracking-w2.
```

### W3 — Identity

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W3 — Identity. Claim it.

Goal: Cortana can tie every lead and booking back to the ad that caused it.

1. Trace what rides along from ad click to booked call: fbclid / fbc / fbp, utm_* (utm_content = ad id), DirectROAS's visitor id, email, and phone.
2. Find every hop where one is dropped: ad → /watch → /apply survey → framed/direct booking calendar → Fundhub lead and booking records.
3. Carry the same identity through those in-scope hops only.
4. Prove live: one tagged test path from a fake ad URL with utm_content=<real ad id> ends with the same identifiers on the lead and confirmed booking.
Do not add the script tag (W1) or event calls (W2). Worktree: .claude/worktrees/cortana-tracking-w3.
```

### W4 — Server feed + proof

```text
Read CLAUDE.md, then ops/workflows/cortana-tracking-2026-10-06.md. You own W4 — Server feed + proof. Claim it.

Goal: leads and bookings reach Cortana even when the browser blocks scripts, and Cortana's numbers match ours.

1. Use the live DirectROAS hub contract to confirm the event and identity intake shapes. Write the exact shapes on the board.
2. Send Lead and Schedule server-side behind a provider module in src/messaging/providers/, with the same event IDs as W2.
3. Write a date-range count check: Fundhub leads and bookings versus Cortana leads and bookings.
4. Prove the in-scope path with one tagged lead and one confirmed booking. No checkout, payment, or sale is part of this proof.
Worktree: .claude/worktrees/cortana-tracking-w4.
```

---

## Manifests

(each workflow writes here when done)

## Leftover cards

(breaks found outside your link — one card each, no fixing)
