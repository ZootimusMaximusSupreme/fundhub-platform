import { registerRepairHandlers } from '../repair/register.mjs';
import { scheduled } from './scheduled.mjs';
registerRepairHandlers();
import { arCollections } from './ar-collections.mjs';
import { af02ReferralOwnershipCapture } from './af-02-referral-ownership-capture.mjs';
import { aiSet01JoshSetter } from './ai-set-01-josh-setter.mjs';
import { aiSet03NoAnswerCadence } from './ai-set-03-no-answer-cadence.mjs';
import { aiSet043WayHandoff } from './ai-set-04-3way-handoff.mjs';
import { at01FirstTouchCapture } from './at-01-first-touch-capture.mjs';
import { bc01CustomerResponsiveness } from './bc-01-customer-responsiveness.mjs';
import { bc02CustomerFriction } from './bc-02-customer-friction.mjs';
import { bs01PrecallLauncher } from './bs-01-precall-launcher.mjs';
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
import { n01ColdNurture } from './n-01-cold-nurture.mjs';
import { n02WarmNurture } from './n-02-warm-nurture.mjs';
import { n03HotNurture } from './n-03-hot-nurture.mjs';
import { n04PostFundingNurture } from './n-04-post-funding-nurture.mjs';
import { n06RenewalSecondWave } from './n-06-renewal-second-wave.mjs';
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
import { sys01ClientValueCalculator } from './sys-01-client-value-calculator.mjs';
import { sys01LtvCalculator } from './sys-01-ltv-calculator.mjs';
import { u02AnalyzerCompleteDelivery } from './u-02-analyzer-complete-delivery.mjs';
import { u03CrsSnapshotSync } from './u-03-crs-snapshot-sync.mjs';
import { u04PromoteCrsPrimary } from './u-04-promote-crs-primary.mjs';
import { u05DataHealthMonitor } from './u-05-data-health-monitor.mjs';

/* SERVED TO INNGEST: EVENT WORKFLOWS ONLY. No cron is served to Inngest (owner, 2026-10-20:
   "ingest is maxed out i cant afford 99 a month, stop burning ingests"). The free plan is 50,000
   executions a month and the crons alone cost about 300,000. api/inngest.mjs serves this list and
   nothing else; index.test.mjs fails if a cron trigger comes back into it.
   Board: ops/workflows/inngest-diet-2026-10-20.md */
export const inngestFunctions = [
  af02ReferralOwnershipCapture,
  aiSet01JoshSetter,
  aiSet03NoAnswerCadence,
  aiSet043WayHandoff,
  arCollections,
  at01FirstTouchCapture,
  bc01CustomerResponsiveness,
  bc02CustomerFriction,
  bs01PrecallLauncher,
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
  n01ColdNurture,
  n02WarmNurture,
  n03HotNurture,
  n04PostFundingNurture,
  n06RenewalSecondWave,
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
  sloNoReply197,
  sys01ClientValueCalculator,
  sys01LtvCalculator,
  u02AnalyzerCompleteDelivery,
  u03CrsSnapshotSync,
  u04PromoteCrsPrimary,
  u05DataHealthMonitor,
];

/* EVERY WORKFLOW: the event workflows Inngest runs, plus the scheduled jobs the Netlify clock runs
   (src/workflows/scheduled.mjs — same ids, schedules and handlers they had on Inngest). This is
   the registry every reader uses: the Automations screen, the pulse, the tripwire map, the journey
   runner. It is NOT what Inngest is given; that is inngestFunctions above. */
export const functions = [...inngestFunctions, ...scheduled];

export { scheduled };
