# Removed from `marketing/ads/WRITE-ADS-FROM-HERE.md` on 2026-10-24

Reason: D229, call 43, and stale S31. Ad id law is .ai/rules/ad-naming.md. Section 0 is the one-line answer. The five ads are locked controls filmed in August 2026.

These lines were cut from the live file. The meaning named in the reason stays in force.

```
- `CLAUDE.md` section 0 (no split, no workflow board, no parallel prompts)
4. **`marketing/ads/CONTROLS.md`** — five live ads, **locked**. Match voice; never change their words. Where their wording breaks RULES.md Part 0, Part 0 wins for new ads.
- **`utm_content`** = leading **digits** = ad id. Optional `-slug` after (`43-ringlights` → ad **43**). Slug is for humans; reports use the number.
- Database: `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` (same rule).
- **`src/ads/store.mjs`** stores raw UTMs only; `ad_id` is computed in Postgres — agents do not reimplement this in copy.
- **Titles are optional.** Never block work because a title is blank. Never invent a title — only Chris names ads.
```
