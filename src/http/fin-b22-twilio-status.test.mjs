// The Twilio status door — POST /api/webhooks/twilio-status — run through the router with a stand-in
// database. A practice test. The row says the door moves a text's saved status by provider id when Twilio
// reports delivered, undelivered or failed, ignores in-flight statuses, answers 200 "unmatched" for an id
// it has no record of, and signs with TWILIO_AUTH_TOKEN. src/http/webhooks-status.pg.test.mjs holds the
// same door against a real Postgres and is skipped here; this one always runs.
//
// The signing token is built from parts at run time so no secret-shaped string sits in the source.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { handleWebhook } from "./router.mjs";
import { STATUS_MAP, IGNORED_STATUSES } from "../adapters/twilio-status.mjs";
import { LAUNCH_SECRETS } from "../pulse/coverage/gap-keys.mjs";
import { fakeDb } from "../testing/handler-harness.mjs";

const TOKEN = ["twilio", "status", "signing", "token", "for", "this", "test"].join("_");
const URL_UNDER_TEST = "https://fundhub.test/api/webhooks/twilio-status";
const ENV = { TWILIO_AUTH_TOKEN: TOKEN };

function sign(url, params, token = TOKEN) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + (params[k] ?? ""), url);
  return crypto.createHmac("sha1", token).update(data, "utf8").digest("base64");
}

function callWith(params, { token = TOKEN, url = URL_UNDER_TEST, signedFor = url, env = ENV, header } = {}) {
  const rawBody = new URLSearchParams(params).toString();
  const signature = header !== undefined ? header : sign(signedFor, params, token);
  return { rawBody, headers: signature ? { "x-twilio-signature": signature } : {}, url, env };
}

/** A stand-in database. `matches` is how many text rows the status update finds. */
function standIn({ matches = 1 } = {}) {
  const fake = fakeDb([
    [/UPDATE messages/, () => ({ rows: [], rowCount: matches })],
  ]);
  return fake;
}

const updates = (fake) => fake.calls.filter((c) => /UPDATE messages/.test(c.sql));
const reads = (fake) => fake.calls.filter((c) => !/webhook_captures/.test(c.sql));

async function receive(params, opts = {}, db = standIn(opts)) {
  const out = await handleWebhook({ db, provider: "twilio-status", ...callWith(params, opts) });
  return { out, db };
}

describe("a signed status callback moves the one text row it names", () => {
  test("delivered moves the row to delivered, matched on Twilio's own message id, texts and outbound only", async () => {
    const { out, db } = await receive({ MessageSid: "SM0001", MessageStatus: "delivered" });
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.updated, 1);
    assert.equal(out.body.messageStatus, "delivered");
    const [write] = updates(db);
    assert.deepEqual(write.params, ["SM0001", "delivered", null]);
    assert.match(write.sql, /WHERE provider_message_id = \$1/);
    assert.match(write.sql, /AND direction = 'outbound'/);
    assert.match(write.sql, /AND channel = 'sms'/);
    assert.equal(updates(db).length, 1, "one callback, one update");
  });

  test("undelivered and failed both move the row to failed and keep the carrier's error words", async () => {
    for (const status of ["undelivered", "failed"]) {
      const { out, db } = await receive({
        MessageSid: "SM0002", MessageStatus: status, ErrorCode: "30003", ErrorMessage: "Unreachable destination handset",
      });
      assert.equal(out.status, 200, status);
      assert.equal(out.body.messageStatus, "failed", status);
      assert.deepEqual(updates(db)[0].params, ["SM0002", "failed", "twilio_error_30003: Unreachable destination handset"], status);
    }
  });

  test("a long carrier error is cut so a provider payload cannot fill the column", async () => {
    const { db } = await receive({ MessageSid: "SM0003", MessageStatus: "failed", ErrorCode: "30008", ErrorMessage: "x".repeat(900) });
    assert.equal(updates(db)[0].params[2].length, 300);
  });

  test("sent moves the row to sent (the carrier took it, the phone has not said yet)", async () => {
    const { out, db } = await receive({ MessageSid: "SM0004", MessageStatus: "sent" });
    assert.equal(out.body.messageStatus, "sent");
    assert.deepEqual(updates(db)[0].params, ["SM0004", "sent", null]);
  });

  test("the status words are matched without regard to case", async () => {
    const { out, db } = await receive({ MessageSid: "SM0005", MessageStatus: "DELIVERED" });
    assert.equal(out.body.messageStatus, "delivered");
    assert.equal(updates(db).length, 1);
  });

  test("the vocabulary is exactly the four moves and four ignored words", () => {
    assert.deepEqual(STATUS_MAP, { delivered: "delivered", undelivered: "failed", failed: "failed", sent: "sent" });
    assert.deepEqual([...IGNORED_STATUSES].sort(), ["accepted", "queued", "scheduled", "sending"]);
  });
});

describe("what the door leaves alone", () => {
  test("in-flight statuses are acknowledged and move nothing, so a late 'sending' cannot undo a 'delivered'", async () => {
    for (const status of ["queued", "sending", "accepted", "scheduled"]) {
      const { out, db } = await receive({ MessageSid: "SM0006", MessageStatus: status });
      assert.equal(out.status, 200, status);
      assert.equal(out.body.reason, "in_flight", status);
      assert.equal(out.body.updated, 0, status);
      assert.equal(updates(db).length, 0, status);
    }
  });

  test("a status Twilio invents later is acknowledged and is NOT turned into a failure", async () => {
    const { out, db } = await receive({ MessageSid: "SM0007", MessageStatus: "read" });
    assert.equal(out.status, 200);
    assert.equal(out.body.reason, "unknown_status");
    assert.equal(updates(db).length, 0);
  });

  test("a callback with no message id is acknowledged and moves nothing", async () => {
    const { out, db } = await receive({ MessageStatus: "delivered" });
    assert.equal(out.status, 200);
    assert.equal(out.body.reason, "not_a_status_callback");
    assert.equal(updates(db).length, 0);
  });

  test("an id we have no record of is answered 200 'unmatched', so Twilio stops retrying and the gap is visible", async () => {
    const { out, db } = await receive({ MessageSid: "SMghost", MessageStatus: "delivered" }, { matches: 0 });
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.body.reason, "unmatched");
    assert.equal(out.body.updated, 0);
    assert.equal(updates(db).length, 1, "it did look");
  });
});

describe("an unsigned or wrongly signed callback is refused before the database is read", () => {
  const params = { MessageSid: "SM0008", MessageStatus: "failed" };

  test("no signature header", async () => {
    const { out, db } = await receive(params, { header: "" });
    assert.equal(out.status, 401);
    assert.equal(out.body.reason, "bad_signature");
    assert.equal(out.body.updated, 0);
    assert.equal(reads(db).length, 0);
  });

  test("a signature made with another token", async () => {
    const { out, db } = await receive(params, { token: "another-token-entirely" });
    assert.equal(out.status, 401);
    assert.equal(reads(db).length, 0);
  });

  test("a signature made for another address", async () => {
    const { out, db } = await receive(params, { signedFor: "https://fundhub.test/api/webhooks/twilio" });
    assert.equal(out.status, 401);
    assert.equal(reads(db).length, 0);
  });

  test("a replayed signature with the status swapped", async () => {
    const honest = callWith({ MessageSid: "SM0009", MessageStatus: "sent" });
    const db = standIn();
    const out = await handleWebhook({
      db, provider: "twilio-status", rawBody: new URLSearchParams({ MessageSid: "SM0009", MessageStatus: "failed" }).toString(),
      headers: honest.headers, url: URL_UNDER_TEST, env: ENV,
    });
    assert.equal(out.status, 401);
    assert.equal(reads(db).length, 0);
  });

  test("with no TWILIO_AUTH_TOKEN set, even a well-formed callback is refused", async () => {
    const { out, db } = await receive(params, { env: {} });
    assert.equal(out.status, 401);
    assert.equal(reads(db).length, 0);
  });
});

describe("the signing token is on the launch-secret check", () => {
  test("TWILIO_AUTH_TOKEN is on LAUNCH_SECRETS, named for the receipts it signs", () => {
    const entry = LAUNCH_SECRETS.find((row) => row.name === "TWILIO_AUTH_TOKEN");
    assert.ok(entry, "keys:launch-secrets-present reads this key");
    assert.match(entry.what, /receipts/);
    assert.notEqual(entry.setOnly, true, "a masked copy must read as unusable, not as set");
  });
});
