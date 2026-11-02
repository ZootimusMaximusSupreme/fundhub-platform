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
automatic client workflow callers after a gated client email or text succeeds.

Staff sessions now register their own encrypted device rows through the same
native-device route. A staff lead, set, or upcoming push opens the relevant
setter or closer dashboard with `client_id` selected. The setter dashboard
selects the matching contact row and its existing Call action opens the phone
dialer. `src/push/native-send.mjs` claims each staff alert once in
`staff_apns_alerts` before the Apple send. Apple App ID capability, APNs key,
signed entitlement, and a delivered real-iPhone staff test have not been
verified. This is source behavior, not a live PASS.

Staff notification taps are bound to the saved bearer session when tapped. A
different sign-in cannot consume that queued contact link, and sign-out clears
both staff and client queued opens. A cold-start tap reads the saved sign-in
before queuing the link; without one, the tap fails closed. The queued link is
single-use and expires after five minutes. The workspace clears its selected
staff contact path when the token or signed-in identity changes.
