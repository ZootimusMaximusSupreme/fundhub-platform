---
description: GitHub full-repo backup — org repo, script, env names
alwaysApply: true
---

# GitHub backup push

Fundhub’s canonical git remote is **GitHub**. GitLab is retired — do not push to gitlab.com.

## Repository

- **Org/user:** `ZootimusMaximusSupreme`
- **Repo:** `fundhub-platform`
- **Web:** https://github.com/ZootimusMaximusSupreme/fundhub-platform

## How to push

**The repo is public (owner-set 2026-10-24).** Push only `main` and branches headed to a PR:

```bash
git push origin <branch>
```

No backup branches. Each pushed branch starts the CI jobs. `node scripts/github-push-whole-repo.mjs` is not the default anymore. Scan before any push.

The old whole-repo script (kept, not the default) adds or updates remote **`origin`**, pushes **`main`** only when it can fast-forward, every local branch not yet merged into GitHub `main`, and all tags. Merged branch refs stay deleted. It removes remote **`gitlab`** if present. It never removes GitHub remotes.

## Commit locally, every session (owner-set 2026-09-08)

A laptop died on 2026-09-07 holding uncommitted work. Four marketing skills and 83 ad scripts were never in git. The 83 ad scripts were rebuilt on 2026-10-03. So commit to the local repository in the same session the work is done, every time, whether or not a push is possible. An unpushed commit survives. An uncommitted file does not. If you cannot push, commit anyway and say so. Then push that commit to GitHub when auth allows.

## Credentials (names only — values in gitignored `.env`)

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Personal access token with **repo** scope (contents read/write on this repo) |
| `GITHUB_REPO` | Optional; default `ZootimusMaximusSupreme/fundhub-platform` |

Fallback: **`credentials/github-pat.txt`** (gitignored) — one line `ghp_…` or `GITHUB_TOKEN=ghp_…`.

Create token: https://github.com/settings/tokens

Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never commit .env, .env.* or credentials/; never put a token in tracked files, boards or logs; paste one in chat only when Chris asks.

## Compare baseline

Compare against **`origin/main`**, not GitLab.

## Do not

- Push or treat **`ZootimusMaximusBackup/*`** as the write target — Fundhub git writes go to **`ZootimusMaximusSupreme/fundhub-platform`** only
- Run `node scripts/gitlab-push-whole-repo.mjs` — it exits with “use GitHub script”
- Push to `gitlab.com`
- Push a backup branch, or every local branch, to GitHub
- Print or commit `GITHUB_TOKEN`
