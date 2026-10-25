#!/usr/bin/env node
// Sort markdown files into keep, archive, and duplicate.
// Default is a dry run. --apply moves archive and duplicate files.
// Node built-ins only. Nothing is deleted.

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = "archive/md-2026-10-24";
const TEXT_EXT = new Set([".md", ".mdc", ".mjs", ".js", ".cjs", ".html", ".json", ".yml", ".yaml", ".toml", ".txt"]);
const GENERIC_NAMES = new Set([
  "readme", "changelog", "skill", "index", "license", "todo", "notes",
  "overview", "summary", "introduction", "draft", "untitled", "agents", "claude",
]);
const ALLOWED = ["docs/", "ops/", "marketing/", ".claude/rules/", ".cursor/rules/", ".ai/rules/"];
const DO_NOT_MOVE = new Set([
  "ops/workflows/md-cleanup-2026-10-24.md",
  "ops/workflows/md-cleanup-2026-10-24.csv",
  ".ai/rules/no-new-markdown.md",
  "scripts/hooks/guard-new-markdown.mjs",
  "scripts/hooks/guard-new-markdown.test.mjs",
  "scripts/md-sort.mjs",
]);
const READ_CAP = 20 * 1024 * 1024;

function gitZ(args) {
  const r = spawnSync("git", args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.toString("utf8") || `git ${args.join(" ")} failed`);
  return r.stdout.toString("utf8").split("\0").filter(Boolean);
}

function skipPath(rel) {
  return rel.split("/").some((part) => part === "node_modules" || part === ".git");
}

function extOf(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function folderOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "." : rel.slice(0, i);
}

function dayFromMs(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function unquoteGitPath(line) {
  if (!(line.startsWith('"') && line.endsWith('"'))) return line;
  const body = line.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(body.charCodeAt(i));
      continue;
    }
    const n = body[++i];
    if (n === "n") bytes.push(10);
    else if (n === "t") bytes.push(9);
    else if (n === "\\") bytes.push(92);
    else if (n === '"') bytes.push(34);
    else if (n && /[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(body[i + 1] || "")) oct += body[++i];
      bytes.push(parseInt(oct, 8));
    } else if (n) bytes.push(n.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

function loadGitDates() {
  return new Promise((resolve, reject) => {
    const dates = new Map();
    const child = spawn("git", ["log", "--pretty=format:COMMIT%x09%cI", "--name-only"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    let current = "";
    let stderr = "";
    const take = (line) => {
      if (line.startsWith("COMMIT\t")) {
        current = line.slice("COMMIT\t".length).trim();
        return;
      }
      if (!line || !current) return;
      const key = unquoteGitPath(line);
      if (!key || dates.has(key)) return;
      dates.set(key, current);
    };
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        take(buf.slice(0, idx).replace(/\r$/, ""));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (buf) take(buf.replace(/\r$/, ""));
      if (code !== 0) reject(new Error(stderr.trim() || `git log exited ${code}`));
      else resolve(dates);
    });
  });
}

function readText(abs) {
  try {
    const buf = fs.readFileSync(abs);
    if (buf.length > READ_CAP || buf.includes(0)) return "";
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function firstH1(text) {
  const start = text.startsWith("---") ? text.indexOf("\n---", 3) : -1;
  const body = start === -1 ? text : text.slice(start + 4);
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : "";
}

function titleKey(h1) {
  const n = h1.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return n.length >= 24 ? n : "";
}

function filenameKey(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/i, "").toLowerCase();
  if (GENERIC_NAMES.has(base) || base.length < 20) return "";
  return base;
}

function normalizeBody(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h;
}

function simhash(tokens) {
  const counts = new Array(64).fill(0);
  let used = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    used += 1;
    const h = fnv1a64(tok);
    for (let i = 0; i < 64; i++) counts[i] += ((h >> BigInt(i)) & 1n) === 1n ? 1 : -1;
  }
  if (!used) return null;
  let out = 0n;
  for (let i = 0; i < 64; i++) if (counts[i] > 0) out |= 1n << BigInt(i);
  return out;
}

// Three-word pieces, not single words. Single words make long English notes look the same.
function shingleSimhash(text) {
  const words = text.split(" ").filter(Boolean);
  if (words.length < 3) return null;
  const pieces = new Array(words.length - 2);
  for (let i = 0; i < pieces.length; i++) pieces[i] = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
  return simhash(pieces);
}

function closeLen(a, b) {
  const max = Math.max(a.normLen, b.normLen);
  if (!max) return true;
  return Math.abs(a.normLen - b.normLen) / max <= 0.1;
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shingleSet(text) {
  const words = text.split(" ").filter(Boolean);
  const set = new Set();
  for (let i = 0; i + 2 < words.length; i++) set.add(hash32(`${words[i]} ${words[i + 1]} ${words[i + 2]}`));
  return set;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const small = a.size < b.size ? a : b;
  const big = small === a ? b : a;
  for (const value of small) if (big.has(value)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 1;
}

function hamming(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n += 1;
  }
  return n;
}

function extractMdRefs(text) {
  const refs = [];
  const re = /\.md\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const after = text[m.index + 3] || "";
    if (/[A-Za-z0-9.]/.test(after)) continue;
    let i = m.index - 1;
    while (i >= 0 && /[A-Za-z0-9_./~@%+-]/.test(text[i])) i -= 1;
    const raw = text.slice(i + 1, m.index + 3);
    if (!raw || raw.includes("://") || raw.startsWith("//")) continue;
    refs.push(raw);
  }
  return refs;
}

function resolveRef(raw, fromRel, mdSet, byBase) {
  let ref = raw.split("#")[0].split("?")[0];
  try { ref = decodeURIComponent(ref); } catch { /* keep the raw token */ }
  ref = ref.replace(/^\.\//, "");
  if (!ref.toLowerCase().endsWith(".md")) return [];
  const hits = [];
  const add = (p) => {
    const norm = path.posix.normalize(p).replace(/^\.\//, "");
    if (!norm || norm.startsWith("../") || norm === "." || !mdSet.has(norm)) return;
    if (!hits.includes(norm)) hits.push(norm);
  };
  if (ref.startsWith("/")) add(ref.slice(1));
  else if (ref.includes("/")) {
    add(ref);
    add(path.posix.join(path.posix.dirname(fromRel), ref));
  } else {
    const owners = byBase.get(ref);
    if (owners && owners.length === 1) add(owners[0]);
  }
  return hits;
}

class UF {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
    this.r = new Array(n).fill(0);
  }
  find(x) {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a, b) {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return;
    if (this.r[a] < this.r[b]) [a, b] = [b, a];
    this.p[b] = a;
    if (this.r[a] === this.r[b]) this.r[a] += 1;
  }
}

function allowedPath(rel) {
  const lower = rel.toLowerCase();
  return ALLOWED.some((prefix) => lower.startsWith(prefix));
}

function pretty(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rank(a, b) {
  if (b.inbound !== a.inbound) return b.inbound - a.inbound;
  if (b.changedMs !== a.changedMs) return b.changedMs - a.changedMs;
  if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.path < b.path) return -1;
  if (a.path > b.path) return 1;
  return 0;
}

function biggestFolders(rows) {
  const map = new Map();
  for (const row of rows) {
    const cur = map.get(row.folder) || { folder: row.folder, count: 0, bytes: 0 };
    cur.count += 1;
    cur.bytes += row.bytes;
    map.set(row.folder, cur);
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes || b.count - a.count || (a.folder < b.folder ? -1 : 1)).slice(0, 20);
}

function sanityProblems(rows) {
  const problems = [];
  const byPath = new Map(rows.map((row) => [row.path, row]));
  for (const required of ["CLAUDE.md", "AGENTS.md"]) {
    const row = byPath.get(required);
    if (!row || row.group !== "keep") problems.push(`${required} is not in the keep group`);
  }
  const rules = rows.filter((row) => row.path.startsWith(".ai/rules/") && row.path.endsWith(".md") && !row.symlink);
  const dupRules = rules.filter((row) => row.group === "duplicate");
  if (rules.length >= 5 && dupRules.length === rules.length) {
    problems.push("every rule file under .ai/rules/ is marked duplicate");
  }
  if (rules.length && dupRules.length / rules.length > 0.5) {
    problems.push(`too many rule files are duplicates (${dupRules.length} of ${rules.length})`);
  }
  const dupes = rows.filter((row) => row.group === "duplicate").length;
  if (rows.length && dupes / rows.length > 0.5) {
    problems.push(`duplicate count is most of the repo (${dupes} of ${rows.length})`);
  }
  const linked = rows.filter((row) => row.linked).length;
  if (rows.length && linked / rows.length < 0.05) {
    problems.push(`almost nothing is linked (${linked} of ${rows.length})`);
  }
  return problems;
}

function renderMd({ rows, folders, moved, skipped, applied }) {
  const count = (group) => rows.filter((row) => row.group === group).length;
  const links = rows.filter((row) => row.symlink).length;
  const n = (value) => value.toLocaleString("en-US");
  const lines = [
    "# Markdown cleanup on 2026-10-24",
    "",
    `Fundhub has ${n(rows.length)} markdown files in this pass.`,
    "",
    `Keep: ${n(count("keep"))} files. A file stays when another file links to it, or it changed in the last 30 days.`,
    "",
    `Archive: ${n(count("archive"))} files. Nothing links to them, and they are older than 30 days. Archive means move. It does not mean delete.`,
    "",
    `Duplicate: ${n(count("duplicate"))} files. Each one is a copy. One file in the set stays. The copies move. They are not deleted.`,
    "",
    `${n(links)} symlinks stayed. They are pointers, not extra copies.`,
    "",
    "The hook blocks a new markdown file outside a few folders. It allows a new file in docs, ops, marketing, .claude/rules, .cursor/rules, and .ai/rules. .ai/rules is allowed because it is the one real home for a rule. The Cursor and Claude rule folders are only links to that home.",
    "",
    applied
      ? `${n(moved)} files moved to archive/md-2026-10-24/. Each file kept its old folder under that path.`
      : "This is a dry run. Nothing has moved. The archive path is archive/md-2026-10-24/.",
    "",
    skipped.length
      ? `${n(skipped.length)} files were skipped. The run log names each one.`
      : "No file was skipped.",
    "",
    "## 20 biggest folders",
    "",
    "| Folder | Files | Total size |",
    "| --- | ---: | ---: |",
    ...folders.map((folder) => `| ${folder.folder.replace(/\|/g, "/")} | ${folder.count} | ${pretty(folder.bytes)} |`),
    "",
  ];
  return lines.join("\n");
}

function writeReports(rows, folders, moved, skipped, applied) {
  const csvPath = path.join(ROOT, "ops/workflows/md-cleanup-2026-10-24.csv");
  const mdPath = path.join(ROOT, "ops/workflows/md-cleanup-2026-10-24.md");
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const header = ["path", "folder", "bytes", "last_changed", "linked", "group", "duplicate_of"];
  const lines = [header.join(",")];
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const row of sorted) {
    lines.push([
      row.path,
      row.folder,
      row.bytes,
      row.day,
      row.linked ? "yes" : "no",
      row.group,
      row.duplicateOf,
    ].map(csvCell).join(","));
  }
  fs.writeFileSync(csvPath, `${lines.join("\n")}\n`);
  fs.writeFileSync(mdPath, renderMd({ rows, folders, moved, skipped, applied }));
}

function moveOne(rel, tracked) {
  if (DO_NOT_MOVE.has(rel)) return "left in place on purpose";
  if (rel === ARCHIVE || rel.startsWith(`${ARCHIVE}/`)) return "already in the archive folder";
  const dest = `${ARCHIVE}/${rel}`;
  const destAbs = path.join(ROOT, dest);
  if (fs.existsSync(destAbs)) return "destination already exists";
  try {
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  } catch (err) {
    return err && err.message ? err.message : "could not make the destination folder";
  }
  if (tracked.has(rel)) {
    const result = spawnSync("git", ["mv", rel, dest], { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0) return (result.stderr || result.stdout || "git mv failed").trim();
    return "";
  }
  try {
    fs.renameSync(path.join(ROOT, rel), destAbs);
  } catch (err) {
    return err && err.message ? err.message : "rename failed";
  }
  return "";
}

async function classify() {
  console.log("listing markdown files");
  const listed = gitZ(["ls-files", "-co", "--exclude-standard", "-z"]);
  const tracked = new Set(gitZ(["ls-files", "-z"]));
  const mdRels = listed.filter((rel) => extOf(rel) === ".md" && !skipPath(rel));
  const textRels = listed.filter((rel) => TEXT_EXT.has(extOf(rel)) && !skipPath(rel));
  const mdSet = new Set(mdRels);
  const byBase = new Map();
  for (const rel of mdRels) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const list = byBase.get(base) || [];
    list.push(rel);
    byBase.set(base, list);
  }

  console.log("reading last-changed dates");
  const gitDates = await loadGitDates();
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
  const cutoffDay = dayFromMs(cutoff.getTime());
  console.log(`keep window starts ${cutoffDay} (today local date minus 30 days, inclusive)`);

  const rows = [];
  for (const rel of mdRels) {
    const abs = path.join(ROOT, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    const symlink = st.isSymbolicLink();
    const iso = gitDates.get(rel) || "";
    const changedMs = iso ? new Date(iso).getTime() : st.mtimeMs;
    const day = iso && !Number.isNaN(changedMs) ? dayFromMs(changedMs) : dayFromMs(st.mtimeMs);
    rows.push({
      path: rel,
      folder: folderOf(rel),
      bytes: st.size,
      day: Number.isNaN(changedMs) ? "" : day,
      changedMs: Number.isNaN(changedMs) ? 0 : changedMs,
      linked: false,
      inbound: 0,
      group: "",
      duplicateOf: "",
      symlink,
      recent: day !== "" && day >= cutoffDay,
      allowed: allowedPath(rel),
      titleKey: "",
      filenameKey: symlink ? "" : filenameKey(rel),
      digest: "",
      normLen: 0,
      sim: 0n,
      idx: -1,
    });
  }

  console.log(`scanning links in ${textRels.length} text files`);
  const inbound = new Map();
  for (const rel of textRels) {
    const abs = path.join(ROOT, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink() && extOf(rel) !== ".md") {
      // A rule link is a pointer. The real file is scanned on its own.
      continue;
    }
    const text = readText(abs);
    if (!text || !text.includes(".md")) continue;
    for (const raw of extractMdRefs(text)) {
      for (const target of resolveRef(raw, rel, mdSet, byBase)) {
        if (target === rel) continue;
        let sources = inbound.get(target);
        if (!sources) inbound.set(target, sources = new Set());
        sources.add(rel);
      }
    }
  }
  for (const row of rows) {
    const sources = inbound.get(row.path);
    row.inbound = sources ? sources.size : 0;
    row.linked = row.inbound > 0;
  }

  console.log("finding duplicates");
  const hashed = [];
  for (const row of rows) {
    if (row.symlink) continue;
    const text = readText(path.join(ROOT, row.path));
    row.titleKey = titleKey(firstH1(text));
    const norm = normalizeBody(text);
    row.normLen = norm.length;
    row.digest = crypto.createHash("sha1").update(norm).digest("hex");
    row.sim = shingleSimhash(norm);
    row.shingles = shingleSet(norm);
    row.idx = hashed.length;
    hashed.push(row);
  }
  const uf = new UF(hashed.length);
  // Same name is not enough when the notes say different things.
  // A copy also has to be nearly the same text.
  const contentNear = (a, b) => {
    if (!a.normLen || !b.normLen) return false;
    if (a.digest === b.digest) return true;
    if (a.sim == null || b.sim == null || !closeLen(a, b) || hamming(a.sim, b.sim) > 5) return false;
    return jaccard(a.shingles, b.shingles) >= 0.95;
  };
  const byLen = hashed.filter((row) => row.sim != null && row.normLen > 0).sort((a, b) => a.normLen - b.normLen);
  const edges = [];
  for (let i = 0; i < byLen.length; i++) {
    const a = byLen[i];
    const limit = a.normLen * 1.1;
    for (let j = i + 1; j < byLen.length; j++) {
      const b = byLen[j];
      if (b.normLen > limit) break;
      if (!contentNear(a, b)) continue;
      edges.push([a, b, hamming(a.sim, b.sim)]);
    }
  }
  edges.sort((a, b) => a[2] - b[2]);
  const members = new Map(hashed.map((row) => [row.idx, [row]]));
  for (const [a, b] of edges) {
    const ra = uf.find(a.idx);
    const rb = uf.find(b.idx);
    if (ra === rb) continue;
    const groupA = members.get(ra);
    const groupB = members.get(rb);
    let ok = true;
    for (const left of groupA) {
      for (const right of groupB) {
        if (!contentNear(left, right)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    uf.union(a.idx, b.idx);
    const root = uf.find(a.idx);
    members.set(root, groupA.concat(groupB));
    if (ra !== root) members.delete(ra);
    if (rb !== root) members.delete(rb);
  }
  const groupUnion = (keyOf) => {
    const groups = new Map();
    for (const row of hashed) {
      const key = keyOf(row);
      if (!key) continue;
      const list = groups.get(key) || [];
      list.push(row);
      groups.set(key, list);
    }
    for (const list of groups.values()) {
      for (let i = 1; i < list.length; i++) uf.union(list[0].idx, list[i].idx);
    }
  };
  // A heading on many different notes is a banner, not one document.
  // Small title groups still count. A big group joins only when the text matches too.
  const titleGroups = new Map();
  for (const row of hashed) {
    if (!row.titleKey) continue;
    const list = titleGroups.get(row.titleKey) || [];
    list.push(row);
    titleGroups.set(row.titleKey, list);
  }
  for (const list of titleGroups.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (contentNear(list[i], list[j])) uf.union(list[i].idx, list[j].idx);
      }
    }
  }
  const nameGroups = new Map();
  for (const row of hashed) {
    if (!row.filenameKey) continue;
    const list = nameGroups.get(row.filenameKey) || [];
    list.push(row);
    nameGroups.set(row.filenameKey, list);
  }
  for (const list of nameGroups.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (contentNear(list[i], list[j])) uf.union(list[i].idx, list[j].idx);
      }
    }
  }
  groupUnion((row) => (row.normLen ? row.digest : ""));

  const clusters = new Map();
  for (const row of hashed) {
    const root = uf.find(row.idx);
    const list = clusters.get(root) || [];
    list.push(row);
    clusters.set(root, list);
  }
  for (const row of rows) {
    if (row.symlink) {
      row.group = "keep";
      row.duplicateOf = "";
    }
  }
  for (const list of clusters.values()) {
    if (list.length === 1) {
      const row = list[0];
      row.group = row.linked || row.recent ? "keep" : "archive";
      row.duplicateOf = "";
      continue;
    }
    list.sort(rank);
    const survivor = list[0];
    survivor.group = survivor.linked || survivor.recent ? "keep" : "archive";
    survivor.duplicateOf = "";
    for (const copy of list.slice(1)) {
      copy.group = "duplicate";
      copy.duplicateOf = survivor.path;
    }
  }

  const titleSizes = [...titleGroups.values()].map((list) => list.length).sort((a, b) => b - a);
  return { rows, tracked, cutoffDay, titleSizes };
}

function printReport(rows, folders, cutoffDay, titleSizes, moved, skipped, applied) {
  const count = (group) => rows.filter((row) => row.group === group).length;
  const linked = rows.filter((row) => row.linked).length;
  const recent = rows.filter((row) => row.recent).length;
  const symlinks = rows.filter((row) => row.symlink).length;
  console.log("");
  console.log(`files found: ${rows.length}`);
  console.log(`keep: ${count("keep")}`);
  console.log(`archive: ${count("archive")}`);
  console.log(`duplicate: ${count("duplicate")}`);
  console.log(`symlinks: ${symlinks}`);
  console.log(`linked: ${linked}`);
  console.log(`changed since ${cutoffDay}: ${recent}`);
  console.log(`moved: ${moved}`);
  console.log(applied ? "apply: yes" : "apply: dry run");
  console.log("");
  console.log("20 biggest folders");
  for (const folder of folders) console.log(`${folder.folder}\t${folder.count}\t${folder.bytes}`);
  console.log("");
  console.log("archive sample");
  for (const row of rows.filter((item) => item.group === "archive").slice(0, 20)) console.log(row.path);
  console.log("");
  console.log("duplicate sample");
  for (const row of rows.filter((item) => item.group === "duplicate").slice(0, 20)) {
    console.log(`${row.path} -> ${row.duplicateOf}`);
  }
  console.log("");
  console.log(`largest title groups: ${titleSizes.slice(0, 12).join(", ") || "none"}`);
  const rules = rows.filter((row) => row.path.startsWith(".ai/rules/") && !row.symlink);
  const ruleCount = (group) => rules.filter((row) => row.group === group).length;
  console.log(`.ai/rules files: ${rules.length} keep ${ruleCount("keep")} archive ${ruleCount("archive")} duplicate ${ruleCount("duplicate")}`);
  for (const required of ["CLAUDE.md", "AGENTS.md"]) {
    const row = rows.find((item) => item.path === required);
    console.log(`${required}: ${row ? row.group : "missing"} linked=${row ? row.linked : false} day=${row ? row.day : ""}`);
  }
  const problems = sanityProblems(rows);
  if (problems.length) {
    console.log("");
    console.log("sanity problems");
    for (const problem of problems) console.log(`- ${problem}`);
  } else {
    console.log("sanity: ok");
  }
  if (skipped.length) {
    console.log("");
    console.log("skipped");
    for (const item of skipped) console.log(`${item.path}\t${item.why}`);
  }
}

async function main() {
  const applied = process.argv.includes("--apply");
  const { rows, tracked, cutoffDay, titleSizes } = await classify();
  const problems = sanityProblems(rows);
  const skipped = [];
  let moved = 0;
  if (applied && problems.length) {
    printReport(rows, biggestFolders(rows), cutoffDay, titleSizes, 0, skipped, false);
    console.error("refusing to move files until the dry run is sane");
    process.exitCode = 1;
    writeReports(rows, biggestFolders(rows), 0, skipped, false);
    return;
  }
  if (applied) {
    console.log("moving archive and duplicate files");
    for (const row of rows) {
      if (row.symlink) continue;
      if (row.group !== "archive" && row.group !== "duplicate") continue;
      const why = moveOne(row.path, tracked);
      if (why) skipped.push({ path: row.path, why });
      else moved += 1;
      if (moved && moved % 200 === 0) console.log(`moved ${moved}`);
    }
  }
  const folders = biggestFolders(rows);
  writeReports(rows, folders, moved, skipped, applied);
  printReport(rows, folders, cutoffDay, titleSizes, moved, skipped, applied);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
