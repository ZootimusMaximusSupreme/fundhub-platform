# /watch and /thank-you — the Sorting Hat pages (actual)

Generated from code on 2026-09-22 (branch `feat/watch-proof`; /watch section and
/thank-you proof row regenerated on branch `feat/watch-organize`). Both pages are
ClickFunnels builder pages on apply.fundhub.ai. Their body cannot be replaced by
API, so everything new is added by a footer script served from fundhub.ai:

| Page | ClickFunnels page | Footer script |
|---|---|---|
| https://apply.fundhub.ai/watch | 25061160 | `public/funnel/watch-proof.js` |
| https://apply.fundhub.ai/thank-you | 25063539 | `public/funnel/thankyou-sort.js` |

The Sorting Hat: one call, three roads (get funded now, fix the file first, learn
to do it yourself). Nobody gets turned away.

## /watch

```mermaid
flowchart TD
    A["Visitor opens /watch"] --> B["H1, video, Get Started, note<br/>(builder page; words unchanged)"]
    B --> C["watch-proof.js runs<br/>run() — public/funnel/watch-proof.js"]
    C --> D{".fh-root .cta-note found?"}
    D -->|no| E["Falls back to the first a.btn to /apply.<br/>Neither found: adds nothing"]
    D -->|yes| K["html.fhw set; flushGutters(): the builder boxes around .fh-root<br/>lose their side padding (column 24px from the edge, as /roadmap);<br/>H1 takes the /roadmap H1 rule, amounts in the H1 font"]
    K --> F["Real approvals. Real screenshots.<br/>all 16 deck.json win cards in one row;<br/>motion(): the row slides right as the page scrolls down<br/>(fhxShift; reduced motion: a swipe row;<br/>Tab onto a card: fhxKeep shows it)"]
    F --> G["From our clients<br/>3 vertical video placeholders<br/>[ VIDEO TESTIMONIAL 1-3 ] (the /roadmap slot)"]
    G --> H["One call. Three roads. Nobody gets turned away."]
    H --> I["Second Get Started → /apply"]
    B -->|first button| J["/apply"]
    I --> J
```

One column at every width, same heading and the same space between the three
blocks. The approvals row starts to slide once the whole row is on screen (its
bottom edge 90% down) and shows the last card while the whole row is still on
screen (its top edge 10% down); the page itself is never held. No client-text
cards (owner, 2026-09-22). Tap, click, Enter or Space on any screenshot opens it
full size; a click or Escape closes it.

## /thank-you

Regenerated from code on 2026-10-23 (branch `claude/ty-page-reorg`, owner reorder; not live until
Chris approves the marked draft and the page is pushed). The page is now its own custom HTML page
(25752378) on the /thank-you step, so `marketing/landing-pages/05-thank-you.html` is the body and
the footer scripts below fill it in.

```mermaid
flowchart TD
    A["Visitor lands on /thank-you<br/>(after booking, or sent here by the homepage survey)<br/>body: 05-thank-you.html"] --> B["thankyou-sort.js runs<br/>run() — public/funnel/thankyou-sort.js<br/>sends survey_route once"]
    B --> C{"fhIsBooked(fh_booking_v1, referrer)?<br/>came straight from /funding-book-call,<br/>start/end, name + email,<br/>submittedAt or capturedAt under 6h,<br/>start still in the future"}
    C -->|yes| D["Apple / Outlook (.ics) button shown"]
    C -->|no| E[".ics button hidden"]
    D --> F
    E --> F["Everyone: Confirmed · You're All Set. · Your Call Is Booked.<br/>Video under the headline (buildVideo, VIDEO_SRC)<br/>Confirm your call: accept the invite in your email,<br/>Add to Google Calendar (+ .ics, + open your inbox when known)"]
    F --> G["What happens on the call<br/>(step 03: You get one of three paths)"]
    G --> H["Before we talk<br/>(prep list, Reschedule your call link)"]
    H --> I{"fundhub-prompter-download.json<br/>holds an apps.apple.com link?"}
    I -->|yes| J["Fundhub Portal card fills #fh-ty-app-slot<br/>public/funnel/fundhub-prompter-download.js<br/>tap = app_download_tap (fh-events.js)"]
    I -->|no| K["No card; the slot stays empty"]
    J --> L
    K --> L["Your three paths: funding-paths.js,<br/>placed after #fh-ty-app-slot<br/>(step 1 of its strip: Get the app)"]
    L --> M["Real approvals, real screenshots<br/>$74,000 · $50,000 KeyBank · $25,000 Highland<br/>(no client texts) — any screenshot opens full size"]
    M --> N["FAQ"]
```

"What the call decides" was cut on 2026-10-23: it repeated step 03 and the three paths. A page
body without `#fh-ty-app-slot` (the old one) still works: the card goes under the headline and the
three paths go after the call steps, as before.

GAP: `docs/journeys/fundhub-prompter-funnel-download-intended.md` still says the card shows "below
the confirmation hero" and names the Prompter and TestFlight. The code now puts the Fundhub Portal
card under "Before we talk", as Chris asked on 2026-10-23. The intended file is Chris's to update.

Since 2026-10-01 everyone sees the booked page, so the booking check below only decides the .ics
button. The "Pick your call time" lines further down are history from before that.

Since 2026-10-02 the live /funding-book-call page stamps `submittedAt` from a
footer block (`marketing/landing-pages/04e-book-confirm.html`, marker
`fh-book-confirm`) only when ClickFunnels fires `cf:form_submitted:ok` — the
booking POST came back OK. A Book press ClickFunnels refuses (bad phone, 422)
stamps nothing. The older body writer still saves on every change; the block
re-stamps after it. `capturedAt` still counts for records made before that.

The live writer saves the record every time the slot, name or email changes,
before Book is pressed. So a record alone is not a booking: the visitor must also
arrive straight from /funding-book-call (`document.referrer`). ClickFunnels sends a
real booker on with `window.location` from that page (`user_pages` bundle, form
submit). Filling the form and pressing Back keeps /thank-you's first referrer, so
that visitor sees "Pick your call time". A booker who comes back later from another
link also sees "Pick your call time"; their confirmation email still holds the time.

Who sees "Pick your call time": everyone without a booking, including the homepage
survey's DOWNSELL and MANUAL_REVIEW leads (`SURVEY_REDIRECTS` in
`src/config/homepage-survey-steps.mjs` still sends them here, not to the calendar).
Decided 2026-09-22 under the owner's "no questions, decide and ship": the Sorting
Hat call is where every lead gets sorted (fund now, fix the file first, or do it
yourself), /watch promises "Nobody gets turned away", and this page's own FAQ
already tells a low-score reader "Still take the call." The survey routing itself
is unchanged.

## Push

`node scripts/cf-push-custom-html.mjs push --only=apply-watch` and
`--only=apply-thank-you`. Mode `builder_page_tracking_inject_only`: appends the
footer script only; any src already on the live page is skipped
(`trackingFooterScripts`, `clickfunnels-fragments/tracking-manifest.mjs`).
The push reads the live footer code (`GET /pages/{id}?expand[]=footer_code`) and
the public page. If either cannot be read, or the page is not a ClickFunnels page
(`isClickFunnelsPageHtml`), it writes nothing, reports `live_page_unreadable` and
exits 1. Otherwise it saves the old footer to
`docs/workflows/cf-push-snapshots/page-<id>-footer_code.html`, builds the new footer
with `nextFooterCode` (one copy of each script the row owns, missing tags added,
other tags untouched), sends it whole with `footer_code_mode: "replace"`, and reads
it back. It fails unless the read-back matches. ClickFunnels "append" stored each
pushed tag twice on 2026-09-22, so the push never appends.
