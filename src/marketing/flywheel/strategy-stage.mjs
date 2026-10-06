// @ts-check
// Flywheel step 5, "Which ad strategy", on the server: .claude/workflows/
// ad-strategy.js ported to saved steps on the marketing worker.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 J5 and §3.2 row 5
// ("Strategy name, day-one cost before anything is learned, creative needed vs
// on hand, tactics Meta would reject; 05-ad-strategy.md ... doctrine bundled in
// src/"). Unit X3. Spends no ad money: it writes a plan, nothing touches Meta.
//
// THE SAME FOUR PHASES:
//   Ground   the real numbers. In chat an agent read files off the laptop; here
//            code reads them (the repo files on GitHub, else beside the code)
//            and the company's own saved spend and results for the last 30
//            Arizona days (src/marketing/metrics.mjs readTotals, as staff), and
//            one model call sorts them into the facts, naming the source of
//            each and listing what was missing. No benchmark from memory.
//   Doctrine the bundled excerpts (doctrine.mjs), no call.
//   Build    one plan per spend level (now, and about 2.5 times now).
//   Check    "will Meta accept this" runs the repo's own targeting screen
//            (src/compliance/targeting.mjs screenTargeting) IN CODE on every
//            plan's targeting; the model reads its exact output. Budget realism
//            and creative supply are the other two lenses. One repair, then stop.
// Then the document with its review card, stamped and saved through the outbox.

import { runSteps, OPUS, SONNET, StageStop, callReserveUsd } from "./steps.mjs";
import { readFlywheel, readRepoFile } from "./reader.mjs";
import { campaignWords, notesForStage, offerKeyOf } from "./campaigns.mjs";
import { stampStage, nextVersion, hashOf, bodyOf, countsOf } from "./stamp.mjs";
import { saveStageFile, todayArizona } from "./save.mjs";
import { STRATEGY_DOCTRINE } from "./doctrine.mjs";
import { screenTargeting } from "../../compliance/targeting.mjs";
import { readTotals } from "../metrics.mjs";
import { spendWindow } from "./spend-read.mjs";
import { getOffer, formatCents } from "../../config/offers.mjs";
import { asStaff } from "../../partners/rls.mjs";

export const STAGE = 5;
export const FILE = "05-ad-strategy.md";

/** The files the chat version's ground step read (ad-strategy.js Ground). */
export const GROUND_FILES = Object.freeze([
  "ops/workflows/ads-waterfall-projections-2026-08-26.md",
  "ops/workflows/ads-revenue-model-2026-08-24.md",
  "marketing/ads/ascension/ascension-ads.md"
]);

const str = { type: "string" };
const strs = { type: "array", items: str };

const GROUND_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["dailyBudget", "costPerBookedCall", "closeRate", "cashPerBookedCall", "sourceFiles", "missingFiles", "notes"],
  properties: {
    dailyBudget: str, costPerBookedCall: str, closeRate: str, cashPerBookedCall: str,
    sourceFiles: strs, missingFiles: strs, notes: str
  }
};

export const PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["strategyName", "whyThisOne", "dailyBudget", "campaignStructure", "adSets", "targetingJson",
    "creativeNeeded", "rotationRule", "whenToScale", "whenToStop", "assumptions"],
  properties: {
    strategyName: str, whyThisOne: str, dailyBudget: str, campaignStructure: str,
    adSets: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["name", "audience", "creativeIds", "dailyBudget"],
        properties: { name: str, audience: str, creativeIds: strs, dailyBudget: str }
      }
    },
    targetingJson: { type: "string", description: "the targeting payload exactly as it would be sent to Meta, as a JSON object in a string" },
    creativeNeeded: { type: "number" },
    rotationRule: str, whenToScale: str, whenToStop: str, assumptions: strs
  }
};

const CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["issues", "verdicts", "ok"],
  properties: {
    issues: strs,
    verdicts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["tactic", "verdict", "substitute"],
        properties: { tactic: str, verdict: str, substitute: str }
      }
    },
    ok: { type: "boolean" }
  }
};

const NO_INVENTED_BENCHMARKS = `HARD RULE ON NUMBERS: every number in the plan - cost per
thousand views, cost per click, cost per booked call, close rate, return on spend, budget split
- is either taken from Fundhub's own recorded results with the SOURCE NAMED, or it is labelled
ASSUMPTION with the reasoning shown. No benchmark numbers from memory. An invented benchmark is
what makes a bad plan look validated.`;

const SPEND_LEVELS = [
  "what we can run now, at the budget in the grounded facts",
  "the next step up, roughly 2.5x the current daily budget"
];

const usd = (cents) => (cents == null ? "unknown" : `$${(Number(cents) / 100).toFixed(2)}`);

/** Parse a plan's targeting and run the repo's own screen on it. Pure. */
export function screenPlan(plan) {
  let targeting = null;
  try { targeting = JSON.parse(String(plan.targetingJson || "")); } catch { targeting = null; }
  if (!targeting || typeof targeting !== "object" || Array.isArray(targeting)) {
    return { strategy: plan.strategyName, ok: false, reasons: ["the targeting was not a readable JSON object, so it cannot be checked"], targeting: null };
  }
  const out = screenTargeting(targeting, { platform: "meta" });
  // The screen's reasons are {code, message}; the plan, the page and the model read the message.
  const reasons = (out.reasons || []).map((r) => (r && typeof r === "object" ? String(r.message || r.code) : String(r)));
  return { strategy: plan.strategyName, ok: Boolean(out.ok), reasons, targeting };
}

export function initState(job) {
  const p = job.payload || {};
  return {
    campaign: String(p.campaign),
    note: typeof p.note === "string" ? p.note : "",
    today: typeof p.today === "string" ? p.today : todayArizona(),
    inputs: null, facts: null, plans: [], screens: [], checks: [], issues: [], verdicts: [],
    repaired: null, document: null, counts: {}
  };
}

export function steps(ctx) {
  const reserveSonnet = (chars, max) => callReserveUsd(SONNET, { inputChars: chars, maxTokens: max });
  const reserveOpus = (chars, max) => callReserveUsd(OPUS, { inputChars: chars, maxTokens: max });
  return [
    {
      name: "inputs",
      word: "reading the offer, the copy and the real numbers",
      run: async (s) => {
        const read = await readFlywheel({ db: ctx.db, orgId: ctx.orgId, campaign: s.campaign, env: ctx.env, deps: (ctx.deps && ctx.deps.reader) || {} });
        const f = read.files || {};
        const text = (name) => (f[name] && f[name].text != null ? f[name].text : null);
        const offer = bodyOf(text("03-offer.md"));
        if (!offer) throw new StageStop(`There is no offer on file for ${campaignWords(s.campaign, text("00-OWNER-NOTES.md"))}. Finish step 3 (the offer) first.`);
        const copyText = text("04-copy.md");
        const notesText = text("00-OWNER-NOTES.md");
        const offerKey = offerKeyOf(s.campaign, notesText);
        const o = offerKey ? getOffer(offerKey) : null;

        // The company's own results, as staff (ads and ad_metrics_daily force
        // partner row-level security; a bare read would say "no spend").
        const { from, to } = spendWindow((ctx.deps && ctx.deps.now) ? new Date(ctx.deps.now()) : new Date());
        const totals = await (ctx.deps && ctx.deps.readTotals
          ? ctx.deps.readTotals({ from, to })
          : asStaff((tx) => readTotals(tx, { orgId: ctx.orgId, from, to }), ctx.deps && ctx.deps.scope));

        const files = [];
        for (const p of GROUND_FILES) {
          const r = await readRepoFile(p, { env: ctx.env, deps: (ctx.deps && ctx.deps.reader) || {} });
          files.push({ path: p, text: r.text ? r.text.slice(0, 6000) : null, source: r.source });
        }
        const days = 30;
        s.inputs = {
          offer: offer.slice(0, 6000),
          copy: bodyOf(copyText).slice(0, 7000),
          creativeCount: Number(countsOf(copyText).hooks) || 0,
          notes: [notesForStage(notesText, STAGE), s.note ? `${s.today} | stage 5 | ${s.note}` : ""].filter(Boolean).join("\n").slice(0, 2000),
          offerLine: o ? `${o.name} (${o.key}), list price ${formatCents(o.priceCents) || "unknown"} (src/config/offers.mjs)` : "unknown: the campaign's owner notes name no offer key",
          own: {
            window: `${from} to ${to} (30 Arizona days ending yesterday)`,
            spend: usd(totals.spend_cents),
            dailyAverage: totals.spend_cents == null ? "unknown" : usd(Math.round(Number(totals.spend_cents) / days)),
            leads: totals.leads, booked: totals.booked, sales: totals.sales,
            cash: usd(totals.cash_cents),
            source: "ad_metrics_daily and the lead tags, read by src/marketing/metrics.mjs readTotals"
          },
          files,
          hashes: { "03-offer.md": hashOf(text("03-offer.md")), "04-copy.md": hashOf(copyText) },
          version: nextVersion(text(FILE)),
          campaignName: campaignWords(s.campaign, notesText),
          source: read.source
        };
        return "done";
      }
    },
    {
      name: "ground",
      word: "reading the real budget and results",
      run: async (s, t) => {
        if (await t.fit(1, reserveSonnet(24000, 3000)) < 1) throw t.stopAtCap("reading the real numbers");
        const i = s.inputs;
        const fileBlocks = i.files.map((f) => f.text
          ? `FILE ${f.path} (read from ${f.source}):\n${f.text}`
          : `FILE ${f.path}: MISSING (not in the repo copy this step can read)`).join("\n\n");
        s.facts = await t.ask({
          label: "ground", model: SONNET, schema: GROUND_SCHEMA, maxTokens: 3000, effort: "medium",
          user: `Read the real operating numbers before any plan is written.

THE OFFER BEING SOLD: ${i.offerLine}

OUR OWN SAVED RESULTS (${i.own.source}), ${i.own.window}:
- ad spend: ${i.own.spend} (about ${i.own.dailyAverage} a day)
- leads: ${i.own.leads}, calls booked: ${i.own.booked}, paid in our checkout: ${i.own.sales}, cash: ${i.own.cash}

${fileBlocks}

Report:
- the daily ad budget actually being modelled, not an aspirational one
- cost per booked call, close rate, and cash per booked call, with the source each came from
- what the offer being sold costs
- anything already decided about how these campaigns run

A missing file is a finding. Say so rather than filling the gap. Say "unknown" for a number no
source gives.

${NO_INVENTED_BENCHMARKS}`
        });
        return "done";
      }
    },
    {
      name: "plans",
      word: "building one plan for each spend level",
      run: async (s, t) => {
        const k = await t.fit(SPEND_LEVELS.length, reserveOpus(30000, 6000));
        if (k < 1) throw t.stopAtCap("building the plans");
        const levels = SPEND_LEVELS.slice(0, k);
        const facts = JSON.stringify(s.facts || {}, null, 1).slice(0, 5000);
        const i = s.inputs;
        s.plans = await Promise.all(levels.map((level, n) => t.ask({
          label: `plan-${n + 1}`, model: OPUS, schema: PLAN_SCHEMA, maxTokens: 6000, effort: "medium",
          user: `Choose the campaign strategy and build the plan. Do not invent a strategy - pick from the
named ones in the doctrine using its own selection rule.

SPEND LEVEL FOR THIS PLAN: ${level}

THE REAL NUMBERS:
${facts}

CREATIVE THAT ACTUALLY EXISTS: ${i.creativeCount} written ad pieces from step 4 (written copy, not
filmed videos; how many videos are filmed is not counted here).
${i.copy ? `\nWhat the copy stage produced:\n${i.copy}` : ""}

THE OFFER:
${i.offer}

THE DOCTRINE:
${STRATEGY_DOCTRINE}
${i.notes ? `\nCORRECTIONS CHRIS HAS ALREADY MADE - these override everything:\n${i.notes}` : ""}

Two things that will make this plan wrong if you ignore them:

1. The doctrine's lowest scaling chapter assumes a far larger daily budget than this business
   actually spends. If a step only works at ten times the real budget, do not write it - say
   the budget does not reach it.
2. A strategy that needs more creative than the ${i.creativeCount} pieces that exist is fiction.
   Check the requirement before you choose. And count REASONS, not pieces - Meta's Andromeda
   algorithm wants 15 to 20 genuinely different arguments, each with its own hook, body and
   close. Length variants of one argument do not count toward that floor.

Give the targeting as targetingJson: the actual payload object, the way it would be sent to
Meta, written as JSON in that one string, because it is about to be run through a checker.

Name every ad set's creative by the pieceIds from the copy stage. Those ids are how spend gets
matched back to an angle later.

${NO_INVENTED_BENCHMARKS}`
        })));
        if (!s.plans.length) throw new Error("No plan came back.");
        s.counts = { ...s.counts, plans: s.plans.length };
        return "done";
      }
    },
    {
      name: "checks",
      word: "checking Meta would accept it, the budget and the creative",
      run: async (s, t) => {
        // The repo's own targeting screen, in code (ad-strategy.js told an agent to run it).
        s.screens = s.plans.map(screenPlan);
        if (await t.fit(3, reserveSonnet(30000, 3000)) < 3) throw t.stopAtCap("checking the plans");
        const plans = JSON.stringify(s.plans).slice(0, 12000);
        const facts = JSON.stringify(s.facts || {}, null, 1).slice(0, 5000);
        const n = s.inputs.creativeCount;
        s.checks = await Promise.all([
          t.ask({ label: "check-will-it-run", model: SONNET, schema: CHECK_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `WILL META ACCEPT THIS. Credit and lending advertisers sit in a restricted
category on Meta, and several ordinary targeting tactics are simply rejected there. A plan that
uses one does not underperform - it does not run at all.

The repo's own checker (src/compliance/targeting.mjs screenTargeting, platform meta) has
already been run on every plan's targeting. Its exact output:
${JSON.stringify(s.screens.map((x) => ({ strategy: x.strategy, ok: x.ok, reasons: x.reasons })), null, 1)}

Then read the plans and mark every TACTIC as permitted, rejected, or needs-substitute. Where a
tactic is rejected, name the legal substitute (substitute is "" when none is needed). The
playbook these plans came from never mentions this category, and it recommends lookalike
audiences repeatedly, so check for that specifically. Set ok to false when any plan's
targeting failed the checker.

THE PLANS:
${plans}` }),
          t.ask({ label: "check-budget", model: SONNET, schema: CHECK_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `BUDGET REALISM. Does every instruction in these plans actually work at the real
daily budget?

THE REAL NUMBERS:
${facts}

Check specifically:
- any step that silently assumes several times the real budget
- a structure with so many ad sets that none of them gets enough spend to learn
- the implied cost to get one customer against what the offer is worth in its first 30 days
- whether the creative rotation rate is affordable at this spend

Put tactic verdicts in verdicts only if you judged a tactic; otherwise leave it empty.

THE PLANS:
${plans}` }),
          t.ask({ label: "check-creative-and-andromeda", model: SONNET, schema: CHECK_SCHEMA, maxTokens: 3000, effort: "medium",
            user: `CREATIVE SUPPLY, AND THE ANDROMEDA FLOOR. ${n} written creative pieces exist.

Two separate questions, and the second one is the one people get wrong.

1. Does each plan need more pieces than exist?

2. How many DISTINCT REASONS do those pieces actually cover? Meta's Andromeda algorithm
   (fully rolled out ~July 2025) rewards messaging range, not piece count. Fifteen ads built
   on one argument are one ad as far as the auction is concerned, and the floor for a stable
   account is 15 to 20 genuinely different reasons, each filmed end to end with its own hook,
   body and close.

   So: count the reasons, not the files. Short, mid and long cuts of one argument are ONE
   reason. If the set is short of 15 distinct reasons, say so plainly.

Also check FORMAT, not just count: a plan whose audience-building depends on video views
cannot run on written scripts.

For each plan report what it needs, what exists, and the shortfall. Put tactic verdicts in
verdicts only if you judged a tactic; otherwise leave it empty.

THE PLANS:
${plans}` })
        ]);
        s.issues = [
          ...s.screens.filter((x) => !x.ok).map((x) => `${x.strategy}: the targeting screen rejected it: ${x.reasons.join("; ")}`),
          ...s.checks.flatMap((c) => c.issues || [])
        ];
        s.verdicts = s.checks.flatMap((c) => c.verdicts || []);
        s.counts = { ...s.counts, issues: s.issues.length };
        return "done";
      }
    },
    {
      name: "repair",
      word: "fixing what the checks found",
      run: async (s, t) => {
        if (!s.issues.length) return "done";
        if (await t.fit(1, reserveOpus(30000, 6000)) < 1) throw t.stopAtCap("fixing the plans");
        s.repaired = await t.ask({ label: "repair", model: OPUS, maxTokens: 6000, effort: "medium",
          user: `Fix these problems in the plans. Change only what is named.

If a targeting tactic was rejected, replace it with the named substitute. If a step needs more
budget than exists, remove it and say the budget does not reach it. If a plan needs more
creative than exists, say so plainly rather than quietly reducing the requirement.

ISSUES:
${s.issues.map((i) => "- " + i).join("\n")}

TACTIC VERDICTS:
${JSON.stringify(s.verdicts).slice(0, 4000)}

THE PLANS:
${JSON.stringify(s.plans).slice(0, 12000)}

Return the corrected plans as prose, not JSON.` });
        return "done";
      }
    },
    {
      name: "assemble",
      word: "writing the strategy document",
      run: async (s, t) => {
        if (await t.fit(1, reserveOpus(36000, 10000)) < 1) throw t.stopAtCap("writing the strategy document");
        let doc = await t.ask({ label: "assemble", model: OPUS, maxTokens: 10000, effort: "low",
          user: `Write the ad strategy document for ${s.campaign}, as of ${s.today}.

THE PLANS:
${s.repaired || JSON.stringify(s.plans, null, 1).slice(0, 14000)}

TACTIC VERDICTS - which tactics Meta will accept in this category:
${JSON.stringify(s.verdicts).slice(0, 5000)}

THE TARGETING SCREEN (src/compliance/targeting.mjs), exact output:
${JSON.stringify(s.screens.map((x) => ({ strategy: x.strategy, ok: x.ok, reasons: x.reasons })))}

ISSUES FOUND AND WHAT WAS DONE:
${s.issues.map((i) => "- " + i).join("\n").slice(0, 5000)}

THE REAL NUMBERS:
${JSON.stringify(s.facts || {}, null, 1).slice(0, 5000)}

Write it so Chris can act on it. Sections:
1. Which strategy, and why that one.
2. What it costs on day one, before anything is learned.
3. The campaign structure - what to build, in order.
4. Which creative goes where, by pieceId.
5. Tactics that would get the ads rejected, and what to use instead.
6. When to spend more, when to stop.
7. What this plan assumes, listed plainly, and what it needs that we do not have yet.

Plain words, short sentences. Chris does not read code. Do not use jargon without defining it
in five words on the spot. Do not use em dashes.

End with exactly this block, filled in:

## Review card

**What this decided:** <one sentence>

**Three things to check:** This needs <N> videos and <$X>/day - do we have that? · Day one costs <$Y> before we learn anything - yes? · Where does the traffic land?

**What I wasn't sure about:** <or "nothing">

**Say one of:** approve · tweak: <what to change> · redo` });
        if (!doc.includes("## Review card")) {
          doc = `${doc.trim()}\n\n## Review card\n\n**What this decided:** run ${s.plans[0].strategyName} at ${s.plans[0].dailyBudget} a day.\n\n**Three things to check:** Do we have the creative it needs? · Is the day-one cost a yes? · Where does the traffic land?\n\n**What I wasn't sure about:** the writer left the review card off, so this one was made from the plan.\n\n**Say one of:** approve · tweak: <what to change> · redo\n`;
        }
        s.document = doc.replace(/—/g, "-");
        return "done";
      }
    },
    {
      name: "save",
      word: "saving to the repo",
      run: async (s, t) => {
        const first = s.plans[0] || {};
        const counts = {
          strategyNamed: first.strategyName ? 1 : 0,
          dailyBudgetStated: first.dailyBudget ? 1 : 0,
          plansBuilt: s.plans.length,
          creativeAvailable: s.inputs.creativeCount
        };
        const body = `# ${s.inputs.campaignName} ads: what to run\nAs of ${s.today}\n\n${s.document.replace(/^#[^\n]*\n(As of[^\n]*\n)?/, "")}`;
        const text = stampStage({ stage: STAGE, version: s.inputs.version, inputs: s.inputs.hashes, counts, body });
        const saved = await saveStageFile(ctx, { campaign: s.campaign, file: FILE, text, jobId: ctx.jobId });
        const spent = await t.spentSoFar();
        return {
          done: {
            stage: STAGE, campaign: s.campaign, file: FILE, repo_path: saved.path, outbox_id: saved.outbox_id,
            version: s.inputs.version, counts, facts: s.facts, plans: s.plans, screens: s.screens,
            verdicts: s.verdicts, issues: s.issues, targeting_accepted: s.screens.every((x) => x.ok),
            missing_files: s.inputs.files.filter((f) => !f.text).map((f) => f.path),
            inputs_source: s.inputs.source, cost_usd: Math.round(spent * 10000) / 10000
          }
        };
      }
    }
  ];
}

/**
 * runStage(job, ctx) — the flywheel_stage handler's entry for stage 5.
 * @param {any} job
 * @param {any} ctx
 */
export async function runStage(job, ctx) {
  const c = { ...ctx, orgId: job.org_id, jobId: job.id };
  return runSteps(job, c, { stage: STAGE, steps: steps(c), init: initState });
}
