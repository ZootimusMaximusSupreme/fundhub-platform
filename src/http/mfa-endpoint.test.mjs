import { test } from "node:test";
import assert from "node:assert/strict";
import handler from "../../api/auth/mfa.mjs";

function response() {
  return { statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; } };
}

test("setup returns an authenticator seed with no session cookie and no cache", async () => {
  const res = response();
  await handler({ method: "POST", body: { action: "setup", mfa_token: "challenge" } }, res,
    { db: {}, beginSetup: async () => ({ ok: true, secret: "BASE32SECRET",
      otpauth_uri: "otpauth://totp/Fundhub:test" }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.secret, "BASE32SECRET");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.headers["Set-Cookie"], undefined);
});

test("only a verified challenge creates an HttpOnly staff session cookie", async () => {
  const denied = response();
  await handler({ method: "POST", body: { action: "verify",
    mfa_token: "challenge", code: "bad" } }, denied,
    { db: {}, verifyChallenge: async () => ({ ok: false, status: 401,
      error: "invalid_mfa_code" }) });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers["Set-Cookie"], undefined);

  const good = response();
  await handler({ method: "POST", body: { action: "verify",
    mfa_token: "challenge", code: "123456" } }, good,
    { db: {}, verifyChallenge: async () => ({ ok: true, token: "secret-session",
      expiresAt: new Date(Date.now() + 3600000), staff: { id: "staff-1" } }) });
  assert.equal(good.statusCode, 200);
  assert.equal(good.body.principal, "staff");
  assert.match(good.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax/);
});
