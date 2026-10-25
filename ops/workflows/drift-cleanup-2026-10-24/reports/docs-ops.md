# Docs and SOP cleanup

Branch `drift-cleanup`. This group only. No commit.

Cut text is in `ops/archive/ai-instructions-2026-10-24/removed-lines/`. Nothing was deleted.

## Files changed

- `docs/sops/RUNBOOK.md` — dated banner. Decision #27 lines (migrations, who runs the command, 2 a.m. email, "no monitoring", "nothing sends"). D218 paste pointer. D219 delete-data and `INNGEST_EVENT_KEY` pointers, with the 2026-08-20 date kept. S20 to S24. Headings, `/api/health?strict=1`, and 503 stayed. `src/http/monitoring.test.mjs`: 8 pass, 0 fail.
- `docs/sops/README.md` — same banner. Removed the 2026-08-14 stack line (S17) and "Do not dump the paused outbound queue" (S18).
- `docs/sops/clickfunnels-custom-html-push.md` — D220, D221, D222, D223, D224, S43. `/apply` is custom HTML, manifest key `apply-survey`. The first sentence on line 8 stayed, including the old FundHub spelling in that kept sentence.
- `docs/rules/TELEPROMPTER-VIDEO.md` — D214 path is `.ai/rules/teleprompter-camera.md`. D215 law line. Saved-file sentence, failed-quality sentence, and upright-preview sentence stayed. Owner call 2026-10-13 stayed. S14 batch sentence and S15 measured take archived. D216 checklist from current AGENTS.md, including "iPhone mic on", "Rode on", the saved-frame-rate sentence, and Direct Book never in the SLO folder. AGENTS.md was not edited.
- `docs/journeys/ad-video-flow.md` — the Raw-folder parenthetical (was line 265) now says `DRIVE_RAW_FOLDER_ID` is the SLO Ads root `13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ`.
- `ops/workflows/pulse-layer-2026-10-09-brief/04-alerts-and-github.md` — line 65: "text at once" is now "text inside the texting window".
- `README.md` — S5 to S11 and D9, plus the Vercel word on line 3. It now says one Netlify site. The two schema file bullets stayed. Cognee line is the pgvector sentence (owner-set 2026-08-02).
- `docs/specs/W1-money-model.md`, `W3-decline-autopsy.md`, `W4-live-trial.md`, `W6-pricing-menu.md`, `W7-curriculum.md` — removed only the false "CLAUDE.md section 7 says the label stays" sentence. The COMPLIANCE REVIEW REQUIRED banners stayed as history. On W3 that sentence was in section 14, not line 3.
- `.ai/README.md` — under "To add or change a rule", before the steps: "The steps below are the commands." then the rules-no-drift pointer.

## Handoff

- `docs/specs/teleprompter-ios-app-build-2026-10-10.md` (stale S25). Not in the W1 W3 W4 W6 W7 list, so this group left it.
  - Lines 3-4: `**Status: paused.** Chris: the web teleprompter works fine for now. When the app goes out he pays the $99 Apple developer account and this gets built. Nothing here is started.`
  - Lines 6-7: `Chris pays the $99 Apple developer account at the end of this week.`
  - Lines 52-53: `1. Pay for the Apple developer account ($99 a year). Without it the app has to be put back on the phone by cable every 7 days.`
  - The plan says rewrite the status to "in progress; see `ops/workflows/two-ios-apps-launch-2026-10-16.md`" and drop owner step 1. `teleprompter-speed` cites this spec, so the file stays.

## Skips

- `docs/sops/postgres-least-privilege.md` — no banner. The dedupe plan only notes that line 357 cites CLAUDE.md section 11.
- `ops/workflows/animation-builds-2026-10-22.md` line 5 — `show.sh` printed no edit, so the board was not rewritten. Decision #36 still says correct this line: `Pipeline (Chris, 2026-10-22): film in BigVU → Submagic edits and adds captions → Chris downloads → we add the animations. So every animation must stay clear of the captions.`
- `docs/sops/RUNBOOK.md` still says `` `--secret` goes on anything holding a password. Always. `` D218 said do not touch it here. That fight is phase 3 call #10.
- `docs/specs/W4-live-trial.md` around line 672 still says "Standing rule from CLAUDE.md §7." That is not the label-stays sentence, so it stayed.
- `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md` stale S44 is already the new `/apply` sentence (page 25515671, manifest key `apply-survey`). This group did not edit the skill.
- `marketing/ads/video-pipeline-plan.md` line 11 already names call 32 (file names, Raw folder, `autoRender`). This group did not edit `marketing/ads/`.

## Drift check

`node scripts/rules-drift-check.mjs` exited 1. Counts: pointer=19, index=1, claudemd=1. None of the 21 lines name a file in this group. They name CLAUDE.md, AGENTS.md, and `.ai/rules/no-test-data-on-production.md`. This group did not fix them.

The closest ClickFunnels line is not one of this group's files:

- CLAUDE.md:206 names `.claude/rules/clickfunnels-html-api-push.md` but it does not exist.
