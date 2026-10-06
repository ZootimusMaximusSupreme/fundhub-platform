// marketing/ads/rules-data.mjs — the one machine-readable source for ad-copy rules.
//
// marketing/ads/RULES.md is the page a person reads. scripts/ads/check-script.mjs
// is the program that enforces it. Before this file existed, the banned
// words lived in three separate hand-typed copies (the humanizer skill,
// .claude/workflows/copy.js, and an earlier draft of the checker) and one of
// the three had already drifted — it was missing the word "align". This file
// is meant to stop that happening a fourth time.
//
// If a rule changes: change it HERE first, then update the plain-English
// wording in marketing/ads/RULES.md so a person reading that page still sees the
// truth. .claude/workflows/copy.js still holds its own copy for a separate
// system (the /flywheel skill, which writes general ad and email copy, not
// only Fundhub ad scripts) — migrating that file to import this one is a
// follow-up, not done tonight, so the two must be kept in sync by hand until
// then. scripts/ads/check-script.test.mjs reads copy.js's three inline lists
// and fails unless they hold exactly the same entries as the lists here.
//
// PART0_PATTERNS, SCRIPT_FORMATS, DEFAULT_STYLE and FORMAT_RULES at the end
// of this file are strict mode only (checkScriptText). checkOneScript never
// reads them.
//
// Node built-ins only. No package. Nothing here talks to a database or a
// network.

// ---------------------------------------------------------------------------
// 1.2 — banned words, phrases, openers. Source: .claude/workflows/copy.js
// lines 34-47, itself copied from ~/.claude/skills/humanizer/SKILL.md.
// Copied here VERBATIM. Do not reword an entry — the scan is a literal
// substring match, so a reworded entry silently stops catching anything.
// ---------------------------------------------------------------------------

export const BANNED_WORDS = [
  "delve", "tapestry", "leverage", "utilize", "robust", "seamless", "realm",
  "testament", "beacon", "underscore", "showcase", "pivotal", "crucial",
  "foster", "elevate", "embark", "unleash", "navigate", "landscape", "boast",
  "myriad", "plethora", "intricate", "vibrant", "enhance", "streamline",
  "comprehensive", "empower", "holistic", "cultivate",
  "resonate", "align", "nestled"
];
// "optimize" came off this list on 2026-10-05: RULES.md Part 0 rule 1 says
// to write "credit optimization" or "optimize your credit". It came off
// .claude/workflows/copy.js in the same change; the drift test in
// scripts/ads/check-script.test.mjs holds the two lists equal.

export const BANNED_PHRASES = [
  "in today's fast-paced world", "when it comes to", "it's important to note",
  "plays a crucial role in", "at the end of the day", "the world of",
  "more than just", "unlock the power of", "elevate your",
  "take it to the next level", "supercharge", "move the needle", "deep dive",
  "low-hanging fruit", "circle back", "best-in-class", "in conclusion",
  "a journey", "treasure trove", "the possibilities are endless"
];

export const BANNED_OPENERS = [
  "imagine a world where", "have you ever wondered", "picture this",
  "so there you have it", "let's dive in", "here's the thing",
  "here's the kicker", "but here's where it gets interesting",
  "let that sink in", "plot twist", "trust me"
];

// ---------------------------------------------------------------------------
// 1.3 — the market-poisoned phrases, and the ones that are fine even though
// they share words with something banned. Source: marketing/ads/ASSET-BANK.md
// section 8. BOTH lists exist so a checker can tell "soft pull" (allowed)
// apart from "cash advance" used as a good thing (banned) without guessing.
// ---------------------------------------------------------------------------

export const AVOID_PHRASES = [
  "lenders compete for you",
  "get matched with 75 lenders",
  "fast and easy",
  "cash advance",
  "unlimited offers",
  "apply now to get calls from our partners",
  "secret sauce",
  "guaranteed approval"
];

// Explicitly cleared. A checker must never flag these on a substring basis —
// this is the exact list that an earlier, prose-parsing version of the
// checker inverted into a ban list because it read the wrong heading.
// "we don't sell your phone number" said "your number" until 2026-10-05;
// RULES.md Part 0 rule 2 bans "your number", so RULES.md 1.3 and
// ASSET-BANK.md section 8 changed with it. This list only guards the avoid
// list, so the change moves no result.
export const ALLOWED_PHRASES = [
  "no spam calls", "we don't sell your phone number", "soft pull",
  "won't touch your credit score", "see your real offers",
  "one honest application", "no equity", "no daily payments",
  "know the real cost", "judged on your business, not just your fico",
  "owners the banks ignore", "bridge the gap", "before anyone pulls your credit"
];

// ---------------------------------------------------------------------------
// 1.1 — never-say lines for AD COPY specifically (the phone-only lines from
// the same two source files are left out on purpose; RULES.md 1.1 says so).
// Source: docs/sops/company-resources/closer-playbook-2026-08-24.md and
// docs/sops/company-resources/sales-manager-objections-and-funding-2026-09-01.md.
//
// Two of these are a PATTERN, not a literal quote — "any dollar amount a
// bank will give them" and "a bad item will come off" describe a shape, not
// one sentence. Those two carry a `pattern` (RegExp) instead of `text`.
// Everything else is matched as a literal, case-insensitive substring so it
// cannot mis-fire the way a loose word ("not", "here") did before this file
// existed.
// ---------------------------------------------------------------------------

export const NEVER_SAY = [
  { text: "your score will go up", why: "We cannot know that. It is a banned claim for us." },
  { text: "we'll get you funded", why: "We are not the lender. Lenders decide." },
  { text: "we will get you funded", why: "We are not the lender. Lenders decide." },
  {
    pattern: /\$[\d,]+(?:k)?\b[^.!?]{0,60}\bwill\b/i,
    text: "a dollar amount a bank WILL give them",
    why: "Same reason. \"Up to\", with the conditions said out loud, is the only safe shape."
  },
  {
    pattern: /\b(?:will|'ll)\b[^.!?]{0,25}\bcome off\b/i,
    text: "a bad item WILL come off",
    why: "Nobody can promise a deletion. Make the honest refusal the whole ad instead."
  },
  { text: "0% interest", why: "A competitor's line. Not our offer." },
  { text: "no damage to credit", why: "A promise we cannot keep." },
  { text: "we protect your score", why: "A promise we cannot keep." },
  { text: "1-2 inquiries max", why: "A number we do not control." },
  { text: "$50k-$250k", why: "A competitor's range. Not a Fundhub promise." },
  { text: "$8,000", why: "Not our offer. Do not sell it, do not say it." },
  { text: "$10,000", why: "Not our offer. Do not sell it, do not say it." },
  { text: "negatives off in five days", why: "A competitor's claim." },
  { text: "overnight letters", why: "We send expedited US mail. Never say overnight, UPS or FedEx to a bureau." },
  { text: "no denials", why: "A guarantee. See the compliance rules." },
  { text: "we won't touch personal credit", why: "False for the funding path." },
  { text: "you need an llc", why: "Not our rule." },
  { text: "you need an aged corp", why: "Not our rule." },
  { text: "you need a duns", why: "Not our rule." }
];

// A line this checker must NEVER flag under the never-say rule, even though
// it is close in wording to a banned one — RULES.md 1.1's own worked
// example. "No hard inquiry. Soft pull only. Zero impact on your score." and
// its variants are the required close (see the close_promises check below),
// not the banned blanket promise "this will not affect you at all".
export const NEVER_SAY_ALLOWED = [
  "no hard inquiry",
  "soft pull only",
  "zero impact on your score",
  "no obligation",
  "nothing moves until you say so",
  "nothing moves on your file until you tell us to move it"
];

// ---------------------------------------------------------------------------
// 3.6 — the required close. Every cold ad ends carrying the SAME THREE
// PROMISES; the wording is allowed to vary (2 of the 5 live ads use the
// exact sentence, the other 3 use a real variant — see marketing/ads/CONTROLS.md
// Ad 2, Ad 4, and the founder VSL). A checker must test for the promises,
// never for one fixed sentence, or it rejects ads that are live and booking
// calls today.
// ---------------------------------------------------------------------------

// Checked against all five live ads directly, 2026-09-07: Ad 4's real close
// is "Soft pull only. Zero impact on your score. Nothing moves until you say
// so." — it never says the words "no obligation". So that is NOT a third,
// separate required promise; "nothing moves until you say so" already
// covers it (nothing is created without their say-so, which IS the
// no-obligation promise). Two categories, not three, or this rejects a live
// ad booking calls today.
export const CLOSE_PROMISES = [
  { name: "no hard pull", any: ["no hard inquiry", "soft pull only", "zero score impact", "zero impact on your score"] },
  { name: "nothing moves without consent", any: ["no obligation", "nothing moves until you say so", "nothing moves on your file until you tell us to move it"] }
];

// ---------------------------------------------------------------------------
// 2.1 — word count per runtime band. Rate used: 150 words per minute
// (declared assumption, owner can change it — change it HERE only).
// The 60-second floor is an owner rule with no exception, so FLOOR_WORDS is
// enforced on every script regardless of which band it declares, including
// the legacy unlabeled format used in marketing/ads/CONTROLS.md.
// ---------------------------------------------------------------------------

export const WORDS_PER_MINUTE = 150;

export const WORD_COUNT_BANDS = {
  short: { label: "60-90s", low: 150, high: 225, allowLow: 135, allowHigh: 248 },
  long: { label: "90-120s", low: 225, high: 300, allowLow: 203, allowHigh: 330 },
  full: { label: "2min+", low: 300, high: null, allowLow: 270, allowHigh: null },
  vsl: { label: "5-6min VSL", low: 700, high: 900, allowLow: 630, allowHigh: 990 }
};

// 60 seconds at 150 wpm = 150 words, minus the same 10% allowance the bands
// get. Owner-set 2026-09-01: "Minimum 60 seconds. No exceptions."
export const FLOOR_WORDS = WORD_COUNT_BANDS.short.allowLow;

// ---------------------------------------------------------------------------
// 1.4 — never name the tech stack. Underwrite IQ is the one name we DO use
// (it is our own product name, not a vendor's); this list is third-party
// platform and vendor names that must never appear in copy.
// ---------------------------------------------------------------------------

export const VENDOR_NAMES = [
  "clickfunnels", "netlify", "supabase", "postgres", "postgresql", "inngest",
  "anthropic", "openai", "claude", "chatgpt", "gpt-4", "twilio", "sendgrid",
  "meta ads manager", "facebook ads manager"
];

// ---------------------------------------------------------------------------
// PART 0 — Chris's rules (RULES.md Part 0, added 2026-10-05, spec 7.1).
//
// STRICT MODE ONLY. checkScriptText(text, {strict: true}) in
// scripts/ads/check-script.mjs runs these; checkOneScript never does, so the
// five live ads in CONTROLS.md keep passing on the old lists.
//
// Each entry: `rule` is the Part 0 rule number, `id` names the pattern,
// `on` says which text it reads, `pattern` is the RegExp, `fix` is the plain
// line the writer gets back.
//   on: "norm" — lower case, curly quotes made straight, hyphens and dashes
//               turned into spaces (norm() in check-script.mjs). So "net-30"
//               and "net 30" are the same text here.
//   on: "raw"  — the text exactly as written. Only the company-name check
//               needs this, because case is the whole point of it.
//
// NOT HERE ON PURPOSE (judge rules, they depend on context): "round two"
// (fine inside one funding sequence, rule 9), "carry" / "carries" (rule 3)
// and "man" (rule 12). The app's judge model checks those, and Part 0 rules
// 13-34. Em dashes (rule 10) are already caught by checkEmDash on every run.
// ---------------------------------------------------------------------------

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety", "hundred", "thousand", "million", "billion"
].join("|");

// "three hundred thousand dollars", "a million dollars", "thirty two dollars"
// (norm() has already turned "thirty-two" into "thirty two"), "fifty grand".
// "thousands of dollars" is not an amount and does not match.
const DOLLARS_IN_WORDS = new RegExp(
  `\\b(?:a\\s+)?(?:${NUMBER_WORDS})(?:\\s+(?:and\\s+)?(?:${NUMBER_WORDS}))*\\s+(?:dollars?|bucks|grand)\\b`
);

const RULE_5_FIX = "Never mention EIN, DUNS, net-30 vendors or gas cards.";
const RULE_35_FIX = "Proof is Part 0 rules 35-38 only: a decade in the industry, hundreds of files, thousands of data points.";

export const PART0_PATTERNS = [
  { rule: 1, id: "credit-repair", on: "norm", pattern: /\bcredit repairs?\b/,
    fix: "Never write \"credit repair.\" Say \"credit optimization\" or \"optimize your credit.\"" },
  { rule: 2, id: "your-number", on: "norm", pattern: /\b(?:your|the) number\b/,
    fix: "Never say \"your number\" or \"the number.\" Spell it out: how much we think you'll qualify for based on where you're at right now." },
  { rule: 4, id: "shelf-company", on: "norm", pattern: /\bshelf compan(?:y|ies)\b|\bsitting on a shelf\b/,
    fix: "Never write \"shelf company\" or \"sitting on a shelf.\" Say \"an LLC or a company you forgot about.\"" },
  { rule: 5, id: "ein", on: "norm", pattern: /\beins?\b|\bemployer identification numbers?\b/, fix: RULE_5_FIX },
  { rule: 5, id: "duns", on: "norm", pattern: /\bduns\b|\bd u n s\b/, fix: RULE_5_FIX },
  // Normalized text: "net-30" has already become "net 30".
  { rule: 5, id: "net-30", on: "norm", pattern: /\bnet ?30\b/, fix: RULE_5_FIX },
  { rule: 5, id: "gas-card", on: "norm", pattern: /\bgas cards?\b/, fix: RULE_5_FIX },
  { rule: 6, id: "no-guarantees", on: "norm", pattern: /\bno guarantees?\b/,
    fix: "Never write \"no guarantees.\" Say what's most likely based on the data." },
  { rule: 10, id: "company-name", on: "raw",
    // Any spelling but "Fundhub" (and "fundhub" for the fundhub.ai domain):
    // FundHub, FUNDHUB, Fund Hub, fund hub, Fund-Hub, fundHub ...
    pattern: /\b(?!Fundhub\b|fundhub\b)[Ff][Uu][Nn][Dd][\s-]*[Hh][Uu][Bb]\b/,
    fix: "Write Fundhub with a lowercase h." },
  { rule: 11, id: "dollars-in-words", on: "norm", pattern: DOLLARS_IN_WORDS,
    fix: "Dollar amounts are always numerals, like $300,000." },
  { rule: 12, id: "dude-bro", on: "norm", pattern: /\b(?:dude|bro)\b/,
    fix: "No \"dude\" or \"bro\" filler. Write it conversational, at a 5th grade level." },
  { rule: 19, id: "could", on: "norm", pattern: /\bcould\b/,
    fix: "Speak with certainty. Never \"could\" or \"could be worth.\"" },
  { rule: 20, id: "most-business-owners", on: "norm", pattern: /\bmost business owners\b/,
    fix: "Second person, straight at the viewer: \"you,\" never \"most business owners.\"" },
  { rule: 33, id: "frodo", on: "norm", pattern: /\bfrodo\b|\bskip(?:s|ped|ping)? the journey\b/,
    fix: "Don't use the \"Frodo / skip the journey\" framing." },
  { rule: 35, id: "koi-poke", on: "norm", pattern: /\bkoi poke\b/, fix: `Don't use Koi Poke. ${RULE_35_FIX}` },
  { rule: 35, id: "25m", on: "norm", pattern: /\$\s?25\s?(?:m|mm|million)\b|\$25,000,000\b|\b25 million\b/,
    fix: `Don't use $25M. ${RULE_35_FIX}` }
];

// ---------------------------------------------------------------------------
// Floors by format (spec 7.1, RULES.md 2.1). Used by checkScriptText only.
//
//   minWords / maxWords — the spoken word count must sit inside these.
//   cues                — bullets style: the hook, line 2, reveal and CTA
//                         must be there word for word, plus min..max cues of
//                         maxWords or fewer each. No word floor.
//   closePromises       — run the RULES.md 3.6 close check (no hard pull,
//                         nothing moves without their say-so). Standard and
//                         sorting only.
//
// A format and style with no floor here gets no length check at all.
// ---------------------------------------------------------------------------

export const SCRIPT_FORMATS = ["standard", "sorting", "long", "notes", "greenscreen", "vsl"];

// The default style for each format: the same default as the format_style
// setting in spec section 6 step 3. Used only when a caller sends no style.
export const DEFAULT_STYLE = {
  standard: "bullets", sorting: "words", long: "words",
  notes: "bullets", greenscreen: "bullets", vsl: "bullets"
};

export const FORMAT_RULES = {
  standard: {
    closePromises: true,
    words: { minWords: 135 },
    bullets: { cues: { min: 3, max: 8, maxWords: 12 } }
  },
  // Sorting-hat shorts are 115-125 words (Part 0 rule 42); the floor allows
  // about 10% either side. Same range whatever the style.
  sorting: {
    closePromises: true,
    words: { minWords: 104, maxWords: 137 },
    bullets: { minWords: 104, maxWords: 137 }
  },
  long: { closePromises: false },
  notes: { closePromises: false },
  greenscreen: { closePromises: false },
  vsl: { closePromises: false }
};
