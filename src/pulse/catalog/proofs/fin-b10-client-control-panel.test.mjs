// Practice test (real page, fake /api answers) for thirteen Client Control Panel controls in batch 10:
// the five folding groups (Agent context, Credit & Hold Status, Details, Capital Blueprint, System Facts),
// the client picker, the Quick launch links, Open FinanceOS, the More menu (Funding Matrix, Credit
// Snapshot, Bank Inbox), the credit partner links and the Declines "Use this email" button.
// The expected words are worked out in this file from the fake data, not copied from the page.
// It reads no live data. Each row is claimed only inside the callback that asserts it.
//
// The Quick launch links and the Credit Snapshot link are also judged live, by RUNNING the deployed link gate
// (src/pulse/coverage/fin-b10-link-gate.mjs). Here the same runner reads this checkout's shell.js and page,
// and every role is opened in a real Chromium page: a link must be shown exactly when the runner says the
// role may press it. That ties the live check to what a person sees, in both states: today the gate hides
// the Closer Deck and Credit Snapshot links from every role, and the day the screen is added the link must
// show and open.
//
// The credit partner links row is exercised here and deliberately NOT attached (rows.json "notAttached"): it
// goes wrong only when the session answer lands after the Blueprint read, which this test's instant session
// never does. See OPEN_GAP in fin-b10-display-contracts.mjs for the exact reason.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";
import { parsePageAnchors, runDeployedGates, STAFF_ROLES } from "../../coverage/fin-b10-link-gate.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222";
const PARTNER = "cccccccc-3333-4333-8333-333333333333";

const ROLES = [...STAFF_ROLES];

// The gate this page loads, run the way the live check runs the deployed one: this checkout's shell.js
// against this checkout's page, once per staff role. The runner's answer for a link is whether it is SHOWN
// and whether a press on it is let through; Chromium's own answer for the same role must agree with the first,
// and a shown link must be let through.
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app");
const GATE = await runDeployedGates({
  shell: fs.readFileSync(path.join(APP, "shell.js"), "utf8"),
  anchors: parsePageAnchors(fs.readFileSync(path.join(APP, "client-control-panel.html"), "utf8")),
});
const mayPress = (role, id) => {
  const link = GATE[role].links.find((l) => l.id === id);
  assert.ok(link, `${role}: ${id} is on the page the gate was run against`);
  // A link the gate shows is one it lets through: a shown link that a press cannot use is a broken link.
  if (link.shown) assert.equal(link.blocked, false, `${role}: ${id} is shown but the click guard refuses a press`);
  return link.shown;
};
const asRole = (role) => ({ ok: true, staff: { id: `staff-${role}`, name: "Casey Reed", email: "casey@fundhub.ai", role, org_id: "org-1", status: "active" } });

const FILE = {
  ok: true,
  client: {
    id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+14702920106",
    outcome_tier: "Tier 2", funded: true, funded_amount: 45000,
    custom_fields: { analyzer_path: "Blueprint path", crs_status: "Report pulled", round_hold_reason: "Waiting on the bank letter" },
  },
  transactions: [], crs_results: [], messages: [], tasks: [],
  tri_merge: { experian: 701, equifax: 688, transunion: 695, asOf: "2026-10-01T17:00:00Z" },
  income_estimates: { experian: { annual: 84000 }, equifax: { annual: 91500 } },
  funding_rounds: [{ round_number: 2, status: "submitted" }],
  open_blockers: [],
  business_credit: { businesses: [] },
};

const COMBINED = {
  ok: true, combinedPrequal: 120000, combinedPrequalDisplay: "$120,000",
  primary: { name: "Dana Whitfield" }, primaryPrequalDisplay: "$70,000", primaryPrequal: 70000,
  partnerClientId: PARTNER, partner: { name: "Sam Whitfield" }, partnerPrequalDisplay: "$50,000", partnerPrequal: 50000,
};
const NO_PARTNER = { ...COMBINED, partnerClientId: null, partner: null, partnerPrequalDisplay: null, partnerPrequal: null,
  combinedPrequal: 70000, combinedPrequalDisplay: "$70,000" };

const DECLINES = {
  ok: true,
  staff: {
    eligible: true, declines: [], applications: [], next_sequence_notes: [],
    bank_emails: [
      { subject: "About your application", preview: "We were unable to approve your request at this time." },
      { subject: "Your Chase card decision", preview: "Your income could not be verified." },
    ],
  },
};

async function openPanel({ session = OWNER, query = `?id=${CLIENT}`, overrides = {} } = {}) {
  const seen = { context: [], inbox: [], declines: 0 };
  const handlers = {
    "/api/dashboard/clients": overrides.clients || { ok: true, clients: [] },
    "/api/dashboard/client": overrides.file || FILE,
    "/api/read/agent-context": async (route, { url }) => {
      seen.context.push(new URL(url).searchParams.get("client_id"));
      return json(route, overrides.context || { ok: true, context: { as_prompt_block: "CLIENT Dana Whitfield\nsaid: I need $50,000 for the shop" } });
    },
    "/api/read/blueprint-combined-approval": async (route) => json(route, overrides.combined || COMBINED),
    "/api/read/bank-inbox": async (route, { url }) => {
      const q = new URL(url).searchParams;
      seen.inbox.push({ client_id: q.get("client_id"), limit: q.get("limit") });
      return json(route, overrides.inbox || { ok: true, items: [{ subject: "Chase update", body_preview: "We received your documents." }] });
    },
    "/api/blueprint/declines": async (route) => { seen.declines += 1; return json(route, overrides.declines || DECLINES); },
    ...(overrides.extra || {}),
  };
  const { page, errors } = await screens.open(`/app/client-control-panel.html${query}`, { session, handlers });
  await page.waitForFunction(() => document.getElementById("ccp-name") && document.getElementById("ccp-name").textContent !== "Loading…");
  return { page, errors, seen };
}

// Select the named workspace section before exercising the same existing control.
async function selectGroupSection(page, bodyId) {
  const name = bodyId === "bp-body" ? "Funding" : bodyId === "hold-body" ? "Credit & inquiries" : "Records";
  await page.getByRole("tab", { name, exact: true }).click();
}
async function openGroup(page, bodyId) {
  await selectGroupSection(page, bodyId);
  await page.locator(`.group-title.tog[aria-controls="${bodyId}"]`).click();
}
async function openToolsPanel(options) {
  const result = await openPanel(options);
  await result.page.locator("#more-menu > summary").click();
  return result;
}

const expanded = (page, selector) => page.locator(selector).getAttribute("aria-expanded");

// One folding group: shut at first, opens on a press, shuts on a second press, and keeps its body hidden state in step.
async function foldGroup(page, bodyId, { stateWord = false } = {}) {
  await selectGroupSection(page, bodyId);
  const title = page.locator(`.group-title.tog[aria-controls="${bodyId}"]`);
  const body = page.locator(`#${bodyId}`);
  assert.equal(await title.getAttribute("aria-expanded"), "false", `${bodyId} starts shut`);
  assert.equal(await body.isHidden(), true, `${bodyId} body starts hidden`);
  if (stateWord) assert.equal((await title.locator(".tog-state").textContent()).trim(), "collapsed");
  await title.click();
  assert.equal(await title.getAttribute("aria-expanded"), "true", `${bodyId} opens`);
  assert.equal(await body.isVisible(), true);
  if (stateWord) assert.equal((await title.locator(".tog-state").textContent()).trim(), "open");
  return async () => {
    await title.click();
    assert.equal(await title.getAttribute("aria-expanded"), "false", `${bodyId} shuts again`);
    assert.equal(await body.isHidden(), true);
    if (stateWord) assert.equal((await title.locator(".tog-state").textContent()).trim(), "collapsed");
  };
}

test("Agent context toggle: starts shut, opens onto exactly what the agent read, and says so when the read fails", async () => {
  await proof.check(/^Agent context toggle/, async () => {
    const { page, seen, errors } = await openPanel();
    await waitFor(() => seen.context.length === 1, "the agent context read");
    assert.deepEqual(seen.context, [CLIENT]);
    const shut = await foldGroup(page, "agent-context-body");
    await waitFor(async () => (await page.locator("#agent-context-pre").textContent()).startsWith("CLIENT Dana Whitfield"), "the block");
    assert.equal(await page.locator("#agent-context-pre").textContent(), "CLIENT Dana Whitfield\nsaid: I need $50,000 for the shop");
    await shut();
    assert.deepEqual(errors, []);
    await page.close();

    // No prompt block: the whole context is shown as plain JSON, so nothing is hidden from the reader.
    const raw = await openPanel({ overrides: { context: { ok: true, context: { stage: "booked" } } } });
    await waitFor(async () => (await raw.page.locator("#agent-context-pre").textContent()).includes('"stage": "booked"'), "the JSON");
    await raw.page.close();

    // A read that fails says so in words.
    const failed = await openPanel({ overrides: { context: { ok: false, error: "forbidden" } } });
    await waitFor(async () => /Could not load agent context/.test(await failed.page.locator("#agent-context-pre").textContent()), "the failure line");
    await failed.page.close();
  });
});

test("Credit & Hold Status toggle: starts shut and holds the credit status, both income estimates and the hold reason", async () => {
  await proof.check(/^Credit & Hold Status toggle/, async () => {
    const { page, errors } = await openPanel();
    const shut = await foldGroup(page, "hold-body");
    assert.equal(await page.locator("#ccp-credit-status").textContent(), "Report pulled");
    assert.equal(await page.locator("#ccp-income-ex").textContent(), "$84,000/yr");
    assert.equal(await page.locator("#ccp-income-eq").textContent(), "$91,500/yr");
    assert.equal(await page.locator("#ccp-hold-reason").textContent(), "Waiting on the bank letter");
    // The two income numbers are not mixed up: Experian is the first estimate and Equifax the second.
    assert.match(await page.locator("#hold-body .kv").nth(1).innerText(), /Experian model[\s\S]*\$84,000\/yr/);
    assert.match(await page.locator("#hold-body .kv").nth(3).innerText(), /Equifax model[\s\S]*\$91,500\/yr/);
    await shut();
    assert.deepEqual(errors, []);
    await page.close();

    // Nothing recorded stays a dash; it is never painted as a zero.
    const bare = await openPanel({ overrides: { file: { ...FILE, client: { ...FILE.client, custom_fields: {} }, income_estimates: {} } } });
    await openGroup(bare.page, "hold-body");
    for (const id of ["ccp-credit-status", "ccp-income-ex", "ccp-income-eq", "ccp-hold-reason"]) {
      assert.equal(await bare.page.locator(`#${id}`).textContent(), "—", id);
    }
    await bare.page.close();
  });
  await proof.check(/^Credit & Hold Status toggle/, async () => {
    // Each value sits under its OWN label. The four pairs, in the grid's order, read by position.
    const { page } = await openPanel();
    await openGroup(page, "hold-body");
    const pairs = await page.$$eval("#hold-body .kv", (els) => els.map((el) => [el.querySelector(".kv-label").textContent.trim(), el.querySelector(".kv-value").textContent.trim()]));
    assert.deepEqual(pairs, [
      ["Credit Status", "Report pulled"],
      ["Income estimate (Experian model)", "$84,000/yr"],
      ["On Hold Because", "Waiting on the bank letter"],
      ["Income estimate (Equifax model)", "$91,500/yr"],
    ]);
    // The sentence under the grid says whose guess the income is, and tells the reader not to quote it.
    const note = (await page.locator("#hold-body .fact-note").textContent()).replace(/\s+/g, " ").trim();
    assert.match(note, /Neither income figure was reported by this client and neither is on the credit report\./);
    assert.match(note, /Each one is a guess produced by a bureau scoring model from how the person uses credit\./);
    assert.match(note, /Do not quote either as their income\.$/);
    await page.close();
  });
  await proof.check(/^Credit & Hold Status toggle/, async () => {
    // Where each value comes from when the first place is empty. The credit status is the report pull status,
    // else the analyzer's; the hold is the client's own round hold, else the newest round's.
    const fileWith = (custom, rounds = FILE.funding_rounds, extra = {}) => ({ ...FILE, ...extra,
      client: { ...FILE.client, custom_fields: custom }, funding_rounds: rounds });
    const read = async (file) => {
      const { page } = await openPanel({ overrides: { file } });
      await openGroup(page, "hold-body");
      const out = {
        status: await page.locator("#ccp-credit-status").textContent(),
        hold: await page.locator("#ccp-hold-reason").textContent(),
      };
      await page.close();
      return out;
    };
    // The analyzer's status stands in when there is no report pull status.
    assert.equal((await read(fileWith({ analyzer_status: "Analyzer ran" }))).status, "Analyzer ran");
    // The report pull status wins when both are there.
    assert.equal((await read(fileWith({ crs_status: "Report pulled", analyzer_status: "Analyzer ran" }))).status, "Report pulled");
    // The newest round's hold stands in when the client has none of its own...
    const rounds = [{ round_number: 3, status: "on hold", hold_reason: "Bank asked for ID" }, { round_number: 2, status: "funded", hold_reason: "Old reason" }];
    assert.equal((await read(fileWith({}, rounds))).hold, "Bank asked for ID");
    // ...and the client's own hold wins when both are there.
    assert.equal((await read(fileWith({ round_hold_reason: "Waiting on the bank letter" }, rounds))).hold, "Waiting on the bank letter");
    // "Awaiting CRS" is shown as a dash once scores are on file (the hold has already cleared), and as itself
    // before. The worked-out step (next_action) is what carries the scores-on-file fact, so it is present here.
    const worked = { next_action: null, active_blockers: [] };
    assert.equal((await read(fileWith({ round_hold_reason: "Awaiting CRS" }, [], worked))).hold, "—");
    assert.equal((await read(fileWith({ round_hold_reason: "Awaiting CRS" }, [], { ...worked, tri_merge: {} }))).hold, "Awaiting CRS");
  });
  await proof.check(/^Credit & Hold Status toggle/, async () => {
    // Income off a SAMPLE report says so, a real pull does not, and a dash stays a dash even for a sample.
    const AS_OF = "2026-10-01T17:00:00Z";
    const sampleFile = (result, income) => ({ ...FILE,
      crs_results: [{ created_at: AS_OF, result }],
      income_estimates: { asOf: AS_OF, ...income } });
    const read = async (file) => {
      const { page } = await openPanel({ overrides: { file } });
      await openGroup(page, "hold-body");
      const out = [await page.locator("#ccp-income-ex").textContent(), await page.locator("#ccp-income-eq").textContent()];
      await page.close();
      return out;
    };
    const both = { experian: { annual: 84000 }, equifax: { annual: 91500 } };
    assert.deepEqual(await read(sampleFile({ simulated: true }, both)), ["$84,000/yr · sample", "$91,500/yr · sample"]);
    assert.deepEqual(await read(sampleFile({ environment: "simulated" }, both)), ["$84,000/yr · sample", "$91,500/yr · sample"]);
    assert.deepEqual(await read(sampleFile({ simulated: false, environment: "production" }, both)), ["$84,000/yr", "$91,500/yr"]);
    // A report of a different time is not the one the income came off.
    const other = { ...sampleFile({ simulated: true }, both), crs_results: [{ created_at: "2026-09-01T17:00:00Z", result: { simulated: true } }] };
    assert.deepEqual(await read(other), ["$84,000/yr", "$91,500/yr"]);
    // Only the figure that exists is flagged: no Equifax figure stays a dash, not "— · sample".
    assert.deepEqual(await read(sampleFile({ simulated: true }, { experian: { annual: 84000 } })), ["$84,000/yr · sample", "—"]);
  });
});

test("Details toggle: starts shut and holds the email, phone, tier and path of this client", async () => {
  await proof.check(/^Details toggle/, async () => {
    const { page, errors } = await openPanel();
    const shut = await foldGroup(page, "details-body");
    assert.equal(await page.locator("#ccp-email").textContent(), "dana@example.com");
    assert.equal(await page.locator("#ccp-phone").textContent(), "(470) 292-0106");
    assert.equal(await page.locator("#ccp-tier").textContent(), "Tier 2");
    assert.equal(await page.locator("#ccp-path").textContent(), "Blueprint path");
    await shut();
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("System Facts toggle: starts shut, says collapsed or open, and holds last pull, scores, round and funded", async () => {
  await proof.check(/^System Facts toggle/, async () => {
    const { page, errors } = await openPanel();
    const shut = await foldGroup(page, "facts-body", { stateWord: true });
    assert.equal(await page.locator("#ccp-facts-scores").textContent(), "EX 701 · EQ 688 · TU 695");
    assert.equal(await page.locator("#ccp-facts-round").textContent(), "Round 2 · submitted");
    assert.equal(await page.locator("#ccp-facts-funded").textContent(), "Yes · $45,000");
    assert.match(await page.locator("#ccp-last-pull").textContent(), /^Oct 1, 2026, 10:00\sAM MST$/);
    await shut();
    assert.deepEqual(errors, []);
    await page.close();

    // A file that is not funded says No, and a file with no round and no pull leaves dashes, not guesses.
    const open = await openPanel({ overrides: { file: { ...FILE, client: { ...FILE.client, funded: false, funded_amount: null },
      tri_merge: {}, funding_rounds: [], crs_results: [] } } });
    await openGroup(open.page, "facts-body");
    assert.equal(await open.page.locator("#ccp-facts-funded").textContent(), "No");
    assert.equal(await open.page.locator("#ccp-facts-round").textContent(), "—");
    assert.equal(await open.page.locator("#ccp-last-pull").textContent(), "—");
    assert.equal(await open.page.locator("#ccp-facts-scores").textContent(), "EX — · EQ — · TU —");
    await open.page.close();
  });
});

test("Blueprint group toggle: starts shut, says collapsed or open, and holds the combined prequal and the partner", async () => {
  await proof.check(/^Blueprint group toggle/, async () => {
    const { page, errors } = await openPanel();
    const shut = await foldGroup(page, "bp-body", { stateWord: true });
    await waitFor(async () => (await page.locator("#bp-combined").textContent()) === "$120,000", "the combined number");
    assert.equal(await page.locator("#bp-primary-label").textContent(), "Dana Whitfield (primary)");
    assert.equal(await page.locator("#bp-primary").textContent(), "$70,000");
    assert.equal(await page.locator("#bp-partner-label").textContent(), "Sam Whitfield (partner)");
    assert.equal(await page.locator("#bp-partner").textContent(), "$50,000");
    assert.equal(await page.locator("#bp-combined-note").textContent(), "The primary number plus the partner's number.");
    await shut();
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Blueprint group toggle/, async () => {
    // A read that FAILS paints a dash and says why. It never paints a dollar figure, and never a zero, and it
    // does not offer the add-a-partner form (the page cannot tell whether a partner exists).
    const failures = [
      [403, { ok: false, error: "not_blueprint_buyer" }, "This client has not paid for the Capital Blueprint, so this is not available for them."],
      [401, { ok: false, error: "unauthorized" }, "You are signed out. Sign in and open this page again."],
      [503, { ok: false, error: "db_down" }, "The database is not reachable right now. Try again in a moment."],
      [500, { ok: false, error: "boom" }, "That did not work. Try again in a moment."],
    ];
    for (const [status, body, words] of failures) {
      const { page } = await openPanel({ overrides: { extra: {
        "/api/read/blueprint-combined-approval": async (route) => json(route, body, status),
      } } });
      await openGroup(page, "bp-body");
      await waitFor(async () => /did not load/.test(await page.locator("#bp-combined-note").textContent()), `the failure words for ${status}`);
      assert.equal(await page.locator("#bp-combined-note").textContent(), `The combined number did not load. ${words}`, String(status));
      assert.equal(await page.locator("#bp-combined").textContent(), "—", `${status}: a dash, never a figure`);
      assert.equal(await page.locator("#bp-partner-now").textContent(), "Could not check for a credit partner.");
      assert.equal(await page.locator("#bp-partner-form").isHidden(), true, `${status}: no add form when the partner is unknown`);
      assert.equal(await page.locator("#bp-partner-row").isHidden(), true);
      assert.doesNotMatch(await page.locator("#bp-body").innerText(), /\$0\b/, `${status}: no zero dollars`);
      await page.close();
    }
  });
  await proof.check(/^Blueprint group toggle/, async () => {
    // No partner on the file: the partner row is put away, the note says the primary file stands alone, and the
    // partner line says one is included. A number that is not worked out says so in words, never as $0.
    const none = await openPanel({ overrides: { combined: NO_PARTNER } });
    await openGroup(none.page, "bp-body");
    await waitFor(async () => (await none.page.locator("#bp-combined").textContent()) === "$70,000", "the primary alone");
    assert.equal(await none.page.locator("#bp-partner-row").isHidden(), true, "no partner row without a partner");
    assert.equal(await none.page.locator("#bp-combined-note").textContent(), "No credit partner on this file, so this is the primary file alone.");
    assert.equal(await none.page.locator("#bp-partner-now").textContent(), "No credit partner yet. One partner is included with the Blueprint.");
    assert.equal(await none.page.locator("#bp-primary").textContent(), "$70,000");
    await none.page.close();

    // A partner whose own number is not worked out: counted as the primary alone, said in words, never $0.
    const partial = await openPanel({ overrides: { combined: { ...COMBINED, partnerPrequal: null, partnerPrequalDisplay: null,
      combinedPrequal: 70000, combinedPrequalDisplay: "$70,000" } } });
    await openGroup(partial.page, "bp-body");
    await waitFor(async () => (await partial.page.locator("#bp-combined").textContent()) === "$70,000", "the primary count");
    assert.equal(await partial.page.locator("#bp-partner-row").isVisible(), true);
    assert.equal(await partial.page.locator("#bp-partner").textContent(), "Not worked out yet");
    assert.equal(await partial.page.locator("#bp-combined-note").textContent(), "The partner's number is not worked out yet, so this counts the primary file only.");
    await partial.page.close();

    // Nothing worked out at all: a dash and a sentence, and the primary says so too.
    const nothing = await openPanel({ overrides: { combined: { ok: true, combinedPrequal: null, combinedPrequalDisplay: null,
      primary: { name: "Dana Whitfield" }, primaryPrequal: null, primaryPrequalDisplay: null,
      partnerClientId: null, partner: null, partnerPrequal: null, partnerPrequalDisplay: null } } });
    await openGroup(nothing.page, "bp-body");
    await waitFor(async () => (await nothing.page.locator("#bp-primary-label").textContent()) === "Dana Whitfield (primary)", "the named primary");
    assert.equal(await nothing.page.locator("#bp-combined").textContent(), "—");
    assert.equal(await nothing.page.locator("#bp-primary").textContent(), "Not worked out yet");
    assert.equal(await nothing.page.locator("#bp-combined-note").textContent(), "No prequal number is worked out for this file yet.");
    await nothing.page.close();
  });
});

test("Credit partner links: both point at the partner's own file and consent, and neither shows with no partner", async () => {
  await proof.check(/^Credit partner links/, async () => {
    const { page, errors } = await openPanel();
    await openGroup(page, "bp-body");
    await waitFor(async () => (await page.locator("#bp-partner-now").textContent()).includes("is on this file"), "the partner line");
    assert.equal(await page.locator("#bp-partner-now").textContent(), "Sam Whitfield is on this file. One partner is included.");
    const open = page.locator("#bp-partner-open");
    const consent = page.locator("#bp-partner-consent");
    assert.equal(await open.isVisible(), true);
    assert.equal(await consent.isVisible(), true);
    assert.equal(await open.getAttribute("href"), `client-control-panel.html?id=${PARTNER}`);
    assert.equal(await consent.getAttribute("href"), `consent-capture.html?client_id=${PARTNER}`);
    assert.equal(await page.locator("#bp-partner-form").isHidden(), true, "no add form when a partner is on the file");
    // The partner's file link really opens that other file.
    await open.click();
    await page.waitForURL(new RegExp(`/app/client-control-panel\\.html\\?id=${PARTNER}$`));
    assert.deepEqual(errors, []);
    await page.close();

    // The shell asks for the session after the Blueprint read. Its second link-gate pass must keep the
    // partner URLs, not restore the primary client's original data-fh-href values.
    let releaseSession;
    const sessionGate = new Promise((resolve) => { releaseSession = resolve; });
    let sessionAnswers = 0;
    const late = await openPanel({ overrides: { extra: {
      "/api/auth/session": async () => {
        await sessionGate;
        sessionAnswers += 1;
        return OWNER;
      },
    } } });
    await waitFor(async () => (await late.page.locator("#bp-partner-now").textContent()).includes("is on this file"), "the partner before the late session");
    assert.equal(await late.page.locator("#bp-partner-open").getAttribute("data-fh-href"), `client-control-panel.html?id=${PARTNER}`);
    assert.equal(await late.page.locator("#bp-partner-consent").getAttribute("data-fh-href"), `consent-capture.html?client_id=${PARTNER}`);
    releaseSession();
    await waitFor(() => sessionAnswers === 1, "the late session answer");
    await late.page.waitForTimeout(100);
    assert.equal(await late.page.locator("#bp-partner-open").getAttribute("href"), `client-control-panel.html?id=${PARTNER}`);
    assert.equal(await late.page.locator("#bp-partner-consent").getAttribute("href"), `consent-capture.html?client_id=${PARTNER}`);
    assert.deepEqual(late.errors, []);
    await late.page.close();

    // With no partner on the file the links are put away and the add form shows. Adding one reads the file again:
    // the form goes away and both links appear for the new partner.
    let added = false;
    const posted = [];
    const none = await openPanel({ overrides: {
      get combined() { return added ? COMBINED : NO_PARTNER; },
      extra: { "/api/blueprint/staff-actions": async (route) => {
        const body = JSON.parse(route.request().postData() || "{}");
        // The page also asks for the bank list on this same address; only the add is judged here.
        if (body.action === "create_credit_partner") {
          posted.push(body);
          added = true;
        }
        return json(route, { ok: true, todos: [] });
      } },
    } });
    await openGroup(none.page, "bp-body");
    await waitFor(async () => /No credit partner yet/.test(await none.page.locator("#bp-partner-now").textContent()), "the no partner line");
    assert.equal(await none.page.locator("#bp-partner-open").isHidden(), true);
    assert.equal(await none.page.locator("#bp-partner-consent").isHidden(), true);
    assert.equal(await none.page.locator("#bp-partner-form").isVisible(), true, "the add form shows instead");

    await none.page.locator("#bp-first").fill("Sam");
    await none.page.locator("#bp-last").fill("Whitfield");
    await none.page.locator("#bp-email").fill("sam@acme.test");
    await none.page.locator("#bp-partner-add").click();
    await waitFor(() => posted.length === 1, "the add request");
    assert.deepEqual(posted[0], { action: "create_credit_partner", client_id: CLIENT, first_name: "Sam", last_name: "Whitfield", email: "sam@acme.test", phone: null });
    await waitFor(async () => (await none.page.locator("#bp-partner-open").isVisible()), "the partner links");
    assert.equal(await none.page.locator("#bp-partner-form").isHidden(), true, "the add form is put away");
    assert.equal(await none.page.locator("#bp-partner-open").getAttribute("href"), `client-control-panel.html?id=${PARTNER}`);
    assert.equal(await none.page.locator("#bp-partner-consent").getAttribute("href"), `consent-capture.html?client_id=${PARTNER}`);
    await none.page.close();
  });
});

test("Declines Use this email: copies that email's subject and preview into the letter box and moves the cursor there", async () => {
  await proof.check(/^Declines: Use this email button/, async () => {
    const { page, errors } = await openPanel();
    await openGroup(page, "bp-body");
    await page.waitForSelector('[data-act="use-email"]');
    const buttons = page.locator('[data-act="use-email"]');
    assert.equal(await buttons.count(), 2);
    assert.equal(await page.locator("#bp-dec-text").inputValue(), "", "the letter box starts empty");

    await buttons.nth(1).click();
    assert.equal(await page.locator("#bp-dec-text").inputValue(), "Your Chase card decision\n\nYour income could not be verified.");
    assert.notEqual(await page.locator("#bp-dec-new").getAttribute("open"), null, "the form is open");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "bp-dec-text");

    // The other email replaces it, so the box never holds both.
    await buttons.nth(0).click();
    assert.equal(await page.locator("#bp-dec-text").inputValue(), "About your application\n\nWe were unable to approve your request at this time.");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Client picker select: lists the clients it was given, selects this one, and opens the one picked", async () => {
  await proof.check(/^Client picker select/, async () => {
    const clients = { ok: true, clients: [
      { id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
      { id: OTHER, first_name: "Sam", last_name: "Okafor", email: "sam@example.com" },
      { id: "dddddddd-4444-4444-8444-444444444444", first_name: "", last_name: "", email: "no.name@example.com" },
    ] };
    const { page, errors } = await openPanel({ overrides: { clients } });
    await page.waitForFunction(() => document.querySelectorAll("#ccp-pick option").length === 4);
    const options = await page.$$eval("#ccp-pick option", (els) => els.map((e) => [e.value, e.textContent, e.selected]));
    assert.deepEqual(options, [
      ["", "Choose a client", false],
      [CLIENT, "Dana Whitfield", true],
      [OTHER, "Sam Okafor", false],
      ["dddddddd-4444-4444-8444-444444444444", "no.name@example.com", false],
    ]);

    // Pick another client: the page opens that client's file, by its id.
    await page.locator("#ccp-pick").selectOption(OTHER);
    await page.waitForURL(new RegExp(`/app/client-control-panel\\.html\\?id=${OTHER}$`));
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Client picker select/, async () => {
    // A name is text, not markup: angle brackets, an ampersand and a quote are shown as typed, they do not
    // become elements, and the option still carries its own id.
    const NAMED = "eeeeeeee-5555-4555-8555-555555555555";
    const clients = { ok: true, clients: [
      { id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
      { id: NAMED, first_name: "<b>Bold</b> & Co", last_name: '"Quoted" <img src=x>', email: "x@example.com" },
      { id: "ffffffff-6666-4666-8666-666666666666", first_name: "", last_name: "", email: "a&b<c>@example.com" },
    ] };
    const { page, errors } = await openPanel({ overrides: { clients } });
    await page.waitForFunction(() => document.querySelectorAll("#ccp-pick option").length === 4);
    const options = await page.$$eval("#ccp-pick option", (els) => els.map((e) => [e.value, e.textContent]));
    assert.deepEqual(options[2], [NAMED, '<b>Bold</b> & Co "Quoted" <img src=x>']);
    assert.deepEqual(options[3], ["ffffffff-6666-4666-8666-666666666666", "a&b<c>@example.com"]);
    assert.equal(await page.locator("#ccp-pick option b, #ccp-pick option img").count(), 0, "no element was made from a name");
    assert.deepEqual(errors, []);

    // The empty choice ("Choose a client") goes nowhere: no navigation, still on this client's file.
    const here = page.url();
    await page.locator("#ccp-pick").selectOption("");
    await page.waitForTimeout(400);
    assert.equal(page.url(), here, "choosing the empty option does not leave the page");
    await page.close();
  });
  await proof.check(/^Client picker select/, async () => {
    // The request itself carries the 200 cap, and an unreadable list says so instead of an empty picker.
    const limits = [];
    const { page } = await screens.open(`/app/client-control-panel.html?id=${CLIENT}`, {
      session: OWNER,
      handlers: {
        "/api/dashboard/clients": async (route, { url }) => {
          limits.push(new URL(url).searchParams.get("limit"));
          return json(route, { ok: false, error: "query_failed" }, 500);
        },
        "/api/dashboard/client": FILE,
      },
    });
    await page.waitForFunction(() => /client list could not be read/.test(document.querySelector("#ccp-pick").textContent));
    assert.deepEqual(limits, ["200"]);
    await page.close();
  });
});

test("Open FinanceOS link: opens FinanceOS on this client for the roles that may, and stays hidden for everyone else", async () => {
  await proof.check(/^Open FinanceOS link/, async () => {
    // Measured roles: the page shows it to owner, admin, sales manager and closer (the closer door was added on
    // 2026-10-07); every other staff role keeps it hidden, and with no client open it is hidden for all.
    const shows = ["owner", "admin", "sales_manager", "closer"];
    const hides = ["funding_advisor", "csm", "setter", "inquiry_specialist"];
    for (const role of [...shows, ...hides]) {
      const { page, errors } = await openToolsPanel({ session: asRole(role) });
      const link = page.locator("#ccp-link-financeos");
      const visible = await link.isVisible();
      assert.equal(visible, shows.includes(role), `${role}: Open FinanceOS visible`);
      if (visible) {
        assert.equal(await link.getAttribute("href"), `financeos.html?client_id=${CLIENT}`, role);
        assert.equal(await link.getAttribute("data-fh-href"), `financeos.html?client_id=${CLIENT}`, role);
      }
      assert.deepEqual(errors, [], role);
      await page.close();
    }
    // No client open: hidden even for the owner.
    const bare = await openToolsPanel({ query: "" });
    assert.equal(await bare.page.locator("#ccp-link-financeos").isVisible(), false);
    await bare.page.close();
    // The press opens FinanceOS for that client.
    const owner = await openToolsPanel();
    await owner.page.locator("#ccp-link-financeos").click();
    await owner.page.waitForURL(new RegExp(`/app/financeos\\.html\\?client_id=${CLIENT}$`));
    await owner.page.close();
  });
});

test("Quick launch links: Pipeline, Messaging and Inquiry Remover open the right page; the Closer Deck link follows the link gate for every role", async () => {
  await proof.check(/^Quick launch links/, async () => {
    const wanted = [
      ["ccp-link-pipeline", "Open Pipeline", /^pipeline\.html$/, /\/app\/pipeline\.html$/],
      ["ccp-link-messaging", "Open Messaging", new RegExp(`^messaging\\.html\\?client_id=${CLIENT}$`), new RegExp(`/app/messaging\\.html\\?client_id=${CLIENT}$`)],
      ["ccp-link-ir", "Open Inquiry Remover", /^inquiry-remover\.html$/, /\/app\/inquiry-remover\.html$/],
    ];
    for (const [id, label, hrefRe, urlRe] of wanted) {
      const { page, errors } = await openToolsPanel();
      const link = page.locator(`#${id}`);
      assert.equal(await link.isVisible(), true, `${label} is shown`);
      assert.match((await link.textContent()).trim(), new RegExp(`^${label}`));
      assert.match(await link.getAttribute("href"), hrefRe, label);
      await link.click();
      await page.waitForURL(urlRe);
      assert.deepEqual(errors, [], label);
      await page.close();
    }

    // Every role, every link: shown exactly when the gate (run the way the live check runs it) lets that role
    // press it. The Closer Deck link carries this client in its address whether it is shown or not, and a
    // shown one is pressed and lands on the deck screen for this client.
    const links = [
      ["ccp-link-pipeline", "pipeline.html"],
      ["ccp-link-present", "present.html"],
      ["ccp-link-messaging", "messaging.html"],
      ["ccp-link-ir", "inquiry-remover.html"],
    ];
    for (const role of ROLES) {
      const { page } = await openToolsPanel({ session: asRole(role) });
      for (const [id, screen] of links) {
        assert.equal(await page.locator(`#${id}`).isVisible(), mayPress(role, id),
          `${role}: ${id} (${screen}) is shown only when the link gate lets this role press it`);
      }
      const deck = page.locator("#ccp-link-present");
      assert.match(await deck.getAttribute("href"), new RegExp(`^present\\.html\\?contact=${CLIENT}`), `${role}: Closer Deck address`);
      if (await deck.isVisible()) {
        await deck.click();
        await page.waitForURL(new RegExp(`/app/present\\.html\\?contact=${CLIENT}`));
      }
      await page.close();
    }
  });
  await proof.check(/^Quick launch links/, async () => {
    // With no client open, wireLinks() puts nothing on the links, so what a person presses is the address the
    // page was written with. Each must be its own screen, and a visible one must open it.
    const bare = await openToolsPanel({ query: "" });
    for (const [id, file] of [["ccp-link-pipeline", "pipeline.html"], ["ccp-link-present", "present.html"],
      ["ccp-link-messaging", "messaging.html"], ["ccp-link-ir", "inquiry-remover.html"]]) {
      assert.equal(await bare.page.locator(`#${id}`).getAttribute("href"), file, `${id}: the address the page was written with`);
      assert.equal(await bare.page.locator(`#${id}`).isVisible(), mayPress("owner", id), `${id}: shown for the owner by the gate`);
    }
    await bare.page.locator("#ccp-link-ir").click();
    await bare.page.waitForURL(/\/app\/inquiry-remover\.html$/);
    await bare.page.close();
  });
});

test("More menu: Funding Matrix and Credit Snapshot are links for this client, and Bank Inbox shows its messages", async () => {
  await proof.check(/^More menu: Open Funding Matrix link/, async () => {
    const { page, errors } = await openPanel();
    assert.equal(await page.locator("#ccp-link-lenders").isVisible(), false, "the link is inside the closed More menu");
    await page.locator("#more-menu > summary").click();
    const link = page.locator("#ccp-link-lenders");
    assert.equal(await link.isVisible(), true);
    assert.equal(await link.getAttribute("href"), `lenders.html?client_id=${CLIENT}`);
    await link.click();
    await page.waitForURL(new RegExp(`/app/lenders\\.html\\?client_id=${CLIENT}$`));
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^More menu: Open Credit Snapshot link/, async () => {
    // The address is right for this client and the same for everybody. The row is shown exactly when the gate
    // lets that role press it, and a shown link is pressed and lands on the screen.
    for (const role of ROLES) {
      const { page, errors } = await openPanel({ session: asRole(role) });
      await page.locator("#more-menu > summary").click();
      const link = page.locator("#ccp-link-present2");
      assert.match(await link.getAttribute("href"), new RegExp(`^present\\.html\\?contact=${CLIENT}`), `${role}: address`);
      const visible = await link.isVisible();
      assert.equal(visible, mayPress(role, "ccp-link-present2"), `${role}: Open Credit Snapshot visible only when the gate lets this role press it`);
      if (visible) {
        await link.click();
        await page.waitForURL(new RegExp(`/app/present\\.html\\?contact=${CLIENT}`));
      } else {
        assert.deepEqual(errors, [], role);
      }
      await page.close();
    }
    // With no client open the link is the address the page was written with.
    const bare = await openPanel({ query: "" });
    await bare.page.locator("#more-menu > summary").click();
    assert.equal(await bare.page.locator("#ccp-link-present2").getAttribute("href"), "present.html");
    await bare.page.close();
  });
  await proof.check(/^More menu: Open Bank Inbox button/, async () => {
    const { page, seen, errors } = await openPanel();
    await page.locator("#more-menu > summary").click();
    assert.equal(await page.locator("#ccp-bank-inbox").isHidden(), true);
    assert.deepEqual(seen.inbox, [], "nothing is read until the button is pressed");
    await page.locator("#ccp-bank-inbox-open").click();
    await waitFor(() => seen.inbox.length === 1, "the inbox read");
    assert.deepEqual(seen.inbox, [{ client_id: CLIENT, limit: "100" }]);
    await waitFor(async () => /Chase update/.test(await page.locator("#ccp-bank-inbox").textContent()), "the messages");
    assert.match(await page.locator("#ccp-bank-inbox").innerText(), /Chase update[\s\S]*We received your documents\./);
    // A second press hides it, a third shows it again without reading again.
    await page.locator("#ccp-bank-inbox-open").click();
    assert.equal(await page.locator("#ccp-bank-inbox").isHidden(), true);
    await page.locator("#ccp-bank-inbox-open").click();
    assert.equal(await page.locator("#ccp-bank-inbox").isVisible(), true);
    assert.equal(seen.inbox.length, 1);
    assert.deepEqual(errors, []);
    await page.close();

    // An empty inbox and a failed read each say so in words.
    const empty = await openPanel({ overrides: { inbox: { ok: true, items: [] } } });
    await empty.page.locator("#more-menu > summary").click();
    await empty.page.locator("#ccp-bank-inbox-open").click();
    await waitFor(async () => (await empty.page.locator("#ccp-bank-inbox").textContent()) === "No bank messages for this client.", "the empty words");
    await empty.page.close();
    const failed = await openPanel({ overrides: { inbox: { ok: false, error: "forbidden" } } });
    await failed.page.locator("#more-menu > summary").click();
    await failed.page.locator("#ccp-bank-inbox-open").click();
    await waitFor(async () => (await failed.page.locator("#ccp-bank-inbox").textContent()) === "Bank messages could not be loaded.", "the failure words");
    await failed.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
