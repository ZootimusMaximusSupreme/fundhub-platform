---
description: Chris never logs into ClickFunnels admin: agents push funnel HTML by API (Custom HTML Pages) and prove it live
alwaysApply: true
---

# Chris never clicks ClickFunnels

**Owner law (2026-09-21):** Daddy doesn't click ClickFunnels.

## Law

Chris never logs into ClickFunnels admin, the builder, or Developer Portal for routine funnel work.

Agents do all ClickFunnels work via the **Custom HTML Pages API**, repo fragments (`marketing/landing-pages/**`), and `scripts/cf-push-custom-html.mjs`, using gitignored **`CLICKFUNNELS_API_KEY`** (and subdomain / workspace env). Read `.env` — do not ask him to paste the key. Read auth from gitignored `.env`, then Netlify production env, then the `analytics_connections` row (`platform = clickfunnels`). In chat, name only the env name.

## Never

- Ask Chris to open ClickFunnels, paste HTML into the builder, or click Developer Portal as the default deploy path. Exception: Chris explicitly chose manual builder paste for that one page.
- Tell him to map survey attributes or webhooks by hand when the API or an agent run can do it
- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never print key values in chat or commits unless Chris asks for the value (show-secrets-when-chris-asks).

## Always

- Docs first: https://developers.myclickfunnels.com/
- Skill: `.cursor/skills/fundhub-clickfunnels-html-push/SKILL.md`
- Prove live customer URLs on `apply.fundhub.ai` (view-source / browser), not admin screens. Look at `apply.fundhub.ai/watch`, `/apply`, `/funding-book-call` and `/thank-you`. No pay, no SSN, no live CRS.
- If auth is missing after checking `.env`, Netlify, and `analytics_connections`, report the **env name** and stop

## When the work touches `marketing/landing-pages/**` or live `apply.fundhub.ai` funnel HTML

- Tracking goes on every pushed page: `fh-attribution.js` on every funnel step; `vsl-watch-beacon.js` on the watch page only; the Meta pixel (env, or repo ground truth); and no duplicate `06-utm-hidden-fields.html` when `fh-attribution.js` already loads. Invent no CAPI call unless env provides it. Add no field-capture tracker on pull or SSN pages.
- `/funding-book-call`: the native calendar is sacred. Inject only (`footer_code` / `head_code` append). A full custom-HTML page replaces the whole funnel step, and the native survey, checkout and booking calendar do not carry over. Never full-replace that step, and never swap in `slo-02-booking.html`.
- $297 `slo` pages belong on the $297 funnel, not on the live apply calendar step, unless the exact task is that funnel migration.
- Per-step page types, page ids and the commands live in `docs/sops/clickfunnels-custom-html-push.md`.

## Example

```text
Ask: "Put the $297 sales page on /roadmap."

❌ "Log into ClickFunnels and paste this HTML."
✅ Push via API from `marketing/landing-pages/slo/…`, prove https://apply.fundhub.ai/roadmap/
```
