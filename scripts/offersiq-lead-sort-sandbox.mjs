#!/usr/bin/env node
// Vendor proof only. No DB, no client writes, and no real consumer input.
// --apply reuses listed old sandbox receipts for free. Any missing fixture gets
// one sandbox evaluation using the exact published identity imported below.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createCrsClient } from "../src/finance/crs-client.mjs";
import { OFFERSIQ_SANDBOX_IDENTITIES, isOffersIqSandboxIdentity } from "../src/finance/offersiq-contract.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG } from "../src/finance/offersiq-lead-sort-config.mjs";
import { classifyOffersIqReceipt } from "../src/finance/offersiq-lead-sort.mjs";
import { OffersIqToolError, assertToolCrsEnvironment, parseLeadSortArgs, isToolEntryPoint, runToolMain } from "./offersiq-lead-sort-tools.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fixtureFingerprint = identity => createHash("sha256").update(JSON.stringify(identity)).digest("hex");

export function sandboxPreviousReceipts(input) {
  const receipts = new Map();
  if (input == null) return receipts;
  if (input.environment !== "sandbox" || !Array.isArray(input.receipts)) throw new OffersIqToolError("prior proof must be a sandbox receipt report");
  for (const row of input.receipts) {
    const identity = OFFERSIQ_SANDBOX_IDENTITIES[row?.fixtureIndex];
    if (!identity || !UUID.test(row.requestId || "") || receipts.has(row.fixtureIndex)
        || row.identityFingerprint !== fixtureFingerprint(identity)) {
      throw new OffersIqToolError("prior receipt must identify one exact published sandbox fixture");
    }
    receipts.set(row.fixtureIndex, row.requestId);
  }
  return receipts;
}

export function sandboxLoadedRuleListVerified(report) {
  const receipts = report?.receipts;
  return report?.complete === true && Array.isArray(receipts)
    && receipts.length === OFFERSIQ_SANDBOX_IDENTITIES.length
    && receipts.some(row => row.ranking?.ruleListStatus === "matched")
    && receipts.every(row => ["matched", "not_evaluated"].includes(row.ranking?.ruleListStatus));
}

export async function verifyOffersIqSandbox({ apply = false, ruleSetId, previous = null,
  env = process.env, createClient = createCrsClient, config = OFFERSIQ_LEAD_SORT_CONFIG,
  classify = classifyOffersIqReceipt, summarize, now = () => new Date() } = {}) {
  if (!Number.isSafeInteger(ruleSetId) || ruleSetId < 1) throw new OffersIqToolError("sandbox rule set required");
  const old = sandboxPreviousReceipts(previous);
  if (!apply) return { mode: "preview", environment: "sandbox", ruleSetId, version: config.version,
    fixtureCount: OFFERSIQ_SANDBOX_IDENTITIES.length, freeReevaluations: old.size,
    newSandboxEvaluations: OFFERSIQ_SANDBOX_IDENTITIES.length - old.size, providerCalls: 0 };
  const clientEnv = assertToolCrsEnvironment(env, "sandbox");
  if (typeof summarize !== "function") throw new OffersIqToolError("safe summary helper required");
  const client = createClient({ env: clientEnv });
  const report = { mode: "apply", environment: "sandbox", ruleSetId, version: config.version,
    providerCalls: 0, complete: true, loadedRuleListVerified: false, receipts: [] };
  for (const [fixtureIndex, identity] of OFFERSIQ_SANDBOX_IDENTITIES.entries()) {
    if (!isOffersIqSandboxIdentity(identity)) throw new OffersIqToolError("published sandbox identity changed");
    report.providerCalls++;
    const result = old.has(fixtureIndex)
      ? await client.reevaluateOffersIq({ requestId: old.get(fixtureIndex) })
      : await client.evaluateOffersIq({ ruleSetId, identity, consent: { accepted: true,
        termsUrl: "https://fundhub.ai/terms", consentVersion: "offersiq-published-sandbox-fixtures-v1",
        consentTimestamp: now().toISOString() } });
    if (!result?.ok || !result.decision || !UUID.test(result.requestId || "")
        || Number(result.decision.ruleSetId) !== ruleSetId) {
      report.complete = false;
      report.loadedRuleListVerified = false;
      report.receipts.push({ fixtureIndex, outcome: "provider_error", httpStatus: Number(result?.status) || 0 });
      continue;
    }
    const identityFingerprint = fixtureFingerprint(identity);
    const summary = summarize(result.decision, { ruleSetId, environment: "sandbox",
      fingerprint: identityFingerprint, checkedAt: now().toISOString() });
    const ranking = classify(summary, config);
    report.receipts.push({ fixtureIndex, identityFingerprint, requestId: result.requestId,
      source: old.has(fixtureIndex) ? "free_reevaluation" : "published_sandbox_evaluation",
      outcome: summary.outcome, summary, ranking });
  }
  report.loadedRuleListVerified = sandboxLoadedRuleListVerified(report);
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseLeadSortArgs(args, { sandboxOnly: true });
  if (options.help) {
    console.log("--rule-set 1232 [--receipt-file private-prior-report.json] [--apply]. Sandbox credentials only; preview makes no call.");
    return;
  }
  const previous = options.receiptFile ? JSON.parse(await readFile(options.receiptFile, "utf8")) : null;
  const { safeOffersIqSummary } = await import("../src/finance/offersiq.mjs");
  const report = await verifyOffersIqSandbox({ ...options, previous, summarize: safeOffersIqSummary });
  console.log(JSON.stringify(report));
  if (options.apply && (!report.complete || !report.loadedRuleListVerified)) process.exitCode = 2;
}

if (isToolEntryPoint(import.meta.url)) await runToolMain(() => main());
