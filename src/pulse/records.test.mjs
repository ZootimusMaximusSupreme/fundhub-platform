// src/pulse/records.mjs — each function's SQL shape against a fake client, and "never throws".
//
// A fake client that answers any SQL with canned rows proves nothing about the SQL. So this file proves two other
// things: (1) what each function SENDS (one statement, the right verb, the right table, the right parameters, no
// delete, no transaction), and (2) what it does when the client breaks (returns { ok:false }, never throws).
// The SQL itself was run read-only against the real database (see the board manifest), and the behaviour against
// a real Postgres is src/pulse/pulse-records.pg.test.mjs (CI).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as rec from "./records.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const RUN = "0f0f0f0f-0000-4000-8000-000000000001";
const INC = "0f0f0f0f-0000-4000-8000-000000000002";
const LENDER = "0f0f0f0f-0000-4000-8000-000000000003";
const HASH = "a".repeat(64);

/** A client that records every call and answers with `answer(sql, params)`. */
function fake(answer = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return answer(sql, params); } };
}
const throwing = (err = new Error("connection terminated")) => ({ query: async () => { throw err; } });
const syncThrowing = () => ({ query: () => { throw new Error("sync boom"); } });

const ALL_SQL = Object.entries(rec).filter(([k, v]) => k.startsWith("SQL_") && typeof v === "string");

describe("the SQL the module can send", () => {
  test("there is a statement for every function that talks to the database", () => {
    assert.equal(ALL_SQL.length, 12);
  });

  for (const [name, sql] of ALL_SQL) {
    test(`${name} is one statement with no delete, truncate, transaction, lock or sleep`, () => {
      assert.equal(sql.includes(";"), false, "a second statement could ride behind a semicolon");
      assert.match(sql, /^\s*(SELECT|INSERT|UPDATE)\b/);
      assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|LISTEN|NOTIFY|COPY)\b/i);
      assert.doesNotMatch(sql, /pg_advisory|pg_sleep|set_config|nextval|dblink|\blo_/i);
    });

    test(`${name} touches only pulse_* tables (and orgs for the default-org read)`, () => {
      const tables = [...sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase())
        .filter((t) => !["unnest", "jsonb_to_recordset", "lateral", "set"].includes(t));
      for (const t of tables) assert.match(t, /^(pulse_beats|pulse_incidents|pulse_bank_links|orgs)$/, `${name} reads or writes ${t}`);
    });
  }

  test("the module imports nothing: no database module, no fetch, no sender", () => {
    const src = fs.readFileSync(path.join(HERE, "records.mjs"), "utf8");
    assert.doesNotMatch(src, /^\s*import\s/m);
    assert.doesNotMatch(src, /\bfetch\s*\(|process\.env|require\(/);
  });
});

describe("no function throws, whatever the client does", () => {
  const calls = [
    ["defaultOrgId", (d) => rec.defaultOrgId(d)],
    ["writeBeatResults", (d) => rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [{ beatId: "a-beat", ok: true }] })],
    ["lastResults", (d) => rec.lastResults(d, { orgId: ORG, beatIds: ["a-beat"] })],
    ["last24", (d) => rec.last24(d, { orgId: ORG, beatId: "a-beat" })],
    ["listOpenIncidents", (d) => rec.listOpenIncidents(d, ORG)],
    ["openIncident", (d) => rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "s", detail: "d" })],
    ["claimAlert", (d) => rec.claimAlert(d, INC)],
    ["setIssue", (d) => rec.setIssue(d, INC, { number: 3, url: "https://github.com/o/r/issues/3" })],
    ["setFixer", (d) => rec.setFixer(d, INC, { fixerStatus: "capped" })],
    ["closeIncident", (d) => rec.closeIncident(d, INC, { closedBy: "auto" })],
    ["loadBankLinks", (d) => rec.loadBankLinks(d, ORG)],
    ["upsertBankLinks", (d) => rec.upsertBankLinks(d, { orgId: ORG, rows: [{ urlHash: HASH, host: "x.com" }] })]
  ];
  for (const [name, call] of calls) {
    test(`${name}: a rejected query comes back as { ok:false, error }`, async () => {
      const r = await call(throwing());
      assert.equal(r.ok, false);
      assert.equal(typeof r.error, "string");
      assert.match(r.error, /connection terminated/);
    });
    test(`${name}: a query that throws before it returns a promise is caught too`, async () => {
      const r = await call(syncThrowing());
      assert.equal(r.ok, false);
      assert.match(r.error, /sync boom/);
    });
    test(`${name}: no client at all comes back as { ok:false }`, async () => {
      for (const bad of [null, undefined, {}, { query: 5 }]) {
        const r = await call(bad);
        assert.equal(r.ok, false);
        assert.match(r.error, /no database handle/);
      }
    });
  }

  test("a database URL inside an error is stripped, and the message is cut to 300 characters", async () => {
    const r = await rec.defaultOrgId(throwing(new Error("could not connect to postgresql://user:secret@host:6543/db?sslmode=require " + "x".repeat(500))));
    assert.doesNotMatch(r.error, /secret|postgresql:\/\//);
    assert.match(r.error, /\[database url\]/);
    assert.ok(r.error.length <= 300);
  });

  test("a non-Error rejection is handled", async () => {
    for (const odd of ["just a string", null, undefined, 42, { code: "X" }]) {
      const r = await rec.defaultOrgId({ query: async () => { throw odd; } });
      assert.equal(r.ok, false);
      assert.equal(typeof r.error, "string");
    }
  });

  test("a missing table is flagged so the runner can say 'migration not applied'", async () => {
    const e = Object.assign(new Error('relation "pulse_beats" does not exist'), { code: "42P01" });
    for (const r of [
      await rec.writeBeatResults(throwing(e), { orgId: ORG, runId: RUN, results: [{ beatId: "a-beat", ok: true }] }),
      await rec.lastResults(throwing(e), { orgId: ORG, beatIds: ["a-beat"] }),
      await rec.listOpenIncidents(throwing(e), ORG),
      await rec.loadBankLinks(throwing(e), ORG),
      await rec.upsertBankLinks(throwing(e), { orgId: ORG, rows: [{ urlHash: HASH, host: "x.com" }] })
    ]) {
      assert.equal(r.ok, false);
      assert.equal(r.missingTable, true);
    }
    assert.equal(rec.isMissingTable(new Error("deadlock detected")), false);
  });
});

describe("defaultOrgId", () => {
  test("reads the default org and returns its id", async () => {
    const d = fake(() => ({ rows: [{ id: ORG }] }));
    assert.deepEqual(await rec.defaultOrgId(d), { ok: true, orgId: ORG, error: null });
    assert.equal(d.calls.length, 1);
    assert.match(d.calls[0].sql, /FROM orgs WHERE is_default/);
  });
  test("no default org is a failure, not a null that looks like success", async () => {
    const r = await rec.defaultOrgId(fake());
    assert.equal(r.ok, false);
    assert.equal(r.orgId, null);
  });
});

describe("writeBeatResults", () => {
  const green = { beatId: "pay-webhook", ok: true, step: "done", detail: "fine", ms: 120, steps: [{ name: "secret-present", ms: 3, ok: true }] };
  const red = { beatId: "apply-links", ok: false, step: "fetch", detail: "answered 500", ms: null };

  test("sends ONE insert for all results, with org, run and the rows as JSON", async () => {
    const d = fake(() => ({ rows: [], rowCount: 2 }));
    const r = await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [green, red] });
    assert.deepEqual([r.ok, r.written, r.skipped], [true, 2, 0]);
    assert.equal(d.calls.length, 1);
    const { sql, params } = d.calls[0];
    assert.match(sql, /^INSERT INTO pulse_beats/);
    assert.match(sql, /ON CONFLICT \(run_id, beat_id\) DO NOTHING/);
    assert.equal(params[0], ORG);
    assert.equal(params[1], RUN);
    const rows = JSON.parse(params[2]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { beat_id: "pay-webhook", ok: true, step: "done", detail: "fine", duration_ms: 120, steps: [{ name: "secret-present", ok: true, ms: 3 }] });
  });

  test("an unmeasured time is left out of the row (NULL), never written as 0", async () => {
    const d = fake();
    await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [red, { beatId: "x-beat", ok: true, ms: undefined }, { beatId: "y-beat", ok: true, ms: -5 }, { beatId: "z-beat", ok: true, ms: "nope" }] });
    const rows = JSON.parse(d.calls[0].params[2]);
    for (const r of rows) assert.equal("duration_ms" in r, false, `${r.beat_id} got a duration`);
  });

  test("a real 0 ms is kept as 0 (it WAS measured), and fractions round", async () => {
    const d = fake();
    await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [{ beatId: "x-beat", ok: true, ms: 0 }, { beatId: "y-beat", ok: true, durationMs: 41.6 }] });
    const rows = JSON.parse(d.calls[0].params[2]);
    assert.equal(rows[0].duration_ms, 0);
    assert.equal(rows[1].duration_ms, 42);
  });

  test("a red result with no step or detail still saves (475 would refuse the whole batch otherwise)", async () => {
    const d = fake();
    await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [{ beatId: "x-beat", ok: false }, { beatId: "y-beat", ok: false, step: "  ", detail: "" }] });
    for (const r of JSON.parse(d.calls[0].params[2])) {
      assert.ok(r.step && r.detail, "red row without where and why");
    }
  });

  test("long text is cut to the column limits so one long string cannot fail the batch", async () => {
    const d = fake();
    await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [{ beatId: "x-beat", ok: false, step: "s".repeat(500), detail: "d".repeat(5000) }] });
    const [r] = JSON.parse(d.calls[0].params[2]);
    assert.equal(r.step.length, 120);
    assert.equal(r.detail.length, 2000);
  });

  test("steps are kept small: names cut, at most 40, total under the 8,000 byte CHECK", async () => {
    const steps = Array.from({ length: 80 }, (_, i) => ({ name: "n".repeat(200) + i, ms: i, ok: true }));
    const d = fake();
    await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [{ beatId: "x-beat", ok: true, steps }] });
    const [r] = JSON.parse(d.calls[0].params[2]);
    assert.ok(r.steps.length <= 40);
    assert.ok(r.steps.every((s) => s.name.length <= 60));
    assert.ok(JSON.stringify(r.steps).length <= 6000);
  });

  test("a result with a bad beat id is skipped and counted, the rest still save", async () => {
    const d = fake(() => ({ rows: [], rowCount: 1 }));
    const r = await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [green, { beatId: "Bad Id", ok: true }, null, { ok: true }] });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 3);
    assert.equal(JSON.parse(d.calls[0].params[2]).length, 1);
  });

  test("nothing to save makes no query", async () => {
    const d = fake();
    assert.deepEqual(await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results: [] }), { ok: true, written: 0, skipped: 0, error: null });
    assert.equal(d.calls.length, 0);
  });

  test("more than 100 results are cut and the cut is counted", async () => {
    const d = fake(() => ({ rows: [], rowCount: 100 }));
    const results = Array.from({ length: 130 }, (_, i) => ({ beatId: `b-${i}`, ok: true }));
    const r = await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results });
    assert.equal(JSON.parse(d.calls[0].params[2]).length, 100);
    assert.equal(r.skipped, 30);
  });

  test("a bad org, run or results argument is refused before any query", async () => {
    const d = fake();
    for (const bad of [{ orgId: "x", runId: RUN, results: [] }, { orgId: ORG, runId: "x", results: [] }, { orgId: ORG, runId: RUN, results: "no" }, undefined]) {
      assert.equal((await rec.writeBeatResults(d, bad)).ok, false);
    }
    assert.equal(d.calls.length, 0);
  });

  test("a retried run writes nothing twice: the database says 0 rows and that is reported, not hidden", async () => {
    const r = await rec.writeBeatResults(fake(() => ({ rows: [], rowCount: 0 })), { orgId: ORG, runId: RUN, results: [green] });
    assert.deepEqual([r.ok, r.written], [true, 0]);
  });
});

describe("lastResults", () => {
  test("one statement, newest 2 per beat, beat ids de-duplicated and checked", async () => {
    const d = fake(() => ({ rows: [{ beat_id: "a-beat", ok: false }] }));
    const r = await rec.lastResults(d, { orgId: ORG, beatIds: ["a-beat", "a-beat", "b-beat", "Not Valid", 7] });
    assert.deepEqual(r, { ok: true, rows: [{ beat_id: "a-beat", ok: false }], error: null });
    assert.equal(d.calls.length, 1);
    assert.match(d.calls[0].sql, /LIMIT 2/);
    assert.match(d.calls[0].sql, /ORDER BY p\.ran_at DESC/);
    assert.match(d.calls[0].sql, /p\.org_id = \$1::uuid/);
    assert.deepEqual(d.calls[0].params, [ORG, ["a-beat", "b-beat"]]);
  });
  test("no beat ids makes no query", async () => {
    const d = fake();
    assert.deepEqual(await rec.lastResults(d, { orgId: ORG, beatIds: [] }), { ok: true, rows: [], error: null });
    assert.equal(d.calls.length, 0);
  });
  test("a failed read returns rows:[] and ok:false so the runner knows NOT to damp", async () => {
    const r = await rec.lastResults(throwing(), { orgId: ORG, beatIds: ["a-beat"] });
    assert.deepEqual([r.ok, r.rows], [false, []]);
  });
});

describe("last24", () => {
  test("reads one beat's last 24 hours, newest first, capped", async () => {
    const d = fake(() => ({ rows: [{ ok: true }] }));
    const r = await rec.last24(d, { orgId: ORG, beatId: "a-beat" });
    assert.equal(r.ok, true);
    assert.match(d.calls[0].sql, /interval '24 hours'/);
    assert.match(d.calls[0].sql, /ORDER BY ran_at DESC\s+LIMIT 30/);
    assert.deepEqual(d.calls[0].params, [ORG, "a-beat"]);
  });
  test("a bad beat id is refused before any query", async () => {
    const d = fake();
    assert.equal((await rec.last24(d, { orgId: ORG, beatId: "Bad" })).ok, false);
    assert.equal(d.calls.length, 0);
  });
});

describe("incidents", () => {
  test("listOpenIncidents reads only this org's OPEN rows", async () => {
    const d = fake(() => ({ rows: [{ id: INC, beat_id: "a-beat" }] }));
    const r = await rec.listOpenIncidents(d, ORG);
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 1);
    assert.match(d.calls[0].sql, /org_id = \$1::uuid AND closed_at IS NULL/);
    assert.deepEqual(d.calls[0].params, [ORG]);
  });

  test("openIncident: insert ... ON CONFLICT (org_id, beat_id) WHERE closed_at IS NULL DO NOTHING; a row back = won", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    const r = await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "fetch", detail: "answered 500" });
    assert.deepEqual(r, { ok: true, id: INC, won: true, error: null });
    assert.match(d.calls[0].sql, /ON CONFLICT \(org_id, beat_id\) WHERE closed_at IS NULL DO NOTHING/);
    assert.match(d.calls[0].sql, /RETURNING id/);
    assert.deepEqual(d.calls[0].params, [ORG, "a-beat", RUN, "fetch", "answered 500", null, null]);
  });

  test("openIncident: no row back = another run already owns the break (won:false, ok:true)", async () => {
    const r = await rec.openIncident(fake(), { orgId: ORG, beatId: "a-beat", runId: RUN, step: "s", detail: "d" });
    assert.deepEqual(r, { ok: true, id: null, won: false, error: null });
  });

  test("openIncident: empty or long step and detail are made valid, not sent to fail the CHECK", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "", detail: "x".repeat(3000) });
    const p = d.calls[0].params;
    assert.equal(p[3], "unknown");
    assert.equal(p[4].length, 2000);
    await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN });
    assert.equal(d.calls[1].params[3], "unknown");
    assert.equal(d.calls[1].params[4], "(no detail)");
  });

  test("openIncident: an issue goes in as number AND url together, or is refused", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "s", detail: "d", issue: { number: 12, url: "https://github.com/o/r/issues/12" } });
    assert.deepEqual(d.calls[0].params.slice(5), [12, "https://github.com/o/r/issues/12"]);
    for (const issue of [{ number: 12 }, { url: "https://github.com/o/r/issues/12" }, { number: 0, url: "https://github.com/o/r/issues/0" }, { number: 1, url: "https://evil.com/o/r/issues/1" }]) {
      assert.equal((await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "s", detail: "d", issue })).ok, false);
    }
    assert.equal(d.calls.length, 1);
  });

  test("openIncident: bad ids are refused before any query", async () => {
    const d = fake();
    for (const bad of [{ orgId: "x", beatId: "a-beat", runId: RUN }, { orgId: ORG, beatId: "A", runId: RUN }, { orgId: ORG, runId: RUN }, { orgId: ORG, beatId: 7, runId: RUN }, { orgId: ORG, beatId: "a-beat", runId: "x" }]) {
      assert.equal((await rec.openIncident(d, bad)).ok, false);
    }
    assert.equal(d.calls.length, 0);
  });

  test("claimAlert: only an OPEN incident, only if none was claimed in the last 50 minutes, bumps the count", async () => {
    const won = fake(() => ({ rows: [{ id: INC, alerts_sent: 2 }] }));
    assert.deepEqual(await rec.claimAlert(won, INC), { ok: true, claimed: true, alertsSent: 2, error: null });
    const { sql, params } = won.calls[0];
    assert.match(sql, /SET last_alert_at = now\(\), alerts_sent = alerts_sent \+ 1/);
    assert.match(sql, /closed_at IS NULL/);
    assert.match(sql, /last_alert_at IS NULL OR last_alert_at < now\(\) - interval '50 minutes'/);
    assert.deepEqual(params, [INC]);
    assert.deepEqual(await rec.claimAlert(fake(), INC), { ok: true, claimed: false, alertsSent: null, error: null });
  });

  test("claimAlert: a bad id is refused", async () => {
    const d = fake();
    assert.equal((await rec.claimAlert(d, "nope")).ok, false);
    assert.equal(d.calls.length, 0);
  });

  test("setIssue: number and url set together; fixer status optional and checked", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    const url = "https://github.com/o/r/issues/9";
    assert.equal((await rec.setIssue(d, INC, { number: 9, url, fixerStatus: "dispatched" })).ok, true);
    assert.deepEqual(d.calls[0].params, [INC, 9, url, "dispatched"]);
    assert.equal((await rec.setIssue(d, INC, { number: 9, url })).ok, true);
    assert.equal(d.calls[1].params[3], null);
    for (const bad of [{ number: 0, url }, { number: 9, url: "http://github.com/o/r/issues/9" }, { number: 9, url, fixerStatus: "nope" }, { number: 1.5, url }, {}]) {
      assert.equal((await rec.setIssue(d, INC, bad)).ok, false);
    }
    assert.equal(d.calls.length, 2);
  });

  test("setFixer: status and session link are optional, checked, and never blanked", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    assert.equal((await rec.setFixer(d, INC, { fixerStatus: "session_started", sessionUrl: "https://claude.ai/code/abc" })).ok, true);
    assert.deepEqual(d.calls[0].params, [INC, "session_started", "https://claude.ai/code/abc"]);
    assert.match(d.calls[0].sql, /COALESCE\(\$2, fixer_status\)/);
    assert.match(d.calls[0].sql, /COALESCE\(\$3, claude_session_url\)/);
    for (const bad of [{}, { fixerStatus: "nope" }, { sessionUrl: "https://evil.example/x" }, { sessionUrl: "https://claude.ai/a b" }, { sessionUrl: "https://claude.ai/" + "x".repeat(600) }]) {
      assert.equal((await rec.setFixer(d, INC, bad)).ok, false);
    }
    assert.equal(d.calls.length, 1);
  });

  test("closeIncident auto: the four learning fields stay NULL, even if a lesson is passed", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    const r = await rec.closeIncident(d, INC, { closedBy: "auto", lesson: { cause_category: "code_bug", cause_note: "n", fix_summary: "f", guard_added: "g" } });
    assert.deepEqual(r, { ok: true, closed: true, error: null });
    assert.deepEqual(d.calls[0].params, [INC, "auto", null, null, null, null]);
    assert.match(d.calls[0].sql, /WHERE id = \$1::uuid AND closed_at IS NULL/);
    assert.match(d.calls[0].sql, /closed_at = now\(\)/);
  });

  test("closeIncident claude / chris: all four fields are sent", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    const lesson = { cause_category: "vendor_changed", cause_note: "Bank moved the page", fix_summary: "Updated the link list", guard_added: "none: a vendor change" };
    for (const by of ["claude", "chris"]) assert.equal((await rec.closeIncident(d, INC, { closedBy: by, lesson })).ok, true);
    assert.deepEqual(d.calls[1].params, [INC, "chris", "vendor_changed", "Bank moved the page", "Updated the link list", "none: a vendor change"]);
  });

  test("closeIncident claude / chris with a missing, blank or unknown field is refused with no query", async () => {
    const d = fake();
    const ok = { cause_category: "code_bug", cause_note: "n", fix_summary: "f", guard_added: "g" };
    const bads = [undefined, null, {}, { ...ok, cause_category: "made_up" }, { ...ok, cause_category: null }, { ...ok, cause_note: "  " },
      { ...ok, fix_summary: "" }, { ...ok, guard_added: undefined }];
    for (const lesson of bads) {
      assert.equal((await rec.closeIncident(d, INC, { closedBy: "claude", lesson })).ok, false);
      assert.equal((await rec.closeIncident(d, INC, { closedBy: "chris", lesson })).ok, false);
    }
    assert.equal((await rec.closeIncident(d, INC, { closedBy: "robot", lesson: ok })).ok, false);
    assert.equal((await rec.closeIncident(d, INC, {})).ok, false);
    assert.equal(d.calls.length, 0);
  });

  test("closing an incident that is already closed is ok:true, closed:false", async () => {
    assert.deepEqual(await rec.closeIncident(fake(), INC, { closedBy: "auto" }), { ok: true, closed: false, error: null });
  });
});

describe("bank links", () => {
  const dbRow = {
    url_hash: HASH, host: "bank.example", lender_ids: [LENDER], first_seen_at: new Date("2026-10-01T00:00:00Z"),
    last_checked_at: new Date("2026-10-09T07:00:00Z"), last_class: "OK", last_status: 200, last_detail: null,
    last_good_at: new Date("2026-10-09T07:00:00Z"), fail_streak: 0, final_host: "apply.bank.example"
  };

  test("loadBankLinks: one select, this org, never-checked first, mapped to the delta-13 shape", async () => {
    const d = fake(() => ({ rows: [dbRow] }));
    const r = await rec.loadBankLinks(d, ORG);
    assert.equal(r.ok, true);
    assert.match(d.calls[0].sql, /^SELECT/);
    assert.match(d.calls[0].sql, /ORDER BY last_checked_at NULLS FIRST/);
    assert.deepEqual(d.calls[0].params, [ORG]);
    assert.deepEqual(r.rows[0], {
      urlHash: HASH, lenderId: LENDER, lenderIds: [LENDER], host: "bank.example",
      firstSeenAt: "2026-10-01T00:00:00.000Z", lastCheckedAt: "2026-10-09T07:00:00.000Z", lastGoodAt: "2026-10-09T07:00:00.000Z",
      lastClass: "OK", lastStatus: 200, lastDetail: null, failStreak: 0, finalHost: "apply.bank.example", lastHost: "apply.bank.example"
    });
  });

  test("loadBankLinks: a never-checked row has null times and class, a zero streak, and lastHost falls back to host", async () => {
    const d = fake(() => ({ rows: [{ url_hash: HASH, host: "new.example", lender_ids: [], last_checked_at: null, last_class: null, last_status: null, last_good_at: null, fail_streak: 0, final_host: null }] }));
    const [row] = (await rec.loadBankLinks(d, ORG)).rows;
    assert.deepEqual([row.lastCheckedAt, row.lastGoodAt, row.lastClass, row.lastStatus, row.lenderId, row.lastHost], [null, null, null, null, null, "new.example"]);
  });

  test("loadBankLinks: a missing table is { ok:false, rows:[] }", async () => {
    const r = await rec.loadBankLinks(throwing(Object.assign(new Error("relation does not exist"), { code: "42P01" })), ORG);
    assert.deepEqual([r.ok, r.rows, r.missingTable], [false, [], true]);
  });

  test("upsertBankLinks: ONE insert ... ON CONFLICT (org_id, url_hash) DO UPDATE for all rows, as JSON", async () => {
    const d = fake(() => ({ rows: [], rowCount: 2 }));
    const r = await rec.upsertBankLinks(d, { orgId: ORG, rows: [
      { urlHash: HASH, lenderId: LENDER, lastHost: "apply.bank.example", host: "bank.example", lastCheckedAt: "2026-10-09T07:00:00Z", lastGoodAt: new Date("2026-10-09T07:00:00Z"), lastClass: "OK", lastStatus: 200 },
      { urlHash: "b".repeat(64), host: "other.example" }
    ] });
    assert.deepEqual([r.ok, r.written, r.skipped], [true, 2, 0]);
    assert.equal(d.calls.length, 1);
    assert.match(d.calls[0].sql, /^INSERT INTO pulse_bank_links/);
    assert.match(d.calls[0].sql, /ON CONFLICT \(org_id, url_hash\) DO UPDATE/);
    assert.equal(d.calls[0].params[0], ORG);
    const rows = JSON.parse(d.calls[0].params[1]);
    assert.deepEqual(rows[0], {
      url_hash: HASH, host: "bank.example", lender_ids: [LENDER], last_checked_at: "2026-10-09T07:00:00.000Z",
      last_class: "OK", last_status: 200, last_good_at: "2026-10-09T07:00:00.000Z", final_host: "apply.bank.example"
    });
    assert.deepEqual(rows[1], { url_hash: "b".repeat(64), host: "other.example", lender_ids: [] });
  });

  test("upsertBankLinks: the statement keeps a good time and old results the new row left empty", () => {
    const sql = rec.SQL_UPSERT_BANK_LINKS;
    assert.match(sql, /last_good_at\s+=\s+GREATEST\(b\.last_good_at, EXCLUDED\.last_good_at\)/);
    assert.match(sql, /last_checked_at = COALESCE\(EXCLUDED\.last_checked_at, b\.last_checked_at\)/);
    assert.match(sql, /last_class\s+=\s+COALESCE\(EXCLUDED\.last_class, b\.last_class\)/);
    assert.match(sql, /WHEN EXCLUDED\.last_class = 'OK' THEN 0\s+ELSE b\.fail_streak \+ 1/);
    assert.match(sql, /CASE WHEN cardinality\(EXCLUDED\.lender_ids\) > 0 THEN EXCLUDED\.lender_ids ELSE b\.lender_ids END/);
    assert.doesNotMatch(sql, /first_seen_at\s*=/, "first_seen_at must survive an update");
  });

  test("upsertBankLinks: bad rows are skipped and counted; the rest are saved", async () => {
    const d = fake(() => ({ rows: [], rowCount: 1 }));
    const r = await rec.upsertBankLinks(d, { orgId: ORG, rows: [
      { urlHash: HASH, host: "ok.example" },
      { urlHash: "short", host: "x" },
      { urlHash: "c".repeat(64) },
      null,
      "text"
    ] });
    assert.deepEqual([r.ok, r.written, r.skipped], [true, 1, 4]);
    assert.equal(JSON.parse(d.calls[0].params[1]).length, 1);
  });

  test("upsertBankLinks: bad values are dropped from the row, not sent to fail the CHECK", async () => {
    const d = fake();
    await rec.upsertBankLinks(d, { orgId: ORG, rows: [{
      urlHash: HASH.toUpperCase(), host: "x.example", lenderIds: [LENDER, "not-a-uuid", LENDER.toUpperCase()],
      lastClass: "MAYBE", lastStatus: 1000, lastCheckedAt: "yesterday-ish", lastDetail: "d".repeat(500), finalHost: "h".repeat(400)
    }] });
    const [row] = JSON.parse(d.calls[0].params[1]);
    assert.equal(row.url_hash, HASH);
    assert.deepEqual(row.lender_ids, [LENDER]);
    for (const k of ["last_class", "last_status", "last_checked_at"]) assert.equal(k in row, false, `${k} should have been dropped`);
    assert.equal(row.last_detail.length, 300);
    assert.equal(row.final_host.length, 255);
  });

  test("upsertBankLinks: the same URL twice in one batch is sent once (the last wins) so the statement cannot fail", async () => {
    const d = fake();
    await rec.upsertBankLinks(d, { orgId: ORG, rows: [{ urlHash: HASH, host: "a.example", lastClass: "OK" }, { urlHash: HASH, host: "a.example", lastClass: "HARD" }] });
    const rows = JSON.parse(d.calls[0].params[1]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].last_class, "HARD");
  });

  test("upsertBankLinks: nothing valid makes no query; more than 500 rows are cut and counted", async () => {
    const d = fake(() => ({ rows: [], rowCount: 500 }));
    assert.deepEqual(await rec.upsertBankLinks(d, { orgId: ORG, rows: [] }), { ok: true, written: 0, skipped: 0, error: null });
    assert.equal(d.calls.length, 0);
    const rows = Array.from({ length: 520 }, (_, i) => ({ urlHash: i.toString(16).padStart(64, "0"), host: "x.example" }));
    const r = await rec.upsertBankLinks(d, { orgId: ORG, rows });
    assert.equal(JSON.parse(d.calls[0].params[1]).length, 500);
    assert.equal(r.skipped, 20);
  });

  test("upsertBankLinks: a bad org or rows argument is refused", async () => {
    const d = fake();
    assert.equal((await rec.upsertBankLinks(d, { orgId: "x", rows: [] })).ok, false);
    assert.equal((await rec.upsertBankLinks(d, { orgId: ORG, rows: "no" })).ok, false);
    assert.equal(d.calls.length, 0);
  });

  test("upsertBankLinks does not change the rows the caller passed in", async () => {
    const wanted = [LENDER];
    const input = { urlHash: HASH, host: "x.example", lenderIds: wanted, lenderId: "0f0f0f0f-0000-4000-8000-000000000009" };
    await rec.upsertBankLinks(fake(), { orgId: ORG, rows: [input] });
    assert.deepEqual(wanted, [LENDER]);
  });
});

/*
 * One bad row must not fail the whole multi-row statement. Each case below was run read-only against the real
 * database in its OLD (unguarded) form and Postgres refused the entire statement:
 *   a NUL            -> "unsupported Unicode escape sequence"
 *   a lone surrogate -> "invalid input syntax for type json"   (an emoji split by a cut makes one)
 *   a 1e12 duration  -> 'value "1000000000000" is out of range for type integer'
 *   40 emoji steps   -> 11,688 bytes against the 8,000 byte CHECK on steps
 * The fake client cannot prove the database accepts the fix; it proves what is SENT. The database half is
 * src/pulse/pulse-records.pg.test.mjs (CI) and the read-only run noted on the board.
 */
describe("one bad row cannot fail the batch", () => {
  const sent = async (results) => {
    const d = fake(() => ({ rows: [], rowCount: results.length }));
    const r = await rec.writeBeatResults(d, { orgId: ORG, runId: RUN, results });
    return { r, params: d.calls[0] && d.calls[0].params, rows: d.calls[0] ? JSON.parse(d.calls[0].params[2]) : [] };
  };
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  test("a NUL character is stripped from every text field, so the JSON never carries \\u0000", async () => {
    const { params, rows } = await sent([{ beatId: "x-beat", ok: false, step: "fe\u0000tch", detail: "a\u0000b", steps: [{ name: "n\u0000m", ok: true }] }]);
    assert.equal(params[2].includes("\\u0000"), false);
    assert.deepEqual([rows[0].step, rows[0].detail, rows[0].steps[0].name], ["fetch", "ab", "nm"]);
  });

  test("a lone surrogate half is stripped, and a real emoji pair is kept", async () => {
    const { params, rows } = await sent([{ beatId: "x-beat", ok: false, step: "s", detail: "hi\uD83D lo\uDE00 ok \u{1F600} pair" }]);
    assert.equal(rows[0].detail, "hi lo ok \u{1F600} pair");
    assert.equal(LONE.test(JSON.parse(params[2])[0].detail), false);
    assert.equal(/\\ud[89a-f][0-9a-f]{2}/i.test(params[2].replace(/\\ud83d\\ude00/gi, "")), false, "no escaped lone half in the JSON text");
  });

  test("a cut never splits an emoji: 1,999 letters then an emoji is cut to 1,999, not to a broken 2,000", async () => {
    const { rows } = await sent([{ beatId: "x-beat", ok: false, step: "s", detail: "x".repeat(1999) + "\u{1F600}" }]);
    assert.equal(rows[0].detail, "x".repeat(1999));
    assert.equal(LONE.test(rows[0].detail), false);
    const long = await sent([{ beatId: "x-beat", ok: false, step: "\u{1F600}".repeat(200), detail: "d" }]);
    assert.equal(LONE.test(long.rows[0].step), false);
    assert.ok(long.rows[0].step.length <= 120);
  });

  test("text that is only a NUL or only blanks counts as empty, so a red row still says 'unknown' / '(no detail)'", async () => {
    const { rows } = await sent([{ beatId: "x-beat", ok: false, step: "\u0000", detail: "\uD83D" }]);
    assert.deepEqual([rows[0].step, rows[0].detail], ["unknown", "(no detail)"]);
  });

  test("a huge duration is cut to the biggest integer (2147483647), for the beat and for each step", async () => {
    const { rows } = await sent([{ beatId: "x-beat", ok: true, ms: 1e12, steps: [{ name: "n", ms: 9e15, ok: true }] }]);
    assert.equal(rows[0].duration_ms, 2147483647);
    assert.equal(rows[0].steps[0].ms, 2147483647);
    assert.equal(rec.MAX_INT, 2147483647);
    const inf = await sent([{ beatId: "x-beat", ok: true, ms: Infinity }]);
    assert.equal("duration_ms" in inf.rows[0], false, "infinity is not a measurement");
  });

  test("a time outside what Postgres takes is dropped (ran_at falls back to now(); a link's check time stays empty)", async () => {
    const { rows } = await sent([{ beatId: "x-beat", ok: true, ranAt: new Date(8.64e15) }, { beatId: "y-beat", ok: true, ranAt: "0001-01-01" }, { beatId: "z-beat", ok: true, ranAt: "2026-10-09T07:00:00Z" }]);
    assert.deepEqual(rows.map((r) => "ran_at" in r), [false, false, true]);
    const d = fake();
    await rec.upsertBankLinks(d, { orgId: ORG, rows: [{ urlHash: HASH, host: "x.example", lastCheckedAt: new Date(8.64e15), lastGoodAt: "0001-01-01" }] });
    const [row] = JSON.parse(d.calls[0].params[1]);
    assert.deepEqual(["last_checked_at" in row, "last_good_at" in row], [false, false]);
  });

  test("steps of 4-byte characters are cut by BYTES so the 8,000 byte CHECK cannot refuse the batch", async () => {
    const steps = Array.from({ length: 40 }, (_, i) => ({ name: "\u{1F600}".repeat(30) + i, ms: 2147483647, ok: true }));
    const { rows } = await sent([{ beatId: "x-beat", ok: true, steps }]);
    const kept = rows[0].steps;
    assert.ok(kept.length >= 1 && kept.length < 40, `kept ${kept.length}`);
    // The same figure the code budgets with: 64 bytes per step plus the name's UTF-8 bytes, under 7,000.
    const cost = kept.reduce((t, s) => t + 64 + Buffer.byteLength(s.name, "utf8"), 2);
    assert.ok(cost <= 7000, `cost ${cost}`);
    // Plain steps are untouched: all 40 still go in.
    const plain = await sent([{ beatId: "x-beat", ok: true, steps: Array.from({ length: 40 }, (_, i) => ({ name: "step-" + i, ms: 5, ok: true })) }]);
    assert.equal(plain.rows[0].steps.length, 40);
  });

  test("a hostile object costs only its own row: the others still save and nothing throws", async () => {
    const boom = { toString() { throw new Error("no text"); } };
    const evil = { get beatId() { throw new Error("getter"); }, ok: true };
    const { r, rows } = await sent([
      evil,
      { beatId: "a-beat", ok: false, step: boom, detail: boom, ms: Symbol("t"), steps: [{ name: boom }, { name: "kept", ok: true }] },
      { beatId: "b-beat", ok: true }
    ]);
    assert.deepEqual([r.ok, r.skipped, rows.length], [true, 1, 2]);
    assert.deepEqual([rows[0].step, rows[0].detail, "duration_ms" in rows[0]], ["unknown", "(no detail)", false]);
    assert.deepEqual(rows[0].steps.map((s) => s.name), ["kept"]);

    const d = fake();
    const u = await rec.upsertBankLinks(d, { orgId: ORG, rows: [
      { urlHash: HASH, host: "x.example", lastStatus: Symbol("s"), lastClass: "OK" },
      { urlHash: "b".repeat(64), host: boom, lastDetail: boom },
      { urlHash: "c".repeat(64), host: "good.example" }
    ] });
    assert.deepEqual([u.ok, u.skipped], [true, 2]);
    assert.equal(JSON.parse(d.calls[0].params[1]).length, 1);
  });

  test("bank link text gets the same clean-up: a NUL in a detail or host never reaches the JSON", async () => {
    const d = fake();
    await rec.upsertBankLinks(d, { orgId: ORG, rows: [{ urlHash: HASH, host: "x\u0000.example", lastClass: "HARD", lastDetail: "no\u0000pe\uD83D" }] });
    const [row] = JSON.parse(d.calls[0].params[1]);
    assert.deepEqual([row.host, row.last_detail], ["x.example", "nope"]);
    assert.equal(d.calls[0].params[1].includes("\\u0000"), false);
  });

  test("openIncident and closeIncident clean their text too (they send it as plain parameters)", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    await rec.openIncident(d, { orgId: ORG, beatId: "a-beat", runId: RUN, step: "s\u0000", detail: "d\u0000\uD83D" });
    assert.deepEqual([d.calls[0].params[3], d.calls[0].params[4]], ["s", "d"]);
    const c = fake(() => ({ rows: [{ id: INC }] }));
    await rec.closeIncident(c, INC, { closedBy: "chris", lesson: { cause_category: "unknown", cause_note: "n\u0000", fix_summary: "f", guard_added: "g" } });
    assert.equal(c.calls[0].params[3], "n");
  });

  test("setFixer refuses a session link that holds a NUL or a lone half, and keeps no state between calls", async () => {
    const d = fake(() => ({ rows: [{ id: INC }] }));
    for (let i = 0; i < 3; i++) {
      assert.equal((await rec.setFixer(d, INC, { sessionUrl: "https://claude.ai/code/a\u0000b" })).ok, false);
      assert.equal((await rec.setFixer(d, INC, { sessionUrl: "https://claude.ai/code/a\uD83Db" })).ok, false);
      assert.equal((await rec.setFixer(d, INC, { sessionUrl: "https://claude.ai/code/abc" })).ok, true);
    }
    assert.equal(d.calls.length, 3);
  });
});

describe("an OK check is a good time (so 'was good, now dead' cannot be blinded)", () => {
  test("the insert fills last_good_at from the check time, then now(), when the caller sent none", () => {
    const sql = rec.SQL_UPSERT_BANK_LINKS;
    assert.match(sql, /CASE WHEN r\.last_class = 'OK' THEN COALESCE\(r\.last_good_at, r\.last_checked_at, now\(\)\) ELSE r\.last_good_at END/);
    // The conflict branch reads EXCLUDED, which already holds that value, and still only moves forward.
    assert.match(sql, /last_good_at\s+=\s+GREATEST\(b\.last_good_at, EXCLUDED\.last_good_at\)/);
  });

  test("only OK fills it: a failed check with no good time stays empty, so a URL never seen good cannot go red", () => {
    const sql = rec.SQL_UPSERT_BANK_LINKS;
    const fill = sql.match(/CASE WHEN ([^\n]*?) THEN COALESCE\(r\.last_good_at/);
    assert.equal(fill[1], "r.last_class = 'OK'");
    assert.doesNotMatch(sql, /last_good_at\s+=\s+COALESCE\(/);
  });

  test("the caller's own good time is never replaced: it is sent as given", async () => {
    const d = fake();
    await rec.upsertBankLinks(d, { orgId: ORG, rows: [{ urlHash: HASH, host: "x.example", lastClass: "OK", lastCheckedAt: "2026-10-09T08:00:00Z", lastGoodAt: "2026-10-09T07:00:00Z" }, { urlHash: "b".repeat(64), host: "y.example", lastClass: "OK" }] });
    const rows = JSON.parse(d.calls[0].params[1]);
    assert.equal(rows[0].last_good_at, "2026-10-09T07:00:00.000Z");
    assert.equal("last_good_at" in rows[1], false, "the database fills this one");
  });
});
