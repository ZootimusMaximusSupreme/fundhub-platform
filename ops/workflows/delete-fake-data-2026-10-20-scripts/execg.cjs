// Rounds 3/4: one transaction each. node execg.cjs round3|round4 [--commit]
const fs = require("fs"); const path = require("path");
const { connect, schema, closure, keyExpr, qi, KEEP_SQL } = require("./lib.cjs"); const R = require("./rounds.cjs");
const which = process.argv[2]; const COMMIT = process.argv.includes("--commit");
const BACKUP_DIR = COMMIT ? `/Users/chrisstanbridge/Developer/fundhub-platform/credentials/backups/delete-fake-data-2026-10-20/${which}` : path.join(__dirname, `dry-${which}`);
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, `plan-${which}.json`), "utf8"));
const GUARD = ["staff", "staff_roles", "orgs", "message_templates", "lenders", "outreach_accounts", "outreach_programs", "products", "product_aliases", "product_entitlements", "entitlement_catalog", "agents", "agent_triggers", "messaging_settings", "cashflow_settings", "marketing_settings", "marketing_offers", "contract_templates", "pipelines", "pipeline_stages", "commission_rules", "affiliate_commission_rules", "compliance_rules", "retention_policy", "waypoint_definitions", "account_signup_policy", "partners", "affiliates", "accounts", "ad_videos", "brain_files", "marketing_flags", "password_resets", "creative_assets", "action_log", "compliance_screenings", "creative_usage_events", "brand_kits", "ad_scripts", "clients"];
const fail = (m) => { throw new Error("ABORT: " + m); };
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
(async () => {
  const c = await connect(); const log = []; const say = (s) => { log.push(s); console.log(s); };
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const now = await R[which](c, sch);
    if (!same(Object.keys(now.del), Object.keys(plan.del))) fail("table list changed since the plan");
    for (const t of Object.keys(plan.del)) if (!same(now.del[t], plan.del[t])) fail(`ids for ${t} changed since the plan`);
    if (!same(Object.keys(now.nulls), Object.keys(plan.nulls))) fail("set-null list changed");
    if (!same(now.demoPartners, plan.demoPartners) || !same(now.demoClients, plan.demoClients) || !same(now.demoAffiliates || [], plan.demoAffiliates || []) || !same(now.demoStaff || [], plan.demoStaff || [])) fail("demo-flag list changed");
    const total = Object.values(plan.del).reduce((a, x) => a + x.length, 0);
    say(`${which}: recount matches plan: ${total} rows in ${Object.keys(plan.del).length} tables`);
    const tables = (await c.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY 1")).rows.map((r) => r.relname);
    const counts = async () => { const m = {}; for (const t of tables) m[t] = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)}`)).rows[0].n; return m; };
    const keep = (await c.query(KEEP_SQL)).rows.map((r) => r.id);
    const locked = (await c.query("SELECT id::text FROM clients WHERE client_code = 'FH-000513'")).rows.map((r) => r.id);
    const K = await closure(c, sch, [...keep, ...locked]);
    const allowed = { partners: plan.demoPartners, clients: plan.demoClients, affiliates: plan.demoAffiliates || [], staff: plan.demoStaff || [] };
    const fpTables = [...new Set([...GUARD, ...Object.keys(plan.del), ...Object.keys(plan.nulls).map((k) => k.split(".")[0])])].filter((t) => tables.includes(t));
    const fp = async () => {
      const m = {};
      for (const [t, s] of K.del) m["kept-client-rows:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1)`, [[...s]])).rows[0];
      for (const t of fpTables) {
        const skip = [...(plan.del[t] || []), ...(allowed[t] || []), ...Object.entries(plan.nulls).filter(([k]) => k.startsWith(t + ".")).flatMap(([, a]) => a)];
        m["other-rows:" + t] = (await c.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) AS h FROM ${qi(t)} x WHERE NOT (${keyExpr(sch.pks[t], "x.")} = ANY($1))`, [skip])).rows[0];
      }
      return m;
    };
    const before = await counts(); const fpBefore = await fp();
    say(`fingerprinted ${Object.keys(fpBefore).length} sets; counted ${tables.length} tables`);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const manifest = { taken_at: new Date().toISOString(), commit: COMMIT, round: which, reason: which === "round4b" ? "Owner-approved fake events (round 4 follow-up after an escape fix): client-less, test emails only." : which === "round7" ? "Owner (Chris) 2026-10-20 'duh / remove elenda' / 'go': fake staff (incl. Elena Brooks) and fake affiliates; real staff, TEST role logins, App Store login and real-looking affiliates kept." : which === "round3" ? "Owner (Chris) 2026-10-20 'DELETE YES — I HAVE THOSE LEADS SAVED': the 21 held real-looking clients and client-less lead events with real emails." : "Owner (Chris) 2026-10-20 'DELETE YES': non-client test data — Oct-12 test partners (locked ones kept as demo), fake ad accounts/ads, test affiliate, other fake client-less events, demo content-queue row.", tables: {} };
    const dump = async (file, t, ids) => {
      const rows = (await c.query(`SELECT row_to_json(x) AS r FROM ${qi(t)} x WHERE ${keyExpr(sch.pks[t], "x.")} = ANY($1) ORDER BY ${keyExpr(sch.pks[t], "x.")}`, [ids])).rows.map((r) => r.r);
      if (rows.length !== ids.length) fail(`backup of ${t} got ${rows.length}, expected ${ids.length}`);
      fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify(rows, null, 1));
      if (JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), "utf8")).length !== ids.length) fail(`backup ${file} short`);
      manifest.tables[file] = rows.length;
    };
    for (const [t, ids] of Object.entries(plan.del)) await dump(`${t}.json`, t, ids);
    for (const [k, ids] of Object.entries(plan.nulls)) await dump(`${k.split(".")[0]}__set-null-${k.split(".")[1]}.json`, k.split(".")[0], ids);
    if (plan.demoPartners.length) await dump("partners__marked-demo.json", "partners", plan.demoPartners);
    if ((plan.demoAffiliates || []).length) await dump("affiliates__marked-demo.json", "affiliates", plan.demoAffiliates);
    fs.writeFileSync(path.join(BACKUP_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));
    say(`backup written: ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows -> ${BACKUP_DIR}`);
    if (plan.demoClients.length) { const r = await c.query("UPDATE clients SET is_demo = true WHERE id::text = ANY($1)", [plan.demoClients]); if (r.rowCount !== plan.demoClients.length) fail("client demo flag count"); }
    if ((plan.demoAffiliates || []).length) { const r = await c.query("UPDATE affiliates SET is_demo = true WHERE id::text = ANY($1)", [plan.demoAffiliates]); if (r.rowCount !== plan.demoAffiliates.length) fail("affiliate demo flag count"); }
    if ((plan.demoStaff || []).length) { const r = await c.query("UPDATE staff SET is_demo = true WHERE id::text = ANY($1)", [plan.demoStaff]); if (r.rowCount !== plan.demoStaff.length) fail("staff demo flag count"); }
    if (plan.demoPartners.length) { const r = await c.query("UPDATE partners SET is_demo = true WHERE id::text = ANY($1)", [plan.demoPartners]); if (r.rowCount !== plan.demoPartners.length) fail("partner demo flag count"); }
    if (plan.del.documents) { const r = await c.query("UPDATE documents SET current_version_id = NULL WHERE id::text = ANY($1)", [plan.del.documents]); if (r.rowCount !== plan.del.documents.length) fail("documents unlink count"); }
    const deleted = {};
    for (const t of plan.order) { const r = await c.query(`DELETE FROM ${qi(t)} WHERE ${keyExpr(plan.pks[t])} = ANY($1)`, [plan.del[t]]); deleted[t] = r.rowCount; if (r.rowCount !== plan.del[t].length) fail(`${t}: deleted ${r.rowCount}, plan ${plan.del[t].length}`); }
    say("deleted: " + plan.order.map((t) => `${t}=${deleted[t]}`).join(" "));
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    const after = await counts();
    for (const t of tables) { const want = (plan.del[t] || []).length; if (before[t] - after[t] !== want) fail(`${t}: ${before[t]} -> ${after[t]}, plan -${want}`); }
    for (const [k, ids] of Object.entries(plan.nulls)) { const [t, col] = k.split("."); const n = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)} WHERE ${keyExpr(sch.pks[t])} = ANY($1) AND ${qi(col)} IS NULL`, [ids])).rows[0].n; if (n !== ids.length) fail(`${k} nulled ${n}/${ids.length}`); }
    if (plan.demoPartners.length) { const n = (await c.query("SELECT count(*)::int AS n FROM partners WHERE id::text = ANY($1) AND is_demo", [plan.demoPartners])).rows[0].n; if (n !== plan.demoPartners.length) fail("partners not all demo"); }
    const fpAfter = await fp();
    const bad = Object.keys(fpBefore).filter((k) => fpBefore[k].h !== fpAfter[k].h || fpBefore[k].n !== fpAfter[k].n);
    if (bad.length) fail("rows outside the plan changed: " + bad.join(", "));
    say(`checks pass: every table dropped exactly the plan; ${Object.keys(fpBefore).length} sets outside the plan unchanged`);
    if (COMMIT) { await c.query("COMMIT"); say("COMMITTED"); } else { await c.query("ROLLBACK"); say("DRY RUN — rolled back"); }
    fs.writeFileSync(path.join(__dirname, `${which}-${COMMIT ? "commit" : "dry"}.log`), log.join("\n") + "\n" + JSON.stringify(deleted));
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("ROLLED BACK —", e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();
