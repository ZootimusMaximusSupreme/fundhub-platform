---
description: Drive ad file names are Offer, ad number, angle name, then take number
alwaysApply: true
---

# Ad naming

**Owner law (2026-09-24):** This is the file name. Chris set it. Do not shorten it.

## Law

`Offer / Ad # / Angle / Take #`

The file on Drive is:

`SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4`

The angle is the name of that script (the words in its title), never a nickname. The offer words and the full table are in `marketing/ads/NAMING.md`.

Same offer, same ad number, and the same angle are takes of one video. A different angle is a different video. Read the words before a join.

The book is `marketing/ads/NAMING.md`. The live list of filmed names is `marketing/ads/filmed-names-2026-10-22.md`.

Owner-set 2026-10-22: call every filmed video by its `NAMING.md` name. Never use the recording app's auto title or the app's name (Chris: "stop calling it riverside, thats not the name of the offer structure, use repo rules").

## Example

```text
Ad 7, Haynes script, first take.

❌ 087_t01_raw_2026-09-24.mp4
❌ SLO Ad 7 Take 1.mp4
✅ SLO Ad 7 — Haynes, the call that was never a roadmap Take 1.mp4
```

## Ads are found by id, not by name (owner-set 2026-09-06)

`utm_content` is leading digits with an optional `-slug` (`43-ringlights` is ad 43). `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` ignores the slug, so `utm_content=43` resolves with no name at all. `src/ads/store.mjs` stores raw UTMs only; the ad id is computed in Postgres. Meta's own API keys on its ad id too. So never make naming a blocker, never ask Chris to name ads before something else can proceed, and never call an untitled ad a defect. Only Chris names an ad: leave the tracking title blank and never invent one. A title makes a report readable and nothing else. This is about the tracking title only; Drive file names follow `marketing/ads/NAMING.md`.
