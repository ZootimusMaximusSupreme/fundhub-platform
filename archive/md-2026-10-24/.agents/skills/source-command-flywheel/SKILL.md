---
name: "source-command-flywheel"
description: "Run the marketing flywheel — avatar, ad research, offer, copy, ad strategy — one stage at a time with a review after each."
---

# source-command-flywheel

Use this skill when the user asks to run the migrated source command `flywheel`.

## Command Template

# /flywheel

Runs the marketing flywheel for a campaign. Read `marketing/flywheel/README.md` before
the first run.

Usage the user may type:

```
/flywheel status [campaign]           where things stand
/flywheel stage <n> [campaign]        run one stage
/flywheel run [campaign]              run 1-5, stopping after each for review
/flywheel run [campaign] --auto       run 1-5 without stopping
/flywheel approve <n> [campaign]      mark a stage approved
/flywheel tweak <n> [campaign] "..."  record a correction and re-run that stage
/flywheel spend [campaign]            pull real ad results and decide what to fix
```

`campaign` defaults to `partner`.

## The section 0 split, answered

Do not re-propose a split for this command. It is already decided:

**Stages 1 and 2 run at the same time.** Ad research needs the market, not the
avatar — the avatar only improves it. **Stages 3, 4 and 5 are strictly serial**;
each genuinely needs the one before it. Board: `ops/workflows/flywheel-partner.md`.

## How to run a stage

1. **Check first.** `npm run flywheel:status <campaign>`. If the stage's inputs
   are stale or missing, say so and stop. Do not run a stage on a broken input.

2. **Build the args.** Every workflow takes an object. `today` is **required** on
   all of them — the clock throws inside a workflow, so the date must be passed
   in. Read the input files off disk and pass their content:

   | Stage | Workflow | args |
   |---|---|---|
   | 1 | `avatar-builder` | the service description as a plain string |
   | 2 | `ad-research` | `{campaign, today, market, avatarSummary, competitors?, ownerNotes}` |
   | 3 | `offer` | `{campaign, today, avatarSummary, adResearchSummary, ownerNotes}` |
   | 4 | `copy` | `{campaign, today, offerSummary, avatarSummary, languageBank, burnedOutAngles, ownerNotes}` |
   | 5 | `ad-strategy` | `{campaign, today, offerSummary, copySummary, creativeCount, ownerNotes}` |

   `ownerNotes` is always the `## Notes` section of `00-OWNER-NOTES.md`. Pass it
   every time. It is how corrections survive a re-run.

3. **Run it**, then **write the result to disk** yourself. The workflow cannot
   write files. Take its `document` and its `counts` and write the stage file
   with a stamp:

   ```
   ---
   stage: <n>
   version: <previous + 1, or 1>
   status: draft
   inputs:
     <each input file>: <first 8 chars of sha256 of that file's BODY>
   counts:
     <every key from the workflow's counts object>
   ---
   ```

   The body hash is everything after the input file's own closing `---`. Get it
   with the exported `bodyHash` from `scripts/flywheel/status.mjs` rather than
   computing it by hand.

4. **Check the gate.** `npm run flywheel:status <campaign> --gate <n+1>`. If the
   stage it just wrote does not clear its minimum counts, say so plainly — a
   thin run is a finding, not something to paper over.

5. **Stop and show the review card.** Print the `## Review card` block from the
   document. Do not print the whole document unless asked. Then wait.

   Under `--auto`, skip the stop and continue, but still print each card.

## approve

Change `status: draft` to `status: approved` in that stage's stamp. Nothing else.
The hash covers the body only, so approving never marks anything downstream stale.

## tweak

Append one line to `00-OWNER-NOTES.md` under `## Notes`:

```
YYYY-MM-DD | stage N | the correction in one line
```

**Append. Never rewrite the file.** Then re-run that stage with the updated notes,
and tell the user which downstream stages just went stale.

## spend

`META_ACCESS_TOKEN` in the local `.env` is valid and never expires, and it can
read Fundhub's own ad account. Use it — no manual export is needed.

Pull spend, clicks and cost per result per ad, then match ads back to copy by the
`pieceId` prefix in the ad's name. **Report unmatched ads; never drop them
silently.** Then route to exactly one conclusion:

- clicks low, cost to show the ad normal → **copy** is the problem, re-run stage 4
- clicks fine, cost per lead high → **offer** is the problem, re-run stage 3
- nothing works at any angle → **market** is the problem, re-run stages 1 and 2

## Rules

- **Never overwrite `00-OWNER-NOTES.md`.** Append one line.
- **Never write a stage file without a stamp.** An unstamped file is invisible to
  the staleness check, which defeats the whole thing.
- **`--auto` never launches an ad.** The last artifact is a written plan. Nothing
  in this pipeline spends money; Chris does that in Ads Manager himself.
- **No compliance checking** (owner-set 2026-08-31). The product already screens
  ads before they send, in `src/compliance/`. Do not add a review step, and do not
  attach compliance advice to any stage output.
- Report honestly. If a stage came back thin, say it came back thin.
