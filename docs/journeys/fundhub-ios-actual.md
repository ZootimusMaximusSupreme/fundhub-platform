# Fundhub iOS app — actual push path (2026-10-17)

The client Home calls the native push status route with its bearer session and this installation's
UUID. If the server lacks the Apple signing key or encryption key, the card says setup is not
ready and never spends the iOS permission prompt. If ready, the client may grant permission;
Apple returns an APNs device token, and the app registers it under the authenticated client,
account, and session. The token is encrypted at rest. Turning off notifications sends DELETE
for this installation and unregisters with iOS. Native sign-out attempts DELETE and logout,
then clears the local session even when the network is down. A server session that is revoked
or expired cannot pass the sender's device query.

The server's APNs sender only accepts bodies from the existing lock-screen whitelist. It has
no automatic workflow caller. Apple App ID capability, APNs key, signed entitlement, and a
delivered real-iPhone test have not been verified. This is source behavior, not a live PASS.
