# Funnel tracking spec — our database (Phase 3, 2026-10-02)

Owner ask (2026-10-02): track everything on every funnel page to our own database, through the existing funnel event door `POST https://fundhub.ai/api/public/slo-interest`. Page list: `docs/tracking/page-inventory.md`. Meta events are a separate file: `docs/tracking/meta-events.md`.

This file is the contract. The server, the shared browser tracker, and every page hook follow it word for word.

## Never recorded

Card numbers, Social Security number, date of birth, and any soft-pull field value. For a form field we record only its **name** and that it was focused or completed. Survey answers are not copied into tracking events (the survey webhook already stores them on the client record). No typed text of any kind.

## One door, one new kind

```
POST /api/public/slo-interest
{ "kind": "track", "event": "<event>", "seq": <int>, "session_id": "<fh_sid>",
  "page": "/roadmap", "props": { ... },
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "landing_path", "referrer_domain", "webdriver": false }
```

- `session_id` is the existing `sessionStorage.fh_sid` (shared with fh-attribution.js).
- `seq` is a per-session counter kept in `sessionStorage.fh_seq`. Idempotency key is `funnel-track:<session_id>:<seq>`, so a retried send is saved once but a second real click is saved again.
- **The server works out `funnel` and `step` from `page`** using one map (`src/funnel/pages.mjs`). The browser cannot invent them. A page not on the map is refused (`page_invalid`).
- Every stored row's payload carries: `page`, `funnel`, `step`, `session_id`, `seq`, `event`, the event's `props`, `attribution` (UTMs via `pickAttribution`), `landing_path`, `actor`, `actor_reason`.
- Stored as an `events` row named `funnel.<event>` (e.g. `funnel.scroll`). Two names keep their old meaning so today's counts keep working: `page_view` is stored as `funnel.page` (once per session per page, old key `funnel-page:<sid>:<page>`), `click` is stored as `funnel.click`.
- Old kinds `visit`, `contact`, `engage`, `page`, `click` keep working unchanged.
- Cap: 500 track rows per session per day. Over the cap the door answers ok and saves nothing.
- Props are an allow-list per event (below). Unknown keys are dropped. Strings are clipped. Numbers are clamped. A prop key that names a sensitive field value is never accepted.

## Pages → funnel and step

| Page | Funnel | Step |
|---|---|---|
| /watch | watch | 1 |
| /apply | watch | 2 |
| /funding-book-call | watch | 3 |
| /thank-you | watch | 4 |
| /roadmap | roadmap | 1 |
| /roadmap-book | roadmap | 2 |
| /roadmap-thank-you | roadmap | 3 |
| /order | watch | 5 |
| /home | homepage | 1 |

Rows are added from `docs/tracking/page-inventory.md` (Phase 2). Same map in the server and the browser.

`/home` is the fundhub.ai homepage survey page. The browser sends `page: "/home"` when the host is `fundhub.ai` (or `www.fundhub.ai`) and the path is `/`, because `apply.fundhub.ai/` is a different page (an unused ClickFunnels template).

**Funnels the dashboard builds (2026-10-06, build unit X4).** Their pages are not in the table above; they come and go from the Command Center. Each one carries `<meta name="fh-funnel-tag" content="fnl-…">` and `window.FH_FUNNEL = {id, tag, key, offer, lane, page:{role, path, step}}` first in its `<head>`. The shared tracker sends from such a page only when `FH_FUNNEL.page.path` is the page's own path, and adds `funnel_tag` to every post. The server looks the tag and the page up in `marketing_funnel_pages` (migration 425): found, the row's funnel is the tag, its step is the page's position (1 landing, 2 booking, 3 thank-you), and `funnel_tag` and `funnel_id` are saved on the row; not found, `page_invalid` as for any unknown page. Leads and bookings carry the funnel through `landing_path` (the first page the visitor landed on, stamped on every form by `fh-attribution.js`), and that address belongs to one funnel only.

## Events

| Event | When | Props (allow-list) | Who sends it |
|---|---|---|---|
| `page_view` | Page opens, once per session per page | `title` | shared tracker |
| `time_on_page` | Every 15s while visible (one row per 15s mark: 15, 30, 45, 60, 90, 120, 180, 300, 600) | `seconds` | shared tracker |
| `exit` | Tab hidden for good / page closed, once per page load | `seconds`, `max_scroll` | shared tracker |
| `click` | Every button or link press | `element_id`, `label`, `href_path`, `y_px`, `y_pct`, `section`, `nth` | shared tracker |
| `video` | play, pause, unmute, mute, and 25/50/75/100% watched (each % once per video per page load) | `video`, `action` (play/pause/unmute/mute/progress), `pct`, `current_s`, `duration_s` | shared tracker |
| `scroll` | 25/50/75/100% of page depth, each once per page load | `depth` | shared tracker |
| `section_view` | Each section with an `id` (or `data-fh-section`) reaching the screen, once per page load | `section` | shared tracker |
| `carousel` | Testimonial carousel next, previous, play | `carousel`, `action` (next/prev/play), `index` | shared tracker (by `data-fh-carousel` / known classes) or page hook |
| `faq_open` | Each FAQ question opened (`<details>` toggle or FAQ button) | `question` (label slug) | shared tracker |
| `survey_answer` | Each survey question answered | `survey`, `step_num`, `question_id`, `last` (true once, on the survey's final submit) | survey page hook |
| `survey_route` | Sorting hat routes someone | `survey`, `offer` (offer code) | thank-you / survey hook |
| `buybox_tab` | Each buy box step shown (buy box v2 has no tabs: the "Step n of 3" line; same event, so before and after compare) | `tab` (1/2/3), `bbv` | /roadmap buy box hook |
| `field_focus` | A buy box / survey / booking field gets focus, once per field per page load | `form`, `field` (name only), `bbv` (buy box only) | page hook |
| `field_complete` | That field left with a value that passes its check, once per field | `form`, `field`, `bbv` (buy box only) | page hook |
| `continue` | Buy box step 1 button pressed ("Get My Funding Roadmap" on buy box v2, "Continue" before) | `step`, `bbv` | buy box hook |
| `validation_error` | A field or step check fails | `form`, `field`, `code` (short slug, never the value), `bbv` (buy box only) | page hook |
| `payment_attempt` | Pay pressed and card form submitted | `amount_cents`, `bbv` | buy box hook |
| `payment_result` | checkout:success or a decline / error | `result` (success/fail), `code`, `bbv`, `order_ref` (the order: up to 64 letters, digits, _ or -; Meta's Purchase id is built from it, see meta-events.md) | buy box hook |
| `softpull_submit` | Start My Soft Pull pressed and accepted by the form check | `businesses` (count), `bbv` | buy box hook |
| `calendar_view` | A booking calendar is on screen | `calendar` | booking hook |
| `time_selected` | A time slot picked | `calendar` | booking hook |
| `booking_confirmed` | Book / Confirm pressed and the booking saved | `calendar` | booking hook |
| `preview_opened` | A "See a sample" preview opened under a /roadmap order summary line | `deliverable`, `bbv` | /roadmap buy box hook |
| `preview_closed` | That preview closed (close press, or tab hidden / page closed while open) | `deliverable`, `open_ms`, `bbv` | /roadmap buy box hook |

## Sample previews (/roadmap, 2026-10-01)

`deliverable` is one of exactly: `how_much_you_qualify_for`, `credit_analysis_report`, `credit_optimization_roadmap`, `dispute_letter_pack`, `bank_lender_match_list`, `business_duplication_map`. Any other value (or none) is refused with `deliverable_invalid` (HTTP 400) and nothing is saved. `open_ms` is whole milliseconds the preview stayed open, clamped 0..600000 (missing = 0).

Each open also fires Meta custom event `PreviewOpened` with `content_name` = the deliverable (`fbq('trackCustom','PreviewOpened',{content_name:d})`, the same pixel and call style the thank-you pages use).

Same `session_id` (`fh_sid`) as the `continue` event, so a visitor's opens and their step-1 press join. View `v_roadmap_preview_continue_daily` (opened vs not-opened Continue rate per day) and `v_roadmap_preview_open_ms_daily` (average `open_ms` per deliverable per day): `db/migrations/405_roadmap_preview_views.sql`. Days are UTC. Only `actor = 'person'` sessions count.

## Buy box versions (/roadmap, 2026-10-02)

Buy box v2 (owner-set 2026-10-02): step 1 asks first name, last name and email only, with the refund line above the button "Get My Funding Roadmap"; the phone moved to step 3 (still required); a "Step 1 of 3" line replaced the three tabs. Event names did not change, so before and after compare on the same names.

- **`bbv` prop.** Every buy box event the /roadmap page sends (`buybox_tab`, `field_focus`, `field_complete`, `continue`, `validation_error`, `payment_attempt`, `payment_result`, `softpull_submit`, `preview_opened`, `preview_closed`) carries `bbv: 2`. Rows from the old buy box have no `bbv`. Whole number 1..99; the survey pages never send it.
- **Phone on step 3.** `field_focus` / `field_complete` / `validation_error` for the phone now say `form: "s3", field: "phone"` (was `s1`). The contact save (`slo.contact_started`, kind `contact`) still starts on a valid step-1 email; a phone typed on step 3 is merged into the same row and the same ClickFunnels contact (`public/funnel/fh-attribution.js`). No other step-3 box is read for it.
- **One marker row with the deploy time.** `funnel.buybox_version`, payload `{ version: 2, page: "/roadmap", deployed_at: <ISO time> }`, idempotency key `buybox-version:2` (a second run saves nothing). Written once, right after the deploy, by `node scripts/tracking/mark-buybox-version.mjs` through the normal `emit()`. Not a browser event: it is not in the Events table and the door refuses it.

## Browser API

The shared tracker (`public/funnel/fh-events.js`) defines:

```js
window.fhTrack(event, props)   // sends one track event; never throws
```

Page hooks call it safely before or after the tracker has loaded:

```js
(window.fhTrack || function (e, p) { (window.fhq = window.fhq || []).push([e, p]); })("continue", { step: 1 });
```

The tracker drains `window.fhq` when it loads. Inside an iframe the shared tracker stays silent (the parent page counts the step); a framed booking calendar reports through the parent page.

### Framed calendar → parent page

/apply and /roadmap-book show https://apply.fundhub.ai/funding-book-call inside a frame. Code inside the frame never sends to the server itself. It does this:

```js
var msg = { fh: "track", event: "time_selected", props: { calendar: "funding-book-call" } };
if (window.self !== window.top) window.parent.postMessage(msg, "https://apply.fundhub.ai");
else (window.fhTrack || function (e, p) { (window.fhq = window.fhq || []).push([e, p]); })(msg.event, msg.props);
```

The shared tracker on the parent page listens for `message` events from origin `https://apply.fundhub.ai` with `data.fh === "track"`, accepts only `calendar_view`, `time_selected`, `booking_confirmed`, and calls `fhTrack` with them. Opened directly (not framed), the same page sends its own events.

### Booking confirmed — the one signal

`booking_confirmed` (and Meta Schedule later) fire only when ClickFunnels has **accepted** the booking — never on the Book press alone (a Book press with a bad phone is refused by ClickFunnels). The /funding-book-call footer block stamps `fh_booking_v1.submittedAt` at that same moment, so the existing listeners on /apply and /roadmap-book keep working.

## Clarity

`public/js/clarity.js` (project `tscu15s674`) loads on every page in the inventory. The shared tracker also sends `click` labels to Clarity as custom events, as today.

## Coverage — live 2026-10-02

Every page also gets page_view, time_on_page, exit, click (id, label, position), scroll 25/50/75/100 and section_view from the shared tracker. Meta column: B = browser pixel only (no server copy yet — Phase 4 stopped, see `docs/tracking/meta-events.md`).

| Page | Extra database events | Clarity | Meta today | Missing |
|---|---|---|---|---|
| /watch | video (VSL), carousel/FAQ if present | yes | PageView B | ViewContent, server copies |
| /apply | survey_answer (9 screens), field_focus/complete, validation_error; calendar_view / time_selected / booking_confirmed relayed from the framed calendar | yes | PageView B, Lead B, Schedule B | server copies, SurveyStep custom |
| /funding-book-call | calendar_view, time_selected, booking_confirmed (framed → parent; direct → itself) | yes | PageView B | Schedule when opened directly |
| /thank-you | survey_route | yes | PageView B, AddToCalendar B, OpenInboxConfirm B | SurveyRouted custom, Purchase per offer |
| /order | — | yes (added 2026-10-02) | PageView B | the native ClickFunnels checkout has no hooks of ours |
| /roadmap | buybox_tab, field_focus/complete, continue, validation_error, payment_attempt, payment_result, softpull_submit, video, carousel, faq_open | yes | PageView B, InitiateCheckout B, PreviewOpened B | Lead, Purchase, ReachedBuyBox, SoftPullSubmitted, server copies |
| /roadmap-book | calendar events relayed from the framed calendar, video | yes | PageView B | Schedule |
| /roadmap-thank-you | — | yes | PageView B, AddToCalendar B, OpenInboxConfirm B | — |
| fundhub.ai homepage survey (`/home`) | survey_answer (10 screens), field_focus/complete, validation_error | yes | none (no pixel on fundhub.ai) | pixel + all Meta events |
| apply.fundhub.ai/schedule/phonecall | none — ClickFunnels gives no way to add code | ClickFunnels' own | none | cannot be tracked by us |

## Phone checklist — run on your phone

Open Meta Test Events first: https://business.facebook.com/events_manager2/list/pixel/2403674420141513/test_events — type `https://apply.fundhub.ai/roadmap` into "Test browser events", open the link it gives you on your phone. Our database events show up within a minute (an agent can read them back for you by session).

Use an email ending `@fundhub.ai` so the system marks you as us, not a buyer.

### /roadmap
| # | Tap | You should see | Meta Test Events | Our database / ClickFunnels |
|---|---|---|---|---|
| 1 | Open https://apply.fundhub.ai/roadmap/ (with the slash) | The address bar drops the slash | PageView | funnel.page, then scroll / section_view as you scroll |
| 2 | Look at the top of the buy box (buy box v2) | "Step 1 of 3", no tabs; "If you're not happy with what you get, email us within 7 days and we'll refund you." right above the button | — | funnel.buybox_tab tab 1, bbv 2 |
| 3 | Type first name, last name, a valid email; tap out of the email box | Nothing visible | — | slo.contact_started with your email, no phone; ClickFunnels contact appears (agent emails are kept out of ClickFunnels — use a real non-@fundhub.ai email you own if you want to see it there) |
| 4 | Look for a phone box on step 1 | Not there (it is on step 3, after paying; typed there, it merges into the same row and the same ClickFunnels contact) | — | — |
| 5 | Tap Get My Funding Roadmap | Card boxes load; "Step 2 of 3" | — | funnel.continue, funnel.buybox_tab tab 2 (both bbv 2) |
| 6 | Look for "$15" anywhere | Not there | — | — |
| 7 | **Stop. Do not tap Get My Roadmap** (it charges $297) | — | — | — |

### /apply → booking
| # | Tap | You should see | Meta Test Events | Our database / CRM |
|---|---|---|---|---|
| 1 | Open https://apply.fundhub.ai/watch, tap Get Started | /apply | PageView ×2 | funnel.page /watch then /apply |
| 2 | Fill contact, answer every screen | "You're qualified. Pick a time below." | Lead | survey_answer steps 1–9 |
| 3 | Pick a time | Contact form inside the calendar | — | time_selected |
| 4 | Book with a **bad phone** (e.g. 123) | ClickFunnels refuses | **No** Schedule | no booking_confirmed |
| 5 | Book with a real phone | Booking confirmed | Schedule | booking_confirmed; a real appointment in ClickFunnels + CRM booking (cancel it after) |

### Facebook / Instagram in-app (no charge)
Send `https://apply.fundhub.ai/roadmap` to yourself in an Instagram DM (or post it to Facebook as Only me), tap it, fill step 1, tap Get My Funding Roadmap. Pass: card boxes show within ~10 seconds and the card number box brings up a number keyboard. Switch to Messages for a minute and come back — note whether the page reloaded to an empty step 1 (the reload fix is coming with the page agent's batch). Do not tap Get My Roadmap.
