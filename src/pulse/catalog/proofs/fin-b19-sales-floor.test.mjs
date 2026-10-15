// Batch 19 practice tests: the five sales floor controls on public/app/sales-floor.html (+ sales-floor.js).
// A real page in Chromium with a fake session and fake /api answers (no live data), plus the real
// api/read/sales-floor.mjs handler run on a stand-in database for who it refuses. Rows come from
// fin-b19-rows.json.

import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/read/sales-floor.mjs";
import { fakeDb, makeRes, req, staffSession } from "../../../testing/handler-harness.mjs";
import { STAFF, proofRows, sharedLab, waitFor } from "./fin-b19-kit.mjs";

const proof = proofRows(import.meta.url);
const lab = sharedLab();

const PERIOD = { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" };
const closer = (name, extra = {}) => ({
  name, on_shift: false, calls: 8, close_rate: 0.5, funded_rate: 0.5, cash_cents: 120000, deposits: 3, action: `Call ${name}'s lead`,
  offer_stack: { available: false, reason: "Offer details are not available yet." }, ...extra,
});
const FLOOR = {
  ok: true,
  period: PERIOD,
  hero: { cash_cents: 0, deposit_to_funded: 0.5, deposit_to_funded_n: { deposits: 4, funded: 2, rate: 0.5 } },
  today: { date: "2026-10-14", booked: 3, held: 2, deposits: 1, target_reason: "No daily target" },
  funnel: { booked: 10, held: 8, deposits: 4, funded: 2, downsells: 0, downsell_cash_cents: 0, show_rate: 0.8, close_rate: 0.5, funded_of_deposits: 0.5 },
  closers: [closer("Ana Archer", { on_shift: true, shift_elapsed_ms: 3_660_000 }), closer("Ben Brook"), closer("Cy Cole")],
  beliefs: {
    beliefs: [{ belief: "cost", label: "Cost", this_count: 5, last_count: 2 }],
    sources: [{ lead_source: "meta", setter_key: "josh", held: 4, close_rate: 0.5, desire: 2 }],
  },
  recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet." },
  compliance: { available: false, reason: "Not built yet.", items: [] },
  cold_deals: [],
  discipline: { unlogged_calls: 0, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "n/a" } },
  offer_stack: { available: false, reason: "Offer details are not available yet." },
};

// A manager on the floor with the given fake answers. Dialogs (alert) are answered and kept in order.
async function openFloor({ floor = FLOOR, floorStatus = 200, api = null, role = "sales_manager" } = {}) {
  const dialogs = [];
  const page = await lab.open({
    role,
    height: 700,
    api: (request, url) => {
      if (request.method() === "GET" && url.pathname === "/api/read/sales-floor") {
        return floorStatus === 200
          ? floor
          : { status: floorStatus, body: { ok: false, error: "forbidden", message: "this endpoint is limited to owner, admin, sales_manager" } };
      }
      return api ? api(request, url) : undefined;
    },
  });
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  if (floorStatus === 200) await page.waitForSelector("#fh-closer-focus .pickwho");
  return { page, dialogs, errors, floorReads: () => page.apiCalls.filter((c) => c.method === "GET" && c.path === "/api/read/sales-floor").length };
}

test("one closer at a time: the arrows and the name buttons step through the closers already loaded", { timeout: 120_000 }, async () => {
  await proof.check(/^'One closer at a time'/, async () => {
    const { page, floorReads, errors } = await openFloor();
    const who = () => page.locator("#fh-closer-focus .pickwho").innerText().then((t) => t.split("\n")[0].trim());
    const place = () => page.locator("#fh-closer-focus .picks .note").innerText();
    assert.equal(await who(), "Ana Archer");
    assert.equal(await place(), "Closer 1 of 3");
    assert.deepEqual(
      await page.$$eval("#fh-closer-focus .pickb[data-fh-closer]", (els) => els.map((e) => e.textContent.trim())),
      ["Ana Archer", "Ben Brook", "Cy Cole"], "one name button per closer",
    );
    assert.equal(await page.locator("#fh-closer-focus .pickb.on").innerText(), "Ana Archer");

    await page.locator("#fh-closer-next").click();
    assert.equal(await who(), "Ben Brook");
    assert.equal(await place(), "Closer 2 of 3");
    assert.match(await page.locator("#fh-closer-focus .say").innerText(), /Do this\. Call Ben Brook's lead/, "the action is that closer's own");
    await page.locator("#fh-closer-prev").click();
    await page.locator("#fh-closer-prev").click();
    assert.equal(await who(), "Cy Cole", "Previous from the first wraps to the last");
    await page.locator("#fh-closer-next").click();
    assert.equal(await who(), "Ana Archer", "Next from the last wraps to the first");
    await page.locator('#fh-closer-focus .pickb[data-fh-closer="1"]').click();
    assert.equal(await who(), "Ben Brook", "a name button picks that closer");
    assert.equal(await page.locator("#fh-closer-focus .pickb.on").innerText(), "Ben Brook");
    assert.equal(floorReads(), 1, "picking a closer makes no second request");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the Flag button stores one belief by source row for marketing, and says what happened", { timeout: 120_000 }, async () => {
  await proof.check(/^'Flag <belief>' button/, async () => {
    const { page, dialogs, errors } = await openFloor({
      api: (request, url) => (request.method() === "POST" && url.pathname === "/api/marketing-flags" ? { ok: true, flag: { id: "flag-1" } } : undefined),
    });
    const flag = page.locator("#fh-flag-mkt");
    assert.equal((await flag.innerText()).trim(), "Flag Cost", "the button names the belief on the board");
    await flag.click();
    await waitFor(() => dialogs.length === 1, "the answer");
    const post = page.apiCalls.find((c) => c.method === "POST" && c.path === "/api/marketing-flags");
    assert.ok(post, "one request to the marketing flags door");
    assert.equal(page.apiCalls.filter((c) => c.path === "/api/marketing-flags").length, 1);
    assert.equal(post.bearer, "Bearer fake-token");
    assert.deepEqual(JSON.parse(post.body), {
      belief: "cost", lead_source: "meta", setter_label: "josh", outcome_count: 5,
      period_start: PERIOD.start, period_end: PERIOD.end,
      note: "Flagged from sales floor — Cost this period 5 vs last 2",
    });
    assert.equal(dialogs[0], "Stored for marketing routing. Nothing was sent externally.");
    assert.deepEqual(errors, []);
    await page.close();

    // The server refusing says its own words, and nothing says "stored".
    const refused = await openFloor({
      api: (request, url) => (request.method() === "POST" && url.pathname === "/api/marketing-flags"
        ? { status: 400, body: { ok: false, error: "bad_request", message: "period_start and period_end are required" } }
        : undefined),
    });
    await refused.page.locator("#fh-flag-mkt").click();
    await waitFor(() => refused.dialogs.length === 1, "the refusal");
    assert.equal(refused.dialogs[0], "period_start and period_end are required");
    await refused.page.close();

    // No belief has a count yet: there is nothing to flag, so there is no button.
    const quiet = await openFloor({
      floor: { ...FLOOR, beliefs: { beliefs: [{ belief: "cost", label: "Cost", this_count: 0, last_count: 0 }], sources: [] } },
    });
    assert.equal(await quiet.page.locator("#fh-flag-mkt").count(), 0);
    await quiet.page.close();
  });
});

test("Today's recordings jump takes the screen to the recordings panel and sends nothing", { timeout: 120_000 }, async () => {
  await proof.check(/^'Today's recordings' jump button/, async () => {
    const { page, errors } = await openFloor();
    const top = () => page.locator("#fh-recordings").evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const before = await top();
    assert.ok(before > 700, `the panel starts below the first screen (top ${before}px)`);
    const calls = page.apiCalls.length;
    await page.locator("#fh-recordings-jump").click();
    await waitFor(async () => (await top()) < 300, "the panel to scroll into view");
    assert.equal(page.apiCalls.filter((c) => c.method === "POST").length, 0, "no request is sent");
    assert.ok(page.apiCalls.length === calls, "no request at all: it only scrolls");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Sync recordings from Drive posts one empty sync, shows it is working, then reads the floor again", { timeout: 120_000 }, async () => {
  await proof.check(/^'Sync recordings from Drive'/, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, dialogs, floorReads, errors } = await openFloor({
      api: async (request, url) => {
        if (request.method() === "POST" && url.pathname === "/api/company-brain/sync") {
          await gate;
          return { ok: true, reason: "not_configured" };
        }
        return undefined;
      },
    });
    assert.equal(floorReads(), 1);
    const button = page.locator("#fh-drive-refresh");
    assert.equal((await button.innerText()).trim(), "Sync recordings from Drive");
    await button.click();
    await waitFor(() => page.apiCalls.some((c) => c.method === "POST" && c.path === "/api/company-brain/sync"), "the sync request");
    assert.equal(await button.isDisabled(), true, "the button is off while it works");
    assert.equal((await button.innerText()).trim(), "Checking Drive…");
    release();
    await waitFor(() => dialogs.length === 1, "the answer");
    assert.equal(dialogs[0], "Google Drive is not connected yet. Recordings stay in Meet Recordings until Drive is turned on.");
    await waitFor(() => floorReads() === 2, "the floor to be read again");
    const sync = page.apiCalls.filter((c) => c.path === "/api/company-brain/sync");
    assert.equal(sync.length, 1, "one sync, not two");
    assert.equal(sync[0].bearer, "Bearer fake-token");
    assert.equal(sync[0].body, "{}", "an empty body: the server decides what to scan");
    await waitFor(async () => (await page.locator("#fh-drive-refresh").count()) === 1 && !(await page.locator("#fh-drive-refresh").isDisabled()), "the button back");
    assert.deepEqual(errors, []);
    await page.close();

    // A refused sync says its own words and still reloads the floor.
    const failed = await openFloor({
      api: (request, url) => (request.method() === "POST" && url.pathname === "/api/company-brain/sync"
        ? { status: 500, body: { ok: false, error: "sync_failed", message: "Drive said no" } }
        : undefined),
    });
    await failed.page.locator("#fh-drive-refresh").click();
    await waitFor(() => failed.dialogs.length === 1, "the refusal");
    assert.match(failed.dialogs[0], /Drive said no|Something went wrong/);
    await waitFor(() => failed.floorReads() === 2, "the floor to be read again");
    await failed.page.close();
  });
});

test("a closer is sent home by the page, the read answers 403 for anyone off the allow list, and the page says Forbidden", { timeout: 180_000 }, async () => {
  await proof.check(/^Closer is bounced and sees 'Forbidden'/, async () => {
    // 1. The shell sends a closer to their own home before the page paints.
    const bounced = await lab.open({ role: "closer", staff: { role: "closer" } });
    await bounced.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
    await bounced.waitForURL((url) => url.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
    assert.equal(bounced.apiCalls.some((c) => c.path === "/api/read/sales-floor"), false, "the floor is never even asked for");
    await bounced.close();

    // 2. If the read refuses anyway (the shell let the person in, the server did not), the page says why.
    const { page } = await openFloor({ floorStatus: 403, role: "owner" });
    const note = page.locator('[data-fh-gate="sales-floor"]');
    await note.waitFor({ state: "visible" });
    assert.equal(
      (await note.innerText()).trim(),
      "Forbidden — the sales floor is for sales managers and owners. Closers are refused.",
    );
    assert.equal(await page.locator("#fh-closer-focus .pickwho").count(), 0, "no floor numbers are painted");
    await page.close();

    // 3. The real handler: only owner, admin and sales manager get past the gate, and a refused role reads nothing.
    for (const role of ["closer", "funding_advisor", "csm", "setter", "inquiry_specialist"]) {
      const fake = fakeDb([staffSession({ role })]);
      const res = makeRes();
      await handler(req("GET"), res, { db: fake });
      assert.equal(res.statusCode, 403, `${role} is refused`);
      assert.equal(res.body.error, "forbidden");
      assert.equal(fake.calls.filter((c) => !/FROM live JOIN staff/.test(c.sql)).length, 0, `${role}: nothing but the session is read`);
    }
    for (const role of ["owner", "admin", "sales_manager"]) {
      const fake = fakeDb([staffSession({ role })]);
      const res = makeRes();
      await handler(req("GET"), res, { db: fake });
      assert.notEqual(res.statusCode, 403, `${role} gets past the gate`);
      assert.ok(fake.calls.filter((c) => !/FROM live JOIN staff/.test(c.sql)).length > 0, `${role}: the floor is read`);
    }
    const noSession = makeRes();
    await handler(req("GET"), noSession, { db: fakeDb([]) });
    assert.equal(noSession.statusCode, 401);
  });
});

test("every listed row was exercised", () => {
  assert.ok(STAFF.id);
  proof.assertAllClaimed();
});
