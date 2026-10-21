// The live key check. Every sensitive key the catalog maps (114 today) is read from the server's own
// settings (process.env on the live function). A key that is SET must be present and well shaped,
// always. A key that is NOT set is a break only when live code needs it.
//
// Measured 2026-10-20: 68 of 114 were unset on Netlify production, and 67 of those are unset on
// purpose. UNSET_IS_FINE below names each one and why. door-batch-key-health.test.mjs proves every
// entry against the repo at test time (never at run time): the reader really has its own value, the
// key really has no reader the live functions can reach, and every reader of the key is listed.
//
// READ ONLY. A parked feature is re-checked with one SELECT through the staff view
// (src/pulse/parked-features.mjs). No value is ever returned or printed.

import { parkedState } from "../parked-features.mjs";

const KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const MASK_RE = /^(?:\*{4,}|x{4,}|redacted|masked)$/i;
const KEY_HEALTH_TEST = "src/pulse/catalog/proofs/door-batch-key-health.test.mjs";

export const KEY_HEALTH_EVIDENCE =
  "src/pulse/coverage/gap-door-batch-keys.mjs " +
  "src/pulse/catalog/proofs/door-batch-key-health.test.mjs";

export const CHECK_IDS = Object.freeze(["door-batch:keys-live-proof"]);

/* How an unset key is judged. Every kind still shape-checks the key the moment it is set.
     no-live-reader  only old vendored code, a test, a script or a comment names it; no live function
                     can reach that reader (proved by an import walk in the test).
     default         every live reader has its own value, or says plainly what is missing, when unset.
     fallback        live code reads another key first or instead: unset is fine only while one of
                     `use` is set and well shaped (and at least `minLength` long when given).
     only-when       needed only when the setting `onlyWhen.name` is exactly `onlyWhen.is`.
     off-switch      unset means the feature is off, which is the safe state.
     retired         the vendor was cancelled; the reader says the key is missing and goes on.
     parked          an owner-parked feature (src/pulse/parked-features.mjs): fine only while that
                     feature is still not in use, read again every run.
     not-a-setting   a merge tag in message copy that shares the name; no live code reads it as a setting. */
const fine = (when, why, extra = {}) => Object.freeze({ when, why, ...extra });
const VENDORED = "read only by vendored legacy code that no live function reaches";

export const UNSET_IS_FINE = Object.freeze({
  APPLY_PAGE_URL: fine("default", "the climate page uses https://apply.fundhub.ai"),
  AUTOPSY_REPORT_SECRET: fine("fallback", "the report link is signed with DOCUMENT_URL_SECRET", { use: ["DOCUMENT_URL_SECRET"], minLength: 32 }),
  BANKING_PROVIDER: fine("default", "the banking provider defaults to plaid"),
  BLAND_VOICE: fine("default", "the bureau callers use the voice mason"),
  BLAND_VOICE_FEMALE: fine("no-live-reader", VENDORED),
  BLAND_VOICE_MALE: fine("no-live-reader", VENDORED),
  BLAND_WEBHOOK_URL: fine("default", "Bland posts call results to https://fundhub.ai/api/webhooks/bland"),
  BLOB_READ_WRITE_TOKEN: fine("only-when", "documents use this token only on the vercel-blob store", { onlyWhen: { name: "DOCUMENT_STORE_PROVIDER", is: "vercel-blob" } }),
  CLICKFUNNELS_WORKSPACE_ID: fine("default", "the workspace is looked up from CLICKFUNNELS_SUBDOMAIN"),
  CLIENT_PORTAL_URL: fine("not-a-setting", "it is the {{CLIENT_PORTAL_URL}} merge tag, filled from the portal sign-in link"),
  COMMAS_API_BASE: fine("default", "the Commas API host defaults to https://api.commas.io"),
  COMMAS_CHECKOUT_BASE_URL: fine("fallback", "checkout links are made by the checkout-session API key", { use: ["FANBASIS_CHECKOUT_API_KEY"] }),
  COMMAS_CHECKOUT_SECRET: fine("no-live-reader", VENDORED),
  COMMAS_ENV: fine("no-live-reader", VENDORED),
  COMMAS_PAYMENT_SECRET: fine("no-live-reader", VENDORED),
  COMMAS_SIGNATURE_HEADER: fine("no-live-reader", VENDORED),
  COMMAS_SUCCESS_URL: fine("default", "buyers land on https://fundhub.ai/app/payment-success.html"),
  CONSUMER_DIRECT_AFFILIATE_URL: fine("default", "the page uses the public SmartCredit partner link"),
  CONSUMER_DIRECT_CANCEL_URL: fine("default", "the page leaves the cancel link out until ConsumerDirect gives one"),
  CONSUMER_DIRECT_CLIENT_KEY: fine("default", "without the widget key the page shows the plain SmartCredit partner link"),
  CONSUMER_DIRECT_ENV: fine("default", "it only picks the widget's stage host, and the widget is off without its key"),
  CONSUMER_DIRECT_PID: fine("default", "without the widget key the page shows the plain SmartCredit partner link"),
  CONTEXT_FETCHER_SECRET: fine("no-live-reader", VENDORED),
  CONTRACT_URL_SECRET: fine("fallback", "the contract link is signed with DOCUMENT_URL_SECRET", { use: ["DOCUMENT_URL_SECRET"], minLength: 32 }),
  FANBASIS_CHECKOUT_API_BASE: fine("default", "the checkout API host defaults to https://www.fanbasis.com/public-api"),
  FANBASIS_CHECKOUT_BASE_URL: fine("no-live-reader", VENDORED),
  FANBASIS_ENVIRONMENT: fine("no-live-reader", VENDORED),
  FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: fine("default", "the pay-before-close alert fires 3 days before"),
  FINANCE_OS_PRICE_PER_CONTAINER_CENTS: fine("off-switch", "no extra-container price is set, so nothing is charged for one"),
  FINANCE_OS_TRANSFERS_LIVE: fine("off-switch", "real-money transfers stay off (they also need PLAID_ENV=production)"),
  FUNDING_ACTIVE_SMS_TEMPLATE: fine("no-live-reader", VENDORED),
  GHL_API_KEY: fine("retired", "GoHighLevel was cancelled; the CRM helper records the key as missing and goes on"),
  GHL_PIT: fine("no-live-reader", VENDORED),
  GHL_PRIVATE_API_KEY: fine("no-live-reader", "read only by a laptop script and vendored legacy code"),
  GHL_RELAY_API_KEY: fine("retired", "GoHighLevel was cancelled; the relay records the key as missing and goes on"),
  INSIGHT_MEET_BOOKING_URL: fine("default", "the staff task says to book the Google Meet by hand"),
  LENDFLOW_API_BASE: fine("default", "the Lendflow host has its own default"),
  LENDFLOW_API_KEY: fine("parked", "Lendflow is paused by the owner and not connected", { feature: "lendflow" }),
  MAILGUN_API_KEY: fine("no-live-reader", "only the test harness names it"),
  MAILGUN_DOMAIN: fine("no-live-reader", VENDORED),
  MAILGUN_INBOUND_DOMAIN: fine("fallback", "bank-reply addresses use MAILGUN_SEND_DOMAIN first", { use: ["MAILGUN_SEND_DOMAIN"] }),
  MAILGUN_INBOUND_SECRET: fine("no-live-reader", VENDORED),
  MAILGUN_SEND_BASE_URL: fine("default", "Mailgun sends use its own default host"),
  META_ACCESS_TOKEN: fine("parked", "Meta agency access is part of Meta ads, a future feature", { feature: "meta-ads" }),
  META_API_VERSION: fine("default", "Meta calls use v26.0"),
  META_INSTAGRAM_USER_ID: fine("parked", "loading ads into Meta is part of Meta ads, a future feature", { feature: "meta-ads" }),
  META_PAGE_ID: fine("parked", "loading ads into Meta is part of Meta ads, a future feature", { feature: "meta-ads" }),
  PLAID_TOKEN_ENC_KEY_V2: fine("off-switch", "the second bank-token key is read only for a token locked with v2; new tokens are locked with v1, and a v2 token cannot be written while it is unset"),
  PORTAL_BASE_URL: fine("default", "sign-in links use the site address, else https://fundhub.ai"),
  POSTGRID_API_BASE: fine("default", "PostGrid uses its own default host"),
  PUBLIC_BASE_URL: fine("default", "links use the site address, else https://fundhub.ai"),
  PUBLIC_SITE_URL: fine("default", "ad-video links use https://fundhub.ai"),
  RESEND_BASE_URL: fine("default", "Resend uses its own default host"),
  SALES_MEET_BOOKING_URL: fine("default", "the booking link is https://apply.fundhub.ai/funding-book-call"),
  SESSION_SECRET: fine("fallback", "social tokens are locked with AD_TOKEN_ENC_KEY first", { use: ["AD_TOKEN_ENC_KEY"] }),
  SETTER_VOICE: fine("default", "the setter caller uses the voice mason"),
  SMART_CREDIT_AFFILIATE_URL: fine("default", "older name; the page uses the public SmartCredit partner link"),
  SMART_CREDIT_CLIENT_KEY: fine("default", "older name; without the widget key the page shows the plain partner link"),
  SMART_CREDIT_ENV: fine("default", "older name; it only picks the widget's stage host"),
  SMART_CREDIT_PID: fine("default", "older name; without the widget key the page shows the plain partner link"),
  STITCH_CREDIT_API_BASE: fine("no-live-reader", VENDORED),
  STITCH_CREDIT_EMAIL: fine("no-live-reader", VENDORED),
  STITCH_CREDIT_PASSWORD: fine("no-live-reader", VENDORED),
  STITCH_CREDIT_USERNAME: fine("no-live-reader", VENDORED),
  SUBSCRIPTION_BILLING_ENABLED: fine("off-switch", "recurring card billing on this rail stays off; Commas bills subscriptions"),
  TWILIO_SEND_BASE_URL: fine("default", "Twilio sends use its own default host"),
  UNDERWRITE_IQ_VISION_KEY: fine("no-live-reader", VENDORED)
});

export const UNSET_KINDS = Object.freeze([
  "no-live-reader", "default", "fallback", "only-when", "off-switch", "retired", "parked", "not-a-setting"
]);

export function keyNamesFromCatalog(catalog) {
  return [...new Set(
    (Array.isArray(catalog?.items) ? catalog.items : [])
    .filter((item) => item?.family === "key" && item?.proof?.tests?.includes(KEY_HEALTH_TEST))
    .map((item) => String(item.target || "").trim())
    .filter((name) => KEY_NAME_RE.test(name))
  )].sort();
}

async function compiledCatalog() {
  return (await import("../catalog/generated.json", { with: { type: "json" } })).default;
}

function valueShape(name, value) {
  if (/(?:^|_)(?:URL|URI|ORIGIN)$/.test(name)) {
    try {
      const parsed = new URL(value);
      const protocols = /(?:^|_)DATABASE_URL$/.test(name)
        ? ["postgres:", "postgresql:"]
        : ["http:", "https:"];
      return protocols.includes(parsed.protocol)
        ? null
        : `url must use ${protocols.map((protocol) => protocol.slice(0, -1)).join(" or ")}`;
    } catch {
      return "value is not a valid url";
    }
  }
  if (/(?:^|_)HOST$/.test(name)) {
    return /^(?:https?:\/\/)?[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(value)
      ? null
      : "value is not a valid host";
  }
  if (/(?:^|_)(?:CENTS|PORT|TIMEOUT_MS|LIMIT|MAX|DAYS|HOURS|MINUTES)$/.test(name)) {
    return /^\d+$/.test(value) ? null : "value must be a whole number";
  }
  if (/(?:^|_)(?:EMAIL)$/.test(name)) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "value is not an email";
  }
  if (/(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD)$/.test(name)) {
    return value.length >= 8 ? null : "credential is too short";
  }
  return null;
}

function liveValueProblems(name, env) {
  const value = String(env?.[name] ?? "").trim();
  if (!value) return ["value is missing"];
  if (MASK_RE.test(value) || /\*{4,}/.test(value)) return ["value is masked"];
  const shapeProblem = valueShape(name, value);
  return shapeProblem ? [shapeProblem] : [];
}

export function evaluateKeyHealth(row, env = {}, references = []) {
  const name = String(row?.env_name || "").trim();
  const problems = [];
  if (!KEY_NAME_RE.test(name)) problems.push("invalid env name");
  if (row?.surface !== `env:${name}`) problems.push("surface does not match env name");
  if (!String(row?.control || "").startsWith(`${name}:`)) problems.push("control does not name the key");
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) problems.push("map names no reader");
  if (!Array.isArray(references) || references.length < 1) problems.push("repo code has no reader");

  problems.push(...liveValueProblems(name, env));

  return {
    ok: problems.length === 0,
    name,
    problems,
    referenceCount: Array.isArray(references) ? references.length : 0,
  };
}

export function keyHealthProof(row) {
  if (!["money", "customerMessage", "customerData"].includes(row?.impact)) return null;
  if (!KEY_NAME_RE.test(String(row?.env_name || "").trim())) return null;
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) return null;
  return {
    depth: "deep",
    evidence: KEY_HEALTH_EVIDENCE,
    asserts: row.control,
  };
}

function isUnset(name, env) {
  return String(env?.[name] ?? "").trim() === "";
}

/**
 * Is this unset key unset on purpose, right now? Returns null when it is, or the problem when it is
 * not. `parked` memoises one parked-feature read per feature for the run.
 */
async function unsetProblem(name, env, ctx, parked) {
  const rule = Object.hasOwn(UNSET_IS_FINE, name) ? UNSET_IS_FINE[name] : null;
  if (!rule) return "value is missing";
  if (rule.when === "fallback") {
    const usable = rule.use.find((other) =>
      liveValueProblems(other, env).length === 0 &&
      (!rule.minLength || String(env[other]).trim().length >= rule.minLength));
    return usable ? null : `value is missing, and so is a usable ${rule.use.join(" or ")}`;
  }
  if (rule.when === "only-when") {
    const chosen = String(env?.[rule.onlyWhen.name] ?? "").trim();
    return chosen === rule.onlyWhen.is ? `value is missing, and ${rule.onlyWhen.name} is ${rule.onlyWhen.is}` : null;
  }
  if (rule.when === "parked") {
    if (!parked.has(rule.feature)) parked.set(rule.feature, parkedState(rule.feature, { scope: ctx.scope, env, now: ctx.now }));
    const state = await parked.get(rule.feature);
    return state && state.parked ? null : `value is missing, and ${rule.feature} is in use (${state ? state.why : "no answer"})`;
  }
  return UNSET_KINDS.includes(rule.when) ? null : "value is missing";
}

export async function gapChecks(ctx = {}) {
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;
  const keyNames = keyNamesFromCatalog(ctx.catalog || await compiledCatalog());
  const parked = new Map();
  const failures = [];
  const onPurpose = [];
  for (const name of keyNames) {
    if (isUnset(name, env)) {
      const problem = await unsetProblem(name, env, ctx, parked);
      if (problem) failures.push({ name, problems: [problem] });
      else onPurpose.push(name);
      continue;
    }
    const problems = liveValueProblems(name, env);
    if (problems.length) failures.push({ name, problems });
  }
  const set = keyNames.length - onPurpose.length;
  const purpose = onPurpose.length
    ? ` ${onPurpose.length} more are unset on purpose (a built-in value, a fallback key, no live reader, switched off, or a parked feature).`
    : "";
  const status = failures.length === 0 ? "PASS" : "FAIL";
  const detail = failures.length === 0
    ? `${set}/${keyNames.length} sensitive live keys are present and correctly shaped.${purpose} No values were returned.`
    : `${failures.length}/${keyNames.length} sensitive live keys need attention: ${failures.map(({ name, problems }) => `${name} (${problems.join(", ")})`).join("; ")}.${purpose} No values were returned.`;

  return [{
    id: CHECK_IDS[0],
    status,
    detail,
    suggestedFix: failures.length
      ? "Set or repair only the named live variables. Never paste their values into logs."
      : null,
  }];
}
