// S5 route proofs: the staff-people doors (logins, roles, shifts, consent,
// telemetry, demo switch). Each case runs the REAL api/ handler against a
// stand-in database and judges the exact result the control promises.

import assert from "node:assert/strict";
import test from "node:test";

import suspendHandler from "../../../../api/auth/suspend.mjs";
import staffRoleHandler from "../../../../api/auth/staff-role.mjs";
import staffUpdateHandler from "../../../../api/auth/staff-update.mjs";
import inviteHandler from "../../../../api/auth/invite.mjs";
import adminResetHandler from "../../../../api/auth/admin-reset.mjs";
import authorizedRepHandler from "../../../../api/auth/authorized-rep.mjs";
import consentHandler from "../../../../api/staff/monitoring-consent.mjs";
import telemetryHandler from "../../../../api/staff/telemetry.mjs";
import shiftsHandler from "../../../../api/shifts.mjs";
import peersHandler from "../../../../api/chat/peers.mjs";
import demoModeHandler from "../../../../api/demo/mode.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { STAFF_ID } from "../../../testing/handler-harness.mjs";
import { ORG_ID, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs";
const log = exerciseLog(THIS_FILE);
const TARGET = "5b000000-0000-4000-8000-0000000000a1";
const CLIENT = "c1000000-0000-4000-8000-0000000000c1";

test("auth/suspend turns off one login, kills its sessions, and refuses self and non-admins", async () => {
  assert.equal(ROUTES["auth/suspend"], suspendHandler);
  const rules = [
    [/UPDATE staff SET status = 'suspended'/, [{ id: TARGET, email: "pat.target@example.test", status: "suspended" }]],
    [/UPDATE sessions SET revoked_at/, [{ id: "s-1" }, { id: "s-2" }, { id: "s-3" }]],
  ];
  const done = await hit(suspendHandler, { method: "POST", body: { staff_id: TARGET }, role: "admin", rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, {
    ok: true,
    staff: { id: TARGET, email: "pat.target@example.test", status: "suspended" },
    sessionsRevoked: 3,
  });
  assert.deepEqual(sqlCalls(done, /UPDATE staff SET status = 'suspended'/)[0].params, [TARGET, ORG_ID]);
  assert.deepEqual(sqlCalls(done, /UPDATE sessions SET revoked_at/)[0].params, [TARGET, null]);

  const self = await hit(suspendHandler, { method: "POST", body: { staff_id: STAFF_ID }, rules });
  assert.equal(self.status, 400);
  assert.equal(self.body.error, "cannot_suspend_self");
  assert.equal(sqlCalls(self, /UPDATE staff/).length, 0);

  const closer = await hit(suspendHandler, { method: "POST", body: { staff_id: TARGET }, role: "closer", rules });
  assert.equal(closer.status, 403);
  assert.equal(sqlCalls(closer, /UPDATE staff/).length, 0);

  const otherCompany = await hit(suspendHandler, { method: "POST", body: { staff_id: TARGET }, rules: [] });
  assert.equal(otherCompany.status, 404);
  assert.equal(otherCompany.body.error, "staff_not_found");
  assert.equal(sqlCalls(otherCompany, /UPDATE sessions SET revoked_at/).length, 0);
  log.mark("auth-suspend");
});

test("auth/staff-role changes one job inside the company and never mints or rewrites an owner", async () => {
  assert.equal(ROUTES["auth/staff-role"], staffRoleHandler);
  const rules = [
    [/SELECT id, role FROM staff WHERE id/, [{ id: TARGET, role: "setter" }]],
    [/UPDATE staff SET role = \$2/, [{ id: TARGET, email: "pat.target@fundhub.ai", name: "Pat Target", role: "closer", status: "active" }]],
  ];
  const done = await hit(staffRoleHandler, { method: "POST", body: { staff_id: TARGET, role: "Closer" }, rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.staff, { id: TARGET, email: "pat.target@fundhub.ai", name: "Pat Target", role: "closer", status: "active" });
  assert.deepEqual(sqlCalls(done, /UPDATE staff SET role/)[0].params, [TARGET, "closer", ORG_ID]);

  const mint = await hit(staffRoleHandler, { method: "POST", body: { staff_id: TARGET, role: "owner" }, rules });
  assert.equal(mint.status, 400);
  assert.equal(mint.body.error, "cannot_assign_owner");
  assert.equal(sqlCalls(mint, /UPDATE staff SET role/).length, 0);

  const ownerRow = [
    [/SELECT id, role FROM staff WHERE id/, [{ id: TARGET, role: "owner" }]],
    rules[1],
  ];
  const rewrite = await hit(staffRoleHandler, { method: "POST", body: { staff_id: TARGET, role: "closer" }, rules: ownerRow });
  assert.equal(rewrite.status, 400);
  assert.equal(rewrite.body.error, "cannot_change_owner");
  assert.equal(sqlCalls(rewrite, /UPDATE staff SET role/).length, 0);

  const closer = await hit(staffRoleHandler, { method: "POST", body: { staff_id: TARGET, role: "setter" }, role: "closer", rules });
  assert.equal(closer.status, 403);
  log.mark("auth-staff-role");
});

test("auth/staff-update saves a clean profile, refuses a taken email and an owner rename", async () => {
  assert.equal(ROUTES["auth/staff-update"], staffUpdateHandler);
  const saved = { id: TARGET, email: "pat.target@fundhub.ai", name: "Pat Target", role: "closer", status: "active", phone: "602-555-0100", start_date: "2026-10-01", employee_code: "E-014", notify_booked_call_sms: true };
  const base = [
    [/SELECT id, role, email, name FROM staff WHERE id/, [{ id: TARGET, role: "closer", email: "old.pat@fundhub.ai", name: "Old Pat" }]],
    [/UPDATE staff\s+SET name = \$2/, [saved]],
  ];
  const body = { staff_id: TARGET, name: "  Pat Target ", email: "PAT.Target@Fundhub.ai", phone: "602-555-0100", start_date: "2026-10-01", notify_booked_call_sms: true };
  const done = await hit(staffUpdateHandler, { method: "POST", body, rules: base });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.staff, saved);
  assert.deepEqual(
    sqlCalls(done, /UPDATE staff\s+SET name = \$2/)[0].params,
    [TARGET, "Pat Target", "pat.target@fundhub.ai", "602-555-0100", "2026-10-01", ORG_ID, true],
  );

  const taken = await hit(staffUpdateHandler, { method: "POST", body, rules: [[/lower\(email\) = \$2 AND id <> \$3/, [{ id: "someone-else" }]], ...base] });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error, "email_taken");
  assert.equal(sqlCalls(taken, /UPDATE staff\s+SET name/).length, 0);

  const ownerRules = [[/SELECT id, role, email, name FROM staff WHERE id/, [{ id: TARGET, role: "owner", email: "old.pat@fundhub.ai", name: "Old Pat" }]], base[1]];
  const ownerRename = await hit(staffUpdateHandler, { method: "POST", body, rules: ownerRules });
  assert.equal(ownerRename.status, 400);
  assert.equal(ownerRename.body.error, "cannot_change_owner");

  const badDate = await hit(staffUpdateHandler, { method: "POST", body: { ...body, start_date: "10/01/2026" }, rules: base });
  assert.equal(badDate.status, 400);
  assert.equal(badDate.body.error, "start_date_invalid");
  log.mark("auth-staff-update");
});

test("auth/invite makes a new login with a company address and a 7 day hashed link", async () => {
  assert.equal(ROUTES["auth/invite"], inviteHandler);
  const rules = [
    [/SELECT lower\(email\) AS email FROM staff WHERE org_id/, [{ email: "sam.rivera@fundhub.ai" }]],
    [/INSERT INTO staff \(org_id, name, role, email, status\)/, (sql, params) => [
      { id: TARGET, email: params[3], name: params[1], role: params[2], status: "invited" },
    ]],
  ];
  const before = Date.now();
  const done = await hit(inviteHandler, { method: "POST", body: { name: "Sam Rivera", role: "closer" }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.email, "sam.rivera2@fundhub.ai", "the first address was taken, so the next free one is used");
  assert.deepEqual(done.body.staff, { id: TARGET, email: "sam.rivera2@fundhub.ai", name: "Sam Rivera", role: "closer", status: "invited" });
  assert.equal(done.body.mailed, false);
  assert.equal(done.body.invitePath, `/reset-password.html?token=${encodeURIComponent(done.body.token)}`);
  assert.deepEqual(sqlCalls(done, /INSERT INTO staff/)[0].params, [ORG_ID, "Sam Rivera", "closer", "sam.rivera2@fundhub.ai"]);
  const stored = sqlCalls(done, /INSERT INTO password_resets/)[0].params;
  assert.equal(stored[1], TARGET);
  assert.match(stored[2], /^[0-9a-f]{64}$/);
  assert.notEqual(stored[2], done.body.token, "only a hash of the link token is stored");
  const lifetime = new Date(stored[3]).getTime() - before;
  assert.ok(Math.abs(lifetime - 7 * 24 * 3600e3) < 60e3, `link lifetime ${lifetime} ms is not 7 days`);

  const owner = await hit(inviteHandler, { method: "POST", body: { name: "Sam Rivera", role: "owner" }, rules });
  assert.equal(owner.status, 400);
  assert.equal(owner.body.error, "cannot_invite_owner");
  assert.equal(sqlCalls(owner, /INSERT INTO staff/).length, 0);
  log.mark("auth-invite");
});

test("auth/admin-reset hands the admin a 1 hour link and refuses a suspended login", async () => {
  assert.equal(ROUTES["auth/admin-reset"], adminResetHandler);
  const active = [[/SELECT id, status FROM staff WHERE org_id = \$1 AND lower\(email\)/, [{ id: TARGET, status: "active" }]]];
  const before = Date.now();
  const done = await hit(adminResetHandler, { method: "POST", body: { email: "Pat.Target@Fundhub.ai" }, rules: active });
  assert.equal(done.status, 200);
  assert.equal(done.body.resetPath, `/reset-password.html?token=${encodeURIComponent(done.body.token)}`);
  assert.deepEqual(sqlCalls(done, /SELECT id, status FROM staff/)[0].params, [ORG_ID, "pat.target@fundhub.ai"]);
  const stored = sqlCalls(done, /INSERT INTO password_resets/)[0].params;
  assert.equal(stored[1], TARGET);
  assert.notEqual(stored[2], done.body.token);
  const lifetime = new Date(done.body.expiresAt).getTime() - before;
  assert.ok(Math.abs(lifetime - 3600e3) < 60e3, `reset lifetime ${lifetime} ms is not 1 hour`);

  const suspended = await hit(adminResetHandler, {
    method: "POST", body: { email: "pat.target@fundhub.ai" },
    rules: [[/SELECT id, status FROM staff WHERE org_id/, [{ id: TARGET, status: "suspended" }]]],
  });
  assert.equal(suspended.status, 404);
  assert.equal(suspended.body.error, "staff_not_found_or_suspended");
  assert.equal(sqlCalls(suspended, /INSERT INTO password_resets/).length, 0);

  const closer = await hit(adminResetHandler, { method: "POST", body: { email: "pat.target@fundhub.ai" }, role: "closer", rules: active });
  assert.equal(closer.status, 403);
  log.mark("auth-admin-reset");
});

test("auth/authorized-rep reads the live rep's name, email and phone for one client in this company", async () => {
  assert.equal(ROUTES["auth/authorized-rep"], authorizedRepHandler);
  const rules = [
    [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
    [/FROM client_authorized_reps r/, [{ account_id: "acct-rep-1", email: "dana.rep@example.test", phone: "+16025550111", name: "Dana Rep" }]],
  ];
  const done = await hit(authorizedRepHandler, { query: { client_id: CLIENT }, rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, rep: { name: "Dana Rep", email: "dana.rep@example.test", phone: "+16025550111" } });
  assert.deepEqual(sqlCalls(done, /FROM clients WHERE id/)[0].params, [CLIENT, ORG_ID]);
  assert.deepEqual(sqlCalls(done, /FROM client_authorized_reps/)[0].params, [CLIENT]);

  const noRep = await hit(authorizedRepHandler, { query: { client_id: CLIENT }, rules: [rules[0]] });
  assert.deepEqual(noRep.body, { ok: true, rep: null });

  const otherCompany = await hit(authorizedRepHandler, { query: { client_id: CLIENT }, rules: [] });
  assert.equal(otherCompany.status, 404);
  assert.equal(sqlCalls(otherCompany, /client_authorized_reps/).length, 0);

  const badId = await hit(authorizedRepHandler, { query: { client_id: "not-a-uuid" }, rules });
  assert.equal(badId.status, 400);
  const setter = await hit(authorizedRepHandler, { query: { client_id: CLIENT }, role: "setter", rules });
  assert.equal(setter.status, 403);
  log.mark("auth-authorized-rep");
});

test("staff/monitoring-consent lets only the owner grant or revoke, and reports the on or off state", async () => {
  assert.equal(ROUTES["staff/monitoring-consent"], consentHandler);
  const row = (at) => ({ id: TARGET, org_id: ORG_ID, name: "Pat Target", email: "pat.target@fundhub.ai", role: "closer", status: "active", monitoring_consent_at: at, hubstaff_user_id: "hs-9" });
  const grant = await hit(consentHandler, {
    method: "POST", body: { staff_id: TARGET, action: "grant" },
    rules: [[/SET monitoring_consent_at = now\(\)/, [row("2026-10-13T16:00:00.000Z")]]],
  });
  assert.equal(grant.status, 200);
  assert.deepEqual(grant.body, {
    ok: true, action: "grant", form_version: "2026-08-04",
    staff: { id: TARGET, name: "Pat Target", email: "pat.target@fundhub.ai", monitoring_consent_at: "2026-10-13T16:00:00.000Z", monitoring_on: true },
  });
  assert.deepEqual(sqlCalls(grant, /SET monitoring_consent_at = now\(\)/)[0].params, [TARGET, ORG_ID]);

  const revoke = await hit(consentHandler, {
    method: "POST", body: { staff_id: TARGET, action: "revoke" },
    rules: [[/SET monitoring_consent_at = NULL/, [row(null)]]],
  });
  assert.equal(revoke.body.staff.monitoring_on, false);
  assert.equal(revoke.body.staff.monitoring_consent_at, null);
  assert.equal(revoke.body.action, "revoke");

  const admin = await hit(consentHandler, { method: "POST", body: { staff_id: TARGET, action: "grant" }, role: "admin", rules: [] });
  assert.equal(admin.status, 403);
  assert.equal(sqlCalls(admin, /monitoring_consent_at/).length, 0);
  const odd = await hit(consentHandler, { method: "POST", body: { staff_id: TARGET, action: "delete" }, rules: [] });
  assert.equal(odd.status, 400);
  log.mark("staff-monitoring-consent");
});

test("staff/telemetry reads one person's consent, shifts and activity inside this company", async () => {
  assert.equal(ROUTES["staff/telemetry"], telemetryHandler);
  const rules = [
    [/FROM staff WHERE id = \$1::uuid AND org_id = \$2::uuid/, [{
      id: TARGET, org_id: ORG_ID, name: "Pat Target", email: "pat.target@fundhub.ai", role: "closer", status: "active",
      monitoring_consent_at: "2026-10-01T12:00:00.000Z", hubstaff_user_id: "hs-9", created_at: "2026-09-01T00:00:00.000Z",
    }]],
    [/FROM shifts\s+WHERE staff_id = \$1::uuid/, [
      { id: "shift-2", started_at: "2026-10-13T15:00:00.000Z", ended_at: null, closed_by: null },
      { id: "shift-1", started_at: "2026-10-12T15:00:00.000Z", ended_at: "2026-10-12T23:00:00.000Z", closed_by: "self" },
    ]],
    [/FROM staff_events/, [
      { id: "ev-1", shift_id: "shift-2", kind: "monitor_activity", detail: { overall: 80 }, created_at: "2026-10-13T16:00:00.000Z" },
      { id: "ev-2", shift_id: "shift-2", kind: "monitor_activity", detail: { overall: 60 }, created_at: "2026-10-13T16:05:00.000Z" },
      { id: "ev-3", shift_id: "shift-2", kind: "monitor_screenshot", detail: {}, created_at: "2026-10-13T16:06:00.000Z" },
    ]],
  ];
  const done = await hit(telemetryHandler, { query: { staff_id: TARGET }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.staff.monitoring_on, true);
  assert.equal("org_id" in done.body.staff, false, "the company id is not echoed");
  assert.deepEqual(done.body.shifts.map((s) => [s.id, s.open]), [["shift-2", true], ["shift-1", false]]);
  assert.equal(done.body.activity.activity_samples, 2);
  assert.equal(done.body.activity.avg_overall, 70);
  assert.equal(done.body.activity.screenshot_samples, 1);
  assert.deepEqual(sqlCalls(done, /FROM staff WHERE id/)[0].params, [TARGET, ORG_ID]);

  const unknown = await hit(telemetryHandler, { query: { staff_id: TARGET }, rules: [] });
  assert.equal(unknown.status, 404);
  const closer = await hit(telemetryHandler, { query: { staff_id: TARGET }, role: "closer", rules });
  assert.equal(closer.status, 403);
  log.mark("staff-telemetry");
});

test("shifts reads the caller's open shift and the roster, and clocks in and out only for the caller", async () => {
  assert.equal(ROUTES.shifts, shiftsHandler);
  const open = { id: "shift-7", org_id: ORG_ID, staff_id: STAFF_ID, started_at: "2026-10-13T15:00:00.000Z", ended_at: null };
  const mine = await hit(shiftsHandler, { rules: [[/SELECT \* FROM shifts\s+WHERE staff_id = \$1 AND ended_at IS NULL/, [open]]] });
  assert.deepEqual(mine.body, { ok: true, shift: open });
  assert.deepEqual(sqlCalls(mine, /FROM shifts/)[0].params, [STAFF_ID]);
  const none = await hit(shiftsHandler, { rules: [] });
  assert.deepEqual(none.body, { ok: true, shift: null });

  const roster = [{ shift_id: "shift-7", staff_id: STAFF_ID, started_at: open.started_at, name: "Olive Owner", role: "owner", email: "owner@example.test" }];
  const everyone = await hit(shiftsHandler, { query: { roster: "1" }, rules: [[/FROM shifts sh\s+JOIN staff s/, roster]] });
  assert.deepEqual(everyone.body, { ok: true, roster });
  assert.deepEqual(sqlCalls(everyone, /FROM shifts sh/)[0].params, [ORG_ID]);
  log.mark("shifts-read");

  const clockIn = await hit(shiftsHandler, { method: "POST", body: { action: "clock_in" }, rules: [[/INSERT INTO shifts/, [open]]] });
  assert.deepEqual(clockIn.body, { ok: true, shift: open });
  assert.deepEqual(sqlCalls(clockIn, /INSERT INTO shifts/)[0].params, [ORG_ID, STAFF_ID]);

  const already = await hit(shiftsHandler, {
    method: "POST", body: { action: "clock_in" },
    rules: [[/INSERT INTO shifts/, Object.assign(new Error("duplicate"), { code: "23505" })]],
  });
  assert.equal(already.status, 409);
  assert.equal(already.body.error, "staff member already has an open shift");

  const closed = { ...open, ended_at: "2026-10-13T23:00:00.000Z" };
  const clockOut = await hit(shiftsHandler, { method: "POST", body: { action: "clock_out" }, rules: [[/UPDATE shifts\s+SET ended_at = now\(\)/, [closed]]] });
  assert.deepEqual(clockOut.body, { ok: true, shift: closed });
  assert.deepEqual(sqlCalls(clockOut, /UPDATE shifts/)[0].params, [STAFF_ID]);
  const nothingOpen = await hit(shiftsHandler, { method: "POST", body: { action: "clock_out" }, rules: [] });
  assert.equal(nothingOpen.status, 409);

  const forged = await hit(shiftsHandler, { method: "POST", body: { action: "clock_in", staff_id: TARGET }, rules: [[/INSERT INTO shifts/, [open]]] });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, "staff_id_not_accepted");
  assert.equal(sqlCalls(forged, /INSERT INTO shifts/).length, 0, "nobody clocks in another person");
  log.mark("shifts-clock");
});

test("chat/peers lists active teammates except the caller, never demo rows", async () => {
  assert.equal(ROUTES["chat/peers"], peersHandler);
  const peers = [
    { id: TARGET, name: "Ada Admin", email: "ada.admin@fundhub.ai", role: "admin" },
    { id: "5b000000-0000-4000-8000-0000000000a2", name: "Cal Closer", email: "cal.closer@fundhub.ai", role: "closer" },
  ];
  const done = await hit(peersHandler, { role: "closer", rules: [[/FROM staff\s+WHERE org_id = \$1/, peers]] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, staff: peers });
  const [call] = sqlCalls(done, /FROM staff\s+WHERE org_id = \$1/);
  assert.deepEqual(call.params, [ORG_ID, STAFF_ID]);
  assert.match(call.sql, /status = 'active'/);
  assert.match(call.sql, /id <> \$2/);
  assert.match(call.sql, /COALESCE\(is_demo, false\) = false/);

  const signedOut = await hit(peersHandler, { anonymous: true });
  assert.equal(signedOut.status, 401);
  const partner = await hit(peersHandler, { role: "partner", rules: [] });
  assert.equal(partner.status, 403);
  log.mark("chat-peers");
});

test("demo/mode reads the switch and counts, switches off for the company, and wipes only with the confirm word", async () => {
  assert.equal(ROUTES["demo/mode"], demoModeHandler);
  const counts = { clients: 12, lenders: 4, call_outcomes: 30, sales: 5, funding_rounds: 3, tasks: 9, documents: 2, bank_accounts: 6, subscriptions: 1 };
  const read = await hit(demoModeHandler, {
    rules: [
      [/SELECT demo_mode_enabled FROM orgs/, [{ demo_mode_enabled: true }]],
      [/SELECT\s+\(SELECT count\(\*\)::int FROM clients/, [counts]],
      [/email LIKE 'demo\.client\.01@%'/, [{ id: CLIENT }]],
    ],
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.demo_mode_enabled, true);
  assert.deepEqual(read.body.counts, counts);
  assert.equal(read.body.primary_client_id, CLIENT);
  assert.deepEqual(sqlCalls(read, /SELECT demo_mode_enabled FROM orgs/)[0].params, [ORG_ID]);

  const off = await hit(demoModeHandler, {
    method: "POST", body: { enabled: false },
    rules: [[/UPDATE orgs SET demo_mode_enabled=\$2/, { rows: [{ demo_mode_enabled: false }], rowCount: 1 }]],
  });
  assert.deepEqual(off.body, { ok: true, demo_mode_enabled: false, seeded: false });
  assert.deepEqual(sqlCalls(off, /UPDATE orgs SET demo_mode_enabled=\$2/)[0].params, [ORG_ID, false]);

  const noConfirm = await hit(demoModeHandler, { method: "DELETE", body: {}, rules: [] });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirm_required");
  assert.equal(sqlCalls(noConfirm, /DELETE FROM|UPDATE orgs/).length, 0, "nothing is wiped without the confirm word");

  const wiped = await hit(demoModeHandler, { method: "DELETE", body: { confirm: "WIPE_DEMO_DATA" }, rules: [] });
  assert.equal(wiped.status, 200);
  assert.equal(wiped.body.ok, true);
  assert.deepEqual(sqlCalls(wiped, /UPDATE orgs SET demo_mode_enabled=false/)[0].params, [ORG_ID]);

  const closer = await hit(demoModeHandler, { method: "DELETE", body: { confirm: "WIPE_DEMO_DATA" }, role: "closer", rules: [] });
  assert.equal(closer.status, 403);
  assert.equal(sqlCalls(closer, /DELETE FROM|UPDATE orgs/).length, 0);
  log.mark("demo-mode");
});

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
