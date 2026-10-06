// The Command Center's Scripts tab (plan unit U36): the rules that turn the
// API's answers into words and buttons. public/app/cc-tab-scripts.js puts each
// rule on window.FundhubCCScripts, so this file runs the real script in
// node:vm with no browser and no server (the pattern
// src/ui/marketing-command-center.test.mjs uses).
//
// Every fixture is the API contract's own example (src/marketing/api-contract.mjs),
// so a change to a route's shape that breaks this screen fails here.
//
// What this holds the tab to:
//   1. Write now is not drawn at all while write_now_ready is false (no dead button).
//   2. "Needs a look" drafts come first; Approve is the one filled button.
//   3. Edit rebuilds the words exactly; a stale save shows both texts.
//   4. Every visible button does something; no status code and no "$0" for unknown.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { CONTRACT, exampleResponse } from "../marketing/api-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/cc-tab-scripts.js"), "utf8");

function load(extra = {}) {
  const ctx = createContext({ console, ...extra });
  runInContext(SRC, ctx);
  return ctx;
}

const CTX = load();
const S = CTX.FundhubCCScripts;

/* ── fixtures, all from the contract ─────────────────────────────────────── */

const list = () => exampleResponse("GET marketing/scripts").scripts;
const FUNNELS = exampleResponse("GET marketing/funnels").funnels;
const SETTINGS = exampleResponse("GET marketing/settings").settings;

function flaggedDraft() {
  const s = list()[1];
  s.flagged = true;
  s.check_results = {
    version: 1,
    flagged: true,
    flag_reasons: ["It still fails the rule checker after 2 rewrite rounds."],
    strict: { passed: false, rounds: 2, failures: [{ rule: "round two", message: "It says \"round two\".", line: 2 }], warnings: [] },
    judge: { passed: true, ran: true, notes: [] },
    compliance: { state: "passed", reasons: [], copy_blocked: false, engine_blocked: false }
  };
  return s;
}

function lockedScript(n, root, filmOrder = null) {
  const s = list()[0];
  return { ...s, id: root, root_script_id: root, status: "locked", ad_id: String(n), title: `Script ${n}`, film_order: filmOrder, locked_at: "2026-10-12T15:00:00.000Z" };
}

/** A tab state with everything loaded. */
function loaded({ scripts = [list()[0], flaggedDraft()], ready = true, open = {} } = {}) {
  const st = S.state();
  st.now = Date.parse("2026-10-12T16:00:00Z");
  st.scripts = { status: "ok", loaded: true, items: scripts, as_of: "2026-10-12T15:04:05.000Z", error: null };
  const b = exampleResponse("GET marketing/batches");
  st.batches = { status: "ok", loaded: true, items: b.batches, write_now_ready: ready, error: null };
  st.settings = { status: "ok", data: SETTINGS, error: null };
  st.funnels = { status: "ok", items: FUNNELS, error: null };
  st.ideas = { status: "ok", loaded: true, items: exampleResponse("GET marketing/ideas").ideas, error: null };
  st.rules = { status: "ok", loaded: true, data: exampleResponse("GET marketing/rules"), error: null };
  st.open = open;
  return st;
}

/** Every <button ...> tag in some HTML. */
const buttons = (html) => html.match(/<button\b[^>]*>/g) || [];

describe("registering on the Command Center frame", () => {
  test("queues itself as the Scripts tab when the frame is not loaded yet", () => {
    const q = CTX.FundhubCC._q;
    assert.equal(q.length, 1);
    assert.equal(q[0].id, "scripts");
    assert.equal(q[0].label, "Scripts");
    assert.equal(q[0].order, 3);
    for (const k of ["render", "refresh", "hide"]) assert.equal(typeof q[0][k], "function", k);
  });

  test("calls the frame's own registerTab when the frame loaded first", () => {
    const seen = [];
    load({ FundhubCC: { registerTab: (t) => seen.push(t.id) } });
    assert.deepEqual(seen, ["scripts"]);
  });
});

describe("the inbox", () => {
  test("drafts only, 'needs a look' first, a draft being rewritten last", () => {
    const a = list()[0];
    const f = flaggedDraft();
    const locked = lockedScript(91, "00000000-0000-4000-8000-000000000901");
    assert.deepEqual(S.inboxOrder([a, f, locked]).map((s) => s.id), [f.id, a.id]);
    assert.deepEqual(S.inboxOrder([a, f], { [f.root_script_id]: { version: 1 } }).map((s) => s.id), [a.id, f.id]);
  });

  test("the card caption names the place in the stack, the funnel and the format, never an ad number", () => {
    const s = list()[0];
    assert.equal(S.cardCaption(s, 0, 2, FUNNELS), "Draft 1 of 2 · Roadmap $147 · standard");
    assert.equal(S.cardCaption({ ...s, version: 3, script_format: "sorting", funnel_key: "book_call" }, 1, 2, FUNNELS),
      "Draft 2 of 2 · Book a call · sorting hat short · version 3");
    assert.equal(S.funnelName("new_funnel", []), "new funnel");
  });

  test("one check line in words", () => {
    const f = S.checkLine(flaggedDraft());
    assert.equal(f.tone, "flag");
    assert.equal(f.text, "Needs a look: It still fails the rule checker after 2 rewrite rounds. Approve anyway if you like it.");
    assert.equal(S.checkLine(list()[0]).text, "Passes every rule.");
    assert.equal(S.checkLine({ ...list()[0], check_results: null }).text, "Not checked by the machine.");
    const person = { ...list()[0], source: "chris", check_results: { strict: { passed: false, failures: [{ rule: "x", message: "y" }] } } };
    assert.match(S.checkLine(person).text, /never blocks/);
  });

  test("Approve is the one filled button; Edit, Fix and Reject are outlines; Reject sits apart", () => {
    const st = loaded();
    const html = S.html.inbox(st);
    const primary = buttons(html).filter((b) => /class="[^"]*\bprimary\b/.test(b));
    assert.equal(primary.length, 1);
    assert.match(primary[0], /data-act="approve"/);
    for (const act of ["edit", "fix", "reject"]) assert.match(html, new RegExp(`data-act="${act}"`), act);
    assert.match(html, /class="ccs-reject-gap"><button[^>]*data-act="reject"/);
    assert.match(html, /needs a look/);
    assert.match(html, /1 of 2 · 1 left after this one/);
  });

  test("a draft being rewritten shows why Approve waits, with the button disabled", () => {
    const f = flaggedDraft();
    const st = loaded({ scripts: [f] });
    st.pendingFix[f.root_script_id] = { version: 1, since: st.now - 1000 };
    const html = S.html.inbox(st);
    assert.match(html, /<button[^>]*data-act="approve"[^>]*disabled/);
    assert.match(html, /Rewriting from your note\. It comes back here when done\./);
    assert.doesNotMatch(html, /data-act="edit"/);
  });

  test("the empty inbox says when the next drop comes, and offers Write now only when it works", () => {
    const st = loaded({ scripts: [], ready: false });
    let html = S.html.inbox(st);
    assert.match(html, /No scripts waiting for you\./);
    assert.match(html, /The weekly drop is off\. It turns on in Settings/);
    assert.doesNotMatch(html, /Write now/);
    st.batches.write_now_ready = true;
    st.settings.data = { ...SETTINGS, enabled: true };
    html = S.html.inbox(st);
    assert.match(html, /The weekly drop is on: Monday at 7:00 AM Arizona time\./);
    assert.match(html, /Write now \(at the top\) makes some today\./);
  });
});

describe("Write now is drawn only when write_now_ready is true", () => {
  test("write_now_ready false: no Write now in the header, none in the idea box", () => {
    const st = loaded({ ready: false, open: { ideas: true } });
    const head = S.html.head(st);
    const ideas = S.html.ideas(st);
    assert.doesNotMatch(head, /data-act="write-now"/);
    assert.ok(!buttons(head).some((b) => /write/i.test(b)), "no write button");
    assert.doesNotMatch(head, /Spends model money/);
    assert.doesNotMatch(ideas, /data-act="idea-write"/);
    assert.match(ideas, /data-act="idea-save"/);
  });

  test("write_now_ready true: Write now with a plain cost note from the settings caps", () => {
    const st = loaded({ ready: true, open: { ideas: true } });
    const head = S.html.head(st);
    assert.match(head, /data-act="write-now"/);
    assert.match(head, /Writes 3 scripts\. Spends model money\. Cost: unknown, not measured yet\. It stops by itself at \$40 for the batch and \$300 a month\./);
    assert.match(S.html.ideas(st), /data-act="idea-write"/);
    assert.doesNotMatch(buttons(head).filter((b) => /write-now/.test(b))[0], /primary/);
  });

  test("an unknown cap prints 'unknown', never $0", () => {
    const note = S.writeNowNote({ scripts_per_day: 1, max_batch_cost_usd: null, max_month_cost_usd: null });
    assert.match(note, /Writes 1 script\./);
    assert.match(note, /the batch cap \(unknown\) and the month cap \(unknown\)/);
    assert.doesNotMatch(note, /\$0/);
    assert.match(S.writeNowNote(null), /Writes your daily number of scripts/);
  });

  test("showWriteNow reads only a true write_now_ready", () => {
    assert.equal(S.showWriteNow(exampleResponse("GET marketing/batches")), true);
    assert.equal(S.showWriteNow({ batches: [], write_now_ready: false }), false);
    assert.equal(S.showWriteNow({ batches: [] }), false);
    assert.equal(S.showWriteNow(null), false);
  });
});

describe("Edit rebuilds the words exactly", () => {
  test("changing one part gives the body the contract's edit example sends", () => {
    const s = list()[0];
    const req = CONTRACT["POST marketing/scripts/edit"].example.request;
    const next = s.parts.map((p) => (p.kind === "cta" ? { ...p, text: "Tap below and see your number today." } : p));
    assert.equal(S.bodyFromEdits(s.body, s.parts, next), req.body);
    assert.deepEqual(next, req.parts);
  });

  test("CAPS, pauses and the words between parts survive", () => {
    const body = "FIRST line here.\n\n(pause)\n\nSECOND line.";
    const parts = [{ kind: "hook", text: "FIRST line here." }, { kind: "line2", text: "SECOND line." }];
    const next = [{ kind: "hook", text: "NEW first line." }, parts[1]];
    assert.equal(S.bodyFromEdits(body, parts, next), "NEW first line.\n\n(pause)\n\nSECOND line.");
  });

  test("an emptied part leaves no hole; parts that are not in the body are joined instead", () => {
    const s = list()[0];
    const next = s.parts.map((p) => (p.kind === "line2" ? { ...p, text: "" } : p));
    const out = S.bodyFromEdits(s.body, s.parts, next);
    assert.doesNotMatch(out, /\n{3,}/);
    assert.ok(out.startsWith("MOST lenders read TWO files before they say yes.\n\nthe personal file"));
    assert.equal(S.bodyFromEdits("unrelated", [{ kind: "hook", text: "x" }, { kind: "cue", text: "a" }],
      [{ kind: "hook", text: "x" }, { kind: "cue", text: "a" }]), "x\n\na");
    assert.equal(S.joinParts([{ kind: "cue", text: "a" }, { kind: "cue", text: "b" }, { kind: "cta", text: "c" }]), "a\nb\n\nc");
  });

  test("a stale edit shows yours and the saved text, with Use mine and Use theirs", () => {
    const s = list()[0];
    const html = S.html.conflict({ kind: "edit", id: s.id, mine: "MY words", current: { version: 2, body: "THEIR words", parts: [] } });
    assert.match(html, /MY words/);
    assert.match(html, /THEIR words/);
    assert.match(html, /Saved now \(version 2\)/);
    assert.match(html, /data-act="conflict-mine"/);
    assert.match(html, /data-act="conflict-theirs"/);
    const approve = S.html.conflict({ kind: "approve", id: s.id, mine: s.body, current: { version: 2, body: "x" } });
    assert.doesNotMatch(approve, /conflict-mine/);
    assert.match(approve, /Read the new version/);
  });
});

describe("every version and its check results", () => {
  test("the versions fold lists each version newest first with its checks in words", () => {
    const sv = exampleResponse("GET marketing/script");
    const html = S.html.versions(sv.script, { status: "ok", items: sv.versions, now: Date.parse("2026-10-12T16:00:00Z") }, true);
    assert.match(html, /<b>Version 2<\/b> · draft · written by the machine/);
    assert.match(html, /<b>Version 1<\/b> · replaced/);
    assert.match(html, /Rule checker:<\/b> passed/);
    assert.match(html, /Compliance screen:<\/b> passed/);
  });

  test("a flagged writer result names what failed", () => {
    const w = S.checkWords(flaggedDraft().check_results);
    assert.equal(w[0].name, "Needs a look");
    const strict = w.find((x) => x.name === "Rule checker");
    assert.equal(strict.state, "failed");
    assert.deepEqual(Array.from(strict.lines), ["Line 2: It says \"round two\"."]);
    assert.equal(S.checkWords(null)[0].lines[0], "Not checked by the machine.");
  });
});

describe("film order", () => {
  test("approved scripts sort by film order, then ad number; moves give the new list", () => {
    const a = lockedScript(92, "r-92");
    const b = lockedScript(91, "r-91");
    const c = lockedScript(93, "r-93", 1);
    assert.deepEqual(S.filmOrder([a, b, c, list()[0]]).map((s) => s.ad_id), ["93", "91", "92"]);
    const ids = ["a", "b", "c"];
    assert.deepEqual(S.moveInOrder(ids, "c", "first"), ["c", "a", "b"]);
    assert.deepEqual(S.moveInOrder(ids, "b", "up"), ["b", "a", "c"]);
    assert.deepEqual(S.moveInOrder(ids, "b", "down"), ["a", "c", "b"]);
    assert.deepEqual(S.moveInOrder(ids, "a", "up"), ids);
  });

  test("the approved list draws Up, Down and Film first, the first row says it films first", () => {
    const st = loaded({ scripts: [lockedScript(91, "r-91", 1), lockedScript(92, "r-92", 2)] });
    st.filter = "locked";
    const html = S.html.main(st);
    assert.match(html, /<b>Ad 91<\/b>/);
    assert.match(html, /Films first/);
    assert.match(html, /data-act="order-first" data-root="r-92"/);
    assert.match(html, /<button[^>]*data-act="order-up" data-root="r-91"[^>]*disabled/);
  });
});

describe("ideas, rules and batches", () => {
  test("the idea box: a big text box, optional format and funnel, the ideas with their status words", () => {
    const html = S.html.ideas(loaded({ open: { ideas: true } }));
    assert.match(html, /<textarea id="ccs-idea-text"/);
    assert.match(html, /<option value="sorting">sorting hat short<\/option>/);
    assert.match(html, /<option value="roadmap_147">Roadmap \$147<\/option>/);
    assert.match(html, /In the next batch/);
    assert.match(html, /Written/);
    assert.match(html, /Save idea is free\. It goes in the next batch\./);
  });

  test("rules: Part 0 numbered, a Change on each, add and ban, recent changes with their repo state", () => {
    const html = S.html.rules(loaded({ open: { rules: true } }));
    assert.match(html, /data-act="rule-edit" data-n="0"/);
    assert.match(html, /data-act="rule-add"/);
    assert.match(html, /data-act="rule-ban"/);
    assert.match(html, /Banned phrases \(1\)/);
    assert.match(html, /Reaching the repo/);
    assert.match(html, /In the repo/);
    assert.match(html, /commit 9c1d4e2/);
    assert.deepEqual(S.ruleStateWords({ state: "failed" }).word, "Refused by the repo");
    assert.equal(S.ruleActionWords({ action: "ban" }), "Banned a phrase");
  });

  test("the newest batch in one line, and history rows with counts", () => {
    const b = exampleResponse("GET marketing/batches").batches;
    assert.equal(S.latestBatchLine(b), "Write now batch (Oct 13): writing. 1 of 3 ready.");
    assert.equal(S.latestBatchLine([b[1]]), "Oct 12 batch: 20 of 21 ready, 2 need a look, 1 failed.");
    assert.equal(S.latestBatchLine([]), null);
    const html = S.html.batches(loaded({ open: { batches: true } }));
    assert.match(html, /20 of 21 ready · 2 need a look · 1 failed/);
    assert.match(html, /Weekly drop/);
  });
});

describe("plain words only", () => {
  test("a failed answer never shows a status code", () => {
    for (const status of [0, 400, 401, 403, 404, 405, 409, 422, 500, 502, 503]) {
      const text = S.plainError({ ok: false, status, data: { error: "x" } });
      assert.doesNotMatch(text, /\b\d{3}\b/, `${status}: ${text}`);
      assert.ok(text.length > 10);
    }
    assert.equal(S.plainError({ ok: false, status: 400, data: { error: "cap_reached", message: "This month's $300 cap is reached." } }),
      "This month's $300 cap is reached.");
  });

  test("every button on every view does something, and nothing says to use chat", () => {
    const st = loaded({ scripts: [list()[0], flaggedDraft(), lockedScript(91, "r-91")], open: { ideas: true, rules: true, batches: true } });
    const views = [S.html.head(st), S.html.ideas(st), S.html.rules(st), S.html.batches(st)];
    for (const f of ["draft", "locked", "filmed", "rejected", "all"]) { st.filter = f; views.push(S.html.main(st)); }
    for (const kind of ["edit", "fix", "reject"]) {
      st.filter = "draft";
      st.panel = { kind, id: st.scripts.items[1].id };
      views.push(S.html.main(st));
    }
    const all = views.join("\n");
    for (const b of buttons(all)) assert.match(b, /data-act="[a-z-]+"/, b);
    assert.doesNotMatch(all, /chat command|Claude Code|FundHub/i);
  });

  test("the tab's styles write no font size (the shell throws px sizes away)", () => {
    assert.doesNotMatch(S.CSS, /font-size|font:\s*\d/);
  });

  test("times print in Arizona", () => {
    assert.equal(S.azTime("2026-10-12T15:07:00.000Z"), "Oct 12, 8:07 AM");
    assert.equal(S.azTime(null), "unknown");
    assert.equal(S.when("2026-10-12T15:00:00.000Z", Date.parse("2026-10-12T15:30:00Z")), "30 minutes ago");
  });
});
