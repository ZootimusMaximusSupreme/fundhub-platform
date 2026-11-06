---
name: fundhub-system-map
description: >-
  Discovery-only index of how Fundhub actually works. Use before claiming a
  journey PASS, e2e done, call sequence, or “we tested it.” Read
  the historical map from Git and verify current sources. Forbids desk-load, API-write, and
  0.13s Bland as sequence. Does not fix product code.
---

# Fundhub system map (discovery only)

You find the real order. You do not fix the app.

**Not this skill:** named repair (`fundhub-fixer`), new screens (`fundhub-builder`), Full End-To-End Audit gate (`.cursor/rules/full-end-to-end-audit.mdc` first).

## Before you say PASS or done

1. Read the historical map with `git show 3ba3e42f38a0e3e6db1a746ee3e3cb3e6b0db604:ops/workflows/system-map-2026-08-26.md`. It is a 2026-08-26 snapshot. Verify current claims against intended journeys, current source, and live configuration where authorized.
   If a shallow clone lacks that commit, fetch it from origin by its exact hash before reading, or mark the historical reference unavailable and continue checks that do not depend on it.
2. Cite the intended file **and** say if it has event order or only doors.
3. Walk **live fire** (`src/workflows/`) for that path. Editor trees in `src/journeys/seed-journeys.mjs` are the story, not proof.
4. Voice agents: load `.cursor/skills/fundhub-agent-tester/SKILL.md`. Use the **live** Agent Editor prompt. Count letters. A short stub that is “ready” still beats a long unused file on disk.

## Instant FAIL

- Desk or page **loaded**
- One API write (play name, expected inquiry, KPI JSON)
- Bland call **under ~8 seconds** (0.13s is FAIL)
- Funded tile **0** while `funding_rounds` has funded rows
- Intended file has **no talk order** and you still score sequence PASS
- Live AG-04 is 169 letters; the vendor setter prompt is 3,750 and unused (measured 2026-08-26; re-measure before quoting) — do not roleplay the disk file and call production done

## If intended has no talk / event list

Write **UNVERIFIED**. Overall cannot be PASS. Do not invent steps. Do not edit `*-intended.md`.

## Output

Map revision and path, the event list you walked, prompt source + hash + letter count, PASS / FAIL / UNVERIFIED. Stop. No product edits.
