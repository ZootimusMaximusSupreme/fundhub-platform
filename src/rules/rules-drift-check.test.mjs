// The rules-drift guard (owner call 2026-10-24). Runs on every push inside `npm test`.
//
// Part 1 runs the checker on THIS repo and fails with the checker's own messages.
// Part 2 proves each check can go red (a planted bad case in a temp folder) and
// stay green (a good case). A check that can only pass is not a guard.
//
// If part 1 fails, fix the RULE TEXT (or, for a real exception, add a reasoned entry
// to scripts/rules-drift-allow.json). Never weaken this test to get green.

import test from "node:test";
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

test("every allow-list entry carries a reason", () => {
  const { allow } = loadConfig(ROOT);
  for (const group of ["cursorOnlyRules", "claudeOnlyRules", "realSkillFolders", "claudeMdLineExempt", "twinWordsExempt", "indexExempt"]) {
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

const FM = "---\ndescription: x\nalwaysApply: true\n---\n";
function put(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
/** A tiny repo with one rule pair, one skill and one index, all consistent. */
function goodRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rules-drift-"));
  const body = "# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `.cursor/rules/demo.mdc`.\n";
  put(root, ".cursor/rules/demo.mdc", FM + body);
  put(root, ".claude/rules/demo.md", body.replace(".cursor/rules/demo.mdc", ".claude/rules/demo.md"));
  put(root, ".cursor/skills/demo-skill/SKILL.md", "---\nname: demo-skill\n---\nSkill body.\n");
  fs.mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  fs.symlinkSync("../../.cursor/skills/demo-skill", path.join(root, ".claude/skills/demo-skill"));
  put(root, "docs/rules/RULES-INDEX.md", "# Index\n- `demo` rule\n- `demo-skill` skill\n");
  put(root, "CLAUDE.md", "# Claude\nDemo law (owner-set 2026-10-24). Same law: .cursor/rules/demo.mdc and .claude/rules/demo.md.\n");
  put(root, "AGENTS.md", "# Agents\nShort rules.\n");
  return root;
}
const run = (root, extra = {}) => checkRules({ root, allow: {}, retired: [], ...extra });
const kinds = (fs_) => [...new Set(fs_.map((f) => f.check))];

test("good repo passes every check", () => {
  const root = goodRepo();
  assert.deepEqual(run(root), []);
});

test("mirror: a Cursor rule with no Claude twin fails, and the allow-list excuses it", () => {
  const root = goodRepo();
  put(root, ".cursor/rules/lonely.mdc", FM + "Lonely. (owner-set 2026-10-24)\n");
  put(root, "docs/rules/RULES-INDEX.md", "`demo` `demo-skill` `lonely`");
  put(root, "CLAUDE.md", "demo lonely");
  const f = run(root);
  assert.ok(f.some((x) => x.check === "mirror" && x.file.includes("lonely.mdc")));
  assert.deepEqual(run(root, { allow: { cursorOnlyRules: { lonely: "Cursor only, on purpose." } } }), []);
});

test("mirror: a Claude rule with no Cursor twin fails", () => {
  const root = goodRepo();
  put(root, ".claude/rules/orphan.md", "Orphan.\n");
  assert.ok(run(root).some((x) => x.check === "mirror" && x.file.includes("orphan.md")));
});

test("twin: different words fail; path-style differences do not", () => {
  const root = goodRepo();
  // path style only: bare name vs full path
  put(root, ".cursor/rules/demo.mdc", FM + "# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `other.mdc`.\n");
  put(root, ".claude/rules/demo.md", "# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `.claude/rules/other.md`.\n");
  put(root, ".cursor/rules/other.mdc", FM + "x (owner-set 2026-10-24)\n");
  put(root, ".claude/rules/other.md", "x (owner-set 2026-10-24)\n");
  put(root, "docs/rules/RULES-INDEX.md", "`demo` `other` `demo-skill`");
  put(root, "CLAUDE.md", "demo other");
  assert.deepEqual(run(root), []);
  put(root, ".claude/rules/demo.md", "# Demo\n\n**Owner law (2026-10-24):** Do a DIFFERENT thing.\n");
  const f = run(root);
  assert.deepEqual(kinds(f), ["twin"]);
  assert.match(f[0].message, /DIFFERENT/);
});

test("skills: missing link, wrong link, dead link and real folder fail", () => {
  const root = goodRepo();
  fs.rmSync(path.join(root, ".claude/skills/demo-skill"));
  assert.ok(run(root).some((x) => x.check === "skills" && /no \.claude\/skills entry/.test(x.message)));

  fs.symlinkSync("../../.cursor/skills/nope", path.join(root, ".claude/skills/demo-skill"));
  assert.ok(run(root).some((x) => x.check === "skills" && /not "\.\.\/\.\.\/\.cursor\/skills\/demo-skill"/.test(x.message)));
  fs.rmSync(path.join(root, ".claude/skills/demo-skill"));

  put(root, ".claude/skills/demo-skill/SKILL.md", "stub\n");
  const f = run(root);
  assert.ok(f.some((x) => x.check === "skills" && /real folder/.test(x.message)));
  assert.deepEqual(run(root, { allow: { realSkillFolders: { "demo-skill": "Stub on purpose." } } }), []);

  fs.rmSync(path.join(root, ".claude/skills/demo-skill"), { recursive: true });
  fs.symlinkSync("../../.cursor/skills/ghost", path.join(root, ".claude/skills/ghost"));
  assert.ok(run(root).some((x) => x.check === "skills" && /Dangling/.test(x.message)));
});

test("pointer: a named rule path that does not exist fails; placeholders and ~/ paths pass", () => {
  const root = goodRepo();
  put(root, "AGENTS.md", "See `.cursor/rules/ghost.mdc` and `.claude/skills/phantom/SKILL.md`.\n");
  const f = run(root).filter((x) => x.check === "pointer");
  assert.equal(f.length, 2);
  assert.equal(f[0].file, "AGENTS.md");
  assert.equal(f[0].line, 2 - 1);
  put(root, "AGENTS.md", "Pattern `.cursor/rules/<name>.mdc`, glob `.cursor/rules/*.mdc`, home `~/.cursor/skills/x`, real `.cursor/rules/demo.mdc`.\n");
  assert.deepEqual(run(root).filter((x) => x.check === "pointer"), []);
});

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

test("claudemd: an always-on owner law not named in CLAUDE.md fails; a glob rule is not required", () => {
  const root = goodRepo();
  put(root, "CLAUDE.md", "# Claude\nNothing here.\n");
  let f = run(root);
  assert.deepEqual(kinds(f), ["claudemd"]);
  assert.deepEqual(run(root, { allow: { claudeMdLineExempt: { demo: "Covered by AGENTS.md." } } }), []);
  put(root, ".cursor/rules/demo.mdc", "---\ndescription: x\nalwaysApply: false\n---\n# Demo\n\n**Owner law (2026-10-24):** Do the thing. See `.cursor/rules/demo.mdc`.\n");
  assert.deepEqual(run(root), []);
});

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

test("formatReport groups by check with counts", () => {
  const out = formatReport([
    { check: "mirror", file: "a", line: 1, message: "m", fix: "f" },
    { check: "mirror", file: "b", line: 2, message: "m", fix: "f" },
  ]);
  assert.match(out, /Mirror.*\(2\)/);
  assert.match(out, /a:1/);
  assert.match(formatReport([]), /OK/);
});
