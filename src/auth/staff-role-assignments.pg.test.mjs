import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, close } from "../db.mjs";
import { createSession, verifySession, hashToken } from "./session.mjs";
import { requireRole } from "../http/read-api.mjs";

test("staff role assignments are org-bound and active at each session check",
  { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
    const client = await pool().connect();
    const db = { query: (sql, params) => client.query(sql, params) };
    try {
      await client.query("BEGIN");
      const org = (await client.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
      const otherOrg = (await client.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, 'Role assignment test') RETURNING id",
        [`role-assignment-test-${crypto.randomUUID()}`]
      )).rows[0].id;
      const staff = (await client.query(
        `INSERT INTO staff (org_id, name, email, role, status)
         VALUES ($1, 'Role assignment test', $2, 'closer', 'active') RETURNING id`,
        [org, `role-assignment-${crypto.randomUUID()}@fundhub.test`]
      )).rows[0].id;
      const key = `test_role_${crypto.randomUUID().replaceAll("-", "")}`;
      const role = (await client.query(
        `INSERT INTO staff_roles (org_id, key, name) VALUES ($1, $2, 'Role assignment test') RETURNING id`,
        [org, key]
      )).rows[0].id;
      const foreignRole = (await client.query(
        `INSERT INTO staff_roles (org_id, key, name) VALUES ($1, $2, 'Foreign role') RETURNING id`,
        [otherOrg, key]
      )).rows[0].id;
      const ownerRole = (await client.query(
        "SELECT id FROM staff_roles WHERE org_id = $1 AND lower(key) = 'owner' LIMIT 1", [org]
      )).rows[0].id;

      await client.query(
        "INSERT INTO staff_role_assignments (org_id, staff_id, role_id) VALUES ($1, $2, $3)",
        [org, staff, role]
      );
      await client.query(
        "INSERT INTO staff_role_assignments (org_id, staff_id, role_id) VALUES ($1, $2, $3)",
        [org, staff, ownerRole]
      );
      const { token } = await createSession(db, { orgId: org, staffId: staff });
      const first = (await verifySession(db, token)).staff;
      assert.equal(first.role, "closer");
      assert.deepEqual(first.roles, ["closer", key]);
      const response = { status(code) { this.code = code; return this; }, json() { return this; } };
      assert.equal(requireRole(response, first, new Set([key])), true);

      await client.query("UPDATE staff_roles SET active = false WHERE id = $1", [role]);
      assert.deepEqual((await verifySession(db, token)).staff.roles, ["closer"]);

      await client.query("SAVEPOINT foreign_role");
      await assert.rejects(
        client.query(
          "INSERT INTO staff_role_assignments (org_id, staff_id, role_id) VALUES ($1, $2, $3)",
          [org, staff, foreignRole]
        ),
        { code: "23503" }
      );
      await client.query("ROLLBACK TO SAVEPOINT foreign_role");
      assert.deepEqual((await verifySession(db, token)).staff.roles, ["closer"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await close();
    }
  });


test("only a live primary owner/admin session can atomically replace same-org additional jobs",
  { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
    const client = await pool().connect();
    const db = { query: (sql, params) => client.query(sql, params) };
    try {
      await client.query("BEGIN");
      const org = (await client.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
      const other = (await client.query("INSERT INTO orgs(slug,name) VALUES($1,'Role authority test') RETURNING id",
        [`roles-${crypto.randomUUID()}`])).rows[0].id;
      const make = async (orgId, role) => (await client.query(
        "INSERT INTO staff(org_id,name,email,role,status) VALUES($1,'Role test',$2,$3,'active') RETURNING id",
        [orgId, `${crypto.randomUUID()}@fundhub.test`, role])).rows[0].id;
      const owner = await make(org, "owner");
      const target = await make(org, "closer");
      const foreign = await make(other, "closer");
      const session = await createSession(db, { orgId: org, staffId: owner });
      const targetSession = await createSession(db, { orgId: org, staffId: target });
      const invoke = async (token, id, primary, roles) => (await client.query(
        "SELECT public.set_staff_role_assignments($1,$2,$3,$4) AS result",
        [hashToken(token), id, primary, roles])).rows[0].result;
      assert.equal((await invoke(targetSession.token, target, "closer", ["setter"])).error, "forbidden");
      assert.equal((await invoke(session.token, foreign, "closer", ["setter"])).error, "staff_not_found");
      for (const roles of [["owner"], ["admin"], ["unknown_job"]]) {
        assert.equal((await invoke(session.token, target, "closer", roles)).ok, false);
      }
      assert.equal((await invoke(session.token, target, "owner", [])).error, "cannot_change_owner");
      assert.equal((await invoke(session.token, owner, "closer", [])).error, "cannot_change_owner");
      await client.query("UPDATE staff SET active=false WHERE id=$1", [target]);
      assert.equal((await invoke(session.token, target, "closer", ["setter"])).error, "staff_not_found");
      await client.query("UPDATE staff SET active=true WHERE id=$1", [target]);
      const custom = (await client.query("INSERT INTO staff_roles(org_id,key,name) VALUES($1,$2,'Existing custom duty') RETURNING id",
        [org, `fixture_${crypto.randomUUID().replaceAll("-", "")}`])).rows[0].id;
      await client.query("INSERT INTO staff_role_assignments(org_id,staff_id,role_id) VALUES($1,$2,$3)", [org,target,custom]);
      assert.equal((await invoke(session.token,target,"closer",["setter"])).error,"unsupported_existing_roles");
      assert.equal((await client.query("SELECT count(*)::int n FROM staff_role_assignments WHERE staff_id=$1 AND role_id=$2",[target,custom])).rows[0].n,1);
      await client.query("DELETE FROM staff_role_assignments WHERE staff_id=$1 AND role_id=$2",[target,custom]);
      const allowed = await invoke(session.token, target, "closer", ["setter"]);
      assert.equal(allowed.ok, true);
      assert.deepEqual(allowed.staff.roles, ["closer", "setter"]);
      assert.deepEqual((await verifySession(db, targetSession.token)).staff.roles, ["closer", "setter"]);
      await invoke(session.token, target, "closer", []);
      assert.deepEqual((await verifySession(db, targetSession.token)).staff.roles, ["closer"]);
      await client.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [session.sessionId]);
      assert.equal((await invoke(session.token, target, "closer", ["setter"])).error, "forbidden");
      assert.equal((await client.query("SELECT count(*)::int n FROM staff_role_assignments WHERE staff_id=$1", [target])).rows[0].n, 0);
      assert.equal((await client.query("SELECT has_table_privilege('fundhub_app','public.staff_role_assignments','INSERT') AS allowed")).rows[0].allowed, false);
      assert.equal((await client.query("SELECT has_table_privilege('fundhub_app','public.staff_role_assignments','DELETE') AS allowed")).rows[0].allowed, false);
    } finally {
      await client.query("ROLLBACK");client.release();await close();
    }
  });
