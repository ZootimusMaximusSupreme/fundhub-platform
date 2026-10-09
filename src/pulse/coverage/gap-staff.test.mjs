import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  gapChecks,
  parseHomeMap,
  STUCK_INVITE_SQL,
  STAFF_ROLES,
  SHELL_PATH,
  ROLE_GATE_PATH,
  HIRING_APPLY_PATH
} from "./gap-staff.mjs";
import { gapChecks as authGapChecks } from "./gap-auth.mjs";
import { CHECKS as HIRING_SLICE } from "./slice-11-hiring.mjs";
import { CHECKS as CSM_SLICE } from "./slice-30-csm-owner.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T12:00:00Z");

/* The HOME block as public/app/shell.js writes it, comments and all. */
const SHELL_JS = `
  var HOME = {
    owner: "pipeline.html",
    admin: "pipeline.html",
    funding_advisor: "client-control-panel.html",
    closer: "closer-dashboard.html",
    inquiry_specialist: "inquiry-remover.html",
    setter: "pipeline.html",
    // The Sales pipeline is the thing they own, so it is where they land.
    sales_manager: "sales-floor.html",
    /* The call list, not the client chooser. A CSM opening the app used to land
       on client-control-panel.html and be asked to pick: "somebody" // here. */
    csm: "csm-queue.html",
    client: "client-portal.html",
    affiliate: "affiliate.html",
    partner: "partner-galaxy.html"
  };
  function isKnownRole(role) { return true; }
`;

/* A db that answers only the exact staff-invite SQL, from a small model of
   staff and password_resets, so a changed query or changed params break it. */
function modelDb(model, calls) {
  return {
    async query(sql, params) {
      if (calls) calls.push({ sql, params });
      if (model && model.throw) throw new Error(model.throw);
      assert.equal(sql, STUCK_INVITE_SQL);
      const [org, now] = params;
      assert.ok(org === null || typeof org === "string");
      assert.ok(now instanceof Date);
      const invited = model.staff.filter(
        (s) => s.status === "invited" && (org === null || s.org_id === org)
      );
      const noLink = invited.filter((s) => !model.resets.some(
        (r) => r.staff_id === s.id && r.kind === "invite" && r.used_at == null && r.expires_at > now
      ));
      return { rows: [{ invited: invited.length, no_link: noLink.length }] };
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

const byId = (rows, id) => rows.find((row) => row.id === id);

/* A whole healthy site. Override one path to break it. */
function site(overrides = {}) {
  return (url) => {
    for (const [tail, hit] of Object.entries(overrides)) {
      if (url.endsWith(tail)) return hit;
    }
    if (url.endsWith(SHELL_PATH)) return { status: 200, body: SHELL_JS };
    if (url.endsWith(ROLE_GATE_PATH)) return { status: 401, body: { ok: false } };
    if (url.endsWith(HIRING_APPLY_PATH)) return { status: 200, body: { ok: true, roles: [{ key: "closer" }] } };
    return { status: 200, body: "<html>desk</html>" };
  };
}

test("gap staff: an empty run skips all four rows and does not throw", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((row) => row.id), [
    "staff-invite-link",
    "role-gate",
    "hiring-apply",
    "role-desk"
  ]);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "skip");
  }
});

test("gap staff: the invite mail keys are gap:auth-reset-mail's job, so this file reads no env and has no staff-invite-send row", async () => {
  // A run that carries a missing Resend key must not add a second FAIL here.
  const rows = await gapChecks({ env: {}, now: NOW });
  assert.equal(rows.some((row) => row.id === "staff-invite-send"), false);
  assert.equal(rows.some((row) => /RESEND/i.test(row.detail)), false);
  // The row the board names as the watcher must still exist.
  const auth = await authGapChecks({});
  assert.ok(auth.some((row) => row.id === "gap:auth-reset-mail"));
  const src = fs.readFileSync(path.join(HERE, "gap-staff.mjs"), "utf8");
  assert.doesNotMatch(src, /RESEND|ctx\.env|process\.env/);
});

test("gap staff: the invite link query is read-only and asks about invited people, kind invite, unused, not expired", () => {
  assert.match(STUCK_INVITE_SQL, /^\s*SELECT/);
  assert.doesNotMatch(STUCK_INVITE_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  assert.match(STUCK_INVITE_SQL, /s\.status = 'invited'/);
  assert.match(STUCK_INVITE_SQL, /pr\.kind = 'invite'/);
  assert.match(STUCK_INVITE_SQL, /pr\.used_at IS NULL/);
  assert.match(STUCK_INVITE_SQL, /pr\.expires_at > \$2/);
  assert.match(STUCK_INVITE_SQL, /\$1::uuid IS NULL OR s\.org_id = \$1::uuid/);
});

test("gap staff: an invited person with no live link fails, a live link passes, nobody invited passes", async () => {
  const live = { id: "s1", org_id: ORG, status: "invited" };
  const expired = { id: "s2", org_id: ORG, status: "invited" };
  const used = { id: "s3", org_id: ORG, status: "invited" };
  const resetOnly = { id: "s4", org_id: ORG, status: "invited" };
  const active = { id: "s5", org_id: ORG, status: "active" };
  const other = { id: "s6", org_id: "22222222-2222-4222-8222-222222222222", status: "invited" };
  const future = new Date("2026-10-12T00:00:00Z");
  const past = new Date("2026-10-01T00:00:00Z");
  const resets = [
    { staff_id: "s1", kind: "invite", used_at: null, expires_at: future },
    { staff_id: "s2", kind: "invite", used_at: null, expires_at: past },
    { staff_id: "s3", kind: "invite", used_at: new Date("2026-10-02T00:00:00Z"), expires_at: future },
    { staff_id: "s4", kind: "reset", used_at: null, expires_at: future }
  ];

  const calls = [];
  const fail = byId(await gapChecks({
    db: modelDb({ staff: [live, expired, used, resetOnly, active, other], resets }, calls),
    orgId: ORG,
    now: NOW
  }), "staff-invite-link");
  shape(fail);
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /3 of 4 invited people have no working set-password link/);
  assert.match(fail.detail, /Did not invite a person/);
  assert.deepEqual(calls[0].params, [ORG, NOW]);

  const pass = byId(await gapChecks({ db: modelDb({ staff: [live, active], resets }, null), orgId: ORG, now: NOW }), "staff-invite-link");
  shape(pass);
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /1 invited person has a working set-password link/);

  const none = byId(await gapChecks({ db: modelDb({ staff: [active], resets: [] }, null), orgId: ORG, now: NOW }), "staff-invite-link");
  assert.equal(none.status, "PASS");
  assert.match(none.detail, /nobody is waiting/);

  // A run with no org id reads every company, so the stranger org's invite counts.
  const all = byId(await gapChecks({ db: modelDb({ staff: [other], resets: [] }, null), now: NOW }), "staff-invite-link");
  assert.equal(all.status, "FAIL");
  assert.match(all.detail, /1 of 1 invited person has no working set-password link/);
});

test("gap staff: a database error on the invite read is a fail, not a pass", async () => {
  const rows = await gapChecks({ db: modelDb({ throw: "connection refused postgres://u:p@h/db" }), now: NOW });
  const row = byId(rows, "staff-invite-link");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /connection refused/);
  assert.doesNotMatch(row.detail, /u:p@h/);
  shape(row);
});

test("gap staff: role gate 500 fails, 401 and 403 pass, the call is a GET with a bad cookie and no role write", async () => {
  const bad = fakeFetch(site({ [ROLE_GATE_PATH]: { status: 500, body: { ok: false } } }));
  const fail = byId(await gapChecks({ fetchImpl: bad.fetchImpl, baseUrl: "https://fundhub.ai/" }), "role-gate");
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /500/);
  assert.match(fail.detail, /Did not change a role/);
  shape(fail);
  const gate = bad.calls.find((call) => call.url.endsWith(ROLE_GATE_PATH));
  assert.ok(gate);
  assert.equal(gate.url, `https://fundhub.ai${ROLE_GATE_PATH}`);
  assert.equal(gate.method, "GET");
  assert.match(gate.init.headers.cookie, /fundhub_session=%zz/);
  assert.equal(bad.calls.some((call) => /auth\/invite|auth\/staff-role/.test(call.url)), false);
  assert.equal(bad.calls.every((call) => call.method === "GET"), true);

  for (const status of [401, 403]) {
    const ok = fakeFetch(site({ [ROLE_GATE_PATH]: { status, body: {} } }));
    const pass = byId(await gapChecks({ fetchImpl: ok.fetchImpl }), "role-gate");
    assert.equal(pass.status, "PASS");
    shape(pass);
  }

  // A gate that lets a stranger through, or has gone missing, is not a pass.
  for (const status of [200, 404]) {
    const wide = fakeFetch(site({ [ROLE_GATE_PATH]: { status, body: {} } }));
    assert.equal(byId(await gapChecks({ fetchImpl: wide.fetchImpl }), "role-gate").status, "FAIL");
  }
  const busy = fakeFetch(site({ [ROLE_GATE_PATH]: { status: 503, body: {} } }));
  assert.equal(byId(await gapChecks({ fetchImpl: busy.fetchImpl }), "role-gate").status, "skip");
  const down = fakeFetch(site({ [ROLE_GATE_PATH]: { throw: "socket hang up" } }));
  const thrown = byId(await gapChecks({ fetchImpl: down.fetchImpl }), "role-gate");
  assert.equal(thrown.status, "FAIL");
  assert.match(thrown.detail, /socket hang up/);
});

test("gap staff: the run uses ctx.fetch when ctx.fetchImpl is not given", async () => {
  const live = fakeFetch(site());
  const rows = await gapChecks({ fetch: live.fetchImpl });
  assert.equal(byId(rows, "role-gate").status, "PASS");
  assert.equal(byId(rows, "hiring-apply").status, "PASS");
  assert.equal(byId(rows, "role-desk").status, "PASS");
});

test("gap staff: hiring apply 200 with roles passes, and 404, a bad body, or no roles list is dead", async () => {
  const live = fakeFetch(site());
  const pass = byId(await gapChecks({ fetchImpl: live.fetchImpl }), "hiring-apply");
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /1 open role\b/);
  shape(pass);
  const apply = live.calls.find((call) => call.url.endsWith(HIRING_APPLY_PATH));
  assert.equal(apply.method, "GET");

  const none = fakeFetch(site({ [HIRING_APPLY_PATH]: { status: 200, body: { ok: true, roles: [] } } }));
  assert.match(byId(await gapChecks({ fetchImpl: none.fetchImpl }), "hiring-apply").detail, /0 open roles/);

  const dead = fakeFetch(site({ [HIRING_APPLY_PATH]: { status: 404, body: { ok: false, error: "not_found" } } }));
  const fail = byId(await gapChecks({ fetchImpl: dead.fetchImpl }), "hiring-apply");
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /dead/);
  assert.match(fail.detail, /404/);
  shape(fail);

  for (const body of [{ ok: true }, { ok: false, roles: [] }, "<html>not json</html>"]) {
    const bad = fakeFetch(site({ [HIRING_APPLY_PATH]: { status: 200, body } }));
    assert.equal(byId(await gapChecks({ fetchImpl: bad.fetchImpl }), "hiring-apply").status, "FAIL");
  }
});

test("gap staff: parseHomeMap reads the real HOME block and ignores comments", () => {
  const home = parseHomeMap(SHELL_JS);
  assert.equal(home.closer, "closer-dashboard.html");
  assert.equal(home.sales_manager, "sales-floor.html");
  assert.equal(home.csm, "csm-queue.html");
  assert.equal(home.partner, "partner-galaxy.html");
  assert.equal(Object.keys(home).length, 11);
  assert.equal(parseHomeMap("var ROLE_TABS = {};"), null);
  assert.equal(parseHomeMap(""), null);
});

test("gap staff: the home desk each staff job lands on must load; a 404 names the job, a full set passes", async () => {
  const ok = fakeFetch(site());
  const pass = byId(await gapChecks({ fetchImpl: ok.fetchImpl, baseUrl: "https://fundhub.ai" }), "role-desk");
  assert.equal(pass.status, "PASS");
  assert.match(pass.detail, /8 staff jobs each land on a desk that loads \(6 desks\)/);
  shape(pass);
  // Read from the app frame, one GET per desk, never a client/affiliate/partner desk.
  const urls = ok.calls.map((call) => call.url);
  assert.equal(urls.filter((u) => u.endsWith("/app/pipeline.html")).length, 1);
  for (const file of ["closer-dashboard", "client-control-panel", "inquiry-remover", "sales-floor", "csm-queue"]) {
    assert.ok(urls.some((u) => u.endsWith(`/app/${file}.html`)), file);
  }
  for (const file of ["client-portal", "affiliate", "partner-galaxy"]) {
    assert.equal(urls.some((u) => u.endsWith(`/app/${file}.html`)), false, file);
  }
  assert.equal(ok.calls.every((call) => call.method === "GET"), true);

  const missing = fakeFetch(site({ "/app/inquiry-remover.html": { status: 404, body: "missing" } }));
  const fail = byId(await gapChecks({ fetchImpl: missing.fetchImpl }), "role-desk");
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /inquiry_specialist -> inquiry-remover\.html \(404\)/);
  assert.match(fail.detail, /Did not edit a page/);
  shape(fail);

  // The pipeline desk is the home of three jobs; all three are named when it breaks.
  const pipe = fakeFetch(site({ "/app/pipeline.html": { status: 500, body: "boom" } }));
  const pipeFail = byId(await gapChecks({ fetchImpl: pipe.fetchImpl }), "role-desk");
  assert.equal(pipeFail.status, "FAIL");
  assert.match(pipeFail.detail, /owner\/admin\/setter -> pipeline\.html \(500\)/);
});

test("gap staff: a missing app frame fails, an unreadable HOME map skips, an unsafe file name is never fetched", async () => {
  const noShell = fakeFetch(site({ [SHELL_PATH]: { status: 404, body: "" } }));
  const fail = byId(await gapChecks({ fetchImpl: noShell.fetchImpl }), "role-desk");
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /404/);
  shape(fail);

  const odd = fakeFetch(site({ [SHELL_PATH]: { status: 200, body: "var HOMEPAGE = 1;" } }));
  const skip = byId(await gapChecks({ fetchImpl: odd.fetchImpl }), "role-desk");
  assert.equal(skip.status, "skip");
  assert.match(skip.detail, /HOME map/);

  const evil = fakeFetch(site({
    [SHELL_PATH]: {
      status: 200,
      body: 'var HOME = {\n owner: "../../etc/passwd",\n closer: "closer-dashboard.html"\n };'
    }
  }));
  const rows = await gapChecks({ fetchImpl: evil.fetchImpl });
  assert.equal(byId(rows, "role-desk").status, "PASS");
  assert.equal(evil.calls.some((call) => call.url.includes("passwd")), false);

  const down = fakeFetch(site({ [SHELL_PATH]: { throw: "ENOTFOUND" } }));
  const thrown = byId(await gapChecks({ fetchImpl: down.fetchImpl }), "role-desk");
  assert.equal(thrown.status, "FAIL");
  assert.match(thrown.detail, /ENOTFOUND/);
});

test("gap staff: these ids are not slice 11 sweepers or slice 30 doors, and every staff job in the HOME map is known", async () => {
  const rows = await gapChecks({});
  const mine = new Set(rows.map((row) => row.id));
  for (const row of HIRING_SLICE) assert.equal(mine.has(row.id), false);
  for (const row of CSM_SLICE) assert.equal(mine.has(row.id), false);
  assert.equal(HIRING_SLICE.some((row) => row.id === "hiring/apply"), false);
  const home = parseHomeMap(SHELL_JS);
  for (const role of STAFF_ROLES) assert.ok(home[role], `${role} has a home desk`);
});

test("gap staff: source does not invite, change a role, edit HTML, read the repo, or start a watchdog", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-staff.mjs"), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.doesNotMatch(src, /inviteStaff|setStaffRole|writeFile|readFileSync|createFunction/);
  assert.doesNotMatch(src, /method:\s*"POST"/);
  assert.doesNotMatch(src, /BEGIN|COMMIT|ROLLBACK/);
  assert.equal(src.includes(HIRING_APPLY_PATH), true);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
});

/* ------------------------------------------------------------------------
   The invite SQL, run for real. staff and password_resets are replaced for one
   query by fixture rows (a CTE with the table's name), so STUCK_INVITE_SQL runs
   on the Postgres engine over rows we choose. SELECT only, nothing is stored.
   Skipped without DATABASE_URL, like every *.pg.test.mjs. If someone changes the
   status filter, the link kind, the used test or the expiry test, these fail.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  staff: [["id", "uuid"], ["org_id", "uuid"], ["status", "text"]],
  password_resets: [["staff_id", "uuid"], ["kind", "text"], ["used_at", "timestamptz"], ["expires_at", "timestamptz"]]
};

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      return pgDb.query(`WITH ${ctes.join(", ")} ${String(sql).trim()}`, params);
    }
  };
}

describe("gap-staff invite SQL on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
  let seq = 0;
  const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
  const hours = (h) => new Date(NOW.getTime() + h * 3600e3).toISOString();
  const person = (o = {}) => ({ id: uid(), org_id: ORG, status: "invited", ...o });
  const link = (p, o = {}) => ({ staff_id: p.id, kind: "invite", used_at: null, expires_at: hours(48), ...o });

  async function run(rows, ctx = {}) {
    const out = await gapChecks({ db: fixtureDb(rows), orgId: ORG, now: NOW, ...ctx });
    return byId(out, "staff-invite-link");
  }

  test("an invited person with an unused, unexpired invite link passes; nobody invited passes", async () => {
    const p = person();
    const ok = await run({ staff: [p], password_resets: [link(p)] });
    assert.equal(ok.status, "PASS");
    assert.match(ok.detail, /1 invited person has a working set-password link/);
    const none = await run({ staff: [] });
    assert.equal(none.status, "PASS");
    assert.match(none.detail, /nobody is waiting/);
    // An active person is not waiting on an invite, link or no link.
    const active = await run({ staff: [person({ status: "active" }), person({ status: "suspended" })] });
    assert.equal(active.status, "PASS");
    assert.match(active.detail, /nobody is waiting/);
  });

  test("no link, an expired link, a used link, or only a reset link fails", async () => {
    const none = person();
    const expired = person();
    const used = person();
    const resetOnly = person();
    const live = person();
    const out = await run({
      staff: [none, expired, used, resetOnly, live],
      password_resets: [
        link(expired, { expires_at: hours(-1) }),
        link(used, { used_at: hours(-5) }),
        link(resetOnly, { kind: "reset" }),
        link(live)
      ]
    });
    assert.equal(out.status, "FAIL");
    assert.match(out.detail, /4 of 5 invited people have no working set-password link/);
    // One at a time, so a broken single test cannot hide behind the others.
    for (const [name, p, l] of [
      ["no link", none, null],
      ["expired", expired, link(expired, { expires_at: hours(-1) })],
      ["used", used, link(used, { used_at: hours(-5) })],
      ["reset only", resetOnly, link(resetOnly, { kind: "reset" })]
    ]) {
      const one = await run({ staff: [p], password_resets: l ? [l] : [] });
      assert.equal(one.status, "FAIL", name);
      assert.match(one.detail, /1 of 1 invited person has no working set-password link/, name);
    }
  });

  test("a person with an old dead link and a new live link is fine; another person's link does not count", async () => {
    const p = person();
    const q = person();
    const both = await run({
      staff: [p],
      password_resets: [link(p, { expires_at: hours(-100) }), link(p)]
    });
    assert.equal(both.status, "PASS");
    const wrongPerson = await run({ staff: [p, q], password_resets: [link(q)] });
    assert.equal(wrongPerson.status, "FAIL");
    assert.match(wrongPerson.detail, /1 of 2 invited people have no working set-password link/);
  });

  test("with an org id only that company is read; with none, every company is", async () => {
    const mine = person();
    const theirs = person({ org_id: OTHER_ORG });
    const rows = { staff: [mine, theirs], password_resets: [link(mine)] };
    assert.equal((await run(rows)).status, "PASS");
    const all = await run(rows, { orgId: undefined });
    assert.equal(all.status, "FAIL");
    assert.match(all.detail, /1 of 2 invited people have no working set-password link/);
  });
});
