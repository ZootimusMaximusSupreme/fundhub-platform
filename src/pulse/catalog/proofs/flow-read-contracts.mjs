import agents from "../../../../ops/workflows/coverage-every-surface-2026-10-10/agents.json" with { type: "json" };
import journeys from "../../../../ops/workflows/coverage-every-surface-2026-10-10/journeys.json" with { type: "json" };
import messages from "../../../../ops/workflows/coverage-every-surface-2026-10-10/messages.json" with { type: "json" };

import {
  READ_GAPS,
  sourceFileForReadSurface,
} from "../../coverage/gap-catalog-reads.mjs";
import {
  flowGapRows,
  isInactiveTemplateRow,
} from "./flow-gap-cases.mjs";

export const FLOW_READ_CONTRACTS_EVIDENCE =
  "src/pulse/catalog/proofs/flow-read-contracts.test.mjs";

export function flowReadContractRowKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  const surface = String(row?.surface || "").trim();
  const control = String(row?.control || "").trim();
  return `${file}::${surface}::${control}`;
}

const DEFINITIONS = [
  {
    generatedId: "56ed07305fff5647c76a",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "agent-editor.html",
    control: "Page open: staff pickers for Owner and Escalate-to selects",
  },
  {
    generatedId: "f2208943199577941fde",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "agent-editor.html",
    control: "Promotion gate checklist (display: trigger, prompt 60+ chars, guardrail 20+ chars, escalation)",
  },
  {
    generatedId: "367dca0db64096fe33fd",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "affiliate.html",
    control: "License-unsigned banner and topbar chip (display, no button)",
  },
  {
    generatedId: "b79b6c45d9c1a7d5928e",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "campaign-manager.html",
    control: "Creative fatigue panel (CM-06: frequency, CTR, ROAS, recommendation, label)",
  },
  {
    generatedId: "da8a4cf5de4439e625b9",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "campaign-manager.html",
    control: "Connections panel (CM-07: state, verification, token, can launch, blockers)",
  },
  {
    generatedId: "870fcdab3aeb38c897d2",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "client-portal.html",
    control: "Page open: portal contracts read (Agreements tab)",
  },
  {
    generatedId: "c0d4748535fa446d98b1",
    sourceFile: "desks-e.json",
    family: "read",
    surface: "public/app/my-numbers.html",
    control: "Offer stack table: product, units sold, amount sold, cash collected, totals, retired product, reason when unknown",
  },
  {
    generatedId: "747ccb28609f24e35b68",
    sourceFile: "desks-e.json",
    family: "read",
    surface: "public/app/my-numbers.html",
    control: "Money boxes: Paid out, Pending funding, At risk (always a dash: not computed)",
  },
  {
    generatedId: "45fc2cb4fdba76f0538b",
    sourceFile: "desks-e.json",
    family: "read",
    surface: "public/app/my-numbers.html",
    control: "Streak strip (always the sentence: daily close streak is not stored yet)",
  },
  {
    generatedId: "9d48b89fdafd94c59f58",
    sourceFile: "desks-e.json",
    family: "read",
    surface: "public/app/partner-galaxy.html",
    control: "Partner census line in the header (N partners on file)",
  },
  {
    generatedId: "c476a7ee639a0cfe6488",
    sourceFile: "journeys.json",
    family: "journey",
    surface: "journey:slo-connections-intended#1-open-tab",
    control: "Owner opens Products and Commissions, SLO connections tab; sees funnel ID, ClickFunnels product, Fundhub product, on or off",
  },
  {
    generatedId: "d00cbba31d2f71b4516c",
    sourceFile: "journeys.json",
    family: "journey",
    surface: "journey:optimize-intended#2-book-without-form",
    control: "Book a call works with the three fields blank (opens https://apply.fundhub.ai/schedule/phonecall)",
  },
];

export const FLOW_READ_CONTRACTS = Object.freeze(DEFINITIONS.map((definition) => {
  const key = flowReadContractRowKey(definition.sourceFile, definition);
  return Object.freeze({
    ...definition,
    key,
    proof: Object.freeze({
      depth: "e2e",
      evidence: FLOW_READ_CONTRACTS_EVIDENCE,
      runner: "real-rendered-page",
      asserts: definition.control,
    }),
  });
}));

export const FLOW_READ_CONTRACT_ROW_KEYS = Object.freeze(
  FLOW_READ_CONTRACTS.map((entry) => entry.key),
);

const PROOF_BY_KEY = new Map(
  FLOW_READ_CONTRACTS.map((entry) => [entry.key, entry.proof]),
);

export function flowReadContractProof(sourceFile, row) {
  return PROOF_BY_KEY.get(flowReadContractRowKey(sourceFile, row)) || null;
}

const INBOUND_NOT_OUTBOUND = new Set([
  "inbound:suppression-and-slugs-src-mail",
  "api:POST /api/chat/portal-message",
]);

const CURRENT_FLOW_RED = flowGapRows(messages, journeys, agents).filter((row) => (
  !isInactiveTemplateRow(row) && !INBOUND_NOT_OUTBOUND.has(row.surface)
));
const CURRENT_READ_RED = READ_GAPS.map((row) => ({
  ...row,
  family: "read",
  sourceFile: sourceFileForReadSurface(row.surface),
}));
const provedKeys = new Set(FLOW_READ_CONTRACT_ROW_KEYS);

function flowMissingReason(row) {
  if (row.family === "message") {
    return "No real trigger-to-copy-to-placeholder-to-fake-provider final receipt contract was completed in this shard.";
  }
  if (row.family === "agent") {
    return "The caller still supplies both prompts, so there is no fixed live prompt result to run and judge.";
  }
  if (/#reach-|#stays-blocked$/.test(row.surface)) {
    return "The full named route group still needs signed-in allowed and denied requests for the named role.";
  }
  return "The full named journey still needs ordered observable results from the real page or workflow.";
}

export const FLOW_READ_UNPROVED = Object.freeze([
  ...CURRENT_FLOW_RED.map((row) => ({
    family: row.family,
    sourceFile: row.family === "agent" ? "agents.json" : row.family === "message" ? "messages.json" : "journeys.json",
    surface: row.surface,
    control: row.control,
    reason: flowMissingReason(row),
  })),
  ...CURRENT_READ_RED.map((row) => ({
    family: row.family,
    sourceFile: row.sourceFile,
    surface: row.surface,
    control: row.control,
    reason: row.finding,
  })),
].filter((row) => !provedKeys.has(flowReadContractRowKey(row.sourceFile, row))));

export const FLOW_READ_CURRENT_RED_COUNTS = Object.freeze({
  flow: CURRENT_FLOW_RED.length,
  read: CURRENT_READ_RED.length,
  total: CURRENT_FLOW_RED.length + CURRENT_READ_RED.length,
  proved: FLOW_READ_CONTRACTS.length,
  unproved: FLOW_READ_UNPROVED.length,
});
