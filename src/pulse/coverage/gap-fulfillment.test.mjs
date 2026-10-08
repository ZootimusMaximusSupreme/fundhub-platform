import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STAGE_SLA } from "../../repair/sla.mjs";
import {
  APPLY_BLOCKED_SQL,
  APPLY_BLOCKED_STATUSES,
  APPLY_FAIL_SESSION_STATUSES,
  CHECK_IDS,
  DESK_CLIENTS_SQL,
  DESK_PIPELINES,
  MAX_DESK_READS,
  NEXT_ACTION_SQL,
  REPAIR_QUEUE_STAGES,
  VERIFYING_STUCK_MS,
  gapChecks,
  pastDefinedWait,
  showsNextStep
} from "./gap-fulfillment.mjs";
import { CHECKS as SLICE_33 } from "./slice-33-fulfillment.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-fulfillment.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

const SHOWS = { found: true, fulfillment: { degraded: false, next_action: { key: "send_letters", label: "Send Letters" } } };
const BLANK = { found: true, fulfillment: { degraded: false, next_action: null } };
const DEGRADED = { found: true, fulfillment: { degraded: true, next_action: null } };

// A fake database that tells the three reads apart by the marker comment in each
// SQL and refuses anything that is not a SELECT. It checks the params it is given.
function fakeDb({ nextRows = [], deskRows = [], applyN = 0, throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (!/^\s*(\/\*[\s\S]*?\*\/\s*)?SELECT\b/i.test(text)) throw new Error(`write sql is not allowed: ${text}`);
      if (throwOn && text.includes(throwOn)) throw new Error(`relation ${throwOn} does not exist`);
      if (/gap:fulfillment-next-action/.test(text)) {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], Object.keys(STAGE_SLA));
        return { rows: nextRows };
      }
      if (/gap:fulfillment-desk-clients/.test(text)) {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], [...DESK_PIPELINES]);
        return { rows: deskRows };
      }
      if (/gap:fulfillment-apply-blocked/.test(text)) {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], [...APPLY_BLOCKED_STATUSES]);
        assert.deepEqual(params[2], [...APPLY_FAIL_SESSION_STATUSES]);
        assert.equal(params[3].getTime(), NOW.getTime() - VERIFYING_STUCK_MS);
        return { rows: [{ n: applyN }] };
      }
      throw new Error(`unexpected sql: ${text}`);
    }
  };
}

function stepFor(map) {
  const asked = [];
  const fn = async (db, orgId, clientId) => {
    asked.push(clientId);
    const hit = map[clientId];
    if (hit instanceof Error) throw hit;
    return hit;
  };
  fn.asked = asked;
  return fn;
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not apply to a real lender/);
    assert.match(row.suggestedFix, /Do not upload/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function iso(msBefore) {
  return new Date(NOW.getTime() - msBefore).toISOString();
}

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function late(clientId, stage = "analysis", ago = 3 * DAY, extra = {}) {
  return { id: `card-${clientId}`, client_id: clientId, stage_key: stage, entered_at: iso(ago), ...extra };
}

test("gap fulfillment: source stays read-only, makes no web call, and does not repeat the slice list", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /documents-upload|proxy\/launch|repair\/generate|repair\/send|inquiry-cases|dispute_letters/);
  assert.match(NEXT_ACTION_SQL, /^\s*\/\* gap:fulfillment-next-action \*\/\s*SELECT/i);
  assert.match(NEXT_ACTION_SQL, /p\.key = 'optimization'/);
  assert.match(NEXT_ACTION_SQL, /dc\.status NOT IN \('closed', 'cancelled'\)/);
  assert.match(DESK_CLIENTS_SQL, /^\s*\/\* gap:fulfillment-desk-clients \*\/\s*SELECT/i);
  assert.match(APPLY_BLOCKED_SQL, /condition_text/);
  assert.match(APPLY_BLOCKED_SQL, /error_code/);
  assert.match(APPLY_BLOCKED_SQL, /ps\.status = 'verifying'/);
  for (const sql of [NEXT_ACTION_SQL, DESK_CLIENTS_SQL, APPLY_BLOCKED_SQL]) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i);
    assert.match(sql, /COALESCE\(c?l?\.?is_demo|is_demo, false\) = false/);
  }
  assert.deepEqual([...CHECK_IDS], [
    "fulfillment:next-action",
    "fulfillment:api",
    "fulfillment:apply-blocked"
  ]);
  const taken = new Set(SLICE_33.map((row) => row.id));
  for (const id of CHECK_IDS) assert.equal(taken.has(id), false);
  assert.equal(STAGE_SLA.letters_generated.minutes, 30);
  assert.equal(STAGE_SLA.awaiting_response.daysAfterDue, 5);
  assert.deepEqual([...REPAIR_QUEUE_STAGES], Object.keys(STAGE_SLA));
});

test("gap fulfillment: no database skips all three", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  const noOrg = await gapChecks({ db: fakeDb() });
  assert.deepEqual(noOrg.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap fulfillment: pastDefinedWait uses the repair clocks and has no funding clock", () => {
  const cases = [
    ["analysis", HOUR + 60000, true],
    ["analysis", 50 * 60000, false],
    ["letters_generated", 31 * 60000, true],
    ["letters_generated", 29 * 60000, false],
    ["ready_to_send", 4 * HOUR + 60000, true],
    ["ready_to_send", 3 * HOUR, false],
    ["intake", 3 * DAY + 60000, true],
    ["intake", 2 * DAY, false],
    ["awaiting_documents", 15 * DAY, true],
    ["awaiting_documents", 13 * DAY, false],
    ["in_transit", 11 * DAY, true],
    ["response_received", 25 * HOUR, true],
    ["response_received", 23 * HOUR, false]
  ];
  for (const [stage, ago, want] of cases) {
    assert.equal(pastDefinedWait({ stage_key: stage, entered_at: iso(ago) }, NOW), want, `${stage} ${ago}`);
  }
  // Awaiting a bureau answer is late only 5 days after the answer was due.
  assert.equal(pastDefinedWait({
    stage_key: "awaiting_response", entered_at: iso(30 * DAY), response_due_at: iso(6 * DAY)
  }, NOW), true);
  assert.equal(pastDefinedWait({
    stage_key: "awaiting_response", entered_at: iso(30 * DAY), response_due_at: iso(4 * DAY)
  }, NOW), false);
  assert.equal(pastDefinedWait({ stage_key: "awaiting_response", entered_at: iso(30 * DAY) }, NOW), false);
  // A stage with no clock, a missing time, and a funding stage are never late.
  assert.equal(pastDefinedWait({ stage_key: "on_hold", entered_at: iso(90 * DAY) }, NOW), false);
  assert.equal(pastDefinedWait({ stage_key: "analysis" }, NOW), false);
  assert.equal(pastDefinedWait({ stage_key: "apply_now", pipeline_key: "funding_card_stacking", entered_at: iso(90 * DAY) }, NOW), false);
  assert.equal(pastDefinedWait(null, NOW), false);
});

test("gap fulfillment: showsNextStep reads the same shape the screen does", () => {
  assert.equal(showsNextStep(SHOWS.fulfillment), true);
  assert.equal(showsNextStep({ degraded: false, next_action: { label: "" } }), false);
  assert.equal(showsNextStep({ degraded: false, next_action: null }), false);
  assert.equal(showsNextStep({ degraded: true, next_action: { label: "Pull CRS" } }), false);
  assert.equal(showsNextStep(null), false);
});

test("gap fulfillment: a clear desk is three PASS rows", async () => {
  const step = stepFor({ "c-ok": SHOWS, "c-desk": SHOWS });
  const db = fakeDb({
    nextRows: [late("c-ok", "analysis", 30 * 60000)],
    deskRows: [{ client_id: "c-desk" }]
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readShownStep: step });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  // The file inside its clock is not read for a step at all.
  assert.deepEqual(step.asked, ["c-desk"]);
  assert.ok(db.calls.every((call) => /SELECT/i.test(call.sql)));
});

test("gap fulfillment: a repair file past its clock with no step on the screen is a FAIL", async () => {
  const step = stepFor({ "c-bram": BLANK, "c-ok": SHOWS });
  const rows = await gapChecks({
    db: fakeDb({ nextRows: [late("c-bram"), late("c-ok", "letters_generated", 2 * HOUR)], deskRows: [] }),
    orgId: ORG, now: NOW, readShownStep: step
  });
  rows.forEach(shape);
  const next = rows.find((r) => r.id === "fulfillment:next-action");
  assert.equal(next.status, "FAIL");
  assert.match(next.detail, /1 repair file past the clock and the screen shows no next step/);
  assert.match(next.detail, /c-bram \(analysis\)/);
  assert.doesNotMatch(next.detail, /c-ok/);
  assert.match(next.suggestedFix, /set the next step/);
  assert.deepEqual(step.asked.sort(), ["c-bram", "c-ok"]);
  assert.ok(rows.filter((r) => r.id !== next.id).every((r) => r.status !== "FAIL"));
});

test("gap fulfillment: a degraded answer on a late file counts as no next step", async () => {
  const rows = await gapChecks({
    db: fakeDb({ nextRows: [late("c-deg", "awaiting_documents", 20 * DAY)] }),
    orgId: ORG, now: NOW, readShownStep: stepFor({ "c-deg": DEGRADED })
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /c-deg \(awaiting_documents\)/);
});

test("gap fulfillment: a late bureau file past its due date is read; one inside its window is not", async () => {
  const step = stepFor({ "c-due": BLANK, "c-wait": BLANK });
  const rows = await gapChecks({
    db: fakeDb({
      nextRows: [
        late("c-due", "awaiting_response", 30 * DAY, { response_due_at: iso(6 * DAY) }),
        late("c-wait", "awaiting_response", 30 * DAY, { response_due_at: iso(4 * DAY) })
      ]
    }),
    orgId: ORG, now: NOW, readShownStep: step
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /c-due/);
  assert.doesNotMatch(rows[0].detail, /c-wait/);
  assert.ok(!step.asked.includes("c-wait"));
});

test("gap fulfillment: a step that cannot be read is a skip with the reason, never a PASS", async () => {
  const boom = await gapChecks({
    db: fakeDb({ nextRows: [late("c-boom")] }),
    orgId: ORG, now: NOW, readShownStep: stepFor({ "c-boom": new Error("socket hang up") })
  });
  assert.equal(boom[0].status, "skip");
  assert.match(boom[0].detail, /socket hang up/);
  const gone = await gapChecks({
    db: fakeDb({ nextRows: [late("c-gone")] }),
    orgId: ORG, now: NOW, readShownStep: stepFor({ "c-gone": { found: false, fulfillment: null } })
  });
  assert.equal(gone[0].status, "skip");
  assert.match(gone[0].detail, /client not found/);
  // One blank file still fails, even with another file unread.
  const mixed = await gapChecks({
    db: fakeDb({ nextRows: [late("c-blank"), late("c-boom")] }),
    orgId: ORG, now: NOW, readShownStep: stepFor({ "c-blank": BLANK, "c-boom": new Error("x") })
  });
  assert.equal(mixed[0].status, "FAIL");
});

test("gap fulfillment: the fulfillment read FAILs when the control panel read throws, has no answer, or is degraded", async () => {
  const desk = (...ids) => ids.map((client_id) => ({ client_id }));
  const threw = await gapChecks({
    db: fakeDb({ deskRows: desk("c-1", "c-2") }),
    orgId: ORG, now: NOW,
    readShownStep: stepFor({ "c-1": SHOWS, "c-2": new Error("column does not exist") })
  });
  const a = threw.find((r) => r.id === "fulfillment:api");
  assert.equal(a.status, "FAIL");
  assert.match(a.detail, /failed for 1 of 2 desk files/);
  assert.match(a.detail, /c-2 threw: column does not exist/);
  shape(a);

  const none = await gapChecks({
    db: fakeDb({ deskRows: desk("c-3") }), orgId: ORG, now: NOW,
    readShownStep: stepFor({ "c-3": { found: true, fulfillment: null } })
  });
  assert.equal(none.find((r) => r.id === "fulfillment:api").status, "FAIL");
  assert.match(none.find((r) => r.id === "fulfillment:api").detail, /had no answer/);

  const deg = await gapChecks({
    db: fakeDb({ deskRows: desk("c-4") }), orgId: ORG, now: NOW,
    readShownStep: stepFor({ "c-4": DEGRADED })
  });
  assert.equal(deg.find((r) => r.id === "fulfillment:api").status, "FAIL");
  assert.match(deg.find((r) => r.id === "fulfillment:api").detail, /Not worked out yet/);

  const gone = await gapChecks({
    db: fakeDb({ deskRows: desk("c-5") }), orgId: ORG, now: NOW,
    readShownStep: stepFor({ "c-5": { found: false, fulfillment: null } })
  });
  assert.equal(gone.find((r) => r.id === "fulfillment:api").status, "FAIL");

  const ok = await gapChecks({
    db: fakeDb({ deskRows: desk("c-6", "c-7") }), orgId: ORG, now: NOW,
    readShownStep: stepFor({ "c-6": SHOWS, "c-7": BLANK })
  });
  // A file with no next step but a clean read is not an API fault.
  assert.equal(ok.find((r) => r.id === "fulfillment:api").status, "PASS");
  assert.match(ok.find((r) => r.id === "fulfillment:api").detail, /answered for 2 desk files/);
});

test("gap fulfillment: no file on either board skips the read instead of passing it", async () => {
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, readShownStep: stepFor({}) });
  const a = rows.find((r) => r.id === "fulfillment:api");
  assert.equal(a.status, "skip");
  assert.match(a.detail, /nothing to read/);
  assert.ok(MAX_DESK_READS >= 1);
});

test("gap fulfillment: one file is read once even when both checks ask about it", async () => {
  const step = stepFor({ "c-same": BLANK });
  const rows = await gapChecks({
    db: fakeDb({ nextRows: [late("c-same")], deskRows: [{ client_id: "c-same" }] }),
    orgId: ORG, now: NOW, readShownStep: step
  });
  assert.deepEqual(step.asked, ["c-same"]);
  assert.equal(rows[0].status, "FAIL");
  assert.equal(rows[1].status, "PASS");
});

test("gap fulfillment: a blocked apply step with no reason stored is a FAIL", async () => {
  const rows = await gapChecks({ db: fakeDb({ applyN: 2 }), orgId: ORG, now: NOW, readShownStep: stepFor({}) });
  rows.forEach(shape);
  const apply = rows.find((r) => r.id === "fulfillment:apply-blocked");
  assert.equal(apply.status, "FAIL");
  assert.match(apply.detail, /2 apply steps blocked with no reason stored/);
  const clear = await gapChecks({ db: fakeDb({ applyN: 0 }), orgId: ORG, now: NOW, readShownStep: stepFor({}) });
  assert.equal(clear.find((r) => r.id === "fulfillment:apply-blocked").status, "PASS");
});

test("gap fulfillment: a read error is FAIL, not a throw or a PASS", async () => {
  const rows = await gapChecks({
    db: fakeDb({ throwOn: "gap:fulfillment" }),
    orgId: ORG, now: NOW, readShownStep: stepFor({})
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["FAIL", "FAIL", "FAIL"]);
  assert.match(rows[0].detail, /could not read next steps/);
  assert.match(rows[1].detail, /could not read desk files/);
  assert.match(rows[2].detail, /could not read blocked apply steps/);
});

test("gap fulfillment: the default reader runs the real control panel read", async () => {
  // Every other read returns no rows, so the real readClientStepRows finds no client.
  const calls = { other: 0 };
  const db = {
    async query(sql, params) {
      const text = String(sql);
      if (/gap:fulfillment-next-action/.test(text)) return { rows: [late("c-real")] };
      if (/gap:fulfillment-desk-clients/.test(text)) return { rows: [{ client_id: "c-real" }] };
      if (/gap:fulfillment-apply-blocked/.test(text)) return { rows: [{ n: 0 }] };
      calls.other += 1;
      return { rows: [] };
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.ok(calls.other >= 6, "the six control panel reads ran");
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /client not found/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /was not found/);
});
