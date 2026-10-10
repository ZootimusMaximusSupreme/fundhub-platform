// Tests for the brief-link beat. No network, no database: the fake ctx answers only what it is told.
// The live run is `node scripts/pulse/run-beat.mjs brief-link`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-brief-link.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { BRIEF_PAGE_PATH, BRIEF_TOKEN_LENGTH, signBriefToken, briefUrl } from "../../ops/brief-link.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://fundhub.ai";
const DATE = "2026-10-09";
const CODE = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const PAGE = `${SITE}${BEAT_PAGE()}?date=${DATE}&k=${CODE}`;
const DATA = `${SITE}/api/public/morning-brief?date=${DATE}&kind=morning&k=${CODE}`;
const PAGE_OK = { status: 200, body: '<html lang="en" data-brief-page="1"><body></body></html>' };
const DATA_OK = { status: 200, body: JSON.stringify({ ok: true, date: DATE, kind: "morning", brief: { date: DATE, kind: "morning" } }) };

function BEAT_PAGE() { return "/app/morning-brief.html"; }

const row = (over = {}) => ({
  match: /FROM morning_briefs/,
  rows: [{ brief_date: DATE, kind: "morning", report_url: PAGE, created_at: new Date("2026-10-09T13:00:30.000Z"), ...over }]
});
const good = () => ({ [`GET ${PAGE}`]: PAGE_OK, [`GET ${DATA}`]: DATA_OK });

const runWith = async (over = {}) => {
  const ctx = makeFakeCtx(beat, { read: [row()], http: good(), ...over });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
};

test("brief-link is a valid beat, passes the static pin and its own self test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-brief-link.mjs" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-brief-link.mjs"), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal(beat.id, "brief-link");
  assert.equal(beat.kind, "probe");
  assert.equal(beat.damp, 1);
  assert.equal(beat.box, false);
  assert.deepEqual(beat.reads, [{ host: "SITE", methods: ["GET"] }]);
  assert.deepEqual(beat.steps, ["link-saved", "page-opens", "report-loads"]);
  assert.deepEqual(beat.covers, ["route:public/morning-brief", "desk:morning-brief.html"]);
});

test("the beat's constants match the real link maker (same page path, same code length)", () => {
  assert.equal(beat.PAGE_PATH, BRIEF_PAGE_PATH);
  assert.equal(BRIEF_TOKEN_LENGTH, 32);
  const env = { BRIEF_LINK_SECRET: "x".repeat(40) };
  const orgId = "11111111-1111-4111-8111-111111111111";
  for (const kind of ["morning", "evening"]) {
    const url = briefUrl({ orgId, kind, date: DATE, env, baseUrl: SITE });
    const k = signBriefToken({ orgId, kind, date: DATE, env });
    const parsed = beat.parseSavedLink(url, { siteHost: "fundhub.ai", briefDate: DATE, briefKind: kind });
    assert.equal(parsed.ok, true, `${kind}: ${parsed.why}`);
    assert.equal(parsed.k, k);
    assert.equal(parsed.kind, kind);
  }
});

test("the page marker is in the real page, near the top (the probe reads only the first 64 KB)", () => {
  const html = fs.readFileSync(path.join(HERE, "../../../public/app/morning-brief.html"), "utf8");
  const at = html.indexOf("data-brief-page");
  assert.ok(at > -1 && at < 2000, "data-brief-page must be on the root element");
});

/* ---------------- PASS ---------------- */

test("PASS: a good link, a page with the marker and a report with a brief -> green, three steps, GETs only to our host", async () => {
  const { result, log } = await runWith();
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.equal(result.steps.length, 3);
  assert.equal(log.http.length, 2);
  assert.ok(log.http.every((c) => c.method === "GET" && c.host === "fundhub.ai" && c.status === 200));
  assert.equal(log.reads.length, 1);
  assert.deepEqual(log.refused, []);
});

test("PASS: an evening text asks the route with kind=evening and the page with &kind=evening", async () => {
  const pageUrl = `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=evening&k=${CODE}`;
  const dataUrl = `${SITE}/api/public/morning-brief?date=${DATE}&kind=evening&k=${CODE}`;
  const ev = JSON.stringify({ ok: true, date: DATE, kind: "evening", brief: { date: DATE } });
  const { result, log } = await runWith({
    read: [row({ kind: "evening", report_url: pageUrl })],
    http: { [`GET ${pageUrl}`]: PAGE_OK, [`GET ${dataUrl}`]: { status: 200, body: ev } }
  });
  assert.equal(result.ok, true, result.detail);
  assert.equal(log.http.length, 2);
  assert.match(result.detail, /evening/);
});

test("PASS: a text 35 hours old is still fresh; a request reads the newest row only", async () => {
  const made = new Date(Date.parse("2026-10-09T19:07:00.000Z") - 35 * 3600000);
  const { result, log } = await runWith({ read: [row({ created_at: made })] });
  assert.equal(result.ok, true, result.detail);
  assert.match(log.reads[0].sql, /ORDER BY created_at DESC\s+LIMIT 1/);
});

/* ---------------- FAIL: one test per kind of break ---------------- */

test("FAIL link-saved: no rows at all", async () => {
  const { result } = await runWith({ read: [{ match: /FROM morning_briefs/, rows: [] }] });
  assert.equal(result.ok, false);
  assert.equal(result.step, "link-saved");
  assert.match(result.detail, /no rows/);
  assert.deepEqual(result.steps.map((s) => s.name), ["link-saved"], "no GET was made after the first step");
});

test("FAIL link-saved: newest text older than 36 hours means the text did not go", async () => {
  const made = new Date(Date.parse("2026-10-09T19:07:00.000Z") - 37 * 3600000);
  const { result } = await runWith({ read: [row({ created_at: made })] });
  assert.equal(result.step, "link-saved");
  assert.match(result.detail, /37 hours old \(limit 36\).*did not go out/);
});

test("FAIL link-saved: the text carries no link (secret missing), or an old link with no code", async () => {
  // (the old tokenless link is NOT in this list: it is the grace case, tested below)
  for (const report_url of [null, "", "   ", `${SITE}${BEAT_PAGE()}?date=${DATE}&k=`]) {
    const { result } = await runWith({ read: [row({ report_url })] });
    assert.equal(result.ok, false, String(report_url));
    assert.equal(result.step, "link-saved", String(report_url));
    assert.match(result.detail, /Chris would tap a dead link/);
  }
});

test("FAIL link-saved: wrong host, wrong path, plain http, a login in the address, a bad code, wrong date, wrong kind", async () => {
  const bad = [
    `https://example.com${BEAT_PAGE()}?date=${DATE}&k=${CODE}`,
    `https://fundhub.ai.evil.example${BEAT_PAGE()}?date=${DATE}&k=${CODE}`,
    `https://fundhub.ai:8443${BEAT_PAGE()}?date=${DATE}&k=${CODE}`,
    `https://fundhub.ai@evil.example${BEAT_PAGE()}?date=${DATE}&k=${CODE}`,
    `${SITE}/app/index.html?date=${DATE}&k=${CODE}`,
    `${SITE}${BEAT_PAGE()}/?date=${DATE}&k=${CODE}`,
    `http://fundhub.ai${BEAT_PAGE()}?date=${DATE}&k=${CODE}`,
    `${SITE}${BEAT_PAGE()}?date=${DATE}&k=short`,
    `${SITE}${BEAT_PAGE()}?date=${DATE}&k=${CODE}&k=${CODE}`,
    `${SITE}${BEAT_PAGE()}?date=2026-10-08&k=${CODE}`,
    `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=evening&k=${CODE}`,
    `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=night&k=${CODE}`,
    "not a url at all",
    "https://"
  ];
  for (const report_url of bad) {
    const { result } = await runWith({ read: [row({ report_url })] });
    assert.equal(result.ok, false, report_url);
    assert.equal(result.step, "link-saved", report_url);
  }
  // an evening row whose link forgot &kind=evening
  const { result } = await runWith({ read: [row({ kind: "evening" })] });
  assert.equal(result.step, "link-saved");
});

test("FAIL link-saved: a row with an unreadable time, date or kind", async () => {
  for (const over of [{ created_at: "not a time" }, { brief_date: "soon" }, { kind: "noon" }]) {
    const { result } = await runWith({ read: [row(over)] });
    assert.equal(result.step, "link-saved", JSON.stringify(over));
  }
});

test("the newest-text query counts only a text that was sent, not a dry run or a failed send, in the default org", async () => {
  assert.match(beat.NEWEST_SQL, /delivery_status = 'sent'/);
  assert.match(beat.NEWEST_SQL, /dry_run = false/);
  assert.match(beat.NEWEST_SQL, /org_id = \(SELECT id FROM orgs WHERE is_default LIMIT 1\)/);
  assert.match(beat.NEWEST_SQL, /ORDER BY created_at DESC\s+LIMIT 1/);
  // only dry-run / failed rows exist: the query returns nothing, and the beat says no text went out
  const { result } = await runWith({ read: [{ match: /FROM morning_briefs/, rows: [] }] });
  assert.equal(result.step, "link-saved");
  assert.match(result.detail, /no rows for a text that was sent/);
});

test("FAIL link-saved: the read itself fails; a database-down answer passes through word for word", async () => {
  const a = await runWith({ read: [{ match: /FROM morning_briefs/, error: "relation morning_briefs does not exist" }] });
  assert.equal(a.result.step, "link-saved");
  assert.match(a.result.detail, /Could not read morning_briefs/);
  const b = await runWith({ read: [{ match: /FROM morning_briefs/, error: "db: the database did not answer" }] });
  assert.equal(b.result.step, "link-saved");
  assert.match(b.result.detail, /^db: the database did not answer/);
});

test("FAIL page-opens: 404 (the page is not deployed), 500, a redirect to somewhere else, no answer", async () => {
  for (const [answer, re] of [
    [{ status: 404, body: "<html>Not found</html>" }, /answered 404.*dead/],
    [{ status: 500, body: "boom" }, /answered 500, wanted 200/],
    [{ status: 302, body: "" }, /answered 302, wanted 200/],
    [{ status: 0, ok: false, class: "timeout", body: "" }, /got no answer \(timeout\)/]
  ]) {
    const { result } = await runWith({ http: { ...good(), [`GET ${PAGE}`]: answer } });
    assert.equal(result.ok, false);
    assert.equal(result.step, "page-opens");
    assert.match(result.detail, re);
  }
});

test("FAIL page-opens: 200 but not the report page (a login page, a blank page)", async () => {
  for (const body of ["<html><form id='f'><input type='email'></form></html>", "", "<html>Welcome</html>"]) {
    const { result } = await runWith({ http: { ...good(), [`GET ${PAGE}`]: { status: 200, body } } });
    assert.equal(result.step, "page-opens");
    assert.match(result.detail, /data-brief-page marker is missing/);
  }
});

test("FAIL report-loads: 404 (route missing or code no longer matches), 503, 200 with the wrong body", async () => {
  const cases = [
    [{ status: 404, body: '{"ok":false,"error":"not_found"}' }, /answered 404 for the saved link/],
    [{ status: 503, body: '{"ok":false}' }, /answered 503, wanted 200/],
    [{ status: 200, body: "<html>app shell</html>" }, /not the report answer/],
    [{ status: 200, body: '{"ok":false}' }, /did not say ok/],
    [{ status: 200, body: '{"ok":true}' }, /sent no brief/],
    [{ status: 200, body: '{"ok":true,"brief":[]}' }, /sent no brief/],
    [{ status: 200, body: JSON.stringify({ ok: true, brief: { date: "2026-10-01" } }) }, /different day/],
    [{ status: 0, ok: false, class: "network", body: "" }, /got no answer \(network\)/]
  ];
  for (const [answer, re] of cases) {
    const { result } = await runWith({ http: { ...good(), [`GET ${DATA}`]: answer } });
    assert.equal(result.ok, false, JSON.stringify(answer));
    assert.equal(result.step, "report-loads", JSON.stringify(answer));
    assert.match(result.detail, re);
  }
});

test("FAIL: an answer nobody gave (the fake refuses to guess) is red, not green", async () => {
  const onlyPage = { [`GET ${PAGE}`]: PAGE_OK };
  const { result } = await runWith({ http: onlyPage });
  assert.equal(result.ok, false);
  assert.equal(result.step, "report-loads");
});

test("MUTATION: each of the three steps goes red alone, and the good run is green (the loop is not always red)", async () => {
  assert.equal((await runWith()).result.ok, true);
  assert.equal((await runWith({ read: [row({ report_url: null })] })).result.step, "link-saved");
  assert.equal((await runWith({ http: { ...good(), [`GET ${PAGE}`]: { status: 404, body: "" } } })).result.step, "page-opens");
  assert.equal((await runWith({ http: { ...good(), [`GET ${DATA}`]: { status: 404, body: "" } } })).result.step, "report-loads");
});

/* ---------------- the code never reaches a word ---------------- */

const HOSTILE = "HoStIlE-CoDe_0123456789abcdefGHIJ"; // 33 chars: carried everywhere below
const HOSTILE32 = HOSTILE.slice(0, 32);

/** Every place the code could ride in on, in one run. Checked against the whole result. */
function assertClean(result, extra = []) {
  const all = JSON.stringify(result);
  for (const needle of [HOSTILE, HOSTILE32, HOSTILE.slice(0, 20), "k=", "?date=", "morning-brief.html?", ...extra]) {
    assert.ok(!all.includes(needle), `the result holds "${needle}": ${all.slice(0, 400)}`);
  }
  assert.ok(!/https?:\/\/[^\s"]*\?/.test(all), "no full link with a query string anywhere in the result");
}

test("HOSTILE: a code placed in every field never reaches the detail, the evidence or the steps, on every path", async () => {
  const goodLink = `${SITE}${BEAT_PAGE()}?date=${DATE}&k=${HOSTILE32}`;
  const goodData = `${SITE}/api/public/morning-brief?date=${DATE}&kind=morning&k=${HOSTILE32}`;
  const echo = `echo ${HOSTILE} ${goodLink} ${goodData}`;
  const hostileAnswer = (status) => ({ status, ok: status === 200, class: status === 200 ? "ok" : "http_4xx", body: echo, bodySnippet: echo, error: echo, headers: { location: goodLink, "x-k": HOSTILE } });
  const hostileJson = (over = {}) => ({ status: 200, body: JSON.stringify({ ok: true, k: HOSTILE, token: HOSTILE, brief: { date: DATE, note: HOSTILE, url: goodLink }, ...over }) });

  const rows = [
    // good link, every answer hostile but the right shape: green
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: `data-brief-page ${echo}` }, [`GET ${goodData}`]: hostileJson() }],
    // page: wrong statuses carrying the code
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: hostileAnswer(404), [`GET ${goodData}`]: hostileJson() }],
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: hostileAnswer(500), [`GET ${goodData}`]: hostileJson() }],
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: echo }, [`GET ${goodData}`]: hostileJson() }],
    // report: wrong body, wrong status, wrong day
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: "data-brief-page" }, [`GET ${goodData}`]: hostileAnswer(404) }],
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: "data-brief-page" }, [`GET ${goodData}`]: { status: 200, body: echo } }],
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: "data-brief-page" }, [`GET ${goodData}`]: hostileJson({ brief: { date: HOSTILE, note: HOSTILE } }) }],
    [{ report_url: goodLink }, { [`GET ${goodLink}`]: { status: 200, body: "data-brief-page" }, [`GET ${goodData}`]: { status: 0, ok: false, class: HOSTILE, error: echo, body: "" } }],
    // saved link is wrong in every way, the code in the date, kind, host, path, userinfo and fragment
    [{ report_url: `${SITE}${BEAT_PAGE()}?date=${HOSTILE32}&k=${HOSTILE32}` }, {}],
    [{ report_url: `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=${HOSTILE32}&k=${HOSTILE32}` }, {}],
    [{ report_url: `https://${HOSTILE32}.example.com${BEAT_PAGE()}?date=${DATE}&k=${HOSTILE32}` }, {}],
    [{ report_url: `https://${HOSTILE32}@fundhub.ai${BEAT_PAGE()}?date=${DATE}&k=${HOSTILE32}` }, {}],
    [{ report_url: `${SITE}/${HOSTILE32}?date=${DATE}&k=${HOSTILE32}` }, {}],
    [{ report_url: `${SITE}${BEAT_PAGE()}?date=${DATE}&k=${HOSTILE32}#${HOSTILE}`.replace("fundhub.ai", `fundhub.ai/${HOSTILE32}/..`) }, {}],
    [{ report_url: `${HOSTILE} ${HOSTILE32}` }, {}],
    [{ report_url: `http://${HOSTILE32}` }, {}],
    // the other row fields hostile
    [{ report_url: goodLink, kind: HOSTILE }, {}],
    [{ report_url: goodLink, brief_date: HOSTILE }, {}],
    [{ report_url: goodLink, created_at: HOSTILE }, {}],
    [{ report_url: goodLink, created_at: new Date("2026-10-01T00:00:00Z") }, {}]
  ];
  for (const [over, http] of rows) {
    const { result } = await runWith({ read: [row(over)], http });
    assertClean(result);
  }

  // the same, with the read itself failing and carrying the code in its message
  const failed = await runWith({ read: [{ match: /FROM morning_briefs/, error: `could not read ${goodLink}` }], http: {} });
  assert.equal(failed.result.step, "link-saved");
  // a database error message is reported word for word by design (pay-webhook does the same); the beat never puts the saved link in it
  // so the only text here is the fake error. Prove the beat adds nothing of its own:
  assert.equal(failed.result.detail.startsWith("Could not read morning_briefs:"), true);
});

test("HOSTILE: a green run writes only the checked date and kind, the site host, the two fixed paths and numbers", async () => {
  const goodLink = `${SITE}${BEAT_PAGE()}?date=${DATE}&k=${HOSTILE32}`;
  const goodData = `${SITE}/api/public/morning-brief?date=${DATE}&kind=morning&k=${HOSTILE32}`;
  const { result } = await runWith({
    read: [row({ report_url: goodLink })],
    http: { [`GET ${goodLink}`]: { status: 200, body: "data-brief-page" }, [`GET ${goodData}`]: { status: 200, body: JSON.stringify({ ok: true, brief: { date: DATE } }) } }
  });
  assert.equal(result.ok, true, result.detail);
  assertClean(result);
  assert.deepEqual(Object.keys(result.evidence).sort(), ["ageHours", "briefDate", "dataPath", "dataStatus", "host", "kind", "pagePath", "pageStatus"]);
  assert.deepEqual(result.evidence, {
    briefDate: DATE, kind: "morning", ageHours: 6, host: "fundhub.ai",
    pagePath: "/app/morning-brief.html", dataPath: "/api/public/morning-brief", pageStatus: 200, dataStatus: 200
  });
});

test("parseSavedLink returns fixed words only, never a piece of the link", () => {
  const link = `https://${HOSTILE32}.example.com/x/${HOSTILE32}?date=${HOSTILE32}&k=${HOSTILE32}#${HOSTILE32}`;
  const r = beat.parseSavedLink(link, { siteHost: "fundhub.ai", briefDate: DATE, briefKind: "morning" });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(HOSTILE32));
});

/* ---------------- how it behaves ---------------- */

test("the two GETs start together (one is not waiting on the other)", async () => {
  let inFlight = 0;
  let peak = 0;
  const answers = good();
  const http = async (method, address) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    return answers[`${method} ${address}`];
  };
  const ctx = makeFakeCtx(beat, { read: [row()], http });
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.equal(peak, 2);
});

test("a site address that is not set is red at the first step, with no GET made", async () => {
  const ctx = makeFakeCtx(beat, { read: [row()], http: good(), siteUrl: "" });
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.step, "link-saved");
  assert.equal(ctxLog(ctx).http.length, 0);
});

test("the detail stays within the contract limit on every red", async () => {
  const cases = [
    { read: [row({ report_url: null })] },
    { http: { ...good(), [`GET ${PAGE}`]: { status: 404, body: "" } } },
    { http: { ...good(), [`GET ${DATA}`]: { status: 404, body: "" } } }
  ];
  for (const over of cases) {
    const { result } = await runWith(over);
    assert.ok(result.detail.length > 0 && result.detail.length <= 300, result.detail);
    assert.doesNotMatch(result.detail, /[^\x20-\x7e]/);
  }
});

test("the fix guide names real files and the real command", () => {
  for (const p of beat.fixGuide.match(/(?:src|api|public|netlify|scripts)\/[\w./-]+/g)) {
    assert.ok(fs.existsSync(path.join(HERE, "../../..", p.replace(/[.,]+$/, ""))), `${p} is not on disk`);
  }
  assert.match(beat.fixGuide.split("\n")[0], /^Open the newest morning text link by hand/);
  assert.match(beat.fixGuide, /WITHOUT --secret/);
  assert.match(beat.fixGuide, /Never delete or overwrite/);
});

/* ---------------- big answers: the probe keeps only 64 KB ---------------- */

const bigBody = (over = {}) => {
  const j = { ok: true, date: DATE, kind: "morning", brief: { date: DATE, kind: "morning", systems: { rows: "x".repeat(200 * 1024) } }, ...over };
  return JSON.stringify(j);
};

test("PASS report-loads: a 200 KB answer cut at 64 KB (truncated:true) is judged by its start, not parsed", async () => {
  const full = bigBody();
  const cut = full.slice(0, 64 * 1024);
  assert.throws(() => JSON.parse(cut), "the cut body really is not JSON");
  const { result } = await runWith({ http: { ...good(), [`GET ${DATA}`]: { status: 200, body: cut, truncated: true } } });
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.evidence.dataCut, true);
  assertClean(result);
});

test("PASS report-loads: an evening answer cut at 64 KB passes too", async () => {
  const pageUrl = `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=evening&k=${CODE}`;
  const dataUrl = `${SITE}/api/public/morning-brief?date=${DATE}&kind=evening&k=${CODE}`;
  const cut = bigBody({ kind: "evening" }).slice(0, 64 * 1024);
  const { result } = await runWith({
    read: [row({ kind: "evening", report_url: pageUrl })],
    http: { [`GET ${pageUrl}`]: PAGE_OK, [`GET ${dataUrl}`]: { status: 200, body: cut, truncated: true } }
  });
  assert.equal(result.ok, true, result.detail);
});

test("FAIL report-loads: a cut body that is a 404 answer, HTML, the wrong day, the wrong kind or ok:false is still red", async () => {
  const full = bigBody();
  const cuts = [
    '{"ok":false,"error":"not_found"}' + " ".repeat(100),
    "<html>app shell</html>" + "x".repeat(70000),
    full.replace(`"date":"${DATE}"`, '"date":"2026-10-01"').slice(0, 64 * 1024),
    bigBody({ kind: "evening" }).slice(0, 64 * 1024),
    bigBody({ ok: false }).slice(0, 64 * 1024),
    "",
    '{"ok":true,"date":"' + DATE + '","kind":"morning","brief":[]}'
  ];
  for (const body of cuts) {
    const { result } = await runWith({ http: { ...good(), [`GET ${DATA}`]: { status: 200, body, truncated: true } } });
    assert.equal(result.ok, false, body.slice(0, 60));
    assert.equal(result.step, "report-loads", body.slice(0, 60));
    assert.match(result.detail, /start of the body is not the report answer/);
  }
});

test("cutBodyIsReport: needs the date and kind to be well formed, and tolerates spaces", () => {
  const ok = `{ "ok": true, "date": "${DATE}", "kind": "morning", "brief": { "date": "${DATE}", "x": 1`;
  assert.equal(beat.cutBodyIsReport(ok, { date: DATE, kind: "morning" }), true);
  assert.equal(beat.cutBodyIsReport(ok, { date: ".*", kind: "morning" }), false);
  assert.equal(beat.cutBodyIsReport(ok, { date: DATE, kind: "(a|b)" }), false);
  assert.equal(beat.cutBodyIsReport(null, { date: DATE, kind: "morning" }), false);
});

/* ---------------- the old link: sent before links carried a code ---------------- */

const OLD = `${SITE}${BEAT_PAGE()}?date=${DATE}`;
const OLD_EVENING = `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=evening`;
const BARE = `${SITE}${BEAT_PAGE()}`;

test("GRACE: an old tokenless link on a fresh text is green, checks the bare page only, skips report-loads, and never calls the route", async () => {
  const { result, log } = await runWith({ read: [row({ report_url: OLD })], http: { [`GET ${BARE}`]: PAGE_OK } });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.skipped, ["report-loads"]);
  assert.equal(log.http.length, 1);
  assert.equal(log.http[0].method, "GET");
  assert.equal(result.evidence.legacyLink, true);
  assert.match(result.detail, /before report links carried a code/);
  assert.ok(result.detail.length <= 300, result.detail);
  const evening = await runWith({ read: [row({ kind: "evening", report_url: OLD_EVENING })], http: { [`GET ${BARE}`]: PAGE_OK } });
  assert.equal(evening.result.ok, true, evening.result.detail);
});

test("GRACE is bounded: an old link still goes red when the page is not deployed, the text is over 36 hours old, or the date or kind is wrong", async () => {
  const page404 = await runWith({ read: [row({ report_url: OLD })], http: { [`GET ${BARE}`]: { status: 404, body: "<html>Not found</html>" } } });
  assert.equal(page404.result.step, "page-opens");
  const noMarker = await runWith({ read: [row({ report_url: OLD })], http: { [`GET ${BARE}`]: { status: 200, body: "<html>Welcome</html>" } } });
  assert.equal(noMarker.result.step, "page-opens");
  const old = await runWith({ read: [row({ report_url: OLD, created_at: new Date(Date.parse("2026-10-09T19:07:00.000Z") - 37 * 3600000) })], http: { [`GET ${BARE}`]: PAGE_OK } });
  assert.equal(old.result.step, "link-saved");
  for (const report_url of [`${SITE}${BEAT_PAGE()}?date=2026-10-08`, `${SITE}${BEAT_PAGE()}?date=${DATE}&kind=evening`, `https://example.com${BEAT_PAGE()}?date=${DATE}`, `${SITE}/app/other.html?date=${DATE}`]) {
    const { result } = await runWith({ read: [row({ report_url })], http: { [`GET ${BARE}`]: PAGE_OK } });
    assert.equal(result.ok, false, report_url);
    assert.equal(result.step, "link-saved", report_url);
  }
});

test("GRACE does not hide a missing secret: no link at all, or a k that is empty or bad, is red", async () => {
  for (const report_url of [null, "", `${OLD}&k=`, `${OLD}&k=short`]) {
    const { result } = await runWith({ read: [row({ report_url })], http: { [`GET ${BARE}`]: PAGE_OK } });
    assert.equal(result.ok, false, String(report_url));
    assert.equal(result.step, "link-saved", String(report_url));
  }
});
