// /api/marketing/offer/generate and its background writer, end to end on a
// laptop: the real handler, the real auth (verifySession), the real store SQL —
// answered by an in-memory table (src/marketing/fixtures/offer-fake-db.mjs) — and
// the real callModel with a fake fetch. No Postgres, no network.
//
// The same endpoint against real Postgres is src/http/marketing-offer-generate.pg.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import handler from "../../api/marketing/offer/generate.mjs";
import { makeHandler } from "../../netlify/functions/marketing-offer-background.mjs";
import { runOfferJob } from "../marketing/offer-run.mjs";
import { askAnthropic } from "../marketing/offer-transport.mjs";
import { makeFakeDb } from "../marketing/fixtures/offer-fake-db.mjs";
import { anthropicMessage, CANDIDATES_TEXT, SYNTHESIS_TEXT, panelsText } from "../marketing/fixtures/offer-replies.mjs";
import { macAsk } from "../marketing/run-queue.mjs";
import { costOfCalls } from "../marketing/model-prices.mjs";

const ORG = randomUUID();
const OWNER = { id: randomUUID(), org_id: ORG, role: "owner", token: "tok-owner" };
const ADMIN = { id: randomUUID(), org_id: ORG, role: "admin", token: "tok-admin" };
const CLOSER = { id: randomUUID(), org_id: ORG, role: "closer", token: "tok-closer" };
const ENV = { ANTHROPIC_API_KEY: "test-key-not-real", URL: "https://fundhub.ai" };

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};
const req = (token, { method = "POST", body = {}, query = {} } = {}) => ({
  method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query
});

/* The wake does what Netlify does: accepts at once, and runs the writer. */
function wakeThatRuns(db, wakes) {
  const fetchImpl = async (url, init) => {
    const user = JSON.parse(init.body).messages[0].content;
    let text = SYNTHESIS_TEXT;
    if (user.startsWith("Design SIX offers")) text = CANDIDATES_TEXT;
    else if (user.startsWith("You are a panel of four judges")) {
      text = panelsText([...new Set([...user.matchAll(/"blindId":"(Offer [A-F])"/g)].map((m) => m[1]))]);
    }
    return { ok: true, status: 200, json: async () => anthropicMessage(text) };
  };
  const ask = (args) => askAnthropic({ ...args, env: ENV, fetchImpl });
  const worker = makeHandler({ database: db, run: (d, o) => runOfferJob(d, { ...o, ask }) });
  return async ({ jobId, token }) => {
    wakes.push({ jobId, token });
    const r = await worker(new Request("https://fundhub.ai/.netlify/functions/marketing-offer-background", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ job_id: jobId })
    }));
    return { ok: r.status === 200, status: 202, reason: null };
  };
}

async function call(db, token, opts = {}, deps = {}) {
  const r = res();
  await handler(req(token, opts), r, { db, env: ENV, ...deps });
  return r;
}

test("no session is 401; a closer is 403 — requireRole runs after requireAuth", async () => {
  const db = makeFakeDb({ staff: [OWNER, CLOSER] });
  assert.equal((await call(db, null)).code, 401);
  const closer = await call(db, CLOSER.token);
  assert.equal(closer.code, 403);
  assert.equal(closer.body.error, "forbidden");
  assert.equal((await call(db, CLOSER.token, { method: "GET" })).code, 403);
  assert.equal(db.jobs.length, 0);
});

test("other methods are refused", async () => {
  const r = await call(makeFakeDb({ staff: [OWNER] }), OWNER.token, { method: "DELETE" });
  assert.equal(r.code, 405);
  assert.equal(r.headers.allow, "GET, POST");
});

test("press Write offer: 202 at once, the writer runs, GET shows the offer", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const wakes = [];
  const post = await call(db, OWNER.token, { body: { avatar_summary: "AVATAR", ad_research_summary: "RESEARCH" } },
    { wake: wakeThatRuns(db, wakes) });
  assert.equal(post.code, 202, JSON.stringify(post.body));
  assert.equal(post.body.ok, true);
  assert.equal(post.body.started, true);
  assert.equal(post.body.job.status, "queued");
  assert.equal(post.body.job.campaign, "partner");
  assert.equal(post.body.poll, `/api/marketing/offer/generate?id=${post.body.job.id}`);
  assert.deepEqual(wakes, [{ jobId: post.body.job.id, token: OWNER.token }]);
  assert.equal(db.jobs[0].requested_by, OWNER.id);
  assert.match(db.jobs[0].payload.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(db.jobs[0].payload.sources.avatar, "supplied");

  const one = await call(db, OWNER.token, { method: "GET", query: { id: post.body.job.id } });
  assert.equal(one.code, 200);
  assert.equal(one.body.job.status, "done");
  assert.equal(one.body.offer.offer.name, "Live or We Keep Building");
  assert.equal(one.body.offer.review_card.sayOneOf, "approve · tweak: <what to change> · redo");
  assert.equal(one.body.offer.candidates.length, 6);

  const latest = await call(db, OWNER.token, { method: "GET" });
  assert.equal(latest.body.ready, true);
  assert.equal(latest.body.job.id, post.body.job.id);
  assert.equal(latest.body.offer.job_id, post.body.job.id);
});

test("a second press while one is being written returns that run, not a second paid one", async () => {
  const db = makeFakeDb({ staff: [OWNER, ADMIN] });
  const wakes = [];
  const lazyWake = async (w) => { wakes.push(w); return { ok: true, status: 202, reason: null }; };
  const first = await call(db, OWNER.token, { body: { avatar_summary: "A" } }, { wake: lazyWake });
  const second = await call(db, ADMIN.token, { body: { avatar_summary: "A" } }, { wake: lazyWake });
  assert.equal(second.code, 202);
  assert.equal(second.body.started, false);
  assert.equal(second.body.already_running, true);
  assert.equal(second.body.job.id, first.body.job.id);
  assert.equal(wakes.length, 1);
  assert.equal(db.jobs.length, 1);
});

test("a worker that cannot be woken fails the row with the reason — nothing left hanging", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const r = await call(db, OWNER.token, { body: { avatar_summary: "A" } },
    { wake: async () => ({ ok: false, status: null, reason: "this site does not know its own address (URL is not set)" }) });
  assert.equal(r.code, 502);
  assert.equal(r.body.error, "worker_unreachable");
  assert.equal(db.jobs[0].status, "failed");
  assert.match(db.jobs[0].error, /could not be started: this site does not know its own address/);
  // …and the next press starts fresh.
  const again = await call(db, OWNER.token, { body: { avatar_summary: "A" } }, { wake: async () => ({ ok: true }) });
  assert.equal(again.body.started, true);
});

test("no Anthropic key: nothing is saved and nothing is started", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  for (const env of [{ URL: "https://fundhub.ai" }, { ANTHROPIC_API_KEY: "****************1234" }]) {
    const r = res();
    await handler(req(OWNER.token, { body: { avatar_summary: "A" } }), r, { db, env, wake: async () => { throw new Error("must not wake"); } });
    assert.equal(r.code, 503);
    assert.equal(r.body.error, "no_model");
  }
  assert.equal(db.jobs.length, 0);
});

test("bad input is a 400 in words, before anything is saved", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const camp = await call(db, OWNER.token, { body: { campaign: "../../.env" } });
  assert.equal(camp.code, 400);
  assert.equal(camp.body.error, "bad_campaign");
  const none = await call(db, OWNER.token, { body: { campaign: "no-such-campaign" } });
  assert.equal(none.code, 400);
  assert.equal(none.body.error, "avatar_required");
  assert.equal((await call(db, OWNER.token, { method: "GET", query: { id: "not-a-uuid" } })).code, 400);
  assert.equal((await call(db, OWNER.token, { method: "GET", query: { id: randomUUID() } })).code, 404);
  assert.equal(db.jobs.length, 0);
});

test("with no body, the partner flywheel files are the inputs", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const r = await call(db, OWNER.token, { body: {} }, { wake: async () => ({ ok: true }) });
  assert.equal(r.code, 202);
  assert.deepEqual(db.jobs[0].payload.sources, {
    avatar: "marketing/flywheel/partner/01-avatar.md",
    adResearch: "marketing/flywheel/partner/02-ad-research.md",
    ownerNotes: "marketing/flywheel/partner/00-OWNER-NOTES.md"
  });
});

test("before the migration ships: GET says not live yet, POST is a 503 — never a 500", async () => {
  const db = makeFakeDb({ staff: [OWNER], missingTable: true });
  const get = await call(db, OWNER.token, { method: "GET" });
  assert.equal(get.code, 200);
  assert.equal(get.body.ready, false);
  assert.equal(get.body.offer, null);
  assert.match(get.body.message, /not live yet/);
  const post = await call(db, OWNER.token, { body: { avatar_summary: "A" } }, { wake: async () => ({ ok: true }) });
  assert.equal(post.code, 503);
  assert.equal(post.body.error, "not_ready");
});

test("the background writer refuses anyone but an owner or admin, and a bad job id", async () => {
  const db = makeFakeDb({ staff: [OWNER, CLOSER] });
  let ran = 0;
  const worker = makeHandler({ database: db, run: async () => { ran++; return { ok: true, status: "done" }; } });
  const post = (token, body) => worker(new Request("https://x.test/w", {
    method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body)
  }));
  assert.equal((await post(null, { job_id: randomUUID() })).status, 404);
  assert.equal((await post(CLOSER.token, { job_id: randomUUID() })).status, 404);
  assert.equal((await post(OWNER.token, { job_id: "nope" })).status, 400);
  assert.equal(ran, 0);
  const ok = await post(OWNER.token, { job_id: randomUUID() });
  assert.equal(ok.status, 200);
  assert.equal(ran, 1);
});

// ── MARKETING_AI_RUNNER=local: the Mac runs the offer (src/marketing/ai-runner.mjs) ──

test("local runner: Write offer saves the job, wakes nothing, and says it waits for the Mac", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const wakes = [];
  const r = res();
  await handler(req(OWNER.token, { body: { avatar_summary: "AVATAR", ad_research_summary: "RESEARCH" } }), r,
    { db, env: { ...ENV, MARKETING_AI_RUNNER: "local" }, wake: async (w) => { wakes.push(w); return { ok: true }; } });
  assert.equal(r.code, 202, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.started, false);
  assert.equal(r.body.waiting_for, "mac");
  assert.equal(r.body.message, "Saved. Waiting for your Mac to run it.");
  assert.equal(r.body.job.status, "queued");
  assert.deepEqual(wakes, []);
  assert.equal(db.jobs[0].status, "queued");
});

test("local runner: the offer background function runs nothing, even for the owner", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  let ran = 0;
  const worker = makeHandler({ database: db, env: { MARKETING_AI_RUNNER: "local" }, run: async () => { ran++; return { ok: true }; } });
  const r = await worker(new Request("https://x.test/w", {
    method: "POST", headers: { authorization: `Bearer ${OWNER.token}` }, body: JSON.stringify({ job_id: randomUUID() })
  }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).waiting_for, "mac");
  assert.equal(ran, 0);
});

test("the Mac writes the queued offer with Claude Code: same claim and save, model claude-code, cost $0", async () => {
  const db = makeFakeDb({ staff: [OWNER] });
  const r = res();
  await handler(req(OWNER.token, { body: { avatar_summary: "AVATAR", ad_research_summary: "RESEARCH" } }), r,
    { db, env: { ...ENV, MARKETING_AI_RUNNER: "local" } });
  const jobId = r.body.job.id;
  const asked = [];
  // Stands in for callModel({provider:'claude-code'}): the same replies the API tests use.
  const fakeCall = async (args) => {
    asked.push(args.provider);
    let text = SYNTHESIS_TEXT;
    if (args.user.startsWith("Design SIX offers")) text = CANDIDATES_TEXT;
    else if (args.user.startsWith("You are a panel of four judges")) {
      text = panelsText([...new Set([...args.user.matchAll(/"blindId":"(Offer [A-F])"/g)].map((m) => m[1]))]);
    }
    return { mode: "live", text, error: null, status: 200, stopReason: "end_turn", servedModel: "claude-code", usage: { input_tokens: 10, output_tokens: 20 } };
  };
  const out = await runOfferJob(db, { jobId, orgId: ORG, ask: macAsk(fakeCall), modelName: "claude-code" });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.ok(asked.length >= 3 && asked.every((p) => p === "claude-code"));
  const one = await call(db, OWNER.token, { method: "GET", query: { id: jobId } });
  assert.equal(one.body.job.status, "done");
  assert.equal(one.body.offer.model, "claude-code");
  assert.equal(one.body.offer.offer.name, "Live or We Keep Building");
  assert.ok(one.body.offer.usage.calls.every((c) => c.model === "claude-code"));
  assert.equal(costOfCalls(one.body.offer.usage.calls).cents, 0, "a real $0, never Opus prices");
});
