// S5 route proofs: the staff-floor doors (monitoring consent, telemetry, shifts,
// chat peers, demo switch). Each case runs the REAL api/ handler against a
// stand-in database and judges the exact result the control promises.

import assert from "node:assert/strict";
import test from "node:test";

import consentHandler from "../../../../api/staff/monitoring-consent.mjs";
import telemetryHandler from "../../../../api/staff/telemetry.mjs";
import shiftsHandler from "../../../../api/shifts.mjs";
import peersHandler from "../../../../api/chat/peers.mjs";
import demoModeHandler from "../../../../api/demo/mode.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { OTHER_ORG_ID, STAFF_ID } from "../../../testing/handler-harness.mjs";
import { ORG_ID, assertRoleGate, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-staff-floor.test.mjs";
const log = exerciseLog(THIS_FILE);
const TARGET = "5b000000-0000-4000-8000-0000000000a1";
const CLIENT = "c1000000-0000-4000-8000-0000000000c1";
const PARTNER = "9a000000-0000-4000-8000-000000000001";

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
  assert.match(sqlCalls(grant, /SET monitoring_consent_at = now\(\)/)[0].sql, /WHERE id = \$1::uuid AND org_id = \$2::uuid/, "only a login of the signed-in company");

  const revoke = await hit(consentHandler, {
    method: "POST", body: { staff_id: TARGET, action: "revoke" },
    rules: [[/SET monitoring_consent_at = NULL/, [row(null)]]],
  });
  assert.equal(revoke.body.staff.monitoring_on, false);
  assert.equal(revoke.body.staff.monitoring_consent_at, null);
  assert.equal(revoke.body.action, "revoke");
  assert.deepEqual(sqlCalls(revoke, /SET monitoring_consent_at = NULL/)[0].params, [TARGET, ORG_ID]);
  assert.match(sqlCalls(revoke, /SET monitoring_consent_at = NULL/)[0].sql, /WHERE id = \$1::uuid AND org_id = \$2::uuid/);

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
      { id: "shift-0", started_at: "2026-10-11T15:00:00.000Z", ended_at: "2026-10-11T15:00:00.000Z", closed_by: "sweep_no_evidence" },
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
  assert.deepEqual(done.body.shifts.map((s) => [s.id, s.open]), [["shift-2", true], ["shift-1", false], ["shift-0", false]]);
  assert.deepEqual(
    done.body.hours,
    { payable_hours: 16, hours_worked: 16, needs_review_count: 1 },
    "8 logged hours, the open shift adds none yet, and the auto-closed shift is estimated at this person's own 8 hour median and flagged for review",
  );
  assert.equal(done.body.activity.activity_samples, 2);
  assert.equal(done.body.activity.avg_overall, 70);
  assert.equal(done.body.activity.screenshot_samples, 1);
  assert.deepEqual(sqlCalls(done, /FROM staff WHERE id/)[0].params, [TARGET, ORG_ID]);
  for (const table of ["staff", "shifts", "staff_events"]) {
    const [call] = sqlCalls(done, new RegExp(`FROM ${table}\\b`));
    assert.match(call.sql, /org_id = \$2::uuid/, `${table} is read for the signed-in company only`);
    assert.deepEqual(call.params.slice(0, 2), [TARGET, ORG_ID]);
  }

  const unknown = await hit(telemetryHandler, { query: { staff_id: TARGET }, rules: [] });
  assert.equal(unknown.status, 404);
  const closer = await hit(telemetryHandler, { query: { staff_id: TARGET }, role: "closer", rules });
  assert.equal(closer.status, 403);
  log.mark("staff-telemetry");
});

// A client, affiliate or partner login is not staff. It gets a 403 on every
// read and every clock, and no row of hours is read or written for it.
async function assertNoShiftsForLogins(requests) {
  const hours = [[/shifts/, [{ id: "shift-7", staff_id: STAFF_ID, started_at: "2026-10-13T15:00:00.000Z", ended_at: null }]]];
  for (const kind of ["client", "affiliate", "partner"]) {
    const account = { kind, clientId: kind === "client" ? CLIENT : null, partnerId: kind === "partner" ? PARTNER : null };
    for (const request of requests) {
      const refused = await hit(shiftsHandler, { ...request, account, rules: hours });
      assert.equal(refused.status, 403, `a ${kind} login is refused (${request.method || "GET"} ${JSON.stringify(request.query || request.body || {})})`);
      assert.equal(sqlCalls(refused, /shifts/).length, 0, `a ${kind} login touches no hours`);
    }
  }
}

test("shifts reads the caller's open shift and the roster, and clocks in and out only for the caller", async () => {
  assert.equal(ROUTES.shifts, shiftsHandler);
  const open = { id: "shift-7", org_id: ORG_ID, staff_id: STAFF_ID, started_at: "2026-10-13T15:00:00.000Z", ended_at: null };
  const mine = await hit(shiftsHandler, { rules: [[/SELECT \* FROM shifts\s+WHERE staff_id = \$1 AND ended_at IS NULL/, [open]]] });
  assert.deepEqual(mine.body, { ok: true, shift: open });
  assert.deepEqual(sqlCalls(mine, /FROM shifts/)[0].params, [STAFF_ID]);
  assert.match(sqlCalls(mine, /FROM shifts/)[0].sql, /WHERE staff_id = \$1 AND ended_at IS NULL/, "only the caller's open shift");
  const none = await hit(shiftsHandler, { rules: [] });
  assert.deepEqual(none.body, { ok: true, shift: null });

  const roster = [{ shift_id: "shift-7", staff_id: STAFF_ID, started_at: open.started_at, name: "Olive Owner", role: "owner", email: "owner@example.test" }];
  const everyone = await hit(shiftsHandler, { query: { roster: "1" }, rules: [[/FROM shifts sh\s+JOIN staff s/, roster]] });
  assert.deepEqual(everyone.body, { ok: true, roster });
  assert.deepEqual(sqlCalls(everyone, /FROM shifts sh/)[0].params, [ORG_ID]);
  assert.match(sqlCalls(everyone, /FROM shifts sh/)[0].sql, /WHERE sh\.org_id = \$1\s+AND sh\.ended_at IS NULL/, "the roster is this company's open shifts");
  await assertNoShiftsForLogins([{}, { query: { roster: "1" } }]);
  log.mark("shifts-read");

  const clockIn = await hit(shiftsHandler, { method: "POST", body: { action: "clock_in" }, rules: [[/INSERT INTO shifts/, [open]]] });
  assert.deepEqual(clockIn.body, { ok: true, shift: open });
  assert.deepEqual(sqlCalls(clockIn, /INSERT INTO shifts/)[0].params, [ORG_ID, STAFF_ID]);
  assert.match(sqlCalls(clockIn, /INSERT INTO shifts/)[0].sql, /WHERE s\.id = \$2 AND s\.org_id = \$1/, "a shift opens only for a login of this company");

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
  assert.match(sqlCalls(clockOut, /UPDATE shifts/)[0].sql, /WHERE staff_id = \$1 AND ended_at IS NULL/, "only the caller's open shift is closed");
  const nothingOpen = await hit(shiftsHandler, { method: "POST", body: { action: "clock_out" }, rules: [] });
  assert.equal(nothingOpen.status, 409);

  const forged = await hit(shiftsHandler, { method: "POST", body: { action: "clock_in", staff_id: TARGET }, rules: [[/INSERT INTO shifts/, [open]]] });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, "staff_id_not_accepted");
  assert.equal(sqlCalls(forged, /INSERT INTO shifts/).length, 0, "nobody clocks in another person");
  await assertNoShiftsForLogins([{ method: "POST", body: { action: "clock_in" } }, { method: "POST", body: { action: "clock_out" } }]);
  log.mark("shifts-clock");
});

test("chat/peers lists active teammates except the caller, never demo rows", async () => {
  assert.equal(ROUTES["chat/peers"], peersHandler);
  const peers = [
    { id: TARGET, name: "Ada Admin", email: "ada.admin@fundhub.ai", role: "admin" },
    { id: "5b000000-0000-4000-8000-0000000000a2", name: "Cal Closer", email: "cal.closer@fundhub.ai", role: "closer" },
  ];
  const mine = [{ id: "5c000000-0000-4000-8000-0000000000c1", name: "Pat Client", client_code: "FH-000900" }];
  const done = await hit(peersHandler, { role: "closer", rules: [
    [/FROM staff\s+WHERE org_id = \$1/, peers],
    [/FROM clients c\s+WHERE c\.org_id = \$1\s+AND c\.assigned_csm_staff_id = \$2/, mine],
  ] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, staff: peers, clients: mine });
  const [call] = sqlCalls(done, /FROM staff\s+WHERE org_id = \$1/);
  assert.deepEqual(call.params.slice(0, 2), [ORG_ID, STAFF_ID]);
  assert.match(call.sql, /status = 'active'/);
  assert.match(call.sql, /active IS NOT FALSE/);
  assert.match(call.sql, /id <> \$2/);
  assert.match(call.sql, /COALESCE\(is_demo, false\) = false/);
  // Only working employees: no principal kinds, no seeded role-test logins, no test-domain fixtures.
  assert.deepEqual(call.params[2], ["partner", "client", "affiliate"]);
  assert.ok(call.params[3].includes("owner@fundhub.ai") && call.params[3].includes("closer@fundhub.ai"));
  assert.ok(new RegExp(call.params[4]).test("example.com"));
  assert.ok(!new RegExp(call.params[4]).test("fundhub.ai"));
  // Clients: only the ones this person is the assigned CSM for.
  const [mineCall] = sqlCalls(done, /FROM clients c/);
  assert.deepEqual(mineCall.params.slice(0, 2), [ORG_ID, STAFF_ID]);
  assert.match(mineCall.sql, /COALESCE\(c\.is_demo, false\) = false/);
  assert.doesNotMatch(mineCall.sql, /phone|email/);

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
  assert.match(sqlCalls(read, /SELECT demo_mode_enabled FROM orgs/)[0].sql, /WHERE id=\$1/);
  assert.match(sqlCalls(read, /SELECT\s+\(SELECT count\(\*\)::int FROM clients/)[0].sql, /FROM clients WHERE org_id=\$1 AND is_demo/, "the demo counts are this company's demo rows");

  const off = await hit(demoModeHandler, {
    method: "POST", body: { enabled: false },
    rules: [[/UPDATE orgs SET demo_mode_enabled=\$2/, { rows: [{ demo_mode_enabled: false }], rowCount: 1 }]],
  });
  assert.deepEqual(off.body, { ok: true, demo_mode_enabled: false, seeded: false });
  assert.deepEqual(sqlCalls(off, /UPDATE orgs SET demo_mode_enabled=\$2/)[0].params, [ORG_ID, false]);
  assert.match(sqlCalls(off, /UPDATE orgs SET demo_mode_enabled=\$2/)[0].sql, /WHERE id=\$1/, "the switch is flipped for the signed-in company only");

  // Switching on flips the flag for this company, then looks for demo staff to seed
  // from. A company with none is told so; it is never shown a made-up "on".
  const turnedOn = await hit(demoModeHandler, {
    method: "POST", body: { enabled: true },
    rules: [[/UPDATE orgs SET demo_mode_enabled=\$2/, { rows: [{ demo_mode_enabled: true }], rowCount: 1 }]],
  });
  assert.deepEqual(sqlCalls(turnedOn, /UPDATE orgs SET demo_mode_enabled=\$2/)[0].params, [ORG_ID, true]);
  const seedLookup = sqlCalls(turnedOn, /FROM staff WHERE org_id=\$1 AND is_demo/)[0];
  assert.deepEqual(seedLookup.params, [ORG_ID]);
  assert.equal(turnedOn.status, 500);
  assert.equal(turnedOn.body.error, "demo_seed_requires_demo_staff");

  // A switch that did not stick is never echoed back as if it had.
  const notStuck = await hit(demoModeHandler, { method: "POST", body: { enabled: false }, rules: [] });
  assert.equal(notStuck.status, 500);
  assert.equal(notStuck.body.error, "demo_mode_update_failed");

  const noConfirm = await hit(demoModeHandler, { method: "DELETE", body: {}, rules: [] });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirm_required");
  assert.equal(sqlCalls(noConfirm, /DELETE FROM|UPDATE orgs/).length, 0, "nothing is wiped without the confirm word");

  const wiped = await hit(demoModeHandler, { method: "DELETE", body: { confirm: "WIPE_DEMO_DATA" }, rules: [] });
  assert.equal(wiped.status, 200);
  assert.deepEqual(wiped.body, { ok: true, wiped: true, clients_removed: 0 });
  assert.deepEqual(sqlCalls(wiped, /UPDATE orgs SET demo_mode_enabled=false/)[0].params, [ORG_ID]);

  const closer = await hit(demoModeHandler, { method: "DELETE", body: { confirm: "WIPE_DEMO_DATA" }, role: "closer", rules: [] });
  assert.equal(closer.status, 403);
  assert.equal(sqlCalls(closer, /DELETE FROM|UPDATE orgs/).length, 0);
  log.mark("demo-mode");
});

// What a wipe is allowed to touch. Every statement is either bound to the
// signed-in company alone, or to the demo client ids that company's own lookup
// returned. A second company, signed in the same way, must get its own id.
const MUST_WIPE_BY_COMPANY = [
  "call_outcomes", "messages", "invoices", "sale_payments", "commission_ledger", "entitlements",
  "applications", "funding_rounds", "sales", "transactions", "tradelines", "bank_accounts", "tasks", "subscriptions",
];

for (const orgId of [ORG_ID, OTHER_ORG_ID]) {
  test(`demo/mode DELETE with the confirm word removes only demo rows of the signed-in company (${orgId.slice(0, 2)})`, async () => {
    const demoClients = [CLIENT, "c2000000-0000-4000-8000-0000000000c2"];
    const rules = [[/SELECT id FROM clients\s+WHERE org_id=\$1\s+AND is_demo/, demoClients.map((id) => ({ id }))]];
    const wiped = await hit(demoModeHandler, {
      method: "DELETE", body: { confirm: "WIPE_DEMO_DATA" }, staff: { org_id: orgId }, rules,
    });
    assert.equal(wiped.status, 200);
    assert.deepEqual(wiped.body, { ok: true, wiped: true, clients_removed: 2 });

    const [find] = sqlCalls(wiped, /SELECT id FROM clients/);
    assert.deepEqual(find.params, [orgId, "demo.fundhub.local"], "the demo clients are looked up inside the signed-in company");
    assert.match(find.sql, /AND is_demo/);
    assert.deepEqual(sqlCalls(wiped, /UPDATE orgs SET demo_mode_enabled=false/)[0].params, [orgId]);

    const deletes = wiped.db.calls.filter((call) => /^\s*DELETE FROM/.test(call.sql));
    const byCompany = deletes.filter((call) => /org_id=\$1/.test(call.sql));
    const byClient = deletes.filter((call) => /ANY\(\$1\)/.test(call.sql));
    assert.deepEqual(
      deletes.filter((call) => !byCompany.includes(call) && !byClient.includes(call)).map((call) => call.sql),
      [],
      "every delete is bound to the company or to the found demo clients, no other way",
    );
    for (const call of byCompany) {
      assert.deepEqual(call.params.slice(0, 1), [orgId], `company delete is not bound to the signed-in company: ${call.sql}`);
      assert.match(call.sql, /is_demo/, `a company delete that does not say is_demo: ${call.sql}`);
    }
    for (const call of byClient) assert.deepEqual(call.params, [demoClients], `client delete is not bound to the found demo clients: ${call.sql}`);

    const tables = new Set(byCompany.map((call) => call.sql.match(/DELETE FROM (\w+)/)[1]));
    for (const table of MUST_WIPE_BY_COMPANY) assert.ok(tables.has(table), `${table} demo rows are not removed`);

    // The last client statement is the client row itself, and only a demo one.
    const clientRow = deletes.findIndex((call) => /DELETE FROM clients WHERE id=ANY\(\$1\) AND is_demo/.test(call.sql));
    assert.ok(clientRow > 0, "the demo client rows are removed");
    const accountsRow = deletes.findIndex((call) => /DELETE FROM accounts\s+WHERE client_id=ANY\(\$1\)/.test(call.sql));
    assert.ok(accountsRow > 0 && accountsRow < clientRow, "their logins go first, then the client");
    assert.match(deletes[accountsRow].sql, /NOT LIKE '%@demo\.fundhub\.local'/, "the nine roster logins are kept");
    const partner = sqlCalls(wiped, /DELETE FROM partners/)[0];
    assert.deepEqual(partner.params, [orgId, "demo-partner-platform", "demo.fundhub.local"]);
    assert.match(partner.sql, /AND is_demo/);
  });
}

// Who may open each door. The allowed roles are written out here, not read from
// the product, so a role slipped into a gate by mistake turns this red.
const WHOLE_FLOOR = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"];
const GATES = [
  ["staff/monitoring-consent", consentHandler, ["owner"], { method: "POST", body: { staff_id: TARGET, action: "grant" } }],
  ["staff/telemetry", telemetryHandler, ["owner", "admin", "sales_manager"], { query: { staff_id: TARGET } }],
  ["chat/peers", peersHandler, WHOLE_FLOOR, {}],
  ["demo/mode", demoModeHandler, ["owner", "admin"], {}],
];

for (const [route, handler, allowed, request] of GATES) {
  test(`${route} lets in exactly ${allowed.join(", ")} and refuses every other role before any data is read`, async () => {
    await assertRoleGate(handler, allowed, request);
  });
}

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
