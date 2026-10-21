// Round 6: the 2 Aug-21 test commission rules. Dry run unless --commit.
const fs = require("fs"); const path = require("path");
const { connect, schema, closure, keyExpr, qi } = require("./lib.cjs");
const COMMIT = process.argv.includes("--commit");
const IDS = ["bdd28f6e-d662-4a0c-be97-755dbcfa22a8", "f7578579-1e2c-43af-965b-d3eb5b088aca"];
const DIR = COMMIT ? "/Users/chrisstanbridge/Developer/fundhub-platform/credentials/backups/delete-fake-data-2026-10-20/round6" : path.join(__dirname, "dry-round6");
const fail = (m) => { throw new Error("ABORT: " + m); };
(async () => { const c = await connect(); try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await c.query("SELECT set_config('fundhub.actor','staff',true)");
  const sch = await schema(c);
  const rows = (await c.query("SELECT id::text, name, row_to_json(r) AS j FROM commission_rules r WHERE id::text = ANY($1)", [IDS])).rows;
  if (rows.length !== 2 || !rows.every((r) => /^MC (advisor 0\.25% funded|closer flat deposit)$/.test(r.name))) fail("rules not as described: " + rows.map((r) => r.name).join(","));
  const F = await closure(c, sch, IDS, "commission_rules");
  const linked = [...F.del].filter(([t]) => t !== "commission_rules").map(([t, s]) => `${t}=${s.size}`);
  const nulls = [...F.nulls].map(([t, s]) => `${t}=${s.size}`);
  console.log("linked rows:", linked.join(" ") || "none", "| set-null:", nulls.join(" ") || "none");
  if (linked.length || nulls.length) fail("something points at these rules; end-date instead");
  const tables = (await c.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows.map((r) => r.relname);
  const counts = async () => { const m = {}; for (const t of tables) m[t] = (await c.query(`SELECT count(*)::int n FROM ${qi(t)}`)).rows[0].n; return m; };
  const fp = async () => { const m = {}; for (const t of ["commission_rules", "staff", "products", "commission_ledger"]) m[t] = (await c.query(`SELECT md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY ${keyExpr(sch.pks[t], "x.")}), '')) h FROM ${qi(t)} x WHERE NOT (${keyExpr(sch.pks[t], "x.")} = ANY($1))`, [t === "commission_rules" ? IDS : []])).rows[0].h; return m; };
  const before = await counts(); const fb = await fp();
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, "commission_rules.json"), JSON.stringify(rows.map((r) => r.j), null, 1));
  if (JSON.parse(fs.readFileSync(path.join(DIR, "commission_rules.json"), "utf8")).length !== 2) fail("backup short");
  const d = await c.query("DELETE FROM commission_rules WHERE id::text = ANY($1)", [IDS]); if (d.rowCount !== 2) fail("deleted " + d.rowCount);
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  const after = await counts(); const fa = await fp();
  for (const t of tables) if (before[t] - after[t] !== (t === "commission_rules" ? 2 : 0)) fail(`${t} ${before[t]} -> ${after[t]}`);
  for (const k of Object.keys(fb)) if (fb[k] !== fa[k]) fail(`${k} other rows changed`);
  console.log(`checks pass: commission_rules ${before.commission_rules} -> ${after.commission_rules}; every other table and row unchanged; backup ${DIR}`);
  if (COMMIT) { await c.query("COMMIT"); console.log("COMMITTED"); } else { await c.query("ROLLBACK"); console.log("DRY RUN — rolled back"); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("ROLLED BACK —", e.message); process.exitCode = 1; } finally { await c.end(); } })();
