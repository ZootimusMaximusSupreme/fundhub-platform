import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { authenticate } from "../../src/http/middleware/requireAuth.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  NativePushError, countNativeDevices, nativePushConfigured,
  registerNativeDevice, revokeNativeDevice
} from "../../src/push/native-store.mjs";
import {
  countStaffNativeDevices, registerStaffNativeDevice, revokeStaffNativeDevice
} from "../../src/push/staff-native-store.mjs";

// Native APNs registration is deliberately separate from the portal's web push.
// The bearer session chooses its client or staff owner; the body cannot.
export default async function handler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "POST", "DELETE"].includes(method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const principal = await requirePrincipal(req, res, ["client", "staff"], { db });
  if (!principal) return;
  if (principal.kind === "staff") {
    if (!["owner", "setter", "closer"].includes(principal.role)) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    // requirePrincipal resolves the staff identity but does not return the
    // session ID. Re-check the bearer so the device binds to this live session.
    const current = await authenticate(req, { db });
    const sessionId = current?.session?.id;
    if (!sessionId) return res.status(401).json({ ok: false, error: "unauthorized" });
    try {
      if (method === "GET") {
        const count = await countStaffNativeDevices(db, {
          orgId: principal.orgId, staffId: principal.staffId, sessionId,
          installationId: req.query?.installation_id
        });
        return res.status(200).json({ ok: true, configured: nativePushConfigured(), registered: count > 0 });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      if (method === "DELETE") {
        const result = await revokeStaffNativeDevice(db, {
          orgId: principal.orgId, staffId: principal.staffId,
          installationId: body.installation_id
        });
        return res.status(200).json({ ok: true, ...result });
      }
      if (!nativePushConfigured()) {
        return res.status(503).json({ ok: false, error: "native_push_unconfigured",
          message: "Notifications are not switched on for this app yet." });
      }
      const result = await registerStaffNativeDevice(db, {
        orgId: principal.orgId, staffId: principal.staffId, sessionId,
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
