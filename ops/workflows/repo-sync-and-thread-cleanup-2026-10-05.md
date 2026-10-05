# Repo sync and thread cleanup — 2026-10-05

Owner: Chris Stanbridge. Ask: get the whole repo onto GitHub, prove every project is done being built, then clear the Claude Code threads (archive) and Claude Chat (Chris clicks delete).

## Tasks

| Id | Workflow | Owner | Status |
|---|---|---|---|
| A | Push whole repo to GitHub and prove it | main session (Sonnet) | claimed |
| B | Read-only done check: boards, worktrees, running sessions | Opus agent | claimed |
| C | Archive Claude Code threads, prove list is clear | waits on A + B | pending |
| D | Chris deletes Claude Chat at https://claude.ai/recents; agent proves empty after | Chris, then agent | pending |

## Dependencies

- A and B run at the same time.
- C waits for A and B both done. If B finds unfinished or unsaved work, C stays blocked until Chris says build it or drop it.
- D waits for C.

## Limit (owner call recorded)

Permanent deletes of chat threads are not run by agents. Claude Code threads get archived (reversible). Chris makes the final delete click.

## A — Push result

_pending_

## B — Done check result

_pending_

## C — Archive result

_pending_

## D — Claude Chat proof

_pending_
