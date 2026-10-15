// Batch 24 (finish the 853), the Creative Factory doors that start and run
// generation jobs.
//
// The real api/ handlers and the real partner-scope wrapper, a stand-in
// database that keeps its own jobs, and no vendor. creative/run takes its claim
// and run steps through the handler's own dependency seam, so no creative
// provider is ever called. This is a PRACTICE TEST with fake data. It is not a
// live check.

import assert from "node:assert/strict";
import test from "node:test";

import creativeGenerate from "../../../../api/creative/generate.mjs";
import creativeRun, { DEFAULT_MAX_JOBS, MAX_JOBS_CAP, maxJobsFrom } from "../../../../api/creative/run.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const KIT = "bb000000-0000-4000-8000-000000000001";
const SCRIPT = "a5000000-0000-4000-8000-000000000001";
const STAFF_ID = "5a000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "ac000000-0000-4000-8000-000000000001";

/* ── creative/generate: enqueue one job, at most once per idempotency key ── */

function generateWorld({ enabled = true, partnerKnown = true, provider = { provider_key: "copy", config: {} }, providerError = null, existing = null, blindFirstRead = false } = {}) {
  const world = { jobs: existing ? [existing] : [], inserts: [], reads: 0 };
  world.rules = [
    [/SELECT org_id FROM partners WHERE id = \$1/, (_sql, p) => (partnerKnown && p[0] === PARTNER ? [{ org_id: ORG_ID }] : [])],
    [/FROM partner_module_settings\s+WHERE partner_id = \$1/, (_sql, p) => (p[0] === PARTNER ? [{ marketing_suite_enabled: enabled, ai_token_cap_monthly: 1000, org_id: ORG_ID }] : [])],
    [/SELECT \* FROM generation_jobs WHERE partner_id = \$1 AND idempotency_key = \$2/, (_sql, p) => {
      world.reads += 1;
      // A race: the first read does not see the job another press has just saved.
      if (blindFirstRead && world.reads === 1) return [];
      return world.jobs.filter((j) => j.partner_id === p[0] && j.idempotency_key === p[1]);
    }],
    [/INSERT INTO generation_jobs/, (sql, p) => {
      const clash = world.jobs.find((j) => j.partner_id === p[1] && j.idempotency_key === p[8]);
      if (clash && /ON CONFLICT \(partner_id, idempotency_key\) DO NOTHING/.test(sql)) return [];
      const row = {
        id: `3b000000-0000-4000-8000-${String(world.jobs.length + 1).padStart(12, "0")}`, org_id: p[0], partner_id: p[1], brand_kit_id: p[2],
        requested_by_kind: p[3], requested_by_staff_id: p[4], requested_by_account_id: p[5], spec: JSON.parse(p[6]), status: "queued", idempotency_key: p[8],
      };
      world.jobs.push(row);
      world.inserts.push(row);
      return [row];
    }],
    [/FROM creative_providers\s+WHERE org_id = \$1 AND asset_kind = \$2 AND active/, () => {
      if (providerError) return providerError;
      return provider ? [provider] : [];
    }],
  ];
  return world;
}
const asPartner = { account: { kind: "partner", partnerId: PARTNER } };
const GOOD = { asset_kind: "copy", idempotency_key: "press-1", prompt: "Write three hooks", offer_type: "funding", brand_kit_id: KIT, script_id: SCRIPT };

test("creative/generate saves one queued job for the partner on the login, with who asked and what to make, and says whether anything is switched on to run it", async () => {
  assert.equal(ROUTES["creative/generate"], creativeGenerate);
  const world = generateWorld();
  const done = await hit(creativeGenerate, { ...asPartner, method: "POST", body: { ...GOOD, partner_id: OTHER_PARTNER }, rules: world.rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.equal(done.body.created, true);
  assert.equal(done.body.provider_ready, true);
  assert.match(done.body.note, /Saved to the queue/);
  assert.equal(world.inserts.length, 1);
  const [row] = world.inserts;
  assert.equal(row.partner_id, PARTNER, "the partner_id in the body is ignored for a partner login");
  assert.equal(row.org_id, ORG_ID);
  assert.equal(row.brand_kit_id, KIT);
  assert.equal(row.requested_by_kind, "partner");
  assert.equal(row.requested_by_account_id, ACCOUNT_ID);
  assert.equal(row.requested_by_staff_id, null);
  assert.equal(row.idempotency_key, "press-1");
  assert.deepEqual(row.spec, { prompt: "Write three hooks", formats: ["1x1"], variants: 1, offerType: "funding", scriptId: SCRIPT, assetKind: "copy" });
  assert.equal(done.body.job.id, row.id);
  assert.deepEqual(sqlCalls(done, /FROM creative_providers/)[0].params, [ORG_ID, "copy"]);
  assert.match(sqlCalls(done, /INSERT INTO generation_jobs/)[0].sql, /'queued'/, "a new job starts queued");

  // A person at Fundhub names the partner; the job records the staff member who asked.
  const staffWorld = generateWorld();
  const staff = await hit(creativeGenerate, { method: "POST", role: "admin", body: { ...GOOD, partner_id: PARTNER }, rules: staffWorld.rules });
  assert.equal(staff.status, 200);
  assert.equal(staffWorld.inserts[0].requested_by_kind, "staff");
  assert.equal(staffWorld.inserts[0].requested_by_staff_id, STAFF_ID);
  assert.equal(staffWorld.inserts[0].requested_by_account_id, null);
  const unnamed = await hit(creativeGenerate, { method: "POST", body: GOOD, rules: staffWorld.rules });
  assert.equal(unnamed.status, 400);
  assert.equal(unnamed.body.error, "partner_id_required");
});

test("creative/generate answers a repeat of the same key with the first job and no second row, so a double click is never a second bill", async () => {
  const world = generateWorld();
  const first = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: world.rules });
  const again = await hit(creativeGenerate, { ...asPartner, method: "POST", body: { ...GOOD, prompt: "different words" }, rules: world.rules });
  assert.equal(first.body.created, true);
  assert.equal(again.body.created, false);
  assert.equal(again.body.job.id, first.body.job.id);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.jobs.length, 1);
  // A race that loses the unique index still comes back as the earlier job, and writes nothing.
  const raced = generateWorld({ blindFirstRead: true, existing: { id: "3b000000-0000-4000-8000-0000000000aa", partner_id: PARTNER, idempotency_key: "press-1", spec: {}, status: "running" } });
  const lost = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: raced.rules });
  assert.equal(lost.body.created, false);
  assert.equal(lost.body.job.id, "3b000000-0000-4000-8000-0000000000aa");
  assert.equal(raced.inserts.length, 0, "the unique key stops the second row");
  assert.equal(raced.jobs.length, 1);
});

test("creative/generate saves nothing when the key, the offer, the script or the partner is wrong, or the suite is off for this partner", async () => {
  const cases = [
    [{ ...GOOD, idempotency_key: undefined }, 400, "idempotency_key_required"],
    [{ ...GOOD, offer_type: undefined }, 400, "offer_type_required"],
    [{ ...GOOD, offer_type: "lottery" }, 400, "offer_type_invalid"],
    [{ ...GOOD, script_id: "not-a-uuid" }, 400, "script_id_invalid"],
  ];
  for (const [body, status, error] of cases) {
    const world = generateWorld();
    const out = await hit(creativeGenerate, { ...asPartner, method: "POST", body, rules: world.rules });
    assert.equal(out.status, status, error);
    assert.equal(out.body.error, error);
    assert.equal(world.inserts.length, 0, error);
  }
  const off = generateWorld({ enabled: false });
  const refused = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: off.rules });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "suite_off");
  assert.equal(off.inserts.length, 0);

  const unknown = generateWorld({ partnerKnown: false });
  const missing = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: unknown.rules });
  assert.equal(missing.status, 404);
  assert.equal(unknown.inserts.length, 0);

  for (const kind of ["client", "affiliate"]) {
    const world = generateWorld();
    const out = await hit(creativeGenerate, { account: { kind, clientId: kind === "client" ? SCRIPT : null }, method: "POST", body: { ...GOOD, partner_id: PARTNER }, rules: world.rules });
    assert.equal(out.status, 403, `a ${kind} login is refused`);
    assert.equal(world.inserts.length, 0);
  }
  const get = await hit(creativeGenerate, { ...asPartner, method: "GET", rules: [] });
  assert.equal(get.status, 405);
});

test("creative/generate tells the screen plainly when no ad-making service is switched on, when the one on file is unknown, and when it could not check; the job is saved either way", async () => {
  const none = generateWorld({ provider: null });
  const noService = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: none.rules });
  assert.equal(noService.status, 200);
  assert.equal(noService.body.provider_ready, false);
  assert.match(noService.body.note, /no ad-making service is switched on/);
  assert.equal(none.inserts.length, 1, "saved to the queue all the same");

  const unknown = generateWorld({ provider: { provider_key: "mystery-vendor", config: {} } });
  const odd = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: unknown.rules });
  assert.equal(odd.body.provider_ready, false);
  assert.match(odd.body.note, /one this system does not know how to use/);

  const broken = generateWorld({ providerError: new Error("connection dropped") });
  const unsure = await hit(creativeGenerate, { ...asPartner, method: "POST", body: GOOD, rules: broken.rules });
  assert.equal(unsure.status, 200);
  assert.equal(unsure.body.provider_ready, null, "not known is not the same as not ready");
  assert.match(unsure.body.note, /could not check/);
  assert.equal(broken.inserts.length, 1);
});

/* ── creative/run: claim and run queued jobs ─────────────────────────────── */

function runHarness({ jobs = [], runnerLocal = false, waiting = 0 } = {}) {
  const calls = { claim: [], run: [], runDue: [], scope: [] };
  const queue = [...jobs];
  const deps = {
    env: runnerLocal ? { MARKETING_AI_RUNNER: "local" } : {},
    withPartnerScope: async (scope, fn) => {
      calls.scope.push(scope);
      return fn({ query: async () => ({ rows: [{ n: waiting }] }) });
    },
    claim: async (_tx, args) => {
      calls.claim.push(args);
      return queue.shift() || null;
    },
    run: async (_tx, job) => {
      calls.run.push(job.id);
      return job.outcome;
    },
    runDue: async (_db, args) => {
      calls.runDue.push(args);
      return { partners: 2, jobs: [{ partner_id: PARTNER }] };
    },
  };
  return { calls, deps };
}
const job = (n, outcome) => ({ id: `3b000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, outcome });
const ok = (assets = []) => ({ status: "succeeded", assets, cost_cents: 12 });

test("creative/run claims and runs up to the number asked for, for the partner on the login only, and sums what worked, what failed and what went back in the queue", async () => {
  assert.equal(ROUTES["creative/run"], creativeRun);
  const h = runHarness({ jobs: [job(1, ok()), job(2, { status: "failed", assets: [], error: "no active provider configured for asset kind \"copy\"" }), job(3, { status: "queued", assets: [] }), job(4, ok())] });
  const done = await hit(creativeRun, { ...asPartner, method: "POST", body: { partner_id: OTHER_PARTNER, max_jobs: 3 }, deps: h.deps, rules: [] });
  assert.equal(done.status, 200);
  assert.equal(done.body.ran, 3);
  assert.equal(done.body.succeeded, 1);
  assert.equal(done.body.failed, 1);
  assert.equal(done.body.requeued, 1);
  assert.deepEqual(h.calls.scope, [{ kind: "partner", partnerId: PARTNER }], "the scope is the partner's own id; the partner_id in the body is ignored");
  assert.deepEqual(h.calls.claim.map((c) => c.partnerId), [PARTNER, PARTNER, PARTNER]);
  assert.equal(h.calls.run.length, 3, "the fourth waiting job is left for the next press");
  assert.match(done.body.note, /^Some did not work\. No ad-making service is switched on for this account/);
  assert.deepEqual(done.body.jobs.map((j) => j.status), ["succeeded", "failed", "queued"]);

  const quiet = runHarness({ jobs: [] });
  const nothing = await hit(creativeRun, { ...asPartner, method: "POST", body: {}, deps: quiet.deps, rules: [] });
  assert.equal(nothing.body.ran, 0);
  assert.match(nothing.body.note, /Nothing was waiting to run/);

  const allFailed = runHarness({ jobs: [job(5, { status: "failed", assets: [], error: "provider returned zero assets" })] });
  const failed = await hit(creativeRun, { ...asPartner, method: "POST", body: { max_jobs: 1 }, deps: allFailed.deps, rules: [] });
  assert.match(failed.body.note, /^It did not work, and nothing was made\. The service answered, but sent nothing back\./);
  assert.equal(allFailed.calls.claim.length, 1, "one press with max_jobs 1 pays for one job");
});

test("creative/run caps one press at ten jobs, falls back to three when the number is not a whole number, and puts the ad checker's verdict on every piece of copy", async () => {
  assert.equal(DEFAULT_MAX_JOBS, 3);
  assert.equal(MAX_JOBS_CAP, 10);
  for (const [raw, want] of [[1, 1], [7, 7], [99, 10], ["4", 4], [0, 3], [-2, 3], [2.5, 3], ["abc", 3], [null, 3], [undefined, 3]]) {
    assert.equal(maxJobsFrom({ max_jobs: raw }), want, String(raw));
  }
  const copy = { kind: "copy", copy_text: "Get approved today. Guaranteed approval for everyone." };
  const picture = { kind: "static", copy_text: null };
  const h = runHarness({ jobs: [job(1, ok([copy, picture]))] });
  const done = await hit(creativeRun, { ...asPartner, method: "POST", body: { max_jobs: 1 }, deps: h.deps, rules: [] });
  const [shownCopy, shownPicture] = done.body.jobs[0].assets;
  assert.equal(typeof shownCopy.check.ok, "boolean");
  assert.ok(Array.isArray(shownCopy.check.failures));
  assert.equal(shownCopy.check.ok, false, "a guarantee in an ad fails the checker");
  assert.equal("check" in shownPicture, false, "a picture has no words and no verdict");
});

test("creative/run lets staff run every partner's due work with all=1 and nobody else; staff must otherwise name a partner; a client login is refused", async () => {
  const h = runHarness();
  const all = await hit(creativeRun, { method: "POST", role: "admin", body: { all: 1, max_jobs: 2 }, deps: h.deps, rules: [] });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body, { ok: true, partners: 2, jobs: [{ partner_id: PARTNER }] });
  assert.deepEqual(h.calls.runDue, [{ maxJobsPerPartner: 2 }]);
  assert.equal(h.calls.claim.length, 0);

  for (const flag of [true, "1"]) {
    const h2 = runHarness();
    const out = await hit(creativeRun, { method: "POST", body: { all: flag }, deps: h2.deps, rules: [] });
    assert.equal(out.status, 200, String(flag));
    assert.equal(h2.calls.runDue.length, 1);
  }
  const partnerAll = runHarness();
  const refused = await hit(creativeRun, { ...asPartner, method: "POST", body: { all: 1 }, deps: partnerAll.deps, rules: [] });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "staff_only_for_all");
  assert.equal(partnerAll.calls.runDue.length, 0);

  const unnamed = runHarness();
  const noPartner = await hit(creativeRun, { method: "POST", body: {}, deps: unnamed.deps, rules: [] });
  assert.equal(noPartner.status, 400);
  assert.equal(noPartner.body.error, "partner_id_required");
  assert.equal(unnamed.calls.claim.length, 0);
  const named = await hit(creativeRun, { method: "POST", body: { partner_id: PARTNER }, deps: runHarness().deps, rules: [] });
  assert.equal(named.status, 200);

  for (const kind of ["client", "affiliate"]) {
    const h3 = runHarness();
    const out = await hit(creativeRun, { account: { kind, clientId: kind === "client" ? SCRIPT : null }, method: "POST", body: { partner_id: PARTNER }, deps: h3.deps, rules: [] });
    assert.equal(out.status, 403, kind);
    assert.equal(h3.calls.claim.length, 0);
  }
  const get = await hit(creativeRun, { ...asPartner, method: "GET", deps: runHarness().deps, rules: [] });
  assert.equal(get.status, 405);
});

test("creative/run leaves copy jobs for the Mac when the runner is local: it never claims them, and says how many are waiting", async () => {
  const h = runHarness({ runnerLocal: true, waiting: 2 });
  const out = await hit(creativeRun, { ...asPartner, method: "POST", body: {}, deps: h.deps, rules: [] });
  assert.equal(out.status, 200);
  assert.deepEqual(h.calls.claim.map((c) => c.excludeAssetKinds), [["copy"]], "the claim keeps copy jobs out");
  assert.equal(out.body.waiting_for_mac, 2);
  assert.equal(out.body.note, "Waiting for your Mac to run it.");

  const all = runHarness({ runnerLocal: true });
  await hit(creativeRun, { method: "POST", body: { all: 1 }, deps: all.deps, rules: [] });
  assert.deepEqual(all.calls.runDue[0].excludeAssetKinds, ["copy"]);

  const remote = runHarness({ runnerLocal: false });
  const normal = await hit(creativeRun, { ...asPartner, method: "POST", body: {}, deps: remote.deps, rules: [] });
  assert.equal("waiting_for_mac" in normal.body, false);
  assert.equal(remote.calls.claim[0].excludeAssetKinds, undefined);
});
