import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
import {
  CLIMATE_READING_SURFACE, CONSULTING_REQUEST_SURFACE, STATE_CODES,
} from "../catalog/proofs/fin-b22-page-reads.mjs";
import {
  FIN_B22_NOT_SHIPPED_SURFACES, NOT_SHIPPED_CODE, NOT_SHIPPED_CLAIMS, notShippedRowId,
} from "../catalog/proofs/fin-b22-not-shipped.mjs";
import { makeStandIn, NOW as KIT_NOW, REPO_ROOT } from "../catalog/proofs/fin-b22-sql-kit.mjs";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const PRESENT_SURFACE = "journey:climate-lead-magnet-intended#3-state-click";

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

test("the Flow monitor owns the exact 179 remaining catalog rows", () => {
  const counts = FLOW_ROWS.reduce((out, row) => {
    out[row.family] = (out[row.family] || 0) + 1;
    return out;
  }, {});
  assert.deepEqual(counts, EXPECTED_FLOW_GAP_COUNTS);
  assert.equal(FLOW_ROWS.length, 179);
  assert.equal(CHECK_IDS.length, 179);
  assert.equal(new Set(CHECK_IDS).size, 179);
  assert.equal(FLOW_ROWS.filter(isInactiveTemplateRow).length, 158);
});

const PAGE_SURFACES = [CLIMATE_READING_SURFACE, CONSULTING_REQUEST_SURFACE];

test("batch 22 plus the one-off repair: four rows use practice tests, ten use saved results, two use live reads, six are absent, and one restored step stays red", () => {
  const surfaces = new Set(FLOW_ROWS.map((row) => row.surface));
  for (const surface of Object.keys(FIN_B22_PRACTICE)) assert.equal(surfaces.has(surface), false, `${surface} left the monitor`);
  for (const surface of Object.keys(FIN_B22_LIVE_PROOFS)) assert.equal(surfaces.has(surface), true, `${surface} stays in the lane`);
  assert.deepEqual([...FIN_B22_LIVE_SURFACES, ...PAGE_SURFACES, ...FIN_B22_NOT_SHIPPED_SURFACES].sort(), Object.keys(FIN_B22_LIVE_PROOFS).sort(),
    "the saved-result checks, the page reads, the not-shipped reads and their proofs name the same rows");
  assert.equal(Object.keys(FIN_B22_PRACTICE).length, 4);
  assert.equal(FIN_B22_LIVE_SURFACES.size, 10);
  assert.equal(FIN_B22_NOT_SHIPPED_SURFACES.size, 7);
  // Each not-shipped claim names a real Flow row of the right family, so a journey that is corrected (its step
  // renamed or removed) turns this red and the claim has to go with it.
  for (const claim of NOT_SHIPPED_CLAIMS) {
    assert.ok(FLOW_ROWS.some((row) => row.surface === claim.surface && row.family === claim.family), claim.surface);
    assert.equal(FIN_B22_LIVE_PROOFS[claim.surface].shipped, true, claim.surface);
  }
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

  assert.equal(rows.length, 179);
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
  const live = new Set([...FIN_B22_LIVE_SURFACES, ...PAGE_SURFACES].map((surface) => `${surface}`));

  for (const source of FLOW_ROWS.filter((row) => !isInactiveTemplateRow(row))) {
    const result = byId.get(`flow:${source.family}:${source.surface}`);
    assert.ok(result, source.surface);
    assert.ok(result.detail.includes(source.surface), source.surface);
    assert.doesNotMatch(result.detail, /source (?:file )?(?:exists|was found)/i, source.surface);
    assert.doesNotMatch(result.detail, /named control has no exact final-result checker/i, source.surface);
    if (live.has(source.surface)) {
      assert.ok(["PASS", "FAIL", "skip"].includes(result.status), `${source.surface}: ${result.status}`);
    } else if (FIN_B22_NOT_SHIPPED_SURFACES.has(source.surface)) {
      // No GET client in this call, so the read cannot say "absent": a skip, never nothing-to-judge, never green.
      assert.equal(result.status, "skip", source.surface);
      assert.match(result.detail, /no GET client/, source.surface);
    } else {
      assert.ok(["NOT_PROVED", "na"].includes(result.status), source.surface);
    }
  }

  const notProved = rows.filter((row) => row.status === "NOT_PROVED").map((row) => row.id).sort();
  assert.deepEqual(notProved, []);
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

// ── generation 2: the live page reads and the notification devices ────────────

const CLIMATE_ROW = `flow:journey:${CLIMATE_READING_SURFACE}`;
const CONSULTING_ROW = `flow:journey:${CONSULTING_REQUEST_SURFACE}`;

function liveSiteFetch(overrides = {}) {
  const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
  const html = read("public/climate/index.html");
  const routes = {
    // a good reading: every state has a score and a colour, and it is stamped now
    "/api/climate": JSON.stringify({
      ok: true, as_of: new Date().toISOString(), national: { score: 54.3 },
      states: STATE_CODES.map((state) => ({ state, score: 50, color: "#F2E39B" })),
    }),
    "/climate/": html,
    "/consulting/": read("public/consulting/index.html"),
    ...overrides,
  };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="(\/climate\/[^"]+)"/g)) routes[m[1]] ??= read(path.join("public", m[1]));
  return async (url) => {
    const hit = routes[String(url).replace("https://fundhub.ai", "")];
    return hit === undefined ? new Response("", { status: 404 }) : new Response(hit, { status: 200 });
  };
}

test("the two page-read rows are judged by what the live public page holds, and neither is filed as not proved", async () => {
  const rows = await gapChecks({ fetchImpl: liveSiteFetch(), now: NOW });
  const climate = rows.find((row) => row.id === CLIMATE_ROW);
  const consulting = rows.find((row) => row.id === CONSULTING_ROW);
  assert.equal(climate.status, "FAIL");
  assert.match(climate.detail, /draws 5 of 51 state outlines/);
  assert.equal(consulting.status, "PASS");
  assert.match(consulting.detail, /opens an email to support@fhconsulting\.online, the support address the page lists/);
  for (const row of [climate, consulting]) assert.notEqual(row.status, "NOT_PROVED");
});

test("the climate row goes green when the page draws all 51, and the consulting row goes red when the form takes a card", async () => {
  // a state's own shape for each state: five corners, a different set for each (a placeholder box would be red)
  const full = JSON.stringify(Object.fromEntries(STATE_CODES.map((c, i) => [c, `M0,0 L${10 + i},${i % 7} L${20 + i * 2},${5 + (i % 9)} L${12 + i},${20 + (i % 5)} L3,${15 + (i % 3)} Z`])));
  const consulting = fs.readFileSync(path.join(REPO_ROOT, "public/consulting/index.html"), "utf8")
    .replace('<button class="btn" type="submit">', '<input name="cardnumber"><button class="btn" type="submit">');
  const rows = await gapChecks({
    fetchImpl: liveSiteFetch({
      "/climate/_next/static/chunks/app/page-b71b32356ee1b98a.js": `var a=JSON.parse('${full}');`,
      "/consulting/": consulting,
    }),
    now: NOW,
  });
  assert.equal(rows.find((row) => row.id === CLIMATE_ROW).status, "PASS");
  const red = rows.find((row) => row.id === CONSULTING_ROW);
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /card number or card details/);
});

test("with no GET client the page-read rows are skips, never green and never not proved", async () => {
  const rows = await gapChecks({ now: NOW });
  for (const id of [CLIMATE_ROW, CONSULTING_ROW]) {
    const row = rows.find((item) => item.id === id);
    assert.equal(row.status, "skip", id);
    assert.match(row.detail, /no GET client/);
  }
});

test("the web push row is judged from the devices a client turned on", async () => {
  const org = "00000000-0000-4000-8000-000000000001";
  const kit = makeStandIn(["client_push_subscriptions", "clients", "messages"]);
  try {
    const DAY = 86_400_000;
    const ago = (days) => new Date(KIT_NOW.getTime() - days * DAY).toISOString();
    kit.insert("clients", { id: "00000000-0000-4000-8000-0000000000c1", org_id: org, email: "pat@fundhub-client.test.io", is_demo: false, custom_fields: {} });
    const device = (n, over = {}) => ({
      id: `00000000-0000-4000-8000-0000000000d${n}`, org_id: org, client_id: "00000000-0000-4000-8000-0000000000c1",
      endpoint_hash: String(n).padStart(64, "b"), created_at: ago(30), last_success_at: ago(1), failure_count: 0,
      expired_at: null, revoked_at: null, ...over,
    });
    kit.insert("client_push_subscriptions", device(1));
    kit.insert("messages", {
      id: "00000000-0000-4000-8000-0000000000e1", org_id: org,
      client_id: "00000000-0000-4000-8000-0000000000c1", direction: "outbound",
      channel: "sms", status: "sent", template_key: "SMS-S04-01-CONFIRM",
      created_at: ago(1), updated_at: ago(1),
    });
    let row = (await gapChecks({ db: kit.handle(), orgId: org, now: KIT_NOW })).find((item) => item.id === "flow:message:provider:web-push-and-client-push");
    assert.equal(row.status, "PASS");
    assert.match(row.detail, /1 saved result passed/);

    kit.insert("client_push_subscriptions", device(2, { last_success_at: null, created_at: ago(9) }));
    row = (await gapChecks({ db: kit.handle(), orgId: org, now: KIT_NOW })).find((item) => item.id === "flow:message:provider:web-push-and-client-push");
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /1 of 2 saved results failed/);
    assert.notEqual(row.status, "NOT_PROVED");
  } finally {
    kit.close();
  }
});

// ── generation 3: steps the live page does not carry ──────────────────────────

const PUBLIC_DIR = path.join(REPO_ROOT, "public");

/** The live site, served from public/ (what ships), with overrides: path -> string. */
function publicFetch(overrides = {}) {
  return async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (Object.hasOwn(overrides, pathname)) return new Response(overrides[pathname], { status: 200 });
    let file = path.join(PUBLIC_DIR, pathname);
    if (pathname.endsWith("/")) file = path.join(file, "index.html");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("not found", { status: 404 });
    return new Response(fs.readFileSync(file), { status: 200 });
  };
}

test("six absent steps are nothing to judge while the restored state-click step stays red", async () => {
  const rows = await gapChecks({ fetchImpl: publicFetch(), now: NOW });
  for (const claim of NOT_SHIPPED_CLAIMS) {
    const row = rows.find((item) => item.id === notShippedRowId(claim));
    if (claim.surface === PRESENT_SURFACE) {
      assert.equal(row.status, "NOT_PROVED", claim.surface);
      assert.equal(row.na, undefined);
      assert.match(row.detail, /live page carries this step now.*"not a decision about you"/);
      continue;
    }
    assert.equal(row.status, "na", claim.surface);
    assert.equal(row.na.code, NOT_SHIPPED_CODE);
    assert.deepEqual(row.na.args, { family: claim.family, surface: claim.surface });
    assert.ok(row.detail.includes(claim.surface), claim.surface);
  }
  assert.equal(rows.some((item) => item.id === "flow:message:script:one-off senders in scripts/"), false);
});

test("the audit's check for that code is on the lane and agrees with the row", async () => {
  assert.equal(typeof naVerify[NOT_SHIPPED_CODE], "function");
  const claim = NOT_SHIPPED_CLAIMS[0];
  const args = { family: claim.family, surface: claim.surface };
  assert.equal(await naVerify[NOT_SHIPPED_CODE](args, { fetchImpl: publicFetch() }), true);
  const shipped = publicFetch({
    "/climate/": fs.readFileSync(path.join(PUBLIC_DIR, "climate/index.html"), "utf8")
      .replace(/<\/body>/i, "<h1>See how many banks in our book fit your state</h1></body>"),
  });
  assert.equal(await naVerify[NOT_SHIPPED_CODE](args, { fetchImpl: shipped }), false);
  const rows = await gapChecks({ fetchImpl: shipped, now: NOW });
  const row = rows.find((item) => item.id === notShippedRowId(claim));
  assert.equal(row.status, "NOT_PROVED", "the day the page carries it the row is not proved again, never green");
  assert.equal(rows.find((item) => item.id === notShippedRowId(NOT_SHIPPED_CLAIMS[1])).status, "NOT_PROVED");
});

test("with a page that cannot be read the seven rows are skips: never nothing-to-judge, never green", async () => {
  const down = async () => new Response("", { status: 503 });
  const rows = await gapChecks({ fetchImpl: down, now: NOW });
  for (const claim of NOT_SHIPPED_CLAIMS) {
    assert.equal(rows.find((item) => item.id === notShippedRowId(claim)).status, "skip", claim.surface);
  }
});
