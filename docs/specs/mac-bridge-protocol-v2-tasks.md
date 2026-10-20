# Mac Bridge — v2: send tasks from the phone

Adds to `mac-bridge-protocol-v1.md`. Everything in v1 stays the same.

Owner goal (2026-10-20): "I just want to be able to build from my computer." From the phone, start a task or keep chatting in a session; it runs on the always-on Mac in this repo; watch it live with the v1 feed.

## Rules

- Tasks run in the repo folder (`MAC_BRIDGE_REPO`, default `/Users/chrisstanbridge/Developer/fundhub-platform`), so the repo's own rules (CLAUDE.md, AGENTS.md, `.claude/settings.json` allow/deny) apply exactly as on the desk. The helper never loosens them.
- Claude: `claude -p "<prompt>" --output-format stream-json --verbose` (plus `--resume <id>` to continue). No `--dangerously-skip-permissions`. The repo's `.claude/settings.json` decides what is allowed.
- Codex: `codex exec "<prompt>"` (plus `codex exec resume <id>` to continue) in its default sandbox. Find the binary on PATH, `MAC_BRIDGE_CODEX_BIN`, or inside the Codex app; if none, the task fails with `codex_not_found`.
- The new run writes its own session file, so the v1 feed already shows it live.
- At most 3 tasks running at once; more → `429 {"error":"busy"}`.
- Prompt max 20,000 chars.

## Safety check — none (owner-set 2026-10-20)

Chris: "No need for safety check." The helper adds no rule list of its own. Each tool keeps its own guard exactly as at the desk (the repo's `.claude/settings.json` deny list, Codex's default sandbox). The helper never loosens those.

## Delegation (built, not plugged in)

`tool: "auto"` asks `router.pick(prompt)`:
- Jev picker: **off** unless `MAC_BRIDGE_JEV=on` and `JEV_API_KEY` are both set (Chris does not want to pay for Jev yet). Off = no network call.
- With Jev off: read the repo rules files and pick by the rules the repo already states; when the rules do not decide, use Claude. Return the pick and the reason.
- The answer says which tool was used and why, so the phone can show it.

## HTTP (new)

| Method + path | Body | Answer |
|---|---|---|
| `POST /v1/tasks` | `{ "tool": "claude" \| "codex" \| "auto", "prompt": "…", "resumeSessionId": "…" (optional) }` | `202 { "task": Task }` |
| `GET /v1/tasks` | — | `{ "tasks": [Task] }`, newest first, max 50 |
| `POST /v1/tasks/:id/stop` | — | `{ "task": Task }` (sends SIGINT, then SIGTERM after 5 s) |

### Task

```json
{ "id": "string", "tool": "claude", "pickedBy": "you | rules | jev", "pickReason": "string",
  "prompt": "first 200 chars", "status": "starting | running | done | failed | stopped",
  "sessionId": "string or null until known", "startedAt": "ISO", "endedAt": "ISO or null",
  "exitCode": 0, "error": "string or null" }
```

`sessionId` is read from the run's output (Claude stream-json `session_id`; Codex its session id) so the phone can open the live feed.

## WebSocket (new message)

- `{ "type": "task", "task": Task }` on every status change. Goes to all clients.

## iPhone app (new)

- **New task** button on the session list: big text box, pick Claude / Codex / Auto (Auto shows "uses repo rules"), Send. After send, open the live feed as soon as `sessionId` is known.
- **Reply box** at the bottom of a session feed: sends `POST /v1/tasks` with `resumeSessionId` and the same tool.
- **Running tasks** strip at the top of the list with a Stop button.
