// The rules-drift guard (owner call 2026-10-24). Runs on every push inside `npm test`.
//
// Part 1 runs the checker on THIS repo and fails with the checker's own messages.
// Part 2 proves each check can go red (a planted bad case in a temp folder) and
// stay green (a good case). A check that can only pass is not a guard.
//
// The layout it guards (drift cleanup, phase 2): every rule is ONE real file in
// .ai/rules with links in .cursor/rules and .claude/rules; every skill is ONE real
// folder in .agents/skills with links in .cursor/skills and .claude/skills.
//
// If part 1 fails, fix the RULE TEXT or the LINK (or, for a real exception, add a reasoned
// entry to scripts/rules-drift-allow.json). Never weaken this test to get green.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkRules, formatReport, loadConfig } from "../../scripts/rules-drift-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the repo's rules have not drifted", () => {
  const { allow, retired } = loadConfig(ROOT);
  const failures = checkRules({ root: ROOT, allow, retired });
  assert.equal(failures.length, 0, "\n" + formatReport(failures));
});

test("the one-home folders are not empty (a check over nothing proves nothing)", () => {
  const names = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((n) => !n.startsWith("."));
  assert.ok(names(".ai/rules").some((n) => n.endsWith(".md")), ".ai/rules holds no rule files");
  assert.ok(names(".agents/skills").some((n) => fs.existsSync(path.join(ROOT, ".agents/skills", n, "SKILL.md"))), ".agents/skills holds no skills");
  // and the tool folders are links, so a rule edit has exactly one place to land
  assert.ok(fs.lstatSync(path.join(ROOT, ".cursor/rules", names(".cursor/rules")[0])).isSymbolicLink(), ".cursor/rules should hold links");
  assert.ok(fs.lstatSync(path.join(ROOT, ".claude/rules", names(".claude/rules")[0])).isSymbolicLink(), ".claude/rules should hold links");
});

test("every allow-list entry carries a reason", () => {
  const { allow } = loadConfig(ROOT);
  for (const group of ["cursorOnlyRules", "codexOnlySkills", "claudeMdLineExempt", "indexExempt"]) {
    for (const [name, reason] of Object.entries(allow[group] || {})) {
      assert.ok(typeof reason === "string" && reason.length > 10, `${group}.${name} needs a one-line reason`);
    }
  }
  for (const u of allow.undatedLineExempt || []) assert.ok(u.reason, "undatedLineExempt entries need a reason");
});

test("every retired phrase names the law that killed it", () => {
  const { retired } = loadConfig(ROOT);
  assert.ok(retired.length > 0);
  for (const r of retired) {
    assert.ok(r.id && r.regex && r.killedBy, `retired entry needs id, regex, killedBy: ${JSON.stringify(r)}`);
    assert.match(r.killedBy, /\d{4}-\d{2}-\d{2}|section \d+/i, `${r.id}: killedBy should name a date or CLAUDE.md section`);
    assert.doesNotThrow(() => new RegExp(r.regex, r.flags ?? "i"));
  }
});

// ---- temp-repo helpers -----------------------------------------------------

const made = [];
after(() => { for (const r of made) fs.rmSync(r, { recursive: true, force: true }); });

const FM = "---\ndescription: x\nalwaysApply: true\n---\n";
function put(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
function link(root, rel, target) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.symlinkSync(target, p);
}
const drop = (root, rel) => fs.rmSync(path.join(root, rel), { recursive: true, force: true });

/** A rule the right way: the one real file, plus its Cursor link and (unless told not to) its Claude link. */
function addRule(root, n, text, { claudeLink = true } = {}) {
  put(root, `.ai/rules/${n}.md`, text);
  link(root, `.cursor/rules/${n}.mdc`, `../../.ai/rules/${n}.md`);
  if (claudeLink) link(root, `.claude/rules/${n}.md`, `../../.ai/rules/${n}.md`);
}
/** A skill the right way: the one real folder, plus both links (unless told not to). */
function addSkill(root, n, text = `---\nname: ${n}\n---\nSkill body.\n`, { links = true } = {}) {
  put(root, `.agents/skills/${n}/SKILL.md`, text);
  if (links) {
    link(root, `.cursor/skills/${n}`, `../../.agents/skills/${n}`);
    link(root, `.claude/skills/${n}`, `../../.agents/skills/${n}`);
  }
}

/** A tiny repo with one rule, one skill and one index, all consistent. */
function goodRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-drift-"));
  made.push(root);
  addRule(root, "demo", FM + "# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `.cursor/rules/demo.mdc`.\n");
  addSkill(root, "demo-skill");
  put(root, "docs/rules/RULES-INDEX.md", "# Index\n- `demo` rule\n- `demo-skill` skill\n");
  put(root, "CLAUDE.md", "# Claude\nDemo law (owner-set 2026-10-24). Same law: .ai/rules/demo.md.\n");
  put(root, "AGENTS.md", "# Agents\nShort rules.\n");
  return root;
}
const run = (root, extra = {}) => checkRules({ root, allow: {}, retired: [], ...extra });
const kinds = (fs_) => [...new Set(fs_.map((f) => f.check))];

test("good repo passes every check", () => {
  const root = goodRepo();
  assert.deepEqual(run(root), []);
});

// ---- a. mirror ---------------------------------------------------------------

test("mirror: a rule with no links fails; a missing Claude link fails; the allow-list excuses only the Claude link", () => {
  const root = goodRepo();
  put(root, ".ai/rules/lonely.md", FM + "Lonely. (owner-set 2026-10-24)\n");
  put(root, "docs/rules/RULES-INDEX.md", "`demo` `demo-skill` `lonely`");
  put(root, "CLAUDE.md", "demo lonely");
  let f = run(root);
  assert.deepEqual(kinds(f), ["mirror"]);
  assert.equal(f.length, 2, "no Cursor link and no Claude link");
  assert.ok(f.some((x) => /\.cursor\/rules\/lonely\.mdc/.test(x.message)));
  assert.ok(f.some((x) => /\.claude\/rules\/lonely\.md/.test(x.message)));

  link(root, ".cursor/rules/lonely.mdc", "../../.ai/rules/lonely.md");
  f = run(root);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /\.claude\/rules\/lonely\.md/);
  assert.deepEqual(run(root, { allow: { cursorOnlyRules: { lonely: "Cursor only, on purpose." } } }), []);

  // The Cursor link is never optional, even for a Cursor-only rule.
  drop(root, ".cursor/rules/lonely.mdc");
  f = run(root, { allow: { cursorOnlyRules: { lonely: "Cursor only, on purpose." } } });
  assert.equal(f.length, 1);
  assert.match(f[0].message, /\.cursor\/rules\/lonely\.mdc/);
});

test("mirror: .ai/rules holds real .md files only", () => {
  const root = goodRepo();
  put(root, ".ai/rules/odd.mdc", FM + "x\n");
  let f = run(root);
  assert.deepEqual(kinds(f), ["mirror"]);
  assert.match(f[0].message, /does not end in \.md/);
  drop(root, ".ai/rules/odd.mdc");
  put(root, "elsewhere/real.md", FM + "x (owner-set 2026-10-24)\n");
  link(root, ".ai/rules/linked.md", "../../elsewhere/real.md");
  f = run(root);
  assert.ok(f.some((x) => x.check === "mirror" && /not a real file/.test(x.message)));
  // a README is a note about the folder, not a rule: it needs no links and no index line
  drop(root, ".ai/rules/linked.md");
  put(root, ".ai/rules/README.md", "# Notes about this folder\n");
  assert.deepEqual(run(root), []);
});

// ---- b. links ----------------------------------------------------------------

test("link: a real file left in .cursor/rules or .claude/rules fails as a copy", () => {
  const root = goodRepo();
  drop(root, ".claude/rules/demo.md");
  put(root, ".claude/rules/demo.md", "A copy.\n");
  let f = run(root);
  assert.deepEqual(kinds(f), ["link"]);
  assert.equal(f.length, 1);
  assert.equal(f[0].file, ".claude/rules/demo.md");
  assert.match(f[0].message, /real file, not a link/);
  drop(root, ".cursor/rules/demo.mdc");
  put(root, ".cursor/rules/demo.mdc", FM + "A copy.\n");
  assert.equal(run(root).filter((x) => x.check === "link").length, 2);
  // a stray rule that never had a home is a copy too
  put(root, ".claude/rules/stray.md", "Stray.\n");
  assert.ok(run(root).some((x) => x.check === "link" && x.file === ".claude/rules/stray.md"));
});

test("link: a wrong target, an absolute link and a dangling link fail; the right link passes", () => {
  const root = goodRepo();
  drop(root, ".cursor/rules/demo.mdc");
  link(root, ".cursor/rules/demo.mdc", "../../.ai/rules/other.md");
  // (the demo rule also names .cursor/rules/demo.mdc in its text, which no longer opens, so the pointer check fires too)
  let f = run(root).filter((x) => x.check === "link");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /not "\.\.\/\.\.\/\.ai\/rules\/demo\.md"/);
  // an absolute link would break on any other checkout
  drop(root, ".cursor/rules/demo.mdc");
  link(root, ".cursor/rules/demo.mdc", path.join(root, ".ai/rules/demo.md"));
  assert.ok(run(root).some((x) => x.check === "link" && /Link points to/.test(x.message)));
  drop(root, ".cursor/rules/demo.mdc");
  link(root, ".cursor/rules/demo.mdc", "../../.ai/rules/demo.md");
  assert.deepEqual(run(root), []);
  // dangling: the real file is gone but both links remain
  drop(root, ".ai/rules/demo.md");
  f = run(root).filter((x) => x.check === "link");
  assert.equal(f.length, 2);
  assert.match(f[0].message, /dangling/);
});

// ---- c. skills ---------------------------------------------------------------

test("skills: a missing link, a wrong link, a dead link and a real folder fail", () => {
  const root = goodRepo();
  drop(root, ".claude/skills/demo-skill");
  assert.ok(run(root).some((x) => x.check === "skills" && /no \.claude\/skills entry/.test(x.message)));
  drop(root, ".cursor/skills/demo-skill");
  assert.ok(run(root).some((x) => x.check === "skills" && /no \.cursor\/skills entry/.test(x.message)));

  // the OLD layout's target is wrong now
  link(root, ".claude/skills/demo-skill", "../../.cursor/skills/demo-skill");
  assert.ok(run(root).some((x) => x.check === "skills" && /not "\.\.\/\.\.\/\.agents\/skills\/demo-skill"/.test(x.message)));
  drop(root, ".claude/skills/demo-skill");

  // a real folder is a second copy
  put(root, ".claude/skills/demo-skill/SKILL.md", "stub\n");
  assert.ok(run(root).some((x) => x.check === "skills" && /real folder/.test(x.message)));
  drop(root, ".claude/skills/demo-skill");
  link(root, ".claude/skills/demo-skill", "../../.agents/skills/demo-skill");
  link(root, ".cursor/skills/demo-skill", "../../.agents/skills/demo-skill");
  assert.deepEqual(run(root), []);

  // a link to a skill that is gone
  link(root, ".claude/skills/ghost", "../../.agents/skills/ghost");
  assert.ok(run(root).some((x) => x.check === "skills" && /dangling/i.test(x.message)));
  drop(root, ".claude/skills/ghost");
  // a dead link inside the one home itself
  link(root, ".agents/skills/dead", "../../nowhere");
  assert.ok(run(root).some((x) => x.check === "skills" && x.file === ".agents/skills/dead"));
});

test("skills: a skill with no links fails unless it is listed Codex-only, and it still has to be in the index", () => {
  const root = goodRepo();
  addSkill(root, "solo", undefined, { links: false });
  put(root, "docs/rules/RULES-INDEX.md", "`demo` `demo-skill` `solo`");
  assert.equal(run(root).filter((x) => x.check === "skills").length, 2);
  const allow = { codexOnlySkills: { solo: "Codex's own copy." } };
  assert.deepEqual(run(root, { allow }), []);
  put(root, "docs/rules/RULES-INDEX.md", "`demo` `demo-skill`");
  assert.deepEqual(kinds(run(root, { allow })), ["index"]);
});

test("skills: a third-party skill (skills-lock.json) is linked like ours but skipped by the index and the retired-word scan", () => {
  const root = goodRepo();
  addSkill(root, "vendor-skill", "---\nname: vendor-skill\n---\nWorks with Vercel and Neon.\n");
  const retired = [{ id: "vercel", regex: "Vercel", flags: "", killedBy: "CLAUDE.md section 11" }];
  // not in the lock file: it is ours, so the index and the scan both apply
  assert.deepEqual(kinds(run(root, { retired })).sort(), ["index", "retired"]);
  put(root, "skills-lock.json", JSON.stringify({ version: 1, skills: { "vendor-skill": { source: "vendor/skills" } } }));
  assert.deepEqual(run(root, { retired }), []);
  // it still has to be linked
  drop(root, ".cursor/skills/vendor-skill");
  assert.ok(run(root, { retired }).some((x) => x.check === "skills"));
});

// ---- d. pointer --------------------------------------------------------------

test("pointer: a named path that does not exist fails; placeholders, globs, ~/ paths and real paths pass", () => {
  const root = goodRepo();
  put(root, "AGENTS.md", "See `.cursor/rules/ghost.mdc`, `.ai/rules/ghost.md`, `.claude/skills/phantom/SKILL.md` and `.agents/skills/phantom/SKILL.md`.\n");
  const f = run(root).filter((x) => x.check === "pointer");
  assert.equal(f.length, 4);
  assert.equal(f[0].file, "AGENTS.md");
  assert.equal(f[0].line, 1);
  put(root, "AGENTS.md",
    "Pattern `.cursor/rules/<name>.mdc`, glob `.ai/rules/*.md`, home `~/.cursor/skills/x`, bare `.agents/skills`, " +
    "real `.cursor/rules/demo.mdc` `.claude/rules/demo.md` `.ai/rules/demo.md` `.agents/skills/demo-skill/SKILL.md` `.cursor/skills/demo-skill/SKILL.md`.\n");
  assert.deepEqual(run(root).filter((x) => x.check === "pointer"), []);
});

// ---- e. index ----------------------------------------------------------------

test("index: a rule or skill missing from RULES-INDEX.md fails", () => {
  const root = goodRepo();
  put(root, "docs/rules/RULES-INDEX.md", "# Index\n- `demo-skill`\n");
  let f = run(root);
  assert.deepEqual(kinds(f), ["index"]);
  assert.match(f[0].message, /"demo"/);
  put(root, "docs/rules/RULES-INDEX.md", "# Index\n- `demo`\n");
  f = run(root);
  assert.match(f[0].message, /"demo-skill"/);
});

// ---- f. claudemd -------------------------------------------------------------

test("claudemd: an always-on owner law not named in CLAUDE.md fails; a glob rule is not required", () => {
  const root = goodRepo();
  put(root, "CLAUDE.md", "# Claude\nNothing here.\n");
  let f = run(root);
  assert.deepEqual(kinds(f), ["claudemd"]);
  assert.equal(f[0].file, ".ai/rules/demo.md");
  assert.deepEqual(run(root, { allow: { claudeMdLineExempt: { demo: "Covered by AGENTS.md." } } }), []);
  put(root, ".ai/rules/demo.md", "---\ndescription: x\nalwaysApply: false\n---\n# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `.cursor/rules/demo.mdc`.\n");
  assert.deepEqual(run(root), []);
  // No front matter at all: Claude still loads it every time, so it needs its CLAUDE.md line.
  put(root, ".ai/rules/demo.md", "# Demo\n\n**Owner law (2026-10-24):** Do the thing.\n");
  assert.deepEqual(kinds(run(root)), ["claudemd"]);
});

// ---- g. retired --------------------------------------------------------------

test("retired: a killed phrase fails; Never/red-X lines, Never headings and exceptions pass", () => {
  const root = goodRepo();
  const retired = [{ id: "brand", regex: "FundHub", flags: "", killedBy: "fundhub-company-name (owner law 2026-09-21)", fix: "Write Fundhub." }];
  put(root, "AGENTS.md", "Welcome to FundHub.\n");
  let f = run(root, { retired });
  assert.deepEqual(kinds(f), ["retired"]);
  assert.equal(f[0].file, "AGENTS.md");
  put(root, "AGENTS.md", "Never write FundHub.\n❌ FundHub\n## Never\n- FundHub here is quoted\n");
  assert.deepEqual(run(root, { retired }), []);
  put(root, "AGENTS.md", "Welcome to FundHub.\n");
  assert.deepEqual(run(root, { retired: [{ ...retired[0], allow: [{ file: "AGENTS.md", line: "Welcome" }] }] }), []);
  // out-of-scope paths are not scanned
  put(root, "marketing/x.md", "FundHub\n");
  put(root, "AGENTS.md", "fine\n");
  assert.deepEqual(run(root, { retired }), []);
  // path scoping can be narrowed or widened per entry
  assert.equal(run(root, { retired: [{ ...retired[0], paths: ["marketing"] }] }).length, 1);
});

test("retired: a bad line in a rule or in one of our skills is found once, at the real path", () => {
  const root = goodRepo();
  const retired = [{ id: "brand", regex: "FundHub", flags: "", killedBy: "fundhub-company-name (owner law 2026-09-21)" }];
  put(root, ".ai/rules/demo.md", FM + "# Demo\n\n**Owner law (2026-10-24):** Welcome to FundHub.\n");
  let f = run(root, { retired }).filter((x) => x.check === "retired");
  assert.equal(f.length, 1, "the rule has three paths (.ai, .cursor, .claude) but one line");
  assert.equal(f[0].file, ".ai/rules/demo.md");
  put(root, ".agents/skills/demo-skill/SKILL.md", "---\nname: demo-skill\n---\nWelcome to FundHub.\n");
  f = run(root, { retired }).filter((x) => x.check === "retired");
  assert.deepEqual(f.map((x) => x.file), [".agents/skills/demo-skill/SKILL.md", ".ai/rules/demo.md"]);
});

test("retired: a file reached through links is reported once even when the scope names every path to it", () => {
  const root = goodRepo();
  put(root, ".ai/rules/demo.md", FM + "# Demo\n\n**Owner law (2026-10-24):** Welcome to FundHub.\n");
  put(root, ".agents/skills/demo-skill/SKILL.md", "---\nname: demo-skill\n---\nWelcome to FundHub.\n");
  const entry = {
    id: "brand", regex: "FundHub", flags: "", killedBy: "fundhub-company-name (owner law 2026-09-21)",
    paths: [".cursor/rules", ".claude/rules", ".ai/rules", ".cursor/skills", ".claude/skills", ".agents/skills"],
  };
  const f = run(root, { retired: [entry] }).filter((x) => x.check === "retired");
  assert.deepEqual(f.map((x) => x.file), [".agents/skills/demo-skill/SKILL.md", ".ai/rules/demo.md"]);
});

test("retired: a link loop in a scanned folder ends and reports a line once", () => {
  const root = goodRepo();
  const retired = [{ id: "brand", regex: "FundHub", flags: "", killedBy: "fundhub-company-name (owner law 2026-09-21)" }];
  fs.symlinkSync(".", path.join(root, "docs/rules/loop"));
  put(root, "docs/rules/NOTE.md", "Welcome to FundHub.\n");
  const f = run(root, { retired }).filter((x) => x.check === "retired");
  assert.deepEqual(f.map((x) => x.file), ["docs/rules/NOTE.md"]);
});

// ---- h. dates ----------------------------------------------------------------

test("dates: an owner-law line with no date fails; dated, wrapped, example and prose lines pass", () => {
  const root = goodRepo();
  put(root, "AGENTS.md", "**Owner law:** no date here.\n");
  let f = run(root).filter((x) => x.check === "dates");
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 1 + 0);
  put(root, "AGENTS.md", "**Owner-set,\n2026-10-24:** wrapped.\n✅ Say it by owner law.\nOwner-set terms still repeat.\n(owner-set 2026-01-02)\n");
  assert.deepEqual(run(root).filter((x) => x.check === "dates"), []);
  put(root, "AGENTS.md", "Env law (owner-set): bare.\n");
  assert.equal(run(root).filter((x) => x.check === "dates").length, 1);
  assert.deepEqual(run(root, { allow: { undatedLineExempt: [{ file: "AGENTS.md", contains: "Env law", reason: "x" }] } }).filter((x) => x.check === "dates"), []);
});

test("dates: an undated owner-law line in a rule is reported once, at the one real file", () => {
  const root = goodRepo();
  put(root, ".ai/rules/demo.md", FM + "# Demo\n\n**Owner law:** no date here.\n");
  const f = run(root).filter((x) => x.check === "dates");
  assert.equal(f.length, 1);
  assert.equal(f[0].file, ".ai/rules/demo.md");
});

// ---- report ------------------------------------------------------------------

test("formatReport groups by check with counts", () => {
  const out = formatReport([
    { check: "mirror", file: "a", line: 1, message: "m", fix: "f" },
    { check: "mirror", file: "b", line: 2, message: "m", fix: "f" },
    { check: "link", file: "c", line: 3, message: "m", fix: "f" },
  ]);
  assert.match(out, /Mirror.*\(2\)/);
  assert.match(out, /Links.*\(1\)/);
  assert.match(out, /a:1/);
  assert.match(formatReport([]), /OK/);
});
