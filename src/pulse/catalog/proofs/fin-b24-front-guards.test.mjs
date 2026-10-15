// Batch 24 (finish the 853), staff doors, the refusals that stand in front.
//
// Every staff door here reads or writes for the COMPANY of the person signed in.
// A sign-in that is not attached to a company must be turned away before any
// saved row is read, any vendor is asked, or anything is saved. A door that does
// work must also turn away a verb it does not serve before it does that work.
// The earlier batch 24 tests judged the results; this file judges the refusals
// that stand in front of them, one test per door, so deleting a refusal turns a
// test red.
//
// The real api/ handler, a stand-in database, and a trapped network. This is a
// PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import adintelBoard from "../../../../api/adintel/board.mjs";
import agentCall from "../../../../api/agent-call.mjs";
import clickfunnelsConnect from "../../../../api/analytics/clickfunnels-connect.mjs";
import clickfunnelsSync from "../../../../api/analytics/clickfunnels-sync.mjs";
import youtubeConnect from "../../../../api/analytics/youtube-connect.mjs";
import youtubeSync from "../../../../api/analytics/youtube-sync.mjs";
import chatMessages from "../../../../api/chat/messages.mjs";
import contentTiles from "../../../../api/content/tiles.mjs";
import welcomeVideo from "../../../../api/content/welcome-video.mjs";
import documentsDownload from "../../../../api/documents-download.mjs";
import inquiryHandler from "../../../../api/inquiry.mjs";
import journeysRun from "../../../../api/journeys/run.mjs";
import lenderObservations from "../../../../api/lender-observations.mjs";
import { hit } from "./s5-route-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const DOCUMENT = "d0000000-0000-4000-8000-000000000001";
const NO_COMPANY = { org_id: null };

// The network is trapped: a door that is refused must not ask a vendor anything.
const realFetch = globalThis.fetch;
const wire = [];
before(() => {
  globalThis.fetch = async (url) => {
    wire.push(String(url));
    throw new Error("the network is trapped in this test");
  };
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { wire.length = 0; });
const trappedFetch = async (url) => {
  wire.push(String(url));
  throw new Error("the network is trapped in this test");
};

// The only statements a refused door may run are the sign-in lookups that decide
// who is asking. Anything else is a saved row being read or written.
const SIGN_IN_LOOKUP = /^\s*WITH live AS|UPDATE account_sessions s|FROM accounts WHERE id = \$1/;
function assertNothingReadOrSaved(out, what) {
  const reached = out.db.calls.filter((call) => !SIGN_IN_LOOKUP.test(call.sql));
  assert.deepEqual(reached.map((call) => call.sql.replace(/\s+/g, " ").slice(0, 80)), [], `${what}: only the sign-in was looked up`);
  assert.deepEqual(wire, [], `${what}: no vendor was asked`);
}

test("agent-call refuses a login that names no company and asks nothing about any agent or client", async () => {
  const out = await hit(agentCall, { method: "POST", role: "closer", staff: NO_COMPANY, body: { action: "check", agent_code: "AG-04" } });
  assert.equal(out.status, 400);
  assert.equal(out.body.ok, false);
  assert.equal(out.body.placed, false);
  assert.equal(out.body.reason, "org_required");
  assertNothingReadOrSaved(out, "agent-call");
});

test("adintel/board refuses a login that names no company, for a staff sign-in and for a partner, and reads no board", async () => {
  const staffOut = await hit(adintelBoard, { staff: NO_COMPANY, query: { partner_id: PARTNER } });
  assert.equal(staffOut.status, 400);
  assert.equal(staffOut.body.error, "org_unresolved");
  assertNothingReadOrSaved(staffOut, "adintel/board staff");
  const partnerOut = await hit(adintelBoard, { account: { kind: "partner", partnerId: PARTNER, orgId: null } });
  assert.equal(partnerOut.status, 400);
  assert.equal(partnerOut.body.error, "org_unresolved");
  assertNothingReadOrSaved(partnerOut, "adintel/board partner");
});

test("clickfunnels-connect refuses a login that names no company before ClickFunnels is asked or anything is saved", async () => {
  const out = await hit(clickfunnelsConnect, { method: "POST", staff: NO_COMPANY, deps: { fetch: trappedFetch }, body: { api_key: "k-1", subdomain: "fundhub" } });
  assert.equal(out.status, 403);
  assert.equal(out.body.error, "forbidden");
  assertNothingReadOrSaved(out, "clickfunnels-connect");
});

test("clickfunnels-sync refuses a login that names no company before ClickFunnels is asked or any page is saved", async () => {
  const out = await hit(clickfunnelsSync, { method: "POST", staff: NO_COMPANY, deps: { fetch: trappedFetch }, body: {} });
  assert.equal(out.status, 403);
  assert.equal(out.body.error, "forbidden");
  assertNothingReadOrSaved(out, "clickfunnels-sync");
});

test("youtube-connect refuses a login that names no company before Google is asked or anything is saved", async () => {
  const out = await hit(youtubeConnect, {
    method: "POST", staff: NO_COMPANY, deps: { fetch: trappedFetch },
    body: { client_id: "client-1", client_secret: "secret-1", refresh_token: "refresh-1" },
  });
  assert.equal(out.status, 403);
  assert.equal(out.body.error, "forbidden");
  assertNothingReadOrSaved(out, "youtube-connect");
});

test("youtube-sync refuses a login that names no company before Google is asked or any snapshot is saved", async () => {
  const out = await hit(youtubeSync, { method: "POST", staff: NO_COMPANY, deps: { fetch: trappedFetch }, body: {} });
  assert.equal(out.status, 403);
  assert.equal(out.body.error, "forbidden");
  assertNothingReadOrSaved(out, "youtube-sync");
});

test("content/tiles refuses a login that names no company and reads no tile, price or video", async () => {
  const out = await hit(contentTiles, {});
  assert.equal(out.status, 200, "the same sign-in with a company is let in");
  const refused = await hit(contentTiles, { staff: NO_COMPANY });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "org_required");
  assertNothingReadOrSaved(refused, "content/tiles");
});

test("documents-download refuses a login that names no company and mints no link", async () => {
  const out = await hit(documentsDownload, { staff: NO_COMPANY, query: { id: DOCUMENT } });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, "org_required");
  assert.equal(out.body.url, undefined, "no signed link");
  assertNothingReadOrSaved(out, "documents-download");
});

test("content/welcome-video refuses a staff login that names no company and says nothing about the video", async () => {
  const out = await hit(welcomeVideo, { staff: NO_COMPANY });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, "org_required");
  assertNothingReadOrSaved(out, "content/welcome-video");
});

test("inquiry refuses a login that names no company and lists no case and no call", async () => {
  const cases = await hit(inquiryHandler, { role: "inquiry_specialist", staff: NO_COMPANY, query: { action: "cases" } });
  assert.equal(cases.status, 403);
  assert.equal(cases.body.error, "forbidden");
  assertNothingReadOrSaved(cases, "inquiry cases");
  const call = await hit(inquiryHandler, { role: "admin", staff: NO_COMPANY, query: { action: "status", call_id: "call-1" } });
  assert.equal(call.status, 403);
  assertNothingReadOrSaved(call, "inquiry status");
});

test("lender-observations refuses a login that names no company and saves no observation or review", async () => {
  const log = await hit(lenderObservations, { method: "POST", staff: NO_COMPANY, body: { action: "log", lender_name: "Chase", observed_bureau: "EQ" } });
  assert.equal(log.status, 403);
  assert.equal(log.body.error, "forbidden");
  assertNothingReadOrSaved(log, "lender-observations log");
  const review = await hit(lenderObservations, {
    method: "POST", staff: NO_COMPANY,
    body: { action: "review", id: "0b500000-0000-4000-8000-000000000001", review_status: "confirmed" },
  });
  assert.equal(review.status, 403);
  assertNothingReadOrSaved(review, "lender-observations review");
});

test("journeys/run refuses a login that names no company and walks no journey", async () => {
  const out = await hit(journeysRun, { method: "POST", staff: NO_COMPANY, body: {} });
  assert.equal(out.status, 403);
  assert.equal(out.body.error, "forbidden");
  assert.match(out.body.message, /no organisation/);
  assertNothingReadOrSaved(out, "journeys/run");
});

test("chat/messages refuses a login that names no company and lists or sends no message", async () => {
  const list = await hit(chatMessages, {});
  assert.notEqual(list.status, 403, "the same sign-in with a company is let in");
  const refused = await hit(chatMessages, { staff: NO_COMPANY });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "no_org_scope");
  assertNothingReadOrSaved(refused, "chat/messages list");
  const send = await hit(chatMessages, { method: "POST", staff: NO_COMPANY, body: { body: "hello" } });
  assert.equal(send.status, 403);
  assert.equal(send.body.error, "no_org_scope");
  assertNothingReadOrSaved(send, "chat/messages send");
});

/* ── the wrong verb: a door that does work answers nothing to a read ──────── */

test("clickfunnels-sync answers a read with 405 and asks ClickFunnels for nothing", async () => {
  const out = await hit(clickfunnelsSync, { method: "GET", deps: { fetch: trappedFetch } });
  assert.equal(out.status, 405);
  assert.equal(out.body.error, "method_not_allowed");
  assert.equal(out.headers.allow ?? out.headers.Allow, "POST");
  assertNothingReadOrSaved(out, "clickfunnels-sync GET");
});

test("youtube-connect answers a read with 405 and asks Google for nothing", async () => {
  const out = await hit(youtubeConnect, { method: "GET", deps: { fetch: trappedFetch } });
  assert.equal(out.status, 405);
  assert.equal(out.body.error, "method_not_allowed");
  assert.equal(out.headers.allow ?? out.headers.Allow, "POST");
  assertNothingReadOrSaved(out, "youtube-connect GET");
});

test("journeys/run answers a read with 405 and walks no journey", async () => {
  const out = await hit(journeysRun, { method: "GET" });
  assert.equal(out.status, 405);
  assert.equal(out.body.error, "method_not_allowed");
  assert.equal(out.headers.allow ?? out.headers.Allow, "POST");
  assertNothingReadOrSaved(out, "journeys/run GET");
});
