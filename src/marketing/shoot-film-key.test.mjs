import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  FILM_TTL_SECONDS, mintFilmKey, readFilmKey, filmFromReq, secretFromEnv
} from "./shoot-film-key.mjs";

const SECRET = "f".repeat(48);
const ORG = "11111111-1111-4111-8111-111111111111";
const SHOOT = "22222222-2222-4222-8222-222222222222";
const NOW = () => Date.parse("2026-10-07T16:00:00.000Z");

test("a film key names one shoot and lasts a week", () => {
  const minted = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, now: NOW });
  assert.equal(minted.path, "/app/teleprompter.html?k=" + minted.token);
  assert.equal(minted.expiresAt, Math.floor(NOW() / 1000) + FILM_TTL_SECONDS);
  const read = readFilmKey(minted.token, { secret: SECRET, now: NOW });
  assert.deepEqual(read, { orgId: ORG, shootId: SHOOT, expiresAt: minted.expiresAt });
});

test("a forged, expired, or swapped key does not open", () => {
  const minted = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, now: NOW });
  assert.equal(readFilmKey(minted.token + "ab", { secret: SECRET, now: NOW }), null);
  assert.equal(readFilmKey(minted.token, { secret: "e".repeat(48), now: NOW }), null);
  const late = () => NOW() + (FILM_TTL_SECONDS + 5) * 1000;
  assert.equal(readFilmKey(minted.token, { secret: SECRET, now: late }), null);
  const other = mintFilmKey({
    orgId: ORG, shootId: "33333333-3333-4333-8333-333333333333", secret: SECRET, now: NOW
  });
  assert.notEqual(other.token, minted.token);
  assert.equal(readFilmKey(other.token, { secret: SECRET, now: NOW }).shootId, "33333333-3333-4333-8333-333333333333");
});

test("a document signature cannot pass as a film key", () => {
  const exp = String(Math.floor(NOW() / 1000) + 60);
  const sig = createHmac("sha256", SECRET).update(["v1", ORG, SHOOT, exp].join("|")).digest("hex");
  assert.equal(readFilmKey(`${ORG}.${SHOOT}.${exp}.${sig}`, { secret: SECRET, now: NOW }), null);
});

test("the header is the only place the route reads the key", () => {
  const minted = mintFilmKey({ orgId: ORG, shootId: SHOOT, secret: SECRET, now: NOW });
  const ok = filmFromReq(
    { headers: { "X-Shoot-Film": minted.token } },
    { filmSecret: SECRET, now: NOW }
  );
  assert.equal(ok.shootId, SHOOT);
  assert.equal(filmFromReq({ headers: {} }, { filmSecret: SECRET, now: NOW }), null);
  assert.deepEqual(
    filmFromReq({ headers: { "x-shoot-film": "nope" } }, { filmSecret: SECRET, now: NOW }),
    { bad: true }
  );
});

test("no secret means no links", () => {
  assert.throws(() => secretFromEnv({}), /FILM_URL_SECRET/);
  assert.equal(secretFromEnv({ DOCUMENT_URL_SECRET: SECRET }), SECRET);
});
