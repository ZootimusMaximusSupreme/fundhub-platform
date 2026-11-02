// No message asks a lead to reply to confirm (owner rule, Chris, 2026-10-31;
// .ai/rules/confirm-on-the-calendar.md).
//
// "We don't care if they say yes. We want them to perform an action." The one
// action is accepting the calendar invite in their email. So after every migration
// and seed has run, no template may ask for a reply of YES, C or CONFIRM, and none
// may carry a "for compliance" line. Seed 305 took the last ones out; this keeps a
// new seed from bringing one back.
//
// Read only. It runs against the database the suite was given (CI's real Postgres,
// or a scratch copy) and skips without one. A skip is not a pass.

import { test, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";

const HAS_DB = Boolean(process.env.DATABASE_URL);

// "Reply YES", "Text YES", "reply with: “CONFIRM”", "Reply C", also when the words break
// across a line ("reply\n “CONFIRM”", the way the older live emails are written).
// "Reply STOP to opt out" is the opt-out the law asks for, not a confirm, and does not match.
export const REPLY_TO_CONFIRM = "\\m(reply|text)(\\s+back)?(\\s+with)?:?\\s*[\"“]?(yes|confirm|c)\\M";
export const COMPLIANCE_LINE = "for compliance";

after(async () => { if (HAS_DB) await close(); });

test("no template asks a lead to reply YES, C or CONFIRM, or says it is for compliance", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT DISTINCT template_key FROM message_templates
      WHERE COALESCE(body, '') ~* $1 OR COALESCE(subject, '') ~* $1
         OR COALESCE(body, '') ~* $2 OR COALESCE(subject, '') ~* $2
      ORDER BY template_key`,
    [REPLY_TO_CONFIRM, COMPLIANCE_LINE]
  );
  assert.deepEqual(rows.map((r) => r.template_key), [],
    "these templates still ask for a reply to confirm; the action is accepting the calendar invite (seed 305)");
});

test("the booking text and both reminders send people to the calendar invite", { skip: !HAS_DB }, async () => {
  const { rows } = await db.query(
    `SELECT template_key, body FROM message_templates
      WHERE template_key = ANY($1)`,
    [["SMS-S04-01-CONFIRM", "SMS-S04-02-REMIND-24H", "SMS-S04-03-REMIND-2H"]]
  );
  assert.ok(rows.length >= 3, "the three booking texts are seeded");
  for (const r of rows) {
    assert.match(r.body, /calendar invite/, `${r.template_key} points to the calendar invite`);
    assert.doesNotMatch(r.body, /\bJosh\b/, `${r.template_key} is signed Chris`);
  }
});

test("the pattern catches the asks and leaves the opt-out alone", () => {
  const re = new RegExp(REPLY_TO_CONFIRM.replace("\\m", "\\b").replace("\\M", "\\b"), "i");
  for (const ask of ["Reply CONFIRM so we know you're set", "Reply YES and you're set", "Text YES so I know",
    "hit reply with: “CONFIRM”", "reply “CONFIRM” if you’re still good", "Reply C to confirm",
    "For compliance and scheduling, reply\n “CONFIRM” if you’re still good for", "hit reply with:\n “CONFIRM” ."]) {
    assert.match(ask, re, ask);
  }
  for (const fine of ["Reply STOP to opt out.", "Questions? Just reply here.", "Accept the calendar invite in your email.",
    "Here is the context: yes, it is free."]) {
    assert.doesNotMatch(fine, re, fine);
  }
});
