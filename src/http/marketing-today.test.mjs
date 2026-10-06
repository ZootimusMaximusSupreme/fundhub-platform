/* Database-free tests for GET /api/marketing/today.
 *
 * WHY THIS FILE EXISTS. Its sibling src/http/marketing-today.pg.test.mjs is the
 * proof against real Postgres, and it skips with DATABASE_URL unset — and the
 * Mac this was written on has no Postgres. A skipped .pg.test.mjs is not green
 * (CLAUDE.md §12). So the handler takes its database, its auth gate, its staff
 * scope, its env and its clock as arguments, and this file drives it with fakes.
 * It runs on every push.
 *
 * What a fake CANNOT prove: that the SQL text is valid Postgres, that the
 * column names exist, and that row-level security lets asStaff() see the rows.
 * That is the .pg test's job.
 *
 * NO `.pg.` IN THE NAME, ON PURPOSE: npm test's glob is src/** and scripts/**.
 * No real request leaves this file — nothing here calls fetch.
 */

import { test, describe } from "node:test";
import assert from "node:assert";

import handler, {
  addDays, spendWindows, spendEnd, isMissingThing, HOUSE_SLUG,
  shapeOfferCost, shapeCopyCost, COPY_COST_RUNS
} from "../../api/marketing/today.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { MODEL_PRICES, costOfCalls, priceOf } from "../marketing/model-prices.mjs";

const ORG = "11111111-2222-3333-4444-555555555555";
const HOUSE = "22222222-3333-4444-5555-666666666666";
const ANT = "sk-ant-fake-never-printed";

// 2026-10-06 05:30 UTC is 2026-10-05 22:30 in Arizona. "Today" must be the 5th.
const NOW = new Date("2026-10-06T05:30:00Z");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/* A fake gate shaped like requireAuth: a staff row, or a 401 written to res. */
const authAs = (role) => async (req, r) => {
  if (!role) { r.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  return { id: "s1", role, org_id: ORG };
};

/* fakeTx — answers each read the handler makes, by what the SQL reads. It
   applies the same date window rule as the SQL (BETWEEN, both ends in), so the
   window arithmetic is tested against data, not just restated. */
function fakeTx(world, log) {
  return {
    query: async (sql, params = []) => {
      log.push(sql);
      const s = String(sql);
      const fail = world.fail && Object.keys(world.fail).find((k) => s.includes(k));
      if (fail) throw world.fail[fail];

      if (s.includes("FROM partners WHERE org_id")) {
        return { rows: world.house === null ? [] : [{ id: HOUSE, org_id: ORG }] };
      }
      if (s.includes("FROM creative_assets")) return { rows: world.pieces || [] };
      if (s.includes("FROM generation_jobs")) return { rows: world.jobs || [] };
      if (s.includes("FROM partner_module_settings")) {
        return { rows: world.settings === null ? [] : [{
          marketing_suite_enabled: world.switchOn !== false,
          ai_token_cap_monthly: world.cap ?? 250000,
          org_id: ORG
        }] };
      }
      if (s.includes("SELECT org_id FROM partners WHERE id")) return { rows: [{ org_id: ORG }] };
      // The copy writer's own calls (the cost line), newest first, at most $2.
      if (s.includes("FROM partner_ai_usage") && s.includes("purpose = 'creative'")) {
        assert.equal(params[0], HOUSE, "the cost line reads the house partner's calls only");
        return { rows: (world.copyCalls || []).slice(0, params[1]) };
      }
      if (s.includes("FROM partner_ai_usage")) return { rows: [{ used: world.used ?? 0 }] };
      // The offer cost read only. U32's stuck_jobs read also says FROM marketing_jobs;
      // it carries a "-- m5:" tag and is answered below from world.m5.
      if (s.includes("FROM marketing_jobs") && !s.includes("-- m5:")) {
        return { rows: world.offerRun ? [world.offerRun] : [] };
      }
      if (s.includes("FROM analytics_connections")) {
        return { rows: [{ clickfunnels_synced_at: world.cfSyncedAt ?? null }] };
      }
      if (s.includes("spend_end_day")) {
        const days = world.days || [];
        return { rows: [{
          spend_end_day: days.length ? days.map((d) => d.date).sort().at(-1) : null,
          meta_synced_at: world.metaSyncedAt ?? null
        }] };
      }
      if (s.includes("FROM creative_providers")) {
        return { rows: world.provider === false ? [] : [{ provider_key: "copy", config: {} }] };
      }
      if (s.includes("unnest(")) {
        const [, keys, froms, tos] = params;
        const days = world.days || [];
        return {
          rows: keys.map((key, i) => {
            const inside = days.filter((d) => d.date >= froms[i] && d.date <= tos[i]);
            return {
              key,
              // SUM over no rows is NULL in SQL; a bigint arrives as a string.
              spend_cents: inside.length ? String(inside.reduce((a, d) => a + d.spend_cents, 0)) : null,
              ad_days: inside.length,
              days_with_data: new Set(inside.map((d) => d.date)).size
            };
          })
        };
      }
      if (s.includes("FROM ad_platform_connections")) {
        return { rows: [{ meta_synced_at: world.metaSyncedAt ?? null }] };
      }
      if (s.includes("max(synced_at)")) {
        const days = world.days || [];
        return { rows: [{
          metrics_synced_at: days.length ? world.metricsSyncedAt : null,
          latest_metrics_date: days.length ? days.map((d) => d.date).sort().at(-1) : null
        }] };
      }
      // U32's M5 reads (U20's lead CTE, the "-- m5:" queries, the funnel list).
      // They answer from world.m5 by query name, else empty. Their exact numbers
      // are proved against real Postgres in marketing-today.pg.test.mjs and in
      // src/marketing/metrics-rollups.test.mjs.
      if (s.includes("lead_rows AS") || s.includes("-- m5:") || s.includes("FROM marketing_funnels")) {
        const name = (/-- m5:(\w+)/.exec(s) || [])[1] || (s.includes("FROM marketing_funnels") ? "funnels" : "lead_rows");
        return { rows: (world.m5 && world.m5[name]) || [] };
      }
      throw new Error("fakeTx: unexpected query " + s.slice(0, 80));
    }
  };
}

const FLYWHEEL = () => ({ campaigns: [{ campaign: "partner", stages: [{ n: 3, state: "FAILED" }], advice: null }] });

async function call(world = {}, { role = "owner", method = "GET", env = { ANTHROPIC_API_KEY: ANT }, flywheel = FLYWHEEL } = {}) {
  const log = [];
  const r = res();
  await handler({ method, headers: {}, query: {} }, r, {
    db: {},
    requireAuth: authAs(role),
    asStaff: async (fn) => fn(fakeTx(world, log)),
    env,
    flywheel,
    now: () => NOW
  });
  return { r, log };
}

// Ad-days around the windows. Today (Arizona) is 2026-10-05. The newest saved
// day is 2026-10-04 (the Meta pull saves through yesterday), so every 7 and 30
// day window ends on the 4th and is made of whole days.
const DAYS = [
  { date: "2026-10-04", spend_cents: 1000 },   // last day of last 7 and last 30
  { date: "2026-10-04", spend_cents: 500 },    // a second ad, same day
  { date: "2026-09-28", spend_cents: 200 },    // first day of last 7
  { date: "2026-09-27", spend_cents: 300 },    // last day of prior 7
  { date: "2026-09-21", spend_cents: 400 },    // first day of prior 7
  { date: "2026-09-05", spend_cents: 50 },     // first day of last 30
  { date: "2026-09-04", spend_cents: 70 },     // last day of prior 30
  { date: "2026-08-06", spend_cents: 80 },     // first day of prior 30
  { date: "2026-08-05", spend_cents: 9999 }    // outside every window
];

describe("marketing/today — pure helpers", () => {
  test("addDays is plain calendar arithmetic, month ends included", () => {
    assert.equal(addDays("2026-10-05", -6), "2026-09-29");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  test("spendWindows: whole days ending on the newest saved day; prior windows end the day before", () => {
    const w = Object.fromEntries(spendWindows("2026-10-05", "2026-10-04").map((x) => [x.key, x]));
    assert.deepEqual([w.today.from, w.today.to], ["2026-10-05", "2026-10-05"], "today is still today");
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-09-28", "2026-10-04"]);
    assert.deepEqual([w.prior_7_days.from, w.prior_7_days.to], ["2026-09-21", "2026-09-27"]);
    assert.deepEqual([w.last_30_days.from, w.last_30_days.to], ["2026-09-05", "2026-10-04"]);
    assert.deepEqual([w.prior_30_days.from, w.prior_30_days.to], ["2026-08-06", "2026-09-04"]);
    for (const k of ["last_7_days", "prior_7_days", "last_30_days", "prior_30_days"]) {
      const days = (Date.parse(w[k].to) - Date.parse(w[k].from)) / 86400000 + 1;
      assert.equal(days, w[k].days, `${k} covers exactly ${w[k].days} days`);
    }
  });

  test("spendEnd: the newest saved day, never today or later; nothing saved → yesterday", () => {
    assert.equal(spendEnd("2026-10-05", "2026-10-04"), "2026-10-04");
    assert.equal(spendEnd("2026-10-05", "2026-10-01"), "2026-10-01", "an old pull keeps its own days");
    assert.equal(spendEnd("2026-10-05", "2026-10-05"), "2026-10-04", "today is not a whole day yet");
    assert.equal(spendEnd("2026-10-05", "2026-10-07"), "2026-10-04", "never a day after today");
    assert.equal(spendEnd("2026-10-05", null), "2026-10-04");
    assert.equal(spendEnd("2026-10-05", "not a day"), "2026-10-04");
  });

  test("spendEnd: ads stopped — the pull keeps the windows moving past the last saved day", () => {
    // Ads stopped after Oct 4. The midnight pull on Oct 12 covered Oct 11 and
    // sent no rows, so the newest saved day is still Oct 4.
    assert.equal(spendEnd("2026-10-12", "2026-10-04", "2026-10-12"), "2026-10-11");
    // The same pull, read later that day: still Oct 11.
    assert.equal(spendEnd("2026-10-12", "2026-10-04", "2026-10-12"), "2026-10-11");
    // A late pull (ran Oct 9, nothing since): the windows end on Oct 8, never past what was pulled.
    assert.equal(spendEnd("2026-10-12", "2026-10-04", "2026-10-09"), "2026-10-08");
    // An old pull: its own days, not today's.
    assert.equal(spendEnd("2026-10-05", "2026-09-30", "2026-10-01"), "2026-09-30");
    // A hand pull this afternoon covered only part of today: still yesterday.
    assert.equal(spendEnd("2026-10-05", "2026-10-05", "2026-10-05"), "2026-10-04");
    // Never pulled, or a bad day: only the saved day counts.
    assert.equal(spendEnd("2026-10-05", "2026-10-01", null), "2026-10-01");
    assert.equal(spendEnd("2026-10-05", "2026-10-01", "nope"), "2026-10-01");
    const w = Object.fromEntries(spendWindows("2026-10-12", "2026-10-04", "2026-10-12").map((x) => [x.key, x]));
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-10-05", "2026-10-11"]);
    assert.deepEqual([w.prior_7_days.from, w.prior_7_days.to], ["2026-09-28", "2026-10-04"]);
  });

  test("isMissingThing: only 'does not exist' codes, not every database error", () => {
    assert.equal(isMissingThing({ code: "42P01" }), true);
    assert.equal(isMissingThing({ code: "42703" }), true);
    assert.equal(isMissingThing({ code: "23505" }), false);
    assert.equal(isMissingThing(new Error("boom")), false);
  });
});

describe("marketing/today — the gate", () => {
  test("POST is refused with 405 and Allow: GET", async () => {
    const { r } = await call({}, { method: "POST" });
    assert.equal(r.code, 405);
    assert.equal(r.headers.Allow, "GET");
  });

  test("no session → 401, and nothing is read", async () => {
    const { r, log } = await call({}, { role: null });
    assert.equal(r.code, 401);
    assert.equal(log.length, 0);
  });

  for (const role of ["closer", "sales_manager", "funding_advisor", "setter", "csm"]) {
    test(`${role} → 403, and nothing is read`, async () => {
      const { r, log } = await call({}, { role });
      assert.equal(r.code, 403);
      assert.equal(log.length, 0);
    });
  }

  test("admin is let in like the owner", async () => {
    const { r } = await call({ days: DAYS, metaSyncedAt: new Date("2026-10-05T07:01:50Z") }, { role: "admin" });
    assert.equal(r.code, 200);
  });
});

const WORLD = {
  days: DAYS,
  metaSyncedAt: new Date("2026-10-05T07:01:50Z"),
  metricsSyncedAt: new Date("2026-10-05T07:01:51Z"),
  cfSyncedAt: new Date("2026-10-04T22:10:00Z"),
  pieces: [{ id: "a1", compliance_state: "passed", blocked_reasons: [], copy_text: "Words." }],
  jobs: [{ id: "j1", status: "succeeded", error: null }]
};

describe("marketing/today — the answer", () => {

  test("owner gets every part, today is Arizona's day, as_of is the clock", async () => {
    const { r } = await call(WORLD);
    assert.equal(r.code, 200);
    const b = r.body;
    assert.equal(b.ok, true);
    assert.equal(b.today, "2026-10-05");
    assert.equal(b.timezone, "America/Phoenix");
    assert.equal(b.as_of, NOW.toISOString());
    assert.deepEqual(b.waiting, []);
    assert.equal(b.flywheel.campaigns[0].campaign, "partner");
    assert.equal(b.copy.partner_id, HOUSE);
    assert.equal(b.copy.pieces[0].copy_text, "Words.");
    assert.equal(b.copy.jobs[0].status, "succeeded");
    assert.equal(b.copy_ready.ready, true);
    assert.equal(b.copy_ready.partner_id, HOUSE);
    assert.deepEqual(b.copy_ready.missing, []);
    assert.deepEqual(b.copy_ready.checks.map((c) => c.key),
      ["marketing_switch", "copy_provider", "anthropic_key", "writing_budget"]);
    assert.equal(b.last_sync.meta_synced_at.toISOString(), "2026-10-05T07:01:50.000Z");
    assert.equal(b.last_sync.latest_metrics_date, "2026-10-04");
    assert.equal(b.last_sync.clickfunnels_synced_at.toISOString(), "2026-10-04T22:10:00.000Z");
    assert.equal(b.spend.through, "2026-10-04");
  });

  test("spend: exact integer cents per window, from the rows inside it only", async () => {
    const { r } = await call(WORLD);
    const w = r.body.spend.windows;
    assert.equal(r.body.spend.currency, "USD");
    assert.equal(w.last_7_days.spend_cents, 1700);     // 1000 + 500 + 200
    assert.equal(w.last_7_days.ad_days, 3);
    assert.equal(w.last_7_days.days_with_data, 2);
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-09-28", "2026-10-04"]);
    assert.equal(w.prior_7_days.spend_cents, 700);     // 300 + 400
    assert.equal(w.last_30_days.spend_cents, 2450);    // 1700 + 700 + 50
    assert.equal(w.prior_30_days.spend_cents, 150);    // 70 + 80, never the 9999
    assert.equal(w.prior_30_days.days, 30);
    for (const k of Object.keys(w)) {
      if (w[k].spend_cents !== null) assert.ok(Number.isInteger(w[k].spend_cents), k);
    }
  });

  test("NULL survives: a window with no saved ad-days is null, never 0", async () => {
    const { r } = await call(WORLD);
    const t = r.body.spend.windows.today;
    assert.equal(t.spend_cents, null);
    assert.equal(t.ad_days, 0);
    assert.equal(t.days_with_data, 0);
  });

  test("no ad numbers at all → every window null, through null, spend named in waiting, still 200", async () => {
    const { r } = await call({ ...WORLD, days: [] });
    assert.equal(r.code, 200);
    for (const w of Object.values(r.body.spend.windows)) assert.equal(w.spend_cents, null);
    assert.equal(r.body.spend.through, null);
    const w = r.body.waiting.find((x) => x.part === "spend");
    assert.equal(w.reason, "No ad numbers are saved yet.");
  });

  test("an old pull: the windows end on the last saved day, so no window is padded with empty days", async () => {
    const old = [{ date: "2026-09-30", spend_cents: 100 }, { date: "2026-09-24", spend_cents: 40 }];
    // The last pull ran Oct 1 at midnight Arizona and covered through Sep 30.
    const { r } = await call({ ...WORLD, days: old, metaSyncedAt: new Date("2026-10-01T07:01:50Z") });
    const w = r.body.spend.windows;
    assert.equal(r.body.spend.through, "2026-09-30");
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-09-24", "2026-09-30"]);
    assert.equal(w.last_7_days.spend_cents, 140);
    assert.equal(w.today.spend_cents, null);
  });

  test("ads stopped, the pull is fresh: the windows end on yesterday, the empty week is null, the week before keeps its money", async () => {
    // The newest saved day is Sep 30 but tonight's midnight pull ran on Oct 5
    // (Arizona) and covered Oct 4. Meta sent no rows for Oct 1 to Oct 4.
    const stopped = [{ date: "2026-09-30", spend_cents: 100 }, { date: "2026-09-24", spend_cents: 40 }];
    const { r } = await call({ ...WORLD, days: stopped, metaSyncedAt: new Date("2026-10-05T07:01:50Z") });
    const w = r.body.spend.windows;
    assert.equal(r.body.spend.through, "2026-10-04", "not frozen on the last day with ads");
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-09-28", "2026-10-04"]);
    assert.equal(w.last_7_days.spend_cents, 100, "Sep 30 is inside the window");
    assert.deepEqual([w.prior_7_days.from, w.prior_7_days.to], ["2026-09-21", "2026-09-27"]);
    assert.equal(w.prior_7_days.spend_cents, 40);
    assert.equal(r.body.last_sync.latest_metrics_date, "2026-09-30", "the last day with ads is still named");

    // The last ad ran Sep 24: the newest 7 whole days hold no rows → null, never 0.
    const quiet = await call({ ...WORLD, days: [{ date: "2026-09-24", spend_cents: 40 }],
      metaSyncedAt: new Date("2026-10-05T07:01:50Z") });
    const q = quiet.r.body.spend.windows;
    assert.equal(quiet.r.body.spend.through, "2026-10-04");
    assert.equal(q.last_7_days.spend_cents, null);
    assert.equal(q.last_7_days.ad_days, 0);
    assert.equal(q.prior_7_days.spend_cents, 40);
    assert.ok(!quiet.r.body.waiting.some((x) => x.part === "spend"), "numbers are saved; this week just has none");
  });

  test("ClickFunnels never pulled → null, and the rest of last_sync is untouched", async () => {
    const { r } = await call({ ...WORLD, cfSyncedAt: null });
    assert.equal(r.body.last_sync.clickfunnels_synced_at, null);
    assert.equal(r.body.last_sync.latest_metrics_date, "2026-10-04");
  });

  test("the ClickFunnels table not shipped → clickfunnels waiting, Meta times still there", async () => {
    const missing = Object.assign(new Error('relation "analytics_connections" does not exist'), { code: "42P01" });
    const { r } = await call({ ...WORLD, fail: { "FROM analytics_connections": missing } });
    assert.equal(r.code, 200);
    assert.equal(r.body.last_sync.clickfunnels_synced_at, null);
    assert.equal(r.body.last_sync.latest_metrics_date, "2026-10-04");
    assert.ok(r.body.waiting.some((x) => x.part === "clickfunnels"));
  });

  test("Meta never synced → last_sync waiting, values null", async () => {
    const { r } = await call({ ...WORLD, days: [], metaSyncedAt: null });
    assert.equal(r.body.last_sync.meta_synced_at, null);
    assert.ok(r.body.waiting.some((x) => x.part === "last_sync"));
  });

  test("no copy provider row → not ready, and says so in plain words", async () => {
    const { r } = await call({ ...WORLD, provider: false });
    assert.equal(r.body.copy_ready.ready, false);
    const c = r.body.copy_ready.checks.find((x) => x.key === "copy_provider");
    assert.equal(c.ok, false);
    assert.deepEqual(r.body.copy_ready.missing, ["No copy writer is set up for this company."]);
  });

  test("marketing switch off → not ready", async () => {
    const { r } = await call({ ...WORLD, switchOn: false });
    assert.equal(r.body.copy_ready.ready, false);
    assert.ok(r.body.copy_ready.missing.includes("The marketing switch is off for the house partner."));
  });

  test("no settings row at all reads as switch off (the meter's own default)", async () => {
    const { r } = await call({ ...WORLD, settings: null });
    assert.equal(r.body.copy_ready.checks.find((x) => x.key === "marketing_switch").ok, false);
  });

  test("writing budget used up → not ready, with the numbers", async () => {
    const { r } = await call({ ...WORLD, used: 250000 });
    const c = r.body.copy_ready.checks.find((x) => x.key === "writing_budget");
    assert.equal(c.ok, false);
    assert.equal(c.used, 250000);
    assert.match(c.missing, /250000 of 250000/);
  });

  test("Anthropic key missing or a hidden copy → not ready; the key value never appears", async () => {
    const none = await call(WORLD, { env: {} });
    assert.equal(none.r.body.copy_ready.ready, false);
    assert.match(none.r.body.copy_ready.missing.join(" "), /ANTHROPIC_API_KEY\) is not set/);

    const masked = await call(WORLD, { env: { ANTHROPIC_API_KEY: "****************abcd" } });
    assert.match(masked.r.body.copy_ready.missing.join(" "), /hidden copy/);

    const ok = await call(WORLD);
    assert.ok(!JSON.stringify(ok.r.body).includes(ANT), "the key value must never be in the answer");
  });

  test("no house partner → copy waiting, copy_ready false, rest of the page still answers", async () => {
    const { r } = await call({ ...WORLD, house: null });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.copy, { partner_id: null, pieces: [], jobs: [] });
    assert.equal(r.body.copy_ready.ready, false);
    assert.match(r.body.copy_ready.missing[0], new RegExp(HOUSE_SLUG));
    assert.ok(r.body.waiting.some((x) => x.part === "copy"));
    assert.equal(r.body.spend.windows.last_7_days.spend_cents, 1700);
  });

  test("a table that is not there yet → that part is empty and named in waiting; never an error", async () => {
    const missing = Object.assign(new Error('relation "creative_assets" does not exist'), { code: "42P01" });
    const { r } = await call({ ...WORLD, fail: { "FROM creative_assets": missing } });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.copy.pieces, []);
    assert.deepEqual(r.body.copy.jobs, []);
    const w = r.body.waiting.find((x) => x.part === "copy");
    assert.equal(w.reason, "The creative_assets table is not in the database yet.");
    // The other parts are untouched.
    assert.equal(r.body.copy_ready.ready, true);
    assert.equal(r.body.spend.windows.prior_7_days.spend_cents, 700);
  });

  test("a missing spend table → spend null and waiting, page still 200", async () => {
    const missing = Object.assign(new Error('relation "ad_metrics_daily" does not exist'), { code: "42P01" });
    const { r } = await call({ ...WORLD, fail: { "spend_end_day": missing, "max(synced_at)": missing } });
    assert.equal(r.code, 200);
    assert.equal(r.body.spend, null);
    assert.equal(r.body.last_sync, null);
    assert.deepEqual(r.body.waiting.map((x) => x.part).sort(), ["last_sync", "spend"]);
  });

  test("flywheel files not on the server → flywheel null and waiting", async () => {
    const { r } = await call(WORLD, { flywheel: () => null });
    assert.equal(r.body.flywheel, null);
    assert.ok(r.body.waiting.some((x) => x.part === "flywheel"));
  });

  test("database not answering → 503 db down, not a fake empty page", async () => {
    const down = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });
    const { r } = await call({ ...WORLD, fail: { "FROM partners WHERE org_id": down } });
    assert.equal(r.code, 503);
    assert.equal(r.body.db, "down");
  });

  test("any other fault is thrown (a 500), not hidden as 'waiting'", async () => {
    const bug = Object.assign(new Error("syntax error at or near FROM"), { code: "42601" });
    await assert.rejects(() => call({ ...WORLD, fail: { "unnest(": bug } }), /syntax error/);
  });
});

// ── U32: the M5 keys (spec §8.3, §11.2; contract shape 7) ───────────────────

describe("marketing/today — the M5 keys (U32)", () => {
  const WORLD = {
    days: DAYS,
    metaSyncedAt: new Date("2026-10-05T07:01:50Z"),
    metricsSyncedAt: new Date("2026-10-05T07:01:51Z")
  };
  // "costs" is slice 0's key (S0); it comes before U32's six.
  const OLD_KEYS = ["ok", "as_of", "today", "timezone", "waiting", "flywheel", "copy",
    "copy_ready", "spend", "last_sync", "costs"];
  const NEW_KEYS = ["numbers", "daily", "spend_by_funnel", "flow", "scripts_waiting", "stuck_jobs"];

  test("every old key is still there; the six new keys are added; the answer matches the contract", async () => {
    const { r } = await call(WORLD);
    assert.equal(r.code, 200);
    assert.deepEqual(Object.keys(r.body), [...OLD_KEYS, ...NEW_KEYS]);
    assert.doesNotThrow(() => assertMatchesContract("GET marketing/today", r.body));
    // The old answer is untouched by the new parts.
    assert.equal(r.body.spend.windows.last_7_days.spend_cents, 1700);
    assert.deepEqual(r.body.waiting, []);
  });

  test("no M5 data: unknown money stays null, counts are a real 0, lists are empty", async () => {
    const { r } = await call(WORLD);
    const b = r.body;
    for (const k of ["today", "d7", "d30"]) {
      assert.equal(b.numbers[k].spend_cents, null, k);
      assert.equal(b.numbers[k].leads, 0, k);
      assert.equal(b.numbers[k].roas, null, k);
    }
    assert.deepEqual(b.daily, []);
    assert.deepEqual(b.spend_by_funnel, []);
    assert.equal(b.flow.page_views, null, "no funnel lands on a tracked page: unknown, not 0");
    assert.equal(b.flow.clicks, null);
    assert.deepEqual(b.scripts_waiting, { ready: 0, flagged: 0 });
    assert.deepEqual(b.stuck_jobs, []);
  });

  test("spend_by_funnel: the script's funnel first, the campaign's next, the rest Unmapped", async () => {
    const m5 = {
      ad_labels: [
        { ad_row_id: "a1", ad_number: "91", spine_angle_key: null, campaign_external_id: "c1", campaign_funnel_key: "book_call" },
        { ad_row_id: "a2", ad_number: null, spine_angle_key: null, campaign_external_id: "c1", campaign_funnel_key: "book_call" },
        { ad_row_id: "a3", ad_number: null, spine_angle_key: null, campaign_external_id: "c2", campaign_funnel_key: null }
      ],
      ad_spend: [
        { ad_row_id: "a1", spend_cents: "1200", link_clicks: null, ad_days: 2, link_click_days: 0 },
        { ad_row_id: "a2", spend_cents: "300", link_clicks: "9", ad_days: 1, link_click_days: 1 },
        { ad_row_id: "a3", spend_cents: "50", link_clicks: null, ad_days: 1, link_click_days: 0 }
      ],
      script_labels: [{ ad_number: "91", funnel_key: "roadmap_147", angle_key: null }],
      funnels: [
        { key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch", active: true },
        { key: "roadmap_147", name: "Roadmap", landing_url: "https://apply.fundhub.ai/roadmap", active: true }
      ],
      funnel_steps: [{ page: "/watch", name: "funnel.page", events: 4 }, { page: "/roadmap-book", name: "funnel.page", events: 9 }]
    };
    const { r } = await call({ ...WORLD, m5 });
    assert.deepEqual(r.body.spend_by_funnel, [
      { funnel_key: "roadmap_147", name: "Roadmap", spend_cents: 1200 },
      { funnel_key: "book_call", name: "Book a call", spend_cents: 300 },
      { funnel_key: null, name: "Unmapped", spend_cents: 50 }
    ]);
    assert.equal(r.body.flow.page_views, 4, "landing pages only: /roadmap-book is not a landing page");
  });

  test("scripts_waiting and stuck_jobs pass through with each job's id for Retry", async () => {
    const since = new Date("2026-10-05T19:40:00Z");
    const m5 = {
      scripts_waiting: [{ ready: 3, flagged: 1 }],
      stuck_jobs: [{ id: "00000000-0000-4000-8000-000000000501", kind: "write_slot", error: "The writer stopped.", since }]
    };
    const { r } = await call({ ...WORLD, m5 });
    assert.deepEqual(r.body.scripts_waiting, { ready: 3, flagged: 1 });
    assert.deepEqual(r.body.stuck_jobs, [{
      id: "00000000-0000-4000-8000-000000000501", kind: "write_slot",
      error: "The writer stopped.", since: since.toISOString()
    }]);
  });

  test("a missing marketing_jobs table → stuck_jobs [] and named in waiting; nothing else moves", async () => {
    const missing = Object.assign(new Error('relation "marketing_jobs" does not exist'), { code: "42P01" });
    const { r } = await call({ ...WORLD, fail: { "-- m5:stuck_jobs": missing } });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.stuck_jobs, []);
    assert.deepEqual(r.body.waiting, [{ part: "stuck_jobs", reason: "The marketing_jobs table is not in the database yet." }]);
    assert.deepEqual(r.body.scripts_waiting, { ready: 0, flagged: 0 });
    assert.equal(r.body.spend.windows.last_30_days.spend_cents, 2450);
  });

  test("a closer is still refused before any M5 read", async () => {
    const { r, log } = await call(WORLD, { role: "closer" });
    assert.equal(r.code, 403);
    assert.equal(log.length, 0);
  });
});

// ── what the last measured runs cost ─────────────────────────────────────────

/* The offer contract's one measured run (docs/specs/marketing-offer-contract.md):
   4 min 29 s, 24,551 in and 28,640 out on claude-opus-5-5. */
const OFFER_RUN = {
  id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  claimed_at: new Date("2026-10-05T18:00:00Z"),
  finished_at: new Date("2026-10-05T18:04:29Z"),
  usage: {
    input_tokens: 24551, output_tokens: 28640,
    calls: [
      { step: "candidates", model: "claude-opus-5-5", input_tokens: 9000, output_tokens: 12931 },
      { step: "judges", model: "claude-opus-5-5", input_tokens: 12000, output_tokens: 10204 },
      { step: "synthesis", model: "claude-opus-5-5", input_tokens: 3551, output_tokens: 5505 }
    ]
  }
};

describe("model prices — only with a source", () => {
  test("Opus 5.5 is $4 in, $20 out per million tokens; nothing else is guessed", () => {
    assert.deepEqual({ ...priceOf("claude-opus-5-5") }, { inCentsPerMTok: 400, outCentsPerMTok: 2000 });
    assert.equal(priceOf("claude-sonnet-4-5-20250929"), null);
    assert.equal(priceOf("gpt-4o-mini"), null);
    assert.equal(priceOf("claude-opus-5-5-20260401"), null, "exact names only, no near matches");
    assert.deepEqual(Object.keys(MODEL_PRICES), ["claude-opus-5-5"]);
  });

  test("the offer contract's measured run is 67 cents", () => {
    const c = costOfCalls([{ model: "claude-opus-5-5", input_tokens: 24551, output_tokens: 28640 }]);
    assert.equal(c.cents, 67);
    assert.deepEqual(c.unpriced, []);
  });

  test("one call with no price on file makes the whole total unknown, never a smaller number", () => {
    const c = costOfCalls([
      { model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 1000 },
      { model: "gpt-4o-mini", input_tokens: 1000, output_tokens: 1000 }
    ]);
    assert.equal(c.cents, null);
    assert.deepEqual(c.unpriced, ["gpt-4o-mini"]);
    assert.equal(costOfCalls([]).cents, null, "no calls is not a measured $0");
  });
});

describe("marketing/today — costs", () => {
  test("offer: the newest finished run, its minutes and its dollars", async () => {
    const { r } = await call({ ...WORLD, offerRun: OFFER_RUN });
    const o = r.body.costs.offer;
    assert.equal(o.measured, true);
    assert.equal(o.job_id, OFFER_RUN.id);
    assert.equal(o.seconds, 269);
    assert.equal(o.input_tokens, 24551);
    assert.equal(o.output_tokens, 28640);
    assert.deepEqual(o.models, ["claude-opus-5-5"]);
    assert.equal(o.cost_cents, 67);
    assert.deepEqual(o.unpriced_models, []);
  });

  test("offer: no finished run yet → measured false, every number null", async () => {
    const { r } = await call(WORLD);
    const o = r.body.costs.offer;
    assert.equal(o.measured, false);
    for (const k of ["seconds", "cost_cents", "input_tokens", "output_tokens", "job_id"]) assert.equal(o[k], null, k);
  });

  test("offer: a run on a model with no price → cost null, the model named", () => {
    const o = shapeOfferCost({ ...OFFER_RUN, usage: { input_tokens: 10, output_tokens: 10,
      calls: [{ model: "gpt-4o-mini", input_tokens: 10, output_tokens: 10 }] } });
    assert.equal(o.measured, true);
    assert.equal(o.cost_cents, null);
    assert.deepEqual(o.unpriced_models, ["gpt-4o-mini"]);
  });

  test("offer: no pick-up time recorded → seconds unknown, not 0", () => {
    assert.equal(shapeOfferCost({ ...OFFER_RUN, claimed_at: null }).seconds, null);
  });

  test("the marketing_jobs table not shipped → costs.offer null and named in waiting", async () => {
    const missing = Object.assign(new Error('relation "marketing_jobs" does not exist'), { code: "42P01" });
    const { r } = await call({ ...WORLD, fail: { "FROM marketing_jobs": missing } });
    assert.equal(r.code, 200);
    assert.equal(r.body.costs.offer, null);
    assert.ok(r.body.waiting.some((x) => x.part === "costs"));
    assert.equal(r.body.costs.copy.runs, 0, "the copy line is a separate read and still answers");
  });

  test("copy: the house partner's last calls averaged; Sonnet has no price here, so dollars are unknown", async () => {
    const calls = [
      { created_at: new Date("2026-10-05T18:00:00Z"), input_tokens: 300, output_tokens: 90, model: "claude-sonnet-4-5-20250929" },
      { created_at: new Date("2026-10-04T18:00:00Z"), input_tokens: 100, output_tokens: 30, model: "claude-sonnet-4-5-20250929" }
    ];
    const { r } = await call({ ...WORLD, copyCalls: calls });
    const c = r.body.costs.copy;
    assert.equal(c.runs, 2);
    assert.equal(c.avg_input_tokens, 200);
    assert.equal(c.avg_output_tokens, 60);
    assert.equal(c.avg_cost_cents, null);
    assert.deepEqual(c.unpriced_models, ["claude-sonnet-4-5-20250929"]);
    assert.equal(c.last_at.toISOString(), "2026-10-05T18:00:00.000Z");
  });

  test("copy: priced runs average to whole cents, at most the last five", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      created_at: new Date(Date.UTC(2026, 9, 5, 18 - i)),
      // 100,000 out on Opus 5.5 = 200 cents; the sixth would drag the average if counted.
      input_tokens: 0, output_tokens: i === 5 ? 0 : 100000, model: "claude-opus-5-5"
    }));
    const { r } = await call({ ...WORLD, copyCalls: six });
    assert.equal(COPY_COST_RUNS, 5);
    assert.equal(r.body.costs.copy.runs, 5);
    assert.equal(r.body.costs.copy.avg_cost_cents, 200);
  });

  test("copy: a tiny priced run is 'under one cent', not a measured $0", () => {
    const c = shapeCopyCost([{ created_at: "2026-10-05T18:00:00Z", input_tokens: 100, output_tokens: 100, model: "claude-opus-5-5" }]);
    assert.equal(c.avg_cost_cents, 0);
    assert.equal(c.under_one_cent, true);
  });

  test("copy: no calls yet → runs 0 and every number null", async () => {
    const { r } = await call(WORLD);
    const c = r.body.costs.copy;
    assert.equal(c.runs, 0);
    assert.equal(c.avg_cost_cents, null);
    assert.equal(c.avg_input_tokens, null);
  });

  test("no house partner → nobody wrote copy: runs 0, not an error", async () => {
    const { r } = await call({ ...WORLD, house: null });
    assert.equal(r.body.costs.copy.runs, 0);
  });
});
