import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PULSE_CRON,
  PULSE_TZ,
  checkGateRelay,
  checkUnrecorded,
  formatScorecard,
  recordAgentRun,
  runDailyPulse,
  writeScorecard
} from "./daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeFetch(routes) {
  return async (url) => {
    const pathOnly = String(url).replace(/^https?:\/\/[^/]+/, "");
    const hit = routes[pathOnly] || routes[url];
    if (hit) {
      return {
        status: hit.status,
        text: async () => hit.text || ""
      };
    }
    if (pathOnly.startsWith("/api/")) return { status: 401, text: async () => "auth" };
    if (pathOnly.endsWith(".html")) return { status: 200, text: async () => "<html>" };
    return { status: 404, text: async () => "missing" };
  };
}

const LIVE_PAGES = {
  "/api/health?strict=1": { status: 200, text: '{"ok":true}' },
  "/login.html": { status: 200, text: "<form>Sign in <input type=password></form>" },
  "/app/client-control-panel.html": {
    status: 200,
    text: "Funding · Apply Generate Apps Apply door Apply shows the client email, not a Fundhub address"
  },
  "/api/read/underwrite": { status: 401, text: '{"error":"unauthorized"}' }
};

/* A TZ= cron fires on that zone's own clock. Arizona does not change clocks. */
function zoneTimeWhenCronFires(cron, zone) {
  const tz = /^TZ=(\S+)\s+/.exec(cron);
  assert.equal(tz && tz[1], zone);
  const [minute, hour] = cron.replace(/^TZ=\S+\s+/, "").trim().split(/\s+/).map(Number);
  return { hour, minute };
}

test("cron fires at 6:00 a.m. Arizona all year", () => {
  assert.equal(PULSE_TZ, "America/Phoenix");
  for (const day of ["2026-07-01", "2026-10-05", "2026-11-02", "2027-01-15", "2027-03-15"]) {
    assert.deepEqual(
      zoneTimeWhenCronFires(PULSE_CRON, "America/Phoenix"),
      { hour: 6, minute: 0 },
      `${PULSE_CRON} on ${day}`
    );
  }
});

test("dry-run writes a board and does not send or fix", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const sends = [];
  const result = await runDailyPulse({
    dryRun: true,
    now: new Date("2026-08-25T13:00:00Z"),
    fetchImpl: fakeFetch(LIVE_PAGES),
    boardDir: tmp,
    env: {},
    gateRelayDirs: null,
    sendSms: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    sendWhatsApp: async (msg) => {
      sends.push(msg);
      return { status: "sent" };
    },
    recordRun: false
  });
  assert.equal(result.autoFix, false);
  assert.equal(result.dryRun, true);
  assert.equal(typeof result.wrote, "string");
  assert.ok(fs.existsSync(result.wrote));
  const body = fs.readFileSync(result.wrote, "utf8");
  assert.match(body, /This run does not auto-fix/);
  assert.match(body, /health/);
  assert.match(body, /Uptime/);
  assert.match(body, /\/app\/pipeline\.html/);
  assert.equal(sends.length, 0);
  assert.equal(result.sms.sent, false);
  const coverage = result.checks.filter((c) => c.kind === "coverage");
  const sliceRows = coverage.filter((c) => !String(c.sliceId || "").startsWith("gap-"));
  const gapRows = coverage.filter((c) => String(c.sliceId || "").startsWith("gap-"));
  assert.ok(sliceRows.length > 0);
  /* A slice claim never passes on its own say-so. It is folded into the real check that ran, or it stays a
     live "not checked" / skip that the audit counts. */
  assert.ok(sliceRows.every((c) => ["not checked", "skip", "na", "PASS", "FAIL"].includes(c.status)));
  assert.ok(sliceRows.every((c) => c.status !== "PASS" || c.proof || c.detail), "a PASS carries its proof");
  assert.ok(result.folded > 0, "the slice claims that point at a real check were folded into it");
  assert.ok(result.checks.some((c) => c.id === "audit:not-checked"), "the pulse audits itself");
  assert.ok(gapRows.length > 0);
  assert.match(body, /## Coverage/);
  assert.match(body, /not checked/);
  assert.match(result.sms.reason, /PULSE_SMS_TO unset/);
  assert.match(result.darwin.reason, /DARWIN_WHATSAPP unset/);
  assert.ok(result.checks.every((c) => c.id !== "fix"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("a FAIL writes a suggested fix and still does not auto-fix", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const result = await runDailyPulse({
    dryRun: true,
    now: new Date("2026-08-25T13:00:00Z"),
    fetchImpl: fakeFetch({
      ...LIVE_PAGES,
      "/api/health?strict=1": { status: 503, text: '{"ok":false}' }
    }),
    boardDir: tmp,
    env: {},
    gateRelayDirs: null,
    recordRun: false
  });
  assert.equal(result.autoFix, false);
  assert.ok(result.findings.some((f) => /health/.test(f)));
  assert.ok(result.suggestedFixes.some((f) => /health/.test(f)));
  assert.match(fs.readFileSync(result.wrote, "utf8"), /FAIL/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* Measured on live: agent_runs for AG-07 said outcome=pass on 2026-09-27..10-05
   while the same row's detail named a route answering 404. A registry row says
   "down", not "FAIL", and the outcome only counted "FAIL". */
test("a down registry row records the run as fail, not pass", async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await recordAgentRun(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    dryRun: false,
    checks: [
      { id: "health", status: "PASS" },
      { id: "reg:pipeline", kind: "registry", status: "down" }
    ],
    detail: "reg:pipeline: /app/pipeline.html answered 503"
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO agent_runs/);
  assert.equal(calls[0].params[3], "fail");
});

test("an all-up run still records pass", async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await recordAgentRun(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    dryRun: false,
    checks: [
      { id: "health", status: "PASS" },
      { id: "gate-relay", status: "skip" },
      { id: "reg:pipeline", kind: "registry", status: "up" }
    ],
    detail: "all PASS"
  });
  assert.equal(calls[0].params[3], "pass");
});

test("gate-relay FAIL names the existing start command — not a new watchdog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-"));
  const dirs = {
    root: tmp,
    gates: path.join(tmp, "gates"),
    decisions: path.join(tmp, "decisions"),
    outbox: path.join(tmp, "outbox")
  };
  const row = checkGateRelay({ dirs, nowMs: Date.now() });
  assert.equal(row.status, "FAIL");
  assert.match(row.suggestedFix, /scripts\/gate-relay\/index\.mjs watch/);
  assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("scorecard writer is a file write, not a product fix", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-"));
  const md = formatScorecard({
    date: "2026-08-25",
    dryRun: true,
    checks: [{ id: "health", status: "PASS", detail: "ok" }],
    sms: { sent: false, reason: "dry_run" },
    darwin: { sent: false, reason: "DARWIN_WHATSAPP unset", ticket: "ticket" }
  });
  const file = writeScorecard(tmp, "2026-08-25", md);
  assert.equal(path.basename(file), "pulse-2026-08-25.md");
  assert.match(fs.readFileSync(file, "utf8"), /does not auto-fix/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("morning pulse includes an unrecorded count without sending a per-miss text", async () => {
  const now = new Date("2026-08-26T18:00:00Z");
  const old = new Date(now.getTime() - 40 * 60 * 1000).toISOString();
  const db = {
    async query(sql) {
      if (/FROM orgs/i.test(sql)) return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
      if (/FROM agents/i.test(sql)) {
        return { rows: [{ code: "AG-07", status: "live", runtime: "inngest", runtime_ref: "daily-pulse" }] };
      }
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/FROM call_outcomes/i.test(sql)) {
        return {
          rows: [{
            id: "co-1",
            client_id: "c1",
            staff_id: "s1",
            outcome: "deposit",
            recording_url: null,
            transcript: null,
            logged_at: old,
            client_name: "Jane Doe"
          }]
        };
      }
      return { rows: [] };
    }
  };
  const row = await checkUnrecorded({ db, orgId: "11111111-1111-4111-8111-111111111111", now });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 sales call/);
  assert.match(row.suggestedFix, /Do not text each miss/);
});

test("this module does not import the Ops Admin money pulse", () => {
  const src = readFileSync(path.join(HERE, "daily-pulse.mjs"), "utf8");
  assert.doesNotMatch(src, /^import .*from ["'].*ops\/pulse/m);
  assert.doesNotMatch(src, /^import .*ops-pulse/m);
});

test("a dead database does not stop the pulse: one red db row, the rest still run", async () => {
  const deadDb = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
  const boardDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-deaddb-"));
  const result = await runDailyPulse({
    dryRun: true,
    db: deadDb,
    env: {},
    boardDir,
    sendPulseText: false,
    recordRun: false,
    coverageRows: [],
    fetchImpl: async () => ({ status: 200, text: async () => "Sign in password Generate Apps Apply door" })
  });
  const db = result.checks.filter((c) => c.id === "db");
  assert.equal(db.length, 1, "exactly one database row");
  assert.equal(db[0].status, "FAIL");
  assert.match(db[0].detail, /could not be read/);
  assert.ok(result.checks.some((c) => c.id === "health"), "the web checks still ran");
  assert.ok(result.scorecard, "a scorecard is still built");
  fs.rmSync(boardDir, { recursive: true, force: true });
});
