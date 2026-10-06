// A page of a funnel the dashboard built (build unit X4) is not on the fixed
// page map, yet it is tracked: the browser tracker sends when window.FH_FUNNEL
// names that very page and adds funnel_tag; the door saves the row only when
// marketing_funnel_pages holds that tag at that address, with the funnel and
// step from our own row. No database: the lookup is a stand-in.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePage } from "../ads/fh-events-harness.mjs";
import { recordTrack, cleanFunnelTag } from "./track.mjs";

const CONFIG = (pathName) => ({
  id: "00000000-0000-4000-8000-0000000000f1", tag: "fnl-blueprint", key: "blueprint",
  offer: "capital_blueprint", lane: "uwiq", page: { role: "booking", path: pathName, step: 2 }
});

describe("the browser tracker on a built funnel page", () => {
  test("sends from a page FH_FUNNEL names, with funnel_tag on every post", () => {
    const p = makePage({ pathname: "/blueprint-book" });
    p.win.FH_FUNNEL = CONFIG("/blueprint-book");
    p.run();
    const views = p.events("page_view");
    assert.equal(views.length, 1);
    assert.equal(views[0].page, "/blueprint-book");
    assert.equal(views[0].funnel_tag, "fnl-blueprint");
  });

  test("the framed calendar's booking is sent with the tag too", () => {
    const p = makePage({ pathname: "/blueprint-book" });
    p.win.FH_FUNNEL = CONFIG("/blueprint-book");
    p.run();
    p.fireWin("message", { origin: "https://apply.fundhub.ai", data: { fh: "track", event: "booking_confirmed", props: { calendar: "funding-book-call" } } });
    const b = p.events("booking_confirmed");
    assert.equal(b.length, 1);
    assert.equal(b[0].funnel_tag, "fnl-blueprint");
  });

  test("silent when FH_FUNNEL names a different page, has a bad tag, or is missing", () => {
    const other = makePage({ pathname: "/blueprint" });
    other.win.FH_FUNNEL = CONFIG("/blueprint-book");
    assert.equal(other.run().sent.length, 0);
    const bad = makePage({ pathname: "/blueprint-book" });
    bad.win.FH_FUNNEL = { ...CONFIG("/blueprint-book"), tag: "blueprint" };
    assert.equal(bad.run().sent.length, 0);
    assert.equal(makePage({ pathname: "/blueprint-book" }).run().sent.length, 0);
  });

  test("a mapped page never carries a funnel tag", () => {
    const p = makePage({ pathname: "/roadmap" }).run();
    assert.equal(p.events("page_view")[0].funnel_tag, undefined);
  });
});

describe("the door", () => {
  const capture = () => {
    const events = [];
    const queries = [];
    return {
      events, queries,
      emit: async (_d, name, payload, opts) => { events.push({ name, payload, opts }); return { id: "e1", deduped: false }; },
      db: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ n: 0 }] }; } }
    };
  };
  const ROW = { id: "page-row-2", path: "/blueprint-book", position: 2, tag: "fnl-blueprint", funnel_id: "funnel-1" };
  const body = (extra = {}) => ({ kind: "track", event: "page_view", seq: 1, session_id: "sess-abcdef12", page: "/blueprint-book", props: {}, ...extra });

  test("a tagged page on our list is saved with the funnel, step, tag and id from our row", async () => {
    const cap = capture();
    const looked = [];
    const out = await recordTrack(body({ funnel_tag: "fnl-blueprint" }), {
      emit: cap.emit, db: cap.db, orgId: "org-1", userAgent: "Mozilla/5.0",
      findFunnelPage: async (_db, orgId, tag, page) => { looked.push([orgId, tag, page]); return ROW; }
    });
    assert.equal(out.ok, true);
    assert.deepEqual(looked, [["org-1", "fnl-blueprint", "/blueprint-book"]]);
    const p = cap.events[0].payload;
    assert.equal(cap.events[0].name, "funnel.page");
    assert.equal(p.page, "/blueprint-book");
    assert.equal(p.funnel, "fnl-blueprint");
    assert.equal(p.step, 2);
    assert.equal(p.funnel_tag, "fnl-blueprint");
    assert.equal(p.funnel_id, "funnel-1");
    assert.ok(cap.queries.some((q) => /events_seen = events_seen \+ 1/.test(q.sql) && q.params[0] === "page-row-2"), "the page's count went up");
  });

  test("no tag, a bad tag, or a tag we do not have: page_invalid, nothing saved", async () => {
    const cap = capture();
    const deps = { emit: cap.emit, db: cap.db, orgId: "org-1", findFunnelPage: async () => null };
    assert.deepEqual(await recordTrack(body(), deps), { ok: false, error: "page_invalid" });
    assert.deepEqual(await recordTrack(body({ funnel_tag: "<script>" }), deps), { ok: false, error: "page_invalid" });
    assert.deepEqual(await recordTrack(body({ funnel_tag: "fnl-nope" }), deps), { ok: false, error: "page_invalid" });
    assert.equal(cap.events.length, 0);
  });

  test("the lookup failing (table not live yet) is page_invalid, never a crash", async () => {
    const cap = capture();
    const db = { query: async () => { const e = new Error('relation "marketing_funnel_pages" does not exist'); e.code = "42P01"; throw e; } };
    const out = await recordTrack(body({ funnel_tag: "fnl-blueprint" }), { emit: cap.emit, db, orgId: "org-1" });
    assert.deepEqual(out, { ok: false, error: "page_invalid" });
  });

  test("cleanFunnelTag keeps only the builder's shape", () => {
    assert.equal(cleanFunnelTag("fnl-blueprint-2"), "fnl-blueprint-2");
    for (const bad of ["blueprint", "fnl-", "FNL-X", "fnl-a--b", 7, null, `fnl-${"a".repeat(70)}`]) assert.equal(cleanFunnelTag(bad), null, String(bad));
  });
});
