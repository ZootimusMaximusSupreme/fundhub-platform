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

test("lead-source panel: every call counts, so a call without a company client is counted; demo and old calls are not", () => {
  const seed = (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    s.insert("clients", { id: C2, org_id: OTHER });
    outcome(s, { outcome: "no_show" });
    outcome(s, { outcome: "deposit" });
    outcome(s, { client_id: C2, outcome: "deposit" });                          // client of another company: wrong
    outcome(s, { org_id: OTHER, client_id: C2 });                               // another company's call
    outcome(s, { client_id: C2, outcome: "deposit", is_demo: true });           // demo rows are never judged
    outcome(s, { client_id: C2, outcome: "deposit", logged_at: ago(90) });      // outside the 60 day window
  };
  assert.deepEqual(run(SOURCE_SQL, CALL_TABLES, seed), { sample_count: 3, bad_count: 1 });
  assert.equal(run(without(SOURCE_SQL, "c.id IS NULL"), CALL_TABLES, seed).bad_count, 0);
  assert.deepEqual(run(loosen(SOURCE_SQL, "COALESCE(o.is_demo, false) = false"), CALL_TABLES, seed), { sample_count: 4, bad_count: 2 }, "the demo filter is what leaves it out");
  assert.deepEqual(run(loosen(SOURCE_SQL, "o.logged_at > now() - interval '60 days'"), CALL_TABLES, seed), { sample_count: 4, bad_count: 2 }, "the window is what leaves it out");
  assert.deepEqual(run(SOURCE_SQL, CALL_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
  assert.ok(!/outcome NOT IN/.test(SOURCE_SQL), "no arm the table's own CHECK makes impossible to fire");
});

// ---------------------------------------------------------------------------------------------
// Sales floor: floor discipline (calls not logged, calls not recorded)
const task = (s, over = {}) => s.insert("tasks", {
  id: id("t"), org_id: ORG, assignee_role: "closer", title: "Strategy session booked", body: id("BK"),
  due_at: ago(1), done: false, is_demo: false, ...over,
});
const call = (s, over = {}) => s.insert("call_outcomes", {
  id: id("o"), org_id: ORG, client_id: C1, staff_id: S1, outcome: "deposit", logged_at: ago(0, 2), is_demo: false, ...over,
});
const DISC_TABLES = ["tasks", "call_outcomes", "brain_drive_sync"];

test("floor discipline: past-due booking tasks with no disposition and held calls with no tape are the panel's numbers, and right", () => {
  const seed = (s) => {
    task(s, { id: "t-open-1", body: "BK-1" });
    task(s, { id: "t-open-2", body: "BK-2" });
    task(s, { id: "t-logged", body: "BK-3" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: "t-logged", booking_ref: "BK-3", client_id: C1, staff_id: S1, outcome: "deposit", recording_url: "https://drive.google.com/file/d/x/view" });
    task(s, { id: "t-future", due_at: ago(-2) });
    task(s, { id: "t-other-role", assignee_role: "setter" });
    task(s, { id: "t-other-title", title: "Send the contract" });
    call(s, { id: "u-old" });                                                   // two hours ago, no tape: the chip counts it
    call(s, { id: "u-tape", recording_url: "https://drive.google.com/file/d/y/view" });
  };
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, seed), { sample_count: 3, bad_count: 0 });
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
});

test("floor discipline: a call logged by booking reference alone is still counted as not logged, and that is wrong", () => {
  const seed = (s) => {
    task(s, { id: "t-1", body: "BK-100" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: null, booking_ref: "BK-100", client_id: C1, staff_id: S1, outcome: "deposit", recording_url: "https://drive.google.com/file/d/x/view" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: null, booking_ref: "BK-100", client_id: C1, staff_id: S1, outcome: "callback", recording_url: "https://drive.google.com/file/d/x/view" });
    task(s, { id: "t-2", body: "BK-200" });
    s.insert("call_outcomes", { id: id("o"), org_id: OTHER, task_id: null, booking_ref: "BK-200", client_id: C2, staff_id: S2, outcome: "deposit", recording_url: "https://drive.google.com/file/d/x/view" });
    task(s, { id: "t-3", body: null });                                         // no booking reference: nothing to match
    task(s, { id: "t-4", body: "   " });                                        // a blank one: nothing to match
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: null, booking_ref: "", client_id: C1, staff_id: S1, outcome: "callback", recording_url: "https://drive.google.com/file/d/x/view" });
    s.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: null, booking_ref: "   ", client_id: C1, staff_id: S1, outcome: "callback", recording_url: "https://drive.google.com/file/d/x/view" });
    task(s, { id: "t-5", body: "BK-100", org_id: OTHER });                       // another company's task
    task(s, { id: "t-demo", body: "BK-100", is_demo: true });                   // a demo task is never judged
  };
  // t-1 is wrong (one task however many dispositions share its reference); t-2, t-3, t-4 are plain unlogged tasks
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, seed), { sample_count: 4, bad_count: 1 });
  assert.equal(run(without(DISCIPLINE_SQL, "d.booking_ref = t.body"), DISC_TABLES, seed).bad_count, 0, "no reference match, no wrong row");
  assert.ok(run(loosen(DISCIPLINE_SQL, "d.booking_ref = t.body"), DISC_TABLES, seed).bad_count > 1, "the reference match is what narrows it to one");
  assert.equal(run(loosen(DISCIPLINE_SQL, "d.org_id = t.org_id"), DISC_TABLES, seed).bad_count, 2, "a booking reference of another company must not count");
  assert.ok(run(loosen(DISCIPLINE_SQL, "NULLIF(BTRIM(t.body), '') IS NOT NULL"), DISC_TABLES, seed).bad_count > 1, "a blank body must not match a blank reference");
  assert.deepEqual(run(loosen(DISCIPLINE_SQL, "COALESCE(t.is_demo, false) = false"), DISC_TABLES, seed), { sample_count: 5, bad_count: 2 }, "the demo filter is what leaves it out");
});

test("floor discipline: transcript-only calls do not cause false unrecorded alerts; missing both recording and transcript does", () => {
  const seed = (s) => {
    call(s, { id: "u-plain" });                                                 // no tape or words: count it
    call(s, { id: "u-words", transcript: "Hello, this is the call. We agreed to a deposit." }); // words satisfy the evidence gate
    call(s, { id: "u-blank-words", transcript: "   " });                        // whitespace is not a transcript: count it
    call(s, { id: "u-tape-words", recording_url: "https://drive.google.com/file/d/z/view" }); // recording satisfies the gate
    call(s, { id: "u-blank-tape", recording_url: "  ", transcript: "more words" }); // words satisfy the gate despite blank address
    call(s, { id: "u-noshow", outcome: "no_show" });                             // not a held call
    call(s, { id: "u-demo", is_demo: true });                                     // demo cannot count
    call(s, { id: "u-old", logged_at: ago(20) });                                // outside 14-day window
    call(s, { id: "u-fresh", logged_at: ago(0, 0.083) });                         // five minutes ago: grace window
    call(s, { id: "u-other", org_id: OTHER, client_id: C2 });                    // other company cannot count
  };
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, seed), { sample_count: 2, bad_count: 0 });
  assert.deepEqual(
    run(loosen(DISCIPLINE_SQL, "(u.transcript IS NULL OR BTRIM(u.transcript) = '')"), DISC_TABLES, seed),
    { sample_count: 4, bad_count: 0 },
    "the transcript filter excludes both transcript-only held calls"
  );
  assert.equal(run(loosen(DISCIPLINE_SQL, "u.outcome <> 'no_show'"), DISC_TABLES, seed).sample_count, 3);
  assert.equal(run(loosen(DISCIPLINE_SQL, "COALESCE(u.is_demo, false) = false"), DISC_TABLES, seed).sample_count, 3);
  assert.equal(run(loosen(DISCIPLINE_SQL, "u.logged_at > now() - interval '14 days'"), DISC_TABLES, seed).sample_count, 3);
  assert.equal(run(loosen(DISCIPLINE_SQL, "(u.recording_url IS NULL OR BTRIM(u.recording_url) = '')"), DISC_TABLES, seed).sample_count, 3);
  assert.equal(run(loosen(DISCIPLINE_SQL, "u.logged_at < now() - interval '20 minutes'"), DISC_TABLES, seed).sample_count, 3, "the grace window excludes very recent calls");
  assert.equal(run(loosen(DISCIPLINE_SQL, "u.org_id = $1::uuid"), DISC_TABLES, seed).sample_count, 3, "other companies must stay out");
});

test("floor discipline: a call lacking recording and transcript counts after same-company Drive sync, even during grace", () => {
  const seed = (s) => {
    call(s, { id: "u-fresh", logged_at: ago(0, 0.083) });  // five minutes old
    s.insert("brain_drive_sync", { org_id: ORG, last_sync_at: ago(0, 0.02) });  // synced a minute ago, after the call
    s.insert("brain_drive_sync", { org_id: OTHER, last_sync_at: ago(0, 0.02) });
  };
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, seed), { sample_count: 1, bad_count: 0 });
  const none = (s) => call(s, { id: "u-fresh", logged_at: ago(0, 0.083) });
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, none), { sample_count: 0, bad_count: 0 }, "no sync recorded: still inside the grace window");
  const syncOther = (s) => { none(s); s.insert("brain_drive_sync", { org_id: OTHER, last_sync_at: ago(0, 0.02) }); };
  assert.deepEqual(run(DISCIPLINE_SQL, DISC_TABLES, syncOther), { sample_count: 0, bad_count: 0 }, "another company's sync does not count");
  const noSyncArm = without(DISCIPLINE_SQL, "u.logged_at < (SELECT s.last_sync_at FROM brain_drive_sync s WHERE s.org_id = u.org_id)");
  assert.equal(run(noSyncArm, DISC_TABLES, seed).sample_count, 0, "the sync arm is what counts it");
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
    outcome(s, { recording_url: "https://sites.google.com/view/recording" });               // 8 another Google host: a user page, not Drive
    fileRow(s, { web_view_link: "https://script.google.com/macros/s/abc/exec" });           // 9 another Google host on a file
    outcome(s, { recording_url: "https://evil.google.com/file/d/x/view" });                 // 10 a lookalike subdomain
    outcome(s, { recording_url: "https://drive.google.com/file/d/ok/view", is_demo: true, client_id: C2 }); // demo, left out
    outcome(s, { org_id: OTHER, client_id: C2, recording_url: "https://example.test/z" });  // another company
    outcome(s, { recording_url: "https://example.test/old", logged_at: ago(40) });          // outside the window
    fileRow(s, { web_view_link: null, name: "policy.pdf", mime_type: "application/pdf", needs_transcription: false }); // a document, left out
    fileRow(s, { web_view_link: null, source: "upload", needs_transcription: false });  // a video a person uploaded: no Drive address by design
  };
  assert.deepEqual(run(RECORDING_SQL, REC_TABLES, seed), { sample_count: 10, bad_count: 10 });
  assert.equal(run(loosen(RECORDING_SQL, "bf.source = 'drive'"), REC_TABLES, seed).sample_count, 11, "the Drive-only filter is what leaves uploaded files out");
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

test("recording rows: only drive.google.com and docs.google.com open (widen the host rule and another Google host reads clean)", () => {
  const one = (fields) => (s) => {
    s.insert("clients", { id: C1, org_id: ORG });
    fields(s);
  };
  const others = ["https://sites.google.com/view/x", "https://script.google.com/macros/s/x", "https://mail.google.com/mail/u/0", "https://google.com/x", "https://evil.google.com/file/d/x/view"];
  const widened = RECORDING_SQL.replaceAll("'https://drive.google.com/%'", () => "'https://%.google.com/%'").replaceAll("'https://docs.google.com/%'", () => "'https://%.google.com/%'");
  assert.notEqual(widened, RECORDING_SQL);
  for (const url of others) {
    const callRow = one((s) => outcome(s, { recording_url: url }));
    const fileRowCase = one((s) => fileRow(s, { web_view_link: url }));
    assert.equal(run(RECORDING_SQL, REC_TABLES, callRow).bad_count, 1, `call: ${url}`);
    assert.equal(run(RECORDING_SQL, REC_TABLES, fileRowCase).bad_count, 1, `file: ${url}`);
    if (url.includes(".google.com/")) {
      assert.equal(run(widened, REC_TABLES, callRow).bad_count, 0, `a widened host rule reads clean: ${url}`);
    }
  }
  for (const url of ["https://drive.google.com/file/d/ok/view", "https://docs.google.com/document/d/ok/edit", "HTTPS://DRIVE.GOOGLE.COM/file/d/ok/view"]) {
    assert.equal(run(RECORDING_SQL, REC_TABLES, one((s) => outcome(s, { recording_url: url }))).bad_count, 0, url);
  }
});
