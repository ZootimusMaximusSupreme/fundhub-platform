# GitHub backup push

Fundhub’s canonical git remote is **GitHub**. GitLab is retired — do not push to gitlab.com.

## Repository

- **Org/user:** `ZootimusMaximusBackup`
- **Repo:** `fundhub-platform`
- **Web:** https://github.com/ZootimusMaximusBackup/fundhub-platform

## How to push

From repo root:

```bash
node scripts/github-push-whole-repo.mjs
```

The script adds or updates remote **`origin`**, pushes **`main`** (`--force-with-lease`), all other local branches, and all tags. It removes remote **`gitlab`** if present. It never removes GitHub remotes.

## Credentials (names only — values in gitignored `.env`)

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Personal access token with **repo** scope (contents read/write on this repo) |
| `GITHUB_REPO` | Optional; default `ZootimusMaximusBackup/fundhub-platform` |

Fallback: **`credentials/github-pat.txt`** (gitignored) — one line `ghp_…` or `GITHUB_TOKEN=ghp_…`.

Create token: https://github.com/settings/tokens

Never commit `.env` or `credentials/`. Never put token values in tracked files, boards, or chat logs unless Chris explicitly asks in dictator mode.

## Compare baseline

Compare against **`origin/main`**, not GitLab.

## Do not

- Run `node scripts/gitlab-push-whole-repo.mjs` — it exits with “use GitHub script”
- Push to `gitlab.com`
- Print or commit `GITHUB_TOKEN`
