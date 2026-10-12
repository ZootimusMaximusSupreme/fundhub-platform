const TEST_FILE_RE = /\b(?:src|api|scripts|e2e)\/[A-Za-z0-9_./-]+\.test\.mjs\b/g;

const MESSAGE_RESULT_CHAIN = Object.freeze([
  "src/messaging/gate.test.mjs",
  "src/messaging/dispatch.test.mjs",
]);

const CANDIDATE_OUTREACH_RESULT_TEST = "src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs";
const TEMPLATE_GATE_RESULT_TEST = "src/pulse/catalog/proofs/flow-batch-template-gates.test.mjs";
const JOURNEY_BATCH_RESULT_TEST = "src/pulse/catalog/proofs/flow-batch-journey-results.test.mjs";
const AGENT_BATCH_RESULT_TEST = "src/pulse/catalog/proofs/flow-batch-agent-runtime.test.mjs";

const MESSAGE_RESULT_TESTS = Object.freeze({
  "template:EMAIL-CANDIDATE-OUTREACH-1": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:EMAIL-CANDIDATE-OUTREACH-2": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:EMAIL-CANDIDATE-OUTREACH-3": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:EMAIL-CANDIDATE-OUTREACH-4": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:SMS-CANDIDATE-OUTREACH-1": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:SMS-CANDIDATE-OUTREACH-2": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:SMS-CANDIDATE-OUTREACH-3": [CANDIDATE_OUTREACH_RESULT_TEST],
  "template:SMS-CANDIDATE-OUTREACH-4": [CANDIDATE_OUTREACH_RESULT_TEST],
  "workflow:candidate-outreach": [CANDIDATE_OUTREACH_RESULT_TEST],
  "dispatch:claim-and-order": MESSAGE_RESULT_CHAIN,
  "script:message_templates seeder src/messaging/seed/seed.mjs": [
    "src/messaging/seed/parse.test.mjs",
    "src/messaging/seed/seed.test.mjs",
    "src/messaging/seed/workflow-keys.test.mjs",
    ...MESSAGE_RESULT_CHAIN,
  ],
});

const JOURNEY_RESULT_TESTS = Object.freeze({
  "journey:authorized-rep-intended#1-staff-add-rep": [JOURNEY_BATCH_RESULT_TEST],
  "journey:authorized-rep-intended#2-link-second-file": [JOURNEY_BATCH_RESULT_TEST],
  "journey:authorized-rep-intended#4-portal-opens-first-file": [JOURNEY_BATCH_RESULT_TEST],
  "journey:authorized-rep-intended#5-switch-file": [JOURNEY_BATCH_RESULT_TEST],
  "journey:authorized-rep-intended#6-messages-go-to-him": [JOURNEY_BATCH_RESULT_TEST],
  "journey:funding-round-flow#4-action-required": [JOURNEY_BATCH_RESULT_TEST],
  "journey:slo-offer-intended#4-after-pay-pull-form": [
    "src/http/slo-checkout.test.mjs",
    "src/slo/pull.test.mjs",
  ],
  "journey:slo-offer-intended#5-consent-and-identity": [
    "src/http/slo-pull.test.mjs",
    "src/slo/pull.test.mjs",
  ],
  "journey:slo-connections-intended#2-save-map": [
    "src/http/slo-connections.test.mjs",
    "src/slo/connections.test.mjs",
  ],
  "journey:slo-connections-intended#4-map-or-no-purchase": [
    "src/slo/connections.test.mjs",
    "src/slo/purchase.test.mjs",
  ],
  "journey:slo-connections-intended#5-client-id-required": [
    "src/slo/purchase.test.mjs",
  ],
  "journey:slo-connections-intended#6-one-purchase": [
    "src/slo/purchase.test.mjs",
  ],
  "journey:optimize-intended#4-no-fake-enroll": [
    "src/http/optimize-public.test.mjs",
  ],
  "journey:climate-lead-magnet-intended#5-count-and-names": [
    "src/http/climate-match.test.mjs",
  ],
  "journey:soft-pull-multi-biz-intended-draft#3-add-companies": [
    "src/http/soft-pull-approve.test.mjs",
    "src/slo/businesses.test.mjs",
  ],
  "journey:soft-pull-multi-biz-intended-draft#4-total": [
    "src/finance/soft-pull-pricing.test.mjs",
  ],
  "journey:ops-pulse-intended#2-read-does-not-write": [
    "src/http/ops-pulse.test.mjs",
    "src/ops/pulse.test.mjs",
  ],
  "journey:ops-pulse-intended#3-packed-calendar": [
    "src/ops/pulse.test.mjs",
  ],
  "journey:ops-pulse-intended#4-write-tasks-button": [
    "src/http/ops-pulse.test.mjs",
  ],
  "journey:ops-pulse-intended#5-no-fire-raise-bonus": [
    "src/ops/pulse.test.mjs",
  ],
  "journey:gate-relay-intended#1-skill-writes-gate": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#2-relay-sees-file": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#3-one-message": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#4-reply-text-or-voice": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#5-voice-fails-loud": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#6-unknown-sender": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
  "journey:gate-relay-intended#7-session-continues": [
    "scripts/gate-relay/gate-relay.test.mjs",
  ],
});

const AGENT_RESULT_TESTS = Object.freeze({
  "agent:AG-01": ["src/agents/runtime.test.mjs"],
  "agent:AG-02": ["src/agents/runtime.test.mjs"],
  "agent:AG-03": ["src/agents/runtime.test.mjs"],
  "agent:AG-05": ["src/agents/runtime.test.mjs"],
  "agent:AG-06": ["src/agents/runtime.test.mjs"],
  "agent:AG-08": ["src/agents/runtime.test.mjs"],
  "ai-caller:src/chat/portal-assistant.mjs": ["src/chat/portal-assistant.test.mjs"],
  "ai-caller:src/handlers/inbound-mms-docs.mjs": ["src/handlers/inbound-mms-docs.test.mjs"],
  "ai-caller:src/slo/reply-gate.mjs": ["src/slo/reply-gate.test.mjs"],
});

const AGENT_RUNTIME_RESULT_TESTS = Object.freeze({
  "agent:AG-09": [AGENT_BATCH_RESULT_TEST],
  "agent:VF-LIVE": [AGENT_BATCH_RESULT_TEST],
  "agent:VF-SHADOW": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A1": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A2": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A3": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A4": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A5": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-A7": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-DOC": [AGENT_BATCH_RESULT_TEST],
  "agent:GHL-RECON": [AGENT_BATCH_RESULT_TEST],
  "ai-caller:api/social/generate.mjs": ["src/http/social-generate-writer.test.mjs"],
  "ai-caller:src/repair/response-agent.mjs": ["src/repair/response-agent.test.mjs"],
  "ai-caller:src/brand/copy-generate.mjs": ["src/brand/copy-generate.test.mjs"],
});

function basename(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function safeTestFiles(evidence) {
  return unique((String(evidence || "").match(TEST_FILE_RE) || [])
    .filter((file) => !file.endsWith(".pg.test.mjs")));
}

function executableProof(depth, files, row) {
  return {
    depth,
    evidence: `Executable final-result tests: ${unique(files).join(", ")}`,
    asserts: row.control,
  };
}

function checkedProof(depth, files, row) {
  const evidence = String(row?.evidence || "");
  const missing = files.filter((file) => !evidence.includes(file));
  if (missing.length) return undefined;
  return executableProof(depth, files, row);
}

function messageProof(row) {
  const exactFiles = MESSAGE_RESULT_TESTS[row?.surface];
  if (exactFiles) return executableProof("deep", exactFiles, row);

  if (!new Set(["deep", "e2e"]).has(row?.coverage)) {
    return row?.surface?.startsWith("template:")
      ? executableProof("deep", [TEMPLATE_GATE_RESULT_TEST], row)
      : undefined;
  }

  const sourceTests = safeTestFiles(row.evidence);
  if (!sourceTests.length) {
    return row?.surface?.startsWith("template:")
      ? executableProof("deep", [TEMPLATE_GATE_RESULT_TEST], row)
      : undefined;
  }

  const sensitive = new Set(["money", "customerMessage", "customerData"]).has(row.impact);
  const deliveryTests = sensitive
    ? MESSAGE_RESULT_CHAIN
    : [];

  return {
    depth: sensitive ? "deep" : "e2e",
    evidence: `Executable final-result tests: ${unique([...sourceTests, ...deliveryTests]).join(", ")}`,
    asserts: row.control,
  };
}

export function proofForFlowRow(sourceFile, row) {
  const file = basename(sourceFile);
  if (file === "messages.json") return messageProof(row);

  if (file === "journeys.json") {
    const files = JOURNEY_RESULT_TESTS[row?.surface];
    if (!files) return undefined;
    return files.includes(JOURNEY_BATCH_RESULT_TEST)
      ? executableProof("deep", files, row)
      : checkedProof("deep", files, row);
  }

  if (file === "agents.json") {
    const runtimeFiles = AGENT_RUNTIME_RESULT_TESTS[row?.surface];
    if (runtimeFiles) return executableProof("deep", runtimeFiles, row);
    const files = AGENT_RESULT_TESTS[row?.surface];
    return files ? checkedProof("deep", files, row) : undefined;
  }

  return undefined;
}

export function proofTestFiles(proof) {
  return unique(String(proof?.evidence || "").match(TEST_FILE_RE) || []);
}

