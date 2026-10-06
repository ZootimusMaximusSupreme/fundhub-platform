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
  addDays, spendWindows, isMissingThing, HOUSE_SLUG
} from "../../api/marketing/today.mjs";

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
      if (s.includes("FROM partner_ai_usage")) return { rows: [{ used: world.used ?? 0 }] };
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

// Ad-days around the windows. Today (Arizona) is 2026-10-05.
const DAYS = [
  { date: "2026-10-04", spend_cents: 1000 },   // last 7, last 30
  { date: "2026-10-04", spend_cents: 500 },    // a second ad, same day
  { date: "2026-09-29", spend_cents: 200 },    // first day of last 7
  { date: "2026-09-28", spend_cents: 300 },    // last day of prior 7
  { date: "2026-09-22", spend_cents: 400 },    // first day of prior 7
  { date: "2026-09-06", spend_cents: 50 },     // first day of last 30
  { date: "2026-09-05", spend_cents: 9999 }    // outside every window
];

describe("marketing/today — pure helpers", () => {
  test("addDays is plain calendar arithmetic, month ends included", () => {
    assert.equal(addDays("2026-10-05", -6), "2026-09-29");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  test("spendWindows: both ends inclusive, prior 7 ends the day before last 7 starts", () => {
    const w = Object.fromEntries(spendWindows("2026-10-05").map((x) => [x.key, x]));
    assert.deepEqual([w.today.from, w.today.to], ["2026-10-05", "2026-10-05"]);
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], ["2026-09-29", "2026-10-05"]);
    assert.deepEqual([w.prior_7_days.from, w.prior_7_days.to], ["2026-09-22", "2026-09-28"]);
    assert.deepEqual([w.last_30_days.from, w.last_30_days.to], ["2026-09-06", "2026-10-05"]);
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

describe("marketing/today — the answer", () => {
  const WORLD = {
    days: DAYS,
    metaSyncedAt: new Date("2026-10-05T07:01:50Z"),
    metricsSyncedAt: new Date("2026-10-05T07:01:51Z"),
    pieces: [{ id: "a1", compliance_state: "passed", blocked_reasons: [], copy_text: "Words." }],
    jobs: [{ id: "j1", status: "succeeded", error: null }]
  };

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
  });

  test("spend: exact integer cents per window, from the rows inside it only", async () => {
    const { r } = await call(WORLD);
    const w = r.body.spend.windows;
    assert.equal(r.body.spend.currency, "USD");
    assert.equal(w.last_7_days.spend_cents, 1700);     // 1000 + 500 + 200
    assert.equal(w.last_7_days.ad_days, 3);
    assert.equal(w.last_7_days.days_with_data, 2);
    assert.equal(w.prior_7_days.spend_cents, 700);     // 300 + 400
    assert.equal(w.last_30_days.spend_cents, 2450);    // all but the 9999
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

  test("no ad numbers at all → every window null, spend named in waiting, still 200", async () => {
    const { r } = await call({ ...WORLD, days: [] });
    assert.equal(r.code, 200);
    for (const w of Object.values(r.body.spend.windows)) assert.equal(w.spend_cents, null);
    assert.ok(r.body.waiting.some((x) => x.part === "spend"));
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
    const { r } = await call({ ...WORLD, fail: { "unnest(": missing, "max(synced_at)": missing } });
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
