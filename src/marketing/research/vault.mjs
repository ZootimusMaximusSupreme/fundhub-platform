// @ts-check
// The Hormozi vault for deep research: the 110 notes under marketing/knowledge/hormozi/,
// read from the repo copy that ships with the marketing worker, scored by plain keywords.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 item 5 ("The Hormozi vault
// ... read from the repo, no Drive") and §6 slice 10: "the Hormozi vault in a per-function
// included_files block for the worker only, read by a pure keyword scorer that imports
// nothing from src/company-brain/hormozi-kb.mjs (its process.cwd() path into credentials/
// broke the 2026-10-05 ship)". Vault passages go to the model as search_result blocks so
// its citations name the repo file. Unit X2.
//
// NO credentials/ PATH ANYWHERE IN THIS FILE, and nothing here is imported by a file
// netlify/functions bundles except the worker. netlify.toml ships the folder with
// [functions."marketing-worker-background"] included_files only (4.6 MB, never global).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The vault folder, relative to the repo root. */
export const VAULT_DIR = "marketing/knowledge/hormozi";

/** One passage is about this many characters (a few paragraphs). */
export const PASSAGE_CHARS = 1400;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the repo (or the function bundle) might be. First one holding the vault wins. */
export function vaultRoots(env = process.env) {
  return [...new Set([path.resolve(HERE, "../../.."), env && env.LAMBDA_TASK_ROOT, process.cwd()]
    .filter((p) => typeof p === "string" && p.length > 0))];
}

function vaultBase(roots) {
  for (const root of roots) {
    const dir = path.join(root, VAULT_DIR);
    try { if (fs.statSync(dir).isDirectory()) return { root, dir }; } catch { /* next */ }
  }
  return null;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md") out.push(full);
  }
  return out;
}

function titleOf(text, file) {
  const m = /^#\s+(.+)$/m.exec(text);
  return (m ? m[1] : path.basename(file, ".md")).trim().slice(0, 200);
}

/** @type {Map<string, {path: string, title: string, text: string}[]>} */
const CACHE = new Map();

/**
 * loadVault({ roots }) → [{ path, title, text }] for every note (INDEX.md left out).
 * `path` is repo-relative ("marketing/knowledge/hormozi/…md"). Empty when the vault is
 * not shipped here. Cached for the life of the function.
 */
export function loadVault({ roots = vaultRoots() } = {}) {
  const base = vaultBase(roots);
  if (!base) return [];
  if (CACHE.has(base.dir)) return /** @type {any} */ (CACHE.get(base.dir));
  const docs = walk(base.dir).sort().map((full) => {
    const text = fs.readFileSync(full, "utf8");
    return { path: path.relative(base.root, full).split(path.sep).join("/"), title: titleOf(text, full), text };
  });
  CACHE.set(base.dir, docs);
  return docs;
}

/**
 * readVaultFile(repoPath, { roots }) → the file's text, or null. Only a normal path inside
 * the vault folder is ever opened (never "..", never another folder).
 */
export function readVaultFile(repoPath, { roots = vaultRoots() } = {}) {
  const p = String(repoPath || "");
  if (!p.startsWith(`${VAULT_DIR}/`) || !p.endsWith(".md") || p.includes("..") || p.includes("\\") || path.posix.normalize(p) !== p) return null;
  for (const root of roots) {
    try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { /* next */ }
  }
  return null;
}

const STOP = new Set(("the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what into most also does each even ever find give most must need same tell then they what when which while would about after again being could every first great other right still their there these thing think those under where whom whose why yes yet should").split(" "));

/** The words worth matching in a question: lower case, 3+ letters, no filler words. */
export function terms(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9$%]{3,}/g) || [])].filter((w) => !STOP.has(w));
}

/** Cut one note into passages of about PASSAGE_CHARS, on paragraph lines. */
export function passagesOf(doc, size = PASSAGE_CHARS) {
  const paras = String(doc.text || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > size) { out.push(cur); cur = ""; }
    if (p.length > size * 2) {
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out.map((text, i) => ({ path: doc.path, title: doc.title, index: i, text }));
}

/**
 * scorePassages(docs, query, { limit }) → the best passages for the query, best first.
 * Score: for each query word, log(1 + times it appears in the passage), weighted by how
 * rare the word is across the vault. Plain arithmetic, the same answer every time.
 */
export function scorePassages(docs, query, { limit = 10 } = {}) {
  const words = terms(query);
  if (!words.length) return [];
  const all = docs.flatMap((d) => passagesOf(d));
  if (!all.length) return [];
  const lower = all.map((p) => p.text.toLowerCase());
  const df = new Map(words.map((w) => [w, lower.filter((t) => t.includes(w)).length]));
  const scored = all.map((p, i) => {
    let s = 0;
    for (const w of words) {
      const n = lower[i].split(w).length - 1;
      if (n > 0) s += Math.log(1 + n) * Math.log(1 + all.length / (1 + (df.get(w) || 0)));
    }
    return { p, s };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || (a.p.path < b.p.path ? -1 : a.p.path > b.p.path ? 1 : a.p.index - b.p.index));
  return scored.slice(0, limit).map(({ p, s }) => ({ path: p.path, title: p.title, index: p.index, text: p.text, score: Math.round(s * 1000) / 1000 }));
}

/**
 * vaultBlocks(passages) → Anthropic search_result content blocks, one per passage, with
 * citations on, so a citation names the repo file it came from (source = repo path).
 */
export function vaultBlocks(passages) {
  return passages.map((p) => ({
    type: "search_result",
    source: p.path,
    title: p.title,
    content: [{ type: "text", text: p.text }],
    citations: { enabled: true }
  }));
}
