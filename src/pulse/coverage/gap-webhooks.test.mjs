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
  PROBE_TIMEOUT_MS,
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
  assert.deepEqual(up.calls.map((c) => c.provider).sort(), ["clickfunnels", "commas", "twilio-status"]);
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
  // Each lane is one pulse step with a 26 second ceiling, and the three GETs run side by side.
  assert.ok(PROBE_TIMEOUT_MS > 0 && PROBE_TIMEOUT_MS * 2 < 26000);
  assert.equal(seen.length, 3);
  for (const init of seen) {
    assert.equal(init.method, "GET");
    assert.ok(init.signal && typeof init.signal.addEventListener === "function", "every GET needs an abort signal");
  }
  const commas = rows.find((r) => r.id === "webhooks:commas");
  assert.equal(commas.status, "FAIL");
  assert.match(commas.detail, /unreachable: The operation was aborted due to timeout/);
  assert.equal(rows.find((r) => r.id === "webhooks:twilio-status").status, "PASS");
});
