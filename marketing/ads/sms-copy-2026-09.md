# The text messages we send, rewritten — 2026-09

Written 2026-09-03 for Chris to read before any of it reaches a customer.

**Nothing in this file is live.** The wording below is seeded by one commit whose
subject starts `COPY SEED (HOLD):`. That commit is held back until Chris says
yes. Every code change shipped alongside it works correctly against the wording
that is in the database today, so holding it breaks nothing.

## Why this was rewritten

On the night of 2026-09-03 one phone received **69 texts in two and a half
hours**, 46 of them the same message. Chris read them and said: "The SMS's are
horrible and confusing." Three things were wrong.

1. **One of them was simply untrue.** "Your file is ready" goes out two hours
   after somebody fills in the application. No file exists at that point. The
   file is built on the call.
2. **They all sound the same.** Every one opened "Hey Sim, it's Fundhub" and six
   of the eight ended with the same link. Nothing told the customer which step
   they were on.
3. **One of them read like a scam.** "Hi Sim, Fundhub Capital Academy: pay
   $5,000 <link>" — no person, no reason, no reference to the call it came out
   of.

## The rules this set follows

* **Say which step they are on.** Applied / booked / tomorrow / in two hours /
  starting now / missed it / still not booked. A customer should be able to tell
  where they are from the text alone.
* **Only say things that are true when the message is sent.** No "your file is
  ready" before there is a file. No "tomorrow" for a call that is three days
  out — the code now refuses to send that one at all.
* **Never promise a result.** No amounts, no approvals, no credit-score claims.
  This is a regulated product and those are the sentences that get companies
  into trouble.
* **The opt-out line does not change.** Every message ends
  `Reply STOP to opt out.` — the wording on the application form, word for word.
* **One name.** Chris is the person who talks to people before the call. After
  the booking the sender is Fundhub, because a real advisor takes over. Law:
  no-josh-chris-everywhere (.ai/rules/no-josh-chris-everywhere.md) - Chris is the
  one name on every text, email and call.

## The messages

Anything in `{{double braces}}` is filled in per person when the message is
sent — their first name, their appointment time, their own booking link.

### 1. Right after they apply · `SMS-S00-WELCOME`

Today

> Hey {{contact.first_name}}, it's Fundhub. Got your info. Next step is a quick
> call so we can show you what your profile actually supports:
> {{custom_values.booking_link}} Reply STOP to opt out.

New

> Hi {{contact.first_name}} — Chris at Fundhub. Your application is in. Nothing
> is reviewed yet; that happens live with an advisor on your call. Pick a time
> here: {{custom_values.booking_link}} Reply STOP to opt out.

Why: "what your profile actually supports" hints at a number before anyone has
looked at anything. The new one says exactly what has happened and what happens
next.

### 2. Right after they book · `SMS-S04-01-CONFIRM`

Today

> Hey {{contact.first_name}}, it's Fundhub. You're booked for
> {{appointment.start_time}}. Reply CONFIRM so we know you're set. Reschedule:
> {{custom_values.booking_link}} Reply STOP to opt out.

New

> You're booked, {{contact.first_name}}. {{appointment.start_time}} with a
> Fundhub funding advisor, about 20 minutes. Reply CONFIRM so we know you're
> set, or move it here: {{custom_values.booking_link}} Reply STOP to opt out.

Why: it now says who they are meeting and how long it takes. Those are the two
questions people ask before a call they did not schedule with a person.

### 3. The day before · `SMS-S04-02-REMIND-24H`

Today

> Fundhub reminder, {{contact.first_name}}: your call is tomorrow at
> {{appointment.start_time}}. Reply CONFIRM if you're still good. Reschedule:
> {{custom_values.booking_link}} Reply STOP to opt out.

New

> {{contact.first_name}} — your Fundhub call is tomorrow, at
> {{appointment.start_time}}. Bring your business details; your advisor goes
> through your numbers with you live. Reply CONFIRM if you're still good, or
> move it: {{custom_values.booking_link}} Reply STOP to opt out.

Why: the word "tomorrow" was the problem, and the fix for that is in the code,
not the wording — this message is now only sent when the call really is
tomorrow. The wording gains the one useful instruction: turn up with your
details.

### 4. Two hours before · `SMS-S04-03-REMIND-2H`

Today

> Fundhub reminder, {{contact.first_name}}: your call starts at
> {{appointment.start_time}}. Reply CONFIRM if you're good to go. Reschedule:
> {{custom_values.booking_link}} Reply STOP to opt out.

New

> {{contact.first_name}} — your Fundhub call is in about two hours, at
> {{appointment.start_time}}. Reply CONFIRM if you're good to go, or move it:
> {{custom_values.booking_link}} Reply STOP to opt out.

Why: it never said how far away the call was, which is the entire point of a
two-hour reminder.

### 5. Fifteen minutes before · `SMS-AISET04-HANDOFF`

Today — this is what actually arrived, full stop and all

> Hey {{contact.first_name}}, it's Chris from Fundhub. Your call starts in 15
> minutes. I've intro'd your advisor so you're not walking in cold — link: .
> See you soon. Reply STOP to opt out.

New

> {{contact.first_name}}, it's Chris at Fundhub. Your call starts in 15 minutes,
> and I've briefed your advisor so you're not starting from scratch. Everything
> you need is here: {{appointment.meeting_location}} Reply STOP to opt out.

Why: the empty link is fixed in the code — the message now always carries a real
address, and if the funnel gave us none it points at the customer's own sign-in
page. "Everything you need is here" is true of both, which "link:" was not.

### 6. After a missed call · `SMS-S05A-NOSHOW-RECOVERY`

Today

> Hey {{contact.first_name}}, it's Fundhub. Looks like we missed each other. No
> problem — grab a new time whenever works: {{custom_values.booking_link}} Reply
> STOP to opt out.

New

> {{contact.first_name}}, it's Fundhub — looks like we missed each other on your
> call. Nothing is lost and nothing is closed. Grab a new time whenever suits:
> {{custom_values.booking_link}} Reply STOP to opt out.

Why: this one was already close. It only gains the reassurance people actually
want after standing somebody up.

### 7. Applied but never booked · `SMS-NOBOOK-01` (two hours later)

Today — **this is the message that went out 46 times, and it is false**

> Hey {{contact.first_name}}, it's Fundhub. Your file is ready — grab a time so
> we can walk you through what it supports: {{custom_values.booking_link}} Reply
> STOP to opt out.

New

> {{contact.first_name}}, it's Chris at Fundhub. Your application is in, but
> there's no call on the calendar yet — and the call is where an advisor goes
> through your options with you. Pick a time: {{custom_values.booking_link}}
> Reply STOP to opt out.

### 8. Still not booked · `SMS-NOBOOK-02` (a day later)

Today

> Hey {{contact.first_name}}, Chris from Fundhub here. Still worth a look — same
> file, wrong order of apps is usually the ceiling. Book here:
> {{custom_values.booking_link}} Reply STOP to opt out.

New

> {{contact.first_name}} — Chris at Fundhub again. Still nothing on the calendar.
> It's about 20 minutes with an advisor and you'll leave knowing where you
> stand. {{custom_values.booking_link}} Reply STOP to opt out.

Why: "wrong order of apps is usually the ceiling" is company shorthand. Nobody
outside the building knows what it means.

### 9. Last one · `SMS-NOBOOK-03` (three days later)

Today

> Last nudge from Chris at Fundhub, {{contact.first_name}}. Want help mapping
> your cleanest path? {{custom_values.booking_link}} Reply STOP to opt out.

New

> Last one from me, {{contact.first_name}} — Chris at Fundhub. If now isn't the
> time, no problem, your application stays saved. If it is, the calendar is
> here: {{custom_values.booking_link}} Reply STOP to opt out.

### 10. The email subject that repeats the same untruth · `EMAIL-NOBOOK-01`

Today the subject line reads **"Your file is ready — the call isn't booked
yet"**. The first half is not true. New subject:

> Your application is in — the call isn't booked yet

Only the subject changes. The body of that email is not touched here.

## The payment link text · not a template, already shipped

The "pay $5,000" text is not one of these templates — the closer's screen writes
it directly — so it is not in the held commit. It is fixed in the code and is
live with everything else:

Today

> Hi Sim, Fundhub Capital Academy: pay $5,000 <link>

New

> Hi Sim, it's Fundhub. Here's the Capital Academy payment link from your call —
> $5,000: <link>
> Questions before you pay? Reply here and your advisor will answer. Reply STOP
> to opt out.

## What is not in this file

* **The emails.** Only the one false subject line above is changed. The rest of
  the email set was not part of the night's complaint and is left alone.
* **How often anything is sent.** That is fixed in the code, not the wording:
  one survey now starts one run instead of sixteen, and a reminder whose moment
  has passed is not sent at all.
* **Any claim about what a customer will get.** There is none in this set and
  none should be added.
