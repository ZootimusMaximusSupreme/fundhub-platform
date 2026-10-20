import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyBlandSignature,
  normalizeBlandEvent,
  mapToCanonical,
  handleBlandWebhook
} from "./bland.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db mirroring commas.test.mjs conventions.
function fakeDb({ dedup = false, store = [], dispatch = { client_id: "client-test", org_id: "org-1" } } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) throw new Error("Bland must never default its company");
      if (/FROM outbound_calls oc/.test(sql)) return { rows: dispatch ? [dispatch] : [] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, orgId: params[0], clientId: params[4], name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "bland_whsec_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

// --- signature ---------------------------------------------------------------

test("verifyBlandSignature: accepts valid hex, accepts sha256= prefix, rejects tampered / empty / no-secret", () => {
  const raw = JSON.stringify({ call_id: "abc" });
  assert.equal(verifyBlandSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyBlandSignature(raw, "sha256=" + sign(raw), SECRET), true);
  assert.equal(verifyBlandSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyBlandSignature(raw, "", SECRET), false);
  assert.equal(verifyBlandSignature(raw, sign(raw), null), false); // no secret → closed
});

// --- normalize ---------------------------------------------------------------

test("normalizeBlandEvent: reads a representative completed-call payload", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_999",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 187.4,
    transferred_to: "+18554146048"
  });
  assert.equal(evt.callId, "call_999");
  assert.equal(evt.status, "completed");
  assert.equal(evt.isCompleted, true);
  assert.equal(evt.disposition, "human");
  assert.equal(evt.durationSec, 187); // rounded
  assert.equal(evt.transferred, true);
});

test("normalizeBlandEvent: in-progress call → isCompleted false", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_200",
    status: "in-progress",
    completed: false
  });
  assert.equal(evt.isCompleted, false);
  assert.equal(evt.transferred, false);
});

test("normalizeBlandEvent: completed flag alone (no status) → isCompleted true", () => {
  const evt = normalizeBlandEvent({ call_id: "call_300", completed: true, call_length: 60 });
  assert.equal(evt.isCompleted, true);
  assert.equal(evt.durationSec, 60);
});

test("normalizeBlandEvent: answered_by falls back to disposition, duration field wins over call_length", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_400",
    status: "ended",
    answered_by: "voicemail",
    duration: 45,
    call_length: 999 // should be ignored when duration is present
  });
  assert.equal(evt.disposition, "voicemail");
  assert.equal(evt.durationSec, 45);
});

// --- canonical mapping -------------------------------------------------------

test("mapToCanonical: completed call → [{name:'call.completed', payload}]", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_500",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 120,
    transferred_to: null
  });
  const canonical = mapToCanonical(evt);
  assert.equal(canonical.length, 1);
  const c = canonical[0];
  assert.equal(c.name, "call.completed");
  assert.equal(c.payload.callId, "call_500");
  assert.equal(c.payload.status, "completed");
  assert.equal(c.payload.disposition, "human");
  assert.equal(c.payload.outcome, "transferred"); // human → transferred
  assert.equal(c.payload.durationSec, 120);
  assert.equal(c.payload.transferred, false);
  assert.equal(c.payload.source, "bland");
});

test("mapToCanonical: outcome mapping — declined/no_answer/voicemail", () => {
  const mkEvt = (disposition) => normalizeBlandEvent({ call_id: "x", status: "completed", completed: true, disposition });
  assert.equal(mapToCanonical(mkEvt("declined"))[0].payload.outcome, "declined");
  assert.equal(mapToCanonical(mkEvt("no_answer"))[0].payload.outcome, "no_answer");
  assert.equal(mapToCanonical(mkEvt("voicemail"))[0].payload.outcome, "no_answer");
});

test("mapToCanonical: in-progress → empty array", () => {
  const evt = normalizeBlandEvent({ call_id: "x", status: "in-progress", completed: false });
  assert.deepEqual(mapToCanonical(evt), []);
});

// --- full adapter ------------------------------------------------------------

test("handleBlandWebhook: bad signature → 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ call_id: "c1", status: "completed", completed: true });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleBlandWebhook: completed call → call.completed emitted, handler fires", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("call.completed", (e) => seen.push(e.name));

  const raw = JSON.stringify({
    call_id: "call_601",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 200,
    transferred_to: "+18554146048"
  });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["call.completed"]);
  assert.deepEqual(seen, ["call.completed"]);
});

test("handleBlandWebhook: not_completed (in-progress) → 200, emitted=[], reason=not_completed", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ call_id: "call_700", status: "in-progress", completed: false });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "not_completed");
  assert.deepEqual(res.emitted, []);
});

test("handleBlandWebhook: explicit clientId agrees with the stored dispatch", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  // Intercept the INSERT INTO events call to capture client_id param
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) throw new Error("Bland must never default its company");
      if (/FROM outbound_calls oc/.test(sql)) return { rows: [{ client_id: "cl-42", org_id: "org-42" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ orgId: params[0], clientId: params[4], name: params[1] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({ call_id: "call_900", status: "completed", completed: true, disposition: "declined" });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET, clientId: "cl-42" });
  assert.equal(res.ok, true);
  assert.equal(store[0]?.clientId, "cl-42");
  assert.equal(store[0]?.orgId, "org-42");
});

test("handleBlandWebhook: resolves clientId from outbound_calls when none provided", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) throw new Error("Bland must never default its company");
      if (/FROM outbound_calls oc/.test(sql)) {
        // Simulate a prior recordDispatch for this callId
        if (params[0] === "call_lookup_test") return { rows: [{ client_id: "client-resolved-99", org_id: "partner-org" }] };
        return { rows: [] };
      }
      if (/INSERT INTO events/.test(sql)) {
        store.push({ orgId: params[0], clientId: params[4], name: params[1] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({ call_id: "call_lookup_test", status: "completed", completed: true, disposition: "human" });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  // No clientId passed in — must be resolved from outbound_calls
  assert.equal(res.ok, true);
  assert.equal(store[0]?.clientId, "client-resolved-99");
  assert.equal(store[0]?.orgId, "partner-org");
});

test("handleBlandWebhook: idempotent re-delivery → deduped=true, handler does not fire", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("call.completed", () => (fired += 1));

  const raw = JSON.stringify({ call_id: "call_800", status: "completed", completed: true });
  const db = fakeDb({ dedup: true });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on deduped replay");
});

test("handleBlandWebhook: transcripts for two companies keep their own stored company/client", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const seen = [];
  on("call.completed", (event) => seen.push({ orgId: event.orgId, clientId: event.clientId, transcript: event.payload.transcript }));
  for (const [orgId, clientId] of [["org-a", "client-a"], ["org-b", "client-b"]]) {
    const raw = JSON.stringify({ call_id: `call-${clientId}`, status: "completed", transcript: `private words for ${clientId}`,
      client_id: "attacker-client", org_id: "attacker-org" });
    const out = await handleBlandWebhook({ db: fakeDb({ store, dispatch: { org_id: orgId, client_id: clientId } }),
      rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(out.ok, true);
  }
  assert.deepEqual(seen, [
    { orgId: "org-a", clientId: "client-a", transcript: "private words for client-a" },
    { orgId: "org-b", clientId: "client-b", transcript: "private words for client-b" }
  ]);
  assert.deepEqual(store.map(({ orgId, clientId }) => [orgId, clientId]), [["org-a", "client-a"], ["org-b", "client-b"]]);
});

test("handleBlandWebhook: an unknown dispatch cannot persist a transcript under the default company", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const raw = JSON.stringify({ call_id: "unknown", status: "completed", transcript: "private words",
    client_id: "client-test", org_id: "org-1" });
  const out = await handleBlandWebhook({ db: fakeDb({ store, dispatch: null }),
    rawBody: raw, signatureHeader: sign(raw), secret: SECRET, clientId: "client-test" });
  assert.equal(out.ok, false);
  assert.equal(out.status, 409);
  assert.equal(out.reason, "call_dispatch_not_found");
  assert.deepEqual(store, []);
});

test("handleBlandWebhook: an explicit client cannot override the saved dispatch", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const raw = JSON.stringify({ call_id: "known", status: "completed", transcript: "private words" });
  const out = await handleBlandWebhook({ db: fakeDb({ store }), rawBody: raw,
    signatureHeader: sign(raw), secret: SECRET, clientId: "other-client" });
  assert.equal(out.reason, "call_attribution_mismatch");
  assert.deepEqual(store, []);
});

test("handleBlandWebhook: a late transcript enriches the scoped call once without another workflow event", async () => {
  _resetOrgCache(); clearHandlers();
  const events = new Set();
  const messages = [
    { id: "message-a", orgId: "org-a", clientId: "client-a", ref: "late-call", provider: "bland", channel: "voice", body: "human" },
    { id: "message-b", orgId: "org-b", clientId: "client-b", ref: "late-call", provider: "bland", channel: "voice", body: "private B" }
  ];
  let fired = 0;
  on("call.completed", () => { fired += 1; });
  const db = { query(sql, params) {
    if (/FROM orgs/.test(sql)) throw new Error("must not default company");
    if (/FROM outbound_calls oc/.test(sql)) return { rows: [{ org_id: "org-a", client_id: "client-a" }] };
    if (/INSERT INTO events/.test(sql)) {
      if (events.has(params[3])) return { rows: [] };
      events.add(params[3]);
      return { rows: [{ id: "event-one" }] };
    }
    if (/UPDATE messages SET rendered_body/.test(sql)) {
      assert.match(sql, /org_id = \$1 AND client_id = \$2 AND provider_ref = \$3/);
      assert.match(sql, /provider = 'bland' AND channel = 'voice'/);
      const row = messages.find((message) => message.orgId === params[0] && message.clientId === params[1]
        && message.ref === params[2] && message.provider === "bland" && message.channel === "voice" && message.body !== params[3]);
      if (row) row.body = params[3];
      return { rows: row ? [{ id: row.id }] : [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  for (const extra of [{}, { transcript: "Client: late private transcript", summary: "Useful summary" }, { transcript: "Client: late private transcript", summary: "Useful summary" }]) {
    const raw = JSON.stringify({ call_id: "late-call", status: "completed", ...extra });
    const out = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(out.ok, true);
  }
  assert.equal(events.size, 1);
  assert.equal(fired, 1);
  assert.equal(messages.length, 2);
  assert.match(messages[0].body, /late private transcript/);
  assert.match(messages[0].body, /Useful summary/);
  assert.equal(messages[1].body, "private B");
});
