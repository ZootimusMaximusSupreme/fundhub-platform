// Read-only saved-result judge for display controls. Browser contracts prove
// the action. This lane checks the stored result fields promised by that action.

import {
  DISPLAY_RESULT_TABLE_RULES,
  displaySavedResultTable,
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
    return Object.freeze({
      id: `catalog-display:${proofCase.sourceFile}:${proofCase.surface}:${proofCase.control}`,
      sourceFile: proofCase.sourceFile,
      surface: proofCase.surface,
      control: proofCase.control,
      table: displaySavedResultTable(row),
    });
  })
  .filter((entry) => entry.table));

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
            table: saved?.table || null,
            retired: isRetiredAutopsy(row),
          })];
        }))
      .filter(Boolean),
  ).values(),
]);

export const CHECK_IDS = Object.freeze(DISPLAY_TRACKING_CASES.map((entry) => entry.id));
export const TABLE_NAMES = Object.freeze([...new Set(DISPLAY_TRACKING_CASES.map((entry) => entry.table).filter(Boolean))].sort());
const BATCH_SIZE = 10;

function present(field) {
  return `NULLIF(BTRIM(COALESCE(to_jsonb(t)->>'${field}', '')), '') IS NOT NULL`;
}

function completeCondition(rule) {
  const all = rule.all.map(present);
  const any = (rule.any || []).map(present);
  return [...all, ...(any.length ? [`(${any.join(" OR ")})`] : [])].join(" AND ");
}

function selectFor(table) {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return `SELECT '${table}'::text AS table_name, count(*)::int AS row_count, `
    + `count(*) FILTER (WHERE ${completeCondition(DISPLAY_RESULT_TABLE_RULES[table])})::int AS complete_count `
    + `FROM ${quoted} t `
    + `WHERE ($1::text IS NULL OR NOT (to_jsonb(t) ? 'org_id') OR to_jsonb(t)->>'org_id' = $1::text)`;
}

export const SQL_BATCHES = Object.freeze(Array.from(
  { length: Math.ceil(TABLE_NAMES.length / BATCH_SIZE) },
  (_, index) => TABLE_NAMES.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE)
    .map(selectFor)
    .join("\nUNION ALL\n"),
));

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

export function judgeDisplayResult(entry, stats = {}) {
  if (entry.retired) {
    return result(entry.id, "na", `${entry.control}: the Decline Autopsy page is retired and redirected to the active offer menu.`, null, {
      code: "catalog-display-retired-autopsy",
      args: { sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control },
    });
  }
  if (!entry.table) {
    return result(
      entry.id,
      "FAIL",
      `${entry.surface} — ${entry.control}: no safe executable action/result contract is attached yet.`,
      `Add a local browser action that exercises this exact control and checks its named result. Do not auto-fix. Chris fixes reds.`,
    );
  }
  const rows = Number(stats.row_count || 0);
  const complete = Number(stats.complete_count || 0);
  if (rows === 0) {
    return result(entry.id, "na", `${entry.table} has no saved display result to judge.`, null, {
      code: "catalog-display-empty",
      args: { table: entry.table },
    });
  }
  if (complete === rows) {
    return result(entry.id, "PASS", `${entry.control}: all ${rows} saved ${entry.table} result row${rows === 1 ? "" : "s"} carry the promised result fields.`);
  }
  const bad = Math.max(0, rows - complete);
  return result(
    entry.id,
    "FAIL",
    `${entry.control}: ${bad} of ${rows} saved ${entry.table} result row${rows === 1 ? " is" : "s are"} missing a promised result.`,
    `Open the ${entry.table} rows counted by the display result check and finish the missing result. Do not auto-fix. Chris fixes reds.`,
  );
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

function skipped(entry, error) {
  const message = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
  return result(entry.id, "skip", `${entry.table} was not read: ${message}.`);
}

export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return DISPLAY_TRACKING_CASES.map((entry) => (
      entry.table ? skipped(entry, "no database in this run") : judgeDisplayResult(entry)
    ));
  }

  const byTable = new Map();
  for (let index = 0; index < SQL_BATCHES.length; index += 1) {
    const tables = TABLE_NAMES.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    try {
      const answer = await run((db) => db.query(SQL_BATCHES[index], [ctx.orgId || null]));
      for (const row of answer?.rows || []) byTable.set(String(row.table_name), row);
    } catch (error) {
      for (const table of tables) byTable.set(table, { error });
    }
  }

  return DISPLAY_TRACKING_CASES.map((entry) => {
    if (!entry.table) return judgeDisplayResult(entry);
    const stats = byTable.get(entry.table);
    if (!stats) return skipped(entry, "the batch returned no result");
    if (stats.error) return skipped(entry, stats.error);
    return judgeDisplayResult(entry, stats);
  });
}

async function tableStats(table, ctx = {}) {
  const run = reader(ctx);
  if (!run || !TABLE_NAMES.includes(table)) return null;
  const answer = await run((db) => db.query(selectFor(table), [ctx.orgId || null]));
  return answer?.rows?.[0] || null;
}

export const naVerify = Object.freeze({
  "catalog-display-empty": async (args, ctx = {}) => {
    const stats = await tableStats(String(args?.table || ""), ctx);
    return Number(stats?.row_count || 0) === 0;
  },
  "catalog-display-retired-autopsy": async (args) => {
    if (String(args?.sourceFile || "") !== "public-pages.json") return false;
    if (!String(args?.surface || "").includes("partner/autopsy/index.html")) return false;
    const config = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
    return /from\s*=\s*"\/partner\/autopsy\/\*"[\s\S]{0,160}to\s*=\s*"\/partner\/menu\/"[\s\S]{0,80}status\s*=\s*302/.test(config);
  },
});
