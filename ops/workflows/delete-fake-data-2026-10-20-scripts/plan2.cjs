const fs = require("fs");
const { connect, schema, closure, keyExpr, qi, FAKE_EVENT_SQL, FAKE_TX } = require("./lib.cjs");
(async () => {
  const c = await connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const ev = (await c.query(FAKE_EVENT_SQL)).rows.map((r) => r.id);
    const tx = (await c.query("SELECT id::text, client_id, provider_ref, raw_payload::text ~* '(bakerskater987\\+test|test\\+crs@fundhub\\.ai)' AS testy FROM transactions WHERE id::text = ANY($1)", [FAKE_TX])).rows;
    if (tx.length !== 2 || tx.some((t) => t.client_id !== null || !t.testy)) throw new Error("test payments not as expected: " + JSON.stringify(tx));
    const F = await closure(c, sch, ev, "events", { transactions: FAKE_TX });
    const byName = (await c.query("SELECT name, count(*)::int AS n FROM events WHERE id::text = ANY($1) GROUP BY 1 ORDER BY 1", [ev])).rows;
    const tables = [...F.del.keys()];
    const edges = sch.fks.filter((f) => F.del.has(f.child) && F.del.has(f.parent) && f.child !== f.parent);
    const order = []; const done = new Set(); const visiting = new Set();
    const visit = (t) => { if (done.has(t)) return; if (visiting.has(t)) return; visiting.add(t); for (const e of edges.filter((e) => e.parent === t)) visit(e.child); visiting.delete(t); done.add(t); order.push(t); };
    tables.forEach(visit);
    const plan = { made_at: new Date().toISOString(), event_ids: ev, tx_ids: FAKE_TX, del: Object.fromEntries([...F.del].map(([t, s]) => [t, [...s].sort()])), nulls: Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s].sort()])), pks: Object.fromEntries(tables.map((t) => [t, sch.pks[t]])), order, byName };
    fs.writeFileSync("plan2.json", JSON.stringify(plan, null, 1));
    console.log("events by name:", byName.map((r) => `${r.name}=${r.n}`).join("  "));
    console.log("delete:", order.map((t) => `${t}=${F.del.get(t).size}`).join("  "));
    console.log("set-null:", JSON.stringify(Object.fromEntries([...F.nulls].map(([t, s]) => [t, s.size]))));
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
