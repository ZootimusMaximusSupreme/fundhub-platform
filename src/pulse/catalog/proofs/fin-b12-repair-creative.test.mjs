// Batch 12, repair cycle 1: what the Creative Factory desk PAINTS.
// Practice test means a real page in Chromium, fake /api answers shaped like the saved rows, and a
// judgement of the numbers and words on the screen. Nothing here reads live data.
//
// The live checks for this desk read the saved rows. They cannot see a tile that counts the wrong rows or
// a badge that says the wrong word. These tests can: the page is given rows in every state, and each tile
// and each table cell is judged against a count made here, not copied from the page.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

const PARTNER = "9a000000-0000-4000-8000-0000000000a1";

const job = (id, status, extra = {}) => ({ id, status, attempt: 0, error: status === "failed" ? "provider returned nothing" : null,
  provider: "static", spec: {}, cost_cents: 0, created_at: "2026-10-14T09:00:00Z", started_at: null, finished_at: null, ...extra });
const asset = (id, state, extra = {}) => ({ id, kind: "static", format: "1x1", compliance_state: state,
  blocked_reasons: state === "blocked" ? ["no income claims"] : [], archived_at: null, created_at: "2026-10-14T09:00:00Z", ...extra });
const kit = (id, status) => ({ id, name: `Kit ${id}`, status, created_at: "2026-10-14T09:00:00Z" });

/** Every read the desk makes, answered with the rows given. */
function desk({ jobs = [], assets = [], kits = [], approvals = [], video = null } = {}) {
  const page = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });
  const asked = [];
  const handlers = {
    "/api/read/partners": async (route) => json(route, page([{ id: PARTNER, name: "Pat Partner", slug: "pat" }])),
    "/api/creative/jobs": async (route, { url }) => { asked.push(url); return json(route, page(jobs)); },
    "/api/creative/library": async (route, { url }) => { asked.push(url); return json(route, page(assets)); },
    "/api/creative/brand-kits": async (route, { url }) => { asked.push(url); return json(route, page(kits)); },
    "/api/creative/approvals": async (route, { url }) => { asked.push(url); return json(route, page(approvals)); },
    "/api/scripts/list": async (route) => json(route, page([])),
    "/api/read/video-stats": async (route) => {
      if (video && video.fail) return json(route, { ok: false, error: "server_error" }, 500);
      return json(route, video || { ok: true, connection: null, videos: [] });
    },
  };
  return { handlers, asked };
}

/** The four reads have answered and the strip has been drawn from them. */
const loaded = (page) => page.waitForFunction(() => window.LIVE_CF && LIVE_CF.jobs && LIVE_CF.assets && LIVE_CF.kits && LIVE_CF.approvals
  && document.querySelectorAll("#stats .stat").length === 5);

const tiles = (page) => page.locator("#stats .stat").evaluateAll((els) => els.map((e) => ({
  label: e.querySelector(".eyebrow").textContent.trim(),
  value: e.querySelector(".sv").textContent.trim(),
  detail: e.querySelector(".sd").textContent.trim(),
  cls: e.querySelector(".sv").className.replace(/\bsv\b/, "").trim(),
})));

test("Creative Factory: each summary tile counts the right rows and says the right words", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Summary tiles: jobs in flight/, async () => {
    // Jobs: 2 queued (one of them a retry), 1 running, 3 succeeded, 2 failed.
    const jobs = [
      job("j1", "queued"), job("j2", "queued", { attempt: 1 }), job("j3", "running", { started_at: "2026-10-14T09:05:00Z" }),
      job("j4", "succeeded"), job("j5", "succeeded"), job("j6", "succeeded"), job("j7", "failed"), job("j8", "failed"),
    ];
    // Library: live = 2 pending + 3 passed + 1 approved + 1 blocked = 7. Two archived ones (one blocked, one pending)
    // are not in the library and are not awaiting review.
    const assets = [
      asset("a1", "pending"), asset("a2", "pending"), asset("a3", "passed"), asset("a4", "passed"), asset("a5", "passed"),
      asset("a6", "approved"), asset("a7", "blocked"),
      asset("a8", "blocked", { archived_at: "2026-10-01T00:00:00Z" }), asset("a9", "pending", { archived_at: "2026-10-01T00:00:00Z" }),
    ];
    // Brand kits: 2 active, 1 draft, 1 archived. Approvals: 2 campaigns, plus rows of other kinds that are not campaigns.
    const kits = [kit("k1", "active"), kit("k2", "active"), kit("k3", "draft"), kit("k4", "archived")];
    const approvals = [
      { item_type: "campaign", id: "c1" }, { item_type: "campaign", id: "c2" },
      { item_type: "asset", id: "a1" }, { item_type: "brand", id: "k3" },
    ];
    const fake = desk({ jobs, assets, kits, approvals });
    const { page, errors } = await open(`/app/creative-factory.html?partner_id=${PARTNER}`, { session: OWNER, handlers: fake.handlers });
    await loaded(page);
    const got = await tiles(page);
    assert.deepEqual(got, [
      { label: "JOBS IN FLIGHT", value: "3", detail: "1 running · 2 queued", cls: "" },
      { label: "FAILED JOBS", value: "2", detail: "all carry a reason", cls: "bad" },
      { label: "AWAITING REVIEW", value: "5", detail: "1 blocked · 2 campaigns", cls: "warn" },
      { label: "LIBRARY ASSETS", value: "7", detail: "not archived", cls: "" },
      { label: "ACTIVE BRAND KITS", value: "2", detail: "of 4 total", cls: "" },
    ]);
    // Every read is for the one partner named in the address.
    assert.ok(fake.asked.length >= 4 && fake.asked.every((u) => u.includes(`partner_id=${PARTNER}`)));
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/i.test(e)), []);
    await page.close();

    // A different book: no failed jobs and no blocked assets turn the warning colours off, and the words follow.
    const calm = desk({
      jobs: [job("j1", "running"), job("j2", "succeeded")],
      assets: [asset("a1", "passed"), asset("a2", "approved", { archived_at: "2026-10-01T00:00:00Z" })],
      kits: [kit("k1", "draft")],
      approvals: [],
    });
    const other = await open(`/app/creative-factory.html?partner_id=${PARTNER}`, { session: OWNER, handlers: calm.handlers });
    await loaded(other.page);
    assert.deepEqual(await tiles(other.page), [
      { label: "JOBS IN FLIGHT", value: "1", detail: "1 running · 0 queued", cls: "" },
      { label: "FAILED JOBS", value: "0", detail: "all carry a reason", cls: "" },
      { label: "AWAITING REVIEW", value: "0", detail: "0 blocked · 0 campaigns", cls: "" },
      { label: "LIBRARY ASSETS", value: "1", detail: "not archived", cls: "" },
      { label: "ACTIVE BRAND KITS", value: "0", detail: "of 1 total", cls: "" },
    ]);
    await other.page.close();
  });
});

const BADGES = [
  { state: "pending", cls: "b-gray", words: /^pending\.\s+Never synced yet\.$/ },
  { state: "active", cls: "b-ok", words: /^Connected\. Last synced Oct 14 10:00\.$/ },
  { state: "expired", cls: "b-warn", words: /^expired\.\s+token expired\s+Last synced Oct 14 10:00\.$/ },
  { state: "revoked", cls: "b-gray", words: /^revoked\.\s+token expired\s+Last synced Oct 14 10:00\.$/ },
  { state: "error", cls: "b-alert", words: /^error\.\s+token expired\s+Last synced Oct 14 10:00\.$/ },
];

test("Creative Factory: the video table and the connection badge say what the saved stats and connection say", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Video performance table \(YouTube views/, async () => {
    const videos = [
      { video_title: "How funding works", stat_date: "2026-10-13", views: 1200, estimated_minutes_watched: 340, average_view_duration_sec: 73.4, average_view_percentage: 41.52 },
      { video_title: "Short one", stat_date: "2026-10-12", views: 15, estimated_minutes_watched: 45, average_view_duration_sec: 12, average_view_percentage: 98 },
      { video_title: null, stat_date: "2026-10-11", views: 7, estimated_minutes_watched: 61, average_view_duration_sec: 30.6, average_view_percentage: 5 },
      { video_title: "On the hour", stat_date: "2026-10-10", views: 3, estimated_minutes_watched: 60, average_view_duration_sec: 8, average_view_percentage: 1.25 },
      { video_title: "Looping short", stat_date: "2026-10-09", views: 99, estimated_minutes_watched: 7200.4, average_view_duration_sec: 22, average_view_percentage: 130 },
      { video_title: "No numbers yet", stat_date: "2026-10-08", views: null, estimated_minutes_watched: null, average_view_duration_sec: null, average_view_percentage: null },
    ];
    // The table, row by row: title (or "untitled"), day, views, watch time in hours and minutes over an hour,
    // average seconds, average percent to one place.
    const WANT = [
      ["How funding works", "2026-10-13", "1200", "5h 40m", "73s", "41.5%"],
      ["Short one", "2026-10-12", "15", "45m", "12s", "98.0%"],
      ["untitled", "2026-10-11", "7", "1h 1m", "31s", "5.0%"],
      ["On the hour", "2026-10-10", "3", "60m", "8s", "1.3%"],
      ["Looping short", "2026-10-09", "99", "120h 0m", "22s", "130.0%"],
      ["No numbers yet", "2026-10-08", "—", "—", "—", "—"],
    ];
    for (const badge of BADGES) {
      const connection = { state: badge.state, last_synced_at: badge.state === "pending" ? null : "2026-10-14T10:00:00Z",
        last_error: ["expired", "revoked", "error"].includes(badge.state) ? "token expired" : null };
      const fake = desk({ video: { ok: true, connection, videos } });
      const { page } = await open("/app/creative-factory.html", { session: OWNER, handlers: fake.handlers });
      await page.waitForFunction(() => document.querySelectorAll("#vidBody tr").length === 6);
      const word = await page.locator("#vidConnBadge").textContent();
      const klass = await page.locator("#vidConnBadge").getAttribute("class");
      assert.equal(word.trim(), badge.state, `${badge.state}: the badge says the saved state`);
      assert.ok(klass.split(/\s+/).includes(badge.cls), `${badge.state}: badge colour ${badge.cls}, got ${klass}`);
      assert.match((await page.locator("#vidConnCap").innerText()).replace(/\s+/g, " ").trim(), badge.words, `${badge.state}: the caption`);
      const cells = await page.locator("#vidBody tr").evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim())));
      assert.deepEqual(cells, WANT, `${badge.state}: the table says each video's own numbers`);
      await page.close();
    }

    // No connection at all.
    const none = desk({ video: { ok: true, connection: null, videos: [] } });
    const a = await open("/app/creative-factory.html", { session: OWNER, handlers: none.handlers });
    await a.page.waitForFunction(() => document.querySelector("#vidConnBadge")?.textContent.trim() === "not connected");
    assert.match(await a.page.locator("#vidConnCap").innerText(), /Not connected\. Fill in the three fields below and press Connect\./);
    assert.match(await a.page.locator("#vidBody").innerText(), /No video stats on file yet\./);
    await a.page.close();

    // The read failed: the badge says it is not loaded and the table says nothing is shown rather than an old number.
    const broken = desk({ video: { fail: true } });
    const b = await open("/app/creative-factory.html", { session: OWNER, handlers: broken.handlers });
    await b.page.waitForFunction(() => document.querySelector("#vidConnBadge")?.textContent.trim() === "not loaded");
    assert.ok((await b.page.locator("#vidConnBadge").getAttribute("class")).split(/\s+/).includes("b-alert"));
    assert.match(await b.page.locator("#vidBody").innerText(), /Nothing is shown, rather than an old or made-up number\./);
    await b.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
