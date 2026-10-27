// Finish-853 batch 10: the five live display checks, run as the exact SQL text the lane runs.
//
// There is no Postgres on this Mac, so each contract's text is run on an in-memory database whose tables
// carry the REAL column names (fin-b10-sql-kit.mjs reads db/schema and db/migrations). Each check gets: the
// empty case (quiet), a good result (green), one wrong result per way it can be wrong (red), and another
// company's wrong result (not counted). A column the product does not have makes the test throw, so a typo
// cannot hide. This is a practice test: stand-in rows, not live data.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeStandIn, REPO_ROOT } from "./fin-b10-sql-kit.mjs";
import { FIN_B10_LIVE_ROWS, FIN_B10_OPEN_ROWS, FIN_B10_RESULT_CONTRACTS } from "./fin-b10-display-contracts.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const ago = (days) => stamp(Date.now() - days * 86400000);
const ahead = (hours) => stamp(Date.now() + hours * 3600000);
const id = (org, name) => `${name}-${org.slice(0, 4)}`;

function contractFor(control) {
  const hit = displaySavedResultContract({ control });
  assert.ok(hit, `no contract for: ${control}`);
  assert.equal(hit, FIN_B10_RESULT_CONTRACTS.find((c) => c.control === control), "the lane serves this batch's own contract");
  return hit;
}

/**
 * One scenario: seed(s, org, change) writes a GOOD result for a company. Each wrong[] entry says how to
 * make that one result wrong. `old` ages the result past the window.
 */
function suite(title, control, tables, seed, wrong, { windowed = true } = {}) {
  const contract = contractFor(control);
  const withStandIn = (fn) => {
    const s = makeStandIn(tables);
    try { return fn(s); } finally { s.close(); }
  };

  test(`${title}: the contract is read-only, quiet when empty, and names the company`, () => {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.match(contract.sql, /\$1::uuid/);
    assert.doesNotMatch(contract.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    withStandIn((s) => {
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
    });
    const verdict = judgeDisplayResult({ id: "x", control, surface: "s", contract }, { sample_count: 0, bad_count: 0 });
    assert.equal(verdict.status, "PASS");
    assert.match(verdict.detail, /no saved results yet/);
  });

  test(`${title}: a good saved result is counted and passes`, () => {
    withStandIn((s) => {
      seed(s, ORG);
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
      const verdict = judgeDisplayResult({ id: "x", control, surface: "s", contract }, { sample_count: 1, bad_count: 0 });
      assert.equal(verdict.status, "PASS");
    });
  });

  for (const [label, change] of wrong) {
    test(`${title}: ${label} goes red`, () => {
      withStandIn((s) => {
        seed(s, ORG, change);
        const got = s.run(contract.sql, ORG);
        assert.deepEqual(got, { sample_count: 1, bad_count: 1 }, label);
        const verdict = judgeDisplayResult({ id: "x", control, surface: "s", contract }, got);
        assert.equal(verdict.status, "FAIL");
      });
    });
  }

  test(`${title}: another company's wrong result is not counted`, () => {
    withStandIn((s) => {
      seed(s, ORG);
      seed(s, OTHER, wrong[0][1]);
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
      assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 1 });
    });
  });

  if (windowed) {
    test(`${title}: a result older than 60 days is not judged`, () => {
      withStandIn((s) => {
        seed(s, ORG, { ...wrong[0][1], old: true });
        assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
      });
    });
  }
}

/* ── 1. Funnel pages: Sync now ───────────────────────────────────────────── */
const FUNNEL_CONTROL = FIN_B10_RESULT_CONTRACTS[0].control;
function seedFunnel(s, org, c = {}) {
  const day = ago(c.old ? 90 : 0).slice(0, 10);
  const connOrg = c.otherCompanyConnection ? (org === ORG ? OTHER : ORG) : org;
  if (!c.noConnection) {
    s.insert("analytics_connections", { id: id(org, "conn"), org_id: connOrg, platform: c.platform || "clickfunnels", connection_state: "active" });
  }
  s.insert("funnel_page_stats", {
    id: id(org, "stat"), org_id: org, connection_id: id(org, "conn"),
    clickfunnels_funnel_id: "f1", clickfunnels_page_id: "p1", funnel_name: "Roadmap", page_name: "Sales page",
    stat_date: c.futureDate ? stamp(Date.parse(`${day}T00:00:00Z`) + 2 * 86400000).slice(0, 10) : day,
    views: "views" in c ? c.views : 120, conversions: "conversions" in c ? c.conversions : 12,
    captured_at: ago(c.old ? 90 : 0),
  });
}
suite("funnel page Sync now", FUNNEL_CONTROL, ["funnel_page_stats", "analytics_connections"], seedFunnel, [
  ["a page stat whose connection is missing", { noConnection: true }],
  ["a page stat saved against another company's connection", { otherCompanyConnection: true }],
  ["a page stat on a connection that is not ClickFunnels", { platform: "youtube" }],
  ["a negative view count", { views: -4 }],
  ["a negative conversion count", { conversions: -1 }],
  ["a stat dated after the day it was saved", { futureDate: true }],
]);
test("funnel page Sync now: unknown views and conversions (NULL) are not wrong", () => {
  const contract = contractFor(FUNNEL_CONTROL);
  const s = makeStandIn(["funnel_page_stats", "analytics_connections"]);
  try {
    seedFunnel(s, ORG, { views: null, conversions: null });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});

/* ── 2. Add a document ───────────────────────────────────────────────────── */
const UPLOAD_CONTROL = FIN_B10_RESULT_CONTRACTS[1].control;
function seedUpload(s, org, c = {}) {
  const status = c.status || "approved";
  const fileId = id(org, "file");
  s.insert("brain_files", {
    id: fileId, org_id: org, drive_file_id: c.driveId || `upload:${fileId}`, name: "name" in c ? c.name : "Funding plan.pdf",
    source: "upload", approval_status: status, access_tier: c.tier || "owner",
    size_bytes: "size" in c ? c.size : 2048, uploaded_by: "uploader" in c ? c.uploader : "staff-1",
    created_at: ago(c.old ? 90 : 1),
  });
  if (!c.noReview) {
    // The review can belong to a different file of the same company (reviewFile) or to a different company
    // that happens to name this file (reviewOrg). Either way it is NOT this file's review.
    s.insert("brain_classification_reviews", {
      id: id(org, "review"), org_id: c.reviewOrg || org, file_id: c.reviewFile || fileId, status: c.reviewStatus || status,
      decided_by: status === "pending" || c.undecided ? null : "owner-1", kind: "upload",
    });
  }
}
suite("add a document", UPLOAD_CONTROL, ["brain_files", "brain_classification_reviews"], seedUpload, [
  ["an approved upload with no review on file", { noReview: true }],
  ["an approved upload whose review nobody decided", { undecided: true }],
  ["an approved upload whose only review is still waiting", { reviewStatus: "pending", undecided: true }],
  ["a turned down upload that is not owner-only", { status: "rejected", tier: "sales" }],
  ["a turned down upload with no review", { status: "rejected", noReview: true }],
  ["a waiting upload with no review for the owner", { status: "pending", noReview: true }],
  ["an upload with no size", { size: null }],
  ["an upload with a zero size", { size: 0 }],
  ["an upload with no name", { name: "" }],
  ["an upload with a Drive id instead of an upload id", { driveId: "1AbCdEfGhIjKlMn" }],
  ["an upload nobody is named as adding", { uploader: null }],
  // The review must be the right review: its status, its decision, its file and its company are each held.
  ["an approved upload whose decided review says it was turned down", { reviewStatus: "rejected" }],
  ["an approved upload whose decided review still says waiting", { reviewStatus: "pending" }],
  ["a turned down upload whose review nobody decided", { status: "rejected", undecided: true }],
  ["a turned down upload whose decided review says approved", { status: "rejected", reviewStatus: "approved" }],
  ["a waiting upload whose only review was already approved", { status: "pending", reviewStatus: "approved" }],
  ["an approved upload whose only review belongs to another file", { reviewFile: "some-other-file" }],
  ["a turned down upload whose only review belongs to another file", { status: "rejected", reviewFile: "some-other-file" }],
  ["a waiting upload whose only review belongs to another file", { status: "pending", reviewFile: "some-other-file" }],
  ["an approved upload whose only review belongs to another company", { reviewOrg: "other-company" }],
  ["a turned down upload whose only review belongs to another company", { status: "rejected", reviewOrg: "other-company" }],
  ["a waiting upload whose only review belongs to another company", { status: "pending", reviewOrg: "other-company" }],
]);
test("add a document: a waiting upload with its review, and a turned down owner-only one, are not wrong", () => {
  const contract = contractFor(UPLOAD_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    seedUpload(s, ORG, { status: "pending" });
    seedUpload(s, OTHER, { status: "rejected" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 0 });
  } finally { s.close(); }
});
test("add a document: a Drive file is not judged here, only uploads", () => {
  const contract = contractFor(UPLOAD_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    s.insert("brain_files", { id: "drive-1", org_id: ORG, drive_file_id: "1AbCd", name: "", source: "drive", approval_status: "approved", created_at: ago(1) });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});

/* ── 3. 'N waiting' badges ───────────────────────────────────────────────── */
const WAITING_CONTROL = FIN_B10_RESULT_CONTRACTS[2].control;
function seedWaiting(s, org, c = {}) {
  const fileId = id(org, "file");
  s.insert("brain_files", {
    id: fileId, org_id: org, drive_file_id: `upload:${fileId}`, name: "Pending plan.pdf", source: "upload",
    approval_status: "pending", access_tier: "owner", size_bytes: 100, uploaded_by: "staff-1", created_at: ago(1),
  });
  if (!c.noReview) {
    s.insert("brain_classification_reviews", { id: id(org, "review"), org_id: org, file_id: fileId, status: c.reviewStatus || "pending", kind: "upload" });
  }
}
suite("N waiting badge", WAITING_CONTROL, ["brain_files", "brain_classification_reviews"], seedWaiting, [
  ["a waiting upload with no review at all", { noReview: true }],
  ["a waiting upload whose only review was already decided", { reviewStatus: "approved" }],
], { windowed: false });
test("N waiting badge: an approved upload is not counted, only the waiting ones", () => {
  const contract = contractFor(WAITING_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    seedUpload(s, ORG, { status: "approved" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});
// Every test above seeds one file, so each of these puts TWO files side by side. A review that belongs to the
// good file must not excuse the bad one, whether it sits in the same company or in another.
test("N waiting badge: one waiting upload with its review does not excuse a second one with none", () => {
  const contract = contractFor(WAITING_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    const wait = (n) => s.insert("brain_files", {
      id: `file-${n}`, org_id: ORG, drive_file_id: `upload:file-${n}`, name: `Plan ${n}.pdf`, source: "upload",
      approval_status: "pending", access_tier: "owner", size_bytes: 100, uploaded_by: "staff-1", created_at: ago(1),
    });
    wait(1);
    wait(2);
    s.insert("brain_classification_reviews", { id: "review-1", org_id: ORG, file_id: "file-1", status: "pending", kind: "upload" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 1 });
    // Give the second file its own review: both are fine.
    s.insert("brain_classification_reviews", { id: "review-2", org_id: ORG, file_id: "file-2", status: "pending", kind: "upload" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 0 });
  } finally { s.close(); }
});
test("N waiting badge: a pending review of another company that names this file does not count as its review", () => {
  const contract = contractFor(WAITING_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    s.insert("brain_files", {
      id: "file-1", org_id: ORG, drive_file_id: "upload:file-1", name: "Plan.pdf", source: "upload",
      approval_status: "pending", access_tier: "owner", size_bytes: 100, uploaded_by: "staff-1", created_at: ago(1),
    });
    s.insert("brain_classification_reviews", { id: "review-x", org_id: OTHER, file_id: "file-1", status: "pending", kind: "upload" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 });
  } finally { s.close(); }
});
test("N waiting badge: a waiting Drive file is not counted, because the badge counts uploads only", () => {
  const contract = contractFor(WAITING_CONTROL);
  const s = makeStandIn(["brain_files", "brain_classification_reviews"]);
  try {
    // A Drive file waiting with no review would be wrong if it were counted. It is not an upload.
    s.insert("brain_files", {
      id: "drive-1", org_id: ORG, drive_file_id: "1AbCd", name: "Synced.pdf", source: "drive",
      approval_status: "pending", access_tier: "owner", created_at: ago(1),
    });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
  } finally { s.close(); }
});

/* ── 4. Join call button ─────────────────────────────────────────────────── */
// The button opens the link on the exact current task (src/sales/cockpit.mjs join_url). A link on the
// booking or another call for the client does not turn it on.
const JOIN_CONTROL = FIN_B10_RESULT_CONTRACTS[3].control;
const GOOD_TASK = "https://meet.example.com/task-room";
function seedJoin(s, org, c = {}) {
  const client = `client-${org.slice(0, 4)}`;
  s.insert("bookings", {
    id: id(org, "booking"), org_id: org, client_id: "client" in c ? c.client : client, source: c.source || "clickfunnels",
    provider_uid: id(org, "uid"), starts_at: ahead(c.hours ?? 48), status: c.status || "booked",
    // The booking's own link is deliberately a good one unless a test says otherwise: it must not matter.
    meeting_url: "url" in c ? c.url : "https://meet.example.com/booking-room",
    attendee_email: c.email || "buyer@acme.test",
  });
  // The closer's task for this client: a good web link by default. noTask leaves the client with none.
  const tasks = c.noTask ? [] : (c.tasks || [{ url: "taskUrl" in c ? c.taskUrl : GOOD_TASK }]);
  tasks.forEach((t, n) => {
    s.insert("tasks", {
      id: `${id(org, "task")}-${n}`, org_id: t.org || org, client_id: "client" in t ? t.client : client,
      meeting_url: t.url, due_at: t.due || ahead(c.hours ?? 48),
    });
  });
}
suite("Join call button", JOIN_CONTROL, ["bookings", "tasks"], seedJoin, [
  ["a booked call ahead whose client has no task at all", { noTask: true }],
  ["a booked call ahead whose booking has a link but whose task has none", { url: "https://meet.example.com/booking-room", taskUrl: null }],
  ["a booked call ahead with a blank link on its task", { taskUrl: "" }],
  ["a booked call ahead with a spaces-only link on its task", { taskUrl: "   " }],
  ["a booked call ahead whose task link is not a web address", { taskUrl: "TBD" }],
  ["a call that began an hour ago with no task link", { hours: -1, taskUrl: null }],
  ["a rescheduled call with no task link", { status: "rescheduled", taskUrl: null }],
  ["a booked call with no client on it at all", { client: null, taskUrl: GOOD_TASK }],
  ["a booked call whose only linked task belongs to another client of the company", { tasks: [{ url: GOOD_TASK, client: "client-someone-else" }] }],
  ["a booked call whose only linked task is another company's task for the same client id", { tasks: [{ url: GOOD_TASK, org: "other-company" }] }],
  ["a booked call whose latest task link is not a web address, though an older one is", { tasks: [
    { url: GOOD_TASK, due: ago(5) },
    { url: "TBD", due: ahead(48) },
  ] }],
], { windowed: false });
test("Join call button: only the task at the exact booking time can turn it on", () => {
  const contract = contractFor(JOIN_CONTROL);
  const withStandIn = (fn) => { const s = makeStandIn(["bookings", "tasks"]); try { return fn(s); } finally { s.close(); } };
  // The link is on the closer's task for the client, and the booking has none: green.
  withStandIn((s) => {
    seedJoin(s, ORG, { url: null, taskUrl: GOOD_TASK });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  });
  // Another call has a good link, but the exact current task is blank: red.
  withStandIn((s) => {
    seedJoin(s, ORG, { url: null, tasks: [{ url: GOOD_TASK, due: ago(5) }, { url: "", due: ahead(48) }] });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 1 });
  });
  // The exact current task has a web link and another call is junk: green.
  withStandIn((s) => {
    seedJoin(s, ORG, { url: null, tasks: [{ url: "TBD", due: ago(5) }, { url: GOOD_TASK, due: ahead(48) }] });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  });
  // A web address in capitals or with spaces round it still counts.
  withStandIn((s) => {
    seedJoin(s, ORG, { url: null, taskUrl: "  HTTPS://Meet.Example.com/Room  " });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  });
  // Each of these has no link and is left out: cancelled, long over, far ahead, a test booking, a +tag, an example address, our own address.
  const left = [
    { status: "cancelled" }, { hours: -5 }, { hours: 24 * 60 }, { source: "sim" }, { source: "gauntlet" },
    { email: "tester+qa@acme.test" }, { email: "someone@example.com" }, { email: "team@fundhub.ai" },
  ];
  for (const change of left) {
    withStandIn((s) => {
      seedJoin(s, ORG, { url: null, taskUrl: null, ...change });
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 }, JSON.stringify(change));
    });
  }
});
test("Join call button: one call with a link and one without are counted apart, so one good call does not excuse the other", () => {
  const contract = contractFor(JOIN_CONTROL);
  const s = makeStandIn(["bookings", "tasks"]);
  try {
    // Two clients of the same company. Client A has a linked task, client B has none.
    for (const [n, taskUrl] of [["a", GOOD_TASK], ["b", null]]) {
      s.insert("bookings", {
        id: `booking-${n}`, org_id: ORG, client_id: `client-${n}`, source: "clickfunnels", provider_uid: `uid-${n}`,
        starts_at: ahead(24), status: "booked", meeting_url: null, attendee_email: `${n}@acme.test`,
      });
      s.insert("tasks", { id: `task-${n}`, org_id: ORG, client_id: `client-${n}`, meeting_url: taskUrl, due_at: ahead(24) });
    }
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 1 });
  } finally { s.close(); }
});

/* ── 5. Client picker ────────────────────────────────────────────────────── */
const PICKER_CONTROL = FIN_B10_RESULT_CONTRACTS[4].control;
function client(s, org, n, extra = {}) {
  s.insert("clients", {
    id: `client-${org.slice(0, 4)}-${n}`, org_id: org, first_name: "first_name" in extra ? extra.first_name : `First${n}`,
    last_name: "last_name" in extra ? extra.last_name : `Last${n}`, email: "email" in extra ? extra.email : `c${n}@acme.test`,
    is_demo: !!extra.demo, created_at: ago(0) .slice(0, 10) + " 00:" + String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0"),
  });
}
test("client picker: the picker is quiet with no clients, green when every client is reachable and named", () => {
  const contract = contractFor(PICKER_CONTROL);
  assert.equal(contract.emptyAs, "quiet");
  const s = makeStandIn(["clients"]);
  try {
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 });
    client(s, ORG, 1);
    client(s, ORG, 2, { first_name: "", last_name: "", email: "only.email@acme.test" });
    client(s, ORG, 3, { email: null });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 3, bad_count: 0 });
  } finally { s.close(); }
});
test("client picker: a client with no name and no email goes red, because the picker would show a bare id", () => {
  const contract = contractFor(PICKER_CONTROL);
  const s = makeStandIn(["clients"]);
  try {
    client(s, ORG, 1);
    client(s, ORG, 2, { first_name: null, last_name: " ", email: "" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 2, bad_count: 1 });
    const verdict = judgeDisplayResult({ id: "x", control: PICKER_CONTROL, surface: "s", contract }, { sample_count: 2, bad_count: 1 });
    assert.equal(verdict.status, "FAIL");
  } finally { s.close(); }
});
test("client picker: the 201st newest client and every one after it cannot be picked, so they go red", () => {
  const contract = contractFor(PICKER_CONTROL);
  const s = makeStandIn(["clients"]);
  try {
    // 200 clients: the whole book is reachable.
    for (let n = 1; n <= 200; n += 1) client(s, ORG, n);
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 200, bad_count: 0 });
    // Five more, older than the rest: the picker's newest-200 list cuts them off.
    for (let n = 201; n <= 205; n += 1) {
      s.insert("clients", { id: `old-${n}`, org_id: ORG, first_name: "Old", last_name: String(n), email: `old${n}@acme.test`, is_demo: false, created_at: `2020-01-01 00:00:${String(n - 200).padStart(2, "0")}` });
    }
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 205, bad_count: 5 });
  } finally { s.close(); }
});
test("client picker: the cut is the newest 200, so a nameless new client and five old ones are six different problems", () => {
  const contract = contractFor(PICKER_CONTROL);
  const s = makeStandIn(["clients"]);
  try {
    for (let n = 1; n <= 199; n += 1) client(s, ORG, n);
    // The newest client has no name and no email: inside the newest 200, and unnameable.
    s.insert("clients", { id: "newest-blank", org_id: ORG, first_name: "", last_name: "", email: "", is_demo: false, created_at: "2099-01-01 00:00:00" });
    // Five old clients, cut off by the picker.
    for (let n = 1; n <= 5; n += 1) {
      s.insert("clients", { id: `old-${n}`, org_id: ORG, first_name: "Old", last_name: String(n), email: `old${n}@acme.test`, is_demo: false, created_at: `2020-01-01 00:00:0${n}` });
    }
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 205, bad_count: 6 });
  } finally { s.close(); }
});
test("client picker: demo clients and another company's clients are not counted", () => {
  const contract = contractFor(PICKER_CONTROL);
  const s = makeStandIn(["clients"]);
  try {
    client(s, ORG, 1);
    client(s, ORG, 2, { demo: true, first_name: "", last_name: "", email: "" });
    client(s, OTHER, 1, { first_name: "", last_name: "", email: "" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(s.run(contract.sql, OTHER), { sample_count: 1, bad_count: 1 });
  } finally { s.close(); }
});

/* ── The contracts are the right rows, written once, and each can fail ─ */
test("every contract is one exact map row, and the five SQL texts differ", () => {
  const MAP_DIR = path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
  const maps = new Map();
  // Seven live rows (five saved results, two link gates) and the one row held open with its reason.
  assert.equal(FIN_B10_LIVE_ROWS.length + FIN_B10_OPEN_ROWS.length, FIN_B10_RESULT_CONTRACTS.length);
  for (const [file, surface, control] of [...FIN_B10_LIVE_ROWS, ...FIN_B10_OPEN_ROWS]) {
    if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
    const hits = maps.get(file).filter((r) => r.surface === surface && r.control === control);
    assert.equal(hits.length, 1, `${file} / ${surface} / ${control}`);
  }
  const queries = FIN_B10_RESULT_CONTRACTS.filter((c) => c.mode === "query");
  assert.equal(queries.length, 5);
  assert.equal(new Set(queries.map((c) => c.sql)).size, 5);
  assert.equal(new Set(FIN_B10_RESULT_CONTRACTS.map((c) => c.control)).size, FIN_B10_RESULT_CONTRACTS.length);
});
