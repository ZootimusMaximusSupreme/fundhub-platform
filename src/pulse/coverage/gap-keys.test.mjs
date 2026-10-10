import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gapChecks,
  CHECK_IDS,
  INNGEST_KEYS,
  LAUNCH_SECRETS,
  CRS_LOGIN_KEYS,
  PROBE_TIMEOUT_MS,
  DB_READ_TIMEOUT_MS,
  keyState,
  onServer,
  readSendSwitch,
  sendFenceOpen,
  inngestEventKey,
  launchSecretsPresent,
  creditPullLiveAllowed,
  probeTwilio,
  probeResend,
  probeCommas,
  vendorKeyRead,
  checkoutKeyRead
} from "./gap-keys.mjs";
import { checkoutConfig, CHECKOUT_API_KEY_ENVS } from "../../payments/commas-api.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

// Fake values with the real shape. Never a real key. Each is unique so a test can
// look for it in the output and prove a value never leaks.
const SECRET = (name) => `fake-${name.toLowerCase()}-value-9f3c1d2e7a`;

function goodEnv(extra = {}) {
  const env = {
    NETLIFY: "true",
    MESSAGING_DRY_RUN: "0",
    ADAPTERS_DRY_RUN: "0",
    CRS_ALLOW_LIVE: "1",
    CRS_API_HOST: "mware.crscreditapi.com"
  };
  for (const name of [...INNGEST_KEYS, ...CRS_LOGIN_KEYS, ...LAUNCH_SECRETS.map((s) => s.name)]) {
    env[name] = SECRET(name);
  }
  env.RESEND_FROM = "Fundhub <noreply@fundhub.ai>";
  env.TWILIO_SEND_FROM = "+15555550100";
  return { ...env, ...extra };
}

function without(env, ...names) {
  const out = { ...env };
  for (const n of names) delete out[n];
  return out;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The answers the vendors really gave when this was measured (2026-10-09).
const COMMAS_OK = () => json(200, { status: "success", message: "ok", data: { transactions: [], pagination: { current_page: 1, has_more: false } }, request_id: "r" });
const COMMAS_DEAD = () => json(401, { status: "error", message: "Invalid API key or unauthorized user context" });

// A fake web client. It records every call.
function fakeFetch(answers = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: String((init && init.method) || "GET").toUpperCase(),
      headers: (init && init.headers) || {},
      redirect: init && init.redirect
    });
    const u = String(url);
    if (u.includes("twilio")) return answers.twilio ? answers.twilio() : json(200, { status: "active" });
    if (u.includes("resend")) return answers.resend ? answers.resend() : json(200, { data: [] });
    if (u.includes("fanbasis")) return answers.commas ? answers.commas() : COMMAS_OK();
    throw new Error(`unexpected url ${u}`);
  };
  impl.calls = calls;
  return impl;
}

// A fake database. It records every query.
function fakeDb(answer = { rows: [{ outbound_enabled: true }] }) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return typeof answer === "function" ? answer(sql, params) : answer;
    }
  };
}
const dbOn = () => fakeDb({ rows: [{ outbound_enabled: true }] });
const dbOff = () => fakeDb({ rows: [{ outbound_enabled: false }] });
const dbNoRow = () => fakeDb({ rows: [] });
const dbBroken = () => fakeDb(() => { throw new Error("connection refused"); });

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

// One whole lane run, with a good database and a good web client unless told otherwise.
function lane(env, extra = {}) {
  return gapChecks({ env, db: dbOn(), orgId: ORG, fetchImpl: fakeFetch(), ...extra });
}

// ── Shape ─────────────────────────────────────────────────────────────────

test("gapChecks returns the six planned rows with unique ids, valid statuses and a fix on every FAIL", async () => {
  const rows = await lane(goodEnv());
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  assert.equal(CHECK_IDS.length, 6);
  assert.equal(new Set(rows.map((r) => r.id)).size, 6);
  for (const r of rows) {
    assert.ok(["PASS", "FAIL", "skip"].includes(r.status), r.id);
    assert.ok(typeof r.detail === "string" && r.detail.length > 0, r.id);
  }
  const bad = await gapChecks({ env: {}, fetchImpl: fakeFetch() });
  assert.equal(bad.length, 6);
  const broken = await lane(goodEnv({ MESSAGING_DRY_RUN: "1", INNGEST_EVENT_KEY: "" }), {
    db: dbOff(),
    fetchImpl: fakeFetch({ commas: COMMAS_DEAD })
  });
  const reds = broken.filter((x) => x.status === "FAIL");
  assert.ok(reds.length >= 3);
  for (const r of reds) {
    assert.ok(r.suggestedFix && r.suggestedFix.length > 20, `${r.id} needs a fix line`);
  }
});

test("a good live setup is six PASS", async () => {
  const rows = await lane(goodEnv());
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
});

test("no context at all is six skip rows, never a throw and never a PASS", async () => {
  for (const ctx of [undefined, null, {}, { env: null }]) {
    const rows = await gapChecks(ctx);
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.status === "skip"), JSON.stringify(rows.map((r) => r.status)));
  }
});

test("check ids are not used by any other lane", () => {
  const others = fs.readdirSync(HERE).filter((f) => /^(gap|slice)-.+\.mjs$/.test(f) && f !== "gap-keys.mjs" && !f.endsWith(".test.mjs"));
  for (const file of others) {
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of CHECK_IDS) assert.ok(!src.includes(`"${id}"`), `${id} is also in ${file}`);
  }
});

test("the lane reads no repo file at run time, sends nothing, and writes nothing", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-keys.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  assert.ok(!/from\s+["']node:fs/.test(code) && !/readFile/.test(code), "no file reads");
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(code), "GET only");
  assert.ok(!/process\.env/.test(code), "settings come from ctx.env only");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|TRUNCATE|ALTER|DROP)\b/.test(code), "no write or transaction words in the code");
  assert.ok(!/\bSET\s+(LOCAL|SESSION|ROLE)\b/i.test(code), "no SET on the shared pool");
});

test("the only database read is one SELECT of the company send switch, with the org as its only parameter", async () => {
  const db = dbOn();
  await lane(goodEnv(), { db });
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /^SELECT outbound_enabled FROM messaging_settings WHERE org_id = \$1::uuid LIMIT 1$/);
  assert.deepEqual(db.queries[0].params, [ORG]);
});

// ── Helpers ───────────────────────────────────────────────────────────────

test("keyState: set, empty, blank and a row of asterisks", () => {
  assert.equal(keyState({ A: "real" }, "A"), "ok");
  assert.equal(keyState({}, "A"), "empty");
  assert.equal(keyState({ A: "   " }, "A"), "empty");
  assert.equal(keyState({ A: "****************f377" }, "A"), "mask");
  assert.equal(keyState({ A: "***" }, "A"), "ok", "three asterisks is not the Netlify placeholder");
});

test("onServer: Netlify or Lambda markers, not a laptop", () => {
  assert.equal(onServer({ NETLIFY: "true" }), true);
  assert.equal(onServer({ AWS_LAMBDA_FUNCTION_NAME: "api" }), true);
  assert.equal(onServer({ LAMBDA_TASK_ROOT: "/var/task" }), true);
  assert.equal(onServer({}), false);
  assert.equal(onServer(null), false);
});

// ── keys:send-fence-open ──────────────────────────────────────────────────

const fence = (env, db = dbOn()) => sendFenceOpen({ env, db, orgId: ORG });

test("send-fence-open: PASS when both flags are an explicit off value and the company switch is on", async () => {
  for (const off of ["0", "false", "no", "off", " OFF "]) {
    const r = await fence(goodEnv({ MESSAGING_DRY_RUN: off, ADAPTERS_DRY_RUN: off }));
    assert.equal(r.status, "PASS", off);
  }
});

test("send-fence-open: the PASS names all three locks and does not promise delivery", async () => {
  const r = await fence(goodEnv());
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /All three locks/);
  assert.match(r.detail, /MESSAGING_DRY_RUN/);
  assert.match(r.detail, /ADAPTERS_DRY_RUN/);
  assert.match(r.detail, /company send switch in the CRM is on/);
  assert.match(r.detail, /compliance gate still judge each message/);
  assert.doesNotMatch(r.detail, /can leave/);
});

test("send-fence-open: FAIL when the customer message lock is on, unset, empty or odd", async () => {
  for (const v of ["1", "true", "on", "", "maybe", undefined]) {
    const env = goodEnv({ MESSAGING_DRY_RUN: v });
    if (v === undefined) delete env.MESSAGING_DRY_RUN;
    const r = await fence(env);
    assert.equal(r.status, "FAIL", String(v));
    assert.match(r.detail, /MESSAGING_DRY_RUN/);
    assert.match(r.detail, /text and email to a customer/);
    assert.doesNotMatch(r.detail, /ADAPTERS_DRY_RUN/, "the other lock is open, so it is not named");
    assert.doesNotMatch(r.detail, /send switch/, "the company switch is on, so it is not named");
  }
});

test("send-fence-open: FAIL when only the outside-service lock holds, and it says so", async () => {
  const r = await fence(goodEnv({ ADAPTERS_DRY_RUN: "1" }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /ADAPTERS_DRY_RUN/);
  assert.match(r.detail, /credit pull/);
  assert.doesNotMatch(r.detail, /MESSAGING_DRY_RUN/);
});

test("send-fence-open: both locks closed names both", async () => {
  const r = await fence(without(goodEnv(), "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN"));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /MESSAGING_DRY_RUN is not set/);
  assert.match(r.detail, /ADAPTERS_DRY_RUN is not set/);
});

test("send-fence-open: an odd value is never echoed back", async () => {
  const r = await fence(goodEnv({ MESSAGING_DRY_RUN: "paste-of-some-secret-123" }));
  assert.equal(r.status, "FAIL");
  assert.doesNotMatch(JSON.stringify(r), /paste-of-some-secret-123/);
});

test("send-fence-open: a laptop copy of the settings is skip, even when it says held", async () => {
  const laptop = without(goodEnv({ MESSAGING_DRY_RUN: "1" }), "NETLIFY");
  const r = await fence(laptop);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /not the live server/);
  assert.match(r.detail, /company send switch in the CRM is on/, "what could be read is still said");
});

test("send-fence-open: FAIL when the company send switch is off, and only the switch is named", async () => {
  const r = await fence(goodEnv(), dbOff());
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /company send switch in the CRM/);
  assert.match(r.detail, /is off/);
  assert.match(r.detail, /text and email to a customer waits in the queue/);
  assert.doesNotMatch(r.detail, /MESSAGING_DRY_RUN|ADAPTERS_DRY_RUN/, "both server settings are open, so they are not named");
  assert.match(r.suggestedFix, /ops-admin\.html/);
  assert.match(r.suggestedFix, /Turn sending on/);
  assert.doesNotMatch(r.suggestedFix, /Netlify/, "the fix for the switch is the CRM button, not a server setting");
});

test("send-fence-open: a null or empty switch value counts as off, the way the sender reads it", async () => {
  for (const v of [null, false, 0, ""]) {
    const r = await fence(goodEnv(), fakeDb({ rows: [{ outbound_enabled: v }] }));
    assert.equal(r.status, "FAIL", String(v));
  }
});

test("send-fence-open: the switch off and a server lock closed name both causes and give both fixes once", async () => {
  const r = await fence(goodEnv({ ADAPTERS_DRY_RUN: "1" }), dbOff());
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /ADAPTERS_DRY_RUN/);
  assert.match(r.detail, /company send switch/);
  assert.match(r.suggestedFix, /Netlify/);
  assert.match(r.suggestedFix, /ops-admin\.html/);
  assert.equal(r.suggestedFix.match(/Chris fixes reds/g).length, 1, "the closing line is said once");
});

test("send-fence-open: the switch off is still a FAIL on a laptop copy, because the database is the real one", async () => {
  const r = await fence(without(goodEnv(), "NETLIFY"), dbOff());
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /company send switch/);
  assert.match(r.detail, /not the live server/, "it also says the server settings were not read");
});

test("send-fence-open: no switch row means the sender's default, which is on", async () => {
  const r = await fence(goodEnv(), dbNoRow());
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /no send-switch row/);
  assert.match(r.detail, /treats as on/);
});

test("send-fence-open: a switch that could not be read is skip, never PASS", async () => {
  for (const [label, args] of [
    ["database error", { db: dbBroken(), orgId: ORG }],
    ["no database", { db: null, orgId: ORG }],
    ["no org", { db: dbOn(), orgId: null }],
    ["no row list", { db: fakeDb({}), orgId: ORG }]
  ]) {
    const r = await sendFenceOpen({ env: goodEnv(), ...args });
    assert.equal(r.status, "skip", label);
    assert.match(r.detail, /send switch/, label);
    assert.match(r.detail, /Both server settings .* are set to an off value/, `${label}: what was read is still said`);
  }
  const err = await sendFenceOpen({ env: goodEnv(), db: dbBroken(), orgId: ORG });
  assert.match(err.detail, /connection refused/);
});

test("send-fence-open: a closed server lock is still FAIL when the switch could not be read", async () => {
  const r = await sendFenceOpen({ env: goodEnv({ MESSAGING_DRY_RUN: "1" }), db: dbBroken(), orgId: ORG });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /MESSAGING_DRY_RUN/);
  assert.match(r.detail, /could not be read/);
});

test("send-fence-open: a database that never answers is skip inside the time limit", async () => {
  const hang = { query: () => new Promise(() => {}) };
  const t0 = Date.now();
  const r = await sendFenceOpen({ env: goodEnv(), db: hang, orgId: ORG, dbTimeoutMs: 40 });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /did not answer/);
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(DB_READ_TIMEOUT_MS < 20000, "the switch read stays under the 20 s lane limit");
  // The switch read runs first, then the three vendor reads side by side. Worst case is the two added together.
  assert.ok(DB_READ_TIMEOUT_MS + PROBE_TIMEOUT_MS + 500 + 500 < 20000, "database read plus the vendor reads stay under 20 s");
});

test("readSendSwitch: on, off, missing and unread", async () => {
  assert.deepEqual(await readSendSwitch(dbOn(), ORG), { state: "on" });
  assert.deepEqual(await readSendSwitch(dbOff(), ORG), { state: "off" });
  assert.deepEqual(await readSendSwitch(dbNoRow(), ORG), { state: "missing" });
  assert.equal((await readSendSwitch(dbBroken(), ORG)).state, "unread");
  assert.equal((await readSendSwitch(null, ORG)).state, "unread");
  assert.equal((await readSendSwitch(dbOn(), "")).state, "unread");
});

// ── keys:inngest-event-key ────────────────────────────────────────────────

test("inngest-event-key: PASS with both keys real", () => {
  assert.equal(inngestEventKey(goodEnv()).status, "PASS");
});

test("inngest-event-key: FAIL when the event key is unset, empty or a row of asterisks", () => {
  for (const v of [undefined, "", "   ", "****************abcd"]) {
    const env = goodEnv({ INNGEST_EVENT_KEY: v });
    if (v === undefined) delete env.INNGEST_EVENT_KEY;
    const r = inngestEventKey(env);
    assert.equal(r.status, "FAIL", String(v));
    assert.match(r.detail, /INNGEST_EVENT_KEY/);
    assert.match(r.detail, /never starts/);
    assert.doesNotMatch(r.detail, /INNGEST_SIGNING_KEY/);
  }
});

test("inngest-event-key: FAIL when the signing key is a mask", () => {
  const r = inngestEventKey(goodEnv({ INNGEST_SIGNING_KEY: "****************wxyz" }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /INNGEST_SIGNING_KEY/);
  assert.doesNotMatch(r.detail, /INNGEST_EVENT_KEY/);
});

test("inngest-event-key: names only, never a value; laptop is skip", () => {
  const r = inngestEventKey(goodEnv({ INNGEST_EVENT_KEY: "" }));
  assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET("INNGEST_SIGNING_KEY")));
  assert.equal(inngestEventKey(without(goodEnv({ INNGEST_EVENT_KEY: "" }), "NETLIFY")).status, "skip");
});

// ── keys:launch-secrets-present ───────────────────────────────────────────

const SET_ONLY = LAUNCH_SECRETS.filter((s) => s.setOnly).map((s) => s.name);

test("launch-secrets-present: PASS with every launch key real", () => {
  const r = launchSecretsPresent(goodEnv());
  assert.equal(r.status, "PASS");
  assert.match(r.detail, new RegExp(`All ${LAUNCH_SECRETS.length} launch keys`));
});

test("launch-secrets-present: each key on the list turns it red when empty, and when a mask (set-only keys only when empty)", () => {
  for (const { name, setOnly } of LAUNCH_SECRETS) {
    for (const bad of [undefined, "", "****************1234"]) {
      const env = goodEnv({ [name]: bad });
      if (bad === undefined) delete env[name];
      const r = launchSecretsPresent(env);
      if (setOnly && bad === "****************1234") {
        assert.equal(r.status, "PASS", `${name} is set-only, so a mask is not red`);
        continue;
      }
      assert.equal(r.status, "FAIL", `${name} = ${String(bad)}`);
      assert.match(r.detail, new RegExp(name));
      assert.equal(r.detail.match(/[A-Z][A-Z0-9_]{6,}(?= is )/g).length, 1, "only the broken key is named");
    }
  }
});

test("launch-secrets-present: several broken keys are all named, and no value leaks", () => {
  const env = goodEnv({ COMMAS_WEBHOOK_SECRET: "", RESEND_API_KEY: "****************abcd" });
  const r = launchSecretsPresent(env);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 launch keys/);
  assert.match(r.detail, /COMMAS_WEBHOOK_SECRET/);
  assert.match(r.detail, /RESEND_API_KEY/);
  for (const { name } of LAUNCH_SECRETS) {
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET(name)), `${name} value leaked`);
  }
});

test("launch-secrets-present: keys that are not launch keys do not turn it red", () => {
  // LENDFLOW_WEBHOOK_SECRET left this list on 2026-10-10: the W5 brief made it a launch key.
  const env = without(goodEnv(), "LENDFLOW_API_KEY", "META_CAPI_ACCESS_TOKEN", "META_PIXEL_ID", "UNSUBSCRIBE_TOKEN_SECRET");
  assert.equal(launchSecretsPresent(env).status, "PASS");
});

test("launch-secrets-present: the list is exactly the keys the launch needs (pinned by hand, not read from the module)", () => {
  assert.deepEqual(LAUNCH_SECRETS.map((s) => s.name).sort(), [
    "BLAND_WEBHOOK_SECRET",
    "CLICKFUNNELS_WEBHOOK_SECRET",
    "COMMAS_WEBHOOK_SECRET",
    "CORTANA_COMMAS_API_KEY",
    "FANBASIS_CHECKOUT_API_KEY",
    "FINANCE_OS_SETUP_FEE_CENTS",
    "INQUIRY_REMOVAL_WEBHOOK_SECRET",
    "LENDFLOW_WEBHOOK_SECRET",
    "MERCHANT_SECRET_ENC_KEY",
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
    "PLAID_TOKEN_ENC_KEY",
    "POSTGRID_API_KEY",
    "POSTGRID_WEBHOOK_SECRET",
    "RESEND_API_KEY",
    "RESEND_FROM",
    "RESEND_WEBHOOK_SECRET",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_SEND_ACCOUNT_SID",
    "TWILIO_SEND_AUTH_TOKEN",
    "TWILIO_SEND_FROM"
  ]);
  assert.deepEqual(SET_ONLY, ["FANBASIS_CHECKOUT_API_KEY"], "only the dead checkout name is set-only");
  for (const name of ["CORTANA_COMMAS_API_KEY", "FANBASIS_CHECKOUT_API_KEY", "COMMAS_WEBHOOK_SECRET", "TWILIO_SEND_FROM"]) {
    const r = launchSecretsPresent(goodEnv({ [name]: "" }));
    assert.equal(r.status, "FAIL", name);
    assert.match(r.detail, new RegExp(name));
  }
});

test("launch-secrets-present: the checkout key is CORTANA_COMMAS_API_KEY, the one the mint tries first", () => {
  // The old list watched FANBASIS_CHECKOUT_API_KEY, the dead one. Removing the working key stayed green.
  const gone = launchSecretsPresent(without(goodEnv(), "CORTANA_COMMAS_API_KEY"));
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /CORTANA_COMMAS_API_KEY is not set/);
  assert.match(gone.detail, /\$297 card page/);
  assert.doesNotMatch(gone.detail, /FANBASIS/);

  const empty = launchSecretsPresent(goodEnv({ CORTANA_COMMAS_API_KEY: "   " }));
  assert.equal(empty.status, "FAIL");

  const mask = launchSecretsPresent(goodEnv({ CORTANA_COMMAS_API_KEY: "****************abcd" }));
  assert.equal(mask.status, "FAIL");
  assert.match(mask.detail, /CORTANA_COMMAS_API_KEY is a row of asterisks/);
  assert.doesNotMatch(mask.detail, /FANBASIS/);
});

test("launch-secrets-present: the dead FANBASIS value as a row of asterisks is not red, but empty is", () => {
  // The stored FANBASIS value is the dead one and the owner law keeps it in place. The mint does not use it
  // first. The closer deck, payment links and partner add-ons only refuse when it is empty.
  assert.equal(launchSecretsPresent(goodEnv({ FANBASIS_CHECKOUT_API_KEY: "****************f377" })).status, "PASS");
  const empty = launchSecretsPresent(goodEnv({ FANBASIS_CHECKOUT_API_KEY: "" }));
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /FANBASIS_CHECKOUT_API_KEY is not set/);
  assert.match(empty.detail, /closer deck and payment links/);
  assert.doesNotMatch(empty.detail, /CORTANA/);
});

test("launch-secrets-present: every name the mint reads is on the list, and the first one is watched strictly", () => {
  const listed = new Map(LAUNCH_SECRETS.map((s) => [s.name, s]));
  for (const name of CHECKOUT_API_KEY_ENVS) assert.ok(listed.has(name), `${name} is read by the mint but is not on the list`);
  assert.ok(!listed.get(CHECKOUT_API_KEY_ENVS[0]).setOnly, "the key the mint tries first must not be set-only");
  assert.equal(CHECKOUT_API_KEY_ENVS[0], "CORTANA_COMMAS_API_KEY");
});

test("launch-secrets-present: the fix sends Chris to the vendor, not to the snapshot file of asterisks", () => {
  const r = launchSecretsPresent(goodEnv({ COMMAS_WEBHOOK_SECRET: "" }));
  assert.equal(r.status, "FAIL");
  assert.match(r.suggestedFix, /vendor's own dashboard/);
  assert.match(r.suggestedFix, /Do not copy it from credentials\/env\.full\.snapshot/);
  assert.doesNotMatch(r.suggestedFix, /full values live in/);
  assert.match(r.suggestedFix, /Never delete the old value first/);
});

test("launch-secrets-present: no fix line in the lane says a full value lives in the snapshot file", async () => {
  const rows = await lane(goodEnv({
    MESSAGING_DRY_RUN: "1", INNGEST_EVENT_KEY: "", COMMAS_WEBHOOK_SECRET: "", CRS_ALLOW_LIVE: "0"
  }), { fetchImpl: fakeFetch({ twilio: () => json(401, {}), commas: COMMAS_DEAD }) });
  const fixes = rows.filter((r) => r.status === "FAIL").map((r) => r.suggestedFix);
  assert.equal(fixes.length, 6);
  for (const fix of fixes) assert.doesNotMatch(fix, /values? (live|lives) in credentials/);
});

test("launch-secrets-present: every webhook secret the router reads is on the list, with none left off", () => {
  // Test-time read only. The lane itself reads no repo file.
  const router = fs.readFileSync(path.join(HERE, "../../http/router.mjs"), "utf8");
  const named = [...router.matchAll(/\benv:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(named.length >= 5, "found the router's secret names");
  const listed = new Set(LAUNCH_SECRETS.map((s) => s.name));
  // Lendflow was the one left off until 2026-10-10; the W5 brief put its secret on the list.
  for (const name of named) {
    assert.ok(listed.has(name), `${name} is read by the router but is not a launch key on the list`);
  }
  // The receipt keys are read through env.<NAME> in the router rather than a table entry.
  for (const name of ["RESEND_WEBHOOK_SECRET", "TWILIO_AUTH_TOKEN"]) {
    assert.ok(router.includes(`env.${name}`), `${name} is no longer read by the router; the list would watch a dead key`);
    assert.ok(listed.has(name), `${name} is read by the router but is not on the list`);
  }
});

// ── the eight keys the W5 brief added (2026-10-10) ────────────────────────

const W5_KEYS = Object.freeze([
  ["PLAID_CLIENT_ID", "../../banking/plaid.mjs"],
  ["PLAID_SECRET", "../../banking/plaid.mjs"],
  ["PLAID_TOKEN_ENC_KEY", "../../banking/plaid.mjs"],
  ["MERCHANT_SECRET_ENC_KEY", "../../merchant/secrets.mjs"],
  ["FINANCE_OS_SETUP_FEE_CENTS", "../../finance/money-setup.mjs"],
  ["LENDFLOW_WEBHOOK_SECRET", "../../http/router.mjs"],
  ["RESEND_WEBHOOK_SECRET", "../../http/router.mjs"],
  ["TWILIO_AUTH_TOKEN", "../../http/router.mjs"]
]);

test("W5 keys: each of the eight is on the list, strictly watched, and read by the code that needs it", () => {
  const listed = new Map(LAUNCH_SECRETS.map((s) => [s.name, s]));
  for (const [name, file] of W5_KEYS) {
    assert.ok(listed.has(name), `${name} is not on the list`);
    assert.ok(!listed.get(name).setOnly, `${name} must be strict: a mask is a break`);
    // Test-time read only. A key the code no longer reads would be watched for nothing.
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    assert.ok(src.includes(name), `${name} is not read in ${file}`);
  }
  assert.equal(W5_KEYS.length, 8);
});

test("W5 keys: PASS when all eight are real, and each one alone turns the row red by name", () => {
  assert.equal(launchSecretsPresent(goodEnv()).status, "PASS");
  for (const [name] of W5_KEYS) {
    for (const bad of [undefined, "", "   ", "****************f377"]) {
      const env = goodEnv({ [name]: bad });
      if (bad === undefined) delete env[name];
      const r = launchSecretsPresent(env);
      assert.equal(r.status, "FAIL", `${name} = ${JSON.stringify(bad)}`);
      assert.match(r.detail, new RegExp(`${name} (is not set|is a row of asterisks)`));
      assert.match(r.detail, /1 launch key/);
    }
  }
});

test("W5 keys: the receipt keys say what stops when they are empty, and no value leaks", () => {
  const gone = launchSecretsPresent(without(goodEnv(), "RESEND_WEBHOOK_SECRET", "TWILIO_AUTH_TOKEN"));
  assert.equal(gone.status, "FAIL");
  assert.match(gone.detail, /RESEND_WEBHOOK_SECRET is not set \(email delivery receipts\)/);
  assert.match(gone.detail, /TWILIO_AUTH_TOKEN is not set \(inbound texts and text delivery receipts\)/);
  assert.match(gone.detail, /2 launch keys/);
  for (const [name] of W5_KEYS) {
    assert.doesNotMatch(JSON.stringify(gone), new RegExp(SECRET(name)), `${name} value leaked`);
  }
});

test("W5 keys: a laptop run is still a skip, so the eight cannot go red on a masked laptop copy", () => {
  const env = without(goodEnv({ PLAID_SECRET: "****************abcd" }), "NETLIFY");
  assert.equal(launchSecretsPresent(env).status, "skip");
});

test("launch-secrets-present: laptop and missing env are skip", () => {
  assert.equal(launchSecretsPresent(without(goodEnv({ COMMAS_WEBHOOK_SECRET: "" }), "NETLIFY")).status, "skip");
  assert.equal(launchSecretsPresent(null).status, "skip");
});

// ── keys:credit-pull-live-allowed ─────────────────────────────────────────

test("credit-pull-live-allowed: PASS on the production host with allow-live on and a login", () => {
  assert.equal(creditPullLiveAllowed(goodEnv()).status, "PASS");
  for (const on of ["1", "true", "YES", " on "]) {
    assert.equal(creditPullLiveAllowed(goodEnv({ CRS_ALLOW_LIVE: on })).status, "PASS", on);
  }
  assert.equal(creditPullLiveAllowed(goodEnv({ CRS_API_HOST: "https://MWARE.crscreditapi.com:443/api" })).status, "PASS", "a pasted URL is the same host");
});

test("credit-pull-live-allowed: FAIL when allow-live is not an explicit on value", () => {
  for (const v of [undefined, "", "0", "false", "maybe"]) {
    const env = goodEnv({ CRS_ALLOW_LIVE: v });
    if (v === undefined) delete env.CRS_ALLOW_LIVE;
    const r = creditPullLiveAllowed(env);
    assert.equal(r.status, "FAIL", String(v));
    assert.match(r.detail, /CRS_ALLOW_LIVE/);
    assert.match(r.detail, /paying customer would not get a real credit pull/);
  }
});

test("credit-pull-live-allowed: FAIL on the vendor's test host, an unknown host, or no host", () => {
  const sandbox = creditPullLiveAllowed(goodEnv({ CRS_API_HOST: "api-sandbox.stitchcredit.com" }));
  assert.equal(sandbox.status, "FAIL");
  assert.match(sandbox.detail, /made-up people/);
  const other = creditPullLiveAllowed(goodEnv({ CRS_API_HOST: "example.com" }));
  assert.equal(other.status, "FAIL");
  assert.match(other.detail, /not a host the credit pull accepts/);
  const none = creditPullLiveAllowed(without(goodEnv(), "CRS_API_HOST"));
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /CRS_API_HOST is not set/);
});

test("credit-pull-live-allowed: FAIL when the login is empty or a mask, and no value leaks", () => {
  for (const name of CRS_LOGIN_KEYS) {
    for (const bad of ["", "****************wxyz"]) {
      const r = creditPullLiveAllowed(goodEnv({ [name]: bad }));
      assert.equal(r.status, "FAIL", `${name} ${bad}`);
      assert.match(r.detail, new RegExp(name));
    }
  }
  const r = creditPullLiveAllowed(goodEnv({ CRS_ALLOW_LIVE: "0" }));
  for (const name of CRS_LOGIN_KEYS) assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET(name)));
});

test("credit-pull-live-allowed: every broken setting is named together", () => {
  const r = creditPullLiveAllowed({ NETLIFY: "true", CRS_API_HOST: "api-sandbox.stitchcredit.com", CRS_API_PASSWORD: "****************abcd" });
  assert.equal(r.status, "FAIL");
  for (const word of ["CRS_ALLOW_LIVE", "test host", "CRS_API_USERNAME", "CRS_API_PASSWORD"]) assert.match(r.detail, new RegExp(word));
});

test("credit-pull-live-allowed: a laptop copy is skip", () => {
  assert.equal(creditPullLiveAllowed(without(goodEnv({ CRS_ALLOW_LIVE: "0" }), "NETLIFY")).status, "skip");
});

// ── keys:vendor-key-read ──────────────────────────────────────────────────

test("vendor-key-read: PASS when both vendors take the key; only GET leaves", async () => {
  const f = fakeFetch();
  const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
  assert.equal(r.status, "PASS");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every((c) => c.method === "GET"), "GET only");
  assert.ok(f.calls.some((c) => /api\.twilio\.com\/2010-04-01\/Accounts\/.+\.json$/.test(c.url)));
  assert.ok(f.calls.some((c) => c.url === "https://api.resend.com/domains"));
  assert.ok(!f.calls.some((c) => /Messages|emails/.test(c.url)), "nothing that sends");
});

test("vendor-key-read: the keys are sent as the vendors expect and never printed", async () => {
  const f = fakeFetch();
  const env = goodEnv();
  const r = await vendorKeyRead({ env, fetchImpl: f });
  const tw = f.calls.find((c) => c.url.includes("twilio"));
  const rs = f.calls.find((c) => c.url.includes("resend"));
  assert.equal(tw.headers.Authorization, `Basic ${Buffer.from(`${env.TWILIO_SEND_ACCOUNT_SID}:${env.TWILIO_SEND_AUTH_TOKEN}`).toString("base64")}`);
  assert.equal(rs.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
  const out = JSON.stringify(r);
  for (const name of ["TWILIO_SEND_ACCOUNT_SID", "TWILIO_SEND_AUTH_TOKEN", "RESEND_API_KEY"]) {
    assert.doesNotMatch(out, new RegExp(SECRET(name)), `${name} leaked`);
  }
});

test("vendor-key-read: FAIL when Twilio answers 401 or 403", async () => {
  for (const code of [401, 403]) {
    const f = fakeFetch({ twilio: () => json(code, { code: 20003, message: "auth account ACxxx does not exist", status: code }) });
    const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
    assert.equal(r.status, "FAIL", String(code));
    assert.match(r.detail, new RegExp(`Twilio refused our text key \\(HTTP ${code}, Twilio code 20003\\)`));
    assert.doesNotMatch(r.detail, /does not exist/, "the vendor's message is not copied");
  }
});

test("vendor-key-read: FAIL when Twilio takes the key but the account is suspended or closed", async () => {
  for (const status of ["suspended", "closed", "Suspended"]) {
    const f = fakeFetch({ twilio: () => json(200, { status, auth_token: "SHOULD-NEVER-APPEAR" }) });
    const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
    assert.equal(r.status, "FAIL", status);
    assert.match(r.detail, /account is (suspended|closed)/);
    assert.doesNotMatch(JSON.stringify(r), /SHOULD-NEVER-APPEAR/, "the Twilio account answer carries a token; it is never copied");
  }
});

test("vendor-key-read: FAIL when Resend says the key is invalid (HTTP 400, as measured), 401 or 403", async () => {
  const answers = [
    [400, { statusCode: 400, message: "API key is invalid", name: "validation_error" }, /invalid \(HTTP 400\)/],
    [401, { statusCode: 401, message: "Missing API Key", name: "missing_api_key" }, /HTTP 401, missing_api_key/],
    [403, { statusCode: 403, message: "key not active", name: "restricted_api_key" }, /HTTP 403, restricted_api_key/],
    [403, { statusCode: 403, message: "suspended", name: "suspended_api_key" }, /HTTP 403, suspended_api_key/]
  ];
  for (const [code, body, pattern] of answers) {
    const f = fakeFetch({ resend: () => json(code, body) });
    const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
    assert.equal(r.status, "FAIL", `${code} ${body.name}`);
    assert.match(r.detail, pattern);
  }
});

test("vendor-key-read: a send-only Resend key (401 restricted_api_key) is a good key", async () => {
  const f = fakeFetch({ resend: () => json(401, { statusCode: 401, message: "This API key is restricted to only send emails", name: "restricted_api_key" }) });
  const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /send-only key/);
});

test("vendor-key-read: a masked key is skip and the vendor is not called", async () => {
  const f = fakeFetch();
  const r = await vendorKeyRead({
    env: goodEnv({ TWILIO_SEND_AUTH_TOKEN: "****************f377", RESEND_API_KEY: "****************abcd" }),
    fetchImpl: f
  });
  assert.equal(r.status, "skip");
  assert.equal(f.calls.length, 0);
  assert.match(r.detail, /TWILIO_SEND_AUTH_TOKEN is a row of asterisks/);
  assert.match(r.detail, /RESEND_API_KEY is a row of asterisks/);
});

test("vendor-key-read: no key at all is skip", async () => {
  const r = await vendorKeyRead({ env: { NETLIFY: "true" }, fetchImpl: fakeFetch() });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /not set here/);
});

test("vendor-key-read: one vendor good and one not asked is skip, not PASS", async () => {
  const f = fakeFetch();
  const r = await vendorKeyRead({ env: goodEnv({ RESEND_API_KEY: "****************abcd" }), fetchImpl: f });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /Twilio took the text key/);
  assert.match(r.detail, /Resend was not asked/);
});

test("vendor-key-read: a refusal wins over a vendor that was not asked", async () => {
  const f = fakeFetch({ twilio: () => json(401, { code: 20003 }) });
  const r = await vendorKeyRead({ env: goodEnv({ RESEND_API_KEY: "****************abcd" }), fetchImpl: f });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /Twilio refused/);
  assert.match(r.detail, /Resend was not asked/);
});

test("vendor-key-read: a vendor outage or a network error is skip, never a break and never PASS", async () => {
  const down = await vendorKeyRead({
    env: goodEnv(),
    fetchImpl: fakeFetch({ twilio: () => json(503, {}), resend: () => json(500, {}) })
  });
  assert.equal(down.status, "skip");
  assert.match(down.detail, /Twilio answered HTTP 503/);
  assert.match(down.detail, /Resend answered HTTP 500/);

  const err = async () => { throw new Error("socket hang up"); };
  const net = await vendorKeyRead({ env: goodEnv(), fetchImpl: err });
  assert.equal(net.status, "skip");
  assert.match(net.detail, /could not be reached: socket hang up/);

  const odd = await vendorKeyRead({ env: goodEnv(), fetchImpl: fakeFetch({ resend: () => json(400, { message: "something else" }) }) });
  assert.equal(odd.status, "skip", "a 400 that is not 'API key is invalid' is not read as a dead key");
});

test("vendor-key-read: a vendor that never answers is skip inside the time limit", async () => {
  const hang = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: hang, timeoutMs: 40 });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /did not answer/);
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(PROBE_TIMEOUT_MS * 2 < 20000, "the vendor reads side by side stay under the 20 s lane limit");
});

test("vendor-key-read: no web client is skip", async () => {
  const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: null });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /No web client/);
});

test("vendor-key-read: base urls from the settings are honoured, and a non-https one is refused", async () => {
  const f = fakeFetch();
  const env = goodEnv({ TWILIO_SEND_BASE_URL: "https://twilio.test.local/", RESEND_BASE_URL: "https://resend.test.local" });
  const r = await vendorKeyRead({ env, fetchImpl: f });
  assert.equal(r.status, "PASS");
  assert.ok(f.calls.some((c) => c.url.startsWith("https://twilio.test.local/2010-04-01/Accounts/")));
  assert.ok(f.calls.some((c) => c.url === "https://resend.test.local/domains"));

  const g = fakeFetch();
  const plain = await vendorKeyRead({ env: goodEnv({ TWILIO_SEND_BASE_URL: "http://twilio.test.local", RESEND_BASE_URL: "ftp://x" }), fetchImpl: g });
  assert.equal(plain.status, "skip");
  assert.equal(g.calls.length, 0, "the key is never sent over a plain address");
});

test("vendor-key-read runs on a laptop too: it asks the vendor about the key it holds", async () => {
  const f = fakeFetch({ twilio: () => json(401, { code: 20003 }) });
  const r = await gapChecks({ env: without(goodEnv(), "NETLIFY"), fetchImpl: f });
  assert.equal(byId(r)["keys:vendor-key-read"].status, "FAIL");
  assert.ok(r.filter((x) => x.id !== "keys:vendor-key-read" && x.id !== "keys:checkout-key-read").every((x) => x.status === "skip"));
});

test("vendor-key-read: a redirect answer is skip, and the key is never sent on", async () => {
  const f = fakeFetch({
    twilio: () => new Response(null, { status: 301, headers: { location: "https://evil.example/steal" } }),
    resend: () => new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } })
  });
  const r = await vendorKeyRead({ env: goodEnv(), fetchImpl: f });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /Twilio answered HTTP 301/);
  assert.match(r.detail, /Resend answered HTTP 307/);
  assert.ok(!f.calls.some((c) => c.url.includes("evil.example")), "no second call is made");
});

test("probeTwilio and probeResend answer for themselves", async () => {
  const t = await probeTwilio({ env: goodEnv(), fetchImpl: fakeFetch() });
  assert.deepEqual([t.vendor, t.status], ["Twilio", "PASS"]);
  const r = await probeResend({ env: goodEnv(), fetchImpl: fakeFetch() });
  assert.deepEqual([r.vendor, r.status], ["Resend", "PASS"]);
});

// ── keys:checkout-key-read ────────────────────────────────────────────────

test("checkout-key-read: PASS when Commas takes the checkout key; one GET for one row, nothing else", async () => {
  const f = fakeFetch();
  const env = goodEnv();
  const r = await checkoutKeyRead({ env, fetchImpl: f });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /Commas took the checkout key \(CORTANA_COMMAS_API_KEY\)/);
  assert.equal(f.calls.length, 1);
  const c = f.calls[0];
  assert.equal(c.method, "GET");
  assert.equal(c.url, "https://www.fanbasis.com/public-api/checkout-sessions/transactions?page=1&per_page=1");
  assert.equal(c.headers["x-api-key"], env.CORTANA_COMMAS_API_KEY);
  assert.equal(c.redirect, "manual");
  assert.doesNotMatch(JSON.stringify(r), new RegExp(env.CORTANA_COMMAS_API_KEY), "the key is never printed");
});

test("checkout-key-read: it asks about the key the mint would use, CORTANA first and FANBASIS only when CORTANA is empty", async () => {
  for (const env of [
    goodEnv(),
    without(goodEnv(), "CORTANA_COMMAS_API_KEY"),
    goodEnv({ CORTANA_COMMAS_API_KEY: "   " })
  ]) {
    const f = fakeFetch();
    const r = await checkoutKeyRead({ env, fetchImpl: f });
    assert.equal(r.status, "PASS");
    assert.equal(f.calls[0].headers["x-api-key"], checkoutConfig(env).apiKey, "same key as the mint");
  }
  const fb = fakeFetch();
  const r = await checkoutKeyRead({ env: without(goodEnv(), "CORTANA_COMMAS_API_KEY"), fetchImpl: fb });
  assert.match(r.detail, /FANBASIS_CHECKOUT_API_KEY/);
  assert.equal(fb.calls[0].headers["x-api-key"], SECRET("FANBASIS_CHECKOUT_API_KEY"));
});

test("checkout-key-read: FAIL when Commas refuses the key, as the dead key was refused on 2026-09-29", async () => {
  for (const code of [401, 403]) {
    const f = fakeFetch({ commas: () => json(code, { status: "error", message: "Invalid API key or unauthorized user context" }) });
    const r = await checkoutKeyRead({ env: goodEnv(), fetchImpl: f });
    assert.equal(r.status, "FAIL", String(code));
    assert.match(r.detail, new RegExp(`Commas refused the checkout key CORTANA_COMMAS_API_KEY \\(HTTP ${code}\\)`));
    assert.match(r.detail, /No buyer can get a card page/);
    assert.doesNotMatch(r.detail, /unauthorized user context/, "the vendor's message is not copied");
    assert.match(r.suggestedFix, /Account, then API Keys/);
    assert.match(r.suggestedFix, /Never delete the old value first/);
  }
});

test("checkout-key-read: a dead FANBASIS fallback is named when CORTANA is empty", async () => {
  const f = fakeFetch({ commas: COMMAS_DEAD });
  const r = await checkoutKeyRead({ env: without(goodEnv(), "CORTANA_COMMAS_API_KEY"), fetchImpl: f });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /FANBASIS_CHECKOUT_API_KEY/);
});

test("checkout-key-read: a busy, down or odd answer is skip, never a break and never PASS", async () => {
  for (const [label, answer, pattern] of [
    ["too many requests", () => json(429, { success: false, message: "Too many requests. Please try again later." }), /HTTP 429/],
    ["server error", () => json(500, {}), /HTTP 500/],
    ["unavailable", () => json(503, {}), /HTTP 503/],
    ["redirect", () => new Response(null, { status: 301, headers: { location: "https://elsewhere.example/" } }), /HTTP 301/],
    ["200 in a shape we do not know", () => json(200, { hello: "world" }), /shape this check does not know/],
    ["200 that is an error body", () => json(200, { status: "error", message: "x" }), /shape this check does not know/],
    ["200 that is not JSON", () => new Response("<html>maintenance</html>", { status: 200 }), /shape this check does not know/]
  ]) {
    const f = fakeFetch({ commas: answer });
    const r = await checkoutKeyRead({ env: goodEnv(), fetchImpl: f });
    assert.equal(r.status, "skip", label);
    assert.match(r.detail, pattern, label);
    assert.equal(f.calls.length, 1, `${label}: no second call, so a redirect is never followed`);
  }
  const err = async () => { throw new Error("socket hang up"); };
  const net = await checkoutKeyRead({ env: goodEnv(), fetchImpl: err });
  assert.equal(net.status, "skip");
  assert.match(net.detail, /could not be reached: socket hang up/);
});

test("checkout-key-read: no key, a masked key, no web client or a plain address is skip and nothing is sent", async () => {
  const none = fakeFetch();
  const r1 = await checkoutKeyRead({ env: without(goodEnv(), "CORTANA_COMMAS_API_KEY", "FANBASIS_CHECKOUT_API_KEY"), fetchImpl: none });
  assert.equal(r1.status, "skip");
  assert.match(r1.detail, /no checkout key is set here/);

  const masked = fakeFetch();
  const r2 = await checkoutKeyRead({ env: goodEnv({ CORTANA_COMMAS_API_KEY: "****************abcd" }), fetchImpl: masked });
  assert.equal(r2.status, "skip");
  assert.match(r2.detail, /CORTANA_COMMAS_API_KEY is a row of asterisks/);

  const r3 = await checkoutKeyRead({ env: goodEnv(), fetchImpl: null });
  assert.equal(r3.status, "skip");
  assert.match(r3.detail, /No web client/);

  const plain = fakeFetch();
  const r4 = await checkoutKeyRead({ env: goodEnv({ FANBASIS_CHECKOUT_API_BASE: "http://www.fanbasis.com/public-api" }), fetchImpl: plain });
  assert.equal(r4.status, "skip");
  assert.match(r4.detail, /not an https address/);

  assert.equal(none.calls.length + masked.calls.length + plain.calls.length, 0, "the key is never sent in these cases");
  assert.equal((await checkoutKeyRead({ env: null, fetchImpl: fakeFetch() })).status, "skip");
});

test("checkout-key-read: the checkout address from the settings is honoured", async () => {
  const f = fakeFetch();
  const r = await checkoutKeyRead({ env: goodEnv({ FANBASIS_CHECKOUT_API_BASE: "https://qa.fanbasis.test/public-api/" }), fetchImpl: f });
  assert.equal(r.status, "PASS");
  assert.equal(f.calls[0].url, "https://qa.fanbasis.test/public-api/checkout-sessions/transactions?page=1&per_page=1");
});

test("checkout-key-read: a Commas that never answers is skip inside the time limit", async () => {
  const hang = () => new Promise(() => {});
  const t0 = Date.now();
  const r = await checkoutKeyRead({ env: goodEnv(), fetchImpl: hang, timeoutMs: 40 });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /did not answer/);
  assert.ok(Date.now() - t0 < 2000);
});

test("checkout-key-read runs on a laptop too: it asks Commas about the key it holds", async () => {
  const f = fakeFetch({ commas: COMMAS_DEAD });
  const rows = byId(await gapChecks({ env: without(goodEnv(), "NETLIFY"), fetchImpl: f }));
  assert.equal(rows["keys:checkout-key-read"].status, "FAIL");
  assert.equal(rows["keys:vendor-key-read"].status, "PASS");
});

test("probeCommas answers for itself", async () => {
  const c = await probeCommas({ env: goodEnv(), fetchImpl: fakeFetch() });
  assert.deepEqual([c.vendor, c.status], ["Commas", "PASS"]);
});

// ── Credentials leave only to their own vendor, only by GET ───────────────

test("each vendor key goes to its own host only, never follows a redirect, and nothing but GET leaves", async () => {
  const f = fakeFetch();
  const env = goodEnv();
  await lane(env, { fetchImpl: f });
  assert.equal(f.calls.length, 3);
  const hosts = f.calls.map((c) => new URL(c.url).host).sort();
  assert.deepEqual(hosts, ["api.resend.com", "api.twilio.com", "www.fanbasis.com"]);
  assert.ok(f.calls.every((c) => c.method === "GET" && c.redirect === "manual"));
  const secretsOf = {
    "api.twilio.com": [Buffer.from(`${env.TWILIO_SEND_ACCOUNT_SID}:${env.TWILIO_SEND_AUTH_TOKEN}`).toString("base64")],
    "api.resend.com": [env.RESEND_API_KEY],
    "www.fanbasis.com": [env.CORTANA_COMMAS_API_KEY]
  };
  for (const c of f.calls) {
    const host = new URL(c.url).host;
    const sent = JSON.stringify(c.headers) + c.url;
    for (const [otherHost, secrets] of Object.entries(secretsOf)) {
      for (const secret of secrets) {
        assert.equal(sent.includes(secret), otherHost === host, `${host} call ${otherHost === host ? "must" : "must not"} carry the ${otherHost} key`);
      }
    }
  }
});

// ── The whole lane ────────────────────────────────────────────────────────

test("a lane run with several real breaks turns exactly those rows red", async () => {
  const env = goodEnv({
    MESSAGING_DRY_RUN: "1",
    INNGEST_EVENT_KEY: "****************aaaa",
    COMMAS_WEBHOOK_SECRET: "",
    CRS_ALLOW_LIVE: "0"
  });
  const rows = byId(await lane(env, {
    fetchImpl: fakeFetch({
      resend: () => json(400, { message: "API key is invalid", name: "validation_error" }),
      commas: COMMAS_DEAD
    })
  }));
  for (const id of CHECK_IDS) assert.equal(rows[id].status, "FAIL", id);
  const one = byId(await lane(goodEnv({ CRS_ALLOW_LIVE: "0" })));
  assert.equal(one["keys:credit-pull-live-allowed"].status, "FAIL");
  for (const id of CHECK_IDS.filter((x) => x !== "keys:credit-pull-live-allowed")) assert.equal(one[id].status, "PASS", id);
});

test("each single break turns exactly its own row red and no other", async () => {
  const breaks = [
    ["a server lock closed", "keys:send-fence-open", () => ({ env: goodEnv({ MESSAGING_DRY_RUN: "1" }) })],
    ["the company switch off", "keys:send-fence-open", () => ({ env: goodEnv(), db: dbOff() })],
    ["the event key a mask", "keys:inngest-event-key", () => ({ env: goodEnv({ INNGEST_EVENT_KEY: "****************aaaa" }) })],
    ["a webhook secret empty", "keys:launch-secrets-present", () => ({ env: goodEnv({ COMMAS_WEBHOOK_SECRET: "" }) })],
    ["the checkout key removed", "keys:launch-secrets-present", () => ({ env: without(goodEnv(), "CORTANA_COMMAS_API_KEY") })],
    ["the credit host on the test host", "keys:credit-pull-live-allowed", () => ({ env: goodEnv({ CRS_API_HOST: "api-sandbox.stitchcredit.com" }) })],
    ["Twilio refuses", "keys:vendor-key-read", () => ({ env: goodEnv(), fetchImpl: fakeFetch({ twilio: () => json(401, { code: 20003 }) }) })],
    ["Commas refuses", "keys:checkout-key-read", () => ({ env: goodEnv(), fetchImpl: fakeFetch({ commas: COMMAS_DEAD }) })]
  ];
  for (const [label, id, make] of breaks) {
    const { env, ...extra } = make();
    const rows = await lane(env, extra);
    const red = rows.filter((r) => r.status === "FAIL").map((r) => r.id);
    assert.deepEqual(red, [id], label);
  }
});

test("a lane run where every read fails is skip rows and PASS rows only for what was really read", async () => {
  const rows = byId(await gapChecks({
    env: goodEnv(),
    db: dbBroken(),
    orgId: ORG,
    fetchImpl: async () => { throw new Error("offline"); }
  }));
  assert.equal(rows["keys:send-fence-open"].status, "skip");
  assert.equal(rows["keys:vendor-key-read"].status, "skip");
  assert.equal(rows["keys:checkout-key-read"].status, "skip");
  assert.equal(rows["keys:inngest-event-key"].status, "PASS");
});
