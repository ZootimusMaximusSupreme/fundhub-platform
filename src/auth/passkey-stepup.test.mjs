import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { PASSKEY_ORIGIN, PASSKEY_RP_ID, validBankPasskeyIdentity,
  validPasskeyClientData, bankPasskeyAssurance, passkeyAction } from "./passkey-stepup.mjs";
import { syntheticPasskey } from "./passkey-test-support.mjs";
const identity = { orgId: randomUUID(), accountId: randomUUID(), sessionId: randomUUID(),
  targetId: randomUUID(), targetKind: "client_bank" };
const noDb = { query() { throw new Error("unexpected database read"); } };

test("bank identity rejects missing, mixed, foreign owner and unsupported target ids", async () => {
  assert.equal(validBankPasskeyIdentity(identity), true);
  for (const change of [{ sessionId: undefined }, { orgId: "invalid" }, { staffId: randomUUID() },
    { targetKind: "unknown" }, { targetId: undefined }]) {
    const bad = { ...identity, ...change };
    assert.equal(validBankPasskeyIdentity(bad), false);
    assert.equal(await bankPasskeyAssurance(noDb, bad), null);
    assert.equal((await passkeyAction(noDb, bad, { action: "status" })).error, "forbidden");
  }
  assert.equal(validBankPasskeyIdentity({ ...identity, accountId: null, staffId: randomUUID(),
    targetKind: "company_bank", targetId: identity.orgId }), true);
  assert.equal(validBankPasskeyIdentity({ ...identity, accountId: null, staffId: randomUUID(),
    targetKind: "company_bank" }), false);
});

test("unrecognized actions and malformed/cross-origin credential data fail closed", async () => {
  assert.equal((await passkeyAction(noDb, identity, { action: "login" })).error, "action_required");
  for (const value of [null, {}, { response: { clientDataJSON: "invalid" } }]) assert.equal(validPasskeyClientData(value), false);
  const key = syntheticPasskey();
  assert.equal(validPasskeyClientData(key.registration({ challenge: "challenge" })), true);
  assert.equal(validPasskeyClientData(key.registration({ challenge: "challenge" }, { client: { crossOrigin: true } })), false);
  assert.equal(validPasskeyClientData(key.registration({ challenge: "challenge" }, { client: { topOrigin: "https://evil.test" } })), false);
});

test("real verifier accepts synthetic P-256 possession+UV and rejects origin/RP/challenge/UP/UV/signature failures", async () => {
  const key = syntheticPasskey();
  const options = await generateRegistrationOptions({ rpName: "Fundhub", rpID: PASSKEY_RP_ID,
    userName: "e2e+passkey@example.test", authenticatorSelection: { userVerification: "required" } });
  const verifyRegistration = response => verifyRegistrationResponse({ response, expectedChallenge: options.challenge,
    expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID, requireUserPresence: true, requireUserVerification: true });
  const registered = await verifyRegistration(key.registration(options));
  assert.equal(registered.verified, true);
  for (const invalid of [{ flags: 0x59 }, { flags: 0x5c }, { rpID: "evil.test" },
    { client: { origin: "https://evil.test" } }, { client: { challenge: "wrong" } }]) {
    await assert.rejects(() => verifyRegistration(key.registration(options, invalid)));
  }
  const auth = await generateAuthenticationOptions({ rpID: PASSKEY_RP_ID, userVerification: "required" });
  const verify = response => verifyAuthenticationResponse({ response, expectedChallenge: auth.challenge,
    expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID,
    credential: registered.registrationInfo.credential, requireUserVerification: true });
  assert.equal((await verify(key.assertion(auth))).verified, true);
  for (const invalid of [{ flags: 0x19 }, { flags: 0x1c }, { rpID: "evil.test" },
    { client: { origin: "https://evil.test" } }, { client: { challenge: "wrong" } }]) {
    await assert.rejects(() => verify(key.assertion(auth, invalid)));
  }
  const broken = await verify(key.assertion(auth, { corruptSignature: true }));
  assert.equal(broken.verified, false);
});
