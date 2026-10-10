import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_ATTEMPTS } from "../../payments/commas-inbox.mjs";
import { MAX_ATTEMPTS as COMMAS_MAX, STALE_CLAIM_MINUTES } from "../../payments/commas-inbox.mjs";
import {
  CHECK_IDS,
  DEFAULT_BASE_URL,
  DOORS,
  INBOUND_DOORS,
  INBOUND_DOORS_ID,
  PROBE_TIMEOUT_MS,
  RECEIPTS_ID,
  RECEIPTS_SQL,
  RECEIPT_CHANNELS,
  RECEIPT_GRACE_MINUTES,
  RECEIPT_LOOKBACK_HOURS,
  RECEIPT_NEWEST_SENDS,
  REFUSING_DB,
  STUCK_AFTER_ATTEMPTS,
  gapChecks,
  loadRouterProbe
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

// Two reads in this lane: the stuck count and the delivery receipts. The default receipts answer is
// the healthy one: every newest send has its receipt back.
const HEALTHY_RECEIPTS = Object.freeze([
  { channel: "sms", sends: 2, checked: 2, got: 2, newest_sent_at: "2026-10-08T18:00:00.000Z" },
  { channel: "email", sends: 5, checked: 3, got: 3, newest_sent_at: "2026-10-08T15:00:00.000Z" }
]);

function fakeDb(n, receiptRows = HEALTHY_RECEIPTS) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/gap:stuck-failed/.test(sql)) return { rows: [{ n }] };
      if (/gap:receipts-silent/.test(sql)) return { rows: receiptRows.map((r) => ({ ...r })) };
      throw new Error(`unexpected sql: ${sql}`);
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
  // The router is now called in this process, on purpose: the live GET answers 405 for every
  // provider name, so only the router can say whether a door is mounted. That one call is
  // pinned down hard. It may only carry an empty body, no headers, no secrets, and a database
  // that refuses every query. Nothing else in the file may reach a handler or the inbox worker.
  assert.doesNotMatch(SRC, /handleCommasWebhook|processCommasInboxRow|\bdrain\s*\(/);
  assert.equal((SRC.match(/handleWebhook/g) || []).length, 1, "handleWebhook is named once: the one import");
  assert.match(SRC, /const \{ handleWebhook: route \} = await import\("\.\.\/\.\.\/http\/router\.mjs"\);/);
  assert.match(SRC, /route\(\{\s*db: REFUSING_DB,\s*provider,\s*rawBody: "",\s*headers: \{\},\s*url,\s*env: \{\}\s*\}\)/);
  assert.equal((SRC.match(/\broute\(/g) || []).length, 1);
  assert.equal(STUCK_AFTER_ATTEMPTS, MAX_ATTEMPTS);
  assert.equal(STUCK_AFTER_ATTEMPTS, 10);
  assert.deepEqual([...CHECK_IDS], [
    "webhooks:twilio-status",
    "webhooks:commas",
    "webhooks:clickfunnels",
    "webhooks:calendar-booking",
    "webhooks:stuck-failed",
    "webhooks:inbound-doors-mounted",
    "webhooks:receipts-silent-after-sends"
  ]);
  assert.equal(
    DOORS.find((d) => d.id === "webhooks:calendar-booking").path,
    "/api/webhooks/clickfunnels"
  );
});

test("gap webhooks: no fetch and no database skips every check", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 7);
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
  assert.equal(rows.length, 7);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assertGetOnly(calls);
  // The three original doors, once each, plus the nine inbound doors, once each. Nothing else.
  const paths = calls.map((c) => new URL(c.url).pathname).sort();
  assert.deepEqual(paths, [
    "/api/webhooks/bland",
    "/api/webhooks/clickfunnels",
    "/api/webhooks/commas",
    "/api/webhooks/inquiry-removal",
    "/api/webhooks/lendflow",
    "/api/webhooks/mailgun",
    "/api/webhooks/mailgun-events",
    "/api/webhooks/postgrid",
    "/api/webhooks/resend",
    "/api/webhooks/submagic",
    "/api/webhooks/twilio",
    "/api/webhooks/twilio-status"
  ]);
  // Two reads, both SELECT only: the stuck count, then the delivery receipts.
  assert.equal(db.calls.length, 2);
  const stuckCall = db.calls.find((c) => /gap:stuck-failed/.test(c.sql));
  assert.match(stuckCall.sql, /SELECT count\(\*\)::int AS n/);
  assert.doesNotMatch(stuckCall.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual(stuckCall.params, [ORG, 10]);
  const receiptsCall = db.calls.find((c) => /gap:receipts-silent/.test(c.sql));
  assert.doesNotMatch(receiptsCall.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
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
  assert.equal(rows.find((r) => r.id === RECEIPTS_ID).status, "skip");
  const needDb = new Set(["webhooks:stuck-failed", RECEIPTS_ID]);
  assert.ok(rows.filter((r) => !needDb.has(r.id)).every((r) => r.status === "PASS"));
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

// A router that answers the way the real one does: 401 for a mounted provider, 404 for one it has never heard of.
function routerWith(missing = [], overrides = {}) {
  const calls = [];
  const routerProbe = async (provider, url) => {
    calls.push({ provider, url });
    if (Object.prototype.hasOwnProperty.call(overrides, provider)) {
      const v = overrides[provider];
      if (v instanceof Error) throw v;
      return { status: v };
    }
    return { status: missing.includes(provider) ? 404 : 401 };
  };
  return { routerProbe, calls };
}

test("gap webhooks: the live GET says 405 for a door that does not exist, so the router decides", async () => {
  // GET answers 405 for every provider name. This is the measured live behavior.
  const { fetchImpl } = fakeFetch({});
  const { routerProbe } = routerWith(["commas"]);
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /missing from the webhook router \(404 unknown provider\)/);
  assert.match(commas.suggestedFix, /\/api\/webhooks\/commas/);
  assert.equal(rows.find((r) => r.id === "webhooks:twilio-status").status, "PASS");
  assert.equal(rows.find((r) => r.id === "webhooks:clickfunnels").status, "PASS");
});

test("gap webhooks: the router answer is shared by the ClickFunnels door and the booking door, and a PASS says so", async () => {
  const { fetchImpl } = fakeFetch({});
  const down = routerWith(["clickfunnels"]);
  const rows = await gapChecks({ fetchImpl, routerProbe: down.routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  for (const id of ["webhooks:clickfunnels", "webhooks:calendar-booking"]) {
    assert.equal(rows.find((r) => r.id === id).status, "FAIL");
  }
  assert.equal(down.calls.filter((c) => c.provider === "clickfunnels").length, 1);

  const up = routerWith();
  const ok = await gapChecks({ fetchImpl, routerProbe: up.routerProbe, db: fakeDb(0), orgId: ORG });
  const twilio = ok.find((r) => r.id === "webhooks:twilio-status");
  assert.equal(twilio.status, "PASS");
  assert.match(twilio.detail, /live|answered 405/);
  assert.match(twilio.detail, /webhook router refused an unsigned empty probe \(401\), so it is mounted/);
  // The router is asked once per provider: the three original doors (the booking door shares ClickFunnels),
  // then each of the nine inbound doors.
  const asked = up.calls.map((c) => c.provider).sort();
  assert.deepEqual(asked, [
    ...["clickfunnels", "commas", "twilio-status"],
    ...INBOUND_DOORS.map((d) => d.provider)
  ].sort());
  assert.ok(up.calls.every((c) => c.url.startsWith(`${DEFAULT_BASE_URL}/api/webhooks/`)));
});

test("gap webhooks: a router that throws or answers 200 or 500 is not a mounted refusal", async () => {
  const { fetchImpl } = fakeFetch({});
  const { routerProbe } = routerWith([], {
    "twilio-status": new Error("router blew up"),
    commas: 200,
    clickfunnels: 500
  });
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const twilio = rows.find((r) => r.id === "webhooks:twilio-status");
  assert.equal(twilio.status, "FAIL");
  assert.match(twilio.detail, /could not be checked in the webhook router: router blew up/);
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /answered 200 to an unsigned empty probe/);
  const cf = rows.find((r) => r.id === "webhooks:clickfunnels");
  assert.equal(cf.status, "FAIL");
  assert.match(cf.detail, /answered 500 to an unsigned empty probe/);
});

test("gap webhooks: a live GET that fails is reported as before, and the router is not asked to hide it", async () => {
  const { fetchImpl } = fakeFetch({ "/api/webhooks/commas": 404 });
  const { routerProbe } = routerWith();
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /missing \(404\)/);
});

test("gap webhooks: the real router mounts all three doors and refuses an unknown one with 404", async () => {
  // Integration with the real src/http/router.mjs. This is the proof the check can fail:
  // a provider the router does not know comes back 404, a mounted one comes back 401.
  const probe = await loadRouterProbe();
  for (const door of DOORS) {
    const provider = door.path.split("/").pop();
    const out = await probe(provider, `${DEFAULT_BASE_URL}${door.path}`);
    assert.equal(out.status, 401, `${provider} should refuse an unsigned empty probe`);
  }
  const missing = await probe("a-door-that-does-not-exist", `${DEFAULT_BASE_URL}/api/webhooks/a-door-that-does-not-exist`);
  assert.equal(missing.status, 404);
  assert.match(String(missing.body?.error), /unknown provider/);
});

test("gap webhooks: with the real router, nothing is written and the database refuses if anything tries", async () => {
  await assert.rejects(() => REFUSING_DB.query("SELECT 1"), /never touches the database/);
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"), JSON.stringify(rows.filter((r) => r.status !== "PASS")));
  assert.match(rows[0].detail, /webhook router refused/);
});

test("gap webhooks: stuck rows are failed or half-done at the sweeper's own retry limit", () => {
  const inbox = fs.readFileSync(path.join(ROOT, "src/payments/commas-inbox.mjs"), "utf8");
  // The sweeper only claims rows below the limit, and only these statuses.
  assert.match(inbox, /WHERE attempts < \$1/);
  assert.match(inbox, /status IN \('pending', 'failed'\)/);
  assert.match(inbox, /status = 'processing'\s+AND claimed_at < now\(\) - \(\$2 \|\| ' minutes'\)::interval/);
  assert.equal(COMMAS_MAX, 10);
  const src = fs.readFileSync(path.join(HERE, "gap-webhooks.mjs"), "utf8");
  assert.match(src, /attempts >= \$2::int/);
  assert.match(src, /status = 'failed'/);
  assert.match(src, /status = 'processing' AND claimed_at < now\(\) - interval '\$\{Number\(STALE_CLAIM_MINUTES\)\} minutes'/);
  assert.equal(STALE_CLAIM_MINUTES, 15);
});

test("gap webhooks: the live handler answers 405 before it reads the provider name", () => {
  // This is why a live GET cannot prove a door is mounted. If this stops being true the
  // router probe is no longer the only way to tell, and the GET can carry more weight.
  const handler = fs.readFileSync(path.join(ROOT, "api/webhooks/[provider].mjs"), "utf8");
  const methodAt = handler.indexOf('req.method !== "POST"');
  const providerAt = handler.indexOf("req.query?.provider", methodAt);
  assert.ok(methodAt > 0 && providerAt > methodAt);
  assert.match(handler.slice(methodAt, providerAt), /status\(405\)/);
});

test("gap webhooks: every live GET carries a timeout, and a timed-out door is a FAIL", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init);
    if (String(url).includes("/commas")) throw new Error("The operation was aborted due to timeout");
    return { status: 405 };
  };
  const { routerProbe } = routerWith();
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  // Each lane is one pulse step with a 26 second ceiling, and the twelve GETs (three original doors,
  // nine inbound doors) run side by side, so the slowest wait is one timeout, not twelve.
  assert.ok(PROBE_TIMEOUT_MS > 0 && PROBE_TIMEOUT_MS * 2 < 26000);
  assert.equal(seen.length, 12);
  for (const init of seen) {
    assert.equal(init.method, "GET");
    assert.ok(init.signal && typeof init.signal.addEventListener === "function", "every GET needs an abort signal");
  }
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /unreachable: The operation was aborted due to timeout/);
  assert.equal(rows.find((r) => r.id === "webhooks:twilio-status").status, "PASS");
});

test("gap webhooks: the original read-only ban still holds for everything except the one pinned probe", () => {
  // The first version of the 'source stays read-only' test banned handleWebhook everywhere. That ban made
  // the door check blind (a live GET answers 405 for any name), so the router probe had to be allowed.
  // This keeps the first ban word for word and applies it to the whole file minus that one import
  // and that one call. Anything else that names a handler, the inbox worker or a drain still fails.
  const importLine = /const \{ handleWebhook: route \} = await import\("\.\.\/\.\.\/http\/router\.mjs"\);/;
  assert.match(SRC, importLine);
  const rest = SRC.replace(importLine, "");
  assert.doesNotMatch(rest, /handleWebhook|handleCommasWebhook|processCommasInboxRow|\bdrain\s*\(/);
});

test("gap webhooks: the real router answers the unsigned empty probe without running a single query", async () => {
  // The probe passes REFUSING_DB, which throws. If the router caught that throw and carried on, the
  // throw would hide a write attempt. This counts the calls instead, so a router that starts touching
  // the database before it checks the signature fails here, not in production.
  const { handleWebhook } = await import("../../http/router.mjs");
  const queries = [];
  const countingDb = {
    async query(sql) {
      queries.push(String(sql).slice(0, 80));
      throw new Error("refused");
    }
  };
  for (const door of DOORS) {
    const provider = door.path.split("/").pop();
    const out = await handleWebhook({
      db: countingDb, provider, rawBody: "", headers: {}, url: `${DEFAULT_BASE_URL}${door.path}`, env: {}
    });
    assert.equal(out.status, 401, `${provider} should refuse an unsigned empty probe`);
  }
  const gone = await handleWebhook({
    db: countingDb,
    provider: "a-door-that-does-not-exist",
    rawBody: "",
    headers: {},
    url: `${DEFAULT_BASE_URL}/api/webhooks/a-door-that-does-not-exist`,
    env: {}
  });
  assert.equal(gone.status, 404);
  assert.deepEqual(queries, [], "the probe must not reach the database");
});

// ===========================================================================
// Tier 1, 2026-10-09: webhooks:inbound-doors-mounted
// ===========================================================================

const NINE = ["twilio", "resend", "mailgun", "mailgun-events", "postgrid", "bland", "lendflow", "inquiry-removal", "submagic"];

function inboundRow(rows) {
  return rows.find((r) => r.id === INBOUND_DOORS_ID);
}

test("inbound doors: nine providers, each one the router really serves, none already watched", () => {
  assert.deepEqual(INBOUND_DOORS.map((d) => d.provider), NINE);
  const router = fs.readFileSync(path.join(ROOT, "src/http/router.mjs"), "utf8");
  const std = router.slice(router.indexOf("const STD = table({"), router.indexOf("const PROVIDER_ALIASES"));
  for (const name of NINE) {
    const named =
      new RegExp(`provider === "${name}"`).test(router) ||
      new RegExp(`(^|\\s)"?${name}"?:\\s*\\{`).test(std);
    assert.ok(named, `${name} is served by src/http/router.mjs`);
  }
  // The first four rows already watch these. The new row must not watch them twice.
  const watched = DOORS.map((d) => d.path.split("/").pop());
  for (const name of watched) assert.ok(!NINE.includes(name), `${name} is already a door row`);
  for (const d of INBOUND_DOORS) assert.ok(d.carries.length > 5 && !/[()]/.test(d.carries));
});

test("inbound doors: a healthy site is one PASS that names all nine", async () => {
  const { fetchImpl, calls } = fakeFetch({});
  const { routerProbe, calls: asked } = routerWith();
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const hit = inboundRow(rows);
  assert.equal(hit.status, "PASS");
  assert.equal(hit.suggestedFix, null);
  for (const name of NINE) assert.match(hit.detail, new RegExp(name));
  assert.match(hit.detail, /all 9 inbound doors are mounted/);
  assertGetOnly(calls);
  assert.equal(asked.filter((c) => NINE.includes(c.provider)).length, 9);
});

test("inbound doors: a live 404 on one door is FAIL and the row says which door and what it carries", async () => {
  const { fetchImpl } = fakeFetch({ "/api/webhooks/postgrid": 404 });
  const rows = await gapChecks({ fetchImpl, routerProbe: routerWith().routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const hit = inboundRow(rows);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /1 of 9 inbound doors are broken/);
  assert.match(hit.detail, /postgrid \(letter delivery, which starts the call clock\): live site answered 404/);
  assert.match(hit.suggestedFix, /Doors to look at: postgrid\./);
  assert.doesNotMatch(hit.detail, /lendflow|bland/);
  // The first four rows are untouched by an inbound door going down.
  assert.ok(rows.filter((r) => r.id !== INBOUND_DOORS_ID).every((r) => r.status === "PASS"));
});

test("inbound doors: the live GET says 405 for a door that does not exist, so the router decides", async () => {
  const { fetchImpl } = fakeFetch({});
  const { routerProbe } = routerWith(["lendflow"]);
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const hit = inboundRow(rows);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /lendflow \(funding round updates\): router has no door for it \(404 unknown provider\)/);
  assert.doesNotMatch(hit.detail, /live site/);
});

test("inbound doors: resend answers 503 (no secret) and submagic answers 400 (no project id), and both are mounted", async () => {
  const { fetchImpl } = fakeFetch({});
  const { routerProbe } = routerWith([], { resend: 503, submagic: 400, postgrid: 401 });
  const rows = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  assert.equal(inboundRow(rows).status, "PASS");
});

test("inbound doors: a router that accepts, crashes, hangs or 404s inside a handler is FAIL, never PASS", async () => {
  const { fetchImpl } = fakeFetch({});
  const routerProbe = async (provider) => {
    if (provider === "bland") return { status: 200, body: { ok: true } };
    if (provider === "twilio") throw new Error("router blew up");
    if (provider === "mailgun") return { status: 404, body: { ok: false, error: "case_not_found" } };
    if (provider === "resend") return { status: 500, body: null };
    if (provider === "submagic") return new Promise(() => {}); // never answers
    return { status: 401, body: { ok: false } };
  };
  const t0 = Date.now();
  const rows = await Promise.race([
    gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("lane hung")), PROBE_TIMEOUT_MS + 4000))
  ]);
  assert.ok(Date.now() - t0 >= PROBE_TIMEOUT_MS - 200, "the hung door waited for its timeout");
  rows.forEach(shape);
  const hit = inboundRow(rows);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /5 of 9 inbound doors are broken/);
  // More than three broken doors: the short form, so all five still fit in the 500 the pulse keeps.
  assert.match(hit.detail, /bland: router answered 200 to an unsigned empty probe/);
  assert.match(hit.detail, /twilio: router could not be checked \(router blew up\)/);
  assert.match(hit.detail, /mailgun: router answered 404 to an unsigned empty probe/);
  assert.match(hit.detail, /resend: router answered 500/);
  assert.match(hit.detail, /submagic: router could not be checked \(no answer in time\)/);
  assert.ok(hit.detail.length <= 500);
  assert.ok(rows.filter((r) => r.id !== INBOUND_DOORS_ID).every((r) => r.status === "PASS"));
});

test("inbound doors: a dead live site makes the row FAIL and a thrown fetch is not a throw", async () => {
  const fetchImpl = async () => { throw new Error("socket down"); };
  const rows = await gapChecks({ fetchImpl, routerProbe: routerWith().routerProbe, db: fakeDb(0), orgId: ORG });
  rows.forEach(shape);
  const hit = inboundRow(rows);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /9 of 9 inbound doors are broken/);
  assert.match(hit.detail, /live site did not answer \(socket down\)/);
  assert.ok(hit.detail.length <= 500, "the pulse clips a detail at 500");
  // Short form, so all nine are named in the detail itself, and in the fix text too.
  for (const name of NINE) {
    assert.match(hit.detail, new RegExp(`${name}: live site`));
    assert.match(hit.suggestedFix, new RegExp(name));
  }
});

test("inbound doors: no fetch is a skip, not a pass", async () => {
  const bare = await gapChecks({ db: fakeDb(0), orgId: ORG });
  const skip = inboundRow(bare);
  assert.equal(skip.status, "skip");
  assert.match(skip.detail, /no fetch in this run/);
  assert.equal(skip.suggestedFix, null);
});

test("inbound doors: the real router mounts all nine, answers the empty probe with no query and no outbound call, and 404s a wrong name", async () => {
  const { handleWebhook } = await import("../../http/router.mjs");
  const queries = [];
  const countingDb = { async query(sql) { queries.push(String(sql).slice(0, 80)); throw new Error("refused"); } };
  const outbound = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { outbound.push(String(url)); throw new Error("no outbound call allowed"); };
  try {
    for (const name of NINE) {
      const out = await handleWebhook({
        db: countingDb, provider: name, rawBody: "", headers: {}, url: `${DEFAULT_BASE_URL}/api/webhooks/${name}`, env: {}
      });
      assert.notEqual(out.status, 404, `${name} must be mounted`);
      assert.ok([400, 401, 403, 405, 422, 503].includes(out.status), `${name} answered ${out.status}`);
    }
    const gone = await handleWebhook({
      db: countingDb, provider: "lendflow-gone", rawBody: "", headers: {}, url: `${DEFAULT_BASE_URL}/api/webhooks/lendflow-gone`, env: {}
    });
    assert.equal(gone.status, 404);
    assert.match(String(gone.body?.error), /unknown provider/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(queries, [], "the probe must not reach the database");
  assert.deepEqual(outbound, [], "the probe must not call out");
});

test("inbound doors: with the real router, a door the router never heard of turns the row red", async () => {
  // Real src/http/router.mjs, one provider asked for under a name it does not know. This is what
  // a provider that was never registered looks like (lendflow was once exactly that).
  const real = await loadRouterProbe();
  const routerProbe = (provider, url) => real(provider === "lendflow" ? "lendflow-gone" : provider, url);
  const { fetchImpl } = fakeFetch({});
  const bad = await gapChecks({ fetchImpl, routerProbe, db: fakeDb(0), orgId: ORG });
  const hit = inboundRow(bad);
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /1 of 9 inbound doors are broken. lendflow/);
  assert.match(hit.detail, /404 unknown provider/);
  // And the same run with nothing renamed is green on the real router.
  const good = await gapChecks({ fetchImpl, db: fakeDb(0), orgId: ORG });
  assert.equal(inboundRow(good).status, "PASS", inboundRow(good).detail);
});

// ===========================================================================
// Tier 1, 2026-10-09: webhooks:receipts-silent-after-sends
// ===========================================================================

function receiptsRow(rows) {
  return rows.find((r) => r.id === RECEIPTS_ID);
}

const NOW = new Date("2026-10-09T13:00:00.000Z");

async function receiptsWith(rows, extra = {}) {
  const db = fakeDb(0, rows);
  const { fetchImpl } = fakeFetch({});
  const out = await gapChecks({ fetchImpl, routerProbe: routerWith().routerProbe, db, orgId: ORG, now: NOW, ...extra });
  out.forEach(shape);
  return { row: receiptsRow(out), db, all: out };
}

test("receipts: every newest send has its receipt is PASS, and the read is dated from the pulse clock", async () => {
  const { row, db } = await receiptsWith(HEALTHY_RECEIPTS);
  assert.equal(row.status, "PASS");
  assert.equal(row.suggestedFix, null);
  assert.match(row.detail, /2 of the newest 2 texts have a receipt/);
  assert.match(row.detail, /3 of the newest 3 emails have a receipt/);
  const call = db.calls.find((c) => /gap:receipts-silent/.test(c.sql));
  const [org, since, before, newest] = call.params;
  assert.equal(org, ORG);
  assert.equal(since, new Date(NOW.getTime() - RECEIPT_LOOKBACK_HOURS * 3600 * 1000).toISOString());
  assert.equal(before, new Date(NOW.getTime() - RECEIPT_GRACE_MINUTES * 60 * 1000).toISOString());
  assert.equal(newest, RECEIPT_NEWEST_SENDS);
});

test("receipts: texts went out and none has a receipt is FAIL, and it names the text door only", async () => {
  const { row } = await receiptsWith([
    { channel: "sms", sends: 6, checked: 3, got: 0, newest_sent_at: "2026-10-08T18:00:00.000Z" },
    { channel: "email", sends: 5, checked: 3, got: 3, newest_sent_at: "2026-10-08T15:00:00.000Z" }
  ]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /none of the newest 3 texts has a delivery receipt \(door \/api\/webhooks\/twilio-status, newest sent 2026-10-08 18:00 UTC\)/);
  assert.doesNotMatch(row.detail, /emails/);
  assert.match(row.suggestedFix, /\/api\/webhooks\/twilio-status/);
  assert.doesNotMatch(row.suggestedFix, /\/api\/webhooks\/resend/);
});

test("receipts: emails went out and none has a receipt is FAIL, and it names the email door only", async () => {
  const { row } = await receiptsWith([
    { channel: "sms", sends: 2, checked: 2, got: 2, newest_sent_at: "2026-10-08T18:00:00.000Z" },
    { channel: "email", sends: 9, checked: 3, got: 0, newest_sent_at: "2026-10-08T15:00:00.000Z" }
  ]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /none of the newest 3 emails has a delivery receipt \(door \/api\/webhooks\/resend/);
  assert.doesNotMatch(row.detail, /texts/);
  assert.match(row.suggestedFix, /RESEND_WEBHOOK_SECRET answers 503/);
  assert.doesNotMatch(row.suggestedFix, /twilio-status/);
});

test("receipts: both silent is one FAIL that names both, and a single send with no receipt is already FAIL", async () => {
  const { row } = await receiptsWith([
    { channel: "sms", sends: 1, checked: 1, got: 0, newest_sent_at: "2026-10-08T18:00:00.000Z" },
    { channel: "email", sends: 1, checked: 1, got: 0, newest_sent_at: "2026-10-08T15:00:00.000Z" }
  ]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /We sent texts and emails and no receipt came back/);
  assert.match(row.detail, /none of the newest 1 texts/);
  assert.ok(row.detail.length <= 500);
});

test("receipts: one lost receipt is not a silent door, but none of the newest three is", async () => {
  const lost = await receiptsWith([{ channel: "sms", sends: 3, checked: 3, got: 1, newest_sent_at: "2026-10-08T18:00:00.000Z" }]);
  assert.equal(lost.row.status, "PASS");
  assert.match(lost.row.detail, /1 of the newest 3 texts have a receipt/);
  const silent = await receiptsWith([{ channel: "sms", sends: 3, checked: 3, got: 0, newest_sent_at: "2026-10-08T18:00:00.000Z" }]);
  assert.equal(silent.row.status, "FAIL");
});

test("receipts: nothing sent in the window is PASS with the reason, not a FAIL", async () => {
  const { row } = await receiptsWith([]);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no texts to wait on in the last 72 hours/);
  assert.match(row.detail, /no emails to wait on in the last 72 hours/);
});

test("receipts: no database, no company, a failed read and unreadable counts are skip, never PASS", async () => {
  const { fetchImpl } = fakeFetch({});
  const noDb = receiptsRow(await gapChecks({ fetchImpl, orgId: ORG, now: NOW }));
  assert.equal(noDb.status, "skip");
  const noOrg = receiptsRow(await gapChecks({ fetchImpl, db: fakeDb(0), now: NOW }));
  assert.equal(noOrg.status, "skip");
  assert.match(noOrg.detail, /no company/);

  const failing = {
    async query(sql) {
      if (/gap:stuck-failed/.test(sql)) return { rows: [{ n: 0 }] };
      throw new Error("relation webhook_captures does not exist");
    }
  };
  const failed = receiptsRow(await gapChecks({ fetchImpl, db: failing, orgId: ORG, now: NOW }));
  assert.equal(failed.status, "skip");
  assert.match(failed.detail, /could not be read: relation webhook_captures does not exist/);

  for (const bad of [
    [{ channel: "sms", sends: 2, checked: "x", got: 1 }],
    [{ channel: "sms", sends: 2, checked: 1, got: 2 }],
    [{ channel: "email", sends: 2, checked: 2, got: null }]
  ]) {
    const { row } = await receiptsWith(bad);
    assert.equal(row.status, "skip", JSON.stringify(bad));
    assert.match(row.detail, /unreadable/);
  }
  const noRows = receiptsRow(await gapChecks({
    fetchImpl, orgId: ORG, now: NOW, db: { async query(sql) { return /gap:stuck-failed/.test(sql) ? { rows: [{ n: 0 }] } : {}; } }
  }));
  assert.equal(noRows.status, "skip");
});

test("receipts: a failed receipts read does not take the other six rows down", async () => {
  const db = { async query(sql) { if (/gap:stuck-failed/.test(sql)) return { rows: [{ n: 0 }] }; throw new Error("boom"); } };
  const { fetchImpl } = fakeFetch({});
  const rows = await gapChecks({ fetchImpl, routerProbe: routerWith().routerProbe, db, orgId: ORG, now: NOW });
  rows.forEach(shape);
  assert.equal(rows.length, 7);
  assert.equal(rows.filter((r) => r.status === "PASS").length, 6);
  assert.equal(receiptsRow(rows).status, "skip");
});

test("receipts: the read matches each send to its own receipt, from the send on, for real texts and emails only", () => {
  const sql = RECEIPTS_SQL;
  assert.match(sql, /gap:receipts-silent/);
  // Reads two tables and nothing else.
  assert.deepEqual([...new Set([...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)].map((m) => m[1]))].sort(), ["messages", "sends", "webhook_captures"]);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
  // Each send is matched to its own receipt by the vendor's message id found in the stored body.
  assert.match(sql, /position\(s\.sid in c\.raw_body\) > 0/);
  assert.match(sql, /m\.provider_message_id AS sid/);
  assert.match(sql, /c\.created_at >= s\.created_at/);
  // Real, accepted, outbound sends of the two kinds.
  assert.match(sql, /m\.direction = 'outbound'/);
  assert.match(sql, /COALESCE\(m\.is_demo, false\) = false/);
  assert.match(sql, /m\.provider_message_id IS NOT NULL/);
  assert.match(sql, /m\.channel = 'sms' AND m\.provider = 'twilio'/);
  assert.match(sql, /m\.channel = 'email' AND m\.provider = 'resend'/);
  // The two kinds are joined with OR. Join them with AND and no send can match both, so the read
  // finds nothing to wait on and the row reads PASS forever.
  assert.match(
    sql,
    /AND \(\s*\(m\.channel = 'sms' AND m\.provider = 'twilio'\)\s+OR \(m\.channel = 'email' AND m\.provider = 'resend'\)\s*\)/
  );
  // Window and size come from the four parameters: org, start, grace cut-off, newest N per channel.
  assert.match(sql, /m\.org_id = \$1::uuid/);
  assert.match(sql, />= \$2::timestamptz/);
  assert.match(sql, /< \$3::timestamptz/);
  assert.match(sql, /s\.rn <= \$4::int/);
  assert.match(sql, /PARTITION BY m\.channel/);
  // Newest first. Flip this to ASC and the row checks the OLDEST three sends in the window,
  // so a door that died yesterday stays green. The unit test cannot run this SQL, so the text is pinned.
  assert.match(
    sql,
    /row_number\(\) OVER \(\s*PARTITION BY m\.channel\s+ORDER BY COALESCE\(m\.last_attempt_at, m\.created_at\) DESC\s*\) AS rn/
  );
  assert.doesNotMatch(sql, /\bASC\b/);
  assert.equal((sql.match(/\bORDER BY\b/g) || []).length, 1, "one sort, and it is the newest-first one");
  // The receipt door each channel reads is the provider id the router stores.
  for (const c of RECEIPT_CHANNELS) assert.ok(sql.includes(`'${c.door}'`), c.door);
  assert.deepEqual(RECEIPT_CHANNELS.map((c) => c.door), ["twilio-status", "resend"]);
  // The channel-to-door map, exact. The loop above passes if a door name only shows up somewhere
  // else in the text (m.provider = 'resend' also holds the word resend), so pin the CASE itself:
  // texts read the twilio-status door, everything else (email) reads the resend door.
  assert.match(
    sql,
    /c\.provider = CASE s\.channel WHEN 'sms' THEN 'twilio-status' ELSE 'resend' END/
  );
  const doorFor = (channel) => {
    const m = sql.match(/CASE s\.channel WHEN '([a-z]+)' THEN '([a-z-]+)' ELSE '([a-z-]+)' END/);
    assert.ok(m, "the CASE is there");
    return channel === m[1] ? m[2] : m[3];
  };
  for (const c of RECEIPT_CHANNELS) assert.equal(doorFor(c.channel), c.door, `${c.channel} reads the ${c.door} door`);
  // "got" counts the sends that HAVE a receipt, and all three conditions must hold for the same capture.
  // Flip it to NOT EXISTS and a dead door reads as healthy. Join the conditions with OR and any capture matches.
  assert.doesNotMatch(sql, /NOT EXISTS/i);
  assert.match(
    sql,
    /count\(\*\) FILTER \(WHERE EXISTS \(\s*SELECT 1\s+FROM webhook_captures c\s+WHERE c\.provider = CASE s\.channel WHEN 'sms' THEN 'twilio-status' ELSE 'resend' END\s+AND c\.created_at >= s\.created_at\s+AND position\(s\.sid in c\.raw_body\) > 0\s*\)\)::int AS got/
  );
  // One row per channel: the newest N per channel, counted together.
  assert.match(sql, /count\(\*\)::int AS checked/);
  // The "newest sent" time in the red detail is the latest send, not the earliest.
  assert.match(sql, /max\(s\.sent_at\) AS newest_sent_at/);
  assert.match(sql, /FROM sends s\s+WHERE s\.rn <= \$4::int\s+GROUP BY s\.channel\s*$/);
  assert.deepEqual([RECEIPT_LOOKBACK_HOURS, RECEIPT_GRACE_MINUTES, RECEIPT_NEWEST_SENDS], [72, 60, 3]);
});

test("receipts: the id the read searches for is the id the receipt adapters match on, and the router keeps the receipt under the door name", () => {
  const twilioStatus = fs.readFileSync(path.join(ROOT, "src/adapters/twilio-status.mjs"), "utf8");
  const resendEvents = fs.readFileSync(path.join(ROOT, "src/adapters/resend-events.mjs"), "utf8");
  const router = fs.readFileSync(path.join(ROOT, "src/http/router.mjs"), "utf8");
  const twilioProvider = fs.readFileSync(path.join(ROOT, "src/messaging/providers/twilio.mjs"), "utf8");
  // Both adapters move the message row on messages.provider_message_id, which is the column the read searches for.
  assert.match(twilioStatus, /WHERE provider_message_id = \$1/);
  assert.match(resendEvents, /provider_message_id = \$1 AND direction = 'outbound' AND channel = 'email'/);
  // The receipt body carries that id: Twilio form body MessageSid, Resend JSON data.email_id.
  const sid = "SM0123456789abcdef0123456789abcdef";
  const twilioBody = `MessageSid=${sid}&MessageStatus=delivered&To=%2B15551230000`;
  const emailId = "11111111-2222-4333-8444-555555555555";
  const resendBody = JSON.stringify({ type: "email.delivered", data: { email_id: emailId, to: ["a@b.co"] } });
  assert.ok(twilioBody.includes(sid) && resendBody.includes(emailId));
  assert.match(twilioStatus, /MessageSid/);
  assert.match(resendEvents, /data\.email_id/);
  // The router writes provider = the door name, and only for accepted (status 200) receipts, so a refused one leaves no row.
  assert.match(router, /INSERT INTO webhook_captures/);
  assert.match(router, /String\(provider\)/);
  assert.match(router, /out\.status !== 200\) return;/);
  assert.match(router, /provider === "twilio-status"/);
  assert.match(router, /provider === "resend"/);
  // The send asks Twilio to call the status door back.
  assert.match(twilioProvider, /\/api\/webhooks\/twilio-status/);
  assert.match(twilioProvider, /StatusCallback/);
  // And an unconfigured or wrongly signed receipt is refused without a row, which is the silence this row watches for.
  assert.match(resendEvents, /status: 503, reason: "not_configured"/);
  assert.match(resendEvents, /status: 401, reason: "bad_signature"/);
  assert.match(twilioStatus, /status: 401, reason: "bad_signature"/);
});

test("receipts: the lane source stays free of writes and posts after the Tier 1 rows", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.equal((SRC.match(/handleWebhook/g) || []).length, 1, "the router is still named once");
  assert.equal((SRC.match(/\broute\(/g) || []).length, 1, "and still called from one place");
});
