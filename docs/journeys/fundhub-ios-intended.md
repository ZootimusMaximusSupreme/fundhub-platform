# Fundhub iOS app — intended

## Clients

1. A client signs in with their Fundhub email and password, or asks for an email link and pastes that link into the app.
2. The app verifies the server session and stores the token in the iPhone Keychain.
3. Home reads `/api/read/portal-summary` under that client session. The server picks the client from the session, not from an ID in the app.
4. The top of Home says where the file stands. Advisor, documents, and any amount due are shown only when the server returned them. A failed read says the file could not be loaded; it never paints a fake empty file.
5. **Open full portal** opens the existing Fundhub portal in an in-app view for documents, payments, messages, and other detailed actions.
6. Sign out removes the native token and in-app web data.

## Employees

1. An employee uses the same sign-in form and is identified by `/api/auth/session` as `staff`.
2. Staff Home shows the real role and opens that role's existing workspace screen. The client summary is never requested under a staff session without a selected client.
3. Sign out removes the native token and in-app web data.

## States

Loading: visible progress in the real home layout. Empty: no file data or work item is invented. Error: a true retry message. Full: actual server data and a working role-appropriate action.

No Apple account or App Store release claim follows from a simulator build. Review must also check the app on a real iPhone, the sign-in email link, and a real client/staff account before App Store submission.
