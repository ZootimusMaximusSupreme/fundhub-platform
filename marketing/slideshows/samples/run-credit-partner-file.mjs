#!/usr/bin/env node
// Runs the credit-partner sample pair (./credit-partner-file.mjs) through the real
// UnderwriteIQ engine and writes ./credit-partner-file.result.json.
//
//   node marketing/slideshows/samples/run-credit-partner-file.mjs           write the JSON
//   node marketing/slideshows/samples/run-credit-partner-file.mjs --check   exit 1 if a fresh run differs from the saved JSON
//
// No database, no network, no bureau. SIMULATED files (see credit-partner-file.mjs).
//
// THE ENGINE. The same calls run-red-flag-file.mjs makes, the way the product
// runs a pull: runTierEngineFromCrsResult() (src/finance/crs-tier.mjs) through
// scoreBuyerTotal() (src/finance/crs-pull.mjs), on the CRS engine
// (src/finance/vendor/crs-engine.cjs). Each person's file is run on its own.
//
// THE SUM. After a pull, the product stores the engine's figure on the client
// as analyzer_prequal_amount and total_funding_estimate
// (src/handlers/client-lifecycle.mjs, crs.result handler). The Blueprint's
// credit partner rule adds the owner's stored figure and the partner's stored
// figure (src/blueprint/credit-partner.mjs combinedPrequalAmount). This script
// stores each figure the same way and calls that function. Nothing is added by
// hand.
//
// THE CLOCK. Pinned to the pull day before any engine module loads, as
// run-red-flag-file.mjs does, so every run writes byte-identical JSON.

import { mock } from "node:test";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const repo = (p) => new URL(`../../../${p}`, import.meta.url).href;

const { buildPersonFile, SAMPLE_NOTICE, PULLED_AT, OWNER, PARTNER } = await import("./credit-partner-file.mjs");

process.removeAllListeners("warning");
mock.timers.enable({ apis: ["Date"], now: Date.parse(PULLED_AT) });

const crsEngine = (await import(repo("src/finance/vendor/crs-engine.cjs"))).default;
const { runTierEngineFromCrsResult } = await import(repo("src/finance/crs-tier.mjs"));
const { scoreBuyerTotal } = await import(repo("src/finance/crs-pull.mjs"));
const { combinedPrequalAmount } = await import(repo("src/blueprint/credit-partner.mjs"));

const OUT = here("./credit-partner-file.result.json");
const referenceDate = new Date(PULLED_AT);
const runEngine = (args) => crsEngine.runCRSEngine({ ...args, referenceDate });
const runTier = (pull, opts) => runTierEngineFromCrsResult(pull, opts, { runEngine });

const pct = (balance, limit) => Math.round((balance / limit) * 100);

function runPerson(person) {
  const file = buildPersonFile(person);
  const tierOpts = {
    submittedName: person.name,
    submittedAddress: person.addressLine,
    formData: { name: person.name, email: null, phone: null }
  };
  const { tierResult, fundingEstimate } = scoreBuyerTotal(runTier, file, tierOpts);
  const p = tierResult.preapprovals;
  const cs = tierResult.consumerSignals;
  const cardLimit = person.cards.reduce((n, c) => n + c.limit, 0);
  const cardBalance = person.cards.reduce((n, c) => n + c.balance, 0);
  return {
    stored_custom_fields: { analyzer_prequal_amount: fundingEstimate, total_funding_estimate: fundingEstimate },
    view: {
      name: person.name,
      name_note: "Made up. Sample address and employer.",
      role: person.role,
      scores: { experian: person.scores.EX, equifax: person.scores.EQ, transunion: person.scores.TU, median: cs.scores.median },
      funding_total: fundingEstimate,
      outcome: tierResult.outcome,
      decision_label: tierResult.decision_label,
      funding: {
        personal_card: { base: p.personalCard.base, final: p.personalCard.final },
        personal_loan: { base: p.personalLoan.base, final: p.personalLoan.final },
        business: { final: p.business.final },
        modifiers: p.personalCard.modifiers
      },
      card_use: { band: cs.utilization.band, pct: cs.utilization.pct },
      cards: person.cards.map((c) => ({ creditor: c.creditor, opened: c.opened, limit: c.limit, balance: c.balance, pct_used: pct(c.balance, c.limit) })),
      cards_total: { limit: cardLimit, balance: cardBalance, pct_used: pct(cardBalance, cardLimit) },
      loans: person.loans.map((l) => ({ creditor: l.creditor, status: "Closed, paid in full", opened: l.opened, closed: l.closed, original_amount: l.high })),
      collections: person.collections.map((c) => ({ creditor: c.creditor, balance: c.balance, opened: c.opened, reported_to: c.bureaus.map((b) => ({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" }[b])) })),
      negatives_by_bureau: Object.fromEntries(Object.entries(cs.bureauNegatives).map(([b, v]) => [b, { clean: v.clean, count: v.count }])),
      inquiries: person.inquiries.map((i) => ({ who_pulled: i.creditorName, bureau: i.bureau, date: i.date, why: i.why })),
      reason_codes: tierResult.reason_codes
    }
  };
}

const owner = runPerson(OWNER);
const partner = runPerson(PARTNER);
const combined = combinedPrequalAmount(owner.stored_custom_fields, partner.stored_custom_fields);

const result = {
  _meta: {
    simulated: true,
    notice: SAMPLE_NOTICE,
    what: "Two simulated people, one credit file each, run one at a time through the real UnderwriteIQ CRS engine. Each figure is the engine's. The total is the Capital Blueprint's own credit partner rule adding the two stored figures. Nothing is typed in by hand.",
    sample_file: "marketing/slideshows/samples/credit-partner-file.mjs",
    runner: "marketing/slideshows/samples/run-credit-partner-file.mjs",
    engine: "src/finance/vendor/crs-engine.cjs runCRSEngine, through src/finance/crs-tier.mjs runTierEngineFromCrsResult and src/finance/crs-pull.mjs scoreBuyerTotal",
    combine_rule: "src/blueprint/credit-partner.mjs combinedPrequalAmount, reading the field src/handlers/client-lifecycle.mjs stores the engine's figure in (analyzer_prequal_amount)",
    clock: `Pinned to the pull day, ${PULLED_AT}, so the result is the same on every run.`,
    reproduce: [
      "node marketing/slideshows/samples/run-credit-partner-file.mjs",
      "node marketing/slideshows/samples/run-credit-partner-file.mjs --check"
    ]
  },
  headline: {
    owner_alone: owner.view.funding_total,
    partner_alone: partner.view.funding_total,
    together: combined,
    times_the_owner_alone: owner.view.funding_total > 0 ? Math.round((combined / owner.view.funding_total) * 100) / 100 : null,
    method: "Each file through the engine on its own, then the credit partner rule adds the two."
  },
  owner: owner.view,
  partner: partner.view
};

const json = `${JSON.stringify(result, null, 2)}\n`;
mock.timers.reset();

if (process.argv.includes("--check")) {
  const saved = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const sha = (s) => createHash("sha256").update(s).digest("hex");
  if (saved !== json) {
    console.error(`credit-partner-file.result.json differs from a fresh run (saved ${sha(saved).slice(0, 12)}, fresh ${sha(json).slice(0, 12)}).`);
    process.exit(1);
  }
  console.log(`credit-partner-file.result.json matches a fresh run (sha256 ${sha(json)}).`);
} else {
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}`);
  console.log(`Owner ${owner.view.outcome} $${owner.view.funding_total.toLocaleString("en-US")} + partner ${partner.view.outcome} $${partner.view.funding_total.toLocaleString("en-US")} = $${combined.toLocaleString("en-US")}`);
}
