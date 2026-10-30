// finish-853 batch 26: GET /api/read/inquiry-cases. The real handler, the real case queue
// (src/inquiry-ops/cases.mjs) and the real identity-packet check (src/inquiry-ops/doc-gate.mjs) run
// over stand-in tables. The stand-in READS each statement: its WHERE (including the live-consent
// predicate and the active-status list), its ORDER BY, and every output column it names (c.*, the
// whole-queue count, the client's name and email). Nothing about an answer is built by hand.
// Practice test, fake data, no network, no database.
// The row's words: the active inquiry-removal case queue with document packets for the Specialist desk.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/inquiry-cases.mjs";
import { AUTHORIZATION_CONSENT_KINDS } from "../inquiry-ops/doc-gate.mjs";
import { listCases } from "../inquiry-ops/cases.mjs";
import { strictFakeDb } from "../testing/s3-handler-call.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, CLIENT, OTHER_CLIENT, FOREIGN_CLIENT, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import {
  cleanSql, selectList, projectRow, orderRows, orderOf, whereOf, keep, evalSql,
} from "../testing/fin-b26-sql.mjs";

const NO_ID_CLIENT = "c3000000-0000-4000-8000-000000000003";   // address paper and a signature, no photo ID
const DECOY_CLIENT = "c4000000-0000-4000-8000-000000000004";   // papers of the wrong kind, consents of the wrong kind
const K = (n) => `ee00000${n}-0000-4000-8000-00000000000${n}`;
const DESK = ["owner", "admin", "inquiry_specialist", "funding_advisor"];
const NOW = "2026-10-14T00:00:00.000Z";

const kase = (id, client, status, requested, over = {}) => ({
  id, org_id: ORG_ID, client_id: client, case_status: status, assigned_remover: null,
  requested_at: requested, created_at: requested || "2026-09-01T00:00:00.000Z", open_inquiry_count: 2, ...over,
});
const doc = (client, subtype, over = {}) => ({ org_id: ORG_ID, client_id: client, kind: "client_upload", subtype, expires_at: null, ...over });
const consent = (client, kind, over = {}) => ({
  org_id: ORG_ID, client_id: client, kind, revoked_at: null, expires_at: null, granted_at: "2026-09-01T00:00:00.000Z", ...over,
});

function world(over = {}) {
  return {
    inquiry_removal_cases: [
      kase(K(1), CLIENT, "Queued", "2026-10-03T00:00:00.000Z"),
      kase(K(2), OTHER_CLIENT, "In Progress", "2026-10-01T00:00:00.000Z", { assigned_remover: "pat" }),
      kase(K(3), OTHER_CLIENT, "Escalated", null, { created_at: "2026-10-05T00:00:00.000Z" }),
      kase(K(4), CLIENT, "Completed", "2026-09-01T00:00:00.000Z"),
      kase(K(5), OTHER_CLIENT, "Canceled", "2026-09-02T00:00:00.000Z"),
      kase(K(6), FOREIGN_CLIENT, "Queued", "2026-10-02T00:00:00.000Z", { org_id: OTHER_ORG_ID }),
      // A client with an open case and a NEWER closed one: the open one is the answer.
      kase(K(7), NO_ID_CLIENT, "Scheduled", "2026-10-04T00:00:00.000Z"),
      kase(K(9), NO_ID_CLIENT, "Completed", "2026-10-09T00:00:00.000Z"),
      // A client with two open cases: the newest request is the answer.
      kase(K(8), DECOY_CLIENT, "Blocked", "2026-10-06T00:00:00.000Z"),
      kase("ee00000a-0000-4000-8000-00000000000a", DECOY_CLIENT, "Queued", "2026-10-02T00:00:00.000Z"),
      kase("e9000000-0000-4000-8000-000000000009", "c9000000-0000-4000-8000-000000000009", "Queued", "2026-09-15T00:00:00.000Z"), // archived case
    ],
    clients: [
      { id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.test" },
      { id: OTHER_CLIENT, org_id: ORG_ID, first_name: "Eli", last_name: "Park", email: "eli@example.test" },
      { id: NO_ID_CLIENT, org_id: ORG_ID, first_name: "Noa", last_name: "Idless", email: "noa@example.test" },
      { id: DECOY_CLIENT, org_id: ORG_ID, first_name: "Dex", last_name: "Decoy", email: "dex@example.test" },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Far", last_name: "Away", email: "far@example.test" },
      { id: "c9000000-0000-4000-8000-000000000009", org_id: ORG_ID, first_name: "Old", last_name: "File", custom_fields: { crm_archived_at: "2026-10-20T00:00:00Z" } },
    ],
    documents: [
      doc(CLIENT, "id_document"), doc(CLIENT, "proof_of_address"),
      doc(OTHER_CLIENT, "id_document"),
      // Another company's papers for the same client id, and an expired one: neither counts.
      doc(OTHER_CLIENT, "proof_of_address", { org_id: OTHER_ORG_ID }),
      doc(OTHER_CLIENT, "proof_of_address", { expires_at: "2020-01-01T00:00:00.000Z" }),
      // Address paper only: the photo ID is missing and nothing else may stand in for it.
      doc(NO_ID_CLIENT, "proof_of_address"),
      // A paper of the wrong KIND that carries the right subtype label does not count as the ID.
      doc(DECOY_CLIENT, "id_document", { kind: "deliverable" }),
      doc(DECOY_CLIENT, "proof_of_address"),
    ],
    client_consents: [
      consent(CLIENT, "dispute_authorization"),
      consent(OTHER_CLIENT, "dispute_authorization", { revoked_at: "2026-10-01T00:00:00.000Z" }),
      consent(NO_ID_CLIENT, "dispute_authorization"),
      // Live consents of OTHER kinds are not the authorization this desk needs.
      consent(DECOY_CLIENT, "call_recording"),
      consent(DECOY_CLIENT, "marketing_use"),
    ],
    ...over,
  };
}

/**
 * The statements, answered by reading them. `ctxOf` gives each row's scope; the select list is
 * read from the statement; WHERE and ORDER BY are evaluated as written.
 */
function rulesFor(t, { documentsFail = false } = {}) {
  return [
    [/FROM inquiry_removal_cases c\s+LEFT JOIN clients cl/i, (sql, p) => {
      const items = selectList(sql, 0);
      // Execute the real LEFT JOIN and its required-client predicate separately.
      // This preserves org and archived-file rules without hardcoding results.
      const join = /LEFT JOIN clients cl ON ([\s\S]*?) WHERE /i.exec(cleanSql(sql));
      assert.ok(join, "the same-org, non-archived case/client join exists");
      const where = whereOf(sql);
      assert.match(where, /AND cl\.id IS NOT NULL\s*$/i, "active client required");
      const kept = keep(t.inquiry_removal_cases,
        where.replace(/\s+AND cl\.id IS NOT NULL\s*$/i, ""), p, { alias: "c", now: NOW });
      const visible = kept.map((c) => ({
        c,
        cl: t.clients.find((cl) => evalSql(join[1], { params: p, rows: { c, cl } }) === true) || null
      })).filter(({ cl }) => cl !== null);
      const ordered = orderRows(visible, orderOf(sql), ({ c, cl }) => ({ params: p, rows: { c, cl } }));
      const lim = /LIMIT \$(\d+) OFFSET \$(\d+)/i.exec(cleanSql(sql));
      const limit = p[Number(lim[1]) - 1]; const offset = p[Number(lim[2]) - 1];
      const win = ordered.map(({ c, cl }) => ({ params: p, rows: { c, cl } }));
      return win.slice(offset, offset + limit).map((ctx) => projectRow(items, { ...ctx, window: win, group: win }));
    }],
    [/^\s*SELECT \*\s+FROM inquiry_removal_cases\s+WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/i, (sql, p) => {
      const kept = keep(t.inquiry_removal_cases, whereOf(sql), p, { alias: "inquiry_removal_cases", now: NOW });
      const ordered = orderRows(kept, orderOf(sql), (r) => ({ params: p, row: r }));
      return ordered.slice(0, 1).map((r) => ({ ...r }));
    }],
    [/SELECT client_id, kind, subtype\s+FROM documents/i, (sql, p) => {
      if (documentsFail) return new Error("documents unreadable");
      const items = selectList(sql, 0);
      return keep(t.documents, whereOf(sql), p, { now: NOW }).map((d) => projectRow(items, { params: p, row: d, rows: { documents: d } }));
    }],
    [/SELECT DISTINCT client_id\s+FROM client_consents/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.client_consents, whereOf(sql), p, { now: NOW }).map((c) => projectRow(items, { params: p, row: c, rows: { client_consents: c } }));
    }],
  ];
}

const get = (who, query = {}, { t = world(), ...opts } = {}) =>
  run(handler, req("GET", { query }), [...who, ...rulesFor(t, opts)]);
const desk = () => asRole("inquiry_specialist");
const ACTIVE_ORDER = [K(2), "ee00000a-0000-4000-8000-00000000000a", K(1), K(7), K(8), K(3)];

describe("GET /api/read/inquiry-cases", () => {
  test("the queue is this company's active cases, oldest request first, with the whole queue's size beside it", async () => {
    const { res, fake } = await get(desk());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.cases.map((c) => c.id), ACTIVE_ORDER, "oldest first; a case with no request date goes last");
    assert.equal(res.body.total, 6, "the whole queue, counted by the statement's own window count");
    assert.ok(res.body.cases.every((c) => !["Completed", "Canceled"].includes(c.case_status)), "closed cases are not in the queue");
    assert.ok(res.body.cases.every((c) => c.org_id === ORG_ID), "another company's case is not shown");
    const byId = Object.fromEntries(res.body.cases.map((c) => [c.id, c]));
    const dana = byId[K(1)];
    assert.deepEqual([dana.client_name, dana.client_first_name, dana.client_last_name, dana.client_email],
      ["Dana Whitfield", "Dana", "Whitfield", "dana@example.test"], "who the case is for, from the statement's own client columns");
    assert.deepEqual([byId[K(2)].client_name, byId[K(2)].client_email], ["Eli Park", "eli@example.test"]);
    assert.equal(dana.open_inquiry_count, 2);
    assert.equal(dana.case_status, "Queued");
    assert.equal(dana.assigned_remover, null);
    assert.equal(byId[K(2)].assigned_remover, "pat");
    assert.equal(res.body.cases.some((c) => "queue_total" in c), false, "the window count is not left on each row");
    const list = sqlOf(fake, /FROM inquiry_removal_cases c\s+LEFT JOIN clients cl/)[0];
    assert.equal(list.params[0], ORG_ID);
    assert.deepEqual(list.params[1], ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"], "active means these five");
    assert.deepEqual(list.params.slice(-2), [100, 0], "a hundred rows from the top unless asked");
    pinned(list.sql, "this company", "WHERE c.org_id = $1::uuid AND c.case_status::text = ANY($2::text[])");
    pinned(list.sql, "oldest request first", "ORDER BY c.requested_at ASC NULLS LAST, c.created_at ASC");
    assert.equal(wrote(fake), false);
  });

  test("the company is the session's: another company's id in the address changes nothing, here or in the packet reads", async () => {
    const { res, fake } = await get(desk(), { org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.cases.map((c) => c.id), ACTIVE_ORDER);
    assert.ok(res.body.cases.every((c) => c.id !== K(6)));
    for (const re of [/FROM inquiry_removal_cases c\s+LEFT JOIN/, /FROM documents/, /FROM client_consents/]) {
      assert.equal(sqlOf(fake, re)[0].params[0], ORG_ID, String(re));
    }
    const one = await get(desk(), { client_id: CLIENT, org_id: OTHER_ORG_ID });
    assert.equal(sqlOf(one.fake, /FROM inquiry_removal_cases\s+WHERE org_id/)[0].params[0], ORG_ID);
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
    // NO_ID_CLIENT: an address paper and a live signature, but no photo ID. Another label cannot stand in for it.
    assert.equal(byId[K(7)].docs_complete, false, "a client with no ID document is not complete");
    assert.deepEqual(byId[K(7)].docs_missing, ["id_document"]);
    // DECOY_CLIENT: the "ID" is a paper of the wrong kind, and the only live consents are other kinds.
    assert.equal(byId[K(8)].docs_complete, false);
    assert.deepEqual(byId[K(8)].docs_missing, ["id_document", "authorization"],
      "a wrong-kind paper is not the ID, and a call-recording or marketing consent is not the authorization");
  });

  test("the packet read names this company and the page's clients only, hides expired papers and revoked consents, and asks for the two authorization kinds only", async () => {
    const { fake } = await get(desk());
    const docs = sqlOf(fake, /FROM documents/)[0];
    assert.equal(docs.params[0], ORG_ID);
    assert.deepEqual([...docs.params[1]].sort(), [CLIENT, OTHER_CLIENT, NO_ID_CLIENT, DECOY_CLIENT].sort());
    pinned(docs.sql, "this company and these clients", "WHERE org_id = $1::uuid AND client_id = ANY($2::uuid[])");
    pinned(docs.sql, "live papers only", "AND (expires_at IS NULL OR expires_at > now())");
    const consents = sqlOf(fake, /FROM client_consents/)[0];
    assert.equal(consents.params[0], ORG_ID);
    pinned(consents.sql, "a live signature only", "revoked_at IS NULL");
    assert.deepEqual(consents.params[2], ["dispute_authorization", "soft_pull_consent"], "only these two consent kinds are an authorization");
    assert.deepEqual([...AUTHORIZATION_CONSENT_KINDS], ["dispute_authorization", "soft_pull_consent"]);
  });

  test("when the papers cannot be read the case says nothing about them, never 'incomplete'", async () => {
    const { res } = await get(desk(), {}, { documentsFail: true });
    assert.equal(res.statusCode, 200);
    for (const c of res.body.cases) {
      assert.equal("docs_complete" in c, false, "not checked is not false");
      assert.equal("docs_missing" in c, false);
    }
    assert.equal(res.body.total, 6);
  });

  test("filters: an exact status, a remover, closed cases on request; an unknown status falls back to the active queue; limits are bounded", async () => {
    const one = await get(desk(), { case_status: "In Progress" });
    assert.deepEqual(one.res.body.cases.map((c) => c.id), [K(2)]);
    assert.equal(sqlOf(one.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params[1], "In Progress");
    const mine = await get(desk(), { assigned_remover: "pat" });
    assert.deepEqual(mine.res.body.cases.map((c) => c.id), [K(2)]);
    const all = await get(desk(), { active_only: "false" });
    assert.deepEqual(all.res.body.cases.map((c) => c.id).sort(),
      [K(1), K(2), K(3), K(4), K(5), K(7), K(8), K(9), "ee00000a-0000-4000-8000-00000000000a"].sort());
    assert.equal(all.res.body.total, 9);
    const typo = await get(desk(), { case_status: "Wrapped Up" });
    assert.deepEqual(typo.res.body.cases.map((c) => c.id), ACTIVE_ORDER);
    const page = await get(desk(), { limit: "1", offset: "1" });
    assert.deepEqual(page.res.body.cases.map((c) => c.id), ["ee00000a-0000-4000-8000-00000000000a"]);
    assert.equal(page.res.body.total, 6, "the page is a slice; the total is the whole queue");
    const params = sqlOf(page.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params;
    assert.deepEqual(params.slice(-2), [1, 1]);
    // The limit has a ceiling and a floor; the offset has a floor; nothing sent means a hundred from the top.
    const huge = await get(desk(), { limit: "99999", offset: "-7" });
    assert.deepEqual(sqlOf(huge.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params.slice(-2), [500, 0]);
    const negative = await get(desk(), { limit: "-5" });
    assert.deepEqual(sqlOf(negative.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params.slice(-2), [1, 0]);
    const none = await get(desk(), { limit: "0" });
    assert.deepEqual(sqlOf(none.fake, /FROM inquiry_removal_cases c\s+LEFT JOIN/)[0].params.slice(-2), [100, 0], "zero is 'not sent'");
    // The queue library has the same bounds of its own, for any other caller that reaches it.
    for (const [args, want] of [[{}, [100, 0]], [{ limit: 0 }, [100, 0]], [{ limit: 90000 }, [500, 0]], [{ limit: -3, offset: -9 }, [1, 0]], [{ limit: 7, offset: 4 }, [7, 4]]]) {
      const lib = strictFakeDb(rulesFor(world()));
      await listCases(lib, { orgId: ORG_ID, ...args });
      assert.deepEqual(sqlOf(lib, /FROM inquiry_removal_cases c/)[0].params.slice(-2), want, JSON.stringify(args));
    }
  });

  test("one client's open case is the newest OPEN request, inside this company; a malformed client id is a 400", async () => {
    const { res, fake } = await get(desk(), { client_id: CLIENT });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.case.id, K(1));
    const q = sqlOf(fake, /FROM inquiry_removal_cases\s+WHERE org_id/)[0];
    assert.deepEqual([q.params[0], q.params[1]], [ORG_ID, CLIENT]);
    assert.deepEqual(q.params[2], ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"], "open means these five");
    pinned(q.sql, "open cases only", "AND case_status::text = ANY($3::text[])");
    pinned(q.sql, "the newest request first", "ORDER BY requested_at DESC LIMIT 1");
    // A closed case that is NEWER than the open one is not the answer.
    const noId = await get(desk(), { client_id: NO_ID_CLIENT });
    assert.equal(noId.res.body.case.id, K(7), "the open case, not the Completed one requested later");
    assert.equal(noId.res.body.case.case_status, "Scheduled");
    // Two open cases: the one requested last.
    const decoy = await get(desk(), { client_id: DECOY_CLIENT });
    assert.equal(decoy.res.body.case.id, K(8), "the newest request among the open ones");
    // Another company's client has no case in this company; a client with no open case reads null.
    const foreign = await get(desk(), { client_id: FOREIGN_CLIENT });
    assert.equal(foreign.res.body.case, null, "another company's client has no case in this company");
    const closedOnly = await get(desk(), { client_id: "c5000000-0000-4000-8000-000000000005" });
    assert.equal(closedOnly.res.body.case, null);
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
