// Slice 2 (customer messages): flow rows proved by a test that exercises the
// exact named result. Two kinds so far:
//
//   - the role journeys' "should be able to reach" and "should stay blocked"
//     rows, proved by a signed-in probe of every route through the real adapter
//     (s2-role-route-reach.test.mjs).
//   - seven customer-message controls, proved by the real handler run with a
//     stand-in queue and the in-memory provider (the s2-message-routes tests).
//
// A surface listed here leaves the Flow gap monitor (flow-gap-cases.mjs) and its
// row carries the proof below instead.
const ROLE_ROW =
  /^journey:(?:role-owner|role-sales-manager|role-closer|role-funding-advisor|role-inquiry-remover|client|affiliate|white-label)-intended#(?:reach-.+|stays-blocked)$/;

export const S2_ROLE_REACH_TEST = "src/pulse/catalog/proofs/s2-role-route-reach.test.mjs";

function basename(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

export function isS2RoleRow(row) {
  return ROLE_ROW.test(String(row?.surface || ""));
}

const AUTH_TEST = "src/http/s2-message-routes-auth.test.mjs";
const CHAT_TEST = "src/http/s2-message-routes-chat.test.mjs";
const WRITE_TEST = "src/http/s2-message-routes-write.test.mjs";
const OUTBOUND_TEST = "src/http/s2-message-routes-outbound.test.mjs";
const FLOW_PAGES_WRAPPER = "src/pulse/catalog/proofs/s2-flow-pages.test.mjs";
// The gate and the dispatcher: every message row's proof also runs these.
const MESSAGE_CHAIN = Object.freeze(["src/messaging/gate.test.mjs", "src/messaging/dispatch.test.mjs"]);

// message surface -> the tests that judge its exact final result
const MESSAGE_TESTS = Object.freeze({
  "api:POST /api/message-templates": [WRITE_TEST],
  "api:POST /api/auth/send-portal-link": [AUTH_TEST],
  "api:POST /api/auth/magic-link and magic-link-verify": [AUTH_TEST],
  "api:POST /api/chat/messages": ["src/http/chat-messages-handler.test.mjs", CHAT_TEST],
  "template:payment_link_notice": [CHAT_TEST],
  "api-action:payment-link-send": [CHAT_TEST],
  "ui:ops-admin outbound mail panel": [FLOW_PAGES_WRAPPER, OUTBOUND_TEST],
});

// journey surface -> the tests that judge its exact result
const JOURNEY_TESTS = Object.freeze({
  "journey:fh-consulting-intended#1-open-page": [FLOW_PAGES_WRAPPER],
  "journey:fh-consulting-intended#4-legal-pages": [FLOW_PAGES_WRAPPER],
});

// These two already carry a rendered-page proof (flow-read-contracts.test.mjs,
// attached first in proofForFlowRow) but were still listed in the Flow gap
// monitor. They leave it here; the proof they carry is unchanged.
const ALREADY_PROVED_SURFACES = Object.freeze(new Set([
  "journey:slo-connections-intended#1-open-tab",
  "journey:optimize-intended#2-book-without-form",
]));

/** True when a slice-2 test owns this Flow row, so no gap monitor should. */
export function isS2ProvedFlowRow(row) {
  const surface = String(row?.surface || "");
  return isS2RoleRow(row)
    || Object.hasOwn(MESSAGE_TESTS, surface)
    || Object.hasOwn(JOURNEY_TESTS, surface)
    || ALREADY_PROVED_SURFACES.has(surface);
}

export function s2FlowProof(sourceFile, row) {
  if (basename(sourceFile) === "journeys.json" && isS2RoleRow(row)) {
    return {
      depth: "deep",
      evidence: `${S2_ROLE_REACH_TEST} src/pulse/catalog/proofs/s2-role-probe.mjs`,
      asserts: row.control,
    };
  }
  if (basename(sourceFile) === "journeys.json" && Object.hasOwn(JOURNEY_TESTS, String(row?.surface || ""))) {
    return {
      depth: "deep",
      evidence: `Executable final-result tests: ${JOURNEY_TESTS[row.surface].join(", ")}`,
      asserts: row.control,
    };
  }
  if (basename(sourceFile) === "messages.json" && Object.hasOwn(MESSAGE_TESTS, String(row?.surface || ""))) {
    return {
      depth: "deep",
      evidence: `Executable final-result tests: ${[...MESSAGE_TESTS[row.surface], ...MESSAGE_CHAIN].join(", ")}`,
      asserts: row.control,
    };
  }
  return null;
}
