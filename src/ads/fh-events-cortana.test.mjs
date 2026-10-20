import { test } from "node:test";
import assert from "node:assert/strict";
import { makePage } from "./fh-events-harness.mjs";

const SID = "sess-abcdef12";

function page(opts = {}) {
  return makePage({ pathname: "/watch", cortana: true, ...opts,
    storage: { fh_sid: SID, ...(opts.storage || {}) } }).run();
}

function names(p) { return p.cortanaCalls.map(([name]) => name); }

test("free watch view reaches Cortana once with safe identity and attribution", () => {
  const p = page({
    cookie: "ak_tid=tid-12345678; _fbp=fb.1.1700000000000.1234567890",
    storage: { fh_attribution: JSON.stringify({ utm_source: "meta", utm_content: "ad-42", email: "hidden@example.com" }) }
  });
  assert.deepEqual(names(p), ["book_call_watch_view"]);
  const [name, data] = p.cortanaCalls[0];
  assert.equal(name, "book_call_watch_view");
  assert.equal(data.event_id, `dr.b.book_call_watch_view.${SID}`);
  assert.equal(data.schema_version, "fh-cortana-v1");
  assert.equal(data.funnel, "book_call");
  assert.equal(data.page_path, "/watch");
  assert.equal(data.ak_tid, "tid-12345678");
  assert.equal(data.utm_content, "ad-42");
  assert.equal(data.fbp, "fb.1.1700000000000.1234567890");
  assert.equal("email" in data, false);
  assert.equal("value" in data, false);
  assert.equal("currency" in data, false);
  assert.ok(data.occurred_at.endsWith("Z"));

  const reload = page({ storage: p.store });
  assert.deepEqual(names(reload), []);
});

test("application milestones, calendar and booking message are first-occurrence observations", () => {
  const p = page({ pathname: "/apply" });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 1, answer: "private" });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, last: true });
  p.win.fhTrack("survey_answer", { survey: "apply", step_num: 9, last: true });
  for (const event of ["calendar_view", "time_selected", "booking_confirmed", "booking_confirmed"]) {
    p.fireWin("message", { origin: "https://apply.fundhub.ai",
      data: { fh: "track", event, props: { calendar: "funding-book-call" } } });
  }
  assert.deepEqual(names(p), [
    "book_call_apply_view", "book_call_apply_started", "book_call_apply_final_answer",
    "book_call_calendar_view", "book_call_time_selected", "book_call_booking_observed"
  ]);
  assert.equal(p.events("booking_confirmed").length, 2, "Fundhub's source events are not suppressed");
  assert.ok(p.cortanaCalls.every(([, data]) => data.session_id === SID));
  assert.ok(p.cortanaCalls.every(([, data]) => !JSON.stringify(data).includes("private")));
  assert.ok(p.cortanaCalls.every(([, data]) => !("value" in data)));

  const reload = page({ pathname: "/apply", storage: p.store });
  reload.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
  assert.deepEqual(names(reload), []);
});

test("thank-you is not a purchase; paid funnel and rejected relay do not create free milestones", () => {
  const thanks = page({ pathname: "/thank-you" });
  assert.deepEqual(names(thanks), ["book_call_thank_you_view"]);
  thanks.win.fhTrack("survey_route", { offer: "call-booked" });
  assert.deepEqual(names(thanks), ["book_call_thank_you_view"]);

  const paid = page({ pathname: "/roadmap" });
  paid.win.fhTrack("survey_answer", { last: true });
  paid.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
  assert.deepEqual(names(paid), []);

  const rejected = page({ pathname: "/apply" });
  rejected.fireWin("message", { origin: "https://untrusted.example",
    data: { fh: "track", event: "booking_confirmed", props: {} } });
  assert.deepEqual(names(rejected), ["book_call_apply_view"]);
});

test("async Cortana hub receives queued first view; missing or throwing hub never blocks Fundhub", () => {
  const late = makePage({ pathname: "/watch", storage: { fh_sid: SID } }).run();
  assert.equal(late.events("page_view").length, 1);
  const calls = [];
  late.win.CortanaTracking = { trackEvent: (name, data) => calls.push([name, data]) };
  late.advance(250);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "book_call_watch_view");

  const broken = makePage({ pathname: "/watch", storage: { fh_sid: SID }, cortana: true });
  broken.win.akTracking = { trackEvent() { throw new Error("provider down"); } };
  broken.run();
  assert.equal(broken.events("page_view").length, 1);
  assert.equal(JSON.parse(broken.store.fh_dr_pending_v1).length, 1, "a thrown call stays queued");

  const bot = page({ webdriver: true });
  assert.deepEqual(names(bot), []);
  assert.equal(bot.events("page_view").length, 1);
});

test("a hub arriving after ten seconds receives the saved milestone once", () => {
  const p = makePage({ pathname: "/watch", storage: { fh_sid: SID } }).run();
  p.advance(11_000);
  assert.equal(JSON.parse(p.store.fh_dr_pending_v1).length, 1);
  const accepted = [];
  p.win.akTracking = { trackEvent: (name, data) => accepted.push([name, data]) };
  p.advance(5_000);
  assert.deepEqual(accepted.map(([name]) => name), ["book_call_watch_view"]);
  assert.equal(p.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(p.store.fh_dr_pending_v1), []);
  p.advance(10_000);
  assert.equal(accepted.length, 1);
});

test("rejected hub promise retries, and only acceptance clears the session record", async () => {
  const p = makePage({ pathname: "/watch", storage: { fh_sid: SID } });
  const calls = [];
  p.win.akTracking = { trackEvent: (name, data) => {
    calls.push([name, data]);
    if (calls.length === 1) return Promise.reject(new Error("hub unavailable"));
    if (calls.length === 2) return Promise.resolve({ ok: false });
    return Promise.resolve();
  } };
  p.run();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(p.store.fh_dr_book_call_watch_view, undefined);
  assert.equal(JSON.parse(p.store.fh_dr_pending_v1).length, 1);
  p.advance(250);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(p.store.fh_dr_book_call_watch_view, undefined);
  p.advance(250);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 3);
  assert.equal(calls[0][1].event_id, calls[1][1].event_id);
  assert.equal(p.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(p.store.fh_dr_pending_v1), []);
});

test("reload recovers a rejected milestone without a duplicate after acceptance", () => {
  const first = makePage({ pathname: "/watch", storage: { fh_sid: SID } });
  first.win.akTracking = { trackEvent() { throw new Error("hub unavailable"); } };
  first.run();
  first.advance(10_500);
  assert.equal(JSON.parse(first.store.fh_dr_pending_v1).length, 1);
  assert.equal(first.store.fh_dr_book_call_watch_view, undefined);

  const recovered = page({ storage: first.store });
  assert.deepEqual(names(recovered), ["book_call_watch_view"]);
  assert.equal(recovered.cortanaCalls[0][1].event_id, `dr.b.book_call_watch_view.${SID}`);
  assert.equal(recovered.store.fh_dr_book_call_watch_view, "1");
  assert.deepEqual(JSON.parse(recovered.store.fh_dr_pending_v1), []);
  const again = page({ storage: recovered.store });
  assert.deepEqual(names(again), []);
});

test("restored queue drops unsafe data and keeps Cortana fields non-revenue", () => {
  const p = page({
    storage: {
      fh_attribution: JSON.stringify({ utm_source: "meta", utm_campaign: "buyer@example.com", utm_content: "ad-42" }),
      fh_dr_pending_v1: JSON.stringify([
        { name: "book_call_watch_view", page: "/watch", sid: SID, at: 1_000_000, email: "buyer@example.com" },
        { name: "purchase", page: "/order", sid: SID, at: 1_000_000 }
      ])
    }
  });
  assert.deepEqual(names(p), ["book_call_watch_view"]);
  const data = p.cortanaCalls[0][1];
  assert.equal(data.utm_source, "meta");
  assert.equal(data.utm_content, "ad-42");
  assert.equal("utm_campaign" in data, false);
  assert.equal("email" in data, false);
  assert.equal("value" in data, false);
  assert.equal("currency" in data, false);
});

test("a stored free-call milestone does not replay from a paid page or an automated browser", () => {
  const pending = JSON.stringify([{ name: "book_call_watch_view", page: "/watch", sid: SID, at: 1_000_000 }]);
  const storage = { fh_sid: SID, fh_dr_pending_v1: pending };
  const paid = page({ pathname: "/roadmap", storage });
  assert.deepEqual(names(paid), []);
  assert.equal(paid.store.fh_dr_pending_v1, pending);
  const bot = page({ webdriver: true, storage });
  assert.deepEqual(names(bot), []);
  assert.equal(bot.store.fh_dr_pending_v1, pending);
});

test("application step loads the Fundhub hub only when its page lacks the pixel", () => {
  const hub = "https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w";
  const missing = makePage({ pathname: "/apply", storage: { fh_sid: SID } }).run();
  const added = missing.document.querySelectorAll("script");
  assert.equal(added.length, 1);
  assert.equal(added[0].getAttribute("src"), hub);
  const received = [];
  missing.win.akTracking = { trackEvent: (name) => received.push(name) };
  missing.advance(250);
  assert.deepEqual(received, ["book_call_apply_view"]);

  const present = makePage({ pathname: "/apply", storage: { fh_sid: SID } });
  present.html.append(present.node("script", { attrs: { src: hub } }));
  present.run();
  assert.equal(present.document.querySelectorAll("script").length, 1);

  const paid = makePage({ pathname: "/roadmap", storage: { fh_sid: SID } }).run();
  assert.equal(paid.document.querySelectorAll("script").length, 0);
});
