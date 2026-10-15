// Finish-853 batch 20: the sales-floor live checks (belief panel, lead-source panel, calls not logged,
// recording rows) run over stand-in rows with the real column names. Same four steps as
// fin-b20-live-contracts.test.mjs: right counted and none wrong; no rows 0 of 0; one wrong row counted
// exactly; the same SQL with the named clause switched off reads that wrong row clean.

import assert from "node:assert/strict";
import test from "node:test";

import { makeStandIn, ago } from "./fin-b20-sql-kit.mjs";
import { BELIEF_SQL, SOURCE_SQL, DISCIPLINE_SQL, RECORDING_SQL } from "./fin-b20-sql.mjs";
import { ORG, OTHER, S1, S2, C1, C2, id, run, without, loosen, cut } from "./fin-b20-live-kit.mjs";

// ---------------------------------------------------------------------------------------------
// Sales floor: belief and lead-source panels
const outcome = (s, over = {}) => s.insert("call_outcomes", {
  id: id("o"), org_id: ORG, client_id: C1, staff_id: S1, outcome: "deposit", belief_failed: null, logged_at: ago(2), is_demo: false, ...over,
});
const CALL_TABLES = ["call_outcomes", "clients"];

test("belief panel: calls that name a belief of a client in this company are right", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    outcome(s, { belief_failed: "trust", outcome: "not_a_fit" });
    outcome(s, { belief_failed: "money", outcome: "callback" });
    outcome(s, { belief_failed: null });                                     // names no belief: not judged here
  };
  assert.deepEqual(run(BELIEF_SQL, CALL_TABLES, seed), { sample_count: 2, bad_count: 0 });
  assert.deepEqual(run(BELIEF_SQL, CALL_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
});

test("belief panel: a call whose client is in another company is counted, demo and other companies are not", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    s.insert("clients", { id: C2, org_id: OTHER });
    outcome(s, { belief_failed: "trust" });
    outcome(s, { client_id: C2, belief_failed: "doubt" });                   // client of another company
    outcome(s, { client_id: C2, belief_failed: "doubt", is_demo: true });    // demo rows are never judged
    outcome(s, { org_id: OTHER, client_id: C2, belief_failed: "pain" });     // another company's call
    outcome(s, { client_id: C2, belief_failed: "doubt", logged_at: ago(90) }); // outside the window
  };
  assert.deepEqual(run(BELIEF_SQL, CALL_TABLES, seed), { sample_count: 2, bad_count: 1 });
  assert.equal(run(without(BELIEF_SQL, "c.id IS NULL"), CALL_TABLES, seed).bad_count, 0);
});

test("lead-source panel: every call counts, so a call without a company client is counted", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    s.insert("clients", { id: C2, org_id: OTHER });
    outcome(s, { outcome: "no_show" });
    outcome(s, { outcome: "deposit" });
    outcome(s, { client_id: C2, outcome: "deposit" });
    outcome(s, { org_id: OTHER, client_id: C2 });
  };
  assert.deepEqual(run(SOURCE_SQL, CALL_TABLES, seed), { sample_count: 3, bad_count: 1 });
  assert.equal(run(without(SOURCE_SQL, "c.id IS NULL"), CALL_TABLES, seed).bad_count, 0);
  assert.deepEqual(run(SOURCE_SQL, CALL_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
});

// ---------------------------------------------------------------------------------------------
// Sales floor: calls not logged
const task = (s, over = {}) => s.insert("tasks", {
  id: id("t"), org_id: ORG, assignee_role: "closer", title: "Strategy session booked", body: id("BK"),
  due_at: ago(1), done: false, is_demo: false, ...over,
});
const TASK_TABLES = ["tasks", "call_outcomes"];

test("calls not logged: a past-due booking task with no disposition at all is the panel's number, and right", () => {
  const seed = (s) => {
    task(s, { id: "t-open-1", body: "BK-1" });
    task(s, { id: "t-open-2", body: "BK-2" });
    task(s, { id: "t-logged", body: "BK-3" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: "t-logged", booking_ref: "BK-3", client_id: C1, staff_id: S1, outcome: "deposit" });
    task(s, { id: "t-future", due_at: ago(-2) });
    task(s, { id: "t-other-role", assignee_role: "setter" });
    task(s, { id: "t-other-title", title: "Send the contract" });
  };
  assert.deepEqual(run(DISCIPLINE_SQL, TASK_TABLES, seed), { sample_count: 2, bad_count: 0 });
});

test("calls not logged: a call logged by booking reference alone is still counted as not logged, and that is wrong", () => {
  const seed = (s) => {
    task(s, { id: "t-1", body: "BK-100" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: null, booking_ref: "BK-100", client_id: C1, staff_id: S1, outcome: "deposit" });
    task(s, { id: "t-2", body: "BK-200" });
    s.insert("call_outcomes", { id: id("o"), org_id: OTHER, task_id: null, booking_ref: "BK-200", client_id: C2, staff_id: S2, outcome: "deposit" });
    task(s, { id: "t-3", body: null });
    task(s, { id: "t-4", org_id: OTHER, body: "BK-100" });
  };
  assert.deepEqual(run(DISCIPLINE_SQL, TASK_TABLES, seed), { sample_count: 3, bad_count: 1 });
  assert.ok(run(loosen(DISCIPLINE_SQL, "d.booking_ref = t.body"), TASK_TABLES, seed).bad_count > 1, "the booking reference match is what narrows it to one");
  assert.equal(run(loosen(DISCIPLINE_SQL, "d.org_id = t.org_id"), TASK_TABLES, seed).bad_count, 2, "a booking reference of another company must not count");
});

// ---------------------------------------------------------------------------------------------
// Sales floor: recording rows
const fileRow = (s, over = {}) => s.insert("brain_files", {
  id: id("f"), org_id: ORG, drive_file_id: id("d"), name: "Meet recording", mime_type: "video/mp4",
  web_view_link: "https://drive.google.com/file/d/abc/view", client_id: C1, needs_transcription: true, indexed_at: ago(1), source: "drive", ...over,
});
const REC_TABLES = ["call_outcomes", "clients", "brain_files", "brain_chunks"];

test("recording rows: Drive links, a company client and words behind every Words ready are right", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    outcome(s, { recording_url: "https://drive.google.com/file/d/one/view" });
    outcome(s, { recording_url: "https://docs.google.com/document/d/two/edit" });
    outcome(s, { recording_url: null });                                     // not a recording
    fileRow(s, { id: "f-wait", needs_transcription: true });                 // waiting for words is fine
    fileRow(s, { id: "f-chunks", needs_transcription: false });              // words are indexed
    s.insert("brain_chunks", { id: "k-1", org_id: ORG, file_id: "f-chunks", chunk_index: 0, content: "words" });
    fileRow(s, { id: "f-transcript", needs_transcription: false });          // words are on the client's call
    outcome(s, { recording_url: null, transcript: "Hello, this is the call." });
  };
  assert.deepEqual(run(RECORDING_SQL, REC_TABLES, seed), { sample_count: 5, bad_count: 0 });
  assert.deepEqual(run(RECORDING_SQL, REC_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
});

test("recording rows: an off-Drive link, no link, another company's client and a Words ready with no words are each counted", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    s.insert("clients", { id: C2, org_id: OTHER });
    outcome(s, { recording_url: "https://example.test/rec.mp4" });                          // 1 not Drive
    outcome(s, { recording_url: "http://drive.google.com/file/d/x/view" });                 // 2 not https
    outcome(s, { client_id: C2, recording_url: "https://drive.google.com/file/d/y/view" }); // 3 client of another company
    outcome(s, { recording_url: "https://drive.google.com.evil.test/x" });                  // 4 look-alike host
    fileRow(s, { web_view_link: null });                                                    // 5 no link
    fileRow(s, { client_id: C2 });                                                          // 6 client of another company
    fileRow(s, { needs_transcription: false });                                            // 7 Words ready, no words anywhere
    outcome(s, { recording_url: "https://drive.google.com/file/d/ok/view", is_demo: true, client_id: C2 }); // demo, left out
    outcome(s, { org_id: OTHER, client_id: C2, recording_url: "https://example.test/z" });  // another company
    outcome(s, { recording_url: "https://example.test/old", logged_at: ago(40) });          // outside the window
    fileRow(s, { web_view_link: null, name: "policy.pdf", mime_type: "application/pdf", needs_transcription: false }); // a document, left out
    fileRow(s, { web_view_link: null, source: "upload", needs_transcription: false });  // a video a person uploaded: no Drive address by design
  };
  assert.deepEqual(run(RECORDING_SQL, REC_TABLES, seed), { sample_count: 7, bad_count: 7 });
  assert.equal(run(loosen(RECORDING_SQL, "bf.source = 'drive'"), REC_TABLES, seed).sample_count, 8, "the Drive-only filter is what leaves uploaded files out");
});

test("recording rows: every clause is live (switch one off and its wrong row reads clean)", () => {
  const one = (fields) => (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    s.insert("clients", { id: C2, org_id: OTHER });
    fields(s);
  };
  const offDrive = one((s) => outcome(s, { recording_url: "https://example.test/rec.mp4" }));
  assert.equal(run(RECORDING_SQL, REC_TABLES, offDrive).bad_count, 1);
  const noCallLink = cut(RECORDING_SQL, "OR (lower(o.recording_url) NOT LIKE", "'https://docs.google.com/%')", "OR 1 = 0");
  assert.equal(run(noCallLink, REC_TABLES, offDrive).bad_count, 0);

  const otherClient = one((s) => fileRow(s, { client_id: C2 }));
  assert.equal(run(RECORDING_SQL, REC_TABLES, otherClient).bad_count, 1);
  assert.equal(run(without(RECORDING_SQL, "(bf.client_id IS NOT NULL AND c2.id IS NULL)"), REC_TABLES, otherClient).bad_count, 0);

  const noWords = one((s) => fileRow(s, { needs_transcription: false }));
  assert.equal(run(RECORDING_SQL, REC_TABLES, noWords).bad_count, 1);
  const noWordsClause = cut(RECORDING_SQL, "OR (bf.needs_transcription = false", "IS NOT NULL))", "OR 1 = 0");
  assert.equal(run(noWordsClause, REC_TABLES, noWords).bad_count, 0);

  const noLink = one((s) => fileRow(s, { web_view_link: "" }));
  assert.equal(run(RECORDING_SQL, REC_TABLES, noLink).bad_count, 1);
  const noFileLink = cut(RECORDING_SQL, "WHEN bf.web_view_link IS NULL OR BTRIM(bf.web_view_link) = ''", "'https://docs.google.com/%')", "WHEN 1 = 0");
  assert.equal(run(noFileLink, REC_TABLES, noLink).bad_count, 0);
});
