// Practice test for the shell search row (Search button and Cmd/Ctrl+K: GET /api/read/search).
//
// Read-only, so there is no saved result to judge. The proof is the door: the real handler, fake
// sessions, and a stand-in database that is handed every statement the search sends. The existing
// search-read.test.mjs binds the session company as a parameter; this one also pins the company
// condition inside each statement's WHERE (a parameter the SQL never uses protects nothing), and
// holds what each group hands the screen.
//
// Every role list is written out by hand here, from the row's words ("search the book" is staff
// work). A partner, an affiliate or a client login is refused before any group is read.

import assert from "node:assert/strict";
import test from "node:test";

import search from "../../../../api/read/search.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { ORG_ID, OTHER_ORG_ID, accountSession, req, staffSession } from "../../../testing/handler-harness.mjs";

const STAFF_ROLES = ["owner", "admin", "sales_manager", "closer", "setter", "csm", "funding_advisor", "inquiry_specialist"];
const LOGIN_ONLY = /live JOIN staff|account_sessions|FROM accounts WHERE id/;

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const GROUPS = [
  { key: "clients", test: /FROM clients c\b/, org: /WHERE c\.org_id = \$1::uuid/ },
  { key: "contracts", test: /FROM contracts ct\b/, org: /WHERE ct\.org_id = \$1::uuid/ },
  { key: "documents", test: /FROM documents d\b/, org: /WHERE d\.org_id = \$1::uuid/ },
  { key: "conversations", test: /FROM conversations c\b/, org: /WHERE c\.org_id = \$1::uuid/ },
  { key: "cards", test: /FROM cards cd\b/, org: /WHERE cd\.org_id = \$1::uuid/ },
];

const ROWS = {
  clients: [{ id: CLIENT, title: "Dana Whitfield", email: "dana@example.test", phone: "+1 555 0100", business_name: "Whitfield Holdings" }],
  contracts: [{ id: "k1", title: "Funding agreement", status: "signed", client_id: CLIENT, client_name: "Dana Whitfield" }],
  documents: [{ id: "d1", title: "Bank statement", document_key: "doc-1", kind: "vault", client_id: CLIENT, client_name: "Dana Whitfield" }],
  conversations: [{ id: "v1", client_id: CLIENT, channel: "sms", client_name: "Dana Whitfield", preview: "Thanks, got it" }],
  cards: [{ id: "p1", client_id: CLIENT, stage_id: "s1", client_name: "Dana Whitfield", pipeline_name: "Sales", stage_name: "Booked" }],
};

function groupRules() {
  return GROUPS.map((g) => [(sql) => g.test.test(sql) && !LOGIN_ONLY.test(sql), () => ROWS[g.key]]);
}

const searchCalls = (fake) => fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql));

test("staff roles get five groups, each statement carries the session company in its WHERE and as parameter one", async () => {
  for (const role of STAFF_ROLES) {
    const { res, fake } = await callShared(search, req("GET", { query: { q: "dana", org_id: OTHER_ORG_ID } }), [staffSession({ role }), ...groupRules()]);
    assert.equal(res.statusCode, 200, role);
    const calls = searchCalls(fake);
    assert.equal(calls.length, GROUPS.length, `${role}: one statement per group`);
    for (const group of GROUPS) {
      const hit = calls.filter((c) => group.test.test(c.sql));
      assert.equal(hit.length, 1, `${role}: ${group.key} asked once`);
      assert.match(hit[0].sql, group.org, `${role}: ${group.key} must filter on the session company inside its WHERE`);
      assert.equal(hit[0].params[0], ORG_ID, `${role}: ${group.key} must bind the session company, never the one in the address`);
    }
    assert.ok(!calls.some((c) => c.params.includes(OTHER_ORG_ID)), `${role}: a company id from the address reached SQL`);
  }
});

test("a partner, an affiliate and a client are refused before any group is read", async () => {
  for (const kind of ["partner", "affiliate", "client"]) {
    const { res, fake } = await callShared(search, req("GET", { query: { q: "dana" } }),
      accountSession({ kind, partnerId: kind === "partner" ? "a1000000-0000-4000-8000-0000000000a1" : null, clientId: kind === "client" ? CLIENT : null }));
    assert.ok([401, 403].includes(res.statusCode), `${kind} got ${res.statusCode}`);
    assert.deepEqual(searchCalls(fake), [], kind);
  }
});

test("an empty term is an honest empty answer with no reads, and a session with no company is refused", async () => {
  const empty = await callShared(search, req("GET", { query: { q: "   " } }), [staffSession({ role: "closer" }), ...groupRules()]);
  assert.equal(empty.res.statusCode, 200);
  assert.deepEqual(Object.keys(empty.res.body.groups).sort(), ["cards", "clients", "contracts", "conversations", "documents"]);
  assert.deepEqual(searchCalls(empty.fake), []);

  const noCompany = await callShared(search, req("GET", { query: { q: "dana" } }), [staffSession({ role: "closer", org_id: null }), ...groupRules()]);
  assert.equal(noCompany.res.statusCode, 400);
  assert.equal(noCompany.res.body.error, "org_required");
  assert.deepEqual(searchCalls(noCompany.fake), []);
});

test("a typed percent sign or underscore is searched for itself, not as a wildcard", async () => {
  const { fake } = await callShared(search, req("GET", { query: { q: "100%_a" } }), [staffSession({ role: "owner" }), ...groupRules()]);
  for (const call of searchCalls(fake)) assert.equal(call.params[1], "%100\\%\\_a%");
});

test("each group hands the screen its own title, its own page and the client it belongs to", async () => {
  const { res } = await callShared(search, req("GET", { query: { q: "dana" } }), [staffSession({ role: "csm" }), ...groupRules()]);
  const g = res.body.groups;
  assert.deepEqual(g.clients[0], {
    type: "client", id: CLIENT, title: "Dana Whitfield", subtitle: "dana@example.test · +1 555 0100 · Whitfield Holdings",
    href: `/app/client-control-panel.html?id=${CLIENT}`, client_id: CLIENT,
  });
  assert.equal(g.contracts[0].href, `/app/contracts.html?client_id=${CLIENT}`);
  assert.equal(g.contracts[0].subtitle, "signed · Dana Whitfield");
  assert.equal(g.documents[0].href, `/app/documents.html?client_id=${CLIENT}`);
  assert.equal(g.conversations[0].href, "/app/messaging.html?conversation_id=v1");
  assert.equal(g.conversations[0].subtitle, "SMS · Thanks, got it");
  assert.equal(g.cards[0].href, `/app/client-control-panel.html?id=${CLIENT}`);
  assert.equal(g.cards[0].subtitle, "Sales / Booked");
});

test("a group that fails is not painted as an empty group and the answer is not a 200 with five empty lists", async () => {
  const failing = [(sql) => GROUPS[2].test.test(sql) && !LOGIN_ONLY.test(sql), () => { throw new Error("documents read failed"); }];
  const { res } = await callShared(search, req("GET", { query: { q: "dana" } }), [staffSession({ role: "owner" }), failing, ...groupRules()]);
  assert.notEqual(res.statusCode, 200);
  assert.equal(res.body && res.body.ok, false);
});
