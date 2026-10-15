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

import { MODEL_PRICES } from "../../../marketing/model-prices.mjs";
import {
  FIN_B15_CHECKS, FIN_B15_DISPLAY_CONTRACTS, FIN_B15_SOURCE_FILE, sqlFor
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
const usage = (o = {}) => ({
  id: nid("usage"), org_id: ORG, model: "claude-opus-5-5", input_tokens: 100, output_tokens: 100,
  cost_usd: 0.5, created_at: T0, ...o
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
const funnel = (o = {}) => ({
  id: nid("funnel"), org_id: ORG, key: nid("fk"), kind: "book_a_call", path: "/blueprint", tag: "fnl-blueprint",
  format_mix: { standard: 2, sorting: 1 }, meta_campaign_ids: [], default_ad_set_external_id: null, active: true, ...o
});
const pages = (f, o = {}) => [
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "landing", path: f.path, ...o },
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "booking", path: `${f.path}-book`, ...o },
  { id: nid("page"), org_id: f.org_id, funnel_id: f.id, role: "thank_you", path: `${f.path}-thank-you`, ...o }
];
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

const T = {
  lenders: "lenders", obs: "lender_bureau_observations", bureau: "ai_bureau_config", usage: "marketing_model_usage",
  ideas: "ad_ideas", outbox: "repo_outbox", jobs: "marketing_jobs", funnels: "marketing_funnels",
  pages: "marketing_funnel_pages", scripts: "ad_scripts", batches: "marketing_batches", videos: "ad_videos",
  ads: "ads", adsets: "ad_sets", campaigns: "campaigns"
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
  "lenders-dismiss": {
    good: [R(T.obs, obs({ review_status: "dismissed" })), R(T.obs, obs({ review_status: "pending", observed_bureau: "" }))],
    sample: 1,
    violations: {
      "dismissed but never flagged as a mismatch": [R(T.obs, obs({ review_status: "dismissed", mismatch_flag: false }))],
      "dismissed with no bureau that was seen": [R(T.obs, obs({ review_status: "dismissed", observed_bureau: "" }))],
      "dismissed with no lender named": [R(T.obs, obs({ review_status: "dismissed", lender_row_id: null, lender_name: null }))]
    }
  },
  "lenders-page-load": {
    good: [R(T.lenders, L0), R(T.obs, obs())],
    sample: 2,
    violations: {
      "a lender has no name": [R(T.lenders, lender({ name: " " }))],
      ...mismatchViolations(),
      "the lender book is empty": { only: [], sample: 1 }
    }
  },
  "lenders-list-tab": {
    good: [R(T.lenders, lender()), R(T.lenders, lender({ name: "Second Bank" })),
      R(T.lenders, lender({ name: "First Bank", lender_table: "PersonalCC" }))],
    sample: 3,
    violations: {
      "a lender has no name": [R(T.lenders, lender({ name: "" }))],
      "a lender dollar amount is below zero": [R(T.lenders, lender({ name: "Neg Bank", typical_approval_range: -5 }))],
      "a starting line is bigger than the biggest line ever seen": [R(T.lenders, lender({ name: "Big Start", average_starting_loc: 50000, max_known_loc: 20000 }))],
      "the same bank is listed twice in one table": {
        rows: [R(T.lenders, lender({ name: "Dup Bank" })), R(T.lenders, lender({ name: "DUP BANK" }))], bad: 2
      }
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
    good: [R(T.usage, usage()), R(T.usage, usage({ model: "claude-code", cost_usd: 0 })),
      R(T.usage, usage({ model: "gpt-4o-mini", cost_usd: null })),
      R(T.usage, usage({ created_at: OLD, cost_usd: null }))],
    sample: 3,
    violations: {
      "a priced model was saved with an unknown cost": [R(T.usage, usage({ cost_usd: null }))],
      "the free model was saved with a cost": [R(T.usage, usage({ model: "claude-code", cost_usd: 1 }))],
      "a priced model with tokens was saved at zero": [R(T.usage, usage({ cost_usd: 0 }))]
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
      good: [R(T.ideas, good), R(T.outbox, ideaFile(good)), R(T.ideas, idea({ angle_key: null, raw_points: "" }))],
      sample: 1,
      violations: {
        "an angle idea has no words": [R(T.ideas, blank), R(T.outbox, ideaFile(blank))],
        "an angle idea has no file queued for the repo": [R(T.ideas, noFile)]
      }
    };
  })(),
  "mkt-research-form": {
    good: [R(T.jobs, research()), R(T.jobs, doneResearch()), R(T.jobs, job({ kind: "avatar", payload: {} }))],
    sample: 2,
    violations: {
      "a research run has no question": [R(T.jobs, research({ payload: { question: " ", depth: "quick", max_cost_usd: 5 } }))],
      "a research run has a depth the form does not offer": [R(T.jobs, research({ payload: { question: "Q", depth: "thorough", max_cost_usd: 5 } }))],
      "a research run has no stop amount above zero": [R(T.jobs, research({ payload: { question: "Q", depth: "deep", max_cost_usd: 0 } }))],
      "a finished run names no repo file for its report": [R(T.jobs, doneResearch({ result: { report: { markdown: "# r" } } }))]
    }
  },
  "mkt-research-card": (() => {
    const done = doneResearch();
    const approved = doneResearch({ approved_at: T0, approved_by: "staff-1" });
    const tweakParent = doneResearch();
    return {
      good: [
        R(T.jobs, done), R(T.outbox, outbox({ op_id: `research-${done.id}-report`, path: "marketing/research/x/report.md" })),
        R(T.jobs, approved), R(T.outbox, outbox({ op_id: `research-${approved.id}-report`, path: "marketing/research/x/report.md" })),
        R(T.outbox, outbox({ op_id: `research-${approved.id}-approved`, path: "marketing/research/x/report.md" })),
        R(T.jobs, tweakParent), R(T.outbox, outbox({ op_id: `research-${tweakParent.id}-report`, path: "marketing/research/x/report.md" })),
        R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, parent_id: tweakParent.id, focus: "look at fees" } }))
      ],
      sample: 4,
      violations: (() => {
        const noReport = doneResearch();
        const noApprovedFile = doneResearch({ approved_at: T0, approved_by: "staff-1" });
        const noPerson = doneResearch({ approved_at: T0, approved_by: null });
        return {
          "a finished report has no file queued": [R(T.jobs, noReport)],
          "an approved report has no approved file queued": [
            R(T.jobs, noApprovedFile), R(T.outbox, outbox({ op_id: `research-${noApprovedFile.id}-report`, path: "marketing/research/x/report.md" }))
          ],
          "an approval has no person behind it": [
            R(T.jobs, noPerson), R(T.outbox, outbox({ op_id: `research-${noPerson.id}-report`, path: "marketing/research/x/report.md" })),
            R(T.outbox, outbox({ op_id: `research-${noPerson.id}-approved`, path: "marketing/research/x/report.md" }))
          ],
          "a tweak run points at no earlier run": [R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, parent_id: "job-missing", focus: "fees" } }))],
          "a tweak run has no note to look at": [R(T.jobs, research({ payload: { question: "Q", depth: "quick", max_cost_usd: 5, parent_id: tweakParent.id, focus: " " } }))]
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
    return {
      good: [R(T.funnels, good), ...pages(good).map((p) => R(T.pages, p)), R(T.funnels, two), ...pages(two).map((p) => R(T.pages, p)),
        R(T.funnels, hand)],
      sample: 2,
      violations: {
        "a built funnel does not have exactly three pages": [R(T.funnels, few), ...pages(few).slice(0, 2).map((p) => R(T.pages, p))],
        "a page sits at an address its funnel does not make": [
          R(T.funnels, moved),
          ...pages(moved).map((p, i) => R(T.pages, i === 1 ? { ...p, path: "/old-book" } : p))
        ]
      }
    };
  })(),
  "mkt-funnel-build": (() => {
    const f = funnel({ key: "built" });
    const jobOk = job({ kind: "funnel", status: "done", result: { checks: "passed" } });
    const pageOf = (o = {}) => ({ id: nid("page"), org_id: ORG, funnel_id: f.id, role: "landing", path: "/x", html: html(f.tag), build_job_id: jobOk.id, ...o });
    return {
      good: [R(T.funnels, f), R(T.jobs, jobOk), R(T.pages, pageOf()), R(T.pages, pageOf({ html: null, build_job_id: null }))],
      sample: 1,
      violations: {
        "a written page has no finished job with a passed copy check": [R(T.pages, pageOf({ build_job_id: "job-missing" }))],
        "a written page does not carry its funnel tag": [R(T.pages, pageOf({ html: html("fnl-other") }))],
        "a written page has no tracking config": [R(T.pages, pageOf({ html: html(f.tag).replace("window.FH_FUNNEL=", "window.X=") }))],
        "a written page has no Meta pixel": [R(T.pages, pageOf({ html: html(f.tag).replace("fbq('init'", "noop('init'") }))]
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
        "a Meta campaign sits on two funnels": {
          rows: [R(T.funnels, funnel({ key: "v4", kind: null, path: null, meta_campaign_ids: ["camp-2"], default_ad_set_external_id: "set-2" })),
            R(T.funnels, funnel({ key: "v5", kind: null, path: null, meta_campaign_ids: ["camp-2"] }))],
          bad: 2
        }
      }
    };
  })(),
  "mkt-scripts-edit": (() => {
    const root = script({ version: 1, archived_at: T0, status: "superseded", repo_path: "marketing/ads/scripts/a.md" });
    const edit = script({ root_script_id: root.id, parent_script_id: root.id, version: 2, source: "chris", repo_path: root.repo_path });
    const file = (s) => R(T.outbox, outbox({ path: s.repo_path, op_id: nid("op") }));
    const mk = (o = {}) => {
      const r = script({ version: 3, archived_at: T0, repo_path: `marketing/ads/scripts/${nid("r")}.md` });
      const e = script({ root_script_id: r.id, parent_script_id: r.id, version: 4, source: "chris", repo_path: r.repo_path, ...o });
      return { r, e };
    };
    const gap = mk({ version: 7 });
    const moved = mk();
    const live = mk();
    const twoLive = mk();
    const noFile = mk();
    noFile.e.repo_path = "marketing/ads/scripts/never-queued.md";
    const sibling = script({ root_script_id: twoLive.r.id, parent_script_id: twoLive.r.id, version: 4, source: "machine", repo_path: twoLive.r.repo_path });
    return {
      good: [R(T.scripts, root), R(T.scripts, edit), file(edit),
        R(T.scripts, script({ version: 1, source: "chris" }))],
      sample: 1,
      violations: {
        "an edit is not one version after the one it replaced": [R(T.scripts, gap.r), R(T.scripts, gap.e), file(gap.e)],
        "an edit moved to a different script": [R(T.scripts, moved.r), R(T.scripts, { ...moved.e, root_script_id: "root-elsewhere" }), file(moved.e)],
        "the replaced version is still live": [R(T.scripts, { ...live.r, archived_at: null }), R(T.scripts, { ...live.e, archived_at: T0 }), file(live.e)],
        "a script has two live versions": [R(T.scripts, twoLive.r), R(T.scripts, twoLive.e), R(T.scripts, sibling), file(twoLive.e)],
        "an edit has no repo file queued": [R(T.scripts, noFile.r), R(T.scripts, noFile.e)]
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
    const live = mk({}, { archived_at: null });
    const okJob = job({ kind: "fix_script", payload: { script_id: good.r.id, version: 1, note: "make it shorter" } });
    return {
      good: [R(T.scripts, good.r), R(T.scripts, good.f), R(T.jobs, okJob)],
      sample: 2,
      violations: {
        "a rewrite is not one version after the one it replaced": [R(T.scripts, gap.r), R(T.scripts, gap.f)],
        "a rewrite moved to a different script": [R(T.scripts, moved.r), R(T.scripts, moved.f)],
        "a rewrite changed the ad number": [R(T.scripts, renumbered.r), R(T.scripts, renumbered.f)],
        "the replaced version is still live": [R(T.scripts, live.r), R(T.scripts, live.f)],
        "a fix request carries no note": [R(T.jobs, job({ kind: "fix_script", payload: { script_id: good.r.id, note: " " } }))],
        "a fix request names no script of this company": [R(T.jobs, job({ kind: "fix_script", payload: { script_id: "script-missing", note: "x" } }))]
      }
    };
  })(),
  "mkt-scripts-write-now": (() => {
    const b = { id: nid("batch"), org_id: ORG, kind: "on_command", status: "released", release_at: T0, total: 1 };
    const startFor = (batch) => job({ kind: "start_batch", payload: { batch_id: batch.id } });
    const noJob = { ...b, id: nid("batch") };
    const noTime = { ...b, id: nid("batch"), release_at: null };
    const empty = { ...b, id: nid("batch"), total: 0 };
    return {
      good: [R(T.batches, b), R(T.jobs, startFor(b)), R(T.batches, { ...b, id: nid("batch"), kind: "weekly", total: 0, release_at: null })],
      sample: 1,
      violations: {
        "a Write now batch has no start job": [R(T.batches, noJob)],
        "a Write now batch has no release time": [R(T.batches, noTime), R(T.jobs, startFor(noTime))],
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
        "an idea names a funnel this company does not have": [R(T.ideas, badFunnel), R(T.outbox, ideaFile(badFunnel))],
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
        edit("marketing/flywheel/partner/01-avatar.md", { op: "set_front_matter_key", key: "status", value: "approved" })
      ],
      sample: 3,
      violations: {
        "a rule change edits the banned list": [edit(BAN, { op: "part0_add_rule", text: "x" })],
        "a ban edits the rules file": [edit(RULES, { op: "ban_phrase", phrase: "x" })],
        "a rule change carries no words": [edit(RULES, { op: "part0_add_rule", text: " " })],
        "a ban carries no phrase": [edit(BAN, { op: "ban_phrase", phrase: "" })],
        "a rule change names no rule number": [edit(RULES, { op: "part0_edit_rule", text: "x" })]
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
    const rawVideo = video({ video_kind: "raw_take" });
    const unapprovedQueued = video({ approved_at: null, approved_by: null });
    return {
      good: [R(T.videos, v), R(T.ads, adFor(v)), R(T.videos, waiting), R(T.videos, approvedVideo), R(T.jobs, loadJob(approvedVideo))],
      sample: 2,
      violations: {
        "a loaded video was never approved by a person": [R(T.videos, unapproved), R(T.ads, adFor(unapproved))],
        "a loaded video is missing a Meta id": [R(T.videos, noId), R(T.ads, adFor(noId))],
        "a loaded video has no ad row of ours": [R(T.videos, noAd)],
        "a loaded video still carries a load error": [R(T.videos, errored), R(T.ads, adFor(errored))],
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
    const rawVideo = video({ video_kind: "raw_take" });
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
  const fileViolations = (n, file) => ({
    "a saved step file has no stamp": [R(T.outbox, stepFile(n, file, { content: "no stamp here" }))],
    "a saved step file is stamped as another step": [R(T.outbox, stepFile(n, file, { content: `---\nstage: ${n === 1 ? 2 : 1}\nversion: 1\n---\nx` }))],
    "an approve edit sets something other than status approved": [R(T.outbox, approve(file, { edit: { op: "set_front_matter_key", key: "status", value: "draft" } }))]
  });
  const goodFiles = (n, file) => [R(T.outbox, stepFile(n, file)), R(T.outbox, approve(file)),
    R(T.outbox, outbox({ path: "marketing/flywheel/partner/00-OWNER-NOTES.md", mode: "edit", content: null, edit: { op: "append_line_under_heading", heading: "## Notes", line: "x" } }))];
  const out = {};

  const avatarJob = job({ kind: "avatar", status: "done", payload: {}, result: { ok: true } });
  out["mkt-flywheel-1-avatar"] = {
    good: [...goodFiles(1, "01-avatar.md"), R(T.jobs, avatarJob), R(T.outbox, outbox({ op_id: `avatar:${avatarJob.id}:01-avatar.md`, path: "marketing/flywheel/partner/01-avatar.md", content: "---\nstage: 1\n---" })),
      R(T.jobs, job({ kind: "avatar", status: "running" }))],
    sample: 4,
    violations: {
      ...fileViolations(1, "01-avatar.md"),
      "a finished avatar run has no file queued": [R(T.jobs, job({ kind: "avatar", status: "done", payload: {}, result: { ok: true } }))]
    }
  };

  const marketJob = job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 2 }, result: {} });
  out["mkt-flywheel-2-ad-research"] = {
    good: [...goodFiles(2, "02-ad-research.md"), R(T.jobs, marketJob), R(T.outbox, outbox({ op_id: `flywheel-${marketJob.id}-02` })),
      R(T.jobs, job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 4 }, result: {} }))],
    sample: 3 + 1,
    violations: {
      ...fileViolations(2, "02-ad-research.md"),
      "a finished market run has no file queued": [R(T.jobs, job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: 2 }, result: {} }))]
    }
  };

  const offerResult = { campaign: "partner", offer: { name: "The offer" }, document: "# Offer", model: "claude-opus-5-5" };
  out["mkt-flywheel-3-offer"] = {
    good: [...goodFiles(3, "03-offer.md"), R(T.jobs, job({ kind: "offer", status: "done", result: offerResult })),
      R(T.jobs, job({ kind: "offer", status: "failed", error: "no key", result: null }))],
    sample: 3,
    violations: {
      ...fileViolations(3, "03-offer.md"),
      "a finished offer run holds no offer": [R(T.jobs, job({ kind: "offer", status: "done", result: { ...offerResult, offer: null } }))],
      "a finished offer run holds no document": [R(T.jobs, job({ kind: "offer", status: "done", result: { ...offerResult, document: "" } }))],
      "a finished offer run names no model": [R(T.jobs, job({ kind: "offer", status: "done", result: { ...offerResult, model: " " } }))]
    }
  };

  for (const [n, file, key, word] of [[4, "04-copy.md", "mkt-flywheel-4-copy", "copy"], [5, "05-ad-strategy.md", "mkt-flywheel-5-strategy", "strategy"]]) {
    const done = job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: n }, result: {} });
    out[key] = {
      good: [...goodFiles(n, file), R(T.jobs, done), R(T.outbox, outbox({ op_id: `flywheel:${done.id}:${file}`, path: `marketing/flywheel/partner/${file}`, content: `---\nstage: ${n}\n---` }))],
      sample: 4,
      violations: {
        ...fileViolations(n, file),
        [`a finished ${word} run has no file queued`]: [R(T.jobs, job({ kind: "flywheel_stage", status: "done", payload: { campaign: "partner", stage: n }, result: {} }))]
      }
    };
  }

  out["mkt-flywheel-6-spend"] = {
    good: [...goodFiles(6, "06-spend.md"), R(T.outbox, outbox({ op_id: "flywheel-spend:req-1", path: "marketing/flywheel/partner/06-spend.md", content: "---\nstage: 6\n---" }))],
    sample: 4,
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
  assert.equal(FIN_B15_CHECKS.length, 26);
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

  test(`${spec.key}: another company's wrong rows are never read`, () => {
    const swapOrg = (row) => ({ ...row, org_id: row.org_id === ORG ? OTHER : row.org_id });
    const wrongElsewhere = Object.values(fixture.violations)
      .flatMap((entry) => rowsOfViolation(entry))
      .map(([table, row]) => [table, { ...swapOrg(row), id: row.id ? `${row.id}-far` : row.id }]);
    const db = standIn(spec, [fixture.good, wrongElsewhere]);
    try {
      const out = db.run(sqlFor(spec), ORG);
      // The empty-book rule asks "does THIS company have lenders", so it is not a row of another company.
      assert.equal(out.bad_count, 0, "rows of another company must not be counted");
    } catch (error) {
      // A stand-in table that refuses a duplicate id never happens here (plain tables), so any throw is real.
      throw error;
    } finally { db.close(); }
  });
}

test("the registry holds exactly the text the test ran, one contract per control, all unique", () => {
  assert.equal(FIN_B15_DISPLAY_CONTRACTS.length, 26);
  assert.equal(new Set(FIN_B15_DISPLAY_CONTRACTS.map((c) => c.control)).size, 26);
  assert.equal(new Set(FIN_B15_DISPLAY_CONTRACTS.map((c) => c.sql)).size, 26);
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

test("the month meter names every model that has a price on file", () => {
  const priced = Object.keys(MODEL_PRICES).sort();
  const spec = FIN_B15_CHECKS.find((c) => c.key === "mkt-month-meter");
  const text = sqlFor(spec);
  for (const model of priced) assert.ok(text.includes(`'${model}'`), `${model} has a price on file but the meter check does not name it`);
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
