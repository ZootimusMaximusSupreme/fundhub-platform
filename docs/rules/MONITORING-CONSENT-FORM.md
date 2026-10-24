# Employee monitoring — written notice

**Form version:** 2026-08-04  
**Product:** Fundhub staff deep monitoring (Hubstaff)

> **Legal note.** State and country notice rules vary. This is a plain-language
> draft for operators to adapt. **Get legal review before you use it with real
> employees.** Do not treat this file as finished counsel advice.

---

## What this notice is

Fundhub can optionally record work activity while you are clocked in, using
Hubstaff (or a similar tool). That monitoring is **off by default**. It only
turns on after you sign this notice and an owner records that signature in the
Staff & Teams screen.

If you do not sign, the system will not pull or store Hubstaff activity for you.

---

## What may be collected

While monitoring is on **and** you are clocked in on a shift, Fundhub may receive
and store summaries of:

1. **Activity levels** — how often the keyboard and mouse were active (not the
   actual keys you pressed; Hubstaff does not log keystrokes as text).
2. **Apps and websites** — names of applications and sites used during tracked
   time, with rough time spent.
3. **Screenshots** — still images of your screen when that feature is enabled in
   Hubstaff for your account.

This data is merged onto the same work timeline as your clock-in and clock-out.

---

## When it is collected

- **Only during clocked-in shifts** in Fundhub.
- Time when you are clocked out is not in scope for this merge.
- If consent is revoked, future pulls stop. Past records already stored are not
  automatically erased by a revoke.

---

## Who can see it

Owners (and staff roles allowed to open Staff & Teams telemetry) can see shift
history, hours, and activity summaries for people in their company.

---

## Your acknowledgment

By signing below, you confirm that you have read this notice, understand what
may be collected and when, and agree to deep monitoring under these terms until
you withdraw consent (or the company turns monitoring off for you).

| Field | |
|---|---|
| Employee full name | ________________________________ |
| Employee signature | ________________________________ |
| Date signed | ________________________________ |
| Form version acknowledged | 2026-08-04 |
| Owner who filed the form in Staff & Teams | ________________________________ |
| Date filed in system | ________________________________ |

---

## Withdrawal

You may withdraw consent. When an owner revokes consent in Staff & Teams, the
system clears your consent timestamp and Hubstaff activity is no longer merged
for you.

---

## Operator checklist (Fundhub)

1. Employee signs this form (or a lawyer-approved replacement).
2. Owner opens **Staff & Teams → Clock & consent** and records consent.
3. Map the person to Hubstaff (`staff.hubstaff_user_id`) before polls attach activity.
4. Keep the signed paper or PDF with your HR records.
5. To revoke: owner toggles consent off — `monitoring_consent_at` becomes NULL.
