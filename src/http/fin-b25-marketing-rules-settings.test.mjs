// Finish-the-853 batch 25, practice tests for the copy rules screen (read Part 0, banned phrases and
// recent changes; add, edit or ban through the repo outbox) and the marketing settings (one row per
// company, saved only against the updated_at the screen read). Each test runs the REAL api/ handler
// over a stand-in database that answers by the SQL text the code sends. Fake data only. No GitHub.
import assert from "node:assert/strict";
import test from "node:test";

import rulesHandler from "../../api/marketing/rules.mjs";
import settingsHandler from "../../api/marketing/settings.mjs";
import { BANNED_PATH, RULES_PATH } from "../repo/edit-ops.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, requestLog, sqlCalls, updatedFields,
} from "../testing/fin-b25-kit.mjs";

const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const NOW = new Date("2026-10-14T18:00:00.000Z");

/* ── the copy rules screen: marketing/rules ────────────────────────────────────────────────────────── */

const RULES_TEXT = [
  "# Ad rules",
  "",
  "# PART 0 — CHRIS'S RULES",
  "",
  "1. Say the cause first.",
  "2. No greeting in the hook.",
  "",
  "# PART 1 — THE MACHINE'S RULES",
  "",
  "1. Keep it under 90 seconds.",
  "",
].join("\n");
const BANNED_TEXT = JSON.stringify(["guaranteed approval", "no credit check"]);

const bundle = (over = {}) => ({
  readBundled: (rel) => (rel === RULES_PATH ? RULES_TEXT : rel === BANNED_PATH ? BANNED_TEXT : null),
  ...over,
});

function outboxRules(rows) {
  const seen = [];
  const rules = [
    [/^\s*SELECT op_id, edit, committed_sha, error, created_at\s+FROM repo_outbox/, (_sql, params) => {
      seen.push(params);
      return rows
        .filter((r) => r.org_id === params[0] && r.mode === "edit" && params[1].includes(r.path) && params[2].includes(r.edit?.op))
        .sort((a, b) => b.id - a.id)
        .slice(0, params[3]);
    }],
    [/^\s*SELECT edit FROM repo_outbox\s+WHERE org_id = \$1 AND mode = 'edit' AND path = \$2 AND committed_sha IS NULL/, (_sql, params) =>
      rows.filter((r) => r.org_id === params[0] && r.mode === "edit" && r.path === params[1] && !r.committed_sha && params[2].includes(r.edit?.op))
        .sort((a, b) => a.id - b.id).map((r) => ({ edit: r.edit }))],
    [/^\s*INSERT INTO repo_outbox/, (_sql, params) => {
      const row = {
        id: rows.length + 100, org_id: params[0], op_id: params[1], path: params[2], mode: params[3],
        content: params[4], edit: params[5] == null ? null : JSON.parse(params[5]), committed_sha: null, error: null, created_at: NOW,
      };
      rows.push(row);
      return [{ id: row.id, op_id: row.op_id, path: row.path, mode: row.mode }];
    }],
  ];
  return { rules, seen };
}

test("GET marketing/rules reads Part 0 and the banned phrases from the built-in copy and lists this company's recent changes as waiting, committed or failed", async () => {
  const rows = [
    { id: 1, org_id: ORG_ID, op_id: "op-1", path: RULES_PATH, mode: "edit", edit: { op: "part0_add_rule", text: "Never promise a number." }, committed_sha: "abc1234", error: null, created_at: new Date("2026-10-10T10:00:00.000Z") },
    { id: 2, org_id: ORG_ID, op_id: "op-2", path: BANNED_PATH, mode: "edit", edit: { op: "ban_phrase", phrase: "instant funding" }, committed_sha: null, error: "the repo said no", created_at: new Date("2026-10-11T10:00:00.000Z") },
    { id: 3, org_id: ORG_ID, op_id: "op-3", path: RULES_PATH, mode: "edit", edit: { op: "part0_edit_rule", number: 2, text: "No greeting, ever." }, committed_sha: null, error: null, created_at: new Date("2026-10-12T10:00:00.000Z") },
    { id: 4, org_id: OTHER_ORG_ID, op_id: "op-4", path: RULES_PATH, mode: "edit", edit: { op: "part0_add_rule", text: "Another company's rule." }, committed_sha: null, error: null, created_at: new Date("2026-10-13T10:00:00.000Z") },
    { id: 5, org_id: ORG_ID, op_id: "op-5", path: "marketing/ads/scripts/machine/x.md", mode: "replace", edit: null, committed_sha: null, error: null, created_at: new Date("2026-10-13T11:00:00.000Z") },
  ];
  const { rules, seen } = outboxRules(rows);
  const result = await call(rulesHandler, { rules, deps: { env: { COMMIT_REF: "0123456789abcdef0123456789abcdef01234567" }, rules: bundle() } });
  assert.equal(result.status, 200);
  assert.equal(result.body.source, "bundle");
  assert.equal(result.body.rules_sha, "0123456789abcdef0123456789abcdef01234567");
  assert.deepEqual(result.body.part0, [{ n: 1, text: "Say the cause first." }, { n: 2, text: "No greeting in the hook." }], "Part 0 only, not the machine's own rules");
  assert.deepEqual(result.body.banned, ["guaranteed approval", "no credit check"]);
  assert.deepEqual(result.body.recent, [
    { op_id: "op-3", action: "edit", text: "No greeting, ever.", n: 2, state: "waiting", committed_sha: null, at: "2026-10-12T10:00:00.000Z" },
    { op_id: "op-2", action: "ban", text: "instant funding", n: null, state: "failed", committed_sha: null, at: "2026-10-11T10:00:00.000Z" },
    { op_id: "op-1", action: "add", text: "Never promise a number.", n: null, state: "committed", committed_sha: "abc1234", at: "2026-10-10T10:00:00.000Z" },
  ], "newest first, this company's rule changes only");
  assert.equal(seen[0][0], ORG_ID);
  assert.deepEqual(seen[0][1], [RULES_PATH, BANNED_PATH]);
  assert.deepEqual(seen[0][2], ["part0_add_rule", "part0_edit_rule", "ban_phrase"]);
  const recent = sqlCalls(result, /FROM repo_outbox/)[0];
  assertSqlHas(recent.sql, { company: "WHERE org_id = $1", edits: "AND mode = 'edit'", order: "ORDER BY created_at DESC, id DESC" });
});

test("GET marketing/rules reads GitHub at one commit when a token is set, falls back to the built-in copy when GitHub fails, and says 503 when neither copy exists", async () => {
  const github = {
    getRef: async () => ({ ok: true, sha: "feedfacefeedfacefeedfacefeedfacefeedface" }),
    getContents: async (path, { ref }) => {
      assert.equal(ref, "feedfacefeedfacefeedfacefeedfacefeedface", "both files are read at the one pinned commit");
      return path === RULES_PATH ? { ok: true, content: RULES_TEXT.replace("Say the cause first.", "Cause first, always.") } : { ok: true, missing: true };
    },
  };
  const { rules } = outboxRules([]);
  const live = await call(rulesHandler, { rules, deps: { env: { GITHUB_REPO_TOKEN: "fake-not-a-real-token" }, rules: { ...github, readBundled: () => null } } });
  assert.equal(live.status, 200);
  assert.equal(live.body.source, "github");
  assert.equal(live.body.rules_sha, "feedfacefeedfacefeedfacefeedfacefeedface");
  assert.equal(live.body.part0[0].text, "Cause first, always.");
  assert.deepEqual(live.body.banned, [], "a missing banned file is an empty list");

  const down = await call(rulesHandler, {
    rules, deps: { env: { GITHUB_REPO_TOKEN: "fake-not-a-real-token", COMMIT_REF: "not-a-commit" }, rules: { getRef: async () => ({ ok: false, error: "nope" }), getContents: async () => ({ ok: false }), readBundled: bundle().readBundled } },
  });
  assert.equal(down.status, 200);
  assert.equal(down.body.source, "bundle", "GitHub failed, so the copy built into the site is read");
  assert.equal(down.body.rules_sha, null, "a deploy stamp that is not a commit is not shown as one");

  const none = await call(rulesHandler, { rules, deps: { env: {}, rules: { readBundled: () => null } } });
  assert.equal(none.status, 503);
  assert.equal(none.body.error, "rules_unavailable");

  const noPart0 = await call(rulesHandler, { rules, deps: { env: {}, rules: { readBundled: (rel) => (rel === RULES_PATH ? "# Just a title\n" : null) } } });
  assert.equal(noPart0.status, 503);
});

test("POST marketing/rules queues one outbox edit per add, edit or ban in the session's company, wakes the worker, and a repeated request_id queues nothing", async () => {
  const rows = [];
  const { rules } = outboxRules(rows);
  const log = requestLog();
  const woke = [];
  const deps = { env: {}, rules: bundle(), wake: async (env) => { woke.push(env); return {}; } };
  const all = [...log.rules, ...rules];

  const add = await call(rulesHandler, { method: "POST", body: { request_id: REQ(1), action: "add", text: "  Never   open with a question.  " }, rules: all, deps });
  assert.equal(add.status, 202);
  assert.equal(add.body.queued, true);
  assert.match(add.body.op_id, /^[0-9a-f-]{36}$/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].org_id, ORG_ID);
  assert.equal(rows[0].path, RULES_PATH);
  assert.equal(rows[0].mode, "edit");
  assert.deepEqual(rows[0].edit, { op: "part0_add_rule", text: "Never open with a question." }, "spaces are folded to one line");
  assert.equal(rows[0].op_id, add.body.op_id);
  assert.equal(woke.length, 1);

  const edit = await call(rulesHandler, { method: "POST", body: { request_id: REQ(2), action: "edit", n: 2, text: "No greeting, ever." }, rules: all, deps });
  assert.equal(edit.status, 202);
  assert.deepEqual(rows[1].edit, { op: "part0_edit_rule", number: 2, text: "No greeting, ever." });
  assert.equal(rows[1].path, RULES_PATH);

  const ban = await call(rulesHandler, { method: "POST", body: { request_id: REQ(3), action: "ban", text: "Instant Funding" }, rules: all, deps });
  assert.equal(ban.status, 202);
  assert.deepEqual(rows[2].edit, { op: "ban_phrase", phrase: "Instant Funding" });
  assert.equal(rows[2].path, BANNED_PATH);

  const again = await call(rulesHandler, { method: "POST", body: { request_id: REQ(3), action: "ban", text: "Instant Funding" }, rules: all, deps });
  assert.equal(again.status, 202);
  assert.deepEqual(again.body, ban.body, "the first answer comes back");
  assert.equal(rows.length, 3, "and nothing is queued again");
  assert.equal(log.saved.get(REQ(3)).route, "marketing/rules");
  assert.equal(log.saved.get(REQ(3)).org_id, ORG_ID);
});

test("POST marketing/rules refuses an edit of a rule Part 0 does not have (a rule still waiting in the outbox counts), a bad action, empty or oversize words", async () => {
  const deps = { env: {}, rules: bundle(), wake: async () => ({}) };
  const missing = await call(rulesHandler, { method: "POST", body: { request_id: REQ(10), action: "edit", n: 7, text: "Seven." }, rules: outboxRules([]).rules, deps });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.field, "n");
  assert.match(missing.body.message, /no rule 7/);

  // rule 3 was added by a change still waiting in the outbox: it can be edited now
  const waiting = [{ id: 1, org_id: ORG_ID, op_id: "w-1", path: RULES_PATH, mode: "edit", edit: { op: "part0_add_rule", text: "Third rule." }, committed_sha: null, error: null, created_at: NOW }];
  const { rules } = outboxRules(waiting);
  const ok = await call(rulesHandler, { method: "POST", body: { request_id: REQ(11), action: "edit", n: 3, text: "Third rule, reworded." }, rules, deps });
  assert.equal(ok.status, 202);
  assert.equal(waiting.at(-1).edit.number, 3);
  const waitingRead = sqlCalls(ok, /SELECT edit FROM repo_outbox/)[0];
  assert.deepEqual(waitingRead.params, [ORG_ID, RULES_PATH, ["part0_add_rule", "part0_edit_rule"]]);
  assertSqlHas(waitingRead.sql, { company: "WHERE org_id = $1", notYetCommitted: "AND committed_sha IS NULL", order: "ORDER BY id" });
  // another company's waiting edit does not count
  const foreign = [{ ...waiting[0], org_id: OTHER_ORG_ID }];
  const notMine = await call(rulesHandler, { method: "POST", body: { request_id: REQ(12), action: "edit", n: 3, text: "Third rule." }, rules: outboxRules(foreign).rules, deps });
  assert.equal(notMine.status, 400, "a rule another company added does not make rule 3 exist here");

  const badAction = await call(rulesHandler, { method: "POST", body: { request_id: REQ(13), action: "delete", text: "x" }, rules: [], deps });
  assert.equal(badAction.status, 400);
  assert.equal(badAction.body.field, "action");
  const empty = await call(rulesHandler, { method: "POST", body: { request_id: REQ(14), action: "add", text: "   " }, rules: [], deps });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "text");
  const longBan = await call(rulesHandler, { method: "POST", body: { request_id: REQ(15), action: "ban", text: "x".repeat(201) }, rules: [], deps });
  assert.equal(longBan.status, 400);
  assert.match(longBan.body.message, /at most 200/);
  const longRule = await call(rulesHandler, { method: "POST", body: { request_id: REQ(16), action: "add", text: "x".repeat(1001) }, rules: [], deps });
  assert.equal(longRule.status, 400);
  const noN = await call(rulesHandler, { method: "POST", body: { request_id: REQ(17), action: "edit", text: "x" }, rules: [], deps });
  assert.equal(noN.status, 400);
  assert.equal(noN.body.field, "n");
  await assertRoleGate(rulesHandler, ["owner", "admin"], { rules: outboxRules([]).rules, deps });
  await assertRoleGate(rulesHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(18), action: "add", text: "A rule." }, rules: outboxRules([]).rules, deps });
});

/* ── the marketing settings: marketing/settings ────────────────────────────────────────────────────── */

const DEFAULTS = {
  enabled: false, batch_weekday: 1, batch_time: "07:00:00", timezone: "America/Phoenix", scripts_per_day: 3, days_per_batch: 7,
  size_rule: "total", format_style: { standard: "bullets", sorting: "bullets" }, draft_expiry_days: 14, winner_rule: null,
  ad_number_floor: 91, next_overrides: null, max_batch_cost_usd: 25, max_month_cost_usd: 300, submagic_template: "Hormozi 2",
  caption_position_y: null, magic_zooms: true, clean_audio: true, caption_dictionary: [], animation_mode: "fullframe",
  flip_horizontal: false, settle_minutes: 10, quiet_start: "21:00:00", quiet_end: "07:00:00", updated_by: null,
  max_research_cost_usd: null, research_shares_month_cap: true,
};

function settingsWorld(rows = []) {
  const log = requestLog();
  const world = { rows, updates: [], ensures: [], log };
  world.rules = [
    ...log.rules,
    [/^\s*INSERT INTO marketing_settings \(org_id\) VALUES \(\$1\) ON CONFLICT \(org_id\) DO NOTHING/, (_sql, params) => {
      world.ensures.push(params[0]);
      if (!rows.some((r) => r.org_id === params[0])) {
        rows.push({ org_id: params[0], ...DEFAULTS, updated_at: new Date("2026-10-01T09:00:00.000Z") });
      }
      return [];
    }],
    [/^\s*SELECT \* FROM marketing_settings WHERE org_id = \$1/, (sql, params) => rowsWhere(rows, sql, params).map((r) => ({ ...r }))],
    [/^\s*UPDATE marketing_settings SET/, (sql, params) => {
      world.updates.push({ sql, params });
      const hit = rowsWhere(rows, sql, params);
      for (const row of hit) {
        Object.assign(row, updatedFields(sql, params, NOW));
        const merged = /format_style = format_style \|\| \$(\d+)::jsonb/.exec(sql);
        if (merged) row.format_style = { ...row.format_style, ...JSON.parse(params[Number(merged[1]) - 1]) };
        // numeric columns arrive from node-postgres as text
        if (row.max_research_cost_usd != null) row.max_research_cost_usd = String(row.max_research_cost_usd);
        row.updated_at = NOW;
      }
      return hit.map((r) => ({ ...r }));
    }],
  ];
  return world;
}

test("GET marketing/settings makes this company's row with the defaults on first read and answers it with plain times, never another company's row", async () => {
  const other = { org_id: OTHER_ORG_ID, ...DEFAULTS, batch_weekday: 5, max_month_cost_usd: 999, updated_at: new Date("2026-10-02T09:00:00.000Z") };
  const world = settingsWorld([other]);
  const result = await call(settingsHandler, { rules: world.rules });
  assert.equal(result.status, 200);
  const s = result.body.settings;
  assert.equal(s.org_id, ORG_ID);
  assert.equal(s.enabled, false, "the machine starts switched off");
  assert.equal(s.batch_weekday, 1);
  assert.equal(s.batch_time, "07:00", "a time of day is HH:MM, no seconds");
  assert.equal(s.quiet_start, "21:00");
  assert.equal(s.max_month_cost_usd, 300, "not the other company's 999");
  assert.equal(s.updated_at, "2026-10-01T09:00:00.000Z");
  assert.deepEqual(s.caption_dictionary, []);
  assert.equal(s.max_research_cost_usd, null);
  assert.equal(s.research_shares_month_cap, true);
  assert.deepEqual(world.ensures, [ORG_ID]);
  assert.equal(world.rows.length, 2, "one row per company");
  const read = sqlCalls(result, /SELECT \* FROM marketing_settings/)[0];
  assert.deepEqual(read.params, [ORG_ID]);
  assertSqlHas(read.sql, { company: "WHERE org_id = $1" });
  const insert = sqlCalls(result, /INSERT INTO marketing_settings/)[0];
  assertSqlHas(insert.sql, { race: "ON CONFLICT (org_id) DO NOTHING" });
  await assertRoleGate(settingsHandler, ["owner", "admin"], { rules: settingsWorld([]).rules });
});

test("POST marketing/settings saves a patch only against the updated_at the screen read, records who saved, merges one format at a time, and a repeat writes nothing", async () => {
  const world = settingsWorld([{ org_id: ORG_ID, ...DEFAULTS, updated_at: new Date("2026-10-01T09:00:00.000Z") }]);
  const patch = {
    enabled: true, batch_time: "08:30", max_batch_cost_usd: 40, format_style: { standard: "words" },
    caption_dictionary: ["Fundhub", "UnderwriteIQ"], winner_rule: { metric: "roas", min: 2 }, max_research_cost_usd: 2.5,
  };
  const result = await call(settingsHandler, {
    method: "POST", body: { request_id: REQ(30), updated_at: "2026-10-01T09:00:00.000Z", patch }, rules: world.rules,
  });
  assert.equal(result.status, 200);
  const s = result.body.settings;
  assert.equal(s.enabled, true);
  assert.equal(s.batch_time, "08:30");
  assert.equal(s.max_batch_cost_usd, 40);
  assert.deepEqual(s.format_style, { standard: "words", sorting: "bullets" }, "one format changes and the other is kept");
  assert.deepEqual(s.caption_dictionary, ["Fundhub", "UnderwriteIQ"]);
  assert.equal(s.max_research_cost_usd, 2.5);
  assert.equal(s.updated_by, STAFF_ID);
  assert.equal(s.updated_at, NOW.toISOString());
  assert.equal(world.updates.length, 1);
  const update = world.updates[0];
  assertSqlHas(update.sql, {
    company: "WHERE org_id = $1",
    merge: "format_style = format_style || $",
    time: "batch_time = $",
    moves: "updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')",
  });
  assert.equal(update.params[0], ORG_ID);
  assert.deepEqual(JSON.parse(update.params.find((p) => typeof p === "string" && p.startsWith('{"metric"'))), { metric: "roas", min: 2 });
  const lock = sqlCalls(result, /FOR UPDATE/)[0];
  assert.deepEqual(lock.params, [ORG_ID]);

  const again = await call(settingsHandler, {
    method: "POST", body: { request_id: REQ(30), updated_at: "2026-10-01T09:00:00.000Z", patch }, rules: world.rules,
  });
  assert.deepEqual(again.body, result.body);
  assert.equal(world.updates.length, 1, "a repeated request_id writes nothing");
});

test("POST marketing/settings answers 409 with what is saved when updated_at is old, and 400 for an unknown key, a server-set key, an empty patch and bad values", async () => {
  const world = settingsWorld([{ org_id: ORG_ID, ...DEFAULTS, updated_at: new Date("2026-10-05T09:00:00.000Z") }]);
  const post = (body, n) => call(settingsHandler, { method: "POST", body: { request_id: REQ(n), ...body }, rules: world.rules });

  const stale = await post({ updated_at: "2026-10-01T09:00:00.000Z", patch: { enabled: true } }, 40);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "stale");
  assert.equal(stale.body.current.updated_at, "2026-10-05T09:00:00.000Z");
  assert.equal(stale.body.current.enabled, false);
  assert.equal(world.updates.length, 0, "a stale save changes nothing");
  assert.equal(world.rows[0].enabled, false);

  const noStamp = await post({ patch: { enabled: true } }, 41);
  assert.equal(noStamp.status, 400);
  assert.equal(noStamp.body.field, "updated_at");
  const unknown = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { colour: "red" } }, 42);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.field, "patch.colour");
  const serverSet = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { org_id: OTHER_ORG_ID } }, 43);
  assert.equal(serverSet.status, 400);
  assert.equal(serverSet.body.field, "patch.org_id");
  const empty = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: {} }, 44);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "patch");
  const badTime = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { batch_time: "25:99" } }, 45);
  assert.equal(badTime.status, 400);
  assert.equal(badTime.body.field, "patch.batch_time");
  const badZone = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { timezone: "Mars/Olympus" } }, 46);
  assert.equal(badZone.status, 400);
  const badFormat = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { format_style: { standard: "poetry" } } }, 47);
  assert.equal(badFormat.status, 400);
  assert.equal(badFormat.body.field, "patch.format_style.standard");
  const badCost = await post({ updated_at: "2026-10-05T09:00:00.000Z", patch: { max_research_cost_usd: 2000 } }, 48);
  assert.equal(badCost.status, 400);
  assert.equal(world.updates.length, 0);
  await assertRoleGate(settingsHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(49), updated_at: "2026-10-05T09:00:00.000Z", patch: { enabled: true } }, rules: world.rules });
});
