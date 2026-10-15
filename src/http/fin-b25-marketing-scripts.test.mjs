// Finish-the-853 batch 25, practice tests for the script doors: approve, edit (and the film-key edit),
// reject, film order, and the Fix button. Each test runs the REAL api/ handler (real sign-in and role
// gate, real script store, real repo-file writer) over an in-memory ad_scripts / repo_outbox world that
// answers by the SQL text the code sends. Fake data only. No Postgres, no GitHub, no worker.
import assert from "node:assert/strict";
import test from "node:test";

import approveHandler from "../../api/marketing/scripts/approve.mjs";
import editHandler from "../../api/marketing/scripts/edit.mjs";
import fixHandler from "../../api/marketing/scripts/fix.mjs";
import orderHandler from "../../api/marketing/scripts/order.mjs";
import rejectHandler from "../../api/marketing/scripts/reject.mjs";
import { mintFilmKey } from "../marketing/shoot-film-key.mjs";
import { parseScript } from "../marketing/script-file.mjs";
import { ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, dataCalls, sqlCalls } from "../testing/fin-b25-kit.mjs";
import { WORLD_NOW, scriptRow, scriptWorld } from "../testing/fin-b25-script-world.mjs";

const SCRIPT_ID = "a5000000-0000-4000-8000-000000000001";
const ROOT_ID = "a5000000-0000-4000-8000-0000000000f0";
const OTHER_ID = "a5000000-0000-4000-8000-000000000002";
const OTHER_ROOT = "a5000000-0000-4000-8000-0000000000f1";
const SHOOT_ID = "5b000000-0000-4000-8000-000000000001";
const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const wakes = () => {
  const seen = [];
  return { seen, wake: async (env) => { seen.push(env); return { ok: true }; } };
};

/* ── approve ───────────────────────────────────────────────────────────────────────────────────────── */

test("POST marketing/scripts/approve locks a draft, gives it the next ad number once, queues the registry entry and the repo file, and wakes the worker", async () => {
  const world = scriptWorld({ scripts: [scriptRow()], nextAdNumber: 91 });
  const { seen, wake } = wakes();
  const result = await call(approveHandler, {
    method: "POST", body: { request_id: REQ(1), id: SCRIPT_ID, version: 1 }, rules: world.rules, deps: { wake, env: { MARK: "env" } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ad_number, "91");
  assert.equal(result.body.registry, "queued");
  assert.equal(result.body.registry_note, null);
  assert.equal(result.body.script.status, "locked");
  assert.equal(result.body.script.ad_id, "91");
  assert.equal(result.body.script.locked_by, STAFF_ID, "only a person approves: locked_by is the caller's staff id");
  assert.deepEqual(world.adNumberAsks, [ORG_ID], "the number is drawn for the session's company, once");

  const saved = world.scripts[0];
  assert.equal(saved.status, "locked");
  assert.equal(saved.ad_id, "91");
  assert.equal(saved.locked_by, STAFF_ID);

  assert.equal(world.outbox.length, 2);
  const registry = world.outbox.find((row) => row.mode === "edit");
  assert.equal(registry.path, "marketing/ads/registry.json");
  assert.deepEqual(registry.edit, { op: "registry_add_ad", id: "91", title: "Say the cause first", lane: "funding600" });
  assert.equal(registry.org_id, ORG_ID);
  const file = world.outbox.find((row) => row.mode === "replace");
  assert.equal(file.path, "marketing/ads/scripts/machine/on-demand/01-say-the-cause-first.md");
  const parsed = parseScript(file.content);
  assert.equal(parsed.ad, "91");
  assert.equal(parsed.status, "locked");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.body, saved.body, "the file holds the words byte for byte");
  assert.equal(saved.repo_path, file.path, "the path is saved on the script and never moves");

  const lock = sqlCalls(result, /FOR UPDATE OF s/)[0];
  assert.deepEqual(lock.params, [SCRIPT_ID, ORG_ID]);
  assertSqlHas(lock.sql, {
    company: "WHERE s.id = $1 AND s.org_id = $2",
    visible: "(s.source <> 'import' AND (s.batch_id IS NULL OR (b.status = 'released' AND b.release_at <= now())))",
    lockedRow: "FOR UPDATE OF s",
  });
  const lockUpdate = sqlCalls(result, /SET status = 'locked'/)[0];
  assertSqlHas(lockUpdate.sql, { onlyLive: "AND archived_at IS NULL" });
  assert.equal(seen.length, 1, "the worker is woken after the commit");
  assert.equal(result.db.count("COMMIT"), 1);
  assert.equal(world.requests.saved.get(REQ(1)).route, "marketing/scripts/approve");
});

test("POST marketing/scripts/approve keeps an existing number, says plainly when the lane has no registry rule, and a repeat of the request writes nothing", async () => {
  // a script already locked keeps its number and queues nothing new
  const locked = scriptWorld({ scripts: [scriptRow({ status: "locked", ad_id: "90", locked_by: STAFF_ID })] });
  const again = await call(approveHandler, { method: "POST", body: { request_id: REQ(2), id: SCRIPT_ID, version: 1 }, rules: locked.rules, deps: { wake: async () => ({}) } });
  assert.equal(again.status, 200);
  assert.equal(again.body.ad_number, "90");
  assert.equal(again.body.registry, "skipped");
  assert.match(again.body.registry_note, /already approved as Ad 90/);
  assert.deepEqual(locked.adNumberAsks, [], "no new number is drawn");
  assert.equal(locked.outbox.length, 0, "nothing new is queued");

  // a draft that already carries a number (an edited, re-approved script) keeps it and draws no new one
  const numbered = scriptWorld({ scripts: [scriptRow({ ad_id: "77" })], nextAdNumber: 200 });
  const numberedAnswer = await call(approveHandler, { method: "POST", body: { request_id: REQ(13), id: SCRIPT_ID, version: 1 }, rules: numbered.rules, deps: { wake: async () => ({}) } });
  assert.equal(numberedAnswer.body.ad_number, "77");
  assert.deepEqual(numbered.adNumberAsks, [], "a script that has a number is never given a second one");
  assert.equal(numbered.scripts[0].ad_id, "77");

  // the slo lane has no registry rule by design: the script file still goes
  const slo = scriptWorld({ scripts: [scriptRow({ lane: "slo" })], nextAdNumber: 120 });
  const sloAnswer = await call(approveHandler, { method: "POST", body: { request_id: REQ(3), id: SCRIPT_ID, version: 1 }, rules: slo.rules, deps: { wake: async () => ({}) } });
  assert.equal(sloAnswer.status, 200);
  assert.equal(sloAnswer.body.ad_number, "120");
  assert.equal(sloAnswer.body.registry, "skipped");
  assert.match(sloAnswer.body.registry_note, /slo lane has no rule/);
  assert.equal(slo.outbox.length, 1);
  assert.equal(slo.outbox[0].mode, "replace");

  // a lane-less script
  const noLane = scriptWorld({ scripts: [scriptRow({ lane: null })] });
  const noLaneAnswer = await call(approveHandler, { method: "POST", body: { request_id: REQ(4), id: SCRIPT_ID, version: 1 }, rules: noLane.rules, deps: { wake: async () => ({}) } });
  assert.equal(noLaneAnswer.body.registry, "skipped");
  assert.match(noLaneAnswer.body.registry_note, /no lane/);

  // the same request_id twice: the first answer comes back, nothing is queued again
  const world = scriptWorld({ scripts: [scriptRow()] });
  const first = await call(approveHandler, { method: "POST", body: { request_id: REQ(5), id: SCRIPT_ID, version: 1 }, rules: world.rules, deps: { wake: async () => ({}) } });
  const outboxAfterFirst = world.outbox.length;
  const second = await call(approveHandler, { method: "POST", body: { request_id: REQ(5), id: SCRIPT_ID, version: 1 }, rules: world.rules, deps: { wake: async () => ({}) } });
  assert.deepEqual(second.body, first.body);
  assert.equal(world.outbox.length, outboxAfterFirst);
  assert.deepEqual(world.adNumberAsks, [ORG_ID], "the number was drawn once");
});

test("POST marketing/scripts/approve refuses a stale version, a script that is not visible, another company's script and a rejected one", async () => {
  const body = { request_id: REQ(6), id: SCRIPT_ID, version: 1 };
  const stale = scriptWorld({ scripts: [scriptRow({ version: 2, body: "Newer words." })] });
  const staleAnswer = await call(approveHandler, { method: "POST", body, rules: stale.rules, deps: { wake: async () => ({}) } });
  assert.equal(staleAnswer.status, 409);
  assert.equal(staleAnswer.body.error, "stale");
  assert.deepEqual(staleAnswer.body.current, { version: 2, body: "Newer words.", parts: null });
  assert.equal(stale.scripts[0].status, "draft");
  assert.equal(stale.outbox.length, 0);

  const imported = scriptWorld({ scripts: [scriptRow({ source: "import" })] });
  const importedAnswer = await call(approveHandler, { method: "POST", body: { ...body, request_id: REQ(7) }, rules: imported.rules, deps: { wake: async () => ({}) } });
  assert.equal(importedAnswer.status, 404, "an imported script is not actionable here");

  const unreleased = scriptWorld({
    scripts: [scriptRow({ batch_id: "ba000000-0000-4000-8000-000000000001" })],
    batches: [{ id: "ba000000-0000-4000-8000-000000000001", status: "draft", release_at: "2099-01-01T00:00:00.000Z", week_key: "2026-W42" }],
  });
  const unreleasedAnswer = await call(approveHandler, { method: "POST", body: { ...body, request_id: REQ(8) }, rules: unreleased.rules, deps: { wake: async () => ({}) } });
  assert.equal(unreleasedAnswer.status, 404, "a script from a batch not yet released cannot be seen, so it cannot be approved");

  const other = scriptWorld({ scripts: [scriptRow({ org_id: OTHER_ORG_ID })] });
  const otherAnswer = await call(approveHandler, { method: "POST", body: { ...body, request_id: REQ(9) }, rules: other.rules, deps: { wake: async () => ({}) } });
  assert.equal(otherAnswer.status, 404, "another company's script is not found");
  assert.equal(other.scripts[0].status, "draft");
  assert.deepEqual(other.adNumberAsks, []);

  const rejected = scriptWorld({ scripts: [scriptRow({ status: "rejected" })] });
  const rejectedAnswer = await call(approveHandler, { method: "POST", body: { ...body, request_id: REQ(10) }, rules: rejected.rules, deps: { wake: async () => ({}) } });
  assert.equal(rejectedAnswer.status, 400);
  assert.equal(rejectedAnswer.body.field, "id");
  assert.match(rejectedAnswer.body.message, /rejected, so it cannot be approved/);

  const noVersion = await call(approveHandler, { method: "POST", body: { request_id: REQ(11), id: SCRIPT_ID }, rules: [] });
  assert.equal(noVersion.status, 400);
  assert.equal(noVersion.body.field, "version");
  await assertRoleGate(approveHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(12), id: SCRIPT_ID, version: 1 }, rules: [], deps: { wake: async () => ({}) } });
});

/* ── edit ──────────────────────────────────────────────────────────────────────────────────────────── */

test("POST marketing/scripts/edit saves Chris's words as version 2, archives version 1, keeps the number and the file path, and saves a voice pair for the line he changed", async () => {
  const parts = [{ kind: "hook", text: "Your inquiries are why the bank said no." }, { kind: "body", text: "Here is the fix." }];
  const world = scriptWorld({
    scripts: [scriptRow({ status: "locked", ad_id: "91", parts, locked_at: WORLD_NOW, locked_by: STAFF_ID, repo_path: "marketing/ads/scripts/machine/2026-W42/01-say-the-cause-first.md" })],
    batches: [],
  });
  const newParts = [{ kind: "hook", text: "Inquiries are why the bank said no." }, { kind: "body", text: "Here is the fix." }];
  const body = "Inquiries are why the bank said no.\n\nHere is the fix.";
  const { seen, wake } = wakes();
  const result = await call(editHandler, {
    method: "POST", body: { request_id: REQ(20), id: SCRIPT_ID, version: 1, body, parts: newParts }, rules: world.rules, deps: { wake },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.script.version, 2);
  assert.equal(result.body.script.status, "locked", "a locked script's new version is locked: it keeps its number");
  assert.equal(result.body.script.ad_id, "91");
  assert.equal(result.body.script.body, body);
  assert.equal(result.body.script.source, "chris");
  assert.equal(result.body.voice_pairs, 1);
  assert.equal(Array.isArray(result.body.warnings), true);

  const [old, next] = world.scripts;
  assert.equal(old.status, "superseded");
  assert.ok(old.archived_at, "the old version is kept, and stops being live");
  assert.equal(next.parent_script_id, SCRIPT_ID);
  assert.equal(next.root_script_id, ROOT_ID);
  assert.equal(next.org_id, ORG_ID);
  assert.deepEqual(world.voicePairs[0].pairs, [{ before: "Your inquiries are why the bank said no.", after: "Inquiries are why the bank said no.", kind: "hook" }]);
  assert.equal(world.voicePairs[0].org_id, ORG_ID);

  const file = world.outbox.find((row) => row.mode === "replace");
  assert.equal(file.path, "marketing/ads/scripts/machine/2026-W42/01-say-the-cause-first.md", "the repo path never moves");
  const parsed = parseScript(file.content);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.body, body);
  assert.equal(parsed.ad, "91");
  assert.equal(seen.length, 1);

  const archive = sqlCalls(result, /SET archived_at = now\(\), status = 'superseded'/)[0];
  assert.deepEqual(archive.params, [SCRIPT_ID]);
  assertSqlHas(archive.sql, { onlyLive: "AND archived_at IS NULL" });
  assert.ok(result.db.calls.findIndex((c) => /SET archived_at = now\(\)/.test(c.sql)) < result.db.calls.findIndex((c) => /INSERT INTO ad_scripts/.test(c.sql)),
    "the old version is archived before the new one is inserted (one live version per root)");
});

test("POST marketing/scripts/edit on a draft stays a draft, clears the part marks with a warning when the words change and no parts come, and refuses a rejected script", async () => {
  const parts = [{ kind: "hook", text: "Your inquiries are why the bank said no." }];
  const world = scriptWorld({ scripts: [scriptRow({ parts })] });
  const result = await call(editHandler, {
    method: "POST", body: { request_id: REQ(21), id: SCRIPT_ID, version: 1, body: "Brand new words." }, rules: world.rules, deps: { wake: async () => ({}) },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.script.status, "draft");
  assert.equal(result.body.script.parts, null);
  assert.ok(result.body.warnings.some((w) => w.rule === "parts" && /part marks .* were cleared/.test(w.message)));
  assert.equal(world.scripts[1].ad_id, null, "a draft has no number yet");

  const same = scriptWorld({ scripts: [scriptRow({ parts })] });
  const sameBody = await call(editHandler, {
    method: "POST", body: { request_id: REQ(22), id: SCRIPT_ID, version: 1, body: scriptRow().body }, rules: same.rules, deps: { wake: async () => ({}) },
  });
  assert.deepEqual(sameBody.body.script.parts, parts, "the same words keep the part marks");

  const rejected = scriptWorld({ scripts: [scriptRow({ status: "rejected" })] });
  const refused = await call(editHandler, { method: "POST", body: { request_id: REQ(23), id: SCRIPT_ID, version: 1, body: "x y z" }, rules: rejected.rules, deps: { wake: async () => ({}) } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /rejected, so it cannot be edited/);

  const stale = scriptWorld({ scripts: [scriptRow({ version: 3, body: "Version three." })] });
  const staleAnswer = await call(editHandler, { method: "POST", body: { request_id: REQ(24), id: SCRIPT_ID, version: 1, body: "x y z" }, rules: stale.rules, deps: { wake: async () => ({}) } });
  assert.equal(staleAnswer.status, 409);
  assert.deepEqual(staleAnswer.body.current, { version: 3, body: "Version three.", parts: null });
  assert.equal(stale.outbox.length, 0);

  const empty = await call(editHandler, { method: "POST", body: { request_id: REQ(25), id: SCRIPT_ID, version: 1, body: "   " }, rules: [] });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "body");
  const badParts = await call(editHandler, { method: "POST", body: { request_id: REQ(26), id: SCRIPT_ID, version: 1, body: "ok ok", parts: [{ kind: "shout", text: "x" }] }, rules: [] });
  assert.equal(badParts.status, 400);
  assert.equal(badParts.body.field, "parts");
  const other = scriptWorld({ scripts: [scriptRow({ org_id: OTHER_ORG_ID })] });
  const notMine = await call(editHandler, { method: "POST", body: { request_id: REQ(27), id: SCRIPT_ID, version: 1, body: "x y z" }, rules: other.rules, deps: { wake: async () => ({}) } });
  assert.equal(notMine.status, 404);
  assert.equal(other.scripts.length, 1, "nothing was inserted for another company's script");
  await assertRoleGate(editHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(28), id: SCRIPT_ID, version: 1, body: "x y z" }, rules: [], deps: { wake: async () => ({}) } });
});

test("POST marketing/scripts/edit with a film key needs no staff login, saves only a script that is on that open shoot, and a bad key writes nothing", async () => {
  const secret = "f".repeat(40);
  const nowMs = WORLD_NOW.getTime();
  const key = mintFilmKey({ orgId: ORG_ID, shootId: SHOOT_ID, secret, now: () => nowMs }).token;
  const shoots = [{ id: SHOOT_ID, org_id: ORG_ID, status: "filming", root_script_ids: [ROOT_ID] }];
  const world = scriptWorld({
    scripts: [scriptRow({ status: "locked", ad_id: "91" }), scriptRow({ id: OTHER_ID, root_script_id: OTHER_ROOT, ad_id: "92", status: "locked" })],
    shoots,
  });
  const onShoot = [/^\s*SELECT 1\s+FROM ad_scripts s\s+JOIN marketing_shoots sh/, (_sql, params) => {
    const [org, shootId, scriptId] = params;
    const script = world.scripts.find((s) => s.org_id === org && s.id === scriptId);
    const shoot = shoots.find((s) => s.org_id === org && s.id === shootId);
    return script && shoot && shoot.status !== "done" && shoot.root_script_ids.includes(script.root_script_id) ? [{ "?column?": 1 }] : [];
  }];
  const deps = { filmSecret: secret, now: () => nowMs, wake: async () => ({}) };
  const run = (id, headers, requestId) => call(editHandler, {
    method: "POST", withSession: false, anonymous: true, headers, body: { request_id: requestId, id, version: 1, body: "A new line to film." },
    rules: [onShoot, ...world.rules], deps,
  });

  const ok = await run(SCRIPT_ID, { "x-shoot-film": key }, REQ(30));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.script.version, 2);
  assert.equal(world.outbox.length, 1);
  assert.equal(world.scripts[1].org_id, ORG_ID, "filed under the company the key names");
  assert.equal(dataCalls(ok).some((c) => /FROM live JOIN staff/.test(c.sql)), false, "no staff session was looked up");
  const asked = sqlCalls(ok, /JOIN marketing_shoots sh/)[0];
  assert.deepEqual(asked.params, [ORG_ID, SHOOT_ID, SCRIPT_ID]);

  const writesBefore = world.scripts.length;
  const notOnShoot = await run(OTHER_ID, { "x-shoot-film": key }, REQ(31));
  assert.equal(notOnShoot.status, 404);
  assert.match(notOnShoot.body.message, /not on this film link/);

  const forged = await run(SCRIPT_ID, { "x-shoot-film": key.slice(0, -4) + "0000" }, REQ(32));
  assert.equal(forged.status, 404);
  assert.match(forged.body.message, /did not open/);
  assert.equal(world.scripts.length, writesBefore, "a bad key writes nothing");

  const noKeyNoLogin = await call(editHandler, {
    method: "POST", anonymous: true, headers: {}, body: { request_id: REQ(33), id: SCRIPT_ID, version: 1, body: "x y z" }, rules: world.rules, deps,
  });
  assert.equal(noKeyNoLogin.status, 401, "no film key and no sign-in is refused");
});

/* ── reject ────────────────────────────────────────────────────────────────────────────────────────── */

test("POST marketing/scripts/reject marks a draft rejected by this staff member with the reason (or the default one) and queues the repo file", async () => {
  const world = scriptWorld({ scripts: [scriptRow()] });
  const wakeSeen = [];
  const result = await call(rejectHandler, {
    method: "POST", body: { request_id: REQ(40), id: SCRIPT_ID, version: 1, reason: "  Too long, and the hook is soft.  " }, rules: world.rules,
    deps: { wake: async (env) => { wakeSeen.push(env); return {}; } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.script.status, "rejected");
  assert.equal(result.body.script.rejected_reason, "Too long, and the hook is soft.");
  assert.equal(wakeSeen.length, 1, "the worker is woken so the repo file is committed");
  assert.equal(world.scripts[0].rejected_by, STAFF_ID);
  assert.equal(world.outbox.length, 1);
  assert.equal(parseScript(world.outbox[0].content).status, "rejected");
  const update = sqlCalls(result, /SET status = 'rejected'/)[0];
  assert.deepEqual(update.params, [SCRIPT_ID, STAFF_ID, "Too long, and the hook is soft."]);
  assertSqlHas(update.sql, { onlyLive: "AND archived_at IS NULL" });
  assert.equal(result.db.count("COMMIT"), 1);

  const bare = scriptWorld({ scripts: [scriptRow()] });
  const noReason = await call(rejectHandler, { method: "POST", body: { request_id: REQ(41), id: SCRIPT_ID, version: 1 }, rules: bare.rules, deps: { wake: async () => ({}) } });
  assert.equal(noReason.body.script.rejected_reason, "rejected from the app, no reason given");
});

test("POST marketing/scripts/reject refuses a script that is not a draft, a stale version and another company's script, and only owner and admin may reject", async () => {
  const body = (n, extra = {}) => ({ request_id: REQ(n), id: SCRIPT_ID, version: 1, ...extra });
  const locked = scriptWorld({ scripts: [scriptRow({ status: "locked", ad_id: "91" })] });
  const lockedAnswer = await call(rejectHandler, { method: "POST", body: body(42), rules: locked.rules, deps: { wake: async () => ({}) } });
  assert.equal(lockedAnswer.status, 400);
  assert.match(lockedAnswer.body.message, /Only a draft can be rejected/);
  assert.equal(locked.scripts[0].status, "locked");
  assert.equal(locked.outbox.length, 0);

  const stale = scriptWorld({ scripts: [scriptRow({ version: 2 })] });
  const staleAnswer = await call(rejectHandler, { method: "POST", body: body(43), rules: stale.rules, deps: { wake: async () => ({}) } });
  assert.equal(staleAnswer.status, 409);
  assert.equal(stale.scripts[0].status, "draft");

  const other = scriptWorld({ scripts: [scriptRow({ org_id: OTHER_ORG_ID })] });
  const otherAnswer = await call(rejectHandler, { method: "POST", body: body(44), rules: other.rules, deps: { wake: async () => ({}) } });
  assert.equal(otherAnswer.status, 404);
  assert.equal(other.scripts[0].status, "draft");

  const longReason = await call(rejectHandler, { method: "POST", body: body(45, { reason: "x".repeat(2001) }), rules: [] });
  assert.equal(longReason.status, 400);
  assert.equal(longReason.body.field, "reason");
  await assertRoleGate(rejectHandler, ["owner", "admin"], { method: "POST", body: body(46), rules: [], deps: { wake: async () => ({}) } });
});

/* ── film order ────────────────────────────────────────────────────────────────────────────────────── */

test("POST marketing/scripts/order sets film order first = 1 on the live version of each named script of this company and leaves the others alone", async () => {
  const third = "a5000000-0000-4000-8000-000000000003";
  const thirdRoot = "a5000000-0000-4000-8000-0000000000f2";
  const world = scriptWorld({
    scripts: [
      scriptRow({ film_order: 7 }),
      scriptRow({ id: OTHER_ID, root_script_id: OTHER_ROOT, film_order: 8 }),
      scriptRow({ id: third, root_script_id: thirdRoot, film_order: 9 }),
      scriptRow({ id: "a5000000-0000-4000-8000-0000000000e1", org_id: OTHER_ORG_ID, root_script_id: "a5000000-0000-4000-8000-0000000000e0", film_order: 3 }),
    ],
  });
  const result = await call(orderHandler, { method: "POST", body: { request_id: REQ(50), order: [OTHER_ROOT, ROOT_ID.toUpperCase()] }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.deepEqual(world.orderWrite, { org: ORG_ID, order: [OTHER_ROOT, ROOT_ID] }, "lower-cased, in the order sent, for the session's company");
  assert.equal(world.scripts[1].film_order, 1);
  assert.equal(world.scripts[0].film_order, 2);
  assert.equal(world.scripts[2].film_order, 9, "a script not in the list keeps its order");
  assert.equal(world.scripts[3].film_order, 3, "another company's script is never touched");
  const write = sqlCalls(result, /UPDATE ad_scripts s SET film_order/)[0];
  assertSqlHas(write.sql, { company: "WHERE s.org_id = $1", liveOnly: "s.archived_at IS NULL" });
  const found = sqlCalls(result, /SELECT s\.root_script_id/)[0];
  assertSqlHas(found.sql, { company: "WHERE s.org_id = $1", live: "s.archived_at IS NULL", visible: "s.source <> 'import'", lock: "FOR UPDATE OF s" });
});

test("POST marketing/scripts/order refuses a list with a script this company cannot see, a repeated script and a non-uuid, and writes nothing", async () => {
  const world = scriptWorld({ scripts: [scriptRow({ film_order: 4 })] });
  const unknown = await call(orderHandler, { method: "POST", body: { request_id: REQ(51), order: [ROOT_ID, OTHER_ROOT] }, rules: world.rules });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.field, "order");
  assert.match(unknown.body.message, /not found/);
  assert.equal(world.scripts[0].film_order, 4);
  assert.equal(world.orderWrite, undefined);

  const twice = await call(orderHandler, { method: "POST", body: { request_id: REQ(52), order: [ROOT_ID, ROOT_ID] }, rules: world.rules });
  assert.equal(twice.status, 400);
  assert.match(twice.body.message, /twice/);
  const notUuid = await call(orderHandler, { method: "POST", body: { request_id: REQ(53), order: ["nope"] }, rules: world.rules });
  assert.equal(notUuid.status, 400);
  const notList = await call(orderHandler, { method: "POST", body: { request_id: REQ(54), order: "x" }, rules: world.rules });
  assert.equal(notList.status, 400);

  const imported = scriptWorld({ scripts: [scriptRow({ source: "import" })] });
  const importedAnswer = await call(orderHandler, { method: "POST", body: { request_id: REQ(55), order: [ROOT_ID] }, rules: imported.rules });
  assert.equal(importedAnswer.status, 400, "an imported script is not on the film order");
  await assertRoleGate(orderHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(56), order: [ROOT_ID] }, rules: [] });
});

/* ── the Fix button ────────────────────────────────────────────────────────────────────────────────── */

test("POST marketing/scripts/fix queues one rewrite job from the note word for word, adds the rule through the outbox only when asked, and wakes the worker", async () => {
  const world = scriptWorld({ scripts: [scriptRow()] });
  const { seen, wake } = wakes();
  const note = "Open with the cause.\nNo greeting.";
  const result = await call(fixHandler, {
    method: "POST", body: { request_id: REQ(60), id: SCRIPT_ID, version: 1, note, make_rule: false }, rules: world.rules, deps: { wake, env: {} },
  });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { queued: true, job_id: world.jobs[0].id });
  assert.equal(world.jobs.length, 1);
  assert.equal(world.jobs[0].kind, "fix_script");
  assert.equal(world.jobs[0].org_id, ORG_ID);
  assert.deepEqual(world.jobs[0].payload, { script_id: SCRIPT_ID, version: 1, note }, "the note goes to the writer exactly as typed");
  assert.equal(world.outbox.length, 0, "no rule unless Make this a rule was ticked");
  assert.equal(seen.length, 1);

  const withRule = scriptWorld({ scripts: [scriptRow()] });
  const ruled = await call(fixHandler, {
    method: "POST", body: { request_id: REQ(61), id: SCRIPT_ID, version: 1, note: "Never open with a greeting.", make_rule: true }, rules: withRule.rules, deps: { wake: async () => ({}), env: {} },
  });
  assert.equal(ruled.status, 202);
  assert.equal(withRule.jobs.length, 1);
  assert.equal(withRule.outbox.length, 1);
  assert.equal(withRule.outbox[0].path, "marketing/ads/RULES.md");
  assert.deepEqual(withRule.outbox[0].edit, { op: "part0_add_rule", text: "Never open with a greeting." });
  assert.equal(withRule.outbox[0].org_id, ORG_ID);
  const lookup = sqlCalls(ruled, /FROM ad_scripts WHERE id = \$1 AND org_id = \$2/)[0];
  assert.deepEqual(lookup.params, [SCRIPT_ID, ORG_ID]);
  assertSqlHas(sqlCalls(ruled, /WHERE root_script_id = \$1 AND org_id = \$2 AND archived_at IS NULL/)[0].sql, { live: "archived_at IS NULL" });

  const repeat = await call(fixHandler, {
    method: "POST", body: { request_id: REQ(61), id: SCRIPT_ID, version: 1, note: "Never open with a greeting.", make_rule: true }, rules: withRule.rules, deps: { wake: async () => ({}), env: {} },
  });
  assert.equal(repeat.status, 202);
  assert.deepEqual(repeat.body, ruled.body);
  assert.equal(withRule.jobs.length, 1, "a repeated request_id queues nothing");
});

test("POST marketing/scripts/fix refuses a stale version, a missing or retired script, another company's script, an empty or oversize note and a non-boolean make_rule", async () => {
  const base = { request_id: REQ(62), id: SCRIPT_ID, version: 1, note: "Fix the hook.", make_rule: false };
  const run = (world, body) => call(fixHandler, { method: "POST", body, rules: world.rules, deps: { wake: async () => ({}), env: {} } });

  const stale = scriptWorld({ scripts: [scriptRow({ id: OTHER_ID, version: 2, body: "Newer." }), scriptRow({ archived_at: WORLD_NOW, status: "superseded" })] });
  const staleAnswer = await run(stale, base);
  assert.equal(staleAnswer.status, 409);
  assert.deepEqual(staleAnswer.body.current, { version: 2, body: "Newer.", parts: null });
  assert.equal(stale.jobs.length, 0);

  const missing = await run(scriptWorld({ scripts: [] }), { ...base, request_id: REQ(63) });
  assert.equal(missing.status, 404);
  const other = scriptWorld({ scripts: [scriptRow({ org_id: OTHER_ORG_ID })] });
  const otherAnswer = await run(other, { ...base, request_id: REQ(64) });
  assert.equal(otherAnswer.status, 404);
  assert.equal(other.jobs.length, 0);

  const retired = scriptWorld({ scripts: [scriptRow({ archived_at: WORLD_NOW, status: "superseded" })] });
  const retiredAnswer = await run(retired, { ...base, request_id: REQ(65) });
  assert.equal(retiredAnswer.status, 404);
  assert.match(retiredAnswer.body.message, /retired/);

  const empty = await run(scriptWorld({ scripts: [scriptRow()] }), { ...base, request_id: REQ(66), note: "  " });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "note");
  const long = await run(scriptWorld({ scripts: [scriptRow()] }), { ...base, request_id: REQ(67), note: "x".repeat(4001) });
  assert.equal(long.status, 400);
  assert.equal(long.body.field, "note");
  const ruleLong = await run(scriptWorld({ scripts: [scriptRow()] }), { ...base, request_id: REQ(68), note: "x".repeat(1001), make_rule: true });
  assert.equal(ruleLong.status, 400);
  assert.match(ruleLong.body.message, /saved as a rule/);
  const notBool = await run(scriptWorld({ scripts: [scriptRow()] }), { ...base, request_id: REQ(69), make_rule: "yes" });
  assert.equal(notBool.status, 400);
  assert.equal(notBool.body.field, "make_rule");
  await assertRoleGate(fixHandler, ["owner", "admin"], { method: "POST", body: { ...base, request_id: REQ(70) }, rules: [], deps: { wake: async () => ({}), env: {} } });
});
