// The funnel worker's door and its wake (build unit X4). No database, no network:
// the session check, the job id check and the wake are each stand-ins.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "../../netlify/functions/marketing-funnel-background.mjs";
import { wakeFunnelWorker, FUNNEL_WORKER_PATH } from "./funnel-transport.mjs";
import { JOB_KINDS, checkJobKinds } from "./job-kinds.mjs";
import { withPageToken, pageMarker, PUSH_ORDER } from "./funnel-push.mjs";

const JOB = "00000000-0000-4000-8000-0000000000b1";
const req = (body, auth = "Bearer t") => ({
  headers: { get: (k) => (k === "authorization" ? auth : null) },
  json: async () => body
});

describe("the background function's door", () => {
  test("no owner or admin session: a plain 404 and nothing runs", async () => {
    const ran = [];
    for (const who of [null, { staff: { role: "closer", org_id: "o" } }]) {
      const h = makeHandler({ database: {}, auth: async () => who, run: async (...a) => { ran.push(a); return { status: "done" }; } });
      const r = await h(req({ job_id: JOB }));
      assert.equal(r.status, 404);
    }
    assert.equal(ran.length, 0);
  });

  test("a bad job id is 400; a good one runs as the caller's company", async () => {
    const ran = [];
    const h = makeHandler({ database: { tag: "db" }, auth: async () => ({ staff: { role: "owner", org_id: "org-9" } }),
      run: async (db, opts) => { ran.push([db, opts]); return { status: "done", job_id: opts.jobId }; } });
    assert.equal((await h(req({ job_id: "nope" }))).status, 400);
    const r = await h(req({ job_id: JOB }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, status: "done", job_id: JOB });
    assert.deepEqual(ran[0][1], { jobId: JOB, orgId: "org-9" });
  });
});

describe("the wake", () => {
  test("one POST to our own deploy with the owner's session and the job id", async () => {
    const calls = [];
    const out = await wakeFunnelWorker({ jobId: JOB, token: "tok", env: { URL: "https://fundhub.ai/" },
      fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 202 }; } });
    assert.deepEqual(out, { ok: true, status: 202, reason: null });
    assert.equal(calls[0].url, `https://fundhub.ai${FUNNEL_WORKER_PATH}`);
    assert.equal(calls[0].init.headers.authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(calls[0].init.body), { job_id: JOB });
  });

  test("no address, no session, or no answer: says why, never throws", async () => {
    assert.match((await wakeFunnelWorker({ jobId: JOB, token: "t", env: {} })).reason, /own address/);
    assert.match((await wakeFunnelWorker({ jobId: JOB, token: null, env: { URL: "https://x" } })).reason, /no sign-in/);
    const down = await wakeFunnelWorker({ jobId: JOB, token: "t", env: { URL: "https://x" }, fetchImpl: async () => { throw new Error("boom"); } });
    assert.equal(down.ok, false);
    assert.match(down.reason, /boom/);
  });
});

describe("the job kinds and the push's small rules", () => {
  test("funnel and funnel_push are registered and load", async () => {
    assert.equal(JOB_KINDS.funnel.group, "writer");
    assert.equal(JOB_KINDS.funnel_push.group, "system");
    assert.deepEqual(await checkJobKinds({ funnel: JOB_KINDS.funnel, funnel_push: JOB_KINDS.funnel_push }), []);
  });

  test("the landing page is pushed last", () => {
    assert.deepEqual([...PUSH_ORDER], ["thank_you", "booking", "landing"]);
  });

  test("the page token goes in once, before the SDK tag", () => {
    const html = '<head>\n<script src="https://sdk.myclickfunnels.com/sdk.js" defer></script>\n</head>';
    const once = withPageToken(html, 'cfp_"x');
    assert.match(once, /<meta name="cf-page-token" content="cfp_&quot;x">\n<script src="https:\/\/sdk/);
    assert.equal(withPageToken(once, "cfp_y"), once, "never twice");
    assert.equal(withPageToken(html, null), html);
  });

  test("the marker names the funnel tag and our own page row", () => {
    const m = pageMarker({ tag: "fnl-blueprint" }, { role: "booking", id: "row-1" });
    assert.match(m, /fnl-blueprint/);
    assert.match(m, /booking row-1/);
  });
});
