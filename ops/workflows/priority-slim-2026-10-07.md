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

### Known gaps (not “100%” yet)

- Board **LEFTOVER:** 6 logged sales calls still had no recording/transcript (2026-09-18 AG-07 snapshot) — re-check on next pulse.
- **Closer context:** system map notes live `/api/read/agent-context` has lagged on **spoken words** (`said:` from transcript) — Meet tape → transcriber → `fetchContext` is a dictator e2e row, not proven end-to-end on live.
- **Encryption/decryption API** for sales recordings: **no dedicated sales-recording encrypt module found** in repo (push/Plaid use row-bound encrypt elsewhere). Needs a **written spec** from Chris: what is encrypted (Drive link, blob, at-rest file), who decrypts, which API routes — then build backend first.

### Heartbeat (when “done”)

Same change as the feature ships:

- `meet-transcript-sweeper` stays on `src/pulse/heartbeats.mjs` (already listed).
- Add any **new** live route or sweeper for recordings to `PULSE_REGISTRY` / `MACHINE_CHECKS` in the same commit.

## This session owner

- Align monitoring and live Playwright with **paused Brain**.
- **Do not** start Company Brain, Journey, or Galaxy builds.
- **Next build chat (when Chris says go):** sales recordings spec → backend (encrypt API if named) → prove → heartbeat.
