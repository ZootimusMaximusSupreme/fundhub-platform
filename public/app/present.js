/* closer present — vanilla port of fundhub-closer-deck-v5. The closer lines follow
   docs/sops/weekend-2026-10-24/04-sales-call-script.md (owner-set 2026-10-29). The
   slide order follows the same script, part by part
   (ops/workflows/weekend-2026-10-24.md section 10.0). */
(function () {
  "use strict";

  /* Capital Academy, the course, is off until it is filmed (Chris, 2026-10-29).
     This one switch hides the EDUCATION PATH button, the education slides and
     rungs, the course prices and the mini course line. Set it to true and they
     all come back as they were. UI-STANDARDS section 5: nothing "coming soon"
     shows. */
  var COURSE_LIVE = false;

  /* The phase strip uses the call script's part names, in its order (Chris,
     2026-10-29: "the progression of the sales script needs to be the
     progression of the dashboard"). Part 8, Money, has no slide: its button
     opens the money steps in the cockpit and the client's screen stays put.
     Objections stay in the cockpit too, so they get no button. */
  var PHASES = [
    ["01", "1 Open"], ["02", "2 Your goal"], ["03", "3 The pull"], ["04", "4 Your file"],
    ["05", "5 Your path"], ["06", "6 The plan"], ["07", "7 The ask"], ["08", "8 Money"],
    ["09", "9 Paperwork"]
  ];
  var DECK = [
    { code: "S-01", phase: "01" }, { code: "S-02", phase: "01" },
    { code: "S-03", phase: "02" }, { code: "S-04", phase: "02" },
    { code: "S-05", phase: "03" }, { code: "S-06", phase: "03" },
    { code: "S-07", phase: "04" }, { code: "F-01", phase: "04" },
    /* L-01: the money levers (visual A), right after the reveal. It shows only
       when its visual draws; otherwise Next goes S-07 to S-08 as before. */
    { code: "L-01", phase: "04" }, { code: "F-02", phase: "04" },
    { code: "S-08", phase: "05" },
    /* 06 BLUEPRINT — the Capital Blueprint + FinanceOS offer stack (owner ask
       2026-10-06). It is Door 3, the plan for a file that is not ready, so it
       sits inside part 6 (10.0). A repair file walks B-01 to B-04 with Next and
       goes on to S-09 when they say no. A funding file steps over all six
       (go()), so a funding call still runs S-08 to S-09. B-05 and B-06 stay out
       of the walk: only their own buttons reach them (row 10). Everything for
       it lives between the 06 BLUEPRINT STACK markers below. */
    { code: "B-01", phase: "06" }, { code: "B-02", phase: "06" },
    { code: "B-03", phase: "06" }, { code: "B-04", phase: "06" },
    { code: "B-05", phase: "06" }, { code: "B-06", phase: "06" },
    { code: "S-09", phase: "06" }, { code: "S-10", phase: "06" },
    { code: "S-11", phase: "06" }, { code: "S-12", phase: "06" },
    { code: "S-13", phase: "06" }, { code: "S-14", phase: "06" },
    { code: "S-15", phase: "06" }, { code: "S-16", phase: "06" }, { code: "P-01", phase: "06" },
    /* C-01: more companies, more funding (visual B). Door 1 only, and only
       when its visual draws. */
    { code: "C-01", phase: "06" },
    { code: "S-17", phase: "07" }, { code: "S-18", phase: "07" },
    { code: "S-19", phase: "07" }, { code: "S-20", phase: "07" },
    { code: "S-21", phase: "07" }, { code: "S-22", phase: "07" },
    { code: "S-23", phase: "09" }, { code: "S-24", phase: "09" }
  ];
  var EDU_SKIP = ["S-11", "S-12", "S-13", "S-14", "S-15", "S-16"];
  /* Out of the Next walk until FinanceOS has a price and a checkout. */
  var OFF_WALK = ["B-05", "B-06"];
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
    ["G-01 / 24 HOURS", "24-Hour Action Guarantee", "Once you're signed on, a funding advisor begins working your file within 24 business hours. The agreement explains what happens if we miss it."],
    ["G-02 / 72 HOURS", "72-Hour Application Guarantee", "Once you're signed on, your first applications go out within 72 business hours. The agreement explains what happens if we miss it."]
  ];
  /* What opens today (2026-10-29): business cards, personal cards and personal
     loans, and revenue funding, which runs by hand. SBA and equipment loans are
     not live, so they are not on the menu. */
  var MENU = [
    ["F-01", "Business cards", "Business cards matched to your file, across issuers."],
    ["F-02", "Personal cards", "Personal cards matched to your file, across issuers."],
    ["F-03", "Personal loans", "A personal loan matched to your file."],
    ["F-04", "Revenue funding", "Lines of credit and term loans, off your bank statements or tax returns."]
  ];
  /* Revenue funding, run by hand (Chris, 2026-10-29): the client uploads, the
     team sends the file to the lender. */
  var REVENUE_STEPS = [
    "You upload your bank statements or tax returns in your portal.",
    "The Fundhub team sends your file to the lender."
  ];
  var TERMINAL = [
    "$ underwrite --diagnostic", "> application received", "> profile review initiated",
    "> soft inquiry · no score impact", "> scanning experian · transunion · equifax",
    "> matching against partner lender network", "> structuring options for review"
  ];
  var TALK = {
    "S-01": { title: "Rapport", lines: ["Hey [First Name]! It's [Your Name] over at Fundhub. How's your week been so far?", "Mirror their energy. Let them answer. Do not rush.", "I know we've got a limited amount of time, so are you ready to jump in? Are you in front of a computer with a card handy for the soft-pull assessment?"], watch: "The first 60 seconds decide whether they trust you or have their guard up." },
    "S-02": { title: "The Frame", lines: ["First, I'd like to dive into the specifics of your business, what you're building, where you're at with capital, and what's keeping you from scaling.", "Then we'll run your soft-pull assessment right here on the call. It's a soft pull, so your score does not move. Then I'll show you how much you qualify for based on where you're at right now, and what's holding the rest back.", "And if it's not the right fit, we'll figure out the best next step. Does that sound fair?", "At the end, I'll ask if you want to move forward. A yes is great. A no is fine. Just tell me straight either way. Deal?", "Quick heads up: this call is recorded, so nothing gets missed. Is anyone else part of money decisions for you, like a spouse or a business partner? It helps if they hear this too."], watch: "Get the 'sounds fair' before moving. It stops price-hijacking later." },
    "S-03": { title: "Discovery 1. Isolate the challenge.", lines: ["What's the biggest reason you're looking for funding right now? What's going on in the business?", "Probe: tell me more. When you say X, what do you mean exactly? How has that impacted the business specifically?", "Aside from that, any other challenge or roadblock in the way right now?"], watch: "Do not accept surface-level answers. Busy professional, not telemarketer. S-03 shows the yearly revenue range they picked. Ask the monthly amount out loud." },
    "S-04": { title: "Discovery 2. The goal and the cost.", lines: ["Begin with the end in mind. If capital wasn't an issue, what does the business look like 6 to 12 months from now? How much capital do you realistically need?", "Cost anchor: what is this costing you every month? Reflect it back: about $X a month, roughly $Y left on the table. Feel accurate?", "Pre-frame: if the pull comes back strong and I can show a clear path, are you ready to move on this now, or still in the research phase?"], watch: "The cost number is what the $3,000 gets anchored against. Do not skip it." },
    "S-05": { title: "Transition to the pull", lines: ["I feel like we've covered a lot of ground. Anything else I need to know?", "This is exactly what we work on. Right now, we're both guessing. Your file knows why. Let's go see what it says.", "If the file shows a clear path, are you ready to move on it today, or are you still looking around?", "It's a soft look, not a bank application. Your score does not move, and no lender sees it. It's $32. You've got a card handy?"], watch: "Do NOT jump from pain straight into pitching. Process the $32, then advance." },
    "S-06": { title: "While it runs", lines: ["Our UnderwriteIQ system is pulling your file from all three bureaus and reading it the way a bank does.", "It checks your file against the banks that fit it, so you only apply where your file makes sense."], watch: "Confident, matter-of-fact. Routine professional step. Never say a lender count, a client count, or a dollar total." },
    "S-07": { title: "The reveal + the sort", lines: ["FUND: Here's how much you qualify for based on where you're at right now: [Amount]. That's what your file supports today. The bank still decides.", "FUND: Pause. Let it land. Then: what jumps out at you?", "REPAIR: Here's what's holding your file back. Cleaned up, it shows the higher amount on screen. That difference is what's left on the table right now.", "EDU: If their ask is 'teach me to do this myself', route Education below. The sort still gets named first."], watch: "Name the sort before moving: 'based on what the system found, here's where you are, and here's the path that fits.' They must accept the sort before they hear any offer. Route buttons below. Never say approved or pre-approved, and never name a bank." + (COURSE_LIVE ? "" : " Education is off until Capital Academy is filmed.") },
    /* L-01 and C-01 are visual slides (section 10.4, A and B). The words are
       the script's (sections 4 and 6) and the plan's. */
    "L-01": { title: "How much more. Tap each lever.", lines: ["The difference between today and the fully optimized file is what's left on the table right now.", "Let me show you what each fix does for your file, one at a time."], watch: "Tap one lever at a time. Every amount is the engine's own, for this file. Read it off the screen. Never round up, never say approved, and never promise a score or a removal." },
    "F-01": { title: "What holds this file back", lines: ["These are the items on this file and the next step for each one.", "Walk the cards, negative items and mismatched information that the pull actually found."], watch: "Only discuss what appears in this client's pull. A step is not a promised result." },
    "F-02": { title: "Lender reach", lines: ["These are lenders the file matches today.", "The dim doors are additional matches after optimization; they are not open today."], watch: "The after bucket is additional. No lender names or approval promise." },
    "P-01": { title: "Funding partners for life", lines: ["We stay with you for this funding sequence and the next one.", "Each future sequence is based on what your file supports then."], watch: "Only the first step uses today's engine amount. Do not quote future amounts." },
    "C-01": { title: "More companies, more funding.", lines: ["Each business is judged on its own, after your personal file is ready.", "This is what one more company adds as it gets older. It's a picture of what's possible. It never changes what you qualify for today."], watch: "Read the amounts off the screen. 'If you add a company' is never part of today's total. Only show wins Chris has given you in writing." },
    "S-08": { title: "Permission, then the map", lines: ["FUND: Where do you want to go from here? I can walk you through exactly how we get you in front of the banks that match your file, in the right order. But you tell me.", "FUND: Everything is completely done-for-you. Three steps. Cool?", "REPAIR: I'd recommend we clean your credit up first, so when we run the full funding process you're in the strongest position. Want me to walk you through it?", "EDU: Two ways to own this: your complete file deliverables with the ranked bank list, or the Funding Mastery program, A to Z. Which sounds more like you?"], watch: "Sort-acceptance gate. Reverse Selling: ask permission. If they push back on the sort itself, handle it HERE, never at the price." },
    "S-09": { title: "Pitch. The problem.", lines: ["FUND: You know how you tried applying on your own and got denied or didn't know which banks to go to? You applied blind, to banks that never matched your file.", "FUND: Most people, and most funding companies, are guessing. Every application is a hard pull, and every denial costs you.", "REPAIR: Walk the flags one at a time. Read each item. Don't editorialize, the screen is the proof.", "EDU: Course one is everything the system built from your file today. Walk the six items on screen, one by one."], watch: "Slow down. The contrast here is what sells the system." },
    "S-10": { title: "Step 1. AI Lender Matching.", lines: ["FUND: UnderwriteIQ, the same system that just read your file, matches it to the banks that fit it.", "FUND: Every bank is picked from your file, not from one list used for every client. You only apply where your file makes sense. Make sense?", "REPAIR: The law does the heavy lifting. FCRA requires accuracy, forces an investigation of every dispute in 30 to 45 days, puts duties on the creditors themselves, and pays damages when they violate. Your letters are built on FCRA and Metro 2.", "EDU: Course two is the full Funding Mastery. A to Z. The complete credit and funding system, start to finish, on your own file."], watch: "'Make sense?' is a tie-down. Wait for the yes." },
    "S-11": { title: "Pitch. The second problem.", lines: ["FUND: Most companies submit everything at once. The banks see the inquiries stack, and they start denying you.", "FUND: It's called inquiry stacking, and it kills your approval odds.", "REPAIR: We dispute Metro 2, straight at the creditor. Their response becomes the proof, and it goes back to all three bureaus. Not fixed? We escalate through the administrative process, CFPB, state AG. Done for you, or you run the same pack yourself."], watch: "REPAIR compliance: describe the process only. Never promise removal, scores, or results." },
    "S-12": { title: "Step 2. Rounds + Inquiry Sweeps.", lines: ["FUND: We apply in rounds. One funding sequence is about six rounds. Your personal file first, then each business on its own.", "FUND: Between rounds, we dispute the new hard inquiries, so the next round starts from a cleaner file.", "REPAIR: Round one goes out today. The bureaus have 30 to 45 days to answer each round. Up to six rounds: the dispute, then method of verification, then a final notice, then the CFPB, then your state attorney general, then the final notice again."], watch: "FPR: the dirty bureaus get the full dispute process in parallel. Never delays a round. Never promise a removal, a score, or an approval." },
    "S-13": { title: "The proof point", lines: ["FUND: That's the difference: your file, the right banks, and the right order.", "FUND: Does that make sense? What questions do you have?", "REPAIR: And you watch every move happen in real time in your dashboard."], watch: "Inviting questions surfaces resistance early. Only use wins Chris has given you in writing." },
    "S-14": { title: "Step 3. Done-for-you team.", lines: ["FUND: The Fundhub team runs every application and every follow-up with the banks. You don't fill out a single application.", "FUND: You run the business. We handle the capital side. Make sense?", "REPAIR: Once the file is clean, this is the position we project you're funding from. This is why we clean up first."], watch: "REPAIR: say 'projected position', never 'guaranteed'." },
    "S-15": { title: "The timeline", lines: ["FUND: Once you sign, your funding advisor starts on your file within 24 business hours. Your first applications go out within 72 business hours.", "REPAIR: Everything on this screen already exists. The letters are staged, the plan is mapped, the dashboard is waiting. All that's left is the button."], watch: "Slow down and let it land. FUND: never promise when the money lands; the bank decides. On repair: the dinner is on the table — everything shown is already built from their pull. Sell the button-press, not the service." },
    "S-16": { title: "The proof and the path", lines: ["FUND: These are real approval crops from client files. Their results are not a promise of yours.", "FUND: Your file and the lender's decision determine your outcome.", "REPAIR: We use documented disputes with the bureaus and creditors. Their responses determine what changes.", "REPAIR: Track each round and each response in your dashboard."], watch: "Keep a real client's result separate from this client's projection. Never promise a removal or approval." },
    "S-17": { title: "Temperature check", lines: ["So just curious, in terms of the process specifically, how do you feel?", "What's important to me is alignment. When you come in, our team is ALL IN, in the trenches with you. So it matters that you feel GOOD about the process."], watch: "If they hesitate here, dig in now. Don't carry hesitation into the price." },
    "S-18": { title: "Scale of 1 to 10", lines: ["1 being this sounds terrible, I want off the phone. 10 being this is exactly what I need to finally get the capital to scale. Where do you fall?"], watch: "8 or above, proceed. Below 8: what's keeping you from a 9 or 10? Handle it first." },
    "S-19": { title: "The investment", lines: ["FUND: To get you in front of the right banks in the right order, it's a $3,000 deposit today.", "FUND: That $3,000 is not an additional fee. It goes directly toward your 10 percent success fee on the back end.", "REPAIR: Most expensive first. Lead with the Capital Blueprint button: the whole 12-month plan from their file, price off the screen. If that's a no: onboard now, all six rounds done for you, $1,000. Still a no: round one for $200, and the $200 counts toward the $1,000.", "EDU: Lead with the $5,000 full program. Only if that's a no: the $1,000 deliverables package plus the how-to course."], watch: "Rung buttons below on repair. Do NOT lead with the cheaper one." },
    "S-20": { title: "The math", lines: ["FUND: Walk it line by line off the screen. Deposit credits against the fee. Back end only charges once capital is in your hands.", "FUND: So we only make our money when you get funded. Our success is literally tied to yours.", "REPAIR: Put their own number in their face. You told me this costs you [$X] a month. That's [$X times 12] a year of staying exactly where you are. The fix starts on this call.", "EDU: Two courses, one skill set. Anchor the $5,000 against what they told you being stuck costs them every month."], watch: "Anchor against their own monthly cost number from discovery." },
    "S-21": { title: "The guarantees", lines: ["FUND: Read G-01 and G-02 off the screen, word for word. Those are the two in the agreement.", "REPAIR: Round one goes out today. You watch every dispute and response in your dashboard. Rounds escalate until the file is clean.", "EDU: Access gets set up on this call, and the deliverables generate from today's pull. They leave with it in hand."], watch: "Read only what the agreement says. Do not improvise promises beyond it." },
    "S-22": { title: "The ask", lines: ["FUND: Are you ready to get this started so we can get you funded?", "REPAIR: Want me to get that set up for you?", "EDU: Want me to get you set up right now?", "Then stop talking. First person to speak loses."], watch: "Calm, direct, assumptive. Guide to the natural next step." },
    "S-23": { title: "The close. Logistics.", lines: ["Awesome. Let's get this going. I'm sending the agreement right now. Best email for that?", "Review it while I get your billing info. What's your billing address?", "Collect the card. Fire the pay link. Keep them on the line until it posts."], watch: "Do not celebrate. Do not over-explain. No time to second-guess." },
    "S-24": { title: "Wrap", lines: ["Within 24 business hours your advisor reaches out and starts on your file. Within 72 business hours your first applications are submitted.", "Any questions before we wrap? ... Congratulations, [First Name]. You made a great decision. We're going to get to work on this. Talk soon."], watch: "Confirm the payment posted before ending the call. Then log the disposition." }
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
          /* The how-to course is part of the course that is off (COURSE_LIVE). */
          "Your deliverables generate from the pull we just ran and land in your email today" + (COURSE_LIVE ? ", with the how-to course." : "."),
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
    { t: "$3K is a lot", jump: "S-20", jumpLabel: "Show the math", lines: ["Isolate: finances aside, anything else keeping you from being 100 percent certain?", "Should vs how: you're not in a SHOULD I place, you're in a HOW can I place. Right?", "Context: you just saw how much your file qualifies for: [Amount]. The $3,000 counts toward the 10 percent, and the 10 percent is only on money you actually get. Too much compared to what? You told me waiting costs you [cost] a month."] },
    { t: "What if it fails", jump: "S-21", jumpLabel: "Show guarantees", lines: ["We ran the soft pull together. You saw your file with your own eyes. We're not guessing.", "Our fee is 10 percent of the money you actually get. The bank decides, not us. We pick the banks and the order.", "Here's what the agreement guarantees: we start on your file within 24 business hours, and your first applications go out within 72. So what specifically are you worried won't work?"] },
    { t: "Spouse", jump: "S-21", jumpLabel: "Show guarantees", lines: ["Aside from letting your spouse know, anything else keeping you from 100 percent?", "Respect vs permission: doing it regardless and letting them know? Or need their sign-off?", "If respect: 'this company wants $3K, thoughts?' versus 'I found the company that pulled my file and showed me exactly what to do next. I've decided, and I wanted you to know first.' Which one gets them on board? If permission: book the 3-way, inside one day."] },
    { t: "Burned before", jump: "S-10", jumpLabel: "Show the system", lines: ["I'm sorry that happened. What exactly went wrong with the last company? Listen.", "That's way too common. It's fair to go slow. That's why we started with your file, not a pitch.", "You see the fee in dollars before you pay, and everything is in the agreement, in writing. And the 10 percent is only on money you actually get."] },
    { t: "DIY", jump: "S-12", jumpLabel: "Show the rounds", lines: ["You absolutely can. How long have you been trying? And how much capital have you secured in that time?", "Almost every application is a hard pull, and each one costs fundability. Our system matches your file to the banks that fit it, in the right order.", "If you want to do it yourself the right way, that's the Capital Blueprint: the plan from your own file, step by step."] }
  ];
  var REFRAMES = [
    ["Truth Hammer", "You just told me [X], now you're saying [Y]. What's really going on?"],
    ["Simple Decision", "Do you want to keep [pain] or do you want [outcome]?"],
    ["Circumstance vs Vision", "Decisions from current circumstances, or from your vision?"],
    ["Cost Reframe", "Too much compared to what? Compared to [Amount] and finally [goal]?"],
    ["Risk Reframe", "Riskier: $3K into a plan built from your own file, or the same spot in 6 months?"]
  ];

  /* Part 8 of the script, Money (04-sales-call-script.md section 8). It has no
     slide. The strip's 8 opens these steps in the cockpit and the client's
     screen stays where it is. The pay link itself goes out from paperwork
     (S-23), the one send path on this deck. */
  var MONEY = {
    title: "Money. Same offer, different pay terms.",
    lines: [
      "Money aside, is this the right plan for your file?",
      "So this is not about whether. It's about how to make it work. Right?",
      "Is money the only thing? Nothing else in the way?",
      "Can we talk openly about money? Then I'll find the right way in.",
      "What do you have that you can use today?"
    ],
    watch: "Lock the plan before you talk money. Ask if money is the only thing twice, two different ways. Same offer, different pay terms first. Move down one door only last, at its real price."
  };

  var q = new URLSearchParams(location.search);
  var contactId = q.get("contact") || q.get("client_id") || q.get("id") || q.get("client") || "";
  var paymentStoreKey = "fh_call_payment_link:" + contactId;
  function savedPaymentLink(offerKey) {
    try {
      var saved = JSON.parse(localStorage.getItem(paymentStoreKey) || "null");
      return saved && saved.offerKey === offerKey && Date.now() - saved.at < 86400000 ? saved.id : null;
    } catch (e) { return null; }
  }
  function savePaymentLink(id, offerKey) {
    if (!id) return;
    try { localStorage.setItem(paymentStoreKey, JSON.stringify({ id: id, offerKey: offerKey, at: Date.now() })); } catch (e) {}
  }
  var state = {
    idx: 0, tier: null, edu: false, forceRepair: false, rung: 0, temp: 0,
    checks: {}, costNum: "", obj: null, showRef: false, showMoney: false, showRevenue: false, toast: "", clientOnly: false,
    survey: {}, engine: { available: false, reason: "engine data unavailable", fico: {}, reasons: [] },
    offers: [], softPull: null, saleMotion: "", paymentLinkId: null, loaded: false, error: null,
    contractLink: "", contractMsg: "", blueprintAmountDollars: null, blueprintProvider: "commas",
    /* One entry per send control: whether it is in flight, when it last went
       out, and how many times. F24 — see sendBtn below. */
    sends: {}, moreOpen: false, repairReferral: false,
    stagedLetters: [], repairBusy: false, repairMsg: "", amountPaidDollars: "",
    financePlan: "standard", financeAmount: "", financeMonths: "12", financeApr: "",
    businesses: [], incBusy: "", incMsg: "",
    /* 06 Blueprint: the rep's own on/off picks (only where they differ from
       what this file says), and the slide they opened the stack from. */
    stackPick: {}, stackFrom: null,
    sharedContext: null, sharedContextMessage: "Loading saved AI coach and Fundhub team context…"
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
    if (key === "UWIQ_DELIVERABLES" && state.blueprintAmountDollars != null) {
      var cents = blueprintAmountCents();
      if (cents !== null) return money(cents / 100);
    }
    return (o && o.priceDisplay) ? o.priceDisplay : "—";
  }
  function blueprintAmountCents() {
    var o = offer("UWIQ_DELIVERABLES");
    if (!o) return null;
    var raw = state.blueprintAmountDollars;
    var dollars = raw == null ? Number(o.priceCents) / 100 : Number(raw);
    if (!Number.isSafeInteger(dollars) || (raw != null && String(raw).trim() === "")) return null;
    var cents = dollars * 100;
    return Number.isSafeInteger(cents) && cents >= o.priceMinCents && cents <= o.priceMaxCents ? cents : null;
  }
  /* Financing is for the Capital Blueprint only, through Whop (script section 8,
     owner-set 2026-10-29). The catalog still flags other offers, so the note is
     limited here rather than read off the flag alone. */
  function financingNote(key) {
    var o = offer(key);
    return o && o.financing && key === "UWIQ_DELIVERABLES" ? '<div class="fin">Financing available</div>' : "";
  }
  function sharedContextPanel() {
    var handoff = state.setterHandoff || (state.sharedContext && state.sharedContext.setter_handoff);
    var handoffHtml = handoff && handoff.complete_at
      ? '<section data-fh-setter-handoff><h3>Setter handoff</h3><p class="caption">'
        + esc(handoff.handoff_text || [handoff.problem, handoff.goal].filter(Boolean).join(" · "))
        + '</p></section>' : '';
    var block = state.sharedContextMessage || (state.sharedContext && state.sharedContext.as_prompt_block)
      || "No saved context is on this client file yet.";
    return handoffHtml + '<details data-fh-shared-context><summary>AI coach and Fundhub team — shared client file</summary>'
      + '<div class="fh-context-lines" data-fh-context-lines>'
      + String(block).split("\n").map(function (line) { return '<p class="caption">' + esc(line) + '</p>'; }).join("")
      + '</div></details>';
  }
  async function loadSharedContext() {
    try {
      var r = await window.FHData.read("agent-context", { client_id: contactId });
      var context = r && r.ok && r.data && r.data.context;
      state.sharedContext = context || null;
      state.sharedContextMessage = context ? "" : "The shared client file could not be loaded. Reload to try again.";
    } catch (_err) {
      state.sharedContext = null;
      state.sharedContextMessage = "The shared client file could not be loaded. Reload to try again.";
    }
    render();
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
  /* The part of the script this slide belongs to: its key ("06") and the name
     the strip and the cockpit header show ("6 The plan"). */
  function phaseKey() { return DECK[state.idx].phase; }
  function phaseName(key) {
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i][0] === key) return PHASES[i][1];
    return key;
  }
  function phase() { return phaseName(phaseKey()); }
  /* The first rung for a file that is not ready is the Capital Blueprint, the
     most expensive door that fits (Chris, 2026-10-29; row 2). The rung numbers
     themselves do not move: the server reads the same ones (selectedOfferKey in
     src/sales/closer-deck.mjs). 0 is credit optimization, 1 is the round-one
     trial, 2 is the Blueprint. A catalog without the Blueprint keeps rung 0. */
  function leadRung() {
    return !isFunding() && !state.edu && offer("UWIQ_DELIVERABLES") ? 2 : 0;
  }
  /* The door this call is on (script section 5), for the visuals' ctx.door.
     Revenue funding (Door 2) runs by hand and has no route on this deck, so
     the deck never names it; the visuals show it from the survey. */
  function deckDoor() {
    if (isFunding() && !state.edu) return state.tier === "FUNDING_PLUS_REPAIR" ? "fund_plus_optimize" : "fund";
    return selectedOfferKey() === "UWIQ_DELIVERABLES" ? "blueprint" : "optimize";
  }
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
      '</span><div class="rule"></div>' + (state.engine?.sample === true ? '<span class="badge fh-astra-caption">Sample file</span>' : "") +
      '<span class="brand">fundhub<span>.</span></span></div><div class="hair"></div>' +
      '<div class="slide-body fh-astra-workspace">' + inner + "</div></div>";
  }
  function kicker(t) { return '<div class="kicker fh-astra-caption"><span class="mono" style="color:var(--gray)">' + esc(t) + "</span></div>"; }
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
    return '<div class="fh-astra-summary" style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">' + items.map(function (it) {
      return '<div class="stat fh-astra-stat"><div class="v sv">' + it[0] + '</div><span class="mono sd" style="color:var(--gray)">' + esc(it[1]) + "</span></div>";
    }).join("") + "</div>";
  }
  function moneyYr(row) {
    if (!row || row.annual == null) return null;
    return "$" + Number(row.annual).toLocaleString("en-US") + "/yr";
  }
  function scores(fico) {
    var rows = [["Experian", fico && fico.ex], ["TransUnion", fico && fico.tu], ["Equifax", fico && fico.eq]];
    return '<div class="fh-astra-summary" style="display:flex;gap:9px;margin-top:12px;flex-wrap:wrap">' + rows.map(function (r) {
      return '<div class="score fh-astra-stat"><span class="mono fh-astra-caption">' + r[0] + '</span><div class="v sv">' + dash(r[1]) + "</div></div>";
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
    return '<div style="display:flex;align-items:stretch;gap:12px;margin-top:14px;max-width:620px"><div style="flex:1;border:1px solid var(--line);border-radius:10px;padding:13px 15px"><span class="mono" style="color:var(--gray2)">Today</span><div style="font-family:var(--mono);font-size:clamp(18px,2.4vw,26px);color:var(--gray);margin-top:4px">' + money(now) + '</div><span class="mono" style="color:var(--gray2)">file supports</span></div><div style="align-self:center;font-family:var(--mono);font-size:18px">→</div><div style="flex:1.2;border:1px solid var(--line);border-radius:10px;padding:13px 15px;background:var(--soft);position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--spectrum)"></div><span class="mono" style="color:var(--gray)">After cleanup, projected</span><div style="font-family:var(--mono);font-size:clamp(22px,3vw,32px);margin-top:4px">' + money(after) + '</div><span class="mono" style="color:var(--gray)">+' + unlocked + " unlocked</span></div></div>";
  }
  function pathRows(items) {
    return '<div style="margin-top:12px">' + items.map(function (it) {
      return '<div style="display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--line)"><span class="mono" style="color:var(--gray2);width:96px;padding-top:3px">' + it[0] + '</span><div><div style="font-size:clamp(12px,1.25vw,14px);font-weight:600">' + it[1] + '</div><div style="font-size:clamp(10.5px,1.05vw,12px);color:var(--gray);margin-top:2px;line-height:1.45">' + it[2] + "</div></div></div>";
    }).join("") + "</div>";
  }
  /* What the Capital Blueprint gives the client, read from the catalog
     (src/config/offers.mjs), which stays as it is. Row 14: "Funding Snapshot"
     is banned in sales copy, so it shows as "How Much You Qualify For", and the
     mini course line is part of the course that is off (COURSE_LIVE). Each
     item keeps its own line under it. */
  var DELIVERABLE_SAYS = { "Funding Snapshot": "How Much You Qualify For" };
  var DELIVERABLE_SUBS = [
    "Your profile the way lenders actually see it",
    "Pre-filled, bureaus and creditors, escalating rounds",
    "Which accounts, what order, by how much",
    "What you qualify for now, and what's in the way",
    "Ranked in the order you should apply",
    "How to send everything, what to do, what not to do"
  ];
  function blueprintDeliverables() {
    var out = [];
    contents().forEach(function (name, i) {
      if (!COURSE_LIVE && /course/i.test(String(name))) return;
      out.push({ name: DELIVERABLE_SAYS[name] || name, sub: DELIVERABLE_SUBS[i] || "" });
    });
    return out;
  }
  function deliverableRows() {
    return blueprintDeliverables().map(function (it, i) {
      return row(esc(it.name), String(i + 1).padStart(2, "0"), it.sub);
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
  /* Row 7: "number" is banned in sales copy (outcome-first-copy). */
  var NOT_IN_YET = "Your results are not in yet";
  function unavail() {
    return '<div class="unavail fh-astra-state" role="status"><span class="mono">' + NOT_IN_YET + '</span><p class="sub" style="margin-top:6px">Nothing here is guessed.</p></div>';
  }

  /* ───────── THE VISUAL SLOTS (section 10.8) ─────────
     Each new visual lives in its own file, loaded by present.html before this
     one, and adds a function to window.FHDeckVisuals: yourPath, moneyLevers and
     companies (present-visuals.js), blueprintDemo (present-blueprint-demo.js)
     and journey (present-journey.js). Each takes ctx and returns the HTML for
     the slide body, and handles its own taps. This file calls each one where
     10.0 places it. A visual whose file is missing, whose engine.visual is
     missing, that throws, or that draws nothing leaves today's slide in place,
     so a missing file never breaks the deck. */
  var visualCache = null;
  /* engine.visual (src/sales/deck-visual-data.mjs), when the engine could read
     the file. Source "none" means it could not, and the slides show today's
     content. On a real pull this is the only place the once-fixed amount and
     the negative items live: engine.afterFix, negItems and reasons stay empty
     there. A null amount prints no amount. */
  function deckVisual() {
    var v = state.engine && state.engine.visual;
    return v && typeof v === "object" && v.source !== "none" ? v : null;
  }
  /* One engine.visual amount, or the old field when engine.visual is missing or
     does not carry it. An explicit null stays null: the engine withheld it. */
  function visualAmount(key, fallback) {
    var v = deckVisual();
    return v && Object.prototype.hasOwnProperty.call(v, key) ? v[key] : fallback;
  }
  function visualCtx() {
    var e = state.engine || {};
    return {
      engine: e,
      visual: deckVisual(),
      survey: state.survey || {},
      handoff: state.setterHandoff || (state.sharedContext && state.sharedContext.setter_handoff) || null,
      businesses: businesses(),
      tier: state.tier,
      door: deckDoor(),
      sample: e.sample === true,
      clientId: contactId,
      price: price,
      offerAmount: offerDollars,
      feePercent: (offer("FUNDING_DFY") && offer("FUNDING_DFY").successFeePercent) || null,
      costOfWaiting: Number(String(state.costNum || "").replace(/[^0-9.]/g, "")) || null,
      offerKey: selectedOfferKey(),
      slideCode: code(),
      money: money,
      esc: esc
    };
  }
  /* The visual's HTML, or null. One call per visual per paint. */
  function visualHtml(name) {
    if (visualCache && Object.prototype.hasOwnProperty.call(visualCache, name)) return visualCache[name];
    var out = null;
    var api = window.FHDeckVisuals;
    var fn = api && typeof api[name] === "function" ? api[name] : null;
    var emptyOkay = /^(callMap|alignment|goalLine|pullSplit|blindMatched|revenueSplit|sequence|clock|partnerStaircase|blueprintRoute|doorMatrix|moneyStrip|guarantees|nextSteps|iceberg|lenderWall|fileFindings|proofWall)$/.test(name);
    if (fn && (deckVisual() || emptyOkay)) {
      try {
        var html = fn(visualCtx());
        if (typeof html === "string" && html.trim()) out = html;
      } catch (err) {
        out = null;
      }
    }
    if (visualCache) visualCache[name] = out;
    return out;
  }
  /* ───────── THE VISUAL SLOTS — end ───────── */
  /* The engine's negative items (engine.visual.items), in plain words: what it
     is, who reports it, and which bureaus carry it. */
  var ITEM_KIND = {
    charge_off: "Charge-off", collection: "Collection", late: "Late payment",
    medical: "Medical collection", public_record: "Public record", other: "Negative mark"
  };
  var BUREAU_NAME = { EX: "Experian", TU: "TransUnion", EQ: "Equifax" };
  function itemsList(items) {
    return '<div class="items-list">' + items.map(function (it) {
      var bureaus = (Array.isArray(it.bureaus) ? it.bureaus : []).map(function (b) { return BUREAU_NAME[b] || b; }).join(", ");
      return '<div class="item-row"><i></i><div><span class="mono">' + esc(ITEM_KIND[it.kind] || ITEM_KIND.other) + '</span>' +
        '<div class="item-t">' + esc(it.creditor || "Unnamed creditor") + "</div>" +
        (bureaus ? '<div class="item-b">On ' + esc(bureaus) + "</div>" : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function itemCount(n) { return n === 1 ? "1 item is limiting your approvals." : n + " items are limiting your approvals."; }
  function reasonsList(d, withPlan) {
    return (d.reasons || []).map(function (pair, i) {
      var plan = withPlan && d.plan && d.plan[i] ? '<span class="mono" style="font-size:8.5px;border:1px solid var(--line);background:var(--soft);border-radius:6px;padding:4px 8px;white-space:nowrap">' + esc(d.plan[i]) + "</span>" : "";
      return '<div style="display:flex;gap:11px;padding:6px 0;border-bottom:1px solid var(--line);align-items:flex-start"><i style="width:3px;align-self:stretch;background:var(--spectrum);opacity:.85;flex:0 0 3px"></i><div style="min-width:0;flex:1"><span class="mono" style="color:var(--gray)">' + esc(pair[0]) + '</span><div style="font-size:clamp(11px,1.1vw,12.5px);margin-top:2px;line-height:1.35">' + esc(pair[1]) + "</div></div>" + plan + "</div>";
    }).join("");
  }

  function clientSlide() {
    var c = code();
    if (isStackCode(c)) return stackSlide(c);
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
      return slide("S-07", "Your results", kicker("Assessment") + h1(NOT_IN_YET + ".") + sub("Nothing here is guessed. No amounts or scores are shown."));
    }

    if (c === "S-01") {
      return slide("S-01", "Session", kicker("Funding strategy session") + h1("You see what your file says first, and you decide what happens next.") + (visualHtml("callMap") || unavail()));
    }
    if (c === "S-02") {
      return slide("S-02", "How this call works", kicker("The call") + h1("We read your file before discussing a price, and you make the call.") + (visualHtml("callMap") || unavail()));
    }
    if (c === "S-03") {
      var inc = state.incomeEstimates || {};
      var heard = (state.setterHandoff || (state.sharedContext && state.sharedContext.setter_handoff) || {}).problem;
      return slide("S-03", "Your answers", kicker("Discovery") + h1(heard ? 'You said: “' + esc(heard) + '”' : "Your goal and file are the starting point.") + '<div style="margin-top:8px">' +
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
        /* Row 8: the survey asks for a yearly revenue range. */
        row("Yearly revenue", esc(dash(answer(sv.revenue)))) +
        row("Annual income (they said)", esc(dash(answer(sv.income)))) +
        row("Income Insight (Experian)", esc(dash(moneyYr(inc.experian)))) +
        row("IncomeView (Equifax)", esc(dash(moneyYr(inc.equifax)))) +
        row("Capital on hand", esc(dash(answer(sv.capital)))) +
        row("What changes with the money", esc(dash(answer(sv.motivation)))) + "</div>");
    }
    if (c === "S-04") {
      var goal = answer(sv.target);
      var goalUse = answer(sv.use);
      return slide("S-04", "The goal", kicker("Your goal") + h1(goal ? "You need " + esc(goal) + (goalUse ? " for " + esc(goalUse) : "") + "." : "Tell us what you want this capital to do.") + (visualHtml("goalLine") || unavail()));
      /* No target on file: ask for it rather than putting a dash in 64px type
         on the customer's screen. The sentence below drops its lead-in the
         same way, so the copy never reads "—. What does the business…". */
      return slide("S-04", "The goal", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Begin with the end in mind") + h1(goal ? esc(goal) : "How much do you need?", "clamp(32px,5.2vw,64px)") + sub((goalUse ? esc(goalUse) + ". " : "") + "What does the business look like 6 to 12 months from now with this deployed?") + '<div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
    }
    if (c === "S-05") {
      return slide("S-05", "The assessment", kicker("The pull") + h1("For " + esc(price("SOFT_PULL")) + ", you see what a lender sees, and your score does not move.") + (visualHtml("pullSplit") || unavail()));
    }
    if (c === "S-06") {
      return slide("S-06", "Beyond the score", kicker("What lenders read") + h1("Banks check far more than your score.") + (visualHtml("iceberg") || unavail()));
      return slide("S-06", "UnderwriteIQ", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center"><div style="display:flex;justify-content:space-between;align-items:center;max-width:600px">' + kicker("The engine") + '<span class="mono" style="color:var(--gray)">UnderwriteIQ · Operational</span></div><div style="border:1px solid var(--line);background:var(--soft);padding:12px 16px;max-width:600px;border-radius:10px">' +
        TERMINAL.map(function (l, i) { return '<div style="font-family:var(--mono);font-size:clamp(10px,1.05vw,12px);color:' + (i === 0 ? "var(--ink)" : "var(--gray)") + ';line-height:1.85">' + esc(l) + "</div>"; }).join("") +
        '<div style="font-family:var(--mono);font-size:clamp(10px,1.05vw,12px);color:var(--gray2);line-height:1.85">&gt; monitoring for updates _</div></div>' +
        /* Row 13: the two facts the offers document gives (page 1), in place of
           the dollar total and the lender count the script took out. */
        stats([["About 10 years", "doing this work"], ["Hundreds", "of client files built UnderwriteIQ"]]) + "</div>");
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
        var shownTotal = visualAmount("todayTotal", d.total);
        return slide("S-07", "Your results", kicker("What the file supports today") + h1(shownTotal == null ? "Your file is under review before an amount is shown." : "Your file supports " + money(shownTotal) + " today.", "clamp(32px,5.2vw,64px)") + sub("Across multiple credit lines. Lenders make the final call.") + fine(basisLine(d)) + scores(d.fico) + sampleLine(d));
      }
      /* engine.visual first (a real pull has no afterFix or negItems), the old
         fields as the fallback. No amount, no projection line. */
      var vis = deckVisual();
      var found = vis && Array.isArray(vis.items) ? vis.items.length : d.negItems;
      var fixed = visualAmount("optimizedTotal", d.afterFix);
      var repairToday = visualAmount("todayTotal", d.total);
      return slide("S-07", "Your results", kicker("What the pull found") + h1(found != null && repairToday != null ? "These " + found + " items hold your file at " + money(repairToday) + " today." : "Your file needs a closer look before we quote an amount.") + scoreBars(d.fico) + sampleLine(d) + '<div style="margin-top:8px">' + reasonsList(d, false) + "</div>" + (fixed != null ? sub("With the file optimized, the engine projects " + money(fixed) + ".") : ""));
    }
    if (c === "F-01") {
      var fileVis = deckVisual(), fileCount = fileVis ? (fileVis.cards || []).filter(function (card) { return card && card.balance > card.target; }).length + (fileVis.items || []).length + (fileVis.mismatches || []).length : null;
      return slide("F-01", "What holds your file back", kicker("What to work on") + h1(fileCount == null ? "Your file findings appear after the pull." : fileCount + " things hold your file back, and each one has a step.") + (visualHtml("fileFindings") || unavail()));
    }
    if (c === "L-01") {
      /* Visual A, the money levers. Next only lands here when it draws (go()). */
      var climb = deckVisual(), gap = climb && Number.isFinite(climb.todayTotal) && Number.isFinite(climb.optimizedTotal) ? climb.optimizedTotal - climb.todayTotal : null;
      return slide("L-01", "How much more", kicker("The file's potential") + h1(gap == null ? "The gap shows when this file has a verified projection." : gap > 0 ? money(gap) + " is left on the table." : "This file shows no added amount from these levers.") + (visualHtml("moneyLevers") || unavail()));
    }
    if (c === "F-02") {
      var reach = deckVisual() && deckVisual().lenderReach;
      return slide("F-02", "Lender reach", kicker("More doors") + h1(reach && Number.isInteger(reach.now) && Number.isInteger(reach.after) ? reach.now + " lenders match your file today; " + reach.after + " more match after optimization." : "Lender matches appear when the engine can read this file.") + (visualHtml("lenderWall") || unavail()));
    }
    if (c === "S-08") {
      if (edu) {
        return slide("S-08", "The education path", kicker("Learn it. Run it yourself.") + h1("Two ways to own this skill.") + pathRows([
          ["01 / FILE", "Your file, in your hands", "The complete UnderwriteIQ deliverables package, generated from today's pull."],
          ["02 / LIST", "The bank list", "Your lender match list, ranked in the order you should apply."],
          ["03 / PROGRAM", "Funding Mastery, A to Z", "The complete Fundhub credit and funding program, start to finish."]
        ]));
      }
      /* Visual E, your path, replaces the text below when it draws. */
      var yourPath = visualHtml("yourPath");
      if (yourPath) return slide("S-08", "Your path", yourPath);
      return slide("S-08", funding ? "The process" : "The plan", kicker(funding ? "Completely done-for-you" : "Recommended path") + h1(funding ? "Three steps. Done for you." : "Cleaned up first. Funded second.") + pathRows(funding ? [
        ["01 / MATCH", "AI Lender Matching", "The banks that match your file, in the right order."],
        ["02 / DEPLOY", "Sequential Round Deployment", "Applications in strategic rounds, Inquiry Sweeps between."],
        ["03 / EXECUTE", "Done-For-You Execution", "The Fundhub team runs every application. You run the business."]
      ] : [
        ["01 / CLEAN", "Clean the file", "Every limiting factor addressed, disputes to bureaus and creditors."],
        ["02 / TRACK", "Watch it live", "Every move in real time in your dashboard."],
        ["03 / FUND", "Then we fund you", "Full funding process from the strongest possible position."]
      ]));
    }
    if (c === "S-09") {
      if (edu) return slide("S-09", "Course one", kicker("Everything the system built from your file today") + h1("Your complete deliverables.") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>");
      if (funding) return slide("S-09", "The matching difference", kicker("Matched to your file") + h1("Applying on your own stacks hard pulls. Matched, the right lenders come in the right order.") + (visualHtml("blindMatched") || unavail()));
      var items = deckVisual() && Array.isArray(deckVisual().items) ? deckVisual().items : null;
      if (items) return slide("S-09", "The findings", kicker("Item by item") + h1(itemCount(items.length)) + itemsList(items) + sub("Every item already has a round assigned. This is the plan, not a promise of what happens later."));
      return slide("S-09", "The findings", kicker("Item by item") + h1(dash(d.negItems) + " items are limiting your approvals.") + '<div style="margin-top:10px">' + reasonsList(d, true) + "</div>" + sub("Every item already has a round assigned. This is the plan, not a promise of what happens later."));
    }
    if (c === "S-10") {
      if (edu) return slide("S-10", "Course two", kicker("The full program") + h1("Funding Mastery. A to Z.") + bars(["The complete Fundhub credit and funding system, taught start to finish.", "Credit, optimization, and funding execution — the whole picture, not pieces.", "Paired with your own file, so you're working on real data, not theory."]));
      if (funding) return slide("S-10", "Lender matching", kicker("The funding sequence") + h1("The Fundhub team matches your file and runs every application in order.") + (visualHtml("sequence") || unavail()));
      if (funding) return slide("S-10", "Step 1 of 3", kicker("Step 1 of 3") + h1("AI Lender Matching.") + bars(["UnderwriteIQ, the same system that just read your file, matches it to the banks that fit it.", "Every bank is picked from your file, not from one list used for every client.", "You only apply where your file makes sense."]));
      return slide("S-10", "Already generated", kicker("FCRA · Metro 2") + h1("The law is on your side.") + '<div style="margin-top:8px;max-width:620px">' +
        row("Maximum possible accuracy", "FCRA §607", "Bureaus are required by federal law to report your file accurately") +
        row("Every dispute investigated", "30–45 days", "FCRA §611 — they must investigate and respond, every round") +
        row("Creditors carry duties too", "FCRA §623", "Furnishers must investigate and correct what they can't verify") +
        row("Deletion tier", "BK §524", "A balance on a discharged debt violates a federal court order, not just a reporting rule") +
        row("Written process", "FCRA", "Every response is tracked in the dashboard", true) + "</div>" +
        sub("Metro 2 is the industry reporting standard. The FCRA is the federal law that makes accuracy enforceable. Every letter carries its statute citations, checked byte for byte."));
    }
    if (c === "S-11") {
      if (funding) return slide("S-11", "Inquiry order", kicker("The funding sequence") + h1("Applications go in rounds so inquiries do not stack at once.") + (visualHtml("sequence") || unavail()));
      if (funding) return slide("S-11", "The second problem", kicker("What kills approval odds") + h1("Inquiry stacking.") + bars(["Most funding companies submit all your applications at once.", "The banks see all those inquiries hit your report simultaneously, and they start denying you.", "It kills your approval odds before the round is even finished."]));
      return slide("S-11", "Done for you", kicker("How the dispute actually runs") + h1("Straight at the creditor.") + stepsHtml([["Furnisher round", "Metro 2, direct to creditor"], ["Response", "creditor on the record"], ["Proof", "to all 3 bureaus"], ["Escalate", "CFPB · state AG"]], 0) + sub("The creditor's own response becomes the evidence. It goes back to all three bureaus, and if the file still isn't right, we escalate through the administrative process. Done for you, or you run the exact same pack yourself."));
    }
    if (c === "S-12") {
      if (funding) {
        return slide("S-12", "Funding rounds", kicker("The funding sequence") + h1("One funding sequence is about six rounds, with inquiry disputes between them.") + (visualHtml("sequence") || unavail()));
        return slide("S-12", "Step 2 of 3", kicker("Step 2 of 3") + h1("Sequential rounds. Inquiry Sweeps.") +
          '<div style="margin-top:12px;max-width:620px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' + ["Round 1", "Sweep", "Round 2", "Sweep", "Round 3"].map(function (s, i) {
            return '<div style="font-family:var(--mono);font-size:10.5px;padding:7px 11px;border:1px solid var(--line);background:' + (s === "Sweep" ? "transparent" : "var(--soft)") + ";color:" + (s === "Sweep" ? "var(--gray)" : "var(--ink)") + '">' + s + "</div>" + (i < 4 ? '<span style="font-family:var(--mono);color:var(--gray2)">→</span>' : "");
          }).join("") + '<span class="mono" style="color:var(--gray2)">… about 6 per sequence</span></div>' +
          bars(["Round 1 goes out to the banks that match your file.", "Before Round 2, we dispute the new hard inquiries.", "One funding sequence is about six rounds, built toward " + money(d.total) + "."]) +
          (state.tier === "FUNDING_PLUS_REPAIR" ? fine("In parallel: your other two bureaus get the full dispute process at the same time, bureaus and creditors. It never delays a round.") : ""));
      }
      return slide("S-12", "The rounds", kicker("Escalating, round after round") + h1("Each round builds on the last.") + stepsHtml([["Round 1", "dispute, today"], ["Round 2", "method of verification"], ["Round 3", "final notice"], ["Rounds 4 to 6", "CFPB · state AG · final notice"]], 0) + sub("Bureaus must investigate and respond every round, 30 to 45 days. Up to six rounds, each one built from your file."));
    }
    if (c === "S-13") {
      if (funding) return slide("S-13", "The match", kicker("The funding sequence") + h1("Your file sets the lenders and the order for each round.") + (visualHtml("sequence") || unavail()));
      if (funding) return slide("S-13", "The result", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Versus applying blind") + h1("Your file picks the banks.", "clamp(30px,4.6vw,58px)") + sub("Every application has a reason: the right banks, in the right order, from what your file shows.") + '<div style="margin-top:16px;max-width:200px" class="hair"></div></div>');
      return slide("S-13", "Your dashboard", kicker("Real time") + h1("Watch every move happen.") + '<div style="margin-top:10px">' + row("Every dispute", "Live", "The moment it goes out") + row("Every response", "Logged", "Bureau and creditor replies, as they land") + row("Every round", "Tracked", "Where the file stands, at any moment") + "</div>");
    }
    if (c === "S-14") {
      if (funding) return slide("S-14", "Done for you", kicker("The funding sequence") + h1("The Fundhub team runs every application and every follow-up.") + (visualHtml("sequence") || unavail()));
      if (funding) return slide("S-14", "Step 3 of 3", kicker("Step 3 of 3") + h1("Done for you. Start to finish.") + bars(["The Fundhub team runs every application and every follow-up with the banks.", "Between rounds, we dispute the new inquiries. You don't fill out a single application.", "You focus on running and scaling the business. We handle the capital side."]));
      return slide("S-14", "After cleanup", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Why we clean up first") + h1("The same file, two positions.", "clamp(22px,3.2vw,40px)") + beforeAfter(visualAmount("todayTotal", d.total), visualAmount("optimizedTotal", d.afterFix)) + fine("Projection based on your current file. Not a guarantee of approval, amounts, rates, or terms.") + "</div>");
    }
    if (c === "S-15") {
      if (funding) return slide("S-15", "The timeline", kicker("After you sign") + h1("Your advisor starts within 24 business hours, and your first applications go out within 72.") + (visualHtml("clock") || unavail()));
      /* Visual D, the credit optimization journey, shows all six rounds in
         place of the three-round grid below (row 11), which stays as the
         fallback. */
      var journey = visualHtml("journey");
      if (journey) return slide("S-15", "Your journey", journey);
      return slide("S-15", "The timeline", kicker("Already built from today's pull") + h1("It's sitting in the queue.") + lettersGrid() + '<div style="margin-top:6px">' + row("All that's left", "The button", "Say the word and Round 1 is out today", true) + "</div>");
    }
    if (c === "S-16") {
      if (!funding && !edu) {
        return slide("S-16", "The wrong way", kicker("Documented disputes") + h1("Your file gets a documented dispute process, round by round.") + '<div style="margin-top:8px;max-width:620px">' +
          row('So-called "credit sweeps"', "Fraud", "Fake FTC identity-theft and police reports to wipe a file — a federal crime, up to 5 years") +
          row('Even when it "works"', "It bounces", "The creditor just re-reports the account next month. Fraud deletions don't stick.") +
          row("Documented disputes", "FCRA §611", "A bureau must follow the rules if an item is reinserted", true) + "</div>" +
          sub("We use the documented process. Each bureau and creditor must respond on its own record.") +
          fine("Not to be confused with Fundhub Inquiry Sweeps — documented inquiry disputes filed on the record as part of funding rounds."));
      }
      if (funding && state.showRevenue) return slide("S-16", "Revenue path", kicker("Two tracks") + h1("Revenue funding can move now while your file is prepared for a later sequence.") + (visualHtml("revenueSplit") || unavail()));
      if (funding) return slide("S-16", "Client approvals", kicker("Proof from client files") + h1("Real clients have received real approvals.") + (visualHtml("proofWall") || unavail()));
      return slide("S-16", "Financing we help you access", kicker(funding ? "The menu" : "What opens up after cleanup") + h1("Built around what you actually need.") +
        '<div class="menu-grid">' + MENU.map(function (m) {
          return '<div class="menu-item"><span class="mono">' + m[0] + '</span><div class="menu-t">' + esc(m[1]) + '</div><div class="menu-d">' + esc(m[2]) + "</div></div>";
        }).join("") + "</div>" +
        '<div class="menu-steps"><span class="mono">How revenue funding works</span><ol>' + REVENUE_STEPS.map(function (t, i) {
          return '<li><span class="n">' + String(i + 1).padStart(2, "0") + '</span><span class="t">' + esc(t) + "</span></li>";
        }).join("") + "</ol></div>" +
        fine("Intro APR offers are set by card issuers, apply for limited promotional periods, and revert to issuer standard rates. All amounts, rates, and terms are determined by funding partners based on qualification."));
    }
    if (c === "P-01") return slide("P-01", "Funding partners for life", kicker("The next sequence") + h1("We stay your funding partner for life.") + (visualHtml("partnerStaircase") || unavail()));
    if (c === "C-01") {
      /* Visual B, more companies, more funding. Door 1 only, and Next only
         lands here when it draws (go()). */
      return slide("C-01", "More companies", visualHtml("companies") || unavail());
    }
    if (c === "S-17") {
      return slide("S-17", "Alignment", kicker("How we work") + h1("The Fundhub team works the plan your file supports.") + (visualHtml("alignment") || unavail()));
    }
    if (c === "S-18") {
      return slide("S-18", "Where do you fall", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("Scale of 1 to 10") + h1("Where do you feel like you fall?", "clamp(24px,3.6vw,44px)") + '<div style="margin-top:18px;display:flex;align-items:center;gap:12px;max-width:480px"><span class="mono" style="color:var(--gray2)">1</span><div style="flex:1"><div class="hair"></div></div><span class="mono">10</span></div><div style="display:flex;justify-content:space-between;max-width:480px;margin-top:6px"><span class="mono" style="color:var(--gray2)">Not for me</span><span class="mono" style="color:var(--gray)">Exactly what I need</span></div></div>');
    }
    if (c === "S-19") {
      if (!edu) return slide("S-19", "Your plan", kicker("The four doors") + h1("This is the plan built for your file.") + (visualHtml("doorMatrix") || unavail()));
      if (edu) {
        if (rung === 0) return slide("S-19", "The investment", fill(kicker("Funding Mastery, A to Z") + h1(price("FUNDING_MASTERY"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("The full Fundhub program", "A to Z", "Credit, optimization, and funding execution, start to finish") + row("Your own file", "Included data", "You work on your real reports, not examples") + "</div>" + financingNote("FUNDING_MASTERY")));
        return slide("S-19", "The investment", fill(kicker("Course one, everything from your file") + h1(price("UWIQ_DELIVERABLES"), "clamp(24px,3.8vw,44px)") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>" + financingNote("UWIQ_DELIVERABLES")));
      }
      if (funding) {
        return slide("S-19", "The investment", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("To activate the system today") + '<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap">' + h1(price("FUNDING_DFY"), "clamp(32px,5.2vw,60px)") + '<span style="font-family:var(--mono);font-size:clamp(12px,1.3vw,15px);color:var(--gray)">deposit</span></div>' + sub("Not an additional fee. It goes directly toward your 10 percent success fee on the back end.") + '<div style="margin-top:14px;max-width:200px" class="hair"></div></div>');
      }
      if (rung === 0) return slide("S-19", "The investment", fill(kicker("Credit optimization, done for you") + h1(price("REPAIR_DFY"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("Forensic audit", "Included", "Your full file, the way lenders see it") + row("Disputes", "All rounds", "Both the bureaus and the creditors, escalating") + row("Your dashboard", "Real time", "Watch every move happen. You don't touch a thing.") + "</div>" + financingNote("REPAIR_DFY")));
      if (rung === 1) return slide("S-19", "The investment", fill(kicker("Try it first, done for you") + h1(price("REPAIR_TRIAL"), "clamp(28px,4.4vw,52px)") + '<div style="margin-top:8px;max-width:560px">' + row("Round 1", "We run it", "Our team fires your first full round, bureaus and creditors") + row("You watch", "Dashboard", "Every dispute and response, live") + row("Then decide", "Your call", "Continue full done-for-you, or take it from here") + "</div>" + financingNote("REPAIR_TRIAL")));
      return slide("S-19", "The investment", fill(kicker("Do it yourself, everything from your file") + h1(price("UWIQ_DELIVERABLES"), "clamp(24px,3.8vw,44px)") + '<div style="margin-top:6px;max-width:580px">' + deliverableRows() + "</div>" + financingNote("UWIQ_DELIVERABLES")));
    }
    if (c === "S-20") {
      if (!edu && (funding || selectedOfferKey() === "UWIQ_DELIVERABLES")) return slide("S-20", "How the payment works", kicker("The investment") + h1(funding ? price("FUNDING_DFY") + " today is credited against your success fee when funding arrives." : "The Capital Blueprint is " + price("UWIQ_DELIVERABLES") + " for 12 months.") + (visualHtml("moneyStrip") || unavail()) + (!funding && costN > 0 ? sub("You said waiting costs " + money(costN) + " a month. Over a year, that is " + money(costN * 12) + " based on what you said earlier on this call.") : ""));
      if (edu) return slide("S-20", "Two courses", fill(kicker("Side by side") + h1("Two courses. One skill set.") + '<div style="margin-top:10px;max-width:620px">' + row("Course 1 — UWIQ deliverables + bank list", price("UWIQ_DELIVERABLES"), "Everything from your file. You execute it with the how-to course.") + row("Course 2 — Funding Mastery, A to Z", price("FUNDING_MASTERY"), "The complete program, start to finish, on your own data", true) + "</div>"));
      if (funding) return slide("S-20", "The math", fill(kicker("Line by line") + h1("We only make money when you get funded.") + '<div style="margin-top:10px;max-width:560px">' + row("Your funding", money(d.total), "How much you qualify for today. Lenders make the final call.") + row("Total success fee, " + feePct + " percent", money(fee)) + row("Your deposit, credited", deposit != null ? ("- " + money(deposit)) : "—") + row("Back end balance", money(backEnd), "Only charged once the capital is actually in your hands", true) + "</div>" + sub("Our success is literally tied to yours.")));
      if (costN > 0) return slide("S-20", "Then we fund you", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("What staying stuck costs") + h1(money(costN) + " a month.", "clamp(28px,4.4vw,52px)") + '<div style="margin-top:10px;max-width:560px">' + row("Every month this file sits", money(costN), "What you said it costs you, earlier on this call") + row("Over a year", money(costN * 12), "Gone, without the file moving an inch", true) + row("The fix", "Starts today", "Cleaned up first, funded second, strongest position") + "</div></div>");
      return slide("S-20", "Then we fund you", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + kicker("What staying stuck costs") + h1("Cleaned up first. Funded second.", "clamp(24px,3.6vw,44px)") + sub("We get your credit cleaned up first, so when we run the full funding process you're in the strongest possible position and we can maximize your approval amount.") + "</div>");
    }
    if (c === "S-21") {
      if (edu) return slide("S-21", "When we start", kicker("Set up on this call") + h1("You leave with it today.") + '<div style="margin-top:10px;max-width:620px">' + row("On this call", "Access", "Account and access squared away before we hang up") + row("Today", "Your file", "Deliverables generate from the pull we just ran") + row("When you're ready", "Funding", "Run the full funding process whenever you want") + "</div>");
      if (funding) return slide("S-21", "Written guarantees", kicker("In the agreement") + h1("Two action deadlines protect your deposit in writing.") + (visualHtml("guarantees") || unavail()));
      if (selectedOfferKey() === "UWIQ_DELIVERABLES") return slide("S-21", "Your Blueprint", kicker("Your own plan") + h1("Your Capital Blueprint opens from this file after checkout.") + (visualHtml("nextSteps") || unavail()));
      return slide("S-21", "When we start", kicker("What happens when we start") + h1("Round one goes out today.") + '<div style="margin-top:10px;max-width:620px">' + row("Today", "Letters out", "Generated from the pull we just ran, in your email") + row("Your dashboard", "Live", "Track every dispute and every response") + row("Round by round", "Escalate", "Until the file is where it needs to be") + "</div>");
    }
    if (c === "S-22") {
      return slide("S-22", "Ready when you are", kicker("Your choice") + h1("You decide when this plan starts.") + (visualHtml("alignment") || unavail()));
    }
    if (c === "S-23") {
      if (!edu) return slide("S-23", "Starting today", kicker("Paperwork") + h1("You are in. Here is what happens next, starting today.") + (visualHtml("nextSteps") || unavail()));
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
      if (!edu) return slide("S-24", "Welcome aboard", kicker("After checkout") + h1("Your next steps are in your portal, starting today.") + (visualHtml("nextSteps") || unavail()));
      var next = edu
        ? row("Today", "Deliverables", "Everything from your file lands in your email") + row("Your pace", "Program", "Work through it on your own schedule") + row("When you're ready", "Funding", "We run the full process whenever you want")
        : funding
          ? row("Within 24 business hours", "Advisor", "Your dedicated funding advisor reaches out and starts on your file") + row("Within 72 business hours", "Round 1", "Your first round of applications is submitted") + row("After each round", "Updates", "Every application and every answer shows in your portal")
          : row("Today", "Round 1", "Your letters generate from this pull and land in your email") + row("Your dashboard", "Live", "Track every dispute and every response") + row("When it's clean", "Funding", "We run the full process at maximum strength");
      return slide("S-24", "Welcome aboard", '<div style="flex:1;display:flex;flex-direction:column;justify-content:center">' + h1("Here's what happens next.", "clamp(22px,3.4vw,42px)") + '<div style="margin-top:10px;max-width:560px">' + next + '</div><div style="margin-top:16px;display:flex;align-items:center;gap:12px"><span class="brand">fundhub<span>.</span></span><div style="flex:1;max-width:140px" class="hair"></div><span class="mono">systems nominal</span></div></div>');
    }
    return needsEngine && !d.available ? slide(c, "Session", unavail()) : "";
  }

  /* ───────── 06 BLUEPRINT STACK — begin ─────────
     The Capital Blueprint + FinanceOS offer stack, for the rep on a live call.
     Owner, 2026-10-06: "Add these items into our offer stack so they show up
     when we're doing presentations for clients... a whole presentation section
     with the buttons and logic."

     WHAT IS ON IT, AND WHY ONLY THAT. Every item is built, measured against the
     code on 2026-10-07 (ops/workflows/blueprint-launch-2026-10-06.md), and each
     names the file that does it. The welcome kit (parked by the owner), quizzes
     (not built), the letter-mailing upsell (no billing yet) and the
     pre-application check (not built) are left off on purpose. Add a line here
     only when its code ships.

     PRICES. The Blueprint's price is price("UWIQ_DELIVERABLES"): the catalog in
     src/config/offers.mjs, the same number the pay link charges. A price the
     owner has not set is UNSET_PRICE, "$X": FinanceOS's setup fee and its
     per-container price (no catalog entry; the FinanceOS Setup tab paints the
     same $X). B-04 no longer names a monthly member fee after the 12 months:
     there is no renewal charge (owner call, 2026-10-29). No item carries a
     "value" dollar figure. No such number exists in the repo, so each one says
     what it does for the caller instead.

     WORDS. Never "round two": the next one is the next funding sequence (owner,
     2026-10-06). Nothing here promises an approval, an amount, a score or a
     removal. The Capital Blueprint agreement says the same in its section 3
     (db/migrations/288_real_contract_text.sql). */
  var UNSET_PRICE = "$X";
  var NO_PROMISE = "No guarantee of credit scores, removals, approvals, or funding amounts.";

  /* door "both": FinanceOS has it on its own too, and `fos` is what the
     FinanceOS downsell slide (B-05) calls it there. door "blueprint": only with
     the Blueprint. B-05 prints this split, so it is the code's split, not a
     sales guess:
       - decline defense writes need a paid Blueprint (api/blueprint/declines.mjs)
       - the document vault chase is Blueprint buyers only
         (src/workflows/document-vault-chase.mjs)
       - file alerts go to Blueprint buyers AND FinanceOS subscribers
         (src/workflows/blueprint-finance-os-alerts.mjs)
       - "Ready to get funded" lives in FinanceOS; a FinanceOS-only client stops
         at the CSM (src/finance/ready-to-fund.mjs)
       - the credit partner and the bank tracker refuse a non-Blueprint client
         (src/blueprint/credit-partner.mjs, bank-relationship.mjs) */
  var STACK = [
    /* db/migrations/400_blueprint_dispute_waypoint_definitions.sql, src/waypoints/verify.mjs */
    { key: "disputes", door: "blueprint", name: "Dispute rounds, with proof",
      line: "Each dispute round is a step on your checklist: mail the letters, upload the mail receipt, upload the bureau's answer. A step clears only with the proof." },
    /* src/nudge/ladder.mjs: four rungs, and the last one is a person */
    { key: "helper", door: "blueprint", name: "Accountability helper",
      line: "A helper stays on your open step. A text when it is due, then an email, then a text. Still stuck? A person on our team steps in." },
    /* src/finance/money-helper.mjs (readContext), FinanceOS Money helper tab */
    { key: "moneyhelper", door: "both", name: "Money helper", fos: "Money helper",
      line: "Ask what to pay and when. It answers from your own accounts." },
    /* src/workflows/finance-os-pull-sweeper.mjs, then src/blueprint/monthly-pull-aftercare.mjs */
    { key: "pull", door: "blueprint", name: "Monthly soft pull",
      line: "A new soft pull every 30 days. Your checklist and your letters update from what changed." },
    /* src/blueprint/closer-ready.mjs, src/finance/ready-to-fund.mjs */
    { key: "ready", door: "both", name: "Ready to get funded", fos: "The “I'm ready to get funded” button",
      line: "When the engine says your file is ready, the Fundhub team preps you and a closer calls about funding. You can also ask with one button." },
    /* src/blueprint/paydown-simulator.mjs, FinanceOS Strategy tab */
    { key: "paydown", door: "both", name: "Paydown and payment strategy", fos: "Payment strategy",
      line: "Enter the cash you have. See which cards to pay down first, by how much, and a payoff plan to your goal date." },
    /* public/app/financeos.html; card-due reminders (finance-os-card-due-reminders) */
    { key: "financeos", door: "both", name: "FinanceOS, 12 months included", fos: "Every account, card, and due date on one page",
      line: "Every account, card, and due date on one page, with a reminder before each due date." },
    /* src/finance/file-alerts/ (migration 471) */
    { key: "alerts", door: "both", name: "File-protection alerts", fos: "File-protection alerts",
      line: "A text before each statement date, 60, 30, and 7 days before a 0% promo ends, when cash drops below six months of minimum payments, and when a new card or inquiry shows up." },
    /* src/blueprint/credit-partner.mjs; the Control Panel: "One partner is included with the Blueprint." */
    { key: "partner", door: "blueprint", name: "Credit partner file",
      line: "One spouse or business partner can join as a second applicant. They give their own consent, and their file gets its own checklist." },
    /* src/blueprint/bank-relationship.mjs, FinanceOS Banks tab */
    { key: "banks", door: "blueprint", name: "Bank relationship tracker",
      line: "Open accounts at the banks on your match list. We track your deposits there, so the relationship is in place before you apply." },
    /* src/blueprint/decline-analyze.mjs, FinanceOS Applications tab */
    { key: "declines", door: "blueprint", name: "Decline defense",
      line: "If a bank says no, paste the letter in. You get the likely reasons and the steps to ask for a second look." },
    /* src/finance/document-vault.mjs (migration 472), FinanceOS Funding papers tab. The
       asks are the Blueprint part: src/workflows/document-vault-chase.mjs chases
       paid Blueprint buyers only. */
    { key: "vault", door: "blueprint", name: "Funding papers checklist",
      line: "We ask for your bank statements, tax returns, and ID ahead of time, one paper at a time, so your file is complete when the closer calls." },
    /* src/blueprint/next-sequence-math.mjs: the file suggests the date from cited
       windows, a staff date wins; src/workflows/blueprint-next-funding-sequence-sweeper.mjs
       tells the closer that day */
    { key: "nextseq", door: "blueprint", name: "Next funding sequence",
      line: "After funding, the planner reads your file and suggests when it is ready for the next funding sequence. That date goes on your plan, and a closer is told that day." }
  ];

  /* The FinanceOS page's own tabs, in its order: public/app/financeos.js TABS.
     src/http/present-blueprint-stack.test.mjs fails if the two drift apart, so
     a demo link never points at a tab that is not on the page, and a new tab
     there is added here. */
  var FOS_TABS = [
    ["overview", "Overview"], ["next", "Next steps"], ["helper", "Money helper"], ["transfers", "Money moves"],
    ["plan", "Plan"], ["banks", "Banks"], ["strategy", "Strategy"], ["fundability", "Fundability"],
    ["declines", "Applications"], ["alerts", "Alerts"], ["vault", "Funding papers"],
    ["accounts", "Accounts"], ["credit", "Credit"],
    ["connections", "Connections"], ["payments", "Payments"], ["setup", "Setup"]
  ];
  /* The one client every demo opens: the FinanceOS test client (sandbox bank v3
     plus one sample credit file, scripts/finance-os-sample-v3.mjs). A real
     client's file is never opened on a sales call. */
  var FOS_DEMO_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
  /* /api/money/* opens another person's FinanceOS only for ROLE_SETS.FINANCE
     (src/http/read-api.mjs). A closer is outside that set, so for a closer a
     demo link would open an error page on a live call. The test pins this list
     to that set. The role read is the same cached hint shell.js keeps and
     financeos.js reads; the server still decides. */
  var FOS_DEMO_ROLES = ["owner", "admin", "sales_manager", "closer"];

  var STACK_TALK = {
    "B-01": {
      title: "The Blueprint. Two doors, one system.",
      lines: [
        "Most people get a plan and then get stuck on it. The Capital Blueprint is the system that keeps you moving on yours.",
        "Two parts. The Blueprint makes the plan and runs the credit side. FinanceOS watches your money every day. The Blueprint includes 12 months of FinanceOS.",
        "Want me to show you what's in it for your file?"
      ],
      watch: "Sell decisions, not pages: their file, their next move. Never promise an approval, an amount, a score, or a removal."
    },
    "B-02": {
      title: "The stack. Walk each line.",
      lines: [
        "Here's everything in your Blueprint. I turned on the pieces that fit your file.",
        "One line each, then a tie-down: does that make sense?",
        "Is there a spouse or business partner who would apply with you? One partner file is included."
      ],
      watch: "Their screen shows only what is on. Never promise an approval, an amount, a score, or a removal. Fundhub switches live monthly pulls on, so never promise the date of the first one. After the payment posts, set up the credit partner and the bank tracker on the Client Control Panel."
    },
    "B-03": {
      title: "FinanceOS. Show it live.",
      lines: [
        "This is FinanceOS. Every account, every card, every due date, on one page.",
        "Let me open a sample client so you can see it working.",
        "This is a sample file with test data, not a real person."
      ],
      watch: "Demos open the sample client in a new tab. Never open a real client's FinanceOS on a call. Live bank linking waits on Plaid; until then accounts are typed in, so do not promise a bank connection."
    },
    "B-04": {
      title: "The investment.",
      lines: [
        "That's the whole system, for 12 months.",
        "Read the price off the screen. Financing is available.",
        "Want me to get you set up?",
        "Then stop talking."
      ],
      watch: "Price only from the screen. There is no renewal charge after the 12 months, so never quote a member fee. Never promise an approval, an amount, a score, or a removal. The guarantees on S-21 belong to the funding offer: read G-01 and G-02 there word for word, never for the Blueprint."
    },
    "B-05": {
      title: "Downsell. Start with FinanceOS.",
      lines: [
        "If the full Blueprint isn't right today, start with FinanceOS.",
        "One setup fee, then a monthly price for each container. A container is each business and each person on your account.",
        "When you're ready to get funded, one button tells the Fundhub team."
      ],
      watch: "FinanceOS prices are not set yet and show $X. This deck has no FinanceOS checkout, so take no payment for it on this call and do not log it as a sale."
    },
    "B-06": {
      title: "Upsell path. One button up.",
      lines: [
        "Here's how it works when you're ready.",
        "You prep in FinanceOS. Press \"I'm ready to get funded\" and the Fundhub team reaches out.",
        "Move up to the Blueprint, and when the engine says your file is ready, a closer calls about funding."
      ],
      watch: "A FinanceOS-only client stops at the Fundhub team. The closer is called only for a Blueprint client whose file is ready. Never promise when that will be."
    }
  };
  /* B-03 when visual C, the Blueprint dashboard, draws in the slides (row 12).
     It needs no test account, so the sample-client links are not shown. */
  var DEMO_TALK = {
    title: "Your dashboard. Click through it.",
    lines: [
      "This is your Blueprint dashboard, built from your own file.",
      "Let me click through it with you, one step at a time."
    ],
    watch: "Tapping on it saves nothing, sends nothing and charges nothing. A Sample label means it is not their file yet: say so out loud. Never promise an approval, an amount, a score, or a removal."
  };

  /* Part 6 also holds S-09 to S-16 and C-01, so the stack is the B slides. */
  function isStackCode(c) {
    return /^B-\d\d$/.test(String(c || ""));
  }
  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : (/s$/.test(word) ? "es" : "s"));
  }
  /* What the deck already knows about this caller, and nothing else: the
     engine's sort and item count, and the companies on the file. */
  function stackCtx() {
    var d = state.engine || {};
    /* A real pull leaves negItems empty; engine.visual carries the items (board 10.2). */
    var v = d.visual && d.visual.source && d.visual.source !== "none" && Array.isArray(d.visual.items) ? d.visual : null;
    var n = v ? v.items.length
      : (d.available && d.negItems != null && isFinite(Number(d.negItems)) ? Number(d.negItems) : null);
    return {
      pulled: !!d.available,
      neg: n,
      fundable: state.tier === "FULL_FUNDING" || state.tier === "FUNDING_PLUS_REPAIR",
      repairSort: state.tier === "REPAIR_ONLY" || state.tier === "FUNDING_PLUS_REPAIR",
      biz: businesses().length
    };
  }
  /* [on, why]: where each item starts for this caller, and the reason the rep
     reads under it. A clean file gets no dispute rounds (one file, one story:
     .claude/rules/sample-clients-consistent.md). Nobody on the deck is a credit
     partner until the rep says so. */
  function stackDefault(key, x) {
    if (key === "disputes") {
      if (x.neg != null && x.neg > 0) return [true, plural(x.neg, "negative item") + " on this file."];
      if (x.neg === 0) return [false, "No negative items on this file. Nothing to dispute."];
      if (x.repairSort) return [true, "Sorted to repair. The item count is not on the file."];
      return [false, x.pulled
        ? "No negative items on the file. Turn on only if the report shows one."
        : "No credit file on this deck yet. Turn on only if the report shows negative items."];
    }
    if (key === "ready") {
      return x.fundable
        ? [false, "Sorted to funding today. The funding offer is the path, not a wait."]
        : [true, "Not sorted to funding yet. This is how the file gets there."];
    }
    if (key === "partner") return [false, "No partner on the file. Turn on if a spouse or business partner will apply too."];
    if (key === "vault" && x.biz > 0) return [true, plural(x.biz, "business") + " on the file, so its papers go in too."];
    if (key === "financeos" && x.biz > 0) return [true, plural(x.biz, "business") + " on the file. Each one is its own container."];
    return [true, "Part of every Blueprint."];
  }
  function stackOn(key, x) {
    if (Object.prototype.hasOwnProperty.call(state.stackPick, key)) return !!state.stackPick[key];
    return stackDefault(key, x || stackCtx())[0];
  }
  function stackLine(it, x) {
    if (it.key === "financeos" && x.biz > 0) return "Every personal and business account, card, and due date on one page, with a reminder before each due date.";
    if (it.key === "vault" && x.biz > 0) return "We ask for your bank statements, tax returns, ID, and your business papers ahead of time, one paper at a time, so your file is complete when the closer calls.";
    return it.line;
  }
  function canOpenFosDemo() {
    var role = "";
    try { role = String(window.localStorage.getItem("fh_role") || "").trim().toLowerCase(); } catch (e) { role = ""; }
    return FOS_DEMO_ROLES.indexOf(role) >= 0;
  }
  function fosDemoHref(tab) {
    return "/app/financeos.html?client_id=" + encodeURIComponent(FOS_DEMO_CLIENT) + "#" + encodeURIComponent(tab);
  }
  function stackNames(list, side) {
    if (!list.length) return '<div class="stk-none">—</div>';
    return '<div class="stk-inc one">' + list.map(function (it) {
      return '<div class="stk-incl"><span class="ck" aria-hidden="true">✓</span><span>' + esc(side === "fos" && it.fos ? it.fos : it.name) + "</span></div>";
    }).join("") + "</div>";
  }
  function stackPath(steps) {
    return '<ol class="stk-path">' + steps.map(function (s, i) {
      return '<li><span class="n">' + String(i + 1).padStart(2, "0") + '</span><div class="t">' + esc(s[0]) + '</div><div class="d">' + esc(s[1]) + "</div></li>";
    }).join("") + "</ol>";
  }

  /* Like fill(), but a block taller than the slide (a phone, a long stack)
     scrolls from its top instead of being cut off at both ends: the auto
     margins centre it only while it fits. */
  function stackFill(inner) { return '<div class="stk-fill"><div class="stk-fill-in roomy">' + inner + "</div></div>"; }

  /* Row 16: the five things the client gets, at the top of B-02, from the
     catalog in the words the script reads (blueprintDeliverables). */
  function stackGets() {
    var list = blueprintDeliverables();
    if (!list.length) return "";
    return '<div class="stk-gets"><span class="mono">What you get</span><ul class="stk-five">' + list.map(function (it) {
      return '<li><span class="ck" aria-hidden="true">✓</span><span>' + esc(it.name) + "</span></li>";
    }).join("") + "</ul></div>";
  }

  /* The client half: what the caller sees on the screen share. */
  function stackSlide(c) {
    var x = stackCtx();
    var on = STACK.filter(function (it) { return stackOn(it.key, x); });
    var picking = sub("Your rep is picking the pieces that fit your file.");
    if (c === "B-01") {
      return slide("B-01", "Capital Blueprint", kicker("Your 12-month route") + h1("The Capital Blueprint shows what to do on your own file, one step at a time.") + (visualHtml("blueprintRoute") || unavail()));
      return slide("B-01", "Capital Blueprint", stackFill(
        kicker("Capital Blueprint + FinanceOS") +
        h1("The system around your file.", "clamp(26px,3.8vw,46px)") +
        sub("Most people get a plan and then get stuck. This one stays on the plan with you, for 12 months.") +
        '<div style="margin-top:12px;max-width:760px">' +
          row("Capital Blueprint", "The plan", "Makes your plan and runs the credit side, then brings in a closer when your file is ready.") +
          row("FinanceOS", "Your money", "Watches your money every day: every account, card, and due date on one page. 12 months included.") +
        "</div>" + fine(NO_PROMISE)));
    }
    if (c === "B-02") {
      if (!on.length) return slide("B-02", "Your stack", stackFill(kicker("Built around your file") + h1("Your Capital Blueprint.") + stackGets() + picking));
      return slide("B-02", "Your stack", stackFill(kicker("Built around your file") + h1("Everything in your Capital Blueprint.") + stackGets() +
        '<div class="stk-grid">' + on.map(function (it, i) {
          return '<div class="stk-item" data-stack="' + esc(it.key) + '"><span class="n">' + String(i + 1).padStart(2, "0") +
            '</span><div class="t">' + esc(it.name) + '</div><div class="d">' + esc(stackLine(it, x)) + "</div></div>";
        }).join("") + "</div>" + fine(NO_PROMISE)));
    }
    if (c === "B-03") {
      var demo = visualHtml("blueprintDemo");
      if (demo) return slide("B-03", "Your dashboard", demo);
      return slide("B-03", "FinanceOS", stackFill(
        kicker("FinanceOS · 12 months included with the Blueprint") +
        h1("Your money, on one page.", "clamp(24px,3.4vw,42px)") +
        sub("Every account, card, and due date in one place, with a money helper that answers what to pay and when.") +
        '<div class="stk-chips">' + FOS_TABS.map(function (t) {
          return '<span class="stk-chip">' + esc(t[1]) + "</span>";
        }).join("") + "</div>"));
    }
    if (c === "B-04") {
      return slide("B-04", "The investment", stackFill(
        kicker("Everything in your Blueprint") +
        (on.length ? '<div class="stk-inc">' + on.map(function (it) {
          return '<div class="stk-incl"><span class="ck" aria-hidden="true">✓</span><span>' + esc(it.name) + "</span></div>";
        }).join("") + "</div>" : picking) +
        '<div class="stk-price"><span class="mono">Capital Blueprint · 12 months</span>' +
          h1(esc(price("UWIQ_DELIVERABLES")), "clamp(30px,4.6vw,56px)") + "</div>" +
        financingNote("UWIQ_DELIVERABLES") + fine(NO_PROMISE)));
    }
    if (c === "B-05") {
      return slide("B-05", "Start with FinanceOS", stackFill(
        kicker("Not ready for the full Blueprint?") +
        h1("Start with FinanceOS.", "clamp(24px,3.4vw,42px)") +
        '<div style="margin-top:10px;max-width:760px">' +
          row("Setup, one time", UNSET_PRICE) +
          row("Each container, per month", UNSET_PRICE, "A container is each business and each person on your account.") +
        "</div>" +
        '<div class="stk-cols">' +
          '<div><span class="mono">FinanceOS gives you</span>' + stackNames(on.filter(function (it) { return it.door === "both"; }), "fos") + "</div>" +
          '<div><span class="mono">The Blueprint adds</span>' + stackNames(on.filter(function (it) { return it.door === "blueprint"; })) + "</div>" +
        "</div>" + fine("$X means the price is not set yet.")));
    }
    if (c === "B-06") {
      return slide("B-06", "The path up", stackFill(
        kicker("When you're ready") +
        h1("One button moves you up.", "clamp(24px,3.4vw,42px)") +
        stackPath([
          ["FinanceOS", "Track and prep"],
          ["“I'm ready to get funded”", "One button"],
          ["The Fundhub team", "Preps your file"],
          ["Capital Blueprint", "The full system"],
          ["A closer calls", "When the file is ready"]
        ]) +
        sub("Start with FinanceOS. Press the button and the Fundhub team reaches out. Move up to the Blueprint, and a closer calls when the engine says your file is ready.") +
        fine("Ready means UnderwriteIQ's own checks pass on your newest file. It is not a promise of approval or an amount.")));
    }
    return slide(c, "Capital Blueprint", "");
  }

  /* The cockpit half: the rep's buttons for this section. */
  function stackToggles(x) {
    var html = '<div><span class="mono">What fits this caller</span>' +
      '<div class="stk-why">Starts from this file. Tap to change. Their screen shows only what is on.</div><div class="stk-togs">';
    STACK.forEach(function (it) {
      var on = stackOn(it.key, x);
      var mine = Object.prototype.hasOwnProperty.call(state.stackPick, it.key);
      var why = mine ? ("You turned this " + (on ? "on." : "off.")) : stackDefault(it.key, x)[1];
      html += '<button type="button" class="stk-tog' + (on ? " on" : "") + '" data-act="stack:' + esc(it.key) +
        '" aria-pressed="' + (on ? "true" : "false") + '"><span class="box" aria-hidden="true"></span>' +
        '<span class="txt"><span class="nm">' + esc(it.name) + '</span><span class="why">' + esc(why) + "</span></span>" +
        '<span class="st">' + (on ? "On" : "Off") + "</span></button>";
    });
    html += "</div>";
    if (Object.keys(state.stackPick).length) html += '<div style="margin-top:6px">' + ckBtn("Reset to this file", "stack-reset") + "</div>";
    return html + "</div>";
  }
  function fosDemo() {
    var html = '<div><span class="mono">Show it live · sample client</span>';
    if (!canOpenFosDemo()) {
      return html + '<div class="stk-why">This login cannot open FinanceOS for a client. Owner, admin, and sales manager logins can. Walk the tabs on their screen instead.</div></div>';
    }
    return html + '<div class="stk-demo">' + FOS_TABS.map(function (t) {
      return '<a class="ck-btn" href="' + esc(fosDemoHref(t[0])) + '" target="_blank" rel="noopener">' + esc(t[1]) + "</a>";
    }).join("") + '</div><div class="stk-why">Each opens a new tab on the sample client. Test data, not a real person. Say so out loud.</div></div>';
  }
  function stackCockpit() {
    var c = code();
    var x = stackCtx();
    var html = "";
    /* On the price slide the answer leads; the toggles sit under it, so the
       one action that matters is never below the fold. */
    if (c === "B-04") {
      html += '<div><span class="mono">Their answer</span><div class="stk-acts">' +
        ckBtn("Yes: close the Blueprint · " + price("UWIQ_DELIVERABLES"), "stack-close", true) +
        ckBtn("Not ready: show FinanceOS", "stack-go:B-05") +
        '</div><div class="stk-why">Yes sets Capital Blueprint as the offer and opens S-23 for the agreement and pay link.</div></div>';
    }
    if (c === "B-02" || c === "B-04") html += stackToggles(x);
    if (c === "B-03" && !visualHtml("blueprintDemo")) html += fosDemo();
    if (c === "B-05") {
      html += '<div><span class="mono">Next move</span><div class="stk-acts">' +
        ckBtn("Ready later? Show the path up", "stack-go:B-06") +
        ckBtn("Back to the Blueprint price", "stack-go:B-04") + "</div></div>";
    }
    if (c === "B-06") {
      html += '<div><span class="mono">Next move</span><div class="stk-acts">' +
        ckBtn("Back to the Blueprint price", "stack-go:B-04") +
        ckBtn("Back to FinanceOS", "stack-go:B-05") + "</div></div>";
    }
    var from = state.stackFrom != null && DECK[state.stackFrom] ? DECK[state.stackFrom].code : null;
    html += ckBtn(from ? "Leave the stack: back to " + from : "Leave the stack", "stack-leave");
    return html;
  }

  function enterStack(at) {
    if (!isStackCode(code())) state.stackFrom = state.idx;
    jumpTo(at || "B-01");
  }
  function leaveStack() {
    var back = state.stackFrom;
    jumpTo(back != null && DECK[back] && !isStackCode(DECK[back].code) ? DECK[back].code : "S-08");
  }
  function toggleStack(key) {
    var known = STACK.some(function (it) { return it.key === key; });
    if (!known) return;
    var x = stackCtx();
    var next = !stackOn(key, x);
    if (next === stackDefault(key, x)[0]) delete state.stackPick[key];
    else state.stackPick[key] = next;
    render();
  }
  /* The same two states the descent ladder's own Blueprint rungs set (desc:eduLow
     on the education route, desc:diy everywhere else). selectedOfferKey() is then
     UWIQ_DELIVERABLES, the pay link charges the catalog price, and Send contract
     picks CAPITAL-BLUEPRINT-AGREEMENT: no new offer path for either to drift on. */
  function closeBlueprint() {
    if (state.edu) { state.forceRepair = false; state.rung = 1; }
    else { state.forceRepair = true; state.rung = 2; }
    jumpTo("S-23");
  }
  /* ───────── 06 BLUEPRINT STACK — end ───────── */

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

  /* Staff-only payment illustration. The screenshot names plans and limits; a
     lender quote supplies any APR. Provider fees never enter client payments. */
  var FINANCE_PLANS = {
    standard: { name: "ClarityPay Standard", max: 30000, months: [1, 36], apr: true, reference: "Up to $30,000 · 680 minimum score · up to 36 months" },
    noInterest: { name: "ClarityPay No Interest", max: 15000, months: [1, 12], apr: false, reference: "Up to $15,000 · 620 minimum score · up to 12 months" },
    splitit: { name: "Splitit", max: 20000, months: [3, 12], apr: false, reference: "Up to $20,000 · 3 to 12 months · uses available card credit" },
    flex: { name: "FlexPay", max: 25000, months: [1, 60], apr: true, reference: "Up to $25,000 · 600 minimum score · up to 60 months" }
  };
  function financePayment() {
    var p = FINANCE_PLANS[state.financePlan] || FINANCE_PLANS.standard;
    var principal = Number(state.financeAmount || blueprintAmountCents() / 100);
    var months = Number(state.financeMonths);
    var apr = p.apr ? Number(state.financeApr) : 0;
    if (!Number.isFinite(principal) || principal <= 0 || principal > p.max) return "Enter an amount within this plan's listed limit.";
    if (!Number.isInteger(months) || months < p.months[0] || months > p.months[1]) return "Enter a term within this plan's listed range.";
    if (p.apr && (state.financeApr === "" || !Number.isFinite(apr) || apr < 0 || (state.financePlan === "flex" && apr > 36))) return "Enter the APR from the lender quote.";
    if (state.financePlan === "splitit") {
      var available = deckVisual() && deckVisual().availableCredit;
      if (!Number.isFinite(available)) return "Card headroom is not verified on this file.";
      if (principal > available) return "The amount exceeds reported card headroom.";
    }
    var rate = apr / 1200;
    var payment = rate === 0 ? principal / months : principal * rate / (1 - Math.pow(1 + rate, -months));
    return money(Math.round(payment * 100) / 100) + " per month for " + months + " months · illustration only. The lender quote controls.";
  }
  function financeHelper() {
    if (selectedOfferKey() !== "UWIQ_DELIVERABLES") return "";
    var p = FINANCE_PLANS[state.financePlan] || FINANCE_PLANS.standard;
    return '<section class="fh-finance-helper"><span class="mono">Capital Blueprint payment illustration</span>'
      + '<label for="fh-fin-plan">Plan</label><select id="fh-fin-plan">'
      + Object.keys(FINANCE_PLANS).map(function (key) { return '<option value="' + key + '"' + (key === state.financePlan ? " selected" : "") + '>' + FINANCE_PLANS[key].name + '</option>'; }).join("") + '</select>'
      + '<p class="fh-finance-note">' + esc(p.reference) + '</p>'
      + '<div class="fh-finance-fields"><label for="fh-fin-amount">Amount ($)<input id="fh-fin-amount" type="number" min="1" max="' + p.max + '" value="' + esc(state.financeAmount || String(blueprintAmountCents() / 100 || "")) + '"></label>'
      + '<label for="fh-fin-months">Months (' + p.months[0] + '–' + p.months[1] + ')<input id="fh-fin-months" type="number" min="' + p.months[0] + '" max="' + p.months[1] + '" value="' + esc(state.financeMonths) + '"></label>'
      + (p.apr ? '<label for="fh-fin-apr">Quoted APR (%)<input id="fh-fin-apr" type="number" min="0" step="0.01" value="' + esc(state.financeApr) + '"></label>' : '') + '</div>'
      + '<div id="fh-fin-result" role="status">' + esc(financePayment()) + '</div>'
      + '<p class="fh-finance-note">Reference limits from the supplied plan sheet. This is not an offer or approval. Financing is for the Capital Blueprint only.</p></section>';
  }

  function cockpit() {
    var t = closeTalk(code()) || TALK[code()] || STACK_TALK[code()] || { title: "", lines: [], watch: "" };
    if (code() === "B-03" && visualHtml("blueprintDemo")) t = DEMO_TALK;
    if (state.showMoney) t = MONEY;
    var d = state.engine || {};
    var funding = isFunding() && !state.edu;
    /* pk is the script part this slide belongs to (PHASES). While the money
       steps are open, the header and the strip say part 8. */
    var pk = phaseKey();
    var ph = state.showMoney ? phaseName("08") : phase();
    var showEngine = pk !== "01" && pk !== "02";
    var optional = ["F-01", "F-02", "P-01"];
    var missing = optional.filter(function (c) { var i = DECK.findIndex(function (entry) { return entry.code === c; }); return i >= 0 && !onWalk(i, code()); });
    var before = missing.filter(function (c) { return DECK.findIndex(function (entry) { return entry.code === c; }) <= state.idx; }).length;
    var html = '<div class="ck"><div class="ck-hd"><div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">' + esc(ph) + '</span><span class="mono">' + (state.idx + 1 - before) + " / " + (DECK.length - missing.length) + '</span></div><div class="t">' + esc(t.title) + "</div></div><div class=\"ck-bd\">";

    if (showEngine && deckVisual()) {
      var visualCredit = deckVisual();
      html += '<div class="fh-credit-readout"><span class="mono">Available credit on reported cards</span><strong>'
        + (Number.isFinite(visualCredit.availableCredit) ? money(visualCredit.availableCredit) : "Not verified") + '</strong><span class="fh-credit-basis">'
        + (visualCredit.pulledOn ? "Soft pull " + esc(visualCredit.pulledOn) + " · " : "")
        + (state.engine.sample ? "Sample file · " : "") + "Reported open cards only. Not an offer.</span></div>";
    }

    if (state.obj !== null) {
      var ob = OBJECTIONS[state.obj];
      html += '<div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">Objection</span><button type="button" class="btn-ghost" data-act="obj-back">Back</button></div>';
      html += '<div style="font-size:14px;font-weight:700">' + esc(ob.t) + "</div>";
      html += ob.lines.map(function (l) { return '<div class="say">' + esc(l) + "</div>"; }).join("");
      html += ckBtn(ob.jumpLabel, "obj-jump:" + ob.jump, true);
    } else if (state.showRef) {
      html += '<div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">Reframing patterns</span><button type="button" class="btn-ghost" data-act="ref-back">Back</button></div>';
      html += REFRAMES.map(function (r) { return "<div><div style=\"font-size:11.5px;font-weight:700\">" + esc(r[0]) + '</div><div style="font-size:11px;color:var(--gray);margin-top:2px">' + esc(r[1]) + "</div></div>"; }).join("");
    } else if (state.showMoney) {
      /* Part 8, Money: lock the plan, then talk money. The client's slide does
         not move. The pay link goes out from paperwork (S-23). */
      html += '<div style="display:flex;justify-content:space-between"><span class="mono" style="color:var(--gray)">Money</span><button type="button" class="btn-ghost" data-act="money-back">Back</button></div>';
      html += '<div><span class="mono">Lock the plan first</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">' +
        MONEY.lines.map(function (l) { return '<div class="say">' + esc(l) + "</div>"; }).join("") + "</div></div>";
      html += '<div class="watch"><span class="mono">Watch for</span><div style="font-size:11px;color:var(--gray);margin-top:4px">' + esc(MONEY.watch) + "</div></div>";
      html += financeHelper();
      html += ckBtn("Go to paperwork: agreement and pay link", "money-pay", true);
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

      if (pk === "02") {
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

      if (pk === "03" || code() === "S-07") {
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
        if (sp.sample === true) html += "<div>Sample file only. No real pull completed from this result.</div>";
        if (sp.outcome_tier) html += "<div>tier: " + esc(sp.outcome_tier) + (sp.sample === true ? " (sample)" : "") + "</div>";
        html += '</div><div style="margin-top:7px;display:flex;flex-direction:column;gap:5px">';
        html += sendBtn("Send soft pull ($32 + approval form)", "softpull", true);
        html += '</div><div style="font-size:10px;color:var(--gray2);margin-top:5px">Catalog price $32. Live prove may use $1. Stay on the Meet.</div></div>';

      }

      if (code() === "S-07") {
        html += '<div><span class="mono">Route the call</span><div style="font-size:10.5px;color:var(--gray2);margin:4px 0 6px">Engine returned ' + esc(d.label || "unavailable") + "." + (COURSE_LIVE ? " Education is client-driven — route it only if that's their ask." : "") + "</div><div style=\"display:flex;flex-direction:column;gap:5px\">";
        [["FULL_FUNDING", "FULL FUNDING"], ["FUNDING_PLUS_REPAIR", "FUNDING PLUS REPAIR"], ["REPAIR_ONLY", "REPAIR ONLY"]].forEach(function (pair) {
          html += ckBtn(pair[1], "tier:" + pair[0], pair[0] === state.tier && !state.edu);
        });
        if (COURSE_LIVE) html += ckBtn("EDUCATION PATH", "edu", state.edu);
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

      if (code() === "S-16" && funding) {
        html += '<div><span class="mono">Show on the client screen</span><div style="display:flex;gap:6px;margin-top:6px">'
          + ckBtn("Client approvals", "show-proof", !state.showRevenue)
          + ckBtn("Revenue path", "show-revenue", state.showRevenue) + '</div></div>';
      }

      if (code() === "S-19" && (!funding || state.edu)) {
        html += '<div><span class="mono">Ladder — most expensive first</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:5px">';
        if (state.edu) {
          html += ckBtn("Course 2: Funding Mastery  " + price("FUNDING_MASTERY"), "rung:0", state.rung === 0);
          html += ckBtn("Course 1: UWIQ deliverables + bank list  " + price("UWIQ_DELIVERABLES"), "rung:1", state.rung === 1);
        } else {
          /* Row 2: most expensive first, so the Capital Blueprint is the first
             rung. Each button keeps its rung number (leadRung). */
          html += ckBtn("Capital Blueprint  " + price("UWIQ_DELIVERABLES"), "rung:2", state.rung === 2);
          html += ckBtn("Onboard now: full done-for-you  " + price("REPAIR_DFY"), "rung:0", state.rung === 0);
          html += ckBtn("Trial: first round done-for-you  " + price("REPAIR_TRIAL"), "rung:1", state.rung === 1);
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
          eduHint = "Lead with the Capital Blueprint, then " + price("REPAIR_DFY") + ", then " + price("REPAIR_TRIAL") + ". Only step down on a no.";
        }
        html += '</div><div style="font-size:10.5px;color:var(--gray2);margin-top:6px">' + eduHint + "</div>";
        /* The Blueprint rung opens the full 06 stack: every piece, FinanceOS,
           the price build-up, and the FinanceOS downsell. */
        if (selectedOfferKey() === "UWIQ_DELIVERABLES") {
          html += '<div style="margin-top:7px">' + ckBtn("Show the full Blueprint stack", "stack-open") +
            '<div class="stk-why">Opens section 06: every piece, FinanceOS live, the price, and the FinanceOS downsell.</div></div>';
        }
        if (!state.edu) html += '<div style="margin-top:7px">' + ckBtn("UnderwriteIQ package → repair + funding", "bridge") + '<div style="font-size:10px;color:var(--gray2);margin-top:4px">Bridges them to the combined package. Jumps to the funding pitch.</div></div>';
        html += "</div>";
      }

      if (isStackCode(code())) html += stackCockpit();

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
        html += '<div id="fh-chosen-offer" style="font-size:10.5px;color:var(--gray2);margin:4px 0 6px">Chosen: '
          + esc((chosen && chosen.name) || offerKey) + " · " + esc(price(offerKey)) + "</div>";
        html += '<div style="margin-top:2px;display:flex;flex-direction:column;gap:5px">';
        if (offerKey === "UWIQ_DELIVERABLES" && chosen) {
          html += '<label class="mono" for="fh-blueprint-amount">Capital Blueprint price (whole dollars)</label>';
          html += '<input id="fh-blueprint-amount" class="fh-blueprint-price" type="number" inputmode="numeric" min="'
            + esc(chosen.priceMinCents / 100) + '" max="' + esc(chosen.priceMaxCents / 100)
            + '" step="1" value="' + esc(state.blueprintAmountDollars == null ? chosen.priceCents / 100 : state.blueprintAmountDollars) + '">';
          html += '<span class="caption">' + esc(money(chosen.priceMinCents / 100)) + ' to ' + esc(money(chosen.priceMaxCents / 100)) + '</span>';
          html += '<label class="mono" for="fh-blueprint-provider">Payment provider</label>';
          html += '<select id="fh-blueprint-provider" class="fh-blueprint-price"><option value="commas"'
            + (state.blueprintProvider === "commas" ? " selected" : "") + '>Commas</option><option value="whop"'
            + (state.blueprintProvider === "whop" ? " selected" : "") + '>Whop financing</option></select>';
          html += sendBtn("Send Blueprint agreement", "contract", false);
        }
        if (!isPrimaryPayOffer(offerKey)) {
          html += '<label class="mono" for="fh-sale-motion">Sale motion</label>';
          html += '<select id="fh-sale-motion" style="width:100%;border:1px solid var(--line);background:transparent;padding:6px 8px;font-size:12px">';
          html += '<option value="">Choose downsell or upsell</option>';
          html += '<option value="downsell"' + (state.saleMotion === "downsell" ? " selected" : "") + ">Downsell</option>";
          html += '<option value="upsell"' + (state.saleMotion === "upsell" ? " selected" : "") + ">Upsell</option>";
          html += "</select>";
        }
        html += sendBtn("Send pay link", "pay", true);
        /* Row 9: a funding-plus-repair agreement is the deposit plus credit
           optimization, so the second link goes out from here too. It is the
           same write the call cockpit's pay panel makes (closer-call.js
           wirePayLink): no new endpoint. */
        if (state.tier === "FUNDING_PLUS_REPAIR" && offerKey === "FUNDING_DFY" && offer("REPAIR_DFY")) {
          html += sendBtn("Send credit optimization pay link · " + price("REPAIR_DFY"), "pay-optimize", false);
          html += '<div style="font-size:10.5px;color:var(--gray2)">Funding plus credit optimization is ' + esc(price("FUNDING_DFY")) + " plus " + esc(price("REPAIR_DFY")) + ". Send both links.</div>";
        }

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
          if (offerKey !== "UWIQ_DELIVERABLES") html += sendBtn("Send contract", "contract", false);
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

      /* The ask (part 7) and paperwork (part 9), as before. Objections stay
         here, in the cockpit. */
      if (pk === "07" || pk === "09") {
        html += '<div><span class="mono">Descent ladder — every call monetizes</span><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px">';
        var ladder = [
          ["fund", "Funding · " + price("FUNDING_DFY") + " deposit", "desc:fund", funding && !state.edu],
          ["diy", "Capital Blueprint · " + price("UWIQ_DELIVERABLES"), "desc:diy", !funding && !state.edu && state.rung === 2],
          ["dfy", "Repair DFY · " + price("REPAIR_DFY"), "desc:dfy", !funding && !state.edu && state.rung === 0],
          ["trial", "Repair trial round · " + price("REPAIR_TRIAL"), "desc:trial", !funding && !state.edu && state.rung === 1]
        ];
        if (COURSE_LIVE) {
          ladder.push(["eduTop", "Funding Mastery · " + price("FUNDING_MASTERY"), "desc:eduTop", state.edu && state.rung === 0]);
          ladder.push(["eduLow", "Education deliverables · " + price("UWIQ_DELIVERABLES"), "desc:eduLow", state.edu && state.rung === 1]);
        }
        ladder.forEach(function (row) {
          html += '<button type="button" data-act="' + row[2] + '" style="font-family:var(--mono);font-size:10px;text-align:left;padding:7px 10px;border-radius:7px;background:' + (row[3] ? "var(--ink)" : "transparent") + ";color:" + (row[3] ? "var(--paper)" : "var(--gray)") + ";border:1px solid var(--line);cursor:pointer\">" + esc(row[1]) + "</button>";
        });
        html += '</div><div style="font-size:10px;color:var(--gray2);margin-top:5px">One click reshapes the price screen. Descend only on a no. Financing: the Capital Blueprint only, through Whop.</div></div>';
        html += '<div><div style="display:flex;justify-content:space-between"><span class="mono">Objections</span><button type="button" class="btn-ghost" data-act="reframes">Reframes</button></div><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">';
        OBJECTIONS.forEach(function (o, i) {
          html += '<button type="button" class="btn-ghost" data-act="obj:' + i + '">' + esc(o.t) + "</button>";
        });
        html += "</div></div>";
      }

      if (showEngine) {
        var beliefs = Object.keys(state.checks).filter(function (k) { return state.checks[k]; }).length;
        html += '<div style="border-top:1px solid var(--line);padding-top:9px"><span class="mono">Engine data</span><div style="margin-top:5px;font-family:var(--mono);font-size:10px;color:var(--gray);line-height:1.6">';
        if (!d.available) html += "<div>" + NOT_IN_YET + "</div>";
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

    html += sharedContextPanel();
    /* The strip: the script's nine part names (10.0, row 19). Each button
       jumps to the first slide of its part that this file walks; 8 opens the
       money steps. */
    html += '</div><div class="ck-ph">';
    var lit = state.showMoney ? "08" : pk;
    PHASES.forEach(function (p) {
      var active = p[0] === lit;
      html += '<button type="button" data-act="phase:' + p[0] + '" style="font-family:var(--sans);font-size:11px;font-weight:600;line-height:1.2;padding:5px 4px;background:' + (active ? "var(--ink)" : "transparent") + ";color:" + (active ? "var(--paper)" : "var(--gray)") + ";border:1px solid var(--line);cursor:pointer\">" + esc(p[1]) + "</button>";
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
      root.innerHTML = '<div class="gate fh-astra-state" role="alert"><span class="mono">Present</span><h1 class="h1 fh-astra-heading" style="margin-top:10px">' + esc(state.error) + "</h1><p class=\"sub\"><a href=\"closer-dashboard.html" + (contactId ? ("?client_id=" + encodeURIComponent(contactId)) : "") + '">Back to Closer Dashboard</a>' + signIn + '</p></div>';
      return;
    }
    if (!state.loaded) {
      root.innerHTML = '<div class="gate fh-astra-state" role="status" aria-live="polite"><span class="mono">Present</span><p class="sub">Loading this contact…</p><div class="fh-present-skeleton" aria-hidden="true"><span class="fh-present-skeleton-line"></span><span class="fh-present-skeleton-card"></span><span class="fh-present-skeleton-line"></span></div></div>';
      return;
    }
    var dots = DECK.map(function (s, i) { return '<i class="' + (i <= state.idx ? "on" : "") + '"></i>'; }).join("");
    /* One call per visual per paint: the client half and the cockpit share it. */
    visualCache = {};
    var markup;
    try {
      markup =
        '<div class="topbar"><span class="mono">' + esc((state.survey && state.survey.name) || "Present") + "</span>" +
        (state.engine && !state.engine.available ? '<span class="mono" style="color:var(--gray)">' + NOT_IN_YET + "</span>" : "") +
        '<div class="sp"></div><button type="button" class="btn-ghost" data-act="client-only">' +
        (state.clientOnly ? "Show cockpit" : "Client screen only") + "</button></div>" +
        '<div class="stage"><div class="client' + (state.clientOnly ? " solo" : "") + '">' + clientSlide() +
        '<div class="dots">' + dots + "</div></div>" +
        (state.clientOnly ? "" : '<div class="cockpit">' + cockpit() + "</div>") + "</div>";
    } finally {
      visualCache = null;
    }
    root.innerHTML = markup;
    var cost = document.getElementById("fh-cost");
    if (cost) {
      cost.addEventListener("input", function (e) { state.costNum = e.target.value; });
      cost.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    businesses().forEach(function (b, i) {
      var inc = document.getElementById("fh-inc-" + i);
      if (inc) inc.addEventListener("keydown", function (e) { e.stopPropagation(); });
    });
    var saleMotion = document.getElementById("fh-sale-motion");
    if (saleMotion) {
      saleMotion.addEventListener("change", function (e) { state.saleMotion = e.target.value; });
      saleMotion.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    var blueprintAmount = document.getElementById("fh-blueprint-amount");
    if (blueprintAmount) {
      blueprintAmount.addEventListener("input", function (e) {
        state.blueprintAmountDollars = e.target.value;
        var label = document.getElementById("fh-chosen-offer");
        if (label) label.textContent = "Chosen: " + offer("UWIQ_DELIVERABLES").name + " · " + price("UWIQ_DELIVERABLES");
      });
      blueprintAmount.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    var blueprintProvider = document.getElementById("fh-blueprint-provider");
    if (blueprintProvider) {
      blueprintProvider.addEventListener("change", function (e) { state.blueprintProvider = e.target.value; });
      blueprintProvider.addEventListener("keydown", function (e) { e.stopPropagation(); });
    }
    var financePlan = document.getElementById("fh-fin-plan");
    if (financePlan) financePlan.addEventListener("change", function (e) { state.financePlan = e.target.value; render(); });
    [["fh-fin-amount", "financeAmount"], ["fh-fin-months", "financeMonths"], ["fh-fin-apr", "financeApr"]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.addEventListener("input", function (e) {
        state[pair[1]] = e.target.value;
        var result = document.getElementById("fh-fin-result");
        if (result) result.textContent = financePayment();
      });
      el.addEventListener("keydown", function (e) { e.stopPropagation(); });
    });
    var referral = document.getElementById("fh-repair-referral");
    if (referral) {
      referral.addEventListener("change", function (e) { state.repairReferral = !!e.target.checked; });
    }
  }

  /* Which slides Next and Back walk for this file (10.0, rows 1 and 10).
     - B-01 to B-04 are Door 3, the Capital Blueprint. A file that is not ready
       walks them inside part 6 and goes on to S-09 (Door 4) after a no. A
       funding file steps over them, unless the closer is already inside.
     - B-05 and B-06 stay out of the walk: only their own buttons, or each
       other, reach them.
     - L-01 and C-01 show only when their visual draws, so a missing file or
       missing data leaves the walk exactly as it was. C-01 is Door 1 only.
     - The education route skips S-11 to S-16, as before. */
  function onWalk(j, from) {
    var c = DECK[j].code;
    if (state.edu && EDU_SKIP.indexOf(c) >= 0) return false;
    if (OFF_WALK.indexOf(c) >= 0) return OFF_WALK.indexOf(from) >= 0;
    if (isStackCode(c)) return isStackCode(from) || (!isFunding() && !state.edu);
    if (c === "L-01") return visualHtml("moneyLevers") !== null;
    if (c === "F-01") return visualHtml("fileFindings") !== null;
    if (c === "F-02") return visualHtml("lenderWall") !== null;
    if (c === "P-01") return isFunding() && !state.edu && visualHtml("partnerStaircase") !== null;
    if (c === "C-01") return isFunding() && !state.edu && visualHtml("companies") !== null;
    return true;
  }
  function go(n) {
    state.obj = null; state.showRef = false; state.showMoney = false;
    var from = code();
    var j = Math.max(0, Math.min(DECK.length - 1, state.idx + n));
    while (j > 0 && j < DECK.length - 1 && !onWalk(j, from)) {
      j = j + (n > 0 ? 1 : -1);
    }
    state.idx = Math.max(0, Math.min(DECK.length - 1, j));
    if (!isStackCode(DECK[state.idx].code)) state.stackFrom = null;
    render();
  }
  /* The first slide of a script part that this file walks. */
  function firstOfPhase(p) {
    var from = code();
    var any = -1;
    for (var i = 0; i < DECK.length; i++) {
      if (DECK[i].phase !== p) continue;
      if (any < 0) any = i;
      if (onWalk(i, from)) return i;
    }
    return any;
  }
  function jumpTo(c) {
    for (var i = 0; i < DECK.length; i++) {
      if (DECK[i].code === c) {
        state.idx = i; state.obj = null; state.showRef = false; state.showMoney = false;
        if (!isStackCode(c)) state.stackFrom = null;
        render();
        return;
      }
    }
  }
  function toast(m) {
    state.toast = m;
    render();
    setTimeout(function () { state.toast = ""; render(); }, 2600);
  }
  function setTier(k) {
    state.tier = k; state.edu = false; state.forceRepair = false; state.rung = leadRung(); render();
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
    var wantKey = resolveContractTemplateKey();
    var amountCents;
    if (selectedOfferKey() === "UWIQ_DELIVERABLES") {
      amountCents = blueprintAmountCents();
      if (amountCents === null) { toast("Choose a valid whole-dollar Capital Blueprint price first."); return; }
    }
    markSending("contract");
    state.contractMsg = "Finding the right agreement…";
    render();
    window.FHContractSend.listWordings().then(function (r) {
      if (!r.ok) {
        state.contractMsg = r.error || "Could not load the agreements.";
        markSent("contract", false);
        return;
      }
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
        templateId: picked.id,
        amountCents: amountCents
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
    state.setterHandoff = d.setter_handoff || null;
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
    if (action === "send_pay_link" && selectedOfferKey() === "UWIQ_DELIVERABLES") {
      var blueprintCents = blueprintAmountCents();
      if (blueprintCents === null) { toast("Choose a whole-dollar Capital Blueprint price from " + money(offer("UWIQ_DELIVERABLES").priceMinCents / 100) + " to " + money(offer("UWIQ_DELIVERABLES").priceMaxCents / 100) + "."); return; }
      extra = Object.assign({}, extra || {}, { amount_cents: blueprintCents, provider: state.blueprintProvider });
    }
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
    if (action === "log_disposition") {
      var paidLinkId = state.paymentLinkId || savedPaymentLink(selectedOfferKey());
      if (paidLinkId) body.payment_link_id = paidLinkId;
    }
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
      var payload = r.data || {};
      var ok = payload.delivered === true;
      if (act) markSent(act, ok);
      if (ok) {
        var n = payload.documentsStored || payload.letterCount || 0;
        toast((state.edu ? "Deliverables sent. " : "Letters sent. ") + n + " document(s) saved to the client portal.");
      } else {
        toast("Nothing was sent — " + (payload.reason || "the pack came out empty") + ".");
      }
      return;
    }
    if (act) markSent(act, true);
    if (action === "send_pay_link") {
      state.paymentLinkId = (r.data && r.data.link && r.data.link.id) || null;
      savePaymentLink(state.paymentLinkId, selectedOfferKey());
    }
    if (action === "log_disposition") {
      try { localStorage.removeItem(paymentStoreKey); } catch (e) {}
    }
    if (action === "send_soft_pull") toast("Soft pull emailed — pay link + approval form.");
    else if (action === "send_pay_link") toast("Pay link sent.");
    else toast("Disposition written to contact record.");
  }

  /* Row 9: the $1,000 credit optimization link for a funding-plus-repair
     file, sent beside the $3,000 deposit link. The body is the one the call
     cockpit's pay panel posts (closer-call.js wirePayLink): same action, same
     endpoint. It does not replace the deposit link this deck remembers for the
     disposition. */
  async function sendOptimizeLink() {
    if (!window.FHData || !contactId) { toast("No contact on this deck."); return; }
    markSending("pay-optimize");
    var r = await window.FHData.write("/api/closer-deck", {
      action: "send_pay_link",
      client_id: contactId,
      offer_key: "REPAIR_DFY",
      sale_motion: null
    });
    if (!r || !r.ok) {
      markSent("pay-optimize", false);
      toast((r && r.error && (r.error.message || r.error)) || "Could not send the credit optimization pay link.");
      return;
    }
    markSent("pay-optimize", true);
    toast("Credit optimization pay link sent.");
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
    /* The course is off (COURSE_LIVE): its route and rungs do nothing, even from a stray click. */
    if (!COURSE_LIVE && (a === "edu" || a === "desc:eduTop" || a === "desc:eduLow")) return;
    if (a === "back") { go(-1); return; }
    if (a === "next") { go(1); return; }
    if (a === "edu") { state.edu = true; state.rung = 0; render(); return; }
    if (a.indexOf("tier:") === 0) { setTier(a.slice(5)); return; }
    if (a.indexOf("rung:") === 0) { state.rung = Number(a.slice(5)); render(); return; }
    if (a.indexOf("temp:") === 0) { state.temp = Number(a.slice(5)); render(); return; }
    if (a.indexOf("check:") === 0) { var k = a.slice(6); state.checks[k] = !state.checks[k]; render(); return; }
    if (a.indexOf("phase:") === 0) {
      var p = a.slice(6);
      /* 8, Money, has no slide: it opens the money steps and the client's screen stays put. */
      if (p === "08") { state.obj = null; state.showRef = false; state.showMoney = true; render(); return; }
      var at = firstOfPhase(p);
      if (at < 0) return;
      if (isStackCode(DECK[at].code)) enterStack(DECK[at].code); else jumpTo(DECK[at].code);
      return;
    }
    if (a === "money-back") { state.showMoney = false; render(); return; }
    if (a === "money-pay") { jumpTo("S-23"); return; }
    if (a === "show-proof") { state.showRevenue = false; render(); return; }
    if (a === "show-revenue") { state.showRevenue = true; render(); return; }
    if (a === "stack-open") { enterStack("B-01"); return; }
    if (a === "stack-leave") { leaveStack(); return; }
    if (a === "stack-reset") { state.stackPick = {}; render(); return; }
    if (a === "stack-close") { closeBlueprint(); return; }
    if (a.indexOf("stack-go:") === 0) { jumpTo(a.slice(9)); return; }
    if (a.indexOf("stack:") === 0) { toggleStack(a.slice(6)); return; }
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
    if (a === "pay") { fire("send_pay_link", null, "pay"); return; }
    if (a === "pay-optimize") { sendOptimizeLink(); return; }
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
    /* Most expensive first (row 2). Only at boot: a later refresh keeps the
       closer's own pick. */
    state.rung = leadRung();
    state.loaded = true;
    render();
    loadSharedContext();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
