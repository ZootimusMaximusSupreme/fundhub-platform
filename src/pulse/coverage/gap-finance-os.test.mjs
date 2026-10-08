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
