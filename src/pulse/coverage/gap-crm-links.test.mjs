import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appPageFile, extractAppLinks, gapChecks } from "./gap-crm-links.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = "11111111-1111-4111-8111-111111111111";

function json(status, body) {
  return {
    status,
    text: async () => (body == null ? "" : JSON.stringify(body))
  };
}

function router(map) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET" });
    const key = String(url);
    const hit = map[key] || map.default;
    if (!hit) return json(500, { ok: false, error: "unmapped" });
    if (typeof hit === "function") return hit(url, opts);
    return hit;
  };
  return { fetchImpl, calls };
}

function dbFrom(rowsByNeedle) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      assert.doesNotMatch(text, /\b(insert|update|delete|drop|truncate|alter)\b/i);
      for (const [needle, rows] of rowsByNeedle) {
        if (text.includes(needle)) {
          if (rows instanceof Error) throw rows;
          return { rows };
        }
      }
      return { rows: [] };
    }
  };
}

function shape(rows) {
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.ok("suggestedFix" in row);
    if (row.status === "FAIL") assert.equal(typeof row.suggestedFix, "string");
    else assert.equal(row.suggestedFix, null);
  }
  assert.equal(rows.some((row) => row.id === "recon"), false);
}

test("app page links stay inside /app", () => {
  assert.equal(appPageFile("pipeline.html"), "pipeline.html");
  assert.equal(appPageFile("client-control-panel.html?id=abc"), "client-control-panel.html");
  assert.equal(appPageFile("/app/lenders.html"), "lenders.html");
  assert.equal(appPageFile("https://fundhub.ai/app/documents.html"), "documents.html");
  assert.equal(appPageFile("#"), null);
  assert.equal(appPageFile("https://example.com/apply"), null);
  assert.equal(appPageFile("/login.html"), null);
  assert.equal(appPageFile("../secret.html"), null);

  const found = extractAppLinks(
    '<a href="lenders.html">Banks</a><a href="#">stay</a><a href="messaging.html?client_id=1">note</a>',
    "client-control-panel.html"
  );
  assert.deepEqual([...found.keys()].sort(), ["lenders.html", "messaging.html"]);
});

test("current CRM screens have no dead internal page link on disk", async () => {
  const rows = await gapChecks({});
  shape(rows);
  const pages = rows.find((row) => row.id === "crm-links:pages");
  assert.ok(pages, "expected one page-link summary");
  assert.equal(pages.status, "PASS");
  assert.match(pages.detail, /internal \/app links/);
  assert.equal(rows.some((row) => row.id.startsWith("crm-link:") && row.status === "FAIL"), false);
  const skips = rows.filter((row) => row.status === "skip");
  assert.ok(skips.length >= 1);
});

test("a missing button target fails without a live GET", async () => {
  const rows = await gapChecks({
    sources: [{ name: "client-control-panel.html", text: '<a href="gone-bank.html">Open bank</a>' }]
  });
  shape(rows);
  const dead = rows.find((row) => row.id === "crm-link:gone-bank.html");
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /client-control-panel.html/);
  assert.match(dead.detail, /not in public\/app/);
  assert.match(dead.suggestedFix, /Do not auto-fix/);
  assert.equal(rows.some((row) => row.id === "crm-links:pages"), false);
});

test("live GET 404 or 500 fails a link that is on disk", async () => {
  const { fetchImpl, calls } = router({
    default: json(404, {})
  });
  const rows = await gapChecks({
    sources: [{ name: "pipeline.html", text: '<a href="pipeline.html">Board</a><a href="documents.html">Docs</a>' }],
    fetchImpl,
    baseUrl: "https://fundhub.ai"
  });
  shape(rows);
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.ok(calls.some((call) => call.url === "https://fundhub.ai/app/pipeline.html"));
  const board = rows.find((row) => row.id === "crm-link:pipeline.html");
  const docs = rows.find((row) => row.id === "crm-link:documents.html");
  assert.equal(board.status, "FAIL");
  assert.match(board.detail, /404/);
  assert.equal(docs.status, "FAIL");
});

test("live GET 200 on a real page passes", async () => {
  const { fetchImpl, calls } = router({ default: json(200, "<html></html>") });
  const rows = await gapChecks({
    sources: [{ name: "sales-floor.html", text: '<a class="navitem" href="closer-dashboard.html">Closer</a>' }],
    fetchImpl,
    baseUrl: "https://fundhub.ai/"
  });
  shape(rows);
  const pages = rows.find((row) => row.id === "crm-links:pages");
  assert.equal(pages.status, "PASS");
  assert.match(pages.detail, /Live GET returned no 404 or 500/);
  assert.equal(calls[0].url, "https://fundhub.ai/app/closer-dashboard.html");
});

test("sales board empty while columns exist fails", async () => {
  const database = dbFrom([
    ["pipeline_stages", [{ n: 6 }]],
    ["FROM pipelines", [{ n: 1 }]],
    ["SELECT id FROM clients", [{ id: CLIENT }]],
    ["FROM clients", [{ n: 2 }]],
    ["FROM documents", [{ n: 0 }]],
    ["logo_path", []],
    ["FROM lenders", [{ n: 4 }]]
  ]);
  const { fetchImpl, calls } = router({
    "https://fundhub.ai/api/dashboard/pipeline?key=sales": json(200, { ok: true, stages: [], total: 0 }),
    "https://fundhub.ai/api/dashboard/pipeline-counts": json(200, { ok: true, counts: { sales: 3 } }),
    "https://fundhub.ai/api/dashboard/clients": json(200, { ok: true, count: 2, clients: [{ id: CLIENT }] }),
    [`https://fundhub.ai/api/dashboard/client?id=${CLIENT}`]: json(200, { ok: true, client: { id: CLIENT } }),
    [`https://fundhub.ai/api/read/tradelines?client_id=${CLIENT}`]: json(200, { ok: true, data: [], funding: {} }),
    [`https://fundhub.ai/api/read/lender-matches?client_id=${CLIENT}`]: json(200, {
      ok: true, match_count: 0, matches: [], summary: { lender_count: 4 }
    }),
    "https://fundhub.ai/api/read/sales-floor": json(200, { ok: true, period: { start: "a" }, hero: { cash_cents: 0 } }),
    "https://fundhub.ai/api/read/documents": json(200, { ok: true, items: [] }),
    "https://fundhub.ai/api/read/lenders": json(200, { ok: true, lenders: [{ name: "Navy Federal" }], meta: { empty: false } }),
    default: json(200, {})
  });
  const rows = await gapChecks({
    sources: [],
    fetchImpl,
    db: database,
    baseUrl: "https://fundhub.ai"
  });
  shape(rows);
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.equal(calls.some((call) => /POST/.test(call.url)), false);
  const board = rows.find((row) => row.id === "crm-data:pipeline");
  assert.equal(board.status, "FAIL");
  assert.match(board.detail, /6 columns/);
  assert.equal(rows.find((row) => row.id === "crm-data:tradelines").status, "PASS");
  assert.match(rows.find((row) => row.id === "crm-data:tradelines").detail, /0 cards/);
});

test("pipeline 500 fails and 401 skips", async () => {
  const down = router({
    default: json(500, { ok: false })
  });
  const failed = await gapChecks({ sources: [], fetchImpl: down.fetchImpl, baseUrl: "https://fundhub.ai" });
  shape(failed);
  assert.equal(failed.find((row) => row.id === "crm-data:pipeline").status, "FAIL");
  assert.match(failed.find((row) => row.id === "crm-data:pipeline").detail, /500/);

  const locked = router({ default: json(401, { ok: false }) });
  const skipped = await gapChecks({ sources: [], fetchImpl: locked.fetchImpl, baseUrl: "https://fundhub.ai" });
  shape(skipped);
  assert.equal(skipped.find((row) => row.id === "crm-data:sales-floor").status, "skip");
  assert.match(skipped.find((row) => row.id === "crm-data:clients").detail, /401/);
});

test("a known client 404 fails the control panel read", async () => {
  const database = dbFrom([
    ["SELECT id FROM clients", [{ id: CLIENT }]],
    ["FROM clients", [{ n: 1 }]],
    ["pipeline_stages", [{ n: 1 }]],
    ["FROM pipelines", [{ n: 1 }]],
    ["FROM documents", [{ n: 3 }]],
    ["logo_path", [{ logo_path: "/assets/lenders/placeholder.svg" }]],
    ["FROM lenders", [{ n: 10 }]]
  ]);
  const { fetchImpl } = router({
    "https://fundhub.ai/api/dashboard/pipeline?key=sales": json(200, { ok: true, stages: [{ key: "new" }] }),
    "https://fundhub.ai/api/dashboard/pipeline-counts": json(200, { ok: true, counts: { sales: 1 } }),
    "https://fundhub.ai/api/dashboard/clients": json(200, { ok: true, clients: [] }),
    [`https://fundhub.ai/api/dashboard/client?id=${CLIENT}`]: json(404, { ok: false, error: "client not found" }),
    [`https://fundhub.ai/api/read/tradelines?client_id=${CLIENT}`]: json(200, { ok: true, data: [{ id: "card" }] }),
    [`https://fundhub.ai/api/read/lender-matches?client_id=${CLIENT}`]: json(200, {
      ok: true, match_count: 1, matches: [{ name: "Amex" }], summary: { lender_count: 0 }
    }),
    "https://fundhub.ai/api/read/sales-floor": json(200, { ok: true }),
    "https://fundhub.ai/api/read/documents": json(200, { ok: true, items: [] }),
    "https://fundhub.ai/api/read/lenders": json(200, { ok: true, lenders: [], meta: { empty: true } }),
    default: json(200, {})
  });
  const rows = await gapChecks({
    sources: [],
    fetchImpl,
    db: database,
    logoExists: () => true,
    baseUrl: "https://fundhub.ai"
  });
  shape(rows);
  assert.equal(rows.find((row) => row.id === "crm-data:client").status, "FAIL");
  assert.equal(rows.find((row) => row.id === "crm-data:clients").status, "FAIL");
  assert.match(rows.find((row) => row.id === "crm-data:clients").detail, /1 client is on file/);
  assert.equal(rows.find((row) => row.id === "crm-data:documents").status, "FAIL");
  assert.match(rows.find((row) => row.id === "crm-data:documents").detail, /3 documents/);
  assert.equal(rows.find((row) => row.id === "crm-data:lenders").status, "FAIL");
  assert.equal(rows.find((row) => row.id === "crm-data:lender-matches").status, "FAIL");
  assert.match(rows.find((row) => row.id === "crm-data:lender-matches").detail, /bank book is empty/);
  assert.equal(rows.find((row) => row.id === "crm-data:sales-floor").status, "FAIL");
  assert.equal(rows.find((row) => row.id === "crm-links:bank-logos").status, "PASS");
});

test("a missing bank logo fails and a relative logo path fails", async () => {
  const database = dbFrom([
    ["logo_path", [
      { logo_path: "/assets/lenders/missing-bank.png" },
      { logo_path: "assets/lenders/also-missing.png" },
      { logo_path: "https://cdn.example/bank.svg" }
    ]]
  ]);
  const rows = await gapChecks({
    sources: [],
    db: database,
    logoExists: () => false
  });
  shape(rows);
  const logos = rows.find((row) => row.id === "crm-links:bank-logos");
  assert.equal(logos.status, "FAIL");
  assert.match(logos.detail, /missing-bank.png/);
  assert.match(logos.detail, /also-missing.png/);
  assert.equal(rows.find((row) => row.id === "crm-data:pipeline").status, "skip");
});

test("org id is only used on a read", async () => {
  const database = dbFrom([
    ["SELECT id FROM clients", [{ id: CLIENT }]]
  ]);
  await gapChecks({
    sources: [],
    db: database,
    orgId: "22222222-2222-4222-8222-222222222222"
  });
  const clientRead = database.queries.find((q) => q.sql.includes("SELECT id FROM clients"));
  assert.match(clientRead.sql, /org_id = \$1::uuid LIMIT 1/);
  assert.deepEqual(clientRead.params, ["22222222-2222-4222-8222-222222222222"]);
  const docs = database.queries.find((q) => q.sql.includes("FROM documents"));
  assert.match(docs.sql, /WHERE org_id = \$1::uuid/);
});

test("this file does not text, charge, or open the live database", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-crm-links.mjs"), "utf8");
  assert.doesNotMatch(src, /textChris|ticketDarwin|DATABASE_URL|notify\.mjs/);
  assert.doesNotMatch(src, /method:\s*"POST"/);
  assert.match(src, /Recon/);
});
