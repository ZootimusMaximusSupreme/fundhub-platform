// finish-853 batch 08: POST /api/inquiry-cases action=send. The real handler, the real document
// gate, the real send, the real letter attempt log and the real PostGrid request builder run over
// stand-in case, inquiry, document and identity tables, with a recording stand-in for the one web
// call to the mail provider (a fake key, built at run time). Rows covered: send {mail, portal} gated on
// the document packet; mail prints and mails the bureau letter with the client's return address and the
// chosen service level; portal records an Experian portal upload; the gate names the missing papers.
// Practice test, fake data, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/inquiry-cases.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { tablesDb, runUpdate } from "../testing/fin-b08-tables.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CASE = "ca000000-0000-4000-8000-000000000001";
const FOREIGN_CASE = "ca000000-0000-4000-8000-000000000009";
const INQ = "b1000000-0000-4000-8000-000000000001";
const KEYS = ["POSTGRID_API_KEY", "POSTGRID_API_BASE", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY"];
const saved = {};
const realFetch = globalThis.fetch;
const letters = [];
let mailAnswer = null;
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.POSTGRID_API_KEY = ["postgrid", "test", "key"].join("-");
  process.env.POSTGRID_API_BASE = "https://postgrid.example.test/v1";
  process.env.MESSAGING_DRY_RUN = "0";
  process.env.ADAPTERS_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  globalThis.fetch = async (url, init) => {
    letters.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const out = mailAnswer || { status: 200, body: { id: "letter_123", status: "ready" } };
    return { ok: out.status < 300, status: out.status, headers: { get: () => null, forEach() {} }, text: async () => JSON.stringify(out.body), json: async () => out.body };
  };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { letters.length = 0; mailAnswer = null; });

function caseFile({ packet = true, bureau = "EX", status = "Queued", signed = packet } = {}) {
  const docs = packet ? [
    { id: "d1", org_id: ORG_ID, client_id: CLIENT, kind: "client_upload", subtype: "id_document", title: "ID", generated_at: "2026-10-01T00:00:00Z", expires_at: null },
    { id: "d2", org_id: ORG_ID, client_id: CLIENT, kind: "client_upload", subtype: "proof_of_address", title: "Bill", generated_at: "2026-10-01T00:00:00Z", expires_at: null },
  ] : [];
  const tables = {
    clients: [{ id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield" }],
    inquiry_removal_cases: [
      { id: CASE, org_id: ORG_ID, client_id: CLIENT, case_id: "IR-1", selected_bureaus_raw: bureau, case_status: status, first_delivery_at: null, letter_provider_id: null, portal_confirmation: null, letter_draft_html: "<p>Please remove these inquiries from my file.</p>" },
      { id: FOREIGN_CASE, org_id: OTHER_ORG_ID, client_id: "c9000000-0000-4000-8000-000000000009", case_id: "IR-9", selected_bureaus_raw: "EX", case_status: "Queued", first_delivery_at: null, letter_provider_id: null },
    ],
    inquiry_log: [{ id: INQ, org_id: ORG_ID, client_id: CLIENT, bureau, inquiry: "CHASE BANK", status: "open", is_open: true, inquiry_removal_case_id: null, call_attempts: 0, outcome: null, worked_by: null }],
    inquiry_attempts: [],
    inquiry_prep: [],
    documents: docs,
    document_versions: [],
    pii_identity: [{ org_id: ORG_ID, client_id: CLIENT, addresses: [{ address_line1: "412 Pecan St", city: "Austin", state: "TX", zip: "78701" }] }],
    ai_bureau_config: [],
    staff_events: [],
    events: [],
    cards: [],
  };
  const fake = tablesDb({
    tables,
    autoInsert: true,
    autoUpdate: true,
    defaults: { inquiry_attempts: {} },
    rules: [
      [/FROM client_consents/i, (_s, p) => (signed ? [{ client_id: CLIENT }] : [])],
      [/^\s*SELECT id, org_id FROM inquiry_log WHERE id = \$1 AND org_id = \$2 FOR UPDATE/i, (s, p) => rowsWhere(tables.inquiry_log, s, p).map((r) => ({ id: r.id, org_id: r.org_id }))],
      [/^\s*UPDATE inquiry_log\s+SET call_attempts = \(/i, (s, p) => {
        // The statement's own set list is applied; only its sub-select (the attempt count) is answered here.
        const { hit } = runUpdate(tables.inquiry_log, s, p, { resolvers: {
          call_attempts: (expr, _row, params) => {
            const m = /^SELECT count\(\*\) FROM inquiry_attempts WHERE inquiry_id = \$1 AND kind IN \(([^)]*)\)$/i.exec(expr.replace(/\s+/g, " "));
            if (!m) throw new Error(`the send stand-in cannot read the count: ${expr}`);
            const kinds = m[1].split(",").map((k) => k.trim().replace(/^'|'$/g, ""));
            return tables.inquiry_attempts.filter((a) => a.inquiry_id === params[0] && kinds.includes(a.kind)).length;
          },
        } });
        return hit.map((r) => ({ ...r }));
      }],
      [/^\s*INSERT INTO staff_events/i, (_s, p) => { const row = { id: `se${tables.staff_events.length + 1}`, staff_id: p[0], shift_id: p[2], kind: p[3], detail: JSON.parse(p[4]) }; tables.staff_events.push(row); return [row]; }],
      [/^\s*UPDATE inquiry_log\s+SET inquiry_removal_case_id = \$2\s+WHERE id = ANY\(\$1::uuid\[\]\)/i, (_s, p) => {
        for (const r of tables.inquiry_log) if (p[0].includes(r.id) && !r.inquiry_removal_case_id) r.inquiry_removal_case_id = p[1];
        return { rows: [], rowCount: 1 };
      }],
      [/^\s*SELECT id FROM inquiry_log\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid\s+AND bureau = \$3\s+AND is_open = true/i,
        (_s, p) => tables.inquiry_log.filter((r) => r.org_id === p[0] && r.client_id === p[1] && r.bureau === p[2] && r.is_open).map((r) => ({ id: r.id }))],
      [/^\s*SELECT ps\.id AS stage_id, ps\.pipeline_id FROM pipeline_stages ps/i, []],
      [/^\s*SELECT \* FROM inquiry_removal_cases WHERE id = \$1::uuid AND org_id = \$2::uuid/i, (_s, p) => tables.inquiry_removal_cases.filter((c) => c.id === p[0] && c.org_id === p[1])],
      [/^\s*SELECT \* FROM inquiry_removal_cases\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/i, (_s, p) => tables.inquiry_removal_cases.filter((c) => c.id === p[0] && c.org_id === p[1])],
      [/^\s*SELECT \* FROM inquiry_removal_cases WHERE id = \$1$/i, (_s, p) => tables.inquiry_removal_cases.filter((c) => c.id === p[0])],
      [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
    ],
  });
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.tables = tables;
  return fake;
}

async function call(body, fake, who = [staffSession({ role: "inquiry_specialist" })], method = "POST") {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req(method, { body }), res, { db: combined, store: { get: async () => null, put: async () => ({ key: "k" }) } }));
  return res;
}

describe("POST /api/inquiry-cases action=send", () => {
  test("only a POST that names a real action is served: a GET or an unknown action sends and saves nothing", async () => {
    const fake = caseFile();
    const get = await call({ action: "send", id: CASE, mail: true }, fake, undefined, "GET");
    assert.equal(get.statusCode, 405);
    assert.equal(get.headers.allow, "POST");
    const shred = await call({ action: "shred", id: CASE, mail: true }, fake);
    assert.equal(shred.statusCode, 400);
    assert.equal(shred.body.error, "unknown_action");
    assert.ok(shred.body.allowed === undefined || Array.isArray(shred.body.allowed) || typeof shred.body.message === "string");
    assert.equal(letters.length, 0, "no letter was sent");
    assert.equal(fake.calls.filter((c) => /inquiry_removal_cases|dispute_letters|documents/.test(c.sql)).length, 0, "no case table was touched");
  });

  test("mail:true mails the bureau letter once, from the client's own address, with the chosen service level, and records the letter on the case", async () => {
    const fake = caseFile();
    const res = await call({ action: "send", id: CASE, mail: true, mail_service_level: "priority" }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(letters.length, 1, "exactly one letter is sent");
    const sent = letters[0];
    assert.match(sent.url, /\/letters$/);
    assert.equal(sent.body.mailingClass, "usps_express_3_day", "the service level asked for: priority");
    assert.equal(sent.body.from.addressLine1, "412 Pecan St", "the return address is the client's, never Fundhub's");
    assert.equal(sent.body.from.firstName, "Dana");
    assert.ok(sent.body.to.addressLine1, "to a bureau mailing address");
    assert.match(sent.body.html || "", /Please remove these inquiries/);
    assert.equal(sent.body.metadata.caseId, CASE);
    assert.equal(sent.body.metadata.orgId, ORG_ID);
    const c = fake.tables.inquiry_removal_cases[0];
    assert.equal(c.letter_provider_id, "letter_123");
    assert.equal(c.case_status, "In Progress");
    const attempt = fake.tables.inquiry_attempts[0];
    assert.deepEqual([attempt.kind, attempt.inquiry_id, attempt.staff_id, attempt.outcome], ["letter", INQ, STAFF_ID, "sent"]);
    assert.equal(fake.tables.inquiry_log[0].inquiry_removal_case_id, CASE, "the inquiry is tied to the case");
    assert.equal(fake.tables.inquiry_log[0].call_attempts, 1);
    assert.equal(fake.tables.staff_events[0].kind, "letter_issued");
  });

  test("with no service level named the bureau's own default is used, and a different level changes the mailing class", async () => {
    const plain = caseFile();
    await call({ action: "send", id: CASE, mail: true }, plain);
    assert.equal(letters.length, 1);
    assert.equal(letters[0].body.mailingClass, "usps_first_class");
    letters.length = 0;
    const configured = caseFile();
    configured.tables.ai_bureau_config.push({ org_id: ORG_ID, bureau_code: "EX", mail_service_level: "priority" });
    await call({ action: "send", id: CASE, mail: true }, configured);
    assert.equal(letters[0].body.mailingClass, "usps_express_3_day", "the company's own setting for that bureau");
  });

  test("the document gate refuses a short packet with 409 and the papers it is missing; nothing is mailed and the case is marked blocked", async () => {
    const fake = caseFile({ packet: false });
    const res = await call({ action: "send", id: CASE, mail: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "docs_blocked");
    assert.deepEqual(res.body.missing.sort(), ["authorization", "id_document", "proof_of_address"]);
    assert.match(res.body.message, /government photo identification/);
    assert.equal(letters.length, 0);
    assert.equal(fake.tables.inquiry_attempts.length, 0);
    assert.equal(fake.tables.inquiry_removal_cases[0].case_status, "Blocked");
  });

  test("portal:true records an Experian portal upload with its reference and schedules the follow-up call; it needs the reference and an Experian case", async () => {
    const fake = caseFile();
    const noRef = await call({ action: "send", id: CASE, portal: true }, fake);
    assert.equal(noRef.statusCode, 400);
    assert.equal(noRef.body.error, "portal_confirmation_required");
    assert.equal(fake.tables.inquiry_attempts.length, 0);
    const ok = await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EX-998877" }, fake);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(letters.length, 0, "a portal upload mails nothing");
    const c = fake.tables.inquiry_removal_cases[0];
    assert.equal(c.portal_confirmation, "EX-998877");
    assert.equal(c.first_delivery_channel, "portal");
    assert.ok(c.call_due_at, "the follow-up call is scheduled from the upload");
    assert.deepEqual([fake.tables.inquiry_attempts[0].kind, fake.tables.inquiry_attempts[0].outcome, fake.tables.inquiry_attempts[0].note], ["portal", "uploaded", "experian_ref:EX-998877"]);
    const other = caseFile({ bureau: "EQ" });
    const notEx = await call({ action: "send", id: CASE, portal: true, portal_confirmation: "X" }, other);
    assert.equal(notEx.statusCode, 400);
    assert.equal(notEx.body.error, "portal_ex_only");
  });

  test("with neither mail nor portal there is nothing to send; a case of another company is 404", async () => {
    const fake = caseFile();
    const none = await call({ action: "send", id: CASE }, fake);
    assert.equal(none.statusCode, 400);
    assert.equal(none.body.error, "no_channel");
    const foreign = await call({ action: "send", id: FOREIGN_CASE, mail: true }, fake);
    assert.equal(foreign.statusCode, 404);
    assert.equal(letters.length, 0);
  });

  test("a client with no address on file is never mailed from Fundhub's address: nothing is sent and the attempt says why", async () => {
    const fake = caseFile();
    fake.tables.pii_identity[0].addresses = [];
    const res = await call({ action: "send", id: CASE, mail: true }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(letters.length, 0);
    assert.match(fake.tables.inquiry_attempts[0].outcome, /^mail_failed:return_address_required/);
    assert.equal(fake.tables.inquiry_removal_cases[0].letter_provider_id, null);
  });

  test("when the mail provider refuses, the failure is recorded as the letter's outcome and no provider id is saved", async () => {
    mailAnswer = { status: 500, body: { error: { message: "printer down" } } };
    const fake = caseFile();
    const res = await call({ action: "send", id: CASE, mail: true }, fake);
    assert.equal(res.statusCode, 200);
    assert.match(fake.tables.inquiry_attempts[0].outcome, /^mail_failed:/);
    assert.equal(fake.tables.inquiry_removal_cases[0].letter_provider_id, null);
  });

  test("with the outbound fence up nothing is mailed and the attempt says so", async () => {
    const held = process.env.MESSAGING_DRY_RUN;
    process.env.MESSAGING_DRY_RUN = "1";
    try {
      const fake = caseFile();
      const res = await call({ action: "send", id: CASE, mail: true }, fake);
      assert.equal(res.statusCode, 200);
      assert.equal(letters.length, 0);
      assert.match(fake.tables.inquiry_attempts[0].outcome, /^mail_failed:/);
      assert.equal(fake.tables.inquiry_removal_cases[0].letter_provider_id, null);
    } finally { process.env.MESSAGING_DRY_RUN = held; }
  });

  test("a staff role in the staff set may send; a white-label partner staff row, a client login and no login are refused", async () => {
    for (const role of STAFF_ROLES) {
      const res = await call({ action: "send", id: CASE }, caseFile(), [staffSession({ role })]);
      assert.notEqual(res.statusCode, 403, role);
      assert.notEqual(res.statusCode, 401, role);
    }
    const partner = await call({ action: "send", id: CASE, mail: true }, caseFile(), [staffSession({ role: "partner" })]);
    assert.equal(partner.statusCode, 403);
    const client = await call({ action: "send", id: CASE, mail: true }, caseFile(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.statusCode, 401);
    const none = await call({ action: "send", id: CASE, mail: true }, caseFile(), []);
    assert.equal(none.statusCode, 401);
    assert.equal(letters.length, 0);
  });

  test("the letter is addressed to the bureau the case is about: each bureau's own mailing box, and a company's own configured box wins", async () => {
    // Written out here, not read from the product: the three bureaus' dispute mailing boxes.
    const boxes = {
      EX: { addressLine1: "P.O. Box 4500", city: "Allen", provinceOrState: "TX", postalOrZip: "75013" },
      EQ: { addressLine1: "P.O. Box 740256", city: "Atlanta", provinceOrState: "GA", postalOrZip: "30374-0256" },
      TU: { addressLine1: "P.O. Box 2000", city: "Chester", provinceOrState: "PA", postalOrZip: "19016" },
    };
    for (const [code, box] of Object.entries(boxes)) {
      letters.length = 0;
      const fake = caseFile({ bureau: code });
      const res = await call({ action: "send", id: CASE, mail: true }, fake);
      assert.equal(res.statusCode, 200, `${code}: ${JSON.stringify(res.body)}`);
      assert.equal(letters.length, 1, code);
      const to = letters[0].body.to;
      assert.deepEqual({ addressLine1: to.addressLine1, city: to.city, provinceOrState: to.provinceOrState, postalOrZip: to.postalOrZip }, box, `${code}: this bureau's box`);
    }
    letters.length = 0;
    const configured = caseFile({ bureau: "TU" });
    configured.tables.ai_bureau_config.push({
      org_id: ORG_ID, bureau_code: "TU", bureau_name: "TransUnion", mail_company_name: "TransUnion Special Desk", mail_address_line1: "P.O. Box 1111",
      mail_address_line2: null, mail_address_city: "Reno", mail_address_state: "NV", mail_address_zip: "89501", mail_address_country: "US",
    });
    await call({ action: "send", id: CASE, mail: true }, configured);
    assert.equal(letters[0].body.to.addressLine1, "P.O. Box 1111", "the company's own box for that bureau");
    assert.equal(letters[0].body.to.city, "Reno");
    // A box configured for another company or another bureau is not used.
    letters.length = 0;
    const other = caseFile({ bureau: "EX" });
    other.tables.ai_bureau_config.push(
      { org_id: OTHER_ORG_ID, bureau_code: "EX", mail_address_line1: "P.O. Box 9999", mail_address_city: "Elsewhere", mail_address_state: "ZZ", mail_address_zip: "00000" },
      { org_id: ORG_ID, bureau_code: "EQ", mail_address_line1: "P.O. Box 8888", mail_address_city: "Wrong", mail_address_state: "ZZ", mail_address_zip: "00000" },
    );
    await call({ action: "send", id: CASE, mail: true }, other);
    assert.equal(letters[0].body.to.addressLine1, "P.O. Box 4500");
  });

  test("a case with several open inquiries gets a letter attempt on every one of them, tied to the case, and only that client's and that bureau's", async () => {
    const fake = caseFile();
    const more = (id, over) => ({ id, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: id, status: "open", is_open: true, inquiry_removal_case_id: null, call_attempts: 0, outcome: null, worked_by: null, ...over });
    fake.tables.inquiry_log.push(
      more("b2000000-0000-4000-8000-000000000002", {}),
      more("b3000000-0000-4000-8000-000000000003", {}),
      more("b4000000-0000-4000-8000-000000000004", { is_open: false }),                                  // already removed
      more("b5000000-0000-4000-8000-000000000005", { bureau: "TU" }),                                    // another bureau
      more("b6000000-0000-4000-8000-000000000006", { client_id: "c8000000-0000-4000-8000-000000000008" }), // another client
      more("b7000000-0000-4000-8000-000000000007", { org_id: OTHER_ORG_ID }),                             // another company
    );
    const res = await call({ action: "send", id: CASE, mail: true }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const mine = ["b1000000-0000-4000-8000-000000000001", "b2000000-0000-4000-8000-000000000002", "b3000000-0000-4000-8000-000000000003"];
    assert.deepEqual(fake.tables.inquiry_attempts.map((a) => a.inquiry_id).sort(), mine.slice().sort(), "one letter attempt per open inquiry of this bureau");
    for (const id of mine) {
      const row = fake.tables.inquiry_log.find((r) => r.id === id);
      assert.equal(row.call_attempts, 1, id);
      assert.equal(row.inquiry_removal_case_id, CASE, `${id} is tied to the case`);
    }
    for (const id of ["b4000000-0000-4000-8000-000000000004", "b5000000-0000-4000-8000-000000000005", "b6000000-0000-4000-8000-000000000006", "b7000000-0000-4000-8000-000000000007"]) {
      const row = fake.tables.inquiry_log.find((r) => r.id === id);
      assert.equal(row.call_attempts, 0, `${id} is not part of this letter`);
      assert.equal(row.inquiry_removal_case_id ?? null, null);
    }
    assert.equal(res.body.attempts.length, 3);
    assert.equal(letters.length, 1, "one letter, however many inquiries it names");
    assert.equal(fake.tables.staff_events.filter((e) => e.kind === "letter_issued").length, 3);
  });

  test("a portal upload starts the follow-up clock from when the file went up, counted in business days", async () => {
    // Friday 16 October 2026, 3 p.m. UTC: the default portal wait is one business day, so the call is due Monday.
    const fake = caseFile();
    const res = await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EX-5", portal_uploaded_at: "2026-10-16T15:00:00Z" }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const c = fake.tables.inquiry_removal_cases[0];
    assert.equal(new Date(c.first_delivery_at).toISOString(), "2026-10-16T15:00:00.000Z", "the upload time, not the clock and not 1970");
    assert.equal(new Date(c.call_due_at).toISOString(), "2026-10-19T15:00:00.000Z", "one business day later, same hour");
    assert.equal(c.first_delivery_channel, "portal");

    // The company's own wait for that bureau is used: three business days from Monday 19 October is Thursday 22 October.
    const configured = caseFile();
    configured.tables.ai_bureau_config.push({ org_id: ORG_ID, bureau_code: "EX", portal_wait_business_days: 3, mail_wait_business_days: 5 });
    await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EX-6", portal_uploaded_at: "2026-10-19T15:00:00Z" }, configured);
    assert.equal(new Date(configured.tables.inquiry_removal_cases[0].call_due_at).toISOString(), "2026-10-22T15:00:00.000Z");
    // Columbus Day (Monday 12 October 2026) is a federal holiday: Friday 9 October + 1 business day skips the weekend and the holiday.
    const holiday = caseFile();
    await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EX-7", portal_uploaded_at: "2026-10-09T15:00:00Z" }, holiday);
    assert.equal(new Date(holiday.tables.inquiry_removal_cases[0].call_due_at).toISOString().slice(0, 10), "2026-10-13");
  });

  test("a portal upload is recorded on every open inquiry of the case, not just the first", async () => {
    const fake = caseFile();
    const more = (id) => ({ id, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: id, status: "open", is_open: true, inquiry_removal_case_id: null, call_attempts: 0, outcome: null, worked_by: null });
    fake.tables.inquiry_log.push(more("b2000000-0000-4000-8000-000000000002"), more("b3000000-0000-4000-8000-000000000003"));
    const res = await call({ action: "send", id: CASE, portal: true, portal_confirmation: "EX-12345" }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(fake.tables.inquiry_attempts.length, 3);
    assert.ok(fake.tables.inquiry_attempts.every((a) => a.kind === "portal" && a.outcome === "uploaded" && a.note === "experian_ref:EX-12345"));
    assert.deepEqual(fake.tables.inquiry_log.map((r) => r.call_attempts), [1, 1, 1]);
    assert.equal(res.body.attempts.length, 3);
  });
});
