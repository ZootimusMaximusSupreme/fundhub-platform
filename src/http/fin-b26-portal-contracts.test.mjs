// finish-853 batch 26: GET /api/read/portal-contracts. The real handler and the real contracts library
// (src/contracts/send.mjs, signers.mjs, templates.mjs, signed-link.mjs) run over stand-in tables that
// answer by the conditions each statement names. Practice test, fake data, no network, no database.
// The row's words: agreements on the signed-in client's file: sent, viewed, signed, and a fresh sign
// link when they still owe a signature.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/portal-contracts.mjs";
import { signature } from "../contracts/signed-link.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, CLIENT, OTHER_CLIENT, FOREIGN_CLIENT, PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

// A fake signing key built at run time, long enough for the link signer.
const SECRET = ["fake", "contract", "link", "key", "long", "enough", "for", "signing"].join("-");
const saved = { secret: process.env.CONTRACT_URL_SECRET, base: process.env.PUBLIC_BASE_URL };
before(() => {
  process.env.CONTRACT_URL_SECRET = SECRET;
  process.env.PUBLIC_BASE_URL = "https://app.example.test/";
});
after(() => {
  for (const [key, value] of [["CONTRACT_URL_SECRET", saved.secret], ["PUBLIC_BASE_URL", saved.base]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const C = (n) => `c${n}000000-0000-4000-8000-00000000000${n}`;
const SG = (n) => `d${n}000000-0000-4000-8000-00000000000${n}`;

const contract = (id, status, over = {}) => ({
  id, org_id: ORG_ID, client_id: CLIENT, title: `Agreement ${id.slice(0, 2)}`, status, template_key: "FUNDING-AGREEMENT",
  sent_at: "2026-10-01T00:00:00.000Z", signed_at: status === "signed" ? "2026-10-02T00:00:00.000Z" : null,
  created_at: `2026-10-0${Number(id[1]) || 1}T00:00:00.000Z`, ...over,
});
const signer = (id, contractId, index, over = {}) => ({
  id, contract_id: contractId, signer_index: index, client_id: CLIENT, status: "sent", signed_at: null, name: "Dana", ...over,
});

function world(over = {}) {
  return {
    clients: [
      { id: CLIENT, org_id: ORG_ID }, { id: OTHER_CLIENT, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID },
    ],
    contracts: [
      contract(C(1), "sent"),
      contract(C(2), "viewed"),
      contract(C(3), "signed"),
      contract(C(4), "draft"),
      contract(C(5), "void"),
      contract(C(6), "sent", { template_key: "NO-SUCH-TEMPLATE" }),
      contract(C(7), "sent", { client_id: OTHER_CLIENT }),
      contract(C(8), "sent", { org_id: OTHER_ORG_ID, client_id: CLIENT }),
      contract(C(9), "sent"),
      // An agreement already closed whose signer row still reads "sent": the link is for open agreements only.
      contract("ca000000-0000-4000-8000-00000000000a", "signed", { created_at: "2026-10-09T00:00:00.000Z" }),
    ],
    contract_templates: [
      { org_id: ORG_ID, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement" },
      { org_id: OTHER_ORG_ID, template_key: "FUNDING-AGREEMENT", name: "Another company's name" },
    ],
    contract_signers: [
      signer(SG(1), C(1), 0),
      signer(SG(2), C(2), 0, { status: "viewed" }),
      signer(SG(3), C(3), 0, { status: "signed", signed_at: "2026-10-02T00:00:00.000Z" }),
      signer(SG(6), C(6), 0),
      // A second signer, the counterparty: index 0 is somebody else, the client is index 1.
      signer(SG(9), C(9), 0, { client_id: null, name: "Counter Party" }),
      signer(SG(10), C(9), 1),
      signer("db000000-0000-4000-8000-00000000000b", "ca000000-0000-4000-8000-00000000000a", 0),
    ],
    ...over,
  };
}

function rulesFor(t) {
  return [
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (sql, p) => inSql(t.clients, sql, p).map(() => ({ "?column?": 1 }))],
    [/FROM contracts c\s+JOIN clients cl/i, (sql, p) => inSql(t.contracts, sql, p)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, p[3])],
    [/FROM contract_templates/i, (sql, p) => inSql(t.contract_templates, sql, p).slice(0, 1)],
    [/FROM contract_signers\s+WHERE contract_id = \$1::uuid/i, (sql, p) =>
      t.contract_signers.filter((s) => s.contract_id === p[0]).sort((a, b) => a.signer_index - b.signer_index)],
    [/^\s*UPDATE contract_signers\s+SET link_expires_at/i, (sql, p) => {
      const s = t.contract_signers.find((r) => r.id === p[0] && (!/AND signed_at IS NULL/.test(sql) || !r.signed_at));
      if (s) { s.link_expires_at = p[1]; if (s.status === "pending") s.status = "sent"; }
      return [];
    }],
    [/^\s*UPDATE contracts SET link_expires_at/i, (sql, p) => {
      const c = t.contracts.find((r) => r.id === p[0] && r.org_id === p[1]);
      if (c) c.link_expires_at = p[2];
      return [];
    }],
  ];
}

const get = (who, query = {}, t = world()) => run(handler, req("GET", { query }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));
const own = () => asClient(CLIENT, ORG_ID);

describe("GET /api/read/portal-contracts", () => {
  test("a client sees the agreements on their own file that are sent, viewed or signed, and not drafts or voided ones", async () => {
    const { res, fake } = await get(own());
    assert.equal(res.statusCode, 200);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    assert.deepEqual(Object.keys(byId).sort(), [C(1), C(2), C(3), C(6), C(9), "ca000000-0000-4000-8000-00000000000a"].sort());
    assert.equal(res.body.count, 6);
    assert.deepEqual([byId[C(1)].status, byId[C(2)].status, byId[C(3)].status], ["sent", "viewed", "signed"]);
    assert.equal(byId[C(1)].template_name, "Funding Agreement");
    assert.equal(byId[C(6)].template_name, "NO-SUCH-TEMPLATE", "a template with no name falls back to its key");
    assert.equal(byId[C(3)].signed_at, "2026-10-02T00:00:00.000Z");
    assert.equal(byId[C(1)].sent_at, "2026-10-01T00:00:00.000Z");
    const list = sqlOf(fake, /FROM contracts c\s+JOIN clients cl/)[0];
    assert.deepEqual([list.params[0], list.params[1], list.params[3]], [ORG_ID, CLIENT, 50]);
    pinned(list.sql, "this company, newest first", "WHERE c.org_id = $1::uuid AND ($2::uuid IS NULL OR c.client_id = $2::uuid)");
    pinned(list.sql, "newest first", "ORDER BY c.created_at DESC LIMIT $4");
  });

  test("a fresh sign link is minted only for an agreement the client still owes: sent or viewed, not signed, not declined", async () => {
    const t = world({
      contract_signers: [
        signer(SG(1), C(1), 0), signer(SG(2), C(2), 0, { status: "viewed" }),
        signer(SG(3), C(3), 0, { status: "signed", signed_at: "2026-10-02T00:00:00.000Z" }),
        signer(SG(6), C(6), 0, { status: "declined" }),
        signer(SG(9), C(9), 0, { client_id: null }), signer(SG(10), C(9), 1),
        signer("db000000-0000-4000-8000-00000000000b", "ca000000-0000-4000-8000-00000000000a", 0),
      ],
    });
    const { res, fake } = await get(own(), {}, t);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    assert.equal(byId[C(1)].needs_signature, true);
    assert.equal(byId[C(2)].needs_signature, true);
    assert.equal(byId[C(3)].needs_signature, false);
    assert.equal(byId[C(6)].needs_signature, false, "a declined signer is not asked again");
    assert.equal(byId[C(3)].sign_url, null);
    assert.equal(byId[C(6)].sign_url, null);
    const closed = byId["ca000000-0000-4000-8000-00000000000a"];
    assert.equal(closed.needs_signature, false, "a signed agreement is not asked for again, whatever its signer row says");
    assert.equal(closed.sign_url, null);

    // The link is the signed link of THIS signer, with a real signature and about thirty days of life.
    const url = new URL(byId[C(1)].sign_url);
    assert.equal(url.origin, "https://app.example.test");
    assert.equal(url.pathname, "/contract.html");
    assert.equal(url.searchParams.get("id"), C(1));
    assert.equal(url.searchParams.get("s"), SG(1));
    const exp = Number(url.searchParams.get("exp"));
    const days = (exp * 1000 - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, `about thirty days, got ${days}`);
    assert.equal(url.searchParams.get("sig"), signature({ contractId: C(1), signerId: SG(1), expiresAt: exp, secret: SECRET }));
    // Each link is its own: another agreement's link is not this one.
    assert.notEqual(byId[C(1)].sign_url, byId[C(2)].sign_url);
    assert.equal(new URL(byId[C(2)].sign_url).searchParams.get("s"), SG(2));
    // The only writes are the link's own life on the signer and the contract.
    for (const w of writes(fake)) assert.match(w.sql, /^\s*UPDATE (contract_signers|contracts)\s+SET link_expires_at/i);
    // Links are minted for C1 (one signer), C2 (one) and C9 (two signers): a write per signer, one per contract.
    assert.equal(writes(fake).length, (1 + 1) + (1 + 1) + (2 + 1), "link life on each signer and on each contract that owed a signature");
    assert.equal(writes(fake).some((w) => new RegExp(C(3)).test(JSON.stringify(w.params))), false, "a signed agreement is never re-linked");
  });

  test("with two signers the link is the client's own, not the first person's", async () => {
    const { res } = await get(own());
    const item = res.body.items.find((i) => i.id === C(9));
    assert.equal(item.needs_signature, true);
    assert.equal(new URL(item.sign_url).searchParams.get("s"), SG(10), "the signer whose file this is, not index 0");
  });

  test("a client sees their own file only: another client's id in the address is ignored, and another company's agreement is not shown", async () => {
    const { res, fake } = await get(own(), { client_id: OTHER_CLIENT });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.items.every((i) => i.id !== C(7)), "the other client's agreement is not shown");
    assert.ok(res.body.items.every((i) => i.id !== C(8)), "another company's agreement for the same client id is not shown");
    assert.equal(sqlOf(fake, /FROM contracts c\s+JOIN clients cl/)[0].params[1], CLIENT);
  });

  test("a client login with no file attached is refused, and a file in another company reads as not found; nothing is listed", async () => {
    const detached = await get(asClient(null, ORG_ID));
    assert.equal(detached.res.statusCode, 403);
    assert.equal(sqlOf(detached.fake, /FROM contracts/).length, 0);
    const foreign = await get(asClient(FOREIGN_CLIENT, ORG_ID));
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(foreign.res.body.error, "client_not_found");
    assert.equal(sqlOf(foreign.fake, /FROM contracts/).length, 0);
  });

  test("staff name a client in their own company; every staff role may; another company's client is a 404", async () => {
    const none = await get(asRole("closer"));
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "client_id_required");
    const bad = await get(asRole("closer"), { client_id: "nope" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_client_id");
    for (const role of ALL_STAFF_ROLES) {
      const { res } = await get(asRole(role), { client_id: CLIENT });
      assert.equal(res.statusCode, 200, role);
      assert.equal(res.body.items.length, 6, role);
    }
    const other = await get(asRole("owner", { org_id: OTHER_ORG_ID }), { client_id: CLIENT });
    assert.equal(other.res.statusCode, 404, "another company's staff do not read this client's agreements");
    assert.equal(sqlOf(other.fake, /FROM contracts/).length, 0);
    assert.deepEqual(sqlOf(other.fake, /SELECT 1 FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    const noOrg = await get(asRole("owner", { org_id: null }), { client_id: CLIENT });
    assert.equal(noOrg.res.statusCode, 400);
    assert.equal(noOrg.res.body.error, "org_required");
  });

  test("a staff login with a role off the floor, a partner, an affiliate and nobody are refused; only GET answers", async () => {
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res, fake } = await get(asRole(role), { client_id: CLIENT });
      assert.equal(res.statusCode, 403, role);
      assert.equal(sqlOf(fake, /FROM contracts/).length, 0, role);
    }
    for (const who of [asPartner(PARTNER), asAffiliate()]) {
      const { res, fake } = await get(who, { client_id: CLIENT });
      assert.equal(res.statusCode, 403);
      assert.equal(sqlOf(fake, /FROM contracts/).length, 0);
    }
    const nobody = await run(handler, req("GET", { query: { client_id: CLIENT } }), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
    const post = await run(handler, req("POST", { body: {} }), [...own(), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
    assert.equal(post.res.headers.allow, "GET");
  });

  test("a read that fails is a 500 that says so in plain words and names no database address", async () => {
    const t = world();
    const rules = [...own(), [/FROM contracts c\s+JOIN clients cl/i, new Error("connect ECONNREFUSED postgres://u:p@h:5432/db")], ...rulesFor(t)];
    const { res } = await run(handler, req("GET"), rules);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "read_failed");
    assert.match(res.body.message, /Something went wrong loading agreements/);
    assert.doesNotMatch(JSON.stringify(res.body), /postgres:\/\/u:p/);
  });
});
