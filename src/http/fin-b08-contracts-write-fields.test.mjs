// finish-853 batch 08, repair cycle 1: POST /api/contracts, what each saved row and each link SAYS.
// The first file judged that a draft, a send, a template write and a void happen. This one reads the saved
// rows back against the template and the caller, and the links against the signers:
//   - a draft keeps the template's signature rule, kind, subtype and boxes, the signing order asked for and
//     the staff member it is about;
//   - a new contact keeps its phone, is flagged demo only by its address, and is filed under the caller's
//     company even when the body names another;
//   - a send keeps the signature rule, mints one link per signer that names that signer and lives 30 days,
//     stamps the document as sent through the portal, and queues the email to the signer whose turn it is;
//   - every template write (save, archive, upload, boxes) is owner only;
//   - a voided contract can no longer be signed, and another company cannot void it.
// Practice test, fake data, no network, no database; outbound fences held up and the network refused.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

import handler from "../../api/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { contractsDb, baseBook, IDS } from "../testing/fin-b08-contracts-db.mjs";
import { verifyContractUrl } from "../contracts/signed-link.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const KEYS = ["CONTRACT_URL_SECRET", "DOCUMENT_URL_SECRET", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY", "DOCUMENT_STORE_PROVIDER", "PUBLIC_BASE_URL"];
const saved = {};
const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CONTRACT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.DOCUMENT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.DOCUMENT_STORE_PROVIDER;
  delete process.env.PUBLIC_BASE_URL;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { asked.length = 0; });

const FUNDING_TEMPLATE = "e3000000-0000-4000-8000-000000000003";
const PDF_TEMPLATE = "e4000000-0000-4000-8000-000000000004";
const PDF_BOXES = [
  { id: "sig0", page: 0, type: "signature", signer: 0, source: "manual", x: 0.1, y: 0.8, w: 0.3, h: 0.05, label: "Sign here", required: true, value: "" },
  { id: "amount", page: 1, type: "text", signer: 0, source: "manual", x: 0.1, y: 0.3, w: 0.3, h: 0.05, label: "Amount", required: true, value: "" },
];
const TWO = [
  { role_label: "Client", name: "Dana Whitfield", email: "dana@example.test", client_id: IDS.client },
  { role_label: "Counterparty", name: "Pat Counter", email: "pat@example.test", client_id: null },
];

function newFile() {
  const b = baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID });
  const plain = { manual_fields: [], signature_statement: "I agree.", active: true, document_id: null, document_version_id: null, original_filename: null, page_count: null, page_sizes: [], fields: [], signer_roles: [], created_by: STAFF_ID };
  b.templates.push(
    { ...plain, id: FUNDING_TEMPLATE, org_id: ORG_ID, template_key: "FUNDING", name: "Funding Agreement", kind: "authorization", subtype: "funding", body: "Terms for {{contact.first_name}}.", signature_required: false, source_kind: "text" },
    { ...plain, id: PDF_TEMPLATE, org_id: ORG_ID, template_key: "PAPER", name: "Paper Agreement", kind: "contract", subtype: "paper", body: "", signature_required: true, source_kind: "pdf", page_count: 2, page_sizes: [{ w: 612, h: 792 }, { w: 612, h: 792 }], fields: PDF_BOXES, signer_roles: [{ label: "Client" }] },
  );
  const fake = contractsDb(b);
  // The approved email copy a send queues for the signer.
  fake.tables.message_templates.push({
    org_id: ORG_ID, template_key: "CONTRACT-SEND-EMAIL", channel: "email", subject: "Please sign {{contract.title}}",
    body: "Hi {{contact.first_name}}, sign here: {{contract.link}}", compliance_passed: true,
  });
  return fake;
}

async function call(body, fake, who = [staffSession({ role: "closer" })], headers = { host: "app.example.test" }) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body, headers }), res));
  return res;
}
const owner = [staffSession({ role: "owner" })];
const queryOf = (url) => Object.fromEntries(new URL(url).searchParams.entries());
const pdfBase64 = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save()).toString("base64");
};
const DAY = 24 * 3600;
const near = (actualSeconds, expectedSeconds, slack = 300) => Math.abs(actualSeconds - expectedSeconds) <= slack;

describe("POST /api/contracts: what a draft keeps", () => {
  test("it keeps the template's signature rule, kind, subtype and boxes, the order asked for and the staff member it is about", async () => {
    const fake = newFile();
    const plain = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" }, signing_order: "parallel", staff_id: STAFF_ID }, fake);
    assert.equal(plain.statusCode, 200, JSON.stringify(plain.body));
    const a = fake.tables.contracts[0];
    assert.equal(a.signature_required, true, "the template says a signature is required");
    assert.equal(a.signing_order, "parallel");
    assert.equal(a.staff_id, STAFF_ID, "the staff member the contract is about");
    assert.equal(a.created_by, STAFF_ID, "the person who made it");
    assert.deepEqual([a.kind, a.subtype, a.source_kind], ["contract", null, "text"]);

    const defaults = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "x" }, signing_order: "any old order" }, fake);
    assert.equal(defaults.statusCode, 200);
    const b = fake.tables.contracts[1];
    assert.equal(b.signing_order, "sequential", "anything but parallel is sequential");
    assert.equal(b.staff_id ?? null, null, "no staff member named, none saved");

    const funding = await call({ action: "create_draft", client_id: IDS.client, template_id: FUNDING_TEMPLATE, values: {} }, fake);
    assert.equal(funding.statusCode, 200, JSON.stringify(funding.body));
    const c = fake.tables.contracts[2];
    assert.equal(c.signature_required, false, "this template does not ask for a signature");
    assert.deepEqual([c.kind, c.subtype, c.template_key], ["authorization", "funding", "FUNDING"]);

    const paper = await call({ action: "create_draft", client_id: IDS.client, template_id: PDF_TEMPLATE, values: {} }, fake);
    assert.equal(paper.statusCode, 200, JSON.stringify(paper.body));
    const d = fake.tables.contracts[3];
    assert.equal(d.source_kind, "pdf");
    assert.deepEqual(d.fields, PDF_BOXES, "the template's boxes are copied onto the draft");
    assert.notEqual(d.fields, fake.tables.contract_templates.find((t) => t.id === PDF_TEMPLATE).fields, "a copy, not the template's own list");
  });

  test("a roster of two keeps its order, labels, names and emails, and the contract it hangs off", async () => {
    const fake = newFile();
    const res = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Two sign" }, signers: TWO }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const rows = fake.tables.contract_signers;
    assert.deepEqual(rows.map((r) => [r.signer_index, r.role_label, r.name, r.email, r.contract_id, r.org_id]), [
      [0, "Client", "Dana Whitfield", "dana@example.test", fake.tables.contracts[0].id, ORG_ID],
      [1, "Counterparty", "Pat Counter", "pat@example.test", fake.tables.contracts[0].id, ORG_ID],
    ]);
    assert.equal(rows[0].client_id, IDS.client);
    assert.equal(rows[1].client_id, null);
  });
});

describe("POST /api/contracts: a new contact", () => {
  test("it keeps the phone, is flagged demo only by its address, and is filed under the caller's company whatever the body says", async () => {
    const fake = newFile();
    const real = await call({
      action: "create_client", first_name: "Sam", last_name: "New", email: "sam@example.test", phone: " 6025550111 ",
      org_id: OTHER_ORG_ID, is_demo: true,
    }, fake);
    assert.equal(real.statusCode, 200);
    const sam = fake.tables.clients.find((c) => c.email === "sam@example.test");
    assert.ok(sam);
    assert.equal(sam.phone, "6025550111");
    assert.equal(sam.org_id, ORG_ID, "the company comes off the sign-in");
    assert.equal(sam.is_demo, false, "a request cannot ask for demo");
    assert.equal(real.body.client.phone, "6025550111");

    const tester = await call({ action: "create_client", first_name: "Tess", email: "tess+fhtest@example.test" }, fake);
    assert.equal(tester.statusCode, 200);
    const tess = fake.tables.clients.find((c) => c.first_name === "Tess");
    assert.equal(tess.is_demo, true, "a test address is born flagged");
    assert.equal(tess.phone, null);
  });
});

describe("POST /api/contracts: what a send keeps and mints", () => {
  test("it keeps the template's signature rule on the frozen row and stamps the document as sent through the portal", async () => {
    const fake = newFile();
    const a = (await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" } }, fake)).body.contract;
    const sentA = await call({ action: "send", id: a.id }, fake);
    assert.equal(sentA.statusCode, 200, JSON.stringify(sentA.body));
    const row = fake.tables.contracts.find((c) => c.id === a.id);
    assert.equal(row.signature_required, true);
    assert.equal(row.status, "sent");
    const doc = fake.tables.documents.find((d) => d.id === row.document_id);
    assert.equal(doc.delivery_status, "sent", "the document is marked sent");
    assert.equal(doc.delivery_channel, "portal", "through the portal: nothing is posted anywhere");
    const version = fake.tables.document_versions.find((v) => v.id === row.document_version_id);
    assert.equal(version.delivery_status, "sent");
    assert.equal(version.delivery_channel, "portal");

    const f = (await call({ action: "create_draft", client_id: IDS.client, template_id: FUNDING_TEMPLATE, values: {} }, fake)).body.contract;
    const sentF = await call({ action: "send", id: f.id }, fake);
    assert.equal(sentF.statusCode, 200, JSON.stringify(sentF.body));
    assert.equal(fake.tables.contracts.find((c) => c.id === f.id).signature_required, false, "no signature asked for stays that way");
    assert.deepEqual(asked, []);
  });

  test("every signer's link names that signer and lives 30 days; the contract-wide link and every stored expiry say the same", async () => {
    const fake = newFile();
    const made = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Two sign" }, signers: TWO }, fake);
    const id = made.body.contract.id;
    const sent = await call({ action: "send", id }, fake);
    assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.links.length, 2);
    const now = Math.floor(Date.now() / 1000);
    const signers = fake.tables.contract_signers;
    sent.body.links.forEach((l, i) => {
      const q = queryOf(l.url);
      assert.equal(l.signer_id, signers[i].id);
      assert.equal(q.id, id);
      assert.equal(q.s, signers[i].id, "the link names this signer");
      assert.ok(near(Number(q.exp) - now, 30 * DAY), `signer ${i}: the link runs 30 days`);
      assert.equal(verifyContractUrl({ contractId: id, signerId: signers[i].id, expiresAt: q.exp, sig: q.sig }).valid, true);
      // Another person's id on this person's link is refused.
      const other = signers[1 - i].id;
      assert.equal(verifyContractUrl({ contractId: id, signerId: other, expiresAt: q.exp, sig: q.sig }).valid, false);
      assert.equal(verifyContractUrl({ contractId: id, signerId: null, expiresAt: q.exp, sig: q.sig }).valid, false, "and it is not the contract-wide link");
      assert.ok(near(new Date(signers[i].link_expires_at).getTime() / 1000 - now, 30 * DAY), `signer ${i}: the stored expiry matches`);
      assert.equal(signers[i].status, "sent");
    });
    const wide = queryOf(sent.body.link.url);
    assert.equal(wide.s, undefined);
    assert.ok(near(Number(wide.exp) - now, 30 * DAY));
    assert.equal(verifyContractUrl({ contractId: id, signerId: null, expiresAt: wide.exp, sig: wide.sig }).valid, true);
    assert.ok(near(new Date(fake.tables.contracts[0].link_expires_at).getTime() / 1000 - now, 30 * DAY));
  });

  test("the email is queued for the signer whose turn it is, with their own link in it; a parallel contract queues everyone", async () => {
    const sequential = newFile();
    const made = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Two sign" }, signers: TWO }, sequential);
    const sent = await call({ action: "send", id: made.body.contract.id }, sequential);
    assert.equal(sent.statusCode, 200);
    const mail = sequential.tables.messages;
    assert.equal(mail.length, 1, "only the first signer is told while it is their turn");
    assert.equal(mail[0].to_address, "dana@example.test");
    assert.equal(mail[0].template_key, "CONTRACT-SEND-EMAIL");
    assert.equal(mail[0].client_id, IDS.client);
    assert.equal(mail[0].org_id, ORG_ID);
    assert.equal(mail[0].subject, "Please sign Setup Agreement");
    const first = sent.body.links[0];
    assert.ok(mail[0].rendered_body.includes(first.url), "the email carries that signer's own link");
    assert.equal(mail[0].rendered_body.includes(sent.body.links[1].url), false);
    assert.equal(mail[0].provider_ref, `contract:${made.body.contract.id}:${first.signer_id}:send`);

    const parallel = newFile();
    const m2 = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Two sign" }, signers: TWO, signing_order: "parallel" }, parallel);
    const s2 = await call({ action: "send", id: m2.body.contract.id }, parallel);
    assert.equal(s2.statusCode, 200);
    assert.deepEqual(parallel.tables.messages.map((m) => m.to_address).sort(), ["dana@example.test", "pat@example.test"]);
    for (const m of parallel.tables.messages) {
      const mine = s2.body.links.find((l) => l.email === m.to_address);
      assert.ok(m.rendered_body.includes(mine.url), `${m.to_address} gets their own link`);
    }
    const counterparty = parallel.tables.messages.find((m) => m.to_address === "pat@example.test");
    assert.equal(counterparty.client_id ?? null, null, "a counterparty is nobody's client");
  });
});

describe("POST /api/contracts: who may write the words", () => {
  test("save, archive, upload and the boxes are owner only: every other staff role is refused 403 and nothing changes", async () => {
    const file = await pdfBase64();
    const attempts = (fake) => ({
      save_template: { action: "save_template", id: IDS.template, name: "Renamed by someone", body: "Words someone else wrote." },
      archive_template: { action: "archive_template", id: IDS.template },
      upload_template: { action: "upload_template", template_key: "SNEAKY-UPLOAD", name: "Sneaky", filename: "x.pdf", file },
      save_fields: { action: "save_fields", id: PDF_TEMPLATE, fields: [{ ...PDF_BOXES[0], x: 0.5 }], signer_roles: [{ label: "Client" }] },
      create_template: { action: "create_template", template_key: "SNEAKY-NEW", name: "Sneaky new", body: "Words." },
      void: (() => { void fake; return { action: "void", id: IDS.template, reason: "no" }; })(),
    });
    const letIn = { save_template: [], archive_template: [], upload_template: [], save_fields: [], create_template: [] };
    for (const role of STAFF_ROLES) {
      const fake = newFile();
      const before = JSON.stringify([fake.tables.contract_templates, fake.tables.documents]);
      for (const [action, body] of Object.entries(attempts(fake))) {
        if (action === "void") continue;
        const res = await call(body, fake, [staffSession({ role })]);
        if (res.statusCode === 403) {
          assert.equal(res.body.error, "forbidden", `${role} ${action}`);
          assert.deepEqual(res.body.required, ["owner"]);
        } else {
          letIn[action].push(role);
          assert.equal(res.statusCode, 200, `${role} ${action}: ${JSON.stringify(res.body)}`);
        }
      }
      if (!letIn.save_template.includes(role)) {
        assert.equal(JSON.stringify([fake.tables.contract_templates, fake.tables.documents]), before, `${role}: nothing was written`);
      }
    }
    for (const [action, roles] of Object.entries(letIn)) assert.deepEqual(roles.sort(), ["owner"], action);
  });

  test("a new template asks for a signature unless it says otherwise", async () => {
    const fake = newFile();
    const asked1 = await call({ action: "create_template", template_key: "needs-sign", name: "Needs sign", body: "Words." }, fake, owner);
    assert.equal(asked1.statusCode, 200, JSON.stringify(asked1.body));
    assert.equal(fake.tables.contract_templates.find((t) => t.template_key === "NEEDS-SIGN").signature_required, true);
    const off = await call({ action: "create_template", template_key: "no-sign", name: "No sign", body: "Words.", signature_required: false }, fake, owner);
    assert.equal(off.statusCode, 200);
    assert.equal(fake.tables.contract_templates.find((t) => t.template_key === "NO-SIGN").signature_required, false);
    const edited = await call({ action: "save_template", id: IDS.template, signature_required: false }, fake, owner);
    assert.equal(edited.statusCode, 200);
    assert.equal(fake.tables.contract_templates.find((t) => t.id === IDS.template).signature_required, false);
  });
});

describe("POST /api/contracts: void", () => {
  test("another company's admin cannot void this company's contract: 404 and it stays sent", async () => {
    const fake = newFile();
    const c = (await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" } }, fake)).body.contract;
    await call({ action: "send", id: c.id }, fake);
    const foreign = await call({ action: "void", id: c.id, reason: "Not yours to void" }, fake, [staffSession({ role: "admin", org_id: OTHER_ORG_ID })]);
    assert.equal(foreign.statusCode, 404, JSON.stringify(foreign.body));
    const row = fake.tables.contracts[0];
    assert.equal(row.status, "sent");
    assert.equal(row.void_reason ?? null, null);
    assert.equal(row.voided_by ?? null, null);
    const own = await call({ action: "void", id: c.id, reason: "Wrong terms" }, fake, owner);
    assert.equal(own.statusCode, 200);
    assert.equal(fake.tables.contracts[0].status, "void");
  });

  test("once voided, the signer's own link cannot sign it and nothing is recorded as signed", async () => {
    const fake = newFile();
    const c = (await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" } }, fake)).body.contract;
    const sent = await call({ action: "send", id: c.id }, fake);
    const q = queryOf(sent.body.links[0].url);
    await call({ action: "void", id: c.id, reason: "Wrong terms" }, fake, owner);
    const res = makeRes();
    await runWithSharedDb(fake, () => signHandler({ method: "POST", query: q, headers: {}, body: { signer_name: "Dana Whitfield", agreed: true } }, res));
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.error, "voided");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
    assert.equal(fake.tables.contract_signers[0].signed_at ?? null, null);
    assert.equal(fake.tables.contracts[0].status, "void");
    assert.equal(fake.tables.events.some((e) => e.name === "contract.signed"), false);
  });
});
