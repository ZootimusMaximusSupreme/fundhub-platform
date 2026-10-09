// Beat: do the vendors still take our keys? Text (Twilio), email (Resend), payments (Commas).
//
// READ ONLY. One GET to each vendor, nothing sent, nothing changed. Each one proves the live key
// is ACCEPTED, the same way src/pulse/coverage/gap-keys.mjs does (those reads were proven on live
// data on 2026-10-09; the URLs, headers and the "accepted" rules below are copied from probeTwilio,
// probeResend and probeCommas there):
//
//   twilio-key  GET <twilio>/2010-04-01/Accounts/<sid>.json    basic auth    200 and account not suspended/closed
//   resend-key  GET <resend>/domains                           bearer        200, or 401 "restricted_api_key" (a send-only key is fine)
//   commas-key  GET <commas>/checkout-sessions/transactions?page=1&per_page=1   x-api-key   200 with status "success"
//
// Red: the vendor turned the key away (401/403; Resend 400 "API key is invalid"), or the account is
// closed. A vendor that does not answer well (5xx, timeout, odd answer) is also red, and it is damp 2:
// the runner texts only when two runs in a row are red, because a vendor can have a bad moment.
// A key that is missing or a mask: on a LAPTOP (ctx.live false) that is a skip, because a laptop holds
// masks. On the SERVER (ctx.live true) it is RED at that vendor's step: without the key no text, email
// or checkout can work, and a green hour would hide it. (The names are in Netlify's functions scope,
// so the function can read them.) A base-URL setting that sends the call to a host this beat did not
// declare is always a skip, never a red; on the server the green detail says NOT CHECKED.
//
// THE KEY LEAVES THIS PROCESS IN ONE HEADER, TO ONE HOST. The probe follows redirects by hand and
// drops key headers on any other host. This beat never prints a key, an account id or a response
// body: the body is read only for a status word.

import { BeatFail, isMasked } from "./contract.mjs";

export const id = "vendor-keys";
export const title = "Text, email and payment keys";
export const kind = "probe";
export const covers = [];
export const box = false;
export const damp = 2;
export const deadlineMs = 10000;

export const TWILIO_HOST = "api.twilio.com";
export const RESEND_HOST = "api.resend.com";
// The default base of the Commas checkout API (DEFAULT_CHECKOUT_API_BASE in src/payments/commas-api.mjs).
export const COMMAS_HOST = "www.fanbasis.com";
export const COMMAS_DEFAULT_BASE = `https://${COMMAS_HOST}/public-api`;
// checkoutConfig() takes the first of these that is not empty. Same order.
export const COMMAS_KEY_ENVS = Object.freeze(["CORTANA_COMMAS_API_KEY", "FANBASIS_CHECKOUT_API_KEY"]);
export const COMMAS_BASE_ENV = "FANBASIS_CHECKOUT_API_BASE";

export const reads = [
  { host: TWILIO_HOST, methods: ["GET"] },
  { host: RESEND_HOST, methods: ["GET"] },
  { host: COMMAS_HOST, methods: ["GET"] }
];

export const steps = ["twilio-key", "resend-key", "commas-key"];

export const fixGuide = `A vendor turned our key away. Put the new key on Netlify without --secret, then ship once.

Likely causes:
- twilio-key: the Twilio text key was rotated or revoked, or the Twilio account is suspended or closed. No customer text can leave.
- resend-key: the Resend email key was rotated or revoked (Resend answers 400 or 401). No email can leave.
- commas-key: the Commas checkout key was rotated or revoked. The $297 checkout cannot make a card page. CORTANA_COMMAS_API_KEY is tried first, then FANBASIS_CHECKOUT_API_KEY.
- A 5xx or no answer is the vendor having a bad moment. This beat needs two reds in a row before it texts.
Steps:
- Get the new key from the vendor and set it on Netlify production WITHOUT --secret, so the laptop can read it back. Save the full value in .env and credentials/ first.
- Never delete or clear the old key. Set a new value and leave the old one where it is.
- Ship once with npm run ship, then watch the next hour.
- If a vendor is down, wait. Do not change the key.
Files: src/pulse/coverage/gap-keys.mjs, src/payments/commas-api.mjs, src/messaging/providers/twilio.mjs, src/messaging/providers/resend.mjs
`;

/* ---------------- planning: which keys can be asked, and how ---------------- */

const text = (v) => String(v ?? "").trim();

/** The vendor's own https address, or null if the setting points somewhere else. */
function baseFor(override, host, fallback) {
  const raw = text(override);
  if (!raw) return fallback;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== host || url.port || url.username || url.password) return null;
  return `https://${host}${url.pathname.replace(/\/+$/, "")}`;
}

function planTwilio(env) {
  const sid = text(env.TWILIO_SEND_ACCOUNT_SID);
  const token = text(env.TWILIO_SEND_AUTH_TOKEN);
  if (isMasked(sid) || isMasked(token)) {
    const names = [isMasked(sid) ? "TWILIO_SEND_ACCOUNT_SID" : "", isMasked(token) ? "TWILIO_SEND_AUTH_TOKEN" : ""].filter(Boolean).join(" and ");
    return { missing: names, gone: "No customer text can leave." };
  }
  const base = baseFor(env.TWILIO_SEND_BASE_URL, TWILIO_HOST, `https://${TWILIO_HOST}`);
  if (!base) return { skip: `TWILIO_SEND_BASE_URL points somewhere other than ${TWILIO_HOST}, which this beat did not declare` };
  return {
    url: `${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, Accept: "application/json" }
  };
}

function planResend(env) {
  const key = text(env.RESEND_API_KEY);
  if (isMasked(key)) return { missing: "RESEND_API_KEY", gone: "No email can leave." };
  const base = baseFor(env.RESEND_BASE_URL, RESEND_HOST, `https://${RESEND_HOST}`);
  if (!base) return { skip: `RESEND_BASE_URL points somewhere other than ${RESEND_HOST}, which this beat did not declare` };
  return { url: `${base}/domains`, headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } };
}

function planCommas(env) {
  let key = "";
  for (const name of COMMAS_KEY_ENVS) {
    const v = text(env[name]);
    if (v) { key = v; break; }
  }
  if (isMasked(key)) return { missing: COMMAS_KEY_ENVS.join(" and "), gone: "No buyer can get a card page." };
  const base = baseFor(env[COMMAS_BASE_ENV], COMMAS_HOST, COMMAS_DEFAULT_BASE);
  if (!base) return { skip: `${COMMAS_BASE_ENV} points somewhere other than ${COMMAS_HOST}, which this beat did not declare` };
  return { url: `${base}/checkout-sessions/transactions?page=1&per_page=1`, headers: { "x-api-key": key, accept: "application/json" } };
}

/* ---------------- judging: one answer to one sentence ---------------- */

/** The JSON of an answer, or null. Read for a status word only, never shown. */
function jsonOf(res) {
  try {
    const parsed = JSON.parse(String(res.body || res.bodySnippet || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Common to all three: the answers that are not about the key at all. Returns a note, or null if it is a normal HTTP answer. */
function noAnswer(res, who) {
  if (res.class === "blocked") return "The pulse's own web fence is holding its calls (ADAPTERS_DRY_RUN), so " + who + " was not asked.";
  if (res.class === "refused") return `The pulse refused the call to ${who}.`;
  if (!res.status) return `${who} did not answer (${res.class || "network"}).`;
  return null;
}

/** Returns null when the key is accepted, or a short plain sentence when it is not. */
export function judgeTwilio(res) {
  const quiet = noAnswer(res, "Twilio");
  if (quiet) return quiet;
  if (res.status === 401 || res.status === 403) return `Twilio refused our text key (HTTP ${res.status}). No text can leave.`;
  if (res.status === 200) {
    const status = String(jsonOf(res)?.status ?? "").toLowerCase();
    if (status === "suspended" || status === "closed") return `Twilio took the key, but the account is ${status}. No text can leave.`;
    return null;
  }
  return `Twilio answered HTTP ${res.status}, so the text key is not proved.`;
}

export function judgeResend(res) {
  const quiet = noAnswer(res, "Resend");
  if (quiet) return quiet;
  if (res.status === 200) return null;
  const body = jsonOf(res);
  // A key that can only send mail is turned away from the domain list with this exact word.
  // Resend knew the key to say so, so the key is good.
  if (res.status === 401 && body?.name === "restricted_api_key") return null;
  if (res.status === 400 && /api key is invalid/i.test(String(body?.message ?? ""))) return "Resend says our email key is invalid (HTTP 400). No email can leave.";
  if (res.status === 401 || res.status === 403) return `Resend refused our email key (HTTP ${res.status}). No email can leave.`;
  return `Resend answered HTTP ${res.status}, so the email key is not proved.`;
}

export function judgeCommas(res) {
  const quiet = noAnswer(res, "Commas");
  if (quiet) return quiet;
  if (res.status === 200) {
    return jsonOf(res)?.status === "success" ? null : "Commas answered 200 in a shape we do not know, so the checkout key is not proved.";
  }
  if (res.status === 401 || res.status === 403) return `Commas refused our checkout key (HTTP ${res.status}). No buyer can get a card page.`;
  return `Commas answered HTTP ${res.status}, so the checkout key is not proved.`;
}

const VENDORS = [
  { step: "twilio-key", name: "Twilio", plan: planTwilio, judge: judgeTwilio },
  { step: "resend-key", name: "Resend", plan: planResend, judge: judgeResend },
  { step: "commas-key", name: "Commas", plan: planCommas, judge: judgeCommas }
];

export async function run(ctx) {
  // Start every call that can go out FIRST, so the three vendors are asked side by side and the
  // beat takes one vendor's time, not three. Each step then waits for its own answer.
  const jobs = VENDORS.map((v) => {
    const plan = v.plan(ctx.env);
    return { ...v, plan, call: plan.url ? ctx.http.get(plan.url, { headers: plan.headers }) : null };
  });

  const reds = [];
  const ok = [];
  for (const job of jobs) {
    if (!job.call) {
      if (job.plan.missing && ctx.live) {
        // On the server a missing or star-only key is the break itself.
        try {
          await ctx.step(job.step, async () => {
            throw ctx.fail(job.step, `${job.plan.missing} ${job.plan.missing.includes(" and ") ? "are" : "is"} empty or only stars on the server. ${job.plan.gone}`);
          });
        } catch (err) {
          if (err instanceof BeatFail) reds.push(err);
          else throw err;
        }
        continue;
      }
      ctx.skipStep(job.step, `${job.name} was not asked: ${job.plan.skip || `${job.plan.missing} is missing or a mask here (a laptop holds masks)`}`);
      continue;
    }
    try {
      await ctx.step(job.step, async () => {
        const res = await job.call;
        const bad = job.judge(res);
        if (bad) throw ctx.fail(job.step, bad);
      });
      ok.push(job.name);
    } catch (err) {
      if (err instanceof BeatFail) reds.push(err);
      else throw err;
    }
  }

  if (reds.length) {
    if (reds.length === 1) throw reds[0];
    throw ctx.fail(reds[0].step, reds.map((r) => r.detail).join(" "));
  }
  const skipped = jobs.filter((j) => !j.call).map((j) => j.name);
  // A skip on the server (an off-host base-URL setting) means a key went unchecked. Say so in plain words.
  const notChecked = ctx.live && skipped.length ? ` NOT CHECKED on the server: ${skipped.join(", ")}.` : "";
  return ctx.done(
    ok.length
      ? `${ok.join(", ")} took our key${ok.length === 1 ? "" : "s"}.${skipped.length ? ` Not asked: ${skipped.join(", ")}.` : ""}${notChecked}`
      : `No key was asked (${skipped.join(", ")}).${notChecked}`
  );
}

/* ---- self test ---- */

const FAKE_ENV = {
  TWILIO_SEND_ACCOUNT_SID: "ACselftest0000000000000000000000",
  TWILIO_SEND_AUTH_TOKEN: "selftest-twilio-token-not-real",
  RESEND_API_KEY: "selftest-resend-key-not-real",
  CORTANA_COMMAS_API_KEY: "selftest-commas-key-not-real"
};
const URLS = {
  twilio: `GET https://${TWILIO_HOST}/2010-04-01/Accounts/ACselftest0000000000000000000000.json`,
  resend: `GET https://${RESEND_HOST}/domains`,
  commas: `GET ${COMMAS_DEFAULT_BASE}/checkout-sessions/transactions?page=1&per_page=1`
};
const ALL_OK = {
  [URLS.twilio]: { status: 200, body: '{"status":"active"}' },
  [URLS.resend]: { status: 200, body: '{"data":[]}' },
  [URLS.commas]: { status: 200, body: '{"status":"success","data":{}}' }
};

export const selfTest = {
  pass: () => ({ env: FAKE_ENV, http: ALL_OK }),
  // Resend turns the key away: the beat must go red at resend-key.
  fail: () => ({
    env: FAKE_ENV,
    http: { ...ALL_OK, [URLS.resend]: { status: 400, body: '{"message":"API key is invalid"}' } }
  })
};
