import { db, pool } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { createSellerSale, SellerError } from "../../src/affiliates/blueprint-sale.mjs";

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "method_not_allowed" }); }
  const principal = await requirePrincipal(req, res, ["affiliate"], { db: deps.db || db });
  if (!principal) return;
  let connection;
  try {
    connection = await (deps.connect || (() => pool().connect()))();
    const sale = await createSellerSale(connection, { principal, body: req.body || {}, env: deps.env || process.env, deps: deps.services || {} });
    return res.status(200).json({ ok: true, sale });
  } catch (error) {
    const known = error instanceof SellerError;
    return res.status(known ? error.status : 503).json({ ok: false,
      error: known ? error.code : "sale_unavailable",
      message: known ? error.message : "The buyer's link is not ready yet. Try again shortly; Fundhub will keep the saved order." });
  } finally { if (connection) connection.release(); }
}
