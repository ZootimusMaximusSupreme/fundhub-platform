import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  NativePushError, countNativeDevices, nativePushConfigured,
  registerNativeDevice, revokeNativeDevice
} from "../../src/push/native-store.mjs";

// Native APNs registration is deliberately separate from the portal's web push.
// The bearer session chooses the client; a request body cannot choose another.
export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["client"], { db });
  if (!principal) return;
  const orgId = principal.orgId || null;
  const clientId = principal.clientId || null;
  const accountId = principal.accountId || null;
  const sessionId = principal.sessionId || null;
  if (!orgId || !clientId || !accountId || !sessionId) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
  }
  try {
    if (method === "GET") {
      const count = await countNativeDevices(db, {
        orgId, clientId, sessionId, installationId: req.query?.installation_id
      });
      return res.status(200).json({ ok: true, configured: nativePushConfigured(), registered: count > 0 });
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (method === "DELETE") {
      const result = await revokeNativeDevice(db, {
        orgId, clientId, installationId: body.installation_id
      });
      return res.status(200).json({ ok: true, ...result });
    }
    if (!nativePushConfigured()) {
      return res.status(503).json({ ok: false, error: "native_push_unconfigured",
        message: "Notifications are not switched on for this app yet." });
    }
    const result = await registerNativeDevice(db, {
      orgId, clientId, accountId, sessionId,
      token: body.token, environment: body.environment,
      installationId: body.installation_id
    });
    return res.status(result.created ? 201 : 200).json({ ok: true, registered: true });
  } catch (error) {
    if (error instanceof NativePushError) {
      return res.status(error.status).json({ ok: false, error: "invalid_native_device", message: error.message });
    }
    return res.status(500).json({ ok: false, error: "native_push_failed",
      message: "We could not update this iPhone's notifications just now.", detail: safeError(error) });
  }
}
