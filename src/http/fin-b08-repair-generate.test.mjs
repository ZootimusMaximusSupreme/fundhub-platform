// finish-853 batch 08: POST /api/repair/generate. The real handler, the real credit-file analysis,
// the real letter writer, the real case store and the real card mover run over stand-in tables that
// answer by the client and company each statement names, with a recording stand-in for the letter
// file store. The row's words: analyses a client's stored credit file and stores the dispute letters
// it supports (cases, items, letters, saved letter files) and moves the repair card; mails
// nothing; honest refusals answer 200 ok:false. Practice test, fake data, no network, no database.
import { test, describe, before, after } from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

import handler from "../../api/repair/generate.mjs";
import { makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { fakeDb } from "../testing/handler-harness.mjs";
import { tablesDb, orderAndLimit } from "../testing/fin-b08-tables.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const PIPE = "0b110000-0000-4000-8000-000000000001";
const STAGES = [
  { id: "57a60000-0000-4000-8000-000000000001", pipeline_id: PIPE, org_id: ORG_ID, key: "analysis", pipeline_key: "optimization" },
  { id: "57a60000-0000-4000-8000-000000000002", pipeline_id: PIPE, org_id: ORG_ID, key: "letters_generated", pipeline_key: "optimization" },
  { id: "57a60000-0000-4000-8000-000000000003", pipeline_id: PIPE, org_id: ORG_ID, key: "ready_to_send", pipeline_key: "optimization" },
];
const FILE = {
  bureausPulled: ["EX"],
  bureaus: { EX: {
    creditFiles: [{ creditFileDetail: { creditFileInfileDate: "2026-09-03", creditFileResultStatusType: "FileReturned", sourceType: "Experian" } }],
    inquiries: [],
    tradelines: [{
      creditorName: "MIDLAND CREDIT MANAGEMENT", accountIdentifier: "SIM-MCM-6642", accountOpenedDate: "2024-02-20", accountReportedDate: "2026-08-28",
      accountOwnershipType: "Individual", accountStatusType: "Open", accountType: "Open", loanType: "CollectionAgencyAttorney", businessType: "Collection",
      currentRatingType: "CollectionOrChargeOff", currentBalanceAmount: "1840", pastDueAmount: "0", sourceType: "Experian",
    }],
  } },
};
const realFetch = globalThis.fetch;
const asked = [];
before(() => { globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

function repairFile({ agreement = true, consent = false, verified = true, pull = FILE, cases = [], pulledAt = "2026-09-03T00:00:00Z", tier = "REPAIR_ONLY", olderPull = null, roundsCap = null, furnishers = [], program = null, template = false } = {}) {
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG_ID, first_name: "Sim", last_name: "Repair", outcome_tier: tier },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Foreign", last_name: "Person", outcome_tier: tier },
    ],
    // The older pull is stored FIRST, so only the statement's own ORDER BY ... LIMIT 1 puts the newest one on top.
    crs_results: pull ? [
      ...(olderPull ? [{ id: "p0", org_id: ORG_ID, client_id: CLIENT, result: olderPull, created_at: "2026-06-01T00:00:00Z" }] : []),
      { id: "p1", org_id: ORG_ID, client_id: CLIENT, result: pull, created_at: pulledAt },
    ] : [],
    pii_identity: [{
      org_id: ORG_ID, client_id: CLIENT, addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }],
      ...(verified ? { verified_legal_name: "Sim Repair", verified_address: { line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" },
        verified_dob: null, verified_by: "doc-check", verified_at: "2026-09-01T00:00:00Z", verified_field_sources: {} } : {}),
    }],
    contracts: agreement ? [{ id: "k1", org_id: ORG_ID, client_id: CLIENT, status: "signed" }] : [],
    client_consents: consent ? [{ id: "cc1", org_id: ORG_ID, client_id: CLIENT, kind: "dispute_authorization", is_valid: true, granted_at: "2026-09-01T00:00:00Z" }] : [],
    dispute_cases: cases.map((c, i) => ({ id: `ca00000${i}-0000-4000-8000-000000000000`, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", status: "open", ...c })),
    dispute_items: [], dispute_letters: [], documents: [], document_versions: [], cards: [],
  };
  const stored = [];
  const store = {
    put: async (arg) => {
      const html = String((arg && arg.body) || "");
      stored.push({ filename: arg && arg.filename, kind: arg && arg.kind, orgId: arg && arg.orgId, clientId: arg && arg.clientId, html });
      return {
        key: `store/${arg && arg.filename}`, storageKey: `memory://letters/${arg && arg.filename}`, mimeType: arg && arg.mimeType,
        byteSize: Buffer.byteLength(html), checksum: `sha256:${createHash("sha256").update(html).digest("hex")}`,
      };
    },
    get: async () => null,
  };
  const fake = tablesDb({
    tables,
    autoInsert: true,
    rules: [
      [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map(() => ({ "?column?": 1 }))],
      [/^\s*SELECT first_name, last_name FROM clients/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1])],
      // The tier is read by client id alone, as the product's own statement does; a company is checked only when it is given.
      [/^\s*SELECT outcome_tier FROM clients/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && (p.length < 2 || c.org_id === p[1])).map((c) => ({ outcome_tier: c.outcome_tier }))],
      [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id\s+FROM pipeline_stages ps/i, (_s, p) => STAGES.filter((s) => s.pipeline_key === p[0] && s.key === p[1] && s.org_id === p[2])
        .map((s) => ({ stage_id: s.id, pipeline_id: s.pipeline_id }))],
      [/^\s*SELECT id FROM cards WHERE client_id = \$1 AND pipeline_id = \$2/i, (_s, p) => tables.cards.filter((c) => c.client_id === p[0] && c.pipeline_id === p[1]).map((c) => ({ id: c.id }))],
      [/^\s*UPDATE cards SET stage_id = \$2 WHERE id = \$1/i, (_s, p) => { const c = tables.cards.find((x) => x.id === p[0]); if (c) c.stage_id = p[1]; return { rows: [], rowCount: 1 }; }],
      [/^\s*INSERT INTO cards \(org_id, client_id, pipeline_id, stage_id\)/i, (_s, p) => { tables.cards.push({ id: `k${tables.cards.length + 1}`, org_id: p[0], client_id: p[1], pipeline_id: p[2], stage_id: p[3] }); return { rows: [], rowCount: 1 }; }],
      [/FROM repair_programs/i, () => (program ? [program] : roundsCap == null ? [] : [{ program: "repair", rounds_cap: roundsCap, status: "active" }])],
      // The rounds this client has been through: the statement's own status condition decides which cases count.
      [/^\s*SELECT round FROM dispute_cases/i, (sql, p) => {
        const dropsCancelled = /status\s*<>\s*'cancelled'/i.test(sql);
        return tables.dispute_cases
          .filter((c) => c.client_id === p[0] && c.org_id === p[1] && (!dropsCancelled || c.status !== "cancelled"))
          .map((c) => ({ round: c.round }));
      }],
      // The furnisher's own mailing address, by the statement's own conditions: active, this name, global or this company's, company's first.
      [/FROM furnisher_mail_addresses/i, (sql, p) => orderAndLimit(furnishers.filter((f) => f.active && f.name_norm === p[0] && (f.org_id === null || f.org_id === p[1])), sql, p)],
      // An approved template for ANY key: a letter run that tried to email the client would show up as a message row.
      [/^\s*SELECT body, subject, compliance_passed\s+FROM message_templates/i, () => (template ? [{ body: "Your letters are ready {{contact.first_name}}", subject: "Letters", compliance_passed: true }] : [])],
      [/^\s*SELECT dc\.id, dc\.org_id, dc\.client_id, dc\.bureau, dc\.round,/i, []],
      [/^\s*SELECT MAX\(dl\.created_at\) AS newest/i, (_s, p) => {
        const rows = tables.dispute_letters.filter((l) => l.org_id === p[0] && l.client_id === p[1] && p[2].includes(l.round) && (l.target || "bureau") === "bureau");
        return [{ newest: rows.map((l) => l.created_at).sort().at(-1) || null }];
      }],
    ],
  });
  return { fake, tables, store, stored };
}

async function call(body, file, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: file.fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : file.fake.query(sql, params)),
    connect: () => file.fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res, { db: combined, documentStore: file.store }));
  return { res, file };
}

describe("POST /api/repair/generate", () => {
  test("a repair client's stored credit file is turned into one saved letter per bureau, with its case, its items and its letter file", async () => {
    const file = repairFile();
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.round, "R1");
    assert.equal(res.body.letters.length, 1);
    assert.equal(res.body.letters[0].bureau, "EX");
    assert.deepEqual(res.body.letters[0].ruleIds, ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    assert.equal(file.tables.dispute_cases.length, 1);
    assert.deepEqual([file.tables.dispute_cases[0].org_id, file.tables.dispute_cases[0].client_id, file.tables.dispute_cases[0].bureau, file.tables.dispute_cases[0].round],
      [ORG_ID, CLIENT, "EX", "R1"]);
    assert.equal(file.tables.dispute_items.length, 3);
    assert.ok(file.tables.dispute_items.every((i) => i.case_id === file.tables.dispute_cases[0].id && i.client_id === CLIENT));
    assert.equal(file.tables.dispute_letters.length, 1);
    const letter = file.tables.dispute_letters[0];
    assert.equal(letter.status, "generated");
    assert.equal(letter.bureau, "EX");
    assert.match(letter.body_text, /MIDLAND CREDIT MANAGEMENT/);
    assert.match(letter.body_text, /Sim Repair/);
    assert.deepEqual(letter.rule_ids, ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    assert.equal(file.stored.length, 1, "the letter file is saved");
    assert.deepEqual([file.stored[0].filename, file.stored[0].kind, file.stored[0].orgId, file.stored[0].clientId], ["EX_R1_bureau.html", "deliverable", ORG_ID, CLIENT]);
    assert.match(file.stored[0].html, /Sim Repair/);
  });

  test("when the client has two stored credit files the newest one is the one analysed", async () => {
    const older = JSON.parse(JSON.stringify(FILE));
    older.bureaus.EX.tradelines[0].creditorName = "OLDER FURNISHER LLC";
    older.bureaus.EX.tradelines[0].accountIdentifier = "SIM-OLD-1001";
    const file = repairFile({ olderPull: older });
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    const letter = file.tables.dispute_letters[0];
    assert.match(letter.body_text, /MIDLAND CREDIT MANAGEMENT/);
    assert.doesNotMatch(letter.body_text, /OLDER FURNISHER/);
    assert.deepEqual(file.fake.calls.find((c) => /FROM crs_results/.test(c.sql)).params, [CLIENT, ORG_ID]);
  });

  test("it mails nothing: no web call, no mail provider, and the letter is saved as generated, never sent", async () => {
    const file = repairFile();
    asked.length = 0;
    await call({ client_id: CLIENT }, file);
    assert.deepEqual(asked, []);
    assert.equal(file.tables.dispute_letters.every((l) => l.status === "generated"), true);
    for (const c of file.fake.calls) assert.doesNotMatch(c.sql, /INSERT INTO messages|mailed_at|provider_id/i);
  });

  test("it moves the repair card to ready to send, on this company's board", async () => {
    const file = repairFile();
    await call({ client_id: CLIENT }, file);
    assert.equal(file.tables.cards.length, 1);
    assert.deepEqual([file.tables.cards[0].org_id, file.tables.cards[0].client_id, file.tables.cards[0].pipeline_id, file.tables.cards[0].stage_id],
      [ORG_ID, CLIENT, PIPE, STAGES[2].id]);
  });

  test("the same round again hands back the letters already made and writes nothing new", async () => {
    const file = repairFile();
    await call({ client_id: CLIENT }, file);
    const again = await call({ client_id: CLIENT, round: "R1" }, file);
    assert.equal(again.res.statusCode, 200);
    assert.equal(again.res.body.already_generated, true);
    assert.equal(file.tables.dispute_cases.length, 1);
    assert.equal(file.tables.dispute_letters.length, 1);
    assert.equal(file.tables.dispute_items.length, 3);
  });

  test("honest refusals answer 200 with ok:false and words: no credit file, no authorization, ID not read, nothing to dispute", async () => {
    const cases = [
      [repairFile({ pull: null }), "no_credit_file", /No credit file on record/],
      [repairFile({ agreement: false }), "no_authorization", /No signed repair agreement/],
      [repairFile({ verified: false }), "identity_not_verified", /ID has not been read yet/],
      // Authorised by a staff dispute consent only, on a funding-only file: nothing the repair path would write.
      [repairFile({ agreement: false, consent: true, tier: "FULL_FUNDING" }), "no_violations", /nothing to dispute/],
    ];
    for (const [file, reason, words] of cases) {
      const { res } = await call({ client_id: CLIENT }, file);
      assert.equal(res.statusCode, 200, reason);
      assert.equal(res.body.ok, false, reason);
      assert.equal(res.body.reason, reason);
      assert.match(res.body.message, words);
      assert.equal(file.tables.dispute_cases.length + file.tables.dispute_letters.length, 0, `${reason}: nothing is written`);
      assert.equal(file.stored.length, 0);
    }
  });

  test("with no round named it works out the next one from the cases the client already has; round 2 on the same file is refused as stale", async () => {
    const file = repairFile({ cases: [{ round: "R1" }] });
    // An earlier round's letter exists, newer than the credit file: Round 2 needs a fresh pull.
    file.tables.dispute_letters.push({ id: "old-letter", org_id: ORG_ID, client_id: CLIENT, case_id: "ca000000-0000-4000-8000-000000000000", bureau: "EX", round: "R1", status: "sent", target: "bureau", created_at: "2026-09-10T00:00:00Z", body_text: "old", rule_ids: [] });
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.round, "R2");
    assert.equal(res.body.reason, "credit_file_stale_for_round");
    assert.equal(file.tables.dispute_cases.length, 1, "nothing new was written");
  });

  test("a client who has already been through the last round is told so with 409, and a round that does not exist is 400", async () => {
    const file = repairFile({ cases: [{ round: "R6" }] });
    const done = await call({ client_id: CLIENT }, file);
    assert.equal(done.res.statusCode, 409);
    assert.equal(done.res.body.error, "rounds_exhausted");
    const badFile = repairFile();
    const bad = await call({ client_id: CLIENT, round: "R9" }, badFile);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_round");
    assert.equal(badFile.fake.calls.filter((c) => /FROM clients/.test(c.sql)).length, 0, "a round that does not exist is refused before the client is looked up");
  });

  test("a round past the client's repair program cap is refused with 400 and no letter is made", async () => {
    const file = repairFile({ roundsCap: 2 });
    const { res } = await call({ client_id: CLIENT, round: "R3" }, file);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "round_cap_exceeded");
    assert.equal(res.body.rounds_cap, 2);
    assert.equal(file.tables.dispute_cases.length, 0);
    assert.equal(file.tables.dispute_letters.length, 0);
    assert.equal(file.fake.calls.filter((c) => /FROM crs_results/.test(c.sql)).length, 0, "the credit file was not even read");
    const inside = await call({ client_id: CLIENT, round: "R2" }, repairFile({ roundsCap: 2 }));
    assert.notEqual(inside.res.body.error, "round_cap_exceeded", "a round inside the cap is not stopped by it");
  });

  test("a client of another company is 404 and nothing is read or written for them", async () => {
    const file = repairFile();
    const { res } = await call({ client_id: FOREIGN_CLIENT }, file);
    assert.equal(res.statusCode, 404);
    assert.equal(file.tables.dispute_cases.length, 0);
    assert.equal(file.fake.calls.filter((c) => /FROM crs_results/.test(c.sql)).length, 0);
  });

  test("only owner, admin, closer and inquiry specialist may stage letters; a client login and no login are refused", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const file = repairFile();
      const { res } = await call({ client_id: CLIENT }, file, [staffSession({ role })]);
      if (res.statusCode === 403) assert.equal(file.tables.dispute_cases.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "inquiry_specialist", "owner"]);
    const client = await call({ client_id: CLIENT }, repairFile(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 401);
    const missing = await call({}, repairFile());
    assert.equal(missing.res.statusCode, 400);
    assert.equal(missing.res.body.error, "client_id_required");
  });

  test("each item the analysis finds is saved on its own case with its rule, its severity, its creditor, the account's last four and the round", async () => {
    const file = repairFile();
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    const items = file.tables.dispute_items;
    assert.equal(items.length, 3);
    const byRule = Object.fromEntries(items.map((i) => [i.rule_id, i]));
    assert.deepEqual(Object.keys(byRule).sort(), ["DEROG-COLLECTION", "PI-ADDRESS-CONFIRM", "PI-NAME-CONFIRM"]);
    const collection = byRule["DEROG-COLLECTION"];
    assert.equal(collection.severity, "strong");
    assert.equal(collection.creditor, "MIDLAND CREDIT MANAGEMENT");
    assert.equal(collection.account_last4, "6642");
    for (const item of items) {
      assert.equal(item.org_id, ORG_ID);
      assert.equal(item.client_id, CLIENT);
      assert.equal(item.round, "R1");
      assert.equal(item.case_id, file.tables.dispute_cases[0].id);
      assert.ok(item.severity, `${item.rule_id} keeps a severity`);
      const violation = typeof item.violation === "string" ? JSON.parse(item.violation) : item.violation;
      assert.equal(violation.ruleId, item.rule_id, "the whole finding is kept beside the columns");
    }
  });

  test("the saved letter keeps its fingerprint digest, the rules it argues and its round, and the client's copy is filed as a dispute letter pack under the bureau's name", async () => {
    const file = repairFile();
    await call({ client_id: CLIENT }, file);
    const letter = file.tables.dispute_letters.find((l) => l.target === "bureau");
    assert.equal(letter.round, "R1");
    assert.equal(letter.org_id, ORG_ID);
    assert.equal(letter.client_id, CLIENT);
    assert.equal(letter.case_id, file.tables.dispute_cases[0].id);
    assert.equal(letter.fingerprint.length, 1);
    assert.match(letter.fingerprint[0], /^sha256:[0-9a-f]{64}$/, "a stable digest, not the raw shingles");
    assert.deepEqual(letter.rule_ids, ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]);
    assert.equal(file.tables.documents.length, 1);
    const doc = file.tables.documents[0];
    assert.deepEqual([doc.org_id, doc.client_id, doc.kind, doc.subtype], [ORG_ID, CLIENT, "deliverable", "metro2_dispute_letter_pack"]);
    assert.match(doc.title, /Experian R1/);
    const meta = typeof doc.metadata === "string" ? JSON.parse(doc.metadata) : doc.metadata;
    assert.deepEqual([meta.bureau, meta.round, meta.target, meta.letterId], ["EX", "R1", "bureau", letter.id]);
  });

  test("a collector on the file also gets a validation letter to that collector, from the furnisher address on file; with none on file it is named as a gap", async () => {
    const midland = (over) => ({ id: "f0000000-0000-4000-8000-000000000001", name: "Midland Credit Management", name_norm: "midland credit management", active: true, org_id: null,
      address_line1: "PO Box 301030", address_line2: null, city: "Los Angeles", state: "CA", zip: "90030", ...over });
    const file = repairFile({ furnishers: [
      midland({}),
      midland({ id: "f0000000-0000-4000-8000-000000000002", name: "Midland Credit Management (company desk)", org_id: ORG_ID, address_line1: "PO Box 999" }),
      midland({ id: "f0000000-0000-4000-8000-000000000003", org_id: OTHER_ORG_ID, address_line1: "PO Box 111" }),
      midland({ id: "f0000000-0000-4000-8000-000000000004", active: false, address_line1: "PO Box 222" }),
    ] });
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const furnisher = file.tables.dispute_letters.find((l) => l.target === "furnisher");
    assert.ok(furnisher, "a validation letter to the collector was saved");
    assert.deepEqual([furnisher.round, furnisher.status, furnisher.bureau, furnisher.org_id, furnisher.client_id], ["FURNISHER", "generated", "EX", ORG_ID, CLIENT]);
    assert.equal(furnisher.furnisher_address_id, "f0000000-0000-4000-8000-000000000002", "this company's own address for that furnisher is used first");
    assert.match(furnisher.body_text, /PO Box 999/);
    assert.doesNotMatch(furnisher.body_text, /PO Box (301030|111|222)/);
    const furnisherCase = file.tables.dispute_cases.find((c) => c.round === "FURNISHER");
    assert.ok(furnisherCase && furnisher.case_id === furnisherCase.id);
    assert.ok(file.tables.dispute_items.some((i) => i.case_id === furnisherCase.id && i.rule_id === "DEROG-COLLECTION"));
    assert.deepEqual(res.body.letters.map((l) => l.target).sort(), ["bureau", "furnisher"]);
    assert.equal(file.stored.some((x) => x.filename === "EX_R1_furnisher.html"), true);
    assert.deepEqual(res.body.warnings, []);

    const none = repairFile({ furnishers: [] });
    const gap = await call({ client_id: CLIENT }, none);
    assert.equal(gap.res.statusCode, 200);
    assert.equal(none.tables.dispute_letters.filter((l) => l.target === "furnisher").length, 0);
    assert.deepEqual(gap.res.body.warnings, [{ key: "no_furnisher_address", creditor: "MIDLAND CREDIT MANAGEMENT" }]);
    assert.ok(gap.res.body.skipped.some((x) => x.target === "furnisher" && x.reason === "no_furnisher_address"));
    assert.equal(none.tables.dispute_letters.filter((l) => l.target === "bureau").length, 1, "the bureau letter is not lost for it");
  });

  test("a client is on the repair path by a signed agreement, an active program or a repair tier; a dispute consent alone on a funding file is not", async () => {
    // Authorised by a staff dispute consent only. What decides the letters is the path, not the signature.
    const viaTier = repairFile({ agreement: false, consent: true, tier: "REPAIR_ONLY" });
    const a = await call({ client_id: CLIENT }, viaTier);
    assert.equal(a.res.body.ok, true, JSON.stringify(a.res.body));
    assert.ok(viaTier.tables.dispute_letters.length >= 1, "repair tier");
    const viaProgram = repairFile({ agreement: false, consent: true, tier: "FULL_FUNDING", program: { program: "repair", rounds_cap: 6, status: "active" } });
    const b = await call({ client_id: CLIENT }, viaProgram);
    assert.equal(b.res.body.ok, true, JSON.stringify(b.res.body));
    assert.ok(viaProgram.tables.dispute_letters.length >= 1, "active program");
    const ended = repairFile({ agreement: false, consent: true, tier: "FULL_FUNDING", program: { program: "repair", rounds_cap: 6, status: "cancelled" } });
    const c = await call({ client_id: CLIENT }, ended);
    assert.equal(c.res.body.ok, false);
    assert.equal(c.res.body.reason, "no_violations", "a cancelled program does not put a client on the path");
    assert.equal(ended.tables.dispute_letters.length, 0);
    const signed = repairFile({ agreement: true, tier: "FULL_FUNDING" });
    const d = await call({ client_id: CLIENT }, signed);
    assert.equal(d.res.body.ok, true, "a signed repair agreement counts first, whatever the tier says");
  });

  test("with no round named, the next round is the one after the highest the client has been through; a cancelled case does not count", async () => {
    const several = repairFile({ cases: [{ round: "R1" }, { round: "R3" }, { round: "R2" }] });
    const a = await call({ client_id: CLIENT }, several);
    assert.equal(a.res.statusCode, 200, JSON.stringify(a.res.body));
    assert.equal(a.res.body.round, "R4");
    const withCancelled = repairFile({ cases: [{ round: "R1" }, { round: "R5", status: "cancelled" }] });
    const b = await call({ client_id: CLIENT }, withCancelled);
    assert.equal(b.res.body.round, "R2", "the cancelled round-5 case is not a round the client went through");
    const none = repairFile({ cases: [] });
    const c = await call({ client_id: CLIENT }, none);
    assert.equal(c.res.body.round, "R1");
    const named = await call({ client_id: CLIENT, round: "R1" }, repairFile({ cases: [{ round: "R3" }] }));
    assert.equal(named.res.body.round, "R1", "a round named in the request wins");
  });

  test("with an approved email template on file, staging letters still queues no message to the client", async () => {
    const file = repairFile({ template: true });
    asked.length = 0;
    const { res } = await call({ client_id: CLIENT }, file);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(asked, []);
    for (const c of file.fake.calls) assert.doesNotMatch(c.sql, /INSERT INTO messages|INSERT INTO outbound|FROM message_templates/i, c.sql.slice(0, 60));
  });
});
