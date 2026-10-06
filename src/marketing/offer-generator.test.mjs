// The offer generator's pure parts and its three-call run, with recorded
// replies. No network: `ask` is a fake that hands back the recorded text.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJsonReply, normalizeCandidate, parseCandidates, blindCandidates, blindView,
  parsePanels, aggregate, rank, parseSynthesis, dollarAmounts, checkPrices,
  buildReviewCard, plainModelFailure, generateOffer, OfferError,
  candidatesPrompt, judgesPrompt, synthesisPrompt, SYSTEM
} from "./offer-generator.mjs";
import { ARCHETYPE_IDS, DIMS, WEIGHT, NO_INVENTED_PROOF, GUARANTEE_RULES } from "./offer-rubric.mjs";
import { offerFactsText } from "./offer-inputs.mjs";
import { CANDIDATES_TEXT, SYNTHESIS_TEXT, panelsText } from "./fixtures/offer-replies.mjs";

const INPUTS = {
  campaign: "partner",
  avatarSummary: "AVATAR: owners of small credit and funding shops who want their own brand.",
  adResearchSummary: "RESEARCH: competitors sell white-label credit software at $97-$497 a month.",
  ownerNotes: "2026-08-31 | all | no riders on anything built on the avatar.",
  sources: { avatar: "supplied", adResearch: "supplied", ownerNotes: "supplied" },
  cut: { avatar: false, adResearch: false, ownerNotes: false }
};

/** A fake `ask` that answers each step from a script and records what it was asked. */
function scriptedAsk(script) {
  const calls = [];
  const ask = async (args) => {
    calls.push(args);
    const answer = script[args.step];
    const reply = typeof answer === "function" ? answer(args) : answer;
    return { mode: "live", status: null, error: null, stopReason: "end_turn", timedOut: false,
      usage: { input_tokens: 100, output_tokens: 50 }, model: "claude-opus-5-5", ...reply };
  };
  return { ask, calls };
}

/* Pull the blind ids out of the judges' prompt, the way the real model sees them. */
function blindIdsFrom(prompt) {
  return [...new Set([...prompt.matchAll(/"blindId":"(Offer [A-F])"/g)].map((m) => m[1]))];
}

test("parseJsonReply takes the object out of fences and prose, and refuses junk", () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('Here you go: {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  assert.equal(parseJsonReply("no json here"), null);
  assert.equal(parseJsonReply('{"a":'), null);
  assert.equal(parseJsonReply("[1,2]"), null);
  assert.equal(parseJsonReply(null), null);
});

test("a candidate missing a price or a value score is rejected, with the reason", () => {
  const good = JSON.parse(CANDIDATES_TEXT).candidates[0];
  assert.ok(normalizeCandidate(good).candidate);
  const noPrice = normalizeCandidate({ ...good, price: "" });
  assert.equal(noPrice.candidate, null);
  assert.ok(noPrice.problems.includes("no price"));
  const noScore = normalizeCandidate({ ...good, valueEquation: { dreamOutcome: 5 } });
  assert.equal(noScore.candidate, null);
  assert.match(noScore.problems.join(" "), /perceivedLikelihood/);
  // A score off the scale is clamped, not dropped and not trusted.
  const loud = normalizeCandidate({ ...good, valueEquation: { dreamOutcome: 99, perceivedLikelihood: -3, timeDelay: "7", effortSacrifice: 5 } });
  assert.deepEqual(loud.candidate.valueEquation, { dreamOutcome: 10, perceivedLikelihood: 1, timeDelay: 7, effortSacrifice: 5 });
  // An unknown guarantee shape is not passed through as if it were allowed.
  const odd = normalizeCandidate({ ...good, guarantees: [{ name: "x", promise: "y", shape: "pinky-swear" }] });
  assert.equal(odd.candidate.guarantees[0].shape, null);
});

test("parseCandidates keeps six, each with its lever; a bad or repeated lever gets the next free one", () => {
  const { candidates, rejected } = parseCandidates(CANDIDATES_TEXT);
  assert.equal(candidates.length, 6);
  assert.deepEqual(candidates.map((c) => c.archetype), ARCHETYPE_IDS);
  assert.deepEqual(rejected, []);

  const list = JSON.parse(CANDIDATES_TEXT).candidates;
  list[1].archetype = "A-dream"; // repeated
  list[2].archetype = "Z-made-up"; // unknown
  list[3].price = ""; // incomplete
  const again = parseCandidates(JSON.stringify({ candidates: list }));
  assert.equal(again.candidates.length, 5);
  assert.equal(new Set(again.candidates.map((c) => c.archetype)).size, 5);
  assert.deepEqual(again.rejected, [{ position: 4, problems: ["no price"] }]);
});

test("blinding is seeded: same job, same order; the judges never see the lever", () => {
  const { candidates } = parseCandidates(CANDIDATES_TEXT);
  const a = blindCandidates(candidates, "job-1");
  const b = blindCandidates(candidates, "job-1");
  assert.deepEqual(a.map((c) => c.archetype), b.map((c) => c.archetype));
  assert.deepEqual(a.map((c) => c.blindId), ["Offer A", "Offer B", "Offer C", "Offer D", "Offer E", "Offer F"]);
  assert.deepEqual([...a.map((c) => c.archetype)].sort(), [...ARCHETYPE_IDS].sort());
  const orders = new Set(["s1", "s2", "s3", "s4", "s5"].map((s) => blindCandidates(candidates, s).map((c) => c.archetype).join()));
  assert.ok(orders.size > 1, "different jobs should not all get the same order");
  for (const c of blindView(a)) assert.equal("archetype" in c, false);
});

test("parsePanels keeps the four seats and the real offers only", () => {
  const text = JSON.stringify({ panels: [
    { seat: "Buyer", scores: [{ blindId: "Offer A", dims: { dreamOutcome: 12 }, killShot: "k", bestPart: "b" }, { blindId: "Offer Z", dims: {} }] },
    { seat: "buyer", scores: [{ blindId: "Offer A", dims: { dreamOutcome: 1 } }] }, // a second buyer seat is ignored
    { seat: "astrologer", scores: [{ blindId: "Offer A", dims: { dreamOutcome: 1 } }] }
  ] });
  const panels = parsePanels(text, ["Offer A", "Offer B"]);
  assert.equal(panels.length, 1);
  assert.equal(panels[0].seat, "buyer");
  assert.equal(panels[0].scores.length, 1);
  assert.equal(panels[0].scores[0].dims.dreamOutcome, 10);
  assert.equal(panels[0].scores[0].dims.proofBacking, null);
});

test("aggregate is offer.js arithmetic: weighted mean, spreads, and an unjudged offer is null, not zero", () => {
  const blinded = [{ blindId: "Offer A", archetype: "A-dream", name: "A" }, { blindId: "Offer B", archetype: "B-mechanism", name: "B" }];
  const all = (v) => Object.fromEntries(DIMS.map((d) => [d, v]));
  const panels = [
    { seat: "buyer", scores: [{ blindId: "Offer A", dims: { ...all(8), perceivedLikelihood: 4 }, killShot: "k1", bestPart: "b1" }] },
    { seat: "operator", scores: [{ blindId: "Offer A", dims: { ...all(6), perceivedLikelihood: 10 }, killShot: "k2", bestPart: "b2" }] }
  ];
  const [a, b] = aggregate(blinded, panels);
  // Every dimension averages to 7 → weighted mean is 7 whatever the weights.
  assert.equal(a.weighted, 7);
  assert.equal(a.dims.perceivedLikelihood.spread, 6);
  assert.equal(a.maxSpread, 6);
  assert.equal(a.widestDim, "perceivedLikelihood");
  assert.equal(a.judgeCount, 2);
  assert.deepEqual(a.killShots, ["k1", "k2"]);
  assert.equal(b.weighted, null);
  assert.equal(b.judgeCount, 0);

  // A hand-checked weighted score with unequal dimensions.
  const one = aggregate([blinded[0]], [{ seat: "buyer", scores: [{ blindId: "Offer A", dims: { ...all(5), perceivedLikelihood: 10 }, killShot: "", bestPart: "" }] }])[0];
  const wsum = Object.values(WEIGHT).reduce((x, y) => x + y, 0);
  const expected = Math.round(((5 * (wsum - WEIGHT.perceivedLikelihood) + 10 * WEIGHT.perceivedLikelihood) / wsum) * 100) / 100;
  assert.equal(one.weighted, expected);

  const r = rank([a, b]);
  assert.equal(r.winner.blindId, "Offer A");
  assert.deepEqual(r.unjudged.map((u) => u.blindId), ["Offer B"]);
  assert.equal(r.runnerUp, null);
});

test("rank flags a run-off inside 5% and breaks a tie on the blind letter", () => {
  const row = (blindId, weighted) => ({ blindId, archetype: blindId, name: blindId, weighted, maxSpread: 0 });
  assert.equal(rank([row("Offer A", 7), row("Offer B", 6.9)]).runoffAdvised, true);
  assert.equal(rank([row("Offer A", 7), row("Offer B", 6)]).runoffAdvised, false);
  assert.equal(rank([row("Offer C", 7), row("Offer A", 7)]).winner.blindId, "Offer A");
});

test("dollarAmounts and checkPrices: every price traces to src/config/offers.mjs or is marked proposed", () => {
  assert.deepEqual(dollarAmounts("$10,000 or $10k or $297.00").map((a) => a.cents), [1000000, 1000000, 29700]);
  assert.deepEqual(checkPrices({ price: "$10,000 once, can be financed" }), []);
  assert.deepEqual(checkPrices({ price: "$297 Live Trial, then $10,000" }), []);
  const bad = checkPrices({ price: "$7,500" });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /\$7,500 is not on the price list/);
  const proposed = checkPrices({ price: "$12,000 — PRICE CHANGE PROPOSED (was $10,000)" });
  assert.equal(proposed.length, 1);
  assert.match(proposed[0], /proposed change/);
  assert.deepEqual(checkPrices({ price: "ask on the call" }), ["The price line does not name a dollar amount."]);
});

test("the review card is the flywheel's block: three checks with the real price, and every doubt named", () => {
  const offer = { name: "X", price: "$10,000", guarantees: [{ name: "G", promise: "p", needsOwnerDecision: "how many redos" }] };
  const winner = { name: "X", archetype: "C-risk", weighted: 7, maxSpread: 6, widestDim: "deliverability" };
  const runnerUp = { name: "Y", archetype: "A-dream", weighted: 6.9 };
  const card = buildReviewCard({ offer, winner, runnerUp, runoffAdvised: true, unjudged: [{ archetype: "F-sequence" }],
    candidateCount: 6, priceIssues: ["The price $1 is not on the price list."], research: false,
    modelReview: { whatThisDecided: "Sell X.", notSureAbout: ["the cost to get a customer"] } });
  assert.equal(card.whatThisDecided, "Sell X.");
  assert.deepEqual(card.threeThingsToCheck, [
    "The price is $10,000 — yes or no?", "Can we deliver this every time?", "Can we afford the guarantee if three people claim it?"
  ]);
  const doubts = card.notSureAbout.join("\n");
  assert.match(doubts, /\$1 is not on the price list/);
  assert.match(doubts, /1 of 6 offers were never scored/);
  assert.match(doubts, /disagreed by 6 points on whether we can deliver it every time/);
  assert.match(doubts, /within 5%/);
  assert.match(doubts, /No ad research/);
  assert.match(doubts, /needs a number from Chris: how many redos/);
  assert.match(doubts, /the cost to get a customer/);
  assert.match(card.markdown, /^## Review card/);
  assert.match(card.markdown, /\*\*Say one of:\*\* approve · tweak: <what to change> · redo/);

  const clean = buildReviewCard({ offer: { name: "X", price: "$10,000", guarantees: [] },
    winner: { maxSpread: 0 }, runnerUp: null, runoffAdvised: false, candidateCount: 6 });
  assert.deepEqual(clean.notSureAbout, ["nothing"]);
  assert.match(clean.markdown, /\*\*What I wasn't sure about:\*\* nothing/);
});

test("model failures read as plain sentences", () => {
  assert.equal(plainModelFailure({ text: "{}" }), null);
  assert.match(plainModelFailure({ timedOut: true }), /too long/);
  assert.match(plainModelFailure({ mode: "shadow" }), /no Anthropic key/);
  assert.match(plainModelFailure({ status: 401, error: "anthropic 401: {}" }), /refused the key/);
  assert.match(plainModelFailure({ status: 400, error: "anthropic 400: credit balance is too low" }), /out of credit/);
  assert.match(plainModelFailure({ status: 529, error: "anthropic 529: overloaded" }), /overloaded/);
  assert.match(plainModelFailure({ text: null, stopReason: "refusal" }), /declined/);
  assert.match(plainModelFailure({ text: null, stopReason: "max_tokens" }), /ran out of room/);
});

test("the prompts carry the rubric and the facts, and only the facts given", () => {
  const facts = offerFactsText();
  const p1 = candidatesPrompt({ ...INPUTS, facts });
  for (const piece of [INPUTS.avatarSummary, INPUTS.adResearchSummary, INPUTS.ownerNotes, facts, NO_INVENTED_PROOF, GUARANTEE_RULES]) {
    assert.ok(p1.includes(piece), `candidates prompt is missing: ${piece.slice(0, 50)}`);
  }
  for (const id of ARCHETYPE_IDS) assert.ok(p1.includes(id));
  // No research → the offer.js line, not a blank and not an invented market.
  assert.match(candidatesPrompt({ ...INPUTS, adResearchSummary: "", facts }), /No ad research was supplied/);
  // No compliance riders anywhere in our own wording (CLAUDE.md §7 removed).
  const blank = { campaign: "partner", avatarSummary: "", adResearchSummary: "", ownerNotes: "", facts };
  const { candidates } = parseCandidates(CANDIDATES_TEXT);
  const blinded = blindCandidates(candidates, "x");
  const ours = [SYSTEM, candidatesPrompt(blank), judgesPrompt({ avatarSummary: "", blinded, facts })].join("\n");
  assert.doesNotMatch(ours, /compliance|legal review|consult (a|an) (lawyer|attorney)/i);
  const p2 = judgesPrompt({ avatarSummary: INPUTS.avatarSummary, blinded, facts });
  for (const seat of ["buyer", "operator", "accountant", "competitor"]) assert.ok(p2.includes(`- ${seat}:`));
  for (const id of ARCHETYPE_IDS) assert.equal(p2.includes(id), false, `judges must not see the lever ${id}`);
  const winner = { blindId: "Offer A", archetype: "C-risk", weighted: 7, maxSpread: 6, killShots: ["k"] };
  const p3 = synthesisPrompt({ campaign: "partner", winnerCandidate: blindView([blinded[0]])[0], winner, judged: [winner], unjudged: [], candidateCount: 6, ownerNotes: "", facts });
  assert.match(p3, /disagreed by 6 points/);
  assert.ok(p3.includes(facts));
});

test("a full run: six offers, four judges, one winner, one review card — three calls", async () => {
  const { ask, calls } = scriptedAsk({
    candidates: { text: CANDIDATES_TEXT },
    judges: (args) => ({ text: panelsText(blindIdsFrom(args.user)) }),
    synthesis: { text: SYNTHESIS_TEXT }
  });
  const out = await generateOffer({ inputs: INPUTS, ask, seed: "job-123", today: "2026-10-05" });

  assert.deepEqual(calls.map((c) => c.step), ["candidates", "judges", "synthesis"]);
  for (const c of calls) {
    assert.equal(c.system, SYSTEM);
    assert.ok(c.maxTokens >= 8000);
    assert.ok(c.timeoutMs > 0);
  }
  assert.equal(out.winner.blindId, "Offer B");
  const atB = blindCandidates(parseCandidates(CANDIDATES_TEXT).candidates, "job-123").find((c) => c.blindId === "Offer B");
  assert.equal(out.winner.archetype, atB.archetype);
  assert.equal(out.winner.judgeCount, 4);
  assert.equal(out.winner.maxSpread, 6);
  assert.equal(out.synthesized, true);
  assert.equal(out.offer.name, "Live or We Keep Building");
  assert.equal(out.offer.tookFromLosers[0].from, "E-effort");
  assert.deepEqual(out.checks.priceIssues, []);
  assert.equal(out.scores.length, 6);
  assert.deepEqual(out.unjudged, []);
  assert.equal(out.candidates.length, 6);
  assert.deepEqual(out.counts, { priceSet: 1, bonuses: 3, guarantees: 2, valueEquationScores: 4 });
  assert.equal(out.reviewCard.whatThisDecided, "Sell the partner program at $10,000 with a 30-day live-or-we-keep-building guarantee.");
  assert.match(out.reviewCard.notSureAbout.join("\n"), /disagreed by 6 points/);
  assert.match(out.reviewCard.notSureAbout.join("\n"), /needs a number from Chris: How many redos/);
  assert.equal(out.asOf, "2026-10-05");
  for (const h of ["## 1. The offer in one sentence", "## 8. The 30-day cash arithmetic", "## 9. What we could not prove", "## Review card"]) {
    assert.ok(out.document.includes(h), `document is missing ${h}`);
  }
  assert.deepEqual(out.usage.calls.map((c) => c.step), ["candidates", "judges", "synthesis"]);
  assert.equal(out.usage.input_tokens, 300);
  assert.equal(out.usage.output_tokens, 150);
});

test("an offer no judge scored is left out and named, not ranked as a zero", async () => {
  let skipped;
  const { ask } = scriptedAsk({
    candidates: { text: CANDIDATES_TEXT },
    judges: (args) => {
      const ids = blindIdsFrom(args.user);
      skipped = ids[5];
      return { text: panelsText(ids, { skip: [skipped] }) };
    },
    synthesis: { text: SYNTHESIS_TEXT }
  });
  const out = await generateOffer({ inputs: INPUTS, ask, seed: "job-9" });
  assert.equal(out.unjudged.length, 1);
  assert.equal(out.scores.length, 5);
  assert.match(out.reviewCard.notSureAbout.join("\n"), /1 of 6 offers were never scored/);
});

test("too few complete offers stops the run before any judging", async () => {
  const list = JSON.parse(CANDIDATES_TEXT).candidates.slice(0, 2);
  const { ask, calls } = scriptedAsk({ candidates: { text: JSON.stringify({ candidates: list }) } });
  await assert.rejects(generateOffer({ inputs: INPUTS, ask }), (err) => {
    assert.ok(err instanceof OfferError);
    assert.equal(err.code, "too_few_candidates");
    assert.match(err.message, /Only 2 of 6 offers came back complete/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a failed first call stops the run with a plain reason", async () => {
  const { ask } = scriptedAsk({ candidates: { text: null, status: 529, error: "anthropic 529: overloaded" } });
  await assert.rejects(generateOffer({ inputs: INPUTS, ask }), /six offers\) did not work: Anthropic was overloaded or down/);
});

test("judges that score nothing stop the run: no winner is invented", async () => {
  const { ask } = scriptedAsk({ candidates: { text: CANDIDATES_TEXT }, judges: { text: '{"panels":[]}' } });
  await assert.rejects(generateOffer({ inputs: INPUTS, ask }), (err) => err.code === "not_judged");
});

test("a broken write-up keeps the winner as written and says so on the card", async () => {
  const { ask } = scriptedAsk({
    candidates: { text: CANDIDATES_TEXT },
    judges: (args) => ({ text: panelsText(blindIdsFrom(args.user)) }),
    synthesis: { text: "Sorry, here is some prose instead of JSON." }
  });
  const out = await generateOffer({ inputs: INPUTS, ask, seed: "job-123" });
  assert.equal(out.synthesized, false);
  const atB = out.candidates.find((c) => c.blindId === "Offer B");
  assert.equal(out.offer.name, atB.name);
  assert.match(out.reviewCard.notSureAbout[0], /final write-up step did not come back \(the answer did not come back in the agreed shape\)/);
});

test("no time left stops the run before a call is made", async () => {
  const { ask, calls } = scriptedAsk({});
  await assert.rejects(generateOffer({ inputs: INPUTS, ask, timeLeft: () => 10_000 }), (err) => err.code === "out_of_time");
  assert.equal(calls.length, 0);
});

test("parseSynthesis needs a name, a price and what they get", () => {
  assert.ok(parseSynthesis(SYNTHESIS_TEXT));
  const o = JSON.parse(SYNTHESIS_TEXT);
  o.offer.price = "";
  assert.equal(parseSynthesis(JSON.stringify(o)), null);
  assert.equal(parseSynthesis("{}"), null);
});
