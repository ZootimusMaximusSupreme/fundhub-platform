// Guards for the batch 15 live checks (Lenders desk and Marketing Command Center).
//
// A live check is one read-only SQL text. This file runs that exact text over stand-in rows and
// shows, for every check:
//   1. good rows read as right (bad_count 0, the right sample_count);
//   2. every named bad condition, alone, makes the check go red on its own row;
//   3. the same row is NOT caught when that one condition is left out of the text, so each
//      condition is load-bearing and no row is double-counted;
//   4. another company's wrong row is never read.
// It also checks that every table and column in the text is a real one (db/schema and
// db/migrations), that the text is read-only, and that the registry holds the same text.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { MODEL_PRICES, FREE_MODELS, WEB_SEARCH_USD } from "../../../marketing/model-usage.mjs";
import {
  FIN_B15_CHECKS, FIN_B15_DISPLAY_CONTRACTS, FIN_B15_SOURCE_FILE, FUNNEL_COPY_SHAPE, METER_FREE_MODELS,
  METER_RATES, METER_SEARCH_USD, sqlFor
} from "./fin-b15-display-contracts.mjs";
import { REPO_ROOT, makeStandIn, schemaColumns, tablesIn } from "./fin-b15-sql-kit.mjs";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const T0 = "2026-10-10T12:00:00.000Z";
const OLD = "2026-05-01T12:00:00.000Z";

let counter = 0;
const nid = (p) => `${p}-${String(++counter).padStart(4, "0")}`;

/* ── row builders. Each gives a GOOD row; a test overrides one field to make it wrong. ── */
const lender = (o = {}) => ({ id: nid("lender"), org_id: ORG, lender_table: "OnlineBizCC", name: "First Bank", product_name: null, ...o });
const L0 = lender({ id: "lender-0000" });
const obs = (o = {}) => ({
  id: nid("obs"), org_id: ORG, review_status: "pending", mismatch_flag: true, observed_bureau: "TU",
  lender_name: "First Bank", lender_row_id: L0.id, ...o
});
const bureau = (o = {}) => ({
  id: nid("bureau"), org_id: ORG, bureau_code: "EX", bureau_name: "Experian", retry_limit: 3,
  retry_delay_minutes: 30, expected_hold_minutes: 12, last_verified_at: null, last_verified_by: null, ...o
});
/* cost_usd defaults to what the product writes for these tokens at the opus price (100 in, 100 out). */
const usage = (o = {}) => ({
  id: nid("usage"), org_id: ORG, model: "claude-opus-5-5", input_tokens: 100, output_tokens: 100,
  cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0, cost_usd: 0.0024, created_at: T0, ...o
});
const idea = (o = {}) => {
  const id = nid("idea");
  return { id, org_id: ORG, source: "chris", kind: "script", raw_points: "Make more of this angle: Inquiries off first.", angle_key: "inquiries", status: "new", ...o };
};
const ideaFile = (i, o = {}) => ({ org_id: i.org_id, op_id: `idea-file:${i.id}`, path: `marketing/ads/ideas/2026-10-10-${String(i.id).slice(0, 8)}.md`, mode: "replace", content: "---", ...o });
const job = (o = {}) => ({ id: nid("job"), org_id: ORG, kind: "deep_research", status: "queued", payload: {}, result: null, ...o });
const research = (o = {}) => job({
  kind: "deep_research", payload: { question: "What do banks check first?", depth: "quick", max_cost_usd: 5, sources: { web: true } }, ...o
});
const doneResearch = (o = {}) => research({
  status: "done", result: { report: { repo_path: "marketing/research/x/report.md", markdown: "# report" } }, ...o
});
const outbox = (o = {}) => ({ id: nid("outbox"), org_id: ORG, op_id: nid("op"), path: "marketing/flywheel/partner/02-ad-research.md", mode: "replace", content: "---\nstage: 2\nversion: 1\nstatus: draft\n---\nbody", ...o });
const funnel = (o = {}) => {
  const path = "path" in o ? o.path : "/blueprint";
  return {
    id: nid("funnel"), org_id: ORG, key: nid("fk"), kind: "book_a_call", path, tag: "fnl-blueprint", status: "draft",
    landing_url: path ? `https://apply.fundhub.ai${path}` : "https://fundhub.ai/offer",
    format_mix: { standard: 2, sorting: 1 }, meta_campaign_ids: [], default_ad_set_external_id: null, active: true, ...o
  };
};
const pages = (f, o = {}) => [
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "landing", path: f.path, ...o },
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "booking", path: `${f.path}-book`, ...o },
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "thank_you", path: `${f.path}-thank-you`, ...o }
];
/** A built page the way funnel-pages.mjs and funnel-tracking.mjs draw it. `leave` takes one thing out. */
const builtPage = (f, role, leave = null) => {
  const path = role === "landing" ? f.path : role === "booking" ? `${f.path}-book` : `${f.path}-thank-you`;
  const tag = `<meta name="fh-funnel-tag" content="${f.tag}">`;
  const config = `<script>window.FH_FUNNEL={"tag":"${f.tag}","page":{"role":"${role}","path":"${path}","step":1}};</script>`;
  const pixel = "<script>fbq('init','1');</script>";
  const link = role === "landing" ? `<a class="btn" href="${f.path}-book">Book</a>` : "";
  const hop = role === "booking" ? `<script>var TY=${JSON.stringify(`${f.path}-thank-you`)};</script>` : "";
  const attribution = '<script src="https://fundhub.ai/funnel/fh-attribution.js"></script>';
  const events = "<script defer src='https://fundhub.ai/funnel/fh-events.js'></script>";
  const head = [leave === "tag-in-head" ? "" : tag, leave === "config" ? "" : config, leave === "pixel" ? "" : pixel].join("");
  const afterHead = leave === "tag-in-head" ? tag : "";
  return `<html><head>${head}</head><body>${afterHead}${link}${hop}${leave === "attribution" ? "" : attribution}${leave === "events" ? "" : events}</body></html>`;
};
const script = (o = {}) => {
  const id = nid("script");
  return {
    id, org_id: ORG, root_script_id: o.root_script_id || id, parent_script_id: null, version: 1, source: "machine",
    archived_at: null, ad_id: null, repo_path: null, fix_note: null, ...o
  };
};
const html = (tag) => `<html><head><meta name="fh-funnel" content="${tag}"><script>window.FH_FUNNEL={}</script><script>fbq('init','1')</script></head><body></body></html>`;
const video = (o = {}) => ({
  id: nid("video"), org_id: ORG, video_kind: "ad", status: "approved", approved_at: T0, approved_by: "Chris", loaded_at: null,
  meta_video_id: null, meta_creative_id: null, meta_ad_external_id: null, ad_row_id: null, load_error: null, ...o
});
const loadedVideo = (o = {}) => {
  const ad = nid("ad");
  return video({ loaded_at: T0, meta_video_id: "v1", meta_creative_id: "c1", meta_ad_external_id: `ext-${ad}`, ad_row_id: ad, ...o });
};
const adFor = (v, o = {}) => ({ id: v.ad_row_id, org_id: v.org_id, external_id: v.meta_ad_external_id, ...o });
const loadJob = (v, o = {}) => job({ kind: "meta_load", status: "done", payload: { ad_video_id: v.id }, result: { state: "loaded" }, ...o });
/** The receipt Turn on leaves (campaigns/write resume_ad -> guardedWrite -> action_log). */
const turnOnReceipt = (v, o = {}) => ({
  id: nid("alog"), org_id: v.org_id, partner_id: "partner-1", actor: "human", target_type: "ad", target_id: v.ad_row_id,
  reason: "Turn on Ad 90 (resume_ad, one ad)", after: { status: "ACTIVE", staff_id: "staff-1" },
  executed_at: T0, execute_error: null, created_at: T0, ...o
});
const brainFile = (jobRow, o = {}) => ({
  id: nid("brain"), org_id: jobRow.org_id, drive_file_id: `generated:deep-research:${String(jobRow.id).toLowerCase()}`,
  name: "Research: What do banks check first?", access_tier: "owner", source: "generated", ...o
});
const brainChunk = (f, text, o = {}) => ({ id: nid("chunk"), org_id: f.org_id, file_id: f.id, chunk_index: 0, content: text, access_tier: "owner", ...o });
const REPORT = "# Banks check your inquiries first\n\nThe lender looks at hard pulls in the last 24 months before it reads anything else on the file, and it counts them by bureau.";

const T = {
  lenders: "lenders", obs: "lender_bureau_observations", bureau: "ai_bureau_config", usage: "marketing_model_usage",
  ideas: "ad_ideas", outbox: "repo_outbox", jobs: "marketing_jobs", funnels: "marketing_funnels",
  pages: "marketing_funnel_pages", scripts: "ad_scripts", batches: "marketing_batches", videos: "ad_videos",
  ads: "ads", adsets: "ad_sets", campaigns: "campaigns", alog: "action_log", brainFiles: "brain_files",
  brainChunks: "brain_chunks"
};
const R = (table, row) => [table, row];

/* ── the fixtures: sample = how many rows the check should read, violations = one wrong row each ── */

const mismatchViolations = (extra = []) => ({
  "a mismatch names no bureau that was seen": [R(T.obs, obs({ observed_bureau: "  " }))],
  "a mismatch names no lender": [R(T.obs, obs({ lender_row_id: null, lender_name: "" }))],
  "a mismatch points at a lender of another company": (() => {
    const far = lender({ org_id: OTHER });
    return [R(T.lenders, far), R(T.obs, obs({ lender_row_id: far.id }))];
  })(),
  ...Object.fromEntries(extra)
});

const FIX = {
  "lenders-page-load": {
    good: [R(T.lenders, L0), R(T.obs, obs()), R(T.lenders, lender({ name: "", is_demo: true }))],
    sample: 2,
    violations: {
      "a lender has no name": [R(T.lenders, lender({ name: " " }))],
      ...mismatchViolations(),
      "the lender book is empty": { only: [R(T.lenders, lender({ is_demo: true }))], sample: 1 }
    }
  },
  "lenders-list-tab": {
    good: [R(T.lenders, lender()), R(T.lenders, lender({ name: "Second Bank" })),
      R(T.lenders, lender({ name: "First Bank", lender_table: "PersonalCC" })),
      // The same bank twice is not wrong (a bank can have two products), and a demo lender is not on the book.
      R(T.lenders, lender({ name: "First Bank" })), R(T.lenders, lender({ name: "", is_demo: true }))],
    sample: 4,
    violations: {
      "a lender has no name": [R(T.lenders, lender({ name: "" }))],
      "a lender dollar amount is below zero": [R(T.lenders, lender({ name: "Neg Bank", typical_approval_range: -5 }))],
      "a starting line is bigger than the biggest line ever seen": [R(T.lenders, lender({ name: "Big Start", average_starting_loc: 50000, max_known_loc: 20000 }))]
    }
  },
  "lenders-mismatch-tab": {
    good: [R(T.lenders, L0), R(T.obs, obs()), R(T.obs, obs({ review_status: "dismissed", observed_bureau: "" }))],
    sample: 1,
    violations: mismatchViolations()
  },
  "lenders-ai-bureau-tab": {
    good: [R(T.bureau, bureau()), R(T.bureau, bureau({ bureau_code: "EQ", bureau_name: "Equifax", last_verified_at: T0, last_verified_by: "Sam" }))],
    sample: 2,
    violations: {
      "a bureau setup has no code or no name": [R(T.bureau, bureau({ bureau_code: "" }))],
      "a bureau setup allows no tries": [R(T.bureau, bureau({ bureau_code: "TU", retry_limit: 0 }))],
      "a bureau setup waits a negative time": [R(T.bureau, bureau({ bureau_code: "TU", retry_delay_minutes: -1 }))],
      "a bureau setup says verified with nobody named": [R(T.bureau, bureau({ bureau_code: "TU", last_verified_at: T0, last_verified_by: " " }))]
    }
  },
  "mkt-month-meter": {
    // cost_usd is what the product writes: tokens at the model's price, plus a cent a web search.
    good: [
      R(T.usage, usage()),                                                         // opus: 100 in, 100 out
      R(T.usage, usage({ web_search_requests: 2, cost_usd: 0.0224 })),             // opus + two searches
      R(T.usage, usage({ model: "claude-sonnet-5-5", cost_usd: 0.0012 })),         // sonnet: 100 in, 100 out
      R(T.usage, usage({ model: "claude-sonnet-5-5", cache_read_tokens: 1000, cache_write_tokens: 400, cost_usd: 0.0024 })),
      R(T.usage, usage({ model: "claude-code", cost_usd: 0 })),
      R(T.usage, usage({ model: "gpt-4o-mini", cost_usd: null })),                 // no price on file: unknown is right
      R(T.usage, usage({ created_at: OLD, cost_usd: null }))                       // older than the window
    ],
    sample: 6,
    violations: {
      "a priced model was saved with an unknown cost": {
        rows: [R(T.usage, usage({ cost_usd: null })), R(T.usage, usage({ model: "claude-sonnet-5-5", cost_usd: null })),
          R(T.usage, usage({ model: "claude-code", cost_usd: null }))],
        bad: 3
      },
      "a call was saved at a cost that is not its tokens at the model's price": {
        rows: [
          R(T.usage, usage({ cost_usd: 0 })),                                      // opus saved free
          R(T.usage, usage({ model: "claude-sonnet-5-5", cost_usd: 0.0024 })),     // sonnet saved at the opus price
          R(T.usage, usage({ web_search_requests: 3, cost_usd: 0.0024 })),         // a search fee left out
          R(T.usage, usage({ model: "claude-code", cost_usd: 1 }))                 // the free model saved with a cost
        ],
        bad: 4
      }
    }
  },
  "mkt-ideas-make-more": (() => {
    const good = idea();
    const noFile = idea();
    const noAngle = idea({ angle_key: null });
    const noName = idea({ raw_points: "Make more of this angle: ." });
    return {
      good: [R(T.ideas, good), R(T.outbox, ideaFile(good)),
        R(T.ideas, idea({ raw_points: "Typed words with no prefix", angle_key: null }))],
      sample: 1,
      violations: {
        "a make-more idea carries no angle": [R(T.ideas, noAngle), R(T.outbox, ideaFile(noAngle))],
        "a make-more idea names no angle in its words": [R(T.ideas, noName), R(T.outbox, ideaFile(noName))],
        "a make-more idea has no file queued for the repo": [R(T.ideas, noFile)]
      }
    };
  })(),
  "mkt-numbers-make-more": (() => {
    const good = idea({ raw_points: "More hooks like the lenders read two files one." });
    const blank = idea({ raw_points: "  " });
    const noFile = idea({ raw_points: "No file for this one" });
    return {
      good: [R(T.ideas, good), R(T.outbox, ideaFile(good)), R(T.ideas, idea({ angle_key: null, raw_points: "" })),
        // not read here, and each would be red if its filter were dropped (held by the next two tests):
        R(T.ideas, idea({ source: "machine", raw_points: "A planner idea with an angle and no file" })),
        R(T.ideas, idea({ kind: "opening", raw_points: "An opening idea with an angle and no file" }))],
      sample: 1,
      violations: {
        "an angle idea has no words": [R(T.ideas, blank), R(T.outbox, ideaFile(blank))],
        "an angle idea has no file queued for the repo": [R(T.ideas, noFile)]
      }
    };
  })(),
  "mkt-research-form": (() => {
    const spendy = research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true, vault: true } } });
    const ranOver = research({ payload: { question: "Q", depth: "deep", max_cost_usd: 5, sources: { web: true, vault: true } } });
    const usageFor = (j, cost) => R(T.usage, usage({ job_id: j.id, cost_usd: cost }));
    return {
      good: [
        R(T.jobs, research()), R(T.jobs, doneResearch()), R(T.jobs, job({ kind: "avatar", payload: {} })),
        // each source box alone is a place to look; a belief of words is kept
        R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: false, vault: true, own_files: false } } })),
        R(T.jobs, research({ payload: { question: "Q", depth: "deep", max_cost_usd: 5, sources: { web: true, vault: false }, belief: "Banks check inquiries first." } })),
        // spent 9.99 of a 5.00 stop: a step already running may overshoot, but not past twice
        R(T.jobs, spendy), usageFor(spendy, 6), usageFor(spendy, 3.99)
      ],
      sample: 5,
      violations: {
        "a research run has no question": [R(T.jobs, research({ payload: { question: " ", depth: "quick", max_cost_usd: 5, sources: { web: true } } }))],
        "a research run has a depth the form does not offer": [R(T.jobs, research({ payload: { question: "Q", depth: "thorough", max_cost_usd: 5, sources: { web: true } } }))],
        "a research run has no stop amount above zero": [R(T.jobs, research({ payload: { question: "Q", depth: "deep", max_cost_usd: 0, sources: { web: true } } }))],
        "a research run kept no sources object": [R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5 } }))],
        "a research run was told to look nowhere": [
          R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: false, vault: false, own_files: true } } }))
        ],
        "a research run kept a belief that is not words or is too long": {
          rows: [
            R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true }, belief: "   " } })),
            R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true }, belief: "x".repeat(501) } }))
          ],
          bad: 2
        },
        "a research run spent more than twice its stop amount": [R(T.jobs, ranOver), usageFor(ranOver, 8), usageFor(ranOver, 2.5)],
        "a finished run names no repo file for its report": [R(T.jobs, doneResearch({ result: { report: { markdown: "# r" } } }))]
      }
    };
  })(),
  "mkt-research-card": (() => {
    const done = doneResearch();
    const approved = doneResearch({ approved_at: T0, approved_by: "staff-1" });
    const tweakParent = doneResearch();
    const saved = doneResearch({ result: { report: { repo_path: "marketing/research/x/report.md", markdown: REPORT } } });
    const savedFile = brainFile(saved);
    const noReport = brainFile({ org_id: ORG, id: "00000000-0000-4000-8000-0000000000f1" });
    const hollow = doneResearch({ result: { report: { repo_path: "marketing/research/x/report.md", markdown: REPORT } } });
    const hollowFile = brainFile(hollow);
    const wrong = doneResearch({ result: { report: { repo_path: "marketing/research/x/report.md", markdown: REPORT } } });
    const wrongFile = brainFile(wrong);
    const filed = (j) => R(T.outbox, outbox({ op_id: `research-${j.id}-report`, path: "marketing/research/x/report.md" }));
    return {
      good: [
        R(T.jobs, done), filed(done),
        R(T.jobs, approved), filed(approved),
        R(T.outbox, outbox({ op_id: `research-${approved.id}-approved`, path: "marketing/research/x/report.md" })),
        R(T.jobs, tweakParent), filed(tweakParent),
        R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true }, parent_id: tweakParent.id, focus: "look at fees" } })),
        // a saved page: its report, its chunks, and chunk 0 opens with the report's own words
        R(T.jobs, saved), filed(saved), R(T.brainFiles, savedFile),
        R(T.brainChunks, brainChunk(savedFile, REPORT)),
        R(T.brainChunks, brainChunk(savedFile, "the second part of the same report", { chunk_index: 1 })),
        // a page that is not a research report is not read here
        R(T.brainFiles, { id: nid("brain"), org_id: ORG, drive_file_id: "generated:weekly-ops-brief:2026-w41", name: "Weekly brief", source: "generated", access_tier: "owner" })
      ],
      sample: 5 + 1,
      violations: (() => {
        const noReportRun = doneResearch();
        const noApprovedFile = doneResearch({ approved_at: T0, approved_by: "staff-1" });
        const noPerson = doneResearch({ approved_at: T0, approved_by: null });
        return {
          "a finished report has no file queued": [R(T.jobs, noReportRun)],
          "an approved report has no approved file queued": [R(T.jobs, noApprovedFile), filed(noApprovedFile)],
          "an approval has no person behind it": [
            R(T.jobs, noPerson), filed(noPerson),
            R(T.outbox, outbox({ op_id: `research-${noPerson.id}-approved`, path: "marketing/research/x/report.md" }))
          ],
          "a tweak run points at no earlier run": [
            R(T.jobs, doneResearch({ id: "run-elsewhere", org_id: OTHER })),
            R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true }, parent_id: "run-elsewhere", focus: "fees" } }))
          ],
          "a tweak run has no note to look at": [R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, sources: { web: true }, parent_id: tweakParent.id, focus: " " } }))],
          "a brain page points at no finished report of this company": [R(T.brainFiles, noReport), R(T.brainChunks, brainChunk(noReport, REPORT))],
          // the embedding failed after the file row was written: a page with no chunks (and a second press says "unchanged")
          "a brain page holds no text the brain can answer from": [R(T.jobs, hollow), filed(hollow), R(T.brainFiles, hollowFile)],
          "a brain page opens with words that are not its report": [
            R(T.jobs, wrong), filed(wrong), R(T.brainFiles, wrongFile),
            R(T.brainChunks, brainChunk(wrongFile, "What do banks check first? (the question, not the report)"))
          ]
        };
      })()
    };
  })(),
  ...flywheelFixtures(),
  "mkt-funnel-rename": (() => {
    const good = funnel({ key: "fa" });
    const two = funnel({ key: "fb", path: "/two" });
    const hand = funnel({ key: "hand", kind: null, path: null });
    const few = funnel({ key: "few", path: "/few" });
    const moved = funnel({ key: "moved", path: "/moved" });
    // a funnel that is live keeps the address the live page proved; only a draft is held to its own address
    const live = funnel({ key: "live", path: "/liveone", status: "live", landing_url: "https://apply.fundhub.ai/liveone/" });
    const built = funnel({ key: "built", path: "/built" });
    const stale = funnel({ key: "stale", path: "/fresh" });
    // a rename that moved the funnel and its page rows but left one page drawn for the old address
    const drift = funnel({ key: "drift", path: "/new" });
    const landingOnly = funnel({ key: "land", path: "/lnd" });
    const bookingOnly = funnel({ key: "bkg", path: "/bkg" });
    const withPage = (f, role, html) => pages(f).map((p) => R(T.pages, p.role === role ? { ...p, html } : p));
    return {
      good: [R(T.funnels, good), ...pages(good).map((p) => R(T.pages, p)), R(T.funnels, two), ...pages(two).map((p) => R(T.pages, p)),
        R(T.funnels, hand), R(T.funnels, live), ...pages(live).map((p) => R(T.pages, p)),
        R(T.funnels, built), ...pages(built).map((p) => R(T.pages, { ...p, html: builtPage(built, p.role) }))],
      sample: 4 + 3,
      violations: {
        "a built funnel does not have exactly three pages": [R(T.funnels, few), ...pages(few).slice(0, 2).map((p) => R(T.pages, p))],
        "a page sits at an address its funnel does not make": [
          R(T.funnels, moved),
          ...pages(moved).map((p, i) => R(T.pages, i === 1 ? { ...p, path: "/old-book" } : p))
        ],
        "a draft funnel's landing address is not on its own address": [
          R(T.funnels, { ...stale, landing_url: "https://apply.fundhub.ai/old" }), ...pages(stale).map((p) => R(T.pages, p))
        ],
        "a written page does not name its own address": [
          R(T.funnels, drift), ...withPage(drift, "thank_you", builtPage({ ...drift, path: "/old" }, "thank_you"))
        ],
        "a written landing page does not send its button to the funnel's booking page": [
          R(T.funnels, landingOnly), ...withPage(landingOnly, "landing", builtPage(landingOnly, "landing").replace('href="/lnd-book"', 'href="/old-book"'))
        ],
        "a written booking page does not send people on to the funnel's thank-you page": [
          R(T.funnels, bookingOnly), ...withPage(bookingOnly, "booking", builtPage(bookingOnly, "booking").replace('"/bkg-thank-you"', '"/old-thank-you"'))
        ]
      }
    };
  })(),
  "mkt-funnel-build": (() => {
    const f = funnel({ key: "built" });
    const jobOk = job({ kind: "funnel", status: "done", result: { checks: "passed" } });
    const GOOD_COPY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "src/marketing/fixtures/funnel-copy-good.json"), "utf8"));
    const pageOf = (role = "landing", o = {}, leave = null) => ({
      id: nid("page"), org_id: ORG, funnel_id: f.id, role, path: `/x-${role}`, html: builtPage({ ...f, path: "/x" }, role, leave),
      page_copy: structuredClone(GOOD_COPY[role]), build_job_id: jobOk.id, ...o
    });
    const bad = (role, edit) => { const c = structuredClone(GOOD_COPY[role]); edit(c); return c; };
    return {
      good: [R(T.funnels, f), R(T.jobs, jobOk), R(T.pages, pageOf("landing")), R(T.pages, pageOf("booking")), R(T.pages, pageOf("thank_you")),
        R(T.pages, pageOf("landing", { html: null, build_job_id: null, page_copy: null }))],
      sample: 3,
      violations: {
        // the job that wrote it is another company's finished job: this company has no such job
        "a written page does not come from a finished funnel job": [
          R(T.jobs, job({ id: "job-elsewhere", org_id: OTHER, kind: "funnel", status: "done", result: { checks: "passed" } })),
          R(T.pages, pageOf("landing", { build_job_id: "job-elsewhere" }))
        ],
        "a written page has no saved words": [R(T.pages, pageOf("landing", { page_copy: null }))],
        "a written landing page's words do not have the shape the copy check holds": [
          R(T.pages, pageOf("landing", { page_copy: bad("landing", (c) => { c.headline = " "; }) }))
        ],
        "a written booking page's words do not have the shape the copy check holds": [
          R(T.pages, pageOf("booking", { page_copy: bad("booking", (c) => { c.prep = c.prep.slice(0, 1); }) }))
        ],
        "a written thank-you page's words do not have the shape the copy check holds": [
          R(T.pages, pageOf("thank_you", { page_copy: bad("thank_you", (c) => { c.next_steps = c.next_steps.slice(0, 2); }) }))
        ],
        "a written page does not carry its funnel tag in the head": [R(T.pages, pageOf("landing", {}, "tag-in-head"))],
        "a written page has no tracking config in the head": [R(T.pages, pageOf("landing", {}, "config"))],
        "a written page has no Meta pixel in the head": [R(T.pages, pageOf("landing", {}, "pixel"))],
        "a written page does not load fh-attribution.js": [R(T.pages, pageOf("landing", {}, "attribution"))],
        "a written page does not load fh-events.js": [R(T.pages, pageOf("landing", {}, "events"))]
      }
    };
  })(),
  "mkt-settings-funnel-card": (() => {
    const camp = { id: nid("camp"), org_id: ORG, external_id: "camp-1" };
    const camp2 = { id: nid("camp"), org_id: ORG, external_id: "camp-2" };
    const set1 = { id: nid("set"), org_id: ORG, campaign_id: camp.id, external_id: "set-1" };
    const set2 = { id: nid("set"), org_id: ORG, campaign_id: camp2.id, external_id: "set-2" };
    const good = funnel({ key: "g1", kind: null, path: null, meta_campaign_ids: ["camp-1"], default_ad_set_external_id: "set-1" });
    const empty = funnel({ key: "g2", kind: null, path: null, format_mix: {} });
    return {
      good: [R(T.campaigns, camp), R(T.campaigns, camp2), R(T.adsets, set1), R(T.adsets, set2), R(T.funnels, good), R(T.funnels, empty)],
      sample: 2,
      violations: {
        "the mix names a script kind that does not exist": [R(T.funnels, funnel({ key: "v1", kind: null, path: null, format_mix: { standrd: 1 } }))],
        "the mix holds something that is not a number of zero or more": [R(T.funnels, funnel({ key: "v2", kind: null, path: null, format_mix: { standard: -1 } }))],
        "the default ad set is not in one of the funnel's own campaigns": [
          R(T.funnels, funnel({ key: "v3", kind: null, path: null, meta_campaign_ids: ["camp-2"], default_ad_set_external_id: "set-1" }))
        ],
        // the second pair names a campaign the sync has not brought in yet: it is still on two funnels
        "a Meta campaign sits on two funnels": {
          rows: [R(T.funnels, funnel({ key: "v4", kind: null, path: null, meta_campaign_ids: ["camp-2"], default_ad_set_external_id: "set-2" })),
            R(T.funnels, funnel({ key: "v5", kind: null, path: null, meta_campaign_ids: ["camp-2"] })),
            R(T.funnels, funnel({ key: "v6", kind: null, path: null, meta_campaign_ids: ["camp-ghost"] })),
            R(T.funnels, funnel({ key: "v7", kind: null, path: null, meta_campaign_ids: ["camp-ghost", "camp-3"] }))],
          bad: 4
        }
      }
    };
  })(),
  "mkt-scripts-edit": (() => {
    // The machine saved version 1 at PATH (its own file, not an edit file). An edit keeps the same path
    // (spec 7.9), so a file at the path says nothing about the edit: only its own edit-file save does.
    const PATH = "marketing/ads/scripts/a.md";
    const front = (version) => `---\nad: null\nversion: ${version}\nstatus: draft\n---\nwords`;
    const machineFile = R(T.outbox, outbox({ path: PATH, op_id: "u35:file:first-save", content: front(1) }));
    const editFile = (s, o = {}) => R(T.outbox, outbox({ path: s.repo_path, op_id: nid("u25:edit-file:req"), content: front(s.version), ...o }));
    const root = script({ version: 1, archived_at: T0, status: "superseded", repo_path: PATH });
    const edit = script({ root_script_id: root.id, parent_script_id: root.id, version: 2, source: "chris", repo_path: PATH });
    const mk = (o = {}, version = 3) => {
      const r = script({ version, archived_at: T0, repo_path: `marketing/ads/scripts/${nid("r")}.md` });
      const e = script({ root_script_id: r.id, parent_script_id: r.id, version: version + 1, source: "chris", repo_path: r.repo_path, ...o });
      return { r, e };
    };
    const gap = mk({ version: 7 });
    const moved = mk();
    const noOwn = mk();
    const otherVersion = mk();
    return {
      good: [R(T.scripts, root), R(T.scripts, edit), machineFile, editFile(edit),
        R(T.scripts, script({ version: 1, source: "chris" })),
        // an older save with no repo path is not judged here
        R(T.scripts, script({ parent_script_id: root.id, version: 9, source: "chris", repo_path: null }))],
      sample: 1,
      violations: {
        "an edit is not one version after the one it replaced": [R(T.scripts, gap.r), R(T.scripts, gap.e), editFile(gap.e)],
        "an edit moved to a different script": [R(T.scripts, moved.r), R(T.scripts, { ...moved.e, root_script_id: "root-elsewhere" }), editFile(moved.e)],
        // the machine's own file is at the same path, and so is a LATER edit's file: neither is this edit's
        "an edit's own file was never queued for the repo": {
          rows: [
            R(T.scripts, noOwn.r), R(T.scripts, noOwn.e), R(T.outbox, outbox({ path: noOwn.r.repo_path, op_id: "u35:file:first-save-2", content: front(noOwn.r.version) })),
            // ANOTHER company holds a file at the same path that says this very version: it is not this edit's file
            R(T.outbox, outbox({ org_id: OTHER, path: noOwn.r.repo_path, op_id: "u25:edit-file:req-elsewhere", content: front(noOwn.e.version) })),
            R(T.scripts, otherVersion.r), R(T.scripts, otherVersion.e),
            R(T.outbox, outbox({ path: otherVersion.r.repo_path, op_id: nid("u25:edit-file:req"), content: front(otherVersion.e.version + 1) }))
          ],
          bad: 2
        }
      }
    };
  })(),
  "mkt-scripts-fix": (() => {
    const mk = (o = {}, parentOver = {}) => {
      const r = script({ version: 1, archived_at: T0, ad_id: "ad-9", ...parentOver });
      const f = script({ root_script_id: r.id, parent_script_id: r.id, version: 2, fix_note: "shorter hook", ad_id: "ad-9", ...o });
      return { r, f };
    };
    const good = mk();
    const gap = mk({ version: 5 });
    const moved = mk({ root_script_id: "root-elsewhere" });
    const renumbered = mk({ ad_id: "ad-10" });
    // the real order: write, Fix, then Approve. The rewrite is approved in place and takes the ad number;
    // the archived old version never had one. That is right, not a changed number.
    const fixedThenApproved = mk({ ad_id: "7", status: "locked" }, { ad_id: null });
    const okJob = job({ kind: "fix_script", payload: { script_id: good.r.id, version: 1, note: "make it shorter" } });
    return {
      good: [R(T.scripts, good.r), R(T.scripts, good.f), R(T.jobs, okJob), R(T.scripts, fixedThenApproved.r), R(T.scripts, fixedThenApproved.f)],
      sample: 3,
      violations: {
        "a rewrite is not one version after the one it replaced": [R(T.scripts, gap.r), R(T.scripts, gap.f)],
        "a rewrite moved to a different script": [R(T.scripts, moved.r), R(T.scripts, moved.f)],
        "a rewrite changed the ad number the old version had": [R(T.scripts, renumbered.r), R(T.scripts, renumbered.f)],
        "a fix request carries no note": [R(T.jobs, job({ kind: "fix_script", payload: { script_id: good.r.id, note: " " } }))],
        "a fix request names no script of this company": [
          R(T.scripts, script({ id: "script-elsewhere", org_id: OTHER })),
          R(T.jobs, job({ kind: "fix_script", payload: { script_id: "script-elsewhere", note: "x" } }))
        ]
      }
    };
  })(),
  "mkt-scripts-write-now": (() => {
    // NOW is 2026-10-14T12:00Z. A batch is made with release_at = created_at (startWriteNow: now(), now()).
    const made = (o = {}) => ({ id: nid("batch"), org_id: ORG, kind: "on_command", status: "released", created_at: T0, release_at: T0, total: 1, ...o });
    const startFor = (batch) => job({ kind: "start_batch", payload: { batch_id: batch.id } });
    const b = made();
    const fresh = made({ status: "planned", created_at: "2026-10-14T11:00:00.000Z", release_at: "2026-10-14T11:00:00.000Z", total: 0 });
    const noJob = made();
    const noTime = made({ release_at: null });
    const empty = made({ total: 0 });
    const later = made({ release_at: "2026-10-19T09:00:00.000Z" });
    const stuck = made({ status: "planned", total: 0 });
    return {
      good: [R(T.batches, b), R(T.jobs, startFor(b)), R(T.batches, fresh), R(T.jobs, startFor(fresh)),
        R(T.batches, { ...made(), kind: "weekly", total: 0, release_at: null })],
      sample: 2,
      violations: {
        "a Write now batch has no start job": [R(T.batches, noJob)],
        "a Write now batch has no release time": [R(T.batches, noTime), R(T.jobs, startFor(noTime))],
        // the checker's break: a release time pushed to next Monday, with its start job
        "a Write now batch is held back past the moment it was made": [R(T.batches, later), R(T.jobs, startFor(later))],
        "a Write now batch has sat planned for over two hours": [R(T.batches, stuck), R(T.jobs, startFor(stuck))],
        "a ready or released batch counted no scripts": [R(T.batches, empty), R(T.jobs, startFor(empty))]
      }
    };
  })(),
  "mkt-scripts-idea-box": (() => {
    const good = idea({ angle_key: null, raw_points: "Lenders read two files", funnel_key: "book_call", status: "written", script_id: "script-1" });
    const f = funnel({ key: "book_call", kind: null, path: null });
    const blank = idea({ angle_key: null, raw_points: " " });
    const noFile = idea({ angle_key: null, raw_points: "no file" });
    const badFunnel = idea({ angle_key: null, raw_points: "ghost funnel", funnel_key: "ghost" });
    const noScript = idea({ angle_key: null, raw_points: "written ghost", status: "written", script_id: null });
    return {
      good: [R(T.funnels, f), R(T.ideas, good), R(T.outbox, ideaFile(good)), R(T.ideas, idea({ source: "machine", raw_points: "" }))],
      sample: 1,
      violations: {
        "an idea has no words": [R(T.ideas, blank), R(T.outbox, ideaFile(blank))],
        "an idea has no file queued for the repo": [R(T.ideas, noFile)],
        // another company has a funnel called "ghost"; this company does not
        "an idea names a funnel this company does not have": [
          R(T.ideas, badFunnel), R(T.outbox, ideaFile(badFunnel)), R(T.funnels, funnel({ org_id: OTHER, key: "ghost", kind: null, path: null }))
        ],
        "an idea says written but points at no script": [R(T.ideas, noScript), R(T.outbox, ideaFile(noScript))]
      }
    };
  })(),
  "mkt-scripts-rules": (() => {
    const RULES = "marketing/ads/RULES.md";
    const BAN = "marketing/ads/banned-live.json";
    const edit = (path, e) => R(T.outbox, outbox({ path, mode: "edit", content: null, edit: e }));
    return {
      good: [
        edit(RULES, { op: "part0_add_rule", text: "Never say guaranteed." }),
        edit(RULES, { op: "part0_edit_rule", number: 3, text: "Cause first." }),
        edit(BAN, { op: "ban_phrase", phrase: "act now" }),
        edit("marketing/flywheel/partner/01-avatar.md", { op: "set_front_matter_key", key: "status", value: "approved" }),
        // an old one that is committed is done; a young one that is waiting is only waiting
        R(T.outbox, outbox({ path: RULES, mode: "edit", content: null, edit: { op: "part0_add_rule", text: "Old and saved." },
          created_at: OLD, committed_sha: "a".repeat(40), committed_at: OLD })),
        R(T.outbox, outbox({ path: RULES, mode: "edit", content: null, edit: { op: "part0_add_rule", text: "Just queued." }, created_at: "2026-10-14T11:30:00.000Z" }))
      ],
      sample: 5,
      violations: {
        "a rule change edits the banned list": [edit(BAN, { op: "part0_add_rule", text: "x" })],
        "a ban edits the rules file": [edit(RULES, { op: "ban_phrase", phrase: "x" })],
        "a rule change carries no words": [edit(RULES, { op: "part0_add_rule", text: " " })],
        "a ban carries no phrase": [edit(BAN, { op: "ban_phrase", phrase: "" })],
        "a rule change names no rule number": [edit(RULES, { op: "part0_edit_rule", text: "x" })],
        // refused by the repo ("Part 0 has no rule 7"): the outbox keeps it uncommitted and tries again
        "a rule change never reached the repo (waiting over an hour)": [
          R(T.outbox, outbox({ path: RULES, mode: "edit", content: null, edit: { op: "part0_edit_rule", number: 7, text: "x" },
            created_at: OLD, error: "could not apply part0_edit_rule on marketing/ads/RULES.md: Part 0 has no rule 7", attempts: 41 }))
        ]
      }
    };
  })(),
  "mkt-launch-load-one": (() => {
    const v = loadedVideo();
    const waiting = video();
    const unapproved = loadedVideo({ approved_at: null, approved_by: null });
    const noId = loadedVideo({ meta_creative_id: "" });
    const noAd = loadedVideo();
    const errored = loadedVideo({ load_error: "Meta said no earlier" });
    const approvedVideo = video();
    const strangerVideo = video({ org_id: OTHER });
    const rawVideo = video({ video_kind: "not_ad" });
    const unapprovedQueued = video({ approved_at: null, approved_by: null });
    // Turned on from the Launch tab: ACTIVE, and the receipt Turn on leaves.
    const turnedOn = loadedVideo();
    // Loaded long ago and on (Chris may have turned it on in Meta itself): outside the 14 days, not read.
    const oldOn = loadedVideo({ loaded_at: OLD });
    // The break: created ACTIVE, or turned on by something that left no receipt.
    const rogue = loadedVideo();
    // A turn-on that Meta refused is not a receipt that the ad is on.
    const refused = loadedVideo();
    return {
      good: [R(T.videos, v), R(T.ads, adFor(v)), R(T.videos, waiting), R(T.videos, approvedVideo), R(T.jobs, loadJob(approvedVideo)),
        R(T.videos, turnedOn), R(T.ads, adFor(turnedOn, { status: "ACTIVE" })), R(T.alog, turnOnReceipt(turnedOn)),
        R(T.videos, oldOn), R(T.ads, adFor(oldOn, { status: "ACTIVE" }))],
      sample: 4,
      violations: {
        "a loaded video was never approved by a person": [R(T.videos, unapproved), R(T.ads, adFor(unapproved))],
        "a loaded video is missing a Meta id": [R(T.videos, noId), R(T.ads, adFor(noId))],
        "a loaded video has no ad row of ours": [R(T.videos, noAd)],
        "a loaded video still carries a load error": [R(T.videos, errored), R(T.ads, adFor(errored))],
        "a freshly loaded ad is on with no turn-on receipt": {
          rows: [
            R(T.videos, rogue), R(T.ads, adFor(rogue, { status: "ACTIVE" })),
            R(T.videos, refused), R(T.ads, adFor(refused, { status: "active" })),
            R(T.alog, turnOnReceipt(refused, { execute_error: "Meta did not say the ad is on." }))
          ],
          bad: 2
        },
        "a load job names a video this company does not have": [R(T.jobs, loadJob(strangerVideo)), R(T.videos, strangerVideo)],
        "a load job was queued for a video nobody approved": [R(T.videos, unapprovedQueued), R(T.jobs, loadJob(unapprovedQueued))],
        "a load job was queued for a video that is not an ad": [R(T.videos, rawVideo), R(T.jobs, loadJob(rawVideo))]
      }
    };
  })(),
  "mkt-launch-load-all": (() => {
    const approvedVideo = video();
    const loaded = loadedVideo();
    const strangerVideo = video({ org_id: OTHER });
    const rawVideo = video({ video_kind: "not_ad" });
    const unapproved = video({ approved_at: null, approved_by: null });
    const noAdRow = loadedVideo({ ad_row_id: null });
    return {
      good: [R(T.videos, approvedVideo), R(T.jobs, loadJob(approvedVideo)), R(T.videos, loaded), R(T.ads, adFor(loaded))],
      sample: 2,
      violations: {
        "a load job names a video this company does not have": [R(T.jobs, loadJob(strangerVideo)), R(T.videos, strangerVideo)],
        "a load job was queued for a video nobody approved": [R(T.videos, unapproved), R(T.jobs, loadJob(unapproved))],
        "a load job was queued for a video that is not an ad": [R(T.videos, rawVideo), R(T.jobs, loadJob(rawVideo))],
        "a loaded video is missing its Meta ad id or our ad row": [R(T.videos, noAdRow)]
      }
    };
  })()
};

/** The six flywheel steps share one shape of fixture. */
function flywheelFixtures() {
  const stepFile = (n, file, over = {}) => outbox({
    path: `marketing/flywheel/partner/${file}`, content: `---\nstage: ${n}\nversion: 1\nstatus: draft\n---\nbody`, ...over
  });
  const approve = (file, over = {}) => outbox({
    path: `marketing/flywheel/partner/${file}`, mode: "edit", content: null,
    edit: { op: "set_front_matter_key", key: "status", value: "approved" }, ...over
  });
  const note = (line, over = {}) => outbox({
    path: "marketing/flywheel/partner/00-OWNER-NOTES.md", mode: "edit", content: null,
    edit: { op: "append_line_under_heading", heading: "## Notes", line }, ...over
  });
  const fileViolations = (n, file) => ({
    "a saved step file has no stamp": [R(T.outbox, stepFile(n, file, { content: "no stamp here" }))],
    "a saved step file is stamped as another step": [R(T.outbox, stepFile(n, file, { content: `---\nstage: ${n === 1 ? 2 : 1}\nversion: 1\n---\nx` }))],
    "an approve edit sets something other than status approved": [R(T.outbox, approve(file, { edit: { op: "set_front_matter_key", key: "status", value: "draft" } }))],
    "a Tweak note is not added under the Notes heading": [R(T.outbox, note(`2026-10-14 | stage ${n} | wrong place`, {
      edit: { op: "append_line_under_heading", heading: "## Todo", line: `2026-10-14 | stage ${n} | wrong place` }
    }))],
    "a Tweak note line is not a date, the step and words": [R(T.outbox, note(`2026-10-14 | stage ${n} |`))]
  });
  // The decoy line ("x") names no step, so no step's check reads it; the real one carries date, step and words.
  const goodFiles = (n, file) => [R(T.outbox, stepFile(n, file)), R(T.outbox, approve(file)),
    R(T.outbox, note(`2026-10-14 | stage ${n} | start with the inquiries, not the score`)), R(T.outbox, note("x"))];
  const out = {};

  const avatarJob = job({ kind: "avatar", status: "done", payload: {}, result: { ok: true } });
  out["mkt-flywheel-1-avatar"] = {
    good: [...goodFiles(1, "01-avatar.md"), R(T.jobs, avatarJob), R(T.outbox, outbox({ op_id: `avatar:${avatarJob.id}:01-avatar.md`, path: "marketing/flywheel/partner/01-avatar.md", content: "---\nstage: 1\n---" })),
      R(T.jobs, job({ kind: "avatar", status: "running" }))],
    sample: 5,
    violations: {
      ...fileViolations(1, "01-avatar.md"),
      "a finished avatar run has no file queued": [R(T.jobs, job({ kind: "avatar", status: "done", payload: {}, result: { ok: true } }))]
    }
  };

  const board = (over = {}) => ({ board: { campaign: "partner", thin: null, repo_path: "marketing/flywheel/partner/02-ad-research.md", version: 1, ...over } });
  const stage2 = (result) => job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 2 }, result });
  const marketJob = stage2(board());
  const noPathJob = stage2(board({ repo_path: null }));
  out["mkt-flywheel-2-ad-research"] = {
    good: [...goodFiles(2, "02-ad-research.md"), R(T.jobs, marketJob), R(T.outbox, outbox({ op_id: `flywheel-${marketJob.id}-02` })),
      // a thin run is a designed result: it says so, writes no board and queues no file. It is not wrong.
      R(T.jobs, stage2(board({ thin: "Thin: not enough could be reached. 2 findings, 0 checked.", repo_path: null, version: null }))),
      R(T.jobs, job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 4 }, result: {} }))],
    sample: 4 + 1,
    violations: {
      ...fileViolations(2, "02-ad-research.md"),
      // a run that did not say it was thin must name its board file
      "a finished market run names no board file": [R(T.jobs, noPathJob), R(T.outbox, outbox({ op_id: `flywheel-${noPathJob.id}-02` }))],
      "a finished market run has no file queued": [R(T.jobs, stage2(board()))]
    }
  };

  const offerResult = { campaign: "partner", offer: { name: "The offer" }, document: "# Offer", model: "claude-opus-5-5" };
  out["mkt-flywheel-3-offer"] = {
    good: [...goodFiles(3, "03-offer.md"), R(T.jobs, job({ kind: "offer", status: "done", result: offerResult })),
      R(T.jobs, job({ kind: "offer", status: "failed", error: "no key", result: null }))],
    sample: 4,
    violations: {
      ...fileViolations(3, "03-offer.md"),
      "a finished offer run holds no offer": [R(T.jobs, job({ kind: "offer", status: "done", result: { ...offerResult, offer: null } }))],
      "a finished offer run holds no document": [R(T.jobs, job({ kind: "offer", status: "done", result: { ...offerResult, document: "" } }))]
    }
  };

  for (const [n, file, key, word] of [[4, "04-copy.md", "mkt-flywheel-4-copy", "copy"], [5, "05-ad-strategy.md", "mkt-flywheel-5-strategy", "strategy"]]) {
    const done = job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: n }, result: {} });
    out[key] = {
      good: [...goodFiles(n, file), R(T.jobs, done), R(T.outbox, outbox({ op_id: `flywheel:${done.id}:${file}`, path: `marketing/flywheel/partner/${file}`, content: `---\nstage: ${n}\n---` }))],
      sample: 5,
      violations: {
        ...fileViolations(n, file),
        [`a finished ${word} run has no file queued`]: [R(T.jobs, job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: n }, result: {} }))]
      }
    };
  }

  out["mkt-flywheel-6-spend"] = {
    good: [...goodFiles(6, "06-spend.md"), R(T.outbox, outbox({ op_id: "flywheel-spend:req-1", path: "marketing/flywheel/partner/06-spend.md", content: "---\nstage: 6\n---" }))],
    sample: 5,
    violations: {
      ...fileViolations(6, "06-spend.md"),
      "a spend read was saved to another file": [R(T.outbox, outbox({ op_id: "flywheel-spend:req-2", path: "marketing/flywheel/partner/05-ad-strategy.md", content: "---\nstage: 5\n---" }))],
      "a spend read was saved as an edit": [R(T.outbox, outbox({ op_id: "flywheel-spend:req-3", path: "marketing/flywheel/partner/06-spend.md", mode: "edit", content: null, edit: { op: "set_front_matter_key", key: "status", value: "approved" } }))]
    }
  };
  return out;
}

/* ── the runner ─────────────────────────────────────────────────────────────── */

function standIn(spec, groups) {
  const tables = new Set();
  for (const part of spec.parts) for (const t of tablesIn(`SELECT 1 FROM ${part.from} WHERE ${part.where}`)) tables.add(t);
  for (const sql of [sqlFor(spec)]) for (const t of tablesIn(sql)) tables.add(t);
  for (const t of Object.values(T)) tables.add(t);
  const db = makeStandIn([...tables]);
  for (const rows of groups) for (const [table, row] of rows) db.insert(table, row);
  return db;
}

const rowsOfViolation = (entry) => (Array.isArray(entry) ? entry : entry.rows || entry.only || []);

test("every check has fixtures, and every named condition has a wrong row", () => {
  assert.equal(FIN_B15_CHECKS.length, 25);
  assert.deepEqual(Object.keys(FIX).sort(), FIN_B15_CHECKS.map((c) => c.key).sort());
  for (const spec of FIN_B15_CHECKS) {
    const names = spec.parts.flatMap((p) => p.bad.map(([n]) => n));
    assert.equal(new Set(names).size, names.length, `${spec.key}: condition names must be unique`);
    assert.deepEqual(Object.keys(FIX[spec.key].violations).sort(), [...names].sort(), `${spec.key}: one wrong row per condition`);
  }
});

for (const spec of FIN_B15_CHECKS) {
  const fixture = FIX[spec.key];

  test(`${spec.key}: good rows are right, and the text names only real tables and columns`, () => {
    const db = standIn(spec, [fixture.good]);
    try {
      const out = db.run(sqlFor(spec), ORG);
      assert.deepEqual(out, { sample_count: fixture.sample, bad_count: 0 });
    } finally { db.close(); }
    const schema = schemaColumns();
    for (const table of tablesIn(sqlFor(spec))) assert.ok(schema.has(table), `${spec.key}: no table ${table}`);
    assert.doesNotMatch(sqlFor(spec), /\b(insert|update|delete|drop|alter|truncate|create|grant)\b/i, "read only");
    assert.match(sqlFor(spec), /\/\* display-result:[^*]+ \*\//);
    assert.match(sqlFor(spec), /sample_count/);
    assert.match(sqlFor(spec), /bad_count/);
  });

  for (const [name, entry] of Object.entries(fixture.violations)) {
    test(`${spec.key}: red on "${name}", and only that condition catches it`, () => {
      const rows = rowsOfViolation(entry);
      const base = entry && !Array.isArray(entry) && "only" in entry ? [] : fixture.good;
      const expectBad = (!Array.isArray(entry) && entry.bad) || 1;
      const expectSample = (!Array.isArray(entry) && entry.sample) || undefined;
      const red = standIn(spec, [base, rows]);
      const quiet = standIn(spec, [base, rows]);
      try {
        const out = red.run(sqlFor(spec), ORG);
        assert.equal(out.bad_count, expectBad, `${name}: bad_count`);
        if (expectSample != null) assert.equal(out.sample_count, expectSample);
        const without = quiet.run(sqlFor(spec, { without: [name] }), ORG);
        assert.equal(without.bad_count, 0, `${name}: leaving this one condition out must stop catching the row`);
      } finally { red.close(); quiet.close(); }
    });
  }

  test(`${spec.key}: another company's whole world (good rows and wrong rows, every id copied) is never read, and would be if the company filter were dropped`, () => {
    // Every row of the fixture is copied into ANOTHER company with every id remapped, so each far chain
    // (a script and its parent, a funnel and its pages, an idea and its file) points only at far rows.
    // Left like that it is exactly as wrong as the real company's own wrong rows.
    const world = [...fixture.good, ...Object.values(fixture.violations).flatMap((entry) => rowsOfViolation(entry))];
    const far = farWorld(world);
    const db = standIn(spec, [fixture.good, far]);
    const filterless = standIn(spec, [fixture.good, far]);
    try {
      const out = db.run(sqlFor(spec), ORG);
      assert.deepEqual(out, { sample_count: fixture.sample, bad_count: 0 }, "rows of another company must not be counted");
      // The same text with the company filter dropped DOES see the far world's wrong rows: the far copies are
      // wrong chains that only the filter keeps out, so a missing filter cannot hide behind a broken fixture.
      const open = filterless.run(sqlFor(spec).replace(/= \$1::uuid/g, "IS NOT NULL"), ORG);
      assert.ok(open.bad_count > 0, `${spec.key}: with the company filter dropped the far world's wrong rows were not seen (a hollow guard)`);
    } finally { db.close(); filterless.close(); }
  });
}

test("pages drawn by the product's own writer (renderPage) are clean to the rename check and the build check, both before and after a rename", async () => {
  const { renderPage } = await import("../../../marketing/funnel-pages.mjs");
  const { pagePaths } = await import("../../../marketing/funnel-paths.mjs");
  const GOOD_COPY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "src/marketing/fixtures/funnel-copy-good.json"), "utf8"));
  const renameSpec = FIN_B15_CHECKS.find((c) => c.key === "mkt-funnel-rename");
  const buildSpec = FIN_B15_CHECKS.find((c) => c.key === "mkt-funnel-build");
  const jobOk = job({ kind: "funnel", status: "done", result: { checks: "passed" } });
  for (const base of ["/blueprint", "/blueprint-2", "/funding-plan"]) {
    const f = funnel({ key: `real${base.replace(/\W/g, "")}`, path: base, tag: "fnl-real", lane: "uwiq", offer_key: "capital_blueprint" });
    const paths = pagePaths(base);
    const rows = pages(f).map((p) => ({
      ...p, html: renderPage({ funnel: f, page: { role: p.role, path: p.path }, copy: GOOD_COPY, paths, env: {} }),
      page_copy: GOOD_COPY[p.role], build_job_id: jobOk.id
    }));
    for (const spec of [renameSpec, buildSpec]) {
      const db = standIn(spec, [[R(T.funnels, f), R(T.jobs, jobOk), ...rows.map((r) => R(T.pages, r))]]);
      try {
        const out = db.run(sqlFor(spec), ORG);
        assert.equal(out.bad_count, 0, `${spec.key} on a real page at ${base}`);
        assert.ok(out.sample_count >= 1);
      } finally { db.close(); }
    }
    // The same pages after a rename that moved the rows and not the drawing are red, not green.
    const moved = { ...f, path: `${base}-new`, landing_url: `https://apply.fundhub.ai${base}-new` };
    const stale = pages(moved).map((p, i) => ({ ...p, html: rows[i].html, page_copy: GOOD_COPY[p.role], build_job_id: jobOk.id }));
    const db = standIn(renameSpec, [[R(T.funnels, moved), ...stale.map((r) => R(T.pages, r))]]);
    try {
      assert.equal(db.run(sqlFor(renameSpec), ORG).bad_count, 3, "each of the three pages still names the old address");
    } finally { db.close(); }
  }
});

test("the strings the checks lean on are the ones the product's own code makes: the Tweak note line, the edit file, and the stage 2 board", async () => {
  // 1. Tweak notes: campaigns.mjs noteLine and its heading, for every step, read by that step's check.
  const { noteLine, NOTES_HEADING } = await import("../../../marketing/flywheel/campaigns.mjs");
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const key = ["mkt-flywheel-1-avatar", "mkt-flywheel-2-ad-research", "mkt-flywheel-3-offer", "mkt-flywheel-4-copy", "mkt-flywheel-5-strategy", "mkt-flywheel-6-spend"][n - 1];
    const spec = FIN_B15_CHECKS.find((c) => c.key === key);
    const line = noteLine({ today: "2026-10-14", stage: n, note: "lead with the fear | not the price" });
    const real = outbox({ path: "marketing/flywheel/partner/00-OWNER-NOTES.md", mode: "edit", content: null, edit: { op: "append_line_under_heading", heading: NOTES_HEADING, line } });
    const db = standIn(spec, [[R(T.outbox, real)]]);
    try {
      assert.deepEqual(db.run(sqlFor(spec), ORG), { sample_count: 1, bad_count: 0 }, `${key}: ${line}`);
    } finally { db.close(); }
  }
  // 2. The edit file: scripts-store.mjs opIdFor, and script-file.mjs serializeScript's front matter.
  const { opIdFor } = await import("../../../marketing/scripts-store.mjs");
  const { serializeScript } = await import("../../../marketing/script-file.mjs");
  const editSpec = FIN_B15_CHECKS.find((c) => c.key === "mkt-scripts-edit");
  const root = script({ version: 1, archived_at: T0, repo_path: "marketing/ads/scripts/real.md" });
  const edit = script({ root_script_id: root.id, parent_script_id: root.id, version: 2, source: "chris", repo_path: root.repo_path });
  const file = serializeScript({ ...edit, repo_path: edit.repo_path, body: "The words.", updated_at: T0, status: "draft" });
  assert.match(opIdFor("edit-file", "req-1"), /^u25:edit-file:/);
  const db = standIn(editSpec, [[R(T.scripts, root), R(T.scripts, edit), R(T.outbox, outbox({ path: file.path, op_id: opIdFor("edit-file", "req-1"), content: file.content }))]]);
  try {
    assert.deepEqual(db.run(sqlFor(editSpec), ORG), { sample_count: 1, bad_count: 0 });
  } finally { db.close(); }
  // 3. The stage 2 board: ad-research.mjs finish() is where result.board.thin and result.board.repo_path come from.
  const { AD_RESEARCH_DEF } = await import("../../../marketing/flywheel/ad-research.mjs");
  const spec2 = FIN_B15_CHECKS.find((c) => c.key === "mkt-flywheel-2-ad-research");
  const io = { spent: async () => ({ usd: 0, searches: 0, fetches: 0 }) };
  const counts = { rowsFound: 2, rowsVerified: 0, rowsWithFirstSeen: 0, competitorsFound: 0 };
  const thin = await AD_RESEARCH_DEF.finish({ campaign: "partner", confidence: "unknown", counts, thin: "Thin: not enough could be reached.", repo_path: null }, io);
  const saved = await AD_RESEARCH_DEF.finish({ campaign: "partner", confidence: "medium", counts, thin: null, repo_path: "marketing/flywheel/partner/02-ad-research.md" }, io);
  const thinJob = job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 2 }, result: thin });
  const savedJob = job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 2 }, result: saved });
  const db2 = standIn(spec2, [[R(T.jobs, thinJob), R(T.jobs, savedJob), R(T.outbox, outbox({ op_id: `flywheel-${savedJob.id}-02` }))]]);
  try {
    // the thin run is not read at all; the saved one (its job and its file) is read and is right
    assert.deepEqual(db2.run(sqlFor(spec2), ORG), { sample_count: 2, bad_count: 0 });
  } finally { db2.close(); }
  // 4. The brain page: ingest-generated.mjs driveFileIdFor names it, and chunk.mjs chunkText cuts the report.
  const { driveFileIdFor } = await import("../../../company-brain/ingest-generated.mjs");
  const { chunkText } = await import("../../../company-brain/chunk.mjs");
  const longReport = `# Banks check inquiries first\r\n\r\n${"The lender reads hard pulls in the last 24 months before anything else on the file. ".repeat(60)}`;
  const run = doneResearch({ result: { report: { repo_path: "marketing/research/x/report.md", markdown: `${longReport}\n` } } });
  const cardSpec = FIN_B15_CHECKS.find((c) => c.key === "mkt-research-card");
  const page = { id: nid("brain"), org_id: ORG, drive_file_id: driveFileIdFor("deep-research", run.id), name: "Research: x", source: "generated", access_tier: "owner" };
  const cut = chunkText(`${longReport}\n`);
  assert.ok(cut.length > 1, "a long report is more than one chunk");
  const db3 = standIn(cardSpec, [[R(T.jobs, run), R(T.outbox, outbox({ op_id: `research-${run.id}-report`, path: "marketing/research/x/report.md" })),
    R(T.brainFiles, page), ...cut.map((text, i) => R(T.brainChunks, brainChunk(page, text, { chunk_index: i })))]]);
  try {
    assert.deepEqual(db3.run(sqlFor(cardSpec), ORG), { sample_count: 2, bad_count: 0 });
  } finally { db3.close(); }
});

test("the Numbers Make more check reads only Chris's own script ideas: the machine's idea and an opening idea are each red the moment their filter is dropped", () => {
  const spec = FIN_B15_CHECKS.find((c) => c.key === "mkt-numbers-make-more");
  const text = sqlFor(spec);
  assert.ok(text.includes("i.source = 'chris'") && text.includes("i.kind = 'script'"));
  const machine = idea({ source: "machine", raw_points: "A planner idea with an angle and no file" });
  const opening = idea({ kind: "opening", raw_points: "An opening idea with an angle and no file" });
  for (const [row, filter] of [[machine, "i.source = 'chris' AND "], [opening, " AND i.kind = 'script'"]]) {
    const db = standIn(spec, [[R(T.ideas, row)]]);
    try {
      assert.deepEqual(db.run(text, ORG), { sample_count: 0, bad_count: 0 }, "read as nothing, because of the filter");
      const dropped = db.run(text.replace(filter, ""), ORG);
      assert.deepEqual(dropped, { sample_count: 1, bad_count: 1 }, `without "${filter.trim()}" the row is read and is red`);
    } finally { db.close(); }
  }
});

test("the Write now check and the research check read dates and spend the way the stand-in clock does (a young waiting batch and a run inside its stop amount are green)", () => {
  const spec = FIN_B15_CHECKS.find((c) => c.key === "mkt-scripts-write-now");
  const text = sqlFor(spec);
  assert.match(text, /b\.created_at \+ interval '5 minutes'/);
  assert.match(text, /now\(\) - interval '2 hours'/);
});

/** Copy every row into another company with every id (and every id named inside a row) remapped. */
function farWorld(world) {
  const ids = new Set();
  for (const [, row] of world) if (row.id != null) ids.add(String(row.id));
  const list = [...ids].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = list.length ? new RegExp(list.join("|"), "g") : null;
  return world.map(([table, row]) => {
    const json = JSON.stringify(row);
    const moved = JSON.parse(re ? json.replace(re, (m) => `${m}-far`) : json);
    if ("org_id" in moved) moved.org_id = OTHER;
    return [table, moved];
  });
}

test("the registry holds exactly the text the test ran, one contract per control, all unique", () => {
  assert.equal(FIN_B15_DISPLAY_CONTRACTS.length, 25);
  assert.equal(new Set(FIN_B15_DISPLAY_CONTRACTS.map((c) => c.control)).size, 25);
  assert.equal(new Set(FIN_B15_DISPLAY_CONTRACTS.map((c) => c.sql)).size, 25);
  for (const [i, contract] of FIN_B15_DISPLAY_CONTRACTS.entries()) {
    assert.equal(contract.mode, "query");
    assert.equal(contract.sql, sqlFor(FIN_B15_CHECKS[i]));
    assert.ok(contract.requirement.length > 40);
  }
  // The one control that must always have results leaves emptyAs off; every other waits for its first result.
  const strict = FIN_B15_DISPLAY_CONTRACTS.filter((c) => !c.emptyAs).map((c) => c.control);
  assert.deepEqual(strict, ["Page load: list read + mismatch-queue read; empty-book banner"]);
});

test("every control is one exact row of the coverage map, and not yet attached to anything else", () => {
  const map = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10", FIN_B15_SOURCE_FILE), "utf8"));
  for (const spec of FIN_B15_CHECKS) {
    const rows = map.filter((r) => r.surface === spec.surface && r.control === spec.control);
    assert.equal(rows.length, 1, `${spec.surface} / ${spec.control}`);
  }
});

test("the month meter holds the product's own price table, rate for rate, and names every model it prices", () => {
  const priced = Object.keys(MODEL_PRICES).sort();
  const named = [...Object.keys(METER_RATES), ...METER_FREE_MODELS].sort();
  assert.deepEqual(named, priced, "the meter check names exactly the models model-usage.mjs prices");
  assert.deepEqual([...METER_FREE_MODELS], [...FREE_MODELS]);
  assert.equal(METER_SEARCH_USD, WEB_SEARCH_USD);
  for (const [model, rate] of Object.entries(METER_RATES)) {
    const p = MODEL_PRICES[model];
    assert.deepEqual(rate, { input: p.input, output: p.output, cache_read: p.cache_read, cache_write: p.cache_write }, model);
  }
  for (const model of FREE_MODELS) {
    assert.deepEqual({ ...MODEL_PRICES[model] }, { input: 0, output: 0, cache_read: 0, cache_write: 0 }, model);
  }
  const text = sqlFor(FIN_B15_CHECKS.find((c) => c.key === "mkt-month-meter"));
  for (const model of priced) assert.ok(text.includes(`'${model}'`), `${model} has a price on file but the meter check does not name it`);
});

test("every ledger cost the product writes is a cost the meter check accepts (the product's own writer, run over each priced model)", async () => {
  const { callCostUsd } = await import("../../../marketing/model-usage.mjs");
  const spec = FIN_B15_CHECKS.find((c) => c.key === "mkt-month-meter");
  const cases = [
    ["claude-opus-5-5", { input_tokens: 1234, output_tokens: 567, cache_read_tokens: 89, cache_write_tokens: 10 }, 0],
    ["claude-opus-5-5", { input_tokens: 5000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0 }, 3],
    ["claude-sonnet-5-5", { input_tokens: 99999, output_tokens: 4000, cache_read_tokens: 12000, cache_write_tokens: 700 }, 2],
    ["claude-code", { input_tokens: 99999, output_tokens: 4000, cache_read_tokens: 0, cache_write_tokens: 0 }, 5]
  ];
  for (const [model, tokens, searches] of cases) {
    const cost = callCostUsd(model, tokens, searches);
    const db = standIn(spec, [[R(T.usage, usage({ model, ...tokens, web_search_requests: searches, cost_usd: cost }))]]);
    try {
      assert.deepEqual(db.run(sqlFor(spec), ORG), { sample_count: 1, bad_count: 0 }, `${model} ${JSON.stringify(tokens)} ${searches} searches saved at ${cost}`);
    } finally { db.close(); }
  }
});

test("the page check's own shape (FUNNEL_COPY_SHAPE) is the copy check's: every required field and list of the product's schema", async () => {
  const { COPY_SCHEMA } = await import("../../../marketing/funnel-copy.mjs");
  for (const role of ["landing", "booking", "thank_you"]) {
    const spec = COPY_SCHEMA.properties[role];
    const strings = spec.required.filter((k) => spec.properties[k].type === "string").sort();
    const lists = spec.required.filter((k) => spec.properties[k].type === "array").sort();
    assert.deepEqual([...FUNNEL_COPY_SHAPE.strings[role]].sort(), strings, `${role}: string fields`);
    assert.deepEqual(FUNNEL_COPY_SHAPE.lists[role].map(([k]) => k).sort(), lists, `${role}: list fields`);
  }
  // The counts: the product's own good fixture sits inside them, and its own limits are the ones written here.
  const good = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "src/marketing/fixtures/funnel-copy-good.json"), "utf8"));
  for (const role of ["landing", "booking", "thank_you"]) {
    for (const [key, min, max] of FUNNEL_COPY_SHAPE.lists[role]) {
      assert.ok(good[role][key].length >= min && good[role][key].length <= max, `${role}.${key}`);
    }
  }
});

test("the six script kinds in the settings check are the kinds the settings screen offers", async () => {
  const { FORMATS } = await import("../../../marketing/settings-store.mjs");
  const spec = FIN_B15_CHECKS.find((c) => c.key === "mkt-settings-funnel-card");
  const text = sqlFor(spec);
  for (const kind of FORMATS) assert.ok(text.includes(`'${kind}'`), `${kind} is missing from the settings check`);
  assert.equal(FORMATS.length, 6);
});

test("the file names and paths the checks lean on are the ones the product writes", async () => {
  const edit = await import("../../../repo/edit-ops.mjs");
  const text = FIN_B15_CHECKS.map((c) => sqlFor(c)).join("\n");
  assert.ok(text.includes(`'${edit.RULES_PATH}'`), "RULES_PATH");
  assert.ok(text.includes(`'${edit.BANNED_PATH}'`), "BANNED_PATH");
  const status = await import("../../../../scripts/flywheel/status.mjs");
  const files = status.STAGES.map((s) => s.file);
  assert.deepEqual(files, ["01-avatar.md", "02-ad-research.md", "03-offer.md", "04-copy.md", "05-ad-strategy.md", "06-spend.md"].slice(0, files.length));
  for (const f of files) assert.ok(text.includes(`/${f}'`), `${f} is not named by the flywheel checks`);
});
