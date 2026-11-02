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

/** This harness omits the lender-wall visual; the other new slots draw in its fixture. */
const NEW_VISUAL_ONLY = ["F-02"];
export const DECK_LENGTH = SLIDES.length - NEW_VISUAL_ONLY.length;

/** Where a slide sits in the deck as the cockpit header counts it: "<position> / 34". */
export const positionOf = (code) => SLIDES.filter(([c]) => c !== "F-02").findIndex(([c]) => c === code) + 1;

/** Slides that show only when their visual draws. */
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
  ["04", "4 Your file", ["S-07", "F-01", "L-01", "F-02"]],
  ["05", "5 Your path", ["S-08"]],
  ["06", "6 The plan", ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06", "S-09", "S-10", "S-11", "S-12", "S-13", "S-14", "S-15", "S-16", "P-01", "C-01"]],
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
    title: "Think about it", jumpLabel: "Show the path", target: "S-08",
    lines: [
      "Of course. What part needs thought: the plan, what it costs, the work on your side, or whether you trust us?",
      "What do you still need to see to make a clear decision?",
      "Let's answer that part. If you still need time, we'll set a real follow-up.",
    ],
  },
  {
    title: "$3K is a lot", jumpLabel: "Show the math", target: "S-20",
    lines: [
      "I hear you. Is the price outside your budget, or do you need to see why the work is worth it?",
      "The $3,000 deposit counts once toward the success fee. The agreement uses confirmed approved limits or amounts, including credit you do not draw.",
      "Let's read the full fee and the work together. Does this fit your plan and budget?",
    ],
  },
  {
    title: "What if it fails", jumpLabel: "Show the agreement", target: "S-21",
    lines: [
      "The lender decides approval. Here is the work Fundhub commits to in writing.",
      "An advisor starts your file within 24 business hours, and your first authorized applications go out within 72 business hours.",
      "If we miss either deadline, you can request the deposit back. If no funding is secured, no back-end success fee is due. What part still worries you?",
    ],
  },
  {
    title: "Spouse", jumpLabel: "Show the path", target: "S-08",
    lines: [
      "That makes sense. Do you want their input, or do you need a joint decision?",
      "What will they want to know about the plan or price? Let's answer that now.",
      "Let's set a time when both of you can see the file and ask questions together.",
    ],
  },
  {
    title: "Burned before", jumpLabel: "Show the work", target: "S-10",
    lines: [
      "What happened with the last company? I'll hear the whole story.",
      "Here is your file, the work we propose, and the agreement with the price and service steps.",
      "Here is where you will see the work and reach the team. Which part do you want me to show again?",
    ],
  },
  {
    title: "DIY", jumpLabel: "Show the work", target: "S-12",
    lines: [
      "You can do this yourself. Which part would you handle, and what brought you here for help?",
      "For funding, our fee pays for bank research, application order, authorized submissions and follow-up. For credit optimization, we build and track the rounds from your file.",
      "The Blueprint is the guided plan if you want to run the steps yourself. Which level of help fits you?",
    ],
  },
].map((row) => Object.freeze({ ...row, lines: Object.freeze(row.lines) })));

/** The slides that show the objection list: every slide of 7 The ask and 9 Paperwork, and nothing else. */
export const OBJECTION_SLIDES = Object.freeze(SLIDES.filter(([, phase]) => phase === "7 The ask" || phase === "9 Paperwork").map(([code]) => code));
