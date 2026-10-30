// Batch 17 (repair cycle 1): the words and the shape the Present deck practice tests hold the page to.
//
// Every value here is typed in by hand, on purpose. A test that read these out of public/app/present.js
// would pass whatever the page said. The page is the thing being judged; this file is the answer key.
// Nothing here is imported by the live bundle.

/** Every slide of the deck, in deck order, with the phase name the cockpit header and the strip must show.
 *  The order is the call script's (ops/workflows/weekend-2026-10-24.md section 10.0, 2026-10-29): the
 *  Blueprint (B-01..B-06) is Door 3 inside part 6. F-01, L-01 and F-02 show the file after S-07;
 *  S-16 holds client proof, P-01 shows the next funding sequence, and C-01 shows companies. */
export const SLIDES = Object.freeze([
  ["S-01", "1 Open"], ["S-02", "1 Open"],
  ["S-03", "2 Your goal"], ["S-04", "2 Your goal"],
  ["S-05", "3 The pull"], ["S-06", "3 The pull"],
  ["S-07", "4 Your file"], ["F-01", "4 Your file"], ["L-01", "4 Your file"], ["F-02", "4 Your file"],
  ["S-08", "5 Your path"],
  ["B-01", "6 The plan"], ["B-02", "6 The plan"], ["B-03", "6 The plan"], ["B-04", "6 The plan"],
  ["B-05", "6 The plan"], ["B-06", "6 The plan"],
  ["S-09", "6 The plan"], ["S-10", "6 The plan"], ["S-11", "6 The plan"], ["S-12", "6 The plan"],
  ["S-13", "6 The plan"], ["S-14", "6 The plan"], ["S-15", "6 The plan"], ["S-16", "6 The plan"], ["P-01", "6 The plan"],
  ["C-01", "6 The plan"],
  ["S-17", "7 The ask"], ["S-18", "7 The ask"], ["S-19", "7 The ask"], ["S-20", "7 The ask"],
  ["S-21", "7 The ask"], ["S-22", "7 The ask"],
  ["S-23", "9 Paperwork"], ["S-24", "9 Paperwork"],
].map((pair) => Object.freeze(pair)));

/** The legacy practice harness loads no new framework visuals and counts those three slots out. */
const NEW_VISUAL_ONLY = ["F-01", "F-02", "P-01"];
export const DECK_LENGTH = SLIDES.length - NEW_VISUAL_ONLY.length;

/** Position in the no-visual practice harness. The live visual proof uses all 35 slots. */
export const positionOf = (code) => SLIDES.filter(([c]) => !NEW_VISUAL_ONLY.includes(c)).findIndex(([c]) => c === code) + 1;

/** Slides that show only when their visual draws. The practice tests load no visual file, so a
 *  walker steps over them. */
export const VISUAL_ONLY = Object.freeze(["F-01", "L-01", "F-02", "P-01", "C-01"]);

/** The slides a funding walker meets: Blueprint and visual-only slides are stepped over. */
export const MAIN_RUN = SLIDES.filter(([code]) => !code.startsWith("B-") && !VISUAL_ONLY.includes(code)).map(([code]) => code);
export const STACK_RUN = SLIDES.filter(([code]) => code.startsWith("B-")).map(([code]) => code);
/** The slides a repair walker meets: Door 3 (B-01..B-04) inside part 6, then Door 4 from S-09. B-05 and B-06
 *  stay out of the walk until FinanceOS has a price and a checkout. */
export const REPAIR_RUN = SLIDES.filter(([code]) => !VISUAL_ONLY.includes(code) && code !== "B-05" && code !== "B-06").map(([code]) => code);

/** The nine strip buttons: the number on the button, the name it shows, and the slides that belong to it.
 *  The strip shows the script's part names (row 19). 08, Money, has no slide: it opens the money steps. */
export const PHASE_BUTTONS = Object.freeze([
  ["01", "1 Open", ["S-01", "S-02"]],
  ["02", "2 Your goal", ["S-03", "S-04"]],
  ["03", "3 The pull", ["S-05", "S-06"]],
  ["04", "4 Your file", ["S-07", "L-01"]],
  ["05", "5 Your path", ["S-08"]],
  ["06", "6 The plan", ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06", "S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16", "C-01"]],
  ["07", "7 The ask", ["S-17", "S-18", "S-19", "S-20", "S-21", "S-22"]],
  ["08", "8 Money", []],
  ["09", "9 Paperwork", ["S-23", "S-24"]],
].map((row) => Object.freeze(row)));

/** The catalog (fin-b17-rows.json, desks-f.json, generated.json) still lists the seven strip buttons the deck had
 *  before 2026-10-29, by number. A row is the button with that number; its old part name in the row text is
 *  history. Buttons 08 and 09 are new and have no catalog row yet. */
export const CATALOG_PHASE_ROWS = Object.freeze(["01", "02", "03", "04", "05", "06", "07"]);

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
      "Context: you just saw how much your file qualifies for: [Amount]. The $3,000 counts toward the 10 percent, and the 10 percent is only on money you actually get. Too much compared to what? You told me waiting costs you [cost] a month.",
    ],
  },
  {
    title: "What if it fails", jumpLabel: "Show guarantees", target: "S-21",
    lines: [
      "We ran the soft pull together. You saw your file with your own eyes. We're not guessing.",
      "Our fee is 10 percent of the money you actually get. The bank decides, not us. We pick the banks and the order.",
      "Here's what the agreement guarantees: we start on your file within 24 business hours, and your first applications go out within 72. So what specifically are you worried won't work?",
    ],
  },
  {
    title: "Spouse", jumpLabel: "Show guarantees", target: "S-21",
    lines: [
      "Aside from letting your spouse know, anything else keeping you from 100 percent?",
      "Respect vs permission: doing it regardless and letting them know? Or need their sign-off?",
      "If respect: 'this company wants $3K, thoughts?' versus 'I found the company that pulled my file and showed me exactly what to do next. I've decided, and I wanted you to know first.' Which one gets them on board? If permission: book the 3-way, inside one day.",
    ],
  },
  {
    title: "Burned before", jumpLabel: "Show the system", target: "S-10",
    lines: [
      "I'm sorry that happened. What exactly went wrong with the last company? Listen.",
      "That's way too common. It's fair to go slow. That's why we started with your file, not a pitch.",
      "You see the fee in dollars before you pay, and everything is in the agreement, in writing. And the 10 percent is only on money you actually get.",
    ],
  },
  {
    title: "DIY", jumpLabel: "Show the rounds", target: "S-12",
    lines: [
      "You absolutely can. How long have you been trying? And how much capital have you secured in that time?",
      "Almost every application is a hard pull, and each one costs fundability. Our system matches your file to the banks that fit it, in the right order.",
      "If you want to do it yourself the right way, that's the Capital Blueprint: the plan from your own file, step by step.",
    ],
  },
].map((row) => Object.freeze({ ...row, lines: Object.freeze(row.lines) })));

/** The slides that show the objection list: every slide of 7 The ask and 9 Paperwork, and nothing else. */
export const OBJECTION_SLIDES = Object.freeze(SLIDES.filter(([, phase]) => phase === "7 The ask" || phase === "9 Paperwork").map(([code]) => code));
