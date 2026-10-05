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
3. **Videos (sequential, one at a time)** — Download → ffmpeg MP3 → speech transcript → optional on-screen notes → single `.md`.
   - **OpenAI path (default):** MP3 chunks → OpenAI Whisper API → ffmpeg frames (~every 90s, max ~25) → `callModel` (gpt-4o-mini) for on-screen notes.
   - **Local speech (free):** `--local-whisper` runs **whisper.cpp** on the same MP3 chunks from `splitMp3Chunks` (`src/company-brain/local-whisper.mjs`). Homebrew `whisper-cpp` on Apple Silicon uses Metal when built with Metal support. No OpenAI key required for speech.
4. **Resume** — `marketing/knowledge/hormozi/_ingest-state.json` tracks per-file PDF / speech / visual status. Videos that failed with `invalid_api_key` on API Whisper are retried when you re-run with `--local-whisper --speech --resume` (speech errors are cleared for that mode). **OpenAI credits:** API Whisper and on-screen vision are hard-stopped by default (`--stop-on-no-credits`, on). The first credit failure writes `stopped_reason: "openai_credits_exhausted"`, logs one line, and exits **2**. Local whisper ingest ignores that stop flag for speech. After funding the account, delete `stopped_reason` from the state file and re-run API modes with `--resume`.
5. **Index** — `marketing/knowledge/hormozi/INDEX.md` lists topics and files.
6. **Company Brain (optional)** — `--load-brain` upserts each finished doc via `upsertGeneratedDocument` (`sourceType: hormozi-kb`, `sourceKey: drive file id`). Requires a valid OpenAI key for embeddings.

## Local whisper.cpp setup

```bash
brew install whisper-cpp
```

Model (auto-download on first run if missing):

- `credentials/hormozi-kb-work/models/ggml-base.en.bin`
- Override: `WHISPER_CPP_MODEL`, `WHISPER_CPP_BIN`, or `WHISPER_CPP_MODEL_URL`

Optional repo-local build (Metal): clone under `credentials/hormozi-kb-work/whisper.cpp`, `cmake -B build -DWHISPER_METAL=ON`, `cmake --build build --config Release`. The ingest resolver picks `build/bin/whisper-cli` automatically.

Work downloads: `credentials/hormozi-kb-work/` (gitignored).

## Query path

- Humans: browse `INDEX.md` or topic folders.
- Agents: grep / embed `marketing/knowledge/hormozi/**/*.md`; with `--load-brain`, use existing Company Brain retrieve on `hormozi-kb:*` keys.

## Run

```bash
node scripts/load-env.mjs  # or --env-file=.env
node scripts/hormozi-kb-ingest.mjs --pdfs
node scripts/hormozi-kb-ingest.mjs --speech --visual --resume
node scripts/hormozi-kb-ingest.mjs --local-whisper --no-visual --speech --resume
node scripts/hormozi-kb-ingest.mjs --load-brain --resume
```
