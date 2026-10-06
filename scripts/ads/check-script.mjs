#!/usr/bin/env node
// scripts/ads/check-script.mjs — the fast pass on an ad script, before a
// human reads it.
//
//   node scripts/ads/check-script.mjs marketing/ads/scripts/2026-09-06.md
//   node scripts/ads/check-script.mjs one.md two.md
//   cat draft.md | node scripts/ads/check-script.mjs --stdin
//   npm run ads:check -- marketing/ads/CONTROLS.md
//
// Exits 0 when every script passes and 1 with a plain list of what failed and
// the line it failed on.
//
// WHY THIS IS A SCRIPT AND NOT AN INSTRUCTION IN A SKILL FILE
// A regex cannot lie about having run. An agent told "check the banned words"
// can believe it checked and be wrong, and the same bad line ships again next
// week. So the ban lists live in code — marketing/ads/rules-data.mjs — and the
// writing skill has to run this and fix what comes back.
//
// WHAT THIS IS NOT
// This is NOT the compliance screen. The twelve compliance rules (seeded by
// db/migrations/047_compliance_rules.sql) run later and somewhere else:
// inside storeAsset in src/creative/generate.mjs, which calls screen() from
// src/compliance/screen.mjs. That one needs a live database and it fails
// closed. Do not import it here. This checker is the cheap pass that catches
// tired wording before Chris ever opens the draft; the compliance gate is
// the expensive pass that decides whether an asset may run.
//
// REWRITTEN 2026-09-07. The first version read marketing/ads/RULES.md as prose and
// guessed which sentences were rules. It found 106 "rules" in a 562-line
// file, most of them section headings and stray words. It banned "not" and
// banned "soft pull" — a phrase RULES.md itself lists as one that works — and
// it rejected all five ads that are filmed, running, and booking calls right
// now. This version reads a single machine-readable file
// (marketing/ads/rules-data.mjs) instead of parsing prose. There is no second
// place a rule can hide.
//
// STRICT MODE (added 2026-10-05, spec 7.1)
// checkScriptText(text, {format, style, strict}) checks one script given as
// plain teleprompter text, the shape the app's writer produces. With
// strict: true it adds RULES.md Part 0's patterns (PART0_PATTERNS in
// rules-data.mjs) and every phrase in marketing/ads/banned-live.json.
// It also holds the floors by format. checkOneScript is unchanged and still
// reads only the old lists, so the five live ads in CONTROLS.md pass.
// Importing this file runs nothing: the CLI below only runs when this file
// is executed directly, so src/ code can import checkScriptText safely.
//
// Node built-ins only. No packages. Nothing here talks to a database or a
// network.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BANNED_WORDS, BANNED_PHRASES, BANNED_OPENERS,
  AVOID_PHRASES, ALLOWED_PHRASES,
  NEVER_SAY, NEVER_SAY_ALLOWED, CLOSE_PROMISES,
  WORD_COUNT_BANDS, FLOOR_WORDS, VENDOR_NAMES,
  PART0_PATTERNS, SCRIPT_FORMATS, DEFAULT_STYLE, FORMAT_RULES
} from "../../marketing/ads/rules-data.mjs";

// ---------------------------------------------------------------------------
// READING A SCRIPT
//
// Two shapes are accepted, because the checker has to pass the five ads
// already filmed and running, and those were written before this format
// existed.
//
//   LABELLED  — marketing/ads/ANGLE-GENERATOR.md's locked format. A line begins
//               with HOOK, BODY, CTA or CLOSE (uppercase, at the start of
//               the line) and everything until the next label or the next
//               heading belongs to that section, blank lines included. A
//               metadata line (RUNTIME, WORDS, SHOOT, TAG) is read but never
//               scanned for banned words — a shoot note saying "optimize the
//               light" is not an ad reading like a robot.
//
//   UNLABELLED — plain paragraphs under a heading, the shape every ad in
//               marketing/ads/CONTROLS.md is actually written in. Treated as one
//               spoken block. The runtime-band ceiling is not enforced,
//               because no band was declared — only the 60-second floor is,
//               because that rule has no exception. The first sentence is
//               still tested for cause-first.
// ---------------------------------------------------------------------------

const SPOKEN_LABELS = ["HOOK", "BODY", "CTA", "CLOSE"];
// TYPE is optional metadata: cold | vsl | evergreen. RULES.md 3.14's no-stale
// rule (dates, seasons, scarcity, moving numbers) only applies to a script
// that declares itself evergreen — running it against a cold ad would wrongly
// flag a real dollar figure like "$25 million secured", which is fine in a
// cold ad and only a problem in a piece meant to run for a year unchanged.
const META_LABELS = ["RUNTIME", "WORDS", "SHOOT", "TAG", "TYPE"];
const ALL_LABELS = [...SPOKEN_LABELS, ...META_LABELS];
// Case-sensitive on purpose: the real format is all-caps, so a body sentence
// that happens to start "Who is not showing them?" (lowercase after the
// first letter) can never be mistaken for a label.
const LABEL_RE = new RegExp(`^(${ALL_LABELS.join("|")})\\b[\\s:]*(.*)$`);
// Strips the timing that sits between the label and the words, e.g.
// "HOOK 0-3s The guy who..." or "CTA last 10-30s ...". Never applied to
// RUNTIME, where the timing IS the value.
const TIMING_RE = /^(?:last\s+)?\d+(?:\s*[-–—]\s*\d+)?\s*(?:s(?:ec|econds)?|min(?:utes)?)\b[\s:]*/i;

/** Split a file into the headed blocks inside it, keeping real line numbers. */
function splitBlocks(text) {
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
  // A block counts as a script only when it has a HOOK line (the labelled
  // format) OR its own heading names it as an ad ("Ad 1 — …", "Script 7 —
  // …", "The Founder VSL", or a heading containing "VSL"). A heading like
  // "What the controls already do well" is commentary about the ads, not an
  // ad, and would otherwise be scanned and reported as a failing script.
  const looksLikeAdHeading = (title) => /^(ad|script)\s+\d/i.test(title) || /vsl/i.test(title);
  const hasHook = (b) => b.lines.some((l) => LABEL_RE.test(l.text.trim()) && l.text.trim().startsWith("HOOK"));
  return blocks.filter((b) => b.title && b.lines.some((l) => l.text.trim()) && (hasHook(b) || looksLikeAdHeading(b.title)));
}

/**
 * Parse one block into sections. Returns { mode: 'labelled' | 'unlabelled',
 * sections } where sections maps a label to an array of {n, text} rows.
 * A blank line does NOT end a section — only a new label or the next
 * heading does. This is the fix for the bug where a two-paragraph BODY lost
 * everything after its first blank line.
 */
function parseBlock(block) {
  const hasLabel = block.lines.some((l) => LABEL_RE.test(l.text.trim()));
  if (!hasLabel) {
    const rows = block.lines.filter((l) => l.text.trim()).map((l) => ({ n: l.n, text: l.text.trim() }));
    return { mode: "unlabelled", sections: { FULL: rows } };
  }
  const sections = {};
  let label = null;
  for (const line of block.lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue; // blank lines are just skipped, never a section boundary
    const m = trimmed.match(LABEL_RE);
    if (m) {
      label = m[1];
      const body = SPOKEN_LABELS.includes(label) ? m[2].replace(TIMING_RE, "").trim() : m[2].trim();
      sections[label] = sections[label] || [];
      if (body) sections[label].push({ n: line.n, text: body });
      continue;
    }
    if (!label) continue; // prose before the first label (rare) is not scored
    sections[label].push({ n: line.n, text: trimmed });
  }
  return { mode: "labelled", sections };
}

const joinText = (rows) => (rows || []).map((r) => r.text).join(" ").trim();
const countWords = (s) => (s.match(/[A-Za-z0-9'’$%-]+/g) || []).length;
/* Hyphens fold to spaces here, found necessary by adversarial review two
 * ways at once: "Soft-pull only" (a real, natural hyphenated variant of the
 * required close) was wrongly rejected as missing the promise, and
 * "low hanging fruit" with no hyphen was wrongly let through the avoid-list
 * because the banned entry was hyphenated and matching was literal. Folding
 * both sides to the same form fixes both directions in one place. This never
 * touches row.text directly (only the normalized copy used for matching),
 * so checkEmDash — which reads row.text raw — is unaffected. */
const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// THE CHECKS. Each returns an array of { line, message }.
// ---------------------------------------------------------------------------

/** A phrase is "present" only as a whole word/phrase, not as a substring of
 *  a longer word — "align" must not fire on "realigned" turning up inside
 *  some other word, and "not" must never be a rule at all (it isn't one:
 *  see rules-data.mjs — this checker no longer invents single-word rules
 *  from parsed prose). */
function findWholePhrase(haystackNorm, phraseNorm) {
  const re = new RegExp(`(?:^|[^a-z0-9'])${escapeRe(phraseNorm)}(?:$|[^a-z0-9'])`, "i");
  return re.test(` ${haystackNorm} `);
}

/** RULES.md 1.2 says a banned word counts in "any form (plural, past tense,
 *  -ing)". A literal match alone misses "moved the needle" against the
 *  banned phrase "move the needle" — caught by testing this checker against
 *  a real draft in marketing/ads/CONTROLS.md. This builds a form-tolerant regex
 *  for the FIRST word of a term (banned single words are always one word;
 *  banned phrases are almost always verb-led, e.g. "move the needle",
 *  "circle back", "unlock the power of") and matches the rest of the term
 *  literally after it. */
function findAnyForm(haystackNorm, termNorm) {
  const parts = termNorm.split(" ");
  const head = parts[0];
  const rest = parts.slice(1).join(" ");
  const headStem = /e$/.test(head) ? escapeRe(head.slice(0, -1)) + "(?:e|es|ed|ing)?" : escapeRe(head) + "(?:s|es|ed|ing)?";
  const tail = rest ? "\\s+" + escapeRe(rest) : "";
  const re = new RegExp(`(?:^|[^a-z0-9'])${headStem}${tail}(?:$|[^a-z0-9'])`, "i");
  return re.test(` ${haystackNorm} `);
}

function checkBannedWords(rows, sectionName) {
  const out = [];
  for (const row of rows) {
    const text = norm(row.text);
    for (const w of BANNED_WORDS) {
      if (findAnyForm(text, w)) out.push({ line: row.n, message: `banned word "${w}" (or a form of it) in the ${sectionName}. On the list in marketing/ads/rules-data.mjs — say it plainly instead.` });
    }
  }
  return out;
}

function checkBannedPhrases(rows, sectionName) {
  const out = [];
  const full = norm(joinText(rows));
  for (const p of BANNED_PHRASES) {
    if (findAnyForm(full, norm(p))) {
      const row = rows.find((r) => findAnyForm(norm(r.text), norm(p))) || rows[0];
      out.push({ line: row ? row.n : "?", message: `banned phrase "${p}" (or a form of it) in the ${sectionName}. Say it the way a person would.` });
    }
  }
  for (const p of AVOID_PHRASES) {
    if (ALLOWED_PHRASES.some((ok) => norm(p) === norm(ok))) continue; // never possible, but a hard guard against list mistakes
    /* FIXED 2026-09-07, found by adversarial review: this used to be a plain
       substring .includes(), the one list in the file checked that way — it
       fired on "fast and easygoing" and "cash advancement", neither of
       which is the phrase it was meant to catch. Switched to the same whole-
       word/phrase boundary logic every other list in this file already uses. */
    if (findWholePhrase(full, norm(p))) {
      const row = rows.find((r) => findWholePhrase(norm(r.text), norm(p))) || rows[0];
      out.push({ line: row ? row.n : "?", message: `avoid "${p}" in the ${sectionName} — the market has worn this one out (marketing/ads/ASSET-BANK.md section 8).` });
    }
  }
  return out;
}

function checkOpener(hookRows) {
  if (!hookRows || !hookRows.length) return [];
  const first = norm(hookRows[0].text);
  for (const o of BANNED_OPENERS) {
    if (first.startsWith(norm(o))) return [{ line: hookRows[0].n, message: `banned opener "${o}" — the hook may not start this way.` }];
  }
  return [];
}

function checkEmDash(rows, sectionName) {
  const out = [];
  for (const row of rows) {
    if (/[—]/.test(row.text) || / -- /.test(row.text)) {
      out.push({ line: row.n, message: `em dash in the ${sectionName}. Nobody says an em dash out loud.` });
    }
  }
  return out;
}

function checkNotXButY(rows, sectionName) {
  const out = [];
  for (const row of rows) {
    /* FIXED 2026-09-07, found by adversarial review: this used to also ban
       any plain "not X, but Y" contrast, which rejected the hook stem RULES.md
       3.3 recommended then — "Not another ___, but the first one that…" (cut
       from RULES.md 2026-10-05: it breaks Part 0 rule 15, which the judge
       checks) — and ordinary sentences like "not because they lack revenue, but
       because nobody read the file." The real AI tell is specifically
       "it's not X, it's Y", both sides anchored on "it's". A plain
       not-X-but-Y contrast is normal, useful writing and stays allowed. */
    if (/\bit'?s\s+not\s+[^,.!?]{1,60},?\s*it'?s\s+/i.test(row.text)) {
      out.push({ line: row.n, message: `"it's not X, it's Y" shape in the ${sectionName}. This is a tell. Say what it is, once.` });
    }
  }
  return out;
}

/** Never-say lines. NEVER_SAY_ALLOWED is checked first: a line that IS the
 *  required close (or a close-only fragment) can never trip a never-say
 *  rule, no matter how it overlaps in wording. */
/** Delete every allowed-phrase occurrence from the text before never-say
 *  patterns ever see it. FIXED 2026-09-07, found by adversarial review: the
 *  old guard just checked whether an allowed phrase appeared somewhere in
 *  the matched text, which had it backwards on a pattern with a wide window
 *  — "you can get $50,000, no obligation, ... it will land" let the inserted
 *  "no obligation" clause ride inside the matched span and then trip the
 *  guard, hiding a real guaranteed-dollar-amount violation. Stripping the
 *  allowed phrases out first means they can never sit inside a match window
 *  and never suppress one either. */
function stripAllowed(s) {
  let out = s;
  for (const ok of NEVER_SAY_ALLOWED) {
    out = out.replace(new RegExp(escapeRe(norm(ok)), "gi"), " ");
  }
  return out;
}

function checkNeverSay(rows, sectionName) {
  const out = [];
  const full = norm(joinText(rows));
  const stripped = stripAllowed(full);
  for (const entry of NEVER_SAY) {
    let hit = false;
    let matchedText = entry.text || "";
    if (entry.pattern) {
      const m = stripped.match(entry.pattern);
      if (m) { hit = true; matchedText = m[0]; }
    } else if (findWholePhrase(stripped, norm(entry.text))) {
      hit = true;
      matchedText = entry.text;
    }
    if (!hit) continue;
    const row = rows.find((r) => norm(stripAllowed(r.text)).includes(norm(matchedText))) || rows[0];
    out.push({ line: row ? row.n : "?", message: `never-say: "${entry.text}" in the ${sectionName}. ${entry.why}` });
  }
  return out;
}

function checkVendorNames(rows, sectionName) {
  const out = [];
  const full = norm(joinText(rows));
  for (const v of VENDOR_NAMES) {
    if (findWholePhrase(full, v)) out.push({ line: rows[0] ? rows[0].n : "?", message: `names a vendor ("${v}") in the ${sectionName}. Never the tech stack by name (marketing/ads/RULES.md 1.4) — call it "our system".` });
  }
  return out;
}

/** RULES.md 2.2 — cause-first. Two of the four checks are mechanical:
 *  check 2 (does the hook ask for anything) and check 3 (is the FIRST
 *  sentence a question). Checks 1 and 4 (does it name a cause, is the
 *  subject someone other than "us") need a person — RULES.md says so
 *  itself — so this only checks 2 and 3, and says so in the message. */
function checkCauseFirst(hookRows) {
  if (!hookRows || !hookRows.length) return [];
  const text = joinText(hookRows);
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const first = sentences[0] || text;
  const out = [];
  if (/\?\s*$/.test(first.trim())) {
    out.push({ line: hookRows[0].n, message: "cause-first check 3: the hook's first sentence is a question. Lead with the cause instead of asking one." });
  }
  /* FIXED 2026-09-07, found by adversarial review: the old check matched an
     ask word ANYWHERE in the sentence, which fired on "book" and "call"
     used as ordinary nouns or past-tense verbs about someone else — "the
     bank never called this a denial" and "the book they show you" both
     wrongly failed. A genuine ask is an imperative aimed at the reader, and
     that almost always leads the sentence (allowing one short filler word
     first, like "so" or "now"). Anchored to the start of the sentence
     instead of matched anywhere in it. */
  const askWords = /^(?:\s*(?:so|now|and|then|okay|ok)[,\s]+)?\s*(book|call|click|apply|sign up|schedule|fill out|get started|learn more)\b/i;
  if (askWords.test(first)) {
    out.push({ line: hookRows[0].n, message: "cause-first check 2: the hook asks for something in the first sentence. The hook indicts the alternative; the CTA asks." });
  }
  return out;
}

function checkClosePromises(closeRows, fullRows) {
  const rows = closeRows && closeRows.length ? closeRows : fullRows;
  if (!rows || !rows.length) return [{ line: "?", message: "no CLOSE found, and RULES.md 3.6 requires one carrying two promises. See marketing/ads/RULES.md 3.6." }];
  const full = norm(joinText(rows));
  const missing = CLOSE_PROMISES.filter((p) => !p.any.some((phrase) => full.includes(norm(phrase))));
  if (!missing.length) return [];
  return [{ line: rows[0].n, message: `the close is missing: ${missing.map((m) => m.name).join(", ")}. RULES.md 3.6 says the wording may vary but both promises must be present.` }];
}

/** RULES.md 3.14 — an evergreen ad may not contain anything that expires.
 *  Only run against a script whose TYPE line says "evergreen"; see the note
 *  on META_LABELS above for why. Not exhaustive — this catches the common,
 *  mechanical cases; a subtler staleness (an example that will feel dated in
 *  six months even with no literal date in it) still needs a person, the
 *  same way RULES.md 4.2 already admits for other judgement calls. */
function checkNoStale(rows, sectionName) {
  const out = [];
  const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
  const SEASONS = "spring|summer|fall|autumn|winter";
  const PATTERNS = [
    [new RegExp(`\\b(19|20)\\d{2}\\b`), "a specific year"],
    [new RegExp(`\\b(${MONTHS})\\b`, "i"), "a specific month"],
    [new RegExp(`\\b(${SEASONS})\\b`, "i"), "a season"],
    [/\bthis year\b/i, "\"this year\""],
    [/\bright now\b/i, "\"right now\""],
    [/\btoday only\b/i, "\"today only\""],
    [/\bthis week\b/i, "\"this week\""],
    [/\blimited spots?\b/i, "\"limited spots\""],
    [/\bbefore the deadline\b/i, "\"before the deadline\""],
    [/\binterest rates?\b/i, "a reference to interest rates"],
    [/\bsecured\b[^.!?]{0,40}\$[\d,]+|\$[\d,]+(?:\s*(?:million|k|thousand))?[^.!?]{0,40}\bsecured\b/i, "a client-count or revenue figure that will change (RULES.md 3.14 — leave the number to the cold ads)"]
  ];
  for (const row of rows) {
    for (const [re, label] of PATTERNS) {
      if (re.test(row.text)) out.push({ line: row.n, message: `evergreen ad contains ${label} in the ${sectionName}. RULES.md 3.14: an evergreen ad may not contain anything that expires.` });
    }
  }
  return out;
}

function checkWordCount(totalWords, band, runtimeLabel) {
  const out = [];
  if (totalWords < FLOOR_WORDS) {
    out.push({ line: "?", message: `too short. ${totalWords} words is under the ${FLOOR_WORDS}-word floor. Sixty seconds is the floor, no exceptions (owner-set 2026-09-01).` });
    return out;
  }
  if (!band) return out; // no declared band (unlabelled script) — floor already checked, nothing more to test
  if (totalWords < band.allowLow) out.push({ line: "?", message: `too short. ${totalWords} words for a ${runtimeLabel} runtime. RULES.md 2.1 wants ${band.low}-${band.high || "up"} words (allow down to ${band.allowLow}).` });
  if (band.allowHigh != null && totalWords > band.allowHigh) out.push({ line: "?", message: `too long. ${totalWords} words for a ${runtimeLabel} runtime. RULES.md 2.1 wants ${band.low}-${band.high} words (allow up to ${band.allowHigh}).` });
  return out;
}

function bandFor(runtimeText) {
  const t = norm(runtimeText || "");
  if (/60.?90/.test(t)) return WORD_COUNT_BANDS.short;
  if (/90.?120/.test(t)) return WORD_COUNT_BANDS.long;
  if (/2\s*min/.test(t) && !/vsl/.test(t)) return WORD_COUNT_BANDS.full;
  if (/vsl|5.?6\s*min|700|900/.test(t)) return WORD_COUNT_BANDS.vsl;
  return null;
}

// ---------------------------------------------------------------------------
// CHECKING ONE SCRIPT
// ---------------------------------------------------------------------------

/** checkOneScript(block) → { title, startLine, wordCount, failures: [{line, message}] } */
export function checkOneScript(block) {
  const parsed = parseBlock(block);
  const failures = [];

  if (parsed.mode === "labelled") {
    const s = parsed.sections;
    for (const label of SPOKEN_LABELS) {
      const rows = s[label] || [];
      failures.push(...checkBannedWords(rows, label));
      failures.push(...checkBannedPhrases(rows, label));
      failures.push(...checkEmDash(rows, label));
      failures.push(...checkNotXButY(rows, label));
      failures.push(...checkNeverSay(rows, label));
      failures.push(...checkVendorNames(rows, label));
    }
    /* FIXED 2026-09-07, found by adversarial review: a script with no HOOK
       section (or an empty one) used to skip the opener and cause-first
       checks entirely, since both took only s.HOOK and returned clean on
       nothing. Banned openers are otherwise only ever checked against the
       hook, so "Imagine a world where..." opening the BODY instead slipped
       through untouched. RULES.md 3.2 requires a HOOK, so a missing one is
       now its own failure, AND whatever the first real spoken content is
       (BODY, then CTA, then CLOSE) still gets the opener and cause-first
       checks run against it — a banned opener does not get a pass just for
       landing in the wrong section. */
    const openingRows = (s.HOOK && s.HOOK.length) ? s.HOOK
      : (s.BODY && s.BODY.length) ? s.BODY
      : (s.CTA && s.CTA.length) ? s.CTA
      : (s.CLOSE && s.CLOSE.length) ? s.CLOSE
      : null;
    if (!s.HOOK || !s.HOOK.length) {
      failures.push({ line: openingRows ? openingRows[0].n : "?", message: "no HOOK found. RULES.md 3.2 requires one — the first three seconds, verbatim." });
    }
    failures.push(...checkOpener(openingRows));
    failures.push(...checkCauseFirst(openingRows));
    failures.push(...checkClosePromises(s.CLOSE, null));
    /* FIXED 2026-09-07, found by adversarial review: a body sentence that
       happened to start a line with the capitalized word "TAG" (e.g. "TAG
       teams of closers used to split this work...") got parsed as the TAG
       label, and its ordinary-English content satisfied the "TAG is
       present" check with no real origin_angle anywhere in the script. A
       real tag is a slug — lower case, digits and underscores, no spaces —
       exactly like RULES.md 3.2's own example, "denial_angle". Anything
       else is treated as not a real tag, so a coincidental match cannot
       pass this check. */
    const tagText = joinText(s.TAG).trim();
    const isRealSlug = /^[a-z][a-z0-9_]{1,48}$/.test(tagText);
    if (!tagText) {
      failures.push({ line: "?", message: "no TAG. origin_angle is not optional — RULES.md 3.2." });
    } else if (!isRealSlug) {
      failures.push({ line: s.TAG[0].n, message: `TAG "${tagText}" does not look like a real origin_angle slug (lower case, digits, underscores only — e.g. "denial_angle"). RULES.md 3.2.` });
    }

    const spokenRows = SPOKEN_LABELS.flatMap((l) => s[l] || []);
    const isEvergreen = /evergreen/i.test(joinText(s.TYPE));
    if (isEvergreen) failures.push(...checkNoStale(spokenRows, "script"));

    const totalWords = countWords(joinText(spokenRows));
    const band = bandFor(joinText(s.RUNTIME));
    failures.push(...checkWordCount(totalWords, band, joinText(s.RUNTIME) || "(no RUNTIME line)"));

    return { title: block.title, startLine: block.startLine, wordCount: totalWords, failures };
  }

  // Unlabelled — the shape marketing/ads/CONTROLS.md is actually written in.
  const rows = parsed.sections.FULL;
  failures.push(...checkBannedWords(rows, "script"));
  failures.push(...checkBannedPhrases(rows, "script"));
  failures.push(...checkEmDash(rows, "script"));
  failures.push(...checkNotXButY(rows, "script"));
  failures.push(...checkNeverSay(rows, "script"));
  failures.push(...checkVendorNames(rows, "script"));
  const hookRows = rows.slice(0, 2); // first couple of lines stand in for the hook when nothing is labelled
  failures.push(...checkOpener(hookRows));
  failures.push(...checkCauseFirst(hookRows));
  failures.push(...checkClosePromises(null, rows));
  const totalWords = countWords(joinText(rows));
  failures.push(...checkWordCount(totalWords, null, "(unlabelled)"));

  return { title: block.title, startLine: block.startLine, wordCount: totalWords, failures };
}

// ---------------------------------------------------------------------------
// CHECKING ONE SCRIPT AS PLAIN TEXT — checkScriptText (spec 7.1)
//
// The app's writer and Chris's edits hand over a script as teleprompter text:
// plain paragraphs, CAPS to punch, ↑ for pitch up, a blank line for a pause,
// and in the bullets style "- " cue lines. No HOOK/BODY labels, no headings.
//
//   checkScriptText(text, { format, style, strict, parts?, bannedLive? })
//     -> { ok, failures: [{ rule, match, message, line }], warnings, words }
//
//   format     standard | sorting | long | notes | greenscreen | vsl
//   style      words | bullets (default: DEFAULT_STYLE[format])
//   strict     true adds RULES.md Part 0's patterns and banned-live.json
//   parts      optional [{kind: hook|line2|body|cue|reveal|cta, text}]
//              (ad_scripts.parts, spec 7.4). When sent, the bullets shape
//              is read from it instead of from the text.
//   bannedLive optional array of phrases, used instead of reading
//              marketing/ads/banned-live.json (for a copy read at a git sha).
//
// `line` is the 1-based line in `text`, or null when a match spans lines.
// ---------------------------------------------------------------------------

// A cue line in the bullets style starts with a bullet mark.
const CUE_MARK_RE = /^(?:[-*•·]|\d{1,2}[.)])\s+/;

const splitSentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

function firstQuoted(message) {
  const m = message.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

/** Name the rule behind one of the old checks' messages. */
function ruleOfMessage(message) {
  const table = [
    [/^banned word/, "banned-word"],
    [/^banned phrase/, "banned-phrase"],
    [/^avoid /, "avoid-phrase"],
    [/^banned opener/, "opener"],
    [/^em dash/, "em-dash"],
    [/^"it's not X, it's Y"/, "not-x-its-y"],
    [/^never-say/, "never-say"],
    [/^names a vendor/, "vendor-name"],
    [/^cause-first check 2/, "cause-first-2"],
    [/^cause-first check 3/, "cause-first-3"],
    [/^the close is missing|^no CLOSE found/, "close-promises"]
  ];
  for (const [re, rule] of table) if (re.test(message)) return rule;
  return "check";
}

function fromOldCheck(list) {
  return list.map((f) => {
    const rule = ruleOfMessage(f.message);
    const match = rule === "em-dash" ? "—" : rule === "close-promises" ? null : firstQuoted(f.message);
    return { rule, match, message: f.message, line: typeof f.line === "number" ? f.line : null };
  });
}

/** Where strict mode reads Chris's banned phrases. A copy beside this file
 *  first (the repo, or a bundle that keeps the folder layout), then the same
 *  path under the working directory (Netlify included_files). */
const BANNED_LIVE_PATH = "marketing/ads/banned-live.json";

function bannedLiveCandidates() {
  const out = [];
  try { out.push(fileURLToPath(new URL("../../marketing/ads/banned-live.json", import.meta.url))); } catch { /* no module URL */ }
  try { out.push(join(process.cwd(), BANNED_LIVE_PATH)); } catch { /* no working directory */ }
  return out;
}

/** -> { phrases: string[], warning: string|null }. Never throws. */
export function loadBannedLive(paths = bannedLiveCandidates()) {
  for (const p of paths) {
    let raw;
    try { raw = readFileSync(p, "utf8"); } catch { continue; }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { phrases: [], warning: `${BANNED_LIVE_PATH} is not a JSON list, so Chris's banned phrases were not checked.` };
      return { phrases: parsed.filter((x) => typeof x === "string" && x.trim()), warning: null };
    } catch {
      return { phrases: [], warning: `${BANNED_LIVE_PATH} is not valid JSON, so Chris's banned phrases were not checked.` };
    }
  }
  return { phrases: [], warning: `${BANNED_LIVE_PATH} could not be read, so Chris's banned phrases were not checked.` };
}

function globalCopy(re) {
  return new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
}

/** RULES.md Part 0 patterns. Normalized patterns read the whole text, so a
 *  phrase broken across two lines is still caught. */
function checkPart0(rows) {
  const out = [];
  const seen = new Set();
  const fullNorm = norm(rows.map((r) => r.text).join("\n"));
  for (const p of PART0_PATTERNS) {
    const hits = [];
    if (p.on === "raw") {
      for (const r of rows) for (const m of r.text.matchAll(globalCopy(p.pattern))) hits.push({ match: m[0], line: r.n });
    } else {
      for (const m of fullNorm.matchAll(globalCopy(p.pattern))) {
        const row = rows.find((r) => globalCopy(p.pattern).test(norm(r.text)) && norm(r.text).includes(m[0]));
        hits.push({ match: m[0], line: row ? row.n : null });
      }
    }
    for (const h of hits) {
      const key = `${p.id}|${h.match.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: `part0-${p.rule}`,
        match: h.match,
        message: `Part 0 rule ${p.rule}: "${h.match}". ${p.fix}`,
        line: h.line
      });
    }
  }
  return out;
}

function checkBannedLive(rows, phrases) {
  const out = [];
  const fullNorm = norm(rows.map((r) => r.text).join("\n"));
  for (const phrase of phrases) {
    const p = norm(phrase);
    if (!p || !findWholePhrase(fullNorm, p)) continue;
    const row = rows.find((r) => findWholePhrase(norm(r.text), p));
    out.push({
      rule: "banned-live",
      match: phrase,
      message: `"${phrase}" is a phrase Chris banned from the app (${BANNED_LIVE_PATH}). Say it another way.`,
      line: row ? row.n : null
    });
  }
  return out;
}

const PART_NAMES = { hook: "the hook", line2: "line 2", reveal: "the reveal", cta: "the CTA" };

/** The bullets shape (spec 7.1): the hook, line 2, reveal and CTA word for
 *  word, plus min..max cues of maxWords or fewer. Reads `parts` when the
 *  caller has them; otherwise reads the text: the words before the first cue
 *  are the hook (sentence 1) and line 2 (sentence 2), the words after the
 *  last cue are the reveal and then the CTA (its last sentence). */
function checkBulletsShape(rows, parts, cueRule) {
  const out = [];
  let present;
  let cues;
  if (Array.isArray(parts)) {
    const has = (kind) => parts.some((p) => p && p.kind === kind && String(p.text || "").trim());
    present = { hook: has("hook"), line2: has("line2"), reveal: has("reveal"), cta: has("cta") };
    cues = parts.filter((p) => p && p.kind === "cue").map((p) => ({ text: String(p.text || "").trim(), line: null }));
  } else {
    const cueIdx = rows.map((r, i) => (r.cue ? i : -1)).filter((i) => i >= 0);
    cues = cueIdx.map((i) => ({ text: rows[i].text, line: rows[i].n }));
    const before = cueIdx.length ? rows.slice(0, cueIdx[0]) : rows;
    const after = cueIdx.length ? rows.slice(cueIdx[cueIdx.length - 1] + 1) : [];
    const pre = splitSentences(joinText(before.filter((r) => !r.cue)));
    const post = splitSentences(joinText(after.filter((r) => !r.cue)));
    present = { hook: pre.length >= 1, line2: pre.length >= 2, reveal: post.length >= 2, cta: post.length >= 1 };
  }
  for (const kind of ["hook", "line2", "reveal", "cta"]) {
    if (!present[kind]) {
      out.push({ rule: "bullets-shape", match: null, line: null, message: `bullets style is missing ${PART_NAMES[kind]}, word for word. A standard bullets script is the hook, line 2, 3-8 cues, the reveal and the CTA.` });
    }
  }
  if (cues.length < cueRule.min || cues.length > cueRule.max) {
    out.push({ rule: "bullets-shape", match: String(cues.length), line: null, message: `bullets style has ${cues.length} cue${cues.length === 1 ? "" : "s"}. It needs ${cueRule.min} to ${cueRule.max}.` });
  }
  for (const c of cues) {
    const n = countWords(c.text);
    if (n > cueRule.maxWords) {
      out.push({ rule: "bullets-shape", match: c.text, line: c.line, message: `a cue has ${n} words. Each cue is ${cueRule.maxWords} words or fewer.` });
    }
  }
  return out;
}

/** checkScriptText(text, {format, style, strict, parts?, bannedLive?})
 *  -> { ok, failures: [{rule, match, message, line}], warnings: [{rule, message}], words } */
export function checkScriptText(text, options = {}) {
  const opts = options || {};
  const strict = opts.strict === true;
  const format = typeof opts.format === "string" && opts.format.trim() ? opts.format.trim().toLowerCase() : null;
  const known = format && SCRIPT_FORMATS.includes(format);
  const style = typeof opts.style === "string" && opts.style.trim()
    ? opts.style.trim().toLowerCase()
    : (known ? DEFAULT_STYLE[format] : "words");
  const failures = [];
  const warnings = [];

  // One row per non-blank line. The ↑ mark is dropped and a cue's bullet
  // mark is cut off, so neither is read as a word.
  const rows = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const t = line.replace(/↑/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return;
    const cue = CUE_MARK_RE.test(t);
    rows.push({ n: i + 1, text: cue ? t.replace(CUE_MARK_RE, "").trim() : t, cue });
  });
  const spoken = rows.filter((r) => r.text);
  const words = countWords(joinText(spoken));

  if (!spoken.length) {
    failures.push({ rule: "empty", match: null, line: null, message: "the script is empty." });
    return { ok: false, failures, warnings, words };
  }

  // The checks every script gets (RULES.md Part 1 and 2.2), the same ones
  // checkOneScript runs.
  failures.push(...fromOldCheck(checkBannedWords(spoken, "script")));
  failures.push(...fromOldCheck(checkBannedPhrases(spoken, "script")));
  failures.push(...fromOldCheck(checkEmDash(spoken, "script")));
  failures.push(...fromOldCheck(checkNotXButY(spoken, "script")));
  failures.push(...fromOldCheck(checkNeverSay(spoken, "script")));
  failures.push(...fromOldCheck(checkVendorNames(spoken, "script")));
  const hookRows = spoken.slice(0, 2);
  failures.push(...fromOldCheck(checkOpener(hookRows)));
  for (const f of fromOldCheck(checkCauseFirst(hookRows))) {
    f.match = splitSentences(joinText(hookRows))[0] || null;
    failures.push(f);
  }

  // Floors by format, and the close check on standard and sorting only.
  const formatRule = known ? FORMAT_RULES[format] : null;
  if (!format) {
    warnings.push({ rule: "format", message: "no format was given, so no length check and no close check ran." });
  } else if (!known) {
    warnings.push({ rule: "format", message: `"${format}" is not a format this checker knows (${SCRIPT_FORMATS.join(", ")}), so no length check and no close check ran.` });
  }
  if (formatRule && formatRule.closePromises) {
    failures.push(...fromOldCheck(checkClosePromises(null, spoken)));
  }
  const floor = formatRule ? formatRule[style] : null;
  if (floor && floor.minWords != null && words < floor.minWords) {
    failures.push({ rule: "length", match: String(words), line: null, message: `too short. ${words} words for a ${format} ${style} script. It needs ${floor.maxWords != null ? `${floor.minWords}-${floor.maxWords}` : `${floor.minWords} or more`}.` });
  }
  if (floor && floor.maxWords != null && words > floor.maxWords) {
    failures.push({ rule: "length", match: String(words), line: null, message: `too long. ${words} words for a ${format} ${style} script. It needs ${floor.minWords}-${floor.maxWords}.` });
  }
  if (floor && floor.cues) {
    failures.push(...checkBulletsShape(rows, opts.parts, floor.cues));
  }

  // Strict mode: Chris's rules and the phrases he banned from the app.
  if (strict) {
    failures.push(...checkPart0(spoken));
    let phrases;
    if (Array.isArray(opts.bannedLive)) {
      phrases = opts.bannedLive.filter((x) => typeof x === "string" && x.trim());
    } else {
      const loaded = loadBannedLive();
      phrases = loaded.phrases;
      if (loaded.warning) warnings.push({ rule: "banned-live", message: loaded.warning });
    }
    failures.push(...checkBannedLive(spoken, phrases));
  }

  return { ok: failures.length === 0, failures, warnings, words };
}

// ---------------------------------------------------------------------------
// FILES AND THE CLI
// ---------------------------------------------------------------------------

export function loadRules() {
  // Kept for callers that want the raw lists without re-importing the module
  // path themselves.
  return {
    BANNED_WORDS, BANNED_PHRASES, BANNED_OPENERS,
    AVOID_PHRASES, ALLOWED_PHRASES,
    NEVER_SAY, NEVER_SAY_ALLOWED, CLOSE_PROMISES,
    WORD_COUNT_BANDS, FLOOR_WORDS, VENDOR_NAMES,
    PART0_PATTERNS, SCRIPT_FORMATS, DEFAULT_STYLE, FORMAT_RULES
  };
}

function checkFile(path, text) {
  const blocks = splitBlocks(text);
  const results = blocks.map(checkOneScript);
  return { path, results };
}

function printHelp() {
  console.log([
    "check-script.mjs — the fast pass on an ad script, before a human reads it.",
    "",
    "  node scripts/ads/check-script.mjs file.md [file2.md ...]",
    "  cat draft.md | node scripts/ads/check-script.mjs --stdin",
    "  npm run ads:check -- file.md",
    "",
    "Reads rules from marketing/ads/rules-data.mjs. Exits 0 if every script in every",
    "file passes, 1 otherwise. Accepts both the labelled HOOK/BODY/CTA/CLOSE",
    "format and the plain-paragraph format used in marketing/ads/CONTROLS.md."
  ].join("\n"));
  return 0;
}

export function main(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return printHelp();

  const useStdin = argv.includes("--stdin");
  const files = argv.filter((a) => a !== "--stdin");

  const inputs = [];
  if (useStdin) {
    inputs.push({ path: "(stdin)", text: readFileSync(0, "utf8") });
  }
  for (const f of files) {
    inputs.push({ path: f, text: readFileSync(f, "utf8") });
  }
  if (!inputs.length) return printHelp();

  let anyFail = false;
  let totalScripts = 0;
  let failedScripts = 0;

  for (const { path, text } of inputs) {
    const { results } = checkFile(path, text);
    if (!results.length) {
      console.log(`${path} — no scripts found (no headed block with text under it).`);
      continue;
    }
    totalScripts += results.length;
    const failing = results.filter((r) => r.failures.length);
    failedScripts += failing.length;
    console.log(`\n${path} — ${results.length} script${results.length === 1 ? "" : "s"} checked, ${failing.length} need${failing.length === 1 ? "s" : ""} work.`);
    for (const r of results) {
      if (!r.failures.length) continue;
      anyFail = true;
      console.log(`\n  "${r.title}" (starts line ${r.startLine}, ${r.wordCount} words)`);
      for (const f of r.failures) console.log(`    line ${f.line}: ${f.message}`);
    }
  }

  console.log(
    anyFail
      ? `\n${failedScripts} of ${totalScripts} script${totalScripts === 1 ? "" : "s"} needs work. Fix and run this again. Nothing goes to Chris until this exits clean.`
      : `\nAll ${totalScripts} script${totalScripts === 1 ? "" : "s"} clean.`
  );

  return anyFail ? 1 : 0;
}

// Only run as a CLI when this file is executed directly — not when a test
// imports checkOneScript, loadRules or main.
const isDirectRun = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isDirectRun) process.exit(main(process.argv.slice(2)));
