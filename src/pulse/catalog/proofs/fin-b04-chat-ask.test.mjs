// Batch 04, practice test for two of the four chat widget modes, "Ask" (the AI
// answer) and "Knowledge" (Company Brain). Neither saves anything
// (api/chat/ask.mjs has no INSERT, UPDATE or emit), so a live check has nothing
// to read. The route is RUN here with its model and retrieval calls handed in
// (the route takes them as deps), so what is judged is what the route does with
// the question and with what comes back: who may ask, what is refused, which mode
// reaches which call, and what the staff member is shown. The wording of a real
// model's answer is not something a test can hold, and this does not pretend to.
// The other two modes (a note to a teammate, a text to a client) leave saved
// rows and are judged by the live check on the same rows.

import { test } from "node:test";
import assert from "node:assert/strict";

import handler from "../../../../api/chat/ask.mjs";

const STAFF = { id: "s-1", org_id: "org-1", role: "closer" };

function fakeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

function deps(overrides = {}) {
  const calls = { ask: [], retrieve: [], synthesize: [] };
  return {
    calls,
    deps: {
      db: {},
      env: { FAKE: "1" },
      fetchImpl: () => { throw new Error("no network in this test"); },
      requireAuth: async () => STAFF,
      answerStaffQuestion: async (input) => {
        calls.ask.push(input);
        return { text: "Open the Clients tab and press New Client.", thin: false, source: "claude", sources: [{ title: "Clients" }] };
      },
      retrieveChunks: async (_db, input) => {
        calls.retrieve.push(input);
        return { ok: true, chunks: [{ id: "c1", text: "Refund policy: thirty days." }] };
      },
      synthesizeAnswer: async (input) => {
        calls.synthesize.push(input);
        return { text: "Refunds are open for thirty days.", thin: false, source: "company-brain", citations: [{ id: "c1" }] };
      },
      ...overrides
    }
  };
}

const post = (body, d, method = "POST") => {
  const res = fakeRes();
  return handler({ method, body }, res, d).then(() => res);
};

test("Ask: a question reaches the help model once and its answer comes back as the answer", async () => {
  const { deps: d, calls } = deps();
  const res = await post({ mode: "system", question: "  How do I add a client?  " }, d);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, mode: "system", question: "How do I add a client?",
    answer: { text: "Open the Clients tab and press New Client.", thin: false, source: "claude" },
    sources: [{ title: "Clients" }]
  });
  assert.equal(calls.ask.length, 1);
  assert.equal(calls.ask[0].question, "How do I add a client?", "the model is asked the trimmed question");
  assert.equal(calls.retrieve.length, 0, "Ask never reads the company brain");
});

test("Ask is the default mode and 'howto' and 'help' are the same mode", async () => {
  for (const mode of [undefined, "howto", "help", "SYSTEM"]) {
    const { deps: d, calls } = deps();
    const res = await post({ ...(mode ? { mode } : {}), question: "Where is billing?" }, d);
    assert.equal(res.statusCode, 200, String(mode));
    assert.equal(res.body.mode, "system");
    assert.equal(calls.ask.length, 1);
  }
});

test("Ask keeps a thin answer marked thin, so the screen can say so", async () => {
  const { deps: d } = deps({ answerStaffQuestion: async () => ({ text: "I am not sure.", thin: true, source: "keyword", sources: [] }) });
  const res = await post({ question: "Anything?" }, d);
  assert.equal(res.body.answer.thin, true);
  assert.equal(res.body.answer.source, "keyword");
});

test("Knowledge: the question is retrieved for this company and this role, then answered from what was found", async () => {
  const { deps: d, calls } = deps();
  const res = await post({ mode: "knowledge", question: "What is our refund policy?", limit: 3 }, d);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true, mode: "knowledge", question: "What is our refund policy?",
    answer: { text: "Refunds are open for thirty days.", thin: false, source: "company-brain" },
    sources: [{ id: "c1" }]
  });
  assert.equal(calls.retrieve.length, 1);
  assert.equal(calls.retrieve[0].orgId, "org-1", "retrieval is for the caller's company");
  assert.equal(calls.retrieve[0].role, "closer", "retrieval is for the caller's role");
  assert.equal(calls.retrieve[0].query, "What is our refund policy?");
  assert.equal(calls.retrieve[0].limit, 3);
  assert.deepEqual(calls.synthesize[0].chunks, [{ id: "c1", text: "Refund policy: thirty days." }], "the answer is built from what was found");
  assert.equal(calls.ask.length, 0, "Knowledge never asks the help model");
});

test("Knowledge: 'brain' is the same mode, and the default limit is eight", async () => {
  const { deps: d, calls } = deps();
  const res = await post({ mode: "brain", question: "Hours?" }, d);
  assert.equal(res.body.mode, "knowledge");
  assert.equal(calls.retrieve[0].limit, 8);
});

test("Knowledge: a refused or failed retrieval is an error the screen can show, never an empty answer", async () => {
  const forbidden = deps({ retrieveChunks: async () => ({ ok: false, reason: "forbidden_role" }) });
  let res = await post({ mode: "knowledge", question: "Owner pay?" }, forbidden.deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "forbidden_role");
  assert.equal(forbidden.calls.synthesize.length, 0);

  const failed = deps({ retrieveChunks: async () => ({ ok: false, reason: "index_unavailable" }) });
  res = await post({ mode: "knowledge", question: "Hours?" }, failed.deps);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, "index_unavailable");
  assert.equal(failed.calls.synthesize.length, 0);
});

test("a question is required, and an essay is refused before any model is asked", async () => {
  const { deps: d, calls } = deps();
  for (const question of [undefined, "", "   "]) {
    const res = await post({ question }, d);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "question_required");
  }
  const long = await post({ question: "x".repeat(2001) }, d);
  assert.equal(long.statusCode, 400);
  assert.equal(long.body.error, "question_too_long");
  assert.equal(calls.ask.length + calls.retrieve.length, 0);
});

test("an unknown mode is refused and names the two real ones", async () => {
  const { deps: d } = deps();
  const res = await post({ mode: "dream", question: "Hi" }, d);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unknown_mode");
  assert.deepEqual(res.body.allowed, ["system", "knowledge"]);
});

test("only staff may ask, and only by POST, and a session with no company is refused", async () => {
  let res = await post({ question: "Hi" }, deps().deps, "GET");
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");

  for (const role of ["client", "affiliate", "partner", undefined]) {
    const noModel = deps({ requireAuth: async () => ({ ...STAFF, role }) });
    res = await post({ question: "Hi" }, noModel.deps);
    assert.equal(res.statusCode, 403, String(role));
    assert.equal(noModel.calls.ask.length, 0, `${role}: no model call`);
  }

  const noCompany = deps({ requireAuth: async () => ({ ...STAFF, org_id: null }) });
  res = await post({ question: "Hi" }, noCompany.deps);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");

  const refused = deps({ requireAuth: async (_req, r) => { r.status(401).json({ ok: false, error: "unauthorized" }); return null; } });
  res = await post({ question: "Hi" }, refused.deps);
  assert.equal(res.statusCode, 401, "the sign-in refusal stands");
  assert.equal(refused.calls.ask.length, 0);
});

test("a model that throws gives the screen an error, not a blank answer and not a 200", async () => {
  const { deps: d } = deps({ answerStaffQuestion: async () => { throw new Error("the model service is down"); } });
  const res = await post({ question: "Hi" }, d);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(typeof res.body.error, "string");
  assert.ok(res.body.error.length > 0);
  assert.equal("answer" in res.body, false, "no answer is shown when the model failed");
});
