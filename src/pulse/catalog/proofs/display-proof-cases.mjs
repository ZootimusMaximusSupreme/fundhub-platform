import { PUBLIC_UI_PROOF_CASES } from "./display-batch-public-ui.mjs";
import { STAFF_UI_PROOF_CASES } from "./display-batch-staff-ui.mjs";
import { DISPLAY_CONTRACTS_AB } from "./display-contracts-ab.mjs";
import { DISPLAY_CONTRACTS_AB_2 } from "./display-contracts-ab-2.mjs";
import { DISPLAY_CONTRACTS_AB_3 } from "./display-contracts-ab-3.mjs";
import { DISPLAY_CONTRACTS_CD_PROOFS } from "./display-contracts-cd.mjs";
import { DISPLAY_CONTRACTS_CD_2_PROOFS } from "./display-contracts-cd-2.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES } from "./display-contracts-ef-public.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES } from "./display-contracts-ef-public-2.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES } from "./display-contracts-ef-public-3.mjs";
import { DISPLAY_CONTRACTS_MONEY_2_PROOFS } from "./display-contracts-money-2.mjs";
import { DISPLAY_CONTRACTS_SHELLS_1 } from "./display-contracts-shells-1.mjs";
import { DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES } from "./display-contracts-teams-social-1.mjs";
import { DISPLAY_CONTRACTS_TELEPROMPTER_4 } from "./display-contracts-teleprompter-4.mjs";
import { READ_PROOF_CASES } from "./read-proof-cases.mjs";
import { S2_DISPLAY_PROOF_CASES } from "./s2-display-contracts.mjs";
import { S4_DISPLAY_PROOF_CASES } from "./s4-display-proofs.mjs";
import { S1_DISPLAY_SPEC_PROOFS } from "./s1-display-specs.mjs";
import { S5_DISPLAY_PROOF_CASES } from "./s5-display-contracts.mjs";
import { FIN_B04_DISPLAY_PROOF_CASES } from "./fin-b04-display-results.mjs";
import {
  DISPLAY_RESULT_LANE,
  displaySavedResultContract,
  isTrackedDisplayControl,
} from "./display-saved-result.mjs";

function proofCase(sourceFile, surface, control, tests, depth = "deep") {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    depth,
    evidence: tests.join("; "),
    tests: Object.freeze([...tests]),
  });
}

const MONEY_OVERVIEW_TESTS = [
  "src/http/money-overview.test.mjs",
  "src/http/money-screen.test.mjs",
  "src/http/financeos-screen.test.mjs",
  "src/finance/money-overview.test.mjs",
];

const MONEY_BANKS_TESTS = [
  "src/http/money-banks.test.mjs",
  "src/http/money-banks-screen.test.mjs",
  "src/finance/bank-strategy.test.mjs",
];

const MONEY_ALERTS_TESTS = [
  "src/http/money-alerts.test.mjs",
  "src/http/money-alerts-screen.test.mjs",
  "src/finance/file-alerts/payment-timing.test.mjs",
  "src/finance/file-alerts/cash-reserve.test.mjs",
  "src/finance/file-alerts/new-credit.test.mjs",
];

const MONEY_ACCOUNTS_TESTS = [
  "src/http/money-accounts.test.mjs",
  "src/http/money-accounts-screen.test.mjs",
  "src/finance/money-accounts.test.mjs",
  "src/finance/containers.test.mjs",
];

const MONEY_PAYMENTS_TESTS = [
  "src/http/money-payments.test.mjs",
  "src/http/money-payments-screen.test.mjs",
  "src/finance/clarity-payments.test.mjs",
];

const BASE_DISPLAY_PROOF_CASES = Object.freeze([
  proofCase(
    "desks-b.json",
    "financeos.html (frame)",
    "Header: client name, and the 'Test data - Plaid sandbox' banner (from the one overview read)",
    MONEY_OVERVIEW_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#overview",
    "Overview read: 'What you have' (personal, business, not sure yet, never added together), 'What you owe', 'Cards used', 'Next due'",
    MONEY_OVERVIEW_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#overview",
    "Overview read: Tip, Coming up, Repeating bills, Containers, Debt (by container, by card, by loan), Cashflow charts, plan billing line",
    MONEY_OVERVIEW_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#next",
    "Next steps list: each task with status, due date, who can do it (agent, person, self)",
    [
      "src/http/money-tasks.test.mjs",
      "src/http/money-next-screen.test.mjs",
      "src/finance/money-tasks.test.mjs",
    ],
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#banks",
    "Banks near you, Card stacking order, Next funding sequence date, Your bank relationships (each rule with its source)",
    MONEY_BANKS_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#strategy",
    "Payoff plan read (every card and loan, safe amount each month) and the live math",
    [
      "src/http/money-strategy.test.mjs",
      "src/http/money-strategy-screen.test.mjs",
      "src/finance/payment-strategy.test.mjs",
      "src/finance/payment-strategy-math.test.mjs",
    ],
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#fundability",
    "Fundability picture (score path, what to fix) read only",
    [
      "src/http/money-fundability.test.mjs",
      "src/http/money-fundability-screen.test.mjs",
      "src/finance/fundability.test.mjs",
    ],
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#alerts",
    "File protection alerts read: what each of four texts watches, when it texts next, what already went out",
    MONEY_ALERTS_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#accounts",
    "Containers and accounts read (businesses with their info, 'you', 'Not sorted yet', a 'Move to...' on every bank row)",
    MONEY_ACCOUNTS_TESTS,
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#connections",
    "Connections read: tiles, three processor cards (Commas, Whop, open API), month table per container, sales line under the section",
    [
      "src/http/money-connections.test.mjs",
      "src/http/money-connections-screen.test.mjs",
      "src/http/money-trends-screen.test.mjs",
    ],
  ),
  proofCase(
    "desks-b.json",
    "financeos.html#setup",
    "Setup steps read (pay setup fee, run soft pull, add businesses and accounts, you're live)",
    [
      "src/http/money-setup.test.mjs",
      "src/http/money-setup-screen.test.mjs",
      "src/finance/money-setup.test.mjs",
    ],
  ),
  proofCase(
    "desks-c.json",
    "money-accounts.html",
    "Page load: containers (businesses, personal), accounts, cards, loans, 'Not sorted yet' list",
    MONEY_ACCOUNTS_TESTS,
  ),
  proofCase(
    "desks-c.json",
    "money-accounts.html",
    "Billing line: containers with accounts, price per container a month, total a month ('$X' when the price is unset)",
    ["src/http/money-accounts-screen.test.mjs"],
  ),
  proofCase(
    "desks-c.json",
    "money-alerts.html",
    "Page load: four protections, cards with next statement close and promo, two cash cushion verdicts, texts already sent",
    MONEY_ALERTS_TESTS,
  ),
  proofCase(
    "desks-c.json",
    "money-banks.html",
    "Page load: tiles (next funding sequence date, estimated amount, bank relationships), banks near you, card stacking order, relationships table",
    MONEY_BANKS_TESTS,
  ),
  proofCase(
    "desks-c.json",
    "money-banks.html",
    "Card stacking order and bank rules with their source tags (display)",
    MONEY_BANKS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-fundability.html",
    "Tile: Funding estimate (dollar figure, 'not a bank's yes')",
    [
      "src/http/money-fundability-screen.test.mjs",
      "src/finance/fundability.test.mjs",
    ],
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-fundability.html",
    "Business card per container (score, tier, estimate, six checks, projection table)",
    ["src/http/money-fundability-screen.test.mjs"],
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-helper.html",
    "Action cards: Reminder set / Added to your plan / A person will reach out / Marked in progress / Transfer proposal (Needs your approval) / Decline saved / Helper stopped",
    [
      "src/http/money-helper-screen.test.mjs",
      "src/finance/money-helper.test.mjs",
    ],
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-next.html",
    "Assignment status line (needs your yes / approved / working on it / done / failed / stopped)",
    ["src/http/money-next-screen.test.mjs"],
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-payments.html",
    "Tile: You owe Fundhub (left to pay, open plans)",
    MONEY_PAYMENTS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-payments.html",
    "Tile: Late now (amount, Late N days, plans)",
    MONEY_PAYMENTS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-payments.html",
    "Tile: Next payment (date, amount, plan)",
    MONEY_PAYMENTS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-payments.html",
    "Payment plan card: left to pay, paid so far, next payment, progress bar, schedule table (Paid / Late / Due soon / Coming up)",
    MONEY_PAYMENTS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-payments.html",
    "Coming up list (next 30 days: payments to Fundhub, card payments, bills)",
    MONEY_PAYMENTS_TESTS,
  ),
  proofCase(
    "desks-d.json",
    "public/app/money-setup.html",
    "Your price card (setup fee, per container per month, containers; $X when not set)",
    [
      "src/http/money-setup.test.mjs",
      "src/http/money-setup-screen.test.mjs",
    ],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-transfers.html",
    "approve (server): the client's yes starts the move; any changed amount, account or date is refused; staff and authorized representatives refused; off means nothing sent",
    [
      "src/http/money-transfers.test.mjs",
      "src/finance/money-transfers.test.mjs",
    ],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-transfers.html",
    "cancel (server): client or staff stops a proposal or a move that has not reached the bank",
    [
      "src/http/money-transfers.test.mjs",
      "src/finance/money-transfers.test.mjs",
    ],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-transfers.html",
    "propose (server): staff set up a move that waits for the client's yes; nothing moves",
    [
      "src/http/money-transfers.test.mjs",
      "src/finance/money-transfer-seam.test.mjs",
    ],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-vault.html",
    "accept (server): marks the file accepted with months/years covered and the date on the paper",
    ["src/http/money-vault.test.mjs"],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-vault.html",
    "reject (server): reason required, shown to the client",
    ["src/http/money-vault.test.mjs"],
  ),
  proofCase(
    "desks-e.json",
    "public/app/money-vault.html",
    "add_item (server): a staff-added line the client then sees and can send",
    [
      "src/http/money-vault.test.mjs",
      "src/http/money-vault-screen.test.mjs",
    ],
  ),
  proofCase(
    "desks-e.json",
    "public/app/partner-galaxy.html",
    "'Your page' address in the header: live apply address as a link, or 'draft, not live yet - publish it in Brand Studio', or 'none made yet - open Brand Studio'",
    ["src/http/partner-galaxy-banner.test.mjs"],
  ),
  proofCase(
    "desks-e.json",
    "public/app/pipeline.html",
    "pipeline-cards move (server): staff move a client's card to a stage, owners exempt from the shift gate, other org is 404, a Funded move needs a dollar amount",
    ["src/http/pipeline-cards.test.mjs"],
  ),
  proofCase(
    "desks-e.json",
    "public/app/pipeline.html",
    "client-archive (server): removes every card and stamps crm_archived_at; payments and credit pulls stay",
    ["src/http/client-archive.test.mjs"],
  ),
  proofCase(
    "desks-f.json",
    "present.html (+ present.js, contract-send.js)",
    "EDUCATION PATH button (S-07)",
    ["src/http/present-blueprint-stack.test.mjs"],
  ),
  proofCase(
    "desks-f.json",
    "present.html (+ present.js, contract-send.js)",
    "S-19 price ladder rung buttons (top rung first; step down only on a no)",
    ["src/http/present-blueprint-stack.test.mjs"],
  ),
  proofCase(
    "desks-f.json",
    "present.html (+ present.js, contract-send.js)",
    "Section 06 B-04 'Yes: close the Blueprint' (sets Capital Blueprint as the offer, opens S-23)",
    ["src/http/present-blueprint-stack.test.mjs"],
  ),
  proofCase(
    "desks-f.json",
    "present.html (+ present.js, contract-send.js)",
    "Client-facing slides S-01..S-24 and B-01..B-06: prices, guarantees, scores, 'Sample scores' label",
    [
      "src/http/present-blueprint-stack.test.mjs",
      "src/http/present-score-bars.test.mjs",
      "src/http/sample-score-labels.test.mjs",
      "src/http/closer-deck-present.test.mjs",
    ],
  ),
  proofCase(
    "desks-a.json",
    "brand-studio.html",
    "Make a wordmark from the name button",
    ["src/http/partner-marketing-logo.test.mjs"],
  ),
  ...READ_PROOF_CASES,
  ...PUBLIC_UI_PROOF_CASES,
  ...STAFF_UI_PROOF_CASES,
]);

function proofKey(entry) {
  return `${entry.sourceFile}\0${entry.surface}\0${entry.control}`;
}

function pluginDisplayCase(entry) {
  const proof = entry.proof || entry;
  const testFile = entry.proof
    ? proof.file || proof.evidence || entry.evidence
    : entry.evidence || proof.file;
  return Object.freeze({
    sourceFile: entry.sourceFile,
    surface: entry.surface,
    control: entry.control || entry.expected,
    depth: proof.depth || entry.depth || "e2e",
    evidence: testFile,
    tests: Object.freeze(entry.tests ? [...entry.tests] : [testFile]),
  });
}

const READ_PROOF_KEYS = new Set(READ_PROOF_CASES.map(proofKey));
const PLUGIN_DISPLAY_PROOF_CASES = [
  ...DISPLAY_CONTRACTS_AB,
  ...DISPLAY_CONTRACTS_AB_2,
  ...DISPLAY_CONTRACTS_AB_3,
  ...DISPLAY_CONTRACTS_CD_PROOFS,
  ...DISPLAY_CONTRACTS_CD_2_PROOFS,
  ...DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES,
  ...DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES,
  ...DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES,
  ...DISPLAY_CONTRACTS_MONEY_2_PROOFS,
  ...DISPLAY_CONTRACTS_SHELLS_1,
  ...DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES,
  ...DISPLAY_CONTRACTS_TELEPROMPTER_4,
  ...S2_DISPLAY_PROOF_CASES,
  ...S4_DISPLAY_PROOF_CASES,
  ...S1_DISPLAY_SPEC_PROOFS,
  ...S5_DISPLAY_PROOF_CASES,
  ...FIN_B04_DISPLAY_PROOF_CASES,
]
  .map(pluginDisplayCase)
  .filter((entry) => !READ_PROOF_KEYS.has(proofKey(entry)));

const CASES_BY_KEY = new Map(BASE_DISPLAY_PROOF_CASES.map((entry) => [proofKey(entry), entry]));
for (const entry of PLUGIN_DISPLAY_PROOF_CASES) CASES_BY_KEY.set(proofKey(entry), entry);

export const DISPLAY_PROOF_CASES = Object.freeze([...CASES_BY_KEY.values()]);

export function displayProofFor(sourceFile, row) {
  const found = CASES_BY_KEY.get(`${sourceFile}\0${row?.surface || ""}\0${row?.control || ""}`);
  if (!found) {
    if (!isTrackedDisplayControl(row)) return null;
    const deep = ["money", "customerData", "customerMessage"].includes(row?.impact);
    return {
      depth: deep ? "deep" : "e2e",
      verdict: "red",
      evidence: DISPLAY_RESULT_LANE,
      asserts: row.control,
    };
  }
  const savedResult = displaySavedResultContract(row);
  const displayGapVerdict = String(found.evidence || "").includes(DISPLAY_RESULT_LANE)
    && savedResult?.mode === "always-red";
  const verdict = found.verdict
    || (displayGapVerdict ? "red" : null);
  return {
    depth: found.depth,
    ...(verdict ? { verdict } : {}),
    evidence: displayGapVerdict ? DISPLAY_RESULT_LANE : found.evidence,
    asserts: row.control,
  };
}
