// Shared operator tools. Preview never calls CRS or changes a stored receipt.
import { pathToFileURL } from "node:url";
import { createCrsClient, crsConfigFromEnv } from "../src/finance/crs-client.mjs";
import { CRS_PRODUCTION_HOST, CRS_SANDBOX_HOST } from "../src/finance/crs-identities.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG } from "../src/finance/offersiq-lead-sort-config.mjs";
import { classifyOffersIqReceipt } from "../src/finance/offersiq-lead-sort.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OffersIqToolError extends Error {}

export function parseLeadSortArgs(args, { sandboxOnly = false } = {}) {
  const options = { apply: false, environment: "sandbox", pageSize: 100, orgId: null,
    loadedProofRequest: null, ruleSetId: null, receiptFile: null, help: false };
  const names = new Map([["--environment", "environment"], ["--page-size", "pageSize"],
    ["--org", "orgId"], ["--loaded-proof-request", "loadedProofRequest"],
    ["--rule-set", "ruleSetId"], ["--receipt-file", "receiptFile"]]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") { options.apply = true; continue; }
    if (args[i] === "--help") { options.help = true; continue; }
    const name = names.get(args[i]);
    if (!name || !args[i + 1] || args[i + 1].startsWith("--")) throw new OffersIqToolError("invalid or missing tool option");
    options[name] = args[++i];
  }
  if (!["sandbox", "production"].includes(options.environment) || (sandboxOnly && options.environment !== "sandbox")) {
    throw new OffersIqToolError("sandbox or production environment required; sandbox proof only permits sandbox");
  }
  options.pageSize = Number(options.pageSize);
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1000) {
    throw new OffersIqToolError("page size must be between 1 and 1000");
  }
  for (const key of ["orgId", "loadedProofRequest"]) {
    if (options[key] !== null && !UUID.test(options[key])) throw new OffersIqToolError("organization and proof request must be UUIDs");
  }
  if (options.ruleSetId !== null) {
    options.ruleSetId = Number(options.ruleSetId);
    if (!Number.isSafeInteger(options.ruleSetId) || options.ruleSetId < 1) throw new OffersIqToolError("positive rule set required");
  }
  return options;
}

// The caller supplies one environment's credentials, for example with Node's
// --env-file. Never replace a production hostname with a sandbox hostname while
// retaining its credentials, and never rewrite any .env file.
export function assertToolCrsEnvironment(env, environment) {
  const dedicated = ["HOST", "USERNAME", "PASSWORD"].some(key => String(env?.[`CRS_OFFERSIQ_API_${key}`] ?? "").trim());
  const selected = dedicated ? { ...env,
    CRS_API_HOST: env.CRS_OFFERSIQ_API_HOST,
    CRS_API_USERNAME: env.CRS_OFFERSIQ_API_USERNAME,
    CRS_API_PASSWORD: env.CRS_OFFERSIQ_API_PASSWORD,
    CRS_ALLOW_LIVE: env.CRS_OFFERSIQ_ALLOW_LIVE ?? "" } : env;
  const configured = crsConfigFromEnv(selected);
  const expectedHost = environment === "sandbox" ? CRS_SANDBOX_HOST : CRS_PRODUCTION_HOST;
  if (!["sandbox", "production"].includes(environment) || configured.host !== expectedHost) {
    throw new OffersIqToolError("CRS host does not match the selected environment");
  }
  if (!configured.configured) throw new OffersIqToolError("CRS credentials are not configured for the selected environment");
  return selected;
}

export async function* finishedOffersIqPages(db, { environment = "sandbox", orgId = null, pageSize = 100 } = {}) {
  if (!["sandbox", "production"].includes(environment) || (orgId !== null && !UUID.test(orgId))
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new OffersIqToolError("invalid receipt scan options");
  let cursor = null;
  while (true) {
    const result = await db.query(
      `SELECT id, org_id, rule_set_id, environment, identity_fingerprint,
              provider_request_id, normalized_response, lead_sort_receipt, finished_at, status
         FROM offersiq_requests
        WHERE finished_at IS NOT NULL AND status <> 'in_flight'
          AND environment = $1 AND ($2::uuid IS NULL OR org_id = $2)
          AND ($3::uuid IS NULL OR id > $3)
        ORDER BY id ASC LIMIT $4`, [environment, orgId, cursor, pageSize]);
    if (!result.rows.length) return;
    yield result.rows;
    cursor = result.rows.at(-1).id;
    if (result.rows.length < pageSize) return;
  }
}

function tally(result, score) {
  result.scanned++;
  result.buckets[score.bucket] = (result.buckets[score.bucket] || 0) + 1;
  if (score.ruleListStatus === "mismatch") result.ruleListMismatches++;
  if (score.ruleListStatus === "starter") result.starterReceipts++;
}

function rescoreSummary(source, row) {
  if (source && typeof source === "object" && !Array.isArray(source)
      && Number.isSafeInteger(source.rule_set_id) && source.rule_set_id > 0
      && ["sandbox", "production"].includes(source.environment)
      && /^[a-f0-9]{64}$/.test(source.identity_fingerprint || "")) return source;
  // A legacy missing/malformed receipt is not provider proof. Keep only safe
  // claim metadata so its row can still receive Can't tell without inventing
  // any rule results. Compare-and-set against the actual original source.
  return { outcome: ["matched", "not_matched", "needs_review", "error"].includes(row.status) ? row.status : "needs_review",
    rule_set_id: Number(row.rule_set_id), environment: row.environment,
    identity_fingerprint: row.identity_fingerprint,
    request_id: UUID.test(row.provider_request_id || "") ? row.provider_request_id : null,
    checked_at: new Date(row.finished_at).toISOString() };
}

export async function rescoreFinishedOffersIq({ db, apply = false, environment = "sandbox", orgId = null,
  pageSize = 100, config = OFFERSIQ_LEAD_SORT_CONFIG, classify = classifyOffersIqReceipt, persist } = {}) {
  if (apply && typeof persist !== "function") throw new OffersIqToolError("ranking persistence required for apply");
  const result = { mode: apply ? "apply" : "preview", environment, version: config.version,
    scanned: 0, written: 0, ruleListMismatches: 0, starterReceipts: 0, buckets: {} };
  for await (const rows of finishedOffersIqPages(db, { environment, orgId, pageSize })) {
    for (const row of rows) {
      const sourceReceipt = row.lead_sort_receipt ?? row.normalized_response ?? null;
      const summary = rescoreSummary(sourceReceipt, row);
      const score = classify(summary, config);
      tally(result, score);
      if (apply) {
        await persist(db, row.id, row.org_id, summary, { config, expectedSourceReceipt: sourceReceipt });
        result.written++;
      }
    }
  }
  return result;
}

function checkedSummary(result, row, summarize, now) {
  if (!result?.ok || !result.decision || !UUID.test(result.requestId || "")
      || Number(result.decision.ruleSetId) !== Number(row.rule_set_id)) {
    throw new OffersIqToolError("free reevaluation failed or returned a different rule set; no ranking written");
  }
  return summarize(result.decision, { ruleSetId: Number(row.rule_set_id), environment: row.environment,
    fingerprint: row.identity_fingerprint, checkedAt: now().toISOString() });
}

export async function reevaluateFinishedOffersIq({ db, apply = false, environment = "sandbox", orgId = null,
  pageSize = 100, loadedProofRequest = null, env = process.env, config = OFFERSIQ_LEAD_SORT_CONFIG,
  classify = classifyOffersIqReceipt, persist, summarize, createClient = createCrsClient,
  now = () => new Date() } = {}) {
  // Preview is a database read only. Even authentication is deferred to apply.
  if (!apply) return { ...(await rescoreFinishedOffersIq({ db, environment, orgId, pageSize, config, classify })),
    operation: "free_reevaluate", providerCalls: 0, loadedRuleListVerified: false };
  const clientEnv = assertToolCrsEnvironment(env, environment);
  if (typeof persist !== "function" || typeof summarize !== "function") throw new OffersIqToolError("summary and ranking persistence required");
  if (environment === "production" && !UUID.test(loadedProofRequest || "")) {
    throw new OffersIqToolError("production reevaluation requires --loaded-proof-request after CRS loads the list");
  }
  const client = createClient({ env: clientEnv });
  const result = { mode: "apply", operation: "free_reevaluate", environment, version: config.version,
    scanned: 0, written: 0, providerCalls: 0, ruleListMismatches: 0, starterReceipts: 0,
    skippedNoProviderRequest: 0, noFileReceipts: 0, loadedRuleListVerified: false, buckets: {} };
  let proofRow = null;
  let proofSummary = null;
  if (loadedProofRequest) {
    if (!UUID.test(loadedProofRequest)) throw new OffersIqToolError("proof request must be a UUID");
    const proof = await db.query(
      `SELECT id, org_id, rule_set_id, environment, identity_fingerprint, provider_request_id
         FROM offersiq_requests WHERE provider_request_id = $1 AND environment = $2
          AND finished_at IS NOT NULL AND status <> 'in_flight'
          AND ($3::uuid IS NULL OR org_id = $3) ORDER BY id LIMIT 2`, [loadedProofRequest, environment, orgId]);
    if (proof.rows.length !== 1) throw new OffersIqToolError("proof request must identify exactly one finished receipt in scope");
    proofRow = proof.rows[0];
    result.providerCalls++;
    proofSummary = checkedSummary(await client.reevaluateOffersIq({ requestId: loadedProofRequest }), proofRow, summarize, now);
    if (classify(proofSummary, config).ruleListStatus !== "matched") {
      throw new OffersIqToolError("CRS rule list does not match the configured questions; bulk reevaluation refused");
    }
    result.loadedRuleListVerified = true;
  }
  for await (const rows of finishedOffersIqPages(db, { environment, orgId, pageSize })) {
    for (const row of rows) {
      if (!UUID.test(row.provider_request_id || "")) { result.skippedNoProviderRequest++; continue; }
      // A proof only establishes the rule set it actually re-read.
      if (environment === "production" && Number(row.rule_set_id) !== Number(proofRow.rule_set_id)) {
        throw new OffersIqToolError("receipt uses a different rule set from the verified loaded list");
      }
      let summary;
      if (row.id === proofRow?.id) summary = proofSummary;
      else {
        result.providerCalls++;
        summary = checkedSummary(await client.reevaluateOffersIq({ requestId: row.provider_request_id }), row, summarize, now);
      }
      const score = classify(summary, config);
      // CRS may change a set during this run. Never overwrite a usable receipt
      // with a partial/mismatching list, even after an earlier proof passed.
      const noFile = score.ruleListStatus === "not_evaluated" && result.loadedRuleListVerified;
      if (score.ruleListStatus !== "matched" && !noFile) {
        throw new OffersIqToolError("reevaluated rule list no longer matches; rerun stopped");
      }
      if (noFile) result.noFileReceipts++;
      tally(result, score);
      await persist(db, row.id, row.org_id, summary, { config, reevaluated: true });
      result.written++;
    }
  }
  return result;
}

export function isToolEntryPoint(metaUrl, argv = process.argv) {
  return Boolean(argv[1]) && metaUrl === pathToFileURL(argv[1]).href;
}

// Driver errors can contain DB endpoints or provider text. CLI failure output
// is deliberately fixed; tests and operators can inspect a thrown error in-process.
export async function runToolMain(main) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof OffersIqToolError ? error.message
      : "OffersIQ tool stopped. Check database access and the selected environment before retrying.");
    process.exitCode = 1;
  }
}
