// /api/blueprint/declines — endpoint tests for both callers. Stubbed principal,
// db and store; no network, no Postgres. The rules are tested in
// src/blueprint/decline-analyze.test.mjs and src/blueprint/decline-defense.test.mjs.
// The gate is api/money/overview.mjs's pattern: a client is pinned to their own
// file; staff need a role and a client in their org.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import handler from "../../api/blueprint/declines.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { DeclineInputError } from "../blueprint/decline-defense.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const DECLINE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG = "org-1";

const clientPrincipal = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffPrincipal = (role) => ({ kind: "staff", role, orgId: ORG, staffId: "s1", name: "Dana", staff: { id: "s1", role, org_id: ORG, name: "Dana", email: "dana@example.com" } });

const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

/* A store stand-in that records every call. */
function stubs(over = {}) {
  const calls = { read: [], record: [], link: [], step: [], schedule: [], outcome: [] };
  const view = { client: { id: MINE }, eligible: true, can_paste: true, applications: [], declines: [{ id: DECLINE, bank: "Chase" }] };
  const staff = { can_see_book: false, declines: [{ id: DECLINE, bank: "Chase" }], applications: [], bank_emails: [], next_sequence_notes: [] };
  const deps = {
    readDeclines: async (_db, args) => { calls.read.push(args); return over.read !== undefined ? over.read : (args.viewer.kind === "staff" ? { view, staff } : { view }); },
    recordDecline: async (_db, args) => { calls.record.push(args); if (over.recordThrows) throw over.recordThrows; return over.record || { ok: true, created: true, decline_id: DECLINE, analysis: { reasons: [], recon_steps: [], timing: { reapply: [] } }, task: { created: true } }; },
    linkLetter: async (_db, args) => { calls.link.push(args); return { ok: true }; },
    setStepStatus: async (_db, args) => { calls.step.push(args); return { ok: true, step: { status: args.status } }; },
    scheduleRecon: async (_db, args) => { calls.schedule.push(args); return { ok: true, recon_on: args.reconOn }; },
    recordOutcome: async (_db, args) => { calls.outcome.push(args); return { ok: true, outcome: args.outcome, outcome_words: "Still declined" }; }
  };
  return { deps, calls };
}

const run = async ({ method = "GET", query = {}, body, principal, inOrg, over } = {}) => {
  const { deps, calls } = stubs(over);
  const res = makeRes();
  await handler({ method, query, body }, res, { db: db(inOrg), requirePrincipal: gateAs(principal), ...deps });
  return { res, calls };
};

describe("GET — a client session", () => {
  test("reads the session's own file, as a client view, and nothing staff-only", async () => {
    const { res, calls } = await run({ principal: clientPrincipal() });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, MINE);
    assert.deepEqual(calls.read[0].viewer, { kind: "client" });
    assert.ok(res.body.view);
    assert.equal(res.body.staff, undefined);
  });

  test("cannot read another client via ?client_id — the URL is ignored", async () => {
    const { res, calls } = await run({ principal: clientPrincipal(), query: { client_id: OTHER }, inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.read[0].clientId, MINE);
  });

  test("a login with no client file is refused", async () => {
    const { res, calls } = await run({ principal: clientPrincipal(null) });
    assert.equal(res.statusCode, 403);
    assert.equal(calls.read.length, 0);
  });

  test("the session's client gone from the org → 404", async () => {
    const { res } = await run({ principal: clientPrincipal(), over: { read: null } });
    assert.equal(res.statusCode, 404);
  });
});

describe("POST — a client session", () => {
  test("paste: their own file, source client_paste, and no staff-only field rides along", async () => {
    const { res, calls } = await run({
      method: "POST", principal: clientPrincipal(),
      body: { action: "paste", client_id: OTHER, text: "Unfortunately we are unable to approve. Too many inquiries.", bank: "Chase",
        recon_on: "2026-10-09", declined_on: "2026-10-01", letter_document_id: DECLINE, bureaus_pulled: ["experian"] }
    });
    assert.equal(res.statusCode, 201);
    const args = calls.record[0];
    assert.equal(args.clientId, MINE);
    assert.equal(args.source, "client_paste");
    assert.deepEqual(Object.keys(args.input).sort(), ["application_id", "bank", "product", "text"]);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.analysis, "the client gets the client-safe analysis back");
  });

  test("link_letter is allowed for their own file", async () => {
    const { res, calls } = await run({ method: "POST", principal: clientPrincipal(), body: { action: "link_letter", decline_id: DECLINE, document_id: DECLINE } });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.link[0].clientId, MINE);
  });

  test("record, step, schedule and outcome are staff's — 403, and nothing is called", async () => {
    for (const action of ["record", "step", "schedule", "outcome"]) {
      const { res, calls } = await run({ method: "POST", principal: clientPrincipal(), body: { action, decline_id: DECLINE } });
      assert.equal(res.statusCode, 403, action);
      assert.equal(calls.record.length + calls.step.length + calls.schedule.length + calls.outcome.length, 0, action);
    }
  });

  test("paste with no text is 400 before anything runs", async () => {
    const { res, calls } = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "   ", bank: "Chase" } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "letter_required");
    assert.equal(calls.record.length, 0);
  });

  test("refusals come back in words: not a buyer 403, too many pastes 429", async () => {
    let r = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "x".repeat(40), bank: "Chase" }, over: { record: { ok: false, error: "not_blueprint_buyer" } } });
    assert.equal(r.res.statusCode, 403);
    assert.match(r.res.body.message, /Capital Blueprint/);
    r = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "x".repeat(40), bank: "Chase" }, over: { record: { ok: false, error: "too_many_pastes" } } });
    assert.equal(r.res.statusCode, 429);
  });

  test("an input problem keeps its status and its words", async () => {
    const { res } = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "x".repeat(40) },
      over: { recordThrows: new DeclineInputError("bank_required", "Tell us which bank sent it.") } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "bank_required");
    assert.equal(res.body.message, "Tell us which bank sent it.");
  });

  test("the raw analysis never goes back to a client — no lender-book lines, even on an odd duplicate", async () => {
    const raw = { looks_like_words: "x", reasons: [], unknown_parts: [], recon_steps: [{ key: "book:bank_relationship", who: "ops", client_step: "We check", status: "open" }],
      timing: { reapply: [] }, bank_facts: { book_notes: [{ text: "Go to your local branch and meet the RM" }], book_phones: [{ number: "844-450-1985" }] } };
    const { res } = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "x".repeat(40), bank: "Chase" },
      over: { record: { ok: true, created: false, duplicate: true, decline_id: null, analysis: raw } } });
    assert.equal(res.statusCode, 200);
    const blob = JSON.stringify(res.body);
    assert.doesNotMatch(blob, /bank_facts|book_notes|844-450-1985|local branch/);
  });

  test("the same letter again answers 200, not 201", async () => {
    const { res } = await run({ method: "POST", principal: clientPrincipal(), body: { action: "paste", text: "x".repeat(40), bank: "Chase" },
      over: { record: { ok: true, created: false, duplicate: true, decline_id: DECLINE, analysis: null } } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
  });
});

describe("staff", () => {
  test("every STAFF role reads a client in their org; lender-book lines only for LENDERS roles", async () => {
    for (const [role, book] of [["owner", true], ["admin", true], ["funding_advisor", true], ["closer", false], ["csm", false], ["sales_manager", false], ["setter", false], ["inquiry_specialist", false]]) {
      const { res, calls } = await run({ principal: staffPrincipal(role), query: { client_id: OTHER }, inOrg: [OTHER] });
      assert.equal(res.statusCode, 200, role);
      assert.deepEqual(calls.read[0].viewer, { kind: "staff", canSeeBook: book }, role);
      assert.ok(res.body.staff, role);
    }
  });

  test("a role outside STAFF is 403 and nothing is read", async () => {
    const { res, calls } = await run({ principal: staffPrincipal("viewer"), query: { client_id: MINE } });
    assert.equal(res.statusCode, 403);
    assert.equal(calls.read.length, 0);
  });

  test("no client_id is 400; a client in another org is 404, not 403", async () => {
    let r = await run({ principal: staffPrincipal("owner") });
    assert.equal(r.res.statusCode, 400);
    r = await run({ principal: staffPrincipal("owner"), query: { client_id: OTHER }, inOrg: [MINE] });
    assert.equal(r.res.statusCode, 404);
    assert.equal(r.calls.read.length, 0);
  });

  test("record passes the staff fields and the staff member; the answer carries the staff decline", async () => {
    const { res, calls } = await run({
      method: "POST", principal: staffPrincipal("funding_advisor"), inOrg: [OTHER],
      body: { action: "record", client_id: OTHER, application_id: DECLINE, declined_on: "2026-10-02", bureaus_pulled: ["experian"], recon_on: "2026-10-09", text: "letter" }
    });
    assert.equal(res.statusCode, 201);
    const args = calls.record[0];
    assert.equal(args.source, "staff");
    assert.equal(args.clientId, OTHER);
    assert.equal(args.input.recon_on, "2026-10-09");
    assert.equal(args.staff.name, "Dana");
    assert.equal(res.body.decline.id, DECLINE);
    assert.equal(res.body.task_created, true);
  });

  test("step, schedule and outcome reach the store with the decline and the staff member", async () => {
    let r = await run({ method: "POST", principal: staffPrincipal("csm"), inOrg: [OTHER], body: { action: "step", client_id: OTHER, decline_id: DECLINE, step_key: "call_recon", status: "done" } });
    assert.equal(r.res.statusCode, 200);
    assert.equal(r.calls.step[0].stepKey, "call_recon");
    r = await run({ method: "POST", principal: staffPrincipal("csm"), inOrg: [OTHER], body: { action: "schedule", client_id: OTHER, decline_id: DECLINE, recon_on: "2026-10-12" } });
    assert.equal(r.calls.schedule[0].reconOn, "2026-10-12");
    r = await run({ method: "POST", principal: staffPrincipal("owner"), inOrg: [OTHER], body: { action: "outcome", client_id: OTHER, decline_id: DECLINE, outcome: "still_declined" } });
    assert.equal(r.res.statusCode, 200);
    assert.equal(r.calls.outcome[0].outcome, "still_declined");
    assert.equal(r.calls.outcome[0].staff.name, "Dana");
  });

  test("an unknown action is 400", async () => {
    const { res } = await run({ method: "POST", principal: staffPrincipal("owner"), inOrg: [OTHER], body: { action: "delete", client_id: OTHER } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
  });
});

describe("the door", () => {
  test("no session is 401; an affiliate or partner is 403", async () => {
    let { res } = await run({ principal: null });
    assert.equal(res.statusCode, 401);
    for (const kind of ["affiliate", "partner"]) {
      ({ res } = await run({ principal: { kind, orgId: ORG } }));
      assert.equal(res.statusCode, 403, kind);
    }
  });

  test("405 on PUT and DELETE", async () => {
    for (const method of ["PUT", "DELETE"]) {
      const { res } = await run({ method, principal: clientPrincipal() });
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.allow, "GET, POST");
    }
  });

  test("a body that is not JSON is 400", async () => {
    const { res } = await run({ method: "POST", principal: clientPrincipal(), body: "{not json" });
    assert.equal(res.statusCode, 400);
  });

  test("a database that does not answer is a 503, not a crash", async () => {
    const down = new Error("connect ECONNREFUSED");
    down.code = "ECONNREFUSED";
    const { deps } = stubs();
    deps.readDeclines = async () => { throw down; };
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()), ...deps });
    assert.equal(res.statusCode, 503);
  });

  test("routed, and watched by pulse", () => {
    assert.equal(ROUTES["blueprint/declines"], handler);
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"blueprint\/declines"/);
  });

  test("the client page is a watched desk file, has no staff sidebar, and is on the money-page lists", () => {
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"money-declines\.html"/);
    const nav = readFileSync(new URL("./app-nav-matches-shell.test.mjs", import.meta.url), "utf8");
    assert.match(nav, /"money-declines\.html"/);
    const shell = readFileSync(new URL("../../public/app/shell.js", import.meta.url), "utf8");
    assert.match(shell.match(/var STAFF_MONEY = \[[\s\S]*?\];/)[0], /"money-declines\.html"/);
  });
});
