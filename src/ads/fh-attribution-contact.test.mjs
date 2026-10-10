// src/ads/fh-attribution-contact.test.mjs — /roadmap step 1 saves on a valid
// email alone, then merges the phone and name.
//
// public/funnel/fh-attribution.js posts kind "contact" to
// api/public/slo-interest.mjs. This test runs the real script against a tiny
// fake page, then hands what it posted to the real door, with a fake events
// table and a fake ClickFunnels that matches on email the way its docs say the
// upsert does.
//
// Buy box v2 (owner-set 2026-10-02) is the default fake page: form.s1 holds
// c_first, c_last, email; form.s3 holds the phone next to the soft pull boxes
// (legal name, dob, ssn, address). The older page (phone on form.s1) is kept as
// layout "v1" because the shared script can go live before or after the page.
//
// WHAT THIS CANNOT TEST: a real browser, sendBeacon on a real tab close, or the
// live ClickFunnels account. The live check is the /roadmap phone checklist.
//
// npm test's glob is src/** and scripts/** only (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { recordInterest } from "../../api/public/slo-interest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = fs.readFileSync(path.join(ROOT, "public/funnel/fh-attribution.js"), "utf8");

function runRoadmap({ layout = "v2", search = "?utm_source=fb&utm_content=43-roadmap", cookie = "", storage = {}, now } = {}) {
  const posts = [];
  const doc = {};
  const win = {};
  const store = { ...storage };
  const asked = new Set();
  let timers = [];
  let nextTimer = 1;

  const input = (name) => ({ name, value: "" });
  const fakeForm = (names) => {
    const own = Object.fromEntries(names.map((n) => [n, input(n)]));
    const f = {
      own,
      querySelector(sel) {
        const m = /name="([^"]+)"/.exec(sel);
        if (m) asked.add(m[1]);
        return m && own[m[1]] ? own[m[1]] : null;
      },
      contains: (n) => n === f || Object.values(own).includes(n),
      appendChild() {}
    };
    return f;
  };
  const STEP3 = ["first_name", "last_name", "dob", "ssn", "address", "city", "zip"];
  const form = fakeForm(layout === "v1" ? ["email", "phone", "c_first", "c_last"] : ["email", "c_first", "c_last"]);
  const s3 = fakeForm(layout === "v1" ? STEP3 : [...STEP3, "phone"]);
  const fields = { ...s3.own, ...form.own };
  const widget = {
    querySelector: (sel) => (sel === "form.s1" ? form : sel === "form.s3" ? s3 : null),
    contains: (n) => n === widget || form.contains(n) || s3.contains(n)
  };

  Object.assign(doc, {
    readyState: "complete",
    referrer: "",
    cookie,
    visibilityState: "visible",
    activeElement: null,
    listeners: {},
    addEventListener(n, fn) { (doc.listeners[n] ||= []).push(fn); },
    getElementById: (id) => (id === "fhw" ? widget : null),
    querySelectorAll: (sel) => (sel === "form" ? [form, s3] : []),
    createElement: () => ({}),
    head: { appendChild() {} }
  });
  Object.assign(win, {
    listeners: {},
    addEventListener(n, fn) { (win.listeners[n] ||= []).push(fn); },
    fetch(url, init) {
      posts.push({ via: "fetch", url, init, body: init && typeof init.body === "string" ? JSON.parse(init.body) : null });
      return { catch() {} };
    }
  });
  const navigator = {
    webdriver: false,
    userAgent: "Mozilla/5.0 (iPhone)",
    sendBeacon(url, blob) { posts.push({ via: "beacon", url, body: JSON.parse(blob.text) }); return true; }
  };

  const FixedDate = now == null ? Date : Object.assign(function () { return new Date(now); }, { now: () => now });
  vm.runInNewContext(SRC, {
    window: win,
    document: doc,
    navigator,
    location: { search, pathname: "/roadmap" },
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    URLSearchParams,
    URL,
    Blob: class { constructor(parts) { this.text = parts.join(""); } },
    setTimeout(fn) { const id = nextTimer++; timers.push({ id, fn }); return id; },
    clearTimeout(id) { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0,
    clearInterval() {},
    JSON, Math, Date: FixedDate, String, Number, Object, Array
  });

  const fire = (name, target) => (doc.listeners[name] || []).forEach((fn) => fn({ target }));
  return {
    posts,
    store,
    fields,
    win,
    doc,
    /** Field names the script looked up on a form (hidden-input stamping included). */
    asked,
    /** A page fetch, through the script's wrapper. */
    pageFetch(url, init) { return win.fetch(url, init); },
    contacts: () => posts.filter((p) => p.body.kind === "contact"),
    /** Type into a field; focus stays there. */
    type(name, value) {
      fields[name].value = value;
      doc.activeElement = fields[name];
      fire("input", fields[name]);
    },
    /** Leave the field: the browser fires change on it. */
    leave(name, next) {
      doc.activeElement = next ? fields[next] : null;
      fire("change", fields[name]);
    },
    /** 1.5 seconds pass with no typing. */
    pause() { const due = timers; timers = []; due.forEach((t) => t.fn()); },
    submit() { fire("submit", form); },
    submit3() { fire("submit", s3); },
    close() { (win.listeners.pagehide || []).forEach((fn) => fn({})); }
  };
}

/* The real door, with an events table that keeps one row per key and merges
   UPDATE ... payload || $1 like jsonb, and ClickFunnels matched on email. */
function door() {
  const rows = [];
  const cfContacts = new Map();
  const cfCalls = [];
  const jobs = [];
  const deps = {
    orgId: "org-1",
    userAgent: "Mozilla/5.0 (iPhone)",
    now: new Date("2026-10-01T18:00:00Z"),
    fanout: async () => {},
    onCfWrite: (j) => jobs.push(j),
    async emit(_db, name, payload, opts) {
      if (rows.some((r) => r.key === opts.idempotencyKey)) return { id: null, deduped: true };
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`;
      rows.push({ id, name, key: opts.idempotencyKey, payload: structuredClone(payload) });
      return { id, deduped: false };
    },
    db: {
      async query(sql, params) {
        if (/SELECT id, payload FROM events/.test(sql)) {
          const r = rows.find((x) => x.key === params[1]);
          return { rows: r ? [{ id: r.id, payload: structuredClone(r.payload) }] : [] };
        }
        if (/UPDATE events SET payload = payload \|\| \$1::jsonb/.test(sql)) {
          const r = rows.find((x) => x.id === params[1]);
          if (r) Object.assign(r.payload, structuredClone(params[0]));
          return { rows: [] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    },
    async syncCf(input) {
      cfCalls.push(input);
      const prev = cfContacts.get(input.email) || { id: cfContacts.size + 1 };
      const next = { ...prev };
      for (const k of ["firstName", "lastName", "phone"]) if (input[k]) next[k] = input[k];
      cfContacts.set(input.email, next);
      return { ok: true, id: next.id };
    }
  };
  return {
    rows, cfContacts, cfCalls,
    async post(body) { const out = await recordInterest(body, deps); await Promise.all(jobs); return out; }
  };
}

describe("fh-attribution.js on /roadmap step 1", () => {
  test("nothing is saved while they are still typing in the email box", () => {
    const p = runRoadmap();
    p.type("email", "pat@gmail.co");
    p.pause();
    assert.equal(p.contacts().length, 0, "half-typed pat@gmail.co must not be saved");
  });

  test("leaving the email box with a valid email saves it, with no phone yet", () => {
    const p = runRoadmap();
    p.type("email", "Pat@Gmail.com");
    p.leave("email", "phone");
    const c = p.contacts();
    assert.equal(c.length, 1);
    assert.equal(c[0].via, "fetch");
    assert.equal(c[0].url, "https://fundhub.ai/api/public/slo-interest");
    assert.equal(c[0].body.email, "pat@gmail.com");
    assert.equal("phone" in c[0].body, false);
    assert.equal(c[0].body.utm_content, "43-roadmap", "ad tags ride along");
    assert.equal(JSON.stringify(p.store).includes("pat@gmail.com"), false, "the email is not kept in storage as typed");
  });

  test("an email that is not real is never posted", () => {
    const p = runRoadmap();
    for (const bad of ["pat", "pat@gmail", "pat@gmail.c", "pat @gmail.com"]) {
      p.type("email", bad);
      p.leave("email", "phone");
      p.pause();
    }
    p.submit();
    p.close();
    assert.equal(p.contacts().length, 0);
  });

  test("the phone posts again once all 10 digits are in, then the name; repeats post nothing", () => {
    const p = runRoadmap();
    p.type("email", "pat@gmail.com");
    p.leave("email", "phone");
    p.type("phone", "(415) 555-01");
    p.pause();
    assert.equal(p.contacts().length, 1, "a part phone is not a reason to post");
    p.type("phone", "(415) 555-0134");
    p.pause();
    assert.equal(p.contacts().length, 2);
    assert.equal(p.contacts()[1].body.phone, "4155550134");
    p.submit();
    p.leave("phone");
    assert.equal(p.contacts().length, 2, "same data, no second post");
    p.type("c_first", "Pat");
    p.type("c_last", "Lee");
    p.pause();
    assert.equal(p.contacts().length, 3);
    assert.equal(p.contacts()[2].body.first_name, "Pat");
    assert.equal(p.contacts()[2].body.last_name, "Lee");
  });

  test("closing the tab still inside the email box saves it by beacon", () => {
    const p = runRoadmap();
    p.type("email", "pat@gmail.com");
    p.pause();
    assert.equal(p.contacts().length, 0);
    p.close();
    const c = p.contacts();
    assert.equal(c.length, 1);
    assert.equal(c[0].via, "beacon");
    assert.equal(c[0].body.email, "pat@gmail.com");
  });
});

describe("buy box v2: the phone is typed on step 3", () => {
  test("a step-3 phone merges into the same contact save: email + phone, nothing else from step 3", () => {
    const p = runRoadmap();
    p.type("c_first", "Pat");
    p.type("c_last", "Lee");
    p.type("email", "pat@gmail.com");
    p.leave("email");
    assert.equal(p.contacts().length, 1, "saved on the email, before any phone");
    assert.equal("phone" in p.contacts()[0].body, false);

    /* Step 3, after the card: the soft pull boxes are typed first. None of
       them is a reason to post, and none of them is ever read. */
    for (const [k, v] of [["first_name", "Patricia"], ["last_name", "Leeway"], ["dob", "01/02/1980"],
      ["ssn", "123-45-6789"], ["address", "742 Evergreen Ter"], ["city", "Springfield"], ["zip", "62704"]]) {
      p.type(k, v);
      p.leave(k);
      p.pause();
    }
    assert.equal(p.contacts().length, 1, "no step-3 box but the phone triggers a save");

    p.type("phone", "(415) 555-01");
    p.pause();
    assert.equal(p.contacts().length, 1, "a part phone is not a reason to post");
    p.type("phone", "(415) 555-0134");
    p.pause();
    const c = p.contacts();
    assert.equal(c.length, 2);
    assert.equal(c[1].body.email, "pat@gmail.com", "the same email, so the server merges into the same row");
    assert.equal(c[1].body.phone, "4155550134");
    assert.equal(c[1].body.first_name, "Pat", "the step-1 name, not the legal name typed on step 3");
    assert.equal(c[1].body.last_name, "Lee");
    assert.deepEqual(Object.keys(c[1].body).sort(),
      ["email", "first_name", "kind", "landing_path", "last_name", "phone", "session_id", "utm_content", "utm_source", "webdriver"]);
    const all = JSON.stringify(p.posts);
    for (const v of ["Patricia", "Leeway", "1980", "6789", "Evergreen", "Springfield", "62704"]) {
      assert.equal(all.includes(v), false, `${v} must never leave the page through this script`);
    }

    p.leave("phone");
    p.submit3();
    assert.equal(p.contacts().length, 2, "same data, no second post");
  });

  test("a phone autofilled on step 3 with no typing is still saved when step 3 is submitted", () => {
    const p = runRoadmap();
    p.type("email", "pat@gmail.com");
    p.leave("email");
    p.fields.phone.value = "415 555 0134"; // autofill: no input event reached us
    p.submit3();
    const c = p.contacts();
    assert.equal(c.length, 2);
    assert.equal(c[1].body.phone, "4155550134");
  });

  test("the older page (phone on step 1) still merges the phone the same way", () => {
    const p = runRoadmap({ layout: "v1" });
    p.type("email", "pat@gmail.com");
    p.leave("email", "phone");
    p.type("phone", "415-555-0134");
    p.pause();
    const c = p.contacts();
    assert.equal(c.length, 2);
    assert.equal(c[1].body.phone, "4155550134");
  });
});

describe("end to end: page → door → one row and one ClickFunnels contact", () => {
  test("email first, then phone, then name", async () => {
    const p = runRoadmap();
    const d = door();

    p.type("email", "pat@gmail.com");
    p.leave("email", "phone");
    p.type("phone", "415-555-0134");
    p.pause();
    p.type("c_first", "Pat");
    p.type("c_last", "Lee");
    p.pause();
    p.submit();

    const bodies = p.contacts().map((c) => c.body);
    assert.equal(bodies.length, 3);
    for (const b of bodies) assert.equal((await d.post(b)).ok, true);

    assert.equal(d.rows.length, 1, "one slo.contact_started row for the day");
    const row = d.rows[0].payload;
    assert.equal(row.email, "pat@gmail.com");
    assert.equal(row.phone, "+14155550134");
    assert.equal(row.name, "Pat Lee");
    assert.equal(row.actor, "person");
    assert.equal(row.attribution.utm_content, "43-roadmap");
    assert.equal(row.cf_contact.ok, true);

    assert.equal(d.cfCalls.length, 3);
    assert.equal(d.cfContacts.size, 1, "one ClickFunnels contact");
    assert.deepEqual(d.cfContacts.get("pat@gmail.com"),
      { id: 1, firstName: "Pat", lastName: "Lee", phone: "+14155550134" });
  });
});

/* Meta Phase 4 (docs/tracking/meta-events.md, "fbclid / fbc / fbp"): fbclid
   kept first touch, fbc built from it when Meta's _fbc cookie is missing, fbp
   from the _fbp cookie; both ride the step-1 contact post and the checkout and
   soft-pull posts the page makes. InitiateCheckout moved to fh-events.js. */
describe("fbclid, fbc and fbp", () => {
  const FBCLID = "IwAR0x_9-AbC";
  const FBP = "fb.1.1700000000000.1234567890";
  const MS = 1_700_000_000_321;
  const CHECKOUT = "https://fundhub.ai/api/public/slo-checkout";
  const PULL = "https://fundhub.ai/api/public/slo-pull";

  test("fbclid is kept first touch and fbc is built as fb.1.<ms>.<fbclid>; neither is stamped on a form", () => {
    const p = runRoadmap({ search: `?utm_source=fb&fbclid=${FBCLID}`, now: MS });
    const saved = JSON.parse(p.store.fh_attribution);
    assert.equal(saved.fbclid, FBCLID);
    assert.equal(saved.fbc, `fb.1.${MS}.${FBCLID}`);
    assert.equal(p.asked.has("utm_source"), true, "the UTMs are stamped");
    assert.equal(p.asked.has("fbclid") || p.asked.has("fbc"), false, "the click id never becomes a form field");

    const later = runRoadmap({ search: "?fbclid=IwARsecondclick", storage: p.store, now: MS + 60_000 });
    assert.equal(JSON.parse(later.store.fh_attribution).fbc, `fb.1.${MS}.${FBCLID}`, "first touch wins");
  });

  test("a junk fbclid is not kept", () => {
    for (const bad of ["a%40b.co", "has%20space", "x".repeat(501)]) {
      const p = runRoadmap({ search: `?fbclid=${bad}` });
      assert.equal(JSON.parse(p.store.fh_attribution).fbclid, undefined, bad);
    }
  });

  test("the step-1 contact post carries fbclid, fbc and fbp", () => {
    const p = runRoadmap({ search: `?utm_source=fb&fbclid=${FBCLID}`, cookie: `x=1; _fbp=${FBP}`, now: MS });
    p.type("email", "pat@gmail.com");
    p.leave("email");
    const c = p.contacts()[0].body;
    assert.equal(c.fbclid, FBCLID);
    assert.equal(c.fbc, `fb.1.${MS}.${FBCLID}`);
    assert.equal(c.fbp, FBP);
  });

  test("Meta's own _fbc cookie wins over the built one; a junk cookie is ignored", () => {
    const cookieFbc = "fb.1.1700000000555.IwARfromcookie";
    const p = runRoadmap({ search: `?fbclid=${FBCLID}`, cookie: `_fbc=${cookieFbc}; _fbp=junk`, now: MS });
    p.type("email", "pat@gmail.com");
    p.leave("email");
    const c = p.contacts()[0].body;
    assert.equal(c.fbc, cookieFbc);
    assert.equal("fbp" in c, false);
  });

  test("the checkout post gets fbc, fbp and fbclid next to a1 / a2; nothing the page sent is changed", () => {
    const p = runRoadmap({ search: `?fbclid=${FBCLID}&a1=pl_7`, cookie: `_fbp=${FBP}`, now: MS });
    const sent = { email: "pat@gmail.com", first_name: "Pat", utm_source: "fb" };
    p.pageFetch(CHECKOUT, { method: "POST", headers: { accept: "application/json" }, body: JSON.stringify(sent) });
    const post = p.posts.find((x) => x.url === CHECKOUT);
    assert.deepEqual(post.body, { ...sent, webdriver: false, a1: "pl_7", fbclid: FBCLID, fbc: `fb.1.${MS}.${FBCLID}`, fbp: FBP });
    assert.equal(post.init.method, "POST");
  });

  test("the soft-pull post gets fbc and fbp only; its own fields go out exactly as the page sent them", () => {
    const p = runRoadmap({ search: `?fbclid=${FBCLID}&a1=pl_7`, cookie: `_fbp=${FBP}`, now: MS });
    const sent = { ref: "slo_abc", client_id: "c-1", consent: true, ssn: "555-00-4444", dob: "1980-01-02" };
    p.pageFetch(PULL, { method: "POST", body: JSON.stringify(sent) });
    const pulls = p.posts.filter((x) => x.url === PULL);
    assert.equal(pulls.length, 1);
    assert.deepEqual(pulls[0].body, { ...sent, fbc: `fb.1.${MS}.${FBCLID}`, fbp: FBP });
    assert.equal(p.posts.filter((x) => JSON.stringify(x.body).includes("4444")).length, 1, "the soft-pull body is never posted anywhere else");
    assert.equal(JSON.stringify(p.store).includes("4444"), false, "and never stored");
  });

  test("a page fetch with no ids to add, or with no body, goes out untouched", () => {
    const p = runRoadmap();
    const init = { method: "GET", headers: { accept: "application/json" } };
    p.pageFetch(`${CHECKOUT}?businesses=1`, init);
    assert.equal(p.posts.find((x) => x.url === `${CHECKOUT}?businesses=1`).init, init, "the GET is passed through as is");
    p.pageFetch(PULL, { method: "POST", body: JSON.stringify({ ref: "slo_abc" }) });
    assert.deepEqual(p.posts.find((x) => x.url === PULL).body, { ref: "slo_abc" });
  });

  test("no InitiateCheckout here any more: the tracker sends it when the card step shows", () => {
    assert.equal(/fbq\s*\(/.test(SRC), false, "fh-attribution.js never calls fbq");
    assert.equal(/fh_ic_sent/.test(SRC), false);
    const p = runRoadmap();
    assert.equal((p.doc.listeners.click || []).length, 0, "no Pay-press listener");
  });
});

describe("fh-attribution.js counts a direct affiliate link click (2026-10-06)", () => {
  const clicks = (p) => p.posts.filter((x) => x.url === "https://fundhub.ai/api/public/affiliate-click");

  test("roadmap?a1=…&ref=… counts one click for that code", () => {
    const p = runRoadmap({ search: "?a1=AFF-000121&ref=AFF-000121" });
    assert.deepEqual(clicks(p).map((c) => c.body), [{ code: "AFF-000121", source: "offer/roadmap" }]);
  });

  test("a reload in the same tab does not count it twice", () => {
    const first = runRoadmap({ search: "?a1=AFF-000121" });
    const again = runRoadmap({ search: "?a1=AFF-000121", storage: first.store });
    assert.equal(clicks(again).length, 0);
  });

  test("start.html already counted it (via=start): no second click", () => {
    const p = runRoadmap({ search: "?a1=AFF-000121&ref=AFF-000121&via=start" });
    assert.equal(clicks(p).length, 0);
  });

  test("the paid return's slo_ order ref is not a code", () => {
    const p = runRoadmap({ search: "?ref=slo_abc123def&client_id=00000000-0000-0000-0000-000000000000" });
    assert.equal(clicks(p).length, 0);
  });
});
