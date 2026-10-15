// Batch 18 live checks, run over stand-in rows (no database on this machine). Each check is the exact SQL
// text the display lane sends. The stand-in tables hold the product's real column names (read from
// db/schema and db/migrations), so a typo in a check fails here as "no such column".
//
// For every check:
//   - a healthy set is clean
//   - for each named bad-result condition, one row broken in only that way is counted wrong, and the same
//     text with that one condition dropped no longer counts it (so no condition is decoration)
//   - another company's rows are never counted, and taking the company condition out of the text would
//     count them
//   - rows outside the check's window or scope are not counted at all
//
// The SQL runs on SQLite, not Postgres: the text uses only spellings both share and the kit turns the few
// Postgres-only ones (casts, BTRIM, now() and interval) into SQLite. The first morning run is the Postgres
// proof; a statement Postgres refuses shows as "not read" (skip), never green.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPLICATIONS_BAD, CSUITE_POST_BAD, CSUITE_TASK_BAD, HELPER_BAD,
  STEPS_BAD, TRANSFER_BAD, applicationsSql, csuiteSql, helperSql, stepsSql, transferSql,
} from "./fin-b18-display-contracts.mjs";
import { NOW, makeStandIn, tablesIn } from "./fin-b18-sql-kit.mjs";

const ORG = "11111111-0000-4000-8000-000000000001";
const OTHER_ORG = "22222222-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const DAY = 86_400_000;
const at = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function names(pairs) { return pairs.map(([name]) => name); }

/**
 * Run one check across its cases.
 *   sqlOf(without)        the text
 *   tables                the tables the stand-in needs
 *   healthy(db)           inserts the healthy set, returns how many samples it holds
 *   breaks[name](db)      inserts ONE sample broken only that way (and anything it needs); returns the number of
 *                         bad samples it should add (default 1)
 *   ignored(db)           inserts rows that must not be counted at all (other company, out of window, out of scope)
 *   otherCompanyBad(db)   inserts a broken row for another company
 */
function suite(title, { sqlOf, bad, tables, healthy, breaks, ignored, otherCompanyBad }) {
  const run = (prepare, { without = [], text = null } = {}) => {
    const db = makeStandIn(tables);
    try {
      prepare(db);
      return db.run(text || sqlOf({ without }), ORG);
    } finally {
      db.close();
    }
  };

  test(`${title}: a healthy set is clean`, () => {
    let samples = 0;
    const answer = run((db) => { samples = healthy(db); });
    assert.deepEqual(answer, { sample_count: samples, bad_count: 0 });
    assert.ok(samples >= 2, "the healthy set holds more than one sample");
  });

  test(`${title}: no saved results at all is zero samples`, () => {
    assert.deepEqual(run(() => {}), { sample_count: 0, bad_count: 0 });
  });

  test(`${title}: every named condition has a break that only it catches`, () => {
    const listed = names(bad);
    assert.deepEqual(Object.keys(breaks).sort(), [...listed].sort(), "one break per named condition");
    for (const name of listed) {
      let samples = 0;
      let wrong = 1;
      const withIt = run((db) => { samples = healthy(db); wrong = breaks[name](db) ?? 1; });
      assert.deepEqual(withIt, { sample_count: samples + wrong, bad_count: wrong }, `"${name}" is counted wrong`);
      const dropped = run((db) => { healthy(db); breaks[name](db); }, { without: [name] });
      assert.equal(dropped.bad_count, 0, `without "${name}" the same break is not caught, so the condition is what catches it`);
    }
  });

  test(`${title}: rows outside the company, the window or the scope are not counted`, () => {
    let samples = 0;
    const answer = run((db) => { samples = healthy(db); ignored(db); });
    assert.deepEqual(answer, { sample_count: samples, bad_count: 0 });
  });

  test(`${title}: another company's broken row is never counted, and losing the company condition would count it`, () => {
    let samples = 0;
    const answer = run((db) => { samples = healthy(db); otherCompanyBad(db); });
    assert.deepEqual(answer, { sample_count: samples, bad_count: 0 });
    const text = sqlOf({});
    assert.match(text, /\.org_id = \$1::uuid/);
    const unscoped = text.replace(/(\w+)\.org_id = \$1::uuid/g, "$1.org_id IS NOT NULL");
    assert.notEqual(unscoped, text);
    const leaked = run((db) => { healthy(db); otherCompanyBad(db); }, { text: unscoped });
    assert.ok(leaked.bad_count > 0, "without the company condition the other company's broken row is counted");
  });

  test(`${title}: reads only tables the stand-in knows, and only reads`, () => {
    const text = sqlOf({});
    assert.match(text, /^\/\* display-result:fin-b18-[a-z-]+ \*\//);
    assert.doesNotMatch(text, /\b(insert|update|delete|drop|alter|create|truncate)\b/i);
    for (const table of tablesIn(text)) assert.ok(tables.includes(table), `${table} is a stand-in table`);
  });
}

// ───────────────────────── steps ─────────────────────────

function decline(db, id, over = {}) {
  db.insert("blueprint_declines", { id, org_id: ORG, client_id: CLIENT, application_id: null, bank: "Chase", outcome: "open", created_at: at(3), ...over });
}
function step(db, declineId, position, over = {}) {
  const key = over.step_key || (position === 1 ? "read_letter" : "get_letter");
  const status = over.status || "open";
  db.insert("blueprint_decline_steps", {
    id: `${declineId}-step-${position}-${key}`, org_id: ORG, decline_id: declineId, position, step_key: key,
    who: position === 1 ? "agent" : "client", client_text: "text", status,
    done_at: status === "open" ? null : at(2), done_by: status === "open" ? null : "agent (rules)", ...over,
  });
}
function plan(db, id, declineOver = {}, firstOver = {}, secondOver = {}) {
  decline(db, id, declineOver);
  step(db, id, 1, { status: "done", ...firstOver });
  step(db, id, 2, secondOver);
}

suite("decline steps", {
  sqlOf: stepsSql,
  bad: STEPS_BAD,
  tables: ["blueprint_declines", "blueprint_decline_steps"],
  healthy(db) {
    plan(db, "d-open");
    plan(db, "d-worked", {}, {}, { status: "skipped" });
    plan(db, "d-reopened", {}, {}, { status: "open", done_at: null, done_by: null });
    return 3;
  },
  breaks: {
    "a decline has no plan steps at all": (db) => decline(db, "d-empty"),
    "a plan step belongs to a different company than its decline": (db) => plan(db, "d-cross", {}, { org_id: OTHER_ORG }),
    "a step is done or skipped but names nobody who did it": (db) => plan(db, "d-nameless", {}, { status: "done", done_by: "  " }),
    "a step that is open still carries a finished time": (db) => plan(db, "d-stale", {}, {}, { status: "open", done_at: at(1) }),
    "two steps of one decline share a place in the list": (db) => {
      decline(db, "d-twins");
      step(db, "d-twins", 1, { status: "done" });
      step(db, "d-twins", 2, { step_key: "get_letter", position: 1 });
      return 1;
    },
  },
  ignored(db) {
    plan(db, "d-old", { created_at: at(400) }, { done_by: null });
    db.insert("blueprint_declines", { id: "d-other", org_id: OTHER_ORG, client_id: OTHER_CLIENT, bank: "Chase", outcome: "open", created_at: at(3) });
  },
  otherCompanyBad(db) {
    db.insert("blueprint_declines", { id: "d-other-bad", org_id: OTHER_ORG, client_id: OTHER_CLIENT, bank: "Chase", outcome: "open", created_at: at(3) });
  },
});

// ───────────────────────── applications ─────────────────────────

function app(db, id, over = {}) {
  db.insert("applications", {
    id, org_id: ORG, client_id: CLIENT, bank: "Chase", lender_name: "Chase", product_name: "Ink Business", status: "Applied",
    is_demo: false, updated_at: at(5), ...over,
  });
}
function appDecline(db, id, applicationId, over = {}) {
  db.insert("blueprint_declines", { id, org_id: ORG, client_id: CLIENT, application_id: applicationId, bank: "Chase", outcome: "open", created_at: at(4), ...over });
}

suite("applications list", {
  sqlOf: applicationsSql,
  bad: APPLICATIONS_BAD,
  tables: ["applications", "blueprint_declines"],
  healthy(db) {
    app(db, "a-chase");
    app(db, "a-bank-only", { lender_name: null, bank: "Amex", product_name: null });
    app(db, "a-lender-only", { lender_name: "Capital One", bank: "" });
    app(db, "a-approved", { status: "Approved" });
    app(db, "a-denied", { status: "Denied" });
    appDecline(db, "dec-ok", "a-denied", { outcome: "still_declined" });
    app(db, "a-recon", { status: "Approved" });
    appDecline(db, "dec-recon", "a-recon", { outcome: "approved_on_recon" });
    app(db, "a-later", { status: "Applied" });
    appDecline(db, "dec-later", "a-later", { outcome: "reapply_later", reapply_on: "2026-12-01" });
    return 7;
  },
  breaks: {
    "an application has no bank name, so the list says only 'A bank'": (db) => app(db, "a-nameless", { lender_name: "  ", bank: null }),
    "an application has no status, so the list says 'Status not set'": (db) => app(db, "a-statusless", { status: null }),
    "a decline is attached to an application of another client or company": (db) => {
      app(db, "a-crossed");
      appDecline(db, "dec-crossed", "a-crossed", { client_id: OTHER_CLIENT });
    },
    "a decline was approved on reconsideration but the application is not Approved": (db) => {
      app(db, "a-lost-yes", { status: "Applied" });
      appDecline(db, "dec-lost-yes", "a-lost-yes", { outcome: "approved_on_recon" });
    },
    "a decline stayed declined after reconsideration but the application is not Denied": (db) => {
      app(db, "a-lost-no", { status: "Applied" });
      appDecline(db, "dec-lost-no", "a-lost-no", { outcome: "still_declined" });
    },
  },
  ignored(db) {
    app(db, "a-demo", { is_demo: true, status: null });
    app(db, "a-old", { updated_at: at(200), status: null });
    app(db, "a-no-client", { client_id: null, status: null });
    app(db, "a-other", { org_id: OTHER_ORG, status: null });
  },
  otherCompanyBad(db) {
    app(db, "a-other-bad", { org_id: OTHER_ORG, status: null });
  },
});

// ───────────────────────── helper stop ─────────────────────────

function halted(db, client, over = {}) {
  db.insert("clients", { id: client, org_id: over.clientOrg || ORG });
  db.insert("money_helper_threads", { client_id: client, org_id: ORG, halted_at: at(2), halt_reason: over.reason || "stop" });
  if (over.turn !== false) {
    db.insert("money_helper_turns", { id: `${client}-turn`, org_id: ORG, client_id: client, kind: "message", status: "halted", created_at: at(2) });
  }
  if (over.optOut !== false && (over.reason || "stop") === "stop") {
    db.insert("opt_outs", { client_id: client, org_id: ORG, channel: "sms", opted_out_at: at(2) });
  }
}

suite("helper stop", {
  sqlOf: helperSql,
  bad: HELPER_BAD,
  tables: ["money_helper_threads", "money_helper_turns", "opt_outs", "clients"],
  healthy(db) {
    halted(db, "h-stop");
    halted(db, "h-legal", { reason: "legal" });
    halted(db, "h-asked-again", {});
    // a message made before the stop and answered is fine; an opt back in leaves the opt-out row in place
    db.insert("money_helper_turns", { id: "h-stop-early", org_id: ORG, client_id: "h-stop", kind: "message", status: "answered", created_at: at(5) });
    db.insert("money_helper_turns", { id: "h-stop-task", org_id: ORG, client_id: "h-stop", kind: "task", status: "answered", created_at: at(1) });
    return 3;
  },
  breaks: {
    "a stopped helper has no stopped turn behind it": (db) => halted(db, "b-no-turn", { turn: false }),
    "a stop the client asked for left no text opt-out, so the banner's promise is false": (db) => halted(db, "b-no-optout", { optOut: false }),
    "the helper kept answering messages after it stopped": (db) => {
      halted(db, "b-kept-going");
      db.insert("money_helper_turns", { id: "b-kept-going-late", org_id: ORG, client_id: "b-kept-going", kind: "message", status: "answered", created_at: at(1) });
    },
    "a stopped thread belongs to a client of another company": (db) => halted(db, "b-crossed", { clientOrg: OTHER_ORG }),
  },
  ignored(db) {
    // a thread that is not stopped, and a stopped thread of another company
    db.insert("clients", { id: "i-running", org_id: ORG });
    db.insert("money_helper_threads", { client_id: "i-running", org_id: ORG, halted_at: null, halt_reason: null });
    db.insert("money_helper_threads", { client_id: "i-other", org_id: OTHER_ORG, halted_at: at(2), halt_reason: "stop" });
  },
  otherCompanyBad(db) {
    db.insert("money_helper_threads", { client_id: "i-other-bad", org_id: OTHER_ORG, halted_at: at(2), halt_reason: "stop" });
  },
});

// ───────────────────────── transfer events ─────────────────────────

function move(db, id, over = {}) {
  db.insert("money_transfers", { id, org_id: ORG, client_id: CLIENT, status: "settled", created_at: at(4), ...over });
}
let eventId = 0;
function line(db, transferId, type, over = {}) {
  eventId += 1;
  db.insert("money_transfer_events", {
    id: eventId, transfer_id: transferId, org_id: ORG, client_id: CLIENT, event_type: type, to_status: "approved", leg: null, ...over,
  });
}
function story(db, id, { status = "settled", skip = [], extra = [], createdAt = at(4) } = {}) {
  move(db, id, { status, created_at: createdAt });
  if (!skip.includes("approved")) line(db, id, "approved", { to_status: "approved" });
  line(db, id, "started", { to_status: "approved" });
  line(db, id, "authorized", { to_status: "authorized", leg: "debit" });
  line(db, id, "plaid_posted", { to_status: "submitted", leg: "debit" });
  line(db, id, "plaid_settled", { to_status: status, leg: "credit" });
  for (const [type, over] of extra) line(db, id, type, over);
}

suite("transfer events", {
  sqlOf: transferSql,
  bad: TRANSFER_BAD,
  tables: ["money_transfers", "money_transfer_events"],
  healthy(db) {
    story(db, "m-settled");
    // one story that uses every word the page has, so dropping any word from the list is seen
    story(db, "m-every-word", {
      status: "failed",
      extra: ["declined", "submitted", "credit_authorized", "credit_submitted", "cancelled", "date_passed", "failed",
        "provider_wait", "provider_not_enabled", "needs_bank_login", "account_removed"].map((type) => [type, { to_status: "failed" }]),
    });
    move(db, "m-fresh", { status: "approved" });
    line(db, "m-fresh", "approved", { to_status: "approved" });
    return 3;
  },
  breaks: {
    "a money move has no 'approved' line as the start of its story": (db) => story(db, "b-no-yes", { skip: ["approved"] }),
    "a line in a move's story is one the page has no words for": (db) => story(db, "b-no-words", { extra: [["brand_new_kind", { to_status: "settled" }]] }),
    "a bank line in a move's story does not say if it is the debit or the credit side": (db) => story(db, "b-no-side", { extra: [["plaid_returned", { to_status: "settled", leg: null }]] }),
    "a line in a move's story belongs to another company or client": (db) => story(db, "b-crossed", { extra: [["cancelled", { to_status: "settled", org_id: OTHER_ORG }]] }),
    "a move's current status never appears in its story": (db) => {
      // cancelled, but its story stops at the yes
      move(db, "b-lost-status", { status: "cancelled", created_at: at(3) });
      line(db, "b-lost-status", "approved", { to_status: "approved" });
    },
  },
  ignored(db) {
    story(db, "m-old", { skip: ["approved"], createdAt: at(200) });
    db.insert("money_transfers", { id: "m-other", org_id: OTHER_ORG, client_id: OTHER_CLIENT, status: "failed", created_at: at(3) });
  },
  otherCompanyBad(db) {
    db.insert("money_transfers", { id: "m-other-bad", org_id: OTHER_ORG, client_id: OTHER_CLIENT, status: "failed", created_at: at(3) });
  },
});

// ───────────────────────── C-suite tasks ─────────────────────────

function task(db, id, body, over = {}) {
  db.insert("tasks", {
    id, org_id: ORG, client_id: null, source_workflow: "ops-coo", body, assignee_role: "owner", created_at: at(10), ...over,
  });
}
function post(db, id, over = {}) {
  db.insert("hiring_job_postings", {
    id, org_id: ORG, channel: "linkedin", description: "Closer.\nMarker: hire-closer:packed:2026-10", status: "posted",
    external_id: "urn:li:jobPosting:1", posted_at: at(9), created_at: at(10), ...over,
  });
}

suite("C-suite tasks", {
  sqlOf: csuiteSql,
  bad: [...CSUITE_TASK_BAD, ...CSUITE_POST_BAD],
  tables: ["tasks", "hiring_job_postings"],
  healthy(db) {
    task(db, "t-hire", "hire-closer:packed:2026-10", { assignee_role: "sales_manager" });
    task(db, "t-diagnose", "diagnose:gaps:2026-10");
    task(db, "t-ads", "ads-review:2026-10");
    task(db, "t-fire-shape", "fire:staff-9");
    post(db, "p-posted");
    post(db, "p-draft", { status: "draft", external_id: null, posted_at: null });
    return 6;
  },
  breaks: {
    "a hire task is not on the sales manager's desk": (db) => task(db, "b-hire", "hire-closer:packed:2026-11", { assignee_role: "owner" }),
    "a team gaps or ad spend review is not on the owner's desk": (db) => task(db, "b-diag", "diagnose:gaps:2026-11", { assignee_role: "setter" }),
    "a company task is hung on a client file": (db) => task(db, "b-client", "ads-review:2026-11", { client_id: CLIENT }),
    "the same company task was written twice": (db) => {
      task(db, "b-twice-1", "diagnose:gaps:2026-09");
      task(db, "b-twice-2", "diagnose:gaps:2026-09");
      return 2;
    },
    "a task from the brain is not one of the kinds it writes": (db) => task(db, "b-kind", "mystery:2026-11"),
    "the closer job post failed": (db) => post(db, "b-failed", { status: "failed", external_id: null, posted_at: null }),
    "a closer job post is marked posted but has no outside id or no posted time": (db) => post(db, "b-no-id", { external_id: "" }),
  },
  ignored(db) {
    task(db, "i-other-source", "hire-closer:packed:2026-10", { source_workflow: "other-flow", assignee_role: "closer" });
    task(db, "i-old", "hire-closer:packed:2026-01", { created_at: at(300), assignee_role: "owner" });
    post(db, "i-fb", { channel: "facebook", status: "failed" });
    post(db, "i-other-text", { description: "A different posting", status: "failed" });
    post(db, "i-old-post", { status: "failed", created_at: at(300) });
  },
  otherCompanyBad(db) {
    task(db, "o-bad", "hire-closer:packed:2026-10", { org_id: OTHER_ORG, assignee_role: "owner", client_id: OTHER_CLIENT });
    post(db, "o-bad-post", { org_id: OTHER_ORG, status: "failed" });
  },
});
