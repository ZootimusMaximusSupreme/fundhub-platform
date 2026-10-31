// S-NOBOOK — Fall-off chase when survey is done but they never booked.
// Owner 2026-08-15: three SMS, rebook link, no video / meme assets required.
// Text can mention "results" in plain language; MMS media is optional later.
//
// Trigger: survey.submitted. Exits when booking.created appears for the client.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { messageCohortId, sendTemplated } from "./messaging.mjs";

export const SMS_NOBOOK_01 = "SMS-NOBOOK-01";
export const SMS_NOBOOK_02 = "SMS-NOBOOK-02";
export const SMS_NOBOOK_03 = "SMS-NOBOOK-03";
export const EMAIL_NOBOOK_01 = "EMAIL-NOBOOK-01";
export const EMAIL_NOBOOK_02 = "EMAIL-NOBOOK-02";
export const EMAIL_NOBOOK_03 = "EMAIL-NOBOOK-03";

/* hasBooked — has this person booked a call yet?
 *
 * THE OLD VERSION COULD ONLY EVER SAY NO. It asked for booking events
 * `WHERE client_id = $1`, and until 2026-09-03 the ClickFunnels adapter wrote
 * every funnel event with client_id NULL. So the chase never learned that
 * anybody had booked, and on 2026-09-03 one phone received 51 copies of "you
 * have not booked yet" from customers who were sitting in the Booked column.
 *
 * The adapter now stamps the client on new events. This is the other half:
 * every booking event ALREADY IN THE DATABASE still has a null client on it,
 * and every chase run sleeping in production is going to wake against those
 * rows. So the booking is also matched on the email address and the phone
 * number carried in the event's own payload — which is how a run that went to
 * sleep last night exits on wake instead of firing again.
 *
 * Scoped to the client's own company. The old query was not, and matching on an
 * email address without that scope would let one company's booking answer for
 * another's. Phone numbers are compared on their last ten digits so
 * "+1 555-000-1111" and "5550001111" are the same number.
 *
 * THE FALLBACKS ONLY APPLY TO UNSTAMPED ROWS (2026-09-17). The address match was
 * built to rescue the old rows that have no customer on them, and it was not
 * limited to those — so it also matched a NEW, properly-stamped booking that
 * belongs to somebody else who shares the address. Two people on one phone
 * number (a husband and wife, a business owner and their bookkeeper) is enough
 * to do it, and on the 2026-09-17 walk seven records shared one test number, so
 * four other people's bookings answered "yes, they booked" for a client who
 * never booked at all and the chase exited at already_booked every time.
 * `e.client_id IS NULL` on the two fallbacks confines them to exactly the
 * historical rows they were written for. A booking that IS stamped with this
 * client still stops the chase, through the first branch.
 */
export async function hasBooked(db, clientId) {
  const r = await db.query(
    `WITH me AS (SELECT org_id, email, phone FROM clients WHERE id = $1)
     SELECT 1 AS booked
       FROM events e, me
      WHERE e.name = 'booking.created'
        AND e.org_id = me.org_id
        AND (
             e.client_id = $1
          OR (e.client_id IS NULL
              AND me.email IS NOT NULL
              AND lower(COALESCE(e.payload->>'email','')) = lower(me.email))
          OR (e.client_id IS NULL
              AND length(regexp_replace(COALESCE(me.phone,''), '\\D', '', 'g')) >= 10
              AND right(regexp_replace(COALESCE(e.payload->>'phone',''), '\\D', '', 'g'), 10)
                = right(regexp_replace(me.phone, '\\D', '', 'g'), 10))
        )
      LIMIT 1`,
    [clientId]
  );
  return r.rows.length > 0;
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // Already booked by the time we wake — common if they book on the thank-you page.
  if (await step.run("check-already-booked", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "already_booked" };
  }

  const orgId = event.orgId;
  const eventId = event.id;

  await step.sleep("wait-2h", "2h");
  if (await step.run("check-booked-1", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-wait-2h" };
  }
  const msg1 = await step.run("send-nobook-1", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: "survey.submitted" });
    return {
    sms: await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_01,
      eventId: `${cohortId}:1`
    }),
    email: await sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_NOBOOK_01,
      eventId: `${cohortId}:1e`
    })
    };
  });

  await step.sleep("wait-24h", "24h");
  if (await step.run("check-booked-2", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg1", msg1 };
  }
  const msg2 = await step.run("send-nobook-2", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: "survey.submitted" });
    return {
    sms: await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_02,
      eventId: `${cohortId}:2`
    }),
    email: await sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_NOBOOK_02,
      eventId: `${cohortId}:2e`
    })
    };
  });

  await step.sleep("wait-72h", "72h");
  if (await step.run("check-booked-3", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg2", msg1, msg2 };
  }
  const msg3 = await step.run("send-nobook-3", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: "survey.submitted" });
    return {
    sms: await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_NOBOOK_03,
      eventId: `${cohortId}:3`
    }),
    email: await sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_NOBOOK_03,
      eventId: `${cohortId}:3e`
    })
    };
  });

  return { done: true, exitedAt: "completed", msg1, msg2, msg3 };
}

export const sNobookChase = inngest.createFunction(
  { id: "s-nobook-chase", name: "S-NOBOOK — Never Booked Chase" },
  { event: "survey.submitted" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
