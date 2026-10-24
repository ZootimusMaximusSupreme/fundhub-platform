---
description: Chris never logs into ClickFunnels admin — agents use API/MCP only
alwaysApply: true
---

# Chris never clicks ClickFunnels

**Owner law (2026-09-21):** Daddy doesn't click ClickFunnels.

## Law

Chris never logs into ClickFunnels admin, the builder, or Developer Portal for routine funnel work.

Agents do all ClickFunnels work via the **Custom HTML Pages API**, repo fragments (`marketing/landing-pages/**`), and `scripts/cf-push-custom-html.mjs`, using gitignored **`CLICKFUNNELS_API_KEY`** (and subdomain / workspace env). Read `.env` — do not ask him to paste the key.

## Never

- Ask Chris to open ClickFunnels, paste HTML into the builder, or click Developer Portal as the default deploy path
- Tell him to map survey attributes or webhooks by hand when the API or an agent run can do it
- Print API keys, webhook secrets, or `.env` values in chat or commits

## Always

- Docs first: https://developers.myclickfunnels.com/
- Skill: `.cursor/skills/fundhub-clickfunnels-html-push/SKILL.md`
- Prove live customer URLs on `apply.fundhub.ai` (view-source / browser), not admin screens
- If auth is missing after checking `.env`, Netlify, and `analytics_connections`, report the **env name** and stop

## Example

```text
Ask: "Put the $297 sales page on /roadmap."

❌ "Log into ClickFunnels and paste this HTML."
✅ Push via API from `marketing/landing-pages/slo/…`, prove https://apply.fundhub.ai/roadmap/
```
