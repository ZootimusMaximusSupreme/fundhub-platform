// finish-853 batch 26: GET /api/read/inquiry-cases. The real handler, the real case queue
// (src/inquiry-ops/cases.mjs) and the real identity-packet check (src/inquiry-ops/doc-gate.mjs) run
// over stand-in tables that answer by the conditions each statement names. Practice test, fake data,
// no network, no database.
// The row's words: the active inquiry-removal case queue with document packets for the Specialist desk.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/inquiry-cases.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, CLIENT, OTHER_CLIENT, FOREIGN_CLIENT, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

const K = (n) => `ee00000${n}-0000-4000-8000-00000000000${n}`;
const DESK = ["owner", "admin", "inquiry_specialist", "funding_advisor"];

const kase = (id, client, status, requested, over = {}) => ({
  id, org_id: ORG_ID, client_id: client, case_status: status, assigned_remover: null,
  requested_at: requested, created_at: requested || "2026-09-01T00:00:00.000Z", open_inquiry_count: 2, ...over,
});
const doc = (client, subtype, over = {}) => ({ org_id: ORG_ID, client_id: client, kind: "client_upload", subtype, expires_at: null, ...over });

function world(over = {}) {
  return {
    inquiry_removal_cases: [
      kase(K(1), CLIENT, "Queued", "2026-10-03T00:00:00.000Z"),
      kase(K(2), OTHER_CLIENT, "In Progress", "2026-10-01T00:00:00.000Z", { assigned_remover: "pat" }),
      kase(K(3), OTHER_CLIENT, "Escalated", null, { created_at: "2026-10-05T00:00:00.000Z" }),
      kase(K(4), CLIENT, "Completed", "2026-09-01T00:00:00.000Z"),
      kase(K(5), OTHER_CLIENT, "Canceled", "2026-09-02T00:00:00.000Z"),
      kase(K(6), FOREIGN_CLIENT, "Queued", "2026-10-02T00:00:00.000Z", { org_id: OTHER_ORG_ID }),
    ],
    clients: [
      { id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.test" },
      { id: OTHER_CLIENT, org_id: ORG_ID, first_name: "Eli", last_name: "Park", email: "eli@example.test" },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Far", last_name: "Away", email: "far@example.test" },
    ],
    documents: [
      doc(CLIENT, "id_document"), doc(CLIENT, "proof_of_address"),
      doc(OTHER_CLIENT, "id_document"),
      // Another company's papers for the same client id, and an expired one: neither counts.
      doc(OTHER_CLIENT, "proof_of_address", { org_id: OTHER_ORG_ID }),
      doc(OTHER_CLIENT, "proof_of_address", { expires_at: "2020-01-01T00:00:00.000Z" }),
    ],
    client_consents: [
      { org_id: ORG_ID, client_id: CLIENT, kind: "dispute_authorization", revoked_at: null, expires_at: null, granted_at: "2026-09-01T00:00:00.000Z" },
      { org_id: ORG_ID, client_id: OTHER_CLIENT, kind: "dispute_authorization", revoked_at: "2026-10-01T00:00:00.000Z", expires_at: null, granted_at: "2026-09-01T00:00:00.000Z" },
    ],
    ...over,
  };
}

function rulesFor(t, { documentsFail = false } = {}) {
  const NOW = "2026-10-14T00:00:00.000Z";
  return [
    [/FROM inquiry_removal_cases c\s+LEFT JOIN clients cl/i, (sql, p) => {
      const ascending = /ORDER BY c\.requested_at ASC NULLS LAST, c\.created_at ASC/.test(sql);
      const kept = inSql(t.inquiry_removal_cases, sql, p)
        .sort((a, b) => {
          // NULLS LAST on the requested date, then the created date, in the direction the statement states.
          const ar = a.requested_at, br = b.requested_at;
          if (ar !== br) { if (ar == null) return 1; if (br == null) return -1; return ascending ? ar.localeCompare(br) : br.localeCompare(ar); }
          return String(a.created_at).localeCompare(String(b.created_at));
        });
      const limit = p.at(-2), offset = p.at(-1);
      return kept.slice(offset, offset + limit).map((r) => {
        const cl = t.clients.find((c) => c.id === r.client_id) || {};
        return {
          ...r, queue_total: String(kept.length), client_first_name: cl.first_name, client_last_name: cl.last_name,
          client_email: cl.email, client_name: `${cl.first_name || ""} ${cl.last_name || ""}`.trim(),
        };
      });
    }],
    [/^\s*SELECT \*\s+FROM inquiry_removal_cases\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/i, (sql, p) =>
      inSql(t.inquiry_removal_cases, sql, p).sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))).slice(0, 1)],
    [/SELECT client_id, kind, subtype\s+FROM documents/i, (sql, p) => {
      if (documentsFail) return new Error("documents unreadable");
      const hidesExpired = /expires_at IS NULL OR expires_at > now\(\)/.test(sql);
      return inSql(t.documents, sql, p).filter((d) => !hidesExpired || !d.expires_at || d.expires_at > NOW);
    }],
    [/SELECT DISTINCT client_id\s+FROM client_consents/i, (sql, p) => {
      const live = /revoked_at IS NULL/.test(sql);
      return inSql(t.client_consents, sql, p).filter((c) => !live || c.revoked_at === null).map((c) => ({ client_id: c.client_id }));
    }],
  ];
}

const get = (who, query = {}, { t = world(), ...opts } = {}) =>
  run(handler, req("GET", { query }), [...who, ...rulesFor(t, opts)]);
const desk = () => asRole("inquiry_specialist");

describe("GET /api/read/inquiry-cases", () => {
  test("the queue is this company's active cases, oldest request first, with the whole queue's size beside it", async () => {
    const { res, fake } = await get(desk());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.cases.map((c) => c.id), [K(2), K(1), K(3)], "oldest first; a case with no request date goes last");
    assert.equal(res.body.total, 3);
    assert.ok(res.body.cases.every((c) => !["Completed", "Canceled"].includes(c.case_status)), "closed cases are not in the queue");
    assert.ok(res.body.cases.every((c) => c.org_id === ORG_ID), "another company's case is not shown");
    assert.equal(res.body.cases[1].client_name, "Dana Whitfield");
    assert.equal(res.body.cases[1].open_inquiry_count, 2);
    assert.equal(res.body.cases.some((c) => "queue_total" in c), false, "the window count is not left on each row");
    const list = sqlOf(fake, /FROM inquiry_removal_cases c\s+LEFT JOIN clients cl/)[0];
    assert.equal(list.params[0], ORG_ID);
    assert.deepEqual(list.params[1], ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"], "active means these five");
    pinned(list.sql, "this company", "WHERE c.org_id = $1::uuid AND c.case_status::text = ANY($2::text[])");
    pinned(list.sql, "oldest request first", "ORDER BY c.requested_at ASC NULLS LAST, c.created_at ASC");
    assert.equal(wrote(fake), false);
  });

  test("each case carries its identity packet: complete, or exactly what is missing; a signature filed as a consent counts", async () => {
    const { res } = await get(desk());
    const byId = Object.fromEntries(res.body.cases.map((c) => [c.id, c]));
    // CLIENT has an ID, proof of address and a live signed authorization (a consent row): complete.
    assert.equal(byId[K(1)].docs_complete, true);
    assert.deepEqual(byId[K(1)].docs_missing, []);
    // OTHER_CLIENT: an ID, but the address paper is another company's or expired, and the consent is revoked.
    assert.equal(byId[K(2)].docs_complete, false);
    assert.deepEqual(byId[K(2)].docs_missing, ["proof_of_address", "authorization"]);
  });

  test("the packet read names this company and the page's clients only, and hides expired papers and revoked consents", async () => {
    const { fake } = await get(desk());
    const docs = sqlOf(fake, /FROM documents/)[0];
    assert.equal(docs.params[0], ORG_ID);
    assert.deepEqual([...docs.params[1]].sort(), [CLIENT, OTHER_CLIENT].sort());
    pinned(docs.sql, "this company and these clients", "WHERE org_id = $1::uuid AND client_id = ANY($2::uuid[])");
    pinned(docs.sql, "live papers only", "AND (expires_at IS NULL OR expires_at > now())");
    const consents = sqlOf(fake, /FROM client_consents/)[0];
    assert.equal(consents.params[0], ORG_ID);
    pinned(consents.sql, "a live signature only", "revoked_at IS NULL");
  });

  test("when the papers cannot be read the case says nothing about them, never 'incomplete'", async () => {
    const { res } = await get(desk(), {}, { documentsFail: true });
    assert.equal(res.statusCode, 200);
    for (const c of res.body.cases) {
      assert.equal("docs_complete" in c, false, "not checked is not false");
      assert.equal("docs_missing" in c, false);
    }
    assert.equal(res.body.total, 3);
  });

  test("filters: an exact status, a remover, closed cases on request; an unknown status falls back to the active queue", async () => {
    const one = await get(desk(), { case_status: "In Progress" });
    assert.deepEqual(one.res.body.cases.map((c) => c.id), [K(2)]);
    assert.equal(sqlOf(one.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params[1], "In Progress");
    const mine = await get(desk(), { assigned_remover: "pat" });
    assert.deepEqual(mine.res.body.cases.map((c) => c.id), [K(2)]);
    const all = await get(desk(), { active_only: "false" });
    assert.deepEqual(all.res.body.cases.map((c) => c.id).sort(), [K(1), K(2), K(3), K(4), K(5)].sort());
    const typo = await get(desk(), { case_status: "Wrapped Up" });
    assert.deepEqual(typo.res.body.cases.map((c) => c.id), [K(2), K(1), K(3)]);
    const page = await get(desk(), { limit: "1", offset: "1" });
    assert.deepEqual(page.res.body.cases.map((c) => c.id), [K(1)]);
    assert.equal(page.res.body.total, 3, "the page is a slice; the total is the whole queue");
    const params = sqlOf(page.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params;
    assert.deepEqual(params.slice(-2), [1, 1]);
  });

  test("one client's open case, inside this company; a malformed client id is a 400", async () => {
    const { res, fake } = await get(desk(), { client_id: CLIENT });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.id, K(1));
    const q = sqlOf(fake, /FROM inquiry_removal_cases\s+WHERE org_id/)[0];
    assert.deepEqual([q.params[0], q.params[1]], [ORG_ID, CLIENT]);
    const foreign = await get(desk(), { client_id: FOREIGN_CLIENT });
    assert.equal(foreign.res.body.case, null, "another company's client has no case in this company");
    const bad = await get(desk(), { client_id: "nope" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(sqlOf(bad.fake, /FROM inquiry_removal_cases/).length, 0);
  });

  test("only the Specialist desk reads it: owner, admin, inquiry specialist and funding advisor; every other role is refused before a case is read", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const { res, fake } = await get(asRole(role));
      const allowed = DESK.includes(role);
      assert.equal(res.statusCode, allowed ? 200 : 403, role);
      if (!allowed) assert.equal(sqlOf(fake, /FROM inquiry_removal_cases/).length, 0, role);
    }
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res } = await get(asRole(role));
      assert.equal(res.statusCode, 403, role);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res, fake } = await get(who);
      assert.ok([401, 403].includes(res.statusCode));
      assert.equal(sqlOf(fake, /FROM inquiry_removal_cases/).length, 0);
    }
    const noOrg = await get(asRole("owner", { org_id: null }));
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(sqlOf(noOrg.fake, /FROM inquiry_removal_cases/).length, 0);
    const nobody = await run(handler, req("GET"), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
    const post = await run(handler, req("POST", { body: {} }), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
    assert.equal(post.res.headers.allow, "GET");
  });

  test("a database that does not answer is a 503 that says so, not an empty queue", async () => {
    const down = Object.assign(new Error("Connection terminated unexpectedly"), {});
    const { res } = await run(handler, req("GET"), [...asRole("owner"),
      [/FROM inquiry_removal_cases c\s+LEFT JOIN clients cl/i, down], ...rulesFor(world())]);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.db, "down");
  });
});
