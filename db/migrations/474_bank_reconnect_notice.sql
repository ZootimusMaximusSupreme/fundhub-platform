-- 474_bank_reconnect_notice.sql — the one text a client gets when a bank login breaks.
--
-- FinanceOS F2. When Plaid says a bank login needs the client to sign in again, the
-- daily refresh marks plaid_items.link_state = 'error' and stops reading it. The
-- client can now put it right (POST /api/banking/relink, src/banking/plaid-relink.mjs)
-- and is told once that they should (src/finance/bank-reconnect-notice.mjs). Flow:
-- docs/journeys/bank-relink-flow.md. Contract for the screen: docs/finance/bank-relink.md.
--
-- Two things in one file, both additive. Re-running it is a no-op.
--
--   1. plaid_items.reconnect_notified_at — one nullable column.
--   2. One SMS template, seeded the way 433, 444 and 471 seed theirs.
--
--
-- *** 1. reconnect_notified_at: WHEN THE CLIENT WAS TOLD, FOR THE CURRENT ERROR ***
--
-- It is what makes the text go out ONCE PER ERROR EPISODE. An episode starts when a
-- login goes to 'error' and ends when a read proves it works again.
--
--   NULL   the client has not been texted for the current error (or the login has
--          never been in error, or the error is over). A login in 'error' with a
--          NULL here is waiting for its text.
--   a time the text was queued. The login in 'error' is not texted again.
--
-- The text job (bank-reconnect-notice.mjs) sets it after the text is queued.
-- finishRelink clears it, and only after a read of the bank worked — a failed attempt
-- leaves it, so a client who tries and fails is not texted again. A text that could
-- not be queued (the client opted out, the template is not approved) leaves it NULL,
-- so the next daily pass tries again while the episode is open.
--
-- NOT A COLUMN ON A NEW TABLE: the fact belongs to the login, one login has one open
-- episode at a time, and nothing reads a history of them. messages already records
-- every text that went out (and its provider_ref is the second guard against a
-- double send).
--
-- It is not a credential and no API returns it.
--
--
-- *** 2. THE TEXT — SEEDED NOT APPROVED, ON PURPOSE ***
--
-- Used by src/finance/bank-reconnect-notice.mjs through sendTemplated, which only
-- queues; the dispatcher sends, behind dry-run, quiet hours and the opt-out read.
-- FinanceOS tells and reminds. It never moves money.
--
-- THE ROW IS SEEDED WITH compliance_passed = false. The text tells the client to
-- "tap Reconnect" in FinanceOS, and that button is not built yet (the back end,
-- POST /api/banking/relink, is; the screen is not: docs/finance/bank-relink.md is its
-- contract). A text that goes out tells a paying client to press a button that is not
-- there, and a text cannot be taken back. sendTemplated refuses a template that is not
-- approved (reason 'template_pending'), so until the screen ships the daily job queues
-- nothing, writes no message row and leaves reconnect_notified_at NULL for every login.
--
-- WHEN THE SCREEN SHIPS, turn the text on in the SAME change as the screen: a new
-- migration that sets compliance_passed = true for this key (and only this key). The
-- next 07:00 UTC pass then texts every paying client whose login is still in 'error'
-- once, because their marker is still NULL. Nothing is lost by waiting.
--
-- WHILE IT IS HELD the pulse still goes red (gap-bank-relink,
-- bank-relink-error-login-not-told) the day a paying client's login has been broken
-- for 2 days and nobody has told them. That is the point: a held text must not hide a
-- client who is stuck. The red's fix line says the text is held on purpose.
--
-- The one {{bank.*}} tag is filled by that job, not by the client record:
--   bank.name   the bank's own name, e.g. "Chase". "bank" when the name is not known.
--               A sandbox login's "(Plaid sandbox — test data)" label is left off.
--
-- Renders as: "Fundhub alert: your Chase connection needs a quick reconnect in
-- FinanceOS. Open FinanceOS and tap Reconnect. Reply STOP to opt out."
--
-- A test renders this template against the sentence the planner stores
-- (src/finance/bank-reconnect-notice.test.mjs), so the two cannot drift.
--
-- DO NOTHING on conflict: a company that already edited this key in the template
-- editor keeps its own copy.

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS reconnect_notified_at timestamptz;

COMMENT ON COLUMN plaid_items.reconnect_notified_at IS
  'When the "needs a quick reconnect" text was queued for the login''s CURRENT error. NULL = not texted for this error (or no error). Cleared only after a read of the bank worked (finishRelink), so one text per error episode. Not a credential, never returned by an API.';

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id,
       'SMS-FINANCE-OS-RECONNECT',
       'sms',
       NULL::text,
       $c$Fundhub alert: your {{bank.name}} connection needs a quick reconnect in FinanceOS. Open FinanceOS and tap Reconnect. Reply STOP to opt out.$c$,
       false
  FROM orgs o
ON CONFLICT (org_id, template_key) DO NOTHING;
