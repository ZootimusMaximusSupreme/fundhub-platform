# Workflow board — pre-call trust assets

Date: 2026-10-11
Owner: Codex
Status: done

## Task list

| Unit | Owner | Status |
|---|---|---|
| Map the existing setting and pre-call system | Codex | done |
| Map Jeremy Haynes trust pillars to Fundhub assets | Codex | done |
| Write the backend-selling system | Codex | done |

## Shared context brief

Fundhub already has an AI setter, booking events, booking reminders, a
15-minute handoff, and BS-01. BS-01 runs a 3-day, 18-cell email grid from
T-48h, with funding and repair paths, and stops when the call is held. The
creative source is `marketing/ads/POST-BOOKING-15.md`, which contains 30
post-booking concepts in the four Hammer Them pillars.

## Change manifest

- Added `marketing/ads/backend-selling-system.md`.
- Added this board.
- No application code changed.
- No intended journey changed.

## Findings

- The system already has the backend launcher. The missing piece was one clear
  asset map tying the existing machine to the trust sequence and the later
  backend sale.
- The 15-post set should be selected from the existing 30 concepts before
  recording.
- The flow must keep live behavior separate from proposed asset production.

## Verification

- Read `src/workflows/bs-01-precall-launcher.mjs`.
- Read `src/workflows/ai-set-01-josh-setter.mjs`.
- Read `marketing/ads/POST-BOOKING-15.md`.
- Read the booking flow and closer playbook.
- No code or UI change was made, so lint, TypeScript, test, and Playwright runs
  were not needed for this documentation-only change.
