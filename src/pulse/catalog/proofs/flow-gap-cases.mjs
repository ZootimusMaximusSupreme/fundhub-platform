export const FLOW_GAP_LANE = "src/pulse/coverage/gap-catalog-flow.mjs";
export const FLOW_GAP_TEST = "src/pulse/coverage/gap-catalog-flow.test.mjs";

const MESSAGE_CONTROL_SURFACES = new Set([
  "api-action:payment-link-send",
  "workflow:waypoint-nudge-sweeper",
  "dispatch:sms-duplicate-guard-NOT-WIRED",
  "job:staff-message-sweeper",
  "provider:web-push-and-client-push",
  "receipt:twilio-status-webhook",
  "inbound:suppression-and-slugs-src-mail",
  "api:POST /api/chat/messages",
  "api:POST /api/chat/portal-message",
  "ui:ops-admin outbound mail panel",
  "api:POST /api/message-templates",
  "api:POST /api/auth/send-portal-link",
  "api:POST /api/auth/magic-link and magic-link-verify",
  "owner-alert:owner_notifications queue (finance alerts)",
  "script:one-off senders in scripts/",
  "template-copy:seed-vs-live-drift",
  "template-copy:SQL-seeded-only-keys-not-in-doc-source",
  "manual-proof:comms-map-2026-09-19 (template delivery proof)",
]);

const JOURNEY_RESULT_SURFACES = new Set([
  "journey:slo-connections-intended#1-open-tab",
  "journey:optimize-intended#2-book-without-form",
  "journey:climate-lead-magnet-intended#1-headline-button",
  "journey:climate-lead-magnet-intended#2-reading-and-map",
  "journey:climate-lead-magnet-intended#3-state-click",
  "journey:climate-lead-magnet-intended#4-form",
  "journey:climate-lead-magnet-intended#6-gate",
  "journey:fh-consulting-intended#1-open-page",
  "journey:fh-consulting-intended#2-education-only",
  "journey:fh-consulting-intended#3-three-prices",
  "journey:fh-consulting-intended#4-legal-pages",
  "journey:fh-consulting-intended#5-request-enrollment",
  "journey:soft-pull-multi-biz-intended-draft#2-authorize-first",
  "journey:soft-pull-multi-biz-intended-draft#5-pay-same-page",
  "journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files",
]);

const DEAD_TEMPLATE_TRIGGER = Object.freeze([
  "trigger: no sender in src/, api/, netlify/, scripts/",
  "trigger: doc source copy for alias(es)",
  "trigger: retired / dormant",
]);

export function isInactiveTemplateRow(row) {
  return String(row?.surface || "").startsWith("template:")
    && DEAD_TEMPLATE_TRIGGER.some((marker) => String(row?.control || "").includes(marker));
}

export function needsMessageGapMonitor(row) {
  return isInactiveTemplateRow(row)
    || row?.surface === "template:payment_link_notice"
    || MESSAGE_CONTROL_SURFACES.has(row?.surface);
}

export function needsJourneyGapMonitor(row) {
  const roleAccess = /#(?:reach-.+|stays-blocked)$/.test(String(row?.surface || ""));
  return roleAccess || JOURNEY_RESULT_SURFACES.has(row?.surface);
}

export function needsAgentGapMonitor(row) {
  return row?.surface === "ai-caller:api/journeys/ask.mjs";
}

export function flowGapRows(messages, journeys, agents) {
  return [
    ...messages.filter(needsMessageGapMonitor).map((row) => ({ ...row, family: "message" })),
    ...journeys.filter(needsJourneyGapMonitor).map((row) => ({ ...row, family: "journey" })),
    ...agents.filter(needsAgentGapMonitor).map((row) => ({ ...row, family: "agent" })),
  ];
}

export const EXPECTED_FLOW_GAP_COUNTS = Object.freeze({
  message: 177,
  journey: 105,
  agent: 1,
});
