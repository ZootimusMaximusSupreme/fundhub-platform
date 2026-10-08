// Partner training gaps for the morning pulse. Report only. Read only.
// Never marks a partner certified. Never edits the training page.
//
// Slice 22 and slice 31 already list partner-training.html and
// read/partner-training on the morning watch list. This file does not
// repeat that list. It looks for two breaks they miss: the training page
// or the training read is dead, and a required training step cannot be read.
//
// Tripwire is existing Recon (AG-07). No second watchdog.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODULES } from "../../training/curriculum.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHECK_IDS = Object.freeze([
  "training:page",
  "training:read-api",
  "training:required-step"
]);

export const PAGE_PATH = "/app/partner-training.html";
export const READ_PATH = "/api/read/partner-training";

/** Titles a partner must be able to read. Same list the curriculum publishes. */
export const REQUIRED_STEP_SQL = `
  SELECT code, btrim(coalesce(title, '')) AS title
    FROM training_modules
   WHERE org_id = $1::uuid
   ORDER BY position`;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not mark anyone certified. Do not edit the training page from this check.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).slice(0, 160);
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function origin(baseUrl) {
  return String(baseUrl || "https://fundhub.ai").trim().replace(/\/+$/, "") || "https://fundhub.ai";
}

function listCodes(codes) {
  return codes.join(", ");
}

function assertSelect(sql) {
  const s = String(sql).trim().toLowerCase();
  if (!s.startsWith("select")) throw new Error("gap-training is read-only");
  if (/\b(insert|update|delete|drop|alter|truncate)\b/.test(s)) {
    throw new Error("gap-training is read-only");
  }
}

/** True when the training page still has a place to show a step and still calls the read. */
export function trainingPageWired(readText = defaultReadText) {
  const html = readText("public/app/partner-training.html");
  const js = readText("public/app/partner-training.js");
  const shell = html.includes('id="trModules"') && html.includes("partner-training.js");
  const reads = js.includes("/api/read/partner-training") && js.includes("m.title");
  return shell && reads;
}

/** True when GET read/partner-training is still routed and still reads. */
export function trainingReadWired(readText = defaultReadText) {
  const api = readText("netlify/functions/api.mjs");
  const handler = readText("api/read/partner-training.mjs");
  const imported = /import readPartnerTraining from ["'][^"']*partner-training\.mjs["']/.test(api);
  const routed = /["']read\/partner-training["']\s*:\s*readPartnerTraining/.test(api);
  const get =
    /req\.method !== ["']GET["']/.test(handler) &&
    /export default async function handler/.test(handler);
  const reads = /fetchTraining\(/.test(handler);
  return imported && routed && get && reads;
}

/** True when the training read still returns the step title. */
export function requiredStepReadable(readText = defaultReadText) {
  const progress = readText("src/training/progress.mjs");
  return /m\.title/.test(progress) && /FROM training_modules/.test(progress);
}

function pageBodyAlive(text) {
  const html = String(text || "");
  return html.includes("partner-training.js") && html.includes('id="trModules"');
}

function readAlive(status) {
  return (status >= 200 && status < 300) || status === 400 || status === 401 || status === 403;
}

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept }
  });
  let text = "";
  try {
    text = typeof res.text === "function" ? await res.text() : "";
  } catch {
    text = "";
  }
  return { status: Number(res && res.status), text: String(text || "") };
}

function stepGaps(rows) {
  const byCode = new Map();
  for (const row of rows || []) {
    const code = String(row.code || "").trim().toLowerCase();
    if (!code) continue;
    byCode.set(code, String(row.title || "").trim());
  }
  const missing = [];
  const blank = [];
  for (const mod of MODULES) {
    if (!byCode.has(mod.code)) missing.push(mod.code);
    else if (!byCode.get(mod.code)) blank.push(mod.code);
  }
  return { missing, blank };
}

function stepSentence({ missing, blank }) {
  if (missing.length === MODULES.length && blank.length === 0) {
    return `none of the ${MODULES.length} required training steps are in the list`;
  }
  const bits = [];
  if (missing.length) {
    bits.push(
      `${listCodes(missing)} ${missing.length === 1 ? "is" : "are"} not in the curriculum`
    );
  }
  if (blank.length) {
    bits.push(`${listCodes(blank)} ${blank.length === 1 ? "has" : "have"} no title`);
  }
  return bits.join("; ");
}

async function checkPage({ fetchImpl, baseUrl, readText }) {
  const id = "training:page";
  const parts = [];
  let wired = false;
  try {
    wired = trainingPageWired(readText);
  } catch (err) {
    parts.push(`training page could not be read (${clip(err)})`);
  }
  if (!wired && parts.length === 0) parts.push("the training page no longer shows a step");

  let called = false;
  if (typeof fetchImpl === "function") {
    called = true;
    const url = `${origin(baseUrl)}${PAGE_PATH}`;
    try {
      const { status, text } = await readGet(fetchImpl, url, "text/html");
      if (status === 404) parts.push("training page answered 404");
      else if (status < 200 || status >= 300) parts.push(`training page answered ${status}`);
      else if (!pageBodyAlive(text)) parts.push("training page answered but a step cannot be shown");
    } catch (err) {
      parts.push(`training page unreachable (${clip(err)})`);
    }
  }

  if (parts.length > 0) {
    return check(
      id,
      "FAIL",
      `Training page is dead: ${parts.join("; ")}.`,
      `${TRIPWIRE} Put the training page back at ${PAGE_PATH}.`
    );
  }
  if (!called) {
    return check(id, "skip", "training page not opened this run");
  }
  return check(id, "PASS", "training page loaded");
}

async function checkReadApi({ fetchImpl, baseUrl, readText }) {
  const id = "training:read-api";
  const parts = [];
  let wired = false;
  try {
    wired = trainingReadWired(readText);
  } catch (err) {
    parts.push(`training read could not be checked (${clip(err)})`);
  }
  if (!wired && parts.length === 0) parts.push("route is not wired");

  let called = false;
  if (typeof fetchImpl === "function") {
    called = true;
    const url = `${origin(baseUrl)}${READ_PATH}`;
    try {
      const { status } = await readGet(fetchImpl, url, "application/json");
      if (!readAlive(status)) parts.push(`${READ_PATH} answered ${status}`);
    } catch (err) {
      parts.push(`unreachable (${clip(err)})`);
    }
  }

  if (parts.length > 0) {
    return check(
      id,
      "FAIL",
      `Partner training read is dead: ${parts.join("; ")}.`,
      `${TRIPWIRE} Restore GET ${READ_PATH}.`
    );
  }
  if (!called) {
    return check(id, "skip", "partner training read not called this run");
  }
  return check(id, "PASS", "partner training read answered");
}

async function checkRequiredStep({ db, orgId, readText }) {
  const id = "training:required-step";
  const parts = [];
  let readable = false;
  try {
    readable = requiredStepReadable(readText);
  } catch (err) {
    parts.push(`training read file could not be read (${clip(err)})`);
  }
  if (!readable && parts.length === 0) {
    parts.push("the training read no longer returns the step title");
  }

  if (!db || !orgId) {
    if (parts.length > 0) {
      return check(
        id,
        "FAIL",
        `Required training step cannot be read: ${parts.join("; ")}.`,
        `${TRIPWIRE} Put the step title back on the training read.`
      );
    }
    return check(id, "skip", "no database in this run — required training steps not read");
  }

  try {
    assertSelect(REQUIRED_STEP_SQL);
    const result = await db.query(REQUIRED_STEP_SQL, [orgId]);
    const gaps = stepGaps(result && result.rows);
    if (gaps.missing.length || gaps.blank.length) parts.push(stepSentence(gaps));
  } catch (err) {
    parts.push(`could not read training steps (${clip(err)})`);
  }

  if (parts.length === 0) {
    return check(
      id,
      "PASS",
      `all ${MODULES.length} required training steps have a title a partner can read`
    );
  }
  return check(
    id,
    "FAIL",
    `Required training step cannot be read: ${parts.join("; ")}.`,
    `${TRIPWIRE} Put the missing training step back so a partner can read the title.`
  );
}

/**
 * Three read-only checks. ctx: { db, orgId, fetchImpl, baseUrl, readText }.
 * Each row is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const fetchImpl = ctx.fetchImpl || null;
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const hasDb = Boolean(db && orgId);
  return [
    await checkPage({ fetchImpl, baseUrl: ctx.baseUrl, readText }),
    await checkReadApi({ fetchImpl, baseUrl: ctx.baseUrl, readText }),
    await checkRequiredStep({ db: hasDb ? db : null, orgId, readText })
  ];
}
