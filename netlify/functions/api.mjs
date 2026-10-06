// Netlify adapter for the platform's Vercel-style api/ handlers.
//
// One function serves every /api/* path (config.path below). It builds a
// minimal (req, res) pair around the Web Request, calls the exact same
// handler module Vercel would, and converts the captured result into a
// Response. Handlers here only ever use res.status().json() / setHeader /
// end, so the shim implements that surface plus send() for safety.
//
// Zero changes to the handlers themselves — this file is the only
// Netlify-specific code in the repo.
//
// THIS FILE IS A ROUTING TABLE, AND A ROUTING TABLE IS A PLACE THINGS GET LOST.
// Twice now a feature has been built end to end — handler, service module, tests,
// migration — and then never reached a caller, because nobody added the one line
// here. AUDIT-FINDINGS.md records the first: /api/inngest was absent, so all 47
// workflow functions were unreachable while the operator was told the only
// remaining gate was an unset key. The lesson it draws — "a structural check can
// pass over a half-dead feature" — is exactly right, and it recurred: 21 handler
// files under api/ were missing from ROUTES and answered 404 on every method, on
// the deploy target AND under scripts/dev-server.mjs, which proxies /api/*
// through this same module.
//
// So ROUTES and routePath are EXPORTED, and src/http/routes.test.mjs walks api/
// on disk and fails if a handler file is neither routed nor on its explicit,
// commented ALLOWED-UNROUTED list. That test is the actual fix; the entries below
// are just this round's backlog. Adding a file under api/ now breaks the build
// until someone decides, in writing, whether it is reachable.

import { safeError } from "../../src/http/health.mjs";
// Keep fontkit and pg in the function zip. esbuild leaves both external;
// without these imports the whole /api/* function 502s (health, login, Start D1).
import "@pdf-lib/fontkit";
import "pg";
import authLogin from "../../api/auth/login.mjs";
import authLogout from "../../api/auth/logout.mjs";
import authSession from "../../api/auth/session.mjs";
import authReset from "../../api/auth/reset.mjs";
import authAdminReset from "../../api/auth/admin-reset.mjs";
import authSendPortalLink from "../../api/auth/send-portal-link.mjs";
import authAuthorizedRep from "../../api/auth/authorized-rep.mjs";
import authAuthorizedRepFile from "../../api/auth/authorized-rep-file.mjs";
import authInvite from "../../api/auth/invite.mjs";
import authStaffRole from "../../api/auth/staff-role.mjs";
import authStaffUpdate from "../../api/auth/staff-update.mjs";
import authSuspend from "../../api/auth/suspend.mjs";
import authMagicLink from "../../api/auth/magic-link.mjs";
import authMagicLinkVerify from "../../api/auth/magic-link-verify.mjs";
import journeysAsk from "../../api/journeys/ask.mjs";
import journeysRun from "../../api/journeys/run.mjs";
import journeysStore from "../../api/journeys.mjs";
import messageTemplatesWrite from "../../api/message-templates.mjs";
import tasks from "../../api/tasks.mjs";
import messagesWrite from "../../api/messages.mjs";
import inquiry from "../../api/inquiry.mjs";
import dashClients from "../../api/dashboard/clients.mjs";
import dashClient from "../../api/dashboard/client.mjs";
import dashPipeline from "../../api/dashboard/pipeline.mjs";
import dashPipelineCounts from "../../api/dashboard/pipeline-counts.mjs";
import dashSeed from "../../api/dashboard/seed.mjs";
import dashKpis from "../../api/dashboard/kpis.mjs";
import dashClientArchive from "../../api/dashboard/client-archive.mjs";
import health from "../../api/health.mjs";
import partnerBrand from "../../api/partner-brand.mjs";
import orgBrand from "../../api/org-brand.mjs";
import webhooks from "../../api/webhooks/[provider].mjs";
import readCommissions from "../../api/read/commissions.mjs";
import readInvoices from "../../api/read/invoices.mjs";
import readDocuments from "../../api/read/documents.mjs";
import readBankInbox from "../../api/read/bank-inbox.mjs";
import readBlueprintCombinedApproval from "../../api/read/blueprint-combined-approval.mjs";
import blueprintStaffActions from "../../api/blueprint/staff-actions.mjs";
import readFundingRounds from "../../api/read/funding-rounds.mjs";
import readAffiliates from "../../api/read/affiliates.mjs";
import readAffiliatePortal from "../../api/read/affiliate-portal.mjs";
import affiliatesRefer from "../../api/affiliates/refer.mjs";
import readPartners from "../../api/read/partners.mjs";
import readPartnerProduction from "../../api/read/partner-production.mjs";
import readPartnerHomeTiles from "../../api/read/partner-home-tiles.mjs";
import readPartnerTraining from "../../api/read/partner-training.mjs";
import readMessageTemplates from "../../api/read/message-templates.mjs";
import readStaff from "../../api/read/staff.mjs";
import staffTelemetry from "../../api/staff/telemetry.mjs";
import staffMonitoringConsent from "../../api/staff/monitoring-consent.mjs";
import staffAvatar from "../../api/staff/avatar.mjs";
import readEntitlements from "../../api/read/entitlements.mjs";
import readFailedEvents from "../../api/read/failed-events.mjs";
import readAgents from "../../api/read/agents.mjs";
import readAgentContext from "../../api/read/agent-context.mjs";
import readAgentShadowLog from "../../api/read/agent-shadow-log.mjs";
import readInquiries from "../../api/read/inquiries.mjs";
import readProducts from "../../api/read/products.mjs";
import readSloConnections from "../../api/read/slo-connections.mjs";
import readConversations from "../../api/read/conversations.mjs";
import readInbox from "../../api/read/inbox.mjs";
import readMessages from "../../api/read/messages.mjs";
import readSearch from "../../api/read/search.mjs";
import readTradelines from "../../api/read/tradelines.mjs";
import readFinanceOs from "../../api/read/finance-os.mjs";
import readFinanceOsSuggestions from "../../api/read/finance-os-suggestions.mjs";
import readBankingSurface from "../../api/read/banking-surface.mjs";
import readUnderwrite from "../../api/read/underwrite.mjs";
import readMoneyMap from "../../api/read/money-map.mjs";
import readFinanceCommand from "../../api/read/finance-command.mjs";
import readFinanceAsk from "../../api/read/finance-ask.mjs";
import readCompanyBrain from "../../api/read/company-brain.mjs";
import readCompanyBrainAffiliate from "../../api/read/company-brain-affiliate.mjs";
import readOpsPulse from "../../api/read/ops-pulse.mjs";
import opsHireCloser from "../../api/ops/hire-closer.mjs";
import companyBrainReviews from "../../api/company-brain/reviews.mjs";
import companyBrainSync from "../../api/company-brain/sync.mjs";
import companyBrainUpload from "../../api/company-brain/upload.mjs";
import companyBrainThreads from "../../api/company-brain/threads.mjs";
import readWorkflows from "../../api/read/workflows.mjs";
import readTransactions from "../../api/read/transactions.mjs";
import readCloserCall from "../../api/read/closer-call.mjs";
import readCloserNow from "../../api/read/closer-now.mjs";
import readDealMath from "../../api/read/deal-math.mjs";
import readCloserDeck from "../../api/read/closer-deck.mjs";
import readAdAttribution from "../../api/read/ad-attribution.mjs";
import readAdBooks from "../../api/read/ad-books.mjs";
import readAdSpine from "../../api/read/ad-spine.mjs";
import scriptsWrite from "../../api/scripts/write.mjs";
import scriptsList from "../../api/scripts/list.mjs";
import clickfunnelsConnect from "../../api/analytics/clickfunnels-connect.mjs";
import clickfunnelsSync from "../../api/analytics/clickfunnels-sync.mjs";
import readFunnelPages from "../../api/read/funnel-pages.mjs";
import youtubeConnect from "../../api/analytics/youtube-connect.mjs";
import youtubeSync from "../../api/analytics/youtube-sync.mjs";
import readVideoStats from "../../api/read/video-stats.mjs";
import opsWeeklyBrief from "../../api/ops/weekly-brief.mjs";
import closerDeckWrite from "../../api/closer-deck.mjs";
import readMyNumbers from "../../api/read/my-numbers.mjs";
import readSalesFloor from "../../api/read/sales-floor.mjs";
import readCompanyActivity from "../../api/read/company-activity.mjs";
import readCallOutcomes from "../../api/read/call-outcomes.mjs";
import readUnrecordedCalls from "../../api/read/unrecorded-calls.mjs";
import callOutcomesWrite from "../../api/call-outcomes.mjs";
import readCustomerInsights from "../../api/read/customer-insights.mjs";
import readCsmQueue from "../../api/read/csm-queue.mjs";
import customerInsightsWrite from "../../api/customer-insights.mjs";
import marketingFlagsWrite from "../../api/marketing-flags.mjs";
import marketingToday from "../../api/marketing/today.mjs";
import bankingSyncAccounts from "../../api/banking/sync-accounts.mjs";
import inquiries from "../../api/inquiries.mjs";
import repairExceptions from "../../api/repair/exceptions.mjs";
import repairEnroll from "../../api/repair/enroll.mjs";
import repairGenerate from "../../api/repair/generate.mjs";
import repairSend from "../../api/repair/send.mjs";
import repairInboundMail from "../../api/repair/inbound-mail.mjs";
import pii from "../../api/pii.mjs";
import shifts from "../../api/shifts.mjs";
import bookings from "../../api/bookings.mjs";
import campaignsList from "../../api/campaigns/list.mjs";
import campaignsDetail from "../../api/campaigns/detail.mjs";
import campaignsSpend from "../../api/campaigns/spend.mjs";
import campaignsFatigue from "../../api/campaigns/fatigue.mjs";
import campaignsConnections from "../../api/campaigns/connections.mjs";
import campaignsActionLog from "../../api/campaigns/action-log.mjs";
import campaignsSync from "../../api/campaigns/sync.mjs";
import campaignsWrite from "../../api/campaigns/write.mjs";
import campaignsMetaAgency from "../../api/campaigns/meta-agency.mjs";
import campaignsLinkAsset from "../../api/campaigns/link-asset.mjs";
import socialSchedule from "../../api/social/schedule.mjs";
import socialPublish from "../../api/social/publish.mjs";
import socialOauth from "../../api/social/oauth.mjs";
import socialPosts from "../../api/social/posts.mjs";
import socialGenerate from "../../api/social/generate.mjs";
import socialChannels from "../../api/social/channels.mjs";
import socialSettings from "../../api/social/settings.mjs";
import brandReview from "../../api/brand/review.mjs";
import chatAsk from "../../api/chat/ask.mjs";
import chatMessages from "../../api/chat/messages.mjs";
import chatPortalMessage from "../../api/chat/portal-message.mjs";
import chatPeers from "../../api/chat/peers.mjs";
import demoSimulate from "../../api/demo/simulate.mjs";
import demoMode from "../../api/demo/mode.mjs";
import partnerPages from "../../api/partner-pages.mjs";
import partnersApprove from "../../api/partners/approve.mjs";
import partnerBrandVerifyDomain from "../../api/partner-brand/verify-domain.mjs";
import partnerMarketingEnable from "../../api/partner-marketing/enable.mjs";
import partnerMarketingUsage from "../../api/partner-marketing/usage.mjs";
import partnerMarketingGenerateCopy from "../../api/partner-marketing/generate-copy.mjs";
import partnerMarketingCopyHistory from "../../api/partner-marketing/copy-history.mjs";
import partnerMarketingGenerateLogo from "../../api/partner-marketing/generate-logo.mjs";
import messageBlasterGift from "../../api/gifts/message-blaster.mjs";
import publicPartnerPage from "../../api/public/partner-page.mjs";
import publicSurveySubmit from "../../api/public/survey-submit.mjs";
import publicEducationEnroll from "../../api/public/education-enroll.mjs";
import publicOptimize from "../../api/public/optimize.mjs";
import publicClimateMatch from "../../api/public/climate-match.mjs";
import publicPartnerApply from "../../api/public/partner-apply.mjs";
import publicFunnelCheckout from "../../api/public/funnel-checkout.mjs";
import publicSloCheckout from "../../api/public/slo-checkout.mjs";
import publicSloInterest from "../../api/public/slo-interest.mjs";
import publicSloPull from "../../api/public/slo-pull.mjs";
import publicSloStatus from "../../api/public/slo-status.mjs";
import publicSloRepairCheckout from "../../api/public/slo-repair-checkout.mjs";
import publicRb2bWebhook from "../../api/public/rb2b-webhook.mjs";
import trialsEligibility from "../../api/trials/eligibility.mjs";
import trialsProvision from "../../api/trials/provision.mjs";
import trialsDashboard from "../../api/trials/dashboard.mjs";
import trialsConvert from "../../api/trials/convert.mjs";
import publicDeclineAutopsy from "../../api/public/decline-autopsy.mjs";
import publicDeclineAutopsyUpload from "../../api/public/decline-autopsy-upload.mjs";
import publicDeclineAutopsyReport from "../../api/public/decline-autopsy-report.mjs";
import publicUnsubscribe from "../../api/public/unsubscribe.mjs";
import publicEeoSurvey from "../../api/public/eeo-survey.mjs";
import publicAffiliateClick from "../../api/public/affiliate-click.mjs";
import publicVslWatch from "../../api/public/vsl-watch.mjs";
import adVideos from "../../api/ad-videos.mjs";
import publicAdVideoApprove from "../../api/public/ad-video-approve.mjs";
import creativeGenerate from "../../api/creative/generate.mjs";
import creativeLibrary from "../../api/creative/library.mjs";
import creativeBrandKits from "../../api/creative/brand-kits.mjs";
import creativeJobs from "../../api/creative/jobs.mjs";
import creativeApprovals from "../../api/creative/approvals.mjs";
import creativeActions from "../../api/creative/actions.mjs";
import creativeRun from "../../api/creative/run.mjs";
import marketingOfferGenerate from "../../api/marketing/offer/generate.mjs";
import adintelBoard from "../../api/adintel/board.mjs";
import contentTiles from "../../api/content/tiles.mjs";
import contentUpload from "../../api/content/upload.mjs";
import contentWelcomeVideo from "../../api/content/welcome-video.mjs";
import hiringCandidates from "../../api/hiring/candidates.mjs";
import hiringApplication from "../../api/hiring/application.mjs";
import hiringPostings from "../../api/hiring/postings.mjs";
import hiringDecisions from "../../api/hiring/decisions.mjs";
import hiringFunnel from "../../api/hiring/funnel.mjs";
import hiringBench from "../../api/hiring/bench.mjs";
import hiringDecide from "../../api/hiring/decide.mjs";
import hiringApply from "../../api/hiring/apply.mjs";
import financeSoftPull from "../../api/finance/soft-pull.mjs";
import financeCrsPull from "../../api/finance/crs-pull.mjs";
import bankingRevoke from "../../api/banking/revoke.mjs";
import privacyErasure from "../../api/privacy/erasure.mjs";
import financeSubscriptions from "../../api/finance/subscriptions.mjs";
import partnerAddOns from "../../api/partner-addons.mjs";
import trainingProgress from "../../api/training-progress.mjs";
import financeCards from "../../api/finance/cards.mjs";
import financeLiabilities from "../../api/finance/liabilities.mjs";
import financeBankAccounts from "../../api/finance/bank-accounts.mjs";
import financeEntities from "../../api/finance/entities.mjs";
import financeBills from "../../api/finance/bills.mjs";
import financeCashflow from "../../api/finance/cashflow.mjs";
import financeAlerts from "../../api/finance/alerts.mjs";
import financeModel from "../../api/finance/model.mjs";
import financePaydownSimulator from "../../api/finance/paydown-simulator.mjs";
import bankingAccounts from "../../api/banking/accounts.mjs";
import consentCapture from "../../api/consent/capture.mjs";
import softPullApprove from "../../api/soft-pull-approve.mjs";
import { webHandler as inngestWeb } from "../../api/inngest.mjs";
import documentById from "../../api/documents/[id].mjs";
import documentsUpload from "../../api/documents-upload.mjs";
import documentsDownload from "../../api/documents-download.mjs";
import paymentLinks from "../../api/payment-links.mjs";
import paidServices from "../../api/paid-services.mjs";
import waypointTick from "../../api/waypoint-tick.mjs";
import pushKey from "../../api/push/key.mjs";
import pushSubscribe from "../../api/push/subscribe.mjs";
import pushUnsubscribe from "../../api/push/unsubscribe.mjs";
import contracts from "../../api/contracts.mjs";
import readContracts from "../../api/read/contracts.mjs";
import readPortalContracts from "../../api/read/portal-contracts.mjs";
import readPortalSummary from "../../api/read/portal-summary.mjs";
import readClientProgress from "../../api/read/client-progress.mjs";
import contractsSign from "../../api/contracts/sign.mjs";
import messagesOutbound from "../../api/messages-outbound.mjs";
import agentsWrite from "../../api/agents.mjs";
import agentCall from "../../api/agent-call.mjs";
import pipelineCards from "../../api/pipeline-cards.mjs";
import pipelineClients from "../../api/pipeline-clients.mjs";
import productsWrite from "../../api/products.mjs";
import sloConnectionsWrite from "../../api/slo-connections.mjs";
import clientNotes from "../../api/client-notes.mjs";
import commissionRules from "../../api/commission-rules.mjs";
import commissionsWrite from "../../api/commissions.mjs";
import lendersWrite from "../../api/lenders.mjs";
import lenderObservationsWrite from "../../api/lender-observations.mjs";
import applicationsWrite from "../../api/applications.mjs";
import inquiryCasesWrite from "../../api/inquiry-cases.mjs";
import aiBureauConfigWrite from "../../api/ai-bureau-config.mjs";
import readLenders from "../../api/read/lenders.mjs";
import readLenderMatches from "../../api/read/lender-matches.mjs";
import readLenderObservations from "../../api/read/lender-observations.mjs";
import readInquiryCases from "../../api/read/inquiry-cases.mjs";
import readEeoAggregate from "../../api/read/eeo-aggregate.mjs";
import readRepairCases from "../../api/read/repair-cases.mjs";
import readAiBureauConfig from "../../api/read/ai-bureau-config.mjs";
import proxyLaunch from "../../api/proxy/launch.mjs";
import proxyEnd from "../../api/proxy/end.mjs";
import readProxySessions from "../../api/read/proxy-sessions.mjs";
import climate from "../../api/climate.mjs";
import climateGeocode from "../../api/climate/geocode.mjs";
import climateConfig from "../../api/climate/config.mjs";
import marketingSettings from "../../api/marketing/settings.mjs";
import marketingFunnels from "../../api/marketing/funnels.mjs";
import marketingHealth from "../../api/marketing/health.mjs";
import marketingScripts from "../../api/marketing/scripts.mjs";
import marketingScript from "../../api/marketing/script.mjs";
import marketingScriptsApprove from "../../api/marketing/scripts/approve.mjs";
import marketingScriptsEdit from "../../api/marketing/scripts/edit.mjs";
import marketingScriptsReject from "../../api/marketing/scripts/reject.mjs";
import marketingScriptsOrder from "../../api/marketing/scripts/order.mjs";
import marketingIdeas from "../../api/marketing/ideas.mjs";
import marketingRules from "../../api/marketing/rules.mjs";
import marketingScriptsFix from "../../api/marketing/scripts/fix.mjs";
import marketingBatches from "../../api/marketing/batches.mjs";
import marketingBatchesWriteNow from "../../api/marketing/batches/write-now.mjs";
import marketingJobsRetry from "../../api/marketing/jobs/retry.mjs";
import marketingFunnel from "../../api/marketing/funnel.mjs";
import marketingFunnelsCreate from "../../api/marketing/funnels/create.mjs";
import marketingFunnelsRename from "../../api/marketing/funnels/rename.mjs";
import marketingFunnelsBuild from "../../api/marketing/funnels/build.mjs";
import marketingFunnelsPushLive from "../../api/marketing/funnels/push-live.mjs";
import marketingMetaLoad from "../../api/marketing/meta/load.mjs";
import marketingMetaLoadStatus from "../../api/marketing/meta/load-status.mjs";
import marketingAds from "../../api/marketing/ads.mjs";
import marketingAd from "../../api/marketing/ad.mjs";
import marketingAngles from "../../api/marketing/angles.mjs";
import marketingFunnelsStats from "../../api/marketing/funnels/stats.mjs";
import marketingBatchesNext from "../../api/marketing/batches/next.mjs";
import marketingCosts from "../../api/marketing/costs.mjs";
import marketingFlywheel from "../../api/marketing/flywheel.mjs";
import marketingFlywheelRun from "../../api/marketing/flywheel/run.mjs";
import marketingFlywheelJob from "../../api/marketing/flywheel/job.mjs";
import marketingFlywheelApprove from "../../api/marketing/flywheel/approve.mjs";
import marketingFlywheelTweak from "../../api/marketing/flywheel/tweak.mjs";
import marketingFlywheelCampaign from "../../api/marketing/flywheel/campaign.mjs";
import marketingResearch from "../../api/marketing/research.mjs";
import marketingResearchApprove from "../../api/marketing/research/approve.mjs";
import marketingResearchTweak from "../../api/marketing/research/tweak.mjs";
import marketingResearchBrain from "../../api/marketing/research/brain.mjs";
import marketingFlywheelSpendRead from "../../api/marketing/flywheel/spend-read.mjs";

export const config = { path: "/api/*" };

/* The key is the path minus the leading /api/ — "read/products" serves
   /api/read/products. Exported so src/http/routes.test.mjs can diff it against
   the api/ directory; nothing at runtime reads it from outside this module. */
export const ROUTES = {
  "auth/login": authLogin,
  "auth/logout": authLogout,
  "auth/session": authSession,
  "auth/reset": authReset,
  "auth/admin-reset": authAdminReset,
  "auth/send-portal-link": authSendPortalLink,
  "auth/authorized-rep": authAuthorizedRep,
  "auth/authorized-rep-file": authAuthorizedRepFile,
  "auth/invite": authInvite,
  "auth/staff-role": authStaffRole,
  "auth/staff-update": authStaffUpdate,
  "auth/suspend": authSuspend,

  /* Portal sign-in by emailed link. Routed in the same commit as the handlers,
     the migration, the template seed and the page — this map is the file that
     has twice turned a finished feature into a 404 (see the header), and a
     magic link is the worst possible thing to leave unrouted: the client gets
     an email, clicks the link, and lands on a page that cannot verify it.

     Two paths, because ROUTES matches the whole path exactly and the request
     and the exchange are different operations with different methods.
     Both are open by design, like every other sign-in route here — the token
     IS the credential, and the request endpoint deliberately answers the same
     thing to everybody. */
  "auth/magic-link": authMagicLink,
  "auth/magic-link-verify": authMagicLinkVerify,

  "journeys/ask": journeysAsk,
  /* ROLE_SETS.FINANCE — {owner, admin}, the same gate as its two neighbours.
     A run drives the real event bus into the real workflows, so it is not a
     read. It writes inside a transaction that is always rolled back, which is
     what keeps its synthetic clients off every dashboard. */
  "journeys/run": journeysRun,
  "journeys": journeysStore,
  /* The write half of the template editor. ROLE_SETS.STAFF to save copy,
     owner/admin to approve it — the split lives inside the handler because the
     two actions share a route and only one of them is narrower. Its read half
     is "read/message-templates" further down this map. */
  "message-templates": messageTemplatesWrite,
  /* Agent Editor write half. ROLE_SETS.STAFF. Save / promote / demote / create
     used to mutate memory only and paint "SAVED" — a reload threw the prompt
     away with no error. Routed in the same commit as the handler and the
     screen wiring. */
  "agents": agentsWrite,
  /* Start a phone call for a registry agent, or ask whether one could be
     started. Narrower than STAFF: the desks that contact clients only. Every
     refusal is explicit; the provider behind it is held by MESSAGING_DRY_RUN,
     so nothing dials unless that is switched off on purpose. */
  "agent-call": agentCall,
  /* Pipeline board card moves. Shift-gated STAFF write. Drag and MOVE used to
     rearrange the DOM and stash positions in sessionStorage. */
  "pipeline-cards": pipelineCards,
  /* Pipeline New Client. Same door as the funnel: resolveClient + entry.captured.
     Shift-gated STAFF write. Modal on the existing board — no new screen. */
  "pipeline-clients": pipelineClients,
  /* Products & Commissions product ladder edits. ROLE_SETS.FINANCE — prices are
     configuration, same gate as other money-config writes. */
  "products": productsWrite,
  /* Owner SLO Connections. ROLE_SETS.OPS. Maps ClickFunnels IDs to a product. */
  "slo-connections": sloConnectionsWrite,
  "client-notes": clientNotes,
  "commission-rules": commissionRules,
  /* Commission ledger Approve / Mark paid. ROLE_SETS.FINANCE. Does not send money. */
  "commissions": commissionsWrite,
  /* Lender database maintenance + CSV import. ROLE_SETS.STAFF. */
  "lenders": lendersWrite,
  /* Bureau observation log + mismatch review. ROLE_SETS.STAFF. */
  "lender-observations": lenderObservationsWrite,
  /* Application status transitions + decision audit. ROLE_SETS.STAFF. */
  "applications": applicationsWrite,
  /* Inquiry removal case queue writes + inquiry.removed emit. ROLE_SETS.STAFF. */
  "inquiry-cases": inquiryCasesWrite,
  /* AI bureau IVR config — owner/admin/funding_advisor. */
  "ai-bureau-config": aiBureauConfigWrite,
  /* Oxylabs residential Apply door — owner + funding_advisor only. */
  "proxy/launch": proxyLaunch,
  "proxy/end": proxyEnd,
  "tasks": tasks,

  /* The staff reply inbox's write half. POST only — a staff member composing a
     message to a client. Routed in the same commit as the handler, the service,
     the migration and the screen, because an unreachable send endpoint is the
     failure mode src/http/routes.test.mjs exists for: the inbox would render,
     the compose box would accept typing, and Send would 404.

     Its read halves are "read/inbox" and "read/messages" further down this map.
     They are separate routes rather than a GET branch here because they are
     readHandler endpoints — paginated, role-gated, GET-only — and this one is a
     shift-gated write. One route serving both would put a write gate and a read
     gate in the same file and eventually on the same path. */
  "messages": messagesWrite,
  "inquiry": inquiry,
  "dashboard/clients": dashClients,
  "dashboard/client": dashClient,
  "dashboard/pipeline": dashPipeline,
  "dashboard/pipeline-counts": dashPipelineCounts,
  "dashboard/seed": dashSeed,
  "dashboard/kpis": dashKpis,
  "dashboard/client-archive": dashClientArchive,
  "health": health,
  "partner-brand": partnerBrand,
  "org-brand": orgBrand,
  "read/commissions": readCommissions,
  "read/invoices": readInvoices,
  "read/documents": readDocuments,
  "read/bank-inbox": readBankInbox,
  "read/funding-rounds": readFundingRounds,
  "read/lenders": readLenders,
  "read/lender-matches": readLenderMatches,
  "read/lender-observations": readLenderObservations,
  "read/inquiry-cases": readInquiryCases,
  /* Bias-audit aggregates — v_eeo_aggregate only, ROLE_SETS.COMPLIANCE. Not
     api/hiring/* because that directory carries applicant PII. */
  "read/eeo-aggregate": readEeoAggregate,
  "read/repair-cases": readRepairCases,
  "read/ai-bureau-config": readAiBureauConfig,
  "read/proxy-sessions": readProxySessions,
  "read/affiliates": readAffiliates,

  /* ONE AFFILIATE'S OWN referrals, payouts, rates and gates. Routed in the same
     commit as the handler, because this endpoint exists precisely to end a
     feature that was built and never connected: public/app/affiliate.html has
     declared `var LEADS=[]` (:398) and `var PAYOUTS=[]` (:477) since it was
     written and assigned neither, so both tables have always read "No referrals
     on file". An unrouted handler here would reproduce that exact failure.

     read/affiliates above is a different question and stays as it is: that one
     answers STAFF with per-affiliate counts across the roster. This one answers
     the affiliate — or a client who has become a light affiliate — with their
     own rows, and pins a non-staff caller to themselves. */
  "read/affiliate-portal": readAffiliatePortal,

  /* "Refer a friend". Turns a client into a light affiliate and hands back
     their share link (ops/workflows/portal-rebuild-plan.md §4, owner-set).
     Routed with its handler and its migration for the same reason as every
     other line here. Not under "read/" — it writes. */
  "affiliates/refer": affiliatesRefer,
  "read/partners": readPartners,
  /* Where a partner stands against the production floor — the only filter on the
     partner base (W0-decisions.md, W1-money-model.md §6). The monthly job writes
     the verdicts; without this line nothing could read one back and the warning
     §6 promises the partner would have no surface. */
  "read/partner-production": readPartnerProduction,
  /* T10-02 — the three Partner Home KPI tiles that have a real partner-scoped
     source (Cash Collected Today, Funded Today, Cost / Funded Client). See the
     audit comment in public/app/partner-galaxy.html for the three that still do
     not and stay off the screen. */
  "read/partner-home-tiles": readPartnerHomeTiles,
  /* Where a partner is in the $10,000 curriculum — the thirteen modules of
     W7-curriculum.md and the four gates that stand between them and selling
     under FundHub's brand. Serves partner and staff; a partner is pinned to
     their own record and gets a 403 with a reason if they are not entitled to
     the training at all. COMPLIANCE REVIEW REQUIRED — it reports whether a
     partner holds the two compliance certifications. */
  "read/partner-training": readPartnerTraining,
  "read/message-templates": readMessageTemplates,
  "read/staff": readStaff,
  "staff/telemetry": staffTelemetry,
  "staff/monitoring-consent": staffMonitoringConsent,
  "staff/avatar": staffAvatar,
  "read/entitlements": readEntitlements,
  "read/failed-events": readFailedEvents,
  "read/agents": readAgents,
  "read/agent-context": readAgentContext,
  "read/agent-shadow-log": readAgentShadowLog,
  "read/inquiries": readInquiries,
  "read/products": readProducts,
  "read/slo-connections": readSloConnections,
  "read/conversations": readConversations,

  /* The staff reply inbox's two reads. "read/inbox" is the thread list across
     the whole company; "read/conversations" directly above is the per-client
     panel and is deliberately NOT the same endpoint — see the header of
     api/read/inbox.mjs for why the client_id requirement there was left alone
     rather than relaxed. "read/messages" reads inside one thread. */
  "read/inbox": readInbox,
  "read/messages": readMessages,

  /* Global CRM search. ROLE_SETS.STAFF, org from the session — same gate and
     tenancy rule as the inbox and documents list. One query string (`q`), five
     named groups. Routed in the same commit as the handler and the shell UI:
     a search box whose endpoint 404s is the failure this map exists to stop. */
  "read/search": readSearch,

  // read/tradelines was held out of this map by the routing pass because
  // api/read/tradelines.mjs declared a role gate it did not get: it passed
  // { roles: ROLE_SETS.STAFF } as requireAuth's third argument, which is
  // { db, env }, so the key was dropped and any authenticated staff session of
  // any role could read a named client's credit limits and balances. That is
  // now a real requireRole() call in the handler, and the entry it was blocking
  // is here. Routed and gated in the same pass, deliberately — routing it
  // first would have shipped the hole, and fixing it without routing would have
  // left the Closer Dashboard's live mode 404ing against a working endpoint.
  "read/tradelines": readTradelines,

  // read/finance-os summarises the same rows read/tradelines serves, so it
  // carries the same ROLE_SETS.STAFF gate — gating the summary more tightly
  // than the detail would buy nothing, since anyone refused here can read the
  // underlying lines next door and add them up. Routed in the same commit as
  // the handler and the screen: a screen whose endpoint 404s is the failure
  // this map exists to prevent, and it has shipped twice.
  "read/finance-os": readFinanceOs,

  // read/finance-os-suggestions gates on an active finance-os subscription in
  // ADDITION to ROLE_SETS.STAFF — Finance OS is a paid add-on (owner-set
  // 2026-09-09), not a fact of being a funding or repair client. Routed in the
  // same commit as the handler for the same reason as the entry above it.
  "read/finance-os-suggestions": readFinanceOsSuggestions,

  // read/banking-surface is the cash companion to read/finance-os and carries
  // the same ROLE_SETS.STAFF gate. Bank balances are no more sensitive than the
  // credit limits read/tradelines already serves to that set, and splitting the
  // gate would leave a closer able to see a client's cards but not their cash
  // while working the same file. Routed in the same commit as the handler and
  // the screen.
  "read/banking-surface": readBankingSurface,

  // Capital Blueprint — primary + credit partner combined prequal (lane 6).
  "read/blueprint-combined-approval": readBlueprintCombinedApproval,
  "blueprint/staff-actions": blueprintStaffActions,

  // read/underwrite runs the vendored UnderwriteIQ Lite engine over the same
  // tradeline rows read/tradelines and read/finance-os already serve to
  // ROLE_SETS.STAFF, so it carries that same gate. Routed in the same commit as
  // the handler — an endpoint that 404s on the deploy target is the exact failure
  // this map exists to prevent, and it has shipped twice.
  //
  // Unlike its two neighbours, this handler scopes every query by the SESSION's
  // org_id and refuses a session without one. Those two filter on client_id
  // alone; that gap is recorded in the handler's header and is not this change's
  // to close.
  "read/underwrite": readUnderwrite,

  // read/money-map gathers what read/finance-os, read/banking-surface and
  // read/tradelines already serve, plus card_liabilities, recurring_bills and
  // cashflow_reminders, into the one screen an owner opens for a client. Same
  // ROLE_SETS.STAFF gate as its three neighbours — it exposes nothing they do
  // not, and splitting the gate would leave a closer able to read the parts but
  // not the summary of the file they are working.
  //
  // It is the only one of the four that also scopes on the SESSION'S org and
  // refuses a session with no org at all. Routed in the same commit as the
  // handler and the screen: a screen whose endpoint 404s is the exact failure
  // this map exists to prevent, and it has shipped twice.
  "read/money-map": readMoneyMap,

  // read/finance-command is the roll-up: money-map answers "one client's whole
  // picture", this answers "every client's, folded into one number, or narrowed
  // to one client or one entity (106_entities.sql)". Same ROLE_SETS.STAFF gate,
  // same org fail-closed rule, same reason — it exposes nothing the per-client
  // screens do not, one level up.
  "read/finance-command": readFinanceCommand,

  // read/finance-ask answers a small fixed set of question shapes against the
  // same numbers finance-command computes — never a language model, never a
  // guess. A question it does not recognise, or whose numbers are unknown,
  // comes back thin_data:true with a named reason, same discipline as
  // api/finance/alerts.mjs's REASON_TEXT map. ROLE_SETS.STAFF, same as its
  // neighbour above.
  "read/finance-ask": readFinanceAsk,

  // Company Brain — Drive search over role-cleared chunks. ROLE_SETS.STAFF;
  // role for tier filter comes from the session only.
  "read/company-brain": readCompanyBrain,

  // EXTERNAL allowlist-only path for affiliate/partner. Never shares the staff
  // tier filter. Step 7 of COMPANY-BRAIN-BUILD-SPEC.
  "read/company-brain-affiliate": readCompanyBrainAffiliate,
  // Ops / AI COO v1. GET is read-only pulse + briefs. POST creates the
  // hire-closer task and LinkedIn post when packed. ROLE_SETS.OPS.
  "read/ops-pulse": readOpsPulse,
  "ops/hire-closer": opsHireCloser,

  // Owner-only classification review queue (H-3). Also carries staff uploads
  // waiting for approval — same queue, same owner-only decision.
  "company-brain/reviews": companyBrainReviews,
  "company-brain/sync": companyBrainSync,

  // Staff document upload. POST sends one file up; GET lists what has been sent
  // and whether it is still waiting. An upload is NOT answerable until the owner
  // approves it — retrieve.mjs filters on approval_status before ranking.
  "company-brain/upload": companyBrainUpload,

  // Saved conversations, scoped to one org AND one staff member.
  "company-brain/threads": companyBrainThreads,

  // read/workflows introspects the live src/workflows/index.mjs `functions`
  // array — the actual Inngest registry — rather than a hand-authored list, so
  // this can never drift from what src/workflows/*.mjs actually exports.
  // ROLE_SETS.STAFF, same as its read neighbours: knowing which automations
  // exist and whether they've fired is operational visibility, not a finance
  // or ops-only concern.
  "read/workflows": readWorkflows,

  // read/transactions is the missing reader for bank_transactions (085) — the
  // table has had a real writer (src/banking/import.mjs) since the mock
  // banking provider landed, and until this endpoint nothing exposed a row of
  // it anywhere. Finance OS needs a transaction list and a spending-by-
  // category breakdown; both come from here rather than being invented on the
  // screen. Same ROLE_SETS.STAFF gate and same org-scoped-from-the-session
  // rule as its neighbours above — it serves nothing they do not already.
  "read/transactions": readTransactions,
  /* Sales dashboards — call cockpit, closer my-numbers, manager floor. */
  "read/closer-call": readCloserCall,
  "read/closer-now": readCloserNow,
  "read/deal-math": readDealMath,
  "read/closer-deck": readCloserDeck,
  /* Ad attribution (286). "read/ad-attribution" is the one client's ad and
     the registry tags the closer reads on the call screen; "read/ad-books" is
     booked calls grouped by lane, ad, variant or registry tag. Both
     ROLE_SETS.STAFF, org from the session. Routed in the same commit as the
     handlers — an attribution panel whose endpoint 404s is exactly the failure
     this map exists to stop. */
  "read/ad-attribution": readAdAttribution,
  "read/ad-books": readAdBooks,
  /* The label spine (377). One row per ad carrying the angle, hook, lane, offer
     and script type it inherited from its creative and that creative's script,
     read out of v_ad_label_spine. ?group_by=angle|hook|lane|offer|script_type
     turns the same endpoint into the count Chris asks for. ROLE_SETS.STAFF, org
     from the session. Routed with its two write halves below — a spine that can
     be filled in and not read back is the same 404 this map exists to stop. */
  "read/ad-spine": readAdSpine,
  /* The way into ad_scripts. POST only, ROLE_SETS.STAFF. 377 created the table
     and nothing in the tree could write a row to it, so every label the spine
     reads had to start here. A rewrite is a NEW row pointing at its parent;
     nothing is ever overwritten. */
  "scripts/write": scriptsWrite,
  /* The way back OUT of ad_scripts, for the Script picker on the Creative
     Factory screen. Without it the picker only ever held the script saved in
     that one browser tab, and a reload emptied it. */
  "scripts/list": scriptsList,
  "read/funnel-pages": readFunnelPages,
  "read/video-stats": readVideoStats,
  "analytics/clickfunnels-connect": clickfunnelsConnect,
  "analytics/clickfunnels-sync": clickfunnelsSync,
  "analytics/youtube-connect": youtubeConnect,
  "analytics/youtube-sync": youtubeSync,
  "ops/weekly-brief": opsWeeklyBrief,
  "closer-deck": closerDeckWrite,
  "read/my-numbers": readMyNumbers,
  "read/sales-floor": readSalesFloor,
  "read/company-activity": readCompanyActivity,
  "read/call-outcomes": readCallOutcomes,
  "read/unrecorded-calls": readUnrecordedCalls,
  "call-outcomes": callOutcomesWrite,
  "read/customer-insights": readCustomerInsights,
  "read/csm-queue": readCsmQueue,
  "customer-insights": customerInsightsWrite,
  "marketing-flags": marketingFlagsWrite,
  // Marketing Command Center, Today tab (owner/admin). Read only.
  "marketing/today": marketingToday,

  // banking/sync-accounts is the FIRST WRITER `bank_accounts` has ever had —
  // until it, the only INSERT into that table in the whole repository was inside
  // a pg test, and every bank-derived section of the Money Map was empty with no
  // way to fill it.
  //
  // ROLE_SETS.FINANCE — {owner, admin} — NOT the STAFF set its read neighbours
  // use, and deliberately narrower: this one creates the financial rows those
  // screens total. Reading a balance and conjuring one are different powers.
  //
  // The provider is always named by the caller; there is no default, because a
  // default is how a mock ends up running in production. The mock provider is
  // additionally gated on BANKING_MOCK_PROVIDER=1 and every row it writes
  // carries provider='mock' in a NOT NULL checked column. Nothing on either path
  // transmits: the mock reads a fixture in this repository, and the Plaid seam
  // is deliberately unclosed and returns its refusal unchanged.
  "banking/sync-accounts": bankingSyncAccounts,

  // Write endpoints. Hand-rolled rather than readHandler-based, so each one owns
  // its own method switch, its 405 + allow header, and its domain-error mapping.
  // They were built, tested and left unrouted; /api/inquiries in particular is
  // the entire write path of the Inquiry Remover dashboard, whose read half
  // (/api/read/inquiries) has been routed the whole time — the queue rendered
  // and no button on it worked.
  //
  // /api/pii gates on its own IDENTITY_ROLES set — {owner, admin,
  // inquiry_specialist, funding_advisor} — which is NARROWER than ROLE_SETS.STAFF
  // and deliberately so: a setter or closer has no reason to read a social
  // security number. Left exactly as written; routing it does not widen it.
  "inquiries": inquiries,
  "repair/exceptions": repairExceptions,
  "repair/enroll": repairEnroll,
  "repair/generate": repairGenerate,
  "repair/send": repairSend,
  "repair/inbound-mail": repairInboundMail,
  "pii": pii,
  "shifts": shifts,
  /* Calendar bookings, GET only. Routed in the same commit as the handler,
     the store and migration 225 — a handler file is not a route, and an
     unrouted api/bookings.mjs 404s locally and deployed. */
  "bookings": bookings,

  // Creative Factory. All ten go through src/http/partner-read-api.mjs, which is
  // requirePrincipal(["partner","staff"]) + withPartnerScope, so a partner sees
  // only their own rows via RLS and a staff caller must name ?partner_id=.
  "campaigns/list": campaignsList,
  "campaigns/detail": campaignsDetail,
  "campaigns/spend": campaignsSpend,
  "campaigns/fatigue": campaignsFatigue,
  "campaigns/connections": campaignsConnections,
  "campaigns/action-log": campaignsActionLog,
  "campaigns/sync": campaignsSync,
  "campaigns/write": campaignsWrite,
  "campaigns/meta-agency": campaignsMetaAgency,
  /* The write that was missing. ads.asset_id has existed since 046:291 and no
     code has ever filled it in, so v_ad_label_spine reads empty rather than
     broken. This says which creative is running on an ad, and what our own ad
     number for it is. A person picks the row: the Meta pull never asks for a
     creative and the two sides share no identifier, so there is nothing to
     match on automatically. Same door as its siblings — requirePrincipal
     ["partner","staff"] inside withPartnerScope. */
  "campaigns/link-asset": campaignsLinkAsset,
  "social/schedule": socialSchedule,
  "social/publish": socialPublish,
  "social/oauth": socialOauth,
  "social/posts": socialPosts,
  "social/generate": socialGenerate,
  "social/channels": socialChannels,
  "social/settings": socialSettings,
  "brand/review": brandReview,
  "chat/ask": chatAsk,
  "chat/messages": chatMessages,
  "chat/portal-message": chatPortalMessage,
  "chat/peers": chatPeers,
  "demo/simulate": demoSimulate,
  "demo/mode": demoMode,
  "partner-pages": partnerPages,
  /* Turns a white-label APPLICATION into a live partner: login, brand row,
     published page, status active, welcome mail. approvePartnerApplication()
     existed and was routed by nothing, so an applicant could only be approved
     by hand-editing the database — and never got the welcome mail at all.
     Owner/admin only; the handler gates with requireRole after requireAuth. */
  "partners/approve": partnersApprove,
  "partner-brand/verify-domain": partnerBrandVerifyDomain,
  "partner-marketing/enable": partnerMarketingEnable,
  "partner-marketing/usage": partnerMarketingUsage,
  "partner-marketing/generate-copy": partnerMarketingGenerateCopy,
  "partner-marketing/copy-history": partnerMarketingCopyHistory,
  "partner-marketing/generate-logo": partnerMarketingGenerateLogo,
  /* Affiliate + partner Mac gift. Handler and dmg bundle existed; this map
     line is what makes GET /api/gifts/message-blaster reachable. */
  "gifts/message-blaster": messageBlasterGift,
  "public/partner-page": publicPartnerPage,
  "public/survey-submit": publicSurveySubmit,
  /* The /education/enroll/ form. No auth — same class as survey-submit. */
  "public/education-enroll": publicEducationEnroll,
  /* Hidden referral page at /optimize. GET = Smart Credit gate. POST = Audit
     checkout on the keep Assessment title. No auth — same class as survey-submit. */
  "public/optimize": publicOptimize,
  /* The lending-climate lead magnet at /climate/. GET = how big the lender book
     is. POST = the REAL staff matcher over the same active rows /api/climate
     publishes, returning a count, the lane counts and a few names. No odds, no
     amounts, no credit pull, no new catalog product — the $32 unlock reuses
     public/optimize. No auth — same class as survey-submit. */
  "public/climate-match": publicClimateMatch,
  "public/partner-apply": publicPartnerApply,
  /* The self-serve till for the /partner/ funnel pages. GET returns every
     price those pages render (nothing is typed into the HTML); POST mints a
     real Commas checkout for the Decline Autopsy, the Winner's Board and the
     Live Trial. The $10,000 entry is REFUSED here on purpose — it is sold on a
     review call, so its CTA stays the application above. No auth: same class
     as public/survey-submit. COMPLIANCE REVIEW REQUIRED — fee timing. */
  "public/funnel-checkout": publicFunnelCheckout,
  /* The $297 SLO diagnostic. Pay on Commas, then land on /roadmap/pull.html.
     No auth — same class as public/optimize. Keep title Assessment. */
  "public/slo-checkout": publicSloCheckout,
  /* Step 1 of the /roadmap widget, saved before Pay. GET answers {ok:true}
     and writes nothing. POST writes a visit or a name/email/phone. No client,
     no card, no mail. */
  "public/slo-interest": publicSloInterest,
  /* RB2B identified-visitor push. GET answers {ok:true} and writes nothing.
     POST needs ?secret= (RB2B_WEBHOOK_SECRET) — they document no signature,
     only a self-contained URL. Stores into events as rb2b.visitor_identified.
     No client, no mail, no Inngest. */
  "public/rb2b-webhook": publicRb2bWebhook,
  /* POST only. Identity + checkbox consent, then diagnostic.paid. GET 405.
     Do not ping with a body — that would store an SSN and fire C-00. */
  "public/slo-pull": publicSloPull,
  /* GET only, read only. Same ref + client_id credential as slo-pull. The
     /roadmap widget polls it: running / done / failed, the bucket (funding or
     repair), the pre-approval dollars on the funding path, per-bureau status
     words, and the repair plans only on the repair path after the pull. Never
     the tier name, a score, or the email. Answers OPTIONS for the widget's
     origin (apply.fundhub.ai) — never "*". */
  "public/slo-status": publicSloStatus,
  /* POST only. The repair plan the buyer picks in the widget (REPAIR_TRIAL or
     REPAIR_DFY, prices and Commas titles from src/config/offers.mjs). Refused
     unless slo-status would show the repair offer now. DEMO pay records it and
     charges nothing. Answers OPTIONS for the widget's origin — never "*". */
  "public/slo-repair-checkout": publicSloRepairCheckout,
  /* The Live Trial. $297, seven days, docs/specs/W4-live-trial.md.
     eligibility is PUBLIC and runs in front of the pay button — Meta will not
     run a money-related ad from an unverified business, and finding that out
     after taking the money means selling seven days that cannot be delivered.
     provision and convert are staff-gated with requireRole; dashboard is
     requirePrincipal(["partner","staff"]) and a partner only ever sees its own. */
  "trials/eligibility": trialsEligibility,
  "trials/provision": trialsProvision,
  "trials/dashboard": trialsDashboard,
  "trials/convert": trialsConvert,
  /* The $27 Decline Autopsy. No auth — a stranger from an ad, same class as
     survey-submit. THE KEYS ARE FLAT ON PURPOSE: the adapter routes
     "documents/" and "webhooks/" by PREFIX, so a key shaped
     "public/decline-autopsy/upload" invites exactly the sub-path confusion the
     documents/ branch already caused once. Three flat keys, three handlers.
       ...-upload accepts rows only after payment and refuses anything that
       looks like a name, an SSN, an e-mail or a phone before a byte is stored.
       ...-report is read with a signed, expiring link — the signature IS the
       credential, because a $27 buyer has no session, and DELETE on it is the
       buyer's own "delete my upload" button. */
  /* DECLINE AUTOPSY — SHELVED BY THE OWNER 2026-08-31. Routes deliberately
     removed so the offer cannot go live on the next deploy. The handlers,
     src/autopsy/, migration 275 and the sales page are all intact and are NOT
     to be deleted — the offer is coming back once its delivery is reworked
     (see the notice at the top of docs/specs/W3-decline-autopsy.md).
     TO UNSHELVE: restore these three lines and remove the three entries from
     ALLOWED_UNROUTED in src/http/routes.test.mjs.
  "public/decline-autopsy": publicDeclineAutopsy,
  "public/decline-autopsy-upload": publicDeclineAutopsyUpload,
  "public/decline-autopsy-report": publicDeclineAutopsyReport, */
  /* The door behind the unsubscribe link in every outbound email. No auth —
     same class as survey-submit: the signed token in the URL is the credential,
     and a person getting out of a mailing list must never be asked to sign in.
     GET reports state, POST is the act; see the handler's header for why. */
  "public/unsubscribe": publicUnsubscribe,
  /* Voluntary EEO self-ID survey — separate from careers apply (053_eeo_selfid.sql).
     Token in URL is the credential. GET loads the form schema; POST severs the
     application link in Postgres. COMPLIANCE REVIEW REQUIRED. */
  "public/eeo-survey": publicEeoSurvey,
  /* Records one visit to an affiliate referral link. No auth — it fires from
     the /start redirect in a stranger's browser. Write-only, and it answers the
     same whether the code resolved to an affiliate or to nobody, so it cannot
     be used to enumerate the partner roster. */
  "public/affiliate-click": publicAffiliateClick,
  /* The VSL player's own beacon. No auth — a stranger watching a sales video has
     no account, so there is nobody to authenticate; same class as
     public/affiliate-click. POST only, so no <img> tag or crawler can trigger it,
     and OPTIONS only to answer the browser's cross-site permission question: the
     page is ClickFunnels at apply.fundhub.ai and this endpoint is on fundhub.ai,
     so the handler echoes Access-Control-Allow-Origin for an allow-listed origin
     and never a wildcard. Write-only: every answer is {ok:true} or one word, so
     nothing about our ads or funnels can be read back out. Rate limited twice
     from real rows — per visitor id, and site-wide on NEW viewings, because a
     visitor id is a string the caller invents for free. Read the header of
     api/public/vsl-watch.mjs before adding anything beside it. */
  "public/vsl-watch": publicVslWatch,
  /* Chris taps Approve or Reject on a filmed ad take, from a phone notification
     (owner decision 5, 2026-09-22). No auth, because a push notification has no
     session to authenticate with — the random token in the link IS the
     credential, same class as public/unsubscribe and public/eeo-survey.

     What keeps that safe is in the database rather than in the handler:
     389_ad_videos.sql writes its row-level security policies on approval_token,
     so a request that has not declared a live token matches ZERO rows. One
     stolen token reaches one take and there is no path from there to anything
     else. The token expires, SQL checks the expiry in the same WHERE clause as
     the update, and using it spends it.

     GET shows the take so he can see what he is deciding on; POST is the
     decision, so a link preview or a crawler following the URL cannot approve
     anything. Every refusal — unknown, expired, already decided, malformed —
     is the same 404, so the door answers no questions about which tokens
     exist. Read api/public/ad-video-approve.mjs before adding anything to it. */
  "public/ad-video-approve": publicAdVideoApprove,
  /* The filmed takes and where each one is stuck (marketing/ads/video-pipeline-plan.md
     §2). Staff read, ROLE_SETS.OPS — owner and admin only, because these rows
     carry unreleased ad creative and links to the raw files. Read-only: nothing
     is approved here, that is public/ad-video-approve above. */
  "ad-videos": adVideos,
  /* Public lending-climate lead magnet. No auth — same class as survey-submit. */
  "climate": climate,
  "climate/geocode": climateGeocode,
  "climate/config": climateConfig,
  "creative/generate": creativeGenerate,
  "creative/library": creativeLibrary,
  "creative/brand-kits": creativeBrandKits,
  "creative/jobs": creativeJobs,
  "creative/approvals": creativeApprovals,
  "creative/actions": creativeActions,
  "creative/run": creativeRun,
  /* The dashboard's "Write offer" button (flywheel stage 3 on the server).
     Owner/admin. POST saves a queued run and wakes the 15-minute background
     writer (netlify/functions/marketing-offer-background.mjs); GET reads the
     run back. Contract: docs/specs/marketing-offer-contract.md. */
  "marketing/offer/generate": marketingOfferGenerate,
  /* The Winner's Board read endpoint (W2 Layers 1-2). Partner or staff; a
     client or affiliate session is refused by requirePrincipal, and staff must
     name a partner_id so the query still runs inside a scoped transaction.
     Routed in the same commit as the handler, the migration and the screen —
     this map is the file that has twice turned a finished feature into a 404. */
  "adintel/board": adintelBoard,
  /* Content — welcome video upload + locked-tile save. ROLE_SETS.OPS
     (owner, admin). Same people the Content nav item is shown to. */
  "content/tiles": contentTiles,
  "content/upload": contentUpload,
  /* The client portal's hero video. NOT ROLE_SETS.OPS like the two lines above
     — this is the read a signed-in CLIENT makes on their own portal, so it
     serves {staff, client} and pins a client to their own session. It also
     answers with NO session when the request carries a valid signature: a
     <video src> cannot send an Authorization header, so the signature is the
     credential, exactly as api/documents/[id].mjs does it. */
  "content/welcome-video": contentWelcomeVideo,

  // Hiring. ROLE_SETS.HIRING is {owner, admin} — NOT the STAFF set, because
  // these carry applicant PII and the scoring trail of an automated employment
  // decision tool. Routing them changes nothing about that gate.
  "hiring/candidates": hiringCandidates,
  "hiring/application": hiringApplication,
  "hiring/postings": hiringPostings,
  "hiring/decisions": hiringDecisions,
  "hiring/funnel": hiringFunnel,
  "hiring/bench": hiringBench,
  "hiring/decide": hiringDecide,
  /* THE ONE EXCEPTION TO THE GATE ABOVE, and it is deliberate. public/careers.html
     is a page for strangers, so /api/hiring/apply is UNAUTHENTICATED: GET lists
     the open reqs (key, name and the human-written brief — nothing else from
     hiring_roles), POST takes one application and calls pipeline.mjs's apply().
     It cannot score, advance or reject anything. Read the header of
     api/hiring/apply.mjs before adding anything beside it — a second public file
     under this prefix needs the same argument made again, in writing. */
  "hiring/apply": hiringApply,

  // Finance. The one-tap soft pull for a client already on file. Routed in the
  // same commit that adds the handler, deliberately: this is the third time a
  // feature in this repo has been finished and left unreachable, and a
  // credit-pull ledger that nobody can write to is worse than not having one —
  // it looks like the audit trail exists. The endpoint's own gate is narrower
  // than ROLE_SETS.STAFF and is spelled out in api/finance/soft-pull.mjs.
  // Nothing behind it transmits.
  "finance/soft-pull": financeSoftPull,
  "finance/crs-pull": financeCrsPull,

  // Banking and privacy. Both are DESTRUCTIVE and both gate on {owner, admin},
  // which is narrower than ROLE_SETS.STAFF and spelled out in each handler rather
  // than inherited. Routed in the same commit that adds the handlers, because a
  // revoke button that 404s is worse than no button: the person clicking it
  // believes their bank connection is gone and it is not.
  //
  // Each gates with TWO calls — requireAuth, then a separate requireRole — because
  // requireAuth forwards its third argument to authenticate(), which reads only
  // { db, env }, so a `roles` key there is silently dropped. That is the exact
  // hole api/read/tradelines.mjs shipped with, and src/http/auth-gate.test.mjs
  // exists to catch it.
  //
  // /api/banking/revoke removes THIS SYSTEM'S stored bank credential. It does not
  // revoke at the provider — nothing here transmits — and the response says so on
  // every call.
  //
  // /api/privacy/erasure de-identifies a client on an explicit request and writes
  // an audit row naming what was removed and what was kept. There is no schedule
  // behind it; nothing in this system erases anything on its own.
  "banking/revoke": bankingRevoke,
  "privacy/erasure": privacyErasure,

  // ── The Finance OS write surface ────────────────────────────────────────────
  //
  // ROUGHLY 7,000 LINES OF TESTED BUSINESS LOGIC HAD NO WAY IN. Twelve modules —
  // subscriptions/store, liabilities/store, banking/store, banking/recurring,
  // banking/cashflow, banking/reminders, banking/settings, alerts/store,
  // alerts/evaluate, calculators/deal-math and calculators/deal-funding — were
  // complete, tested and unreachable: no route, no screen, no caller. The owner
  // opened the deployed app and saw a seven-row read-only grid. That is the
  // third and largest instance of the exact failure the header of this file
  // describes, and these eight entries are the fix for it.
  //
  // ROUTED BEFORE THE HANDLERS ARE FINISHED, DELIBERATELY. Each file below is
  // currently a working shell — real auth, real role gate, real org scoping from
  // the session, real method switch — whose action bodies answer 501
  // not_implemented. Six build agents fill those bodies in, one file each. The
  // routes exist FIRST so that no agent can finish a feature and leave it
  // unreachable, which is precisely what happened the previous three times. A
  // 501 is an honest "built, not finished"; a 404 is a feature that does not
  // exist, and the difference matters to whoever has to debug it.
  //
  // ONE PATH PER RESOURCE, WITH AN `action` IN THE POST BODY. The same shape
  // api/inquiries.mjs and api/shifts.mjs already use. It keeps this map short
  // and — the reason that actually mattered here — it gives each build agent
  // exactly one file to own, so six parallel workflows cannot collide.
  //
  // EVERY ONE OF THEM SCOPES TO staff.org_id AND TO A VERIFIED CLIENT, and none
  // of them takes an org from a query string or a body. Three of the store
  // modules behind these routes (liabilities' three readers, and
  // getBillEvidence) filter on an id alone with no org column in the WHERE
  // clause, so the endpoint's ownership check is not defence in depth there — it
  // is the only thing standing between a pasted uuid and another company's
  // consumer file. The handlers say so at their own call sites.
  //
  // THE ROLE GATES ARE NOT UNIFORM AND MUST NOT BE MADE SO. FINANCE {owner,
  // admin} for anything carrying a price, a payment instrument or bank-derived
  // data (subscriptions, cards, bank-accounts, bills, cashflow); STAFF for the
  // reads that are no more sensitive than the tradelines this API already serves
  // that set (liabilities, alerts, model). alerts additionally narrows
  // `set_trigger` to FINANCE inside the handler, because changing a threshold
  // changes who gets flagged across the whole book. public/app/shell.js's
  // OWNER_ADMIN_ONLY list mirrors these gates screen by screen, so that the app
  // never offers somebody a screen whose data refuses them.
  //
  // NOTHING BEHIND ANY OF THESE TRANSMITS. There is no outbound fetch in
  // src/adapters/ or src/lib/; src/banking/plaid.mjs is a named empty seam, so
  // bank accounts and cards are entered by hand. That is the product today.
  "finance/subscriptions": financeSubscriptions,
  /* The white-label partner add-on menu — buy, cancel, and the manual
     reconcile for a checkout whose webhook never came back. {owner, admin}
     only: this is FundHub selling to a partner, not a closer selling to a
     client, and "buy" starts a recurring charge against another business.
     COMPLIANCE REVIEW REQUIRED — payment rails and fee timing. */
  "partner-addons": partnerAddOns,
  /* FundHub records a partner's training: one module attended or complete, or
     one gate passed, failed or revoked. {owner, admin} only and there is no
     partner write path anywhere — a partner who could mark their own compliance
     module complete would be a partner with no compliance certification.
     COMPLIANCE REVIEW REQUIRED. */
  "training-progress": trainingProgress,
  "finance/cards": financeCards,
  "finance/liabilities": financeLiabilities,
  "finance/bank-accounts": financeBankAccounts,
  // Entity grouping (106_entities.sql) — personal vs. business wallets under a
  // client. Additive: bank_accounts/card_liabilities/recurring_bills all keep
  // working with entity_id NULL. ROLE_SETS.STAFF, matching the read gate on the
  // accounts/cards/bills it groups.
  "finance/entities": financeEntities,
  "finance/bills": financeBills,
  "finance/cashflow": financeCashflow,
  "finance/alerts": financeAlerts,
  "finance/model": financeModel,
  "finance/paydown-simulator": financePaydownSimulator,

  // Banking manual entry. The first thing in this repository that writes
  // bank_accounts — the table has existed since 080/081 with a read endpoint, a
  // grouping module and a screen in front of it and no INSERT anywhere, which is
  // why the Banking Surface screen has always been empty.
  //
  // Routed in the same commit as the handler, deliberately. This is the fourth
  // feature in this repo to be finished end to end, and the three before it each
  // shipped unreachable because nobody added the line here.
  //
  // The gate differs by method and is spelled out in the handler: reads are
  // ROLE_SETS.STAFF, matching read/banking-surface which already serves the same
  // rows; writes are ROLE_SETS.FINANCE, because replacing a person's financial
  // records is a narrower act than reading them. Nothing behind it transmits —
  // the mock provider invents its data and makes no network call.
  "banking/accounts": bankingAccounts,

  // Client file uploads (docs/UPLOADS-SPEC.md). Deliberately NOT
  // "documents/upload" — src/http/routes.test.mjs refuses any exact key that
  // would sit under the "documents/" prefix branch a few lines down (the
  // signed download route, /api/documents/<uuid>), so this lives at its own
  // top-level path instead of depending on ROUTES being checked first.
  "documents-upload": documentsUpload,

  // Mint a fresh signed link for an already-saved document. Named for the same
  // reason as the line above — "documents/download" would sit under the
  // "documents/" prefix branch and depend on lookup order, which
  // src/http/routes.test.mjs refuses on purpose.
  //
  // Routed in the same commit as the handler, because the whole point of this
  // endpoint is that the retrieval half of the documents feature was built and
  // never connected: src/documents/retrieve.mjs's readers had zero callers, so
  // an uploaded ID or a generated letter was openable exactly once, for fifteen
  // minutes, in the reply to its own upload. An unrouted handler here would
  // reproduce that failure precisely.
  "documents-download": documentsDownload,

  // Consent capture — the gate in front of the route directly above. Routed in
  // the same commit as the handler, the migration and the screen, because an
  // unreachable consent endpoint is worse here than anywhere else in this map:
  // requestSoftPull() now REFUSES without a live consent row, so a 404 on this
  // path does not degrade the feature, it disables soft pulls entirely and the
  // only visible symptom is a 403 from a different endpoint.
  //
  // Serves staff AND client principals: the consumer captures their own consent
  // in the portal, and an employee may record one given on a call. Its role gate
  // is the same narrow set as finance/soft-pull and is spelled out in
  // api/consent/capture.mjs. Nothing behind it transmits.
  "consent/capture": consentCapture,

  // Client-facing soft-pull approval (signed link from Present). No session —
  // the URL is the credential. COMPLIANCE REVIEW REQUIRED — consent + identity.
  "soft-pull-approve": softPullApprove,

  // Payment links. ROLE_SETS.FINANCE, same gate as finance/subscriptions and
  // finance/cards — a payment link is a live request for a client's money,
  // the same class of action as starting a plan or filing a card. Nothing
  // behind it transmits: checkout_url is built by pure URL construction
  // (src/adapters/commas.mjs buildCommasCheckoutUrl), never a live Commas API
  // call. Routed in the same commit as the handler and the migration.
  "payment-links": paymentLinks,

  /* The self-serve paid round (331_paid_service_requests.sql,
     src/paid-services/). GET the price list, POST to mint a hosted checkout
     link. Charges nothing — no card is readable from this process. A HYPHEN and
     no slash on purpose: routes.test.mjs forbids a key under the "documents/"
     prefix branch, and a flat key is resolved by the exact lookup. */
  "paid-services": paidServices,

  /* A client ticks or unticks ONE of their own checklist steps (owner-set
     2026-09-17). CLIENT ONLY, pinned to the session's own file — no client_id
     parameter exists. Paydown and no-new-credit steps are refused server-side
     (src/waypoints/self-attest.mjs). Flat key, same reason as paid-services. */
  "waypoint-tick": waypointTick,

  /* ── Web push for the client portal (352_client_push_subscriptions.sql,
        src/push/) ───────────────────────────────────────────────────────────
     All three are CLIENT-ONLY and pinned to the caller's own file: there is no
     client_id parameter on any of them, so no call can register or retire a
     phone that is not the caller's own. Routed in the same commit as the
     handlers, the migration and the service worker — this map's header records
     three features shipped unreachable because nobody added these lines. */
  "push/key": pushKey,
  "push/subscribe": pushSubscribe,
  "push/unsubscribe": pushUnsubscribe,

  // ── The contract generator (124_contracts.sql, src/contracts/) ─────────────
  //
  // Routed in the SAME COMMIT as the handlers, the migration and both screens.
  // This map's header records three features that were built end to end and
  // shipped unreachable because nobody added the line here; a contract link that
  // 404s is the worst version of that failure, because the person hitting it is
  // a client who was told to sign something and cannot.
  //
  // THE THREE GATES ARE DIFFERENT AND MUST NOT BE MADE UNIFORM.
  //
  // "contracts" is the staff write surface, ROLE_SETS.STAFF — plus a NARROWER
  // owner/admin check inside the handler for the four actions that write
  // contract wording or void a contract. Contract copy carries legal weight and,
  // unlike message copy, has no second approval step downstream to catch a bad
  // edit; the words go straight onto a document somebody signs. Sending is
  // ordinary staff work and stays STAFF. public/app/contracts.html mirrors that
  // split by hiding one card, the same one-screen-two-gates shape
  // template-editor.html already uses.
  //
  // "read/contracts" is ROLE_SETS.STAFF, the same set that already reads a
  // client's tradelines and bank balances. It exposes nothing narrower.
  //
  // "contracts/sign" IS NOT ROLE GATED AND TAKES NO SESSION AT ALL. That is the
  // point of it: the caller is a consumer who has never signed in. Auth is the
  // HMAC on the link (src/contracts/signed-link.mjs), exactly as
  // api/documents/[id].mjs does it — fail closed with no secret, constant-time
  // comparison, and one undifferentiated 404 for a forged link, an unknown id
  // and a draft, so it cannot be used as an oracle for which contracts exist.
  //
  // NOTHING BEHIND ANY OF THE THREE TRANSMITS. `send` freezes the wording,
  // registers an immutable document version, and returns a link for a staff
  // member to pass on by hand. There is no email and no provider call:
  // src/messaging/providers/* is the only place outbound fetch may be added
  // (CLAUDE.md §12), and docs/CONTRACTS-SPEC.md §12 records that gap rather than
  // working around it.
  "contracts": contracts,
  "read/contracts": readContracts,
  "read/portal-contracts": readPortalContracts,
  "read/portal-summary": readPortalSummary,
  "read/client-progress": readClientProgress,
  "contracts/sign": contractsSign,

  // ── The outbound queue ─────────────────────────────────────────────────────
  //
  // THE ROUTE THAT MAKES THIS PLATFORM ABLE TO EMAIL ANYBODY. Twenty-six
  // workflows call sendTemplated(); every one writes a queued `messages` row;
  // and until this endpoint existed nothing ever drained that queue. The
  // dispatcher's own header records it: "dispatchDue() runs when something
  // calls it, and today nothing does." Every client email this platform ever
  // composed was sitting in a table, invisibly.
  //
  // `status` is ROLE_SETS.STAFF — whether mail is going out is operational
  // visibility, the same class as read/workflows. Everything else is
  // OWNER/ADMIN and the split lives inside the handler: draining the queue,
  // pausing sending and mailing an invoice backlog all put mail in front of
  // real people in bulk.
  //
  // THE SWITCH IS A ROW, NOT AN ENV VAR. messaging_settings.outbound_enabled
  // (119) is per company, visible in the CRM and attributed to whoever changed
  // it. src/messaging/outbox.mjs enforces it and a daily cap on every pass,
  // scheduled or manual, and the compliance gate still runs on every single
  // message underneath both. With no provider credentials nothing leaves
  // whatever any of it says — that is the real control and always was.
  //
  // Nothing behind this route transmits directly: outbound fetch lives in
  // src/messaging/providers/* and nowhere else (CLAUDE.md §12).
  //
  // ROUTED AS "messages-outbound", NOT "messages": the already-merged
  // staff-reply-inbox branch claims "messages" for a staff member's direct
  // reply to a client conversation. Both branches independently built a
  // handler named api/messages.mjs for two entirely different features; this
  // one was renamed at merge time rather than either feature being dropped
  // or the two being forced into one file. See docs/MERGE-LOG.md section 3.
  "messages-outbound": messagesOutbound,

  // marketing machine
  "marketing/settings": marketingSettings,
  "marketing/funnels": marketingFunnels,
  "marketing/health": marketingHealth,
  "marketing/scripts": marketingScripts,
  "marketing/script": marketingScript,
  "marketing/scripts/approve": marketingScriptsApprove,
  "marketing/scripts/edit": marketingScriptsEdit,
  "marketing/scripts/reject": marketingScriptsReject,
  "marketing/scripts/order": marketingScriptsOrder,
  "marketing/ideas": marketingIdeas,
  "marketing/rules": marketingRules,
  "marketing/scripts/fix": marketingScriptsFix,
  "marketing/batches": marketingBatches,
  "marketing/batches/write-now": marketingBatchesWriteNow,
  "marketing/jobs/retry": marketingJobsRetry,
  // the funnel builder (build unit X4): make, rename, write, push live, read one
  "marketing/funnel": marketingFunnel,
  "marketing/funnels/create": marketingFunnelsCreate,
  "marketing/funnels/rename": marketingFunnelsRename,
  "marketing/funnels/build": marketingFunnelsBuild,
  "marketing/funnels/push-live": marketingFunnelsPushLive,
  "marketing/meta/load": marketingMetaLoad,
  "marketing/meta/load-status": marketingMetaLoadStatus,
  "marketing/ads": marketingAds,
  "marketing/ad": marketingAd,
  "marketing/angles": marketingAngles,
  "marketing/funnels/stats": marketingFunnelsStats,
  "marketing/batches/next": marketingBatchesNext,
  // Build the avatar on the server (design slice 5a, unit X1): the cost reader, the
  // flywheel reader, the run and its poll, Approve, Tweak, Start a flywheel.
  "marketing/costs": marketingCosts,
  "marketing/flywheel": marketingFlywheel,
  "marketing/flywheel/run": marketingFlywheelRun,
  "marketing/flywheel/job": marketingFlywheelJob,
  "marketing/flywheel/approve": marketingFlywheelApprove,
  "marketing/flywheel/tweak": marketingFlywheelTweak,
  "marketing/flywheel/campaign": marketingFlywheelCampaign,
  // the research buttons (unit X2, design slice 10): Research it (J20) and
  // Research the market (J2, flywheel step 2)
  "marketing/research": marketingResearch,
  "marketing/research/approve": marketingResearchApprove,
  "marketing/research/tweak": marketingResearchTweak,
  "marketing/research/brain": marketingResearchBrain,
  // X3: the Ideas tab's flywheel (design §3.2 row 6)
  "marketing/flywheel/spend-read": marketingFlywheelSpendRead

  /* NOT ROUTED, ON PURPOSE — see ALLOWED_UNROUTED in src/http/routes.test.mjs
     for the current list and the reason attached to each entry. That list is
     EMPTY as of this integration pass: every handler file under api/ is either
     in this map or reached by one of the three prefix/short-circuit branches in
     handler() below. Adding a file under api/ now fails routes.test.mjs until
     somebody decides, in writing, whether it is reachable. */
};

/* A NUL byte anywhere in a query value makes Postgres raise
   "invalid byte sequence for encoding UTF8: 0x00" from inside whatever query
   the value reached, which surfaced as a 500 quoting the driver. Postgres text
   cannot hold a NUL at all, so no handler downstream could ever have done
   anything useful with one — reject it here, once, as the bad request it is. */
function hasNul(s) {
  if (typeof s !== "string") return false;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0) return true;
  return false;
}

function toQueryObject(searchParams) {
  // null-prototype: a key like "constructor" or "toString" must be absent, not
  // inherited. See the ROUTES lookup below for why that matters.
  const q = Object.create(null);
  for (const [k, v] of searchParams.entries()) q[k] = v;
  return q;
}

// routePath — the handler key for a request URL. The function can be reached
// two ways: directly on /api/* via config.path above, or on
// /.netlify/functions/api/* when netlify.toml's rewrite is what routed it.
// Both must reduce to the same key ("auth/session"), or the rewrite path
// 404s on every route. Exported so routes.test.mjs can assert that round-trip
// for every key in ROUTES rather than for the two somebody happened to try.
export function routePath(pathname) {
  return pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, "")
    .replace(/^\/api\/?/, "")
    .replace(/\/+$/, "");
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const path = routePath(url.pathname);

  /* /api/inngest is served by Inngest's own Web-standard handler, which takes a
     Request and returns a Response. It must NOT go through the (req, res) shim
     below: inngest/node's serve() reads the body as a stream and throws on the
     plain object the shim provides, which is why this endpoint 500'd on every
     POST and PUT even once it was routed. */
  if (path === "inngest") return inngestWeb(request);

  /* OWN properties only. `ROUTES[path]` walked the prototype chain, so
     /api/constructor, /api/toString, /api/valueOf, /api/hasOwnProperty and
     /api/__proto__ all resolved to a "route" — Object.prototype members — and
     answered 500 to an UNAUTHENTICATED caller instead of 404. */
  let route = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : undefined;
  const query = toQueryObject(url.searchParams);

  // /api/webhooks/:provider → the existing [provider].mjs with req.query.provider
  if (!route && path.startsWith("webhooks/")) {
    route = webhooks;
    query.provider = path.slice("webhooks/".length);
  }

  // /api/documents/:id → the signed-link download route.
  if (!route && path.startsWith("documents/")) {
    route = documentById;
    query.id = path.slice("documents/".length);
  }

  if (!route) {
    return new Response(JSON.stringify({ ok: false, error: "not_found", path }), {
      status: 404,
      headers: { "content-type": "application/json" }
    });
  }

  // Reject NUL bytes once, here, rather than letting each handler discover them
  // as a Postgres encoding error mid-query.
  for (const k of Object.keys(query)) {
    if (hasNul(query[k]) || hasNul(k)) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_parameter", param: hasNul(k) ? undefined : k }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
  }

  // ---- build req ----------------------------------------------------------
  const headers = {};
  for (const [k, v] of request.headers.entries()) headers[k.toLowerCase()] = v;

  const ctype = headers["content-type"] || "";
  // OPTIONS has no body. Waiting on request.text() for it never finishes, so the
  // apply-survey preflight sat until Netlify returned 504.
  const noBody = ["GET", "HEAD", "OPTIONS"].includes(request.method);

  /* multipart/form-data (file uploads) must NOT go through request.text():
     TextDecoder assumes UTF-8, so any byte sequence that is not valid UTF-8 —
     which is most of a jpg/png/pdf — comes out corrupted, silently, with no
     error to catch. request.formData() is the Web-standard parser and keeps
     each file's bytes intact as a File/Blob. Fields land in req.body.fields,
     files in req.body.files as [{ field, filename, mimeType, buffer, size }]
     — a handler never sees a raw FormData object, matching how every other
     handler here reads a plain req.body. */
  let rawBody = "";
  let body = "";
  if (!noBody && ctype.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields = {};
    const files = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "object" && value !== null && typeof value.arrayBuffer === "function") {
        files.push({
          field: key,
          filename: value.name || null,
          mimeType: value.type || null,
          buffer: Buffer.from(await value.arrayBuffer()),
          size: value.size
        });
      } else {
        fields[key] = value;
      }
    }
    body = { fields, files };
  } else {
    rawBody = noBody ? "" : await request.text();
    body = rawBody;
    if (rawBody && ctype.includes("application/json")) {
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    }
  }

  const ip =
    context?.ip ||
    headers["x-nf-client-connection-ip"] ||
    (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    null;

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    rawBody,
    socket: { remoteAddress: ip }
  };

  // ---- build res ----------------------------------------------------------
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200,
    _headers: { "content-type": "application/json" },
    _finished: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return this._headers[String(k).toLowerCase()]; },
    json(obj) { this._finish(JSON.stringify(obj)); },
    send(data) { this._finish(typeof data === "string" ? data : JSON.stringify(data)); },
    end(data) { this._finish(data ?? ""); },
    _finish(payload) {
      if (this._finished) return;
      this._finished = true;
      resolve(new Response(payload, { status: this.statusCode, headers: this._headers }));
    }
  };

  try {
    await route(req, res);
    // A handler that returned without writing gets a clean 500, not a hang.
    if (!res._finished) res.status(500).json({ ok: false, error: "handler_no_response" });
  } catch (err) {
    if (!res._finished) {
      // err.message quotes the DSN on a connection failure, so an
      // UNAUTHENTICATED caller could read the database host, port and username
      // straight out of a 500 body — POST /api/auth/login with the database
      // down was enough. Scrub it the same way health.mjs does.
      res.status(500).json({ ok: false, error: "internal_error", message: safeError(err) });
    }
  }
  return done;
}
