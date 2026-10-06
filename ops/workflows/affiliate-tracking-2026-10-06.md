# Affiliate link + show password (2026-10-06)

Status: **waiting for Chris** — he picks A, B or C for W1. W2 can start now.

(An earlier draft of this board guessed at a 4-part affiliate audit before Chris gave the task. That draft is dead.)

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | One clear affiliate link (A / B / C) | this session | blocked — waiting for Chris's pick |
| W2 | Eye button to show the password while typing | open — paste prompt below | pending |

No dependencies — W1 and W2 touch different files. All parallel.

## W1 — the facts

- Loom: https://www.loom.com/share/3a39e89b0f7743ddb21bd0fbc82a16b6
- David Ramirez (affiliate) does not know which link is live.
- The affiliate desk link `https://fundhub.ai/start.html?ref=<code>` is built in `src/affiliates/share-link.mjs`.
  `public/start.html:32` forwards to `https://apply.fundhub.ai/watch` with the code.
- Chris's "297" text sends people to `https://apply.fundhub.ai/roadmap`.
- Roadmap already carries a ref: `src/slo/discount-197.mjs:19` builds `https://apply.fundhub.ai/roadmap/?offer=197&ref=<id>#fhw`.

Options (Chris picks one):
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

(none yet)

## Leftover cards

(none yet)
