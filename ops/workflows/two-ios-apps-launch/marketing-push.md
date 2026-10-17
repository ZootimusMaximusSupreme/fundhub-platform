# Marketing push workflow B — 2026-10-17

Owner said go to customer marketing push alongside email/SMS. This board records the discovered scope; it does **not** mark marketing push shipped.

## Evidence

- Current dispatcher mirrors only a successful `SMS-S04-01-CONFIRM` to native push (`src/messaging/dispatch.mjs`). Browser push has no automatic sender (`docs/journeys/push-flow.md`).
- BS-01 triggers on booking create/reschedule. It queues one T-48h pre-call SMS (`SMS-BS01-02-PRECALL`) and can queue up to 18 funding/repair emails. Its booked/day-of SMS keys remain in source but are not sent; S-04B owns 24h/2h reminders. Source: `src/workflows/bs-01-precall-launcher.mjs`.
- No-book (three pairs), no-show (four pairs), and SLO follow-ups use `sendTemplated`, so they enter the normal outbox. SLO infinite drip is email-only. Sources: `src/workflows/s-nobook-chase.mjs`, `s-05a-no-show-recovery.mjs`, `slo-*.mjs`.
- Owner ad-video notifications bypass the client outbox and already try SMS plus ntfy (`src/ad-videos/notify-fanout.mjs`). Native APNs devices are tied to client/authorized-representative sessions, not staff. Keep owner alerts separate from client marketing.
- No outbound marketing-push preference found in `src/`, `scripts/`, `db/`, or `docs/`. `marketing_use` consent covers reuse of a client's recording/likeness in ads, not outbound offers (`db/migrations/291_recording_and_marketing_consent.sql`). Existing `opt_outs` has SMS/email/voice channels.
- Push payload currently allows only the client portal URL. It refuses campaign URLs and unlisted body text (`src/push/payload.mjs`). BS email cells can be draft/placeholder and the normal dispatcher blocks them.

## Handoff to workflow A (dispatcher/push owner)

1. Do not mirror every marketing email. Start with an exact allowlist, led by BS-01's successful `SMS-BS01-02-PRECALL`, and at most one push per SMS/email twin. Do not make a push for a queued, blocked, deferred, failed, synthetic or dry-run send.
2. Keep marketing pushes off until a signed-in client has explicitly turned on **Marketing updates**. Reuse `clients.custom_fields` for the first preference if the owner wants no migration; default is off. Suppress when either SMS or email has an active opt-out.
3. Without new schema, enforce a conservative 1/24h and 3/7d client cap using prior successful, push-eligible `messages` rows, excluding the current row. Source message ID is the dedupe key. Keep 8 a.m.–8 p.m. Arizona time for promotional buzzes.
4. Use fixed generic approved payloads. The only current safe tap target is `/app/client-portal.html`; confirm the call card shows the same booking before activating BS-01. Hold no-book, no-show and SLO offer pushes until the opened app can actually finish the action.
5. Mark the new send path in heartbeat/tripwire coverage and prove one real iPhone receive/tap. An APNs failure must not retry the email/SMS.

Detailed intended order, copy and source keys: `docs/journeys/marketing-push-intended.md`.
