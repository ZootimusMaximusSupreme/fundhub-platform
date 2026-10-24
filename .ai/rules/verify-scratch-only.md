---
description: Never run verify/harness against live DB; never pause outbound or mass-retire agents for safety
alwaysApply: true
---

# Verify / harness is scratch-only

**Owner law (2026-08-24):** `npm run verify:e2e` and the scratch harness must never touch the live/production database again.

## Never

- Run `npm run verify:e2e`, `node src/verification/run-all.mjs`, or any scratch harness against live/`DATABASE_URL` production
- Flip `messaging_settings.outbound_enabled` off “for safety,” for a probe, or as verify cleanup on a live company
- Mass-retire live agents (`UPDATE agents SET status='retired'…`) as test cleanup on live (that retired AG-04 / AG-09)

## Always

- Point verify at a **scratch** database only, as `fundhub_app` (not a superuser)
- Call / respect `src/verification/scratch-guard.mjs` (`assertHarnessSafe`) before any harness write
- If a probe needs agents, use **scratch only** — never retire or rewrite live Agent Editor rows for a test

See CLAUDE.md §12 (`verify:e2e` trap) and `product-is-live.mdc` (do not pause outbound to “be safe”).
