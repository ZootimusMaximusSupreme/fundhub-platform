// @ts-check
// The words on a dashboard-built funnel: what the model is asked, the shape it
// must answer in, and the check every answer must pass before it is saved
// (build unit X4).
//
// PURE. No database, no network. src/marketing/funnel-build.mjs makes the call.
//
// THE MODEL WRITES WORDS, NEVER HTML. COPY_SCHEMA is the answer's shape
// (Anthropic structured output, src/agents/model.mjs outputSchema); the page is
// drawn by src/marketing/funnel-pages.mjs.
//
// THE CHECK (checkCopy) is code, not a request in the prompt — a regex cannot
// believe it ran. Every page's words go through:
//   * the ad copy checker in strict mode (scripts/ads/check-script.mjs
//     checkScriptText): banned words and phrases, em dashes, "it's not X, it's
//     Y", never-say lines, vendor names, RULES.md Part 0 (Fundhub spelled right,
//     no "credit repair", numerals for dollars, no "could"...) and the phrases
//     Chris banned in the app. The hook rule (lead with the cause, never a
//     question, never an ask) applies to the landing page's headline only.
//   * owner copy laws the ad checker does not hold:
//       - outcome first: the landing headline is about the buyer, never "We…",
//         "Our…", "Fundhub…" or "Introducing…";
//       - lead with funding (X4F, owner calls: never read as credit repair): the
//         landing headline names funding before any word about credit, and no
//         headline (nor the landing eyebrow) leads with fixing credit or a score
//         (fundingLeadFailures);
//       - no invented numbers: every dollar amount, percent, and number above 10
//         must appear in the facts the model was given;
//       - no testimonials and no quotes: there is no real quote in the facts,
//         so a quoted line, a named client or a star rating is refused;
//       - no Social Security number talk, no guarantee;
//       - every field filled, lists the right length.

import { checkScriptText } from "../../scripts/ads/check-script.mjs";
import { formatCents } from "../config/offers.mjs";

/** The model the pages are written with (the same Opus the offer writer uses). */
export const FUNNEL_MODEL = "claude-opus-5-5";
/** Each source file is cut to this many characters before it goes in the prompt. */
export const SOURCE_MAX_CHARS = 12000;

const str = (description) => ({ type: "string", description });
const items = (props, description) => ({
  type: "array",
  description,
  items: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false }
});
const TD = { title: str("a few words"), detail: str("one or two short sentences") };

/** The answer's shape. Every key is required; lists are counted in checkCopy. */
export const COPY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["landing", "booking", "thank_you"],
  properties: {
    landing: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "headline", "subhead", "lede", "cta", "cta_note", "bullets_title", "bullets", "steps_title", "steps", "faq"],
      properties: {
        eyebrow: str("2 to 6 words above the headline"),
        headline: str("the outcome the buyer gets, 12 words or fewer, not a question"),
        subhead: str("one sentence that backs up the headline"),
        lede: str("2 or 3 short sentences: who this is for and what the call does for them"),
        cta: str("the button, 2 to 5 words, it books a call"),
        cta_note: str("a few words under the button"),
        bullets_title: str("2 to 5 words over the list of what they get"),
        bullets: items(TD, "3 to 6 things the buyer gets, each from the facts"),
        steps_title: str("2 to 5 words over the call steps"),
        steps: items(TD, "exactly 3 steps: book, the call, what happens after"),
        faq: items({ q: str("a real buyer question"), a: str("a short, honest answer from the facts") }, "3 to 5 questions")
      }
    },
    booking: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "headline", "subhead", "lede", "booknote", "prep_title", "prep"],
      properties: {
        eyebrow: str("2 to 6 words"),
        headline: str("tells them to pick a time, 10 words or fewer"),
        subhead: str("one sentence on what the call gives them"),
        lede: str("1 or 2 short sentences"),
        booknote: str("one line over the calendar"),
        prep_title: str("2 to 5 words over the list"),
        prep: { type: "array", description: "2 to 4 things to have ready for the call", items: str("one short line") }
      }
    },
    thank_you: {
      type: "object",
      additionalProperties: false,
      required: ["eyebrow", "headline", "subhead", "lede", "steps_title", "next_steps"],
      properties: {
        eyebrow: str("2 to 6 words"),
        headline: str("the call is booked, 10 words or fewer"),
        subhead: str("one sentence"),
        lede: str("1 or 2 short sentences on what happens next"),
        steps_title: str("2 to 5 words"),
        next_steps: items(TD, "exactly 3 next steps")
      }
    }
  }
});

const COUNTS = Object.freeze({
  "landing.bullets": [3, 6],
  "landing.steps": [3, 3],
  "landing.faq": [3, 5],
  "booking.prep": [2, 4],
  "thank_you.next_steps": [3, 3]
});

/**
 * The facts block for one offer. Prices come from src/config/offers.mjs only.
 * @param {{ label: string, product: any, lane: string }} offer
 */
export function offerFactsBlock({ label, product }) {
  const lines = [
    `OFFER: ${product.name} (${label}). Sold on a booked call, never on the page.`,
    `List price on file (src/config/offers.mjs): ${formatCents(product.priceCents) ?? "unknown"}. Do NOT put any price on these pages; the call sets the price.`
  ];
  if (Array.isArray(product.contents) && product.contents.length) {
    lines.push(`WHAT THE BUYER GETS (exact names): ${product.contents.join("; ")}.`);
  }
  if (product.financing) lines.push("Payment plans can be offered on the call.");
  return lines.join("\n");
}

const clip = (s, n = SOURCE_MAX_CHARS) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}\n[cut at ${n} characters]` : t;
};

/**
 * The system prompt and the user message.
 * @param {{ offer: { label: string, product: any, lane: string },
 *           sources?: { avatar?: string, offer?: string, copy?: string, ownerNotes?: string },
 *           paths: { landing: string, booking: string, thank_you: string },
 *           fix?: string[] }} input
 */
export function buildPrompt({ offer, sources = {}, paths, fix = [] }) {
  const system = [
    "You write the words for a three-page book-a-call funnel for Fundhub (always spelled Fundhub).",
    "Page 1 makes the promise and sends people to book. Page 2 frames the booking calendar. Page 3 thanks them and says what happens next.",
    "RULES. Break one and the words are thrown away:",
    "1. Outcome first. Lead every block with why the buyer cares. The headline is about the buyer, never about us.",
    "2. Plain words a 5th grader reads. Short sentences. Talk to \"you\".",
    "3. Use only facts given below. Never invent a number, a result, a dollar amount, a percent, a client, a quote, a review, a testimonial or a time limit.",
    "4. No price on any page. No guarantee. No promise of approval or of an amount.",
    "5. Never mention a Social Security number.",
    "6. Never write: credit repair, could, your number, no guarantees, leverage, seamless, unlock, journey, game-changer.",
    "7. No em dashes. Dollar amounts are numerals.",
    "8. Lead with funding. Fundhub sells funding, never credit repair. The first page's headline names the funding the buyer is after (funding, funded, capital, approved), and says it before anything about credit. No headline on any page talks about fixing, repairing or cleaning up credit, or about a score. Credit work (inquiries cost fundability, so they come off) is a step on the way to funding: say it in the body, never as the promise.",
    "Answer in the JSON shape you are given. Words only: no HTML, no links, no emoji."
  ].join("\n");
  const parts = [offerFactsBlock(offer), ""];
  const add = (title, body) => { if (String(body || "").trim()) parts.push(`--- ${title} ---`, clip(body), ""); };
  add("WHO WE SELL TO (avatar file)", sources.avatar);
  add("THE OFFER FILE", sources.offer);
  add("APPROVED AD COPY (voice and angles)", sources.copy);
  add("OWNER NOTES", sources.ownerNotes);
  if (!sources.avatar && !sources.offer && !sources.copy) {
    parts.push("No avatar, offer or copy file exists for this offer yet. Write from the offer facts above only.", "");
  }
  parts.push(`The pages live at ${paths.landing}, ${paths.booking} and ${paths.thank_you}. Do not write the addresses on the pages.`);
  if (fix.length) {
    parts.push("", "YOUR LAST ANSWER FAILED THESE CHECKS. Fix every one and change nothing else:");
    for (const f of fix) parts.push(`- ${f}`);
  }
  return { system, user: parts.join("\n") };
}

/** Every line of words on one page, headline first. */
export function pageLines(copy, role) {
  const c = copy && copy[role];
  if (!c || typeof c !== "object") return [];
  const out = [];
  const push = (v) => { if (typeof v === "string" && v.trim()) out.push(v.trim()); };
  push(c.headline); push(c.subhead); push(c.eyebrow); push(c.lede);
  for (const k of ["cta", "cta_note", "booknote", "bullets_title", "steps_title", "prep_title"]) push(c[k]);
  for (const k of ["bullets", "steps", "next_steps"]) for (const it of Array.isArray(c[k]) ? c[k] : []) { push(it && it.title); push(it && it.detail); }
  for (const it of Array.isArray(c.faq) ? c.faq : []) { push(it && it.q); push(it && it.a); }
  for (const p of Array.isArray(c.prep) ? c.prep : []) push(p);
  return out;
}

/* Numbers that need a source: any $ amount, any percent, any number above 10. */
const NUMBER_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?|\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\b/g;
const digitsOf = (s) => String(s).replace(/[^\d.]/g, "").replace(/\.0+$/, "");

/** The numbers a source text holds, as bare digit strings ("5000", "12"). */
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(NUMBER_RE)) {
    const d = digitsOf(m[0]);
    if (d) out.add(d);
  }
  return out;
}

const OUTCOME_FIRST_BAD = /^(we|we're|we've|our|fundhub|introducing|meet|welcome to)\b/i;

/* Lead with funding (owner calls 2026-09-29, X4F 2026-10-06: "never read as credit
   repair", "lead with funding"). FUNDING_WORD is what the landing headline must
   name; CREDIT_WORD is where credit talk starts; CREDIT_FIX is a headline that
   promises credit work instead of funding. */
const FUNDING_WORD = /\b(?:fund(?:ing|ed|able|ability)?|capital|approv(?:ed|al|als)|business loans?|credit lines?|lines? of credit)\b/i;
const CREDIT_WORD = /\bcredit\b|\bscores?\b|\binquir(?:y|ies)\b/i;
const CREDIT_FIX = /\b(?:fix(?:es|ed|ing)?|repair(?:s|ed|ing)?|clean(?:s|ed|ing)?(?:\s+up)?|rebuild(?:s|ing)?|restor(?:e|es|ed|ing)|boost(?:s|ed|ing)?|rais(?:e|es|ed|ing)|improv(?:e|es|ed|ing)|dispute(?:s|d)?)\b[^.!?]{0,40}\b(?:credit|scores?|reports?|inquir(?:y|ies))\b|\bcredit\s+(?:repair|fix|scores?|clean[\s-]?up)\b|\bscores?\b/i;

/**
 * The lead-with-funding check, on the lines that lead a page: every headline and
 * the landing eyebrow. Plain words for each failure; [] when it passes.
 * @param {any} copy
 */
export function fundingLeadFailures(copy) {
  const out = [];
  const line = (role, key) => (copy && copy[role] && typeof copy[role][key] === "string" ? copy[role][key].trim() : "");
  const head = line("landing", "headline");
  if (head) {
    const fund = FUNDING_WORD.exec(head);
    const credit = CREDIT_WORD.exec(head);
    if (!fund) {
      out.push(`landing: the headline "${head}" does not name funding. Lead with the funding the buyer gets (funding, funded, capital, approved).`);
    } else if (credit && credit.index < fund.index) {
      out.push(`landing: the headline "${head}" puts credit before funding. Say the funding first; credit work comes after.`);
    }
  }
  for (const [role, key] of [["landing", "eyebrow"], ["landing", "headline"], ["booking", "headline"], ["thank_you", "headline"]]) {
    const text = line(role, key);
    if (text && CREDIT_FIX.test(text)) {
      out.push(`${role}: the ${key} "${text}" leads with fixing credit or a score. Fundhub sells funding, never credit repair.`);
    }
  }
  return out;
}
const QUOTE_RE = /["“”][^"“”]{12,}["“”]/;
const TESTIMONIAL_RE = /\btestimonials?\b|\breviews?\b|\b(?:five|5)[- ]stars?\b|\bclients? (?:say|said)\b|\bcustomers? (?:say|said)\b|★/i;
const SSN_RE = /\bsocial security\b|\bssn\b|\bsocial\b(?= number)/i;
const GUARANTEE_RE = /\bguarantee(?:d|s)?\b/i;
const HTML_RE = /<[a-z!/][^>]*>|https?:\/\//i;

/**
 * checkCopy(copy, { sourceText, priceCents }) → { ok, failures: string[] }
 * sourceText: every fact the model was given (numbers in it are allowed).
 * priceCents: the offer's list price; it may not appear on a page (the call sets it).
 */
export function checkCopy(copy, { sourceText = "", priceCents = null } = {}) {
  const failures = [];
  if (!copy || typeof copy !== "object") return { ok: false, failures: ["the answer was not an object"] };

  // Every required field filled, every list the right length.
  for (const role of ["landing", "booking", "thank_you"]) {
    const spec = COPY_SCHEMA.properties[role];
    const c = copy[role];
    if (!c || typeof c !== "object") { failures.push(`${role}: missing`); continue; }
    for (const key of spec.required) {
      const v = c[key];
      if (Array.isArray(v)) continue;
      if (typeof v !== "string" || !v.trim()) failures.push(`${role}.${key} is empty`);
    }
  }
  for (const [where, [min, max]] of Object.entries(COUNTS)) {
    const [role, key] = where.split(".");
    const v = copy[role] && copy[role][key];
    const n = Array.isArray(v) ? v.length : 0;
    if (n < min || n > max) failures.push(`${where} has ${n} items; it needs ${min === max ? min : `${min} to ${max}`}`);
  }

  const allowed = numbersIn(sourceText);
  const price = Number.isInteger(priceCents) && priceCents > 0 ? digitsOf(String(priceCents / 100)) : null;
  for (const role of ["landing", "booking", "thank_you"]) {
    const lines = pageLines(copy, role);
    if (!lines.length) continue;

    // The ad checker, strict. The hook rule is for the landing headline only.
    const res = checkScriptText(lines.join("\n"), { strict: true });
    for (const f of res.failures) {
      if (role !== "landing" && /^cause-first/.test(String(f.message || ""))) continue;
      failures.push(`${role}: ${f.message}${f.match ? ` (${f.match})` : ""}`);
    }

    for (const line of lines) {
      if (HTML_RE.test(line)) failures.push(`${role}: "${line}" has HTML or a link. Words only.`);
      if (QUOTE_RE.test(line)) failures.push(`${role}: "${line}" quotes someone. There is no real quote to use.`);
      if (TESTIMONIAL_RE.test(line)) failures.push(`${role}: "${line}" reads as a testimonial or review. Only real ones may be used, and none were given.`);
      if (SSN_RE.test(line)) failures.push(`${role}: "${line}" mentions a Social Security number.`);
      if (GUARANTEE_RE.test(line)) failures.push(`${role}: "${line}" promises a guarantee.`);
      for (const m of line.matchAll(NUMBER_RE)) {
        const raw = m[0];
        const d = digitsOf(raw);
        const needsSource = /[$%]/.test(raw) || Number(d.replace(/,/g, "")) > 10;
        if (needsSource && !allowed.has(d)) failures.push(`${role}: "${raw.trim()}" is a number that is not in the facts. Take it out.`);
        if (price && raw.includes("$") && d === price) failures.push(`${role}: "${raw.trim()}" puts the price on the page. The call sets the price; take it out.`);
      }
    }
  }

  const head = copy.landing && typeof copy.landing.headline === "string" ? copy.landing.headline.trim() : "";
  if (head && OUTCOME_FIRST_BAD.test(head)) failures.push(`landing: the headline "${head}" is about us. Lead with what the buyer gets.`);
  failures.push(...fundingLeadFailures(copy));

  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}
