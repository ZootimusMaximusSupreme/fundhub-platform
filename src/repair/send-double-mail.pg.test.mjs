// COMPLIANCE REVIEW REQUIRED — dispute logic and fee timing.
//
// Postgres-backed proof that posting the same send payload twice produces
// EXACTLY ONE mailing and ONE letter row.
//
// WHY THIS CANNOT BE A UNIT TEST. The whole claim is about what the database
// adjudicates. src/repair/send.test.mjs drives a fake db that answers every
// query with no rows, so it can prove the loop calls a mailer and nothing more.
// Only a real Postgres can show that the second POST is refused by
// dispute_letters itself — by the conditional claim, and by
// uq_dispute_letters_one_mailing (db/migrations/332, reworked by 333).
//
// AND THAT THE GUARD DOES NOT OVERREACH. 332 stamped mailed_at at CLAIM time,
// so a send that never reached the network still consumed the letter's only
// mailing slot for ever — worse than the bug it prevents. 333 splits the claim
// (send_claimed_at, releasable) from the mailing (mailed_at, permanent). The
// tests below watch both halves: nothing mails twice, and nothing dies for a
// send that did not happen.
//
// WHAT WAS BROKEN. src/repair/send.mjs set status='sent' with no check of the
// current status, and dispute_letters had no unique index. A retry, a second
// browser tab, or curl mailed the letter again: two envelopes to the consumer,
// two to the bureau, and two PostGrid bills. The only thing in the way was a
// disabled button.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { sendRepairLetters, clearStuckSendClaim, listStuckSendClaims } from "./send.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const CLIENT_EMAIL_LIKE = "doublemail.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "doublemail_pg_test_%@example.com";

const FROM = {
  first_name: "Pat",
  last_name: "Client",
  address_line1: "12 Oak St",
  address_city: "Dallas",
  address_state: "TX",
  address_zip: "75201"
};

describe("repair send — one press, one mailing", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, staffId, caseId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // A successful send fires repair.letters.sent, and the handler behind it
      // writes rows that hold a plain (non-cascading) reference to the client.
      // They have to go first or the client delete is refused. dispute_cases,
      // dispute_letters and dispute_items all cascade and need no help.
      for (const t of ["messages", "events", "cards", "tasks"]) {
        await db.query(`DELETE FROM ${t} WHERE client_id = ANY($1)`, [ids]).catch(() => {});
      }
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const mkLetter = async ({ bureau = "EX", round = "R1", target = "bureau" } = {}) => (await db.query(
    `INSERT INTO dispute_letters (case_id, org_id, client_id, bureau, round, status, body_text, target)
     VALUES ($1,$2,$3,$4,$5,'ready','Dear sir or madam,',$6) RETURNING *`,
    [caseId, org, client, bureau, round, target]
  )).rows[0];

  const letterRow = async (id) => (await db.query(
    `SELECT * FROM dispute_letters WHERE id = $1`, [id]
  )).rows[0];

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();
    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Doublemail Pgtest Closer','closer',$2,'active') RETURNING id`,
      [org, "doublemail_pg_test_closer@example.com"]
    )).rows[0].id;
    client = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Doublemail','Subject',$2) RETURNING id`,
      [org, "doublemail.pg.test.subject@example.com"]
    )).rows[0].id;
    caseId = (await db.query(
      `INSERT INTO dispute_cases (org_id, client_id, bureau, round)
       VALUES ($1,$2,'EX','R1') RETURNING id`,
      [org, client]
    )).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  test("the same payload posted twice mails once and leaves one letter row", async () => {
    const letter = await mkLetter({ bureau: "EX" });
    const mailed = [];
    const payload = {
      orgId: org,
      clientId: client,
      staffId,
      mail: true,
      from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>round one</html>", caseId }],
      mailSender: async (l) => {
        mailed.push(l.letterId);
        return { ok: true, providerId: `ltr_${mailed.length}`, outcome: "sent" };
      }
    };

    const first = await sendRepairLetters(db, payload);
    const second = await sendRepairLetters(db, payload);

    assert.equal(first.ok, true, "the first press mails");
    assert.equal(mailed.length, 1, "the mailer was called exactly once across both presses");
    assert.equal(second.ok, false, "the second press mails nothing");
    assert.equal(second.results[0].error, "already_mailed");

    const rows = (await db.query(
      `SELECT id, status, postgrid_letter_id, mailed_at FROM dispute_letters
        WHERE client_id = $1 AND bureau = 'EX' AND round = 'R1'`,
      [client]
    )).rows;
    assert.equal(rows.length, 1, "exactly one letter row");
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].postgrid_letter_id, "ltr_1", "the provider id is the FIRST send's, not a second one");
    assert.ok(rows[0].mailed_at, "the provider took it, so mailed_at is stamped");
  });

  test("a duplicate letter row for the same case, bureau, round and target cannot also be mailed", async () => {
    const a = await mkLetter({ bureau: "TU", round: "R2" });
    const b = await mkLetter({ bureau: "TU", round: "R2" }); // a regenerate
    const mailed = [];
    const send = (letterId) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId, html: "<html>round two</html>", caseId }],
      mailSender: async (l) => {
        mailed.push(l.letterId);
        return { ok: true, providerId: `dup_${mailed.length}`, outcome: "sent" };
      }
    });

    const first = await send(a.id);
    const second = await send(b.id);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false, "the duplicate row must not produce a second envelope");
    assert.equal(second.results[0].error, "already_mailed_duplicate_letter");
    assert.equal(mailed.length, 1, "the mailer was called once, for one physical letter");

    assert.equal((await letterRow(a.id)).status, "sent");
    const loser = await letterRow(b.id);
    assert.equal(loser.mailed_at, null, "the refused row keeps NULL — it was never mailed");
    assert.notEqual(loser.status, "sent");
  });

  test("a refusal that happened before transmission gives the letter back", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R1" });
    const attempt = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    const refused = await attempt(async () => ({ ok: false, error: "POSTGRID_API_KEY unset — letter not sent" }));
    assert.equal(refused.ok, false);
    const afterRefusal = await letterRow(letter.id);
    assert.equal(afterRefusal.send_claimed_at, null, "nothing was transmitted, so the claim is released");
    assert.equal(afterRefusal.mailed_at, null, "and it was never mailed");
    assert.equal(afterRefusal.status, "ready", "and the letter is back in the state it started in");

    // Now it can genuinely be sent.
    let calls = 0;
    const ok = await attempt(async () => { calls += 1; return { ok: true, providerId: "ltr_eq", outcome: "sent" }; });
    assert.equal(ok.ok, true);
    assert.equal(calls, 1);
    assert.equal((await letterRow(letter.id)).status, "sent");
  });

  test("an old refusal cannot release a newer claim after staff clear and reclaim", async () => {
    const letter = await mkLetter({ bureau: "TU", round: "R11" });
    let firstEntered, secondEntered, finishFirst, finishSecond;
    const firstAtMailer = new Promise((resolve) => { firstEntered = resolve; });
    const secondAtMailer = new Promise((resolve) => { secondEntered = resolve; });
    const firstReply = new Promise((resolve) => { finishFirst = resolve; });
    const secondReply = new Promise((resolve) => { finishSecond = resolve; });
    const send = (mailSender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender
    });

    const oldSend = send(async () => { firstEntered(); return firstReply; });
    await firstAtMailer;
    const oldToken = (await db.query(
      `SELECT send_claimed_at::text AS token FROM dispute_letters WHERE id = $1`, [letter.id]
    )).rows[0].token;
    const cleared = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId,
      reason: "PostGrid confirms no letter from first attempt", minAgeMinutes: 0
    });
    assert.equal(cleared.ok, true);

    const newSend = send(async () => { secondEntered(); return secondReply; });
    await secondAtMailer;
    const newToken = (await db.query(
      `SELECT send_claimed_at::text AS token FROM dispute_letters WHERE id = $1`, [letter.id]
    )).rows[0].token;
    assert.notEqual(newToken, oldToken, "the second sender holds a distinct claim");

    try {
      finishFirst({ ok: false, preTransmission: true, error: "destination_address_missing" });
      const refused = await oldSend;
      assert.equal(refused.ok, false);
      const stillClaimed = await letterRow(letter.id);
      assert.equal(stillClaimed.status, "sending");
      assert.equal((await db.query(
        `SELECT send_claimed_at::text AS token FROM dispute_letters WHERE id = $1`, [letter.id]
      )).rows[0].token, newToken, "the old release must not clear the new sender's claim");
      assert.equal(stillClaimed.mailed_at, null);
    } finally {
      finishSecond({ ok: false, preTransmission: true, error: "destination_address_missing" });
      await newSend;
    }
  });

  test("a call that may have transmitted KEEPS the claim and is never auto-retried", async () => {
    const letter = await mkLetter({ bureau: "EX", round: "R3" });
    const attempt = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    // An HTTP error from the provider. We do not know whether the letter went.
    const failed = await attempt(async () => ({ ok: false, error: "postgrid_http_502" }));
    assert.equal(failed.ok, false);
    const stuck = await letterRow(letter.id);
    assert.equal(stuck.status, "sending", "the row stays claimed for a human to reconcile");
    assert.ok(stuck.send_claimed_at, "the claim is held");
    assert.equal(stuck.mailed_at, null,
      "but it is NOT recorded as mailed — nobody knows whether it went, and saying it did is what killed the letter under 332");

    let calls = 0;
    const retry = await attempt(async () => { calls += 1; return { ok: true, providerId: "ltr_retry", outcome: "sent" }; });
    assert.equal(calls, 0, "a retry must not call the provider on a claim we cannot account for");
    assert.equal(retry.results[0].error, "send_claim_held",
      "and it is named as a held claim, not as a mailing — it has a way out");
  });

  // -- The 333 blocker: a send that did not happen must not destroy the letter --

  test("the outbound fence holding a send releases the letter, and it can then be mailed", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R3" });

    // The REAL mailer, through the real chokepoint, with the messaging fence UP
    // (MESSAGING_DRY_RUN deliberately absent) and a transport that THROWS if it
    // is ever reached. If the throw does not fire, nothing left the process.
    let fetchCalls = 0;
    const held = await sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      env: { POSTGRID_API_KEY: "pk_test_not_a_real_key" },
      fetchImpl: () => { fetchCalls += 1; throw new Error("the fence leaked"); }
    });

    assert.equal(fetchCalls, 0, "the fence held the call - nothing was transmitted");
    assert.equal(held.ok, false);

    const afterHold = await letterRow(letter.id);
    assert.equal(afterHold.send_claimed_at, null, "so the claim is released");
    assert.equal(afterHold.mailed_at, null, "and the letter was never mailed");
    assert.equal(afterHold.status, "ready", "and it is sendable again");

    // Under 332 this press returned already_mailed and the letter was dead.
    let calls = 0;
    const real = await sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: async () => { calls += 1; return { ok: true, providerId: "ltr_after_hold", outcome: "sent" }; }
    });
    assert.equal(calls, 1, "the letter really goes out on the next press");
    assert.equal(real.ok, true);
    assert.equal((await letterRow(letter.id)).postgrid_letter_id, "ltr_after_hold");
  });

  test("a replacement letter can claim after the original's claim was released", async () => {
    const original = await mkLetter({ bureau: "TU", round: "R4" });
    const send = (letterId, sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    // Original claims, then refuses above the network, so it releases.
    await send(original.id, async () => ({ ok: false, preTransmission: true, error: "destination_address_missing" }));
    assert.equal((await letterRow(original.id)).send_claimed_at, null);

    // A regenerate for the same case, bureau, round and target. Under 332 the
    // released row still held mailed_at, so this was refused for ever.
    const replacement = await mkLetter({ bureau: "TU", round: "R4" });
    let calls = 0;
    const out = await send(replacement.id, async () => { calls += 1; return { ok: true, providerId: "ltr_replacement", outcome: "sent" }; });

    assert.equal(out.ok, true, "the replacement mails");
    assert.equal(calls, 1);
    assert.notEqual((await letterRow(replacement.id)).mailed_at, null);
    assert.equal((await letterRow(original.id)).mailed_at, null, "and the original is still unmailed");
  });

  test("two concurrent presses on the same letter produce exactly one mailing", async () => {
    const letter = await mkLetter({ bureau: "EX", round: "R5" });
    let calls = 0;
    // A mailer slow enough that both presses are inside the send loop at once.
    // If the claim were not a single conditional UPDATE, both would call it.
    const press = () => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 150));
        return { ok: true, providerId: `race_${calls}`, outcome: "sent" };
      }
    });

    const [a, b] = await Promise.all([press(), press()]);
    assert.equal(calls, 1, "the mailer was called exactly once across two simultaneous presses");
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one press succeeded");

    const loserResult = (a.ok ? b : a).results[0];
    assert.ok(
      ["send_claim_held", "already_mailed", "already_mailed_duplicate_letter"].includes(loserResult.error),
      `the loser is refused by the database, got ${loserResult.error}`
    );

    const row = await letterRow(letter.id);
    assert.equal(row.status, "sent");
    assert.ok(row.mailed_at, "exactly one mailing is recorded");
  });

  test("two concurrent presses on two duplicate rows for the same letter mail once", async () => {
    const a = await mkLetter({ bureau: "EQ", round: "R5" });
    const b = await mkLetter({ bureau: "EQ", round: "R5" });
    let calls = 0;
    const press = (letterId) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId, html: "<html>x</html>", caseId }],
      mailSender: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 150));
        return { ok: true, providerId: `dupe_race_${calls}`, outcome: "sent" };
      }
    });

    const [ra, rb] = await Promise.all([press(a.id), press(b.id)]);
    assert.equal(calls, 1, "one envelope, not two - uq_dispute_letters_one_send_claim adjudicates");
    assert.equal([ra.ok, rb.ok].filter(Boolean).length, 1);

    const mailedRows = (await db.query(
      `SELECT id FROM dispute_letters
        WHERE client_id = $1 AND bureau = 'EQ' AND round = 'R5' AND mailed_at IS NOT NULL`,
      [client]
    )).rows;
    assert.equal(mailedRows.length, 1, "exactly one row carries a mailing");
  });

  // -- The way out of a stuck claim --------------------------------------------

  test("a stuck claim can be cleared by a named human, and the letter is then sendable", async () => {
    const letter = await mkLetter({ bureau: "TU", round: "R6" });
    const attempt = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    // A genuine transmission failure. The claim is kept, correctly.
    await attempt(async () => ({ ok: false, error: "postgrid_http_502" }));
    const stuck = await letterRow(letter.id);
    assert.equal(stuck.status, "sending");
    assert.equal(stuck.mailed_at, null);

    // Too fresh to call stuck.
    const tooSoon = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId, reason: "checked PostGrid, no letter"
    });
    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.reason, "claim_too_fresh");

    // A clear with no reason is refused - this action is never anonymous.
    const noReason = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId, reason: "   ", minAgeMinutes: 0
    });
    assert.equal(noReason.reason, "reason_required");
    const noStaff = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, reason: "checked PostGrid", minAgeMinutes: 0
    });
    assert.equal(noStaff.reason, "staff_id_required");

    const cleared = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId,
      reason: "PostGrid dashboard shows no letter for this id", minAgeMinutes: 0
    });
    assert.equal(cleared.ok, true);

    const afterClear = await letterRow(letter.id);
    assert.equal(afterClear.send_claimed_at, null, "the claim is released");
    assert.equal(afterClear.status, "ready", "the letter is sendable again");
    assert.ok(afterClear.send_claim_cleared_at, "and who cleared it is on the record");
    assert.equal(afterClear.send_claim_cleared_by, staffId);
    assert.match(afterClear.send_claim_cleared_reason, /PostGrid dashboard/);

    const logged = (await db.query(
      `SELECT decision FROM repair_decision_log
        WHERE client_id = $1 AND org_id = $2
          AND decision = 'repair.letter.send_claim_cleared'
          AND payload->>'letterId' = $3`,
      [client, org, letter.id]
    )).rows;
    assert.equal(logged.length, 1, "the clear shows on the client's timeline");

    let calls = 0;
    const resent = await attempt(async () => { calls += 1; return { ok: true, providerId: "ltr_after_clear", outcome: "sent" }; });
    assert.equal(calls, 1);
    assert.equal(resent.ok, true);
  });

  test("clearing refuses on a letter that really was mailed", async () => {
    const letter = await mkLetter({ bureau: "EX", round: "R7" });
    await sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EX", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: async () => ({ ok: true, providerId: "ltr_r7", outcome: "sent" })
    });
    const mailedAt = (await letterRow(letter.id)).mailed_at;
    assert.ok(mailedAt);

    const refused = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId, reason: "trying to undo a real mailing", minAgeMinutes: 0
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "already_mailed");
    assert.deepEqual((await letterRow(letter.id)).mailed_at, mailedAt, "mailed_at is untouched");
  });

  test("the database itself refuses to release a mailing", async () => {
    const letter = await mkLetter({ bureau: "TU", round: "R8" });
    await sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: async () => ({ ok: true, providerId: "ltr_r8", outcome: "sent" })
    });

    // Even a hand-written UPDATE cannot say "mailed but never claimed", which is
    // what makes the claim index a real superset of the mailing index.
    await assert.rejects(
      () => db.query(`UPDATE dispute_letters SET send_claimed_at = NULL WHERE id = $1`, [letter.id]),
      /dispute_letters_mailed_implies_claimed_ck/
    );

    // And a clear that names nobody cannot be written either.
    await assert.rejects(
      () => db.query(`UPDATE dispute_letters SET send_claim_cleared_at = now() WHERE id = $1`, [letter.id]),
      /dispute_letters_claim_clear_ck/
    );
  });

  // -- A 200 with no id is still a mailing -------------------------------------
  //
  // THE DEFECT THIS CLOSES, reproduced on this database before the fix:
  //   press 1  ok:true, providerId null, provider called once
  //            row: status 'sending' | mailed_at NULL | claim held | id NULL
  //   listStuckSendClaims offered that row to staff as stuck
  //   clear    -> ok, status 'ready'
  //   press 2  provider called a SECOND time
  // A second envelope to a real person, and a second bill.

  test("a 200 with no provider id is recorded as a mailing, and cannot then be cleared", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R9" });
    let calls = 0;
    const press = () => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      // PostGrid answering 200 with a body carrying no id. The envelope IS in
      // the post; src/messaging/providers/mail-letter.mjs returns
      // { ok: true, providerId: null } for it.
      mailSender: async () => { calls += 1; return { ok: true, providerId: null, outcome: "sent" }; }
    });

    const first = await press();
    assert.equal(first.ok, true);
    assert.equal(calls, 1);
    assert.equal(first.results[0].providerId, null, "there really is no id");

    const row = await letterRow(letter.id);
    assert.equal(row.status, "sent");
    assert.ok(row.mailed_at, "the mailing is on the row anyway — acceptance is the fact");
    assert.equal(row.postgrid_letter_id, null, "and the id stays unknown, not invented");

    // The row must NOT be offered to staff as stuck any more.
    const stuck = await listStuckSendClaims(db, { orgId: org, clientId: client, minAgeMinutes: 0 });
    assert.equal(
      stuck.some((r) => r.id === letter.id), false,
      "a mailed letter is not a stuck claim"
    );

    // And a staff member who asks anyway is refused.
    const refused = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId,
      reason: "no id came back so I assumed it did not go", minAgeMinutes: 0
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "already_mailed");

    // The whole point: pressing send again does not reach the provider.
    const second = await press();
    assert.equal(calls, 1, "ONE mailing, not two");
    assert.equal(second.results[0].error, "already_mailed");
  });

  test("the database refuses a clear on a letter the provider took but no mailing was written for", async () => {
    // The one shape the code fix cannot cover: the provider accepted the letter
    // and the write-back could not be made, so only the id landed. 334's second
    // constraint refuses a clear on it, for every writer.
    const letter = await mkLetter({ bureau: "EX", round: "R10" });
    await db.query(
      `UPDATE dispute_letters SET status='sending', send_claimed_at = now(), postgrid_letter_id = 'ltr_orphan'
        WHERE id = $1`,
      [letter.id]
    );
    await assert.rejects(
      () => db.query(
        `UPDATE dispute_letters
            SET send_claim_cleared_at = now(), send_claim_cleared_by = $2::uuid,
                send_claim_cleared_reason = 'I think it did not go'
          WHERE id = $1`,
        [letter.id, staffId]
      ),
      /dispute_letters_no_clear_after_provider_id_ck/
    );
    // The application refuses it too, before the database is even asked.
    const app = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId, reason: "same attempt", minAgeMinutes: 0
    });
    assert.equal(app.reason, "provider_accepted");
  });

  test("the database refuses a clear stamped at or after a mailing", async () => {
    const letter = await mkLetter({ bureau: "TU", round: "R11" });
    await sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "TU", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: async () => ({ ok: true, providerId: "ltr_r11", outcome: "sent" })
    });
    await assert.rejects(
      () => db.query(
        `UPDATE dispute_letters
            SET send_claim_cleared_at = now(), send_claim_cleared_by = $2::uuid,
                send_claim_cleared_reason = 'undoing a real mailing by hand'
          WHERE id = $1`,
        [letter.id, staffId]
      ),
      /dispute_letters_no_clear_after_mailing_ck/
    );
  });

  test("a clear that came FIRST is still allowed, and the re-send then mails", async () => {
    // The ordering rule must not ban the legitimate row: cleared at T1, mailed
    // at T2. If it did, no genuinely stuck letter could ever be sent again.
    const letter = await mkLetter({ bureau: "EQ", round: "R12" });
    const press = (sender) => sendRepairLetters(db, {
      orgId: org, clientId: client, staffId, mail: true, from: FROM,
      letters: [{ bureau: "EQ", letterId: letter.id, html: "<html>x</html>", caseId }],
      mailSender: sender
    });

    await press(async () => ({ ok: false, error: "postgrid_http_502" }));
    const cleared = await clearStuckSendClaim(db, {
      orgId: org, letterId: letter.id, staffId,
      reason: "PostGrid shows no letter", minAgeMinutes: 0
    });
    assert.equal(cleared.ok, true);

    let calls = 0;
    await press(async () => { calls += 1; return { ok: true, providerId: "ltr_r12", outcome: "sent" }; });
    assert.equal(calls, 1);

    const row = await letterRow(letter.id);
    assert.ok(row.send_claim_cleared_at && row.mailed_at, "the row legitimately carries both");
    assert.ok(row.send_claim_cleared_at <= row.mailed_at, "in that order");
  });

  test("mail_cost_cents starts NULL and NULL means unknown, not free", async () => {
    const letter = await mkLetter({ bureau: "EQ", round: "R2" });
    assert.equal(letter.mail_cost_cents, null);
    await assert.rejects(
      () => db.query(`UPDATE dispute_letters SET mail_cost_cents = -1 WHERE id = $1`, [letter.id]),
      /dispute_letters_mail_cost_ck/
    );
  });
});
