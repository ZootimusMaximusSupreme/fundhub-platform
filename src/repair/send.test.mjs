// COMPLIANCE REVIEW REQUIRED — repair human-send → PostGrid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendRepairLetters, RepairSendError } from "./send.mjs";

function fakeDb() {
  const updates = [];
  return {
    updates,
    async query(sql, params = []) {
      updates.push({ sql: String(sql).replace(/\s+/g, " ").slice(0, 100), params });
      // The stored EX letter has a successful owner-scoped claim in this fake.
      // Explicit IDs with no matching row must fail closed, not reach the mailer.
      if (/UPDATE\\s+dispute_letters\\s+d\\b/i.test(String(sql))
          && params[0] === "55555555-5555-4555-8555-555555555555") {
        return { rows: [{ prior_status: "ready" }] };
      }
      if (String(sql).includes("FROM pipeline_stages") || String(sql).includes("FROM cards") || String(sql).includes("INSERT INTO cards")) {
        return { rows: [{ stage_id: "s1", pipeline_id: "p1", id: "c1" }] };
      }
      return { rows: [] };
    }
  };
}

test("sendRepairLetters refuses when mail is false (human gate)", async () => {
  await assert.rejects(
    () => sendRepairLetters(fakeDb(), {
      orgId: "22222222-2222-4222-8222-222222222222",
      clientId: "33333333-3333-4333-8333-333333333333",
      staffId: "44444444-4444-4444-8444-444444444444",
      mail: false,
      letters: [{ bureau: "EX", html: "<html>x</html>" }]
    }),
    (err) => err instanceof RepairSendError && err.code === "no_channel"
  );
});

test("sendRepairLetters calls mail helper when mail=true (DFY/repair path)", async () => {
  const calls = [];
  const db = fakeDb();
  const result = await sendRepairLetters(db, {
    orgId: "22222222-2222-4222-8222-222222222222",
    clientId: "33333333-3333-4333-8333-333333333333",
    staffId: "44444444-4444-4444-8444-444444444444",
    mail: true,
    from: {
      first_name: "Pat",
      last_name: "Client",
      address_line1: "12 Oak St",
      address_city: "Dallas",
      address_state: "TX",
      address_zip: "75201"
    },
    letters: [
      { bureau: "EX", pdf: "JVBERi0=", letterId: "55555555-5555-4555-8555-555555555555" },
      { bureau: "TU", html: "<html>personal</html>" }
    ],
    mailSender: async (letter) => {
      calls.push(letter);
      return { ok: true, providerId: `ltr_${letter.bureau}`, outcome: "sent" };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bureau, "EX");
  assert.equal(calls[1].bureau, "TU");
  assert.equal(result.results[0].providerId, "ltr_EX");
  assert.ok(db.updates.some((u) => /dispute_letters/.test(u.sql) || /pipeline|cards/.test(u.sql)));
});

test("sendRepairLetters requires letters array", async () => {
  await assert.rejects(
    () => sendRepairLetters(fakeDb(), {
      orgId: "22222222-2222-4222-8222-222222222222",
      clientId: "33333333-3333-4333-8333-333333333333",
      staffId: "44444444-4444-4444-8444-444444444444",
      mail: true,
      letters: []
    }),
    (err) => err instanceof RepairSendError && err.code === "letters_required"
  );
});
