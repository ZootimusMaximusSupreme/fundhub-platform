// GitHub runners have no local .env. Load the site's existing app connection,
// so an already-migrated database does not depend on a Supabase management token.
// db/migrate.mjs still checks every migration; an app role cannot apply new DDL.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function productionDatabaseUrl(entries) {
  const entry = entries.find((e) => e.key === "DATABASE_URL");
  const value = entry?.values?.find((v) => v.context === "production")
    || entry?.values?.find((v) => v.context === "all");
  const text = typeof value?.value === "string" ? value.value : "";
  if (!text || text.includes("*") || /[\r\n]/.test(text)) throw new Error("The production database connection is unavailable or masked.");
  const parsed = new URL(text);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("The production database connection is not a PostgreSQL URL.");
  }
  return text;
}

export async function loadShipDatabase({ env = process.env, fetcher = fetch, write = fs.appendFileSync, exists = fs.existsSync, log = console.log } = {}) {
  if (!env.NETLIFY_AUTH_TOKEN || !env.NETLIFY_SITE_ID || !env.GITHUB_ENV) throw new Error("The GitHub ship environment is incomplete.");
  const headers = { Authorization: "Bearer " + env.NETLIFY_AUTH_TOKEN };
  async function get(url) {
    const res = await fetcher(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error("Could not read the production deploy configuration: HTTP " + res.status);
    return res.json();
  }
  const base = "https://api.netlify.com/api/v1";
  const site = await get(base + "/sites/" + encodeURIComponent(env.NETLIFY_SITE_ID));
  if (site.id !== env.NETLIFY_SITE_ID || !site.account_id) throw new Error("The production deploy project did not match.");
  const entries = await get(base + "/accounts/" + encodeURIComponent(site.account_id) + "/env?site_id=" + encodeURIComponent(site.id));
  const url = productionDatabaseUrl(entries);
  log("::add-mask::" + url.replace(/%/g, "%25"));
  write(env.GITHUB_ENV, "DATABASE_URL=" + url + "\n", { mode: 0o600 });
  // Netlify CLI may replace a secret connection with asterisks during its build.
  // The existing migration runner already reads a real app URL from ignored .env.
  if (!exists(".env")) write(".env", "DATABASE_URL=" + JSON.stringify(url) + "\n", { mode: 0o600 });
  log("Loaded the existing production app connection. Migration and privilege guards still run.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadShipDatabase().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
