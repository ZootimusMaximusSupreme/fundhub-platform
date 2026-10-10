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
  // M2 repair, 2026-10-09: the push puts a built funnel live on apply.fundhub.ai, where it takes ad
  // traffic and shows on every affiliate's link list. The push proves its pages once. This lane
  // reads every live built funnel's pages again each morning and goes red on a dead or wrong page.
  "route:marketing/funnels/push-live": { impact: "money", checks: ["built-funnels:live-pages-answer"] },
  // Coverage batch 2026-10-10, W1 Money A (src/pulse/coverage/gap-money-funding.mjs). Funding, fees and
  // payouts. Each deep check reads what the money chain, the bank answers, the payout run or the
  // commission screens actually left in the books, and goes red when it is wrong.
  // W3 adds its own board check ids to route:pipeline-cards after this merges.
  "route:pipeline-cards": { impact: "money", checks: ["funding:funded-no-bill"] },
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
  "desk:campaign-manager.html": { impact: "money", checks: ["ads-meta:matches", "ads-meta:load-jobs"] }
});

export const NOT_CUSTOMER_FACING = Object.freeze({
  "desk:morning-brief.html":
    "Owner-only report page: it opens from the secret link in Chris's own morning and evening text and never reaches a customer. Its guard is the brief-link beat.",
  "route:public/morning-brief":
    "Owner-only report data behind a secret link code, answers the same 404 to everyone without the exact code, never reaches a customer. Its guard is the brief-link beat.",
  "send:src/pulse/alerts.mjs":
    "Owner-only: the hourly pulse's alert texts and buzzes go to Chris's own number and ntfy topic. It never reaches a customer. Its heartbeat is job pulse-hourly.",
  "route:ops/notify-owner":
    "Owner-only: one text to Chris's own pulse number for an agent on the Mac, behind a secret. It never reaches a customer. Its ping is reg:ops/notify-owner."
});
