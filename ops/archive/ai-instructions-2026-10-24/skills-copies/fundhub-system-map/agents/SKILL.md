---
name: fundhub-system-map
description: >-
  Discovery-only index of how FundHub actually works. Use before claiming a
  journey PASS, e2e done, call sequence, or “we tested it.” Read
  ops/workflows/system-map-2026-08-26.md. Forbids desk-load, API-write, and
  0.13s Bland as sequence. Does not fix product code.
---

# FundHub system map (discovery only)

You find the real order. You do not fix the app.

**Not this skill:** named repair (`fundhub-fixer`), new screens (`fundhub-builder`), Full End-To-End Audit gate (`.cursor/rules/full-end-to-end-audit.mdc` first).

## Before you say PASS or done

1. Read `ops/workflows/system-map-2026-08-26.md` end to end.
2. Cite the intended file **and** say if it has event order or only doors.
3. Walk **live fire** (`src/workflows/`) for that path. Editor trees in `src/journeys/seed-journeys.mjs` are the story, not proof.
4. Voice agents: load `.cursor/skills/fundhub-agent-tester/SKILL.md`. Use the **live** Agent Editor prompt. Count letters. A short stub that is “ready” still beats a long unused file on disk.

## Instant FAIL (tonight’s lies)

- Desk or page **loaded**
- One API write (play name, expected inquiry, KPI JSON)
- Bland call **under ~8 seconds** (0.13s is FAIL)
- Funded tile **0** while `funding_rounds` has funded rows
- Intended file has **no talk order** and you still score sequence PASS
- Live AG-04 is 169 letters; vendor Josh is 3,750 and unused — do not roleplay the disk file and call production done

## If intended has no talk / event list

Write **UNVERIFIED**. Overall cannot be PASS. Do not invent steps. Do not edit `*-intended.md`.

## Output

Path to the map, the event list you walked, prompt source + letter count, PASS / FAIL / UNVERIFIED. Stop. No product edits.
