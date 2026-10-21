// Batch 11, repair cycle 2: every class quiz on the Company Brain screen, every question, both ways.
//
// A practice test, not a live check. The quiz is scored in the browser (public/app/ramp-quizzes.js) and
// nothing is saved, so the only way to know a wrong answer key cannot slip through is to answer every
// question of every quiz, once right and once wrong, in the real page.
//
// The answers below are written from the trainer keys in the four class packs, NOT read out of the
// quiz data:
//   docs/sops/company-resources/ramp-closer-2026-08-24.md
//   docs/sops/company-resources/ramp-funding-advisor-2026-08-24.md
//   docs/sops/company-resources/ramp-inquiry-2026-08-24.md
//   docs/sops/company-resources/ramp-repair-2026-08-24.md
// so a key in the code that drifts from the pack turns a right answer Wrong.
//
// For each of the 20 quizzes the test presses Check answers for:
//   * every question right                   -> every mark "Right", the pass words or the score line
//   * every question wrong                   -> every mark "Wrong", 0 right
//   * every box empty                        -> every mark "Write an answer."
//   * each question wrong with the rest right -> exactly that mark "Wrong", and a Day 5 quiz fails
// and then a list of tricky answers that each break one rule of the scorer.

import { test } from "node:test";
import assert from "node:assert/strict";

import { clearShellOverlays, OWNER, sharedScreens, waitFor } from "./fin-b11-kit.mjs";

const { open } = sharedScreens();

// id: [title, mustMissZero, [[question, [right...], [wrong...]], ...]]
const PACK = {
  "closer-d1": ["Closer · Day 1", false, [
    ["Are we the bank?", ["No. Lenders decide.", "No"], ["Yes, we are the bank"]],
    ["Do they need an LLC first?", ["No, no business is required"], ["Yes they need an LLC first"]],
    ["What is the $32 for?", ["A soft look at the real credit file"], ["It is the funding start fee", "A soft pull"]],
    ["Name four things you mark on a report.", ["Late payments, full cards, inquiries and bad marks"], ["Late payments and inquiries", "The score"]]
  ]],
  "closer-d2": ["Closer · Day 2", false, [
    ["Is the $3,000 extra on top of the 10%?", ["No. It counts toward the 10%."], ["Yes, it is extra on top"]],
    ["Can they put the funding start on Commas?", ["No, the start is cash"], ["Yes, put it on Commas"]],
    ["What two things can finance?", ["The UnderwriteIQ pack and Funding Mastery"], ["Funding and repair", "The UnderwriteIQ pack only"]],
    ["What does deposit logged mean in one line?", ["They paid the start, they are a client, and you hand off."], ["It means the call is booked", "They paid the start"]]
  ]],
  "closer-d3": ["Closer · Day 3", false, [
    ["Client: So you will get me the money? What do you say?", ["We help you apply. Lenders decide. I cannot promise a yes."], ["Yes, I will get you the money", "Lenders decide"]],
    ["Client: Will my score go up? What do you say?", ["We do not promise score moves."], ["Yes, your score will go up", "I do not promise anything, but your score will go up"]],
    ["When do you stop and get a manager?", ["A refund goes to the manager."], ["When the client is angry", "Manager only"]]
  ]],
  "closer-d4": ["Closer · Day 4", false, [
    ["Who runs the first working call after pay?", ["The funding advisor"], ["The closer"]],
    ["How many rounds do we teach as shape?", ["About 3 to 4 rounds"], ["Two rounds", "Nine rounds"]],
    ["May you promise a fund date?", ["No, never promise a fund date"], ["Yes, you may promise a fund date"]]
  ]],
  "closer-d5": ["Closer · Day 5 (must miss zero)", true, [
    ["What is funding here?", ["We help them apply. We are not the bank. Lenders decide."], ["We give them the cash", "We are the bank"]],
    ["Why does $32 exist?", ["It pays for a soft look at the file"], ["It is the funding start"]],
    ["Who hears funding vs a course vs cash downsell?", ["700 and up hear funding, 500 and up a course, and the rest a cash downsell"], ["Everyone hears funding", "700 hears funding"]],
    ["How do the start and the 10% fit?", ["The start counts toward the 10%"], ["The start is extra on top"]],
    ["Name three things you never promise.", ["Never promise a score, a yes, or a dollar amount"], ["Never promise a score", "Nothing"]]
  ]],
  "fa-d1": ["Funding advisor · Day 1", false, [
    ["Did they already pay the start? What does that make them?", ["Yes. They are a client."], ["No, they are a lead"]],
    ["Are we the lender?", ["Lenders decide and we help apply"], ["Yes, we are the lender"]],
    ["Do they need a business?", ["No"], ["Yes, they need a business"]]
  ]],
  "fa-d2": ["Funding advisor · Day 2", false, [
    ["What holds a new funding file?", ["Missing documents hold it"], ["The closer", "Documents"]],
    ["Where do tasks live?", ["In the Fundhub portal file"], ["In Slack", "In Alec's Notion"]],
    ["May you start rounds before docs are accepted?", ["No"], ["Yes you may start rounds"]]
  ]],
  "fa-d3": ["Funding advisor · Day 3", false, [
    ["Who wipes inquiries?", ["The inquiry specialist"], ["The closer"]],
    ["Who runs repair?", ["The repair specialist"], ["The closer"]],
    ["What do you say about wait time?", ["An honest expedited wait, no overnight, no score promise"], ["It will be overnight", "Expedited"]]
  ]],
  "fa-d4": ["Funding advisor · Day 4", false, [
    ["Why not spray every lender at once?", ["Too many inquiries add heat, so we plan rounds"], ["It is faster"]],
    ["When does inquiry work usually sit?", ["Between rounds"], ["During a round"]],
    ["May you promise which card they will get?", ["No"], ["Yes, you can promise a card"]]
  ]],
  "fa-d5": ["Funding advisor · Day 5 (must miss zero)", true, [
    ["What is funding here?", ["Help apply on a plan; lenders decide"], ["We give them cash"]],
    ["How do start fee and 10% fit?", ["The start counts toward the 10% if they get funded"], ["The start is extra"]],
    ["What is the file clock?", ["About 15 days healthy, 30 hard stop"], ["60 days and 60 more"]],
    ["When do you hand inquiry vs repair?", ["Inquiries are hard looks for the inquiry seat; repair is lates and bad marks"], ["The closer does both"]],
    ["What do you never promise on the start call?", ["Score up, sure fund, set dollar, overnight mail"], ["Nothing"]]
  ]],
  "inq-d1": ["Inquiry · Day 1", false, [
    ["What is an inquiry in plain words?", ["A hard look a lender made"], ["A payment"]],
    ["What two things do you mark first on a report?", ["Inquiries and personal info errors"], ["Late payments"]],
    ["Do you promise the next round will fund?", ["No"], ["Yes, the next round will fund", "No, we will get you funded"]]
  ]],
  "inq-d2": ["Inquiry · Day 2", false, [
    ["What does the side menu say?", ["Specialist"], ["Closer dashboard"]],
    ["Which toggle is yours?", ["Inquiries"], ["Repair"]],
    ["May you send without a click?", ["No, sending takes a click"], ["Yes, send without a click"]]
  ]],
  "inq-d3": ["Inquiry · Day 3", false, [
    ["When do you usually wipe — during a round or between?", ["Between rounds"], ["During a round"]],
    ["What if you are not sure leave vs wipe?", ["Ask a manager and write it down"], ["Wipe it anyway", "Ask"]],
    ["Is there a monthly wipe count?", ["No monthly count"], ["Yes there is a monthly count"]]
  ]],
  "inq-d4": ["Inquiry · Day 4", false, [
    ["Who preps the file?", ["The funding advisor"], ["The closer"]],
    ["Who funds / runs rounds?", ["The funding advisor"], ["The closer"]],
    ["What is your clock?", ["About 15 days, hard stop 30"], ["60 days"]]
  ]],
  "inq-d5": ["Inquiry · Day 5 (must miss zero)", true, [
    ["Where do you sit in the CRM?", ["Specialist, then Inquiries"], ["Closer dashboard"]],
    ["When do you wipe vs leave?", ["Between rounds; ask a manager if unsure"], ["During a round"]],
    ["What is the file clock?", ["15 healthy, 30 hard stop"], ["90 days"]],
    ["What do you never tell a client?", ["Score up and sure funding"], ["Their name"]],
    ["What is blocked on your mock file today?", ["The dummy has a blocked item"], ["It is a clear file, all good", "Nothing blocked, it is a clear file"]]
  ]],
  "repair-d1": ["Repair · Day 1", false, [
    ["What do you never promise about a mark?", ["That it will come off"], ["That it is a lender"]],
    ["What do you never promise about a score?", ["That it will go up"], ["The late payments"]],
    ["Are you the closer?", ["No"], ["Yes, I am the closer"]]
  ]],
  "repair-d2": ["Repair · Day 2", false, [
    ["What does the side menu say?", ["Specialist"], ["Dashboard"]],
    ["Which toggle is yours?", ["Repair"], ["Inquiries"]],
    ["What if the Repair list is empty?", ["It is empty, and that is real. Do not invent rows."], ["Make up a few rows", "It is empty"]]
  ]],
  "repair-d3": ["Repair · Day 3", false, [
    ["Overnight?", ["No. Expedited US mail."], ["Yes overnight"]],
    ["May you use Alec's 5-day knockout as our promise?", ["No. Reference only."], ["Yes, use it as our promise"]],
    ["What do you say about wait?", ["An honest wait. No score line."], ["It will be fast, five days guaranteed"]]
  ]],
  "repair-d4": ["Repair · Day 4", false, [
    ["Who gets the file after repair work?", ["The funding advisor"], ["The closer"]],
    ["Do you run the first card app?", ["No"], ["Yes, I run the first card app"]],
    ["What goes in the hand-back note?", ["What I worked, what is still open, no outcome promise"], ["The score went up", "What I worked"]]
  ]],
  "repair-d5": ["Repair · Day 5 (must miss zero)", true, [
    ["Name three banned lines.", ["Score up, the mark will come off, we will get you funded"], ["Free coffee"]],
    ["How do we mail?", ["Expedited US mail"], ["Overnight UPS"]],
    ["When does Send letters show?", ["Send letters shows when a letter body is ready"], ["Always"]],
    ["What is the file clock?", ["15 healthy, 30 hard stop"], ["60 days"]],
    ["Who do you ping when a bureau answer needs a person?", ["The manager, the stuck path on the Specialist desk"], ["The client"]]
  ]]
};
const IDS = Object.keys(PACK);

// The roles the quiz list is built for (quizzesForRole), and who sees what.
const CLOSER_DAYS = IDS.filter((id) => id.startsWith("closer-"));
const BY_ROLE = {
  closer: CLOSER_DAYS,
  CLOSER: CLOSER_DAYS,
  funding_advisor: IDS.filter((id) => id.startsWith("fa-")),
  inquiry_specialist: IDS.filter((id) => id.startsWith("inq-") || id.startsWith("repair-")),
  owner: IDS, admin: IDS, "": IDS, sales_manager: IDS, partner: IDS
};

async function openQuizPage(session = OWNER) {
  const opened = await open("/app/company-brain.html", {
    session,
    handlers: {
      "/api/company-brain/threads": { ok: true, threads: [] },
      "/api/company-brain/upload": { ok: true, uploads: [], pendingCount: 0 },
      "/api/company-brain/reviews": { ok: true, reviews: [] }
    }
  });
  await waitFor(async () => (await opened.page.locator("#quizPick option").count()) > 0, "the quiz list");
  await clearShellOverlays(opened.page);
  await opened.page.locator("#docsBtn").click();
  return opened;
}

/** Fill the boxes (missing answers stay empty), press Check answers, and read the marks and the line. */
async function press(page, answers) {
  const boxes = await page.locator("#quizBox textarea").count();
  for (let i = 0; i < boxes; i += 1) await page.locator(`#qa-${i}`).fill(answers[i] ?? "");
  await page.locator("#quizForm button[type=submit]").click();
  await waitFor(async () => (await page.locator("#qm-0").innerText()) !== "", "marks painted");
  const marks = [];
  for (let i = 0; i < boxes; i += 1) marks.push(await page.locator(`#qm-${i}`).innerText());
  return { marks, line: await page.locator("#quizResult").innerText(), classes: await page.locator("#quizBox .qmark").evaluateAll((els) => els.map((e) => e.className)) };
}

const lineFor = (mustMissZero, right, total) => (mustMissZero
  ? (right === total ? `Pass. You got every question right (${total} of ${total}).` : `Fail. Day 5 must miss zero. You got ${right} of ${total} right.`)
  : `You got ${right} of ${total} right.`);

test("the picker offers exactly these twenty quizzes, and each has one box per question", { timeout: 120_000 }, async () => {
  const { page, errors } = await openQuizPage();
  assert.deepEqual(errors, []);
  const options = await page.locator("#quizPick option").evaluateAll((els) => els.map((e) => [e.value, e.textContent]));
  assert.deepEqual(options, IDS.map((id) => [id, PACK[id][0]]), "the owner is offered every seat's five days, in order, under these titles");
  for (const id of IDS) {
    await page.locator("#quizPick").selectOption(id);
    assert.equal(await page.locator("#quizBox textarea").count(), PACK[id][2].length, `${id}: one box per question`);
    const labels = await page.locator("#quizBox label").allInnerTexts();
    assert.equal(labels.length, PACK[id][2].length);
    labels.forEach((text, i) => assert.ok(text.startsWith(`${i + 1}. `), `${id} question ${i + 1} is numbered`));
  }
  await page.close();
});

test("quizzesForRole gives each seat its own days and everyone else all twenty", { timeout: 60_000 }, async () => {
  const { page } = await openQuizPage();
  for (const [role, expected] of Object.entries(BY_ROLE)) {
    const got = await page.evaluate((r) => window.quizzesForRole(r).map((q) => q.id), role);
    assert.deepEqual(got, expected, `role "${role}"`);
  }
  assert.deepEqual(await page.evaluate(() => window.quizzesForRole(undefined).length), 20);
  assert.deepEqual(await page.evaluate(() => window.quizzesForRole(null).length), 20);
  assert.equal(await page.evaluate(() => window.FH_RAMP_QUIZZES.length), 20);
  // A Day 5 quiz is the only kind that must miss zero.
  const flags = await page.evaluate(() => window.FH_RAMP_QUIZZES.map((q) => [q.id, q.mustMissZero]));
  assert.deepEqual(flags, IDS.map((id) => [id, PACK[id][1]]));
  await page.close();
});

test("every question of every quiz: right is Right, wrong is Wrong, empty asks for an answer, and Day 5 must miss zero", { timeout: 300_000 }, async () => {
  const { page } = await openQuizPage();
  for (const id of IDS) {
    const [, mustMissZero, questions] = PACK[id];
    const total = questions.length;
    await page.locator("#quizPick").selectOption(id);

    // Every question right.
    const right = await press(page, questions.map((q) => q[1][0]));
    assert.deepEqual(right.marks, Array(total).fill("Right"), `${id}: all right`);
    assert.equal(right.line, lineFor(mustMissZero, total, total), `${id}: all-right line`);
    assert.ok(right.classes.every((c) => c === "qmark mono qok"), `${id}: right marks are drawn as right`);

    // Every other right wording is Right too.
    questions.forEach((q) => assert.ok(q[1].length >= 1));
    for (let i = 0; i < total; i += 1) {
      for (const [k, wording] of questions[i][1].entries()) {
        if (k === 0) continue;
        const answers = questions.map((q) => q[1][0]);
        answers[i] = wording;
        const out = await press(page, answers);
        assert.equal(out.marks[i], "Right", `${id} question ${i + 1}: "${wording}"`);
      }
    }

    // Every question wrong.
    for (let k = 0; k < Math.max(...questions.map((q) => q[2].length)); k += 1) {
      const out = await press(page, questions.map((q) => q[2][k % q[2].length]));
      assert.deepEqual(out.marks, Array(total).fill("Wrong"), `${id}: all wrong (variant ${k})`);
      assert.equal(out.line, lineFor(mustMissZero, 0, total), `${id}: all-wrong line`);
      assert.ok(out.classes.every((c) => c === "qmark mono qbad"));
    }

    // Every box empty.
    const empty = await press(page, []);
    assert.deepEqual(empty.marks, Array(total).fill("Write an answer."), `${id}: empty`);
    assert.equal(empty.line, lineFor(mustMissZero, 0, total));

    // Each question wrong on its own, each of its wrong wordings, with every other question right.
    for (let i = 0; i < total; i += 1) {
      for (const wording of questions[i][2]) {
        const answers = questions.map((q) => q[1][0]);
        answers[i] = wording;
        const out = await press(page, answers);
        const expected = questions.map((_, j) => (j === i ? "Wrong" : "Right"));
        assert.deepEqual(out.marks, expected, `${id} question ${i + 1} wrong ("${wording}") and the rest right`);
        assert.equal(out.line, lineFor(mustMissZero, total - 1, total), `${id}: one wrong answer`);
        if (mustMissZero) assert.match(out.line, /^Fail\. Day 5 must miss zero\./, `${id}: a Day 5 quiz with one miss fails`);
      }
    }
  }
  await page.close();
});

// One rule of the scorer each: the answers that break it. [quiz, question number, answer, mark].
const TRICKY = [
  // a yes/no answer is a whole word, never a piece of one
  ["closer-d1", 1, "Nothing", "Wrong"],
  ["closer-d1", 1, "I know the answer", "Wrong"],
  ["closer-d1", 1, "No, we are not the bank, and that was yesterday's question", "Right"],
  ["fa-d1", 3, "A notion of a business", "Wrong"],
  // "yes and no together" is not a no
  ["closer-d1", 1, "yes and no", "Wrong"],
  ["closer-d2", 2, "No, well yes", "Wrong"],
  // "never" counts as a no
  ["closer-d4", 3, "Never", "Right"],
  ["closer-d4", 3, "never ever", "Right"],
  ["closer-d2", 1, "Never, it counts toward the 10%", "Right"],
  // capitals, word order and punctuation do not matter
  ["closer-d1", 3, "A SOFT look at the file!", "Right"],
  ["closer-d1", 3, "the CREDIT file, a soft one", "Right"],
  // a partial answer is not enough: every part is needed
  ["closer-d1", 3, "soft", "Wrong"],
  ["closer-d1", 3, "the file", "Wrong"],
  ["closer-d4", 2, "3", "Wrong"],
  ["closer-d4", 2, "4", "Wrong"],
  ["closer-d4", 2, "3-4", "Right"],
  ["fa-d5", 3, "15", "Wrong"],
  ["fa-d5", 3, "30", "Wrong"],
  ["repair-d5", 4, "about 15, hard stop 30", "Right"],
  ["repair-d5", 4, "15", "Wrong"],
  ["closer-d5", 5, "score", "Wrong"],
  ["closer-d5", 5, "score and yes", "Wrong"],
  ["closer-d5", 5, "a score, a yes and an amount", "Right"],
  // "name four things": three of the five listed marks is enough, two is not
  ["closer-d1", 4, "lates, cards and inquiries", "Right"],
  ["closer-d1", 4, "lates, collections, personal info", "Right"],
  ["closer-d1", 4, "lates and inquiries", "Wrong"],
  ["closer-d1", 4, "personal info", "Wrong"],
  ["closer-d1", 4, "lates, utilization, inquiries, collections, personal info", "Right"],
  // percent signs and apostrophes survive the tidy-up
  ["closer-d3", 3, "refund 10%", "Right"],
  ["closer-d3", 3, "refund 5%", "Right"],
  ["closer-d3", 3, "refund", "Wrong"],
  ["closer-d3", 3, "10%", "Wrong"],
  ["closer-d3", 2, "We don't promise a score change", "Right"],
  ["closer-d3", 2, "We don’t promise a score change", "Right"],
  // a banned phrase fails an answer that would otherwise match
  ["closer-d3", 2, "We do not promise, but yes", "Wrong"],
  ["closer-d3", 2, "I do not promise, but your score will go up", "Wrong"],
  ["inq-d1", 3, "No, we will get you funded", "Wrong"],
  ["inq-d1", 3, "No", "Right"],
  ["inq-d5", 5, "Nothing blocked, a clear file", "Wrong"],
  ["inq-d5", 5, "It is blocked, all good otherwise", "Wrong"],
  ["inq-d5", 5, "The dummy is stuck on a missing letter", "Right"]
];

test("each rule of the scorer, one tricky answer at a time", { timeout: 120_000 }, async () => {
  const { page } = await openQuizPage();
  let current = "";
  for (const [id, number, answer, want] of TRICKY) {
    if (id !== current) { await page.locator("#quizPick").selectOption(id); current = id; }
    const [, , questions] = PACK[id];
    const answers = questions.map((q) => q[1][0]);
    answers[number - 1] = answer;
    const out = await press(page, answers);
    assert.equal(out.marks[number - 1], want, `${id} question ${number}: "${answer}"`);
    // The other questions, answered right, stay right.
    out.marks.forEach((mark, i) => { if (i !== number - 1) assert.equal(mark, "Right", `${id} question ${i + 1} is unaffected`); });
  }
  await page.close();
});

test("scoring a quiz sends and saves nothing", { timeout: 60_000 }, async () => {
  const { page } = await openQuizPage();
  const sent = [];
  page.on("request", (req) => { if (req.method() !== "GET") sent.push(`${req.method()} ${req.url()}`); });
  await page.locator("#quizPick").selectOption("closer-d5");
  await press(page, PACK["closer-d5"][2].map((q) => q[1][0]));
  await press(page, []);
  assert.deepEqual(sent, []);
  await page.close();
});
