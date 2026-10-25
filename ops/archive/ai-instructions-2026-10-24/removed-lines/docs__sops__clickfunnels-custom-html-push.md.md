# Removed from `docs/sops/clickfunnels-custom-html-push.md` on 2026-10-24

Reason: D220, D221, D222, D223, D224, and S43. The owner law is chris-never-clickfunnels (2026-09-21). Page ids, commands, fragment file names, and the Meta pixel ground-truth path stayed in the SOP.

## D220, line 8

Manual paste is fallback only if API auth is truly missing.

Older fallback wording. chris-never-clickfunnels says report the env name and stop. The first sentence ("Agents push FundHub HTML and tracking with `scripts/cf-push-custom-html.mjs`.") stayed, including the old FundHub spelling in that kept sentence.

## S43, `/apply` push-mode cell

Inject tracking — keep native survey

`/apply` is custom HTML (apply survey), page 25515671, manifest key `apply-survey`. The 2026-09-20 headline column stayed.

## D221, tracking bullets

- `https://fundhub.ai/funnel/fh-attribution.js` — UTM catcher (Creative Factory)
- `https://fundhub.ai/funnel/vsl-watch-beacon.js` — **watch only**
- Meta pixel base + PageView (custom HTML head, or already on apply via CF site code — verify view-source)

Meaning now: chris-never-clickfunnels, "When the work touches marketing/landing-pages". The fragment lines `06-utm-hidden-fields.html` and `07-vsl-watch-beacon.html` stayed.

## D222, calendar sentence

Full custom HTML **replaces the step**. Native booking calendar **does not** survive. Never full-replace `/funding-book-call`.

Meaning now: the same rule. The framed-calendar and fit commands stayed.

## D223, skill bullets

- Cursor: `.cursor/skills/fundhub-clickfunnels-html-push/SKILL.md`
- Cursor rule: `.cursor/rules/clickfunnels-html-api-push.mdc`
- Claude Code: `.claude/skills/fundhub-clickfunnels-html-push/SKILL.md`

`clickfunnels-html-api-push` was merged into chris-never-clickfunnels. The skill's one home is `.agents/skills/fundhub-clickfunnels-html-push/SKILL.md`.

## D224, prove line

View-source each live URL for `fbq('init'` and `fh-attribution.js`. Click calendar on book page (look only). No pay, no SSN.

The look-for strings `fbq('init'` and `fh-attribution.js` stayed on the new law line.
