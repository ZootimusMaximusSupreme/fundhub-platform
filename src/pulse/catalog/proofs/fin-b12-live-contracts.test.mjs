// Guards for the batch 12 live checks (Creative Factory, Documents, Finance OS, careers form, Galaxy, Hiring).
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
import test from "node:test";

import {
  FIN_B12_CHECKS, FIN_B12_CONTROLS, FIN_B12_DISPLAY_CONTRACTS, sqlFor,
} from "./fin-b12-display-contracts.mjs";
import { makeStandIn, schemaColumns, tablesIn } from "./fin-b12-sql-kit.mjs";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const T0 = "2026-10-14T10:00:00.000Z"; // two hours before the stand-in's fixed "now"
const OLD = "2026-10-10T10:00:00.000Z";
const LONG_AGO = "2026-08-01T10:00:00.000Z";

let counter = 0;
const nid = (p) => `${p}-${String(++counter).padStart(4, "0")}`;
const R = (table, row) => [table, row];

/* ── row builders. Each gives a GOOD row; a test overrides one field to make it wrong. ── */
const job = (o = {}) => ({ id: nid("job"), org_id: ORG, partner_id: "p-1", status: "succeeded", attempt: 1, error: null,
  started_at: T0, finished_at: T0, created_at: T0, updated_at: T0, ...o });
const asset = (o = {}) => ({ id: nid("asset"), org_id: ORG, partner_id: "p-1", kind: "static", format: "1x1",
  compliance_state: "passed", blocked_reasons: [], archived_at: null, ...o });
const kit = (o = {}) => ({ id: nid("kit"), org_id: ORG, partner_id: "p-1", name: "House brand", status: "active", ...o });
const connection = (o = {}) => ({ id: nid("conn"), org_id: ORG, platform: "youtube", external_account_id: "UC-channel",
  encrypted_credentials: "v1:aXY=:dGFn:Y3Q=", connection_state: "active", last_error: null, last_synced_at: T0, ...o });
const watch = (conn, o = {}) => ({ id: nid("watch"), org_id: conn.org_id, connection_id: conn.id, youtube_video_id: nid("yt"),
  stat_date: "2026-10-13", views: 120, estimated_minutes_watched: 340, average_view_percentage: 41.5, captured_at: T0, ...o });
const label = (kind, key, o = {}) => ({ id: nid("label"), org_id: ORG, kind, key, ...o });
const script = (o = {}) => { const id = nid("script");
  return { id, org_id: ORG, source: "chris", angle_key: "denial_angle", hook_key: "three_second", offer_key: "funding_600",
    script_type: "vsl", parent_script_id: null, version: 1, root_script_id: id, archived_at: null, ...o }; };
const LABELS = [label("angle", "denial_angle"), label("hook", "three_second"), label("offer", "funding_600"), label("script_type", "vsl")];
const client = (o = {}) => ({ id: nid("client"), org_id: ORG, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com",
  is_demo: false, funded: false, funded_amount: null, updated_at: OLD, ...o });
const org = (o = {}) => ({ id: ORG, slug: "fundhub", name: "Fundhub", demo_mode_enabled: false, ...o });
const doc = (o = {}) => ({ id: nid("doc"), org_id: ORG, client_id: null, document_key: nid("key"), kind: "contract", subtype: null,
  title: "Funding agreement", mime_type: "application/pdf", generated_at: T0, delivery_status: "sent", delivered_at: T0,
  signature_required: true, signed_at: null, is_demo: false, ...o });
const staff = (o = {}) => ({ id: nid("staff"), org_id: ORG, name: "Casey Reed", role: "closer", status: "active", is_demo: false, ...o });
const shift = (s, o = {}) => ({ id: nid("shift"), org_id: ORG, staff_id: s.id, started_at: T0, ended_at: null, is_demo: false, ...o });
const event = (s, o = {}) => ({ id: nid("event"), org_id: ORG, staff_id: s.id, kind: "call_logged", created_at: T0, is_demo: false, ...o });
const agent = (o = {}) => ({ id: nid("agent"), org_id: ORG, code: nid("AG"), name: "Lead Follow-up", status: "live",
  went_live_at: OLD, retired_at: null, ...o });
const outcome = (o = {}) => ({ id: nid("outcome"), org_id: ORG, client_id: null, cash_collected_cents: 5000, logged_at: T0, is_demo: false, ...o });
const stage = (key, o = {}) => ({ id: `stage-${key}`, org_id: ORG, key, name: key, ...o });
const STAGES = ["applied", "group_interview", "one_on_one", "offer"].map((k) => R("pipeline_stages", stage(k)));
const roleRow = (o = {}) => ({ id: nid("role"), org_id: ORG, key: nid("closer"), name: "Closer", bench_target: 4, active: true,
  hiring_manager_staff_id: null, ...o });
const candidate = (o = {}) => ({ id: nid("cand"), org_id: ORG, full_name: "Pat Quill", email: `${nid("p")}@example.com`, ...o });
const application = (cand, role, stageKey, o = {}) => ({ id: nid("app"), org_id: ORG, candidate_id: cand.id, role_id: role.id,
  stage_id: `stage-${stageKey}`, status: "open", entered_stage_at: T0, applied_at: T0, video_url: null,
  resume_document_id: null, external_application_id: null, ...o });
const decision = (app, to, o = {}) => ({ id: nid("dec"), org_id: ORG, application_id: app.id, decision: "advance", from_stage_key: "applied", to_stage_key: to, ...o });
const score = (app, o = {}) => ({ id: nid("score"), org_id: ORG, application_id: app.id, stage_key: "applied", rubric_version: 1,
  average: 3.2, flags: [], is_automated: true, scored_by_staff_id: null, ...o });
const task = (app, o = {}) => ({ id: nid("task"), org_id: ORG, title: "New application", body: `hiring:applied:${app.id}`,
  source_workflow: "hiring-new-application", ...o });
const outreach = (app, cand, o = {}) => ({ id: nid("out"), org_id: ORG, application_id: app.id, candidate_id: cand.id, status: "active", ...o });
const benchRow = (r, o = {}) => ({ org_id: ORG, role_id: r.id, role_key: r.key, role_name: r.name, bench_target: r.bench_target,
  hiring_manager_staff_id: r.hiring_manager_staff_id, open_applications: 0, bench_count: 0, bench_shortfall: r.bench_target, ...o });

/** A role with one candidate on the board, everything good: returns the rows and the pieces. */
function boardPerson(stageKey, { withTask = false, withOutreach = false, applied = T0 } = {}) {
  const r = roleRow();
  const c = candidate();
  const a = application(c, r, stageKey, { applied_at: applied, entered_stage_at: applied });
  const rows = [R("hiring_roles", r), R("candidates", c), R("candidate_applications", a)];
  if (stageKey !== "applied") rows.push(R("hiring_decisions", decision(a, stageKey)));
  if (withTask) rows.push(R("tasks", task(a)));
  if (withOutreach) rows.push(R("candidate_outreach", outreach(a, c)));
  return { r, c, a, rows };
}

/* ── the fixtures: sample = how many rows the check should read, violations = one wrong row each ── */

const T = (...rows) => rows;

const FIX = {};

{ // cf-tiles: the saved jobs behind JOBS IN FLIGHT and FAILED JOBS (the database refuses every other bad state)
  const stale = (status, o = {}) => job({ status, started_at: status === "running" ? LONG_AGO : null, finished_at: null,
    created_at: LONG_AGO, updated_at: LONG_AGO, ...o });
  FIX["cf-tiles"] = {
    good: T(
      R("generation_jobs", job()),
      R("generation_jobs", job({ status: "failed", error: "provider returned zero assets" })),
      R("generation_jobs", job({ status: "running", finished_at: null })),
      R("generation_jobs", job({ status: "queued", started_at: null, finished_at: null, error: "retrying" })),
      // 23 hours in flight is inside the day, and so is exactly 24 (over a day means MORE than a day); an old
      // finished job is not "in flight" at all
      R("generation_jobs", job({ status: "queued", started_at: null, finished_at: null, updated_at: "2026-10-13T13:00:00.000Z" })),
      R("generation_jobs", job({ status: "queued", started_at: null, finished_at: null, updated_at: "2026-10-13T12:00:00.000Z" })),
      R("generation_jobs", job({ status: "succeeded", created_at: LONG_AGO, updated_at: LONG_AGO })),
      R("generation_jobs", job({ status: "failed", error: "provider returned zero assets", created_at: LONG_AGO, updated_at: LONG_AGO }))),
    sample: 8,
    violations: {
      "a failed job carries no reason": T(R("generation_jobs", job({ status: "failed", error: "   " }))),
      "a finished job has no finish time": T(R("generation_jobs", job({ status: "succeeded", finished_at: null }))),
      "a running job has no start time": T(R("generation_jobs", job({ status: "running", started_at: null, finished_at: null }))),
      "a job counted in flight has a finish time": T(R("generation_jobs", job({ status: "queued", started_at: null, finished_at: T0 }))),
      "a job has sat in flight for over a day": T(R("generation_jobs", stale("running"))),
    },
    // The same condition, from the other leg of the same word: each leg of an "or" must be load-bearing.
    extra: {
      "a failed job carries no reason": [
        T(R("generation_jobs", job({ status: "failed", error: null }))),
      ],
      "a finished job has no finish time": [
        T(R("generation_jobs", job({ status: "failed", error: "provider returned zero assets", finished_at: null }))),
      ],
      "a job counted in flight has a finish time": [
        T(R("generation_jobs", job({ status: "running", finished_at: T0 }))),
      ],
      "a job has sat in flight for over a day": [
        T(R("generation_jobs", stale("queued"))),
        T(R("generation_jobs", job({ status: "queued", started_at: null, finished_at: null, updated_at: "2026-10-13T11:00:00.000Z" }))), // 25 hours
      ],
    },
  };
}

{ // cf-video-table
  const c = connection();
  FIX["cf-video-table"] = {
    good: T(R("analytics_connections", c), R("video_watch_stats", watch(c)), R("video_watch_stats", watch(c, { views: 0, estimated_minutes_watched: 0 })),
      // a looping short can be watched for more than 100% of its length on average; that is not wrong
      R("video_watch_stats", watch(c, { average_view_percentage: 130 })),
      R("video_watch_stats", watch(c, { average_view_percentage: 0 })), // a video nobody watched: zero is not below zero
      R("analytics_connections", connection({ platform: "clickfunnels", connection_state: "error", last_error: null }))),
    sample: 5,
    violations: (() => {
      const live = connection();
      return {
        "a row has no video id": T(R("analytics_connections", live), R("video_watch_stats", watch(live, { youtube_video_id: "" }))),
        "a row has negative views": T(R("analytics_connections", live), R("video_watch_stats", watch(live, { views: -1 }))),
        "a row has negative minutes watched": T(R("analytics_connections", live), R("video_watch_stats", watch(live, { estimated_minutes_watched: -5 }))),
        "average watched is below zero": T(R("analytics_connections", live), R("video_watch_stats", watch(live, { average_view_percentage: -5 }))),
        "no YouTube connection of this company owns the row": T(R("video_watch_stats", watch({ id: "gone", org_id: ORG }))),
        "the badge says error or expired and gives no reason": T(R("analytics_connections", connection({ connection_state: "expired", last_error: "" }))),
        "the badge says active but an error is still saved": T(R("analytics_connections", connection({ connection_state: "active", last_error: "invalid_grant" }))),
      };
    })(),
    extra: (() => {
      const other = connection({ platform: "clickfunnels" });          // this company's, but not YouTube
      const far = connection({ org_id: OTHER });                       // YouTube, but another company's
      return {
        "no YouTube connection of this company owns the row": [
          T(R("analytics_connections", other), R("video_watch_stats", watch(other))),
          T(R("analytics_connections", far), R("video_watch_stats", watch(far, { org_id: ORG }))),
        ],
        "the badge says error or expired and gives no reason": [
          T(R("analytics_connections", connection({ connection_state: "error", last_error: null }))),
        ],
      };
    })(),
  };
}

FIX["cf-connect"] = {
  good: T(R("analytics_connections", connection()), R("analytics_connections", connection({ platform: "clickfunnels", encrypted_credentials: "{}" })),
    R("analytics_connections", connection({ platform: "youtube", connection_state: "pending", encrypted_credentials: null, external_account_id: null }))),
  sample: 2,
  violations: {
    "a connection past pending holds no credentials": T(R("analytics_connections", connection({ encrypted_credentials: null }))),
    "credentials are saved as plain text, not encrypted": T(R("analytics_connections", connection({ encrypted_credentials: "{\"a\":\"1\",\"b\":\"2\",\"c\":\"3\"}" }))),
    "credentials are not in the four-part encrypted form": T(R("analytics_connections", connection({ encrypted_credentials: "just-some-text" }))),
    "an active connection names no channel": T(R("analytics_connections", connection({ external_account_id: " " }))),
  },
};

{ // cf-sync
  const c = connection();
  FIX["cf-sync"] = {
    good: T(R("analytics_connections", c), R("video_watch_stats", watch(c)),
      R("analytics_connections", connection({ platform: "youtube", connection_state: "pending", last_synced_at: null }))),
    sample: 2,
    violations: {
      "a row is a made-up zero: no views and no minutes": T(R("analytics_connections", c), R("video_watch_stats", watch(c, { views: 0, estimated_minutes_watched: 0 }))),
      "a row has no capture time": T(R("analytics_connections", c), R("video_watch_stats", watch(c, { captured_at: null }))),
      "a row belongs to a connection that never synced": (() => {
        const never = connection({ last_synced_at: null });
        return T(R("analytics_connections", never), R("video_watch_stats", watch(never)));
      })(),
      "a connection that synced is still pending": T(R("analytics_connections", connection({ connection_state: "pending", last_synced_at: T0 }))),
    },
  };
}

FIX["cf-script"] = {
  good: T(...LABELS.map((l) => R("ad_labels", l)), R("ad_scripts", script()),
    R("ad_scripts", script({ source: "machine", angle_key: "Not Settled Angle" })), // machine rows are not this form's
    R("ad_scripts", script({ angle_key: null, hook_key: null, offer_key: null, script_type: null }))),
  sample: 2,
  violations: (() => {
    const parent = script({ version: 1, archived_at: OLD });
    const okChild = (o) => script({ parent_script_id: parent.id, root_script_id: parent.root_script_id, version: 2, ...o });
    const base = [...LABELS.map((l) => R("ad_labels", l))];
    return {
      "the angle label is not in settled form": T(...base, R("ad_labels", label("angle", "Denial Angle")), R("ad_scripts", script({ angle_key: "Denial Angle" }))),
      "the angle label has no dictionary entry": T(...base, R("ad_scripts", script({ angle_key: "brand_new_angle" }))),
      "the hook label is not in settled form": T(...base, R("ad_labels", label("hook", "Three Second")), R("ad_scripts", script({ hook_key: "Three Second" }))),
      "the hook label has no dictionary entry": T(...base, R("ad_scripts", script({ hook_key: "unlisted_hook" }))),
      "the offer label is not in settled form": T(...base, R("ad_labels", label("offer", "Funding 600")), R("ad_scripts", script({ offer_key: "Funding 600" }))),
      "the offer label has no dictionary entry": T(...base, R("ad_scripts", script({ offer_key: "unlisted_offer" }))),
      "the script_type label is not in settled form": T(...base, R("ad_labels", label("script_type", "VSL")), R("ad_scripts", script({ script_type: "VSL" }))),
      "the script_type label has no dictionary entry": T(...base, R("ad_scripts", script({ script_type: "podcast" }))),
      "a rewrite names a parent that is not there": T(...base, R("ad_scripts", script({ parent_script_id: "no-such-parent", version: 2 }))),
      "a rewrite is not one version after its parent, or sits under another root":
        T(...base, R("ad_scripts", parent), R("ad_scripts", okChild({ version: 3 }))),
      "a version that was rewritten is still live": (() => {
        const old = script({ version: 1, archived_at: null });
        return T(...base, R("ad_scripts", old), R("ad_scripts", script({ parent_script_id: old.id, root_script_id: old.root_script_id, version: 2 })));
      })(),
    };
  })(),
};

{ // documents page
  const c = client();
  const demoOn = org({ demo_mode_enabled: true });
  FIX["docs-page-load"] = {
    good: T(R("clients", c), R("documents", doc({ client_id: c.id })), R("documents", doc({ client_id: c.id, kind: "client_upload", mime_type: "image/png", generated_at: null, delivery_status: "not_delivered", delivered_at: null, signature_required: false })),
      R("documents", doc({ client_id: c.id, title: null, document_key: "key-only" })),          // a key is enough
      R("documents", doc({ client_id: c.id, title: "Title only", document_key: null })),         // so is a title
      R("documents", doc({ client_id: c.id, subtype: "template_source", title: null, document_key: null })), // a blank template: not on this list
      R("orgs", org({ demo_mode_enabled: true })), R("clients", client({ is_demo: true, email: "demo.client.01@fundhub.test" }))),
    sample: 5, // four listed documents, plus the org row in demo mode
    violations: {
      // The client exists, but on another company; this company has a client of its own, so a check that only
      // asks "is there any client" or "is it this id or this company" does not read it as wrong.
      "a document names a client that is not in this company": T(R("clients", client({ id: "far-client", org_id: OTHER })), R("clients", client()),
        R("documents", doc({ client_id: "far-client" }))),
      "a document has neither a title nor a key": T(R("documents", doc({ title: " ", document_key: "" }))),
      "a document is marked sent or delivered with no sent time": T(R("documents", doc({ delivery_status: "delivered", delivered_at: null }))),
      "a document is signed though no signature was required": T(R("documents", doc({ signature_required: false, signed_at: T0 }))),
      "demo mode is on but there is no primary demo client to send the owner to": T(R("orgs", demoOn)),
    },
    extra: {
      // The primary demo client has to be THIS company's, and has to be a demo row.
      "demo mode is on but there is no primary demo client to send the owner to": [
        T(R("orgs", demoOn), R("clients", client({ org_id: OTHER, is_demo: true, email: "demo.client.01@fundhub.test" }))),
        T(R("orgs", demoOn), R("clients", client({ is_demo: false, email: "demo.client.01@fundhub.test" }))),
      ],
    },
  };
}

{ // finance os: picker, page load, promo (the header has no live check: see FIN_B12_CONTROLS)
  const named = client();
  const onlyEmail = client({ first_name: null, last_name: null, email: "pat@example.com" });
  FIX["fos-picker"] = {
    // A client with no name and no email is the page's own designed fallback ("Unnamed client"): not wrong, not read.
    good: T(R("orgs", org()), R("clients", named), R("clients", onlyEmail), R("clients", client({ first_name: null, last_name: null, email: null })),
      R("clients", client({ is_demo: true }))),
    sample: 1, // the one whole-book count
    violations: {
      "the company holds more clients than the picker lists": T(R("orgs", org()), ...Array.from({ length: 501 }, () => R("clients", client()))),
    },
  };
  FIX["fos-page-load"] = {
    good: T(R("orgs", org()), R("clients", named)),
    sample: 0,
    violations: {
      "demo mode is on but there is no primary demo client to send the owner to": T(R("orgs", org({ demo_mode_enabled: true })), R("clients", named)),
    },
    goodWhenDemoOn: T(R("orgs", org({ demo_mode_enabled: true })), R("clients", client({ is_demo: true, email: "demo.client.01@fundhub.test" }))),
    extra: {
      "demo mode is on but there is no primary demo client to send the owner to": [
        T(R("orgs", org({ demo_mode_enabled: true })), R("clients", client({ org_id: OTHER, is_demo: true, email: "demo.client.01@fundhub.test" }))),
        T(R("orgs", org({ demo_mode_enabled: true })), R("clients", client({ is_demo: false, email: "demo.client.01@fundhub.test" }))),
      ],
    },
  };
  FIX["fos-promo"] = {
    good: T(R("account_statement_cycles", { id: nid("cyc"), org_id: ORG, client_id: named.id, promo_ends_on: null })),
    sample: 1,
    violations: {
      "a card has a promo end date saved though the panel says none is stored":
        T(R("account_statement_cycles", { id: nid("cyc"), org_id: ORG, client_id: named.id, promo_ends_on: "2026-12-06", promo_apr: 0, promo_source: "client", promo_set_at: T0 })),
    },
  };
}

{ // careers
  const OLD_ENOUGH = OLD; // four days ago: inside the 30 days, past the one-hour grace
  const done = boardPerson("applied", { withTask: true, withOutreach: true, applied: OLD_ENOUGH });
  const noTask = boardPerson("applied", { withOutreach: true, applied: OLD_ENOUGH });
  const noCadence = boardPerson("applied", { withTask: true, applied: OLD_ENOUGH });
  const linkedIn = boardPerson("applied", { applied: OLD_ENOUGH });
  linkedIn.a.external_application_id = "li-1"; // arrived by another path, so not this form's
  FIX["careers-apply"] = {
    good: T(...done.rows, ...linkedIn.rows,
      ...boardPerson("applied", { applied: "2026-10-14T11:30:00.000Z" }).rows, // filed 30 minutes ago: inside the one-hour grace
      ...boardPerson("applied", { applied: LONG_AGO }).rows), // older than 30 days: not judged
    sample: 1,
    violations: {
      "the candidate is not in this company": T(R("hiring_roles", done.r), R("candidate_applications", { ...done.a, id: "app-no-candidate", candidate_id: "ghost-candidate" }),
        R("tasks", task({ id: "app-no-candidate" })), R("candidate_outreach", outreach({ id: "app-no-candidate" }, done.c))),
      "nobody was told: no new-application task exists": T(...noTask.rows),
      "no follow-up cadence was started": T(...noCadence.rows),
    },
  };
}

{ // galaxy
  const s = staff();
  FIX["galaxy-feed"] = {
    good: T(R("orgs", org()), R("staff", s), R("shifts", shift(s)), R("staff_events", event(s)), R("agents", agent()),
      R("agents", agent({ status: "shadow", went_live_at: null })), R("agents", agent({ status: "draft", went_live_at: null, name: "" })),
      R("clients", client({ id: "c-ok" })), R("call_outcomes", outcome({ client_id: "c-ok" })),
      R("clients", client({ funded: true, funded_amount: 12000, updated_at: T0 })),
      R("staff", staff({ is_demo: true, name: "" })), // demo rows are not the sky's real people
      R("shifts", shift(s, { started_at: LONG_AGO, ended_at: OLD }))), // a closed shift is not an open one
    sample: 1 + 1 + 1 + 2 + 1 + 1, // staff, open shift, event, two agents, call outcome, funded client
    violations: (() => {
      const p = staff();
      return {
        "a person has two open shifts, so the sky lists them twice": T(R("staff", p), R("shifts", shift(p)), R("shifts", shift(p))),
        "a person shown in the sky has no name": T(R("staff", staff({ name: "  " }))),
        "a shift has been open for over a day, so the sky shows someone working all night": T(R("staff", p), R("shifts", shift(p, { started_at: LONG_AGO }))),
        "an open shift names a person who is not on staff": T(R("shifts", { id: nid("shift"), org_id: ORG, staff_id: "ghost-staff", started_at: T0, ended_at: null, is_demo: false })),
        "an event names nobody on staff": T(R("staff_events", { id: nid("event"), org_id: ORG, staff_id: "ghost-staff", kind: "call", created_at: T0, is_demo: false })),
        "an event has no kind": T(R("staff", p), R("staff_events", event(p, { kind: "" }))),
        "a live agent has no go-live time": T(R("agents", agent({ went_live_at: null }))),
        "an agent has no name": T(R("agents", agent({ name: " " }))),
        "cash collected is below zero": T(R("call_outcomes", outcome({ cash_collected_cents: -100 }))),
        "a call outcome names a client of another company": T(R("clients", client({ id: "far-client", org_id: OTHER })), R("call_outcomes", outcome({ client_id: "far-client" }))),
        "a client counted as funded today has no funded amount": T(R("clients", client({ funded: true, funded_amount: null, updated_at: T0 }))),
      };
    })(),
  };
  FIX["galaxy-page-load"] = {
    good: T(R("orgs", org()), R("staff", s), R("agents", agent())),
    sample: 2, // the org row and the one person
    violations: {
      "the sky has nobody to show: no active person and no live agent": T(R("orgs", org()), R("staff", staff({ status: "suspended" })), R("agents", agent({ status: "draft" }))),
      "a person the census counts has no name": T(R("orgs", org()), R("staff", staff({ name: "" }))),
    },
  };
}

{ // hiring
  const manager = staff({ role: "admin" });
  const r = roleRow({ hiring_manager_staff_id: manager.id });
  const c1 = candidate();
  const c2 = candidate();
  const inOne = application(c1, r, "one_on_one");
  const inOffer = application(c2, r, "offer");
  const goodBench = (o = {}) => benchRow(r, { open_applications: 2, bench_count: 2, bench_shortfall: 2, ...o });
  // People who must NOT count: one still in Applied, one at the 1:1 whose application is closed, and another
  // role's person who IS at the 1:1. An active role with a target of zero is allowed.
  const r2 = roleRow();
  const noise = [
    R("hiring_roles", r2), R("candidate_applications", application(candidate(), r, "applied")),
    R("candidate_applications", application(candidate(), r, "one_on_one", { status: "rejected" })),
    R("candidate_applications", application(candidate(), r2, "one_on_one")),
    R("hiring_roles", roleRow({ bench_target: 0 })),
  ];
  FIX["hiring-bench"] = {
    good: T(...STAGES, R("staff", manager), R("hiring_roles", r), R("candidates", c1), R("candidates", c2),
      R("candidate_applications", inOne), R("candidate_applications", inOffer), R("v_hiring_bench", goodBench()),
      ...noise,
      R("hiring_roles", roleRow({ active: false, bench_target: -3 }))),
    sample: 4, // the bench row, and the three active roles (r, the other role, and the zero-target role)
    violations: {
      "the bench count is not the open applications at one-on-one and offer":
        T(...STAGES, R("hiring_roles", r), R("staff", manager), R("v_hiring_bench", goodBench({ bench_count: 3, bench_shortfall: 1 }))),
      "short-by is not the target minus the bench":
        T(...STAGES, R("hiring_roles", r), R("staff", manager), R("v_hiring_bench", goodBench({ bench_count: 0, bench_shortfall: 9 }))),
      "the hiring manager is not on staff":
        T(...STAGES, R("hiring_roles", roleRow({ id: r.id, key: r.key, hiring_manager_staff_id: null })), R("v_hiring_bench", goodBench({ bench_count: 0, bench_shortfall: 4, hiring_manager_staff_id: "ghost-staff" }))),
      "an active role has a negative bench target": T(R("hiring_roles", roleRow({ bench_target: -1 }))),
      "an active role has no name": T(R("hiring_roles", roleRow({ name: " " }))),
    },
    extra: {
      // The manager exists, but on another company's staff: a person this company cannot see.
      "the hiring manager is not on staff": [
        T(...STAGES, R("hiring_roles", r), R("staff", staff({ id: "far-manager", org_id: OTHER, role: "admin" })),
          R("v_hiring_bench", goodBench({ bench_count: 0, bench_shortfall: 4, hiring_manager_staff_id: "far-manager" }))),
      ],
    },
  };

  const full = boardPerson("one_on_one");
  FIX["hiring-card"] = {
    good: T(...full.rows, R("documents", { id: "resume-1", org_id: ORG, kind: "client_upload" }),
      R("candidate_applications", application(full.c, full.r, "applied", { video_url: "https://vid.example.com/a", resume_document_id: "resume-1" })),
      R("application_scores", score(full.a)), R("application_scores", score(full.a, { average: null, flags: ["short answer"] })),
      R("application_scores", score(full.a, { is_automated: false, scored_by_staff_id: "staff-1" }))),
    sample: 2 + 3,
    violations: (() => {
      // Every "not in this company" row is built the way the database CAN hold it: the row exists, on
      // ANOTHER company. (A row that does not exist at all is refused by the foreign keys.)
      const p = boardPerson("applied");
      const farCandidate = candidate({ org_id: OTHER });
      const farRole = roleRow({ org_id: OTHER });
      const farDoc = { id: "far-doc", org_id: OTHER, kind: "client_upload" };
      const farApp = application(candidate({ org_id: OTHER }), roleRow({ org_id: OTHER }), "applied", { org_id: OTHER });
      return {
        "the card's candidate is not in this company": T(R("hiring_roles", p.r), R("candidates", farCandidate), R("candidate_applications", { ...p.a, candidate_id: farCandidate.id })),
        "the card's role is not in this company": T(R("candidates", p.c), R("hiring_roles", farRole), R("candidate_applications", { ...p.a, role_id: farRole.id })),
        "the video tag is not a web address": T(...p.rows.slice(0, 2), R("candidate_applications", { ...p.a, video_url: "javascript:void(0)" })),
        "the resume tag points at a document that is not in this company": T(...p.rows.slice(0, 2), R("documents", farDoc), R("candidate_applications", { ...p.a, resume_document_id: "far-doc" })),
        "a score's flags are not a list": T(...p.rows, R("application_scores", score(p.a, { flags: { raised: true } }))),
        // an application of another company that has a score row filed under THIS company
        "a score belongs to an application of another company": T(R("candidate_applications", farApp), R("application_scores", score(farApp, { org_id: ORG }))),
      };
    })(),
  };

  const ok = (key) => boardPerson(key);
  // Demo Mode's seeded people sit in stages with no decision behind them and are labelled demo on the board.
  const demoPerson = (stageKey) => {
    const d = boardPerson(stageKey);
    d.rows = d.rows.map(([table, row]) => (table === "candidates" ? [table, { ...row, is_demo: true }] : [table, row]));
    return d;
  };
  const farPeople = () => {
    const c = candidate({ org_id: OTHER });
    const rl = roleRow({ org_id: OTHER });
    return { c, rl };
  };

  // The decision of ANOTHER application in the same company, and a decision filed under ANOTHER company:
  // neither is this application's own history, so neither may be read as it.
  const othersMove = (stageKey) => {
    const o = boardPerson(stageKey);
    return o.rows;
  };
  FIX["hiring-col-applied"] = {
    // Good: a fresh applicant (no decision, in Applied); a person moved on, then BACK to Applied by the API;
    // a person well on their way (decision behind them, in Group); two demo people in stages with no decision;
    // and an applicant in Applied whose only "decision" is filed under another company.
    good: (() => {
      const back = boardPerson("applied");
      const gone = [R("hiring_decisions", decision(back.a, "screening", { created_at: "2026-10-12T10:00:00.000Z", from_stage_key: "applied" })),
        R("hiring_decisions", decision(back.a, "applied", { created_at: "2026-10-13T10:00:00.000Z", from_stage_key: "screening" }))];
      const alien = boardPerson("applied");
      // Somebody ELSE in this company moved on AFTER this person's own last decision: the latest decision of the
      // company must not be read as this person's.
      const later = boardPerson("group_interview");
      return T(...STAGES, ...ok("applied").rows, ...back.rows, ...gone, ...ok("group_interview").rows, ...demoPerson("group_interview").rows,
        ...demoPerson("one_on_one").rows, ...alien.rows,
        R("hiring_decisions", decision(alien.a, "screening", { org_id: OTHER })),
        ...later.rows.filter(([t]) => t !== "hiring_decisions"),
        R("hiring_decisions", decision(later.a, "group_interview", { created_at: "2026-10-14T10:00:00.000Z" })));
    })(),
    sample: 3, // the fresh one, the one moved back, and the one with only an alien decision; the Group people have a decision; demo people are left out
    violations: (() => {
      const p = boardPerson("applied");
      const q = boardPerson("applied");
      const far = farPeople();
      return {
        "the card's candidate is not in this company": T(R("hiring_roles", p.r), R("candidates", far.c), R("candidate_applications", { ...p.a, candidate_id: far.c.id })),
        "the card's role is not in this company": T(R("candidates", p.c), R("hiring_roles", far.rl), R("candidate_applications", { ...p.a, role_id: far.rl.id })),
        "its latest decision moved it on but it still sits in Applied": T(...q.rows, R("hiring_decisions", decision(q.a, "group_interview"))),
        "it entered the stage before it was filed": (() => { const z = boardPerson("applied"); z.a.entered_stage_at = LONG_AGO; return T(...z.rows); })(),
        // A new applicant that landed in Group with no decision at all: the regression this column most needs to
        // see. Another person in the same company HAS a decision, which must not hide it.
        "it has never been moved by any decision but sits outside Applied": (() => {
          const z = boardPerson("applied");
          z.a.stage_id = "stage-group_interview";
          // two other people with decisions, so that reading "another application's decision" as this one's
          // changes how many are red, not just which one
          return T(...z.rows, ...othersMove("group_interview"), ...othersMove("group_interview"));
        })(),
      };
    })(),
    extra: {
      "it has never been moved by any decision but sits outside Applied": [
        (() => { const z = boardPerson("applied"); z.a.stage_id = "stage-one_on_one"; return T(...z.rows); })(),
        (() => { const z = boardPerson("applied"); z.a.stage_id = "stage-offer"; return T(...z.rows); })(),
        // Its only decision is filed under ANOTHER company: nobody in this company moved it.
        (() => {
          const z = boardPerson("applied");
          z.a.stage_id = "stage-group_interview";
          return T(...z.rows, R("hiring_decisions", decision(z.a, "group_interview", { org_id: OTHER })));
        })(),
      ],
      // The latest decision decides: moved on, moved back, moved on again is red.
      "its latest decision moved it on but it still sits in Applied": [
        (() => {
          const z = boardPerson("applied");
          return T(...z.rows,
            R("hiring_decisions", decision(z.a, "screening", { created_at: "2026-10-11T10:00:00.000Z" })),
            R("hiring_decisions", decision(z.a, "applied", { created_at: "2026-10-12T10:00:00.000Z", from_stage_key: "screening" })),
            R("hiring_decisions", decision(z.a, "group_interview", { created_at: "2026-10-13T10:00:00.000Z", from_stage_key: "applied" })));
        })(),
      ],
    },
  };

  FIX["hiring-col-group"] = {
    // Good also holds a person who passed the group interview with a "yes" and was moved on to the 1:1: that
    // "yes" is somebody else's and must not be read as the Group person's.
    good: (() => {
      const passed = boardPerson("one_on_one");
      return T(...STAGES, ...ok("group_interview").rows, ...ok("applied").rows, ...demoPerson("group_interview").rows,
        ...passed.rows, R("hiring_interview_attendees", { id: nid("att"), org_id: ORG, interview_id: "int-0", application_id: passed.a.id, outcome: "yes" }));
    })(),
    sample: 1,
    violations: (() => {
      const p = boardPerson("group_interview");
      const far = farPeople();
      return {
        "the card's candidate is not in this company": T(R("hiring_roles", p.r), R("candidates", far.c), R("candidate_applications", { ...p.a, candidate_id: far.c.id }), R("hiring_decisions", decision(p.a, "group_interview"))),
        "the card's role is not in this company": T(R("candidates", p.c), R("hiring_roles", far.rl), R("candidate_applications", { ...p.a, role_id: far.rl.id }), R("hiring_decisions", decision(p.a, "group_interview"))),
        "no decision moved it into Group Interview": T(...p.rows.filter(([t]) => t !== "hiring_decisions"), ...othersMove("group_interview")),
        "a group interview said yes or maybe but it never moved on": (() => {
          const z = boardPerson("group_interview");
          return T(...z.rows, R("hiring_interview_attendees", { id: nid("att"), org_id: ORG, interview_id: "int-1", application_id: z.a.id, outcome: "maybe" }));
        })(),
      };
    })(),
  };

  FIX["hiring-col-one-on-one"] = {
    good: T(...STAGES, ...ok("one_on_one").rows, ...ok("group_interview").rows, ...demoPerson("one_on_one").rows),
    sample: 1,
    violations: (() => {
      const p = boardPerson("one_on_one");
      const far = farPeople();
      return {
        "the card's candidate is not in this company": T(R("hiring_roles", p.r), R("candidates", far.c), R("candidate_applications", { ...p.a, candidate_id: far.c.id }), R("hiring_decisions", decision(p.a, "one_on_one"))),
        "the card's role is not in this company": T(R("candidates", p.c), R("hiring_roles", far.rl), R("candidate_applications", { ...p.a, role_id: far.rl.id }), R("hiring_decisions", decision(p.a, "one_on_one"))),
        "no decision moved it into 1:1 Interview": T(...p.rows.filter(([t]) => t !== "hiring_decisions"), ...othersMove("one_on_one")),
      };
    })(),
  };
}

// The board columns join the stage names, so every column fixture carries them.
for (const key of ["hiring-col-applied", "hiring-col-group", "hiring-col-one-on-one"]) {
  for (const [name, rows] of Object.entries(FIX[key].violations)) FIX[key].violations[name] = [...STAGES, ...rows];
  for (const [name, variants] of Object.entries(FIX[key].extra || {})) FIX[key].extra[name] = variants.map((rows) => [...STAGES, ...rows]);
}

/* ── the harness ───────────────────────────────────────────────────────────── */

// The bench view is a view, not a table in db/schema, so the stand-in gets a plain table with its columns.
const VIEW_COLUMNS = {
  v_hiring_bench: ["org_id", "role_id", "role_key", "role_name", "bench_target", "hiring_manager_staff_id", "open_applications", "bench_count", "bench_shortfall"],
};

function standIn(spec, rows) {
  const sql = sqlFor(spec);
  const schema = schemaColumns();
  const needed = new Set([...tablesIn(sql), ...rows.map(([table]) => table)]);
  const real = [...needed].filter((name) => schema.has(name));
  const views = [...needed].filter((name) => VIEW_COLUMNS[name]);
  assert.deepEqual([...needed].filter((name) => !schema.has(name) && !VIEW_COLUMNS[name]), [], `${spec.key}: every table in the text is a real one`);
  const s = makeStandIn(real);
  for (const view of views) {
    s.db.exec(`CREATE TABLE ${view} (${VIEW_COLUMNS[view].map((c) => `"${c}"`).join(", ")})`);
  }
  const insert = s.insert.bind(s);
  s.insert = (table, row) => {
    if (VIEW_COLUMNS[table]) {
      const keys = Object.keys(row);
      for (const k of keys) assert.ok(VIEW_COLUMNS[table].includes(k), `${table} has no column ${k}`);
      const values = keys.map((k) => (row[k] === undefined ? null : row[k]));
      s.db.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...values);
    } else insert(table, row);
  };
  for (const [table, row] of rows) s.insert(table, row);
  return s;
}

function runOn(spec, rows, { without = [], org = ORG } = {}) {
  const s = standIn(spec, rows);
  try {
    return s.run(sqlFor(spec, { without }), org);
  } finally {
    s.close();
  }
}

const SPEC = new Map(FIN_B12_CHECKS.map((spec) => [spec.key, spec]));

test("every batch 12 control owns exactly one live check, and the registry holds the same text", () => {
  const controls = Object.values(FIN_B12_CONTROLS);
  assert.equal(controls.length, 17);
  assert.equal(FIN_B12_CHECKS.length, 17);
  assert.deepEqual(new Set(FIN_B12_CHECKS.map((c) => c.control)), new Set(controls));
  assert.equal(new Set(FIN_B12_CHECKS.map((c) => c.key)).size, 17);
  assert.equal(FIN_B12_DISPLAY_CONTRACTS.length, 17);
  for (const spec of FIN_B12_CHECKS) {
    const contract = FIN_B12_DISPLAY_CONTRACTS.find((entry) => entry.control === spec.control);
    assert.ok(contract, spec.key);
    assert.equal(contract.sql, sqlFor(spec), `${spec.key}: the registry holds the exact text`);
    assert.equal(contract.mode, "query");
    assert.equal(contract.anyImpact, true);
    assert.equal(contract.emptyAs, "quiet");
    assert.match(contract.sql, /\/\* display-result:[^*]+ \*\//);
    assert.match(contract.sql, /sample_count/);
    assert.match(contract.sql, /bad_count/);
    assert.ok(contract.requirement.length > 40, `${spec.key}: the requirement is in plain words`);
  }
});

test("every check text is read-only, takes only the company, and names real tables and columns", () => {
  const schema = schemaColumns();
  for (const spec of FIN_B12_CHECKS) {
    const sql = sqlFor(spec);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|create|truncate|grant|set\s)\b/i, `${spec.key}: read only`);
    assert.match(sql, /\$1::uuid/, `${spec.key}: takes the company`);
    assert.doesNotMatch(sql, /\$2/, `${spec.key}: nothing but the company is bound`);
    for (const table of tablesIn(sql)) {
      assert.ok(schema.has(table) || VIEW_COLUMNS[table], `${spec.key}: ${table} is a real table`);
    }
    // Every alias.column the text reads is a real column of the table that alias names.
    const aliases = new Map();
    for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s+(?:as\s+)?([a-z][a-z0-9]*)\b/gi)) {
      if (!["where", "join", "on", "left", "inner", "select"].includes(m[2].toLowerCase())) aliases.set(m[2], m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/\b([a-z][a-z0-9]*)\.([a-z_][a-z0-9_]*)\b/g)) {
      if (m[1] === "r" && m[2] === "bad") continue; // the outer count over the stacked selects
      const table = aliases.get(m[1]);
      if (!table) continue;
      const cols = schema.get(table) || new Set(VIEW_COLUMNS[table] || []);
      assert.ok(cols.has(m[2]), `${spec.key}: ${table} (${m[1]}) has no column ${m[2]}`);
    }
  }
});

for (const [key, fix] of Object.entries(FIX)) {
  test(`${key}: good rows are green and each bad condition goes red on its own row`, () => {
    const spec = SPEC.get(key);
    assert.ok(spec, `no check named ${key}`);

    const good = runOn(spec, fix.good);
    assert.equal(good.bad_count, 0, `${key}: good rows are not flagged`);
    assert.equal(good.sample_count, fix.sample, `${key}: reads the right rows`);

    // every named condition has a fixture, and every fixture names a real condition
    const named = new Set(spec.parts.flatMap((part) => part.bad.map(([name]) => name)));
    const covered = new Set([...Object.keys(fix.violations), ...Object.keys(fix.extra || {})]);
    assert.deepEqual([...named].filter((n) => !covered.has(n)).sort(), [], `${key}: a condition has no failing fixture`);
    assert.deepEqual([...covered].filter((n) => !named.has(n)).sort(), [], `${key}: a fixture names no condition`);

    for (const [name, rows] of Object.entries(fix.violations)) {
      const bad = runOn(spec, rows);
      assert.equal(bad.bad_count, 1, `${key}: "${name}" goes red on its row`);
      // The condition is load-bearing: leave only it out and the same row is not caught.
      const without = runOn(spec, rows, { without: [name] });
      assert.equal(without.bad_count, 0, `${key}: without "${name}" the same row is not caught`);
      // Another company's wrong row is never read.
      const far = runOn(spec, rows.map(([table, row]) => [table,
        table === "orgs" ? { ...row, id: OTHER } : (row.org_id === ORG ? { ...row, org_id: OTHER } : row)]));
      assert.equal(far.bad_count, 0, `${key}: "${name}" in another company is not read`);
    }
    for (const [name, variants] of Object.entries(fix.extra || {})) {
      for (const rows of variants) {
        const bad = runOn(spec, rows);
        assert.ok(bad.bad_count >= 1, `${key}: "${name}" goes red`);
        const without = runOn(spec, rows, { without: [name] });
        assert.equal(without.bad_count, 0, `${key}: without "${name}" it is not caught`);
      }
    }
  });
}

test("fos-page-load goes green once Demo Mode has its primary demo client", () => {
  const spec = SPEC.get("fos-page-load");
  const on = runOn(spec, FIX["fos-page-load"].goodWhenDemoOn);
  assert.deepEqual(on, { sample_count: 1, bad_count: 0 });
  const off = runOn(spec, FIX["fos-page-load"].good);
  assert.deepEqual(off, { sample_count: 0, bad_count: 0 }, "demo off: nothing to judge, so it is quiet");
});

test("fos-picker: the whole-book count reads only THIS company's clients that the picker can list", () => {
  const spec = SPEC.get("fos-picker");
  const many = (n, o = {}) => Array.from({ length: n }, () => R("clients", client(o)));
  const green = { sample_count: 1, bad_count: 0 };
  // Another company's 600 clients are not this company's book.
  assert.deepEqual(runOn(spec, [R("orgs", org()), R("orgs", org({ id: OTHER, slug: "other" })), ...many(3), ...many(600, { org_id: OTHER })]), green,
    "600 clients of another company do not make this book too big");
  // Demo clients are not in the picker while Demo Mode is off, so they are not counted against the 500.
  assert.deepEqual(runOn(spec, [R("orgs", org()), ...many(100), ...many(450, { is_demo: true })]), green,
    "450 demo clients are not listed, so they do not fill the picker");
  // With Demo Mode on they ARE listed, and 550 will not fit in 500.
  assert.deepEqual(runOn(spec, [R("orgs", org({ demo_mode_enabled: true })), ...many(100), ...many(450, { is_demo: true })]), { sample_count: 1, bad_count: 1 },
    "with Demo Mode on, 550 listed clients are more than the picker can hold");
  // Exactly 500 fits; 501 does not.
  assert.deepEqual(runOn(spec, [R("orgs", org()), ...many(500)]), green);
  assert.deepEqual(runOn(spec, [R("orgs", org()), ...many(501)]), { sample_count: 1, bad_count: 1 });
});

test("galaxy-page-load: somebody to show is an active real person of this company or a live or shadow agent that is not retired", () => {
  const spec = SPEC.get("galaxy-page-load");
  const bad = (rows) => runOn(spec, [R("orgs", org()), ...rows]).bad_count;
  const demoBad = (rows) => runOn(spec, [R("orgs", org({ demo_mode_enabled: true })), ...rows]).bad_count;
  // An agent alone is enough, and so is a person alone.
  assert.equal(bad([R("agents", agent({ status: "live" }))]), 0, "a live agent alone");
  assert.equal(bad([R("agents", agent({ status: "shadow", went_live_at: null }))]), 0, "a shadow agent alone");
  assert.equal(bad([R("staff", staff())]), 0, "an active person alone");
  // An agent that is not live or shadow, or that is retired, is nobody to show.
  assert.equal(bad([R("agents", agent({ status: "draft", went_live_at: null }))]), 1, "a draft agent alone");
  assert.equal(bad([R("agents", agent({ status: "live", retired_at: OLD }))]), 1, "a retired agent alone");
  // A person that is not active, not staff-of-the-sky, not real, not on this company, or has no role is nobody.
  assert.equal(bad([R("staff", staff({ status: "suspended" }))]), 1, "a suspended person alone");
  assert.equal(bad([R("staff", staff({ role: "client" }))]), 1, "a client login is not on the team");
  assert.equal(bad([R("staff", staff({ role: null }))]), 1, "a person with no role");
  assert.equal(bad([R("staff", staff({ org_id: OTHER }))]), 1, "a person of another company");
  assert.equal(bad([R("staff", staff({ is_demo: true }))]), 1, "a seeded demo person is not real while Demo Mode is off");
  assert.equal(demoBad([R("staff", staff({ is_demo: true }))]), 0, "a seeded demo person counts while Demo Mode is on");
  assert.equal(demoBad([]), 1, "Demo Mode on with nobody at all is still nobody");
});

test("a check with no saved results at all reads 0 and 0, which the lane shows as quiet green", () => {
  for (const spec of FIN_B12_CHECKS) {
    // The picker's one read is a count of the whole book, so an empty book is one result that is not wrong.
    const want = spec.key === "fos-picker" ? { sample_count: 1, bad_count: 0 } : { sample_count: 0, bad_count: 0 };
    assert.deepEqual(runOn(spec, []), want, spec.key);
  }
});

/* ── demo partners are not read (2026-10-20, records and staff lane) ── */

test("cf-tiles and cf-script: a demo partner's broken row is not read; the same row on a real partner is red", () => {
  const demo = { id: "p-demo", org_id: ORG, slug: "demo-partner", name: "Demo", is_demo: true };
  const real = { id: "p-real", org_id: ORG, slug: "house", name: "House", is_demo: false };
  const tiles = SPEC.get("cf-tiles");
  const badJob = (partner) => job({ partner_id: partner.id, status: "failed", error: "   " });
  assert.equal(runOn(tiles, T(R("partners", demo), R("generation_jobs", badJob(demo)))).bad_count, 0);
  assert.equal(runOn(tiles, T(R("partners", real), R("generation_jobs", badJob(real)))).bad_count, 1);
  const scripts = SPEC.get("cf-script");
  const badScript = (partner) => script({ partner_id: partner.id, angle_key: "brand_new_angle" });
  assert.equal(runOn(scripts, T(...LABELS.map((l) => R("ad_labels", l)), R("partners", demo), R("ad_scripts", badScript(demo)))).bad_count, 0);
  assert.equal(runOn(scripts, T(...LABELS.map((l) => R("ad_labels", l)), R("partners", real), R("ad_scripts", badScript(real)))).bad_count, 1);
});
