// scripts/ads/check-script.test.mjs
//
// The one test that matters most in this file: every ad that is filmed and
// running today must pass the checker clean. The first version of this
// checker failed all five of them — it banned the word "not" and banned
// "soft pull", a phrase marketing/ads/RULES.md lists as one that works. This
// test exists so that regression can never ship silently again.
//
// Runs under plain `node --test`, no database, no network. Covered by
// `npm test`'s scripts/** glob per CLAUDE.md §12.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkOneScript, checkScriptText, loadBannedLive, loadRules, main } from "./check-script.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CONTROLS_PATH = join(REPO_ROOT, "marketing", "ads", "CONTROLS.md");

// Mirrors the module's own splitBlocks so this test does not need to export
// an internal function just to reach it.
function splitBlocksForTest(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = { title: null, startLine: 1, lines: [] };
  lines.forEach((line, i) => {
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) {
      if (current.title !== null || current.lines.some((l) => l.text.trim())) blocks.push(current);
      current = { title: heading[1].replace(/[*`]/g, "").trim(), startLine: i + 1, lines: [] };
      return;
    }
    current.lines.push({ n: i + 1, text: line });
  });
  if (current.title !== null || current.lines.some((l) => l.text.trim())) blocks.push(current);
  return blocks.filter((b) => b.title && b.lines.some((l) => l.text.trim()));
}

const LIVE_AD_TITLES = [
  "Ad 1 — Denial Angle",
  "Ad 2 — Broker Burn Angle",
  "Ad 3 — Competitor Angle",
  "Ad 4 — Blind Application",
  "The Founder VSL"
];

test("all five filmed-and-running ads in CONTROLS.md pass the checker clean", () => {
  const text = readFileSync(CONTROLS_PATH, "utf8");
  const blocks = splitBlocksForTest(text);
  const found = new Map(blocks.map((b) => [b.title, b]));

  for (const title of LIVE_AD_TITLES) {
    const block = found.get(title);
    assert.ok(block, `CONTROLS.md no longer has a heading "${title}" — did the file get renamed? Update LIVE_AD_TITLES here to match, do not just delete the case.`);
    const result = checkOneScript(block);
    assert.deepEqual(
      result.failures, [],
      `"${title}" is filmed, running, and booking calls today — the checker must never fail it. ` +
      `It failed with: ${JSON.stringify(result.failures)}`
    );
  }
});

test("marketing/ads/CONTROLS.md is marked LIVE — DO NOT EDIT, and this test never edits it", () => {
  const text = readFileSync(CONTROLS_PATH, "utf8");
  assert.match(text, /^# LIVE — DO NOT EDIT/, "CONTROLS.md's own header changed shape; the file this checker is graded against may not be the locked baseline any more.");
});

// Flipped 2026-10-05 (spec 7.1): RULES.md Part 0 rule 1 says "optimize your
// credit", so "optimize" came off the banned list. Same block as before.
test("'optimize' is no longer a banned word (Part 0 rule 1), in checkOneScript too", () => {
  const block = {
    title: "Test — banned word forms",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK This system will optimize your file before anything gets submitted anywhere." },
      { n: 2, text: "BODY We built it because nobody else does this and it takes very little time to run." },
      { n: 3, text: "CTA Click the link below and book your free strategy call today, right now." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG test_angle" }
    ]
  };
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /banned word "optimize"/.test(f.message)), JSON.stringify(result.failures));
  assert.ok(!loadRules().BANNED_WORDS.includes("optimize"));
});

test("a banned word is caught, including a plural/-ed/-ing form of it", () => {
  const block = {
    title: "Test — banned word forms",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK This system streamlined your file before anything got submitted anywhere." },
      { n: 2, text: "BODY We built it because nobody else does this and it takes very little time to run." },
      { n: 3, text: "CTA Click the link below and book your free strategy call today, right now." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG test_angle" }
    ]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned word "streamline"/.test(f.message)), JSON.stringify(result.failures));
});

test("a banned phrase is caught in a different verb form (moved the needle vs move the needle)", () => {
  const block = {
    title: "Test — banned phrase form",
    startLine: 1,
    lines: [{ n: 1, text: "Nobody ever moved the needle on this before we built our own system to do it." }]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned phrase "move the needle"/.test(f.message)), JSON.stringify(result.failures));
});

test("a phrase RULES.md lists as one that works is never flagged", () => {
  const block = {
    title: "Test — allowed phrase",
    startLine: 1,
    lines: [{ n: 1, text: "We run a soft pull first, and it has zero impact on your score, so nothing changes until you decide it should." }]
  };
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /soft pull/i.test(f.message)), JSON.stringify(result.failures));
});

test("a two-paragraph BODY is not truncated at the first blank line", () => {
  const block = {
    title: "Test — multi-paragraph body",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK The guy who got you funded left inquiries all over your file." },
      { n: 2, text: "BODY First paragraph, twelve words long right here to check the count works." },
      { n: 3, text: "" },
      { n: 4, text: "Second paragraph after a blank line, also real words that must still be counted." },
      { n: 5, text: "CTA Book your call below right now, it only takes two minutes to apply." },
      { n: 6, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 7, text: "RUNTIME 60-90s" },
      { n: 8, text: "TAG test_angle" }
    ]
  };
  const result = checkOneScript(block);
  const bodyWords = result.wordCount;
  assert.ok(bodyWords > 25, `expected the second paragraph to be counted; got ${bodyWords} total words`);
});

test("a hook that ends in a question fails cause-first check 3", () => {
  const block = {
    title: "Test — question hook",
    startLine: 1,
    lines: [{ n: 1, text: "HOOK Have you ever wondered why your applications keep getting denied?" }]
  };
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /cause-first check 3/.test(f.message)));
});

test("main() exits 0 on a clean file and 1 on a failing one", () => {
  assert.equal(main(["--help"]), 0);
  assert.equal(main([]), 0);
});

// Reads one inline array out of copy.js (it cannot import rules-data.mjs:
// workflow scripts cannot import anything, copy.js line 13).
function copyJsList(source, name) {
  const m = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  assert.ok(m, `.claude/workflows/copy.js no longer has a ${name} list`);
  return [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? x[2]);
}

test("loadRules returns the shared lists, and they still match .claude/workflows/copy.js", () => {
  const rules = loadRules();
  assert.equal(rules.BANNED_WORDS.length, 33);
  assert.equal(rules.BANNED_PHRASES.length, 20);
  assert.equal(rules.BANNED_OPENERS.length, 11);
  assert.equal(rules.PART0_PATTERNS.length, 16);
  assert.ok(rules.BANNED_WORDS.includes("align"), "the word list drifted once before and lost \"align\" — this pins it back in");

  const copyJs = readFileSync(join(REPO_ROOT, ".claude", "workflows", "copy.js"), "utf8");
  for (const [mine, theirs] of [["BANNED_WORDS", "BAN_WORDS"], ["BANNED_PHRASES", "BAN_PHRASES"], ["BANNED_OPENERS", "BAN_OPENERS"]]) {
    assert.deepEqual(
      [...copyJsList(copyJs, theirs)].sort(), [...rules[mine]].sort(),
      `${mine} in rules-data.mjs and ${theirs} in .claude/workflows/copy.js have drifted — fix one to match the other`
    );
  }
});

// RULES.md 3.14, confirmed as an owner-set rule 2026-09-07, alongside the
// evergreen backend-selling generator Chris asked to be built tonight.

test("an evergreen script (TYPE evergreen) is flagged for a date, a season, and a growing dollar figure", () => {
  const block = {
    title: "Test — stale evergreen ad",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK Most owners make this mistake going into 2026, and it costs them every single quarter." },
      { n: 2, text: "BODY This is the mistake that shows up every fall, and it is a reasonable one to make because nobody explains it. Here is the one thing to do instead, and it works whether or not you ever call us. We have secured $25 million for our clients and the number keeps climbing." },
      { n: 3, text: "CTA If you want us to run it for you, the link is below." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG evergreen_mistake_1" },
      { n: 7, text: "TYPE evergreen" }
    ]
  };
  const result = checkOneScript(block);
  const messages = result.failures.map((f) => f.message).join(" | ");
  assert.match(messages, /a specific year/);
  assert.match(messages, /a season/);
  assert.match(messages, /revenue figure that will change/);
});

test("the exact same stale content is NOT flagged when TYPE is cold (or absent)", () => {
  const block = {
    title: "Test — same content, not evergreen",
    startLine: 1,
    lines: [
      { n: 1, text: "HOOK Most owners make this mistake going into 2026, and it costs them every single quarter." },
      { n: 2, text: "BODY We have secured $25 million for our clients and the number keeps climbing this fall." },
      { n: 3, text: "CTA Click the link below and book your free strategy call today, right now." },
      { n: 4, text: "CLOSE No hard inquiry. No obligation. Nothing moves until you say so." },
      { n: 5, text: "RUNTIME 60-90s" },
      { n: 6, text: "TAG cold_test" }
    ]
  };
  const result = checkOneScript(block);
  const messages = result.failures.map((f) => f.message).join(" | ");
  assert.doesNotMatch(messages, /RULES\.md 3\.14/);
});

// The seven fixes below all came from one adversarial-review pass 2026-09-07,
// where a separate agent actively tried to break the checker. Each test here
// is a real repro it found. Do not remove one without understanding why the
// original bug was real — every one of these let a real violation through,
// or wrongly rejected genuinely fine copy.

const mkRow = (n, text) => ({ n, text });
const mkBlock = (title, lines) => ({ title, startLine: 1, lines: lines.map((t, i) => mkRow(i + 1, t)) });

test("fix 1: a nearby allowed close phrase no longer hides a real dollar-guarantee violation", () => {
  const block = mkBlock("Test", [
    "HOOK you can get $50,000, no obligation, nothing changes up front, it will land in your account within days."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /a dollar amount a bank WILL give them/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 1 continued: a nearby allowed close phrase no longer hides a real deletion-promise violation", () => {
  const block = mkBlock("Test", [
    "HOOK those late marks will, no obligation, come off your report before your next application goes in."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /a bad item WILL come off/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 1 stays fixed: the real required close is never itself flagged as a never-say violation", () => {
  const block = mkBlock("Test", [
    "CLOSE No hard inquiry. No obligation. Nothing moves until you say so."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /never-say/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 2: a banned opener in the BODY is caught even with no HOOK section at all", () => {
  const block = mkBlock("Ad 900", [
    "BODY Imagine a world where every lender said yes on the first try, every single time, for everyone."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /banned opener/.test(f.message)), JSON.stringify(result.failures));
  assert.ok(result.failures.some((f) => /no HOOK found/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 3: a body line that happens to start with the word TAG does not satisfy the origin_angle check", () => {
  const block = mkBlock("Test", [
    "HOOK The guy who got you funded left inquiries all over your file.",
    "BODY He never built a system to fix that.",
    "TAG teams of closers used to split this work between two people before it was automated away."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /does not look like a real origin_angle slug/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 3 stays fixed: a real slug-shaped TAG passes", () => {
  const block = mkBlock("Test", [
    "HOOK The guy who got you funded left inquiries all over your file.",
    "TAG denial_angle"
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /TAG/.test(f.message)), JSON.stringify(result.failures));
});

// The stem came out of RULES.md 3.3 on 2026-10-05 (it breaks Part 0 rule 15,
// which the judge checks). The pattern check still must not call a plain
// "not X, but Y" contrast the "it's not X, it's Y" tell.
test("fix 6: a plain 'not another X, but Y' contrast is never flagged as an AI-tell contrast", () => {
  const block = mkBlock("Test", [
    "HOOK Not another broker, but the first one that actually reads your file the way a bank does."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /it's not X, it's Y/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 6 stays fixed: the real 'it's not X, it's Y' AI tell is still caught", () => {
  const block = mkBlock("Test", [
    "HOOK It's not about your credit score, it's about who actually reads your file before it goes in."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /it's not X, it's Y/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 7 & 5: a hyphenated close (Soft-pull only) is accepted the same as the unhyphenated form", () => {
  const block = mkBlock("Test", [
    "CLOSE Soft-pull only. Zero impact on your score. Nothing moves until you say so."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /the close is missing/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 5: the avoid-list phrase is caught with or without its hyphen", () => {
  const hyphenated = checkOneScript(mkBlock("Test", ["HOOK Stop chasing low-hanging fruit and start reading the real file."]));
  const unhyphenated = checkOneScript(mkBlock("Test", ["HOOK Stop chasing low hanging fruit and start reading the real file."]));
  assert.ok(hyphenated.failures.some((f) => /low-hanging fruit/.test(f.message)), JSON.stringify(hyphenated.failures));
  assert.ok(unhyphenated.failures.some((f) => /low-hanging fruit/.test(f.message)), JSON.stringify(unhyphenated.failures));
});

test("fix 8: 'book' and 'call' used as ordinary nouns do not falsely trip the cause-first ask check", () => {
  const block = mkBlock("Test", [
    "HOOK The bank never called this a denial, and nobody wrote it in the book they show you when they turn you down."
  ]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /cause-first check 2/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 8 stays fixed: a real imperative ask at the start of the hook is still caught", () => {
  const block = mkBlock("Test", [
    "HOOK Book your free call now and we will run your file before anything else happens today."
  ]);
  const result = checkOneScript(block);
  assert.ok(result.failures.some((f) => /cause-first check 2/.test(f.message)), JSON.stringify(result.failures));
});

test("fix 9: the avoid-list uses whole-phrase matching, not a raw substring — no false positive on a longer word", () => {
  const block = mkBlock("Test", ["HOOK We ran a cash advancement program that helped nobody at all, honestly."]);
  const result = checkOneScript(block);
  assert.ok(!result.failures.some((f) => /"cash advance"/.test(f.message)), JSON.stringify(result.failures));
});

test("known limitation, documented not silently dropped: the stemmer only inflects the leading word of a phrase, so an irregular verb elsewhere in it (took vs take) is not caught — 'deep dive' variants and regular -ed/-ing/-s forms ARE caught", () => {
  // This is intentionally an accepted gap, not a bug fix. Recorded so nobody
  // re-discovers it as a surprise and re-litigates the same investigation.
  const block = mkBlock("Test", ["HOOK That one change took your file to the next level of what a lender actually sees."]);
  const result = checkOneScript(block);
  // Documents current behavior (does not catch "took ... to the next level").
  // If this ever starts passing (someone builds real irregular-verb handling),
  // this assertion will fail loudly and should be updated, not deleted.
  assert.ok(!result.failures.some((f) => /the next level/.test(f.message)));
});

// ---------------------------------------------------------------------------
// checkScriptText — strict mode, banned-live.json and the floors by format
// (spec 7.1, added 2026-10-05).
// ---------------------------------------------------------------------------

const part0Rules = (r) => r.failures.filter((f) => f.rule.startsWith("part0-"));
// Strict check on one line, with an empty banned list so only Part 0 speaks.
// "long" has no floor and no close check, so nothing else gets in the way.
const strictLong = (text) => checkScriptText(text, { format: "long", strict: true, bannedLive: [] });

// A standard words-style script that obeys Part 0. It says "optimize your
// credit", which Part 0 rule 1 asks for.
const CLEAN_STANDARD_WORDS = [
  "The banks that turned you down never read your credit file the way a lender reads it before a decision.",
  "",
  "I spent the last ten years learning what they look for, across hundreds of files and thousands of data points. Your file holds more funding than the last application showed you.",
  "",
  "Three things decide it: your names and addresses matching on every report, your card balances, and the ORDER you apply in. When those line up, the same file gets approved by more banks in one funding sequence.",
  "",
  "We optimize your credit first, so every application goes in on a clean file. You get a plan built from your own report, with the banks that approve files like yours in your state ↑",
  "",
  "Book a call and we walk your file with you, line by line, before anything goes out.",
  "",
  "No hard inquiry. Nothing moves until you say so."
].join("\n");

test("strict: a clean standard words script that says 'optimize your credit' passes with nothing to fix", () => {
  const result = checkScriptText(CLEAN_STANDARD_WORDS, { format: "standard", style: "words", strict: true, bannedLive: [] });
  assert.ok(result.words >= 135, `the fixture must clear the 135-word floor; it has ${result.words}`);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.match(CLEAN_STANDARD_WORDS, /optimize your credit/);
});

// One failing strict case per Part 0 pattern. Each line must fail strict mode
// on the named rule, and must NOT fail on a Part 0 rule outside strict mode.
const PART0_CASES = [
  ["credit repair", "We do credit repair for owners like you.", 1],
  ["your number", "We find your number before you apply.", 2],
  ["the number", "Here is the number the bank sees.", 2],
  ["shelf company", "Buy a shelf company and apply with it.", 4],
  ["sitting on a shelf", "That LLC has been sitting on a shelf for years.", 4],
  ["EIN", "Get an EIN for the business first.", 5],
  ["DUNS", "Set up your DUNS profile before you apply.", 5],
  ["net-30 (normalized text)", "Open five net-30 vendor accounts this month.", 5],
  ["gas card", "Start with a gas card and build from there.", 5],
  ["no guarantees", "There are no guarantees in funding.", 6],
  ["dude", "Look, dude, the file decides it.", 12],
  ["bro", "The file decides it, bro.", 12],
  ["most business owners", "Most business owners apply in the wrong order.", 20],
  ["could", "You could get approved for more.", 19],
  ["could be worth", "Your file could be worth more than you think.", 19],
  ["dollar amount in words", "That is three hundred thousand dollars in funding.", 11],
  ["FundHub", "FundHub reads the file before any bank does.", 10],
  ["FUNDHUB", "FUNDHUB reads the file before any bank does.", 10],
  ["Fund Hub", "Fund Hub reads the file before any bank does.", 10],
  ["Frodo", "You are Frodo in this story.", 33],
  ["skip the journey", "You get to skip the journey.", 33],
  ["Koi Poke", "Koi Poke got funded after a bank said no.", 35],
  ["$25M", "We secured $25M for our clients.", 35]
];

for (const [name, line, rule] of PART0_CASES) {
  test(`strict: Part 0 rule ${rule} pattern "${name}" fails, and only in strict mode`, () => {
    const strict = strictLong(line);
    assert.ok(strict.failures.some((f) => f.rule === `part0-${rule}` && f.line === 1 && f.match), JSON.stringify(strict.failures));
    assert.equal(strict.ok, false);
    const loose = checkScriptText(line, { format: "long", strict: false });
    assert.deepEqual(part0Rules(loose), [], JSON.stringify(loose.failures));
  });
}

test("strict: every Part 0 pattern has at least one failing case above", () => {
  const covered = new Set();
  for (const [, line] of PART0_CASES) {
    for (const p of loadRules().PART0_PATTERNS) {
      const text = p.on === "raw" ? line : line.toLowerCase().replace(/-/g, " ");
      if (new RegExp(p.pattern.source, p.pattern.flags).test(text)) covered.add(p.id);
    }
  }
  assert.deepEqual([...covered].sort(), loadRules().PART0_PATTERNS.map((p) => p.id).sort());
});

test("strict: 'net 30' is matched on normalized text — hyphen, space and no space all fail", () => {
  for (const line of ["Open a net-30 account.", "Open a net 30 account.", "Open a net30 account.", "Open a NET-30 account."]) {
    assert.ok(strictLong(line).failures.some((f) => f.rule === "part0-5"), line);
  }
});

test("strict: the company name is matched on raw text — Fundhub and the fundhub.ai domain pass", () => {
  const ok = strictLong("Fundhub reads your file. Go to fundhub.ai and Fundhub's team calls you.");
  assert.deepEqual(part0Rules(ok), [], JSON.stringify(ok.failures));
  for (const bad of ["FundHub", "FUNDHUB", "Fund Hub", "fund hub", "Fund-Hub", "fundHub"]) {
    const r = strictLong(`${bad} reads your file.`);
    assert.ok(r.failures.some((f) => f.rule === "part0-10"), bad);
  }
});

test("strict: judge rules are not patterns — 'round two', 'carry' and 'man' never fail on their own", () => {
  const result = strictLong("Round two of the sequence goes out once the file is clean. Your file carries more than the bank showed you, man, and it can carry a bigger line.");
  assert.deepEqual(part0Rules(result), [], JSON.stringify(result.failures));
  for (const p of loadRules().PART0_PATTERNS) {
    for (const word of ["round two", "carry", "carries", "man"]) {
      assert.ok(!new RegExp(p.pattern.source, p.pattern.flags).test(word), `${p.id} matches the judge word "${word}"`);
    }
  }
});

test("strict: near misses stay clean — numerals, 'thousands of dollars', 'couldn't', 'your phone number'", () => {
  const result = strictLong("You got $300,000 and $100K lines. That saved thousands of dollars. The bank couldn't read it. We don't sell your phone number.");
  assert.deepEqual(part0Rules(result), [], JSON.stringify(result.failures));
});

test("strict: em dashes are still caught (they were already)", () => {
  const result = strictLong("Your file is ready — the banks are not.");
  assert.ok(result.failures.some((f) => f.rule === "em-dash"), JSON.stringify(result.failures));
});

test("strict: a phrase in a line break still fails, and the line is null when it spans lines", () => {
  const result = strictLong("This is for most business\nowners who apply in the wrong order.");
  const hit = result.failures.find((f) => f.rule === "part0-20");
  assert.ok(hit, JSON.stringify(result.failures));
  assert.equal(hit.line, null);
});

// banned-live.json: Chris's banned phrases, plain text, merged in strict mode.

test("banned-live.json is a JSON list of plain strings, and strict mode reads it with no warning", () => {
  const parsed = JSON.parse(readFileSync(join(REPO_ROOT, "marketing", "ads", "banned-live.json"), "utf8"));
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.every((x) => typeof x === "string"));
  const loaded = loadBannedLive();
  assert.equal(loaded.warning, null);
  assert.deepEqual(loaded.phrases, parsed.filter((x) => x.trim()));
  const result = checkScriptText(CLEAN_STANDARD_WORDS, { format: "standard", style: "words", strict: true });
  assert.ok(!result.warnings.some((w) => w.rule === "banned-live"), JSON.stringify(result.warnings));
});

test("banned-live phrases fail in strict mode only, matched as plain text", () => {
  const text = "Here is what (really) works for a file like yours.";
  const strict = checkScriptText(text, { format: "long", strict: true, bannedLive: ["what (really) works"] });
  assert.ok(strict.failures.some((f) => f.rule === "banned-live" && f.match === "what (really) works" && f.line === 1), JSON.stringify(strict.failures));
  const loose = checkScriptText(text, { format: "long", strict: false, bannedLive: ["what (really) works"] });
  assert.ok(!loose.failures.some((f) => f.rule === "banned-live"));
  // As a pattern "(really)" would be a group and match "what really works".
  // It is plain text, so this does not fail.
  const plain = checkScriptText("Here is what really works.", { format: "long", strict: true, bannedLive: ["what (really) works"] });
  assert.ok(!plain.failures.some((f) => f.rule === "banned-live"), JSON.stringify(plain.failures));
});

test("banned-live: a file that cannot be read gives a warning, never a crash", () => {
  const loaded = loadBannedLive(["/nonexistent/banned-live.json"]);
  assert.deepEqual(loaded.phrases, []);
  assert.match(loaded.warning, /could not be read/);
});

// Floors by format.

const nWords = (n) => Array.from({ length: n }, () => "file").join(" ") + ".";
const lengthFails = (r) => r.failures.filter((f) => f.rule === "length");

test("floors: standard words needs 135 words or more", () => {
  assert.equal(lengthFails(checkScriptText(nWords(134), { format: "standard", style: "words" })).length, 1);
  assert.equal(lengthFails(checkScriptText(nWords(135), { format: "standard", style: "words" })).length, 0);
  assert.equal(lengthFails(checkScriptText(nWords(400), { format: "standard", style: "words" })).length, 0);
});

test("floors: sorting needs 104-137 words", () => {
  for (const [n, fails] of [[103, 1], [104, 0], [120, 0], [137, 0], [138, 1]]) {
    assert.equal(lengthFails(checkScriptText(nWords(n), { format: "sorting" })).length, fails, `${n} words`);
  }
});

test("floors: long, notes, greenscreen and vsl have no floor and no bullets shape", () => {
  for (const format of ["long", "notes", "greenscreen", "vsl"]) {
    const r = checkScriptText(nWords(10), { format });
    assert.deepEqual(r.failures.filter((f) => ["length", "bullets-shape"].includes(f.rule)), [], format);
  }
});

const BULLETS_OK = [
  "Your file is worth more funding than the last bank showed you. One detail on it decides how much.",
  "",
  "- names and addresses match on every report",
  "- card balances under 10% before you apply",
  "- the banks that approve files like yours",
  "",
  "That detail is the ORDER you apply in. Book a call and your advisor walks your file with you.",
  "",
  "No hard inquiry. Nothing moves until you say so."
].join("\n");

test("floors: standard bullets has no word floor; hook, line 2, reveal, CTA and 3-8 short cues pass", () => {
  const r = checkScriptText(BULLETS_OK, { format: "standard", style: "bullets", strict: true, bannedLive: [] });
  assert.ok(r.words < 135);
  assert.deepEqual(r.failures, []);
  // Standard defaults to the bullets style when no style is sent.
  assert.deepEqual(checkScriptText(BULLETS_OK, { format: "standard", strict: true, bannedLive: [] }).failures, []);
});

test("floors: standard bullets fails without line 2, without the reveal and CTA, and with too few cues", () => {
  const noLine2 = BULLETS_OK.replace(" One detail on it decides how much.", "");
  assert.ok(checkScriptText(noLine2, { format: "standard" }).failures.some((f) => f.rule === "bullets-shape" && /line 2/.test(f.message)));

  const noEnd = BULLETS_OK.split("\n").slice(0, 5).join("\n");
  const end = checkScriptText(noEnd, { format: "standard" }).failures.filter((f) => f.rule === "bullets-shape");
  assert.ok(end.some((f) => /the reveal/.test(f.message)), JSON.stringify(end));
  assert.ok(end.some((f) => /the CTA/.test(f.message)), JSON.stringify(end));

  const twoCues = BULLETS_OK.replace("- the banks that approve files like yours\n", "");
  assert.ok(checkScriptText(twoCues, { format: "standard" }).failures.some((f) => f.rule === "bullets-shape" && f.match === "2"));
});

test("floors: standard bullets fails with 9 cues and with a cue over 12 words", () => {
  const nine = BULLETS_OK.replace("- the banks that approve files like yours", Array.from({ length: 7 }, (_, i) => `- cue number ${i + 1}`).join("\n"));
  assert.ok(checkScriptText(nine, { format: "standard" }).failures.some((f) => f.rule === "bullets-shape" && f.match === "9"));

  // 13 words: one over the limit.
  const long = BULLETS_OK.replace("- the banks that approve files like yours", "- the banks that approve files like yours in your state at your score");
  const hit = checkScriptText(long, { format: "standard" }).failures.find((f) => f.rule === "bullets-shape" && /13 words/.test(f.message));
  assert.ok(hit, "a 13-word cue must fail");
  assert.equal(hit.line, 5);
  // 12 words: right at the limit, passes.
  const twelve = BULLETS_OK.replace("- the banks that approve files like yours", "- the banks that approve files like yours in your state at score");
  assert.ok(!checkScriptText(twelve, { format: "standard" }).failures.some((f) => f.rule === "bullets-shape"));
});

test("floors: standard bullets reads the shape from parts when parts are sent", () => {
  const parts = [
    { kind: "hook", text: "Your file is worth more funding than the last bank showed you." },
    { kind: "line2", text: "One detail on it decides how much." },
    { kind: "cue", text: "names and addresses match on every report" },
    { kind: "cue", text: "card balances under 10% before you apply" },
    { kind: "cue", text: "the banks that approve files like yours" },
    { kind: "reveal", text: "That detail is the ORDER you apply in." },
    { kind: "cta", text: "Book a call and your advisor walks your file with you." }
  ];
  assert.deepEqual(checkScriptText(BULLETS_OK, { format: "standard", parts }).failures, []);
  const missing = checkScriptText(BULLETS_OK, { format: "standard", parts: parts.filter((p) => p.kind !== "line2") });
  assert.ok(missing.failures.some((f) => f.rule === "bullets-shape" && /line 2/.test(f.message)));
});

test("close check: runs for standard and sorting only", () => {
  const noClose = nWords(120);
  for (const format of ["standard", "sorting"]) {
    assert.ok(checkScriptText(noClose, { format, style: "words" }).failures.some((f) => f.rule === "close-promises"), format);
  }
  for (const format of ["long", "notes", "greenscreen", "vsl"]) {
    assert.ok(!checkScriptText(noClose, { format }).failures.some((f) => f.rule === "close-promises"), format);
  }
});

test("no format: a warning, and no length or close check", () => {
  const r = checkScriptText(nWords(5), {});
  assert.ok(r.warnings.some((w) => w.rule === "format"));
  assert.deepEqual(r.failures.filter((f) => ["length", "close-promises", "bullets-shape"].includes(f.rule)), []);
  const odd = checkScriptText(nWords(5), { format: "standard", style: "poem" });
  assert.ok(odd.warnings.some((w) => w.rule === "style"));
  assert.deepEqual(odd.failures.filter((f) => ["length", "bullets-shape"].includes(f.rule)), []);
});

test("the old checks still run in checkScriptText: banned word, opener, never-say, question hook", () => {
  const r = checkScriptText("Have you ever wondered why the bank said no? We streamlined it. Your score will go up.", { format: "long" });
  const rules = r.failures.map((f) => f.rule);
  for (const rule of ["banned-word", "opener", "never-say", "cause-first-3"]) assert.ok(rules.includes(rule), `${rule}: ${JSON.stringify(r.failures)}`);
});

test("importing check-script.mjs runs nothing (safe to import from src/)", () => {
  const url = new URL("./check-script.mjs", import.meta.url).href;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { encoding: "utf8" });
  assert.equal(out, "");
});
