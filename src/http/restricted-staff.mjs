// A limited outreach seat must not inherit a valid-session-only client endpoint.
// This check runs at session resolution as well as the route's own role gate.
const OUTBOUND_ROUTES = new Map([
  ["auth/session", new Set(["GET"])],
  ["org-brand", new Set(["GET"])],
  ["read/bank-outreach", new Set(["GET"])],
  ["bank-outreach", new Set(["POST"])]
]);

export function restrictedStaffAllowed(req, staff) {
  if (staff?.role !== "outbound_rep") return true;
  let path;
  try {
    path = new URL(req?.url || "", "https://fundhub.invalid").pathname
      .replace(/^\/(?:\.netlify\/functions\/)?api\/?/, "").replace(/\/+$/, "");
  } catch { return false; }
  return OUTBOUND_ROUTES.get(path)?.has(req?.method) === true;
}
