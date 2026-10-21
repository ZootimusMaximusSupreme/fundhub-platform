// READ ONLY prep: what a delete of the non-client test fixtures would touch. No writes.
const fs = require("fs");
const { connect, schema, closure, keyExpr, qi } = require("./lib.cjs");
(async () => {
  const c = await connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SELECT set_config('fundhub.actor', 'staff', true)");
    const sch = await schema(c);
    const cols = (await c.query("SELECT string_agg(column_name, ',') AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='partners'")).rows[0].c;
    console.log("partners cols:", cols);
    const parts = (await c.query(`SELECT id::text, slug, created_at FROM partners WHERE created_at >= '2026-10-11' AND created_at < '2026-10-13'
      AND slug ~ '(pg-test|^ep-test-|^soc-test-|^cmptest-partner|^principalread-)' ORDER BY slug`)).rows;
    console.log("test partners:", parts.length, parts.map((p) => p.slug).join(", "));
    const aff = ["25626700-0785-468e-b48b-fe3f3b92d0da"];
    const F = await closure(c, sch, parts.map((p) => p.id), "partners", { affiliates: aff });
    const trig = (await c.query(`SELECT DISTINCT t.tgrelid::regclass::text AS t FROM pg_trigger t WHERE NOT t.tgisinternal AND (t.tgtype & 8) <> 0 AND (t.tgtype & 2) <> 0 AND t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)`)).rows.map((r) => r.t);
    const nopriv = (await c.query(`SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT has_table_privilege('fundhub_app', oid, 'DELETE')`)).rows.map((r) => r.relname);
    console.log("closure:", [...F.del].map(([t, s]) => `${t}=${s.size}${trig.includes(t) ? "(guard)" : ""}${nopriv.includes(t) ? "(NO DELETE RIGHT)" : ""}`).join("  "));
    console.log("set-null:", JSON.stringify(Object.fromEntries([...F.nulls].map(([t, s]) => [t, s.size]))));
    const keep = (await c.query("SELECT slug FROM partners WHERE id::text LIKE ANY(ARRAY['55272246%','c889dd9a%','724e59dd%'])")).rows.map((r) => r.slug);
    const hit = (F.del.get("partners") ? [...F.del.get("partners")] : []);
    const keepIds = (await c.query("SELECT id::text FROM partners WHERE id::text LIKE ANY(ARRAY['55272246%','c889dd9a%','724e59dd%'])")).rows.map((r) => r.id);
    console.log("kept partners:", keep.join(", "), "| any kept partner in closure:", hit.some((x) => keepIds.includes(x)));
    fs.writeFileSync("plan3-prep.json", JSON.stringify({ partners: parts, del: Object.fromEntries([...F.del].map(([t, s]) => [t, [...s]])), nulls: Object.fromEntries([...F.nulls].map(([t, s]) => [t, [...s]])) }));
  } finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
