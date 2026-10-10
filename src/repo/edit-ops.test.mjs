// The shared-file edit ops: pure (content, edit) -> content.
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 (edit mode) and the
// U05 brief (op list, Part 0 section, fixed VOICE block shared with U12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "../ads/registry.mjs";
import {
  applyEdit, validateEdit, validateRepoFile, readPart0, voicePairBlock,
  EDIT_OPS, EDIT_OP_FILES, EDIT_OP_PATTERNS, EditOpError, PART0_HEADING, SEED_PAIRS_HEADING, VOICE_TEMPLATE
} from "./edit-ops.mjs";
import { bodyHash } from "../../scripts/flywheel/status.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = fs.readFileSync(path.join(ROOT, "marketing", "ads", "registry.json"), "utf8");

/* Ad numbers no real ad uses. The registry_add_ad tests add an ad to the LIVE
   registry file, so a number typed in by hand breaks the day a real ad takes
   it. 91 did on 2026-10-08 (ae3c014cd added ad 91, "The Conveyor Belt"), and
   92 and 93 were next in line. These three are always one past the highest ad
   in the file. */
const NEW_ID = String(Math.max(...JSON.parse(REGISTRY).ads.map((a) => Number(a.id))) + 1);
const NEW_ID_2 = String(Number(NEW_ID) + 1);
const NEW_ID_3 = String(Number(NEW_ID) + 2);

const RULES = [
  "# RULES.md — the ad SOP",
  "",
  "Intro text.",
  "",
  PART0_HEADING,
  "",
  "Part 0 wins over Parts 1-4.",
  "",
  "0. Chris's word beats every rule below.",
  "",
  "**Words**",
  "1. Never write \"credit repair.\"",
  "2. Never say \"your number\".",
  "",
  "**Format**",
  "",
  "43. Green screen and Notes ads are bullet cues.",
  "44. Long ads keep every point Chris gave.",
  "",
  "*Note for the writer: rules 39 and 42 describe the words style.*",
  "",
  "---",
  "",
  "# PART 1 — THE HARD NO'S",
  "",
  "1. A Part 1 rule that must never be renumbered or edited by Part 0 ops.",
  ""
].join("\n");

/* The exact block template from the U05 brief (U12 writes VOICE.md this way). */
const REAL_PAIR_10 = [
  "## Pair 10 — hook",
  "- **Lane:** funding600",
  "- **Model wrote:** Getting denied is frustrating.",
  "- **Chris wrote:** \"If your business got denied, nobody looked at your file the way a bank does.\"",
  "- **Why:** not given",
  "- **Source:** chat 2026-09-30"
];
const SEED_PAIR_9 = [
  "## Pair 9 — hook",
  "- **Lane:** funding600",
  "- **Model wrote:** A seed line.",
  "- **Chris wrote:** \"A real line.\"",
  "- **Why:** seed.",
  "- **Source:** CONTROLS.md, Ad 1"
];
const VOICE = [
  "# VOICE.md — how Chris actually writes, learned over time",
  "",
  "# Real pairs",
  "",
  ...REAL_PAIR_10,
  "",
  "---",
  "",
  SEED_PAIRS_HEADING,
  "",
  ...SEED_PAIR_9,
  ""
].join("\n");

const PAIR = {
  kind: "body",
  lane: "uwiq",
  before: "Many consultants take a\none-size-fits-all approach.",
  after: "They pulled a list of lenders they use for every client.",
  why: "It is a scene you can picture.",
  date: "2026-10-05",
  script_id: "3f2a9c1e-0000-4000-8000-000000000000"
};

const throwsEdit = (fn, re) => assert.throws(fn, (err) => err instanceof EditOpError && (!re || re.test(err.message)));

describe("part0_add_rule / part0_edit_rule", () => {
  test("adds the next number after the last Part 0 rule, inside Part 0", () => {
    const out = applyEdit(RULES, { op: "part0_add_rule", text: "Never   say\n\"dude\"." });
    const lines = out.split("\n");
    const i = lines.indexOf("45. Never say \"dude\".");
    assert.ok(i > 0, out);
    assert.equal(lines[i - 1], "44. Long ads keep every point Chris gave.");
    assert.ok(i < lines.indexOf("# PART 1 — THE HARD NO'S"));
    // Part 1's own "1." is untouched and not counted.
    assert.ok(out.includes("1. A Part 1 rule that must never be renumbered"));
    assert.deepEqual(readPart0(out).map((r) => r.n), [0, 1, 2, 43, 44, 45]);
  });

  test("the heading may use a curly apostrophe", () => {
    const curly = RULES.replace(PART0_HEADING, "# PART 0 — CHRIS’S RULES");
    assert.ok(applyEdit(curly, { op: "part0_add_rule", text: "x" }).includes("45. x"));
  });

  test("edits one rule's words and nothing else", () => {
    const out = applyEdit(RULES, { op: "part0_edit_rule", number: 2, text: "Spell out how much they qualify for." });
    assert.ok(out.includes("2. Spell out how much they qualify for."));
    assert.ok(!out.includes("2. Never say \"your number\"."));
    assert.equal(out.split("\n").length, RULES.split("\n").length);
    assert.ok(out.includes("1. A Part 1 rule that must never be renumbered"));
  });

  test("an edit replaces an item's indented continuation lines too", () => {
    const wrapped = RULES.replace("1. Never write \"credit repair.\"", "1. Never write \"credit repair.\"\n   Say credit optimization.");
    const out = applyEdit(wrapped, { op: "part0_edit_rule", number: 1, text: "One line now." });
    assert.ok(out.includes("1. One line now.\n2. Never say"));
    assert.ok(!out.includes("Say credit optimization."));
  });

  test("refuses a rule that is not there, a missing heading and empty text", () => {
    throwsEdit(() => applyEdit(RULES, { op: "part0_edit_rule", number: 7, text: "x" }), /no rule 7/);
    throwsEdit(() => applyEdit("# RULES\n\n1. x\n", { op: "part0_add_rule", text: "x" }), /PART 0/);
    throwsEdit(() => applyEdit(RULES, { op: "part0_add_rule", text: "   " }), /empty/);
    throwsEdit(() => applyEdit(null, { op: "part0_add_rule", text: "x" }), /missing/);
    throwsEdit(() => applyEdit(RULES, { op: "part0_edit_rule", number: "two", text: "x" }), /whole number/);
  });
});

describe("ban_phrase", () => {
  test("appends plain text and keeps the file a list of strings", () => {
    const out = applyEdit("[]\n", { op: "ban_phrase", phrase: "  game changer " });
    assert.deepEqual(JSON.parse(out), ["game changer"]);
    assert.ok(out.endsWith("\n"));
  });

  test("no duplicates (case and spacing do not make a new phrase)", () => {
    const once = applyEdit("[]\n", { op: "ban_phrase", phrase: "Game Changer" });
    assert.equal(applyEdit(once, { op: "ban_phrase", phrase: "game   changer" }), once);
  });

  test("a missing file starts the list; bad JSON or a non-list is refused", () => {
    assert.deepEqual(JSON.parse(applyEdit(null, { op: "ban_phrase", phrase: "x" })), ["x"]);
    throwsEdit(() => applyEdit("[\"a\",", { op: "ban_phrase", phrase: "x" }), /not valid JSON/);
    throwsEdit(() => applyEdit("{\"a\":1}", { op: "ban_phrase", phrase: "x" }), /list of plain text/);
    throwsEdit(() => applyEdit("[1]", { op: "ban_phrase", phrase: "x" }), /list of plain text/);
  });
});

describe("registry_add_ad", () => {
  test("adds the ad with gate, entry and offers from rules[lane], and it still loads", () => {
    const out = applyEdit(REGISTRY, { op: "registry_add_ad", id: Number(NEW_ID), title: "denial angle", lane: "uwiq" });
    const doc = JSON.parse(out);
    const ad = doc.ads.find((a) => a.id === NEW_ID);
    assert.deepEqual(ad, {
      id: NEW_ID, title: "denial angle", lane: "uwiq", gate: "none", entry: "sorting",
      primary_offer: "capital_blueprint", secondary_offers: "all", variants: []
    });
    assert.equal(parseRegistry(doc).byId.get(NEW_ID).lane, "uwiq");
    // The rest of the file is unchanged.
    assert.equal(doc.ads.length, JSON.parse(REGISTRY).ads.length + 1);
    assert.deepEqual(doc.rules, JSON.parse(REGISTRY).rules);
    // Same indent as the file it came from.
    assert.ok(out.startsWith("{\n  \"version\""));
  });

  test("a direct lane copies its offer list", () => {
    const doc = JSON.parse(applyEdit(REGISTRY, { op: "registry_add_ad", id: NEW_ID_2, title: null, lane: "funding600" }));
    const ad = doc.ads.find((a) => a.id === NEW_ID_2);
    assert.equal(ad.gate, "600");
    assert.deepEqual(ad.secondary_offers, []);
    assert.equal(ad.title, null);
  });

  test("refuses a lane with no rule (slo has none by design)", () => {
    throwsEdit(() => applyEdit(REGISTRY, { op: "registry_add_ad", id: NEW_ID_3, title: "x", lane: "slo" }), /no rule/);
    throwsEdit(() => applyEdit(REGISTRY, { op: "registry_add_ad", id: NEW_ID_3, title: "x", lane: "" }), /no rule/);
  });

  test("the same ad twice is a no-op; a different ad under a used number is refused", () => {
    const once = applyEdit(REGISTRY, { op: "registry_add_ad", id: NEW_ID, title: "a", lane: "uwiq" });
    assert.equal(applyEdit(once, { op: "registry_add_ad", id: NEW_ID, title: "a", lane: "uwiq" }), once);
    throwsEdit(() => applyEdit(once, { op: "registry_add_ad", id: NEW_ID, title: "b", lane: "uwiq" }), /already/);
  });

  test("refuses invalid JSON and a registry that fails parseRegistry", () => {
    throwsEdit(() => applyEdit("{\"ads\": [", { op: "registry_add_ad", id: NEW_ID, lane: "uwiq" }), /not valid JSON/);
    const broken = JSON.parse(REGISTRY);
    broken.ads[0].gate = "999";
    throwsEdit(() => applyEdit(JSON.stringify(broken), { op: "registry_add_ad", id: NEW_ID, title: "x", lane: "uwiq" }), /would not load/);
    throwsEdit(() => applyEdit(REGISTRY, { op: "registry_add_ad", id: "9a", lane: "uwiq" }), /digits/);
  });
});

describe("angles_add", () => {
  const ANGLES = "[\n  {\n    \"key\": \"denial\",\n    \"name\": \"Denial\",\n    \"notes\": \"n\",\n    \"source\": \"ASSET-BANK §2\"\n  }\n]\n";

  test("adds {key, name, notes}", () => {
    const out = applyEdit(ANGLES, { op: "angles_add", key: "broker-burn", name: "Broker Burn", notes: "the\nblast" });
    assert.deepEqual(JSON.parse(out)[1], { key: "broker-burn", name: "Broker Burn", notes: "the blast" });
  });

  test("a missing file starts the list; a used key is a no-op or a refusal", () => {
    assert.equal(JSON.parse(applyEdit(null, { op: "angles_add", key: "a", name: "A" })).length, 1);
    assert.equal(applyEdit(ANGLES, { op: "angles_add", key: "denial", name: "Denial" }), ANGLES);
    throwsEdit(() => applyEdit(ANGLES, { op: "angles_add", key: "denial", name: "Other" }), /already/);
    throwsEdit(() => applyEdit(ANGLES, { op: "angles_add", key: "Not A Slug", name: "x" }), /slug/);
    throwsEdit(() => applyEdit("nope", { op: "angles_add", key: "a", name: "A" }), /not valid JSON/);
  });
});

describe("voice_append_pairs", () => {
  test("the fixed template: one block per pair, numbered after the highest pair", () => {
    assert.deepEqual(VOICE_TEMPLATE, [
      "## Pair <N> — <kind>",
      "- **Lane:** <lane or unknown>",
      "- **Model wrote:** <before>",
      "- **Chris wrote:** \"<after>\"",
      "- **Why:** <Chris's own stated reason, else not given>",
      "- **Source:** app edit <YYYY-MM-DD>, script <id8>"
    ]);
    assert.deepEqual(voicePairBlock(11, PAIR), [
      "## Pair 11 — body",
      "- **Lane:** uwiq",
      "- **Model wrote:** Many consultants take a one-size-fits-all approach.",
      "- **Chris wrote:** \"They pulled a list of lenders they use for every client.\"",
      "- **Why:** It is a scene you can picture.",
      "- **Source:** app edit 2026-10-05, script 3f2a9c1e"
    ]);
  });

  test("inserts at the end of # Real pairs, before the '# Seed pairs' heading", () => {
    const out = applyEdit(VOICE, { op: "voice_append_pairs", pairs: [PAIR, { ...PAIR, kind: "cta", lane: null, why: "" }] });
    const lines = out.split("\n");
    const seed = lines.indexOf(SEED_PAIRS_HEADING);
    const p11 = lines.indexOf("## Pair 11 — body");
    const p12 = lines.indexOf("## Pair 12 — cta");
    const p10 = lines.indexOf("## Pair 10 — hook");
    assert.ok(p10 < p11 && p11 < p12 && p12 < seed, out);
    assert.ok(p12 < lines.indexOf("---"), "the new pairs stay above the rule that ends Real pairs");
    assert.equal(lines[p12 + 1], "- **Lane:** unknown");
    assert.equal(lines[p12 + 4], "- **Why:** not given");
    // The seed pair is untouched and not renumbered.
    assert.ok(out.includes(SEED_PAIR_9.join("\n")));
    // A blank line between blocks.
    assert.equal(lines[p11 - 1], "");
    assert.equal(lines[p12 - 1], "");
  });

  test("numbers after the highest pair anywhere in the file", () => {
    const high = VOICE.replace("## Pair 9 — hook", "## Pair 30 — hook");
    assert.ok(applyEdit(high, { op: "voice_append_pairs", pairs: [PAIR] }).includes("## Pair 31 — body"));
  });

  test("appends at the end when the '# Seed pairs' heading is missing", () => {
    const noSeed = ["# VOICE.md", "", "# Real pairs", "", ...REAL_PAIR_10, ""].join("\n");
    const out = applyEdit(noSeed, { op: "voice_append_pairs", pairs: [PAIR] });
    assert.ok(out.endsWith("- **Source:** app edit 2026-10-05, script 3f2a9c1e\n"), out);
    assert.ok(out.includes("Source:** chat 2026-09-30\n\n## Pair 11 — body"));
  });

  test("created_at becomes an Arizona day", () => {
    const { date, ...rest } = PAIR;
    void date;
    // 2026-10-06 03:00 UTC is still 2026-10-05 in Arizona (UTC-7).
    const block = voicePairBlock(1, { ...rest, created_at: "2026-10-06T03:00:00Z" });
    assert.equal(block[5], "- **Source:** app edit 2026-10-05, script 3f2a9c1e");
  });

  test("refuses no pairs, a missing file and a pair without Chris's line", () => {
    throwsEdit(() => applyEdit(VOICE, { op: "voice_append_pairs", pairs: [] }), /no voice pairs/);
    throwsEdit(() => applyEdit(null, { op: "voice_append_pairs", pairs: [PAIR] }), /missing/);
    throwsEdit(() => applyEdit(VOICE, { op: "voice_append_pairs", pairs: [{ ...PAIR, after: " " }] }), /Chris's line/);
    throwsEdit(() => applyEdit(VOICE, { op: "voice_append_pairs", pairs: [{ ...PAIR, date: "yesterday" }] }), /date/);
  });
});

describe("dispatch and checks", () => {
  test("every op is covered and aimed at one file", () => {
    assert.deepEqual([...EDIT_OPS].sort(), [
      "angles_add", "append_line_under_heading", "ban_phrase", "part0_add_rule", "part0_edit_rule",
      "registry_add_ad", "set_front_matter_key", "voice_append_pairs"
    ]);
    assert.equal(EDIT_OP_FILES.part0_add_rule, "marketing/ads/RULES.md");
    assert.equal(EDIT_OP_FILES.voice_append_pairs, "marketing/ads/VOICE.md");
  });

  test("refuses unknown ops", () => {
    throwsEdit(() => applyEdit(RULES, { op: "delete_file" }), /unknown edit op/);
    throwsEdit(() => applyEdit(RULES, {}), /unknown edit op/);
    throwsEdit(() => applyEdit(RULES, { op: "toString" }), /unknown edit op/);
    throwsEdit(() => validateEdit({ op: "rm" }, "marketing/ads/RULES.md"), /unknown edit op/);
  });

  test("validateEdit ties each op to its file and checks its fields", () => {
    assert.deepEqual(validateEdit({ op: "ban_phrase", phrase: "x" }, "marketing/ads/banned-live.json"), { op: "ban_phrase", phrase: "x" });
    throwsEdit(() => validateEdit({ op: "ban_phrase", phrase: "x" }, "marketing/ads/RULES.md"), /edits marketing\/ads\/banned-live.json/);
    throwsEdit(() => validateEdit({ op: "part0_add_rule" }, "marketing/ads/RULES.md"), /rule text/);
    throwsEdit(() => validateEdit({ op: "registry_add_ad", id: "x", lane: "uwiq" }, "marketing/ads/registry.json"), /digits/);
    throwsEdit(() => validateEdit({ op: "voice_append_pairs", pairs: [{}] }, "marketing/ads/VOICE.md"), /kind/);
    throwsEdit(() => validateEdit("ban", "marketing/ads/banned-live.json"), /object/);
  });

  test("validateRepoFile: JSON must parse, registry must load, lists must be lists", () => {
    validateRepoFile("marketing/ads/registry.json", REGISTRY);
    validateRepoFile("marketing/ads/RULES.md", RULES);
    validateRepoFile("marketing/ads/banned-live.json", "[\"a\"]");
    validateRepoFile("marketing/ads/angles.json", "[{\"key\":\"a\",\"name\":\"A\"}]");
    validateRepoFile("marketing/brain/notes.json", "{}");
    throwsEdit(() => validateRepoFile("marketing/brain/notes.json", "{"), /not valid JSON/);
    throwsEdit(() => validateRepoFile("marketing/ads/registry.json", "{\"ads\": [{\"id\": \"x\"}]}"), /would not load/);
    throwsEdit(() => validateRepoFile("marketing/ads/banned-live.json", "[1]"), /list of plain text/);
    throwsEdit(() => validateRepoFile("marketing/ads/angles.json", "[{\"key\":\"a\"}]"), /key and a name/);
  });

  test("pure: the same input gives the same output and the input is not changed", () => {
    const edit = { op: "registry_add_ad", id: NEW_ID, title: "a", lane: "uwiq" };
    const copy = JSON.stringify(edit);
    assert.equal(applyEdit(REGISTRY, edit), applyEdit(REGISTRY, edit));
    assert.equal(JSON.stringify(edit), copy);
  });
});

// ── the flywheel ops (design §6 "Slice 1 additions", unit X3) ──────────────

const STAGE = [
  "---",
  "stage: 4",
  "version: 1",
  "status: draft",
  "inputs:",
  "  03-offer.md: 4596bcc6",
  "counts:",
  "  hooks: 31",
  "---",
  "",
  "# Partner copy",
  "",
  "status: draft is a phrase in the body and must never change.",
  ""
].join("\n");

const NOTES = [
  "# Owner notes — partner flywheel",
  "",
  "Format:",
  "",
  "## Notes",
  "",
  "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
  ""
].join("\n");

describe("set_front_matter_key", () => {
  const P = "marketing/flywheel/partner/04-copy.md";

  test("flips status in the stamp and leaves the body byte for byte", () => {
    const out = applyEdit(STAGE, { op: "set_front_matter_key", key: "status", value: "approved" });
    assert.match(out, /^---\nstage: 4\nversion: 1\nstatus: approved\n/);
    assert.equal(out.split("\n---\n")[1], STAGE.split("\n---\n")[1], "the body did not change");
    assert.match(out, /status: draft is a phrase in the body/);
  });

  test("the same value again changes nothing; a new key goes before the closing ---", () => {
    const once = applyEdit(STAGE, { op: "set_front_matter_key", key: "status", value: "approved" });
    assert.equal(applyEdit(once, { op: "set_front_matter_key", key: "status", value: "approved" }), once);
    // Wave 2b merge: only X1's stamp keys (status, approved_by, approved_at) may be set.
    const added = applyEdit(STAGE, { op: "set_front_matter_key", key: "approved_at", value: "2026-10-06" });
    assert.match(added, / {2}hooks: 31\napproved_at: 2026-10-06\n---\n/);
  });

  test("refuses a missing file, no stamp, a list key, and bad keys or values", () => {
    throwsEdit(() => applyEdit(null, { op: "set_front_matter_key", key: "status", value: "approved" }), /missing/);
    throwsEdit(() => applyEdit("# no stamp\n", { op: "set_front_matter_key", key: "status", value: "approved" }), /no stamp/);
    throwsEdit(() => applyEdit("---\nstatus: x\n", { op: "set_front_matter_key", key: "status", value: "approved" }), /not closed/);
    // Wave 2b merge: a key a run owns is refused by X1's allow-list before the list check.
    throwsEdit(() => applyEdit(STAGE, { op: "set_front_matter_key", key: "inputs", value: "x" }), /stamp key/);
    throwsEdit(() => applyEdit(STAGE, { op: "set_front_matter_key", key: "Status!", value: "x" }), /key/);
    throwsEdit(() => applyEdit(STAGE, { op: "set_front_matter_key", key: "status", value: "a\nb" }), /value/);
  });

  test("validateEdit takes any stage file of any campaign, and nothing else", () => {
    assert.deepEqual(validateEdit({ op: "set_front_matter_key", key: "status", value: "approved" }, P),
      { op: "set_front_matter_key", key: "status", value: "approved" });
    validateEdit({ op: "set_front_matter_key", key: "status", value: "approved" }, "marketing/flywheel/capital-blueprint/01-avatar.md");
    for (const bad of [
      "marketing/flywheel/partner/00-OWNER-NOTES.md",
      "marketing/flywheel/partner/07-later.md",
      "marketing/flywheel/partner/01-avatar/Market_Language_Bank.md",
      "marketing/ads/RULES.md",
      "marketing/flywheel/Partner/04-copy.md"
    ]) {
      throwsEdit(() => validateEdit({ op: "set_front_matter_key", key: "status", value: "approved" }, bad), /cannot edit/);
    }
    throwsEdit(() => validateEdit({ op: "set_front_matter_key", key: "status", value: "approved" }), /needs the path/);
  });
});

describe("append_line_under_heading", () => {
  const P = "marketing/flywheel/partner/00-OWNER-NOTES.md";
  const LINE = "2026-10-06 | stage 4 | lead with the backdoor fear";

  test("appends one line at the end of the section and keeps every earlier line", () => {
    const out = applyEdit(NOTES, { op: "append_line_under_heading", heading: "## Notes", line: LINE });
    assert.ok(out.startsWith(NOTES.trimEnd()), "nothing above is rewritten");
    assert.match(out, /the avatar is assumed on purpose\.\n2026-10-06 \| stage 4 \| lead with the backdoor fear\n$/);
  });

  test("the same line twice is written once (a retry is harmless)", () => {
    const once = applyEdit(NOTES, { op: "append_line_under_heading", heading: "## Notes", line: LINE });
    assert.equal(applyEdit(once, { op: "append_line_under_heading", heading: "## Notes", line: LINE }), once);
  });

  test("stops at the next heading; an empty section gets the line under a blank line; a missing heading is added", () => {
    const two = `${NOTES}\n## Later\n\nkeep me\n`;
    const out = applyEdit(two, { op: "append_line_under_heading", heading: "## Notes", line: LINE });
    assert.match(out, /assumed on purpose\.\n2026-10-06 \| stage 4 \| lead with the backdoor fear\n\n## Later\n\nkeep me\n$/);
    const empty = applyEdit("# T\n\n## Notes\n", { op: "append_line_under_heading", heading: "## Notes", line: LINE });
    assert.equal(empty, `# T\n\n## Notes\n\n${LINE}\n`);
    const none = applyEdit("# T\n", { op: "append_line_under_heading", heading: "## Notes", line: LINE });
    assert.equal(none, `# T\n\n## Notes\n\n${LINE}\n`);
  });

  test("refuses a missing file, a heading line, and paths other than owner notes", () => {
    throwsEdit(() => applyEdit(null, { op: "append_line_under_heading", heading: "## Notes", line: LINE }), /missing/);
    throwsEdit(() => applyEdit(NOTES, { op: "append_line_under_heading", heading: "## Notes", line: "## sneaky" }), /heading/);
    throwsEdit(() => applyEdit(NOTES, { op: "append_line_under_heading", heading: "Notes", line: LINE }), /heading/);
    validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: LINE }, P);
    throwsEdit(() => validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: LINE }, "marketing/flywheel/partner/04-copy.md"), /cannot edit/);
    throwsEdit(() => validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: " " }, P), /empty/);
  });
});

// ── the flywheel ops, unit X1's tests (wave 2b merge: one implementation with X3's;
//    the heading is the whole line, "## Notes") ──────────────────────────────

const STAGE_X1 = [
  "---",
  "stage: 1",
  "version: 2",
  "status: draft",
  "inputs:",
  "counts:",
  "  quotes: 133",
  "  languageEntries: 455",
  "---",
  "",
  "# Core_Avatar_Profile.md",
  "",
  "status: this line is in the body and must never change",
  ""
].join("\n");

const NOTES_X1 = [
  "# Owner notes — partner flywheel",
  "",
  "## Notes",
  "",
  "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
  "2026-08-31 | all | no compliance checking in this pipeline.",
  ""
].join("\n");

describe("set_front_matter_key (unit X1)", () => {
  test("flips the stamp and leaves the body byte for byte, so the staleness hash holds", () => {
    const out = applyEdit(STAGE_X1, { op: "set_front_matter_key", key: "status", value: "approved" });
    assert.match(out, /^---\nstage: 1\nversion: 2\nstatus: approved\ninputs:\ncounts:\n  quotes: 133\n/);
    assert.equal(bodyHash(out), bodyHash(STAGE_X1));
    assert.ok(out.endsWith("status: this line is in the body and must never change\n"));
    assert.equal(applyEdit(out, { op: "set_front_matter_key", key: "status", value: "approved" }), out, "idempotent");
  });

  test("adds a key the stamp does not have yet, inside the stamp", () => {
    const out = applyEdit(STAGE_X1, { op: "set_front_matter_key", key: "approved_by", value: "staff 1234" });
    assert.match(out, /  languageEntries: 455\napproved_by: staff 1234\n---\n/);
    assert.equal(bodyHash(out), bodyHash(STAGE_X1));
  });

  test("refuses a file with no stamp, a key a run owns, and a path outside the stage files", () => {
    throwsEdit(() => applyEdit("# no stamp\n", { op: "set_front_matter_key", key: "status", value: "approved" }), /no stamp/);
    throwsEdit(() => applyEdit(STAGE_X1, { op: "set_front_matter_key", key: "version", value: "9" }), /stamp key/);
    throwsEdit(() => applyEdit(null, { op: "set_front_matter_key", key: "status", value: "approved" }), /missing/);
    assert.ok(validateEdit({ op: "set_front_matter_key", key: "status", value: "approved" }, "marketing/flywheel/partner/01-avatar.md"));
    throwsEdit(() => validateEdit({ op: "set_front_matter_key", key: "status", value: "x" }, "marketing/flywheel/partner/00-OWNER-NOTES.md"), /stage file/);
    throwsEdit(() => validateEdit({ op: "set_front_matter_key", key: "status", value: "x" }, "marketing/ads/RULES.md"), /stage file/);
    throwsEdit(() => validateEdit({ op: "set_front_matter_key", key: "inputs", value: "x" }, "marketing/flywheel/partner/01-avatar.md"), /stamp key/);
    assert.equal(EDIT_OP_PATTERNS.set_front_matter_key.test("marketing/flywheel/partner/01-avatar/Sources.md"), false);
  });
});

describe("append_line_under_heading (unit X1)", () => {
  test("adds one line at the end of the Notes section; never rewrites; never twice", () => {
    const line = "2026-10-06 | stage 1 | keep the word bank, add to it";
    const out = applyEdit(NOTES_X1, { op: "append_line_under_heading", heading: "## Notes", line });
    assert.ok(out.startsWith(NOTES_X1.trimEnd()), "every old line is kept, in place");
    assert.ok(out.endsWith(`no compliance checking in this pipeline.\n${line}\n`));
    assert.equal(applyEdit(out, { op: "append_line_under_heading", heading: "## Notes", line }), out);
  });

  test("a section followed by another heading gets the line before that heading", () => {
    const two = `${NOTES_X1}\n## Later\n\nother\n`;
    const out = applyEdit(two, { op: "append_line_under_heading", heading: "## Notes", line: "new | line" });
    assert.match(out, /no compliance checking in this pipeline\.\nnew \| line\n\n## Later/);
  });

  test("a file with no Notes section gets one at the end", () => {
    const out = applyEdit("# Owner notes\n", { op: "append_line_under_heading", heading: "## Notes", line: "a | b" });
    assert.equal(out, "# Owner notes\n\n## Notes\n\na | b\n");
  });

  test("only the owner notes file of a campaign", () => {
    assert.ok(validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: "x" }, "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md"));
    throwsEdit(() => validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: "x" }, "marketing/flywheel/partner/01-avatar.md"), /OWNER-NOTES/);
    throwsEdit(() => validateEdit({ op: "append_line_under_heading", heading: "## Notes", line: " " }, "marketing/flywheel/partner/00-OWNER-NOTES.md"), /note line/);
  });
});
