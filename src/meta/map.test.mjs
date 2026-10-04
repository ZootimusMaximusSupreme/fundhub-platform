// src/meta/map.test.mjs — our track events → Meta events, against the
// contract table itself.
//
// What this proves: META_MAP is the "Map (database event → Meta)" table in the
// Phase 4 contract section of docs/tracking/meta-events.md, row for row (our
// event, Meta event, custom or not, custom_data keys and fixed values, the
// ViewContent and Purchase id rules); every other track event maps to nothing;
// the dedupe id rules — the browser's meta_event_id is used as is, and a row
// without one sends nothing.
//
// What it cannot prove: what Meta does with the events. That is Test Events.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  META_MAP, META_EVENT_NAMES, MAPPED_TRACK_EVENTS, SLO_VALUE, CURRENCY,
  metaEventsFor, baseEventId, cleanMetaEventId, pageUrl, VIEW_CONTENT_PAGES
} from "./map.mjs";
import { TRACK_EVENTS } from "../funnel/track.mjs";
import { FUNNEL_PAGES } from "../funnel/pages.mjs";

const DOC = fs.readFileSync(
  fileURLToPath(new URL("../../docs/tracking/meta-events.md", import.meta.url)), "utf8");

/** Rows of the markdown table under "## <heading>" inside the Phase 4 contract. */
function contractTable(heading) {
  const contract = DOC.indexOf("# Phase 4 contract");
  assert.ok(contract >= 0, "meta-events.md has the Phase 4 contract section");
  const start = DOC.indexOf(`## ${heading}`, contract);
  assert.ok(start >= 0, `contract has a "${heading}" section`);
  const rest = DOC.slice(start + heading.length + 3);
  const end = rest.search(/\n##? /);
  const body = end >= 0 ? rest.slice(0, end) : rest;
  return body.split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1) // header
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}

const ROWS = contractTable("Map (database event → Meta)");

/** custom_data keys named in the doc's cell: "value 297, currency USD" → value, currency. */
const docKeys = (cell) => cell === "—" ? [] : cell.split(",").map((p) => p.trim().match(/^[a-z_]+/)[0]).sort();

const SID = "sess-abcdef12";
const ID = `${SID}.7`;
/** A saved row as the browser posts a Meta-mapped event: with its meta_event_id. */
const row = (event, extra = {}) => ({ event, page: "/roadmap", session_id: SID, seq: 7, props: {}, meta_event_id: ID, ...extra });

/* One saved row per table row that fires that row's Meta event. */
const SAMPLES = [
  row("page_view", { page: "/order", meta_event_id: "pv.sess-abcdef12.k3j2" }),
  row("page_view", { page: "/roadmap", meta_event_id: "pv.sess-abcdef12.k3j2" }),
  row("continue", { props: { step: 1, bbv: 2 } }),
  row("survey_answer", { page: "/apply", props: { survey: "apply", step_num: 9, question_id: "cf_svy_available_capital", last: true } }),
  row("buybox_tab", { props: { tab: 2, bbv: 2 } }),
  row("payment_result", { props: { result: "success", bbv: 2 }, meta_event_id: "purchase.ord_123" }),
  row("booking_confirmed", { page: "/apply", props: { calendar: "funding-book-call" } }),
  row("survey_answer", { page: "/apply", props: { survey: "apply", step_num: 3, question_id: "cf_svy_planned_use" } }),
  row("survey_route", { page: "/thank-you", props: { survey: "apply", offer: "slo" } }),
  row("video", { page: "/watch", props: { video: "vsl", action: "progress", pct: 50 } }),
  row("section_view", { props: { section: "fhw" } }),
  row("softpull_submit", { props: { businesses: 2, bbv: 2 } }),
];

describe("META_MAP is the contract table", () => {
  test("same rows, same order: our event, Meta event, custom or not", () => {
    assert.equal(ROWS.length, 12, "the contract table has twelve rows");
    assert.equal(META_MAP.length, ROWS.length);
    ROWS.forEach(([ours, meta], i) => {
      const rule = META_MAP[i];
      assert.equal(rule.event, ours.match(/^[a-z_]+/)[0], `row ${i + 1}: our event`);
      assert.equal(rule.meta, meta.match(/^[A-Za-z]+/)[0], `row ${i + 1}: Meta event`);
      assert.equal(rule.custom, /\(custom\)/.test(meta), `row ${i + 1}: custom or standard`);
      assert.ok(Object.hasOwn(TRACK_EVENTS, rule.event), `row ${i + 1}: ${rule.event} is a track event`);
    });
  });

  test("custom_data keys and fixed values come from the table", () => {
    ROWS.forEach(([, meta, , cell], i) => {
      const name = meta.match(/^[A-Za-z]+/)[0];
      const fired = metaEventsFor(SAMPLES[i]).find((e) => e.event_name === name);
      assert.ok(fired, `row ${i + 1}: the sample fires ${name}`);
      assert.deepEqual(Object.keys(fired.custom_data || {}).sort(), docKeys(cell), `row ${i + 1}: ${cell}`);
      const literal = cell.match(/content_name "([^"]+)"/);
      if (literal) assert.equal(fired.custom_data.content_name, literal[1]);
      const value = cell.match(/value (\d+)/);
      if (value) assert.equal(fired.custom_data.value, Number(value[1]));
      const currency = cell.match(/currency ([A-Z]{3})/);
      if (currency) assert.equal(fired.custom_data.currency, currency[1]);
    });
  });

  test("$147 is integer cents turned into a number of dollars", () => {
    assert.equal(SLO_VALUE, 147);
    assert.equal(typeof SLO_VALUE, "number");
    assert.equal(CURRENCY, "USD");
  });

  test("the id rules in the table: ViewContent <pv>.vc, Purchase purchase.<ref>", () => {
    const vcRow = ROWS.findIndex(([, meta]) => meta.startsWith("ViewContent"));
    const suffix = ROWS[vcRow][1].match(/`<pv>(\.[a-z]+)`/)[1];
    assert.equal(META_MAP[vcRow].idSuffix, suffix);
    const buyRow = ROWS.findIndex(([, meta]) => meta.startsWith("Purchase"));
    const prefix = ROWS[buyRow][2].match(/`([a-z]+\.)<ref>`/)[1];
    assert.equal(META_MAP[buyRow].idPrefix, prefix);
  });

  test("only the table's Meta events exist", () => {
    const fromDoc = [...new Set(ROWS.map(([, meta]) => meta.match(/^[A-Za-z]+/)[0]))].sort();
    assert.deepEqual([...META_EVENT_NAMES].sort(), fromDoc);
  });

  test("ViewContent pages are funnel pages", () => {
    for (const p of VIEW_CONTENT_PAGES) assert.ok(FUNNEL_PAGES.has(p), p);
    assert.deepEqual([...VIEW_CONTENT_PAGES].sort(),
      ROWS[1][0].match(/\/[a-z-]+/g).sort(), "the ViewContent row names these pages");
  });
});

describe("everything else maps to nothing", () => {
  test("a track event not in the table never goes to Meta", () => {
    for (const event of Object.keys(TRACK_EVENTS)) {
      if (MAPPED_TRACK_EVENTS.includes(event)) continue;
      assert.deepEqual(metaEventsFor(row(event, { props: { tab: 2, result: "success" } })), [], event);
    }
  });

  test("a mapped event whose props do not match sends nothing", () => {
    assert.deepEqual(metaEventsFor(row("buybox_tab", { props: { tab: 1 } })), []);
    assert.deepEqual(metaEventsFor(row("buybox_tab", { props: { tab: 3 } })), []);
    assert.deepEqual(metaEventsFor(row("payment_result", { props: { result: "fail" }, meta_event_id: "purchase.o1" })), []);
    assert.deepEqual(metaEventsFor(row("video", { props: { video: "vsl", action: "play" } })), []);
    assert.deepEqual(metaEventsFor(row("video", { props: { video: "vsl", action: "progress", pct: 33 } })), []);
    assert.deepEqual(metaEventsFor(row("section_view", { props: { section: "faq" } })), []);
    assert.deepEqual(metaEventsFor(row("continue", { page: "/apply", props: { step: 1 } })), [], "the buy box is on /roadmap");
    assert.deepEqual(metaEventsFor(row("continue", { props: { step: 2 } })), [], "step 1 only");
    assert.deepEqual(metaEventsFor(null), []);
    assert.deepEqual(metaEventsFor({ event: "toString" }), []);
  });

  test("continue from an older page (no step) is still the step-1 Lead", () => {
    assert.deepEqual(metaEventsFor(row("continue")).map((e) => e.event_name), ["Lead"]);
  });

  test("page_view off the ViewContent pages is PageView only", () => {
    for (const page of ["/order", "/thank-you", "/roadmap-book", "/funding-book-call"]) {
      assert.deepEqual(metaEventsFor(row("page_view", { page })).map((e) => e.event_name), ["PageView"], page);
    }
  });

  test("Lead on survey_answer only with the page's last: true; SurveyStep on every answer", () => {
    const last = metaEventsFor(SAMPLES[3]);
    assert.deepEqual(last.map((e) => e.event_name), ["Lead", "SurveyStep"]);
    assert.deepEqual(last[0].custom_data, { content_name: "apply" });
    assert.deepEqual(last[1].custom_data, { survey: "apply", step: 9 });
    const home = metaEventsFor(row("survey_answer", { page: "/home", props: { survey: "home", step_num: 11, question_id: "contact", last: true } }));
    assert.deepEqual(home.map((e) => e.event_name), ["Lead", "SurveyStep"]);
    const resend = metaEventsFor(row("survey_answer", { page: "/home", props: { survey: "home", step_num: 11, question_id: "contact" } }));
    assert.deepEqual(resend.map((e) => e.event_name), ["SurveyStep"], "a resend after a failed submit carries no last: no second Lead");
    const lastQuestionNoFlag = metaEventsFor(row("survey_answer", { page: "/apply", props: { survey: "apply", question_id: "cf_svy_available_capital" } }));
    assert.deepEqual(lastQuestionNoFlag.map((e) => e.event_name), ["SurveyStep"], "the question id alone is not the Lead");
    for (const flag of [false, "true", 1]) {
      const out = metaEventsFor(row("survey_answer", { page: "/apply", props: { survey: "apply", last: flag } }));
      assert.deepEqual(out.map((e) => e.event_name), ["SurveyStep"], String(flag));
    }
  });

  test("never a survey answer, an email or a phone in custom_data", () => {
    for (const s of SAMPLES) {
      for (const e of metaEventsFor(s)) {
        const text = JSON.stringify(e.custom_data || {});
        assert.ok(!/@|answer|income|credit|ssn|dob/i.test(text), text);
      }
    }
  });
});

describe("event_id: the browser's id, so Meta counts each event once", () => {
  test("the browser's meta_event_id is used as is", () => {
    const [pv, vc] = metaEventsFor(SAMPLES[1]);
    assert.equal(pv.event_name, "PageView");
    assert.equal(pv.event_id, "pv.sess-abcdef12.k3j2");
    assert.equal(vc.event_name, "ViewContent");
    assert.equal(vc.event_id, "pv.sess-abcdef12.k3j2.vc");
    const lead = metaEventsFor(row("continue", { meta_event_id: "sess-abcdef12.41", props: { step: 1 } }));
    assert.equal(lead[0].event_id, "sess-abcdef12.41");
  });

  test("no meta_event_id → no Meta event at all (a repeat, or an older page)", () => {
    for (const s of SAMPLES) {
      const { meta_event_id: _drop, ...bare } = s;
      assert.deepEqual(metaEventsFor(bare), [], `${s.event} without an id`);
    }
    assert.equal(baseEventId(row("scroll", { meta_event_id: undefined })), null);
  });

  test("the last survey question: Lead and SurveyStep under the row's one id", () => {
    const ids = metaEventsFor({ ...SAMPLES[3], meta_event_id: "sess-abcdef12.9" }).map((e) => [e.event_name, e.event_id]);
    assert.deepEqual(ids, [["Lead", "sess-abcdef12.9"], ["SurveyStep", "sess-abcdef12.9"]]);
  });

  test("Purchase only with purchase.<order ref>, once per order", () => {
    const buy = metaEventsFor(SAMPLES[5]);
    assert.deepEqual(buy, [{ event_name: "Purchase", event_id: "purchase.ord_123", custom_data: { value: 147, currency: "USD" } }]);
    assert.deepEqual(metaEventsFor(row("payment_result", { props: { result: "success" } })), [],
      "an id that is not purchase.<ref> is not a Purchase id");
    assert.deepEqual(metaEventsFor(row("payment_result", { props: { result: "success" }, meta_event_id: undefined })), [],
      "no order ref: the payment webhook sends it with purchase.<ref>");
  });

  test("InitiateCheckout carries $147 under the browser's id", () => {
    assert.deepEqual(metaEventsFor(SAMPLES[4]),
      [{ event_name: "InitiateCheckout", event_id: ID, custom_data: { value: 147, currency: "USD" } }]);
  });

  test("a junk meta_event_id is no id, so nothing is sent", () => {
    for (const junk of ["has space", "a/b", "x".repeat(200), "", 42, null, "<script>"]) {
      assert.equal(cleanMetaEventId(junk), null, String(junk));
      assert.deepEqual(metaEventsFor(row("continue", { meta_event_id: junk })), [], String(junk));
    }
    assert.equal(cleanMetaEventId(" purchase.ord-1_A "), "purchase.ord-1_A");
  });
});

test("event_source_url fallback from the page", () => {
  assert.equal(pageUrl("/roadmap"), "https://apply.fundhub.ai/roadmap");
  assert.equal(pageUrl("/home"), "https://fundhub.ai/");
});
