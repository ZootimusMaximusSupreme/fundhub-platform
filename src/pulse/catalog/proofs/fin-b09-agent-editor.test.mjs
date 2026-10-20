// Practice test (real page, fake /api answers) for the nine Agent Editor controls in batch 09:
// + New agent, the agent list row (and its discard confirm), the closer drill's New drill, Send and
// Enter key, the section folds, and the Identity name / Class / Owner boxes with Revert.
// It reads no live data. Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, dialogs, json, proofRows, sharedScreens, textsSeen, waitFor, watchText } from "./fin-b09-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const STAFF = [
  { id: "s-sw", name: "Sarah Whitfield", role: "sales_manager", status: "active" },
  { id: "s-jb", name: "Jordan Blake", role: "owner", status: "active" },
];
const GUARD = {
  block: "y".repeat(40),
  triggers: ["entry.captured"],
  escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour", when: "" },
  authority: { disc: 0, msgcap: 3, pay: false, contract: false, book: false, pull: false },
  flags: { noamount: false, noscore: false, attorney: false, quiet: false },
};
const LEAD = {
  code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing", channel: "sms", status: "draft",
  runtime: null, owner_label: "Sarah Whitfield", prompt: "x".repeat(80), guardrails: GUARD,
  prompt_missing: false, guardrails_missing: false,
};
const CHASER = {
  code: "AG-03", name: "Review Chaser", agent_class: "ops", channel: "email", status: "shadow",
  runtime: null, owner_label: "Jordan Blake", prompt: "z".repeat(80), guardrails: GUARD,
  prompt_missing: false, guardrails_missing: false,
};
const COACH = {
  code: "OP-06", name: "Closer drill coach", agent_class: "ops", channel: "internal", status: "shadow",
  runtime: null, owner_label: "Jordan Blake", prompt: "c".repeat(80), guardrails: GUARD,
  prompt_missing: false, guardrails_missing: false,
};

// One editor, opened the same way every time. The agent list answers only after the people lists
// are painted: the page blanks the saved owner when the agents arrive first (product finding in
// the S2 manifest), and this proof is about the controls, not that race.
async function openEditor({ agents = [LEAD, CHASER, COACH], reply = {} } = {}) {
  const writes = [];
  const shadowReads = [];
  const holder = {};
  const handlers = {
    "/api/read/staff": { ok: true, count: STAFF.length, limit: 200, offset: 0, hasMore: false, items: STAFF },
    "/api/read/agent-shadow-log": async (route, { url }) => {
      shadowReads.push(new URL(url).searchParams.get("code"));
      return json(route, { ok: true, log: [], rows: [] });
    },
    "/api/read/agents": async (route) => {
      await holder.page.waitForFunction(() => document.querySelectorAll("#a_owner option").length > 1);
      return json(route, { ok: true, count: agents.length, limit: 200, offset: 0, hasMore: false, items: agents });
    },
    "/api/agents": async (route) => {
      const body = bodyOf(route);
      writes.push(body);
      const custom = reply[body.action];
      if (custom) return json(route, custom(body).body, custom(body).status || 200);
      if (body.action === "create") {
        return json(route, { ok: true, action: "create", agent: {
          code: "AG-09", name: body.name, status: "draft", agent_class: body.agent_class, channel: body.channel,
          prompt: null, guardrails: {}, prompt_missing: true, guardrails_missing: true } });
      }
      if (body.action === "run") return json(route, { ok: true, reply: "Coach: you are the buyer. Say hello." });
      const old = agents.find((a) => a.code === body.code) || LEAD;
      return json(route, { ok: true, action: "save", agent: {
        ...old, name: body.name, channel: body.channel, agent_class: body.agent_class,
        owner_label: body.owner_label, prompt: body.prompt, guardrails: body.guardrails, status: old.status } });
    },
  };
  const { page, errors } = await screens.open("/app/agent-editor.html", {
    handlers,
    before: async (p) => { holder.page = p; },
  });
  const dlg = dialogs(page);
  await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Lead Follow-up");
  // The save note clears itself after 2.2 seconds, so every word it shows is recorded from here on.
  await watchText(page, "#saveNote");
  const noteShown = async (word) => ((await textsSeen(page, "#saveNote"))[0] || []).includes(word);
  return { page, errors, writes, shadowReads, dlg, noteShown };
}

const nameBoxIs = (page, text) => page.waitForFunction((v) => document.querySelector("#a_name").value === v, text);

test("+ New agent asks for a name, creates one draft client-facing agent, and selects it", async () => {
  await proof.check("+ New agent button", async () => {
    const { page, errors, writes, dlg, noteShown } = await openEditor();
    const rowsBefore = await page.locator(".aitem").count();
    // A padded name is trimmed, and the create is exactly this one request.
    dlg.next("  Dispute Helper  ");
    await page.locator("#newBtn").click();
    await waitFor(() => writes.some((w) => w.action === "create"), "the create request");
    assert.deepEqual(writes.filter((w) => w.action === "create"), [
      { action: "create", name: "Dispute Helper", channel: "internal", agent_class: "client_facing" },
    ]);
    assert.equal(dlg.seen[0].message, "Name this agent");
    await nameBoxIs(page, "Dispute Helper");
    assert.equal(await page.locator("#a_code").inputValue(), "AG-09");
    assert.equal(await page.locator(".aitem").count(), rowsBefore + 1, "the new agent is in the list");
    assert.equal(await page.locator('.aitem[data-a="AG-09"].on').count(), 1, "and it is the selected one");
    await waitFor(() => noteShown("CREATED"), "the CREATED note");

    // Cancelling the question, or answering with spaces, creates nothing.
    const before = writes.length;
    dlg.next(false, "   ");
    await page.locator("#newBtn").click();
    await page.locator("#newBtn").click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(writes.length, before, "no request for a cancelled or blank name");
    assert.equal(await page.locator(".aitem").count(), rowsBefore + 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("+ New agent: a refused create adds nothing and says so", async () => {
  const { page, writes, dlg } = await openEditor({
    reply: { create: () => ({ status: 409, body: { ok: false, error: "name_taken", message: "An agent with that name already exists." } }) },
  });
  const rowsBefore = await page.locator(".aitem").count();
  dlg.next("Lead Follow-up");
  await page.locator("#newBtn").click();
  await waitFor(() => dlg.seen.some((d) => d.type === "alert"), "the refusal alert");
  assert.equal(writes.filter((w) => w.action === "create").length, 1);
  assert.match(dlg.seen.find((d) => d.type === "alert").message, /Could not create agent: An agent with that name already exists\./);
  assert.equal(await page.locator(".aitem").count(), rowsBefore, "nothing was added");
  assert.equal(await page.locator("#saveNote").innerText(), "NOT SAVED");
  await page.close();
});

test("Agent list row opens that agent; unsaved edits ask before they are thrown away", async () => {
  await proof.check(/^Agent list row/, async () => {
    const { page, errors, writes, shadowReads, dlg } = await openEditor();
    // A clean click switches straight over, with no question.
    await page.locator('.aitem[data-a="AG-03"]').click();
    await nameBoxIs(page, "Review Chaser");
    assert.equal(await page.locator("#a_code").inputValue(), "AG-03");
    assert.equal(await page.locator("#a_class").inputValue(), "Ops");
    assert.equal(await page.locator("#a_chan").inputValue(), "Email");
    assert.equal(await page.locator('.aitem[data-a="AG-03"].on').count(), 1);
    assert.equal(await page.locator('.aitem[data-a="AG-01"].on').count(), 0);
    assert.equal(dlg.seen.length, 0, "a clean switch asks nothing");
    await waitFor(() => shadowReads.includes("AG-03"), "the shadow log read for the opened agent");

    // Back on AG-01, type, then click another row: the question names the agent being left.
    await page.locator('.aitem[data-a="AG-01"]').click();
    await nameBoxIs(page, "Lead Follow-up");
    await page.locator("details.card > summary").nth(0).click();
    await page.locator("#a_name").fill("Lead Follow-up v2");
    assert.equal(await page.locator("#saveNote").innerText(), "UNSAVED CHANGES");
    dlg.next(false);
    await page.locator('.aitem[data-a="AG-03"]').click();
    await waitFor(() => dlg.seen.length === 1, "the discard question");
    assert.equal(dlg.seen[0].type, "confirm");
    assert.match(dlg.seen[0].message, /You have unsaved changes on Lead Follow-up v2\. Discard them\?/);
    assert.equal(await page.locator("#a_name").inputValue(), "Lead Follow-up v2", "No keeps the typed words");
    assert.equal(await page.locator('.aitem[data-a="AG-01"].on').count(), 1, "and keeps the same agent open");

    dlg.next(true);
    await page.locator('.aitem[data-a="AG-03"]').click();
    await nameBoxIs(page, "Review Chaser");
    assert.equal(await page.locator("#saveNote").innerText(), "", "Yes drops the unsaved mark");
    assert.equal(writes.length, 0, "switching saves nothing");
    await page.locator('.aitem[data-a="AG-01"]').click();
    await nameBoxIs(page, "Lead Follow-up");
    assert.equal(await page.locator("#saveNote").innerText(), "", "the discarded words do not come back");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

async function drillOpen() {
  const opened = await openEditor();
  await opened.page.locator('.aitem[data-a="OP-06"]').click();
  await nameBoxIs(opened.page, "Closer drill coach");
  return opened;
}
const turns = (page) => page.locator("#drillLog .drill-turn").allInnerTexts();

test("Closer drill: Send and Enter send the typed line with the earlier turns, and only for OP-06", async () => {
  await proof.check(/^Closer drill: Send button and Enter key/, async () => {
    const { page, errors, writes, dlg } = await drillOpen();
    assert.equal(await page.locator("#drillCard").isVisible(), true);
    assert.match(await page.locator("#drillLog").innerText(), /No turns yet\. Send/);

    // Nothing typed: it says so and sends nothing.
    await page.locator("#drillSend").click();
    assert.equal(await page.locator("#drillNote").innerText(), "Type something first.");
    assert.equal(writes.filter((w) => w.action === "run").length, 0);

    // The Send button.
    await page.locator("#drillIn").fill("Start D1");
    await page.locator("#drillSend").click();
    await waitFor(() => writes.some((w) => w.action === "run"), "the first run");
    assert.deepEqual(writes.find((w) => w.action === "run"),
      { action: "run", code: "OP-06", message: "Start D1", history: [] });
    await page.waitForFunction(() => document.querySelectorAll("#drillLog .drill-turn").length === 2);
    const first = await turns(page);
    assert.match(first[0], /YOU\s+Start D1/);
    assert.match(first[1], /COACH\s+Coach: you are the buyer\. Say hello\./);
    assert.equal(await page.locator("#drillIn").inputValue(), "", "the box is emptied after sending");

    // The Enter key sends the next line and carries both earlier turns as history.
    await page.locator("#drillIn").fill("Hello, thanks for taking the call.");
    await page.locator("#drillIn").press("Enter");
    await waitFor(() => writes.filter((w) => w.action === "run").length === 2, "the second run");
    const second = writes.filter((w) => w.action === "run")[1];
    assert.equal(second.message, "Hello, thanks for taking the call.");
    assert.deepEqual(second.history, [
      { role: "user", text: "Start D1" },
      { role: "assistant", text: "Coach: you are the buyer. Say hello." },
    ]);

    // Shift+Enter is a new line, not a send.
    await page.waitForFunction(() => document.querySelectorAll("#drillLog .drill-turn").length === 4);
    await page.locator("#drillIn").fill("line one");
    await page.locator("#drillIn").press("Shift+Enter");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(writes.filter((w) => w.action === "run").length, 2);

    // An agent that is not OP-06 gets no drill card at all, whether it is a draft or already in shadow.
    await page.locator('.aitem[data-a="AG-01"]').click();
    await nameBoxIs(page, "Lead Follow-up");
    assert.equal(await page.locator("#drillCard").isHidden(), true);
    await page.locator('.aitem[data-a="AG-03"]').click();
    await nameBoxIs(page, "Review Chaser");
    assert.equal(await page.locator("#drillCard").isHidden(), true, "a shadow agent that is not OP-06 has no drill either");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Closer drill: the coach's own words come back, the banned-line fail and the call counts show", async () => {
  const opened = await openEditor({
    reply: { run: () => ({ body: { ok: true, reply: "That was a banned line.", banned_line: true, call_samples: { easy: 1, hard: 2 } } }) },
  });
  const { page } = opened;
  await page.locator('.aitem[data-a="OP-06"]').click();
  await nameBoxIs(page, "Closer drill coach");
  await page.locator("#drillIn").fill("guaranteed approval");
  await page.locator("#drillSend").click();
  await page.waitForFunction(() => /banned line showed up/.test(document.querySelector("#drillNote").innerText));
  assert.equal(await page.locator("#drillNote").innerText(),
    "A banned line showed up. This drill is a fail. Logged calls in this turn: 1 easy, 2 hard.");
  await page.close();
});

test("Closer drill: New drill clears the turns and sends nothing", async () => {
  await proof.check(/^Closer drill: New drill button/, async () => {
    const { page, errors, writes } = await drillOpen();
    await page.locator("#drillIn").fill("Start D1");
    await page.locator("#drillSend").click();
    await page.waitForFunction(() => document.querySelectorAll("#drillLog .drill-turn").length === 2);
    const sent = writes.filter((w) => w.action === "run").length;
    assert.equal(sent, 1);

    await page.locator("#drillReset").click();
    assert.match(await page.locator("#drillLog").innerText(), /No turns yet\. Send/);
    assert.equal((await turns(page)).length, 0);
    assert.equal(writes.length, 1, "New drill itself sends nothing");

    // The next line starts a fresh drill: no history from the cleared one.
    await page.locator("#drillIn").fill("Start D2");
    await page.locator("#drillSend").click();
    await waitFor(() => writes.filter((w) => w.action === "run").length === 2, "the second drill's first turn");
    assert.deepEqual(writes.filter((w) => w.action === "run")[1],
      { action: "run", code: "OP-06", message: "Start D2", history: [] });
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Details toggles open and close each of the five sections on their own, and a new agent refolds them", async () => {
  await proof.check(/^Details\/section toggles/, async () => {
    const { page, errors, dlg } = await openEditor();
    const titles = ["IDENTITY", "TRIGGER EVENTS", "PROMPT", "ESCALATION PATH", "SHADOW LOG"];
    const stateOf = () => page.evaluate(() => [...document.querySelectorAll("details.card")]
      .map((d) => ({ title: d.querySelector(".eyebrow").textContent.trim(), open: d.open })));
    assert.deepEqual(await stateOf(), titles.map((title) => ({ title, open: false })), "all five start folded");

    // Opening one shows its box and leaves the other four folded.
    for (const [index, title] of titles.entries()) {
      await page.locator("details.card > summary").nth(index).click();
      const now = await stateOf();
      assert.deepEqual(now.filter((d) => d.open).map((d) => d.title), [title]);
      await page.locator("details.card > summary").nth(index).click();
      assert.deepEqual((await stateOf()).filter((d) => d.open), [], `${title} folds again`);
    }
    // The boxes inside are really hidden until their section opens.
    assert.equal(await page.locator("#a_name").isVisible(), false);
    await page.locator("details.card > summary").nth(0).click();
    assert.equal(await page.locator("#a_name").isVisible(), true);
    await page.locator("details.card > summary").nth(2).click();
    assert.equal(await page.locator("#a_prompt").isVisible(), true);

    // Opening another agent refolds everything the last one left open.
    await page.locator('.aitem[data-a="AG-03"]').click();
    await nameBoxIs(page, "Review Chaser");
    assert.deepEqual((await stateOf()).filter((d) => d.open), []);
    assert.equal(dlg.seen.length, 0);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

async function openIdentity(opts) {
  const opened = await openEditor(opts);
  await opened.page.locator("details.card > summary").nth(0).click();
  return opened;
}
const lastSave = (writes) => writes.filter((w) => w.action === "save").at(-1);

test("Identity: the Agent name box is saved as typed and shows in the list at once", async () => {
  await proof.check("Identity: Agent name input", async () => {
    const { page, errors, writes, noteShown } = await openIdentity();
    await page.locator("#a_name").fill("  Warm Lead Follow-up  ");
    assert.equal(await page.locator("#saveNote").innerText(), "UNSAVED CHANGES");
    assert.equal(await page.locator('.aitem[data-a="AG-01"] .an').innerText(), "Warm Lead Follow-up",
      "the list shows the typed name before any save");
    await page.locator("#saveBtn").click();
    await waitFor(() => lastSave(writes), "the save request");
    const body = lastSave(writes);
    assert.equal(body.action, "save");
    assert.equal(body.code, "AG-01");
    assert.equal(body.name, "Warm Lead Follow-up", "trimmed, and the name box is the source");
    // The other identity fields are untouched by a name edit.
    assert.equal(body.agent_class, "client_facing");
    assert.equal(body.channel, "sms");
    assert.equal(body.owner_label, "Sarah Whitfield");
    await waitFor(() => noteShown("SAVED"), "the SAVED note");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Identity: the Class select is saved as client_facing or ops and moves the agent between list groups", async () => {
  await proof.check(/^Identity: Class select/, async () => {
    const { page, errors, writes, noteShown } = await openIdentity();
    const groupOf = (code) => page.evaluate((c) => {
      let node = document.querySelector(`.aitem[data-a="${c}"]`);
      while (node && !(node.classList && node.classList.contains("agrp"))) node = node.previousElementSibling;
      return node ? node.textContent.trim() : null;
    }, code);
    assert.equal(await groupOf("AG-01"), "AE-A / CLIENT-FACING");

    await page.locator("#a_class").selectOption("Ops");
    assert.equal(await groupOf("AG-01"), "AE-B / OPS", "the list regroups as soon as it is picked");
    await page.locator("#saveBtn").click();
    await waitFor(() => lastSave(writes), "the first save");
    assert.equal(lastSave(writes).agent_class, "ops");

    await waitFor(() => noteShown("SAVED"), "the SAVED note");
    await page.locator("details.card > summary").nth(0).click();
    await page.locator("#a_class").selectOption("Client-facing");
    await page.locator("#saveBtn").click();
    await waitFor(() => writes.filter((w) => w.action === "save").length === 2, "the second save");
    assert.equal(lastSave(writes).agent_class, "client_facing");
    assert.equal(await groupOf("AG-01"), "AE-A / CLIENT-FACING");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Identity: the Owner select lists the staff and the chosen person is saved as owner_label", async () => {
  await proof.check("Identity: Owner select", async () => {
    const { page, errors, writes } = await openIdentity();
    assert.deepEqual(await page.locator("#a_owner option").allInnerTexts(), ["Pick a person", "Sarah Whitfield", "Jordan Blake"]);
    assert.equal(await page.locator("#a_owner").inputValue(), "Sarah Whitfield", "the saved owner is the one selected");
    await page.locator("#a_owner").selectOption("Jordan Blake");
    assert.equal(await page.locator("#saveNote").innerText(), "UNSAVED CHANGES");
    await page.locator("#saveBtn").click();
    await waitFor(() => lastSave(writes), "the save request");
    assert.equal(lastSave(writes).owner_label, "Jordan Blake");
    assert.equal(lastSave(writes).name, "Lead Follow-up", "only the owner changed");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Revert puts the identity boxes back to the last saved agent and sends nothing", async () => {
  await proof.check("Revert button", async () => {
    const { page, errors, writes, noteShown } = await openIdentity();
    await page.locator("#a_name").fill("Something else");
    await page.locator("#a_class").selectOption("Ops");
    await page.locator("#a_owner").selectOption("Jordan Blake");
    assert.equal(await page.locator("#saveNote").innerText(), "UNSAVED CHANGES");
    await page.locator("#revertBtn").click();
    await nameBoxIs(page, "Lead Follow-up");
    assert.equal(await page.locator("#a_class").inputValue(), "Client-facing");
    assert.equal(await page.locator("#a_owner").inputValue(), "Sarah Whitfield");
    assert.equal(await page.locator("#saveNote").innerText(), "");
    assert.equal(writes.length, 0, "Revert is local: nothing is sent");

    // After a save, Revert returns to what was saved, not to what the page first loaded.
    await page.locator("details.card > summary").nth(0).click();
    await page.locator("#a_name").fill("Saved Name");
    await page.locator("#saveBtn").click();
    await waitFor(() => noteShown("SAVED"), "the SAVED note");
    await page.locator("details.card > summary").nth(0).click();
    await page.locator("#a_name").fill("Typed after the save");
    await page.locator("#revertBtn").click();
    await nameBoxIs(page, "Saved Name");
    assert.equal(writes.filter((w) => w.action === "save").length, 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
