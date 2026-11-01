#!/usr/bin/env node
// Runs the REPAIR-FULL simulated file (scripts/sim/push-credit.mjs, "repair-full") through the
// real UnderwriteIQ engine and prints the figures the bank-said-no and card-paydown decks show:
// what the file qualifies for today and once cleaned up, card use, and each card's paydown
// target. No database, no network, no bureau. SIMULATED file.
//
//   node marketing/slideshows/samples/run-repair-full-file.mjs
//
// Written by the bank-said-no / card-paydown writer on 2026-10-31; saved here so the decks'
// figures can be re-run (law: sample-clients-consistent, "print what the engine prints").
import { mock } from "node:test";
const repo = (p) => new URL("../../../" + p, import.meta.url).href;
const PULLED_AT = "2026-10-31T12:00:00.000Z";
const { buildPayload, SIMULATED_BUYER_IDENTITY } = await import(repo("scripts/sim/push-credit.mjs"));
process.removeAllListeners("warning");
mock.timers.enable({ apis: ["Date"], now: Date.parse(PULLED_AT) });
const crsEngine = (await import(repo("src/finance/vendor/crs-engine.cjs"))).default;
const { runTierEngineFromCrsResult } = await import(repo("src/finance/crs-tier.mjs"));
const { scoreBuyerTotal } = await import(repo("src/finance/crs-pull.mjs"));
const { buildDeckVisualData } = await import(repo("src/sales/deck-visual-data.mjs"));
const { buildBlackReportClient, mergeStoredUnderwrite } = await import(repo("src/underwrite/black-report-client.mjs"));
const { buildCreditAnalysis } = await import(repo("src/deliverables/credit-analysis.mjs"));
const { holdingYouBack, rankedRevolving, targetBal } = await import(repo("src/deliverables/derive.mjs"));
const name = "Sample Client";
const file = buildPayload("repair-full", { name, pulledAt: PULLED_AT, identity: SIMULATED_BUYER_IDENTITY });
const referenceDate = new Date(PULLED_AT);
const runEngine = (args) => crsEngine.runCRSEngine({ ...args, referenceDate });
const runTier = (pull, opts) => runTierEngineFromCrsResult(pull, opts, { runEngine });
const tierOpts = { submittedName: name, submittedAddress: "", formData: { name, email: null, phone: null } };
const today = scoreBuyerTotal(runTier, file, tierOpts);
const t = today.tierResult;
console.log("TODAY", today.fundingEstimate, t.outcome, "util", t.consumerSignals?.utilization?.pct, "median", t.consumerSignals?.scores?.median);
const client = buildBlackReportClient({ crsResult: mergeStoredUnderwrite(t, file), personal: { name, address: "" }, now: referenceDate });
console.log("CLIENT now/after", client.preapproval_now, client.preapproval_after, "util", client.util_pct, client.util_total_balance, client.util_total_limit, client.util_target_balance);
console.log("REVOLVING ranked");
for (const r of rankedRevolving(client)) console.log("  ", JSON.stringify(r), "targetBal=", targetBal(r));
console.log("HOLDING", holdingYouBack(client));
const html = buildCreditAnalysis(client);
const s = String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const m = s.match(/[^.]*highest-utilization card[^.]*\.[^.]*\.[^.]*\./);
console.log("ANALYSIS:", m ? m[0].trim() : "(no hero sentence)");
const deck = buildDeckVisualData({ crs: { result: file, created_at: PULLED_AT }, engine: { available: true, total: null, outcome: null, sample: true }, name, businesses: [] });
console.log("DECK today", deck.todayTotal, "optimized", deck.optimizedTotal, "tierNow", deck.tierNow, "tierAfter", deck.tierAfter, "source", deck.source);
console.log("LEVERS", JSON.stringify(deck.levers, null, 1));
mock.timers.reset();
