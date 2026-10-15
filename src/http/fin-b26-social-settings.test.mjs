// finish-853 batch 26: GET and POST /api/social/settings. The real handler runs over stand-in tables
// that answer by the conditions each statement names (partner, company). Practice test, fake data,
// no network, no database.
// Row 1 (POST): the owner flips approve_before_launch (whether a person must read every social post
//   before it goes out).
// Row 2 (GET): the partner marketing module settings read (approve-before-launch, caps, autopilot,
//   suite on/off).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/settings.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import { selectList, projectRow, whereOf, keep, runInsert } from "../testing/fin-b26-sql.mjs";

const stored = (partner, org, over = {}) => ({
  org_id: org, partner_id: partner, approve_before_launch: true, weekly_asset_target: 5, max_concurrent_jobs: 3,
  autopilot_enabled: true, launch_enabled: true, marketing_suite_enabled: true, updated_at: "2026-10-01T00:00:00.000Z", ...over,
});

function world(over = {}) {
  return {
    partners: [
      { id: PARTNER, org_id: ORG_ID },
      { id: OTHER_PARTNER, org_id: ORG_ID },
      { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID },
    ],
    partner_module_settings: [
      stored(PARTNER, ORG_ID),
      stored(FOREIGN_PARTNER, OTHER_ORG_ID, { approve_before_launch: false, weekly_asset_target: 99 }),
    ],
    ...over,
  };
}

/**
 * The statements, answered by reading them: the settings read by its WHERE and its named columns, and
 * the owner's upsert by its own column list, its ON CONFLICT ... DO UPDATE SET list and its guard.
 */
function rulesFor(t) {
  return [
    [/set_config\(/i, []],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
    [/FROM partner_module_settings\s+-- THE GUARD|FROM partner_module_settings\s+WHERE partner_id/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.partner_module_settings, whereOf(sql), p, { alias: "partner_module_settings" })
        .slice(0, 1).map((r) => projectRow(items, { params: p, row: r, rows: { partner_module_settings: r } }));
    }],
    [/FROM partners\s+WHERE id = \$1/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.partners, whereOf(sql), p, { alias: "partners" })
        .slice(0, 1).map((r) => projectRow(items, { params: p, row: r, rows: { partners: r } }));
    }],
    [/^\s*INSERT INTO partner_module_settings/i, (sql, p) => runInsert(sql, p, t.partner_module_settings, {
      // What the table itself fills in for a row nobody has configured: nothing is switched on.
      fill: (row) => ({ weekly_asset_target: null, max_concurrent_jobs: null, autopilot_enabled: false, launch_enabled: false,
        marketing_suite_enabled: false, updated_at: "now", ...row }),
    }).rows],
  ];
}

const call = (method, who, { query = {}, body = {} } = {}, t = world()) =>
  run(handler, req(method, { query, body }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));

describe("GET /api/social/settings", () => {
  test("an owner or admin reads a partner's settings in their own company: switch, caps, autopilot, suite on or off", async () => {
    for (const role of ["owner", "admin"]) {
      const { res, fake } = await call("GET", asRole(role), { query: { partner_id: PARTNER } });
      assert.equal(res.statusCode, 200, role);
      assert.equal(res.body.partner_id, PARTNER);
      assert.deepEqual(res.body.settings, {
        stored: true, approve_before_launch: true, weekly_asset_target: 5, max_concurrent_jobs: 3,
        autopilot_enabled: true, launch_enabled: true, marketing_suite_enabled: true, updated_at: "2026-10-01T00:00:00.000Z",
      }, "every one of the seven named columns is read from the statement's own SELECT list");
      assert.equal(wrote(fake), false);
      pinned(sqlOf(fake, /FROM partner_module_settings/)[0].sql, "the read names the partner and the company",
        "WHERE partner_id = $1 AND ($2::uuid IS NULL OR org_id = $2::uuid)");
      assert.deepEqual(sqlOf(fake, /FROM partner_module_settings/)[0].params, [PARTNER, ORG_ID]);
    }
  });

  test("the company is the session's: another company's id in the address changes nothing", async () => {
    const { res, fake } = await call("GET", asRole("owner"), { query: { partner_id: PARTNER, org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.stored, true);
    assert.deepEqual(sqlOf(fake, /FROM partner_module_settings/)[0].params, [PARTNER, ORG_ID]);
    const foreign = await call("GET", asRole("owner"), { query: { partner_id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID } });
    assert.equal(foreign.res.body.settings.stored, false, "company A's owner does not read company B's row by naming company B");
  });

  test("a partner with nothing saved reads the engine's own default and says nothing was saved", async () => {
    const t = world({ partner_module_settings: [] });
    const { res } = await call("GET", asRole("owner"), { query: { partner_id: PARTNER } }, t);
    assert.deepEqual(res.body.settings, {
      stored: false, approve_before_launch: true, weekly_asset_target: null, max_concurrent_jobs: null,
      autopilot_enabled: false, launch_enabled: false, marketing_suite_enabled: false, updated_at: null,
    });
  });

  test("a saved switch that is off reads as off, not as the default", async () => {
    const t = world({ partner_module_settings: [stored(PARTNER, ORG_ID, { approve_before_launch: false })] });
    const { res } = await call("GET", asRole("owner"), { query: { partner_id: PARTNER } }, t);
    assert.equal(res.body.settings.approve_before_launch, false);
    assert.equal(res.body.settings.stored, true);
  });

  test("the owning partner reads their own; another partner's id is refused", async () => {
    const own = await call("GET", asPartner(PARTNER), { query: { partner_id: PARTNER } });
    assert.equal(own.res.statusCode, 200);
    assert.equal(own.res.body.settings.stored, true);
    // A partner's own scope is the partner row, and no company filter is applied to them.
    assert.equal(sqlOf(own.fake, /FROM partner_module_settings/)[0].params[1], null);
    const other = await call("GET", asPartner(PARTNER), { query: { partner_id: OTHER_PARTNER } });
    assert.equal(other.res.statusCode, 403);
    assert.equal(sqlOf(other.fake, /FROM partner_module_settings/).length, 0);
  });

  test("another company's partner reads as nothing saved: its real value is never shown", async () => {
    const { res } = await call("GET", asRole("owner"), { query: { partner_id: FOREIGN_PARTNER } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.stored, false);
    assert.equal(res.body.settings.approve_before_launch, true, "company B's saved 'off' is not shown to company A");
    assert.equal(res.body.settings.weekly_asset_target, null);
  });

  test("only an owner or an admin of staff may read; no company or no partner id reads nothing", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const { res, fake } = await call("GET", asRole(role), { query: { partner_id: PARTNER } });
      const allowed = role === "owner" || role === "admin";
      assert.equal(res.statusCode, allowed ? 200 : 403, role);
      if (!allowed) assert.equal(sqlOf(fake, /FROM partner_module_settings/).length, 0, role);
    }
    const noOrg = await call("GET", asRole("owner", { org_id: null }), { query: { partner_id: PARTNER } });
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(noOrg.res.body.error, "no_org_scope");
    assert.equal(sqlOf(noOrg.fake, /FROM partner_module_settings/).length, 0);
    const none = await call("GET", asRole("owner"), { query: {} });
    assert.equal(none.res.statusCode, 400);
    const bad = await call("GET", asRole("owner"), { query: { partner_id: "nope" } });
    assert.equal(bad.res.statusCode, 400);
  });

  test("a client and an affiliate are refused; the verbs other than GET and POST are refused", async () => {
    for (const who of [asClient(), asAffiliate()]) {
      const { res } = await call("GET", who, { query: { partner_id: PARTNER } });
      assert.equal(res.statusCode, 403);
    }
    const del = await call("DELETE", asRole("owner"), { query: { partner_id: PARTNER } });
    assert.equal(del.res.statusCode, 405);
    assert.equal(del.res.headers.allow, "GET, POST");
  });
});

describe("POST /api/social/settings", () => {
  test("the owner flips the switch off and on, and no other column on the row changes", async () => {
    const t = world();
    const off = await call("POST", asRole("owner"), { body: { partner_id: PARTNER, approve_before_launch: false } }, t);
    assert.equal(off.res.statusCode, 200);
    assert.equal(off.res.body.settings.approve_before_launch, false);
    assert.equal(off.res.body.settings.stored, true);
    const row = t.partner_module_settings.find((r) => r.partner_id === PARTNER);
    assert.equal(row.approve_before_launch, false);
    assert.equal(row.weekly_asset_target, 5, "the caps are left alone");
    assert.equal(row.max_concurrent_jobs, 3);
    assert.equal(row.autopilot_enabled, true);
    assert.equal(row.launch_enabled, true);
    assert.equal(row.marketing_suite_enabled, true);
    const insert = sqlOf(off.fake, /INSERT INTO partner_module_settings/)[0];
    assert.deepEqual(insert.params, [ORG_ID, PARTNER, false], "the company is the partner's own, read from the partner row");
    pinned(insert.sql, "only the switch and its date are written", "SET approve_before_launch = EXCLUDED.approve_before_launch, updated_at = now()");
    pinned(insert.sql, "a row of another company is left alone", "WHERE partner_module_settings.org_id = EXCLUDED.org_id");
    assert.equal(writes(off.fake).length, 1, "one write, nothing else");

    const on = await call("POST", asRole("owner"), { body: { partner_id: PARTNER, approve_before_launch: true } }, t);
    assert.equal(on.res.body.settings.approve_before_launch, true);
    assert.equal(t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch, true);
  });

  test("a partner with no settings row gets one made, switch as asked, caps empty", async () => {
    const t = world();
    const { res } = await call("POST", asRole("owner"), { body: { partner_id: OTHER_PARTNER, approve_before_launch: false } }, t);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.settings.stored, true);
    assert.equal(res.body.settings.approve_before_launch, false);
    assert.equal(res.body.settings.weekly_asset_target, null);
    assert.equal(t.partner_module_settings.find((r) => r.partner_id === OTHER_PARTNER).org_id, ORG_ID);
  });

  test("only the owner may flip it: an admin, every other staff role and the partner itself are refused and nothing is written", async () => {
    for (const role of ALL_STAFF_ROLES.filter((r) => r !== "owner")) {
      const t = world();
      const { res, fake } = await call("POST", asRole(role), { body: { partner_id: PARTNER, approve_before_launch: false } }, t);
      assert.equal(res.statusCode, 403, role);
      assert.equal(wrote(fake), false, role);
      assert.equal(t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch, true, role);
    }
    const t = world();
    const own = await call("POST", asPartner(PARTNER), { body: { partner_id: PARTNER, approve_before_launch: false } }, t);
    assert.equal(own.res.statusCode, 403, "a partner may never switch off the check on their own posts");
    assert.equal(wrote(own.fake), false);
    assert.equal(t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch, true);
  });

  test("the value must be a real true or false; anything else is a 400 and writes nothing", async () => {
    for (const value of ["false", "true", 0, 1, null, undefined, "yes"]) {
      const t = world();
      const body = { partner_id: PARTNER };
      if (value !== undefined) body.approve_before_launch = value;
      const { res, fake } = await call("POST", asRole("owner"), { body }, t);
      assert.equal(res.statusCode, 400, String(value));
      assert.equal(res.body.error, "approve_before_launch_required");
      assert.equal(wrote(fake), false);
    }
  });

  test("another company's partner is a 404 and its switch is not flipped, whether or not it has a row", async () => {
    const t = world();
    const foreign = await call("POST", asRole("owner"), { body: { partner_id: FOREIGN_PARTNER, approve_before_launch: true } }, t);
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(wrote(foreign.fake), false);
    assert.equal(t.partner_module_settings.find((r) => r.partner_id === FOREIGN_PARTNER).approve_before_launch, false);
    assert.deepEqual(sqlOf(foreign.fake, /FROM partners/)[0].params, [FOREIGN_PARTNER, ORG_ID]);
    pinned(sqlOf(foreign.fake, /FROM partners/)[0].sql, "the partner is looked up inside the caller's company",
      "WHERE id = $1 AND ($2::uuid IS NULL OR org_id = $2::uuid)");
  });

  test("a settings row that belongs to another company is left alone even for a partner found in this one", async () => {
    // A data mismatch: the partner is company A's, its settings row says company B.
    const t = world({
      partner_module_settings: [stored(PARTNER, OTHER_ORG_ID, { approve_before_launch: false })],
    });
    const { res } = await call("POST", asRole("owner"), { body: { partner_id: PARTNER, approve_before_launch: true } }, t);
    assert.equal(res.statusCode, 404, "RETURNING gave nothing, so the write is raised, never reported as done");
    assert.equal(t.partner_module_settings[0].approve_before_launch, false, "company B's row was not flipped");
  });
});
