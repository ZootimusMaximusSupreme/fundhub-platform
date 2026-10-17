# Client call invite by native push — source and local proof

This is the built path at the call-invite branch. It has not been deployed or
seen as a banner on a real iPhone yet.

1. `ai-set-04-3way-handoff` plans one wake 15 minutes before a booked or moved
   call. The run stops on a cancelled/moved call and queues
   `SMS-AISET04-HANDOFF` with a unique client-and-start-time send key. Its text
   can use the portal sign-in page as a fallback. That fallback is **not** a
   meeting room.
2. The existing outbox sweep applies the company switch, cap, opt-out,
   quiet-hours, draft, provider, and dry-run gates. Only after a transmitting
   provider succeeds and the text row is saved as `sent` does the companion
   policy run. A repeat cannot claim the sent row for another send.
3. For this exact SMS template, `src/push/message-policy.mjs` reads the
   client-and-call-time key, requires the current time to be in the 15-minute
   pre-call window, and reads a single matching booked/rescheduled row for the
   same company and client. A missing, moved, duplicate, or ended booking
   produces no invite. `src/bookings/meeting-link.mjs` accepts only HTTPS
   Google Meet room codes and the numeric Zoom room links used in Fundhub;
   sign-in, booking, phone, local, and credential-bearing links stay closed.
4. The native sender only offers enabled devices the fixed `call_invite`
   wording. The APNs payload carries the portal path, not a meeting URL or
   client data. APNs expiry is the earlier of the booked end or 30 minutes after
   the booked start. An invite that expires before send never reaches Apple.
   The browser-push lane is not used for this call invite. APNs failure does
   not turn the successful SMS back into a retry.
5. The signed-in `/api/read/portal-summary` read gives only that client's
   current or next booking. It returns a Join destination only from the
   15-minute pre-call window through the earlier of booked end or 30 minutes
   after start, and only for a validated meeting URL. The existing portal call
   card shows the destination host before offering **Join Call**.
6. On the client's tap, the portal makes a new authenticated summary read. A
   missing or changed call reveals no old link. If the host changed, the new
   host is shown and another tap is needed. With the same host, it opens the
   fresh HTTPS URL. The native web view hands external HTTPS navigation to
   iOS; it does not dial or auto-answer. Each verified notification tap also
   recreates the portal web view if its sheet was already open, so the page
   re-reads the current call rather than showing a stale one.

Local proof on 2026-10-17: 91 focused Node tests passed; TypeScript and lint
passed; six Playwright tests passed at 1440px and 390px, including fresh-link,
changed-host, stale-call, and signed-out behavior. Marked phone and desktop
shots are in `ops/workflows/build-evidence/call-invite-push/`. The existing
`native-push` heartbeat still covers the device registration and APNs send
pipe. Remaining proof before calling this live: deploy, a real current booking
and link, APNs acceptance plus a visible iPhone banner, and a client tap to
the correct meeting room. No production send was made by this branch.
