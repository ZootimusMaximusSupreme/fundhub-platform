# Booked-call calendars — owner and closer acceptance (2026-10-28)

**Overall: NOT LIVE PROVED.** The successful booking/invite observations below do not establish that *both* hosts' real Google Calendars are correctly configured. This is evidence for the front-of-house matrix in `front-house-screen-acceptance-matrix-2026-10-27.md` and the manual E2E walkthrough in `manual-e2e-2026-10-26.md`, not a passing certificate.

No customer identity, mailbox ID, personal address, actual meeting URL/code, or credential belongs in this repository evidence.

## What was verified, read only

| Date | Evidence | Narrow verdict |
| --- | --- | --- |
| 2026-09-03 through 2026-10-10 | `src/bookings/meet-link.mjs` records an earlier read of **11** owner-hosted Funding Strategy Meeting events, each with a customer guest and a Meet room. This is historical code commentary, not a fresh Calendar provider read. | Historical owner events **reported PASS**; current owner/closer acceptance **OPEN** |
| 2026-10-26 | Manual E2E Phase 2.9 screenshot showed an owner host-side event with **no Google Meet link and no guests**, even though the saved Fundhub booking row had a meeting URL. | Host-side booking/guest/Meet consistency **FAIL**, not resolved by the stored link alone |
| 2026-10-27 | Independent read-only Gmail search/read found a **Google Calendar invitation delivered** to the synthetic plus-tag attendee for a 30-minute owner-organized Funding Strategy Meeting at **3:00 PM MST**. Its invitation **contained a Google Meet join link**. | One synthetic **invitation delivery + Meet-in-invite PASS**. This does **not** prove Google Calendar host-side persistence or Justice's calendar. |
| 2026-10-27 | A later **cancellation notification** for that exact synthetic appointment was also present in Gmail. | One synthetic **cancellation-email delivery PASS**. This does **not** establish that every booking/cancellation updates each host's actual calendar. |
| 2026-10-28 | The dedicated Google Calendar read connector required interactive account authorization during this unattended run; no calendar events were read through it. | Actual owner/Justice calendar readback **NOT LIVE PROVED** |

## Required separate acceptance — no assumptions across hosts

| Check | Owner / Chris | Closer / Justice |
| --- | --- | --- |
| A real booked call appears on the intended host's actual Google Calendar at the correct date and timezone | **NOT LIVE PROVED** (historical mixed evidence) | **NOT LIVE PROVED** |
| Matching lead email appears as an actual calendar guest, and invite is delivered | **PARTIAL** (one synthetic invitation delivered; 2026-10-26 guest missing) | **NOT LIVE PROVED** |
| The actual host event carries a valid Google Meet link | **PARTIAL** (synthetic invite did; 2026-10-26 host screenshot did not) | **NOT LIVE PROVED** |
| Saved booking + closer task Join refer to the **current** call's room, not a previous or moved call | **CODE/TEST PROOF ONLY; LIVE OPEN** | **CODE/TEST PROOF ONLY; LIVE OPEN** |
| Reschedule moves correct host event, invalidates any old join room and issues correct new invite | **NOT LIVE PROVED** | **NOT LIVE PROVED** |
| Cancellation removes/closes the correct booked call in host calendar and suppresses old-slot reminders | **PARTIAL** (one synthetic cancellation email) | **NOT LIVE PROVED** |

## Source diagnosis and safe next proof

`src/bookings/meet-link.mjs` reads `https://www.googleapis.com/calendar/v3/calendars/primary/events` using the configured Google OAuth candidates and matches **the exact start time + customer attendee address**. The booking webhook itself has no Meet URL. No proven per-host lookup to Justice's independent primary calendar exists here; an OAuth token for the owner's primary calendar does **not** demonstrate Justice's setup. A separate staff calendar assignment may be required if the two hosts use distinct accounts. A Google Business Profile is not required merely to use Google Calendar.

A separate source fix is proposed in PR #185: when a call's time changes, clear the *old* Meet URL in both the saved booking and closer task so the calendar-read path may fill the current slot's link. This is not provider confirmation, and the PR must pass protected CI before merge.

**External acceptance still needed:** With permitted signed-in read-only access to the *owner and Justice calendars separately*, cross-check a known genuine booking's provider ID, host, start/timezone, guest, Meet room, recipient invite, and Fundhub booking + Join. Do the same for a reschedule and cancellation without creating fake production customers, sending test SMS, charging a card, or pulling a bureau. If a calendar host has no accessible Google API authorization, record **NOT LIVE PROVED** and document that exact account permission gap; do not mark a screen PASS because its unit test passed.

**End state:** Owner **OPEN**; Justice **OPEN**; whole front-of-house audit **OPEN**.
