// Recorded-shape replies for the offer generator's tests. No network, ever.
//
// Each reply is the TEXT the model returns for one step, plus anthropicMessage(),
// which wraps a text in the exact JSON body POST /v1/messages answers with (a
// thinking block first, as the current Opus sends, then the text block). The
// tests feed these through the repo's real callModel() via a fake fetch, so the
// parsing path is the production one.
//
// The offers below are test content. The prices are real ones from
// src/config/offers.mjs on purpose, so the price check passes where it should
// and fails where a test changes one.

export function anthropicMessage(text, { input = 4000, output = 3000, stop = "end_turn", model = "claude-opus-5-5" } = {}) {
  return {
    id: "msg_test_offer",
    type: "message",
    role: "assistant",
    model,
    content: [
      { type: "thinking", thinking: "", signature: "sig_test" },
      { type: "text", text }
    ],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: input, output_tokens: output }
  };
}

const ve = (d, p, t, e) => ({ dreamOutcome: d, perceivedLikelihood: p, timeDelay: t, effortSacrifice: e });

function candidate(archetype, name, price, extra = {}) {
  return {
    archetype,
    name,
    promise: `${name}: a partner business running under your own brand.`,
    mechanism: "The Fundhub back office runs delivery under the partner's brand.",
    price,
    paymentTerms: "Paid once. Can be financed.",
    whatTheyGet: ["The white-label platform", "Done-for-you delivery", "Onboarding calls"],
    guarantees: [
      {
        name: "Live in 30 days",
        promise: "Your branded site is live within 30 days of signing, or we keep building at no charge until it is.",
        shape: "result-tied-with-make-good",
        conditions: "Send your logo and domain within 7 days.",
        whatItCostsUsIfItFires: "Staff hours only.",
        needsOwnerDecision: "none"
      },
      {
        name: "First-month walkthrough",
        promise: "Attend the two setup calls and we redo any setup step you are unhappy with.",
        shape: "conditional-satisfaction",
        conditions: "Attend both setup calls.",
        whatItCostsUsIfItFires: "One more setup call.",
        needsOwnerDecision: "none"
      }
    ],
    bonuses: ["Launch checklist", "Ad hook pack", "Monthly numbers review"],
    valueEquation: ve(7, 6, 6, 7),
    thirtyDayMath: "Price $10,000 collected up front. Cost to get a customer = not on file.",
    proofUsed: ["Price list"],
    proofMissing: ["No partner results on file"],
    ...extra
  };
}

export const CANDIDATES_TEXT = JSON.stringify({
  candidates: [
    candidate("A-dream", "Own the Funding Desk", "$10,000"),
    candidate("B-mechanism", "The Back Office in a Box", "$10,000"),
    candidate("C-risk", "Live or We Keep Building", "$10,000", { valueEquation: ve(7, 9, 6, 7) }),
    candidate("D-speed", "Launch in Ten Days", "$10,000 plus Done-For-You Marketing at $2,497/month"),
    candidate("E-effort", "Financed Partner Start", "$10,000, can be financed"),
    candidate("F-sequence", "Trial to Partner Ladder", "$297 Live Trial, then $10,000")
  ]
});

/* The judges' scores, written so the arithmetic in the test can be done by hand:
   every seat gives Offer B (whatever the shuffle put there) 9s and everything
   else 5s, except the operator, who gives Offer B a 3 on deliverability — a
   6-point split, which must surface on the review card. */
export function panelsText(blindIds, { favourite = "Offer B", skip = [] } = {}) {
  const dims = (v) => ({
    dreamOutcome: v, perceivedLikelihood: v, timeDelay: v, effortSacrifice: v,
    incomparability: v, proofBacking: v, thirtyDayCash: v, deliverability: v
  });
  const seats = ["buyer", "operator", "accountant", "competitor"];
  return JSON.stringify({
    panels: seats.map((seat) => ({
      seat,
      scores: blindIds.filter((id) => !skip.includes(id)).map((blindId) => {
        const top = blindId === favourite;
        const d = dims(top ? 9 : 5);
        if (top && seat === "operator") d.deliverability = 3;
        return {
          blindId,
          dims: d,
          killShot: top ? `${seat}: the 30-day window needs a staffing plan` : `${seat}: looks like every other pitch`,
          bestPart: top ? `${seat}: the time-boxed build guarantee` : `${seat}: the financing line`
        };
      })
    }))
  });
}

export const SYNTHESIS_TEXT = JSON.stringify({
  offer: {
    oneSentence: "Run a funding company under your own name, live in 30 days or we keep building free.",
    name: "Live or We Keep Building",
    price: "$10,000 once, can be financed",
    whyThisPrice: "It is the partner program price on file. Nothing monthly.",
    whatTheyGet: ["The white-label platform", "Done-for-you delivery", "Two setup calls"],
    guarantees: [
      {
        name: "Live in 30 days",
        promise: "Live within 30 days of signing, or we keep building at no charge until it is.",
        shape: "result-tied-with-make-good",
        conditions: "Send your logo and domain within 7 days",
        whatItCostsUsIfItFires: "Staff hours only",
        needsOwnerDecision: "none"
      },
      {
        name: "Setup redo",
        promise: "Attend both setup calls and we redo any step you are unhappy with.",
        shape: "conditional-satisfaction",
        conditions: "Attend both setup calls",
        whatItCostsUsIfItFires: "One more call",
        needsOwnerDecision: "How many redos per partner — Chris sets the number"
      }
    ],
    bonuses: ["Launch checklist", "Ad hook pack", "Monthly numbers review"],
    tookFromLosers: [{ from: "E-effort", what: "The financing line up front", why: "Two seats named it the best part" }],
    killShotsAnswered: [{ killShot: "The 30-day window needs a staffing plan", whatWeDid: "The clock starts when the logo and domain arrive" }],
    thirtyDayMath: "$10,000 collected. Cost to get a customer = not on file, so the 2x check waits on that number.",
    claimsRemoved: ["Partner income examples — PROOF: NONE ON FILE - claim removed"]
  },
  review: {
    whatThisDecided: "Sell the partner program at $10,000 with a 30-day live-or-we-keep-building guarantee.",
    notSureAbout: ["The cost to get a partner is not on file, so the 30-day cash check is open."]
  }
});
