// Practice test (real page in Chromium, fake /api answers) for twenty Journeys editor controls in batch 14:
// the six journey tabs, picking a step, the + menu, the step fields, Move up / Move down / Delete, Make the
// change (step panel, ask box and the three example prompts), Keep it / Throw it away, Run from here, the
// Simulate tab, History (Roll back / Put it back), Undo, Save version, Discard, Test against the code and the
// Run report Close button.
//
// The expected words, counts and requests are worked out in this file from the fake data, not copied from
// the page. It reads no live data, calls no AI (the ask door is a fake answer), and sends nothing: the run
// and the simulator are judged for what they put on the wire, which is nothing beyond the one request each.
// Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, dialogs, json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b14-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

// ── the fake saved journeys (what GET /api/journeys answers) ──────────────────────────────────────────

const step = (id, type, title, cfg, extra = {}) => ({ id, type, title, cfg, touches: [], ...extra });

const QUESTION_TREE = [
  step("n1", "sms", "Text the survey link", { body: "Hi {{first_name}}, here is the survey: {{survey_link}} Reply STOP to opt out.", delay: "instant" }),
  step("n2", "condition", "Did they finish the survey", { field: "survey_complete", op: "is true" }, {
    branches: [
      { label: "Yes", nodes: [step("n3", "sms", "Text the booking link", { body: "Thanks {{first_name}}. Book here: {{booking_link}} Reply STOP to opt out.", delay: "instant" })] },
      { label: "No", nodes: [step("n4", "email", "Email a nudge", { subject: "Still there?", body: "We still have your spot.", delay: "instant" })] },
    ],
  }),
  step("n5", "wait", "Wait a day", { amount: "1", unit: "days" }),
  step("n6", "record", "Save a note", { note: "Survey handled." }),
];

const TREES = {
  client: { name: "Client", start: "A form is filled in", end: "A diagnostic is ready", desc: "What a business owner goes through.", nodes: QUESTION_TREE },
  setter: { name: "Setter", start: "A lead lands in the queue", end: "A call is booked", desc: "The first contact.", nodes: [
    step("n7", "agent", "Voice agent calls them", { agent: "Setter Josh", note: "Three tries in the first hour." }),
    step("n8", "stage", "Move them to Booked", { stage: "Booked", pipeline: "Sales" }),
  ] },
  closer: { name: "Closer", start: "A booked call is assigned", end: "The client is routed", desc: "Owns the call.", nodes: [
    step("n9", "record", "Load the pre-call panel", { note: "Survey answers and past talks." }),
  ] },
  advisor: { name: "Funding Advisor", start: "A qualified file lands", end: "The round is funded", desc: "Runs the capital rounds.", nodes: [
    step("n10", "record", "Open a round", { note: "Lender set from the match list." }),
    step("n11", "stage", "Submit the round", { stage: "Round Submitted", pipeline: "Funding: Card Stacking" }),
    step("n12", "wait", "Wait on decisions", { amount: "3", unit: "days" }),
  ] },
  affiliate: { name: "Affiliate", start: "An affiliate is approved", end: "A referral is credited", desc: "Sends leads under a link.", nodes: [
    step("n13", "email", "Send their link", { subject: "Your referral link", body: "Your tracked link.", delay: "instant" }),
  ] },
  partner: { name: "White-Label Partner", start: "A partner signs", end: "A partner is operating", desc: "Runs under their own brand.", nodes: [
    step("n14", "record", "Create the partner company", { note: "Isolated scope." }),
    step("n15", "agent", "Apply their brand", { agent: "Brand Studio", note: "Colors and domain." }),
  ] },
};

const KEYS = ["client", "setter", "closer", "advisor", "affiliate", "partner"];
const countSteps = (nodes) => nodes.reduce((n, node) => n + 1 + (node.branches || []).reduce((m, b) => m + countSteps(b.nodes), 0), 0);

const PATCH = {
  summary: "Added a follow-up text.",
  ops: [{ op: "insert", after: "n1", path: [], node: { type: "sms", title: "Follow up if they go quiet", cfg: { body: "Checking in {{first_name}}. Reply STOP to opt out.", delay: "after 2 hours" } } }],
};

const PATCH_UPDATE = {
  summary: "Made the wait two days.",
  ops: [{ op: "update", id: "n5", title: "Wait two days", cfg: { amount: "2", unit: "days" } }],
};

const RUN_ANSWER = {
  ok: true, runId: "run-test", journeySource: "database", journeysSkipped: [], startEventFindings: [], screensUnreadable: false,
  headline: "6 paths walked. One step is not wired.",
  summary: {
    walked: { paths: 6, clients: 5 },
    messages: { wouldHaveGoneOut: 9, pathsRefusedByFence: 0, blockedByGate: 0 },
    workflows: { fired: ["wf-a", "wf-b", "wf-c"], registered: 5, neverFired: [{ id: "wf-unused" }, { id: "wf-old" }] },
    findings: { broken: [{ journey: "client", nodeTitle: "Text the survey link", summary: "The text was never written." }], couldNotCheck: [] },
    screens: { touchedAndWired: ["pipeline.html"], touchedAndWireframe: [], touchedByNoJourney: ["hiring.html", "brand-studio.html"] },
  },
  paths: [],
};

// A run where the safety fence held messages back, a rule held one, a path ran out of rounds, rows were left out,
// something could not be checked, and the screens folder could not be read.
const RUN_HELD = {
  ok: true, runId: "run-held", journeySource: "seed",
  journeysSkipped: [{ key: "demo-platform-nurture", reason: "it is a Demo Mode example, not a real journey" }],
  startEventFindings: [{ journey: "partner", status: "no-canonical-event", note: "the partner journey has no canonical opening event, so no automation could run on it" }],
  screensUnreadable: true,
  headline: "Walked 2 paths. Nothing went out.",
  summary: {
    walked: { paths: 2, clients: 2 },
    messages: { wouldHaveGoneOut: 0, pathsRefusedByFence: 2, fenceRefusals: [{ reason: "the routing names a provider that can transmit" }], blockedByGate: 1 },
    workflows: { fired: [], registered: 4, neverFired: [] },
    findings: { broken: [], couldNotCheck: [{ journey: "advisor", nodeTitle: "Submit the round", summary: "The pipelines table could not be read." }] },
    screens: { touchedAndWired: [], touchedAndWireframe: [{ file: "brand-studio.html" }], touchedByNoJourney: [] },
  },
  paths: [{ pathId: "client#1", dispatchTruncated: true }, { pathId: "client#2", dispatchTruncated: false }],
};

/** Open the Journeys editor with fake answers. Everything the page sends is logged on `seen`. */
async function openJourneys({ trees = TREES, ask = null, run = null, put = null, clock = false } = {}) {
  const seen = { puts: [], asks: [], runs: [], gets: 0, requests: [] };
  const answer = (route, out) => route.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.body ?? out) });
  const handlers = {
    "/api/journeys/ask": async (route) => {
      const body = bodyOf(route);
      seen.asks.push(body);
      return answer(route, ask ? await ask(body) : { ok: true, text: JSON.stringify(PATCH) });
    },
    "/api/journeys/run": async (route) => {
      seen.runs.push({ method: route.request().method(), body: bodyOf(route) });
      return answer(route, run ? await run() : RUN_ANSWER);
    },
    "/api/journeys": async (route, { method }) => {
      if (method === "PUT") {
        const body = bodyOf(route);
        seen.puts.push(body);
        return answer(route, put ? put(body) : { ok: true, key: body.key, updatedAt: "2026-10-14T12:00:00Z" });
      }
      seen.gets += 1;
      return json(route, {
        ok: true,
        journeys: Object.fromEntries(Object.entries(trees).map(([key, t]) => [key, { name: t.name, start: t.start, end: t.end, desc: t.desc, nodes: t.nodes, updatedAt: "2026-10-01T00:00:00Z" }])),
      });
    },
  };
  const { page, errors } = await screens.open("/app/journeys.html", { session: OWNER, handlers, clock });
  await page.waitForSelector("#jlist .jrow");
  await waitFor(() => seen.gets >= 1, "the saved journeys read");
  // The saved Client journey replaces the example the page painted first.
  if (trees.client && trees.client.nodes.length) {
    await waitFor(async () => (await page.locator("#canvas .chead p").textContent()) === trees.client.desc, "the saved Client journey");
  } else {
    await page.waitForTimeout(150);
  }
  const talk = dialogs(page);
  page.on("request", (request) => { if (/\/api\/journeys/.test(request.url())) seen.requests.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  return { page, errors, seen, talk };
}

const rowIds = (page) => page.locator("#canvas .nrow").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")));
const titles = (page) => page.locator("#canvas .nrow b").allTextContents();
const toastText = (page) => page.locator(".toast").first().innerText();
const clickStep = (page, id) => page.locator(`#canvas .nrow[data-id="${id}"] .node`).click();

// ── the six journey tabs ───────────────────────────────────────────────────────────────────────────────

const TAB_CONTROLS = {
  client: "Journey list tab: Client",
  setter: "Journey list tab: Setter",
  closer: "Journey list tab: Closer",
  advisor: "Journey list tab: Funding Advisor",
  affiliate: "Journey list tab: Affiliate",
  partner: "Journey list tab: White-Label Partner",
};

test("journey tabs: each one shows its own journey, its own start and end, its own step count", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  const tabs = await page.locator("#jlist .jrow .nm").allTextContents();
  assert.deepEqual(tabs, KEYS.map((k) => TREES[k].name), "six tabs in order");
  // Start on Setter so every claim below really switches.
  for (const key of [...KEYS].reverse()) {
    await proof.check(TAB_CONTROLS[key], async () => {
      const tree = TREES[key];
      await page.locator("#jlist .jrow").nth(KEYS.indexOf(key)).click();
      await waitFor(async () => (await page.locator("#canvas .chead h1").textContent()) === tree.name, `the ${tree.name} journey`);
      assert.equal(await page.locator("#canvas .chead p").textContent(), tree.desc);
      assert.equal(await page.locator("#canvas .cap .tt").first().textContent(), tree.start);
      assert.equal(await page.locator("#canvas .cap.end .tt").textContent(), tree.end);
      assert.equal(await page.locator("#canvas .nrow").count(), countSteps(tree.nodes));
      assert.deepEqual(await titles(page), JSON.parse(JSON.stringify(flatTitles(tree.nodes))));
      const selected = await page.locator("#jlist .jrow").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-selected")));
      assert.deepEqual(selected, KEYS.map((k) => String(k === key)), "only the pressed tab is selected");
      assert.equal(await page.locator("#jlist .jrow").nth(KEYS.indexOf(key)).locator(".ct").textContent(), String(countSteps(tree.nodes)));
    });
  }
  assert.equal(seen.puts.length, 0, "switching tabs saves nothing");
  assert.deepEqual(errors, []);
  await page.close();
});

function flatTitles(nodes) {
  // The page draws a question, then its two paths one after the other.
  return nodes.flatMap((n) => [n.title, ...(n.branches || []).flatMap((b) => flatTitles(b.nodes))]);
}

// ── picking a step, the + menu, the step fields ────────────────────────────────────────────────────────

test("click a step: it is selected and the Step panel shows that step", { timeout: 60_000 }, async () => {
  const { page, errors } = await openJourneys();
  await proof.check(/^Canvas: click a step to select it/, async () => {
    assert.match(await page.locator("#pbody").textContent(), /Nothing selected/);
    await clickStep(page, "n1");
    assert.equal(await page.locator('#canvas .nrow[data-id="n1"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Text the survey link");
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Send a text");
    assert.equal(await page.locator('#pbody [data-k="title"]').inputValue(), "Text the survey link", "the Step name box holds this step's own name");
    assert.match(await page.locator('#pbody [data-k="body"]').inputValue(), /here is the survey/);
    // A second click moves the selection; the first is no longer selected.
    await clickStep(page, "n5");
    assert.equal(await page.locator('#canvas .nrow[data-id="n1"]').getAttribute("aria-selected"), "false");
    assert.equal(await page.locator('#canvas .nrow[data-id="n5"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Wait a day");
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Wait");
    assert.equal(await page.locator('#pbody [data-k="title"]').inputValue(), "Wait a day");
    // A step inside a question's path is pickable too.
    await clickStep(page, "n4");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Email a nudge");
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Send an email");
    assert.equal(await page.locator('#pbody [data-k="title"]').inputValue(), "Email a nudge");
    // Exactly one step is marked, and picking a step changes nothing in the journey.
    const marks = await page.locator("#canvas .nrow").evaluateAll((rows) => rows.filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.getAttribute("data-id")));
    assert.deepEqual(marks, ["n4"]);
    assert.equal(await page.locator("#dirty").textContent(), "");
    // The mark is part of the drawing: it is still there after the canvas is drawn again by a typed change.
    await page.locator('#pbody [data-k="subject"]').fill("Still there? Reply soon");
    assert.equal(await page.locator('#canvas .nrow[data-id="n4"]').getAttribute("aria-selected"), "true", "the picked step stays marked after an edit");
    assert.equal(await page.locator('#canvas .nrow[data-id="n1"]').getAttribute("aria-selected"), "false");
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("the + between steps opens the ten kinds of step, and picking one puts it exactly there", { timeout: 60_000 }, async () => {
  const { page, errors } = await openJourneys();
  await proof.check(/^Canvas: '\+' between steps opens the add-step menu/, async () => {
    // One + above each step, one under the last, and one in each path of the question (two with a step, two without below).
    const adds = page.locator("#canvas .wire .add");
    const before = await adds.count();
    assert.ok(before >= 7, "there is a + between every pair of steps");
    assert.equal(await page.locator(".menu").count(), 0);
    await adds.nth(1).click(); // between "Text the survey link" and the question
    const menu = page.locator(".menu");
    assert.equal(await menu.count(), 1);
    const kinds = await menu.locator(".mi .l").allTextContents();
    assert.deepEqual(kinds, [
      "Send a text", "Send an email", "Wait", "Ask a question", "Move the card", "Assign to", "Hand off",
      "Run an agent", "Take payment", "Save something",
    ]);
    assert.deepEqual(await menu.locator(".mh").allTextContents(), ["Message", "Timing", "Pipeline", "Action"]);
    // Outside click and Escape close it; the + opens it again.
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".menu").count(), 0);
    await adds.nth(1).click();
    await page.locator("#canvas .chead").click();
    assert.equal(await page.locator(".menu").count(), 0);

    await adds.nth(1).click();
    await page.locator('.menu .mi[data-t="wait"]').click();
    assert.equal(await page.locator(".menu").count(), 0, "picking closes the menu");
    assert.deepEqual((await titles(page)).slice(0, 3), ["Text the survey link", "Wait", "Did they finish the survey"]);
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Wait", "the new step is selected and its panel open");
    assert.equal(await page.locator('#pbody [data-k="amount"]').inputValue(), "1");
    assert.equal(await page.locator('#pbody [data-k="unit"]').inputValue(), "days");
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
    assert.equal(await page.locator("#canvas .nrow").count(), 7);

    // A question added from the menu comes with two empty paths.
    const adds2 = page.locator("#canvas .wire .add");
    await adds2.last().click();
    await page.locator('.menu .mi[data-t="condition"]').click();
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Ask a question");
    assert.equal(await page.locator("#canvas .emptylane").count(), 2);
    assert.equal(await page.locator("#dirty").textContent(), "2 unsaved");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

/** A journey with a step above, a question with one step on its Yes path and none on its No path, and a step below. */
const PLACE_TREES = {
  ...TREES,
  client: {
    ...TREES.client,
    nodes: [
      step("a", "sms", "First text", { body: "Hello {{first_name}}. Reply STOP to opt out.", delay: "instant" }),
      step("q", "condition", "Did they finish", { field: "survey_complete", op: "is true" }, {
        branches: [
          { label: "Yes", nodes: [step("y1", "sms", "Yes text", { body: "Thanks {{first_name}}. Reply STOP to opt out.", delay: "instant" })] },
          { label: "No", nodes: [] },
        ],
      }),
      step("z", "record", "Last note", { note: "Done." }),
    ],
  },
};

test("a step added from a + lands exactly where that + was, in the right path, and starts with its own settings", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: PLACE_TREES });
  await proof.check(/^Canvas: '\+' between steps opens the add-step menu/, async () => {
    const mainPluses = () => page.locator("#canvas .rail > .wire .add");
    const lane = (n) => page.locator("#canvas .lanes > .lane").nth(n);
    const add = async (button, kind) => {
      await button.click();
      await page.locator(`.menu .mi[data-t="${kind}"]`).click();
      assert.equal(await page.locator(".menu").count(), 0);
    };
    const panel = async () => ({
      meta: await page.locator("#pbody .pmeta").textContent(),
      title: await page.locator('#pbody [data-k="title"]').inputValue(),
      fields: Object.fromEntries(await page.locator("#pbody [data-k]").evaluateAll((list) => list.filter((el) => el.getAttribute("data-k") !== "title").map((el) => [el.getAttribute("data-k"), el.value]))),
    });

    // 1. the + above the first step puts a text at the top of the journey
    assert.equal(await mainPluses().count(), 4, "one above each of the three steps, one under the last");
    await add(mainPluses().nth(0), "sms");
    assert.deepEqual(await panel(), { meta: "Send a text", title: "Send a text", fields: { body: "Reply STOP to opt out.", delay: "instant" } });
    // 2. the + under the one step of the Yes path puts an email there, after it, and not on the main line
    await add(lane(0).locator(".wire .add").last(), "email");
    assert.deepEqual(await panel(), { meta: "Send an email", title: "Send an email", fields: { subject: "", body: "", delay: "instant" } });
    // 3. the + in the empty No path puts a wait there, and not at the top of the journey
    assert.equal(await lane(1).locator(".emptylane").count(), 1);
    await add(lane(1).locator(".wire .add").first(), "wait");
    assert.deepEqual(await panel(), { meta: "Wait", title: "Wait", fields: { amount: "1", unit: "days" } });
    assert.equal(await lane(1).locator(".emptylane").count(), 0, "the No path has a step now");
    // 4. the + under the last step puts a payment at the end of the journey, and not at the top
    await add(mainPluses().last(), "payment");
    assert.deepEqual(await panel(), { meta: "Take payment", title: "Take payment", fields: { amount: "", product: "" } });
    // 5. the rest of the kinds, one after the other at the end, each with its own kind label and settings
    await add(mainPluses().last(), "stage");
    assert.deepEqual(await panel(), { meta: "Move the card", title: "Move the card", fields: { stage: "New Lead", pipeline: "Sales" } });
    await add(mainPluses().last(), "assign");
    assert.deepEqual(await panel(), { meta: "Assign to", title: "Assign to", fields: { role: "Setter" } });
    await add(mainPluses().last(), "handoff");
    assert.deepEqual(await panel(), { meta: "Hand off", title: "Hand off", fields: { role: "Closer", stage: "" } });
    await add(mainPluses().last(), "agent");
    assert.deepEqual(await panel(), { meta: "Run an agent", title: "Run an agent", fields: { agent: "UnderwriteIQ", note: "" } });
    await add(mainPluses().last(), "record");
    assert.deepEqual(await panel(), { meta: "Save something", title: "Save something", fields: { note: "" } });
    await add(mainPluses().last(), "condition");
    assert.deepEqual(await panel(), { meta: "Ask a question", title: "New question", fields: { field: "", op: "is true" } });
    assert.equal(await page.locator("#canvas .emptylane").count(), 2, "a new question comes with two empty paths");
    assert.equal(await page.locator("#dirty").textContent(), "10 unsaved");

    // Every add is in History, newest first.
    await page.locator('.ptab[data-tab="hist"]').click();
    const log = await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents();
    assert.deepEqual(log, [
      "Added a step: New question", "Added a step: Save something", "Added a step: Run an agent", "Added a step: Hand off",
      "Added a step: Assign to", "Added a step: Move the card", "Added a step: Take payment", "Added a step: Wait",
      "Added a step: Send an email", "Added a step: Send a text",
    ]);

    // Apply sends the tree with every step in the place it was added.
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 1, "the save request");
    const sent = seen.puts[0].nodes;
    const brief = (nodes) => nodes.map((n) => `${n.type}:${n.title}`);
    assert.deepEqual(brief(sent), [
      "sms:Send a text", "sms:First text", "condition:Did they finish", "record:Last note", "payment:Take payment", "stage:Move the card",
      "assign:Assign to", "handoff:Hand off", "agent:Run an agent", "record:Save something", "condition:New question",
    ]);
    const question = sent[2];
    assert.deepEqual(brief(question.branches[0].nodes), ["sms:Yes text", "email:Send an email"]);
    assert.deepEqual(brief(question.branches[1].nodes), ["wait:Wait"]);
    // What each added step is saved with: the settings it was made with, not blanks that the panel's pick list hides.
    assert.deepEqual(sent[0].cfg, { body: "Reply STOP to opt out.", delay: "instant" });
    assert.deepEqual(question.branches[0].nodes[1].cfg, { subject: "", body: "", delay: "instant" });
    assert.deepEqual(question.branches[1].nodes[0].cfg, { amount: "1", unit: "days" });
    assert.deepEqual(sent[4].cfg, { amount: "", product: "" });
    assert.deepEqual(sent[5].cfg, { stage: "New Lead", pipeline: "Sales" });
    assert.deepEqual(sent[6].cfg, { role: "Setter" });
    assert.deepEqual(sent[7].cfg, { role: "Closer", stage: "" });
    assert.deepEqual(sent[8].cfg, { agent: "UnderwriteIQ", note: "" });
    assert.deepEqual(sent[9].cfg, { note: "" });
    assert.deepEqual(sent[10].cfg, { field: "", op: "is true" });
    assert.deepEqual(sent[10].branches.map((b) => b.nodes.length), [0, 0]);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

/** One step of every kind, so the Step panel is judged for all ten. */
const ALL_KINDS = {
  ...TREES,
  client: {
    ...TREES.client,
    nodes: [
      step("k1", "sms", "Text", { body: "Hello {{first_name}}. Reply STOP to opt out.", delay: "instant" }),
      step("k2", "email", "Email", { subject: "Hi", body: "Body", delay: "instant" }),
      step("k3", "wait", "Wait", { amount: "2", unit: "days" }),
      step("k4", "condition", "Ask", { field: "survey_complete", op: "is true" }, { branches: [{ label: "Yes", nodes: [] }, { label: "No", nodes: [] }] }),
      step("k5", "stage", "Move", { stage: "Booked", pipeline: "Sales" }),
      step("k6", "assign", "Assign", { role: "Setter" }),
      step("k7", "handoff", "Hand off", { role: "Closer", stage: "Call Assigned" }),
      step("k8", "agent", "Agent", { agent: "UnderwriteIQ", note: "Run the file." }),
      step("k9", "payment", "Pay", { amount: "32.00", product: "Diagnostic" }),
      step("k10", "record", "Record", { note: "Write it down." }),
    ],
  },
};

const STAGE_NAMES = [
  "New Lead", "Survey Complete", "Booked", "Confirmed", "Showed", "Diagnostic Paid", "Decision Rendered", "Closed Won (deposit)",
  "Downsell", "Lost", "Apply Now", "Round Submitted", "Approved", "Funded", "Closed",
];
const PIPELINE_NAMES = [
  "Sales", "Funding: Card Stacking", "Funding: Alt-Fin (Lendflow)", "Optimization (Repair) Rounds", "Inquiry Removal",
  "AR / Collections", "Affiliates + White Label", "Hiring",
];

test("step fields: every kind of step shows its own boxes with what is saved in them, and what is typed is what gets saved", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: ALL_KINDS });
  await proof.check(/^Step panel fields: text body and timing/, async () => {
    const fieldKeys = async () => page.locator("#pbody [data-k]").evaluateAll((list) => list.map((el) => el.getAttribute("data-k")));
    const options = async (key) => page.locator(`#pbody [data-k="${key}"] option`).allTextContents();
    const value = async (key) => page.locator(`#pbody [data-k="${key}"]`).inputValue();
    const pick = async (id) => {
      await clickStep(page, id);
      const title = ALL_KINDS.client.nodes.find((node) => node.id === id).title;
      await waitFor(async () =>
        await page.locator(`#canvas .nrow[data-id="${id}"]`).getAttribute("aria-selected") === "true" &&
        await page.locator("#pbody .ptitle").textContent() === title,
      `the selected ${id} step and its own fields`);
    };

    // 1. every box opens holding what is saved for the step (a box, a text area and a pick list alike)
    await pick("k1");
    assert.deepEqual(await fieldKeys(), ["title", "body", "delay"]);
    assert.equal(await value("title"), "Text");
    assert.equal(await value("body"), "Hello {{first_name}}. Reply STOP to opt out.");
    assert.equal(await value("delay"), "instant");
    await pick("k2");
    assert.deepEqual([await value("title"), await value("subject"), await value("body"), await value("delay")], ["Email", "Hi", "Body", "instant"]);
    await pick("k3");
    assert.deepEqual([await value("amount"), await value("unit")], ["2", "days"]);
    await pick("k4");
    assert.deepEqual([await value("field"), await value("op")], ["survey_complete", "is true"]);
    await pick("k5");
    assert.deepEqual([await value("stage"), await value("pipeline")], ["Booked", "Sales"]);
    await pick("k6");
    assert.equal(await value("role"), "Setter");
    await pick("k7");
    assert.deepEqual([await value("role"), await value("stage")], ["Closer", "Call Assigned"]);
    await pick("k8");
    assert.deepEqual([await value("agent"), await value("note")], ["UnderwriteIQ", "Run the file."]);
    await pick("k9");
    assert.deepEqual([await value("amount"), await value("product")], ["32.00", "Diagnostic"]);
    await pick("k10");
    assert.equal(await value("note"), "Write it down.");
    assert.equal(await page.locator("#dirty").textContent(), "", "looking at a step changes nothing");

    // 2. every pick list is the list the product's pipelines and roles use, spelled out
    await pick("k5");
    assert.deepEqual(await options("stage"), STAGE_NAMES);
    assert.deepEqual(await options("pipeline"), PIPELINE_NAMES);
    await pick("k6");
    assert.deepEqual(await options("role"), ["Client", "Setter", "Closer", "Funding Advisor", "Inquiry Specialist", "Owner", "Affiliate", "Partner"]);
    await pick("k8");
    assert.deepEqual(await options("agent"), ["UnderwriteIQ", "Setter Josh", "Brand Studio", "Inquiry Voice", "Alerts Engine"]);

    // 3. type into every kind
    await pick("k1");
    assert.deepEqual(await options("delay"), ["instant", "after 15 minutes", "after 2 hours", "after 1 day", "after 2 days", "24h before", "2h before"]);
    await page.locator('#pbody [data-k="body"]').fill("New words {{first_name}}. Reply STOP to opt out.");
    await page.locator('#pbody [data-k="delay"]').selectOption("after 2 hours");

    await pick("k2");
    assert.deepEqual(await fieldKeys(), ["title", "subject", "body", "delay"]);
    assert.deepEqual(await options("delay"), ["instant", "after 1 hour", "after 1 day", "after 2 days"]);
    await page.locator('#pbody [data-k="subject"]').fill("A new subject");
    await page.locator('#pbody [data-k="body"]').fill("A new email body");
    await page.locator('#pbody [data-k="delay"]').selectOption("after 1 day");

    await pick("k3");
    assert.deepEqual(await fieldKeys(), ["title", "amount", "unit"]);
    assert.deepEqual(await options("unit"), ["minutes", "hours", "days"]);
    await page.locator('#pbody [data-k="amount"]').fill("45");
    await page.locator('#pbody [data-k="unit"]').selectOption("minutes");

    await pick("k4");
    assert.deepEqual(await fieldKeys(), ["title", "field", "op"]);
    assert.deepEqual(await options("op"), ["is true", "is false", "is set", "is empty", "= funding", "= optimization"]);
    await page.locator('#pbody [data-k="field"]').fill("call_answered");
    await page.locator('#pbody [data-k="op"]').selectOption("is false");

    await pick("k5");
    assert.deepEqual(await fieldKeys(), ["title", "stage", "pipeline"]);
    await page.locator('#pbody [data-k="stage"]').selectOption("Funded");
    await page.locator('#pbody [data-k="pipeline"]').selectOption("Funding: Card Stacking");

    await pick("k6");
    assert.deepEqual(await fieldKeys(), ["title", "role"]);
    await page.locator('#pbody [data-k="role"]').selectOption("Owner");

    await pick("k7");
    assert.deepEqual(await fieldKeys(), ["title", "role", "stage"]);
    await page.locator('#pbody [data-k="role"]').selectOption("Funding Advisor");
    // a trailing space is kept as typed: nothing trims a box on the way in
    await page.locator('#pbody [data-k="stage"]').fill("File Received ");

    await pick("k8");
    assert.deepEqual(await fieldKeys(), ["title", "agent", "note"]);
    await page.locator('#pbody [data-k="agent"]').selectOption("Inquiry Voice");
    await page.locator('#pbody [data-k="note"]').fill("Call the bureau.");

    await pick("k9");
    assert.deepEqual(await fieldKeys(), ["title", "amount", "product"]);
    await page.locator('#pbody [data-k="amount"]').fill("49.50");
    // a double quote in a one-line box must survive the box being drawn again (it is written into an attribute)
    const quoted = 'Roadmap "Plus" & <i>more</i>';
    await page.locator('#pbody [data-k="product"]').fill(quoted);
    assert.equal(await value("product"), quoted);
    await pick("k1");
    await pick("k9");
    assert.equal(await value("product"), quoted, "the one-line box holds the same words after the panel is drawn again");
    assert.equal(await value("amount"), "49.50");

    await pick("k10");
    assert.deepEqual(await fieldKeys(), ["title", "note"]);
    // quotes, an ampersand and angle brackets are text, in the box and on the canvas, and are sent as typed
    const tricky = 'He said "hello" & <b>left</b>';
    await page.locator('#pbody [data-k="note"]').fill(tricky);
    assert.equal(await value("note"), tricky);
    assert.equal(await page.locator('#canvas .nrow[data-id="k10"] .nsub').textContent(), tricky);
    assert.equal(await page.locator('#canvas .nrow[data-id="k10"] b').count(), 1, "only the step's own title is bold; the typed <b> is text");
    await pick("k1");
    await pick("k10");
    assert.equal(await value("note"), tricky, "the box holds the same words after the panel is drawn again");

    // 4. the canvas follows what was typed (no save yet), and Apply sends exactly the typed values
    assert.equal(seen.puts.length, 0, "typing in a box saves nothing");
    assert.match(await page.locator('#canvas .nrow[data-id="k3"] .nsub').textContent(), /Nothing happens for 45 minutes/);
    assert.match(await page.locator('#canvas .nrow[data-id="k5"] .nsub').textContent(), /Funded in Funding: Card Stacking/);
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 1, "the save request");
    assert.equal(seen.puts[0].key, "client");
    const byId = Object.fromEntries(seen.puts[0].nodes.map((n) => [n.id, n.cfg]));
    assert.deepEqual(byId.k1, { body: "New words {{first_name}}. Reply STOP to opt out.", delay: "after 2 hours" });
    assert.deepEqual(byId.k2, { subject: "A new subject", body: "A new email body", delay: "after 1 day" });
    assert.deepEqual(byId.k3, { amount: "45", unit: "minutes" });
    assert.deepEqual(byId.k4, { field: "call_answered", op: "is false" });
    assert.deepEqual(byId.k5, { stage: "Funded", pipeline: "Funding: Card Stacking" });
    assert.deepEqual(byId.k6, { role: "Owner" });
    assert.deepEqual(byId.k7, { role: "Funding Advisor", stage: "File Received " });
    assert.deepEqual(byId.k8, { agent: "Inquiry Voice", note: "Call the bureau." });
    assert.deepEqual(byId.k9, { amount: "49.50", product: quoted });
    assert.deepEqual(byId.k10, { note: tricky });
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Move up / Move down / Delete, Undo, Discard ────────────────────────────────────────────────────────

test("Move up, Move down and Delete change the order and the list, and say so in History", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check(/^Step panel: Move up \/ Move down \/ Delete/, async () => {
    assert.deepEqual((await rowIds(page)).slice(0, 2), ["n1", "n2"]);
    await clickStep(page, "n5"); // Wait a day: third top-level step; top level is n1, n2(question), n5, n6
    const top = async () => (await rowIds(page)).filter((id) => ["n1", "n2", "n5", "n6"].includes(id));
    assert.deepEqual(await top(), ["n1", "n2", "n5", "n6"]);

    await page.locator('#pbody [data-mv="-1"]').click();
    assert.deepEqual(await top(), ["n1", "n5", "n2", "n6"], "Move up swaps with the step above");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Wait a day", "the step stays selected");
    await page.locator('#pbody [data-mv="1"]').click();
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await top(), ["n1", "n2", "n6", "n5"], "Move down twice puts it last");
    // At the end, Move down does nothing: no order change and no extra change counted.
    const count = await page.locator("#dirty").textContent();
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await top(), ["n1", "n2", "n6", "n5"]);
    assert.equal(await page.locator("#dirty").textContent(), count);
    assert.equal(count, "3 unsaved");

    await page.locator("#pbody .del").click();
    assert.deepEqual(await top(), ["n1", "n2", "n6"], "Delete takes the step out");
    assert.match(await page.locator("#pbody").textContent(), /Nothing selected/);
    assert.equal(await page.locator("#dirty").textContent(), "4 unsaved");

    await page.locator('.ptab[data-tab="hist"]').click();
    const log = await page.locator("#pbody .li .wt").allTextContents();
    assert.deepEqual(log.slice(0, 4), ["Deleted a step: Wait a day", "Moved Wait a day down", "Moved Wait a day down", "Moved Wait a day up"]);
    assert.equal(seen.puts.length, 0, "nothing is saved by moving or deleting");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

/** A question with three steps on its Yes path and one on its No path, a step above it and a step below it. */
const MOVE_TREES = {
  ...TREES,
  client: {
    ...TREES.client,
    nodes: [
      step("t1", "sms", "Top text", { body: "Top. Reply STOP to opt out.", delay: "instant" }),
      step("q", "condition", "The question", { field: "survey_complete", op: "is true" }, {
        branches: [
          { label: "Yes", nodes: [
            step("a1", "sms", "Yes one", { body: "One. Reply STOP to opt out.", delay: "instant" }),
            step("a2", "sms", "Yes two", { body: "Two. Reply STOP to opt out.", delay: "instant" }),
            step("a3", "sms", "Yes three", { body: "Three. Reply STOP to opt out.", delay: "instant" }),
          ] },
          { label: "No", nodes: [step("b1", "sms", "No one", { body: "No. Reply STOP to opt out.", delay: "instant" })] },
        ],
      }),
      step("t2", "record", "Bottom note", { note: "Last." }),
    ],
  },
};

test("Move and Delete work on a step inside a path and on a question, refuse the ends, and say so in History", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: MOVE_TREES });
  await proof.check(/^Step panel: Move up \/ Move down \/ Delete/, async () => {
    const lanes = async () => Promise.all([0, 1].map((n) => page.locator("#canvas .lanes > .lane").nth(n).locator(".nrow").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")))));
    const main = async () => page.locator("#canvas .rail > .nrow").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")));
    const log = async () => { await page.locator('.ptab[data-tab="hist"]').click(); const l = await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents(); await page.locator('.ptab[data-tab="step"]').click(); return l; };
    assert.deepEqual(await main(), ["t1", "q", "t2"]);
    assert.deepEqual(await lanes(), [["a1", "a2", "a3"], ["b1"]]);

    // Move a step down inside its path: only that path changes.
    await clickStep(page, "a2");
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await lanes(), [["a1", "a3", "a2"], ["b1"]]);
    assert.deepEqual(await main(), ["t1", "q", "t2"], "the main line did not change");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Yes two", "the step stays selected");
    // The end of a path refuses: nothing moves, nothing is counted, nothing is written in History.
    const count = await page.locator("#dirty").textContent();
    assert.equal(count, "1 unsaved");
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await lanes(), [["a1", "a3", "a2"], ["b1"]]);
    await clickStep(page, "a1");
    await page.locator('#pbody [data-mv="-1"]').click();
    assert.deepEqual(await lanes(), [["a1", "a3", "a2"], ["b1"]], "Move up on the first step of a path does nothing");
    await clickStep(page, "t1");
    await page.locator('#pbody [data-mv="-1"]').click();
    await clickStep(page, "t2");
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await main(), ["t1", "q", "t2"], "the ends of the main line refuse too");
    assert.equal(await page.locator("#dirty").textContent(), count, "a refused move is not a change");
    assert.deepEqual(await log(), ["Moved Yes two down"], "and it is not in History");

    // Move a question: it travels with everything under it.
    await clickStep(page, "q");
    await page.locator('#pbody [data-mv="-1"]').click();
    assert.deepEqual(await main(), ["q", "t1", "t2"]);
    assert.deepEqual(await lanes(), [["a1", "a3", "a2"], ["b1"]], "its paths went with it");
    await page.locator('#pbody [data-mv="1"]').click();
    assert.deepEqual(await main(), ["t1", "q", "t2"]);

    // Delete a step in a path: only that one goes, from that path.
    await clickStep(page, "a3");
    await page.locator("#pbody .del").click();
    assert.deepEqual(await lanes(), [["a1", "a2"], ["b1"]]);
    assert.deepEqual(await main(), ["t1", "q", "t2"]);
    // Delete the only step of a path: the empty path says so.
    await clickStep(page, "b1");
    await page.locator("#pbody .del").click();
    assert.deepEqual(await lanes(), [["a1", "a2"], []]);
    assert.equal(await page.locator("#canvas .lanes > .lane").nth(1).locator(".emptylane").count(), 1);
    // Delete the question itself: its paths and every step in them go with it.
    await clickStep(page, "q");
    await page.locator("#pbody .del").click();
    assert.deepEqual(await rowIds(page), ["t1", "t2"], "the question and the steps under it are gone");
    assert.match(await page.locator("#pbody").textContent(), /Nothing selected/);
    assert.deepEqual((await log()).slice(0, 4), ["Deleted a step: The question", "Deleted a step: No one", "Deleted a step: Yes three", "Moved The question down"]);

    // What Apply sends is the same journey.
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 1, "the save request");
    assert.deepEqual(seen.puts[0].nodes.map((n) => n.id), ["t1", "t2"]);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Undo (button, Ctrl+Z and Cmd+Z) steps back one change at a time, of every kind, and goes dark when there is nothing to undo", { timeout: 120_000 }, async () => {
  const { page, errors } = await openJourneys();
  await proof.check(/^Header: Undo \(also Cmd\/Ctrl\+Z\)/, async () => {
    const undo = page.locator("#undo");
    assert.equal(await undo.isDisabled(), true, "nothing to undo on a fresh page");
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    await clickStep(page, "n5");
    await page.locator("#pbody .del").click();
    assert.deepEqual((await rowIds(page)).filter((id) => ["n5", "n6"].includes(id)), []);
    assert.equal(await page.locator("#dirty").textContent(), "2 unsaved");
    assert.equal(await undo.isDisabled(), false);

    await undo.click();
    assert.deepEqual((await rowIds(page)).filter((id) => ["n5", "n6"].includes(id)), ["n5"], "the last delete is undone, not both");
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
    await page.keyboard.press("Control+z");
    assert.deepEqual((await rowIds(page)).filter((id) => ["n5", "n6"].includes(id)), ["n5", "n6"], "Ctrl+Z undoes the other one");
    assert.equal(await page.locator("#dirty").textContent(), "");
    assert.equal(await undo.isDisabled(), true);

    // Cmd+Z does the same: the row says Cmd/Ctrl.
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    assert.equal((await rowIds(page)).includes("n6"), false);
    await page.keyboard.press("Meta+z");
    assert.equal((await rowIds(page)).includes("n6"), true, "Cmd+Z undoes a change");
    assert.equal(await page.locator("#dirty").textContent(), "");
    assert.equal(await undo.isDisabled(), true);
  });

  const top = async (p) => (await rowIds(p)).filter((id) => ["n1", "n2", "n5", "n6"].includes(id));
  await proof.check(/^Header: Undo \(also Cmd\/Ctrl\+Z\)/, async () => {
    // A move is undone.
    await clickStep(page, "n5");
    await page.locator('#pbody [data-mv="-1"]').click();
    assert.deepEqual(await top(page), ["n1", "n5", "n2", "n6"]);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await top(page), ["n1", "n2", "n5", "n6"], "a Move is undone");
    assert.equal(await page.locator("#dirty").textContent(), "");

    // An added step is undone.
    const before = (await rowIds(page)).length;
    await page.locator("#canvas .wire .add").nth(1).click();
    await page.locator('.menu .mi[data-t="wait"]').click();
    assert.equal((await rowIds(page)).length, before + 1);
    await page.keyboard.press("Control+z");
    assert.equal((await rowIds(page)).length, before, "an added step is undone");
    assert.equal(await page.locator("#dirty").textContent(), "");
  });

  await proof.check(/^Header: Undo \(also Cmd\/Ctrl\+Z\)/, async () => {
    // A typed change is undone, once its History entry has been written.
    await clickStep(page, "n6");
    await page.locator('#pbody [data-k="note"]').fill("A different note");
    await page.locator('.ptab[data-tab="hist"]').click();
    await waitFor(async () => (await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents())[0] === "Edited Save a note", "the typed change in History");
    await page.keyboard.press("Control+z");
    await page.locator('.ptab[data-tab="step"]').click();
    await clickStep(page, "n6");
    assert.equal(await page.locator('#pbody [data-k="note"]').inputValue(), "Survey handled.", "the typed words are back to what they were");
    assert.equal(await page.locator("#dirty").textContent(), "");
  });
  assert.deepEqual(errors, []);
  await page.close();

  // A kept AI answer is undone.
  const kept = await openJourneys();
  await kept.page.locator("#askin").fill("Add a follow-up if they go quiet");
  await kept.page.locator("#asksend").click();
  await kept.page.locator("#accept").waitFor();
  await kept.page.locator("#accept").click();
  assert.equal((await titles(kept.page)).includes("Follow up if they go quiet"), true);
  assert.equal(await kept.page.locator("#undo").isDisabled(), false);
  await kept.page.keyboard.press("Control+z");
  assert.equal((await titles(kept.page)).includes("Follow up if they go quiet"), false, "Keep it can be undone");
  assert.equal(await kept.page.locator("#dirty").textContent(), "");
  await kept.page.close();

  // Undo belongs to the journey that is open: changing journey starts a fresh list, so Ctrl+Z on the other
  // journey cannot paste the first one's steps into it.
  const two = await openJourneys();
  await clickStep(two.page, "n6");
  await two.page.locator("#pbody .del").click();
  assert.equal(await two.page.locator("#undo").isDisabled(), false);
  await two.page.locator("#jlist .jrow").nth(1).click();
  assert.equal(await two.page.locator("#canvas .chead h1").textContent(), "Setter");
  assert.equal(await two.page.locator("#undo").isDisabled(), true, "nothing to undo on the journey just opened");
  await two.page.keyboard.press("Control+z");
  assert.equal(await two.page.locator("#canvas .chead h1").textContent(), "Setter");
  assert.deepEqual(await titles(two.page), flatTitles(TREES.setter.nodes), "Setter is still Setter's own steps");
  await two.page.close();
});

test("Discard puts the journey back to the saved one, not to the page's own example", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check(/^Bottom bar: Discard/, async () => {
    assert.equal(await page.locator("#discard").count(), 0, "no bar until something changes");
    await clickStep(page, "n1");
    await page.locator('#pbody [data-k="title"]').fill("A renamed first step");
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    assert.equal(await page.locator("#canvas .bar .what").innerText().then((t) => t.split(".")[0]), "2 changes not applied");
    assert.equal((await titles(page))[0], "A renamed first step");
    assert.equal(await page.locator("#jlist .jrow .edited").count(), 1, "the journey is marked as changed");
    await page.locator("#discard").click();
    assert.equal(await page.locator("#discard").count(), 0, "the bar goes away");
    assert.equal(await page.locator("#dirty").textContent(), "");
    assert.deepEqual(await titles(page), flatTitles(TREES.client.nodes), "the saved journey is back, step for step");
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Client");
    assert.equal(await page.locator("#jlist .jrow .edited").count(), 0, "and it is no longer marked as changed");
    assert.equal(seen.puts.length, 0, "Discard saves nothing");

    // Discard is itself a change in History, and it can be undone.
    await page.locator('.ptab[data-tab="hist"]').click();
    assert.equal(await page.locator("#pbody .sect").nth(1).locator(".li .wt").first().textContent(), "Discarded every unapplied change");
    assert.equal(await page.locator("#undo").isDisabled(), false);

    // The saved copy is a copy: a change made after a Discard does not change what the next Discard returns to.
    await page.locator('.ptab[data-tab="step"]').click();
    await clickStep(page, "n1");
    await page.locator('#pbody [data-k="title"]').fill("Another rename");
    assert.equal((await titles(page))[0], "Another rename");
    await page.locator("#discard").click();
    assert.deepEqual(await titles(page), flatTitles(TREES.client.nodes), "the second Discard returns to the saved journey too");
  });

  // Another journey: Discard returns to that journey's own saved steps, not the Client journey's.
  await proof.check(/^Bottom bar: Discard/, async () => {
    await page.locator("#jlist .jrow").nth(1).click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Setter");
    await clickStep(page, "n7");
    await page.locator('#pbody [data-k="title"]').fill("Setter renamed");
    await page.locator("#discard").click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Setter");
    assert.deepEqual(await titles(page), flatTitles(TREES.setter.nodes), "Setter is back to Setter's own saved steps");
  });
  assert.deepEqual(errors, []);
  await page.close();

  // After an Apply the saved copy is the applied one: a later Discard returns to what was applied, not to what was loaded.
  const applied = await openJourneys();
  await clickStep(applied.page, "n1");
  await applied.page.locator('#pbody [data-k="title"]').fill("Applied name");
  await applied.page.locator("#apply").click();
  await waitFor(() => applied.seen.puts.length === 1, "the save request");
  await waitFor(async () => (await applied.page.locator("#dirty").textContent()) === "", "the count cleared");
  await clickStep(applied.page, "n1");
  await applied.page.locator('#pbody [data-k="title"]').fill("Typed after the apply");
  assert.equal((await titles(applied.page))[0], "Typed after the apply");
  await applied.page.locator("#discard").click();
  assert.equal((await titles(applied.page))[0], "Applied name", "Discard returns to the applied journey");
  await applied.page.close();
});

test("Discard on one journey keeps every other journey's unsaved work counted and applyable", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check(/^Bottom bar: Discard/, async () => {
    // A change on Client, then a change on Setter, then Discard on Setter.
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    await page.locator("#jlist .jrow").nth(1).click();
    await clickStep(page, "n7");
    await page.locator('#pbody [data-k="title"]').fill("Setter renamed");
    assert.equal(await page.locator("#dirty").textContent(), "2 unsaved");
    await page.locator("#discard").click();
    // Client still holds its deleted step, unapplied, so it remains counted and can still be applied.
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved", "only Setter's discarded change left the count");
    await page.locator("#jlist .jrow").nth(0).click();
    assert.equal((await rowIds(page)).includes("n6"), false, "Client's deleted step is still deleted");
    assert.equal(await page.locator("#discard").count(), 1, "the remaining change still has a bottom bar");
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 1, "the remaining Client save");
    assert.equal(seen.puts[0].key, "client");
    await waitFor(async () => (await page.locator("#dirty").textContent()) === "", "the applied count clears");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Apply ─────────────────────────────────────────────────────────────────────────────────────────────────

test("Apply saves every journey that was changed, one save each with its own key and steps, and clears the counts only when all are saved", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check("Header: Apply to code and bottom-bar Apply (saves every edited journey)", async () => {
    // Three journeys, each with its own change.
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    await page.locator("#jlist .jrow").nth(1).click();
    await clickStep(page, "n7");
    await page.locator('#pbody [data-k="note"]').fill("Four tries in the first hour.");
    await page.locator("#jlist .jrow").nth(2).click();
    await clickStep(page, "n9");
    await page.locator('#pbody [data-k="title"]').fill("Load the call panel");
    await page.locator("#jlist .jrow").nth(5).click();
    assert.equal(await page.locator("#dirty").textContent(), "3 unsaved");
    assert.equal(await page.locator("#jlist .jrow .edited").count(), 3);
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 3, "three save requests");
    const byKey = Object.fromEntries(seen.puts.map((p) => [p.key, p]));
    assert.deepEqual(Object.keys(byKey).sort(), ["client", "closer", "setter"], "one save for each changed journey, none for the others");
    for (const key of ["client", "setter", "closer"]) {
      const t = TREES[key];
      assert.equal(byKey[key].name, t.name);
      assert.equal(byKey[key].start, t.start);
      assert.equal(byKey[key].end, t.end);
      assert.equal(byKey[key].desc, t.desc);
    }
    assert.deepEqual(byKey.client.nodes.map((n) => n.id), ["n1", "n2", "n5"], "Client's own steps, with the deleted one gone");
    assert.deepEqual(byKey.setter.nodes.map((n) => n.id), ["n7", "n8"]);
    assert.equal(byKey.setter.nodes[0].cfg.note, "Four tries in the first hour.");
    assert.deepEqual(byKey.closer.nodes.map((n) => n.title), ["Load the call panel"]);
    await waitFor(async () => (await page.locator("#dirty").textContent()) === "", "the count cleared");
    assert.equal(await page.locator("#jlist .jrow .edited").count(), 0);
    assert.match(await toastText(page), /Applied 3 changes\. Saved to the database/);
    assert.equal(await page.locator("#undo").isDisabled(), true);
    // Nothing changed since: the button says so and sends nothing.
    await page.locator("#apply").click();
    assert.match(await toastText(page), /Nothing to apply/);
    assert.equal(seen.puts.length, 3);
  });
  assert.deepEqual(errors, []);
  await page.close();

  // The bottom bar's Apply to code is the same button.
  const bar = await openJourneys();
  await proof.check("Header: Apply to code and bottom-bar Apply (saves every edited journey)", async () => {
    await clickStep(bar.page, "n6");
    await bar.page.locator("#pbody .del").click();
    await bar.page.locator("#applybar").click();
    await waitFor(() => bar.seen.puts.length === 1, "the save request");
    assert.deepEqual(bar.seen.puts[0].nodes.map((n) => n.id), ["n1", "n2", "n5"]);
    await waitFor(async () => (await bar.page.locator("#dirty").textContent()) === "", "the count cleared");
    assert.equal(await bar.page.locator("#canvas .bar").count(), 0, "the bar goes away");
  });
  await bar.page.close();

  // A refused save keeps every count, names the steps, and says nothing was applied.
  const refusal = {
    status: 400,
    body: { ok: false, error: "steps_not_set_up", message: "1 step is missing something they need.", violations: [{ nodeId: "n5", title: "Wait a day", reason: "is a wait with no proper length on it" }] },
  };
  const refused = await openJourneys({ put: (body) => (body.key === "setter" ? refusal : { ok: true, key: body.key }) });
  await proof.check("Header: Apply to code and bottom-bar Apply (saves every edited journey)", async () => {
    await clickStep(refused.page, "n6");
    await refused.page.locator("#pbody .del").click();
    await refused.page.locator("#jlist .jrow").nth(1).click();
    await clickStep(refused.page, "n7");
    await refused.page.locator('#pbody [data-k="title"]').fill("Voice agent calls, twice");
    await refused.page.locator("#apply").click();
    await waitFor(() => refused.seen.puts.length === 2, "both save requests");
    await waitFor(async () => /Could not save\./.test(await toastText(refused.page).catch(() => "")), "the refusal words");
    const words = await toastText(refused.page);
    assert.match(words, /1 step is missing something they need\./);
    assert.match(words, /“Wait a day” is a wait with no proper length on it/);
    assert.match(words, /Nothing was applied\./);
    assert.equal(await refused.page.locator("#dirty").textContent(), "2 unsaved", "nothing is cleared when one save is refused");
    assert.equal(await refused.page.locator("#apply").isDisabled(), false, "and the button is back");
  });
  await refused.page.close();

  // A single brace is caught on the page, before any request.
  const brace = await openJourneys();
  await proof.check("Header: Apply to code and bottom-bar Apply (saves every edited journey)", async () => {
    await clickStep(brace.page, "n1");
    await brace.page.locator('#pbody [data-k="body"]').fill("Hi {first_name}, here is the link. Reply STOP to opt out.");
    await brace.page.locator("#apply").click();
    assert.match(await toastText(brace.page), /Fix the braces first\..*nothing was saved: Client — "Text the survey link": \{first_name\}/);
    assert.equal(brace.seen.puts.length, 0);
    assert.equal(await brace.page.locator("#dirty").textContent(), "1 unsaved");
  });
  await brace.page.close();
});

// ── Make the change (AI), Keep it / Throw it away ──────────────────────────────────────────────────────

test("the ask box: Make the change is off until there are words, the examples ask at once, and the answer is staged for Keep it or Throw it away", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys();

  await proof.check(/^Step panel: 'Make the change' \(AI rewrites one step\) and canvas ask box/, async () => {
    const send = page.locator("#asksend");
    assert.equal(await send.isDisabled(), true, "the button is off with an empty box");
    await send.click({ force: true }).catch(() => {});
    assert.equal(seen.asks.length, 0, "an empty box asks nothing");
    const examples = await page.locator(".egs .eg").allTextContents();
    assert.deepEqual(examples, [
      "If they don’t confirm by 6pm, text them again at 8am",
      "Add a 3-day check-in after the call",
      "Email a recap once the diagnostic is done",
    ]);

    // Typed words: the button turns on and the request carries the words and the whole journey.
    await page.locator("#askin").fill("If they go quiet, text them again after two days");
    assert.equal(await send.isDisabled(), false);
    await send.click();
    await waitFor(() => seen.asks.length === 1, "the ask request");
    const asked = seen.asks[0];
    assert.deepEqual(Object.keys(asked).sort(), ["system", "user"]);
    assert.match(asked.user, /Change requested:\nIf they go quiet, text them again after two days/);
    assert.match(asked.user, /"journey":"Client"/);
    assert.match(asked.user, /"title":"Text the survey link"/);
    assert.match(asked.system, /double curly braces/i);
    assert.doesNotMatch(asked.user, /The user is looking at step/, "no step in view, so no step scope");
    await page.locator("#accept").waitFor();
    // Discard what was staged, then press an example: it asks at once with its own words.
    await page.locator("#reject").click();
    await page.locator(".egs .eg").nth(1).click();
    await waitFor(() => seen.asks.length === 2, "the example's ask");
    assert.match(seen.asks[1].user, /Change requested:\nAdd a 3-day check-in after the call/);
    await page.locator("#reject").click();

    // The step panel's own box scopes the change to the picked step, and an empty box sends nothing.
    await clickStep(page, "n5");
    await page.locator("#sgo").click();
    assert.equal(seen.asks.length, 2, "an empty step box asks nothing");
    await page.locator("#sprompt").fill("Make it two days");
    await page.locator("#sgo").click();
    await waitFor(() => seen.asks.length === 3, "the step ask");
    assert.match(seen.asks[2].user, /Change requested:\nMake it two days/);
    assert.match(seen.asks[2].user, /The user is looking at step "n5"/);
    await page.locator("#reject").click();
  });

  assert.equal(seen.puts.length, 0, "asking saves nothing");
  assert.deepEqual(errors, []);
  await page.close();

  // When the AI door says it has no key, the page shows its worked example and says so in words.
  const noKey = await openJourneys({ ask: () => ({ status: 503, body: { ok: false, error: "anthropic_api_key_not_configured" } }) });
  await noKey.page.locator("#askin").fill("Send a recap email");
  await noKey.page.locator("#asksend").click();
  await noKey.page.locator("#accept").waitFor();
  assert.match(await noKey.page.locator("#canvas .askerr").innerText(), /ANTHROPIC_API_KEY is not set on this deployment, so this is a worked example/);
  assert.match(await noKey.page.locator("#canvas .bar .what").innerText(), /Added an email step\./);
  await noKey.page.close();
});

const PATCH_BIG = {
  summary: "Reworked the survey follow-up.",
  ops: [
    { op: "insert", after: "start", path: [], node: { type: "wait", title: "Pause at the start", cfg: {} } },
    { op: "insert", after: "n3", path: ["n2", 0], node: { type: "sms", title: "Yes path nudge", cfg: { body: "Hi {{first_name}}. Reply STOP to opt out." } } },
    { op: "update", id: "n1", cfg: { delay: "after 2 hours" } },
    { op: "delete", id: "n6" },
  ],
};

test("an AI answer's operations land where they say: the top, a path, a partial rewrite and a delete, with defaults filled in", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ ask: () => ({ ok: true, text: JSON.stringify(PATCH_BIG) }) });
  await proof.check(/^Step panel: 'Make the change' \(AI rewrites one step\) and canvas ask box/, async () => {
    const original = await titles(page);
    await page.locator("#askin").fill("Rework the survey follow-up");
    await page.locator("#asksend").click();
    await page.locator("#accept").waitFor();
    // What the AI was shown: the journey's name, its start and end, and every step including the ones in the paths.
    const shown = JSON.parse(/Current journey:\n(.*)\n\nChange requested:/s.exec(seen.asks[0].user)[1]);
    assert.equal(shown.journey, "Client");
    assert.equal(shown.startsWhen, TREES.client.start);
    assert.equal(shown.endsWhen, TREES.client.end);
    assert.deepEqual(shown.steps.map((n) => n.id), ["n1", "n2", "n5", "n6"]);
    assert.deepEqual(shown.steps[1].branches.map((b) => [b.label, b.nodes.map((n) => n.id)]), [["Yes", ["n3"]], ["No", ["n4"]]]);
    assert.deepEqual(shown.steps[1].branches[0].nodes[0].cfg, { body: "Thanks {{first_name}}. Book here: {{booking_link}} Reply STOP to opt out.", delay: "instant" });
    assert.equal(await page.locator("#askin").inputValue(), "", "the words typed are not left in the box once the answer is waiting");

    // Where each step landed: at the very top, in the Yes path after n3, one rewritten in place, one removed.
    const main = async () => page.locator("#canvas .rail > .nrow").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-id")));
    const lane = async (n) => page.locator("#canvas .lanes > .lane").nth(n).locator(".nrow b").allTextContents();
    const mainIds = await main();
    assert.equal(mainIds.length, 4);
    assert.deepEqual(mainIds.slice(1), ["n1", "n2", "n5"], "the delete took n6 out");
    assert.equal(await page.locator(`#canvas .nrow[data-id="${mainIds[0]}"] b`).textContent(), "Pause at the start", "after start puts the step first");
    assert.deepEqual(await lane(0), ["Text the booking link", "Yes path nudge"], "the path option puts the step in that path, after n3");
    assert.deepEqual(await lane(1), ["Email a nudge"]);
    assert.match(await page.locator("#canvas .bar .what").innerText(), /^Reworked the survey follow-up\. 2 new steps, 1 changed, 1 removed — highlighted above\./);

    // A rewrite that names only some settings keeps the others; an inserted step is filled with its defaults.
    await clickStep(page, "n1");
    assert.equal(await page.locator('#pbody [data-k="delay"]').inputValue(), "after 2 hours");
    assert.match(await page.locator('#pbody [data-k="body"]').inputValue(), /^Hi \{\{first_name\}\}, here is the survey/, "the body was not touched");
    await clickStep(page, mainIds[0]);
    assert.deepEqual([await page.locator('#pbody [data-k="amount"]').inputValue(), await page.locator('#pbody [data-k="unit"]').inputValue()], ["1", "days"]);
    const nudge = page.locator("#canvas .lanes > .lane").nth(0).locator(".nrow").nth(1);
    await nudge.locator(".node").click();
    assert.equal(await page.locator('#pbody [data-k="delay"]').inputValue(), "instant");

    // Throw it away puts all of it back, the removed step included.
    await page.locator("#reject").click();
    assert.deepEqual(await titles(page), original);
    assert.equal(await page.locator("#dirty").textContent(), "");

    // Keep it: the removal stays, and History says Claude made it.
    await page.locator("#askin").fill("Rework the survey follow-up");
    await page.locator("#asksend").click();
    await page.locator("#accept").waitFor();
    await page.locator("#accept").click();
    assert.deepEqual((await main()).slice(1), ["n1", "n2", "n5"]);
    assert.match(await toastText(page), /Kept it\. 4 changes accepted for this journey\./, "two added, one changed and one removed");
    await page.locator('.ptab[data-tab="hist"]').click();
    assert.equal(await page.locator("#pbody .sect").nth(1).locator(".li").first().locator(".who").textContent(), "Claude · Client");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a second press while an answer is on its way sends nothing more", { timeout: 60_000 }, async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { page, seen, errors } = await openJourneys({ ask: async () => { await gate; return { ok: true, text: JSON.stringify(PATCH) }; } });
  await proof.check(/^Step panel: 'Make the change' \(AI rewrites one step\) and canvas ask box/, async () => {
    await clickStep(page, "n5");
    await page.locator("#sprompt").fill("Make it two days");
    await page.locator("#sgo").click();
    await waitFor(() => seen.asks.length === 1, "the first ask");
    assert.match(await page.locator("#canvas .ask").innerText(), /Working out the change/);
    await page.locator("#sgo").click();
    await page.locator("#sgo").click();
    await page.waitForTimeout(150);
    assert.equal(seen.asks.length, 1, "pressing again while it works asks nothing more");
    release();
    await page.locator("#accept").waitFor();
    assert.equal(seen.asks.length, 1);
    await page.locator("#reject").click();
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("an AI answer that only removes a step waits for Keep it and remains undoable", { timeout: 60_000 }, async () => {
  const onlyDelete = { summary: "Removed the last note.", ops: [{ op: "delete", id: "n6" }] };
  const { page, errors } = await openJourneys({ ask: () => ({ ok: true, text: JSON.stringify(onlyDelete) }) });
  await proof.check(/^Step panel: 'Make the change' \(AI rewrites one step\) and canvas ask box/, async () => {
    assert.equal((await rowIds(page)).includes("n6"), true);
    await page.locator("#askin").fill("Remove the last note");
    await page.locator("#asksend").click();
    await waitFor(async () => (await page.locator("#accept").count()) + (await page.locator("#canvas .askerr").count()) > 0, "the answer");
    assert.equal(await page.locator("#canvas .askerr").count(), 0, "a valid removal is not called empty");
    assert.equal((await rowIds(page)).includes("n6"), false, "the proposed removal is shown on the canvas");
    assert.equal(await page.locator("#accept").count(), 1, "the removal can be kept");
    assert.equal(await page.locator("#reject").count(), 1, "or thrown away");
    assert.match(await page.locator("#canvas .bar .what").innerText(), /1 removed/);
    assert.equal(await page.locator("#dirty").textContent(), "", "a proposal is not counted before it is kept");
    await page.locator("#accept").click();
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
    assert.equal(await page.locator("#undo").isDisabled(), false);
    await page.locator("#undo").click();
    assert.equal((await rowIds(page)).includes("n6"), true, "Undo restores the removed step");
    assert.equal(await page.locator("#dirty").textContent(), "");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("the step panel's Make the change rewrites that one step in place, tagged Changed until it is kept", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys({
    ask: (body) => (/looking at step "n5"/.test(body.user) ? { ok: true, text: JSON.stringify(PATCH_UPDATE) } : { ok: true, text: JSON.stringify(PATCH) }),
  });
  assert.equal((await titles(page)).includes("Wait a day"), true);
  await clickStep(page, "n5");
  await page.locator("#sprompt").fill("Make it two days");
  await page.locator("#sgo").click();
  await page.locator("#accept").waitFor();
  assert.equal(seen.asks.length, 1);
  // The same step, rewritten, with a Changed tag; no step added.
  const row = page.locator('#canvas .nrow[data-id="n5"]');
  assert.equal(await row.locator("b").textContent(), "Wait two days");
  assert.equal(await row.locator(".tagpill.c").textContent(), "Changed");
  assert.match(await row.locator(".nsub").textContent(), /Nothing happens for 2 days/);
  assert.equal(await page.locator("#canvas .nrow").count(), countSteps(TREES.client.nodes));
  // Throw it away: the old words are back.
  await page.locator("#reject").click();
  assert.equal(await page.locator('#canvas .nrow[data-id="n5"] b').textContent(), "Wait a day");
  assert.match(await page.locator('#canvas .nrow[data-id="n5"] .nsub').textContent(), /Nothing happens for 1 days/);
  // Ask again and keep it: the rewrite stays and the tag goes.
  await clickStep(page, "n5");
  await page.locator("#sprompt").fill("Make it two days");
  await page.locator("#sgo").click();
  await page.locator("#accept").waitFor();
  await page.locator("#accept").click();
  assert.equal(await page.locator('#canvas .nrow[data-id="n5"] b').textContent(), "Wait two days");
  assert.equal(await page.locator('#canvas .nrow[data-id="n5"] .tagpill').count(), 0);
  assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
  assert.equal(seen.puts.length, 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("page load: a saved journey replaces the page's example; a journey with no steps or no row leaves the example", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: { setter: TREES.setter, closer: { ...TREES.closer, nodes: [] } } });
  const open = async (index) => {
    await page.locator("#jlist .jrow").nth(index).click();
    await page.waitForTimeout(50);
    return { name: await page.locator("#canvas .chead h1").textContent(), desc: await page.locator("#canvas .chead p").textContent(), steps: await page.locator("#canvas .nrow").count() };
  };
  const setter = await open(1);
  assert.deepEqual(setter, { name: "Setter", desc: TREES.setter.desc, steps: 2 }, "the saved Setter journey is what shows");
  const client = await open(0);
  assert.equal(client.name, "Client");
  assert.notEqual(client.desc, TREES.client.desc);
  assert.ok(client.steps > 5, "no saved Client row: the page's own example, with its steps");
  const closer = await open(2);
  assert.equal(closer.name, "Closer");
  assert.notEqual(closer.desc, TREES.closer.desc, "a saved row with no steps is not drawn: the example shows instead");
  assert.ok(closer.steps > 1);
  assert.equal(seen.gets, 1, "one read of the saved journeys");
  assert.deepEqual(errors, []);
  await page.close();
});

test("an AI answer waits on the bar: Throw it away removes it, Keep it makes it part of the journey", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check(/^Canvas: 'Keep it' \/ 'Throw it away' on an AI patch/, async () => {
    const before = await titles(page);
    await page.locator("#askin").fill("Add a follow-up if they go quiet");
    await page.locator("#asksend").click();
    await page.locator("#accept").waitFor();
    // Staged: the new step is drawn with a New tag, the bar says nothing is saved yet.
    const staged = await titles(page);
    assert.deepEqual(staged, [before[0], "Follow up if they go quiet", ...before.slice(1)]);
    assert.equal(await page.locator("#canvas .nrow .tagpill.n").count(), 1);
    assert.equal(await page.locator("#canvas .nrow .tagpill.n").textContent(), "New");
    assert.match(await page.locator("#canvas .bar .what").innerText(), /Added a follow-up text\. 1 new step — highlighted above\. Nothing is saved until you keep it\./);
    // While a patch is waiting the journey tabs do not switch.
    await page.locator("#jlist .jrow").nth(1).click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Client");

    await page.locator("#reject").click();
    assert.deepEqual(await titles(page), before, "Throw it away puts the journey back exactly");
    assert.equal(await page.locator("#accept").count(), 0);
    assert.equal(await page.locator("#dirty").textContent(), "", "and counts as no change");
    assert.equal(await page.locator("#undo").isDisabled(), true, "and leaves nothing for Undo to undo");
    await page.keyboard.press("Control+z");
    assert.deepEqual(await titles(page), before, "Ctrl+Z after Throw it away changes nothing");
    assert.equal(await page.locator("#canvas .nrow .tagpill").count(), 0);
    await page.locator('.ptab[data-tab="hist"]').click();
    assert.match(await page.locator("#pbody").innerText(), /Nothing changed yet\./, "a thrown-away answer leaves no History entry");
    await page.locator('.ptab[data-tab="step"]').click();

    await page.locator("#askin").fill("Add a follow-up if they go quiet");
    await page.locator("#asksend").click();
    await page.locator("#accept").waitFor();
    await page.locator("#accept").click();
    assert.deepEqual(await titles(page), staged, "Keep it leaves the new step in place");
    assert.equal(await page.locator("#canvas .nrow .tagpill.n").count(), 0, "and takes the New tag off");
    assert.match(await toastText(page), /Kept it\. 1 step now part of this journey\. Not in the code until you press Apply\./);
    assert.equal(await page.locator("#dirty").textContent(), "1 unsaved");
    assert.equal(await page.locator("#canvas .bar #applybar").count(), 1, "the apply bar takes over from the keep bar");
    assert.equal(seen.puts.length, 0, "keeping a step is not saving it");
    assert.equal(seen.asks.length, 2);
    // What was kept is in History as Claude's change, with its own Put it back.
    await page.locator('.ptab[data-tab="hist"]').click();
    const entry = page.locator("#pbody .sect").nth(1).locator(".li").first();
    assert.equal(await entry.locator(".who").textContent(), "Claude · Client");
    assert.equal(await entry.locator(".wt").textContent(), "Added a follow-up text.");
    assert.equal(await entry.locator(".rv[data-rev]").count(), 1);
    // And it can be undone: the kept step goes and the count goes back to nothing.
    assert.equal(await page.locator("#undo").isDisabled(), false);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await titles(page), before);
    assert.equal(await page.locator("#dirty").textContent(), "");
  });

  // A rewrite of one step (nothing added) is counted too: the words say one step, not none.
  const rewrite = await openJourneys({
    ask: (body) => (/looking at step "n5"/.test(body.user) ? { ok: true, text: JSON.stringify(PATCH_UPDATE) } : { ok: true, text: JSON.stringify(PATCH) }),
  });
  await clickStep(rewrite.page, "n5");
  await rewrite.page.locator("#sprompt").fill("Make it two days");
  await rewrite.page.locator("#sgo").click();
  await rewrite.page.locator("#accept").waitFor();
  assert.match(await rewrite.page.locator("#canvas .bar .what").innerText(), /Made the wait two days\. 1 changed — highlighted above\./);
  await rewrite.page.locator("#accept").click();
  assert.match(await toastText(rewrite.page), /Kept it\. 1 step now part of this journey\. Not in the code until you press Apply\./);
  await rewrite.page.close();
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Save version, History ──────────────────────────────────────────────────────────────────────────────

test("Save version asks for a name, keeps a copy in History, and a cancelled name keeps nothing", { timeout: 60_000 }, async () => {
  const { page, talk, seen, errors } = await openJourneys();
  await proof.check("Header: Save version", async () => {
    // Cancel: nothing kept.
    talk.next(false);
    await page.locator("#savever").click();
    await waitFor(() => talk.seen.length === 1, "the name prompt");
    assert.equal(talk.seen[0].type, "prompt");
    assert.equal(talk.seen[0].message, "Name this version");
    assert.match(talk.seen[0].defaultValue, /^Journey as of \S+/, "the name box opens with a name already in it");
    await page.locator('.ptab[data-tab="hist"]').click();
    assert.equal(await page.locator("#pbody .li .rv[data-ver]").count(), 0);
    assert.match(await page.locator("#pbody").innerText(), /No versions yet/);
    // An empty name is a cancel too.
    await page.locator('.ptab[data-tab="step"]').click();
    talk.next("");
    await page.locator("#savever").click();
    await waitFor(() => talk.seen.length === 2, "the second prompt");
    assert.equal(await page.locator("#pbody .li .rv[data-ver]").count(), 0);

    // A name: kept, History opens on it, with the journey's name and its step count.
    await page.locator('.ptab[data-tab="step"]').click();
    assert.equal(await page.locator('.ptab[data-tab="hist"]').getAttribute("aria-selected"), "false");
    talk.next("Before the nudge");
    await page.locator("#savever").click();
    await waitFor(() => talk.seen.length === 3, "the third prompt");
    assert.equal(await page.locator("#pbody .li .rv[data-ver]").count(), 1);
    assert.equal(await page.locator("#pbody .sect").first().locator(".li .wt").first().textContent(), "Before the nudge");
    assert.equal(await page.locator("#pbody .sect").first().locator(".li .wt").nth(1).textContent(), `Client · ${countSteps(TREES.client.nodes)} steps`);
    assert.match(await toastText(page), /Saved\. You can come back to “Before the nudge” at any point\./);
    assert.equal(await page.locator('.ptab[data-tab="hist"]').getAttribute("aria-selected"), "true");
    assert.match(await page.locator("#pbody .sect").first().locator(".li .when").first().textContent(), /\d/, "the copy says when it was kept");

    // A second version, of another journey: it is filed under that journey and listed first, the newest on top.
    await page.locator("#jlist .jrow").nth(1).click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Setter");
    talk.next("Setter as it was");
    await page.locator("#savever").click();
    await waitFor(() => talk.seen.length === 4, "the fourth prompt");
    const versions = page.locator("#pbody .sect").first().locator(".li");
    assert.equal(await versions.count(), 2);
    assert.equal(await versions.nth(0).locator(".wt").first().textContent(), "Setter as it was", "the newest version is first");
    assert.equal(await versions.nth(0).locator(".wt").nth(1).textContent(), `Setter · ${countSteps(TREES.setter.nodes)} steps`, "filed under the journey it was kept from");
    assert.equal(await versions.nth(1).locator(".wt").first().textContent(), "Before the nudge");
    assert.equal(await versions.nth(1).locator(".wt").nth(1).textContent(), `Client · ${countSteps(TREES.client.nodes)} steps`);
    assert.equal(seen.puts.length, 0, "a named copy is kept in the page, not saved to the database");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("History: Roll back puts a saved version back, Put it back undoes one change", { timeout: 60_000 }, async () => {
  const { page, talk, seen, errors } = await openJourneys();
  await proof.check(/^History tab: 'Roll back to this' \(saved version\) and 'Put it back'/, async () => {
    const original = await titles(page);
    talk.next("Original");
    await page.locator("#savever").click();
    await page.locator("#pbody .rv[data-ver]").waitFor();

    // Two changes after the saved version: the last step is deleted and the first is renamed.
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    await clickStep(page, "n1");
    await page.locator('#pbody [data-k="title"]').fill("Renamed first step");
    await waitFor(async () => (await titles(page))[0] === "Renamed first step", "the rename");
    assert.equal((await titles(page)).at(-1), "Wait a day", "the last step is gone");
    await page.locator('.ptab[data-tab="hist"]').click();
    // The page writes a typed change into the history 900 ms after the last key, on its own. Wait for that entry
    // before the Roll back: if it landed later it would sit on top of the entries below and the order would
    // depend on how fast the machine is.
    await waitFor(async () => (await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents())[0] === "Edited Renamed first step", "the typed change in the history");

    // Roll back: the whole journey is the way it was at the saved version, the rename included.
    await page.locator("#pbody .rv[data-ver]").click();
    await waitFor(async () => JSON.stringify(await titles(page)) === JSON.stringify(original), "the saved version back");
    assert.match(await toastText(page), /Rolled back\. This journey is the way it was at “Original”\./);
    const log = await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents();
    assert.equal(log[0], "Rolled back to “Original”");

    // Put it back: one deleted step comes back through its own history entry, and the entry shows Reverted.
    await clickStep(page, "n5");
    await page.locator("#pbody .del").click();
    assert.equal((await titles(page)).includes("Wait a day"), false);
    await page.locator('.ptab[data-tab="hist"]').click();
    const entry = page.locator("#pbody .sect").nth(1).locator(".li").first();
    assert.equal(await entry.locator(".wt").first().textContent(), "Deleted a step: Wait a day");
    await entry.locator(".rv[data-rev]").click();
    await waitFor(async () => JSON.stringify(await titles(page)) === JSON.stringify(original), "the deleted step back");
    assert.match(await toastText(page), /Reverted\. Deleted a step: Wait a day — put back the way it was\./);
    const entries = page.locator("#pbody .sect").nth(1).locator(".li");
    assert.equal(await entries.first().locator(".wt").textContent(), "Reverted: Deleted a step: Wait a day", "the put-back is itself in the history");
    const undone = entries.nth(1);
    assert.equal(await undone.locator(".wt").textContent(), "Deleted a step: Wait a day");
    assert.equal(await undone.locator(".rv").textContent(), "Reverted", "the entry that was put back is marked");
    assert.equal(await undone.locator(".rv").isDisabled(), true, "and it cannot be pressed again");
    assert.equal(seen.puts.length, 0, "history lives in the page: nothing is saved");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("History: Roll back picks the version asked for, opens its journey, counts as a change and can be undone", { timeout: 90_000 }, async () => {
  const { page, talk, seen, errors } = await openJourneys();
  await proof.check(/^History tab: 'Roll back to this' \(saved version\) and 'Put it back'/, async () => {
    const original = await titles(page);
    // Two saved versions, then two more changes.
    talk.next("V1 full journey");
    await page.locator("#savever").click();
    await page.locator("#pbody .rv[data-ver]").waitFor();
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    const withoutLast = await titles(page);
    talk.next("V2 no last step");
    await page.locator("#savever").click();
    await waitFor(async () => (await page.locator("#pbody .rv[data-ver]").count()) === 2, "two saved versions");
    await clickStep(page, "n5");
    await page.locator("#pbody .del").click();
    const current = await titles(page);
    assert.equal(current.length, original.length - 2);
    assert.equal(await page.locator("#dirty").textContent(), "2 unsaved");

    // The older version is on the second row; pressing it brings that one back, not the newest.
    await page.locator('.ptab[data-tab="hist"]').click();
    const versions = page.locator("#pbody .sect").first().locator(".li");
    assert.equal(await versions.nth(0).locator(".wt").first().textContent(), "V2 no last step");
    assert.equal(await versions.nth(1).locator(".wt").first().textContent(), "V1 full journey");
    await versions.nth(1).locator(".rv[data-ver]").click();
    await waitFor(async () => JSON.stringify(await titles(page)) === JSON.stringify(original), "version 1 back");
    assert.notDeepEqual(await titles(page), withoutLast);
    assert.match(await toastText(page), /Rolled back\. This journey is the way it was at “V1 full journey”\./);
    // It counts as a change: the count goes up by one and Apply sends the rolled-back journey.
    assert.equal(await page.locator("#dirty").textContent(), "3 unsaved");
    assert.match(await page.locator("#canvas .bar .what").innerText(), /^3 changes not applied\./);
    // And it can be undone: Ctrl+Z puts the journey back the way it was just before.
    assert.equal(await page.locator("#undo").isDisabled(), false);
    await page.keyboard.press("Control+z");
    assert.deepEqual(await titles(page), current, "Undo returns to the journey as it was before the Roll back");
    // Roll back to the older version once more and send it.
    await page.locator('.ptab[data-tab="hist"]').click();
    await page.locator("#pbody .sect").first().locator(".li").nth(1).locator(".rv[data-ver]").click();
    await waitFor(async () => JSON.stringify(await titles(page)) === JSON.stringify(original), "version 1 back again");
    await page.locator("#apply").click();
    await waitFor(() => seen.puts.length === 1, "the save request");
    assert.deepEqual(seen.puts[0].nodes.map((n) => n.id), TREES.client.nodes.map((n) => n.id), "Apply sends the rolled-back journey");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("History: Put it back undoes a typed change, a delete on another journey, and is counted as a change", { timeout: 90_000 }, async () => {
  const { page, errors } = await openJourneys();
  await proof.check(/^History tab: 'Roll back to this' \(saved version\) and 'Put it back'/, async () => {
    const original = await titles(page);
    // A typed change: its entry holds the journey as it was BEFORE the typing, so Put it back returns the old words.
    await clickStep(page, "n1");
    await page.locator('#pbody [data-k="title"]').fill("Renamed first step");
    await page.locator('.ptab[data-tab="hist"]').click();
    await waitFor(async () => (await page.locator("#pbody .sect").nth(1).locator(".li .wt").allTextContents())[0] === "Edited Renamed first step", "the typed change in History");
    const before = await page.locator("#dirty").textContent();
    assert.equal((await titles(page))[0], "Renamed first step");
    await page.locator("#pbody .sect").nth(1).locator(".li").first().locator(".rv[data-rev]").click();
    await waitFor(async () => (await titles(page))[0] === "Text the survey link", "the old words back");
    assert.deepEqual(await titles(page), original);
    assert.match(await toastText(page), /Reverted\. Edited Renamed first step — put back the way it was\./);
    assert.notEqual(await page.locator("#dirty").textContent(), before, "putting a change back is a change");
    assert.equal(await page.locator("#dirty").textContent(), "2 unsaved");
  });

  await proof.check(/^History tab: 'Roll back to this' \(saved version\) and 'Put it back'/, async () => {
    // A delete on Client, then Setter is opened: Put it back from there puts the step back into CLIENT and leaves Setter alone.
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    assert.equal((await rowIds(page)).includes("n6"), false);
    await page.locator("#jlist .jrow").nth(1).click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Setter");
    await page.locator('.ptab[data-tab="hist"]').click();
    const entry = page.locator("#pbody .sect").nth(1).locator(".li").first();
    assert.equal(await entry.locator(".who").textContent(), "You · Client");
    assert.equal(await entry.locator(".wt").textContent(), "Deleted a step: Save a note");
    await entry.locator(".rv[data-rev]").click();
    await waitFor(async () => (await page.locator("#pbody .sect").nth(1).locator(".li .wt").first().textContent()).startsWith("Reverted"), "the put-back");
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Setter", "the open journey did not change");
    assert.deepEqual(await titles(page), flatTitles(TREES.setter.nodes), "Setter is exactly Setter's own steps");
    await page.locator("#jlist .jrow").nth(0).click();
    assert.equal((await rowIds(page)).includes("n6"), true, "the deleted step is back in Client");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("History: a saved version of another journey opens that journey when it is rolled back", { timeout: 60_000 }, async () => {
  const { page, talk, errors } = await openJourneys();
  await proof.check(/^History tab: 'Roll back to this' \(saved version\) and 'Put it back'/, async () => {
    await page.locator("#jlist .jrow").nth(1).click();
    talk.next("Setter first copy");
    await page.locator("#savever").click();
    await page.locator("#pbody .rv[data-ver]").waitFor();
    await clickStep(page, "n8");
    await page.locator("#pbody .del").click();
    assert.equal((await rowIds(page)).includes("n8"), false);
    // Go to Client and roll the Setter version back from there.
    await page.locator("#jlist .jrow").nth(0).click();
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Client");
    await page.locator('.ptab[data-tab="hist"]').click();
    await page.locator("#pbody .rv[data-ver]").first().click();
    await waitFor(async () => (await page.locator("#canvas .chead h1").textContent()) === "Setter", "Setter opened");
    assert.deepEqual(await titles(page), flatTitles(TREES.setter.nodes), "Setter has its saved steps back");
    await page.locator("#jlist .jrow").nth(0).click();
    assert.deepEqual(await titles(page), flatTitles(TREES.client.nodes), "and Client was not touched");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Simulate, Run from here ────────────────────────────────────────────────────────────────────────────

// The email on the No path carries merge tags the simulator fills in: one with spaces inside the braces, one it has no
// value for (it must stay as written), and the portal link.
const SIM_NODES = JSON.parse(JSON.stringify(QUESTION_TREE));
SIM_NODES[1].branches[1].nodes[0].cfg = {
  subject: "Still there, {{first_name}}?",
  body: "We still have your spot, {{ company }}. Portal: {{portal_link}} {{mystery_tag}}",
  delay: "instant",
};
const SIM_TREE = {
  ...TREES,
  client: { ...TREES.client, nodes: SIM_NODES },
};

/** Advance the page's paused clock until the run says it is finished, in small steps. */
async function runToEnd(page) {
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator("#pbody .runstat").textContent().then((t) => /finished/.test(t)).catch(() => false)) return;
    await page.clock.runFor(1000);
  }
  throw new Error("the simulated run never finished");
}

test("Simulate: the select picks which path a question takes, Run plays the journey, Stop halts it, nothing is sent", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: SIM_TREE, clock: true });
  await page.clock.runFor(100);
  await proof.check(/^Simulate tab: 'At a question' select \+ Run the journey \/ Stop/, async () => {
    await page.locator('.ptab[data-tab="sim"]').click();
    assert.match(await page.locator("#pbody .testbanner").innerText(), /Test mode — nothing is sent\./);
    const modes = await page.locator('[data-sim="mode"] option').evaluateAll((o) => o.map((x) => [x.value, x.textContent]));
    assert.deepEqual(modes, [["first", "Take the first path"], ["second", "Take the second path"], ["both", "Run both paths"]]);
    const requestsBefore = seen.requests.length;
    const feedOf = async () => page.locator("#pbody .feed .evt span:last-child, #pbody .feed .msg").allInnerTexts();
    const report = async () => {
      const rows = await page.locator("#pbody .report .rrow").allInnerTexts();
      return Object.fromEntries(rows.map((r) => r.split("\n").map((s) => s.trim()).filter(Boolean)).map(([k, v]) => [k, v]));
    };

    // First path: Text the survey link, the question, the Yes path (booking text), wait, record.
    await page.locator("#simstart").click();
    await runToEnd(page);
    let feed = (await feedOf()).join("\n");
    assert.match(feed, /Started as Dana Reyes — Reyes Fabrication LLC/);
    assert.match(feed, /Took the “Yes” path/);
    assert.doesNotMatch(feed, /Took the “No” path/);
    assert.match(feed, /Hi Dana, here is the survey: fundhub\.ai\/s\/dq8f2 Reply STOP to opt out\./);
    assert.match(feed, /Thanks Dana\. Book here: fundhub\.ai\/b\/dq8f2/);
    assert.doesNotMatch(feed, /We still have your spot/);
    assert.match(feed, /Waited 1 days \(skipped ahead\)/, "a wait says how long it waited");
    assert.match(feed, /Checked: survey_complete is true/);
    assert.deepEqual(await report(), { "Steps that fired": "5", "Messages drafted (not sent)": "2", "Steps not reached": "1", "Sent to anyone": "No — test mode" });
    assert.equal(await page.locator("#pbody .msg .to").first().textContent().then((t) => t.startsWith("not sent")), true);
    assert.equal(await page.locator('[data-sim="mode"]').inputValue(), "first", "the box still shows the path that was chosen");
    // While it ran the canvas was held still and afterwards it is not.
    assert.equal(await page.evaluate(() => document.body.classList.contains("running")), true, "the page stays in run mode until Stop");

    // Second path.
    await page.locator('[data-sim="mode"]').selectOption("second");
    await page.locator("#simstart").click();
    await runToEnd(page);
    feed = (await feedOf()).join("\n");
    assert.match(feed, /Took the “No” path/);
    assert.doesNotMatch(feed, /Took the “Yes” path/);
    // The email's subject and body are filled in the way a text is, and a tag with no value stays as it was written.
    assert.match(feed, /Still there, Dana\?/);
    assert.match(feed, /We still have your spot, Reyes Fabrication LLC\. Portal: portal\.fundhub\.ai\/c\/dq8f2 \{\{mystery_tag\}\}/);
    assert.deepEqual(await report(), { "Steps that fired": "5", "Messages drafted (not sent)": "2", "Steps not reached": "1", "Sent to anyone": "No — test mode" });
    assert.equal(await page.locator('[data-sim="mode"]').inputValue(), "second");

    // Both paths.
    await page.locator('[data-sim="mode"]').selectOption("both");
    await page.locator("#simstart").click();
    await runToEnd(page);
    feed = (await feedOf()).join("\n");
    assert.match(feed, /Took the “Yes” path/);
    assert.match(feed, /Took the “No” path/);
    assert.deepEqual(await report(), { "Steps that fired": "6", "Messages drafted (not sent)": "3", "Steps not reached": "0", "Sent to anyone": "No — test mode" });
    assert.equal(await page.locator('[data-sim="mode"]').inputValue(), "both");

    // Stop halts a run in the middle: the feed stops growing and there is no report.
    await page.locator("#simstart").click();
    await page.clock.runFor(1400);
    assert.equal(await page.locator("#simstop").count(), 1, "Stop shows while it runs");
    const grown = (await feedOf()).length;
    assert.ok(grown >= 1);
    await page.locator("#simstop").click();
    await page.clock.runFor(10_000);
    assert.equal((await feedOf()).length, grown, "nothing more is added after Stop");
    assert.equal(await page.locator("#pbody .report").count(), 0);
    assert.equal(await page.locator("#simstart").count(), 1, "Run the journey is back");
    // Stop gives the canvas back: not in run mode, the ask box and the + buttons are there again.
    assert.equal(await page.evaluate(() => document.body.classList.contains("running")), false);
    assert.equal(await page.locator("#askin").count(), 1);
    assert.ok(await page.locator("#canvas .wire .add").count() >= 7);
    assert.equal(await page.locator("#canvas .nrow.now, #canvas .nrow.fired").count(), 0, "no step is left lit");
    assert.equal(seen.requests.length, requestsBefore, "the whole simulator put nothing on the wire");
    assert.equal(seen.puts.length + seen.runs.length, 0);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Run from here plays the journey from the picked step, in the Simulate tab, and sends nothing", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: SIM_TREE, clock: true });
  await page.clock.runFor(100);
  await proof.check(/^Step panel: 'Run from here'/, async () => {
    await clickStep(page, "n2"); // the question: from here the steps before it are skipped
    assert.equal(await page.locator("#runhere").count(), 1);
    const requestsBefore = seen.requests.length;
    await page.locator("#runhere").click();
    assert.equal(await page.locator('.ptab[data-tab="sim"]').getAttribute("aria-selected"), "true", "the Simulate tab opens");
    assert.equal(await page.evaluate(() => document.body.classList.contains("running")), true);
    await runToEnd(page);
    const feed = (await page.locator("#pbody .feed").innerText());
    assert.match(feed, /Started as Dana Reyes/);
    assert.doesNotMatch(feed, /here is the survey/, "the step before the picked one never plays");
    assert.match(feed, /Checked: survey_complete is true/);
    assert.match(feed, /Took the “Yes” path/);
    assert.match(feed, /Thanks Dana\. Book here/);
    const rows = await page.locator("#pbody .report .rrow").allInnerTexts();
    assert.match(rows[0], /Steps that fired\s+4/, "question, booking text, wait, record");
    assert.match(rows[1], /Messages drafted \(not sent\)\s+1/);
    assert.equal(seen.requests.length, requestsBefore, "nothing went on the wire");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Run from here starts at a picked step even when it sits on the other question path", { timeout: 60_000 }, async () => {
  const { page, errors } = await openJourneys({ trees: SIM_TREE, clock: true });
  await page.clock.runFor(100);
  await proof.check(/^Step panel: 'Run from here'/, async () => {
    await clickStep(page, "n4"); // "Email a nudge", on the No path; the simulator's first-path setting takes the Yes path
    await page.locator("#runhere").click();
    await runToEnd(page);
    const feed = await page.locator("#pbody .feed").innerText();
    assert.doesNotMatch(feed, /here is the survey/, "nothing before the picked step plays");
    assert.doesNotMatch(feed, /Took the “Yes” path|Took the “No” path/, "the run starts inside the chosen path");
    assert.match(feed, /Still there, Dana\?/);
    assert.match(feed, /We still have your spot/);
    const rows = await page.locator("#pbody .report .rrow").allInnerTexts();
    assert.match(rows[0], /Steps that fired\s+3/, "the picked email and the two outer steps after its question ran");
    assert.match(rows[1], /Messages drafted \(not sent\)\s+1/);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

// ── Test against the code, Run report Close ────────────────────────────────────────────────────────────

test("Test against the code: one request, the button shows it is working, the report is painted from the answer, Close puts it away", { timeout: 60_000 }, async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { page, seen, errors } = await openJourneys({ run: async () => { await gate; return RUN_ANSWER; } });

  await proof.check(/^Header: 'Test against the code'/, async () => {
    const button = page.locator("#runreal");
    assert.equal(await button.textContent(), "Test against the code");
    await button.click();
    await waitFor(() => seen.runs.length === 1, "the run request");
    assert.deepEqual(seen.runs[0], { method: "POST", body: {} }, "one POST with an empty body: nothing of the page's draft goes along");
    assert.equal(await button.textContent(), "Testing…");
    assert.equal(await button.isDisabled(), true);
    await button.click({ force: true }).catch(() => {});
    assert.equal(seen.runs.length, 1, "a second press while it runs sends nothing");
    release();
    await page.locator("#runout .jr-rcard").waitFor();
    assert.equal(await button.textContent(), "Test against the code");
    assert.equal(await button.isDisabled(), false);

    const card = page.locator("#runout .jr-rcard");
    assert.equal(await card.locator(".jr-rlead").textContent(), RUN_ANSWER.headline);
    const stats = await card.locator(".jr-rstats span").evaluateAll((list) => list.map((el) => [el.querySelector("i").textContent, el.lastChild.textContent]));
    assert.deepEqual(stats, [["6", "paths walked"], ["5", "test clients"], ["9", "messages that would send"], ["3/5", "automations reached"]]);
    assert.match(await card.textContent(), /Journeys read from: database\. Nothing was saved/);
    assert.match(await card.textContent(), /The code does not do this the way the journey says \(1\)[\s\S]*client · Text the survey link[\s\S]*The text was never written\./);
    assert.match(await card.textContent(), /Automations no journey reaches \(2\)[\s\S]*wf-unused, wf-old/);
    assert.match(await card.textContent(), /1 touched by a journey and showing real data · 0 touched but still a mock-up · 2 touched by no journey/);
  });

  await proof.check(/^Run report panel: Close button/, async () => {
    assert.equal(await page.locator("#runout .jr-rcard").count(), 1);
    await page.locator("#runclose").click();
    assert.equal(await page.locator("#runout").count(), 0, "the report is gone");
    assert.equal(seen.runs.length, 1, "closing sends nothing");
  });
  assert.equal(seen.puts.length, 0);
  assert.deepEqual(errors, []);
  await page.close();

  // Every section of the report is painted from the answer: what held messages back, the rows left out, the
  // journeys nothing can start, what could not be checked, the nothing-found words, and an unreadable screens folder.
  const held = await openJourneys({ run: () => RUN_HELD });
  await proof.check(/^Header: 'Test against the code'/, async () => {
    await held.page.locator("#runreal").click();
    await held.page.locator("#runout .jr-rcard").waitFor();
    const text = await held.page.locator("#runout .jr-rcard").textContent();
    assert.match(text, /Journeys read from: seed\./);
    assert.match(text, /What held messages back/);
    assert.match(text, /The safety fence stopped 2 paths/);
    assert.match(text, /Reason given: the routing names a provider that can transmit/);
    assert.match(text, /1 message held by the compliance gate/);
    assert.match(text, /1 path ran out of sending rounds/);
    assert.match(text, /Rows in the table this test left out \(1\)[\s\S]*demo-platform-nurture[\s\S]*Demo Mode example/);
    assert.match(text, /Journeys nothing can start \(1\)[\s\S]*partner[\s\S]*no canonical opening event/);
    assert.match(text, /Could not check \(1\)[\s\S]*advisor · Submit the round[\s\S]*The pipelines table could not be read\./);
    assert.match(text, /The code does not do this the way the journey says \(0\)[\s\S]*Nothing — which on a first run usually means the check itself is not working\./);
    assert.match(text, /Automations no journey reaches \(0\)[\s\S]*Every automation is reached by some journey\./);
    assert.match(text, /The screens folder could not be read on this run, so no screen was checked\./);
    assert.doesNotMatch(text, /touched by a journey and showing real data/, "no screen count is shown when the folder could not be read");
  });
  await held.page.close();
  // A clean run says the opposite, in the same places: nothing held back and the screens counted.
  const clean = await openJourneys({ run: () => ({ ...RUN_ANSWER, journeysSkipped: [], startEventFindings: [], screensUnreadable: false, summary: { ...RUN_ANSWER.summary, findings: { broken: [], couldNotCheck: [] }, workflows: { fired: ["wf-a"], registered: 1, neverFired: [] }, screens: { touchedAndWired: [], touchedAndWireframe: [{ file: "brand-studio.html" }], touchedByNoJourney: [] } } }) });
  await clean.page.locator("#runreal").click();
  await clean.page.locator("#runout .jr-rcard").waitFor();
  const cleanText = await clean.page.locator("#runout .jr-rcard").textContent();
  assert.doesNotMatch(cleanText, /What held messages back/);
  assert.doesNotMatch(cleanText, /Rows in the table this test left out/);
  assert.match(cleanText, /Could not check \(0\)[\s\S]*Everything could be checked\./);
  assert.match(cleanText, /Mock-ups a journey needs: brand-studio\.html/);
  await clean.page.close();

  // A refused or failed run says so in words and puts the button back.
  const signedOut = await openJourneys({ run: () => ({ status: 401, body: { ok: false, error: "unauthorized" } }) });
  await signedOut.page.locator("#runreal").click();
  await waitFor(async () => /Not allowed\. Only an owner or admin can run this\./.test(await toastText(signedOut.page).catch(() => "")), "the not-allowed words for a signed-out session");
  await signedOut.page.close();
  const refused = await openJourneys({ run: () => ({ status: 403, body: { ok: false, error: "forbidden" } }) });
  await refused.page.locator("#runreal").click();
  await waitFor(async () => /Not allowed\. Only an owner or admin can run this\./.test(await toastText(refused.page).catch(() => "")), "the not-allowed words");
  assert.equal(await refused.page.locator("#runreal").textContent(), "Test against the code");
  assert.equal(await refused.page.locator("#runout").count(), 0);
  await refused.page.close();
  const down = await openJourneys({ run: () => ({ status: 503, body: { ok: false, error: "db_unavailable" } }) });
  await down.page.locator("#runreal").click();
  await waitFor(async () => /The database is not reachable\. Nothing was run\./.test(await toastText(down.page).catch(() => "")), "the database words");
  await down.page.close();
  const broke = await openJourneys({ run: () => ({ status: 500, body: { ok: false, error: "run_failed" } }) });
  await broke.page.locator("#runreal").click();
  await waitFor(async () => /Could not run\. run_failed/.test(await toastText(broke.page).catch(() => "")), "the could-not-run words");
  assert.equal(await broke.page.locator("#runout").count(), 0);
  await broke.page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
