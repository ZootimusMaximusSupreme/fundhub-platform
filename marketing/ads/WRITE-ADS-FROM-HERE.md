# Write ads from here (fast path)

Use this when Chris wants **ad copy**, not a repo audit.

**Best door:** Cursor Agent with **only** `marketing/ads/` open — or paste this file into a chat **without** attaching the whole Fundhub repo.  
**Slow door:** Claude Code with the full company loaded (`CLAUDE.md`, every cursor rule, journeys, tests). That path is for shipping product code, not hooks.

---

## Do not load

- `CLAUDE.md` section 0 (no split, no workflow board, no parallel prompts)
- Journeys, CRM desks, `src/`, pulse registry, or `npm test` for the whole repo
- Creative Factory unless Chris asked to **save** a script into the CRM (that screen is heavy and runs DB compliance later)

---

## Read only (in this order)

1. **`marketing/ads/RULES.md`** — Part 0 (Chris's rules) first, and it wins over everything else; then hard no's, word counts, three ad shapes (cold / VSL / evergreen).
2. **`marketing/ads/VOICE.md`** — how Chris actually talks (before/after pairs).
3. **`marketing/ads/slo/fundhub-297/INDEX.md`** — which ad numbers are **already written**. Open **one** pack file for the id Chris named. **Do not regenerate** a locked script.
4. **`marketing/ads/CONTROLS.md`** — five live ads, **locked**. Match voice; never change their words. Where their wording breaks RULES.md Part 0, Part 0 wins for new ads.

**Optional — only if Chris named a lane, concept, or new angle:**

| File | When |
|---|---|
| `marketing/ads/registry.json` | Lane vocabulary (`funding600`, `sorting`, `uwiq`, …) |
| `marketing/ads/CONCEPTS.md` | Picking an angle from the sheet |
| `marketing/ads/ASSET-BANK.md` | Mechanism / proof numbers |
| `marketing/ads/slo/SLO-CHAT-PROMPT.md` | **$297 SLO product only** — self-contained chat prompt, not general cold ads |

Do **not** open `marketing/ads/README.md` old shoot workflow first — that path assumes concept generation from scratch.

---

## Ad identity (tracking)

- **`utm_content`** = leading **digits** = ad id. Optional `-slug` after (`43-ringlights` → ad **43**). Slug is for humans; reports use the number.
- Database: `fundhub_ad_id()` in `db/migrations/286_client_ad_attribution.sql` (same rule).
- **`src/ads/store.mjs`** stores raw UTMs only; `ad_id` is computed in Postgres — agents do not reimplement this in copy.
- **Titles are optional.** Never block work because a title is blank. Never invent a title — only Chris names ads.

---

## Before Chris sees any draft

```bash
npm run ads:check -- path/to/draft.md
```

Fix what it names. Run again until exit 0.  
The checker reads **`marketing/ads/rules-data.mjs` only** — not all of `RULES.md` prose. That is intentional (fast, cannot lie about having run).  
`npm run ads:check` runs the old lists. Part 0's patterns and Chris's banned phrases run in strict mode (`checkScriptText` with `strict: true`, RULES.md 4.1 item 10), which the app's writer uses.

Twelve compliance rules run **later** inside Creative Factory / `storeAsset` (needs live DB). Not part of this pass.

---

## Where output goes

- New batch: **`marketing/ads/scripts/YYYY-MM-DD.md`**
- Chris rewrites a line → add a real pair to **`marketing/ads/VOICE.md`** same session (Chris's words only on the "Chris wrote" side).

---

## Skill pointer (in repo)

`.cursor/skills/fundhub-ad-writer/SKILL.md` — load **fast path** section only when writing ads inside Cursor.

---

## One-line paste for Chris

> Read only `marketing/ads/RULES.md`, `marketing/ads/VOICE.md`, and `marketing/ads/slo/fundhub-297/INDEX.md` for the ad number I give you. Do not load CLAUDE.md or audit the CRM. Run `npm run ads:check` on the draft before you show me. Ad id = leading digits of utm_content; title optional.
