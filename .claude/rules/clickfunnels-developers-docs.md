# ClickFunnels developers docs — read first

**Owner law:** For ANY ClickFunnels question — API, workspace, page, funnel, Custom HTML, webhook, or SDK — **fetch or read https://developers.myclickfunnels.com/ FIRST** before answering or changing code.

Extra (not a substitute): https://changelog.myclickfunnels.com/

Also applies when working under `marketing/landing-pages/**`, `marketing/landing-pages/clickfunnels/**`, `src/adapters/clickfunnels*`, or `api/**/clickfunnels*`.

## Never

- Invent ClickFunnels endpoints, paths, or request shapes from memory
- Tell Chris to paste HTML into the funnel builder as the **default** deploy path — **Custom HTML Pages API** is GA (2026-09-18); use the API/docs unless he explicitly chose manual builder paste

## Always

- Ground answers in the live developers site (WebFetch or browser)
- Cite the doc section or endpoint name when proposing API work
- Prefer repo adapters (`src/adapters/clickfunnels.mjs`) only **after** docs confirm the contract

## Example

```text
Ask: "How do we push a Custom HTML page?"

❌ Guess POST /pages or "paste this block in ClickFunnels."
✅ Read https://developers.myclickfunnels.com/ (Custom HTML Pages), then wire to the documented API.
```
