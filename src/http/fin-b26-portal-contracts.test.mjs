// finish-853 batch 26: GET /api/read/portal-contracts. The real handler and the real contracts library
// (src/contracts/send.mjs, signers.mjs, templates.mjs, signed-link.mjs) run over stand-in tables that
// answer by the conditions each statement names. Practice test, fake data, no network, no database.
// The row's words: agreements on the signed-in client's file: sent, viewed, signed, and a fresh sign
// link when they still owe a signature.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/portal-contracts.mjs";
import { signature } from "../contracts/signed-link.mjs";
import { listContracts } from "../contracts/send.mjs";
import { strictFakeDb } from "../testing/s3-handler-call.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, CLIENT, OTHER_CLIENT, FOREIGN_CLIENT, PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import {
  cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep, runUpdate,
} from "../testing/fin-b26-sql.mjs";

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
const CS = "cb000000-0000-4000-8000-00000000000b";
const CT = "cc000000-0000-4000-8000-00000000000c";
const SG_SIGNED = "dc000000-0000-4000-8000-00000000000c";
const SG_OTHER = "dd000000-0000-4000-8000-00000000000d";
const SG_THIRD = "de000000-0000-4000-8000-00000000000e";
const SG_SECOND = "df000000-0000-4000-8000-00000000000f";

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
      contract("ca000000-0000-4000-8000-00000000000a", "signed", { created_at: "2026-10-09T12:00:00.000Z" }),
      // Still open, but THIS client's own signature is already on it (the other party has not signed).
      contract(CS, "sent", { created_at: "2026-10-10T00:00:00.000Z" }),
      // Three people, none of them this client's file, rows stored out of order.
      contract(CT, "sent", { created_at: "2026-10-11T00:00:00.000Z", template_key: "NO-SUCH-TEMPLATE" }),
    ],
    contract_templates: [
      // Another company's copy of the same key comes FIRST: a template lookup that forgets the company reads it.
      { org_id: OTHER_ORG_ID, template_key: "FUNDING-AGREEMENT", name: "Another company's name" },
      { org_id: ORG_ID, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement" },
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
      // The client has signed; the counterparty has not. The agreement is open, but nothing is owed by this client.
      signer(SG_SIGNED, CS, 0, { status: "signed", signed_at: "2026-10-10T00:00:00.000Z" }),
      signer(SG_OTHER, CS, 1, { client_id: null, name: "Counter Party" }),
      // Stored third-then-second, and the third has already signed: signing order, not storage order, picks who is "first".
      signer(SG_THIRD, CT, 2, { client_id: null, name: "Third", status: "signed", signed_at: "2026-10-10T00:00:00.000Z" }),
      signer(SG_SECOND, CT, 1, { client_id: null, name: "Second" }),
    ],
    ...over,
  };
}

/**
 * The statements, answered by reading them: each WHERE as written, each ORDER BY, the join to clients,
 * and the named output columns of every SELECT (the contract list, the template, the signers). The two
 * link-life UPDATEs are applied by their own SET lists and WHERE clauses.
 */
function rulesFor(t) {
  return [
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (sql, p) => inSql(t.clients, sql, p).map(() => ({ "?column?": 1 }))],
    [/FROM contracts c\s+JOIN clients cl/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /JOIN clients cl ON ([\s\S]*?) LEFT JOIN staff/i.exec(text)[1];
      const lim = /LIMIT \$(\d+)/i.exec(text);
      const kept = [];
      for (const c of t.contracts) {
        const cl = t.clients.find((x) => evalSql(joinText, { params: p, rows: { c, cl: x } }) === true);
        if (!cl) continue;
        const env = { params: p, rows: { c, cl, s: null } };
        if (evalSql(whereOf(sql), env) === true) kept.push(env);
      }
      const ordered = orderRows(kept, orderOf(sql), (env) => env);
      return ordered.slice(0, p[Number(lim[1]) - 1]).map((env) => projectRow(items, env));
    }],
    [/FROM contract_templates/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.contract_templates, whereOf(sql), p, { alias: "contract_templates" })
        .slice(0, 1).map((r) => projectRow(items, { params: p, row: r, rows: { contract_templates: r } }));
    }],
    [/FROM contract_signers\s+WHERE contract_id = \$1::uuid/i, (sql, p) => {
      const items = selectList(sql, 0);
      const kept = keep(t.contract_signers, whereOf(sql), p, { alias: "contract_signers" });
      const order = orderOf(sql);
      const ordered = order ? orderRows(kept, order, (r) => ({ row: r })) : kept;
      return ordered.map((r) => projectRow(items, { params: p, row: r, rows: { contract_signers: r } }));
    }],
    [/^\s*UPDATE contract_signers\s+SET link_expires_at/i, (sql, p) => ({ rows: [], rowCount: runUpdate(sql, p, t.contract_signers).rowCount })],
    [/^\s*UPDATE contracts SET link_expires_at/i, (sql, p) => ({ rows: [], rowCount: runUpdate(sql, p, t.contracts).rowCount })],
  ];
}

const get = (who, query = {}, t = world()) => run(handler, req("GET", { query }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));
const own = () => asClient(CLIENT, ORG_ID);

describe("GET /api/read/portal-contracts", () => {
  test("a client sees the agreements on their own file that are sent, viewed or signed, and not drafts or voided ones", async () => {
    const { res, fake } = await get(own());
    assert.equal(res.statusCode, 200);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    assert.deepEqual(Object.keys(byId).sort(), [C(1), C(2), C(3), C(6), C(9), "ca000000-0000-4000-8000-00000000000a", CS, CT].sort());
    assert.equal(res.body.count, 8);
    assert.deepEqual([byId[C(1)].status, byId[C(2)].status, byId[C(3)].status], ["sent", "viewed", "signed"]);
    assert.equal(byId[C(1)].template_name, "Funding Agreement");
    assert.equal(byId[C(6)].template_name, "NO-SUCH-TEMPLATE", "a template with no name falls back to its key");
    assert.equal(byId[C(3)].signed_at, "2026-10-02T00:00:00.000Z");
    assert.equal(byId[C(1)].sent_at, "2026-10-01T00:00:00.000Z");
    // Each column the card shows is read from the statement's own list, so one the product stops selecting is missing here.
    assert.deepEqual([byId[C(1)].title, byId[C(1)].template_key, byId[C(1)].signed_at, byId[C(2)].status, byId[C(3)].status],
      ["Agreement c1", "FUNDING-AGREEMENT", null, "viewed", "signed"]);
    assert.deepEqual(res.body.items.map((i) => i.id).slice(0, 3), [CT, CS, "ca000000-0000-4000-8000-00000000000a"], "newest agreement first");
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
        signer(SG_SIGNED, CS, 0, { status: "signed", signed_at: "2026-10-10T00:00:00.000Z" }),
        signer(SG_OTHER, CS, 1, { client_id: null, name: "Counter Party" }),
        signer(SG_THIRD, CT, 2, { client_id: null, name: "Third", status: "signed", signed_at: "2026-10-10T00:00:00.000Z" }),
        signer(SG_SECOND, CT, 1, { client_id: null, name: "Second" }),
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
    // This client has already signed an agreement that is still open (the other party has not): nothing is owed.
    assert.equal(byId[CS].status, "sent");
    assert.equal(byId[CS].needs_signature, false, "a signature already given is not asked for again, even while the agreement is open");
    assert.equal(byId[CS].sign_url, null);
    // Two people who are not this file (one already signed): the first in SIGNING order (index 1) is the link shown, not the first stored.
    assert.equal(byId[CT].needs_signature, true);
    assert.equal(new URL(byId[CT].sign_url).searchParams.get("s"), SG_SECOND, "signing order, not storage order");
    // Each link is its own: another agreement's link is not this one.
    assert.notEqual(byId[C(1)].sign_url, byId[C(2)].sign_url);
    assert.equal(new URL(byId[C(2)].sign_url).searchParams.get("s"), SG(2));
    // The only writes are the link's own life on the signer and the contract.
    for (const w of writes(fake)) assert.match(w.sql, /^\s*UPDATE (contract_signers|contracts)\s+SET link_expires_at/i);
    // Links are minted for C1 (one signer), C2 (one), C9 (two signers) and CT (two): a write per signer, one per contract.
    assert.equal(writes(fake).length, (1 + 1) + (1 + 1) + (2 + 1) + (2 + 1), "link life on each signer and on each contract that owed a signature");
    for (const closed of [C(3), CS]) {
      assert.equal(writes(fake).some((w) => new RegExp(closed).test(JSON.stringify(w.params))), false, "an agreement nothing is owed on is never re-linked");
    }
    // The link life really lands on the rows the statement names: the signer, and the contract of this company.
    assert.ok(t.contract_signers.find((r) => r.id === SG(1)).link_expires_at, "the signer's link life is written");
    assert.ok(t.contracts.find((r) => r.id === C(1)).link_expires_at, "the contract's link life is written");
    assert.equal(t.contract_signers.find((r) => r.id === SG_SIGNED).link_expires_at, undefined, "a signed signer's row is not touched");
    assert.equal(t.contract_signers.find((r) => r.id === SG_THIRD).link_expires_at, undefined,
      "a person who already signed keeps their row as it was, even when another signer's link is renewed on the same agreement");
    assert.ok(t.contract_signers.find((r) => r.id === SG_SECOND).link_expires_at, "the one who still owes a signature gets the new link life");
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

  test("the list is bounded at 200 and never below one, whatever a caller asks for; the template read is this company's own", async () => {
    for (const [limit, want] of [[undefined, 100], [0, 100], [5000, 200], [-4, 1], [30, 30]]) {
      const lib = strictFakeDb(rulesFor(world()));
      await listContracts(lib, { orgId: ORG_ID, clientId: CLIENT, ...(limit === undefined ? {} : { limit }) });
      assert.equal(sqlOf(lib, /FROM contracts c/)[0].params[3], want, String(limit));
    }
    const { fake } = await get(own());
    const tpl = sqlOf(fake, /FROM contract_templates/)[0];
    assert.equal(tpl.params[0], ORG_ID);
    pinned(tpl.sql, "this company's template only", "WHERE org_id = $1::uuid AND template_key = $2");
  });

  test("the company is the session's: another company's id in the address changes nothing", async () => {
    const { res, fake } = await get(own(), { org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 8);
    for (const re of [/SELECT 1 FROM clients/, /FROM contracts c/]) assert.equal(sqlOf(fake, re)[0].params[re.source.includes("1 FROM") ? 1 : 0], ORG_ID);
    const staff = await get(asRole("owner"), { client_id: CLIENT, org_id: OTHER_ORG_ID });
    assert.equal(staff.res.statusCode, 200);
    assert.equal(sqlOf(staff.fake, /FROM contracts c/)[0].params[0], ORG_ID);
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
      assert.equal(res.body.items.length, 8, role);
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
