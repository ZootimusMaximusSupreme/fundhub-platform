// Finish-the-853 batch 08 (customer-data routes): rows that a fake-data handler test now judges.
// A row is named by the same 20-hex id the catalog compiler gives it (sha256 of sourceFile, surface
// and control), so a changed control is a new, unproved row. Each entry lists the test files that run
// the real api/ handler over stand-in tables and judge the exact saved result; every one of them was
// broken on purpose once (product line changed, test seen red, line put back).
// src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs checks every entry against the coverage map
// and the test files. Three batch rows are deliberately NOT here (see NOT_ATTACHED below).
import { createHash } from "node:crypto";

export const FIN_B08_DOOR_EVIDENCE = "src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs";

const DEFINITIONS = [
  // routes-1 banking/accounts: POST action=import (pull accounts from the configured banking provider, mock or Plaid, into this cli
  ["b79f329892647515d81c", ["src/http/fin-b08-banking-import.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 blueprint/declines: GET/POST /api/blueprint/declines — Capital Blueprint decline defense: GET the client's plain-words v
  ["5e98e27afad6007338d8", ["src/http/fin-b08-blueprint-declines.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 brand/review: POST /api/brand/review — moves a white-label partner's brand through review: submit (owning partner 
  ["0d3cabd7400b49032e61", ["src/http/fin-b08-brand-review.test.mjs"]],
  // routes-1 campaigns/meta-agency: POST {partner_id, meta_business_id, ad_account_id} save a partner's Meta Business id and send Meta a
  ["7967fd8c395338275350", ["src/http/fin-b08-meta-agency.test.mjs"]],
  // routes-0 contracts: Drafts: create_client (inserts a client), create_draft, save_draft, preview against a client's value
  ["2eec1e9028668a06da53", ["src/http/fin-b08-contracts-write.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 contracts: send: freezes the words, registers the document, returns the signed link for staff to pass on (no em
  ["60d61297c44a677c89d8", ["src/http/fin-b08-contracts-write.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 contracts: Template authoring: create / save / archive / upload contract templates and fields (the words client
  ["893bd991caca419b8327", ["src/http/fin-b08-contracts-write.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 contracts: void: voids a contract (owner/admin) so it can no longer be signed.
  ["9b968eb673131fd9ff1a", ["src/http/fin-b08-contracts-write.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 contracts/sign: GET ?id&exp&sig (view contract for signing; records viewed_at and view_count; ?file=1 returns the PD
  ["a54e680e1e239303c391", ["src/http/fin-b08-contracts-sign.test.mjs"]],
  // routes-1 contracts/sign: POST {signer_name, agreed:true, field_values} (a client signs: typed name, tick, time, IP; refused i
  ["e1368821d8a71d5a7af1", ["src/http/fin-b08-contracts-sign.test.mjs"]],
  // routes-3 dashboard/pipeline: GET ?key=<board> the board as the database holds it: the stages in order, each with the client cards
  ["268e3f16eb706dff82f4", ["src/http/fin-b08-dashboard-pipeline.test.mjs"]],
  // routes-0 demo/simulate: DELETE: tears down simulated clients (one or all demo clients in the org). Deletes rows.
  ["1962e2fc16794021d902", ["src/http/fin-b08-demo-simulate.test.mjs"]],
  // routes-0 demo/simulate: POST: loads one simulated demo client (CRS file, tradelines, card, bank account) for the demo.
  ["219a37c1aa84986cd2aa", ["src/http/fin-b08-demo-simulate.test.mjs"]],
  // routes-3 documents-upload: POST multipart file: sniffs the bytes against the accepted types, stores it, registers the document,
  ["bb156c6fe67240735bef", ["src/http/fin-b08-documents-upload.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-3 inquiries: GET ?inquiry_id= expands one row's attempt history; ?recent=letters lists recent letters (specialist
  ["03566a7dc13c976420e6", ["src/http/fin-b08-inquiries.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 inquiry: POST action=launch: places a Bland phone call to a credit bureau's dispute line for one inquiry case
  ["4cd0260bc96598632eb9", ["src/http/fin-b08-inquiry-launch.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 inquiry-cases: POST action=send {mail, portal} (mail the bureau letter on the client's behalf, or record a portal u
  ["4bf572fddb1ef89eff8c", ["src/http/fin-b08-inquiry-cases-send.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 inquiry-cases (send): POST /api/inquiry-cases action send — sends the inquiry-removal letter for a case: mail:true prints 
  ["af74d4321e47c5c9eddc", ["src/http/fin-b08-inquiry-cases-send.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 money/banks: GET ?client_id= (banks to open by location, card stacking order, next funding sequence, bank relatio
  ["3caab685aedbe5466871", ["src/http/fin-b08-money-banks.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 money/fundability: GET ?client_id= (UnderwriteIQ fundability score now, 3/6/12 months ahead, per business; never runs a
  ["cef27cede285de67cfaa", ["src/http/fin-b08-money-fundability.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 money/strategy: GET/POST /api/money/strategy — GET the payoff inputs and the plan for saved or default settings (hig
  ["4c26835b30d62952134a", ["src/http/fin-b08-money-strategy.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 money/tasks: POST do_task: hands one step to the money agent or a CSM. A payment becomes a transfer proposal that
  ["a9b7b4e30b82cfb1d842", ["src/http/fin-b08-money-tasks.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 partner-brand: GET ?partner_id= (a white-label partner's brand, trading name, address, support email, domain, funne
  ["bf5c35208f62fc5340b3", ["src/http/fin-b08-partner-surface.test.mjs"]],
  // routes-1 partner-brand: PUT {partner_id, wordmark_url, ink, paper, ramp, voice, entity_name, entity_address, support_email, 
  ["7eb49019d216e997c771", ["src/http/fin-b08-partner-surface.test.mjs"]],
  // routes-2 partner-marketing/generate-copy: POST /api/partner-marketing/generate-copy — rewrites the unlocked sections of a white-label partner'
  ["28ba561e6f81ff342e45", ["src/http/fin-b08-partner-copy.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 partner-pages: GET/POST/PATCH /api/partner-pages — Brand Studio funnel page drafts for white-label partners: GET li
  ["cac0a02894e149936207", ["src/http/fin-b08-partner-surface.test.mjs"]],
  // routes-2 pii: GET/POST /api/pii — a client's identity data: GET masked identity (last four) or the access history;
  ["c0a7cb1361e695f5cd58", ["src/http/fin-b08-pii.test.mjs"]],
  // routes-2 public/climate-match: GET/POST /api/public/climate-match — public lending-climate lead magnet: GET how many active lenders
  ["0afa1181d191c2bd75c2", ["src/http/fin-b08-climate-match.test.mjs"]],
  // routes-0 public/education-enroll: The /education/enroll/ form: saves an enrollment, resolves or creates the client, drops a Sales / ne
  ["d97fd6b0ae949975d3c8", ["src/http/fin-b08-education-enroll.test.mjs"]],
  // routes-3 read/client-progress: GET every fact the client progress page draws: scores, checklist, next step. Facts, not copy; the pa
  ["8a6b80c7e68c3a75a960", ["src/http/fin-b08-client-progress.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-1 read/contracts: GET ?view=templates|contracts, ?id= (one contract with frozen wording, integrity, signers), ?file=te
  ["30235354e9c8b33e35f9", ["src/http/fin-b08-read-contracts.test.mjs"]],
  // routes-3 read/lender-matches: GET ?client_id= lenders that fit a client's underwrite and inquiry profile for round planning (struc
  ["33f654feab5b6ec471fc", ["src/http/fin-b08-lender-matches.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-2 repair/generate: POST /api/repair/generate {client_id, round?} — analyses a client's stored credit file and stores th
  ["be956f7cfc9a02979cb8", ["src/http/fin-b08-repair-generate.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
  // routes-0 repair/inbound-mail: Process a bureau response (pasted text or an uploaded document): parses it, updates dispute items an
  ["a284ee2de26586168354", ["src/http/fin-b08-repair-inbound-mail.test.mjs", "src/http/fin-b08-door-guards.test.mjs"]],
];

/* Rows of this batch that stay red on purpose, each with the exact thing that is missing.
   They are listed so a test can fail if one is attached by mistake. */
export const FIN_B08_NOT_ATTACHED = Object.freeze({
  "31bb947e14369a9a0e0c": "routes-1 route:contracts/sign POST action=decline: the handler records the decline on the signer (status declined, reason, time) and answers that the person who sent it has been told, but nothing tells the sender. No message, event, task or notify call follows declineSigner (api/contracts/sign.mjs, src/contracts/signers.mjs); the contract's own status has no declined value and does not change; the Documents screen reads the contract list, which carries no signer state, so a declined contract still reads sent / Awaiting there; and no screen reads GET /api/read/contracts?id=, the one place the decline can be seen. The signing page (public/contract.html) defines decline() but no button calls it (owner answer 2026-08-17: contract sign has no decline button), so only a direct call to the endpoint declines. The recorded half is judged in fin-b08-contracts-sign.test.mjs; the 'sender is told' half has no code to judge.",
  "72fad5cb5f5f84a3aa0f": "routes-2 route:inquiry-cases (clear_inquiry): the control says the org comes from the session. The handler uses the session company for the sign-in gate and for the inquiry.removed event only. clearInquiry (src/inquiry-removal/cases.mjs) reads and updates inquiry_log by id alone (no company in either statement) and no row policy exists on inquiry_log. Measured on the real handler: staff of company A cleared an inquiry that sits in company B, completed B's case, and the event went out stamped with company A and B's client. A company-boundary check is red on today's product.",
  "25e2262893fcbdc90db9": "routes-1 route:soft-pull-approve POST action=stamp_incorporated: api/soft-pull-approve.mjs:279 calls stampIncorporatedAsStaff, which is defined and imported nowhere in the repo. Measured on the real handler: the call throws ReferenceError (stampIncorporatedAsStaff is not defined), so the action answers 500 and there is no working result to judge. The Present screen and the client control panel both call it. Merge 8d9a693ae (2026-08-27) brought in the call but not the function and stampBusinessIncorporated that commit ddcd92d18 (2026-08-25) added.",
});

export function finB08DoorRowId(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return createHash("sha256")
    .update(`${file}\0${row?.surface}\0${row?.control}`)
    .digest("hex")
    .slice(0, 20);
}

export const FIN_B08_DOOR_CONTRACTS = Object.freeze(
  DEFINITIONS.map(([id, tests]) => Object.freeze({ id, tests: Object.freeze([...tests]) })),
);

const BY_ID = new Map(FIN_B08_DOOR_CONTRACTS.map((entry) => [entry.id, entry]));

export function finB08DoorProof(sourceFile, row) {
  const entry = BY_ID.get(finB08DoorRowId(sourceFile, row));
  if (!entry) return null;
  return {
    depth: "deep",
    evidence: [FIN_B08_DOOR_EVIDENCE, ...entry.tests].join(" "),
    asserts: row.control,
  };
}
