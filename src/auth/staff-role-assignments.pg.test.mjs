import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool, close } from "../db.mjs";
import { createSession, verifySession } from "./session.mjs";
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
