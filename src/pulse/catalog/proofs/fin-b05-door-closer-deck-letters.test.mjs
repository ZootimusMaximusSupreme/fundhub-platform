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
//
// Round 3 (repair cycle 2) closed the next set:
//   * the descent press (a funding tier with force_repair) and the trial offer
//     are pressed, not only the repair and education buttons
//   * what is IN each pack is named: the exact set of files, each bureau letter
//     addressed to its own bureau, each carrying only that bureau's accounts,
//     inquiries and personal facts
//   * the email template keys are word-for-word the seeded ones, and the seeded
//     copy is what is rendered to the client
//   * a tag or stamp that loses its WHERE id condition reaches every client, and
//     the stand-in clients table shows it
//   * an unexpected failure is a 500 that says so, and a database outage a 503
//   * a second press keeps one document per letter and adds no second version
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, "../../../../vendor/underwriteiq-full/api/lite/crs/sandbox");
const SEED_DIR = path.resolve(HERE, "../../../../db/seed");

const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
const SANDBOX_PULL = mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox",
});
/** A confirmed bureau answer at round 4: this is what releases the two complaints. */
const ESCALATED_R4 = [{ bureau: "EX", creditor: "EXAMPLE BANK NA", account_last4: "1234", round: "R4" }];

/* The two email template keys, written out. They are NOT imported from the
   product for the stand-in templates below: a key typed wrong in the product
   would then be typed wrong in the test too, and every press would still find
   its template. These are the keys the database seed holds. */
const LETTERS_KEY = "EMAIL-DS02-DIY-LETTERS-READY";
const DELIVERABLES_KEY = "EMAIL-U02-ANALYZER-FUNDING-DELIVERY";

/** The newest seed file that inserts this template, and the subject and body it holds. */
function seededTemplate(key) {
  let found = null;
  for (const file of readdirSync(SEED_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(SEED_DIR, file), "utf8");
    const at = sql.indexOf(`'${key}'`);
    if (at === -1 || !/INSERT INTO message_templates/.test(sql.slice(Math.max(0, at - 400), at))) continue;
    // After the key come the channel, the subject and the body: each a '...' or a $tag$...$tag$ text.
    const text = /\s*,?\s*(?:'((?:[^']|'')*)'|\$([A-Za-z0-9_]*)\$([\s\S]*?)\$\2\$)/y;
    text.lastIndex = at + key.length + 2;
    const parts = [];
    while (parts.length < 3) {
      const m = text.exec(sql);
      assert.ok(m, `could not read text ${parts.length + 1} after ${key} in ${file}`);
      parts.push(m[1] !== undefined ? m[1].replace(/''/g, "'") : m[3]);
      text.lastIndex = m.index + m[0].length;
    }
    found = { file, channel: parts[0], subject: parts[1], body: parts[2] };
  }
  assert.ok(found, `no seed file under db/seed inserts ${key}`);
  return found;
}
const SEEDED = { [LETTERS_KEY]: seededTemplate(LETTERS_KEY), [DELIVERABLES_KEY]: seededTemplate(DELIVERABLES_KEY) };
/** The templates the stand-in company holds: the seeded copy, approved. */
const APPROVED = Object.fromEntries(
  Object.entries(SEEDED).map(([key, t]) => [key, { subject: t.subject, body: t.body }])
);

/* The three credit bureaus as a letter must treat them. `addressee` is the
   block a bureau letter opens with; `box` is that bureau's own mailing box,
   which no other bureau's letter may carry. `facts` are lines that sit only in
   that bureau's own report (checked against the sandbox file below), and
   `inquiries` the hard pulls only that bureau lists. */
const BUREAUS = {
  EX: {
    file: "exp.json", sourceType: "Experian",
    addressee: "Experian P.O. Box 4500 Allen, TX 75013", box: "P.O. Box 4500",
    facts: [{ raw: "5815 KNOLL KREST ST", letter: "5815 KNOLL KREST ST" }],
    inquiries: ["SHARON & CRESCENT UNIT", "PEOPLES UNITED BANK"],
  },
  TU: {
    file: "tu.json", sourceType: "TransUnion",
    addressee: "TransUnion Consumer Solutions P.O. Box 2000 Chester, PA 19016", box: "P.O. Box 2000",
    facts: [{ raw: "1100 LYNHURST LN", letter: "1100 LYNHURST LN" }, { raw: "1120", letter: "ending in 1120" }],
    inquiries: [],
  },
  EQ: {
    file: "efx.json", sourceType: "Equifax",
    addressee: "Equifax Information Services LLC P.O. Box 740256 Atlanta, GA 30374", box: "P.O. Box 740256",
    facts: [{ raw: "2224 AHAMAKA APT B", letter: "2224 AHAMAKA APT B" }, { raw: "4480", letter: "ending in 4480" }],
    inquiries: ["KROLL FACTUAL DATA"],
  },
};
const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const standalone = (name) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`);
const last4 = (accountIdentifier) => String(accountIdentifier).slice(-4);
/** The accounts a bureau reports as derogatory in the stored pull: what its round letter must cover. */
const derogatory = (code) => SANDBOX_PULL.tradelines.filter(
  (t) => t.sourceType === BUREAUS[code].sourceType && t.derogatoryDataIndicator === true
);
const ROUND_LETTER_BUREAUS = Object.keys(BUREAUS).filter((code) => derogatory(code).length > 0);

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
 *
 * The clients table is a real shelf, not a log: a tag or a stamp is applied to
 * the rows the SQL REACHES. The UPDATE must end in `WHERE id = $1`; an UPDATE
 * that lost that condition reaches every client in the table, the other
 * clients' rows change, and `assertOthersUntouched` goes red.
 */
function world({
  role = "closer", staffOrg = ORG_ID, templates = APPROVED, signedIn = true, prior = ESCALATED_R4, optOuts = [],
  fail = [],
} = {}) {
  const documents = makeFakeDb();
  const tagWrites = [];
  const fieldWrites = [];
  let priorRows = prior;
  const clientRows = [
    { id: CLIENT_ID, org_id: ORG_ID, first_name: "Fixture", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY", tags: [] },
    { id: NO_PULL_CLIENT, org_id: ORG_ID, first_name: "Empty", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY", tags: [] },
    { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Foreign", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY", tags: [] },
    { id: CLIENT_B, org_id: ORG_ID, first_name: "Second", last_name: "Client", custom_fields: {}, outcome_tier: "REPAIR_ONLY", tags: [] },
  ];
  /** The client rows an UPDATE reaches: the one the SQL names, or every client when that condition is gone. */
  const reached = (sql, params) => (/WHERE id = \$1\s*$/.test(sql) ? clientRows.filter((row) => row.id === params[0]) : clientRows);
  const byClient = clause(/client_id = \$1/, (row, [id]) => row.client_id === id);
  const fake = queueDb({
    templates,
    clients: {
      [CLIENT_ID]: { first_name: "Fixture", last_name: "Client", email: CLIENT_EMAIL, phone: "+16025550100" },
      [NO_PULL_CLIENT]: { first_name: "Empty", last_name: "Client", email: "empty.client@example.test", phone: "+16025550101" },
      [CLIENT_B]: { first_name: "Second", last_name: "Client", email: CLIENT_B_EMAIL, phone: "+16025550102" },
    },
    extra: [
      ...fail,
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
      // The bureau answers on file, read again at every press (a test can move them on between presses).
      [/FROM dispute_items/, (sql, params) => shelf(priorRows.map((row) => ({ ...row, client_id: CLIENT_ID })), [
        clause(/di\.client_id = \$1/, (row, [id]) => row.client_id === id),
      ])(sql, params)],
      [/FROM businesses/, []],
      [/UPDATE clients SET tags/, (sql, p) => {
        tagWrites.push({ clientId: p[0], tags: p[1] });
        for (const row of reached(sql, p)) row.tags = [...new Set([...row.tags, ...p[1]])];
        return [];
      }],
      [/UPDATE clients SET custom_fields/, (sql, p) => {
        const patch = JSON.parse(p[1]);
        fieldWrites.push({ clientId: p[0], patch });
        for (const row of reached(sql, p)) row.custom_fields = { ...row.custom_fields, ...patch };
        return [];
      }],
      [(sql) => /\b(?:INSERT INTO|UPDATE|FROM)\s+document(?:s|_versions)\b/i.test(sql) || /coalesce\(max\(version\)/i.test(sql),
        (sql, p) => documents.query(sql, p)],
    ],
  });
  return {
    fake,
    documents: documents._documents,
    versions: documents._versions,
    clients: clientRows,
    tagWrites,
    fieldWrites,
    setPrior(rows) { priorRows = rows; },
  };
}

/** One press of the button against a company; reports what was saved, queued and sent. */
async function press(company, body) {
  const res = makeRes();
  await runWithSharedDb(company.fake, () => handler(req("POST", { body }), res));
  const emails = company.fake.find(/INSERT INTO messages/).map((c) => ({
    orgId: c.params[0], clientId: c.params[1], channel: c.params[2], templateKey: c.params[3], body: String(c.params[4]),
    toAddress: c.params[6], providerRef: c.params[5], subject: c.params[7],
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

/**
 * Only the clients a press was for are tagged and stamped. A tag or a stamp
 * written without its `WHERE id = $1` reaches the whole table: every other
 * client in this company, and the other company's client, change.
 */
function assertOthersUntouched(out, touchedIds, why) {
  for (const row of out.clients.filter((r) => !touchedIds.includes(r.id))) {
    assert.deepEqual(row.tags, [], `${why}: client ${row.id} was tagged by a press that was not for them`);
    assert.deepEqual(row.custom_fields, {}, `${why}: client ${row.id} was stamped by a press that was not for them`);
  }
}

/** What a saved PDF actually says. The file is read back, not only checked for its %PDF bytes. */
async function pdfText(doc) {
  const got = await storeFromEnv().get(doc.storage_key);
  assert.equal(got.body.subarray(0, 4).toString(), "%PDF", `${doc.title} is not a PDF`);
  return (await extractPdfText(got.body)).text.replace(/\s+/g, " ");
}

/** Every saved document with the words it carries (HTML pages with their tags removed). */
async function readAll(docs) {
  const read = [];
  for (const doc of docs) {
    const text = doc.mime_type === "application/pdf"
      ? await pdfText(doc)
      : (await storeFromEnv().get(doc.storage_key)).body.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    read.push({ doc, text });
  }
  return read;
}

/**
 * Every saved document is addressed from THIS client at THIS home address and
 * from nobody else. Letters printed with the wrong person's name go to a credit
 * bureau signed by the wrong person, which is the defect this reads for.
 */
function assertAddressedTo(read, { name, street, notNames = [], notStreets = [] }) {
  assert.ok(read.length > 0, `no documents to read for ${name}`);
  for (const { doc, text } of read) {
    assert.ok(text.includes(name), `${doc.title} does not carry the client's name "${name}"`);
    if (doc.mime_type === "application/pdf") {
      assert.ok(text.includes(street), `${doc.title} does not carry the home address "${street}"`);
    }
    for (const other of notNames) assert.ok(!text.includes(other), `${doc.title} names another client: "${other}"`);
    for (const other of notStreets) assert.ok(!text.includes(other), `${doc.title} carries another client's address: "${other}"`);
  }
}

/** The two bureaus that are not this one. */
const otherBureaus = (code) => Object.entries(BUREAUS).filter(([otherCode]) => otherCode !== code).map(([, bureau]) => bureau);

/** A letter to a bureau opens with that bureau's own name and box, and carries no other bureau's box. */
function assertAddressedToBureau(text, code, label) {
  const bureau = BUREAUS[code];
  assert.match(text, new RegExp(`\\d{4} ${escapeRe(bureau.addressee)} R[Ee]:`), `${label} is not addressed to ${bureau.sourceType}`);
  for (const other of otherBureaus(code)) {
    assert.ok(!text.includes(other.box), `${label} carries the ${other.sourceType} mailing box ${other.box}`);
  }
}

/** A bureau's personal-information letter: its own facts, none of another bureau's, and this client's one legal name and address. */
function assertPersonalInfoLetter(text, code, label) {
  assertAddressedToBureau(text, code, label);
  for (const fact of BUREAUS[code].facts) assert.ok(text.includes(fact.letter), `${label} does not carry ${BUREAUS[code].sourceType}'s own "${fact.letter}"`);
  for (const other of otherBureaus(code)) {
    for (const fact of other.facts) assert.ok(!text.includes(fact.letter), `${label} carries ${other.sourceType}'s "${fact.letter}"`);
  }
  assert.ok(text.includes("Please keep only my legal name: Fixture Client") || !/NAME VARIATIONS/.test(text), `${label} keeps a name that is not the client's`);
  assert.ok(text.includes("Please keep only this address: 100 Test Ave, Denton, TX 76205"), `${label} keeps an address that is not the client's`);
}

/** A bureau's round letter covers exactly that bureau's derogatory accounts and none of another bureau's. */
function assertRoundLetter(text, code, label) {
  assertAddressedToBureau(text, code, label);
  const own = derogatory(code);
  const ending = [...new Set([...text.matchAll(/ending in (\d{4})/gi)].map((m) => m[1]))].sort();
  assert.deepEqual(ending, [...new Set(own.map((t) => last4(t.accountIdentifier)))].sort(), `${label} covers the wrong accounts`);
  const ownNames = new Set(own.map((t) => t.creditorName ?? "unknown"));
  for (const name of ownNames) assert.match(text, standalone(name), `${label} does not name ${name}`);
  const others = new Set(SANDBOX_PULL.tradelines
    .filter((t) => t.sourceType !== BUREAUS[code].sourceType)
    .map((t) => t.creditorName)
    .filter((name) => name && !ownNames.has(name)));
  for (const name of others) assert.doesNotMatch(text, standalone(name), `${label} names ${name}, an account that is not on this bureau's report`);
}

/** The rows of a pack, one line each, sorted: what kind of document it is and which file or bureau it is for. */
const repairShape = (docs) => docs.map((d) => `${d.subtype} | ${d.metadata.pack} | ${d.metadata.path}`).sort();
const fundingShape = (docs) => docs.map((d) => `${d.subtype} | ${d.metadata.stack} | ${d.metadata.bureau ?? "-"}`).sort();

/** The documents the repair pack holds for the stored pull: a round letter per bureau that earns one, a personal-info letter per bureau, and the complaints from Round 4. */
function expectedRepairShape({ complaints }) {
  const rows = [
    ...ROUND_LETTER_BUREAUS.map((code) => `${code.toLowerCase()}_round1.pdf`),
    ...Object.keys(BUREAUS).map((code) => `personal_info_${code.toLowerCase()}.pdf`),
  ].map((file) => `metro2_dispute_letter_pack | repair_letter_pack | ${file}`);
  if (complaints) {
    rows.push("cfpb_complaint | repair_letter_pack | 06-complaints-CONDITIONAL/CFPB-Complaint.pdf");
    rows.push("state_ag_complaint | repair_letter_pack | 06-complaints-CONDITIONAL/State-Attorney-General-Complaint.pdf");
  }
  return rows.sort();
}

/** The documents the funding pack holds for the stored pull. */
function expectedFundingShape() {
  return [
    "credit_analysis_report | funding | -",
    "funding_snapshot | funding | -",
    "bank_lender_match_list | funding | -",
    "credit_optimization_roadmap | funding | -",
    "business_duplication_map | funding | -",
    ...Object.entries(BUREAUS).filter(([, b]) => b.inquiries.length).map(([code]) => `funding_inquiry_removal | funding | ${code}`),
    ...Object.keys(BUREAUS).map((code) => `funding_personal_info | funding | ${code}`),
  ].sort();
}

/**
 * The whole repair pack, by name and by content: the exact set of files, each
 * round letter to its own bureau and covering its own accounts, each
 * personal-info letter with its own bureau's facts, and the sworn complaints
 * only when Round 4 was reached.
 */
async function assertRepairPack(docs, { complaints = true, why = "repair pack" } = {}) {
  assert.deepEqual(repairShape(docs), expectedRepairShape({ complaints }), `${why}: the files in the pack are not the ones this file earns`);
  const read = await readAll(docs);
  const byPath = new Map(read.map((r) => [r.doc.metadata.path, r]));
  for (const code of Object.keys(BUREAUS)) {
    const round = byPath.get(`${code.toLowerCase()}_round1.pdf`);
    if (ROUND_LETTER_BUREAUS.includes(code)) assertRoundLetter(round.text, code, `${why}: ${code} round letter`);
    else assert.equal(round, undefined, `${why}: a round letter was made for ${code}, whose report has nothing wrong`);
    assertPersonalInfoLetter(byPath.get(`personal_info_${code.toLowerCase()}.pdf`).text, code, `${why}: ${code} personal info`);
  }
  assertAddressedTo(read, {
    name: "Fixture Client",
    street: "100 Test Ave",
    notNames: ["Second Client", "Empty Client", "Foreign Client"],
    notStreets: ["200 Other St"],
  });
  assertRepairTitles(docs);
  assert.ok(docs.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID && d.kind === "deliverable"), `${why}: a document is not on this client's file`);
  assert.ok(docs.every((d) => d.generated_by === "closer-deck"), `${why}: a document is not marked as made by the closer deck`);
}

/** The whole funding pack, by name and by content. */
async function assertFundingPack(docs, why = "funding pack") {
  assert.deepEqual(fundingShape(docs), expectedFundingShape(), `${why}: the files in the pack are not the ones this file earns`);
  const read = await readAll(docs);
  for (const { doc, text } of read.filter((r) => r.doc.subtype === "funding_inquiry_removal")) {
    const code = doc.metadata.bureau;
    assertAddressedToBureau(text, code, `${why}: ${code} inquiry letter`);
    for (const name of BUREAUS[code].inquiries) assert.match(text, standalone(name), `${why}: ${code} inquiry letter does not list ${name}`);
    for (const other of otherBureaus(code)) {
      for (const name of other.inquiries) assert.doesNotMatch(text, standalone(name), `${why}: ${code} inquiry letter lists ${name}, a ${other.sourceType} pull`);
    }
  }
  for (const { doc, text } of read.filter((r) => r.doc.subtype === "funding_personal_info")) {
    assertPersonalInfoLetter(text, doc.metadata.bureau, `${why}: ${doc.metadata.bureau} personal info`);
  }
  for (const { doc } of read.filter((r) => r.doc.mime_type === "text/html")) {
    assert.match((await storeFromEnv().get(doc.storage_key)).body.toString("utf8"), /^\s*<(?:!doctype|html)/i, `${doc.subtype} is not a page`);
  }

  assertAddressedTo(read, {
    name: "Fixture Client",
    street: "100 Test Ave",
    notNames: ["Second Client", "Empty Client", "Foreign Client"],
    notStreets: ["200 Other St"],
  });
  assertFundingTitles(docs);
  assert.ok(docs.every((d) => d.org_id === ORG_ID && d.client_id === CLIENT_ID && d.kind === "deliverable"), `${why}: a document is not on this client's file`);
  assert.ok(docs.every((d) => d.generated_by === "closer-deck"), `${why}: a document is not marked as made by the closer deck`);
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

/** The email a client was sent is the seeded copy, filled in for THIS client. */
function assertSeededEmail(message, key, { firstName, email }, why) {
  assert.equal(message.templateKey, key, `${why}: wrong template`);
  assert.equal(message.subject, SEEDED[key].subject, `${why}: the subject is not the seeded subject`);
  assert.ok(message.body.includes(firstName), `${why}: the email does not greet ${firstName}`);
  assert.ok(!/\{\{/.test(message.body), `${why}: a merge tag went to the client unfilled`);
  if (/\{\{portal_(?:login_)?url\}\}/.test(SEEDED[key].body)) {
    assert.ok(message.body.includes(encodeURIComponent(email)), `${why}: the portal link is not this client's`);
  }
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

/** One line per saved document: which one it is, which version it is on, and where its bytes sit. */
const ledger = (company) => company.documents.map((d) => `${d.id} ${d.document_key} v${d.current_version} ${d.storage_key}`);

test("closer-deck generate_letters uses the email template keys the database seed holds, word for word, and the seed holds both", () => {
  // The product's own names for the two keys are the seeded ones. A typo in either one
  // finds no template in production: nothing is queued, and the client is told nothing.
  assert.equal(EMAIL_TEMPLATE_KEY, LETTERS_KEY);
  assert.equal(FUNDING_EMAIL_TEMPLATE_KEY, DELIVERABLES_KEY);
  for (const key of [LETTERS_KEY, DELIVERABLES_KEY]) {
    const seeded = SEEDED[key];
    assert.equal(seeded.channel, "email", key);
    assert.ok(seeded.subject.length > 0, `${key} has no subject`);
    assert.match(seeded.body, /\{\{contact\.first_name\}\}/, `${key} does not greet the client by name`);
  }
  // The fixture is what it says it is: the lines each bureau letter is checked
  // against sit in that bureau's own sandbox report, and in no other.
  for (const [code, bureau] of Object.entries(BUREAUS)) {
    const own = JSON.stringify(loadSandbox(bureau.file));
    for (const fact of bureau.facts) assert.ok(own.includes(fact.raw), `${code}: "${fact.raw}" is not in ${bureau.file}`);
    for (const name of bureau.inquiries) assert.ok(own.includes(name), `${code}: inquiry "${name}" is not in ${bureau.file}`);
  }
  assert.deepEqual(ROUND_LETTER_BUREAUS, ["EX", "EQ"], "the stored pull should earn a round letter at Experian and Equifax only");
});

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
  assert.ok(out.documents.every((d) => d.mime_type === "application/pdf"));
  // The pack is the exact set of files this file earns, each read back: round
  // letters to their own bureau covering their own accounts, personal-info
  // letters with each bureau's own facts, both sworn complaints.
  await assertRepairPack(out.documents, { complaints: true, why: "repair button" });

  // One email, the letters-ready one, to this client's address, and it went through dispatch.
  assert.equal(out.emails.length, 1);
  const [email] = out.emails;
  assert.deepEqual(
    [email.orgId, email.clientId, email.channel, email.toAddress],
    [ORG_ID, CLIENT_ID, "email", CLIENT_EMAIL]
  );
  assertSeededEmail(email, LETTERS_KEY, { firstName: "Fixture", email: CLIENT_EMAIL }, "repair button");
  assert.equal(body.email.outcome, "sent", JSON.stringify(body.email));
  // What the (in-memory) provider was handed: one email, to this client, nothing else.
  assert.equal(out.sent.length, 1);
  assert.deepEqual(
    [out.sent[0].orgId, out.sent[0].clientId, out.sent[0].channel, out.sent[0].subject, out.sent[0].to],
    [ORG_ID, CLIENT_ID, "email", SEEDED[LETTERS_KEY].subject, CLIENT_EMAIL]
  );

  // The client is tagged and the file says Delivered, both on this client only.
  assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:diy-letters"] }]);
  assert.equal(out.fieldWrites.length, 1);
  assert.equal(out.fieldWrites[0].clientId, CLIENT_ID);
  assert.equal(out.fieldWrites[0].patch.diy_status, "Delivered");
  assert.equal(out.fieldWrites[0].patch.closer_deck_letters_offer, "REPAIR_DFY");
  assertStampedNow(out.fieldWrites[0].patch, startedAt, "repair button");
  // The table says the same: this client carries the tag and the stamp, nobody else does.
  const mine = out.clients.find((row) => row.id === CLIENT_ID);
  assert.deepEqual(mine.tags, ["client:diy-letters"]);
  assert.equal(mine.custom_fields.diy_status, "Delivered");
  assertOthersUntouched(out, [CLIENT_ID], "repair button");
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
  const subtypes = out.documents.map((d) => d.subtype);
  // The pack is the exact set of files this file earns: the five analysis pages
  // (the Business Duplication Map among them), an inquiry-removal letter and a
  // personal-info letter for each bureau that has something to correct, each
  // addressed to its own bureau and listing only its own pulls and facts.
  await assertFundingPack(out.documents, "education button");
  const letters = out.documents.filter((d) => d.mime_type === "application/pdf");
  assert.ok(letters.length > 0, "the bureau letters are saved as PDFs");
  assert.equal(subtypes.includes("metro2_dispute_letter_pack"), false, "a deliverables package carries no dispute letters");

  assert.equal(out.emails.length, 1);
  assert.equal(out.emails[0].clientId, CLIENT_ID);
  assertSeededEmail(out.emails[0], DELIVERABLES_KEY, { firstName: "Fixture", email: CLIENT_EMAIL }, "education button");
  assert.notEqual(out.emails[0].templateKey, LETTERS_KEY, "the education button sends the deliverables email");
  assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:deliverables"] }]);
  assert.equal(out.fieldWrites.at(-1).patch.diy_status, "Delivered");
  assert.equal(out.fieldWrites.at(-1).patch.closer_deck_letters_offer, "UWIQ_DELIVERABLES");
  assertStampedNow(out.fieldWrites.at(-1).patch, startedAt, "education button");
  assertOthersUntouched(out, [CLIENT_ID], "education button");
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
    assertOthersUntouched(out, [NO_PULL_CLIENT], "empty pack");
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
    [LETTERS_KEY]: { ...APPROVED[LETTERS_KEY], compliance_passed: false },
    [DELIVERABLES_KEY]: { ...APPROVED[DELIVERABLES_KEY], compliance_passed: false },
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

test("closer-deck generate_letters touches nothing for another company's client, a bad id, a caller with no sign-in, or a sign-in whose company is not a company id", async () => {
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

  // Staff whose company is not a company id are refused before any client is looked up.
  const noCompany = await run(repairBody(), { staffOrg: "not-a-uuid" });
  assert.equal(noCompany.res.statusCode, 403);
  assert.equal(noCompany.res.body.error, "forbidden");
  assertNothingWritten(noCompany, "a sign-in with no valid company");
  assert.equal(noCompany.fake.find(/SELECT 1 FROM clients/).length, 0, "a client was looked up for a sign-in with no valid company");
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

test("closer-deck generate_letters pressed twice emails the client once, saves each letter once, and adds no second version of a letter that did not change", async () => {
  for (const [label, body] of [["repair button", repairBody()], ["education button", eduBody()]]) {
    resetProvider();
    const company = world();
    const first = await press(company, body);
    assert.equal(first.res.statusCode, 200, label);
    assert.equal(first.res.body.email.outcome, "sent", label);
    const filed = ledger(company);
    assert.ok(filed.length > 0, `${label}: nothing was saved`);
    const second = await press(company, body);
    assert.equal(second.res.statusCode, 200, label);
    // The second press asks for the same message (same client, same offer): the queue refuses a copy.
    const refs = company.fake.state.messages.map((m) => m.provider_ref);
    assert.equal(refs.length, 1, `${label}: two messages were queued: ${refs.join(", ")}`);
    assert.equal(recorded().length, 1, `${label}: the client was emailed once`);
    // The saved letters are the same rows: same ids, same keys, still on their first version,
    // the same bytes. No second copy of a letter, and no new version of one that did not change.
    assert.equal(second.res.body.documentsStored, first.res.body.documentsStored, label);
    assert.deepEqual(ledger(company), filed, `${label}: a second press changed what is saved`);
    assert.equal(company.versions.length, filed.length, `${label}: a letter was given a second version`);
    assert.ok(company.documents.every((d) => d.current_version === 1), `${label}: a letter moved off its first version`);
    // The tag is on once, and the table holds only this client's.
    assert.deepEqual(company.clients.find((row) => row.id === CLIENT_ID).tags.length, 1, label);
    assertOthersUntouched(company, [CLIENT_ID], label);
  }
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
      [ORG_ID, CLIENT_ID, "email", LETTERS_KEY, CLIENT_EMAIL],
      [ORG_ID, CLIENT_B, "email", LETTERS_KEY, CLIENT_B_EMAIL],
    ]
  );
  assert.equal(new Set(queued.map((m) => m.provider_ref)).size, 2, "the two clients share one message key");
  assert.ok(queued[0].rendered_body.includes("Fixture"));
  assert.ok(queued[1].rendered_body.includes("Second"), "the second client was not greeted by her own name");
  assert.ok(!queued[1].rendered_body.includes("Fixture"), "the second client was sent the first client's words");
  assert.ok(queued[1].rendered_body.includes(encodeURIComponent(CLIENT_B_EMAIL)), "the second client was sent the first client's portal link");
  assert.deepEqual(
    recorded().map((m) => [m.orgId, m.clientId, m.channel, m.to]),
    [[ORG_ID, CLIENT_ID, "email", CLIENT_EMAIL], [ORG_ID, CLIENT_B, "email", CLIENT_B_EMAIL]]
  );

  // Each client's own letters, on each client's own file, with their own name and street.
  const docsOf = (id) => company.documents.filter((d) => d.client_id === id);
  assert.equal(company.documents.length, docsOf(CLIENT_ID).length + docsOf(CLIENT_B).length, "a document sits on neither client");
  assertAddressedTo(await readAll(docsOf(CLIENT_ID)), {
    name: "Fixture Client", street: "100 Test Ave", notNames: ["Second Client"], notStreets: ["200 Other St"],
  });
  assertAddressedTo(await readAll(docsOf(CLIENT_B)), {
    name: "Second Client", street: "200 Other St", notNames: ["Fixture Client"], notStreets: ["100 Test Ave"],
  });
  assert.deepEqual(company.tagWrites.map((w) => w.clientId), [CLIENT_ID, CLIENT_B]);
  assert.deepEqual(company.fieldWrites.map((w) => w.clientId), [CLIENT_ID, CLIENT_B]);
  for (const write of company.fieldWrites) assertStampedNow(write.patch, startedAt, `client ${write.clientId}`);
  // Each client holds their own tag and stamp; the other company's client and the one with no pull hold none.
  for (const id of [CLIENT_ID, CLIENT_B]) {
    const row = company.clients.find((r) => r.id === id);
    assert.deepEqual(row.tags, ["client:diy-letters"], id);
    assert.equal(row.custom_fields.diy_status, "Delivered", id);
  }
  assertOthersUntouched(company, [CLIENT_ID, CLIENT_B], "two clients");
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
    // Short of Round 4 the pack is exactly the bureau letters, no more.
    assert.deepEqual(repairShape(out.documents), expectedRepairShape({ complaints: false }), label);
  }
  // The same file at Round 4 gets the pair on top of the bureau letters.
  const escalated = await run(repairBody(), { prior: ESCALATED_R4 });
  const subtypes = escalated.documents.map((d) => d.subtype);
  for (const wanted of sworn) assert.ok(subtypes.includes(wanted), `${wanted} was withheld at Round 4`);
  assert.deepEqual(repairShape(escalated.documents), expectedRepairShape({ complaints: true }));
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

test("closer-deck generate_letters sends the repair pack on the trial offer and on the descent press, where a funding tier with force_repair still gets the letters", async () => {
  // The three requests the cockpit button posts when it is not the funding sale and not education:
  // rung 1 (the trial), and the descent press (a funding-qualified client moved down to repair),
  // which keeps the funding tier name and says force_repair, with the repair offer's own key.
  const presses = [
    ["the trial offer", repairBody({ offer_key: "REPAIR_TRIAL" })],
    ["the descent press, repair offer, full-funding tier", repairBody({ offer_key: "REPAIR_DFY", tier: "FULL_FUNDING", force_repair: true })],
    ["the descent press, trial offer, funding-plus-repair tier", repairBody({ offer_key: "REPAIR_TRIAL", tier: "FUNDING_PLUS_REPAIR", force_repair: true })],
  ];
  for (const [label, body] of presses) {
    const startedAt = Date.now();
    const out = await run(body);
    assert.equal(out.res.statusCode, 200, `${label}: ${JSON.stringify(out.res.body)}`);
    assert.equal(out.res.body.delivered, true, label);
    assert.equal(out.res.body.pack, "repair", label);
    assert.equal(out.res.body.reason, null, label);
    assert.ok(out.res.body.documentsStored > 0, label);
    // The same pack the plain repair press makes, file for file.
    await assertRepairPack(out.documents, { complaints: true, why: label });
    assert.equal(out.emails.length, 1, label);
    assert.equal(out.emails[0].clientId, CLIENT_ID, label);
    assertSeededEmail(out.emails[0], LETTERS_KEY, { firstName: "Fixture", email: CLIENT_EMAIL }, label);
    assert.equal(out.sent.length, 1, label);
    assert.deepEqual(out.tagWrites, [{ clientId: CLIENT_ID, tags: ["client:diy-letters"] }], label);
    assert.equal(out.fieldWrites[0].patch.diy_status, "Delivered", label);
    assert.equal(out.fieldWrites[0].patch.closer_deck_letters_offer, body.offer_key, label);
    assertStampedNow(out.fieldWrites[0].patch, startedAt, label);
    assertOthersUntouched(out, [CLIENT_ID], label);
  }
});

test("closer-deck generate_letters pressed again after a Round 4 answer adds the two complaints once and repeats no letter", async () => {
  resetProvider();
  const company = world({ prior: [] });
  const first = await press(company, repairBody());
  assert.equal(first.res.body.delivered, true);
  assert.deepEqual(repairShape(company.documents), expectedRepairShape({ complaints: false }), "Round 1 saves the bureau letters only");
  const lettersBefore = new Map(company.documents.map((d) => [d.document_key, d.id]));
  // The bureau answers, the file reaches Round 4, the closer presses again.
  company.setPrior(ESCALATED_R4);
  const second = await press(company, repairBody());
  assert.equal(second.res.statusCode, 200, JSON.stringify(second.res.body));
  assert.equal(second.res.body.delivered, true);
  // The pair is now on the file, once, and every letter that was there is still that one row.
  assert.deepEqual(repairShape(company.documents), expectedRepairShape({ complaints: true }));
  assert.equal(new Set(company.documents.map((d) => d.document_key)).size, company.documents.length, "a document key is on the file twice");
  for (const [key, id] of lettersBefore) {
    assert.equal(company.documents.find((d) => d.document_key === key)?.id, id, `${key} was replaced by a new row`);
  }
  assertOthersUntouched(company, [CLIENT_ID], "second press");
});

test("closer-deck generate_letters answers an unexpected failure with a 500 that says what failed, a database outage with a 503, and builds, saves and sends nothing", async () => {
  const ownership = /SELECT 1 FROM clients WHERE id = \$1/;
  const seen = async (error) => {
    const out = await run(repairBody(), { fail: [[ownership, error]] });
    assertNothingWritten(out, error.message || "an empty error");
    assert.equal(out.fake.find(/FROM crs_results/).length, 0, "a pack was built over a failure");
    assert.deepEqual(out.sent, [], "something was sent over a failure");
    return out.res;
  };

  const unexpected = await seen(new Error('column "org_id" does not exist'));
  assert.equal(unexpected.statusCode, 500);
  assert.equal(unexpected.body.ok, false);
  assert.equal(unexpected.body.error, "send_failed");
  assert.equal(unexpected.body.message, 'column "org_id" does not exist', "the presenter is told what failed");

  // A failure that says nothing still answers with words the screen can print.
  const silent = await seen(new Error(""));
  assert.equal(silent.statusCode, 500);
  assert.equal(silent.body.ok, false);
  assert.equal(silent.body.error, "send_failed");
  assert.equal(silent.body.message, "Something went wrong sending that. Try again in a moment.");

  // A long driver message is cut, not dumped on the screen.
  const long = await seen(new Error("x".repeat(400)));
  assert.equal(long.statusCode, 500);
  assert.equal(long.body.message.length, 180);

  // The database itself not answering is its own answer, so the screen does not blame the code.
  const outage = await seen(Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }));
  assert.equal(outage.statusCode, 503);
  assert.equal(outage.body.ok, false);
  assert.equal(outage.body.error, "db_unavailable");
  assert.equal(outage.body.db, "down");
});
