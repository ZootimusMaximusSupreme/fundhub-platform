// Count the rows the four catalog lanes still print as NOT_PROVED, offline (no database, stub fetch that
// answers 200 with an empty body). Writes the open ids to the path given as the first argument.
//   node scripts/pulse/count-not-proved.mjs [out.json]
import fs from "node:fs";
const LANES = ["gap-door-batch-routes", "gap-catalog-display", "gap-catalog-flow", "gap-catalog-reads"];
const fetchStub = async () => new Response("", { status: 200 });
globalThis.fetch = fetchStub;
const open = [];
for (const lane of LANES) {
  const mod = await import(`../../src/pulse/coverage/${lane}.mjs`);
  const rows = await mod.gapChecks({ env: {}, fetch: fetchStub, http: { get: fetchStub, head: fetchStub } });
  for (const r of rows) if (r.status === "NOT_PROVED" || r.not_proved) open.push({ id: r.id, lane });
}
const byLane = {};
for (const o of open) byLane[o.lane] = (byLane[o.lane] || 0) + 1;
console.log(JSON.stringify({ total: open.length, byLane }));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(open, null, 1));
