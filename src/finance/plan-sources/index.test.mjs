// The plan-source registry: every source runs, pins are de-duplicated and
// sorted, one failing source never hides the others, and a mark reaches only
// the source that owns the pin. Stub sources; no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  allPins, mergePins, normalizePin, markPin, SOURCES, PIN_KINDS, PIN_STATUSES, MARK_STATUSES
} from "./index.mjs";

const W = { from: "2026-10-01", to: "2026-10-31" };
const quiet = () => {};
const pin = (over = {}) => ({
  id: "p1", date: "2026-10-05", kind: "due", title: "Pay Business Amex", detail: null,
  amount_cents: 13500, bank: null, container_id: null, status: "planned", source: "dues", ...over
});
const src = (name, list, extra = {}) => ({ name, pins: async () => list, ...extra });
const run = (sources, over = {}) =>
  allPins({}, { orgId: "o1", clientId: "c1", ...W, today: "2026-10-07", sources, log: quiet, ...over });

describe("allPins", () => {
  test("runs every source and sorts by date, then kind, then title", async () => {
    const r = await run([
      src("a", [pin({ id: "a1", date: "2026-10-20", title: "Pay Visa" }), pin({ id: "a2", date: "2026-10-03" })]),
      src("b", [
        pin({ id: "b1", date: "2026-10-20", kind: "open_account", title: "Open a checking account" }),
        pin({ id: "b2", date: "2026-10-20", title: "Pay Amex" })
      ])
    ]);
    assert.deepEqual(r.pins.map((p) => p.id), ["a2", "b1", "b2", "a1"]);
    assert.deepEqual(r.sources, [{ name: "a", ok: true, count: 2 }, { name: "b", ok: true, count: 2 }]);
  });

  test("de-duplicates by id: the first source in the list wins", async () => {
    const r = await run([
      src("first", [pin({ id: "same", title: "From the first source" })]),
      src("second", [pin({ id: "same", title: "From the second source" }), pin({ id: "other" })])
    ]);
    assert.equal(r.pins.length, 2);
    assert.equal(r.pins.find((p) => p.id === "same").title, "From the first source");
    assert.equal(r.pins.find((p) => p.id === "same").source, "first");
  });

  test("one failing source gets an error entry and the others still show", async () => {
    const logged = [];
    const r = await run([
      src("good", [pin({ id: "g1" })]),
      { name: "throws", pins: async () => { throw new Error("relation \"x\" does not exist at db.internal.example.com:5432"); } },
      { name: "sync-throw", pins: () => { throw new Error("boom"); } },
      src("not-a-list", { nope: true }),
      { name: "no-pins-fn" },
      src("also-good", [pin({ id: "g2", date: "2026-10-09" })])
    ], { log: (m) => logged.push(m) });
    assert.deepEqual(r.pins.map((p) => p.id), ["g1", "g2"]);
    assert.deepEqual(r.sources, [
      { name: "good", ok: true, count: 1 },
      { name: "throws", ok: false, error: "load_failed" },
      { name: "sync-throw", ok: false, error: "load_failed" },
      { name: "not-a-list", ok: false, error: "not_a_list" },
      { name: "no-pins-fn", ok: false, error: "load_failed" },
      { name: "also-good", ok: true, count: 1 }
    ]);
    /* The reason goes to the server log, with the host redacted — never to the caller. */
    assert.ok(logged.some((m) => /plan source throws failed/.test(m) && !/example\.com/.test(m)));
    assert.ok(!JSON.stringify(r).includes("does not exist"));
  });

  test("an empty source is ok with count 0 — not the same as a failed one", async () => {
    const r = await run([src("empty", [])]);
    assert.deepEqual(r, { pins: [], sources: [{ name: "empty", ok: true, count: 0 }] });
  });

  test("drops a pin with no id, no real date, no title, or a date outside the window", async () => {
    const r = await run([src("s", [
      pin({ id: "keep" }),
      pin({ id: "" }),
      pin({ id: "bad-date", date: "2026-02-30" }),
      pin({ id: "not-iso", date: "Oct 5" }),
      pin({ id: "no-title", title: "   " }),
      pin({ id: "before", date: "2026-09-30" }),
      pin({ id: "after", date: "2026-11-01" }),
      null,
      "junk"
    ])]);
    assert.deepEqual(r.pins.map((p) => p.id), ["keep"]);
    assert.equal(r.sources[0].count, 1);
  });

  test("passes the window, the ids, env, today and now to every source", async () => {
    const seen = [];
    const now = new Date("2026-10-07T02:00:00Z");
    await allPins({ marker: 1 }, {
      orgId: "o1", clientId: "c1", ...W, env: { A: "1" }, now, log: quiet,
      sources: [{ name: "spy", pins: async (db, args) => { seen.push({ db, args }); return []; } }]
    });
    assert.equal(seen[0].db.marker, 1);
    assert.deepEqual(
      { ...seen[0].args, now: seen[0].args.now.toISOString() },
      { orgId: "o1", clientId: "c1", from: W.from, to: W.to, env: { A: "1" }, now: now.toISOString(), today: "2026-10-07" }
    );
  });

  test("the registered sources: waypoints, dues and clarity, each named, each with pins()", () => {
    assert.deepEqual(SOURCES.map((s) => s.name), ["waypoints", "dues", "clarity"]);
    for (const s of SOURCES) assert.equal(typeof s.pins, "function", s.name);
    assert.equal(typeof SOURCES[0].mark, "function", "waypoints can be marked by staff");
    assert.equal(SOURCES[1].mark, undefined, "a due date is never marked here");
    assert.equal(SOURCES[2].mark, undefined, "a Fundhub payment is recorded on Payments, not marked here");
  });
});

describe("normalizePin", () => {
  test("a pin cannot claim another source; the registry name is stamped on it", () => {
    assert.equal(normalizePin(pin({ source: "bank-strategy" }), "dues", W).source, "dues");
  });

  test("can_mark survives only when the source can mark, and only done / missed", () => {
    const raw = pin({ can_mark: ["done", "missed", "delete"] });
    assert.deepEqual(normalizePin(raw, "s", { ...W, markable: true }).can_mark, ["done", "missed"]);
    assert.deepEqual(normalizePin(raw, "s", { ...W, markable: false }).can_mark, []);
    assert.deepEqual(normalizePin(pin(), "s", { ...W, markable: true }).can_mark, []);
  });

  test("money is integer cents or null — unknown is never 0", () => {
    assert.equal(normalizePin(pin({ amount_cents: "2000000" }), "s", W).amount_cents, 2000000);
    assert.equal(normalizePin(pin({ amount_cents: null }), "s", W).amount_cents, null);
    assert.equal(normalizePin(pin({ amount_cents: undefined }), "s", W).amount_cents, null);
    assert.equal(normalizePin(pin({ amount_cents: 12.5 }), "s", W).amount_cents, null);
    assert.equal(normalizePin(pin({ amount_cents: "20,000" }), "s", W).amount_cents, null);
    assert.equal(normalizePin(pin({ amount_cents: NaN }), "s", W).amount_cents, null);
  });

  test("an unknown kind becomes other; an unknown status becomes planned; extra fields are kept", () => {
    const n = normalizePin(pin({ kind: "launch_rocket", status: "maybe", cite: "docs/x.csv" }), "s", W);
    assert.equal(n.kind, "other");
    assert.equal(n.status, "planned");
    assert.equal(n.cite, "docs/x.csv");
    assert.ok(PIN_KINDS.includes("deposit") && PIN_STATUSES.includes("missed"));
  });
});

describe("mergePins", () => {
  test("the first copy of an id wins and the result is sorted", () => {
    const out = mergePins([[pin({ id: "x", date: "2026-10-09" })], [pin({ id: "x", date: "2026-10-01" }), pin({ id: "y", date: "2026-10-02" })]]);
    assert.deepEqual(out.map((p) => `${p.id}@${p.date}`), ["y@2026-10-02", "x@2026-10-09"]);
  });
});

describe("markPin", () => {
  const writer = (answer) => {
    const calls = [];
    return { calls, src: { name: "steps", pins: async () => [], mark: async (db, args) => { calls.push(args); return answer; } } };
  };

  test("only done or missed; an unknown source; a source with no writer", async () => {
    const w = writer({ ok: true });
    assert.deepEqual(await markPin({}, { source: "steps", pinId: "p", status: "skipped", sources: [w.src] }), { ok: false, reason: "bad_status" });
    assert.deepEqual(await markPin({}, { source: "nope", pinId: "p", status: "done", sources: [w.src] }), { ok: false, reason: "unknown_source" });
    const readOnly = await markPin({}, { source: "dues", pinId: "due:x:2026-10-15", status: "done" });
    assert.equal(readOnly.ok, false);
    assert.equal(readOnly.reason, "not_markable");
    assert.equal(w.calls.length, 0);
    assert.deepEqual([...MARK_STATUSES], ["done", "missed"]);
  });

  test("hands the mark to the owning source and normalises the pin it sends back", async () => {
    const w = writer({ ok: true, changed: true, pin: pin({ id: "waypoint:1", status: "done", source: "spoofed", can_mark: [] }) });
    const at = new Date("2026-10-07T03:00:00Z");
    const out = await markPin({}, { orgId: "o1", clientId: "c1", source: "steps", pinId: "waypoint:1", status: "done", at, now: at, sources: [w.src] });
    assert.equal(out.ok, true);
    assert.equal(out.changed, true);
    assert.equal(out.pin.source, "steps");
    assert.deepEqual(w.calls[0], { orgId: "o1", clientId: "c1", pinId: "waypoint:1", status: "done", at, now: at, today: "2026-10-07" });
  });

  test("a refusal from the source comes back as it was said", async () => {
    const w = writer({ ok: false, reason: "closes_on_credit_report", message: "This step closes itself when your next credit report shows the new balance." });
    const out = await markPin({}, { source: "steps", pinId: "waypoint:1", status: "done", sources: [w.src] });
    assert.deepEqual(out, { ok: false, reason: "closes_on_credit_report", message: "This step closes itself when your next credit report shows the new balance." });
  });
});
