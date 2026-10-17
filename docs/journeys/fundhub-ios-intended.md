# Fundhub iOS app — intended

## Clients

1. A client asks for an email link, copies it from the message without opening it, and pastes it into the app. Team members use the separate password form.
2. The app verifies the server session and stores the token in the iPhone Keychain.
2a. On a later app launch, the iPhone asks the returning user to unlock the saved session with Face ID or device passcode before the app reads that token. Canceling the prompt leaves the app at sign-in. A visible retry action can ask again; email/password or one-time link remains available.
3. Home reads `/api/read/portal-summary` under that client session. The server picks the client from the session, not from an ID in the app.
4. The top of Home says where the file stands. Advisor, documents, and any amount due are shown only when the server returned them. A failed read says the file could not be loaded; it never paints a fake empty file.
5. **Open full portal** opens the existing Fundhub portal in an in-app view for documents, payments, messages, and other detailed actions.
6. Sign out asks the server to revoke the session, then removes the native token and in-app web data. If the server cannot be reached, the app says that revocation could not be confirmed.
7. The client can opt in to native iPhone notifications from Home only after the server and Apple signing are ready. The app registers this installation under the current client session; turning notifications off or signing out revokes it. A revoked or expired session must never receive another alert. Staff do not get this client notification card.

## Employees

1. An employee uses the same sign-in form and is identified by `/api/auth/session` as `staff`.
2. Staff Home shows the real role and opens that role's existing workspace screen. The client summary is never requested under a staff session without a selected client.
3. Signing out in the native Home or the web workspace leaves both signed out. The native action asks the server to revoke the session, then removes local data.
4. Signing out removes the saved quick sign-in from the iPhone. The next login requires the normal email/password or email-link path before Face ID can be used again.

## States

Loading: visible progress in the real home layout. Empty: no file data or work item is invented. Error: a true retry message. Full: actual server data and a working role-appropriate action.

No Apple account or App Store release claim follows from a simulator build. Review must also check the app on a real iPhone, the sign-in email link, and a real client/staff account before App Store submission.
