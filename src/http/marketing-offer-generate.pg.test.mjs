// /api/marketing/offer/generate against real Postgres (DATABASE_URL), plus the
// rules migration 409 puts in the database itself. Lives under src/http/ because
// npm test only globs src/** and scripts/** (CLAUDE.md §12); it imports the api/
// handler directly.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips.
//
// No network: the wake is a fake, and the writer is the real runOfferJob with
// the real callModel underneath a fake fetch answering recorded Anthropic bodies.
//
// EVERYTHING THIS TEST WRITES is tagged so the purge finds it: staff emails start
// with EMAIL_TAG and every job's payload.campaign is CAMPAIGN_TAG.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/marketing/offer/generate.mjs";
import { runOfferJob } from "../marketing/offer-run.mjs";
import { askAnthropic } from "../marketing/offer-transport.mjs";
import { anthropicMessage, CANDIDATES_TEXT, SYNTHESIS_TEXT, panelsText } from "../marketing/fixtures/offer-replies.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "marketing_offer_pg_test";
const CAMPAIGN_TAG = "zz-test-offer";
const ENV = { ANTHROPIC_API_KEY: "test-key-not-real", URL: "https://example.test" };

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};
const req = (token, { method = "POST", body = {}, query = {} } = {}) => ({
  method, headers: token ? { authorization: "Bearer " + token } : {}, body, query
});

const recordedAsk = (args) => askAnthropic({
  ...args, env: ENV,
  fetchImpl: async (url, init) => {
    const user = JSON.parse(init.body).messages[0].content;
    let text = SYNTHESIS_TEXT;
    if (user.startsWith("Design SIX offers")) text = CANDIDATES_TEXT;
    else if (user.startsWith("You are a panel of four judges")) {
      text = panelsText([...new Set([...user.matchAll(/"blindId":"(Offer [A-F])"/g)].map((m) => m[1]))]);
    }
    return { ok: true, status: 200, json: async () => anthropicMessage(text) };
  }
});

describe("/api/marketing/offer/generate", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, owner, tokenOwner, tokenCloser;

  async function purge() {
    await db.query(`DELETE FROM marketing_jobs WHERE payload->>'campaign' = $1`, [CAMPAIGN_TAG]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  /* The partial unique index allows one offer in flight per company. Another
     test (or a real press on a scratch database) could hold that slot, so each
     test starts by closing this org's in-flight offers that this file made. */
  async function clearInFlight() {
    await db.query(
      `UPDATE marketing_jobs SET status = 'failed', error = 'closed by test', finished_at = now()
        WHERE org_id = $1 AND kind = 'offer' AND status IN ('queued','running') AND payload->>'campaign' = $2`,
      [org, CAMPAIGN_TAG]
    );
  }

  async function post(token, body = {}, deps = {}) {
    const r = res();
    await handler(req(token, { body: { campaign: CAMPAIGN_TAG, avatar_summary: "AVATAR", ...body } }), r,
      { db, env: ENV, wake: async () => ({ ok: true, status: 202, reason: null }), ...deps });
    return r;
  }
  async function get(token, query = {}) {
    const r = res();
    await handler(req(token, { method: "GET", query }), r, { db, env: ENV });
    return r;
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    owner = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,'Offer Owner Fixture','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.owner@example.com`]
    )).rows[0];
    tokenOwner = (await createSession(db, { staffId: owner.id, orgId: org })).token;
    const closer = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,'Offer Closer Fixture','closer','active') RETURNING id`,
      [org, `${EMAIL_TAG}.closer@example.com`]
    )).rows[0];
    tokenCloser = (await createSession(db, { staffId: closer.id, orgId: org })).token;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("401 without a session, 403 for a closer, and nothing is saved", async () => {
    await clearInFlight();
    const before = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE payload->>'campaign' = $1`, [CAMPAIGN_TAG])).rows[0].n;
    assert.equal((await post(null)).code, 401);
    const c = await post(tokenCloser);
    assert.equal(c.code, 403, JSON.stringify(c.body));
    const after = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE payload->>'campaign' = $1`, [CAMPAIGN_TAG])).rows[0].n;
    assert.equal(after, before);
  });

  test("POST saves a queued run; the writer finishes it; GET reads the offer back", async () => {
    await clearInFlight();
    const p = await post(tokenOwner);
    assert.equal(p.code, 202, JSON.stringify(p.body));
    assert.equal(p.body.started, true);
    const id = p.body.job.id;

    const row = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
    assert.equal(row.org_id, org);
    assert.equal(row.kind, "offer");
    assert.equal(row.status, "queued");
    assert.equal(row.requested_by, owner.id);
    assert.equal(row.payload.avatarSummary, "AVATAR");

    const run = await runOfferJob(db, { jobId: id, orgId: org, ask: recordedAsk });
    assert.deepEqual(run, { ok: true, status: "done" });

    const one = await get(tokenOwner, { id });
    assert.equal(one.code, 200);
    assert.equal(one.body.job.status, "done");
    assert.equal(one.body.offer.offer.name, "Live or We Keep Building");
    assert.equal(one.body.offer.review_card.threeThingsToCheck.length, 3);

    const latest = await get(tokenOwner);
    assert.equal(latest.body.ready, true);
    assert.ok(latest.body.offer, "the newest finished offer is returned");
  });

  test("a second press while one is in flight returns the same run", async () => {
    await clearInFlight();
    const a = await post(tokenOwner);
    const b = await post(tokenOwner);
    assert.equal(b.code, 202);
    assert.equal(b.body.already_running, true);
    assert.equal(b.body.job.id, a.body.job.id);
  });

  test("a worker that cannot be woken leaves the row failed, with the reason", async () => {
    await clearInFlight();
    const r = await post(tokenOwner, {}, { wake: async () => ({ ok: false, reason: "test: no address" }) });
    assert.equal(r.code, 502);
    const row = (await db.query(`SELECT status, error FROM marketing_jobs WHERE id = $1`, [r.body.job.id])).rows[0];
    assert.equal(row.status, "failed");
    assert.match(row.error, /test: no address/);
  });

  test("migration 409's rules hold in the database itself", async () => {
    await clearInFlight();
    const ins = (status) => db.query(
      `INSERT INTO marketing_jobs (org_id, kind, payload, status) VALUES ($1, 'offer', $2::jsonb, $3)`,
      [org, JSON.stringify({ campaign: CAMPAIGN_TAG }), status]
    );
    await assert.rejects(ins("failed"), /marketing_jobs_failed_reason_ck/);
    await assert.rejects(ins("done"), /marketing_jobs_done_result_ck/);
    await assert.rejects(ins("paused"), /marketing_jobs_status_ck/);
    await ins("queued");
    await assert.rejects(ins("running"), /marketing_jobs_one_offer_in_flight_uq/);
  });
});
