// Plan builders for rounds 3 and 4. Each returns { del, nulls, order, pks, demoClients, demoPartners, info } from live data.
const { closure, keyExpr, qi, KEEP_SQL } = require("./lib.cjs");
const { REAL_EVENT_SQL, LOCKED } = require("./plan3c.cjs");
const TEST_EMAIL_RE = "(@example\\.(com|test)$|@test\\.fundhub\\.ai$|^e2e\\+|@demo\\.fundhub\\.local$|^csmq-|^stanbridgejchris|^bakerskater987|^stanbridgelargecoc|^stanbrdgejchris@|^balls@gmail\\.com$|^bigboy@littleboy\\.com$|@fundhub\\.ai$)";
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
      ARRAY(SELECT DISTINCT lower(m[1]) FROM regexp_matches(e.payload::text, '([A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]+)', 'g') m) AS ems
    FROM events e WHERE e.client_id IS NULL AND NOT EXISTS (SELECT 1 FROM failed_events f WHERE f.event_id = e.id))
  SELECT id FROM ev WHERE p !~* '(bramselleslach|client@fundhub\\.ai)' AND NOT EXISTS (SELECT 1 FROM entitlements en WHERE en.source_event_id::text = ev.id)
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

// Round 7: fake staff (incl. Elena Brooks) and fake affiliates. Real staff, TEST role logins, App Store login, real-looking affiliates stay.
const KEEP_STAFF_CODES = ["EMP-000001", "EMP-000038", "EMP-000062", "EMP-000007", "EMP-000008", "EMP-000009", "EMP-000010", "EMP-000011", "EMP-000012", "EMP-000034"];
const FAKE_STAFF_SQL = `SELECT id::text FROM staff WHERE NOT (employee_code = ANY($1)) AND (
    email ~* '(@example\\.(com|test)$|@demo\\.fundhub\\.local$)' OR is_demo
    OR employee_code IN ('EMP-000002','EMP-000003','EMP-000004','EMP-000005','EMP-000006','EMP-000063','EMP-000082'))`;
const KEEP_AFF = ["AFF-000001", "AFF-000182", "AFF-000120", "AFF-000121", "AFF-000122", "AFF-000123", "AFF-000124"];
const FAKE_AFF_SQL = `SELECT a.id::text FROM affiliates a WHERE NOT (a.tracking_id = ANY($1)) AND (
    a.is_demo OR a.tracking_id IN ('AFF-000002','AFF-000003','AFF-000004','AFF-000053','AFF-000059','AFF-000060','AFF-000061','AFF-000062','AFF-000063','AFF-000064','AFF-000065','AFF-000066','AFF-000067','AFF-000068','AFF-000069','principalread-aff'))`;
async function round7(c, sch) {
  const staff = (await c.query(FAKE_STAFF_SQL, [KEEP_STAFF_CODES])).rows.map((r) => r.id);
  const affs = (await c.query(FAKE_AFF_SQL, [KEEP_AFF])).rows.map((r) => r.id);
  return staffAffRound(c, sch, staff, affs, KEEP_STAFF_CODES, KEEP_AFF);
}
// Round 8: the 7 TEST role staff logins and TEST — Affiliate Role (owner order 2026-10-20). TEST — Client Role (AFF-000182) is the App Store login's affiliate record: kept.
const R8_STAFF = ["EMP-000007", "EMP-000008", "EMP-000009", "EMP-000010", "EMP-000011", "EMP-000012", "EMP-000034"];
const R8_KEEP_STAFF = ["EMP-000001", "EMP-000038", "EMP-000062"];
const R8_KEEP_AFF = ["AFF-000182", "AFF-000120", "AFF-000121", "AFF-000122", "AFF-000123", "AFF-000124", "AFF-000063"];
async function round8(c, sch) {
  const staff = (await c.query("SELECT id::text FROM staff WHERE employee_code = ANY($1) AND name LIKE 'TEST — %'", [R8_STAFF])).rows.map((r) => r.id);
  if (staff.length !== 7) throw new Error("expected 7 TEST staff, got " + staff.length);
  const affs = (await c.query("SELECT id::text FROM affiliates WHERE tracking_id = 'AFF-000001' AND name = 'TEST — Affiliate Role'")).rows.map((r) => r.id);
  if (affs.length !== 1) throw new Error("TEST — Affiliate Role not found");
  return staffAffRound(c, sch, staff, affs, R8_KEEP_STAFF, R8_KEEP_AFF);
}
async function staffAffRound(c, sch, staff, affs, KEEP_STAFF_CODES, KEEP_AFF) {
  const F = await closure(c, sch, staff, "staff", { affiliates: affs });
  // Protected: every row tied to the 3 kept clients, the kept staff and the kept affiliates.
  const keepClients = (await c.query("SELECT id::text FROM clients")).rows.map((r) => r.id);
  const keepStaff = (await c.query("SELECT id::text FROM staff WHERE employee_code = ANY($1)", [KEEP_STAFF_CODES])).rows.map((r) => r.id);
  const keepAff = (await c.query("SELECT id::text FROM affiliates WHERE tracking_id = ANY($1)", [KEEP_AFF])).rows.map((r) => r.id);
  const P = await closure(c, sch, keepClients, "clients", { staff: keepStaff, affiliates: keepAff });
  const hard = (await c.query(`SELECT DISTINCT t.tgrelid::regclass::text AS t FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND (t.tgtype & 8) <> 0 AND (t.tgtype & 2) <> 0 AND t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
        AND pg_get_functiondef(p.oid) !~* 'is_demo'`)).rows.map((r) => r.t);
  const nopriv = (await c.query(`SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT has_table_privilege('fundhub_app', oid, 'DELETE')`)).rows.map((r) => r.relname);
  const pinned = new Map();
  const pin = (t, k) => { if (!pinned.has(t)) pinned.set(t, new Set()); const s = pinned.get(t); if (s.has(k)) return false; s.add(k); return true; };
  for (const [t, s] of F.del) { const p = P.del.get(t); for (const k of s) if (hard.includes(t) || nopriv.includes(t) || (p && p.has(k))) pin(t, k); }
  // A row that would be blanked (set null) and is protected or locked pins its parent too.
  for (const [key, s] of F.nulls) { const t = key.split(".")[0]; const p = P.del.get(t); for (const k of s) if ((p && p.has(k)) || hard.includes(t) || nopriv.includes(t)) pin(`__nullchild:${key}`, k); }
  let grew = true;
  while (grew) {
    grew = false;
    for (const fk of sch.fks) {
      const ps = pinned.get(fk.child); const pd = F.del.get(fk.parent);
      const nullPins = pinned.get(`__nullchild:${fk.child}.${fk.ccols.join("+")}`);
      for (const src of [ps, nullPins]) {
        if (!src || !src.size || !pd) continue;
        const rows = (await c.query(`SELECT DISTINCT ${keyExpr(sch.pks[fk.parent], "p.")} AS k FROM ${qi(fk.parent)} p JOIN ${qi(fk.child)} ch ON (${fk.ccols.map((x, i) => `ch.${qi(x)} = p.${qi(fk.pcols[i])}`).join(" AND ")}) WHERE ${keyExpr(sch.pks[fk.child], "ch.")} = ANY($1) AND ${keyExpr(sch.pks[fk.parent], "p.")} = ANY($2)`, [[...src], [...pd]])).rows.map((r) => r.k);
        for (const k of rows) if (pin(fk.parent, k)) grew = true;
      }
    }
  }
  for (const [t, s] of pinned) { if (t.startsWith("__")) continue; const d = F.del.get(t); if (!d) continue; for (const k of s) d.delete(k); if (!d.size) F.del.delete(t); }
  // Re-walk: rows still in the delete set whose parent got pinned stay deletable; set-null effects from pinned parents disappear.
  const delParents = new Map([...F.del].map(([t, s]) => [t, s]));
  for (const [key, s] of [...F.nulls]) {
    const t = key.split(".")[0]; const cols = key.split(".")[1].split("+");
    const fk = sch.fks.find((f) => f.child === t && f.ccols.join("+") === cols.join("+") && (f.del === "n" || f.del === "d"));
    const pd = fk && delParents.get(fk.parent);
    if (!pd) { F.nulls.delete(key); continue; }
    const keepK = (await c.query(`SELECT DISTINCT ${keyExpr(sch.pks[t], "ch.")} AS k FROM ${qi(t)} ch JOIN ${qi(fk.parent)} p ON (${fk.ccols.map((x, i) => `ch.${qi(x)} = p.${qi(fk.pcols[i])}`).join(" AND ")}) WHERE ${keyExpr(sch.pks[fk.parent], "p.")} = ANY($1)`, [[...pd]])).rows.map((r) => r.k);
    F.nulls.set(key, new Set(keepK)); if (!keepK.length) F.nulls.delete(key);
  }
  dropNullsInDel(F);
  const demoStaff = [...(pinned.get("staff") || [])]; const demoAff = [...(pinned.get("affiliates") || [])];
  return { del: toObj(F.del), nulls: toObj(F.nulls), order: orderOf(sch, F.del), pks: Object.fromEntries([...F.del.keys()].map((t) => [t, sch.pks[t]])), demoClients: [], demoPartners: [], demoStaff, demoAffiliates: demoAff, pinned: toObj(new Map([...pinned].filter(([t]) => !t.startsWith("__")))), info: { staff: staff.length, affiliates: affs.length } };
}
module.exports.round7 = round7;
module.exports.round8 = round8;

// Round 4b: the client-less fake events round 4 missed (test emails only, not demo-flagged), after the escape fix.
async function round4b(c, sch) {
  const ev = (await c.query(FAKE_OTHER_EVENT_SQL)).rows.map((r) => r.id);
  const F = await closure(c, sch, ev, "events");
  dropNullsInDel(F);
  if (F.nulls.size) throw new Error("set-null effects: " + [...F.nulls.keys()].join(","));
  return { del: toObj(F.del), nulls: toObj(F.nulls), order: orderOf(sch, F.del), pks: Object.fromEntries([...F.del.keys()].map((t) => [t, sch.pks[t]])), demoClients: [], demoPartners: [], info: { events: ev.length } };
}
module.exports.round4b = round4b;

// Round 9: affiliate Wardell Brooks (AFF-000122) only, owner order via coordinator 2026-10-20.
async function round9(c, sch) {
  const affs = (await c.query("SELECT id::text FROM affiliates WHERE id = 'e27c5e78-5ddd-4066-befe-6eda8857a45e' AND tracking_id = 'AFF-000122' AND name = 'Wardell Brooks'")).rows.map((r) => r.id);
  if (affs.length !== 1) throw new Error("Wardell Brooks AFF-000122 not found as described");
  return staffAffRound(c, sch, [], affs, ["EMP-000001", "EMP-000038", "EMP-000062"], ["AFF-000182", "AFF-000120", "AFF-000121", "AFF-000123", "AFF-000124", "AFF-000063"]);
}
module.exports.round9 = round9;

// Round 10: Elena Brooks's 3 "chat thread check" test notes and their internal thread (owner yes via coordinator).
async function round10(c, sch) {
  const T = "bf3f5650-8960-4a4c-aa8f-845efcf42a00";
  const M = ["6cd618af-4318-4282-bae0-ddaedd16d0c1", "55606313-4295-4e47-9062-5f23fece4cc9", "5b16500b-4786-4ebf-a2cb-c55f5682ca1d"];
  const ok = (await c.query("SELECT count(*)::int n FROM messages WHERE id::text = ANY($1) AND conversation_id::text = $2 AND channel = 'internal' AND client_id IS NULL AND rendered_body LIKE 'chat thread check%'", [M, T])).rows[0].n;
  const inThread = (await c.query("SELECT count(*)::int n FROM messages WHERE conversation_id::text = $1", [T])).rows[0].n;
  const conv = (await c.query("SELECT count(*)::int n FROM conversations WHERE id::text = $1 AND kind = 'internal' AND client_id IS NULL", [T])).rows[0].n;
  if (ok !== 3 || inThread !== 3 || conv !== 1) throw new Error(`not as described: notes ${ok}, in thread ${inThread}, thread ${conv}`);
  const F = await closure(c, sch, [T], "conversations", { messages: M });
  dropNullsInDel(F);
  return { del: toObj(F.del), nulls: toObj(F.nulls), order: orderOf(sch, F.del), pks: Object.fromEntries([...F.del.keys()].map((t) => [t, sch.pks[t]])), demoClients: [], demoPartners: [], info: { messages: 3, thread: 1 } };
}
module.exports.round10 = round10;
