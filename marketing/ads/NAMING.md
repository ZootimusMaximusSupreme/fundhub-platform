# Ad file names

**Owner law (2026-09-24).** Chris set this. This is the name. Do not shorten it. Do not invent a second pattern.

The rules that repeat this law:

- `.cursor/rules/ad-naming.mdc`
- `.claude/rules/ad-naming.md`

## The structure

Four parts, in this order:

`Offer / Ad # / Angle / Take #`

On the file, that is one line:

`SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4`

| Part | What it is | In the example |
|---|---|---|
| Offer | Which offer the ad sells | `SLO` |
| Ad # | The ad number | `Ad 7` |
| Angle | The name of that script. The words in the title. | `Haynes, the call that was never a roadmap` |
| Take # | Which take of that same script | `Take 1` |

The angle is the name. It is not optional. A file with the angle left off is the wrong name.

## How to write it

`{Offer} Ad {number} — {angle} Take {number}.mp4`

Spaces stay. The dash before the angle is ` — ` (space, em dash, space). The take words are `Take 1`, not `t01`, not `Take1`.

## The seven SLO ads

These angle names are the titles in `marketing/ads/slo/fundhub-297/FundHub-LOCKED-ADS.md`. Copy them. Do not rename the angle.

Ad 5's angle is the title in `marketing/ads/slo/fundhub-297/FundHub-297-Ads-FINAL.pdf`. The markdown locked file still has the older Ad 5 opening.

| Ad | File name for take 1 |
|---|---|
| 1 | `SLO Ad 1 — Straight offer, full read Take 1.mp4` |
| 2 | `SLO Ad 2 — Straight offer, declined open Take 1.mp4` |
| 3 | `SLO Ad 3 — Straight offer, what your file is worth Take 1.mp4` |
| 4 | `SLO Ad 4 — Straight offer, the roadmap without the call Take 1.mp4` |
| 5 | `SLO Ad 5 — Straight offer, max fundability, both sides of the file Take 1.mp4` |
| 6 | `SLO Ad 6 — Haynes, you already know Take 1.mp4` |
| 7 | `SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4` |

Take 2 of the same script changes only the take:

`SLO Ad 7 — Haynes, the call that was never a roadmap Take 2.mp4`

## The Direct Book offer (owner-set 2026-10-10)

The book-a-call ads are the **Direct Book** offer. Its offer word is `Direct Book`, spelled like the dashboard.

**The ad number is the ad's number inside its offer.** It is not the tracking number in the ad link. `SLO Ad 7` is tracking number 90. `Direct Book Ad 2` is tracking number 93.

**The angle is only the name.** An old label or a film note in a script's title is not the angle. `Ad 19 — Over and over (broad, film first)` is the angle `Over and over`.

The eleven ads, numbered in film order:

| Ad | File name for take 1 |
|---|---|
| 1 | `Direct Book Ad 1 — Tool analogy, the hammer on the flat tire Take 1.mp4` |
| 2 | `Direct Book Ad 2 — Over and over Take 1.mp4` |
| 3 | `Direct Book Ad 3 — It's a skill Take 1.mp4` |
| 4 | `Direct Book Ad 4 — High earners Take 1.mp4` |
| 5 | `Direct Book Ad 5 — Paying for speed Take 1.mp4` |
| 6 | `Direct Book Ad 6 — The hidden tax Take 1.mp4` |
| 7 | `Direct Book Ad 7 — Notes green screen, seven steps Take 1.mp4` |
| 8 | `Direct Book Ad 8 — Notes green screen Take 1.mp4` |
| 9 | `Direct Book Ad 9 — The bank Take 1.mp4` |
| 10 | `Direct Book Ad 10 — Scale without your own cash Take 1.mp4` |
| 11 | `Direct Book Ad 11 — The penthouse Take 1.mp4` |

Two films in this offer are not ads. One is a VSL. The other is the thank-you video.

- The VSL: `Direct Book VSL 1 — Watch page Take 1.mp4`
- The thank-you video: `Direct Book Thank You Take 1.mp4`

The teleprompter builds these names by itself and saves each take to Drive under its name (`src/marketing/shoot-plan.mjs`). A script's place in its offer is stored on the script: `stack_kind`, `stack_no`, `angle_name` (migration 479).

## What belongs in one file

Same offer, same ad number, and the same angle are takes of one video. Join those takes. Read the words first. The words decide the angle. The file name does not.

A different angle is a different video. Do not join it.

The both-sides tape is Ad 5. Ad 7 is only the Haynes script above. Do not join them.

## Wrong names

These are wrong on Drive:

- `086_t01_raw_2026-09-24.mp4`
- `087_t01_raw_2026-09-24.mp4`
- `SLO Ad 7 Take 1.mp4` (the angle name is missing)
- `SLO Ad 7 Call Pitch.mp4` (a nickname stood in for the angle)
- `Ad 7 — Haynes, the call that was never a roadmap.mp4` (the offer and the take are missing)

## Where this applies

Google Drive file names for these ads. **Filmed files live in SLO Ads root only** (see `.cursor/rules/slo-one-filmed-folder.mdc`).

A new offer uses its own offer word in the first slot. The other three slots do not change.
