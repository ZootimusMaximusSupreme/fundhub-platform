# Mac Bridge helper

Runs on the Mac. Two jobs:

1. **Watch (v1).** Reads your Claude Code, Codex and Cursor chats and shows them to the iPhone app. It never writes, moves or deletes anything in `~/.claude`, `~/.codex` or `~/.cursor`.
2. **Send (v2).** When the phone sends a task, it starts Claude Code, Codex or Cursor in the repo folder. The new chat shows up in the v1 feed like any other.

Contracts: `docs/specs/mac-bridge-protocol-v1.md` and `docs/specs/mac-bridge-protocol-v2-tasks.md`. Node 22. No npm install, no packages.

## Start it

```
node tools/mac-bridge/agent/bin/mac-bridge.mjs
```

It prints a pairing link and a QR code. Open the iPhone app and scan the code (or paste the link). Stop it with Ctrl+C.

Options: `--port 7878` (or env `MAC_BRIDGE_PORT`), `--no-bonjour`, `--no-qr`, `--help`.

| Env | What it does |
|---|---|
| `MAC_BRIDGE_REPO` | Folder tasks run in. Default `/Users/chrisstanbridge/Developer/fundhub-platform` |
| `MAC_BRIDGE_CLAUDE_BIN` | Use this `claude` program. Default: PATH, then the usual install spots |
| `MAC_BRIDGE_CODEX_BIN` | Use this `codex` program. Default: PATH, then inside an app in `/Applications` (`Contents/Resources/codex-cli/bin/codex`) |
| `MAC_BRIDGE_CURSOR_BIN` | Use this Cursor program. Default: `cursor-agent` (or Cursor's own `agent`) on PATH or in `~/.local/bin` |
| `MAC_BRIDGE_JEV=on` + `JEV_API_KEY` | Switch on the Jev picker. **A stub today, off by default.** |
| `MAC_BRIDGE_SHOW_GUARDIAN=1` | Show Codex's internal guardian-review files |

## Watching (v1)

- Listens on `0.0.0.0:7878`. Needs the phone on the same Wi-Fi, or a private network that reaches the Mac (Tailscale).
- Token: made on first run at `~/.mac-bridge/token` (mode 0600). Every call needs `Authorization: Bearer <token>`; the WebSocket uses `?token=<token>`. Anything else gets `401`.
- Advertises itself as `_macbridge._tcp` with the built-in `dns-sd` tool (skipped quietly if that fails).
- Lists the newest 200 sessions by file time. It reads a session file only when you ask for its events or subscribe to it, and after that only the bytes added since last time.
- Codex also writes hundreds of internal "guardian review" files. They are hidden.
- Cursor: reads the agent transcripts in `~/.cursor/projects/<project>/agent-transcripts/`. Sub-agent files are skipped. Cursor CLI chats are kept in SQLite (`store.db`) and are **not** shown. Cursor transcripts carry no times per line and no command output, so Cursor commands show without output.

## Sending tasks (v2)

```
T=$(cat ~/.mac-bridge/token)
curl -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  localhost:7878/v1/tasks -d '{"tool":"claude","prompt":"Reply with PONG"}'
curl -H "Authorization: Bearer $T" localhost:7878/v1/tasks
curl -X POST -H "Authorization: Bearer $T" localhost:7878/v1/tasks/<task-id>/stop
```

- `tool` is `claude`, `codex`, `cursor` or `auto`. Add `"resumeSessionId"` to keep talking in a chat.
- What runs (always an argument list, never a shell string, so a prompt can never run as a shell command):
  - Claude: `claude -p --output-format stream-json --verbose [--resume <id>] -- <prompt>`
  - Codex: `codex exec --json [resume -- <id>] -- <prompt>` (its default sandbox)
  - Cursor: `cursor-agent -p --output-format stream-json [--resume <id>] -- <prompt>`
- **No flag that loosens a guard is ever added.** No `--dangerously-skip-permissions`, no Codex `--sandbox`/bypass, no Cursor `--force`/`--yolo`/`--trust`/`--approve-mcps`. The repo's `.claude/settings.json`, Codex's sandbox and Cursor's settings decide what is allowed. The helper has no safety rule list of its own (owner call 2026-10-20).
- If the helper was started inside a Claude Code session, that session's own wiring (`CLAUDECODE`, `CLAUDE_CODE_*`, its login relay) is not passed to the new run. Nothing is added.
- At most 3 running at once (4th → `429 busy`). Prompt max 20,000 characters. Body max 64 KB. The last 50 tasks are kept in memory (gone when the helper restarts).
- Stop sends Ctrl+C (SIGINT), then SIGTERM after 5 seconds.
- The session id is read from the tool's own output, so the phone can open the live feed. When a run fails, `error` carries the tool's own reason when it gives one (for example a login error).
- A missing program fails the task with `claude_not_found`, `codex_not_found` or `cursor_not_found`.
- Every status change goes to all WebSocket clients as `{ "type": "task", "task": … }`.

### Auto (who does the task)

`tool: "auto"` asks the router (`src/router.mjs`):

1. Jev, only if switched on. **It is a stub:** Jev's API is not written down in this repo, so switching it on just says "jev not wired" and the repo rules pick instead. While off it makes no network call (a test checks it).
2. Repo rules. It reads `AGENTS.md`, `CLAUDE.md` and `.claude/rules/*.md` and applies only lanes the repo writes down. Today that is one: screen and website work goes to Claude (`.claude/rules/grok-no-displays.md`). A lane stops applying if its sentence leaves the rules files.
3. Otherwise Claude.

Continuing a chat with `auto` keeps it in that chat's own tool.

## Tests

```
node --test tools/mac-bridge/agent/test/
```

Tests use fake files in a temp folder and fake `claude` / `codex` / `cursor-agent` programs. They never read the real session folders and never start the real tools.

## Files

| File | Job |
|---|---|
| `bin/mac-bridge.mjs` | Entry. Starts the server, Bonjour, prints the link and QR |
| `src/server.mjs` | HTTP routes, WebSocket stream, auth |
| `src/tasks.mjs` | v2 task runner: find the program, start it, read its session id, stop it |
| `src/router.mjs` | `auto`: Jev (off) or repo rules, else Claude |
| `src/jev.mjs` | Jev slot. Off. Stub when on |
| `src/sessions.mjs` | Finds files, indexes lazily, watches (`fs.watch` + 2 s poll), streams new events |
| `src/parse.mjs` | Claude Code, Codex and Cursor lines to protocol Events |
| `src/ws.mjs` | Hand-written RFC 6455 WebSocket |
| `src/qr.mjs` | Small QR encoder (byte mode, level L, up to 271 bytes) |
| `src/token.mjs` | Token file and constant-time compare |
| `src/bonjour.mjs` | `dns-sd -R` wrapper |
