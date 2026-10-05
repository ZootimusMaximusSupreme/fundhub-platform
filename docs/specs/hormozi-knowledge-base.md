# Hormozi / ACQ knowledge base

Local markdown corpus from Chris’s Google Drive Hormozi libraries, for search, copy, and Company Brain.

## Sources

| Root | Drive id | Contents |
|------|----------|----------|
| ACQ Scale Advisory (Updated) | `1kftQwuLTtPsKukz8uJ7RR-s0yipXi1ds` | Course videos |
| Alex Hormozi library | `1iSD2Irx7PxnzdcKKAt_VPcrDkkjy94U_` | Videos + PDFs |

Skip folder `12k3Lw0igfPFKekT88R_01e-OsPj8aftt` (duplicate ACQ tree).

## Pipeline

1. **Inventory** — Recurse each root; build topic path from folder names.
2. **PDFs** — Download → `extractPdfText` → one `.md` per file under `marketing/knowledge/hormozi/<topic>/`.
3. **Videos (sequential, one at a time)** — Download → ffmpeg MP3 → Whisper (`WHISPER_MAX_BYTES` chunking) → ffmpeg frames (~every 90s, max ~25) → `callModel` (gpt-4o-mini) for on-screen notes → single `.md` with speech + vision sections.
4. **Resume** — `marketing/knowledge/hormozi/_ingest-state.json` tracks per-file PDF / speech / visual status. **OpenAI credits:** Whisper (`classifyWhisperFailure` / `WHISPER_CREDITS_ERROR`) and on-screen vision (`classifyModelFailure` / `MODEL_NO_CREDIT`) are hard-stopped by default (`--stop-on-no-credits`, on). The first credit failure writes `stopped_reason: "openai_credits_exhausted"`, logs one line, and exits **2** — no retry loop. A later run sees that flag and exits **2** immediately without calling OpenAI. After funding the account, delete `stopped_reason` from the state file and re-run with `--resume` (skips PDFs/videos already marked done).
5. **Index** — `marketing/knowledge/hormozi/INDEX.md` lists topics and files.
6. **Company Brain (optional)** — `--load-brain` upserts each finished doc via `upsertGeneratedDocument` (`sourceType: hormozi-kb`, `sourceKey: drive file id`).

## Query path

- Humans: browse `INDEX.md` or topic folders.
- Agents: grep / embed `marketing/knowledge/hormozi/**/*.md`; with `--load-brain`, use existing Company Brain retrieve on `hormozi-kb:*` keys.

## Run

```bash
node scripts/load-env.mjs  # or --env-file=.env
node scripts/hormozi-kb-ingest.mjs --pdfs
node scripts/hormozi-kb-ingest.mjs --speech --visual --resume
node scripts/hormozi-kb-ingest.mjs --load-brain --resume
```

Work downloads: `credentials/hormozi-kb-work/` (gitignored).
