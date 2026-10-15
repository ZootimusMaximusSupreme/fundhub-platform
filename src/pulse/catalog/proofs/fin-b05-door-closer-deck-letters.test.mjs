// Batch 05 (customer messages): route closer-deck, action=generate_letters.
//
// The closer cockpit's "Generate letters and email now" and "Send deliverables
// package now" buttons both land here. The real api/closer-deck.mjs runs with
// the real letter pack builder (the vendor sandbox credit pull), the real PDF
// maker, the real documents registry saver, and the real queue-and-dispatch
// path. Only the database is a stand-in, and the only provider is the
// in-memory one, so nothing can be sent. Any outbound request fails the test.
//
// What these tests judge is the RESULT a client feels:
//   * the PDFs are real files saved to THIS client's file in THIS company
//   * the right email is queued to the client, and only when something was saved
//   * nothing is saved, emailed or tagged when the pack is empty, the store is
//     down, the offer forbids letters, or the client belongs to another company
//
// Round 2 (repair cycle 1) closed the breaks an independent checker found
// staying green: the email key shared across two clients, the PDF content (it
// is read back and must name this client, at this address), the sworn
// complaints released before Round 4, the "letters sent at" stamp the closer
// desk tripwire reads, the 405 method guard, the not-delivered reason wording,
// the document titles, and the email opt-out branch.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import handler from "../../../../api/closer-deck.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { makeFakeDb } from "../../../documents/fake-db.mjs";
import { storeFromEnv } from "../../../documents/store.mjs";
import { extractPdfText } from "../../../company-brain/pdf-text.mjs";
import { mergeBureauReports } from "../../../finance/crs-map.mjs";
import {
  ORG_ID, OTHER_ORG_ID, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { recorded, reset as resetProvider } from "../../../messaging/providers/memory.mjs";
import { EMAIL_TEMPLATE_KEY } from "../../../workflows/ds-02-diy-letters.mjs";
import { FUNDING_EMAIL_TEMPLATE_KEY } from "../../../workflows/u-02-analyzer-complete-delivery.mjs";
import { clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";
import { queueDb } from "./s2-queue-db.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-0000000000b5";
const NO_PULL_CLIENT = "c1000000-0000-4000-8000-0000000000b6";
const FOREIGN_CLIENT = "c2000000-0000-4000-8000-0000000000b7";
/** A second client of the SAME company, with a stored pull and a home address of her own. */
const CLIENT_B = "c1000000-0000-4000-8000-0000000000b8";
const CLIENT_EMAIL = "fixture.client@example.test";
const CLIENT_B_EMAIL = "second.client@example.test";
const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);

const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
const SANDBOX_PULL = mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox",
});
/** A confirmed bureau answer at round 4: this is what releases the two complaints. */
const ESCALATED_R4 = [{ bureau: "EX", creditor: "EXAMPLE BANK NA", account_last4: "1234", round: "R4" }];

const APPROVED = {
  [EMAIL_TEMPLATE_KEY]: { subject: "Your letters are ready", body: "Hi {{contact.first_name}}, your correction letters are in your portal." },
  [FUNDING_EMAIL_TEMPLATE_KEY]: { subject: "Your deliverables are ready", body: "Hi {{contact.first_name}}, your five documents are in your portal." },
};

const touched = ["DOCUMENT_STORE_PROVIDER", "MESSAGING_DRY_RUN"];
const saved = new Map();
const realFetch = globalThis.fetch;
const asked = [];

before(() => {
  for (const key of touched) saved.set(key, process.env[key]);
  process.env.DOCUMENT_STORE_PROVIDER = "memory";
  delete process.env.MESSAGING_DRY_RUN;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error(`a live request was attempted: ${url}`); };
});
after(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

/**
 * The stand-in company: every table the handler's path reads is a small shelf of
 * rows that is kept only while the SQL text carries the condition for that row,
 * so a handler that drops the company or client condition gets another
 * company's row back and the test goes red.
 */
function world({
  role = "closer", staffOrg = ORG_ID, templates = APPROVED, signedIn = true, prior = ESCALATED_R4, optOuts = [],
} = {}) {
  const documents = makeFakeDb();
  const tagWrites = [];
  const fieldWrites = [];
  const clientRows = [
    { id: CLIENT_ID, org_id: ORG_ID, first_name: "Fixture", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
    { id: NO_PULL_CLIENT, org_id: ORG_ID, first_name: "Empty", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
    { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Foreign", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
    { id: CLIENT_B, org_id: ORG_ID, first_name: "Second", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
  ];
  const byClient = clause(/client_id = \$1/, (row, [id]) => row.client_id === id);
  const fake = queueDb({
    templates,
    clients: {
      [CLIENT_ID]: { first_name: "Fixture", last_name: "Client", email: CLIENT_EMAIL, phone: "+16025550100" },
      [NO_PULL_CLIENT]: { first_name: "Empty", last_name: "Client", email: "empty.client@example.test", phone: "+16025550101" },
      [CLIENT_B]: { first_name: "Second", last_name: "Client", email: CLIENT_B_EMAIL, phone: "+16025550102" },
    },
    extra: [
      ...(signedIn ? [staffSession({ role, org_id: staffOrg })] : []),
      // Does this client belong to this company: kept only while the SQL names the id AND the company.
      [/SELECT 1 FROM clients WHERE id = \$1/, shelf(clientRows, [
        clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
        clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
      ])],
      [/SELECT org_id, first_name, last_name, custom_fields, outcome_tier FROM clients WHERE id = \$1/, shelf(clientRows, [
        clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
      ])],
      [/FROM pii_identity/, shelf(
        [
          { client_id: CLIENT_ID, org_id: ORG_ID, addresses: [{ addressLine1: "100 Test Ave", city: "Denton", state: "TX", postalCode: "76205" }] },
          { client_id: CLIENT_B, org_id: ORG_ID, addresses: [{ addressLine1: "200 Other St", city: "Plano", state: "TX", postalCode: "75023" }] },
        ],
        [byClient, clause(/org_id = \$2/, (row, [, org]) => row.org_id === org)],
      )],
      [/FROM crs_results/, shelf([
        { client_id: CLIENT_ID, result: SANDBOX_PULL },
        { client_id: CLIENT_B, result: SANDBOX_PULL },
      ], [byClient])],
      // Opt-outs are kept only while the SQL names this client, this channel, and "not opted back in".
      [/FROM opt_outs/, shelf(optOuts, [
        clause(/client_id = \$1/, (row, [id]) => row.client_id === id),
        clause(/channel = \$2/, (row, [, channel]) => row.channel === channel),
        clause(/opted_in_at IS NULL/, (row) => row.opted_in_at == null),
      ])],
      [/FROM dispute_items/, shelf(prior.map((row) => ({ ...row, client_id: CLIENT_ID })), [
        clause(/di\.client_id = \$1/, (row, [id]) => row.client_id === id),
      ])],
      [/FROM businesses/, []],
      [/UPDATE clients SET tags/, (_s, p) => { tagWrites.push({ clientId: p[0], tags: p[1] }); return []; }],
      [/UPDATE clients SET custom_fields/, (_s, p) => { fieldWrites.push({ clientId: p[0], patch: JSON.parse(p[1]) }); return []; }],
      [(sql) => /\b(?:INSERT INTO|UPDATE|FROM)\s+document(?:s|_versions)\b/i.test(sql) || /coalesce\(max\(version\)/i.test(sql),
        (sql, p) => documents.query(sql, p)],
    ],
  });
  return { fake, documents: documents._documents, tagWrites, fieldWrites };
}

/** One press of the button against a company; reports what was saved, queued and sent. */
async function press(company, body) {
  const res = makeRes();
  await runWithSharedDb(company.fake, () => handler(req("POST", { body }), res));
  const emails = company.fake.find(/INSERT INTO messages/).map((c) => ({
    orgId: c.params[0], clientId: c.params[1], channel: c.params[2], templateKey: c.params[3], body: String(c.params[4]),
    toAddress: c.params[6], providerRef: c.params[5],
  }));
  return { res, ...company, emails, sent: recorded() };
}

async function run(body, options) {
  resetProvider();
  return press(world(options), body);
}

const repairBody = (over = {}) => ({
  action: "generate_letters", client_id: CLIENT_ID, offer_key: "REPAIR_DFY",
  edu: false, force_repair: false, tier: "REPAIR_ONLY", ...over,
});
const eduBody = (over = {}) => ({
  action: "generate_letters", client_id: CLIENT_ID, offer_key: "UWIQ_DELIVERABLES",
  edu: true, force_repair: false, tier: "REPAIR_ONLY", ...over,
});

function assertNothingWritten(out, why) {
  assert.deepEqual(out.documents, [], `${why}: a document was saved`);
  assert.deepEqual(out.emails, [], `${why}: an email was queued`);
  assert.deepEqual(out.tagWrites, [], `${why}: the client was tagged`);
  assert.deepEqual(out.fieldWrites, [], `${why}: the client file was stamped`);
}

/** What a saved PDF actually says. The file is read back, not only checked for its %PDF bytes. */
async function pdfText(doc) {
  const got = await storeFromEnv().get(doc.storage_key);
  assert.equal(got.body.subarray(0, 4).toString(), "%PDF", `${doc.title} is not a PDF`);
  return (await extractPdfText(got.body)).text.replace(/\s+/g, " ");
}

/**
 * Every saved document is addressed from THIS client at THIS home address and
 * from nobody else. Letters printed with the wrong person's name go to a credit
 * bureau signed by the wrong person, which is the defect this reads for.
 */
async function assertAddressedTo(docs, { name, street, notNames = [], notStreets = [] }) {
  assert.ok(docs.length > 0, `no documents to read for ${name}`);
  for (const doc of docs) {
    const text = doc.mime_type === "application/pdf"
      ? await pdfText(doc)
      : (await storeFromEnv().get(doc.storage_key)).body.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.ok(text.includes(name), `${doc.title} does not carry the client's name "${name}"`);
    if (doc.mime_type === "application/pdf") {
      assert.ok(text.includes(street), `${doc.title} does not carry the home address "${street}"`);
    }
    for (const other of notNames) assert.ok(!text.includes(other), `${doc.title} names another client: "${other}"`);
    for (const other of notStreets) assert.ok(!text.includes(other), `${doc.title} carries another client's address: "${other}"`);
  }
}

/**
 * The "letters sent at" time the closer desk watches (gap-closer.mjs reads
 * closer_deck_letters_at: an ISO date-time, cast to a timestamp). It must be on
 * the file, be a real time, and be THIS press.
 */
function assertStampedNow(patch, startedAt, why) {
  const stamp = patch.closer_deck_letters_at;
  assert.equal(typeof stamp, "string", `${why}: the client file has no letters-sent time`);
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T/, `${why}: the time is not an ISO date-time: ${stamp}`);
  const at = Date.parse(stamp);
  assert.ok(Number.isFinite(at), `${why}: the time does not parse: ${stamp}`);
  assert.ok(at >= startedAt - 1000 && at <= Date.now() + 1000, `${why}: the time is not from this press: ${stamp}`);
}

/** The repair pack's documents are called what the portal says they are called. */
function assertRepairTitles(docs) {
  assert.equal(new Set(docs.map((d) => d.title)).size, docs.length, "two documents share a title");
  for (const doc of docs) {
    if (doc.subtype === "cfpb_complaint") {
      assert.equal(doc.title, "CFPB Complaint — CFPB-Complaint.pdf");
    } else if (doc.subtype === "state_ag_complaint") {
      assert.equal(doc.title, "State Attorney General Complaint — State-Attorney-General-Complaint.pdf");
    } else {
      assert.equal(doc.subtype, "metro2_dispute_letter_pack");
      assert.match(doc.title, /^Metro 2 Dispute Letter Pack — [a-z0-9_]+\.pdf$/, `a dispute letter is titled "${doc.title}"`);
    }
  }
}

/** The funding pack's documents are called what the portal says they are called. */
function assertFundingTitles(docs) {
  assert.equal(new Set(docs.map((d) => d.title)).size, docs.length, "two documents share a title");
  const exact = {
    credit_analysis_report: "Credit Analysis Report",
    funding_snapshot: "Funding Snapshot",
    bank_lender_match_list: "Bank and Lender Match List",
    credit_optimization_roadmap: "Credit Optimization Roadmap",
    business_duplication_map: "Business Duplication Map",
  };
  for (const doc of docs) {
    if (exact[doc.subtype]) assert.equal(doc.title, exact[doc.subtype], doc.subtype);
    else if (doc.subtype === "funding_inquiry_removal") assert.match(doc.title, /^Inquiry removal — (?:EX|TU|EQ)$/);
    else if (doc.subtype === "funding_personal_info") assert.match(doc.title, /^Personal info — (?:EX|TU|EQ)$/);
    else assert.fail(`an unexpected document in the funding pack: ${doc.subtype} "${doc.title}"`);
  }
}

test("closer-deck generate_letters saves the repair letter pack as PDFs on this client's file and emails the client", async () => {
  assert.equal(ROUTES["closer-deck"], handler);
  const startedAt = Date.now();
  const out = await run(repairBody());
  assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
  const body = out.res.body;
  assert.equal(body.ok, true);
  assert.equal(body.action, "generate_letters");
  assert.equal(body.pack, "repair");
  assert.equal(body.delivered, true);
  assert.equal(body.reason, null);
  assert.equal(body.persistSkipped, null);
  assert.ok(body.letterCount > 0, "the pack has letters");
  assert.ok(body.documentsStored > 0, "something was saved to the portal");

  // Every saved document is this client's, in this company's name, and is a real PDF.
  assert.equal(out.documents.length, body.documentsStored);
  assert.ok(out.documents.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID));
  assert.ok(out.documents.every((d) => d.kind === "deliverable" && d.mime_type === "application/pdf"));
  assert.ok(out.documents.every((d) => d.generated_by === "closer-deck"), "a document is not marked as made by the closer deck");
  const subtypes = out.documents.map((d) => d.subtype);
  for (const wanted of ["metro2_dispute_letter_pack", "cfpb_complaint", "state_ag_complaint"]) {
    assert.ok(subtypes.includes(wanted), `${wanted} was not saved`);
  }
  // The PDFs are read back: each one is a real PDF, addressed from this client at
  // this home address, and says nobody else's name or street.
  await assertAddressedTo(out.documents, {
    name: "Fixture Client",
    street: "100 Test Ave",
    notNames: ["Second Client", "Empty Client", "Foreign Client"],
    notStreets: ["200 Other St"],
  });
  assertRepairTitles(out.documents);

  // One email, the letters-ready one, to this client's address, and it went through dispatch.
  assert.equal(out.emails.length, 1);
  const [email] = out.emails;
  assert.deepEqual(
    [email.orgId, email.clientId, email.channel, email.templateKey, email.toAddress],
    [ORG_ID, CLIENT_ID, "email", EMAIL_TEMPLATE_KEY, CLIENT_EMAIL]
  );
  assert.match(email.body, /Hi Fixture/);
  assert.equal(body.email.outcome, "sent", JSON.stringify(body.email));
  // What the (in-memory) provider was handed: one email, to this client, nothing else.
  assert.equal(out.sent.length, 1);
  assert.deepEqual(
    [out.sent[0].orgId, out.sent[0].clientId, out.sent[0].channel, out.sent[0].subject, out.sent[0].to],
    [ORG_ID, CLIENT_ID, "email", APPROVED[EMAIL_TEMPLATE_KEY].subject, CLIENT_EMAIL]
  );

  // The client is tagged and the file says Delivered, both on this client only.
  assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:diy-letters"] }]);
  assert.equal(out.fieldWrites.length, 1);
  assert.equal(out.fieldWrites[0].clientId, CLIENT_ID);
  assert.equal(out.fieldWrites[0].patch.diy_status, "Delivered");
  assert.equal(out.fieldWrites[0].patch.closer_deck_letters_offer, "REPAIR_DFY");
  assertStampedNow(out.fieldWrites[0].patch, startedAt, "repair button");
  assert.deepEqual(asked, [], "nothing reached the network");
});

test("closer-deck generate_letters on the education route saves the five-document funding pack and sends the deliverables email, not the letters email", async () => {
  const startedAt = Date.now();
  const out = await run(eduBody());
  assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
  const body = out.res.body;
  assert.equal(body.pack, "deliverables");
  assert.equal(body.delivered, true);
  assert.ok(body.documentsStored >= 4, "the analysis documents are saved");
  assert.ok(out.documents.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID && d.kind === "deliverable"));
  assert.ok(out.documents.every((d) => d.generated_by === "closer-deck"), "a document is not marked as made by the closer deck");
  const subtypes = out.documents.map((d) => d.subtype);
  const store = storeFromEnv();
  // The analysis reports are saved as HTML pages; the inquiry and personal-info letters are PDFs.
  for (const wanted of ["credit_analysis_report", "funding_snapshot", "bank_lender_match_list", "credit_optimization_roadmap"]) {
    const doc = out.documents.find((d) => d.subtype === wanted);
    assert.ok(doc, `${wanted} was not saved`);
    assert.equal(doc.mime_type, "text/html", wanted);
    const page = (await store.get(doc.storage_key)).body.toString("utf8");
    assert.match(page, /^\s*<(?:!doctype|html)/i, `${wanted} is not a page`);
  }
  const letters = out.documents.filter((d) => d.mime_type === "application/pdf");
  assert.ok(letters.length > 0, "the bureau letters are saved as PDFs");
  for (const doc of letters) {
    assert.equal((await store.get(doc.storage_key)).body.subarray(0, 4).toString(), "%PDF", `${doc.title} is not a PDF`);
  }
  assert.equal(subtypes.includes("metro2_dispute_letter_pack"), false, "a deliverables package carries no dispute letters");
  // Every page and every letter is this client's, and the letters carry the home address.
  await assertAddressedTo(out.documents, {
    name: "Fixture Client",
    street: "100 Test Ave",
    notNames: ["Second Client", "Empty Client", "Foreign Client"],
    notStreets: ["200 Other St"],
  });
  assertFundingTitles(out.documents);

  assert.equal(out.emails.length, 1);
  assert.equal(out.emails[0].templateKey, FUNDING_EMAIL_TEMPLATE_KEY, "the education button sends the deliverables email");
  assert.equal(out.emails[0].clientId, CLIENT_ID);
  assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:deliverables"] }]);
  assert.equal(out.fieldWrites.at(-1).patch.diy_status, "Delivered");
  assert.equal(out.fieldWrites.at(-1).patch.closer_deck_letters_offer, "UWIQ_DELIVERABLES");
  assertStampedNow(out.fieldWrites.at(-1).patch, startedAt, "education button");
});

test("closer-deck generate_letters sends nothing when nothing was built: no stored pull, either button", async () => {
  for (const body of [repairBody({ client_id: NO_PULL_CLIENT }), eduBody({ client_id: NO_PULL_CLIENT })]) {
    const startedAt = Date.now();
    const out = await run(body);
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.equal(out.res.body.delivered, false);
    assert.equal(out.res.body.letterCount, 0);
    assert.equal(out.res.body.documentsStored, 0);
    // The screen prints this word for word, so the words are pinned, not just "something".
    assert.equal(out.res.body.reason, "no_crs_result", "the presenter is told there is no credit pull on file");
    assert.equal(out.res.body.engineSkip, "no_crs_result");
    assert.equal(out.res.body.persistSkipped, "not_attempted");
    assert.equal(out.res.body.email, null);
    assert.deepEqual(out.documents, []);
    assert.deepEqual(out.emails, [], "no email goes out over an empty pack");
    assert.deepEqual(out.tagWrites, [], "no tag over an empty pack");
    // The attempt itself is still stamped, so the presenter sees Retry on the file.
    assert.equal(out.fieldWrites.length, 1);
    assert.equal(out.fieldWrites[0].clientId, NO_PULL_CLIENT);
    assert.equal(out.fieldWrites[0].patch.diy_status, "Delivery Failed — Retry");
    // A failed attempt is still an attempt the closer desk watches for.
    assertStampedNow(out.fieldWrites[0].patch, startedAt, "empty pack");
  }
});

test("closer-deck generate_letters says why and sends nothing when the document store cannot be opened", async () => {
  const before = process.env.DOCUMENT_STORE_PROVIDER;
  process.env.DOCUMENT_STORE_PROVIDER = "no-such-store";
  try {
    const startedAt = Date.now();
    const out = await run(repairBody());
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.equal(out.res.body.delivered, false);
    assert.ok(out.res.body.letterCount > 0, "the letters were still built");
    assert.equal(out.res.body.documentsStored, 0);
    assert.match(out.res.body.persistSkipped, /^unknown DOCUMENT_STORE_PROVIDER "no-such-store"/);
    // The presenter is told the store's own words, not a generic "empty".
    assert.equal(out.res.body.reason, out.res.body.persistSkipped, "the presenter is told why");
    assert.equal(out.res.body.engineSkip, null);
    assert.deepEqual(out.documents, []);
    assert.deepEqual(out.emails, [], "no email goes out over an empty store");
    assert.deepEqual(out.tagWrites, []);
    assert.equal(out.fieldWrites.at(-1).patch.diy_status, "Delivery Failed — Retry");
    assertStampedNow(out.fieldWrites.at(-1).patch, startedAt, "store down");
  } finally {
    process.env.DOCUMENT_STORE_PROVIDER = before;
  }
});

test("closer-deck generate_letters queues no email from a template that has not been approved, and says so", async () => {
  const held = {
    [EMAIL_TEMPLATE_KEY]: { ...APPROVED[EMAIL_TEMPLATE_KEY], compliance_passed: false },
    [FUNDING_EMAIL_TEMPLATE_KEY]: { ...APPROVED[FUNDING_EMAIL_TEMPLATE_KEY], compliance_passed: false },
  };
  for (const body of [repairBody(), eduBody()]) {
    const out = await run(body, { templates: held });
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.deepEqual(out.emails, [], "an unapproved template is never queued to a client");
    assert.equal(out.res.body.email.sent, false);
    assert.equal(out.res.body.email.reason, "template_pending");
    assert.ok(out.documents.length > 0, "the PDFs are still saved to the portal");
  }
});

test("closer-deck generate_letters refuses the funding route, an offer with no letters and an unknown offer; nothing is built, saved or sent", async () => {
  const refused = async (body, status, code) => {
    const out = await run(body);
    assert.equal(out.res.statusCode, status, JSON.stringify(body));
    assert.equal(out.res.body.error, code, JSON.stringify(body));
    assertNothingWritten(out, JSON.stringify(body));
    assert.equal(out.fake.find(/FROM crs_results/).length, 0, "no pack was even built");
  };
  await refused(repairBody({ offer_key: "FUNDING_DFY", tier: "FULL_FUNDING" }), 409, "letters_blocked_funding_route");
  await refused(repairBody({ offer_key: "FUNDING_DFY", tier: "FUNDING_PLUS_REPAIR" }), 409, "letters_blocked_funding_route");
  await refused(repairBody({ offer_key: "FUNDING_DFY", tier: "FULL_FUNDING", force_repair: true }), 409, "letters_blocked_funding_route");
  await refused(repairBody({ offer_key: "FUNDING_MASTERY" }), 409, "letters_blocked_funding_route");
  await refused(repairBody({ offer_key: "NOT_AN_OFFER" }), 400, "unknown_offer");
});

test("closer-deck generate_letters touches nothing for another company's client, a bad id, or a caller with no sign-in", async () => {
  // Our staff, their client.
  const foreign = await run(repairBody({ client_id: FOREIGN_CLIENT }));
  assert.equal(foreign.res.statusCode, 404);
  assert.equal(foreign.res.body.error, "client_not_found");
  assertNothingWritten(foreign, "another company's client");
  assert.equal(foreign.fake.find(/FROM crs_results/).length, 0);

  // Their staff, our client: the company comes from the sign-in, never from the request.
  const stranger = await run(repairBody(), { staffOrg: OTHER_ORG_ID });
  assert.equal(stranger.res.statusCode, 404);
  assertNothingWritten(stranger, "staff of another company");

  const bad = await run(repairBody({ client_id: "not-a-uuid" }));
  assert.equal(bad.res.statusCode, 400);
  assertNothingWritten(bad, "a bad client id");

  const anonymous = await run(repairBody(), { signedIn: false });
  assert.equal(anonymous.res.statusCode, 401);
  assertNothingWritten(anonymous, "no sign-in");
});

test("closer-deck generate_letters takes the company from the sign-in, not from anything the request names", async () => {
  const out = await run(repairBody({ org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID, staff_id: "5a000000-0000-4000-8000-0000000000ff" }));
  assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
  assert.equal(out.res.body.delivered, true);
  assert.ok(out.documents.length > 0);
  assert.ok(out.documents.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID), "a document took the company the request named");
  assert.deepEqual(out.emails.map((e) => e.orgId), [ORG_ID]);
  assert.deepEqual(out.sent.map((m) => m.orgId), [ORG_ID]);
});

test("closer-deck generate_letters is for closer, sales manager, owner and admin only; every other staff role is refused before anything is built", async () => {
  const letIn = await rolesLetIn(async (role) => {
    // A client with no stored pull: an admitted role finishes at once, a refused one never gets that far.
    const out = await run(repairBody({ client_id: NO_PULL_CLIENT }), { role });
    if (out.res.statusCode === 403) {
      assertNothingWritten(out, `${role} was refused`);
      assert.equal(out.fake.find(/FROM crs_results/).length, 0, `${role}: a pack was built before the refusal`);
    }
    return out.res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "closer", "owner", "sales_manager"]);
});

test("closer-deck generate_letters pressed twice emails the client once", async () => {
  resetProvider();
  const company = world();
  const first = await press(company, repairBody());
  const second = await press(company, repairBody());
  assert.equal(first.res.statusCode, 200);
  assert.equal(second.res.statusCode, 200);
  assert.equal(first.res.body.email.outcome, "sent");
  // The second press asks for the same message (same client, same offer): the queue refuses a copy.
  const refs = company.fake.state.messages.map((m) => m.provider_ref);
  assert.equal(refs.length, 1, `two messages were queued: ${refs.join(", ")}`);
  assert.equal(recorded().length, 1, "the client was emailed once");
});

test("closer-deck generate_letters emails every client in the company: the second client is not skipped because the first was already emailed", async () => {
  resetProvider();
  const company = world();
  const startedAt = Date.now();
  const first = await press(company, repairBody());
  const second = await press(company, repairBody({ client_id: CLIENT_B }));
  for (const out of [first, second]) {
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.equal(out.res.body.delivered, true);
    assert.equal(out.res.body.email.outcome, "sent", JSON.stringify(out.res.body.email));
  }

  // One email each, to each client's own address. The press is "same company, same offer".
  const queued = company.fake.state.messages;
  assert.equal(queued.length, 2, `the second client was not emailed: ${queued.map((m) => m.provider_ref).join(", ")}`);
  assert.deepEqual(
    queued.map((m) => [m.org_id, m.client_id, m.channel, m.template_key, m.to_address]),
    [
      [ORG_ID, CLIENT_ID, "email", EMAIL_TEMPLATE_KEY, CLIENT_EMAIL],
      [ORG_ID, CLIENT_B, "email", EMAIL_TEMPLATE_KEY, CLIENT_B_EMAIL],
    ]
  );
  assert.equal(new Set(queued.map((m) => m.provider_ref)).size, 2, "the two clients share one message key");
  assert.match(queued[0].rendered_body, /Hi Fixture/);
  assert.match(queued[1].rendered_body, /Hi Second/, "the second client was sent the first client's words");
  assert.deepEqual(
    recorded().map((m) => [m.orgId, m.clientId, m.channel, m.to]),
    [[ORG_ID, CLIENT_ID, "email", CLIENT_EMAIL], [ORG_ID, CLIENT_B, "email", CLIENT_B_EMAIL]]
  );

  // Each client's own letters, on each client's own file, with their own name and street.
  const docsOf = (id) => company.documents.filter((d) => d.client_id === id);
  assert.equal(company.documents.length, docsOf(CLIENT_ID).length + docsOf(CLIENT_B).length, "a document sits on neither client");
  await assertAddressedTo(docsOf(CLIENT_ID), {
    name: "Fixture Client", street: "100 Test Ave", notNames: ["Second Client"], notStreets: ["200 Other St"],
  });
  await assertAddressedTo(docsOf(CLIENT_B), {
    name: "Second Client", street: "200 Other St", notNames: ["Fixture Client"], notStreets: ["100 Test Ave"],
  });
  assert.deepEqual(company.tagWrites.map((w) => w.clientId), [CLIENT_ID, CLIENT_B]);
  assert.deepEqual(company.fieldWrites.map((w) => w.clientId), [CLIENT_ID, CLIENT_B]);
  for (const write of company.fieldWrites) assertStampedNow(write.patch, startedAt, `client ${write.clientId}`);
});

test("closer-deck generate_letters files the sworn CFPB and state AG complaints only after a confirmed Round 4 answer, never at Round 1 to 3", async () => {
  const sworn = new Set(["cfpb_complaint", "state_ag_complaint"]);
  const early = [
    ["no recorded bureau answer (Round 1)", []],
    ["a confirmed Round 3 answer", [{ ...ESCALATED_R4[0], round: "R3" }]],
  ];
  for (const [label, prior] of early) {
    const out = await run(repairBody(), { prior });
    assert.equal(out.res.statusCode, 200, `${label}: ${JSON.stringify(out.res.body)}`);
    assert.equal(out.res.body.delivered, true, label);
    const subtypes = out.documents.map((d) => d.subtype);
    assert.ok(subtypes.includes("metro2_dispute_letter_pack"), `${label}: the bureau letters are still saved`);
    assert.deepEqual(subtypes.filter((t) => sworn.has(t)), [], `${label}: a sworn complaint was released early`);
    assert.equal(out.res.body.letterCount, out.documents.length, label);
  }
  // The same file at Round 4 gets the pair on top of the bureau letters.
  const escalated = await run(repairBody(), { prior: ESCALATED_R4 });
  const subtypes = escalated.documents.map((d) => d.subtype);
  for (const wanted of sworn) assert.ok(subtypes.includes(wanted), `${wanted} was withheld at Round 4`);
});

test("closer-deck generate_letters does not email a client who opted out of email, still saves the letters, and is not held up by a text-only opt-out", async () => {
  const optedOut = await run(repairBody(), { optOuts: [{ client_id: CLIENT_ID, channel: "email", opted_in_at: null }] });
  assert.equal(optedOut.res.statusCode, 200, JSON.stringify(optedOut.res.body));
  assert.ok(optedOut.documents.length > 0, "the letters are still saved to the portal");
  assert.equal(optedOut.sent.length, 0, "an opted-out client was emailed");
  assert.equal(optedOut.res.body.email.outcome, "blocked", JSON.stringify(optedOut.res.body.email));
  assert.deepEqual(optedOut.fake.state.messages.map((m) => m.status), ["blocked"]);
  assert.match(String(optedOut.fake.state.messages[0].blocked_reason), /opted_out/);

  // Not held by an opt-out that is about something else.
  const others = [
    ["a text-message opt-out", [{ client_id: CLIENT_ID, channel: "sms", opted_in_at: null }]],
    ["an email opt-out she has since reversed", [{ client_id: CLIENT_ID, channel: "email", opted_in_at: "2026-10-01T00:00:00Z" }]],
    ["another client's email opt-out", [{ client_id: CLIENT_B, channel: "email", opted_in_at: null }]],
  ];
  for (const [label, optOuts] of others) {
    const out = await run(repairBody(), { optOuts });
    assert.equal(out.res.statusCode, 200, label);
    assert.equal(out.res.body.email.outcome, "sent", `${label} held the email: ${JSON.stringify(out.res.body.email)}`);
    assert.equal(out.sent.length, 1, label);
  }
});

test("closer-deck generate_letters answers only POST: any other method is refused before sign-in, a pack, a file or an email", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    resetProvider();
    const company = world();
    const res = makeRes();
    await runWithSharedDb(company.fake, () => handler(req(method, { body: repairBody() }), res));
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.body.error, "method_not_allowed", method);
    assert.equal(res.headers.allow, "POST", method);
    assert.equal(company.fake.calls.length, 0, `${method}: the database was asked something`);
    assert.deepEqual(company.documents, [], method);
    assert.deepEqual(company.tagWrites, [], method);
    assert.deepEqual(company.fieldWrites, [], method);
    assert.deepEqual(recorded(), [], `${method}: something was sent`);
  }
});
