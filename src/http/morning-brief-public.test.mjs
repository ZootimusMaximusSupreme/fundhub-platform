// GET /api/public/morning-brief — the no-login door behind the brief text's link.
// Pure unit test: a fake database, no DATABASE_URL needed.

import { test } from "node:test";
import assert from "node:assert/strict";

import handler, { NOT_FOUND, PUBLIC_BRIEF_HEADERS, safeBrief } from "../../api/public/morning-brief.mjs";
import { signBriefToken } from "../ops/brief-link.mjs";

const SECRET = "d4".repeat(32);
const ENV = { BRIEF_LINK_SECRET: SECRET };
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const ROW_ID = "11111111-2222-4333-8444-555555555555";
const SUGG_ID = "08f80ddf-5b06-4b97-ba26-96b42c60f35e";
const DATE = "2026-10-09";
const NOW = () => new Date("2026-10-09T20:00:00Z");
const TOKEN = signBriefToken({ orgId: ORG, kind: "morning", date: DATE, env: ENV });
const EVENING_TOKEN = signBriefToken({ orgId: ORG, kind: "evening", date: DATE, env: ENV });

/* A stored row that HAS every field that must never leak. */
function storedRow(kind = "morning") {
  return {
    id: ROW_ID,
    org_id: ORG,
    kind,
    brief_date: DATE,
    systems: { status: "red", line: "Systems: 3 of 4 checks green.", scorecard: { checks: [{ id: "login", status: "red" }, { id: "reg:auth/login", status: "green" }] } },
    marketing: { ads_line: "Ads and sales yesterday: $10.00 spend.", spend_cents: 1000, dashboard_url: "https://fundhub.ai/app/x.html?date=2026-10-09&k=SHOULDNOTLEAKSHOULDNOTLEAK000000" },
    money: { status: "not_connected", line: "Money: not connected yet." },
    team: { line: "Team, yesterday: 0 calls held.", company_8: { cash_cents: { value: 0 } }, closers: [{ name: "A", org_id: ORG }] },
    suggestions: [{ id: SUGG_ID, org_id: ORG, rule: "fix_broken_same_day", headline: "24 broken steps are still open." }],
    today: { status: "waiting", line: "Today: waiting." },
    text_body: `Good morning, Chris. Friday, October 9.\n\nSystems: 3 of 4 checks green.\n\nFull report: https://fundhub.ai/app/morning-brief.html?date=${DATE}&k=${TOKEN}`,
    report_url: `https://fundhub.ai/app/morning-brief.html?date=${DATE}&k=${TOKEN}`,
    sent_to_last4: "6457",
    dry_run: false,
    delivery_status: "sent",
    delivery_error: "twilio said something",
    provider_message_id: "SM123",
    sent_at: "2026-10-09T13:02:05.000Z",
    created_at: "2026-10-09T13:02:01.000Z",
    updated_at: "2026-10-09T13:02:05.000Z"
  };
}

function fakeDb({ row = storedRow(), org = ORG, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail) throw fail;
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) throw new Error("this door never writes");
      if (/FROM orgs/.test(sql)) return { rows: org ? [{ id: org }] : [] };
      if (/FROM morning_briefs/.test(sql)) {
        const [o, d, k] = params;
        const r = typeof row === "function" ? row(k) : row;
        return { rows: r && o === ORG && d === r.brief_date && k === r.kind ? [r] : [] };
      }
      throw new Error("unexpected query");
    }
  };
}

function res() {
  const out = { statusCode: 0, body: null, headers: {} };
  out.status = (code) => { out.statusCode = code; return out; };
  out.json = (body) => { out.body = body; return out; };
  out.setHeader = (k, v) => { out.headers[String(k).toLowerCase()] = v; return out; };
  return out;
}

async function call({ method = "GET", query = { date: DATE, k: TOKEN }, db = fakeDb(), env = ENV, now = NOW } = {}) {
  const r = res();
  await handler({ method, query, headers: {} }, r, { db, env, now });
  return r;
}

function assertSafeHeaders(r) {
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
}

const ONE_OFF = TOKEN.slice(0, -1) + (TOKEN.slice(-1) === "A" ? "B" : "A");

test("the headers the door promises", () => {
  assert.deepEqual({ ...PUBLIC_BRIEF_HEADERS }, {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer"
  });
});

test("a valid code returns the brief, with the safe headers", async () => {
  const r = await call();
  assert.equal(r.statusCode, 200);
  assertSafeHeaders(r);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.date, DATE);
  assert.equal(r.body.kind, "morning");
  assert.equal(r.body.brief.date, DATE);
  assert.equal(r.body.brief.systems.line, "Systems: 3 of 4 checks green.");
  assert.equal(r.body.brief.marketing.spend_cents, 1000);
  assert.equal(r.body.brief.suggestions[0].headline, "24 broken steps are still open.");
  assert.equal("text_body" in r.body.brief, false, "the page does not draw the text copy, so it is not sent");
});

test("the evening code opens the evening brief only", async () => {
  const db = fakeDb({ row: (k) => storedRow(k) });
  const ok = await call({ query: { date: DATE, kind: "evening", k: EVENING_TOKEN }, db });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.kind, "evening");
  const crossed = await call({ query: { date: DATE, kind: "evening", k: TOKEN }, db });
  assert.equal(crossed.statusCode, 404);
});

test("the safe copy never holds org_id, row ids, delivery facts, report_url or any code", async () => {
  const r = await call();
  const json = JSON.stringify(r.body);
  for (const bad of [ORG, ROW_ID, SUGG_ID, TOKEN, "6457", "SM123", "twilio said something", "SHOULDNOTLEAK", "sent_to_last4", "delivery_status", "delivery_error", "provider_message_id", "report_url", "\"org_id\"", "k="]) {
    assert.equal(json.includes(bad), false, `leaked ${bad.length > 8 ? bad.slice(0, 8) + "…" : bad}`);
  }
  assert.equal("id" in r.body.brief, false);
  assert.equal(r.body.brief.suggestions[0].id, undefined);
  // The page does not draw the full check list or the text copy, so neither is sent.
  assert.equal("scorecard" in r.body.brief.systems, false);
  assert.equal("text_body" in r.body.brief, false);
  assert.equal(json.includes("Full report"), false);
  assert.equal(json.includes("reg:auth/login"), false, "the internal check map is not sent");
  // The line the page does draw stays.
  assert.equal(r.body.brief.systems.line, "Systems: 3 of 4 checks green.");
  // The link inside another section keeps its address, loses its code.
  assert.equal(r.body.brief.marketing.dashboard_url, "https://fundhub.ai/app/x.html?date=2026-10-09");
});

test("a row id inside words is hidden too: a sentence, a proof string, the text", () => {
  const CLIENT = "a1b2c3d4-0000-4abc-8def-0123456789ab";
  const row = {
    ...storedRow(),
    systems: {
      status: "red",
      reds: [{ id: "repair-clock", proof: `answered 200 for linked client ${CLIENT}`, customer_sees: `Look at ${CLIENT.toUpperCase()} (analysis past the clock).` }],
      scorecard: { checks: [{ id: "login", status: "red", proof: `plan answered 200 for linked client ${CLIENT}; vault too for ${ROW_ID}` }] }
    },
    text_body: `Good morning, Chris.\n\nLook at ${CLIENT} today.\n\nFull report: https://fundhub.ai/app/morning-brief.html?date=${DATE}&k=${TOKEN}`
  };
  const b = safeBrief(row);
  const json = JSON.stringify(b);
  assert.doesNotMatch(json, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.equal(b.systems.reds[0].proof, "answered 200 for linked client (id hidden)");
  assert.equal(b.systems.reds[0].customer_sees, "Look at (id hidden) (analysis past the clock).");
  // The check list and the text copy are not sent at all (the page does not draw them).
  assert.equal("scorecard" in b.systems, false);
  assert.equal("text_body" in b, false);
  // Check names and the rest of the words stay as they were.
  assert.equal(b.systems.reds[0].id, "repair-clock");
});

test("safeBrief on an empty row is null", () => {
  assert.equal(safeBrief(null), null);
});

test("every failure is the same 404 body with the same headers, and no data", async () => {
  const cases = {
    "no code": { query: { date: DATE } },
    "empty code": { query: { date: DATE, k: "" } },
    "one character off": { query: { date: DATE, k: ONE_OFF } },
    "cut short": { query: { date: DATE, k: TOKEN.slice(0, 31) } },
    "too long": { query: { date: DATE, k: TOKEN + "A" } },
    "two codes": { query: { date: DATE, k: [TOKEN, TOKEN] } },
    "no date": { query: { k: TOKEN } },
    "bad date": { query: { date: "2026-02-30", k: TOKEN } },
    "other date": { query: { date: "2026-10-08", k: TOKEN } },
    "bad kind": { query: { date: DATE, kind: "weekly", k: TOKEN } },
    "wrong kind": { query: { date: DATE, kind: "evening", k: TOKEN } },
    "expired": { query: { date: DATE, k: TOKEN }, now: () => new Date("2026-10-24T08:00:00Z") },
    "future": { query: { date: DATE, k: TOKEN }, now: () => new Date("2026-10-08T20:00:00Z") },
    "no secret": { env: {} },
    "short secret": { env: { BRIEF_LINK_SECRET: "x".repeat(31) } },
    "masked secret": { env: { BRIEF_LINK_SECRET: "****************" + "x".repeat(48) } },
    "other secret": { env: { BRIEF_LINK_SECRET: "e5".repeat(32) } },
    "no brief that day": { db: fakeDb({ row: null }) },
    "no default org": { db: fakeDb({ org: null }) },
    "other org": { db: fakeDb({ org: "00000000-0000-4000-8000-000000000001" }) },
    "a query that breaks (not the database being down)": { db: fakeDb({ fail: new Error("column x does not exist") }) }
  };
  const origError = console.error;
  console.error = () => {};
  try {
    for (const [name, c] of Object.entries(cases)) {
      const r = await call(c);
      assert.equal(r.statusCode, 404, name);
      assert.deepEqual(r.body, { ...NOT_FOUND }, name);
      assert.deepEqual(r.body, { ok: false, error: "not_found" }, name);
      assertSafeHeaders(r);
      assert.deepEqual(Object.keys(r.headers).sort(), ["cache-control", "referrer-policy", "x-robots-tag"], name);
    }
  } finally {
    console.error = origError;
  }
});

test("junk never reaches the database", async () => {
  const db = fakeDb();
  await call({ query: { date: DATE, k: "nope" }, db });
  await call({ query: { date: "2020-01-01", k: TOKEN }, db });
  await call({ env: {}, db });
  assert.equal(db.calls.length, 0);
});

test("a valid request reads twice and never writes", async () => {
  const db = fakeDb();
  const r = await call({ db });
  assert.equal(r.statusCode, 200);
  assert.equal(db.calls.length, 2);
  for (const c of db.calls) assert.match(c.sql, /^\s*SELECT/i);
  assert.match(db.calls[0].sql, /SELECT id FROM orgs WHERE is_default LIMIT 1/);
});

test("any method but GET is 405 with the safe headers, and reads nothing", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]) {
    const db = fakeDb();
    const r = await call({ method, db });
    assert.equal(r.statusCode, 405, method);
    assert.equal(r.headers.allow, "GET");
    assert.equal(r.body.ok, false);
    assert.equal(JSON.stringify(r.body).includes("Chris"), false);
    assertSafeHeaders(r);
    assert.equal(db.calls.length, 0);
  }
});

test("a database that does not answer is the shared 503, with the safe headers and no data", async () => {
  for (const fail of [Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }), new Error("Connection terminated unexpectedly")]) {
    const r = await call({ db: fakeDb({ fail }) });
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "db_unavailable");
    assert.equal(r.body.db, "down");
    assert.equal(r.body.brief, undefined);
    assertSafeHeaders(r);
  }
});

test("a database-down answer before a valid code is still a 404 when the code is junk", async () => {
  const r = await call({ query: { date: DATE, k: "junk" }, db: fakeDb({ fail: new Error("Connection terminated unexpectedly") }) });
  assert.equal(r.statusCode, 404);
});
