import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECK_IDS,
  FLOW_ROWS,
  INACTIVE_TEMPLATE_SQL,
  gapChecks,
  naVerify,
} from "./gap-catalog-flow.mjs";
import {
  EXPECTED_FLOW_GAP_COUNTS,
  isInactiveTemplateRow,
} from "../catalog/proofs/flow-gap-cases.mjs";

const NOW = new Date("2026-10-12T12:00:00.000Z");

function dbWith(rows) {
  const calls = [];
  return {
    calls,
    db: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows };
      },
    },
  };
}

test("the Flow monitor owns the exact 283 remaining catalog rows", () => {
  const counts = FLOW_ROWS.reduce((out, row) => {
    out[row.family] = (out[row.family] || 0) + 1;
    return out;
  }, {});
  assert.deepEqual(counts, EXPECTED_FLOW_GAP_COUNTS);
  assert.equal(FLOW_ROWS.length, 283);
  assert.equal(CHECK_IDS.length, 283);
  assert.equal(new Set(CHECK_IDS).size, 283);
  assert.equal(FLOW_ROWS.filter(isInactiveTemplateRow).length, 158);
});

test("the inactive-template read is one SELECT and never writes", () => {
  assert.match(INACTIVE_TEMPLATE_SQL, /^SELECT /);
  assert.doesNotMatch(INACTIVE_TEMPLATE_SQL, /\b(?:INSERT|UPDATE|DELETE|CALL|CREATE|DROP|ALTER)\b/i);
  assert.match(INACTIVE_TEMPLATE_SQL, /m\.template_key = ANY\(\$3::text\[\]\)/);
});

test("every inactive template gets its own checked nothing-to-judge row", async () => {
  const fake = dbWith([]);
  const rows = await gapChecks({ db: fake.db, orgId: "00000000-0000-0000-0000-000000000001", now: NOW });
  const inactive = rows.filter((row) => row.id.startsWith("flow:message:template:") && row.status === "na");

  assert.equal(rows.length, 283);
  assert.equal(inactive.length, 158);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].params[2].length, 158);
  for (const row of inactive) {
    assert.equal(row.na.code, "no-sender");
    assert.equal(row.na.args.count, 1);
    assert.ok(row.detail.includes(row.na.args.surface), row.id);
    assert.equal(row.na.args.surface, `template:${row.na.args.key}`);
  }
});

test("one newly used inactive key turns only that exact template red", async () => {
  const rows = await gapChecks({ db: dbWith([{ template_key: "AF", n: 2 }]).db, now: NOW });
  const af = rows.find((row) => row.id === "flow:message:template:AF");
  const af06 = rows.find((row) => row.id === "flow:message:template:AF-06");

  assert.equal(af.status, "FAIL");
  assert.match(af.detail, /2 outbound messages used that exact key/);
  assert.equal(af06.status, "na");
});

test("every missing active control emits one exact red or checked inactive result", async () => {
  const rows = await gapChecks({ db: dbWith([]).db, now: NOW });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const source of FLOW_ROWS.filter((row) => !isInactiveTemplateRow(row))) {
    const result = byId.get(`flow:${source.family}:${source.surface}`);
    assert.ok(result, source.surface);
    assert.ok(["FAIL", "na"].includes(result.status), source.surface);
    assert.ok(result.detail.includes(source.surface), source.surface);
    assert.doesNotMatch(result.detail, /source (?:file )?(?:exists|was found)/i, source.surface);
    assert.doesNotMatch(result.detail, /named control has no exact final-result checker/i, source.surface);
  }

  assert.equal(rows.filter((row) => row.status === "FAIL").length, 123);
  assert.equal(rows.filter((row) => row.status === "na").length, 160);
});

test("missing database access never turns an inactive template green", async () => {
  const rows = await gapChecks({ now: NOW });
  const inactive = rows.filter((row) => row.id.startsWith("flow:message:template:") && row.status === "skip");
  assert.equal(inactive.length, 158);
  assert.match(inactive[0].detail, /no database in this run/);
});

test("no-sender claims re-read the exact key and reject a different or used key", async () => {
  const args = {
    surface: "template:AF",
    key: "AF",
    count: 1,
    days: 7,
    since: "2026-10-05T12:00:00.000Z",
  };
  assert.equal(await naVerify["no-sender"](args, { db: dbWith([]).db }), true);
  assert.equal(await naVerify["no-sender"](args, { db: dbWith([{ template_key: "AF", n: 1 }]).db }), false);
  assert.equal(await naVerify["no-sender"]({ ...args, key: "AF-06" }, { db: dbWith([]).db }), false);
  assert.equal(await naVerify["no-sender"]({ ...args, surface: "template:not-real" }, { db: dbWith([]).db }), false);
});

test("inbound-only nothing-to-judge claims verify the exact named controls", async () => {
  assert.equal(await naVerify["no-sender"]({
    surface: "inbound:suppression-and-slugs-src-mail",
    kind: "inbound-only",
  }), true);
  assert.equal(await naVerify["no-sender"]({
    surface: "api:POST /api/chat/portal-message",
    kind: "inbound-only",
  }), true);
  assert.equal(await naVerify["no-sender"]({
    surface: "api:POST /api/chat/messages",
    kind: "inbound-only",
  }), false);
});
