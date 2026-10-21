// The launch keys truth: keys:launch-secrets-present, the settings helpers it stands on, and the
// one read that says whether Lendflow is still paused. The morning lane gap-keys.mjs and the
// hourly beat bank-links both run it.
//
// Moved here unchanged from src/pulse/coverage/gap-keys.mjs (2026-10-20), so the daily and the
// hourly judge with one function. The Lendflow park read (LENDFLOW_PARK, lendflowParked) is a copy
// of src/pulse/parked-features.mjs "lendflow", because a beat may import only from this folder;
// beat-bank-links.test.mjs holds the copy equal to the original (same settings, same SQL, same
// answer on the same rows).
//
// Names only, never a value. Settings come in as `env` (ctx.env), never from the process.

/**
 * Keys the launch needs on the live site. Names are the ones the code reads:
 * src/http/router.mjs (webhook secrets), src/payments/commas-api.mjs (checkout),
 * src/messaging/providers/resend.mjs and twilio.mjs (mail and text).
 *
 * THE CHECKOUT KEY HAS TWO NAMES (src/payments/commas-api.mjs, CHECKOUT_API_KEY_ENVS).
 * The mint tries CORTANA_COMMAS_API_KEY first and FANBASIS_CHECKOUT_API_KEY second.
 * The FANBASIS value is the dead one (it answered 401 on every Commas route when
 * measured 2026-09-29, and the owner law keeps a stored key in place), so:
 *   - CORTANA_COMMAS_API_KEY is watched strictly: empty or a mask is a red,
 *     because the mint would then use the dead key or none.
 *   - FANBASIS_CHECKOUT_API_KEY is "set only" (setOnly): it is red only when it
 *     is empty, because the closer deck, payment links and partner add-ons refuse
 *     to build a link when it is empty. A mask there is not a red: the card page
 *     does not use that value first, and its real health is read by
 *     keys:checkout-key-read, which asks Commas about the key the mint would use.
 *
 * Added 2026-10-10 (coverage batch W5, owner brief): the bank-login and receipt
 * keys that no lane watched. Each is read by code that runs for a client:
 *   PLAID_CLIENT_ID, PLAID_SECRET   connect a bank and the daily bank sync
 *                                   (src/banking/plaid.mjs REQUIRED_ENV)
 *   PLAID_TOKEN_ENC_KEY             locks every stored bank login (same list)
 *   MERCHANT_SECRET_ENC_KEY         locks a client's processor key and webhook secret
 *                                   (src/merchant/secrets.mjs)
 *   FINANCE_OS_SETUP_FEE_CENTS      the FinanceOS setup price (src/finance/money-setup.mjs)
 *   LENDFLOW_WEBHOOK_SECRET         signs the bank-decision webhook (src/http/router.mjs)
 *   RESEND_WEBHOOK_SECRET           signs email delivery receipts (src/http/router.mjs)
 *   TWILIO_AUTH_TOKEN               signs inbound texts and text receipts (src/http/router.mjs)
 * The last two are the receipt keys: with them empty, a sent message never
 * becomes delivered. The test below reads each name from the code that uses it.
 * "Set and not a mask" is all this lane judges. Whether Plaid accepts the key is
 * not asked here (that needs a Plaid call, and a pulse never calls Plaid).
 *
 * Left out on purpose, each with the reason:
 *   LENDFLOW_API_KEY      Lendflow submit has no caller and the alt-fin rail is off
 *                         the screens. (Its webhook secret is on the list above, by
 *                         the owner's W5 brief.)
 *   UNSUBSCRIBE_TOKEN_SECRET  opt-out:unsubscribe-link signs and checks a real link.
 *                         It also falls back to DOCUMENT_URL_SECRET.
 *   META_CAPI_ACCESS_TOKEN    optional: the token falls back to ad_platform_connections
 *                         (src/meta/token.mjs). meta-server-events watches the result.
 *   META_PIXEL_ID         optional: the code falls back to a built-in pixel id.
 *   CRS_API_*             read by keys:credit-pull-live-allowed, so one break is one red.
 */
export const LAUNCH_SECRETS = Object.freeze([
  { name: "CORTANA_COMMAS_API_KEY", what: "the $297 card page" },
  { name: "FANBASIS_CHECKOUT_API_KEY", what: "the closer deck and payment links refuse to build a link without it", setOnly: true },
  { name: "COMMAS_WEBHOOK_SECRET", what: "payment receipts" },
  { name: "CLICKFUNNELS_WEBHOOK_SECRET", what: "new leads and bookings" },
  { name: "BLAND_WEBHOOK_SECRET", what: "AI call results" },
  { name: "INQUIRY_REMOVAL_WEBHOOK_SECRET", what: "inquiry removal results" },
  { name: "POSTGRID_API_KEY", what: "paper letters" },
  { name: "POSTGRID_WEBHOOK_SECRET", what: "letter delivery receipts" },
  { name: "RESEND_API_KEY", what: "email" },
  { name: "RESEND_FROM", what: "email" },
  { name: "TWILIO_SEND_ACCOUNT_SID", what: "texts" },
  { name: "TWILIO_SEND_AUTH_TOKEN", what: "texts" },
  { name: "TWILIO_SEND_FROM", what: "texts" },
  { name: "PLAID_CLIENT_ID", what: "connecting a bank and the daily bank sync" },
  { name: "PLAID_SECRET", what: "connecting a bank and the daily bank sync" },
  { name: "PLAID_TOKEN_ENC_KEY", what: "the lock on every stored bank login" },
  { name: "MERCHANT_SECRET_ENC_KEY", what: "the lock on a client's processor key" },
  { name: "FINANCE_OS_SETUP_FEE_CENTS", what: "the FinanceOS setup price" },
  { name: "LENDFLOW_WEBHOOK_SECRET", what: "bank decision receipts" },
  { name: "RESEND_WEBHOOK_SECRET", what: "email delivery receipts" },
  { name: "TWILIO_AUTH_TOKEN", what: "inbound texts and text delivery receipts" }
].map((row) => Object.freeze(row)));

export const TAIL = "Chris fixes reds. Do not change it from this pulse.";

// Most of the keys in credentials/env.full.snapshot are rows of asterisks (the
// Netlify list placeholder), so no fix text points there for a value. The place
// a full value lives is the vendor's own dashboard.
export const FIX = Object.freeze({
  inngest:
    "Set the missing Inngest key on Netlify (production) to the full value from the Inngest dashboard, not a masked copy, then ship once. " + TAIL,
  secrets:
    "Get the full value of each named key from the vendor's own dashboard and set it on Netlify (production). " +
    "Do not copy it from credentials/env.full.snapshot: most keys there are rows of asterisks. " +
    "Never delete the old value first. Ship once. " + TAIL,
  crs:
    "Fix the named CRS setting on Netlify (production): CRS_ALLOW_LIVE must be 1, CRS_API_HOST must be the production credit host, " +
    "and CRS_API_USERNAME and CRS_API_PASSWORD must be the full values from the credit vendor. Ship once. " + TAIL,
  vendor:
    "The vendor refused the key we hold. Check the key in the vendor's own dashboard and set a good one on Netlify (production). " +
    "Never delete the old value first. " + TAIL,
  checkout:
    "Commas refused the checkout key (CORTANA_COMMAS_API_KEY, or FANBASIS_CHECKOUT_API_KEY when that one is empty). " +
    "In Commas, open Account, then API Keys, and check the key is live and can read payments. " +
    "Set a good one on Netlify (production). Never delete the old value first. " + TAIL
});

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** True inside the deployed function (Netlify runs functions on Lambda), false on a laptop. */
export function onServer(env) {
  return !!(env && (env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT || env.NETLIFY));
}

/** "ok", "empty" (unset or blank) or "mask" (a row of asterisks, the Netlify list placeholder). */
export function keyState(env, name) {
  const v = String(env && env[name] != null ? env[name] : "").trim();
  if (!v) return "empty";
  if (/\*{4,}/.test(v)) return "mask";
  return "ok";
}

export const SAY = Object.freeze({ empty: "is not set", mask: "is a row of asterisks, not a real value" });

export const SKIP_NO_ENV = "No settings came with this run, so nothing was read.";
export const SKIP_LAPTOP =
  "This run is not the live server (no Netlify or Lambda marker), so its settings are a laptop copy and were not read as the live site's.";

/** A skip row when the settings cannot speak for the live site, else null. */
export function settingsGate(id, env) {
  if (!env || typeof env !== "object") return row(id, "skip", SKIP_NO_ENV);
  if (!onServer(env)) return row(id, "skip", SKIP_LAPTOP);
  return null;
}

// ── 3. Every key the launch needs ──────────────────────────────────────────

/**
 * `parked` (optional): [{ name, why }] keys of a feature the owner parked, which the caller
 * has just proved is still not in use (src/pulse/parked-features.mjs). An unset parked key
 * is named as not judged, never counted as set. A parked key that IS set is judged as usual.
 */
export function launchSecretsPresent(env, { parked = [] } = {}) {
  const id = "keys:launch-secrets-present";
  const gate = settingsGate(id, env);
  if (gate) return gate;

  const parkedBy = new Map((Array.isArray(parked) ? parked : []).map((p) => [p && p.name, p]));
  const bad = [];
  const notJudged = [];
  for (const { name, what, setOnly } of LAUNCH_SECRETS) {
    const state = keyState(env, name);
    if (state === "ok") continue;
    // A set-only key is red when it is empty and fine when it holds anything (see the list above).
    if (setOnly && state === "mask") continue;
    if (parkedBy.has(name)) {
      notJudged.push(`${name} (${parkedBy.get(name).why})`);
      continue;
    }
    bad.push({ name, what, state });
  }
  const tail = notJudged.length ? ` Not judged: ${notJudged.join("; ")}.` : "";
  if (!bad.length) {
    const judged = LAUNCH_SECRETS.length - notJudged.length;
    return row(id, "PASS", `All ${judged} launch keys ${notJudged.length ? "judged " : ""}are set to real values on the live site.${tail}`);
  }
  const list = bad.map((b) => `${b.name} ${SAY[b.state]} (${b.what})`).join("; ");
  const noun = bad.length === 1 ? "key" : "keys";
  return row(id, "FAIL", `${bad.length} launch ${noun} not usable on the live site: ${list}.${tail}`, FIX.secrets);
}

/* Owner answer B8 (2026-10-20): Lendflow is paused. Its webhook secret is not judged only while
   the same read the Lendflow row uses says it is still not in use. Both the lane and the beat
   build the `parked` list for launchSecretsPresent with this. */
export function lendflowParkedKeys(state) {
  return state && state.parked
    ? [{ name: "LENDFLOW_WEBHOOK_SECRET", why: `Lendflow is paused by the owner and not in use: ${state.why}` }]
    : [];
}

// ── The Lendflow park read (copy of src/pulse/parked-features.mjs "lendflow") ──

export const LENDFLOW_PARK = Object.freeze({
  env: Object.freeze(["LENDFLOW_WEBHOOK_SECRET", "LENDFLOW_API_KEY"]),
  sql: `
      /* parked:lendflow */
      SELECT count(*)::int AS captures FROM webhook_captures WHERE provider = 'lendflow'`,
  judge(r) {
    const captures = count(r.captures);
    if (captures === null) return { parked: false, why: "the Lendflow webhook count did not come back" };
    if (captures > 0) return { parked: false, why: `${captures} Lendflow ${captures === 1 ? "webhook was" : "webhooks were"} received` };
    return { parked: true, why: "no Lendflow key is set and no Lendflow webhook was ever received" };
  }
});

/** A count the read really sent: a finite number, or null. A missing answer is not zero. */
function count(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Unset, empty, or a row of asterisks (the Netlify list placeholder). */
function unusable(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  return s === "" || s.startsWith("*") || /\*{4,}/.test(s);
}

/**
 * Is Lendflow still not in use? parkedState("lendflow", { scope, env }) from
 * src/pulse/parked-features.mjs, for a beat: `read(sql, params)` is the beat's read box, which
 * reads through the staff view as that function requires. READ ONLY. Never throws.
 * Returns { parked: boolean, why: string }.
 */
export async function lendflowParked({ read, env } = {}) {
  try {
    const settings = env && typeof env === "object" ? env : {};
    const set = LENDFLOW_PARK.env.filter((name) => !unusable(settings[name]));
    if (set.length) return { parked: false, why: `${set.join(" and ")} ${set.length === 1 ? "is" : "are"} set on the server` };
    if (typeof read !== "function") {
      return { parked: false, why: "this read needs the staff view, and the run has none" };
    }
    const res = await read(LENDFLOW_PARK.sql, []);
    return LENDFLOW_PARK.judge((res && res.rows && res.rows[0]) || {});
  } catch (err) {
    return { parked: false, why: `the read failed: ${String((err && err.message) || err).slice(0, 80)}` };
  }
}

/** keys:launch-secrets-present for a beat: the Lendflow park read, then the lane's verdict. */
export async function runLaunchSecrets({ read, env } = {}) {
  const settings = env && typeof env === "object" ? env : null;
  const state = settings ? await lendflowParked({ read, env: settings }) : { parked: false };
  return launchSecretsPresent(settings, { parked: lendflowParkedKeys(state) });
}
