import {
  READ_GAPS,
  sourceFileForReadSurface,
} from "../../coverage/gap-catalog-reads.mjs";
import { DISPLAY_CONTRACTS_AB } from "./display-contracts-ab.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES } from "./display-contracts-ef-public.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES } from "./display-contracts-ef-public-2.mjs";
import { DOOR_FLOW_READ_READ_CONTRACTS } from "./door-flow-read-contracts-2.mjs";
import { FIN_B23_READ_PROVED } from "./fin-b23-read-contracts.mjs";
import { FLOW_READ_CONTRACTS } from "./flow-read-contracts.mjs";
import { S3_READ_PROVED } from "./s3-read-contracts.mjs";

function group(sourceFile, surface, tests, controls) {
  const evidence = tests.join(" ");
  return controls.map((control) => Object.freeze({
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence,
    tests: Object.freeze([...tests]),
  }));
}

const PROVED = [
  ...S3_READ_PROVED,
  ...FIN_B23_READ_PROVED,
  ...group("desks-a.json", "client-control-panel.html", ["src/pulse/catalog/proofs/read-reviewed-e2e.test.mjs"], [
    "Waiting count headline (bank yes with no amount)",
  ]),
  ...group("desks-d.json", "public/app/money-helper.html", [
    "src/finance/money-helper.test.mjs",
    "src/finance/money-helper-runner.test.mjs",
  ], [
    "Helper brain: Mac bridge heartbeat / model runner (AI answers vs rules fallback)",
  ]),
  ...group("desks-a.json", "client-portal.html", ["src/pulse/catalog/proofs/read-reviewed-e2e.test.mjs"], [
    "Refer a friend: link and counts card (display)",
  ]),
  ...group("desks-a.json", "affiliate.html", ["src/http/affiliate-screen.test.mjs"], [
    "Referred leads table: Commission column and Total shown",
  ]),
  ...group("desks-a.json", "affiliate.html", ["src/pulse/catalog/proofs/read-second-pass-browser.test.mjs"], [
    "Page open: affiliate figures (REFERRED, CONVERTED, OWED, PAID tiles, referral funnel, license banner, topbar chips)",
    "Page open: own portal read (offer links, code, rate, license gate, tax gate, referral rows, payout rows)",
  ]),
  ...group("desks-a.json", "brand-studio.html", ["src/http/partner-marketing-usage-handler.test.mjs"], [
    "Generation: Writing left and Pages live tiles",
  ]),
  ...group("desks-a.json", "brand-studio.html", ["src/pulse/catalog/proofs/read-second-pass-browser.test.mjs"], [
    "Compliance card BS-05 (locked list, no controls)",
    "Live preview panel (display)",
  ]),
  ...group("desks-a.json", "campaign-manager.html", ["src/http/ad-spine.test.mjs", "src/ops/meta-marketing.test.mjs"], [
    "Angle/hook panel (CM-11: spend, people arrived, booked, cost per booked, hook rate, hold rate)",
  ]),
  ...group("desks-a.json", "campaign-manager.html", ["src/pulse/catalog/proofs/read-second-pass-browser.test.mjs"], [
    "Page open: partner picker list",
    "Spend vs ceilings panel (CM-03 rows, headroom, % of ceiling, flags)",
    "Ad performance panel (CM-09: leads, booked calls, booked rate)",
    "Campaign list panel (CM-04: approval state, strategy, budget, spend yesterday, ROAS, status)",
    "Action log panel (CM-08: actor, rule, reason, change, outcome, revertible)",
    "Ceiling chip and summary tiles (display)",
  ]),
  ...group("desks-a.json", "client-control-panel.html", ["src/http/client-panel-screen.test.mjs"], [
    "Funding round grid (round, finalized, status, approved amount, hold reason, opened)",
  ]),
  ...group("desks-a.json", "closer-dashboard.html", [
    "src/sales/cockpit-honest-money.test.mjs",
    "src/sales/cockpit-one-funding-number.test.mjs",
    "src/http/pipeline-drawer.test.mjs",
  ], [
    "Page open: call cockpit read (who, call time, bands, credit facts, deal, up next)",
    "Ad lines block: Gate, Entry, Primary, Secondary (display)",
    "Payment watch note (polls closer-call every 20 s for 5 min after a pay link)",
    "What they can get bands: Conservative, Realistic, Stacked (display)",
    "Where they stand and The deal tables (display)",
  ]),
  ...group("desks-c.json", "hiring.html", ["src/workflows/hiring-bench-sweeper.test.mjs"], [
    "Short-bench task opened daily by hiring-bench-sweeper (feeds SHORT BY)",
  ]),
  ...group("desks-c.json", "hiring.html", ["src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs"], [
    "Candidate outreach cadence job every 30 min (texts/emails to applicants; not a button on this desk)",
  ]),
  ...group("desks-c.json", "money-alerts.html", [
    "src/workflows/blueprint-finance-os-alerts.test.mjs",
    "src/finance/file-alerts/run.test.mjs",
  ], [
    "Daily alert run that actually sends the four texts (blueprint-finance-os-alerts; not a button here)",
  ]),
  ...group("desks-d.json", "public/app/money-connections.html", ["src/merchant/providers/providers.test.mjs"], [
    "Processor API reachability (Commas, Whop) for pull connections",
  ]),
  ...group("desks-d.json", "public/app/money-payments.html", [
    "src/finance/clarity-autopay.test.mjs",
    "src/handlers/clarity-autopay.test.mjs",
  ], [
    "Commas payment auto-applied to an installment (shows as 'Paid via Commas')",
  ]),
  ...group("desks-d.json", "public/app/money-setup.html", [
    "src/finance/money-setup.test.mjs",
    "src/handlers/payment-links.test.mjs",
  ], [
    "Paid setup turns Finance OS on (one finance-os subscription, once per link)",
  ]),
  ...group("desks-d.json", "public/app/money-strategy.html", [
    "src/finance/payment-strategy-math.test.mjs",
    "src/http/money-strategy-screen.test.mjs",
  ], [
    "Shared math file /app/money-strategy-math.js (dynamic import in the browser)",
  ]),
  ...group("desks-e.json", "public/app/money-transfers.html", [
    "src/http/money-transfers-screen.test.mjs",
    "src/finance/money-transfers.test.mjs",
    "src/workflows/finance-os-money-transfers.test.mjs",
  ], [
    "Mode banner: Practice mode (Plaid sandbox) / Off with the reason / Live",
    "Three tiles: Waiting for your OK, Moving now, Left to move today",
    "Waiting card: amount, who set it up, where it goes, date, why",
    "History table: date, move, amount, status with three steps, who said yes",
    "After the yes: the money moves on its date and its Plaid events are read back (every 15 minutes)",
  ]),
  ...group("desks-e.json", "public/app/money-vault.html", [
    "src/http/money-vault-screen.test.mjs",
    "src/finance/document-vault-items.test.mjs",
    "src/finance/document-vault-chase.test.mjs",
  ], [
    "Progress card: X of Y papers ready, ready / we're checking / left to send counts, next paper",
    "File complete banner (quotes the closer's own sentence)",
    "Paper line list per person and per business (status mark and word: Missing, Sent, Accepted, Too old, Not accepted, Not needed)",
    "Other files you sent (client) / Files to sort (staff): files with no clear paper type, with a View link",
    "The ask: daily sweeper texts and emails the client for missing papers (SMS-VAULT-ASK-1, EMAIL-VAULT-ASK-2, SMS-VAULT-ASK-3)",
  ]),
  ...group("desks-e.json", "public/app/money.html", [
    "src/http/money-screen.test.mjs",
    "src/http/money-overview.test.mjs",
    "src/finance/money-overview.test.mjs",
  ], [
    "Sandbox banner (Test data - Plaid sandbox)",
    "Four tiles: personal cash, business cash, not-sure-yet cash, debt (cash never added across kinds; null is a dash; floor says at least)",
    "Upcoming payments, bills, containers with their accounts, debt with every card (limit, room, used, due), loans, cash-flow chart, billing line",
  ]),
  ...group("desks-e.json", "public/app/morning-brief.html", [
    "src/pulse/beats/beat-brief-link.test.mjs",
    "src/ops/brief-link.test.mjs",
    "src/ops/morning-brief.test.mjs",
  ], [
    "Feed: the brief row and its link are written and texted to Chris twice a day (6:00 a.m. and evening)",
  ]),
  ...group("desks-e.json", "public/app/ops-admin.html", ["src/http/messages-outbound-read.test.mjs"], [
    "Outbound mail panel: waiting / sent today / failed / held by compliance, routes, invoices never emailed",
  ]),
  ...group("desks-e.json", "public/app/partner-galaxy.html", [
    "src/http/partner-home-tiles.test.mjs",
    "src/http/partner-galaxy-tiles.test.mjs",
  ], [
    "Today's numbers tiles: Cash Collected Today, Funded Today, Cost / Funded Client (with yesterday or spend / count)",
  ]),
  ...group("desks-e.json", "public/app/partner-training.html", ["src/http/partner-training-read.test.mjs"], [
    "Refusal panel: not entitled (reason in words), partner_id required (staff), signed out, load failure",
    "'Where you stand' sentence: released to sell alone / supervised calls / may not sell, with gates still open",
    "Four gates cards (G1-G4): Passed / Not passed yet / Taken back / Not assessed",
    "What is next: next module and next gate",
  ]),
  ...group("desks-e.json", "public/app/pipeline.html", ["src/http/pipeline-drawer.test.mjs"], [
    "Drawer: Contact, Call, Credit (three bureau scores, income estimates, business score), Businesses, Path, How they got here, Survey sections",
  ]),
  ...group("desks-f.json", "staff-teams.html", [
    "src/shifts/telemetry.test.mjs",
    "src/adapters/hubstaff.test.mjs",
  ], [
    "Monitor events and activity numbers shown on the Telemetry tab (system side: the Hubstaff poll writes them, skipping anyone without consent)",
  ]),
];

const GAP_EVIDENCE = "src/pulse/coverage/gap-catalog-reads.mjs src/pulse/coverage/gap-catalog-reads.test.mjs";
const GAPS = READ_GAPS.map((item) => Object.freeze({
  sourceFile: sourceFileForReadSurface(item.surface),
  surface: item.surface,
  control: item.control,
  depth: "deep",
  verdict: "red",
  evidence: GAP_EVIDENCE,
  tests: Object.freeze(["src/pulse/coverage/gap-catalog-reads.test.mjs"]),
}));

function proofKey(entry) {
  return `${entry.sourceFile}\0${entry.surface}\0${entry.control}`;
}

function pluginReadCase(entry) {
  const proof = entry.proof || entry;
  const testFile = entry.proof
    ? proof.file || proof.evidence || entry.evidence
    : entry.evidence || proof.file;
  return Object.freeze({
    sourceFile: entry.sourceFile,
    surface: entry.surface,
    control: entry.control || entry.expected,
    depth: "deep",
    evidence: testFile,
    tests: Object.freeze(entry.tests ? [...entry.tests] : [testFile]),
  });
}

const BASE_READ_PROOF_CASES = [...PROVED, ...GAPS];
const BASE_READ_KEYS = new Set(BASE_READ_PROOF_CASES.map(proofKey));
const PLUGIN_READ_PROOF_CASES = [
  ...DISPLAY_CONTRACTS_AB,
  ...DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES,
  ...DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES,
  ...FLOW_READ_CONTRACTS.filter((entry) => entry.family === "read"),
  ...DOOR_FLOW_READ_READ_CONTRACTS,
]
  .map(pluginReadCase)
  .filter((entry) => BASE_READ_KEYS.has(proofKey(entry)));

const BY_KEY = new Map(BASE_READ_PROOF_CASES.map((entry) => [proofKey(entry), entry]));
for (const entry of PLUGIN_READ_PROOF_CASES) BY_KEY.set(proofKey(entry), entry);
// fin-b23: a rendered test of the exact control outranks an older partial proof of the same row.
for (const entry of FIN_B23_READ_PROVED) BY_KEY.set(proofKey(entry), entry);

export const READ_PROOF_CASES = Object.freeze([...BY_KEY.values()]);

if (BY_KEY.size !== READ_PROOF_CASES.length) {
  throw new Error("Catalog read proof cases must be unique.");
}

export function readProofFor(sourceFile, row) {
  const found = BY_KEY.get(`${sourceFile}\0${row?.surface || ""}\0${row?.control || ""}`);
  if (!found) return null;
  return {
    depth: found.depth,
    ...(found.verdict ? { verdict: found.verdict } : {}),
    evidence: found.evidence,
    asserts: row.control,
  };
}
