import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS as SLICE_07 } from "./slice-07-finance.mjs";
import {
  CHECK_IDS,
  DOORS,
  gapChecks,
  openReadDoor,
  readOnlyHelperPayload
} from "./gap-finance-os.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-finance-os.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function shape(row) {
  assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not call Plaid/);
    assert.match(row.suggestedFix, /Do not move money/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function linkedDb(clientId) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (/gap:finance-os-linked-client/.test(sql)) {
        return { rows: clientId ? [{ id: clientId }] : [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function okDoor() {
  return { status: 200, body: { ok: true } };
}

test("gap finance os: source stays a read and does not repeat slice 07", () => {
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /answerOrphans/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /plaid-transfer|plaid\.mjs|encrypted_access_token|bank_accounts/);
  assert.doesNotMatch(SRC, /executeTransfer|approveTransfer|proposeTransfer/);
  assert.deepEqual([...CHECK_IDS], DOORS.map((door) => door.id));
  assert.equal(CHECK_IDS.length, 7);
  const sliceIds = new Set(SLICE_07.map((row) => row.id));
  for (const id of CHECK_IDS) assert.equal(sliceIds.has(id), false);
});

test("gap finance os: the seven doors are the live GET routes", () => {
  const api = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  for (const door of DOORS) {
    assert.match(api, new RegExp(`["']${door.route}["']`));
    const file = fs.readFileSync(path.join(ROOT, door.file), "utf8");
    assert.match(file, /export default async function handler/);
    assert.match(file, /!== "GET"/);
    assert.equal(fs.existsSync(path.join(ROOT, "public/app", path.basename(door.page))), true);
  }
});

test("gap finance os: no database skips every door", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 7);
  rows.forEach(shape);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  assert.ok(rows.every((row) => row.status === "skip"));
  assert.match(rows[0].detail, /no database/);
});

test("gap finance os: no linked client skips every door and does not open them", async () => {
  const db = linkedDb(null);
  let opened = 0;
  const rows = await gapChecks({
    db,
    orgId: ORG,
    callDoor() { opened += 1; return okDoor(); }
  });
  rows.forEach(shape);
  assert.ok(rows.every((row) => row.status === "skip"));
  assert.match(rows[0].detail, /no client with an active bank link/);
  assert.equal(opened, 0);
  assert.equal(db.seen.length, 1);
  assert.match(db.seen[0].sql, /plaid_items/);
  assert.match(db.seen[0].sql, /link_state = 'active'/);
  assert.equal(db.seen[0].params[0], ORG);
  assert.doesNotMatch(db.seen[0].sql, /\b(INSERT|UPDATE|DELETE)\b/i);
});

test("gap finance os: a linked client with clean reads is seven PASS rows", async () => {
  const seen = [];
  const db = linkedDb(CLIENT);
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: new Date("2026-10-08T22:00:00Z"),
    callDoor(door, args) {
      seen.push({ id: door.id, method: "GET", clientId: args.clientId });
      return okDoor();
    }
  });
  assert.equal(rows.length, 7);
  rows.forEach(shape);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.deepEqual(seen.map((call) => call.id), [...CHECK_IDS]);
  assert.ok(seen.every((call) => call.clientId === CLIENT));
});

test("gap finance os: a 500, an error body, a 404, or a throw fails that door only", async () => {
  const cases = [
    { id: "finance-os:credit", outcome: { status: 500, body: { ok: false, error: "boom" } }, detail: /answered 500/ },
    { id: "finance-os:plan", outcome: { status: 200, body: { ok: false, error: "bad_plan" } }, detail: /bad_plan/ },
    { id: "finance-os:declines", outcome: { status: 404, body: { ok: false, error: "not_found" } }, detail: /answered 404/ },
    { id: "finance-os:vault", outcome: { thrown: new Error("vault relation missing") }, detail: /vault relation missing/ }
  ];
  for (const c of cases) {
    const rows = await gapChecks({
      db: linkedDb(CLIENT),
      orgId: ORG,
      callDoor(door) {
        return door.id === c.id ? c.outcome : okDoor();
      }
    });
    rows.forEach(shape);
    const hit = rows.find((row) => row.id === c.id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    const rest = rows.filter((row) => row.id !== c.id);
    assert.ok(rest.every((row) => row.status === "PASS"));
  }
});

test("gap finance os: a linked-client read error fails every door and opens none", async () => {
  let opened = 0;
  const db = {
    async query() {
      throw new Error("relation plaid_items does not exist");
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    callDoor() { opened += 1; return okDoor(); }
  });
  rows.forEach(shape);
  assert.ok(rows.every((row) => row.status === "FAIL"));
  assert.match(rows[0].detail, /plaid_items does not exist/);
  assert.equal(opened, 0);
});

test("gap finance os: the default opener is GET and the helper read does not write", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error(`write: ${sql.slice(0, 80)}`);
      if (/FROM clients/i.test(sql)) {
        return { rows: [{ id: CLIENT, first_name: "Pat", last_name: "Lee" }] };
      }
      return { rows: [] };
    }
  };
  const helper = (await import("../../../api/money/helper.mjs")).default;
  const door = DOORS.find((row) => row.id === "finance-os:helper");
  const outcome = await openReadDoor(door, {
    db,
    orgId: ORG,
    clientId: CLIENT,
    now: new Date("2026-10-08T22:00:00Z"),
    handler: helper,
    env: { MONEY_HELPER_RUNNER: "rules" }
  });
  assert.equal(outcome.method, "GET");
  assert.equal(outcome.thrown, null);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.helper.sends_texts, false);
  assert.equal(outcome.body.client.id, CLIENT);
  assert.ok(queries.length > 0);
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)));
  assert.ok(!queries.some((sql) => /plaid/i.test(sql)));

  const direct = await readOnlyHelperPayload(db, {
    orgId: ORG,
    clientId: CLIENT,
    staff: true,
    env: { MONEY_HELPER_RUNNER: "rules" },
    now: new Date("2026-10-08T22:00:00Z")
  });
  assert.equal(direct.ok, true);
  assert.equal(direct.helper.brain, "rules");
});

// ---- Review — Claude, 2026-10-08 ------------------------------------------

test("gap finance os: every door names its handler with a literal import so the server bundle packs it", async () => {
  // Measured 2026-10-08 in a bundle with no source tree beside it: a path built
  // at run time found nothing and all seven doors read FAIL "cannot find module".
  for (const door of DOORS) {
    assert.equal(typeof door.load, "function", `${door.id} has no loader`);
    const literal = `import("../../../${door.file}")`;
    assert.ok(SRC.includes(literal), `${door.id} must be loaded with ${literal}`);
    const mod = await door.load();
    assert.equal(typeof mod.default, "function", `${door.id} loader did not return a handler`);
  }
});

test("gap finance os: no org id is a skip that says so", async () => {
  const rows = await gapChecks({ db: linkedDb(CLIENT) });
  rows.forEach(shape);
  assert.ok(rows.every((row) => row.status === "skip"));
  assert.match(rows[0].detail, /no org id/);
  assert.doesNotMatch(rows[0].detail, /no database/);
});

test("gap finance os: the seven doors are opened side by side, in DOORS order", async () => {
  // A serial loop would wait on the first door forever here and never start the
  // second. The step that runs this lane is cut at 26 seconds.
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const run = gapChecks({
    db: linkedDb(CLIENT),
    orgId: ORG,
    async callDoor(door) {
      order.push(door.id);
      started += 1;
      if (started === DOORS.length) release();
      await gate;
      return okDoor();
    }
  });
  const rows = await Promise.race([
    run,
    new Promise((_, reject) => setTimeout(() => reject(new Error("doors were opened one at a time")), 2000))
  ]);
  assert.deepEqual(order, [...CHECK_IDS]);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  assert.ok(rows.every((row) => row.status === "PASS"));
});

test("gap finance os: the real handlers answer 200 for a client with nothing yet, and a broken table fails its door", async () => {
  // No callDoor stub: this goes through the real loader and the real handler for
  // every door, with a database that holds one client and nothing else.
  const mk = (broken = null) => ({
    async query(sql) {
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)) throw new Error(`write: ${sql.slice(0, 60)}`);
      if (broken && broken.test(sql)) throw new Error("relation is gone");
      if (/gap:finance-os-linked-client/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/FROM clients/i.test(sql)) {
        return { rows: [{ id: CLIENT, org_id: ORG, first_name: "Pat", last_name: "Lee", custom_fields: {}, "?column?": 1 }] };
      }
      // A SUM over nothing still answers one row in Postgres.
      if (/COALESCE\(SUM\(amount_cents\)/i.test(sql)) return { rows: [{ used: "0" }] };
      if (/count\(\*\)::int AS n/i.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    }
  });
  const env = { MONEY_HELPER_RUNNER: "rules" };
  const now = new Date("2026-10-08T22:00:00Z");
  const clean = await gapChecks({ db: mk(), orgId: ORG, now, env });
  clean.forEach(shape);
  assert.deepEqual(clean.map((row) => row.status), Array(7).fill("PASS"), clean.map((r) => `${r.id}: ${r.detail}`).join("\n"));

  const broken = await gapChecks({ db: mk(/FROM crs_results/i), orgId: ORG, now, env });
  broken.forEach(shape);
  const credit = broken.find((row) => row.id === "finance-os:credit");
  assert.equal(credit.status, "FAIL");
  assert.match(credit.suggestedFix, /GET \/api\/money\/credit/);
});
