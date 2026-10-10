// Partner training gaps for the morning pulse. Report only. Read only.
// Never marks a partner certified. Never edits the training page.
//
// Slice 22 and slice 31 already list partner-training.html and
// read/partner-training on the morning watch list, and the registry pings both
// for a plain up or down. This file does not repeat that. It looks for what
// those pings cannot see: the page loads but cannot show a step, the training
// read crashes behind its sign-in, a required step or gate is gone or blank.
//
// Claude review 2026-10-08: this file used to read the page, the route file and
// the progress file off disk. The morning pulse runs inside a Netlify function
// that does not carry those files, so every row would have failed with "could
// not be read" each morning. It now reads the live page over HTTP and the data
// from the database, and runs the real training read in process.
//
// Tripwire is existing Recon (AG-07). No second watchdog.

import { MODULES, GATES } from "../../training/curriculum.mjs";
import { trainingViewFor } from "../../training/progress.mjs";

export const CHECK_IDS = Object.freeze([
  "training:page",
  "training:read-api",
  "training:required-step"
]);

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const PAGE_PATH = "/app/partner-training.html";
export const SCRIPT_PATH = "/app/partner-training.js";
export const READ_PATH = "/api/read/partner-training";

/** No partner has this id. The curriculum reads the same, with nothing started. */
export const NO_PARTNER_ID = "00000000-0000-0000-0000-000000000000";

/** Titles a partner must be able to read. Same table the training read joins. */
export const REQUIRED_STEP_SQL = `
  SELECT code, btrim(coalesce(title, '')) AS title
    FROM training_modules
   WHERE org_id = $1::uuid
   ORDER BY position`;

/** The four hard gates. Same table the gate standings read. */
export const REQUIRED_GATE_SQL = `
  SELECT code, btrim(coalesce(title, '')) AS title
    FROM training_gates
   WHERE org_id = $1::uuid
   ORDER BY position`;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not mark anyone certified. Do not edit the training page from this check.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err || "error")
    .replace(/postgres(ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function origin(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

function fetcher(ctx) {
  const f = ctx && (ctx.fetchImpl || ctx.fetch);
  return typeof f === "function" ? f : null;
}

function assertSelect(sql) {
  const s = String(sql).trim().toLowerCase();
  if (!s.startsWith("select") || /\b(insert|update|delete|drop|alter|truncate)\b/.test(s)) {
    throw new Error("gap-training is read-only");
  }
}

/** Run a read as staff when the pulse gave a staff scope, else on the plain db. */
function withScope(ctx, fn) {
  if (typeof ctx.scope === "function") return ctx.scope(fn);
  return fn(ctx.db);
}

function hasDb(ctx) {
  return Boolean(ctx.db && typeof ctx.db.query === "function" && ctx.orgId);
}

function twoXX(status) {
  return status >= 200 && status < 300;
}

/** The page must still have a place to show a step and still load its script. */
export function pageBodyAlive(text) {
  const html = String(text || "");
  return html.includes("partner-training.js") && html.includes('id="trModules"');
}

/** The script must still call the training read and still print a step title. */
export function scriptReadsTraining(text) {
  const js = String(text || "");
  return js.includes(READ_PATH) && /\.title\b/.test(js);
}

async function readGet(fetchImpl, url, accept) {
  const res = await fetchImpl(url, { method: "GET", headers: { accept } });
  let text = "";
  try {
    text = typeof res.text === "function" ? await res.text() : "";
  } catch {
    text = "";
  }
  return { status: Number(res && res.status), text: String(text || "") };
}

function stepGaps(rows, wanted) {
  const byCode = new Map();
  for (const row of rows || []) {
    const code = String(row.code || "").trim().toLowerCase();
    if (!code) continue;
    byCode.set(code, String(row.title || "").trim());
  }
  const missing = [];
  const blank = [];
  for (const item of wanted) {
    const code = String(item.code).toLowerCase();
    if (!byCode.has(code)) missing.push(item.code);
    else if (!byCode.get(code)) blank.push(item.code);
  }
  return { missing, blank };
}

function gapSentence(noun, wantedCount, { missing, blank }) {
  if (missing.length === wantedCount && blank.length === 0) {
    return `none of the ${wantedCount} required ${noun}s are in the list`;
  }
  const bits = [];
  if (missing.length) {
    bits.push(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in the ${noun} list`);
  }
  if (blank.length) {
    bits.push(`${blank.join(", ")} ${blank.length === 1 ? "has" : "have"} no title`);
  }
  return bits.join("; ");
}

/** The page loads and can still show a step. The registry only needs a 2xx. */
async function checkPage(ctx) {
  const id = "training:page";
  const fetchImpl = fetcher(ctx);
  if (!fetchImpl) return check(id, "skip", "no fetch in this run — training page not opened");
  const base = origin(ctx.baseUrl);
  const parts = [];

  try {
    const page = await readGet(fetchImpl, `${base}${PAGE_PATH}`, "text/html");
    if (!twoXX(page.status)) parts.push(`training page answered ${page.status}`);
    else if (!pageBodyAlive(page.text)) parts.push("training page answered but has no place to show a step");
  } catch (err) {
    parts.push(`training page unreachable (${clip(err)})`);
  }

  try {
    const js = await readGet(fetchImpl, `${base}${SCRIPT_PATH}`, "*/*");
    if (!twoXX(js.status)) parts.push(`training page script answered ${js.status}`);
    else if (!scriptReadsTraining(js.text)) {
      parts.push("training page script no longer calls the training read or no longer prints a step title");
    }
  } catch (err) {
    parts.push(`training page script unreachable (${clip(err)})`);
  }

  if (parts.length) {
    return check(
      id,
      "FAIL",
      `Training page is dead: ${parts.join("; ")}.`,
      `${TRIPWIRE} Put the training page back at ${PAGE_PATH}.`
    );
  }
  return check(id, "PASS", "training page loaded, shows a step, and calls the training read");
}

/**
 * The read behind GET /api/read/partner-training, run in process for a partner
 * that does not exist. The sign-in in front of it answers 401 whether or not
 * the read underneath works; this runs the read itself. Read only.
 */
async function checkReadApi(ctx) {
  const id = "training:read-api";
  if (!hasDb(ctx)) return check(id, "skip", "no database in this run — the training read was not run");
  try {
    const view = await withScope(ctx, (tx) => trainingViewFor(tx, { orgId: ctx.orgId, partnerId: NO_PARTNER_ID }));
    const modules = Array.isArray(view && view.modules) ? view.modules.length : 0;
    const gates = Array.isArray(view && view.gates) ? view.gates.length : 0;
    if (!view || modules === 0 || gates !== GATES.length) {
      return check(
        id,
        "FAIL",
        `Partner training read ran but came back wrong: ${modules} steps and ${gates} gates (expected ${MODULES.length} steps and ${GATES.length} gates).`,
        `${TRIPWIRE} Restore the curriculum rows GET ${READ_PATH} reads.`
      );
    }
    return check(id, "PASS", `the training read ran in process: ${modules} steps and ${gates} gates came back`);
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Partner training read crashed: ${clip(err)}.`,
      `${TRIPWIRE} Restore GET ${READ_PATH} so a partner can open the training.`
    );
  }
}

/** Every required step and every hard gate is on file with a title a partner can read. */
async function checkRequiredStep(ctx) {
  const id = "training:required-step";
  if (!hasDb(ctx)) return check(id, "skip", "no database in this run — required training steps not read");
  const parts = [];
  try {
    assertSelect(REQUIRED_STEP_SQL);
    assertSelect(REQUIRED_GATE_SQL);
    const [steps, gates] = await withScope(ctx, async (tx) => ([
      await tx.query(REQUIRED_STEP_SQL, [ctx.orgId]),
      await tx.query(REQUIRED_GATE_SQL, [ctx.orgId])
    ]));
    const stepGap = stepGaps(steps && steps.rows, MODULES);
    if (stepGap.missing.length || stepGap.blank.length) {
      parts.push(gapSentence("training step", MODULES.length, stepGap));
    }
    const gateGap = stepGaps(gates && gates.rows, GATES);
    if (gateGap.missing.length || gateGap.blank.length) {
      parts.push(gapSentence("training gate", GATES.length, gateGap));
    }
  } catch (err) {
    parts.push(`could not read training steps (${clip(err)})`);
  }
  if (parts.length) {
    return check(
      id,
      "FAIL",
      `Required training step cannot be read: ${parts.join("; ")}.`,
      `${TRIPWIRE} Put the missing training step or gate back so a partner can read the title.`
    );
  }
  return check(
    id,
    "PASS",
    `all ${MODULES.length} required training steps and ${GATES.length} gates have a title a partner can read`
  );
}

/**
 * Three read-only checks. ctx: { db, scope, orgId, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  return [
    await checkPage(ctx),
    await checkReadApi(ctx),
    await checkRequiredStep(ctx)
  ];
}
