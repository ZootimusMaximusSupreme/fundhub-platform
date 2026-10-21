// Keys and switches for the morning pulse. Report only.
//
// These six checks read server settings (ctx.env), one setting row (the company
// send switch), and ask the text, email and checkout vendors one read-only
// question each. They catch the break that leaves launch day silent: a lock on
// customer messages that is closed, a hand-off key to the workflow engine that
// is empty, a signing secret that is a row of asterisks, a credit pull that is
// pointed at the vendor's test host, a text, email or checkout key the vendor
// now refuses.
//
// Rules this file keeps:
//   - Names only in any output. A value is never printed, not even a flag value.
//   - GET only. Nothing is sent, nothing is written, no AI call, no credit pull.
//     The database reads are one SELECT on ctx.db (the send switch), no BEGIN,
//     COMMIT or SET on it, and one SELECT through the staff view (ctx.scope) that
//     asks whether Lendflow is still paused (src/pulse/parked-features.mjs).
//   - A vendor key goes only to that vendor's own host, never follows a redirect
//     (redirect: "manual"), and is never printed.
//   - No repo file is read at run time. The live bundle does not carry them.
//   - A setting read on a laptop is the laptop's copy, not the live site, so the
//     setting checks say skip there. A key that is a row of asterisks on a
//     laptop is skip, not a break. On the live server it is a break.
//   - A read that did not come back is skip, never PASS.
//
// Where a check differs from the plan in
// ops/workflows/heartbeat-complete-2026-10-09-worklist.md, the reason is next to
// the code and in ops/workflows/heartbeat-gaps-2026-10-08/keys.md.
//
// keys:launch-secrets-present, its key list and the settings helpers live in
// src/pulse/beats/lib/keys-truth.mjs (2026-10-20), so the hourly beat bank-links
// judges the launch keys with the same function as this lane.

import { fenceVerdict, MESSAGING_DRY_RUN, ADAPTERS_DRY_RUN } from "../../lib/dry-run.mjs";
// The checkout mint picks its key and its address here. The check asks the vendor
// about the SAME key the mint would use, so the two cannot drift apart.
import { checkoutConfig, CHECKOUT_API_KEY_ENVS } from "../../payments/commas-api.mjs";
import { parkedState } from "../parked-features.mjs";
import {
  FIX, SAY, SKIP_NO_ENV, TAIL, keyState, launchSecretsPresent, lendflowParkedKeys, row, settingsGate
} from "../beats/lib/keys-truth.mjs";

import { creditPullLiveAllowed } from "../beats/lib/credit-pull-key-truth.mjs";

export * from "../beats/lib/keys-truth.mjs";
// keys:credit-pull-live-allowed lives in src/pulse/beats/lib/credit-pull-key-truth.mjs (2026-10-20), so the
// hourly beat soft-pull judges it with the same function as this lane.
export { CRS_LOGIN_KEYS, creditPullLiveAllowed } from "../beats/lib/credit-pull-key-truth.mjs";

export const CHECK_IDS = Object.freeze([
  "keys:send-fence-open",
  "keys:inngest-event-key",
  "keys:launch-secrets-present",
  "keys:credit-pull-live-allowed",
  "keys:vendor-key-read",
  "keys:checkout-key-read"
]);

/** The two keys between the app and the workflow engine (src/workflows/index.mjs says both). */
export const INNGEST_KEYS = Object.freeze(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]);

export const TWILIO_DEFAULT_BASE = "https://api.twilio.com";
export const RESEND_DEFAULT_BASE = "https://api.resend.com";
/** One vendor read may take this long. Three run side by side, so the lane stays well under 20 s. */
export const PROBE_TIMEOUT_MS = 8000;
/** The one database read (the company send switch) may take this long. */
export const DB_READ_TIMEOUT_MS = 5000;

const FENCE_CORE =
  "Set MESSAGING_DRY_RUN and ADAPTERS_DRY_RUN to 0 on Netlify (production) and ship once. Unset, empty or on all hold the sends. " +
  "Do not read the values out loud.";
const SWITCH_CORE =
  "Press Turn sending on at https://fundhub.ai/app/ops-admin.html. If the pause was on purpose, this red is the reminder that texts and emails are still waiting.";


function clip(value, n = 160) {
  return String((value && value.message) || value || "").replace(/\s+/g, " ").trim().slice(0, n);
}

// ── 1. The locks on customer messages ──────────────────────────────────────
// Three locks sit between a queued text or email and the customer:
//   MESSAGING_DRY_RUN   server setting, holds every customer message
//   ADAPTERS_DRY_RUN    server setting, holds every call to an outside service
//   outbound_enabled    the company send switch in the CRM (messaging_settings),
//                       a pause button an owner can press
// The first two are read from ctx.env. The third is one SELECT on ctx.db. A
// missing row means "on": src/messaging/outbox.mjs settingsFor says so, because a
// company made after the table must not silently stop sending.

const SWITCH_SQL = "SELECT outbound_enabled FROM messaging_settings WHERE org_id = $1::uuid LIMIT 1";

function fenceWords(name, verdict) {
  if (verdict.allowed) return null;
  return verdict.value === null
    ? `${name} is not set`
    : `${name} is on, or holds a value that is not an off value`;
}

/** { state: "on" | "off" | "missing" | "unread", why? }. A read that failed is "unread", never "on". */
export async function readSendSwitch(db, orgId, timeoutMs = DB_READ_TIMEOUT_MS) {
  if (!db || typeof db.query !== "function") {
    return { state: "unread", why: "No database came with this run, so the company send switch was not read." };
  }
  if (!orgId) {
    return { state: "unread", why: "No company id came with this run, so the company send switch was not read." };
  }
  try {
    const res = await raceTimeout(Promise.resolve(db.query(SWITCH_SQL, [orgId])), timeoutMs, "The database");
    const rows = res && res.rows;
    if (!Array.isArray(rows)) {
      return { state: "unread", why: "The database answered without a row list, so the company send switch was not read." };
    }
    if (!rows[0]) return { state: "missing" };
    // The sender holds on any falsy value (src/messaging/outbox.mjs: !settings.outbound_enabled).
    return rows[0].outbound_enabled ? { state: "on" } : { state: "off" };
  } catch (err) {
    return { state: "unread", why: `The company send switch could not be read: ${clip(err)}.` };
  }
}

export async function sendFenceOpen({ env, db, orgId, dbTimeoutMs = DB_READ_TIMEOUT_MS } = {}) {
  const id = "keys:send-fence-open";
  const envGate = settingsGate(id, env);
  const sw = await readSendSwitch(db, orgId, dbTimeoutMs);

  const closed = [];
  const open = [];
  const unread = [];
  const fixCores = [];

  if (envGate) {
    unread.push(envGate.detail);
  } else {
    const messaging = fenceVerdict(MESSAGING_DRY_RUN, env);
    const adapters = fenceVerdict(ADAPTERS_DRY_RUN, env);
    if (!messaging.allowed) {
      closed.push(`${fenceWords(MESSAGING_DRY_RUN, messaging)}, so every text and email to a customer is held in the queue`);
    }
    if (!adapters.allowed) {
      closed.push(`${fenceWords(ADAPTERS_DRY_RUN, adapters)}, so every call to an outside service is held (the credit pull, funnel contacts, ad events, bank sync)`);
    }
    if (closed.length) fixCores.push(FENCE_CORE);
    else open.push(`Both server settings (${MESSAGING_DRY_RUN} and ${ADAPTERS_DRY_RUN}) are set to an off value.`);
  }

  if (sw.state === "off") {
    closed.push("The company send switch in the CRM (messaging_settings.outbound_enabled) is off, so every text and email to a customer waits in the queue");
    fixCores.push(SWITCH_CORE);
  } else if (sw.state === "on") {
    open.push("The company send switch in the CRM is on.");
  } else if (sw.state === "missing") {
    open.push("The company has no send-switch row, which the sender treats as on.");
  } else {
    unread.push(sw.why);
  }

  if (closed.length) {
    const tail = unread.length ? ` ${unread.join(" ")}` : "";
    return row(id, "FAIL", `${closed.join(". ")}.${tail}`, `${fixCores.join(" ")} ${TAIL}`);
  }
  if (unread.length) return row(id, "skip", `${[...open, ...unread].join(" ")}`);
  return row(
    id,
    "PASS",
    `All three locks on customer messages are open. ${open.join(" ")} Quiet hours and the compliance gate still judge each message.`
  );
}

// ── 2. The hand-off to the workflow engine ─────────────────────────────────

export function inngestEventKey(env) {
  const id = "keys:inngest-event-key";
  const gate = settingsGate(id, env);
  if (gate) return gate;

  const parts = [];
  const eventState = keyState(env, "INNGEST_EVENT_KEY");
  if (eventState !== "ok") {
    parts.push(
      `INNGEST_EVENT_KEY ${SAY[eventState]}. The app saves the event, then skips the hand-off, so every workflow that starts from an event ` +
      `(payment, booking, welcome, consent) never starts. The timed jobs keep running, so nothing else looks wrong.`
    );
  }
  const signState = keyState(env, "INNGEST_SIGNING_KEY");
  if (signState !== "ok") {
    parts.push(
      `INNGEST_SIGNING_KEY ${SAY[signState]}. The workflow engine cannot call the app, so no workflow starts.`
    );
  }
  if (parts.length) return row(id, "FAIL", parts.join(" "), FIX.inngest);
  return row(id, "PASS", "Both Inngest keys are set to real values. The app can hand work to the workflow engine, and the engine can call back.");
}

// ── 5. Do the text and email keys work? ────────────────────────────────────
// One GET to each vendor. Nothing is sent. The answer bodies are read for a
// status word only and are never put in the output: the Twilio account answer
// carries the account's own token.
//
// THE KEY GOES TO ONE HOST ONLY. Every probe sends redirect: "manual", so a vendor
// that answers with a redirect cannot carry our key to another address (fetch
// strips the Authorization header across hosts, but not a custom header such as
// x-api-key). A redirect answer is skip. The three hosts, from the vendors' own
// published addresses: api.twilio.com, api.resend.com, www.fanbasis.com.
//
// The plan said Resend answers 401 or 403 to a bad key. Measured 2026-10-09 with
// a throwaway key: Resend answers HTTP 400, "API key is invalid". A rule that
// watched for 401 and 403 only would have stayed green on a dead key.

function httpsBase(raw, fallback) {
  const base = String(raw == null || String(raw).trim() === "" ? fallback : raw).trim().replace(/\/+$/, "");
  return /^https:\/\//i.test(base) ? base : null;
}

async function readJson(res) {
  try {
    const text = await res.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function raceTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function get(fetchImpl, url, headers, timeoutMs, what) {
  const init = { method: "GET", headers, redirect: "manual" };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  return raceTimeout(Promise.resolve(fetchImpl(url, init)), timeoutMs + 500, what);
}

export async function probeTwilio({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  const sid = String(env.TWILIO_SEND_ACCOUNT_SID || "").trim();
  const token = String(env.TWILIO_SEND_AUTH_TOKEN || "").trim();
  for (const [name, v] of [["TWILIO_SEND_ACCOUNT_SID", sid], ["TWILIO_SEND_AUTH_TOKEN", token]]) {
    if (!v) return { vendor: "Twilio", status: "skip", note: `Twilio was not asked: ${name} is not set here.` };
    if (/\*{4,}/.test(v)) return { vendor: "Twilio", status: "skip", note: `Twilio was not asked: ${name} is a row of asterisks in this run.` };
  }
  const base = httpsBase(env.TWILIO_SEND_BASE_URL, TWILIO_DEFAULT_BASE);
  if (!base) return { vendor: "Twilio", status: "skip", note: "Twilio was not asked: TWILIO_SEND_BASE_URL is not an https address." };

  let res;
  try {
    res = await get(
      fetchImpl,
      `${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
      { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, Accept: "application/json" },
      timeoutMs,
      "Twilio"
    );
  } catch (err) {
    return { vendor: "Twilio", status: "skip", note: `Twilio could not be reached: ${clip(err)}.` };
  }
  const code = res && res.status;
  if (code === 401 || code === 403) {
    const body = await readJson(res);
    const vendorCode = body && Number.isFinite(Number(body.code)) ? `, Twilio code ${Number(body.code)}` : "";
    return { vendor: "Twilio", status: "FAIL", note: `Twilio refused our text key (HTTP ${code}${vendorCode}). No text can leave.` };
  }
  if (code === 200) {
    const body = await readJson(res);
    const account = body && typeof body.status === "string" ? body.status.toLowerCase() : null;
    if (account === "suspended" || account === "closed") {
      return { vendor: "Twilio", status: "FAIL", note: `Twilio took the key, but the account is ${account}. No text can leave.` };
    }
    return { vendor: "Twilio", status: "PASS", note: "Twilio took the text key and the account is open." };
  }
  return { vendor: "Twilio", status: "skip", note: `Twilio answered HTTP ${code}, so the text key was not proved.` };
}

export async function probeResend({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  const key = String(env.RESEND_API_KEY || "").trim();
  if (!key) return { vendor: "Resend", status: "skip", note: "Resend was not asked: RESEND_API_KEY is not set here." };
  if (/\*{4,}/.test(key)) return { vendor: "Resend", status: "skip", note: "Resend was not asked: RESEND_API_KEY is a row of asterisks in this run." };
  const base = httpsBase(env.RESEND_BASE_URL, RESEND_DEFAULT_BASE);
  if (!base) return { vendor: "Resend", status: "skip", note: "Resend was not asked: RESEND_BASE_URL is not an https address." };

  let res;
  try {
    res = await get(fetchImpl, `${base}/domains`, { Authorization: `Bearer ${key}`, Accept: "application/json" }, timeoutMs, "Resend");
  } catch (err) {
    return { vendor: "Resend", status: "skip", note: `Resend could not be reached: ${clip(err)}.` };
  }
  const code = res && res.status;
  if (code === 200) return { vendor: "Resend", status: "PASS", note: "Resend took the email key." };

  const body = await readJson(res);
  const name = body && typeof body.name === "string" ? body.name : "";
  const message = body && typeof body.message === "string" ? body.message : "";
  // A key that can only send mail is turned away from the domain list with this
  // exact word. Resend knew the key to say so, so the key is good.
  if (code === 401 && name === "restricted_api_key") {
    return { vendor: "Resend", status: "PASS", note: "Resend took the email key (a send-only key, which is all we need)." };
  }
  if (code === 400 && /api key is invalid/i.test(message)) {
    return { vendor: "Resend", status: "FAIL", note: "Resend says our email key is invalid (HTTP 400). No email can leave." };
  }
  if (code === 401 || code === 403) {
    const why = name ? `, ${name}` : "";
    return { vendor: "Resend", status: "FAIL", note: `Resend refused our email key (HTTP ${code}${why}). No email can leave.` };
  }
  return { vendor: "Resend", status: "skip", note: `Resend answered HTTP ${code}, so the email key was not proved.` };
}

export async function probeVendors({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  return Promise.all([
    probeTwilio({ env, fetchImpl, timeoutMs }),
    probeResend({ env, fetchImpl, timeoutMs })
  ]);
}

export async function vendorKeyRead({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  const id = "keys:vendor-key-read";
  if (!env || typeof env !== "object") return row(id, "skip", SKIP_NO_ENV);
  if (typeof fetchImpl !== "function") {
    return row(id, "skip", "No web client came with this run, so the text and email vendors were not asked.");
  }
  const results = await probeVendors({ env, fetchImpl, timeoutMs });
  const notes = results.map((r) => r.note).join(" ");
  if (results.some((r) => r.status === "FAIL")) return row(id, "FAIL", notes, FIX.vendor);
  if (results.every((r) => r.status === "PASS")) return row(id, "PASS", notes);
  return row(id, "skip", notes);
}

// ── 6. Does the checkout key work? ─────────────────────────────────────────
// A key can be set and still be dead: on 2026-09-29 the stored FANBASIS value
// answered 401 on every Commas route, and every $297 mint failed while the
// setting looked fine. A presence check cannot see that, so this asks Commas.
//
// The read is GET /public-api/checkout-sessions/transactions?page=1&per_page=1,
// the list route src/merchant/providers/commas.mjs already reads. Measured
// 2026-10-09: the real checkout key answers HTTP 200 {status: "success",
// data: {transactions, pagination}}; a throwaway key answers HTTP 401
// {status: "error", message: "Invalid API key or unauthorized user context"}.
// The row never reads the transaction itself: one row is asked for, and the
// answer is read for its status word and nothing else.
//
// Which key: checkoutConfig() from src/payments/commas-api.mjs, so it is the key
// the mint would use (CORTANA_COMMAS_API_KEY first, FANBASIS second).

export async function probeCommas({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  const cfg = checkoutConfig(env);
  if (!cfg.ok) {
    return { vendor: "Commas", status: "skip", note: `Commas was not asked: no checkout key is set here (${CHECKOUT_API_KEY_ENVS.join(" or ")}).` };
  }
  if (/\*{4,}/.test(cfg.apiKey)) {
    return { vendor: "Commas", status: "skip", note: `Commas was not asked: ${cfg.keyEnv} is a row of asterisks in this run.` };
  }
  if (!/^https:\/\//i.test(cfg.base)) {
    return { vendor: "Commas", status: "skip", note: "Commas was not asked: the checkout address is not an https address." };
  }

  let res;
  try {
    res = await get(
      fetchImpl,
      `${cfg.base}/checkout-sessions/transactions?page=1&per_page=1`,
      { "x-api-key": cfg.apiKey, accept: "application/json" },
      timeoutMs,
      "Commas"
    );
  } catch (err) {
    return { vendor: "Commas", status: "skip", note: `Commas could not be reached: ${clip(err)}.` };
  }
  const code = res && res.status;
  if (code === 200) {
    const body = await readJson(res);
    if (body && body.status === "success") {
      return { vendor: "Commas", status: "PASS", note: `Commas took the checkout key (${cfg.keyEnv}).` };
    }
    return { vendor: "Commas", status: "skip", note: `Commas answered HTTP 200 in a shape this check does not know, so the checkout key (${cfg.keyEnv}) was not proved.` };
  }
  if (code === 401 || code === 403) {
    return { vendor: "Commas", status: "FAIL", note: `Commas refused the checkout key ${cfg.keyEnv} (HTTP ${code}). No buyer can get a card page.` };
  }
  return { vendor: "Commas", status: "skip", note: `Commas answered HTTP ${code}, so the checkout key (${cfg.keyEnv}) was not proved.` };
}

export async function checkoutKeyRead({ env, fetchImpl, timeoutMs = PROBE_TIMEOUT_MS }) {
  const id = "keys:checkout-key-read";
  if (!env || typeof env !== "object") return row(id, "skip", SKIP_NO_ENV);
  if (typeof fetchImpl !== "function") {
    return row(id, "skip", "No web client came with this run, so Commas was not asked about the checkout key.");
  }
  const r = await probeCommas({ env, fetchImpl, timeoutMs });
  if (r.status === "FAIL") return row(id, "FAIL", r.note, FIX.checkout);
  return row(id, r.status, r.note);
}

/**
 * Six tripwires on the settings and keys behind launch-day texts, emails, payments and credit pulls.
 * ctx: { env, db, scope, orgId, now, fetchImpl | fetch }. One SELECT of the company send switch on db, and one
 * read-only Lendflow park read through scope.
 */
export async function gapChecks(ctx = {}) {
  const c = ctx || {};
  const env = c.env && typeof c.env === "object" ? c.env : null;
  const fetchImpl = typeof c.fetchImpl === "function" ? c.fetchImpl : (typeof c.fetch === "function" ? c.fetch : null);

  const rows = [];
  try {
    rows.push(await sendFenceOpen({ env, db: c.db, orgId: c.orgId }));
  } catch (err) {
    rows.push(row("keys:send-fence-open", "skip", `The locks on customer messages could not be read: ${clip(err)}.`));
  }
  // Owner answer B8 (2026-10-20): Lendflow is paused. Its webhook secret is not judged
  // only while the same read the Lendflow row uses says it is still not in use.
  const lendflow = env
    ? await parkedState("lendflow", { scope: typeof c.scope === "function" ? c.scope : null, env, now: c.now })
    : { parked: false };
  const parked = lendflowParkedKeys(lendflow);
  rows.push(
    inngestEventKey(env),
    launchSecretsPresent(env, { parked }),
    creditPullLiveAllowed(env)
  );
  // The vendor reads run side by side, so the lane stays under one probe time, not three.
  const [vendor, checkout] = await Promise.all([
    vendorKeyRead({ env, fetchImpl }).catch((err) =>
      row("keys:vendor-key-read", "skip", `The text and email vendors could not be asked: ${clip(err)}.`)),
    checkoutKeyRead({ env, fetchImpl }).catch((err) =>
      row("keys:checkout-key-read", "skip", `Commas could not be asked about the checkout key: ${clip(err)}.`))
  ]);
  rows.push(vendor, checkout);
  return rows;
}
