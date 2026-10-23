# Ad editing skill — 2026-10-23

Chris: removing dead space in Submagic is bad. Build an editing skill so Submagic
only does eye contact, clean audio and captions, and the sound is smooth.

Status: research done. Build waits for Chris's go (CLAUDE.md §3).

## What the repo already has

| Piece | File | Runs today? |
|---|---|---|
| Join every take, best line once, script order, cut dead air, fillers, false starts | `src/ad-videos/merge-takes.mjs` (planner), `src/ad-videos/merge-takes-media.mjs` (ffmpeg + whisper.cpp) | Yes, on the Mac: `node scripts/ad-video-join-takes.mjs --dir <folder>` |
| Script-to-take aligner for the cloud worker | `src/ad-videos/align.mjs`, `src/ad-videos/ffmpeg-plan.mjs` | Code only. `video-worker/` does not exist yet |
| Submagic API caller | `src/messaging/providers/submagic.mjs` | Locks `magicBrolls`, `removeBadTakes`, `autoRender` off. `removeSilencePace` off unless passed |
| Editing skill | none | — |

Audio today: 12 ms fade at each cut, level each piece, two-pass loudnorm to -16 LUFS
(Mac joiner) or -14 (cloud plan). No noise cleanup. No room tone.

## Measured on Chris's edited files in ~/Downloads (2026-10-23)

| File | Size | Pauses over 0.5 s | Loudness | Peak |
|---|---|---|---|---|
| Direct-Book-Ad-16 (Edited no Animation) | 1080x1920, 67.6 s | 0 | **-30.1 LUFS** | -12.8 |
| direct-book-ad-4 (edited no animation) | 1080x1920, 74.8 s | 0 | **-29.1 LUFS** | -10.5 |
| SLO Ad 3 (DONE) | 1080x1920, 63.1 s | 1 (0.61 s at 0:29) | -28.0 LUFS | -7.1 |
| Direct Book Thank You Take 1 (Edited Pre Animation) | 2560x1440, 63.2 s | 0 | -18.8 LUFS | -3.7 |

Target for social ads: -14 LUFS, peak -1 to -1.5. The ads are about 15 dB too quiet.
Whisper found no um/uh and no doubled words in Ad 4 or Ad 16. The repeats it found
("if you have… it's up to") are in the script on purpose.

## Outside research (sources)

- Submagic create project: https://docs.submagic.co/api-reference/create-project
  - `cleanAudio` (noise removal) — in the API.
  - `removeSilencePace` (`extra-fast` / `fast` / `natural`) — leave it out = off.
  - `magicZooms`, `magicBrolls`, `removeBadTakes`, `hookTitle` — off by default.
  - Never send `aiEditTemplate` or `presetId`: they turn on auto cuts, B-roll and music.
  - **Eye contact: no API field.** App only: https://www.submagic.co/features/ai-eye-contact
  - Export size follows the plan: 1080p Starter, 2K Pro, 4K Business
    (https://care.submagic.co/en/article/in-what-quality-do-the-videos-get-exported-in-submagic-1842tsb)
- Eye contact by API: Sieve (https://sievedata.com/blog/eye-contact-correction-gaze-correction-api,
  about $0.10 a minute per a news report, not confirmed on Sieve's page). NVIDIA Maxine needs an
  NVIDIA card (the Mac has none).
- Word timing: WhisperX is right within 200 ms about 84–93% of the time
  (https://ar5iv.labs.arxiv.org/html/2303.00747). Snapping each cut to the nearest quiet spot
  fixes the rest.
- Auphonic cuts silence and filler with crossfades by API
  (https://auphonic.com/blog/2026/04/15/automatic-video-cutting/).
- Smooth joins: cut at a quiet spot, short crossfade, fill gaps with room tone, then two-pass
  loudnorm. ffmpeg `afftdn` / `arnndn` for light noise cleanup.

## Can it be 100%?

No cutting tool is 100% on its own. What we can make 100% is the **gate**: a checker that
measures every finished file and refuses to pass it unless every number is right. A file that
fails goes back, never to Chris.

Gate checks (all measured by ffmpeg + whisper, no AI guess):
1. No pause over 0.45 s inside speech. None at the start or end.
2. No um/uh. No line said twice unless the script says it twice.
3. Every script line is there, in script order.
4. Loudness -14 LUFS ±1, peak at or under -1.5.
5. No click at any cut (sample jump check at each join).
6. No black or frozen frames.
7. Size: 1080x1920 for ads, 3840x2160 for everything else.

## The plan (waits for go)

Split: 2 workflows, no dependencies — both parallel.

| # | Workflow | Owns | Status |
|---|---|---|---|
| E1 | Skill + gate | `.cursor/skills/fundhub-ad-editor/SKILL.md` + `.claude/skills` link; a checker script `scripts/ad-video-check.mjs` with the 7 checks above; tests both ways | pending go |
| E2 | Audio smooth | In `src/ad-videos/merge-takes-media.mjs`: snap cuts to quiet spots, room tone in gaps, light `afftdn`, loudnorm target -14 to match `ffmpeg-plan.mjs`; tests | pending go |

Submagic settings the skill locks: `cleanAudio: true`, a caption template, `dictionary`.
`magicZooms`, `magicBrolls`, `removeBadTakes`, `autoRender` false. No `removeSilencePace`,
no `aiEditTemplate`, no `presetId`. After the export: one loudnorm pass back to -14.

Eye contact: needs one Chris call — Sieve by API (new vendor, small cost), or skip it.

### Prompt E1 (paste into a new session)

Build the Fundhub ad editing skill. Read `ops/workflows/ad-editing-skill-2026-10-23.md` first.
Write `.cursor/skills/fundhub-ad-editor/SKILL.md` and link `.claude/skills/fundhub-ad-editor`
to it. The skill runs `node scripts/ad-video-join-takes.mjs --dir <folder>`, then the new
checker, then Submagic with the locked settings on the board. Write `scripts/ad-video-check.mjs`
that runs the 7 gate checks with ffmpeg and whisper.cpp (`credentials/hormozi-kb-work/`) and
prints pass/fail per check. Add pass and fail tests under `scripts/`. Work in a worktree. Commit.

### Prompt E2 (paste into a new session)

Make the audio smooth in the Mac joiner. Read `ops/workflows/ad-editing-skill-2026-10-23.md`
first. In `src/ad-videos/merge-takes-media.mjs` only: snap each cut to the quietest point
within 60 ms, fill gaps with the take's own room tone instead of hard silence, add a light
`afftdn` pass, and set `TARGET_LUFS` to -14 to match `src/ad-videos/ffmpeg-plan.mjs`. Keep the
12 ms fades. Update `merge-takes-media.test.mjs`; never weaken a test. Work in a worktree. Commit.

## Leftovers (not this task)

- The Thank You video is 2560x1440, not 4K (`video-4k-unless-ad` law).
