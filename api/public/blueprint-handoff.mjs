import { db } from "../../src/db.mjs";
import { resolveSellerHandoff, SellerError } from "../../src/affiliates/blueprint-sale.mjs";

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "method_not_allowed" }); }
  try {
    const url = new URL(req.url, "https://fundhub.ai");
    if ([...url.searchParams.keys()].some(key => !["id","sig"].includes(key)) || url.searchParams.getAll("id").length !== 1 || url.searchParams.getAll("sig").length !== 1) {
      return res.status(404).json({ ok: false, error: "not_found", message: "This link is not available." });
    }
    const target = await resolveSellerHandoff(deps.db || db, { id: url.searchParams.get("id"), sig: url.searchParams.get("sig"), env: deps.env || process.env });
    res.setHeader("Location", target);
    return res.status(302).end();
  } catch (error) {
    const known = error instanceof SellerError;
    return res.status(known ? error.status : 503).json({ ok: false, error: known ? error.code : "handoff_unavailable",
      message: known ? error.message : "Your checkout is not ready. Open this same link again shortly." });
  }
}
