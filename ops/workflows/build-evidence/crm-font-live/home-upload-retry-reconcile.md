# Home upload retry proof reconciliation

Existing sole Home builder; base PR71 b0cf6c53796ca1e2682d5c1c003dc306867ae801.

Read current Home upload handler and existing fin-b06 display browser proof through GitHub. No Home production source defect found: a badrequest/HTTP400 invalid-file response deliberately clears the rejected selection, restores the original picker label, and explains why a different file is needed. A server/HTTP500 failure retains the selection and offers Try again. The old proof conflated these two contracts and waited for Try again after invalid_file_type.

Corrected the existing proof without changing runtime code: every funding/inquiry/bureau door posts one invalid selection; asserts the original picker label and exact server refusal plus Pick a different file; proves its next press opens a chooser without another invalid POST; chooses a replacement PDF; proves HTTP500 shows Try again, then retry succeeds with HTTP200 and Sent without choosing another file. Exact POST counts remain 1/2/3. No successful UI claim is allowed on either refusal.

Only the existing proof and this note change. No portal HTML/CSS, shared header/nav/font, API, permission, data, upload, consent, payment, referral or PWA behavior changed. No real account writes or uploads performed. GitHub-only execution; filesystem/runtime unavailable. Focused browser run is delegated to the lead's existing GitHub Actions runner and is not claimed passed here. Professional Home visual proofs already integrated remain unchanged.
