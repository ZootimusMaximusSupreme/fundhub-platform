# Agents run ops — not Chris

**Owner law (2026-10-04):** Chris decides. Agents operate. **Never** make Terminal copy-paste blocks the default path for work an agent can run from gitignored `.env` and `credentials/`.

## Agents MUST run themselves

From `.env`, `.env.*`, and `credentials/**` (read silently unless he asked for the value — see `.claude/rules/show-secrets-when-chris-asks.md`):

- **Git push / fetch** — configure auth from env (`GITHUB_TOKEN`, etc.), test, push. Prefer `node scripts/github-push-whole-repo.mjs` for full-repo backup to GitHub.
- **`gh` auth** — when a token exists: `GH_TOKEN` / `GITHUB_TOKEN` non-interactive use, or `gh auth login --with-token` from a pipe the agent runs. Test with `gh auth status` or API curl.
- **Token test** — curl vendor `/user` or equivalent; report pass/fail only, **never** print the token in chat.
- **Env save** — write full values to `.env` and `credentials/env.full.snapshot`, then Netlify per `secrets-env-law.md`.
- **Cloud file prep** — `node scripts/env-refresh-local-from-netlify.mjs`, `credentials/cloud-env-for-claude.txt`, mask audit — agent runs scripts; Chris does not hand-copy env blocks as the default.

## Never (default path)

- “Paste this token in Terminal”
- “Run `gh auth login` yourself”
- “You do this in Terminal” for push, env refresh, or token test when `.env` / `credentials/` has what is needed
- Multi-step copy-paste workflows that exist only because the agent refused to run bash

## Only ask Chris when truly interactive-only

- **Browser OAuth one click** — e.g. `gh auth login -w` when no token exists: agent runs the command or opens the URL, then **one line**: “Click approve in browser.” Not a full token-paste tutorial.
- **Mac permission dialogs** — mic, Accessibility, etc.
- **Decisions only he can make** — yes/no, live vs sandbox, delete data, repoint `DATABASE_URL` (see `CLAUDE.md` §11).

## Dictator mode

Same law, no pushback. See `.claude/rules/dictator-owner-overrides.md`.

## Example

```text
Ask: "Push to GitHub and make sure the token works."

❌ "Export GITHUB_TOKEN=ghp_… then run git push."
✅ Read .env, curl api.github.com/user (200?), git push github main — report SUCCESS/FAIL only.
```
