// Round 3 plan (read only): the 21 held clients + client-less events carrying any non-test email (leads saved by Chris).
const fs = require("fs");
const { connect, schema, closure, keyExpr, qi, KEEP_SQL } = require("./lib.cjs");
const LOCKED = ["FH-000513"];
const REAL_EVENT_SQL = `
  WITH ev AS (
    SELECT e.id::text AS id, ARRAY(SELECT DISTINCT lower(m[1]) FROM regexp_matches(e.payload::text, '([A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]+)', 'g') m) AS ems, e.payload::text AS p
    FROM events e WHERE e.client_id IS NULL AND NOT EXISTS (SELECT 1 FROM failed_events f WHERE f.event_id = e.id))
  SELECT id FROM ev WHERE cardinality(ems) > 0 AND p !~* '(bramselleslach|client@fundhub\\.ai)'
    AND EXISTS (SELECT 1 FROM unnest(ems) x WHERE x !~ '(@example\\.(com|test)$|@test\\.fundhub\\.ai$|^e2e\\+|@demo\\.fundhub\\.local$|^csmq-|^stanbridgejchris|^bakerskater987|^stanbridgelargecoc|^stanbrdgejchris@|^balls@gmail\\.com$|^bigboy@littleboy\\.com$|@fundhub\\.ai$)')`;
module.exports = { REAL_EVENT_SQL, LOCKED };
if (require.main === module) (async () => {
  const c = await connect();
  try {
    await c.query("BEGIN READ ONLY"); await c.query("SELECT set_config('fundhub.actor','staff',true)");
    const sch = await schema(c);
    const keep = (await c.query(KEEP_SQL)).rows.map((r) => r.id);
    const locked = (await c.query("SELECT id::text FROM clients WHERE client_code = ANY($1)", [LOCKED])).rows.map((r) => r.id);
    const targets = (await c.query("SELECT id::text FROM clients WHERE NOT (id::text = ANY($1))", [[...keep, ...locked]])).rows.map((r) => r.id);
    const ev = (await c.query(REAL_EVENT_SQL)).rows.map((r) => r.id);
    const F = await closure(c, sch, targets, "clients", { events: ev });
    const refs = (await c.query("SELECT id::text FROM affiliate_referrals WHERE client_id::text = ANY($1)", [targets])).rows.map((r) => r.id);
    if (refs.length) { F.del.set("affiliate_referrals", new Set([...(F.del.get("affiliate_referrals") || []), ...refs])); F.nulls.delete("affiliate_referrals.client_id"); }
    for (const [key, set] of [...F.nulls]) { const t = key.split(".")[0]; const d = F.del.get(t); if (d) for (const k of [...set]) if (d.has(k)) set.delete(k); if (!set.size) F.nulls.delete(key); }
    const K = await closure(c, sch, [...keep, ...locked]);
    const clash = [...F.del].flatMap(([t, s]) => { const o = K.del.get(t); return o ? [...s].filter((x) => o.has(x)).map(() => t) : []; });
    const tables = [...F.del.keys()];
    const edges = sch.fks.filter((f) => F.del.has(f.child) && F.del.has(f.parent) && f.child !== f.parent);
    const order = []; const done = new Set(); const vis = new Set();
    const visit = (t) => { if (done.has(t) || vis.has(t)) return; vis.add(t); for (const e of edges.filter((e) => e.parent === t)) visit(e.child); vis.delete(t); done.add(t); order.push(t); };
    tables.forEach(visit);
    const plan = { made_at: new Date().toISOString(), client_ids: targets, keep_ids: keep, locked_ids: locked, event_ids: ev, del: Object.fromEntries([...F.del].map(([t, s]) => [t, [...s].sort()])), nulls: Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s].sort()])), pks: Object.fromEntries(tables.map((t) => [t, sch.pks[t]])), order };
    fs.writeFileSync("plan3c.json", JSON.stringify(plan, null, 1));
    console.log("clients", targets.length, "| keep", keep.length, "| locked", locked.length, "| lead events", ev.length);
    console.log("order:", order.map((t) => `${t}=${F.del.get(t).size}`).join("  "));
    console.log("total:", [...F.del.values()].reduce((a, s) => a + s.size, 0), "| nulls:", JSON.stringify(Object.fromEntries([...F.nulls].map(([t, s]) => [t, s.size]))), "| clash with kept:", clash.length ? [...new Set(clash)].join(",") : "none");
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
