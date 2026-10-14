// S5 route proofs: the staff-people doors that make and change a login (suspend,
// role, profile, invite, admin reset, authorized rep). Each case runs the REAL
// api/ handler against a stand-in database and judges the exact result the
// control promises.

import assert from "node:assert/strict";
import test from "node:test";

import suspendHandler from "../../../../api/auth/suspend.mjs";
import staffRoleHandler from "../../../../api/auth/staff-role.mjs";
import staffUpdateHandler from "../../../../api/auth/staff-update.mjs";
import inviteHandler from "../../../../api/auth/invite.mjs";
import adminResetHandler from "../../../../api/auth/admin-reset.mjs";
import authorizedRepHandler from "../../../../api/auth/authorized-rep.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { STAFF_ID } from "../../../testing/handler-harness.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, companyRows, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

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
  const [suspendCall] = sqlCalls(done, /UPDATE staff SET status = 'suspended'/);
  assert.deepEqual(suspendCall.params, [TARGET, ORG_ID]);
  assert.match(suspendCall.sql, /WHERE id = \$1 AND org_id = \$2/, "only a login of the signed-in company can be turned off");
  const [revokeCall] = sqlCalls(done, /UPDATE sessions SET revoked_at/);
  assert.deepEqual(revokeCall.params, [TARGET, null]);
  assert.match(revokeCall.sql, /WHERE staff_id = \$1 AND revoked_at IS NULL/);

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
  const [roleCall] = sqlCalls(done, /UPDATE staff SET role/);
  assert.deepEqual(roleCall.params, [TARGET, "closer", ORG_ID]);
  assert.match(roleCall.sql, /WHERE id = \$1 AND org_id = \$3/, "only a login of the signed-in company changes job");
  assert.match(sqlCalls(done, /SELECT id, role FROM staff/)[0].sql, /WHERE id = \$1 AND org_id = \$2/);

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
  // The stand-in holds two companies' logins under the one id. It answers the way
  // the SQL says, so a lost company condition hands back the other company's owner.
  const LOGIN = /WHERE id = \$1 AND org_id = \$2/;
  const logins = [
    { org_id: OTHER_ORG_ID, id: TARGET, role: "owner", email: "boss@elsewhere.test", name: "Boss Elsewhere" },
    { org_id: ORG_ID, id: TARGET, role: "closer", email: "old.pat@fundhub.ai", name: "Old Pat" },
  ];
  const base = [
    [/SELECT id, role, email, name FROM staff WHERE id/, companyRows(logins, LOGIN, 1)],
    [/UPDATE staff\s+SET name = \$2/, [saved]],
  ];
  const body = { staff_id: TARGET, name: "  Pat Target ", email: "PAT.Target@Fundhub.ai", phone: "602-555-0100", start_date: "2026-10-01", notify_booked_call_sms: true };
  const done = await hit(staffUpdateHandler, { method: "POST", body, rules: base });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.staff, saved);
  const [updateCall] = sqlCalls(done, /UPDATE staff\s+SET name = \$2/);
  assert.deepEqual(updateCall.params, [TARGET, "Pat Target", "pat.target@fundhub.ai", "602-555-0100", "2026-10-01", ORG_ID, true]);
  assert.match(updateCall.sql, /WHERE id = \$1 AND org_id = \$6/, "only a login of the signed-in company is edited");
  assert.match(sqlCalls(done, /SELECT id, role, email, name FROM staff/)[0].sql, LOGIN, "only a login of the signed-in company is looked up");
  assert.match(updateCall.sql, /notify_booked_call_sms = COALESCE\(\$7, notify_booked_call_sms\)/, "the booked-call text switch is saved");
  assert.match(sqlCalls(done, /FROM staff WHERE org_id = \$1 AND lower\(email\) = \$2 AND id <> \$3/)[0].sql, /id <> \$3/, "another login with the same email is looked for");

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
  // Another company already has an active login for this person. The lookup for
  // an existing login must not see it, or the new login is refused.
  const EXISTING = /WHERE org_id = \$1 AND lower\(email\) = \$2/;
  const rules = [
    [/SELECT lower\(email\) AS email FROM staff WHERE org_id/, [{ email: "sam.rivera@fundhub.ai" }]],
    [/SELECT id, status, name, role FROM staff WHERE/, companyRows([{ org_id: OTHER_ORG_ID, id: TARGET, status: "active", name: "Sam Rivera", role: "closer" }], EXISTING, 0)],
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
  assert.match(sqlCalls(done, /INSERT INTO staff/)[0].sql, /\(org_id, name, role, email, status\)\s+VALUES\s+\(\$1,\$2,\$3,\$4,'invited'\)/, "the new login belongs to the signed-in company and starts as invited");
  assert.match(sqlCalls(done, /SELECT lower\(email\) AS email FROM staff/)[0].sql, /WHERE org_id = \$1/);
  assert.match(sqlCalls(done, /SELECT id, status, name, role FROM staff/)[0].sql, EXISTING, "an existing login is looked for in this company only");
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

// The invite mail goes through the Resend provider with the process env and the
// global fetch, behind the messaging dry-run fence. Here the env names a key and
// a host that do not exist, fetch is replaced for the length of one call, and
// the fence is put back the way it was. Nothing leaves this machine.
async function withMailStandIn(fence, run) {
  const names = ["RESEND_API_KEY", "RESEND_FROM", "RESEND_BASE_URL", "MESSAGING_DRY_RUN"];
  const real = { fetch: globalThis.fetch, env: Object.fromEntries(names.map((name) => [name, process.env[name]])) };
  const sent = [];
  Object.assign(process.env, { RESEND_API_KEY: "mail-stand-in-not-a-key", RESEND_FROM: "Fundhub <login@fundhub.test>", RESEND_BASE_URL: "https://mail.invalid" });
  if (fence === "down") process.env.MESSAGING_DRY_RUN = "off";
  else delete process.env.MESSAGING_DRY_RUN;
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), body: JSON.parse(init.body || "{}") });
    return new Response(JSON.stringify({ id: "msg-stand-in-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    return await run(sent);
  } finally {
    globalThis.fetch = real.fetch;
    for (const name of names) {
      if (real.env[name] === undefined) delete process.env[name];
      else process.env[name] = real.env[name];
    }
  }
}

test("auth/invite emails the set-password link to a real notify address, and only to one", async () => {
  const rules = [[/INSERT INTO staff \(org_id, name, role, email, status\)/, (sql, params) => [
    { id: TARGET, email: params[3], name: params[1], role: params[2], status: "invited" },
  ]]];
  const invite = (body) => hit(inviteHandler, { method: "POST", body: { name: "Sam Rivera", role: "closer", ...body }, rules });

  await withMailStandIn("down", async (sent) => {
    const mailed = await invite({ notify_email: "Sam.Personal@Example.test" });
    assert.equal(mailed.status, 200);
    assert.equal(mailed.body.mailed, true, "a real address gets the link");
    assert.equal(sent.length, 1, "one mail, to one person");
    assert.equal(sent[0].url, "https://mail.invalid/emails");
    assert.deepEqual(sent[0].body.to, ["sam.personal@example.test"]);
    assert.equal(sent[0].body.subject, "Your Fundhub login is ready");
    assert.ok(sent[0].body.text.includes(`https://fundhub.ai${mailed.body.invitePath}`), "the mail carries the same set-password link the owner got");
    assert.ok(sent[0].body.text.includes(mailed.body.email), "the mail names the new login");

    sent.length = 0;
    const notAnAddress = await invite({ notify_email: "not an address" });
    assert.equal(notAnAddress.status, 200);
    assert.equal(notAnAddress.body.mailed, false);
    const noAddress = await invite({});
    assert.equal(noAddress.body.mailed, false);
    assert.equal(typeof noAddress.body.token, "string", "the owner still gets the link to copy");
    assert.equal(sent.length, 0, "no mail without a real address");
  });

  await withMailStandIn("up", async (sent) => {
    const held = await invite({ notify_email: "sam.personal@example.test" });
    assert.equal(held.status, 200);
    assert.equal(held.body.mailed, false, "with the messaging fence up nothing is mailed");
    assert.equal(typeof held.body.token, "string", "the owner still gets the link to copy");
    assert.equal(sent.length, 0, "and nothing was sent");
  });
});

test("auth/admin-reset hands the admin a 1 hour link and refuses a suspended login", async () => {
  assert.equal(ROUTES["auth/admin-reset"], adminResetHandler);
  const active = [[/SELECT id, status FROM staff WHERE org_id = \$1 AND lower\(email\)/, [{ id: TARGET, status: "active" }]]];
  const before = Date.now();
  // Nothing is emailed: with mail switched fully on, the handler still sends nothing.
  const done = await withMailStandIn("down", async (sent) => {
    const out = await hit(adminResetHandler, { method: "POST", body: { email: "Pat.Target@Fundhub.ai" }, rules: active });
    assert.equal(sent.length, 0, "the reset link is handed back in the response and never mailed");
    return out;
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.resetPath, `/reset-password.html?token=${encodeURIComponent(done.body.token)}`);
  assert.deepEqual(sqlCalls(done, /SELECT id, status FROM staff/)[0].params, [ORG_ID, "pat.target@fundhub.ai"]);
  assert.match(sqlCalls(done, /SELECT id, status FROM staff/)[0].sql, /WHERE org_id = \$1 AND lower\(email\) = \$2/, "only a login of the signed-in company gets a link");
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
  assert.match(sqlCalls(done, /FROM clients WHERE id/)[0].sql, /WHERE id = \$1 AND org_id = \$2/, "the client must belong to the signed-in company");
  const [repCall] = sqlCalls(done, /FROM client_authorized_reps/);
  assert.deepEqual(repCall.params, [CLIENT]);
  assert.match(repCall.sql, /r\.client_id = \$1\s+AND r\.removed_at IS NULL\s+AND a\.kind = 'authorized_rep'\s+AND a\.status = 'active'/, "only the live rep of this client is read");

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

// Who may open each door. The allowed roles are written out here, not read from
// the product, so a role slipped into a gate by mistake turns this red.
const OWNER_ADMIN = ["owner", "admin"];
const GATES = [
  ["auth/suspend", suspendHandler, { method: "POST", body: { staff_id: TARGET } }],
  ["auth/staff-role", staffRoleHandler, { method: "POST", body: { staff_id: TARGET, role: "closer" } }],
  ["auth/staff-update", staffUpdateHandler, { method: "POST", body: { staff_id: TARGET, name: "Pat Target", email: "pat.target@fundhub.ai" } }],
  ["auth/invite", inviteHandler, { method: "POST", body: { name: "Sam Rivera", role: "closer" } }],
  ["auth/admin-reset", adminResetHandler, { method: "POST", body: { email: "pat.target@fundhub.ai" } }],
  ["auth/authorized-rep", authorizedRepHandler, { query: { client_id: CLIENT } }],
];

for (const [route, handler, request] of GATES) {
  test(`${route} lets in exactly owner and admin and refuses every other role before any data is read`, async () => {
    await assertRoleGate(handler, OWNER_ADMIN, request);
  });
}

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
