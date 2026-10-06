// The stamp a server-written stage file starts with must read back exactly the
// way `npm run flywheel:status` reads it. Unit X3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stampStage, nextVersion, hashOf, bodyOf, countsOf, parseFrontMatter, splitFrontMatter } from "./stamp.mjs";
import { evaluateFiles } from "../../../scripts/flywheel/status.mjs";
import { applyEdit } from "../../repo/edit-ops.mjs";

const CARD = "\n## Review card\n\n**What this decided:** x\n";

test("the stamp reads back: stage, version, status, inputs, whole-number counts only", () => {
  const t = stampStage({ stage: 4, version: 3, inputs: { "03-offer.md": "4596bcc6", "bad.md": "nothex!!", "x.md": null },
    counts: { hooks: 31, half: 1.5, word: "x", humanizerPassRun: 1 }, body: "# Copy\nAs of today\n" });
  const meta = parseFrontMatter(splitFrontMatter(t).frontMatter);
  assert.equal(meta.stage, 4);
  assert.equal(meta.version, 3);
  assert.equal(meta.status, "draft");
  assert.deepEqual(meta.inputs, { "03-offer.md": "4596bcc6" });
  assert.deepEqual(meta.counts, { hooks: 31, humanizerPassRun: 1 }, "a count that is not a whole number is left out, never invented");
  assert.equal(bodyOf(t), "# Copy\nAs of today");
  assert.deepEqual(countsOf(t), { hooks: 31, humanizerPassRun: 1 });
});

test("a hash made only of digits still matches (it is text, not a number)", () => {
  // Found while building X3: "38112300" was read as the number 38112300 and the
  // stage looked out of date for no reason.
  const avatar = stampStage({ stage: 1, version: 2, status: "approved", counts: { quotes: 30, languageEntries: 120 }, body: `# Avatar\n${CARD}` });
  assert.match(hashOf(avatar), /^\d{8}$/, "this fixture's hash is all digits");
  const research = stampStage({ stage: 2, version: 1, inputs: { "01-avatar.md": hashOf(avatar) },
    counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: `# R\n${CARD}` });
  const files = { "01-avatar.md": avatar, "02-ad-research.md": research };
  const rows = evaluateFiles((f) => files[f] ?? null);
  assert.equal(rows[0].state, "READY");
  assert.equal(rows[1].state, "READY", rows[1].reasons.join("; "));
});

test("Approve changes the stamp only: the body hash, and every later stage built on it, stay the same", () => {
  const offer = stampStage({ stage: 3, version: 1, counts: { priceSet: 1 }, body: `# Offer\nstatus: draft in the body\n${CARD}` });
  const approved = applyEdit(offer, { op: "set_front_matter_key", key: "status", value: "approved" });
  assert.equal(hashOf(approved), hashOf(offer));
  assert.equal(parseFrontMatter(splitFrontMatter(approved).frontMatter).status, "approved");
  assert.match(approved, /status: draft in the body/);
});

test("versions count up from the file on hand; a missing file is version 1", () => {
  assert.equal(nextVersion(null), 1);
  assert.equal(nextVersion("# no stamp"), 1);
  assert.equal(nextVersion(stampStage({ stage: 4, version: 7, body: "x" })), 8);
  assert.equal(hashOf(null), null);
  assert.equal(bodyOf(null), "");
});
