# Mac Bridge — plug-in for Claude, Codex and Cursor

This is a small plug-in. Its tech name is an MCP server. MCP is the way AI tools add new skills.

With it, Claude Code, Codex and Cursor can each:

- see every AI chat on the Mac (`list_sessions`)
- read one chat, with its commands (`read_session`)
- hand a job to another AI (`delegate_task`: claude, codex, cursor, or auto)
- see the jobs (`list_tasks`)
- stop a job (`stop_task`)

## What it needs

The Mac Bridge helper must be running:

```
node tools/mac-bridge/agent/bin/mac-bridge.mjs
```

The plug-in talks to it at `127.0.0.1:7878`. It reads the key from `~/.mac-bridge/token`.

If the helper is off, the AI gets a plain message that says how to start it.

## Settings

| Name | What it does | Default |
|---|---|---|
| `MAC_BRIDGE_PORT` | Helper port | `7878` |
| `MAC_BRIDGE_TOKEN_FILE` | Where the key is | `~/.mac-bridge/token` |

## Install it in all three tools

See `tools/mac-bridge/install/README.md`.

## Tests

```
node --test tools/mac-bridge/mcp/test/*.test.mjs
```

The tests use a fake helper. They never touch the real one.

## Notes

- Node 22. No extra packages.
- It only prints protocol messages on stdout. Logs go to stderr.
- `cursor` jobs need the newest helper. An older helper gives a plain "older version" message.
