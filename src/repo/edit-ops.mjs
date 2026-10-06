// @ts-check
// Edits to the shared repo files, as pure functions: (content, edit) -> content.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2: shared files are
// saved as an EDIT, not a whole file, so a retry re-applies the edit to the
// newest copy and never overwrites a change made by someone else. The outbox
// (src/repo/outbox.mjs) stores the edit object in repo_outbox.edit and calls
// applyEdit() on whatever the file holds at the branch head when it commits.
//
// Each op works on exactly one file (EDIT_OP_FILES). The ops:
//
//   part0_add_rule     {op, text}               RULES.md, Part 0: next number
//   part0_edit_rule    {op, number, text}       RULES.md, Part 0: one rule's words
//   ban_phrase         {op, phrase}             banned-live.json: plain text, no dupes
//   registry_add_ad    {op, id, title, lane}    registry.json: gate/entry/offers
//                                               from rules[lane]
//   angles_add         {op, key, name, notes}   angles.json
//   voice_append_pairs {op, pairs:[...]}        VOICE.md: fixed block, end of
//                                               "# Real pairs"
//
// Part 0 is the section that starts at the line "# PART 0 — CHRIS'S RULES" and
// ends before the next line starting "# PART " (U09 writes that heading; items
// are "N. text" lines). VOICE.md's layout is fixed with U12 — see VOICE_TEMPLATE.
//
// Nothing here reads a clock, the network or the disk. A bad edit throws an
// EditOpError; the outbox records the reason on the row for the health card.

import { parseRegistry } from "../ads/registry.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";

export const RULES_PATH = "marketing/ads/RULES.md";
export const VOICE_PATH = "marketing/ads/VOICE.md";
export const BANNED_PATH = "marketing/ads/banned-live.json";
export const REGISTRY_FILE = "marketing/ads/registry.json";
export const ANGLES_PATH = "marketing/ads/angles.json";

/** The one file each op may touch. */
export const EDIT_OP_FILES = Object.freeze({
  part0_add_rule: RULES_PATH,
  part0_edit_rule: RULES_PATH,
  ban_phrase: BANNED_PATH,
  registry_add_ad: REGISTRY_FILE,
  angles_add: ANGLES_PATH,
  voice_append_pairs: VOICE_PATH
});

export const EDIT_OPS = Object.freeze(Object.keys(EDIT_OP_FILES));

export const PART0_HEADING = "# PART 0 — CHRIS'S RULES";
export const SEED_PAIRS_HEADING = "# Seed pairs — model side written by hand";

/** The fixed VOICE.md block (shared with U12). One line per field, no wrapping. */
export const VOICE_TEMPLATE = Object.freeze([
  "## Pair <N> — <kind>",
  "- **Lane:** <lane or unknown>",
  "- **Model wrote:** <before>",
  '- **Chris wrote:** "<after>"',
  "- **Why:** <Chris's own stated reason, else not given>",
  "- **Source:** app edit <YYYY-MM-DD>, script <id8>"
]);

const MAX_RULE = 1000;
const MAX_PHRASE = 200;
const MAX_PAIR_FIELD = 2000;
const MAX_PAIRS = 50;

export class EditOpError extends Error {
  constructor(message) {
    super(message);
    this.name = "EditOpError";
    this.code = "edit_op_refused";
  }
}

const fail = (msg) => { throw new EditOpError(msg); };

/** Collapse every run of whitespace (newlines included) to one space. */
function oneLine(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function requireText(v, field, max) {
  if (typeof v !== "string") fail(`${field} must be text`);
  const s = oneLine(v);
  if (!s) fail(`${field} is empty`);
  if (s.length > max) fail(`${field} is longer than ${max} characters`);
  return s;
}

function splitLines(content) {
  return String(content).split("\n");
}

function joinLines(lines, { trailingNewline = true } = {}) {
  const text = lines.join("\n");
  return trailingNewline && !text.endsWith("\n") ? `${text}\n` : text;
}

// ── JSON files ──────────────────────────────────────────────────────────────

/** The indent a JSON file was written with (spaces), so a save keeps its look. */
function jsonIndent(content) {
  const m = /^[[{]\s*\n( +)\S/.exec(String(content ?? ""));
  return m ? m[1].length : 2;
}

/**
 * @param {string|null|undefined} content
 * @param {string} file
 * @param {{emptyAs?: any}} [opts]  What a missing file reads as; absent = refuse.
 */
function parseJson(content, file, { emptyAs } = {}) {
  if (content == null) {
    if (emptyAs !== undefined) return emptyAs;
    fail(`${file} is missing`);
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    return fail(`${file} is not valid JSON (${String(err?.message || err).slice(0, 120)})`);
  }
}

function writeJson(value, original) {
  return `${JSON.stringify(value, null, jsonIndent(original))}\n`;
}

// ── RULES.md Part 0 ─────────────────────────────────────────────────────────

const ITEM = /^(\d+)\.\s+(.*)$/;

function isPart0Heading(line) {
  // The heading U09 writes, with a straight or a curly apostrophe.
  return line.trimEnd().replace(/’/g, "'") === PART0_HEADING;
}

/** The Part 0 section as line indexes: [start, end) with start = the heading. */
function part0Section(lines) {
  const start = lines.findIndex(isPart0Heading);
  if (start < 0) fail(`${RULES_PATH} has no "${PART0_HEADING}" heading`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("# PART ")) { end = i; break; }
  }
  return { start, end };
}

/** Numbered items inside Part 0, each with the line span it covers. */
function part0Items(lines, { start, end }) {
  const items = [];
  for (let i = start + 1; i < end; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) continue;
    // An item keeps any indented continuation lines directly under it.
    let last = i;
    while (last + 1 < end && /^\s+\S/.test(lines[last + 1])) last++;
    items.push({ n: Number(m[1]), text: m[2], line: i, last });
  }
  return items;
}

/** The rules in Part 0 as [{n, text}] — for readers (the rules screen). */
export function readPart0(content) {
  const lines = splitLines(content ?? "");
  const section = part0Section(lines);
  return part0Items(lines, section).map(({ n, text }) => ({ n, text }));
}

export function part0AddRule(content, edit) {
  if (content == null) fail(`${RULES_PATH} is missing`);
  const text = requireText(edit?.text, "rule text", MAX_RULE);
  const lines = splitLines(content);
  const section = part0Section(lines);
  const items = part0Items(lines, section);
  const next = items.reduce((max, it) => Math.max(max, it.n), 0) + 1;
  const line = `${next}. ${text}`;
  if (items.length) {
    const after = items[items.length - 1].last + 1;
    lines.splice(after, 0, line);
  } else {
    lines.splice(section.start + 1, 0, "", line);
  }
  return joinLines(lines, { trailingNewline: String(content).endsWith("\n") });
}

export function part0EditRule(content, edit) {
  if (content == null) fail(`${RULES_PATH} is missing`);
  const number = Number(edit?.number);
  if (!Number.isInteger(number) || number < 0) fail("rule number must be a whole number");
  const text = requireText(edit?.text, "rule text", MAX_RULE);
  const lines = splitLines(content);
  const item = part0Items(lines, part0Section(lines)).find((it) => it.n === number);
  if (!item) fail(`Part 0 has no rule ${number}`);
  lines.splice(item.line, item.last - item.line + 1, `${number}. ${text}`);
  return joinLines(lines, { trailingNewline: String(content).endsWith("\n") });
}

// ── banned-live.json ────────────────────────────────────────────────────────

export function banPhrase(content, edit) {
  const phrase = requireText(edit?.phrase, "phrase", MAX_PHRASE);
  const list = parseJson(content, BANNED_PATH, { emptyAs: [] });
  if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
    fail(`${BANNED_PATH} must be a list of plain text phrases`);
  }
  const key = phrase.toLowerCase();
  if (list.some((x) => oneLine(x).toLowerCase() === key)) return content;
  return writeJson([...list, phrase], content);
}

// ── registry.json ───────────────────────────────────────────────────────────

export function registryAddAd(content, edit) {
  const doc = parseJson(content, REGISTRY_FILE);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.ads)) {
    fail(`${REGISTRY_FILE} has no ads list`);
  }
  const id = String(edit?.id ?? "").trim();
  if (!/^[0-9]{1,9}$/.test(id)) fail("ad id must be the ad number (digits only)");
  const lane = String(edit?.lane ?? "").trim();
  const rule = doc.rules && Object.prototype.hasOwnProperty.call(doc.rules, lane) ? doc.rules[lane] : null;
  if (!lane || !rule || typeof rule !== "object") {
    fail(`lane "${lane}" has no rule in ${REGISTRY_FILE} (rules[lane])`);
  }
  const title = edit?.title == null || oneLine(edit.title) === "" ? null : oneLine(edit.title).slice(0, 200);

  const existing = doc.ads.find((a) => String(a?.id) === id);
  if (existing) {
    if (existing.lane === lane && (existing.title ?? null) === title) return content;
    fail(`ad ${id} is already in ${REGISTRY_FILE} with a different lane or title`);
  }

  const secondary = Array.isArray(rule.secondary_offers) ? [...rule.secondary_offers] : rule.secondary_offers;
  doc.ads.push({
    id,
    title,
    lane,
    gate: rule.gate,
    entry: rule.entry,
    primary_offer: rule.primary_offer,
    secondary_offers: secondary,
    variants: []
  });
  try {
    parseRegistry(doc);
  } catch (err) {
    fail(`the new ${REGISTRY_FILE} would not load: ${String(err?.message || err).slice(0, 200)}`);
  }
  return writeJson(doc, content);
}

// ── angles.json ─────────────────────────────────────────────────────────────

export function anglesAdd(content, edit) {
  const key = String(edit?.key ?? "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 80) {
    fail("angle key must be a short slug (a-z, 0-9 and dashes)");
  }
  const name = requireText(edit?.name, "angle name", 200);
  const notes = edit?.notes == null ? "" : oneLine(edit.notes);
  if (notes.length > MAX_PAIR_FIELD) fail(`angle notes are longer than ${MAX_PAIR_FIELD} characters`);
  const list = parseJson(content, ANGLES_PATH, { emptyAs: [] });
  if (!Array.isArray(list)) fail(`${ANGLES_PATH} must be a list of angles`);
  const existing = list.find((a) => a && a.key === key);
  if (existing) {
    if (existing.name === name) return content;
    fail(`angle "${key}" is already in ${ANGLES_PATH} with a different name`);
  }
  const entry = { key, name, notes };
  if (typeof edit?.source === "string" && oneLine(edit.source)) entry.source = oneLine(edit.source).slice(0, 120);
  return writeJson([...list, entry], content);
}

// ── VOICE.md ────────────────────────────────────────────────────────────────

const PAIR_HEADING = /^## Pair (\d+)\b/;

/** YYYY-MM-DD for the Source line: pair.date, else pair.created_at as an Arizona day. */
function pairDate(pair) {
  if (typeof pair?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pair.date)) return pair.date;
  if (pair?.created_at != null) {
    const d = new Date(pair.created_at);
    if (!Number.isNaN(d.getTime())) return adAccountDay(d);
  }
  return fail("each voice pair needs a date (YYYY-MM-DD) or created_at");
}

/** One pair as the fixed six-line block. */
export function voicePairBlock(n, pair) {
  const kind = requireText(pair?.kind, "pair kind", 40);
  const lane = pair?.lane == null || oneLine(pair.lane) === "" ? "unknown" : requireText(pair.lane, "pair lane", 40);
  const before = requireText(pair?.before, "model line", MAX_PAIR_FIELD);
  const after = requireText(pair?.after, "Chris's line", MAX_PAIR_FIELD);
  const why = pair?.why == null || oneLine(pair.why) === "" ? "not given" : requireText(pair.why, "why", MAX_PAIR_FIELD);
  const scriptId = requireText(pair?.script_id, "script id", 64).replace(/\s/g, "");
  const id8 = scriptId.slice(0, 8);
  return [
    `## Pair ${n} — ${kind}`,
    `- **Lane:** ${lane}`,
    `- **Model wrote:** ${before}`,
    `- **Chris wrote:** "${after}"`,
    `- **Why:** ${why}`,
    `- **Source:** app edit ${pairDate(pair)}, script ${id8}`
  ];
}

export function voiceAppendPairs(content, edit) {
  if (content == null) fail(`${VOICE_PATH} is missing`);
  const pairs = edit?.pairs;
  if (!Array.isArray(pairs) || !pairs.length) fail("no voice pairs to add");
  if (pairs.length > MAX_PAIRS) fail(`more than ${MAX_PAIRS} voice pairs in one edit`);

  const lines = splitLines(content);
  let highest = 0;
  for (const l of lines) {
    const m = PAIR_HEADING.exec(l);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  const blocks = [];
  pairs.forEach((p, i) => {
    if (i) blocks.push("");
    blocks.push(...voicePairBlock(highest + 1 + i, p));
  });

  const seed = lines.findIndex((l) => l.trimEnd() === SEED_PAIRS_HEADING);
  if (seed < 0) {
    // No "# Seed pairs" heading: append at the end of the file.
    const head = lines.slice();
    while (head.length && head[head.length - 1].trim() === "") head.pop();
    return joinLines([...head, "", ...blocks]);
  }

  // End of "# Real pairs" = just before the Seed heading, stepping back over the
  // blank lines and a "---" rule that separate the two sections.
  let at = seed;
  while (at > 0 && (lines[at - 1].trim() === "" || lines[at - 1].trim() === "---")) at--;
  const before = lines.slice(0, at);
  const after = lines.slice(at);
  while (after.length && after[0].trim() === "") after.shift();
  return joinLines([...before, "", ...blocks, "", ...after], {
    trailingNewline: String(content).endsWith("\n")
  });
}

// ── dispatch and checks ─────────────────────────────────────────────────────

const OPS = Object.freeze({
  part0_add_rule: part0AddRule,
  part0_edit_rule: part0EditRule,
  ban_phrase: banPhrase,
  registry_add_ad: registryAddAd,
  angles_add: anglesAdd,
  voice_append_pairs: voiceAppendPairs
});

/**
 * Check an edit before it is queued: a known op, aimed at its own file, with
 * the fields it needs. Content-dependent checks (does rule 7 exist, does the
 * lane have a rule) can only run at commit time against the real file.
 * @returns {object} the edit as it will be stored
 */
export function validateEdit(edit, path) {
  if (!edit || typeof edit !== "object" || Array.isArray(edit)) fail("edit must be an object");
  const op = edit.op;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(OPS, op)) {
    fail(`unknown edit op "${String(op).slice(0, 40)}"`);
  }
  if (path !== undefined && path !== EDIT_OP_FILES[op]) {
    fail(`${op} edits ${EDIT_OP_FILES[op]}, not ${String(path).slice(0, 120)}`);
  }
  switch (op) {
    case "part0_add_rule":
      requireText(edit.text, "rule text", MAX_RULE);
      break;
    case "part0_edit_rule":
      if (!Number.isInteger(Number(edit.number)) || Number(edit.number) < 0) fail("rule number must be a whole number");
      requireText(edit.text, "rule text", MAX_RULE);
      break;
    case "ban_phrase":
      requireText(edit.phrase, "phrase", MAX_PHRASE);
      break;
    case "registry_add_ad":
      if (!/^[0-9]{1,9}$/.test(String(edit.id ?? "").trim())) fail("ad id must be the ad number (digits only)");
      if (!String(edit.lane ?? "").trim()) fail("lane is empty");
      break;
    case "angles_add":
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(edit.key ?? "").trim())) fail("angle key must be a short slug");
      requireText(edit.name, "angle name", 200);
      break;
    case "voice_append_pairs":
      if (!Array.isArray(edit.pairs) || !edit.pairs.length) fail("no voice pairs to add");
      if (edit.pairs.length > MAX_PAIRS) fail(`more than ${MAX_PAIRS} voice pairs in one edit`);
      edit.pairs.forEach((p, i) => voicePairBlock(i + 1, p));
      break;
    default:
      break;
  }
  // Stored as JSON: a round trip drops anything JSON cannot hold.
  return JSON.parse(JSON.stringify(edit));
}

/**
 * Apply one edit to the file's current content (null when the file is missing).
 * Pure. Throws EditOpError for an unknown op or an edit the file cannot take.
 * @param {string|null} content
 * @param {object} edit
 * @returns {string}
 */
export function applyEdit(content, edit) {
  const op = edit?.op;
  if (typeof op !== "string" || !Object.prototype.hasOwnProperty.call(OPS, op)) {
    fail(`unknown edit op "${String(op).slice(0, 40)}"`);
  }
  return OPS[op](content, edit);
}

/**
 * The check every file passes before any commit: JSON parses, registry.json
 * loads through parseRegistry (src/ads/registry.mjs), banned-live.json is a
 * list of plain text, angles.json is a list of {key, name}.
 * Markdown and other text pass. Throws EditOpError.
 */
export function validateRepoFile(path, content) {
  if (typeof content !== "string") fail(`${path}: content must be text`);
  if (!String(path).endsWith(".json")) return;
  const doc = parseJson(content, path);
  if (path === REGISTRY_FILE) {
    try {
      parseRegistry(doc);
    } catch (err) {
      fail(`${REGISTRY_FILE} would not load: ${String(err?.message || err).slice(0, 200)}`);
    }
  } else if (path === BANNED_PATH) {
    if (!Array.isArray(doc) || !doc.every((x) => typeof x === "string")) {
      fail(`${BANNED_PATH} must be a list of plain text phrases`);
    }
  } else if (path === ANGLES_PATH) {
    if (!Array.isArray(doc) || !doc.every((a) => a && typeof a.key === "string" && typeof a.name === "string")) {
      fail(`${ANGLES_PATH} must be a list of angles with a key and a name`);
    }
  }
}
