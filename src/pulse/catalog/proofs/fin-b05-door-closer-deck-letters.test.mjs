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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import handler from "../../../../api/closer-deck.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { makeFakeDb } from "../../../documents/fake-db.mjs";
import { storeFromEnv } from "../../../documents/store.mjs";
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
const CLIENT_EMAIL = "fixture.client@example.test";
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
function world({ role = "closer", staffOrg = ORG_ID, templates = APPROVED, signedIn = true, prior = ESCALATED_R4 } = {}) {
  const documents = makeFakeDb();
  const tagWrites = [];
  const fieldWrites = [];
  const clientRows = [
    { id: CLIENT_ID, org_id: ORG_ID, first_name: "Fixture", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
    { id: NO_PULL_CLIENT, org_id: ORG_ID, first_name: "Empty", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
    { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Foreign", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY" },
  ];
  const byClient = clause(/client_id = \$1/, (row, [id]) => row.client_id === id);
  const fake = queueDb({
    templates,
    clients: {
      [CLIENT_ID]: { first_name: "Fixture", last_name: "Client", email: CLIENT_EMAIL, phone: "+16025550100" },
      [NO_PULL_CLIENT]: { first_name: "Empty", last_name: "Client", email: "empty.client@example.test", phone: "+16025550101" },
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
        [{ client_id: CLIENT_ID, org_id: ORG_ID, addresses: [{ addressLine1: "100 Test Ave", city: "Denton", state: "TX", postalCode: "76205" }] }],
        [byClient, clause(/org_id = \$2/, (row, [, org]) => row.org_id === org)],
      )],
      [/FROM crs_results/, shelf([{ client_id: CLIENT_ID, result: SANDBOX_PULL }], [byClient])],
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

test("closer-deck generate_letters saves the repair letter pack as PDFs on this client's file and emails the client", async () => {
  assert.equal(ROUTES["closer-deck"], handler);
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
  const subtypes = out.documents.map((d) => d.subtype);
  for (const wanted of ["metro2_dispute_letter_pack", "cfpb_complaint", "state_ag_complaint"]) {
    assert.ok(subtypes.includes(wanted), `${wanted} was not saved`);
  }
  const store = storeFromEnv();
  for (const doc of out.documents) {
    const got = await store.get(doc.storage_key);
    assert.equal(got.body.subarray(0, 4).toString(), "%PDF", `${doc.title} is not a PDF`);
  }

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
  assert.deepEqual(asked, [], "nothing reached the network");
});

test("closer-deck generate_letters on the education route saves the five-document funding pack and sends the deliverables email, not the letters email", async () => {
  const out = await run(eduBody());
  assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
  const body = out.res.body;
  assert.equal(body.pack, "deliverables");
  assert.equal(body.delivered, true);
  assert.ok(body.documentsStored >= 4, "the analysis documents are saved");
  assert.ok(out.documents.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID && d.kind === "deliverable"));
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

  assert.equal(out.emails.length, 1);
  assert.equal(out.emails[0].templateKey, FUNDING_EMAIL_TEMPLATE_KEY, "the education button sends the deliverables email");
  assert.equal(out.emails[0].clientId, CLIENT_ID);
  assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:deliverables"] }]);
  assert.equal(out.fieldWrites.at(-1).patch.diy_status, "Delivered");
  assert.equal(out.fieldWrites.at(-1).patch.closer_deck_letters_offer, "UWIQ_DELIVERABLES");
});

test("closer-deck generate_letters sends nothing when nothing was built: no stored pull, either button", async () => {
  for (const body of [repairBody({ client_id: NO_PULL_CLIENT }), eduBody({ client_id: NO_PULL_CLIENT })]) {
    const out = await run(body);
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.equal(out.res.body.delivered, false);
    assert.equal(out.res.body.letterCount, 0);
    assert.equal(out.res.body.documentsStored, 0);
    assert.ok(out.res.body.reason, "the screen is given a reason to print");
    assert.equal(out.res.body.email, null);
    assert.deepEqual(out.documents, []);
    assert.deepEqual(out.emails, [], "no email goes out over an empty pack");
    assert.deepEqual(out.tagWrites, [], "no tag over an empty pack");
    // The attempt itself is still stamped, so the presenter sees Retry on the file.
    assert.equal(out.fieldWrites.length, 1);
    assert.equal(out.fieldWrites[0].clientId, NO_PULL_CLIENT);
    assert.equal(out.fieldWrites[0].patch.diy_status, "Delivery Failed — Retry");
  }
});

test("closer-deck generate_letters says why and sends nothing when the document store cannot be opened", async () => {
  const before = process.env.DOCUMENT_STORE_PROVIDER;
  process.env.DOCUMENT_STORE_PROVIDER = "no-such-store";
  try {
    const out = await run(repairBody());
    assert.equal(out.res.statusCode, 200, JSON.stringify(out.res.body));
    assert.equal(out.res.body.delivered, false);
    assert.ok(out.res.body.letterCount > 0, "the letters were still built");
    assert.equal(out.res.body.documentsStored, 0);
    assert.match(out.res.body.persistSkipped, /DOCUMENT_STORE_PROVIDER/);
    assert.match(out.res.body.reason, /DOCUMENT_STORE_PROVIDER/, "the presenter is told why");
    assert.deepEqual(out.documents, []);
    assert.deepEqual(out.emails, [], "no email goes out over an empty store");
    assert.deepEqual(out.tagWrites, []);
    assert.equal(out.fieldWrites.at(-1).patch.diy_status, "Delivery Failed — Retry");
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
