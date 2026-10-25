# SOP: Manual SMS send + reply handling (Twilio)

**Owner:** Chris  
**Channel:** SMS via Twilio  
---

## Trigger

Use this when:

- A client needs a text and the app is not sending SMS yet, **or**
- A client texts in and you must answer by hand.

Do **not** use this to drain old queued messages in bulk.

---

## Tools / URLs

| Tool | URL |
|------|-----|
| Twilio console (send / inbox UI) | **UNKNOWN** (not recorded in repo docs) |
| Twilio API base (agents only; you usually use the console) | `https://api.twilio.com` |
| FundHub CRM (log the send) | `https://fundhub.ai` |
| Staff messaging inbox (if thread exists) | `https://fundhub.ai` → staff messages / inbox screen |

Env names (never paste values into notes): `TWILIO_*` send credentials, from-number if set.

---

## Exact steps — send a new SMS

1. Open the client in FundHub CRM (`https://fundhub.ai`). Confirm you have the right person and phone number.
2. Write the message in plain words first (keep it short; no credit outcome promises).
3. Open the Twilio console (**UNKNOWN** URL — use the bookmark you already use for this account).
4. Choose **Messages** (or the send-SMS screen for your account).
5. Set **From** to the FundHub Twilio number (the one tied to this account).
6. Set **To** to the client’s phone in E.164 form when possible (example shape: `+1…`).
7. Paste the message. Send once. Wait for a success / delivered status in Twilio.
8. Copy the Twilio message id (SID) if shown.
9. Back in CRM, add a note on that client:
   - Date/time
   - Channel: SMS
   - Direction: out
   - Short summary of what you said
   - Twilio message id (SID) if you have it
   - Your name
10. If the CRM has an open SMS thread for this client, mirror the same note there so the next person sees it.

---

## Exact steps — handle an inbound reply

1. Check Twilio for new inbound messages (console **UNKNOWN**, or any inbox view you already use).
2. Match the phone number to the client in FundHub CRM.
3. Read the full thread in Twilio so you do not miss context.
4. Decide the reply (or escalate to yourself later if unsure — do not guess legal/credit claims).
5. Send the reply from Twilio using the same From number as above.
6. Log in CRM:
   - What they said (short)
   - What you replied (short)
   - Time
   - Twilio ids if shown
7. If they asked to stop texts / opt out: stop. Mark the client as do-not-text in CRM notes. Do not send again.

---

## What to log

On the client record, every time:

| Field | Example |
|-------|---------|
| When | 2026-08-14 10:05 PT |
| Channel | SMS (Twilio) |
| Direction | in / out |
| Body summary | “Asked for call time; sent Tue 2pm options” |
| Provider id | Twilio Message SID if available |
| Who | Chris |
| Outcome | delivered / failed / opted out |

Never log full API keys. Never paste auth tokens into CRM notes.

---

## How to confirm done

Send is done when **all** are true:

1. Twilio shows the outbound message as accepted / sent (or you clearly marked a failure).
2. CRM note exists with date, summary, and your name.
3. If it was a reply, the inbound message is also noted so the thread is complete.
4. Opt-outs are honored and marked.

---

## Failures (fast list)

| What you see | What to do |
|--------------|------------|
| Twilio rejects the send | Stop. Note the error text (not the key). Fix account/from-number later; do not retry a long loop. |
| Wrong number | Log the mistake. Do not keep texting that number. |
| No CRM match for inbound | Create a short “unknown SMS” note with the phone and hold reply until matched. |
