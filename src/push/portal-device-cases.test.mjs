// The notifications card on a real phone — the page's own code, RUN, not read.
//
// WHY THIS FILE EXISTS. The card in public/app/client-portal.html has one job:
// tell a client the truth about their own phone. It got that wrong in the way
// that is hardest to notice, because it went wrong in SILENCE.
//
//   An iPhone on iOS 16.3 in Safari was shown "iPhone only allows notifications
//   once FundHub is on your home screen. Three taps and you are done." The
//   client did the three taps. The page came back as an installed app, and the
//   notifications card DISAPPEARED — no message, no reason, nothing where it
//   had been. iOS 16.4 is the first version with web push at all, so those three
//   taps could never have worked, and the only version warning fired below 16.
//
// A regular expression over the HTML cannot catch that: the strings were all
// there, it was the branch that picked between them that was wrong. So the
// page's push script is pulled out of the file and run inside a fake browser —
// a fake navigator, a fake window, and the real card's elements — once per device, and
// what the client would SEE is read back off those elements afterwards.
//
// Every case below is a device shape a client of this product actually holds.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_FILE = path.resolve(HERE, "../../public/app/client-portal.html");
const ORIGIN = "https://portal.test";

/** The page's push script, taken out of the page rather than copied. */
function pushScriptSource() {
  const html = fs.readFileSync(PORTAL_FILE, "utf8");
  for (const id of ["push-marketing", "push-marketing-loading", "push-marketing-copy", "push-marketing-btn"]) {
    assert.ok(html.includes(`id="${id}"`), `client portal is missing ${id}`);
  }
  const blocks = html.split(/<script(?:\s[^>]*)?>/).slice(1)
    .map((chunk) => chunk.split("</script>")[0]);
  const found = blocks.filter((b) => b.includes('var SW_URL = "/app/client-portal-sw.js"'));
  assert.equal(found.length, 1,
    `expected exactly one push script block in client-portal.html, found ${found.length}`);
  return found[0];
}

const PUSH_SCRIPT = pushScriptSource();

function fakeElement(id) {
  return {
    id,
    hidden: true,
    disabled: false,
    textContent: "",
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.hasOwn(this._attrs, k) ? this._attrs[k] : null; },
    addEventListener() {}
  };
}

/**
 * runCase(device) → what the client sees
 *
 * device: {
 *   ua               the user agent string
 *   standalone       navigator.standalone (iPhone/iPad "is it installed")
 *   displayMode      matchMedia("(display-mode: standalone)") answer
 *   maxTouchPoints   how an iPad on iPadOS gives itself away
 *   pushManager      whether "PushManager" in window  (false before iOS 16.4)
 *   notification     whether "Notification" in window
 *   serviceWorker    whether navigator has one
 *   permission       Notification.permission
 *   subscribed       does the browser already hold a subscription
 * }
 */
async function runCase(device) {
  const els = {
    "push-card": fakeElement("push-card"),
    "push-copy": fakeElement("push-copy"),
    "push-steps": fakeElement("push-steps"),
    "push-btn": fakeElement("push-btn"),
    "push-status": fakeElement("push-status"),
    "push-marketing": fakeElement("push-marketing"),
    "push-marketing-loading": fakeElement("push-marketing-loading"),
    "push-marketing-copy": fakeElement("push-marketing-copy"),
    "push-marketing-btn": fakeElement("push-marketing-btn")
  };
  const calls = { permissionAsked: 0, subscribed: 0, registered: 0, fetches: [] };

  const registration = {
    update() {},
    pushManager: {
      getSubscription: async () => (device.subscribed
        ? { endpoint: ORIGIN + "/ep/1", toJSON: () => ({ endpoint: ORIGIN + "/ep/1", keys: {} }), unsubscribe: async () => true }
        : null),
      subscribe: async () => { calls.subscribed += 1; return { endpoint: ORIGIN + "/ep/1", toJSON: () => ({}), unsubscribe: async () => true }; }
    }
  };

  const sandbox = {
    console,
    URL,
    URLSearchParams,
    Promise,
    setTimeout,
    Math,
    JSON,
    String,
    Number,
    Uint8Array,
    atob: globalThis.atob,
    document: {
      readyState: "complete",
      getElementById: (id) => els[id] || null,
      addEventListener: () => {}
    },
    localStorage: {
      getItem: (k) => (k === "fh_token" ? (device.token === undefined ? "a-token" : device.token) : null)
    },
    navigator: {
      userAgent: device.ua,
      maxTouchPoints: device.maxTouchPoints || 0,
      ...(device.standalone === undefined ? {} : { standalone: device.standalone }),
      ...(device.serviceWorker === false ? {} : {
        serviceWorker: {
          register: async () => { calls.registered += 1; return registration; },
          getRegistrations: async () => []
        }
      })
    },
    fetch: async (url) => {
      calls.fetches.push(String(url));
      return {
        status: 200,
        json: async () => (url === "/api/push/preferences"
          ? { ok: true, marketing_push_enabled: false }
          : { ok: true, configured: true, public_key: "BPk" })
      };
    },
    caches: undefined
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = new URL(ORIGIN + "/app/client-portal.html");
  sandbox.matchMedia = () => ({ matches: device.displayMode === "standalone" });
  if (device.pushManager !== false) sandbox.PushManager = function PushManager() {};
  if (device.notification !== false) {
    sandbox.Notification = {
      permission: device.permission || "default",
      requestPermission: async () => { calls.permissionAsked += 1; return device.permission === "denied" ? "denied" : "granted"; }
    };
  }

  vm.createContext(sandbox);
  vm.runInContext(PUSH_SCRIPT, sandbox, { filename: "client-portal.html#push" });

  // start() runs on load and its work is asynchronous. Let it finish.
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));

  return {
    cardShown: els["push-card"].hidden === false,
    copy: els["push-copy"].textContent,
    stepsShown: els["push-steps"].hidden === false,
    buttonShown: els["push-btn"].hidden === false,
    buttonText: els["push-btn"].textContent,
    status: els["push-status"].textContent,
    marketingShown: els["push-marketing"].hidden === false,
    marketingCopy: els["push-marketing-copy"].textContent,
    calls
  };
}

/* ── The devices ──────────────────────────────────────────────────────────── */
const UA = {
  ios15:  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
  ios160: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  ios163: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  ios164: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1",
  ios175: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipad17: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

const CASES = [
  {
    name: "iPhone, iOS 15.7, Safari, not installed",
    device: { ua: UA.ios15, standalone: false, pushManager: false, notification: false },
    expect: { cardShown: true, stepsShown: false, buttonShown: false, copyMatch: /16\.4 or newer/ }
  },
  {
    name: "iPhone, iOS 16.0, Safari, not installed",
    device: { ua: UA.ios160, standalone: false, pushManager: false, notification: false },
    expect: { cardShown: true, stepsShown: false, buttonShown: false, copyMatch: /16\.4 or newer/ }
  },
  {
    name: "iPhone, iOS 16.3, Safari, not installed",
    device: { ua: UA.ios163, standalone: false, pushManager: false, notification: false },
    expect: { cardShown: true, stepsShown: false, buttonShown: false, copyMatch: /16\.4 or newer/ }
  },
  {
    name: "iPhone, iOS 16.3, INSTALLED on the home screen",
    device: { ua: UA.ios163, standalone: true, displayMode: "standalone", pushManager: false, notification: false },
    expect: { cardShown: true, stepsShown: false, buttonShown: false, copyMatch: /16\.4 or newer/ }
  },
  {
    name: "iPhone, iOS 16.4, Safari, not installed",
    device: { ua: UA.ios164, standalone: false },
    expect: { cardShown: true, stepsShown: true, buttonShown: false, copyMatch: /home screen/ }
  },
  {
    name: "iPhone, iOS 17.5, Safari, not installed",
    device: { ua: UA.ios175, standalone: false },
    expect: { cardShown: true, stepsShown: true, buttonShown: false, copyMatch: /home screen/ }
  },
  {
    name: "iPhone, iOS 17.5, INSTALLED on the home screen",
    device: { ua: UA.ios175, standalone: true, displayMode: "standalone" },
    expect: { cardShown: true, stepsShown: false, buttonShown: true, buttonText: "Turn on notifications" }
  },
  {
    name: "iPad, iPadOS 17.5 (says it is a Mac), installed",
    device: { ua: UA.ipad17, maxTouchPoints: 5, displayMode: "standalone" },
    expect: { cardShown: true, stepsShown: false, buttonShown: true, buttonText: "Turn on notifications" }
  },
  {
    name: "Android, Chrome 126",
    device: { ua: UA.android },
    expect: { cardShown: true, stepsShown: false, buttonShown: true, buttonText: "Turn on notifications" }
  },
  {
    name: "Desktop, Chrome 126",
    device: { ua: UA.desktop },
    expect: { cardShown: true, stepsShown: false, buttonShown: true, buttonText: "Turn on notifications" }
  }
];

describe("the notifications card, per device — the page's own code in a fake browser", () => {
  const table = [];

  for (const c of CASES) {
    test(c.name, async () => {
      const seen = await runCase(c.device);
      table.push({ name: c.name, seen });

      assert.equal(seen.cardShown, c.expect.cardShown, "card visibility");
      assert.equal(seen.stepsShown, c.expect.stepsShown, "add-to-home-screen steps visibility");
      assert.equal(seen.buttonShown, c.expect.buttonShown, "button visibility");
      if (c.expect.copyMatch) assert.match(seen.copy, c.expect.copyMatch);
      if (c.expect.buttonText) assert.equal(seen.buttonText, c.expect.buttonText);

      // NOTHING asks for permission on load, on any device. That prompt is a
      // one-shot and it belongs to the button.
      assert.equal(seen.calls.permissionAsked, 0, "permission was requested on page load");
      assert.equal(seen.calls.subscribed, 0, "a subscription was created on page load");

      // No device is ever left with a card and no words in it.
      if (seen.cardShown) {
        assert.ok(seen.copy.trim().length > 0, "the card is showing with nothing written in it");
      }
      assert.equal(seen.marketingShown, true, "signed-in client cannot see marketing choice");
      assert.match(seen.marketingCopy, /Marketing updates are off/);
    });
  }

  test("THE BUG: no iPhone below 16.4 is ever shown the three taps, installed or not", async () => {
    for (const ua of [UA.ios15, UA.ios160, UA.ios163]) {
      for (const installed of [false, true]) {
        const seen = await runCase({
          ua, standalone: installed, displayMode: installed ? "standalone" : "browser",
          pushManager: false, notification: false
        });
        assert.equal(seen.stepsShown, false,
          `${ua.slice(28, 44)} installed=${installed} was told to add it to the home screen`);
        assert.equal(seen.cardShown, true,
          `${ua.slice(28, 44)} installed=${installed} was shown nothing at all`);
        assert.match(seen.copy, /16\.4 or newer/,
          `${ua.slice(28, 44)} installed=${installed} was not told why`);
      }
    }
  });

  test("THE OTHER HALF OF THE BUG: an installed 16.3 iPhone gets a sentence, not an empty space", async () => {
    const seen = await runCase({
      ua: UA.ios163, standalone: true, displayMode: "standalone",
      pushManager: false, notification: false
    });
    assert.equal(seen.cardShown, true, "the card vanished after the three taps");
    assert.ok(seen.copy.length > 20, "the card is there but says nothing useful");
  });

  test("a signed-out client is shown nothing — the card has nothing true to say", async () => {
    const seen = await runCase({ ua: UA.ios175, standalone: true, displayMode: "standalone", token: "" });
    assert.equal(seen.cardShown, false);
    assert.equal(seen.marketingShown, false);
    assert.deepEqual(seen.calls.fetches, []);
  });

  test("the version is never guessed from a Mac user agent", async () => {
    // An iPad on iPadOS 17 reports "Mac OS X 10_15_7". Reading 10 out of that
    // would tell a current iPad to update software that is already current.
    const seen = await runCase({ ua: UA.ipad17, maxTouchPoints: 5, displayMode: "standalone" });
    assert.doesNotMatch(seen.copy, /16\.4 or newer/, "an iPad on iPadOS 17 was told it is too old");
  });

  test("prints the table", () => {
    const pad = (s, n) => String(s).padEnd(n);
    console.log("");
    console.log(`      ${pad("device", 48)} ${pad("card", 6)} ${pad("steps", 6)} ${pad("button", 7)} what the client reads`);
    for (const row of table) {
      const words = row.seen.cardShown
        ? (row.seen.copy.replace(/\s+/g, " ").trim().slice(0, 62) + "…")
        : "(no card shown)";
      console.log(`      ${pad(row.name, 48)} ${pad(row.seen.cardShown ? "shown" : "hidden", 6)} ${pad(row.seen.stepsShown ? "shown" : "—", 6)} ${pad(row.seen.buttonShown ? "shown" : "—", 7)} ${words}`);
    }
    console.log("");
  });
});
