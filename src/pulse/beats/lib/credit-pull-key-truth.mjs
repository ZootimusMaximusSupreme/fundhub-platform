// Is a real credit pull allowed on the live site? Read only: it reads settings, never a vendor.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This check and the setting helpers it needs used to live in
// src/pulse/coverage/gap-keys.mjs. They moved here unchanged so the morning lane (which imports them
// back) and the hourly beat soft-pull give the same verdict. A beat may import only from
// src/pulse/beats/lib, so the four host rules are copies of src/finance/crs-identities.mjs
// (normalizeHost, isSandboxHost, isProductionHost, livePullAllowed), held equal by a drift test in
// beat-soft-pull.test.mjs.
//
//   keys:credit-pull-live-allowed   CRS_ALLOW_LIVE is an explicit on value, CRS_API_HOST is the
//                                   production credit host, and the CRS login is set to real values
//
// The settings are judged only on the live server (a Netlify or Lambda marker). On a laptop the
// settings are a copy, often masks, so the row is a skip there, never a red and never a green.

// The setting helpers are shared with the launch-keys check (keys-truth.mjs): one copy, re-exported here
// so the morning lane and the soft-pull beat keep their imports.
import { FIX, SAY, SKIP_LAPTOP, SKIP_NO_ENV, keyState, onServer, row, settingsGate } from "./keys-truth.mjs";

export { SAY, SKIP_LAPTOP, SKIP_NO_ENV, keyState, onServer, row, settingsGate };

/** The two hosts the credit pull knows (src/finance/crs-identities.mjs). */
export const CRS_SANDBOX_HOST = "api-sandbox.stitchcredit.com";
export const CRS_PRODUCTION_HOST = "mware.crscreditapi.com";
/** The allow-live switch (src/finance/crs-identities.mjs CRS_ALLOW_LIVE). */
export const CRS_ALLOW_LIVE = "CRS_ALLOW_LIVE";
const MEANS_LIVE = new Set(["1", "true", "yes", "on"]);

/** The three settings a real credit pull needs, besides the allow-live switch and the host. */
export const CRS_LOGIN_KEYS = Object.freeze(["CRS_API_USERNAME", "CRS_API_PASSWORD"]);

export const CRS_FIX = FIX.crs;

/** Copy of normalizeHost (src/finance/crs-identities.mjs): a pasted scheme, port or path does not change the host. */
export function normalizeHost(raw) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split("/")[0];
  s = s.split("@").pop();
  s = s.replace(/:\d+$/, "");
  return s;
}

export function isSandboxHost(host) {
  return normalizeHost(host) === CRS_SANDBOX_HOST;
}

export function isProductionHost(host) {
  return normalizeHost(host) === CRS_PRODUCTION_HOST;
}

/** Copy of livePullAllowed: true only when CRS_ALLOW_LIVE is an explicit on value. */
export function livePullAllowed(env = {}) {
  const raw = env?.[CRS_ALLOW_LIVE];
  if (raw === undefined || raw === null || String(raw).trim() === "") return false;
  return MEANS_LIVE.has(String(raw).trim().toLowerCase());
}

// What decides real or fake is the host, the allow-live switch and the login. There is no
// CRS_PROVIDER setting: the provider is a constant, and "simulated" is an argument a caller passes.
export function creditPullLiveAllowed(env) {
  const id = "keys:credit-pull-live-allowed";
  const gate = settingsGate(id, env);
  if (gate) return gate;

  const bad = [];
  if (!livePullAllowed(env)) {
    bad.push("CRS_ALLOW_LIVE is not set to an explicit on value (1, true, yes or on), so the pull refuses the real credit host");
  }
  const host = normalizeHost(env.CRS_API_HOST);
  if (!host) {
    bad.push("CRS_API_HOST is not set, so no pull can start");
  } else if (isSandboxHost(host)) {
    bad.push("CRS_API_HOST points at the vendor's test host, so a pull returns the vendor's made-up people, not the buyer");
  } else if (!isProductionHost(host)) {
    bad.push("CRS_API_HOST is not a host the credit pull accepts");
  }
  for (const name of CRS_LOGIN_KEYS) {
    const state = keyState(env, name);
    if (state !== "ok") bad.push(`${name} ${SAY[state]}`);
  }
  if (bad.length) return row(id, "FAIL", `A paying customer would not get a real credit pull. ${bad.join(". ")}.`, CRS_FIX);
  return row(id, "PASS", "A real credit pull is allowed: CRS_ALLOW_LIVE is on, CRS_API_HOST is the production credit host, and the CRS login is set.");
}
