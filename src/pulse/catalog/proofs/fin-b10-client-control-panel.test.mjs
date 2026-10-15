// Practice test (real page, fake /api answers) for thirteen Client Control Panel controls in batch 10:
// the five folding groups (Agent context, Credit & Hold Status, Details, Capital Blueprint, System Facts),
// the client picker, the Quick launch links, Open FinanceOS, the More menu (Funding Matrix, Credit
// Snapshot, Bank Inbox), the credit partner links and the Declines "Use this email" button.
// The expected words are worked out in this file from the fake data, not copied from the page.
// It reads no live data. Each row is claimed only inside the callback that asserts it.
//
// The Quick launch links and the Credit Snapshot link are also judged live, from the deployed link gate
// (src/pulse/coverage/fin-b10-link-gate.mjs). Here every role is opened in a real page and the link must be
// shown exactly when that same role model says the role may open the screen. That ties the live check to
// what a person sees, in both states: today the gate hides the Closer Deck and Credit Snapshot links from
// every role, and the day the screen is added to the gate's lists the link must show and open.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";
import { parseShellLists, screensFor } from "../../coverage/fin-b10-link-gate.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER = "bbbbbbbb-2222-4222-8222-222222222222";
const PARTNER = "cccccccc-3333-4333-8333-333333333333";

const ROLES = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist"];

// The gate this page loads: the repo's shell.js, read the way the live check reads the deployed one.
const SHELL_LISTS = parseShellLists(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app/shell.js"), "utf8"));
const mayOpen = (role, screen) => screensFor(SHELL_LISTS, role).includes(screen);
const asRole = (role) => ({ ok: true, staff: { id: `staff-${role}`, name: "Casey Reed", email: "casey@fundhub.ai", role, org_id: "org-1", status: "active" } });

const FILE = {
  ok: true,
  client: {
    id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+1 555 0100",
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

const expanded = (page, selector) => page.locator(selector).getAttribute("aria-expanded");

// One folding group: shut at first, opens on a press, shuts on a second press, and keeps its body hidden state in step.
async function foldGroup(page, bodyId, { stateWord = false } = {}) {
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
    await bare.page.locator('.group-title.tog[aria-controls="hold-body"]').click();
    for (const id of ["ccp-credit-status", "ccp-income-ex", "ccp-income-eq", "ccp-hold-reason"]) {
      assert.equal(await bare.page.locator(`#${id}`).textContent(), "—", id);
    }
    await bare.page.close();
  });
});

test("Details toggle: starts shut and holds the email, phone, tier and path of this client", async () => {
  await proof.check(/^Details toggle/, async () => {
    const { page, errors } = await openPanel();
    const shut = await foldGroup(page, "details-body");
    assert.equal(await page.locator("#ccp-email").textContent(), "dana@example.com");
    assert.equal(await page.locator("#ccp-phone").textContent(), "+1 555 0100");
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
    await open.page.locator('.group-title.tog[aria-controls="facts-body"]').click();
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
});

test("Credit partner links: both point at the partner's own file and consent, and neither shows with no partner", async () => {
  await proof.check(/^Credit partner links/, async () => {
    const { page, errors } = await openPanel();
    await page.locator('.group-title.tog[aria-controls="bp-body"]').click();
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
    await none.page.locator('.group-title.tog[aria-controls="bp-body"]').click();
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
    await page.locator('.group-title.tog[aria-controls="bp-body"]').click();
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
      const { page, errors } = await openPanel({ session: asRole(role) });
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
    const bare = await openPanel({ query: "" });
    assert.equal(await bare.page.locator("#ccp-link-financeos").isVisible(), false);
    await bare.page.close();
    // The press opens FinanceOS for that client.
    const owner = await openPanel();
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
      const { page, errors } = await openPanel();
      const link = page.locator(`#${id}`);
      assert.equal(await link.isVisible(), true, `${label} is shown`);
      assert.match((await link.textContent()).trim(), new RegExp(`^${label}`));
      assert.match(await link.getAttribute("href"), hrefRe, label);
      await link.click();
      await page.waitForURL(urlRe);
      assert.deepEqual(errors, [], label);
      await page.close();
    }

    // Every role, every link: shown exactly when the link gate lets that role open the screen. The Closer Deck
    // link carries this client in its address whether it is shown or not, and a shown one is pressed and
    // lands on the deck screen for this client.
    assert.ok(SHELL_LISTS, "the shell's screen lists are readable");
    const links = [
      ["ccp-link-pipeline", "pipeline.html"],
      ["ccp-link-present", "present.html"],
      ["ccp-link-messaging", "messaging.html"],
      ["ccp-link-ir", "inquiry-remover.html"],
    ];
    for (const role of ROLES) {
      const { page } = await openPanel({ session: asRole(role) });
      for (const [id, screen] of links) {
        assert.equal(await page.locator(`#${id}`).isVisible(), mayOpen(role, screen),
          `${role}: ${id} (${screen}) is shown only when the link gate lets this role open it`);
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
    // The address is right for this client and the same for everybody. The row is shown exactly when the link
    // gate lets that role open present.html, and a shown link is pressed and lands on the screen.
    assert.ok(SHELL_LISTS, "the shell's screen lists are readable");
    for (const role of ROLES) {
      const { page, errors } = await openPanel({ session: asRole(role) });
      await page.locator("#more-menu > summary").click();
      const link = page.locator("#ccp-link-present2");
      assert.match(await link.getAttribute("href"), new RegExp(`^present\\.html\\?contact=${CLIENT}`), `${role}: address`);
      const visible = await link.isVisible();
      assert.equal(visible, mayOpen(role, "present.html"), `${role}: Open Credit Snapshot visible only when the gate lets this role open it`);
      if (visible) {
        await link.click();
        await page.waitForURL(new RegExp(`/app/present\\.html\\?contact=${CLIENT}`));
      } else {
        assert.deepEqual(errors, [], role);
      }
      await page.close();
    }
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
