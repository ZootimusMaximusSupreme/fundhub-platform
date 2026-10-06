// Test-only stand-ins for the flywheel stages (unit X3): a campaign whose steps
// 1 to 3 are done and approved, a GitHub reader over it, and a stand-in model
// that answers every prompt the copy and strategy stages send. Imported by
// src/marketing/flywheel/stage-runs.test.mjs and
// src/http/marketing-flywheel.pg.test.mjs. Nothing in the app imports this.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANGLES_SCHEMA, PIECE_SCHEMA } from "../flywheel/copy-stage.mjs";
import { PLAN_SCHEMA } from "../flywheel/strategy-stage.mjs";
import { stampStage, hashOf } from "../flywheel/stamp.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FAKE_SHA = "f".repeat(40);
const CARD = "\n## Review card\n\n**What this decided:** x\n";

/** capital-blueprint with steps 1 to 3 done and approved (file name -> text). */
export function campaignFiles() {
  const avatar = stampStage({ stage: 1, version: 1, status: "approved", counts: { quotes: 30, languageEntries: 120 }, body: `# Buyer\nBrokers who lost a deal.${CARD}` });
  const research = stampStage({ stage: 2, version: 1, status: "approved", inputs: { "01-avatar.md": hashOf(avatar) },
    counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: `# Market${CARD}` });
  const offer = stampStage({ stage: 3, version: 1, status: "approved",
    inputs: { "01-avatar.md": hashOf(avatar), "02-ad-research.md": hashOf(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
    body: `# Capital Blueprint offer\nThe program is $5,000. A plan in 30 days.${CARD}` });
  return {
    "00-OWNER-NOTES.md": "# n\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n\n2026-10-01 | stage 4 | say the price out loud\n2026-10-01 | stage 2 | not for step 4\n",
    "01-avatar.md": avatar,
    "01-avatar/Market_Language_Bank.md": "# Bank\n- my file got declined\n",
    "02-ad-research.md": research,
    "03-offer.md": offer
  };
}

/** GitHub stand-ins over `files` for capital-blueprint; other repo files come from this checkout. */
export function readerDeps(files, { campaign = "capital-blueprint" } = {}) {
  const prefix = `marketing/flywheel/${campaign}/`;
  return {
    getRef: async () => ({ ok: true, sha: FAKE_SHA }),
    listFolder: async () => ({ ok: true, entries: [{ name: campaign, type: "dir" }] }),
    getContents: async (p) => {
      if (!p.startsWith(prefix)) {
        try { return { ok: true, content: fs.readFileSync(path.join(ROOT, p), "utf8") }; } catch { return { ok: true, missing: true, content: null }; }
      }
      const name = p.slice(prefix.length);
      return files[name] == null ? { ok: true, missing: true, content: null } : { ok: true, content: files[name] };
    },
    pendingRows: async () => [],
    // Unit GL: the stage reader also asks for the newest approved offer run.
    approvedOffer: async () => null
  };
}

const WORDS = ["amber", "birch", "cedar", "dune", "ember", "fjord"];
const angle = (i) => ({ angleId: `reason-${WORDS[i]}`, theReason: `reason ${i}`, audience: "in-market", hookType: "circumstance",
  theSpecificPain: `pain ${i}`, whyItIsDifferent: `only ${i}`, ownClosingIdea: `close ${i}` });

/**
 * fakeModel({ dirty }) → { call, calls }. dirty: { "reason-birch": true } makes
 * that reason's first draft use a banned word (cleaned in one pass);
 * "always" keeps an em dash through every rewrite (dropped after 3 passes).
 */
export function fakeModel({ dirty = {} } = {}) {
  const calls = [];
  const call = async (args) => {
    calls.push(args);
    const usage = { input_tokens: 1000, output_tokens: 200 };
    const reply = (json, text = null) => ({ mode: "live", json, text: text ?? JSON.stringify(json), error: null, usage, servedModel: args.model, stopReason: "end_turn" });
    const u = String(args.user);
    if (args.outputSchema === ANGLES_SCHEMA) return reply({ angles: WORDS.map((_, i) => angle(i)), fewerThanAskedBecause: "the offer supports six" });
    if (args.outputSchema === PIECE_SCHEMA) {
      const id = /YOUR REASON \(([^)]+)\)/.exec(u)[1];
      const w = id.replace("reason-", "");
      const hook = dirty[id] === "always" ? `We ${w} it — fast, for $5,000.` : dirty[id] ? `We leverage ${w} for $5,000.` : `Your ${w} file was read wrong, and $5,000 fixes that.`;
      return reply({
        pieces: ["short", "mid", "long"].map((length) => ({ length, hook, body: `The ${w} lender looked twice. It took 30 days.`, cta: `Ask about the ${w} ${length} ${w}stone ${w}field review` })),
        emailSubjects: [`${w} and $5,000`, `${w} in 30 days`, `the ${w} file`]
      });
    }
    if (/Attack this copy/.test(u)) return reply({ findings: [] });
    if (/Rewrite this copy/.test(u)) {
      const w = (/The (\w+) lender/.exec(u) || [])[1] || "plain";
      const still = dirty[`reason-${w}`] === "always";
      return reply({
        hook: still ? `Still — ${w} for $5,000.` : `We read the ${w} file again for $5,000.`,
        body: `The ${w} lender looked twice. It took 30 days.`,
        cta: `Ask about the ${w} rewrite ${w}stone ${w}field review`
      });
    }
    if (/PROMISE VERSUS TERMS|HUMAN VOICE|SAMENESS/.test(u)) return reply({ issues: /SAMENESS/.test(u) ? ["two hooks start the same way"] : [] });
    if (/Write the copy document/.test(u)) return reply(null, "# Doc — by the writer\nAs of x\n\n## 1. Hooks\nhook one\n\n## Review card\n\n**What this decided:** run three hooks.\n");
    if (/Read the real operating numbers/.test(u)) {
      return reply({ dailyBudget: "$200 (ops/workflows/ads-waterfall-projections-2026-08-26.md)", costPerBookedCall: "unknown", closeRate: "unknown", cashPerBookedCall: "unknown", sourceFiles: ["x"], missingFiles: ["ops/workflows/ads-revenue-model-2026-08-24.md"], notes: "n" });
    }
    if (args.outputSchema === PLAN_SCHEMA) {
      const next = /next step up/.test(u);
      return reply({ strategyName: "The Forester", whyThisOne: "thin library", dailyBudget: next ? "$500" : "$200", campaignStructure: "one bin",
        adSets: [{ name: "bin 1", audience: "cold", creativeIds: ["REASON-AMBER-SHORT"], dailyBudget: "$15" }],
        targetingJson: next ? JSON.stringify({ age_min: 25, age_max: 65 }) : JSON.stringify({ age_min: 18, age_max: 65, geo_locations: { countries: ["US"] } }),
        creativeNeeded: 6, rotationRule: "weekly", whenToScale: "after 3 sales", whenToStop: "no leads in 7 days", assumptions: ["ASSUMPTION: x"] });
    }
    if (/WILL META ACCEPT THIS|BUDGET REALISM|CREATIVE SUPPLY/.test(u)) {
      return reply({ issues: /WILL META/.test(u) ? ["the 2.5x plan narrows the age range"] : [], verdicts: [{ tactic: "age 25+", verdict: "rejected", substitute: "18-65" }], ok: !/WILL META/.test(u) });
    }
    if (/Fix these problems/.test(u)) return reply(null, "Plan 1: The Forester at $200 a day. Plan 2: ages 18 to 65.");
    if (/Write the ad strategy document/.test(u)) return reply(null, "# Strategy\n\nRun the Forester.\n\n## Review card\n\n**What this decided:** the Forester at $200.\n");
    throw new Error(`the stand-in model got a prompt it does not know: ${u.slice(0, 80)}`);
  };
  return { call, calls };
}
