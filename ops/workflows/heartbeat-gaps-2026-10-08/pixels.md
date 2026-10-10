# Pixel and attribution gaps

Lane 6. Tracking pixels and attribution only. Report only. Recon (AG-07) is the one tripwire. This lane does not start another watchdog, and it does not auto-fix.

Company: Fundhub.

## Env names

Values stay in gitignored `.env` and on Netlify. This board names the keys only.

| Key | What it is |
|---|---|
| `META_PIXEL_ID` | Meta pixel id. Digits only. The server sender uses the same name. |
| `META_PIXEL_FALLBACK_ID` | Not an env key. It is the fallback constant in `marketing/landing-pages/tracking-manifest.mjs` when `META_PIXEL_ID` is unset or not all digits. |
| `CLARITY_PROJECT_ID` | Clarity project id. The page tag is the script `https://fundhub.ai/js/clarity.js`. The id the browser uses is inside that file, so the check reads that file. |

Do not call the Clarity data export. That quota is Microsoft's, and this lane does not spend it.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-pixels.mjs` returns eight rows. Shape: `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`. With no fetch, the six page and route rows are `skip`. With no database, the two click rows are `skip`.

| Id | What FAIL means |
|---|---|
| `pixel-on-funnel-page` | The page the manifest marks `funnel_head_pixel` (`https://apply.fundhub.ai/watch`) does not start the pixel with our id: `fbq('init', '<id>')`. A bare mention of the id does not count. The funnel head covers `/watch`, `/funding-book-call`, `/thank-you`, `/order`. |
| `pixel-on-own-pages` | One of the custom pages the manifest writes whole (`/apply`, `/roadmap`, `/roadmap-book`, `/roadmap-thank-you`) does not start the pixel. Each carries its own copy; the funnel head does not cover them. |
| `clarity-snippet` | The `/watch` HTML is missing our Clarity script tag, **or** `clarity.js` answers badly, **or** its project id is blank (a blank id records nothing). Skip when the manifest does not ask for the script. |
| `tracking-scripts-live` | `fh-attribution.js`, `fh-events.js`, or `vsl-watch-beacon.js` does not serve (or no longer says what it must), or `/watch` stops loading them. |
| `utm-capture-route` | `GET /api/public/slo-interest` is dead (404, 410, 5xx). That is the door the scripts post to. |
| `vsl-watch-route` | `GET /api/public/vsl-watch` is dead. A 405 means the route is there. |
| `ad-click-stored` | Meta counted 20 or more link clicks in the last 3 closed Arizona days, and we stored fewer than 10 percent as many visits that carry a Meta UTM or an `fbclid`. Fewer than 20 Meta clicks is a skip (ads paused). Needs the staff scope for `ad_metrics_daily`. |
| `funnel-click-stored` | 25 or more funnel page views in 7 days and not one `funnel.click` stored. Fewer page views is a skip. This watches the button-click beacon (`fh-events.js`). |

GET only. No POST. No Clarity export. No purchase event. No fake click.

A FAIL says to use the existing Recon tripwire (AG-07). It does not ask for a new watchdog.

## Prove

`node --test src/pulse/coverage/gap-pixels.test.mjs`

Result: 34 pass, 0 fail, 0 skipped. The test uses a fake fetch and a fake scope that answers by the exact SQL text. It does not open the live site.

## Review — Claude, 2026-10-08

**What was wrong**

- `ad-click-stored` was not about ad clicks. It counted `funnel.click` rows. Those are button presses by anyone, mostly bots. It said "653 ad clicks stored" while all 7 ads were paused. It could also cry wolf: one page view and no click was a FAIL.
- `pixel-on-funnel-page` only read `/watch`. The money page `/roadmap` and `/apply` carry their own pixel copy and were not watched.
- The pixel test accepted the id anywhere in the page. A comment would have passed it.
- The Clarity check passed on the tag alone. `clarity.js` records nothing when its project id is blank.
- The UTM and video routes could be up while the script files that capture UTMs and video seconds were gone.
- It did the page reads one after another, and it read `ctx.appBase` but the pulse passes `baseUrl`.

**What changed**

- `ad-click-stored` now compares Meta's link clicks to the visits we stored from a Meta ad. The old logic stays as `funnel-click-stored`, with a floor of 25 page views.
- New `pixel-on-own-pages` (4 custom pages) and new `tracking-scripts-live`.
- The pixel must be started with our id. Clarity also reads `clarity.js` for a project id (the id is never printed).
- Reads run at the same time with a 10 second timeout. `baseUrl` is honored. The staff scope is used when the pulse passes one.

**Live proof (read-only)**

- Prod mode: 7 PASS, 0 FAIL, 1 skip. The skip is `ad-click-stored`: Meta counted 0 link clicks from 2026-10-05 to 2026-10-07 (ads paused). Staff mode and bare mode match. No SQL errors. No writes. 11 GETs, no other method.
- The ad-click SQL was run on a real window: 2026-10-01 to 2026-10-03 shows Meta 67 link clicks and 93 stored ad visits. A wrong company id gives 0 and 0, so the company filter works.
- Real pages with damage on purpose (pixel removed from `/roadmap`, `clarity.js` id blanked, the events script swapped for HTML, the video beacon dropped from `/watch`) turned three rows into FAIL (own pages, Clarity, tracking scripts). The real markup does fail the check.

**Not a check problem**

- On the laptop `.env` `META_PIXEL_ID` is not set, so the check used the fallback id, which is the one on the live pages. If Netlify's `META_PIXEL_ID` is set to a different id than the pages, `pixel-on-funnel-page` will FAIL. That would be a real mismatch.
