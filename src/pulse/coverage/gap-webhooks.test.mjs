import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_ATTEMPTS } from "../../payments/commas-inbox.mjs";
import {
  CHECK_IDS,
  DEFAULT_BASE_URL,
  DOORS,
  STUCK_AFTER_ATTEMPTS,
  gapChecks
} from "./gap-webhooks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-webhooks.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

function urlFor(doorPath) {
  return `${DEFAULT_BASE_URL}${doorPath}`;
}

function fakeFetch(statusByPath) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const pathOnly = new URL(url).pathname;
    const status = Object.prototype.hasOwnProperty.call(statusByPath, pathOnly)
      ? statusByPath[pathOnly]
      : 405;
    return { status };
  };
  return { fetchImpl, calls };
}

function fakeDb(n) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (!/gap:stuck-failed/.test(sql)) throw new Error(`unexpected sql: ${sql}`);
      return { rows: [{ n }] };
    }
  };
  return db;
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
    assert.match(row.suggestedFix, /Do not POST a webhook/);
    assert.match(row.suggestedFix, /Do not replay a payment/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function assertGetOnly(calls) {
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.redirect, "manual");
  }
}

test("gap webhooks: source stays read-only", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /handleWebhook|handleCommasWebhook|processCommasInboxRow|\bdrain\s*\(/);
  assert.equal(STUCK_AFTER_ATTEMPTS, MAX_ATTEMPTS);
  assert.equal(STUCK_AFTER_ATTEMPTS, 10);
  assert.deepEqual([...CHECK_IDS], [
    "webhooks:twilio-status",
    "webhooks:commas",
    "webhooks:clickfunnels",
    "webhooks:calendar-booking",
    "webhooks:stuck-failed"
  ]);
  assert.equal(
    DOORS.find((d) => d.id === "webhooks:calendar-booking").path,
    "/api/webhooks/clickfunnels"
  );
});

test("gap webhooks: no fetch and no database skips every check", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 5);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "skip"));
});

test("gap webhooks: a refusing door and an empty failed queue are PASS", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "/api/webhooks/twilio-status": 405,
    "/api/webhooks/commas": 401,
    "/api/webhooks/clickfunnels": 405
  });
  const db = fakeDb(0);
  const rows = await gapChecks({ fetchImpl, db, orgId: ORG });
  assert.equal(rows.length, 5);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assertGetOnly(calls);
  const paths = calls.map((c) => new URL(c.url).pathname).sort();
  assert.deepEqual(paths, [
    "/api/webhooks/clickfunnels",
    "/api/webhooks/commas",
    "/api/webhooks/twilio-status"
  ]);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /SELECT count\(\*\)::int AS n/);
  assert.doesNotMatch(db.calls[0].sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(db.calls[0].params, [ORG, 10]);
  const calendar = rows.find((r) => r.id === "webhooks:calendar-booking");
  assert.match(calendar.detail, /ClickFunnels webhook/);
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.match(commas.detail, /answered 401/);
});

test("gap webhooks: 404 means that door is missing", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "/api/webhooks/twilio-status": 404,
    "/api/webhooks/commas": 405,
    "/api/webhooks/clickfunnels": 405
  });
  const rows = await gapChecks({ fetchImpl, db: fakeDb(0), orgId: ORG, baseUrl: "https://fundhub.ai/" });
  rows.forEach(shape);
  const twilio = rows.find((r) => r.id === "webhooks:twilio-status");
  assert.equal(twilio.status, "FAIL");
  assert.match(twilio.detail, /missing \(404\)/);
  assert.match(twilio.suggestedFix, /\/api\/webhooks\/twilio-status/);
  const rest = rows.filter((r) => r.id !== "webhooks:twilio-status");
  assert.ok(rest.every((r) => r.status === "PASS"));
  assert.ok(calls.every((c) => c.url.startsWith("https://fundhub.ai/api/webhooks/")));
  assert.ok(calls.every((c) => !c.url.includes("fundhub.ai//")));
});

test("gap webhooks: a shared ClickFunnels 404 fails the booking door too", async () => {
  const { fetchImpl, calls } = fakeFetch({
    "/api/webhooks/twilio-status": 405,
    "/api/webhooks/commas": 405,
    "/api/webhooks/clickfunnels": 404
  });
  const rows = await gapChecks({ fetchImpl, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  for (const id of ["webhooks:clickfunnels", "webhooks:calendar-booking"]) {
    const hit = rows.find((r) => r.id === id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, /missing \(404\)/);
  }
  assert.equal(calls.filter((c) => c.url.endsWith("/api/webhooks/clickfunnels")).length, 1);
  assert.equal(rows.find((r) => r.id === "webhooks:twilio-status").status, "PASS");
  assert.equal(rows.find((r) => r.id === "webhooks:commas").status, "PASS");
});

test("gap webhooks: 200 or 500 is not a mounted refusal", async () => {
  const { fetchImpl } = fakeFetch({
    "/api/webhooks/twilio-status": 405,
    "/api/webhooks/commas": 200,
    "/api/webhooks/clickfunnels": 500
  });
  const rows = await gapChecks({ fetchImpl, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /answered 200 \(expected 401 or 405\)/);
  const cf = rows.find((r) => r.id === "webhooks:clickfunnels");
  assert.equal(cf.status, "FAIL");
  assert.match(cf.detail, /answered 500/);
  assert.equal(rows.find((r) => r.id === "webhooks:calendar-booking").status, "FAIL");
  assert.equal(rows.find((r) => r.id === "webhooks:twilio-status").status, "PASS");
  assert.equal(rows.find((r) => r.id === "webhooks:stuck-failed").status, "PASS");
});

test("gap webhooks: stuck failed rows fail only that check", async () => {
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl, db: fakeDb(2), orgId: ORG });
  rows.forEach(shape);
  const stuck = rows.find((r) => r.id === "webhooks:stuck-failed");
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /2 Commas \(Fanbasis\) inbox rows are stuck failed/);
  assert.match(stuck.suggestedFix, /commas_inbox/);
  assert.match(stuck.suggestedFix, /existing commas inbox sweeper/);
  const doors = rows.filter((r) => r.id !== "webhooks:stuck-failed");
  assert.ok(doors.every((r) => r.status === "PASS"));
});

test("gap webhooks: one stuck row uses the singular line", async () => {
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl, db: fakeDb(1), orgId: ORG });
  const stuck = rows.find((r) => r.id === "webhooks:stuck-failed");
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /1 Commas \(Fanbasis\) inbox row is stuck failed/);
});

test("gap webhooks: a read error or a dead door is FAIL, not a throw", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("twilio-status")) throw new Error("socket down");
    return { status: 405 };
  };
  const db = {
    async query() {
      throw new Error("relation commas_inbox does not exist");
    }
  };
  const rows = await gapChecks({ fetchImpl, db, orgId: ORG });
  rows.forEach(shape);
  const twilio = rows.find((r) => r.id === "webhooks:twilio-status");
  assert.equal(twilio.status, "FAIL");
  assert.match(twilio.detail, /unreachable: socket down/);
  const stuck = rows.find((r) => r.id === "webhooks:stuck-failed");
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /commas_inbox does not exist/);
  assert.equal(rows.find((r) => r.id === "webhooks:commas").status, "PASS");
});

test("gap webhooks: database skip still probes the doors", async () => {
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl });
  rows.forEach(shape);
  assert.equal(rows.find((r) => r.id === "webhooks:stuck-failed").status, "skip");
  assert.ok(rows.filter((r) => r.id !== "webhooks:stuck-failed").every((r) => r.status === "PASS"));
});

test("gap webhooks: an empty count row is FAIL", async () => {
  const db = {
    async query() {
      return { rows: [] };
    }
  };
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl, db, orgId: ORG });
  const stuck = rows.find((r) => r.id === "webhooks:stuck-failed");
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /could not read stuck webhook rows/);
});

test("gap webhooks: the live handler still refuses GET and the four lanes are wired", () => {
  const api = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  const router = fs.readFileSync(path.join(ROOT, "src/http/router.mjs"), "utf8");
  const handler = fs.readFileSync(path.join(ROOT, "api/webhooks/[provider].mjs"), "utf8");
  const cf = fs.readFileSync(path.join(ROOT, "src/adapters/clickfunnels.mjs"), "utf8");
  assert.match(api, /path\.startsWith\("webhooks\/"\)/);
  assert.match(api, /route\s*=\s*webhooks/);
  assert.match(handler, /req\.method !== "POST"/);
  assert.match(handler, /status\(405\)/);
  assert.match(router, /provider === "twilio-status"/);
  assert.match(router, /commas:\s*\{[^}]*fn:\s*handleCommasWebhook/s);
  assert.match(router, /clickfunnels:\s*\{[^}]*fn:\s*handleClickFunnelsWebhook/s);
  assert.match(cf, /appointments\/scheduled_event\.created/);
  assert.match(cf, /booking\.created/);
});
