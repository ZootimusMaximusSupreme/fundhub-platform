import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  EXECUTION_GRACE_DAYS,
  NA_WHAT,
  OPEN_TASK_STATUSES,
  SETTLE_WINDOW_DAYS,
  STUCK_SQL,
  gapChecks,
  naVerify
} from "./gap-money-moves.mjs";
import { EXECUTION_GRACE_DAYS as REAL_GRACE, ENDED, etToday } from "../../finance/money-transfers.mjs";
import { etDay, TEST_CLIENT_EMAIL_RE } from "./money-reads.mjs";
import { verifyNa } from "../na-conditions.mjs";
import {
  CLIENT_COLS, HAS_DB, ORG, OTHER_ORG, client_, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-money-moves.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const day = (n) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10);

test("gap money-moves: the source is read only, calls no bank and moves no money", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetch/i);
  // It imports nothing from the engine or the bank modules, so it cannot call them.
  assert.doesNotMatch(SRC, /^import[^;]*(money-transfers|banking|plaid)/im);
  assert.doesNotMatch(SRC, /\b(plaidTransferProvider|executeTransfer|syncTransferEvents|cancelTransfer)\s*\(/);
  assert.deepEqual([...CHECK_IDS], ["money-moves:stuck"]);
});

test("gap money-moves: the grace and the day it counts in are the engine's own", () => {
  assert.equal(EXECUTION_GRACE_DAYS, REAL_GRACE);
  assert.equal(etDay(NOW), etToday(NOW), "the New York banking day, the same call the engine makes");
  assert.ok(ENDED.includes("settled") && ENDED.includes("failed"));
  assert.deepEqual([...OPEN_TASK_STATUSES], ["queued", "needs_approval", "approved", "claimed"]);
  assert.equal(SETTLE_WINDOW_DAYS, 10);
});

describe("gap money-moves: the row", () => {
  const counts = (over = {}) => ({
    judged_n: 0, test_n: 0, live_n: 0, unsent_n: 0, unsettled_n: 0, task_open_n: 0, cents: 0, oldest_date: null, sample: null, ...over
  });
  const run = (over) => gapChecks({ db: tagDb({ "money-moves-stuck": counts(over) }), orgId: ORG, now: NOW });

  test("no real client move on file is nothing to judge, by the lane code the audit re-reads", async () => {
    const [r] = await run({ test_n: 2 });
    assert.equal(r.status, "na");
    assert.equal(r.na.code, "not-connected");
    assert.deepEqual(r.na.args, { check: "money-moves:stuck", what: NA_WHAT, moves: 0 });
    assert.match(r.detail, /No real client has a money move on file \(2 test-client moves left out\)/);
  });

  test("moves on file and none stuck is a PASS that splits live from practice", async () => {
    const [r] = await run({ judged_n: 4, live_n: 1 });
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /4 money moves on file \(1 live, 3 practice\), none stuck/);
    assert.equal(r.suggestedFix, null);
  });

  test("each stuck kind is its own sentence, with dollars, oldest date and which environment", async () => {
    const [r] = await run({
      judged_n: 5, live_n: 2, unsent_n: 1, unsettled_n: 2, task_open_n: 1, cents: 2500000, oldest_date: "2026-10-04",
      sample: "production approved 2026-10-04"
    });
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 move the client approved and the engine never sent, past its date/);
    assert.match(r.detail, /2 moves sent and not settled in 10 days/);
    assert.match(r.detail, /1 move failed or returned with the task still open/);
    assert.match(r.detail, /\$25,000 in all/);
    assert.match(r.detail, /dated 2026-10-04/);
    assert.match(r.detail, /production approved 2026-10-04/);
    assert.match(r.suggestedFix, /FINANCE_OS_TRANSFER_MAX_CENTS/);
    assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
  });

  test("no database and no org are skips; a failed read is a skip with the reason", async () => {
    assert.equal((await gapChecks({ now: NOW }))[0].status, "skip");
    assert.match((await gapChecks({ db: tagDb({}), now: NOW }))[0].detail, /no org id/);
    const bad = tagDb({ "money-moves-stuck": new Error("permission denied for table money_transfers") });
    const [r] = await gapChecks({ db: bad, orgId: ORG, now: NOW });
    assert.equal(r.status, "skip");
    assert.match(r.detail, /permission denied/);
  });

  test("the read is given New York's day, the settle cut and the open task statuses", async () => {
    const seen = [];
    await gapChecks({ db: tagDb({ "money-moves-stuck": counts() }, seen), orgId: ORG, now: NOW });
    assert.deepEqual(seen[0].params, [
      ORG, etDay(NOW), ago(SETTLE_WINDOW_DAYS * DAY), TEST_CLIENT_EMAIL_RE, ["queued", "needs_approval", "approved", "claimed"]
    ]);
  });

  test("naVerify is true only while no real move is on file, and it goes through the audit's own verifyNa", async () => {
    const empty = tagDb({ "money-moves-stuck": counts({ judged_n: 0 }) });
    const has = tagDb({ "money-moves-stuck": counts({ judged_n: 1 }) });
    const args = { check: "money-moves:stuck", what: NA_WHAT, moves: 0 };
    assert.equal(await naVerify["not-connected"](args, { db: empty, orgId: ORG, now: NOW }), true);
    assert.equal(await naVerify["not-connected"](args, { db: has, orgId: ORG, now: NOW }), false);
    assert.equal(await naVerify["not-connected"]({ check: "other" }, { db: empty, orgId: ORG, now: NOW }), false);
    assert.equal(await naVerify["not-connected"](args, { now: NOW }), false);

    const [row] = await gapChecks({ db: empty, orgId: ORG, now: NOW });
    const laneRow = { id: "gap-money-moves:money-moves:stuck", sliceId: "gap-money-moves", status: "na", na: row.na };
    const ok = await verifyNa(laneRow, { laneNaVerify: async (_slice, code, a) => naVerify[code](a, { db: empty, orgId: ORG, now: NOW }) });
    assert.equal(ok.ok, true, ok.reason);
    const nope = await verifyNa(laneRow, { laneNaVerify: async (_slice, code, a) => naVerify[code](a, { db: has, orgId: ORG, now: NOW }) });
    assert.equal(nope.ok, false, "the day a move lands the claim stops being true");
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const T_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["agent_task_id", "uuid"], ["environment", "text"],
  ["status", "text"], ["scheduled_for", "date"], ["amount_cents", "bigint"], ["started_at", "timestamptz"],
  ["updated_at", "timestamptz"], ["debit_status", "text"], ["credit_status", "text"]
];
const K_COLS = [["id", "uuid"], ["org_id", "uuid"], ["status", "text"]];
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C_TEST = "cccccccc-0000-4000-8000-000000000009";
const mid = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clients = [client_(C1), client_(C_TEST, { is_demo: true })];

const move = (n, over = {}) => ({
  id: mid(n), org_id: ORG, client_id: C1, agent_task_id: mid(500 + n), environment: "sandbox", status: "settled",
  scheduled_for: day(20), amount_cents: 2000000, started_at: ago(19 * DAY), updated_at: ago(15 * DAY),
  debit_status: "funds_available", credit_status: "settled", ...over
});
const task = (n, status = "done", over = {}) => ({ id: mid(500 + n), org_id: ORG, status, ...over });

// want: [judged_n, live_n, unsent_n, unsettled_n, task_open_n, test_n]
const CASES = [
  ["no moves at all", { moves: [], tasks: [] }, [0, 0, 0, 0, 0, 0]],
  ["one settled sandbox move is judged and not stuck", { moves: [move(1)], tasks: [task(1)] }, [1, 0, 0, 0, 0, 0]],
  [
    "approved and dated yesterday is past its date (the engine tries every 15 minutes)",
    { moves: [move(1, { status: "approved", scheduled_for: day(1), started_at: null, debit_status: null, credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 1, 0, 0, 0]
  ],
  [
    "approved and dated today is not late yet",
    { moves: [move(1, { status: "approved", scheduled_for: etDay(NOW), started_at: null, debit_status: null, credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 0, 0, 0, 0]
  ],
  [
    "approved and dated tomorrow is not late",
    { moves: [move(1, { status: "approved", scheduled_for: day(-1), started_at: null, debit_status: null, credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 0, 0, 0, 0]
  ],
  [
    "submitted 11 days ago and still not settled",
    { moves: [move(1, { status: "submitted", started_at: ago(11 * DAY), updated_at: ago(2 * DAY), debit_status: "posted", credit_status: null, environment: "production" })], tasks: [task(1, "claimed")] },
    [1, 1, 0, 1, 0, 0]
  ],
  [
    "submitted 3 days ago is inside the ACH window",
    { moves: [move(1, { status: "submitted", started_at: ago(3 * DAY), debit_status: "pending", credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 0, 0, 0, 0]
  ],
  [
    "authorized with no start time is aged by its last touch",
    { moves: [move(1, { status: "authorized", started_at: null, updated_at: ago(12 * DAY), debit_status: null, credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 0, 1, 0, 0]
  ],
  [
    "failed and its proposal closed failed is handled",
    { moves: [move(1, { status: "failed", debit_status: "failed", credit_status: null })], tasks: [task(1, "failed")] },
    [1, 0, 0, 0, 0, 0]
  ],
  [
    "failed and its proposal still claimed: the engine never closed it",
    { moves: [move(1, { status: "failed", debit_status: "failed", credit_status: null })], tasks: [task(1, "claimed")] },
    [1, 0, 0, 0, 1, 0]
  ],
  [
    "a settled move with a returned leg and the task still open (a late ACH return)",
    { moves: [move(1, { status: "settled", credit_status: "returned" })], tasks: [task(1, "approved")] },
    [1, 0, 0, 0, 1, 0]
  ],
  [
    "declined and its proposal still queued",
    { moves: [move(1, { status: "declined", debit_status: null, credit_status: null })], tasks: [task(1, "queued")] },
    [1, 0, 0, 0, 1, 0]
  ],
  [
    "a test client's stuck move is counted apart",
    { moves: [move(1, { client_id: C_TEST, status: "approved", scheduled_for: day(2), started_at: null })], tasks: [task(1, "claimed")] },
    [0, 0, 0, 0, 0, 1]
  ],
  [
    "another org's move is not read",
    { moves: [move(1, { org_id: OTHER_ORG, status: "approved", scheduled_for: day(2) })], tasks: [task(1, "claimed", { org_id: OTHER_ORG })] },
    [0, 0, 0, 0, 0, 0]
  ],
  [
    "a move with no proposal row still counts as a move (it cannot be called task-open)",
    { moves: [move(1, { status: "failed", debit_status: "failed" })], tasks: [] },
    [1, 0, 0, 0, 0, 0]
  ]
];

describe("gap money-moves: the stuck SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  const params = () => [ORG, etDay(NOW), ago(SETTLE_WINDOW_DAYS * DAY), TEST_CLIENT_EMAIL_RE, [...OPEN_TASK_STATUSES]];
  for (const [name, scenario, want] of CASES) {
    test(name, async () => {
      const sql = withShadows(STUCK_SQL, [
        shadow("money_transfers", T_COLS, scenario.moves),
        shadow("money_agent_tasks", K_COLS, scenario.tasks),
        shadow("clients", CLIENT_COLS, clients)
      ]);
      const { rows } = await runShadowSql(sql, params());
      const r = rows[0];
      const got = [r.judged_n, r.live_n, r.unsent_n, r.unsettled_n, r.task_open_n, r.test_n].map(Number);
      assert.deepEqual(got, want, name);
    });
  }

  test("dollars, oldest date and the sample cover only the stuck moves", async () => {
    const sql = withShadows(STUCK_SQL, [
      shadow("money_transfers", T_COLS, [
        move(1),
        move(2, { status: "approved", scheduled_for: day(2), amount_cents: 1000000, started_at: null, environment: "production" }),
        move(3, { status: "submitted", started_at: ago(12 * DAY), amount_cents: 500000 })
      ]),
      shadow("money_agent_tasks", K_COLS, [task(1), task(2, "claimed"), task(3, "claimed")]),
      shadow("clients", CLIENT_COLS, clients)
    ]);
    const { rows } = await runShadowSql(sql, [ORG, etDay(NOW), ago(SETTLE_WINDOW_DAYS * DAY), TEST_CLIENT_EMAIL_RE, [...OPEN_TASK_STATUSES]]);
    assert.equal(Number(rows[0].cents), 1500000);
    assert.match(rows[0].sample, /production approved/);
    assert.match(rows[0].sample, /sandbox submitted/);
    assert.doesNotMatch(rows[0].sample, /settled/);
  });
});
