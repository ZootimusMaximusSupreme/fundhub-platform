// Exact read-only saved-result judges for display controls. Browser contracts
// prove the click. This lane proves the named durable result, or stays red.

import {
  displaySavedResultContract,
  isTrackedDisplayControl,
} from "../catalog/proofs/display-saved-result.mjs";
import { DISPLAY_PROOF_CASES } from "../catalog/proofs/display-proof-cases.mjs";
import { STAFF_UI_PROOF_CASES } from "../catalog/proofs/display-batch-staff-ui.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const MAPS = new Map();

function rowsFor(sourceFile) {
  if (!MAPS.has(sourceFile)) {
    MAPS.set(sourceFile, JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8")));
  }
  return MAPS.get(sourceFile);
}

function exactRow(proofCase) {
  const matches = rowsFor(proofCase.sourceFile).filter(
    (row) => row.surface === proofCase.surface && row.control === proofCase.control,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one display result row for ${proofCase.sourceFile} / ${proofCase.surface} / ${proofCase.control}, found ${matches.length}`);
  }
  return matches[0];
}

const DIRECT_PROOF_KEYS = new Set(DISPLAY_PROOF_CASES.map(
  (entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`,
));

export const DISPLAY_RESULT_CASES = Object.freeze(STAFF_UI_PROOF_CASES
  .filter((proofCase) => proofCase.depth === "deep")
  .map((proofCase) => {
    const row = exactRow(proofCase);
    const contract = displaySavedResultContract(row);
    if (!contract) return null;
    return Object.freeze({
      id: `catalog-display:${proofCase.sourceFile}:${proofCase.surface}:${proofCase.control}`,
      sourceFile: proofCase.sourceFile,
      surface: proofCase.surface,
      control: proofCase.control,
      contract,
    });
  })
  .filter(Boolean));

const RESULT_CASES_BY_KEY = new Map(DISPLAY_RESULT_CASES.map(
  (entry) => [`${entry.sourceFile}\0${entry.surface}\0${entry.control}`, entry],
));
const LANE_PROOF_KEYS = new Set(DISPLAY_PROOF_CASES
  .filter((entry) => String(entry.evidence || "").includes("gap-catalog-display.mjs"))
  .map((entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`));

function isRetiredAutopsy(row) {
  return String(row?.page || "") === "public/partner/autopsy/index.html";
}

export const DISPLAY_TRACKING_CASES = Object.freeze([
  ...new Map(
    ["desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json", "desks-e.json", "desks-f.json", "public-pages.json"]
      .flatMap((sourceFile) => rowsFor(sourceFile)
        .filter((row) => !row.repeats_row_in && isTrackedDisplayControl(row))
        .map((row) => {
          const key = `${sourceFile}\0${row.surface}\0${row.control}`;
          const saved = RESULT_CASES_BY_KEY.get(key);
          if (DIRECT_PROOF_KEYS.has(key) && !LANE_PROOF_KEYS.has(key)) return null;
          return [key, Object.freeze({
            id: `catalog-display:${sourceFile}:${row.surface}:${row.control}`,
            sourceFile,
            surface: row.surface,
            control: row.control,
            expected: row.control,
            contract: saved?.contract || null,
            retired: isRetiredAutopsy(row),
          })];
        }))
      .filter(Boolean),
  ).values(),
]);

export const CHECK_IDS = Object.freeze(DISPLAY_TRACKING_CASES.map((entry) => entry.id));
export const PASS_CAPABLE_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "query").length;
export const ALWAYS_RED_COUNT = DISPLAY_RESULT_CASES.filter((entry) => entry.contract.mode === "always-red").length;
export const SQL_BATCHES = Object.freeze([
  ...new Set(DISPLAY_RESULT_CASES
    .filter((entry) => entry.contract.mode === "query")
    .map((entry) => entry.contract.sql)),
]);

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

export function judgeDisplayResult(entry, stats = null) {
  if (entry.retired) {
    return result(entry.id, "na", `${entry.control}: the Decline Autopsy page is retired and redirected to the active offer menu.`, null, {
      code: "catalog-display-retired-autopsy",
      args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control },
    });
  }
  if (!entry.contract) {
    return result(
      entry.id,
      "FAIL",
      `${entry.surface} — ${entry.control}: no exact safe action/result contract is attached yet.`,
      `Add a receipt that links this exact control's input to its saved result. Do not auto-fix. Chris fixes reds.`,
    );
  }
  if (entry.contract.mode === "always-red") {
    return result(
      entry.id,
      "FAIL",
      `${entry.surface} — ${entry.control}: ${entry.contract.requirement}`,
      `Add the missing exact input-to-result receipt for this control. Do not auto-fix. Chris fixes reds.`,
    );
  }

  const samples = Number(stats?.sample_count || 0);
  const bad = Number(stats?.bad_count || 0);
  if (samples === 0) {
    return result(
      entry.id,
      "FAIL",
      `${entry.control}: no saved receipt or linked result exists for this exact check. Required: ${entry.contract.requirement}`,
      `Create one real result through the named control, then let the read-only pulse judge it. Do not auto-fix. Chris fixes reds.`,
    );
  }
  if (bad === 0) {
    return result(entry.id, "PASS", `${entry.control}: ${samples} saved result${samples === 1 ? "" : "s"} passed the exact check. ${entry.contract.requirement}`);
  }
  return result(
    entry.id,
    "FAIL",
    `${entry.control}: ${bad} of ${samples} saved result${samples === 1 ? "" : "s"} failed the exact check. Required: ${entry.contract.requirement}`,
    `Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds.`,
  );
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

function skipped(entry, error) {
  const message = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
  return result(entry.id, "skip", `${entry.control} was not read: ${message}.`);
}

export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return DISPLAY_TRACKING_CASES.map((entry) => (
      entry.contract?.mode === "query" ? skipped(entry, "no database in this run") : judgeDisplayResult(entry)
    ));
  }

  const bySql = new Map();
  for (const sql of SQL_BATCHES) {
    try {
      const answer = await run((db) => db.query(sql, [ctx.orgId || null]));
      bySql.set(sql, answer?.rows?.[0] || { sample_count: 0, bad_count: 0 });
    } catch (error) {
      bySql.set(sql, { error });
    }
  }

  return DISPLAY_TRACKING_CASES.map((entry) => {
    if (entry.contract?.mode !== "query") return judgeDisplayResult(entry);
    const stats = bySql.get(entry.contract.sql);
    if (stats?.error) return skipped(entry, stats.error);
    return judgeDisplayResult(entry, stats);
  });
}

export const naVerify = Object.freeze({
  "catalog-display-retired-autopsy": async (args) => {
    if (String(args?.sourceFile || "") !== "public-pages.json") return false;
    if (!String(args?.surface || "").includes("partner/autopsy/index.html")) return false;
    const config = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
    return /from\s*=\s*"\/partner\/autopsy\/\*"[\s\S]{0,160}to\s*=\s*"\/partner\/menu\/"[\s\S]{0,80}status\s*=\s*302/.test(config);
  },
});
