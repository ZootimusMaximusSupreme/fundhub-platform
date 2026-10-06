// @ts-check
// src/marketing/writer-prompt.mjs — the words the script writer sends to Claude.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.6 "The prompt":
//   System (cached, read at the batch's rules_sha): Part 0 and Parts 1-4 of RULES.md,
//     VOICE.md, the format's recipe, the catalog, the angle list.
//   User: the slot (the funnel, what its landing page does, the offer facts, and whether
//     it is book-a-call), the angle, Chris's points word for word, the last 30 hooks to
//     avoid, the 3 closest approved scripts with the same format and funnel.
//
// PURE. Every input is handed in by src/marketing/writer.mjs; this file reads no file,
// no database and no network, so a test can see the exact words that would be sent.
//
// NO PRICE IS TYPED HERE. A price reaches the prompt only through offerFacts()
// (src/marketing/offer-facts.mjs), which reads it from the file that owns it. A
// book-a-call slot gets no price at all: Appendix A rule 29, "Book-a-call ads never
// mention a price." src/marketing/offer-facts.test.mjs fails if a price is typed into
// src/marketing/.
//
// CACHING. The system prompt is one text block marked for the 5-minute cache by
// callModel({cache:true}). It holds nothing that changes from slot to slot except the
// format's recipe, so every slot of one format in a batch reads the same cached prefix.
// The slot, the hooks to avoid and the examples go in the user turn, after the cache.

import { SCRIPT_FORMATS, STYLES } from "./animation-plan.mjs";

/** The kinds a part of the body may be (ad_scripts.parts, migration 413). */
export const PART_KINDS = Object.freeze(["hook", "line2", "body", "cue", "reveal", "cta"]);

/* The lanes a script may carry: the ad_lane enum (286, plus 'slo' from 406) without
   'unknown', which means "garbage arrived on the wire" and is never a choice. */
export const SCRIPT_LANES = Object.freeze(["funding600", "premium", "sorting", "uwiq", "wl", "slo"]);

/**
 * The rules the judge checks (spec §7.6 check loop step 2): Appendix A rules 13 to 34,
 * plus the three that depend on context and so are not patterns: "carry" (rule 3),
 * "round two" (rule 9) and "man" (rule 12).
 */
export const JUDGED_RULES = Object.freeze([3, 9, 12, ...Array.from({ length: 22 }, (_, i) => 13 + i)]);

export { SCRIPT_FORMATS, STYLES };

const PART0_HEADING = /^# PART 0\b.*$/m;
const PART1_HEADING = /^# PART 1\b.*$/m;
const CHANGING_HEADING = /^## Changing this file\s*$/m;

/**
 * RULES.md from Part 0 through Part 4 (the file's own preamble and its "Changing this
 * file" note are left out). The whole file when the headings cannot be found, so a
 * renamed heading never sends Claude nothing.
 * @param {string} rulesMd
 */
export function rulesForPrompt(rulesMd) {
  const text = String(rulesMd ?? "");
  const start = text.search(PART0_HEADING);
  if (start < 0) return text.trim();
  const rest = text.slice(start);
  const end = rest.search(CHANGING_HEADING);
  return (end > 0 ? rest.slice(0, end) : rest).trim();
}

/**
 * RULES.md Part 0 only (Chris's rules, Appendix A word for word). The whole file when
 * the headings cannot be found.
 * @param {string} rulesMd
 */
export function part0Of(rulesMd) {
  const text = String(rulesMd ?? "");
  const start = text.search(PART0_HEADING);
  if (start < 0) return text.trim();
  const rest = text.slice(start);
  const end = rest.search(PART1_HEADING);
  return (end > 0 ? rest.slice(0, end) : rest).replace(/\n-{3,}\s*$/g, "").trim();
}

/* RECIPES.md is Appendix B: blocks that each open with a bold line. Which blocks belong
   to which format. "Every format" always goes in. */
const RECIPE_BLOCKS = Object.freeze({
  standard: [/^\*\*Standard ad\b/i, /^\*\*Words-style standard ad\b/i],
  sorting: [/^\*\*Sorting-hat short\b/i],
  long: [/^\*\*Long ad\b/i],
  notes: [/^\*\*Notes and green screen\b/i],
  greenscreen: [/^\*\*Notes and green screen\b/i],
  vsl: [/^\*\*VSL\b/i]
});

/**
 * The recipe for one format: RECIPES.md's "Every format" block and the format's own
 * block(s). The whole file when the format is unknown or its block cannot be found.
 * @param {string} recipesMd
 * @param {string} format
 */
export function recipeFor(recipesMd, format) {
  const text = String(recipesMd ?? "");
  const matchers = Object.prototype.hasOwnProperty.call(RECIPE_BLOCKS, format)
    ? RECIPE_BLOCKS[/** @type {keyof typeof RECIPE_BLOCKS} */ (format)]
    : null;
  if (!matchers) return text.trim();
  /** @type {string[][]} */
  const blocks = [];
  for (const line of text.split("\n")) {
    if (/^\*\*/.test(line) || blocks.length === 0) blocks.push([]);
    blocks[blocks.length - 1].push(line);
  }
  const every = blocks.filter((b) => /^\*\*Every format\b/i.test(b[0] || ""));
  const mine = blocks.filter((b) => matchers.some((re) => re.test(b[0] || "")));
  if (!mine.length) return text.trim();
  return [...every, ...mine].map((b) => b.join("\n").trim()).join("\n\n");
}

const secondsOf = (frames, fps) => Math.round((Number(frames) / Number(fps)) * 100) / 100;

/**
 * The animation catalog as lines Claude can read: id, length in seconds, whether it is
 * data-tied, what it is for, and the prop keys it takes.
 * @param {any[]} catalog marketing/broll/catalog.json
 */
export function catalogForPrompt(catalog) {
  const list = Array.isArray(catalog) ? catalog : [];
  return list
    .filter((e) => e && typeof e.id === "string")
    .map((e) => {
      const range = `${secondsOf(e.min_frames, e.fps)}-${secondsOf(e.max_frames, e.fps)} s`;
      if (e.data_tied === true) {
        return `- ${e.id} (${range}, DATA-TIED: props must be "{}"): ${e.purpose || ""}`.trim();
      }
      const props = e.default_props && typeof e.default_props === "object" ? JSON.stringify(e.default_props) : "{}";
      return `- ${e.id} (${range}): ${e.purpose || ""} Default props: ${props}`;
    })
    .join("\n");
}

/**
 * The angle list as lines: key, name, notes.
 * @param {any[]} angles marketing/ads/angles.json
 */
export function anglesForPrompt(angles) {
  const list = Array.isArray(angles) ? angles : [];
  return list
    .filter((a) => a && typeof a.key === "string")
    .map((a) => `- ${a.key}: ${a.name || a.key}. ${String(a.notes || "").replace(/\s+/g, " ").trim()}`.trim())
    .join("\n");
}

const WRITER_INSTRUCTIONS = `You write ad scripts for Fundhub. Chris Stanbridge reads them on a teleprompter and films them. Each request asks for ONE script. Answer only with the JSON the response format asks for.

Read all of the reference below before you write. RULES.md Part 0 is Chris's own rules and wins over everything else in it. VOICE.md shows how Chris really talks: lines an AI wrote next to the lines Chris used instead. The recipe is the shape of this format. The animation catalog lists the only animations that exist. The angle list is the angles we run.

How to fill each field:
- title: the angle's name, or a short plain name for a new angle.
- angle_key: the key from the angle list. When the slot names no angle and none fits, propose a new angle with a new key in lower case with underscores.
- hook_key: a short key for this hook in lower case with underscores, like lenders_read_two_files.
- offer_key, lane, script_format, style: copy the values the slot gives you.
- body: the teleprompter text. Delivery marks: CAPS = punch the word, a blank line = pause, and an up arrow (↑) = pitch goes up, written as its own word. Plain text with blank lines between paragraphs, not after every sentence.
  - words style: full, flowing sentences in paragraphs.
  - bullets style: the hook and line 2 word for word, then each cue on its own line starting with "- " (12 words or fewer), then the reveal and the call to action word for word.
- parts: every piece of the body in order, as {kind, text}. kind is one of hook, line2, body, cue, reveal, cta. Copy each text from the body word for word (a cue without its "- "). Every script has a hook part and a cta part.
- meta_copy: the words on the Meta ad. The first line of primary_text must work before "See more". headline is 40 characters or fewer. cta_type is the button the slot names. Every rule that applies to the script applies here too.
- animation_plan: at least one animation, plus one for each number, step or comparison. A standard ad needs at least 2.
  - template: an id from the animation catalog, and nothing else.
  - props: a JSON object written as text, like "{}" or "{\\"eyebrow\\":\\"What lenders see\\"}". Use only keys from that template's default props. A DATA-TIED template takes "{}" and nothing else: it shows only its own real files, never a number or a name you send.
  - seconds: inside that template's range.
  - anchor: words style: {"phrase": "words copied exactly from the body", "cue": null, "keyword": null}. Bullets style: {"phrase": null, "cue": the cue's number counting cues from 1, "keyword": "a word from that cue"}.

Before you answer, check the script against RULES.md Part 4.1, the things a machine checks. A script that fails them comes back to you.`;

/**
 * The cached system prompt (spec §7.6): the writer's instructions, RULES.md Part 0 to
 * Part 4, VOICE.md, the format's recipe, the animation catalog and the angle list.
 * @param {{ rules: string, voice: string, recipes: string, catalog: any[], angles: any[], format: string }} input
 */
export function buildSystemPrompt({ rules, voice, recipes, catalog, angles, format }) {
  return [
    WRITER_INSTRUCTIONS,
    "=== RULES.md ===",
    rulesForPrompt(rules),
    "=== VOICE.md ===",
    String(voice ?? "").trim(),
    `=== RECIPE: ${format} ===`,
    recipeFor(recipes, format),
    "=== ANIMATION CATALOG (marketing/broll/catalog.json) ===",
    catalogForPrompt(catalog),
    "=== ANGLE LIST (marketing/ads/angles.json) ===",
    anglesForPrompt(angles)
  ].join("\n\n");
}

/**
 * Integer cents → dollars with a thousands comma and no ".00" when it is whole. null when
 * the price is unknown (never "$0").
 * @param {number|null|undefined} cents
 */
export function formatPrice(cents) {
  if (!Number.isInteger(cents) || /** @type {number} */ (cents) < 0) return null;
  const c = /** @type {number} */ (cents);
  const dollars = Math.floor(c / 100).toLocaleString("en-US");
  const rest = c % 100;
  return rest ? `$${dollars}.${String(rest).padStart(2, "0")}` : `$${dollars}`;
}

/**
 * What the slot's offer lets the script say. A book-a-call offer gives no price.
 * @param {{ offer: { key: string, label: string, price_cents: number|null, book_call: boolean } | null,
 *           funnel: { book_call?: boolean } | null }} input
 * @returns {{ bookCall: boolean, price: string|null, lines: string[] }}
 */
export function offerBlock({ offer, funnel }) {
  const bookCall = !!(funnel && funnel.book_call) || !!(offer && offer.book_call);
  const lines = [];
  if (offer) lines.push(`Offer: ${offer.label} (offer_key ${offer.key}).`);
  else lines.push("Offer: not named for this funnel. Do not name an offer or a price.");
  if (bookCall) {
    lines.push("This is a book-a-call ad. On the landing page they book a call. Never say a price anywhere in the script or the Meta copy (rule 29).");
    return { bookCall, price: null, lines };
  }
  const price = offer ? formatPrice(offer.price_cents) : null;
  if (offer && price) {
    lines.push(`On the landing page they buy the ${offer.label} for ${price}. If the ad says a price, it is ${price}. Never say any other price for it. An older script that shows another price is out of date.`);
  } else if (offer) {
    lines.push(`On the landing page they buy the ${offer.label}. Its price is not known here, so do not say one.`);
  }
  return { bookCall, price, lines };
}

/** @param {unknown} s */
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * The intro this script may use (rule 31), from what the batch has already used.
 * @param {{ long_used: number, short_used: number, long_cap: number, short_cap: number } | null} intro
 */
export function introAllowance(intro) {
  if (!intro) return "Follow rule 31: the full intro only where Chris is the proof, a short one on some, none on others.";
  const longLeft = Math.max(0, intro.long_cap - intro.long_used);
  const shortLeft = Math.max(0, intro.short_cap - intro.short_used);
  const can = [];
  if (longLeft > 0) can.push(`the long intro ("My name is Chris", ${longLeft} left in this batch) where Chris is the proof`);
  if (shortLeft > 0) can.push(`the short intro ("I'm Chris, I run Fundhub", ${shortLeft} left)`);
  const cannot = [];
  if (!longLeft) cannot.push("the long intro");
  if (!shortLeft) cannot.push("the short intro");
  return [
    "Follow rule 31.",
    can.length ? `You may use ${can.join(", or ")}, or no intro.` : "Use no intro.",
    cannot.length ? `This batch has used all of ${cannot.join(" and ")}.` : ""
  ].filter(Boolean).join(" ");
}

/**
 * @typedef {{
 *   slot: { n?: number|null, funnel_key: string, script_format: string, style?: string|null,
 *           source?: string|null, angle_key?: string|null, reason?: string|null },
 *   style: string,
 *   funnel: { key: string, name?: string|null, landing_url?: string|null, lane?: string|null,
 *             book_call?: boolean, cta_type?: string|null } | null,
 *   offer: { key: string, label: string, price_cents: number|null, book_call: boolean } | null,
 *   angle: { key: string, name?: string, notes?: string } | null,
 *   angleKey?: string|null,
 *   idea: { raw_points?: string|null, topic?: string|null } | null,
 *   recentHooks?: string[],
 *   batchUsed?: { hooks: string[], ctas: string[] },
 *   intro?: { long_used: number, short_used: number, long_cap: number, short_cap: number } | null,
 *   examples?: Array<{ title?: string|null, body: string }>
 * }} SlotPromptInput
 */

/**
 * The facts every request carries: format, style, funnel, landing page, lane, offer,
 * Meta button.
 * @param {SlotPromptInput} input
 */
function slotFacts({ slot, style, funnel, offer }) {
  const f = funnel || /** @type {any} */ ({});
  const o = offerBlock({ offer, funnel });
  return [
    `Format (script_format): ${slot.script_format}. Style: ${style}.`,
    `Funnel: ${f.name || slot.funnel_key} (${slot.funnel_key}). Landing page: ${f.landing_url || "not set"}.`,
    `Lane: ${f.lane || "not set"}.`,
    ...o.lines,
    `Meta button (meta_copy.cta_type): ${f.cta_type || "LEARN_MORE"}.`
  ];
}

/** @param {SlotPromptInput} input */
function avoidLines({ recentHooks = [], batchUsed }) {
  const out = [];
  const usedHooks = (batchUsed?.hooks || []).map(oneLine).filter(Boolean);
  const usedCtas = (batchUsed?.ctas || []).map(oneLine).filter(Boolean);
  if (usedHooks.length || usedCtas.length) {
    out.push("", "Already used in this batch. Use none of these hooks or calls to action:");
    for (const h of usedHooks) out.push(`- hook: ${h}`);
    for (const c of usedCtas) out.push(`- CTA: ${c}`);
  }
  const hooks = recentHooks.map(oneLine).filter(Boolean);
  if (hooks.length) {
    out.push("", `Hooks from the last ${hooks.length === 1 ? "script" : `${hooks.length} scripts`}. Do not repeat or lightly reword any of them:`);
    for (const h of hooks) out.push(`- ${h}`);
  }
  return out;
}

/** @param {SlotPromptInput} input */
function exampleLines({ examples = [] }) {
  if (!examples.length) {
    return ["", "There are no approved scripts with this format and funnel yet."];
  }
  const out = ["", `The ${examples.length} closest approved script${examples.length === 1 ? "" : "s"} with this format and funnel. Match the quality. Never copy a line:`];
  examples.forEach((e, i) => {
    out.push("", `--- Example ${i + 1}${e.title ? `: ${oneLine(e.title)}` : ""} ---`, String(e.body ?? "").trim());
  });
  return out;
}

/**
 * The user turn for one slot of a batch.
 * @param {SlotPromptInput} input
 */
export function buildUserPrompt(input) {
  const { slot, angle, idea, intro } = input;
  const lines = ["WRITE ONE SCRIPT FOR THIS SLOT", ""];
  lines.push(`Slot ${slot.n ?? "?"} of this batch.${slot.reason ? ` Why this slot: ${oneLine(slot.reason)}` : ""}`);
  lines.push(...slotFacts(input));
  lines.push("");
  if (angle) {
    lines.push(`Angle: ${angle.key} (${angle.name || angle.key}).`);
  } else if (input.angleKey) {
    lines.push(`Angle: ${input.angleKey}. It is not in the angle list yet; write it as a new angle with that key.`);
  } else {
    lines.push("No angle was picked. Pick the angle from the angle list that fits Chris's points best, or propose a new one.");
  }
  if (slot.source === "follow_money") {
    lines.push("This is a new version of an angle that is spending. Write a new hook AND a new body. Never put a new hook on a running ad's body (rule 34).");
  }
  const points = String(idea?.raw_points ?? "").trim();
  if (points) {
    lines.push("", "Chris's points, word for word:", '"""', points, '"""');
    if (idea?.topic) lines.push(`Chris's topic: ${oneLine(idea.topic)}`);
    if (slot.script_format === "long") lines.push("Keep every point, in his order and in his words. Never cut them down (rule 44).");
  }
  lines.push("", `Intro: ${introAllowance(intro ?? null)}`);
  lines.push(...avoidLines(input));
  lines.push(...exampleLines(input));
  return lines.join("\n");
}

/**
 * @typedef {SlotPromptInput & {
 *   script: { version: number, title?: string|null, body: string, parts?: any,
 *             meta_copy?: any, animation_plan?: any },
 *   note: string
 * }} FixPromptInput
 */

/**
 * The user turn for a fix: Chris's note, word for word, and the script as it is now.
 * @param {FixPromptInput} input
 */
export function buildFixPrompt(input) {
  const { script, note } = input;
  const current = {
    title: script.title ?? null,
    body: script.body,
    parts: script.parts ?? null,
    meta_copy: script.meta_copy ?? null,
    animation_plan: script.animation_plan ?? null
  };
  const lines = [
    "REWRITE THIS SCRIPT FROM CHRIS'S NOTE",
    "",
    "Chris's note, word for word:",
    '"""',
    String(note ?? "").trim(),
    '"""',
    "Do what the note asks. Keep everything else that is not broken. Chris's word beats every rule (Part 0, rule 0).",
    "",
    ...slotFacts(input),
    input.angle
      ? `Angle now: ${input.angle.key} (${input.angle.name || input.angle.key}). Keep it unless the note changes it.`
      : (input.angleKey ? `Angle now: ${input.angleKey}. Keep it unless the note changes it.` : "The script has no angle yet. Pick one from the angle list."),
    "",
    `The script now (version ${script.version}):`,
    JSON.stringify(current, null, 2),
    "",
    `Intro: ${introAllowance(input.intro ?? null)}`,
    ...avoidLines(input)
  ];
  return lines.join("\n");
}

/**
 * A rewrite round: the same request, the last draft, and every check it failed.
 * @param {string} basePrompt the user turn the draft was written from
 * @param {object} draft the last draft, as the writer returned it
 * @param {string[]} problems plain sentences, one per failed check
 */
export function buildRewritePrompt(basePrompt, draft, problems) {
  const list = (Array.isArray(problems) ? problems : []).map(oneLine).filter(Boolean);
  return [
    String(basePrompt ?? ""),
    "",
    "YOUR LAST DRAFT:",
    JSON.stringify(draft, null, 2),
    "",
    "IT FAILED THESE CHECKS. FIX EVERY ONE, AND KEEP WHAT WAS NOT BROKEN:",
    ...list.map((p, i) => `${i + 1}. ${p}`)
  ].join("\n");
}

/**
 * The judge's cached system prompt: what to check, and RULES.md Part 0 word for word.
 * @param {string} rulesMd
 */
export function buildJudgeSystem(rulesMd) {
  return [
    "You check one Fundhub ad script against some of Chris's rules. The rules are RULES.md Part 0, below.",
    `Check only these rules: ${JUDGED_RULES.join(", ")}. That is rule 3 ("carry" or "carries" for what a file is worth), rule 9 ("round two" for the next funding sequence; inside one sequence it is allowed), rule 12 ("man" used as filler), and rules 13 to 34. Pattern checks already ran for the other rules, so do not report them.`,
    "Report a violation only when a line clearly breaks one of these rules. Quote the exact words from the script. Say in one sentence how to fix it. When nothing breaks these rules, return an empty list.",
    "Answer only with the JSON the response format asks for.",
    "",
    "=== RULES.md Part 0 ===",
    part0Of(rulesMd)
  ].join("\n");
}

/**
 * The judge's user turn: the script, its Meta copy, and whether it is book-a-call.
 * @param {{ draft: { script_format?: string, style?: string, body: string, meta_copy?: any },
 *           bookCall: boolean, offerLabel?: string|null, note?: string|null }} input
 */
export function buildJudgeUser({ draft, bookCall, offerLabel = null, note = null }) {
  const m = draft.meta_copy || {};
  const lines = [
    "THE SCRIPT",
    `Format: ${draft.script_format || "not given"}. Style: ${draft.style || "not given"}.`,
    bookCall ? "This is a book-a-call ad." : `This ad sells ${offerLabel || "an offer"} on its landing page; it is not a book-a-call ad.`
  ];
  if (note && String(note).trim()) {
    lines.push("Chris asked for this change, word for word. Never report a line that does what he asked (rule 0):", '"""', String(note).trim(), '"""');
  }
  lines.push(
    "",
    "Body:",
    '"""',
    String(draft.body ?? "").trim(),
    '"""',
    "",
    "Meta copy:",
    `primary_text: ${String(m.primary_text ?? "")}`,
    `headline: ${String(m.headline ?? "")}`,
    `description: ${String(m.description ?? "")}`
  );
  return lines.join("\n");
}
