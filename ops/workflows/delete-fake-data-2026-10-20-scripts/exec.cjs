// One-transaction delete of the planned fake-client rows. Default = dry run (ROLLBACK). --commit to keep.
const fs = require("fs");
const path = require("path");
const { connect, schema, closure, keyExpr, qi, FAKE_SQL, KEEP_SQL } = require("./lib.cjs");
const COMMIT = process.argv.includes("--commit");
const BACKUP_DIR = COMMIT ? "/Users/chrisstanbridge/Developer/fundhub-platform/credentials/backups/delete-fake-data-2026-10-20" : path.join(__dirname, "dry-backup");
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "plan-final.json"), "utf8"));
const LOCKED = ["FH-000513"];
const CONFIG = ["staff", "staff_roles", "orgs", "message_templates", "lenders", "outreach_accounts", "outreach_programs", "products", "product_aliases", "product_entitlements", "entitlement_catalog", "agents", "agent_triggers", "messaging_settings", "cashflow_settings", "marketing_settings", "marketing_offers", "contract_templates", "pipelines", "pipeline_stages", "commission_rules", "affiliate_commission_rules", "compliance_rules", "retention_policy", "waypoint_definitions", "account_signup_policy", "partners", "affiliates"];
let AFF_IDS = [];
const fail = (m) => { throw new Error("ABORT: " + m); };
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
(async () => {
  const c = await connect();
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    // 1. Recount inside the transaction; must match the written plan exactly.
    const fakeAll = (await c.query(`SELECT f.id, cl.client_code FROM (${FAKE_SQL}) f JOIN clients cl ON cl.id::text = f.id`)).rows;
    const fake = fakeAll.filter((r) => !LOCKED.includes(r.client_code)).map((r) => r.id);
    const locked = fakeAll.filter((r) => LOCKED.includes(r.client_code)).map((r) => r.id);
    const keep = (await c.query(KEEP_SQL)).rows.map((r) => r.id);
    const all = (await c.query("SELECT id::text FROM clients")).rows.map((r) => r.id);
    const held = all.filter((id) => !fake.includes(id) && !keep.includes(id) && !locked.includes(id));
    if (!same(fake, plan.fake_client_ids)) fail("fake client list changed since the plan");
    if (!same(keep, plan.keep_client_ids) || keep.length !== 2) fail("kept client list changed");
    if (!same(held, plan.held_client_ids)) fail("held client list changed");
    const F = await closure(c, sch, fake);
    const refs = (await c.query("SELECT id::text FROM affiliate_referrals WHERE client_id::text = ANY($1)", [fake])).rows.map((r) => r.id);
    if (refs.length) { F.del.set("affiliate_referrals", new Set(refs)); F.nulls.delete("affiliate_referrals.client_id"); }
    const nowDel = Object.fromEntries([...F.del].map(([t, s]) => [t, [...s]]));
    const nowNull = Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s]]));
    if (!same(Object.keys(nowDel), Object.keys(plan.del))) fail("table list changed since the plan");
    for (const t of Object.keys(plan.del)) if (!same(nowDel[t], plan.del[t])) fail(`ids for ${t} changed since the plan`);
    if (!same(Object.keys(nowNull), Object.keys(plan.nulls))) fail("set-null list changed");
    for (const t of Object.keys(plan.nulls)) if (!same(nowNull[t], plan.nulls[t])) fail(`set-null ids for ${t} changed`);
    say(`recount matches plan: ${fake.length} clients, ${Object.values(plan.del).reduce((a, x) => a + x.length, 0)} rows in ${Object.keys(plan.del).length} tables`);

    // 2. Fingerprints of everything that must not change.
    const tables = (await c.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1")).rows.map((r) => r.relname);
    const counts = async () => { const m = {}; for (const t of tables) m[t] = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)}`)).rows[0].n; return m; };
    const protectedSets = {};
    for (const [n, ids] of [["keep", keep], ["held", held], ["locked", locked]]) {
      const cl = await closure(c, sch, ids);
      for (const [t, s] of cl.del) { protectedSets[t] = protectedSets[t] || new Set(); s.forEach((k) => protectedSets[t].add(k)); }
    }
    const fp = async () => {
      const m = {};
      for (const [t, s] of Object.entries(protectedSets)) m["protected:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1)`, [[...s]])).rows[0];
      m["config:affiliates-other-rows"] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY x.id::text), '')) AS h FROM affiliates x WHERE x.id::text <> ALL($1)`, [AFF_IDS])).rows[0];
      for (const t of CONFIG) if (tables.includes(t)) m["config:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x`)).rows[0];
      return m;
    };
    AFF_IDS = (await c.query("SELECT DISTINCT affiliate_id::text AS id FROM affiliate_referrals WHERE id::text = ANY($1) AND affiliate_id IS NOT NULL", [plan.del.affiliate_referrals || []])).rows.map((r) => r.id);
    const before = await counts();
    const fpBefore = await fp();
    say(`fingerprinted ${Object.keys(fpBefore).length} protected/config sets; counted ${tables.length} tables`);

    // 3. Backup every row that will be deleted or changed, inside this same snapshot.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const manifest = { taken_at: new Date().toISOString(), commit: COMMIT, reason: "Owner (Chris) 2026-10-20: 'delete data yes' — delete fake test clients except Braum (FH-000507) and the App Store login (client@fundhub.ai). FH-000513 kept (locked sandbox money transfer). 21 real-looking leads held.", tables: {} };
    const dump = async (file, t, ids) => {
      const rows = (await c.query(`SELECT row_to_json(x) AS r FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1) ORDER BY ${keyExpr(sch.pks[t], "x.")}`, [ids])).rows.map((r) => r.r);
      if (rows.length !== ids.length) fail(`backup of ${t} got ${rows.length} rows, expected ${ids.length}`);
      fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify(rows, null, 1));
      const back = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), "utf8"));
      if (back.length !== ids.length) fail(`backup file ${file} reads back ${back.length} rows`);
      manifest.tables[file] = rows.length;
    };
    for (const [t, ids] of Object.entries(plan.del)) await dump(`${t}.json`, t, ids);
    for (const [k, ids] of Object.entries(plan.nulls)) await dump(`${k.split(".")[0]}__set-null-${k.split(".")[1]}.json`, k.split(".")[0], ids);
    const affIds = (await c.query("SELECT DISTINCT affiliate_id::text AS id FROM affiliate_referrals WHERE id::text = ANY($1) AND affiliate_id IS NOT NULL", [plan.del.affiliate_referrals || []])).rows.map((r) => r.id);
    if (affIds.length) await dump("affiliates__balance-recount.json", "affiliates", affIds);
    fs.writeFileSync(path.join(BACKUP_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
    say(`backup written: ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows in ${Object.keys(manifest.tables).length} files -> ${BACKUP_DIR}`);

    // 4. Change. Demo flag first so the delete guards allow test rows; clear document->version loop.
    const d1 = await c.query("UPDATE clients SET is_demo = true WHERE id::text = ANY($1)", [fake]);
    if (d1.rowCount !== fake.length) fail(`is_demo update hit ${d1.rowCount}`);
    if (plan.del.documents) {
      const d2 = await c.query("UPDATE documents SET current_version_id = NULL WHERE id::text = ANY($1)", [plan.del.documents]);
      if (d2.rowCount !== plan.del.documents.length) fail(`documents unlink hit ${d2.rowCount}`);
    }
    const deleted = {};
    for (const t of plan.order) {
      const ids = plan.del[t];
      const r = await c.query(`DELETE FROM ${qi(t)} WHERE ${keyExpr(plan.pks[t])} = ANY($1)`, [ids]);
      deleted[t] = r.rowCount;
      if (r.rowCount !== ids.length) fail(`${t}: deleted ${r.rowCount}, plan ${ids.length}`);
    }
    say("deleted per table: " + plan.order.map((t) => `${t}=${deleted[t]}`).join(" "));

    // 5. Prove it. Fire the end-of-transaction checks now so a dry run tests them too.
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    const after = await counts();
    for (const t of tables) {
      const want = (plan.del[t] || []).length;
      if (before[t] - after[t] !== want) fail(`${t}: table went ${before[t]} -> ${after[t]}, plan says -${want}`);
    }
    for (const [k, ids] of Object.entries(plan.nulls)) {
      const [t, col] = k.split(".");
      const n = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)} WHERE ${keyExpr(sch.pks[t])} = ANY($1) AND ${qi(col)} IS NULL`, [ids])).rows[0].n;
      if (n !== ids.length) fail(`${k}: ${n} of ${ids.length} nulled`);
    }
    const fpAfter = await fp();
    const changedFp = Object.keys(fpBefore).filter((k) => fpBefore[k].h !== fpAfter[k].h || fpBefore[k].n !== fpAfter[k].n);
    const allowed = new Set(affIds.length ? ["config:affiliates"] : []);
    const bad = changedFp.filter((k) => !allowed.has(k));
    if (bad.length) fail("protected rows changed: " + bad.join(", "));
    say(`checks pass: every table dropped exactly the planned count; ${Object.keys(fpBefore).length - changedFp.length} protected/config sets unchanged${changedFp.length ? "; changed (expected): " + changedFp.join(",") : ""}`);
    say(`clients left: ${after.clients} (was ${before.clients})`);
    if (COMMIT) { await c.query("COMMIT"); say("COMMITTED"); } else { await c.query("ROLLBACK"); say("DRY RUN — rolled back, nothing changed"); }
    fs.writeFileSync(path.join(__dirname, COMMIT ? "exec-commit.log" : "exec-dry.log"), log.join("\n") + "\n" + JSON.stringify({ deleted, before_clients: before.clients, after_clients: after.clients }));
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
