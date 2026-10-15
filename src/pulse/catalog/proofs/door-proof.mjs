import { keyContractProof } from "./door-batch-key-contract.mjs";
import { routeContractProof } from "./door-batch-route-contract.mjs";
import { routeExactProof } from "./door-batch-route-exact.mjs";
import { routeResultProof } from "./door-batch-route-result.mjs";
import { webhookFinalProof } from "./door-batch-webhook-final.mjs";
import { doorContractsRoutes01Proof } from "./door-contracts-routes-01.mjs";
import { doorContractsRoutes012Proof } from "./door-contracts-routes-01-2.mjs";
import { doorContractsRoutes23Proof } from "./door-contracts-routes-23.mjs";
import { doorContractsMoneyCustomerProof } from "./door-contracts-money-customer.mjs";
import { s2DoorProof } from "./s2-door-contracts.mjs";
import { doorFlowReadDoorProof } from "./door-flow-read-contracts-2.mjs";
import { s3DoorProof } from "./s3-door-contracts.mjs";
import { s1DoorContractsProof } from "./s1-door-contracts.mjs";
import { s5DoorProof } from "./s5-door-contracts.mjs";
import { finB24DoorProof } from "./fin-b24-door-contracts.mjs";
import { keyHealthProof } from "../../coverage/gap-door-batch-keys.mjs";
import { jobResultProof } from "../../coverage/gap-door-batch-jobs.mjs";
import { webhookResultProof } from "../../coverage/gap-door-batch-webhooks.mjs";

const FILE_RE = /\b(?:(?:src|api|netlify|scripts|e2e)\/)?[A-Za-z0-9_./[\]-]+\.mjs\b/g;

const DEEP_IMPACTS = new Set(["money", "customerMessage", "customerData"]);

const DIRECT_TEST_GAP_RE = /\b(?:no test (?:invokes|imports|runs)|no test calls|module-level(?: only)?|handler is never invoked by a test|only reads the file text|only lints|return value only|tests show the secret guard)\b/i;
const RESULT_GAP_RE = /\b(?:partial deep|downstream only|adjacent live|not (?:this|the) (?:route|door|write|read|save|result)|does not (?:run|read|name|cover)|never (?:runs|reads|checks)|not whether|nothing checks|no (?:deep|pulse|lane|check) (?:reads|runs|covers|watches|tests))\b/i;

const WEBHOOK_PROOFS = new Map(Object.entries({
  "webhook:POST /api/webhooks/commas": {
    depth: "deep",
    evidence: "src/adapters/commas.test.mjs src/payments/commas-inbox.pg.test.mjs src/pulse/coverage/gap-webhooks.mjs src/pulse/coverage/gap-webhooks.test.mjs src/pulse/beats/beat-pay-webhook.mjs src/pulse/beats/beat-pay-webhook.test.mjs src/pulse/coverage/gap-payments.mjs src/pulse/coverage/gap-payments.test.mjs",
  },
  "webhook:POST /api/webhooks/clickfunnels": {
    depth: "deep",
    evidence: "src/adapters/clickfunnels.test.mjs src/pulse/coverage/gap-leads.mjs src/pulse/coverage/gap-leads.test.mjs src/pulse/coverage/gap-calls.mjs src/pulse/coverage/gap-calls.test.mjs",
  },
  "webhook:POST /api/webhooks/inquiry-removal": {
    depth: "deep",
    evidence: "src/adapters/inquiry-removal.test.mjs src/pulse/coverage/gap-pipeline-facts.mjs src/pulse/coverage/gap-pipeline-facts.test.mjs",
  },
  "webhook:POST /api/webhooks/twilio": {
    depth: "deep",
    evidence: "src/adapters/twilio.test.mjs src/pulse/coverage/gap-opt-out.mjs src/pulse/coverage/gap-opt-out.test.mjs",
  },
  "webhook:POST /api/webhooks/twilio-status": {
    depth: "deep",
    evidence: "src/http/webhooks-status.pg.test.mjs src/pulse/coverage/gap-webhooks.mjs src/pulse/coverage/gap-webhooks.test.mjs src/pulse/coverage/gap-sms.mjs src/pulse/coverage/gap-sms.test.mjs",
  },
  "webhook:POST /api/webhooks/resend": {
    depth: "deep",
    evidence: "src/adapters/resend-events.test.mjs src/pulse/coverage/gap-webhooks.mjs src/pulse/coverage/gap-webhooks.test.mjs",
  },
  "webhook:POST|PUT|GET /api/inngest": {
    depth: "deep",
    evidence: "src/workflows/index.test.mjs src/pulse/beats/beat-engine-alive.mjs src/pulse/beats/beat-engine-alive.test.mjs src/pulse/coverage/gap-keys.mjs src/pulse/coverage/gap-keys.test.mjs",
  },
  "webhook:GET|POST /api/contracts/sign": {
    depth: "deep",
    evidence: "src/http/contracts-endpoints.pg.test.mjs src/pulse/coverage/gap-contracts.mjs src/pulse/coverage/gap-contracts.test.mjs",
  },
  "webhook:GET /api/public/morning-brief": {
    depth: "deep",
    evidence: "src/http/morning-brief-public.test.mjs src/pulse/beats/beat-brief-link.mjs src/pulse/beats/beat-brief-link.test.mjs",
  },
  "webhook:POST /api/public/survey-submit": {
    depth: "deep",
    evidence: "src/http/survey-submit.test.mjs src/pulse/beats/beat-doors-live.mjs src/pulse/beats/beat-doors-live.test.mjs src/pulse/coverage/gap-funnels.mjs src/pulse/coverage/gap-funnels.test.mjs src/pulse/coverage/gap-handoff.mjs src/pulse/coverage/gap-handoff.test.mjs",
  },
  "webhook:GET|POST /api/public/slo-interest": {
    depth: "deep",
    evidence: "src/http/slo-interest.test.mjs src/http/slo-interest-track.pg.test.mjs src/pulse/beats/beat-doors-live.mjs src/pulse/beats/beat-doors-live.test.mjs src/pulse/coverage/gap-leads.mjs src/pulse/coverage/gap-leads.test.mjs src/pulse/coverage/gap-handoff.mjs src/pulse/coverage/gap-handoff.test.mjs",
  },
  "webhook:GET|POST /api/consent/capture": {
    depth: "deep",
    evidence: "src/http/consent-capture.test.mjs src/pulse/coverage/gap-consent.mjs src/pulse/coverage/gap-consent.test.mjs src/pulse/coverage/gap-records.mjs src/pulse/coverage/gap-records.test.mjs",
  },
  "webhook:GET /api/documents/[id]": {
    depth: "deep",
    evidence: "src/http/documents-download.pg.test.mjs src/pulse/coverage/gap-documents.mjs src/pulse/coverage/gap-documents.test.mjs",
  },
  "webhook:POST netlify/functions/marketing-worker-background": {
    depth: "e2e",
    evidence: "src/marketing/worker.test.mjs src/pulse/coverage/gap-marketing-queue.mjs src/pulse/coverage/gap-marketing-queue.test.mjs",
  },
  "webhook:POST netlify/functions/teleprompter-live-text": {
    depth: "e2e",
    evidence: "src/http/teleprompter-live-text.test.mjs",
  },
  "webhook:POST /api/webhooks/submagic": {
    depth: "e2e",
    evidence: "src/http/submagic-webhook.test.mjs",
  },
  "webhook:POST /api/public/vsl-watch": {
    depth: "e2e",
    evidence: "src/http/vsl-watch.pg.test.mjs src/vsl/watch-beacon.test.mjs",
  },
  "webhook:POST /api/ops/notify-owner": {
    depth: "e2e",
    evidence: "src/http/notify-owner.test.mjs",
  },
  "webhook:GET|POST /api/public/ad-video-approve": {
    depth: "e2e",
    evidence: "src/http/ad-video-approve.pg.test.mjs",
  },
}));

const FAILED_FOCUSED_WEBHOOKS = new Set([
  "webhook:POST /api/webhooks/twilio-status",
  "webhook:GET|POST /api/contracts/sign",
  "webhook:GET|POST /api/public/ad-video-approve",
  "webhook:GET /api/documents/[id]",
  "webhook:POST /api/public/vsl-watch",
]);

const FAILED_FOCUSED_TESTS = new Set([
  "content-tiles.test.mjs",
  "creative-run.test.mjs",
  "marketing-offer-generate.test.mjs",
  "payment-links-endpoints.test.mjs",
]);

const DENIED_MAP_PROOFS = [
  ["routes-0.json", "route:chat/messages", /kind=client/],
  ["routes-1.json", "route:auth/reset", /action=request/],
  ["routes-1.json", "route:bookings", /^GET /],
  ["routes-1.json", "route:closer-deck", /action=generate_letters/],
  ["routes-1.json", "route:messages-outbound", /action=settings/],
  ["routes-1.json", "route:public/slo-pull", /OPTIONS preflight/],
  ["routes-2.json", "route:auth/send-portal-link", /^POST /],
  ["routes-2.json", "route:blueprint/declines", /^GET\/POST /],
  ["routes-3.json", "route:lender-observations", /^POST /],
];

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function proofReferences(evidence) {
  return unique((String(evidence || "").match(FILE_RE) || []).filter((reference) =>
    !["test.mjs", "pg.test.mjs"].includes(reference)
  ));
}

function isTest(reference) {
  return reference.endsWith(".test.mjs") && !reference.endsWith(".pg.test.mjs");
}

function failedFocusedTest(reference) {
  return FAILED_FOCUSED_TESTS.has(String(reference || "").split("/").at(-1));
}

function isResultCheck(reference) {
  return (
    /(?:^|\/)src\/pulse\/(?:coverage\/gap-|beats\/beat-)/.test(reference) ||
    /^(?:gap-|beat-)[A-Za-z0-9_.-]+\.mjs$/.test(reference)
  ) && !isTest(reference);
}

function companionTest(reference) {
  return isResultCheck(reference) ? reference.replace(/\.mjs$/, ".test.mjs") : null;
}

function neededDepth(row) {
  return DEEP_IMPACTS.has(row?.impact) ? "deep" : "e2e";
}

function auditedMapProof(row) {
  const evidence = String(row?.evidence || "");
  const references = proofReferences(evidence);
  if (references.some(failedFocusedTest)) return null;
  const tests = references.filter((reference) => isTest(reference) && !failedFocusedTest(reference));
  const resultChecks = references.filter(isResultCheck);
  const depth = neededDepth(row);

  if (!tests.length || DIRECT_TEST_GAP_RE.test(evidence)) return null;
  if (!new Set(["e2e", "deep"]).has(row?.coverage)) return null;
  if (depth === "deep") {
    if (row.coverage !== "deep" || !resultChecks.length || RESULT_GAP_RE.test(evidence)) return null;
  }

  const executable = unique([
    ...tests,
    ...resultChecks,
    ...resultChecks.map(companionTest),
  ]);
  return { depth, evidence: executable.join(" "), asserts: row.control };
}

function isDeniedMapProof(sourceFile, row) {
  const name = String(sourceFile || "").split(/[\\/]/).at(-1);
  return DENIED_MAP_PROOFS.some(([file, surface, control]) =>
    file === name && surface === row?.surface && control.test(String(row?.control || ""))
  );
}

function keyProof(row) {
  if (row?.coverage === "deep") {
    const references = proofReferences(row.evidence);
    const resultChecks = references.filter(isResultCheck);
    if (resultChecks.length) {
      const executable = unique([...resultChecks, ...resultChecks.map(companionTest)]);
      return { depth: "deep", evidence: executable.join(" "), asserts: row.control };
    }
  }
  const health = keyHealthProof(row);
  if (health) return health;
  return keyContractProof(row);
}

function webhookProof(row) {
  const final = webhookFinalProof(row);
  if (final) return final;
  const proof = FAILED_FOCUSED_WEBHOOKS.has(row?.surface) ? null : WEBHOOK_PROOFS.get(row?.surface);
  if (proof) {
    const evidence = proofReferences(proof.evidence)
      .filter((reference) => !reference.endsWith(".pg.test.mjs") && !failedFocusedTest(reference))
      .join(" ");
    return { ...proof, evidence, asserts: row.control };
  }
  return webhookResultProof(row);
}

export function proofForDoor(sourceFile, row) {
  const name = String(sourceFile || "").split(/[\\/]/).at(-1);
  const plugIn = doorFlowReadDoorProof(sourceFile, row)
    || doorContractsMoneyCustomerProof(sourceFile, row)
    || s2DoorProof(sourceFile, row)
    || s1DoorContractsProof(sourceFile, row)
    || doorContractsRoutes01Proof(sourceFile, row)
    || doorContractsRoutes012Proof(sourceFile, row)
    || doorContractsRoutes23Proof(row)
    || s3DoorProof(sourceFile, row)
    || s5DoorProof(sourceFile, row)
    || finB24DoorProof(sourceFile, row);
  if (plugIn) return plugIn;
  if (name === "keys.json") return keyProof(row);
  if (name === "webhooks.json") {
    if (isDeniedMapProof(sourceFile, row)) return null;
    return webhookProof(row);
  }
  if (name === "jobs.json") {
    if (isDeniedMapProof(sourceFile, row)) return null;
    const result = jobResultProof(row);
    if (result) return result;
    return auditedMapProof(row);
  }
  if (name === "jobs.json" || /^routes-[0-3]\.json$/.test(name)) {
    const exact = routeExactProof(row);
    if (exact) return exact;
    const contract = routeContractProof(row);
    if (contract) return contract;
    if (/^routes-[0-3]\.json$/.test(name)) {
      const audited = isDeniedMapProof(sourceFile, row) ? null : auditedMapProof(row);
      return audited || routeResultProof(row);
    }
    return isDeniedMapProof(sourceFile, row) ? null : auditedMapProof(row);
  }
  return null;
}
