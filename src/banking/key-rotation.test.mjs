// Key rotation for stored bank credentials — the proof that it works, and the
// proof that it never writes a plaintext token anywhere.
//
// THE TEST THAT MATTERS IS THE FIRST ONE: rotate a real ciphertext to a new key
// and then DECRYPT IT. A rotation that produces a value nobody can read is
// indistinguishable from one that worked, right up until the moment somebody
// needs the credential — which is the moment a client's bank connection is being
// used. So the assertion is not "the string changed", it is "the original secret
// comes back out".
//
// No database and no DATABASE_URL. Everything here is pure functions over
// strings, plus one in-memory fake for the walk. That is deliberate: this is a
// compliance control and it must run on every CI pass, not only the ones that
// happen to have Postgres.

import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import {
  encryptPlaidToken,
  decryptPlaidToken,
  plaidTokenKeyId,
  rotatePlaidTokenCiphertext,
  rotatePlaidTokens,
  KEY_ID_PATTERN
} from "./plaid.mjs";

/* Keys generated per run rather than pasted in. A fixed base64 key in a test
   file is a key in the repository, and the next person to need one copies the
   nearest example — which is how a test fixture becomes a production secret.
   CLAUDE.md §8: never commit a key, not in code and not in fixtures. */
const key = () => crypto.randomBytes(32).toString("base64");

const ITEM = "11111111-2222-3333-4444-555555555555";
const OTHER_ITEM = "99999999-8888-7777-6666-555555555555";

/* A realistic-shaped Plaid access token. Fake, random, and never a real one. */
const SECRET = `access-sandbox-${crypto.randomUUID()}`;

function envWith({ v1 = key(), v2 = null } = {}) {
  const env = { PLAID_TOKEN_ENC_KEY: v1 };
  if (v2) env.PLAID_TOKEN_ENC_KEY_V2 = v2;
  return env;
}

describe("rotation: the round trip", () => {

  test("*** ROTATE, THEN DECRYPT — the whole point of the feature ***", () => {
    const env = envWith({ v2: key() });

    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env });
    assert.equal(plaidTokenKeyId(before), "v1", "sanity: a fresh token is written under v1");

    const after = rotatePlaidTokenCiphertext(before, { itemId: ITEM, toKeyId: "v2", env });

    // It really moved.
    assert.equal(plaidTokenKeyId(after), "v2");
    assert.notEqual(after, before, "a rotated ciphertext must not be byte-identical to the original");

    // THE ASSERTION THIS FILE EXISTS FOR. The secret survives the rotation.
    assert.equal(
      decryptPlaidToken(after, { itemId: ITEM, env }),
      SECRET,
      "a rotated token must still decrypt to the original credential — otherwise " +
      "the rotation has quietly destroyed every bank connection in the system"
    );
  });

  test("the new ciphertext cannot be read with the old key alone", () => {
    const v1 = key(), v2 = key();
    const both = { PLAID_TOKEN_ENC_KEY: v1, PLAID_TOKEN_ENC_KEY_V2: v2 };

    const after = rotatePlaidTokenCiphertext(
      encryptPlaidToken(SECRET, { itemId: ITEM, env: both }),
      { itemId: ITEM, toKeyId: "v2", env: both }
    );

    // Retire v2 from the environment: the rotated row is now unreadable. This is
    // what proves the value is genuinely under the new key rather than re-wrapped
    // under the old one with a new label.
    assert.throws(
      () => decryptPlaidToken(after, { itemId: ITEM, env: { PLAID_TOKEN_ENC_KEY: v1 } }),
      /PLAID_TOKEN_ENC_KEY_V2 is not set/,
      "a v2 ciphertext must need the v2 key"
    );
  });

  test("NO DOWNTIME: a half-rotated table reads correctly on both key versions", () => {
    // The operational claim in plaid.mjs's header. During a rotation some rows
    // are v1 and some are v2 at the same instant, and every reader must handle
    // both without knowing a rotation is running.
    const env = envWith({ v2: key() });

    const stillOld = encryptPlaidToken("token-A", { itemId: ITEM, env });
    const moved = rotatePlaidTokenCiphertext(
      encryptPlaidToken("token-B", { itemId: OTHER_ITEM, env }),
      { itemId: OTHER_ITEM, toKeyId: "v2", env }
    );

    assert.equal(plaidTokenKeyId(stillOld), "v1");
    assert.equal(plaidTokenKeyId(moved), "v2");

    // One reader, one env, both rows. No flag day.
    assert.equal(decryptPlaidToken(stillOld, { itemId: ITEM, env }), "token-A");
    assert.equal(decryptPlaidToken(moved, { itemId: OTHER_ITEM, env }), "token-B");
  });

  test("the item binding survives rotation, so a rotated token still refuses the wrong row", () => {
    // encryptPlaidToken binds plaid_items.id in as additional authenticated data
    // so a ciphertext copied into another client's row fails to decrypt. If a
    // rotation dropped or changed that binding, the protection would silently
    // vanish across every row at once and every downstream check would still pass.
    const env = envWith({ v2: key() });

    const after = rotatePlaidTokenCiphertext(
      encryptPlaidToken(SECRET, { itemId: ITEM, env }),
      { itemId: ITEM, toKeyId: "v2", env }
    );

    assert.throws(
      () => decryptPlaidToken(after, { itemId: OTHER_ITEM, env }),
      (e) => e.code === "TOKEN_AUTH_FAILED",
      "a rotated ciphertext must still be bound to its own plaid_items row"
    );
  });

  test("rotating twice is safe: the second pass is a no-op, not a double-encryption", () => {
    // An interrupted rotation is finished by re-running it, so running it over
    // rows that are already current must not corrupt them.
    const env = envWith({ v2: key() });

    const once = rotatePlaidTokenCiphertext(
      encryptPlaidToken(SECRET, { itemId: ITEM, env }), { itemId: ITEM, toKeyId: "v2", env });
    const twice = rotatePlaidTokenCiphertext(once, { itemId: ITEM, toKeyId: "v2", env });

    assert.equal(twice, once, "a row already on the target key must be returned untouched");
    assert.equal(decryptPlaidToken(twice, { itemId: ITEM, env }), SECRET);
  });
});

describe("rotation: refusals", () => {

  test("a missing destination key stops the rotation before anything is decrypted", () => {
    const env = envWith();   // no v2
    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env });

    assert.throws(
      () => rotatePlaidTokenCiphertext(before, { itemId: ITEM, toKeyId: "v2", env }),
      /PLAID_TOKEN_ENC_KEY_V2 is not set/,
      "an absent destination key must stop the feature, never fall back to plaintext"
    );
  });

  test("a short destination key is refused, and the error names the variable and not the key", () => {
    const env = { PLAID_TOKEN_ENC_KEY: key(), PLAID_TOKEN_ENC_KEY_V2: Buffer.alloc(12).toString("base64") };
    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env });

    assert.throws(
      () => rotatePlaidTokenCiphertext(before, { itemId: ITEM, toKeyId: "v2", env }),
      (e) => {
        assert.match(e.message, /PLAID_TOKEN_ENC_KEY_V2 must be 32 bytes/);
        assert.ok(!e.message.includes(env.PLAID_TOKEN_ENC_KEY_V2), "the error must not quote the key");
        assert.ok(!e.message.includes(env.PLAID_TOKEN_ENC_KEY), "the error must not quote the key");
        return true;
      }
    );
  });

  test("rotation requires the item id, because without it the binding is lost", () => {
    const env = envWith({ v2: key() });
    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env });
    assert.throws(
      () => rotatePlaidTokenCiphertext(before, { toKeyId: "v2", env }),
      /itemId is required/
    );
  });

  test("a key id that could name an arbitrary environment variable is refused", () => {
    // keyFor() interpolates the key id into an env var NAME. An unconstrained id
    // read off a database row would let the row choose which variable is read.
    const env = envWith({ v2: key() });
    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env });

    for (const bad of ["../../etc", "V2", "v2;DROP", "", "a".repeat(17), "v-2"]) {
      assert.equal(KEY_ID_PATTERN.test(bad), false, `${JSON.stringify(bad)} must not be a valid key id`);
      assert.throws(
        () => rotatePlaidTokenCiphertext(before, { itemId: ITEM, toKeyId: bad, env }),
        /toKeyId must be a short lowercase alphanumeric key id/
      );
    }
  });

  test("a malformed stored value is refused rather than silently rewritten", () => {
    const env = envWith({ v2: key() });
    for (const bad of ["not-a-ciphertext", "v1:only:three", "::::"]) {
      assert.throws(
        () => rotatePlaidTokenCiphertext(bad, { itemId: ITEM, toKeyId: "v2", env }),
        /malformed ciphertext/
      );
    }
  });

  test("null and empty stay null — a row with no credential is not a rotation failure", () => {
    const env = envWith({ v2: key() });
    for (const empty of [null, undefined, ""]) {
      assert.equal(rotatePlaidTokenCiphertext(empty, { itemId: ITEM, toKeyId: "v2", env }), null);
    }
  });

  test("plaidTokenKeyId reads the label without any key present and never throws", () => {
    const before = encryptPlaidToken(SECRET, { itemId: ITEM, env: envWith() });
    assert.equal(plaidTokenKeyId(before), "v1", "reading the label must not need a key");
    for (const bad of [null, undefined, "", "garbage", "v1:a:b", "v1:a:b:c:d", "V1:a:b:c"]) {
      assert.equal(plaidTokenKeyId(bad), null);
    }
  });
});

describe("rotation: the walk over stored rows", () => {

  /* An in-memory stand-in for plaid_items. No connect(), so withTransaction's
     third branch runs it inline — see src/db/with-transaction.mjs. */
  function fakeDb(rows) {
    const calls = [];
    return {
      rows,
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (/^\s*SELECT/i.test(sql)) {
          return { rows: rows.filter((r) => r.org_id === params[0] && r.encrypted_access_token !== null) };
        }
        if (/^\s*UPDATE/i.test(sql)) {
          const [next, id, expected] = params;
          const row = rows.find((r) => r.id === id && r.encrypted_access_token === expected);
          if (!row) return { rowCount: 0 };
          row.encrypted_access_token = next;
          return { rowCount: 1 };
        }
        throw new Error("unexpected sql: " + sql);
      }
    };
  }

  const ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  test("every row moves to the new key and every one still decrypts afterwards", async () => {
    const env = envWith({ v2: key() });
    const ids = [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333"
    ];
    const secrets = Object.fromEntries(ids.map((id, i) => [id, `access-sandbox-token-${i}`]));

    const db = fakeDb(ids.map((id) => ({
      id, org_id: ORG, encrypted_access_token: encryptPlaidToken(secrets[id], { itemId: id, env })
    })));

    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    assert.deepEqual(
      { scanned: summary.scanned, rotated: summary.rotated, alreadyCurrent: summary.alreadyCurrent, failed: summary.failed },
      { scanned: 3, rotated: 3, alreadyCurrent: 0, failed: [] }
    );

    // AND THEY ALL STILL WORK.
    for (const row of db.rows) {
      assert.equal(plaidTokenKeyId(row.encrypted_access_token), "v2");
      assert.equal(
        decryptPlaidToken(row.encrypted_access_token, { itemId: row.id, env }),
        secrets[row.id],
        `row ${row.id} did not survive the rotation`
      );
    }
  });

  test("a token sealed by Plaid Link (AAD = Plaid's item id) rotates and still opens with that id", async () => {
    const env = envWith({ v2: key() });
    const id = "55555555-5555-5555-5555-555555555555";
    const plaidItemId = "eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6";
    const secret = "access-sandbox-linked-by-plaid-link";
    // completeLink seals before the row exists, so the binding is Plaid's item id.
    const db = fakeDb([{ id, plaid_item_id: plaidItemId, org_id: ORG, encrypted_access_token: encryptPlaidToken(secret, { itemId: plaidItemId, env }) }]);

    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    assert.deepEqual(summary.failed, [], "the live convention must not fail a rotation");
    assert.equal(summary.rotated, 1);
    const row = db.rows[0];
    assert.equal(plaidTokenKeyId(row.encrypted_access_token), "v2");
    assert.equal(decryptPlaidToken(row.encrypted_access_token, { itemId: plaidItemId, env }), secret, "readers decrypt with plaid_item_id");
  });

  test("*** NO PLAINTEXT IS EVER WRITTEN — not to a column, not to a temp column ***", async () => {
    const env = envWith({ v2: key() });
    const id = "44444444-4444-4444-4444-444444444444";
    const secret = "access-sandbox-never-write-me";

    const db = fakeDb([{ id, org_id: ORG, encrypted_access_token: encryptPlaidToken(secret, { itemId: id, env }) }]);
    await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    // Every statement the rotation issued, and every parameter it bound.
    for (const call of db.calls) {
      assert.ok(!call.sql.includes(secret), "the secret reached a SQL string");
      for (const p of call.params || []) {
        assert.ok(
          typeof p !== "string" || !p.includes(secret),
          "the secret was bound as a query parameter — a rotation must never write plaintext to the database"
        );
      }
      // The classic bad shape: decrypt everything into a temp column, re-encrypt,
      // drop the column. It leaves plaintext in WAL and in every backup taken
      // during the run, and dropping the column afterwards does not unwrite it.
      assert.ok(!/ALTER\s+TABLE/i.test(call.sql), "a rotation must not add or drop columns");
      assert.ok(!/plaintext|_plain\b|temp_token/i.test(call.sql), "no plaintext staging column");
    }

    // And the row itself never held it.
    assert.ok(!db.rows[0].encrypted_access_token.includes(secret));
  });

  test("rows already on the new key are counted, not rewritten", async () => {
    const env = envWith({ v2: key() });
    const id = "55555555-5555-5555-5555-555555555555";
    const already = encryptPlaidToken("t", { itemId: id, keyId: "v2", env });

    const db = fakeDb([{ id, org_id: ORG, encrypted_access_token: already }]);
    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    assert.deepEqual(
      { scanned: summary.scanned, rotated: summary.rotated, alreadyCurrent: summary.alreadyCurrent },
      { scanned: 1, rotated: 0, alreadyCurrent: 1 }
    );
    assert.equal(db.rows[0].encrypted_access_token, already, "an already-current row must not be touched");
    assert.equal(db.calls.filter((c) => /UPDATE/i.test(c.sql)).length, 0, "no UPDATE should have been issued");
  });

  test("a row that changed underneath the rotation is skipped, never overwritten", async () => {
    // The guard is `AND encrypted_access_token = $3`. Without it, a concurrent
    // re-link during a rotation would be overwritten by a ciphertext derived from
    // the value the row used to hold.
    const env = envWith({ v2: key() });
    const id = "66666666-6666-6666-6666-666666666666";
    const db = fakeDb([{ id, org_id: ORG, encrypted_access_token: encryptPlaidToken("old", { itemId: id, env }) }]);

    const relinked = encryptPlaidToken("brand-new-from-a-relink", { itemId: id, env });
    const realQuery = db.query.bind(db);
    db.query = async (sql, params) => {
      // Simulate the re-link landing between the SELECT and the UPDATE.
      if (/^\s*UPDATE/i.test(sql)) db.rows[0].encrypted_access_token = relinked;
      return realQuery(sql, params);
    };

    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    assert.equal(summary.rotated, 0);
    assert.equal(summary.failed.length, 1);
    assert.match(summary.failed[0].error, /row changed during rotation/);
    assert.equal(db.rows[0].encrypted_access_token, relinked, "the concurrent re-link must survive");
    assert.equal(decryptPlaidToken(db.rows[0].encrypted_access_token, { itemId: id, env }), "brand-new-from-a-relink");
  });

  test("a failure reports the row id and NEVER the token, the key or the underlying message", async () => {
    const env = envWith({ v2: key() });
    const id = "77777777-7777-7777-7777-777777777777";

    // A row encrypted under a DIFFERENT v1 key: this rotation cannot read it.
    const foreign = encryptPlaidToken("someone-elses-secret", { itemId: id, env: envWith() });
    const db = fakeDb([{ id, org_id: ORG, encrypted_access_token: foreign }]);

    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });

    assert.equal(summary.rotated, 0);
    assert.deepEqual(summary.failed, [{ itemId: id, error: "decrypt or re-encrypt failed" }]);

    const blob = JSON.stringify(summary);
    assert.ok(!blob.includes("someone-elses-secret"));
    assert.ok(!blob.includes(env.PLAID_TOKEN_ENC_KEY));
    assert.ok(!blob.includes(env.PLAID_TOKEN_ENC_KEY_V2));
    assert.ok(!blob.includes(foreign), "the failure must not echo the ciphertext either");
  });

  test("org scope fails closed: no org id rotates nothing rather than everything", async () => {
    const env = envWith({ v2: key() });
    const db = fakeDb([]);
    for (const bad of [undefined, null, "", "   "]) {
      await assert.rejects(
        () => rotatePlaidTokens(db, { orgId: bad, toKeyId: "v2", env }),
        /orgId is required/
      );
    }
    assert.equal(db.calls.length, 0, "not a single query may run without an org scope");
  });

  test("a missing destination key stops the walk before a single row is read", async () => {
    const db = fakeDb([]);
    await assert.rejects(
      () => rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env: envWith() }),
      /PLAID_TOKEN_ENC_KEY_V2 is not set/
    );
    assert.equal(db.calls.length, 0, "no credential may be read when there is nowhere to put it");
  });

  test("only the caller's org is scanned", async () => {
    const env = envWith({ v2: key() });
    const mine = "88888888-8888-8888-8888-888888888888";
    const theirs = "99999999-9999-9999-9999-999999999999";
    const otherOrg = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    const db = fakeDb([
      { id: mine,   org_id: ORG,      encrypted_access_token: encryptPlaidToken("a", { itemId: mine, env }) },
      { id: theirs, org_id: otherOrg, encrypted_access_token: encryptPlaidToken("b", { itemId: theirs, env }) }
    ]);

    const summary = await rotatePlaidTokens(db, { orgId: ORG, toKeyId: "v2", env });
    assert.equal(summary.scanned, 1);
    assert.equal(plaidTokenKeyId(db.rows[1].encrypted_access_token), "v1", "another org's row must be untouched");
  });
});

describe("rotation: the source itself never logs", () => {
  test("there is no console call anywhere in plaid.mjs", async () => {
    // The header claims it. A claim in a comment is worth what it is enforced at.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "plaid.mjs"), "utf8");

    assert.equal(
      /\bconsole\s*\./.test(src), false,
      "src/banking/plaid.mjs must not log. A rotation logs progress, and the natural " +
      "thing to log is the row being worked on — which is a bank access token."
    );
  });
});
