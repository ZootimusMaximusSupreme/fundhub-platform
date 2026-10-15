// Finish-853 batch 16: the live checks for Save the plan, the plan rows, Build the avatar and "Send this one to",
// run over stand-in rows. The same method as fin-b16-live-contracts.test.mjs (which holds the quiet hours and the
// schedule fields): the exact SQL text each contract carries is run over stand-in rows with the real column names;
// for every named bad-result condition a row that breaks only it is counted, the text without that condition does
// not count it, and clean rows, another company's rows, demo rows and rows outside the window are never counted.
// No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import {
  shootCreateSql, shootOrderSql, avatarSql, sendToSql,
  SHOOT_CREATE_BAD, SHOOT_ORDER_BAD, AVATAR_BAD, SEND_TO_BAD,
} from "./fin-b16-display-contracts.mjs";
import { ORG, OTHER_ORG, at, id, counts, seedRows, conditionTest } from "./fin-b16-live-harness.mjs";

// ───────────────────────── Save the plan, and the plan rows ─────────────────────────

const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const R3 = "10000000-0000-4000-8000-000000000003";
const R9 = "10000000-0000-4000-8000-000000000009";
function shoot(over = {}) {
  return ["marketing_shoots", { id: id("shoot"), org_id: ORG, shoot_date: "2026-10-15", root_script_ids: [R1, R2], status: "planned", created_at: at(-1), ...over }];
}
function planned(root, over = {}) {
  return ["ad_scripts", { id: id("ver"), org_id: ORG, partner_id: "p1", body: "words", root_script_id: root, status: "locked", film_order: 1, archived_at: null, ...over }];
}
const SHOOT_TABLES = ["marketing_shoots", "ad_scripts"];
const shootClean = () => [
  shoot(),                                                                  // the one open shoot
  planned(R1, { film_order: 1 }), planned(R2, { film_order: 2 }),
  planned(R1, { film_order: 1, archived_at: at(-2) }),                       // an older version
  shoot({ id: "s-done", status: "done", root_script_ids: [R3], finished_at: at(-8) }),
  planned(R3, { film_order: null }),                                         // a closed shoot is never judged on film order
  ["marketing_shoots", { id: id("shoot"), org_id: OTHER_ORG, root_script_ids: [], status: "planned" }],
];

conditionTest({
  title: "Save the plan",
  tables: SHOOT_TABLES,
  sqlOf: shootCreateSql,
  names: SHOOT_CREATE_BAD.map(([n]) => n),
  clean: shootClean,
  bads: {
    "a shoot plan names no script": [[shoot({ status: "done", root_script_ids: [], finished_at: at(-4) })]],
    "a second shoot is open for the same company": [[shoot({ root_script_ids: [R1] })]],
    "a shoot plan names a script that is not on file for this company": [
      [shoot({ status: "done", root_script_ids: [R9], finished_at: at(-4) })],
      // on file, but for another company
      [shoot({ status: "done", root_script_ids: [R9], finished_at: at(-4) }), ["ad_scripts", { id: id("ver"), org_id: OTHER_ORG, partner_id: "p1", body: "w", root_script_id: R9 }]],
    ],
  },
});

conditionTest({
  title: "plan rows",
  tables: SHOOT_TABLES,
  sqlOf: shootOrderSql,
  names: SHOOT_ORDER_BAD.map(([n]) => n),
  clean: shootClean,
  bads: {
    "a shoot plan names one script twice": [[shoot({ status: "done", root_script_ids: [R1, R2, R1], finished_at: at(-4) })]],
    "a shoot plan holds more scripts than a shoot may (100)": [[shoot({
      status: "done", finished_at: at(-4),
      root_script_ids: Array.from({ length: 101 }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    })]],
    "a script on an open shoot plan has no film order": [
      [shoot({ root_script_ids: [R9] }), planned(R9, { film_order: null })],
    ],
  },
});

test("plan rows: exactly 100 scripts is allowed, and a script version that was archived is not asked for a film order", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const got = counts(SHOOT_TABLES, seedRows([shoot({ status: "done", root_script_ids: ids, finished_at: at(-4) }), planned(R1, { film_order: null, archived_at: at(-1) })]), shootOrderSql());
  assert.deepEqual(got, { sample_count: 1, bad_count: 0 });
  const open = counts(SHOOT_TABLES, seedRows([shoot({ root_script_ids: [R1] }), planned(R1, { film_order: null, archived_at: at(-1) }), planned(R1, { film_order: 1 })]), shootOrderSql());
  assert.deepEqual(open, { sample_count: 1, bad_count: 0 });
});

// ───────────────────────── Build the avatar ─────────────────────────

function job(over = {}) {
  return ["marketing_jobs", {
    id: id("job"), org_id: ORG, kind: "avatar", status: "done",
    payload: { campaign: "partner", step: "done", run_cap_usd: 20, progress: {} },
    result: { campaign: "partner", files: ["marketing/flywheel/partner/01-avatar.md"] }, created_at: at(-5), ...over,
  }];
}
function usage(jobId, cost, over = {}) {
  return ["marketing_model_usage", { id: id("use"), org_id: ORG, job_id: jobId, model: "claude-opus-5-5", cost_usd: cost, ...over }];
}
const AVATAR_TABLES = ["marketing_jobs", "marketing_model_usage"];
const avatarClean = () => [
  job({ id: "j-done" }), usage("j-done", 12.5), usage("j-done", 7.5),         // exactly at the stop amount
  job({ id: "j-running", status: "running", result: null, payload: { campaign: "partner", step: "quotes", run_cap_usd: 20 } }), usage("j-running", 1),
  job({ id: "j-stop", status: "failed", result: null, error: "The run stopped at $20.",
    payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: { stopped_at_cap: { cap: "run", sentence: "Stopped at the $20 run cap after step 3." } } } }),
  job({ id: "j-offer", kind: "offer", status: "done", payload: { campaign: "partner", run_cap_usd: 1 } }), usage("j-offer", 99),
  job({ id: "j-other", org_id: OTHER_ORG, payload: { campaign: "partner", step: "quotes", run_cap_usd: 1 } }),
  ["marketing_model_usage", { id: id("use"), org_id: OTHER_ORG, job_id: "j-done", model: "x", cost_usd: 500 }],
];

conditionTest({
  title: "Build the avatar",
  tables: AVATAR_TABLES,
  sqlOf: avatarSql,
  names: AVATAR_BAD.map(([n]) => n),
  clean: avatarClean,
  bads: {
    "a run spent more than the stop amount saved on it": [
      [job({ id: "j-over" }), usage("j-over", 15), usage("j-over", 5.01)],
    ],
    "a finished run is not on its last step": [
      [job({ payload: { campaign: "partner", step: "quotes", run_cap_usd: 20 } })],
    ],
    "a finished run lists no saved files": [
      [job({ result: { campaign: "partner", files: [] } })],
      [job({ result: { campaign: "partner" } })],
    ],
    "a run that stopped at the cap does not say why": [
      [job({ status: "failed", result: null, error: "stopped",
        payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: { stopped_at_cap: { cap: "run", sentence: "  " } } } })],
    ],
  },
});

test("Build the avatar: a run with no price on a call is never counted as free money, and no saved stop amount is not judged", () => {
  const rows = [job({ id: "j-np", payload: { campaign: "partner", step: "done" } }), usage("j-np", 400), job({ id: "j-null" }), usage("j-null", null), usage("j-null", 3)];
  assert.deepEqual(counts(AVATAR_TABLES, seedRows(rows), avatarSql()), { sample_count: 2, bad_count: 0 });
});

// ───────────────────────── Send this one to ─────────────────────────

const CLIENT = ["clients", { id: "c1", org_id: ORG, first_name: "Dana", email: "dana@example.com", phone: "+15550100001", updated_at: at(-20), is_demo: false }];
function message(over = {}) {
  return ["messages", {
    id: id("msg"), org_id: ORG, client_id: "c1", direction: "outbound", channel: "email", sender_kind: "staff",
    rendered_body: "Hello", to_address: "dana.other@example.com", created_at: at(-3), is_demo: false, ...over,
  }];
}
const SEND_TABLES = ["messages", "clients"];
const sendClean = () => [
  CLIENT,
  message(),                                                                  // a typed email, well shaped
  message({ channel: "sms", to_address: "+15550109999" }),                    // a typed number, well shaped
  message({ to_address: "dana@example.com" }),                                // the address on file: not a typed one
  message({ channel: "sms", to_address: "+15550100001" }),                    // the number on file
  ["clients", { id: "c2", org_id: ORG, first_name: "Omar", email: "omar-at-home", phone: "555-0100", updated_at: at(-20), is_demo: false }],
  message({ client_id: "c2", channel: "sms", to_address: "555-0100" }),        // the record itself holds an old-style number
  message({ client_id: "c2", channel: "email", to_address: "omar-at-home" }),
  message({ to_address: "not-an-email", created_at: at(-40) }),               // made before the record last changed
  message({ to_address: null }),                                              // no address at all
  message({ to_address: "bad", is_demo: true }),
  message({ to_address: "bad", direction: "inbound" }),
  message({ to_address: "bad", sender_kind: "system" }),
  message({ to_address: "bad", org_id: OTHER_ORG }),
  message({ to_address: "bad", created_at: at(-120) }),
];

conditionTest({
  title: "Send this one to",
  tables: SEND_TABLES,
  sqlOf: sendToSql,
  names: SEND_TO_BAD.map(([n]) => n),
  clean: sendClean,
  bads: {
    "a typed email destination is not an email address": [
      [message({ to_address: "dana@@example" })],
      [message({ to_address: "dana example.com" })],
    ],
    "a typed text destination is not a full international number": [
      [message({ channel: "sms", to_address: "555-0100" })],
      [message({ channel: "sms", to_address: "+0123456789" })],
      [message({ channel: "sms", to_address: "5550109999" })],
    ],
    "a typed destination was put on a channel nobody can address by hand": [
      [message({ channel: "voice", to_address: "+15550109999" })],
    ],
  },
});
