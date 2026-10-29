// Real isolated Postgres proof for explicit furnisher address ID scoping.
// No production DB allowed: CI=true, loopback host, /fundhub_ci database.
// All records are transaction-local TEMP shadows; rollback always, no provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolveLetterRouting } from "./send.mjs";

const SAFE = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("repair furnisher address ID is tenant-owned or shared, never foreign (real disposable PG)",
  { skip: SAFE ? false : "requires localhost CI fundhub_ci scratch database" }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("CREATE TEMP TABLE furnisher_mail_addresses (id uuid, org_id uuid, active boolean, name text, address_line1 text, address_line2 text, city text, state text, zip text, country text)");
      const org = randomUUID(), foreignOrg = randomUUID();
      const own = randomUUID(), foreign = randomUUID(), shared = randomUUID(), disabled = randomUUID();
      await conn.query(
        "INSERT INTO furnisher_mail_addresses (id,org_id,active,name,address_line1,city,state,zip,country) VALUES ($1,$2,true,'Own address','1 Own Road','Austin','TX','73301','US'),($3,$4,true,'Foreign address','2 Secret Road','Denver','CO','80201','US'),($5,NULL,true,'Shared address','3 Shared Road','Mesa','AZ','85201','US'),($6,$2,false,'Inactive address','4 Old Road','Mesa','AZ','85201','US')",
        [own, org, foreign, foreignOrg, shared, disabled]
      );
      const route = (id, extra = {}) => resolveLetterRouting(conn, {
        target: "furnisher", bureau: "EX", furnisherAddressId: id, ...extra
      }, { orgId: org });

      const owned = await route(own);
      assert.equal(owned.refusal, null);
      assert.equal(owned.to.address_line1, "1 Own Road");

      const global = await route(shared);
      assert.equal(global.refusal, null);
      assert.equal(global.to.address_line1, "3 Shared Road");

      const crossOrg = await route(foreign);
      assert.equal(crossOrg.refusal, "furnisher_address_not_found_or_not_owned");
      assert.equal(crossOrg.to, null);
      const override = await route(foreign, { to: { address_line1: "fake override" } });
      assert.equal(override.refusal, "furnisher_address_not_found_or_not_owned");
      assert.equal((await route(disabled)).refusal, "furnisher_address_not_found_or_not_owned");
      assert.equal((await route(randomUUID())).refusal, "furnisher_address_not_found_or_not_owned");
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await pool.end();
    }
  });
