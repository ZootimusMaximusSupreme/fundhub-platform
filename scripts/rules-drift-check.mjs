#!/usr/bin/env node
// npm run rules:check — the rules-drift guard (owner call 2026-10-24).
//
// Chris: "Can we ensure this drift never happens again?" On 2026-10-24 four
// audits found 43 conflicts, 35 stale lines and 48 mirror gaps. This script is
// what keeps it from coming back. It runs inside `npm test`
// (src/rules/rules-drift-check.test.mjs), so a push that drifts the rules goes
// red.
//
// THE LAYOUT (drift cleanup, phase 2, 2026-10-24): one real file for each rule and
// each skill. The tool folders hold links, never copies.
//
//   rules   real   .ai/rules/<n>.md
//           links  .cursor/rules/<n>.mdc and .claude/rules/<n>.md   ->  ../../.ai/rules/<n>.md
//   skills  real   .agents/skills/<n>/        (Codex reads this folder itself)
//           links  .cursor/skills/<n> and .claude/skills/<n>        ->  ../../.agents/skills/<n>
//
// A rule that is Cursor-only on purpose has no Claude link. A skill that is
// Codex-only on purpose has no links. Both are listed with a reason in
// scripts/rules-drift-allow.json. Third-party skills (the ones in skills-lock.json)
// are linked like ours, but the index and the retired-word scan skip them.
//
// Plain Node, no dependencies. READ ONLY: it never edits a rule.
//
// Checks (each failure names file:line and a one-line plain fix):
//   mirror   a  every .ai/rules/<n>.md has its .cursor link, and its .claude link unless Cursor-only
//               (.ai/rules holds real .md files only; a README.md there is a note, not a rule)
//   link     b  every rule link points at its one real file; a real file left in
//               .cursor/rules or .claude/rules is a copy and fails; no dangling links
//   skills   c  every skill in .agents/skills has both links; a real folder left in
//               .cursor/skills or .claude/skills is a copy and fails; no dangling links
//   pointer  d  every rule/skill path named in the rule homes exists
//   index    e  every rule and skill is in docs/rules/RULES-INDEX.md
//   claudemd f  CLAUDE.md names docs/rules/RULES-INDEX.md, has headings 0-12
//               (including 3a, 3b, 3c), every path it names exists, and the
//               size caps hold (CLAUDE.md 220 lines, AGENTS.md 90)
//   retired  g  no live rule still teaches a phrase a newer owner law killed
//   dates    h  every "Owner law" / "owner-set" line carries a YYYY-MM-DD date
//
// Exceptions live in scripts/rules-drift-allow.json (each with a reason).
// Retired phrases live in scripts/rules-retired-phrases.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CHECKS = {
  mirror: "Mirror: a rule is missing a link, or .ai/rules holds something that is not a rule file",
  link: "Links: a rule has a second real copy, or a rule link points at the wrong place or at nothing",
  skills: "Skills: a skill is missing a link, has a second real copy, or a link points at nothing",
  pointer: "Pointer: a named rule or skill path does not exist",
  index: "Index: not listed in docs/rules/RULES-INDEX.md",
  claudemd: "CLAUDE.md: missing RULES-INDEX, a heading 0-12, a named path, or over the size cap",
  retired: "Retired words: a phrase a newer owner law killed is still live",
  dates: "Dates: an owner-law line has no YYYY-MM-DD date",
};

// The layout. The tests build the same shape in a temp folder.
const RULES_HOME = ".ai/rules";
const SKILLS_HOME = ".agents/skills";
const CURSOR_RULES = ".cursor/rules";
const CLAUDE_RULES = ".claude/rules";
const SKILL_LINK_DIRS = [".cursor/skills", ".claude/skills"];
const RULE_LINK_DIRS = [CURSOR_RULES, CLAUDE_RULES];
// Where the retired-word scan looks by default. Our own skills are added below.
const DEFAULT_RETIRED_PATHS = ["CLAUDE.md", "AGENTS.md", RULES_HOME, "docs/rules"];

// ---------------------------------------------------------------- file helpers

const exists = (p) => fs.existsSync(p); // follows links: false for a dangling link
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const read = (p) => fs.readFileSync(p, "utf8");
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

/** Every visible entry in a folder. lstat-style: a dangling link is still listed. */
function listNames(dir) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
}

/** Every .md/.mdc file under a path. Follows links, but never walks the same folder twice (so a link loop ends). */
function walkText(p, out = [], seen = new Set()) {
  if (isFile(p)) { if (/\.(md|mdc)$/.test(p)) out.push(p); return out; }
  if (!isDir(p)) return out;
  let real;
  try { real = fs.realpathSync(p); } catch { return out; }
  if (seen.has(real)) return out;
  seen.add(real);
  for (const n of fs.readdirSync(p).sort()) {
    if (n === "node_modules" || n === ".git") continue;
    walkText(path.join(p, n), out, seen);
  }
  return out;
}

/** Text files under the scope, each one once at its REAL path, so two links to one file never report a line twice. */
function realTextFiles(root, scope) {
  const realRoot = fs.realpathSync(root);
  const byReal = new Map();
  for (const p of scope) {
    for (const abs of walkText(path.join(root, p))) {
      let real;
      try { real = fs.realpathSync(abs); } catch { continue; }
      if (!byReal.has(real)) byReal.set(real, rel(realRoot, real));
    }
  }
  return [...byReal].map(([abs, f]) => ({ abs, rel: f })).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Names of third-party skills: the ones the skills tool recorded in skills-lock.json. */
function thirdPartySkills(root) {
  const p = path.join(root, "skills-lock.json");
  if (!isFile(p)) return new Set();
  try { return new Set(Object.keys(JSON.parse(read(p)).skills || {})); } catch { return new Set(); }
}

/** Split off a leading --- front matter block. Returns { fm, body, bodyStart } (bodyStart = 1-based line). */
export function splitFrontMatter(text) {
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return { fm: "", body: text, bodyStart: 1, lines };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { fm: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n"), bodyStart: i + 2, lines };
    }
  }
  return { fm: "", body: text, bodyStart: 1, lines };
}

/** Hard caps for the short index files. Do not tighten these numbers. */
export const CLAUDE_MD_MAX_LINES = 220;
export const AGENTS_MD_MAX_LINES = 90;
const CLAUDE_MD_HEADINGS = ["0", "1", "2", "3", "3a", "3b", "3c", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/** Backtick paths in CLAUDE.md that must exist. Skip globs, placeholders, env, and credentials. */
export function namedClaudePaths(text) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (/[*<{]/.test(raw)) continue;
    if (/\s/.test(raw)) continue;
    if (/^https?:\/\//i.test(raw)) continue;
    if (/^(?:\.env|credentials)\b/.test(raw)) continue;
    if (!/\/|\.(md|mdc|mjs|js|json|yml|yaml|toml|html|css)$/i.test(raw) && !/^(?:AGENTS|CLAUDE|README)\.md$/i.test(raw)) continue;
    out.push({ path: raw, index: m.index });
  }
  return out;
}

function lineAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------- the checks

export function checkRules({ root = SCRIPT_ROOT, allow = {}, retired = [] } = {}) {
  const failures = [];
  const fail = (check, file, line, message, fix) => failures.push({ check, file, line: line || 1, message, fix });

  const rulesHome = path.join(root, RULES_HOME);
  const skillsHome = path.join(root, SKILLS_HOME);
  const cursorOnly = allow.cursorOnlyRules || {};
  const codexOnly = allow.codexOnlySkills || {};
  const thirdParty = thirdPartySkills(root);

  // a. MIRROR -----------------------------------------------------------------
  const rules = [];
  for (const f of listNames(rulesHome)) {
    if (f.toLowerCase() === "readme.md") continue; // a note about the folder, not a rule; nothing links it
    const st = lstat(path.join(rulesHome, f));
    if (!f.endsWith(".md")) {
      fail("mirror", `${RULES_HOME}/${f}`, 1, `"${f}" does not end in .md.`,
        `Rules in ${RULES_HOME} are plain .md files. Rename it to ${f.replace(/\.[^.]*$/, "")}.md (Cursor reads it through a .mdc link).`);
    } else if (!st.isFile()) {
      fail("mirror", `${RULES_HOME}/${f}`, 1, `"${f}" is ${st.isSymbolicLink() ? "a link" : "a folder"}, not a real file.`,
        `${RULES_HOME} holds the one real file for each rule. Put the real file there.`);
    } else {
      rules.push(f.slice(0, -3));
    }
  }
  for (const n of rules) {
    if (!lstat(path.join(root, `${CURSOR_RULES}/${n}.mdc`))) {
      fail("mirror", `${RULES_HOME}/${n}.md`, 1, `Rule "${n}" has no Cursor link at ${CURSOR_RULES}/${n}.mdc.`,
        `Run: ln -s ../../${RULES_HOME}/${n}.md ${CURSOR_RULES}/${n}.mdc`);
    }
    if (!(n in cursorOnly) && !lstat(path.join(root, `${CLAUDE_RULES}/${n}.md`))) {
      fail("mirror", `${RULES_HOME}/${n}.md`, 1, `Rule "${n}" has no Claude link at ${CLAUDE_RULES}/${n}.md.`,
        `Run: ln -s ../../${RULES_HOME}/${n}.md ${CLAUDE_RULES}/${n}.md (or add "${n}" to cursorOnlyRules in scripts/rules-drift-allow.json with a reason).`);
    }
  }

  // b. LINKS ------------------------------------------------------------------
  for (const dir of RULE_LINK_DIRS) {
    for (const f of listNames(path.join(root, dir))) {
      if (!/\.mdc?$/.test(f)) continue;
      const abs = path.join(root, dir, f);
      const n = f.replace(/\.mdc?$/, "");
      const where = `${dir}/${f}`;
      const want = `../../${RULES_HOME}/${n}.md`;
      if (!lstat(abs).isSymbolicLink()) {
        fail("link", where, 1, `"${f}" is a real file, not a link. That is a second copy of the rule.`,
          `Put any edits into ${RULES_HOME}/${n}.md (the one home), then replace this file with the link: ln -sfn ${want} ${where}`);
        continue;
      }
      const target = fs.readlinkSync(abs).replace(/\/$/, "");
      if (target !== want) {
        fail("link", where, 1, `Link points to "${target}", not "${want}".`, `Re-make the link: ln -sfn ${want} ${where}`);
      } else if (!exists(abs)) {
        fail("link", where, 1, `Link "${where}" is dangling: ${RULES_HOME}/${n}.md does not exist.`,
          `Restore ${RULES_HOME}/${n}.md, or delete this dead link.`);
      }
    }
  }

  // c. SKILLS -----------------------------------------------------------------
  const skills = []; // every folder in .agents/skills that holds a SKILL.md
  for (const n of listNames(skillsHome)) {
    const abs = path.join(skillsHome, n);
    if (!exists(abs)) {
      fail("skills", `${SKILLS_HOME}/${n}`, 1, `Dangling link "${n}" points at nothing.`, `Delete the dead link or restore its target.`);
    } else if (isFile(path.join(abs, "SKILL.md"))) {
      skills.push(n);
    }
  }
  for (const n of skills) {
    if (n in codexOnly) continue;
    for (const dir of SKILL_LINK_DIRS) {
      if (!lstat(path.join(root, dir, n))) {
        fail("skills", `${dir}/${n}`, 1, `Skill "${n}" has no ${dir} entry.`,
          `Run: ln -s ../../${SKILLS_HOME}/${n} ${dir}/${n} (or list "${n}" in codexOnlySkills in scripts/rules-drift-allow.json with a reason).`);
      }
    }
  }
  for (const dir of SKILL_LINK_DIRS) {
    for (const n of listNames(path.join(root, dir))) {
      const abs = path.join(root, dir, n);
      const st = lstat(abs);
      const where = `${dir}/${n}`;
      const want = `../../${SKILLS_HOME}/${n}`;
      if (st.isSymbolicLink()) {
        const target = fs.readlinkSync(abs).replace(/\/$/, "");
        if (target !== want) {
          fail("skills", where, 1, `Link points to "${target}", not "${want}".`, `Re-make the link: ln -sfn ${want} ${where}`);
        } else if (!exists(abs)) {
          fail("skills", where, 1, `Link "${where}" is dangling: ${SKILLS_HOME}/${n} does not exist.`,
            `Restore ${SKILLS_HOME}/${n}, or delete this dead link.`);
        }
      } else if (st.isDirectory()) {
        fail("skills", where, 1, `"${n}" is a real folder in ${dir}. That is a second copy of the skill.`,
          `Put any edits into ${SKILLS_HOME}/${n}/ (the one home), move this folder to ops/archive/, then run: ln -s ${want} ${where}`);
      }
    }
  }

  // The skills that are ours: not third-party. Codex-only ones are ours but have no links, so no scan.
  const ownSkills = skills.filter((n) => !thirdParty.has(n));
  const scanSkills = ownSkills.filter((n) => !(n in codexOnly));

  // d. POINTERS ---------------------------------------------------------------
  const pointerFiles = [
    "CLAUDE.md", "AGENTS.md", "docs/rules/RULES-INDEX.md",
    ...rules.map((n) => `${RULES_HOME}/${n}.md`),
    ...scanSkills.map((n) => `${SKILLS_HOME}/${n}/SKILL.md`),
  ].filter((f) => isFile(path.join(root, f)));
  const ptrRe = /(?<![\w.~/-])(\.(?:(?:cursor|claude)\/(?:rules|skills)|ai\/rules|agents\/skills)(?:\/[A-Za-z0-9_.-]*)*)/g;
  const bareHomes = new Set([".cursor/rules", ".claude/rules", ".cursor/skills", ".claude/skills", ".ai/rules", ".agents/skills"]);
  const pointerExempt = new Set(allow.pointerExempt || []);
  for (const f of pointerFiles) {
    read(path.join(root, f)).split("\n").forEach((line, i) => {
      if (/❌/.test(line)) return;
      for (const m of line.matchAll(ptrRe)) {
        let p = m[1].replace(/[.,;:)\]]+$/, "");
        // a "~/" prefix means the user's home folder, not this repo
        if (line[m.index - 1] === "/" && line[m.index - 2] === "~") continue;
        if (pointerExempt.has(p)) continue;
        if (/[<*{]/.test(line[m.index + m[1].length] || "")) continue; // placeholder or glob
        if (bareHomes.has(p)) continue;
        if (!exists(path.join(root, p))) {
          fail("pointer", f, i + 1, `Names "${p}" but it does not exist.`,
            `Fix the path to a real file, or remove the line if the rule is gone.`);
        }
      }
    });
  }

  // e. INDEX ------------------------------------------------------------------
  const indexPath = path.join(root, "docs/rules/RULES-INDEX.md");
  const indexExempt = allow.indexExempt || {};
  if (!isFile(indexPath)) {
    fail("index", "docs/rules/RULES-INDEX.md", 1, "The rules index file is missing.", "Restore docs/rules/RULES-INDEX.md.");
  } else {
    const indexText = read(indexPath);
    const named = (n) => new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(indexText);
    for (const n of rules) {
      if (!named(n) && !(n in indexExempt)) {
        fail("index", `${RULES_HOME}/${n}.md`, 1, `Rule "${n}" is not in docs/rules/RULES-INDEX.md.`, `Add a one-line entry for "${n}" to docs/rules/RULES-INDEX.md in the right topic.`);
      }
    }
    for (const n of ownSkills) {
      if (!named(n) && !(n in indexExempt)) {
        fail("index", `${SKILLS_HOME}/${n}/SKILL.md`, 1, `Skill "${n}" is not in docs/rules/RULES-INDEX.md.`, `Add "${n}" to the Skills list in docs/rules/RULES-INDEX.md.`);
      }
    }
  }

  // f. CLAUDE.md (short index) -----------------------------------------------
  const claudeMdPath = path.join(root, "CLAUDE.md");
  if (!isFile(claudeMdPath)) {
    fail("claudemd", "CLAUDE.md", 1, "CLAUDE.md is missing.", "Restore CLAUDE.md as the short index.");
  } else {
    const claudeMd = read(claudeMdPath);
    const claudeLines = claudeMd.split("\n");
    if (!claudeMd.includes("docs/rules/RULES-INDEX.md")) {
      fail("claudemd", "CLAUDE.md", 1, "CLAUDE.md does not name docs/rules/RULES-INDEX.md.",
        "Add the path docs/rules/RULES-INDEX.md so the short file points at the full index.");
    }
    const foundHeadings = new Set();
    claudeMd.split("\n").forEach((line) => {
      const hm = /^(#{1,6})\s+(3a|3b|3c|\d+)\b/.exec(line);
      if (hm) foundHeadings.add(hm[2]);
    });
    for (const h of CLAUDE_MD_HEADINGS) {
      if (!foundHeadings.has(h)) {
        fail("claudemd", "CLAUDE.md", 1, `CLAUDE.md is missing heading ${h}.`,
          `Keep heading ${h} (0 to 12, including 3a, 3b, and 3c). Do not delete a numbered heading.`);
      }
    }
    for (const named of namedClaudePaths(claudeMd)) {
      const p = named.path.replace(/\/+$/, "");
      if (!exists(path.join(root, p)) && !exists(path.join(root, named.path))) {
        fail("claudemd", "CLAUDE.md", lineAt(claudeMd, named.index), `Names "${named.path}" but it does not exist.`,
          "Fix the path to a real file, or remove the line if the path is gone.");
      }
    }
    if (claudeLines.length > CLAUDE_MD_MAX_LINES) {
      fail("claudemd", "CLAUDE.md", CLAUDE_MD_MAX_LINES + 1,
        `CLAUDE.md is ${claudeLines.length} lines; the cap is ${CLAUDE_MD_MAX_LINES}.`,
        "Keep CLAUDE.md as a short index. Move law text into .ai/rules. Do not delete a numbered heading.");
    }
  }
  const agentsMdPath = path.join(root, "AGENTS.md");
  if (isFile(agentsMdPath)) {
    const agentsLines = read(agentsMdPath).split("\n");
    if (agentsLines.length > AGENTS_MD_MAX_LINES) {
      fail("claudemd", "AGENTS.md", AGENTS_MD_MAX_LINES + 1,
        `AGENTS.md is ${agentsLines.length} lines; the cap is ${AGENTS_MD_MAX_LINES}.`,
        "Keep AGENTS.md as a short shared contract. Do not tighten this cap.");
    }
  }

  // g. RETIRED WORDS ----------------------------------------------------------
  const quoteContext = /❌|\bnever\b|^\s*(?:[-*>|]\s*)*(?:\*\*)?(?:do not|don't)\b|\b(?:retired|removed|dead|superseded|no longer|banned|obsolete|replaced)\b/i;
  const neverHeading = /^#{1,6}\s*(?:never|banned|do not)\b/i;
  const defaultScope = [...DEFAULT_RETIRED_PATHS, ...scanSkills.map((n) => `${SKILLS_HOME}/${n}`)];
  const scanCache = new Map();
  for (const entry of retired) {
    const re = new RegExp(entry.regex, entry.flags ?? "i");
    const scope = entry.paths || defaultScope;
    const allowLines = (entry.allow || []).map((a) => ({ file: a.file, line: a.line ? new RegExp(a.line, "i") : null }));
    const key = scope.join("|");
    if (!scanCache.has(key)) scanCache.set(key, realTextFiles(root, scope));
    for (const { abs, rel: f } of scanCache.get(key)) {
      let heading = "";
      read(abs).split("\n").forEach((line, i) => {
        if (/^#{1,6}\s/.test(line)) heading = line;
        if (!re.test(line)) return;
        if (entry.allowQuoteContext !== false && (quoteContext.test(line) || neverHeading.test(heading))) return;
        if (allowLines.some((a) => (!a.file || f === a.file || f.startsWith(a.file)) && (!a.line || a.line.test(line)))) return;
        fail("retired", f, i + 1,
          `"${entry.id}": "${line.trim().slice(0, 90)}" — killed by ${entry.killedBy}.`,
          entry.fix || `Rewrite the line to match ${entry.killedBy}, or point to it.`);
      });
    }
  }

  // h. DATES ------------------------------------------------------------------
  const decl = /owner[- ](?:law|set|rule)(?=\s*[(:,)*.—–]|\s+\d|\s*$)/i;
  const dateRe = /\d{4}-\d{2}-\d{2}/;
  const undated = allow.undatedLineExempt || [];
  const dateFiles = [...new Set([...pointerFiles])].filter((f) => f !== "docs/rules/RULES-INDEX.md");
  for (const f of dateFiles) {
    const text = read(path.join(root, f));
    const bodyStart = splitFrontMatter(text).bodyStart;
    const lines = text.split("\n");
    // A rule file whose body already carries a dated owner-law line may title itself
    // "# X — owner law" without repeating the date. CLAUDE.md and AGENTS.md get no such pass.
    const fileHasDated = lines.some((l, i) => i + 1 >= bodyStart && decl.test(l) && dateRe.test(l));
    const lenientHeadings = f !== "CLAUDE.md" && f !== "AGENTS.md" && fileHasDated;
    lines.forEach((line, i) => {
      if (i + 1 < bodyStart) return;
      if (!decl.test(line) || dateRe.test(line) || dateRe.test(lines[i + 1] || "")) return; // a wrapped line may carry the date on the next line
      if (/^\s*(?:✅|❌)/.test(line)) return; // example lines quote the law, they do not declare it
      if (lenientHeadings && /^#{1,6}\s/.test(line)) return;
      if (undated.some((u) => (!u.file || u.file === f) && line.includes(u.contains))) return;
      fail("dates", f, i + 1, `Owner-law line has no date: "${line.trim().slice(0, 90)}".`,
        `Add the date, like "(owner-set YYYY-MM-DD)". Undated lines lose to dated ones.`);
    });
  }

  return failures;
}

// ---------------------------------------------------------------- CLI

export function loadConfig(root = SCRIPT_ROOT) {
  const readJson = (p, fallback) => (isFile(p) ? JSON.parse(read(p)) : fallback);
  return {
    allow: readJson(path.join(root, "scripts/rules-drift-allow.json"), {}),
    retired: readJson(path.join(root, "scripts/rules-retired-phrases.json"), { phrases: [] }).phrases || [],
  };
}

export function formatReport(failures) {
  if (!failures.length) return "rules:check OK — no drift.";
  const out = [];
  const by = {};
  for (const f of failures) (by[f.check] ||= []).push(f);
  out.push(`rules:check FAILED — ${failures.length} drift problem(s)\n`);
  for (const key of Object.keys(CHECKS)) {
    const list = by[key];
    if (!list) continue;
    out.push(`## ${CHECKS[key]} (${list.length})`);
    for (const f of list) out.push(`  ${f.file}:${f.line}\n    ${f.message}\n    Fix: ${f.fix}`);
    out.push("");
  }
  return out.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootArg = process.argv.find((a) => a.startsWith("--root="));
  const root = rootArg ? path.resolve(rootArg.slice(7)) : SCRIPT_ROOT;
  const { allow, retired } = loadConfig(SCRIPT_ROOT); // checker config always comes from this repo
  const failures = checkRules({ root, allow, retired });
  if (process.argv.includes("--json")) console.log(JSON.stringify(failures, null, 1));
  else {
    console.log(formatReport(failures));
    if (failures.length) {
      const counts = {};
      for (const f of failures) counts[f.check] = (counts[f.check] || 0) + 1;
      console.log("Counts: " + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", "));
    }
  }
  process.exit(failures.length ? 1 : 0);
}
