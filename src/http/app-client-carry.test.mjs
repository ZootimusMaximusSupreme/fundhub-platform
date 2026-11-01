/* Tests for public/app/shell.js carrying the open client from screen to screen,
 * and for the gate hole that had to be closed before it could.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Every Finance OS screen is about ONE named
 * client and reads that client out of the address bar. Nothing put it there.
 * The only way in was pasting a uuid, and the first sidebar click dropped it —
 * so a person working a client's file typed the same uuid back in at every
 * screen. That is what made a finished product feel like a pile of separate
 * pages, and it is the whole reason this pass exists.
 *
 * THE SECOND DEFECT, WHICH IS A SECURITY ONE AND WAS FOUND WHILE FIXING THE
 * FIRST. shell.js decided whether a link pointed at a screen by testing the WHOLE
 * href against /^[a-z0-9-]+\.html$/. A link carrying a query string therefore was
 * not a screen link at all: the click interceptor skipped it and gateLinks() never
 * hid it. Every link a screen builds in JavaScript carries one, so a role that
 * may not open a screen could be handed a live link to it, click it, and be
 * bounced back out by the session pass. That bounce is precisely the behaviour
 * shell.js's own header says the gate exists to have fixed.
 *
 * HOW THIS TESTS AN IIFE THAT EXPORTS NOTHING. shell.js redirects on load and
 * returns no handle, so it is EXECUTED against a stub browser — a small DOM with
 * real anchors in it — and the assertions are made on the anchors afterwards.
 * That is deliberately not a text scan: the rules under test are about what the
 * href ENDS UP as, and a regex over the source would pass on code that never
 * runs. src/http/app-nav-reachability.test.mjs reads the same file as text
 * because it asks a different question (which screens are listed), and the two
 * are complementary.
 *
 * ELEVEN FINANCE SCREENS BECAME ONE. money-map.html, banking-surface.html,
 * card-stack.html, bank-accounts.html, bills-cashflow.html, banking-entry.html,
 * finance-command.html, finance-add.html, alerts.html and deal-model.html are
 * gone — Finance OS (finance-os.html) absorbed them, an owner decision, not a
 * regression. finance-os.html was deleted outright on 2026-08-17, also an
 * owner decision: client payment tracking belongs in Finance OS, which is being
 * rebuilt. The tests below used to reach for whichever screen happened to fit
 * each scenario; they now reach for finance-os.html, which sits in BOTH
 * CLIENT_SCREENS and OWNER_ADMIN_ONLY exactly as finance-os.html did, so
 * every gate and carry case still has a real screen behind it. The mechanism
 * under test — carrying the open client across a query string — has nothing to
 * do with which specific screen it runs against.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (see the traps section of CLAUDE.md).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SHELL_SRC = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER = "aa11bb22-cc33-dd44-ee55-ff6677889900";

/* ── the stub browser ─────────────────────────────────────────────────────────
   Only as much as shell.js actually touches. Anything it reaches for that is
   missing throws loudly rather than being quietly absent, which is what keeps
   this from passing vacuously. */

/** A generic element. getElementById never returns null — mountChip() looks up
    its own sign-out button by id immediately after writing it as innerHTML, and
    a null there would throw for a reason that has nothing to do with the
    behaviour under test. */
function makeEl(id = "") {
  return {
    id, innerHTML: "", textContent: "", title: "",
    style: { cssText: "", display: "", visibility: "" },
    classList: { contains: () => false, add() {}, remove() {} },
    parentNode: null,
    setAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
    removeAttribute() {}, appendChild() {}, addEventListener() {},
    closest: () => null
  };
}

/**
 * anchor — one <a> in a <li>, which is the shape every sidebar row has.
 *
 * gateLinks() hides `a.closest("li")`, so the li is where the display change
 * lands and the anchor is where the href change lands. Both are asserted.
 */
function anchor(href, opts = {}) {
  const li = {
    style: { display: "" },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = v; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); },
    removeAttribute(k) { delete this._attrs[k]; }
  };
  const a = {
    _attrs: { href },
    li,
    classList: { contains: (c) => (opts.classes || []).includes(c) },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); },
    closest(sel) {
      if (sel === "li") return li;
      if (sel === "a[href]") return this;
      return null;
    },
    get href() { return this._attrs.href; }
  };
  return a;
}

/**
 * runShell — execute shell.js against a stub browser and hand back what it did.
 *
 * The CACHED ROLE is set on purpose. shell.js's pass 1 gates synchronously off
 * localStorage's hint and pass 2 re-gates off the real session; both call
 * gateLinks(), so running with a hint exercises the idempotency the two-pass
 * design depends on. A carry that appended the client twice would show up here
 * as ?client_id=x&client_id=x.
 */
async function runShell({ role = "owner", page = "finance-os.html", search = "",
                          links = [], remembered = null } = {}) {
  const store = { fh_role: role, fh_token: "t0ken" };
  if (remembered) store.fh_client = remembered;

  const navigations = [];
  const clicks = [];
  let clickHandler = null;

  const sandbox = {
    console,
    URLSearchParams,
    setTimeout: (fn) => { /* the 4s reveal net; never load-bearing here */ return 0; },
    setInterval: (fn) => { /* the staff presence heartbeat does not fire during nav checks */ return 0; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    location: {
      pathname: "/app/" + page,
      search,
      set href(v) { navigations.push({ how: "href", to: v }); },
      get href() { return "http://x/app/" + page + search; },
      replace: (v) => { navigations.push({ how: "replace", to: v }); }
    },
    document: {
      readyState: "complete",
      head: { appendChild(el) { el.parentNode = this; }, removeChild(el) { el.parentNode = null; } },
      documentElement: { style: { visibility: "" } },
      body: { appendChild() {} },
      addEventListener(type, fn) { if (type === "click") clickHandler = fn; },
      createElement: () => makeEl(),
      getElementById: () => makeEl(),
      querySelectorAll: (sel) => (sel === "a[href]" ? links : [])
    },
    fetch: (url) => {
      if (String(url).indexOf("/api/auth/session") === 0) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true, staff: { id: "s1", name: "Owner", email: "o@x", role }
          })
        });
      }
      if (String(url).indexOf("/api/health") === 0) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, db: "up", migrations: 95 })
        });
      }
      return Promise.reject(new Error("unexpected request: " + url));
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SHELL_SRC, sandbox, { filename: "shell.js" });

  // Both passes: the hint one is synchronous, the session one is a promise.
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));

  /** click — drive the real capture-phase interceptor over one anchor. */
  const click = (a) => {
    assert.ok(clickHandler, "shell.js registered no click interceptor");
    const ev = {
      defaultPrevented: false, button: 0,
      metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      target: a, preventDefault() { this.defaultPrevented = true; }
    };
    clickHandler(ev);
    clicks.push(ev);
    return ev;
  };

  return { navigations, click, store };
}

/* ── the fixture has to be honest ─────────────────────────────────────────── */

describe("shell.js — the harness reaches the real code", () => {
  test("the shell runs, gates, and rewrites the anchors it was given", async () => {
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.notEqual(a.href, "finance-os.html",
      "shell.js did not touch the anchor at all — the harness is not reaching gateLinks()");
  });
});

describe("shell.js — kill pass hides the menu row, not the URL", () => {
  test("a Finance OS nav row is hidden for the owner and still carries the client", async () => {
    const a = anchor("finance-os.html", { classes: ["navitem"] });
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.li.style.display, "none");
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });

  test("an in-page Finance OS link stays visible for the owner", async () => {
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.notEqual(a.li.style.display, "none");
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });
});

/* ── carrying the client ──────────────────────────────────────────────────── */

describe("shell.js — the open client rides along", () => {

  test("a link to a screen that reads a client gets the client appended", async () => {
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });

  test("every remaining CLIENT_SCREENS entry carries it, so a walk through the file keeps the client", async () => {
    const screens = ["finance-os.html", "closer-dashboard.html"];
    const links = screens.map((s) => anchor(s));
    await runShell({ links, search: "?client_id=" + CID });
    for (let i = 0; i < screens.length; i++) {
      assert.equal(links[i].href, screens[i] + "?client_id=" + CID,
        `${screens[i]} loses the client on navigation`);
    }
  });

  test("a screen that has no idea what a client is is left alone", async () => {
    // Putting ?client_id= on a link to Hiring is noise on a URL that means
    // nothing to the page receiving it.
    const a = anchor("hiring.html");
    const b = anchor("ops-admin.html");
    await runShell({ links: [a, b], search: "?client_id=" + CID });
    assert.equal(a.href, "hiring.html");
    assert.equal(b.href, "ops-admin.html");
  });

  test("the control panel gets ?id=, because that is what it calls the same thing", async () => {
    const a = anchor("client-control-panel.html");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "client-control-panel.html?id=" + CID,
      "client-control-panel.html reads FHData.param(\"id\"); sending it client_id " +
      "carries nothing and the screen opens on nobody");
  });

  test("a link that names its own client is never rewritten to somebody else", async () => {
    // A row can link to the client IT is about — a sample-data card, a search
    // result. Overwriting that with whoever is currently open would send the
    // reader to the wrong person's file.
    const a = anchor("finance-os.html?client_id=" + OTHER);
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "finance-os.html?client_id=" + OTHER);
  });

  test("nothing is appended when no client is open", async () => {
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "" });
    assert.equal(a.href, "finance-os.html");
  });

  test("a junk client_id is not sprayed across the app", async () => {
    // Ten links carrying a typo is ten 400s reported as ten separate faults.
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "?client_id=not-a-uuid" });
    assert.equal(a.href, "finance-os.html");
  });

  test("gateLinks runs twice and the client is appended exactly once", async () => {
    // The hint pass and the session pass both call it. Rewriting from the live
    // href instead of data-fh-href would produce ?client_id=x&client_id=x.
    const a = anchor("finance-os.html");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
    assert.equal((a.href.match(/client_id=/g) || []).length, 1);
  });

  test("an existing query string is extended, not replaced", async () => {
    const a = anchor("finance-os.html?tier=starter");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "finance-os.html?tier=starter&client_id=" + CID);
  });

  test("a fragment stays at the end where a fragment belongs", async () => {
    const a = anchor("finance-os.html#history");
    await runShell({ links: [a], search: "?client_id=" + CID });
    assert.equal(a.href, "finance-os.html?client_id=" + CID + "#history");
  });
});

describe("shell.js — remembering the client across a screen that has none", () => {

  test("a detour through Ops Admin does not lose who you were working on", async () => {
    // Page 1: the hub, with a client. That is what puts it in the memory.
    const onHub = anchor("ops-admin.html");
    const hub = await runShell({ links: [onHub], search: "?client_id=" + CID });
    assert.equal(hub.store.fh_client, CID, "the open client was not remembered");

    // Page 2: Ops Admin itself, no client in the bar. Its sidebar rows
    // still have to point back at the client's file.
    const a = anchor("finance-os.html");
    await runShell({ links: [a], page: "ops-admin.html", search: "", remembered: CID });
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });

  test("the address bar always beats the memory", async () => {
    const a = anchor("finance-os.html");
    const r = await runShell({ links: [a], search: "?client_id=" + CID, remembered: OTHER });
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
    assert.equal(r.store.fh_client, CID, "the memory was not updated to the client on screen");
  });

  test("a remembered value that is not a uuid is ignored, not propagated", async () => {
    const a = anchor("finance-os.html");
    await runShell({ links: [a], page: "ops-admin.html", search: "", remembered: "wat" });
    assert.equal(a.href, "finance-os.html");
  });

  test("the control panel's ?id= is what gets remembered on the control panel", async () => {
    // `id` means a client THERE and something else everywhere else, so it is
    // read only on that one screen.
    const seen = anchor("finance-os.html");
    const r = await runShell({
      links: [seen], page: "client-control-panel.html", search: "?id=" + CID
    });
    assert.equal(r.store.fh_client, CID);
    assert.equal(seen.href, "finance-os.html?client_id=" + CID);
  });

  /* Hole 10 taught the pages to open a file from ?client= and ?contact= too.
     The shell was not taught, so the page opened the right person while the
     rail around it pointed somewhere else. These pin that the shell now agrees
     with the pages - and the ?id= test directly below pins the one spelling it
     still must NOT take everywhere. */

  test("?client= is read as the client, on any screen", async () => {
    const a = anchor("finance-os.html");
    const r = await runShell({ links: [a], page: "closer-dashboard.html", search: "?client=" + CID });
    assert.equal(r.store.fh_client, CID);
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });

  test("?contact= is read as the client, on any screen", async () => {
    const a = anchor("finance-os.html");
    const r = await runShell({ links: [a], page: "closer-dashboard.html", search: "?contact=" + CID });
    assert.equal(r.store.fh_client, CID);
    assert.equal(a.href, "finance-os.html?client_id=" + CID);
  });

  test("a junk ?client= does not shadow a good ?client_id=", async () => {
    const a = anchor("finance-os.html");
    const r = await runShell({
      links: [a], page: "closer-dashboard.html",
      search: "?client=not-a-uuid&client_id=" + CID
    });
    assert.equal(r.store.fh_client, CID,
      "only a real uuid wins, whichever spelling carries it");
  });

  test("an ?id= on some other screen is NOT read as a client", async () => {
    // agent-editor.html?id= is an agent. Remembering it as a client would send
    // the next click to a record that is not a person.
    const a = anchor("finance-os.html");
    const r = await runShell({ links: [a], page: "agent-editor.html", search: "?id=" + CID });
    assert.equal(r.store.fh_client, undefined);
    assert.equal(a.href, "finance-os.html");
  });
});

/* ── hole N15: the control panel's Client Portal row ─────────────────────────
   Live 2026-09-18: on #11's control panel the rail's Client Portal row opened
   /app/client-portal.html with no client, and the owner landed on "We could
   not load your file". From a client's control panel that row must open that
   client's portal. Everywhere else it must stay exactly as it was. */

describe("shell.js — hole N15: Client Portal row on a client's control panel", () => {

  test("on a client's control panel the Client Portal row opens that client's portal", async () => {
    const a = anchor("client-portal.html", { classes: ["navitem"] });
    await runShell({ links: [a], page: "client-control-panel.html", search: "?id=" + CID });
    assert.equal(a.href, "client-portal.html?client_id=" + CID,
      "the Client Portal row on a client's control panel carries no client, so the " +
      "portal opens on nobody and says 'We could not load your file'");
    assert.notEqual(a.li.style.display, "none", "the owner's Client Portal row was hidden");
  });

  test("it follows the control panel whichever spelling opened it", async () => {
    for (const key of ["client_id", "client", "contact"]) {
      const a = anchor("client-portal.html", { classes: ["navitem"] });
      await runShell({ links: [a], page: "client-control-panel.html", search: "?" + key + "=" + CID });
      assert.equal(a.href, "client-portal.html?client_id=" + CID, "opened with ?" + key + "=");
    }
  });

  test("it is the client on screen, not the one remembered from before", async () => {
    const a = anchor("client-portal.html", { classes: ["navitem"] });
    await runShell({ links: [a], page: "client-control-panel.html",
                     search: "?id=" + CID, remembered: OTHER });
    assert.equal(a.href, "client-portal.html?client_id=" + CID);
  });

  test("a control panel with no client open leaves the row as it was", async () => {
    const a = anchor("client-portal.html", { classes: ["navitem"] });
    await runShell({ links: [a], page: "client-control-panel.html", search: "", remembered: CID });
    assert.equal(a.href, "client-portal.html");
  });

  test("everywhere else the row behaves as before, even with a client remembered", async () => {
    for (const page of ["pipeline.html", "documents.html", "finance-os.html", "consent-capture.html"]) {
      const a = anchor("client-portal.html", { classes: ["navitem"] });
      await runShell({ links: [a], page, search: "?client_id=" + CID, remembered: CID });
      assert.equal(a.href, "client-portal.html", "the Client Portal row changed on " + page);
    }
  });

  test("a portal link that already names its client is left alone", async () => {
    const a = anchor("client-portal.html?id=" + OTHER);
    const b = anchor("client-portal.html?client_id=" + OTHER);
    await runShell({ links: [a, b], page: "client-control-panel.html", search: "?id=" + CID });
    assert.equal(a.href, "client-portal.html?id=" + OTHER);
    assert.equal(b.href, "client-portal.html?client_id=" + OTHER);
  });

  test("the other rows on the control panel are unchanged", async () => {
    const fos = anchor("finance-os.html");
    const msg = anchor("messaging.html");
    const aff = anchor("affiliate.html");
    await runShell({ links: [fos, msg, aff], page: "client-control-panel.html", search: "?id=" + CID });
    assert.equal(fos.href, "finance-os.html?client_id=" + CID);
    assert.equal(msg.href, "messaging.html");
    assert.equal(aff.href, "affiliate.html");
  });
});

/* ── the gate hole ────────────────────────────────────────────────────────── */

describe("shell.js — a query string does not open a hole in the gate", () => {

  test("a forbidden screen is hidden even when the link carries a client", async () => {
    // A closer may not open finance-os.html (shell.js OWNER_ADMIN_ONLY).
    const a = anchor("finance-os.html?client_id=" + CID);
    await runShell({ role: "closer", page: "closer-dashboard.html",
                     search: "?client_id=" + CID, links: [a] });
    assert.equal(a.li.style.display, "none",
      "a link with a query string was not gated — every link these screens build " +
      "in JavaScript carries one, so this is the whole set of them");
  });

  test("a click on a forbidden screen with a query string is stopped", async () => {
    const a = anchor("finance-os.html?client_id=" + CID);
    const r = await runShell({ role: "closer", page: "closer-dashboard.html", links: [a] });
    const ev = r.click(a);
    assert.equal(ev.defaultPrevented, true,
      "the click interceptor let a forbidden navigation start; the session pass " +
      "would then bounce the user straight back out, which is the exact behaviour " +
      "shell.js exists to have fixed");
  });

  test("a click on an allowed screen with a query string still goes through", async () => {
    const a = anchor("client-control-panel.html?client_id=" + CID);
    const r = await runShell({ role: "closer", page: "closer-dashboard.html", links: [a] });
    assert.equal(r.click(a).defaultPrevented, false);
  });

  test("closer bounced off a forbidden screen lands on the closer dashboard", async () => {
    // Closer home is closer-dashboard.html, inside /app/ and in CLIENT_SCREENS,
    // so the bounce carries client_id through. It used to be /dashboard.html
    // outside /app/, which could not carry it; that page was deleted
    // (owner-set 2026-08-17).
    const r = await runShell({
      role: "closer", page: "finance-os.html", search: "?client_id=" + CID
    });
    assert.ok(r.navigations.length > 0, "a forbidden screen was not routed away from");
    assert.equal(r.navigations[0].to, "/app/closer-dashboard.html?client_id=" + CID);
  });

  test("an allowed row keeps its client and stays visible", async () => {
    const a = anchor("closer-dashboard.html");
    await runShell({ role: "closer", page: "closer-dashboard.html",
                     search: "?client_id=" + CID, links: [a] });
    assert.equal(a.href, "closer-dashboard.html?client_id=" + CID);
    assert.notEqual(a.li.style.display, "none");
  });
});

/* ── Finance OS ───────────────────────────────────────────────────────────── */

describe("finance-os.html — reachable and carries no invented money", () => {
  const FOS = fs.readFileSync(path.join(APP, "finance-os.html"), "utf8");

  // Finance OS used to be a hub of cards linking out to six area screens, each
  // of which linked back. Those six screens are gone — Finance OS is now the
  // one self-contained screen for a client's whole money picture, so there is
  // nothing left to link out to and nothing to link back from. What is still
  // real, and still worth guarding, is audit finding M8: a screen must never
  // show a number the server did not send.
  test("no invented money is left in the static markup", () => {
    // Comments first, and for the same reason the old partial-marker test used
    // to strip them: this repo's house style is a long comment that names the
    // defect, and a comment can legitimately quote a dollar figure while
    // explaining why it was removed. A scan over raw markup would find the
    // explanation and report it as the bug.
    const beforeScript = FOS.split("<script")[0]
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.ok(!/\b\d{1,3}(,\d{3})+\.\d\d\b/.test(beforeScript),
      "there is a money-shaped figure in Finance OS's static markup");
    assert.ok(!/>\s*sample\s*</.test(beforeScript),
      "Finance OS still carries rows labelled 'sample'");
  });
});
