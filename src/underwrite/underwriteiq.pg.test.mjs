// UnderwriteIQ end-to-end against real Postgres.
//
// SKIPS unless DATABASE_URL is set — same convention as every other
// .pg.test.mjs in this repo. Lives under src/ (not scripts/ or api/) so
// `npm test`'s glob (src/** and scripts/**, per CLAUDE.md §12) actually runs it.
//
// The path proved, end to end:
//   1. loadSimulatedClient — a real client + tradelines + crs_results row,
//      shaped like a real CRS soft pull (src/demo/simulate-client.mjs).
//   2. Take that CRS payload and run it through the real adapter entrypoint,
//      emitCrsResult (src/adapters/crs.mjs) — this is what a live pull calls.
//   3. Register the client-lifecycle handlers so analysis.completed/
//      decision.rendered actually stamp the client (outcome_tier,
//      total_funding_estimate) the same way a production pull would.
//   4. Load tradelines + card_liabilities + crs_results the same way
//      api/read/underwrite.mjs does, and run the same pure chain:
//      toBureaus → computeUnderwrite → buildSuggestions → buildReport.
//   5. Drive u-02 (analysis.completed's own workflow) with a fake `step`
//      against the same client, and assert the tags/custom_fields it stamps —
//      the readiness signal for letter/delivery, without needing Inngest.
//
// AND THEN, SEPARATELY, THE PATH THE BUTTON ACTUALLY TAKES.
// The chain above proves something the live screen never does. POST
// /api/demo/simulate calls loadSimulatedClient and NOTHING ELSE
// (api/demo/simulate.mjs:23-26) — there is no emitCrsResult step in it. The
// second test below therefore seeds a client and reads it with no emit, which
// is the only shape an operator ever sees. Until 2026-08-19 that read came back
// with no bureau available, score 0 and $0 funding, and every test in this repo
// stayed green because every one of them flattened the payload first. See that
// test's own header for the detail.
import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "../handlers/client-lifecycle.mjs";
import { loadSimulatedClient, teardownSimulated, buildSimulatedCrsPayload } from "../demo/simulate-client.mjs";
import { emitCrsResult } from "../adapters/crs.mjs";
import { toBureaus } from "./adapter.mjs";
import { UPSTREAM, computeUnderwrite, buildSuggestions } from "./engine.mjs";
import { buildReport } from "./report.mjs";
import { evaluateUtilization } from "../alerts/evaluate.mjs";
import { handle as u02Handle } from "../workflows/u-02-analyzer-complete-delivery.mjs";
import { fakeStep } from "../workflows/test-support.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
let orgId = null;
let clientId = null;
// Every demo client this file seeds. Two tests now seed one each, and a demo
// client left behind is a real row in a real table that the next run counts.
const seeded = [];

before(async () => {
  if (!HAS_DB) return;
  _resetOrgCache();
  clearHandlers();
  registerLifecycle();
  const org = await db.query(`SELECT id FROM orgs ORDER BY created_at ASC LIMIT 1`);
  orgId = org.rows[0]?.id;
  assert.ok(orgId, "need at least one org row — run the seed");
});

after(async () => {
  if (!HAS_DB) return;
  for (const id of seeded) {
    // Anchored CRS events no longer repeat the email in their payload. Remove
    // this test's event rows by client before teardown removes the result anchor.
    await db.query(`DELETE FROM events WHERE client_id = $1`, [id]).catch(() => null);
    await teardownSimulated(db, { orgId, clientId: id }).catch(() => null);
  }
  await close();
});

test("UnderwriteIQ chain: sim client → CRS emit → decision stamp → engine report → u-02 readiness", { skip: !HAS_DB }, async () => {
  // 1. A real client, real tradelines (via the real ingest path), and a
  //    crs_results row shaped like a real CRS soft pull.
  const loaded = await loadSimulatedClient(db, { orgId });
  clientId = loaded.client.id;
  seeded.push(clientId);
  assert.ok(clientId);
  assert.ok(loaded.tradeline_count > 0, "simulated CRS must ingest real tradeline rows");

  // 2. Rebuild the same CRS-shaped payload (buildSimulatedCrsPayload is pure and
  //    deterministic modulo its own outcome/scores) and run it through the real
  //    adapter entrypoint, the way a live pull's result would arrive.
  const payload = buildSimulatedCrsPayload({ email: loaded.email, name: "Simulated Client" });

  const crsResultId = (await db.query(
    `SELECT id FROM crs_results WHERE client_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [clientId]
  )).rows[0]?.id;
  assert.ok(crsResultId, "simulated pull must have a stored CRS result anchor");
  const emitted = await emitCrsResult({
    db, engineResult: payload, clientId, crsResultId, requestId: "simulated-underwrite-request"
  });
  assert.equal(emitted.ok, true, JSON.stringify(emitted));
  const emittedNames = emitted.emitted.map((e) => e.name);
  assert.ok(emittedNames.includes("analysis.completed"), "adapter must emit analysis.completed");
  assert.ok(emittedNames.includes("decision.rendered"), "adapter must emit decision.rendered");

  // 3. registerLifecycle() (called in before()) means analysis.completed and
  //    decision.rendered were just reacted to synchronously by
  //    src/handlers/client-lifecycle.mjs — assert what they stamped.
  const clientRow = (await db.query(
    `SELECT outcome_tier, custom_fields, tags FROM clients WHERE id = $1`,
    [clientId]
  )).rows[0];
  assert.equal(clientRow.outcome_tier, "FULL_FUNDING", "decision.rendered must stamp the tier");
  const fundingEstimate = Number(
    clientRow.custom_fields?.total_funding_estimate ?? clientRow.custom_fields?.analyzer_prequal_amount
  );
  assert.ok(fundingEstimate > 0, "decision.rendered must stamp a funding estimate on the client");

  // 4. Load exactly what api/read/underwrite.mjs loads, then run its pure chain.
  const [tradelinesRes, liabilitiesRes, crsRes] = await Promise.all([
    db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2 ORDER BY apr ASC NULLS LAST, lender ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2 ORDER BY as_of DESC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT result, created_at FROM crs_results WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [clientId, orgId]
    )
  ]);
  assert.ok(tradelinesRes.rows.length > 0, "tradelines must be stored for this client");
  // analysis.completed is now anchored to the stored pull. It announces that
  // row instead of making a second history entry for the same provider result.
  assert.equal(crsRes.rows.length, 1, "the anchored event duplicated the stored CRS result");

  const adapter = toBureaus({
    tradelines: tradelinesRes.rows,
    liabilities: liabilitiesRes.rows,
    crsResults: crsRes.rows,
    customFields: clientRow.custom_fields || {}
  });
  assert.ok(adapter.available.length > 0, "at least one bureau must carry a score");

  const underwrite = computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths);
  const suggestions = buildSuggestions(underwrite);
  const fundhubUtilization = evaluateUtilization(tradelinesRes.rows);
  const report = buildReport({ underwrite, suggestions, adapter, fundhubUtilization });
  report.engine.upstreamCommit = UPSTREAM.commit;

  // 5. Assert the report actually carries scores + utilization + suggestions.
  assert.ok(report.underwrite, "report must carry the engine's underwrite output");
  assert.ok(report.underwrite.metrics, "report.underwrite must carry metrics");
  assert.equal(typeof report.underwrite.metrics.score, "number", "report must carry a primary-bureau score");
  assert.equal(typeof report.underwrite.metrics.utilization_pct, "number", "report must carry a utilization percentage");
  assert.ok(Array.isArray(report.utilizationVoices) && report.utilizationVoices.length > 0, "report must carry utilization voices");
  assert.ok(Array.isArray(suggestions), "suggestions is an array");
  assert.ok(suggestions.length > 0, "FULL_FUNDING sim data must produce at least one suggestion");
  assert.ok(report.engine.upstreamCommit, "report stamps the vendored engine's upstream commit");

  // 6. Letter/delivery readiness: drive u-02 (analysis.completed's own workflow)
  //    against this same client with a fake `step`, and assert the tags +
  //    custom_fields it stamps — without needing Inngest running.
  const u02Result = await u02Handle({
    event: { id: "underwriteiq-pg-test-u02", orgId, clientId, payload: { outcomeTier: "FULL_FUNDING", source: "crs" } },
    db,
    step: fakeStep()
  });
  assert.equal(u02Result.branch, "funding", "FULL_FUNDING is a funding-path tier");

  const afterU02 = (await db.query(`SELECT tags, custom_fields FROM clients WHERE id = $1`, [clientId])).rows[0];
  assert.ok(afterU02.tags.includes("analyzer:complete"), "u-02 must tag the client analyzer:complete");
  assert.ok(afterU02.tags.includes("path:funding"), "u-02 must route a funding tier to path:funding");
  assert.equal(afterU02.custom_fields.analyzer_status, "Complete", "u-02 must stamp analyzer_status");
  assert.equal(afterU02.custom_fields.funding_delivery_sent, undefined, "u-02 delivery email is retired; funding_delivery_sent is not stamped");
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE RAW SEED — WHAT THE BUTTON ACTUALLY LEAVES BEHIND

   WHY THIS TEST EXISTS. The test above passes for a reason that does not apply
   to the live screen: it calls emitCrsResult, and emitCrsResult is what puts a
   top-level `scores` object on the stored result. POST /api/demo/simulate never
   does that — api/demo/simulate.mjs:23-26 calls loadSimulatedClient and returns.
   So the shape an operator reads is the seed's own, unflattened, and no test in
   this repo exercised it: adapter.test.mjs and fixtures.test.mjs plant
   already-flat fixtures, and the chain test above emits first.

   The result, live on 2026-08-18: a funded demo client read score 0 and $0
   funding on UnderwriteIQ while every test stayed green.

   So this seeds a client, reads it EXACTLY the way api/read/underwrite.mjs does
   (same four queries, same order), and runs the same pure chain. No emit step.
   Nothing here may be "helped along" by a flattening call — the moment one is
   added, this test stops guarding the thing it exists to guard.

   The numbers are not round because they are not invented: they fall out of the
   four tradelines the seed plants and the six counts it writes. Each is derived
   in the assertion that uses it.
   ═══════════════════════════════════════════════════════════════════════════ */
test("the RAW seed — no emit step — is readable as a real bureau pull", { skip: !HAS_DB }, async () => {
  const loaded = await loadSimulatedClient(db, { orgId });
  const rawClientId = loaded.client.id;
  seeded.push(rawClientId);

  // Exactly api/read/underwrite.mjs:88-119 — same four queries, same scoping.
  const client = (await db.query(
    `SELECT id, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [rawClientId, orgId]
  )).rows[0];
  assert.ok(client, "the seeded client must be readable in its own org");

  const [tradelinesRes, liabilitiesRes, crsRes] = await Promise.all([
    db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2 ORDER BY apr ASC NULLS LAST, lender ASC`,
      [rawClientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2 ORDER BY as_of DESC`,
      [rawClientId, orgId]
    ),
    db.query(
      `SELECT result, created_at FROM crs_results WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [rawClientId, orgId]
    )
  ]);

  // ── what the seed left in the database ──────────────────────────────────
  assert.equal(tradelinesRes.rows.length, 4, "the seed plants four bureau lines");
  assert.ok(tradelinesRes.rows.every((t) => t.is_demo === true),
    "every simulated tradeline must be flagged is_demo — a demo line counted as real " +
    "silently inflates any report that excludes demo data");
  assert.ok(tradelinesRes.rows.every((t) => t.apr !== null),
    "each simulated line carries a rate; the waterfall sorts on price and an unpriced line sorts last");
  assert.ok(liabilitiesRes.rows.length > 0,
    "the seed must record a billing position per card — without one the adapter reports " +
    "payment_status missing on every line and no card can read as in good standing");
  assert.ok(liabilitiesRes.rows.every((l) => l.is_demo === true), "demo positions must be flagged demo");
  assert.equal(crsRes.rows.length, 1, "one pull, one stored result");
  assert.notEqual(String(crsRes.rows[0].result.environment || "").toLowerCase(), "sandbox",
    "a result stamped `sandbox` is skipped whole by triMerge (src/http/client-detail.mjs:76), " +
    "so stamping it here would show score 0 no matter what scores the payload carries");

  // ── the adapter, unhelped ───────────────────────────────────────────────
  const adapter = toBureaus({
    tradelines: tradelinesRes.rows,
    liabilities: liabilitiesRes.rows,
    crsResults: crsRes.rows,
    customFields: client.custom_fields || {}
  });
  assert.deepEqual(adapter.available, ["experian", "equifax", "transunion"],
    "all three bureaus answered in the seeded pull, so all three must reach the engine");
  /* business_age_months joined this list on 2026-09-03 (84a8760ed, walkthrough
     F15: "a loose business_age_months no longer conjures a company"). The seed
     still writes custom_fields.business_age_months = 30, but with no businesses
     row there is no company for that age to belong to, so resolveBusinessAges()
     returns no ages and the age is reported missing — on purpose. */
  assert.deepEqual(adapter.missing.client.map((m) => m.field), ["hasLLC", "business_age_months"],
    "this seed has no businesses row, so hasLLC and the business age are missing; " +
    "anything else in this list is a field the seed forgot to write");

  const underwrite = computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths);

  assert.equal(underwrite.metrics.score, 731,
    "the primary bureau is the highest-scoring one — TransUnion, 731");
  assert.equal(underwrite.metrics.utilization_pct, 17.44,
    "$7,850 drawn against $45,000 of revolving limit; the installment line is not drawable");
  assert.equal(underwrite.metrics.negative_accounts, 0);
  assert.equal(underwrite.metrics.late_payment_events, 0);
  assert.equal(underwrite.metrics.inquiries.total, 7,
    "the six counts the seed writes must add up to the inquiries the payload lists");

  // 4 revolving lines, highest seasoned open limit $25,000 -> x5.5 = $137,500 a
  // bureau, x3 bureaus = $412,500. The $28,000 installment loan -> x3 = $84,000
  // a bureau, x3 = $252,000.
  //
  // BUSINESS IS $0, ON PURPOSE, SINCE 2026-09-03. It was $275,000 (the primary
  // bureau's card funding x2 for a business over two years old), which made the
  // headline $939,500 — the exact figure walkthrough F15 caught the closer deck
  // quoting against a stored $199,350, because a loose business_age_months
  // conjured a company this client does not have. No businesses row, no
  // business money (84a8760ed).
  assert.equal(underwrite.totals.total_personal_funding, 664500);
  assert.equal(underwrite.totals.total_business_funding, 0,
    "no businesses row means no company, so no business funding is quoted");
  assert.equal(underwrite.totals.total_combined_funding, 664500,
    "THE HEADLINE. A funded demo client reading $0 here is the bug this test exists for");

  assert.equal(underwrite.fundable, true,
    "score 731, utilization under 30% and a measured zero negatives — all three conditions met. " +
    "An UNMEASURED zero would not do it: the engine keeps an unknown count as null and " +
    "null fails `neg === 0` (src/underwrite/vendor/underwriter.cjs:212)");
});
