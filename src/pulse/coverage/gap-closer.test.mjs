import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_IDS, DISPOSITION_SQL, PAGES, closerDeskPageReport, gapChecks } from "./gap-closer.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-closer.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T20:00:00.000Z");

const GOOD = {
  "/app/closer-dashboard.html": '<title>Fundhub — Closer Dashboard</title><script src="shell.js"></script>',
  "/app/present.html": '<title>Closer · Present</title><script src="data.js"></script><script src="present.js"></script>',
  "/app/present.js": 'fetch("/api/closer-deck", { body: JSON.stringify({ action: "log_disposition" }) })'
};

/* A fetch that serves a page from a map. A value may be a string (a 200 page),
   a number (that status, empty body), or an Error (the call throws). */
function pagesFetch(map = GOOD) {
  const seen = [];
  const fn = async (url, opts) => {
    const p = new URL(url).pathname;
    seen.push({ url, opts });
    const v = map[p];
    if (v instanceof Error) throw v;
    if (typeof v === "number") return { status: v, async text() { return ""; } };
    if (v === undefined) return { status: 404, async text() { return "missing"; } };
    return { status: 200, async text() { return v; } };
  };
  fn.seen = seen;
  return fn;
}

function dbWith(first = { n_saved: 0, n_deck: 0 }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [first] };
    }
  };
}

function check(rows, id) {
  const hit = rows.find((r) => r.id === id);
  assert.ok(hit, id);
  assert.ok(["PASS", "FAIL", "skip"].includes(hit.status));
  assert.equal(typeof hit.detail, "string");
  assert.ok(hit.detail.length > 0);
  assert.ok("suggestedFix" in hit);
  if (hit.status === "FAIL") {
    assert.match(hit.suggestedFix, /Present log_disposition is the one tripwire/);
    assert.match(hit.suggestedFix, /Do not start a call/);
    assert.match(hit.suggestedFix, /Do not auto-fix/);
  } else {
    assert.equal(hit.suggestedFix, null);
  }
  return hit;
}

test("two checks, fixed ids", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  assert.deepEqual(CHECK_IDS, ["closer:desk-pages", "closer:held-disposition"]);
  assert.ok(rows.every((r) => r.status === "skip"), "no fetch and no db means both skip");
  assert.equal((await gapChecks()).length, 2);
});

test("pages: all three answer and are the right pages", async () => {
  const fetchImpl = pagesFetch();
  const rows = await gapChecks({ fetchImpl, baseUrl: "https://fundhub.ai/" });
  const hit = check(rows, "closer:desk-pages");
  assert.equal(hit.status, "PASS");
  assert.deepEqual(fetchImpl.seen.map((s) => s.url), PAGES.map((p) => `https://fundhub.ai${p.path}`));
  assert.ok(fetchImpl.seen.every((s) => s.opts.method === "GET"));
});

test("pages: ctx.fetch is used when ctx.fetchImpl is absent", async () => {
  const rows = await gapChecks({ fetch: pagesFetch() });
  assert.equal(check(rows, "closer:desk-pages").status, "PASS");
});

test("pages: a wrong page behind a 200 fails, and says which marker is gone", async () => {
  const cases = [
    ["/app/closer-dashboard.html", "<title>Login</title>", /Closer Dashboard is not the Closer Dashboard page/],
    ["/app/closer-dashboard.html", "<title>Closer Dashboard</title>", /does not load shell\.js/],
    ["/app/present.html", '<title>Closer · Present</title><script src="shell.js"></script><script src="present.js"></script>', /loads shell\.js, so the deck bounces/],
    ["/app/present.html", "<title>Closer · Present</title>", /does not load present\.js/],
    ["/app/present.js", 'fetch("/api/closer-deck")', /does not post log_disposition/],
    ["/app/present.js", 'log_disposition("x")', /does not call \/api\/closer-deck/]
  ];
  for (const [p, body, why] of cases) {
    const rows = await gapChecks({ fetchImpl: pagesFetch({ ...GOOD, [p]: body }) });
    const hit = check(rows, "closer:desk-pages");
    assert.equal(hit.status, "FAIL", p);
    assert.match(hit.detail, why);
  }
});

test("pages: a page that is down is the registry's red, so this row skips and names it", async () => {
  const dash = await gapChecks({ fetchImpl: pagesFetch({ ...GOOD, "/app/closer-dashboard.html": 404 }) });
  const d = check(dash, "closer:desk-pages");
  assert.equal(d.status, "skip");
  assert.match(d.detail, /Closer Dashboard answered 404; reg:closer-dashboard reports a page that is down/);

  const present = await gapChecks({ fetchImpl: pagesFetch({ ...GOOD, "/app/present.html": 500 }) });
  assert.match(check(present, "closer:desk-pages").detail, /reg:present/);

  const boom = await gapChecks({ fetchImpl: pagesFetch({ ...GOOD, "/app/present.js": new Error("socket hang up") }) });
  const b = check(boom, "closer:desk-pages");
  assert.equal(b.status, "skip");
  assert.match(b.detail, /socket hang up/);
});

test("pages: one page down and another wrong is still a FAIL and mentions both", async () => {
  const rows = await gapChecks({
    fetchImpl: pagesFetch({ ...GOOD, "/app/closer-dashboard.html": 404, "/app/present.js": "nothing here" })
  });
  const hit = check(rows, "closer:desk-pages");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /does not post log_disposition/);
  assert.match(hit.detail, /Also: Closer Dashboard answered 404/);
});

test("closerDeskPageReport counts the pages it could read", async () => {
  const ok = await closerDeskPageReport({ fetchImpl: pagesFetch() });
  assert.deepEqual(ok, { wrong: [], down: [], read: 3 });
  const part = await closerDeskPageReport({ fetchImpl: pagesFetch({ ...GOOD, "/app/present.js": 503 }) });
  assert.equal(part.read, 2);
  assert.equal(part.down.length, 1);
});

test("dispositions: nothing missing is PASS; the window and the wait are sent to the query", async () => {
  const db = dbWith();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(check(rows, "closer:held-disposition").status, "PASS");
  assert.equal(db.calls.length, 1);
  const [org, since, cutoff] = db.calls[0].params;
  assert.equal(org, ORG);
  assert.equal(since, new Date(NOW.getTime() - 14 * 24 * 3600e3).toISOString());
  assert.equal(cutoff, new Date(NOW.getTime() - 2 * 3600e3).toISOString());
  assert.equal(db.calls[0].sql, DISPOSITION_SQL);
});

test("dispositions: a saved disposition with no call_outcomes row fails and says fetchContext is empty", async () => {
  const rows = await gapChecks({ db: dbWith({ n_saved: 2, n_deck: 0 }), orgId: ORG, now: NOW });
  const hit = check(rows, "closer:held-disposition");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 clients saved a closer disposition and call_outcomes has no row, so fetchContext has no recent call/);
});

test("dispositions: deck use with no logged call fails; both counts are named", async () => {
  const deck = check(await gapChecks({ db: dbWith({ n_saved: 0, n_deck: 1 }), orgId: ORG, now: NOW }), "closer:held-disposition");
  assert.equal(deck.status, "FAIL");
  assert.match(deck.detail, /1 client had the closer deck used more than 2 hours ago and no call outcome was logged/);
  const both = check(await gapChecks({ db: dbWith({ n_saved: "1", n_deck: "3" }), orgId: ORG, now: NOW }), "closer:held-disposition");
  assert.match(both.detail, /1 client saved/);
  assert.match(both.detail, /3 clients had the closer deck used/);
});

test("dispositions: a database error is a FAIL with the reason, never a PASS", async () => {
  const db = { async query() { throw new Error("relation call_outcomes does not exist"); } };
  const hit = check(await gapChecks({ db, orgId: ORG, now: NOW }), "closer:held-disposition");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /could not read dispositions: relation call_outcomes does not exist/);
});

test("dispositions: no db or no company skips", async () => {
  assert.equal(check(await gapChecks({ orgId: ORG }), "closer:held-disposition").status, "skip");
  assert.equal(check(await gapChecks({ db: dbWith() }), "closer:held-disposition").status, "skip");
});

test("dispositions SQL: leaves out demo clients, counts the three deck sends, guards bad dates", () => {
  assert.match(DISPOSITION_SQL, /is_demo/);
  assert.match(DISPOSITION_SQL, /closer_deck_soft_pull_sent_at/);
  assert.match(DISPOSITION_SQL, /closer_deck_ebook_sent_at/);
  assert.match(DISPOSITION_SQL, /closer_deck_letters_at/);
  assert.match(DISPOSITION_SQL, /closer_deck_disposition/);
  assert.match(DISPOSITION_SQL, /e\.payload->>'disposition' = 'closer'/);
  assert.match(DISPOSITION_SQL, /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/);
  assert.match(DISPOSITION_SQL, /FROM call_outcomes o/);
});

test("source reads no repo file, starts no call, and writes nothing", () => {
  assert.doesNotMatch(SRC, /from ["']node:(fs|path)["']|readFileSync|netlify\.toml/);
  assert.doesNotMatch(SRC, /placeCall|bland-voice|messaging\/dispatch|createFunction|sendSms|textChris/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(SRC, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
});

/* ------------------------------------------------------------------------
   The SQL, run for real. Each table is replaced for one query by fixture rows
   (a CTE with the table's name), so DISPOSITION_SQL runs on the Postgres engine
   over rows we choose. SELECT only, nothing is stored. Skipped without
   DATABASE_URL, like every *.pg.test.mjs.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  clients: [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["custom_fields", "jsonb"]],
  events: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["payload", "jsonb"]],
  call_outcomes: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["logged_at", "timestamptz"]]
};
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const t = String(sql).replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
      return pgDb.query(`WITH ${ctes.join(", ")} ${t}`, params);
    }
  };
}

describe("gap-closer SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const org = uid();
  const CL = uid();
  const client = (cf = {}, o = {}) => ({ id: CL, org_id: org, is_demo: false, custom_fields: cf, ...o });
  const outcome = (h) => ({ id: uid(), org_id: org, client_id: CL, logged_at: ago(h) });

  async function counts(rows) {
    const out = await gapChecks({ db: fixtureDb(rows), orgId: org, now: NOW });
    return out.find((r) => r.id === "closer:held-disposition");
  }

  test("a saved disposition or a closer call.completed with no outcome row fails", async () => {
    const saved = await counts({ clients: [client({ closer_deck_disposition: { offer_key: "FUNDING_DFY", at: ago(5) } })] });
    assert.equal(saved.status, "FAIL");
    assert.match(saved.detail, /saved a closer disposition/);
    const evt = await counts({ clients: [client()], events: [{ id: uid(), org_id: org, client_id: CL, name: "call.completed", payload: { disposition: "closer" } }] });
    assert.equal(evt.status, "FAIL");
    const withRow = await counts({ clients: [client({ closer_deck_disposition: { offer_key: "FUNDING_DFY" } })], call_outcomes: [outcome(5)] });
    assert.equal(withRow.status, "PASS");
    const other = await counts({ clients: [client()], events: [{ id: uid(), org_id: org, client_id: CL, name: "call.completed", payload: { disposition: "setter" } }] });
    assert.equal(other.status, "PASS");
  });

  test("deck use with no logged call fails; a call logged after, or in the same hour window, passes", async () => {
    for (const field of ["closer_deck_letters_at", "closer_deck_soft_pull_sent_at", "closer_deck_ebook_sent_at"]) {
      const miss = await counts({ clients: [client({ [field]: ago(3) })] });
      assert.equal(miss.status, "FAIL", field);
      assert.match(miss.detail, /deck used more than 2 hours ago/);
    }
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(3) })], call_outcomes: [outcome(1)] })).status, "PASS");
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(3) })], call_outcomes: [outcome(5)] })).status, "PASS");
    // An outcome from five days ago is another call. It must not hide this one.
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(3) })], call_outcomes: [outcome(120)] })).status, "FAIL");
  });

  test("inside the wait, outside the window, demo, synthetic, and a bad date are not misses", async () => {
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(1) })] })).status, "PASS");
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(480) })] })).status, "PASS");
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(3) }, { is_demo: true })] })).status, "PASS");
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: ago(3), synthetic: "true" })] })).status, "PASS");
    assert.equal((await counts({ clients: [client({ closer_deck_letters_at: "not a date" })] })).status, "PASS");
    assert.equal((await counts({ clients: [] })).status, "PASS");
  });
});
