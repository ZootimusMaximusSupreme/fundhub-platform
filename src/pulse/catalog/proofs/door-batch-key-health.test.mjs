import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import {
  UNSET_IS_FINE,
  UNSET_KINDS,
  evaluateKeyHealth,
  gapChecks,
  keyNamesFromCatalog,
} from "../../coverage/gap-door-batch-keys.mjs";
import { PARKED_FEATURES } from "../../parked-features.mjs";
import { providerFromEnv } from "../../../documents/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/keys.json");
const GENERATED = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CODE_ROOTS = ["src", "api", "netlify", "scripts", "e2e", "vendor", "db", "public"];
const CODE_EXTENSIONS = /\.(?:mjs|js|cjs|ts|tsx|html|sql)$/;

function codeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return codeFiles(full);
    return CODE_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

function exactName(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

function fakeValue(name) {
  if (/(?:^|_)DATABASE_URL$/.test(name)) return "postgresql://door-proof.example.test/fundhub";
  if (/(?:^|_)(?:URL|URI|ORIGIN)$/.test(name)) return "https://door-proof.example.test/path";
  if (/(?:^|_)HOST$/.test(name)) return "door-proof.example.test";
  if (/(?:^|_)(?:CENTS|PORT|TIMEOUT_MS|LIMIT|MAX|DAYS|HOURS|MINUTES)$/.test(name)) return "30";
  if (/(?:^|_)EMAIL$/.test(name)) return "door-proof@example.test";
  return `fake-${name.toLowerCase()}-value-8f1c2d3e`;
}

test("one key health pass checks every remaining sensitive key without printing values", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => {
    if (row.repeats_row_in) return false;
    return makeRecipe("keys.json", row).proof?.evidence.includes("door-batch-key-health.test.mjs");
  });
  const liveKeyNames = keyNamesFromCatalog(GENERATED);
  const sources = CODE_ROOTS.flatMap((root) => codeFiles(path.join(ROOT, root))).map((file) => ({
    file: path.relative(ROOT, file),
    text: fs.readFileSync(file, "utf8"),
  }));

  assert.equal(rows.length, 114);
  assert.deepEqual(liveKeyNames, rows.map((row) => row.env_name).sort());
  for (const row of rows) {
    const pattern = exactName(row.env_name);
    const references = sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
    const env = { [row.env_name]: fakeValue(row.env_name) };
    const result = evaluateKeyHealth(row, env, references);
    assert.equal(result.ok, true, `${row.surface}: ${result.problems.join(", ")}`);
    assert.equal(Object.hasOwn(result, "value"), false, row.surface);

    const recipe = makeRecipe("keys.json", row);
    assert.equal(recipe.mode, "read-only", row.surface);
    assert.equal(recipe.proof.depth, "deep", row.surface);
    assert.equal(recipe.proof.asserts, row.control, row.surface);
  }
});

test("the live key lane reads every compiled key and never returns a value", async () => {
  const liveKeyNames = keyNamesFromCatalog(GENERATED);
  const env = Object.fromEntries(liveKeyNames.map((name) => [name, fakeValue(name)]));
  const [pass] = await gapChecks({ env, catalog: GENERATED });
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /^114\/114 sensitive live keys/);

  env.AD_TOKEN_ENC_KEY = "live-secret-that-must-not-be-printed";
  delete env.ANTHROPIC_API_KEY;
  env.META_ACCESS_TOKEN = "****************";
  env.PUBLIC_BASE_URL = "not a url";
  const [fail] = await gapChecks({ env, catalog: GENERATED });
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /ANTHROPIC_API_KEY \(value is missing\)/);
  assert.match(fail.detail, /META_ACCESS_TOKEN \(value is masked\)/);
  assert.match(fail.detail, /PUBLIC_BASE_URL \(value is not a valid url\)/);
  assert.doesNotMatch(fail.detail, /live-secret-that-must-not-be-printed/);
  assert.equal(Object.hasOwn(fail, "value"), false);
});

test("key health rejects missing, masked, malformed, and unread keys without leaking them", () => {
  const row = {
    env_name: "DOOR_SECRET",
    surface: "env:DOOR_SECRET",
    control: "DOOR_SECRET: protects one door",
    read_by_files: 1,
    impact: "customerData",
  };
  assert.deepEqual(evaluateKeyHealth(row, {}, ["src/reader.mjs"]).problems, ["value is missing"]);
  assert.deepEqual(evaluateKeyHealth(row, { DOOR_SECRET: "****************" }, ["src/reader.mjs"]).problems, ["value is masked"]);
  assert.deepEqual(evaluateKeyHealth(row, { DOOR_SECRET: "short" }, ["src/reader.mjs"]).problems, ["credential is too short"]);
  const missingReader = evaluateKeyHealth(row, { DOOR_SECRET: "fake-long-secret" }, []);
  assert.deepEqual(missingReader.problems, ["repo code has no reader"]);
  assert.equal(JSON.stringify(missingReader).includes("fake-long-secret"), false);

  const database = {
    env_name: "DATABASE_URL",
    surface: "env:DATABASE_URL",
    control: "DATABASE_URL: app database",
    read_by_files: 1,
    impact: "customerData",
  };
  assert.equal(
    evaluateKeyHealth(database, { DATABASE_URL: "postgresql://example.test/fundhub" }, ["src/db.mjs"]).ok,
    true
  );
  assert.deepEqual(
    evaluateKeyHealth(database, { DATABASE_URL: "https://example.test/fundhub" }, ["src/db.mjs"]).problems,
    ["url must use postgres or postgresql"]
  );
});

// ---------------------------------------------------------------------------
// Unset on purpose. A key the live check lets stay unset must say why, and the why must be true in the
// code. These tests read the repo (allowed in a test, never at run time).

/* Every file the live functions can reach by a static import or require, starting at netlify/functions
   and netlify/edge-functions. esbuild bundles by the same static strings. */
const SPEC_RE = /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*[\w*{}\s,$]*?\s*from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`$]+)["'`]/g;

function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, path.join(base, "index.mjs"), path.join(base, "index.js")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

let REACHED = null;
function liveReachable() {
  if (REACHED) return REACHED;
  const entries = ["netlify/functions", "netlify/edge-functions"]
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir).filter((f) => /\.(?:m?js|cjs|ts)$/.test(f)).map((f) => path.join(dir, f)));
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of fs.readFileSync(file, "utf8").matchAll(SPEC_RE)) {
      const next = resolveSpec(file, m[1]);
      if (next && /\.(?:m?js|cjs|ts)$/.test(next) && !seen.has(next)) stack.push(next);
    }
  }
  REACHED = [...seen];
  return REACHED;
}

/* Comments out, so a key named only in a comment is not a reader. A // inside a URL string is kept. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const settingRead = (name) =>
  new RegExp(`(?:\\benv\\??\\.|process\\.env\\.)${name}\\b|env\\??\\.?\\[\\s*["'\`]${name}["'\`]\\s*\\]`);

let READERS = null;
/* name -> live files that name it. Catalog files under src/pulse/catalog/ only describe keys, so there
   a file counts only when it reads the key as a setting. The key check itself names every key in its
   list and is not a reader. */
const CHECKER = "src/pulse/coverage/gap-door-batch-keys.mjs";
function liveReaders() {
  if (READERS) return READERS;
  const files = liveReachable().map((file) => ({
    file: path.relative(ROOT, file),
    text: stripComments(fs.readFileSync(file, "utf8")),
  })).filter(({ file }) => file !== CHECKER);
  READERS = new Map(keyNamesFromCatalog(GENERATED).map((name) => {
    const named = exactName(name);
    const reads = settingRead(name);
    const hit = ({ file, text }) => (file.startsWith("src/pulse/catalog/") ? reads.test(text) : named.test(text));
    return [name, files.filter(hit).map(({ file }) => file).sort()];
  }));
  return READERS;
}

/* For every key with a live reader: every reader file, and the line in it that proves the reader copes when
   the key is unset (its own value, a fallback key, an off state, or a plain "missing" answer). */
const OPTIMIZE_LINK = /if \(!affiliateUrl\) return null;\s*return \{ affiliateUrl, pid: pid \|\| "29056", legal \};/;
const OPTIMIZE_STAGE = /if \(clientKey && pid\) \{\s*const stage = String\(env\.CONSUMER_DIRECT_ENV \|\| env\.SMART_CREDIT_ENV \|\| ""\)/;
const OPTIMIZE_AFFILIATE = /env\.CONSUMER_DIRECT_AFFILIATE_URL \|\| env\.SMART_CREDIT_AFFILIATE_URL \|\| SMART_CREDIT_AFFILIATE_URL/;
const GHL_MISSING = /if \(!apiKey\) return \{ ok: false, missing: \["GHL_API_KEY", "GHL_RELAY_API_KEY"\] \};/;
const PROOF = {
  APPLY_PAGE_URL: { "api/climate/config.mjs": /APPLY_PAGE_URL \|\| "https:\/\/apply\.fundhub\.ai"/ },
  AUTOPSY_REPORT_SECRET: { "src/autopsy/link.mjs": /env\.AUTOPSY_REPORT_SECRET \|\| env\.DOCUMENT_URL_SECRET/ },
  BANKING_PROVIDER: {
    "src/banking/provider.mjs": /env\.BANKING_PROVIDER \? String\(env\.BANKING_PROVIDER\)\.trim\(\) : DEFAULT_BANKING_PROVIDER/,
    "src/banking/import.mjs": /BANKING_PROVIDER is not set to a provider this build knows/,
  },
  BLAND_VOICE: {
    "vendor/inquiry-remover/src/agents/equifax-prompt.js": /process\.env\.BLAND_VOICE \|\| "mason"/,
    "vendor/inquiry-remover/src/agents/experian-prompt.js": /process\.env\.BLAND_VOICE \|\| "mason"/,
    "vendor/inquiry-remover/src/agents/transunion-prompt.js": /process\.env\.BLAND_VOICE \|\| "mason"/,
  },
  BLAND_WEBHOOK_URL: {
    "src/messaging/providers/bland-voice.mjs": /env\.BLAND_WEBHOOK_URL \|\| ""\)\.trim\(\) \|\| DEFAULT_WEBHOOK_URL/,
    "src/inquiry-ops/bureau-call.mjs": /env\.BLAND_WEBHOOK_URL \|\| ""\)\.trim\(\) \|\| undefined/,
    "vendor/inquiry-remover/src/lib/bland-client.js": /return DEFAULT_BLAND_WEBHOOK_URL;/,
  },
  // store.mjs picks its store with the beat library's rule (2026-10-20, lib/documents-upload-truth.mjs):
  // DOCUMENT_STORE_PROVIDER, else memory. The BLOB_READ_WRITE_TOKEN test below runs it with no store and no token.
  BLOB_READ_WRITE_TOKEN: { "src/documents/store.mjs": /const name = storeNameFromEnv\(env\);/ },
  CLICKFUNNELS_WORKSPACE_ID: {
    "src/adapters/clickfunnels.mjs": /if \(workspaceId\) ctx\.workspaceId = workspaceId;/,
    "src/slo/cf-contact.mjs": /if \(workspaceId\) ctx\.workspaceId = workspaceId;/,
    "src/messaging/providers/clickfunnels-pages.mjs": /if \(creds\.workspaceId\) return \{ ok: true, id: creds\.workspaceId \};\s*const teams = await walk/,
  },
  COMMAS_API_BASE: {
    "src/payments/commas-api.mjs": /String\(env\[API_BASE_ENV\] \|\| DEFAULT_API_BASE\)/,
    "src/merchant/providers/commas.mjs": /export const COMMAS_API_BASE = "https:\/\/www\.fanbasis\.com";/,
  },
  COMMAS_CHECKOUT_BASE_URL: {
    "src/adapters/commas.mjs": /buildCommasCheckoutUrl: baseUrl is required \(COMMAS_CHECKOUT_BASE_URL\)/,
    "src/subscriptions/partner-addons.mjs": /checkoutBaseUrl \|\| env\?\.COMMAS_CHECKOUT_BASE_URL \|\| null/,
    "api/payment-links.mjs": /!checkoutBaseUrl &&\s*!String\(env\.CORTANA_COMMAS_API_KEY \|\| env\.FANBASIS_CHECKOUT_API_KEY/,
    "api/partner-addons.mjs": /!checkoutBaseUrl && !String\(env\.FANBASIS_CHECKOUT_API_KEY/,
    "api/money/setup.mjs": /checkoutBaseUrl: env\.COMMAS_CHECKOUT_BASE_URL \|\| null/,
    "api/public/funnel-checkout.mjs": /if \(sessionApi\) return true;/,
    "api/closer-deck.mjs": /checkoutBaseUrl: env\.COMMAS_CHECKOUT_BASE_URL,/,
  },
  COMMAS_SUCCESS_URL: { "src/payments/commas-api.mjs": /\|\| env\.COMMAS_SUCCESS_URL[\s\S]{0,200}\|\| "https:\/\/fundhub\.ai\/app\/payment-success\.html"/ },
  CONSUMER_DIRECT_AFFILIATE_URL: { "api/public/optimize.mjs": OPTIMIZE_AFFILIATE },
  CONSUMER_DIRECT_CANCEL_URL: { "api/public/optimize.mjs": /out\.cancelUrl = httpsUrl\(env\[SMART_CREDIT_CANCEL_ENV\]\);/ },
  CONSUMER_DIRECT_CLIENT_KEY: { "api/public/optimize.mjs": OPTIMIZE_LINK },
  CONSUMER_DIRECT_ENV: { "api/public/optimize.mjs": OPTIMIZE_STAGE },
  CONSUMER_DIRECT_PID: { "api/public/optimize.mjs": OPTIMIZE_LINK },
  CONTRACT_URL_SECRET: {
    "src/contracts/signed-link.mjs": /env\.CONTRACT_URL_SECRET \|\| env\.DOCUMENT_URL_SECRET/,
    "api/contracts.mjs": /\/CONTRACT_URL_SECRET\/\.test\(/,
  },
  FANBASIS_CHECKOUT_API_BASE: {
    "src/payments/commas-api.mjs": /env\?\.\[CHECKOUT_API_BASE_ENV\] \|\| DEFAULT_CHECKOUT_API_BASE/,
    "src/pulse/beats/beat-vendor-keys.mjs": /baseFor\(env\[COMMAS_BASE_ENV\], COMMAS_HOST, COMMAS_DEFAULT_BASE\)/,
  },
  FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: { "src/finance/file-alerts/common.mjs": /String\(raw\)\.trim\(\) === ""\) return PAY_BEFORE_CLOSE_DAYS_DEFAULT;/ },
  FINANCE_OS_PRICE_PER_CONTAINER_CENTS: {
    "src/finance/containers.mjs": /const raw = env\?\.\[PRICE_ENV\];\s*if \(raw === null \|\| raw === undefined\) return null;/,
    "src/finance/money-overview.mjs": /const raw = text\(env\?\.FINANCE_OS_PRICE_PER_CONTAINER_CENTS\);\s*if \(raw === null/,
  },
  FINANCE_OS_TRANSFERS_LIVE: {
    "src/banking/providers/plaid-http.mjs": /if \(plaidEnv === "production" && live === "1"\) return null;/,
    "src/finance/money-transfers.mjs": /LIVE: "FINANCE_OS_TRANSFERS_LIVE"/,
  },
  GHL_API_KEY: {
    "src/handlers/client-lifecycle.mjs": /GHL_API_KEY unset — ghl_contact_id left null/,
    "src/messaging/crm-contacts.mjs": GHL_MISSING,
  },
  GHL_RELAY_API_KEY: {
    "src/messaging/crm-contacts.mjs": GHL_MISSING,
    "src/messaging/providers/ghl-relay.mjs": /if \(!apiKey\) return \{ ok: false, missing: \["GHL_RELAY_API_KEY"\] \};/,
  },
  INSIGHT_MEET_BOOKING_URL: {
    "src/insights/meet.mjs": /return URL_RE\.test\(u\) \? u : null;/,
    "src/handlers/customer-insights.mjs": /: "Book a Google Meet \(set INSIGHT_MEET_BOOKING_URL on Netlify\)\."/,
    "src/workflows/slo-genuine-followup.mjs": /: "Then book the Google Meet \(INSIGHT_MEET_BOOKING_URL\)\."/,
  },
  LENDFLOW_API_BASE: { "src/adapters/lendflow.mjs": /env\.LENDFLOW_API_BASE \|\| DEFAULT_API_BASE/ },
  LENDFLOW_API_KEY: {
    "src/adapters/lendflow.mjs": /if \(!apiKey\) missing\.push\("LENDFLOW_API_KEY"\);/,
    "src/pulse/beats/lib/keys-truth.mjs": /env: Object\.freeze\(\["LENDFLOW_WEBHOOK_SECRET", "LENDFLOW_API_KEY"\]\)/,
    "src/pulse/parked-features.mjs": /env: Object\.freeze\(\["LENDFLOW_WEBHOOK_SECRET", "LENDFLOW_API_KEY"\]\)/,
  },
  MAILGUN_INBOUND_DOMAIN: { "src/mail/monitor-address.mjs": /env\.MAILGUN_SEND_DOMAIN \|\| env\.MAILGUN_INBOUND_DOMAIN/ },
  MAILGUN_SEND_BASE_URL: { "src/messaging/providers/mailgun.mjs": /env\.MAILGUN_SEND_BASE_URL \|\| DEFAULT_BASE_URL/ },
  META_ACCESS_TOKEN: { "api/campaigns/meta-agency.mjs": /message: "META_ACCESS_TOKEN is not set on the server\."/ },
  META_API_VERSION: {
    "api/campaigns/sync.mjs": /process\.env\.META_API_VERSION \|\| DEFAULT_META_API_VERSION/,
    "src/adplatforms/meta.mjs": /process\.env\.META_API_VERSION \|\| "v26\.0"/,
    "src/messaging/providers/meta-capi.mjs": /\? v : DEFAULT_API_VERSION;/,
    "src/pulse/beats/lib/money-ads-meta-truth.mjs": /env\.META_API_VERSION\) \|\| DEFAULT_META_API_VERSION/,
    "src/social/adapters.mjs": /process\.env\.META_API_VERSION \|\| "v26\.0"/,
    "src/social/oauth.mjs": /\? v : DEFAULT_META_API_VERSION;/,
  },
  META_INSTAGRAM_USER_ID: { "src/marketing/meta-load.mjs": /if \(!instagramUserId\) reasons\.push\(REASONS\.NO_INSTAGRAM\);/ },
  META_PAGE_ID: { "src/marketing/meta-load.mjs": /if \(!pageId\) reasons\.push\(REASONS\.NO_PAGE\);/ },
  PORTAL_BASE_URL: { "src/auth/magic-link.mjs": /env\.PORTAL_BASE_URL \|\| env\.DEPLOY_PRIME_URL \|\| env\.URL \|\| "https:\/\/fundhub\.ai"/ },
  POSTGRID_API_BASE: { "src/messaging/providers/mail-letter.mjs": /env\.POSTGRID_API_BASE \|\| DEFAULT_BASE/ },
  PUBLIC_BASE_URL: {
    "api/consent/capture.mjs": /if \(env\.PUBLIC_BASE_URL\) return [^\n]+\n\s*if \(env\.URL\) return [^\n]+\n\s*return "https:\/\/fundhub\.ai";/,
    "api/contracts.mjs": /if \(env\.PUBLIC_BASE_URL\) return [^\n]+\n\s*const host = req\.headers/,
    "api/public/decline-autopsy-upload.mjs": /baseUrl: env\.PUBLIC_BASE_URL \|\| null/,
    "api/read/portal-contracts.mjs": /env\.PUBLIC_BASE_URL \|\| env\.URL \|\| "https:\/\/fundhub\.ai"/,
    "src/ops/hire-closer.mjs": /process\.env\.PUBLIC_BASE_URL \|\| process\.env\.APP_BASE_URL \|\| "https:\/\/fundhub\.ai"/,
    "src/payments/commas-api.mjs": /\|\| env\.PUBLIC_BASE_URL && [^\n]+\n\s*\|\| "https:\/\/fundhub\.ai\/app\/payment-success\.html"/,
    "src/sales/closer-deck.mjs": /if \(env\.PUBLIC_BASE_URL\) return [^\n]+\n\s*if \(env\.URL\) return [^\n]+\n\s*return "https:\/\/fundhub\.ai";/,
    "src/slo/offer.mjs": /env\.PUBLIC_BASE_URL \|\| "https:\/\/fundhub\.ai"/,
  },
  PUBLIC_SITE_URL: {
    "src/ad-videos/pipeline.mjs": /env\.PUBLIC_SITE_URL \|\| "https:\/\/fundhub\.ai"/,
    "src/workflows/ad-video-sweeper.mjs": /env\.PUBLIC_SITE_URL \|\| "https:\/\/fundhub\.ai"/,
  },
  RESEND_BASE_URL: {
    "src/messaging/providers/resend.mjs": /env\.RESEND_BASE_URL \|\| DEFAULT_BASE_URL/,
    "src/pulse/beats/beat-vendor-keys.mjs": /baseFor\(env\.RESEND_BASE_URL, RESEND_HOST, `https:\/\/\$\{RESEND_HOST\}`\)/,
    "src/pulse/coverage/gap-keys.mjs": /httpsBase\(env\.RESEND_BASE_URL, RESEND_DEFAULT_BASE\)/,
  },
  SALES_MEET_BOOKING_URL: {
    "src/insights/meet.mjs": /pickUrl\(env, "SALES_MEET_BOOKING_URL"\)\s*\|\| "https:\/\/apply\.fundhub\.ai\/funding-book-call"/,
    "src/workflows/messaging.mjs": /process\.env\.SALES_MEET_BOOKING_URL \|\|\s*"https:\/\/apply\.fundhub\.ai\/funding-book-call"/,
  },
  SESSION_SECRET: { "src/social/oauth.mjs": /env\.AD_TOKEN_ENC_KEY \|\| env\.SESSION_SECRET \|\| null/ },
  SETTER_VOICE: { "vendor/inquiry-remover/src/agents/setter-prompt.js": /process\.env\.SETTER_VOICE \|\| "mason"/ },
  SMART_CREDIT_AFFILIATE_URL: { "api/public/optimize.mjs": OPTIMIZE_AFFILIATE },
  SMART_CREDIT_CLIENT_KEY: { "api/public/optimize.mjs": OPTIMIZE_LINK },
  SMART_CREDIT_ENV: { "api/public/optimize.mjs": OPTIMIZE_STAGE },
  SMART_CREDIT_PID: { "api/public/optimize.mjs": OPTIMIZE_LINK },
  SUBSCRIPTION_BILLING_ENABLED: { "src/subscriptions/charger.mjs": /String\(env\?\.\[BILLING_ENABLED_ENV\] \?\? ""\)\.trim\(\) !== "true"/ },
  TWILIO_SEND_BASE_URL: {
    "src/messaging/providers/twilio.mjs": /env\.TWILIO_SEND_BASE_URL \|\| DEFAULT_BASE_URL/,
    "src/messaging/providers/twilio-whatsapp.mjs": /env\.TWILIO_SEND_BASE_URL \|\| DEFAULT_BASE_URL/,
    "src/pulse/beats/beat-vendor-keys.mjs": /baseFor\(env\.TWILIO_SEND_BASE_URL, TWILIO_HOST, `https:\/\/\$\{TWILIO_HOST\}`\)/,
    "src/pulse/coverage/gap-keys.mjs": /httpsBase\(env\.TWILIO_SEND_BASE_URL, TWILIO_DEFAULT_BASE\)/,
  },
};

test("every unset-on-purpose key is a compiled key, with a known kind and a plain reason", () => {
  const catalog = new Set(keyNamesFromCatalog(GENERATED));
  for (const [name, rule] of Object.entries(UNSET_IS_FINE)) {
    assert.ok(catalog.has(name), `${name} is not a compiled key`);
    assert.ok(UNSET_KINDS.includes(rule.when), `${name}: unknown kind ${rule.when}`);
    assert.ok(typeof rule.why === "string" && rule.why.length > 10, `${name}: no reason`);
    if (rule.when === "fallback") {
      assert.ok(Array.isArray(rule.use) && rule.use.length > 0, name);
      for (const other of rule.use) assert.ok(/^[A-Z][A-Z0-9_]*$/.test(other) && other !== name, `${name}: bad fallback ${other}`);
    }
    if (rule.when === "only-when") assert.ok(rule.onlyWhen && /^[A-Z][A-Z0-9_]*$/.test(rule.onlyWhen.name) && rule.onlyWhen.is, name);
    if (rule.when === "parked") assert.ok(Object.hasOwn(PARKED_FEATURES, rule.feature), `${name}: ${rule.feature} is not a parked feature`);
  }
  // Measured 2026-10-20: 68 keys unset on live, 67 of them on purpose. BOOKING_URL is the one that is needed.
  assert.equal(Object.keys(UNSET_IS_FINE).length, 67);
  assert.equal(Object.hasOwn(UNSET_IS_FINE, "BOOKING_URL"), false);
});

test("a no-live-reader key has no reader any live function can reach, and the build does not read it either", () => {
  const readers = liveReaders();
  const listed = Object.entries(UNSET_IS_FINE).filter(([, rule]) => rule.when === "no-live-reader").map(([name]) => name);
  assert.equal(listed.length, 20);
  const reachedText = liveReachable().filter((file) => path.relative(ROOT, file) !== CHECKER).map((file) => fs.readFileSync(file, "utf8"));
  // The build runs db/migrate.mjs and the ship scripts; a key only they read is still needed on Netlify.
  const buildText = [
    fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8"),
    ...codeFiles(path.join(ROOT, "db")).filter((file) => /\.(?:m?js|cjs)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")),
    fs.readFileSync(path.join(ROOT, "scripts/ship.mjs"), "utf8"),
  ].join("\n");
  for (const name of listed) {
    assert.deepEqual(readers.get(name), [], `${name} has a live reader`);
    assert.doesNotMatch(buildText, exactName(name), `${name} is read by the build`);
    // A name built at run time (`STITCH_CREDIT_${part}`) would hide from the walk; no live file builds one.
    const prefix = name.slice(0, name.lastIndexOf("_") + 1);
    assert.ok(!reachedText.some((text) => text.includes(`${prefix}\${`)), `${name}: a live file builds ${prefix}… names`);
  }
  // The walk is real: it reaches the vendored bureau prompts the live dialer imports, and not the old checkout door.
  const reached = new Set(liveReachable().map((file) => path.relative(ROOT, file)));
  assert.ok(reached.has("netlify/functions/api.mjs"));
  assert.ok(reached.has("vendor/inquiry-remover/src/agents/equifax-prompt.js"));
  assert.equal(reached.has("vendor/underwriteiq-full/api/lite/commas-checkout.js"), false);
});

test("every live reader of an unset-on-purpose key is listed, and its line proves it copes when the key is unset", () => {
  const readers = liveReaders();
  for (const [name, rule] of Object.entries(UNSET_IS_FINE)) {
    if (rule.when === "no-live-reader") continue;
    const files = readers.get(name);
    if (rule.when === "not-a-setting") {
      assert.ok(files.length > 0, `${name}: no live file names it`);
      for (const file of files) {
        const text = stripComments(fs.readFileSync(path.join(ROOT, file), "utf8"));
        assert.doesNotMatch(text, settingRead(name), `${file} reads ${name} as a setting`);
      }
      continue;
    }
    const proof = PROOF[name] || {};
    assert.deepEqual(Object.keys(proof).sort(), files, `${name}: the listed readers are not the live readers`);
    for (const [file, re] of Object.entries(proof)) {
      assert.match(fs.readFileSync(path.join(ROOT, file), "utf8"), re, `${name}: ${file} no longer copes when it is unset`);
    }
  }
  for (const name of Object.keys(PROOF)) assert.ok(Object.hasOwn(UNSET_IS_FINE, name), `${name} has a proof but is not on the list`);
});

test("PLAID_TOKEN_ENC_KEY_V2 is read only by its built name, for a v2 token, and new tokens are v1", () => {
  // The walk cannot see a name built at run time, so this one is proved by hand.
  const plaid = fs.readFileSync(path.join(ROOT, "src/banking/plaid.mjs"), "utf8");
  assert.match(plaid, /const varName = keyId === "v1" \? "PLAID_TOKEN_ENC_KEY" : `PLAID_TOKEN_ENC_KEY_\$\{keyId\.toUpperCase\(\)\}`;/);
  assert.match(plaid, /export function encryptPlaidToken\(plaintext, \{ itemId, keyId = "v1", env \} = \{\}\)/);
  assert.match(plaid, /if \(!raw\) \{[\s\S]{0,200}throw new PlaidConfigError/, "an unset key stops the write; it never stores a token it cannot read");
  assert.equal(UNSET_IS_FINE.PLAID_TOKEN_ENC_KEY_V2.when, "off-switch");
});

test("BOOKING_URL stays required: the vendored funding writer falls back to a placeholder link", () => {
  const writer = "vendor/underwriteiq-full/api/lite/crs/generate-deliverables.js";
  assert.match(fs.readFileSync(path.join(ROOT, writer), "utf8"), /process\.env\.BOOKING_URL \|\| "www\.fundhubbookingurl\.template"/);
  assert.ok(liveReaders().get("BOOKING_URL").includes(writer));
});

/* The live shape of 2026-10-20, with fake values: every catalog key set on Netlify production is set here. */
const SET_ON_LIVE = [
  "AD_TOKEN_ENC_KEY", "ANTHROPIC_API_KEY", "APP_BASE_URL", "BLAND_API_KEY", "CLICKFUNNELS_API_KEY",
  "CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET", "CLICKFUNNELS_SUBDOMAIN", "COMMAS_API_KEY", "CONSUMER_DIRECT_CONSUMER_RIGHTS_URL",
  "CONSUMER_DIRECT_PRIVACY_POLICY_URL", "CONSUMER_DIRECT_SERVICE_AGREEMENT_URL", "CONSUMER_DIRECT_TERMS_OF_USE_URL",
  "CRS_ACTIVE_BUREAUS", "CRS_LIVE_API_HOST", "CRS_LIVE_API_PASSWORD", "CRS_LIVE_API_USERNAME", "DATABASE_URL",
  "EQUIFAX_DISPUTE_NUMBER", "EXPERIAN_DISPUTE_NUMBER", "FINANCE_OS_SYSTEM_PULL_LIVE", "FINANCE_OS_TRANSFER_DAILY_MAX_CENTS",
  "FINANCE_OS_TRANSFER_MAX_CENTS", "FUNDHUB_REP_NUMBER", "MAILGUN_SEND_API_KEY", "MAILGUN_SEND_DOMAIN", "MAILGUN_SEND_FROM",
  "MAILGUN_SIGNING_KEY", "META_AD_ACCOUNT_ID", "META_APP_ID", "META_APP_SECRET", "META_BUSINESS_ID", "MIGRATION_DATABASE_URL",
  "NETLIFY_BLOBS_TOKEN", "PII_ENC_KEY", "PLAID_ENV", "PUSH_SUB_ENC_KEY", "RB2B_WEBHOOK_SECRET", "RESEND_REPLY_TO_DOMAIN",
  "SLO_DEMO_PAY", "SLO_POST_PURCHASE_ENABLED", "TRANSUNION_DISPUTE_NUMBER", "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY",
  "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT",
];

function liveShapeEnv(over = {}) {
  const env = Object.fromEntries(SET_ON_LIVE.map((name) => [name, fakeValue(name)]));
  // Settings outside the catalog that the fallbacks read.
  env.DOCUMENT_URL_SECRET = "fake-document-url-secret-0123456789abcdef";
  env.FANBASIS_CHECKOUT_API_KEY = "fake-fanbasis-checkout-key-8f1c";
  env.DOCUMENT_STORE_PROVIDER = "netlify-blobs";
  return { ...env, ...over };
}

/* The staff view as the parked-feature reads see it. */
function parkedScope({ running = 0, delivered = 0, captures = 0, fail = false } = {}) {
  return async (fn) => fn({
    async query(sql) {
      if (fail) throw new Error("permission denied");
      if (sql.includes("parked:meta-ads")) return { rows: [{ running, delivered }] };
      if (sql.includes("parked:lendflow")) return { rows: [{ captures }] };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  });
}

const failingNames = (row) => [...row.detail.matchAll(/([A-Z][A-Z0-9_]+) \(/g)].map((m) => m[1]);
const BOOKED = { BOOKING_URL: "https://door-proof.example.test/book" };

test("the live shape of 2026-10-20 is red on BOOKING_URL alone, and green once it is set", async () => {
  assert.equal(SET_ON_LIVE.length + Object.keys(UNSET_IS_FINE).length + 1, 114);
  const [today] = await gapChecks({ env: liveShapeEnv(), catalog: GENERATED, scope: parkedScope() });
  assert.equal(today.status, "FAIL");
  assert.deepEqual(failingNames(today), ["BOOKING_URL"]);
  assert.match(today.detail, /^1\/114 sensitive live keys need attention: BOOKING_URL \(value is missing\)\. 67 more are unset on purpose/);
  const [fixed] = await gapChecks({ env: liveShapeEnv(BOOKED), catalog: GENERATED, scope: parkedScope() });
  assert.equal(fixed.status, "PASS");
  assert.match(fixed.detail, /^47\/114 sensitive live keys are present and correctly shaped\. 67 more are unset on purpose/);
  assert.equal(fixed.suggestedFix, null);
});

test("a fallback key holds only while the key it falls back to is set, well shaped and long enough", async () => {
  const run = async (over) => failingNames((await gapChecks({ env: liveShapeEnv({ ...BOOKED, ...over }), catalog: GENERATED, scope: parkedScope() }))[0]);
  assert.deepEqual(await run({ DOCUMENT_URL_SECRET: "" }), ["AUTOPSY_REPORT_SECRET", "CONTRACT_URL_SECRET"]);
  assert.deepEqual(await run({ DOCUMENT_URL_SECRET: "too-short-for-a-link-secret" }), ["AUTOPSY_REPORT_SECRET", "CONTRACT_URL_SECRET"]);
  assert.deepEqual(await run({ DOCUMENT_URL_SECRET: "****************abcdefghijklmnopqrstuvwxyz" }), ["AUTOPSY_REPORT_SECRET", "CONTRACT_URL_SECRET"]);
  assert.deepEqual(await run({ AD_TOKEN_ENC_KEY: "" }), ["AD_TOKEN_ENC_KEY", "SESSION_SECRET"]);
  assert.deepEqual(await run({ FANBASIS_CHECKOUT_API_KEY: "" }), ["COMMAS_CHECKOUT_BASE_URL"]);
  assert.deepEqual(await run({ MAILGUN_SEND_DOMAIN: "" }), ["MAILGUN_INBOUND_DOMAIN", "MAILGUN_SEND_DOMAIN"]);
  const [row] = await gapChecks({ env: liveShapeEnv({ ...BOOKED, DOCUMENT_URL_SECRET: "" }), catalog: GENERATED, scope: parkedScope() });
  assert.match(row.detail, /CONTRACT_URL_SECRET \(value is missing, and so is a usable DOCUMENT_URL_SECRET\)/);
});

test("BLOB_READ_WRITE_TOKEN: with no store set and no blob token, the document store falls back to memory", () => {
  assert.equal(providerFromEnv({}, { objects: new Map() }).name, "memory");
  assert.equal(providerFromEnv({ DOCUMENT_STORE_PROVIDER: "" }, { objects: new Map() }).name, "memory");
});

test("only-when: the blob token is needed the day documents move to the vercel-blob store", async () => {
  const [row] = await gapChecks({ env: liveShapeEnv({ ...BOOKED, DOCUMENT_STORE_PROVIDER: "vercel-blob" }), catalog: GENERATED, scope: parkedScope() });
  assert.deepEqual(failingNames(row), ["BLOB_READ_WRITE_TOKEN"]);
  assert.match(row.detail, /BLOB_READ_WRITE_TOKEN \(value is missing, and DOCUMENT_STORE_PROVIDER is vercel-blob\)/);
});

test("parked keys hold only while the feature is still not in use, read again through the staff view", async () => {
  const run = async (scope) => failingNames((await gapChecks({ env: liveShapeEnv(BOOKED), catalog: GENERATED, scope }))[0] );
  const meta = ["META_ACCESS_TOKEN", "META_INSTAGRAM_USER_ID", "META_PAGE_ID"];
  assert.deepEqual(await run(parkedScope({ running: 2 })), meta);
  assert.deepEqual(await run(parkedScope({ delivered: 5 })), meta);
  assert.deepEqual(await run(parkedScope({ captures: 1 })), ["LENDFLOW_API_KEY"]);
  // No staff view, or a read that fails, never parks.
  assert.deepEqual(await run(undefined), ["LENDFLOW_API_KEY", ...meta]);
  assert.deepEqual(await run(parkedScope({ fail: true })), ["LENDFLOW_API_KEY", ...meta]);
  // One read per feature for the whole run.
  const asked = [];
  await gapChecks({
    env: liveShapeEnv(BOOKED),
    catalog: GENERATED,
    scope: async (fn) => fn({
      async query(sql) {
        asked.push(sql.includes("parked:meta-ads") ? "meta-ads" : "lendflow");
        return { rows: [{ running: 0, delivered: 0, captures: 0 }] };
      },
    }),
  });
  assert.deepEqual(asked.sort(), ["lendflow", "meta-ads"]);
});

test("an unset-on-purpose key that IS set is still shape-checked, and a value never reaches the detail", async () => {
  const [row] = await gapChecks({
    env: liveShapeEnv({
      ...BOOKED,
      SESSION_SECRET: "****************",
      FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: "three",
      PUBLIC_BASE_URL: "ftp://door-proof.example.test",
      META_PAGE_ID: "do-not-print-this-page-id",
    }),
    catalog: GENERATED,
    scope: parkedScope(),
  });
  assert.equal(row.status, "FAIL");
  assert.deepEqual(failingNames(row), ["FILE_ALERT_PAY_BEFORE_CLOSE_DAYS", "PUBLIC_BASE_URL", "SESSION_SECRET"]);
  assert.match(row.detail, /FILE_ALERT_PAY_BEFORE_CLOSE_DAYS \(value must be a whole number\)/);
  assert.match(row.detail, /PUBLIC_BASE_URL \(url must use http or https\)/);
  assert.match(row.detail, /SESSION_SECRET \(value is masked\)/);
  assert.doesNotMatch(row.detail, /do-not-print-this-page-id/);
  assert.match(row.detail, /63 more are unset on purpose/);
});
