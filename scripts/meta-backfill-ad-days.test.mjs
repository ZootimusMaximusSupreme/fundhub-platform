// The one-time Meta backfill (scripts/meta-backfill-ad-days.mjs), driven by a
// fake Meta and a fake database. No network, no Postgres.
//
// The scenario is the real one in miniature: the three August book-a-call ads
// delivered Aug 4–7 and Aug 12–20 (Meta time, Arizona), and our table only
// holds Aug 17 onward because the first pull (2026-08-24) could reach back 7
// days. The Meta rows follow Meta's documented shape; they are not captured
// from the live account.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  backfillRange,
  planBackfill,
  runBackfill,
  describe as describeResult
} from "./meta-backfill-ad-days.mjs";

const CONN = {
  id: "conn-1", org_id: "org-1", partner_id: "partner-1",
  external_ad_account_id: "act_982103620742368", connection_state: "active",
  encrypted_access_token: "enc"
};
const ADS = [
  { id: "ad-uuid-1", external_id: "120252674467320264", name: "oVid: 1" },
  { id: "ad-uuid-2", external_id: "120252674768130264", name: "oVid: 2" }
];
const AUGUST = ["2026-08-04", "2026-08-05", "2026-08-12", "2026-08-16", "2026-08-17", "2026-08-18"];

/* Meta's rows: every listed day for both ads, plus one ad we do not have. */
const META_ROWS = [
  ...AUGUST.map((d) => ({ ad_id: "120252674467320264", date_start: d, spend: "10.00", impressions: "100", clicks: "5" })),
  ...AUGUST.map((d) => ({
    ad_id: "120252674768130264", date_start: d, spend: "20.50", impressions: "200", clicks: "9",
    actions: [{ action_type: "link_click", value: "4" }]
  })),
  { ad_id: "999999999999999999", date_start: "2026-08-04", spend: "3.00" }
];

/* Our stored days: only Aug 17 and 18. */
const STORED = [
  { ad_id: "ad-uuid-1", date: "2026-08-17", spend_cents: 1000 },
  { ad_id: "ad-uuid-1", date: "2026-08-18", spend_cents: 1000 },
  { ad_id: "ad-uuid-2", date: "2026-08-17", spend_cents: 2050 },
  { ad_id: "ad-uuid-2", date: "2026-08-18", spend_cents: 2050 }
];

function fakeMeta({ fail = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    if (fail) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "Please reduce the amount of data", code: 1 } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: META_ROWS }) };
  };
  return { fetch, calls };
}

/* A fake database. Upserts land in an in-memory table keyed (ad_id, date), so
   a second run can be compared with the first. Every SQL string is kept. */
function fakeDb({ connections = [CONN], resultColumns = 4 } = {}) {
  const sqls = [];
  const table = new Map(STORED.map((d) => [`${d.ad_id}|${d.date}`, { spend_cents: d.spend_cents }]));
  const tx = {
    query: async (sql, params = []) => {
      sqls.push(sql);
      if (sql.includes("FROM ad_platform_connections")) return { rows: connections };
      if (sql.includes("pg_attribute")) return { rows: [{ n: resultColumns }] };
      if (sql.includes("SELECT id, external_id, name FROM ads")) return { rows: ADS };
      if (sql.includes("FROM ad_metrics_daily m JOIN ads a")) {
        return { rows: [...table.entries()].map(([k, v]) => {
          const [ad_id, date] = k.split("|");
          return { ad_id, date, spend_cents: v.spend_cents };
        }) };
      }
      if (sql.startsWith("INSERT INTO ad_metrics_daily")) {
        const [, , adId, day, spend] = params;
        const row = { spend_cents: spend, params };
        table.set(`${adId}|${day}`, row);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }
  };
  const scope = async (fn) => fn(tx);
  return {
    sqls, table,
    staffScope: (fn) => scope(fn),
    partnerScope: (_pid, fn) => scope(fn)
  };
}

const run = (meta, dbx, opts = {}) => runBackfill({
  fetch: meta.fetch,
  staffScope: dbx.staffScope,
  partnerScope: dbx.partnerScope,
  decrypt: () => "fake-token",
  ...opts
});

describe("arguments", () => {
  test("dry run is the default", () => {
    assert.deepEqual(parseArgs([]), { write: false, since: null, until: null, partnerId: null });
  });
  test("--write turns writing on", () => {
    assert.equal(parseArgs(["--write"]).write, true);
  });
  test("bad values are refused in plain words", () => {
    assert.throws(() => parseArgs(["--since", "Aug 4"]), /YYYY-MM-DD/);
    assert.throws(() => parseArgs(["--until", "2026-08-31"]), /needs --since/);
    assert.throws(() => parseArgs(["--since", "2026-09-01", "--until", "2026-08-01"]), /after/);
    assert.throws(() => parseArgs(["--partner", "nope"]), /uuid/);
    assert.throws(() => parseArgs(["--delete"]), /unknown option/);
  });
});

describe("days are Arizona days", () => {
  test("no --since: Meta's whole history, Meta draws the day lines", () => {
    assert.deepEqual(backfillRange({}), { datePreset: "maximum" });
  });
  test("--since with no --until ends on TODAY IN ARIZONA, not the UTC date", () => {
    // 03:00 UTC on Oct 6 is 8pm Oct 5 in Arizona.
    const r = backfillRange({ since: "2026-08-01", now: new Date("2026-10-06T03:00:00Z") });
    assert.deepEqual(r, { since: "2026-08-01", until: "2026-10-05" });
  });
});

describe("planBackfill", () => {
  const plan = planBackfill({ metaRows: META_ROWS, ourAds: ADS, ourDays: STORED });

  test("finds the missing August days per ad", () => {
    const one = plan.perAd.find((a) => a.name === "oVid: 1");
    assert.deepEqual(one.missing_days, ["2026-08-04", "2026-08-05", "2026-08-12", "2026-08-16"]);
    assert.equal(one.missing_spend_cents, 4000);
  });
  test("new days are added and stored days are refreshed", () => {
    assert.equal(plan.totals.new_days, 8);
    assert.equal(plan.totals.refreshed_days, 4);
    assert.equal(plan.totals.rows_to_write, 12);
  });
  test("an ad we do not have is reported, never written", () => {
    assert.deepEqual(plan.unknownAds, [{ meta_ad_id: "999999999999999999", days: 1, spend_cents: 300 }]);
    assert.equal(plan.writes.some((w) => w.metaAdId === "999999999999999999"), false);
  });
  test("totals: what Meta has, what we hold, what the gap adds", () => {
    assert.equal(plan.totals.meta_spend_cents, 6 * 1000 + 6 * 2050 + 300);
    assert.equal(plan.totals.stored_spend_cents, 2 * 1000 + 2 * 2050);
    assert.equal(plan.totals.missing_spend_cents, 4 * 1000 + 4 * 2050);
  });
});

describe("runBackfill against a fake Meta", () => {
  test("dry run: asks Meta with GET for the whole history and writes NOTHING", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb();
    const out = await run(meta, dbx);
    assert.equal(out.ok, true);
    assert.equal(meta.calls.length, 1);
    assert.equal(meta.calls[0].method, "GET");
    assert.ok(meta.calls[0].url.includes("/act_982103620742368/insights?"));
    assert.ok(decodeURIComponent(meta.calls[0].url).includes("date_preset=maximum"));
    assert.ok(meta.calls[0].url.includes("level=ad"));
    assert.equal(dbx.sqls.filter((s) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)/i.test(s)).length, 0);
    assert.equal(out.connections[0].written, 0);
    assert.equal(out.connections[0].totals.new_days, 8);
    const text = describeResult(out);
    assert.match(text, /DRY RUN/);
    assert.match(text, /oVid: 1: 4 missing day\(s\) 2026-08-04…2026-08-16, \$40\.00/);
    assert.match(text, /not in our ads table \(skipped\)/);
  });

  test("--write: upserts every known Meta day into ad_metrics_daily and nothing else", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb();
    const out = await run(meta, dbx, { write: true });
    assert.equal(out.ok, true);
    assert.equal(out.connections[0].written, 12);
    const writes = dbx.sqls.filter((s) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)/i.test(s));
    assert.equal(writes.length, 12);
    for (const s of writes) {
      assert.ok(s.startsWith("INSERT INTO ad_metrics_daily"), "wrote to another table");
      assert.ok(s.includes("ON CONFLICT (ad_id, date) DO UPDATE"), "not an upsert");
    }
    assert.equal(dbx.sqls.some((s) => /\bDELETE\b|\bTRUNCATE\b/i.test(s)), false);
    assert.equal(dbx.table.size, 12, "the 8 missing days were added to the 4 stored ones");
  });

  test("fields Meta did not send are written NULL, never 0", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb();
    await run(meta, dbx, { write: true });
    const noActions = dbx.table.get("ad-uuid-1|2026-08-04").params;
    assert.deepEqual(noActions.slice(18), [null, null, null, null], "purchases / cost / link clicks / page views");
    const withLinks = dbx.table.get("ad-uuid-2|2026-08-04").params;
    assert.deepEqual(withLinks.slice(18), [null, null, 4, null]);
    assert.equal(withLinks[4], 2050, "spend in cents");
  });

  test("before 408 is applied the old write is used — no new column named", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb({ resultColumns: 0 });
    await run(meta, dbx, { write: true });
    const ins = dbx.sqls.filter((s) => s.startsWith("INSERT INTO ad_metrics_daily"));
    assert.equal(ins.length, 12);
    assert.equal(ins.some((s) => s.includes("purchases")), false);
  });

  test("idempotent: a second --write leaves the table exactly as the first did", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb();
    await run(meta, dbx, { write: true });
    const first = JSON.stringify([...dbx.table.entries()].sort());
    const again = await run(meta, dbx, { write: true });
    assert.equal(again.connections[0].totals.new_days, 0, "the second run found days still missing");
    assert.equal(JSON.stringify([...dbx.table.entries()].sort()), first);
  });

  test("--since asks Meta for that range, ending on today in Arizona", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb();
    await run(meta, dbx, { since: "2026-08-01", now: new Date("2026-10-06T03:00:00Z") });
    const url = decodeURIComponent(meta.calls[0].url);
    assert.ok(url.includes('"since":"2026-08-01"') && url.includes('"until":"2026-10-05"'), url);
    assert.ok(!url.includes("date_preset"));
  });

  test("Meta refuses: that account is reported FAILED, nothing written, ok false", async () => {
    const meta = fakeMeta({ fail: true });
    const dbx = fakeDb();
    const out = await run(meta, dbx, { write: true });
    assert.equal(out.ok, false);
    assert.match(out.connections[0].error, /reduce the amount of data/);
    assert.equal(dbx.sqls.some((s) => s.startsWith("INSERT")), false);
    assert.match(describeResult(out), /FAILED/);
  });

  test("a connection the sync would refuse is skipped with its reason, and Meta is not called", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb({ connections: [{ ...CONN, external_ad_account_id: "pending:biz:1" }] });
    const out = await run(meta, dbx, { write: true });
    assert.match(out.connections[0].skipped, /no ad account number/);
    assert.equal(meta.calls.length, 0);
  });

  test("--partner limits the run to that partner", async () => {
    const meta = fakeMeta();
    const dbx = fakeDb({ connections: [CONN, { ...CONN, id: "conn-2", partner_id: "partner-2" }] });
    const out = await run(meta, dbx, { partnerId: "partner-2" });
    assert.deepEqual(out.connections.map((c) => c.connection), ["conn-2"]);
  });
});
