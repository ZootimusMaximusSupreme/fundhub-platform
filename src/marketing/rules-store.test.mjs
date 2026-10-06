// src/marketing/rules-store.mjs without a database or a network: reading Part 0
// and the banned list from GitHub at one commit or from the bundled copy, the
// "recent" view of outbox rows, and checking a rule change. Plan unit U26.
//
// GitHub is a fake passed in through deps; the real RULES.md and banned-live.json
// on disk are the bundled copy (the same files netlify.toml ships).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRuleFiles, readBundled, parsePart0, parseBanned, recentView, part0NumbersAfter,
  validateRuleInput, ruleEdit, rulePath, RULE_ACTIONS, RulesUnavailableError,
  MAX_RULE_CHARS, MAX_PHRASE_CHARS
} from "./rules-store.mjs";
import { RULES_PATH, BANNED_PATH, applyEdit, readPart0 } from "../repo/edit-ops.mjs";
import { InvalidError } from "./http.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES_ON_DISK = fs.readFileSync(path.join(ROOT, RULES_PATH), "utf8");
const TOKEN_ENV = Object.freeze({ GITHUB_REPO_TOKEN: "test-token-not-real" });
const SHA = "9c1d4e2f6a8b0c3d5e7f9a1b2c4d6e8f0a1b3c5d";

const FAKE_RULES = [
  "# Copy rules", "", "# PART 0 — CHRIS'S RULES", "",
  "0. Chris's word wins.", "1. Never write credit repair.", "",
  "# PART 1 — THE HARD NO'S", "1. Not part 0.", ""
].join("\n");

/** A fake GitHub that records what it was asked. */
function fakeGithub({ refSha = SHA, files = {}, refOk = true } = {}) {
  const calls = [];
  return {
    calls,
    getRef: async () => { calls.push(["ref"]); return refOk ? { ok: true, sha: refSha } : { ok: false, sha: null, error: "401 Bad credentials" }; },
    getContents: async (p, { ref } = {}) => {
      calls.push(["contents", p, ref]);
      if (!(p in files)) return { ok: true, missing: true, content: null };
      return { ok: true, missing: false, content: files[p] };
    }
  };
}

describe("readRuleFiles", () => {
  test("with a token: both files from GitHub at the ONE commit main is on", async () => {
    const gh = fakeGithub({ files: { [RULES_PATH]: FAKE_RULES, [BANNED_PATH]: '["game changer"]\n' } });
    const out = await readRuleFiles({ env: TOKEN_ENV, deps: { ...gh, readBundled: () => { throw new Error("bundle read"); } } });
    assert.equal(out.source, "github");
    assert.equal(out.rules_sha, SHA);
    assert.equal(out.rules, FAKE_RULES);
    assert.equal(out.banned, '["game changer"]\n');
    assert.equal(out.github_error, null);
    assert.deepEqual(gh.calls.filter((c) => c[0] === "contents").map((c) => c[2]), [SHA, SHA], "both files read at the pinned sha");
  });

  test("banned-live.json missing on GitHub reads as no file (null), not an error", async () => {
    const gh = fakeGithub({ files: { [RULES_PATH]: FAKE_RULES } });
    const out = await readRuleFiles({ env: TOKEN_ENV, deps: gh });
    assert.equal(out.source, "github");
    assert.equal(out.banned, null);
    assert.deepEqual(parseBanned(out.banned), []);
  });

  test("GitHub refuses: the bundled copy, with the reason kept and the deploy's commit as rules_sha", async () => {
    const gh = fakeGithub({ refOk: false });
    const out = await readRuleFiles({
      env: { ...TOKEN_ENV, COMMIT_REF: "abcdef1234567" },
      deps: { ...gh, readBundled: (rel) => (rel === RULES_PATH ? FAKE_RULES : "[]") }
    });
    assert.equal(out.source, "bundle");
    assert.equal(out.rules_sha, "abcdef1234567");
    assert.equal(out.rules, FAKE_RULES);
    assert.match(out.github_error, /401/);
  });

  test("no token: GitHub is never asked; rules_sha is null without a real COMMIT_REF", async () => {
    const gh = fakeGithub();
    const out = await readRuleFiles({ env: { COMMIT_REF: "not a sha" }, deps: { ...gh, readBundled: () => FAKE_RULES } });
    assert.equal(gh.calls.length, 0);
    assert.equal(out.source, "bundle");
    assert.equal(out.rules_sha, null);
    assert.match(out.github_error, /GITHUB_REPO_TOKEN/);
  });

  test("a masked token counts as no token", async () => {
    const gh = fakeGithub();
    const out = await readRuleFiles({ env: { GITHUB_REPO_TOKEN: "****************abcd" }, deps: { ...gh, readBundled: () => FAKE_RULES } });
    assert.equal(gh.calls.length, 0);
    assert.equal(out.source, "bundle");
  });

  test("GitHub that never answers: the bundle after the deadline", async () => {
    const out = await readRuleFiles({
      env: TOKEN_ENV,
      deadlineMs: 30,
      deps: { getRef: () => new Promise(() => {}), getContents: async () => ({ ok: true }), readBundled: () => FAKE_RULES }
    });
    assert.equal(out.source, "bundle");
    assert.match(out.github_error, /did not answer/);
  });

  test("RULES.md not on main: the bundle, saying so", async () => {
    const gh = fakeGithub({ files: {} });
    const out = await readRuleFiles({ env: TOKEN_ENV, deps: { ...gh, readBundled: () => FAKE_RULES } });
    assert.equal(out.source, "bundle");
    assert.match(out.github_error, /is not on main/);
  });

  test("neither GitHub nor the bundle: RulesUnavailableError in plain words", async () => {
    await assert.rejects(
      readRuleFiles({ env: {}, deps: { readBundled: () => null } }),
      (err) => err instanceof RulesUnavailableError && /could not be read/.test(err.message)
    );
  });

  test("the real bundled copy: the repo's RULES.md and banned-live.json", async () => {
    assert.equal(readBundled(RULES_PATH), RULES_ON_DISK);
    const out = await readRuleFiles({ env: {} });
    assert.equal(out.source, "bundle");
    assert.equal(out.rules, RULES_ON_DISK);
    assert.ok(Array.isArray(parseBanned(out.banned)));
  });
});

describe("parsePart0 and parseBanned", () => {
  test("Part 0 of the real RULES.md: rules 0 to 44, in order, Part 1 left out", () => {
    const part0 = parsePart0(RULES_ON_DISK);
    assert.deepEqual(part0.map((r) => r.n), Array.from({ length: 45 }, (_, i) => i));
    assert.match(part0[1].text, /credit repair/);
    for (const r of part0) assert.deepEqual(Object.keys(r), ["n", "text"]);
  });

  test("Part 0 of a small file stops at the next PART heading", () => {
    assert.deepEqual(parsePart0(FAKE_RULES), [
      { n: 0, text: "Chris's word wins." },
      { n: 1, text: "Never write credit repair." }
    ]);
  });

  test("no Part 0 heading: RulesUnavailableError", () => {
    assert.throws(() => parsePart0("# Some file\n1. a rule\n"), RulesUnavailableError);
  });

  test("banned: missing = [], a list of text passes, anything else is refused", () => {
    assert.deepEqual(parseBanned(null), []);
    assert.deepEqual(parseBanned('["game changer", "unlock"]'), ["game changer", "unlock"]);
    assert.throws(() => parseBanned("{not json"), RulesUnavailableError);
    assert.throws(() => parseBanned('[1, 2]'), RulesUnavailableError);
    assert.throws(() => parseBanned('{"a": 1}'), RulesUnavailableError);
  });
});

describe("recent rule changes", () => {
  const at = new Date("2026-10-12T15:12:00.000Z");
  test("each op maps to its action and text; state follows the outbox row", () => {
    assert.deepEqual(
      recentView({ op_id: "o1", edit: { op: "ban_phrase", phrase: "game changer" }, committed_sha: null, error: null, created_at: at }),
      { op_id: "o1", action: "ban", text: "game changer", n: null, state: "waiting", committed_sha: null, at: at.toISOString() }
    );
    const added = recentView({ op_id: "o2", edit: { op: "part0_add_rule", text: "Say it plainly." }, committed_sha: SHA, error: null, created_at: at });
    assert.equal(added.action, "add");
    assert.equal(added.state, "committed");
    assert.equal(added.committed_sha, SHA);
    const edited = recentView({ op_id: "o3", edit: { op: "part0_edit_rule", number: 7, text: "New words." }, committed_sha: null, error: "Part 0 has no rule 7", created_at: at.toISOString() });
    assert.equal(edited.action, "edit");
    assert.equal(edited.n, 7);
    assert.equal(edited.state, "failed");
  });

  test("the numbers Part 0 will have: a waiting add counts, an edit that cannot apply is skipped", () => {
    const nums = part0NumbersAfter(FAKE_RULES, [
      { op: "part0_add_rule", text: "Rule two." },
      { op: "part0_edit_rule", number: 9, text: "No rule 9: skipped like the outbox skips it." }
    ]);
    assert.deepEqual([...nums].sort(), [0, 1, 2]);
    assert.deepEqual([...part0NumbersAfter(FAKE_RULES)].sort(), [0, 1]);
  });
});

describe("checking a rule change", () => {
  const bad = (body, field) => assert.throws(() => validateRuleInput(body), (e) => e instanceof InvalidError && e.field === field);

  test("action, text and n are checked with the field named", () => {
    bad({ action: "delete", text: "x" }, "action");
    bad({ text: "x" }, "action");
    bad({ action: "add" }, "text");
    bad({ action: "add", text: "   \n " }, "text");
    bad({ action: "ban", text: 5 }, "text");
    bad({ action: "edit", text: "x" }, "n");
    bad({ action: "edit", text: "x", n: -1 }, "n");
    bad({ action: "edit", text: "x", n: 1.5 }, "n");
    bad({ action: "edit", text: "x", n: "3" }, "n");
    bad({ action: "add", text: "a".repeat(MAX_RULE_CHARS + 1) }, "text");
    bad({ action: "ban", text: "a".repeat(MAX_PHRASE_CHARS + 1) }, "text");
  });

  test("good changes come back as one line, n only for edit", () => {
    assert.deepEqual(validateRuleInput({ action: "add", text: "  Say it\nplainly.  " }), { action: "add", n: null, text: "Say it plainly." });
    assert.deepEqual(validateRuleInput({ action: "edit", n: 0, text: "Rule zero." }), { action: "edit", n: 0, text: "Rule zero." });
    assert.deepEqual(validateRuleInput({ action: "ban", text: "game changer", n: 4 }), { action: "ban", n: null, text: "game changer" });
  });

  test("each action becomes the outbox op the outbox can apply to the real files", () => {
    assert.deepEqual(RULE_ACTIONS, { add: "part0_add_rule", edit: "part0_edit_rule", ban: "ban_phrase" });
    assert.equal(rulePath("add"), RULES_PATH);
    assert.equal(rulePath("edit"), RULES_PATH);
    assert.equal(rulePath("ban"), BANNED_PATH);

    const add = ruleEdit("add", { text: "Say review your file the way a lender does." });
    assert.deepEqual(add, { op: "part0_add_rule", text: "Say review your file the way a lender does." });
    const afterAdd = readPart0(applyEdit(RULES_ON_DISK, add));
    assert.deepEqual(afterAdd[afterAdd.length - 1], { n: 45, text: "Say review your file the way a lender does." });

    const edit = ruleEdit("edit", { n: 3, text: "New words for rule three." });
    assert.deepEqual(edit, { op: "part0_edit_rule", number: 3, text: "New words for rule three." });
    assert.equal(readPart0(applyEdit(RULES_ON_DISK, edit)).find((r) => r.n === 3).text, "New words for rule three.");

    const ban = ruleEdit("ban", { text: "game changer" });
    assert.deepEqual(ban, { op: "ban_phrase", phrase: "game changer" });
    assert.deepEqual(JSON.parse(applyEdit("[]\n", ban)), ["game changer"]);
  });
});
