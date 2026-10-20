# Mac Bridge helper

Runs on the Mac. Reads your Claude Code and Codex chats and shows them to the iPhone app. It is **read only**: it never writes, moves or deletes anything in `~/.claude` or `~/.codex`.

Contract: `docs/specs/mac-bridge-protocol-v1.md`. Node 22. No npm install, no packages.

## Start it

```
node tools/mac-bridge/agent/bin/mac-bridge.mjs
```

It prints a pairing link and a QR code. Open the iPhone app and scan the code (or paste the link). Stop it with Ctrl+C.

Options: `--port 7878` (or env `MAC_BRIDGE_PORT`), `--no-bonjour`, `--no-qr`, `--help`.

## What it does

- Listens on `0.0.0.0:7878`. Needs the phone on the same Wi-Fi, or a private network that reaches the Mac (for example Tailscale).
- Token: made on first run at `~/.mac-bridge/token` (mode 0600). Every call needs `Authorization: Bearer <token>`; the WebSocket uses `?token=<token>`. Anything else gets `401`.
- Advertises itself as `_macbridge._tcp` with the built-in `dns-sd` tool (skipped quietly if that fails).
- Lists the newest 200 sessions by file time. It reads a session file only when you ask for its events or subscribe to it, and after that only the bytes added since last time.
- Codex also writes hundreds of internal "guardian review" files. They are not chats, so they are hidden. Set `MAC_BRIDGE_SHOW_GUARDIAN=1` to show them.

## Try it from the Mac

```
T=$(cat ~/.mac-bridge/token)
curl -H "Authorization: Bearer $T" localhost:7878/v1/health
curl -H "Authorization: Bearer $T" localhost:7878/v1/sessions
curl -H "Authorization: Bearer $T" "localhost:7878/v1/sessions/claude/<id>/events?after=0&limit=50"
```

## Tests

```
node --test tools/mac-bridge/agent/test/
```

Tests use fake files in a temp folder. They never read the real session folders.

## Files

| File | Job |
|---|---|
| `bin/mac-bridge.mjs` | Entry. Starts the server, Bonjour, prints the link and QR |
| `src/server.mjs` | HTTP routes, WebSocket stream, auth |
| `src/sessions.mjs` | Finds files, indexes lazily, watches (`fs.watch` + 2 s poll), streams new events |
| `src/parse.mjs` | Claude Code and Codex lines to protocol Events |
| `src/ws.mjs` | Hand-written RFC 6455 WebSocket |
| `src/qr.mjs` | Small QR encoder (byte mode, level L, up to 271 bytes) |
| `src/token.mjs` | Token file and constant-time compare |
| `src/bonjour.mjs` | `dns-sd -R` wrapper |
