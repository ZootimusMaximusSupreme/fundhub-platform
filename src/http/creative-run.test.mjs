/* Database-free tests for POST /api/creative/run — how many jobs one press runs.
 *
 * The Command Center's Write ad copy button sends max_jobs: 1 (Command Center
 * design §6, slice 0). These tests prove the handler honours it: with three jobs
 * waiting, one press claims and runs exactly one. The real claim() and run()
 * against Postgres are covered by src/creative/generate.pg.test.mjs and
 * src/http/creative-endpoints.pg.test.mjs; here they are fakes that count calls.
 *
 * NO `.pg.` IN THE NAME, ON PURPOSE: npm test's glob is src/** and scripts/**.
 * Nothing here calls fetch or a model.
 */

import { test, describe } from "node:test";
import assert from "node:assert";

import handler, { maxJobsFrom, DEFAULT_MAX_JOBS, MAX_JOBS_CAP } from "../../api/creative/run.mjs";

const PARTNER = "33333333-4444-4555-8666-777777777777";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/* A queue of `waiting` jobs. claim() hands them out one at a time, oldest first,
   the way src/creative/generate.mjs claim() does. */
async function press(body, { waiting = 3 } = {}) {
  const queue = Array.from({ length: waiting }, (_, i) => ({ id: `job-${i + 1}` }));
  const claimed = [];
  const ran = [];
  const r = res();
  await handler({ method: "POST", headers: {}, query: {}, body }, r, {
    db: {},
    requirePrincipal: async () => ({ kind: "partner", partnerId: PARTNER }),
    withPartnerScope: async (_scope, fn) => fn({}),
    claim: async () => { const j = queue.shift() || null; if (j) claimed.push(j.id); return j; },
    run: async (_tx, job) => { ran.push(job.id); return { status: "succeeded", assets: [], cost_cents: 0 }; },
    runDue: async () => { throw new Error("runDue must not be called for one partner"); }
  });
  return { r, claimed, ran };
}

describe("creative/run — max_jobs", () => {
  test("max_jobs: 1 with three jobs waiting runs exactly one, the oldest", async () => {
    const { r, claimed, ran } = await press({ partner_id: PARTNER, max_jobs: 1 });
    assert.equal(r.code, 200);
    assert.deepEqual(claimed, ["job-1"]);
    assert.deepEqual(ran, ["job-1"]);
    assert.equal(r.body.ran, 1);
    assert.equal(r.body.jobs.length, 1);
  });

  test("no max_jobs keeps the old default of 3", async () => {
    const { claimed } = await press({ partner_id: PARTNER }, { waiting: 5 });
    assert.equal(claimed.length, DEFAULT_MAX_JOBS);
  });

  test("maxJobsFrom: a whole number 1 to 10 is used exactly; anything else is the default; over 10 is 10", () => {
    assert.equal(maxJobsFrom({ max_jobs: 1 }), 1);
    assert.equal(maxJobsFrom({ max_jobs: "1" }), 1);
    assert.equal(maxJobsFrom({ max_jobs: 7 }), 7);
    assert.equal(maxJobsFrom({ max_jobs: 50 }), MAX_JOBS_CAP);
    for (const bad of [undefined, null, 0, -2, 1.5, "two", true]) {
      assert.equal(maxJobsFrom({ max_jobs: bad }), DEFAULT_MAX_JOBS, String(bad));
    }
    assert.equal(maxJobsFrom(undefined), DEFAULT_MAX_JOBS);
  });

  test("GET is refused with 405 and nothing is claimed", async () => {
    const r = res();
    let claimed = 0;
    await handler({ method: "GET", headers: {}, query: {} }, r, {
      requirePrincipal: async () => ({ kind: "partner", partnerId: PARTNER }),
      claim: async () => { claimed += 1; return null; }
    });
    assert.equal(r.code, 405);
    assert.equal(claimed, 0);
  });
});

/* Quick copy's verdict on the route (unit X3, review X3-R2). The checker is the
   real one (src/marketing/quick-copy.mjs → scripts/ads/check-script.mjs strict);
   only claim() and run() are fakes, shaped as src/creative/generate.mjs run()
   answers: stored asset rows (RETURNING *, so copy_text is there) and the model
   the writer used. */
describe("creative/run — the checker's verdict on copy", () => {
  test("every copy asset carries check {ok, words}; a picture gets none; the job keeps its model", async () => {
    const r = res();
    await handler({ method: "POST", headers: {}, query: {}, body: { partner_id: PARTNER, max_jobs: 1 } }, r, {
      db: {},
      requirePrincipal: async () => ({ kind: "partner", partnerId: PARTNER }),
      withPartnerScope: async (_scope, fn) => fn({}),
      claim: (() => { let left = 1; return async () => (left-- > 0 ? { id: "job-copy" } : null); })(),
      run: async () => ({
        status: "succeeded",
        cost_cents: 0,
        model: "claude-sonnet-5-5",
        assets: [
          { id: "a1", kind: "copy", copy_text: "Two lenders read your business file before they read the personal one. See what they see first." },
          { id: "a2", kind: "copy", copy_text: "We leverage our lenders — and you get funded." },
          { id: "a3", kind: "image", copy_text: null }
        ]
      }),
      runDue: async () => { throw new Error("runDue must not be called for one partner"); }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const job = r.body.jobs[0];
    assert.equal(job.model, "claude-sonnet-5-5");
    const [clean, dirty, image] = job.assets;
    assert.equal(clean.check.ok, true);
    assert.equal(clean.check.words, "Checked against the ad rules: it passes.");
    assert.equal(dirty.check.ok, false);
    assert.match(dirty.check.words, /^Checked against the ad rules: \d+ problems?\. /);
    assert.ok(dirty.check.failures.some((f) => f.rule === "em-dash"));
    assert.equal(image.check, undefined);
  });
});
