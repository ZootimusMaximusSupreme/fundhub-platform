// S5 route proofs: staff and partner write doors where the rule is a gate or a
// state change. Real handler, stand-in database. The proof is the exact SQL
// that ran (and that nothing ran when the gate said no), and the exact answer.

import assert from "node:assert/strict";
import test from "node:test";

import agentsHandler from "../../../../api/agents.mjs";
import creativeActionsHandler from "../../../../api/creative/actions.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ORG_ID, assertRoleGate, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-writes.test.mjs";
const log = exerciseLog(THIS_FILE);
const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const ASSET = "a1000000-0000-4000-8000-0000000000a1";

/* ── agents: promote and demote ─────────────────────────────────────────── */

const agent = (over = {}) => ({
  id: "ag-uuid", org_id: ORG_ID, code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing", channel: "sms",
  status: "shadow", runtime: null, runtime_ref: null, runtime_notes: null, owner_label: "Sarah Whitfield",
  prompt: "p".repeat(60), guardrails: { block: "g".repeat(20) }, went_live_at: null, retired_at: null, sort_order: 30, ...over,
});

const agentRules = (current, status) => [
  [/FROM agents\s+WHERE org_id = \$1::uuid AND code = \$2/, [current]],
  [/UPDATE agents SET\s+status = '(live|shadow)'/, (sql, params) => [{ ...current, status, runtime: params[2], runtime_notes: params[3] }]],
];

test("agents promote goes live only with a 60 character prompt and a real guardrail block, and demote flips back to shadow", async () => {
  assert.equal(ROUTES.agents, agentsHandler);

  const ok = await hit(agentsHandler, { method: "POST", body: { action: "promote", code: "ag-01" }, rules: agentRules(agent(), "live") });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.action, "promote");
  assert.equal(ok.body.agent.status, "live");
  assert.equal(ok.body.agent.runtime, "internal", "a missing runtime is filled in on promote");
  const [update] = sqlCalls(ok, /UPDATE agents SET\s+status = 'live'/);
  assert.deepEqual(update.params.slice(0, 3), [ORG_ID, "AG-01", "internal"]);
  assert.match(update.sql, /WHERE org_id = \$1::uuid AND code = \$2/, "only this company's agent is flipped");

  const twoKeys = await hit(agentsHandler, {
    method: "POST", body: { action: "promote", code: "AG-01" },
    rules: agentRules(agent({ guardrails: { block: "short", triggers: ["lead.created"] } }), "live"),
  });
  assert.equal(twoKeys.status, 200, "a block under 20 characters still passes when the guardrails hold more than one key");

  const blocked = [
    ["a 59 character prompt", agent({ prompt: "p".repeat(59) })],
    ["no prompt", agent({ prompt: null })],
    ["no guardrails", agent({ guardrails: {} })],
    ["one short guardrail line", agent({ guardrails: { block: "too short" } })],
  ];
  for (const [label, current] of blocked) {
    const refused = await hit(agentsHandler, { method: "POST", body: { action: "promote", code: "AG-01" }, rules: agentRules(current, "live") });
    assert.equal(refused.status, 409, label);
    assert.equal(refused.body.error, "promotion_blocked", label);
    assert.equal(sqlCalls(refused, /UPDATE agents/).length, 0, `${label}: the agent is not written`);
  }

  const live = agent({ status: "live", runtime: "internal", runtime_notes: "kept" });
  const back = await hit(agentsHandler, { method: "POST", body: { action: "demote", code: "AG-01" }, rules: agentRules(live, "shadow") });
  assert.equal(back.status, 200);
  assert.equal(back.body.action, "demote");
  assert.equal(back.body.agent.status, "shadow");
  const [demote] = sqlCalls(back, /UPDATE agents SET\s+status = 'shadow'/);
  assert.deepEqual(demote.params, [ORG_ID, "AG-01", "internal", "kept"]);
  assert.match(demote.sql, /WHERE org_id = \$1::uuid AND code = \$2/, "only this company's agent is flipped back");

  const retired = await hit(agentsHandler, { method: "POST", body: { action: "promote", code: "AG-01" }, rules: agentRules(agent({ status: "retired" }), "live") });
  assert.equal(retired.status, 409);
  assert.equal(retired.body.error, "retired");
  const otherCompany = await hit(agentsHandler, { method: "POST", body: { action: "demote", code: "AG-01" }, rules: [] });
  assert.equal(otherCompany.status, 404);
  const partner = await hit(agentsHandler, { method: "POST", body: { action: "promote", code: "AG-01" }, role: "partner", rules: agentRules(agent(), "live") });
  assert.equal(partner.status, 403);
  log.mark("agents-promote-demote");
});

/* ── creative/actions: approve, reject, archive ─────────────────────────── */

const asset = (over = {}) => ({ id: ASSET, partner_id: PARTNER, kind: "video", compliance_state: "blocked", blocked_reasons: [{ code: "claims" }], archived_at: null, ...over });
const partnerAccount = { kind: "partner", partnerId: PARTNER };

test("creative/actions approve clears the blocked reasons, reject records why, archive hides it, all for the signed-in partner only", async () => {
  assert.equal(ROUTES["creative/actions"], creativeActionsHandler);
  const find = [/SELECT \* FROM creative_assets WHERE id = \$1 AND partner_id = \$2/, [asset()]];

  const approve = await hit(creativeActionsHandler, {
    method: "POST", account: partnerAccount, body: { action: "approve", asset_id: ASSET, partner_id: OTHER_PARTNER },
    rules: [find, [/SET compliance_state = 'approved', blocked_reasons = '\[\]'::jsonb/, [asset({ compliance_state: "approved", blocked_reasons: [] })]]],
  });
  assert.equal(approve.status, 200);
  assert.deepEqual(approve.body, { ok: true, action: "approve", asset: asset({ compliance_state: "approved", blocked_reasons: [] }) });
  assert.deepEqual(sqlCalls(approve, /SELECT \* FROM creative_assets/)[0].params, [ASSET, PARTNER], "a partner_id in the body is ignored");
  assert.deepEqual(sqlCalls(approve, /SET compliance_state = 'approved'/)[0].params, [ASSET, PARTNER]);
  assert.match(sqlCalls(approve, /SELECT \* FROM creative_assets/)[0].sql, /WHERE id = \$1 AND partner_id = \$2/);
  assert.match(sqlCalls(approve, /SET compliance_state = 'approved'/)[0].sql, /WHERE id = \$1 AND partner_id = \$2/, "only the signed-in partner's asset is approved");

  const archivedAsset = await hit(creativeActionsHandler, {
    method: "POST", account: partnerAccount, body: { action: "approve", asset_id: ASSET },
    rules: [[find[0], [asset({ archived_at: "2026-10-01T00:00:00.000Z" })]]],
  });
  assert.equal(archivedAsset.status, 400);
  assert.equal(archivedAsset.body.error, "archived assets cannot be approved");
  assert.equal(sqlCalls(archivedAsset, /SET compliance_state/).length, 0);

  const reject = await hit(creativeActionsHandler, {
    method: "POST", account: partnerAccount, body: { action: "reject", asset_id: ASSET, reason: "Makes an income claim" },
    rules: [find, [/SET compliance_state = 'blocked', blocked_reasons = \$3::jsonb/, [asset({ compliance_state: "blocked" })]]],
  });
  assert.equal(reject.status, 200);
  const [rejectCall] = sqlCalls(reject, /SET compliance_state = 'blocked'/);
  assert.deepEqual(JSON.parse(rejectCall.params[2]), [{ code: "human_reject", rule_set: "approval", message: "Makes an income claim" }]);
  assert.match(rejectCall.sql, /WHERE id = \$1 AND partner_id = \$2 AND archived_at IS NULL/, "only the signed-in partner's live asset is rejected");

  const archive = await hit(creativeActionsHandler, {
    method: "POST", account: partnerAccount, body: { action: "archive", asset_id: ASSET },
    rules: [find, [/SET archived_at = now\(\)/, [asset({ archived_at: "2026-10-13T00:00:00.000Z" })]]],
  });
  assert.equal(archive.body.asset.archived_at, "2026-10-13T00:00:00.000Z");
  assert.deepEqual(sqlCalls(archive, /SET archived_at = now\(\)/)[0].params, [ASSET, PARTNER]);
  assert.match(sqlCalls(archive, /SET archived_at = now\(\)/)[0].sql, /WHERE id = \$1 AND partner_id = \$2 AND archived_at IS NULL/);

  const unknown = await hit(creativeActionsHandler, { method: "POST", account: partnerAccount, body: { action: "delete", asset_id: ASSET }, rules: [find] });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body.allowed, ["approve", "reject", "archive"]);
  const missing = await hit(creativeActionsHandler, { method: "POST", account: partnerAccount, body: { action: "approve", asset_id: ASSET }, rules: [] });
  assert.equal(missing.status, 404);
  const staffNoPartner = await hit(creativeActionsHandler, { method: "POST", body: { action: "approve", asset_id: ASSET }, rules: [find] });
  assert.equal(staffNoPartner.status, 400);
  assert.equal(staffNoPartner.body.error, "partner_id_required");
  const get = await hit(creativeActionsHandler, { method: "GET", account: partnerAccount, rules: [] });
  assert.equal(get.status, 405);
  log.mark("creative-actions");
});

// Agents: the whole floor may use the screen today (ROLE_SETS.STAFF); a partner or client may not.
test("agents lets in exactly the staff roles and refuses partner and client before any data is read", async () => {
  await assertRoleGate(
    agentsHandler,
    ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"],
    { method: "POST", body: { action: "promote", code: "AG-01" }, rules: agentRules(agent(), "live") },
  );
});

// creative/actions serves a partner sign-in or a staff sign-in naming a partner. Nobody else.
test("creative/actions refuses a client or affiliate account before anything is read or written", async () => {
  for (const kind of ["client", "affiliate"]) {
    const refused = await hit(creativeActionsHandler, {
      method: "POST", account: { kind, clientId: kind === "client" ? ASSET : null },
      body: { action: "approve", asset_id: ASSET, partner_id: PARTNER },
      rules: [[/SELECT \* FROM creative_assets/, [asset()]]],
    });
    assert.equal(refused.status, 403, `a ${kind} account is refused`);
    assert.equal(sqlCalls(refused, /creative_assets/).length, 0);
  }
});

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
