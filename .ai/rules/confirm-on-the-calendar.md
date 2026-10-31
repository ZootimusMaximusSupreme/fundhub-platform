---
description: No message asks a lead to reply to confirm; the one action is accepting the calendar invite
alwaysApply: true
---

# Confirm on the calendar, never by reply

**Owner law (2026-10-31):** Chris: "We don't care if they say yes. We want them to perform an action." Saying CONFIRM in a text and confirming the call are two different things. "I don't want, anywhere that says reply confirm. I want them to confirm."

## Always

- Ask for the one real action: accept the calendar invite in their email. The booking already sends a real invite with the guest and the meeting link.
- Give the reschedule link only as the way out ("Can't make it? Move it here").
- Keep "Reply STOP to opt out." It is the opt-out, not a confirm.
- Keep the code that reads replies. A reply still stops a chase and still gets answered. Only the asks go.

## Never

- "Reply CONFIRM", "Reply YES", "Text YES", "Reply C", "hit reply with CONFIRM", in any text, email, script, page or AI prompt.
- "For compliance" lines in customer words.

## Where it is held

- `db/seed/305_confirm_on_calendar.sql` took the last asks out of the templates.
- `src/messaging/no-reply-to-confirm.pg.test.mjs` fails if any template asks again.

## Example

```text
Booking text.

❌ "You're booked for 10:00 AM. Reply CONFIRM so we know you're set."
✅ "You're booked for 10:00 AM. Accept the calendar invite in your email to lock in your time. Can't make it? Move it here: <link>"
```
