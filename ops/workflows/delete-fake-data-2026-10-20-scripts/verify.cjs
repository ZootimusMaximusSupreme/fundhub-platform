const fs = require("fs");
const { connect, schema, closure, keyExpr, qi } = require("./lib.cjs");
const plan = JSON.parse(fs.readFileSync(__dirname + "/plan-final.json", "utf8"));
(async () => {
  const c = await connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const left = {};
    for (const [t, ids] of Object.entries(plan.del)) { const n = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)} WHERE ${keyExpr(plan.pks[t])} = ANY($1)`, [ids])).rows[0].n; if (n) left[t] = n; }
    console.log("planned rows still present:", JSON.stringify(left) === "{}" ? "none" : JSON.stringify(left));
    console.log("clients now:", (await c.query("SELECT count(*)::int AS n FROM clients")).rows[0].n);
    for (const [n, ids, want] of [["keep", plan.keep_client_ids, plan.keepClosure], ["held", plan.held_client_ids, plan.heldClosure], ["locked", plan.locked_client_ids, plan.lockedClosure]]) {
      const cl = await closure(c, sch, ids);
      const got = Object.fromEntries([...cl.del].map(([t, s]) => [t, s.size]));
      const diff = [...new Set([...Object.keys(got), ...Object.keys(want)])].filter((t) => got[t] !== want[t]).map((t) => `${t}: ${want[t]}->${got[t]}`);
      console.log(`${n} clients (${ids.length}): linked rows ${diff.length ? "CHANGED " + diff.join(", ") : "same as plan (" + Object.values(got).reduce((a, b) => a + b, 0) + " rows)"}`);
    }
    const bram = (await c.query("SELECT client_code, is_demo, updated_at FROM clients WHERE client_code='FH-000507'")).rows[0];
    const app = (await c.query("SELECT client_code, is_demo, updated_at FROM clients WHERE client_master_key='FDH-TEST-CLIENT-ROLE-ACCOUNT'")).rows[0];
    const appAcct = (await c.query("SELECT kind, status FROM accounts WHERE lower(email)='client@fundhub.ai'")).rows;
    console.log("Braum:", JSON.stringify(bram), "| App Store client:", JSON.stringify(app), "login:", JSON.stringify(appAcct));
    console.log("staff:", (await c.query("SELECT count(*)::int AS n FROM staff")).rows[0].n, "| non-client logins:", (await c.query("SELECT count(*)::int AS n FROM accounts WHERE kind <> 'client'")).rows[0].n, "| funding_rounds:", (await c.query("SELECT count(*)::int AS n FROM funding_rounds")).rows[0].n, "| bookings:", (await c.query("SELECT count(*)::int AS n FROM bookings")).rows[0].n, "| invoices:", (await c.query("SELECT count(*)::int AS n FROM invoices")).rows[0].n);
    console.log("templates:", (await c.query("SELECT count(*)::int AS n FROM message_templates")).rows[0].n, "| lenders:", (await c.query("SELECT count(*)::int AS n FROM lenders")).rows[0].n, "| outreach_accounts:", (await c.query("SELECT count(*)::int AS n FROM outreach_accounts")).rows[0].n, "| products:", (await c.query("SELECT count(*)::int AS n FROM products")).rows[0].n, "| agents:", (await c.query("SELECT count(*)::int AS n FROM agents")).rows[0].n);
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
