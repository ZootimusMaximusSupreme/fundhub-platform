// Run the actual tracker against a fake browser. Network receipt is verified separately.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePage } from "./fh-events-harness.mjs";
import { metaEventsFor } from "../meta/map.mjs";

const SID = "sess-abcdef12";
const PV = "c01345a7-3526-4b84-bc13-d97a7a3e88b2";
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-)4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const SOURCE = "https://apply.fundhub.ai/apply";
const FBCLID = "IwAR0x_9-AbC";
const FBP = "fb.1.1700000000000.1234567890";

function page({ permitted = false, ...opts } = {}) {
  const p = makePage({ fbq: true, fhPv: PV, ...opts, storage: { fh_sid: SID, ...opts.storage } });
  if (permitted) p.win.__fhMetaPixelAllowed = true;
  if (opts.pathname && opts.pathname.startsWith("/blueprint")) {
    p.win.FH_FUNNEL = { tag: "fnl-blueprint", page: { path: opts.pathname } };
  }
  return p;
}

describe("public landing pages", () => {
  for (const path of ["/watch", "/blueprint"]) {
    test(path + " uses the guarded head's opaque PageView ID for ViewContent", () => {
      const p = page({ pathname: path }).run();
      assert.equal(p.events("page_view")[0].meta_event_id, PV);
      assert.deepEqual(p.fbqCalls, [], "the page head owns both browser copies");
      const reload = page({ pathname: path, storage: p.store, permitted: true }).run();
      assert.deepEqual(reload.sent, []);
      assert.deepEqual(reload.fbqCalls, []);
    });
  }

  test("an existing fbq without the approved head cannot send events", () => {
    const p = page({ pathname: "/watch", search: "?fh_tier=q", fhPv: undefined }).run();
    p.win.fhTrack("video", { action: "progress", pct: 50, video: "qualified-800" });
    assert.ok(p.sent.length);
    assert.ok(p.bodies().every(row => !row.meta_event_id));
    assert.deepEqual(p.fbqCalls, []);
  });

  test("only predeclared nonfinancial pages can use even an installed pixel", () => {
    for (const pathname of ["/apply", "/funding-book-call", "/funding-book-call--02424", "/order",
      "/roadmap", "/roadmap-book", "/roadmap-thank-you", "/thank-you", "/thank-you--80c5a", "/blueprint-book", "/portal-login.html"]) {
      const p = page({ pathname, permitted: true }).run();
      p.win.fhTrack("video", { action: "progress", pct: 25, video: "pending" });
      assert.ok(p.sent.length, pathname);
      assert.ok(p.bodies().every(row => !row.meta_event_id), pathname);
      assert.deepEqual(p.fbqCalls, [], pathname);
    }
  });

  test("missing or legacy PageView IDs do not create an unmatched second PageView", () => {
    for (const fhPv of [undefined, "", "pv.qualified.800", "012345678900", { id: PV }]) {
      const p = page({ pathname: "/watch", permitted: true, fhPv }).run();
      assert.equal(p.events("page_view")[0].meta_event_id, undefined);
      assert.deepEqual(p.fbqCalls, []);
    }
  });

  test("public video milestones and their labels stay in Fundhub", () => {
    const p = page({ pathname: "/watch", permitted: true }).run();
    p.fbqCalls.length = 0;
    for (const pct of [10, 25, 50, 75, 100]) p.win.fhTrack("video", { action: "progress", pct, video: "private-800" });
    assert.deepEqual(p.events("video").map(row => row.props.pct), [10, 25, 50, 75, 100]);
    assert.ok(p.events("video").every(row => !row.meta_event_id));
    assert.deepEqual(p.fbqCalls, []);
  });

  test("an absent or broken pixel does not drop the Fundhub row", () => {
    for (const fbq of [undefined, () => { throw Error("broken SDK"); }]) {
      const p = page({ pathname: "/watch", permitted: true });
      p.win.fbq = fbq;
      p.run();
      p.win.fhTrack("video", { action: "progress", pct: 25 });
      assert.equal(p.events("video")[0].meta_event_id, undefined);
    }
    const p = page({ pathname: "/watch", permitted: true, webdriver: true }).run();
    assert.deepEqual(p.fbqCalls, []);
    assert.equal(p.events("page_view")[0].webdriver, true);
  });
});

describe("server-only conversions", () => {
  const confirmed = { origin: "https://apply.fundhub.ai",
    data: { fh: "track", event: "booking_confirmed", props: { calendar: "funding-book-call" } } };
  for (const tier of ["qualified", "unqualified", undefined]) {
    test("all completed surveys receive the same clean conversion (" + tier + ")", () => {
      for (const [hostname, pathname, survey] of [["fundhub.ai", "/", "home"], ["apply.fundhub.ai", "/apply", "apply"]]) {
        const p = page({ hostname, pathname, permitted: true }).run();
        for (const last of [false, true, false]) p.win.fhTrack("survey_answer", { survey, step_num: 9, last, completion_acknowledged: last,
          credit_tier: tier, question_id: "cf_svy_available_capital", email: "private@example.invalid" });
        const [early, lead, retry] = p.events("survey_answer");
        assert.equal(early.meta_event_id, undefined);
        assert.match(lead.meta_event_id, UUID);
        assert.equal(lead.url, "https://" + hostname + pathname);
        assert.equal(lead.props.credit_tier, tier);
        assert.deepEqual(metaEventsFor(lead), [{ event_name: "Lead", event_source_url: SOURCE, event_id: lead.meta_event_id }]);
        assert.equal(retry.meta_event_id, undefined);
        assert.equal(p.store.fh_credit_tier_v1, tier);
        assert.deepEqual(p.fbqCalls, []);
      }
    });
  }

  for (const pathname of ["/apply", "/blueprint-book"]) {
    test(pathname + " counts one confirmed booking only from its own frame", () => {
      const p = page({ pathname, permitted: true }).run();
      const frame = p.node("iframe", { id: "fh-book-frame" });
      frame.contentWindow = {};
      p.add(frame);
      p.fireWin("message", { ...confirmed, source: {} });
      p.fireWin("message", { ...confirmed, source: frame.contentWindow, data: { ...confirmed.data, props: { calendar: "private-tier" } } });
      assert.equal(p.events("booking_confirmed").length, 0);
      for (let i = 0; i < 2; i++) p.fireWin("message", { ...confirmed, source: frame.contentWindow });
      const rows = p.events("booking_confirmed");
      assert.equal(rows.length, 2, "Fundhub retains both observations");
      assert.equal(rows[1].meta_event_id, undefined, "only the first observation counts");
      assert.match(rows[0].meta_event_id, UUID);
      assert.equal(rows[0].url, "https://apply.fundhub.ai" + pathname);
      assert.deepEqual(metaEventsFor(rows[0]), [{ event_name: "Schedule", event_source_url: SOURCE, event_id: rows[0].meta_event_id }]);
      assert.deepEqual(p.fbqCalls, []);
    });
  }

  for (const [pathname, mark] of [["/funding-book-call", "q"], ["/funding-book-call--02424", "u"]]) {
    test(pathname + " records a confirmed direct booking with the shared source and no SDK activity", () => {
      const search = "?fh_tier=" + mark + "&ticket=private-ticket";
      const p = page({ pathname, search, permitted: true, storage: { fh_credit_tier_v1: "stale-tier" } }).run();
      p.win.fhTrack("calendar_view", { calendar: "funding-book-call" });
      p.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
      const row = p.events("booking_confirmed")[0];
      assert.equal(row.url, "https://apply.fundhub.ai" + pathname);
      assert.deepEqual(metaEventsFor(row), [{ event_name: "Schedule", event_source_url: SOURCE, event_id: row.meta_event_id }]);
      assert.match(row.meta_event_id, UUID);
      assert.equal(row.props.credit_tier, mark === "q" ? "qualified" : "unqualified");
      assert.equal(p.events("page_view")[0].meta_event_id, undefined);
      assert.equal(p.events("calendar_view")[0].meta_event_id, undefined);
      assert.deepEqual(p.fbqCalls, []);
      const child = page({ pathname, search, permitted: true, framed: true }).run();
      assert.equal(child.win.fhTrack, undefined);
      assert.deepEqual(child.sent, []);
    });
  }

  test("a booking in the same tab retains its survey tier only on the first-party row", () => {
    for (const tier of ["qualified", "unqualified"]) {
      const apply = page({ pathname: "/apply" }).run();
      apply.win.fhTrack("survey_answer", { survey: "apply", completion_acknowledged: true, last: true, credit_tier: tier });
      const next = page({ pathname: "/funding-book-call", storage: apply.store }).run();
      next.win.fhTrack("booking_confirmed", { calendar: "funding-book-call" });
      const [row] = next.events("booking_confirmed");
      assert.equal(row.props.credit_tier, tier);
      assert.deepEqual(metaEventsFor(row), [{ event_name: "Schedule", event_id: row.meta_event_id, event_source_url: SOURCE }]);
      assert.deepEqual(next.fbqCalls, []);
    }
    const invalid = page({ pathname: "/funding-book-call", search: "?fh_tier=private", storage: { fh_credit_tier_v1: "private" } }).run();
    invalid.win.fhTrack("booking_confirmed", { calendar: "funding-book-call", credit_tier: "other" });
    assert.equal(invalid.events("booking_confirmed")[0].props.credit_tier, undefined);
  });

  test("matching route and actual step are required; first-party rows still land", () => {
    for (const [path, event, props] of [
      ["/apply", "survey_answer", { survey: "private-tier", last: true, completion_acknowledged: true }],
      ["/apply", "survey_answer", { survey: "apply", last: true, public_contact_receipt: PV }],
      ["/watch", "survey_answer", { survey: "apply", last: true }],
      ["/apply", "booking_confirmed", { calendar: "private-tier" }],
      ["/roadmap-book", "booking_confirmed", { calendar: "funding-book-call" }]
    ]) {
      const p = page({ pathname: path }).run();
      p.win.fhTrack(event, props);
      assert.equal(p.events(event)[0].meta_event_id, undefined);
      assert.deepEqual(p.fbqCalls, []);
    }
  });

  test("the internal session ID cannot appear in an outbound conversion ID", () => {
    const p = page({ pathname: "/apply", storage: { fh_sid: "qualified-score-800" } }).run();
    p.win.fhTrack("survey_answer", { survey: "apply", last: true, completion_acknowledged: true, public_contact_receipt: PV });
    assert.match(p.events("survey_answer")[0].meta_event_id, UUID);
    assert.notEqual(p.events("survey_answer")[0].meta_event_id, PV, "the Fundhub receipt is never used as the Meta event ID");
    assert.ok(!p.events("survey_answer")[0].meta_event_id.includes("qualified"));
  });
});

describe("financial steps stay in Fundhub", () => {
  test("checkout, purchase, score, survey route and credit checks have no Meta copy", () => {
    const p = page({ pathname: "/roadmap", permitted: true }).run();
    const events = [
      ["continue", { step: 1 }], ["buybox_tab", { tab: 2 }], ["section_view", { section: "fh-cf-form" }],
      ["payment_attempt", { amount_cents: 14700 }], ["payment_result", { result: "success", order_ref: "slo_abc" }],
      ["payment_result", { result: "fail", code: "card_declined" }], ["softpull_submit", { businesses: 2 }],
      ["survey_route", { offer: "repair" }], ["survey_answer", { survey: "apply", last: true, credit_tier: "qualified" }]
    ];
    for (const [event, props] of events) p.win.fhTrack(event, props);
    assert.deepEqual(p.bodies().slice(1).map(row => row.event), events.map(([name]) => name));
    assert.ok(p.bodies().every(row => !row.meta_event_id));
    assert.deepEqual(p.fbqCalls, []);
    assert.equal(p.events("payment_result")[0].props.order_ref, "slo_abc");
    assert.equal(p.events("payment_result")[1].props.code, "card_declined");
    assert.equal(p.events("softpull_submit")[0].props.businesses, 2);
  });
});

describe("fbclid, fbc, fbp and url on every post", () => {
  test("url is origin + path, never the query; fbp and fbc come from Meta's cookies", () => {
    const fbc = `fb.1.1700000000123.${FBCLID}`;
    const p = page({ pathname: "/roadmap/", search: "?utm_source=fb&email=pat%40gmail.com", cookie: `a=1; _fbp=${FBP}; _fbc=${fbc}` }).run();
    p.win.fhTrack("scroll", { depth: 25 });
    for (const b of p.bodies()) {
      assert.equal(b.url, "https://apply.fundhub.ai/roadmap/");
      assert.equal(b.fbp, FBP);
      assert.equal(b.fbc, fbc);
    }
  });

  test("no _fbc cookie: fbc = fb.1.<ms>.<fbclid> from the landing URL, saved first touch in fh_attribution", () => {
    const p = page({ pathname: "/watch", search: `?utm_source=fb&fbclid=${FBCLID}` });
    p.clock.now = 1_700_000_000_000;
    const ms = p.clock.now;
    p.run();
    const want = `fb.1.${ms}.${FBCLID}`;
    assert.equal(p.bodies()[0].fbc, want);
    assert.equal("fbp" in p.bodies()[0], false, "no _fbp cookie, no fbp");
    const saved = JSON.parse(p.store.fh_attribution);
    assert.equal(saved.fbclid, FBCLID);
    assert.equal(saved.fbc, want);

    // The next page has no fbclid in its URL, and a later click id does not replace the first.
    p.clock.now += 60_000;
    const next = page({ pathname: "/apply", search: "?fbclid=IwARsecondclick", storage: p.store }).run();
    assert.equal(next.bodies()[0].fbc, want);
    assert.equal(JSON.parse(next.store.fh_attribution).fbclid, FBCLID);
  });

  test("fbc already built by fh-attribution.js is used as is; Meta's _fbc cookie wins over it", () => {
    const built = `fb.1.1700000000999.${FBCLID}`;
    const storage = { fh_attribution: JSON.stringify({ utm_source: "fb", fbclid: FBCLID, fbc: built }) };
    assert.equal(page({ pathname: "/roadmap", storage }).run().bodies()[0].fbc, built);
    const cookieFbc = "fb.1.1700000000555.IwARfromcookie";
    assert.equal(page({ pathname: "/roadmap", storage, cookie: `_fbc=${cookieFbc}` }).run().bodies()[0].fbc, cookieFbc);
  });

  test("a junk fbclid or cookie is never sent", () => {
    for (const search of ["?fbclid=a%40b.co", `?fbclid=${"x".repeat(501)}`, "?fbclid=", "?fbclid=has%20space"]) {
      const p = page({ pathname: "/roadmap", search, cookie: "_fbp=not-a-cookie; _fbc=fb.1.x.y" }).run();
      const b = p.bodies()[0];
      assert.equal("fbc" in b, false, search);
      assert.equal("fbp" in b, false, search);
      assert.equal(JSON.parse(p.store.fh_attribution || "{}").fbclid, undefined, search);
    }
  });

  test("the fbclid is not sent as its own field on track posts (fbc carries it)", () => {
    const p = page({ pathname: "/watch", search: `?fbclid=${FBCLID}` }).run();
    assert.equal("fbclid" in p.bodies()[0], false);
  });
});
