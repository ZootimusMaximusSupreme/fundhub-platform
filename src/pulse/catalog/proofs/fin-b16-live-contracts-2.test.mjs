// Finish-853 batch 16: the live checks for Save the plan, the plan rows, Build the avatar and "Send this one to",
// run over stand-in rows. The same method as fin-b16-live-contracts.test.mjs (which holds the quiet hours and the
// schedule fields): the exact SQL text each contract carries is run over stand-in rows with the real column names;
// for every named bad-result condition a row that breaks only it is counted, the text without that condition does
// not count it, and clean rows, another company's rows, demo rows and rows outside the window are never counted.
// No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import { HIGHEST_KNOWN_RATE, WEB_SEARCH_USD } from "../../../marketing/model-usage.mjs";
import {
  shootCreateSql, shootOrderSql, avatarSql, sendToSql,
  SHOOT_CREATE_BAD, SHOOT_ORDER_BAD, AVATAR_BAD, SEND_TO_BAD, WORST_RATE,
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
  // exactly at the stop amount; the second call carries its tokens AND its price: it is counted by its price, once
  job({ id: "j-done" }), usage("j-done", 12.5), usage("j-done", 7.5, { input_tokens: 1_000_000, output_tokens: 350_000 }),
  // A call with no price on file counts at the highest known rate: 3,000,000 input tokens at $4 and 400,000
  // output at $20 is exactly $20, the stop amount. One search more would be $20.01.
  job({ id: "j-unpriced-edge" }), usage("j-unpriced-edge", null, { input_tokens: 3_000_000, output_tokens: 400_000 }),
  job({ id: "j-running", status: "running", result: null, payload: { campaign: "partner", step: "quotes", run_cap_usd: 20 } }), usage("j-running", 1),
  job({ id: "j-stop", status: "failed", result: null, error: "The run stopped at $20.",
    payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: { stopped_at_cap: { cap: "run", sentence: "Stopped at the $20 run cap after step 3." } } } }),
  job({ id: "j-offer", kind: "offer", status: "done", payload: { campaign: "partner", run_cap_usd: 1 } }), usage("j-offer", 99),
  job({ id: "j-offer-nocap", kind: "offer", status: "done", payload: { campaign: "partner" } }),   // another kind: its cap is not judged
  job({ id: "j-other", org_id: OTHER_ORG, payload: { campaign: "partner", step: "quotes", run_cap_usd: 1 } }),
  ["marketing_model_usage", { id: id("use"), org_id: OTHER_ORG, job_id: "j-done", model: "x", cost_usd: 500 }],
  ["marketing_model_usage", { id: id("use"), org_id: OTHER_ORG, job_id: "j-unpriced-edge", model: "x", cost_usd: null, input_tokens: 99_000_000 }],
];

conditionTest({
  title: "Build the avatar",
  tables: AVATAR_TABLES,
  sqlOf: avatarSql,
  names: AVATAR_BAD.map(([n]) => n),
  clean: avatarClean,
  bads: {
    "a run has no stop amount saved on it": [
      [job({ id: "j-nocap", payload: { campaign: "partner", step: "done" } })],
      [job({ id: "j-zerocap", payload: { campaign: "partner", step: "done", run_cap_usd: 0 } })],
      [job({ id: "j-blankcap", status: "running", result: null, payload: { campaign: "partner", step: "quotes", run_cap_usd: "" } })],
    ],
    "a run spent more than the stop amount saved on it": [
      [job({ id: "j-over" }), usage("j-over", 15), usage("j-over", 5.01)],
      // unpriced calls, counted at the highest known rate: $12 + $8 + one search at a cent
      [job({ id: "j-unp" }), usage("j-unp", null, { input_tokens: 3_000_000, output_tokens: 400_000, web_search_requests: 1 })],
      [job({ id: "j-unp-cache" }), usage("j-unp-cache", 19), usage("j-unp-cache", null, { cache_read_tokens: 10_000_000 })],   // 19 + $2
      [job({ id: "j-unp-write" }), usage("j-unp-write", 19), usage("j-unp-write", null, { cache_write_tokens: 1_000_000 })], // 19 + $5
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

test("Build the avatar: the rates the check counts an unpriced call at are the product's own highest known rates", () => {
  assert.deepEqual({ input: WORST_RATE.input, output: WORST_RATE.output, cache_read: WORST_RATE.cache_read, cache_write: WORST_RATE.cache_write },
    { input: HIGHEST_KNOWN_RATE.input, output: HIGHEST_KNOWN_RATE.output, cache_read: HIGHEST_KNOWN_RATE.cache_read, cache_write: HIGHEST_KNOWN_RATE.cache_write },
    "src/marketing/model-usage.mjs HIGHEST_KNOWN_RATE moved: update WORST_RATE in fin-b16-display-contracts.mjs");
  assert.equal(WORST_RATE.search, WEB_SEARCH_USD);
});

test("Build the avatar: a priced call is counted as priced, an unpriced one adds on top, and the exact stop amount is not an overspend", () => {
  const priced = [job({ id: "a" }), usage("a", 20)];
  assert.equal(counts(AVATAR_TABLES, seedRows(priced), avatarSql()).bad_count, 0, "exactly $20 of $20");
  const both = [job({ id: "a" }), usage("a", 12), usage("a", null, { input_tokens: 2_000_000 }), usage("a", null, { output_tokens: 1_000 })];
  // 12 + 8 + 0.02 = 20.02: over
  assert.equal(counts(AVATAR_TABLES, seedRows(both), avatarSql()).bad_count, 1);
  const free = [job({ id: "a" }), usage("a", 0), usage("a", 0), usage("a", 0)];
  assert.equal(counts(AVATAR_TABLES, seedRows(free), avatarSql()).bad_count, 0, "a free model ($0) is a real zero");
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
  ["clients", { id: "c3", org_id: OTHER_ORG, first_name: "Other", email: "o@example.com", phone: "+15550100003", updated_at: at(-20), is_demo: false }],
  message({ client_id: "c3", org_id: OTHER_ORG, to_address: "bad" }),    // another company's own client and a bad address
  message({ to_address: "bad", created_at: at(-120) }),
  // older than the 90 days judged, for a client whose record has not changed since: only the window excludes it
  ["clients", { id: "c4", org_id: ORG, first_name: "Old", email: "old@example.com", phone: "+15550100004", updated_at: at(-300), is_demo: false }],
  message({ client_id: "c4", to_address: "bad", created_at: at(-120) }),
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
