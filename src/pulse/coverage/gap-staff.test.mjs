import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gapChecks,
  INVITE_SQL,
  ROLE_DESKS,
  ROLE_GATE_PATH,
  HIRING_APPLY_PATH
} from "./gap-staff.mjs";
import { CHECKS as HIRING_SLICE } from "./slice-11-hiring.mjs";
import { CHECKS as CSM_SLICE } from "./slice-30-csm-owner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeDb(row, calls) {
  return {
    async query(sql, params) {
      if (calls) calls.push({ sql, params });
      if (row && row.throw) throw new Error(row.throw);
      return { rows: [row || {}] };
    }
  };
}

function fakeFetch(map) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: (init && init.method) || "GET", init });
    const hit = map(String(url));
    if (hit && hit.throw) throw new Error(hit.throw);
    const body = hit && hit.body != null
      ? (typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body))
      : "";
    return {
      status: hit ? hit.status : 599,
      async text() { return body; }
    };
  };
  return { fetchImpl, calls };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\)/);
    assert.match(row.suggestedFix, /second watchdog/);
    assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

test("gap staff: empty run skips all four and does not throw", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.id), [
    "staff-invite-send",
    "role-gate",
    "hiring-apply",
    "role-desk"
  ]);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "skip");
  }
});

test("gap staff: open invites with no mail row fail, and the query is read-only", async () => {
  const calls = [];
  const rows = await gapChecks({
    db: fakeDb({ open_invites: 2, mailed: 0 }, calls),
    orgId: "11111111-1111-4111-8111-111111111111"
  });
  const invite = rows[0];
  shape(invite);
  assert.equal(invite.status, "FAIL");
  assert.match(invite.detail, /2 of 2 open staff invites have no outbound email/);
  assert.match(invite.detail, /Did not invite a person/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT/);
  assert.doesNotMatch(calls[0].sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  assert.deepEqual(calls[0].params, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(rows[1].status, "skip");
});

test("gap staff: a mailed invite passes, and zero invites skip", async () => {
  const pass = await gapChecks({ db: fakeDb({ open_invites: 1, mailed: 1 }) });
  assert.equal(pass[0].status, "PASS");
  shape(pass[0]);
  const none = await gapChecks({ db: fakeDb({ open_invites: 0, mailed: 0 }) });
  assert.equal(none[0].status, "skip");
  assert.match(none[0].detail, /Did not invite a person/);
});

test("gap staff: a database error is a fail and does not invite anyone", async () => {
  const rows = await gapChecks({ db: fakeDb({ throw: "connection refused" }) });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /connection refused/);
  assert.match(rows[0].detail, /Did not invite a person/);
  shape(rows[0]);
});

test("gap staff: role gate 500 fails, 401 passes, and the call is GET with no role write", async () => {
  const bad = fakeFetch(() => ({ status: 500, body: { ok: false } }));
  const fail = await gapChecks({ fetchImpl: bad.fetchImpl, baseUrl: "https://fundhub.ai/" });
  assert.equal(fail[1].status, "FAIL");
  assert.match(fail[1].detail, /500/);
  assert.match(fail[1].detail, /Did not change a role/);
  shape(fail[1]);
  assert.equal(bad.calls.length >= 1, true);
  const gate = bad.calls.find((call) => call.url.endsWith(ROLE_GATE_PATH));
  assert.ok(gate);
  assert.equal(gate.method, "GET");
  assert.match(gate.init.headers.cookie, /%zz/);
  assert.equal(bad.calls.some((call) => /auth\/invite|auth\/staff-role/.test(call.url)), false);
  assert.equal(bad.calls.every((call) => call.method === "GET"), true);

  const ok = fakeFetch(() => ({ status: 401, body: { ok: false, error: "unauthorized" } }));
  const pass = await gapChecks({ fetchImpl: ok.fetchImpl });
  assert.equal(pass[1].status, "PASS");
  shape(pass[1]);
});

test("gap staff: hiring apply 200 with roles passes, and 404 or a bad body is dead", async () => {
  const live = fakeFetch((url) => {
    if (url.endsWith(HIRING_APPLY_PATH)) {
      return { status: 200, body: { ok: true, roles: [{ key: "closer" }] } };
    }
    if (url.endsWith(ROLE_GATE_PATH)) return { status: 401, body: {} };
    return { status: 200, body: "<html>desk</html>" };
  });
  const pass = await gapChecks({ fetchImpl: live.fetchImpl, db: fakeDb({ open_invites: 0, mailed: 0 }) });
  assert.equal(pass[2].status, "PASS");
  assert.match(pass[2].detail, /1 open role/);
  shape(pass[2]);
  const apply = live.calls.find((call) => call.url.endsWith(HIRING_APPLY_PATH));
  assert.equal(apply.method, "GET");

  const dead = fakeFetch(() => ({ status: 404, body: { ok: false, error: "not_found" } }));
  const fail = await gapChecks({ fetchImpl: dead.fetchImpl });
  assert.equal(fail[2].status, "FAIL");
  assert.match(fail[2].detail, /dead/);
  assert.match(fail[2].detail, /404/);
  shape(fail[2]);

  const empty = fakeFetch(() => ({ status: 200, body: { ok: true } }));
  const badBody = await gapChecks({ fetchImpl: empty.fetchImpl });
  assert.equal(badBody[2].status, "FAIL");
});

test("gap staff: a role desk 404 fails and names the role, a full set passes", async () => {
  const missing = fakeFetch((url) => {
    if (url.endsWith("/app/inquiry-remover.html")) return { status: 404, body: "missing" };
    if (url.endsWith(ROLE_GATE_PATH)) return { status: 403, body: {} };
    if (url.endsWith(HIRING_APPLY_PATH)) return { status: 200, body: { ok: true, roles: [] } };
    return { status: 200, body: "<html>ok</html>" };
  });
  const fail = await gapChecks({ fetchImpl: missing.fetchImpl });
  assert.equal(fail[3].status, "FAIL");
  assert.match(fail[3].detail, /404/);
  assert.match(fail[3].detail, /inquiry_specialist/);
  assert.match(fail[3].detail, /Did not edit a page/);
  shape(fail[3]);
  assert.equal(missing.calls.filter((call) => call.url.includes("/app/")).every((call) => call.method === "GET"), true);

  const ok = fakeFetch((url) => {
    if (url.endsWith(ROLE_GATE_PATH)) return { status: 401, body: {} };
    if (url.endsWith(HIRING_APPLY_PATH)) return { status: 200, body: { ok: true, roles: [] } };
    return { status: 200, body: "<html>ok</html>" };
  });
  const pass = await gapChecks({ fetchImpl: ok.fetchImpl });
  assert.equal(pass[3].status, "PASS");
  assert.equal(pass[3].detail.includes("3 role desks"), true);
  shape(pass[3]);
});

test("gap staff: these ids are not slice 11 sweepers or slice 30 doors", async () => {
  const rows = await gapChecks({});
  const mine = new Set(rows.map((row) => row.id));
  for (const row of HIRING_SLICE) assert.equal(mine.has(row.id), false);
  for (const row of CSM_SLICE) assert.equal(mine.has(row.id), false);
  const deskFiles = ROLE_DESKS.map((desk) => desk.path.split("/").pop());
  for (const file of deskFiles) {
    assert.equal(CSM_SLICE.some((row) => row.id === file), false);
  }
  assert.equal(HIRING_SLICE.some((row) => row.id === "hiring/apply"), false);
});

test("gap staff: source does not invite, change a role, edit HTML, or start a watchdog", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-staff.mjs"), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.match(INVITE_SQL, /SELECT/);
  assert.doesNotMatch(INVITE_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  assert.doesNotMatch(src, /inviteStaff|setStaffRole|writeFile|createFunction/);
  assert.doesNotMatch(src, /method:\s*"POST"/);
  assert.equal(src.includes(HIRING_APPLY_PATH), true);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
});
