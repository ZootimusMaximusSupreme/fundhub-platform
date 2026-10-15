// A stand-in for the white-label partner tables (partners, partner_brand, partner_pages,
// partner_module_settings) for the finish-853 batch 08 route tests. It answers by the
// conditions each statement names, builds an INSERT/UPDATE from the statement's own column
// list, and refuses what Postgres refuses at bind time. Tests only; nothing here is product.
import { rowsWhere, bindProblem } from "./s3-scoped-rows.mjs";
import { fakeDb } from "./handler-harness.mjs";

const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

/** `col = $n` pairs of a SET list, in order. */
function setPairs(list) {
  return [...list.matchAll(/([a-z_]+)\s*=\s*\$(\d+)/gi)].map((m) => [m[1], Number(m[2])]);
}

export function partnerTables({
  partners = [], brands = [], pages = [], settings = [], extra = [],
} = {}) {
  const state = { partners, brands, pages, settings, writes: [] };
  let seq = 0;
  const rules = [
    ...extra,
    [/^\s*SELECT \* FROM v_partner_brand_effective WHERE partner_id = \$1/i, (_s, p) => {
      const row = brands.find((b) => b.partner_id === p[0]);
      return row ? [{ wordmark_url: null, ink: "#101820", paper: "#ffffff", ramp: [], ...row }] : [];
    }],
    [/^\s*SELECT org_id FROM partners WHERE id = \$1/i, (_s, p) => partners.filter((r) => r.id === p[0]).map((r) => ({ org_id: r.org_id }))],
    [/^\s*SELECT id FROM partners WHERE id = \$1 AND org_id = \$2/i, (s, p) => rowsWhere(partners, s, p).map((r) => ({ id: r.id }))],
    [/^\s*SELECT (?:domain, domain_verified|entity_name) FROM partner_brand WHERE partner_id = \$1/i, (_s, p) => brands.filter((b) => b.partner_id === p[0])],
    [/^\s*INSERT INTO partner_brand \(([^)]+)\) VALUES \(([^)]+)\)\s+ON CONFLICT \(partner_id\) DO UPDATE SET ([\s\S]+?)RETURNING partner_id/i, (s, p) => {
      const m = /INSERT INTO partner_brand \(([^)]+)\)[\s\S]*?DO UPDATE SET ([\s\S]+?)RETURNING/i.exec(s);
      const cols = m[1].split(",").map((c) => c.trim());
      const insert = Object.fromEntries(cols.map((c, i) => [c, p[i]]));
      const existing = brands.find((b) => b.partner_id === insert.partner_id);
      const parse = (v) => (typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v);
      if (!existing) {
        const row = Object.fromEntries(Object.entries(insert).map(([k, v]) => [k, parse(v)]));
        brands.push(row);
        state.writes.push({ table: "partner_brand", kind: "insert", cols });
        return [{ partner_id: row.partner_id }];
      }
      // ON CONFLICT: only the columns the UPDATE list names change.
      for (const [col, idx] of setPairs(m[2])) existing[col] = parse(p[idx - 1]);
      state.writes.push({ table: "partner_brand", kind: "update", cols: setPairs(m[2]).map(([c]) => c) });
      return [{ partner_id: existing.partner_id }];
    }],
    [/^\s*UPDATE partner_brand\s+SET selected_funnels/i, (_s, p) => {
      const row = brands.find((b) => b.partner_id === p[0]);
      if (row) row.selected_funnels = [...new Set([...(row.selected_funnels || []), p[1]])];
      return { rows: [], rowCount: row ? 1 : 0 };
    }],
    [/^\s*SELECT id, partner_id, funnel_key, title, slug, status, body_json,\s+created_at, updated_at\s+FROM partner_pages/i,
      (s, p) => rowsWhere(pages, s, p).map((r) => ({ ...r }))],
    [/^\s*INSERT INTO partner_pages \(org_id, partner_id, funnel_key, title, slug, status, body_json\)/i, (_s, p) => {
      const [org_id, partner_id, funnel_key, title, slug, body_json] = p;
      const dup = pages.find((r) => r.partner_id === partner_id && r.slug === slug);
      if (dup) { dup.title = title; return [{ ...dup }]; }
      seq += 1;
      const row = { id: `a0000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, org_id, partner_id, funnel_key, title, slug,
        status: "draft", body_json: JSON.parse(body_json), published_at: null };
      pages.push(row);
      return [{ ...row }];
    }],
    [/^\s*SELECT \* FROM partner_pages WHERE id = \$1 AND org_id = \$2/i, (s, p) => rowsWhere(pages, s, p).map((r) => ({ ...r }))],
    [/^\s*SELECT \* FROM partner_pages WHERE id = \$1\s*$/i, (_s, p) => pages.filter((r) => r.id === p[0]).map((r) => ({ ...r }))],
    [/^\s*UPDATE partner_pages SET published_at = COALESCE\(published_at, now\(\)\)/i, (s, p) => {
      for (const r of rowsWhere(pages, s, p)) r.published_at = r.published_at || "2026-10-14T12:00:00.000Z";
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*UPDATE partner_pages SET published_at = NULL/i, (s, p) => {
      for (const r of rowsWhere(pages, s, p)) r.published_at = null;
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*UPDATE partner_pages SET (?!published_at)/i, (s, p) => {
      const list = /UPDATE partner_pages SET ([\s\S]+?)\s+WHERE/i.exec(s)[1];
      const hit = rowsWhere(pages, s, p);
      for (const row of hit) {
        for (const [col, idx] of setPairs(list)) {
          const v = p[idx - 1];
          row[col] = col === "body_json" ? JSON.parse(v) : v;
        }
      }
      return hit.map((r) => ({ ...r }));
    }],
    [/^\s*SELECT marketing_suite_enabled, ai_token_cap_monthly, org_id\s+FROM partner_module_settings/i, (_s, p) => settings.filter((r) => r.partner_id === p[0])],
    [/^\s*SELECT org_id FROM partners WHERE id = \$1\s*$/i, (_s, p) => partners.filter((r) => r.id === p[0]).map((r) => ({ org_id: r.org_id }))],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
    [/set_config/i, []],
  ];
  const fake = fakeDb(rules);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => {
    fake.connected += 1;
    return { query: fake.query, release() { fake.released += 1; } };
  };
  fake.state = state;
  fake.sqlOf = (re) => fake.calls.filter((c) => re.test(norm(c.sql)));
  return fake;
}
