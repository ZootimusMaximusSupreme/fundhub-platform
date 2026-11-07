// The money helper's lessons — Finance OS wave 4, unit ED.
//
// Owner order (Chris, 2026-11-07, ops/workflows/finance-os-wave4-brief.txt): "Education library
// to the AI helper: find Fundhub's education content in the repo ... Give money-helper a
// topic-guidance source drawn from it: ChexSystems, opening accounts, seasoning, card use,
// inquiries, business credit, gas cards. Short, accurate answers that cite the doc they come from."
//
// WHERE THE WORDS COME FROM (searched 2026-11-07: docs/, marketing/, docs/legacy-strong/ and the
// skills; never credentials/). Every lesson line rests on one of these, and
// money-education.test.mjs opens each file and finds the backing words in it:
//   src/blueprint/preparation-guidance.mjs        the Blueprint's own lessons: account-opening
//                                                 history (ChexSystems), first bank accounts,
//                                                 business records, business-credit and fuel cards
//   marketing/slideshows/talk/card-paydown.txt    Chris's Card Paydown lesson
//   marketing/slideshows/talk/apply-yourself.txt  Chris's Applying On Your Own lesson (inquiries)
//   marketing/slideshows/talk/business-one-two.txt  Chris's Business One, Two lesson
//   docs/finance/file-protection-alerts.md        the pay-before-close text and its 10% target
//   docs/legacy-strong/lenders-legacy-strong.csv  the bank book's own seasoning lines
//   docs/journeys/capital-blueprint-intended.md   R12: NAV, Net 30s and DUNS are out of buyer guidance
// Owner calls that live on the board or in a brief are kept as { said, words, ref }, the way
// src/finance/apply-gate.mjs keeps them (seasoning 30 / 60 / 90, the ChexSystems step, pay-by,
// the gas-card risk line).
//
// LOOKED AT AND NOT USED, and why:
//   src/underwrite/** suggestion lines   UnderwriteIQ reaches the client only as the overview's own
//                                        tip, word for word (money-agent-ai.mjs rule 4)
//   marketing/knowledge/                 Alex Hormozi's business books, not money lessons
//   .agents/skills/, marketing/copy-skills/  skills for ads, video and code; no money lessons
//   docs/metro2/                         dispute law; the helper gives no legal advice
//   docs/legacy-strong/bank-datapoints-active-banks.md  no column names to read it by
//
// HOW THE HELPER USES IT (src/finance/money-agent-ai.mjs)
//   topicGuidance(question)   FACTS.topic_guidance — the lessons a question is about, at most two
//   topicReply(guidance)      the rules brain's answer: each lesson's words, then "From: <doc>."
//   topicReplyProblems(...)   an AI answer that talks about a lesson it was handed must name that
//                             lesson's doc, and no answer may offer a tool the owner took out
//   lessonPromptBlock(...)    the few lines the model reads with a lesson
//   LEARN_TOPICS              the topic buttons on the helper screen (public/app/money-helper.js)
//
// Pure: no database, no clock, no network, no side effects.

/** The words an answer must say when it names a tool the owner took out of buyer guidance. */
export const NOT_IN_PLAN = "not part of your Fundhub plan";
/** At most this many lessons ride on one question. */
export const MAX_TOPICS = 2;
/** Only the start of a message is read for a topic (a chat message is under 2,000 characters). */
const SCAN_CHARS = 2000;

const doc = (path, says) => Object.freeze({ kind: "doc", path, says });
const owner = (said, words, ref) => Object.freeze({ kind: "owner", said, words, ref });

const BOARD = "ops/workflows/finance-os-cfo-build-2026-11-06.txt";
const BLUEPRINT_LESSONS = "src/blueprint/preparation-guidance.mjs";

/* The tools the owner removed from buyer guidance (docs/journeys/capital-blueprint-intended.md R12):
   NAV, Net 30 accounts and DUNS / Dun & Bradstreet setup. */
export const EXCLUDED_RE = /\bnet[\s-]?(?:30|thirty)s?\b|\bd[.\-\s]?u[.\-\s]?n[.\-\s]?s\b|\bdun\s*(?:&|and)\s*bradstreet\b|\bd\s?&\s?b\b|\bnav(?:\.com)?\b/i;

/**
 * The lessons, in the order the screen lists them. Each one:
 *   key      the topic's id (FACTS.topic_guidance[].topic)
 *   title    the short label (the screen's topic button)
 *   ask      the question the button sends (null: no button)
 *   match    which questions it answers — and, on an AI answer, whether the answer talks about it
 *   answer   2 to 4 short sentences, plain words
 *   from     the doc it comes from, as the client reads it: "From: <from>."
 *   link     an official site the answer names, or null
 *   sources  where every line comes from: { kind: "doc", path, says } (the file holds `says`
 *            word for word) or { kind: "owner", said, words, ref }
 */
export const TOPICS = Object.freeze([
  Object.freeze({
    key: "chexsystems",
    title: "ChexSystems",
    ask: "What is ChexSystems?",
    match: /\bchex\s*systems?\b|\bchex\b|\bearly\s+warning\b/i,
    answer: "ChexSystems is a report on your past bank accounts. Many banks check it before they open an account for you. Get your free report at chexsystems.com before you open one. If something on it is wrong, dispute it and keep the proof.",
    from: "Blueprint lessons",
    link: Object.freeze({ label: "Open chexsystems.com", url: "https://www.chexsystems.com", text: "chexsystems.com" }),
    sources: Object.freeze([
      doc(BLUEPRINT_LESSONS, "A checking-account report can affect account opening independently of a personal credit score."),
      doc(BLUEPRINT_LESSONS, "identify the reporting company it used, such as ChexSystems or Early Warning Services"),
      doc(BLUEPRINT_LESSONS, "For an error, send a specific dispute with supporting evidence."),
      owner("2026-11-06", "ChexSystems check before opening any bank account. A step that shows how to get the free ChexSystems report from the official site, with the AI helper answering questions.", `${BOARD} · SPEC item 8`)
    ])
  }),
  Object.freeze({
    key: "opening_accounts",
    title: "Opening accounts",
    ask: "How do I open a bank account?",
    match: /\bopen(?:ing|ed|s)?\s+(?:up\s+)?(?:(?:a|an|my|the|new|more|another|our|two|three|\d+)\s+)?(?:new\s+)?(?:(?:business|personal|joint|local)\s+)?(?:bank|checking|savings|credit\s+union)\b|\bopen(?:ing)?\s+(?:a|an|my|the)\s+(?:[a-z]+\s+){1,2}(?:checking|savings)\b|\bopen(?:ing)?\s+(?:an?\s+|new\s+|more\s+)?(?:bank\s+)?accounts?\s+(?:at|with)\b|\bopen(?:ing)?\s+the\s+(?:new\s+)?account\b|\bnew\s+(?:business\s+)?(?:bank|checking|savings)\s+accounts?\b|\b(?:which|what)\s+banks?\s+(?:should\s+i\s+|do\s+i\s+|to\s+)open\b/i,
    answer: "Check your ChexSystems report first. Open the account in your business's name. Ask the bank for its list of papers, and bring your LLC papers, EIN letter and ID. Check the fees and the opening deposit first.",
    from: "Blueprint lessons",
    link: null,
    sources: Object.freeze([
      doc(BLUEPRINT_LESSONS, "Ask the chosen institution for its actual account-opening document list."),
      doc(BLUEPRINT_LESSONS, "Gather this business’s formation and EIN records, actual ownership and signer identification"),
      doc(BLUEPRINT_LESSONS, "Check the account’s current fees, opening minimum and ongoing balance requirements"),
      doc("marketing/slideshows/talk/business-one-two.txt", "The checking account goes in the LLC's NAME."),
      owner("2026-11-06", "ChexSystems check before opening any bank account.", `${BOARD} · SPEC item 8`)
    ])
  }),
  Object.freeze({
    key: "seasoning",
    title: "Seasoning",
    ask: "What is seasoning?",
    match: /\bseason(?:ed|ing|s)?\b/i,
    answer: "Seasoning is how long an account stays open with money in it. Fundhub counts an account as seasoned at 30 days. 60 and 90 days are even better. Some banks on our list want 30 days or more before you apply.",
    from: "Fundhub bank book",
    link: null,
    sources: Object.freeze([
      doc("docs/legacy-strong/lenders-legacy-strong.csv", "Checking account + 30-day seasoning required."),
      doc("docs/legacy-strong/lenders-legacy-strong.csv", "Requires business checking and 30+ days of seasoning."),
      doc("docs/legacy-strong/lenders-legacy-strong.csv", "30+ days of liquidity seasoning strongly improves odds."),
      owner("2026-11-07", "the clock runs per opened account; at 30 days the client sees 'Congrats. Your <bank> account is seasoned.' 60 and 90 days are better ('the more seasoning, the better').", `${BOARD} · OWNER CALLS, part 3`)
    ])
  }),
  Object.freeze({
    key: "card_use",
    title: "Card use",
    ask: "How should I use my cards?",
    match: /\bstatement\s+(?:close|closes|closed|closing|date|dates|day|balance)\b|\butili[sz](?:ation|e|ed|ing)\b|\bcard\s+(?:use|usage)\b|\b(?:use|using|carry|keep)\s+(?:on\s+)?(?:my|your)\s+(?:credit\s+)?cards?\b|\b(?:10|ten)\s?(?:%|percent\b)|\bhow\s+much\s+of\s+(?:my|your|the)\s+(?:credit\s+)?limit\b|\bwhen\s+(?:does|do|will)\s+(?:my\s+|your\s+|a\s+)?(?:\w+\s+)?cards?\s+report\b|\bcards?\s+reports?\s+(?:my\s+|the\s+|its\s+)?balance/i,
    answer: "Your card reports its balance on the day the statement closes. That is the balance a bank reads, even if you pay in full later. Pay it down a few days before that day. Fundhub's goal is 10% of each card's limit or less.",
    from: "Card Paydown lesson",
    link: null,
    sources: Object.freeze([
      doc("marketing/slideshows/talk/card-paydown.txt", "The day your statement CLOSES, your card reports its balance to the bureaus. That's the balance a bank reads, even if you pay in full on the due date."),
      doc("marketing/slideshows/talk/card-paydown.txt", "Every card on your file gets that same rule: 10% of its own limit."),
      doc("docs/finance/file-protection-alerts.md", "a payment takes 1–3 days to post"),
      owner("2026-11-07", "Pay-by date: pay a couple of days BEFORE the statement close and the due date.", `${BOARD} · OWNER CALLS, part 3`)
    ])
  }),
  Object.freeze({
    key: "inquiries",
    title: "Inquiries",
    ask: "What are inquiries?",
    match: /\b(?:in|en)quir(?:y|ies)\b|\bhard\s+(?:credit\s+)?(?:checks?|inquir(?:y|ies)|hits?)\b|\bcredit\s+checks?\b/i,
    answer: "Applying for credit can add a hard inquiry to your report. It can stay even if the bank says no, and the next bank can see it. Each bank picks which bureau it reads. Fundhub's goal is no inquiries before you apply.",
    from: "Applying On Your Own lesson",
    link: null,
    sources: Object.freeze([
      doc("marketing/slideshows/talk/apply-yourself.txt", "Each new hard inquiry gives a later lender another recent application to weigh."),
      doc("marketing/slideshows/talk/apply-yourself.txt", "A denied application can still leave a hard inquiry. The next lender that reads that bureau weighs it with the rest of your file."),
      doc("marketing/slideshows/talk/apply-yourself.txt", "Lenders choose which bureau or bureaus they read."),
      doc("marketing/slideshows/talk/apply-yourself.txt", "Inquiries cost fundability, and every one above zero gets reviewed before we plan the next application."),
      owner("2026-11-07", "even after 30 days, applying stays LOCKED unless UnderwriteIQ says fundable, inquiries are clean, and the account is seasoned", `${BOARD} · OWNER CALLS, part 3`)
    ])
  }),
  Object.freeze({
    key: "business_credit",
    title: "Business credit",
    ask: "How does business credit work?",
    match: /\bbusiness\s+credit\b(?!\s+cards?\b)|\bbusiness(?:'s)?\s+(?:bureaus?|credit\s+(?:scores?|reports?|files?|profiles?)|scores?)\b|\bpaydex\b|\b(?:experian|equifax)\s+business\b|\bcompany(?:'s)?\s+credit\b(?!\s+cards?\b)|\bcredit\s+for\s+(?:my|our|the)\s+(?:business|company|llc)\b/i,
    answer: "Business credit is a separate credit file for your company. Each business stands on its own, after your personal file is ready. Keep its name, address and phone the same everywhere. It starts to age the day you file it, so file early.",
    from: "Business One, Two lesson",
    link: null,
    sources: Object.freeze([
      doc("marketing/slideshows/talk/business-one-two.txt", "It has its own five checks and its own count, kept apart from your personal file."),
      doc("marketing/slideshows/talk/business-one-two.txt", "Each business stands on its own count."),
      doc("marketing/slideshows/talk/business-one-two.txt", "Business one gets primed first, then business two, once your personal file is ready."),
      doc("marketing/slideshows/talk/business-one-two.txt", "Until the day you file it, your business has no age at all."),
      doc("marketing/slideshows/talk/business-one-two.txt", "File early, and your credit work and your business's age move forward in the same months"),
      doc(BLUEPRINT_LESSONS, "Compare its legal name and any DBA, address and contact details across its formation/EIN documents, bank records, website and relevant public profiles.")
    ])
  }),
  Object.freeze({
    key: "gas_cards",
    title: "Gas cards",
    ask: "Should I get a gas card?",
    match: /\b(?:gas|fuel|fleet)\s+(?:credit\s+)?cards?\b|\b(?:gas|fuel|fleet)\s+(?:accounts?|programs?)\b|\bgas\s+station\s+cards?\b|\b(?:wex|fuelman|atob)\b/i,
    answer: "A gas card is a fuel card in your business's name, for real fuel costs. Some report to the business credit bureaus, so ask before you apply. If it reports, paying on time helps a little. Miss a payment and it hurts your business credit.",
    from: "Blueprint lessons",
    link: null,
    sources: Object.freeze([
      doc(BLUEPRINT_LESSONS, "If this business has real fuel expenses, compare AtoB, WEX, Phillips 66/Conoco/76, Fuelman or ExxonMobil"),
      doc(BLUEPRINT_LESSONS, "whether the issuer reports this exact account to a business bureau before applying"),
      doc(BLUEPRINT_LESSONS, "pay according to its actual agreement"),
      doc(BLUEPRINT_LESSONS, "Do not apply just to create activity, assume approval or assume bureau reporting."),
      owner("2026-11-07", "Business gas and fuel cards as business primaries (they report to the business bureaus; they help a little; missed payments hurt) ... the risk line \"Miss a payment and it hurts your business credit.\"", "ops/workflows/finance-os-wave4-brief.txt · GAS")
    ])
  }),
  /* The guard: a question about a tool the owner took out of buyer guidance gets this answer,
     and no AI answer may offer one (topicReplyProblems). No topic button. */
  Object.freeze({
    key: "not_in_plan",
    title: "Net 30, DUNS and Nav",
    ask: null,
    match: EXCLUDED_RE,
    answer: `Net 30 accounts, DUNS and Nav are ${NOT_IN_PLAN}. Your plan works on your personal file first, then each business.`,
    from: "Capital Blueprint plan",
    link: null,
    sources: Object.freeze([
      doc("docs/journeys/capital-blueprint-intended.md", "Exclude NAV, Net 30 accounts and DUNS/Dun & Bradstreet setup from the buyer guidance and prompts."),
      doc("docs/journeys/capital-blueprint-intended.md", "The owner explicitly removed **NAV, Net 30s and DUNS** and confirmed that choice."),
      doc("marketing/slideshows/talk/business-one-two.txt", "Business one gets primed first, then business two, once your personal file is ready.")
    ])
  })
]);

const list = (v) => (Array.isArray(v) ? v : []);
const BY_KEY = new Map(TOPICS.map((t) => [t.key, t]));
const ORDER = TOPICS.map((t) => t.key);
const GUARD = "not_in_plan";

export function topicByKey(key) {
  return BY_KEY.get(String(key || "")) || null;
}

/** The topic buttons the helper screen shows, in order. public/app/money-helper.js keeps a copy
 *  (LEARN); src/http/money-helper-learn.test.mjs fails if the two drift. */
export const LEARN_TOPICS = Object.freeze(TOPICS.filter((t) => t.ask).map((t) => Object.freeze({ key: t.key, title: t.title, ask: t.ask })));

/** "From: <doc>." — the line every lesson answer ends with. */
export function fromLine(topic) {
  return `From: ${topic.from}.`;
}

/**
 * matchTopics(text) → topic keys, in the order the question names them, at most MAX_TOPICS.
 * A question about a tool the owner took out always keeps its place, so the guard answer is
 * never crowded out.
 */
export function matchTopics(text, { max = MAX_TOPICS } = {}) {
  const s = String(text == null ? "" : text).slice(0, SCAN_CHARS);
  if (!s.trim()) return [];
  const hits = [];
  for (const t of TOPICS) {
    const m = t.match.exec(s);
    if (m) hits.push({ key: t.key, at: m.index });
  }
  hits.sort((a, b) => a.at - b.at || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const n = Math.max(0, Number.isInteger(max) ? max : MAX_TOPICS);
  const keep = hits.slice(0, n);
  const guard = hits.find((h) => h.key === GUARD);
  if (n > 0 && guard && !keep.includes(guard)) keep[keep.length - 1] = guard;
  return keep.map((h) => h.key);
}

/**
 * topicGuidance(text) → FACTS.topic_guidance: [{ topic, title, answer, from, from_line }].
 * [] when the question names no lesson. The words carry no ids and no file paths, so nothing in
 * them widens what the helper may say beyond the lesson itself.
 */
export function topicGuidance(text) {
  return matchTopics(text).map((key) => {
    const t = BY_KEY.get(key);
    return { topic: t.key, title: t.title, answer: t.answer, from: t.from, from_line: fromLine(t) };
  });
}

/** The rules brain's answer: each lesson's own words, then the doc it comes from, on its own line. */
export function topicReply(guidance = []) {
  return list(guidance)
    .map((g) => BY_KEY.get(g && g.topic))
    .filter(Boolean)
    .map((t) => `${t.answer}\n${fromLine(t)}`)
    .join("\n\n");
}

/**
 * topicReplyProblems(reply, guidance) → problem codes ([] when clean).
 *   topic_without_source:<key>  the answer talks about a lesson it was handed, but does not say
 *                               "From: <doc>" for it
 *   excluded_tool_named         the answer names Net 30, DUNS, D&B or Nav without saying they are
 *                               not part of the plan (on every answer, lesson or not)
 */
export function topicReplyProblems(reply, guidance = []) {
  const s = String(reply == null ? "" : reply);
  const low = s.toLowerCase();
  const out = [];
  for (const g of list(guidance)) {
    const t = BY_KEY.get(g && g.topic);
    if (!t) continue;
    if (t.match.test(s) && !low.includes(`from: ${t.from}`.toLowerCase())) out.push(`topic_without_source:${t.key}`);
  }
  if (EXCLUDED_RE.test(s) && !low.includes(NOT_IN_PLAN.toLowerCase())) out.push("excluded_tool_named");
  return out;
}

/** The lines the model reads with a lesson ([] with none, so every other prompt is unchanged). */
export function lessonPromptBlock(guidance = []) {
  if (!list(guidance).length) return [];
  return [
    "LESSONS — FACTS.topic_guidance holds Fundhub's own lesson for what the client asked. It is a lesson, not the client's records.",
    "Answer from it in 1 to 4 short sentences. Use only what it says, and add no advice it does not give.",
    "When your answer uses a lesson, end with that lesson's from_line, word for word, on its own line.",
    `Never suggest Net 30 accounts, DUNS or Nav. They are ${NOT_IN_PLAN}.`,
    ""
  ];
}

export default { TOPICS, LEARN_TOPICS, matchTopics, topicGuidance, topicReply, topicReplyProblems, lessonPromptBlock };
