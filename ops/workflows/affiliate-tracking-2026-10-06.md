# Affiliate link + show password (2026-10-06)

Status: W1 live. W2 live.

(An earlier draft of this board guessed at a 4-part affiliate audit before Chris gave the task. That draft is dead.)

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | One row per offer on the affiliate page | this session | done — live, shipped ea4a4539, clicks proven |
| W2 | Show / Hide button on every password box | this session (Chris asked here) | done — see manifest |

No dependencies — W1 and W2 touch different files. All parallel.

## W1 — the facts

- Loom: https://www.loom.com/share/3a39e89b0f7743ddb21bd0fbc82a16b6
- David Ramirez (affiliate) does not know which link is live.
- The affiliate desk link `https://fundhub.ai/start.html?ref=<code>` is built in `src/affiliates/share-link.mjs`.
  `public/start.html:32` forwards to `https://apply.fundhub.ai/watch` with the code.
- Chris's "297" text sends people to `https://apply.fundhub.ai/roadmap`.
- Roadmap already carries a ref: `src/slo/discount-197.mjs:19` builds `https://apply.fundhub.ai/roadmap/?offer=197&ref=<id>#fhw`.

**Owner call (2026-10-06):** one row per offer on the affiliate page. Same code on every link,
a different page per offer. Each URL carries `ref=<code>` and `a1=<code>`.
Example: `https://apply.fundhub.ai/roadmap?a1=AFF-000121&ref=AFF-000121`.
Not one generic link that hides which offer it is.

Offers with a live page (from `src/marketing/api-contract.mjs`):
- Book a call (`funding_dfy`) → `https://apply.fundhub.ai/watch`
- Roadmap (`slo_roadmap`) → `https://apply.fundhub.ai/roadmap`
- Capital Blueprint (`capital_blueprint`) → `https://apply.fundhub.ai/blueprint` — affiliates earn on it (migration 399). Row or not: waiting for Chris.

Notes for the build:
- `/roadmap` already uses `?ref=` for the paid return, but only with `client_id` and a `slo_` ref. An `AFF-` code does not trip it.
- Clicks are counted today by `public/start.html` before the bounce. Direct apply links skip it,
  so each funnel page must count the click itself or the "Clicks 30d" number stops moving. Prove it.

Old options (superseded by the owner call above):
- **A** — one share link. It lands on roadmap with `a1` + `ref`.
- **B** — two links on `affiliate.html`: watch and roadmap.
- **C** — change the 297 text so it points at watch only.

## W2 — the facts

Password boxes people type into (searched `public/` and `marketing/landing-pages/`, 2026-10-06):
- `public/login.html:62` — sign-in password (staff and affiliates)
- `public/reset-password.html:24` and `:25` — new password + type it again

Clients sign in with an email link (`public/portal-login.html`), so they have no password box.
The ClickFunnels pages have no password box.
Three API key boxes on staff tools (`public/app/campaign-manager.html:671`,
`public/app/creative-factory.html:704`, `:707`) are keys, not passwords. Not in scope unless Chris says so.

## Copy-paste prompts

### W1 — One clear affiliate link (this session)

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W1. Read the W1 facts there.
Work in worktree .claude/worktrees/affiliate-link-w1.

Loom: https://www.loom.com/share/3a39e89b0f7743ddb21bd0fbc82a16b6
Problem: the affiliate desk link (fundhub.ai/start.html?ref=…) sends buyers to
apply.fundhub.ai/watch. Chris's "297" text sends to apply.fundhub.ai/roadmap.
David Ramirez does not know which link is live.

Chris's pick: <A | B | C — fill in from the board>
A = one share link -> roadmap with a1+ref. B = two links on affiliate.html (watch + roadmap).
C = change the 297 text to match watch only.

Read: src/affiliates/share-link.mjs, public/start.html, public/app/affiliate.html,
api/read/affiliate-portal.mjs, src/affiliates/drip.mjs, src/http/start-html.test.mjs,
src/http/affiliate-referral.pg.test.mjs.

Build the picked option. Smallest diff. Prove both URLs live after the fix (the ref is still
on the page they land on, and the click is saved). npm test. Update affiliate-actual.md +
CHANGELOG. Commit, push (node scripts/github-push-whole-repo.mjs), ship once (npm run ship).
Other breaks: one leftover card on the board, then stop. Do not fix them.
```

### W2 — Show password while typing

```
Repo: /Users/chrisstanbridge/Developer/fundhub-platform. Read CLAUDE.md first.
Board: ops/workflows/affiliate-tracking-2026-10-06.md. Claim row W2. Read the W2 facts there.
Work in worktree .claude/worktrees/show-password-w2.
Read docs/rules/UI-STANDARDS.md before touching public/.

Chris wants everyone who types a password (clients, affiliates, staff) to be able to
tap an eye button and see what they typed. Tap again to hide it.

Boxes in scope: public/login.html:62, public/reset-password.html:24 and :25.
Search again first (public/, marketing/landing-pages/, any JS that builds a password box)
in case one was missed. The 3 API key boxes on campaign-manager and creative-factory are
NOT in scope.

Rules: one small shared piece used by every box (no copy-paste per page). Works on phone
and desktop. Screen reader label ("Show password" / "Hide password"). Keeps autofill and
password managers working. Hides again after the form is sent.

Prove it live: Playwright on https://fundhub.ai/login.html and the reset page —
type, tap the eye, see the text, tap again, hidden. Marked-up screenshots (CLAUDE.md §8).
npm run lint, npx tsc --noEmit, npm test. Commit, push, ship once.
Other breaks: one leftover card on the board, then stop. Do not fix them.
```

## Manifests

### W1 (not live yet — branch affiliate-offer-links)
- `src/affiliates/share-link.mjs` — `OFFER_PAGES` + `offerLinksFor(code)`: Book a call -> /watch, Roadmap -> /roadmap, each `?a1=<code>&ref=<code>`. Blueprint left off: https://apply.fundhub.ai/blueprint is 404 (checked 2026-10-06).
- `api/read/affiliate-portal.mjs` — adds `affiliate.offerLinks`. `shareUrl` unchanged.
- `public/app/affiliate.html` — one row per offer with Copy link; Copy code kept. The page no longer builds a start link itself.
- `public/funnel/fh-attribution.js` (+ paste-in copy `marketing/landing-pages/06-utm-hidden-fields.html`) — counts the click on a direct offer link, once per code per tab; skips `via=start` and slo_ order refs.
- `public/start.html` — adds `&via=start` so its own click is not counted twice. Still lands on /watch.
- Checked, no change needed: the roadmap checkout already sends a1 (fh-attribution.js fetch wrapper adds it to the slo-checkout POST).
- Tests: `src/affiliates/share-link.test.mjs` (new), `src/ads/fh-attribution-contact.test.mjs` (+4), `src/http/affiliate-referral.pg.test.mjs` (+offerLinks asserts, runs in CI).
- Journeys: no route change; `npm run journeys` regenerates affiliate-actual.md unchanged. CHANGELOG line added.
- Draft shots (gitignored): `ops/workflows/affiliate-tracking-2026-10-06-evidence/`.

### W2
- `public/pw-toggle.js` (new) — one shared Show / Hide button for every password box. Flips back to hidden on submit. Keeps autofill.
- `public/login.html`, `public/reset-password.html` — load it. These are the only password boxes people type into (sign in; set password from an invite or reset). Clients sign in by email link — no password box.
- Left out on purpose: API key boxes on `app/campaign-manager.html` and `app/creative-factory.html` (keys, not passwords).
- Test: `src/http/pw-toggle.test.mjs` — fails if a page gains a password box without the button; checks Show, Hide, and hide-on-send.

## Leftover cards

- **climate page test fails** — `src/http/climate-match.test.mjs` "climate page: no approval odds…" matches /approval odds/ inside the built `public/climate/_next` bundle. Not touched by W1. Not fixed.
