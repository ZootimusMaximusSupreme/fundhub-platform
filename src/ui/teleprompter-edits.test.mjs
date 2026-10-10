// The teleprompter's edit-on-the-fly rules (public/app/teleprompter-edits.js),
// run in a bare VM with no document and a fake clock: one changed line becomes
// the whole new body (and parts) the shipped edit route takes; the words it
// rolls match the server's own rule; the waiting list autosaves after a quiet
// moment, saves at once on blur / pause / Done, keeps an edit made offline or
// signed out and sends it again with the SAME request_id, counts what waits,
// turns a 409 into "two versions — pick one", and says it all in plain words.
// The browser half is e2e/teleprompter-touch.spec.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { CONTRACT } from "../marketing/api-contract.mjs";
import { teleprompterText } from "../marketing/shoot-plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const EDITS = fs.readFileSync(path.join(APP, "teleprompter-edits.js"), "utf8");
const TP = fs.readFileSync(path.join(APP, "teleprompter.js"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(EDITS, ctx);
  runInContext(TP, ctx);
  return { E: ctx.FundhubTeleprompterEdits, T: ctx.FundhubTeleprompter };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;
const WORDS = { ...ONE, style: "words" }; // the same words, rolled as paragraphs
const BARE = { ...TWO, parts: null };      // a script with no part marks
const HOOK = "MOST lenders read TWO files before they say yes.";

describe("one changed line becomes the whole script", () => {
  test("words mode: the line is swapped in the body byte for byte, and the hook part follows it", () => {
    const { E, T } = load();
    const paras = T.paragraphsFor(WORDS);
    const r = plain(E.applyEdit(WORDS, paras, 0, "  MOST lenders read BOTH files.  ", false));
    assert.equal(r.changed, true);
    assert.equal(r.body, WORDS.body.replace(HOOK, "MOST lenders read BOTH files."));
    assert.equal(r.parts.find((p) => p.kind === "hook").text, "MOST lenders read BOTH files.");
    assert.equal(r.parts.length, WORDS.parts.length);
    // every other part is untouched
    assert.deepEqual(r.parts.filter((p) => p.kind !== "hook"), WORDS.parts.filter((p) => p.kind !== "hook"));
  });

  test("a paragraph of three cue lines maps line by line onto its three parts", () => {
    const { E, T } = load();
    const paras = T.paragraphsFor(WORDS);
    const i = paras.findIndex((p) => p.text.startsWith("the personal file"));
    const next = "the personal file\nthe company file\nwhich one they read first";
    const r = plain(E.applyEdit(WORDS, paras, i, next, false));
    assert.equal(r.body, WORDS.body.replace("the business file", "the company file"));
    assert.deepEqual(r.parts.filter((p) => p.kind === "cue").map((p) => p.text), ["the personal file", "the company file", "which one they read first"]);
  });

  test("bullets mode: each cue is its own paragraph; the part and its line in the body change together", () => {
    const { E, T } = load();
    assert.equal(T.isBullets(ONE), true);
    const paras = T.paragraphsFor(ONE);
    assert.equal(paras[3].text, "the business file");
    const r = plain(E.applyEdit(ONE, paras, 3, "the company file", true));
    assert.equal(r.body, ONE.body.replace("the business file", "the company file"));
    assert.equal(r.parts[3].text, "the company file");
    assert.equal(r.parts.length, ONE.parts.length);
  });

  test("an emptied line comes out, and the gap closes the way it was (blank line or line break)", () => {
    const { E, T } = load();
    const paras = T.paragraphsFor(TWO);
    const r = plain(E.applyEdit(TWO, paras, 1, "   ", false));
    assert.equal(r.body, "Every hard pull you did not need is still sitting on your file.");
    assert.deepEqual(r.parts, [TWO.parts[0]], "its part comes out too");
    const b = plain(E.applyEdit(ONE, T.paragraphsFor(ONE), 3, "", true));
    assert.equal(b.body, ONE.body.replace("the business file\n", ""));
    assert.equal(b.parts.length, ONE.parts.length - 1);
  });

  test("a script with no parts sends no parts; the same words are no change", () => {
    const { E, T } = load();
    const paras = T.paragraphsFor(BARE);
    const r = plain(E.applyEdit(BARE, paras, 1, "And every lender counts them.", false));
    assert.equal(r.parts, null);
    assert.equal(r.body, "Every hard pull you did not need is still sitting on your file.\n\nAnd every lender counts them.");
    assert.equal(E.applyEdit(BARE, paras, 1, "And lenders count them.\n", false).changed, false);
    assert.equal(E.applyEdit(BARE, paras, 9, "x", false), null);
    // With part marks, the line2 part follows the line.
    const p2 = plain(E.applyEdit(TWO, T.paragraphsFor(TWO), 1, "And every lender counts them.", false));
    assert.deepEqual(p2.parts, [TWO.parts[0], { kind: "line2", text: "And every lender counts them." }]);
  });

  test("a line the parts never held keeps every part as it is", () => {
    const { E, T } = load();
    const s = { ...WORDS, body: WORDS.body + "\n\nOne more line the parts do not have." };
    s.teleprompter_text = E.rolledText(s);
    const paras = T.paragraphsFor(s);
    const r = plain(E.applyEdit(s, paras, paras.length - 1, "One more line, changed.", false));
    assert.deepEqual(r.parts, WORDS.parts);
    assert.ok(r.body.endsWith("One more line, changed."));
  });

  test("first-line-only retake: the hook is what rolls, and editing it changes the hook in the body and the parts", () => {
    const { E, T } = load();
    const s = { ...WORDS, first_line_only: true, needs_retake: true, idea_kind: "opening" };
    s.teleprompter_text = E.rolledText(s);
    assert.equal(s.teleprompter_text, HOOK);
    assert.equal(E.rolledText(s), teleprompterText(s), "the server's own rule");
    assert.equal(E.rolledText(WORDS), teleprompterText(WORDS));
    const r = plain(E.applyEdit(s, T.paragraphsFor(s), 0, "MOST banks read TWO files.", false));
    assert.ok(r.body.startsWith("MOST banks read TWO files.\n\nIf one is a mess"));
    assert.equal(r.parts.find((p) => p.kind === "hook").text, "MOST banks read TWO files.");
  });
});

describe("what changed between versions", () => {
  test("word by word: out in red, in in green", () => {
    const { E } = load();
    const d = plain(E.wordDiff("Lenders read two files today.", "Lenders read BOTH files today, always."));
    assert.deepEqual(d, [
      { op: "same", text: "Lenders read" },
      { op: "del", text: "two" },
      { op: "add", text: "BOTH" },
      { op: "same", text: "files" },
      { op: "del", text: "today." },
      { op: "add", text: "today, always." }
    ]);
    assert.equal(E.diffWords(d), "2 words out, 3 words in.");
    assert.equal(E.diffWords(E.wordDiff("a b", "a b")), "No words changed.");
    assert.equal(E.diffWords(E.wordDiff("a b", "a b c")), "1 word in.");
  });

  test("who wrote a version, from its source; the live one is the one not replaced", () => {
    const { E } = load();
    assert.equal(E.whoWrote("chris"), "Chris");
    assert.equal(E.whoWrote("machine"), "The machine");
    assert.equal(E.whoWrote("agent"), "An agent");
    const v = plain(CONTRACT["GET marketing/script"].example.response.versions);
    assert.equal(E.liveOf(v).id, v[0].id);
    assert.equal(E.liveOf([{ id: "a", status: "superseded" }, { id: "b", status: "locked" }]).id, "b");
  });
});

/* A fake clock and a fake server for the waiting list. */
function rig({ answers = [], live = null } = {}) {
  const { E } = load();
  let now = 1_000_000;
  let timers = [];
  let n = 0;
  const saved = { value: null };
  const sent = [];
  const events = [];
  const store = { get: () => saved.value && JSON.parse(JSON.stringify(saved.value)), set: (v) => { saved.value = JSON.parse(JSON.stringify(v)); } };
  const make = () => E.createSaveQueue({
    store,
    send: (body) => { sent.push(plain(body)); const a = answers.shift(); return Promise.resolve(typeof a === "function" ? a(body) : a || { status: 0, data: null }); },
    live: () => Promise.resolve(live ? live() : { status: 0, data: null }),
    requestId: () => `req-${++n}`,
    now: () => now,
    setTimeout: (f, ms) => { const h = { f, at: now + ms }; timers.push(h); return h; },
    clearTimeout: (h) => { timers = timers.filter((x) => x !== h); },
    onChange: (ev, st) => events.push({ type: ev.type, st: plain(st), ev: plain(ev) })
  });
  const q = make();
  const tick = async (ms) => {
    now += ms;
    const due = timers.filter((x) => x.at <= now);
    timers = timers.filter((x) => x.at > now);
    for (const h of due) h.f();
    await flushAsync();
  };
  return { E, q, make, sent, events, tick, store: saved, at: () => now };
}
const flushAsync = () => new Promise((r) => setImmediate(r));
const ok = (id, version, body) => ({ status: 200, data: { script: { id, version, body, parts: null, status: "locked" }, warnings: [] } });
const BASE = { id: "11111111-1111-4111-8111-111111111111", version: 3, body: "Old words.", parts: null };

describe("the waiting list (autosave queue)", () => {
  test("typing waits for a quiet moment, then ONE save with the newest words", async () => {
    const r = rig({ answers: [ok("v4", 4, "New words, last try.")] });
    r.q.edit("root-1", BASE, "New words.", null);
    await r.tick(500);
    r.q.edit("root-1", BASE, "New words, last try.", null);
    await r.tick(1000);
    assert.equal(r.sent.length, 0, "still inside the quiet time");
    assert.equal(r.E.statusText(r.q.status()), "Saving…");
    await r.tick(600);
    assert.equal(r.sent.length, 1);
    assert.deepEqual(r.sent[0], { request_id: "req-1", id: BASE.id, version: 3, body: "New words, last try." });
    assert.equal(r.q.item("root-1"), null, "saved: nothing waits");
    assert.match(r.E.statusText(r.q.status(), false), /^Saved \d{1,2}:\d{2} [AP]M$/);
    assert.match(r.E.statusText(r.q.status(), true), /^Saved \d{1,2}:\d{2} [AP]M\. Waiting to copy to the repo\.$/);
    const saved = r.events.find((e) => e.type === "saved");
    assert.equal(saved.ev.script.id, "v4");
  });

  test("blur, pause or Done saves at once (no waiting for the quiet time)", async () => {
    const r = rig({ answers: [ok("v4", 4, "New.")] });
    r.q.edit("root-1", BASE, "New.", null);
    await r.q.commit();
    assert.equal(r.sent.length, 1);
    assert.equal(r.q.status().waiting, 0);
  });

  test("the next save writes on the new version", async () => {
    const r = rig({ answers: [ok("v4", 4, "One."), ok("v5", 5, "Two.")] });
    r.q.edit("root-1", BASE, "One.", null);
    await r.q.commit();
    r.q.edit("root-1", { id: "v4", version: 4, body: "One.", parts: null }, "Two.", null);
    await r.q.commit();
    assert.deepEqual(r.sent.map((s) => [s.id, s.version, s.body]), [[BASE.id, 3, "One."], ["v4", 4, "Two."]]);
  });

  test("typing during a save: the words after it go in the next save, on the version it made", async () => {
    let release;
    const first = new Promise((res) => { release = res; });
    const r = rig({ answers: [() => first, ok("v5", 5, "Two.")] });
    r.q.edit("root-1", BASE, "One.", null);
    const p = r.q.commit();
    r.q.edit("root-1", BASE, "Two.", null);
    await r.q.commit();
    assert.equal(r.sent.length, 1, "one save in flight at a time");
    release(ok("v4", 4, "One."));
    await p;
    await flushAsync();
    assert.deepEqual(r.sent.map((s) => [s.id, s.version, s.body]), [[BASE.id, 3, "One."], ["v4", 4, "Two."]]);
    assert.equal(r.q.item("root-1"), null);
  });

  test("offline: it waits on the phone, counts the edits, lives through a reload, and goes once with the SAME request_id", async () => {
    const r = rig({ answers: [{ status: 0, data: null }] });
    r.q.edit("root-1", BASE, "Offline words.", null);
    await r.q.commit();
    assert.equal(r.E.statusText(r.q.status()), "Offline — 1 edit waiting");
    r.q.edit("root-2", { ...BASE, id: "22222222-2222-4222-8222-222222222222" }, "Second script.", null);
    await r.tick(1600);
    assert.equal(r.E.statusText(r.q.status()), "Offline — 2 edits waiting");
    const firstId = r.sent[0].request_id;
    // The page is closed and opened again: a new list, read from storage.
    const again = r.make();
    assert.equal(again.status().waiting, 2);
    r.sent.length = 0;
    // Back online: every save answers.
    const answers = { [firstId]: ok("v4", 4, "Offline words.") };
    const r2 = r; // same fake clock and store
    r2.sent.length = 0;
    const q2 = r.E.createSaveQueue({
      store: { get: () => JSON.parse(JSON.stringify(r.store.value)), set: (v) => { r.store.value = JSON.parse(JSON.stringify(v)); } },
      send: (body) => { r.sent.push(plain(body)); return Promise.resolve(answers[body.request_id] || ok("w2", 4, body.body)); },
      live: () => Promise.resolve({ status: 0, data: null }),
      requestId: () => "req-new-" + r.sent.length,
      now: r.at, setTimeout: () => 0, clearTimeout: () => {}
    });
    await q2.flush();
    assert.equal(r.sent.length, 2);
    assert.equal(r.sent.find((s) => s.body === "Offline words.").request_id, firstId, "the same request_id: the server answers it once");
    assert.equal(q2.status().waiting, 0);
    assert.deepEqual(r.store.value.items, {});
  });

  test("signed out keeps the edit too, and says so", async () => {
    const r = rig({ answers: [{ status: 401, data: { error: "unauthorized" } }] });
    r.q.edit("root-1", BASE, "Words.", null);
    await r.q.commit();
    assert.equal(r.E.statusText(r.q.status()), "Signed out — 1 edit waiting");
    assert.ok(r.q.item("root-1").sent, "kept, request_id and all");
  });

  test("409, someone else saved: two versions, then Chris keeps his — sent on top of theirs", async () => {
    const theirs = { id: "v9", version: 4, body: "Their words.", parts: null, status: "locked", source: "chris", created_at: "2026-10-12T16:00:00.000Z" };
    const r = rig({
      answers: [{ status: 409, data: { error: "stale", current: { version: 4, body: "Their words.", parts: null } } }, ok("v10", 5, "My words.")],
      live: () => ({ status: 200, data: { versions: [theirs, { id: BASE.id, version: 3, status: "superseded", body: "Old words." }] } })
    });
    r.q.edit("root-1", BASE, "My words.", null);
    await r.q.commit();
    await flushAsync();
    const st = r.q.status();
    assert.equal(st.conflicts, 1);
    assert.equal(r.E.statusText(st), "Two versions. Tap to pick one.");
    assert.equal(r.q.item("root-1").conflict.theirs.body, "Their words.");
    await r.q.resolve("root-1", "mine");
    await flushAsync();
    assert.deepEqual(r.sent.map((s) => [s.id, s.version, s.body]), [[BASE.id, 3, "My words."], ["v9", 4, "My words."]]);
    assert.notEqual(r.sent[1].request_id, r.sent[0].request_id);
    assert.equal(r.q.item("root-1"), null);
  });

  test("409, Chris picks the saved words: his are dropped and the page is handed theirs", async () => {
    const theirs = { id: "v9", version: 4, body: "Their words.", parts: null, status: "locked", source: "chris" };
    const r = rig({
      answers: [{ status: 409, data: { error: "stale", current: { version: 4, body: "Their words.", parts: null } } }],
      live: () => ({ status: 200, data: { versions: [theirs] } })
    });
    r.q.edit("root-1", BASE, "My words.", null);
    await r.q.commit();
    await flushAsync();
    r.q.resolve("root-1", "theirs");
    const ev = r.events.find((e) => e.type === "resolved");
    assert.equal(ev.ev.choice, "theirs");
    assert.equal(ev.ev.script.body, "Their words.");
    assert.equal(r.q.item("root-1"), null);
    assert.equal(r.sent.length, 1);
  });

  test("409 that is really our own save (its answer was lost): counted as saved, no picker", async () => {
    const mine = { id: "v4", version: 4, body: "My words.", parts: null, status: "locked", source: "chris" };
    const r = rig({
      answers: [{ status: 409, data: { error: "stale", current: { version: 4, body: "My words.", parts: null } } }],
      live: () => ({ status: 200, data: { versions: [mine] } })
    });
    r.q.edit("root-1", BASE, "My words.", null);
    await r.q.commit();
    await flushAsync();
    assert.equal(r.q.status().conflicts, 0);
    assert.equal(r.q.item("root-1"), null);
    assert.ok(r.events.some((e) => e.type === "saved" && e.ev.script.id === "v4"));
  });

  test("a refused save (400) is kept on the phone with the reason; Try again or Throw away", async () => {
    const r = rig({ answers: [{ status: 400, data: { error: "invalid", field: "id", message: "This script is rejected, so it cannot be edited." } }, ok("v4", 4, "Words.")] });
    r.q.edit("root-1", BASE, "Words.", null);
    await r.q.commit();
    assert.equal(r.E.statusText(r.q.status()), "Not saved. Tap to see why.");
    assert.equal(r.q.item("root-1").failed, "This script is rejected, so it cannot be edited.");
    assert.equal(r.q.item("root-1").body, "Words.", "the words are not lost");
    await r.q.retry("root-1");
    assert.equal(r.sent.length, 2);
    assert.equal(r.q.item("root-1"), null);
    const r2 = rig({ answers: [{ status: 404, data: { error: "not_found", message: "That script was not found." } }] });
    r2.q.edit("root-1", BASE, "Words.", null);
    await r2.q.commit();
    r2.q.drop("root-1");
    assert.equal(r2.q.item("root-1"), null);
  });

  test("typing back to the saved words saves nothing", async () => {
    const r = rig({ answers: [] });
    r.q.edit("root-1", BASE, "Old words!", null);
    r.q.edit("root-1", BASE, "Old words.", null);
    await r.q.commit();
    assert.equal(r.sent.length, 0);
    assert.equal(r.q.item("root-1"), null);
  });

  test("the pulse words", () => {
    const { E } = load();
    const at = Date.UTC(2026, 9, 6, 19, 4);
    const fmt = () => "12:04 PM";
    assert.equal(E.statusText({ waiting: 0, conflicts: 0, failed: 0, saving: false, net: "ok", savedAt: null }), "No changes yet");
    assert.equal(E.statusText({ waiting: 0, conflicts: 0, failed: 0, saving: false, net: "ok", savedAt: at }, false, fmt), "Saved 12:04 PM");
    assert.equal(E.statusText({ waiting: 0, conflicts: 0, failed: 0, saving: false, net: "ok", savedAt: at }, true, fmt), "Saved 12:04 PM. Waiting to copy to the repo.");
    assert.equal(E.statusText({ waiting: 1, conflicts: 0, failed: 0, saving: true, net: "ok", savedAt: at }), "Saving…");
    assert.equal(E.statusText({ waiting: 2, conflicts: 0, failed: 0, saving: false, net: "offline", savedAt: at }), "Offline — 2 edits waiting");
    assert.match(E.clockTime(at), /^\d{1,2}:\d{2} [AP]M$/);
  });

  test("Fundhub spelled right; no second store: the only write is the shipped edit route", () => {
    assert.doesNotMatch(EDITS + TP, /FundHub/);
    const posts = [...TP.matchAll(/api\("POST", "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(posts)].sort(), ["marketing/scripts/edit"]);
    assert.match(TP, /queue\.push\(\{ path: "marketing\/shoot\/mark"/, "marks still go through their own queue");
  });
});
