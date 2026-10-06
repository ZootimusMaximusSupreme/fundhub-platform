// @ts-check
// One script, one repo file: marketing/ads/scripts/machine/<batch>/<nn>-<slug>.md
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.9 (Repo files), plan unit
// U25. Pure: no clock, no network, no disk. The routes in api/marketing/scripts/*
// (and U35's release step) hand the result to the repo outbox
// (src/repo/outbox.mjs enqueueRepoWrite, mode 'replace') inside the same
// transaction as the database change.
//
//   serializeScript(row) -> {path, content}
//   parseScript(content) -> {ad, version, status, offer, funnel, format, style,
//                            angle, batch, updated_by, updated_at,
//                            body, parts, animation_plan, meta_copy}
//
// THE FILE, TOP TO BOTTOM
//   ---
//   ad: 91                      flat values only: the repo has no YAML library
//   version: 2
//   ...
//   ---
//   <body, byte for byte as the database holds it>
//
//   <!-- DATA_MARKER -->
//   ```json
//   {"parts": [...], "animation_plan": [...], "meta_copy": {...}}
//   ```
//
// WHY THE BODY ALWAYS COMES BACK BYTE FOR BYTE
//   * The front matter ends at the FIRST "\n---\n". A front-matter value never
//     holds a newline (anything that is not a plain token is written as a JSON
//     string, and JSON escapes newlines), so the body cannot end it early.
//   * The data block starts at the LAST "\n\n" + DATA_MARKER + "\n```json\n".
//     That text cannot appear inside the JSON after it: it holds a raw newline,
//     and JSON writes every newline inside a string as \n. So even a body that
//     itself contains the marker is cut in the right place.
//   * Exactly "\n\n" is added between the body and the marker, and exactly that
//     is taken off again. A body that ends with or without a newline, has CRLF
//     line ends, "---" lines or ``` fences comes back the same.
//
// THE PATH NEVER MOVES. It is worked out once, on the script's first save, and
// kept in ad_scripts.repo_path; every later save of any version writes the same
// path. serializeScript uses row.repo_path whenever it is set.

import { createHash } from "node:crypto";

/** Every machine script file lives below this folder (on src/repo/allow-list.mjs). */
export const SCRIPTS_DIR = "marketing/ads/scripts/machine/";

/** The folder for a script whose batch has no week (Write now, or no batch at all). */
export const ON_DEMAND = "on-demand";

/** The front matter keys, in the order they are written (plan contract, U25). */
export const FRONT_MATTER_KEYS = Object.freeze([
  "ad", "version", "status", "offer", "funnel", "format", "style", "angle",
  "batch", "updated_by", "updated_at"
]);

/** The line between the body and the JSON block. Plain words, no em dash. */
export const DATA_MARKER =
  "<!-- fundhub script data: parts, animation_plan and meta_copy. Change them in the app; the database wins. -->";

const TAIL = `\n\n${DATA_MARKER}\n\`\`\`json\n`;
const END = "\n```\n";
const OPEN = "---\n";
const CLOSE = "\n---\n";

/* A value that can be written bare and read back as the same string. Anything
   else (spaces, quotes, a leading dash, the words null/true/false) is written as
   a JSON string. */
const BARE = /^[A-Za-z0-9][A-Za-z0-9_.:+-]*$/;
const RESERVED = /^(null|true|false|~)$/i;

/** @param {unknown} v */
function iso(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** @param {unknown} v @returns {string|null} */
function text(v) {
  if (v == null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

/** @param {string|null} v */
function writeValue(v) {
  if (v == null) return "null";
  return BARE.test(v) && !RESERVED.test(v) ? v : JSON.stringify(v);
}

/**
 * A short file-name piece from the script's title (its angle name), else its
 * angle or hook key, else "script". a-z, 0-9 and dashes, at most 60 long.
 * @param {{title?: unknown, angle_key?: unknown, hook_key?: unknown}} row
 */
export function scriptSlug(row) {
  for (const raw of [row?.title, row?.angle_key, row?.hook_key]) {
    if (raw == null) continue;
    let s = String(raw).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, "") || s.slice(0, 60);
    s = s.replace(/-+$/g, "");
    if (s) return s;
  }
  return "script";
}

/**
 * The folder a script's file goes in: its batch's ISO week, or "on-demand".
 * @param {string|null|undefined} weekKey
 */
export function scriptFolder(weekKey) {
  const w = text(weekKey);
  return w && /^[0-9]{4}-W[0-9]{2}$/.test(w) ? w : ON_DEMAND;
}

/**
 * marketing/ads/scripts/machine/<folder>/<nn>-<slug>.md
 * @param {{weekKey?: string|null, n: number, slug: string}} args
 */
export function scriptFilePath({ weekKey, n, slug }) {
  if (!Number.isInteger(n) || n < 1) throw new Error("scriptFilePath: n must be a whole number from 1");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || ""))) throw new Error("scriptFilePath: slug must be a-z, 0-9 and dashes");
  return `${SCRIPTS_DIR}${scriptFolder(weekKey)}/${String(n).padStart(2, "0")}-${slug}.md`;
}

/** sha256 of the body as UTF-8, hex. The nightly check compares these. */
export function bodyHash(body) {
  return createHash("sha256").update(String(body ?? ""), "utf8").digest("hex");
}

/**
 * The front matter values for one ad_scripts row (as the store reads it).
 * Extra row fields it reads: batch_week_key (the batch's week), updated_by (who
 * saved: a staff id, or "machine").
 * @param {any} row
 */
export function frontMatterOf(row) {
  const version = Number(row?.version);
  if (!Number.isInteger(version) || version < 1) throw new Error("serializeScript: version must be a whole number from 1");
  return {
    ad: text(row.ad_id),
    version,
    status: text(row.status),
    offer: text(row.offer_key),
    funnel: text(row.funnel_key),
    format: text(row.script_format),
    style: text(row.style),
    angle: text(row.angle_key),
    batch: text(row.batch_week_key) ?? text(row.batch_id),
    updated_by: text(row.updated_by),
    updated_at: iso(row.updated_at)
  };
}

/**
 * The repo file for one script version.
 * @param {any} row  an ad_scripts row; repo_path, or batch_week_key + file_n for a first save
 * @returns {{path: string, content: string}}
 */
export function serializeScript(row) {
  if (!row || typeof row !== "object") throw new Error("serializeScript: row is required");
  if (typeof row.body !== "string" || row.body.trim() === "") throw new Error("serializeScript: body must be text");

  let path = text(row.repo_path);
  if (!path) {
    const n = Number(row.file_n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("serializeScript: a first save needs file_n (the script's place in its batch)");
    }
    path = scriptFilePath({ weekKey: row.batch_week_key, n, slug: scriptSlug(row) });
  }

  const fm = frontMatterOf(row);
  const lines = FRONT_MATTER_KEYS.map((k) => {
    const v = fm[k];
    return `${k}: ${k === "version" ? String(v) : writeValue(/** @type {string|null} */ (v))}`;
  });
  const data = {
    parts: row.parts ?? null,
    animation_plan: row.animation_plan ?? null,
    meta_copy: row.meta_copy ?? null
  };
  const content = `${OPEN}${lines.join("\n")}${CLOSE}${row.body}${TAIL}${JSON.stringify(data, null, 2)}${END}`;
  return { path, content };
}

/** @param {string} msg */
function bad(msg) {
  return new Error(`parseScript: ${msg}`);
}

/**
 * Read a script file back. Throws on a file this module did not write.
 * @param {string} content
 */
export function parseScript(content) {
  if (typeof content !== "string") throw bad("content must be text");
  if (!content.startsWith(OPEN)) throw bad("no front matter at the top");
  const fmEnd = content.indexOf(CLOSE, OPEN.length - 1);
  if (fmEnd < 0) throw bad("the front matter never ends");
  const tailAt = content.lastIndexOf(TAIL);
  if (tailAt < fmEnd + CLOSE.length) throw bad("no data block after the body");
  if (!content.endsWith(END)) throw bad("the data block does not end with ```");

  /** @type {Record<string, any>} */
  const out = {};
  const fmText = content.slice(OPEN.length, fmEnd);
  for (const line of fmText === "" ? [] : fmText.split("\n")) {
    const m = /^([a-z_]+): (.*)$/.exec(line);
    if (!m) throw bad(`a front matter line is not "key: value": ${JSON.stringify(line.slice(0, 80))}`);
    const [, key, raw] = m;
    if (Object.prototype.hasOwnProperty.call(out, key)) throw bad(`"${key}" is in the front matter twice`);
    let v;
    if (raw === "null") v = null;
    else if (raw.startsWith('"')) {
      try { v = JSON.parse(raw); } catch { throw bad(`"${key}" is not a readable value`); }
      if (typeof v !== "string") throw bad(`"${key}" must be text`);
    } else v = raw;
    if (key === "version") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw bad("version must be a whole number from 1");
      v = n;
    }
    out[key] = v;
  }
  for (const k of FRONT_MATTER_KEYS) if (!(k in out)) out[k] = null;

  const body = content.slice(fmEnd + CLOSE.length, tailAt);
  const jsonText = content.slice(tailAt + TAIL.length, content.length - END.length);
  let data;
  try { data = JSON.parse(jsonText); } catch { throw bad("the data block is not JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("the data block must be a JSON object");

  return {
    ...out,
    body,
    parts: data.parts ?? null,
    animation_plan: data.animation_plan ?? null,
    meta_copy: data.meta_copy ?? null
  };
}
