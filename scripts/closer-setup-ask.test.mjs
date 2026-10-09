import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, EVENT_NAME, parseArgs, run } from "./closer-setup-ask.mjs";
import {
  ASK_BODY_PREFIX,
  ASK_SOURCE,
  CHECK_IDS,
  GRACE_DAYS,
  gapChecks,
  parseAskBody
} from "../src/pulse/coverage/gap-closer-setup.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "closer-setup-ask.mjs"), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const JUSTICE = "968bb01e-0079-4508-aded-8a361d54ecbb";
const SARAH = "6ccdca88-60af-4b7e-af15-28259ead4786";
const SUSPENDED = "696c85b0-72c9-4615-8d94-c0b44e66e21b";
const UNKNOWN = "00000000-0000-4000-8000-0000000000ff";
const NOW = new Date("2026-10-09T14:00:00.000Z");
const DAY = 24 * 3600e3;

const STAFF = {
  [JUSTICE]: { id: JUSTICE, name: "Justice Nikkel", role: "closer", status: "active", active: true },
  [SARAH]: { id: SARAH, name: "Sarah Blankstein", role: "sales_manager", status: "active", active: true },
  [SUSPENDED]: { id: SUSPENDED, name: "Sarah Whitfield", role: "admin", status: "suspended", active: false }
};

/* A fake db that answers by the shape of each statement and keeps every call. */
function fakeDb(opts = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      if (/FROM staff/.test(text)) return { rows: STAFF[params[0]] ? [STAFF[params[0]]] : [] };
      if (/IS NOT DISTINCT FROM/.test(text)) return { rows: opts.sameBody ? [opts.sameBody] : [] };
      if (/left\(body, char_length/.test(text)) return { rows: opts.asks || [] };
      if (/^\s*SELECT id FROM tasks/.test(text)) return { rows: [] };
      if (/INSERT INTO tasks/.test(text)) return { rows: opts.insertRows || [{ id: "new-task-id" }] };
      if (/UPDATE tasks SET due_at/.test(text)) {
        return { rows: opts.updateRows || [{ id: params[1], due_at: params[0] }] };
      }
      if (/UPDATE tasks SET done/.test(text)) return { rows: opts.closeRows || [{ id: params[0] }] };
      return { rows: [] };
    }
  };
  return db;
}

const writes = (db) => db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.text));

function openArgs(over = {}) {
  return { command: "open", staff: JUSTICE, askedAt: "2026-10-07T17:41:33Z", graceDays: null, dryRun: false, ...over };
}

function openRow(over = {}) {
  return {
    id: "ask-1",
    body: `${ASK_BODY_PREFIX}${JUSTICE}:2026-10-07T17:41:33.000Z`,
    due_at: "2026-10-10T17:41:33.000Z",
    done: false,
    ...over
  };
}

// ── arguments ─────────────────────────────────────────────────────────────────

test("parseArgs: each command, each flag, and what is wrong", () => {
  assert.deepEqual([...COMMANDS], ["open", "snooze", "close"]);
  const a = parseArgs(["open", "--staff", JUSTICE, "--asked-at", "2026-10-07T17:41:33Z", "--grace-days", "4", "--dry-run"]);
  assert.equal(a.command, "open");
  assert.equal(a.staff, JUSTICE);
  assert.equal(a.askedAt, "2026-10-07T17:41:33Z");
  assert.equal(a.graceDays, "4");
  assert.equal(a.dryRun, true);
  assert.deepEqual(a.errors, []);

  assert.equal(parseArgs(["snooze", "--staff", JUSTICE, "--days", "2"]).days, "2");
  assert.equal(parseArgs(["snooze", "--staff", JUSTICE, "--until", "2026-10-20T00:00:00Z"]).until, "2026-10-20T00:00:00Z");
  assert.equal(parseArgs(["close", "--staff", JUSTICE]).command, "close");
  assert.equal(parseArgs(["--help"]).help, true);

  assert.match(parseArgs([]).errors.join(" "), /first word/);
  assert.match(parseArgs(["nope"]).errors.join(" "), /first word/);
  assert.match(parseArgs(["open", "--bogus"]).errors.join(" "), /Unknown flag --bogus/);
  assert.match(parseArgs(["open", "--staff"]).errors.join(" "), /--staff needs a value/);
  assert.match(parseArgs(["open", "close"]).errors.join(" "), /Unexpected word/);
});

// ── open ──────────────────────────────────────────────────────────────────────

test("open wraps createTask: the spec is the owner task the lane reads", async () => {
  const db = fakeDb();
  const seen = [];
  const createTask = async (d, spec) => { seen.push({ d, spec }); return { created: true, id: "t-1", reason: null }; };
  const lines = [];
  const out = await run(openArgs(), { db, orgId: ORG, now: NOW, createTask, log: (l) => lines.push(l) });
  assert.equal(out.ok, true);
  assert.equal(out.action, "open");
  assert.equal(out.dryRun, false);
  assert.equal(out.id, "t-1");
  assert.equal(seen.length, 1);
  const { spec } = seen[0];
  assert.equal(seen[0].d, db);
  assert.equal(spec.orgId, ORG);
  assert.equal(spec.clientId, null);
  assert.equal(spec.title, "Waiting: Justice Nikkel calendar on the booking page");
  assert.equal(spec.sourceWorkflow, ASK_SOURCE);
  assert.equal(spec.sourceWorkflow, "closer-calendar-ask");
  assert.equal(spec.assigneeRole, "owner");
  assert.equal(spec.body, `closer-calendar:${JUSTICE}:2026-10-07T17:41:33.000Z`);
  assert.equal(spec.dueAt.toISOString(), "2026-10-10T17:41:33.000Z");
  assert.equal(
    spec.detail,
    `Asked by email on Oct 7, 2026. Needs: ClickFunnels invite, calendar connected, added as host on ${EVENT_NAME}.`
  );
  assert.match(lines.join("\n"), /Opened the ask for Justice Nikkel/);
});

test("open through the real createTask: one INSERT, created_at left to the database, due 3 days after the ask", async () => {
  const db = fakeDb();
  const out = await run(openArgs(), { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
  const inserts = db.calls.filter((c) => /INSERT INTO tasks/.test(c.text));
  assert.equal(inserts.length, 1);
  const [ins] = inserts;
  assert.doesNotMatch(ins.text, /created_at/);
  assert.match(ins.text, /\bdetail\b/);
  const [org, client, title, body, due, source, role, staffId, meeting, detail] = ins.params;
  assert.equal(org, ORG);
  assert.equal(client, null);
  assert.equal(title, "Waiting: Justice Nikkel calendar on the booking page");
  assert.equal(body, `closer-calendar:${JUSTICE}:2026-10-07T17:41:33.000Z`);
  assert.equal(new Date(due).getTime(), Date.parse("2026-10-07T17:41:33.000Z") + GRACE_DAYS * DAY);
  assert.equal(source, "closer-calendar-ask");
  assert.equal(role, "owner");
  assert.equal(staffId, null);
  assert.equal(meeting, null);
  assert.match(detail, /^Asked by email on Oct 7, 2026\./);
});

test("open: Sarah asked two seconds later is due two seconds later, both 3 days out", async () => {
  const a = await run(openArgs({ staff: JUSTICE, askedAt: "2026-10-07T17:41:33Z", dryRun: true }), { db: fakeDb(), orgId: ORG, now: NOW });
  const b = await run(openArgs({ staff: SARAH, askedAt: "2026-10-07T17:41:35Z", dryRun: true }), { db: fakeDb(), orgId: ORG, now: NOW });
  assert.equal(a.dueAt, "2026-10-10T17:41:33.000Z");
  assert.equal(b.dueAt, "2026-10-10T17:41:35.000Z");
  assert.equal(b.title, "Waiting: Sarah Blankstein calendar on the booking page");
});

test("open: --grace-days changes the red-after time; a bad number is refused", async () => {
  const five = await run(openArgs({ graceDays: "5", dryRun: true }), { db: fakeDb(), orgId: ORG, now: NOW });
  assert.equal(five.dueAt, "2026-10-12T17:41:33.000Z");
  for (const bad of ["0", "-1", "abc", "61"]) {
    const out = await run(openArgs({ graceDays: bad }), { db: fakeDb(), orgId: ORG, now: NOW });
    assert.equal(out.ok, false, bad);
    assert.match(out.reason, /--grace-days/);
  }
});

test("open --dry-run reads and prints, and sends no write and does not call createTask", async () => {
  const db = fakeDb();
  let called = 0;
  const lines = [];
  const out = await run(openArgs({ dryRun: true }), {
    db, orgId: ORG, now: NOW,
    createTask: async () => { called += 1; return { created: true, id: "x" }; },
    log: (l) => lines.push(l)
  });
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.equal(called, 0);
  assert.deepEqual(writes(db), []);
  assert.ok(db.calls.length >= 1);
  assert.match(lines.join("\n"), /DRY RUN\. Nothing was written/);
});

test("open refuses an unknown staff id and a staff id that is not a uuid, and writes nothing", async () => {
  const unknown = fakeDb();
  const a = await run(openArgs({ staff: UNKNOWN }), { db: unknown, orgId: ORG, now: NOW });
  assert.equal(a.ok, false);
  assert.equal(a.refused, true);
  assert.match(a.reason, /No staff row has the id/);
  assert.deepEqual(writes(unknown), []);

  const bad = fakeDb();
  const b = await run(openArgs({ staff: "justice" }), { db: bad, orgId: ORG, now: NOW });
  assert.equal(b.ok, false);
  assert.match(b.reason, /--staff must be a staff id/);
  assert.equal(bad.calls.length, 0, "a bad id is refused before any read");
});

test("open refuses a staff member who is not active, and writes nothing", async () => {
  const db = fakeDb();
  const out = await run(openArgs({ staff: SUSPENDED }), { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, false);
  assert.match(out.reason, /Sarah Whitfield is not an active staff member \(status suspended\)/);
  assert.deepEqual(writes(db), []);
});

test("open refuses a missing, unreadable or future ask time", async () => {
  const none = await run(openArgs({ askedAt: null }), { db: fakeDb(), orgId: ORG, now: NOW });
  assert.match(none.reason, /--asked-at is required/);
  const junk = await run(openArgs({ askedAt: "last Tuesday" }), { db: fakeDb(), orgId: ORG, now: NOW });
  assert.match(junk.reason, /is not a time/);
  const future = await run(openArgs({ askedAt: "2026-10-12T00:00:00Z" }), { db: fakeDb(), orgId: ORG, now: NOW });
  assert.match(future.reason, /in the future/);
});

test("open uses the IS NOT DISTINCT FROM pre-check, like the C-suite helper, and an exact repeat writes nothing", async () => {
  const db = fakeDb({ sameBody: { id: "ask-0", done: false } });
  const out = await run(openArgs(), { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, false);
  assert.match(out.reason, /already on file \(open\)/);
  assert.deepEqual(writes(db), []);
  const pre = db.calls.find((c) => /IS NOT DISTINCT FROM/.test(c.text));
  assert.ok(pre, "the pre-check ran");
  assert.deepEqual(pre.params, [null, ASK_SOURCE, `closer-calendar:${JUSTICE}:2026-10-07T17:41:33.000Z`]);

  const closed = fakeDb({ sameBody: { id: "ask-0", done: true } });
  const again = await run(openArgs(), { db: closed, orgId: ORG, now: NOW });
  assert.match(again.reason, /already on file \(closed\)/);
});

test("open refuses a second open ask for the same person and points at snooze and close", async () => {
  const db = fakeDb({ asks: [openRow({ body: `${ASK_BODY_PREFIX}${JUSTICE}:2026-10-01T00:00:00.000Z` })] });
  const out = await run(openArgs(), { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, false);
  assert.match(out.reason, /An open ask already exists for Justice Nikkel/);
  assert.match(out.reason, /snooze/);
  assert.deepEqual(writes(db), []);
  const read = db.calls.find((c) => /left\(body, char_length/.test(c.text));
  assert.deepEqual(read.params, [ORG, ASK_SOURCE, `${ASK_BODY_PREFIX}${JUSTICE}:`]);
});

test("open: a closed ask for the same person does not block a new one", async () => {
  const db = fakeDb({ asks: [openRow({ done: true })] });
  const out = await run(openArgs({ askedAt: "2026-10-08T00:00:00Z" }), { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
});

test("open: when createTask says it was a duplicate, it is a refusal, not a pass", async () => {
  const out = await run(openArgs(), {
    db: fakeDb(), orgId: ORG, now: NOW,
    createTask: async () => ({ created: false, id: null, reason: "duplicate_race" })
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /duplicate_race/);
});

// ── the writer and the lane agree ─────────────────────────────────────────────

test("the row the writer saves is the row the lane reads: green until the due day, red after, green once a host", async () => {
  const wdb = fakeDb();
  const out = await run(openArgs({ staff: SARAH, askedAt: "2026-10-07T17:41:35Z" }), { db: wdb, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
  const ins = wdb.calls.find((c) => /INSERT INTO tasks/.test(c.text)).params;
  const row = {
    task_id: "t-9",
    body: ins[3],
    due_at: ins[4],
    created_at: NOW.toISOString(),
    staff_id: SARAH,
    staff_name: STAFF[SARAH].name,
    staff_role: STAFF[SARAH].role,
    staff_status: "active",
    staff_active: true
  };
  assert.deepEqual(parseAskBody(row.body), { staffId: SARAH, askedAt: new Date("2026-10-07T17:41:35.000Z") });

  const page = (hosts) => `<script type="application/json" data-liquid-replace="item" id="state-node-script-2">
${JSON.stringify({ event_type: { id: "1", name: EVENT_NAME, event_hosts: hosts.map((n) => ({ name: n })), selected_host: { name: hosts[0], pretty_location: "Google Meet" } } })}
</script>`;
  const lane = (now, hosts) => gapChecks({
    db: { async query() { return { rows: [row] }; } },
    orgId: ORG,
    now,
    fetchImpl: async () => ({ status: 200, async text() { return page(hosts); } }),
    env: {}
  });

  const waiting = await lane(new Date("2026-10-10T13:00:00.000Z"), ["Chris Stanbridge"]);
  assert.deepEqual(waiting.map((r) => r.id), [...CHECK_IDS]);
  assert.equal(waiting[0].status, "PASS");
  assert.match(waiting[0].detail, /Sarah Blankstein is on day 3 of 3/);

  const late = await lane(new Date("2026-10-11T13:00:00.000Z"), ["Chris Stanbridge"]);
  assert.equal(late[0].status, "FAIL");
  assert.match(late[0].detail, /Sarah Blankstein/);

  const joined = await lane(new Date("2026-10-11T13:00:00.000Z"), ["Chris Stanbridge", "Sarah Blankstein"]);
  assert.equal(joined[0].status, "PASS");
});

// ── snooze and close ──────────────────────────────────────────────────────────

test("snooze --days moves due_at to the later of the current due time and now, plus the days", async () => {
  // Not yet due: due Oct 10 17:41, now Oct 9 14:00. Two more days = Oct 12 17:41.
  const future = fakeDb({ asks: [openRow()] });
  const a = await run({ command: "snooze", staff: JUSTICE, days: "2", dryRun: false }, { db: future, orgId: ORG, now: NOW });
  assert.equal(a.ok, true);
  assert.equal(a.to, "2026-10-12T17:41:33.000Z");
  const up = future.calls.find((c) => /UPDATE tasks SET due_at/.test(c.text));
  assert.deepEqual(up.params, ["2026-10-12T17:41:33.000Z", "ask-1", ORG, ASK_SOURCE]);

  // Already late: due Oct 10, now Oct 11 13:00. Two more days = Oct 13 13:00.
  const late = fakeDb({ asks: [openRow()] });
  const b = await run(
    { command: "snooze", staff: JUSTICE, days: "2", dryRun: false },
    { db: late, orgId: ORG, now: new Date("2026-10-11T13:00:00.000Z") }
  );
  assert.equal(b.to, "2026-10-13T13:00:00.000Z");
});

test("snooze --until sets the exact time and refuses a time that is not in the future", async () => {
  const db = fakeDb({ asks: [openRow()] });
  const ok = await run({ command: "snooze", staff: JUSTICE, until: "2026-10-20T16:00:00Z", dryRun: false }, { db, orgId: ORG, now: NOW });
  assert.equal(ok.to, "2026-10-20T16:00:00.000Z");
  const past = await run({ command: "snooze", staff: JUSTICE, until: "2026-10-01T00:00:00Z", dryRun: false }, { db: fakeDb({ asks: [openRow()] }), orgId: ORG, now: NOW });
  assert.match(past.reason, /in the future/);
});

test("snooze needs exactly one of --days or --until, a sane number, and one open ask", async () => {
  const base = { command: "snooze", staff: JUSTICE, dryRun: false };
  const both = await run({ ...base, days: "1", until: "2026-10-20T00:00:00Z" }, { db: fakeDb({ asks: [openRow()] }), orgId: ORG, now: NOW });
  assert.match(both.reason, /exactly one of --days or --until/);
  const neither = await run(base, { db: fakeDb({ asks: [openRow()] }), orgId: ORG, now: NOW });
  assert.match(neither.reason, /exactly one of --days or --until/);
  for (const bad of ["0", "-2", "x", "61"]) {
    const out = await run({ ...base, days: bad }, { db: fakeDb({ asks: [openRow()] }), orgId: ORG, now: NOW });
    assert.match(out.reason, /--days must be a number/, bad);
  }
  const none = fakeDb({ asks: [] });
  const noAsk = await run({ ...base, days: "2" }, { db: none, orgId: ORG, now: NOW });
  assert.match(noAsk.reason, /no open ask/);
  assert.deepEqual(writes(none), []);
  const two = fakeDb({ asks: [openRow(), openRow({ id: "ask-2" })] });
  const many = await run({ ...base, days: "2" }, { db: two, orgId: ORG, now: NOW });
  assert.match(many.reason, /2 open asks/);
  assert.deepEqual(writes(two), []);
});

test("snooze ignores a closed ask and works for a person who is no longer active", async () => {
  const db = fakeDb({ asks: [openRow({ done: true }), openRow({ id: "ask-live", done: false })] });
  const out = await run({ command: "snooze", staff: SUSPENDED, days: "1", dryRun: false }, { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.id, "ask-live");
});

test("snooze --dry-run sends no write", async () => {
  const db = fakeDb({ asks: [openRow()] });
  const out = await run({ command: "snooze", staff: JUSTICE, days: "2", dryRun: true }, { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.deepEqual(writes(db), []);
});

test("close marks the one open ask done", async () => {
  const db = fakeDb({ asks: [openRow()] });
  const out = await run({ command: "close", staff: JUSTICE, dryRun: false }, { db, orgId: ORG, now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.action, "close");
  const up = db.calls.find((c) => /UPDATE tasks SET done = true/.test(c.text));
  assert.deepEqual(up.params, ["ask-1", ORG, ASK_SOURCE]);
  assert.equal(writes(db).length, 1);
});

test("close refuses when there is no open ask, and --dry-run sends no write", async () => {
  const none = fakeDb({ asks: [] });
  const a = await run({ command: "close", staff: JUSTICE, dryRun: false }, { db: none, orgId: ORG, now: NOW });
  assert.equal(a.ok, false);
  assert.deepEqual(writes(none), []);

  const dry = fakeDb({ asks: [openRow()] });
  const b = await run({ command: "close", staff: JUSTICE, dryRun: true }, { db: dry, orgId: ORG, now: NOW });
  assert.equal(b.ok, true);
  assert.equal(b.dryRun, true);
  assert.deepEqual(writes(dry), []);
});

test("close and snooze say so when the ask was closed while they ran", async () => {
  const closeRace = await run(
    { command: "close", staff: JUSTICE, dryRun: false },
    { db: fakeDb({ asks: [openRow()], closeRows: [] }), orgId: ORG, now: NOW }
  );
  assert.equal(closeRace.ok, false);
  const snoozeRace = await run(
    { command: "snooze", staff: JUSTICE, days: "1", dryRun: false },
    { db: fakeDb({ asks: [openRow()], updateRows: [] }), orgId: ORG, now: NOW }
  );
  assert.equal(snoozeRace.ok, false);
});

// ── the source ────────────────────────────────────────────────────────────────

test("no database, no company or an unknown command is refused before any read", async () => {
  assert.equal((await run(openArgs(), { orgId: ORG })).ok, false);
  const db = fakeDb();
  assert.equal((await run(openArgs(), { db })).ok, false);
  assert.equal((await run({ ...openArgs(), command: "delete" }, { db, orgId: ORG })).ok, false);
  assert.equal(db.calls.length, 0);
});

/* Whole-line comments and block comments are dropped before the scan, so the
   prose that explains the script does not trip the rules about its code. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("source: takes its source, prefix and wait from the lane, never deletes, never sets created_at, sends nothing", () => {
  const body = code(SRC);
  assert.ok(body.length > 2000, "the scan found the code");
  assert.match(body, /from "\.\.\/src\/pulse\/coverage\/gap-closer-setup\.mjs"/);
  assert.match(body, /from "\.\.\/src\/lib\/create-task\.mjs"/);
  assert.doesNotMatch(body, /["']closer-calendar-ask["']|["']closer-calendar:["']/, "the constants are imported, not copied");
  assert.doesNotMatch(body, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/);
  assert.doesNotMatch(body, /created_at\s*=|SET created_at/);
  assert.doesNotMatch(body, /textChris|sendSms|messaging|notify|fetch\(|fetchImpl/);
  assert.doesNotMatch(body, /INSERT INTO/, "the only insert is createTask's");
});
