// Practice test (real page, fake /api answers) for the twelve Brand Studio controls in batch 09.
// Org mode (the CRM's own brand) covers the colour, face, name, preset, reset and wordmark boxes and
// what they put in the PUT /api/org-brand body. Partner mode (?partner_id=) covers the DNS copy
// buttons, the copy-history selects and the owner's Turn off for page writing.
// It reads no live data. Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, dialogs, json, OWNER, proofRows, sharedScreens, textsSeen, waitFor, watchText } from "./fin-b09-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const PID = "9d6a4c1e-7a53-4f0a-8b0e-2f4c1b5e7a11";
const ADMIN = { ok: true, staff: { id: "staff-a", name: "Alex Admin", email: "alex@fundhub.ai", role: "admin", org_id: "org-1", status: "active" } };

// A 1x1 PNG, built from its bytes so no file is read.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

async function openOrg({ session = OWNER } = {}) {
  const puts = [];
  const { page, errors } = await screens.open("/app/brand-studio.html", {
    session,
    handlers: {
      "/api/org-brand": async (route, { method }) => {
        if (method === "PUT") {
          puts.push(bodyOf(route));
          return json(route, { ok: true, brand: {} });
        }
        return json(route, { ok: true, brand: null });
      },
    },
  });
  const dlg = dialogs(page);
  await page.waitForFunction(() => /Nothing is saved for this brand yet/.test(document.querySelector("#saveMsg").innerText));
  return { page, errors, puts, dlg };
}

async function save(page, puts) {
  const before = puts.length;
  await page.locator("#saveBtn").click();
  await waitFor(() => puts.length === before + 1, "the PUT /api/org-brand request");
  await page.waitForFunction(() => /Saved\. Applied across the CRM\./.test(document.querySelector("#saveMsg").innerText));
  return puts[puts.length - 1];
}

test("Accent ramp: each of the six pickers is its own stop in the saved ramp and in the preview strip", async () => {
  await proof.check("Accent ramp: six colour pickers", async () => {
    const { page, errors, puts } = await openOrg();
    const picked = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788"];
    const start = await page.evaluate(() => [0, 1, 2, 3, 4, 5].map((i) => document.querySelector(`#r${i}`).value));
    // Touch one picker at a time: only that stop may move, and in the saved body it is that index.
    for (let i = 0; i < 6; i += 1) {
      await page.locator(`#r${i}`).fill(picked[i]);
      const body = await save(page, puts);
      const expected = start.map((c, at) => (at <= i ? picked[at] : c));
      assert.deepEqual(body.ramp.map((c) => c.toLowerCase()), expected, `after picker ${i}`);
    }
    const strip = await page.evaluate(() => document.querySelector("#rampPrev").style.background);
    for (const hex of picked) assert.ok(strip.includes(rgb(hex)), `the preview strip carries ${hex}`);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Brand name: the typed name is the wordmark text, the Brand tile and the saved entity name", async () => {
  await proof.check("Brand name input", async () => {
    const { page, errors, puts } = await openOrg();
    assert.equal(await page.locator("#kBrand").innerText(), "—");
    await page.locator("#bName").fill("Meridian Capital Partners");
    assert.equal(await page.locator("#pvWm").innerText(), "Meridian Capital Partners");
    assert.equal(await page.locator("#kBrand").innerText(), "Text mark");
    const body = await save(page, puts);
    assert.equal(body.entity_name, "Meridian Capital Partners", "with no legal entity typed, the brand name is saved");
    assert.equal(body.wordmark_url, null);

    // A typed legal entity wins in the saved body; the brand name stays the wordmark.
    await page.locator("#bEntity").fill("Meridian Capital Partners LLC");
    const second = await save(page, puts);
    assert.equal(second.entity_name, "Meridian Capital Partners LLC");
    assert.equal(await page.locator("#pvWm").innerText(), "Meridian Capital Partners");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

for (const [label, hexId, pickerId, field, picked, typed] of [
  ["Ink", "#cInkHex", "#cInk", "ink", "#1a2b3c", "#AABBCC"],
  ["Paper", "#cPaperHex", "#cPaper", "paper", "#f0e1d2", "#FDEFCB"],
]) {
  test(`${label} colour: the picker fills the hex box, a valid hex moves the picker, a bad hex is put back, and Save sends it`, async () => {
    await proof.check(new RegExp(`^${label} colour picker and hex input`), async () => {
      const { page, errors, puts } = await openOrg();
      const start = await page.locator(hexId).inputValue();

      await page.locator(pickerId).fill(picked);
      assert.equal(await page.locator(hexId).inputValue(), picked.toUpperCase(), "the picker writes the upper-case hex");
      assert.equal((await save(page, puts))[field], picked);

      await page.locator(hexId).fill(typed);
      await page.locator(hexId).blur();
      assert.equal(await page.locator(pickerId).inputValue(), typed.toLowerCase(), "a valid hex moves the picker");
      assert.equal((await save(page, puts))[field], typed);

      // Not a hex: the box goes back to the last good colour and nothing is sent that is not a hex.
      await page.locator(hexId).fill("not a colour");
      await page.locator(hexId).blur();
      assert.equal(await page.locator(hexId).inputValue(), typed);
      assert.equal(await page.locator(pickerId).inputValue(), typed.toLowerCase());
      assert.match((await save(page, puts))[field], /^#[0-9a-f]{6}$/i);
      assert.notEqual(typed, start);
      assert.deepEqual(errors, []);
      await page.close();
    });
  });
}

for (const [label, selectId, field, pick, loads] of [
  ["Display face", "#fDisplay", "display_face", "Fraunces", "Fraunces"],
  ["Mono face", "#fMono", "mono_face", "IBM Plex Mono", "IBM+Plex+Mono"],
]) {
  test(`${label} select: the chosen Google font loads on the page and is the saved face`, async () => {
    await proof.check(new RegExp(`^${label} select`), async () => {
      const { page, errors, puts } = await openOrg();
      const first = await page.locator(selectId).inputValue();
      await page.locator(selectId).selectOption(pick);
      const href = await page.evaluate(() => document.querySelector("#fontLink").href);
      assert.ok(href.includes(`family=${loads}`), `the font link asks Google for ${loads}: ${href}`);
      const body = await save(page, puts);
      assert.equal(body[field], pick);
      // The other face is not disturbed by this one.
      const other = field === "display_face" ? "mono_face" : "display_face";
      assert.ok(["Inter", "JetBrains Mono"].includes(body[other]), `${other} stayed on its default: ${body[other]}`);
      assert.notEqual(first, pick);
      assert.deepEqual(errors, []);
      await page.close();
    });
  });
}

test("Presets button walks six different ramps and comes back to the start; the strip and the saved ramp follow", async () => {
  await proof.check(/^Presets button/, async () => {
    const { page, errors, puts } = await openOrg();
    const pickers = () => page.evaluate(() => [0, 1, 2, 3, 4, 5].map((i) => document.querySelector(`#r${i}`).value));
    const start = await pickers();
    const seen = [];
    for (let click = 1; click <= 6; click += 1) {
      await page.locator("#rampPreset").click();
      const ramp = await pickers();
      assert.equal(ramp.length, 6);
      assert.ok(ramp.every((c) => /^#[0-9a-f]{6}$/.test(c)));
      seen.push(ramp.join(","));
      const body = await save(page, puts);
      assert.deepEqual(body.ramp.map((c) => c.toLowerCase()), ramp, `click ${click}: the saved ramp is the one on screen`);
    }
    assert.equal(new Set(seen.slice(0, 5)).size, 5, "five different ramps before it wraps");
    assert.notEqual(seen[0], start.join(","), "the first press changes the ramp");
    assert.equal(seen[5], start.join(","), "the sixth press is back at the starting ramp");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Reset asks first; No keeps the edits and the stored draft, Yes drops the draft and reloads", async () => {
  await proof.check(/^Reset button/, async () => {
    const { page, errors, puts, dlg } = await openOrg();
    await page.locator("#bName").fill("Meridian");
    await save(page, puts);
    const stored = () => page.evaluate(() => localStorage.getItem("fh_org_brand"));
    assert.match(await stored(), /"name":"Meridian"/, "Save keeps the draft in this browser");

    await page.locator("#bName").fill("Meridian, edited again");
    dlg.next(false);
    await page.locator("#resetBtn").click();
    await waitFor(() => dlg.seen.length === 1, "the Reset question");
    assert.equal(dlg.seen[0].type, "confirm");
    assert.match(dlg.seen[0].message, /Discard unsaved brand changes in this browser\?/);
    assert.equal(await page.locator("#bName").inputValue(), "Meridian, edited again", "No changes nothing on screen");
    assert.match(await stored(), /"name":"Meridian"/, "and the stored draft is still there");

    dlg.next(true);
    await Promise.all([page.waitForEvent("load"), page.locator("#resetBtn").click()]);
    await page.waitForFunction(() => document.querySelector("#bName") && document.querySelector("#bName").value === "");
    assert.equal(await stored(), null, "Yes drops the stored draft");
    assert.equal(puts.length, 1, "Reset never writes to the server");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Use text drops an uploaded wordmark: the picture goes, the name comes back, and Save sends no wordmark", async () => {
  await proof.check(/^Use text button/, async () => {
    const { page, errors, puts } = await openOrg();
    await page.locator("#bName").fill("Meridian");
    assert.equal(await page.locator("#clearLogo").isDisabled(), true, "nothing to clear until a wordmark is loaded");

    await page.locator("#bLogo").setInputFiles({ name: "mark.png", mimeType: "image/png", buffer: PIXEL });
    await page.waitForFunction(() => document.querySelector("#pvWm img"));
    assert.equal(await page.locator("#kBrand").innerText(), "Logo set");
    assert.equal(await page.locator("#clearLogo").isEnabled(), true);
    const withLogo = await save(page, puts);
    assert.match(withLogo.wordmark_url, /^data:image\/png;base64,/);

    await page.locator("#clearLogo").click();
    assert.equal(await page.locator("#pvWm img").count(), 0, "the picture is gone");
    assert.equal(await page.locator("#pvWm").innerText(), "Meridian", "the brand name is the wordmark again");
    assert.equal(await page.locator("#kBrand").innerText(), "Text mark");
    assert.equal(await page.locator("#clearLogo").isDisabled(), true);
    assert.equal(await page.locator("#bLogo").inputValue(), "", "the file box is emptied");
    assert.equal((await save(page, puts)).wordmark_url, null);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ── partner mode ────────────────────────────────────────────────────────────────────────────
const PAGES = [
  { id: "pg-1", title: "Apply funnel", funnel_key: "apply", slug: "apply", status: "published",
    body_json: { sections: [
      { id: "hero", type: "hero", headline: "Hero words" },
      { id: "legal", type: "legal", headline: "Legal block", locked: true },
      { id: "faq", type: "faq", headline: "FAQ block" },
    ] } },
  { id: "pg-2", title: "Diagnostic funnel", funnel_key: "diag", slug: "diag", status: "draft",
    body_json: { sections: [{ id: "intro", type: "text", headline: "Intro words" }] } },
];

async function openPartner({ session = OWNER, enabled = true, enableReply = null, init = null } = {}) {
  const state = { enabled, enables: [], history: [] };
  const { page, errors } = await screens.open(`/app/brand-studio.html?partner_id=${PID}`, {
    session,
    init,
    handlers: {
      "/api/partner-marketing/usage": async (route) => json(route, {
        ok: true, enabled: state.enabled, remaining: 4200, cap: 10000, used: 5800 }),
      "/api/partner-marketing/enable": async (route) => {
        const body = bodyOf(route);
        state.enables.push(body);
        if (enableReply) return json(route, enableReply.body, enableReply.status || 200);
        state.enabled = body.enabled === true;
        return json(route, { ok: true, enabled: state.enabled });
      },
      "/api/partner-marketing/copy-history": async (route, { url, method }) => {
        if (method === "GET") state.history.push(new URL(url).searchParams.toString());
        return json(route, { ok: true, items: [] });
      },
      "/api/partner-pages": async (route) => json(route, { ok: true, items: PAGES }),
    },
  });
  return { page, errors, state, dlg: dialogs(page) };
}

test("Generation: Turn off (owner) sends enabled:false for this partner and the page shows Off", async () => {
  await proof.check(/^Generation: Turn off/, async () => {
    const { page, errors, state } = await openPartner();
    await page.waitForFunction(() => document.querySelector("#suiteTxt").textContent === "On");
    assert.equal(await page.locator("#suiteOffBtn").isVisible(), true);
    assert.equal(await page.locator("#suiteOnBtn").isHidden(), true);
    assert.equal(await page.locator("#suiteOnTools").isVisible(), true);

    await page.locator("#suiteOffBtn").click();
    await waitFor(() => state.enables.length === 1, "the enable request");
    assert.deepEqual(state.enables[0], { partner_id: PID, enabled: false });
    await page.waitForFunction(() => document.querySelector("#suiteTxt").textContent === "Off");
    assert.equal(await page.locator("#genMsg").innerText(), "Off for this partner.");
    assert.equal(await page.locator("#suiteOnTools").isHidden(), true, "the writing tools are put away");
    assert.equal(await page.locator("#suiteOnBtn").isVisible(), true, "and Turn on is offered instead");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Generation: a refused Turn off says nothing changed and the page stays On", async () => {
  const { page, state } = await openPartner({
    enableReply: { status: 409, body: { ok: false, error: "refused", message: "Only the owner can change this." } },
  });
  await page.waitForFunction(() => document.querySelector("#suiteTxt").textContent === "On");
  await page.locator("#suiteOffBtn").click();
  await waitFor(() => state.enables.length === 1, "the enable request");
  await page.waitForFunction(() => /Only the owner can change this\./.test(document.querySelector("#genMsg").innerText));
  assert.equal(await page.locator("#suiteTxt").textContent(), "On");
  await page.close();
});

test("Generation: only the owner is shown Turn off", async () => {
  const { page, state } = await openPartner({ session: ADMIN });
  await page.waitForFunction(() => document.querySelector("#suiteTxt").textContent === "On");
  assert.equal(await page.locator("#suiteOwnerRow").isHidden(), true);
  assert.equal(state.enables.length, 0);
  await page.close();
});

test("Copy history: the page select lists the pages, the section select lists only unlocked blocks, and each pick re-reads", async () => {
  await proof.check(/^Copy history: page select and section select/, async () => {
    const { page, errors, state } = await openPartner();
    await page.waitForFunction(() => document.querySelectorAll("#histPage option").length === 2);
    assert.deepEqual(await page.locator("#histPage option").allInnerTexts(), ["Apply funnel", "Diagnostic funnel"]);
    // Locked legal text is never offered for rewriting.
    assert.deepEqual(await page.locator("#histSection option").allInnerTexts(), ["All unlocked blocks", "Hero words", "FAQ block"]);
    await waitFor(() => state.history.length >= 1, "the first copy-history read");
    assert.equal(state.history.at(-1), "page_id=pg-1", "the first page, every unlocked block");

    await page.locator("#histSection").selectOption("faq");
    await waitFor(() => state.history.at(-1) === "page_id=pg-1&section_id=faq", "the read for one section");

    await page.locator("#histPage").selectOption("pg-2");
    await page.waitForFunction(() => document.querySelectorAll("#histSection option").length === 2);
    assert.deepEqual(await page.locator("#histSection option").allInnerTexts(), ["All unlocked blocks", "Intro words"]);
    await waitFor(() => state.history.at(-1) === "page_id=pg-2", "the read for the second page, no section carried over");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("DNS copy buttons put CNAME, ALIAS/A and TXT on the clipboard and say copied", async () => {
  await proof.check(/^DNS table copy buttons/, async () => {
    const { page, errors } = await openPartner({
      init: () => {
        window.__copied = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
        });
      },
    });
    await page.locator("#bDomain").fill("meridiancapital.com");
    await page.waitForFunction(() => document.querySelector("#dnsBox").style.display === "block");
    const buttons = page.locator("#dnsBox .copyb");
    assert.equal(await buttons.count(), 3);
    // The label says "copied" for 1.1 seconds and then goes back, so every label is recorded from here on.
    await watchText(page, "#dnsBox .copyb");

    const expected = ["partners.fundhub.ai", "75.2.60.5", `fundhub-site-verify=${PID}`];
    for (let i = 0; i < 3; i += 1) {
      await buttons.nth(i).click();
      await waitFor(async () => ((await textsSeen(page, "#dnsBox .copyb"))[i] || []).includes("copied"), `button ${i} says copied`);
      assert.equal(await page.evaluate(() => window.__copied.at(-1)), expected[i], `button ${i} copies its own value`);
    }
    assert.deepEqual(await page.evaluate(() => window.__copied), expected);
    // The words come back after a moment.
    await page.waitForFunction(() => [...document.querySelectorAll("#dnsBox .copyb")].every((b) => b.innerText === "copy"));
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
