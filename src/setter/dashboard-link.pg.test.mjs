// Scoped staff alert selection against disposable, nonprivileged Postgres only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { listSetterQueue } from "./dashboard.mjs";

const DATABASE_URL = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const HAS_DB = isLocalScratchDatabaseUrl(DATABASE_URL);

test("staff alert selects an older accessible client before50 without crossing tenant, archive or setter claims", { skip: !HAS_DB }, async () => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const slug = `setter-link-${randomUUID()}`;
  try {
    const role = (await db.query("SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    await db.query("BEGIN");
    const orgId = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,'Setter link test') RETURNING id", [slug])).rows[0].id;
    const otherOrgId = (await db.query("INSERT INTO orgs (slug,name) VALUES ($1,'Foreign setter link test') RETURNING id", [slug + "-other"])).rows[0].id;
    const setterId = (await db.query("INSERT INTO staff (org_id,name,role,status) VALUES ($1,'Link Setter','setter','active') RETURNING id", [orgId])).rows[0].id;
    const otherSetterId = (await db.query("INSERT INTO staff (org_id,name,role,status) VALUES ($1,'Other Setter','setter','active') RETURNING id", [orgId])).rows[0].id;
    const staff = { org_id: orgId, id: setterId, role: "setter" };
    async function lead({ org = orgId, assignee = null, fields = {}, age = 0, done = false } = {}) {
      const id = (await db.query("INSERT INTO clients (org_id,first_name,email,custom_fields) VALUES ($1,'Synthetic',$2,$3::jsonb) RETURNING id", [org, `e2e+${randomUUID()}@example.test`, JSON.stringify(fields)])).rows[0].id;
      await db.query("INSERT INTO tasks (org_id,client_id,title,assignee_role,assignee_staff_id,created_at,done) VALUES ($1,$2,'Setter link test','setter',$3,now()-($4::int * interval '1 minute'),$5)", [org,id,assignee,age,done]);
      return id;
    }
    const target = await lead({ assignee: setterId, age: 120, fields: { cf_svy_planned_use_label: "Original", setter_survey_edits: { cf_svy_planned_use: "Correction" } } });
    for (let i=0; i<55; i++) await lead({ age: i });
    const normal = await listSetterQueue(db, staff);
    assert.equal(normal.items.length, 50);
    assert.equal(normal.items.some(row => row.client_id === target), false);
    const linked = await listSetterQueue(db, staff, { client_id: target });
    assert.equal(linked.items.length, 50);
    assert.equal(linked.items[0].client_id, target);
    assert.equal(linked.items[0].survey.find(row => row.key === "cf_svy_planned_use").answer, "Original");
    assert.equal(linked.items[0].survey_edits.cf_svy_planned_use, "Correction");
    const denied = [
      await lead({ org: otherOrgId }),
      await lead({ assignee: otherSetterId }),
      await lead({ fields: { setter_handoff: { setter_staff_id: otherSetterId } } }),
      await lead({ fields: { crm_archived_at: new Date().toISOString() } }),
      await lead({ done: true })
    ];
    for (const client_id of denied) {
      const result = await listSetterQueue(db, staff, { client_id });
      assert.equal(result.items.some(row => row.client_id === client_id), false);
    }
    const owner = { ...staff, role: "owner" };
    assert.equal((await listSetterQueue(db, owner, { client_id: denied[1] })).items[0].client_id, denied[1]);
  } finally {
    await db.query("ROLLBACK");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM orgs WHERE slug = $1 OR slug = $2", [slug,slug + "-other"])).rows[0].n), 0);
    await db.end();
  }
});
