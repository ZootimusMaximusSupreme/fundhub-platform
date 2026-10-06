// The offer generator: six candidates, four judges, one winner, one review card.
//
// THREE MODEL CALLS, IN ORDER, AND EVERYTHING ELSE IS PLAIN CODE.
//
//   1. candidates  — ONE call writes the whole set of six offers, one per
//                    assigned lever (offer-rubric.mjs ARCHETYPES).
//   2. judges      — ONE call seats the four judges (buyer, operator, accountant,
//                    competitor) over the anonymised set. Each seat scores every
//                    offer on eight dimensions, with a kill shot and a best part.
//   3. synthesis   — ONE call writes the winner up with the best parts of the
//                    losers grafted in, and says what it was not sure about.
//
// Parsing, blinding, the arithmetic of the scores, the choice of winner, the
// price check and the review card are pure functions below. offer.js says it
// plainly: "Aggregation is arithmetic and belongs in the script, not in an
// agent." So the tests run all of it with recorded replies and no network.
//
// The model call itself is injected as `ask` (src/marketing/offer-transport.mjs
// in production). This file never touches the network or the database.

import {
  ARCHETYPES, ARCHETYPE_IDS, GUARANTEE_SHAPES, GUARANTEE_RULES, NO_INVENTED_PROOF,
  JUDGES, JUDGE_IDS, DIMS, WEIGHT, VALUE_EQUATION_KEYS,
  RUNOFF_MARGIN, SPREAD_ALARM, MIN_CANDIDATES, SAY_ONE_OF
} from "./offer-rubric.mjs";
import { offerFactsText, knownPriceCents } from "./offer-inputs.mjs";
import { STAGES } from "../../scripts/flywheel/status.mjs";

/* ── ERRORS ──────────────────────────────────────────────────────────────── */

/** A run that stopped on purpose, with a sentence Chris can read. */
export class OfferError extends Error {
  constructor(code, message, partial = null) {
    super(message);
    this.name = "OfferError";
    this.code = code;
    this.partial = partial;
  }
}

/* ── SMALL HELPERS ───────────────────────────────────────────────────────── */

const FIELD_MAX = 1200;
const LIST_MAX = 12;

function str(v, max = FIELD_MAX) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : (typeof v === "number" ? String(v) : "");
  return s.trim().slice(0, max);
}

/* "None" is not a bonus. Measured on the real run (2026-10-05): the write-up
   returned bonuses ["None"], which counted as one bonus. A list entry that only
   says there is nothing is dropped. */
const NOTHING = /^(none|n\/a|na|nothing|-|—)\.?$/i;

function strList(v, max = LIST_MAX) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x) => x && !NOTHING.test(x)).slice(0, max);
}

/** A 1-10 score, or null. A score outside the scale is clamped, not invented. */
export function score(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, n));
}

/* ── PARSING A MODEL REPLY ───────────────────────────────────────────────── */

/**
 * parseJsonReply(text) → object | null
 * The prompts ask for one JSON object and nothing else. Models still wrap it in
 * a code fence or put a sentence in front, so: strip fences, take the outermost
 * {...}, parse. Anything that still does not parse is null, never a guess.
 */
export function parseJsonReply(text) {
  const raw = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const out = JSON.parse(raw.slice(start, end + 1));
    return out && typeof out === "object" && !Array.isArray(out) ? out : null;
  } catch {
    return null;
  }
}

function normalizeGuarantee(g) {
  if (!g || typeof g !== "object") return null;
  const name = str(g.name, 200);
  const promise = str(g.promise);
  if (!name && !promise) return null;
  const shape = GUARANTEE_SHAPES.includes(str(g.shape, 60)) ? str(g.shape, 60) : null;
  return {
    name,
    promise,
    shape,
    conditions: str(g.conditions) || "none",
    whatItCostsUsIfItFires: str(g.whatItCostsUsIfItFires),
    needsOwnerDecision: str(g.needsOwnerDecision) || "none"
  };
}

/**
 * normalizeCandidate(raw) → { candidate, problems }
 * candidate is null when a required part is missing: name, promise, price, at
 * least one thing they get, and all four value-equation scores. offer.js's
 * schema requires exactly those.
 */
export function normalizeCandidate(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") return { candidate: null, problems: ["not an object"] };
  const ve = raw.valueEquation && typeof raw.valueEquation === "object" ? raw.valueEquation : {};
  const valueEquation = {};
  for (const k of VALUE_EQUATION_KEYS) valueEquation[k] = score(ve[k]);

  const candidate = {
    archetype: str(raw.archetype, 40),
    name: str(raw.name, 200),
    promise: str(raw.promise),
    mechanism: str(raw.mechanism),
    price: str(raw.price, 800),
    paymentTerms: str(raw.paymentTerms, 400),
    whatTheyGet: strList(raw.whatTheyGet),
    guarantees: (Array.isArray(raw.guarantees) ? raw.guarantees : [])
      .map(normalizeGuarantee).filter(Boolean).slice(0, 5),
    bonuses: strList(raw.bonuses),
    valueEquation,
    thirtyDayMath: str(raw.thirtyDayMath, 2000),
    proofUsed: strList(raw.proofUsed),
    proofMissing: strList(raw.proofMissing)
  };

  if (!candidate.name) problems.push("no name");
  if (!candidate.promise) problems.push("no promise");
  if (!candidate.price) problems.push("no price");
  if (!candidate.whatTheyGet.length) problems.push("nothing listed under what they get");
  const missingVe = VALUE_EQUATION_KEYS.filter((k) => valueEquation[k] == null);
  if (missingVe.length) problems.push(`no value score for ${missingVe.join(", ")}`);
  return { candidate: problems.length ? null : candidate, problems };
}

/**
 * parseCandidates(text) → { candidates, rejected }
 * Each kept candidate carries its archetype. A reply that names an archetype we
 * did not assign, or names one twice, gets the next unused one in order — the
 * lever list is what was asked for, so position is the fallback.
 */
export function parseCandidates(text) {
  const obj = parseJsonReply(text);
  const list = obj && Array.isArray(obj.candidates) ? obj.candidates : [];
  const used = new Set();
  const candidates = [];
  const rejected = [];
  list.slice(0, ARCHETYPES.length).forEach((raw, i) => {
    const { candidate, problems } = normalizeCandidate(raw);
    if (!candidate) {
      rejected.push({ position: i + 1, problems });
      return;
    }
    let arch = ARCHETYPE_IDS.includes(candidate.archetype) && !used.has(candidate.archetype)
      ? candidate.archetype
      : ARCHETYPE_IDS.find((id) => !used.has(id));
    used.add(arch);
    candidates.push({ ...candidate, archetype: arch });
  });
  return { candidates, rejected, parsed: !!obj };
}

/* ── BLINDING ────────────────────────────────────────────────────────────── */

/* A seeded order, so the judges cannot learn that "Offer A" is always the dream
   offer, and so the same job always produces the same order (a re-read of a
   saved run matches what the judges saw). FNV-1a into mulberry32. */
function seededRandom(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed || "offer")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** blindCandidates(candidates, seed) → the same candidates, reordered, each with a blindId. */
export function blindCandidates(candidates, seed) {
  const rand = seededRandom(seed);
  const order = candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((idx, pos) => ({ ...candidates[idx], blindId: `Offer ${"ABCDEF"[pos]}` }));
}

/** What the judges see: everything but the archetype. */
export function blindView(blinded) {
  return blinded.map(({ archetype: _a, ...rest }) => rest);
}

/* ── JUDGES ──────────────────────────────────────────────────────────────── */

/**
 * parsePanels(text, blindIds) → panels
 * Keeps only the four seats we seated (first answer per seat) and only offers
 * that exist. A score outside 1-10 is clamped; a missing one stays missing and
 * is skipped by the average rather than counted as a zero.
 */
export function parsePanels(text, blindIds) {
  const obj = parseJsonReply(text);
  const raw = obj && Array.isArray(obj.panels) ? obj.panels : [];
  const known = new Set(blindIds);
  const seen = new Set();
  const panels = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const seat = str(p.seat, 40).toLowerCase();
    if (!JUDGE_IDS.includes(seat) || seen.has(seat)) continue;
    seen.add(seat);
    const scored = new Set();
    const scores = [];
    for (const s of Array.isArray(p.scores) ? p.scores : []) {
      if (!s || typeof s !== "object") continue;
      const blindId = str(s.blindId, 20);
      if (!known.has(blindId) || scored.has(blindId)) continue;
      scored.add(blindId);
      const d = s.dims && typeof s.dims === "object" ? s.dims : {};
      const dims = {};
      for (const k of DIMS) dims[k] = score(d[k]);
      scores.push({ blindId, dims, killShot: str(s.killShot, 600), bestPart: str(s.bestPart, 600) });
    }
    panels.push({ seat, scores });
  }
  return panels;
}

/**
 * aggregate(blinded, panels) → one row per candidate
 * Straight port of offer.js. A dimension nobody scored is skipped, not averaged
 * in as zero, and a candidate nobody scored has weighted = null — an unjudged
 * offer must not look like a rejected one.
 */
export function aggregate(blinded, panels) {
  return blinded.map((c) => {
    const rows = panels.flatMap((p) => p.scores
      .filter((s) => s.blindId === c.blindId)
      .map((s) => ({ ...s, seat: p.seat })));
    const per = {};
    let weighted = 0;
    let wsum = 0;
    for (const d of DIMS) {
      const vals = rows.map((r) => r.dims[d]).filter((n) => typeof n === "number" && Number.isFinite(n));
      if (!vals.length) { per[d] = { mean: null, spread: 0 }; continue; }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      per[d] = { mean: Math.round(mean * 10) / 10, spread: Math.max(...vals) - Math.min(...vals) };
      weighted += mean * WEIGHT[d];
      wsum += WEIGHT[d];
    }
    const widest = DIMS.reduce((best, d) => (per[d].spread > (per[best]?.spread ?? -1) ? d : best), DIMS[0]);
    return {
      blindId: c.blindId,
      archetype: c.archetype,
      name: c.name,
      judgeCount: rows.length,
      seats: rows.map((r) => r.seat),
      weighted: wsum ? Math.round((weighted / wsum) * 100) / 100 : null,
      dims: per,
      maxSpread: Math.max(0, ...DIMS.map((d) => per[d].spread)),
      widestDim: per[widest].spread > 0 ? widest : null,
      killShots: rows.map((r) => r.killShot).filter(Boolean),
      bestParts: rows.map((r) => r.bestPart).filter(Boolean)
    };
  });
}

/**
 * rank(aggregated) → { judged, unjudged, winner, runnerUp, runoffAdvised }
 * Highest weighted score wins. Ties go to the earlier blind letter so the answer
 * never depends on sort stability.
 */
export function rank(aggregated) {
  const unjudged = aggregated.filter((a) => a.weighted === null);
  const judged = aggregated.filter((a) => a.weighted !== null)
    .sort((a, b) => (b.weighted - a.weighted) || a.blindId.localeCompare(b.blindId));
  const winner = judged[0] || null;
  const runnerUp = judged[1] || null;
  const runoffAdvised = !!(winner && runnerUp &&
    (winner.weighted - runnerUp.weighted) / (winner.weighted || 1) < RUNOFF_MARGIN);
  return { judged, unjudged, winner, runnerUp, runoffAdvised };
}

/* ── SYNTHESIS ───────────────────────────────────────────────────────────── */

/** parseSynthesis(text) → { offer, review } | null */
export function parseSynthesis(text) {
  const obj = parseJsonReply(text);
  if (!obj || !obj.offer || typeof obj.offer !== "object") return null;
  const o = obj.offer;
  const offer = {
    oneSentence: str(o.oneSentence, 600),
    name: str(o.name, 200),
    price: str(o.price, 800),
    whyThisPrice: str(o.whyThisPrice),
    whatTheyGet: strList(o.whatTheyGet),
    guarantees: (Array.isArray(o.guarantees) ? o.guarantees : [])
      .map(normalizeGuarantee).filter(Boolean).slice(0, 5),
    bonuses: strList(o.bonuses),
    tookFromLosers: (Array.isArray(o.tookFromLosers) ? o.tookFromLosers : [])
      .filter((t) => t && typeof t === "object")
      .map((t) => ({ from: str(t.from, 40), what: str(t.what), why: str(t.why) }))
      .filter((t) => t.what).slice(0, LIST_MAX),
    killShotsAnswered: (Array.isArray(o.killShotsAnswered) ? o.killShotsAnswered : [])
      .filter((k) => k && typeof k === "object")
      .map((k) => ({ killShot: str(k.killShot), whatWeDid: str(k.whatWeDid) }))
      .filter((k) => k.killShot).slice(0, LIST_MAX),
    thirtyDayMath: str(o.thirtyDayMath, 2000),
    claimsRemoved: strList(o.claimsRemoved)
  };
  if (!offer.name || !offer.price || !offer.whatTheyGet.length) return null;
  const r = obj.review && typeof obj.review === "object" ? obj.review : {};
  return {
    offer,
    review: { whatThisDecided: str(r.whatThisDecided, 600), notSureAbout: strList(r.notSureAbout, 8) }
  };
}

/** The winner as written, when the write-up step did not come back. */
export function offerFromCandidate(c) {
  return {
    oneSentence: c.promise,
    name: c.name,
    price: c.price + (c.paymentTerms ? ` (${c.paymentTerms})` : ""),
    whyThisPrice: "",
    whatTheyGet: c.whatTheyGet,
    guarantees: c.guarantees,
    bonuses: c.bonuses,
    tookFromLosers: [],
    killShotsAnswered: [],
    thirtyDayMath: c.thirtyDayMath,
    claimsRemoved: c.proofMissing
  };
}

/* ── THE PRICE CHECK ─────────────────────────────────────────────────────── */

/** Every "$1,000" / "$10k" / "$297.00" in a piece of text, as whole cents. */
export function dollarAmounts(text) {
  const out = [];
  // Thousands commas only inside the number: "$297, then" is $297, not "297,".
  const re = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*([kK])?\b/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push({ text: m[0].trim(), cents: Math.round(n * (m[2] ? 1000 : 1) * 100) });
  }
  return out;
}

/**
 * checkPrices(offer, known) → [plain sentences]
 * offer.js: "Every price traces to src/config/offers.mjs, or is marked PRICE
 * CHANGE PROPOSED with the old value beside it." Checked here in code, on the
 * price line only — the 30-day arithmetic legitimately contains other dollar
 * figures (profit, totals) that are not prices.
 */
export function checkPrices(offer, known = knownPriceCents()) {
  const issues = [];
  const line = String(offer && offer.price || "");
  const amounts = dollarAmounts(line);
  if (!amounts.length) {
    issues.push("The price line does not name a dollar amount.");
    return issues;
  }
  const proposed = /price change proposed/i.test(line);
  for (const a of amounts) {
    if (known.has(a.cents)) continue;
    issues.push(proposed
      ? `The price ${a.text} is a proposed change: it is not on the price list yet (src/config/offers.mjs).`
      : `The price ${a.text} is not on the price list (src/config/offers.mjs) and is not marked as a proposed change.`);
  }
  return issues;
}

/* ── THE FLYWHEEL GATE ───────────────────────────────────────────────────── */

/* The same minimums `npm run flywheel:status` holds stage 3 to
   (scripts/flywheel/status.mjs STAGES): read from there, not copied. A thin
   offer is reported on the card, never padded — an invented bonus is an
   invented fact about Fundhub. */
export const OFFER_GATES = Object.freeze({ ...((STAGES.find((st) => st.key === "offer") || {}).gates || {}) });

const GATE_WORDS = { priceSet: "price", bonuses: "bonuses", valueEquationScores: "value scores", guarantees: "guarantees" };

/** gateMisses(counts) → one plain sentence per minimum this offer does not meet. */
export function gateMisses(counts, gates = OFFER_GATES) {
  return Object.entries(gates)
    .filter(([k, min]) => (Number(counts && counts[k]) || 0) < min)
    .map(([k, min]) => `The flywheel's stage 3 check wants at least ${min} ${GATE_WORDS[k] || k}; this offer has ${Number(counts && counts[k]) || 0}.`);
}

/* ── THE REVIEW CARD ─────────────────────────────────────────────────────── */

const DIM_WORDS = {
  dreamOutcome: "how big the promised result is",
  perceivedLikelihood: "how sure the buyer feels it will work",
  timeDelay: "how fast the first result comes",
  effortSacrifice: "how easy it is for the buyer",
  incomparability: "how hard it is to compare on price",
  proofBacking: "whether the proof on file backs it",
  thirtyDayCash: "the first 30 days of cash",
  deliverability: "whether we can deliver it every time"
};

/**
 * buildReviewCard(parts) → { whatThisDecided, threeThingsToCheck, notSureAbout, sayOneOf, markdown }
 * The flywheel's own block (marketing/flywheel/README.md), filled from the run.
 * The three checks are offer.js's three, with the real price put in.
 */
/* The price as the review card asks about it: the line itself when it is short,
   else its dollar figures. Measured on the real run: the model wrote a 400-character
   price line, and "The price is <a paragraph> — yes or no?" is not a question. */
export function shortPrice(price) {
  const line = String(price || "").trim();
  if (!line) return "not set";
  if (line.length <= 120) return line;
  const amounts = dollarAmounts(line).map((a) => a.text);
  if (amounts.length) return [...new Set(amounts)].join(", ") + " (see the price section)";
  return line.slice(0, 117).trimEnd() + "…";
}

export function buildReviewCard({
  offer, winner, runnerUp, runoffAdvised, unjudged = [], candidateCount = 0,
  priceIssues = [], modelReview = null, synthesized = true, synthesisProblem = null,
  winnerCandidate = null, research = true, gateMisses = []
}) {
  const decided = (modelReview && modelReview.whatThisDecided) ||
    `Sell "${offer.name}" at ${offer.price}.`;
  const three = [
    `The price is ${shortPrice(offer.price)} — yes or no?`,
    "Can we deliver this every time?",
    "Can we afford the guarantee if three people claim it?"
  ];

  const notSure = [];
  if (!synthesized) {
    notSure.push(`The final write-up step did not come back (${synthesisProblem || "no reason given"}), so this is the winning offer exactly as first written, with nothing taken from the others.`);
  }
  for (const p of priceIssues) notSure.push(p);
  for (const g of gateMisses) notSure.push(g);
  if (unjudged.length) {
    notSure.push(`${unjudged.length} of ${candidateCount} offers were never scored by any judge (${unjudged.map((u) => u.archetype).join(", ")}). The winner was picked from ${candidateCount - unjudged.length}, not ${candidateCount}.`);
  }
  if (winner && winner.maxSpread >= SPREAD_ALARM && winner.widestDim) {
    notSure.push(`The judges disagreed by ${winner.maxSpread} points on ${DIM_WORDS[winner.widestDim] || winner.widestDim} for the winner. That is a real split, not noise.`);
  }
  if (runoffAdvised && runnerUp) {
    notSure.push(`The runner-up ("${runnerUp.name}", ${runnerUp.archetype}) scored within 5% of the winner (${runnerUp.weighted} vs ${winner.weighted}). A run-off between the two is worth it.`);
  }
  if (!research) notSure.push("No ad research was on file, so the offer was designed from the buyer summary alone.");
  for (const g of offer.guarantees || []) {
    if (g.needsOwnerDecision && !/^none\.?$/i.test(g.needsOwnerDecision)) {
      notSure.push(`Guarantee "${g.name || g.promise}" needs a decision from Chris: ${g.needsOwnerDecision}`);
    }
  }
  if (modelReview) for (const n of modelReview.notSureAbout || []) notSure.push(n);
  if (winnerCandidate && winnerCandidate.proofMissing.length && !synthesized) {
    notSure.push(`Proof not on file: ${winnerCandidate.proofMissing.slice(0, 3).join("; ")}`);
  }
  const unique = [...new Set(notSure.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
  const notSureAbout = unique.length ? unique : ["nothing"];

  const markdown = [
    "## Review card",
    "",
    `**What this decided:** ${decided}`,
    "",
    `**Three things to check:** ${three.join(" · ")}`,
    "",
    `**What I wasn't sure about:** ${notSureAbout.length === 1 ? notSureAbout[0] : "\n" + notSureAbout.map((n) => `- ${n}`).join("\n")}`,
    "",
    `**Say one of:** ${SAY_ONE_OF}`
  ].join("\n");

  return { whatThisDecided: decided, threeThingsToCheck: three, notSureAbout, sayOneOf: SAY_ONE_OF, markdown };
}

/* ── THE DOCUMENT ────────────────────────────────────────────────────────── */

function bullets(items, empty = "none") {
  return items && items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

/** renderOfferDocument(...) → markdown, the nine sections offer.js writes, then the review card. */
export function renderOfferDocument({ campaign, asOf, offer, reviewCard }) {
  const g = (offer.guarantees || []).map((x) =>
    `- **${x.name || "Guarantee"}** — ${x.promise}` +
    (x.conditions && !/^none\.?$/i.test(x.conditions) ? ` To claim it: ${x.conditions}.` : "") +
    (x.whatItCostsUsIfItFires ? ` If it fires, it costs us: ${x.whatItCostsUsIfItFires}.` : ""));
  return [
    `# Offer — ${campaign}`,
    `As of ${asOf}.`,
    "",
    "## 1. The offer in one sentence", "", offer.oneSentence || offer.name, "",
    "## 2. The price, and why that number", "", offer.price + (offer.whyThisPrice ? `\n\n${offer.whyThisPrice}` : ""), "",
    "## 3. What they get", "", bullets(offer.whatTheyGet), "",
    "## 4. The guarantee", "", g.length ? g.join("\n") : "- none", "",
    "## 5. The bonuses", "", bullets(offer.bonuses), "",
    "## 6. What we took from the offers that lost, and why", "",
    bullets((offer.tookFromLosers || []).map((t) => `${t.what}${t.from ? ` (from ${t.from})` : ""}${t.why ? ` — ${t.why}` : ""}`)), "",
    "## 7. What the judges wanted to kill, and what we did about each one", "",
    bullets((offer.killShotsAnswered || []).map((k) => `${k.killShot}${k.whatWeDid ? ` → ${k.whatWeDid}` : ""}`)), "",
    "## 8. The 30-day cash arithmetic", "", offer.thirtyDayMath || "Not shown.", "",
    "## 9. What we could not prove — claims removed for lack of proof", "", bullets(offer.claimsRemoved), "",
    reviewCard.markdown,
    ""
  ].join("\n");
}

/* ── THE PROMPTS ─────────────────────────────────────────────────────────── */

export const SYSTEM = [
  "You design offers for Fundhub, a business-funding company, following a fixed rubric.",
  "You reply with ONE JSON object and nothing else: no markdown, no code fences, no commentary.",
  "Plain words, short sentences. The owner, Chris, does not read code."
].join("\n");

function ownerBlock(notes) {
  return notes ? `\nCORRECTIONS CHRIS HAS ALREADY MADE — these override everything above:\n${notes}\n` : "";
}

export function candidatesPrompt({ campaign, avatarSummary, adResearchSummary, ownerNotes, facts = offerFactsText() }) {
  const levers = ARCHETYPES.map((a) => `- ${a.id}: ${a.lever}`).join("\n");
  return `Design SIX offers for the "${campaign}" campaign — one for each assigned lever below, in this order.
Each one pulls ITS lever. Do not hedge toward the middle and do not write six versions of the same offer.

ASSIGNED LEVERS:
${levers}

THE BUYER:
${avatarSummary}

WHAT THE MARKET IS ALREADY SELLING (do not repeat a worn-out angle):
${adResearchSummary || "No ad research was supplied — design from the buyer summary and say so in proofMissing."}

THE REAL NUMBERS — prices and locked terms. These are facts, not suggestions:
${facts}
${ownerBlock(ownerNotes)}
${GUARANTEE_RULES}

Score each offer's value equation 1-10 on each driver (10 = best for the buyer: biggest dream,
most likely to work, fastest, least effort). Be honest; a judge panel scores them next and
inflated self-scores just look wrong.

Show the 30-day cash arithmetic for each: gross profit from one customer in their first 30 days
against what it costs to get them.

${NO_INVENTED_PROOF}

Reply with exactly this JSON shape, six candidates, in the lever order above. Keep every field short.
{"candidates":[{"archetype":"A-dream","name":"","promise":"","mechanism":"","price":"","paymentTerms":"","whatTheyGet":[""],"guarantees":[{"name":"","promise":"the guarantee in the buyer's words, with its time window","shape":"one of the allowed shapes","conditions":"what the buyer must do to claim it, or none","whatItCostsUsIfItFires":"","needsOwnerDecision":"any number Chris must set, or none"}],"bonuses":[""],"valueEquation":{"dreamOutcome":0,"perceivedLikelihood":0,"timeDelay":0,"effortSacrifice":0},"thirtyDayMath":"","proofUsed":[""],"proofMissing":[""]}]}`;
}

export function judgesPrompt({ avatarSummary, blinded, facts = offerFactsText() }) {
  const seats = JUDGES.map((j) => `- ${j.id}: ${j.job}`).join("\n");
  return `You are a panel of four judges scoring the same set of offers. Each seat has its own job.
Judge from that seat's job, not from a general sense of quality, and keep the seats independent:
they are supposed to disagree.

THE SEATS:
${seats}

THE BUYER:
${avatarSummary}

THE REAL NUMBERS:
${facts}

THE OFFERS (anonymised — judge the offer, not the label):
${JSON.stringify(blindView(blinded)).slice(0, 24000)}

Every seat scores EVERY offer on all eight dimensions, 1 to 10. Higher is better on all eight,
including timeDelay and effortSacrifice — a 10 there means fastest and easiest for the buyer.
  dreamOutcome, perceivedLikelihood, timeDelay, effortSacrifice,
  incomparability (could a buyer put this beside a competitor and pick on price?),
  proofBacking (does proof that ALREADY EXISTS support every claim?),
  thirtyDayCash, deliverability
For every offer each seat also gives a killShot (the strongest single reason to reject it) and a
bestPart (the one element worth keeping even if it loses). The bestPart matters as much as the
score: it is how the winning offer gets the good parts of the losing ones.

Reply with exactly this JSON shape: four panels, one per seat (${JUDGE_IDS.join(", ")}), each scoring every offer.
{"panels":[{"seat":"buyer","scores":[{"blindId":"Offer A","dims":{${DIMS.map((d) => `"${d}":0`).join(",")}},"killShot":"","bestPart":""}]}]}`;
}

export function synthesisPrompt({ campaign, winnerCandidate, winner, judged, unjudged, candidateCount, ownerNotes, facts = offerFactsText() }) {
  const losers = judged.slice(1)
    .map((a) => `${a.archetype}: ${a.bestParts.join(" | ") || "nothing named"}`).join("\n").slice(0, 6000);
  const scores = JSON.stringify(judged.map((a) => ({
    archetype: a.archetype, weighted: a.weighted, maxSpread: a.maxSpread, judges: a.judgeCount
  }))).slice(0, 2000);
  const notes = [];
  if (unjudged.length) {
    notes.push(`NOTE: ${unjudged.length} candidate(s) were never scored by any judge (${unjudged.map((u) => u.archetype).join(", ")}). The winner was chosen from ${candidateCount - unjudged.length} of ${candidateCount}. Say so — do not present this as a full six-way comparison.`);
  }
  if (winner.maxSpread >= SPREAD_ALARM) {
    notes.push(`NOTE: the judges disagreed by ${winner.maxSpread} points on at least one dimension for the winning offer. That is a specific problem, not noise. Name it rather than averaging it away.`);
  }
  return `Write the final offer for the "${campaign}" campaign.

THE WINNER (${winner.blindId}, ${winner.archetype}, weighted ${winner.weighted}):
${JSON.stringify(winnerCandidate).slice(0, 8000)}

WHAT THE JUDGES SAID TO KILL ABOUT IT:
${winner.killShots.map((k) => `- ${k}`).join("\n") || "- nothing"}

THE BEST PARTS OF THE OFFERS THAT LOST — graft the ones that fit, and name what you took:
${losers || "none"}

SCORES, including where the judges disagreed most:
${scores}
${notes.length ? "\n" + notes.join("\n") + "\n" : ""}
THE REAL NUMBERS:
${facts}
${ownerBlock(ownerNotes)}
Plain words, short sentences. Chris does not read code.

${NO_INVENTED_PROOF}

Reply with exactly this JSON shape. "review.whatThisDecided" is one sentence. "review.notSureAbout"
lists what you were not sure about, or is empty.
{"offer":{"oneSentence":"","name":"","price":"one short line, under 120 characters — the detail goes in whyThisPrice","whyThisPrice":"","whatTheyGet":[""],"guarantees":[{"name":"","promise":"","shape":"","conditions":"","whatItCostsUsIfItFires":"","needsOwnerDecision":""}],"bonuses":[""],"tookFromLosers":[{"from":"archetype id","what":"","why":""}],"killShotsAnswered":[{"killShot":"","whatWeDid":""}],"thirtyDayMath":"","claimsRemoved":[""]},"review":{"whatThisDecided":"","notSureAbout":[""]}}`;
}

/* ── MODEL FAILURES IN PLAIN WORDS ───────────────────────────────────────── */

/** plainModelFailure(reply) → a sentence, or null when the reply is usable. */
export function plainModelFailure(reply) {
  if (!reply) return "no answer came back";
  if (reply.timedOut) return "it took too long and was stopped";
  if (reply.mode === "shadow") return "no Anthropic key is set on this site";
  const status = Number(reply.status) || null;
  if (reply.error || status) {
    const e = String(reply.error || "").toLowerCase();
    if (status === 401 || status === 403) return "Anthropic refused the key on this site";
    if (/credit balance|insufficient|quota|billing/.test(e)) return "the Anthropic account is out of credit";
    if (status === 429) return "Anthropic said to slow down (rate limit)";
    if (status === 529 || (status && status >= 500)) return "Anthropic was overloaded or down";
    if (status === 400) return `Anthropic refused the request (${String(reply.error).slice(0, 160)})`;
    if (reply.error) return `the call failed (${String(reply.error).slice(0, 160)})`;
  }
  if (reply.stopReason === "refusal") return "the model declined to write it";
  if (!reply.text) {
    return reply.stopReason === "max_tokens"
      ? "the answer ran out of room before it finished"
      : "the answer came back empty";
  }
  return null;
}

/* ── THE RUN ─────────────────────────────────────────────────────────────── */

/* Room per call, thinking included. Measured on the one real run (2026-10-05,
   claude-opus-5-5): the six-offer call used 12,931 output tokens of 16,000 and
   the judges 10,204, at about 110 tokens a second. A reply cut off at the cap is
   unparseable JSON and the whole run fails, so the cap sits well above that. */
export const STEP_MAX_TOKENS = 24000;

function addUsage(usage, step, reply) {
  const u = (reply && reply.usage) || {};
  const row = {
    step,
    model: (reply && reply.model) || null,
    input_tokens: Number(u.input_tokens) || 0,
    output_tokens: Number(u.output_tokens) || 0,
    stop_reason: (reply && reply.stopReason) || null
  };
  usage.calls.push(row);
  usage.input_tokens += row.input_tokens;
  usage.output_tokens += row.output_tokens;
}

/**
 * generateOffer({ inputs, ask, seed, today, timeLeft }) → result
 *
 * inputs: { campaign, avatarSummary, adResearchSummary, ownerNotes, sources?, cut? }
 * ask({ step, system, user, maxTokens, timeoutMs }) → { text, error, status, mode, usage, model, stopReason, timedOut }
 * timeLeft(): ms left before the caller's own deadline (the 15-minute background limit).
 *
 * Throws OfferError (with whatever it had so far as `partial`) when it cannot
 * honestly produce a winner. Never fills a gap with a guess.
 */
export async function generateOffer({
  inputs, ask, seed = "offer", today = null,
  timeLeft = () => Infinity, stepTimeoutMs = 270_000
}) {
  const facts = offerFactsText();
  const usage = { calls: [], input_tokens: 0, output_tokens: 0 };
  const budget = () => {
    const left = timeLeft() - 30_000;
    if (left < 20_000) {
      throw new OfferError("out_of_time", "The writer ran out of time before it finished. Nothing was chosen. Press Write offer again.", { usage });
    }
    return Math.min(stepTimeoutMs, left);
  };

  // 1 — six candidates, one call.
  const r1 = await ask({ step: "candidates", system: SYSTEM, user: candidatesPrompt({ ...inputs, facts }), maxTokens: STEP_MAX_TOKENS, timeoutMs: budget() });
  addUsage(usage, "candidates", r1);
  const fail1 = plainModelFailure(r1);
  if (fail1) throw new OfferError("model_failed", `The first step (six offers) did not work: ${fail1}. Nothing was chosen.`, { usage });
  const { candidates, rejected } = parseCandidates(r1.text);
  if (candidates.length < MIN_CANDIDATES) {
    throw new OfferError("too_few_candidates",
      `Only ${candidates.length} of 6 offers came back complete. Too few to judge between. Nothing was chosen.`,
      { usage, candidates, rejected });
  }

  // 2 — the four judges over the blinded set, one call.
  const blinded = blindCandidates(candidates, seed);
  const r2 = await ask({ step: "judges", system: SYSTEM, user: judgesPrompt({ avatarSummary: inputs.avatarSummary, blinded, facts }), maxTokens: STEP_MAX_TOKENS, timeoutMs: budget() });
  addUsage(usage, "judges", r2);
  const fail2 = plainModelFailure(r2);
  if (fail2) throw new OfferError("model_failed", `The judging step did not work: ${fail2}. Nothing was chosen.`, { usage, candidates: blinded });
  const panels = parsePanels(r2.text, blinded.map((c) => c.blindId));
  const aggregated = aggregate(blinded, panels);
  const { judged, unjudged, winner, runnerUp, runoffAdvised } = rank(aggregated);
  if (!winner) {
    throw new OfferError("not_judged", "No offer was scored by any judge. Nothing can be chosen.", { usage, candidates: blinded, panels });
  }
  const winnerCandidate = blinded.find((c) => c.blindId === winner.blindId);

  // 3 — the write-up, one call. If it fails, the winner stands as written.
  let synthesized = false;
  let synthesisProblem = null;
  let offer = offerFromCandidate(winnerCandidate);
  let modelReview = null;
  let r3 = null;
  try {
    r3 = await ask({
      step: "synthesis", system: SYSTEM,
      user: synthesisPrompt({ campaign: inputs.campaign, winnerCandidate: blindView([winnerCandidate])[0], winner, judged, unjudged, candidateCount: blinded.length, ownerNotes: inputs.ownerNotes, facts }),
      maxTokens: STEP_MAX_TOKENS, timeoutMs: budget()
    });
  } catch (err) {
    if (err instanceof OfferError) synthesisProblem = "there was no time left to write it up";
    else synthesisProblem = `the call failed (${String(err && err.message || err).slice(0, 120)})`;
  }
  if (r3) {
    addUsage(usage, "synthesis", r3);
    const fail3 = plainModelFailure(r3);
    const parsed = fail3 ? null : parseSynthesis(r3.text);
    if (parsed) {
      offer = parsed.offer;
      modelReview = parsed.review;
      synthesized = true;
    } else {
      synthesisProblem = fail3 || "the answer did not come back in the agreed shape";
    }
  }

  const priceIssues = checkPrices(offer);
  const counts = {
    priceSet: offer.price ? 1 : 0,
    bonuses: offer.bonuses.length,
    guarantees: offer.guarantees.length,
    valueEquationScores: VALUE_EQUATION_KEYS.filter((k) => winnerCandidate.valueEquation[k] != null).length
  };
  const misses = gateMisses(counts);
  const reviewCard = buildReviewCard({
    offer, winner, runnerUp, runoffAdvised, unjudged, candidateCount: blinded.length,
    priceIssues, modelReview, synthesized, synthesisProblem, winnerCandidate,
    research: !!inputs.adResearchSummary, gateMisses: misses
  });
  const asOf = today || new Date().toISOString().slice(0, 10);
  const document = renderOfferDocument({ campaign: inputs.campaign, asOf, offer, reviewCard });

  const brief = (a) => a && {
    blindId: a.blindId, archetype: a.archetype, name: a.name,
    weighted: a.weighted, maxSpread: a.maxSpread, judgeCount: a.judgeCount
  };

  return {
    campaign: inputs.campaign,
    asOf,
    offer,
    reviewCard,
    document,
    synthesized,
    winner: brief(winner),
    runnerUp: brief(runnerUp),
    runoffAdvised,
    scores: judged.map((a) => ({ ...brief(a), dims: a.dims, seats: a.seats })),
    unjudged: unjudged.map((u) => u.archetype),
    candidates: blinded,
    rejectedCandidates: rejected,
    counts,
    checks: { priceIssues, gate: { passes: misses.length === 0, misses } },
    inputs: { sources: inputs.sources || null, cut: inputs.cut || null },
    usage
  };
}
