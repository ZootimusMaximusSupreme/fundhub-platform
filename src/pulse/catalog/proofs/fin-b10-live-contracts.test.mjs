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
import { FIN_B10_LIVE_ROWS, FIN_B10_RESULT_CONTRACTS } from "./fin-b10-display-contracts.mjs";
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
    s.insert("brain_classification_reviews", {
      id: id(org, "review"), org_id: org, file_id: fileId, status: c.reviewStatus || status,
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

/* ── 4. Join call button ─────────────────────────────────────────────────── */
const JOIN_CONTROL = FIN_B10_RESULT_CONTRACTS[3].control;
function seedJoin(s, org, c = {}) {
  const uid = id(org, "uid");
  s.insert("bookings", {
    id: id(org, "booking"), org_id: org, source: c.source || "clickfunnels", provider_uid: uid,
    starts_at: ahead(c.hours ?? 48), status: c.status || "booked",
    meeting_url: "url" in c ? c.url : "https://meet.example.com/room-1",
    attendee_email: c.email || "buyer@acme.test",
  });
  if (c.taskUrl !== undefined) {
    s.insert("tasks", { id: id(org, "task"), org_id: org, body: uid, meeting_url: c.taskUrl });
  }
}
suite("Join call button", JOIN_CONTROL, ["bookings", "tasks"], seedJoin, [
  ["a booked call ahead with no link anywhere", { url: null }],
  ["a booked call ahead with a blank link", { url: "   " }],
  ["a booked call ahead whose link is not a web address", { url: "TBD" }],
  ["a booked call ahead with a blank link on its task too", { url: null, taskUrl: "" }],
  ["a call that began an hour ago with no link", { url: null, hours: -1 }],
  ["a rescheduled call with no link", { url: null, status: "rescheduled" }],
], { windowed: false });
test("Join call button: a link on the task alone is enough, and calls that are not real or not ahead are not judged", () => {
  const contract = contractFor(JOIN_CONTROL);
  const withStandIn = (fn) => { const s = makeStandIn(["bookings", "tasks"]); try { return fn(s); } finally { s.close(); } };
  // The link is on the closer's task, not the booking.
  withStandIn((s) => {
    seedJoin(s, ORG, { url: null, taskUrl: "https://meet.example.com/task-room" });
    assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 1, bad_count: 0 });
  });
  // Each of these has no link and is left out: cancelled, long over, far ahead, a test booking, a +tag, an example address, our own address.
  const left = [
    { status: "cancelled" }, { hours: -5 }, { hours: 24 * 60 }, { source: "sim" }, { source: "gauntlet" },
    { email: "tester+qa@acme.test" }, { email: "someone@example.com" }, { email: "team@fundhub.ai" },
  ];
  for (const change of left) {
    withStandIn((s) => {
      seedJoin(s, ORG, { url: null, ...change });
      assert.deepEqual(s.run(contract.sql, ORG), { sample_count: 0, bad_count: 0 }, JSON.stringify(change));
    });
  }
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

/* ── The five contracts are the right rows, written once, and each can fail ─ */
test("every contract is one exact map row, and the five SQL texts differ", () => {
  const MAP_DIR = path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
  const maps = new Map();
  assert.equal(FIN_B10_LIVE_ROWS.length, FIN_B10_RESULT_CONTRACTS.length);
  for (const [file, surface, control] of FIN_B10_LIVE_ROWS) {
    if (!maps.has(file)) maps.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
    const hits = maps.get(file).filter((r) => r.surface === surface && r.control === control);
    assert.equal(hits.length, 1, `${file} / ${surface} / ${control}`);
  }
  assert.equal(new Set(FIN_B10_RESULT_CONTRACTS.map((c) => c.sql)).size, 5);
  assert.equal(new Set(FIN_B10_RESULT_CONTRACTS.map((c) => c.control)).size, 5);
});
