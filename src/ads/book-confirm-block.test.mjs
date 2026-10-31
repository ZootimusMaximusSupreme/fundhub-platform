// /funding-book-call booking-accepted block (04e-book-confirm.html), pushed into the
// native page's footer_code with the apply-book row. It stamps fh_booking_v1.submittedAt
// and sends booking_confirmed only when ClickFunnels has accepted the booking
// ("cf:form_submitted:ok" from its own lander code), never on the Book press alone.
//
// The block runs here against a fake page together with the fh_booking_v1 writer that
// is live in the page body today, and the /roadmap-book listener that waits for the
// stamp. npm test's glob is src/** only, so this sits here and reads the fragments.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  PUSH_MANIFEST,
  nextFooterCode,
  footerScriptTag,
  hasScriptSrc,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  CLARITY_SRC,
} from "../../marketing/landing-pages/tracking-manifest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const CONFIRM = "marketing/landing-pages/04e-book-confirm.html";
const CLOSE_TODAY = "marketing/landing-pages/04g-book-close-today.html";
const BOOKING = "marketing/landing-pages/slo/slo-02-booking.html";
const KEY = "fh_booking_v1";
const PARENT = "https://apply.fundhub.ai";
const SCHED = '[data-page-element="AppointmentScheduler/V1"]';

const scriptsOf = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const BLOCK = read(CONFIRM);
const CLOSE_TODAY_BLOCK = read(CLOSE_TODAY);
const BLOCK_JS = scriptsOf(BLOCK)[0];

// The fh_booking_v1 writer live in the /funding-book-call body (a Custom HTML element
// the API cannot replace), read from https://apply.fundhub.ai/funding-book-call on
// 2026-10-02. It writes on every field change and on the Book press, and never
// writes submittedAt.
const LIVE_WRITER = `(function(){
  var KEY='fh_booking_v1';
  var ROOT='[data-page-element="AppointmentScheduler/V1"]';
  function readBooking(){
    var root=document.querySelector(ROOT);
    if(!root) return null;
    var start=(root.querySelector('#appointment_schedule_request_start_on')||{}).value||'';
    var end=(root.querySelector('#appointment_schedule_request_end_on')||{}).value||'';
    var tz=(root.querySelector('#appointment_schedule_request_tzid')||{}).value||'';
    if(!start||!end) return null;
    var name=(root.querySelector('input[name="name"]')||{}).value||'';
    var email=(root.querySelector('input[name="email"]')||{}).value||'';
    var phone=(root.querySelector('input[name="phone_number"]')||{}).value||'';
    var timeString=(root.querySelector('#timeString')||{}).textContent||'';
    return {
      start:start, end:end, tz:tz,
      name:name, email:email, phone:phone,
      timeString:timeString,
      title:'Funding Strategy Meeting — Fundhub',
      capturedAt:Date.now()
    };
  }
  function persist(data){
    if(!data) return;
    try{ localStorage.setItem(KEY, JSON.stringify(data)); }catch(e){}
    try{ sessionStorage.setItem(KEY, JSON.stringify(data)); }catch(e){}
  }
  function bindBook(){
    var root=document.querySelector(ROOT);
    if(!root) return;
    var book=root.querySelector('a.elButton');
    if(book && !book.getAttribute('data-fh-cal-bound')){
      book.setAttribute('data-fh-cal-bound','1');
      book.addEventListener('click', function(){ persist(readBooking()); }, true);
    }
    var confirm=root.querySelector('button.cf2__confirm-button, button.DTP__confirm-button');
    if(confirm && !confirm.getAttribute('data-fh-cal-bound')){
      confirm.setAttribute('data-fh-cal-bound','1');
      confirm.addEventListener('click', function(){
        setTimeout(function(){ persist(readBooking()); }, 50);
      }, true);
    }
  }
  var last='';
  setInterval(function(){
    bindBook();
    var d=readBooking();
    if(!d) return;
    var sig=d.start+'|'+d.end+'|'+d.tz+'|'+d.name+'|'+d.email;
    if(sig!==last){ last=sig; persist(d); }
  }, 400);
})();`;

/* ── fakes ─────────────────────────────────────────────────────────────── */

function makeClock(start = 1_790_000_000_000) {
  const timers = [];
  let id = 0;
  const clock = {
    now: start,
    setInterval(fn, ms) {
      const every = Math.max(1, Number(ms) || 1);
      timers.push({ id: ++id, fn, every, next: clock.now + every, repeat: true });
      return id;
    },
    setTimeout(fn, ms) {
      timers.push({ id: ++id, fn, every: 0, next: clock.now + Math.max(0, Number(ms) || 0), repeat: false });
      return id;
    },
    clear(tid) {
      const i = timers.findIndex((t) => t.id === tid);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        let due = null;
        for (const t of timers) if (t.next <= end && (!due || t.next < due.next)) due = t;
        if (!due) break;
        clock.now = due.next;
        if (due.repeat) due.next += due.every;
        else clock.clear(due.id);
        due.fn();
      }
      clock.now = end;
    },
  };
  return clock;
}

/** Storage that tells other same-origin pages (storage event) when a value changes. */
function makeStorage(others = []) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const oldValue = m.has(k) ? m.get(k) : null;
      const newValue = String(v);
      m.set(k, newValue);
      if (oldValue !== newValue) for (const page of others) page.storageEvent({ key: k, oldValue, newValue });
    },
    removeItem: (k) => m.delete(k),
  };
}

function el(extra = {}) {
  const e = {
    value: "",
    className: "",
    textContent: "",
    firstElementChild: null,
    attrs: {},
    listeners: {},
    addEventListener(type, fn) {
      (e.listeners[type] ||= []).push(fn);
    },
    getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null),
    setAttribute(k, v) {
      e.attrs[k] = String(v);
    },
    click() {
      for (const fn of e.listeners.click || []) fn({ type: "click", target: e });
    },
    ...extra,
  };
  return e;
}

/** A parent window the frame can talk to. `origin: null` = a cross-origin parent. */
function makeParent(origin = PARENT) {
  const parent = {
    posted: [],
    postMessage(msg, target) {
      parent.posted.push([JSON.parse(JSON.stringify(msg)), target]);
    },
  };
  Object.defineProperty(parent, "location", {
    get() {
      if (origin === PARENT) return { origin };
      throw new Error("SecurityError: cross-origin");
    },
  });
  return parent;
}

/**
 * /funding-book-call with its native scheduler, the live body writer and the block.
 * framed: a parent window (makeParent) or null for a direct visit.
 */
function calendarPage({ clock, local, session, parent = null, ancestor = PARENT, fhTrack, writer = true }) {
  const f = {
    start: el(),
    end: el(),
    tz: el(),
    name: el(),
    email: el(),
    phone: el(),
    timeString: el(),
    form: el({ className: "flex hidden" }),
    picker: el(),
    book: el(),
  };
  const bySel = {
    "#appointment_schedule_request_start_on": f.start,
    "#appointment_schedule_request_end_on": f.end,
    "#appointment_schedule_request_tzid": f.tz,
    'input[name="name"]': f.name,
    'input[name="email"]': f.email,
    'input[name="phone_number"]': f.phone,
    "#timeString": f.timeString,
    "#formContainer": f.form,
    "a.elButton": f.book,
  };
  const root = el({ querySelector: (s) => bySel[s] || null });
  const docListeners = {};
  const document = {
    referrer: "",
    querySelector: (s) => (s === SCHED ? root : null),
    getElementById: (id) => ({ "cronofy-date-time-picker": f.picker, formContainer: f.form })[id] || null,
    addEventListener: (t, fn) => (docListeners[t] ||= []).push(fn),
  };
  const winListeners = {};
  const win = {
    location: { ancestorOrigins: parent ? [ancestor] : [] },
    addEventListener: (t, fn) => (winListeners[t] ||= []).push(fn),
  };
  win.self = win;
  win.top = parent ? {} : win;
  win.parent = parent || win;
  if (fhTrack) win.fhTrack = fhTrack;
  const ctx = vm.createContext({
    window: win,
    document,
    localStorage: local,
    sessionStorage: session,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    Date: { now: () => clock.now },
    JSON,
    URL,
  });
  if (writer) vm.runInContext(LIVE_WRITER, ctx);
  vm.runInContext(BLOCK_JS, ctx);
  return {
    f,
    win,
    /** CF's own lander dispatches these on document (runtime_events.ts). */
    fire(type, detail) {
      for (const fn of docListeners[type] || []) fn({ type, detail });
    },
    fireWin(type) {
      for (const fn of winListeners[type] || []) fn({ type });
    },
    /** Cronofy has drawn the month grid. */
    renderCalendar() {
      f.picker.firstElementChild = el();
    },
    /** Cronofy "slot_selected": CF fills its form and opens the contact form. */
    pickTime(start, end) {
      f.start.value = start;
      f.end.value = end;
      f.tz.value = "America/New_York";
      f.timeString.textContent = "10:00, 6 October 2026";
      f.picker.className = "hidden";
      f.form.className = "flex";
    },
    type({ name, email, phone }) {
      if (name != null) f.name.value = name;
      if (email != null) f.email.value = email;
      if (phone != null) f.phone.value = phone;
    },
    /** What processForm() hands to cf:form_submitted* (submit.ts). */
    detail() {
      return { appointments_schedule_request: { start_on: f.start.value, end_on: f.end.value, tzid: f.tz.value } };
    },
  };
}

/** /roadmap-book (slo-02-booking.html): its real "booked -> /roadmap-thank-you" script. */
function bookingParent({ clock, search }) {
  const script = scriptsOf(read(BOOKING)).find((s) => s.includes("TY='/roadmap-thank-you'"));
  assert.ok(script, "booking page listener found");
  const storageFns = [];
  const location = { search, href: "https://apply.fundhub.ai/roadmap-book" + search };
  const page = {
    location,
    storageEvent(e) {
      for (const fn of storageFns) fn(e);
    },
    local: null,
  };
  page.start = (local) => {
    page.local = local;
    vm.runInNewContext(script, {
      window: { addEventListener: (t, fn) => t === "storage" && storageFns.push(fn) },
      location,
      localStorage: local,
      URLSearchParams,
      JSON,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      Date: { now: () => clock.now },
    });
  };
  return page;
}

const START = "2026-10-06T14:00:00Z";
const END = "2026-10-06T14:30:00Z";
const BUYER = { name: "Pat Buyer", email: "pat@example.com", phone: "2015550123" };
const stored = (s) => JSON.parse(s.getItem(KEY) || "null");
const events = (parent) => parent.posted.map(([m]) => m.event);

/* ── the block itself ──────────────────────────────────────────────────── */

describe("04e-book-confirm.html is one marked footer block that cannot change the page", () => {
  test("marked block, one inline script, no script tags the footer push manages", () => {
    const html = BLOCK.trim();
    assert.ok(html.startsWith("<!-- fh-book-confirm:start"), "starts with the start marker");
    assert.ok(html.endsWith("<!-- fh-book-confirm:end -->"), "ends with the end marker");
    assert.equal(scriptsOf(html).length, 1);
    assert.doesNotMatch(html, /<script[^>]*\ssrc=/, "no script tag with a src");
    for (const src of [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, CLARITY_SRC]) {
      assert.equal(html.includes(src), false, `never names ${src} (nextFooterCode would count it as loaded)`);
    }
    assert.doesNotMatch(html, /fh-framed:|fh-book-fit:/, "never carries another block's markers");
  });

  test("reads the page, never writes to it, and never blocks ClickFunnels", () => {
    assert.doesNotMatch(
      BLOCK_JS,
      /innerHTML|outerHTML|appendChild|insertBefore|removeChild|\.style\b|classList\.(add|remove|toggle)|textContent\s*=[^=]|\.value\s*=[^=]|preventDefault|stopPropagation|stopImmediatePropagation/,
    );
    assert.doesNotMatch(BLOCK_JS, /window\.fetch\s*=|XMLHttpRequest/, "does not wrap the booking request");
    assert.match(BLOCK_JS, /document\.addEventListener\('cf:form_submitted:ok',onAccepted\)/);
    assert.doesNotMatch(BLOCK_JS, /addEventListener\('cf:form_submitted',/, "the Book press alone is never a booking");
  });

  test("sends only the three relayed events, with only the calendar prop, to apply.fundhub.ai only", () => {
    const sent = [...BLOCK_JS.matchAll(/send\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(sent, ["booking_confirmed", "calendar_view", "time_selected"]);
    assert.match(BLOCK_JS, /var msg=\{fh:'track',event:event,props:\{calendar:CAL\}\};/);
    assert.match(BLOCK_JS, /CAL='funding-book-call',PARENT='https:\/\/apply\.fundhub\.ai'/);
    assert.match(BLOCK_JS, /window\.parent\.postMessage\(msg,PARENT\)/);
    assert.doesNotMatch(BLOCK_JS, /postMessage\([^)]*'\*'\)/, "never posts to any origin");
    assert.match(BLOCK_JS, /\(window\.fhTrack\|\|function\(e,p\)\{\(window\.fhq=window\.fhq\|\|\[\]\)\.push\(\[e,p\]\);\}\)\(msg\.event,msg\.props\)/);
  });
});

describe("calendar_view and time_selected", () => {
  test("calendar_view once Cronofy has drawn the calendar, once per load", () => {
    const clock = makeClock();
    const parent = makeParent();
    const p = calendarPage({ clock, local: makeStorage(), session: makeStorage(), parent });
    clock.advance(2000);
    assert.deepEqual(events(parent), [], "nothing before the calendar is drawn");
    p.renderCalendar();
    clock.advance(600);
    clock.advance(3000);
    assert.deepEqual(events(parent), ["calendar_view"]);
    assert.deepEqual(parent.posted[0], [{ fh: "track", event: "calendar_view", props: { calendar: "funding-book-call" } }, PARENT]);
  });

  test("time_selected when ClickFunnels takes a time into its form, once per time", () => {
    const clock = makeClock();
    const parent = makeParent();
    const p = calendarPage({ clock, local: makeStorage(), session: makeStorage(), parent });
    p.renderCalendar();
    clock.advance(600);
    // a value restored into the hidden field with the contact form still shut is not a pick
    p.f.start.value = START;
    clock.advance(1500);
    assert.deepEqual(events(parent), ["calendar_view"]);
    p.pickTime(START, END);
    clock.advance(600);
    clock.advance(2000);
    assert.deepEqual(events(parent), ["calendar_view", "time_selected"]);
    p.pickTime("2026-10-07T15:00:00Z", "2026-10-07T15:30:00Z");
    clock.advance(600);
    assert.deepEqual(events(parent), ["calendar_view", "time_selected", "time_selected"]);
  });
});

describe("booking_confirmed and submittedAt only when ClickFunnels accepted the booking", () => {
  function upToBook(opts = {}) {
    const clock = makeClock();
    const parent = opts.direct ? null : makeParent(opts.parentOrigin);
    const local = makeStorage();
    const session = makeStorage();
    const p = calendarPage({ clock, local, session, parent, ancestor: opts.ancestor, fhTrack: opts.fhTrack });
    p.renderCalendar();
    p.pickTime(START, END);
    clock.advance(500);
    p.type(BUYER);
    clock.advance(1000);
    return { clock, parent, local, session, p };
  }

  test("refused Book press (bad phone: no POST; or ClickFunnels says 422): no submittedAt, no booking_confirmed", () => {
    const { clock, parent, local, session, p } = upToBook();
    p.type({ phone: "123" });
    p.f.book.click(); // the old writer saves on the press (capture phase)
    clock.advance(3000); // checkValidInputs failed: ClickFunnels sends nothing, fires nothing
    p.f.book.click();
    p.fire("cf:form_submitted", p.detail()); // the press that did POST
    p.fireWin("checkout:order-submit-errors"); // ClickFunnels refused it
    clock.advance(10000);
    const rec = stored(local);
    assert.equal(rec.email, BUYER.email, "the old writer's record is there");
    assert.equal("submittedAt" in rec, false, "never stamped");
    assert.equal("submittedAt" in stored(session), false);
    assert.equal(events(parent).includes("booking_confirmed"), false);
  });

  test("accepted, framed: stamped after the old writer's own write, booking_confirmed posted to the parent", () => {
    const { clock, parent, local, session, p } = upToBook();
    clock.advance(400);
    p.f.book.click();
    const written = stored(local); // the old writer, on the press
    assert.equal("submittedAt" in written, false);
    p.fire("cf:form_submitted", p.detail());
    assert.equal("submittedAt" in stored(local), false, "the press alone stamps nothing");
    clock.advance(700); // the POST is out
    p.fire("cf:form_submitted:ok", p.detail());
    p.fire("cf:form_submitted:finalized", p.detail());
    const rec = stored(local);
    assert.deepEqual({ ...rec, submittedAt: undefined }, { ...written, submittedAt: undefined }, "the writer's record, kept");
    assert.ok(rec.submittedAt >= written.capturedAt + 700, "stamped at acceptance, after the writer's write");
    assert.deepEqual(stored(session), rec, "sessionStorage too");
    assert.deepEqual(events(parent), ["calendar_view", "time_selected", "booking_confirmed"], "booking_confirmed once");
    assert.deepEqual(parent.posted.at(-1), [{ fh: "track", event: "booking_confirmed", props: { calendar: "funding-book-call" } }, PARENT]);
    clock.advance(10000);
    assert.equal(stored(local).submittedAt, rec.submittedAt, "the old writer's loop does not wipe it");
  });

  test("the old writer's loop rewriting the same booking puts no hole in the stamp", () => {
    const { clock, local, p } = upToBook();
    p.type({ name: "Pat Q Buyer" }); // typed, then Book within the writer's 400ms tick
    p.f.book.click();
    p.fire("cf:form_submitted:ok", p.detail());
    const stamp = stored(local).submittedAt;
    assert.ok(stamp);
    clock.advance(400); // writer: fields changed since its last tick -> rewrites without submittedAt
    clock.advance(1000);
    const rec = stored(local);
    assert.equal(rec.submittedAt, stamp, "stamp put back, same time");
    assert.equal(rec.name, "Pat Q Buyer");
  });

  test("accepted, direct visit: fhTrack, or the fhq queue before the tracker loads; nothing posted", () => {
    const calls = [];
    const a = upToBook({ direct: true, fhTrack: (e, props) => calls.push([e, props]) });
    a.p.f.book.click();
    a.p.fire("cf:form_submitted:ok", a.p.detail());
    assert.deepEqual(calls.map((c) => c[0]), ["calendar_view", "time_selected", "booking_confirmed"]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["booking_confirmed", { calendar: "funding-book-call" }]);
    assert.ok(stored(a.local).submittedAt);

    const b = upToBook({ direct: true });
    b.p.f.book.click();
    b.p.fire("cf:form_submitted:ok", b.p.detail());
    assert.deepEqual(JSON.parse(JSON.stringify(b.p.win.fhq)).map((q) => q[0]), ["calendar_view", "time_selected", "booking_confirmed"]);
    assert.ok(stored(b.local).submittedAt);
  });

  test("framed by anyone but apply.fundhub.ai: posts nothing, still stamps", () => {
    const { local, parent, p } = upToBook({ parentOrigin: null, ancestor: "https://builder.myclickfunnels.com" });
    p.f.book.click();
    p.fire("cf:form_submitted:ok", p.detail());
    assert.deepEqual(parent.posted, []);
    assert.ok(stored(local).submittedAt);
  });

  test("no record from the writer, or an older visit's record: rebuilt from what ClickFunnels accepted", () => {
    const clock = makeClock();
    const local = makeStorage();
    local.setItem(KEY, JSON.stringify({ start: "2026-09-01T14:00:00Z", end: "2026-09-01T14:30:00Z", name: "Old", email: "old@example.com", capturedAt: 1 }));
    const p = calendarPage({ clock, local, session: makeStorage(), parent: makeParent(), writer: false });
    p.renderCalendar();
    p.pickTime(START, END);
    p.type(BUYER);
    p.fire("cf:form_submitted:ok", p.detail());
    const rec = stored(local);
    assert.equal(rec.start, START);
    assert.equal(rec.email, BUYER.email);
    assert.equal(rec.name, BUYER.name);
    assert.equal(rec.title, "Funding Strategy Meeting — Fundhub");
    assert.ok(rec.submittedAt);
  });

  test("an ok with no picked time is not a booking", () => {
    const clock = makeClock();
    const parent = makeParent();
    const local = makeStorage();
    const p = calendarPage({ clock, local, session: makeStorage(), parent });
    p.fire("cf:form_submitted:ok", { appointments_schedule_request: { start_on: "" } });
    p.fire("cf:form_submitted:ok", undefined);
    assert.deepEqual(parent.posted, []);
    assert.equal(local.getItem(KEY), null);
  });

  test("never throws: storage blocked, scheduler missing", () => {
    const clock = makeClock();
    const boom = () => {
      throw new Error("blocked");
    };
    const dead = { getItem: boom, setItem: boom, removeItem: boom };
    const parent = makeParent();
    const p = calendarPage({ clock, local: dead, session: dead, parent, writer: false });
    p.renderCalendar();
    p.pickTime(START, END);
    p.type(BUYER);
    assert.doesNotThrow(() => clock.advance(2000));
    assert.doesNotThrow(() => p.fire("cf:form_submitted:ok", p.detail()));
    assert.doesNotThrow(() => clock.advance(8000));
    assert.doesNotThrow(() => p.fireWin("pagehide"));
    assert.equal(events(parent).at(-1), "booking_confirmed");
  });
});

/* ── /roadmap-book: the listener that sends a booked buyer on ──────────── */

describe("/roadmap-book frames the calendar and moves on only after an accepted booking", () => {
  function roadmapBook() {
    const clock = makeClock();
    const parent = bookingParent({ clock, search: "?pa=84500&ref=abc&client_id=c1&utm_source=fb&fbclid=x1" });
    const local = makeStorage([parent]);
    parent.start(local);
    clock.advance(1000);
    const frameWin = makeParent();
    const p = calendarPage({ clock, local, session: makeStorage(), parent: frameWin });
    p.renderCalendar();
    p.pickTime(START, END);
    clock.advance(500);
    p.type(BUYER);
    clock.advance(1000);
    return { clock, parent, frameWin, p };
  }

  test("picking and typing (old writer saves, no submittedAt) does not move the buyer", () => {
    const { clock, parent, p } = roadmapBook();
    p.f.book.click();
    clock.advance(5000);
    assert.equal(parent.location.href, "https://apply.fundhub.ai/roadmap-book?pa=84500&ref=abc&client_id=c1&utm_source=fb&fbclid=x1");
  });

  test("a refused Book press does not move the buyer", () => {
    const { clock, parent, p } = roadmapBook();
    p.type({ phone: "1" });
    p.f.book.click();
    p.fire("cf:form_submitted", p.detail());
    p.fireWin("checkout:order-submit-errors");
    clock.advance(6000);
    assert.match(parent.location.href, /\/roadmap-book\?/);
  });

  test("an accepted booking sends the buyer to /roadmap-thank-you with the money and ad tags", () => {
    const { clock, parent, frameWin, p } = roadmapBook();
    p.f.book.click();
    p.fire("cf:form_submitted", p.detail());
    clock.advance(800);
    p.fire("cf:form_submitted:ok", p.detail());
    assert.equal(parent.location.href, "/roadmap-thank-you?pa=84500&ref=abc&client_id=c1&utm_source=fb", "storage event, at once");
    assert.equal(events(frameWin).at(-1), "booking_confirmed", "and the frame told the parent's tracker");
  });
});

/* ── manifest + push ───────────────────────────────────────────────────── */

describe("the apply-book push carries the block in the same whole-footer write", () => {
  const ROW = Object.fromEntries(PUSH_MANIFEST.map((r) => [r.key, r]));
  const tag = (src) => footerScriptTag(src, { defer: src === CLARITY_SRC });
  // live footer_code of page 25062844, read by API 2026-10-02
  const LIVE_FOOT = [tag(FH_ATTRIBUTION_SRC), tag(FH_EVENTS_SRC), tag(CLARITY_SRC)].join("\n");

  test("apply-book carries both acceptance and same-day booking protection", () => {
    const row = ROW["apply-book"];
    assert.deepEqual(row.footerBlocks, [
      { fragment: CONFIRM, marker: "fh-book-confirm" },
      { fragment: CLOSE_TODAY, marker: "fh-book-close-today" },
    ]);
    assert.equal(row.strategy, "head_footer_append_only", "never a full replace");
    assert.deepEqual(row.extraFooterScripts, [FH_EVENTS_SRC, CLARITY_SRC]);
    for (const k of ["apply-book-framed", "apply-book-fit"]) {
      assert.equal(ROW[k].pageId, row.pageId);
      assert.notEqual(ROW[k].marker, "fh-book-confirm");
      assert.notEqual(ROW[k].marker, "fh-book-close-today");
    }
    assert.equal(PUSH_MANIFEST.filter((r) => r.footerBlocks).length, 1, "only the calendar page carries a footer block");
  });

  test("first push appends the block once after the scripts; the next push sends nothing", () => {
    // Use the exact manifest inventory; neither block may silently disappear.
    const blocks = ROW["apply-book"].footerBlocks.map(({ fragment, marker }) => ({
      block: read(fragment), marker,
    }));
    const opts = { extraSrcs: [FH_EVENTS_SRC, CLARITY_SRC], blocks };
    const first = nextFooterCode(LIVE_FOOT, opts);
    assert.equal(first.changed, true);
    assert.deepEqual(first.added, []);
    assert.deepEqual(first.blocks, [
      { marker: "fh-book-confirm", action: "append" },
      { marker: "fh-book-close-today", action: "append" },
    ]);
    assert.equal(first.next, `${LIVE_FOOT}\n${BLOCK.trim()}\n${CLOSE_TODAY_BLOCK.trim()}`,
      "scripts byte for byte; both safety blocks appended in manifest order");
    const again = nextFooterCode(first.next, { ...opts, existing: first.next });
    assert.equal(again.changed, false);
    assert.deepEqual(again.blocks, [
      { marker: "fh-book-confirm", action: "none" },
      { marker: "fh-book-close-today", action: "none" },
    ]);
    const v2 = BLOCK.replace("fh-book-confirm:start v1", "fh-book-confirm:start v2");
    const swap = nextFooterCode(first.next, { ...opts, blocks: [
      { block: v2, marker: "fh-book-confirm" },
      { block: CLOSE_TODAY_BLOCK, marker: "fh-book-close-today" },
    ] });
    assert.equal(swap.next, `${LIVE_FOOT}\n${v2.trim()}\n${CLOSE_TODAY_BLOCK.trim()}`,
      "confirmation updated in place without deleting the same-day booking guard");
    assert.deepEqual(swap.blocks, [
      { marker: "fh-book-confirm", action: "replace" },
      { marker: "fh-book-close-today", action: "none" },
    ]);
  });

  test("an empty footer still gets every script and both safety blocks", () => {
    const blocks = ROW["apply-book"].footerBlocks.map(({ fragment, marker }) => ({ block: read(fragment), marker }));
    const r = nextFooterCode("", { extraSrcs: [FH_EVENTS_SRC, CLARITY_SRC], blocks });
    for (const src of [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, CLARITY_SRC]) assert.ok(hasScriptSrc(r.next, src), src);
    assert.equal(r.next.split("<!-- fh-book-confirm:start").length - 1, 1);
    assert.equal(r.next.split("<!-- fh-book-close-today:start").length - 1, 1);
  });

  test("the push script reads footerBlocks into the builder-page footer plan", () => {
    const push = read("scripts/cf-push-custom-html.mjs");
    const fn = push.slice(push.indexOf("async function pushBuilderFooter("), push.indexOf("async function putCustomHtml("));
    assert.match(fn, /blocks: \(row\.footerBlocks \?\? \[\]\)\.map\(\(b\) => \(\{ block: readFragment\(b\.fragment\), marker: b\.marker \}\)\)/);
    assert.ok(fn.indexOf("row.footerBlocks") < fn.indexOf('method: "PUT"'), "planned before the write");
    assert.match(fn, /page\.footer_code = plan\.next/, "the block goes out in the same replace write");
  });
});

describe("/order (inventory row 9) gets the events script and Clarity through the manifest", () => {
  test("row exactly as docs/tracking/page-inventory.md section 4", () => {
    const row = PUSH_MANIFEST.find((r) => r.key === "apply-order");
    assert.deepEqual(row, {
      key: "apply-order",
      funnelId: "968281",
      liveUrl: "https://apply.fundhub.ai/order",
      path: "/order--53172",
      pageId: "25426768",
      vslBeacon: false,
      extraFooterScripts: [FH_EVENTS_SRC, CLARITY_SRC],
      strategy: "head_footer_append_only",
      note: "Native ClickFunnels $297 checkout (Complete Funding Diagnostic) — footer scripts only, never full replace",
    });
  });

  test("its empty footer gets events + Clarity; attribution already loads from its head", () => {
    const head = `<script src="${FH_ATTRIBUTION_SRC}"></script>`; // live head_code, 2026-10-02
    const r = nextFooterCode("", { extraSrcs: [FH_EVENTS_SRC, CLARITY_SRC], existing: `<head>${head}</head><div data-page-element="ContentNode"></div>` });
    assert.equal(r.next, `<script src="${FH_EVENTS_SRC}"></script>\n<script src="${CLARITY_SRC}" defer></script>`);
  });
});
