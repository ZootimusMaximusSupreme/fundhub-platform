const TEST_FILE_RE = /\b(?:src|api|scripts|e2e)\/[A-Za-z0-9_./-]+\.test\.mjs\b/g;

const MESSAGE_RESULT_CHAIN = Object.freeze([
  "src/messaging/gate.test.mjs",
  "src/messaging/dispatch.test.mjs",
]);

const JOURNEY_RESULT_TESTS = Object.freeze({
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

function checkedProof(depth, files, row) {
  const evidence = String(row?.evidence || "");
  const missing = files.filter((file) => !evidence.includes(file));
  if (missing.length) return undefined;

  return {
    depth,
    evidence: `Executable final-result tests: ${unique(files).join(", ")}`,
  };
}

function messageProof(row) {
  if (!new Set(["deep", "e2e"]).has(row?.coverage)) return undefined;

  const sourceTests = safeTestFiles(row.evidence);
  if (!sourceTests.length) return undefined;

  const sensitive = new Set(["money", "customerMessage", "customerData"]).has(row.impact);
  const deliveryTests = new Set(["money", "customerMessage"]).has(row.impact)
    ? MESSAGE_RESULT_CHAIN
    : [];

  return {
    depth: sensitive ? "deep" : "e2e",
    evidence: `Executable final-result tests: ${unique([...sourceTests, ...deliveryTests]).join(", ")}`,
  };
}

export function proofForFlowRow(sourceFile, row) {
  const file = basename(sourceFile);
  if (file === "messages.json") return messageProof(row);

  if (file === "journeys.json") {
    const files = JOURNEY_RESULT_TESTS[row?.surface];
    return files ? checkedProof("deep", files, row) : undefined;
  }

  if (file === "agents.json") {
    const files = AGENT_RESULT_TESTS[row?.surface];
    return files ? checkedProof("deep", files, row) : undefined;
  }

  return undefined;
}

export function proofTestFiles(proof) {
  return unique(String(proof?.evidence || "").match(TEST_FILE_RE) || []);
}

