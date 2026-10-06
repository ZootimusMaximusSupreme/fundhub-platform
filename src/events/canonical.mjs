// Canonical event names — Master Rebuild Spec §4. Extend as needed, keep names.
// The journey spine + the side events every adapter can emit.
export const CANONICAL_EVENTS = [
  // journey spine
  "entry.captured",
  "survey.submitted",
  "diagnostic.paid", // $32
  "analysis.completed",
  "booking.created",
  "booking.rescheduled",
  "booking.cancelled",
  "booking.noshow",
  "call.completed",
  "decision.rendered", // 6-tier outcome
  "deposit.paid",
  "sale.closed",
  "round.started",
  "round.submitted",
  "round.approved",
  "round.funded",
  "round.closeout",
  "file.finalized",
  // side events
  "payment.received",
  "payment.failed",
  /* The four below are Commas payment outcomes that are NOT declines and must
     never be mapped onto payment.failed.

     `expired` and `canceled` are abandoned checkouts — a link that timed out
     or a customer who backed out. Folding them into payment.failed would
     inflate the decline rate with people who were never declined, and decline
     rate is a number the sales floor is managed on. They carry no money and
     have no money handler; they exist so the abandonment is visible.

     `refunded` and `disputed` DO concern money that already moved. Neither
     reverses the ledger on its own — a refund's accounting treatment and a
     chargeback's are different questions with different answers, and guessing
     one here would silently rewrite commission. payment.disputed drives an
     urgent task instead, because a dispute has a response deadline. */
  "payment.expired",
  "payment.canceled",
  "payment.refunded",
  "payment.disputed",
  "docs.received",
  "inquiry.removed",
  "inquiry.gate.raised",
  "inquiry.gate.clear",
  "inquiry.docs.needed",
  "letter.generated",
  "message.inbound",
  "mail.response",
  // `message.queued` is emitted by sendTemplated when a row is really written —
  // a replayed event dedupes into no row and so emits nothing. The other three
  // are the dispatcher's terminal outcomes and have NO emitter yet: the
  // dispatcher records to the messages row and makes no bus writes, so these are
  // the names reserved for when it does. Do not assume they fire.
  //
  // Keep the line below short — scripts/diagrams/generate.mjs uses the comment
  // line immediately above a group as that group's section name in the table.
  // outbound messaging
  "message.queued",
  "message.sent",
  "message.failed",
  "message.blocked",
  // commission + billing (proposed in src/commissions/PROPOSED-EVENTS.md)
  "commission.earned",
  "commission.approved",
  "commission.paid",
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.voided",
  /* Emitted by src/contracts/send.mjs and sign.mjs with an idempotency key
     derived from the contract id, so a replay writes one event rather than two.
     The payload carries ids and status ONLY — never the contract body. This
     table is read by the dead-letter queue, the replay harness and the journey
     runner, and none of them should end up holding a copy of a consumer's
     signed agreement.

     NO HANDLER IS REGISTERED FOR EITHER, deliberately. emit() dispatches to
     whatever src/events/registry.mjs holds; adding one here would be inventing
     a side effect nobody asked for. The names exist so a workflow can react
     when somebody decides what should happen.

     Keep the line below short — scripts/diagrams/generate.mjs uses the comment
     line immediately above a group as that group's section name in the table. */
  // contracts
  "contract.sent",
  "contract.signed",
  /* Metro 2 / DFY credit repair — CREDIT-REPAIR-PIPELINE-SPEC §3.
     Retires the unused N-05 proposal names (repair.round_sent etc.).
     Keep the line below short — scripts/diagrams/generate.mjs uses the comment
     line immediately above a group as that group's section name in the table. */
  // credit repair
  "repair.enrolled",
  "repair.docs.needed",
  "repair.docs.complete",
  "repair.analysis.complete",
  "repair.analysis.empty",
  "repair.letters.ready",
  "repair.letters.sent",
  "repair.letters.delivered",
  "repair.response.received",
  "repair.response.parsed",
  "repair.parse.low_confidence",
  "repair.response.retake",
  "repair.item.deleted",
  "repair.item.verified",
  "repair.item.updated",
  "repair.item.unaddressed",
  "repair.round.complete",
  "repair.round.escalated",
  "repair.program.complete",
  "repair.stalled",
  "repair.cancelled",
  /* PARTNER LIFECYCLE. Emitted by api/partners/approve.mjs when a human turns a
     white-label APPLICATION into a live partner — the moment a login, a brand
     row, a published page and the welcome mail all come into being.

     There is deliberately no `partner.applied` here. The only place that could
     emit it is api/public/partner-apply.mjs, which this unit does not own; the
     name is not reserved in advance because an event nobody emits reads as a
     feature that exists. See docs/journeys/CHANGELOG.md 2026-08-31.

     Keep the line below short — scripts/diagrams/generate.mjs uses the comment
     line immediately above a group as that group's section name in the table. */
  // partner lifecycle
  "partner.approved",
  // diy package
  "diy.package.requested",
  "diy.package.generating",
  "diy.package.ready",
  "diy.package.delivered",
  "diy.package.downloaded",
  /* SUBSCRIPTIONS COMMAS BILLS ITSELF. mapToCanonical() in
     src/adapters/commas.mjs maps `subscription.*` webhooks onto these five
     names, and emit() rejects any name that is not on this list — so without
     them the adapter throws on every subscription webhook, the inbox row is
     marked failed, and it retries forever. A renewal ALSO emits
     payment.received above, because it is money that actually moved; the names
     below are the lifecycle of the arrangement and move nothing on their own.
     Consumed by src/handlers/commas-subscriptions.mjs.

     Keep the line below short — scripts/diagrams/generate.mjs uses the comment
     line immediately above a group as that group's section name in the table. */
  // processor-billed subscriptions
  "subscription.started",
  "subscription.renewed",
  "subscription.past_due",
  "subscription.canceled",
  "subscription.completed",
  /* THE $147 ROADMAP FUNNEL (/roadmap). Both names already fire in production
     and three registered workflows listen for them (src/workflows/
     slo-genuine-followup.mjs, slo-no-reply-197.mjs): slo.contact_started is
     sent by api/public/slo-interest.mjs once step 1 has a phone, and
     slo.checkout_started is emitted by api/public/slo-checkout.mjs (still with
     allowNonCanonical, which this listing makes unnecessary but harmless).
     Listed 2026-10-05 so the event map and the workflow triggers agree (spec
     docs/specs/marketing-machine-2026-10-04.md §4 trap 16).

     Keep the line below short — scripts/diagrams/generate.mjs uses the comment
     line immediately above a group as that group's section name in the table. */
  // roadmap funnel
  "slo.contact_started",
  "slo.checkout_started"
];

export const isCanonical = (name) => CANONICAL_EVENTS.includes(name);
