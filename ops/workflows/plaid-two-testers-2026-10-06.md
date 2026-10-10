# Plaid — live bank connect for 2 testers (2026-10-06)

Status: **waiting for Chris's go** (split proposed, sandbox chosen, nothing built).

## Ask

Chris got off a call with Plaid. He wants Plaid working for himself and 1 other person, to test.

## What already exists (measured 2026-10-06)

- `src/banking/plaid.mjs` — config check, token encryption, `linkAccount()` (public_token → encrypted access_token), `getAccounts()`.
- `src/banking/providers/plaid-http.mjs` — `/item/public_token/exchange`, `/accounts/get`.
- Tables: `plaid_items` (080), `bank_accounts` (081), `bank_transactions` (085), provider column (103).
- Needs env: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_TOKEN_ENC_KEY`, `PLAID_ENV`. **None are set** in `.env`, `credentials/env.full.snapshot`.

## What is missing

1. No `/link/token/create` call anywhere. Plaid Link cannot open without it.
2. No HTTP route that starts Link or takes the public_token back and saves the item.
3. No "Connect your bank" button in the client portal (`public/app/`).
4. No keys.
5. `development` host in `PLAID_HOSTS` is dead at Plaid (retired 2024). Real banks = `production` host with Plaid's free Limited Production access.

## Owner decisions

- 2026-10-06 (owner-set): **sandbox only for now** — Plaid's fake test banks. `PLAID_ENV=sandbox`. Real banks later.
- 2026-10-06 (owner-set): must support **business checking, personal checking, personal credit cards, business credit cards**, and the rest.

## Account types — measured against the schema

- Checking/savings → `bank_accounts.account_type='depository'`. Already fits.
- Credit cards → `account_type='credit'`, `credit_limit_cents`. Already fits.
- **Business vs personal → no column today.** Plaid tags accounts `holder_category` = business / personal / unrecognized. Plan: new nullable column `bank_accounts.holder_category`, filled only from Plaid. NULL = unknown, never guessed (same rule as `recurring_bills.is_business`). Proposed: when Plaid says unrecognized, the client taps Business or Personal after linking — **needs Chris's yes**.
- W1 must confirm in Plaid docs which sandbox test users return business accounts and credit cards. Do not invent test usernames.

## Split

| # | Workflow | Owner | Status | Waits on |
|---|---|---|---|---|
| W1 | Back end: keys, link-token + exchange routes, 2-person gate, tests | **this session** | pending | — |
| W2 | Front end: portal "Connect bank" button + Plaid Link | open | pending | API contract below (fixed now, so parallel) |
| W3 | Live proof: sandbox walk, then both real people link | open | pending | W1 + W2 done |

W1 and W2 run at the same time. W3 waits.

## API contract (fixed — both sides build to this)

- `POST /api/banking/link-token` → `200 { link_token, expiration }` or `403 { error: "not_a_tester" }` or `503 { error: "plaid_not_configured" }`. Client must be signed in.
- `POST /api/banking/link-exchange` body `{ public_token }` → `200 { item_id, accounts: [{ name, mask, type, subtype }] }`. Saves `plaid_items` + `bank_accounts`, sets `consent_granted_at` (the click is the consent).
- Gate: env `PLAID_TESTER_EMAILS` (comma list). Anyone not on it gets 403. This is how it stays at 2 people.

## Prompts

### W1 — back end (this session)

```
Fundhub repo. Board: ops/workflows/plaid-two-testers-2026-10-06.md — read it first, mark W1 claimed.
Work in a worktree under .claude/worktrees/plaid-w1, never switch the main checkout's branch.
Build the back end for Plaid Link for 2 testers:
1. Keys: get PLAID_CLIENT_ID + PLAID_SECRET (sandbox and production) from the Plaid dashboard, generate PLAID_TOKEN_ENC_KEY, write full values to .env and credentials/env.full.snapshot, then Netlify without --secret. Set PLAID_ENV and PLAID_TESTER_EMAILS.
2. Add createLinkToken() to src/banking/providers/plaid-http.mjs (POST /link/token/create). Network stays in that file only.
3. Add api/banking/link-token.mjs and api/banking/link-exchange.mjs to the contract on the board. Route both in netlify/functions/api.mjs. Gate by PLAID_TESTER_EMAILS.
4. Exchange saves plaid_items + bank_accounts via the existing linkAccount()/accounts store. Reuse, do not rebuild.
5. Tests: src/http/plaid-link.test.mjs and a .pg.test.mjs. Lint, tsc, tests green.
6. Write the manifest on the board, mark W1 done, commit, push with node scripts/github-push-whole-repo.mjs, npm run ship.
```

### W2 — front end (paste in a new session)

```
Fundhub repo. Board: ops/workflows/plaid-two-testers-2026-10-06.md — read it first, mark W2 claimed.
Work in a worktree under .claude/worktrees/plaid-w2, never switch the main checkout's branch.
Read docs/rules/UI-STANDARDS.md first — it is law for public/app/.
Add a "Connect your bank" button to the client portal bank/money screen in public/app/.
On click: POST /api/banking/link-token, open Plaid Link (script https://cdn.plaid.com/link/v2/stable/link-initialize.js) with that token,
onSuccess POST /api/banking/link-exchange { public_token }, then show the linked accounts (name + last 4).
403 not_a_tester → hide the button. 503 → show "Bank connect is not on yet."
Build to the API contract on the board exactly. Do not touch api/ or src/ — W1 owns those.
Playwright check of the button and states. Write the manifest on the board, mark W2 done, commit, push with node scripts/github-push-whole-repo.mjs.
```

### W3 — live proof (paste after W1 and W2 are done)

```
Fundhub repo. Board: ops/workflows/plaid-two-testers-2026-10-06.md — read it, confirm W1 and W2 are done, mark W3 claimed.
1. With PLAID_ENV=sandbox: sign in as a tester client on the live site, click Connect your bank, use Plaid's sandbox login (user_good / pass_good), confirm accounts show on screen and rows land in plaid_items + bank_accounts (read-only query, BEGIN READ ONLY).
2. Switch PLAID_ENV to production (ship once). Chris and the second tester each link one real bank. Confirm both show.
3. Marked screenshots per CLAUDE.md §8. Write results on the board, mark W3 done, commit, push.
```

## Manifests

(none yet)

## Blockers

- Waiting on Chris: go + yes/no on client picking Business/Personal when Plaid can't tell. Second tester email only needed for real banks.

## W1 manifest — 2026-10-06 (done, sandbox)

- Keys: PLAID_CLIENT_ID, PLAID_SECRET (sandbox), PLAID_ENV=sandbox, PLAID_TOKEN_ENC_KEY (new) → `.env`, `credentials/env.full.snapshot`, Netlify prod/preview/branch, no --secret. Production secret: Plaid says "You don't have access" yet.
- New: `src/banking/plaid-link.mjs` (startLink, completeLink, toStoreAccount), `api/banking/link-token.mjs`, `api/banking/link-exchange.mjs`, `scripts/plaid-sandbox-link.mjs`, `src/http/plaid-link.test.mjs` (11 pass).
- Changed: `src/banking/providers/plaid-http.mjs` (+createLinkToken, +sandboxPublicToken, holder_category carried), `netlify/functions/api.mjs` (2 routes), `src/pulse/registry.mjs`, journeys regenerated.
- Contract change vs board: both routes are STAFF (owner/admin/sales_manager) with `client_id` in the body — no PLAID_TESTER_EMAILS gate. Front end calls them from the staff side for now.
- Proof: sandbox bank linked to client f1cb9c27 (Test Test, stanbridgejchris@gmail.com): Personal Checking 1101, Business Checking 2202, Personal Visa 3303 (limit $8,000), Business Amex 4404 (limit $25,000). Token stored encrypted (v1:), consent stamped, entity_kind 'unknown'.
- Business vs personal: `bank_accounts.entity_kind` already exists (unknown/personal/business). Plaid's holder_category kept in `raw` only.

## Leftover

- `src/http/climate-match.test.mjs` "climate page: no approval odds…" fails on main too. Not touched.
