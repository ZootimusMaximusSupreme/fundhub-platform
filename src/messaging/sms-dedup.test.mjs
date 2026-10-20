import { test, describe } from "node:test";
import assert from "node:assert";
import {
  smsDedupWindowMinutes,
  smsDedupBatchKey,
  normalizeSmsDestination,
  findRecentDuplicateSms,
  reserveSmsDedupBatch,
  DEFAULT_SMS_DEDUP_WINDOW_MINUTES
} from "./sms-dedup.mjs";

describe("sms dedup window", () => {
  test("defaults to 30 minutes", () => {
    assert.equal(smsDedupWindowMinutes({}), DEFAULT_SMS_DEDUP_WINDOW_MINUTES);
  });
  test("SMS_DEDUP_WINDOW_MINUTES=0 disables", () => {
    assert.equal(smsDedupWindowMinutes({ SMS_DEDUP_WINDOW_MINUTES: "0" }), 0);
  });
});

describe("findRecentDuplicateSms", () => {
  const MSG = {
    id: "00000000-0000-4000-8000-000000000099",
    org_id: "00000000-0000-4000-8000-000000000001",
    client_id: "00000000-0000-4000-8000-000000000003",
    channel: "sms",
    template_key: "SMS-WELCOME",
    rendered_body: "Hi there",
    to_address: "+15551234567"
  };

  test("batch key blocks second identical SMS in same pass", async () => {
    const batchKeys = new Set();
    const key = smsDedupBatchKey({
      orgId: MSG.org_id,
      clientId: MSG.client_id,
      templateKey: MSG.template_key,
      bodyFingerprint: null,
      toAddress: "+15551234567"
    });
    reserveSmsDedupBatch(batchKeys, key);
    const db = { query: async () => { throw new Error("db should not run"); } };
    const dup = await findRecentDuplicateSms(db, MSG, "+15551234567", { batchKeys, env: {} });
    assert.equal(dup.duplicate, true);
    assert.equal(dup.reason, "batch");
  });

  test("phone formatting cannot bypass the same-pass guard", async () => {
    const batchKeys = new Set();
    const key = smsDedupBatchKey({
      orgId: MSG.org_id,
      clientId: MSG.client_id,
      templateKey: MSG.template_key,
      bodyFingerprint: null,
      toAddress: "(555) 123-4567"
    });
    reserveSmsDedupBatch(batchKeys, key);
    const db = { query: async () => { throw new Error("db should not run"); } };
    const dup = await findRecentDuplicateSms(db, MSG, "+1 555 123 4567", { batchKeys, env: {} });
    assert.equal(dup.duplicate, true);
    assert.equal(normalizeSmsDestination("(555) 123-4567"), "5551234567");
  });

  test("recent sent row blocks without provider call path needing db twice", async () => {
    const db = {
      query: async (sql) => {
        assert.match(sql, /status IN \('sent', 'delivered'\)/);
        return { rows: [{
          id: "00000000-0000-4000-8000-000000000088",
          to_address: "1 (555) 123-4567"
        }] };
      }
    };
    const dup = await findRecentDuplicateSms(db, MSG, "+15551234567", {
      env: { SMS_DEDUP_WINDOW_MINUTES: "30" },
      now: () => new Date("2026-08-01T16:00:00Z")
    });
    assert.equal(dup.duplicate, true);
    assert.equal(dup.reason, "recent_sent");
  });

  test("email is never checked", async () => {
    const db = { query: async () => { throw new Error("no query"); } };
    const dup = await findRecentDuplicateSms(db, { ...MSG, channel: "email" }, "+15551234567", {});
    assert.equal(dup.duplicate, false);
  });
});
