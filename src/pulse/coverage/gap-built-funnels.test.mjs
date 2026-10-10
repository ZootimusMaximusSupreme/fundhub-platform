import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CACHE_BUST_PARAM,
  CHECK_IDS,
  DEADLINE_MS,
  LIVE_SQL,
  MAX_PAGES,
  MIN_LIVE_FUNNELS,
  SEEN_SQL,
  TIMEOUT_MS,
  bustedUrl,
  gapChecks,
  naVerify
} from "./gap-built-funnels.mjs";
import { GAP_FILES } from "./modules.mjs";
import { runGapLane } from "./run-slices.mjs";
import { laneCheckIds, makeLaneNaVerify } from "../self-audit.mjs";
import { NA_CODES, verifyNa } from "../na-conditions.mjs";
import { tagMeta } from "../../marketing/funnel-tracking.mjs";
import { FUNNEL_ROLES } from "../../marketing/funnel-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Code only. The header comments name the things this file refuses to do.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-built-funnels.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n");

const ID = CHECK_IDS[0];
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-09T13:00:00.000Z");

/* ---------- fakes ---------- */

/** A transaction that answers by exact SQL text. An unknown SQL throws, so a changed query cannot slip through. */
function txFrom(map, seen = []) {
  return {
    async query(sql, params) {
      const key = String(sql);
      seen.push({ sql: key, params });
      if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error(`unexpected sql: ${key.slice(0, 80)}`);
      const answer = map[key];
      return typeof answer === "function" ? answer(params) : answer;
    }
  };
}

const scopeFrom = (map, seen = []) => (fn) => fn(txFrom(map, seen));

/** The three pages of one live built funnel, as LIVE_SQL returns them (one row per page). */
function funnelRows(key, { id = `id-${key}`, pages = FUNNEL_ROLES } = {}) {
  const tag = `fnl-${key}`;
  return pages.map((role) => ({
    funnel_id: id,
    key,
    tag,
    role,
    page_path: `/${key}-${role}`,
    live_url: `https://apply.fundhub.ai/${key}-${role}`
  }));
}

function mapOf({ live = [], seen = 4, over = {} } = {}) {
  return {
    [LIVE_SQL]: { rows: live },
    [SEEN_SQL]: { rows: [{ n: seen }] },
    ...over
  };
}

/** A fetch that answers by address (without the cache-busting query). Every call is kept. */
function fetchFrom(table, calls = []) {
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    const bare = `${u.origin}${u.pathname}`;
    const hit = Object.prototype.hasOwnProperty.call(table, bare) ? table[bare] : { status: 404, text: "not found" };
    if (hit instanceof Error) throw hit;
    if (typeof hit === "function") return hit();
    return { status: hit.status, text: async () => hit.text ?? "" };
  };
  impl.calls = calls;
  return impl;
}

/** Every page of the given funnels answers 200 and carries its tag. */
function healthyTable(...keys) {
  const t = {};
  for (const key of keys) {
    for (const role of FUNNEL_ROLES) {
      t[`https://apply.fundhub.ai/${key}-${role}`] = {
        status: 200,
        text: `<html><head>${tagMeta(`fnl-${key}`)}</head><body>${role}</body></html>`
      };
    }
  }
  return t;
}

function shape(r) {
  assert.deepEqual(
    Object.keys(r),
    r.status === "na" ? ["id", "status", "detail", "suggestedFix", "na"] : ["id", "status", "detail", "suggestedFix"]
  );
  assert.equal(r.id, ID);
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(r.status));
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /Do not auto-fix/);
    assert.match(r.suggestedFix, /Chris never logs in/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

/* ---------- source and wiring ---------- */

test("gap built funnels: the source reads and GETs only, and reads no file", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/);
  assert.doesNotMatch(SRC, /\bmethod:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|readdirSync/);
  assert.doesNotMatch(SRC, /clickfunnels-pages|myclickfunnels|CLICKFUNNELS_API_KEY|Bearer/);
  for (const sql of [LIVE_SQL, SEEN_SQL]) {
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.match(bare, /^SELECT\b/i);
  }
});

test("gap built funnels: it reads built funnels that are live, and nothing else", () => {
  assert.match(LIVE_SQL, /f\.kind IS NOT NULL/);
  assert.match(LIVE_SQL, /f\.status = 'live'/);
  assert.match(LIVE_SQL, /marketing_funnel_pages/);
  assert.deepEqual([...CHECK_IDS], ["built-funnels:live-pages-answer"]);
  assert.equal(MIN_LIVE_FUNNELS, 1);
  assert.equal(CACHE_BUST_PARAM, "fh_cb");
  assert.ok(TIMEOUT_MS < DEADLINE_MS && DEADLINE_MS <= 20000, "a lane stays under 20 seconds");
});

test("gap built funnels: it is on the named list, exports its ids, and the code it says na with is on the list of codes", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-built-funnels.mjs"));
  const mod = await GAP_FILES.find(([name]) => name === "gap-built-funnels.mjs")[1]();
  assert.deepEqual(laneCheckIds(mod), [ID]);
  assert.equal(typeof mod.gapChecks, "function");
  assert.equal(typeof mod.naVerify["low-traffic"], "function");
  const rows = await gapChecks({ scope: scopeFrom(mapOf()), orgId: ORG, now: NOW });
  assert.ok(NA_CODES.includes(rows[0].na.code));
});

test("bustedUrl: https only, and the cache-busting query is the time", () => {
  assert.equal(bustedUrl("https://apply.fundhub.ai/blueprint", NOW), `https://apply.fundhub.ai/blueprint?fh_cb=${NOW.getTime()}`);
  assert.equal(bustedUrl("http://apply.fundhub.ai/blueprint", NOW), null);
  assert.equal(bustedUrl("not an address", NOW), null);
  assert.equal(bustedUrl(null, NOW), null);
});

/* ---------- PASS ---------- */

test("gap built funnels PASS: every page of every live built funnel answers 200 with its tag, read by GET with a cache-bust", async () => {
  const live = [...funnelRows("blueprint"), ...funnelRows("funding")];
  const seen = [];
  const f = fetchFrom(healthyTable("blueprint", "funding"));
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live }), seen), orgId: ORG, now: NOW, fetchImpl: f });
  assert.equal(rows.length, 1);
  shape(rows[0]);
  assert.equal(rows[0].status, "PASS", rows[0].detail);
  assert.match(rows[0].detail, /2 live built funnels, 6 pages: each answered 200 and carries its funnel tag/);
  // Six GETs, each with the time on it, and nothing but GET.
  assert.equal(f.calls.length, 6);
  for (const c of f.calls) {
    assert.equal(c.init.method, "GET");
    assert.equal(new URL(c.url).searchParams.get("fh_cb"), String(NOW.getTime()));
  }
  // The read is the live SQL for the one company, and nothing more (the table was not blind).
  assert.deepEqual(seen.map((s) => s.sql), [LIVE_SQL]);
  assert.deepEqual(seen[0].params, [ORG]);
});

test("gap built funnels PASS: the plain database handle works when no staff scope is given", async () => {
  const tx = txFrom(mapOf({ live: funnelRows("blueprint") }));
  const rows = await gapChecks({ db: tx, now: NOW, fetchImpl: fetchFrom(healthyTable("blueprint")) });
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /1 live built funnel, 3 pages/);
});

/* ---------- FAIL ---------- */

test("gap built funnels FAIL: a page answers 404", async () => {
  const table = healthyTable("blueprint");
  table["https://apply.fundhub.ai/blueprint-booking"] = { status: 404, text: "not found" };
  const rows = await gapChecks({
    scope: scopeFrom(mapOf({ live: funnelRows("blueprint") })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(table)
  });
  shape(rows[0]);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /1 problem on 1 live built funnel/);
  assert.match(rows[0].detail, /https:\/\/apply\.fundhub\.ai\/blueprint-booking answered 404/);
  assert.doesNotMatch(rows[0].detail, /fh_cb/, "the detail names the page, not the cache-busting address");
});

test("gap built funnels FAIL: a page answers 200 without its funnel tag (a blank page or another funnel's page)", async () => {
  const table = healthyTable("blueprint");
  table["https://apply.fundhub.ai/blueprint-landing"] = {
    status: 200,
    text: `<html><head>${tagMeta("fnl-another-one")}</head><body>hello</body></html>`
  };
  const rows = await gapChecks({
    scope: scopeFrom(mapOf({ live: funnelRows("blueprint") })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(table)
  });
  shape(rows[0]);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /blueprint-landing answered 200 but does not carry the funnel tag fnl-blueprint/);
});

test("gap built funnels FAIL: a page cannot be reached", async () => {
  const table = healthyTable("blueprint");
  table["https://apply.fundhub.ai/blueprint-thank_you"] = new Error("socket hang up");
  const rows = await gapChecks({
    scope: scopeFrom(mapOf({ live: funnelRows("blueprint") })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(table)
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /blueprint-thank_you could not be reached \(socket hang up\)/);
});

test("gap built funnels FAIL: a live funnel is missing a page on file, or a page has no live address", async () => {
  const missing = funnelRows("blueprint", { pages: ["landing", "booking"] });
  const noFetchNeeded = await gapChecks({
    scope: scopeFrom(mapOf({ live: missing })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(healthyTable("blueprint"))
  });
  assert.equal(noFetchNeeded[0].status, "FAIL");
  assert.match(noFetchNeeded[0].detail, /blueprint is live but has no thank_you page on file/);

  const noAddress = funnelRows("blueprint");
  noAddress[1].live_url = null;
  const rows = await gapChecks({
    scope: scopeFrom(mapOf({ live: noAddress })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(healthyTable("blueprint"))
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /blueprint booking page \(\/blueprint-booking\) has no live address/);

  // A live funnel with no page row at all is one row with a null role, and it is red.
  const bare = [{ funnel_id: "id-x", key: "x", tag: "fnl-x", role: null, page_path: null, live_url: null }];
  const none = await gapChecks({ scope: scopeFrom(mapOf({ live: bare })), orgId: ORG, now: NOW, fetchImpl: fetchFrom({}) });
  assert.equal(none[0].status, "FAIL");
  assert.match(none[0].detail, /x is live but has no landing or booking or thank_you page on file/);
});

test("gap built funnels FAIL: one wrong page among healthy funnels names that page and counts the funnels", async () => {
  const live = [...funnelRows("blueprint"), ...funnelRows("funding")];
  const table = healthyTable("blueprint", "funding");
  table["https://apply.fundhub.ai/funding-landing"] = { status: 500, text: "boom" };
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(table) });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /1 problem on 2 live built funnels/);
  assert.match(rows[0].detail, /funding-landing answered 500/);
  assert.doesNotMatch(rows[0].detail, /blueprint-/);
});

/* ---------- never a PASS when something was not read ---------- */

test("gap built funnels: no database is a skip, never a PASS", async () => {
  const rows = await gapChecks({});
  shape(rows[0]);
  assert.equal(rows[0].status, "skip");
});

test("gap built funnels: a failed read is a skip with the reason, never a PASS", async () => {
  const boom = mapOf({ over: { [LIVE_SQL]: () => { throw new Error("connection reset"); } } });
  const a = await gapChecks({ scope: scopeFrom(boom), orgId: ORG, now: NOW });
  assert.equal(a[0].status, "skip");
  assert.match(a[0].detail, /could not read the live built funnels: connection reset/);

  const noTable = mapOf({ over: { [SEEN_SQL]: () => { throw new Error("relation does not exist"); } } });
  const b = await gapChecks({ scope: scopeFrom(noTable), orgId: ORG, now: NOW });
  assert.equal(b[0].status, "skip");
  assert.match(b[0].detail, /could not read the funnel table/);
});

test("gap built funnels: pages to read and no fetch is a skip, not a PASS", async () => {
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live: funnelRows("blueprint") })), orgId: ORG, now: NOW, fetchImpl: null });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /no fetch in this run/);
});

test("gap built funnels: a page that does not answer before the deadline is a skip; a red page still wins", async () => {
  const live = funnelRows("blueprint");
  const hang = () => new Promise(() => {});
  const slow = healthyTable("blueprint");
  slow["https://apply.fundhub.ai/blueprint-booking"] = hang;
  const a = await gapChecks({
    scope: scopeFrom(mapOf({ live })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(slow), deadlineMs: 25
  });
  shape(a[0]);
  assert.equal(a[0].status, "skip");
  assert.match(a[0].detail, /1 page did not answer in time, so they were not all read/);

  const both = healthyTable("blueprint");
  both["https://apply.fundhub.ai/blueprint-booking"] = hang;
  both["https://apply.fundhub.ai/blueprint-landing"] = { status: 404, text: "" };
  const b = await gapChecks({
    scope: scopeFrom(mapOf({ live })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(both), deadlineMs: 25
  });
  assert.equal(b[0].status, "FAIL");
  assert.match(b[0].detail, /blueprint-landing answered 404/);
});

test("gap built funnels: more pages than the limit are named as not read, never passed", async () => {
  const live = [];
  const keys = [];
  for (let i = 0; i < 21; i += 1) {
    keys.push(`f${i}`);
    live.push(...funnelRows(`f${i}`));
  }
  assert.equal(live.length, 63);
  const f = fetchFrom(healthyTable(...keys));
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live })), orgId: ORG, now: NOW, fetchImpl: f });
  assert.equal(f.calls.length, MAX_PAGES);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /3 were over the 60 page limit/);
});

/* ---------- na: nothing to judge ---------- */

test("gap built funnels na: no live built funnel, in a table that has funnels, is nothing to judge with a code the audit can re-check", async () => {
  const seen = [];
  const f = fetchFrom({});
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live: [], seen: 4 }), seen), orgId: ORG, now: NOW, fetchImpl: f });
  shape(rows[0]);
  assert.equal(rows[0].status, "na");
  assert.match(rows[0].detail, /Judged the day one goes live/);
  assert.deepEqual(rows[0].na, {
    code: "low-traffic",
    args: { check: ID, what: "live built funnels", count: 0, min: 1, orgId: ORG }
  });
  assert.equal(f.calls.length, 0, "nothing is fetched when there is nothing to judge");
  assert.deepEqual(seen.map((s) => s.sql), [LIVE_SQL, SEEN_SQL]);
});

test("gap built funnels na: a table that reads as empty is a blind read, so it is a skip and not na", async () => {
  const rows = await gapChecks({ scope: scopeFrom(mapOf({ live: [], seen: 0 })), orgId: ORG, now: NOW });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /cannot say that none is live/);
  assert.equal(rows[0].na, undefined);
  const nan = await gapChecks({ scope: scopeFrom(mapOf({ live: [], seen: "x" })), orgId: ORG, now: NOW });
  assert.equal(nan[0].status, "skip");
});

test("gap built funnels na: a hand-mapped funnel (kind NULL) never counts, so the SQL asks for built ones only", async () => {
  // The fake answers by SQL text; the lane must ask LIVE_SQL, which holds the kind and status filters.
  const asked = [];
  const tx = {
    async query(sql) {
      asked.push(String(sql));
      return String(sql) === LIVE_SQL ? { rows: [] } : { rows: [{ n: 3 }] };
    }
  };
  const rows = await gapChecks({ db: tx, now: NOW });
  assert.equal(rows[0].status, "na");
  assert.match(asked[0], /kind IS NOT NULL/);
  assert.match(asked[0], /status = 'live'/);
});

/* ---------- naVerify ---------- */

const ARGS = { check: ID, what: "live built funnels", count: 0, min: 1 };

test("naVerify low-traffic: true at zero live built funnels in a table that has funnels, with the lane's own SQL", async () => {
  const seen = [];
  const ok = await naVerify["low-traffic"](ARGS, { scope: scopeFrom(mapOf({ live: [], seen: 4 }), seen), orgId: ORG });
  assert.equal(ok, true);
  assert.deepEqual(seen.map((s) => s.sql), [SEEN_SQL, LIVE_SQL]);
  assert.deepEqual(seen[1].params, [ORG]);
  assert.equal(await naVerify["low-traffic"](ARGS, { db: txFrom(mapOf({ live: [], seen: 1 })) }), true);
});

test("naVerify low-traffic: false when a built funnel is live, in the table is empty, no database, or the proof is about another row", async () => {
  const live = { scope: scopeFrom(mapOf({ live: funnelRows("blueprint"), seen: 4 })) };
  assert.equal(await naVerify["low-traffic"](ARGS, live), false);
  assert.equal(await naVerify["low-traffic"](ARGS, { scope: scopeFrom(mapOf({ live: [], seen: 0 })) }), false);
  assert.equal(await naVerify["low-traffic"](ARGS, { scope: scopeFrom(mapOf({ live: [], seen: null })) }), false);
  assert.equal(await naVerify["low-traffic"](ARGS, {}), false);
  assert.equal(await naVerify["low-traffic"]({ ...ARGS, check: "social:video-stats-stale" }, { scope: scopeFrom(mapOf()) }), false);
  assert.equal(await naVerify["low-traffic"](undefined, { scope: scopeFrom(mapOf()) }), false);
  // A read that throws is left to throw. The audit counts a throw as not true.
  const boom = mapOf({ over: { [SEEN_SQL]: () => { throw new Error("down"); } } });
  await assert.rejects(() => naVerify["low-traffic"](ARGS, { scope: scopeFrom(boom) }), /down/);
});

test("naVerify: one funnel being live is enough to make the claim false, whatever min the row carries", async () => {
  const lying = { ...ARGS, min: 99 };
  const live = { scope: scopeFrom(mapOf({ live: funnelRows("blueprint"), seen: 4 })) };
  assert.equal(await naVerify["low-traffic"](lying, live), false);
});

/* ---------- the audit, end to end ---------- */

test("the audit checks the na row again: true while none is live, false the day one goes live", async () => {
  // The lane runs the way the pulse runs it: through runGapLane, which keeps na and adds the lane id.
  const none = await runGapLane("gap-built-funnels", { scope: scopeFrom(mapOf({ live: [], seen: 4 })), orgId: ORG, now: NOW });
  assert.equal(none.length, 1);
  const row = none[0];
  assert.equal(row.id, ID, "an id that already carries its lane name is kept as it is");
  assert.equal(row.sliceId, "gap-built-funnels");
  assert.equal(row.status, "na");
  assert.equal(row.na.code, "low-traffic");

  const staff = scopeFrom(mapOf({ live: [], seen: 4 }));
  const laneNaVerify = makeLaneNaVerify({ scope: staff, now: NOW, gapFiles: GAP_FILES });
  const still = await verifyNa(row, { laneNaVerify });
  assert.equal(still.ok, true, JSON.stringify(still));

  // The same row, after a built funnel went live: the claim is no longer true.
  const nowLive = makeLaneNaVerify({ scope: scopeFrom(mapOf({ live: funnelRows("blueprint"), seen: 4 })), now: NOW, gapFiles: GAP_FILES });
  const broken = await verifyNa(row, { laneNaVerify: nowLive });
  assert.equal(broken.ok, false);

  // A table that reads empty cannot keep it standing either.
  const blind = makeLaneNaVerify({ scope: scopeFrom(mapOf({ live: [], seen: 0 })), now: NOW, gapFiles: GAP_FILES });
  assert.equal((await verifyNa(row, { laneNaVerify: blind })).ok, false);
});

test("the pulse reads the lane's red row: through runGapLane a wrong page is FAIL with the lane's namespaced id", async () => {
  const table = healthyTable("blueprint");
  table["https://apply.fundhub.ai/blueprint-landing"] = { status: 404, text: "" };
  const rows = await runGapLane("gap-built-funnels", {
    scope: scopeFrom(mapOf({ live: funnelRows("blueprint") })), orgId: ORG, now: NOW, fetchImpl: fetchFrom(table)
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "FAIL");
  assert.equal(rows[0].id, "built-funnels:live-pages-answer");
  assert.equal(rows[0].checkId, ID);
});
