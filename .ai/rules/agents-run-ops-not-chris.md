---
description: Agents run git push, auth, env, and cloud prep — not Chris in Terminal
alwaysApply: true
---

# Agents run ops — not Chris

**Owner law (2026-10-04):** Chris decides. Agents operate. **Never** make Terminal copy-paste blocks the default path for work an agent can run from gitignored `.env` and `credentials/`.

## Agents MUST run themselves

From `.env`, `.env.*`, and `credentials/**` (read silently unless he asked for the value — see `show-secrets-when-chris-asks.mdc`):

- **Git push / fetch** — configure auth from env (`GITHUB_TOKEN`, etc.), test, push. Law: github-push (.ai/rules/github-push.md) - push only main and branches headed to a PR with git push origin <branch>; the repo is public (owner-set 2026-10-24).
- **`gh` auth** — when a token exists: `GH_TOKEN` / `GITHUB_TOKEN` non-interactive use, or `gh auth login --with-token` from a pipe the agent runs. Test with `gh auth status` or API curl.
- **Token test** — curl vendor `/user` or equivalent; report pass/fail only, **never** print the token in chat.
- **Env save** — write full values to `.env` and `credentials/env.full.snapshot`, then Netlify per `secrets-env-law.mdc`.
- **Cloud file prep** — `node scripts/env-refresh-local-from-netlify.mjs`, `credentials/cloud-env-for-claude.txt`, mask audit — agent runs scripts; Chris does not hand-copy env blocks as the default.

## Never (default path)

- “Paste this token in Terminal”
- “Run `gh auth login` yourself”
- “You do this in Terminal” for push, env refresh, or token test when `.env` / `credentials/` has what is needed
- Multi-step copy-paste workflows that exist only because the agent refused to run bash

## Only ask Chris when truly interactive-only

- **Browser OAuth one click** — e.g. `gh auth login -w` when no token exists: agent runs the command or opens the URL, then **one line**: “Click approve in browser.” Not a full token-paste tutorial.
- **Mac permission dialogs** — mic, Accessibility, etc.
- Law: finish-the-answer (.ai/rules/finish-the-answer.md) - Chris is asked first only for yes/no and live-or-sandbox calls, deleting data (not proven test rows or test logins, owner-set 2026-10-24), and repointing DATABASE_URL.

## Agents run the work (owner-set 2026-09-16)

Chris decides; agents operate. Run bash, lint, tests, `npm run ship`, env reads from gitignored `.env`, migrations through ship or the §11 commands, and UI proof (live Playwright when required, then a human-like click path on the live site). Do not tell Chris to run commands, paste secrets, deploy, check inboxes, or do routine QA clicks.

**Exceptions only:** Mac permission dialogs he alone can approve (mic, Accessibility); explicit product gates he must answer (yes/no, live vs sandbox on Full E2E); the two §11 ask-first items (delete data except proven test rows and test logins, repoint `DATABASE_URL`); Chris checks the shipped teleprompter on a real iPhone (owner-set 2026-10-13).

## Dictator mode

Same law, no pushback. See `dictator-owner-overrides.mdc`.

## Example

```text
Ask: "Push to GitHub and make sure the token works."

❌ "Export GITHUB_TOKEN=ghp_… then run git push."
✅ Read .env, curl api.github.com/user (200?), `git push origin main` — report SUCCESS/FAIL only.
```
