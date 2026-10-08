import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gapChecks,
  OWNER_TOOLS,
  CHECK_IDS,
  SHOOT_PATH,
  BRAND_SQL,
  TILES_SQL,
  VIDEOS_SQL,
  TIER_MAP_SQL,
  PRODUCTS_SQL,
  JOURNEYS_SQL
} from "./gap-owner-tools.mjs";
import { PULSE_REGISTRY } from "../registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-owner-tools.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.startsWith("owner-tools:"));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.match(row.detail, /Did not change brand assets/);
  assert.match(row.detail, /Did not start a teleprompter session/);
  assert.match(row.detail, /Did not edit a page/);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not add another watcher/);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

const byId = (rows, id) => rows.find((row) => row.id === id);
const only = async (id, ctx) => byId(await gapChecks(ctx), id);

/* A db that answers each owner-tool query by its own text. Pass a model with
   the rows each query should return, or { throws: { <tag>: error } }. */
function toolDb(model = {}, calls = null) {
  const m = {
    brand: [{ org_id: ORG, ink: "#0A0A0A", paper: "#FCFCFC" }],
    tiles: [{ code: "t1" }, { code: "t2" }],
    videos: [{ id: "v1" }],
    map: [],
    products: [{ code: "p1" }],
    journeys: [],
    ...model
  };
  const tags = [
    [BRAND_SQL, "brand"], [TILES_SQL, "tiles"], [VIDEOS_SQL, "videos"],
    [TIER_MAP_SQL, "map"], [PRODUCTS_SQL, "products"], [JOURNEYS_SQL, "journeys"]
  ];
  return {
    async query(sql, params) {
      if (calls) calls.push({ sql, params });
      const hit = tags.find(([text]) => text === sql);
      if (!hit) throw new Error(`unexpected sql: ${String(sql).slice(0, 50)}`);
      const [, tag] = hit;
      if (m.throws && m.throws[tag]) throw m.throws[tag];
      return { rows: m[tag] };
    }
  };
}

const ctxWith = (db, extra = {}) => ({ db, orgId: ORG, ...extra });

function shoot(over = {}) {
  return {
    shoot: { id: "s1", scripts: [{ teleprompter_text: "Say this." }, { teleprompter_text: "And this." }] },
    plan_candidates: [],
    plan_estimated_minutes: 4,
    past_shoots: [],
    wpm: 150,
    as_of: "2026-10-08T12:00:00.000Z",
    ...over
  };
}

function fakeFetch(hit) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    const out = typeof hit === "function" ? hit(String(url)) : hit;
    if (out.throw) throw new Error(out.throw);
    return {
      status: out.status,
      async text() { return typeof out.body === "string" ? out.body : JSON.stringify(out.body); }
    };
  };
  return { fetchImpl, calls };
}

test("gap-owner-tools: one row per tool, all seven ids, none of them a registry id", () => {
  assert.equal(OWNER_TOOLS.length, 7);
  assert.deepEqual([...CHECK_IDS], [
    "owner-tools:galaxy",
    "owner-tools:ops-admin",
    "owner-tools:teleprompter",
    "owner-tools:brand-studio",
    "owner-tools:content-admin",
    "owner-tools:creative-factory",
    "owner-tools:journeys"
  ]);
  const registryIds = new Set(PULSE_REGISTRY.map((row) => row.id));
  for (const id of CHECK_IDS) assert.equal(registryIds.has(id), false);
});

test("gap-owner-tools: an empty run skips every row and does not throw", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  rows.forEach(shape);
  assert.deepEqual([...new Set(rows.map((row) => row.status))], ["skip"]);
  // A database with no company id cannot be scoped, so those rows skip too.
  const noOrg = await gapChecks({ db: toolDb() });
  assert.equal(noOrg.filter((row) => row.status === "skip").length, 7);
});

test("gap-owner-tools: Galaxy fails on an empty board or a crash, passes with people, and reads under the staff scope", async () => {
  const staffTx = { query: async () => ({ rows: [] }) };
  const seen = [];
  const ok = await only("owner-tools:galaxy", {
    db: toolDb(),
    orgId: ORG,
    scope: (fn) => fn(staffTx),
    probes: { companyActivity: async (tx, arg) => { seen.push({ tx, arg }); return { nodes: [{ id: "a" }, { id: "b" }] }; } }
  });
  shape(ok);
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /2 people and agents/);
  // The read ran on the staff scope's connection, not on the plain db.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tx, staffTx);
  assert.deepEqual(seen[0].arg, { orgId: ORG });

  const empty = await only("owner-tools:galaxy", ctxWith(toolDb(), { probes: { companyActivity: async () => ({ nodes: [] }) } }));
  shape(empty);
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /nobody on the board/);

  const crash = await only("owner-tools:galaxy", ctxWith(toolDb(), {
    probes: { companyActivity: async () => { throw new Error('column "x" does not exist postgres://u:p@h/d'); } }
  }));
  shape(crash);
  assert.equal(crash.status, "FAIL");
  assert.match(crash.detail, /column "x" does not exist/);
  assert.doesNotMatch(crash.detail, /u:p@h/);
});

test("gap-owner-tools: Galaxy runs the real company activity read; a board with one person passes, none fails", async () => {
  const staffRow = {
    id: "s1", name: "Pat Closer", role: "closer", is_demo: false, open_shift_id: null,
    shift_started_at: null, events_today: 0, events_15m: 0, calls_today: 0
  };
  const db = (staff) => ({
    async query(sql) {
      const text = String(sql);
      if (/demo_mode_enabled FROM orgs/.test(text)) return { rows: [{ demo_mode_enabled: false }] };
      if (/FROM staff s\b/.test(text)) return { rows: staff };
      if (/call_outcomes co[\s\S]*JOIN clients/.test(text)) return { rows: [] };
      if (/FROM staff_events e/.test(text)) return { rows: [] };
      if (/FROM agents/.test(text)) return { rows: [] };
      if (/FROM clients/.test(text) && !/SUM/.test(text)) return { rows: [] };
      if (/SUM\(cash_collected_cents\)/.test(text)) return { rows: [{ cash_cents: 0, funded_today: 0, deposits_today: 0 }] };
      throw new Error(`unexpected sql: ${text.slice(0, 60)}`);
    }
  });
  const ok = await only("owner-tools:galaxy", { db: db([staffRow]), orgId: ORG });
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /1 people and agents/);
  const none = await only("owner-tools:galaxy", { db: db([]), orgId: ORG });
  assert.equal(none.status, "FAIL");
});

test("gap-owner-tools: Ops Admin passes with numbers, fails with none or a crash, and asks for today", async () => {
  const seen = [];
  const ok = await only("owner-tools:ops-admin", ctxWith(toolDb(), {
    probes: { computePulse: async (tx, arg) => { seen.push(arg); return { kpis: { booked_calls: 3 } }; } }
  }));
  shape(ok);
  assert.equal(ok.status, "PASS");
  assert.deepEqual(seen, [{ orgId: ORG, period: "today" }]);

  for (const pulse of [null, {}, { kpis: null }, { kpis: "x" }]) {
    const bad = await only("owner-tools:ops-admin", ctxWith(toolDb(), { probes: { computePulse: async () => pulse } }));
    shape(bad);
    assert.equal(bad.status, "FAIL");
    assert.match(bad.detail, /no numbers/);
  }
  const crash = await only("owner-tools:ops-admin", ctxWith(toolDb(), {
    probes: { computePulse: async () => { throw new Error("relation job_heartbeats does not exist"); } }
  }));
  shape(crash);
  assert.equal(crash.status, "FAIL");
  assert.match(crash.detail, /relation job_heartbeats does not exist/);
});

test("gap-owner-tools: Teleprompter reads the shoot by GET; a blank script, a wrong body, or a bad status fails", async () => {
  const live = fakeFetch({ status: 200, body: shoot() });
  const ok = await only("owner-tools:teleprompter", { fetchImpl: live.fetchImpl, baseUrl: "https://fundhub.ai/" });
  shape(ok);
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /2 scripts, each with text/);
  assert.deepEqual(live.calls, [{ url: `https://fundhub.ai${SHOOT_PATH}`, method: "GET" }]);

  const idle = await only("owner-tools:teleprompter", { fetch: fakeFetch({ status: 200, body: shoot({ shoot: null }) }).fetchImpl });
  assert.equal(idle.status, "PASS");
  assert.match(idle.detail, /no shoot is open/);

  const blank = await only("owner-tools:teleprompter", {
    fetchImpl: fakeFetch({ status: 200, body: shoot({ shoot: { scripts: [{ teleprompter_text: "Hi" }, { teleprompter_text: "  " }, {}] } }) }).fetchImpl
  });
  shape(blank);
  assert.equal(blank.status, "FAIL");
  assert.match(blank.detail, /2 of 3 scripts in the open shoot have no teleprompter text/);

  for (const [hit, pattern] of [
    [{ status: 404, body: "" }, /answered 404/],
    [{ status: 500, body: "" }, /answered 500/],
    [{ status: 200, body: "<html>not json</html>" }, /not with a shoot/],
    [{ status: 200, body: { error: "x" } }, /not with a shoot/],
    [{ status: 200, body: { plan_candidates: [], past_shoots: [] } }, /not with a shoot/],
    [{ throw: "socket hang up" }, /socket hang up/]
  ]) {
    const row = await only("owner-tools:teleprompter", { fetchImpl: fakeFetch(hit).fetchImpl });
    shape(row);
    assert.equal(row.status, "FAIL", JSON.stringify(hit));
    assert.match(row.detail, pattern);
  }
});

test("gap-owner-tools: Brand Studio needs the company brand row with usable ink and paper", async () => {
  const calls = [];
  const ok = await only("owner-tools:brand-studio", ctxWith(toolDb({}, calls)));
  shape(ok);
  assert.equal(ok.status, "PASS");
  assert.deepEqual(calls.find((c) => c.sql === BRAND_SQL).params, [ORG]);

  const missing = await only("owner-tools:brand-studio", ctxWith(toolDb({ brand: [] })));
  shape(missing);
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /no brand row/);

  for (const row of [{ ink: "black", paper: "#FCFCFC" }, { ink: "#0A0A0A", paper: null }, { ink: "#0A0A0A", paper: "#FFF" }]) {
    const bad = await only("owner-tools:brand-studio", ctxWith(toolDb({ brand: [row] })));
    assert.equal(bad.status, "FAIL");
    assert.match(bad.detail, /ink and paper/);
  }
  const crash = await only("owner-tools:brand-studio", ctxWith(toolDb({ throws: { brand: new Error('relation "v_org_brand_effective" does not exist') } })));
  shape(crash);
  assert.equal(crash.status, "FAIL");
});

test("gap-owner-tools: Content needs tiles; only a missing video table is forgiven, like the screen", async () => {
  const ok = await only("owner-tools:content-admin", ctxWith(toolDb()));
  shape(ok);
  assert.equal(ok.status, "PASS");
  assert.match(ok.detail, /2 tiles, 1 videos, 1 products/);

  const noTiles = await only("owner-tools:content-admin", ctxWith(toolDb({ tiles: [] })));
  shape(noTiles);
  assert.equal(noTiles.status, "FAIL");
  assert.match(noTiles.detail, /no tiles/);

  const missingTable = Object.assign(new Error("relation content_videos does not exist"), { code: "42P01" });
  const forgiven = await only("owner-tools:content-admin", ctxWith(toolDb({ throws: { videos: missingTable } })));
  assert.equal(forgiven.status, "PASS");
  assert.match(forgiven.detail, /0 videos/);

  const denied = Object.assign(new Error("permission denied for table content_videos"), { code: "42501" });
  for (const tag of ["videos", "map", "tiles", "products"]) {
    const row = await only("owner-tools:content-admin", ctxWith(toolDb({ throws: { [tag]: denied } })));
    shape(row);
    assert.equal(row.status, "FAIL", tag);
    assert.match(row.detail, /permission denied/);
  }
});

test("gap-owner-tools: Creative Factory runs the real jobs list query; a crash fails, a non-list fails", async () => {
  const calls = [];
  const tx = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: "j1" }] }; } };
  const ok = await only("owner-tools:creative-factory", { db: tx, orgId: ORG, scope: (fn) => fn(tx) });
  shape(ok);
  assert.equal(ok.status, "PASS");
  const jobs = calls.filter((c) => /FROM generation_jobs/.test(c.sql));
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].sql, /^\s*SELECT/);
  assert.deepEqual(jobs[0].params, [2, 0]);

  const boom = { async query() { throw new Error('column "j.provider" does not exist'); } };
  const crash = await only("owner-tools:creative-factory", { db: boom, orgId: ORG, scope: (fn) => fn(boom) });
  shape(crash);
  assert.equal(crash.status, "FAIL");
  assert.match(crash.detail, /j\.provider/);

  const bad = await only("owner-tools:creative-factory", ctxWith(toolDb(), { probes: { creativeJobRows: async () => null } }));
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /did not come back as a list/);
});

test("gap-owner-tools: Journeys passes with none or a step list each, fails on steps that are not a list or a crash", async () => {
  const empty = await only("owner-tools:journeys", ctxWith(toolDb()));
  shape(empty);
  assert.equal(empty.status, "PASS");
  assert.match(empty.detail, /0 saved journeys/);

  const saved = await only("owner-tools:journeys", ctxWith(toolDb({ journeys: [{ key: "client", nodes: [] }, { key: "closer", nodes: [{ type: "sms" }] }] })));
  assert.equal(saved.status, "PASS");
  assert.match(saved.detail, /2 saved journeys/);

  const bad = await only("owner-tools:journeys", ctxWith(toolDb({ journeys: [{ key: "client", nodes: null }, { key: "closer", nodes: [] }] })));
  shape(bad);
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /1 saved journey has steps that are not a list/);

  const crash = await only("owner-tools:journeys", ctxWith(toolDb({ throws: { journeys: new Error('relation "journeys" does not exist') } })));
  shape(crash);
  assert.equal(crash.status, "FAIL");
});

test("gap-owner-tools: one row crashing leaves the others alone", async () => {
  const rows = await gapChecks(ctxWith(toolDb({ throws: { brand: new Error("boom") } }), {
    fetchImpl: fakeFetch({ status: 200, body: shoot() }).fetchImpl,
    probes: {
      companyActivity: async () => ({ nodes: [{}] }),
      computePulse: async () => ({ kpis: {} }),
      creativeJobRows: async () => []
    }
  }));
  rows.forEach(shape);
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS", "FAIL", "PASS", "PASS", "PASS"]);
});

test("gap-owner-tools: every query is a select, and the source writes nothing, starts nothing, reads no disk", () => {
  for (const sql of [BRAND_SQL, TILES_SQL, VIDEOS_SQL, TIER_MAP_SQL, PRODUCTS_SQL, JOURNEYS_SQL]) {
    assert.match(sql.trim(), /^SELECT/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
    assert.match(sql, /\$1/);
  }
  assert.doesNotMatch(SRC, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|writeFile/);
  assert.doesNotMatch(SRC, /BEGIN|COMMIT|ROLLBACK/);
  assert.doesNotMatch(SRC, /createFunction|second tripwire|new watchdog/i);
  assert.match(SRC, /export async function gapChecks/);
});
