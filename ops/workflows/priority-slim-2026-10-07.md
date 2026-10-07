# Priority — slim down to scale (owner 2026-10-07)

Chris direction: focus on essential automated systems. Over-built personal tools wait.

## PAUSED / decommissioned (do not chase to “live”)

| Area | Status | Agent rule |
|------|--------|------------|
| **Company Brain** | **PAUSED** — not a live product priority. OpenAI/embed path is not a blocker. Content and ops use other paths. | No OpenAI key work. No “fix embed_failed” for pulse. Live desk sweep excludes Company Brain specs. |
| **Journey project** | **PAUSED** | No new journey build unless Chris re-opens. |
| **Galaxy features** | **PAUSED** | No new Galaxy work unless Chris re-opens. |

## PRIORITY — sales recordings (must reach 100% + heartbeat)

**Goal:** Sales team Meet recordings → words on the file → closer can use them. Monitored every morning and on job heartbeats.

### Already in repo (partial)

- Meet files in **Google Drive**; `src/sales/recordings.mjs` lists and links to `call_outcomes`.
- **Inngest:** `meet-transcript-sweeper` every **10 minutes** (`src/workflows/meet-transcript-sweeper.mjs`) — pairs transcript docs, Whisper for short files.
- **Pulse:** `unrecorded` row in daily pulse (`src/sales/unrecorded.mjs`); job heartbeat list includes `meet-transcript-sweeper` (`src/pulse/heartbeats.mjs`).
- **Coverage slices:** closer + calls slices expect sweeper + machine row.
- **API:** `POST /api/call-outcomes` accepts `recording_url`; `GET /api/read/unrecorded-calls`; Drive sync via `api/company-brain/sync` (Meet pickup — tied to paused Brain stack but sweeper still runs).

### Finished 2026-10-07 (this chat)

- Sweeper now **scans Drive first**, then pairs words. No one has to open Company Brain.
- Words still stamp on the sales call when Brain embed is down (Brain is paused).
- Morning pulse **MACHINE_CHECKS** row `meet-transcript-sweeper` watches last Drive scan (red after 30 min = 3× the 10 min job) plus stuck files with no words.
- Job heartbeat list already had `meet-transcript-sweeper`.
- Closer pack already prints `said:` from `call_outcomes.transcript` (`src/agents/context.mjs`). That stays.

### Encryption (looked up — not a new build)

Tapes stay in **Google Drive**. Google holds the file. We store the Drive link and the spoken words on the call. There is no second encrypt/decrypt API for sales video. Building one would be the same over-build as Company Brain. Do not add it unless Chris names the exact lock.

### Still a leftover (not this finish)

- Board **LEFTOVER:** old AG-07 snapshot of 6 calls with no tape (2026-09-18). Pulse `unrecorded` still counts live misses.

### Heartbeat (when “done”)

Same change as the feature ships:

- `meet-transcript-sweeper` stays on `src/pulse/heartbeats.mjs` (already listed).
- Add any **new** live route or sweeper for recordings to `PULSE_REGISTRY` / `MACHINE_CHECKS` in the same commit.

## This session owner

- Align monitoring and live Playwright with **paused Brain**.
- **Do not** start Company Brain, Journey, or Galaxy builds.
- **Next build chat (when Chris says go):** sales recordings spec → backend (encrypt API if named) → prove → heartbeat.
