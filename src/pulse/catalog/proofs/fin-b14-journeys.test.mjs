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
    assert.match(await page.locator('#pbody [data-k="body"]').inputValue(), /here is the survey/);
    // A second click moves the selection; the first is no longer selected.
    await clickStep(page, "n5");
    assert.equal(await page.locator('#canvas .nrow[data-id="n1"]').getAttribute("aria-selected"), "false");
    assert.equal(await page.locator('#canvas .nrow[data-id="n5"]').getAttribute("aria-selected"), "true");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Wait a day");
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Wait");
    // A step inside a question's path is pickable too.
    await clickStep(page, "n4");
    assert.equal(await page.locator("#pbody .ptitle").textContent(), "Email a nudge");
    assert.equal(await page.locator("#pbody .pmeta").textContent(), "Send an email");
    // Picking a step changes nothing in the journey.
    assert.equal(await page.locator("#dirty").textContent(), "");
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

test("step fields: every kind of step shows its own boxes, and what is typed is what gets saved", { timeout: 90_000 }, async () => {
  const { page, seen, errors } = await openJourneys({ trees: ALL_KINDS });
  await proof.check(/^Step panel fields: text body and timing/, async () => {
    const fieldKeys = async () => page.locator("#pbody [data-k]").evaluateAll((list) => list.map((el) => el.getAttribute("data-k")));
    const options = async (key) => page.locator(`#pbody [data-k="${key}"] option`).allTextContents();
    const pick = async (id) => { await clickStep(page, id); };

    await pick("k1");
    assert.deepEqual(await fieldKeys(), ["title", "body", "delay"]);
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
    assert.equal((await options("stage")).length, 15);
    assert.equal((await options("pipeline")).length, 8);
    await page.locator('#pbody [data-k="stage"]').selectOption("Funded");
    await page.locator('#pbody [data-k="pipeline"]').selectOption("Funding: Card Stacking");

    await pick("k6");
    assert.deepEqual(await fieldKeys(), ["title", "role"]);
    assert.deepEqual(await options("role"), ["Client", "Setter", "Closer", "Funding Advisor", "Inquiry Specialist", "Owner", "Affiliate", "Partner"]);
    await page.locator('#pbody [data-k="role"]').selectOption("Owner");

    await pick("k7");
    assert.deepEqual(await fieldKeys(), ["title", "role", "stage"]);
    await page.locator('#pbody [data-k="role"]').selectOption("Funding Advisor");
    await page.locator('#pbody [data-k="stage"]').fill("File Received");

    await pick("k8");
    assert.deepEqual(await fieldKeys(), ["title", "agent", "note"]);
    assert.deepEqual(await options("agent"), ["UnderwriteIQ", "Setter Josh", "Brand Studio", "Inquiry Voice", "Alerts Engine"]);
    await page.locator('#pbody [data-k="agent"]').selectOption("Inquiry Voice");
    await page.locator('#pbody [data-k="note"]').fill("Call the bureau.");

    await pick("k9");
    assert.deepEqual(await fieldKeys(), ["title", "amount", "product"]);
    await page.locator('#pbody [data-k="amount"]').fill("49.50");
    await page.locator('#pbody [data-k="product"]').fill("Roadmap");

    await pick("k10");
    assert.deepEqual(await fieldKeys(), ["title", "note"]);
    await page.locator('#pbody [data-k="note"]').fill("Saved to the file.");

    // The canvas follows what was typed (no save yet), and Apply sends exactly the typed values.
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
    assert.deepEqual(byId.k7, { role: "Funding Advisor", stage: "File Received" });
    assert.deepEqual(byId.k8, { agent: "Inquiry Voice", note: "Call the bureau." });
    assert.deepEqual(byId.k9, { amount: "49.50", product: "Roadmap" });
    assert.deepEqual(byId.k10, { note: "Saved to the file." });
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

test("Undo (button and Ctrl+Z) steps back one change at a time and goes dark when there is nothing to undo", { timeout: 60_000 }, async () => {
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
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Discard puts the journey back to the saved one, not to the page's own example", { timeout: 60_000 }, async () => {
  const { page, seen, errors } = await openJourneys();
  await proof.check(/^Bottom bar: Discard/, async () => {
    assert.equal(await page.locator("#discard").count(), 0, "no bar until something changes");
    await clickStep(page, "n1");
    await page.locator('#pbody [data-k="title"]').fill("A renamed first step");
    await clickStep(page, "n6");
    await page.locator("#pbody .del").click();
    assert.equal(await page.locator("#canvas .bar .what").innerText().then((t) => t.split(".")[0]), "2 changes not applied");
    assert.equal((await titles(page))[0], "A renamed first step");
    await page.locator("#discard").click();
    assert.equal(await page.locator("#discard").count(), 0, "the bar goes away");
    assert.equal(await page.locator("#dirty").textContent(), "");
    assert.deepEqual(await titles(page), flatTitles(TREES.client.nodes), "the saved journey is back, step for step");
    assert.equal(await page.locator("#canvas .chead h1").textContent(), "Client");
    assert.equal(seen.puts.length, 0, "Discard saves nothing");
  });
  assert.deepEqual(errors, []);
  await page.close();
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
  });
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
    await page.locator('.ptab[data-tab="hist"]').click();
    assert.equal(await page.locator("#pbody .li .rv[data-ver]").count(), 0);
    assert.match(await page.locator("#pbody").innerText(), /No versions yet/);

    // A name: kept, History opens on it, with the journey's name and its step count.
    await page.locator('.ptab[data-tab="step"]').click();
    assert.equal(await page.locator('.ptab[data-tab="hist"]').getAttribute("aria-selected"), "false");
    talk.next("Before the nudge");
    await page.locator("#savever").click();
    await waitFor(() => talk.seen.length === 2, "the second prompt");
    assert.equal(await page.locator("#pbody .li .rv[data-ver]").count(), 1);
    assert.equal(await page.locator("#pbody .sect").first().locator(".li .wt").first().textContent(), "Before the nudge");
    assert.equal(await page.locator("#pbody .sect").first().locator(".li .wt").nth(1).textContent(), `Client · ${countSteps(TREES.client.nodes)} steps`);
    assert.match(await toastText(page), /Saved\. You can come back to “Before the nudge” at any point\./);
    assert.equal(await page.locator('.ptab[data-tab="hist"]').getAttribute("aria-selected"), "true");
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

// ── Simulate, Run from here ────────────────────────────────────────────────────────────────────────────

const SIM_TREE = {
  ...TREES,
  client: { ...TREES.client, nodes: QUESTION_TREE },
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
    assert.deepEqual(await report(), { "Steps that fired": "5", "Messages drafted (not sent)": "2", "Steps not reached": "1", "Sent to anyone": "No — test mode" });
    assert.equal(await page.locator("#pbody .msg .to").first().textContent().then((t) => t.startsWith("not sent")), true);

    // Second path.
    await page.locator('[data-sim="mode"]').selectOption("second");
    await page.locator("#simstart").click();
    await runToEnd(page);
    feed = (await feedOf()).join("\n");
    assert.match(feed, /Took the “No” path/);
    assert.doesNotMatch(feed, /Took the “Yes” path/);
    assert.match(feed, /We still have your spot\./);
    assert.deepEqual(await report(), { "Steps that fired": "5", "Messages drafted (not sent)": "2", "Steps not reached": "1", "Sent to anyone": "No — test mode" });

    // Both paths.
    await page.locator('[data-sim="mode"]').selectOption("both");
    await page.locator("#simstart").click();
    await runToEnd(page);
    feed = (await feedOf()).join("\n");
    assert.match(feed, /Took the “Yes” path/);
    assert.match(feed, /Took the “No” path/);
    assert.deepEqual(await report(), { "Steps that fired": "6", "Messages drafted (not sent)": "3", "Steps not reached": "0", "Sent to anyone": "No — test mode" });

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

  // A refused or failed run says so in words and puts the button back.
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
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
