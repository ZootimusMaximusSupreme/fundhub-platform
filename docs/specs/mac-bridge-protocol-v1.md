# Mac Bridge — wire protocol v1

Working name: **Mac Bridge**. Goal: see Claude Code, Codex and Cursor chats, and the commands they run, on the iPhone while away from the Mac.

v1 is **read only**. The phone watches. It cannot type into a session or run a command. (Sending is v2 and needs its own owner OK.)

## Pieces

| Piece | Folder | What it does |
|---|---|---|
| Mac helper | `tools/mac-bridge/agent/` | Node 22, no new npm deps. Reads session files, serves them on the network. |
| iPhone app | `tools/mac-bridge/ios/` | SwiftUI, iOS 17+. Pairs with the helper, lists sessions, shows a live feed. |

## Where the sessions live on the Mac

- Claude Code: `~/.claude/projects/<project-slug>/<session-uuid>.jsonl` (one JSON object per line).
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- Cursor (added 2026-10-20): agent transcripts at `~/.cursor/projects/<project-slug>/agent-transcripts/<id>/<id>.jsonl`. Sub-agent files under `<id>/subagents/` are skipped. Cursor CLI chats are kept in SQLite (`store.db`) and are not read. Cursor transcripts have no per-line time and no tool results, so Cursor shell calls show as `command` with no `output`.

The helper only **reads** these. It never writes, moves or deletes them.

## Network

- Helper listens on `0.0.0.0:7878` (env `MAC_BRIDGE_PORT` overrides).
- Bonjour: advertise `_macbridge._tcp` with TXT `name=<hostname>` (via the built-in `dns-sd -R` command; skip quietly if it fails).
- Away from home: v1 works over any private network that reaches the Mac (for example Tailscale). A hosted relay is v2.

## Pairing and auth

- First run makes a random 32-byte token (hex) at `~/.mac-bridge/token`, file mode `0600`.
- Helper prints a pairing link and a terminal QR code:
  `macbridge://pair?host=<lan-ip>&port=7878&token=<token>&name=<hostname>`
- Every HTTP call needs `Authorization: Bearer <token>`. WebSocket uses `?token=<token>` on the URL.
- Wrong or missing token → `401 {"error":"unauthorized"}`. Compare with a constant-time check.

## HTTP

All JSON. All `GET`.

| Path | Answer |
|---|---|
| `/v1/health` | `{ "ok": true, "name": "<hostname>", "version": "1" }` |
| `/v1/sessions` | `{ "sessions": [Session] }`, newest first, max 200 |
| `/v1/sessions/:tool/:id/events?after=<seq>&limit=<n>` | `{ "events": [Event] }`, `limit` default 200, max 500 |

`tool` is `claude`, `codex` or `cursor`. Unknown session → `404 {"error":"not_found"}`.

### Session

```json
{ "id": "string", "tool": "claude", "project": "fundhub-platform",
  "title": "first user line, max 80 chars", "updatedAt": "ISO-8601",
  "live": true, "eventCount": 42 }
```

`live` = file changed in the last 120 seconds.

### Event

```json
{ "seq": 17, "ts": "ISO-8601",
  "kind": "user | assistant | command | output | tool | system",
  "text": "string, max 8000 chars, cut with … at the end",
  "command": "only when kind=command", "exitCode": 0 }
```

- `seq` starts at 1 per session and counts up in file order. Same file → same seq numbers every time.
- `command` = a shell command the agent ran (Claude `Bash` tool call, Codex shell call, Cursor `Shell` tool call).
- `output` = what that command printed.
- `tool` = any other tool call (name + short input).
- Lines the helper cannot read are skipped, never a crash.

## WebSocket `/v1/stream?token=…`

Server sends one JSON object per message:

- `{ "type": "hello", "name": "<hostname>", "version": "1" }` on connect
- `{ "type": "session", "session": Session }` when a session is new or changed
- `{ "type": "event", "tool": "claude", "sessionId": "…", "event": Event }` for new lines in a subscribed session

Client sends:

- `{ "type": "subscribe", "tool": "claude", "sessionId": "…" }`
- `{ "type": "unsubscribe", "tool": "claude", "sessionId": "…" }`

Session updates go to everyone. Event updates go only to clients subscribed to that session.

## iPhone app rules

- `Info.plist`: `NSLocalNetworkUsageDescription`, `NSBonjourServices = ["_macbridge._tcp"]`, `NSCameraUsageDescription` (QR scan), ATS `NSAllowsLocalNetworking = true`.
- Token saved in the Keychain, never in `UserDefaults`.
- Pair by QR scan, by Bonjour pick + paste token, or by typing host/port/token.
- Session list: tool badge, project, title, time ago, green dot when live.
- Session view: chat bubbles for user/assistant, monospace cards for commands and output, auto-scroll when at bottom, reconnect with backoff.
