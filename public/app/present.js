/* closer present — vanilla port of fundhub-closer-deck-v5. Copy stays verbatim. */
(function () {
  "use strict";

  var DECK = [
    { code: "S-01", phase: "01 Intro" }, { code: "S-02", phase: "01 Intro" },
    { code: "S-03", phase: "02 Discovery" }, { code: "S-04", phase: "02 Discovery" },
    { code: "S-05", phase: "03 Soft pull" }, { code: "S-06", phase: "03 Soft pull" },
    { code: "S-07", phase: "03 Soft pull" },
    { code: "S-08", phase: "04 Pitch" }, { code: "S-09", phase: "04 Pitch" },
    { code: "S-10", phase: "04 Pitch" }, { code: "S-11", phase: "04 Pitch" },
    { code: "S-12", phase: "04 Pitch" }, { code: "S-13", phase: "04 Pitch" },
    { code: "S-14", phase: "04 Pitch" }, { code: "S-15", phase: "04 Pitch" },
    { code: "S-16", phase: "04 Pitch" },
    { code: "S-17", phase: "05 Commit" }, { code: "S-18", phase: "05 Commit" },
    { code: "S-19", phase: "05 Commit" }, { code: "S-20", phase: "05 Commit" },
    { code: "S-21", phase: "05 Commit" }, { code: "S-22", phase: "05 Commit" },
    { code: "S-23", phase: "07 Close" }, { code: "S-24", phase: "07 Close" }
  ];
  var EDU_SKIP = ["S-11", "S-12", "S-13", "S-14", "S-15", "S-16"];
  var DISCOVERY = [
    ["Pain", "Biggest challenge right now? What's not working at the level it should be?"],
    ["Desire", "If capital wasn't an issue, what does the business look like in 6 to 12 months? Why that number?"],
    ["Doubt", "What are you currently doing to get funding? How's that been working out?"],
    ["Cost", "What is this costing you every month? Put a number on it."],
    ["Support", "Does your spouse know you're exploring funding options?"],
    ["Money", "If the pull comes back strong, are you ready to move now, or still researching?"],
    ["Trust", "Worked with any other funding companies before? How did that go?"]
  ];
  var GUARANTEES = [
    ["G-01 / 24 HOURS", "24-Hour Action Guarantee", "Once you're signed on, a funding advisor begins working your file within 24 business hours. If we don't act in that window, you're protected and you don't pay."],
    ["G-02 / 72 HOURS", "72-Hour Application Guarantee", "Once you're signed on, your applications go out within 72 business hours. If we don't act in that window, you're protected and you don't pay."],
    ["G-03 / FUNDING", "Funding Guarantee", "If you qualify and we don't secure funding for you, you don't pay. If you get nothing, we earn nothing."]
  ];
  var MENU = [
    ["F-01", "Business lines of credit", "Revolving access for operating needs."],
    ["F-02", "Term financing", "Fixed amount, set repayment schedule."],
    ["F-03", "Equipment financing", "Tied to business equipment purchases."],
    ["F-04", "SBA-backed options", "Through participating SBA partners."],
    ["F-05", "Revenue-based financing", "Structured around business revenue."],
    ["F-06", "Business card funding", "Coordinated 0% intro APR lines across issuers."]
  ];
  var TERMINAL = [
    "$ underwrite --diagnostic", "> application received", "> profile review initiated",
    "> soft inquiry · no score impact", "> scanning experian · transunion · equifax",
    "> matching against partner lender network", "> structuring options for review"
  ];
  var TALK = {
    "S-01": { title: "Rapport", lines: ["Hey [First Name]! It's [Your Name] over at Fundhub. How's your week been so far?", "Mirror their energy. Let them answer. Do not rush.", "I know we've got a limited amount of time, so are you ready to jump in? Are you in front of a computer with a card handy for the soft-pull assessment?"], watch: "The first 60 seconds decide whether they trust you or have their guard up." },
    "S-02": { title: "The Frame", lines: ["First, I'd like to dive into the specifics of your business, what you're building, where you're at with capital, and what's keeping you from scaling.", "Then we'll run your soft-pull assessment right here on the call, so we can see exactly what our AI system can pre-approve you for.", "And if it's not the right fit, we'll figure out the best next step. Does that sound fair?"], watch: "Get the 'sounds fair' before moving. It stops price-hijacking later." },
    "S-03": { title: "Discovery 1. Isolate the challenge.", lines: ["What's the biggest reason you're looking for funding right now? What's going on in the business?", "Probe: tell me more. When you say X, what do you mean exactly? How has that impacted the business specifically?", "Aside from that, any other challenge or roadblock in the way right now?"], watch: "Do not accept surface-level answers. Busy professional, not telemarketer." },
    "S-04": { title: "Discovery 2. The goal and the cost.", lines: ["Begin with the end in mind. If capital wasn't an issue, what does the business look like 6 to 12 months from now? How much capital do you realistically need?", "Cost anchor: what is this costing you every month? Reflect it back: about $X a month, roughly $Y left on the table. Feel accurate?", "Pre-frame: if the pull comes back strong and I can show a clear path, are you ready to move on this now, or still in the research phase?"], watch: "The cost number is what the $3,000 gets anchored against. Do not skip it." },
    "S-05": { title: "Transition to the pull", lines: ["I feel like we've covered a lot of ground. Anything else I need to know?", "Based on everything you've told me, I'm pretty confident we can help. The most appropriate next step is to see what you qualify for.", "So let's run that soft-pull assessment real quick. You've got a card handy?"], watch: "Do NOT jump from pain straight into pitching. Process the $32, then advance." },
    "S-06": { title: "While it runs", lines: ["Our Underwrite IQ system is scanning all three credit bureaus and matching your profile against our network of thousands of lenders.", "It's finding the exact banks and products with the highest approval probability for you.", "Same system that's helped us deploy over $25 million in funding for our clients."], watch: "Confident, matter-of-fact. Routine professional step." },
    "S-07": { title: "The reveal + the sort", lines: ["FUND: Alright [First Name], the results are in. We can get you pre-approved for approximately [Amount] across multiple credit lines with 0 percent introductory rates.", "FUND: Pause. Let the number land. Then: how does that sound?", "REPAIR: The results came back, and here's what the AI found. Some factors are limiting your approval potential. The good news: all fixable.", "EDU: If their ask is 'teach me to do this myself', route Education below. The sort still gets named first."], watch: "Name the sort before moving: 'based on what the system found, here's where you are, and here's the path that fits.' They must accept the sort before they hear any offer. Route buttons below." },
    "S-08": { title: "Permission, then the map", lines: ["FUND: Where do you want to go from here? I can walk you through exactly how we secure that [Amount] in the next two weeks. But you tell me.", "FUND: Everything is completely done-for-you. Three steps, stuck to funded, about two weeks. Cool?", "REPAIR: I'd recommend we clean your credit up first, so when we run the full funding process you're in the strongest position. Want me to walk you through it?", "EDU: Two ways to own this: your complete file deliverables with the ranked bank list, or the Funding Mastery program, A to Z. Which sounds more like you?"], watch: "Sort-acceptance gate. Reverse Selling: ask permission. If they push back on the sort itself, handle it HERE, never at the price." },
    "S-09": { title: "Pitch. The problem.", lines: ["FUND: You know how you tried applying on your own and got denied or didn't know which banks to go to? Most people, and most funding companies, are guessing.", "FUND: They spray and pray. Every denial is a hard inquiry that tanks your score.", "REPAIR: Walk the flags one at a time. Read each item. Don't editorialize, the screen is the proof.", "EDU: Course one is everything the system built from your file today. Walk the six items on screen, one by one."], watch: "Slow down. The contrast here is what sells the system." },
    "S-10": { title: "Step 1. AI Lender Matching.", lines: ["FUND: Underwrite IQ, the same AI that just scanned your profile, matches you with the exact lenders that want to approve you right now.", "FUND: We already know which banks will say yes before we ever submit. Make sense?", "REPAIR: The law does the heavy lifting. FCRA requires accuracy, forces an investigation of every dispute in 30 to 45 days, puts duties on the creditors themselves, and pays damages when they violate. Your letters are built on FCRA and Metro 2.", "EDU: Course two is the full Funding Mastery. A to Z. The complete credit and funding system, start to finish, on your own file."], watch: "'Make sense?' is a tie-down. Wait for the yes." },
    "S-11": { title: "Pitch. The second problem.", lines: ["FUND: Most companies submit everything at once. The banks see the inquiries stack, and they start denying you.", "FUND: It's called inquiry stacking, and it kills your approval odds.", "REPAIR: We dispute Metro 2, straight at the creditor. Their response becomes the proof, and it goes back to all three bureaus. Not fixed? We escalate through the administrative process, CFPB, state AG. Done for you, or you run the same pack yourself."], watch: "REPAIR compliance: describe the process only. Never promise removal, scores, or results." },
    "S-12": { title: "Step 2. Rounds + Inquiry Sweeps.", lines: ["FUND: We deploy in strategic rounds. Round 1 goes out, you get approved. Before Round 2, we run an Inquiry Sweep and remove those hard inquiries. Clean slate.", "FUND: Up to 12 rounds until we hit [Amount]. Your score stays protected the whole time.", "REPAIR: Round one is out today. Bureaus have 30 to 45 days to respond each round. Most files resolve in one to two rounds, and round three is already mapped if it's needed."], watch: "FPR: the dirty bureaus get the full dispute process in parallel. Never delays a round." },
    "S-13": { title: "The proof point", lines: ["FUND: This is why our clients get approved for 2 to 3 times more than the average funding company, in a fraction of the time.", "FUND: Does that make sense? What questions do you have?", "REPAIR: And you watch every move happen in real time in your dashboard."], watch: "Let the number sit. Inviting questions surfaces resistance early." },
    "S-14": { title: "Step 3. Done-for-you team.", lines: ["FUND: A dedicated funding team, three specialists whose only job is getting you funded. Every application, every follow-up, every sweep. You don't lift a finger.", "FUND: You run the business. We handle the capital side. Make sense?", "REPAIR: Once the file is clean, this is the position we project you're funding from. This is why we clean up first."], watch: "REPAIR: say 'projected position', never 'guaranteed'." },
    "S-15": { title: "The timeline", lines: ["FUND: Average client goes from signing to capital deployed in about two weeks. First approvals typically within 72 hours.", "REPAIR: Everything on this screen already exists. The letters are staged, the plan is mapped, the dashboard is waiting. All that's left is the button."], watch: "Slow down and let it land. On repair: the dinner is on the table — everything shown is already built from their pull. Sell the button-press, not the service." },
    "S-16": { title: "The menu. Take their order.", lines: ["FUND: This is everything we can open for you through the partner network. Which matter most for what you're building?", "FUND: Fulfill the ask FIRST. Then, only if the file supports it: you're also pre-qualified for [product], want me to include that?", "REPAIR: A little fear here protects them. So-called credit sweeps — fake FTC identity-theft reports, fake police reports — are federal crimes, and even when they 'work', the creditor just re-reports the account next month. Two wrongs don't make a right.", "REPAIR: Then flip it: our deletions stick, because they're documented and FCRA-grounded. And if a bureau reinserts without 5-day written notice and certification, THEY are in violation, not you."], watch: "FUND: it's a menu, not a pitch — nothing gets submitted they didn't order. REPAIR: warn, don't teach. Name the schemes and the consequences, never the mechanics." },
    "S-17": { title: "Temperature check", lines: ["So just curious, in terms of the process specifically, how do you feel?", "What's important to me is alignment. When you come in, our team is ALL IN, in the trenches with you. So it matters that you feel GOOD about the process."], watch: "If they hesitate here, dig in now. Don't carry hesitation into the price." },
    "S-18": { title: "Scale of 1 to 10", lines: ["1 being this sounds terrible, I want off the phone. 10 being this is exactly what I need to finally get the capital to scale. Where do you fall?"], watch: "8 or above, proceed. Below 8: what's keeping you from a 9 or 10? Handle it first." },
    "S-19": { title: "The investment", lines: ["FUND: Based on your pre-approval, I genuinely believe we get you to [Amount] in two weeks. To activate the system today, it's a $3,000 deposit.", "FUND: That $3,000 is not an additional fee. It goes directly toward your 10 percent success fee on the back end.", "REPAIR: Top down. Onboard now, full done-for-you, $1,000, letters fire today. If that's a no: trial round, we run your first round so you see it work, $200. Still a no: $1,000, the full deliverables plus course, you execute it.", "EDU: Lead with the $5,000 full program. Only if that's a no: the $1,000 deliverables package plus the how-to course."], watch: "Rung buttons below on repair. Do NOT lead with the cheaper one." },
    "S-20": { title: "The math", lines: ["FUND: Walk it line by line off the screen. Deposit credits against the fee. Back end only charges once capital is in your hands.", "FUND: So we only make our money when you get funded. Our success is literally tied to yours.", "REPAIR: Put their own number in their face. You told me this costs you [$X] a month. That's [$X times 12] a year of staying exactly where you are. The fix starts on this call.", "EDU: Two courses, one skill set. Anchor the $5,000 against what they told you being stuck costs them every month."], watch: "Anchor against their own monthly cost number from discovery." },
    "S-21": { title: "The guarantees", lines: ["FUND: Read all three off the screen, verbatim. Then: so the risk is stacked entirely on our side.", "REPAIR: Round one goes out today. You watch every dispute and response in your dashboard. Rounds escalate until the file is clean.", "EDU: Access gets set up on this call, and the deliverables generate from today's pull. They leave with it in hand."], watch: "Site-verbatim guarantees. Do not improvise promises beyond the screen." },
    "S-22": { title: "The ask", lines: ["FUND: Are you ready to get this started so we can get you funded?", "REPAIR: Want me to get that set up for you?", "EDU: Want me to get you set up right now?", "Then stop talking. First person to speak loses."], watch: "Calm, direct, assumptive. Guide to the natural next step." },
    "S-23": { title: "The close. Logistics.", lines: ["Awesome. Let's get this going. I'm sending the agreement right now. Best email for that?", "Review it while I get your billing info. What's your billing address?", "Collect the card. Fire the pay link. Keep them on the line until it posts."], watch: "Do not celebrate. Do not over-explain. No time to second-guess." },
    "S-24": { title: "Wrap", lines: ["Within 24 business hours your advisor reaches out and starts on your file. Within 72 business hours your first applications are submitted.", "Any questions before we wrap? ... Congratulations, [First Name]. You made a great decision. We're going to get you funded. Talk soon."], watch: "Confirm the payment posted before ending the call. Then log the disposition." }
  };
  /* SECTION 07 IS PER OFFER, NOT PER ROUTE (F23, owner: "this is not accurate").
     The FUND: / REPAIR: / EDU: line filter has three buckets and the descent
     ladder has six rungs, so on 2026-09-03 a client who bought the $5,000
     Funding Mastery COURSE was read the funding wrap out loud: "within 24
     business hours your advisor reaches out", "within 72 business hours your
     first applications are submitted", "we're going to get you funded". None of
     that happens on an education sale — no advisor works the file, no
     application is submitted, and nobody is funding him as a result of it. The
     client half of the same screen was already correct; only the closer's
     script was hardcoded to the funding path.

     So the close script is keyed to the offer that was actually selected. Every
     rung on the ladder has its own S-23 and S-24 here, and adding a rung
     without adding its wrap is a missing key, not a silent wrong promise.
     COMPLIANCE REVIEW REQUIRED — funding-outcome messaging to a consumer. */
  var CLOSE_LOGISTICS = {
    title: "The close. Logistics.",
    lines: [
      "Awesome. Let's get this going. I'm sending the agreement right now. Best email for that?",
      "Review it while I get your billing info. What's your billing address?",
      "Collect the card. Fire the pay link. Keep them on the line until it posts."
    ],
    watch: "Do not celebrate. Do not over-explain. No time to second-guess."
  };
  var CLOSE_TALK = {
    FUNDING_DFY: {
      "S-23": CLOSE_LOGISTICS,
      "S-24": {
        title: "Wrap",
        lines: [
          "Within 24 business hours your funding advisor reaches out and starts on your file. Within 72 business hours your first applications are submitted.",
          "Any questions before we wrap? ... Congratulations, [First Name]. You made a great decision. We're going to get to work on this. Talk soon."
        ],
        watch: "Confirm the payment posted before ending the call. Then log the disposition."
      }
    },
    REPAIR_DFY: {
      "S-23": CLOSE_LOGISTICS,
      "S-24": {
        title: "Wrap",
        lines: [
          "Round one goes out today, built from the pull we just ran. It lands in your email and in your dashboard.",
          "The bureaus have 30 to 45 days to answer each round, and you watch every dispute and every response happen live.",
          "Any questions before we wrap? ... Congratulations, [First Name]. Talk soon."
        ],
        watch: "No advisor and no applications on this sale — it is credit repair. Never promise a deletion, a score, or a result. Confirm the payment posted, then log the disposition."
      }
    },
    REPAIR_TRIAL: {
      "S-23": CLOSE_LOGISTICS,
      "S-24": {
        title: "Wrap",
        lines: [
          "We run your first full round today, bureaus and creditors, built from the pull we just ran.",
          "You watch every dispute and every response in your dashboard. After the round you decide whether to keep going.",
          "Any questions before we wrap? ... Talk soon, [First Name]."
        ],
        watch: "One round, then their decision. Do not describe it as the full program. Never promise a deletion, a score, or a result."
      }
    },
    UWIQ_DELIVERABLES: {
      "S-23": CLOSE_LOGISTICS,
      "S-24": {
        title: "Wrap",
        lines: [
          "Your deliverables generate from the pull we just ran and land in your email today, with the how-to course.",
          "You run it at your own pace. Nobody is working the file for you on this one — that's the whole point of it.",
          "Whenever you want us to run the process for you instead, we're here. Any questions before we wrap?"
        ],
        watch: "This is a do-it-yourself purchase. No advisor, no applications submitted, no funding promised."
      }
    },
    FUNDING_MASTERY: {
      "S-23": CLOSE_LOGISTICS,
      "S-24": {
        title: "Wrap",
        lines: [
          "Your access gets set up on this call, and the deliverables from today's pull land in your email.",
          "You work through the program at your own pace. This is education — you do the work, on your own file.",
          "Whenever you're ready for us to run the full funding process for you, we're here. Any questions before we wrap?"
        ],
        watch: "This is an education sale. Do not promise an advisor, submitted applications, or funding."
      }
    }
  };

  var OBJECTIONS = [
    { t: "Think about it", jump: "S-08", jumpLabel: "Show the process", lines: ["I want you to make the best decision for your business. Can I ask, when you say you need to think about it, is it the process you're unsure about, or the $3,000 deposit?", "Isolate it. 'Think about it' is never the real objection.", "If they can't articulate it: you told me you're a 9 on the process, you need [Amount] for [goal], and this has held you back [X time]. What's really going on? Pause. Let them fill the silence."] },
    { t: "$3K is a lot", jump: "S-20", jumpLabel: "Show the math", lines: ["Isolate: finances aside, anything else keeping you from being 100 percent certain?", "Should vs how: you're not in a SHOULD I place, you're in a HOW can I place. Right?", "Context: you just saw the system pre-approve you for [Amount]. The $3,000 is an advance on a fee you'd pay anyway. Is $3,000 a lot compared to [Amount] deployed in two weeks?"] },
    { t: "What if it fails", jump: "S-21", jumpLabel: "Show guarantees", lines: ["We ran the soft-pull together. You saw the pre-approval with your own eyes. We're not guessing.", "Our fee is 10 percent of what we actually secure. No funding, no money for us. Zero incentive to take you on unless we're certain.", "And if we don't hit your target, we keep working your file at no additional cost. So what specifically are you worried won't work?"] },
    { t: "Spouse", jump: "S-21", jumpLabel: "Show guarantees", lines: ["Aside from letting your spouse know, anything else keeping you from 100 percent?", "Respect vs permission: doing it regardless and letting them know? Or need their sign-off?", "If respect: 'this company wants $3K, thoughts?' versus 'I found the company getting us [Amount] in two weeks, I've decided, wanted you to know first.' Which one gets them on board? If permission: book the 3-way."] },
    { t: "Burned before", jump: "S-10", jumpLabel: "Show the system", lines: ["I'm sorry that happened. What exactly went wrong with the last company? Listen.", "That's way too common, and it's exactly why we built Fundhub this way. Most companies are manual, guessing, no score protection, no accountability.", "The question isn't whether to trust a funding company again. It's whether to trust THIS one: different process, hundreds funded, $25 million deployed."] },
    { t: "DIY", jump: "S-12", jumpLabel: "Show the rounds", lines: ["You absolutely can. How long have you been trying? And how much capital have you secured in that time?", "Our clients get 2 to 3x more because of the AI matching and the sweeps between rounds. You'd need our lender network, our AI, and the sweep expertise.", "Is saving $3,000 worth another [X months] stuck? Or invest it today and have [Amount] in two weeks?"] }
  ];
  var REFRAMES = [
    ["Truth Hammer", "You just told me [X], now you're saying [Y]. What's really going on?"],
    ["Simple Decision", "Do you want to keep [pain] or do you want [outcome]?"],
    ["Circumstance vs Vision", "Decisions from current circumstances, or from your vision?"],
    ["Cost Reframe", "Too much compared to what? Compared to [Amount] and finally [goal]?"],
    ["Risk Reframe", "Riskier: $3K into a proven system with three guarantees, or the same spot in 6 months?"]
  ];

  var q = new URLSearchParams(location.search);
  var contactId = q.get("contact") || q.get("client_id") || q.get("id") || q.get("client") || "";
  var state = {
    idx: 0, tier: null, edu: false, forceRepair: false, rung: 0, temp: 0,
    checks: {}, costNum: "", obj: null, showRef: false, toast: "", clientOnly: false,
    survey: {}, engine: { available: false, reason: "engine data unavailable", fico: {}, reasons: [] },
    offers: [], softPull: null, ebookDollars: "", saleMotion: "", loaded: false, error: null,
    contractLink: "", contractMsg: "",
    /* One entry per send control: whether it is in flight, when it last went
       out, and how many times. F24 — see sendBtn below. */
    sends: {}, moreOpen: false, repairReferral: false,
    stagedLetters: [], repairBusy: false, repairMsg: "", amountPaidDollars: "",
    businesses: [], incBusy: "", incMsg: ""
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function dash(v) { return v == null || v === "" ? "—" : String(v); }
  /* F11 — the client's words, never the answer-option row id.
     ClickFunnels stores the option ID on cf_svy_<key> and the words on
     cf_svy_<key>_label. The server resolves the label first (closer-deck.mjs
     surveyAnswer); this is the second line of defence, so a payload that still
     carries a bare 5+ digit id shows a dash instead of printing 207883 on the
     slide headed "This is what you told us" — or as the hero number on the
     goal slide, where it was the biggest thing on the customer's screen. */
  function isOptionId(v) {
    if (typeof v === "number") return v >= 10000;
    return typeof v === "string" && /^\d{5,}$/.test(v.trim());
  }
  function answer(v) { return isOptionId(v) ? null : v; }
  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US");
  }
  /* "2020-01" -> "January 2020". Never invents a day. */
  function monthYear(raw) {
    var s = String(raw == null ? "" : raw).trim();
    var m = s.match(/^(\d{4})-(\d{2})/);
    if (!m) return s;
    var names = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    var i = Number(m[2]) - 1;
    return (names[i] || m[2]) + " " + m[1];
  }
  function offer(key) {
    var list = state.offers || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function price(key) {
    var o = offer(key);
    return (o && o.priceDisplay) ? o.priceDisplay : "—";
  }
  function financingNote(key) {
    var o = offer(key);
    return o && o.financing ? '<div class="fin">Financing available</div>' : "";
  }
  function contents() {
    var o = offer("UWIQ_DELIVERABLES");
    return (o && o.contents) || [];
  }
  function isFunding() {
    return (state.tier === "FULL_FUNDING" || state.tier === "FUNDING_PLUS_REPAIR") && !state.forceRepair;
  }
  function selectedOfferKey() {
    if (state.edu) return state.rung === 1 ? "UWIQ_DELIVERABLES" : "FUNDING_MASTERY";
    if (!isFunding()) {
      if (state.rung === 1) return "REPAIR_TRIAL";
      if (state.rung === 2) return "UWIQ_DELIVERABLES";
      return "REPAIR_DFY";
    }
    return "FUNDING_DFY";
  }
  function isPrimaryPayOffer(key) {
    return key === "FUNDING_DFY" || key === "REPAIR_DFY" || key === "REPAIR_TRIAL" || key === "FUNDING_MASTERY";
  }
  function selectedSaleMotion() {
    return isPrimaryPayOffer(selectedOfferKey()) ? null : (state.saleMotion || null);
  }
  function resolveContractTemplateKey() {
    /* The combined agreement is for the funding sale only. A Blueprint, Academy
       or repair-only sale on a funding-plus-repair deck gets its own offer's
       agreement, the one that matches its pay link (hole 1, 2026-09-18). */
    if (state.tier === "FUNDING_PLUS_REPAIR" && selectedOfferKey() === "FUNDING_DFY") return "REPAIR-AND-FUNDING-AGREEMENT";
    var o = offer(selectedOfferKey());
    return (o && o.contractTemplateKey) || null;
  }
  /* No contract defaults live in this file any more, and that is the fix, not
     an omission. The server fills every blank from the offer catalogue
     (defaultContractValues in src/config/offers.mjs) — one price list, one
     seller name. A copy of them here is what let a typed Company name land on
     the agreement as the SELLER (F28). Present sends the client and the
     template and nothing else. */
  function lettersOk() {
    var o = offer(selectedOfferKey());
    return !!(o && o.letters);
  }
  function isRepairDfyOffer() {
    var k = selectedOfferKey();
    return k === "REPAIR_DFY" || k === "REPAIR_TRIAL";
  }
  function repairProgramKey() {
    return selectedOfferKey() === "REPAIR_TRIAL" ? "trial" : "full";
  }
  function offerDollars(key) {
    var o = offer(key || selectedOfferKey());
    if (!o || o.priceCents == null) return null;
    return Math.round(Number(o.priceCents)) / 100;
  }
  function paidDollarsForEnroll() {
    var typed = state.amountPaidDollars
      || (document.getElementById("fh-repair-paid") && document.getElementById("fh-repair-paid").value)
      || "";
    var n = parseFloat(String(typed).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n) && n >= 0) return n;
    return offerDollars() || 0;
  }
  function code() { return DECK[Math.min(state.idx, DECK.length - 1)].code; }
  function phase() { return DECK[state.idx].phase; }
  function firstName() {
    var n = (state.survey && state.survey.name) || "";
    return n.split(" ")[0] || "there";
  }

  /* Companies on the file, and the ones still missing a month/year. Age is
     computed from the incorporation date, so a blank date means the stack is
     guessing. Present has to ask. */
  function businesses() {
    return Array.isArray(state.businesses) ? state.businesses : [];
  }
  function businessesNeedingDate() {
    return businesses().filter(function (b) { return !b.incorporated_date; });
  }

  function slide(c, label, inner) {
    return '<div class="slide"><div class="slide-hd"><span class="mono">' + esc(c) + " / " + esc(label) +
      '</span><div class="rule"></div><span class="brand">fundhub<span>.</span></span></div><div class="hair"></div>' +
      '<div class="slide-body">' + inner + "</div></div>";
  }
  function kicker(t) { return '<div class="kicker"><span class="mono" style="color:var(--gray)">' + esc(t) + "</span></div>"; }
  /* F22 — S-19, S-20 and S-23 put a band of content at the top of the slide and
     left the bottom two thirds blank white. This is the half the CUSTOMER sees
     on a screen share, and Chris was reading it at 50% zoom, where it fell
     apart. Every other slide in the deck already centres its body; these did
     not. `roomy` also opens the row rhythm with the slide height, so the block
     fills and balances the space at any zoom rather than huddling at the top. */
  function fill(inner) { return '<div class="fillslide roomy">' + inner + "</div>"; }
  function h1(t, size) { return '<h1 class="h1"' + (size ? ' style="font-size:' + size + '"' : "") + ">" + t + "</h1>"; }
  function sub(t) { return '<p class="sub">' + t + "</p>"; }
  function fine(t) { return '<p class="fine">' + t + "</p>"; }
  function row(left, right, subl, strong) {
    return '<div class="row"><div class="l' + (strong ? " strong" : "") + '">' + left +
      (subl ? '<div class="subl">' + subl + "</div>" : "") + '</div><div class="r' + (strong ? " strong" : "") + '">' + right + "</div></div>";
  }
  function bars(lines) {
    return '<div style="margin-top:12px;max-width:620px">' + lines.map(function (l) {
      return '<div class="bar"><i></i><div style="font-size:clamp(11.5px,1.15vw,13.5px);color:var(--ink);line-height:1.45">' + l + "</div></div>";
    }).join("") + "</div>";
  }
  function stats(items) {
    return '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' + items.map(function (it) {
      return '<div class="stat"><div class="v">' + it[0] + '</div><span class="mono" style="color:var(--gray)">' + esc(it[1]) + "</span></div>";
    }).join("") + "</div>";
  }
  function moneyYr(row) {
    if (!row || row.annual == null) return null;
    return "$" + Number(row.annual).toLocaleString("en-US") + "/yr";
  }
  function scores(fico) {
    var rows = [["Experian", fico && fico.ex], ["TransUnion", fico && fico.tu], ["Equifax", fico && fico.eq]];
    return '<div style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap">' + rows.map(function (r) {
      return '<div class="score"><span class="mono">' + r[0] + '</span><div class="v">' + dash(r[1]) + "</div></div>";
    }).join("") + "</div>";
  }
  /* Scores off a sample report say so (live hole 23). engine.sample is set by
     buildCloserDeck() in src/sales/closer-deck.mjs; only true labels. */
  function sampleLine(d) {
    return d && d.sample === true ? fine("Sample scores. Not a real credit pull.") : "";
  }
  /* THE BAR IS COLOURED BY THE SCORE, NEVER BY THE ROW (walkthrough-4 defect 1).
     It used to be coral / sage / blue by position, so Experian was always the
     red one — a client with a 790 there saw "failed". The one line the engine
     draws is 700 (src/underwrite/vendor/underwriter.cjs `score >= 700` is the
     fundable bar): at or over it is sage (healthy), under it is peach (behind).
     No coral — the engine names no score as blocked. The number prints beside it. */
  function scoreTone(v) {
    if (v == null || !isFinite(Number(v))) return "transparent";
    return Number(v) >= 700 ? "var(--ok)" : "var(--warn)";
  }
  function scoreBars(fico) {
    var rows = [["Experian", fico && fico.ex], ["TransUnion", fico && fico.tu], ["Equifax", fico && fico.eq]];
    return '<div style="margin-top:12px;max-width:600px">' + rows.map(function (r) {
      var v = r[1];
      var w = v == null ? 0 : Math.max(4, ((Number(v) - 300) / 550) * 100);
      return '<div class="prog"><span class="nm">' + r[0] + '</span><div class="track"><div class="fill" style="width:' + w + "%;background:" + scoreTone(v) + '"></div></div><span class="n">' + dash(v) + "</span></div>";
    }).join("") + '<div style="display:flex;justify-content:space-between;padding-left:94px;padding-right:44px;margin-top:2px"><span class="mono" style="color:var(--gray2)">300</span><span class="mono" style="color:var(--gray2)">850</span></div></div>';
  }
  function stepsHtml(steps, current) {
    return '<div style="display:flex;margin-top:14px;max-width:620px">' + steps.map(function (s, i) {
      var on = i === current;
      var done = i < current;
      return '<div style="flex:1;position:relative;text-align:center">' +
        (i > 0 ? '<div style="position:absolute;top:12px;left:-50%;width:100%;height:2px;background:' + (i <= current ? "var(--ink)" : "var(--line)") + '"></div>' : "") +
        '<div style="position:relative;z-index:1;width:24px;height:24px;margin:0 auto;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:10px;background:' + (done ? "var(--ink)" : "#fff") + ";color:" + (done ? "#fff" : "var(--ink)") + ";border:" + (on ? "3px solid transparent" : "2px solid " + (done ? "var(--ink)" : "var(--line)")) + ";" + (on ? "background-image:linear-gradient(#fff,#fff),var(--spectrum);background-origin:border-box;background-clip:padding-box,border-box" : "") + '">' + (done ? "✓" : (i + 1)) + "</div>" +
        '<div style="font-size:10.5px;font-weight:650;color:' + (i <= current ? "var(--ink)" : "var(--gray2)") + ';margin-top:6px">' + s[0] + '</div><div style="font-size:9.5px;color:var(--gray2);margin-top:1px">' + s[1] + "</div></div>";
    }).join("") + "</div>";
  }
  function lettersGrid() {
    var bureaus = ["EX", "TU", "EQ"];
    var rounds = ["R1", "R2", "R3"];
    return '<div style="margin-top:12px;max-width:620px">' + rounds.map(function (r, ri) {
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><span class="mono" style="color:' + (ri === 0 ? "var(--ink)" : "var(--gray2)") + ';width:70px;flex-shrink:0">' + (r === "R1" ? "R1 · CREDITOR FIRST" : r) + "</span>" +
        bureaus.map(function (b) {
          return '<div style="flex:1;border:1px solid ' + (ri === 0 ? "var(--ink)" : "var(--line)") + ";background:" + (ri === 0 ? "var(--soft)" : "transparent") + ';border-radius:8px;padding:7px 10px;display:flex;justify-content:space-between;align-items:center"><span style="font-family:var(--mono);font-size:10.5px">' + b + " · " + r + '</span><span class="mono" style="font-size:8.5px;color:' + (ri === 0 ? "var(--ink)" : "var(--gray2)") + '">STAGED</span></div>';
        }).join("") + "</div>";
    }).join("") + '<span class="mono" style="color:var(--gray)">9 bureau letters + furnisher letters · pre-filled from today\'s pull</span></div>';
  }
  function beforeAfter(now, after) {
    var unlocked = (now != null && after != null) ? money(after - now) : "—";
    return '<div style="display:flex;align-items:stretch;gap:12px;margin-top:14px;max-width:620px"><div style="flex:1;border:1px solid var(--line);border-radius:10px;padding:13px 15px"><span class="mono" style="color:var(--gray2)">Today</span><div style="font-family:var(--mono);font-size:clamp(18px,2.4vw,26px);color:var(--gray);margin-top:4px">' + money(now) + '</div><span class="mono" style="color:var(--gray2)">in approvals</span></div><div style="align-self:center;font-family:var(--mono);font-size:18px">→</div><div style="flex:1.2;border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:var(--soft);position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--spectrum)"></div><span class="mono" style="color:var(--gray)">After cleanup, projected</span><div style="font-family:var(--mono);font-size:clamp(22px,3vw,32px);margin-top:4px">' + money(after) + '</div><span class="mono" style="color:var(--gray)">+' + unlocked + " unlocked</span></div></div>";
  }
  function pathRows(items) {
    return '<div style="margin-top:12px">' + items.map(function (it) {
      return '<div style="display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--line)"><span class="mono" style="color:var(--gray2);width:96px;padding-top:3px">' + it[0] + '</span><div><div style="font-size:clamp(12px,1.25vw,14px);font-weight:600">' + it[1] + '</div><div style="font-size:clamp(10.5px,1.05vw,12px);color:var(--gray);margin-top:2px;line-height:1.45">' + it[2] + "</div></div></div>";
    }).join("") + "</div>";
  }
  function deliverableRows() {
    return contents().map(function (name, i) {
      var n = String(i + 1).padStart(2, "0");
      var subs = [
        "Your profile the way lenders actually see it",
        "Pre-filled, bureaus and creditors, escalating rounds",
        "Which accounts, what order, by how much",
        "What you qualify for now, and what's in the way",
        "Ranked in the order you should apply",
        "How to send everything, what to do, what not to do"
      ];
      return row(esc(name), n, subs[i] || "");
    }).join("");
  }
  /* What the pre-approval figure actually covers (F15). Never a guess: the
     server sets this from whether the client has a real company on file. */
  function basisLine(d) {
    if (!d || d.total == null) return "";
    if (d.totalBasis === "personal_plus_business") {
      return "Personal credit lines plus business funding on the companies on your file. All amounts, rates and terms are set by funding partners based on qualification.";
    }
    if (d.totalBasis === "personal_only") {
      return "Personal credit lines only — no business is on your file. All amounts, rates and terms are set by funding partners based on qualification.";
    }
    return "All amounts, rates and terms are set by funding partners based on qualification.";
  }
  function unavail() {
    return '<div class="unavail"><span class="mono">Your numbers are not on this file yet</span><p class="sub" style="margin-top:6px">Nothing here is guessed.</p></div>';
  }
  function reasonsList(d, withPlan) {
    return (d.reasons || []).map(function (pair, i) {
      var plan = withPlan && d.plan && d.plan[i] ? '<span class="mono" style="font-size:8.5px;border:1px solid var(--line);background:var(--soft);border-radius:6px;padding:4px 8px;white-space:nowrap">' + esc(d.plan[i]) + "</span>" : "";
      return '<div style="display:flex;gap:11px;padding:6px 0;border-bottom:1px solid var(--line);align-items:flex-start"><i style="width:3px;align-self:stretch;background:var(--spectrum);opacity:.85;flex:0 0 3px"></i><div style="min-width:0;flex:1"><span class="mono" style="color:var(--gray)">' + esc(pair[0]) + '</span><div style="font-size:clamp(11px,1.1vw,12.5px);margin-top:2px;line-height:1.35">' + esc(pair[1]) + "</div></div>" + plan + "</div>";
    }).join("");
  }

  function clientSlide() {
    var c = code();
    var d = state.engine || {};
    var sv = state.survey || {};
    var funding = isFunding() && !state.edu;
    var edu = state.edu;
    var rung = state.rung;
    var costN = parseInt(String(state.costNum || "").replace(/[^0-9]/g, ""), 10) || 0;
    var feePct = (offer("FUNDING_DFY") && offer("FUNDING_DFY").successFeePercent) || 10;
    var fee = d.total != null ? Math.round(d.total * (feePct / 100)) : null;
    var deposit = offer("FUNDING_DFY") ? offer("FUNDING_DFY").priceCents / 100 : null;
    var backEnd = (fee != null && deposit != null) ? fee - deposit : null;
    var needsEngine = c !== "S-01" && c !== "S-02" && c !== "S-03" && c !== "S-04" && c !== "S-05" && c !== "S-06";

    if (c === "S-07" && !d.available) {
      return slide("S-07", "Your results", kicker("Assessment") + h1("Your numbers are not on this file yet.") + sub("Nothing here is guessed. No amounts or scores are shown."));
    }

    if (c === "S-01") {
      return slide("S-01", "Session", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Funding strategy session") + h1(esc(dash(sv.name)), "clamp(28px,4.2vw,52px)") + '<div style="font-family:var(--mono);font-size:clamp(11px,1.15vw,13px);color:var(--gray);margin-top:10px">' + esc(dash(answer(sv.entity))) + '</div><div class="mono" style="margin-top:16px;letter-spacing:.06em">Customer-initiated · Soft inquiry · No obligation</div><div style="margin-top:18px;max-width:180px" class="hair"></div></div>');
    }
    if (c === "S-02") {
      return slide("S-02", "How this call works", kicker("Process") + h1("A defined path. No obligation at any step.") + pathRows([
        ["01 / BUSINESS", "Your business", "What you're building, where you're at with capital, what's keeping you from scaling."],
        ["02 / ASSESSMENT", "Your assessment", "Soft-pull right here on the call, so we see exactly what the AI can pre-approve you for."],
        ["03 / PATH", "Your path", "Strong fit: I walk you through exactly how. Not a fit: we figure out the best next step."]
      ]) + sub("Sound fair?"));
    }
    if (c === "S-03") {
      var inc = state.incomeEstimates || {};
      return slide("S-03", "Your answers", kicker("Discovery") + h1("This is what you told us. Anything change?") + '<div style="margin-top:8px">' +
        row("Funding target", esc(dash(answer(sv.target)))) +
        row("Planned use", esc(dash(answer(sv.use)))) +
        row("Business", esc(dash(answer(sv.hasBiz))), esc(answer(sv.entity) || "")) +
        businesses().map(function (b) {
          return row(
            esc(b.name || "Business"),
            b.incorporated_date ? esc(monthYear(b.incorporated_date)) : "When was it incorporated?",
            b.incorporated_date ? "Incorporated" : "We need the month and year to price the file"
          );
        }).join("") +
        row("Monthly revenue", esc(dash(answer(sv.revenue)))) +
        row("Annual income (they said)", esc(dash(answer(sv.income)))) +
        row("Income Insight (Experian)", esc(dash(moneyYr(inc.experian)))) +
        row("IncomeView (Equifax)", esc(dash(moneyYr(inc.equifax)))) +
        row("Capital on hand", esc(dash(answer(sv.capital)))) +
        row("What changes with the money", esc(dash(answer(sv.motivation)))) + "</div>");
    }
    if (c === "S-04") {
      var goal = answer(sv.target);
      var goalUse = answer(sv.use);
      /* No target on file: ask for it rather than putting a dash in 64px type
         on the customer's screen. The sentence below drops its lead-in the
         same way, so the copy never reads "—. What does the business…". */
      return slide("S-04", "The goal", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Begin with the end in mind") + h1(goal ? esc(goal) : "How much do you need?", "clamp(32px,5.2vw,64px)") + sub((goalUse ? esc(goalUse) + ". " : "") + "What does the business look like 6 to 12 months from now with this deployed?") + '<div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
    }
    if (c === "S-05") {
      return slide("S-05", "The assessment", kicker("Next step") + h1("See exactly what you qualify for.") + sub("One soft-pull assessment. The engine reads your profile the way funding partners do, before you commit to anything.") + stats([[price("SOFT_PULL"), "one-time assessment"], ["Soft inquiry", "no score impact"], ["60 seconds", "results on this call"]]));
    }
    if (c === "S-06") {
      return slide("S-06", "UnderwriteIQ", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center"><div style="display:flex;justify-content:space-between;align-items:center;max-width:600px">' + kicker("The engine") + '<span class="mono" style="color:var(--gray)">UnderwriteIQ · Operational</span></div><div style="border:1px solid var(--line);background:var(--soft);padding:12px 16px;max-width:600px;border-radius:10px">' +
        TERMINAL.map(function (l, i) { return '<div style="font-family:var(--mono);font-size:clamp(10px,1.05vw,12px);color:' + (i === 0 ? "var(--ink)" : "var(--gray)") + ';line-height:1.85">' + esc(l) + "</div>"; }).join("") +
        '<div style="font-family:var(--mono);font-size:clamp(10px,1.05vw,12px);color:var(--gray2);line-height:1.85">&gt; monitoring for updates _</div></div>' +
        stats([["$25M+", "deployed for clients"], ["Thousands", "of lenders in network"]]) + "</div>");
    }
    if (c === "S-07") {
      if (funding) {
        /* COMPLIANCE REVIEW REQUIRED — the client-facing pre-approval figure.
           F15: this said "$939,500" for a client whose own record read "No
           businesses on file", because the deck stacked business funding onto
           personal money off a loose age field. The number is now the stored
           engine estimate, the same one the client's portal shows, and the line
           under it says out loud what the money covers so nobody has to guess
           whether business funding is in it. */
        return slide("S-07", "Your results", kicker("Pre-approved for approximately") + h1(money(d.total), "clamp(32px,5.2vw,64px)") + sub("Across multiple credit lines with 0 percent introductory rates.") + fine(basisLine(d)) + scores(d.fico) + sampleLine(d));
      }
      return slide("S-07", "Your results", kicker(dash(d.negItems) + " negative items found · read the way lenders read it") + h1("Here's what the AI found.") + scoreBars(d.fico) + sampleLine(d) + '<div style="margin-top:8px">' + reasonsList(d, false) + "</div>" + sub("All fixable. Cleaned up, this file projects to " + money(d.afterFix) + " in approvals."));
    }
    if (c === "S-08") {
      if (edu) {
        return slide("S-08", "The education path", kicker("Learn it. Run it yourself.") + h1("Two ways to own this skill.") + pathRows([
          ["01 / FILE", "Your file, in your hands", "The complete UnderwriteIQ deliverables package, generated from today's pull."],
          ["02 / LIST", "The bank list", "Your lender match list, ranked in the order you should apply."],
          ["03 / PROGRAM", "Funding Mastery, A to Z", "The complete Fundhub credit and funding program, start to finish."]
        ]));
      }
      return slide("S-08", funding ? "The process" : "The plan", kicker(funding ? "Completely done-for-you" : "Recommended path") + h1(funding ? "Three steps. About two weeks." : "Cleaned up first. Funded second.") + pathRows(funding ? [
        ["01 / MATCH", "AI Lender Matching", "The exact lenders that want to approve you right now."],
        ["02 / DEPLOY", "Sequential Round Deployment", "Applications in strategic rounds, Inquiry Sweeps between."],
        ["03 / EXECUTE", "Done-For-You Execution", "A dedicated US-based team runs everything. You don't touch an application."]
      ] : [
        ["01 / CLEAN", "Clean the file", "Every limiting factor addressed, disputes to bureaus and creditors."],
        ["02 / TRACK", "Watch it live", "Every move in real time in your dashboard."],
        ["03 / FUND", "Then we fund you", "Full funding process from the strongest possible position."]
      ]));
    }
    if (c === "S-09") {
      if (edu) return slide("S-09", "Course one", kicker("Everything the system built from your file today") + h1("Your complete deliverables.") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>");
      if (funding) return slide("S-09", "The problem", kicker("Why applying on your own fails") + h1("Everyone else is guessing.") + bars(["Spray and pray. Applications fired at banks that were never going to say yes.", "Every denial is a hard inquiry that tanks your score.", "The lower the score drops, the more the next bank says no."]));
      return slide("S-09", "The findings", kicker("Item by item") + h1(dash(d.negItems) + " items are limiting your approvals.") + '<div style="margin-top:10px">' + reasonsList(d, true) + "</div>" + sub("Every item already has a round assigned. This is the plan, not a promise of what happens later."));
    }
    if (c === "S-10") {
      if (edu) return slide("S-10", "Course two", kicker("The full program") + h1("Funding Mastery. A to Z.") + bars(["The complete Fundhub credit and funding system, taught start to finish.", "Credit, optimization, and funding execution — the whole picture, not pieces.", "Paired with your own file, so you're working on real data, not theory."]));
      if (funding) return slide("S-10", "Step 1 of 3", kicker("Step 1 of 3") + h1("AI Lender Matching.") + bars(["Underwrite IQ, the same AI that just scanned your profile, matches you with the exact lenders that want to approve you right now.", "We already know which banks are going to say yes before we ever submit an application.", "You only apply where you have the highest probability of approval."]));
      return slide("S-10", "Already generated", kicker("FCRA · Metro 2") + h1("The law is on your side.") + '<div style="margin-top:8px;max-width:620px">' +
        row("Maximum possible accuracy", "FCRA §607", "Bureaus are required by federal law to report your file accurately") +
        row("Every dispute investigated", "30–45 days", "FCRA §611 — they must investigate and respond, every round") +
        row("Creditors carry duties too", "FCRA §623", "Furnishers must investigate and correct what they can't verify") +
        row("Deletion tier", "BK §524", "A balance on a discharged debt violates a federal court order, not just a reporting rule") +
        row("Violations pay you", "$100–$1,000+", "Statutory damages for willful violations, plus actual damages and fees", true) + "</div>" +
        sub("Metro 2 is the industry reporting standard. The FCRA is the federal law that makes accuracy enforceable. Every letter carries its statute citations, checked byte for byte."));
    }
    if (c === "S-11") {
      if (funding) return slide("S-11", "The second problem", kicker("What kills approval odds") + h1("Inquiry stacking.") + bars(["Most funding companies submit all your applications at once.", "The banks see all those inquiries hit your report simultaneously, and they start denying you.", "It kills your approval odds before the round is even finished."]));
      return slide("S-11", "Done for you", kicker("How the dispute actually runs") + h1("Straight at the creditor.") + stepsHtml([["Furnisher round", "Metro 2, direct to creditor"], ["Response", "creditor on the record"], ["Proof", "to all 3 bureaus"], ["Escalate", "CFPB · state AG"]], 0) + sub("The creditor's own response becomes the evidence. It goes back to all three bureaus, and if the file still isn't right, we escalate through the administrative process. Done for you, or you run the exact same pack yourself."));
    }
    if (c === "S-12") {
      if (funding) {
        return slide("S-12", "Step 2 of 3", kicker("Step 2 of 3") + h1("Sequential rounds. Inquiry Sweeps.") +
          '<div style="margin-top:12px;max-width:620px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + ["Round 1", "Sweep", "Round 2", "Sweep", "Round 3"].map(function (s, i) {
            return '<div style="font-family:var(--mono);font-size:10.5px;padding:7px 11px;border:1px solid var(--line);background:' + (s === "Sweep" ? "transparent" : "var(--soft)") + ";color:" + (s === "Sweep" ? "var(--gray)" : "var(--ink)") + '">' + s + "</div>" + (i < 4 ? '<span style="font-family:var(--mono);color:var(--gray2)">→</span>' : "");
          }).join("") + '<span class="mono" style="color:var(--gray2)">… up to 12</span></div>' +
          bars(["Round 1 goes out. You get approved.", "Before Round 2, an Inquiry Sweep removes those hard inquiries. Clean slate.", "Repeat until we hit your target of " + money(d.total) + ". Score protected the entire time."]) +
          (state.tier === "FUNDING_PLUS_REPAIR" ? fine("In parallel: your other two bureaus get the full dispute process at the same time, bureaus and creditors. It never delays a round.") : ""));
      }
      return slide("S-12", "The rounds", kicker("Escalating, round after round") + h1("Each round builds on the last.") + stepsHtml([["Round 1", "fires today"], ["Responses", "30–45 days"], ["Round 2", "typical close"], ["Round 3", "if needed"]], 0) + sub("Bureaus must investigate and respond every round, 30 to 45 days. Most files resolve in one to two rounds. Round three is already mapped from your file."));
    }
    if (c === "S-13") {
      if (funding) return slide("S-13", "The result", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Versus the average funding company") + h1("2 to 3x more.", "clamp(36px,5.8vw,72px)") + sub("Approved for 2 to 3 times more, in a fraction of the time, with your score protected the entire way.") + '<div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
      return slide("S-13", "Your dashboard", kicker("Real time") + h1("Watch every move happen.") + '<div style="margin-top:10px">' + row("Every dispute", "Live", "The moment it goes out") + row("Every response", "Logged", "Bureau and creditor replies, as they land") + row("Every round", "Tracked", "Where the file stands, at any moment") + "</div>");
    }
    if (c === "S-14") {
      if (funding) return slide("S-14", "Step 3 of 3", kicker("Step 3 of 3") + h1("Done for you. Start to finish.") + bars(["A dedicated funding team. Three specialists whose only job is getting you funded.", "Every application, every follow-up with the banks, every inquiry sweep. You literally don't lift a finger.", "You focus on running and scaling the business. We handle the capital side."]));
      return slide("S-14", "After cleanup", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Why we clean up first") + h1("The same file, two positions.", "clamp(22px,3.2vw,40px)") + beforeAfter(d.total, d.afterFix) + fine("Projection based on your current file. Not a guarantee of approval, amounts, rates, or terms.") + "</div>");
    }
    if (c === "S-15") {
      if (funding) return slide("S-15", "The timeline", kicker("Signing to capital") + h1("About two weeks.") + '<div style="margin-top:10px;max-width:620px">' + row("Within 24 business hours", "Advisor", "Your dedicated funding advisor begins working your file") + row("Within 72 business hours", "Round 1", "Your first applications are submitted") + row("~72 hours after", "Approvals", "First approvals typically start rolling in") + row("~2 weeks", "Deployed", "Average client, signing to capital deployed", true) + "</div>");
      return slide("S-15", "The timeline", kicker("Already built from today's pull") + h1("It's sitting in the queue.") + lettersGrid() + '<div style="margin-top:6px">' + row("All that's left", "The button", "Say the word and Round 1 is out today", true) + "</div>");
    }
    if (c === "S-16") {
      if (!funding && !edu) {
        return slide("S-16", "The wrong way", kicker("What we will never do") + h1("Two wrongs don't make a right.") + '<div style="margin-top:8px;max-width:620px">' +
          row('So-called "credit sweeps"', "Fraud", "Fake FTC identity-theft and police reports to wipe a file — a federal crime, up to 5 years") +
          row('Even when it "works"', "It bounces", "The creditor just re-reports the account next month. Fraud deletions don't stick.") +
          row("Real deletions stick", "FCRA §611", "Reinsertion without 5-day written notice and certification is itself a violation", true) + "</div>" +
          sub("That's the difference. Disputes filed here are documented and FCRA-grounded, so what comes off stays off — and if a bureau ever slips one back in, the law puts them in deep trouble, not you.") +
          fine("Not to be confused with Fundhub Inquiry Sweeps — documented inquiry disputes filed on the record as part of funding rounds."));
      }
      return slide("S-16", "Financing we help you access", kicker(funding ? "The menu" : "What opens up after cleanup") + h1("Built around what you actually need.") +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">' + MENU.map(function (m) {
          return '<div style="border:1px solid var(--line);background:var(--soft);padding:9px 11px;border-radius:10px"><span class="mono" style="color:var(--gray2)">' + m[0] + '</span><div style="font-size:clamp(11px,1.1vw,12.5px);font-weight:650;margin-top:4px">' + m[1] + '</div><div style="font-size:clamp(9.5px,.95vw,10.5px);color:var(--gray);margin-top:3px;line-height:1.4">' + m[2] + "</div></div>";
        }).join("") + "</div>" +
        fine("Intro APR offers are set by card issuers, apply for limited promotional periods, and revert to issuer standard rates. All amounts, rates, and terms are determined by funding partners based on qualification."));
    }
    if (c === "S-17") {
      return slide("S-17", "Alignment", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("How we work") + h1("Our team is all in.", "clamp(24px,3.6vw,44px)") + sub("We're rolling up our sleeves and getting in the trenches with you on this. So it matters to us that you feel good about the process.") + '<div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
    }
    if (c === "S-18") {
      return slide("S-18", "Where do you fall", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Scale of 1 to 10") + h1("Where do you feel like you fall?", "clamp(24px,3.6vw,44px)") + '<div style="margin-top:18px;display:flex;align-items:center;gap:12px;max-width:480px"><span class="mono" style="color:var(--gray2)">1</span><div style="flex:1"><div class="hair"></div></div><span class="mono">10</span></div><div style="display:flex;justify-content:space-between;max-width:480px;margin-top:6px"><span class="mono" style="color:var(--gray2)">Not for me</span><span class="mono" style="color:var(--gray)">Exactly what I need</span></div></div>');
    }
    if (c === "S-19") {
      if (edu) {
        if (rung === 0) return slide("S-19", "The investment", fill(kicker("Funding Mastery, A to Z") + h1(price("FUNDING_MASTERY"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("The full Fundhub program", "A to Z", "Credit, optimization, and funding execution, start to finish") + row("Your own file", "Included data", "You work on your real reports, not examples") + "</div>" + financingNote("FUNDING_MASTERY")));
        return slide("S-19", "The investment", fill(kicker("Course one, everything from your file") + h1(price("UWIQ_DELIVERABLES"), "clamp(24px,3.8vw,44px)") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>" + financingNote("UWIQ_DELIVERABLES")));
      }
      if (funding) {
        return slide("S-19", "The investment", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("To activate the system today") + '<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">' + h1(price("FUNDING_DFY"), "clamp(32px,5.2vw,60px)") + '<span style="font-family:var(--mono);font-size:clamp(12px,1.3vw,15px);color:var(--gray)">deposit</span></div>' + sub("Not an additional fee. It goes directly toward your 10 percent success fee on the back end.") + '<div style="margin-top:14px;max-width:200px" class="hair"></div></div>');
      }
      if (rung === 0) return slide("S-19", "The investment", fill(kicker("Done-for-you credit repair") + h1(price("REPAIR_DFY"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("Forensic audit", "Included", "Your full file, the way lenders see it") + row("Disputes", "All rounds", "Both the bureaus and the creditors, escalating") + row("Your dashboard", "Real time", "Watch every move happen. You don't touch a thing.") + "</div>" + financingNote("REPAIR_DFY")));
      if (rung === 1) return slide("S-19", "The investment", fill(kicker("Try it first, done for you") + h1(price("REPAIR_TRIAL"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("Round 1", "We run it", "Our team fires your first full round, bureaus and creditors") + row("You watch", "Dashboard", "Every dispute and response, live") + row("Then decide", "Your call", "Continue full done-for-you, or take it from here") + "</div>" + financingNote("REPAIR_TRIAL")));
      return slide("S-19", "The investment", fill(kicker("Do it yourself, everything from your file") + h1(price("UWIQ_DELIVERABLES"), "clamp(24px,3.8vw,44px)") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>" + financingNote("UWIQ_DELIVERABLES")));
    }
    if (c === "S-20") {
      if (edu) return slide("S-20", "Two courses", fill(kicker("Side by side") + h1("Two courses. One skill set.") + '<div style="margin-top:10px;max-width:620px">' + row("Course 1 — UWIQ deliverables + bank list", price("UWIQ_DELIVERABLES"), "Everything from your file. You execute it with the how-to course.") + row("Course 2 — Funding Mastery, A to Z", price("FUNDING_MASTERY"), "The complete program, start to finish, on your own data", true) + "</div>"));
      if (funding) return slide("S-20", "The math", fill(kicker("Line by line") + h1("We only make money when you get funded.") + '<div style="margin-top:10px;max-width:560px">' + row("Your funding", money(d.total), "Pre-approval from today's scan") + row("Total success fee, " + feePct + " percent", money(fee)) + row("Your deposit, credited", deposit != null ? ("- " + money(deposit)) : "—") + row("Back end balance", money(backEnd), "Only charged once the capital is actually in your hands", true) + "</div>" + sub("Our success is literally tied to yours.")));
      if (costN > 0) return slide("S-20", "Then we fund you", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("What staying stuck costs") + h1(money(costN) + " a month.", "clamp(28px,4.4vw,52px)") + '<div style="margin-top:10px;max-width:560px">' + row("Every month this file sits", money(costN), "Your number, from earlier on this call") + row("Over a year", money(costN * 12), "Gone, without the file moving an inch", true) + row("The fix", "Starts today", "Cleaned up first, funded second, strongest position") + "</div></div>");
      return slide("S-20", "Then we fund you", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("What staying stuck costs") + h1("Cleaned up first. Funded second.", "clamp(24px,3.6vw,44px)") + sub("We get your credit cleaned up first, so when we run the full funding process you're in the strongest possible position and we can maximize your approval amount.") + "</div>");
    }
    if (c === "S-21") {
      if (edu) return slide("S-21", "When we start", kicker("Set up on this call") + h1("You leave with it today.") + '<div style="margin-top:10px;max-width:620px">' + row("On this call", "Access", "Account and access squared away before we hang up") + row("Today", "Your file", "Deliverables generate from the pull we just ran") + row("When you're ready", "Funding", "Run the full funding process whenever you want") + "</div>");
      if (funding) return slide("S-21", "Three guarantees. In writing.", kicker("Guarantees") + h1("You're protected three ways.") + '<div style="display:flex;gap:9px;margin-top:12px">' + GUARANTEES.map(function (g) {
        return '<div style="flex:1;min-width:0;border:1px solid var(--line);background:var(--soft);padding:11px 13px;border-radius:10px"><div class="hair"></div><div style="margin-top:9px"><span class="mono" style="color:var(--gray)">' + g[0] + '</span></div><div style="font-size:clamp(11.5px,1.2vw,13.5px);font-weight:700;margin-top:5px;letter-spacing:-.01em;line-height:1.2">' + g[1] + '</div><div style="font-size:clamp(9.5px,1vw,11px);color:var(--gray);margin-top:5px;line-height:1.45">' + g[2] + "</div></div>";
      }).join("") + "</div>" + fine("These guarantees are not a guarantee of credit approval, funding amounts, rates, or terms, which are determined by funding partners."));
      return slide("S-21", "When we start", kicker("What happens when we start") + h1("Round one goes out today.") + '<div style="margin-top:10px;max-width:620px">' + row("Today", "Letters out", "Generated from the pull we just ran, in your email") + row("Your dashboard", "Live", "Track every dispute and every response") + row("Round by round", "Escalate", "Until the file is where it needs to be") + "</div>");
    }
    if (c === "S-22") {
      return slide("S-22", "Ready when you are", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + h1("Ready when you are.", "clamp(28px,4.6vw,56px)") + '<div class="mono" style="margin-top:12px;letter-spacing:.06em">' + (funding ? "Customer-initiated · Three guarantees · Two weeks" : "Customer-initiated · Starts today · Tracked live") + '</div><div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
    }
    if (c === "S-23") {
      /* "Advisor contact" is not true on every sale. The rows follow the offer
         the closer actually chose, the same way the wrap script does (F23). */
      var setup = row("Agreement", "Sent", "Review it while we handle billing")
        + row("Billing", "On this call", "Secure payment, processed now");
      if (edu) {
        setup += row("Your access", "Today", "Set up on this call, with everything from today's pull");
      } else if (funding) {
        setup += row("Welcome email", "Incoming", "Advisor contact, timeline, and what we need from you");
      } else {
        setup += row("Welcome email", "Incoming", "Your dashboard, your first round, and what happens next");
      }
      return slide("S-23", "Getting you set up", fill(kicker("Right now, on this call") + h1("Let's get this going.") + '<div style="margin-top:10px;max-width:620px">' + setup + "</div>"));
    }
    if (c === "S-24") {
      var next = edu
        ? row("Today", "Deliverables", "Everything from your file lands in your email") + row("Your pace", "Program", "Work through it on your own schedule") + row("When you're ready", "Funding", "We run the full process whenever you want")
        : funding
          ? row("Within 24 business hours", "Advisor", "Your dedicated funding advisor reaches out and starts on your file") + row("Within 72 business hours", "Round 1", "Your first round of applications is submitted") + row("A few days after", "Approvals", "You should start seeing your first approvals")
          : row("Today", "Round 1", "Your letters generate from this pull and land in your email") + row("Your dashboard", "Live", "Track every dispute and every response") + row("When it's clean", "Funding", "We run the full process at maximum strength");
      return slide("S-24", "Welcome aboard", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + h1("Here's what happens next.", "clamp(22px,3.4vw,42px)") + '<div style="margin-top:10px;max-width:560px">' + next + '</div><div style="margin-top:16px;display:flex;align-items:center;gap:12px"><span class="brand">fundhub<span>.</span></span><div style="flex:1;max-width:140px" class="hair"></div><span class="mono">systems nominal</span></div></div>');
    }
    return needsEngine && !d.available ? slide(c, "Session", unavail()) : "";
  }

  function ckBtn(label, action, primary, extra) {
    return '<button type="button" class="ck-btn' + (primary ? " k" : "") + '" data-act="' + esc(action) + '"' + (extra || "") + ">" + esc(label) + "</button>";
  }

  /* ───────── SEND CONTROLS (F24) ─────────
     Chris, on 2026-09-03: "when I click it, it should show that it's been
     clicked... I press it like three or four times, and then all of a sudden
     the client gets like four or five text messages, four or five emails,
     because I can't really tell." Two pay-link emails went to the same client
     at 6:47 PM carrying two DIFFERENT checkout links, so the duplicate presses
     were making duplicate real payments possible.

     Every send control now: shows a pressed state the instant it is clicked,
     is disabled while the request is in flight, refuses a second press for a
     few seconds after a success (owner's number: three to five), and carries a
     "Sent at 6:47 PM" line that STAYS on the button — a toast that vanishes is
     what left the closer guessing. The repeat count is shown too, so a real
     double send is visible instead of invisible. */
  var SEND_COOLDOWN_MS = 4000;

  function sendMark(act) { return state.sends[act] || null; }
  function sendLocked(act) {
    var m = sendMark(act);
    if (!m) return false;
    if (m.busy) return true;
    return m.coolUntil != null && Date.now() < m.coolUntil;
  }
  function clockTime(d) {
    try {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" });
    } catch (e) {
      return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  }
  function markSending(act) {
    var prev = sendMark(act) || {};
    state.sends[act] = { busy: true, sentAt: prev.sentAt || null, count: prev.count || 0, coolUntil: null };
    render();
  }
  function markSent(act, ok) {
    var prev = sendMark(act) || {};
    if (!ok) {
      /* A failed send is not a send. No timestamp, no cooldown — they need to
         be able to try again straight away. */
      state.sends[act] = { busy: false, sentAt: prev.sentAt || null, count: prev.count || 0, coolUntil: null };
      render();
      return;
    }
    state.sends[act] = {
      busy: false,
      sentAt: clockTime(new Date()),
      count: (prev.count || 0) + 1,
      coolUntil: Date.now() + SEND_COOLDOWN_MS
    };
    render();
    setTimeout(function () {
      var m = state.sends[act];
      if (m) m.coolUntil = null;
      render();
    }, SEND_COOLDOWN_MS);
  }

  function sendBtn(label, action, primary, blocked) {
    var m = sendMark(action);
    var busy = !!(m && m.busy);
    var cooling = !busy && sendLocked(action);
    var off = busy || cooling || !!blocked;
    var text = busy ? "Sending…" : (cooling ? "Sent — hold on" : label);
    var html = ckBtn(text, action, primary && !off, off ? " disabled" : "");
    if (m && m.sentAt) {
      html += '<div class="sent-at">Sent at ' + esc(m.sentAt)
        + (m.count > 1 ? " · sent " + m.count + " times" : "") + "</div>";
    }
    return html;
  }

  /* The close script for the offer that was actually chosen (F23). */
  function closeTalk(c) {
    var map = CLOSE_TALK[selectedOfferKey()];
    return (map && map[c]) || null;
  }

  /* Ask for the month and year each company was incorporated. Business age is
     what the lender stack prices off, and a blank date means nobody asked.
     Saves through the same staff action the Control Panel uses. */
  function incorporationAsk() {
    var all = businesses();
    if (!all.length) return "";
    var missing = businessesNeedingDate();
    var html = '<div><span class="mono">When was each business incorporated?</span>';
    if (!missing.length) {
      html += '<div style="font-size:11px;color:var(--gray);margin-top:5px">All '
        + all.length + ' on file. Read them back and confirm nothing changed.</div>';
    } else {
      html += '<div style="font-size:11px;color:var(--gray);margin-top:5px">'
        + missing.length + ' of ' + all.length
        + ' have no date. Ask for the month and year, then save. Do not take a guess.</div>';
    }
    html += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:7px">';
    all.forEach(function (b, i) {
      var val = b.incorporated_date ? String(b.incorporated_date).slice(0, 7) : "";
      html += '<div><div style="font-size:11px;font-weight:650">' + esc(b.name || "Business " + (i + 1)) + "</div>"
        + '<div style="font-size:9.5px;color:var(--gray2);margin-top:1px">'
        + (b.incorporated_date ? "On file · " + esc(monthYear(b.incorporated_date)) : "No date on file")
        + "</div>"
        + '<input id="fh-inc-' + i + '" type="month" value="' + esc(val)
        + '" style="margin-top:4px;width:100%;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:11px;padding:7px 9px;outline:none">'
        + ckBtn(state.incBusy === b.name ? "Saving\u2026" : "Save month / year", "stamp-inc:" + i)
        + "</div>";
    });
    html += "</div>";
    if (state.incMsg) html += '<div style="font-size:11px;color:var(--gray);margin-top:6px">' + esc(state.incMsg) + "</div>";
    return html + "</div>";
  }

  function cockpit() {
    var t = closeTalk(code()) || TALK[code()] || { title: "", lines: [], watch: "" };
    var d = state.engine || {};
    var funding = isFunding() && !state.edu;
    var ph = phase();
    var showEngine = ph !== "01 Intro" && ph !== "02 Discovery";
    var html = '<div class="ck"><div class="ck-hd"><div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">' + esc(ph) + '</span><span class="mono">' + (state.idx + 1) + " / " + DECK.length + '</span></div><div class="t">' + esc(t.title) + "</div></div><div class=\"ck-bd\">";

    if (state.obj !== null) {
      var ob = OBJECTIONS[state.obj];
      html += '<div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">Objection</span><button type="button" class="btn-ghost" data-act="obj-back">Back</button></div>';
      html += '<div style="font-size:14px;font-weight:700">' + esc(ob.t) + "</div>";
      html += ob.lines.map(function (l) { return '<div class="say">' + esc(l) + "</div>"; }).join("");
      html += ckBtn(ob.jumpLabel, "obj-jump:" + ob.jump, true);
    } else if (state.showRef) {
      html += '<div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">Reframing patterns</span><button type="button" class="btn-ghost" data-act="ref-back">Back</button></div>';
      html += REFRAMES.map(function (r) { return "<div><div style=\"font-size:11.5px;font-weight:700\">" + esc(r[0]) + '</div><div style="font-size:11px;color:var(--gray);margin-top:2px">' + esc(r[1]) + "</div></div>"; }).join("");
    } else {
      html += '<div><span class="mono">Say this</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">';
      t.lines.filter(function (l) {
        if (l.indexOf("EDU:") === 0) return state.edu;
        if (l.indexOf("FUND:") === 0) return funding && !state.edu;
        if (l.indexOf("REPAIR:") === 0) return !funding && !state.edu;
        return true;
      }).forEach(function (l) {
        var first = String((state.survey && state.survey.name) || "").trim().split(/\s+/)[0] || "";
        var said = l.replace(/^FUND: |^REPAIR: |^EDU: /, "");
        if (first) said = said.replace(/\[First Name\]/g, first);
        html += '<div class="say">' + esc(said) + "</div>";
      });
      html += '</div></div><div class="watch"><span class="mono">Watch for</span><div style="font-size:11px;color:var(--gray);margin-top:4px">' + esc(t.watch) + "</div></div>";

      if (ph === "02 Discovery") {
        /* Above the belief list on purpose: on a laptop the cockpit scrolls,
           and an ask below the fold is an ask nobody makes. */
        html += incorporationAsk();
        html += '<div><span class="mono">7 beliefs — check when THEY say it</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">';
        DISCOVERY.forEach(function (b) {
          var on = !!state.checks[b[0]];
          html += '<button type="button" data-act="check:' + b[0] + '" style="display:flex;gap:8px;align-items:flex-start;text-align:left;background:' + (on ? "var(--paper)" : "transparent") + ";border:1px solid var(--line);padding:5px 8px;cursor:pointer\"><span style=\"width:12px;height:12px;margin-top:2px;flex-shrink:0;border:1px solid var(--ink);background:" + (on ? "var(--ink)" : "transparent") + '"></span><span><span style="font-size:11px;font-weight:650">' + b[0] + '</span><span style="display:block;font-size:9.5px;color:var(--gray2);margin-top:1px">' + esc(b[1]) + "</span></span></button>";
        });
        html += '</div><div style="margin-top:7px"><span class="mono">Their monthly cost of inaction</span><input id="fh-cost" value="' + esc(state.costNum) + '" placeholder="$ per month, in their words" style="margin-top:4px;width:100%;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:11px;padding:7px 9px;outline:none"></div></div>';
      }

      if (ph === "03 Soft pull" || code() === "S-05") {
        var sp = state.softPull || {};
        html += '<div><span class="mono">Live soft pull</span>';
        html += '<div style="margin-top:6px;font-family:var(--mono);font-size:10px;color:var(--gray);line-height:1.55">';
        html += "<div>consent: " + (sp.consent_valid ? "on file" : "waiting") + "</div>";
        var amt = sp.diagnostic_amount_cents != null ? ("$" + (Number(sp.diagnostic_amount_cents) / 100).toFixed(2)) : "$32";
        html += "<div>paid " + amt + ": " + (sp.diagnostic_paid ? "yes" : (sp.diagnostic_link_status || "not yet")) + "</div>";
        /* F16 — this read "pull: not started" on the same four lines as
           "tier: FULL_FUNDING" and a full set of scores. The server now answers
           from the stored credit result when one exists, and says which record
           it read, so the two can never contradict each other again. */
        html += "<div>pull: " + esc(sp.pull_status || "not started")
          + (sp.pull_status_source === "crs_result" ? " (from the stored result)" : "") + "</div>";
        if (sp.outcome_tier) html += "<div>tier: " + esc(sp.outcome_tier) + "</div>";
        html += '</div><div style="margin-top:7px;display:flex;flex-direction:column;gap:5px">';
        html += ckBtn("Send soft pull ($32 + approval form)", "softpull", true);
        html += '</div><div style="font-size:10px;color:var(--gray2);margin-top:5px">Catalog price $32. Live prove may use $1. Stay on the Meet.</div></div>';

        html += '<div><span class="mono">No-pay downsell — e-book</span>';
        html += '<div style="margin-top:6px;display:flex;gap:6px;align-items:center">';
        html += '<input id="fh-ebook" value="' + esc(state.ebookDollars) + '" placeholder="$ amount" style="flex:1;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:11px;padding:7px 9px;outline:none">';
        html += ckBtn("Send e-book email", "ebook", false);
        html += '</div><div style="font-size:10px;color:var(--gray2);margin-top:5px">You set the price. Empty PDF attached until the real file is ready.</div></div>';
      }

      if (code() === "S-07") {
        html += '<div><span class="mono">Route the call</span><div style="font-size:10.5px;color:var(--gray2);margin:4px 0 6px">Engine returned ' + esc(d.label || "unavailable") + ". Education is client-driven — route it only if that's their ask.</div><div style=\"display:flex;flex-direction:column;gap:5px\">";
        [["FULL_FUNDING", "FULL FUNDING"], ["FUNDING_PLUS_REPAIR", "FUNDING PLUS REPAIR"], ["REPAIR_ONLY", "REPAIR ONLY"]].forEach(function (pair) {
          html += ckBtn(pair[1], "tier:" + pair[0], pair[0] === state.tier && !state.edu);
        });
        html += ckBtn("EDUCATION PATH", "edu", state.edu);
        html += "</div></div>";
      }

      if (code() === "S-18") {
        html += '<div><span class="mono">Their number</span><div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">';
        for (var n = 1; n <= 10; n++) {
          html += '<button type="button" data-act="temp:' + n + '" style="font-family:var(--mono);font-size:10.5px;width:27px;height:27px;background:' + (state.temp === n ? "var(--ink)" : "transparent") + ";color:" + (state.temp === n ? "var(--paper)" : "var(--gray)") + ";border:1px solid var(--line);cursor:pointer\">" + n + "</button>";
        }
        html += "</div>";
        if (state.temp > 0 && state.temp < 8) html += '<div style="font-size:10.5px;margin-top:6px;border:1px solid var(--line);padding:8px">Below 8. Ask: what\'s keeping you from a 9 or 10? Handle it before the investment.</div>';
        html += "</div>";
      }

      if (code() === "S-19" && (!funding || state.edu)) {
        html += '<div><span class="mono">Ladder — lead with the top rung</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:5px">';
        if (state.edu) {
          html += ckBtn("Course 2: Funding Mastery  " + price("FUNDING_MASTERY"), "rung:0", state.rung === 0);
          html += ckBtn("Course 1: UWIQ deliverables + bank list  " + price("UWIQ_DELIVERABLES"), "rung:1", state.rung === 1);
        } else {
          html += ckBtn("Onboard now: full done-for-you  " + price("REPAIR_DFY"), "rung:0", state.rung === 0);
          html += ckBtn("Trial: first round done-for-you  " + price("REPAIR_TRIAL"), "rung:1", state.rung === 1);
          html += ckBtn("DIY deliverables + course  " + price("UWIQ_DELIVERABLES"), "rung:2", state.rung === 2);
        }
        /* The education hint READS the two prices instead of asserting a drop
           between them. Capital Blueprint moved to $5,000 on 2026-09-03 (owner-set,
           its own contract states that tuition), which is what Capital Academy
           already costs — so the old wording rendered "Lead with the $5,000. Only
           offer the $5,000 if it's a no." A closer cannot step down to the same
           number, and printing it as though he can is how a screen starts lying. */
        var eduHint;
        if (state.edu) {
          var topPrice = price("FUNDING_MASTERY");
          var altPrice = price("UWIQ_DELIVERABLES");
          eduHint = topPrice === altPrice
            ? "Both courses are " + topPrice + ". Lead with Funding Mastery; this is a choice of course, not a step down on price."
            : "Lead with the " + topPrice + ". Only offer the " + altPrice + " if it's a no.";
        } else {
          eduHint = "Top down. Only step down on a no.";
        }
        html += '</div><div style="font-size:10.5px;color:var(--gray2);margin-top:6px">' + eduHint + "</div>";
        if (!state.edu) html += '<div style="margin-top:7px">' + ckBtn("UnderwriteIQ package → repair + funding", "bridge") + '<div style="font-size:10px;color:var(--gray2);margin-top:4px">Bridges them to the combined package. Jumps to the funding pitch.</div></div>';
        html += "</div>";
      }

      if (code() === "S-23") {
        /* ONE ACTION LEADS (F25). Chris: "we've already chosen the offer. So
           it's just extra buttons that will throw people off. Obviously,
           there's a black label on it. That's not enough." Section 07 used to
           put the pay link, an invoice button, a contract button, a contract
           wording FORM, a deliverables button, a referral tick box and the
           disposition button on screen at once. Now the money action for the
           chosen offer leads, its own fulfilment step sits directly under it,
           and everything else is one click deeper (UI-STANDARDS section 9). */
        var offerKey = selectedOfferKey();
        var chosen = offer(offerKey);
        html += '<div><span class="mono">Do this now</span>';
        html += '<div style="font-size:10.5px;color:var(--gray2);margin:4px 0 6px">Chosen: '
          + esc((chosen && chosen.name) || offerKey) + " · " + esc(price(offerKey)) + "</div>";
        html += '<div style="margin-top:2px;display:flex;flex-direction:column;gap:5px">';
        if (!isPrimaryPayOffer(offerKey)) {
          html += '<label class="mono" for="fh-sale-motion">Sale motion</label>';
          html += '<select id="fh-sale-motion" style="width:100%;border:1px solid var(--line);background:transparent;padding:6px 8px;font-size:12px">';
          html += '<option value="">Choose downsell or upsell</option>';
          html += '<option value="downsell"' + (state.saleMotion === "downsell" ? " selected" : "") + ">Downsell</option>";
          html += '<option value="upsell"' + (state.saleMotion === "upsell" ? " selected" : "") + ">Upsell</option>";
          html += "</select>";
        }
        html += sendBtn("Send agreement + pay link", "pay", true);

        /* The fulfilment step for THIS offer, and only this offer. */
        if (state.edu) {
          html += sendBtn("Send deliverables package now", "letters", false);
        } else if (isRepairDfyOffer()) {
          html += '<div style="margin-top:4px"><span class="mono">Amount paid today</span>';
          html += '<input id="fh-repair-paid" value="' + esc(state.amountPaidDollars || String(offerDollars() || "")) + '" placeholder="dollars" style="margin-top:4px;width:100%;background:transparent;border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:11px;padding:7px 9px;outline:none">';
          html += "</div>";
          html += ckBtn(state.repairBusy ? "Working…" : "Stage letters", "stage-letters", false, state.repairBusy ? " disabled" : "");
          html += sendBtn("Send letters now", "send-letters", false, !state.stagedLetters.length);
          if (state.repairMsg) html += '<div style="font-size:10.5px;color:var(--gray);margin-top:6px">' + esc(state.repairMsg) + "</div>";
          if (state.stagedLetters.length) {
            html += '<div style="margin-top:8px;border:1px solid var(--line);padding:8px;max-height:160px;overflow:auto">';
            html += '<div class="mono" style="margin-bottom:6px">' + state.stagedLetters.length + " letter(s) staged</div>";
            state.stagedLetters.forEach(function (L) {
              html += '<div style="font-size:10.5px;margin-bottom:6px"><b>' + esc(L.bureau) + "</b> · " + (L.itemCount || 0) + " items";
              if (L.body_text) html += '<div style="color:var(--gray);margin-top:2px;white-space:pre-wrap;max-height:56px;overflow:hidden">' + esc(String(L.body_text).slice(0, 220)) + (L.body_text.length > 220 ? "…" : "") + "</div>";
              html += "</div>";
            });
            html += "</div>";
          }
        } else if (lettersOk()) {
          html += sendBtn("Generate letters and email now", "letters", false);
        }

        html += ckBtn(state.moreOpen ? "Hide the other actions" : "Other actions", "more");
        if (state.moreOpen) {
          html += '<div style="border:1px solid var(--line);padding:8px 9px;display:flex;flex-direction:column;gap:5px">';
          html += sendBtn("Invoice this client", "invoice", false);
          /* F27, owner-set: contract send is ONE CLICK, no typing. The
             "wording for this client" panel — company name, what the program
             includes, program fee, access length, company email, and a "Send
             this wording" button — is gone. Chris: "it should already have that
             information. Just send it... it needs to be just removed
             completely." The system holds the client, the offer, the price and
             the template, and it already matched the right template to the
             offer without help. Removing the form also removes F28: the seller
             on the agreement is Fundhub, never a name staff typed. */
          html += sendBtn("Send contract", "contract", false);
          if (state.contractLink) {
            html += ckBtn("Copy the sign link", "contract-copy", false);
            html += '<input id="fh-contract-link" readonly value="' + esc(state.contractLink) + '" style="width:100%;border:1px solid var(--line);background:transparent;font-family:var(--mono);font-size:10px;padding:6px 8px">';
          }
          if (state.contractMsg) html += '<div style="font-size:10.5px;color:var(--gray)">' + esc(state.contractMsg) + "</div>";
          /* Kept in state, not read off the DOM at the end. This panel opens
             and closes, and every open re-renders the checkbox from scratch —
             a tick read off the element at disposition time would be silently
             lost the moment the panel was closed. */
          html += '<label class="mono" style="display:flex;align-items:center;gap:8px;margin:4px 0 0;font-size:12px;color:var(--ink)">' +
            '<input type="checkbox" id="fh-repair-referral"' + (state.repairReferral ? " checked" : "") + "> Repair referral</label>";
          html += "</div>";
        }
        html += ckBtn("Log disposition and close", "disp");
        html += "</div></div>";
      }

      if (ph === "05 Commit" || ph === "07 Close") {
        html += '<div><span class="mono">Descent ladder — every call monetizes</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">';
        var ladder = [
          ["fund", "Funding · " + price("FUNDING_DFY") + " deposit", "desc:fund", funding && !state.edu],
          ["dfy", "Repair DFY · " + price("REPAIR_DFY"), "desc:dfy", !funding && !state.edu && state.rung === 0],
          ["trial", "Repair trial round · " + price("REPAIR_TRIAL"), "desc:trial", !funding && !state.edu && state.rung === 1],
          ["diy", "DIY letters + course · " + price("UWIQ_DELIVERABLES"), "desc:diy", !funding && !state.edu && state.rung === 2],
          ["eduTop", "Funding Mastery · " + price("FUNDING_MASTERY"), "desc:eduTop", state.edu && state.rung === 0],
          ["eduLow", "Education deliverables · " + price("UWIQ_DELIVERABLES"), "desc:eduLow", state.edu && state.rung === 1]
        ];
        ladder.forEach(function (row) {
          html += '<button type="button" data-act="' + row[2] + '" style="font-family:var(--mono);font-size:10px;text-align:left;padding:7px 10px;border-radius:7px;background:' + (row[3] ? "var(--ink)" : "transparent") + ";color:" + (row[3] ? "var(--paper)" : "var(--gray)") + ";border:1px solid var(--line);cursor:pointer\">" + esc(row[1]) + "</button>";
        });
        html += '</div><div style="font-size:10px;color:var(--gray2);margin-top:5px">One click reshapes the price screen. Descend only on a no. Financing available on everything except the soft pull and the funding deposit.</div></div>';
        html += '<div><div style="display:flex;justify-content:space-between"><span class="mono">Objections</span><button type="button" class="btn-ghost" data-act="reframes">Reframes</button></div><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">';
        OBJECTIONS.forEach(function (o, i) {
          html += '<button type="button" class="btn-ghost" data-act="obj:' + i + '">' + esc(o.t) + "</button>";
        });
        html += "</div></div>";
      }

      if (showEngine) {
        var beliefs = Object.keys(state.checks).filter(function (k) { return state.checks[k]; }).length;
        html += '<div style="border-top:1px solid var(--line);padding-top:9px"><span class="mono">Engine data</span><div style="margin-top:5px;font-family:var(--mono);font-size:10px;color:var(--gray);line-height:1.6">';
        if (!d.available) html += "<div>Your numbers are not on this file yet</div>";
        else {
          /* F15 — the money line names what it covers and where it came from.
             It used to print a figure this screen had just recalculated, 4.7x
             the one stored for the same file. */
          var basis = d.totalBasis === "personal_plus_business"
            ? " personal+business"
            : (d.totalBasis === "personal_only" ? " personal only" : "");
          html += "<div>" + esc(state.tier || "—") + (state.edu ? " · route EDU" : state.forceRepair ? " · DESCENT" : "") + " · " + money(d.total) + basis + " · " + dash(d.fico.ex) + "/" + dash(d.fico.tu) + "/" + dash(d.fico.eq) + (d.sample === true ? " · sample" : "") + "</div>";
          html += "<div>afterFix " + money(d.afterFix) + " · beliefs " + beliefs + "/7" + (state.temp > 0 ? " · temp " + state.temp + "/10" : "") + "</div>";
        }
        html += "</div></div>";
      }
    }

    html += '</div><div class="ck-ph">';
    ["01", "02", "03", "04", "05", "07"].forEach(function (p) {
      var active = ph.indexOf(p) === 0;
      html += '<button type="button" data-act="phase:' + p + '" style="flex:1;font-family:var(--mono);font-size:9px;letter-spacing:.08em;padding:5px 0;background:' + (active ? "var(--ink)" : "transparent") + ";color:" + (active ? "var(--paper)" : "var(--gray2)") + ";border:1px solid var(--line);cursor:pointer\">" + p + "</button>";
    });
    html += '</div><div class="ck-ft"><button type="button" class="ck-btn" data-act="back" style="width:auto"' + (state.idx === 0 ? " disabled" : "") + ">Back</button><button type=\"button\" class=\"ck-btn k\" data-act=\"next\" style=\"flex:1\" " + (state.idx === DECK.length - 1 ? "disabled" : "") + ">Next screen</button></div>";
    if (state.toast) html += '<div class="toast">' + esc(state.toast) + "</div>";
    html += "</div>";
    return html;
  }

  function render() {
    var root = document.getElementById("app");
    if (!root) return;
    if (state.error) {
      var signIn = state.errorSignIn
        ? ' &nbsp;·&nbsp; <a href="' + esc(state.errorSignIn) + '">Sign in as someone else</a>'
        : "";
      root.innerHTML = '<div class="gate"><span class="mono">Present</span><h1 class="h1" style="margin-top:10px">' + esc(state.error) + "</h1><p class=\"sub\"><a href=\"closer-dashboard.html" + (contactId ? ("?client_id=" + encodeURIComponent(contactId)) : "") + '">Back to Closer Dashboard</a>' + signIn + '</p></div>';
      return;
    }
    if (!state.loaded) {
      root.innerHTML = '<div class="gate"><span class="mono">Present</span><p class="sub">Loading this contact…</p></div>';
      return;
    }
    var dots = DECK.map(function (s, i) { return '<i class="' + (i <= state.idx ? "on" : "") + '"></i>'; }).join("");
    root.innerHTML =
      '<div class="topbar"><span class="mono">' + esc((state.survey && state.survey.name) || "Present") + "</span>" +
      (state.engine && !state.engine.available ? '<span class="mono" style="color:var(--gray)">Your numbers are not on this file yet</span>' : "") +
      '<div class="sp"></div><button type="button" class="btn-ghost" data-act="client-only">' +
      (state.clientOnly ? "Show cockpit" : "Client screen only") + "</button></div>" +
      '<div class="stage"><div class="client' + (state.clientOnly ? " solo" : "") + '">' + clientSlide() +
      '<div class="dots">' + dots + "</div></div>" +
      (state.clientOnly ? "" : '<div class="cockpit">' + cockpit() + "</div>") + "</div>";
    var cost = document.getElementById("fh-cost");
    if (cost) {
      cost.addEventListener("input", function (e) { state.costNum = e.target.value; });
      cost.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    businesses().forEach(function (b, i) {
      var inc = document.getElementById("fh-inc-" + i);
      if (inc) inc.addEventListener("keydown", function (e) { e.stopPropagation(); });
    });
    var ebook = document.getElementById("fh-ebook");
    if (ebook) {
      ebook.addEventListener("input", function (e) { state.ebookDollars = e.target.value; });
      ebook.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    var saleMotion = document.getElementById("fh-sale-motion");
    if (saleMotion) {
      saleMotion.addEventListener("change", function (e) { state.saleMotion = e.target.value; });
      saleMotion.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    var referral = document.getElementById("fh-repair-referral");
    if (referral) {
      referral.addEventListener("change", function (e) { state.repairReferral = !!e.target.checked; });
    }
  }

  function go(n) {
    state.obj = null; state.showRef = false;
    var j = Math.max(0, Math.min(DECK.length - 1, state.idx + n));
    while (state.edu && EDU_SKIP.indexOf(DECK[j].code) >= 0 && j > 0 && j < DECK.length - 1) {
      j = j + (n > 0 ? 1 : -1);
    }
    state.idx = Math.max(0, Math.min(DECK.length - 1, j));
    render();
  }
  function jumpTo(c) {
    for (var i = 0; i < DECK.length; i++) if (DECK[i].code === c) { state.idx = i; state.obj = null; state.showRef = false; render(); return; }
  }
  function toast(m) {
    state.toast = m;
    render();
    setTimeout(function () { state.toast = ""; render(); }, 2600);
  }
  function setTier(k) {
    state.tier = k; state.rung = 0; state.edu = false; state.forceRepair = false; render();
  }

  /* ONE CLICK, NO TYPING (F27, owner-set 2026-09-03).
     Chris: "it should already have that information. Just send it. We don't
     need to, like, enter in the information... it needs to be just removed
     completely."

     What this replaces: a "WORDING FOR THIS CLIENT" panel that made the closer
     type Company name, What the program includes, Program fee, Access length
     and Company email on a live call — for a client whose own record read "No
     businesses on file", buying a personal education program. The typed
     Company name then landed on the agreement as the SELLER, so the contract
     said the client's own company was selling the program to the client (F28).

     Nothing is typed now. The template is matched from the offer the closer
     already chose, and the blanks come from the offer catalog, with Fundhub as
     the seller every time. */
  function sendContractNow() {
    if (!window.FHContractSend || !contactId) { toast("No contact on this deck."); return; }
    markSending("contract");
    state.contractMsg = "Finding the right agreement…";
    render();
    window.FHContractSend.listWordings().then(function (r) {
      if (!r.ok) {
        state.contractMsg = r.error || "Could not load the agreements.";
        markSent("contract", false);
        return;
      }
      var wantKey = resolveContractTemplateKey();
      var picked = window.FHContractSend.pickTemplate(r.items || [], wantKey);
      if (!picked) {
        /* Never fall back to "whatever is first in the list" — that is how the
           wrong agreement reaches a customer. Say which one is missing. */
        state.contractMsg = wantKey
          ? ("No agreement is set up for this offer yet (" + wantKey + "). Add it on the Contracts page.")
          : "This offer has no agreement attached yet.";
        markSent("contract", false);
        return;
      }
      var name = picked.name || picked.template_key;
      state.contractMsg = "Sending " + name + "…";
      render();
      window.FHContractSend.sendToClient({
        clientId: contactId,
        templateId: picked.id
      }).then(function (sent) {
        if (!sent.ok) {
          state.contractMsg = sent.error || "Could not send.";
          markSent("contract", false);
          return;
        }
        state.contractLink = sent.link || "";
        state.contractMsg = "Sent " + name + " to the client.";
        markSent("contract", true);
        if (state.contractLink) window.FHContractSend.copyText(state.contractLink);
      });
    });
  }

  /* Save one company's month/year. Same staff action the Control Panel posts,
     so there is one write path, not two. */
  /* The whole deck payload in one place, because two things load it now: boot,
     and a saved incorporation date. The pre-approval figure on screen comes from
     state.engine, which the SERVER computes from business age - so a date saved
     without re-reading the deck leaves the old price sitting there. */
  function applyDeck(d) {
    d = d || {};
    state.survey = d.survey || {};
    state.businesses = Array.isArray(d.businesses) ? d.businesses : [];
    state.incomeEstimates = d.income_estimates || {};
    state.engine = d.engine || { available: false, reason: "engine data unavailable", fico: {}, reasons: [] };
    state.offers = d.offers || [];
    state.softPull = d.soft_pull || null;
    state.tier = (state.engine && state.engine.tier) || null;
  }

  /* Returns true when the numbers on screen are the server's current ones.
     False means the save landed but the price may still be the old one, and
     the caller says so rather than showing a stale figure as if it were fresh. */
  async function refreshDeck() {
    if (!window.FHData || !contactId) return false;
    var r = await window.FHData.read("closer-deck", { contact: contactId });
    if (!r || !r.ok) return false;
    applyDeck(r.data || r);
    return true;
  }

  async function stampIncorporated(i) {
    var b = businesses()[i];
    if (!b) return;
    var input = document.getElementById("fh-inc-" + i);
    var val = input ? String(input.value || "").trim() : "";
    if (!/^\d{4}-\d{2}$/.test(val)) {
      state.incMsg = "Enter the month and year for " + (b.name || "this business") + ".";
      render();
      return;
    }
    state.incBusy = b.name;
    state.incMsg = "Saving\u2026";
    render();
    var r = await window.FHData.write("/api/soft-pull-approve", {
      action: "stamp_incorporated",
      client_id: contactId,
      business_name: b.name,
      incorporated_date: val
    });
    state.incBusy = "";
    if (!r || !r.ok) {
      state.incMsg = (r && r.error && (r.error.message || r.error)) || (r && r.message) || "Could not save that date.";
      render();
      return;
    }
    var saved = r.business || (r.data && r.data.business) || {};
    state.businesses = businesses().map(function (row) {
      if (row.name !== b.name) return row;
      return {
        id: row.id,
        name: row.name,
        age_months: saved.age_months == null ? row.age_months : Number(saved.age_months),
        incorporated_date: saved.incorporated_date || val
      };
    });
    /* Re-read the deck. Business age is an input to the stack the engine
       prices, so the pre-approval figure above this panel is wrong the moment a
       date is saved. Keeping the optimistic row update above means the list
       stays right even if this read fails. */
    var fresh = await refreshDeck();

    var left = businessesNeedingDate().length;
    state.incMsg = "Saved " + (b.name || "that business") + "."
      + (left ? " " + left + " still need a date." : " Every company on the file has a date now.")
      + (fresh ? "" : " The pre-approval number above may still be the old one \u2014 reload to be sure.");
    render();
  }

  async function stageRepairLetters() {
    if (!window.FHData || !contactId) { toast("No contact on this deck."); return; }
    if (!isRepairDfyOffer()) { toast("Pick a repair offer first."); return; }
    var paidEl = document.getElementById("fh-repair-paid");
    if (paidEl) state.amountPaidDollars = paidEl.value;
    var price = offerDollars();
    if (price == null) { toast("No price on this offer."); return; }
    state.repairBusy = true;
    state.repairMsg = "Enrolling and staging…";
    state.stagedLetters = [];
    render();
    var enroll = await window.FHData.write("/api/repair/enroll", {
      client_id: contactId,
      program: repairProgramKey(),
      price_total: price,
      amount_paid: paidDollarsForEnroll()
    });
    if (!enroll.ok) {
      state.repairBusy = false;
      state.repairMsg = (enroll.error && (enroll.error.message || enroll.error)) || "Could not enroll.";
      render();
      return;
    }
    var gen = await window.FHData.write("/api/repair/generate", { client_id: contactId, round: "R1" });
    state.repairBusy = false;
    if (!gen.ok) {
      state.repairMsg = "Refused: " + ((gen.error && (gen.error.message || gen.error)) || "Could not stage letters.");
      render();
      return;
    }
    var payload = gen.data || {};
    state.stagedLetters = Array.isArray(payload.letters) ? payload.letters : [];
    if (state.stagedLetters.length) {
      state.repairMsg = payload.already_generated
        ? ("Already staged — " + state.stagedLetters.length + " letter(s) ready. Review, then Send now.")
        : ("Staged " + state.stagedLetters.length + " letter(s). Review, then Send now.");
    } else {
      state.repairMsg = payload.already_generated
        ? "Letters were already staged for this round, but none came back to show."
        : "No new letters stored.";
    }
    render();
  }

  async function sendRepairNow() {
    if (!window.FHData || !contactId) { toast("No contact on this deck."); return; }
    if (!state.stagedLetters.length) { toast("Stage letters first."); return; }
    var letters = [];
    for (var i = 0; i < state.stagedLetters.length; i++) {
      var L = state.stagedLetters[i];
      if (!L || !L.bureau || !L.body_text) {
        toast("A staged letter is missing its body.");
        return;
      }
      letters.push({
        bureau: L.bureau,
        html: L.body_text,
        letter_id: L.letterId || L.letter_id || null
      });
    }
    state.repairBusy = true;
    state.repairMsg = "Sending…";
    markSending("send-letters");
    var r = await window.FHData.write("/api/repair/send", {
      mail: true,
      client_id: contactId,
      letters: letters
    });
    state.repairBusy = false;
    if (!r.ok) {
      state.repairMsg = (r.error && (r.error.message || r.error)) || "Send failed.";
      markSent("send-letters", false);
      return;
    }
    state.repairMsg = "Sent. Letters are in the mail queue.";
    markSent("send-letters", true);
    toast("Repair letters sent.");
  }

  /* `act` is the button this came from, so the button can show that it is
     sending, then that it sent, and refuse a second press in between (F24).
     Actions with no button — nothing today — pass nothing and behave as before. */
  async function fire(action, extra, act) {
    if (!window.FHData || !contactId) { toast("No contact on this deck."); return; }
    if (act) markSending(act);
    var body = Object.assign({
      action: action,
      client_id: contactId,
      offer_key: action === "generate_letters" && state.edu ? "UWIQ_DELIVERABLES" : selectedOfferKey(),
      sale_motion: action === "send_pay_link" ? selectedSaleMotion() : null,
      edu: state.edu,
      force_repair: state.forceRepair,
      tier: state.tier,
      route: state.edu ? "EDUCATION" : (state.forceRepair ? "DESCENT" : (state.tier || "")),
      temperature: state.temp,
      beliefs_count: Object.keys(state.checks).filter(function (k) { return state.checks[k]; }).length,
      cost_of_inaction: state.costNum || null
    }, extra || {});
    var r = await window.FHData.write("/api/closer-deck", body);
    if (!r.ok) {
      if (act) markSent(act, false);
      toast((r.error && (r.error.message || r.error)) || "Could not complete that action");
      return;
    }
    /* F41. This action used to report success no matter what came back. On a
       clean file the pack is empty, nothing is stored and no email goes out —
       and the presenter was still told "Deliverables sent to client." The
       endpoint now answers with `delivered` and, when it is false, the reason,
       so the screen says what actually happened. */
    if (action === "generate_letters") {
      var ok = r.delivered === true;
      if (act) markSent(act, ok);
      if (ok) {
        var n = r.documentsStored || r.letterCount || 0;
        toast((state.edu ? "Deliverables sent. " : "Letters sent. ") + n + " document(s) saved to the client portal.");
      } else {
        toast("Nothing was sent — " + (r.reason || "the pack came out empty") + ".");
      }
      return;
    }
    if (act) markSent(act, true);
    if (action === "send_soft_pull") toast("Soft pull emailed — pay link + approval form.");
    else if (action === "send_ebook") toast("E-book email sent with PDF attached.");
    else if (action === "send_pay_link") toast("Agreement and pay link sent.");
    else toast("Disposition written to contact record.");
  }

  async function invoiceThisClient() {
    if (!window.FHData || !contactId) { toast("No contact on this deck."); return; }
    markSending("invoice");
    var list = await window.FHData.read("invoices", { client_id: contactId, limit: 5 });
    if (!list || !list.ok) {
      markSent("invoice", false);
      toast((list && (list.error || list.message)) || "Could not load invoices.");
      return;
    }
    var items = (list.data && list.data.items) || list.items || [];
    var open = null;
    for (var i = 0; i < items.length; i++) {
      var st = String(items[i].status || "").toLowerCase();
      if (items[i].id && st !== "void" && st !== "written_off") { open = items[i]; break; }
    }
    if (!open) { markSent("invoice", false); toast("No invoice on this file yet."); return; }
    var r = await window.FHData.write("/api/messages-outbound", {
      action: "email_invoice",
      invoice_id: open.id
    });
    if (!r.ok) {
      markSent("invoice", false);
      toast((r.error && (r.error.message || r.error)) || "Could not email invoice.");
      return;
    }
    markSent("invoice", true);
    toast("Invoice emailed.");
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var a = btn.getAttribute("data-act");
    /* A locked send control is a send in flight or inside its cooldown. The
       button is already disabled, but a stray click on a re-rendered button is
       what produced two pay links for one sale on 2026-09-03, so the guard is
       here as well as on the element (F24). */
    if (sendLocked(a)) return;
    if (a === "client-only") { state.clientOnly = !state.clientOnly; render(); return; }
    if (a === "back") { go(-1); return; }
    if (a === "next") { go(1); return; }
    if (a === "edu") { state.edu = true; state.rung = 0; render(); return; }
    if (a.indexOf("tier:") === 0) { setTier(a.slice(5)); return; }
    if (a.indexOf("rung:") === 0) { state.rung = Number(a.slice(5)); render(); return; }
    if (a.indexOf("temp:") === 0) { state.temp = Number(a.slice(5)); render(); return; }
    if (a.indexOf("check:") === 0) { var k = a.slice(6); state.checks[k] = !state.checks[k]; render(); return; }
    if (a.indexOf("phase:") === 0) {
      var p = a.slice(6);
      var target = DECK.filter(function (s) { return s.phase.indexOf(p) === 0; })[0];
      if (target) jumpTo(target.code);
      return;
    }
    if (a === "bridge") { state.tier = "FUNDING_PLUS_REPAIR"; state.edu = false; state.forceRepair = false; jumpTo("S-08"); return; }
    if (a === "desc:fund") { state.forceRepair = false; state.edu = false; jumpTo("S-19"); return; }
    if (a === "desc:dfy") { state.edu = false; state.forceRepair = true; state.rung = 0; jumpTo("S-19"); return; }
    if (a === "desc:trial") { state.edu = false; state.forceRepair = true; state.rung = 1; jumpTo("S-19"); return; }
    if (a === "desc:diy") { state.edu = false; state.forceRepair = true; state.rung = 2; jumpTo("S-19"); return; }
    if (a === "desc:eduTop") { state.forceRepair = false; state.edu = true; state.rung = 0; jumpTo("S-19"); return; }
    if (a === "desc:eduLow") { state.forceRepair = false; state.edu = true; state.rung = 1; jumpTo("S-19"); return; }
    if (a === "reframes") { state.showRef = true; render(); return; }
    if (a === "ref-back") { state.showRef = false; render(); return; }
    if (a === "obj-back") { state.obj = null; render(); return; }
    if (a.indexOf("obj:") === 0) { state.obj = Number(a.slice(4)); render(); return; }
    if (a.indexOf("obj-jump:") === 0) { jumpTo(a.slice(9)); return; }
    if (a === "more") { state.moreOpen = !state.moreOpen; render(); return; }
    if (a === "softpull") { fire("send_soft_pull", null, "softpull"); return; }
    if (a === "ebook") {
      var dollars = state.ebookDollars || (document.getElementById("fh-ebook") && document.getElementById("fh-ebook").value) || "";
      var cents = Math.round(parseFloat(String(dollars).replace(/[^0-9.]/g, "")) * 100);
      if (!Number.isFinite(cents) || cents < 100) { toast("Enter an e-book price first."); return; }
      fire("send_ebook", { amount_cents: cents }, "ebook"); return;
    }
    if (a === "pay") { fire("send_pay_link", null, "pay"); return; }
    if (a === "invoice") { invoiceThisClient(); return; }
    if (a === "contract") { sendContractNow(); return; }
    if (a === "contract-copy") {
      if (window.FHContractSend) {
        window.FHContractSend.copyText(state.contractLink).then(function (ok) {
          toast(ok ? "Sign link copied." : "Copy failed — select the link and copy it.");
        });
      }
      return;
    }
    if (a === "letters") { fire("generate_letters", null, "letters"); return; }
    if (a.indexOf("stamp-inc:") === 0) { stampIncorporated(Number(a.slice(10))); return; }
    if (a === "stage-letters") { stageRepairLetters(); return; }
    if (a === "send-letters") { sendRepairNow(); return; }
    if (a === "disp") {
      fire("log_disposition", { repair_referral: !!state.repairReferral });
      return;
    }
  });
  window.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  });

  async function boot() {
    if (!contactId) {
      /* A closer can reach this page with no client on it now that Present is
         always on the Closer Dashboard (owner-set 2026-08-27). It used to be
         unreachable, which is why it spoke in URL syntax. UI-STANDARDS §6: say
         what to do next, in the reader's words. The gate below already renders
         a "Back to Closer Dashboard" link under this line. */
      state.error = "Pick a client first. Open a call on the Closer Dashboard, then press Present.";
      state.loaded = true;
      render();
      return;
    }
    if (!window.FHData) {
      state.error = "data.js failed to load";
      state.loaded = true;
      render();
      return;
    }
    render();
    var r = await window.FHData.read("closer-deck", { contact: contactId });
    if (!r.ok) {
      if (r.source === "unauthorized") {
        /* data.js drops the HTTP status, so "unauthorized" covers BOTH signed
           out (401) and signed in but not allowed (403). Redirecting to the
           sign-in page threw already-signed-in advisors out of the app. Show
           the wall instead and let the reader choose to sign in. */
        state.error = "This account cannot open the client deck. Ask an owner "
          + "for access, or sign in with a closer account.";
        state.errorSignIn = "/login.html?next="
          + encodeURIComponent(location.pathname + location.search);
        state.loaded = true;
        render();
        return;
      }
      state.error = (r.error && (r.error.message || r.error)) || "Could not load this contact.";
      state.loaded = true;
      render();
      return;
    }
    applyDeck(r.data || r);
    state.loaded = true;
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
