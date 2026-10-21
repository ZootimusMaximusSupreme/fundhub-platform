# Install Mac Bridge into Claude, Codex and Cursor

One command puts the Mac Bridge plug-in into all three tools:

```
node tools/mac-bridge/install/register-mcp.mjs --server /full/path/to/tools/mac-bridge/mcp/server.mjs
```

Leave out `--server` to use the `server.mjs` next to this folder.

You can run it again any time. It only changes what is different.

## Where it goes

| Tool | File | How |
|---|---|---|
| Claude Code | `~/.claude.json` (user level) | `claude mcp add --scope user` |
| Codex | `~/.codex/config.toml` | adds a `[mcp_servers.mac-bridge]` block. Backup: `config.toml.bak-macbridge` |
| Cursor | `~/.cursor/mcp.json` | adds `mac-bridge`, keeps the rest. Then `agent mcp enable mac-bridge` |

It does not touch the repo's shared `.mcp.json`.

## Options

- `--server <path>` — the `server.mjs` to use
- `--node <path>` — the node to use (default: the node running the script)
- `--only claude,codex` — do just some tools
- `--dry-run` — say what would change, change nothing

## After the branch merges

Point it at the main repo copy:

```
node tools/mac-bridge/install/register-mcp.mjs --server /Users/chrisstanbridge/Developer/fundhub-platform/tools/mac-bridge/mcp/server.mjs
```

## Check it

```
claude mcp get mac-bridge
codex mcp get mac-bridge
agent mcp list-tools mac-bridge
```

## Tests

```
node --test tools/mac-bridge/install/test/*.test.mjs
```
