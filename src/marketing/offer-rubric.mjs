// The offer rubric, on the server. Stage 3 of the marketing flywheel.
//
// WHERE THIS CAME FROM. .claude/workflows/offer.js is the chat version: six
// candidates from assigned archetypes, four judges with different jobs, one
// winner with the best parts of the losers grafted in. Workflow scripts cannot
// import anything, so that file holds its doctrine inline. This module is the
// same doctrine, word for word where it can be, so the dashboard's "Write offer"
// button and the /flywheel chat command design against the same rules.
//
// WHAT IS DELIBERATELY DIFFERENT FROM THE CHAT VERSION.
//   * The chat version loads extra doctrine from ~/.claude/skills/offer/. That
//     folder is not in this repo (it is not even on the Mac today), so nothing
//     here pretends to have read it. The rules below are only the ones offer.js
//     itself states.
//   * The chat version "grounds" itself by reading a cost-per-call board and the
//     copy directives. The owner's brief for the server version (2026-10-05) is
//     narrower: the prompt may use the supplied summaries and the repo's own
//     offer facts (src/config/offers.mjs) and nothing else. So the cost to get a
//     customer is NOT on file here, and the prompt says so instead of guessing.
//   * The model cannot run node. "Run the arithmetic with node through Bash" is
//     replaced by "show every step", and the price check is done afterwards in
//     plain code (src/marketing/offer-generator.mjs checkPrices).
//
// No compliance wording anywhere in here: CLAUDE.md §7 was removed by the owner
// on 2026-09-08, and 00-OWNER-NOTES.md says the same for this pipeline.

/** Input caps, the same numbers offer.js slices to. */
export const AVATAR_MAX_CHARS = 8000;
export const RESEARCH_MAX_CHARS = 8000;
export const OWNER_NOTES_MAX_CHARS = 2000;

export const NO_INVENTED_PROOF = `HARD RULES:
Every claim names the proof that backs it, and that proof must ALREADY EXIST in what you were given.
If it does not, the claim is DELETED, not softened. Where there is no proof, write
"PROOF: NONE ON FILE - claim removed". No invented testimonials, no invented case-study numbers,
no "clients typically see...". Never invent a fact about Fundhub: if it is not in the buyer
summary, the market summary, the owner notes or the price list below, you do not know it.
Every price traces to the price list below (src/config/offers.mjs), or is marked
"PRICE CHANGE PROPOSED" with the old value beside it.
The 30-day cash rule is arithmetic, not a feeling. Show every step of the numbers.
The cost to get a customer is NOT on file. Do not make one up: write the arithmetic with
"cost to get a customer = not on file" and say what number Chris has to supply.`;

/* Assigned, not discovered. Six writers on one open prompt write six versions of
   the same offer and the judging becomes theatre. Each archetype pulls a
   different lever of the value equation. Copied from offer.js. */
export const ARCHETYPES = Object.freeze([
  { id: "A-dream", lever: "Dream outcome. Same delivery, a different and bigger promised end state. Hold the price." },
  { id: "B-mechanism", lever: "Mechanism. Take the unique named mechanism this business actually has and make it the product. Hold the price." },
  { id: "C-risk", lever: "Perceived likelihood. Lead with risk reversal - a guarantee tied to something the client must measurably do. The price may rise." },
  { id: "D-speed", lever: "Time delay. Compress time to first result. Done-with-you becomes done-for-you. The price may rise." },
  { id: "E-effort", lever: "Effort and sacrifice. Make it easier to say yes by changing the payment terms or what they have to do - NEVER by discounting the same thing. The price may fall but must still clear the 30-day rule." },
  { id: "F-sequence", lever: "Money model. Not one offer but a sequence: something to attract, something to upsell, something recurring. Build it only from offers that already exist on the price list. Show the 30-day cash arithmetic." }
].map(Object.freeze));

export const ARCHETYPE_IDS = Object.freeze(ARCHETYPES.map((a) => a.id));

/** The guarantee shapes offer.js allows. Anything else is not a guarantee. */
export const GUARANTEE_SHAPES = Object.freeze([
  "result-tied-with-make-good",
  "conditional-satisfaction",
  "win-your-money-back",
  "trial-with-penalty",
  "priced-add-on",
  "paid-tier",
  "tied-to-continued-purchase"
]);

export const GUARANTEE_RULES = `BUILD TWO OR THREE GUARANTEES PER OFFER, NOT ONE. An offer with a single vague guarantee
will be scored down hard. The guarantee is how perceived likelihood actually moves, and it is a
transfer of risk, not a marketing line.
Rules for the stack:
- Prefer TIME-BASED guarantees. A window we control is predictable, and this business moves
  people through a known sequence, so a clock is a promise we can keep on purpose.
- Prefer make-goods paid in LABOUR or in work we already staff, never in cash out the door.
- At least one should be CONDITIONAL - the buyer must do something to claim it, and the
  conditions should be the exact behaviours that make them succeed. That is what keeps it cheap.
- Two of them should be able to ROTATE as the lead guarantee. One may be structural.
- Never guarantee a result the buyer controls, and never guarantee anything the proof does not
  support. If a window or a threshold has no number on file, say it needs an owner decision
  rather than inventing one.
- Do not call something a guarantee that is not one. A bonus that makes the result likely is a bonus.
- Each guarantee's "shape" is exactly one of: ${GUARANTEE_SHAPES.join(", ")}.`;

/* Four judges with genuinely different jobs. Copied from offer.js; "run the
   arithmetic with node" became "show the arithmetic", because no tool runs here. */
export const JUDGES = Object.freeze([
  { id: "buyer", job: "You ARE the buyer described in the buyer summary. Judge the GUARANTEES hardest of all - a single vague guarantee, or one with no time window, should sink an offer's perceivedLikelihood score no matter how good the rest reads. Not a marketer looking at them - them. Would you actually hand over this money? What is your first objection? Which one makes you feel stupid for not taking it, and which one smells like every other pitch you have already been burned by?" },
  { id: "operator", job: "You run delivery. Price every guarantee: what does it actually cost us in labour or cash each time one fires, and could a bad month fire several at once? Can Fundhub actually deliver this, every time, at this margin, with the team it has? Kill anything beautiful and unbuildable. Read the buyer summary and the price list for what delivery actually involves." },
  { id: "accountant", job: "Money only. For each offer: gross profit in the first 30 days against the real cost to get a customer. Does it clear 2x? Over a lifetime, does it clear 3:1 against acquisition cost? If the close rate would be above half, the price is too low - say so. The cost to get a customer is not on file; where it decides the answer, say so instead of guessing. Show the arithmetic." },
  { id: "competitor", job: "You are a competitor who wants to take this market. For each offer, try to beat it - cheaper, faster, or with less risk to the buyer. If you can beat it easily, it is a commodity and you should say so. This is the seat that finds the problem a rubric cannot." }
].map(Object.freeze));

export const JUDGE_IDS = Object.freeze(JUDGES.map((j) => j.id));

/* Eight dimensions, 1-10, higher is better on all eight. Weights are offer.js's. */
export const DIMS = Object.freeze([
  "dreamOutcome", "perceivedLikelihood", "timeDelay", "effortSacrifice",
  "incomparability", "proofBacking", "thirtyDayCash", "deliverability"
]);

export const WEIGHT = Object.freeze({
  perceivedLikelihood: 2,
  proofBacking: 1.5,
  incomparability: 1.5,
  thirtyDayCash: 1.5,
  deliverability: 1.25,
  dreamOutcome: 1,
  timeDelay: 1,
  effortSacrifice: 1
});

export const VALUE_EQUATION_KEYS = Object.freeze([
  "dreamOutcome", "perceivedLikelihood", "timeDelay", "effortSacrifice"
]);

/** A winner this close to the runner-up gets a run-off flag (offer.js: 5%). */
export const RUNOFF_MARGIN = 0.05;
/** Judges this far apart on one dimension is a named problem, not noise (offer.js: 4). */
export const SPREAD_ALARM = 4;
/** Fewer candidates than this and nothing is judged (offer.js: 3). */
export const MIN_CANDIDATES = 3;

/** The flywheel's review-card footer, exactly as marketing/flywheel/README.md prints it. */
export const SAY_ONE_OF = "approve · tweak: <what to change> · redo";
