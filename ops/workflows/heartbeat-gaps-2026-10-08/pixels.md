# Pixel and attribution gaps

Lane 6. Tracking pixels and attribution only. Report only. Recon (AG-07) is the one tripwire. This lane does not start another watchdog, and it does not auto-fix.

Company: Fundhub.

## Env names

Values stay in gitignored `.env` and on Netlify. This board names the keys only.

| Key | What it is |
|---|---|
| `META_PIXEL_ID` | Meta pixel id. Digits only. The server sender uses the same name. |
| `META_PIXEL_FALLBACK_ID` | Not an env key. It is the fallback constant in `marketing/landing-pages/tracking-manifest.mjs` when `META_PIXEL_ID` is unset or not all digits. |
| `CLARITY_PROJECT_ID` | Clarity project id. The page tag is the script `https://fundhub.ai/js/clarity.js`. The id inside that file is separate from this env key. |

Do not call the Clarity data export. That quota is Microsoft's, and this lane does not spend it.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-pixels.mjs` returns five rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| Id | What FAIL means |
|---|---|
| `pixel-on-funnel-page` | One GET of the page the manifest marks `funnel_head_pixel` (`https://apply.fundhub.ai/watch`). The HTML does not contain the pixel id from `META_PIXEL_ID` or the fallback. |
| `clarity-snippet` | That same HTML is missing our Clarity script tag. Skip when the manifest does not ask for the script on that page. |
| `utm-capture-route` | `GET /api/public/slo-interest` is dead (404 or 410). That is the door `fh-attribution.js` posts UTMs to. The check does not POST. |
| `vsl-watch-route` | `GET /api/public/vsl-watch` is dead (404 or 410). A 405 means the route is there. The check does not POST, so it does not file a viewing. |
| `ad-click-stored` | Funnel page views were saved in 7 days and no `funnel.click` row was saved. Skip when there is no database, or when there were no page views. The read is a SELECT. No fake click. No fake purchase. |

One page GET per run. Two route GETs. No POST. No Clarity export. No purchase event.

A FAIL says to use the existing Recon tripwire (AG-07). It does not ask for a new watchdog.

## Prove

`node --test src/pulse/coverage/gap-pixels.test.mjs`

Result: 13 passed, 0 failed. The test uses a fake fetch. It does not open the live site.
