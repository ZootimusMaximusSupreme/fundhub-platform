const fs = require("fs");
const { Client } = require("/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/awesome-shaw-4103bc/node_modules/pg");
const env = fs.readFileSync("/Users/chrisstanbridge/Developer/fundhub-platform/.env", "utf8");
const URL_ = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
async function connect() {
  const c = new Client({ connectionString: URL_, ssl: { rejectUnauthorized: false } });
  await c.connect();
  return c;
}
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// Fake = test email patterns. Never Bram (FH-000507) or the App Store login (client@fundhub.ai).
const FAKE_SQL = `
  SELECT id::text FROM clients
  WHERE email ~* '(@example\\.(com|test)$|@test\\.fundhub\\.ai$|^e2e\\+|@demo\\.fundhub\\.local$|^csmq-|^stanbridgejchris|^bakerskater987|^stanbridgelargecoc|^stanbrdgejchris@|^info@fundhub\\.ai$|^balls@gmail\\.com$|^bigboy@littleboy\\.com$)'
    AND client_code IS DISTINCT FROM 'FH-000507'
    AND client_master_key IS DISTINCT FROM 'FDH-TEST-CLIENT-ROLE-ACCOUNT'
    AND lower(email) <> 'client@fundhub.ai'`;
const KEEP_SQL = `SELECT id::text FROM clients WHERE client_code = 'FH-000507' OR client_master_key = 'FDH-TEST-CLIENT-ROLE-ACCOUNT' OR lower(email) = 'client@fundhub.ai'`;

async function schema(c) {
  const fks = (await c.query(`
    SELECT co.conname, co.conrelid::regclass::text AS child, co.confrelid::regclass::text AS parent, co.confdeltype AS del,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(co.conkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid=co.conrelid AND a.attnum=k.n) AS ccols,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(co.confkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid=co.confrelid AND a.attnum=k.n) AS pcols
    FROM pg_constraint co WHERE co.contype='f' AND co.connamespace='public'::regnamespace`)).rows;
  const pks = {};
  for (const r of (await c.query(`
    SELECT i.indrelid::regclass::text AS t, array_agg(a.attname::text ORDER BY k.ord) AS cols
    FROM pg_index i JOIN unnest(i.indkey) WITH ORDINALITY k(n, ord) ON true JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n
    WHERE i.indisprimary AND i.indrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) GROUP BY 1`)).rows) pks[r.t] = r.cols;
  return { fks, pks };
}
const keyExpr = (cols, alias = "") => cols.length === 1 ? `${alias}${qi(cols[0])}::text` : `concat_ws('|', ${cols.map((x) => `${alias}${qi(x)}::text`).join(", ")})`;

// Walk every foreign key down from the starting clients. Returns delete set and set-null effects.
async function closure(c, sch, startIds, startTable = "clients", extraStarts = {}) {
  const del = new Map([[startTable, new Set(startIds)]]);
  for (const [t, ids] of Object.entries(extraStarts)) del.set(t, new Set(ids));
  const nulls = new Map(); // "child.cols" -> Set(child pk)
  let frontier = new Map([...del].map(([t, s]) => [t, new Set(s)]));
  const missingPk = new Set();
  while (frontier.size) {
    const next = new Map();
    for (const [parent, ids] of frontier) {
      if (!ids.size) continue;
      const ppk = sch.pks[parent];
      for (const fk of sch.fks.filter((f) => f.parent === parent)) {
        const cpk = sch.pks[fk.child];
        if (!cpk) { missingPk.add(fk.child); }
        const ck = cpk ? keyExpr(cpk, "ch.") : "ch.ctid::text";
        const sql = `SELECT DISTINCT ${ck} AS k FROM ${qi(fk.child)} ch
          WHERE (${fk.ccols.map((x) => "ch." + qi(x)).join(", ")}) IN (SELECT ${fk.pcols.map((x) => "p." + qi(x)).join(", ")} FROM ${qi(parent)} p WHERE ${keyExpr(ppk, "p.")} = ANY($1::text[]))`;
        const rows = (await c.query(sql, [[...ids]])).rows.map((r) => r.k);
        if (!rows.length) continue;
        if (fk.del === "n" || fk.del === "d") {
          const key = `${fk.child}.${fk.ccols.join("+")}`;
          if (!nulls.has(key)) nulls.set(key, new Set());
          rows.forEach((k) => nulls.get(key).add(k));
          continue;
        }
        if (!del.has(fk.child)) del.set(fk.child, new Set());
        const set = del.get(fk.child);
        for (const k of rows) if (!set.has(k)) { set.add(k); if (!next.has(fk.child)) next.set(fk.child, new Set()); next.get(fk.child).add(k); }
      }
    }
    frontier = next;
  }
  // Drop set-null rows that are deleted anyway.
  for (const [key, set] of nulls) { const t = key.split(".")[0]; const d = del.get(t); if (d) for (const k of [...set]) if (d.has(k)) set.delete(k); if (!set.size) nulls.delete(key); }
  return { del, nulls, missingPk: [...missingPk] };
}
const FAKE_EVENT_SQL = `
  WITH ev AS (
    SELECT e.id::text AS id, e.name, e.is_demo,
      ARRAY(SELECT DISTINCT lower(m[1]) FROM regexp_matches(e.payload::text, '([A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]+)', 'g') m) AS ems
    FROM events e
    WHERE e.client_id IS NULL
      AND e.name ~ '^(entry\\.captured|survey\\.submitted|slo\\.contact_started|slo\\.checkout_started|rb2b\\.visitor_identified|booking\\.[a-z_]+|call\\.completed|round\\.[a-z_]+|repair\\.round\\.escalated)$'
  )
  SELECT id FROM ev
  WHERE NOT EXISTS (SELECT 1 FROM failed_events f WHERE f.event_id::text = ev.id)
    AND ((cardinality(ems) = 0 AND is_demo)
     OR (cardinality(ems) > 0 AND NOT EXISTS (SELECT 1 FROM unnest(ems) x WHERE x !~ '(@example\\.(com|test)$|@test\\.fundhub\\.ai$|^e2e\\+|@demo\\.fundhub\\.local$|^csmq-|^stanbridgejchris|^bakerskater987|^stanbridgelargecoc|^stanbrdgejchris@|^balls@gmail\\.com$|^bigboy@littleboy\\.com$|@fundhub\\.ai$)')))`;
const FAKE_TX = ['2b057970-1882-45b2-9344-5e4abd6b29e8', 'c3301a1f-3069-4f18-a4ac-46d8cf1c1a89'];
module.exports = { FAKE_EVENT_SQL, FAKE_TX, connect, schema, closure, keyExpr, qi, FAKE_SQL, KEEP_SQL };
