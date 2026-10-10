// Tripwire map — which deep check goes red when a money or customer surface breaks.
//
// Owner law (2026-10-09, .claude/rules/heartbeat-on-every-build.md): anything that touches money
// or a paying customer gets a tripwire, a deep check that goes red when the customer's result is
// wrong. A ping (reg:…, job:…) proves a door answers or a clock ran. It is not a tripwire.
//
// Every surface sits in exactly one place:
//   TRIPWIRES                 money or customer — names the deep check ids that go red on its break
//   NOT_CUSTOMER_FACING       staff-only or internal — a written reason, 40 characters or more
//   tripwires-baseline.json   surfaces that existed on 2026-10-09 and are not sorted yet.
//                             This list only shrinks. Sort an entry by moving it into one of the two maps.
//
// src/pulse/tripwires.test.mjs fails any build that adds a surface to none of them, names a check
// id that does not exist, or calls a ping a tripwire. That is how a new page, route, job or send
// cannot ship without someone deciding its tripwire.
//
// Surface keys:
//   route:<ROUTES key in netlify/functions/api.mjs>
//   desk:<file in public/app>
//   page:<path under public, outside app>
//   job:<Inngest function id in src/workflows/index.mjs>
//   send:<file named in SEND_PATHS in src/pulse/registry.mjs>
//
// Check ids are the ids the lanes write (src/pulse/coverage/gap-*.mjs, slice-*.mjs) or the pulse's
// own checks (src/pulse/daily-pulse.mjs). The pulse may prefix a gap id with its lane on the
// scorecard; the id named here is the one written in the lane file.

export const TRIPWIRE_IMPACTS = Object.freeze(["money", "customer"]);

/** Ids that only prove a door answers or a clock ran. Never enough on their own. */
export function isPingId(id) {
  return /^(reg|job|wf):/.test(String(id)) || ["health", "login", "apply"].includes(String(id));
}

export const TRIPWIRES = Object.freeze({
  // Launch day, 2026-10-09: the path a new customer walks, each with the deep checks that go red
  // when it breaks. Proven read-only on live data and from a built bundle before they were listed.
  "route:public/slo-checkout": { impact: "money", checks: ["payments:checkout-started-no-link", "keys:checkout-key-read"] },
  "page:roadmap/pay.html": { impact: "money", checks: ["payments:checkout-started-no-link", "funnel:order-price-matches-till"] },
  "page:roadmap/index.html": { impact: "money", checks: ["lead:pipe-cut-with-traffic", "funnel:card-box-script-loads"] },
  "route:public/slo-interest": { impact: "money", checks: ["lead:pipe-cut-with-traffic", "handoff:contact-no-followup"] },
  "route:public/survey-submit": { impact: "money", checks: ["lead:pipe-cut-with-traffic", "handoff:lead-first-touches-missing"] },
  "route:payment-links": { impact: "money", checks: ["payments:pay-link-webhook", "payments:checkout-started-no-link"] },
  "job:commas-inbox-drain": { impact: "money", checks: ["payments:commas-inbox-waiting", "payments:paid-no-entitlement"] },
  "job:s-01-new-lead-intake": { impact: "money", checks: ["handoff:lead-first-touches-missing"] },
  "job:s-02-incomplete-survey-nudge": { impact: "money", checks: ["handoff:lead-first-touches-missing"] },
  "job:slo-genuine-followup": { impact: "money", checks: ["handoff:contact-no-followup"] },
  "job:slo-no-reply-197": { impact: "money", checks: ["handoff:contact-no-followup"] },
  "job:slo-genuine-checkout-sms": { impact: "money", checks: ["handoff:contact-no-followup"] },
  "job:slo-infinite-drip": { impact: "money", checks: ["email:drip-step-no-email"] },
  "page:roadmap/pull.html": { impact: "customer", checks: ["softpull:paid-form-not-filled-2h", "consent:slo-store"] },
  "route:public/slo-pull": { impact: "customer", checks: ["softpull:request-failed-or-stuck", "consent:slo-store"] },
  "route:soft-pull-approve": { impact: "customer", checks: ["softpull:approve-click-no-pull", "soft-pull:approve-read"] },
  "desk:soft-pull-approve.html": { impact: "customer", checks: ["softpull:approve-click-no-pull", "soft-pull:approve-page"] },
  "job:c-00-crs-soft-pull-request": { impact: "customer", checks: ["softpull:request-failed-or-stuck", "keys:credit-pull-live-allowed"] },
  "job:slo-paid-form-nudge": { impact: "customer", checks: ["softpull:paid-form-not-filled-2h"] },
  "job:slo-pack-delivery": { impact: "customer", checks: ["uw-paid-roadmap-no-pack", "uw-pack-files-incomplete", "uw-pack-email-not-queued"] },
  "job:message-dispatch-sweeper": { impact: "customer", checks: ["gap:sms-sending-stuck", "email:sending-stuck", "gap:msg-sent-no-receipt"] },
  "job:s-00-welcome": { impact: "customer", checks: ["handoff:lead-first-touches-missing", "gap:sms-journey-zero"] },
  "job:s-04-call-booked": { impact: "customer", checks: ["handoff:booking-no-confirm", "calls:booked-no-join-link"] },
  "job:s-04b-booking-reminders": { impact: "customer", checks: ["handoff:reminder-missing"] },
  "route:bookings": { impact: "customer", checks: ["handoff:booking-no-confirm", "calls:booked-no-outcome"] },
  "route:auth/magic-link": { impact: "customer", checks: ["gap:auth-magic-link-dead"] },
  "route:auth/magic-link-verify": { impact: "customer", checks: ["gap:auth-magic-link-dead", "gap:auth-signin-no-session"] },
  "route:auth/send-portal-link": { impact: "customer", checks: ["gap:auth-magic-link-dead"] },
  "page:portal-login.html": { impact: "customer", checks: ["gap:auth-magic-link-dead", "portal:paid-client-never-signed-in"] },
  "desk:client-portal.html": { impact: "customer", checks: ["portal:page-scripts-load", "portal:paid-entitlement", "portal:next-step"] },
  "route:read/portal-summary": { impact: "customer", checks: ["portal:summary"] },
  "route:read/client-progress": { impact: "customer", checks: ["portal:progress-read-real-client"] },
  "page:progress.html": { impact: "customer", checks: ["portal:progress-read-real-client"] },
  "route:read/entitlements": { impact: "customer", checks: ["payments:paid-no-entitlement", "portal:paid-entitlement"] },
  "route:contracts/sign": { impact: "customer", checks: ["contracts:sent-unsignable", "contracts:signed-not-stored"] },
  "route:documents-upload": { impact: "customer", checks: ["documents:upload-store", "documents:stuck-processing"] },
  "route:consent/capture": { impact: "customer", checks: ["consent:store", "consent:required"] },
  // Coverage batch W5, 2026-10-10: customer records and bank links. Each check below reads the data and
  // goes red when the client's result is wrong. Written in src/pulse/coverage/gap-bank-links.mjs,
  // gap-money-helper.mjs, gap-records.mjs, gap-partner-pages.mjs and the key list in gap-keys.mjs.
  "route:banking/link-token": { impact: "customer", checks: ["keys:launch-secrets-present", "banks:login-broken"] },
  "route:banking/link-exchange": { impact: "customer", checks: ["banks-active-link-no-accounts", "banks-linked-not-on-screen", "keys:launch-secrets-present"] },
  "route:banking/revoke": { impact: "customer", checks: ["privacy:erasure"] },
  "route:banking/sync-accounts": { impact: "customer", checks: ["banks:login-broken", "banks-sync-stale"] },
  "route:banking/sync-transactions": { impact: "customer", checks: ["banks-sync-stale", "banks:login-broken"] },
  "route:banking/sync-liabilities": { impact: "customer", checks: ["banks:login-broken", "banks-sync-stale"] },
  "route:money/connections": { impact: "customer", checks: ["banks:merchant-sync", "keys:launch-secrets-present"] },
  "route:money/helper": { impact: "customer", checks: ["helper:rows-stuck", "finance-os:helper"] },
  "route:money/tasks": { impact: "customer", checks: ["helper:rows-stuck"] },
  "route:privacy/erasure": { impact: "customer", checks: ["privacy:erasure"] },
  "route:pii": { impact: "customer", checks: ["privacy:pii-company"] },
  "route:partner-pages": { impact: "customer", checks: ["partner-pages:live"] },
  "route:partner-brand": { impact: "customer", checks: ["partner-pages:live"] },
  "route:ai-bureau-config": { impact: "customer", checks: ["bureau-config:complete"] },
  "desk:money-accounts.html": { impact: "customer", checks: ["banks:login-broken", "banks-linked-not-on-screen", "banks-active-link-no-accounts"] },
  "desk:money-banks.html": { impact: "customer", checks: ["crm-data:lenders", "crm-data:lender-matches"] },
  "desk:money-connections.html": { impact: "customer", checks: ["banks:merchant-sync"] },
  "desk:money-helper.html": { impact: "customer", checks: ["helper:rows-stuck", "finance-os:helper"] },
  "desk:brand-studio.html": { impact: "customer", checks: ["partner-pages:live"] },
  "desk:lenders.html": { impact: "customer", checks: ["apply-links", "crm-data:lenders", "bureau-config:complete"] },
  "job:plaid-transactions-sweeper": { impact: "customer", checks: ["banks-sync-stale", "banks:login-broken"] },
  "job:merchant-pull-sweeper": { impact: "customer", checks: ["banks:merchant-sync"] },
  // M2 repair, 2026-10-09: the push puts a built funnel live on apply.fundhub.ai, where it takes ad
  // traffic and shows on every affiliate's link list. The push proves its pages once. This lane
  // reads every live built funnel's pages again each morning and goes red on a dead or wrong page.
  "route:marketing/funnels/push-live": { impact: "money", checks: ["built-funnels:live-pages-answer"] },
  // Coverage batch 2026-10-10, W1 Money A (src/pulse/coverage/gap-money-funding.mjs). Funding, fees and
  // payouts. Each deep check reads what the money chain, the bank answers, the payout run or the
  // commission screens actually left in the books, and goes red when it is wrong.
  // W3 adds its own board check ids to route:pipeline-cards after this merges.
  "route:pipeline-cards": { impact: "money", checks: ["funding:funded-no-bill", "pipeline:count-true", "pipeline:stage-vs-fact", "pipeline:nobody-lost"] },
  "route:applications": { impact: "money", checks: ["funding:approved-no-amount", "funding:funded-no-bill"] },
  "route:commissions": { impact: "money", checks: ["commissions:ledger"] },
  "route:commission-rules": { impact: "money", checks: ["commissions:ledger", "commissions:slo-map"] },
  "route:slo-connections": { impact: "money", checks: ["commissions:slo-map"] },
  "route:dashboard/seed": { impact: "money", checks: ["books:sample-rows"] },
  "route:read/affiliates": { impact: "money", checks: ["partners:payout-held"] },
  "desk:products-commissions.html": { impact: "money", checks: ["commissions:ledger", "commissions:slo-map"] },
  "desk:client-control-panel.html": { impact: "money", checks: ["funding:funded-no-bill", "funding:approved-no-amount"] },
  "desk:affiliate.html": { impact: "money", checks: ["partners:payout-held"] },
  // Coverage batch W2 (money B), 2026-10-10: checkout links, the FinanceOS setup fee, money that fits no plan,
  // past-due plans, stuck money moves, and what Meta says about our ad money. Each id is written in its lane
  // file under src/pulse/coverage/ and was read on live data, read only, before it was listed.
  "route:paid-services": { impact: "money", checks: ["checkout:paid-service"] },
  "route:public/slo-repair-checkout": { impact: "money", checks: ["checkout:repair-price"] },
  "route:public/funnel-checkout": { impact: "money", checks: ["checkout:funnel-door", "checkout:funnel-no-sale"] },
  "route:money/setup": { impact: "money", checks: ["finance-os-setup:paid-turns-on", "finance-os-setup:price-set"] },
  "desk:money-setup.html": { impact: "money", checks: ["finance-os-setup:paid-turns-on", "finance-os-setup:price-set"] },
  "route:money/payments": {
    impact: "money",
    checks: ["payments-unmatched:receipt-waiting", "payments-unmatched:installment-late-no-flag"]
  },
  "desk:money-payments.html": {
    impact: "money",
    checks: ["payments-unmatched:receipt-waiting", "payments-unmatched:installment-late-no-flag"]
  },
  "route:money/transfers": { impact: "money", checks: ["money-moves:stuck"] },
  "desk:money-transfers.html": { impact: "money", checks: ["money-moves:stuck"] },
  "job:finance-os-money-transfers": { impact: "money", checks: ["money-moves:stuck"] },
  "route:finance/subscriptions": { impact: "money", checks: ["subscriptions:past-due"] },
  "route:finance/cards": { impact: "money", checks: ["subscriptions:past-due"] },
  "job:subscription-billing-sweeper": { impact: "money", checks: ["subscriptions:past-due"] },
  "route:partner-addons": { impact: "money", checks: ["subscriptions:addon-paid-no-plan", "subscriptions:past-due"] },
  "route:campaigns/write": { impact: "money", checks: ["ads-meta:matches"] },
  "desk:campaign-manager.html": { impact: "money", checks: ["ads-meta:matches", "ads-meta:load-jobs"] },
  // W3 Pipelines truth, 2026-10-10: a board is where a client's place in the company is kept. Each
  // door and desk below reads or moves a card. The deep checks are in gap-pipeline-boards.mjs and
  // gap-pipeline-facts.mjs. route:pipeline-cards is W1's line; its W3 ids are named in manifest-w3.md.
  "desk:pipeline.html": { impact: "customer", checks: ["pipeline:count-true", "pipeline:stage-vs-fact", "pipeline:nobody-lost"] },
  "route:dashboard/pipeline": { impact: "customer", checks: ["pipeline:count-true"] },
  "route:dashboard/client-archive": { impact: "customer", checks: ["pipeline:nobody-lost"] },
  "route:pipeline-clients": { impact: "customer", checks: ["pipeline:count-true", "pipeline:nobody-lost"] },
  "route:inquiry-cases": { impact: "customer", checks: ["pipeline:stage-vs-fact", "pipeline:dead-stage"] },
  "desk:inquiry-remover.html": { impact: "customer", checks: ["pipeline:stage-vs-fact", "pipeline:two-records"] },
  "desk:hiring.html": { impact: "customer", checks: ["pipeline:count-true", "pipeline:dead-stage"] },
  "desk:csm-queue.html": { impact: "customer", checks: ["csm:overdue-unassigned", "csm:missing-step"] },
  "desk:sales-floor.html": { impact: "money", checks: ["sales-manager:totals", "pipeline:two-records"] },
  // W4 messages truth, 2026-10-10 (ops/workflows/coverage-every-surface-2026-10-10.md). What a customer reads
  // and whether the path worked: the nine msg:* rows in src/pulse/coverage/gap-msg.mjs and the alert texts
  // in src/pulse/coverage/gap-alerts.mjs. Each one names a deep check that reads the saved message or alert,
  // not a ping.
  "route:messages-outbound": { impact: "customer", checks: ["msg:brakes", "msg:per-template-path", "msg:sent-body-blanks", "msg:links-in-body"] },
  "desk:messaging.html": { impact: "customer", checks: ["gap:msg-inbound-unmatched", "gap:sms-sending-stuck", "msg:brakes", "msg:staff-template-to-client"] },
  "desk:ops-admin.html": { impact: "customer", checks: ["msg:brakes", "msg:per-template-path", "msg:sent-body-blanks"] },
  "route:money/alerts": { impact: "customer", checks: ["alerts:texts-went-out"] },
  "desk:money-alerts.html": { impact: "customer", checks: ["alerts:texts-went-out"] },
  "job:blueprint-finance-os-alerts": { impact: "customer", checks: ["alerts:texts-went-out"] },
  "job:finance-os-card-due-reminders": { impact: "customer", checks: ["alerts:texts-went-out"] },
  // The paper letter to a bureau, for a paying repair client. The send itself has no read of its own: the
  // repair lane goes red when a file sits at ready-to-send or in transit past its clock (a letter that never left).
  "send:src/metro2/delivery/send.mjs": { impact: "customer", checks: ["pipeline:repair", "repair-case-stuck"] }
});

export const NOT_CUSTOMER_FACING = Object.freeze({
  "desk:morning-brief.html":
    "Owner-only report page: it opens from the secret link in Chris's own morning and evening text and never reaches a customer. Its guard is the brief-link beat.",
  "route:public/morning-brief":
    "Owner-only report data behind a secret link code, answers the same 404 to everyone without the exact code, never reaches a customer. Its guard is the brief-link beat.",
  "send:src/pulse/alerts.mjs":
    "Owner-only: the hourly pulse's alert texts and buzzes go to Chris's own number and ntfy topic. It never reaches a customer. Its heartbeat is job pulse-hourly.",
  "route:ops/notify-owner":
    "Owner-only: one text to Chris's own pulse number for an agent on the Mac, behind a secret. It never reaches a customer. Its ping is reg:ops/notify-owner.",
  // W4 messages truth, 2026-10-10. Each of these sends to Chris or to a staff member. A wrong address is
  // read by msg:staff-template-to-client (a staff template that reaches someone who is not staff).
  "send:netlify/functions/teleprompter-live-text.mjs":
    "Owner-only: one text to Chris's own phone when a film link is ready, behind a secret code. It never reaches a customer. Texting hours apply.",
  "send:src/ad-videos/notify-fanout.mjs":
    "Owner-only: texts and buzzes Chris's own phone and ntfy topic when a finished ad is ready. It never reaches a customer. Texting hours apply.",
  "send:src/pulse/instant-watch.mjs":
    "Owner-only: the 5-minute watch texts Chris's own number when a critical door is down. It never reaches a customer. Its heartbeat is job pulse-instant-watch.",
  "send:src/pulse/notify.mjs":
    "Owner-only: the morning pulse texts Chris's own number its report. It never reaches a customer. Its heartbeat is job daily-pulse.",
  "send:src/staff/blake-lead-watch.mjs":
    "Owner-only: texts Chris the name and phone of a lead Blake referred. Its own header says it never texts the lead. Its heartbeat is job blake-lead-watch.",
  "send:src/auth/staff-mail.mjs":
    "Staff-only: emails an employee their login or password link. It never reaches a customer. Its door is watched by reg:auth/invite and the auth lane.",
  "send:src/staff/comp-alerts.mjs":
    "Staff-only: tells a closer or sales manager their commission was paid or a deal closed. Never a customer. msg:staff-template-to-client reads the text half for a wrong address.",
  "send:src/workflows/ad-video-sweeper.mjs":
    "Owner-only: the sweeper's ready-ad buzz goes to Chris through notify-fanout. It never reaches a customer. Its heartbeat is job ad-video-sweeper.",
  "send:src/push/send.mjs":
    "Dead today: nothing in the app calls sendToClient (only scripts/push/send-test-push.mjs does), so no customer is sent anything through it. Move this entry to TRIPWIRES the day a caller is added."
});
