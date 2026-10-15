// Batch 24 (finish the 853), staff doors, part 3: "could this agent phone this
// client" (never dials) and the Winner's Board read.
//
// The real api/ handlers, a stand-in database that answers by the conditions the
// SQL text names, and a trapped network. This is a PRACTICE TEST with fake data.
// It is not a live check.

import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";

import agentCall, { CALL_ROLES } from "../../../../api/agent-call.mjs";
import adintelBoard from "../../../../api/adintel/board.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { clearRuleCache } from "../../../compliance/screen.mjs";
import { ANGLES } from "../../../creative-intel/taxonomy.mjs";
import { RANK_BASIS_NOTE, NO_SPEND_NOTE } from "../../../creative-intel/board.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";

/* ── agent-call action=check: asks, and never dials ──────────────────────── */

const AGENT = "AG-04";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const blandKey = ["fake", "phone", "system", "value"].join("-");

const realFetch = globalThis.fetch;
const saved = { key: process.env.BLAND_API_KEY, fence: process.env.MESSAGING_DRY_RUN };
const wire = [];
before(() => {
  globalThis.fetch = async (url) => {
    wire.push(String(url));
    throw new Error("the network is trapped in this test");
  };
  process.env.BLAND_API_KEY = blandKey;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["BLAND_API_KEY", saved.key], ["MESSAGING_DRY_RUN", saved.fence]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
beforeEach(() => { wire.length = 0; delete process.env.MESSAGING_DRY_RUN; process.env.BLAND_API_KEY = blandKey; clearRuleCache(); });

const agentRow = (over = {}) => ({
  code: AGENT, name: "Josh", status: "live", channel: "voice", agent_class: "client_facing",
  runtime: "bland", runtime_ref: null, prompt: "You are Josh. Ask when the client wants to book a call.", ...over,
});
const clientRow = (over = {}) => ({ id: CLIENT, first_name: "Dana", last_name: "Whitfield", phone: "(602) 555-0100", dnd_voice: false, ...over });

function check(body, { role = "closer", staff = {}, agent = agentRow(), agentIn = [ORG_ID], client = clientRow(), optedOut = [], rules = [] } = {}) {
  const clientOrg = client ? (client.org_id || ORG_ID) : null;
  return hit(agentCall, {
    method: "POST", role, staff, body: { action: "check", agent_code: AGENT, ...body },
    rules: [
      // Each lookup is answered by the conditions the SQL text names: a statement that loses its
      // company condition is answered with the row whatever company was bound.
      [/FROM agents WHERE/, (sql, p) => (agent && agent.code === p[1] && (!/WHERE org_id = \$1::uuid/.test(sql) || agentIn.includes(p[0])) ? [agent] : [])],
      [/FROM clients WHERE id = \$1::uuid/, (sql, p) => (client && client.id === p[0] && (!/AND org_id = \$2::uuid/.test(sql) || clientOrg === p[1]) ? [client] : [])],
      [/FROM opt_outs WHERE client_id = \$1 AND channel = \$2 AND opted_in_at IS NULL/, (_s, p) => (p[0] === CLIENT && optedOut.includes(p[1]) ? [{ "?column?": 1 }] : [])],
      [/FROM compliance_rules/, rules],
      [/INSERT INTO outbound_calls/, []],
    ],
  });
}

test("agent-call check says a live phone agent could call this client, and dials nothing and records nothing", async () => {
  assert.equal(ROUTES["agent-call"], agentCall);
  const ready = await check({ client_id: CLIENT });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ok, true);
  assert.equal(ready.body.placed, false);
  assert.equal(ready.body.ready, true);
  assert.equal(ready.body.reason, "ready");
  assert.match(ready.body.message, /Josh is ready to call Dana Whitfield\. Nothing has been dialled\./);
  assert.deepEqual(ready.body.agent, { code: AGENT, name: "Josh", status: "live", runtime: "bland" });
  assert.deepEqual(wire, [], "no call and no outbound request");
  assert.equal(sqlCalls(ready, /INSERT INTO outbound_calls/).length, 0);
  assert.equal(ready.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, "a check writes nothing");
  assert.deepEqual(sqlCalls(ready, /FROM agents/)[0].params, [ORG_ID, AGENT]);
  assert.deepEqual(sqlCalls(ready, /FROM clients/)[0].params, [CLIENT, ORG_ID]);

  // With no client named it says only that the agent itself is ready.
  const agentOnly = await check({});
  assert.equal(agentOnly.status, 200);
  assert.equal(agentOnly.body.reason, "agent_ready");
  assert.equal(agentOnly.body.placed, false);
  assert.equal(sqlCalls(agentOnly, /FROM clients/).length, 0);
  // The agent code is normalised, and an action left out means check, not call.
  const lower = await hit(agentCall, {
    method: "POST", body: { agent_code: " ag-04 ", client_id: CLIENT },
    rules: [
      [/FROM agents WHERE org_id/, [agentRow()]],
      [/FROM clients WHERE id/, [clientRow()]],
      [/FROM opt_outs/, []],
      [/FROM compliance_rules/, []],
    ],
  });
  assert.equal(lower.body.placed, false);
  assert.equal(lower.body.reason, "ready");
  assert.deepEqual(sqlCalls(lower, /FROM agents/)[0].params, [ORG_ID, "AG-04"]);
  assert.deepEqual(wire, []);
});

test("agent-call check stops by its own reason: unknown agent, internal agent, not live, no script, no client, no number, do-not-call, voice opt-out, restricted words, no phone key", async () => {
  const restricted = [{
    rule_set: "croa", rule_key: "no-guaranteed-approval", offer_types: [], platforms: [], match_type: "phrase",
    pattern: "guaranteed approval", severity: "block", message: "Guaranteed approval can never be promised.", citation: null,
  }];
  const cases = [
    [{ agent: null }, 404, "not_found"],
    [{ agent: agentRow({ agent_class: "internal" }) }, 409, "not_client_facing"],
    [{ agent: agentRow({ status: "shadow" }) }, 409, "not_live"],
    [{ agent: agentRow({ runtime: "internal" }) }, 409, "not_a_voice_runtime"],
    [{ agent: agentRow({ prompt: "  " }) }, 409, "no_prompt"],
    [{ client: null }, 404, "client_not_found"],
    [{ client: clientRow({ phone: "" }) }, 409, "no_phone"],
    [{ client: clientRow({ dnd_voice: true }) }, 409, "dnd_voice"],
    [{ optedOut: ["voice"] }, 409, "opted_out"],
    [{ agent: agentRow({ prompt: "Tell the client they have guaranteed approval." }), rules: restricted }, 409, "gate_blocked"],
  ];
  for (const [options, status, reason] of cases) {
    const out = await check({ client_id: CLIENT }, options);
    assert.equal(out.status, status, reason);
    assert.equal(out.body.ok, false, reason);
    assert.equal(out.body.placed, false, reason);
    assert.equal(out.body.reason, reason);
  }
  // A text opt-out is not a voice opt-out.
  const textOnly = await check({ client_id: CLIENT }, { optedOut: ["sms", "email"] });
  assert.equal(textOnly.status, 200);
  assert.equal(textOnly.body.reason, "ready");

  // A missing phone key is asked LAST, so a do-not-call person is never told "not set up".
  delete process.env.BLAND_API_KEY;
  const noKey = await check({ client_id: CLIENT });
  assert.equal(noKey.status, 503);
  assert.equal(noKey.body.reason, "not_configured");
  const dnc = await check({ client_id: CLIENT }, { client: clientRow({ dnd_voice: true }) });
  assert.equal(dnc.body.reason, "dnd_voice");
  assert.deepEqual(wire, []);
});

test("agent-call check is for the six contact desks only, and another company's staff reach neither its agent nor its client", async () => {
  // Written out by hand, so a role slipped into the gate turns this red.
  const admitted = ["admin", "closer", "inquiry_specialist", "owner", "sales_manager", "setter"];
  const refused = ["csm", "funding_advisor"];
  assert.deepEqual([...CALL_ROLES].sort(), admitted);
  for (const role of admitted) {
    const out = await check({ client_id: CLIENT }, { role });
    assert.equal(out.status, 200, role);
  }
  for (const role of refused) {
    const out = await check({ client_id: CLIENT }, { role });
    assert.equal(out.status, 403, role);
    assert.equal(sqlCalls(out, /FROM agents/).length, 0, `${role} is refused before any lookup`);
  }
  const noAgent = await check({ client_id: CLIENT }, { staff: { org_id: OTHER_ORG_ID } });
  assert.equal(noAgent.status, 404);
  assert.equal(noAgent.body.reason, "not_found");
  assert.deepEqual(sqlCalls(noAgent, /FROM agents/)[0].params, [OTHER_ORG_ID, AGENT]);
  const noClient = await check({ client_id: CLIENT }, { staff: { org_id: OTHER_ORG_ID }, agentIn: [ORG_ID, OTHER_ORG_ID] });
  assert.equal(noClient.status, 404);
  assert.equal(noClient.body.reason, "client_not_found");
  assert.deepEqual(sqlCalls(noClient, /FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);

  const noCode = await check({ agent_code: "" });
  assert.equal(noCode.status, 400);
  assert.equal(noCode.body.reason, "code_required");
  const bad = await check({ action: "launch" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.reason, "unknown_action");
  const get = await hit(agentCall, { method: "GET" });
  assert.equal(get.status, 405);
  assert.deepEqual(wire, []);
});

/* ── adintel/board: the Winner's Board ───────────────────────────────────── */

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const WEEK = "2026-W41";

const feedRow = (over = {}) => ({
  org_id: ORG_ID, iso_week: WEEK, content_hash: "h1", platform: "meta", advertiser_id: "adv-1", headline: "Get funded fast",
  destination_domain: "example.test", media_kind: "video", angle: ANGLES[0], ad_format: "video", promise_shape: "speed",
  compliance_risk: "clean", funnel: "vsl", hook_line: "In 24 hours", screen_state: "passed", ad_age_days: 40,
  variant_count: 3, relaunch_count: 1, creative_velocity: 2, placement_spread: 3, landing_page_changed: false,
  offer_price_cents: null, offer_term: null, new_entrant: false, death_watch: false, cross_platform_echo: false,
  tiktok_perf_bucket: null, winner_score_rank: 1, winner_score_band: "hot", rank_delta: 2, watch_group: "direct",
  // columns that exist in the tables and must never reach a partner:
  winner_score: 0.9123, weights_version: "w3", cost_cents: 41, input_tokens: 10, output_tokens: 20, raw: { vendor: "payload" }, vendor: "apify", vendor_run_id: "run-9",
  ...over,
});

function boardRules({ weeks = [
  { iso_week: WEEK, creatives: 3, computed_at: "2026-10-12T05:00:00.000Z" },
  { iso_week: "2026-W40", creatives: 2, computed_at: "2026-10-05T05:00:00.000Z" },
], feed = [] } = {}) {
  return [
    [/FROM ad_creative_signals\s+WHERE org_id = \$1\s+GROUP BY iso_week/, (sql, p) => shelf(weeks, [])(sql, p)],
    [/FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/, (sql, p) => shelf(feed, [
      clause(/s\.org_id = \$1/, (row, params) => row.org_id === params[0]),
      clause(/s\.iso_week = \$2/, (row, params) => row.iso_week === params[1]),
      clause(/coalesce\(w\.watch_group, 'direct'\) <> 'own'/, (row) => row.watch_group !== "own"),
      clause(/k\.angle = \$6/, (row, params) => row.angle === params[5]),
    ])(sql, p)],
  ];
}

const asPartner = { account: { kind: "partner", partnerId: PARTNER } };

test("adintel/board movers: this week's top creatives for a partner, rank trend kept, the company's own ads and the raw score withheld, both stated limits sent", async () => {
  assert.equal(ROUTES["adintel/board"], adintelBoard);
  const feed = [
    feedRow({ content_hash: "h-own", watch_group: "own", winner_score_rank: 2 }),
    feedRow({ content_hash: "h-risky", compliance_risk: "implies_guaranteed_approval", winner_score_rank: 3 }),
    feedRow({ content_hash: "h-other", org_id: OTHER_ORG_ID, winner_score_rank: 4 }),
    feedRow({ content_hash: "h-top" }),
  ];
  const done = await hit(adintelBoard, { ...asPartner, query: { partner_id: OTHER_PARTNER }, rules: boardRules({ feed }) });
  assert.equal(done.status, 200);
  assert.equal(done.body.view, "movers");
  assert.equal(done.body.week, WEEK, "the latest week that has data, not this calendar week");
  assert.deepEqual(done.body.items.map((i) => i.content_hash).sort(), ["h-risky", "h-top"].sort(), "own ads and another company's rows are not on the board");
  const risky = done.body.items.find((i) => i.content_hash === "h-risky");
  assert.equal(risky.do_not_copy, true, "a creative that promises approval is shown greyed with a do-not-copy flag");
  const top = done.body.items.find((i) => i.content_hash === "h-top");
  assert.equal(top.do_not_copy, false);
  assert.equal(top.rank_delta, 2);
  const body = JSON.stringify(done.body);
  for (const secret of ["winner_score\"", "weights_version", "cost_cents", "input_tokens", "vendor_run_id", "\"raw\"", "watch_group"]) {
    assert.equal(body.includes(secret), false, `${secret} never reaches a partner`);
  }
  assert.deepEqual(done.body.notes, { rankBasis: RANK_BASIS_NOTE, spend: NO_SPEND_NOTE });
  const [feedCall] = sqlCalls(done, /FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/);
  assert.deepEqual(feedCall.params, [ORG_ID, WEEK, "2026-W40", 51, 0]);
  assert.match(feedCall.sql, /ORDER BY s\.winner_score_rank ASC/);
  assert.match(feedCall.sql, /coalesce\(w\.watch_group, 'direct'\) <> 'own'/);
  const scope = done.db.calls.find((c) => /set_config\('fundhub\.partner_id'/.test(c.sql));
  assert.deepEqual(scope.params, [PARTNER], "a partner is scoped to their own id; the partner_id in the address is ignored");
});

test("adintel/board filters: a known angle narrows the feed, an unknown one is ignored, a week in the address is used as given", async () => {
  const feed = [feedRow({ content_hash: "h-a", angle: ANGLES[0] }), feedRow({ content_hash: "h-b", angle: ANGLES[1] })];
  const narrowed = await hit(adintelBoard, { ...asPartner, query: { angle: ANGLES[1], band: "hot", platform: "meta" }, rules: boardRules({ feed }) });
  assert.deepEqual(narrowed.body.items.map((i) => i.content_hash), ["h-b"]);
  const [call] = sqlCalls(narrowed, /FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/);
  assert.deepEqual(call.params, [ORG_ID, WEEK, "2026-W40", 51, 0, ANGLES[1], "hot", "meta"]);

  const ignored = await hit(adintelBoard, { ...asPartner, query: { angle: "not-an-angle", band: "lukewarm" }, rules: boardRules({ feed }) });
  assert.deepEqual(ignored.body.items.map((i) => i.content_hash).sort(), ["h-a", "h-b"], "a stray filter narrows nothing and blanks nothing");
  assert.deepEqual(sqlCalls(ignored, /FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/)[0].params, [ORG_ID, WEEK, "2026-W40", 51, 0]);

  const named = await hit(adintelBoard, { ...asPartner, query: { week: "2026-W38" }, rules: boardRules({ feed: feed.map((f) => ({ ...f, iso_week: "2026-W38" })) }) });
  assert.equal(named.body.week, "2026-W38");
  assert.equal(sqlCalls(named, /GROUP BY iso_week/).length, 0, "a named week needs no week lookup");
  assert.deepEqual(sqlCalls(named, /FROM ad_creative_signals s\s+JOIN ad_creatives_seen c/)[0].params.slice(0, 3), [ORG_ID, "2026-W38", "2026-W37"]);
  const badWeek = await hit(adintelBoard, { ...asPartner, query: { week: "last-tuesday" }, rules: boardRules({ feed }) });
  assert.equal(badWeek.body.week, WEEK, "a malformed week falls back to the latest rolled-up week");
});

test("adintel/board views: death watch, new entrants, the saturation grid and the weeks list each ask their own question for this company", async () => {
  const views = [
    ["death-watch", /s\.death_watch IS TRUE/, [ORG_ID, WEEK, 51, 0]],
    ["new-entrants", /s\.new_entrant IS TRUE/, [ORG_ID, WEEK, 51]],
    ["saturation", /FROM ad_library_records r/, [ORG_ID, "2026-10-05", "2026-10-11"]],
    ["weeks", /GROUP BY iso_week/, [ORG_ID, 51]],
  ];
  for (const [view, pattern, params] of views) {
    const out = await hit(adintelBoard, {
      ...asPartner, query: { view },
      rules: [
        [/s\.death_watch IS TRUE/, [feedRow({ death_watch: true })]],
        [/s\.new_entrant IS TRUE/, [{ advertiser_id: "adv-9", platform: "meta", creatives: 2, first_seen_at: "2026-10-06T00:00:00.000Z", on_watch_list: false }]],
        [/FROM ad_library_records r/, [{ content_hash: "h1", advertiser_id: "adv-1", angle: ANGLES[0], ad_format: "video", funnel: "vsl" }]],
        ...boardRules(),
      ],
    });
    assert.equal(out.status, 200, view);
    assert.equal(out.body.view, view);
    assert.equal(out.body.week, WEEK, view);
    assert.ok(out.body.count >= 1, view);
    const calls = sqlCalls(out, pattern);
    assert.ok(calls.length >= 1, view);
    assert.deepEqual(calls.at(-1).params, params, view);
  }
  const unknown = await hit(adintelBoard, { ...asPartner, query: { view: "bogus" }, rules: boardRules({ feed: [feedRow()] }) });
  assert.equal(unknown.body.view, "movers", "an unknown view is the default one");
});

test("adintel/board says plainly when nothing has been rolled up, and makes staff name a partner; a client or affiliate login is refused", async () => {
  const empty = await hit(adintelBoard, { ...asPartner, rules: boardRules({ weeks: [] }) });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.ok, true);
  assert.deepEqual(empty.body.items, []);
  assert.equal(empty.body.week, null);
  assert.equal(empty.body.meta.reason, "no_weeks_rolled_up");
  assert.deepEqual(empty.body.notes, { rankBasis: RANK_BASIS_NOTE, spend: NO_SPEND_NOTE });

  const staffAlone = await hit(adintelBoard, { rules: boardRules({ feed: [feedRow()] }) });
  assert.equal(staffAlone.status, 400);
  assert.equal(staffAlone.body.error, "partner_id_required");
  assert.equal(sqlCalls(staffAlone, /ad_creative_signals/).length, 0);

  const staff = await hit(adintelBoard, { query: { partner_id: PARTNER }, rules: boardRules({ feed: [feedRow()] }) });
  assert.equal(staff.status, 200);
  assert.deepEqual(staff.db.calls.find((c) => /set_config\('fundhub\.partner_id'/.test(c.sql)).params, [PARTNER]);
  assert.equal(staff.body.items.length, 1);

  for (const kind of ["client", "affiliate"]) {
    const refused = await hit(adintelBoard, { account: { kind, clientId: kind === "client" ? CLIENT : null }, query: { partner_id: PARTNER }, rules: boardRules({ feed: [feedRow()] }) });
    assert.equal(refused.status, 403, `a ${kind} login is refused`);
    assert.equal(sqlCalls(refused, /ad_creative_signals/).length, 0);
  }
  const post = await hit(adintelBoard, { ...asPartner, method: "POST", rules: [] });
  assert.equal(post.status, 405);
  const signedOut = await hit(adintelBoard, { anonymous: true, rules: [] });
  assert.equal(signedOut.status, 401);
});
