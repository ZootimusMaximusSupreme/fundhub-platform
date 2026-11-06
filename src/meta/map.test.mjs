import { test } from "node:test";
import assert from "node:assert/strict";
import { META_MAP, META_EVENT_NAMES, metaEventsFor } from "./map.mjs";
import { readFileSync } from "node:fs";
import { TRACK_EVENTS } from "../funnel/track.mjs";
const id = "01234567-89ab-4cde-8123-456789abcdef";
const row = (event, page, props = {}) => ({ event, page, props, meta_event_id: id,
  ...(page.startsWith("/blueprint") ? { funnel_tag: "fnl-blueprint" } : {}) });
const conversion = event_name => [{ event_name, event_id: id, event_source_url: "https://apply.fundhub.ai/apply" }];

test("both genuine survey finals produce the same Lead, regardless of qualification", () => {
  for (const page of ["/home", "/apply"]) {
    for (const tier of ["qualified", "unqualified", undefined]) {
      assert.deepEqual(metaEventsFor(row("survey_answer", page, {
        last: true, completion_acknowledged: true, survey: page.slice(1), credit_tier: tier, score: 820, email: "test@example.org"
      })), conversion("Lead"));
    }
    assert.deepEqual(metaEventsFor(row("survey_answer", page, { last: true, survey: page.slice(1) })), []);
    assert.deepEqual(metaEventsFor(row("survey_answer", page, { last: false, survey: page.slice(1) })), []);
    assert.deepEqual(metaEventsFor(row("survey_answer", page, { last: true, survey: "repair" })), []);
  }
  assert.deepEqual(metaEventsFor(row("survey_answer", "/portal-login.html", { last: true, survey: "apply" })), []);
});

test("accepted calendar actions from parents and both direct rails are wire-identical", () => {
  for (const page of ["/apply", "/blueprint-book", "/funding-book-call", "/funding-book-call--02424"]) {
    for (const tier of ["qualified", "unqualified", undefined]) {
      const event = { ...row("booking_confirmed", page, { calendar: "funding-book-call", credit_tier: tier }),
        url: "https://apply.fundhub.ai" + page + "?ticket=private&credit=620" };
      assert.deepEqual(metaEventsFor(event), conversion("Schedule"));
    }
    assert.deepEqual(metaEventsFor(row("booking_confirmed", page, { calendar: "other" })), []);
  }
  assert.deepEqual(metaEventsFor(row("booking_confirmed", "/roadmap-book", { calendar: "funding-book-call" })), []);
  assert.deepEqual(metaEventsFor({ ...row("booking_confirmed", "/blueprint-book", { calendar: "funding-book-call" }),
    funnel_tag: "fnl-private" }), []);
});

test("reviewed public pages use exact source addresses and independent view ids", () => {
  for (const page of ["/watch", "/blueprint"]) {
    const both = metaEventsFor(row("page_view", page));
    assert.deepEqual(both.map(e => [e.event_name, e.event_id]), [["PageView", id], ["ViewContent", id + ".vc"]]);
    assert.ok(both.every(e => e.event_source_url === "https://apply.fundhub.ai" + page && !e.custom_data));
  }
  for (const page of ["/apply", "/home", "/funding-book-call", "/funding-book-call--02424", "/roadmap", "/portal-login.html", "/unknown"]) {
    assert.deepEqual(metaEventsFor(row("page_view", page)), []);
  }
  assert.deepEqual(metaEventsFor(row("video", "/watch", { action: "progress", pct: 25 })), []);
  assert.deepEqual(metaEventsFor(row("video", "/blueprint", { action: "progress", pct: 25 })), []);
});

test("every other tracker event and unsafe legacy id stays internal", () => {
  assert.deepEqual(META_EVENT_NAMES, ["PageView", "ViewContent", "Lead", "Schedule"]);
  for (const event of Object.keys(TRACK_EVENTS).filter(name => !["page_view", "survey_answer", "booking_confirmed"].includes(name))) {
    assert.deepEqual(metaEventsFor(row(event, "/watch", { result: "success", credit_tier: "qualified", step: 1, tab: 2 })), [], event);
  }
  for (const meta_event_id of ["", "sess-abc12345.7", "qualified.300", "purchase.slo_order", id + ".vc"]) {
    assert.deepEqual(metaEventsFor({ ...row("survey_answer", "/apply", { last: true, completion_acknowledged: true, survey: "apply" }), meta_event_id }), []);
  }
});

test("the published event contract lists exactly the server event names", () => {
  const doc = readFileSync(new URL("../../docs/tracking/meta-events.md", import.meta.url), "utf8");
  const table = doc.split("## Map (database event → Meta)")[1]?.split(/\n##? /)[0];
  assert.ok(table, "current public event contract");
  const pairs = table.split("\n").filter(line => line.startsWith("|")).slice(2)
    .map(line => line.split("|").slice(1, 3).map(cell => cell.trim().replaceAll("`", "")));
  assert.deepEqual(pairs, META_MAP.map(rule => [rule.event, rule.meta]));
});
