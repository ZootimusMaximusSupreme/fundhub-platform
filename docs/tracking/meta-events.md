# Fundhub → Meta: which actions are shared

Fundhub uses credit, income and offer fit inside its CRM. They cannot determine who is sent to Meta, including for conversion events, customer lists, exclusions or audience seeds. Changing the event name or hashing a contact does not change how the person was selected. For list uploads see `.ai/rules/audience-data-recipient-check.md`.

## Map (database event → Meta)

| Database event | Meta event | When |
|---|---|---|
| `page_view` | `PageView` | Only on a reviewed public marketing page with an approved source: `/watch` or `/blueprint`. |
| `page_view` | `ViewContent` | Same reviewed public marketing page. |
| `survey_answer` | `Lead` | A genuine completed public application acknowledged by Fundhub, on either the homepage or the apply survey. Same event for every credit/income answer. |
| `booking_confirmed` | `Schedule` | A funding calendar accepted the booking. The two calendar paths use the same event, including direct and framed bookings. A button press, rejected booking or calendar opened is not a conversion. |

## Fields on a conversion

The server uses a random event ID, time, website action source, and the same clean public entry URL (`https://apply.fundhub.ai/apply`) for both calendars. The private receipt that links to the submitted survey stays in Fundhub. A uniquely linked, recent public survey can supply hashed email and phone; a missing or ambiguous match does not remove the conversion. Other matching fields are a numeric Meta browser-cookie identifier, IP and user agent. A linked Lead or Schedule can also use a hashed first-party client UUID. Raw click strings and arbitrary browser session identifiers stay out of the Meta request. No questionnaire answers, score, income, offer tier, credit decision, order, payment, report, free text, query string, calendar label or custom parameters are sent. This repair does not send names. A visitor must have the right notice and permissions for matching data.

## Tracking on hosted pages

Keep the browser Pixel off applications, financial forms, checkouts, calendar variants, and thank-you pages, including their noscript tags. A browser SDK can read a URL, referrer or form without a custom event; use the restricted server sender for Lead and Schedule. Both funnel-level code and saved custom-page HTML matter on ClickFunnels. Do not re-install an unrestricted advertising relay on those pages. The existing DirectROAS booking webhook keeps its established booking identity and ad attribution fields, but drops qualification bucket, offer-financing screen and available-capital band. It reports accepted bookings independently of credit or income.

Fundhub can still measure individual survey and booking steps, credit outcomes, payment, and offer fit in its own database for its own teams. No historical list should be re-uploaded or renamed to implement this change.

## Verification

Use synthetic local fixtures with the outbound request intercepted. Compare both credit routes, success and failure, duplicate delivery, missing contact, and extra/unknown fields. Read back hosted page source and aggregate receipts after release; a green test or GitHub build is not a provider delivery receipt. Do not place a financial order or send a test customer to Meta to verify tracking.

[Meta Business Tools Terms](https://www.facebook.com/legal/technology_terms) · [Meta's description of indirect financial and consumer-report signals, pages 14–15](https://www.supremecourt.gov/DocketPDF/25/25-459/415386/20260630145620820_2026-06-30%20No.%2025-459%20Meta%20Amicus%20brief%20in%20Salazar%20v.%20Paramount%20Global.pdf#page=25).
