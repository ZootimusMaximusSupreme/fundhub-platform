# ad-attribution-flow — actual

How a Meta ad's five UTMs become the four lines a closer reads on the call screen.
Generated from the code on 2026-09-03, by hand, from the files named beside each
step. Every arrow names the event that fires it. Nothing here is drawn from a spec.

## In one picture

```mermaid
flowchart TD
    META[Meta ad URL<br/>utm_source=fb · utm_medium=paid<br/>utm_campaign=lane · utm_content=ad id · utm_term=variant]
    -->|person clicks the ad| PAGE[ClickFunnels application page]
    PAGE -->|page loads: fragment 06 reads the URL,<br/>keeps first touch in sessionStorage| HIDDEN[Hidden inputs on the form<br/>utm_source … utm_term, landing_path, referrer_domain]
    HIDDEN -->|person submits the form| CF[ClickFunnels posts contact.created<br/>hidden fields under contact.custom_attributes]
    CF -->|POST /api/webhooks/clickfunnels| SIG{Signature verifies?<br/>CLICKFUNNELS_WEBHOOK_SECRET}
    SIG -->|No| REJ[Refused. Nothing stored]
    SIG -->|Yes| NORM[normalizeClickFunnelsEvent<br/>pickVisitAttribution: explicit attribution → hidden fields → first_visit]
    NORM -->|emit entry.captured with payload.attribution| BUS[(events)]
    BUS -->|onEntryCaptured| JSON[clients.custom_fields ← raw UTMs<br/>the pre-existing jsonb copy]
    BUS -->|onEntryCaptured| ROW[(client_ad_attribution<br/>raw UTMs stored; lane · variant GENERATED, 286<br/>ad_id filled by trigger, 407)]
    CHK[$297 checkout<br/>POST /api/public/slo-checkout<br/>page's utm_* first touch] -->|upsertClientAdAttribution| ROW
    ROW -->|BEFORE INSERT/UPDATE trigger<br/>fundhub_caa_set_ad_id| ADNUM{utm_content has<br/>leading digits?}
    ADNUM -->|Yes: 84-slo-ad-1| NUM[ad_id = 84]
    ADNUM -->|No: oVid: SLO2| MATCH{fundhub_meta_ad_number<br/>ads row in ad set utm_term<br/>named exactly utm_content?}
    MATCH -->|exactly one Meta ad,<br/>one fundhub_ad_number| NUM
    MATCH -->|none · two Meta ads share the name ·<br/>ad has no number yet| NULLID[ad_id NULL — never a guess]
    SYNC[Daily Meta sync<br/>syncPartnerConnections] -->|after the ads are saved:<br/>reresolveAdNumbers → fundhub_reresolve_ad_numbers| NULLID
    NULLID -.->|filled once the ad and its number exist| NUM
    ROW -.->|row refused: logged, lead still created| JSON
    ROW -->|closer opens the call screen| READ[GET /api/read/ad-attribution?client_id=]
    READ -->|ad_id| REG{docs/ads/registry.json<br/>knows this ad_id?}
    REG -->|Yes| TAGS[gate · entry · primary · secondary · title]
    REG -->|No: logged once per id| DEF[Sorting default<br/>gate none · entry sorting · primary none · secondary all]
    TAGS --> VIEW[Closer screen: four lines under the name]
    DEF --> VIEW
    ROW -->|staff asks for the roll-up| BOOKS[GET /api/read/ad-books?group_by=lane · ad_id · variant · gate · entry · primary_offer · secondary_offer]
    BOOKS -->|joins bookings, cancelled excluded;<br/>joins paid non-demo payment_links of the same client| COUNTS[leads · booked calls · payments · paid cents<br/>first and last date, per group]
```

## The states, and the event that moves each one

| State | Where it lives | What fires the move to the next state |
|---|---|---|
| UTMs on the ad URL | the person's browser | Page load. `clickfunnels-fragments/06-utm-hidden-fields.html` reads `location.search`. |
| UTMs in sessionStorage | the person's browser | Form render. The fragment stamps hidden inputs on every form, first touch wins. |
| Hidden inputs filled | the ClickFunnels form | Form submit. ClickFunnels posts `contact.created` with the inputs under `custom_attributes`. |
| Webhook received | `api/webhooks/[provider].mjs` → `src/http/router.mjs` | Signature check passes. A bad signature ends the flow with nothing stored. |
| Normalized event | `src/adapters/clickfunnels.mjs` `pickVisitAttribution` | `entry.captured` is emitted with `payload.attribution`. Order of trust, per field: an explicit `attribution` object, then hidden fields, then CF's own `visits.first_visit`. |
| Raw UTMs in jsonb | `clients.custom_fields` via `mergeCustomFields` | Same handler, same call. Unchanged from before this work. |
| Typed row | `client_ad_attribution` via `src/ads/store.mjs` `upsertClientAdAttribution` | Written in `onEntryCaptured` right after the jsonb merge, and by the $297 checkout (`api/public/slo-checkout.mjs`) with the page's tags. The database derives `lane` (enum; `slo` for a campaign name with the word SLO, like `oPur: TOF-SLO: $297` — 406/407; `unknown` when unrecognised) and `variant` (lowercased, squeezed) as GENERATED columns. A second capture fills blanks only. A refused row is logged and the lead is still created. |
| Ad number | `client_ad_attribution.ad_id`, filled by trigger `client_ad_attribution_ad_id_trg` → `fundhub_caa_set_ad_id()` (`db/migrations/407_ad_number_from_meta.sql:206-234`) | Every insert and update. First the leading digits of `utm_content` (286 rule). Else `fundhub_meta_ad_number(org, utm_term, utm_content)` (407:153): our `ads` row in the Meta ad set `utm_term` whose name is exactly `utm_content`, answered only when exactly one Meta ad matches and it carries one `fundhub_ad_number`. Else, on an update that keeps the tags, the number the row already had. Otherwise NULL. The app never writes it. JS mirror: `src/ads/ad-number.mjs`. |
| Late ad number | the same column | The daily Meta sync, after it saves the ads: `reresolveAdNumbers()` (`src/ads/store.mjs:132`) → `fundhub_reresolve_ad_numbers(org)` (407:250), called at `api/campaigns/sync.mjs:921`. Fills only rows whose `ad_id` is NULL. A failure is reported in the sync's `ad_numbers` and never fails the sync. |
| Resolved tags | `src/ads/registry.mjs` `resolveAd` | The closer screen calls `GET /api/read/ad-attribution`. Known id → the registry entry. Unknown → sorting default, warned once per id. |
| Four lines on screen | `public/app/closer-dashboard.html` `#ccp-ad`, painted by `paintAd()` in `public/app/closer-call.js` | Fires after the cockpit paints. Hidden until the read answers; stays hidden if it cannot. |
| Roll-up | `GET /api/read/ad-books` via `adAttributionRollup` (`src/ads/store.mjs:79`) | On request. Groups by a database column or a registry tag. Cancelled bookings are not booked calls. Unknown ids are listed under `unknown_ad_ids`. The roll-up rows also carry `payments` (paid, non-demo `payment_links` rows of the same client), `paid_cents` (what the payment webhook reported; NULL when none reported), `payments_amount_unknown`, and first/last paid dates. Bookings and payments are counted per client before grouping, so they never multiply. |

## What the closer sees, in words

- **Gate** — `600+`, `720+`, `780+`, or `No FICO gate`.
- **Entry** — `Direct · sell what they were promised`, or `Sorting · every road is open`. When the ad is not in the registry the line says so in brackets.
- **Primary** — the offer the ad led with. On a sorting ad with a primary it adds `lead with it`.
- **Secondary** — `All` on a sorting ad, the listed offers on a direct ad, `None` when there are none.

## Gaps and things not drawn

- `UNVERIFIED` in production: which ClickFunnels payload key the live workspace uses for hidden inputs (`custom_attributes` vs `custom_fields`). The adapter reads both, in that order. The test proves `custom_attributes`.
- The registry was seeded from the owner's brief of 2026-09-03, not from `docs/ads/scripts/2026-09-02-ad-scripts.md`, which is not in the repository. Ids not named in the brief resolve to the sorting default until they are added.
- No intended journey exists for this flow. This file is the first record of it and it describes the code, not a spec.
- `UNVERIFIED` against a database: the 407 trigger, resolver and backfill, and the payments in the roll-up. `src/http/ad-number.pg.test.mjs` covers them and skips without `DATABASE_URL`; it has not run (2026-10-05). The JS mirror tests (`src/ads/ad-number.test.mjs`) run and pass.
- `GET /api/read/ad-books` folds the roll-up rows but does not yet add up `payments` or `paid_cents` into its groups or totals, so the screen does not show them. The store returns them; the endpoint is not changed here.
- A new Meta ad gets a visitor number only after someone gives that ad its `fundhub_ad_number` (the Campaign Manager link box, `api/campaigns/link-asset.mjs`). The four SLO ads that ran were numbered by 407 (84, 90, 89, 86). The three August book-a-call ads have no Fundhub number and stay NULL.
- `vsl_watch_sessions.ad_number` (379) is still the leading-digits rule only. It is not part of this flow.

## U14 One ad number on many Meta ads, the url_tags builder, and mapAdNumber

Traced from the code on 2026-10-05 (branch `mm-u14-ad-number-source`). Spec
`docs/specs/marketing-machine-2026-10-04.md` §10.3, §10.4 (migration), §10.5
(sync mapping, pure part only).

```mermaid
flowchart TD
    subgraph WRITE ["Where an ads row's number comes from — ads.fundhub_ad_number_source, 416"]
      P[A person types it<br/>POST /api/campaigns/link-asset] -->|number set| MAN[source = manual]
      P -->|number cleared: null or blank| NONE[number NULL, source NULL]
      OLD[Numbers already on ads before 416<br/>84 · 86 · 89 · 90 from 407] -->|416 backfill| MAN
      LOAD[Machine loads the ad into Meta<br/>spec §10.4 — NOT BUILT, U28] -.->|UNVERIFIED| LDR[source = loader]
      SYNC[Daily Meta sync reads creative url_tags + ad name<br/>spec §10.5 — wiring NOT BUILT, U27] -.->|UNVERIFIED: calls mapAdNumber| MAP{mapAdNumber<br/>src/ads/ad-number.mjs}
      MAP -->|leading digits of utm_content, adIdOf = fundhub_ad_id rule| UTM[source = utm]
      MAP -->|else 'Ad N' as a word in the ad name| NAME[source = name]
      MAP -->|else, or bad input: never throws| NULLMAP[null — nothing stored]
      MAN -.->|spec §10.5: the sync never overwrites manual| SYNC
    end
    subgraph TAGS ["What a loaded ad sends — src/marketing/url-tags.mjs"]
      B["buildUrlTags lane, adNumber, variant?"] -->|lane not one fundhub_ad_lane knows| REF[throws — no ad is built]
      B -->|ok| T["utm_source=fb · utm_medium=paid · utm_campaign=lane · utm_content=N<br/>utm_term=variant only with a variant"]
      T -->|goes in the creative's url_tags, never in the link — U28| CLICK[person taps the ad]
      CLICK --> ROW[(client_ad_attribution<br/>ad_id = N by the 407 trigger<br/>lane by fundhub_ad_lane)]
    end
```

| State | Where it lives | What moves it |
|---|---|---|
| One number, many ads rows | `ads.fundhub_ad_number`, plain index `ads_fundhub_number_idx` (`db/migrations/416_ads_number_index_and_source.sql`). The unique index `ads_fundhub_number_uq` (377:575) is gone. | Any writer may now put the same number on a second ad (another ad set, or a v2). The number's shape CHECK (377:569) is unchanged. |
| `manual` | `ads.fundhub_ad_number_source` | `api/campaigns/link-asset.mjs` sets it with every typed number and clears it with the number. 416 marks every number already stored as `manual`. Its old `409 ad_number_taken` answer is removed; it could only come from the dropped index. |
| `loader` | same column | Only the CHECK exists. Nothing writes it yet (U28). `UNVERIFIED`. |
| `utm` / `name` | same column | `mapAdNumber({urlTags, name})` returns `{number, source}` or null. Nothing calls it yet (U27 wires it into `api/campaigns/sync.mjs`). `UNVERIFIED` end to end. |
| UTMs on a loaded ad | the Meta creative's `url_tags` | `buildUrlTags` builds them. Nothing calls it yet (U28). The database reads them back with `fundhub_ad_id`, `fundhub_ad_lane` and `fundhub_ad_variant`, proved in `src/http/ad-number-source.pg.test.mjs`. |

Gaps (findings, not reconciled):

- **Counting per number (for M5, spec §11).** One number may now sit on several `ads` rows. A report per number must count leads per number (`client_ad_attribution.ad_id`), never per `ads` row, or one lead counts once per row. `api/read/ad-spine.mjs` already uses `count(DISTINCT a.client_id)` per label group; its comment at about line 209 still names `ads_fundhub_number_uq`.
- **Roadmap lane: `uwiq` or `slo`.** New roadmap ads take `utm_campaign` from the funnel's lane, which the spec's seed calls `uwiq`, while live roadmap leads read `slo` (406/407). `buildUrlTags` accepts both. Chris's yes/no is open on the board.
- **"SLO Ad 7" names.** `marketing/ads/NAMING.md` numbers takes per offer ("SLO Ad 7"), and 407 says SLO Ad 7 is Fundhub ad 90. The spec's name rule (`Ad (\d{1,9})`) reads a Meta ad named "SLO Ad 7 — …" as 7, not 90. No live Meta ad is named that way today (the live names are "oVid: SLO1"–"oVid: SLO4", which map to null). U27 or Chris should decide before the sync stores `name` numbers.
- The name rule is case-sensitive ("Ad", as the spec writes it), needs "Ad" to start a word, and refuses a run of more than nine digits rather than cutting it short.
