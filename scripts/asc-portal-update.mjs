#!/usr/bin/env node
/**
 * Send the Fundhub iPhone app update (1.0.1, build 4: the Mac welcome screen)
 * to App Review as soon as iOS 1.0 is approved.
 *
 * Owner call 2026-10-21: "Let Apple approve build 2 first, then send build 4
 * as an update right away." Build 4 is already uploaded (version 1.0.1).
 *
 * Safe to re-run every few minutes:
 *   - 1.0 not approved yet       → prints the state, writes nothing
 *   - 1.0.1 already in review    → prints the state, writes nothing
 *   - 1.0 approved (or live)     → creates 1.0.1 if missing, attaches build 4,
 *                                  sets What's New, submits for review
 *
 *   node --env-file=.env scripts/asc-portal-update.mjs          # dry-run
 *   node --env-file=.env scripts/asc-portal-update.mjs --apply
 *
 * Keys: ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH (gitignored .env).
 */
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const APP_ID = "6823985032"; // Fundhub Portal, bundle ai.fundhub.app
const NEW_VERSION = "1.0.1";
const NEW_BUILD = "4";
const WHATS_NEW = "A new welcome screen: tap Team sign-in or Client sign-in to get started.";
const APPROVED = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "PENDING_DEVELOPER_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "PROCESSING_FOR_APP_STORE"]);
const DONE = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE", "READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "PROCESSING_FOR_DISTRIBUTION"]);
const APPLY = process.argv.includes("--apply");

function jwt() {
  const { ASC_ISSUER_ID: iss, ASC_KEY_ID: kid, ASC_KEY_PATH: path } = process.env;
  if (!iss || !kid || !path) throw new Error("ASC_ISSUER_ID, ASC_KEY_ID and ASC_KEY_PATH must be set.");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid, typ: "JWT" });
  const body = b64({ iss, iat: now, exp: now + 900, aud: "appstoreconnect-v1" });
  const sig = createSign("SHA256").update(`${head}.${body}`)
    .sign({ key: readFileSync(path.replace(/^~/, process.env.HOME)), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const token = jwt();
async function asc(method, path, body) {
  const r = await fetch("https://api.appstoreconnect.apple.com" + path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(json.errors || json).slice(0, 400)}`);
  return json;
}

const versions = (await asc("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10&fields[appStoreVersions]=versionString,appVersionState,appStoreState`)).data;
const v10 = versions.find((v) => v.attributes.versionString === "1.0");
const v101 = versions.find((v) => v.attributes.versionString === NEW_VERSION);
const state = (v) => v ? (v.attributes.appVersionState || v.attributes.appStoreState) : "none";
console.log(`iOS 1.0: ${state(v10)} · iOS ${NEW_VERSION}: ${state(v101)}`);

if (v101 && DONE.has(state(v101))) { console.log(`${NEW_VERSION} is already sent. Nothing to do.`); process.exit(0); }
if (!v10 || !APPROVED.has(state(v10))) { console.log("1.0 is not approved yet. Waiting."); process.exit(0); }

const builds = (await asc("GET", `/v1/builds?filter[app]=${APP_ID}&filter[version]=${NEW_BUILD}&filter[preReleaseVersion.version]=${NEW_VERSION}&fields[builds]=version,processingState,usesNonExemptEncryption`)).data;
const build = builds.find((b) => b.attributes.processingState === "VALID");
if (!build) { console.log(`Build ${NEW_BUILD} (${NEW_VERSION}) is not VALID yet. Waiting.`); process.exit(0); }

if (!APPLY) { console.log(`1.0 is approved. Would create ${NEW_VERSION}, attach build ${NEW_BUILD} and submit. Dry run.`); process.exit(0); }

if (build.attributes.usesNonExemptEncryption == null) {
  await asc("PATCH", `/v1/builds/${build.id}`, { data: { type: "builds", id: build.id, attributes: { usesNonExemptEncryption: false } } });
}

let versionId = v101?.id;
if (!versionId) {
  versionId = (await asc("POST", "/v1/appStoreVersions", { data: {
    type: "appStoreVersions",
    attributes: { platform: "IOS", versionString: NEW_VERSION },
    relationships: { app: { data: { type: "apps", id: APP_ID } } }
  } })).data.id;
  console.log(`created ${NEW_VERSION}`);
}
await asc("PATCH", `/v1/appStoreVersions/${versionId}/relationships/build`, { data: { type: "builds", id: build.id } });
console.log(`attached build ${NEW_BUILD}`);

const locs = (await asc("GET", `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`)).data;
for (const l of locs) {
  await asc("PATCH", `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: "appStoreVersionLocalizations", id: l.id, attributes: { whatsNew: WHATS_NEW } } });
}
console.log(`What's New set on ${locs.length} language(s)`);

const sub = (await asc("POST", "/v1/reviewSubmissions", { data: {
  type: "reviewSubmissions",
  attributes: { platform: "IOS" },
  relationships: { app: { data: { type: "apps", id: APP_ID } } }
} })).data;
await asc("POST", "/v1/reviewSubmissionItems", { data: {
  type: "reviewSubmissionItems",
  relationships: {
    reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } },
    appStoreVersion: { data: { type: "appStoreVersions", id: versionId } }
  }
} });
await asc("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } });
const after = (await asc("GET", `/v1/appStoreVersions/${versionId}?fields[appStoreVersions]=versionString,appVersionState`)).data;
console.log(`SUBMITTED ${NEW_VERSION} build ${NEW_BUILD}: ${after.attributes.appVersionState}`);
