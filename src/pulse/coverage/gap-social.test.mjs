import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BROKEN_STATES,
  CHECK_IDS,
  STUDIO_PARTNER_SQL,
  STUDIO_POSTS_SQL,
  VIDEO_STATS_INTERVAL_MS,
  VIDEO_STATS_SQL,
  VIDEO_STATS_STALE_MS,
  WATCHED_STATES,
  YOUTUBE_ERROR_SQL,
  gapChecks
} from "./gap-social.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Code only. The header comments name the routes this file refuses to touch.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-social.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");
const ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-08T15:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function shape(row) {
  assert.deepEqual(Object.keys(row), ["id", "status", "detail", "suggestedFix"]);
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not call YouTube/);
    assert.match(row.suggestedFix, /Do not refresh OAuth/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

/** A tx that answers by exact SQL text. An unknown SQL throws, so a changed query cannot slip through. */
function txFrom(map, seen = []) {
  return {
    async query(sql, params) {
      const key = String(sql);
      seen.push({ sql: key, params });
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        throw new Error(`unexpected sql: ${key.slice(0, 80)}`);
      }
      const answer = map[key];
      return typeof answer === "function" ? answer(params) : answer;
    }
  };
}

function scopeFrom(map, seen = []) {
  return (fn) => fn(txFrom(map, seen));
}

function readers({ channels, settings } = {}) {
  return {
    fetchChannelRows: channels || (async () => [{ id: "c1" }]),
    readSettings: settings || (async () => ({ stored: true }))
  };
}

function quietMap(over = {}) {
  return {
    [YOUTUBE_ERROR_SQL]: { rows: [{ n: 0, errors: null }] },
    [VIDEO_STATS_SQL]: {
      rows: [{
        watched: 1,
        last_synced_at: new Date(NOW.getTime() - HOUR).toISOString(),
        connected_at: new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString()
      }]
    },
    [STUDIO_POSTS_SQL]: { rows: [{ id: "p1" }] },
    [STUDIO_PARTNER_SQL]: { rows: [{ id: PARTNER }] },
    ...over
  };
}

function ctxOf(map, extra = {}) {
  return { scope: scopeFrom(map), orgId: ORG, now: NOW, socialReaders: readers(), ...extra };
}

test("gap social: source stays read-only and never talks to YouTube or the plain handle's transactions", () => {
  assert.equal(VIDEO_STATS_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(VIDEO_STATS_STALE_MS, 3 * VIDEO_STATS_INTERVAL_MS);
  assert.deepEqual([...WATCHED_STATES], ["active"]);
  assert.deepEqual([...BROKEN_STATES], ["error", "expired"]);
  assert.deepEqual([...CHECK_IDS], [
    "social:youtube-last-error",
    "social:video-stats-stale",
    "social:studio-read"
  ]);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  assert.doesNotMatch(SRC, /refreshAccessToken|googleapis|youtube\.com|youtube-sync|youtube-connect/i);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
});

test("gap social: no database and no scope skips every row", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap social: a clean connection and a clean Social Studio read are PASS, PASS, PASS", async () => {
  const seen = [];
  const rows = await gapChecks({
    scope: scopeFrom(quietMap(), seen),
    orgId: ORG,
    now: NOW,
    socialReaders: readers()
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  const err = seen.find((c) => c.sql === YOUTUBE_ERROR_SQL);
  assert.equal(err.params[0], ORG);
  assert.deepEqual(err.params[1], [...BROKEN_STATES]);
  const stats = seen.find((c) => c.sql === VIDEO_STATS_SQL);
  assert.equal(stats.params[0], ORG);
  assert.deepEqual(stats.params[1], [...WATCHED_STATES]);
});

test("gap social: the staff scope is used, and the plain handle is never touched when a scope is passed", async () => {
  let plainCalls = 0;
  const db = { async query() { plainCalls += 1; return { rows: [] }; } };
  const rows = await gapChecks({ ...ctxOf(quietMap()), db });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.equal(plainCalls, 0);
});

test("gap social: with no scope the plain handle is the fallback", async () => {
  const seen = [];
  const tx = txFrom(quietMap(), seen);
  const rows = await gapChecks({ db: tx, orgId: ORG, now: NOW, socialReaders: readers() });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.deepEqual(
    seen.map((c) => c.sql).filter((sql) => sql === YOUTUBE_ERROR_SQL || sql === VIDEO_STATS_SQL),
    [YOUTUBE_ERROR_SQL, VIDEO_STATS_SQL]
  );
});

test("gap social: no org id still reads (the SQL takes a null org)", async () => {
  const seen = [];
  const rows = await gapChecks({
    scope: scopeFrom(quietMap(), seen),
    now: NOW,
    socialReaders: readers()
  });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.equal(seen.find((c) => c.sql === YOUTUBE_ERROR_SQL).params[0], null);
  assert.match(YOUTUBE_ERROR_SQL, /\$1::uuid IS NULL OR org_id = \$1::uuid/);
});

test("gap social: YouTube last_error set is FAIL and the other rows stay PASS", async () => {
  const rows = await gapChecks(ctxOf(quietMap({
    [YOUTUBE_ERROR_SQL]: { rows: [{ n: 1, errors: "invalid_grant" }] }
  })));
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /broken: invalid_grant/);
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "PASS");
});

test("gap social: the error SQL counts a connection in error or expired even with no last_error text", () => {
  assert.match(YOUTUBE_ERROR_SQL, /connection_state = ANY\(\$2::text\[\]\)/);
  assert.match(YOUTUBE_ERROR_SQL, /last_error IS NOT NULL AND btrim\(last_error\) <> ''/);
  assert.match(YOUTUBE_ERROR_SQL, /platform = 'youtube'/);
});

test("gap social: a sync older than 3 days is FAIL and an exact boundary is PASS", async () => {
  const dueBy = NOW.getTime() - VIDEO_STATS_STALE_MS;
  const withSync = (ms) => quietMap({
    [VIDEO_STATS_SQL]: {
      rows: [{ watched: 1, last_synced_at: new Date(ms).toISOString(), connected_at: new Date(dueBy - 99 * HOUR).toISOString() }]
    }
  });
  const stale = await gapChecks(ctxOf(withSync(dueBy - 1)));
  stale.forEach(shape);
  assert.equal(stale[1].status, "FAIL");
  assert.match(stale[1].detail, /past the daily snapshot/);
  assert.match(stale[1].suggestedFix, /Sync now/);
  assert.equal(stale[0].status, "PASS");
  assert.equal(stale[2].status, "PASS");

  const edge = await gapChecks(ctxOf(withSync(dueBy)));
  assert.equal(edge[1].status, "PASS");
});

test("gap social: a connection that never synced is judged from the day it was connected", async () => {
  const never = (connectedMsAgo) => quietMap({
    [VIDEO_STATS_SQL]: {
      rows: [{
        watched: 1,
        last_synced_at: null,
        connected_at: new Date(NOW.getTime() - connectedMsAgo).toISOString()
      }]
    }
  });
  const old = await gapChecks(ctxOf(never(10 * 24 * HOUR)));
  assert.equal(old[1].status, "FAIL");
  assert.match(old[1].detail, /never run since it was connected/);

  const fresh = await gapChecks(ctxOf(never(2 * HOUR)));
  assert.equal(fresh[1].status, "PASS");
  assert.match(fresh[1].detail, /has not run yet/);
});

test("gap social: no active YouTube connection skips the stale check", async () => {
  const rows = await gapChecks(ctxOf(quietMap({
    [VIDEO_STATS_SQL]: { rows: [{ watched: 0, last_synced_at: null, connected_at: null }] }
  })));
  rows.forEach(shape);
  assert.equal(rows[1].status, "skip");
  assert.match(rows[1].detail, /no active YouTube connection/);
});

test("gap social: a Social Studio read that throws is FAIL and names the read", async () => {
  const posts = await gapChecks(ctxOf({
    ...quietMap(),
    [STUDIO_POSTS_SQL]: () => { throw new Error('column "blocked_reasons" does not exist'); }
  }));
  posts.forEach(shape);
  assert.equal(posts[2].status, "FAIL");
  assert.match(posts[2].detail, /would answer 500/);
  assert.match(posts[2].detail, /posts: .*blocked_reasons/);
  assert.equal(posts[0].status, "PASS");
  assert.equal(posts[1].status, "PASS");

  const channels = await gapChecks(ctxOf(quietMap(), {
    socialReaders: readers({ channels: async () => { throw new Error("relation social_channels does not exist"); } })
  }));
  assert.equal(channels[2].status, "FAIL");
  assert.match(channels[2].detail, /channels: .*social_channels/);

  const settings = await gapChecks(ctxOf(quietMap(), {
    socialReaders: readers({ settings: async () => { throw new Error("column autopilot_enabled does not exist"); } })
  }));
  assert.equal(settings[2].status, "FAIL");
  assert.match(settings[2].detail, /settings: .*autopilot_enabled/);
});

test("gap social: the settings read is given the partner and org the screen would give it", async () => {
  let args;
  const rows = await gapChecks(ctxOf(quietMap(), {
    socialReaders: readers({ settings: async (_tx, partnerId, orgId) => { args = { partnerId, orgId }; return {}; } })
  }));
  assert.equal(rows[2].status, "PASS");
  assert.deepEqual(args, { partnerId: PARTNER, orgId: ORG });
});

test("gap social: channels are read through the real exported fetchRows shape (limit, offset, query)", async () => {
  let got;
  await gapChecks(ctxOf(quietMap(), {
    socialReaders: readers({ channels: async (_tx, opts) => { got = opts; return []; } })
  }));
  assert.deepEqual(got, { limit: 1, offset: 0, query: {} });
});

test("gap social: the repo still exports the two readers this check runs", async () => {
  const channels = await import("../../../api/social/channels.mjs");
  const settings = await import("../../../api/social/settings.mjs");
  assert.equal(typeof channels.fetchRows, "function");
  assert.equal(typeof settings.readSettings, "function");
});

test("gap social: the real readers load when none are passed, and a missing partner is not a failure", async () => {
  const seen = [];
  const map = quietMap({ [STUDIO_PARTNER_SQL]: { rows: [] } });
  const tx = {
    async query(sql, params) {
      const key = String(sql);
      seen.push(key);
      if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
      // The real fetchRows SQL for channels.
      if (/FROM social_channels/.test(key)) return { rows: [] };
      throw new Error(`unexpected sql: ${key.slice(0, 80)}`);
    }
  };
  const rows = await gapChecks({ scope: (fn) => fn(tx), orgId: ORG, now: NOW });
  rows.forEach(shape);
  assert.equal(rows[2].status, "PASS");
  assert.ok(seen.some((s) => /FROM social_channels/.test(s)));
});

test("gap social: a read error on the YouTube tables is FAIL, not a throw and not a PASS", async () => {
  const rows = await gapChecks(ctxOf({
    ...quietMap(),
    [YOUTUBE_ERROR_SQL]: () => { throw new Error("relation analytics_connections does not exist"); },
    [VIDEO_STATS_SQL]: () => { throw new Error("relation analytics_connections does not exist"); }
  }));
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[0].detail, /analytics_connections/);
  assert.equal(rows[2].status, "PASS");
});

test("gap social: a plain-role handle that sees zero rows cannot pass a broken connection when the scope is passed", async () => {
  // The plain role is blind to staff-only tables. If the check read ctx.db it would answer PASS here.
  const blind = { async query() { return { rows: [{ n: 0, errors: null, watched: 0 }] }; } };
  const rows = await gapChecks({
    db: blind,
    scope: scopeFrom(quietMap({ [YOUTUBE_ERROR_SQL]: { rows: [{ n: 1, errors: "state expired" }] } })),
    orgId: ORG,
    now: NOW,
    socialReaders: readers()
  });
  assert.equal(rows[0].status, "FAIL");
});
