import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DRIP_SQL,
  MAGIC_LINK_SQL,
  MAGIC_LINK_TEMPLATE_KEY,
  MORNING_EMAIL_PATHS,
  PROVIDER_FAIL_DAYS,
  PROVIDER_FAIL_SQL,
  REPO_ROOT,
  SENDING_STUCK_MINUTES,
  SENDING_STUCK_SQL,
  gapChecks,
  morningEmailPathMissesFailureCheck,
  morningRoots,
  readMorningSources,
  unreadMorningEmailPaths
} from "./gap-email.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

function okSources() {
  const body = "channel: \"email\"\nif (!result.sent) notQueued.push({ reason: \"template_pending\" });\n";
  return Object.fromEntries(MORNING_EMAIL_PATHS.map((row) => [row.file, body]));
}

function liveSources() {
  const out = {};
  for (const row of MORNING_EMAIL_PATHS) {
    out[row.file] = fs.readFileSync(path.join(REPO_ROOT, row.file), "utf8");
  }
  return out;
}

// Routes by which of the four statements arrived. Each statement has one
// phrase no other has, so a swapped query would hand back the wrong counts.
function fakeDb(counts = {}, { throwOn = null, blank = null } = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (throwOn && text.includes(throwOn)) throw new Error("read failed");
      if (blank && text.includes(blank)) return { rows: [{}] };
      if (text.includes("account_magic_links")) return { rows: [{ n: counts.magic || 0 }] };
      if (text.includes("slo_drip_step")) {
        return { rows: [{ n: counts.drip || 0, missing: counts.dripMissing || 0 }] };
      }
      if (text.includes("bounced_n")) {
        return { rows: [{ failed_n: counts.failed || 0, bounced_n: counts.bounced || 0 }] };
      }
      if (text.includes("status = 'sending'")) return { rows: [{ n: counts.sending || 0 }] };
      return { rows: [] };
    }
  };
  return db;
}

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test("gap email: each row has id, status, detail, suggestedFix", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sending: 2, failed: 1, bounced: 1, magic: 3, drip: 1, dripMissing: 3 }),
    orgId: ORG,
    now: NOW,
    sources: okSources()
  });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), [
    "email:sending-stuck",
    "email:provider-fail",
    "email:magic-link-unqueued",
    "email:drip-step-no-email",
    "email:morning-no-failure-check"
  ]);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.ok("suggestedFix" in row);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon AG-07/);
      assert.match(row.suggestedFix, /Do not send email/);
      assert.match(row.suggestedFix, /Do not flip outbound/);
      assert.match(row.suggestedFix, /Do not build a second watchdog/);
      assert.doesNotMatch(row.suggestedFix, /new watchdog|second tripwire|outbound_enabled/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
});

test("gap email: a clean queue passes and does not write", async () => {
  const db = fakeDb();
  const rows = byId(await gapChecks({ db, orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(rows["email:sending-stuck"].status, "PASS");
  assert.equal(rows["email:provider-fail"].status, "PASS");
  assert.equal(rows["email:magic-link-unqueued"].status, "PASS");
  assert.equal(rows["email:drip-step-no-email"].status, "PASS");
  assert.equal(rows["email:morning-no-failure-check"].status, "PASS");
  assert.equal(db.calls.length, 4);
  for (const call of db.calls) {
    assert.match(call.sql, /^SELECT\b/i);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
    assert.doesNotMatch(call.sql, /^\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  }
});

test("gap email: sending, provider fail, magic link and drip are separate", async () => {
  const db = fakeDb({ sending: 2, failed: 1, bounced: 2, magic: 4, drip: 2, dripMissing: 5 });
  const rows = byId(await gapChecks({ db, orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(rows["email:sending-stuck"].status, "FAIL");
  assert.match(rows["email:sending-stuck"].detail, /2 outbound emails have been on sending for more than 15 minutes/);
  assert.match(rows["email:sending-stuck"].suggestedFix, /nothing puts it back/);
  assert.equal(rows["email:provider-fail"].status, "FAIL");
  assert.match(rows["email:provider-fail"].detail, /3 outbound emails did not arrive in the last 3 days \(1 failed at the provider, 2 bounced\)/);
  assert.equal(rows["email:magic-link-unqueued"].status, "FAIL");
  assert.match(rows["email:magic-link-unqueued"].detail, /4 magic-link sign-ins were issued and no email was queued/);
  assert.match(rows["email:magic-link-unqueued"].suggestedFix, /EMAIL-PORTAL-MAGIC-LINK/);
  assert.equal(rows["email:drip-step-no-email"].status, "FAIL");
  assert.match(rows["email:drip-step-no-email"].detail, /2 people are on the roadmap drip with 5 steps that never queued an email/);

  const sending = db.calls.find((call) => call.sql === SENDING_STUCK_SQL);
  const failed = db.calls.find((call) => call.sql === PROVIDER_FAIL_SQL);
  const magic = db.calls.find((call) => call.sql === MAGIC_LINK_SQL);
  const drip = db.calls.find((call) => call.sql === DRIP_SQL);
  assert.equal(sending.params[0], ORG);
  assert.equal(sending.params[1].toISOString(), new Date(NOW.getTime() - SENDING_STUCK_MINUTES * 60 * 1000).toISOString());
  assert.equal(failed.params[1].toISOString(), new Date(NOW.getTime() - PROVIDER_FAIL_DAYS * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(magic.params[2], MAGIC_LINK_TEMPLATE_KEY);
  assert.equal(magic.params[1].toISOString(), new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());
  assert.deepEqual(drip.params, [ORG]);
});

test("gap email: one email uses the singular line, and each count alone is enough to FAIL", async () => {
  const one = byId(await gapChecks({ db: fakeDb({ sending: 1 }), orgId: ORG, now: NOW, sources: okSources() }));
  assert.match(one["email:sending-stuck"].detail, /^1 outbound email has been on sending/);
  assert.equal(one["email:provider-fail"].status, "PASS");

  const failedOnly = byId(await gapChecks({ db: fakeDb({ failed: 1 }), orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(failedOnly["email:provider-fail"].status, "FAIL");
  assert.match(failedOnly["email:provider-fail"].detail, /1 outbound email did not arrive.*\(1 failed at the provider\)/);

  const bouncedOnly = byId(await gapChecks({ db: fakeDb({ bounced: 1 }), orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(bouncedOnly["email:provider-fail"].status, "FAIL");
  assert.match(bouncedOnly["email:provider-fail"].detail, /\(1 bounced\)/);

  const dripOnly = byId(await gapChecks({ db: fakeDb({ drip: 1, dripMissing: 1 }), orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(dripOnly["email:drip-step-no-email"].status, "FAIL");
  assert.match(dripOnly["email:drip-step-no-email"].detail, /^1 person is on the roadmap drip with 1 step that/);
  assert.equal(dripOnly["email:sending-stuck"].status, "PASS");
});

test("gap email: no database and no org skip the reads", async () => {
  const quiet = fakeDb();
  const noDb = byId(await gapChecks({ sources: okSources() }));
  assert.equal(noDb["email:sending-stuck"].status, "skip");
  assert.equal(noDb["email:provider-fail"].status, "skip");
  assert.equal(noDb["email:magic-link-unqueued"].status, "skip");
  assert.equal(noDb["email:drip-step-no-email"].status, "skip");
  assert.match(noDb["email:sending-stuck"].detail, /no database/);
  assert.equal(quiet.calls.length, 0);

  const noOrg = fakeDb();
  const rows = byId(await gapChecks({ db: noOrg, sources: okSources() }));
  assert.equal(rows["email:provider-fail"].status, "skip");
  assert.match(rows["email:provider-fail"].detail, /no org/);
  assert.equal(noOrg.calls.length, 0);
});

test("gap email: a read error is a fail that names the cause, and the other reads still run", async () => {
  const rows = byId(await gapChecks({
    db: fakeDb({}, { throwOn: "account_magic_links" }),
    orgId: ORG,
    now: NOW,
    sources: okSources()
  }));
  assert.equal(rows["email:sending-stuck"].status, "PASS");
  assert.equal(rows["email:drip-step-no-email"].status, "PASS");
  assert.equal(rows["email:magic-link-unqueued"].status, "FAIL");
  assert.match(rows["email:magic-link-unqueued"].detail, /could not read: read failed/);
});

test("gap email: a count that comes back blank is a skip, never a PASS", async () => {
  for (const [phrase, id] of [
    ["status = 'sending'", "email:sending-stuck"],
    ["bounced_n", "email:provider-fail"],
    ["account_magic_links", "email:magic-link-unqueued"],
    ["slo_drip_step", "email:drip-step-no-email"]
  ]) {
    const rows = byId(await gapChecks({
      db: fakeDb({}, { blank: phrase }),
      orgId: ORG,
      now: NOW,
      sources: okSources()
    }));
    assert.equal(rows[id].status, "skip", `${id} must skip on a blank count`);
    assert.match(rows[id].detail, /could not read/);
  }
  const empty = byId(await gapChecks({
    db: { async query() { return { rows: [] }; } },
    orgId: ORG,
    now: NOW,
    sources: okSources()
  }));
  assert.ok(["email:sending-stuck", "email:provider-fail", "email:magic-link-unqueued", "email:drip-step-no-email"]
    .every((id) => empty[id].status === "skip"));
});

test("gap email: morning source with no send-result read fails", async () => {
  const sources = okSources();
  sources["src/workflows/slo-infinite-drip.mjs"] = "const email = await sendTemplated(db, { channel: \"email\" });\nreturn { sent: true, email };\n";
  const rows = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, sources }));
  const morning = rows["email:morning-no-failure-check"];
  assert.equal(morning.status, "FAIL");
  assert.match(morning.detail, /src\/workflows\/slo-infinite-drip\.mjs/);
  assert.match(morning.detail, /8:00 a\.m\. Arizona/);
  assert.doesNotMatch(morning.detail, /notify\.mjs/);
});

test("gap email: a morning file that is not on disk is a skip, not a FAIL and not a PASS", async () => {
  const none = Object.fromEntries(MORNING_EMAIL_PATHS.map((row) => [row.file, null]));
  const rows = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, sources: none }));
  assert.equal(rows["email:morning-no-failure-check"].status, "skip");
  assert.match(rows["email:morning-no-failure-check"].detail, /not on disk/);
  assert.match(rows["email:morning-no-failure-check"].detail, /slo-infinite-drip\.mjs/);

  // One file missing and one that really misses the result read: the real miss still shouts.
  const mixed = okSources();
  mixed["src/contracts/notify.mjs"] = null;
  mixed["src/workflows/slo-infinite-drip.mjs"] = "channel: \"email\"\nreturn { sent: true };\n";
  const mixedRows = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, sources: mixed }));
  assert.equal(mixedRows["email:morning-no-failure-check"].status, "FAIL");
  assert.doesNotMatch(mixedRows["email:morning-no-failure-check"].detail, /notify\.mjs/);

  // One file missing and the rest fine: not a PASS, because a file went unread.
  const oneMissing = okSources();
  oneMissing["src/finance/document-vault-chase.mjs"] = null;
  const oneRows = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, sources: oneMissing }));
  assert.equal(oneRows["email:morning-no-failure-check"].status, "skip");
});

test("gap email: a file that does not send email is not a miss", () => {
  assert.equal(morningEmailPathMissesFailureCheck("no mail here"), false);
  assert.equal(morningEmailPathMissesFailureCheck("channel: \"email\"\nreturn { sent: true };\n"), true);
  assert.equal(
    morningEmailPathMissesFailureCheck("channel: \"email\"\nif (!email.sent) skipped;\n"),
    false
  );
});

test("gap email: live morning files — drip ignores the result, chase and vault do not", () => {
  const misses = unreadMorningEmailPaths(liveSources());
  assert.deepEqual(misses.map((row) => row.id), ["slo-infinite-drip"]);
});

test("gap email: magic-link template key matches the auth module", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "src/auth/magic-link.mjs"), "utf8");
  assert.match(src, new RegExp(`MAGIC_LINK_TEMPLATE_KEY = "${MAGIC_LINK_TEMPLATE_KEY}"`));
  assert.match(src, /provider_ref sendTemplated synthesises unique per/);
});

test("gap email: booking confirm links are the only long-lived links that queue no email", () => {
  // The magic-link check reads only links that live an hour or less. If a second caller
  // starts issuing long links without queueing the email, or the booking link gets
  // shorter, this stops being true and the check must change with it.
  const auth = fs.readFileSync(path.join(REPO_ROOT, "src/auth/magic-link.mjs"), "utf8");
  const booking = fs.readFileSync(path.join(REPO_ROOT, "src/workflows/s-04b-booking-reminders.mjs"), "utf8");
  assert.match(auth, /BOOKING_CONFIRM_LINK_TTL_MINUTES = 365 \* 24 \* 60/);
  assert.match(auth, /LINK_TTL_MINUTES = 15/);
  assert.match(booking, /ttlMinutes: BOOKING_CONFIRM_LINK_TTL_MINUTES,\s*queueEmail: false/);
  assert.match(MAGIC_LINK_SQL, /l\.expires_at - l\.created_at <= interval '1 hour'/);
  for (const rel of ["api/auth/magic-link.mjs", "api/auth/send-portal-link.mjs", "api/auth/authorized-rep.mjs", "api/soft-pull-approve.mjs", "src/slo/buyer.mjs"]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(src, /queueEmail:\s*false/, `${rel} now issues links without queueing the email`);
    assert.doesNotMatch(src, /BOOKING_CONFIRM_LINK_TTL_MINUTES/, `${rel} now issues booking-length links`);
  }
});

test("gap email: provider SQL counts bounces, keeps a failed row with no error text, drops test and missing-address holds", () => {
  assert.match(PROVIDER_FAIL_SQL, /status IN \('failed', 'bounced'\)/);
  assert.match(PROVIDER_FAIL_SQL, /count\(\*\) FILTER \(WHERE status = 'bounced'\)/);
  assert.match(PROVIDER_FAIL_SQL, /coalesce\(last_error, ''\) NOT ILIKE '%test address%'/);
  assert.match(PROVIDER_FAIL_SQL, /coalesce\(last_error, ''\) NOT ILIKE '%to send to%'/);
  assert.match(PROVIDER_FAIL_SQL, /channel = 'email'/);
  assert.doesNotMatch(PROVIDER_FAIL_SQL, /last_error IS NOT NULL/);
  // A real Resend sandbox refusal says "testing email address". It must still count.
  assert.equal(/test address/i.test("Please use our testing email address instead of domains like gmail.com"), false);
});

test("gap email: queued email is left to pipeline:outbound, not counted twice", async () => {
  const motion = fs.readFileSync(path.join(REPO_ROOT, "src/pulse/pipeline-motion.mjs"), "utf8");
  assert.match(motion, /"pipeline:outbound"/);
  assert.match(motion, /status = 'queued'/);
  assert.doesNotMatch(motion, /channel\s*=\s*'email'/, "pipeline:outbound is every channel, so email queued rows are covered");
  assert.match(SENDING_STUCK_SQL, /status = 'sending'/);
  assert.doesNotMatch(SENDING_STUCK_SQL, /'queued'/);
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, sources: okSources() });
  assert.ok(!rows.some((r) => /queued-stuck/.test(r.id)));
});

test("gap email: the drip read uses the drip's own field names and template prefix", () => {
  const plan = fs.readFileSync(path.join(REPO_ROOT, "src/slo/drip-plan.mjs"), "utf8");
  const drip = fs.readFileSync(path.join(REPO_ROOT, "src/workflows/slo-infinite-drip.mjs"), "utf8");
  assert.match(plan, /DRIP_ON = "slo_drip_on"/);
  assert.match(plan, /DRIP_STEP = "slo_drip_step"/);
  assert.match(plan, /`EMAIL-SLO-DRIP-COLD-\$\{n\}`/);
  assert.match(plan, /`EMAIL-SLO-DRIP-HOT-\$\{n\}`/);
  // The drip steps up whether or not an email was queued. That is why a step with no row is a break.
  assert.match(drip, /DRIP_STEP\]: String\(step \+ 1\)/);
  assert.match(drip, /eventId: null/);
  assert.match(DRIP_SQL, /custom_fields->>'slo_drip_on' = '1'/);
  assert.match(DRIP_SQL, /custom_fields->>'slo_drip_step'/);
  assert.match(DRIP_SQL, /template_key LIKE 'EMAIL-SLO-DRIP-%'/);
  assert.match(DRIP_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(DRIP_SQL, /WHERE s\.step > s\.sent/);
  assert.doesNotMatch(DRIP_SQL, /\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
});

test("gap email: this module does not send and does not touch the outbound switch", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-email.mjs"), "utf8");
  assert.doesNotMatch(src, /^import\s+.*providers\/(resend|mailgun)/m);
  assert.doesNotMatch(src, /^import\s+.*\bsendTemplated\b/m);
  assert.doesNotMatch(src, /^import\s+.*\b(drainAll|dispatchOne)\b/m);
  assert.doesNotMatch(src, /outbound_enabled/);
  assert.doesNotMatch(src, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  const queries = `${SENDING_STUCK_SQL}\n${PROVIDER_FAIL_SQL}\n${MAGIC_LINK_SQL}\n${DRIP_SQL}`;
  assert.match(queries, /^SELECT\b/m);
  assert.doesNotMatch(queries, /\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
});

// The deployed function is one bundled file at <root>/netlify/functions/<name>.mjs, with src/
// next to netlify/. Measured 2026-10-08 in .netlify/functions/api.zip. REPO_ROOT (three folders
// above this file) lands outside the zip there, which is why the morning row could only skip.
function lambdaLayout(bodies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gap-email-lambda-"));
  fs.mkdirSync(path.join(root, "netlify", "functions"), { recursive: true });
  for (const row of MORNING_EMAIL_PATHS) {
    const file = path.join(root, row.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bodies[row.file] ?? okSources()[row.file]);
  }
  return root;
}

test("gap email: morning roots cover the checkout, the bundled function folder, the lambda root and the working folder", () => {
  const roots = morningRoots({ env: { LAMBDA_TASK_ROOT: "/var/task" }, cwd: "/var/task" });
  assert.ok(roots.includes(REPO_ROOT));
  assert.ok(roots.includes(path.resolve(HERE, "../..")));
  assert.ok(roots.includes("/var/task"));
  assert.equal(new Set(roots).size, roots.length, "no root is listed twice");
  // Bundled at /var/task/netlify/functions/<name>.mjs, two folders up is the root that holds src/.
  assert.equal(path.resolve("/var/task/netlify/functions", "../.."), "/var/task");
  // An explicit root is the only root, so a test can prove a missing file really skips.
  assert.deepEqual(morningRoots({ root: "/somewhere" }), ["/somewhere"]);
  assert.deepEqual(morningRoots({ env: {}, cwd: REPO_ROOT }).filter((r) => r === REPO_ROOT), [REPO_ROOT]);
});

test("gap email: the morning files are found under a lambda-style root and a miss there still FAILs", async () => {
  const root = lambdaLayout();
  try {
    const got = readMorningSources(["/this/path/does/not/exist", root]);
    for (const row of MORNING_EMAIL_PATHS) assert.equal(typeof got[row.file], "string", `${row.file} was not found`);

    const pass = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, root }));
    assert.equal(pass["email:morning-no-failure-check"].status, "PASS");

    fs.writeFileSync(
      path.join(root, "src/workflows/slo-infinite-drip.mjs"),
      "const email = await sendTemplated(db, { channel: \"email\" });\nreturn { sent: true, email };\n"
    );
    const fail = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, root }));
    assert.equal(fail["email:morning-no-failure-check"].status, "FAIL");
    assert.match(fail["email:morning-no-failure-check"].detail, /slo-infinite-drip\.mjs/);
    assert.doesNotMatch(fail["email:morning-no-failure-check"].detail, /notify\.mjs|document-vault-chase\.mjs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gap email: a root with no src is a skip with the reason, never a PASS", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "gap-email-empty-"));
  try {
    const got = readMorningSources([empty]);
    assert.ok(MORNING_EMAIL_PATHS.every((row) => got[row.file] === null));
    const rows = byId(await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, root: empty }));
    assert.equal(rows["email:morning-no-failure-check"].status, "skip");
    assert.match(rows["email:morning-no-failure-check"].detail, /not on disk/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("gap email: sending-stuck reads email only and never reads queued or sms", () => {
  assert.match(SENDING_STUCK_SQL, /channel = 'email'/);
  assert.match(SENDING_STUCK_SQL, /direction = 'outbound'/);
  assert.doesNotMatch(SENDING_STUCK_SQL, /sms/);
  assert.match(SENDING_STUCK_SQL, /coalesce\(last_attempt_at, updated_at, created_at\) < \$2::timestamptz/);
});
