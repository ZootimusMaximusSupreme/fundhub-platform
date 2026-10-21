# Teleprompter load — 2026-10-21

Board for one job: put the 5 green-lit scripts (2026-10-15) into the live teleprompter.
No split: each step needs the one before it (load, then shoot, then proof).

| Unit | Owner | Status |
|---|---|---|
| Load 5 scripts, add to the open shoot, prove it | Claude (this session) | done |

## Sources (words copied exactly, nothing reworded)

- VSL: `marketing/vsl/direct-book-vsl-2026-10-15.md`, everything after `---`.
- Thank-you: `marketing/vsl/direct-book-thank-you-2026-10-15.md`, everything after `---`.
- Ad 13, Ad 14, Blueprint Ad 3: `marketing/ads/scripts/2026-10-14.md`, sections 1, 2, 3 (spoken words only).

Script: `scripts/ad-scripts-load-direct-book-2026-10-21.mjs` (dry-run by default, `--apply` writes, safe to re-run).
Ads 103 and 104 go through `editScript()`. The 3 new ones are `ad_scripts` rows (status locked, source chris).
The shoot was changed through `writeShoot()`.

## Manifest

| ad_id | title | version | offer |
|---|---|---|---|
| 103 | /watch VSL (book-a-call) | v3 → v4 (721 words) | funding_dfy |
| 104 | /watch thank-you video | v2 → v3 (253 words) | funding_dfy |
| 105 | Direct Book Ad 13 — 700 and up, hundreds of clients | v1 (180 words) | funding_dfy |
| 106 | Direct Book Ad 14 — 780 and up, 13 optimization points | v1 (295 words) | funding_dfy |
| 107 | Capital Blueprint Ad 3 — 600 and up, the shortest path | v1 (240 words) | capital_blueprint |

Old versions of 103 and 104 are archived (superseded), not deleted. Numbers 105 to 107 are the next free ones above the highest in `ad_scripts` (104), `ad_videos` (86), `ads` (90) and `registry.json` (91).

## Shoot (id 080d041a-6e52-4f52-9fbc-9506a2ce5381, status filming)

Film order now: 103 VSL, 104 thank-you, 105 Ad 13, 106 Ad 14, 107 Blueprint Ad 3, then the 11 scripts already on it, in their old order (92 to 102). 16 scripts. Nothing removed.

## Proof

- Live `GET https://fundhub.ai/api/marketing/shoot` returns all 5 in the top 5 places. Each body is the exact tail of its source file (checked by code, character for character).
- `https://fundhub.ai/app/teleprompter.html` opens on the new VSL: "The condition of your credit decides whether you walk away with $20,000...". Marked screenshot: `ops/workflows/teleprompter-load-2026-10-21-proof.png`.
- The teleprompter was opened with no sign-in (the old-bookmark path the API allows), not signed in as staff. Agents do not type the staff password into the live login.

## Leftovers

- The two edits saved with an empty `hook_text` (editScript sets it empty when the words change). Old versions had the first paragraph there. The teleprompter does not need it.
- The repo mirror files for 103 and 104 in `marketing/ads/scripts/machine/on-demand/` are queued in the outbox. The worker writes them.
