// Marketing-machine rows of the daily pulse. Fakes only: no database, no Meta,
// no ClickFunnels, no text. The states below are the ones measured on live
// 2026-10-05 / 2026-10-06 UTC unless a test says otherwise.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAPI_SQL,
  CF_NIGHT_SQL,
  DYING_SCAN_SQL,
  MACHINE_CHECKS,
  MEET_SYNC_SQL,
  META_SYNC_SQL,
  RUNNING_ADS_SQL,
  checkClickfunnelsNightJob,
  checkDyingAdScan,
  checkMachine,
  checkMeetTranscripts,
  checkMetaServerEvents,
  checkMetaSync,
  dailyCronMinuteUtc,
  inNightSlot
} from "./machine.mjs";
import { runDailyPulse } from "./daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const NOW = new Date("2026-10-06T13:00:00Z"); // tomorrow's 7:00 a.m. Denver pulse

/** A staff scope over canned answers keyed by the exact SQL constant. */
function scopeFor(answers, seen = []) {
  const tx = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (!(sql in answers)) throw new Error(`unexpected query: ${String(sql).slice(0, 60)}`);
      const a = answers[sql];
      return { rows: Array.isArray(a) ? a : [a] };
    }
  };
  return async (fn) => fn(tx);
}

const META_OK = {
  last_saved: new Date("2026-10-06T07:01:51Z"),
  last_day: "2026-10-05",
  connections: 1,
  errors: null
};

// ── the registry ─────────────────────────────────────────────────────────────

test("machine registry: every row names a real file and a unique id", () => {
  const ids = new Set();
  for (const row of MACHINE_CHECKS) {
    assert.ok(fs.existsSync(path.join(ROOT, row.file)), `${row.id} watches ${row.file}, which is gone`);
    assert.equal(typeof row.run, "function");
    assert.ok(!ids.has(row.id), `duplicate id ${row.id}`);
    ids.add(row.id);
  }
  assert.deepEqual([...ids], ["meta-sync", "clickfunnels-night-job", "meta-server-events", "dying-ad-scan", "meet-transcript-sweeper"]);
});

test("machine registry: every query is a read — no write, no SET", () => {
  for (const sql of [META_SYNC_SQL, CF_NIGHT_SQL, CAPI_SQL, DYING_SCAN_SQL, RUNNING_ADS_SQL, MEET_SYNC_SQL]) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|SET)\b/i);
  }
});

test("no database in the run: every machine row is a skip, nothing is read", async () => {
  const rows = await checkMachine({ db: null, scope: null, now: NOW });
  assert.equal(rows.length, MACHINE_CHECKS.length);
  assert.ok(rows.every((r) => r.status === "skip" && r.kind === "machine"));
});

test("one broken row is its own FAIL and the other rows still run", async () => {
  const scope = scopeFor({ [META_SYNC_SQL]: META_OK });
  const rows = await checkMachine({ scope, now: NOW, checks: MACHINE_CHECKS.slice(0, 2) });
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].id, "clickfunnels-night-job");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /could not read/);
});

// ── (a) Meta daily ad sync ───────────────────────────────────────────────────

test("meta-sync: saved 6 h ago is PASS and names the newest day", async () => {
  const r = await checkMetaSync({ scope: scopeFor({ [META_SYNC_SQL]: META_OK }), now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2026-10-06 07:01 UTC/);
  assert.match(r.detail, /newest day 2026-10-05/);
});

test("meta-sync: nothing saved for 40 h is FAIL", async () => {
  const r = await checkMetaSync({
    scope: scopeFor({ [META_SYNC_SQL]: { ...META_OK, last_saved: new Date("2026-10-04T21:00:00Z") } }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /40 h ago/);
  assert.match(r.suggestedFix, /Do not auto-fix/);
});

test("meta-sync: a Meta error on the connection is FAIL even when numbers are fresh", async () => {
  const r = await checkMetaSync({
    scope: scopeFor({ [META_SYNC_SQL]: { ...META_OK, errors: "Error validating access token" } }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /access token/);
});

test("meta-sync: no Meta connection is FAIL, not a silent pass", async () => {
  const r = await checkMetaSync({
    scope: scopeFor({ [META_SYNC_SQL]: { last_saved: null, last_day: null, connections: 0, errors: null } }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no Meta ad account/);
});

// ── (b) ClickFunnels night job ───────────────────────────────────────────────

test("cron helpers read the 07:15 UTC night job and its slot", () => {
  assert.equal(dailyCronMinuteUtc("15 7 * * *"), 7 * 60 + 15);
  assert.equal(dailyCronMinuteUtc("TZ=America/Denver 0 7 * * *"), null);
  assert.equal(inNightSlot(new Date("2026-10-05T07:16:00Z"), 435), true);
  assert.equal(inNightSlot(new Date("2026-10-04T22:10:00Z"), 435), false);
});

test("clickfunnels-night-job: the live state today — only a hand-run sync — is FAIL", async () => {
  // Measured: funnel_page_stats writes ever = 2026-09-22 09:20 and 2026-10-04 22:10 UTC.
  const r = await checkClickfunnelsNightJob({
    scope: scopeFor({
      [CF_NIGHT_SQL]: {
        active: 1,
        errors: null,
        last_saved: new Date("2026-10-04T22:10:00Z"),
        last_day: "2026-10-04",
        recent: [new Date("2026-10-04T22:10:00Z")]
      }
    }),
    now: new Date("2026-10-06T00:46:00Z"), // 26.6 h after that write — fresh, but not the night job
    cron: "15 7 * * *"
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /07:15 UTC/);
  assert.match(r.detail, /hand-run sync/);
  assert.match(r.suggestedFix, /clickfunnels-analytics-sweeper/);
});

test("clickfunnels-night-job: a write in the 07:15 slot inside 36 h is PASS", async () => {
  const seen = [];
  const r = await checkClickfunnelsNightJob({
    scope: scopeFor({
      [CF_NIGHT_SQL]: {
        active: 1,
        errors: null,
        last_saved: new Date("2026-10-06T07:15:40Z"),
        last_day: "2026-10-05",
        recent: ["2026-10-06T07:15:00Z"]
      }
    }, seen),
    now: NOW,
    cron: "15 7 * * *"
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2026-10-06 07:15 UTC/);
  // The window handed to SQL is exactly 36 h back from the pulse.
  assert.equal(seen[0].params[0].toISOString(), "2026-10-05T01:00:00.000Z");
});

test("clickfunnels-night-job: no active connection is FAIL", async () => {
  const r = await checkClickfunnelsNightJob({
    scope: scopeFor({ [CF_NIGHT_SQL]: { active: 0, errors: null, last_saved: null, last_day: null, recent: null } }),
    now: NOW,
    cron: "15 7 * * *"
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no active ClickFunnels connection/);
});

// ── (c) Meta server events ───────────────────────────────────────────────────

const CAPI_OK = {
  eligible: 26, answered: 26, sent_ok: 26, errors: 0, skipped: 0,
  last_ok: new Date("2026-10-05T19:34:08Z"), last_error: null
};

test("meta-server-events: the live state today — 26 of 26 accepted — is PASS", async () => {
  const r = await checkMetaServerEvents({ scope: scopeFor({ [CAPI_SQL]: CAPI_OK }), now: NOW });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /Meta accepted 26 of 26/);
});

test("meta-server-events: real visitors but no Meta reply saved is FAIL", async () => {
  const r = await checkMetaServerEvents({
    scope: scopeFor({ [CAPI_SQL]: { ...CAPI_OK, answered: 0, sent_ok: 0, last_ok: null } }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /26 never got a reply saved/);
  assert.match(r.suggestedFix, /META_CAPI_ENABLED/);
});

test("meta-server-events: more Meta errors than accepted events is FAIL", async () => {
  const r = await checkMetaServerEvents({
    scope: scopeFor({ [CAPI_SQL]: { ...CAPI_OK, sent_ok: 3, errors: 23, last_error: "Invalid parameter" } }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /23 came back as errors \(last: Invalid parameter\)/);
});

test("meta-server-events: no real visitors in 24 h is a skip, not a false alarm", async () => {
  const r = await checkMetaServerEvents({
    scope: scopeFor({ [CAPI_SQL]: { eligible: 0, answered: 0, sent_ok: 0, errors: 0, skipped: 0 } }),
    now: NOW
  });
  assert.equal(r.status, "skip");
});

// ── (d) Dying-ad scan ────────────────────────────────────────────────────────

const SCAN_HEAD = { last_sync: new Date("2026-10-06T07:01:51Z"), buzzes_ever: 0 };
const DYING = { id: "ad-2", name: "oVid: SLO2", metric_day: "2026-10-05", video_plays: 295, video_p25_watched: 35, clicks: 26 };

test("dying-ad-scan: a running ad dying before 25% with no buzz is FAIL", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({ [DYING_SCAN_SQL]: SCAN_HEAD, [RUNNING_ADS_SQL]: [{ ...DYING, alerted_on: null }] }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 running ad die before 25% with no buzz/);
  assert.match(r.detail, /oVid: SLO2/);
  assert.match(r.suggestedFix, /notify-fanout/);
});

test("dying-ad-scan: a buzz dated on the sync day clears it", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({ [DYING_SCAN_SQL]: { ...SCAN_HEAD, buzzes_ever: 1 }, [RUNNING_ADS_SQL]: [{ ...DYING, alerted_on: "2026-10-06" }] }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 running ad with video numbers, 1 dying, none missed/);
});

test("dying-ad-scan: yesterday's buzz does not count for today's sync", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({ [DYING_SCAN_SQL]: SCAN_HEAD, [RUNNING_ADS_SQL]: [{ ...DYING, alerted_on: "2026-10-05" }] }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
});

test("dying-ad-scan: people leaving early but tapping through is a hop, not a miss", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({
      [DYING_SCAN_SQL]: SCAN_HEAD,
      [RUNNING_ADS_SQL]: [{ id: "ad-4", name: "oVid: SLO4", video_plays: 25, video_p25_watched: 1, clicks: 5, alerted_on: null }]
    }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /0 dying/);
});

test("dying-ad-scan: the live state today — every ad paused — is PASS with nothing to buzz", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({ [DYING_SCAN_SQL]: SCAN_HEAD, [RUNNING_ADS_SQL]: [] }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /no running ad with video numbers/);
});

test("meet-transcript-sweeper: fresh Drive scan and no stuck files is PASS", async () => {
  const r = await checkMeetTranscripts({
    scope: scopeFor({
      [MEET_SYNC_SQL]: {
        last_sync_at: new Date("2026-10-06T12:45:00Z"),
        sync_rows: 1,
        errors: null,
        pending_old: 0,
        words_on_file: 4
      }
    }),
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /4 sales calls have spoken words/);
});

test("meet-transcript-sweeper: never scanned is FAIL", async () => {
  const r = await checkMeetTranscripts({
    scope: scopeFor({
      [MEET_SYNC_SQL]: {
        last_sync_at: null,
        sync_rows: 0,
        errors: null,
        pending_old: 0,
        words_on_file: 0
      }
    }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /never been scanned/);
});

test("dying-ad-scan: no Meta sync in 36 h means the scan has not run — FAIL", async () => {
  const r = await checkDyingAdScan({
    scope: scopeFor({ [DYING_SCAN_SQL]: { last_sync: new Date("2026-10-04T07:00:00Z"), buzzes_ever: 0 }, [RUNNING_ADS_SQL]: [] }),
    now: NOW
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /has not run since/);
});

// ── wired into the 7:00 a.m. pulse ───────────────────────────────────────────

test("the pulse runs the machine rows through the staff scope, lists FAILs, and still sends nothing", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-machine-"));
  const sends = [];
  const scopeCalls = [];
  const inner = scopeFor({
    [META_SYNC_SQL]: META_OK,
    [CF_NIGHT_SQL]: { active: 1, errors: null, last_saved: new Date("2026-10-04T22:10:00Z"), last_day: "2026-10-04", recent: [] },
    [CAPI_SQL]: CAPI_OK,
    [DYING_SCAN_SQL]: SCAN_HEAD,
    [RUNNING_ADS_SQL]: [],
    [MEET_SYNC_SQL]: {
      last_sync_at: new Date("2026-10-06T12:45:00Z"),
      sync_rows: 1,
      errors: null,
      pending_old: 0,
      words_on_file: 4
    }
  });
  const staffScope = (fn) => { scopeCalls.push(1); return inner(fn); };
  // The plain db answers only the rows that already used it; a machine query
  // landing here would mean the staff scope was bypassed.
  const db = {
    async query(sql) {
      if (/FROM orgs/i.test(sql)) return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
      if (/FROM agents/i.test(sql)) return { rows: [{ code: "AG-07", status: "live", runtime: "inngest", runtime_ref: "daily-pulse" }] };
      if (/ad_metrics_daily|funnel_page_stats|meta_event_id/.test(sql)) throw new Error("machine row bypassed the staff scope");
      return { rows: [] };
    }
  };
  const result = await runDailyPulse({
    dryRun: true,
    now: NOW,
    db,
    staffScope,
    fetchImpl: async (url) => {
      const p = String(url).replace(/^https?:\/\/[^/]+/, "");
      if (p === "/login.html") return { status: 200, text: async () => "Sign in password" };
      if (p === "/app/client-control-panel.html") {
        return { status: 200, text: async () => "Generate Apps Apply door Apply shows the client email, not a Fundhub address" };
      }
      if (p.startsWith("/api/")) return { status: 200, text: async () => "{}" };
      return { status: 200, text: async () => "<html>" };
    },
    boardDir: tmp,
    env: { PULSE_SMS_TO: "+15555550100" },
    sendSms: async (m) => { sends.push(m); return { status: "sent" }; },
    sendWhatsApp: async (m) => { sends.push(m); return { status: "sent" }; },
    recordRun: false
  });
  const machine = result.checks.filter((c) => c.kind === "machine");
  assert.deepEqual(machine.map((c) => [c.id, c.status]), [
    ["meta-sync", "PASS"],
    ["clickfunnels-night-job", "FAIL"],
    ["meta-server-events", "PASS"],
    ["dying-ad-scan", "PASS"],
    ["meet-transcript-sweeper", "PASS"]
  ]);
  assert.ok(scopeCalls.length >= 5);
  assert.ok(result.findings.some((f) => /^clickfunnels-night-job: /.test(f)));
  assert.match(result.sms.body, /failed/);
  assert.equal(result.sms.reason, "dry_run");
  assert.equal(sends.length, 0);
  const board = fs.readFileSync(result.wrote, "utf8");
  assert.match(board, /\| clickfunnels-night-job \| FAIL \|/);
  assert.match(board, /\| meta-sync \| PASS \|/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
