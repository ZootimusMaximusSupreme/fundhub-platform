// Plan builders for rounds 3 and 4. Each returns { del, nulls, order, pks, demoClients, demoPartners, info } from live data.
const { closure, keyExpr, qi, KEEP_SQL } = require("./lib.cjs");
const { REAL_EVENT_SQL, LOCKED } = require("./plan3c.cjs");
const TEST_EMAIL_RE = "(@example\\\\.(com|test)$|@test\\\\.fundhub\\\\.ai$|^e2e\\\\+|@demo\\\\.fundhub\\\\.local$|^csmq-|^stanbridgejchris|^bakerskater987|^stanbridgelargecoc|^stanbrdgejchris@|^balls@gmail\\\\.com$|^bigboy@littleboy\\\\.com$|@fundhub\\\\.ai$)";
const toObj = (m) => Object.fromEntries([...m].map(([t, s]) => [t, [...s].sort()]));
function orderOf(sch, del) {
  const edges = sch.fks.filter((f) => del.has(f.child) && del.has(f.parent) && f.child !== f.parent);
  const order = []; const done = new Set(); const vis = new Set();
  const visit = (t) => { if (done.has(t) || vis.has(t)) return; vis.add(t); for (const e of edges.filter((e) => e.parent === t)) visit(e.child); vis.delete(t); done.add(t); order.push(t); };
  [...del.keys()].forEach(visit);
  return order;
}
function dropNullsInDel(F) { for (const [key, set] of [...F.nulls]) { const d = F.del.get(key.split(".")[0]); if (d) for (const k of [...set]) if (d.has(k)) set.delete(k); if (!set.size) F.nulls.delete(key); } }

async function round3(c, sch) {
  const keep = (await c.query(KEEP_SQL)).rows.map((r) => r.id);
  const locked = (await c.query("SELECT id::text FROM clients WHERE client_code = ANY($1)", [LOCKED])).rows.map((r) => r.id);
  const targets = (await c.query("SELECT id::text FROM clients WHERE NOT (id::text = ANY($1))", [[...keep, ...locked]])).rows.map((r) => r.id);
  const ev = (await c.query(REAL_EVENT_SQL)).rows.map((r) => r.id);
  const F = await closure(c, sch, targets, "clients", { events: ev });
  const refs = (await c.query("SELECT id::text FROM affiliate_referrals WHERE client_id::text = ANY($1)", [targets])).rows.map((r) => r.id);
  if (refs.length) { F.del.set("affiliate_referrals", new Set([...(F.del.get("affiliate_referrals") || []), ...refs])); F.nulls.delete("affiliate_referrals.client_id"); }
  dropNullsInDel(F);
  return { del: toObj(F.del), nulls: toObj(F.nulls), order: orderOf(sch, F.del), pks: Object.fromEntries([...F.del.keys()].map((t) => [t, sch.pks[t]])), demoClients: targets, demoPartners: [], protectClients: [...keep, ...locked], info: { clients: targets.length, leadEvents: ev.length } };
}

const TEST_PARTNER_SQL = `SELECT id::text FROM partners WHERE created_at >= '2026-10-11' AND created_at < '2026-10-13' AND slug ~ '(pg-test|^ep-test-|^soc-test-|^cmptest-partner|^principalread-)'`;
const FAKE_OTHER_EVENT_SQL = `
  WITH ev AS (
    SELECT e.id::text AS id, e.is_demo, e.payload::text AS p,
      ARRAY(SELECT DISTINCT lower(m[1]) FROM regexp_matches(e.payload::text, '([A-Za-z0-9._%+\\\\-]+@[A-Za-z0-9.\\\\-]+\\\\.[A-Za-z]+)', 'g') m) AS ems
    FROM events e WHERE e.client_id IS NULL AND NOT EXISTS (SELECT 1 FROM failed_events f WHERE f.event_id = e.id))
  SELECT id FROM ev WHERE p !~* '(bramselleslach|client@fundhub\\\\.ai)'
    AND ((cardinality(ems) = 0 AND is_demo) OR (cardinality(ems) > 0 AND NOT EXISTS (SELECT 1 FROM unnest(ems) x WHERE x !~ '${TEST_EMAIL_RE}')))`;
const CONTENT_QUEUE_DEMO = ["60735863-198a-402e-9cf7-5204bef5c93f"];
const TEST_AFFILIATE = ["25626700-0785-468e-b48b-fe3f3b92d0da"];
async function round4(c, sch) {
  const partners = (await c.query(TEST_PARTNER_SQL)).rows.map((r) => r.id);
  const ev = (await c.query(FAKE_OTHER_EVENT_SQL)).rows.map((r) => r.id);
  const cq = (await c.query("SELECT q.id::text FROM marketing_content_queue q JOIN partners p ON p.id = q.partner_id WHERE q.id::text = ANY($1) AND p.is_demo", [CONTENT_QUEUE_DEMO])).rows.map((r) => r.id);
  const F = await closure(c, sch, partners, "partners", { affiliates: TEST_AFFILIATE, events: ev, marketing_content_queue: cq });
  // Pin rows the database never lets go (always-raise delete guards, or no delete right), then pin every parent they point at.
  const hard = (await c.query(`SELECT DISTINCT t.tgrelid::regclass::text AS t FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND (t.tgtype & 8) <> 0 AND (t.tgtype & 2) <> 0 AND t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
        AND pg_get_functiondef(p.oid) !~* 'is_demo'`)).rows.map((r) => r.t);
  const nopriv = (await c.query(`SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT has_table_privilege('fundhub_app', oid, 'DELETE')`)).rows.map((r) => r.relname);
  const pinned = new Map();
  for (const [t, s] of F.del) if (hard.includes(t) || nopriv.includes(t)) pinned.set(t, new Set(s));
  let grew = true;
  while (grew) {
    grew = false;
    for (const fk of sch.fks) {
      const ps = pinned.get(fk.child); const pd = F.del.get(fk.parent);
      if (!ps || !ps.size || !pd || fk.child === fk.parent && false) continue;
      const rows = (await c.query(`SELECT DISTINCT ${keyExpr(sch.pks[fk.parent], "p.")} AS k FROM ${qi(fk.parent)} p JOIN ${qi(fk.child)} ch ON (${fk.ccols.map((x, i) => `ch.${qi(x)} = p.${qi(fk.pcols[i])}`).join(" AND ")}) WHERE ${keyExpr(sch.pks[fk.child], "ch.")} = ANY($1) AND ${keyExpr(sch.pks[fk.parent], "p.")} = ANY($2)`, [[...ps], [...pd]])).rows.map((r) => r.k);
      for (const k of rows) { if (!pinned.has(fk.parent)) pinned.set(fk.parent, new Set()); const s = pinned.get(fk.parent); if (!s.has(k)) { s.add(k); grew = true; } }
    }
  }
  for (const [t, s] of pinned) { const d = F.del.get(t); for (const k of s) d.delete(k); if (!d.size) F.del.delete(t); }
  // Set-null effects that would touch pinned rows are not allowed.
  dropNullsInDel(F);
  const pinnedNull = [...F.nulls].filter(([key, s]) => { const p = pinned.get(key.split(".")[0]); return p && [...s].some((k) => p.has(k)); }).map(([k]) => k);
  if (pinnedNull.length) throw new Error("set-null would touch locked rows: " + pinnedNull.join(","));
  const demoPartners = [...(pinned.get("partners") || [])];
  return { del: toObj(F.del), nulls: toObj(F.nulls), order: orderOf(sch, F.del), pks: Object.fromEntries([...F.del.keys()].map((t) => [t, sch.pks[t]])), demoClients: [], demoPartners, pinned: toObj(pinned), protectClients: [], info: { partners: partners.length, events: ev.length, contentQueue: cq.length } };
}
module.exports = { round3, round4 };
