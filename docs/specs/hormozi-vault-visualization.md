# Hormozi vault — topic query + open-source graph browser

The scraped corpus lives at `marketing/knowledge/hormozi/`. Folder names mirror Drive topic paths. Company Brain search is separate (embeddings in Postgres).

## Topic query (local, no API)

| File | Purpose |
|------|---------|
| `marketing/knowledge/hormozi/INDEX.md` | Human table of contents by topic |
| `marketing/knowledge/hormozi/topics.json` | Machine catalog (`topic`, `topicPath`, `files[]`) |
| `scripts/hormozi-kb-query.mjs` | List topics or filter files + optional `--grep` |

```bash
node scripts/hormozi-kb-inventory.mjs --repair   # refresh INDEX + topics.json
node scripts/hormozi-kb-query.mjs --list-topics
node scripts/hormozi-kb-query.mjs --topic "Attraction Offers"
node scripts/hormozi-kb-query.mjs --topic "ACQ Scale Advisory" --grep "payback"
```

**No API key path (owner-set 2026-10-05):** Do not run Hormozi `--load-brain` or `--visual`. Search is local (`hormozi-kb-query.mjs`, grep, Logseq). Company Brain embed is optional and off for this corpus unless owner reverses.

## Open-source Obsidian-style browser (owner pick)

There is **no** bundled graph app in this repo yet (TODO 10/3). The vault is plain Markdown; point an open-source app at the folder:

| App | License | Why |
|-----|---------|-----|
| **[Logseq](https://logseq.com/)** | AGPL | Folder graph, backlinks, reads `marketing/knowledge/hormozi` as a graph vault |
| **[SiYuan](https://github.com/siyuan-note/siyuan)** | AGPL | Block notes + graph; import folder |
| **[Foam](https://foambubble.github.io/foam/)** | MIT | VS Code / Cursor extension on the same folder (no separate app) |

**Not open source:** Obsidian (free, closed). Fine to use, but the TODO asked for OSS.

### Logseq setup (recommended)

1. Install Logseq (desktop).
2. **Add new graph** → choose folder:  
   `/Users/chrisstanbridge/Developer/fundhub-platform/marketing/knowledge/hormozi`
3. Open `INDEX.md` or any lesson; use the graph view for topic links.

Do not commit Logseq’s `.logseq/` metadata into git unless Chris wants it — add to local ignore if it appears.

Board: `ops/workflows/hormozi-kb-finish-2026-10-05.md`.
