// Scratch Postgres proof: two parallel MFA challenges cannot reuse one TOTP.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { createMfaChallenge, beginMfaSetup, verifyMfaChallenge, totpAt } from "./mfa.mjs";

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const env = { MFA_REQUIRED: "1", MFA_SECRET_ENC_KEY: randomBytes(32).toString("base64") };

describe("staff MFA concurrent proof in scratch Postgres", {
  skip: !isLocalScratchDatabaseUrl(url) ? "local scratch app-role database required" : false
}, () => {
  let pool, orgId, staffId;

  before(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 });
    const role = (await pool.query(
      `SELECT current_user AS name, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.equal(role.name, "fundhub_app");
    assert.equal(role.rolsuper || role.rolbypassrls, false);
    orgId = (await pool.query(
      `INSERT INTO orgs (slug,name) VALUES ($1,'MFA scratch proof') RETURNING id`,
      [`mfa-proof-${randomUUID()}`])).rows[0].id;
    staffId = (await pool.query(
      `INSERT INTO staff (org_id,email,name,role,status)
       VALUES ($1,$2,'MFA Tester','closer','active') RETURNING id`,
      [orgId, `e2e+mfa-${randomUUID()}@example.test`])).rows[0].id;
  });

  after(async () => {
    if (!pool) return;
    try {
      if (staffId) await pool.query(`DELETE FROM staff WHERE id=$1`, [staffId]);
      if (orgId) await pool.query(`DELETE FROM orgs WHERE id=$1`, [orgId]);
    } finally { await pool.end(); }
  });

  test("one TOTP counter mints exactly one session across parallel challenges", async () => {
    const first = await createMfaChallenge(pool, { staffId, orgId });
    const second = await createMfaChallenge(pool, { staffId, orgId });
    const setup = await beginMfaSetup(pool, { mfaToken: first.token, env });
    assert.equal(setup.ok, true);
    const at = Date.now();
    const code = totpAt(setup.secret, Math.floor(at / 30000));
    const results = await Promise.all([
      verifyMfaChallenge(pool, { mfaToken: first.token, code, at, env }),
      verifyMfaChallenge(pool, { mfaToken: second.token, code, at, env })
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.error === "invalid_mfa_code").length, 1);
    const sessions = await pool.query(`SELECT count(*)::int AS n FROM sessions WHERE staff_id=$1`, [staffId]);
    assert.equal(sessions.rows[0].n, 1);
  });
});
