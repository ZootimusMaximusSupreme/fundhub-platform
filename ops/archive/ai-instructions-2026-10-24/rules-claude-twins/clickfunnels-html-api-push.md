# ClickFunnels HTML — API push law

When work touches `marketing/landing-pages/**` or live `apply.fundhub.ai` funnel HTML:

1. **Push via ClickFunnels 2.0 Custom HTML Pages API** (GA 2026-09-18). Load skill `.cursor/skills/fundhub-clickfunnels-html-push/SKILL.md`.
2. **Never** tell Chris to paste fragments into the builder as the default finish line.
3. Read auth from `.env` / Netlify / `analytics_connections` — env names only in chat. Missing **`CLICKFUNNELS_API_KEY`** → report and stop; do not ask him to paste the value.
4. **Include tracking** on every pushed page: `fh-attribution.js`; `vsl-watch-beacon.js` on watch only; Meta pixel (env or repo ground truth); no duplicate `06-utm-hidden-fields.html` if attribution script already loads.
5. **`/funding-book-call`**: native calendar is sacred — **inject only** (`footer_code` / `head_code` append). No full-page custom HTML replace on that step.
6. **$297 slo** pages belong on the **297 funnel**, not swapped onto the live apply calendar step unless explicitly the same funnel migration.
7. Prove live view-source after push. No pay, no SSN, no live CRS.

Script: `scripts/cf-push-custom-html.mjs`
