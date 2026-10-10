// The FinanceOS Money Helper reads a bank decline the client pasted into the chat.
// Capital Blueprint launch unit B1b (ops/workflows/blueprint-launch-2026-10-06.md).
//
// Owner, 2026-10-06: "The decline defense is something I can just copy into the
// agent. If they get declined, they copy it and it determines what the reason
// could be, then finds the reconsideration steps an agent can take as a process."
//
// THIS FILE IS PURE. No database, no clock, no network. The reading itself is
// src/blueprint/decline-analyze.mjs (the TOOL the money agent may call); this
// file decides WHEN a chat message is a pasted decline, shapes what the model
// is handed (FACTS.decline_analysis), and holds the checks and the no-model
// answer that go with it. src/finance/money-agent-ai.mjs plugs it into the
// helper's brain; src/finance/money-helper.mjs carries out record_decline.
//
// NOTHING HERE IS INVENTED. Every reason, step, who-does-it, timing line and fix
// comes from the analysis, and the analysis cites a repo, owner or Notion source
// for each (or leaves a blank for a person). The model is told to use only that;
// code checks it did (declineReplyProblems).
//
// THE CLIENT'S OWN NUMBERS STAY MASKED. A letter is masked with the analyzer's
// own maskSensitive BEFORE anything reads, stores, quotes or sends it: the text
// the model sees, the text stored on the chat turn and the text saved on the
// decline are all the masked text.
//
// "NEVER GUESS ON SHORT MESSAGES." A message is a pasted decline only when it is
// long enough to be a letter, uses application wording, and the analyzer itself
// reads it as a decline with at least one reason-shaped signal. "Chase declined me,
// why?" is a question, not a paste: the helper asks for the letter.

import {
  TOOL, maskSensitive, letterHash, normalizeBankName, normalizePhone, sourceRefText, categoryOf,
  REASON_CATEGORIES, MAX_LETTER_CHARS
} from "../blueprint/decline-analyze.mjs";

/** Shortest message that can be a letter. A bank letter is paragraphs; a chat is a line. */
export const MIN_PASTE_CHARS = 250;
/** Longest pasted letter: the same cap the reader and the decline store use. */
export const MAX_PASTE_CHARS = MAX_LETTER_CHARS;
/** A decline answer carries reasons, steps and fixes, so it may run longer than a chat answer. The turn's reply column holds 4000. */
export const MAX_DECLINE_REPLY_CHARS = 2400;
/** How much of a pasted letter the model is shown. The analysis covers the whole letter. */
export const MAX_PROMPT_LETTER_CHARS = 8000;

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const compact = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const clip = (s, n) => {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1).trimEnd()}…`;
};

/* ═════════════════════════════════════════════════════════════════════════
   IS THIS MESSAGE A PASTED DECLINE?
   ═════════════════════════════════════════════════════════════════════════ */

/* A bank's letter or email is about an application. A chat about a card that
   was declined at a store is not. */
const APPLICATION_RE = /\b(?:applic\w+|appl(?:y|ied|ying)|request(?:ed)?\s+for\s+(?:credit|an?\s+(?:\w+\s+){0,3}(?:card|loan|line|account)))\b/i;

/** The letter as stored and shown: masked, line breaks kept (the reader finds a reason list by its lines), no control characters. */
export function letterText(input) {
  const masked = maskSensitive(String(input ?? "")).text;
  return masked
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * readDeclinePaste(input) → null, or
 *   { text, hash, bank, analysis }
 * text     the masked letter (what is stored, shown to the model and saved)
 * hash     letterHash(text) — the same hash the decline store keys a letter on
 * bank     the bank's name as the client or the letter wrote it, or null
 * analysis TOOL.run() output: reasons, steps, timing, fixes, phones. No lender-book lines.
 */
export function readDeclinePaste(input) {
  const raw = String(input ?? "");
  const trimmed = raw.trim();
  if (trimmed.length < MIN_PASTE_CHARS || trimmed.length > MAX_PASTE_CHARS) return null;
  const text = letterText(trimmed);
  if (text.length < MIN_PASTE_CHARS || !APPLICATION_RE.test(text)) return null;

  // The analyzer's own signals. First read without being told it is a decline:
  // the letter has to say so itself.
  const probe = TOOL.run({ text: trimmed, declined: false });
  if (probe.looks_like !== "decline") return null;
  if (!(list(probe.reasons).length || list(probe.unknown_parts).length || list(probe.bureaus_named).length)) return null;

  const bank = extractBank(text);
  // The client pasting it is the client saying the bank said no (declined: true),
  // exactly how recordDecline reads it. With a bank the plan names the bank.
  const analysis = bank ? TOOL.run({ text: trimmed, bank, declined: true }) : probe;
  return { text, hash: letterHash(text), bank, analysis };
}

/**
 * The client's OWN words in a message that carries a pasted letter: the short
 * first paragraph, if the letter follows it. A bank email ends with "unsubscribe"
 * and "opt out" notices and some name an Attorney General; those are the bank's
 * words and must never read as the client saying STOP or naming a lawyer.
 */
export function clientIntro(input) {
  const paras = String(input ?? "").trim().split(/\n\s*\n/);
  const first = (paras[0] || "").trim();
  // A first paragraph that is an email header or a salutation is the letter itself.
  if (/^(?:(?:subject|from|to|date|sent|re)\s*:|dear\b)/i.test(first)) return "";
  return paras.length >= 2 && first.length <= 300 ? first : "";
}

/* ── the bank's name ─────────────────────────────────────────────────────── */

const CAP = "[A-Z][A-Za-z0-9&.'’-]*";
const NAME = `${CAP}(?:[ \\t]+(?:(?:of|and|&)[ \\t]+)?${CAP}){0,2}`;
/* Words that are not part of a bank's name: they end a name ("Chase Here's the
   letter") and, alone, are never one ("declined by them"). */
const NAME_TAIL_STOP = new Set([
  "here", "here's", "heres", "i", "i'm", "im", "they", "we", "this", "that", "it", "its", "today", "yesterday", "just",
  "and", "but", "so", "because", "after", "when", "please", "thanks", "thank", "can", "could", "what", "why", "how",
  "my", "the", "a", "an", "for", "on", "in", "at", "about", "again", "is", "was",
  "them", "him", "her", "you", "us", "me", "their", "there", "those", "these", "some", "someone", "somebody"
]);
/* "Capital One" ends in one and "Chase Bank" in bank; "declined by one of them" and "declined by a bank" name
   none. Only a lone lowercase word is checked against this longer list. */
const LONE_WORD_STOP = new Set([
  ...NAME_TAIL_STOP, "one", "all", "another", "any", "both", "each", "every", "many", "most", "none", "several",
  "bank", "banks", "lender", "lenders", "creditor", "creditors", "company", "card", "cards", "email", "letter", "text"
]);

function trimName(raw) {
  const parts = String(raw || "").replace(/[\s.,;:—–-]+$/g, "").split(/\s+/).filter(Boolean);
  while (parts.length && NAME_TAIL_STOP.has(parts[parts.length - 1].toLowerCase().replace(/[.,;:]+$/g, ""))) parts.pop();
  const name = parts.join(" ").replace(/[\s.,;:—–-]+$/g, "");
  return name.length >= 2 && name.length <= 60 ? name : null;
}

const INTRO_PATTERNS = [
  new RegExp(`\\b(?:[Dd]eclined|[Dd]enied|[Rr]ejected|[Tt]urned\\s+down)\\s+(?:me\\s+|us\\s+)?(?:by|from|at)\\s+(${NAME})`),
  new RegExp(`^\\s*(${NAME})\\s+(?:[Dd]eclined|[Dd]enied|[Rr]ejected|[Tt]urned\\s+(?:me|us)\\s+down|said\\s+no)\\b`),
  new RegExp(`\\b(?:letter|email|e-mail|message|notice|decision)\\s+from\\s+(${NAME})`)
];
const LOWER_INTRO = /\b(?:declined|denied|rejected|turned\s+down)\s+(?:me\s+|us\s+)?(?:by|from|at)\s+([a-z][a-z0-9&'’-]{1,24})\b/;
const LETTER_PATTERNS = [
  new RegExp(`\\b(${NAME})[ \\t]+(?:Credit[ \\t]+)?Card[ \\t]+Services\\b`),
  new RegExp(`\\b(${NAME}[ \\t]+Bank)\\b`)
];

/**
 * The bank's name, as the client or the letter wrote it, or null. Conservative:
 * a name found by none of these shapes is left null and the helper asks, rather
 * than saving a decline against a bank it guessed.
 */
export function extractBank(text) {
  const all = String(text ?? "");
  const intro = clientIntro(all) || all.split("\n").slice(0, 2).join(" ");
  for (const re of INTRO_PATTERNS) {
    const m = re.exec(intro);
    const name = m && trimName(m[1]);
    if (name) return name;
  }
  const low = LOWER_INTRO.exec(intro);
  if (low) {
    const w = low[1];
    if (!LONE_WORD_STOP.has(w.toLowerCase())) return w.charAt(0).toUpperCase() + w.slice(1);
  }
  for (const re of LETTER_PATTERNS) {
    const m = re.exec(all);
    const name = m && trimName(m[1]);
    if (name) return name;
  }
  return null;
}

/** True when the bank's name is written somewhere in the text. */
export function bankInText(bank, text) {
  const key = compact(normalizeBankName(bank));
  return key.length >= 2 && compact(text).includes(key);
}

/** True when this phrase is written somewhere in the text (letters and digits only, any case). */
export function textHas(phrase, text) {
  const key = compact(phrase);
  return key.length >= 3 && compact(text).includes(key);
}

/* ═════════════════════════════════════════════════════════════════════════
   FACTS.decline_analysis — what the model is handed
   ═════════════════════════════════════════════════════════════════════════
   Plain keys, no numeric order field (an order number would sit in the number
   allow-list and loosen it; the array order IS the order), and every
   `provenance` string is skipped by the number allow-list (collectAllowed in
   money-agent-ai.mjs) — a page title with "Step 4" in it is not a number the
   helper may say. */

/** The lender book is staff only. One plan line names it in passing; the client's helper does not. */
const clientSafe = (s) => String(s ?? "").replace(/\s+or\s+the\s+lender\s+book\b/gi, "").replace(/\s+/g, " ").trim();
const blankWords = (label) => {
  const head = String(label || "").split(" — ")[0].trim();
  return head ? head.charAt(0).toLowerCase() + head.slice(1) : "what to write for this part";
};
const labelOf = (key) => (categoryOf(key) || {}).label || String(key || "");

function stepFact(s) {
  const base = { key: s.key, who: s.who, status: s.status === "done" ? "done" : "open" };
  if (s.blank) return { ...base, a_person_must_write: blankWords(s.blank_label), say_to_client: s.client_step || null };
  return {
    ...base,
    step: clientSafe(s.step),
    say_to_client: s.client_step || null,
    ...(s.filled ? { found: clientSafe(s.filled) } : {}),
    provenance: sourceRefText(s.sources)
  };
}

function fixFact(s) {
  const category = String(s.key).split(":")[1];
  const base = { for_reason: labelOf(category), who: s.who };
  if (s.blank) return { ...base, a_person_must_write: blankWords(s.blank_label), say_to_client: s.client_step || null };
  return { ...base, text: clientSafe(s.step), say_to_client: s.client_step || null, provenance: sourceRefText(s.sources) };
}

/**
 * declineFacts(paste, { buyer, from, recorded }) → the decline_analysis object for FACTS.
 * from: "this message" | "earlier in this chat". recorded: this letter is already saved.
 */
export function declineFacts(paste, { buyer = false, from = "this message", recorded = false } = {}) {
  const a = paste.analysis;
  const steps = list(a.recon_steps).filter((s) => !/^(?:fix|book):/.test(s.key));
  const fixes = list(a.recon_steps).filter((s) => s.key.startsWith("fix:"));
  const t = a.timing || {};
  return {
    from,
    client_is_blueprint_buyer: buyer === true,
    already_saved: recorded === true,
    bank_named: paste.bank || null,
    looks_like: a.looks_like_words || null,
    reasons: list(a.reasons).map((r) => ({ reason: r.label, in_plain_words: r.client_words, the_bank_wrote: r.evidence_quote })),
    parts_nobody_could_match: list(a.unknown_parts),
    needs_a_person_to_read: { yes: !!a.needs_person, why: a.needs_person_why || null },
    steps_in_order: steps.map(stepFact),
    fix_first: fixes.map(fixFact),
    timing: {
      call_again: t.retries ? t.retries.text : null,
      bank_deadlines_in_the_letter: list(t.letter).map((x) => x.text),
      apply_again_when: list(t.reapply).map((x) => x.text),
      dates_picked: "none. Staff set the call date and any day to apply again."
    },
    phone_numbers_in_letter: list(a.letter_phones).map((p) => ({ number: p.number, the_bank_wrote: p.said })),
    bureaus_named: list(a.bureaus_named),
    numbers_hidden_for_safety: Number(a.masked) > 0
  };
}

/** True when an earlier turn of this chat already saved a decline with this letter hash. */
export function declineRecordedIn(thread, hash) {
  return list(thread).some((t) => list(t && t.actions).some((a) => a && a.type === "record_decline" && a.status !== "failed" && (!hash || a.letter_hash === hash)));
}

/**
 * The most recent decline pasted in this chat (the last few answered turns), so
 * "what should I fix first?" a message later still has the analysis.
 * → null | { paste, recorded }
 */
export function lastDeclineInThread(thread) {
  const rows = list(thread);
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = rows[i];
    if (!t || t.kind === "task") continue;
    const paste = readDeclinePaste(t.input);
    if (paste) return { paste, recorded: declineRecordedIn(rows.slice(i), paste.hash) };
  }
  return null;
}

/* ═════════════════════════════════════════════════════════════════════════
   WHAT A DECLINE ANSWER MAY NEVER SAY
   ═════════════════════════════════════════════════════════════════════════ */

const PHONE_RE = /(?:\+?1[\s.-])?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

/** Phone numbers written in a text, normalized to 123-456-7890. */
export function phonesIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(PHONE_RE)) {
    const n = normalizePhone(m[0]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Passages inside quotation marks (straight or curly). */
export function quotedPassages(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/"([^"\n]{8,500})"|“([^”\n]{8,500})”/g)) out.push((m[1] || m[2]).trim());
  return out;
}

const stripQuoted = (text) => String(text ?? "").replace(/"[^"\n]{8,500}"|“[^”\n]{8,500}”/g, " ");
const wordCount = (s) => (String(s).match(/[A-Za-z0-9']+/g) || []).length;

/** Every string in the analysis the model was handed (not its source labels): what it may quote besides the letter. */
function stringsIn(v, out = [], key = "") {
  if (key === "provenance") return out;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out, key);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) stringsIn(x, out, k);
  return out;
}

/** A quote that is really there: in the bank's letter, the UnderwriteIQ tip, or the analysis the helper was handed. An ellipsis cuts a quote into pieces, each of which must be there. */
function quoteIsReal(q, sources) {
  const pieces = String(q).split(/…|\.{3}/).map((p) => compact(p)).filter((p) => p.length >= 6);
  if (!pieces.length) return true;
  const hay = sources.map(compact).filter(Boolean);
  return pieces.every((p) => hay.some((h) => h.includes(p)));
}

/**
 * declineReplyProblems(reply, { facts, text, tip }) → problem codes ([] when clean).
 *   phone_not_in_the_letter     a phone number the bank's letter does not give (a credit bureau's number is not the bank's)
 *   quote_not_in_the_letter     words in quotation marks that the bank did not write
 *   reason_not_in_the_letter    a reason the analysis did not find (the closed set's own recognisers, run on the reply)
 */
export function declineReplyProblems(reply, { facts, text, tip = null } = {}) {
  const out = [];
  const said = String(reply ?? "");
  const f = isObj(facts) ? facts : {};
  const given = new Set(list(f.phone_numbers_in_letter).map((p) => p.number));
  for (const m of said.matchAll(PHONE_RE)) {
    const n = normalizePhone(m[0]);
    if (!n || !given.has(n)) out.push(`phone_not_in_the_letter: ${clip(m[0], 20)}`);
  }
  /* Quoting the letter, the tip, or a line of the analysis is harmless. What is
     dangerous is a quote nobody wrote: words put in the bank's mouth. */
  const quotable = [text, tip, ...stringsIn(f)];
  for (const q of quotedPassages(said)) {
    if (wordCount(q) >= 4 && !quoteIsReal(q, quotable)) out.push(`quote_not_in_the_letter: "${clip(q, 50)}"`);
  }
  const found = new Set(list(f.reasons).map((r) => (REASON_CATEGORIES.find((c) => c.label === r.reason) || {}).key).filter(Boolean));
  const bare = stripQuoted(said);
  for (const c of REASON_CATEGORIES) {
    if (found.has(c.key)) continue;
    if (c.patterns.some((re) => re.test(bare))) out.push(`reason_not_in_the_letter: ${c.label}`);
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════
   THE NO-MODEL ANSWER — built only from decline_analysis
   ═════════════════════════════════════════════════════════════════════════ */

const ORDINALS = ["First", "Next", "Then"];
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const oneLine = (s) => String(s ?? "").replace(/["“”]/g, "'").replace(/\s+/g, " ").trim();
const endSentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

/* Plan lines a client-facing reply leaves out: the ones that are about the
   record, not about what happens at the bank. */
const SKIP_STEP = /^(?:read_letter|get_letter|log_call|second_no|read_unknown)$/;

/**
 * The process lines for a no-model answer, in the analysis's order. A buyer gets
 * the client wording ("We call Chase…"); a client who is not a buyer gets the
 * sourced step itself ("Call Chase's reconsideration line…") — the steps they can
 * take on their own — and not the ones only Fundhub's team can take.
 */
function processLines(f, buyer) {
  const out = [];
  const phone = list(f.phone_numbers_in_letter)[0];
  list(f.steps_in_order).forEach((s) => {
    if (s.a_person_must_write || (s.status === "done" && !s.found)) return;
    const key = String(s.key || "");
    if (SKIP_STEP.test(key) || /^say:/.test(key)) return;
    if (buyer) {
      if (s.who === "client") return;
      let line = s.say_to_client;
      if (key === "find_recon_line" && phone) line = `${line} The letter gives this number: ${phone.number}`;
      if (line) out.push(line);
      return;
    }
    if (key === "gather_facts" || key === "ask_rm") return;
    if (s.step) {
      let line = s.step;
      if (key === "find_recon_line" && phone) line = `${line} The letter gives this number: ${phone.number}`;
      out.push(line);
    }
  });
  return out;
}

function fixLines(f, buyer) {
  const out = [];
  for (const x of list(f.fix_first)) {
    if (x.a_person_must_write) continue;
    if (x.who === "client") out.push(x.text);
    else if (buyer && x.say_to_client) out.push(x.say_to_client);
    if (out.length >= 3) break;
  }
  return out;
}

/** The one line about the second look: a buyer's decline saved (or already saved, or not savable yet), or the Capital Blueprint for a client who has not bought. */
function closeLine(f, willSave) {
  if (f.client_is_blueprint_buyer !== true) return "The Capital Blueprint team can run the second look for you.";
  if (f.already_saved) return "This decline is already saved with your Fundhub funding team.";
  if (willSave) return "I saved this decline, and your Fundhub funding team has the second look.";
  return "I could not tell which bank sent the letter. Paste it again with the bank's name in your first line, like \"Chase declined me\", and I will start the second look.";
}

/** A message after a pasted decline that is about it. The no-model answer takes over only for these; any other question is answered as it always was. */
export const DECLINE_TOPIC_RE = /\b(?:declin\w*|denied|reconsider\w*|second\s+look|(?:the|that|this)\s+letter|fix\s+first|what\s+should\s+i\s+(?:do|fix)|(?:the\s+)?reasons?)\b/i;

/**
 * declineFollowUpReply(facts, { willSave }) → the no-model answer to a question about a
 * decline pasted earlier in the chat: what to fix first (the analysis's own lines), and
 * the one line about the second look. The reasons and the steps were said already.
 */
export function declineFollowUpReply(f, { willSave = false } = {}) {
  const buyer = f.client_is_blueprint_buyer === true;
  const fixes = fixLines(f, buyer);
  const parts = fixes.length
    ? ["What to fix first:", ...fixes.map((x) => endSentence(oneLine(x)))]
    : ["I have no fix to name from this letter. A Fundhub person can read it with you."];
  parts.push(closeLine(f, willSave), "The bank makes the final call.");
  return parts.join("\n");
}

/**
 * declineRulesReply(facts, { willSave }) → the words the rules brain says for a
 * pasted decline: the likely reasons with the bank's own words, the steps in
 * order, what to fix first, and one line about the Capital Blueprint.
 * willSave: this answer also saves the decline (a buyer, a bank, not yet saved).
 */
export function declineRulesReply(f, { willSave = false } = {}) {
  const buyer = f.client_is_blueprint_buyer === true;
  const head = [];
  if (list(f.reasons).length) {
    head.push("I read your letter. These are the likely reasons, not sure ones.");
    for (const r of list(f.reasons).slice(0, 4)) head.push(`${endSentence(oneLine(r.in_plain_words))} The bank wrote: "${oneLine(r.the_bank_wrote)}".`);
  } else {
    head.push("I read your letter, but I could not find a clear reason in it.");
  }
  const unknown = list(f.parts_nobody_could_match);
  if (unknown.length) {
    head.push(`A Fundhub person has to read ${unknown.length === 1 ? "this part" : "these parts"} of the letter: ${unknown.slice(0, 2).map((u) => `"${oneLine(u)}"`).join(" and ")}.`);
  }

  const steps = processLines(f, buyer);
  const fixes = fixLines(f, buyer);
  const close = closeLine(f, willSave);

  const build = (stepLines, fixLinesList) => {
    const parts = [...head];
    if (stepLines.length) {
      parts.push(buyer ? "Here is what happens next, in order." : "Here is how you can ask the bank for a second look, in order.");
      stepLines.forEach((s, i) => {
        const word = i === stepLines.length - 1 && stepLines.length > 1 ? "Last" : ORDINALS[Math.min(i, ORDINALS.length - 1)];
        parts.push(`${word}, ${lowerFirst(endSentence(oneLine(s)))}`);
      });
    }
    if (fixLinesList.length) parts.push("What to fix first:", ...fixLinesList.map((x) => endSentence(oneLine(x))));
    parts.push(close, "The bank makes the final call.");
    return parts.join("\n");
  };

  // Keep it under the cap: drop fix lines, then process lines from the end, before the reasons.
  let sl = steps.slice();
  let fl = fixes.slice();
  let reply = build(sl, fl);
  while (reply.length > MAX_DECLINE_REPLY_CHARS && (fl.length || sl.length > 2)) {
    if (fl.length) fl.pop(); else sl.pop();
    reply = build(sl, fl);
  }
  return reply;
}

/* ═════════════════════════════════════════════════════════════════════════
   THE SCORE CARD'S READERS — did the reply do what the analysis said?
   ═════════════════════════════════════════════════════════════════════════ */

const STOP_WORDS = new Set([
  "that", "this", "with", "from", "your", "they", "them", "their", "will", "have", "been", "were", "what", "when",
  "then", "than", "into", "does", "doing", "done", "also", "just", "like", "such", "some", "more", "most", "very",
  "about", "there", "which", "would", "could", "should", "after", "before", "because", "while", "where", "these",
  "those", "being", "each", "other", "only", "over", "same", "make", "made", "take", "takes", "taken", "need", "needs",
  "first", "next", "last", "bank", "banks", "letter", "step", "steps"
]);
const contentWords = (s) => new Set((String(s ?? "").toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP_WORDS.has(w)));
const sentencesOf = (s) => String(s ?? "").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const sharedCount = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n += 1; return n; };

/**
 * reasonsCheck(reply, facts) → { covered: [reason], missing: [reason], invented: [label] }
 * covered   the reply says the reason (the bank's own words, or three of its plain words in one sentence)
 * missing   an analysis reason the reply never says
 * invented  a reason the analysis did not find, named anyway
 */
export function reasonsCheck(reply, facts) {
  const said = String(reply ?? "");
  const sentences = sentencesOf(said).map(contentWords);
  const covered = [];
  const missing = [];
  for (const r of list(facts.reasons)) {
    const quote = String(r.the_bank_wrote || "").replace(/…$/, "");
    const mine = contentWords(`${r.reason} ${r.in_plain_words} ${quote}`);
    const hit = (quote.length >= 12 && compact(said).includes(compact(quote)))
      || sentences.some((w) => sharedCount(mine, w) >= 3);
    (hit ? covered : missing).push(r.reason);
  }
  const invented = declineReplyProblems(said, { facts, text: "" })
    .filter((p) => p.startsWith("reason_not_in_the_letter: ")).map((p) => p.slice("reason_not_in_the_letter: ".length));
  return { covered, missing, invented };
}

/**
 * stepOrder(reply, facts) → { mentioned, inOrder, hits: [{ step, sentence }] }
 * Each sentence of the reply is matched to the ONE step it is about — never the other
 * way round, so two steps cannot claim one sentence. A step's words count by how rare
 * they are among the plan's steps: "call" and "Chase", which most steps share, say
 * little; "manual", "review" and "hang" say a lot. The step's own words and its client
 * wording are both tried. A sentence about no step is not a step. When two steps fit
 * about equally, the one that keeps the order wins, so only a clear inversion is called
 * out of order. The steps said must come in the order the analysis lists them.
 */
export function stepOrder(reply, facts) {
  const steps = list(facts.steps_in_order)
    .map((s, i) => ({ i, a: contentWords(s.step), b: contentWords(s.say_to_client), blank: !!s.a_person_must_write }))
    .filter((x) => !x.blank && (x.a.size >= 3 || x.b.size >= 3));
  const df = new Map();
  for (const st of steps) for (const w of new Set([...st.a, ...st.b])) df.set(w, (df.get(w) || 0) + 1);
  const weight = (w) => 1 / (df.get(w) || 1);
  const scoreOf = (words, sent) => {
    if (words.size < 3) return { score: 0, shared: 0 };
    let total = 0;
    let got = 0;
    let shared = 0;
    for (const w of words) {
      const x = weight(w);
      total += x;
      if (sent.has(w)) { got += x; shared += 1; }
    }
    return { score: total ? got / total : 0, shared };
  };
  const hits = [];
  let prev = -1;
  sentencesOf(reply).map(contentWords).forEach((sent, j) => {
    const cands = [];
    for (const st of steps) {
      const a = scoreOf(st.a, sent);
      const b = scoreOf(st.b, sent);
      const best = a.score >= b.score ? a : b;
      if (best.shared >= 2 && best.score >= 0.4) cands.push({ step: st.i, score: best.score });
    }
    if (!cands.length) return;
    const top = Math.max(...cands.map((c) => c.score));
    const near = cands.filter((c) => c.score >= top * 0.9);
    const keepsOrder = near.filter((c) => c.step >= prev).sort((x, y) => x.step - y.step)[0];
    const pick = keepsOrder || near.sort((x, y) => y.score - x.score)[0];
    hits.push({ step: pick.step, sentence: j });
    prev = pick.step;
  });
  let inOrder = true;
  for (let k = 1; k < hits.length; k++) if (hits[k].step < hits[k - 1].step) inOrder = false;
  return { mentioned: new Set(hits.map((h) => h.step)).size, inOrder, hits };
}

export default { readDeclinePaste, declineFacts, declineRulesReply, declineReplyProblems, clientIntro, extractBank };
