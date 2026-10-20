/* Tests for the owner/admin "Send portal sign-in link" control on
 * public/app/client-control-panel.html.
 *
 * WHAT IT IS FOR. A client who pays gets an active portal account with a
 * password hash nobody holds. The reset screen they land on tells them to ask
 * an owner or admin for a link — and until this control shipped there was
 * nowhere in the CRM for an owner or admin to press, so the only instruction
 * the product gave a stuck client was impossible to follow (walk finding F31,
 * 2026-09-03).
 *
 * WHY IT LIVES HERE. package.json's test glob is "src/**" and "scripts/**", so
 * a test under api/ or public/ is silently never collected (CLAUDE.md §12).
 * This is the sibling of src/http/client-panel-screen.test.mjs and reads the
 * same page the same way.
 *
 * THE CROSS-CHECK IS THE POINT OF HALF OF THESE. The screen's request shape and
 * the screen's role gate are both asserted against api/auth/send-portal-link.mjs
 * itself, not against a second copy typed into this file — so moving the
 * endpoint's body key or widening its role set breaks the screen's test rather
 * than shipping a button that posts a shape nothing reads.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.resolve(HERE, "../../public/app/client-control-panel.html");
const ENDPOINT = path.resolve(HERE, "../../api/auth/send-portal-link.mjs");
const PANEL_HTML = fs.readFileSync(PANEL, "utf8");
const ENDPOINT_SRC = fs.readFileSync(ENDPOINT, "utf8");

/* The wiring on its own, comments and all. Sliced rather than executed: the
   block reads localStorage and the DOM, and what these tests are about is the
   decisions in it, which are all visible in the source. */
function wiring() {
  const a = PANEL_HTML.indexOf("(function wirePortalLink() {");
  assert.ok(a !== -1, "wirePortalLink is gone from client-control-panel.html");
  const b = PANEL_HTML.indexOf("\n  })();", a);
  assert.ok(b > a, "wirePortalLink no longer closes where it used to");
  return PANEL_HTML.slice(a, b);
}

/* Comments in this file argue with the code on purpose ("never reported as a
   send"), so a test that greps the block has to read the code only. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── RUNNING THE BLOCK FOR REAL ────────────────────────────────────────────
   Greping the source proves the lines are written. It does not prove the
   button ends up unpressable, and "the control looked fine in review" is how
   F24 shipped in the first place. So the block is executed against four fake
   nodes and a fake clock, and the assertions read the state a person would see:
   is the button disabled, what does it say, what is on the line under it.

   The fakes are deliberately tiny — an element here is the four properties the
   block touches. Nothing else on the page is in scope. */
function runWiring({ role = "owner", clientId = "c-1", write } = {}) {
  const el = (extra) => Object.assign({
    hidden: false, disabled: false, textContent: "", listeners: [],
    addEventListener(kind, fn) { if (kind === "click") this.listeners.push(fn); }
  }, extra || {});

  const nodes = {
    "ccp-portal-link-wrap": el({ hidden: true }),
    "ccp-portal-link": el(),
    "ccp-portal-link-label": el({ textContent: "Send portal sign-in link" }),
    "ccp-portal-link-status": el()
  };

  const timers = [];
  const sandbox = {
    $: (domId) => nodes[domId] || null,
    id: clientId,
    localStorage: { getItem: (k) => (k === "fh_role" ? role : null) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    Date,
    Promise
  };
  sandbox.window = { FHData: { write: write || (() => Promise.resolve({ ok: true, data: { sent: true } })) } };
  sandbox.FHData = sandbox.window.FHData;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(wiring() + "\n  })();", sandbox, { filename: PANEL + "#wirePortalLink" });

  return {
    nodes,
    timers,
    // Every pending cooldown, fired as if its wait had elapsed.
    tick: () => { while (timers.length) timers.shift().fn(); },
    press: () => {
      const fns = nodes["ccp-portal-link"].listeners;
      assert.equal(fns.length, 1, "the button has no click handler, or more than one");
      fns[0]();
      // The block's own promise chain settles on the microtask queue.
      return Promise.resolve().then(() => {}).then(() => {}).then(() => {});
    }
  };
}

describe("client-control-panel.html — send the client their portal sign-in link", () => {

  test("the control exists in Access > Client sign-in and not on a new screen", () => {
    assert.match(PANEL_HTML, /id="ccp-portal-link"/,
      "the send button is gone, so the reset screen's instruction is unfollowable again");
    assert.match(PANEL_HTML, /id="ccp-portal-link-status"/,
      "the button has no line to report into");
    assert.match(PANEL_HTML, /<span id="ccp-portal-link-label">Send portal sign-in link<\/span>/,
      "the button no longer says what it does (UI-STANDARDS §5)");

    // Current main puts account controls together on the record's Access tab.
    // It remains an in-place action, not a new page, screen, or menu row.
    const accessStart = PANEL_HTML.indexOf('<section class="workspace-view" id="ccp-view-access"');
    const accessEnd = PANEL_HTML.indexOf("</section>", accessStart);
    const access = PANEL_HTML.slice(accessStart, accessEnd);
    assert.ok(accessStart !== -1 && accessEnd > accessStart && access.includes("<h2>Portal access</h2>"),
      "the Access tab or Portal access section moved or was renamed");
    assert.ok(access.includes('<div class="group-title card-title">Client sign-in</div>'),
      "the Client sign-in group moved or was renamed");
    assert.ok(access.includes('id="ccp-portal-link"'),
      "the send control left Access > Client sign-in");
    assert.ok(!/href="[^"]*portal-link[^"]*"/.test(PANEL_HTML),
      "a link to a new screen was added; this control belongs on the client record");
  });

  test("it is gated to owner and admin, and hidden rather than disabled for anyone else", () => {
    assert.match(PANEL_HTML, /<div class="portal-link" id="ccp-portal-link-wrap" hidden>/,
      "the control renders before the role is known; it must start hidden");

    const code = stripComments(wiring());
    assert.match(code, /localStorage\.getItem\("fh_role"\)/,
      "the gate is not reading the role shell.js caches");
    assert.match(code, /viewerRole !== "owner" && viewerRole !== "admin"/,
      "the owner/admin gate is gone or was widened");
    assert.match(code, /viewerRole !== "owner" && viewerRole !== "admin"\) return;/,
      "a role that is neither owner nor admin must leave the block before the control is shown");
    const gateAt = code.indexOf('viewerRole !== "owner"');
    const showAt = code.indexOf("wrap.hidden = false");
    assert.ok(gateAt !== -1 && showAt > gateAt,
      "the control is revealed before the role is checked");
  });

  test("the screen's role gate matches the roles the endpoint actually allows", () => {
    assert.match(ENDPOINT_SRC, /requireRole\("owner", "admin"\)/,
      "api/auth/send-portal-link.mjs changed which roles it allows — the screen's gate now disagrees with it");
  });

  test("it posts the shape the endpoint actually reads", () => {
    const code = stripComments(wiring());
    assert.match(code, /FHData\.write\("\/api\/auth\/send-portal-link", \{ client_id: id \}\)/,
      "the button is posting somewhere else, or under a key the endpoint does not read");
    assert.match(ENDPOINT_SRC, /\(req\.body \|\| \{\}\)\.client_id/,
      "the endpoint stopped reading client_id off the body — the screen's payload is now wrong");
    assert.match(ENDPOINT_SRC, /req\.method !== "POST"/,
      "the endpoint is no longer a POST, so FHData.write is the wrong caller");
  });

  test("a press locks the button while the request is in flight", () => {
    const code = stripComments(wiring());
    const handler = code.slice(code.indexOf('btn.addEventListener("click"'));
    assert.ok(handler.length > 200, "the click handler is gone");
    assert.match(handler, /if \(btn\.disabled\) return;/,
      "a second press during a send is not refused");
    const disableAt = handler.indexOf("btn.disabled = true;");
    const writeAt = handler.indexOf("FHData.write(");
    assert.ok(disableAt !== -1 && writeAt > disableAt,
      "the button is disabled after the request goes out, not before it");
    assert.match(handler, /label\.textContent = "Sending…";/,
      "the button gives no pressed state; that is the whole F24 defect");
  });

  test("a success holds the button shut for a few seconds and leaves a line that stays", () => {
    const code = stripComments(wiring());
    assert.match(code, /var SEND_COOLDOWN_MS = \d+;/, "the cooldown is gone");
    const ms = Number(code.match(/var SEND_COOLDOWN_MS = (\d+);/)[1]);
    assert.ok(ms >= 3000 && ms <= 5000,
      "the cooldown is outside the owner's three-to-five seconds: " + ms + "ms");
    assert.match(code, /setTimeout\(release, SEND_COOLDOWN_MS\)/,
      "nothing gives the button back after the cooldown, or it comes back immediately");
    assert.match(code, /say\("Sent at " \+ clockTime\(new Date\(\)\)/,
      "the persistent 'Sent at HH:MM' line is gone — a toast that vanishes is what it replaced");
    assert.match(code, /sentCount > 1 \? " · sent " \+ sentCount \+ " times"/,
      "a repeat send is invisible again");

    // The line is written by textContent and nothing ever clears it on a timer.
    assert.ok(!/setTimeout\([^)]*say\(/.test(code),
      "the sent line is being cleared on a timer; it must persist");
  });

  test("a failure is never reported as a send, and stays retryable", () => {
    const code = stripComments(wiring());
    const handler = code.slice(code.indexOf("FHData.write("));

    // Not ok — print the endpoint's own sentence, no timestamp, no cooldown.
    assert.match(handler, /if \(!res \|\| !res\.ok\) \{\s*release\(\);/,
      "a refused send does not give the button back");
    assert.match(handler, /say\(\(res && res\.error\) \|\| "The sign-in link was not sent\. Try again\."\)/,
      "the screen is rewriting the server's refusal; only the server knows whether the address is missing or the limit was hit");

    // ok:true with sent:false means the link was made and no email was queued.
    assert.match(handler, /res\.data\.sent !== true/,
      "an ok reply that queued no email is being reported as sent");
    const sentFalse = handler.indexOf("res.data.sent !== true");
    const sentAt = handler.indexOf('say("Sent at ');
    assert.ok(sentFalse !== -1 && sentAt > sentFalse,
      "the 'Sent at' line is written before the reply is checked for an actual send");

    // The failure branches must run BEFORE anything increments the counter or
    // starts a cooldown, or a failed press would lock the button.
    const countAt = handler.indexOf("sentCount += 1;");
    assert.ok(countAt > sentFalse, "a failed send is counted as a send");
  });

  test("the endpoint's own refusals are sentences a non-engineer can act on", () => {
    // The screen prints these verbatim, so they are part of this control's copy
    // whether or not they are typed on the page.
    assert.match(ENDPOINT_SRC, /This client has no email address on file, so there is nowhere to send a link\./,
      "the no-address refusal stopped naming the next move");
    assert.match(ENDPOINT_SRC, /A link was already sent to this client a moment ago\. Wait a few minutes and try again\./,
      "the rate-limit refusal stopped naming the next move");
  });

  test("with no client open the button says so instead of posting nothing", () => {
    const code = stripComments(wiring());
    assert.match(code, /if \(!id\) \{\s*btn\.disabled = true;/,
      "the button is live with no client file open");
    assert.match(code, /say\("Open a client file before sending a sign-in link\."\)/,
      "an empty screen offers a button with no explanation");
  });
});

/* The same control, run rather than read. See runWiring() above for why. */
describe("client-control-panel.html — the portal link button, run", () => {

  test("an owner and an admin see it; nobody else does", () => {
    for (const role of ["owner", "admin", "Owner ", "ADMIN"]) {
      const r = runWiring({ role });
      assert.equal(r.nodes["ccp-portal-link-wrap"].hidden, false,
        "role " + JSON.stringify(role) + " cannot see the control it is supposed to press");
    }
    for (const role of ["closer", "funding_advisor", "sales_manager", "inquiry_specialist", "partner", "", null]) {
      const r = runWiring({ role });
      assert.equal(r.nodes["ccp-portal-link-wrap"].hidden, true,
        "role " + JSON.stringify(role) + " is being offered a button the endpoint will refuse");
      assert.equal(r.nodes["ccp-portal-link"].listeners.length, 0,
        "role " + JSON.stringify(role) + " got a live click handler on a hidden control");
    }
  });

  test("with no client open the button is dead and says why", () => {
    const r = runWiring({ clientId: "" });
    assert.equal(r.nodes["ccp-portal-link"].disabled, true, "the button is live with no file open");
    assert.match(r.nodes["ccp-portal-link-status"].textContent, /Open a client file/,
      "the dead button gives no reason");
  });

  test("one press sends once, then refuses a second press until the cooldown passes", async () => {
    const sent = [];
    const r = runWiring({
      write: (path, body) => { sent.push({ path, body }); return Promise.resolve({ ok: true, data: { sent: true } }); }
    });

    await r.press();
    assert.deepEqual(sent, [{ path: "/api/auth/send-portal-link", body: { client_id: "c-1" } }],
      "the press did not post once, to the endpoint, with the key it reads");
    assert.equal(r.nodes["ccp-portal-link"].disabled, true,
      "the button is pressable again the instant the send returns — this is F24");
    assert.equal(r.nodes["ccp-portal-link-label"].textContent, "Sent — hold on",
      "the button does not say it is holding");
    assert.match(r.nodes["ccp-portal-link-status"].textContent, /^Sent at \d/,
      "no persistent sent line under the button");

    // Three more presses inside the cooldown. This is the exact gesture that
    // put four emails in a client's inbox.
    await r.press(); await r.press(); await r.press();
    assert.equal(sent.length, 1, "presses during the cooldown sent " + sent.length + " links; a sign-in link is a live door");

    r.tick();
    assert.equal(r.nodes["ccp-portal-link"].disabled, false, "the button never comes back");
    assert.equal(r.nodes["ccp-portal-link-label"].textContent, "Send portal sign-in link",
      "the button is stuck on its holding label");

    await r.press();
    assert.equal(sent.length, 2, "the button will not send again after its cooldown");
    assert.match(r.nodes["ccp-portal-link-status"].textContent, /· sent 2 times/,
      "a real repeat send is invisible again");
  });

  test("a refusal keeps the button pressable and shows the server's own sentence", async () => {
    const refusal = "This client has no email address on file, so there is nowhere to send a link.";
    let calls = 0;
    const r = runWiring({
      write: () => { calls += 1; return Promise.resolve({ ok: false, source: "badrequest", error: refusal }); }
    });

    await r.press();
    assert.equal(calls, 1);
    assert.equal(r.nodes["ccp-portal-link"].disabled, false,
      "a failed send locked the button; there is nothing to protect against");
    assert.equal(r.nodes["ccp-portal-link-status"].textContent, refusal,
      "the refusal was rewritten or swallowed");
    assert.equal(r.timers.length, 0, "a failed send started a cooldown");

    await r.press();
    assert.equal(calls, 2, "a failed send cannot be retried");
  });

  test("an ok reply that queued no email is not reported as sent", async () => {
    const r = runWiring({ write: () => Promise.resolve({ ok: true, data: { sent: false, url: "https://x/y" } }) });
    await r.press();
    assert.ok(!/Sent at/.test(r.nodes["ccp-portal-link-status"].textContent),
      "a link that was made but never mailed is being reported as sent: " +
      r.nodes["ccp-portal-link-status"].textContent);
    assert.equal(r.nodes["ccp-portal-link"].disabled, false, "and it is not retryable");
  });

  test("a real send is not erased by a failure after it", async () => {
    let ok = true;
    const r = runWiring({
      write: () => Promise.resolve(ok ? { ok: true, data: { sent: true } } : { ok: false, error: "The server did not answer." })
    });
    await r.press();
    const line = r.nodes["ccp-portal-link-status"].textContent;
    assert.match(line, /^Sent at /);
    r.tick();
    ok = false;
    await r.press();
    assert.match(r.nodes["ccp-portal-link-status"].textContent, /did not answer/,
      "the failure is not shown");
    // The count survives, so the next success still says "sent 2 times" rather
    // than pretending the first one never happened.
    ok = true;
    await r.press();
    assert.match(r.nodes["ccp-portal-link-status"].textContent, /· sent 2 times/,
      "the earlier real send was forgotten");
  });
});
