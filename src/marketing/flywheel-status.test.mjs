// Flywheel status as data — it must say exactly what `npm run flywheel:status`
// says. No database, no network. Fixture folders are written to the system temp
// directory and removed after.

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { campaignStatus, flywheelStatus, findFlywheelDir } from "./flywheel-status.mjs";
import { bodyHash } from "../../scripts/flywheel/status.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");

/* A hash that is all digits is read back by parseFrontMatter() as a NUMBER and
   then never equals the string bodyHash() returns, so that stage reads STALE.
   That is a quirk of scripts/flywheel/status.mjs, not of this wrapper; the
   fixture simply avoids it and says so loudly if a body edit ever lands on one. */
function hashOf(text) {
  const h = bodyHash(text);
  assert.ok(!/^\d+$/.test(h), `fixture body hashes to all digits (${h}); change its words`);
  return h;
}

/* stage — one stage file. counts and inputs go in the fixed front matter shape
   scripts/flywheel/status.mjs parses. */
function stage({ n, status = "draft", inputs = {}, counts = {}, body }) {
  const fm = [
    "---",
    `stage: ${n}`,
    "version: 1",
    `status: ${status}`,
    "inputs:",
    ...Object.entries(inputs).map(([k, v]) => `  ${k}: ${v}`),
    "counts:",
    ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
    "---",
    ""
  ].join("\n");
  return fm + body;
}

describe("flywheel status — fixture folder", () => {
  let root;
  let dir;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-flywheel-"));
    dir = path.join(root, "marketing", "flywheel", "fixture");
    fs.mkdirSync(path.join(dir, "01-avatar"), { recursive: true });

    // 1 avatar: READY and approved.
    const avatar = stage({ n: 1, status: "approved", counts: { quotes: 25, languageEntries: 120 },
      body: "# Avatar\n\n## Review card\nall good\n" });
    fs.writeFileSync(path.join(dir, "01-avatar.md"), avatar);
    fs.writeFileSync(path.join(dir, "01-avatar", "Market_Language_Bank.md"), "words\n");

    // 2 ad research: READY, not reviewed.
    const research = stage({ n: 2, inputs: { "01-avatar.md": hashOf(avatar) },
      counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 9 },
      body: "# Research\n\n## Review card\nok\n" });
    fs.writeFileSync(path.join(dir, "02-ad-research.md"), research);

    // 3 offer: built on an OLD avatar hash -> STALE.
    fs.writeFileSync(path.join(dir, "03-offer.md"), stage({ n: 3,
      inputs: { "01-avatar.md": "00000000", "02-ad-research.md": hashOf(research) },
      counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
      body: "# Offer\n\n## Review card\nok\n" }));

    // 4 copy: hashes match but a gate is unreported -> FAILED. The stale offer
    // above it does not hide that: evaluate() only turns READY rows BLOCKED.
    const offerText = fs.readFileSync(path.join(dir, "03-offer.md"), "utf8");
    fs.writeFileSync(path.join(dir, "04-copy.md"), stage({ n: 4,
      inputs: { "03-offer.md": hashOf(offerText), "01-avatar/Market_Language_Bank.md": hashOf("words\n") },
      counts: { hooks: 6, humanizerPassRun: 1 },
      body: "# Copy\n\n## Review card\nok\n" }));

    // 5 ad strategy: own file is fine, inputs are not READY -> BLOCKED.
    const copyText = fs.readFileSync(path.join(dir, "04-copy.md"), "utf8");
    fs.writeFileSync(path.join(dir, "05-ad-strategy.md"), stage({ n: 5,
      inputs: { "03-offer.md": hashOf(offerText), "04-copy.md": hashOf(copyText) },
      counts: { strategyNamed: 1, dailyBudgetStated: 1 },
      body: "# Strategy\n\n## Review card\nok\n" }));

    // 6 spend: no file -> MISSING.
  });

  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test("each state comes through exactly as evaluate() decided it", () => {
    const out = campaignStatus(dir, "fixture");
    const byN = Object.fromEntries(out.stages.map((s) => [s.n, s]));
    assert.equal(byN[1].state, "READY");
    assert.equal(byN[1].approved, true);
    assert.equal(byN[1].status, "ready approved");
    assert.equal(byN[1].why, "25 quotes");
    assert.equal(byN[2].state, "READY");
    assert.equal(byN[2].approved, false);
    assert.equal(byN[2].status, "ready not reviewed");
    assert.equal(byN[3].state, "STALE");
    assert.deepEqual(byN[3].reasons, ["built on the old avatar"]);
    assert.equal(byN[4].state, "FAILED");
    assert.equal(byN[4].why, "did not report distinctReasons");
    assert.equal(byN[5].state, "BLOCKED");
    assert.equal(byN[5].why, "waiting on offer and copy");
    assert.equal(byN[6].state, "MISSING");
    assert.equal(byN[6].why, "has not been run yet");
    assert.equal(out.advice, "2 stages need re-running. Do them in order: 3, then 4.");
  });

  test("flywheelStatus lists every campaign folder under marketing/flywheel", () => {
    const out = flywheelStatus({ roots: [root] });
    assert.deepEqual(out.campaigns.map((c) => c.campaign), ["fixture"]);
  });

  test("no flywheel folder anywhere → null, never an invented row", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "fh-flywheel-none-"));
    try {
      assert.equal(findFlywheelDir([empty]), null);
      assert.equal(flywheelStatus({ roots: [empty] }), null);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("flywheel status — the real repo, word for word with the command", () => {
  test("every stage line equals the line `npm run flywheel:status` prints", () => {
    const printed = execFileSync(process.execPath,
      [path.join(REPO, "scripts", "flywheel", "status.mjs"), "partner"],
      { cwd: REPO, encoding: "utf8" });
    const lines = printed.split("\n").map((l) => l.trim()).filter(Boolean);
    const out = flywheelStatus({ roots: [REPO] });
    const partner = out.campaigns.find((c) => c.campaign === "partner");
    assert.ok(partner, "the partner flywheel is in the repo");
    for (const s of partner.stages) {
      assert.ok(lines.includes(s.line), `stage ${s.n} line not printed by the command: ${s.line}`);
    }
    if (partner.advice) assert.ok(lines.includes(partner.advice), partner.advice);
  });
});
