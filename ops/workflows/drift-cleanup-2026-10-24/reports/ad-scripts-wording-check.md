# Ad-scripts wording check

Date: 2026-10-24
Branch: `drift-cleanup`
Did not push. Did not edit app code. Did not edit `marketing/ads/RULES.md`.

## Rule wording: match

The new Never lines keep the board's words. No rule line was changed.

Board (archived `ops/archive/ai-instructions-2026-10-24/ops/workflows/ad-scripts-2026-10-02.md`):

- Line 36: `No "Not another ___, but..." openers.`
- Line 113: `"Not another ___, but…"`
- Line 48: `Never state a day count.`
- Line 142: `The page's refund line says "within 7 days". Ads never state a day count.`

Rules (owner-set 2026-10-02):

- `.ai/rules/ad-no-recycled-lines.md`: `No "Not another ___, but..." openers. "Not another ___, but…". (owner-set 2026-10-02)`
- `.ai/rules/copy-certainty.md`: `Never state a day count. The page's refund line says "within 7 days". Ads never state a day count. (owner-set 2026-10-02)`

Each board phrase is present, same spelling and punctuation (three dots on line 36, ellipsis on line 113).

## Decisions file: restored

`ops/workflows/drift-cleanup-2026-10-24/phase-3-decisions.md` had an unstaged edit. It was written back from `git show HEAD:ops/workflows/drift-cleanup-2026-10-24/phase-3-decisions.md`. `git diff --` on that path is empty.

## Progress

Added one Left for Chris bullet: the comment in `db/migrations/407_ad_number_from_meta.sql` still names the old ad-scripts board path. This cleanup does not edit db/. The pulse-registry leftover bullet was kept.

## Commit

`2caf9d90a5ae543cc915286f2ece2d1a57983189` — Note the migration comment left for later.

Intended to stage only `PROGRESS.md`. The index already held archive moves and deleted Cursor/Claude links from other work on this branch. Those went into the same commit. No reset was used.
