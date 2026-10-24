#!/usr/bin/env node
// npm run rules:check — the rules-drift guard (owner call 2026-10-24).
//
// Chris: "Can we ensure this drift never happens again?" On 2026-10-24 four
// audits found 43 conflicts, 35 stale lines and 48 mirror gaps. This script is
// what keeps it from coming back. It runs inside `npm test`
// (src/rules/rules-drift-check.test.mjs), so a push that drifts the rules goes
// red.
//
// Plain Node, no dependencies. READ ONLY: it never edits a rule.
//
// Checks (each failure names file:line and a one-line plain fix):
//   mirror   a  every .cursor/rules/<n>.mdc has .claude/rules/<n>.md, and back
//   twin     b  the two twins say the same words (front matter ignored)
//   skills   c  every .cursor/skills/<n> has .claude/skills/<n> (a link), no dead links
//   pointer  d  every rule/skill path named in the rule homes exists
//   index    e  every rule and skill is in docs/rules/RULES-INDEX.md
//   claudemd f  every always-on owner law is named in CLAUDE.md
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
  mirror: "Mirror: a rule is missing its other home",
  twin: "Twin words: the two homes say different things",
  skills: "Skills: missing or broken .claude/skills link",
  pointer: "Pointer: a named rule or skill path does not exist",
  index: "Index: not listed in docs/rules/RULES-INDEX.md",
  claudemd: "CLAUDE.md line: always-on owner law is not named in CLAUDE.md",
  retired: "Retired words: a phrase a newer owner law killed is still live",
  dates: "Dates: an owner-law line has no YYYY-MM-DD date",
};

const DEFAULT_RETIRED_PATHS = ["CLAUDE.md", "AGENTS.md", ".cursor/rules", ".claude/rules", ".cursor/skills", "docs/rules"];

// ---------------------------------------------------------------- file helpers

const exists = (p) => fs.existsSync(p);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
const read = (p) => fs.readFileSync(p, "utf8");
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

function listFiles(dir, ext) {
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(ext) && isFile(path.join(dir, n))).sort();
}
function listDirs(dir) {
  if (!isDir(dir)) return [];
  // lstat so a dangling link is still listed (the skills check reports it).
  return fs.readdirSync(dir).filter((n) => {
    const st = lstat(path.join(dir, n));
    return st && (st.isDirectory() || st.isSymbolicLink());
  }).sort();
}
function walkText(p, out = []) {
  if (isFile(p)) { if (/\.(md|mdc)$/.test(p)) out.push(p); return out; }
  if (!isDir(p)) return out;
  for (const n of fs.readdirSync(p).sort()) {
    if (n === "node_modules" || n === ".git") continue;
    walkText(path.join(p, n), out);
  }
  return out;
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

function alwaysApply(text) {
  const { fm } = splitFrontMatter(text);
  return /^alwaysApply:\s*true\s*$/m.test(fm);
}

// ---------------------------------------------------------------- the checks

export function checkRules({ root = SCRIPT_ROOT, allow = {}, retired = [] } = {}) {
  const failures = [];
  const fail = (check, file, line, message, fix) => failures.push({ check, file, line: line || 1, message, fix });

  const cursorRulesDir = path.join(root, ".cursor/rules");
  const claudeRulesDir = path.join(root, ".claude/rules");
  const cursorSkillsDir = path.join(root, ".cursor/skills");
  const claudeSkillsDir = path.join(root, ".claude/skills");
  const cursorOnly = allow.cursorOnlyRules || {};
  const claudeOnly = allow.claudeOnlyRules || {};
  const realSkillFolders = allow.realSkillFolders || {};

  const cursorRules = listFiles(cursorRulesDir, ".mdc").map((f) => f.slice(0, -4));
  const claudeRules = listFiles(claudeRulesDir, ".md").map((f) => f.slice(0, -3));
  const cursorSet = new Set(cursorRules);
  const claudeSet = new Set(claudeRules);

  // a. MIRROR -----------------------------------------------------------------
  for (const n of cursorRules) {
    if (!claudeSet.has(n) && !(n in cursorOnly)) {
      fail("mirror", `.cursor/rules/${n}.mdc`, 1, `Cursor rule "${n}" has no Claude twin.`,
        `Add .claude/rules/${n}.md with the same words (or add "${n}" to cursorOnlyRules in scripts/rules-drift-allow.json with a reason).`);
    }
  }
  for (const n of claudeRules) {
    if (!cursorSet.has(n) && !(n in claudeOnly)) {
      fail("mirror", `.claude/rules/${n}.md`, 1, `Claude rule "${n}" has no Cursor twin.`,
        `Add .cursor/rules/${n}.mdc with the same words (or add "${n}" to claudeOnlyRules in scripts/rules-drift-allow.json with a reason).`);
    }
  }

  // b. TWIN WORDS -------------------------------------------------------------
  const normalize = (text) => {
    const { body, bodyStart } = splitFrontMatter(text);
    const out = [];
    body.split("\n").forEach((raw, i) => {
      let s = raw
        // path style only: ".cursor/rules/x.mdc", ".claude/rules/x.md" and bare "x.mdc" all mean the same rule
        .replace(/\.(?:cursor|claude)\/rules\//g, "")
        .replace(/\.cursor\/skills\b/g, ".claude/skills")
        .replace(/\b([A-Za-z0-9_-]+)\.mdc\b/g, "$1.md")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (s) out.push({ s, line: bodyStart + i });
    });
    return out;
  };
  const twinExempt = allow.twinWordsExempt || {};
  for (const n of cursorRules) {
    if (!claudeSet.has(n) || n in twinExempt) continue;
    const a = normalize(read(path.join(cursorRulesDir, `${n}.mdc`)));
    const b = normalize(read(path.join(claudeRulesDir, `${n}.md`)));
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] && b[i] && a[i].s === b[i].s) continue;
      const aLine = a[i] ? a[i].line : a[a.length - 1]?.line || 1;
      const bLine = b[i] ? b[i].line : b[b.length - 1]?.line || 1;
      const snip = (x) => (x ? `"${x.s.slice(0, 70)}"` : "(end of file)");
      fail("twin", `.cursor/rules/${n}.mdc:${aLine} vs .claude/rules/${n}.md:${bLine}`, aLine,
        `Twins differ. Cursor says ${snip(a[i])}; Claude says ${snip(b[i])}.`,
        `Make both files say the same words (copy the newer one into the other).`);
      break; // one report per pair
    }
  }

  // c. SKILLS -----------------------------------------------------------------
  const cursorSkills = listDirs(cursorSkillsDir).filter((n) => isFile(path.join(cursorSkillsDir, n, "SKILL.md")));
  for (const n of cursorSkills) {
    const link = path.join(claudeSkillsDir, n);
    const st = lstat(link);
    const where = `.claude/skills/${n}`;
    if (!st) {
      fail("skills", where, 1, `Skill "${n}" has no .claude/skills entry.`,
        `Run: ln -s ../../.cursor/skills/${n} .claude/skills/${n}`);
    } else if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(link);
      const want = `../../.cursor/skills/${n}`;
      if (target.replace(/\/$/, "") !== want) {
        fail("skills", where, 1, `Link points to "${target}", not "${want}".`, `Re-make the link: ln -sfn ${want} ${where}`);
      } else if (!exists(link)) {
        fail("skills", where, 1, `Link "${where}" is dangling.`, `Re-make the link: ln -sfn ${want} ${where}`);
      }
    } else if (!(n in realSkillFolders)) {
      fail("skills", where, 1, `"${n}" is a real folder in .claude/skills, not a link.`,
        `Replace it with a link to ../../.cursor/skills/${n} (or list it in realSkillFolders in scripts/rules-drift-allow.json with a reason).`);
    }
  }
  for (const n of listDirs(claudeSkillsDir)) {
    const link = path.join(claudeSkillsDir, n);
    const st = lstat(link);
    if (st && st.isSymbolicLink() && !exists(link)) {
      // already reported above if a Cursor twin exists
      if (!cursorSkills.includes(n)) {
        fail("skills", `.claude/skills/${n}`, 1, `Dangling link "${n}" points at nothing.`, `Delete the dead link or restore its target.`);
      }
    } else if (st && st.isDirectory() && !st.isSymbolicLink() && !cursorSkills.includes(n) && !(n in realSkillFolders)) {
      fail("skills", `.claude/skills/${n}`, 1, `Real skill folder "${n}" has no Cursor twin.`,
        `Move it to .cursor/skills/${n}/ and link it (or list it in realSkillFolders with a reason).`);
    }
  }

  // d. POINTERS ---------------------------------------------------------------
  const pointerFiles = [
    "CLAUDE.md", "AGENTS.md", "docs/rules/RULES-INDEX.md",
    ...cursorRules.map((n) => `.cursor/rules/${n}.mdc`),
    ...claudeRules.map((n) => `.claude/rules/${n}.md`),
    ...cursorSkills.map((n) => `.cursor/skills/${n}/SKILL.md`),
  ].filter((f) => isFile(path.join(root, f)));
  const ptrRe = /(?<![\w.~/-])(\.(?:cursor|claude)\/(?:rules|skills)(?:\/[A-Za-z0-9_.-]*)*)/g;
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
        if (p === ".cursor/rules" || p === ".claude/rules" || p === ".cursor/skills" || p === ".claude/skills") continue;
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
    const allRules = [...new Set([...cursorRules, ...claudeRules])];
    for (const n of allRules) {
      if (!named(n) && !(n in indexExempt)) {
        const f = cursorSet.has(n) ? `.cursor/rules/${n}.mdc` : `.claude/rules/${n}.md`;
        fail("index", f, 1, `Rule "${n}" is not in docs/rules/RULES-INDEX.md.`, `Add a one-line entry for "${n}" to docs/rules/RULES-INDEX.md in the right topic.`);
      }
    }
    const allSkills = [...new Set([...cursorSkills, ...Object.keys(realSkillFolders)])];
    for (const n of allSkills) {
      if (!named(n) && !(n in indexExempt)) {
        fail("index", `.cursor/skills/${n}/SKILL.md`, 1, `Skill "${n}" is not in docs/rules/RULES-INDEX.md.`, `Add "${n}" to the Skills list in docs/rules/RULES-INDEX.md.`);
      }
    }
  }

  // f. CLAUDE.md LINE ---------------------------------------------------------
  const claudeMdPath = path.join(root, "CLAUDE.md");
  const claudeMdExempt = allow.claudeMdLineExempt || {};
  if (isFile(claudeMdPath)) {
    const claudeMd = read(claudeMdPath);
    const inClaudeMd = (n) => new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(claudeMd);
    const allRules = [...new Set([...cursorRules, ...claudeRules])];
    for (const n of allRules) {
      const cPath = path.join(cursorRulesDir, `${n}.mdc`);
      const lPath = path.join(claudeRulesDir, `${n}.md`);
      const text = isFile(cPath) ? read(cPath) : read(lPath);
      const always = isFile(cPath) ? alwaysApply(text) : true;
      if (!always) continue;
      if (!/owner[- ]law|owner[- ]set/i.test(text)) continue;
      if (inClaudeMd(n) || n in claudeMdExempt) continue;
      fail("claudemd", isFile(cPath) ? `.cursor/rules/${n}.mdc` : `.claude/rules/${n}.md`, 1,
        `Always-on owner law "${n}" is not named in CLAUDE.md.`,
        `Add one short owner-set line to CLAUDE.md that ends "Same law: .cursor/rules/${n}.mdc and .claude/rules/${n}.md." (or list it in claudeMdLineExempt with a reason).`);
    }
  }

  // g. RETIRED WORDS ----------------------------------------------------------
  const quoteContext = /❌|\bnever\b|^\s*(?:[-*>|]\s*)*(?:\*\*)?(?:do not|don't)\b|\b(?:retired|removed|dead|superseded|no longer|banned|obsolete|replaced)\b/i;
  const neverHeading = /^#{1,6}\s*(?:never|banned|do not)\b/i;
  for (const entry of retired) {
    const re = new RegExp(entry.regex, entry.flags ?? "i");
    const scope = entry.paths || DEFAULT_RETIRED_PATHS;
    const allowLines = (entry.allow || []).map((a) => ({ file: a.file, line: a.line ? new RegExp(a.line, "i") : null }));
    const files = [...new Set(scope.flatMap((p) => walkText(path.join(root, p))))].sort();
    for (const abs of files) {
      const f = rel(root, abs);
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
