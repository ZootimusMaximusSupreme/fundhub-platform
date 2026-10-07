import { registerRepairHandlers } from '../repair/register.mjs';
registerRepairHandlers();
import { arCollections } from './ar-collections.mjs';
import { af01AffiliateDrip } from './af-01-affiliate-drip.mjs';
import { af02ReferralOwnershipCapture } from './af-02-referral-ownership-capture.mjs';
import { aiSet01JoshSetter } from './ai-set-01-josh-setter.mjs';
import { aiSet03NoAnswerCadence } from './ai-set-03-no-answer-cadence.mjs';
import { aiSet043WayHandoff } from './ai-set-04-3way-handoff.mjs';
import { at01FirstTouchCapture } from './at-01-first-touch-capture.mjs';
import { bc01CustomerResponsiveness } from './bc-01-customer-responsiveness.mjs';
import { bc02CustomerFriction } from './bc-02-customer-friction.mjs';
import { blakeLeadWatch } from './blake-lead-watch.mjs';
import { bs01PrecallLauncher } from './bs-01-precall-launcher.mjs';
import { contractChaser } from './contract-chaser.mjs';
import { dailyPulse } from './daily-pulse.mjs';
import { messageDispatchSweeper } from './message-dispatch-sweeper.mjs';
import { commasInboxDrain } from './commas-inbox-drain.mjs';
import { hiringBenchSweeper } from './hiring-bench-sweeper.mjs';
import { hiringOutreachCadence } from './hiring-outreach-cadence.mjs';
import { waypointNudgeSweeper } from './waypoint-nudge-sweeper.mjs';
import { blueprintCloserReadySweeper } from './blueprint-closer-ready-sweeper.mjs';
import { financeOsPullSweeper } from './finance-os-pull-sweeper.mjs';
import { financeOsCardDueReminders } from './finance-os-card-due-reminders.mjs';
import { financeOsMoneyAgent } from './finance-os-money-agent.mjs';
import { plaidTransactionsSweeper } from './plaid-transactions-sweeper.mjs';
import { merchantPullSweeper } from './merchant-pull-sweeper.mjs';
import { blueprintNextFundingSequenceSweeper } from './blueprint-next-funding-sequence-sweeper.mjs';
import { blueprintFinanceOsAlerts } from './blueprint-finance-os-alerts.mjs';
import { paidCheckoutExpirySweeper } from './paid-checkout-expiry-sweeper.mjs';
import { affiliatePayoutRun } from './affiliate-payout-run.mjs';
import { meetTranscriptSweeper } from './meet-transcript-sweeper.mjs';
import { metaCampaignSyncSweeper } from './meta-campaign-sync-sweeper.mjs';
import { clickfunnelsAnalyticsSweeper } from './clickfunnels-analytics-sweeper.mjs';
import { watchCurveDiagnosisSweeper } from './watch-curve-diagnosis-sweeper.mjs';
import { subscriptionBillingSweeper } from './subscription-billing-sweeper.mjs';
import { partnerProductionFloorReview } from './partner-production-floor.mjs';
import { c00CrsSoftPullRequest } from './c-00-crs-soft-pull-request.mjs';
import { c02InquiryCreated } from './c-02-inquiry-created.mjs';
import { c02bInquiryRemovalRequested } from './c-02b-inquiry-removal-requested.mjs';
import { c03InquiryRemovedResumeOrHold } from './c-03-inquiry-removed-resume-or-hold.mjs';
import { c05PreFundingReview } from './c-05-pre-funding-review.mjs';
import { c06CrsResultsRouter } from './c-06-crs-results-router.mjs';
import { dpc01AnalyzerLock } from './dpc-01-analyzer-lock.mjs';
import { dpc02CallOutcomeEnforcement } from './dpc-02-call-outcome-enforcement.mjs';
import { dpc03InboundReplyRouter } from './dpc-03-inbound-reply-router.mjs';
import { dpc05NoProgressEscalation } from './dpc-05-no-progress-escalation.mjs';
import { ds01RepairReferral } from './ds-01-repair-referral.mjs';
import { ds02DiyLetters } from './ds-02-diy-letters.mjs';
import { f01FundingIntake } from './f-01-funding-intake.mjs';
import { f02PortalIdMissing } from './f-02-portal-id-missing.mjs';
import { f03RoundSubmitted } from './f-03-round-submitted.mjs';
import { f04RoundApprovals } from './f-04-round-approvals.mjs';
import { f05InquiryCleanupGate } from './f-05-inquiry-cleanup-gate.mjs';
import { f06FundingConditionsMissingDocs } from './f-06-funding-conditions-missing-docs.mjs';
import { f07FundingLocked } from './f-07-funding-locked.mjs';
import { f08PostFundingMonitoring } from './f-08-post-funding-monitoring.mjs';
import { f09FundingDeclinedNoPath } from './f-09-funding-declined-no-path.mjs';
import { f10ClientFundingInboxProvisioner } from './f-10-client-funding-inbox-provisioner.mjs';
import { f11BankEmailEventRouter } from './f-11-bank-email-event-router.mjs';
import { docCheck } from './doc-check.mjs';
import { docCheckRetrySweeper } from './doc-check-retry-sweeper.mjs';
import { inquiryCallSweeper } from './inquiry-call-sweeper.mjs';
import { n01ColdNurture } from './n-01-cold-nurture.mjs';
import { n02WarmNurture } from './n-02-warm-nurture.mjs';
import { n03HotNurture } from './n-03-hot-nurture.mjs';
import { n04PostFundingNurture } from './n-04-post-funding-nurture.mjs';
import { n06RenewalSecondWave } from './n-06-renewal-second-wave.mjs';
import { nextActionCatchUp } from './next-action-catch-up.mjs';
import { repairBureauResponseReader } from './repair-bureau-response.mjs';
import { roundStartedClientNotify } from './round-started-client-notify.mjs';
import { s01NewLeadIntake } from './s-01-new-lead-intake.mjs';
import { s00Welcome } from './s-00-welcome.mjs';
import { s02IncompleteSurveyNudge } from './s-02-incomplete-survey-nudge.mjs';
import { s04CallBooked } from './s-04-call-booked.mjs';
import { s04bBookingReminders } from './s-04b-booking-reminders.mjs';
import { s04cStaffBookedAlert } from './s-04c-staff-booked-alert.mjs';
import { sPortalInvite } from './s-portal-invite.mjs';
import { s05aNoShowRecovery } from './s-05a-no-show-recovery.mjs';
import { sNobookChase } from './s-nobook-chase.mjs';
import { s06PostCallFundingPurchased } from './s-06-post-call-funding-purchased.mjs';
import { sDocCollection } from './s-doc-collection.mjs';
import { s08PostCallFundingDeclined } from './s-08-post-call-funding-declined.mjs';
import { sOfferBucket } from './s-offer-bucket.mjs';
import { sloPackDelivery } from './slo-pack-delivery.mjs';
import { sloGenuineFollowup, sloGenuineReply, sloGenuineCheckoutSms } from './slo-genuine-followup.mjs';
import { sloPaidFormNudge } from './slo-paid-form-nudge.mjs';
import { sloNoReply197 } from './slo-no-reply-197.mjs';
import { sloInfiniteDrip } from './slo-infinite-drip.mjs';
import { sys01ClientValueCalculator } from './sys-01-client-value-calculator.mjs';
import { sys01LtvCalculator } from './sys-01-ltv-calculator.mjs';
import { u02AnalyzerCompleteDelivery } from './u-02-analyzer-complete-delivery.mjs';
import { u03CrsSnapshotSync } from './u-03-crs-snapshot-sync.mjs';
import { u04PromoteCrsPrimary } from './u-04-promote-crs-primary.mjs';
import { u05DataHealthMonitor } from './u-05-data-health-monitor.mjs';
import { metaCampaignSyncHourly } from './meta-campaign-sync-sweeper.mjs';

export const functions = [
  af01AffiliateDrip,
  af02ReferralOwnershipCapture,
  aiSet01JoshSetter,
  aiSet03NoAnswerCadence,
  aiSet043WayHandoff,
  arCollections,
  at01FirstTouchCapture,
  bc01CustomerResponsiveness,
  bc02CustomerFriction,
  /* Blake referral mail → staff text to Chris (name + phone). Never texts the lead. */
  blakeLeadWatch,
  bs01PrecallLauncher,
  /* Contracts — chase unsigned, daily.

     REGISTERING A FUNCTION IS NOT THE SEND SWITCH, but it is no longer a no-op
     either: INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are both set on the live
     deploy (verified by name 2026-08-19), the app is synced, and Inngest has
     executed functions in production. Anything in this array can run.

     The chaser also runs today WITHOUT Inngest, through
     /api/contracts { action: "run_reminders" } — see its header. */
  contractChaser,
  /* Daily pulse — 7:00 a.m. America/Denver all year (cron TZ=America/Denver 0 7 * * *).
     Audit only. Recon AG-07 runtime. Does not auto-fix. */
  dailyPulse,

  /* THE OUTBOUND DRAIN. Registered 2026-08-02, and it is the reason any client
     email leaves this platform at all — twenty-six workflows queue mail and
     until now nothing drained the queue.

     REGISTERING IT IS NOT THE SEND SWITCH. The switch is per company and lives in
     messaging_settings.outbound_enabled (119), visible and changeable in the
     CRM; src/messaging/outbox.mjs enforces it and a daily cap on every pass,
     scheduled or manual. The compliance gate runs on every message underneath
     both. And with no provider credentials nothing leaves whatever any of it
     says — that is the real control and always was.

     The file's own header carries the full reasoning for what moved. */
  messageDispatchSweeper,

  /* THE SECOND CLOCK UNDER THE PAYMENT QUEUE. Registered 2026-09-17.

     netlify/functions/commas-inbox-sweeper.mjs runs the identical pass on
     Netlify's cron and is unchanged. It had stopped firing: measured on live,
     six commas_inbox rows were sitting pending with attempts=0 — never even
     tried — two of them for two days, while the Inngest clock fired on schedule
     in the same hours. netlify.toml:104-117 records the same silent failure
     once before. A single clock under the money path is the defect.

     Running both is safe: claim() uses FOR UPDATE SKIP LOCKED so overlapping
     passes take different rows, and the inbox dedupes on the payment id before
     a row is written. A double pass cannot count a payment twice.

     REGISTERING IT SENDS NOTHING AND CHARGES NOTHING. It reads bytes Commas
     already delivered and hands them to the same processor. */
  commasInboxDrain,

  /* THE ONLY THING THAT ASKS "SHOULD WE BE HIRING" WITHOUT BEING ASKED FIRST.
     Registered 2026-09-05. src/hiring/bench.mjs has argued since 051 that
     recruiting has to be always-on — you notice the bench is thin when somebody
     quits, and then you hire needy — and nothing had ever run it. Its only door
     was GET /api/hiring/bench, a read-only screen docs/WIRING-AUDIT.md records
     as never called by any front end. So the always-on pipeline was on-demand.

     REGISTERING IT WRITES TASKS AND NOTHING ELSE. No candidate is contacted,
     advanced, ranked or rejected (051 forbids a software rejection outright), no
     job is posted, nothing is emailed or texted. Each alert routes through
     src/hiring/owner.mjs assigneeFor, so it lands with the sales manager or the
     owner per the rule in migration 294 rather than in one shared queue. The task
     dedupe key carries the date, so the ceiling is one task per role per day
     whatever the schedule says.

     NOT SCHEDULED, DELIBERATELY: src/ops/hire-closer.mjs actOnPacked — the
     packed-calendar rule. It is closer-only, it routes past the resolver, and
     every run posts to LinkedIn, which has no partner access. It stays behind
     POST /api/ops/hire-closer where a human presses it. The sweeper's header
     carries the full reasoning. */
  hiringBenchSweeper,

  /* Candidate follow-up, every 30 minutes. Registered 2026-09-05, the same day
     the public apply door opened — an applicant who hears nothing is the whole
     reason a bench goes cold, and until now nothing in this platform ever
     contacted a candidate at all.

     REGISTERING IT IS NOT THE SEND SWITCH. sendTemplated only writes a
     'queued' row; src/messaging/dispatch.mjs hands those to a provider, and it
     is governed by messaging_settings.outbound_enabled per company plus the
     MESSAGING_DRY_RUN fence, both of which sit underneath this and neither of
     which this changes. The cadence also stops itself on a reply, on a booking
     and on an opt-out — a follow-up sequence with no exit is a complaint
     generator, so the exits are tested rather than assumed. */
  hiringOutreachCadence,

  /* THE OVERDUE-CHECKLIST CHASE. Registered 2026-09-06, hourly.

     A client with a waypoint they own and have not done hears nothing today.
     The progress page shows it, and that is all — nothing in this platform ever
     reaches out about a checklist row going overdue.

     REGISTERING IT WRITES A QUEUED ROW AND NOTHING ELSE. src/nudge/run.mjs
     calls sendTemplated, which writes `messages` with status='queued'; the
     dispatcher sends, behind the per-company outbound switch and the compliance
     gate, exactly as it does for every other workflow here.

     WHAT STOPS IT RUNNING AWAY IS IN THE DATABASE, NOT IN THE SCHEDULER.
     db/migrations/371_waypoint_nudges.sql carries UNIQUE (waypoint_id, step)
     with step CHECKed to 1..4 — a fifth message about one waypoint is
     unwritable — and a partial UNIQUE (client_id, client_local_date) capping
     every client at one client-facing message per day across all their
     waypoints. Both are written BEFORE anything is queued, so duplicate
     triggers, replays, retries and two schedulers all collapse to one send.
     That is the direct fix for 2026-09-03, when a chase loop sent 51 identical
     texts to one phone in two hours.

     It only ever chases owner_kind='client' rows. A waypoint FundHub owes is
     never chased, and the last rung is a staff task rather than a fourth
     message. */
  waypointNudgeSweeper,
  blueprintCloserReadySweeper,
  financeOsPullSweeper,
  /* CARD DUE REMINDERS (Finance OS, 2026-10-06). Daily: reads card bills from
     Plaid, then queues one text per card per due date, 0-3 days out, when no
     payment is on file. Never moves money. Keyed in cashflow_reminders and in
     messages.provider_ref so a retry cannot send twice. */
  financeOsCardDueReminders,
  /* MONEY HELPER (Finance OS wave 2, 2026-10-06). Daily, after the card due
     texts: Clarity Payments (money owed to Fundhub, incl. BNPL) and card bills
     already past due get one ladder step each — reminder, late check-in,
     second check-in, then a CSM task and no more texts. Rules only, no AI
     call. Claimed in money_agent_log before anything is queued. */
  financeOsMoneyAgent,
  /* Daily Plaid charges + deposits pull, then repeating-bill detection, for every
     client with an active consented Plaid login. Reads only; does nothing when
     Plaid is not configured. Finance OS build 2026-10-06, unit A. */
  plaidTransactionsSweeper,
  /* Daily merchant processing pull (Finance OS wave 4b, unit H5, 2026-10-06):
     every client connection set to "Paste your API key" (Commas, Whop) is read
     with the client's own key into merchant_events. GET only, behind the
     ADAPTERS fence; moves no money and sends nothing to anyone. */
  merchantPullSweeper,
  blueprintNextFundingSequenceSweeper,
  blueprintFinanceOsAlerts,

  /* THE END OF A CHECKOUT INVITATION. Registered 2026-09-06, and it is the
     other half of the sweeper above.

     Nothing in this repository ever ended a paid_service_requests row sitting
     at 'awaiting_payment'. The payment webhook could, and
     docs/journeys/paid-round-actual.md records that the payment handler is not
     on the live bus — so in the shipped product the row was permanent. The
     chase ladder was suspending a client's whole overdue checklist behind it,
     on the stated ground that "a checkout link is out; it expires; then we
     chase again". It did not expire. Measured: 200 such clients starved a live
     one to zero messages, that day and a year later.

     Now the invitation carries a deadline in the data
     (paid_service_requests.checkout_expires_at, db/migrations/370, seven days
     from src/paid-services/checkout.mjs) and this pass is what closes it —
     status 'cancelled', state_reason 'checkout_expired'.

     IT MOVES NO MONEY. A row at awaiting_payment has never been charged; a
     hosted link is an invitation, not a payment. Cancelling one takes nothing
     from anybody and creates no refund. It frees the client to ask for the same
     round again, which is right, because the link they were given is dead.

     COMPLIANCE REVIEW REQUIRED: payment rails and fee timing. */
  paidCheckoutExpirySweeper,

  /* THE AFFILIATE PAYOUT RUN. Registered 2026-09-21, and it closes the second
     half of a feature that has been sold as whole since August.

     Commission accrued correctly onto affiliate_referrals.commission_due from
     2026-08-31 and NOTHING EVER BATCHED IT. Measured 2026-09-20: every single
     INSERT into affiliate_payouts or affiliate_payout_lines in this repository
     was a test fixture or demo seed data — no workflow, no sweeper, no endpoint
     and no script wrote one. So an affiliate's balance grew for ever and there
     was no object in the system that could be paid.

     IT MOVES NO MONEY. It writes 'pending' and 'held' rows. Moving one to
     'processing' or 'paid' is a human action against a payment rail this repo
     does not have, and affiliate_payouts_guard() in 033_affiliates.sql refuses
     that move for any affiliate without a signed partner license no matter who
     asks. Double-paying is prevented by the schema, not by this code:
     affiliate_payout_lines_commission_once is a unique index on referral_id.

     Owner-set 2026-09-21: monthly over the previous whole calendar month, $50
     minimum with anything under it rolling forward untouched, and an unsigned
     license or missing tax form creating the run 'held' rather than skipping
     it, so the money stays counted and visible while it cannot leave.

     COMPLIANCE REVIEW REQUIRED: payment rails. */
  affiliatePayoutRun,

  meetTranscriptSweeper,

  /* THE CLOCK BEHIND THE AD VIDEO PIPELINE. Every five minutes.

     Looks in the Raw Drive folder for a take Chris just filmed, then moves every
     ad_videos row one step: stage → Submagic → read the words → match the script
     and rename the file → place OUR b-roll → export → buzz the phone → after he
     approves, into Paul's folder.

     REGISTERING IT SENDS NOTHING. Submagic and Drive sit behind ADAPTERS_DRY_RUN
     and the phone behind MESSAGING_DRY_RUN, both of which default to BLOCKED
     (src/lib/dry-run.mjs), and with DRIVE_RAW_FOLDER_ID unset it watches nothing
     at all. Every pass is one bounded batch — export is capped at 50 an hour and
     an update costs another, so a runaway pass would cost real money. */
  /* adVideoSweeper is NOT registered here, on purpose (2026-09-23).

     It runs as a Netlify scheduled function instead — netlify/functions/
     ad-video-sweeper.mjs — because a pass moves a whole video file and an
     Inngest pass runs inside the synchronous /api/inngest request, which
     Netlify kills at 26 seconds. Measured on production: the first 120 MB take
     was killed mid-upload and stopped dead. A scheduled function gets 15
     minutes.

     Registering it here again would also mean two crons racing for the same
     take. The workflow module stays exactly where it is and the Netlify
     function calls its sweep() — same code, more time. */

  /* THE CLOCK BEHIND THE META PULL. Registered 2026-09-09, daily at 07:00 UTC.

     Until now NOTHING ran api/campaigns/sync.mjs on a schedule — grepped: the
     route map, the pulse registry and its own tests were the only mentions. A
     person pressing Sync on the campaigns screen was the entire mechanism. And
     the pull only reached back seven days, so eight days without a press meant
     day eight could never be asked for again. Meta still holds it; this
     platform would never ask. The screens then read the missing row as zero, so
     "nobody looked" and "we spent nothing" drew the identical chart.

     Both halves are needed and both landed together: the window is now 28 days
     (INSIGHT_WINDOW_DAYS), so a missed week is still recoverable and Meta's own
     restatements are picked up; and this runs the pull without anyone asking.

     REGISTERING IT SENDS NOTHING AND SPENDS NOTHING. It READS from Meta and
     writes our own campaigns / ad_sets / ads / ad_metrics_daily rows. No
     campaign is created, started, paused or re-budgeted — that is
     api/campaigns/write.mjs, a button a person presses, untouched by this. Days
     that are pulled again overwrite themselves through
     ON CONFLICT (ad_id, date), so nothing double-counts.

     One partner's broken connection never stops the pass: each is caught on its
     own and recorded against that connection's last_error, which is what the
     screen already shows. */
  metaCampaignSyncSweeper,
  clickfunnelsAnalyticsSweeper,

  /* THE NEXT-TAKE TABLE'S CLOCK. Registered 2026-10-05, daily at 07:30 UTC,
     half an hour after the Meta pull above. ad_watch_curve_diagnoses (395) had
     0 rows: nothing ever wrote it. This labels each saved ad-day opening /
     middle / ask with a fix type and a film note, by the watch-curve law. It
     reads saved rows only and writes only that table — no Meta call, no text,
     no campaign or budget change, and it never overwrites a row. */
  watchCurveDiagnosisSweeper,

  /* THE RECURRING BILLING RAIL. Registered 2026-08-31. Until it, nothing in
     this platform charged a card on a cycle: 075_subscriptions.sql recorded the
     arrangement and said so in its own header, so a client or a partner could
     sit `active` on a priced plan that never billed and nothing could tell the
     difference between that and one that was paid up.

     REGISTERING IT DOES NOT CHARGE ANYBODY, and that is the state of the
     processor rather than a disclaimer. Commas' confirmed surface is
     GET /payments/:id and POST /checkout-sessions — a read and a link a human
     clicks. There is no merchant-initiated "charge the stored token" call, so
     src/subscriptions/charger.mjs ships with an EMPTY charge registry and every
     pass reports "N due, N skipped, no charger configured".

     Two locks in front of the day one exists: a charger has to be registered,
     AND SUBSCRIPTION_BILLING_ENABLED must be exactly "true". The same gate
     message-dispatch-sweeper.mjs describes — it moves, it does not disappear.

     COMPLIANCE REVIEW REQUIRED: payment rails and fee timing. */
  subscriptionBillingSweeper,

  /* THE ONLY FILTER ON THE PARTNER BASE. Registered 2026-08-31. The $10,000 entry
     fee is financeable down to a 405 FICO (W0-decisions.md), so entry screens
     nobody and production is the whole quality control: ten funding clients a
     month, on the ladder in W1-money-model.md §6. Runs on the 1st.

     REGISTERING IT CAN LOWER A PARTNER'S SHARE FROM 50 TO 20 — and cannot restate
     one cent already earned, because partner_revenue.share_pct_applied is frozen
     on every row (042). It also reaches nobody until a partner has an
     activated_at: every partner active before 282 has that column NULL on purpose,
     and src/partners/floors.mjs refuses to score a partner whose start date is
     unknown rather than guessing it.

     It never touches partners.status — 'paused' blocks payouts through 042's
     trigger, which would withhold money the partner genuinely earned.

     COMPLIANCE REVIEW REQUIRED: automatic change to a revenue-share percentage. */
  partnerProductionFloorReview,
  c00CrsSoftPullRequest,
  c02InquiryCreated,
  c02bInquiryRemovalRequested,
  c03InquiryRemovedResumeOrHold,
  c05PreFundingReview,
  c06CrsResultsRouter,
  dpc01AnalyzerLock,
  dpc02CallOutcomeEnforcement,
  dpc03InboundReplyRouter,
  dpc05NoProgressEscalation,
  ds01RepairReferral,
  ds02DiyLetters,
  f01FundingIntake,
  f02PortalIdMissing,
  f03RoundSubmitted,
  f04RoundApprovals,
  f05InquiryCleanupGate,
  f06FundingConditionsMissingDocs,
  f07FundingLocked,
  f08PostFundingMonitoring,
  f09FundingDeclinedNoPath,
  f10ClientFundingInboxProvisioner,
  f11BankEmailEventRouter,
  docCheck,
  /* THE CLOCK THAT COMES BACK FOR AN UNREAD DOCUMENT. Registered 2026-09-17.

     Measured on the live walk 2026-09-16: eight uploads, eight answers of
     `openai 429 … no credits remaining`, and nothing anywhere holding a note to
     look again. Topping the account up would not have fixed it — with no new
     upload there is no docs.received and so no reader. Dispute letters cannot
     stage until a client's ID has been read, so an empty wallet froze credit
     repair for everyone who uploaded during it, indefinitely.

     REGISTERING IT READS DOCUMENTS ALREADY UPLOADED AND NOTHING ELSE. It claims
     only failed_events rows whose handler is 'doc-check' — never another
     handler's queued failure — and it invents no identity: a document it still
     cannot read leaves the client's verified name and address exactly as they
     were, and after twelve tries over about nine days it stops and asks a
     person. */
  docCheckRetrySweeper,
  /* Bureau dispute calls, every 15 minutes. Its own header said "not registered
     until owner enables the schedule" — that gate was implemented as "leave it
     out of this array", which made it invisible on the Automations screen and
     is the drift index.test.mjs now guards against. Owner enabled it
     2026-08-19. It places real calls. */
  inquiryCallSweeper,
  n01ColdNurture,
  n02WarmNurture,
  n03HotNurture,
  n04PostFundingNurture,
  n06RenewalSecondWave,
  /* THE SAVED NEXT STEP FOLLOWS THE SCREEN. Registered 2026-09-18 (hole 12).
     Every five minutes, for files that already hold a saved step
     (custom_fields.employee_next_action), work out the step the Client Control
     Panel shows and save it only when it differs. Measured live: all six saved
     steps disagreed with the panel, because card moves, inquiry cases and
     credit reports change the panel's step with no save at all.

     REGISTERING IT SENDS NOTHING. It reads, and it writes that one key on
     files that already have one — no message, no event, no task, no card. */
  nextActionCatchUp,
  repairBureauResponseReader,
  roundStartedClientNotify,
  s01NewLeadIntake,
  s00Welcome,
  /* Chases a lead who started an application and stopped: 20-minute sleep, then
     one nudge email if survey.submitted has not fired. entry.captured has 400
     rows and nothing was listening. Owner enabled it 2026-08-19. It emails real
     leads (subject to messaging_settings.outbound_enabled and the live fence). */
  s02IncompleteSurveyNudge,
  s04CallBooked,
  s04bBookingReminders,
  s04cStaffBookedAlert,
  sPortalInvite,
  sNobookChase,
  s05aNoShowRecovery,
  s06PostCallFundingPurchased,
  sDocCollection,
  s08PostCallFundingDeclined,
  sOfferBucket,
  sloPackDelivery,
  /* Genuine text/email after /roadmap contact and no $297 pay. Message 2 only
     after message.inbound. Never texts actor=agent or test emails. */
  sloGenuineFollowup,
  sloGenuineReply,
  sloGenuineCheckoutSms,
  /* One text and email when a real $297 payment still has an empty soft-pull form. */
  sloPaidFormNudge,
  sloInfiniteDrip,
  sloNoReply197,
  sys01ClientValueCalculator,
  sys01LtvCalculator,
  u02AnalyzerCompleteDelivery,
  u03CrsSnapshotSync,
  u04PromoteCrsPrimary,
  u05DataHealthMonitor,
  /* THE HOURLY META PULL (marketing machine M0 step 5, 2026-10-05). At minute
     30 of every hour it runs the same sync as metaCampaignSyncSweeper above,
     for today in Arizona and the 2 days before — never the whole history —
     so the Command Center's numbers are at most an hour old. The nightly
     28-day pass above is unchanged. It READS from Meta and writes our own
     campaign / ad / ad_metrics_daily rows; no campaign is created, started,
     paused or re-budgeted. */
  metaCampaignSyncHourly,
];
