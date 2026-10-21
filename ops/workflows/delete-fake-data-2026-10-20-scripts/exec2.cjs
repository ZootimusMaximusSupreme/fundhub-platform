// Round 2: client-less fake lead/booking/call/round events + 2 client-less test payments. Dry run unless --commit.
const fs = require("fs");
const path = require("path");
const { connect, schema, closure, keyExpr, qi, FAKE_SQL, KEEP_SQL, FAKE_EVENT_SQL, FAKE_TX } = require("./lib.cjs");
const COMMIT = process.argv.includes("--commit");
const BACKUP_DIR = COMMIT ? "/Users/chrisstanbridge/Developer/fundhub-platform/credentials/backups/delete-fake-data-2026-10-20/round2" : path.join(__dirname, "dry-backup2");
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, "plan2.json"), "utf8"));
const CONFIG = ["staff", "staff_roles", "orgs", "message_templates", "lenders", "outreach_accounts", "outreach_programs", "products", "product_aliases", "product_entitlements", "entitlement_catalog", "agents", "agent_triggers", "messaging_settings", "cashflow_settings", "marketing_settings", "marketing_offers", "contract_templates", "pipelines", "pipeline_stages", "commission_rules", "affiliate_commission_rules", "compliance_rules", "retention_policy", "waypoint_definitions", "account_signup_policy", "partners", "affiliates", "clients", "bookings"];
const fail = (m) => { throw new Error("ABORT: " + m); };
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
(async () => {
  const c = await connect();
  const log = []; const say = (s) => { log.push(s); console.log(s); };
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const ev = (await c.query(FAKE_EVENT_SQL)).rows.map((r) => r.id);
    if (!same(ev, plan.event_ids)) fail(`fake event list changed (${ev.length} vs ${plan.event_ids.length})`);
    const F = await closure(c, sch, ev, "events", { transactions: FAKE_TX });
    const nowDel = Object.fromEntries([...F.del].map(([t, s]) => [t, [...s]]));
    const nowNull = Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s]]));
    if (!same(Object.keys(nowDel), Object.keys(plan.del))) fail("table list changed");
    for (const t of Object.keys(plan.del)) if (!same(nowDel[t], plan.del[t])) fail(`ids for ${t} changed`);
    for (const t of Object.keys(plan.nulls)) if (!same(nowNull[t] || [], plan.nulls[t])) fail(`set-null ids for ${t} changed`);
    const tx = (await c.query("SELECT count(*)::int AS n FROM transactions WHERE id::text = ANY($1) AND client_id IS NULL AND raw_payload::text ~* '(bakerskater987\\+test|test\\+crs@fundhub\\.ai)'", [FAKE_TX])).rows[0].n;
    if (tx !== 2) fail("test payments not as expected");
    say(`recount matches plan: ${plan.del.events.length} events, ${plan.del.transactions.length} transactions`);

    const tables = (await c.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1")).rows.map((r) => r.relname);
    const counts = async () => { const m = {}; for (const t of tables) m[t] = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)}`)).rows[0].n; return m; };
    const fake = (await c.query(FAKE_SQL)).rows.map((r) => r.id);
    const all = (await c.query("SELECT id::text FROM clients")).rows.map((r) => r.id);
    const protectedSets = {};
    const cl = await closure(c, sch, all.filter((id) => !fake.includes(id)).concat(fake)); // every remaining client and its rows
    for (const [t, s] of cl.del) protectedSets[t] = s;
    const fp = async () => {
      const m = {};
      for (const [t, s] of Object.entries(protectedSets)) m["clientrows:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1)`, [[...s]])).rows[0];
      for (const t of CONFIG) m["config:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x`)).rows[0];
      for (const t of ["events", "transactions"]) m["other-rows:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY x.id::text), '')) AS h FROM ${qi(t)} x WHERE x.id::text <> ALL($1)`, [plan.del[t]])).rows[0];
      return m;
    };
    const before = await counts();
    const fpBefore = await fp();
    say(`fingerprinted ${Object.keys(fpBefore).length} sets (every client's rows, config, all other events and payments); counted ${tables.length} tables`);

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const manifest = { taken_at: new Date().toISOString(), commit: COMMIT, reason: "Round 2 of owner-approved fake data delete (2026-10-20): client-less fake lead/booking/call/round events (test emails or demo flag only) and 2 client-less test payments.", tables: {} };
    const dump = async (file, t, ids) => {
      const rows = (await c.query(`SELECT row_to_json(x) AS r FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1) ORDER BY ${keyExpr(sch.pks[t], "x.")}`, [ids])).rows.map((r) => r.r);
      if (rows.length !== ids.length) fail(`backup of ${t} got ${rows.length}, expected ${ids.length}`);
      fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify(rows, null, 1));
      if (JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), "utf8")).length !== ids.length) fail(`backup ${file} read-back short`);
      manifest.tables[file] = rows.length;
    };
    for (const [t, ids] of Object.entries(plan.del)) await dump(`${t}.json`, t, ids);
    for (const [k, ids] of Object.entries(plan.nulls)) await dump(`${k.split(".")[0]}__set-null-${k.split(".")[1]}.json`, k.split(".")[0], ids);
    fs.writeFileSync(path.join(BACKUP_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
    say(`backup written: ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows -> ${BACKUP_DIR}`);

    const deleted = {};
    for (const t of plan.order) {
      const r = await c.query(`DELETE FROM ${qi(t)} WHERE ${keyExpr(plan.pks[t])} = ANY($1)`, [plan.del[t]]);
      deleted[t] = r.rowCount;
      if (r.rowCount !== plan.del[t].length) fail(`${t}: deleted ${r.rowCount}, plan ${plan.del[t].length}`);
    }
    say("deleted: " + plan.order.map((t) => `${t}=${deleted[t]}`).join(" "));
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    const after = await counts();
    for (const t of tables) { const want = (plan.del[t] || []).length; if (before[t] - after[t] !== want) fail(`${t}: ${before[t]} -> ${after[t]}, plan -${want}`); }
    for (const [k, ids] of Object.entries(plan.nulls)) { const [t, col] = k.split("."); const n = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)} WHERE ${keyExpr(sch.pks[t])} = ANY($1) AND ${qi(col)} IS NULL`, [ids])).rows[0].n; if (n !== ids.length) fail(`${k}: ${n}/${ids.length} nulled`); }
    const fpAfter = await fp();
    const bad = Object.keys(fpBefore).filter((k) => fpBefore[k].h !== fpAfter[k].h || fpBefore[k].n !== fpAfter[k].n);
    if (bad.length) fail("protected rows changed: " + bad.join(", "));
    say(`checks pass: tables dropped exactly the plan; all ${Object.keys(fpBefore).length} protected sets unchanged`);
    if (COMMIT) { await c.query("COMMIT"); say("COMMITTED"); } else { await c.query("ROLLBACK"); say("DRY RUN — rolled back"); }
    fs.writeFileSync(path.join(__dirname, COMMIT ? "exec2-commit.log" : "exec2-dry.log"), log.join("\n"));
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("ROLLED BACK —", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();
