// Authorized representative, against a real Postgres.
// One login, two files. A third file stays closed. Texts go to him.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { addAuthorizedRep, removeAuthorizedRep, setActiveFile } from "./authorized-rep.mjs";
import { requestMagicLink, verifyMagicLink } from "./magic-link.mjs";
import { verifyAccountSession } from "./account-session.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "authrep-test";
const TPL = "AUTHREP-TEST-SMS";

describe("authorized representative", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await db.query(`DELETE FROM staff WHERE email = $1`, [`${TAG}-staff@x.io`]);
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Auth Rep Fixture', 'admin', 'active')
       RETURNING id`,
      [org, `${TAG}-staff@x.io`]
    )).rows[0].id;
    await db.query(
      `INSERT INTO message_templates (org_id, template_key, channel, body, compliance_passed)
       VALUES ($1, $2, 'sms', 'Hi {{contact.first_name}}', true)
       ON CONFLICT (org_id, template_key) DO NOTHING`,
      [org, TPL]
    );
  });

  after(async () => {
    if (!HAVE_DB) return;
    await wipe();
    await db.query(`DELETE FROM message_templates WHERE org_id = $1 AND template_key = $2`, [org, TPL]);
    await db.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
    await close();
  });

  async function wipe() {
    await db.query(
      `DELETE FROM messages WHERE client_id IN (SELECT id FROM clients WHERE first_name = $1)`,
      [TAG]
    );
    await db.query(
      `DELETE FROM account_magic_links WHERE email LIKE $1`,
      [`${TAG}%`]
    );
    await db.query(
      `DELETE FROM account_sessions WHERE account_id IN
         (SELECT id FROM accounts WHERE email LIKE $1)`,
      [`${TAG}%`]
    );
    await db.query(
      `DELETE FROM client_authorized_reps WHERE client_id IN
         (SELECT id FROM clients WHERE first_name = $1)`,
      [TAG]
    );
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${TAG}%`]);
    // sendTemplated records message.queued on the bus with the client's id,
    // and events.client_id has no cascade (CI: events_client_id_fkey, 2026-10-05).
    await db.query(
      `DELETE FROM events WHERE client_id IN (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(
      `DELETE FROM tasks WHERE client_id IN (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM clients WHERE first_name = $1`, [TAG]);
  }

  const kid = async (email, last, phone) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org, TAG, last, email, phone]
  )).rows[0].id;

  test("one dad opens both kids, not a third, and the text goes to him", async () => {
    await wipe();
    const a = await kid(`${TAG}-a@x.io`, "One", "+15551000001");
    const b = await kid(`${TAG}-b@x.io`, "Two", "+15551000002");
    const c = await kid(`${TAG}-c@x.io`, "Three", "+15551000003");
    const dadEmail = `${TAG}-dad@x.io`;

    const first = await addAuthorizedRep(db, {
      orgId: org, clientId: a, email: dadEmail, name: "Dad Rep",
      phone: "(555) 200-0001", staffId
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await addAuthorizedRep(db, {
      orgId: org, clientId: b, email: dadEmail, name: "Dad Rep",
      phone: "5552000001", staffId
    });
    assert.equal(second.ok, true);
    assert.equal(second.accountId, first.accountId);

    const stolen = await addAuthorizedRep(db, {
      orgId: org, clientId: b, email: `${TAG}-a@x.io`, name: "Nope",
      phone: "5552000009", staffId
    });
    assert.equal(stolen.ok, false);
    assert.equal(stolen.error, "email_is_a_client");

    const issued = await requestMagicLink(db, { email: dadEmail, orgId: org, ip: "203.0.113.50" });
    assert.equal(issued.outcome, "issued");
    const signed = await verifyMagicLink(db, issued.token, { ip: "203.0.113.50" });
    assert.equal(signed.ok, true);
    assert.equal(signed.principal.kind, "client");
    assert.equal(signed.principal.authorizedRep, true);
    assert.equal(signed.principal.clientId, a);

    const session = await verifyAccountSession(db, signed.token);
    assert.equal(session.principal.clientId, a);

    const switched = await setActiveFile(db, { accountId: first.accountId, clientId: b });
    assert.equal(switched.ok, true);
    const after = await verifyAccountSession(db, signed.token);
    assert.equal(after.principal.clientId, b);

    const blocked = await setActiveFile(db, { accountId: first.accountId, clientId: c });
    assert.equal(blocked.ok, false);

    // Bound to the caller's company: the right company still switches, and a
    // different company's id refuses even for a file this login is linked to.
    const sameOrg = await setActiveFile(db, { accountId: first.accountId, clientId: b, orgId: org });
    assert.equal(sameOrg.ok, true);
    const otherOrg = await setActiveFile(db, {
      accountId: first.accountId, clientId: b, orgId: "00000000-0000-4000-8000-0000000000ff"
    });
    assert.equal(otherOrg.ok, false, "a link is honoured only inside the caller's own company");

    const sent = await sendTemplated(db, {
      orgId: org, clientId: b, channel: "sms", templateKey: TPL, eventId: `${TAG}-sms-1`
    });
    assert.equal(sent.sent, true);
    const msg = (await db.query(
      `SELECT to_address, rendered_body FROM messages
        WHERE client_id = $1 AND template_key = $2`,
      [b, TPL]
    )).rows[0];
    assert.equal(msg.to_address, "+15552000001");
    assert.equal(msg.rendered_body, `Hi ${TAG}`);

    const bare = await sendTemplated(db, {
      orgId: org, clientId: c, channel: "sms", templateKey: TPL, eventId: `${TAG}-sms-2`
    });
    assert.equal(bare.sent, true);
    const kidMsg = (await db.query(
      `SELECT to_address FROM messages WHERE client_id = $1 AND template_key = $2`,
      [c, TPL]
    )).rows[0];
    assert.equal(kidMsg.to_address, "+15551000003");

    const other = await addAuthorizedRep(db, {
      orgId: org, clientId: a, email: `${TAG}-mom@x.io`, name: "Mom Rep",
      phone: "5552000002", staffId
    });
    assert.equal(other.ok, true);
    assert.equal(other.replaced, true);
    const still = await db.query(
      `SELECT account_id FROM client_authorized_reps
        WHERE client_id = $1 AND removed_at IS NULL`,
      [a]
    );
    assert.equal(still.rows.length, 1);
    assert.equal(still.rows[0].account_id, other.accountId);

    const gone = await removeAuthorizedRep(db, { orgId: org, clientId: b });
    assert.equal(gone.ok, true);
  });
});
