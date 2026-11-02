---
description: Josh is gone. Every text, email, call and screen a lead, client or staff member reads or hears says Chris
alwaysApply: true
---

# No Josh. It is Chris everywhere.

**Owner law (2026-10-31):** Chris: "from now on we're gonna be removing Josh AI from the system because it's too confusing. People are like, oh, am I hopping on a call with Josh? Am I hopping on a call with Chris? ... Anywhere in the repo that says Josh just remove it it's Chris now for everything ... just use my name ... I'll sign it."

## Always

- Write **Chris** for the setter and for the sender of anything a lead, client or staff member can read or hear: texts, emails and their sign-offs, the email footer and its signature picture, screens and wireframes, agent names and prompts, the voice agent's introduction and voicemail, ad and SMS copy, docs, skills.
- Change live words with a new seed numbered after the last one. Live templates, agents and saved journeys are database rows, so editing an old seed changes nothing on production. The pattern is `db/seed/303_no_josh_chris.sql`: a whole-word swap that finds every row that still says Josh, clears the sign-off columns, and leaves the approval flag alone.
- When a plain swap reads wrong ("Chris is the setter. The AI setter (Chris) stays off."), drop the name from that sentence.
- Say what you kept and why. A leftover is only allowed from the list below.

## Never

- Write Josh in a new text, email, prompt, screen, doc, skill or rule.
- Give the AI setter a new persona name. It is Chris.
- Rename a machine id to remove Josh from it. Renaming drops runs that are already asleep and breaks the heartbeat history.
- Edit an applied migration or an old seed to remove Josh. That changes nothing on production.

## Kept on purpose (not a leak)

- Applied migrations and older seeds. Dated boards and evidence (`ops/`, `docs/journeys/CHANGELOG.md`, `ops/ship-log.md`).
- Machine ids: the Inngest function id `ai-set-01-josh-setter` and its step ids (`resolve-josh`, `place-josh-call`), the `outbound_calls.kind` value of the same name, heartbeat and tripwire keys, and file names. The code names that mirror them (`JOSH_CODE`, `aiSet01JoshSetter`) stay too.
- Real people with that first name, such as Josh Hamilton and Josh Snow, the first name Joshua, and the name of a Bland voice in the vendor catalog.
- The old `josh-signature` picture files. Emails already in people's inboxes load them by address.

## Example

```text
Ask: "Add a reminder text for no-shows."

❌ "Hey {{contact.first_name}}, it's Josh from Fundhub. ..."
✅ "Hey {{contact.first_name}}, it's Chris from Fundhub. ..."

Ask: "Rename the Inngest function so it does not say josh."

❌ Change the function id. Runs that are asleep are lost.
✅ Change the display name to "AI-SET-01 — Chris Setter". Keep the id.
```
