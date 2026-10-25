# Claude brief — Submagic look, eye tracking, B-roll (paste this)

Copy everything below the line into Claude. Repo context is accurate as of 2026-09-23.

---

You are helping Chris (Fundhub) lock **Submagic API settings** and **B-roll coverage** before we spend API minutes. This is **not** a creative writing task for ad scripts — that is separate (`FundHub-LOCKED-ADS.md`, `FundHub-VSL-Scripts.md`).

## What Submagic is in our stack

- **Submagic** = paid video API: upload MP4 → captions + optional effects → export MP4. No chat prompt.
- **Our worker** (`src/messaging/providers/submagic.mjs`, `src/ad-videos/pipeline.mjs`) calls Submagic; Chris only **films** and **approve/rejects** on phone.
- **Claude (Anthropic)** in the pipeline = match **spoken words** to a script ad number, then rename the Drive file. Not Submagic.
- **B-roll** = **our** clips only (`type: user-media`). **AI B-roll is forbidden** (`magicBrolls: false`) — 3 credits/clip, ~15/month.
- Docs: `docs/video-pipeline-plan.md`, `docs/journeys/ad-video-flow.md`, `docs/specs/video-pipeline-unknowns-settled-2026-09-22.md`, `docs/workflows/slo-ads-content-map-2026-09-23.md`, `docs/workflows/ad-video-pipeline-ready-2026-09-23.md`.

## What the code **already forces off** (non-negotiable unless we change code on purpose)

On every `POST /v1/projects/upload`:

| API field | Our value | Why |
|-----------|-----------|-----|
| `autoRender` | **false** | Must read `words[]` before placing B-roll, then export |
| `magicBrolls` | **false** | No AI stock B-roll |
| `removeBadTakes` | **false** | Avoid mystery cuts |
| `removeSilencePace` | **not sent** | Silence cut **shortens the timeline** and can break B-roll timing vs transcript |

Optional today: `templateName`, `hookTitle`, `cleanAudio`, `dictionary`, `webhookUrl`.

**Not wired in our code yet:** `magicZooms` (Submagic docs list this on create/upload — often used for zoom/face emphasis; **verify in https://docs.submagic.co whether this is “eye contact / gaze” and what values are allowed**).

## What Chris wants (product rules)

1. **Eye tracking / gaze** — ON if Submagic supports it via API (confirm field name + value; likely `magicZooms` or a preset — do not guess).
2. **No fancy edits** — no jump cuts, no montage, no AI B-roll, no “bad take” removal unless we explicitly turn it on later.
3. **Dead space** — Chris **does** want long pauses trimmed (dead air). **Conflict:** our repo left silence cut **off** so B-roll timestamps stay aligned with `words[]`. Give a **clear recommendation**: (A) light silence trim + re-read `words[]` after trim if API allows, (B) trim only in export preset, or (C) keep silence off and Chris trims in Riverside before upload — pick one and say what to change in `submagic.mjs`.
4. **Merging clips** — if Chris filmed multiple segments in one file, Submagic may or may not merge; if not, merging happens **before** upload (Riverside/export). Say what Submagic can vs cannot do via API.
5. **B-roll fully covered** — our planner (`src/ad-videos/broll.mjs`) matches **keywords in clip filenames** to **words in the transcript** (max ~5 clips, ~3s each, `cover` layout). Clips live in Drive under SLO Ads **`broll/`** (`approvals`, `portal`, `deliverables`) via `scripts/slo-broll-upload.mjs`. Output:
   - A **checklist** of keyword themes we need clips for (approval email, portal, funding amount, etc.) from locked ads.
   - How to name files so `keywordsFromName()` fires reliably.
   - Gaps: which lines in AD 1–7 have **no** matching clip today.

## Caption / “looks good”

- Submagic **`templateName`** (and/or preset from `GET /v1/templates`, `GET /v1/presets`) controls caption style — not a prose prompt.
- Recommend **one Fundhub default template** for **ads** (vertical, readable, on-brand) and whether **VSL segments** use the same template or a calmer one.
- Chris wants: clean, professional, not TikTok flashy; face stays hero; B-roll is punctuation.

## Deliverables (what I need back)

1. **API cheat sheet** — table: Chris desire → Submagic field → recommended value → wired in repo? (yes/no/file line).
2. **Eye tracking** — exact API setting after reading Submagic docs (or “not available via API — use UI preset X only”).
3. **Dead space policy** — one chosen approach and exact code change in `createProjectFromFile` if we enable `removeSilencePace`.
4. **B-roll coverage matrix** — AD 1–7 + retarget: line/theme → clip filename pattern → covered? (Y/N).
5. **Pilot plan** — **one** ad file from Raw (`SLO Ad 1 Take 1.mp4` or your pick from content map) as first Submagic project; do **not** recommend batch-processing all 14 Raw files.
6. **Token/cost guard** — remind: ~30 creates/hour; one export per finished ad; no AI B-roll.

Do not tell Chris to log into Submagic UI as the default path — we push via API. UI is only for picking a **template name** to hardcode if docs require it.

Reference Submagic docs: https://docs.submagic.co/api-reference/upload-project and create-project.
