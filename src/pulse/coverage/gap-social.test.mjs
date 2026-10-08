import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  SOCIAL_STUDIO_GETS,
  VIDEO_STATS_INTERVAL_MS,
  VIDEO_STATS_SQL,
  VIDEO_STATS_STALE_MS,
  WATCHED_STATES,
  YOUTUBE_ERROR_SQL,
  gapChecks
} from "./gap-social.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-social.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

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

function dbFrom(map) {
  return {
    async query(sql, params) {
      const key = String(sql);
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        throw new Error(`unexpected sql: ${key.slice(0, 80)}`);
      }
      const answer = map[key];
      return typeof answer === "function" ? answer(params) : answer;
    }
  };
}

function quietDb(lastSyncedAt = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()) {
  return dbFrom({
    [YOUTUBE_ERROR_SQL]: { rows: [{ n: 0, errors: null }] },
    [VIDEO_STATS_SQL]: { rows: [{ watched: 1, last_synced_at: lastSyncedAt }] }
  });
}

function liveFetch(calls) {
  return async function fetchImpl(url, opts) {
    calls.push({ url: String(url), method: opts && opts.method });
    return { status: 401 };
  };
}

test("gap social: source stays read-only and does not call YouTube", () => {
  assert.equal(VIDEO_STATS_INTERVAL_MS, 24 * 60 * 60 * 1000);
  assert.equal(VIDEO_STATS_STALE_MS, 3 * VIDEO_STATS_INTERVAL_MS);
  assert.deepEqual([...WATCHED_STATES], ["active", "error", "expired"]);
  assert.deepEqual([...CHECK_IDS], [
    "social:youtube-last-error",
    "social:video-stats-stale",
    "social:studio-read"
  ]);
  assert.deepEqual([...SOCIAL_STUDIO_GETS], [
    "/api/social/posts",
    "/api/social/channels",
    "/api/social/settings"
  ]);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /refreshAccessToken|googleapis|youtube\.com|youtube-sync|youtube-connect/i);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
});

test("gap social: no database and no fetch skips every row", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap social: a clean connection and a live read are three PASS rows", async () => {
  const calls = [];
  let statsParams;
  const db = dbFrom({
    [YOUTUBE_ERROR_SQL]: (params) => {
      assert.equal(params[0], ORG);
      return { rows: [{ n: 0, errors: null }] };
    },
    [VIDEO_STATS_SQL]: (params) => {
      statsParams = params;
      return { rows: [{ watched: 1, last_synced_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() }] };
    }
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch(calls),
    baseUrl: "http://pulse.test/"
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.equal(statsParams[0], ORG);
  assert.deepEqual(statsParams[1], [...WATCHED_STATES]);
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "GET"]);
  assert.deepEqual(
    calls.map((c) => c.url),
    SOCIAL_STUDIO_GETS.map((p) => `http://pulse.test${p}`)
  );
  for (const call of calls) {
    assert.doesNotMatch(call.url, /youtube|googleapis|oauth/i);
  }
});

test("gap social: YouTube last_error set is FAIL and the other rows stay PASS", async () => {
  const db = dbFrom({
    [YOUTUBE_ERROR_SQL]: { rows: [{ n: 1, errors: "invalid_grant" }] },
    [VIDEO_STATS_SQL]: { rows: [{ watched: 1, last_synced_at: NOW.toISOString() }] }
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  rows.forEach(shape);
  const hit = rows[0];
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /last_error is set: invalid_grant/);
  assert.ok(rows.slice(1).every((r) => r.status === "PASS"));
});

test("gap social: a sync older than 3 days is FAIL and an exact boundary is PASS", async () => {
  const dueBy = NOW.getTime() - VIDEO_STATS_STALE_MS;
  const staleDb = quietDb(new Date(dueBy - 1).toISOString());
  const stale = await gapChecks({
    db: staleDb,
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  stale.forEach(shape);
  assert.equal(stale[1].status, "FAIL");
  assert.match(stale[1].detail, /past the daily schedule/);
  assert.equal(stale[0].status, "PASS");
  assert.equal(stale[2].status, "PASS");

  const edge = await gapChecks({
    db: quietDb(new Date(dueBy).toISOString()),
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  assert.equal(edge[1].status, "PASS");

  const never = await gapChecks({
    db: dbFrom({
      [YOUTUBE_ERROR_SQL]: { rows: [{ n: 0, errors: null }] },
      [VIDEO_STATS_SQL]: { rows: [{ watched: 1, last_synced_at: null }] }
    }),
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  assert.equal(never[1].status, "FAIL");
  assert.match(never[1].detail, /has never run/);
});

test("gap social: no watched YouTube connection skips the stale check", async () => {
  const rows = await gapChecks({
    db: dbFrom({
      [YOUTUBE_ERROR_SQL]: { rows: [{ n: 0, errors: null }] },
      [VIDEO_STATS_SQL]: { rows: [{ watched: 0, last_synced_at: null }] }
    }),
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  rows.forEach(shape);
  assert.equal(rows[1].status, "skip");
  assert.match(rows[1].detail, /not on a schedule/);
});

test("gap social: Social Studio read API 500 fails and never calls YouTube", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts && opts.method });
    if (String(url).endsWith("/api/social/posts")) return { status: 500 };
    return { status: 401 };
  };
  const rows = await gapChecks({
    db: quietDb(),
    orgId: ORG,
    now: NOW,
    fetchImpl,
    baseUrl: "http://pulse.test"
  });
  rows.forEach(shape);
  const hit = rows[2];
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /social studio read API 500/);
  assert.match(hit.detail, /\/api\/social\/posts 500/);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.equal(calls.some((c) => /youtube|googleapis|oauth|youtube-sync|youtube-connect/i.test(c.url)), false);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
});

test("gap social: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation analytics_connections does not exist");
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    fetchImpl: liveFetch([]),
    baseUrl: "http://pulse.test"
  });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[0].detail, /analytics_connections/);
  assert.equal(rows[2].status, "PASS");
});
