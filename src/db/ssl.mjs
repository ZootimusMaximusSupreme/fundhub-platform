import { checkServerIdentity } from "node:tls";
import { isIP } from "node:net";
import { SUPABASE_PRODUCTION_CA } from "./ssl-ca.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

// pg reparses connectionString AFTER its config object. URL SSL settings can
// silently replace rejectUnauthorized, the CA and the TLS minimum.
// https://node-postgres.com/features/ssl#usage-with-connectionstring
export function databaseConnectionOptions(connectionString) {
  let url;
  try { url = new URL(connectionString); }
  catch { throw new Error("DATABASE_URL must be a PostgreSQL URL with an explicit host"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.searchParams.has("host") || url.searchParams.has("hostaddr")) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL with one explicit host");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Non-special PostgreSQL URLs retain %-encoded host text, which pg later
  // decodes (including Unix sockets). Accept one unambiguous DNS name or IP.
  if (!isIP(host) && (host.length > 253 || !host.split(".").every(label =>
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)))) {
    throw new Error("DATABASE_URL host must be an unencoded DNS name or IP address");
  }
  const scratch = isLocalScratchDatabaseUrl(url.href);
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("ssl") || key.toLowerCase() === "uselibpqcompat") url.searchParams.delete(key);
  }
  return {
    connectionString: url.href,
    ssl: scratch ? false : {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      // Supabase uses its own CA. Other remote services retain Node's public
      // trust store; no network or working-directory lookup occurs at runtime.
      ...(host.endsWith(".supabase.com") || host.endsWith(".supabase.co") ? { ca: SUPABASE_PRODUCTION_CA } : {}),
      ...(isIP(host) ? {} : { servername: host }),
      checkServerIdentity: (_servername, certificate) => checkServerIdentity(host, certificate)
    }
  };
}
