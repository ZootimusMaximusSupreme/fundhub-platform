// The linked payout bank's masked status. Self read for closer/sales_manager;
// owner may read one same-org employee for the People drawer.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  canLinkStaffPayout, currentStaffPayoutAccount, staffPayoutLinkAvailability
} from "../../src/staff/payout-account.mjs";

export default async function handler(req, res, deps = {}) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!isUuid(staff.id) || !isUuid(staff.org_id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const requestedId = req.query?.staff_id;
  let staffId;
  if (staff.role === "owner") {
    if (!isUuid(requestedId)) return res.status(400).json({ ok: false, error: "staff_id is required" });
    staffId = requestedId;
  } else if (canLinkStaffPayout(staff) && requestedId === undefined) {
    staffId = staff.id;
  } else {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  try {
    const target = (await database.query(
      `SELECT s.id FROM staff s WHERE s.id=$1 AND s.org_id=$2
        AND s.role NOT IN ('owner','admin','partner','client','affiliate','outbound_rep')
        AND (s.role IN ('closer','sales_manager') OR EXISTS (
          SELECT 1 FROM staff_role_assignments a
          JOIN staff_roles sr ON sr.id=a.role_id AND sr.org_id=a.org_id
          WHERE a.staff_id=s.id AND a.org_id=s.org_id AND sr.active
            AND sr.key IN ('closer','sales_manager')))` ,
      [staffId, staff.org_id]
    )).rows[0];
    if (!target) return res.status(404).json({ ok: false, error: "staff_not_found" });
    const account = await (deps.currentAccount || currentStaffPayoutAccount)(database, {
      orgId: staff.org_id, staffId
    });
    return res.status(200).json({ ok: true, account,
      ...staffPayoutLinkAvailability(deps.env || process.env) });
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
