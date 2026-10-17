# Client message push — intended journey (owner review)

Role: a signed-in Fundhub client who has turned on notifications on a phone.
Job: learn that Fundhub sent a message and open the client portal for the next step.

1. An outbound client email or SMS enters the existing message dispatcher. Its normal gate decides opt-out, hours, company pause, cap, draft status, test record, dry run, routing, and provider eligibility. Push does not bypass or change any of those decisions.
2. Only after a transmitting provider reports the email or SMS sent and the dispatcher records that result may a companion push be attempted. A blocked, deferred, failed, or test-provider message sends no push.
3. A generic service alert has no email/SMS body, name, amount, or private file detail on the lock screen. The booking-confirmation text keeps its approved call-confirmation alert. The tap target is the signed-in portal, not an untrusted URL.
4. Eligible, opted-in web-push and native iPhone devices are tried independently. Missing devices are an ordinary no-op. A push failure cannot retry or undo an already delivered email or SMS.
5. Promotional campaign messages are not mirrored by default. The one initial BS pre-call alert may send only after its actual SMS succeeds, the client's separate marketing-push preference is true, neither email nor SMS is opted out, and a recent-alert cap allows it. Other BS, no-book, no-show, SLO, offer, nurture, application-follow-up, and AI-set follow-up sequences wait for their own action and cap proof.
6. The native app opens the authenticated portal after an approved notification tap. It never auto-calls or opens a URL supplied by a push. A real Join Call action is a separate journey and requires a verified current meeting link.

Success requires focused dispatcher/payload tests, a clean release, an opted-in real phone receiving an APNs alert, and a tap that opens the correct signed-in client portal. Until those checks pass, source code is not a live-delivery claim.
