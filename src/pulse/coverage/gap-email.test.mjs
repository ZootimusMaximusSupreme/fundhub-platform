import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAGIC_LINK_SQL,
  MAGIC_LINK_TEMPLATE_KEY,
  MORNING_EMAIL_PATHS,
  PROVIDER_FAIL_DAYS,
  PROVIDER_FAIL_SQL,
  REPO_ROOT,
  STUCK_MINUTES,
  STUCK_SQL,
  gapChecks,
  morningEmailPathMissesFailureCheck,
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

function fakeDb(counts = {}, { throwOn = null } = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (throwOn && String(sql).includes(throwOn)) throw new Error("read failed");
      if (String(sql).includes("account_magic_links")) return { rows: [{ n: counts.magic || 0 }] };
      if (String(sql).includes("status = 'failed'")) return { rows: [{ n: counts.failed || 0 }] };
      if (String(sql).includes("status = 'queued'")) return { rows: [{ n: counts.stuck || 0 }] };
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
    db: fakeDb({ stuck: 2, failed: 1, magic: 3 }),
    orgId: ORG,
    now: NOW,
    sources: okSources()
  });
  assert.equal(rows.length, 4);
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
  assert.equal(rows["email:queued-stuck"].status, "PASS");
  assert.equal(rows["email:provider-fail"].status, "PASS");
  assert.equal(rows["email:magic-link-unqueued"].status, "PASS");
  assert.equal(rows["email:morning-no-failure-check"].status, "PASS");
  assert.equal(db.calls.length, 3);
  for (const call of db.calls) {
    assert.match(call.sql, /^SELECT\b/i);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
  }
});

test("gap email: stuck, provider fail, and unqueued magic link are separate", async () => {
  const db = fakeDb({ stuck: 2, failed: 1, magic: 4 });
  const rows = byId(await gapChecks({ db, orgId: ORG, now: NOW, sources: okSources() }));
  assert.equal(rows["email:queued-stuck"].status, "FAIL");
  assert.match(rows["email:queued-stuck"].detail, /2 outbound emails are still queued past 30 minutes/);
  assert.match(rows["email:queued-stuck"].suggestedFix, /message dispatch sweeper/);
  assert.equal(rows["email:provider-fail"].status, "FAIL");
  assert.match(rows["email:provider-fail"].detail, /1 outbound email failed at the provider in the last 3 days/);
  assert.equal(rows["email:magic-link-unqueued"].status, "FAIL");
  assert.match(rows["email:magic-link-unqueued"].detail, /4 magic-link sign-ins were issued and no email was queued/);
  assert.match(rows["email:magic-link-unqueued"].suggestedFix, /EMAIL-PORTAL-MAGIC-LINK/);

  const stuck = db.calls.find((call) => call.sql === STUCK_SQL);
  const failed = db.calls.find((call) => call.sql === PROVIDER_FAIL_SQL);
  const magic = db.calls.find((call) => call.sql === MAGIC_LINK_SQL);
  assert.equal(stuck.params[0], ORG);
  assert.equal(stuck.params[1].toISOString(), new Date(NOW.getTime() - STUCK_MINUTES * 60 * 1000).toISOString());
  assert.equal(failed.params[1].toISOString(), new Date(NOW.getTime() - PROVIDER_FAIL_DAYS * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(magic.params[2], MAGIC_LINK_TEMPLATE_KEY);
  assert.equal(magic.params[1].toISOString(), new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());
  assert.match(STUCK_SQL, /channel = 'email'/);
  assert.match(PROVIDER_FAIL_SQL, /status = 'failed'/);
  assert.match(PROVIDER_FAIL_SQL, /test address/);
  assert.doesNotMatch(STUCK_SQL, /sms/);
});

test("gap email: one stuck email uses the singular line", async () => {
  const rows = byId(await gapChecks({
    db: fakeDb({ stuck: 1 }),
    orgId: ORG,
    now: NOW,
    sources: okSources()
  }));
  assert.match(rows["email:queued-stuck"].detail, /^1 outbound email is still queued/);
});

test("gap email: no database and no org skip the reads", async () => {
  const quiet = fakeDb();
  const noDb = byId(await gapChecks({ sources: okSources() }));
  assert.equal(noDb["email:queued-stuck"].status, "skip");
  assert.equal(noDb["email:provider-fail"].status, "skip");
  assert.equal(noDb["email:magic-link-unqueued"].status, "skip");
  assert.match(noDb["email:queued-stuck"].detail, /no database/);
  assert.equal(quiet.calls.length, 0);

  const noOrg = fakeDb();
  const rows = byId(await gapChecks({ db: noOrg, sources: okSources() }));
  assert.equal(rows["email:provider-fail"].status, "skip");
  assert.match(rows["email:provider-fail"].detail, /no org/);
  assert.equal(noOrg.calls.length, 0);
});

test("gap email: a read error is a fail and does not throw", async () => {
  const rows = byId(await gapChecks({
    db: fakeDb({}, { throwOn: "account_magic_links" }),
    orgId: ORG,
    now: NOW,
    sources: okSources()
  }));
  assert.equal(rows["email:queued-stuck"].status, "PASS");
  assert.equal(rows["email:magic-link-unqueued"].status, "FAIL");
  assert.match(rows["email:magic-link-unqueued"].detail, /could not read: read failed/);
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

test("gap email: this module does not send and does not touch the outbound switch", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-email.mjs"), "utf8");
  assert.doesNotMatch(src, /^import\s+.*providers\/(resend|mailgun)/m);
  assert.doesNotMatch(src, /^import\s+.*\bsendTemplated\b/m);
  assert.doesNotMatch(src, /^import\s+.*\b(drainAll|dispatchOne)\b/m);
  assert.doesNotMatch(src, /outbound_enabled/);
  const queries = `${STUCK_SQL}\n${PROVIDER_FAIL_SQL}\n${MAGIC_LINK_SQL}`;
  assert.match(queries, /^SELECT\b/m);
  assert.doesNotMatch(queries, /\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
});
