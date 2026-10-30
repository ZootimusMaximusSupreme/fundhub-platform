// src/funnel/track.test.mjs — kind "track": the server half of
// docs/tracking/tracking-spec.md, with the database and the bus mocked.
//
// What this proves: the page → funnel/step map and the event and props
// allow-lists match the spec's own tables; unknown props are dropped, strings
// clipped, numbers clamped; a sensitive-looking value never reaches a row;
// seq and the idempotency keys; page_view and click keep their old row names;
// the 500-a-day cap.
//
// What it cannot prove: the real events table, the real unique index, or the
// cap query's plan. src/http/slo-interest-track.pg.test.mjs does that against a
// scratch Postgres.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { FUNNEL_PAGE_MAP, FUNNEL_PAGES, funnelFor, normalizePage } from "./pages.mjs";
import {
  recordTrack, cleanProps, TRACK_EVENTS, TRACK_CAP_SQL, MAX_TRACK_PER_SESSION, MAX_SEQ,
  isSensitiveKey, looksSensitiveValue, trackEventName, trackIdempotencyKey
} from "./track.mjs";

const SPEC = fs.readFileSync(
  fileURLToPath(new URL("../../docs/tracking/tracking-spec.md", import.meta.url)), "utf8");

/** Rows of the markdown table under a "## <heading>". */
function specTable(heading) {
  const start = SPEC.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `spec has a "${heading}" section`);
  const rest = SPEC.slice(start + heading.length + 3);
  const end = rest.search(/\n## /);
  const body = end >= 0 ? rest.slice(0, end) : rest;
  return body.split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .slice(1) // header
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}

const SID = "sess-abcdef12";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

/** A mocked bus + events table: one row per idempotency key, like the real unique index. */
function harness({ used = 0 } = {}) {
  const rows = [];
  const queries = [];
  return {
    rows,
    queries,
    deps: {
      orgId: "org-1",
      userAgent: UA,
      db: {
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql === TRACK_CAP_SQL) return { rows: [{ n: used }] };
          throw new Error(`unexpected sql: ${sql}`);
        }
      },
      async emit(_db, name, payload, opts) {
        if (rows.some((r) => r.opts.idempotencyKey === opts.idempotencyKey)) return { id: null, deduped: true };
        rows.push({ name, payload: structuredClone(payload), opts });
        return { id: `evt-${rows.length}`, deduped: false };
      }
    }
  };
}

const send = (h, body) => recordTrack({ session_id: SID, page: "/roadmap", seq: 1, ...body }, h.deps);

// ── the contract ─────────────────────────────────────────────────────────────

describe("the map and the allow-lists are the spec's tables", () => {
  test("pages → funnel and step, row for row", () => {
    const rows = specTable("Pages → funnel and step");
    assert.ok(rows.length >= 9);
    const fromSpec = Object.fromEntries(rows.map(([page, funnel, step]) => [page, { funnel, step: Number(step) }]));
    assert.deepEqual({ ...FUNNEL_PAGE_MAP }, fromSpec);
    assert.deepEqual([...FUNNEL_PAGES].sort(), Object.keys(fromSpec).sort());
  });

  test("every event and every prop the spec lists, and nothing else", () => {
    const rows = specTable("Events");
    const fromSpec = Object.fromEntries(rows.map((cells) => [
      cells[0].replace(/`/g, ""),
      [...cells[2].matchAll(/`([a-z_]+)`/g)].map((m) => m[1]).sort()
    ]));
    assert.equal(Object.keys(fromSpec).length, 25);
    const fromCode = Object.fromEntries(
      Object.entries(TRACK_EVENTS).map(([e, props]) => [e, Object.keys(props).sort()]));
    assert.deepEqual(fromCode, fromSpec);
  });

  test("no allow-listed prop key names a sensitive field value", () => {
    for (const [event, props] of Object.entries(TRACK_EVENTS)) {
      for (const key of Object.keys(props)) assert.equal(isSensitiveKey(key), false, `${event}.${key}`);
    }
  });
});

// ── pages ────────────────────────────────────────────────────────────────────

describe("page → funnel and step", () => {
  test("each page gets its funnel and step; case and trailing slash do not matter", () => {
    assert.deepEqual(funnelFor("/watch"), { page: "/watch", funnel: "watch", step: 1 });
    assert.deepEqual(funnelFor("/thank-you"), { page: "/thank-you", funnel: "watch", step: 4 });
    assert.deepEqual(funnelFor(" /Roadmap-Book/ "), { page: "/roadmap-book", funnel: "roadmap", step: 2 });
    assert.deepEqual(funnelFor("/order"), { page: "/order", funnel: "watch", step: 5 });
    assert.deepEqual(funnelFor("/home"), { page: "/home", funnel: "homepage", step: 1 });
    assert.equal(normalizePage("/ROADMAP//"), "/roadmap");
  });

  test("the homepage is sent as /home; a bare / is not a funnel page", () => {
    assert.equal(FUNNEL_PAGES.has("/home"), true);
    assert.equal(funnelFor("/"), null, "apply.fundhub.ai/ is a different, unused page");
  });

  test("anything off the map is no page", () => {
    for (const p of ["/admin", "/", "", null, undefined, "/watch?x=1", "constructor", "/roadmap-thank-you-2"]) {
      assert.equal(funnelFor(p), null, String(p));
    }
  });

  test("the row carries the server's funnel and step, never the browser's", async () => {
    const h = harness();
    await send(h, { event: "scroll", page: "/funding-book-call", funnel: "roadmap", step: 9, props: { depth: 50 } });
    const p = h.rows[0].payload;
    assert.equal(p.page, "/funding-book-call");
    assert.equal(p.funnel, "watch");
    assert.equal(p.step, 3);
  });

  test("a page off the map is refused and writes nothing", async () => {
    const h = harness();
    const out = await send(h, { event: "scroll", page: "/admin", props: { depth: 25 } });
    assert.deepEqual(out, { ok: false, error: "page_invalid" });
    assert.equal(h.rows.length, 0);
    assert.equal(h.queries.length, 0);
  });
});

// ── what gets stored ─────────────────────────────────────────────────────────

describe("one track event → one events row", () => {
  test("a scroll is funnel.scroll, keyed by session and seq, local-only", async () => {
    const h = harness();
    const out = await send(h, {
      event: "scroll", seq: 7, props: { depth: 75 },
      utm_source: "fb", utm_content: "43-roadmap", landing_path: "/roadmap?utm_content=43", webdriver: false
    });
    assert.deepEqual(out, { ok: true, actor: "person", saved: true });
    const row = h.rows[0];
    assert.equal(row.name, "funnel.scroll");
    assert.equal(row.opts.idempotencyKey, `funnel-track:${SID}:7`);
    assert.equal(row.opts.orgId, "org-1");
    assert.equal(row.opts.allowNonCanonical, true);
    assert.equal(row.opts.skipInngest, true);
    assert.deepEqual(row.payload, {
      page: "/roadmap",
      funnel: "roadmap",
      step: 1,
      session_id: SID,
      seq: 7,
      event: "scroll",
      props: { depth: 75 },
      attribution: { utm_source: "fb", utm_content: "43-roadmap", landing_path: "/roadmap?utm_content=43" },
      landing_path: "/roadmap?utm_content=43",
      actor: "person",
      actor_reason: "browser"
    });
  });

  test("page_view is stored as funnel.page, once per session per page, outside the cap", async () => {
    const h = harness({ used: MAX_TRACK_PER_SESSION });
    const a = await send(h, { event: "page_view", seq: 1, props: { title: "Roadmap" } });
    const b = await send(h, { event: "page_view", seq: 2, props: { title: "Roadmap" } });
    assert.equal(a.saved, true, "an over-cap session still records the step it reached");
    assert.equal(b.saved, false, "the same page twice in one session is one row");
    assert.equal(h.rows.length, 1);
    assert.equal(h.rows[0].name, "funnel.page");
    assert.equal(h.rows[0].opts.idempotencyKey, `funnel-page:${SID}:/roadmap`);
    assert.equal(h.queries.length, 0, "page_view never runs the cap count");
  });

  test("click is stored as funnel.click, keyed by seq like every other event", async () => {
    const h = harness();
    await send(h, { event: "click", seq: 3, props: { label: "cta:pay-297" } });
    await send(h, { event: "click", seq: 4, props: { label: "cta:pay-297" } });
    assert.deepEqual(h.rows.map((r) => r.name), ["funnel.click", "funnel.click"]);
    assert.deepEqual(h.rows.map((r) => r.opts.idempotencyKey), [`funnel-track:${SID}:3`, `funnel-track:${SID}:4`]);
  });

  test("app_download_tap is funnel.app_download_tap on /thank-you: each press is a row, no prop is kept", async () => {
    const h = harness();
    // What a hand-made post could carry: nothing here may reach the row.
    const props = { href_path: "/join/AbC123xyz", label: "download-for-iphone", store: "testflight", email: "visitor@example.com" };
    const first = await send(h, { event: "app_download_tap", page: "/thank-you", seq: 8, props });
    const second = await send(h, { event: "app_download_tap", page: "/thank-you", seq: 9, props });
    const retry = await send(h, { event: "app_download_tap", page: "/thank-you", seq: 9, props });
    assert.deepEqual([first.saved, second.saved, retry.saved], [true, true, false]);
    assert.deepEqual(h.rows.map((r) => r.name), ["funnel.app_download_tap", "funnel.app_download_tap"]);
    assert.deepEqual(h.rows.map((r) => r.opts.idempotencyKey), [`funnel-track:${SID}:8`, `funnel-track:${SID}:9`]);
    for (const row of h.rows) {
      assert.deepEqual(row.payload.props, {});
      assert.deepEqual([row.payload.page, row.payload.funnel, row.payload.step], ["/thank-you", "watch", 4]);
    }
    assert.deepEqual(cleanProps("app_download_tap", props), {});
  });

  test("portal App Store tap is accepted through the same API door", async () => {
    const h = harness();
    const out = await send(h, { event: "app_download_tap", page: "/portal-login.html", seq: 8, props: {} });
    assert.equal(out.saved, true);
    assert.equal(h.rows[0].name, "funnel.app_download_tap");
    assert.deepEqual([h.rows[0].payload.page, h.rows[0].payload.funnel, h.rows[0].payload.step],
      ["/portal-login.html", "portal", 1]);
  });

  test("every other event is funnel.<event>", () => {
    for (const e of Object.keys(TRACK_EVENTS)) {
      const want = e === "page_view" ? "funnel.page" : e === "click" ? "funnel.click" : `funnel.${e}`;
      assert.equal(trackEventName(e), want);
    }
    assert.equal(trackIdempotencyKey("video", SID, 12, "/watch"), `funnel-track:${SID}:12`);
    assert.equal(trackIdempotencyKey("page_view", SID, 12, "/watch"), `funnel-page:${SID}:/watch`);
  });

  test("a retried send (same seq) is saved once; the next seq is saved again", async () => {
    const h = harness();
    const first = await send(h, { event: "video", seq: 5, props: { video: "vsl", action: "play" } });
    const retry = await send(h, { event: "video", seq: 5, props: { video: "vsl", action: "play" } });
    const next = await send(h, { event: "video", seq: 6, props: { video: "vsl", action: "play" } });
    assert.deepEqual([first.saved, retry.saved, next.saved], [true, false, true]);
    assert.equal(h.rows.length, 2);
  });

  test("an automated browser or a bot is recorded as an agent", async () => {
    const h = harness();
    await send(h, { event: "scroll", seq: 1, webdriver: true });
    await recordTrack({ session_id: SID, page: "/watch", seq: 2, event: "scroll" },
      { ...h.deps, userAgent: "Mozilla/5.0 HeadlessChrome/120" });
    assert.deepEqual(h.rows.map((r) => [r.payload.actor, r.payload.actor_reason]),
      [["agent", "automated_browser"], ["agent", "bot_browser"]]);
  });

  test("no org id given → the default org is looked up once", async () => {
    const h = harness();
    let asked = 0;
    const deps = { ...h.deps, orgId: undefined, defaultOrgId: async () => { asked += 1; return "org-default"; } };
    await recordTrack({ session_id: SID, page: "/watch", seq: 1, event: "scroll" }, deps);
    assert.equal(asked, 1);
    assert.equal(h.rows[0].opts.orgId, "org-default");
    assert.equal(h.queries[0].params[0], "org-default");
  });
});

// ── refused requests ─────────────────────────────────────────────────────────

describe("what is refused, and writes nothing", () => {
  test("bad body, session, event or seq", async () => {
    const cases = [
      [null, "invalid_json"],
      ["junk", "invalid_json"],
      [[1, 2], "invalid_json"],
      [{ session_id: "short", event: "scroll", seq: 1, page: "/watch" }, "session_invalid"],
      [{ session_id: "has space here", event: "scroll", seq: 1, page: "/watch" }, "session_invalid"],
      [{ session_id: SID, event: "keystroke", seq: 1, page: "/watch" }, "event_invalid"],
      [{ session_id: SID, event: "toString", seq: 1, page: "/watch" }, "event_invalid"],
      [{ session_id: SID, event: "", seq: 1, page: "/watch" }, "event_invalid"],
      [{ session_id: SID, event: "scroll", page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: -1, page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: MAX_SEQ + 1, page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: 1.5, page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: "abc", page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: true, page: "/watch" }, "seq_invalid"],
      [{ session_id: SID, event: "scroll", seq: 1, page: "/nope" }, "page_invalid"],
    ];
    for (const [body, error] of cases) {
      const h = harness();
      assert.deepEqual(await recordTrack(body, h.deps), { ok: false, error }, JSON.stringify(body));
      assert.equal(h.rows.length, 0);
      assert.equal(h.queries.length, 0);
    }
  });

  test("seq 0, seq at the top, and a digit string are fine", async () => {
    const h = harness();
    for (const seq of [0, MAX_SEQ, "42"]) assert.equal((await send(h, { event: "scroll", seq })).ok, true);
    assert.deepEqual(h.rows.map((r) => r.payload.seq), [0, MAX_SEQ, 42]);
  });
});

// ── the cap ──────────────────────────────────────────────────────────────────

describe("500 track rows per session per day", () => {
  test("at the cap: ok, nothing saved", async () => {
    const h = harness({ used: MAX_TRACK_PER_SESSION });
    assert.deepEqual(await send(h, { event: "scroll", seq: 501 }), { ok: true, actor: "person", saved: false });
    assert.equal(h.rows.length, 0);
  });

  test("one under the cap: saved", async () => {
    const h = harness({ used: MAX_TRACK_PER_SESSION - 1 });
    assert.equal((await send(h, { event: "scroll", seq: 500 })).saved, true);
  });

  test("the count is this org, this session, the last day, with LIKE wildcards escaped", async () => {
    const h = harness();
    await recordTrack({ session_id: "sess_ab-cdef12", page: "/watch", seq: 1, event: "scroll" }, h.deps);
    const q = h.queries[0];
    assert.equal(q.sql, TRACK_CAP_SQL);
    assert.deepEqual(q.params, ["org-1", "funnel-track:sess\\_ab-cdef12:%"]);
    assert.match(TRACK_CAP_SQL, /org_id = \$1/);
    assert.match(TRACK_CAP_SQL, /idempotency_key LIKE 'funnel-track:%'/, "the literal the partial index needs");
    assert.match(TRACK_CAP_SQL, /created_at > now\(\) - interval '1 day'/);
    assert.match(TRACK_CAP_SQL, new RegExp(`LIMIT ${MAX_TRACK_PER_SESSION}\\b`));
  });
});

// ── props ────────────────────────────────────────────────────────────────────

describe("props: allow-list, clipping, clamping", () => {
  test("unknown keys are dropped; a non-object is no props", () => {
    assert.deepEqual(cleanProps("scroll", { depth: 50, title: "x", email: "a@b.co", __proto__: { depth: 1 } }), { depth: 50 });
    assert.deepEqual(cleanProps("scroll", "depth=50"), {});
    assert.deepEqual(cleanProps("scroll", [50]), {});
    assert.deepEqual(cleanProps("scroll", null), {});
    assert.deepEqual(cleanProps("not_an_event", { depth: 50 }), {});
  });

  test("credit_tier is qualified or unqualified, or it is dropped (owner-set 2026-10-29)", () => {
    assert.deepEqual(cleanProps("survey_answer", { survey: "apply", last: true, credit_tier: "Qualified" }),
      { survey: "apply", last: true, credit_tier: "qualified" });
    assert.deepEqual(cleanProps("booking_confirmed", { calendar: "funding-book-call", credit_tier: "unqualified" }),
      { calendar: "funding-book-call", credit_tier: "unqualified" });
    for (const junk of ["700-749", "maybe", "", 1, true]) {
      assert.equal("credit_tier" in cleanProps("survey_answer", { survey: "apply", credit_tier: junk }), false, String(junk));
    }
    assert.equal("credit_tier" in cleanProps("time_selected", { calendar: "funding-book-call", credit_tier: "qualified" }), false,
      "only the last answer and the booking carry a tier");
  });

  test("the stored row only carries cleaned props", async () => {
    const h = harness();
    await send(h, { event: "click", props: { label: "Pay $297", value: "4242424242424242", secret: 1 } });
    assert.deepEqual(h.rows[0].payload.props, { label: "pay-297" });
  });

  test("strings are slugged or clipped", () => {
    const long = "A".repeat(300);
    const p = cleanProps("click", { label: long, element_id: "BTN Go!!", section: "  Hero / Top  " });
    assert.equal(p.label, "a".repeat(64));
    assert.equal(p.element_id, "btn-go");
    assert.equal(p.section, "hero-top");
    assert.equal(cleanProps("page_view", { title: `  Fundhub\n\t—  Roadmap ${long}` }).title.length, 120);
    assert.equal(cleanProps("page_view", { title: "  Fundhub\n\t—  Roadmap " }).title, "Fundhub — Roadmap");
    assert.deepEqual(cleanProps("faq_open", { question: "!!!" }), {}, "a slug that cleans to nothing is dropped");
  });

  test("a link keeps its path only", () => {
    const at = (href) => cleanProps("click", { href_path: href }).href_path;
    assert.equal(at("https://apply.fundhub.ai/Roadmap-Book?utm_id=120212345678901#top"), "/roadmap-book");
    assert.equal(at("/thank-you?ref=abc"), "/thank-you");
    assert.equal(at("tel:+15551234567"), undefined);
    assert.equal(at("mailto:someone@fundhub.ai"), undefined);
    assert.equal(at("javascript:alert(1)"), undefined);
    assert.equal(at("#faq"), undefined);
  });

  test("numbers are clamped to sane ranges and rounded", () => {
    assert.deepEqual(cleanProps("click", { y_px: -40, y_pct: 140, nth: "3" }), { y_px: 0, y_pct: 100, nth: 3 });
    assert.deepEqual(cleanProps("exit", { seconds: 999999, max_scroll: 33.6 }), { seconds: 86400, max_scroll: 34 });
    assert.deepEqual(cleanProps("video", { current_s: 12.3456, duration_s: "90.5" }), { current_s: 12.35, duration_s: 90.5 });
    assert.deepEqual(cleanProps("buybox_tab", { tab: 7 }), { tab: 3 });
    assert.deepEqual(cleanProps("payment_attempt", { amount_cents: 29700 }), { amount_cents: 29700 });
    assert.deepEqual(cleanProps("scroll", { depth: "lots" }), {});
    assert.deepEqual(cleanProps("scroll", { depth: true }), {});
    assert.deepEqual(cleanProps("scroll", { depth: Infinity }), {});
  });

  test("a fixed-choice prop keeps only a listed choice", () => {
    assert.deepEqual(cleanProps("video", { action: "PLAY" }), { action: "play" });
    assert.deepEqual(cleanProps("video", { action: "rewind" }), {});
    assert.deepEqual(cleanProps("payment_result", { result: "success", code: "card_declined" }),
      { result: "success", code: "card_declined" });
    assert.deepEqual(cleanProps("carousel", { carousel: "wins", action: "next", index: 2 }),
      { carousel: "wins", action: "next", index: 2 });
  });
});

describe("props: a sensitive value never reaches a row", () => {
  test("a field NAME is fine; a field VALUE is dropped", () => {
    assert.deepEqual(cleanProps("field_focus", { form: "buybox", field: "ssn" }), { form: "buybox", field: "ssn" });
    assert.deepEqual(cleanProps("field_complete", { form: "buybox", field: "dob" }), { form: "buybox", field: "dob" });
    assert.deepEqual(cleanProps("field_focus", { form: "buybox", field: "123-45-6789" }), { form: "buybox" });
  });

  test("Social Security, card, phone and account numbers are dropped, however they are written", () => {
    for (const v of [
      "123-45-6789", "123 45 6789", "123456789",
      "4242 4242 4242 4242", "4242-4242-4242-4242", "4242424242424242",
      "(555) 123-4567", "+1 555.123.4567", "000123456789",
    ]) {
      assert.equal(looksSensitiveValue(v), true, v);
      assert.deepEqual(cleanProps("validation_error", { form: "f", field: "x", code: v }), { form: "f", field: "x" }, v);
    }
  });

  test("a big number is dropped, not clamped into a fake value", () => {
    assert.deepEqual(cleanProps("click", { y_px: 4242424242424242, nth: 123456789 }), {});
    assert.deepEqual(cleanProps("payment_attempt", { amount_cents: 123456789 }), {});
    assert.equal(looksSensitiveValue(99_999_999), false);
  });

  test("a date of birth and an email are dropped", () => {
    for (const v of ["01/15/1990", "1990-01-15", "15.01.1990", "19900115", "01151990", "me@example.com"]) {
      assert.equal(looksSensitiveValue(v), true, v);
    }
    assert.deepEqual(cleanProps("page_view", { title: "born 01/15/1990" }), {});
    assert.deepEqual(cleanProps("survey_route", { survey: "fit", offer: "chris@fundhub.ai" }), { survey: "fit" });
  });

  test("ordinary labels, ids and amounts are not mistaken for one", () => {
    for (const v of ["cta:pay-297", "step-2", "faq-3", "video-25", "12345678", 29700, 600, "v1.2"]) {
      assert.equal(looksSensitiveValue(v), false, String(v));
    }
  });

  test("a key that names a sensitive field is never accepted", () => {
    for (const k of ["ssn", "card_number", "dob", "date_of_birth", "email", "phone", "first_name", "value", "answer", "typed_text", "routing_number"]) {
      assert.equal(isSensitiveKey(k), true, k);
    }
    for (const k of ["field", "form", "label", "section", "question_id", "amount_cents", "href_path", "max_scroll"]) {
      assert.equal(isSensitiveKey(k), false, k);
    }
  });
});

// ── buy box version (bbv) ────────────────────────────────────────────────────
// Buy box v2 on /roadmap (owner-set 2026-10-02) tags every event it sends with
// bbv: 2, so before and after compare on the same event names. Spec: "Buy box
// versions".

describe("bbv: which buy box sent the event", () => {
  const BUYBOX = ["buybox_tab", "field_focus", "field_complete", "continue", "validation_error",
    "payment_attempt", "payment_result", "softpull_submit", "preview_opened", "preview_closed"];

  test("every buy box event keeps bbv; no other event takes it", () => {
    for (const e of Object.keys(TRACK_EVENTS)) {
      assert.equal(Object.hasOwn(TRACK_EVENTS[e], "bbv"), BUYBOX.includes(e), e);
    }
    assert.equal(isSensitiveKey("bbv"), false);
  });

  test("bbv 2 rides along with each buy box event's own props", () => {
    assert.deepEqual(cleanProps("buybox_tab", { tab: 3, bbv: 2 }), { tab: 3, bbv: 2 });
    assert.deepEqual(cleanProps("field_complete", { form: "s3", field: "phone", bbv: 2 }), { form: "s3", field: "phone", bbv: 2 });
    assert.deepEqual(cleanProps("validation_error", { form: "s3", field: "phone", code: "phone_invalid", bbv: 2 }),
      { form: "s3", field: "phone", code: "phone_invalid", bbv: 2 });
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: 2 }), { step: 1, bbv: 2 });
    assert.deepEqual(cleanProps("preview_opened", { deliverable: "dispute_letter_pack", bbv: 2 }),
      { deliverable: "dispute_letter_pack", bbv: 2 });
  });

  test("bbv is a whole number 1..99: clamped, and junk dropped", () => {
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: "2" }), { step: 1, bbv: 2 });
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: 2.4 }), { step: 1, bbv: 2 });
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: 0 }), { step: 1, bbv: 1 });
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: 500 }), { step: 1, bbv: 99 });
    assert.deepEqual(cleanProps("continue", { step: 1, bbv: "v2" }), { step: 1 });
    assert.deepEqual(cleanProps("scroll", { depth: 50, bbv: 2 }), { depth: 50 }, "not a buy box event");
  });

  test("the old buy box (no bbv) and the survey pages are unchanged", () => {
    assert.deepEqual(cleanProps("field_focus", { form: "apply", field: "phone" }), { form: "apply", field: "phone" });
    assert.deepEqual(cleanProps("buybox_tab", { tab: 2 }), { tab: 2 });
  });

  test("the stored row carries bbv in props", async () => {
    const h = harness();
    await send(h, { event: "softpull_submit", props: { businesses: 1, bbv: 2 } });
    assert.deepEqual(h.rows[0].payload.props, { businesses: 1, bbv: 2 });
    assert.equal(h.rows[0].name, "funnel.softpull_submit");
  });
});
