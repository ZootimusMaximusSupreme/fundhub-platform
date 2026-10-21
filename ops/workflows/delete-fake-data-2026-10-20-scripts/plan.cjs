// Read-only: build the exact delete plan (ids per table + order). Writes plan-final.json.
const fs = require("fs");
const { connect, schema, closure, keyExpr, qi, FAKE_SQL, KEEP_SQL } = require("./lib.cjs");
const LOCKED = ["FH-000513"]; // a locked sandbox money transfer points at it; cannot be deleted without breaking the lock
(async () => {
  const c = await connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const fakeAll = (await c.query(`SELECT f.id, cl.client_code FROM (${FAKE_SQL}) f JOIN clients cl ON cl.id::text = f.id`)).rows;
    const locked = fakeAll.filter((r) => LOCKED.includes(r.client_code)).map((r) => r.id);
    const fake = fakeAll.filter((r) => !LOCKED.includes(r.client_code)).map((r) => r.id);
    const keep = (await c.query(KEEP_SQL)).rows.map((r) => r.id);
    const all = (await c.query("SELECT id::text FROM clients")).rows.map((r) => r.id);
    const held = all.filter((id) => !fake.includes(id) && !keep.includes(id) && !locked.includes(id));
    const F = await closure(c, sch, fake);
    // Affiliate referrals for fake clients: delete (allowed once the client is demo) instead of leaving orphans.
    const refs = (await c.query("SELECT id::text FROM affiliate_referrals WHERE client_id::text = ANY($1)", [fake])).rows.map((r) => r.id);
    if (refs.length) { F.del.set("affiliate_referrals", new Set(refs)); F.nulls.delete("affiliate_referrals.client_id"); }
    const others = {};
    for (const [n, ids] of [["keep", keep], ["held", held], ["locked", locked]]) others[n] = await closure(c, sch, ids);
    const clashes = [];
    for (const [n, o] of Object.entries(others)) for (const [t, s] of F.del) { const os = o.del.get(t); if (!os) continue; const k = [...s].filter((x) => os.has(x)); if (k.length) clashes.push(`${n}:${t}=${k.length}`); }
    // Explicit check: no planned row carries a kept/held/locked client id in any client-ish column.
    const protectedIds = [...keep, ...held, ...locked];
    const colHits = [];
    for (const [t, s] of F.del) {
      const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND data_type='uuid' AND column_name ~ 'client'`, [t])).rows.map((r) => r.column_name);
      for (const col of cols) {
        const n = (await c.query(`SELECT count(*)::int AS n FROM ${qi(t)} WHERE ${keyExpr(sch.pks[t])} = ANY($1) AND ${qi(col)}::text = ANY($2)`, [[...s], protectedIds])).rows[0].n;
        if (n) colHits.push(`${t}.${col}=${n}`);
      }
    }
    // Order: children before parents (topological on FK edges inside the delete set).
    const tables = [...F.del.keys()];
    const edges = sch.fks.filter((f) => F.del.has(f.child) && F.del.has(f.parent) && f.child !== f.parent);
    const order = []; const done = new Set(); const visiting = new Set(); const cycles = [];
    const visit = (t) => { if (done.has(t)) return; if (visiting.has(t)) { cycles.push(t); return; } visiting.add(t);
      for (const e of edges.filter((e) => e.parent === t)) visit(e.child); visiting.delete(t); done.add(t); order.push(t); };
    tables.forEach(visit);
    const plan = {
      made_at: new Date().toISOString(), fake_client_ids: fake, locked_client_ids: locked, keep_client_ids: keep, held_client_ids: held,
      del: Object.fromEntries([...F.del].map(([t, s]) => [t, [...s].sort()])), nulls: Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s].sort()])),
      pks: Object.fromEntries(tables.map((t) => [t, sch.pks[t]])), order, cycles, clashes, colHits,
      keepClosure: Object.fromEntries([...others.keep.del].map(([t, s]) => [t, s.size])),
      heldClosure: Object.fromEntries([...others.held.del].map(([t, s]) => [t, s.size])),
      lockedClosure: Object.fromEntries([...others.locked.del].map(([t, s]) => [t, s.size])),
    };
    fs.writeFileSync("plan-final.json", JSON.stringify(plan, null, 1));
    console.log("fake", fake.length, "locked", locked.length, "keep", keep.length, "held", held.length, "all", all.length);
    console.log("order:", order.map((t) => `${t}=${F.del.get(t).size}`).join("  "));
    console.log("total rows:", [...F.del.values()].reduce((a, s) => a + s.size, 0));
    console.log("nulls:", JSON.stringify(Object.fromEntries([...F.nulls].map(([t, s]) => [t, s.size]))));
    console.log("cycles:", cycles.join(",") || "none", "| clashes:", clashes.join(",") || "none", "| protected-id hits:", colHits.join(",") || "none");
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
})().catch((e) => { console.error("ERR", e.stack); process.exit(1); });
