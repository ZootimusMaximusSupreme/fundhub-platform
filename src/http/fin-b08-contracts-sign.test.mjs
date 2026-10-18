// finish-853 batch 08: GET and POST /api/contracts/sign. The link a signer gets is minted by the
// real send (api/contracts.mjs); the real signing handler, the real signature and expiry check, the
// real integrity check (the wording must still match the copy that was sent) and the real PDF
// builder then run over the stand-in contract tables of src/testing/fin-b08-contracts-db.mjs.
// Rows covered: view, sign, decline. Practice test, fake data, no network, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import contractsHandler from "../../api/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { contractsDb, baseBook, IDS } from "../testing/fin-b08-contracts-db.mjs";
import { signContractUrl } from "../contracts/signed-link.mjs";

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

const book = () => baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID });
const staffOwner = [staffSession({ role: "owner" })];

async function viaStaff(body, fake) {
  const session = fakeDb(staffOwner);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => contractsHandler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return res;
}
/** A sent contract, and the link(s) its signer(s) were given. */
async function sentContract({ signers = null, order = "sequential", extraRules = [] } = {}) {
  const fake = contractsDb({ ...book(), extraRules });
  const created = await viaStaff({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" }, signers, signing_order: order }, fake);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const sent = await viaStaff({ action: "send", id: created.body.contract.id }, fake);
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const linkQuery = (url) => Object.fromEntries(new URL(url).searchParams.entries());
  return { fake, id: created.body.contract.id, links: sent.body.links.map((l) => ({ ...l, query: linkQuery(l.url) })), contractLink: linkQuery(sent.body.link.url) };
}
async function sign(request, fake) {
  const res = makeRes();
  await runWithSharedDb(fake, () => signHandler(request, res));
  return res;
}
const get = (query, fake, headers = {}) => sign({ method: "GET", query, headers, body: {} }, fake);
const post = (query, body, fake, headers = {}, socket = null) => sign({ method: "POST", query, headers, body, socket }, fake);

describe("GET /api/contracts/sign", () => {
  test("opening the link shows the frozen words and records the view: viewed_at once, view_count every time", async () => {
    const { fake, id, links } = await sentContract();
    const q = links[0].query;
    const first = await get(q, fake);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.contract.body, "Hello Dana, you agree to the setup of Credit review.");
    assert.equal(first.body.contract.status, "viewed");
    assert.equal(first.body.contract.can_sign, true);
    assert.equal(first.body.contract.verified, true, "the words still match the copy that was sent");
    const row = fake.tables.contracts.find((c) => c.id === id);
    assert.equal(row.view_count, 1);
    const stamped = row.viewed_at;
    assert.ok(stamped);
    await get(q, fake);
    assert.equal(row.view_count, 2);
    assert.equal(row.viewed_at, stamped, "the first view stays the first view");
    assert.equal(fake.tables.contract_signers[0].view_count, 2);
    assert.equal(fake.tables.contract_signers[0].status, "viewed");
    const shown = JSON.stringify(first.body);
    for (const secret of ["org_id", "sent_by", "created_by", "document_id", "merge_values", ORG_ID, STAFF_ID]) {
      assert.equal(shown.includes(secret), false, `${secret} is not sent to the signer`);
    }
  });

  test("?file=1 returns the document itself as a PDF, only on a good link", async () => {
    const { fake, links } = await sentContract();
    const res = await get({ ...links[0].query, file: "1" }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.signed, false);
    assert.equal(Buffer.from(res.body.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal(res.headers["cache-control"], "private, no-store");
    const forged = await get({ ...links[0].query, sig: "0".repeat(64), file: "1" }, fake);
    assert.equal(forged.statusCode, 404);
    assert.equal(forged.body.pdf_base64, undefined);
    // A voided contract's file is not handed out either.
    await viaStaff({ action: "void", id: fake.tables.contracts[0].id, reason: "Wrong terms" }, fake);
    const voided = await get({ ...links[0].query, file: "1" }, fake);
    assert.equal(voided.statusCode, 404);
    assert.equal(voided.body.pdf_base64, undefined);
  });

  test("a forged, wrong-signer, unknown or tampered-expiry link is the same 404, and a draft is not there", async () => {
    const { fake, id, links } = await sentContract();
    const q = links[0].query;
    const bad = await get({ ...q, sig: q.sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }, fake);
    assert.equal(bad.statusCode, 404);
    assert.deepEqual(bad.body, { ok: false, error: "not_found" });
    const otherSigner = await get({ ...q, s: "5e000000-0000-4000-8000-000000000999" }, fake);
    assert.deepEqual([otherSigner.statusCode, otherSigner.body], [404, { ok: false, error: "not_found" }]);
    const unknown = await get({ id: "a9999999-0000-4000-8000-000000000000", exp: q.exp, sig: q.sig }, fake);
    assert.equal(unknown.statusCode, 404);
    const expired = await get({ ...q, exp: String(Math.floor(Date.now() / 1000) - 10) }, fake);
    // The signature covers the expiry, so moving it breaks the signature first.
    assert.equal(expired.statusCode, 404);
    const draftFile = contractsDb(book());
    const draft = await viaStaff({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "x" } }, draftFile);
    const mint = (await import("../contracts/signed-link.mjs")).signContractUrl({ contractId: draft.body.contract.id, signerId: draftFile.tables.contract_signers[0].id, baseUrl: "https://app.example.test" });
    const mq = Object.fromEntries(new URL(mint.url).searchParams.entries());
    const draftView = await get(mq, draftFile);
    assert.equal(draftView.statusCode, 404, "a contract not yet sent is not there");
    assert.deepEqual(draftView.body, { ok: false, error: "not_found" }, "and it answers exactly as a forged link does");
    void id;
  });

  test("with no signing secret on the server the link cannot be checked: 503 not_configured, and nothing is opened or recorded", async () => {
    const { fake, id, links } = await sentContract();
    const held = { a: process.env.CONTRACT_URL_SECRET, b: process.env.DOCUMENT_URL_SECRET };
    delete process.env.CONTRACT_URL_SECRET;
    delete process.env.DOCUMENT_URL_SECRET;
    let view, decline;
    try {
      view = await get(links[0].query, fake);
      decline = await post(links[0].query, { action: "decline", reason: "No." }, fake);
    } finally {
      process.env.CONTRACT_URL_SECRET = held.a;
      process.env.DOCUMENT_URL_SECRET = held.b;
    }
    for (const r of [view, decline]) {
      assert.equal(r.statusCode, 503);
      assert.equal(r.body.error, "not_configured");
      assert.equal(r.body.contract, undefined);
    }
    assert.equal(fake.tables.contracts.find((c) => c.id === id).view_count ?? 0, 0, "no view was recorded");
    assert.equal(fake.tables.contract_signers[0].status === "declined", false);
  });

  test("a link that has really expired is told apart from a forged one", async () => {
    const { fake, id, links } = await sentContract();
    const old = signContractUrl({ contractId: id, signerId: links[0].signer_id, ttlSeconds: 60, baseUrl: "https://app.example.test", now: () => Date.now() - 3600 * 1000 });
    const q = Object.fromEntries(new URL(old.url).searchParams.entries());
    const res = await get(q, fake);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.error, "link_expired");
  });

  test("a voided contract cannot be opened for signing, and the second signer waits for the first", async () => {
    const two = [
      { role_label: "Client", name: "Dana Whitfield", email: "dana@example.test", client_id: IDS.client },
      { role_label: "Counterparty", name: "Pat Counter", email: "pat@example.test", client_id: null },
    ];
    const { fake, id, links } = await sentContract({ signers: two });
    const second = await get(links[1].query, fake);
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.error, "not_your_turn");
    assert.match(second.body.message, /waiting for Dana Whitfield/);
    assert.equal(second.body.contract, undefined, "the document is not shown until the first has signed");
    const first = await get(links[0].query, fake);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.contract.turn.name, "Dana Whitfield");
    await viaStaff({ action: "void", id, reason: "Wrong terms" }, fake);
    const voided = await get(links[0].query, fake);
    assert.equal(voided.statusCode, 409);
    assert.equal(voided.body.error, "voided");
  });
});

describe("POST /api/contracts/sign", () => {
  test("a typed name and a tick sign it: the signer row holds the name, the time and the IP, the contract completes with a signed copy and an event", async () => {
    const { fake, id, links } = await sentContract();
    const q = links[0].query;
    const res = await post(q, { signer_name: "  Dana   Whitfield ", agreed: true }, fake, { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "TestBrowser/1.0" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.complete, true);
    assert.equal(res.body.contract.status, "signed");
    const signer = fake.tables.contract_signers[0];
    assert.deepEqual([signer.status, signer.signer_name, signer.signer_ip, signer.signer_user_agent], ["signed", "Dana Whitfield", "203.0.113.9", "TestBrowser/1.0"]);
    assert.ok(signer.signed_at);
    const row = fake.tables.contracts.find((c) => c.id === id);
    assert.equal(row.status, "signed");
    assert.equal(row.signer_name, "Dana Whitfield");
    assert.ok(row.signed_at && row.completed_at);
    assert.ok(row.signed_document_id, "a signed copy is registered");
    assert.ok(fake.tables.events.some((e) => e.name === "contract.signed" && e.client_id === IDS.client));
    assert.deepEqual(asked, []);
  });

  test("without the tick, without a real name, or twice, it is refused and nothing is signed", async () => {
    const { fake, id, links } = await sentContract();
    const q = links[0].query;
    const noTick = await post(q, { signer_name: "Dana Whitfield", agreed: false }, fake);
    assert.equal(noTick.statusCode, 400);
    assert.equal(noTick.body.error, "agreement_required");
    const shortName = await post(q, { signer_name: "D", agreed: true }, fake);
    assert.equal(shortName.body.error, "name_required");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).signed_at ?? null, null);
    const ok = await post(q, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(ok.statusCode, 200);
    const again = await post(q, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(again.statusCode, 409);
    assert.equal(fake.tables.events.filter((e) => e.name === "contract.signed").length, 1);
  });

  test("if the wording changed after it was sent the signature is refused and the contract is not signed", async () => {
    const { fake, id, links } = await sentContract();
    fake.tables.contracts.find((c) => c.id === id).rendered_body += " Also you owe us a million dollars.";
    const res = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "content_changed");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status === "signed", false);
    const view = await get(links[0].query, fake);
    assert.equal(view.body.contract.verified, false, "the page can see the mismatch too");
  });

  test("two signers sign in order: the first leaves the contract open, the second completes it", async () => {
    const two = [
      { role_label: "Client", name: "Dana Whitfield", email: "dana@example.test", client_id: IDS.client },
      { role_label: "Counterparty", name: "Pat Counter", email: "pat@example.test", client_id: null },
    ];
    const { fake, id, links } = await sentContract({ signers: two });
    const early = await post(links[1].query, { signer_name: "Pat Counter", agreed: true }, fake);
    assert.equal(early.statusCode, 409);
    assert.equal(early.body.error, "not_your_turn");
    const first = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.complete, false);
    assert.match(first.body.message, /We will let you know when everybody else has signed too/);
    assert.notEqual(fake.tables.contracts.find((c) => c.id === id).status, "signed");
    const last = await post(links[1].query, { signer_name: "Pat Counter", agreed: true }, fake);
    assert.equal(last.statusCode, 200);
    assert.equal(last.body.complete, true);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status, "signed");
  });

  test("a decline is recorded and makes one task for the staff sender with the reason; it needs a reason and cannot undo a signature", async () => {
    const tasks = [];
    const taskRules = [
      [/SELECT id, org_id, client_id, title, sent_by\s+FROM contracts\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/, (_sql, p) => [{ id: p[0], org_id: p[1], client_id: IDS.client, title: "Service Agreement", sent_by: STAFF_ID }]],
      [/SELECT id FROM tasks\s+WHERE client_id = \$1 AND source_workflow = \$2 AND body = \$3/, []],
      [/INSERT INTO tasks/, (_sql, p) => { tasks.push(p); return [{ id: "task-decline-1" }]; }],
    ];
    const { fake, id, links } = await sentContract({ extraRules: taskRules });
    const q = links[0].query;
    const none = await post(q, { action: "decline", reason: "  " }, fake);
    assert.equal(none.statusCode, 400);
    assert.equal(none.body.error, "decline_reason_required");
    const res = await post(q, { action: "decline", reason: "I did not ask for this." }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.declined, true);
    const signer = fake.tables.contract_signers[0];
    assert.deepEqual([signer.status, signer.decline_reason], ["declined", "I did not ask for this."]);
    assert.ok(signer.declined_at);
    assert.equal(tasks.length, 1, "the sender gets one task");
    assert.equal(tasks[0][0], ORG_ID);
    assert.equal(tasks[0][1], IDS.client);
    assert.match(tasks[0][2], /Contract declined: Service Agreement/);
    assert.match(tasks[0][3], new RegExp(`^contract\\.declined:${id}:${signer.id}$`), "the task dedupes this signer decline");
    assert.equal(tasks[0][5], "contract-sign-decline");
    assert.equal(tasks[0][6], "closer");
    assert.equal(tasks[0][7], STAFF_ID, "the original sender owns the task");
    assert.match(tasks[0][9], /Reason: I did not ask for this\./);
    const after = await post(q, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(after.statusCode, 409);
    assert.equal(after.body.error, "declined");
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status === "signed", false);
    const signedFile = await sentContract();
    await post(signedFile.links[0].query, { signer_name: "Dana Whitfield", agreed: true }, signedFile.fake);
    const late = await post(signedFile.links[0].query, { action: "decline", reason: "changed my mind" }, signedFile.fake);
    assert.equal(late.statusCode, 409);
    assert.equal(signedFile.fake.tables.contract_signers[0].status, "signed");
  });

  test("a link for another contract's signer cannot sign this one, and only GET and POST are served", async () => {
    const { fake, links } = await sentContract();
    const q = links[0].query;
    const wrongContract = await post({ ...q, id: "a9999999-0000-4000-8000-000000000000" }, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(wrongContract.statusCode, 404);
    const del = await sign({ method: "DELETE", query: q, headers: {}, body: {} }, fake);
    assert.equal(del.statusCode, 405);
  });

  test("a link with a good signature that names a signer who is not on this contract opens nothing, hands out no file and records nothing", async () => {
    const { fake, id } = await sentContract();
    // The signature is real (the server minted it), but the person is not a signer on this contract.
    const stranger = "5e000000-0000-4000-8000-000000000999";
    const minted = signContractUrl({ contractId: id, signerId: stranger, baseUrl: "https://app.example.test" });
    const q = Object.fromEntries(new URL(minted.url).searchParams.entries());
    const before = JSON.stringify([fake.tables.contract_signers, fake.tables.contracts, fake.tables.events]);
    const gone = { ok: false, error: "not_found" };

    const view = await get(q, fake);
    assert.deepEqual([view.statusCode, view.body], [404, gone], "view");
    const file = await get({ ...q, file: "1" }, fake);
    assert.deepEqual([file.statusCode, file.body], [404, gone], "file");
    assert.equal(file.body.pdf_base64, undefined);
    const decline = await post(q, { action: "decline", reason: "This is not mine." }, fake);
    assert.deepEqual([decline.statusCode, decline.body], [404, gone], "decline");
    const signed = await post(q, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.deepEqual([signed.statusCode, signed.body], [404, gone], "sign");
    assert.equal(JSON.stringify([fake.tables.contract_signers, fake.tables.contracts, fake.tables.events]), before, "nothing was recorded");
  });
});
