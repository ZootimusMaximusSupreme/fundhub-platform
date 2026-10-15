// Batch 17 (repair cycle 1): the words and the shape the Present deck practice tests hold the page to.
//
// Every value here is typed in by hand, on purpose. A test that read these out of public/app/present.js
// would pass whatever the page said. The page is the thing being judged; this file is the answer key.
// Nothing here is imported by the live bundle.

/** Every slide of the deck, in deck order, with the phase name the cockpit header and the strip must show. */
export const SLIDES = Object.freeze([
  ["S-01", "01 Intro"], ["S-02", "01 Intro"],
  ["S-03", "02 Discovery"], ["S-04", "02 Discovery"],
  ["S-05", "03 Soft pull"], ["S-06", "03 Soft pull"], ["S-07", "03 Soft pull"],
  ["S-08", "04 Pitch"], ["S-09", "04 Pitch"], ["S-10", "04 Pitch"], ["S-11", "04 Pitch"], ["S-12", "04 Pitch"],
  ["S-13", "04 Pitch"], ["S-14", "04 Pitch"], ["S-15", "04 Pitch"], ["S-16", "04 Pitch"],
  ["S-17", "05 Commit"], ["S-18", "05 Commit"], ["S-19", "05 Commit"], ["S-20", "05 Commit"],
  ["S-21", "05 Commit"], ["S-22", "05 Commit"],
  ["B-01", "06 Blueprint"], ["B-02", "06 Blueprint"], ["B-03", "06 Blueprint"], ["B-04", "06 Blueprint"],
  ["B-05", "06 Blueprint"], ["B-06", "06 Blueprint"],
  ["S-23", "07 Close"], ["S-24", "07 Close"],
].map((pair) => Object.freeze(pair)));

export const DECK_LENGTH = SLIDES.length;

/** Where a slide sits in the deck as the cockpit header counts it: "<position> / 30". */
export const positionOf = (code) => SLIDES.findIndex(([c]) => c === code) + 1;

/** The slides a main-run walker meets: the six Blueprint slides are stepped over. */
export const MAIN_RUN = SLIDES.filter(([code]) => !code.startsWith("B-")).map(([code]) => code);
export const STACK_RUN = SLIDES.filter(([code]) => code.startsWith("B-")).map(([code]) => code);

/** The seven strip buttons: the number on the button, the phase it opens, and the slides that belong to it. */
export const PHASE_BUTTONS = Object.freeze([
  ["01", "01 Intro", ["S-01", "S-02"]],
  ["02", "02 Discovery", ["S-03", "S-04"]],
  ["03", "03 Soft pull", ["S-05", "S-06", "S-07"]],
  ["04", "04 Pitch", ["S-08", "S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16"]],
  ["05", "05 Commit", ["S-17", "S-18", "S-19", "S-20", "S-21", "S-22"]],
  ["06", "06 Blueprint", ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"]],
  ["07", "07 Close", ["S-23", "S-24"]],
].map((row) => Object.freeze(row)));

/** The seven belief boxes: the word on the box, and the question under it. */
export const BELIEFS = Object.freeze([
  ["Pain", "Biggest challenge right now? What's not working at the level it should be?"],
  ["Desire", "If capital wasn't an issue, what does the business look like in 6 to 12 months? Why that number?"],
  ["Doubt", "What are you currently doing to get funding? How's that been working out?"],
  ["Cost", "What is this costing you every month? Put a number on it."],
  ["Support", "Does your spouse know you're exploring funding options?"],
  ["Money", "If the pull comes back strong, are you ready to move now, or still researching?"],
  ["Trust", "Worked with any other funding companies before? How did that go?"],
].map((row) => Object.freeze(row)));

/** The six objections: button words, the slide the jump button goes to and what it says, and the three lines to say. */
export const OBJECTION_TABLE = Object.freeze([
  {
    title: "Think about it", jumpLabel: "Show the process", target: "S-08",
    lines: [
      "I want you to make the best decision for your business. Can I ask, when you say you need to think about it, is it the process you're unsure about, or the $3,000 deposit?",
      "Isolate it. 'Think about it' is never the real objection.",
      "If they can't articulate it: you told me you're a 9 on the process, you need [Amount] for [goal], and this has held you back [X time]. What's really going on? Pause. Let them fill the silence.",
    ],
  },
  {
    title: "$3K is a lot", jumpLabel: "Show the math", target: "S-20",
    lines: [
      "Isolate: finances aside, anything else keeping you from being 100 percent certain?",
      "Should vs how: you're not in a SHOULD I place, you're in a HOW can I place. Right?",
      "Context: you just saw the system pre-approve you for [Amount]. The $3,000 is an advance on a fee you'd pay anyway. Is $3,000 a lot compared to [Amount] deployed in two weeks?",
    ],
  },
  {
    title: "What if it fails", jumpLabel: "Show guarantees", target: "S-21",
    lines: [
      "We ran the soft-pull together. You saw the pre-approval with your own eyes. We're not guessing.",
      "Our fee is 10 percent of what we actually secure. No funding, no money for us. Zero incentive to take you on unless we're certain.",
      "And if we don't hit your target, we keep working your file at no additional cost. So what specifically are you worried won't work?",
    ],
  },
  {
    title: "Spouse", jumpLabel: "Show guarantees", target: "S-21",
    lines: [
      "Aside from letting your spouse know, anything else keeping you from 100 percent?",
      "Respect vs permission: doing it regardless and letting them know? Or need their sign-off?",
      "If respect: 'this company wants $3K, thoughts?' versus 'I found the company getting us [Amount] in two weeks, I've decided, wanted you to know first.' Which one gets them on board? If permission: book the 3-way.",
    ],
  },
  {
    title: "Burned before", jumpLabel: "Show the system", target: "S-10",
    lines: [
      "I'm sorry that happened. What exactly went wrong with the last company? Listen.",
      "That's way too common, and it's exactly why we built Fundhub this way. Most companies are manual, guessing, no score protection, no accountability.",
      "The question isn't whether to trust a funding company again. It's whether to trust THIS one: different process, hundreds funded, $25 million deployed.",
    ],
  },
  {
    title: "DIY", jumpLabel: "Show the rounds", target: "S-12",
    lines: [
      "You absolutely can. How long have you been trying? And how much capital have you secured in that time?",
      "Our clients get 2 to 3x more because of the AI matching and the sweeps between rounds. You'd need our lender network, our AI, and the sweep expertise.",
      "Is saving $3,000 worth another [X months] stuck? Or invest it today and have [Amount] in two weeks?",
    ],
  },
].map((row) => Object.freeze({ ...row, lines: Object.freeze(row.lines) })));

/** The slides that show the objection list: every slide of 05 Commit and 07 Close, and nothing else. */
export const OBJECTION_SLIDES = Object.freeze(SLIDES.filter(([, phase]) => phase === "05 Commit" || phase === "07 Close").map(([code]) => code));
