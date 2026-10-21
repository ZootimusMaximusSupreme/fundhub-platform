// Round 5: 2 raw ClickFunnels booking captures left from deleted client FH-000567. Dry run unless --commit.
const fs = require("fs"); const path = require("path");
const { connect, schema, closure, qi } = require("./lib.cjs");
const COMMIT = process.argv.includes("--commit");
const IDS = ["843d2310-b1a4-4962-9ebe-90de7477ef8b", "32ae1125-05e3-4ab5-9e3e-a87f1b2201cd"];
const DIR = COMMIT ? "/Users/chrisstanbridge/Developer/fundhub-platform/credentials/backups/delete-fake-data-2026-10-20/round5" : path.join(__dirname, "dry-round5");
const fail = (m) => { throw new Error("ABORT: " + m); };
(async () => { const c = await connect(); try {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ"); await c.query("SELECT set_config('fundhub.actor','staff',true)");
  const sch = await schema(c);
  const rows = (await c.query("SELECT id::text, provider, created_at, raw_body ~* 'insureboost' AS ib, raw_body ~ '(74249|74237)' AS uid, row_to_json(w) AS r FROM webhook_captures w WHERE id::text = ANY($1)", [IDS])).rows;
  console.log(rows.map((r) => `${r.id.slice(0, 8)} ${r.provider} ${r.created_at.toISOString().slice(0, 16)} insureboost=${r.ib} uid=${r.uid}`).join(" | "));
  if (rows.length !== 2 || rows.some((r) => !r.ib || !r.uid)) fail("rows not as described");
  if ((await c.query("SELECT count(*)::int n FROM bookings WHERE provider_uid IN ('74249','74237')")).rows[0].n) fail("a booking still exists for these");
  if ((await c.query("SELECT count(*)::int n FROM clients WHERE lower(email) LIKE '%insureboost%'")).rows[0].n) fail("client still exists");
  const F = await closure(c, sch, IDS, "webhook_captures");
  if ([...F.del.keys()].length !== 1 || F.nulls.size) fail("captures have linked rows: " + [...F.del.keys()].join(","));
  const tables = (await c.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows.map((r) => r.relname);
  const counts = async () => { const m = {}; for (const t of tables) m[t] = (await c.query(`SELECT count(*)::int n FROM ${qi(t)}`)).rows[0].n; return m; };
  const before = await counts();
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, "webhook_captures.json"), JSON.stringify(rows.map((r) => r.r), null, 1));
  if (JSON.parse(fs.readFileSync(path.join(DIR, "webhook_captures.json"), "utf8")).length !== 2) fail("backup short");
  const d = await c.query("DELETE FROM webhook_captures WHERE id::text = ANY($1)", [IDS]); if (d.rowCount !== 2) fail("deleted " + d.rowCount);
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  const after = await counts();
  for (const t of tables) if (before[t] - after[t] !== (t === "webhook_captures" ? 2 : 0)) fail(`${t} ${before[t]} -> ${after[t]}`);
  console.log("checks pass: webhook_captures -2, every other table unchanged; backup", DIR);
  if (COMMIT) { await c.query("COMMIT"); console.log("COMMITTED"); } else { await c.query("ROLLBACK"); console.log("DRY RUN — rolled back"); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); console.error("ROLLED BACK —", e.message); process.exitCode = 1; } finally { await c.end(); } })();
