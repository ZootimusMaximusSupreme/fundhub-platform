# Teleprompter load — 2026-10-07

Board for one job: get Chris's scripts into the live teleprompter.

| Unit | Owner | Status |
|---|---|---|
| Load the scripts sent to Paul + the /watch VSL + thank-you video, and open a shoot | Cursor | pending |

## What was measured (Claude, 2026-10-07)

- Teleprompter: https://fundhub.ai/app/teleprompter.html (page loads, 200).
- It plays only the scripts on the open shoot (`marketing_shoots`, status not `done`). Live count: **0 shoots**.
- `ad_scripts` holds 9 rows: ads 84–90 (SLO 1–7, locked, 2026-09-24), ad 91 "The Conveyor Belt" (locked, 2026-10-07), one draft walk note. None of the scripts below are in it.
- What Chris sent Paul on 2026-10-06 (Gmail, sent to paul@directroas.com):
  - "Fundhub ads to run (book-a-call)" — 11 scripts.
  - "Fundhub book-a-call funnel: VSL + thank-you video" — 2 scripts.
- The repo copies match those emails (spot-checked line by line on 10-07):
  - 11 ads: `marketing/ads/scripts/book-a-call-final-2026-10-03.md`, sections 1–11.
  - VSL + thank-you: `marketing/ads/reference/vsl-scripts-latest.md`, sections "/watch VSL (book-a-call)" and "/watch thank-you video".
- `marketing/ads/registry.json` already uses id 16 and id 26. So the "Ad 16" / "Ad 19" labels can NOT be the database ad numbers.

## Prompt for Cursor (paste as is)

```text
Repo: fundhub-platform. Read CLAUDE.md first. This is data work only. Do not edit any page, HTML, CSS or JS under public/.
Board: ops/workflows/teleprompter-load-2026-10-07.md. Mark the unit claimed before you start.

GOAL
The live teleprompter (https://fundhub.ai/app/teleprompter.html) shows nothing. It plays only the scripts on the open shoot, and there is no shoot. The scripts Chris needs to film are not in the database. Fix that.

THE SCRIPTS — 12, in this film order. Copy the words exactly. Do not change a word.
From marketing/ads/scripts/book-a-call-final-2026-10-03.md:
  1. Script 4 — Tool analogy, the hammer on the flat tire
  2. Ad 19 — Over and over (broad, film first)
  3. Ad 14 — It's a skill
  4. Ad 15 — High earners
  5. Ad 17 — Paying for speed
  6. Ad 16 — The hidden tax
  7. Script 1 — Notes green screen, seven steps (double loop)
  8. Script 2 — Notes green screen
  9. Ad 9 — The bank
 10. Scale without your own cash
From marketing/ads/reference/vsl-scripts-latest.md:
 11. /watch VSL (book-a-call)
 12. /watch thank-you video
Skip section 11 of the book-a-call file (The penthouse). It was filmed 2026-10-04.

STEPS
1. Copy the pattern of scripts/ad-scripts-load-locked.mjs into a new script, scripts/ad-scripts-load-book-a-call.mjs. Same shape: dry-run by default, --apply to write, runs through asStaff, safe to re-run (skip any title that already has a live script).
2. Each script is one ad_scripts row: status 'locked', source 'import', offer_key 'funding_dfy', title = the section name above, body = only the spoken words. Strip "Shoot:" and "Marks:" lines, tables and film notes. Keep CAPS, blank-line pauses and ↑ marks — the teleprompter reads those. hook_text = the first spoken paragraph. For 11 and 12 use the script_type the table allows for a VSL (read the check constraint; do not add a new value).
3. Scripts 7 and 8 (Notes green screen) are bullets. Set style 'bullets' and put the talking points in parts as cues, the way public/app/teleprompter.js isBullets() and paragraphsFor() read them. Everything else rolls as plain text.
4. Ad numbers: the next free numbers above the highest in BOTH ad_scripts and marketing/ads/registry.json (today that is 92 to 103). Never reuse a low number like 9, 14, 16 or 19 — registry.json already uses 16 and 26, and low numbers collide with old utm_content clicks. Keep Chris's label in the title so he still sees "Ad 19 — Over and over".
5. Dry-run. Check all 12 rows. Then --apply against production DATABASE_URL from .env.
6. Open the shoot through the store, not raw SQL: writeShoot() in src/marketing/shoot-store.mjs inside an asStaff transaction, create move, root_script_ids in the order above. That also sets film_order.
7. Prove it: GET /api/marketing/shoot returns the shoot with all 12 in order. Then open https://fundhub.ai/app/teleprompter.html signed in as staff (Playwright) and confirm the first script rolls: "Where your file is right now determines the tool you need..." Take one marked screenshot (red box on the first line).
8. Commit the new script locally. Push with node scripts/github-push-whole-repo.mjs. Mark the board unit done and list every row written (ad_id + title) under "Manifest".

DO NOT
- Do not change any script's words.
- Do not touch ads 84–91 or the shoot rules.
- Do not load Ads 21–26, the penthouse, or anything not listed above.
- Do not delete anything.

REPORT (4th grade English, short)
What changed, what was proved, the URL, anything left.
```

## Manifest

(Cursor writes here when done.)
