// Tests for beat-pay-webhook.mjs: a PASS and a FAIL for every step, and the checks that keep the
// beat honest about what it reads. No network, no database. The SQL itself is proven against the
// real database, read-only, in beat-pay-webhook.pg.test.mjs (it skips without DATABASE_URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-pay-webhook.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths, fixGuideProblems } from "./contract.mjs";
import { makeFakeCtx, ctxLog, FAKE_NOW } from "./ctx.mjs";
import { MAX_ATTEMPTS, STALE_CLAIM_MINUTES } from "../../payments/commas-inbox.mjs";
import { INBOX_WAIT_MS, INBOX_PROCESSING_WAIT_MS } from "../coverage/gap-payments.mjs";
import { JOBS, cronIntervalMs } from "../heartbeats.mjs";
import { isDbDetail } from "../alerts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const FILE = path.join(HERE, "beat-pay-webhook.mjs");
const SITE = "https://fundhub.ai";
const DOOR = `GET ${SITE}/api/webhooks/commas`;
const SECRET = "pulse-test-signing-secret-not-real-0123456789";

const sweeper = (over = {}) => ({ match: /FROM job_heartbeats/, rows: [{ last_at: new Date(FAKE_NOW.getTime() - 30_000), last_outcome: "ok", ...over }] });
const inbox = (over = {}) => ({
  match: /FROM commas_inbox/,
  rows: [{ waiting_n: 0, pending_n: 0, failed_n: 0, processing_n: 0, paid_n: 0, gave_up_n: 0, oldest_s: null, ...over }]
});
const live = (extra = {}) => ({ NETLIFY: "true", COMMAS_WEBHOOK_SECRET: SECRET, ...extra });
const door405 = { status: 405, body: '{"ok":false,"error":"Method not allowed"}' };

/** Everything green. Pass pieces to replace. */
const world = (over = {}) => ({
  env: live(),
  http: { [DOOR]: door405 },
  read: [sweeper(), inbox()],
  ...over
});
const go = (over) => runBeat(beat, makeFakeCtx(beat, world(over)));
const redAt = (r, step) => { assert.equal(r.ok, false, `expected red, got green: ${r.detail}`); assert.equal(r.step, step, r.detail); return r; };

/* ---------------- the beat is a valid beat ---------------- */

test("it is a valid beat: id, covers, reads, fix guide, self test, static pin", async () => {
  const { functions } = await import("../../workflows/index.mjs");
  const surfaces = new Set(functions.map((f) => `job:${f.opts.id}`));
  assert.ok(surfaces.has("job:commas-inbox-drain"), "the Inngest job named in covers exists");
  assert.deepEqual(validateBeat(beat, { file: "beat-pay-webhook.mjs", surfaces }), []);
  assert.deepEqual(beat.covers, ["job:commas-inbox-drain", "webhook:commas"]);
  assert.equal(beat.kind, "infra");
  assert.equal(beat.damp, 1);
  assert.deepEqual(beat.reads, [{ host: "SITE", methods: ["GET"] }]);
  assert.deepEqual(beat.steps, ["secret-present", "door-mounted", "verifier-accepts", "sweeper-alive", "inbox-not-stuck"]);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.deepEqual(fixGuideProblems(beat.fixGuide), []);
  const { missing, paths } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(paths.length >= 4);
  assert.deepEqual(missing, [], "every file the fix guide names is real");
  assert.deepEqual(pinBeatSource(fs.readFileSync(FILE, "utf8")), []);
});

test("webhook:commas is a provider the router really serves, and the door file answers a GET with 405", () => {
  const router = fs.readFileSync(path.join(ROOT, "src/http/router.mjs"), "utf8");
  assert.match(router, /\n\s*commas:\s*\{\s*\n\s*fn:\s*handleCommasWebhook/, "STD has a commas entry");
  const door = fs.readFileSync(path.join(ROOT, "api/webhooks/[provider].mjs"), "utf8");
  assert.match(door, /req\.method !== "POST"[\s\S]{0,80}status\(405\)[\s\S]{0,80}Method not allowed/, "a non-POST answers 405 with the text this beat looks for");
  const api = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  assert.match(api, /path\.startsWith\("webhooks\/"\)/, "the webhooks/ prefix is what the fix guide says it is");
});

test("the numbers in the SQL are the ones the inbox and the morning pulse use", () => {
  assert.equal(beat.MAX_ATTEMPTS, MAX_ATTEMPTS);
  assert.equal(beat.PROCESSING_WAIT_MINUTES, STALE_CLAIM_MINUTES + 5);
  assert.equal(beat.PROCESSING_WAIT_MINUTES * 60_000, INBOX_PROCESSING_WAIT_MS);
  assert.equal(beat.WAIT_MINUTES * 60_000, INBOX_WAIT_MS);
  assert.match(beat.INBOX_SQL, new RegExp(`interval '${STALE_CLAIM_MINUTES} minutes'`), "the stale claim window is the inbox's own");
  const job = JOBS.find((j) => j.job === beat.SWEEPER_JOB);
  assert.ok(job, "commas-inbox-sweeper is a registered scheduled job");
  assert.equal(job.runner, "netlify");
  assert.equal(beat.SWEEPER_STALE_MS, 3 * cronIntervalMs(job.cron), "3 times its schedule");
});

/* ---------------- all green ---------------- */

test("PASS: every step runs or is skipped on purpose, only GET goes out, only one-statement reads go to the database", async () => {
  const ctx = makeFakeCtx(beat, world());
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.step, "done");
  assert.deepEqual(r.notRun, []);
  assert.deepEqual(r.skipped, ["verifier-accepts"], "the verifier step is skipped on purpose and says so");
  assert.deepEqual(r.steps.map((s) => s.name), ["secret-present", "door-mounted", "verifier-accepts", "sweeper-alive", "inbox-not-stuck"]);
  assert.match(r.detail, /Cannot prove Commas still sends/);
  const log = ctxLog(ctx);
  assert.deepEqual(log.http.map((h) => [h.method, h.host, h.status]), [["GET", "fundhub.ai", 405]]);
  assert.equal(log.reads.length, 2);
  assert.deepEqual(log.reads[0].params, ["commas-inbox-sweeper"]);
  assert.deepEqual(log.refused, [], "the read box allow-list accepts both queries");
});

test("PASS: on a laptop the secret is a mask, so that step is skipped and the rest still run and still go red", async () => {
  const laptop = { env: { COMMAS_WEBHOOK_SECRET: "****************1234" } };
  const ok = await go(laptop);
  assert.equal(ok.ok, true, ok.detail);
  assert.deepEqual(ok.skipped.sort(), ["secret-present", "verifier-accepts"]);
  assert.match(ok.detail, /not checked \(laptop\)/);
  redAt(await go({ ...laptop, http: { [DOOR]: { status: 404 } } }), "door-mounted");
  redAt(await go({ ...laptop, read: [sweeper({ last_at: new Date(FAKE_NOW.getTime() - 10 * 60_000) }), inbox()] }), "sweeper-alive");
});

/* ---------------- secret-present ---------------- */

test("FAIL secret-present: on the server an empty, missing or star-only secret is red", async () => {
  for (const value of ["", "   ", undefined, "****************f377", "*"]) {
    const env = live({ COMMAS_WEBHOOK_SECRET: value });
    const r = redAt(await go({ env }), "secret-present");
    assert.match(r.detail, /COMMAS_WEBHOOK_SECRET is empty/);
    assert.ok(!r.detail.includes("f377"), "the mask is not echoed");
  }
  // a missing key (no property at all)
  const env = { NETLIFY: "true" };
  redAt(await go({ env }), "secret-present");
});

test("PASS secret-present: a real-looking secret passes, and its value never appears in the result", async () => {
  const r = await go({});
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes(SECRET));
  const lambda = await go({ env: { AWS_LAMBDA_FUNCTION_NAME: "pulse-hourly", COMMAS_WEBHOOK_SECRET: SECRET } });
  assert.equal(lambda.ok, true, "AWS_LAMBDA_FUNCTION_NAME also means live");
  assert.ok(!lambda.skipped.includes("secret-present"));
});

/* ---------------- door-mounted ---------------- */

test("FAIL door-mounted: 404 is a missing prefix", async () => {
  const r = redAt(await go({ http: { [DOOR]: { status: 404, body: '{"error":"Not found"}' } } }), "door-mounted");
  assert.match(r.detail, /404.*webhooks\/ prefix is not mounted/);
});

test("FAIL door-mounted: a 5xx, no answer, a held fence, a wrong status and a 405 from something else are all red", async () => {
  const cases = [
    [{ status: 502 }, /HTTP 502.*not loading/],
    [{ status: 0, ok: false, class: "timeout", error: "timed out" }, /no answer \(timeout\)/],
    [{ status: 0, ok: false, class: "network", error: "reset" }, /no answer \(network\)/],
    [{ status: 0, ok: false, class: "blocked", error: "fence" }, /web fence is holding/],
    [{ status: 200, body: "<html>home page</html>" }, /HTTP 200, not 405/],
    [{ status: 401 }, /HTTP 401, not 405/],
    [{ status: 405, body: "<html>405 from the CDN</html>" }, /not from the webhook function/]
  ];
  for (const [answer, rx] of cases) {
    const r = redAt(await go({ http: { [DOOR]: answer } }), "door-mounted");
    assert.match(r.detail, rx);
  }
});

test("PASS door-mounted: it asks the site it was given, with GET only, on the commas path", async () => {
  const seen = [];
  const http = async (method, url) => { seen.push(`${method} ${url}`); return door405; };
  const ctx = makeFakeCtx(beat, world({ http, siteUrl: "https://preview.fundhub.ai" }));
  // makeFakeCtx hands the site to the ctx; the preview host is not in reads (reads says SITE = the ctx site)
  const r = await runBeat(beat, ctx);
  assert.equal(r.ok, true, r.detail);
  assert.deepEqual(seen, ["GET https://preview.fundhub.ai/api/webhooks/commas"]);
});

/* ---------------- verifier-accepts ---------------- */

test("verifier-accepts is skipped, never green and never red, and the reason says why (it is not faked)", async () => {
  const ctx = makeFakeCtx(beat, world());
  const r = await runBeat(beat, ctx);
  const step = r.steps.find((s) => s.name === "verifier-accepts");
  assert.equal(step.skipped, true);
  assert.match(step.why, /not pure/);
  assert.match(step.why, /verifyCommasSignature/);
  // the beat must not carry its own copy of the check
  const source = fs.readFileSync(FILE, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/createHmac|timingSafeEqual/.test(source), "no re-implemented HMAC in the beat");
  assert.ok(!/node:crypto/.test(source));
});

/* ---------------- sweeper-alive ---------------- */

test("PASS sweeper-alive: 30 seconds, and exactly 3 minutes, are alive", async () => {
  assert.equal((await go({})).ok, true);
  const edge = await go({ read: [sweeper({ last_at: new Date(FAKE_NOW.getTime() - 3 * 60_000) }), inbox()] });
  assert.equal(edge.ok, true, edge.detail);
  const iso = await go({ read: [sweeper({ last_at: new Date(FAKE_NOW.getTime() - 5_000).toISOString() }), inbox()] });
  assert.equal(iso.ok, true, "a time that arrives as text is read too");
});

test("FAIL sweeper-alive: 3 minutes and a second is a dead clock", async () => {
  const r = redAt(await go({ read: [sweeper({ last_at: new Date(FAKE_NOW.getTime() - 3 * 60_000 - 1000) }), inbox()] }), "sweeper-alive");
  assert.match(r.detail, /commas-inbox-sweeper last ran 3 min ago.*every minute/);
  const old = redAt(await go({ read: [sweeper({ last_at: new Date(FAKE_NOW.getTime() - 50 * 60_000) }), inbox()] }), "sweeper-alive");
  assert.match(old.detail, /50 min ago/);
});

test("FAIL sweeper-alive: no receipt at all, a last pass that errored, a bad time, and a database that cannot be read", async () => {
  const none = redAt(await go({ read: [{ match: /FROM job_heartbeats/, rows: [{ last_at: null, last_outcome: null }] }, inbox()] }), "sweeper-alive");
  assert.match(none.detail, /no run of commas-inbox-sweeper/);
  const empty = redAt(await go({ read: [{ match: /FROM job_heartbeats/, rows: [] }, inbox()] }), "sweeper-alive");
  assert.match(empty.detail, /no run of/);
  const err = redAt(await go({ read: [sweeper({ last_outcome: "error" }), inbox()] }), "sweeper-alive");
  assert.match(err.detail, /ended in an error/);
  const bad = redAt(await go({ read: [sweeper({ last_at: "not a time" }), inbox()] }), "sweeper-alive");
  assert.match(bad.detail, /cannot be read/);
  const down = redAt(await go({ read: [{ match: /FROM job_heartbeats/, error: "canceling statement due to statement timeout" }, inbox()] }), "sweeper-alive");
  assert.match(down.detail, /Could not read job_heartbeats: canceling statement/);
});

test("a database that is down keeps its 'db:' words, so the runner counts it as one database-down and not as a broken payment door", async () => {
  const dbDown = (m) => ({ match: /FROM (job_heartbeats|commas_inbox)/, error: m });
  // the first read (job_heartbeats) fails with the runner's own database-down words
  const first = redAt(await go({ read: [dbDown("db: the database is not answering")] }), "sweeper-alive");
  assert.equal(first.detail, "db: the database is not answering");
  assert.equal(isDbDetail(first.detail), true);
  // the second read (commas_inbox) the same
  const second = redAt(await go({ read: [sweeper(), dbDown("db: the read box did not open in time")] }), "inbox-not-stuck");
  assert.equal(second.detail, "db: the read box did not open in time");
  assert.equal(isDbDetail(second.detail), true);
  // any other read failure is NOT a database-down: it names the table and stays a break of this door
  const timeout = redAt(await go({ read: [{ match: /FROM job_heartbeats/, error: "canceling statement due to statement timeout" }, inbox()] }), "sweeper-alive");
  assert.equal(isDbDetail(timeout.detail), false);
  const missing = redAt(await go({ read: [sweeper(), { match: /FROM commas_inbox/, error: "relation does not exist" }] }), "inbox-not-stuck");
  assert.equal(isDbDetail(missing.detail), false);
  // a sentence that only mentions "db:" later is not a database-down
  const later = redAt(await go({ read: [{ match: /FROM job_heartbeats/, error: "the pooler said db: gone" }, inbox()] }), "sweeper-alive");
  assert.equal(isDbDetail(later.detail), false);
});

test("a green run says out loud that the signature check was not run", async () => {
  const r = await go({});
  assert.equal(r.ok, true);
  assert.match(r.detail, /signature check itself was NOT run/);
  assert.ok(r.detail.length <= 300, "the detail is not cut by the 300 character cap");
});

/* ---------------- inbox-not-stuck ---------------- */

test("PASS inbox-not-stuck: an empty inbox, and one with only fresh or finished rows, is clear (the query returns zeros)", async () => {
  const r = await go({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.evidence, { inbox: { waiting: 0, pending: 0, failed: 0, processing: 0, paid: 0, gaveUp: 0, oldestS: 0 } });
  // a database that answers with no row at all is read as zeros, not as an error
  const noRow = await go({ read: [sweeper(), { match: /FROM commas_inbox/, rows: [] }] });
  assert.equal(noRow.ok, true);
});

test("FAIL inbox-not-stuck: a stuck inbox row (pending over 10 minutes) is red and the detail counts it, with no payment or customer data", async () => {
  const stuck = inbox({ waiting_n: 2, pending_n: 1, failed_n: 1, processing_n: 0, paid_n: 1, oldest_s: 14 * 60 });
  const r = redAt(await go({ read: [sweeper(), stuck] }), "inbox-not-stuck");
  assert.match(r.detail, /2 payment notices are waiting over 10 min/);
  assert.match(r.detail, /1 never tried, 1 failed with tries left, 0 stuck mid-pass; 1 paid/);
  assert.match(r.detail, /Oldest: 14 min/);
  assert.deepEqual(r.evidence.waiting, 2);
  const one = redAt(await go({ read: [sweeper(), inbox({ waiting_n: 1, pending_n: 1, paid_n: 0, oldest_s: 20 })] }), "inbox-not-stuck");
  assert.match(one.detail, /1 payment notice is waiting/);
  assert.match(one.detail, /Oldest: under a minute/);
});

test("FAIL inbox-not-stuck: a notice that gave up after 10 tries in the last day is red, alone or with a waiting one", async () => {
  const gone = redAt(await go({ read: [sweeper(), inbox({ gave_up_n: 1 })] }), "inbox-not-stuck");
  assert.match(gone.detail, /1 notice gave up after 10 tries in the last 24 h/);
  const both = redAt(await go({ read: [sweeper(), inbox({ waiting_n: 1, pending_n: 1, gave_up_n: 3, oldest_s: 700 })] }), "inbox-not-stuck");
  assert.match(both.detail, /1 payment notice is waiting/);
  assert.match(both.detail, /3 notices gave up after 10 tries/);
});

test("FAIL inbox-not-stuck: if the inbox cannot be read it is red, not green", async () => {
  const r = redAt(await go({ read: [sweeper(), { match: /FROM commas_inbox/, error: "relation does not exist" }] }), "inbox-not-stuck");
  assert.match(r.detail, /Could not read commas_inbox/);
});

test("the first red wins: a dead door stops the run before the database is asked", async () => {
  const ctx = makeFakeCtx(beat, world({ http: { [DOOR]: { status: 404 } } }));
  const r = await runBeat(beat, ctx);
  assert.equal(r.step, "door-mounted");
  assert.equal(ctxLog(ctx).reads.length, 0);
  assert.deepEqual(r.notRun, ["verifier-accepts", "sweeper-alive", "inbox-not-stuck"]);
});

/* ---------------- the SQL text ---------------- */

test("the two queries are single reads the real read box accepts, and say what they count", async () => {
  const { assertReadOnlySql } = await import("./readbox.mjs");
  assert.doesNotThrow(() => assertReadOnlySql(beat.SWEEPER_SQL));
  assert.doesNotThrow(() => assertReadOnlySql(beat.INBOX_SQL));
  assert.match(beat.SWEEPER_SQL, /FROM job_heartbeats[\s\S]*WHERE job = \$1/);
  assert.match(beat.INBOX_SQL, /FROM commas_inbox ci/);
  assert.match(beat.INBOX_SQL, /NOT LIKE 'sim-pay-%'/, "simulated receipts are left out, like the morning pulse");
  assert.match(beat.INBOX_SQL, /attempts >= 10/);
  assert.match(beat.INBOX_SQL, /interval '24 hours'/);
});

test("the beat has no way to write: no write SQL, no POST, only ctx.http.get", () => {
  const source = fs.readFileSync(FILE, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual(pinBeatSource(fs.readFileSync(FILE, "utf8")), [], "the static pin finds no SQL write, fetch or process");
  assert.ok(!/method:\s*["']POST/i.test(source));
  assert.ok(!/ctx\.http\.(?!get\b)/.test(source), "only ctx.http.get");
  assert.ok(!/ctx\.(db|door|fetch|pool)\b/.test(source));
});
