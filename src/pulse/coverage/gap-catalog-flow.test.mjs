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
import { FIN_B22_LIVE_SURFACES } from "../catalog/proofs/fin-b22-flow-live.mjs";
import { FIN_B22_LIVE_PROOFS, FIN_B22_PRACTICE } from "../catalog/proofs/fin-b22-flow-contracts.mjs";
import { makeStandIn, NOW as KIT_NOW } from "../catalog/proofs/fin-b22-sql-kit.mjs";

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

test("the Flow monitor owns the exact 180 remaining catalog rows", () => {
  const counts = FLOW_ROWS.reduce((out, row) => {
    out[row.family] = (out[row.family] || 0) + 1;
    return out;
  }, {});
  assert.deepEqual(counts, EXPECTED_FLOW_GAP_COUNTS);
  assert.equal(FLOW_ROWS.length, 180);
  assert.equal(CHECK_IDS.length, 180);
  assert.equal(new Set(CHECK_IDS).size, 180);
  assert.equal(FLOW_ROWS.filter(isInactiveTemplateRow).length, 158);
});

test("batch 22: three rows left for a practice test, nine are judged from saved results, eleven stay not proved", () => {
  const surfaces = new Set(FLOW_ROWS.map((row) => row.surface));
  for (const surface of Object.keys(FIN_B22_PRACTICE)) assert.equal(surfaces.has(surface), false, `${surface} left the monitor`);
  for (const surface of Object.keys(FIN_B22_LIVE_PROOFS)) assert.equal(surfaces.has(surface), true, `${surface} stays in the lane`);
  assert.deepEqual([...FIN_B22_LIVE_SURFACES].sort(), Object.keys(FIN_B22_LIVE_PROOFS).sort(), "the live checks and their proofs name the same rows");
  assert.equal(Object.keys(FIN_B22_PRACTICE).length, 3);
  assert.equal(FIN_B22_LIVE_SURFACES.size, 9);
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

  assert.equal(rows.length, 180);
  assert.equal(inactive.length, 158);
  const inactiveReads = fake.calls.filter((call) => call.sql === INACTIVE_TEMPLATE_SQL);
  assert.equal(inactiveReads.length, 1, "one batched read for all inactive templates");
  assert.equal(inactiveReads[0].params[2].length, 158);
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

test("every active control is either named not proved, judged from saved results, or checked inactive", async () => {
  const rows = await gapChecks({ db: dbWith([]).db, orgId: "00000000-0000-0000-0000-000000000001", now: NOW });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const live = new Set([...FIN_B22_LIVE_SURFACES].map((surface) => `${surface}`));

  for (const source of FLOW_ROWS.filter((row) => !isInactiveTemplateRow(row))) {
    const result = byId.get(`flow:${source.family}:${source.surface}`);
    assert.ok(result, source.surface);
    assert.ok(result.detail.includes(source.surface), source.surface);
    assert.doesNotMatch(result.detail, /source (?:file )?(?:exists|was found)/i, source.surface);
    assert.doesNotMatch(result.detail, /named control has no exact final-result checker/i, source.surface);
    if (live.has(source.surface)) {
      assert.ok(["PASS", "FAIL", "skip"].includes(result.status), `${source.surface}: ${result.status}`);
    } else {
      assert.ok(["NOT_PROVED", "na"].includes(result.status), source.surface);
    }
  }

  const notProved = rows.filter((row) => row.status === "NOT_PROVED").map((row) => row.id).sort();
  assert.equal(notProved.length, 11);
  assert.deepEqual(notProved, [
    "flow:journey:journey:climate-lead-magnet-intended#1-headline-button",
    "flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map",
    "flow:journey:journey:climate-lead-magnet-intended#3-state-click",
    "flow:journey:journey:climate-lead-magnet-intended#4-form",
    "flow:journey:journey:climate-lead-magnet-intended#6-gate",
    "flow:journey:journey:fh-consulting-intended#2-education-only",
    "flow:journey:journey:fh-consulting-intended#3-three-prices",
    "flow:journey:journey:fh-consulting-intended#5-request-enrollment",
    "flow:message:provider:web-push-and-client-push",
    "flow:message:script:one-off senders in scripts/",
    "flow:message:ui:ops-admin outbound mail panel",
  ].sort());
  // An answer of no rows at all: every "quiet" check is green, and the check that needs rows is red.
  assert.equal(rows.filter((row) => row.status === "FAIL").map((row) => row.id).join(), "flow:message:template-copy:SQL-seeded-only-keys-not-in-doc-source");
  assert.equal(rows.filter((row) => row.status === "na").length, 160);
});

test("a flow row with a saved-result query is judged from what the flow left behind, not filed as not proved", async () => {
  const org = "00000000-0000-4000-8000-000000000001";
  const kit = makeStandIn(["owner_notifications", "messages", "clients", "waypoint_nudges", "tasks", "businesses", "message_templates"]);
  try {
    const hour = 3_600_000;
    kit.insert("owner_notifications", {
      id: "00000000-0000-4000-8000-0000000000a1", org_id: org, status: "queued", channel: "sms", title: "Alert", body: "Alert",
      created_at: new Date(KIT_NOW.getTime() - 5 * hour).toISOString(),
    });
    const rows = await gapChecks({ db: kit.handle(), orgId: org, now: KIT_NOW });
    const owner = rows.find((row) => row.id === "flow:message:owner-alert:owner_notifications queue (finance alerts)");
    assert.equal(owner.status, "FAIL");
    assert.match(owner.detail, /1 of 1 saved result failed the exact check/);
    const duplicate = rows.find((row) => row.id === "flow:message:dispatch:sms-duplicate-guard-NOT-WIRED");
    assert.equal(duplicate.status, "PASS");
    assert.match(duplicate.detail, /no saved results yet, so none are wrong/);
    assert.equal(rows.some((row) => row.status === "NOT_PROVED" && FIN_B22_LIVE_SURFACES.has(row.id.split(":").slice(2).join(":"))), false);
  } finally {
    kit.close();
  }
});

test("with no database the live rows are skips with the reason, never green and never not proved", async () => {
  const rows = await gapChecks({ now: NOW });
  for (const surface of FIN_B22_LIVE_SURFACES) {
    const row = rows.find((item) => item.id.endsWith(`:${surface}`));
    assert.ok(row, surface);
    assert.equal(row.status, "skip", surface);
    assert.match(row.detail, /no database in this run/);
  }
});

test("a measured template break stays broken and can never be filed as not proved", async () => {
  const rows = await gapChecks({ db: dbWith([{ template_key: "AF", n: 2 }]).db, now: NOW });
  const measured = rows.find((row) => row.id === "flow:message:template:AF");
  assert.equal(measured.status, "FAIL");
  assert.notEqual(measured.status, "NOT_PROVED");
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

test("the audit rechecks all inactive templates with one batched read", async () => {
  const fake = dbWith([]);
  const ctx = { db: fake.db };
  const base = { count: 1, days: 7, since: "2026-10-05T12:00:00.000Z" };
  assert.equal(await naVerify["no-sender"]({ ...base, surface: "template:AF", key: "AF" }, ctx), true);
  assert.equal(await naVerify["no-sender"]({ ...base, surface: "template:AF-06", key: "AF-06" }, ctx), true);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].params[2].length, 158);
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
