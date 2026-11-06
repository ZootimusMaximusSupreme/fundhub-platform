import { test } from "node:test";
import assert from "node:assert";
import {
  looksLikeEmail, inviteMailCopy, resetMailCopy, credentialLink, sendStaffCredentialEmail
} from "./staff-mail.mjs";

test("looksLikeEmail accepts a real address and rejects junk", () => {
  assert.equal(looksLikeEmail("chris@fundhub.ai"), true);
  assert.equal(looksLikeEmail("nope"), false);
  assert.equal(looksLikeEmail(""), false);
});

test("owner invite copy names the login and no expiry", () => {
  const copy = inviteMailCopy({ loginEmail: "sam.rivera@fundhub.ai", link: "https://fundhub.ai/x" });
  assert.match(copy.body, /sam\.rivera@fundhub\.ai/);
  assert.match(copy.body, /does not expire and works once/);
  assert.match(copy.body, /https:\/\/fundhub\.ai\/x/);
});

test("owner reset copy has no expiry", () => {
  const copy = resetMailCopy({ loginEmail: "chris@fundhub.ai", link: "https://fundhub.ai/y" });
  assert.match(copy.body, /does not expire and works once/);
  assert.equal(credentialLink("/reset-password.html?token=a"), "https://fundhub.ai/reset-password.html?token=a");
});

test("sendStaffCredentialEmail uses Resend and reports mailed", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ id: "re_test_1" }),
      text: async () => "{\"id\":\"re_test_1\"}"
    };
  };
  const out = await sendStaffCredentialEmail({
    to: "chris@fundhub.ai",
    subject: "Reset your Fundhub password",
    body: "link",
    fetchImpl,
    env: {
      RESEND_API_KEY: "re_test_0123456789abcdef",
      RESEND_FROM: "Fundhub <noreply@fundhub.ai>",
      MESSAGING_DRY_RUN: "0"
    }
  });
  assert.equal(out.mailed, true);
  assert.ok(calls[0].url.includes("api.resend.com"));
});

test("sendStaffCredentialEmail does not claim a send when Resend is unset", async () => {
  const out = await sendStaffCredentialEmail({
    to: "chris@fundhub.ai",
    subject: "x",
    body: "y",
    fetchImpl: async () => { throw new Error("should not send"); },
    env: {}
  });
  assert.equal(out.mailed, false);
});


test("finite credential mail uses the actual expiry instead of permanent or fixed-window copy", () => {
  const expiresAt = new Date("2026-11-07T18:00:00Z");
  for (const makeCopy of [inviteMailCopy, resetMailCopy]) {
    const copy = makeCopy({ loginEmail: "finite@fundhub.test", link: "https://fundhub.ai/finite", expiresAt });
    assert.match(copy.body, /expires at Sat, 07 Nov 2026 18:00:00 GMT and works once/);
    assert.doesNotMatch(copy.body, /does not expire/);
  }
});
