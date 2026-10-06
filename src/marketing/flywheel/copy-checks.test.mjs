// The copy stage's checker, in code (unit X3: "the copy checker regex stays in
// code"). Ported from .claude/workflows/copy.js; the lists are rules-data.mjs's,
// which scripts/ads/check-script.test.mjs already holds equal to copy.js's.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { banScan, keepsSpecifics, specificTokens, ctaCollisions, pieceId, pieceText } from "./copy-checks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("banned words (with endings), phrases and openers are caught", () => {
  const kinds = (t) => banScan(t).map((h) => `${h.kind}:${h.hit}`);
  assert.deepEqual(kinds("We leveraged a robust plan."), ["word:leverage", "word:robust"]);
  assert.deepEqual(kinds("When it comes to funding, we do it."), ["phrase:when it comes to"]);
  assert.deepEqual(kinds("Picture this: a bank says yes."), ["opener:picture this"]);
  assert.deepEqual(kinds("You can optimize your credit."), [], "optimize came off the list on 2026-10-05");
});

test("the shapes copy.js catches: em dash, it's not X it's Y, stacked fragments, sycophancy, a closing question", () => {
  const hits = (t) => banScan(t).map((h) => h.hit);
  assert.ok(hits("The bank said no — then yes.").includes("em dash"));
  assert.ok(hits("It's not the score, it's the file.").includes("negative parallelism (it's not X, it's Y)"));
  assert.ok(hits("No call. No email. No answer. Then a yes from a lender that looked twice.").includes("stacked staccato fragments"));
  assert.ok(hits("Absolutely, here is your plan.").includes("sycophancy"));
  assert.ok(hits("Banks read two files. Most people fix one. Which one did you fix?").includes("ends on a rhetorical question"));
  assert.deepEqual(hits("A lender read your file twice and said yes the second time, because the business file was clean."), []);
});

test("copy.js still defines the same checks (the port cannot quietly lose one)", () => {
  const src = fs.readFileSync(path.join(ROOT, ".claude", "workflows", "copy.js"), "utf8");
  for (const piece of ["hits.push({ kind: 'shape', hit: 'em dash' })", "negative parallelism (it's not X, it's Y)",
    "stacked staccato fragments", "sycophancy", "ends on a rhetorical question", ">= 0.7"]) {
    assert.ok(src.includes(piece), `copy.js no longer has: ${piece}`);
  }
});

test("a rewrite must keep at least one of the offer's own figures", () => {
  const tokens = specificTokens("A $5,000 program, 30 days, 50% back if we miss.");
  assert.deepEqual(tokens, ["$5,000", "30 days", "50%"]);
  assert.equal(keepsSpecifics("We do it in 30 days.", tokens), true);
  assert.equal(keepsSpecifics("We do it fast.", tokens), false);
  assert.equal(keepsSpecifics("Anything.", []), true);
});

test("closing lines that collapse across different reasons are found; the same reason may close alike", () => {
  const pieces = [
    { pieceId: "A-SHORT", reasonId: "a", cta: "Book the review call and see your funding file today" },
    { pieceId: "B-SHORT", reasonId: "b", cta: "Grab the review call and see your funding file" },
    { pieceId: "A-LONG", reasonId: "a", cta: "Book the review call and see your funding file today" },
    { pieceId: "C-SHORT", reasonId: "c", cta: "Ask which lender reads the business side first" }
  ];
  assert.deepEqual(ctaCollisions(pieces).sort(), ["A-LONG", "A-SHORT", "B-SHORT"]);
  assert.equal(pieceId("show-me-the-line", "short"), "SHOW-ME-THE-LINE-SHORT");
  assert.equal(pieceText({ hook: "h", body: "", cta: "c" }), "h\n\nc");
});
