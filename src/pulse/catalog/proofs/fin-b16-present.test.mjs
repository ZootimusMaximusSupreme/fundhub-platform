// Batch 16 practice tests: three controls of the closer's client deck (public/app/present.js and
// contract-send.js). The real scripts run whole in a vm against a stand-in page and fake answers, a button
// is pressed, and the test reads what the page painted and what it asked the clipboard and the server to
// do. No browser, no network, no database, nothing sent.
//
//   S-23 "Other actions"            opens and closes the second row of actions
//   S-23 "Copy the sign link"       appears once a contract is sent, with the read-only link box
//   S-19 "Show the full Blueprint stack"   opens section 06 (B-01) from the Blueprint rung only

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { offersForClient } from "../../../config/offers.mjs";
import { proofRows } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP = path.join(ROOT, "public/app");
// The page itself is read, not assumed: the scripts it loads, in its own order, and the ids it holds. A page
// that drops contract-send.js or renames #app is a deck with no Copy button, and this test sees it.
const HTML = fs.readFileSync(path.join(APP, "present.html"), "utf8");
const SCRIPTS = [...HTML.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
// The three slide visual files (ops/workflows/weekend-2026-10-24.md section 10.8) are named by the page before
// they are built. A browser gets a 404 for a missing one and present.js keeps today's slide, so a missing visual
// file is skipped here the same way. Every other script the page names must be in the site.
const VISUAL_FILES = new Set(["/app/present-visuals.js", "/app/present-blueprint-demo.js", "/app/present-journey.js"]);
// The course is off until it is filmed (COURSE_LIVE). The education route runs with the one switch on.
const COURSE_OFF = "var COURSE_LIVE = false;";
const PAGE_IDS = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const OFFERS = offersForClient();
const CONTACT = "33333333-3333-3333-3333-333333333333";
const LINK = "https://sign.example.test/c/abc123";

function payload(tier) {
  return {
    client_id: CONTACT,
    survey: { name: "Sam Sample" },
    businesses: [],
    income_estimates: {},
    engine: { available: true, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 }, total: 20000, afterFix: 60000, negItems: 3, reasons: [], plan: [], totalBasis: "personal_only", sample: false },
    soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "fin-b16-proof-result", sample: false },
    offers: OFFERS,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** present.js and contract-send.js against a stand-in page, with every server answer and clipboard write recorded. */
async function openDeck(tier, { copyWorks = true, wordings = null, sendAnswer = null, course = false } = {}) {
  const root = { innerHTML: "" };
  const writes = [];
  const reads = [];
  const copied = [];
  let onClick = null;
  const sandbox = {
    console,
    URLSearchParams,
    Promise,
    Date,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    clearTimeout,
    location: { search: `?contact=${CONTACT}`, pathname: "/app/present.html" },
    navigator: {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
          if (!copyWorks) throw new Error("clipboard blocked");
        },
      },
    },
    document: {
      readyState: "complete",
      getElementById: (id) => (id === "app" && PAGE_IDS.has("app") ? root : null),
      querySelectorAll: () => [],
      addEventListener: (type, fn) => { if (type === "click") onClick = fn; },
    },
    localStorage: { getItem: (k) => (k === "fh_role" ? "owner" : null) },
    FHData: {
      read: async (what, query) => {
        reads.push({ what, query });
        if (what === "contracts") {
          const items = wordings || OFFERS.map((o, i) => ({ id: `tpl-${i}`, template_key: o.contractTemplateKey, name: `${o.name} agreement`, active: true }))
            .concat([{ id: "tpl-bp", template_key: "CAPITAL-BLUEPRINT-AGREEMENT", name: "Capital Blueprint agreement", active: true }]);
          return { ok: true, data: { items } };
        }
        return { ok: true, data: payload(tier) };
      },
      write: async (url, body) => {
        writes.push({ url, body });
        if (sendAnswer) return sendAnswer(url, body);
        if (body.action === "create_draft") return { ok: true, data: { contract: { id: "contract-1" } } };
        if (body.action === "send") return { ok: true, data: { links: [{ url: LINK }], message: "Sent." } };
        return { ok: true, data: {} };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  vm.createContext(sandbox);
  // data.js is the stand-in FHData above; every other script the page names is run, in the page's order.
  for (const src of SCRIPTS.filter((name) => name !== "data.js")) {
    const file = src.startsWith("/") ? path.join(ROOT, "public", src.slice(1)) : path.join(APP, src);
    if (VISUAL_FILES.has(src) && !fs.existsSync(file)) continue;
    let code = fs.readFileSync(file, "utf8");
    if (course && src === "present.js") {
      assert.ok(code.includes(COURSE_OFF), "present.js lost its one course switch");
      code = code.replace(COURSE_OFF, "var COURSE_LIVE = true;");
    }
    vm.runInContext(code, sandbox, { filename: file });
  }
  await flush();
  await flush();
  assert.ok(onClick, "present.js registered no click listener");
  const deck = {
    writes, reads, copied,
    html: () => root.innerHTML,
    text: () => root.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    click(act) { onClick({ target: { closest: () => ({ getAttribute: () => act }) } }); return deck; },
    slide() {
      const m = /<div class="slide-hd"><span class="mono">([A-Z]-\d\d) \/ /.exec(root.innerHTML);
      return m ? m[1] : null;
    },
    has: (act) => root.innerHTML.includes(`data-act="${act}"`),
    label(act) {
      const m = new RegExp(`<button[^>]*data-act="${act}"[^>]*>([^<]*)</button>`).exec(root.innerHTML);
      return m ? m[1] : null;
    },
    async settle(times = 6) { for (let i = 0; i < times; i += 1) await flush(); },
  };
  return deck;
}

test("Other actions opens a second row of actions on the close slide and Hide the other actions closes it", async () => {
  await proof.check(/^'Other actions' open\/close toggle \(S-23\)/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.click("stack-go:S-23");
    assert.equal(deck.slide(), "S-23");
    assert.equal(deck.label("more"), "Other actions");
    for (const word of ["Invoice this client", "Send contract", "Repair referral"]) {
      assert.ok(!deck.text().includes(word), `${word} stays out of sight until Other actions is pressed`);
    }
    assert.ok(deck.text().includes("Send pay link"), "the one leading action is always there");
    deck.click("more");
    assert.equal(deck.label("more"), "Hide the other actions");
    for (const word of ["Invoice this client", "Send contract", "Repair referral"]) assert.ok(deck.text().includes(word), word);
    assert.equal(deck.has("invoice"), true);
    assert.equal(deck.has("contract"), true);
    // Pressing it again folds the row back; the leading action did not move.
    deck.click("more");
    assert.equal(deck.label("more"), "Other actions");
    assert.ok(!deck.text().includes("Invoice this client"));
    assert.ok(deck.text().includes("Send pay link"));
    assert.deepEqual(deck.writes, [], "opening and closing a row sends nothing");
  });
});

test("Copy the sign link appears only once a contract was sent, with the link in a read-only box", async () => {
  await proof.check(/^'Copy the sign link' and the read-only sign-link box/, async () => {
    const deck = await openDeck("FULL_FUNDING");
    deck.click("stack-go:S-23").click("more");
    assert.equal(deck.has("contract-copy"), false, "no link, no copy button");
    assert.ok(!deck.html().includes('id="fh-contract-link"'));

    deck.click("contract");
    await deck.settle();
    const sends = deck.writes.filter((w) => w.url === "/api/contracts");
    assert.deepEqual(sends.map((w) => w.body.action), ["create_draft", "send"], "a draft is made for this client, then sent");
    assert.equal(sends[0].body.client_id, CONTACT);
    assert.equal(sends[1].body.id, "contract-1");
    assert.equal(deck.has("contract-copy"), true);
    assert.equal(deck.label("contract-copy"), "Copy the sign link");
    const box = /<input id="fh-contract-link" readonly value="([^"]*)"/.exec(deck.html());
    assert.ok(box, "the link sits in a read-only box");
    assert.equal(box[1], LINK);
    assert.deepEqual(deck.copied, [LINK], "the link is put on the clipboard once when it is sent");

    // The button copies the same link again, and says so. Copying sends nothing: the writes are counted
    // again after the press, from the live list (the first list is a copy made before it).
    const writesBefore = deck.writes.length;
    deck.click("contract-copy");
    await deck.settle();
    assert.deepEqual(deck.copied, [LINK, LINK]);
    assert.ok(deck.text().includes("Sign link copied."));
    assert.equal(deck.writes.length, writesBefore, "copying sends nothing");
    assert.equal(deck.writes.filter((w) => w.url === "/api/contracts").length, 2, "still one draft and one send");
  });

  await proof.check(/^'Copy the sign link' and the read-only sign-link box/, async () => {
    // The page names its script and its root: contract-send.js is loaded by present.html, and #app is there.
    assert.ok(SCRIPTS.includes("contract-send.js"), "present.html loads contract-send.js");
    assert.ok(SCRIPTS.includes("present.js"), "present.html loads present.js");
    assert.ok(SCRIPTS.indexOf("contract-send.js") < SCRIPTS.indexOf("present.js"), "the helper is loaded before the deck");
    assert.ok(PAGE_IDS.has("app"), "present.html holds the #app the deck draws into");
    // A link with characters that mean something in a page is shown as text, not as markup, and is
    // copied exactly as it is.
    const odd = 'https://sign.example.test/c/a"b<c>&d';
    const deck = await openDeck("FULL_FUNDING", { sendAnswer: async (url, body) => (body.action === "create_draft"
      ? { ok: true, data: { contract: { id: "contract-2" } } }
      : { ok: true, data: { links: [{ url: odd }], message: "Sent." } }) });
    deck.click("stack-go:S-23").click("more").click("contract");
    await deck.settle();
    assert.ok(deck.html().includes('value="https://sign.example.test/c/a&quot;b&lt;c&gt;&amp;d"'), "the box value is escaped");
    assert.ok(!deck.html().includes('value="https://sign.example.test/c/a"b'), "no raw quote breaks out of the box");
    assert.deepEqual(deck.copied, [odd], "the clipboard gets the real link");
  });

  await proof.check(/^'Copy the sign link' and the read-only sign-link box/, async () => {
    // A browser that refuses the clipboard is told so, and the link is still there to select.
    const deck = await openDeck("FULL_FUNDING", { copyWorks: false });
    deck.click("stack-go:S-23").click("more").click("contract");
    await deck.settle();
    assert.ok(deck.html().includes(`value="${LINK}"`));
    deck.click("contract-copy");
    await deck.settle();
    assert.ok(deck.text().includes("Copy failed — select the link and copy it."));
    assert.ok(!deck.text().includes("Sign link copied."));
  });

  await proof.check(/^'Copy the sign link' and the read-only sign-link box/, async () => {
    // A send the server refused leaves no link and no copy button.
    const deck = await openDeck("FULL_FUNDING", { sendAnswer: async () => ({ ok: false, error: "No such agreement." }) });
    deck.click("stack-go:S-23").click("more").click("contract");
    await deck.settle();
    assert.equal(deck.has("contract-copy"), false);
    assert.ok(!deck.html().includes('id="fh-contract-link"'));
    assert.deepEqual(deck.copied, []);
  });
});

test("Show the full Blueprint stack opens section 06 from the Blueprint rung, and from no other offer", async () => {
  await proof.check(/^'Show the full Blueprint stack'/, async () => {
    const repair = await openDeck("REPAIR_ONLY");
    repair.click("stack-go:S-19");
    assert.equal(repair.slide(), "S-19");
    // The repair route starts on the Capital Blueprint rung, the most expensive door that fits (row 2).
    assert.equal(repair.has("rung:2"), true);
    assert.equal(repair.has("stack-open"), true, "a file that is not ready starts on the Blueprint rung");
    repair.click("rung:0");
    assert.equal(repair.has("stack-open"), false, "not on the full done-for-you rung");
    repair.click("rung:1");
    assert.equal(repair.has("stack-open"), false, "not on the trial rung");
    repair.click("rung:2");
    assert.equal(repair.has("stack-open"), true, "on the Capital Blueprint rung");
    assert.equal(repair.label("stack-open"), "Show the full Blueprint stack");
    assert.ok(repair.text().includes("Opens section 06: every piece, FinanceOS live, the price, and the FinanceOS downsell."));
    repair.click("stack-open");
    assert.equal(repair.slide(), "B-01", "it opens section 06 at its first piece");
    repair.click("stack-leave");
    assert.equal(repair.slide(), "S-19", "and Leave brings the closer back to where they were");

    // The education route's second course is the same Blueprint stack (the course switch on).
    const edu = await openDeck("REPAIR_ONLY", { course: true });
    edu.click("desc:eduLow");
    assert.equal(edu.slide(), "S-19");
    assert.equal(edu.has("stack-open"), true);
    edu.click("rung:0");
    assert.equal(edu.has("stack-open"), false, "the top course is not the Blueprint stack");

    // A funding sale has no Blueprint rung at all.
    const funding = await openDeck("FULL_FUNDING");
    funding.click("stack-go:S-19");
    assert.equal(funding.slide(), "S-19");
    assert.equal(funding.has("stack-open"), false);
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
