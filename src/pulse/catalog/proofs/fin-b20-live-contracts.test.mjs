// Finish-853 batch 20: runs the exact SQL text of each live check over stand-in rows that carry the
// real column names. Every case does four things: a right result is counted and none is wrong; no rows
// reads 0 of 0; one wrong row is counted as exactly the number expected; and the same SQL with the
// named clause switched off reads that wrong row clean (the "break it on purpose, see it red" step).
// Another company's wrong row is never counted.
// This file: the shape guard, staff photo, sessions, company brand and person-to-person chat threads.
// The sales-floor checks are in fin-b20-live-floor.test.mjs.

import assert from "node:assert/strict";
import test from "node:test";

import { schemaColumns, ago } from "./fin-b20-sql-kit.mjs";
import { AVATAR_SQL, SESSION_SQL, BRAND_SQL, CHAT_PEER_SQL } from "./fin-b20-sql.mjs";
import {
  FIN_B20_RESULT_CONTRACTS, FIN_B20_LIVE_CASES, FIN_B20_LIVE_TEST, FIN_B20_LIVE_FLOOR_TEST,
} from "./fin-b20-display-contracts.mjs";
import { FIN_B20_ROWS } from "./fin-b20-rows.mjs";
import { ORG, OTHER, S1, S2, S3, C1, id, run, without, loosen } from "./fin-b20-live-kit.mjs";

// ---------------------------------------------------------------------------------------------
test("the registry names 13 live rows, each with one exact map row and a runnable screen half", () => {
  assert.equal(FIN_B20_RESULT_CONTRACTS.length, 13);
  assert.equal(FIN_B20_LIVE_CASES.length, 13);
  assert.equal(new Set(FIN_B20_RESULT_CONTRACTS.map((c) => c.control)).size, 13);
  for (const c of FIN_B20_RESULT_CONTRACTS) {
    assert.equal(c.mode, "query");
    assert.equal(c.emptyAs, "quiet", `${c.control} must be quiet until the first wrong result`);
    assert.match(c.sql, /\$1::uuid/);
    assert.match(c.sql, /sample_count/);
    assert.match(c.sql, /bad_count/);
    assert.match(c.sql, /^\/\* display-result:fin-b20-/);
  }
  const rowControls = new Set(Object.values(FIN_B20_ROWS).map((r) => r[2]));
  for (const c of FIN_B20_RESULT_CONTRACTS) assert.ok(rowControls.has(c.control), `${c.control} is one of this batch's rows`);
  for (const k of FIN_B20_LIVE_CASES) {
    assert.ok(k.tests.includes(FIN_B20_LIVE_TEST) || k.tests.includes(FIN_B20_LIVE_FLOOR_TEST));
    assert.ok(k.tests.length >= 2, `${k.control} also names its screen half`);
    assert.ok(k.evidence.includes("gap-catalog-display.mjs"));
  }
});

test("every table and column the SQL texts name is a real one in db/schema and db/migrations", () => {
  const schema = schemaColumns();
  const checks = [
    ["staff", ["id", "org_id", "avatar_key", "is_demo"]],
    ["sessions", ["org_id", "created_at", "expires_at", "revoked_at", "last_seen_at"]],
    ["account_sessions", ["org_id", "created_at", "expires_at", "revoked_at", "last_seen_at"]],
    ["org_brand", ["org_id", "wordmark_url", "ink", "paper", "ramp"]],
    ["conversations", ["id", "org_id", "client_id", "kind", "internal_pair_key", "last_pulse_at", "created_at", "is_demo"]],
    ["conversation_participants", ["conversation_id", "staff_id"]],
    ["messages", ["conversation_id", "channel", "sender_kind", "sender_staff_id"]],
    ["call_outcomes", ["org_id", "client_id", "staff_id", "outcome", "belief_failed", "recording_url", "transcript", "booking_ref", "task_id", "logged_at", "is_demo"]],
    ["clients", ["id", "org_id"]],
    ["tasks", ["id", "org_id", "assignee_role", "title", "body", "due_at", "is_demo"]],
    ["brain_files", ["id", "org_id", "web_view_link", "client_id", "needs_transcription", "mime_type", "indexed_at", "created_at"]],
    ["brain_chunks", ["file_id"]],
  ];
  for (const [table, cols] of checks) {
    assert.ok(schema.has(table), `${table} exists`);
    for (const col of cols) assert.ok(schema.get(table).has(col), `${table}.${col} exists`);
  }
});

// ---------------------------------------------------------------------------------------------
// Staff photo
const avatarKey = (org, staff, tail = "9f2c.png") => `staff-avatars/${org}/${staff}/${tail}`;

test("avatar: a photo under the person's own folder is right, whatever handle the store gives back", () => {
  const seed = (s) => {
    s.insert("staff", { id: S1, org_id: ORG, avatar_key: avatarKey(ORG, S1) });
    s.insert("staff", { id: S2, org_id: ORG, avatar_key: `https://abc.public.blob.vercel-storage.com/${avatarKey(ORG, S2, "9f2c-Zx91.jpg")}` });
    s.insert("staff", { id: S3, org_id: ORG, avatar_key: `memory://${avatarKey(ORG, S3, "9f2c.jpeg")}` });
    s.insert("staff", { id: id("s"), org_id: ORG, avatar_key: null });
    s.insert("staff", { id: id("s"), org_id: ORG, avatar_key: "" });
  };
  assert.deepEqual(run(AVATAR_SQL, ["staff"], seed), { sample_count: 3, bad_count: 0 });
  assert.deepEqual(run(AVATAR_SQL, ["staff"], () => {}), { sample_count: 0, bad_count: 0 });
});

test("avatar: another person's folder, another company's folder and a non-image are each counted", () => {
  const seed = (s) => {
    s.insert("staff", { id: S1, org_id: ORG, avatar_key: avatarKey(ORG, S2) });           // another person's folder
    s.insert("staff", { id: S2, org_id: ORG, avatar_key: avatarKey(OTHER, S2) });         // another company's folder
    s.insert("staff", { id: S3, org_id: ORG, avatar_key: avatarKey(ORG, S3, "9f2c.gif") }); // not a png or jpeg
    s.insert("staff", { id: id("s"), org_id: ORG, avatar_key: avatarKey(ORG, "x", "a.png"), is_demo: true });
    s.insert("staff", { id: id("s"), org_id: OTHER, avatar_key: "elsewhere.gif" });         // other company
  };
  assert.deepEqual(run(AVATAR_SQL, ["staff"], seed), { sample_count: 3, bad_count: 3 });
  assert.equal(run(without(AVATAR_SQL, "s.avatar_key NOT LIKE '%staff-avatars/' || s.org_id::text || '/' || s.id::text || '/%'"), ["staff"], seed).bad_count, 1);
  const noExt = AVATAR_SQL.replace(/\(lower\(s\.avatar_key\) NOT LIKE '%\.png'[\s\S]*?'%\.jpeg'\)/, "1 = 0");
  assert.notEqual(noExt, AVATAR_SQL, "the extension clause was found");
  assert.equal(run(noExt, ["staff"], seed).bad_count, 2);
});

// ---------------------------------------------------------------------------------------------
// Sign out and the page-load session check
const live = (extra = {}) => ({
  id: id("ss"), org_id: ORG, created_at: ago(3), expires_at: ago(-5), last_seen_at: ago(0, 1), revoked_at: null, ...extra,
});

test("session: a live, a signed-out and an expired session that were last seen in time are right", () => {
  const seed = (s) => {
    s.insert("sessions", live());
    s.insert("sessions", live({ revoked_at: ago(1), last_seen_at: ago(1, 2) }));
    s.insert("sessions", live({ expires_at: ago(1), last_seen_at: ago(2) }));
    s.insert("account_sessions", { ...live(), account_id: id("a") });
    s.insert("sessions", live({ revoked_at: ago(1), last_seen_at: ago(1) }));
  };
  assert.deepEqual(run(SESSION_SQL, ["sessions", "account_sessions"], seed), { sample_count: 5, bad_count: 0 });
  assert.deepEqual(run(SESSION_SQL, ["sessions", "account_sessions"], () => {}), { sample_count: 0, bad_count: 0 });
});

test("session: seen after sign-out, seen after expiry and revoked before created are each counted", () => {
  const seed = (s) => {
    s.insert("sessions", live({ revoked_at: ago(2), last_seen_at: ago(1) }));              // used a day after sign-out
    s.insert("sessions", live({ expires_at: ago(2), last_seen_at: ago(1) }));              // used a day after expiry
    s.insert("account_sessions", { ...live({ revoked_at: ago(2), last_seen_at: ago(1) }), account_id: id("a") });
    s.insert("sessions", live({ created_at: ago(1), revoked_at: ago(2), last_seen_at: ago(3) })); // revoked before it began
    s.insert("sessions", live({ revoked_at: ago(1), last_seen_at: ago(1) }));              // good: same moment
    s.insert("sessions", { ...live({ revoked_at: ago(2), last_seen_at: ago(1) }), org_id: OTHER });
    s.insert("sessions", live({ created_at: ago(45), revoked_at: ago(44), last_seen_at: ago(40) })); // older than the window
  };
  const tables = ["sessions", "account_sessions"];
  assert.deepEqual(run(SESSION_SQL, tables, seed), { sample_count: 5, bad_count: 4 });
  assert.equal(run(without(SESSION_SQL, "EXTRACT(EPOCH FROM (r.last_seen_at - r.revoked_at)) > 300"), tables, seed).bad_count, 2);
  assert.equal(run(without(SESSION_SQL, "EXTRACT(EPOCH FROM (r.last_seen_at - r.expires_at)) > 300"), tables, seed).bad_count, 3);
  assert.equal(run(without(SESSION_SQL, "r.revoked_at < r.created_at"), tables, seed).bad_count, 3);
});

test("session: two minutes of slack after the moment of sign-out is not wrong, ten minutes is", () => {
  const near = (s) => s.insert("sessions", live({ revoked_at: ago(0, 1), last_seen_at: new Date(Date.now() - 58 * 60_000).toISOString() }));
  const far = (s) => s.insert("sessions", live({ revoked_at: ago(0, 1), last_seen_at: new Date(Date.now() - 50 * 60_000).toISOString() }));
  assert.equal(run(SESSION_SQL, ["sessions", "account_sessions"], near).bad_count, 0);
  assert.equal(run(SESSION_SQL, ["sessions", "account_sessions"], far).bad_count, 1);
});

// ---------------------------------------------------------------------------------------------
// Company brand
const ramp6 = ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"];

test("brand: an https wordmark, an image data address, no wordmark, ink unlike paper, no ramp or six are right", () => {
  const seed = (s) => {
    s.insert("org_brand", { id: id("b"), org_id: ORG, wordmark_url: "https://cdn.example.test/logo.svg", ink: "#0A0A0A", paper: "#FCFCFC", ramp: ramp6 });
  };
  assert.deepEqual(run(BRAND_SQL, ["org_brand"], seed), { sample_count: 1, bad_count: 0 });
  const data = (s) => s.insert("org_brand", { id: id("b"), org_id: ORG, wordmark_url: "data:image/png;base64,iVBORw0KGgo=", ink: null, paper: null, ramp: [] });
  assert.deepEqual(run(BRAND_SQL, ["org_brand"], data), { sample_count: 1, bad_count: 0 });
  const bare = (s) => s.insert("org_brand", { id: id("b"), org_id: ORG, wordmark_url: null, ramp: [] });
  assert.deepEqual(run(BRAND_SQL, ["org_brand"], bare), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(run(BRAND_SQL, ["org_brand"], () => {}), { sample_count: 0, bad_count: 0 });
});

test("brand: the wordmarks the shell refuses, ink equal to paper and a five-stop ramp are each counted", () => {
  const cases = [
    { wordmark_url: "http://cdn.example.test/logo.svg", why: "not https" },
    { wordmark_url: "https://cdn.example.test/my logo.svg", why: "a space" },
    { wordmark_url: "https://cdn.example.test/a\"b.svg", why: "a quote" },
    { wordmark_url: "https://cdn.example.test/a(1).svg", why: "a bracket" },
    { wordmark_url: "javascript:alert(1)", why: "script" },
    { wordmark_url: "https://cdn.example.test/ok.svg", ink: "#111111", paper: "#111111", why: "ink equals paper" },
    { wordmark_url: null, ramp: ramp6.slice(0, 5), why: "a five-stop ramp" },
  ];
  for (const c of cases) {
    const { why, ...fields } = c;
    const seed = (s) => s.insert("org_brand", { id: id("b"), org_id: ORG, ramp: ramp6, ...fields });
    assert.deepEqual(run(BRAND_SQL, ["org_brand"], seed), { sample_count: 1, bad_count: 1 }, why);
    const other = (s) => s.insert("org_brand", { id: id("b"), org_id: OTHER, ramp: ramp6, ...fields });
    assert.deepEqual(run(BRAND_SQL, ["org_brand"], other), { sample_count: 0, bad_count: 0 }, `another company: ${why}`);
  }
  // each clause is live: remove the wordmark clause and the refused wordmark reads clean
  const refused = (s) => s.insert("org_brand", { id: id("b"), org_id: ORG, wordmark_url: "http://x.example.test/a.svg", ramp: ramp6 });
  const head = BRAND_SQL.indexOf("(b.wordmark_url IS NOT NULL");
  const tail = BRAND_SQL.indexOf("OR (b.ink IS NOT NULL");
  const noWordmark = `${BRAND_SQL.slice(0, head)}1 = 0\n         ${BRAND_SQL.slice(tail)}`;
  assert.equal(run(noWordmark, ["org_brand"], refused).bad_count, 0);
  const same = (s) => s.insert("org_brand", { id: id("b"), org_id: ORG, ink: "#ABCDEF", paper: "#abcdef", ramp: ramp6 });
  assert.equal(run(BRAND_SQL, ["org_brand"], same).bad_count, 1, "ink and paper are compared without case");
  assert.equal(run(without(BRAND_SQL, "(b.ink IS NOT NULL AND b.paper IS NOT NULL AND lower(b.ink) = lower(b.paper))"), ["org_brand"], same).bad_count, 0);
});

// ---------------------------------------------------------------------------------------------
// Person-to-person chat threads
const thread = (s, { org = ORG, a = S1, b = S2, key = `${a}:${b}`, client = null, kind = "internal", parts = [a, b], cid = id("t") } = {}) => {
  s.insert("conversations", { id: cid, org_id: org, client_id: client, kind, channel: "internal", internal_pair_key: key, last_pulse_at: ago(1), created_at: ago(3) });
  for (const p of parts) s.insert("conversation_participants", { conversation_id: cid, staff_id: p });
  return cid;
};
const note = (s, cid, from, over = {}) => s.insert("messages", {
  id: id("m"), org_id: ORG, conversation_id: cid, channel: "internal", sender_kind: "staff", sender_staff_id: from, direction: "outbound", ...over,
});
const CHAT_TABLES = ["conversations", "conversation_participants", "messages", "staff"];
const staff2 = (s) => {
  s.insert("staff", { id: S1, org_id: ORG });
  s.insert("staff", { id: S2, org_id: ORG });
  s.insert("staff", { id: S3, org_id: ORG });
  s.insert("staff", { id: "bbbbbbbb-0000-4000-8000-000000000009", org_id: OTHER });
};

test("chat peers: a thread of two staff of this company, keyed by them, holding only their notes, is right", () => {
  const seed = (s) => {
    staff2(s);
    const t1 = thread(s);
    note(s, t1, S1); note(s, t1, S2);
    const t2 = thread(s, { a: S1, b: S3, key: `${S3}:${S1}` });   // the key may be written in either order
    note(s, t2, S3);
    thread(s, { a: S2, b: S3 });                                   // a thread with no note yet
    // a client conversation is not a person-to-person thread and is never judged here
    s.insert("conversations", { id: id("t"), org_id: ORG, client_id: C1, kind: "client", channel: "sms", last_pulse_at: ago(1), created_at: ago(3) });
  };
  assert.deepEqual(run(CHAT_PEER_SQL, CHAT_TABLES, seed), { sample_count: 3, bad_count: 0 });
  assert.equal(run(loosen(CHAT_PEER_SQL, "c.kind = 'internal'"), CHAT_TABLES, seed).sample_count, 4, "the kind filter is what leaves the client conversation out");
  assert.deepEqual(run(CHAT_PEER_SQL, CHAT_TABLES, () => {}), { sample_count: 0, bad_count: 0 });
});

test("chat peers: a client on the thread, three people, a stranger, a wrong key and a stray note are each counted", () => {
  const seed = (s) => {
    staff2(s);
    thread(s, { client: C1 });                                              // 1 a client on a person thread
    thread(s, { a: S1, b: S2, parts: [S1, S2, S3] });                       // 2 three people
    thread(s, { a: S1, b: "bbbbbbbb-0000-4000-8000-000000000009", key: `${S1}:bbbbbbbb-0000-4000-8000-000000000009`, parts: [S1, "bbbbbbbb-0000-4000-8000-000000000009"] }); // 3 a person of another company
    thread(s, { a: S1, b: S3, key: `${S1}:${S2}` });                        // 4 key names someone else
    thread(s, { a: S2, b: S3, key: null });                                 // 5 no key
    const stray = thread(s, { a: S1, b: S3 });                              // 6 a note from a non-participant
    note(s, stray, S2);
    const sms = thread(s, { a: S2, b: S1, key: `${S1}:${S2}` });            // 7 an sms note inside
    note(s, sms, S1, { channel: "sms" });
    const good = thread(s, { a: S3, b: S2 }); note(s, good, S3);
    thread(s, { org: OTHER, a: S1, b: S2, client: C1 });                     // another company
  };
  assert.deepEqual(run(CHAT_PEER_SQL, CHAT_TABLES, seed), { sample_count: 8, bad_count: 7 });
  assert.equal(run(without(CHAT_PEER_SQL, "c.client_id IS NOT NULL"), CHAT_TABLES, seed).bad_count, 6);
  assert.equal(run(without(CHAT_PEER_SQL, "COALESCE(p.n_parts, 0) <> 2"), CHAT_TABLES, seed).bad_count, 6);
  assert.equal(run(without(CHAT_PEER_SQL, "COALESCE(p.n_foreign, 0) > 0"), CHAT_TABLES, seed).bad_count, 6);
  assert.equal(run(without(CHAT_PEER_SQL, "c.internal_pair_key IS NULL"), CHAT_TABLES, seed).bad_count, 6, "a null key slips through NOT IN, so the IS NULL arm is what catches it");
});

